// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Metadata form ↔ Zod reconciliation** (#3786).
 *
 * Every entry in {@link METADATA_FORM_REGISTRY} is a hand-written `defineForm`
 * layout that names keys of a Zod schema it never imports. That is the
 * hand-copied-list shape #3786 was filed about: two descriptions of one key set,
 * a comment asking the next author to keep them in step, and nothing that fails
 * when they don't. Four of the seventeen forms had already drifted when this
 * file was written, each silently:
 *
 * | form | drift | what an author saw |
 * |---|---|---|
 * | `object` | `capabilities` — no such key (`enable`) | the whole Capabilities section saved nothing |
 * | `object` | 16 keys `FieldSchema` never declared | PII / Encrypted / Indexed / … toggles saved nothing |
 * | `report` | `aria`, `performance` pruned by #3496 | two Advanced fields saved nothing |
 * | `hook`, `action` | `body.memoryMb` absent | the L2 memory cap was unauthorable |
 * | `page` | `interfaceConfig.sort` absent | a page's default sort was unauthorable |
 *
 * All of it failed the same way: **no error**. `FieldSchema` / `ObjectSchema` are
 * deliberately not `.strict()`, so a key the schema does not declare parses clean
 * and is stripped on the way to storage — the ADR-0104 failure class the
 * `field.zod.ts` prune tombstone already names in prose.
 *
 * ## The two directions are not symmetric
 *
 * - **form-only** (the form offers a key the Zod does not accept) is *always* a
 *   defect. There is no design under which an author should be shown a control
 *   whose value is discarded. Not ledgerable.
 * - **zod-only** (the Zod accepts a key the form does not offer) is sometimes
 *   deliberate: a deprecated key kept out of new authoring, or a curated
 *   quick-add subset that defers to a fuller editor. Ledgerable — with a reason,
 *   checked below for non-vacuity and for still resolving on both sides, the
 *   #4045 / #4040 ledger discipline.
 *
 * ## "Accepts" is not "is in the shape" (#5280)
 *
 * The original predicate for the form-only direction was `key ∈ shape`. That was
 * the same question as "the author may write this key" right up until
 * `retiredKey()` (`shared/retired-key.ts`) existed — and then it stopped being.
 * A tombstone **deliberately keeps the key in the walked shape** (the retirement
 * kit's liveness ledger says so in as many words: the row stays *because* the
 * key stays), while typing it `z.never().optional()`. So a tombstoned key reads
 * as "the Zod accepts it" to `key ∈ shape`, and this gate stayed green over
 * eight `app` form controls whose every value was **hard-rejected** on save.
 *
 * That is the louder of the two failure modes, and it arrives earlier: an
 * undeclared key is silently stripped (or, on a `.strict()` schema, rejected as
 * unknown), whereas a tombstoned key fails the parse outright with the removal
 * prescription — a 422 the author should never have been able to provoke,
 * because the control should not have been on screen. Both are asserted below,
 * separately, so a failure names which one it is.
 *
 * The detector judges the **schema node** (`z.never()` under the optional
 * wrapper), never the key's name — the zod-side twin of `isRetired()` in
 * `scripts/build-schemas.ts`, which asks the same question of the emitted JSON
 * Schema (`{ "not": {} }`, Zod's rendering of `z.never()`).
 *
 * ## The walk is recursive (#14327)
 *
 * `nestedLists` once collected a hand-written list only for a **top-level**
 * entry carrying `fields`, so a repeater or composite nested inside another
 * nested list — the object designer's per-field `options` / roll-up lists and
 * its four `lifecycle.*` blocks — was outside the population entirely, not
 * reconciled loosely. That is how the options repeater offered an `icon` input
 * `SelectOptionSchema` refuses, through three hand-retirements of the same
 * offer-vs-door class, with this gate green throughout. The walk now descends
 * `entry.fields[*].fields` at every depth, keys each list by its dotted path,
 * and resolves the sub-schema by walking `subSchemaOf` down the same path
 * (unions looked through, arrays and records peeled). The ledger vocabulary is
 * unchanged — a `subset` / `omit` entry simply carries a dotted `path` — and
 * the walk is pinned at the bottom against a synthetic fixture, so a gate that
 * reaches nothing at depth two cannot report green.
 *
 * ## The coordinates include the root, and the overlay is not surface
 *
 * Two instruments the top-level direction (#19188) needs, neither of them
 * wired to an assertion here:
 *
 * - **The ledger had no top-level coordinate.** Every `path` was a
 *   `nestedLists` path, so a deliberate omission at the *top* level could not
 *   be recorded at all — the resolve test looks a coordinate up in
 *   `nestedLists(form)`, which yields only nested paths, and
 *   `subSchemaAt(root, '')` walks one empty segment because `''.split('.')` is
 *   `['']` and not `[]`. `ROOT_PATH` is that missing coordinate and
 *   `resolveCoordinate` is the single place that knows both spellings.
 * - **The ADR-0010 provenance/lock overlay is not authoring surface.** 132 of
 *   the 274 top-level keys no form offers are that overlay — 119 of them the
 *   seven `_`-prefixed envelope keys on all 17 forms, plus `protection` on 13
 *   — so a top-level zod-only direction without a skip is half overlay noise,
 *   and 132 ledger rows for one overlay with one reason is the wrong shape.
 *   `FRAMEWORK_FIELDS` skips it, mirroring the liveness gate, which grades the
 *   same set auto-live (`FRAMEWORK_FIELDS` in `scripts/liveness/`).
 *
 * Neither changes what this gate asserts: the top-level zod-only direction
 * stays unwired, and the skip is kept off every nested coordinate — where a
 * leg is asserting today, over a sub-schema that really does carry the
 * overlay.
 *
 * @see control-flow-form-zod-ledger.test.ts — same pattern for the flow designer
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { METADATA_FORM_REGISTRY } from './metadata-form-registry';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { ProtectionSchema } from '../shared/protection.zod';
import { retiredKey } from '../shared/retired-key';

// ────────────────────────────────────────────────────────────────────────────
// Coordinates — what a ledger `path` may say, including the one the dotted
// algebra has no spelling for.
// ────────────────────────────────────────────────────────────────────────────

/**
 * The ledger coordinate for a form's **top level**.
 *
 * Every other coordinate is a dotted path produced by `nestedLists`
 * (`fields`, `fields.options`, `lifecycle.ttl`). The top level is the
 * zero-segment path, and the dotted algebra has no zero-segment element, so it
 * needs a coordinate of its own. Why a sentinel and not `''`:
 *
 * - `''` is **falsy**, and `path ? … : …` is the load-bearing spelling in this
 *   very file (`nestedLists`' own `prefix` test). Any reader written that way
 *   reads the root coordinate as "no path given" — the one confusion a
 *   coordinate must not have.
 * - A `path` a future author leaves unfilled then cannot masquerade as a
 *   deliberate root row: `''` is not this sentinel, so an empty one fails the
 *   resolve test loudly instead of quietly excusing a top-level key.
 * - Parentheses cannot occur in a form's `field:` name, so the sentinel cannot
 *   collide with a real dotted path — asserted over the live registry below,
 *   rather than assumed.
 * - It reads unambiguously in a failure label: `object.(root).apiMethods`, not
 *   `object..apiMethods`.
 */
const ROOT_PATH = '(root)';

/**
 * The ADR-0010 provenance/lock overlay: system-stamped onto a metadata item by
 * the loader, never authored in a form. The liveness gate grades exactly this
 * set auto-live (`FRAMEWORK_FIELDS`, `scripts/liveness/check-liveness.mts`);
 * this is the reconciliation gate's equivalent, and it exists because the
 * overlay is 132 of the 274 top-level keys the forms do not offer.
 *
 * **Derived, not hand-copied.** The seven `_`-prefixed keys ARE
 * `MetadataProtectionFields` — the one raw shape every metadata schema spreads
 * — so a key added to or dropped from the envelope moves this set in the same
 * commit. A second copy of the liveness gate's eight names would have been the
 * hand-copied-list shape this whole file exists to abolish, and that `const`
 * is module-local to a `.mts` script, so there is nothing to import from it
 * anyway: the shape is the better source for both.
 *
 * `protection` is the one name written out. It is the author-facing block the
 * loader translates INTO that envelope (`applyProtection`,
 * `shared/protection.zod.ts`), spliced under that name by each schema rather
 * than carried in a shape of its own — so it is pinned below against what it
 * resolves to on every live type that declares it, and the name stays a
 * measured claim.
 */
const FRAMEWORK_FIELDS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(MetadataProtectionFields),
  'protection',
]);

/** Is `key` part of that overlay — i.e. not authoring surface at all? */
const isFrameworkField = (key: string): boolean => FRAMEWORK_FIELDS.has(key);

// ────────────────────────────────────────────────────────────────────────────
// Ledger — deliberate zod-only omissions. `omit` names one key; `subset`
// declares a whole nested list as a curated subset (coverage unenforced there,
// the form-only direction still is). `path` is a `nestedLists` path or
// {@link ROOT_PATH}.
// ────────────────────────────────────────────────────────────────────────────

type OmitEntry = { kind: 'omit'; type: string; path: string; key: string; why: string };
type SubsetEntry = { kind: 'subset'; type: string; path: string; why: string };

const LEDGER: ReadonlyArray<OmitEntry | SubsetEntry> = [
  {
    kind: 'omit',
    type: 'page',
    path: 'interfaceConfig',
    key: 'sourceView',
    why: '@deprecated legacy named-view inheritance, honored at runtime as a fallback but deliberately not offered to new authors — a page defines columns/sort/filterBy directly (ADR-0047 revised)',
  },
  {
    kind: 'omit',
    type: 'object',
    path: 'enable',
    key: 'apiMethods',
    why: 'the Capabilities block is a toggle grid; apiMethods is a method whitelist (array of ApiMethod) that needs its own control, and is authored on the object body rather than as a switch',
  },
  {
    kind: 'subset',
    type: 'object',
    path: 'fields',
    why: "the object editor's inline column grid is a QUICK-ADD surface covering the common authoring keys; the full per-field editor is `field.form.ts` (registered as the `field` metadata type), which is where the long tail of FieldSchema is authored",
  },
  // ── Depth two (#14327): the lists nested inside the `fields` quick-add row ──
  {
    kind: 'subset',
    type: 'object',
    path: 'fields.options',
    why: "one row of the `fields` quick-add grid (the subset entry above), so the same design applies one level down: an option is captured as label / value / color / description, and the long tail — `default`, the per-option `visibleWhen` CEL predicate — is authored in the full per-field editor (`field.form.ts`), whose `options` repeater is schema-derived and so offers every SelectOptionSchema key",
  },
  {
    kind: 'subset',
    type: 'object',
    path: 'fields.summaryOperations',
    why: "one row of the `fields` quick-add grid (the subset entry above): the roll-up is captured as object / field / function; `relationshipField` (auto-detected unless the child references this object twice) and the `filter` FilterCondition are authored in the full per-field editor (`field.form.ts`), whose own `summaryOperations` composite offers both with their dedicated widgets (`ref:object`, `filter-condition`)",
  },
  // ── Depth two (#14327): the lifecycle policy blocks ──
  {
    kind: 'omit',
    type: 'object',
    path: 'lifecycle.retention',
    key: 'onlyWhen',
    why: "a per-field row-filter map ({ field: value | { $in: [...] } | { $null: bool } }) with no scalar rendering among the block's text inputs; every writer of it today is a platform system object declared in code — sys_job_queue, sys_automation_run, the storage service's system_file / system_upload_session — where the interleaved live-vs-terminal rows it exists for live. A Studio-authored object gets the plain age window; offering the filter needs a structured control, a form-face addition rather than a reconciliation",
  },
  {
    kind: 'omit',
    type: 'object',
    path: 'lifecycle.ttl',
    key: 'onlyWhen',
    why: "the mirror of `retention.onlyWhen` — one shape by design (`lifecycleOnlyWhenSchema`, object.zod.ts) — with the same boundary: a row-filter map with no scalar rendering among the ttl block's text inputs, and its one writer today is the code-declared sys_session object (`revoked_at: { $null: true }`). Offering it needs a structured control, a form-face addition rather than a reconciliation",
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Zod introspection — reads `.def` directly so the test needs no `zod` import
// beyond what the schemas already are, and tolerates the `lazySchema` proxy.
// ────────────────────────────────────────────────────────────────────────────

/** Peel wrapper nodes until an object/union/record-value node is reached. */
function unwrap(schema: unknown, depth = 0): any {
  const s = schema as any;
  if (!s || depth > 25) return s;
  const d = s.def ?? s._def;
  if (!d) return s;
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return unwrap(d.innerType, depth + 1);
    case 'array':
      return unwrap(d.element, depth + 1);
    case 'record':
      return unwrap(d.valueType, depth + 1);
    case 'lazy':
      return unwrap(d.getter(), depth + 1);
    case 'pipe': {
      // #4488's finding, applied here at #5074: `a.transform(fn)` authors
      // against the IN side, while `z.preprocess(fn, schema)` puts the TRANSFORM
      // on IN and the authorable schema on OUT. Taking `def.in` unconditionally
      // made this gate report `view` as "not key-bearing" — i.e. stop
      // reconciling it — the moment `ViewMetadataSchema` gained its
      // console-decoration preprocess. Same shape as the `translation` outage
      // #4488 fixed in `check-liveness.mts`.
      const inner = unwrap(d.in, depth + 1);
      const innerType = (inner?.def ?? inner?._def)?.type;
      return innerType === 'transform' ? unwrap(d.out, depth + 1) : inner;
    }
    default:
      return s;
  }
}

/**
 * Keys an object node accepts, or `null` when the node is not key-bearing.
 * A union contributes the union of its members' keys — an author may legally
 * write any member's key, so offering one is not a form-only defect.
 */
function keysOf(schema: unknown): string[] | null {
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (d?.type === 'object') return Object.keys(d.shape ?? u.shape ?? {}).sort();
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    const all = new Set<string>();
    let keyBearing = false;
    for (const option of d.options ?? []) {
      const k = keysOf(option);
      if (k) {
        keyBearing = true;
        for (const key of k) all.add(key);
      }
    }
    return keyBearing ? Array.from(all).sort() : null;
  }
  return null;
}

/**
 * Is this property node a **tombstone** — `retiredKey()`, i.e.
 * `z.never().optional().describe(…)`?
 *
 * Judged on the node, not on the key's name: a name list would have to be
 * hand-maintained here, which is the very hand-copied-list defect #3786 exists
 * to abolish. `unwrap` peels the `optional` (and any other wrapper a future
 * tombstone spelling adds), leaving the `never` for the shape test — the same
 * fact `scripts/build-schemas.ts` reads on the JSON-Schema side as `{ not: {} }`.
 */
function isRetiredNode(prop: unknown): boolean {
  const u = unwrap(prop);
  const d = u?.def ?? u?._def;
  return d?.type === 'never';
}

/**
 * Is `key` unwritable at `schema` — declared, but only as a tombstone?
 *
 * A union needs care in the safe direction: one member may tombstone the key
 * while another still declares it live, and an author may legally write the
 * live member's shape. So a key counts as retired only when **every** member
 * that declares it tombstones it.
 */
function isRetiredAt(schema: unknown, key: string): boolean {
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    let declaredSomewhere = false;
    for (const option of d.options ?? []) {
      if (!keysOf(option)?.includes(key)) continue;
      declaredSomewhere = true;
      if (!isRetiredAt(option, key)) return false;
    }
    return declaredSomewhere;
  }
  if (d?.type === 'object') {
    const prop = (d.shape ?? u.shape ?? {})[key];
    return prop !== undefined && isRetiredNode(prop);
  }
  return false;
}

/**
 * Keys an author may actually write: declared **and** not a tombstone. This is
 * what `keysOf` was being used as before #5280, and what it never was.
 */
function authorableKeysOf(schema: unknown): string[] | null {
  const keys = keysOf(schema);
  return keys ? keys.filter((k) => !isRetiredAt(schema, k)) : null;
}

/** The sub-schema stored under `key`, looking through union members. */
function subSchemaOf(schema: unknown, key: string): unknown {
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (d?.type === 'object') return (d.shape ?? u.shape ?? {})[key];
  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    for (const option of d.options ?? []) {
      const found = subSchemaOf(option, key);
      if (found) return found;
    }
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Form introspection
// ────────────────────────────────────────────────────────────────────────────

type FormEntry = { field?: string; fields?: FormEntry[]; keyField?: { field?: string } };

/** Top-level `field:` names a form offers, across every section. */
function topLevelFields(form: any): string[] {
  const names: string[] = [];
  for (const section of form.sections ?? []) {
    for (const entry of (section.fields ?? []) as FormEntry[]) {
      if (entry?.field) names.push(entry.field);
    }
  }
  return names.sort();
}

type NestedList = { path: string; depth: number; offered: string[] };

/**
 * Every nested list a form spells out by hand — `{ field, fields: [...] }` under
 * a composite / repeater / record entry — at **any** depth, keyed by the dotted
 * path from the section root (`fields`, `fields.options`, `lifecycle.ttl`).
 * These are the hand-copied lists; an entry with no `fields` is derived from
 * the schema by the renderer and cannot drift.
 *
 * Recursive since #14327: the walk used to stop at the section's own entries,
 * so a repeater inside a record editor — where the object designer keeps its
 * per-field option and roll-up lists — was outside the population entirely.
 */
function nestedLists(form: any): NestedList[] {
  const out: NestedList[] = [];
  const walk = (entries: FormEntry[], prefix: string, depth: number) => {
    for (const entry of entries) {
      if (!entry?.field || !Array.isArray(entry.fields) || entry.fields.length === 0) continue;
      const path = prefix ? `${prefix}.${entry.field}` : entry.field;
      const offered = entry.fields.map((f) => f?.field).filter((f): f is string => !!f);
      // A record editor authors its map key through `keyField`, so that name is
      // offered even though it is not in the `fields` array — at every depth.
      if (entry.keyField?.field) offered.push(entry.keyField.field);
      out.push({ path, depth, offered: offered.sort() });
      walk(entry.fields, path, depth + 1);
    }
  };
  for (const section of form.sections ?? []) walk((section.fields ?? []) as FormEntry[], '', 1);
  return out;
}

/**
 * The sub-schema a dotted form path lands on: one `subSchemaOf` step per
 * segment, so every level looks through unions and peels the array / record
 * wrapper a repeater or record editor sits under. `undefined` as soon as a
 * segment is not declared — the caller reports that as an unanchored list.
 */
function subSchemaAt(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const segment of path.split('.')) {
    node = subSchemaOf(node, segment);
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * The two sides a ledger coordinate resolves to: the keys the form offers
 * there, and the schema node they are judged against. `undefined` when the
 * form has no hand-written list at that coordinate any more — the state the
 * resolve test reports.
 *
 * The root coordinate is why this is a function rather than a
 * `nestedLists(form).find(…)` at the call site. `nestedLists` yields only
 * nested paths, so a root entry looked up there is always missing, and
 * `subSchemaAt(root, '')` resolves to `undefined` because the walk takes one
 * empty segment. The top level is resolved instead from the pair that actually
 * describes it: every `field:` across every section, against the type's own
 * root schema.
 */
function resolveCoordinate(
  form: any,
  root: unknown,
  path: string,
): { offered: string[]; sub: unknown } | undefined {
  if (path === ROOT_PATH) return { offered: topLevelFields(form), sub: root };
  const list = nestedLists(form).find((l) => l.path === path);
  return list ? { offered: list.offered, sub: subSchemaAt(root, path) } : undefined;
}

/**
 * The keys a form could offer at a coordinate: authorable (not a tombstone),
 * and — at the root coordinate **only** — not the ADR-0010 overlay. `null`
 * when the node is not key-bearing, same as `authorableKeysOf`.
 *
 * The skip stops at the root deliberately. The overlay is spread into nested
 * shapes as well (three times in `view.zod.ts` alone), and one hand-written
 * nested list resolves to a sub-schema carrying all seven `_`-prefixed keys:
 * `object.fields`, whose `subset` entry has to keep earning its place against
 * the keys the quick-add grid really could offer. Skipping the overlay there
 * would move a number a leg reads today — and the top-level direction this
 * instrument is for is not that leg.
 */
function offerableKeysAt(sub: unknown, path: string): string[] | null {
  const keys = authorableKeysOf(sub);
  if (!keys) return null;
  return path === ROOT_PATH ? keys.filter((k) => !isFrameworkField(k)) : keys;
}

type Ledger = ReadonlyArray<OmitEntry | SubsetEntry>;
const TYPES = Object.keys(METADATA_FORM_REGISTRY);
const ledgerFor = (ledger: Ledger, type: string, path: string) =>
  ledger.filter((e) => e.type === type && e.path === path);
const isSubset = (ledger: Ledger, type: string, path: string) =>
  ledgerFor(ledger, type, path).some((e) => e.kind === 'subset');
const omittedAt = (ledger: Ledger, type: string, path: string) =>
  ledgerFor(ledger, type, path).flatMap((e) => (e.kind === 'omit' ? [e.key] : []));

/**
 * One hand-written nested list, judged against the sub-schema its dotted path
 * resolves to. Empty arrays are the passing state; `unanchored` means the path
 * resolved to nothing key-bearing, so the three key sets could not be judged.
 */
type NestedVerdict = {
  path: string;
  depth: number;
  unanchored: boolean;
  /** offered by the form, not declared by the Zod — silently dropped on save */
  formOnly: string[];
  /** offered by the form, tombstoned in the Zod — hard-fails the save */
  retired: string[];
  /** authorable in the Zod, not offered by the form, not excused by the ledger */
  zodOnly: string[];
};

/**
 * The nested-list predicate: one form against one root schema and one ledger.
 * The `it.each` below applies it to the registry; the self-test at the bottom
 * applies the SAME function to a synthetic fixture, which is what makes "the
 * gate reaches depth two" a measured fact rather than an assumption.
 */
function reconcileNestedLists(type: string, form: any, root: unknown, ledger: Ledger): NestedVerdict[] {
  return nestedLists(form).map(({ path, depth, offered }) => {
    const sub = subSchemaAt(root, path);
    const subKeys = keysOf(sub);
    if (!subKeys) return { path, depth, unanchored: true, formOnly: [], retired: [], zodOnly: [] };
    const excused = omittedAt(ledger, type, path);
    return {
      path,
      depth,
      unanchored: false,
      formOnly: offered.filter((k) => !subKeys.includes(k)),
      retired: offered.filter((k) => isRetiredAt(sub, k)),
      // A tombstoned key needs no ledger entry to excuse its absence — the
      // *only* correct thing to do with it is not offer it. Demanding one back
      // (or a ledger row for it) is this gate's blind spot inverted: before
      // #5280 the sole thing keeping `object.fields.conditionalRequired` off
      // this list was an unrelated `subset` entry, i.e. luck.
      zodOnly: isSubset(ledger, type, path)
        ? []
        : subKeys.filter((k) => !offered.includes(k) && !excused.includes(k) && !isRetiredAt(sub, k)),
    };
  });
}

describe('metadata form ↔ Zod reconciliation (#3786)', () => {
  it('the registry is non-empty and every form resolves a schema', () => {
    // Without this the per-type assertions below would pass over an empty set —
    // the failure mode a reconciliation test must not have.
    expect(TYPES.length).toBeGreaterThan(10);
    for (const type of TYPES) {
      expect(getMetadataTypeSchema(type), `no Zod schema registered for '${type}'`).toBeDefined();
    }
  });

  it.each(TYPES)('%s: every field the form offers is a key the author may write', (type) => {
    const root = getMetadataTypeSchema(type);
    const rootKeys = keysOf(root);
    expect(rootKeys, `${type}: root schema is not key-bearing`).toBeTruthy();
    const offered = topLevelFields(METADATA_FORM_REGISTRY[type]);

    // An offered key the schema does not declare is silently stripped on save —
    // the author fills the control and the value never lands.
    expect(
      offered.filter((f) => !rootKeys!.includes(f)),
      `${type}: offered by the form but not declared by the Zod (saved value is dropped)`,
    ).toEqual([]);

    // An offered key the schema TOMBSTONES is worse than dropped: `retiredKey()`
    // is `z.never()`, so filling the control fails the whole save with the
    // removal prescription. The control must not exist (#5280).
    expect(
      offered.filter((f) => isRetiredAt(root, f)),
      `${type}: offered by the form but RETIRED in the Zod (retiredKey tombstone — filling the control hard-fails the save). Delete the form entry and leave a comment naming the retirement`,
    ).toEqual([]);
  });

  it.each(TYPES)('%s: every hand-written nested list matches its sub-schema', (type) => {
    const root = getMetadataTypeSchema(type);

    // `expect.soft`, so one run names EVERY list that drifted in this form
    // rather than the first: a form carries several hand-written lists, and a
    // gate that reports one per red build is the sequential-artifact failure
    // mode AGENTS.md describes for `check:generated` — triage wants the table.
    for (const v of reconcileNestedLists(type, METADATA_FORM_REGISTRY[type], root, LEDGER)) {
      // A non-key-bearing sub-schema (a plain array of scalars, say) has nothing
      // to reconcile against — but a hand-written list under it is then
      // unanchored, so say so rather than skipping silently.
      expect.soft(v.unanchored, `${type}.${v.path}: hand-written sub-list over a non-key-bearing schema`).toBe(false);

      expect.soft(
        v.formOnly,
        `${type}.${v.path}: offered by the form but not declared by the Zod (saved value is dropped)`,
      ).toEqual([]);

      expect.soft(
        v.retired,
        `${type}.${v.path}: offered by the form but RETIRED in the Zod (retiredKey tombstone — filling the control hard-fails the save). Delete the form entry and leave a comment naming the retirement`,
      ).toEqual([]);

      expect.soft(
        v.zodOnly,
        `${type}.${v.path}: accepted by the Zod but unauthorable in the form — offer it, or add a ledger entry`,
      ).toEqual([]);
    }
  });

  it('every ledger entry still resolves on both sides', () => {
    // Stops the ledger rotting into references to keys that were renamed or
    // removed, and stops an `omit` outliving the omission it excuses.
    for (const entry of LEDGER) {
      const root = getMetadataTypeSchema(entry.type);
      expect(root, `ledger references unknown metadata type '${entry.type}'`).toBeDefined();

      // One lookup for both coordinate spellings — a dotted `nestedLists`
      // path, and the root.
      const at = resolveCoordinate(METADATA_FORM_REGISTRY[entry.type], root, entry.path);
      expect(at, `${entry.type}.${entry.path}: no hand-written list at this path any more`).toBeDefined();

      // Authorable, not merely present, and at the root not the overlay: the
      // keys the form COULD offer here. `null` iff the node is not key-bearing,
      // which is the same fact `keysOf` reports.
      const offerable = offerableKeysAt(at!.sub, entry.path);
      expect(offerable, `${entry.type}.${entry.path}: sub-schema is not key-bearing any more`).toBeTruthy();

      if (entry.kind === 'omit') {
        // The overlay is skipped at the root, so a row naming one of its keys
        // excuses an omission that was never owed — the same reasoning
        // `reconcileNestedLists` applies to a tombstone: the only correct thing
        // to do with a key that is not authoring surface is not to offer it,
        // and no ledger row is owed for it.
        if (entry.path === ROOT_PATH) {
          expect(
            isFrameworkField(entry.key),
            `${entry.type}.${entry.path}.${entry.key}: an ADR-0010 provenance/lock overlay field, skipped at the root coordinate — a ledger row excuses nothing here. Drop the entry`,
          ).toBe(false);
        }

        // An `omit` whose key has since been TOMBSTONED is excusing an omission
        // that is now mandatory, and the entry has to go — otherwise the
        // ledger's own "still resolves" check is what keeps a dead excuse alive.
        expect(
          offerable,
          `${entry.type}.${entry.path}.${entry.key}: not an authorable key any more — removed, or retired to a tombstone (a retired key is excused automatically). Drop the ledger entry`,
        ).toContain(entry.key);
        expect(
          at!.offered,
          `${entry.type}.${entry.path}.${entry.key}: the form offers it now — drop the ledger entry`,
        ).not.toContain(entry.key);
      } else {
        // A `subset` that covers everything is no longer a subset — counted over
        // the keys the form could offer, so neither a tombstone left in the
        // shape nor (at the root) the overlay can prop up an entry whose real
        // coverage gap has closed.
        expect(
          offerable!.filter((k) => !at!.offered.includes(k)).length,
          `${entry.type}.${entry.path}: the form now covers the whole authorable schema — drop the ledger entry`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('the ledger is not vacuous and every entry carries a reason', () => {
    expect(LEDGER.length).toBeGreaterThan(0);
    for (const entry of LEDGER) {
      const label = `${entry.type}.${entry.path}${entry.kind === 'omit' ? `.${entry.key}` : ''}`;
      expect(entry.why.length, `${label} needs a reason a reader can act on`).toBeGreaterThan(20);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The tombstone predicate itself (#5280).
//
// Pinned against a SYNTHETIC schema rather than against whichever live schema
// happens to carry a tombstone today: tombstones age out (`retired-key.ts` says
// ~two majors), and a self-test anchored to one would either rot or, worse, go
// quietly vacuous the release its anchor is deleted — leaving a gate that
// filters nothing and still reports green.
// ────────────────────────────────────────────────────────────────────────────

describe('retiredKey tombstones are not authoring surface (#5280)', () => {
  const probe = z.object({
    gone: retiredKey('`Probe.gone` was removed in @objectstack/spec 17.0.0. Delete the key.'),
    live: z.string().optional(),
  });

  it('a tombstone stays in the shape — which is exactly why `key ∈ shape` was the wrong predicate', () => {
    expect(keysOf(probe)).toEqual(['gone', 'live']);
    expect(isRetiredAt(probe, 'gone')).toBe(true);
    expect(isRetiredAt(probe, 'live')).toBe(false);
    expect(authorableKeysOf(probe)).toEqual(['live']);
  });

  it('and the value it rejects fails the parse outright, carrying its prescription', () => {
    // The half of the story the old assertion's wording ("silently stripped on
    // save") could not describe: this one is loud, and earlier.
    const result = probe.safeParse({ gone: 'anything', live: 'ok' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join('\n')).toContain('was removed in @objectstack/spec');
    expect(probe.safeParse({ live: 'ok' }).success).toBe(true);
  });

  it('detects by schema node, not by key name', () => {
    // A key NAMED like a retirement but declared live is authorable; a key with
    // an unremarkable name that is `z.never()` is not. Nothing here may depend
    // on a hand-maintained list of retired names — that list is the #3786 defect.
    const named = z.object({
      sharing: z.string().optional(),
      ordinary: retiredKey('`Named.ordinary` was removed in @objectstack/spec 17.0.0. Delete the key.'),
    });
    expect(isRetiredAt(named, 'sharing')).toBe(false);
    expect(isRetiredAt(named, 'ordinary')).toBe(true);
  });

  it('a key still declared live by one union member stays authorable', () => {
    // Safe direction: an author may write the live member's shape, so offering
    // the key is not a defect even though another member tombstones it.
    const union = z.union([
      z.object({
        kind: z.literal('a'),
        shared: retiredKey('`A.shared` was removed in @objectstack/spec 17.0.0. Delete the key.'),
      }),
      z.object({ kind: z.literal('b'), shared: z.string().optional() }),
    ]);
    expect(keysOf(union)).toEqual(['kind', 'shared']);
    expect(isRetiredAt(union, 'shared')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The nested walk itself (#14327).
//
// A gate observed only green is indistinguishable from a gate that matches
// nothing — which is exactly what the depth-one walk was, at depth two, for as
// long as it existed. Two kinds of pin: the live registry's deep lists, by
// name, so the population cannot collapse back to depth one unnoticed; and a
// SYNTHETIC form + schema run through the same `reconcileNestedLists`, so the
// predicate is shown to go red on a depth-two form-only key (positive control)
// and green on a depth-two designed subset carrying its ledger entry (negative
// control).
// ────────────────────────────────────────────────────────────────────────────

describe('the nested walk reaches every depth (#14327)', () => {
  it('the live registry has hand-written lists below depth one, and the walk reaches them', () => {
    const deep = TYPES.flatMap((type) =>
      nestedLists(METADATA_FORM_REGISTRY[type])
        .filter((l) => l.depth >= 2)
        .map((l) => `${type}.${l.path}`),
    );
    // The six the depth-one walk never reached, measured over all seventeen
    // registered forms when this pin was written: the object designer keeps
    // its per-field and lifecycle blocks one level down. Named, not counted —
    // a count would pass over any six.
    expect(deep).toEqual(
      expect.arrayContaining([
        'object.fields.options',
        'object.fields.summaryOperations',
        'object.lifecycle.retention',
        'object.lifecycle.ttl',
        'object.lifecycle.storage',
        'object.lifecycle.archive',
      ]),
    );
  });

  // A record editor (keyed by `name`) whose rows carry a repeater — the object
  // designer's shape in miniature, with one tombstone in the deep shape so the
  // retired direction is exercised at depth two as well.
  const schema = z.object({
    items: z.record(
      z.string(),
      z.object({
        name: z.string(),
        label: z.string(),
        options: z
          .array(
            z.object({
              label: z.string(),
              value: z.string(),
              extra: z.string().optional(),
              gone: retiredKey('`Probe.options.gone` was removed in @objectstack/spec 17.0.0. Delete the key.'),
            }),
          )
          .optional(),
      }),
    ),
  });
  const form = (optionInputs: string[]) => ({
    sections: [
      {
        fields: [
          {
            field: 'items',
            type: 'record',
            keyField: { field: 'name' },
            fields: [
              { field: 'label' },
              { field: 'options', type: 'repeater', fields: optionInputs.map((field) => ({ field })) },
            ],
          },
        ],
      },
    ],
  });
  const at = <T extends { path: string }>(xs: T[], path: string) => xs.find((x) => x.path === path);

  it('keys the lists by dotted path and resolves each level through the record and the array', () => {
    const lists = nestedLists(form(['label', 'value']));
    expect(lists.map((l) => [l.path, l.depth])).toEqual([
      ['items', 1],
      ['items.options', 2],
    ]);
    expect(at(lists, 'items')?.offered).toEqual(['label', 'name', 'options']);
    expect(keysOf(subSchemaAt(schema, 'items.options'))).toEqual(['extra', 'gone', 'label', 'value']);
    expect(subSchemaAt(schema, 'items.nothing')).toBeUndefined();
  });

  it('positive control: a form-only key two levels down is reported at its dotted path', () => {
    const verdicts = reconcileNestedLists('probe', form(['label', 'value', 'icon']), schema, []);
    expect(at(verdicts, 'items')?.formOnly).toEqual([]);
    expect(at(verdicts, 'items.options')?.formOnly).toEqual(['icon']);
  });

  it('positive control: a tombstoned key offered two levels down is reported as retired, not as form-only', () => {
    const verdicts = reconcileNestedLists('probe', form(['label', 'value', 'gone']), schema, []);
    expect(at(verdicts, 'items.options')?.retired).toEqual(['gone']);
    expect(at(verdicts, 'items.options')?.formOnly).toEqual([]);
  });

  it('negative control: a designed depth-two subset is green with its ledger entry and red without', () => {
    const offered = form(['label', 'value']);
    const bare = reconcileNestedLists('probe', offered, schema, []);
    // `gone` is a tombstone and is excused automatically; `extra` is the gap.
    expect(at(bare, 'items.options')?.zodOnly).toEqual(['extra']);

    const asSubset = reconcileNestedLists('probe', offered, schema, [
      { kind: 'subset', type: 'probe', path: 'items.options', why: 'synthetic: the probe row is a quick-add subset' },
    ]);
    expect(at(asSubset, 'items.options')?.zodOnly).toEqual([]);

    const asOmit = reconcileNestedLists('probe', offered, schema, [
      { kind: 'omit', type: 'probe', path: 'items.options', key: 'extra', why: 'synthetic: extra is deliberately not offered' },
    ]);
    expect(at(asOmit, 'items.options')?.zodOnly).toEqual([]);

    // An entry at the PARENT path excuses nothing one level down — the ledger
    // is keyed by the full dotted path, so a subset row cannot cover its
    // children by accident.
    const misfiled = reconcileNestedLists('probe', offered, schema, [
      { kind: 'subset', type: 'probe', path: 'items', why: 'synthetic: the parent list is a subset' },
    ]);
    expect(at(misfiled, 'items.options')?.zodOnly).toEqual(['extra']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The root coordinate, and the overlay skip.
//
// Both are instruments for the top-level direction (#19188), and both are
// pinned the way the depth-two walk above is: a SYNTHETIC form and schema
// driven through the same `resolveCoordinate` / `offerableKeysAt` the live
// resolve test uses, plus two readings taken from the live registry — so "a
// root entry can be recorded" and "the overlay is skipped at the root and
// nowhere else" are measured facts rather than assumptions.
//
// What is deliberately NOT here: an assertion that the top-level zod-only set
// is empty. It is not — 274 keys across the 17 forms, 132 of them this overlay
// — and wiring that direction is #19188's work, not this instrument's.
// ────────────────────────────────────────────────────────────────────────────

describe('the ledger has a root coordinate, and the overlay is not surface', () => {
  const schema = z.object({
    name: z.string(),
    label: z.string().optional(),
    tags: z.array(z.string()).optional(),
    gone: retiredKey('`Probe.gone` was removed in @objectstack/spec 17.0.0. Delete the key.'),
    nested: z.object({ a: z.string(), b: z.string().optional(), ...MetadataProtectionFields }).optional(),
    protection: ProtectionSchema.optional(),
    ...MetadataProtectionFields,
  });
  const form = {
    sections: [
      { fields: [{ field: 'name' }, { field: 'label' }] },
      { fields: [{ field: 'nested', fields: [{ field: 'a' }] }] },
    ],
  };

  it('the root coordinate resolves to the top-level pair, which no nested path can', () => {
    // The failure mode the coordinate exists to end, named: the resolve test
    // looks a coordinate up among the hand-written lists, and those are nested
    // by construction — the root is never among them.
    expect(nestedLists(form).map((l) => l.path)).toEqual(['nested']);
    expect(nestedLists(form).find((l) => l.path === ROOT_PATH)).toBeUndefined();

    const at = resolveCoordinate(form, schema, ROOT_PATH);
    expect(at?.offered).toEqual(['label', 'name', 'nested']);
    expect(at?.sub).toBe(schema);
    // …and the zod side is the whole top-level shape, so a key no section
    // offers is reachable from the coordinate at all.
    expect(keysOf(at?.sub)).toContain('tags');
  });

  it('the empty string is not the coordinate — an unfilled path fails loudly instead', () => {
    // Why the coordinate is a sentinel: a row whose `path` was never filled in
    // must not read as a deliberate root row. `''` resolves to nothing on
    // either side, which is what the resolve test reports as "no hand-written
    // list at this path any more".
    expect(resolveCoordinate(form, schema, '')).toBeUndefined();
    expect(subSchemaAt(schema, '')).toBeUndefined();
  });

  it('no live form has a hand-written list at the sentinel, so it cannot be shadowed', () => {
    // Dark control over the real registry: parentheses cannot occur in a
    // `field:` name, and this is what keeps that a measurement.
    const collisions = TYPES.flatMap((type) =>
      nestedLists(METADATA_FORM_REGISTRY[type])
        .filter((l) => l.path === ROOT_PATH)
        .map((l) => `${type}.${l.path}`),
    );
    expect(collisions).toEqual([]);
  });

  it('the overlay set IS the ADR-0010 shape, not a second hand-copied list', () => {
    const envelope = Object.keys(MetadataProtectionFields);
    expect(envelope.length).toBeGreaterThan(0);
    expect([...FRAMEWORK_FIELDS].sort()).toEqual([...envelope, 'protection'].sort());
    // Every `_`-prefixed member comes from the shape — nothing is hand-added
    // beside it, so the envelope cannot drift away from the skip.
    expect([...FRAMEWORK_FIELDS].filter((k) => k.startsWith('_')).sort()).toEqual([...envelope].sort());

    // `protection` is the one name written out, so it is pinned against what it
    // resolves to on every live type that declares it.
    const declaring = TYPES.filter((type) => (keysOf(getMetadataTypeSchema(type)) ?? []).includes('protection'));
    expect(declaring.length).toBeGreaterThan(0);
    for (const type of declaring) {
      expect(
        keysOf(subSchemaOf(getMetadataTypeSchema(type), 'protection')),
        `${type}.protection no longer resolves to ProtectionSchema's shape — the one hand-written name in the overlay set`,
      ).toEqual(keysOf(ProtectionSchema));
    }
  });

  it('positive control: the overlay drops out of the offerable keys at the root, and nothing else does', () => {
    expect(FRAMEWORK_FIELDS.size).toBeGreaterThan(0);
    const offerable = offerableKeysAt(schema, ROOT_PATH)!;
    for (const key of FRAMEWORK_FIELDS) {
      expect(keysOf(schema), `the probe must declare ${key} for this control to measure anything`).toContain(key);
      expect(offerable, `${key} is overlay and must not be offerable at the root`).not.toContain(key);
    }
    // The skip is narrow: an ordinary key the form does not offer is still
    // offerable, so the top-level direction keeps something to ask for.
    expect(offerable).toContain('tags');
    // And a tombstone is still excluded — by `authorableKeysOf`, not by the skip.
    expect(offerable).not.toContain('gone');
  });

  it('dark control: the skip does not reach a nested coordinate, live instance included', () => {
    // Applying it below the root would move a number an asserting leg reads
    // today: `object.fields` resolves to a sub-schema carrying the whole
    // envelope, and its `subset` entry is judged on how much of that schema the
    // quick-add grid does NOT cover.
    const envelope = Object.keys(MetadataProtectionFields);
    expect(offerableKeysAt(subSchemaAt(schema, 'nested'), 'nested')).toEqual(expect.arrayContaining(envelope));
    expect(offerableKeysAt(subSchemaAt(getMetadataTypeSchema('object'), 'fields'), 'fields')).toEqual(
      expect.arrayContaining(envelope),
    );
  });

  it('a top-level omission is recordable, and a row naming the overlay is not', () => {
    // The whole point of the coordinate, driven through the same two functions
    // the live resolve test uses: `tags` is authorable, unoffered and not
    // overlay, so a root `omit` for it resolves on both sides…
    const at = resolveCoordinate(form, schema, ROOT_PATH)!;
    const offerable = offerableKeysAt(at.sub, ROOT_PATH)!;
    expect(offerable).toContain('tags');
    expect(at.offered).not.toContain('tags');
    expect(isFrameworkField('tags')).toBe(false);

    // …while a root `omit` naming an overlay key is the row the resolve test
    // rejects: it is not offerable there, and the predicate says why.
    expect(isFrameworkField('_lock')).toBe(true);
    expect(isFrameworkField('protection')).toBe(true);
    expect(offerable).not.toContain('_lock');
  });
});
