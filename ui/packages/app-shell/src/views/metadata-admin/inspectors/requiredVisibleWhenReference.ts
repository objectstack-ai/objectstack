// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The author-time advisory for a `required` field whose own `visibleWhen`
 * reads THROUGH a reference field (`record.account.tier` on a lookup named
 * `account`).
 *
 * ## The hazard
 *
 * Since ADR-0113's 2026-11-17 amendment a field that is `required` and carries
 * its own `visibleWhen` is required only WHEN SHOWN: the server judges the
 * requirement from that predicate on every write. The field level is never
 * hydrated on the server, so a read through a reference meets the related
 * record's bare id and faults; a fault counts as SHOWN, and the field stays
 * required on every record, the ones the form hides it on included. The form
 * resolves the predicate and hides the field, so the user is refused on save
 * naming a field they cannot see.
 *
 * ## Why an advisory, not a blocking issue
 *
 * The server ACCEPTS the field and keeps exactly the unconditional `required`
 * it had before the amendment, so nothing gets worse; only the waiver never
 * happens. `@objectstack/lint` reports the same shape as a WARNING at
 * `objectstack validate` and the object save door (the `visibleWhen` field
 * traversal slot), and this is that verdict shown where the author writes the
 * predicate. The roots the server cannot bind (`features`, `app`, `page`, the
 * acting user) are already refused for every field `visibleWhen` by the
 * predicate editor itself, so they draw nothing here.
 *
 * ## The reads are found by the parser, never by a pattern
 *
 * `analyzeRelationshipTraversals` is the `@objectstack/formula` export the
 * server and the lint run on the same predicate. It is loaded LAZILY, as every
 * CEL affordance in this designer is, so the parser stays off the eager graph.
 * A source that does not parse draws nothing: syntax belongs to the CEL lint.
 */

import * as React from 'react';
import { REFERENCE_VALUE_TYPES } from '@objectstack/spec/data';

/** The `record` / `previous` member reads a source takes through a field, by field. */
export type TraversalReader = (source: string, root: string) => ReadonlyMap<string, unknown> | null;

/** The CEL source of a field predicate, or `null` when there is none. */
export function predicateSource(raw: unknown): string | null {
  let source: unknown = raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const env = raw as Record<string, unknown>;
    if (env.dialect !== undefined && env.dialect !== 'cel') return null;
    source = env.source;
  }
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  return trimmed ? trimmed : null;
}

/**
 * The reference fields a `required` field's `visibleWhen` reads through, in
 * first-seen order. Empty when the field is not required, has no predicate, the
 * predicate does not parse, or every read is of this object's own columns.
 */
export function referenceReadsInRequiredVisibleWhen(
  def: Record<string, unknown> | null | undefined,
  fieldTypes: Readonly<Record<string, unknown>>,
  readTraversals: TraversalReader,
): string[] {
  if (!def || def.required !== true) return [];
  const source = predicateSource(def.visibleWhen);
  if (!source) return [];
  const out: string[] = [];
  for (const root of ['record', 'previous']) {
    const traversals = readTraversals(source, root);
    if (!traversals) continue;
    for (const field of traversals.keys()) {
      const type = fieldTypes[field];
      if (typeof type === 'string' && REFERENCE_VALUE_TYPES.has(type) && !out.includes(field)) out.push(field);
    }
  }
  return out;
}

/* ── The lazily loaded traversal reader ───────────────────────────────── */

type Analyze = (source: string, root: string) => { traversals: ReadonlyMap<string, unknown> } | null;

let analyzeCached: Promise<Analyze | null> | null = null;

function loadAnalyzer(): Promise<Analyze | null> {
  if (!analyzeCached) {
    analyzeCached = import('@objectstack/formula')
      .then(({ analyzeRelationshipTraversals }) =>
        typeof analyzeRelationshipTraversals === 'function' ? (analyzeRelationshipTraversals as unknown as Analyze) : null,
      )
      .catch(() => null);
  }
  return analyzeCached;
}

/**
 * The advisory's reference fields for one field draft. Empty while the parser
 * loads and when it is unavailable — this check reports only what it has read.
 * The answer is STAMPED with the inputs it was computed from, so a verdict that
 * lands after the author edited the predicate cannot describe the new one.
 */
export function useRequiredVisibleWhenReferenceReads(
  def: Record<string, unknown> | null | undefined,
  fieldTypes: Readonly<Record<string, unknown>>,
): string[] {
  const source = def && def.required === true ? predicateSource(def.visibleWhen) : null;
  const key = source ? JSON.stringify([source, fieldTypes]) : '';
  const [state, setState] = React.useState<{ key: string; fields: string[] }>({ key: '', fields: [] });

  React.useEffect(() => {
    if (!key || !source) return;
    let cancelled = false;
    void loadAnalyzer().then((analyze) => {
      if (cancelled || !analyze) return;
      const reader: TraversalReader = (src, root) => {
        try {
          return analyze(src, root)?.traversals ?? null;
        } catch {
          return null;
        }
      };
      setState({ key, fields: referenceReadsInRequiredVisibleWhen(def, fieldTypes, reader) });
    });
    return () => {
      cancelled = true;
    };
    // `key` carries `source` and `fieldTypes`; `def` is read through them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return key && state.key === key ? state.fields : [];
}
