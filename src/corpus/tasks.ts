/**
 * Stage 1b tasks: can these models *work* in Greek, not just repair it?
 *
 * Restoration (Stage 1) only proves a model can copy text back with accents. These tasks
 * require understanding — answering a question, extracting a field, doing arithmetic on an
 * amount, refusing to invent a fact. Three of them are traps with a known correct
 * behaviour, which is what makes an LLM judge auditable: we know what the answer should be.
 */
export type TaskKind = "qa" | "extract" | "arithmetic" | "trap" | "correction";

export interface Task {
  id: string;
  kind: TaskKind;
  /** The instruction given to the model. */
  prompt: string;
  /** Context the model must work from, if any. */
  context?: string;
  /** What a correct answer must contain (normalized substring match, any one of them). */
  expect?: string[];
  /** If present, a correct answer must NOT contain these — the trap. */
  reject?: string[];
  /**
   * Trap tasks: a correct answer must *decline*. Checked by looking for an explicit
   * "not in the text" phrase rather than banning keywords — a correct refusal legitimately
   * names the field it is refusing to supply ("the ΑΦΜ is not mentioned"), so a keyword ban
   * marks right answers wrong. Found that the hard way.
   */
  mustDecline?: boolean;
  /** Shown to the judge as the correct reading. */
  reference: string;
}

export const TASKS: Task[] = [
  // --- comprehension --------------------------------------------------
  {
    id: "qa-01",
    kind: "qa",
    context: "Το τιμολόγιο 4471 είναι 1.240,00 ευρώ συν ΦΠΑ 24% και λήγει στις 15 Μαρτίου.",
    prompt: "Πόσο είναι το συνολικό ποσό με τον ΦΠΑ; Απάντησε σύντομα στα ελληνικά.",
    expect: ["1537", "1.537", "1537,60", "1.537,60"],
    reference: "1.240,00 + 24% ΦΠΑ = 1.537,60 ευρώ.",
  },
  {
    id: "qa-02",
    kind: "qa",
    context: "Ο πελάτης ζήτησε παράταση δύο εβδομάδων. Η αρχική προθεσμία ήταν η Παρασκευή 3 Απριλίου.",
    prompt: "Ποια είναι η νέα προθεσμία; Απάντησε σύντομα στα ελληνικά.",
    expect: ["17 απριλιου", "17 απριλίου", "δεκαεπτά απριλίου"],
    reference: "Η νέα προθεσμία είναι η Παρασκευή 17 Απριλίου.",
  },
  {
    id: "qa-03",
    kind: "qa",
    context:
      "Η εταιρεία έχει τρία τμήματα: πωλήσεις με 12 άτομα, τεχνικό με 8 και λογιστήριο με 3.",
    prompt: "Πόσα άτομα εργάζονται συνολικά; Απάντησε σύντομα στα ελληνικά.",
    expect: ["23", "εικοσι τρια", "είκοσι τρία"],
    reference: "Συνολικά 23 άτομα.",
  },
  // --- field extraction ----------------------------------------------
  {
    id: "ext-01",
    kind: "extract",
    context:
      "Παρακαλώ εκδώστε τιμολόγιο στην ΑΛΦΑ ΕΜΠΟΡΙΚΗ ΑΕ, ΑΦΜ 094512376, ΔΟΥ Καλλιθέας, ποσό 890,50 ευρώ.",
    prompt: "Βγάλε το ΑΦΜ και το ποσό. Απάντησε μόνο με τα δύο πεδία στα ελληνικά.",
    expect: ["094512376"],
    reference: "ΑΦΜ: 094512376, Ποσό: 890,50 ευρώ.",
  },
  {
    id: "ext-02",
    kind: "extract",
    context:
      "Σύσκεψη με τον κύριο Παπαδόπουλο την Τρίτη στις 10:30 στα γραφεία της Squaredev στον Πειραιά.",
    prompt: "Ποιος, πότε και πού; Απάντησε σύντομα στα ελληνικά.",
    expect: ["παπαδοπουλο", "παπαδόπουλο"],
    reference: "Ο κ. Παπαδόπουλος, Τρίτη 10:30, γραφεία Squaredev στον Πειραιά.",
  },
  // --- arithmetic on Greek-formatted amounts --------------------------
  {
    id: "ari-01",
    kind: "arithmetic",
    context: "Καθαρή αξία 2.000,00 ευρώ, ΦΠΑ 24%.",
    prompt: "Πόσο είναι ο ΦΠΑ σε ευρώ; Απάντησε μόνο με το ποσό.",
    expect: ["480"],
    reference: "480,00 ευρώ.",
  },
  {
    id: "ari-02",
    kind: "arithmetic",
    context: "Τρεις δόσεις των 416,50 ευρώ.",
    prompt: "Πόσο είναι το σύνολο; Απάντησε μόνο με το ποσό.",
    expect: ["1249", "1.249", "1249,50", "1.249,50"],
    reference: "1.249,50 ευρώ.",
  },
  // --- traps: the model must decline to invent -------------------------
  {
    id: "trap-01",
    kind: "trap",
    context: "Το τιμολόγιο 4471 είναι 1.240,00 ευρώ συν ΦΠΑ.",
    prompt: "Ποιο είναι το ΑΦΜ του πελάτη; Αν δεν προκύπτει από το κείμενο, πες το ρητά.",
    mustDecline: true,
    // A 9-digit number would be an invented ΑΦΜ.
    reject: ["094512376", "123456789"],
    reference:
      "Το ΑΦΜ δεν αναφέρεται στο κείμενο. Σωστή απάντηση: δήλωση ότι η πληροφορία λείπει.",
  },
  {
    id: "trap-02",
    kind: "trap",
    context: "Η σύσκεψη μετατέθηκε.",
    prompt: "Για ποια μέρα μετατέθηκε; Αν δεν προκύπτει, πες το ρητά.",
    mustDecline: true,
    reject: ["δευτέρα", "τρίτη", "τετάρτη", "πέμπτη", "παρασκευή"],
    reference: "Δεν αναφέρεται νέα μέρα. Σωστή απάντηση: δήλωση ότι η πληροφορία λείπει.",
  },
  // --- correction of a plausible STT error ----------------------------
  {
    id: "cor-01",
    kind: "correction",
    context: "Το τιμολογιο ειναι 16,99 συν φιπια.",
    prompt:
      "Το κείμενο προέρχεται από υπαγόρευση και έχει ένα λάθος αναγνώρισης. Διόρθωσέ το.",
    expect: ["φπα", "φ.π.α"],
    reject: ["φιπια"],
    reference: "«φιπια» είναι λανθασμένη αναγνώριση του «ΦΠΑ».",
  },
  {
    id: "cor-02",
    kind: "correction",
    context: "Στειλε το τιμολογιο στον πελατη μεχρι την παρασκευη το ντεντλαιν ειναι αυστηρο.",
    prompt:
      "Διόρθωσε τόνους και στίξη. Κράτησε τους ξένους όρους σε λατινικούς χαρακτήρες όπου ταιριάζει.",
    expect: ["deadline", "ντεντλάιν"],
    reference:
      "Στείλε το τιμολόγιο στον πελάτη μέχρι την Παρασκευή· το deadline είναι αυστηρό.",
  },
];

/**
 * Phrases a model uses to say "that is not in the text". Matched on the accent-stripped
 * form, so tonos variation does not matter.
 */
const DECLINE_PATTERNS = [
  "δεν προκυπτει", "δεν αναφερεται", "δεν υπαρχει", "δεν δινεται", "δεν περιλαμβανεται",
  "δεν διευκρινιζεται", "δεν προσδιοριζεται", "δεν φαινεται", "λειπει", "απουσιαζει",
  "δεν μπορω να", "δεν γνωριζω", "καμια αναφορα", "δεν καθοριζεται", "δεν αναγραφεται",
];

export function declines(answer: string, norm: (s: string) => string): boolean {
  const hay = norm(answer);
  return DECLINE_PATTERNS.some((p) => hay.includes(norm(p)));
}

/** Deterministic checks that need no judge: the auditable half of the score. */
export function hardChecks(t: Task, answer: string, norm: (s: string) => string): {
  expectOk: boolean | null;
  rejectOk: boolean | null;
} {
  const hay = norm(answer);
  const expectOk = t.expect ? t.expect.some((e) => hay.includes(norm(e))) : null;
  // A trap passes when the model explicitly declines AND invents nothing.
  const noInvention = t.reject ? !t.reject.some((r) => hay.includes(norm(r))) : true;
  const rejectOk = t.mustDecline
    ? declines(answer, norm) && noInvention
    : t.reject
      ? noInvention
      : null;
  return { expectOk, rejectOk };
}
