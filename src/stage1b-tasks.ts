/**
 * Stage 1b: can these models *work* in Greek, not just restore it?
 *
 * Two scores per answer, deliberately kept separate:
 *   - hard checks   — deterministic substring assertions with a known-correct answer.
 *     Fully reproducible; this is the number to trust.
 *   - judge score   — gpt-5.6-terra against a fixed rubric, for the qualities a substring
 *     match cannot see (fluency, whether the answer actually addresses the question).
 *
 * The judge is calibrated against the hard checks in the summary: if a model's judged
 * task_success is high while its hard-check pass rate is low, the judge is being fooled and
 * the judged column should not be trusted. That disagreement is reported, not hidden.
 *
 *   npm run stage1b
 *
 * Flags: --models a,b  --concurrency N  --no-cache  --no-judge
 */
import { generateText } from "ai";

import { TASKS, hardChecks, type Task } from "./corpus/tasks";
import { BENCH_DIR, fetchCatalog, gatewayKey } from "./lib/gateway";
import { cacheKey, readCache, writeCache } from "./lib/cache";
import { normalize } from "./lib/normalize";
import { pct } from "./lib/metrics";
import { fmtUsd, priceCall, sumCosts } from "./lib/pricing";
import { JsonlWriter, attempt, latencyStats, runPool } from "./lib/runner";
import { JUDGE_MODEL, JUDGE_PROMPT_VERSION, judge, verdictScore, type Verdict } from "./lib/judge";
import { CANDIDATES } from "./stage1-text-screen";

export const PROMPT_VERSION = "s1b-v1";

const SYSTEM =
  "Είσαι βοηθός για ελληνικά επιχειρηματικά κείμενα. " +
  "Απαντάς πάντα στα ελληνικά, σύντομα και ακριβώς. " +
  "Αν μια πληροφορία δεν προκύπτει από το κείμενο, το λες ρητά και ΔΕΝ την επινοείς.";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const models = flag("models")?.split(",") ?? CANDIDATES;
const concurrency = Number(flag("concurrency") ?? 4);
const noCache = argv.includes("--no-cache");
const noJudge = argv.includes("--no-judge");

const norm = (s: string) => normalize(s, "L3");

function taskPrompt(t: Task): string {
  return t.context ? `${t.context}\n\n${t.prompt}` : t.prompt;
}

export interface Stage1bRow {
  kind: "result";
  model: string;
  taskId: string;
  taskKind: string;
  ok: boolean;
  error?: string;
  answer?: string;
  expectOk: boolean | null;
  rejectOk: boolean | null;
  verdict?: Verdict;
  judgeScore?: number;
  judgeError?: string;
  latencyMs?: number;
  cached: boolean;
  costUsd: number | null;
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const catalog = await fetchCatalog();
  const tasks = models.flatMap((model) => TASKS.map((t) => ({ model, t })));

  const stamp = Date.now();
  const out = new JsonlWriter(`${BENCH_DIR}/results/stage1b-${stamp}.jsonl`);
  out.write({
    kind: "meta",
    stage: "stage1b",
    promptVersion: PROMPT_VERSION,
    judgeModel: noJudge ? null : JUDGE_MODEL,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    models,
    tasks: TASKS.length,
    startedAt: new Date().toISOString(),
  });

  let done = 0;
  const rows = await runPool(
    tasks,
    async ({ model, t }): Promise<Stage1bRow> => {
      const prompt = taskPrompt(t);
      const key = cacheKey(["stage1b", model, PROMPT_VERSION, prompt]);
      const hit = noCache ? undefined : readCache<{ text: string; inTok?: number; outTok?: number }>(key);

      let text = hit?.text;
      let inTok = hit?.inTok;
      let outTok = hit?.outTok;
      let latencyMs: number | undefined;
      let error: string | undefined;

      if (!hit) {
        const t0 = Date.now();
        const res = await attempt(() =>
          generateText({ model, system: SYSTEM, prompt, temperature: 0, maxRetries: 0 }),
        );
        latencyMs = Date.now() - t0;
        if (res.ok) {
          text = res.value.text.trim();
          inTok = res.value.usage?.inputTokens;
          outTok = res.value.usage?.outputTokens;
          writeCache(key, { text, inTok, outTok });
        } else {
          error = res.error;
        }
      }

      if (text === undefined) {
        process.stdout.write(`\r  ${++done}/${tasks.length}   `);
        return {
          kind: "result", model, taskId: t.id, taskKind: t.kind, ok: false, error,
          expectOk: null, rejectOk: null, cached: false, costUsd: null,
        };
      }

      const { expectOk, rejectOk } = hardChecks(t, text, norm);

      // Judge verdicts are cached on (judge, rubric version, answer) so re-running the
      // sweep does not re-pay for, or re-roll, an already-judged answer.
      let verdict: Verdict | undefined;
      let judgeError: string | undefined;
      if (!noJudge) {
        const jkey = cacheKey(["judge", JUDGE_MODEL, JUDGE_PROMPT_VERSION, t.id, text]);
        const jhit = noCache ? undefined : readCache<Verdict>(jkey);
        if (jhit) {
          verdict = jhit;
        } else {
          const jr = await attempt(() =>
            judge({ task: prompt, answer: text!, reference: t.reference }),
          );
          if (jr.ok) {
            verdict = jr.value;
            writeCache(jkey, verdict);
          } else {
            judgeError = jr.error;
          }
        }
      }

      process.stdout.write(`\r  ${++done}/${tasks.length}   `);
      const cost = priceCall(catalog.get(model), { inputTokens: inTok, outputTokens: outTok }, model);

      return {
        kind: "result", model, taskId: t.id, taskKind: t.kind, ok: true, answer: text,
        expectOk, rejectOk, verdict, judgeScore: verdict ? verdictScore(verdict) : undefined,
        judgeError, latencyMs, cached: Boolean(hit), costUsd: cost.usd,
      };
    },
    { concurrency },
  );

  for (const r of rows) out.write(r);
  console.log("\n");

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const byModel = new Map<string, Stage1bRow[]>();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }

  const summary = [...byModel.entries()].map(([model, rs]) => {
    const good = rs.filter((r) => r.ok);
    const checked = good.filter((r) => r.expectOk !== null || r.rejectOk !== null);
    const passed = checked.filter((r) => r.expectOk !== false && r.rejectOk !== false);
    const traps = good.filter((r) => r.taskKind === "trap");
    const trapsOk = traps.filter((r) => r.rejectOk === true);
    const judged = good.filter((r) => r.verdict);
    const cost = sumCosts(good.map((r) => ({ usd: r.costUsd })));
    return {
      model,
      failed: rs.length - good.length,
      hard: checked.length ? passed.length / checked.length : NaN,
      trap: traps.length ? trapsOk.length / traps.length : NaN,
      greek: judged.length ? mean(judged.map((r) => r.verdict!.greek_quality)) : NaN,
      task: judged.length ? mean(judged.map((r) => r.verdict!.task_success)) : NaN,
      term: judged.length ? mean(judged.map((r) => r.verdict!.terminology)) : NaN,
      judged: judged.length ? mean(judged.map((r) => r.judgeScore!)) : NaN,
      p50: latencyStats(good.map((r) => r.latencyMs).filter((n): n is number => n !== undefined)).p50,
      per1k: cost.usd === null ? null : (cost.usd / Math.max(1, good.length)) * 1000,
    };
  });

  // Rank on the deterministic score, since that is the reproducible one.
  summary.sort((a, b) => b.hard - a.hard || b.judged - a.judged);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad("model", 32) + pad("hard", 8) + pad("traps", 8) + pad("judge", 8) +
      pad("greek", 7) + pad("task", 7) + pad("term", 7) + pad("p50", 9) + "$/1k",
  );
  console.log("-".repeat(100));
  for (const s of summary) {
    console.log(
      pad(s.model, 32) + pad(pct(s.hard), 8) + pad(pct(s.trap), 8) +
        pad(Number.isFinite(s.judged) ? pct(s.judged) : "-", 8) +
        pad(Number.isFinite(s.greek) ? s.greek.toFixed(2) : "-", 7) +
        pad(Number.isFinite(s.task) ? s.task.toFixed(2) : "-", 7) +
        pad(Number.isFinite(s.term) ? s.term.toFixed(2) : "-", 7) +
        pad(Number.isFinite(s.p50) ? `${Math.round(s.p50)}ms` : "cached", 9) +
        (s.per1k === null ? "unknown" : `$${s.per1k.toFixed(3)}`) +
        (s.failed ? `  (${s.failed} err)` : ""),
    );
  }

  // Judge calibration: where the judge and the deterministic checks disagree, say so.
  const drift = summary
    .filter((s) => Number.isFinite(s.judged) && Number.isFinite(s.hard))
    .map((s) => ({ model: s.model, gap: s.judged - s.hard }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 3);
  console.log("\njudge vs hard checks (largest gaps — a big positive gap means the judge is lenient):");
  for (const d of drift) {
    console.log(`  ${d.model.padEnd(32)} ${d.gap > 0 ? "+" : ""}${pct(d.gap)}`);
  }
  console.log(`\njudge=${JUDGE_MODEL} rubric=${JUDGE_PROMPT_VERSION} temp=0`);
  console.log(`wrote ${BENCH_DIR}/results/stage1b-${stamp}.jsonl`);
}
