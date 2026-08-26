/**
 * The report's design system — Airtable, per DESIGN.md at the repo root.
 *
 * Deliberate departures from a "generic report page", all sourced from that document:
 *   - Light only. DESIGN.md puts dark mode explicitly out of scope and calibrates the
 *     signature surfaces against white canvas, so there is no prefers-color-scheme block
 *     and every colour is painted explicitly (a transparent body would borrow the host's
 *     ground). This overrides the usual dual-theme default.
 *   - Display type stays at weight 400-500. "Don't bold display-weight type" — emphasis
 *     comes from size, colour and the signature cards instead.
 *   - Voltage lives in full-bleed signature cards (coral / forest / dark / cream), never
 *     as small accents, and consecutive bands never repeat a surface mode.
 *   - 96px section rhythm; hierarchical radii (12px cards/CTAs, 10px content, 6px inputs).
 *   - Colour-block first, shadow second: cards rely on contrast, not elevation.
 *   - No hover styling on body surfaces, per the no-hover policy.
 */
export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const pctS = (x: number | null | undefined, dp = 1): string =>
  x === null || x === undefined || Number.isNaN(x) ? "\u2014" : `${(x * 100).toFixed(dp)}%`;

export const usdS = (x: number | null | undefined, dp = 3): string =>
  x === null || x === undefined ? "unpriced" : `$${x.toFixed(dp)}`;

export const msS = (x: number | null | undefined): string =>
  x === null || x === undefined || Number.isNaN(x) ? "\u2014" : `${Math.round(x)}ms`;

export const numS = (x: number | null | undefined, dp = 2): string =>
  x === null || x === undefined || Number.isNaN(x) ? "\u2014" : x.toFixed(dp);

/**
 * Severity band for an error rate (lower is better). Rendered as a left rule plus ink
 * weight rather than a coloured row wash: DESIGN.md keeps signature colour for full-bleed
 * cards and forbids new accents, so severity borrows the documented palette sparingly.
 */
export const band = (v: number): "good" | "warn" | "bad" =>
  Number.isNaN(v) ? "warn" : v <= 0.05 ? "good" : v <= 0.15 ? "warn" : "bad";

/** Severity band for a 0..1 score (higher is better). */
export const scoreBand = (v: number): "good" | "warn" | "bad" =>
  Number.isNaN(v) ? "warn" : v >= 0.9 ? "good" : v >= 0.7 ? "warn" : "bad";

export const CSS = `
:root{
  /* Brand & surface — DESIGN.md "Colors" */
  --primary:#181d26; --primary-active:#0d1218;
  --canvas:#ffffff; --surface-soft:#f8fafc; --surface-strong:#e0e2e6;
  --surface-dark:#181d26; --hairline:#dddddd;
  /* Text */
  --ink:#181d26; --body:#333840; --muted:#41454d; --on-dark:#ffffff;
  --border-strong:#9297a0;
  /* Signature card surfaces — brand voltage, used full-bleed only */
  --coral:#aa2d00; --forest:#0a2e0e; --cream:#f5e9d4;
  --peach:#fcab79; --mint:#a8d8c4; --yellow:#f4d35e; --mustard:#d9a441;
  /* Semantic */
  --link:#1b61c9; --info:#254fad; --info-border:#458fff;
  --success:#006400; --success-border:#39bf45;
  /* Spacing — 4px base */
  --xxs:4px; --xs:8px; --sm:12px; --md:16px; --lg:24px; --xl:32px; --xxl:48px; --section:96px;
  /* Radii */
  --r-xs:2px; --r-sm:6px; --r-md:10px; --r-lg:12px; --r-full:9999px;
  --font:"Inter Display","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
*{box-sizing:border-box}
/* Light-only by design (DESIGN.md: dark mode out of scope). Painted explicitly so the
   page never borrows a dark host ground. */
html{background:var(--canvas)}
body{margin:0;background:var(--canvas);color:var(--body);font-family:var(--font);
  font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1280px;margin:0 auto;padding:0 var(--xxl)}
@media (max-width:768px){.wrap{padding:0 var(--lg)}}

/* Type scale — display weights stay 400/500, never bold */
h1,h2,h3,h4{margin:0;color:var(--ink);font-weight:400}
h1{font-size:40px;line-height:1.2;letter-spacing:0}
h2{font-size:32px;line-height:1.2}
h3{font-size:24px;line-height:1.35;letter-spacing:.12px}
h4{font-size:16px;line-height:1.4;font-weight:500}
p{margin:0}
code{font-family:var(--mono);font-size:.9em}
a{color:var(--link);text-decoration:none}
.lede{font-size:20px;line-height:1.5;color:var(--body);max-width:62ch}
.cap{font-size:14px;font-weight:500;line-height:1.35;letter-spacing:.16px;color:var(--muted)}
.eyebrow{font-size:14px;font-weight:500;letter-spacing:.16px;color:var(--muted);
  text-transform:uppercase}
.mono-s{font-family:var(--mono);font-size:12px;color:var(--muted)}

/* Editorial bands — 96px rhythm, surface mode alternates between bands */
.band{padding:var(--section) 0}
.band-soft{background:var(--surface-soft)}
.band-tight{padding:var(--xxl) 0}
.hero-band{padding:var(--section) 0 var(--xxl)}
.hero-band h1{max-width:20ch}
.facts{display:flex;flex-wrap:wrap;gap:var(--xs) var(--xl);margin-top:var(--lg);
  font-family:var(--mono);font-size:12px;color:var(--muted)}
.facts b{color:var(--ink);font-weight:600}

/* Signature cards — full-bleed colour, 48px padding, flat (colour-block first) */
.sig{border-radius:var(--r-lg);padding:var(--xxl);color:var(--on-dark)}
.sig-dark{background:var(--surface-dark)}
.sig-coral{background:var(--coral)}
.sig-forest{background:var(--forest)}
.sig h2,.sig h3,.sig h4{color:var(--on-dark)}
.sig .cap{color:rgba(255,255,255,.72)}
.cream{background:var(--cream);border-radius:var(--r-md);padding:var(--lg);color:var(--ink)}
.cream h3,.cream h4{color:var(--ink)}

/* Stat rows inside signature cards */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:var(--lg);margin-top:var(--xl)}
.stat dt{font-size:14px;font-weight:500;letter-spacing:.16px;color:rgba(255,255,255,.72)}
.stat dd{margin:var(--xxs) 0 0;font-family:var(--mono);font-size:28px;font-weight:400;
  color:var(--on-dark);font-variant-numeric:tabular-nums}
.cream .stat dt{color:var(--muted)}
.cream .stat dd{color:var(--ink)}

/* Findings list — numbers encode a real sequence of conclusions */
.findings{margin:var(--xl) 0 0;padding:0;list-style:none;display:grid;gap:var(--md)}
.findings li{display:grid;grid-template-columns:auto 1fr;gap:var(--md);align-items:start}
.fnum{font-family:var(--mono);font-size:12px;color:rgba(255,255,255,.72);
  border:1px solid rgba(255,255,255,.28);border-radius:var(--r-xs);padding:2px 6px;margin-top:2px}

/* Tables — hairline dividers, no shadow */
.scroll{overflow-x:auto;margin-top:var(--lg);border:1px solid var(--hairline);
  border-radius:var(--r-md);background:var(--canvas)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:10px var(--md);border-bottom:1px solid var(--hairline);
  white-space:nowrap;vertical-align:middle;line-height:1.4}
thead th{font-size:14px;font-weight:500;letter-spacing:.16px;color:var(--muted);
  background:var(--surface-soft)}
tbody tr:last-child td{border-bottom:none}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right}
.hero-n{font-weight:500;color:var(--ink)}
/* First column carries the model id and should not be squeezed by the numeric columns. */
tbody td:first-child,tbody td:nth-child(2){white-space:nowrap}
thead th.num{text-align:right}
/* A prose column inside an otherwise numeric table: let it wrap, and give it the width to
   do so in one or two lines rather than four. */
.wrap-cell{white-space:normal;min-width:34ch;line-height:1.45}
.rank{font-family:var(--mono);color:var(--muted);width:1%}
.tag{font-size:12px;font-weight:500;background:var(--primary);color:var(--on-dark);
  padding:2px 8px;border-radius:var(--r-xs);margin-left:var(--xs)}
.tag.ext{background:var(--mustard);color:var(--ink)}
/* Severity via a left rule + ink weight, not a colour wash on the row */
tr.b-good td:first-child{box-shadow:inset 3px 0 0 var(--success-border)}
tr.b-warn td:first-child{box-shadow:inset 3px 0 0 var(--mustard)}
tr.b-bad td:first-child{box-shadow:inset 3px 0 0 var(--coral)}
.c-good{color:var(--success);font-weight:500}
.c-warn{color:var(--mustard);font-weight:500}
.c-bad{color:var(--coral);font-weight:500}
.d-worse{color:var(--coral);font-weight:500}
.d-better{color:var(--success);font-weight:500}
tr.ctl{background:var(--surface-soft)}
tr.dim td{color:var(--border-strong)}
.plus{color:var(--muted)}
.pill{font-size:12px;font-weight:500;padding:2px 8px;border-radius:var(--r-xs)}
.p-ok{background:var(--success);color:var(--on-dark)}
.p-no{background:var(--surface-strong);color:var(--muted)}

/* Evidence rows — cream/peach demo-card surfaces, uneven by content */
.evidence{list-style:none;margin:var(--lg) 0 0;padding:0;display:grid;gap:var(--sm)}
.ev{border-radius:var(--r-md);padding:var(--md);display:grid;gap:var(--xs);
  grid-template-columns:minmax(170px,220px) 1fr auto;align-items:center;
  border:1px solid var(--hairline);background:var(--canvas)}
.ev.ok{background:var(--mint);border-color:transparent}
.ev.no{background:var(--peach);border-color:transparent}
.evm{font-family:var(--mono);font-size:12px;color:var(--ink)}
.evt{font-size:16px;color:var(--ink)}
.evb{font-size:12px;font-weight:500;padding:2px 8px;border-radius:var(--r-xs);
  white-space:nowrap;background:rgba(24,29,38,.12);color:var(--ink)}
.refline{margin-top:var(--md);padding-left:var(--md);border-left:2px solid var(--hairline);
  color:var(--muted);font-size:14px}

/* Grids — card heights deliberately uneven */
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));
  gap:var(--lg);margin-top:var(--lg);align-items:start}
.card{background:var(--canvas);border:1px solid var(--hairline);
  border-radius:var(--r-md);padding:var(--lg)}
.card.soft{background:var(--surface-soft);border-color:transparent}
.card h4{margin-bottom:var(--xs)}

/* Diagrams */
figure{margin:var(--lg) 0 0}
figure svg{display:block;width:100%;height:auto}
figcaption{margin-top:var(--sm);font-size:14px;font-weight:500;letter-spacing:.16px;
  color:var(--muted)}
.diagram{background:var(--surface-soft);border-radius:var(--r-md);padding:var(--lg)}
.sig .diagram{background:rgba(255,255,255,.07)}

/* Metric definitions.
   A native title="" tooltip waits a second or two, never fires on touch, and is invisible
   inside a sandboxed iframe — so the definition is rendered as a real element instead.
   Shown on hover AND focus, and the trigger is a real button element so keyboard and screen-reader
   users reach it the same way. */
.m{position:relative;display:inline-block;border:0;padding:0;margin:0;background:none;
  font:inherit;color:inherit;cursor:help;
  border-bottom:1px dotted var(--border-strong);line-height:inherit}
.m::after{
  content:attr(data-def);
  position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);
  width:max-content;max-width:min(300px,70vw);white-space:normal;text-align:left;
  background:var(--surface-dark);color:var(--on-dark);
  font-size:12.5px;font-weight:400;line-height:1.45;letter-spacing:0;
  padding:10px 12px;border-radius:var(--r-sm);
  opacity:0;visibility:hidden;pointer-events:none;z-index:50;
  box-shadow:0 6px 24px -8px rgba(24,29,38,.45)}
.m::before{
  content:"";position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%);
  border:5px solid transparent;border-top-color:var(--surface-dark);
  opacity:0;visibility:hidden;pointer-events:none;z-index:51}
.m:hover::after,.m:focus-visible::after,.m:hover::before,.m:focus-visible::before{
  opacity:1;visibility:visible}
/* A centred bubble clips at either page edge, so the first and last columns anchor their
   bubble to the near edge instead of centring it. */
.m.right::after{left:auto;right:0;transform:none}
.m.right::before{left:auto;right:12px;transform:none}
.m.left::after{left:0;right:auto;transform:none}
.m.left::before{left:12px;right:auto;transform:none}
thead .m{color:var(--muted)}
.sig .m{border-bottom-color:rgba(255,255,255,.5)}
.sig .m::after{background:var(--canvas);color:var(--ink);
  box-shadow:0 6px 24px -8px rgba(0,0,0,.5)}
.sig .m::before{border-top-color:var(--canvas)}
/* Chapter brief: question + method, before any numbers. */
.brief{margin-top:var(--lg);border-left:2px solid var(--hairline);padding-left:var(--md);
  display:grid;gap:var(--sm);max-width:76ch}
.brief-row{display:grid;grid-template-columns:78px 1fr;gap:var(--md);align-items:start}
.brief-k{font-size:12px;font-weight:500;letter-spacing:.6px;text-transform:uppercase;
  color:var(--muted);padding-top:2px}
.brief-row p{font-size:14px;color:var(--body)}
/* The one-sentence answer a chapter earned. */
.finding{margin-top:var(--lg);padding:var(--md) var(--lg);background:var(--surface-soft);
  border-left:3px solid var(--primary);border-radius:0 var(--r-sm) var(--r-sm) 0;
  font-size:16px;color:var(--ink);max-width:76ch}
.finding b{font-weight:600}
.note{color:var(--muted);font-size:14px;margin-top:var(--md);max-width:74ch}
.prose{max-width:70ch}
ol.caveats{margin:var(--md) 0 0;padding-left:var(--lg);display:grid;gap:var(--sm)}
pre{background:var(--surface-dark);color:var(--on-dark);border-radius:var(--r-md);
  padding:var(--lg);overflow-x:auto;font-family:var(--mono);font-size:12px;
  line-height:1.8;margin:var(--lg) 0 0}
pre .c{color:rgba(255,255,255,.55)}
footer{border-top:1px solid var(--hairline);padding:var(--xl) 0;color:var(--muted);font-size:14px}
:focus-visible{outline:2px solid var(--info-border);outline-offset:2px}
@media (max-width:768px){
  h1{font-size:32px}h2{font-size:26px}h3{font-size:20px}
  .band{padding:var(--xxl) 0}
  .sig{padding:var(--lg)}
  .ev{grid-template-columns:1fr}
  .evb{justify-self:start}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

export const HEAD = `<title>Greek Dictation Benchmark</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${CSS}</style>`;

/**
 * A table. Headers whose label is a metric get right-aligned to sit over their numbers;
 * anything wrapped by `metric()` already carries its own markup, so alignment is decided
 * from a passed flag rather than sniffed from the string.
 */
export function table(head: (string | { h: string; num?: boolean })[], rows: string[], cls = ""): string {
  const th = head.map((h) => {
    const label = typeof h === "string" ? h : h.h;
    const isNum = typeof h === "string" ? false : Boolean(h.num);
    return `<th${isNum ? ' class="num"' : ""}>${label}</th>`;
  }).join("");
  return `<div class="scroll"><table${cls ? ` class="${cls}"` : ""}>
<thead><tr>${th}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody></table></div>`;
}

/**
 * Stage diagrams.
 *
 * Each one draws the mechanism that stage actually tests, not a decorative flowchart —
 * the point is that a reader can see *why* a stage produces the number it does. Inline SVG
 * with currentColor-driven strokes so a diagram inherits the surface it sits on (white
 * canvas or a signature card) without a second palette.
 */

const SVG_FONT = 'font-family="Inter, sans-serif"';



/** Stage 1 + 1b: two different questions, and why the second one reorders the answers. */
export const DIAGRAM_TEXT = `<svg viewBox="0 0 900 236" role="img" aria-label="Two text screens: restoration repairs degraded Greek and is scored by WER and gates; reasoning tasks are scored by deterministic hard checks plus an LLM judge.">
<defs><marker id="a2" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
<path d="M0 0 L8 4 L0 8 z" fill="currentColor"/></marker></defs>
<g ${SVG_FONT} font-size="13" fill="currentColor">
<text x="0" y="14" font-size="11" font-weight="500" letter-spacing=".6" opacity=".72">STAGE 1 — RESTORATION</text>
<rect x="0" y="26" width="182" height="62" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="14" y="49" font-size="12">Degraded Greek</text>
<text x="14" y="68" font-size="11" opacity=".72">no accents, no stixi</text>
<line x1="190" y1="57" x2="240" y2="57" stroke="currentColor" stroke-width="1.5" marker-end="url(#a2)"/>
<rect x="248" y="26" width="150" height="62" rx="10" fill="currentColor" opacity=".08"/>
<rect x="248" y="26" width="150" height="62" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="262" y="55" font-size="12" font-weight="500">Model repairs</text>
<line x1="406" y1="57" x2="456" y2="57" stroke="currentColor" stroke-width="1.5" marker-end="url(#a2)"/>
<rect x="464" y="26" width="200" height="62" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="478" y="49" font-size="12" font-weight="500">WER + 3 gates</text>
<text x="478" y="68" font-size="11" opacity=".72">script · loanword · length</text>

<text x="0" y="128" font-size="11" font-weight="500" letter-spacing=".6" opacity=".72">STAGE 1B — REASONING</text>
<rect x="0" y="140" width="182" height="62" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="14" y="163" font-size="12">11 tasks</text>
<text x="14" y="182" font-size="11" opacity=".72">QA · extract · math · traps</text>
<line x1="190" y1="171" x2="240" y2="171" stroke="currentColor" stroke-width="1.5" marker-end="url(#a2)"/>
<rect x="248" y="140" width="150" height="62" rx="10" fill="currentColor" opacity=".08"/>
<rect x="248" y="140" width="150" height="62" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="262" y="169" font-size="12" font-weight="500">Model answers</text>

<line x1="406" y1="160" x2="456" y2="145" stroke="currentColor" stroke-width="1.5" marker-end="url(#a2)"/>
<line x1="406" y1="182" x2="456" y2="197" stroke="currentColor" stroke-width="1.5" marker-end="url(#a2)"/>
<rect x="464" y="118" width="200" height="52" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="478" y="139" font-size="12" font-weight="500">Hard checks</text>
<text x="478" y="156" font-size="11" opacity=".72">deterministic · trusted</text>
<rect x="464" y="178" width="200" height="52" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="478" y="199" font-size="12" font-weight="500">LLM judge</text>
<text x="478" y="216" font-size="11" opacity=".72">fluency signal only</text>

<path d="M672 144 L700 144 L700 174 L672 174" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/>
<path d="M672 204 L700 204 L700 178" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/>
<line x1="700" y1="174" x2="742" y2="174" stroke="currentColor" stroke-width="1.5" marker-end="url(#a2)"/>
<rect x="750" y="146" width="150" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="764" y="169" font-size="12" font-weight="500">Gap published</text>
<text x="764" y="187" font-size="11" opacity=".72">judge − hard</text>
</g></svg>`;

/** Stage 2: why entity scoring and WER disagree, drawn on one utterance. */
export const DIAGRAM_STT = `<svg viewBox="0 0 900 214" role="img" aria-label="One audio clip fans out to seven engines; each transcript is scored twice, by word error rate and by critical entity error rate, which can disagree.">
<defs><marker id="a3" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
<path d="M0 0 L8 4 L0 8 z" fill="currentColor"/></marker></defs>
<g ${SVG_FONT} font-size="13" fill="currentColor">
<rect x="0" y="76" width="150" height="62" rx="10" fill="currentColor" opacity=".08"/>
<rect x="0" y="76" width="150" height="62" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="16" y="100" font-size="12" font-weight="500">One clip</text>
<text x="16" y="119" font-size="11" opacity=".72">«…16,99 συν ΦΠΑ»</text>

<path d="M158 96 L206 44" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#a3)"/>
<path d="M158 107 L206 107" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#a3)"/>
<path d="M158 118 L206 170" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#a3)"/>

<rect x="214" y="18" width="230" height="52" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="228" y="39" font-size="12">…16,99 συν ΦΠΑ.</text>
<text x="228" y="57" font-size="11" opacity=".72">gpt-4o · scribe — term intact</text>

<rect x="214" y="82" width="230" height="52" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="228" y="103" font-size="12">…16,99 συν ΦΥΠΙΑ.</text>
<text x="228" y="121" font-size="11" opacity=".72">whisper-1 — one token wrong</text>

<rect x="214" y="146" width="230" height="52" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="228" y="167" font-size="12">…16,99€ (no term)</text>
<text x="228" y="185" font-size="11" opacity=".72">fish-audio — term dropped</text>

<line x1="452" y1="107" x2="500" y2="107" stroke="currentColor" stroke-width="1.5" marker-end="url(#a3)"/>

<rect x="508" y="44" width="180" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="522" y="66" font-size="12" font-weight="500">WER</text>
<text x="522" y="84" font-size="11" opacity=".72">~8% — looks minor</text>

<rect x="508" y="114" width="180" height="56" rx="10" fill="currentColor" opacity=".08"/>
<rect x="508" y="114" width="180" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="522" y="136" font-size="12" font-weight="500">CEER</text>
<text x="522" y="154" font-size="11" opacity=".72">100% — unusable</text>

<line x1="696" y1="142" x2="744" y2="142" stroke="currentColor" stroke-width="1.5" marker-end="url(#a3)"/>
<rect x="752" y="114" width="148" height="56" rx="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="766" y="136" font-size="12" font-weight="500">Ranking key</text>
<text x="766" y="154" font-size="11" opacity=".72">CEER, WER tiebreak</text>
<text x="508" y="196" font-size="11.5" opacity=".72">Same error. WER shrugs; entity scoring calls it fatal.</text>
</g></svg>`;



/**
 * Metric glossary and the `metric()` helper.
 *
 * An acronym-heavy table is unreadable to anyone who did not build it, so every acronym
 * carries its expansion inline. Implemented as a native <abbr title> plus a visible dotted
 * underline: no JS, works on hover *and* on focus (the DESIGN.md no-hover rule is about
 * decorative state changes, not about withholding a definition), and the title attribute
 * is what assistive tech already announces.
 */
export const GLOSSARY: Record<string, { full: string; def: string }> = {
  CEER: {
    full: "Critical Entity Error Rate",
    def: "Share of must-get-right terms the model lost — ΦΠΑ, amounts, dates, names. The ranking key: a mangled tax acronym matters more than a fumbled function word.",
  },
  EER: {
    full: "Entity Error Rate",
    def: "Share of all tracked entities missed, critical or not.",
  },
  WER: {
    full: "Word Error Rate",
    def: "Insertions + deletions + substitutions, divided by reference length, after Unicode normalization (NFC, final-sigma folded). Lower is better.",
  },
  CER: {
    full: "Character Error Rate",
    def: "Same calculation over grapheme clusters rather than words, so a one-letter slip is not scored as a whole wrong word.",
  },
  RTF: {
    full: "Real-Time Factor",
    def: "Latency ÷ audio duration. Below 1.0 means the engine transcribes faster than the audio plays.",
  },
  p50: {
    full: "Median latency",
    def: "Half of requests finish faster than this. Measured after discarding one cold call per model.",
  },
  p95: {
    full: "95th-percentile latency",
    def: "Only 1 request in 20 is slower. Dictation UX is governed by this tail, not the median.",
  },
  ΦΠΑ: {
    full: "Fóros Prostithémenis Axías",
    def: "Greek VAT. The single most common term in Greek business speech, and the one most engines get wrong.",
  },
  ΑΦΜ: {
    full: "Arithmós Forologikoú Mitróou",
    def: "Greek tax identification number.",
  },
  ΔΟΥ: {
    full: "Dimósia Oikonomikí Ypiresía",
    def: "Greek local tax office.",
  },
  ΕΦΚΑ: {
    full: "e-EFKA",
    def: "Greece's unified social security fund.",
  },
  TTS: {
    full: "Text to Speech",
    def: "Synthesizes the corpus audio from written reference text.",
  },
  STT: {
    full: "Speech to Text",
    def: "Transcribes audio back into text — the thing being benchmarked.",
  },
};

/**
 * An acronym with its definition attached.
 *
 * `edge` shifts the bubble left when the term sits in a right-hand column, where a
 * centred bubble would be clipped by the table's scroll container.
 */
export function metric(
  key: string,
  label?: string,
  edge: false | "left" | "right" = false,
): string {
  const g = GLOSSARY[key];
  const text = label ?? key;
  if (!g) return esc(text);
  const cls = edge ? ` ${edge}` : "";
  return `<button type="button" class="m${cls}" data-def="${esc(`${g.full}. ${g.def}`)}" aria-label="${esc(`${text}: ${g.full}. ${g.def}`)}">${esc(text)}</button>`;
}

/**
 * A chapter opener.
 *
 * Every chapter answers the same three questions in the same order — what we wanted to
 * know, how it was measured, and what came back — so a reader can trust the shape and skim
 * to whichever part they need. `n` is the chapter number: these are sequential, and the
 * numbering means something (each stage depends on the previous one), which is the only
 * reason it is numbered at all.
 */
export function chapter(n: number, title: string, aim: string, method: string): string {
  return `<p class="eyebrow">Chapter ${n}</p>
<h2 style="margin-top:var(--xs)">${title}</h2>
<div class="brief">
<div class="brief-row"><span class="brief-k">Question</span><p>${aim}</p></div>
<div class="brief-row"><span class="brief-k">Method</span><p>${method}</p></div>
</div>`;
}

/** A numeric column header carrying its definition. */
export function metricHead(
  key: string,
  label?: string,
  edge: false | "left" | "right" = false,
): { h: string; num: true } {
  return { h: metric(key, label, edge), num: true };
}

/**
 * Data charts — real scatter plots computed from the results, not hand-drawn.
 *
 * The design brief asked for x/y charts in the Artificial Analysis idiom: a most-attractive
 * quadrant, a Pareto frontier, and directly-labelled points instead of a legend the reader
 * has to cross-reference. Axes carry their units, and because both cost and error rate are
 * "lower is better", the good corner is bottom-left — which is stated on the chart rather
 * than left for the reader to infer.
 */
export interface Point {
  label: string;
  x: number;
  y: number;
  /** Renders hollow when the value is an assumption rather than a measurement. */
  estimated?: boolean;
  /** Emphasised as the recommended option. */
  win?: boolean;
}

interface ScatterOpts {
  points: Point[];
  xLabel: string;
  yLabel: string;
  /** Formatters for the axis ticks. */
  fx: (v: number) => string;
  fy: (v: number) => string;
  /** Shade the quadrant nearer the origin (both axes "lower is better"). */
  quadrant?: boolean;
  width?: number;
  height?: number;
  aria: string;
}

const niceMax = (v: number) => {
  const mag = 10 ** Math.floor(Math.log10(v || 1));
  return Math.ceil(v / mag * 2) / 2 * mag;
};

/**
 * Lower-left Pareto frontier: the points nothing else beats on both axes at once.
 */
function pareto(pts: Point[]): Point[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const out: Point[] = [];
  let bestY = Infinity;
  for (const p of sorted) {
    if (p.y < bestY - 1e-9) {
      out.push(p);
      bestY = p.y;
    }
  }
  return out;
}

export function scatter(o: ScatterOpts): string {
  const W = o.width ?? 900;
  const H = o.height ?? 400;
  const M = { t: 18, r: 26, b: 52, l: 62 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;

  const xMax = niceMax(Math.max(...o.points.map((p) => p.x)) * 1.12);
  const yMax = niceMax(Math.max(...o.points.map((p) => p.y)) * 1.15);
  const X = (v: number) => M.l + (v / xMax) * iw;
  const Y = (v: number) => M.t + ih - (v / yMax) * ih;

  const ticks = (max: number) => Array.from({ length: 5 }, (_, i) => (max / 4) * i);
  const xt = ticks(xMax);
  const yt = ticks(yMax);

  const grid = [
    ...yt.map((v) => `<line x1="${M.l}" y1="${Y(v).toFixed(1)}" x2="${M.l + iw}" y2="${Y(v).toFixed(1)}" stroke="#dddddd" stroke-width="1"${v === 0 ? "" : ' stroke-dasharray="2 4"'}/>`),
    ...xt.map((v) => `<line x1="${X(v).toFixed(1)}" y1="${M.t}" x2="${X(v).toFixed(1)}" y2="${M.t + ih}" stroke="#dddddd" stroke-width="1" stroke-dasharray="2 4"/>`),
  ].join("");

  const tickText = [
    ...yt.map((v) => `<text x="${M.l - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#41454d">${o.fy(v)}</text>`),
    ...xt.map((v) => `<text x="${X(v).toFixed(1)}" y="${M.t + ih + 20}" text-anchor="middle" font-size="11" fill="#41454d">${o.fx(v)}</text>`),
  ].join("");

  // The attractive quadrant: better than the median on both axes.
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const qx = med(o.points.map((p) => p.x));
  const qy = med(o.points.map((p) => p.y));
  const quad = o.quadrant
    ? `<rect x="${M.l}" y="${Y(qy).toFixed(1)}" width="${(X(qx) - M.l).toFixed(1)}" height="${(M.t + ih - Y(qy)).toFixed(1)}" fill="#a8d8c4" opacity=".28"/>
<text x="${(M.l + 8).toFixed(1)}" y="${(M.t + ih - 8).toFixed(1)}" font-size="10.5" fill="#0a2e0e" opacity=".85">better on both axes</text>`
    : "";

  const front = pareto(o.points);
  const frontPath = front.length > 1
    ? `<path d="${front.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" ")}" fill="none" stroke="#181d26" stroke-width="1.2" stroke-dasharray="3 3" opacity=".55"/>`
    : "";

  // Label placement: nudge right, flip left near the right edge, so labels stay inside.
  const dots = o.points.map((p) => {
    const cx = X(p.x);
    const cy = Y(p.y);
    const flip = cx > M.l + iw * 0.68;
    const lx = flip ? cx - 11 : cx + 11;
    const anchor = flip ? "end" : "start";
    const fill = p.win ? "#aa2d00" : p.estimated ? "#ffffff" : "#181d26";
    const stroke = p.estimated ? "#181d26" : "none";
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${p.win ? 7 : 5.5}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
<text x="${lx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11.5" font-weight="${p.win ? 600 : 400}" fill="#181d26">${esc(p.label)}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}" font-family="Inter, sans-serif">
${grid}${quad}${frontPath}${dots}${tickText}
<line x1="${M.l}" y1="${M.t + ih}" x2="${M.l + iw}" y2="${M.t + ih}" stroke="#181d26" stroke-width="1.2"/>
<line x1="${M.l}" y1="${M.t}" x2="${M.l}" y2="${M.t + ih}" stroke="#181d26" stroke-width="1.2"/>
<text x="${(M.l + iw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="500" fill="#181d26">${esc(o.xLabel)}</text>
<text x="14" y="${(M.t + ih / 2).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="500" fill="#181d26" transform="rotate(-90 14 ${(M.t + ih / 2).toFixed(1)})">${esc(o.yLabel)}</text>
</svg>`;
}

/** Horizontal bars, for a single ranked measure. */
export function bars(
  rows: { label: string; value: number; win?: boolean; unpriced?: boolean }[],
  fmt: (v: number) => string,
  aria: string,
): string {
  const W = 900;
  const rowH = 30;
  const L = 232;
  const H = rows.length * rowH + 26;
  const max = Math.max(...rows.map((r) => r.value)) * 1.02 || 1;
  const body = rows.map((r, i) => {
    const y = i * rowH + 6;
    const w = Math.max(2, (r.value / max) * (W - L - 92));
    const fill = r.win ? "#aa2d00" : r.unpriced ? "#e0e2e6" : "#181d26";
    return `<text x="0" y="${y + 15}" font-size="11.5" fill="#181d26" font-family="JetBrains Mono, monospace">${esc(r.label)}</text>
<rect x="${L}" y="${y + 4}" width="${w.toFixed(1)}" height="14" rx="2" fill="${fill}"/>
<text x="${(L + w + 8).toFixed(1)}" y="${y + 15}" font-size="11.5" font-weight="${r.win ? 600 : 400}" fill="#181d26">${esc(fmt(r.value))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}" font-family="Inter, sans-serif">${body}</svg>`;
}
