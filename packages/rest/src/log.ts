// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package's console shim, in one place.
 *
 * [#8850] Lifted out of `rest-server.ts` unchanged when the ADR-0112
 * error/fault-classification prologue moved to `error-response.ts`: both files
 * log through it, and the alternative — a second copy of the same two lines —
 * is the "two spellings of one thing" shape this repo pays for repeatedly. It
 * is deliberately NOT re-exported from the package index: an internal shim, not
 * a logging API.
 */

// Node-safe logger — avoids importing 'console' which is absent from ES2020 lib typings.
export const logError = (...args: unknown[]) => (globalThis as any).console?.error(...args);
export const logWarn = (...args: unknown[]) => ((globalThis as any).console?.warn ?? (globalThis as any).console?.error)?.(...args);
