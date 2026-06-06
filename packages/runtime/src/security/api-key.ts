// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * api-key — hand-rolled API-key primitives for `sys_api_key`.
 *
 * better-auth 1.6.x ships no apiKey plugin, so ObjectStack owns the full
 * lifecycle: generation, at-rest hashing, header extraction and validation.
 * This module is the SINGLE audited source of truth shared by the request
 * resolver (verify path) and any key-creation path (generate path) — keep all
 * key crypto here so the two halves can never drift apart.
 *
 * SECURITY (zero-tolerance):
 *  - The raw key is returned EXACTLY ONCE, by {@link generateApiKey}. It is
 *    never persisted; only `sha256(raw)` (hex) is stored in `sys_api_key.key`.
 *  - The raw key and its hash must never enter logs, HTTP responses, error
 *    messages, commit messages or comments.
 *  - Validation is fail-closed: anything ambiguous (missing, revoked, expired,
 *    malformed) resolves to "no principal", never to an elevated one.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Default visible prefix for generated keys (helps users identify a key). */
export const API_KEY_PREFIX = 'osk_';

/** Bytes of entropy in the secret portion of a generated key (256 bits). */
const API_KEY_ENTROPY_BYTES = 32;

/** Length of the human-visible prefix stored in `sys_api_key.prefix`. */
const VISIBLE_PREFIX_LEN = 12;

/**
 * Derive the at-rest hash for an API key. Inbound keys are hashed the same way
 * before the DB lookup. Because the lookup matches an indexed, high-entropy
 * hash exactly, this doubles as a constant-effort comparison: an attacker
 * cannot recover the raw key by probing for partial matches.
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Result of {@link generateApiKey}. `raw` is shown to the user only once. */
export interface GeneratedApiKey {
  /** The full secret to hand to the client. NEVER persist this. */
  raw: string;
  /** `sha256(raw)` hex — store this in `sys_api_key.key`. */
  hash: string;
  /** Short non-secret prefix for display/identification (`sys_api_key.prefix`). */
  prefix: string;
}

/**
 * Generate a fresh API key. Returns the raw secret (caller must surface it to
 * the user exactly once and then discard it), its at-rest hash, and a short
 * non-secret prefix for display.
 */
export function generateApiKey(prefix: string = API_KEY_PREFIX): GeneratedApiKey {
  // base64url so the token is URL/header-safe with no padding.
  const secret = randomBytes(API_KEY_ENTROPY_BYTES).toString('base64url');
  const raw = `${prefix}${secret}`;
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, VISIBLE_PREFIX_LEN),
  };
}

/**
 * Extract an API key from request headers. Accepts `X-API-Key: <token>` or
 * `Authorization: ApiKey <token>` (case-insensitive scheme). Bearer tokens are
 * deliberately NOT treated as API keys — those flow through the session path.
 */
export function extractApiKey(headers: any): string | undefined {
  const x = readHeader(headers, 'x-api-key');
  if (x && x.trim()) return x.trim();
  const auth = readHeader(headers, 'authorization');
  if (!auth) return undefined;
  const m = auth.match(/^ApiKey\s+(.+)$/i);
  const token = m?.[1]?.trim();
  return token || undefined;
}

/** Parse a `scopes` value that may be a JSON-string textarea or a real array. */
export function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((s): s is string => typeof s === 'string' && s.length > 0);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = safeJsonParse<unknown>(value, []);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
    }
  }
  return [];
}

/** Return true when an expiry timestamp is in the past (i.e. the key is dead). */
export function isExpired(value: unknown, nowMs: number): boolean {
  if (value == null) return false;
  let ms: number;
  if (typeof value === 'number') {
    // Heuristic: seconds vs milliseconds epoch.
    ms = value < 1e12 ? value * 1000 : value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'string') {
    ms = Date.parse(value);
  } else {
    return false;
  }
  if (Number.isNaN(ms)) return false;
  return ms <= nowMs;
}

function readHeader(headers: any, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (typeof headers.get === 'function') {
    const v = headers.get(name) ?? headers.get(lower);
    return v == null ? undefined : String(v);
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      return Array.isArray(v) ? v[0] : v == null ? undefined : String(v);
    }
  }
  return undefined;
}

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
