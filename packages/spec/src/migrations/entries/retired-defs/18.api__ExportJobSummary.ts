// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17158 — `api/ExportJobSummary`, retired whole with the export-job API family
// (ADR-0049 enforce-or-remove; maintainer ruling A, landing route A — objectui
// retired its side first in objectui#10247). It declared
// the row shape of the unserved export-job list.
// Zero readers in objectstack, in objectui at the pinned sha, and in cloud.
// No carrier key and no authored document, so no tombstone and no D2
// conversion — this table plus the D3 semantic entry
// `export-job-family-retired` are the declaration.
export const entry = 'api/ExportJobSummary';
