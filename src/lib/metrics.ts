/**
 * WER/CER and entity accuracy for the dictation benchmark.
 *
 * Implemented directly rather than via a package: off-the-shelf WER libraries assume
 * English tokenization and expose only a distance, but the substitution list (which word
 * became which) is the most diagnostic output we have.
 *
 *   npm run selftest
 */
import { type Level, graphemes, normalize, words } from "./normalize";

export type Op = "ok" | "sub" | "ins" | "del";

export interface AlignStep {
  op: Op;
  ref?: string;
  hyp?: string;
}

export interface Alignment {
  hits: number;
  sub: number;
  ins: number;
  del: number;
  steps: AlignStep[];
  /** Reference length; the denominator for the error rate. */
  refLen: number;
  errorRate: number;
}

/** Levenshtein alignment with backtrace, over any token array. */
export function align(ref: string[], hyp: string[]): Alignment {
  const R = ref.length;
  const H = hyp.length;
  const d: number[][] = Array.from({ length: R + 1 }, () => new Array<number>(H + 1).fill(0));

  for (let i = 0; i <= R; i++) d[i][0] = i;
  for (let j = 0; j <= H; j++) d[0][j] = j;

  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= H; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }

  const steps: AlignStep[] = [];
  let hits = 0;
  let sub = 0;
  let ins = 0;
  let del = 0;
  let i = R;
  let j = H;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      if (d[i][j] === d[i - 1][j - 1] + cost) {
        if (cost === 0) {
          hits++;
          steps.push({ op: "ok", ref: ref[i - 1], hyp: hyp[j - 1] });
        } else {
          sub++;
          steps.push({ op: "sub", ref: ref[i - 1], hyp: hyp[j - 1] });
        }
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      del++;
      steps.push({ op: "del", ref: ref[i - 1] });
      i--;
      continue;
    }
    ins++;
    steps.push({ op: "ins", hyp: hyp[j - 1] });
    j--;
  }

  steps.reverse();
  return { hits, sub, ins, del, steps, refLen: R, errorRate: R === 0 ? (H === 0 ? 0 : 1) : (sub + ins + del) / R };
}

/** Word error rate at a normalization level. */
export function wer(ref: string, hyp: string, level: Level = "L1"): Alignment {
  return align(words(normalize(ref, level)), words(normalize(hyp, level)));
}

/** Character error rate, over grapheme clusters. */
export function cer(ref: string, hyp: string, level: Level = "L1"): Alignment {
  return align(graphemes(normalize(ref, level)), graphemes(normalize(hyp, level)));
}

/**
 * Best WER across several acceptable references.
 *
 * A digit/spoken-form mismatch ("16,99" vs the words) is a formatting choice, not an
 * error, so the corpus supplies both and the model is scored against whichever it matched.
 */
export function bestWer(refs: string[], hyp: string, level: Level = "L1"): Alignment {
  let best = wer(refs[0], hyp, level);
  for (const r of refs.slice(1)) {
    const a = wer(r, hyp, level);
    if (a.errorRate < best.errorRate) best = a;
  }
  return best;
}

export type EntityKind =
  | "term"
  | "number"
  | "date"
  | "currency"
  | "proper_noun"
  | "loanword";

export interface Entity {
  kind: EntityKind;
  value: string;
  /** Orthographic variants that are genuinely acceptable. */
  accept?: string[];
  /** Must-get-right: drives the headline CEER ranking. */
  critical?: boolean;
}

export interface EntityHit {
  entity: Entity;
  found: boolean;
  matched?: string;
}

/**
 * Presence-based entity scoring.
 *
 * Presence, not positional alignment: a model that rewords around an entity has not made
 * an entity error, and positional matching would punish it spuriously.
 *
 * `spokenForms` carries the utterance's alternate readings (spoken-numeral variants). An
 * entity that is absent as digits but whose whole utterance was transcribed in spoken form
 * is a formatting choice, not a miss — exactly the case WER already handles via dual
 * references, and without this the most accurate STT model scored 75% CEER on amounts it
 * had in fact transcribed perfectly.
 */
export function scoreEntities(
  entities: Entity[],
  hyp: string,
  spokenForms: string[] = [],
): { hits: EntityHit[]; eer: number; ceer: number } {
  const hay = normalize(hyp, "L3");
  // An alternate reference that the hypothesis matches closely means the utterance was
  // spoken in that form; entities absent from the written form are then not misses.
  const matchedAlt = spokenForms.find((r) => wer(r, hyp, "L4").errorRate <= 0.15);

  const hits: EntityHit[] = entities.map((e) => {
    for (const cand of [e.value, ...(e.accept ?? [])]) {
      const needle = normalize(cand, "L3");
      if (needle.length > 0 && hay.includes(needle)) {
        return { entity: e, found: true, matched: cand };
      }
    }
    // Numeric/currency entities are credited when the utterance itself was rendered in a
    // spoken form that the hypothesis matched. Non-numeric entities (\u03a6\u03a0\u0391, names) are not:
    // those must appear literally, which is the whole point of the metric.
    const numeric = e.kind === "number" || e.kind === "currency";
    if (numeric && matchedAlt !== undefined) {
      return { entity: e, found: true, matched: "spoken-form" };
    }
    return { entity: e, found: false };
  });

  const miss = hits.filter((h) => !h.found).length;
  const crit = hits.filter((h) => h.entity.critical);
  const critMiss = crit.filter((h) => !h.found).length;

  return {
    hits,
    eer: entities.length === 0 ? 0 : miss / entities.length,
    ceer: crit.length === 0 ? 0 : critMiss / crit.length,
  };
}

/** Did the model write numbers as digits, words, or both? Reported, not scored. */
const NUM_WORDS = [
  "\u03bc\u03b7\u03b4\u03b5\u03bd", "\u03b5\u03bd\u03b1", "\u03b4\u03c5\u03bf", "\u03c4\u03c1\u03b9\u03b1", "\u03c4\u03b5\u03c3\u03c3\u03b5\u03c1\u03b1", "\u03c0\u03b5\u03bd\u03c4\u03b5", "\u03b5\u03be\u03b9", "\u03b5\u03c6\u03c4\u03b1", "\u03b5\u03c0\u03c4\u03b1",
  "\u03bf\u03ba\u03c4\u03c9", "\u03bf\u03c7\u03c4\u03c9", "\u03b5\u03bd\u03bd\u03b9\u03b1", "\u03b5\u03bd\u03bd\u03b5\u03b1", "\u03b4\u03b5\u03ba\u03b1", "\u03b5\u03b9\u03ba\u03bf\u03c3\u03b9", "\u03c4\u03c1\u03b9\u03b1\u03bd\u03c4\u03b1", "\u03c3\u03b1\u03c1\u03b1\u03bd\u03c4\u03b1",
  "\u03c0\u03b5\u03bd\u03b7\u03bd\u03c4\u03b1", "\u03b5\u03be\u03b7\u03bd\u03c4\u03b1", "\u03b5\u03b2\u03b4\u03bf\u03bc\u03b7\u03bd\u03c4\u03b1", "\u03bf\u03b3\u03b4\u03bf\u03bd\u03c4\u03b1", "\u03b5\u03bd\u03b5\u03bd\u03b7\u03bd\u03c4\u03b1", "\u03b5\u03ba\u03b1\u03c4\u03bf",
  "\u03c7\u03b9\u03bb\u03b9\u03b1", "\u03c7\u03b9\u03bb\u03b9\u03b1\u03b4\u03b5\u03c3", "\u03ba\u03bf\u03bc\u03bc\u03b1",
];

export function numeralFormat(hyp: string): "digits" | "words" | "mixed" | "none" {
  const hasDigits = /\d/.test(hyp);
  // Compare against the L3 form, so the word list must be accent-stripped too.
  const norm = normalize(hyp, "L3");
  const toks = new Set(words(norm));
  const hasWords = NUM_WORDS.some((w) => toks.has(w));
  if (hasDigits && hasWords) return "mixed";
  if (hasDigits) return "digits";
  if (hasWords) return "words";
  return "none";
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test") && process.argv[1]?.includes("metrics")) {
  let failed = 0;
  const eq = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) {
      console.log(`    got  ${JSON.stringify(got)}`);
      console.log(`    want ${JSON.stringify(want)}`);
      failed++;
    }
  };

  // Identical strings.
  eq("identical -> WER 0", wer("καλημέρα κόσμε", "καλημέρα κόσμε").errorRate, 0);

  // Final sigma: L1 folds it, L0 does not.
  const sigmaRef = "τέλος";
  const sigmaHyp = "τέλοσ";
  eq("sigma diff -> L1 WER 0", wer(sigmaRef, sigmaHyp, "L1").errorRate, 0);
  eq("sigma diff -> L0 WER > 0", wer(sigmaRef, sigmaHyp, "L0").errorRate > 0, true);

  // NFD accent must be free at L1.
  eq("NFD accent -> L1 WER 0", wer("άλφα", "άλφα", "L1").errorRate, 0);

  // Uppercase-accent ordering.
  eq("Ά vs α -> L3 WER 0", wer("Ά", "α", "L3").errorRate, 0);

  // Exactly two substitutions, with the right pairs.
  const a = wer("α β γ δ", "α χ γ ψ", "L1");
  eq("2 subs counted", a.sub, 2);
  eq("2 subs, no ins/del", [a.ins, a.del], [0, 0]);
  eq(
    "substitution pairs",
    a.steps.filter((s) => s.op === "sub").map((s) => [s.ref, s.hyp]),
    [["β", "χ"], ["δ", "ψ"]],
  );

  // Insertion and deletion.
  eq("insertion", align(["a"], ["a", "b"]), {
    hits: 1, sub: 0, ins: 1, del: 0,
    steps: [{ op: "ok", ref: "a", hyp: "a" }, { op: "ins", hyp: "b" }],
    refLen: 1, errorRate: 1,
  });
  eq("deletion counts", align(["a", "b"], ["a"]).del, 1);
  eq("empty ref, empty hyp -> 0", align([], []).errorRate, 0);
  eq("empty ref, some hyp -> 1", align([], ["a"]).errorRate, 1);

  // Dual reference: digits vs spoken form is not an error.
  const written = "είναι 16,99 συν ΦΠΑ";
  const spoken = "είναι δεκαέξι κόμμα ενενήντα εννιά συν ΦΠΑ";
  eq("dual ref: digits hyp", bestWer([written, spoken], written).errorRate, 0);
  eq("dual ref: spoken hyp", bestWer([written, spoken], spoken).errorRate, 0);
  eq("dual ref beats single", bestWer([written, spoken], spoken).errorRate < wer(written, spoken).errorRate, true);

  // CER over grapheme clusters must not inflate on NFD input.
  eq("CER NFD == 0", cer("ά", "ά", "L1").errorRate, 0);

  // Entity scoring: the FPA case that motivates the whole metric.
  const ents: Entity[] = [
    { kind: "term", value: "ΦΠΑ", accept: ["Φ.Π.Α."], critical: true },
    { kind: "currency", value: "16,99", accept: ["16.99"], critical: true },
  ];
  const good = scoreEntities(ents, "είναι 16,99 συν ΦΠΑ");
  eq("entities all found", [good.eer, good.ceer], [0, 0]);
  const bad = scoreEntities(ents, "είναι 16,99 συν φίπια");
  eq("FPA miss -> CEER 0.5", bad.ceer, 0.5);
  eq("dotted variant accepted", scoreEntities([ents[0]], "συν Φ.Π.Α. σήμερα").ceer, 0);
  eq("lowercase variant accepted", scoreEntities([ents[0]], "συν φπα").ceer, 0);
  // Rewording around an entity must not be punished.
  eq("reworded but entity present", scoreEntities([ents[0]], "το ΦΠΑ είναι μέσα στην τιμή").ceer, 0);

  // Spoken-form credit for numeric entities: a perfectly transcribed amount read out in
  // words must not count as an entity miss (this scored 75% CEER before the fix).
  const amt: Entity[] = [{ kind: "currency", value: "1.250,00", accept: ["1250,00"], critical: true }];
  const spokenRef = "Το συνολικό ποσό είναι χίλια διακόσια πενήντα ευρώ.";
  eq("digits missing, no alt refs -> miss", scoreEntities(amt, spokenRef).ceer, 1);
  eq("digits missing, alt ref matches -> hit", scoreEntities(amt, spokenRef, [spokenRef]).ceer, 0);
  // But a non-numeric entity still must appear literally.
  eq(
    "spoken form does NOT excuse a term miss",
    scoreEntities([{ kind: "term", value: "ΦΠΑ", critical: true }], spokenRef, [spokenRef]).ceer,
    1,
  );
  // And an unrelated hypothesis gets no credit from an alt reference.
  eq("unrelated hyp -> still miss", scoreEntities(amt, "εντελώς άλλο κείμενο", [spokenRef]).ceer, 1);

  // Numeral format reporting.
  eq("numeralFormat digits", numeralFormat("16,99 ευρώ"), "digits");
  eq("numeralFormat words", numeralFormat("δέκα ευρώ"), "words");

  console.log(failed === 0 ? "\nmetrics: all passed" : `\nmetrics: ${failed} FAILED`);
  if (failed > 0) process.exitCode = 1;
}
