// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Minimal logger surface used by the runtime-admin half of this package.
 * (Structurally identical to the federation service's own `Logger`; kept
 * separate so the admin modules carry no internal import coupling.)
 */
export interface Logger {
  warn: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
}
