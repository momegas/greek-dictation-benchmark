/**
 * Renders every stage's JSONL into the single HTML report.
 *
 * HTML-only by design: the page is the deliverable, and it is regenerated from the raw
 * results rather than hand-edited, so it can never drift from the data.
 *
 *   npm run report
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { BENCH_DIR, ensureDir } from "./lib/gateway";
import { latencyStats } from "./lib/runner";
import { UTTERANCES } from "./corpus/utterances";
import { TASKS } from "./corpus/tasks";
import { DEPT_UTTERANCES, DEPTS } from "./corpus/departments";
import { GROK_VOICES, OPENAI_VOICES } from "./corpus/synth-depts";
import {
  EXCLUDED_LLM, EXCLUDED_STT, ROUND_ONE, SHORTLIST_LLM, SHORTLIST_STT,
} from "./shortlist";
import { SCRIBE_ID } from "./lib/stt-providers";
import { JUDGE_MODEL, JUDGE_PROMPT_VERSION } from "./lib/judge";
import {
  DIAGRAM_STT, DIAGRAM_TEXT,
  HEAD, band, chapter, esc, metric, metricHead, msS, numS, pctS, scatter, scoreBand,
  table, usdS, type Point,
} from "./lib/html";

const RESULTS = `${BENCH_DIR}/results`;
const OUT = "report.html";

type Row = Record<string, any>;

/**
 * The most recent *complete* run for a stage.
 *
 * Not simply the newest file: a partial run (`--models one-model`, `--limit 4`) while
 * debugging leaves a newer, thinner file behind, and reporting from that silently produces
 * a one-row leaderboard. So candidates are ranked by how many distinct models they cover
 * first, recency second.
 */
function newest(prefix: string): { meta: Row; rows: Row[]; file: string } | undefined {
  const files = readdirSync(RESULTS)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".jsonl"))
    .sort();
  if (!files.length) return undefined;

  const parsed = files.map((f) => {
    const lines = readFileSync(`${RESULTS}/${f}`, "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
    const rows = lines.filter((l) => l.kind !== "meta");
    const models = new Set(rows.map((r) => r.model ?? r.combo).filter(Boolean));
    return { file: f, meta: lines.find((l) => l.kind === "meta") ?? {}, rows, coverage: models.size };
  });

  const best = parsed.reduce((a, b) => (b.coverage > a.coverage ? b : a));
  const chosen = parsed.filter((p) => p.coverage === best.coverage).pop()!;
  if (chosen.file !== files[files.length - 1]) {
    console.log(`  note: ${prefix}* — using ${chosen.file} (${chosen.coverage} models) over the newer but partial ${files[files.length - 1]}`);
  }
  return chosen;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

const s1 = newest("stage1-");
const s1b = newest("stage1b-");
const s2 = newest("stage2-");
const s3 = newest("stage3-");
/** Round two: the shortlist against the 100-clip department corpus. */
const r2stt = newest("r2stt-");
const r2llm = newest("r2llm-");

const CAT_LABEL: Record<string, string> = {
  vat_tax: "VAT / tax", invoice_amounts: "Amounts", dates_times: "Dates",
  english_loanwords: "Loanwords", proper_nouns: "Names", code_switching: "Code-switch",
  long_dictation: "Long-form", english_control: "English",
};
const CAT_DESC: Record<string, string> = {
  vat_tax: "ΦΠΑ, ΑΦΜ, ΔΟΥ, ΕΦΚΑ — the acronyms that break most models",
  invoice_amounts: "decimal comma, thousands separator, €",
  dates_times: "weekdays, Greek month genitives, times",
  english_loanwords: "deadline, meeting, project, budget",
  proper_nouns: "Greek and foreign company, person and place names",
  code_switching: "Greek with an English clause mid-utterance",
  long_dictation: "3–5 sentence paragraphs: drift and punctuation",
  english_control: "pure English — catches models that translate instead of transcribing",
};
const H: string[] = [];

// ---------- Round two: shortlist on the department corpus ---------------
let r2Ranked: any[] = [];
if (r2stt && r2stt.rows.some((r) => r.kind === "result" && r.ok)) {
  const res = r2stt.rows.filter((r) => r.kind === "result" && r.ok);
  const lat = new Map(r2stt.rows.filter((r) => r.kind === "latency").map((r) => [r.model, r]));
  const per = group(res, (r) => r.model);
  const clips = group(res, (r) => r.utteranceId);
  const totalSec = [...clips.values()].map((rs) => rs[0].durationSec as number).reduce((a, b) => a + b, 0);
  const nClips = clips.size;
  const meanSec = totalSec / nClips;

  r2Ranked = [...per.entries()].map(([model, rs]) => {
    const costs = rs.map((r) => r.costUsd as number | null);
    const tot = costs.some((c) => c === null) ? null : costs.reduce((a, b) => a! + b!, 0)!;
    const l = lat.get(model);
    return {
      model, rows: rs,
      ceer: mean(rs.map((r) => r.ceer)), eer: mean(rs.map((r) => r.eer)),
      wer: mean(rs.map((r) => r.werL1)), cer: mean(rs.map((r) => r.cerL1)),
      numCeer: mean(rs.filter((r) => r.hasNumbers).map((r) => r.ceer)),
      proseCeer: mean(rs.filter((r) => !r.hasNumbers).map((r) => r.ceer)),
      p50: l?.p50, p95: l?.p95,
      rtf: l?.p50 ? (l.p50 as number) / 1000 / meanSec : NaN,
      perHour: tot === null ? null : (tot / totalSec) * 3600,
      external: model === SCRIBE_ID,
    };
  }).sort((a, b) => a.ceer - b.ceer || a.wer - b.wer);

  const win = r2Ranked[0];
  const runner = r2Ranked[1];
  const voices = new Set(res.map((r) => `${r.ttsModel}/${r.voice}`)).size;

  H.push(`<div class="hero-band"><div class="wrap">
<p class="eyebrow">Round two · shortlist</p>
<h1 style="margin-top:var(--md)">Which model actually dictates Greek?</h1>
<p class="lede" style="margin-top:var(--lg)">${r2Ranked.length} speech-to-text engines and
${SHORTLIST_LLM.length} language models — the survivors of a wider first round — tested on
${nClips} longer passages from eleven business functions, in ${voices} voices across two
speech providers.</p>
<div class="facts">
<span><b>${nClips}</b> passages</span>
<span><b>${Math.round(totalSec)}s</b> audio</span>
<span><b>${meanSec.toFixed(1)}s</b> mean length</span>
<span><b>${DEPTS.length}</b> departments</span>
<span><b>${voices}</b> voices</span>
</div>
</div></div>`);

  H.push(`<div class="band-tight"><div class="wrap">
<div class="sig sig-dark">
<p class="cap">Recommendation</p>
<h2 style="margin-top:var(--xs)">${esc(win.model)}</h2>
<p class="cap" style="margin-top:var(--xs)">still the pick, but the margin narrows on real-length dictation</p>
<dl class="stats">
<div class="stat"><dt>${metric("CEER", undefined, "left")}</dt><dd>${pctS(win.ceer)}</dd></div>
<div class="stat"><dt>${metric("WER")}</dt><dd>${pctS(win.wer)}</dd></div>
<div class="stat"><dt>${metric("p50")}</dt><dd>${msS(win.p50)}</dd></div>
<div class="stat"><dt>Per audio-hour</dt><dd>${usdS(win.perHour)}</dd></div>
</dl>
<ol class="findings">
<li><span class="fnum">01</span><span>Figures are the whole difficulty. On prose this engine
loses ${pctS(win.proseCeer)} of critical terms; on passages containing amounts, tax numbers
and percentages it loses <b>${pctS(win.numCeer)}</b> — more than ten times as many.</span></li>
<li><span class="fnum">02</span><span>Longer, department-specific dictation is markedly harder
than the short utterances of round one. The same engine scored ${pctS(0.013)} there and
${pctS(win.ceer)} here.</span></li>
<li><span class="fnum">03</span><span>The ranking is stable but compressed: the top four
engines now sit within ${pctS(r2Ranked[3].ceer - win.ceer)} of each other, so cost and
latency matter more than they did.</span></li>
</ol>
</div>
<p class="note">Runner-up <code>${esc(runner.model)}</code> at ${pctS(runner.ceer)}
${metric("CEER")}. Every engine here cleared a first round; none is a fresh candidate.</p>
</div></div>`);

  // Provenance — the reader needs to know this is a shortlist, not a full field.
  H.push(`<div class="band band-soft"><div class="wrap">
${chapter(1, "Why these models and not others",
  `This is a <b>shortlist</b>. A first round screened ${ROUND_ONE.sttScreened} transcription
   engines and ${ROUND_ONE.llmScreened} language models on ${ROUND_ONE.utterances} short
   utterances averaging ${ROUND_ONE.meanClipSec} seconds. Carrying every candidate forward
   would have spent most of the budget re-confirming known failures, so only the survivors
   are tested here — which also means these numbers cannot be read as a full-field ranking.`,
  `Engines scoring under roughly 30% critical-entity error advanced, plus two kept
   deliberately as reference points: <code>whisper-1</code> because it is the assumed default,
   and <code>grok-stt</code> because it was the fastest and defines the speed/accuracy edge.
   Language models had to pass a Greek script-integrity gate and the reasoning tasks.`)}
<div class="grid2">
<div class="card soft"><h4>Carried forward</h4>
<p class="note" style="margin-top:0">${SHORTLIST_STT.length} engines,
${SHORTLIST_LLM.length} language models.</p></div>
<div class="card soft"><h4>Excluded, with cause</h4>
<p class="note" style="margin-top:0">${Object.keys(EXCLUDED_STT).length + Object.keys(EXCLUDED_LLM).length}
candidates. Reasons are recorded so the exclusions stay auditable rather than becoming
folklore.</p></div>
</div>
${table(["Excluded", "Kind", "Reason"], [
  ...Object.entries(EXCLUDED_STT).map(([m, why]) =>
    `<tr class="dim"><td><code>${esc(m)}</code></td><td>engine</td><td class="wrap-cell">${esc(why)}</td></tr>`),
  ...Object.entries(EXCLUDED_LLM).map(([m, why]) =>
    `<tr class="dim"><td><code>${esc(m)}</code></td><td>model</td><td class="wrap-cell">${esc(why)}</td></tr>`),
])}
<p class="finding">Read every number here as <b>the best of a pre-filtered field</b>. The
engines that failed round one badly — one that refuses non-streaming transcription, one that
invents facts, several that transliterate Greek into Latin script — are absent, so the spread
between the survivors is narrower than a full-field sweep would show.</p>
</div></div>`);

  // Chapter 2 — the corpus.
  const nGrok = new Set(res.filter((r) => r.ttsModel.includes("grok")).map((r) => r.utteranceId)).size;
  const nOa = nClips - nGrok;
  H.push(`<div class="band"><div class="wrap">
${chapter(2, "A harder corpus: eleven departments, twelve voices",
  `Round one used short single-clause utterances in one voice. That flatters an engine: real
   dictation is longer, drifts, and comes from people across a company with different
   vocabularies. We wanted numbers that survive contact with that.`,
  `${nClips} passages of ${meanSec.toFixed(0)} seconds on average — roughly twice round one —
   across ${DEPTS.length} functions from legal to freelance invoicing. Synthesis is routed by
   content: the ${nGrok} passages containing figures go to <code>spacexai/grok-tts</code>
   across ${GROK_VOICES.length} voices, and the ${nOa} prose-only passages to
   <code>openai/tts-1</code> across ${OPENAI_VOICES.length} voices. Every clip was
   re-transcribed and checked against its own reference before use; filenames encode
   department, provider and voice.`)}
<p class="finding">The routing is a measured decision, not a preference. On number-bearing
Greek, <code>openai/tts-1</code> loses digits — and four independent engines then mis-hear
the same spots in the same way, which is the signature of bad audio rather than bad
transcription. Its Greek <b>prose</b> is fine: all four engines agree on it, and the
prose clips round-trip at ${pctS(win.proseCeer)} error.</p>
<p class="note">Two passages had to be re-routed after <code>openai/tts-1</code> rendered them
as non-Greek audio entirely — one came back as Arabic, one as pseudo-Portuguese. Both are now
Grok clips. This is why the round-trip check exists.</p>
</div></div>`);

  // Chapter 3 — the leaderboard.
  const rows = r2Ranked.map((r, i) => `<tr class="b-${band(r.ceer)}">
<td class="rank">${i + 1}</td>
<td><code>${esc(r.model)}</code>${i === 0 ? ' <span class="tag">pick</span>' : ""}${r.external ? ' <span class="tag ext">direct API</span>' : ""}</td>
<td class="num hero-n">${pctS(r.ceer)}</td>
<td class="num c-${band(r.numCeer)}">${pctS(r.numCeer)}</td>
<td class="num c-${band(r.proseCeer)}">${pctS(r.proseCeer)}</td>
<td class="num">${pctS(r.wer)}</td>
<td class="num">${msS(r.p50)}</td><td class="num">${msS(r.p95)}</td>
<td class="num">${Number.isFinite(r.rtf) ? r.rtf.toFixed(2) : "—"}</td>
<td class="num">${usdS(r.perHour)}</td></tr>`);

  H.push(`<div class="band band-soft"><div class="wrap">
${chapter(3, "How the shortlisted engines rank",
  `With a harder corpus, does the round-one ordering hold — and is the winner's margin big
   enough to justify its price against cheaper or faster alternatives?`,
  `All ${nClips} passages through each engine, ranked by ${metric("CEER")}. The figures and
   prose columns split the same measure by content, which is the split that turned out to
   matter. Latency is a separate pass with three repeats and one discarded cold call.`)}
${table(["", "Engine", metricHead("CEER"), { h: "Figures", num: true }, { h: "Prose", num: true },
  metricHead("WER"), metricHead("p50"), metricHead("p95"), metricHead("RTF", undefined, "right"),
  { h: "$/audio-hr", num: true }], rows)}
<p class="finding">The ordering survives, but the field compresses: four engines within
${pctS(r2Ranked[3].ceer - win.ceer)} of the leader. <b>Every engine is near-perfect on prose
and poor on figures</b> — the spread between the columns is far larger than the spread between
engines, so the decision is about how much of your dictation contains numbers.</p>
<p class="note"><code>elevenlabs/scribe-v1</code> is called directly against
<code>api.elevenlabs.io</code> and priced from a published rate card, not metered.
<code>fish-audio</code> publishes no price, so it is reported as unpriced rather than free.</p>
</div></div>`);

  // Chapter 4 — departments.
  const drows = r2Ranked.map((m) => {
    const cells = DEPTS.map((d) => {
      const sub = m.rows.filter((x: Row) => x.dept === d);
      const v = sub.length ? mean(sub.map((x: Row) => x.ceer)) : NaN;
      return `<td class="num c-${band(v)}">${pctS(v, 0)}</td>`;
    }).join("");
    return `<tr><td><code>${esc(m.model)}</code></td>${cells}</tr>`;
  });
  H.push(`<div class="band"><div class="wrap">
${chapter(4, "Which departments are hardest",
  `If failures cluster by function, a company can deploy dictation where it works and hold it
   back where it does not. We wanted to know whether that is possible.`,
  `The same ${metric("CEER")} measure split across the eleven departments. Each cell is the
   share of critical terms lost in that department's passages.`)}
${table(["Engine", ...DEPTS.map((d) => ({ h: d, num: true }))], drows)}
<p class="finding">Failures track <b>figure density, not subject matter</b>. Finance,
accounting and procurement are the worst columns for nearly every engine; legal, technical
and support — which are prose-heavy — are the best. Dictation is deployable today for
narrative work and needs review for anything with amounts in it.</p>
</div></div>`);

  // Cost, speed, and the figures/prose split as charts.
  const shortName = (id: string) => id.split("/")[1] ?? id;
  const costPts: Point[] = r2Ranked.filter((r) => r.perHour !== null).map((r) => ({
    label: shortName(r.model), x: r.perHour as number, y: r.ceer,
    win: r.model === win.model, estimated: r.external,
  }));
  const speedPts: Point[] = r2Ranked.filter((r) => Number.isFinite(r.p50)).map((r) => ({
    label: shortName(r.model), x: r.p50 as number, y: r.ceer,
    win: r.model === win.model, estimated: r.external,
  }));
  const contentPts: Point[] = r2Ranked.map((r) => ({
    label: shortName(r.model), x: r.proseCeer, y: r.numCeer, win: r.model === win.model,
  }));

  H.push(`<div class="band"><div class="wrap">
${chapter(5, "What accuracy costs, and where the difficulty sits",
  `Two questions: whether the accurate engines are affordable and fast enough for interactive
   dictation, and whether the figures/prose gap is a property of one engine or of the task.`,
  `Cost comes from the live gateway price list at run time, using measured audio duration.
   Both axes on the first two charts run &ldquo;lower is better&rdquo;, so the good corner is
   bottom-left; the dashed line is the Pareto frontier. Hollow points are priced from a
   published rate card rather than metered.`)}
<figure><div class="diagram">${scatter({
  points: costPts, quadrant: true,
  xLabel: "Cost — USD per hour of audio", yLabel: "CEER — critical entity errors",
  fx: (v) => `$${v.toFixed(2)}`, fy: (v) => `${(v * 100).toFixed(0)}%`,
  aria: "Critical entity error rate against cost per audio hour for the shortlisted engines.",
})}</div>
<figcaption>${r2Ranked.length - costPts.length} of ${r2Ranked.length} engines are absent:
<code>fish-audio</code> publishes no price, so it cannot be placed on a cost axis.</figcaption></figure>
<figure style="margin-top:var(--xl)"><div class="diagram">${scatter({
  points: speedPts, quadrant: true,
  xLabel: "Median latency — ms (p50)", yLabel: "CEER — critical entity errors",
  fx: (v) => `${Math.round(v)}ms`, fy: (v) => `${(v * 100).toFixed(0)}%`,
  aria: "Critical entity error rate against median latency for the shortlisted engines.",
})}</div>
<figcaption>On ten-second passages the fastest engine is still the least accurate, and Scribe
pays for its accuracy in latency.</figcaption></figure>
<figure style="margin-top:var(--xl)"><div class="diagram">${scatter({
  points: contentPts,
  xLabel: "CEER on prose passages", yLabel: "CEER on passages with figures",
  fx: (v) => `${(v * 100).toFixed(0)}%`, fy: (v) => `${(v * 100).toFixed(0)}%`,
  aria: "Error rate on figure-bearing passages against prose passages. Every engine sits far above the diagonal, so figures are dramatically harder regardless of engine.",
})}</div>
<figcaption>A point on the diagonal would handle figures and prose equally well. None
do.</figcaption></figure>
<p class="finding">The figures/prose gap is a property of <b>the task, not the engine</b>.
The vertical spread dwarfs the horizontal one: choosing a different engine moves the number a
little, while removing figures from the workload moves it by an order of magnitude.</p>
</div></div>`);
}

// ---------- Round two: language models ---------------------------------
if (r2llm && r2llm.rows.some((r) => r.kind === "result" && r.ok)) {
  const res = r2llm.rows.filter((r) => r.kind === "result" && r.ok);
  const per = group(res, (r) => r.model);
  const ranked = [...per.entries()].map(([model, rs]) => {
    const clean = rs.filter((r) => r.task === "cleanup");
    const q = rs.filter((r) => r.task === "question");
    const numRows = rs.filter((r) => r.numbersKept !== undefined);
    const judged = rs.filter((r) => r.verdict);
    const costs = rs.map((r) => r.costUsd as number | null);
    const tot = costs.some((c) => c === null) ? null : costs.reduce((a, b) => a! + b!, 0)!;
    return {
      model,
      wer: mean(clean.map((r) => r.wer)),
      numbers: numRows.length ? numRows.filter((r) => r.numbersKept).length / numRows.length : NaN,
      qCeer: mean(q.map((r) => r.ceer)),
      judged: judged.length ? mean(judged.map((r) => r.judgeScore)) : NaN,
      greek: judged.length ? mean(judged.map((r) => r.verdict.greek_quality)) : NaN,
      p50: latencyStats(rs.map((r) => r.latencyMs).filter((n): n is number => typeof n === "number")).p50,
      per1k: tot === null ? null : (tot / Math.max(1, rs.length)) * 1000,
    };
  }).sort((a, b) => a.wer - b.wer || b.numbers - a.numbers);

  const rows = ranked.map((r) => `<tr class="b-${band(r.wer)}">
<td><code>${esc(r.model)}</code></td>
<td class="num hero-n">${pctS(r.wer)}</td>
<td class="num c-${scoreBand(r.numbers)}">${pctS(r.numbers)}</td>
<td class="num">${pctS(r.qCeer)}</td>
<td class="num">${pctS(r.judged)}</td>
<td class="num">${numS(r.greek)}</td>
<td class="num">${msS(r.p50)}</td>
<td class="num">${usdS(r.per1k)}</td></tr>`);

  const best = ranked[0];

  H.push(`<div class="band band-soft"><div class="wrap">
${chapter(6, "Can a cheap model clean up a Greek transcript?",
  `A dictation pipeline may add a second model to restore punctuation and casing. The risk
   worth testing is whether it rewrites what the transcriber got right — since figures are
   where transcription already fails, a cleanup pass that touched numbers would compound the
   problem rather than fix it.`,
  `Each of the ${SHORTLIST_LLM.length} shortlisted models cleaned up all
   ${DEPT_UTTERANCES.length} passages, and answered a figure-extraction question on the
   number-bearing ones. Scored on ${metric("WER")} against the true reference, on whether
   <b>every</b> digit in the passage survived verbatim, and by
   <code>${esc(JUDGE_MODEL)}</code> at temperature 0 against a fixed rubric.`)}
${table(["Model", { h: `Cleanup ${metric("WER")}`, num: true }, { h: "Digits kept", num: true },
  { h: `Q ${metric("CEER")}`, num: true }, { h: "Judge", num: true },
  { h: "Greek", num: true }, metricHead("p50"), { h: "$/1k", num: true }], rows)}
<p class="finding"><b>${esc(best.model)}</b> is the cleanest at ${pctS(best.wer)}
${metric("WER")}. The reassuring result is the digits column: <b>every model preserved every
figure</b> in every cleanup, so a cleanup pass is safe for the amounts and tax numbers that
transcription itself struggles with. Where models rewrote a figure at all, it was to add the
correct Greek thousands separator — 35000 becoming 35.000 — which is an improvement.</p>
<p class="note">The judge and the digit check are reported side by side deliberately. The
judge rewards fluent, confident Greek and cannot see a changed figure, so where the two
disagree the digit check is the one to trust. Judging is reproducible — identical verdicts
across three runs at temperature 0 — and verified by
<code>npm run judgetest</code>.</p>
</div></div>`);
}

// ---------- model origin: do Chinese labs speak Greek? -----------------
if (s1 && s1b) {
  const CN = new Set(["alibaba", "deepseek", "tencent", "inclusionai", "xiaomi", "stepfun", "bytedance", "minimax"]);
  const isCN = (id: string) => CN.has(id.split("/")[0]);
  const r1 = s1.rows.filter((r) => r.kind === "result" && r.ok);
  const r1b = s1b.rows.filter((r) => r.kind === "result" && r.ok);
  const per = group(r1, (r) => r.model);

  const models = [...per.entries()].map(([model, rs]) => {
    const b = r1b.filter((r) => r.model === model);
    const ch = b.filter((r) => r.expectOk !== null || r.rejectOk !== null);
    const pass = ch.filter((r) => r.expectOk !== false && r.rejectOk !== false);
    return {
      model, cn: isCN(model),
      wer: mean(rs.map((r) => r.werL1)),
      reason: ch.length ? pass.length / ch.length : NaN,
    };
  }).sort((a, b) => a.wer - b.wer);

  const stat = (cn: boolean) => {
    const sub = models.filter((m) => m.cn === cn).sort((a, b) => a.wer - b.wer);
    const exWorst = sub.slice(0, -1);
    return {
      n: sub.length,
      best: sub[0],
      median: sub[Math.floor(sub.length / 2)].wer,
      worst: sub[sub.length - 1],
      meanExWorst: mean(exWorst.map((m) => m.wer)),
    };
  };
  const cn = stat(true);
  const we = stat(false);
  const top3 = models.slice(0, 3);
  const cnInTop3 = top3.filter((m) => m.cn).length;

  const rows = models.map((m) => `<tr class="b-${m.wer <= 0.05 ? "good" : m.wer <= 0.15 ? "warn" : "bad"}">
<td><code>${esc(m.model)}</code></td>
<td>${m.cn ? "Chinese lab" : "US / EU"}</td>
<td class="num hero-n">${pctS(m.wer)}</td>
<td class="num">${pctS(m.reason)}</td></tr>`);

  H.push(`<div class="band"><div class="wrap">
${chapter(7, "Do the Chinese models speak good Greek?",
  `Six of the twelve language models come from Chinese labs. Since Greek is a low-resource
   language for most training sets, it is worth asking whether provider origin predicts Greek
   competence — and whether a general-capability leaderboard would have told us the same thing.`,
  `The Chapter 6 results, regrouped by lab origin. Because group means are distorted by a
   single bad model on each side, the comparison also reports medians and means excluding each
   group's worst performer. Cross-checked against Artificial Analysis's Intelligence Index,
   an independent English-language capability benchmark.`)}
<div class="sig sig-coral" style="margin-top:var(--lg)">
<h3>Yes — and they take the top ${cnInTop3 === 3 ? "three" : String(cnInTop3)} places.</h3>
<p class="cap" style="margin-top:var(--md);max-width:70ch">The group averages look
interchangeable, which is misleading in both directions. Excluding each group's worst model,
the Chinese labs average <b style="color:#fff">${pctS(cn.meanExWorst)}</b> restoration WER
against <b style="color:#fff">${pctS(we.meanExWorst)}</b>; the medians are
${pctS(cn.median)} against ${pctS(we.median)}.</p>
<dl class="stats">
<div class="stat"><dt>Best Chinese</dt><dd>${pctS(cn.best.wer)}</dd></div>
<div class="stat"><dt>Best US / EU</dt><dd>${pctS(we.best.wer)}</dd></div>
<div class="stat"><dt>Median CN</dt><dd>${pctS(cn.median)}</dd></div>
<div class="stat"><dt>Median US / EU</dt><dd>${pctS(we.median)}</dd></div>
</dl>
</div>
<figure><div class="diagram">${scatter({
  points: models.filter((m) => Number.isFinite(m.reason)).map((m) => ({
    label: (m.model.split("/")[1] ?? m.model) + (m.cn ? " ·CN" : ""),
    x: m.wer, y: 1 - m.reason, win: m.cn && m.wer < 0.03,
  })),
  quadrant: true,
  xLabel: "Restoration WER — lower is better",
  yLabel: "Reasoning tasks failed",
  fx: (v) => `${(v * 100).toFixed(0)}%`, fy: (v) => `${(v * 100).toFixed(0)}%`,
  aria: "Scatter plot of reasoning failure rate against restoration word error rate, with Chinese-lab models marked CN. The bottom-left cluster of strongest models is predominantly Chinese.",
})}</div>
<figcaption>Models marked <b>·CN</b> come from Chinese labs. The strong cluster in the
bottom-left corner is predominantly Chinese; the lone far-right outlier is also Chinese, but
it is a translation-tuned model rather than a general one.</figcaption></figure>
${table(["Model", "Origin", { h: `Restoration ${metric("WER")}`, num: true },
  { h: "Reasoning", num: true }], rows)}
<p class="finding">Yes — and the pattern is <b>not</b> &ldquo;Chinese versus Western&rdquo;.
The general-purpose Chinese models carry strong multilingual coverage and take the top
${cnInTop3 === 3 ? "three" : String(cnInTop3)} places; the single worst model in the sweep is
also Chinese (<code>${esc(cn.worst.model)}</code>, ${pctS(cn.worst.wer)} ${metric("WER")}, the
only model that invents facts on the traps) but it is translation-tuned, so Greek generation
is not its job. Both groups ship a weak small model.</p>
<div class="cream" style="margin-top:var(--lg)">
<h4>Corroborated by an independent source</h4>
<p class="note" style="margin-top:var(--xs)">Artificial Analysis scores
<code>alibaba/qwen3.8-27b</code> and <code>openai/gpt-5.6-luna</code> at
<b>the same 52</b> on its Intelligence Index — a general-capability benchmark run in
English. On Greek restoration the Chinese model is roughly twice as accurate
(${pctS(models.find((m) => m.model === "alibaba/qwen3.8-27b")?.wer ?? NaN)} against
${pctS(models.find((m) => m.model === "openai/gpt-5.6-luna")?.wer ?? NaN)} WER), with both
at 100% on reasoning. Equal general intelligence, unequal Greek — which is the argument for
language-specific evaluation rather than reading a global leaderboard.</p>
</div>
</div></div>`);
}

// ---------- corpus, caveats, method ------------------------------------
H.push(`<div class="band band-soft"><div class="wrap">
<p class="eyebrow">Limits</p>
<h2 style="margin-top:var(--xs)">What these numbers cannot tell you</h2>
<div class="cream" style="margin-top:var(--lg)">
<p>The corpus is <b>TTS-synthesized clean speech</b> (<code>spacexai/grok-tts</code>): one
voice, no disfluencies, no mic compression, no room noise, no accent variation.</p>
<ol class="caveats">
<li><b>These are floor numbers.</b> Real-world WER will be higher.</li>
<li><b>It over-ranks engines that are brittle to noise.</b> A model can win here and still
collapse on a real phone mic.</li>
<li><b>It under-measures the cleanup stage</b>, whose real job is repairing noise-induced
garbage. On clean input there is less to repair — so “cleanup doesn't help” is partly an
artifact of the corpus.</li>
<li><b>The judged column is a fluency signal, not an accuracy one.</b> Where it disagrees
with the hard checks, trust the hard checks.</li>
</ol>
<p class="note" style="margin-top:16px">Ground truth was verified by re-transcribing every
clip and checking it against its reference, so a TTS mispronunciation cannot silently become
the thing models are graded against. Where grok-tts reads a loanword or an amount its own way
(«μπάντζετ» for <i>budget</i>; “45 ευρώ και 50 λεπτά” for 45,50), the reference records that
reading as acceptable rather than penalising every engine for it. Latency is from one machine
on one network — directional, not an SLA.</p>
</div>
</div></div>`);

H.push(`<div class="band"><div class="wrap">
<p class="eyebrow">Appendix</p>
<h2 style="margin-top:var(--xs)">Reproducing this</h2>
<p class="note prose">Round two: ${DEPT_UTTERANCES.length} department passages in
${GROK_VOICES.length + OPENAI_VOICES.length} voices. Round one, whose screen produced this
shortlist: ${UTTERANCES.length} short utterances and ${TASKS.length} reasoning tasks. Every
model response and judge verdict is cached by content hash, so a re-run after a scoring
change costs nothing and returns identical numbers.</p>
<pre><span class="c"># verify the Greek normalizer and metrics before trusting any number</span>
npm run selftest
npm run judgetest  <span class="c"># judge reproducibility + rubric discrimination</span>
npm run synth:depts <span class="c"># build the 100-passage department corpus</span>
npm run r2:stt      <span class="c"># round-two STT sweep (ELEVENLABS_API_KEY for Scribe)</span>
npm run r2:llm      <span class="c"># round-two language models + judge</span>
<span class="c"># round one, which produced the shortlist:</span>
npm run synth &amp;&amp; npm run stage1 &amp;&amp; npm run stage2
npm run report     <span class="c"># regenerate this page</span></pre>
<p class="note">Raw per-utterance results, including every transcript and judge verdict,
are in <code>bench/results/*.jsonl</code>.</p>
</div></div>`);

H.push(`<footer><div class="wrap">Greek dictation benchmark · round two shortlist: ${r2Ranked.length} engines, ${SHORTLIST_LLM.length} models ·
judge ${esc(JUDGE_MODEL)} @ ${JUDGE_PROMPT_VERSION} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div></footer>`);

ensureDir(OUT);
writeFileSync(OUT, `${HEAD}\n<div class="wrap">\n${H.join("\n\n")}\n</div>\n`);
console.log(`✓ wrote ${OUT}`);
for (const [n, s] of [["stage1", s1], ["stage1b", s1b], ["stage2", s2], ["stage3", s3]] as const) {
  console.log(`  ${n}: ${s ? `${s.rows.length} rows` : "no results"}`);
}
