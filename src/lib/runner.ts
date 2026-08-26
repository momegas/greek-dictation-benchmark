/**
 * Bounded-concurrency task runner with non-fatal failures.
 *
 * Every task resolves to ok/err and never throws, so one dead model (gpt-realtime-whisper
 * rejects non-streaming transcription outright) records an error row instead of aborting a
 * sweep that has already been paid for. Retries are recorded, not hidden: a model needing
 * three attempts per call is itself a finding.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { ensureDir } from "./gateway";

export type Outcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: string; attempts: number };

export interface RunOpts {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Transient-failure signatures. Deliberately broad: the Stage 1 sweep hit
 * "Service temporarily unavailable" and NGHTTP2_INTERNAL_ERROR, neither of which carries
 * a status code, and both of which made a working model look incapable.
 */
const RETRYABLE =
  /(429|5\d\d|rate.?limit|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|fetch failed|overloaded|temporarily unavailable|unavailable|NGHTTP2|stream closed|socket hang up|network|capacity)/i;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Runs one task with retry/backoff. Only 429/5xx-shaped errors are retried. */
export async function attempt<T>(fn: () => Promise<T>, retries = 3): Promise<Outcome<T>> {
  let lastError = "";
  for (let i = 1; i <= retries + 1; i++) {
    try {
      return { ok: true, value: await fn(), attempts: i };
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      if (!RETRYABLE.test(lastError) || i > retries) {
        return { ok: false, error: lastError, attempts: i };
      }
      await sleep(2 ** i * 250 + Math.floor(Math.random() * 250));
    }
  }
  return { ok: false, error: lastError, attempts: retries + 1 };
}

/**
 * Fixed worker pool over a task list. Not Promise.all: hundreds of simultaneous gateway
 * calls would rate-limit and destroy the latency measurement.
 */
export async function runPool<TIn, TOut>(
  items: TIn[],
  worker: (item: TIn, index: number) => Promise<TOut>,
  opts: RunOpts = {},
): Promise<TOut[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const out = new Array<TOut>(items.length);
  let next = 0;
  let done = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
      done++;
      opts.onProgress?.(done, items.length);
    }
  });

  await Promise.all(runners);
  return out;
}

/** Append-only JSONL, so a crashed run keeps every row it already earned. */
export class JsonlWriter {
  constructor(private readonly path: string) {
    ensureDir(path);
    writeFileSync(path, "");
  }
  write(row: unknown): void {
    appendFileSync(this.path, JSON.stringify(row) + "\n");
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

export interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export function latencyStats(ms: number[]): LatencyStats {
  return {
    n: ms.length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    max: ms.length ? Math.max(...ms) : NaN,
  };
}
