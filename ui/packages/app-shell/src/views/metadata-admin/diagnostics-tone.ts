// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataDiagnosticsEntry } from './useMetadata.js';

/**
 * The tone of a `/meta/diagnostics` sweep, read from the entries it returned —
 * the envelope carries only `total`, so the severity split lives on each
 * entry's `diagnostics`. An entry the server marks invalid is an error even
 * when it ships no messages; warnings only count once no entry is an error.
 * Zero entries is the clean state, which must not be painted as a failure.
 *
 * One rule for every surface that paints the sweep: the Diagnostics page
 * header (objectui#12721) and the metadata directory's "View all issues" link
 * that opens it (objectui#12768). Module-local; not on the package entry.
 */
export type DiagnosticsHeaderTone = 'error' | 'warning' | 'clean';

export function diagnosticsHeaderTone(
  entries: readonly MetadataDiagnosticsEntry[],
): DiagnosticsHeaderTone {
  let warned = false;
  for (const e of entries) {
    if (!e.diagnostics.valid || (e.diagnostics.errors?.length ?? 0) > 0) return 'error';
    if ((e.diagnostics.warnings?.length ?? 0) > 0) warned = true;
  }
  return warned ? 'warning' : 'clean';
}
