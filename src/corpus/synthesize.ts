/**
 * Renders the corpus to audio with grok-tts, the only gateway voice that round-trips
 * Greek reliably (openai/tts-1 mangles numbers; fish-audio/s1 does not speak Greek).
 *
 * Idempotent and content-addressed: editing one utterance regenerates exactly one file,
 * and stale audio can never be silently scored against a changed reference.
 *
 *   npm run synth
 *
 * Flags: --force (re-render everything), --check (re-run the round-trip self-check)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { experimental_generateSpeech as generateSpeech, experimental_transcribe as transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";

import { UTTERANCES, referencesFor, type Utterance } from "./utterances";
import { BENCH_DIR, ensureDir, fetchCatalog, gatewayKey } from "../lib/gateway";
import { sha256 } from "../lib/cache";
import { cer } from "../lib/metrics";
import { priceCall, fmtUsd } from "../lib/pricing";
import { attempt, runPool } from "../lib/runner";

export const TTS_MODEL = "spacexai/grok-tts";
/** Verification voice: the only family that renders ΦΠΑ correctly. */
const CHECK_MODEL = "openai/gpt-4o-transcribe";
/** Above this round-trip CER, the clip is suspect as ground truth. */
const CER_THRESHOLD = 0.15;

export const MANIFEST_PATH = `${BENCH_DIR}/manifest.json`;
const AUDIO_DIR = `${BENCH_DIR}/audio`;

export interface ManifestEntry {
  id: string;
  category: string;
  textHash: string;
  audioPath: string;
  audioSha256: string;
  durationSec: number;
  bytes: number;
  roundTripCer?: number;
  roundTripText?: string;
  flagged?: boolean;
}

export interface Manifest {
  ttsModel: string;
  generatedAt: string;
  utterances: ManifestEntry[];
}

const force = process.argv.includes("--force");
const recheck = process.argv.includes("--check");

function textHash(u: Utterance): string {
  return sha256(u.text).slice(0, 8);
}

function audioPathFor(u: Utterance): string {
  return `${AUDIO_DIR}/${u.id}.${textHash(u)}.mp3`;
}

/** Exact duration via ffprobe: duration-priced models must all bill the same number. */
function probeDuration(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  return Number(out.trim());
}

function loadManifest(): Manifest | undefined {
  if (!existsSync(MANIFEST_PATH)) return undefined;
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

export function readManifest(): Manifest {
  const m = loadManifest();
  if (!m) {
    console.error(`✗ ${MANIFEST_PATH} missing. Run: npm run synth`);
    process.exit(1);
  }
  return m;
}

if (import.meta.filename === process.argv[1]) {
  gatewayKey();
  const catalog = await fetchCatalog();
  const prev = new Map((loadManifest()?.utterances ?? []).map((e) => [e.id, e]));

  let synthesized = 0;
  let skipped = 0;
  let ttsChars = 0;

  const entries = await runPool(
    UTTERANCES,
    async (u): Promise<ManifestEntry | undefined> => {
      const path = audioPathFor(u);
      const hash = textHash(u);
      const cachedEntry = prev.get(u.id);

      // Skip when the audio exists and the reference text has not changed.
      if (!force && existsSync(path) && cachedEntry?.textHash === hash) {
        skipped++;
        if (!recheck) return cachedEntry;
      }

      let bytes: Buffer;
      if (!force && existsSync(path)) {
        bytes = readFileSync(path);
      } else {
        const res = await attempt(() =>
          generateSpeech({ model: gateway.speech(TTS_MODEL), text: u.text }),
        );
        if (!res.ok) {
          console.log(`✗ ${u.id}: ${res.error.slice(0, 120)}`);
          return undefined;
        }
        bytes = Buffer.from(res.value.audio.uint8Array);
        ensureDir(path);
        writeFileSync(path, bytes);
        synthesized++;
        ttsChars += u.text.length;
      }

      const durationSec = probeDuration(path);

      // Round-trip self-check: catches a TTS mispronunciation before it becomes
      // ground truth that every STT model is then unfairly graded against.
      const rt = await attempt(() =>
        transcribe({ model: gateway.transcription(CHECK_MODEL), audio: bytes, maxRetries: 0 }),
      );
      const roundTripText = rt.ok ? rt.value.text : undefined;
      // Score against every acceptable reference: a digit-vs-spoken-form difference is
      // a formatting choice, not a TTS defect, and scoring only against `text` flags it.
      const roundTripCer = roundTripText
        ? Math.min(...referencesFor(u).map((r) => cer(r, roundTripText, "L3").errorRate))
        : undefined;
      const flagged = roundTripCer !== undefined && roundTripCer > CER_THRESHOLD;

      console.log(
        `${flagged ? "!" : "✓"} ${u.id.padEnd(9)} ${durationSec.toFixed(1)}s  ` +
          `rtCER=${roundTripCer === undefined ? "n/a" : (roundTripCer * 100).toFixed(1) + "%"}`,
      );

      return {
        id: u.id,
        category: u.category,
        textHash: hash,
        audioPath: path,
        audioSha256: sha256(bytes),
        durationSec,
        bytes: bytes.length,
        roundTripCer,
        roundTripText,
        flagged,
      };
    },
    { concurrency: 4 },
  );

  const ok = entries.filter((e): e is ManifestEntry => e !== undefined);
  const manifest: Manifest = {
    ttsModel: TTS_MODEL,
    generatedAt: new Date().toISOString(),
    utterances: ok.sort((a, b) => a.id.localeCompare(b.id)),
  };
  ensureDir(MANIFEST_PATH);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  const totalSec = ok.reduce((n, e) => n + e.durationSec, 0);
  const flagged = ok.filter((e) => e.flagged);
  const cost = priceCall(catalog.get(TTS_MODEL), { chars: ttsChars });

  console.log(
    `\n${ok.length}/${UTTERANCES.length} utterances  ` +
      `(${synthesized} synthesized, ${skipped} skipped)  ` +
      `${totalSec.toFixed(1)}s audio  tts=${fmtUsd(cost.usd)}`,
  );

  if (flagged.length > 0) {
    console.log(`\n! ${flagged.length} flagged above ${CER_THRESHOLD * 100}% round-trip CER:`);
    for (const f of flagged) {
      const u = UTTERANCES.find((x) => x.id === f.id);
      console.log(`  ${f.id}  CER=${((f.roundTripCer ?? 0) * 100).toFixed(1)}%`);
      console.log(`    ref: ${u?.text}`);
      console.log(`    got: ${f.roundTripText}`);
    }
    console.log("\nReview these before trusting the corpus as ground truth.");
    process.exitCode = 1;
  } else {
    console.log("✓ no utterance flagged: TTS round-trip is clean");
  }
}
