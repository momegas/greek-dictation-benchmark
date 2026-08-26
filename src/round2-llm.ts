/**
 * Round two: the shortlisted language models on department dictation work.
 *
 * Round one asked whether a model can restore accents and answer a question. This round
 * asks whether it can do the job a dictation pipeline actually needs across a business:
 * clean up a transcript from any department without changing its meaning, and answer
 * questions grounded in that department's vocabulary.
 *
 * Scored the same two ways as round one, side by side: deterministic checks where a correct
 * answer is knowable, and gpt-5.6-terra against a fixed rubric for the qualities a substring
 * match cannot see. The gap between them is reported rather than averaged away.
 *
 *   npm run r2:llm
 */
import { generateText } from "ai";

import { DEPT_UTTERANCES } from "./corpus/departments";
import { BENCH_DIR, fetchCatalog, gatewayKey } from "./lib/gateway";
import { cacheKey, readCache, writeCache } from "./lib/cache";
import { bestWer, pct, scoreEntities } from "./lib/metrics";
import { normalize } from "./lib/normalize";
import { priceCall, sumCosts } from "./lib/pricing";
import { JsonlWriter, attempt, latencyStats, runPool } from "./lib/runner";
import { JUDGE_MODEL, JUDGE_PROMPT_VERSION, judge, verdictScore, type Verdict } from "./lib/judge";
import { SHORTLIST_LLM } from "./shortlist";

export const PROMPT_VERSION = "r2llm-v1";

/** Cleanup: the transcript arrives degraded, as dictation output would. */
const CLEANUP_SYSTEM =
  "Διόρθωσε τόνους, σημεία στίξης και κεφαλαία στο κείμενο υπαγόρευσης. " +
  "ΜΗΝ αλλάζεις, μεταφράζεις, προσθέτεις ή αφαιρείς λέξεις. " +
  "Κράτησε αριθμούς, ακρωνύμια και ξένους όρους ακριβώς όπως είναι. " +
  "Απάντησε ΜΟΝΟ με το κείμενο.";

/** One comprehension question per department, grounded in that department's passage. */
const QUESTION_SYSTEM =
  "Απαντάς σε ερωτήσεις για επιχειρηματικά κείμενα, στα ελληνικά, σύντομα και ακριβώς. " +
  "Αν η πληροφορία δεν προκύπτει από το κείμενο, το λες ρητά και ΔΕΝ την επινοείς.";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const models = flag("models")?.split(",") ?? SHORTLIST_LLM;
const limit = Number(flag("limit") ?? 0) || undefined;
const concurrency = Number(flag("concurrency") ?? 4);
const noJudge = argv.includes("--no-judge");

const norm = (s: string) => normalize(s, "L3");

export interface R2LlmRow {
  kind: "result";
  model: string;
  utteranceId: string;
  dept: string;
  task: "cleanup" | "question";
  ok: boolean;
  error?: string;
  output?: string;
  /** Cleanup: WER against the true reference. */
  wer?: number;
  ceer?: number;
  /** Did the model preserve every number in the passage? */
  numbersKept?: boolean;
  verdict?: Verdict;
  judgeScore?: number;
  latencyMs?: number;
  cached: boolean;
  costUsd: number | null;
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const catalog = await fetchCatalog();
  const corpus = limit ? DEPT_UTTERANCES.slice(0, limit) : DEPT_UTTERANCES;
  // One cleanup task per passage; questions on the number-bearing ones, where a correct
  // answer is checkable against the figures in the text.
  const tasks = models.flatMap((model) => [
    ...corpus.map((u) => ({ model, u, task: "cleanup" as const })),
    ...corpus.filter((u) => u.hasNumbers).map((u) => ({ model, u, task: "question" as const })),
  ]);

  const stamp = Date.now();
  const out = new JsonlWriter(`${BENCH_DIR}/results/r2llm-${stamp}.jsonl`);
  out.write({
    kind: "meta", stage: "round2-llm", promptVersion: PROMPT_VERSION,
    judgeModel: noJudge ? null : JUDGE_MODEL, judgePromptVersion: JUDGE_PROMPT_VERSION,
    models, utterances: corpus.length, startedAt: new Date().toISOString(),
  });

  let done = 0;
  const rows = await runPool(tasks, async ({ model, u, task }): Promise<R2LlmRow> => {
    const nums = u.text.match(/\d+/g) ?? [];
    const prompt = task === "cleanup"
      ? norm(u.text)
      : `${u.text}\n\nΕρώτηση: Ποια είναι τα ποσά και οι αριθμοί που αναφέρονται; Απάντησε σύντομα.`;
    const system = task === "cleanup" ? CLEANUP_SYSTEM : QUESTION_SYSTEM;
    const key = cacheKey(["r2llm", model, PROMPT_VERSION, task, prompt]);
    const hit = readCache<{ text: string; inTok?: number; outTok?: number }>(key);

    let text = hit?.text;
    let inTok = hit?.inTok;
    let outTok = hit?.outTok;
    let latencyMs: number | undefined;
    let error: string | undefined;

    if (!hit) {
      const t0 = Date.now();
      const res = await attempt(() =>
        generateText({ model, system, prompt, temperature: 0, maxRetries: 0 }),
      );
      latencyMs = Date.now() - t0;
      if (res.ok) {
        text = res.value.text.trim();
        inTok = res.value.usage?.inputTokens;
        outTok = res.value.usage?.outputTokens;
        writeCache(key, { text, inTok, outTok });
      } else error = res.error;
    }

    const base = {
      kind: "result" as const, model, utteranceId: u.id, dept: u.dept, task,
      cached: Boolean(hit),
    };
    if (text === undefined) {
      process.stdout.write(`\r  ${++done}/${tasks.length}   `);
      return { ...base, ok: false, error, costUsd: null };
    }

    /**
     * Digit preservation.
     *
     * Compared on a digits-only projection, not by substring. A model that rewrites 35000 as
     * "35.000" has added the correct Greek thousands separator — an improvement, not a loss —
     * and a naive `includes` check scored that as digit destruction, which made every model
     * look like it was corrupting amounts. Stripping separators from both sides measures what
     * was actually asked: are the same digits still there, in the same order?
     */
    const digitsOf = (v: string) => (v.replace(/[.,\u00a0\s](?=\d)/g, "").match(/\d+/g) ?? []).join(" ");
    const wantDigits = digitsOf(u.text);
    const numbersKept = wantDigits.length === 0 ? undefined : digitsOf(text) === wantDigits;
    const ent = scoreEntities(u.entities, text);

    let verdict: Verdict | undefined;
    if (!noJudge) {
      const jkey = cacheKey(["judge", JUDGE_MODEL, JUDGE_PROMPT_VERSION, u.id, task, text]);
      const jhit = readCache<Verdict>(jkey);
      if (jhit) verdict = jhit;
      else {
        const jr = await attempt(() => judge({
          task: task === "cleanup"
            ? "Διόρθωσε τόνους και στίξη χωρίς να αλλάξεις λέξεις, αριθμούς ή ακρωνύμια."
            : "Ποια είναι τα ποσά και οι αριθμοί που αναφέρονται στο κείμενο;",
          answer: text!, reference: u.text,
        }));
        if (jr.ok) { verdict = jr.value; writeCache(jkey, verdict); }
      }
    }

    process.stdout.write(`\r  ${++done}/${tasks.length}   `);
    const cost = priceCall(catalog.get(model), { inputTokens: inTok, outputTokens: outTok }, model);
    return {
      ...base, ok: true, output: text,
      wer: task === "cleanup" ? bestWer([u.text], text, "L1").errorRate : undefined,
      ceer: ent.ceer, numbersKept,
      verdict, judgeScore: verdict ? verdictScore(verdict) : undefined,
      latencyMs, costUsd: cost.usd,
    };
  }, { concurrency });

  for (const r of rows) out.write(r);
  console.log("\n");

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const by = new Map<string, R2LlmRow[]>();
  for (const r of rows) {
    if (!by.has(r.model)) by.set(r.model, []);
    by.get(r.model)!.push(r);
  }

  const summary = [...by.entries()].map(([model, rs]) => {
    const g = rs.filter((r) => r.ok);
    const clean = g.filter((r) => r.task === "cleanup");
    const q = g.filter((r) => r.task === "question");
    // Cleanup only: on the question task the model summarises figures, so "every digit
    // preserved" is not the goal and would penalise a correct short answer.
    const numRows = clean.filter((r) => r.numbersKept !== undefined);
    const judged = g.filter((r) => r.verdict);
    const cost = sumCosts(g.map((r) => ({ usd: r.costUsd })));
    return {
      model, failed: rs.length - g.length,
      wer: mean(clean.map((r) => r.wer!)),
      numbers: numRows.length ? numRows.filter((r) => r.numbersKept).length / numRows.length : NaN,
      ceer: mean(g.map((r) => r.ceer!)),
      qCeer: mean(q.map((r) => r.ceer!)),
      judged: judged.length ? mean(judged.map((r) => r.judgeScore!)) : NaN,
      greek: judged.length ? mean(judged.map((r) => r.verdict!.greek_quality)) : NaN,
      p50: latencyStats(g.map((r) => r.latencyMs).filter((n): n is number => n !== undefined)).p50,
      per1k: cost.usd === null ? null : (cost.usd / Math.max(1, g.length)) * 1000,
    };
  }).sort((a, b) => a.wer - b.wer || b.numbers - a.numbers);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("model", 33) + pad("cleanWER", 10) + pad("numsKept", 10) +
    pad("qCEER", 8) + pad("judge", 8) + pad("greek", 7) + pad("p50", 9) + "$/1k");
  console.log("-".repeat(96));
  for (const s of summary) {
    console.log(pad(s.model, 33) + pad(pct(s.wer), 10) + pad(pct(s.numbers), 10) +
      pad(pct(s.qCeer), 8) +
      pad(Number.isFinite(s.judged) ? pct(s.judged) : "-", 8) +
      pad(Number.isFinite(s.greek) ? s.greek.toFixed(2) : "-", 7) +
      pad(Number.isFinite(s.p50) ? Math.round(s.p50) + "ms" : "cached", 9) +
      (s.per1k === null ? "unknown" : "$" + s.per1k.toFixed(3)) +
      (s.failed ? `  (${s.failed} err)` : ""));
  }
  console.log(`\njudge=${JUDGE_MODEL} rubric=${JUDGE_PROMPT_VERSION} temp=0`);
  console.log(`wrote ${BENCH_DIR}/results/r2llm-${stamp}.jsonl`);
}
