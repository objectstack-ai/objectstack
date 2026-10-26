// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataValidationIssue } from './metadata-client';

/**
 * The ONE reader of a failed metadata save: turn a caught error into a
 * FIELD-ANCHORED message (objectui#11302).
 *
 * The framework validates a draft against its spec and returns structured
 * issues — `error.details.issues: [{ path, message }]` on the HTTP dispatcher,
 * top-level `issues` on the REST server — and {@link MetadataClient}'s error
 * parser puts both on `MetadataError.issues`. On the `/meta` write doors the
 * error's own message is a headline that names WHERE and HOW MANY (a count plus
 * `path [code]` locators) and leaves the prose — the author's prescription — to
 * that structured channel. So a surface that shows only `err.message` shows a
 * headline and never the remedy. These helpers render "which field, and why"
 * instead of a single opaque banner line — the point of surfacing validation at
 * the save/publish moment.
 *
 * ## Why it lives HERE and not in `app-shell`
 *
 * Beside the {@link MetadataError} and {@link MetadataValidationIssue} it
 * reads, for the same reason `extractDraftBody` lives beside `getDraft`. It was
 * born in `app-shell`'s studio-design views, and `@object-ui/plugin-designer`
 * — whose `MetadataFieldsPage` saves through the same client — cannot import
 * from `app-shell`: `app-shell` depends on `plugin-designer`, not the other way
 * round. Both depend on this package. A second formatter in `plugin-designer`
 * would be the copy that drifts; one reader here is what both surfaces call.
 *
 * ## How a caller shows it
 *
 * The result is newline-separated (one issue per line), so render it with a
 * whitespace class that keeps newlines — `whitespace-pre-line`, or a `pre` with
 * `whitespace-pre-wrap` — or the list collapses into one run-on line.
 */

/**
 * Pull structured validation issues off a caught error (empty if none).
 *
 * Module-level rather than barrel-exported: {@link formatMetadataError} is the
 * reader callers use, and no caller outside this module needs the raw list
 * today.
 */
export function extractIssues(e: unknown): MetadataValidationIssue[] {
  const issues = (e as { issues?: unknown } | null | undefined)?.issues;
  return Array.isArray(issues) ? (issues as MetadataValidationIssue[]) : [];
}

/**
 * One issue → a single field-anchored line: `• fields.amount.type — Required`.
 *
 * Exported so a caller that formats a LIST of failures — `app-shell`'s publish
 * formatter, whose `failed[]` entries carry their own `issues` — writes each
 * issue in this same grammar instead of keeping a second copy of it.
 */
export function formatMetadataIssue(i: MetadataValidationIssue): string {
  return `• ${i.path && i.path.length > 0 ? i.path : '(root)'} — ${i.message}`;
}

/**
 * Format a caught save/publish error for a banner/toast. When the error carries
 * spec-validation issues, list them (one field per line) so the user sees the
 * offending fields and what to do about them; otherwise fall back to the plain
 * message.
 */
export function formatMetadataError(e: unknown): string {
  const issues = extractIssues(e);
  if (issues.length > 0) return issues.map(formatMetadataIssue).join('\n');
  const err = e as { message?: string } | null | undefined;
  return err?.message ?? String(e);
}
