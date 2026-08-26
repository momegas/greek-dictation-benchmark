/**
 * Stage 2: WER/CER and entity accuracy across the transcription models.
 *
 * Accuracy and latency are measured separately: accuracy runs once over the whole corpus,
 * latency repeats over a subset. Conflating them means paying 3x for accuracy data that
 * does not need repeats.
 *
 *   npm run stage2
 *
 * Flags: --models a,b  --limit N  --concurrency N  --repeat N  --latency-subset N
 *        --no-cache
 */
import { readFileSync } from "node:fs";
import { UTTERANCES, referencesFor } from "./corpus/utterances";
import { readManifest } from "./corpus/synthesize";
import { BENCH_DIR, fetchCatalog, gatewayKey } from "./lib/gateway";
import { cacheKey, readCache, writeCache } from "./lib/cache";
import { bestWer, cer, numeralFormat, pct, scoreEntities } from "./lib/metrics";
import { fmtUsd, priceCall, sumCosts } from "./lib/pricing";
import { JsonlWriter, attempt, latencyStats, runPool } from "./lib/runner";
import { makeProvider, SCRIBE_ID } from "./lib/stt-providers";

/**
 * The six usable transcription models.
 *
 * openai/gpt-realtime-whisper is deliberately absent: it rejects non-streaming
 * transcription outright ("functionality not supported"), so it cannot be swept.
 */
export const STT_MODELS = [
  SCRIBE_ID,
  "openai/gpt-4o-transcribe",
  "openai/gpt-4o-mini-transcribe",
  "openai/whisper-1",
  "spacexai/grok-stt",
  "fish-audio/transcribe-1",
  "fish-audio/transcribe-1-free",
];

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const models = flag("models")?.split(",") ?? STT_MODELS;
const limit = Number(flag("limit") ?? 0) || undefined;
const concurrency = Number(flag("concurrency") ?? 4);
const repeat = Number(flag("repeat") ?? 3);
const latencySubset = Number(flag("latency-subset") ?? 15);
const noCache = argv.includes("--no-cache");

export interface Stage2Row {
  kind: "result";
  model: string;
  utteranceId: string;
  category: string;
  lang: string;
  ok: boolean;
  error?: string;
  text?: string;
  detectedLanguage?: string | null;
  werL0?: number;
  werL1?: number;
  werL2?: number;
  werL3?: number;
  werL4?: number;
  cerL1?: number;
  eer?: number;
  ceer?: number;
  missedEntities?: string[];
  numeralFormat?: string;
  durationSec: number;
  cached: boolean;
  costUsd: number | null;
  costReason?: string;
  attempts: number;
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const catalog = await fetchCatalog();
  const manifest = readManifest();
  const byId = new Map(manifest.utterances.map((e) => [e.id, e]));

  const providers = new Map(models.map((m) => [m, makeProvider(m)]));
  const blocked = [...providers.values()].filter((p) => p.unavailable);
  for (const b of blocked) console.log(`- skipping ${b.id}: ${b.unavailable}`);
  const active = models.filter((m) => !providers.get(m)!.unavailable);

  const corpus = (limit ? UTTERANCES.slice(0, limit) : UTTERANCES).filter((u) => byId.has(u.id));
  if (corpus.length === 0) {
    console.error("✗ no audio found. Run: npm run synth");
    process.exit(1);
  }

  const stamp = Date.now();
  const out = new JsonlWriter(`${BENCH_DIR}/results/stage2-${stamp}.jsonl`);
  out.write({
    kind: "meta",
    stage: "stage2",
    models,
    utterances: corpus.length,
    ttsModel: manifest.ttsModel,
    manifestGeneratedAt: manifest.generatedAt,
    startedAt: new Date().toISOString(),
  });

  // ---- accuracy pass -------------------------------------------------
  const tasks = active.flatMap((model) => corpus.map((u) => ({ model, u })));
  let done = 0;

  const rows = await runPool(
    tasks,
    async ({ model, u }): Promise<Stage2Row> => {
      const entry = byId.get(u.id)!;
      const audio = readFileSync(entry.audioPath);
      const key = cacheKey(["stage2", model, entry.audioSha256]);
      const hit = noCache
        ? undefined
        : readCache<{ text: string; language?: string | null; inTok?: number; outTok?: number }>(key);

      let text = hit?.text;
      let language = hit?.language ?? null;
      let inTok = hit?.inTok;
      let outTok = hit?.outTok;
      let error: string | undefined;
      let attempts = 0;

      if (!hit) {
        const res = await attempt(() => providers.get(model)!.run(audio));
        attempts = res.attempts;
        if (res.ok) {
          text = res.value.text;
          language = res.value.language ?? null;
          inTok = res.value.inputTokens;
          outTok = res.value.outputTokens;
          writeCache(key, { text, language, inTok, outTok });
        } else {
          error = res.error;
        }
      }

      process.stdout.write(`\r  ${++done}/${tasks.length}   `);

      const base = {
        kind: "result" as const,
        model,
        utteranceId: u.id,
        category: u.category,
        lang: u.lang,
        durationSec: entry.durationSec,
        cached: Boolean(hit),
        attempts,
      };

      if (text === undefined) {
        return { ...base, ok: false, error, costUsd: null, costReason: "call_failed" };
      }

      const refs = referencesFor(u);
      const ent = scoreEntities(u.entities, text, refs.slice(1));
      const cost = priceCall(
        catalog.get(model),
        { durationSec: entry.durationSec, inputTokens: inTok, outputTokens: outTok },
        model,
      );

      return {
        ...base,
        ok: true,
        text,
        detectedLanguage: language,
        werL0: bestWer(refs, text, "L0").errorRate,
        werL1: bestWer(refs, text, "L1").errorRate,
        werL2: bestWer(refs, text, "L2").errorRate,
        werL3: bestWer(refs, text, "L3").errorRate,
        werL4: bestWer(refs, text, "L4").errorRate,
        cerL1: Math.min(...refs.map((r) => cer(r, text!, "L1").errorRate)),
        eer: ent.eer,
        ceer: ent.ceer,
        missedEntities: ent.hits.filter((h) => !h.found).map((h) => h.entity.value),
        numeralFormat: numeralFormat(text),
        costUsd: cost.usd,
        costReason: cost.reason,
      };
    },
    { concurrency },
  );

  for (const r of rows) out.write(r);
  console.log("\n");

  // ---- latency pass ---------------------------------------------------
  // Separate, repeated, and cache-bypassing: a cached call has no latency to report.
  const latCorpus = corpus.slice(0, latencySubset);
  const latency = new Map<string, number[]>();
  console.log(`measuring latency: ${active.length} models x ${latCorpus.length} clips x ${repeat} reps`);

  for (const model of active) {
    // Discard one cold call: TLS/DNS and gateway warmup are not the model's latency.
    const warm = byId.get(latCorpus[0].id)!;
    await attempt(() => providers.get(model)!.run(readFileSync(warm.audioPath)));

    const samples: number[] = [];
    const jobs = latCorpus.flatMap((u) => Array.from({ length: repeat }, () => u));
    await runPool(
      jobs,
      async (u) => {
        const e = byId.get(u.id)!;
        const t0 = Date.now();
        const res = await attempt(() => providers.get(model)!.run(readFileSync(e.audioPath)), 1);
        if (res.ok) samples.push(Date.now() - t0);
      },
      { concurrency: 2 },
    );
    latency.set(model, samples);
    const s = latencyStats(samples);
    console.log(`  ${model.padEnd(30)} p50=${Math.round(s.p50)}ms p95=${Math.round(s.p95)}ms n=${s.n}`);
  }

  for (const [model, ms] of latency) {
    out.write({ kind: "latency", model, samples: ms, ...latencyStats(ms) });
  }

  // ---- summary --------------------------------------------------------
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const byModel = new Map<string, Stage2Row[]>();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }

  const totalSec = corpus.reduce((n, u) => n + byId.get(u.id)!.durationSec, 0);

  const summary = [...byModel.entries()].map(([model, rs]) => {
    const good = rs.filter((r) => r.ok);
    const cost = sumCosts(good.map((r) => ({ usd: r.costUsd, reason: r.costReason })));
    const lat = latencyStats(latency.get(model) ?? []);
    const perHour =
      cost.usd === null ? null : (cost.usd / Math.max(totalSec, 1)) * 3600;
    return {
      model,
      failed: rs.length - good.length,
      ceer: mean(good.map((r) => r.ceer!)),
      eer: mean(good.map((r) => r.eer!)),
      werL1: mean(good.map((r) => r.werL1!)),
      cerL1: mean(good.map((r) => r.cerL1!)),
      p50: lat.p50,
      p95: lat.p95,
      rtf: Number.isFinite(lat.p50) ? lat.p50 / 1000 / (totalSec / corpus.length) : NaN,
      per1k: cost.usd === null ? null : (cost.usd / Math.max(1, good.length)) * 1000,
      perHour,
    };
  });

  // CEER first, WER as tiebreak: a mangled tax acronym matters more than a fumbled
  // function word, and plain WER ranks those backwards.
  summary.sort((a, b) => a.ceer - b.ceer || a.werL1 - b.werL1);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    "\n" + pad("model", 31) + pad("CEER", 8) + pad("EER", 8) + pad("WER-L1", 9) +
      pad("CER", 8) + pad("p50", 9) + pad("p95", 9) + pad("RTF", 7) + pad("$/1k", 10) + "$/hr",
  );
  console.log("-".repeat(106));
  for (const s of summary) {
    console.log(
      pad(s.model, 31) + pad(pct(s.ceer), 8) + pad(pct(s.eer), 8) + pad(pct(s.werL1), 9) +
        pad(pct(s.cerL1), 8) +
        pad(Number.isFinite(s.p50) ? `${Math.round(s.p50)}ms` : "-", 9) +
        pad(Number.isFinite(s.p95) ? `${Math.round(s.p95)}ms` : "-", 9) +
        pad(Number.isFinite(s.rtf) ? s.rtf.toFixed(2) : "-", 7) +
        pad(s.per1k === null ? "unknown" : `$${s.per1k.toFixed(3)}`, 10) +
        (s.perHour === null ? "unknown" : `$${s.perHour.toFixed(3)}`) +
        (s.failed ? `  (${s.failed} errored)` : ""),
    );
  }

  // Per-category CEER: the actionable view ("fine except on tax terms").
  const cats = [...new Set(corpus.map((u) => u.category))];
  console.log("\nCEER by category");
  console.log(pad("model", 31) + cats.map((c) => pad(c.slice(0, 9), 11)).join(""));
  console.log("-".repeat(31 + cats.length * 11));
  for (const s of summary) {
    const rs = byModel.get(s.model)!.filter((r) => r.ok);
    const cells = cats.map((c) => {
      const sub = rs.filter((r) => r.category === c);
      return pad(sub.length ? pct(mean(sub.map((r) => r.ceer!))) : "-", 11);
    });
    console.log(pad(s.model, 31) + cells.join(""));
  }

  console.log(`\nwrote ${BENCH_DIR}/results/stage2-${stamp}.jsonl`);
}
