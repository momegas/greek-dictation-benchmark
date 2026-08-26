/**
 * Content-addressed response cache.
 *
 * This is what makes iteration affordable: metrics are computed from cached raw responses
 * rather than during the call, so tuning the normalizer or adding an entity is a
 * zero-dollar rerun. Paying and measuring are decoupled.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CACHE_DIR, ensureDir } from "./gateway";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function cacheKey(parts: (string | number | undefined)[]): string {
  return sha256(parts.map((p) => String(p ?? "")).join(" ")).slice(0, 32);
}

export interface Cached<T> {
  value: T;
  storedAt: string;
}

export function readCache<T>(key: string): T | undefined {
  const path = `${CACHE_DIR}/${key}.json`;
  if (!existsSync(path)) return undefined;
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as Cached<T>).value;
  } catch {
    return undefined;
  }
}

export function writeCache<T>(key: string, value: T): void {
  const path = `${CACHE_DIR}/${key}.json`;
  ensureDir(path);
  writeFileSync(path, JSON.stringify({ value, storedAt: new Date().toISOString() } satisfies Cached<T>));
}
