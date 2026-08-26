/**
 * Round two: the shortlisted STT engines against the 100-clip department corpus.
 *
 * Harder than round one in three ways — clips are ~2x longer, they span eleven business
 * functions rather than eight vocabulary categories, and they are spoken by twelve voices
 * across two TTS providers instead of one. Only engines that survived round one are here,
 * so the numbers are not comparable to a full-field sweep.
 *
 *   npm run r2:stt
 *
 * Flags: --models a,b  --limit N  --concurrency N  --repeat N  --latency-subset N
 */
import { readFileSync } from "node:fs";

import { DEPT_UTTERANCES } from "./corpus/departments";
import { deptRefs, readDeptManifest } from "./corpus/synth-depts";
import { BENCH_DIR, fetchCatalog, gatewayKey } from "./lib/gateway";
import { cacheKey, readCache, writeCache } from "./lib/cache";
import { bestWer, cer, pct, scoreEntities } from "./lib/metrics";
import { priceCall, sumCosts } from "./lib/pricing";
import { JsonlWriter, attempt, latencyStats, runPool } from "./lib/runner";
import { makeProvider } from "./lib/stt-providers";
import { SHORTLIST_STT } from "./shortlist";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const models = flag("models")?.split(",") ?? SHORTLIST_STT;
const limit = Number(flag("limit") ?? 0) || undefined;
const concurrency = Number(flag("concurrency") ?? 4);
const repeat = Number(flag("repeat") ?? 3);
const latSubset = Number(flag("latency-subset") ?? 12);

export interface R2SttRow {
  kind: "result";
  model: string;
  utteranceId: string;
  dept: string;
  ttsModel: string;
  voice: string;
  hasNumbers: boolean;
  ok: boolean;
  error?: string;
  text?: string;
  werL1?: number;
  werL4?: number;
  cerL1?: number;
  eer?: number;
  ceer?: number;
  missed?: string[];
  durationSec: number;
  cached: boolean;
  costUsd: number | null;
  costReason?: string;
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const catalog = await fetchCatalog();
  const manifest = readDeptManifest();
  const byId = new Map(manifest.utterances.map((e) => [e.id, e]));
  const utt = new Map(DEPT_UTTERANCES.map((u) => [u.id, u]));

  const providers = new Map(models.map((m) => [m, makeProvider(m)]));
  for (const p of providers.values()) if (p.unavailable) console.log(`- skipping ${p.id}: ${p.unavailable}`);
  const active = models.filter((m) => !providers.get(m)!.unavailable);

  const corpus = (limit ? DEPT_UTTERANCES.slice(0, limit) : DEPT_UTTERANCES).filter((u) => byId.has(u.id));
  const stamp = Date.now();
  const out = new JsonlWriter(`${BENCH_DIR}/results/r2stt-${stamp}.jsonl`);
  out.write({
    kind: "meta", stage: "round2-stt", models: active, utterances: corpus.length,
    corpus: "departments", manifestGeneratedAt: manifest.generatedAt,
    startedAt: new Date().toISOString(),
  });

  const tasks = active.flatMap((model) => corpus.map((u) => ({ model, u })));
  let done = 0;

  const rows = await runPool(tasks, async ({ model, u }): Promise<R2SttRow> => {
    const e = byId.get(u.id)!;
    const audio = readFileSync(e.audioPath);
    const key = cacheKey(["r2stt", model, e.audioSha256]);
    const hit = readCache<{ text: string; inTok?: number; outTok?: number }>(key);

    let text = hit?.text;
    let inTok = hit?.inTok;
    let outTok = hit?.outTok;
    let error: string | undefined;

    if (!hit) {
      const res = await attempt(() => providers.get(model)!.run(audio));
      if (res.ok) {
        text = res.value.text;
        inTok = res.value.inputTokens;
        outTok = res.value.outputTokens;
        writeCache(key, { text, inTok, outTok });
      } else error = res.error;
    }

    process.stdout.write(`\r  ${++done}/${tasks.length}   `);
    const base = {
      kind: "result" as const, model, utteranceId: u.id, dept: u.dept,
      ttsModel: e.ttsModel, voice: e.voice, hasNumbers: u.hasNumbers,
      durationSec: e.durationSec, cached: Boolean(hit),
    };
    if (text === undefined) return { ...base, ok: false, error, costUsd: null, costReason: "call_failed" };

    const refs = deptRefs(u);
    const ent = scoreEntities(u.entities, text, refs.slice(1));
    const cost = priceCall(catalog.get(model), { durationSec: e.durationSec, inputTokens: inTok, outputTokens: outTok }, model);
    return {
      ...base, ok: true, text,
      werL1: bestWer(refs, text, "L1").errorRate,
      werL4: bestWer(refs, text, "L4").errorRate,
      cerL1: Math.min(...refs.map((r) => cer(r, text!, "L1").errorRate)),
      eer: ent.eer, ceer: ent.ceer,
      missed: ent.hits.filter((h) => !h.found).map((h) => h.entity.value),
      costUsd: cost.usd, costReason: cost.reason,
    };
  }, { concurrency });

  for (const r of rows) out.write(r);
  console.log("\n");

  // Latency: separate pass, repeats, one discarded cold call per engine.
  const latCorpus = corpus.slice(0, latSubset);
  const latency = new Map<string, number[]>();
  console.log(`latency: ${active.length} engines x ${latCorpus.length} clips x ${repeat}`);
  for (const model of active) {
    const warm = byId.get(latCorpus[0].id)!;
    await attempt(() => providers.get(model)!.run(readFileSync(warm.audioPath)));
    const samples: number[] = [];
    await runPool(
      latCorpus.flatMap((u) => Array.from({ length: repeat }, () => u)),
      async (u) => {
        const e = byId.get(u.id)!;
        const t0 = Date.now();
        const r = await attempt(() => providers.get(model)!.run(readFileSync(e.audioPath)), 1);
        if (r.ok) samples.push(Date.now() - t0);
      },
      { concurrency: 2 },
    );
    latency.set(model, samples);
    const s = latencyStats(samples);
    console.log(`  ${model.padEnd(30)} p50=${Math.round(s.p50)}ms p95=${Math.round(s.p95)}ms`);
  }
  for (const [model, ms] of latency) out.write({ kind: "latency", model, samples: ms, ...latencyStats(ms) });

  // Summary
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const by = new Map<string, R2SttRow[]>();
  for (const r of rows) {
    if (!by.has(r.model)) by.set(r.model, []);
    by.get(r.model)!.push(r);
  }
  const totalSec = corpus.reduce((n, u) => n + byId.get(u.id)!.durationSec, 0);
  const summary = [...by.entries()].map(([model, rs]) => {
    const g = rs.filter((r) => r.ok);
    const cost = sumCosts(g.map((r) => ({ usd: r.costUsd, reason: r.costReason })));
    const l = latencyStats(latency.get(model) ?? []);
    return {
      model, failed: rs.length - g.length,
      ceer: mean(g.map((r) => r.ceer!)), eer: mean(g.map((r) => r.eer!)),
      wer: mean(g.map((r) => r.werL1!)), cer: mean(g.map((r) => r.cerL1!)),
      p50: l.p50, p95: l.p95,
      rtf: Number.isFinite(l.p50) ? l.p50 / 1000 / (totalSec / g.length) : NaN,
      perHour: cost.usd === null ? null : (cost.usd / totalSec) * 3600,
      // Reported by CONTENT, not by TTS provider. Provider and content are near-collinear
      // here (number-bearing clips route to grok by design), so a provider split would look
      // like a provider comparison while actually measuring how hard the content is.
      numCeer: mean(g.filter((r) => r.hasNumbers).map((r) => r.ceer!)),
      proseCeer: mean(g.filter((r) => !r.hasNumbers).map((r) => r.ceer!)),
    };
  }).sort((a, b) => a.ceer - b.ceer || a.wer - b.wer);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log("\n" + pad("engine", 31) + pad("CEER", 8) + pad("WER", 8) + pad("CER", 8) +
    pad("p50", 9) + pad("p95", 9) + pad("RTF", 7) + pad("$/hr", 9) + "CEER figures|prose");
  console.log("-".repeat(108));
  for (const s of summary) {
    console.log(pad(s.model, 31) + pad(pct(s.ceer), 8) + pad(pct(s.wer), 8) + pad(pct(s.cer), 8) +
      pad(Number.isFinite(s.p50) ? Math.round(s.p50) + "ms" : "-", 9) +
      pad(Number.isFinite(s.p95) ? Math.round(s.p95) + "ms" : "-", 9) +
      pad(Number.isFinite(s.rtf) ? s.rtf.toFixed(2) : "-", 7) +
      pad(s.perHour === null ? "unknown" : "$" + s.perHour.toFixed(3), 9) +
      `${pct(s.numCeer)} | ${pct(s.proseCeer)}` + (s.failed ? `  (${s.failed} err)` : ""));
  }

  const depts = [...new Set(corpus.map((u) => u.dept))];
  console.log("\nCEER by department");
  console.log(pad("engine", 31) + depts.map((d) => pad(d.slice(0, 9), 11)).join(""));
  console.log("-".repeat(31 + depts.length * 11));
  for (const s of summary) {
    const rs = by.get(s.model)!.filter((r) => r.ok);
    console.log(pad(s.model, 31) + depts.map((d) => {
      const sub = rs.filter((r) => r.dept === d);
      return pad(sub.length ? pct(mean(sub.map((r) => r.ceer!))) : "-", 11);
    }).join(""));
  }
  console.log(`\nwrote ${BENCH_DIR}/results/r2stt-${stamp}.jsonl`);
}
