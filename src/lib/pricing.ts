/**
 * Cost accounting for the three shapes the gateway actually bills in.
 *
 * A missing price yields null plus a reason, never an estimate: both fish-audio models
 * publish `pricing: {}`, and a fabricated cost that ranks a model is worse than an
 * admitted gap.
 */
import type { ModelEntry } from "./gateway";

/**
 * OpenAI bills gpt-4o transcription in audio input tokens at a documented 10 tokens per
 * second of audio. The gateway's transcribe response reports no usage at all (verified:
 * `usage` is undefined and providerMetadata carries only routing), so for these models the
 * token count is derived from the measured duration rather than reported. Marked
 * `derived: true` in the result so the report never presents it as a metered number.
 */
export const AUDIO_TOKENS_PER_SEC = 10;

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  /** Audio seconds, from the corpus manifest — never the model's self-report, so that
   *  every model is billed against one identical number. */
  durationSec?: number;
  /** Characters of text, for TTS. */
  chars?: number;
}

export interface Cost {
  usd: number | null;
  reason?: string;
  shape?: "duration" | "audio_tokens" | "text_tokens" | "characters";
  /** True when the token count was inferred from duration, not reported by the API. */
  derived?: boolean;
  /** True when priced from a published rate card instead of the gateway catalog. */
  external?: boolean;
}

const num = (v: unknown): number | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Providers billed outside the gateway, priced from a published rate card rather than a
 * machine-readable catalog. Marked `external: true` so the report never presents these as
 * metered figures.
 */
export const EXTERNAL_USD_PER_HOUR: Record<string, number> = {
  "elevenlabs/scribe-v1": 0.4,
};

export function priceCall(entry: ModelEntry | undefined, usage: Usage, modelId?: string): Cost {
  const ext = modelId ? EXTERNAL_USD_PER_HOUR[modelId] : undefined;
  if (ext !== undefined) {
    if (usage.durationSec === undefined) return { usd: null, reason: "duration_unavailable" };
    return { usd: (ext / 3600) * usage.durationSec, shape: "duration", external: true };
  }
  if (!entry) return { usd: null, reason: "model_not_in_catalog" };
  const p = entry.pricing ?? {};
  if (Object.keys(p).length === 0) return { usd: null, reason: "no_published_pricing" };

  const perSec = num(p.transcription_duration_cost_per_second);
  const perChar = num(p.speech_input_character_cost);
  const audioIn = num(p.audio_input_token_cost);
  const tokIn = num(p.input);
  const tokOut = num(p.output);

  // TTS: character-priced.
  if (perChar !== undefined && usage.chars !== undefined) {
    return { usd: perChar * usage.chars, shape: "characters" };
  }

  // Duration-priced STT (whisper-1, grok-stt).
  if (perSec !== undefined) {
    if (usage.durationSec === undefined) return { usd: null, reason: "duration_unavailable" };
    return { usd: perSec * usage.durationSec, shape: "duration" };
  }

  // Audio-token-priced STT (the gpt-4o transcribe family).
  if (audioIn !== undefined) {
    const reported = usage.inputTokens;
    // Fall back to duration x the documented token rate: the API reports no usage, and a
    // null here would drop the two most accurate models out of the cost comparison
    // entirely, which is a worse distortion than a clearly-labelled derived figure.
    const inTok = reported ?? (usage.durationSec !== undefined
      ? usage.durationSec * AUDIO_TOKENS_PER_SEC
      : undefined);
    if (inTok === undefined) return { usd: null, reason: "usage_unavailable" };
    const out = (usage.outputTokens ?? 0) * (tokOut ?? 0);
    return {
      usd: inTok * audioIn + out,
      shape: "audio_tokens",
      derived: reported === undefined,
    };
  }

  // Text LLM. Top-level input/output only: utterances are tiny, so pricing tiers
  // never bind and tier-walking would only add a way to be wrong.
  if (tokIn !== undefined || tokOut !== undefined) {
    if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
      return { usd: null, reason: "usage_unavailable" };
    }
    return {
      usd: (usage.inputTokens ?? 0) * (tokIn ?? 0) + (usage.outputTokens ?? 0) * (tokOut ?? 0),
      shape: "text_tokens",
    };
  }

  return { usd: null, reason: "unrecognized_pricing_shape" };
}

/** Sum costs, propagating unknowns rather than silently treating them as zero. */
export function sumCosts(costs: Cost[]): Cost {
  if (costs.some((c) => c.usd === null)) {
    return { usd: null, reason: "contains_unpriced_call" };
  }
  return { usd: costs.reduce((n, c) => n + (c.usd ?? 0), 0) };
}

export function fmtUsd(usd: number | null, digits = 4): string {
  return usd === null ? "unknown" : `$${usd.toFixed(digits)}`;
}
