/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7322 — `ObjectKanbanSchema.groupBy` / `.limit` declared and
 * `.groupField` RETIRED, on both faces.
 *
 * ⚠️ SUPERSEDED IN ONE RESPECT (objectui#8990): this card also made `groupBy`
 * REQUIRED, and that half is reversed — `@objectstack/spec` declares
 * `groupBy: z.string().optional()`, so requiring it made this package refuse a
 * document the protocol accepts. The two pins that asserted requiredness now
 * assert optionality and say so at their site. Everything else this file pins
 * — that `groupBy`/`limit` are DECLARED and ENFORCED, that `groupField` is a
 * tombstone with zero read sites, and the read-site census — is unchanged, and
 * the CONTROL added beside the flipped pin is what keeps "optional" from
 * quietly decaying into "undeclared".
 *
 * ## The defect
 *
 * `packages/plugin-kanban/src/ObjectKanban.tsx` — the component the
 * `object-kanban` registration renders — read `schema.groupBy` at thirteen
 * sites (lane materialisation, card moves, their effect deps) and
 * `schema.limit` at two (`$top: schema.limit ?? DEFAULT_KANBAN_LIMIT` and the
 * effect deps) WHEN THIS CARD MEASURED IT — the `limit` half has since moved,
 * see the objectui#9925 note closing this section. `groupField` has ZERO read
 * sites anywhere under `packages/plugin-kanban/`. Yet the declaration in
 * `../objectql.ts` REQUIRED `groupField` and declared neither `groupBy` nor
 * `limit`, and the zod mirror in `../zod/objectql.zod.ts` restated it.
 * Measured on `53ded82b` from source:
 * the documented, tested, working shape — `{ type: 'object-kanban',
 * objectName, groupBy, limit }` — FAILED `ObjectKanbanSchema.safeParse` and
 * `safeValidateSchema` on the missing `groupField`, while a `groupField`-only
 * node parsed green and rendered a board that grouped nothing. `groupBy` and
 * `limit` only ever reached the renderer through `BaseSchema`'s
 * `[key: string]: any` and `.passthrough()` — admitted, never examined.
 *
 * ⚠️ THE `limit` READING ABOVE IS THE ONE objectui#7322 MEASURED, NOT TODAY'S
 * (objectui#9925). That card made the board REFUSE a non-positive row cap
 * before it reaches the wire, and both halves of the reading moved with it:
 * the spelling is now `$top: resolveRowLimit(schema.limit,
 * DEFAULT_KANBAN_FETCH_BATCH_SIZE)` (the constant renamed by objectui#9853), and
 * the `schema.limit` CODE read sites are FOUR, not
 * two — that `$top`, its effect's deps, the refusal diagnostic and that
 * diagnostic's own effect deps. The older reading is left standing rather than
 * rewritten away because it is the measurement that motivated the declaration;
 * what is LIVE is `READ_TEXT` below, which a test re-derives off disk every
 * run, while this paragraph is prose nothing re-checks. The thirteen
 * `groupBy` sites are untouched by that card.
 *
 * ## What this file pins, and the shapes it borrows
 *
 * The declare half is `chat-message-avatar-keys-7295.test.ts` /
 * `checkbox-wrapper-class-6938.test.ts`: membership is asserted on the mirror's
 * OWN `.shape`, never on parse acceptance (under `.passthrough()` acceptance
 * cannot tell "declared" from "admitted unexamined"); the type-level pins use
 * invariant equality so an undeclared key — which resolves to `any` through
 * the index signature — reads as a failure rather than a match; and the CONTROL
 * is a key the renderer does NOT read, derived from its source, which stays
 * undeclared on both faces and is still admitted unexamined. That is the half
 * that keeps this from being a widening.
 *
 * The retire half is `TimelineSchema.timeScale` (objectui#6355): `?: never` on
 * the TS face and `retirementTombstone()` on the mirror, BOTH halves, so the
 * retired spelling is refused BY NAME on each face rather than deleted into the
 * index signature where it would type-check green and go on doing nothing.
 *
 * ## Node-local, and the second control that proves it
 *
 * `groupField` is NOT a dead key in general. The VIEW-LEVEL kanban config's
 * `groupField` is a legacy alias of the spec's `groupByField` that is still READ:
 * `normalize-list-view.ts` maps it and `ListView` / `ObjectView` read it (the
 * view-level door has refused it by name since objectui#6152 round 11, so a
 * stored view that carries it still renders but an authored one is refused). Those
 * sites are pinned OFF DISK below as a control — if one stops reading the alias
 * this file turns red, because the retirement's stated boundary moved.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ObjectKanbanSchema } from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { ObjectKanbanSchema as TsObjectKanbanSchema } from '../objectql';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const READER = 'packages/plugin-kanban/src/ObjectKanban.tsx';
const MIRROR = 'packages/types/src/zod/objectql.zod.ts';
const DOC = 'content/docs/plugins/plugin-kanban.mdx';

const DECLARED = ['groupBy', 'limit'] as const;
type Declared = (typeof DECLARED)[number];
const RETIRED = 'groupField';

/**
 * Exact source text of the reads, as they stand today. Line numbers drift and
 * live in the docblocks' prose only; the READ is the fact.
 *
 * The `limit` text was RE-POINTED by objectui#9925, which is what that rule
 * prescribes rather than an exception to it. The pinned FACT is that the
 * renderer lowers `schema.limit` into the query's top-level `$top`; that fact
 * survived intact and only its spelling moved. `??` rejects `null` and
 * `undefined` and nothing else, so an authored `limit: 0` was not nullish, rode
 * through as a real window and reached the wire as `$top: 0` — on a key
 * `@objectstack/spec` declares a POSITIVE integer. `resolveRowLimit` refuses
 * that value instead of forwarding it. Same file, same reader, same named
 * `query` object, same key, and still ONE `toContain`: the pin keeps the
 * strength it had, and the new string is narrow enough that the retired `??`
 * spelling could not satisfy it either.
 */
const READ_TEXT: Record<Declared, readonly string[]> = {
  groupBy: [
    'if (!schema.objectName || !schema.groupBy) return col;',
    'if (schema.groupBy && objectDef?.fields?.[schema.groupBy]?.options) {',
    'const groupBy = schema.groupBy;',
  ],
  limit: ['$top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)'],
};
/**
 * The default the `limit` docblock names. objectui#9853 renamed the constant to
 * a fetch batch (ruling 5824040487, structure B) and kept its value.
 */
const DEFAULT_LIMIT_TEXT = 'export const DEFAULT_KANBAN_FETCH_BATCH_SIZE = 100;';

/**
 * A plausible lane-key spelling the renderer never reads (the read set below
 * is derived, not asserted). It stays undeclared on both faces — the proof that
 * the change declares the keys the renderer honours and nothing else.
 */
const CONTROL_KEY = 'laneField';
/** A declared-keys-only control of the read set: read, declared, untouched. */
const READ_CONTROL_KEY = 'objectName';

/**
 * The VIEW-LEVEL `groupField` alias sites, off disk. The tombstone this file pins
 * is on the `object-kanban` NODE only, and when it landed `groupField` was LIVE at
 * every one of these sites. objectui#6152 round 14 retired the view-level reads
 * too, on their own ruling (every list-view door refuses the alias), so the
 * renderer sites below now pin the ABSENCE of the old read beside the PRESENCE of
 * the canonical one that replaced it: a site that stopped reading the lane at all
 * fails the presence half.
 */
const RETIRED_VIEW_LEVEL_ALIAS_SITES: ReadonlyArray<readonly [file: string, retired: string, canonical: string]> = [
  [
    'packages/plugin-list/src/ListView.tsx',
    'schema.options?.kanban?.groupField',
    'if (schema.kanban?.groupByField || schema.options?.kanban?.groupByField) {',
  ],
  ['packages/plugin-view/src/ObjectView.tsx', 'kanbanCfg.groupField ||', 'kanbanCfg.groupByField ||'],
];
/**
 * The core fold's alias table, retired in the same round: `normalizeListViewSchema`
 * no longer folds the view-level alias onto the spec key either.
 */
const VIEW_LEVEL_ALIAS_FOLD = [
  'packages/core/src/utils/normalize-list-view.ts',
  "kanban: { groupField: 'groupByField', cardFields: 'columns' }",
] as const;
/**
 * …and the same alias, still DECLARED on the view-level config in this very mirror file —
 * since objectui#6152 round 11 as a by-name REFUSAL naming `groupByField` (the spec's
 * list-view kanban slot refuses it). A different refusal from this node's tombstone:
 * that one says nothing reads the key, this one names what to write. Since
 * objectui#6152 round 14 the renderer reads above are retired as well.
 */
const VIEW_LEVEL_ALIAS_MIRROR_TEXT = 'groupField: KanbanBlockAliasRefusals.groupField,';

/** The documented row-cap node; every assertion below is a delta on it. */
const NODE = { type: 'object-kanban', objectName: 'opportunity', groupBy: 'stage' } as const;

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;
/** An object with no keys is assignable to `Pick<T, K>` only when `K` is optional on `T`. */
type IsOptional<T, K extends keyof T> = Record<string, never> extends Pick<T, K> ? true : false;

// `groupBy`: declared `string`, OPTIONAL since objectui#8990, not `any`. Were
// the member removed, the indexed access fell back to the index signature and
// resolved to `any` until objectui#8347 (it stops compiling now); either way the
// pin goes red — so the DECLARED-ness this card pinned is still pinned; only its requiredness moved.
export type _GroupByIsString = Expect<Equal<TsObjectKanbanSchema['groupBy'], string | undefined>>;
export type _GroupByIsNotAny = Expect<Equal<IsAny<TsObjectKanbanSchema['groupBy']>, false>>;
// objectui#8990 — `@objectstack/spec` declares `groupBy: z.string().optional()`;
// requiring it here made this package narrower than the protocol. The lane-key
// facts this card measured are untouched: the renderer still reads `groupBy`
// and never `groupField`, which is what the read-site census below pins.
export type _GroupByIsOptional = Expect<IsOptional<TsObjectKanbanSchema, 'groupBy'>>;
// `limit`: declared `number`, optional, not `any`.
export type _LimitIsNumberOrUndefined = Expect<Equal<TsObjectKanbanSchema['limit'], number | undefined>>;
export type _LimitIsNotAny = Expect<Equal<IsAny<TsObjectKanbanSchema['limit']>, false>>;
export type _LimitIsOptional = Expect<IsOptional<TsObjectKanbanSchema, 'limit'>>;
// `groupField`: a `?: never` tombstone — the only value it admits is absence.
// Deleting the member instead would make this pin red (`any` through the index
// signature until objectui#8347, a non-compiling indexed access since), which is
// the point: the tombstone is load-bearing.
export type _GroupFieldIsTombstone = Expect<Equal<TsObjectKanbanSchema['groupField'], undefined>>;
export type _GroupFieldIsNotAny = Expect<Equal<IsAny<TsObjectKanbanSchema['groupField']>, false>>;
// The control key is NOT declared: it resolved to `any` through the index
// signature, exactly as `groupBy` and `limit` did before this card, until
// objectui#8347 removed the signature; it is no member now. Declaring it turns
// this red — which is the point.
export type _ControlKeyIsNoMember = Expect<Equal<'laneField' extends keyof TsObjectKanbanSchema ? true : false, false>>;
// Lit control for the detector: `IsAny` does answer `true`, so the `IsNotAny` lines are readings.
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;

// The TS face accepts the documented shape on a literal — the exact node the
// doc page's row-cap block now annotates.
const literal: TsObjectKanbanSchema = { ...NODE, limit: 250 };
// …REFUSES the retired spelling on a literal (a string is not `never`). This
// directive goes unused — and the type-check goes red with TS2578 — the moment
// the tombstone is widened back to `string`. A deletion keeps it used since
// objectui#8347 (the key is refused as undeclared) and is caught by the
// tombstone `Equal` row above instead.
// @ts-expect-error — `groupField` is RETIRED on this node (objectui#7322); author `groupBy`
const retiredLiteral: TsObjectKanbanSchema = { ...NODE, groupField: 'stage' };
// …and ACCEPTS a lane-less node since objectui#8990. This was a
// `@ts-expect-error` (TS2741) while `groupBy` was required; the protocol
// declares the key optional, and the renderer guards every read of it, so the
// node below is one this package must annotate rather than refuse. Restoring
// the requirement turns this line red.
const lanelessLiteral: TsObjectKanbanSchema = { type: 'object-kanban', objectName: 'opportunity' };

/* ── Off-disk derivations ─────────────────────────────────────────────────── */

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Every `schema.KEY` read in the renderer, off disk. */
function rendererReads(): Set<string> {
  const src = readRepo(READER);
  return new Set([...src.matchAll(/\bschema\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

function shapeKeys(): string[] {
  return Object.keys((ObjectKanbanSchema as unknown as { shape: Record<string, unknown> }).shape);
}

interface Issue {
  path?: readonly (string | number)[];
  message?: string;
  /** zod 4 `invalid_union`: the issues of every option that was tried. */
  errors?: readonly (readonly Issue[])[];
}

/**
 * Every issue as `path` + `message`, with the nested option errors of an
 * `invalid_union` flattened in: `AnyComponentSchema` is a plain `z.union`, so
 * a refusal inside the `object-kanban` arm surfaces as one root
 * `invalid_union` issue whose `errors` carry the per-arm paths.
 */
function issueEntries(issues: readonly Issue[], prefix: readonly (string | number)[] = []): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? [])];
    out.push({ path: path.join('.'), message: issue.message ?? '' });
    for (const nested of issue.errors ?? []) out.push(...issueEntries(nested, path));
  }
  return out;
}

function issuePaths(issues: readonly Issue[]): string[] {
  return issueEntries(issues).map((e) => e.path);
}

/* ── The reads ────────────────────────────────────────────────────────────── */

describe('objectui#7322 — the renderer reads `groupBy` and `limit`, which is the fact the declarations record', () => {
  it('the batch is exactly the two keys the card measured as read-but-undeclared', () => {
    // Non-vacuity for every per-key assertion below, and the card's own
    // bound: the other undeclared reads on this renderer are not this card.
    expect(DECLARED).toHaveLength(2);
  });

  it.each(DECLARED)('`%s` is still read, as the exact text the docblocks cite', (key) => {
    const src = readRepo(READER);
    for (const text of READ_TEXT[key]) {
      expect(src, `${READER} no longer reads \`schema.${key}\` as \`${text}\``).toContain(text);
    }
  });

  it('the default the `limit` docblock names is still the renderer\'s', () => {
    expect(readRepo(READER)).toContain(DEFAULT_LIMIT_TEXT);
  });

  it('the read set, derived from the renderer, contains both keys and the read control — and NOT the retired key or the control key', () => {
    const reads = rendererReads();
    for (const key of DECLARED) expect(reads.has(key), `renderer no longer reads schema.${key}`).toBe(true);
    // The positive control: the query that returns zero for `groupField` is
    // the same query that returns `objectName`, so the zero is a reading.
    expect(reads.has(READ_CONTROL_KEY)).toBe(true);
    // The retirement's premise: nothing on this node ever read `groupField`.
    // If the renderer starts reading it, the tombstone is wrong and this turns
    // red BEFORE anyone re-authors the key.
    expect(reads.has(RETIRED)).toBe(false);
    // Non-vacuity for the control key: if the renderer ever starts reading
    // `laneField`, this turns red and the control must be re-chosen, not
    // declared on the way past.
    expect(reads.has(CONTROL_KEY)).toBe(false);
  });
});

/* ── The zod mirror: declared keys ────────────────────────────────────────── */

describe('objectui#7322 — the zod mirror declares `groupBy` and `limit`', () => {
  it.each(DECLARED)('`%s` is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', (key) => {
    expect(shapeKeys()).toContain(key);
  });

  it('accepts the documented shape and `limit` SURVIVES the parse', () => {
    const r = ObjectKanbanSchema.safeParse({ ...NODE, limit: 250 });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).groupBy).toBe('stage');
      expect((r.data as Record<string, unknown>).limit).toBe(250);
    }
  });

  it('…and through the published union entry point, so the `object-kanban` arm is the one reached', () => {
    const r = safeValidateSchema({ ...NODE, limit: 250 });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).groupBy).toBe('stage');
      expect((r.data as Record<string, unknown>).limit).toBe(250);
    }
  });

  it('`limit` is optional: the node without it parses green on both entry paths', () => {
    expect(ObjectKanbanSchema.safeParse(NODE).success).toBe(true);
    expect(safeValidateSchema(NODE).success).toBe(true);
  });

  // objectui#8990 — this `it` asserted the opposite until that card: a lane-less
  // node was refused AT `groupBy` on both entry paths. `@objectstack/spec`
  // declares `groupBy` OPTIONAL, so the refusal made this package narrower than
  // the protocol on a published key. The requiredness is what moved; every
  // other fact objectui#7322 established is asserted unchanged above and below.
  it('`groupBy` is OPTIONAL (objectui#8990): a lane-less node parses green on both entry paths', () => {
    const laneless = { type: 'object-kanban', objectName: 'opportunity' };
    const r = ObjectKanbanSchema.safeParse(laneless);
    expect(r.success, 'the protocol accepts a lane-less board; so must this face').toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).groupBy).toBeUndefined();
    const u = safeValidateSchema(laneless);
    expect(u.success, 'the union entry path must agree with the direct one').toBe(true);
  });

  // CONTROL for the pin above — the key is still DECLARED and still ENFORCED
  // when present. A widening that lost the declaration (letting `groupBy` fall
  // back to `BaseSchema`'s index signature, while it stood) would have kept the
  // lane-less pin green while silently un-judging every authored value; this is what separates the
  // two. The wrong-typed case is covered by the table below.
  it('CONTROL — optional does not mean unjudged: an authored `groupBy` is still typed', () => {
    const good = ObjectKanbanSchema.safeParse({ type: 'object-kanban', objectName: 'opportunity', groupBy: 'stage' });
    expect(good.success).toBe(true);
    if (good.success) expect((good.data as Record<string, unknown>).groupBy).toBe('stage');
    const bad = ObjectKanbanSchema.safeParse({ type: 'object-kanban', objectName: 'opportunity', groupBy: 42 });
    expect(bad.success, 'a non-string lane key is still refused').toBe(false);
    if (!bad.success) expect(issuePaths(bad.error.issues as readonly Issue[])).toContain('groupBy');
  });

  it.each([
    ['groupBy', 42],
    ['limit', 'twenty'],
    ['limit', 0],
    ['limit', 1.5],
  ] as const)('refuses a wrong-typed `%s` (%j) AT the key — the enforcement mirroring adds', (key, value) => {
    // Before this card every one of these rode `.passthrough()` unexamined.
    // This is the verdict that moves, and it moves toward refusal.
    const r = ObjectKanbanSchema.safeParse({ ...NODE, [key]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(issuePaths(r.error.issues as readonly Issue[])).toContain(key);
  });
});

/* ── The zod mirror: the retired key ──────────────────────────────────────── */

describe('objectui#7322 — the zod mirror REFUSES `groupField` by name', () => {
  it('`groupField` STAYS a member of the mirror shape (a tombstone is present on both halves to be audible)', () => {
    // Deleting it would make an authored `groupField` pass through in silence
    // — the before-state, on a key that never grouped anything.
    expect(shapeKeys()).toContain(RETIRED);
  });

  it('a `groupField`-authored node is refused AT `groupField`, and the message names `groupBy`', () => {
    const r = ObjectKanbanSchema.safeParse({ type: 'object-kanban', objectName: 'task', groupField: 'status', groupBy: 'status' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const hit = issueEntries(r.error.issues as readonly Issue[]).find((e) => e.path === RETIRED);
      expect(hit, JSON.stringify(r.error.issues)).toBeDefined();
      expect(hit?.message).toContain('RETIRED (objectui#7322)');
      expect(hit?.message).toContain('`groupBy`');
    }
  });

  it('…and through the published union entry point, with the same path and the same remedy', () => {
    const r = safeValidateSchema({ type: 'object-kanban', objectName: 'task', groupField: 'status', groupBy: 'status' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const hit = issueEntries(r.error.issues as readonly Issue[]).find((e) => e.path === RETIRED);
      expect(hit, JSON.stringify(r.error.issues)).toBeDefined();
      expect(hit?.message).toContain('`groupBy`');
    }
  });

  it('the old declared shape — `groupField` alone — is refused too; it never grouped anything', () => {
    const r = ObjectKanbanSchema.safeParse({ type: 'object-kanban', objectName: 'task', groupField: 'status' });
    expect(r.success).toBe(false);
    if (!r.success) expect(issuePaths(r.error.issues as readonly Issue[])).toContain(RETIRED);
  });

  it('absent stays valid: a node that never wrote `groupField` is untouched', () => {
    const r = ObjectKanbanSchema.safeParse(NODE);
    expect(r.success).toBe(true);
    if (r.success) expect(RETIRED in (r.data as Record<string, unknown>)).toBe(false);
  });
});

/* ── The controls ─────────────────────────────────────────────────────────── */

describe('objectui#7322 — the control key stays undeclared, so nothing outside the three keys moved', () => {
  it('is ABSENT from the mirror shape', () => {
    expect(shapeKeys()).not.toContain(CONTROL_KEY);
  });

  it('the SAME wrong-typed value under the control key is still admitted unexamined', () => {
    // The before-state of `groupBy` and `limit`, kept on purpose on a key that
    // is not read: `.passthrough()` admits it, of any type, and it survives.
    // This is the proof the mirror's unknown-key policy is byte-for-byte what
    // it was — neither `.strict()` nor a strip was reached for on the way past
    // (`BaseSchema`'s index signature was objectui#5155's, not this card's;
    // objectui#8347 removed it).
    const r = ObjectKanbanSchema.safeParse({ ...NODE, [CONTROL_KEY]: 42 });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>)[CONTROL_KEY]).toBe(42);
  });

  it('the type-level bindings above are referenced, so lint keeps them', () => {
    expect(literal.groupBy).toBe('stage');
    expect(literal.limit).toBe(250);
    expect(retiredLiteral.objectName).toBe('opportunity');
    expect(lanelessLiteral.type).toBe('object-kanban');
  });
});

describe('objectui#7322 — the tombstone is NODE-LOCAL; the view-level `groupField` alias retired on its own ruling (objectui#6152 round 14)', () => {
  it.each(RETIRED_VIEW_LEVEL_ALIAS_SITES)('%s reads the view-level lane by the spec key only', (file, retired, canonical) => {
    const src = readRepo(file);
    expect(src, `${file} reads the retired view-level \`groupField\` alias as \`${retired}\` again`).not.toContain(retired);
    expect(src, `${file} no longer reads the view-level lane as \`${canonical}\``).toContain(canonical);
  });

  it('the core fold no longer folds it either', () => {
    const [file, text] = VIEW_LEVEL_ALIAS_FOLD;
    const src = readRepo(file);
    expect(src).not.toContain(text);
    // CONTROL: the same instrument reads the file, which still holds the folds
    // that live on (the toolbar flags' table, for one).
    expect(src).toContain('SHOW_FLAG_TO_USER_ACTION');
  });

  it('the view-level alias is still DECLARED on `KanbanConfig` in the same mirror file, as a by-name refusal (objectui#6152 round 11)', () => {
    expect(readRepo(MIRROR)).toContain(VIEW_LEVEL_ALIAS_MIRROR_TEXT);
  });
});

/* ── The doc page — triage's completion signal ────────────────────────────── */

describe('objectui#7322 — the row-cap block on the plugin docs page is annotated `ObjectKanbanSchema`', () => {
  const src = readRepo(DOC);

  it('carries the annotation and its import, in a `tsx` fence the doc-snippet gate compiles against the built dist', () => {
    expect(src).toContain("import type { ObjectKanbanSchema } from '@object-ui/types'");
    expect(src).toContain('const board: ObjectKanbanSchema = {');
    expect(src).not.toContain('const board = {');
  });

  it('the block still authors the documented shape — `groupBy` and `limit`, never `groupField`', () => {
    const start = src.indexOf('const board: ObjectKanbanSchema = {');
    const end = src.indexOf('```', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).toContain("groupBy: 'stage'");
    expect(block).toMatch(/^\s+limit: 250,/m);
    expect(block).not.toContain(RETIRED);
  });
});
