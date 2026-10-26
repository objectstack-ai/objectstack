// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The author-time refusal of an OBJECT-required field placed inside a
 * predicate-gated form section (objectui#6900).
 *
 * ## The hazard
 *
 * The server validates a record against the object's field definitions and
 * never reads a form view — ruled on objectstack#13252 (option C, "a validator
 * consuming view metadata", rejected). So a form view whose section is shown
 * only when a predicate holds, and which holds a field the object declares
 * `required`, saves fine as METADATA and then cannot be completed by anyone
 * the predicate hides the section from: the record save is refused naming a
 * field they cannot see.
 *
 * ## Where the refusal lives, and why it may block
 *
 * Ruling 5749269225 (letter c) lands it as a blocking issue in the view
 * inspector's `onBlockingIssuesChange` channel — the channel already licensed
 * to gate Save — and keeps the live Zod pass (`validateMetadataDraft`)
 * advisory. The channel's licence is that the server ACCEPTS the draft it
 * refuses, which holds here: nothing server-side reads a section predicate.
 *
 * ## Which predicates are fenced — the step-1 table's rows 7–11, and only those
 *
 * The step-1 measurement on the card sorted section predicates into twelve
 * shapes by whether the object's own field rule (`requiredWhen`, which the
 * server DOES enforce) can restate them. The SPLIT ruling fences only the rows
 * that cannot be restated — {@link GATED_SECTION_ROOTS}: identity
 * (`current_user` and its ADR-0068 aliases `user`, `ctx.user`, `os.user`),
 * `features`, `app` (host) and `page` (page state). A `record` / `previous`
 * predicate, a bare field, a constant and the reverse-direction `parent` draw
 * nothing: those rows are served by the build-time lint teaching, ⛔ no fence.
 *
 * `data` is deliberately NOT a fenced root. The table made it binding-
 * dependent — row 6 when it names the row, row 10 when it names the host's
 * data-source adapter — and on this tree no runtime tier binds it as the
 * adapter any more (`buildExpressionScope` publishes none, objectui#8166;
 * `SchemaRenderer` dropped its `data: dataSource`, objectui#9308). What is left
 * is the row spelling, which `@objectstack/lint` already teaches to rewrite as
 * `record.FIELD` — row 6.
 *
 * ## The roots are read by the parser, never by a pattern
 *
 * `collectCelRootIdentifiers` is the `@objectstack/formula` export the server's
 * own closed-root sites use. It is loaded LAZILY, as every CEL affordance in
 * this designer is (`celAuthoring.ts`): the parser stays off the eager graph,
 * and the one symbol is destructured in the callback so the namespace does not
 * escape into the cached promise. A source that does not parse is not this
 * check's verdict to give — syntax belongs to the CEL gates — so it draws
 * nothing here, and neither does an engine that failed to load.
 *
 * ## The spellings a form view's sections arrive in
 *
 * - `sections[]`, or the legacy `groups[]` alias when `sections` is ABSENT —
 *   the precedence `@objectstack/spec`'s own fold applies (`sections` wins when
 *   present, an empty array included);
 * - a section's `visibleWhen` as a bare CEL string or a `{ dialect, source }`
 *   envelope (a non-`cel` dialect is not read);
 * - a member as a field NAME string or a `{ field }` entry.
 *
 * Every layout arm (`simple`, `tabbed`, `wizard`, `split`, `drawer`, `modal`)
 * reads the same `sections[]`, so none is special-cased. A `{ group }` section
 * inherits its predicate from the object's `fieldGroups`, not from this view,
 * and is outside this check.
 */

import * as React from 'react';
import type { ObjectFieldInfo } from '../previews/useObjectFields.js';

/**
 * The expression roots whose section predicate the object's field rules cannot
 * restate — the step-1 table's rows 7–11. See the module note for why `data`
 * is not here.
 */
export const GATED_SECTION_ROOTS: readonly string[] = [
  'current_user',
  'user',
  'ctx',
  'os',
  'features',
  'app',
  'page',
];

const GATED = new Set(GATED_SECTION_ROOTS);

/** One form section, read into the shape this check needs. */
export interface FormSectionRef {
  /** Position in the section list the view renders. */
  index: number;
  /** What the author sees the section called: its label, else its name, else `#N`. */
  title: string;
  /** The `visibleWhen` CEL source, or `null` when the section is not gated. */
  predicate: string | null;
  /** Member field names, in declared order. */
  members: string[];
}

/** One refusal: an object-required field inside a section gated on a fenced root. */
export interface RequiredInGatedSectionIssue {
  sectionIndex: number;
  section: string;
  predicate: string;
  /** The fenced roots the predicate reads. */
  roots: string[];
  field: string;
  fieldLabel: string;
}

/** Reads a predicate's top-level roots; `null` when it does not parse. */
export type CelRootReader = (source: string) => string[] | null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The CEL source of a section's `visibleWhen`, or `null` when there is none. */
export function sectionPredicateSource(section: Record<string, unknown>): string | null {
  const raw = section.visibleWhen;
  let source: unknown;
  if (typeof raw === 'string') source = raw;
  else if (isRecord(raw)) {
    if (raw.dialect !== undefined && raw.dialect !== 'cel') return null;
    source = raw.source;
  }
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  return trimmed ? trimmed : null;
}

/** A section's member field names: string entries and `{ field }` entries. */
export function sectionMemberNames(section: Record<string, unknown>): string[] {
  const fields = section.fields;
  if (!Array.isArray(fields)) return [];
  const out: string[] = [];
  for (const entry of fields) {
    if (typeof entry === 'string' && entry) out.push(entry);
    else if (isRecord(entry) && typeof entry.field === 'string' && entry.field) out.push(entry.field);
  }
  return out;
}

/** The sections a form view body renders, in order. */
export function readFormSections(body: Record<string, unknown> | undefined): FormSectionRef[] {
  if (!body) return [];
  const list = body.sections !== undefined ? body.sections : body.groups;
  if (!Array.isArray(list)) return [];
  const out: FormSectionRef[] = [];
  list.forEach((section, index) => {
    if (!isRecord(section)) return;
    const label = typeof section.label === 'string' && section.label ? section.label : '';
    const name = typeof section.name === 'string' && section.name ? section.name : '';
    out.push({
      index,
      title: label || name || `#${index + 1}`,
      predicate: sectionPredicateSource(section),
      members: sectionMemberNames(section),
    });
  });
  return out;
}

/** The field names the object declares `required: true`, with their labels. */
function requiredFieldLabels(fields: readonly ObjectFieldInfo[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fields) if (f.required === true) out.set(f.name, f.label || f.name);
  return out;
}

/**
 * The predicates worth parsing: gated sections that hold at least one
 * object-required member. Deduplicated, in first-seen order.
 */
export function predicatesToRead(
  sections: readonly FormSectionRef[],
  fields: readonly ObjectFieldInfo[],
): string[] {
  const required = requiredFieldLabels(fields);
  const seen = new Set<string>();
  for (const s of sections) {
    if (s.predicate && s.members.some((m) => required.has(m))) seen.add(s.predicate);
  }
  return [...seen];
}

/** Every object-required field sitting in a section gated on a fenced root. */
export function findRequiredInGatedSections(
  sections: readonly FormSectionRef[],
  fields: readonly ObjectFieldInfo[],
  rootsOf: CelRootReader,
): RequiredInGatedSectionIssue[] {
  const required = requiredFieldLabels(fields);
  const issues: RequiredInGatedSectionIssue[] = [];
  for (const s of sections) {
    if (!s.predicate) continue;
    const members = s.members.filter((m) => required.has(m));
    if (members.length === 0) continue;
    const roots = rootsOf(s.predicate);
    if (!roots) continue;
    const gated = [...new Set(roots.filter((r) => GATED.has(r)))];
    if (gated.length === 0) continue;
    for (const field of new Set(members)) {
      issues.push({
        sectionIndex: s.index,
        section: s.title,
        predicate: s.predicate,
        roots: gated,
        field,
        fieldLabel: required.get(field) ?? field,
      });
    }
  }
  return issues;
}

/* ── The lazily loaded root reader ─────────────────────────────────────── */

type CollectRoots = (source: string) => { ok: true; roots: string[] } | { ok: false; error: string };

let readerCached: Promise<CollectRoots | null> | null = null;

function loadRootReader(): Promise<CollectRoots | null> {
  if (!readerCached) {
    readerCached = import('@objectstack/formula')
      .then(({ collectCelRootIdentifiers }) =>
        typeof collectCelRootIdentifiers === 'function' ? (collectCelRootIdentifiers as CollectRoots) : null,
      )
      .catch(() => null);
  }
  return readerCached;
}

function readRoots(reader: CollectRoots | null, source: string): string[] | null {
  if (!reader) return null;
  try {
    const res = reader(source);
    return res.ok ? res.roots : null;
  } catch {
    return null;
  }
}

/**
 * The refusals for one form view body against its object's field catalog.
 *
 * Empty while the parser loads, while the catalog loads, and when either is
 * unavailable — this check refuses only what it has read. The parsed roots are
 * STAMPED with the predicate list they answer (a primitive key), so a verdict
 * that lands after the author edited a predicate cannot describe the new one.
 */
export function useRequiredInGatedSectionIssues(
  body: Record<string, unknown> | undefined,
  fields: readonly ObjectFieldInfo[],
): RequiredInGatedSectionIssue[] {
  const sections = readFormSections(body);
  const key = JSON.stringify(predicatesToRead(sections, fields));
  const [parsed, setParsed] = React.useState<{ key: string; roots: Record<string, string[] | null> }>({
    key: '[]',
    roots: {},
  });

  React.useEffect(() => {
    const sources = JSON.parse(key) as string[];
    if (sources.length === 0) return;
    let cancelled = false;
    void loadRootReader().then((reader) => {
      if (cancelled) return;
      const roots: Record<string, string[] | null> = {};
      for (const source of sources) roots[source] = readRoots(reader, source);
      setParsed({ key, roots });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (parsed.key !== key) return [];
  return findRequiredInGatedSections(sections, fields, (source) =>
    Object.prototype.hasOwnProperty.call(parsed.roots, source) ? parsed.roots[source] : null,
  );
}
