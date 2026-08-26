/**
 * The shortlist carried forward from round one.
 *
 * Round one screened 12 language models and 7 transcription engines on a 40-utterance
 * corpus. This round re-tests only the survivors, on a harder corpus: 100 longer,
 * department-specific passages in ~12 voices across two TTS providers.
 *
 * Nothing here is a fresh candidate — every entry earned its place, and the reasons are
 * recorded so the exclusions stay auditable rather than becoming folklore.
 */

/** STT engines that scored under ~30% critical-entity error in round one. */
export const SHORTLIST_STT = [
  "openai/gpt-4o-transcribe",      // 1.3% CEER — round-one winner
  "elevenlabs/scribe-v1",          // 1.3% CEER — tied, but 4.4x cost and 1.6x latency
  "openai/gpt-4o-mini-transcribe", // 3.8% CEER — half the price of the winner
  "openai/whisper-1",              // 12.5% CEER — the widely-assumed default, kept as a baseline
  "fish-audio/transcribe-1",       //   27% CEER — cheapest-looking, cost unpublished
  "spacexai/grok-stt",             //   36% CEER — fastest engine; kept to test the speed/accuracy edge
];

/**
 * Excluded, with cause — so a later reader does not have to re-derive it.
 */
export const EXCLUDED_STT: Record<string, string> = {
  "openai/gpt-realtime-whisper":
    "Refuses non-streaming transcription outright, so it cannot be swept this way.",
  "fish-audio/transcribe-1-free":
    "Output identical to the paid fish-audio variant; keeping both adds no signal.",
};

/** Language models that passed round one's Greek screen and reasoning tasks. */
export const SHORTLIST_LLM = [
  "deepseek/deepseek-v4-flash-0731", // 1.6% restoration WER, cheapest capable option
  "alibaba/qwen-3-32b",              // 2.3% WER, 100% on reasoning tasks
  "alibaba/qwen3.8-27b",             // 2.4% WER, 100% on reasoning
  "spacexai/grok-4.1-fast-reasoning",// 3.5% WER, 100% on reasoning
  "openai/gpt-5.6-luna",             // 4.9% WER, 100% on reasoning
  "alibaba/qwen3.7-flash",           // 6.6% WER, 100% on reasoning
];

export const EXCLUDED_LLM: Record<string, string> = {
  "mistral/ministral-14b": "Fails script integrity — transliterates loanwords into Greek script.",
  "mistral/ministral-3b": "38.9% restoration WER and 63.6% on reasoning.",
  "amazon/nova-micro": "20.4% WER; drops loanwords.",
  "tencent/hy-mt2-lite": "61% WER, 27% reasoning, and the only model that invents facts on traps.",
  "inclusionai/ling-3.0-flash": "11.6% WER — passed, but edged out by six stronger models.",
  "openai/gpt-oss-20b": "13.7% WER — passed, but edged out.",
};

/** Round-one figures, for the report's provenance note. */
export const ROUND_ONE = {
  sttScreened: 7,
  llmScreened: 12,
  utterances: 40,
  meanClipSec: 4.5,
};
