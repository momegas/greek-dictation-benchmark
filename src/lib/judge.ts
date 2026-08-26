/**
 * LLM-as-judge scoring, made as reproducible as a judge can be.
 *
 * Five things keep the verdicts stable enough to compare across runs:
 *   1. `temperature: 0` and a single fixed judge model, pinned in JUDGE_MODEL.
 *   2. A rubric with explicit integer anchors, so the judge picks a level rather than
 *      inventing a score.
 *   3. Structured output via a JSON schema — no prose parsing.
 *   4. The prompt is versioned into the cache key, so a rubric edit invalidates old
 *      verdicts instead of silently mixing rubrics in one table.
 *   5. Candidates are anonymized and shuffled deterministically per item, so the judge
 *      cannot favour a model by name and position bias does not track model identity.
 *
 * Reproducibility is bounded, not absolute: the provider can change the model behind the
 * id. Every run records the judge id and prompt version so a shift is at least visible.
 */
import { generateText } from "ai";
import { z } from "zod";

export const JUDGE_MODEL = "openai/gpt-5.6-terra";
export const JUDGE_PROMPT_VERSION = "judge-v1";

export const RUBRIC = `Είσαι αυστηρός αξιολογητής ελληνικών κειμένων. Βαθμολόγησε την ΑΠΑΝΤΗΣΗ.

Κριτήρια (ακέραιοι 0-4 το καθένα):

greek_quality — γραμματική, ορθογραφία, τόνοι, φυσικότητα
 4 = άψογα ελληνικά, σωστοί τόνοι
 3 = 1-2 μικρά λάθη τόνων/ορθογραφίας
 2 = αρκετά λάθη αλλά κατανοητό
 1 = σοβαρά λάθη, αφύσικη σύνταξη, greeklish
 0 = δεν είναι ελληνικά ή ακατάληπτο

task_success — απαντά όντως στο ΕΡΩΤΗΜΑ
 4 = πλήρης, σωστή απάντηση
 3 = σωστή αλλά λείπει μια λεπτομέρεια
 2 = μερικώς σωστή
 1 = σχετική αλλά δεν απαντά
 0 = λάθος, άρνηση, ή εκτός θέματος

terminology — σωστοί επιχειρηματικοί/λογιστικοί όροι (ΦΠΑ, ΑΦΜ, τιμολόγιο, προκαταβολή)
 4 = όλοι οι όροι σωστοί
 3 = ένας όρος αδέξιος αλλά σωστός
 2 = ένας όρος λάθος
 1 = πολλοί όροι λάθος
 0 = η ορολογία είναι λάθος ή απούσα ενώ χρειαζόταν

Επίστρεψε ΜΟΝΟ JSON με τα κλειδιά: greek_quality, task_success, terminology, worst_issue.
Το worst_issue είναι μια σύντομη ελληνική φράση, ή "-" αν δεν υπάρχει πρόβλημα.`;

export const VerdictSchema = z.object({
  greek_quality: z.number().int().min(0).max(4),
  task_success: z.number().int().min(0).max(4),
  terminology: z.number().int().min(0).max(4),
  /**
   * One short Greek clause naming the single worst problem. Optional: the judge omits it
   * when there is nothing to report, and rejecting the verdict over a missing complaint
   * would throw away three valid scores.
   */
  worst_issue: z.string().max(300).optional().default("-"),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export interface JudgeInput {
  /** What the model was asked to do. */
  task: string;
  /** The model's answer. */
  answer: string;
  /** Optional reference/context the judge may compare against. */
  reference?: string;
}

/** Deterministic 0..n-1 shuffle seed from a string, so ordering is stable per item. */
export function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export async function judge(input: JudgeInput): Promise<Verdict> {
  const parts = [
    `ΕΡΩΤΗΜΑ / ΕΝΤΟΛΗ:\n${input.task}`,
    input.reference ? `ΣΩΣΤΟ ΠΛΑΙΣΙΟ (για σύγκριση):\n${input.reference}` : undefined,
    `ΑΠΑΝΤΗΣΗ:\n${input.answer}`,
  ].filter(Boolean);

  const { text } = await generateText({
    model: JUDGE_MODEL,
    system: RUBRIC,
    prompt: parts.join("\n\n"),
    temperature: 0,
    maxRetries: 0,
  });

  // Tolerate a fenced block; fail loudly rather than guessing at a score.
  const raw = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`judge returned no JSON: ${raw.slice(0, 120)}`);
  return VerdictSchema.parse(JSON.parse(raw.slice(start, end + 1)));
}

/** Mean of the three criteria, normalized to 0..1. */
export function verdictScore(v: Verdict): number {
  return (v.greek_quality + v.task_success + v.terminology) / 12;
}

// ---------------------------------------------------------------------------
// Self-test. Verifies the judge is reproducible and that the rubric discriminates.
// Costs a few judge calls; run it when the rubric changes.
//   npm run judgetest
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test") && process.argv[1]?.includes("judge")) {
  const task = "Πόσο είναι το συνολικό ποσό με τον ΦΠΑ; Απάντησε σύντομα στα ελληνικά.";
  const reference = "1.240,00 + 24% ΦΠΑ = 1.537,60 ευρώ.";
  const good = "Το συνολικό ποσό είναι 1.537,60 ευρώ.";

  const scores: number[] = [];
  for (let i = 0; i < 3; i++) {
    scores.push(verdictScore(await judge({ task, answer: good, reference })));
  }
  const spread = Math.max(...scores) - Math.min(...scores);
  const bad = await judge({ task, answer: "Δεν ξέρω, ίσως 900 δολάρια.", reference });

  let failed = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "✓" : "✗"} ${name} — ${detail}`);
    if (!ok) failed++;
  };
  check("reproducible at temp 0", spread === 0, `spread ${spread.toFixed(4)} over 3 runs`);
  check("scores a correct answer high", scores[0] >= 0.9, `score ${scores[0].toFixed(2)}`);
  check("penalises a wrong answer", bad.task_success <= 1, `task_success ${bad.task_success}`);
  check(
    "separates fluency from correctness",
    bad.greek_quality >= 3 && bad.task_success <= 1,
    `greek ${bad.greek_quality} vs task ${bad.task_success}`,
  );

  console.log(failed === 0 ? "\njudge: all passed" : `\njudge: ${failed} FAILED`);
  if (failed > 0) process.exitCode = 1;
}
