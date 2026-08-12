// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DatasourceConnectionSpec } from './contracts/index.js';

/**
 * Resolve ADR-0015's schema-ownership mode for a connection spec — whether
 * ObjectStack owns this schema or is a guest in a database it must never run
 * DDL against.
 *
 * Extracted to its own declaration in #7314 because it now has TWO callers:
 * every arm of {@link createDefaultDatasourceDriverFactory}, and the shared
 * libSQL config builder ({@link buildTursoDriverConfig}) that
 * `@objectstack/runtime`'s host loader also calls. Left inline it would have
 * been hand-copied into the second one — and a hand-copied read of a config key
 * is the defect #7314 exists to close, not a shape to repeat.
 *
 * The order is load-bearing and dates from #4410. `spec.schemaMode` — the
 * datasource's OWN declared key — is first; before #4410 only the two fallbacks
 * existed and neither could ever hold it (`external` is the federation-settings
 * block and has no such key; nothing wrote the `config` copy), so a datasource
 * declaring `schemaMode: 'external'` reached the driver as `undefined` and a
 * database ObjectStack is a guest in was constructed as `managed`, with DDL
 * ungated at the driver.
 *
 * Returns the raw string rather than the narrowed union: the two fallbacks come
 * from untyped bags, and narrowing here would mean silently dropping a stored
 * value the driver would otherwise refuse loudly.
 */
export function resolveDatasourceSchemaMode(spec: DatasourceConnectionSpec): string | undefined {
  return spec.schemaMode
    ?? (spec.external as { schemaMode?: string } | undefined)?.schemaMode
    ?? ((spec.config as Record<string, unknown> | undefined)?.schemaMode as string | undefined);
}
