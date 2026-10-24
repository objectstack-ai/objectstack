// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-IO helpers for the form-designer canvas + inspector.
 *
 * `draft.fields` can be either an array `[{name, ...def}, …]` (the
 * legacy / objectql shape) or a record `{name: def, …}` (the spec
 * shape used in `*.object.ts`). This module reads/writes both shapes
 * transparently and preserves arbitrary unknown properties on each
 * field — the inspector only edits the keys it knows about.
 *
 * Field reorders / inserts / removes are performed on a normalized
 * ordered list and serialized back to the input shape, so round-trips
 * are non-destructive.
 *
 * The one exception to "preserve unknown properties" is
 * {@link RETIRED_FIELD_KEYS} — see the note on that constant.
 */

// The retired-field-key tombstone registry lives at a dedicated internal
// subpath, not the main barrel — objectui#6527 option B (maintainer ruling,
// 2026-08-28): a barrel import eagerly evaluates every other barrel member
// (including `spec-report.ts`'s read of `@objectstack/spec/ui`), which is
// what widened an unrelated test's partial mock into a suite failure under
// the prior shape. A subpath import never pulls the barrel in.
import { retiredFieldKeysFor } from '@object-ui/types/internal/retired-field-keys';

import type { FieldTypeId } from './field-types.js';

export type Shape = 'array' | 'record';

/**
 * Field keys the ObjectStack spec REJECTS by name, stripped on read.
 *
 * Derived from the tombstone registry (`RETIRED_FIELD_KEY_TOMBSTONES` in
 * `@object-ui/types`, objectui#6527) — this door is the registry's
 * `metadataAdminFieldsReadDoor` site. The registry names each retired key, the
 * card that retired it, and which sites strip it; the per-key evidence lives
 * there. What stays HERE is this door's own contract:
 *
 * Every key this door strips is one a SHIPPED build wrote (verified per key,
 * objectui#6519), so a stored draft can still carry it inside a field —
 * `ObjectSchema.safeParse` reports it at `["fields", <name>]`, the hard 422
 * (`INVALID_METADATA`) that blocks EVERY subsequent save of the object, with
 * the writing controls retired and no UI path left to clear the key. Stripping
 * on load — not a data migration — is what makes an edit-and-save round-trip
 * of such a draft come out parseable. `readFields` is the single read door for
 * `draft.fields` across the whole object designer (inspector, form designer,
 * design surface, settings / validations / API panels), and `writeFields`
 * writes each def back verbatim, so one strip here covers every writer.
 * Nothing is lost on the way out: where the spec has a spelling for the
 * concept it is a SEPARATE key (`reference`, `system`) that is NOT stripped
 * and rides through untouched, which is what lets the designer read it back.
 *
 * ⚠️ That sentence was UNCONDITIONAL and, for one key, measurably false
 * (objectui#8896): it holds only where the draft ALSO carries the spec
 * spelling. A draft holding a relationship target ONLY as `referenceTo` had it
 * deleted here with nothing left behind. {@link stripRetiredFieldKeys} now
 * keeps that one value under `reference` before dropping the key, so the
 * sentence is true as written — see there for why the repair is keyed to this
 * key alone and is NOT a `specEquivalent` migration.
 *
 * ── The two registry keys this door deliberately does NOT strip ──
 *
 * `formula` — RULED, objectui#6526 option B (2026-08-27): this door reads
 * drafts a live editor also MIGRATES, which neither write-side carry-over
 * does. `ObjectFieldInspector` seeds its linting CEL editor from
 * `readPredicate(def.expression ?? def.formula)` and the first edit commits
 * the spec key and clears the alias (`patchDef({ expression: …, formula:
 * undefined })`) — the migration objectui#6043 preserved when it refused the
 * blind rename. Stripping here empties that editor and the authored source is
 * gone on the next save (measured on objectui#6519: with `formula` in this
 * list, the inspector's pin *commits edits to `expression` and migrates the
 * legacy `formula` key* goes RED with the editor rendering `""`). A `formula`
 * draft instead stays blocked at the server until the author makes that one
 * migrating edit, and the client-side 422 diagnostic names the field and
 * points at the Formula (CEL) editor (PR #6624).
 *
 * `sortOrder` — the premise fails: no writer on this tree ever populated a
 * field-level one (objectui#6045 — objectui#4687's zero-readers/zero-writers
 * shape, not a rename), so no draft this door reads can carry it, and a strip
 * would be dead code that reads like a measurement. This door's contract is
 * "add it on evidence, not defensively"; `MetadataService`'s carry-over keeps
 * it as that site's one recorded-DEFENSIVE entry instead. (The object-level
 * `sortOrder` on `ObjectDefinition` and the saved-view `sortOrder` in
 * `ObjectView` are different concepts living outside `fields` entirely, so
 * neither passes through this door.)
 *
 * Same shape as `PermissionAdvancedFacets`' `RETIRED_RLS_KEYS`
 * (objectstack#7130). Keyed to the tombstones, never a blanket unknown-key
 * purge: every other key the designer does not render still survives.
 * `object-fields-io.retiredKeys.test.ts` pins the derived list and both
 * absences from this door's side; the registry's own test pins the same facts
 * at the source.
 */
export const RETIRED_FIELD_KEYS = retiredFieldKeysFor('metadataAdminFieldsReadDoor');

/**
 * The pre-objectui#6041 spelling of a relationship target, and the spec key it
 * was renamed to.
 *
 * Named as a PAIR here rather than derived from the tombstone's
 * `specEquivalent`: the registry is explicit that `specEquivalent` is
 * "Documentation for the reader, NEVER an instruction to migrate a value
 * mechanically", because objectui#6043 refused exactly that for `formula` —
 * whose value is a LANGUAGE, so a blind rename launders non-CEL text into a
 * formula that parses green and evaluates to null. A relationship target is a
 * bare object NAME under both spellings, which is what makes reading it under
 * either one a read rather than a migration, and that fact is specific to this
 * one key.
 */
const RETIRED_REFERENCE_KEY = 'referenceTo';
const SPEC_REFERENCE_KEY = 'reference';

/** Does this value NAME a target object? Blank and non-string name none. */
function isUsableTarget(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Drop {@link RETIRED_FIELD_KEYS} from one field definition, keeping a
 * relationship target the draft holds ONLY under the retired spelling
 * (objectui#8896).
 *
 * ## The claim this repairs — it is this module's own, one paragraph up
 *
 * {@link RETIRED_FIELD_KEYS}' note said "Nothing is lost on the way out: where
 * the spec has a spelling for the concept it is a SEPARATE key (`reference`,
 * `system`) that is NOT stripped and rides through untouched". That holds only
 * when the draft ALSO carries the spec spelling. A draft holding the target
 * only as `referenceTo` had it deleted here with nothing left behind — and
 * this is the SINGLE read door for `draft.fields` across the whole object
 * designer, with `writeFields` writing each def back verbatim, so the loss
 * committed on the next save. `ObjectFieldInspector`'s target editor reads
 * `def.reference` and rendered empty; so did every other reader, because
 * objectui#6837's ruling ("protocol normalization belongs on the server, the
 * front end just executes the protocol") deleted the per-reader legacy arms.
 *
 * Recovering HERE is that ruling's own shape rather than an exception to it:
 * the door normalizes, the readers stay canonical. `reference_to` is the
 * ingestion choke points' business (`normalizeSchemaReferenceKeys`, which folds
 * it onto `reference`) and is deliberately not touched by this door, which
 * serves a WRITE path.
 *
 * ## Three things this does not do
 *
 * ⛔ The retired key still never survives — `FieldSchema` refuses it by name,
 * which is the whole reason this door strips.
 * ⛔ Never overwrites a live `reference`: the spec spelling is what the author
 * has been editing, and a stale legacy value beside it is the older truth.
 * ⛔ Never invents a target. `unrecognized_keys` fires on the key's PRESENCE,
 * so `referenceTo: ''` is a real stored state; recovering it would hand every
 * gate downstream a target that names no object.
 */
function stripRetiredFieldKeys(def: Record<string, unknown>): Record<string, unknown> {
  const present = RETIRED_FIELD_KEYS.filter((k) => k in def);
  if (present.length === 0) return def;
  const next = { ...def };
  for (const k of present) delete next[k];
  if (
    (present as readonly string[]).includes(RETIRED_REFERENCE_KEY)
    && !isUsableTarget(next[SPEC_REFERENCE_KEY])
    && isUsableTarget(def[RETIRED_REFERENCE_KEY])
  ) {
    next[SPEC_REFERENCE_KEY] = def[RETIRED_REFERENCE_KEY];
  }
  return next;
}

export interface FieldEntry {
  /** Canonical snake_case key. */
  name: string;
  /** Raw framework field definition (label, type, options, …). */
  def: Record<string, unknown>;
}

export interface FieldsView {
  shape: Shape;
  entries: FieldEntry[];
}

/** Read draft.fields into a normalized ordered list. */
export function readFields(fieldsInput: unknown): FieldsView {
  if (Array.isArray(fieldsInput)) {
    return {
      shape: 'array',
      entries: (fieldsInput as Array<Record<string, unknown>>).map((raw, i) => {
        const { name, ...rest } = raw ?? {};
        return {
          name: typeof name === 'string' && name ? name : `field_${i + 1}`,
          def: stripRetiredFieldKeys(rest as Record<string, unknown>),
        };
      }),
    };
  }
  if (fieldsInput && typeof fieldsInput === 'object') {
    return {
      shape: 'record',
      entries: Object.entries(fieldsInput as Record<string, Record<string, unknown>>).map(
        ([name, def]) => ({ name, def: stripRetiredFieldKeys({ ...(def ?? {}) }) }),
      ),
    };
  }
  return { shape: 'record', entries: [] };
}

/** Serialize the ordered list back to the original shape. */
export function writeFields(view: FieldsView): Record<string, unknown> | Array<Record<string, unknown>> {
  if (view.shape === 'array') {
    return view.entries.map((e) => ({ name: e.name, ...e.def }));
  }
  // ⛔ NEVER assign into a literal here (objectui#9237). `out[e.name] = e.def`
  // with `e.name === '__proto__'` invokes `Object.prototype`'s ONE accessor
  // instead of creating an own property, so the entry `readFields` just read
  // back vanishes before `JSON.stringify` sees it. `__proto__` is a spec-legal
  // stored field key (`ObjectSchema.fields`' grammar is `/^[a-z_][a-z0-9_]*$/`),
  // so the PUT body that results is ACCEPTED and the server stores the object
  // WITHOUT the field — silent destruction of stored metadata by an edit that
  // never touched it, not a recoverable 422. `Object.fromEntries` defines an
  // own property, which is the same reason `MetadataService.toFieldsMap` uses
  // it. `__proto__` is the only name that reproduces: every other
  // `Object.prototype` member is a data property that assignment shadows.
  return Object.fromEntries(view.entries.map((e) => [e.name, e.def]));
}

/** Find the index of a field by name. Returns -1 if not found. */
export function indexOfField(view: FieldsView, name: string): number {
  return view.entries.findIndex((e) => e.name === name);
}

/** Build a fresh field definition for the given type. */
export function newField(name: string, type: FieldTypeId, label?: string): FieldEntry {
  const def: Record<string, unknown> = { type, label: label ?? toLabel(name) };
  // Picklist-style fields start with no options; the OptionsEditor shows a
  // blank input row locally and only persists rows once they have a value, so
  // an unfilled row never trips the spec's identifier validation.
  if (type === 'select' || type === 'multiselect' || type === 'radio' || type === 'checkboxes') {
    def.options = [];
  }
  // objectui#12326 — a master-detail field starts required. On a
  // `controlled_by_parent` object the spec admits no other value (ADR-0055 §1),
  // and the save door refuses an omitted one. This builder does not see the
  // object, so it applies everywhere: elsewhere a non-required `master_detail`
  // is what the platform lint flags as a likely mistake
  // (`relationship/master-detail-required`), and the author can still clear it.
  if (type === 'master_detail') {
    def.required = true;
  }
  return { name, def };
}

/** Convert a snake_case name to a human-friendly Title Case label. */
export function toLabel(name: string): string {
  if (!name) return '';
  return name
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Normalize an arbitrary string into a valid snake_case field name. Input that
 * yields no machine name (empty, or only non-Latin characters) becomes the
 * placeholder `field`; {@link toFieldNameOrEmpty} is the same rule without it.
 */
export function toFieldName(raw: string): string {
  return toFieldNameOrEmpty(raw) || 'field';
}

/**
 * The strict {@link toFieldName} rule with no placeholder: `''` when the input
 * yields no machine name — a Label in a non-Latin script, or a cleared one.
 *
 * For a Name DERIVED from a Label (objectui#12789). The report and dataset
 * designers derived with `toFieldName`, so a Label like `收入` silently named
 * the item `field`, and a second such item collided with the first. An empty
 * derivation leaves the Name empty instead, as the object designer's `slugify`
 * does, so the save path asks the author for one. Every other input derives
 * exactly what `toFieldName` derives.
 */
export function toFieldNameOrEmpty(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const sanitized = lower
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (!sanitized) return '';
  if (!/^[a-z_]/.test(sanitized)) return `f_${sanitized}`;
  return sanitized;
}

/**
 * Prefix-stable variant of {@link toFieldName} for *live keystroke* input.
 *
 * The strict `toFieldName` trims a trailing `_`, which makes it impossible
 * to TYPE a multi-word identifier into a controlled input: the field's
 * `onChange` re-normalizes on every keystroke, so the instant the user
 * presses `_` the value is `"repair_"` -> trimmed to `"repair"` -> the
 * underscore vanishes before the next letter arrives, yielding
 * `"repairticket"` instead of `"repair_ticket"`. (Authors of non-Latin
 * locales hit this hardest: their label cannot derive a Latin slug, so
 * they MUST type the identifier by hand.)
 *
 * This variant keeps a single trailing `_` so typing can continue, and
 * returns `''` (not the `'field'` placeholder) on empty input so clearing
 * the box actually clears it. A trailing `_` is itself a valid identifier
 * per the spec ("starts with a letter, may contain letters/digits/`_`"),
 * so no separate commit-time trim is required for correctness; callers
 * that need a canonical form for a *complete* string (label->name
 * derivation, group keys) should keep using strict `toFieldName`.
 */
export function toFieldNameLoose(raw: string): string {
  const sanitized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/g, '') // trim leading only -- a trailing `_` must survive
    .replace(/_{2,}/g, '_');
  if (!sanitized) return '';
  if (!/^[a-z_]/.test(sanitized)) return `f_${sanitized}`;
  return sanitized;
}

/**
 * A declared field group (a.k.a. "section"). Lives at the object's top level as
 * `draft.fieldGroups`; individual fields opt into a group via
 * `Field.group === ObjectFieldGroup.key`.
 *
 * Named `ObjectFieldGroup`, which is the spec's own name for this shape
 * (`@objectstack/spec/data`, the `ObjectFieldGroupSchema` family), and
 * re-exported from there rather than re-declared.
 *
 * It used to be called `FieldGroup` — and `@objectstack/spec/studio` exports a
 * DIFFERENT `FieldGroup`: the Studio field-editor's own group config
 * (`{ key, label, icon?, defaultExpanded, order }`), which has no `collapse`
 * and adds `order`. The local doc comment nonetheless claimed `description` and
 * `collapse` were "spec-defined" — true of `ObjectFieldGroup`, false of the
 * `FieldGroup` the name actually resolved to. That is objectstack#4115's
 * planted-premise failure exactly: a correct sentence filed under a name that
 * points somewhere else. Key-for-key this is `ObjectFieldGroup`, so the fix is
 * to say so.
 *
 * Collapse semantics (unchanged, now single-sourced): `'none'` → not
 * collapsible; `'expanded'` → collapsible, open by default; `'collapsed'` →
 * collapsible, closed by default; `collapsible` / `collapsed` /
 * `defaultExpanded` are the legacy boolean aliases the shared
 * `deriveFieldGroupLayout` still normalizes.
 *
 * Derived from `z.input`, NOT the exported `ObjectFieldGroup` type (which is
 * `z.infer`, i.e. the OUTPUT side). The distinction is load-bearing here and is
 * the zod-specific trap the derivation guard's header warns about: `collapse`
 * carries `.default('none')`, so it is OPTIONAL to author and REQUIRED after
 * parsing. This designer is on the authoring side — `addGroup` creates
 * `{ key, label }` and lets the default apply — so the output type would make
 * the editor's own new-group shape unrepresentable. Using `z.infer` here
 * type-checks against a value nobody in this module ever holds.
 */
export type ObjectFieldGroup = z.input<typeof ObjectFieldGroupSchema>;

import type { z } from 'zod';
import type { ObjectFieldGroupSchema } from '@objectstack/spec/data';

/**
 * Read `draft.fieldGroups` into a normalized, well-typed list. Unknown/extra
 * authored props (icon, description, collapse, …) are PRESERVED so a
 * read-modify-write round-trip (rename/reorder/inspector edit) never silently
 * drops a property the source set — only `key`/`label` are coerced to strings.
 */
export function readGroups(fieldGroupsInput: unknown): ObjectFieldGroup[] {
  if (!Array.isArray(fieldGroupsInput)) return [];
  return fieldGroupsInput
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g) => ({
      ...g,
      key: typeof g.key === 'string' ? g.key : '',
      label: typeof g.label === 'string' ? g.label : '',
    }) as ObjectFieldGroup)
    .filter((g) => g.key);
}

/**
 * Derive a unique snake_case group key from a human label, avoiding
 * collisions with `existing` keys. Falls back to `group` / `group_N`.
 */
export function genGroupKey(label: string, existing: string[]): string {
  // toFieldName() bottoms out at "field"; for a *group* key prefer
  // "group" when the label carries no usable alphanumerics.
  const base = /[a-z0-9]/i.test(label) ? toFieldName(label) : 'group';
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/** Append a new group with a unique key derived from `label`. */
export function addGroup(groups: ObjectFieldGroup[], label: string): ObjectFieldGroup[] {
  const clean = label.trim() || 'New section';
  const key = genGroupKey(clean, groups.map((g) => g.key));
  return [...groups, { key, label: clean }];
}

/** Rename a group's label in place (key is stable). */
export function renameGroup(groups: ObjectFieldGroup[], key: string, label: string): ObjectFieldGroup[] {
  const clean = label.trim();
  if (!clean) return groups;
  return groups.map((g) => (g.key === key ? { ...g, label: clean } : g));
}

/**
 * Merge a partial patch onto one group (by key). A patch value of `undefined`
 * REMOVES that property (so e.g. resetting collapse to its `'none'` default
 * leaves no stale key behind) rather than persisting an explicit `undefined`.
 */
export function updateGroup(
  groups: ObjectFieldGroup[],
  key: string,
  patch: Partial<ObjectFieldGroup>,
): ObjectFieldGroup[] {
  return groups.map((g) => {
    if (g.key !== key) return g;
    const next = { ...g } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    return next as unknown as ObjectFieldGroup;
  });
}

/** Remove a group declaration (callers should also clear members' `group`). */
export function removeGroup(groups: ObjectFieldGroup[], key: string): ObjectFieldGroup[] {
  return groups.filter((g) => g.key !== key);
}

/** Move a group one slot up (-1) or down (+1), clamped to bounds. */
export function moveGroup(groups: ObjectFieldGroup[], key: string, dir: -1 | 1): ObjectFieldGroup[] {
  const idx = groups.findIndex((g) => g.key === key);
  if (idx < 0) return groups;
  const to = idx + dir;
  if (to < 0 || to >= groups.length) return groups;
  return moveArray(groups, idx, to);
}

/** Strip `group === key` from every field (used after removing a group). */
export function clearFieldGroup(view: FieldsView, key: string): FieldsView {
  return {
    shape: view.shape,
    entries: view.entries.map((e) =>
      e.def.group === key ? { name: e.name, def: { ...e.def, group: undefined } } : e,
    ),
  };
}

/** Generic immutable array move helper (also used by group reorder). */
export function moveArray<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Group entries by their `group` property, in `fieldGroups[]` order.
 * Fields with no group (or a group not declared in fieldGroups) land
 * in a trailing "Ungrouped" bucket.
 *
 * By default empty *declared* groups are dropped to avoid chrome noise
 * (read-only / preview). Pass `includeEmptyDeclared` while editing so a
 * freshly-added, still-empty section stays visible as a drop target.
 */
export interface GroupedEntries {
  key: string | null;
  label: string;
  entries: FieldEntry[];
}

export function groupEntries(
  view: FieldsView,
  fieldGroups: Array<{ key?: string; label?: string }> | undefined,
  opts?: { includeEmptyDeclared?: boolean },
): GroupedEntries[] {
  const declared = Array.isArray(fieldGroups) ? fieldGroups.filter((g) => typeof g?.key === 'string') : [];
  const buckets = new Map<string | null, GroupedEntries>();
  for (const g of declared) {
    buckets.set(g.key!, { key: g.key!, label: String(g.label ?? g.key), entries: [] });
  }
  const declaredKeys = new Set(declared.map((g) => g.key as string));
  for (const e of view.entries) {
    const g = typeof e.def.group === 'string' ? (e.def.group as string) : null;
    if (g && declaredKeys.has(g)) {
      buckets.get(g)!.entries.push(e);
    } else {
      if (!buckets.has(null)) buckets.set(null, { key: null, label: 'Ungrouped', entries: [] });
      buckets.get(null)!.entries.push(e);
    }
  }
  const includeEmpty = !!opts?.includeEmptyDeclared;
  // Drop empty declared buckets unless asked to keep them (edit mode).
  // The implicit "Ungrouped" bucket is only created when populated, so
  // it never shows empty.
  return Array.from(buckets.values()).filter((b) => b.entries.length > 0 || (includeEmpty && b.key !== null));
}

/* ─────────────── Review diff (current draft vs a baseline) ─────────────── */

export type FieldDiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface FieldDiffEntry {
  name: string;
  status: FieldDiffStatus;
  /** Sorted def keys that differ (only for `changed`). */
  changedKeys: string[];
}

export interface FieldsDiff {
  /** Per current-field status, keyed by field name. */
  byName: Record<string, FieldDiffEntry>;
  /** Baseline fields absent from the current draft (rendered as ghosts). */
  removed: FieldEntry[];
  counts: { added: number; changed: number; removed: number };
}

/** Stable equality for field-def values (small JSON — order-sensitive is fine). */
function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Def keys whose values differ between two field definitions, sorted. */
function changedDefKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) if (!valueEqual(a[k], b[k])) out.push(k);
  return out.sort();
}

/**
 * Diff the current `fields` against a `baseline` (e.g. the last published
 * version). Drives the canvas review mode: added / changed / removed
 * per field. Shape-agnostic — both inputs are read via {@link readFields}.
 */
export function diffFields(baselineInput: unknown, currentInput: unknown): FieldsDiff {
  const base = readFields(baselineInput);
  const cur = readFields(currentInput);
  const baseByName = new Map(base.entries.map((e) => [e.name, e] as const));
  const curNames = new Set(cur.entries.map((e) => e.name));

  const byName: Record<string, FieldDiffEntry> = {};
  let added = 0;
  let changed = 0;
  for (const e of cur.entries) {
    const b = baseByName.get(e.name);
    if (!b) {
      byName[e.name] = { name: e.name, status: 'added', changedKeys: [] };
      added += 1;
      continue;
    }
    const keys = changedDefKeys(b.def, e.def);
    if (keys.length) {
      byName[e.name] = { name: e.name, status: 'changed', changedKeys: keys };
      changed += 1;
    } else {
      byName[e.name] = { name: e.name, status: 'unchanged', changedKeys: [] };
    }
  }

  const removed = base.entries.filter((e) => !curNames.has(e.name));
  return { byName, removed, counts: { added, changed, removed: removed.length } };
}
