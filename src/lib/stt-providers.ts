/**
 * Transcription behind one interface, so gateway models and direct-API providers can be
 * swept and scored identically.
 *
 * ElevenLabs Scribe is not a gateway provider (the catalog lists 35, none of them
 * ElevenLabs), so it needs a direct multipart call to api.elevenlabs.io with an
 * `xi-api-key`. Everything else routes through the AI SDK's gateway transcription.
 */
import { experimental_transcribe as transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";

export interface SttResult {
  text: string;
  language?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

export interface SttProvider {
  id: string;
  /** Where the cost comes from: the gateway catalog, or a published rate card. */
  pricing: "catalog" | "external";
  /** Set when the provider cannot run in this environment (e.g. missing credential). */
  unavailable?: string;
  run(audio: Uint8Array): Promise<SttResult>;
}

/** ElevenLabs Scribe v1. Priced from their published rate card, not the gateway. */
export const SCRIBE_ID = "elevenlabs/scribe-v1";
/**
 * $0.40 per hour on the Business tier at the time of writing. Not machine-readable the way
 * the gateway catalog is, so it is recorded here as a stated assumption and labelled as
 * external in the report rather than presented as a metered figure.
 */
export const SCRIBE_USD_PER_HOUR = 0.4;

function scribeProvider(): SttProvider {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  return {
    id: SCRIBE_ID,
    pricing: "external",
    unavailable: key
      ? undefined
      : "ELEVENLABS_API_KEY not set — add it to .env.local and re-run to include Scribe",
    async run(audio) {
      if (!key) throw new Error("ELEVENLABS_API_KEY not set");
      const form = new FormData();
      // Copy into a fresh ArrayBuffer: a Uint8Array over a SharedArrayBuffer is not a
      // valid BlobPart under the DOM lib, and this file is typechecked under both configs.
      const buf = new ArrayBuffer(audio.byteLength);
      new Uint8Array(buf).set(audio);
      form.append("file", new Blob([buf], { type: "audio/mpeg" }), "audio.mp3");
      form.append("model_id", "scribe_v1");
      // Pin Greek: Scribe autodetects, and a wrong guess would be measured as a WER
      // failure rather than the configuration issue it actually is.
      form.append("language_code", "ell");
      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": key },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`elevenlabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const j = (await res.json()) as { text?: string; language_code?: string };
      return { text: (j.text ?? "").trim(), language: j.language_code ?? null };
    },
  };
}

function gatewayProvider(id: string): SttProvider {
  return {
    id,
    pricing: "catalog",
    async run(audio) {
      const r = await transcribe({
        model: gateway.transcription(id),
        audio,
        maxRetries: 0,
      });
      const u = r as unknown as { usage?: { inputTokens?: number; outputTokens?: number } };
      return {
        text: r.text.trim(),
        language: r.language ?? null,
        inputTokens: u.usage?.inputTokens,
        outputTokens: u.usage?.outputTokens,
      };
    },
  };
}

export function makeProvider(id: string): SttProvider {
  return id === SCRIBE_ID ? scribeProvider() : gatewayProvider(id);
}
