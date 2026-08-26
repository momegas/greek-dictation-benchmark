/**
 * Live model catalog from the AI Gateway.
 *
 * Fetched at run time and cached per day, never hardcoded: prices and availability change,
 * and a stale table makes the whole benchmark lie quietly.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Side-effect import: every entry point reaches process.env through this module, so loading
// .env here means no script has to remember to do it.
import "./env";

export const BENCH_DIR = "bench";
export const CACHE_DIR = `${BENCH_DIR}/cache`;

export interface ModelPricing {
  input?: string;
  output?: string;
  audio_input_token_cost?: string;
  transcription_duration_cost_per_second?: string;
  speech_input_character_cost?: string;
  [k: string]: unknown;
}

export interface ModelEntry {
  id: string;
  name?: string;
  type: string;
  pricing: ModelPricing;
}

export function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function gatewayKey(): string {
  const k = process.env.AI_GATEWAY_API_KEY;
  if (!k) {
    console.error("✗ AI_GATEWAY_API_KEY is not set.");
    console.error("  Copy .env.example to .env and add your key, then re-run.");
    process.exit(1);
  }
  return k;
}

/** The catalog, cached to disk so repeated stage runs agree on prices. */
export async function fetchCatalog(force = false): Promise<Map<string, ModelEntry>> {
  const day = new Date().toISOString().slice(0, 10);
  const path = `${CACHE_DIR}/models-${day}.json`;

  let data: { data: ModelEntry[] };
  if (!force && existsSync(path)) {
    data = JSON.parse(readFileSync(path, "utf8"));
  } else {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      headers: { Authorization: `Bearer ${gatewayKey()}` },
    });
    if (!res.ok) throw new Error(`model catalog: HTTP ${res.status}`);
    data = (await res.json()) as { data: ModelEntry[] };
    ensureDir(path);
    writeFileSync(path, JSON.stringify(data, null, 2));
  }

  return new Map(data.data.map((m) => [m.id, m]));
}
