/**
 * Greek text normalization for dictation scoring.
 *
 * A ladder of pure string->string steps. Each level is reported separately in the
 * benchmark, because a single "normalized WER" hides *why* a model lost: an accent-only
 * miss and a mangled tax acronym are not the same failure.
 *
 *   npm run selftest
 */

/** Combining marks (tonos, dialytika) left behind by NFD decomposition. */
const COMBINING = /[\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff]/g;
/** Zero-width and bidi controls some providers emit. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00ad]/g;
const QUOTES = /[\u2018\u2019\u201a\u201b\u2032\u00b4`]/g;
const DQUOTES = /[\u201c\u201d\u201e\u2033\u00ab\u00bb]/g;
/** Greek + Latin punctuation, including the Greek ano teleia and erotimatiko. */
const PUNCT = /[.,;:!?\u00b7\u0387\u037e\u2026\u2013\u2014\-_()[\]{}"'\/\\|<>@#$%^&*+=~]/g;

export type Level = "L0" | "L1" | "L2" | "L3" | "L4";

/** L1: encoding noise only. Never skip this — providers differ arbitrarily here. */
export function l1Unicode(s: string): string {
  return s
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(QUOTES, "'")
    .replace(DQUOTES, '"')
    // Final sigma is a positional variant, not a transcription choice.
    .replace(/ς/g, "σ")
    .replace(/\s+/g, " ")
    .trim();
}

/** L2: punctuation and casing are the LLM stage's job, not the STT's. */
export function l2Punct(s: string): string {
  // Lowercase before anything accent-related: Greek 'Ά' lowercases to 'ά'.
  return l1Unicode(s).toLowerCase().replace(PUNCT, " ").replace(/\s+/g, " ").trim();
}

/**
 * L3: strip tonos/dialytika.
 *
 * Decompose-then-strip rather than a char map, because providers emit both NFC and NFD
 * forms and a hand-written 'ά'->'α' table silently misses the decomposed ones.
 */
export function l3Accent(s: string): string {
  return l2Punct(s).normalize("NFD").replace(COMBINING, "").normalize("NFC");
}

/**
 * Canonicalize number formatting: "1.250,00" -> "1250.00".
 *
 * Must run BEFORE punctuation stripping, or the separators it needs are already gone —
 * the self-test caught exactly that ordering bug.
 *
 * Deliberately does NOT convert Greek number words to digits: that needs a parser for
 * inflected numerals ("\u03b4\u03cd\u03bf \u03c7\u03b9\u03bb\u03b9\u03ac\u03b4\u03b5\u03c2"/"\u03b4\u03b9\u03c3\u03c7\u03af\u03bb\u03b9\u03b1") whose own bugs would land in the
 * measurement. The corpus carries a spoken-form reference for that instead.
 */
function foldNumbers(s: string): string {
  return s
    .replace(/(\d)\.(?=\d{3}\b)/g, "$1")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\u20ac/g, " euro ");
}

/** L4: L3 plus number-format canonicalization. */
export function l4Numeral(s: string): string {
  // Fold numbers on the L1 form, then re-apply the L2/L3 steps that follow.
  const folded = foldNumbers(l1Unicode(s));
  return folded
    .toLowerCase()
    .replace(/(\d)[.](\d)/g, "$1\u0000$2")   // shield decimal points from PUNCT
    .replace(PUNCT, " ")
    .replace(/\u0000/g, ".")
    .normalize("NFD")
    .replace(COMBINING, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => splitCompound(w) ?? w)
    .join(" ");
}


/**
 * Greek number words to digits.
 *
 * Round one avoided this deliberately, preferring hand-authored spoken variants: a parser
 * for inflected Greek numerals has its own bugs, and harness error contaminates the
 * measurement. That held for 40 short utterances. At 100 longer clips it stops holding,
 * because grok-tts is non-deterministic on figures — the same clip comes back as "84000",
 * "84 χιλιάδες", or fully spelled out on different runs, so enumerating readings never
 * converges.
 *
 * The scope is deliberately narrow: fold number WORDS to a canonical digit string, applied
 * to BOTH sides before comparison. It does not attempt to compose "τριάντα δύο" into 32; it
 * maps each word to its value and joins, so "τριάντα δύο χιλιάδες" and "32000" both reduce
 * to a comparable token sequence. Imperfect, but symmetric — and symmetry is what keeps it
 * from favouring any engine. Keys are written with a non-final sigma because L1 folds
 * ς to σ before this runs.
 */
const NUM_WORD: Record<string, string> = {
  μηδεν: "0", ενα: "1", μια: "1", μιασ: "1", ενασ: "1", εναν: "1",
  δυο: "2", δυα: "2", τρια: "3", τρεισ: "3", τριων: "3",
  τεσσερα: "4", τεσσερισ: "4", τεσσαρων: "4", πεντε: "5",
  εξι: "6", εφτα: "7", επτα: "7", οκτω: "8", οχτω: "8",
  εννια: "9", εννεα: "9", δεκα: "10", εντεκα: "11", ενδεκα: "11",
  δωδεκα: "12", δεκατρια: "13", δεκατεσσερα: "14", δεκαπεντε: "15",
  δεκαεξι: "16", δεκαεφτα: "17", δεκαεπτα: "17", δεκαοκτω: "18", δεκαοχτω: "18",
  δεκαεννια: "19", εικοσι: "20", τριαντα: "30", σαραντα: "40", σαρανταπεντε: "45",
  πενηντα: "50", εξηντα: "60", εβδομηντα: "70", ογδοντα: "80", ενενηντα: "90",
  εκατο: "100", εκατον: "100", διακοσια: "200", διακοσιεσ: "200", διακοσιουσ: "200",
  τριακοσια: "300", τριακοσιεσ: "300", τετρακοσια: "400", τετρακοσιουσ: "400",
  τετρακοσιεσ: "400", πεντακοσια: "500", πεντακοσιεσ: "500", εξακοσια: "600",
  εφτακοσια: "700", επτακοσια: "700", οκτακοσια: "800", οχτακοσια: "800",
  εννιακοσια: "900", χιλια: "1000", χιλιαδεσ: "1000", χιλιαδων: "1000",
  χιλιεσ: "1000", εκατομμυριο: "1000000", εκατομμυρια: "1000000",
};

/**
 * Greek writes compounds as one word — "ογδοντατεσσερις" (84), "σαρανταπεντε" (45) — so a
 * lookup alone misses them. Split a token into known number words when the whole token is
 * made of them; otherwise leave it alone.
 */
const NUM_KEYS = Object.keys(NUM_WORD).sort((a, b) => b.length - a.length);

function splitCompound(w: string): string | undefined {
  if (NUM_WORD[w]) return NUM_WORD[w];
  const parts: string[] = [];
  let rest = w;
  while (rest.length > 0) {
    const k = NUM_KEYS.find((key) => rest.startsWith(key) && key.length >= 3);
    if (!k) return undefined;
    parts.push(NUM_WORD[k]);
    rest = rest.slice(k.length);
  }
  return parts.length > 1 ? parts.join(" ") : parts[0];
}

/** Canonical numeric form: number words become digits, on both sides of a comparison. */
export function foldNumberWords(s: string): string {
  return s
    .split(" ")
    .map((w) => splitCompound(w) ?? w)
    .join(" ");
}

export const LEVELS: Record<Level, (s: string) => string> = {
  L0: (s) => s,
  L1: l1Unicode,
  L2: l2Punct,
  L3: l3Accent,
  L4: l4Numeral,
};

export function normalize(s: string, level: Level): string {
  return LEVELS[level](s);
}

/** Word tokens for WER. */
export function words(s: string): string[] {
  return s.length === 0 ? [] : s.split(/\s+/).filter(Boolean);
}

/**
 * Grapheme clusters for CER. Intl.Segmenter, not split(""), so a decomposed 'ά' counts
 * as one character instead of inflating CER against its composed form.
 */
const seg = new Intl.Segmenter("el", { granularity: "grapheme" });
export function graphemes(s: string): string[] {
  return [...seg.segment(s)].map((g) => g.segment);
}

// ---------------------------------------------------------------------------
// Self-test. No test framework in this repo, so correctness lives behind a flag.
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test") && process.argv[1]?.includes("normalize")) {
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

  // Final sigma is provider noise, folded at L1.
  eq("L1 folds final sigma", l1Unicode("τέλος"), l1Unicode("\u03c4\u03ad\u03bb\u03bf\u03c3"));
  eq("L1 keeps accents", l1Unicode("ΦΠΑ και τέλος").includes("έ"), true);

  // NFD-encoded accent must equal its NFC form after L1 (the decomposition trap).
  const nfc = "ά";
  const nfd = "ά";
  // Widened to string: TS narrows these to distinct literal types and flags the
  // comparison, but proving they differ before normalization is the point of the test.
  eq("NFD/NFC differ raw", (nfc as string) === (nfd as string), false);
  eq("L1 unifies NFD accent", l1Unicode(nfd), l1Unicode(nfc));

  // Uppercase accent rule: 'Ά' must reach the same L3 form as 'α'.
  eq("L3 Ά == α", l3Accent("Ά"), l3Accent("α"));
  eq("L3 strips tonos", l3Accent("Παρασκευή"), "παρασκευη");
  eq("L3 strips dialytika", l3Accent("προϊόν"), "προιον");

  // L2 removes punctuation and casing.
  eq("L2 drops punctuation", l2Punct("Καλημέρα, ΦΠΑ!"), "καλημέρα φπα");

  // L4 number formatting.
  eq("L4 comma decimal", l4Numeral("16,99"), "16.99");
  eq("L4 thousands sep", l4Numeral("1.250,00"), "1250.00");
  eq("L4 euro sign", l4Numeral("16,99€"), "16.99 euro");

  // Graphemes: decomposed text must not inflate the character count.
  eq("graphemes NFD == NFC length", graphemes(nfd).length, graphemes(nfc).length);
  eq("graphemes counts 1", graphemes(nfd).length, 1);

  // Tokenization edge cases.
  eq("words on empty", words(""), []);
  eq("words collapses space", words("  a   b "), ["a", "b"]);


  // Number-word folding (L4): a spoken figure and its digit form must compare equal.
  eq("L4 folds 'τριαντα δυο χιλιαδες'", l4Numeral("τριάντα δύο χιλιάδες"), "30 2 1000");
  eq("L4 keeps digits", l4Numeral("32000 ευρώ").startsWith("32000"), true);
  eq("L4 folds πενήντα", l4Numeral("πενήντα"), "50");
  eq("L4 symmetric", l4Numeral("δέκα") === l4Numeral("10"), true);
  // Greek compounds are single words: "ογδοντατέσσερις" is 84, "σαρανταπέντε" is 45.
  eq("L4 splits compound 84", l4Numeral("ογδοντατέσσερις"), "80 4");
  // An exact map entry wins over splitting, which is the better answer.
  eq("L4 maps known compound 45", l4Numeral("σαρανταπέντε"), "45");
  eq("L4 leaves real words alone", l4Numeral("μισθοδοσία"), "μισθοδοσια");
  console.log(failed === 0 ? "\nnormalize: all passed" : `\nnormalize: ${failed} FAILED`);
  if (failed > 0) process.exitCode = 1;
}
