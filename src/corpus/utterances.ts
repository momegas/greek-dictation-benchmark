/**
 * The benchmark corpus: Greek business-language dictation, plus English controls.
 *
 * `text` is the written reference (digits, punctuation, accents) — what a good dictation
 * product should produce. `spoken` is the same utterance with numbers read out in words;
 * a model is scored against whichever it matched, because digit-vs-word is a formatting
 * preference and not a transcription error. Set `spoken` only where it differs.
 *
 * `entities` are the tokens that decide usefulness. `critical: true` ones drive the
 * headline CEER ranking — the ΦΠΑ probe showed plain WER ranks these backwards.
 */
import type { Entity } from "../lib/metrics";

export type Category =
  | "vat_tax"
  | "invoice_amounts"
  | "dates_times"
  | "english_loanwords"
  | "proper_nouns"
  | "code_switching"
  | "long_dictation"
  | "english_control";

export interface Utterance {
  id: string;
  category: Category;
  lang: "el" | "en" | "mixed";
  text: string;
  /** Spoken-numeral variant, when the written form uses digits. */
  spoken?: string;
  /**
   * Further acceptable readings. grok-tts is non-deterministic on loanwords and currency
   * ("45,50 euro" vs "45 euro and 50 lepta"; "project" vs the transliteration), so a clip
   * may legitimately be spoken more than one way and all of them score as correct.
   */
  altRefs?: string[];
  entities: Entity[];
}

/** ΦΠΑ appears constantly; this is its accepted-variant list, reused throughout. */
const FPA: Entity = {
  kind: "term",
  value: "ΦΠΑ",
  accept: ["Φ.Π.Α.", "φπα", "Φ Π Α"],
  critical: true,
};
const AFM: Entity = { kind: "term", value: "ΑΦΜ", accept: ["Α.Φ.Μ.", "αφμ"], critical: true };

export const UTTERANCES: Utterance[] = [
  // --- vat_tax (6) -------------------------------------------------------
  {
    id: "vat-01",
    category: "vat_tax",
    lang: "el",
    text: "Το τιμολόγιο είναι 16,99 συν ΦΠΑ.",
    spoken: "Το τιμολόγιο είναι δεκαέξι κόμμα ενενήντα εννιά συν ΦΠΑ.",
    altRefs: ["Το τιμολόγιο είναι 16 ευρώ και 99 λεπτά συν ΦΠΑ.", "Το τιμολόγιο είναι δεκαέξι ευρώ και ενενήντα εννιά λεπτά συν ΦΠΑ."],
    entities: [FPA, { kind: "currency", value: "16,99", accept: ["16.99"], critical: true }],
  },
  {
    id: "vat-02",
    category: "vat_tax",
    lang: "el",
    text: "Χρειάζομαι το ΑΦΜ και τη ΔΟΥ του πελάτη για το τιμολόγιο.",
    entities: [AFM, { kind: "term", value: "ΔΟΥ", accept: ["Δ.Ο.Υ.", "δου"], critical: true }],
  },
  {
    id: "vat-03",
    category: "vat_tax",
    lang: "el",
    text: "Ο συντελεστής ΦΠΑ είναι 24% για τις υπηρεσίες.",
    spoken: "Ο συντελεστής ΦΠΑ είναι είκοσι τέσσερα τοις εκατό για τις υπηρεσίες.",
    altRefs: ["Ο συντελεστής ΦΠΑ είναι 24 τοις εκατό για τις υπηρεσίες."],
    entities: [FPA, { kind: "number", value: "24%", accept: ["24 %", "24 τοις εκατό"], critical: true }],
  },
  {
    id: "vat-04",
    category: "vat_tax",
    lang: "el",
    text: "Πλήρωσα τις εισφορές στον ΕΦΚΑ τον προηγούμενο μήνα.",
    entities: [{ kind: "term", value: "ΕΦΚΑ", accept: ["Ε.Φ.Κ.Α.", "εφκα"], critical: true }],
  },
  {
    id: "vat-05",
    category: "vat_tax",
    lang: "el",
    text: "Η τιμή περιλαμβάνει ΦΠΑ ή είναι καθαρή αξία;",
    entities: [FPA, { kind: "term", value: "καθαρή αξία", critical: false }],
  },
  {
    id: "vat-06",
    category: "vat_tax",
    lang: "el",
    text: "Στείλε το τιμολόγιο με τον ΑΦΜ 998877665 στο λογιστήριο.",
    spoken:
      "Στείλε το τιμολόγιο με τον ΑΦΜ εννιά εννιά οκτώ οκτώ επτά επτά έξι έξι πέντε στο λογιστήριο.",
    entities: [AFM, { kind: "number", value: "998877665", critical: true }],
  },

  // --- invoice_amounts (6) ----------------------------------------------
  {
    id: "amt-01",
    category: "invoice_amounts",
    lang: "el",
    text: "Το συνολικό ποσό είναι 1.250,00 ευρώ.",
    spoken: "Το συνολικό ποσό είναι χίλια διακόσια πενήντα ευρώ.",
    altRefs: ["Το συνολικό ποσό είναι 1.250 ευρώ.", "Το συνολικό ποσό είναι χίλια διακόσια πενήντα ευρώ και μηδέν λεπτά."],
    entities: [{ kind: "currency", value: "1.250,00", accept: ["1250,00", "1250.00", "1.250"], critical: true }],
  },
  {
    id: "amt-02",
    category: "invoice_amounts",
    lang: "el",
    text: "Η προκαταβολή είναι 30% του συνολικού κόστους.",
    spoken: "Η προκαταβολή είναι τριάντα τοις εκατό του συνολικού κόστους.",
    altRefs: ["Η προκαταβολή είναι 30 τοις εκατό του συνολικού κόστους."],
    entities: [
      { kind: "term", value: "προκαταβολή", critical: true },
      { kind: "number", value: "30%", accept: ["30 %", "30 τοις εκατό"], critical: true },
    ],
  },
  {
    id: "amt-03",
    category: "invoice_amounts",
    lang: "el",
    text: "Πλήρωσε 45,50 ευρώ για τα μεταφορικά.",
    // grok-tts reads currency the natural Greek way: "X euro and Y lepta".
    spoken: "Πλήρωσε σαράντα πέντε ευρώ και πενήντα λεπτά για τα μεταφορικά.",
    altRefs: ["Πλήρωσε 45 ευρώ και 50 λεπτά για τα μεταφορικά."],
    entities: [{ kind: "currency", value: "45,50", accept: ["45.50", "45,5"], critical: true }],
  },
  {
    id: "amt-04",
    category: "invoice_amounts",
    lang: "el",
    text: "Ο προϋπολογισμός του έργου ανέβηκε στις 87.400 ευρώ.",
    spoken: "Ο προϋπολογισμός του έργου ανέβηκε στις ογδόντα εφτά χιλιάδες τετρακόσια ευρώ.",
    altRefs: [
      "Ο προϋπολογισμός του έργου ανήλθε στις ογδόντα επτά χιλιάδες τετρακόσια ευρώ.",
      "Ο προϋπολογισμός του έργου ανέβηκε στις 87.400 ευρώ.",
    ],
    entities: [{ kind: "currency", value: "87.400", accept: ["87400", "87,400"], critical: true }],
  },
  {
    id: "amt-05",
    category: "invoice_amounts",
    lang: "el",
    text: "Έχουμε υπόλοιπο 3.120,75 ευρώ στον λογαριασμό.",
    spoken:
      "Έχουμε υπόλοιπο τρία χιλιάδες εκατόν είκοσι ευρώ και εβδομήντα πέντε λεπτά στον λογαριασμό.",
    altRefs: [
      "Έχουμε υπόλοιπο 3.120 ευρώ και 75 λεπτά στον λογαριασμό.",
      "Έχουμε υπόλοιπο τρεις χιλιάδες εκατόν είκοσι ευρώ και εβδομήντα πέντε λεπτά στον λογαριασμό.",
    ],
    entities: [{ kind: "currency", value: "3.120,75", accept: ["3120,75", "3120.75"], critical: true }],
  },
  {
    id: "amt-06",
    category: "invoice_amounts",
    lang: "el",
    text: "Η έκπτωση είναι 12,5% στη λιανική τιμή.",
    spoken: "Η έκπτωση είναι δώδεκα κόμμα πέντε τοις εκατό στη λιανική τιμή.",
    altRefs: ["Η έκπτωση είναι 12,5 τοις εκατό στη λιανική τιμή."],
    entities: [{ kind: "number", value: "12,5%", accept: ["12.5%", "12,5 %"], critical: true }],
  },

  // --- dates_times (5) --------------------------------------------------
  {
    id: "date-01",
    category: "dates_times",
    lang: "el",
    text: "Η προθεσμία είναι η Παρασκευή στις 5 το απόγευμα.",
    spoken: "Η προθεσμία είναι η Παρασκευή στις πέντε το απόγευμα.",
    entities: [{ kind: "date", value: "Παρασκευή", critical: true }],
  },
  {
    id: "date-02",
    category: "dates_times",
    lang: "el",
    text: "Θα στείλω την προσφορά μέχρι τις 15 Μαρτίου.",
    spoken: "Θα στείλω την προσφορά μέχρι τις δεκαπέντε Μαρτίου.",
    entities: [{ kind: "date", value: "Μαρτίου", accept: ["Μάρτιος", "Μάρτιο"], critical: true }],
  },
  {
    id: "date-03",
    category: "dates_times",
    lang: "el",
    text: "Το ραντεβού μετατέθηκε για την Τρίτη 3 Νοεμβρίου.",
    spoken: "Το ραντεβού μετατέθηκε για την Τρίτη τρεις Νοεμβρίου.",
    entities: [
      { kind: "date", value: "Τρίτη", critical: true },
      { kind: "date", value: "Νοεμβρίου", accept: ["Νοέμβριος"], critical: true },
    ],
  },
  {
    id: "date-04",
    category: "dates_times",
    lang: "el",
    text: "Κάθε Δευτέρα και Πέμπτη έχουμε σύσκεψη στις 10:30.",
    spoken: "Κάθε Δευτέρα και Πέμπτη έχουμε σύσκεψη στις δέκα και μισή.",
    altRefs: ["Κάθε Δευτέρα και Πέμπτη έχουμε σύσκεψη στις 10:30.", "Κάθε Δευτέρα και Πέμπτη έχουμε σύσκεψη στις δέκα και τριάντα."],
    entities: [
      { kind: "date", value: "Δευτέρα", critical: true },
      { kind: "date", value: "Πέμπτη", critical: true },
    ],
  },
  {
    id: "date-05",
    category: "dates_times",
    lang: "el",
    text: "Η πληρωμή γίνεται στο τέλος του Ιανουαρίου.",
    entities: [{ kind: "date", value: "Ιανουαρίου", accept: ["Ιανουάριος"], critical: true }],
  },

  // --- english_loanwords (6) -------------------------------------------
  {
    id: "loan-01",
    category: "english_loanwords",
    lang: "mixed",
    // grok-tts is non-deterministic here: it has rendered this loanword both as "project"
    // and as "\u03c0\u03c1\u03cc\u03c4\u03b6\u03b5\u03ba\u03c4" across runs, so both readings are acceptable references.
    text: "Το deadline για το project είναι η Παρασκευή.",
    spoken: "Το deadline για το πρότζεκτ είναι η Παρασκευή.",
    entities: [
      { kind: "loanword", value: "deadline", accept: ["ντεντλάιν"], critical: true },
      { kind: "loanword", value: "project", accept: ["πρότζεκτ"], critical: true },
      { kind: "date", value: "Παρασκευή", critical: true },
    ],
  },
  {
    id: "loan-02",
    category: "english_loanwords",
    lang: "mixed",
    text: "Έχουμε meeting με τον πελάτη στις 11.",
    // grok-tts transliterates the loanword; both spellings are accepted below.
    spoken: "Έχουμε μίτινγκ με τον πελάτη στις έντεκα.",
    altRefs: ["Έχουμε meeting με τον πελάτη στις έντεκα.", "Έχουμε μίτινγκ με τον πελάτη στις 11."],
    entities: [{ kind: "loanword", value: "meeting", accept: ["μίτινγκ"], critical: true }],
  },
  {
    id: "loan-03",
    category: "english_loanwords",
    lang: "mixed",
    // The original ("...to report prin to review.") was read as English end-to-end by
    // grok-tts. More Greek scaffolding keeps the voice in Greek.
    text: "Στείλε μου το report πριν από τη σύσκεψη για να το δει ο διευθυντής.",
    entities: [
      { kind: "loanword", value: "report", accept: ["ριπόρτ"], critical: true },
      { kind: "term", value: "διευθυντής", critical: true },
    ],
  },
  {
    id: "loan-04",
    category: "english_loanwords",
    lang: "mixed",
    text: "Το budget του τμήματος δεν καλύπτει το νέο laptop.",
    spoken: "Το μπάντζετ του τμήματος δεν καλύπτει το νέο λάπτοπ.",
    entities: [
      // Both transliterations occur in the wild ("μπάτζετ"/"μπάντζετ"); accept either.
      { kind: "loanword", value: "budget", accept: ["μπάτζετ", "μπάντζετ"], critical: true },
      { kind: "loanword", value: "laptop", accept: ["λάπτοπ"], critical: true },
    ],
  },
  {
    id: "loan-05",
    category: "english_loanwords",
    lang: "mixed",
    text: "Θα κάνουμε deployment την Τρίτη το βράδυ.",
    entities: [{ kind: "loanword", value: "deployment", accept: ["ντιπλόιμεντ"], critical: true }],
  },
  {
    id: "loan-06",
    category: "english_loanwords",
    lang: "mixed",
    text: "Το feedback από το marketing ήταν θετικό.",
    spoken: "Το feedback από το μάρκετινγκ ήταν θετικό.",
    entities: [
      { kind: "loanword", value: "feedback", accept: ["φίντμπακ"], critical: true },
      { kind: "loanword", value: "marketing", accept: ["μάρκετινγκ"], critical: true },
    ],
  },

  // --- proper_nouns (4) -------------------------------------------------
  {
    id: "noun-01",
    category: "proper_nouns",
    lang: "el",
    text: "Ο κύριος Παπαδόπουλος θα υπογράψει τη σύμβαση.",
    entities: [{ kind: "proper_noun", value: "Παπαδόπουλος", critical: true }],
  },
  {
    id: "noun-02",
    category: "proper_nouns",
    lang: "mixed",
    text: "Η Squaredev ανέλαβε το έργο στη Θεσσαλονίκη.",
    entities: [
      { kind: "proper_noun", value: "Squaredev", accept: ["Σκουέρντεβ"], critical: true },
      { kind: "proper_noun", value: "Θεσσαλονίκη", critical: true },
    ],
  },
  {
    id: "noun-03",
    category: "proper_nouns",
    lang: "el",
    text: "Στείλε το συμβόλαιο στην κυρία Οικονόμου στην Καλλιθέα.",
    entities: [
      { kind: "proper_noun", value: "Οικονόμου", critical: true },
      { kind: "proper_noun", value: "Καλλιθέα", critical: true },
    ],
  },
  {
    id: "noun-04",
    category: "proper_nouns",
    lang: "el",
    text: "Η συνάντηση θα γίνει στα γραφεία μας στον Πειραιά.",
    entities: [{ kind: "proper_noun", value: "Πειραιά", accept: ["Πειραιάς"], critical: true }],
  },

  // --- code_switching (5) ----------------------------------------------
  {
    id: "cs-01",
    category: "code_switching",
    lang: "mixed",
    text: "Έστειλα το invoice, θα κάνουμε follow up την επόμενη εβδομάδα.",
    entities: [
      { kind: "loanword", value: "invoice", accept: ["ινβόις"], critical: true },
      { kind: "loanword", value: "follow up", accept: ["follow-up", "φόλοου απ"], critical: true },
    ],
  },
  {
    id: "cs-02",
    category: "code_switching",
    lang: "mixed",
    text: "Ο πελάτης ζήτησε discount, αλλά το περιθώριο είναι πολύ μικρό.",
    // grok-tts transliterates the loanword; the entity accepts both spellings.
    spoken: "Ο πελάτης ζήτησε ντισκάουντ, αλλά το περιθώριο είναι πολύ μικρό.",
    entities: [{ kind: "loanword", value: "discount", accept: ["ντισκάουντ"], critical: true }],
  },
  {
    id: "cs-03",
    category: "code_switching",
    lang: "mixed",
    // A full English clause gets translated by grok-tts, so this uses embedded English
    // terms instead — which is what real Greek business code-switching sounds like anyway.
    text: "Κάνε confirm το order και στείλε μου το τιμολόγιο.",
    entities: [
      { kind: "term", value: "τιμολόγιο", critical: true },
      { kind: "loanword", value: "order", accept: ["όρντερ"], critical: true },
    ],
  },
  {
    id: "cs-04",
    category: "code_switching",
    lang: "mixed",
    text: "Το cash flow του τριμήνου δεν είναι καλό.",
    entities: [{ kind: "loanword", value: "cash flow", accept: ["cashflow", "κας φλόου"], critical: true }],
  },
  {
    id: "cs-05",
    category: "code_switching",
    lang: "mixed",
    text: "Θα κάνω forward το email στον λογιστή μας.",
    entities: [
      { kind: "loanword", value: "forward", accept: ["φόργουορντ"], critical: true },
      { kind: "loanword", value: "email", accept: ["ιμέιλ", "e-mail"], critical: true },
    ],
  },

  // --- long_dictation (4) ----------------------------------------------
  {
    id: "long-01",
    category: "long_dictation",
    lang: "el",
    text:
      "Καλημέρα σας. Σχετικά με την προσφορά που στείλατε, θα ήθελα να διευκρινίσω " +
      "δύο σημεία. Πρώτον, το ΦΠΑ περιλαμβάνεται στην τιμή; Δεύτερον, ποιος είναι " +
      "ο χρόνος παράδοσης;",
    entities: [FPA, { kind: "term", value: "χρόνος παράδοσης", critical: false }],
  },
  {
    id: "long-02",
    category: "long_dictation",
    lang: "el",
    text:
      "Μετά τη συνάντηση με τον πελάτη, συμφωνήσαμε να αναθεωρήσουμε το χρονοδιάγραμμα. " +
      "Η πρώτη φάση ολοκληρώνεται τον Απρίλιο και η δεύτερη τον Ιούνιο. " +
      "Το συνολικό κόστος παραμένει στις 42.000 ευρώ.",
    spoken:
      "Μετά τη συνάντηση με τον πελάτη, συμφωνήσαμε να αναθεωρήσουμε το χρονοδιάγραμμα. " +
      "Η πρώτη φάση ολοκληρώνεται τον Απρίλιο και η δεύτερη τον Ιούνιο. " +
      "Το συνολικό κόστος παραμένει στις σαράντα δύο χιλιάδες ευρώ.",
    entities: [
      { kind: "currency", value: "42.000", accept: ["42000", "42,000"], critical: true },
      { kind: "date", value: "Απρίλιο", accept: ["Απρίλιος", "Απριλίου"], critical: true },
    ],
  },
  {
    id: "long-03",
    category: "long_dictation",
    lang: "mixed",
    text:
      "Ομάδα, μια σύντομη ενημέρωση. Το deployment προγραμματίστηκε για την Πέμπτη. " +
      "Παρακαλώ ελέγξτε τα tickets σας και κλείστε ό,τι έχει μείνει ανοιχτό. " +
      "Αν υπάρχει θέμα, στείλτε μου μήνυμα.",
    entities: [
      { kind: "loanword", value: "deployment", accept: ["ντιπλόιμεντ"], critical: true },
      { kind: "date", value: "Πέμπτη", critical: true },
    ],
  },
  {
    id: "long-04",
    category: "long_dictation",
    lang: "el",
    text:
      "Το λογιστήριο ζήτησε τα παραστατικά του προηγούμενου τριμήνου. " +
      "Χρειάζονται τα τιμολόγια, οι αποδείξεις και τα έξοδα ταξιδιού. " +
      "Θα τα ετοιμάσω μέχρι την Παρασκευή και θα τα στείλω με email.",
    entities: [
      { kind: "term", value: "παραστατικά", critical: true },
      { kind: "date", value: "Παρασκευή", critical: true },
    ],
  },

  // --- english_control (4) ---------------------------------------------
  // Isolates models that translate instead of transcribing: that is a config
  // problem, and it would otherwise look like a catastrophic WER failure.
  {
    id: "en-01",
    category: "english_control",
    lang: "en",
    text: "Please send the invoice to the accounting department by Friday.",
    entities: [
      { kind: "term", value: "invoice", critical: true },
      { kind: "date", value: "Friday", critical: true },
    ],
  },
  {
    id: "en-02",
    category: "english_control",
    lang: "en",
    text: "The total amount is 16.99 plus VAT.",
    spoken: "The total amount is sixteen point ninety nine plus VAT.",
    entities: [
      { kind: "term", value: "VAT", accept: ["V.A.T."], critical: true },
      { kind: "currency", value: "16.99", critical: true },
    ],
  },
  {
    id: "en-03",
    category: "english_control",
    lang: "en",
    text: "We need to review the budget before the next quarter.",
    entities: [{ kind: "term", value: "budget", critical: true }],
  },
  {
    id: "en-04",
    category: "english_control",
    lang: "en",
    text: "The deadline for the project deliverables is next Tuesday.",
    entities: [
      { kind: "term", value: "deadline", critical: true },
      { kind: "date", value: "Tuesday", critical: true },
    ],
  },
];

/** All acceptable references for an utterance: written form plus spoken-numeral form. */
export function referencesFor(u: Utterance): string[] {
  return [u.text, ...(u.spoken ? [u.spoken] : []), ...(u.altRefs ?? [])];
}

export const BY_CATEGORY = UTTERANCES.reduce<Record<string, Utterance[]>>((acc, u) => {
  (acc[u.category] ??= []).push(u);
  return acc;
}, {});
