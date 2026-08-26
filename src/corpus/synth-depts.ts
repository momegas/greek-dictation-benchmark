/**
 * Renders the department corpus, routing by content and rotating voices.
 *
 * Provider routing is a measured decision. On number-bearing Greek, openai/tts-1 loses
 * digits — and four independent STT engines then mis-hear the same spots in the same way,
 * which is the signature of bad audio rather than bad transcription. grok-tts reads the same
 * figures correctly. So figures go to Grok; prose-only passages go to OpenAI, whose Greek
 * prose all four engines agree on. Both providers are therefore represented, and no clip
 * carries knowingly wrong ground truth.
 *
 * Voices rotate deterministically by index, so the same utterance always gets the same
 * voice and a re-run is reproducible.
 *
 *   npm run synth:depts
 *
 * Flags: --force  --check  --limit N
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { experimental_generateSpeech as generateSpeech } from "ai";
import { gateway } from "@ai-sdk/gateway";

import { DEPT_UTTERANCES, type DeptUtterance } from "./departments";
import { BENCH_DIR, ensureDir, fetchCatalog, gatewayKey } from "../lib/gateway";
import { sha256 } from "../lib/cache";
import { cer } from "../lib/metrics";
import { fmtUsd, priceCall } from "../lib/pricing";
import { makeProvider } from "../lib/stt-providers";
import { attempt, runPool } from "../lib/runner";

/** Voices verified to exist and to read Greek digits correctly. */
export const GROK_VOICES = ["Eve", "Gork", "Ara", "Rex", "Sal", "Leo"];
/** OpenAI's six standard voices, used only for prose-only passages. */
export const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

const GROK = "spacexai/grok-tts";
const OPENAI = "openai/tts-1";
/** Verification voice: the engine that renders ΦΠΑ correctly. */
const CHECK_MODEL = "openai/gpt-4o-transcribe";
const CER_THRESHOLD = 0.2;

export const DEPT_MANIFEST = `${BENCH_DIR}/manifest-depts.json`;
const AUDIO_DIR = `${BENCH_DIR}/audio-depts`;

export interface DeptEntry {
  id: string;
  dept: string;
  ttsModel: string;
  voice: string;
  hasNumbers: boolean;
  textHash: string;
  audioPath: string;
  audioSha256: string;
  durationSec: number;
  roundTripCer?: number;
  roundTripText?: string;
  flagged?: boolean;
}

export interface DeptManifest {
  generatedAt: string;
  providers: { grok: string; openai: string };
  utterances: DeptEntry[];
}

/** Deterministic voice + provider for an utterance. */
export function routeFor(u: DeptUtterance, index: number): { model: string; voice: string } {
  return u.hasNumbers || u.forceGrok
    ? { model: GROK, voice: GROK_VOICES[index % GROK_VOICES.length] }
    : { model: OPENAI, voice: OPENAI_VOICES[index % OPENAI_VOICES.length] };
}

/** Every acceptable reading of an utterance: written form plus spoken-numeral form. */
export function deptRefs(u: DeptUtterance): string[] {
  return [u.text, ...(u.spoken ? [u.spoken] : []), ...(u.altRefs ?? [])];
}

const short = (m: string) => (m === GROK ? "grok" : "openai");
/** Filename encodes department, provider and voice, so a clip is self-describing. */
function pathFor(u: DeptUtterance, index: number): string {
  const { model, voice } = routeFor(u, index);
  return `${AUDIO_DIR}/${u.id}__${short(model)}-${voice}.${sha256(u.text).slice(0, 8)}.mp3`;
}

function probeDuration(path: string): number {
  return Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], {
      encoding: "utf8",
    }).trim(),
  );
}

export function readDeptManifest(): DeptManifest {
  if (!existsSync(DEPT_MANIFEST)) {
    console.error(`✗ ${DEPT_MANIFEST} missing. Run: npm run synth:depts`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(DEPT_MANIFEST, "utf8")) as DeptManifest;
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const recheck = argv.includes("--check");
  const limArg = argv.indexOf("--limit");
  const limit = limArg >= 0 ? Number(argv[limArg + 1]) : 0;

  const catalog = await fetchCatalog();
  const prev = new Map(
    (existsSync(DEPT_MANIFEST) ? readDeptManifest().utterances : []).map((e) => [e.id, e]),
  );
  const corpus = limit ? DEPT_UTTERANCES.slice(0, limit) : DEPT_UTTERANCES;

  let made = 0;
  let skipped = 0;
  const charsBy: Record<string, number> = { grok: 0, openai: 0 };

  const entries = await runPool(
    corpus.map((u, i) => ({ u, i })),
    async ({ u, i }): Promise<DeptEntry | undefined> => {
      const { model, voice } = routeFor(u, i);
      const path = pathFor(u, i);
      const hash = sha256(u.text).slice(0, 8);
      const cached = prev.get(u.id);

      if (!force && existsSync(path) && cached?.textHash === hash && !recheck) {
        skipped++;
        return cached;
      }

      let audio: Buffer;
      if (!force && existsSync(path)) {
        audio = readFileSync(path);
      } else {
        const res = await attempt(() =>
          generateSpeech({ model: gateway.speech(model), text: u.text, voice, maxRetries: 0 }),
        );
        if (!res.ok) {
          console.log(`✗ ${u.id} (${short(model)}/${voice}): ${res.error.slice(0, 100)}`);
          return undefined;
        }
        audio = Buffer.from(res.value.audio.uint8Array);
        ensureDir(path);
        writeFileSync(path, audio);
        made++;
        charsBy[short(model)] += u.text.length;
      }

      const durationSec = probeDuration(path);
      const rt = await attempt(() => makeProvider(CHECK_MODEL).run(audio));
      const roundTripText = rt.ok ? rt.value.text : undefined;
      // Score against every acceptable reading: a spoken-form number is a formatting
      // choice, not a TTS defect, and scoring only against the written form flags it.
      const roundTripCer = roundTripText
        ? Math.min(...deptRefs(u).map((r) => cer(r, roundTripText, "L4").errorRate))
        : undefined;
      const flagged = roundTripCer !== undefined && roundTripCer > CER_THRESHOLD;

      console.log(
        `${flagged ? "!" : "✓"} ${u.id.padEnd(15)} ${short(model)}/${voice.padEnd(8)} ` +
          `${durationSec.toFixed(1)}s  rtCER=${roundTripCer === undefined ? "n/a" : (roundTripCer * 100).toFixed(0) + "%"}`,
      );

      return {
        id: u.id, dept: u.dept, ttsModel: model, voice, hasNumbers: u.hasNumbers,
        textHash: hash, audioPath: path, audioSha256: sha256(audio), durationSec,
        roundTripCer, roundTripText, flagged,
      };
    },
    { concurrency: 4 },
  );

  const ok = entries.filter((e): e is DeptEntry => e !== undefined);
  const manifest: DeptManifest = {
    generatedAt: new Date().toISOString(),
    providers: { grok: GROK, openai: OPENAI },
    utterances: ok.sort((a, b) => a.id.localeCompare(b.id)),
  };
  ensureDir(DEPT_MANIFEST);
  writeFileSync(DEPT_MANIFEST, JSON.stringify(manifest, null, 2));

  const totalSec = ok.reduce((n, e) => n + e.durationSec, 0);
  const cost =
    (priceCall(catalog.get(GROK), { chars: charsBy.grok }).usd ?? 0) +
    (priceCall(catalog.get(OPENAI), { chars: charsBy.openai }).usd ?? 0);
  const flagged = ok.filter((e) => e.flagged);

  console.log(
    `\n${ok.length}/${corpus.length} clips (${made} synthesized, ${skipped} skipped)  ` +
      `${totalSec.toFixed(0)}s audio  ${(totalSec / ok.length).toFixed(1)}s mean  tts=${fmtUsd(cost)}`,
  );
  const byV = new Map<string, number>();
  for (const e of ok) {
    const k = `${short(e.ttsModel)}/${e.voice}`;
    byV.set(k, (byV.get(k) ?? 0) + 1);
  }
  console.log(`voices: ${[...byV.entries()].map(([k, n]) => `${k}=${n}`).join("  ")}`);

  if (flagged.length) {
    console.log(`\n! ${flagged.length} above ${CER_THRESHOLD * 100}% round-trip CER:`);
    for (const f of flagged.slice(0, 12)) {
      const u = DEPT_UTTERANCES.find((x) => x.id === f.id);
      console.log(`  ${f.id} (${short(f.ttsModel)}/${f.voice}) CER=${((f.roundTripCer ?? 0) * 100).toFixed(0)}%`);
      console.log(`    ref: ${u?.text.slice(0, 105)}`);
      console.log(`    got: ${f.roundTripText?.slice(0, 105)}`);
    }
    process.exitCode = 1;
  } else {
    console.log("✓ no clip flagged");
  }
}
