/**
 * Stage 3: the full pipeline, STT -> LLM cleanup.
 *
 * Every STT model is also scored alone as a control. If no LLM beats raw STT, the second
 * stage is pure cost and latency — a legitimate and useful result, and one the controls
 * are the only way to see.
 *
 *   npm run stage3
 *
 * Flags: --stt a,b  --llm a,b  --limit N  --concurrency N  --prompt minimal|format|both
 */
import { readFileSync, readdirSync } from "node:fs";
import { generateText } from "ai";

import { UTTERANCES, referencesFor } from "./corpus/utterances";
import { readManifest } from "./corpus/synthesize";
import { BENCH_DIR, fetchCatalog, gatewayKey } from "./lib/gateway";
import { cacheKey, readCache, writeCache } from "./lib/cache";
import { bestWer, pct, scoreEntities } from "./lib/metrics";
import { priceCall, sumCosts } from "./lib/pricing";
import { JsonlWriter, attempt, latencyStats, runPool } from "./lib/runner";
import type { Stage2Row } from "./stage2-stt";

/** Two prompts: minimal repair should win on WER, formatting on product usefulness. */
export const PROMPTS = {
  minimal: {
    version: "s3-minimal-v1",
    system:
      "Διόρθωσε ΜΟΝΟ τόνους, σημεία στίξης και κεφαλαία στο κείμενο υπαγόρευσης. " +
      "ΜΗΝ αλλάζεις, μεταφράζεις, προσθέτεις ή αφαιρείς λέξεις. " +
      "Κράτησε τους ξένους όρους ακριβώς όπως είναι. " +
      "Απάντησε ΜΟΝΟ με το κείμενο.",
  },
  format: {
    version: "s3-format-v1",
    system:
      "Καθάρισε το κείμενο υπαγόρευσης για επαγγελματική χρήση. " +
      "Διόρθωσε τόνους, στίξη και κεφαλαία. Γράψε τους αριθμούς και τα ποσά με ψηφία " +
      "(π.χ. 16,99), και τα ακρωνύμια σωστά (ΦΠΑ, ΑΦΜ, ΔΟΥ). " +
      "ΜΗΝ αλλάζεις το νόημα και ΜΗΝ προσθέτεις περιεχόμενο. " +
      "Απάντησε ΜΟΝΟ με το κείμενο.",
  },
} as const;

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(flag("limit") ?? 0) || undefined;
const concurrency = Number(flag("concurrency") ?? 5);
const promptSel = flag("prompt") ?? "both";
const sttArg = flag("stt");
const llmArg = flag("llm");

/** Reads the newest Stage 2 JSONL to pick the STT winners and reuse their transcripts. */
function loadStage2(): { rows: Stage2Row[]; file: string } {
  const dir = `${BENCH_DIR}/results`;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("stage2-") && f.endsWith(".jsonl"))
    .sort();
  if (files.length === 0) {
    console.error("✗ no Stage 2 results. Run: npm run stage2");
    process.exit(1);
  }
  const file = `${dir}/${files[files.length - 1]}`;
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r): r is Stage2Row => r.kind === "result");
  return { rows, file };
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const catalog = await fetchCatalog();
  const manifest = readManifest();
  const byId = new Map(manifest.utterances.map((e) => [e.id, e]));
  const { rows: s2, file: s2file } = loadStage2();

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

  // Rank STT by CEER (the ranking key), take the top 3 unless overridden.
  const sttStats = new Map<string, number>();
  for (const model of new Set(s2.map((r) => r.model))) {
    const good = s2.filter((r) => r.model === model && r.ok);
    if (good.length) sttStats.set(model, mean(good.map((r) => r.ceer!)));
  }
  const sttModels =
    sttArg?.split(",") ??
    [...sttStats.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([m]) => m);

  const llmModels = llmArg?.split(",") ?? [
    "deepseek/deepseek-v4-flash-0731",
    "alibaba/qwen-3-32b",
    "openai/gpt-5.6-luna",
  ];

  const promptKeys = (
    promptSel === "both" ? (["minimal", "format"] as const) : ([promptSel] as const)
  ) as ("minimal" | "format")[];

  const corpus = (limit ? UTTERANCES.slice(0, limit) : UTTERANCES).filter((u) => byId.has(u.id));
  console.log(`stt: ${sttModels.join(", ")}`);
  console.log(`llm: ${llmModels.join(", ")}`);
  console.log(`prompts: ${promptKeys.join(", ")}  utterances: ${corpus.length}\n`);

  const stamp = Date.now();
  const out = new JsonlWriter(`${BENCH_DIR}/results/stage3-${stamp}.jsonl`);
  out.write({
    kind: "meta",
    stage: "stage3",
    sttModels,
    llmModels,
    prompts: promptKeys.map((k) => PROMPTS[k].version),
    stage2File: s2file,
    startedAt: new Date().toISOString(),
  });

  // Raw STT transcripts, reused from Stage 2's cache — no re-transcription needed.
  const raw = new Map<string, Stage2Row>();
  for (const r of s2) if (r.ok) raw.set(`${r.model}|${r.utteranceId}`, r);

  interface Row {
    kind: "result";
    combo: string;
    stt: string;
    llm: string | null;
    prompt: string | null;
    utteranceId: string;
    category: string;
    ok: boolean;
    error?: string;
    sttText?: string;
    finalText?: string;
    werL1?: number;
    ceer?: number;
    eer?: number;
    sttWerL1?: number;
    sttCeer?: number;
    llmLatencyMs?: number;
    sttCostUsd: number | null;
    llmCostUsd: number | null;
    cached: boolean;
  }

  // Controls: STT alone.
  const controls: Row[] = [];
  for (const stt of sttModels) {
    for (const u of corpus) {
      const r = raw.get(`${stt}|${u.id}`);
      if (!r) continue;
      controls.push({
        kind: "result", combo: `${stt} (raw)`, stt, llm: null, prompt: null,
        utteranceId: u.id, category: u.category, ok: true,
        sttText: r.text, finalText: r.text,
        werL1: r.werL1, ceer: r.ceer, eer: r.eer,
        sttWerL1: r.werL1, sttCeer: r.ceer,
        sttCostUsd: r.costUsd, llmCostUsd: 0, cached: true,
      });
    }
  }

  const tasks = sttModels.flatMap((stt) =>
    llmModels.flatMap((llm) =>
      promptKeys.flatMap((pk) =>
        corpus.filter((u) => raw.has(`${stt}|${u.id}`)).map((u) => ({ stt, llm, pk, u })),
      ),
    ),
  );

  let done = 0;
  const piped = await runPool(
    tasks,
    async ({ stt, llm, pk, u }): Promise<Row> => {
      const r = raw.get(`${stt}|${u.id}`)!;
      const prompt = PROMPTS[pk];
      const key = cacheKey(["stage3", llm, prompt.version, r.text!]);
      const hit = readCache<{ text: string; inTok?: number; outTok?: number }>(key);

      let text = hit?.text;
      let inTok = hit?.inTok;
      let outTok = hit?.outTok;
      let llmLatencyMs: number | undefined;
      let error: string | undefined;

      if (!hit) {
        const t0 = Date.now();
        const res = await attempt(() =>
          generateText({ model: llm, system: prompt.system, prompt: r.text!, temperature: 0, maxRetries: 0 }),
        );
        llmLatencyMs = Date.now() - t0;
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

      const base = {
        kind: "result" as const,
        combo: `${stt} + ${llm} [${pk}]`,
        stt, llm, prompt: pk,
        utteranceId: u.id, category: u.category,
        sttText: r.text, sttWerL1: r.werL1, sttCeer: r.ceer,
        sttCostUsd: r.costUsd, cached: Boolean(hit),
      };

      if (text === undefined) return { ...base, ok: false, error, llmCostUsd: null };

      const refs = referencesFor(u);
      const ent = scoreEntities(u.entities, text, refs.slice(1));
      const cost = priceCall(catalog.get(llm), { inputTokens: inTok, outputTokens: outTok });

      return {
        ...base, ok: true, finalText: text,
        werL1: bestWer(refs, text, "L1").errorRate,
        ceer: ent.ceer, eer: ent.eer,
        llmLatencyMs, llmCostUsd: cost.usd,
      };
    },
    { concurrency },
  );

  for (const r of [...controls, ...piped]) out.write(r);
  console.log("\n");

  // ---- summary --------------------------------------------------------
  const byCombo = new Map<string, Row[]>();
  for (const r of [...controls, ...piped]) {
    if (!byCombo.has(r.combo)) byCombo.set(r.combo, []);
    byCombo.get(r.combo)!.push(r);
  }

  const summary = [...byCombo.entries()].map(([combo, rs]) => {
    const good = rs.filter((r) => r.ok);
    const sttCost = sumCosts(good.map((r) => ({ usd: r.sttCostUsd })));
    const llmCost = sumCosts(good.map((r) => ({ usd: r.llmCostUsd })));
    const total =
      sttCost.usd === null || llmCost.usd === null ? null : sttCost.usd + llmCost.usd;
    const lat = latencyStats(
      good.map((r) => r.llmLatencyMs).filter((n): n is number => n !== undefined),
    );
    return {
      combo,
      isControl: rs[0]?.llm === null,
      n: good.length,
      failed: rs.length - good.length,
      werL1: mean(good.map((r) => r.werL1!)),
      ceer: mean(good.map((r) => r.ceer!)),
      // Delta vs the same STT alone: positive means the LLM made it worse.
      dWer: mean(good.map((r) => r.werL1! - r.sttWerL1!)),
      dCeer: mean(good.map((r) => r.ceer! - r.sttCeer!)),
      llmP50: lat.p50,
      per1k: total === null ? null : (total / Math.max(1, good.length)) * 1000,
    };
  });

  summary.sort((a, b) => a.ceer - b.ceer || a.werL1 - b.werL1);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad("pipeline", 58) + pad("CEER", 8) + pad("WER-L1", 9) +
      pad("dWER", 9) + pad("dCEER", 9) + pad("llm p50", 10) + "$/1k",
  );
  console.log("-".repeat(112));
  for (const s of summary) {
    const sign = (x: number) => (x > 0.0005 ? "+" : "") + pct(x);
    console.log(
      pad(s.combo, 58) + pad(pct(s.ceer), 8) + pad(pct(s.werL1), 9) +
        pad(s.isControl ? "-" : sign(s.dWer), 9) +
        pad(s.isControl ? "-" : sign(s.dCeer), 9) +
        pad(Number.isFinite(s.llmP50) ? `${Math.round(s.llmP50)}ms` : "-", 10) +
        (s.per1k === null ? "unknown" : `$${s.per1k.toFixed(3)}`) +
        (s.failed ? `  (${s.failed} err)` : ""),
    );
  }

  const best = summary[0];
  const bestControl = summary.find((s) => s.isControl);
  console.log(`\nbest overall: ${best.combo}  CEER=${pct(best.ceer)} WER=${pct(best.werL1)}`);
  if (bestControl) {
    console.log(`best raw STT: ${bestControl.combo}  CEER=${pct(bestControl.ceer)} WER=${pct(bestControl.werL1)}`);
    console.log(
      best.isControl
        ? "→ no LLM stage beat raw STT: the cleanup pass is pure cost and latency here."
        : "→ the LLM stage helps; see dWER/dCEER for where.",
    );
  }
  console.log(`\nwrote ${BENCH_DIR}/results/stage3-${stamp}.jsonl`);
}
