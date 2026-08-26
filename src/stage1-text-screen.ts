/**
 * Stage 1: can a cheap model post-process Greek at all?
 *
 * Run before spending anything on audio: a model that mangles Greek cannot be the cleanup
 * stage of a dictation pipeline. Because we hold the true reference, scoring reuses the
 * WER/entity machinery and needs no judge model — deterministic and free to re-score.
 *
 *   npm run stage1
 *
 * Flags: --models a,b  --limit N  --concurrency N  --no-cache
 */
import { generateText } from "ai";

import { UTTERANCES, referencesFor, type Utterance } from "./corpus/utterances";
import { BENCH_DIR, fetchCatalog, gatewayKey } from "./lib/gateway";
import { cacheKey, readCache, writeCache } from "./lib/cache";
import { bestWer, pct, scoreEntities } from "./lib/metrics";
import { normalize } from "./lib/normalize";
import { fmtUsd, priceCall, sumCosts, type Cost } from "./lib/pricing";
import { JsonlWriter, attempt, latencyStats, runPool } from "./lib/runner";

/** The user's seven, plus the cheapest plausible candidates from the catalog. */
export const CANDIDATES = [
  "alibaba/qwen3.7-flash",
  "deepseek/deepseek-v4-flash-0731",
  "mistral/ministral-14b",
  "alibaba/qwen-3-32b",
  "alibaba/qwen3.8-27b",
  "spacexai/grok-4.1-fast-reasoning",
  "openai/gpt-5.6-luna",
  "mistral/ministral-3b",
  "amazon/nova-micro",
  "tencent/hy-mt2-lite",
  "inclusionai/ling-3.0-flash",
  "openai/gpt-oss-20b",
];

export const PROMPT_VERSION = "s1-v1";

const SYSTEM =
  "Είσαι διορθωτής ελληνικού κειμένου από φωνητική υπαγόρευση. " +
  "Διόρθωσε τόνους, σημεία στίξης και κεφαλαία. " +
  "ΜΗΝ μεταφράζεις, ΜΗΝ αλλάζεις λέξεις, ΜΗΝ προσθέτεις ή αφαιρείς περιεχόμενο. " +
  "Κράτησε τους ξένους όρους (deadline, meeting, project) ακριβώς όπως είναι. " +
  "Απάντησε ΜΟΝΟ με το διορθωμένο κείμενο, χωρίς σχόλια.";

/**
 * Degrade a reference the way an STT model would: no accents, no punctuation, final
 * sigma folded, lowercased. This is what the cleanup stage must repair.
 */
export function degrade(text: string): string {
  return normalize(text, "L3");
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const models = flag("models")?.split(",") ?? CANDIDATES;
const limit = Number(flag("limit") ?? 0) || undefined;
const concurrency = Number(flag("concurrency") ?? 4);
const noCache = argv.includes("--no-cache");

const LATIN = /[a-z]/i;
/** Latin words that legitimately appear (loanwords kept verbatim by design). */
function latinTokens(s: string): string[] {
  return (s.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).map((w) => w.toLowerCase());
}

export interface Stage1Row {
  kind: "result";
  model: string;
  utteranceId: string;
  category: string;
  ok: boolean;
  error?: string;
  input: string;
  output?: string;
  werL1?: number;
  werL3?: number;
  eer?: number;
  ceer?: number;
  gates?: { script: boolean; loanword: boolean; length: boolean; entity: boolean };
  latencyMs?: number;
  cached: boolean;
  costUsd: number | null;
  costReason?: string;
  attempts: number;
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const catalog = await fetchCatalog();
  const corpus = (limit ? UTTERANCES.slice(0, limit) : UTTERANCES) as Utterance[];

  const tasks = models.flatMap((model) => corpus.map((u) => ({ model, u })));
  const out = new JsonlWriter(`${BENCH_DIR}/results/stage1-${Date.now()}.jsonl`);
  out.write({
    kind: "meta",
    stage: "stage1",
    promptVersion: PROMPT_VERSION,
    models,
    utterances: corpus.length,
    startedAt: new Date().toISOString(),
  });

  let done = 0;
  const rows = await runPool(
    tasks,
    async ({ model, u }): Promise<Stage1Row> => {
      const input = degrade(u.text);
      const key = cacheKey(["stage1", model, PROMPT_VERSION, input]);
      const hit = noCache ? undefined : readCache<{ text: string; inTok?: number; outTok?: number }>(key);

      let text: string | undefined = hit?.text;
      let inTok = hit?.inTok;
      let outTok = hit?.outTok;
      let latencyMs: number | undefined;
      let error: string | undefined;
      let attempts = 0;

      if (!hit) {
        const t0 = Date.now();
        const res = await attempt(() =>
          generateText({
            model,
            system: SYSTEM,
            prompt: input,
            temperature: 0,
            maxRetries: 0,
          }),
        );
        latencyMs = Date.now() - t0;
        attempts = res.attempts;
        if (res.ok) {
          text = res.value.text.trim();
          inTok = res.value.usage?.inputTokens;
          outTok = res.value.usage?.outputTokens;
          writeCache(key, { text, inTok, outTok });
        } else {
          error = res.error;
        }
      }

      process.stdout.write(`\r  ${++done}/${tasks.length}   `);

      if (text === undefined) {
        return {
          kind: "result", model, utteranceId: u.id, category: u.category, ok: false,
          error, input, cached: false, costUsd: null, costReason: "call_failed", attempts,
        };
      }

      const refs = referencesFor(u);
      const w1 = bestWer(refs, text, "L1").errorRate;
      const w3 = bestWer(refs, text, "L3").errorRate;
      const ent = scoreEntities(u.entities, text);
      const entIn = scoreEntities(u.entities, input);

      // Gates. Each targets a failure the pre-planning probe actually surfaced.
      const expectedLatin = new Set(latinTokens(u.text));
      const gotLatin = latinTokens(text);
      // Script integrity: no NEW Latin words invented where the reference had none.
      const script = u.lang === "en" || gotLatin.every((w) => expectedLatin.has(w));
      // Loanword stability: every Latin loanword in the reference survives verbatim.
      const loanword = [...expectedLatin].every((w) => gotLatin.includes(w));
      const ratio = text.length / u.text.length;
      const length = ratio >= 0.75 && ratio <= 1.25;
      const entity = ent.eer <= entIn.eer;

      const cost = priceCall(catalog.get(model), { inputTokens: inTok, outputTokens: outTok });

      return {
        kind: "result", model, utteranceId: u.id, category: u.category, ok: true,
        input, output: text,
        werL1: w1, werL3: w3, eer: ent.eer, ceer: ent.ceer,
        gates: { script, loanword, length, entity },
        latencyMs, cached: Boolean(hit),
        costUsd: cost.usd, costReason: cost.reason, attempts,
      };
    },
    { concurrency },
  );

  for (const r of rows) out.write(r);
  console.log("\n");

  // ---- summary -------------------------------------------------------
  const byModel = new Map<string, Stage1Row[]>();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const summary = [...byModel.entries()].map(([model, rs]) => {
    const good = rs.filter((r) => r.ok);
    const g = (k: keyof NonNullable<Stage1Row["gates"]>) =>
      good.length ? good.filter((r) => r.gates?.[k]).length / good.length : 0;
    const lat = latencyStats(good.map((r) => r.latencyMs).filter((n): n is number => n !== undefined));
    const cost: Cost = sumCosts(good.map((r) => ({ usd: r.costUsd, reason: r.costReason })));
    return {
      model,
      n: rs.length,
      failed: rs.length - good.length,
      werL1: mean(good.map((r) => r.werL1!)),
      ceer: mean(good.map((r) => r.ceer!)),
      script: g("script"),
      loanword: g("loanword"),
      length: g("length"),
      entity: g("entity"),
      p50: lat.p50,
      per1k: cost.usd === null ? null : (cost.usd / Math.max(1, good.length)) * 1000,
    };
  });

  // A model passes the screen only if every gate is clean and WER is sane.
  const passes = (s: (typeof summary)[number]) =>
    s.failed === 0 && s.script >= 0.95 && s.loanword >= 0.95 && s.length >= 0.95 && s.werL1 <= 0.25;

  summary.sort((a, b) => Number(passes(b)) - Number(passes(a)) || a.werL1 - b.werL1);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad("model", 32) + pad("WER-L1", 9) + pad("CEER", 8) + pad("script", 8) +
      pad("loanwd", 8) + pad("len", 7) + pad("p50", 8) + pad("$/1k", 10) + "verdict",
  );
  console.log("-".repeat(102));
  for (const s of summary) {
    console.log(
      pad(s.model, 32) +
        pad(pct(s.werL1), 9) +
        pad(pct(s.ceer), 8) +
        pad(pct(s.script), 8) +
        pad(pct(s.loanword), 8) +
        pad(pct(s.length), 7) +
        pad(Number.isFinite(s.p50) ? `${Math.round(s.p50)}ms` : "cached", 8) +
        pad(s.per1k === null ? "unknown" : `$${s.per1k.toFixed(3)}`, 10) +
        (passes(s) ? "PASS" : "fail") +
        (s.failed ? `  (${s.failed} errored)` : ""),
    );
  }

  const shortlist = summary.filter(passes).map((s) => s.model);
  console.log(`\n✓ ${shortlist.length}/${summary.length} passed the Greek screen`);
  console.log(`  shortlist: ${shortlist.join(", ") || "(none)"}`);
}
