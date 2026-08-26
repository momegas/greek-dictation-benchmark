/**
 * Loads .env before anything reads process.env.
 *
 * In the project this was extracted from, the shell sourced .env.local before each script.
 * Standalone that is a footgun — every run command would need the same `set -a` dance, and
 * forgetting it produces a confusing "key not set" rather than an obvious mistake. So the
 * scripts load their own env, and `npm run <stage>` is enough.
 *
 * Deliberately dependency-free: this parses the subset of .env syntax the file actually uses
 * (KEY=value, # comments, optional quotes) rather than pulling in dotenv for it. Values
 * already present in the real environment win, so CI secrets are not overwritten by a
 * stale local file.
 */
import { existsSync, readFileSync } from "node:fs";

const FILES = [".env.local", ".env"];

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) out[key] = value;
  }
  return out;
}

let loaded = false;

/** Idempotent: safe to call from every entry point. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const f of FILES) {
    if (!existsSync(f)) continue;
    for (const [k, v] of Object.entries(parse(readFileSync(f, "utf8")))) {
      // A real environment variable always wins over the file.
      if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
    }
  }
}

loadEnv();
