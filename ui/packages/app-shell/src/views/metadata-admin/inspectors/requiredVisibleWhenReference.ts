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
 * ## A `formula` the predicate reads
 *
 * The server computes each formula the predicate reads over the record being
 * saved; the form judges the formula value it last read, does not recompute it
 * while the user edits, and has none on a create. So a save can be
 * refused naming a field the form keeps hidden, and the advisory says so for
 * any formula read. A formula the server cannot compute on a save at all (it
 * reads through a reference, calls `label()` or `current_user.can()`, or reads
 * such a formula) keeps the field required on every save, which the advisory
 * says too; a `can` call only on a save that picks no permission-gated option
 * (a save that picks one resolves the permission map, and the server computes
 * it). The server's fourth mark, a formula reading the acting user on a system
 * write with no user, is not advised: a save from Studio's form always has a
 * user. The lint's `required-visible-when-formula-issue.ts` is the same
 * verdict at `objectstack validate`.
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

/* ── Formula reads (ADR-0113 D1, as amended) ──────────────────────────── */

/** The fields a source reads as values or through, over one root; `null` when the reader cannot say. */
export type FieldReader = (source: string, root: string) => { bare: ReadonlySet<string>; through: ReadonlySet<string> } | null;

/** A call of `label(`, spelled as the server's `planCallsOptionLabel` reads it. */
const LABEL_CALL = /\blabel\s*\(/;

/**
 * The `formula` fields a `required` field's `visibleWhen` reads, and which of
 * them the server cannot compute on a save: a formula that reads through a
 * reference, calls `label()` or calls `current_user.can()`, or reads such a
 * formula at any depth (the server's `unservableReason`). Both empty when the
 * field is not required, has no predicate, or the predicate reads no formula.
 *
 * Any formula read draws the advisory: the form judges the predicate on the
 * formula value it last read and does not recompute it, while the server
 * judges the record being saved. An unservable one keeps the field required on
 * every save.
 */
export function formulaReadsInRequiredVisibleWhen(
  def: Record<string, unknown> | null | undefined,
  siblings: Readonly<Record<string, Record<string, unknown> | undefined>>,
  readFields: FieldReader,
  callsCan: (source: string) => boolean,
): { formulas: string[]; unservable: string[] } {
  const none = { formulas: [], unservable: [] };
  if (!def || def.required !== true) return none;
  const source = predicateSource(def.visibleWhen);
  if (!source) return none;
  const isFormula = (name: string) => siblings[name]?.type === 'formula';
  const formulas: string[] = [];
  for (const root of ['record', 'previous']) {
    const reads = readFields(source, root);
    if (!reads) continue;
    for (const name of [...reads.bare, ...reads.through]) if (isFormula(name) && !formulas.includes(name)) formulas.push(name);
  }
  if (formulas.length === 0) return none;
  const verdicts = new Map<string, boolean>();
  const unservable = (name: string): boolean => {
    const known = verdicts.get(name);
    if (known !== undefined) return known;
    verdicts.set(name, false);
    const expr = predicateSource(siblings[name]?.expression);
    let blocked = false;
    if (expr) {
      const reads = readFields(expr, 'record');
      const hop = reads ? [...reads.through].some((f) => {
        const type = siblings[f]?.type;
        return typeof type === 'string' && REFERENCE_VALUE_TYPES.has(type);
      }) : false;
      blocked = hop || LABEL_CALL.test(expr) || callsCan(expr)
        || [...(reads?.bare ?? []), ...(reads?.through ?? [])].some((f) => isFormula(f) && unservable(f));
    }
    verdicts.set(name, blocked);
    return blocked;
  };
  return { formulas, unservable: formulas.filter(unservable) };
}

/* ── The lazily loaded traversal reader ───────────────────────────────── */

type Analyze = (source: string, root: string) => {
  traversals: ReadonlyMap<string, unknown>;
  bareFields?: ReadonlySet<string>;
} | null;
type ParseAst = (source: string) => unknown;

let analyzeCached: Promise<Analyze | null> | null = null;
let parseCached: Promise<ParseAst | null> | null = null;

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

function loadParser(): Promise<ParseAst | null> {
  if (!parseCached) {
    parseCached = import('@objectstack/formula')
      .then(({ parseCelToAst }) => (typeof parseCelToAst === 'function' ? (parseCelToAst as unknown as ParseAst) : null))
      .catch(() => null);
  }
  return parseCached;
}

/** Does a cel-js AST hold a receiver call named `method` (`current_user.can(…)`)? */
export function callsReceiverMethod(node: unknown, method: string): boolean {
  if (Array.isArray(node)) return node.some((child) => callsReceiverMethod(child, method));
  if (typeof node !== 'object' || node === null) return false;
  const { op, args } = node as { op?: unknown; args?: unknown };
  if (typeof op !== 'string') return false;
  if (op === 'rcall' && Array.isArray(args) && args[0] === method) return true;
  return callsReceiverMethod(args, method);
}

/**
 * The formula advisory for one field draft, stamped with its inputs like the
 * reference one below. Empty while the parser loads and when it is unavailable.
 */
export function useRequiredVisibleWhenFormulaReads(
  def: Record<string, unknown> | null | undefined,
  siblings: Readonly<Record<string, Record<string, unknown> | undefined>>,
): { formulas: string[]; unservable: string[] } {
  const source = def && def.required === true ? predicateSource(def.visibleWhen) : null;
  const key = source ? JSON.stringify([source, siblings]) : '';
  const [state, setState] = React.useState<{ key: string; formulas: string[]; unservable: string[] }>({ key: '', formulas: [], unservable: [] });

  React.useEffect(() => {
    if (!key || !source) return;
    let cancelled = false;
    void Promise.all([loadAnalyzer(), loadParser()]).then(([analyze, parse]) => {
      if (cancelled || !analyze) return;
      const readFields: FieldReader = (src, root) => {
        try {
          const a = analyze(src, root);
          return a ? { bare: a.bareFields ?? new Set<string>(), through: new Set(a.traversals.keys()) } : null;
        } catch {
          return null;
        }
      };
      const callsCan = (src: string) => {
        if (!parse) return false;
        try {
          return callsReceiverMethod(parse(src), 'can');
        } catch {
          return false;
        }
      };
      setState({ key, ...formulaReadsInRequiredVisibleWhen(def, siblings, readFields, callsCan) });
    });
    return () => {
      cancelled = true;
    };
    // `key` carries `source` and `siblings`; `def` is read through them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return key && state.key === key ? { formulas: state.formulas, unservable: state.unservable } : { formulas: [], unservable: [] };
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
