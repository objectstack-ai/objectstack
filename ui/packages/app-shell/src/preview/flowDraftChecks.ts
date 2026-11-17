// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a flow draft's publish would still say, read before the publish
 * (objectstack#34818, item 1).
 *
 * The flow designer's Problems tab already lists a draft's `_diagnostics`
 * (`ResourceEditPage` keeps them from each draft read). Since #34818 the
 * server folds the publish gate's ADVISORIES into a flow draft's read too
 * (`withPublishAdvisories`, `@objectstack/metadata-protocol`), each warning
 * worded for the builder in the request's language. This module reads those
 * same warnings for the pending-changes sheet, so the sheet names them beside
 * the Publish button instead of a toast naming them after it.
 *
 * ## The server is the one author of the text
 *
 * Nothing here re-runs a rule or rewords a finding: the message is the
 * server's, rendered as sent. The request states the console's language
 * (`Accept-Language`), which is how the read door picks the sentence's locale
 * (`userTextLocalesOf`); the sheet's other reads are plain `fetch` calls that
 * state none, so this one says it itself.
 *
 * ## It reports; it never blocks
 *
 * Same stance as `securityPostureLint.ts`: a read that fails yields no checks,
 * and nothing here touches the Publish button.
 *
 * Kept apart from the panel and free of React so the read and the projection
 * can be exercised directly.
 */

/** The draft types whose read carries the publish gate's advisories (the server's `DRAFT_ADVISORY_TYPES`). */
export const DRAFT_CHECK_TYPES: ReadonlySet<string> = new Set(['flow']);

/** The part of a pending-changes entry this read needs. */
export interface DraftCheckTarget {
  type: string;
  name: string;
  packageId: string | null;
  member?: string;
}

/** One thing the publish would still say about one draft. */
export interface DraftCheck {
  type: string;
  name: string;
  /** `error` = the publish would refuse it; `warning` = an advisory it would report. */
  severity: 'error' | 'warning';
  /** The server's sentence, as sent. */
  message: string;
  /** Item-relative path (`nodes.1`), when the server gave one. */
  path?: string;
}

interface ServedIssue {
  path?: unknown;
  message?: unknown;
}

function issuesOf(list: unknown): Array<{ message: string; path?: string }> {
  if (!Array.isArray(list)) return [];
  const out: Array<{ message: string; path?: string }> = [];
  for (const raw of list as ServedIssue[]) {
    if (!raw || typeof raw.message !== 'string' || raw.message.trim() === '') continue;
    out.push({
      message: raw.message,
      ...(typeof raw.path === 'string' && raw.path !== '' ? { path: raw.path } : {}),
    });
  }
  return out;
}

/**
 * The `_diagnostics` a draft read served, projected to checks: errors first,
 * then warnings, each in the order served. A body with no `_diagnostics`
 * yields none.
 */
export function draftChecksOf(target: Pick<DraftCheckTarget, 'type' | 'name'>, payload: unknown): DraftCheck[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const body = p.item && typeof p.item === 'object' ? (p.item as Record<string, unknown>) : p;
  const diagnostics = body._diagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') return [];
  const d = diagnostics as { errors?: unknown; warnings?: unknown };
  const at = { type: target.type, name: target.name };
  return [
    ...issuesOf(d.errors).map((i) => ({ ...at, severity: 'error' as const, ...i })),
    ...issuesOf(d.warnings).map((i) => ({ ...at, severity: 'warning' as const, ...i })),
  ];
}

/**
 * Read every flow draft among `drafts` and return what its publish would still
 * say. One read per flow draft; a draft whose read fails contributes nothing.
 */
export async function readDraftChecks(
  drafts: readonly DraftCheckTarget[],
  opts: { language?: string; fetchImpl?: typeof fetch } = {},
): Promise<DraftCheck[]> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const targets = drafts.filter((d) => DRAFT_CHECK_TYPES.has(d.type));
  const perDraft = await Promise.all(
    targets.map(async (target) => {
      const params = ['state=draft'];
      if (target.packageId) params.push(`package=${encodeURIComponent(target.packageId)}`);
      if (target.member) params.push(`member=${encodeURIComponent(target.member)}`);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (opts.language) headers['Accept-Language'] = opts.language;
      try {
        const res = await doFetch(
          `/api/v1/meta/${encodeURIComponent(target.type)}/${encodeURIComponent(target.name)}?${params.join('&')}`,
          { credentials: 'include', headers, cache: 'no-store' },
        );
        if (!res.ok) return [];
        return draftChecksOf(target, await res.json());
      } catch {
        return [];
      }
    }),
  );
  return perDraft.flat();
}
