// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Minimal logger surface. Inlined here (rather than imported from the
 * federation service) so this package has no dependency on
 * `@objectstack/service-external-datasource`.
 */
export interface Logger {
  warn: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
}
