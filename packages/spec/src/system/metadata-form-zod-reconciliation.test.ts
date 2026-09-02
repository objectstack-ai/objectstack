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
 * @see control-flow-form-zod-ledger.test.ts — same pattern for the flow designer
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { METADATA_FORM_REGISTRY } from './metadata-form-registry';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { retiredKey } from '../shared/retired-key';

// ────────────────────────────────────────────────────────────────────────────
// Ledger — deliberate zod-only omissions. `omit` names one key; `subset`
// declares a whole nested list as a curated subset (coverage unenforced there,
// the form-only direction still is).
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

      const lists = nestedLists(METADATA_FORM_REGISTRY[entry.type]);
      const list = lists.find((l) => l.path === entry.path);
      expect(list, `${entry.type}.${entry.path}: no hand-written list at this path any more`).toBeDefined();

      const sub = subSchemaAt(root, entry.path);
      const subKeys = keysOf(sub);
      expect(subKeys, `${entry.type}.${entry.path}: sub-schema is not key-bearing any more`).toBeTruthy();

      if (entry.kind === 'omit') {
        // Authorable, not merely present: an `omit` whose key has since been
        // TOMBSTONED is excusing an omission that is now mandatory, and the
        // entry has to go — otherwise the ledger's own "still resolves" check
        // is what keeps a dead excuse alive.
        expect(
          authorableKeysOf(sub),
          `${entry.type}.${entry.path}.${entry.key}: not an authorable key any more — removed, or retired to a tombstone (a retired key is excused automatically). Drop the ledger entry`,
        ).toContain(entry.key);
        expect(
          list!.offered,
          `${entry.type}.${entry.path}.${entry.key}: the form offers it now — drop the ledger entry`,
        ).not.toContain(entry.key);
      } else {
        // A `subset` that covers everything is no longer a subset — counted over
        // AUTHORABLE keys, so a tombstone left in the shape cannot prop up an
        // entry whose real coverage gap has closed.
        expect(
          authorableKeysOf(sub)!.filter((k) => !list!.offered.includes(k)).length,
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
