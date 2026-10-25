/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8801 — `ObjectKanbanSchema.allowCollapse` RETIRED on the
 * `object-kanban` arm, on BOTH faces (ADR-0049 enforce-or-remove; director
 * seat, class-1 self-adjudication of 2026-09-16, letter A).
 *
 * ## The defect
 *
 * The key was declared on the TypeScript face and on the zod mirror, and read
 * by NO registered board. An author who wrote `allowCollapse: true` on an
 * `object-kanban` node type-checked green, parsed green, and got a board that
 * never collapsed anything off it — a published entry point to a capability
 * that does not exist behind it.
 *
 * ## Why removal rather than a reader
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-kanban']` —
 * `ObjectKanbanPropsSchema` — never declared the key, and it is a
 * `strictObject`, so the platform already refuses an authored `allowCollapse`
 * by name at publish. The two faces disagreed with the protocol and with each
 * other's consequences: `tsc` said yes and the document was rejected whole.
 * Wiring a reader instead was refused by the same ruling as a capability
 * nobody asked for.
 *
 * ## Why a TOMBSTONE rather than a deleted member
 *
 * `BaseSchema`'s mirror ends `.passthrough()` (and the interface carried
 * `[key: string]: any` until objectui#8347), so a deleted member is KEPT, not
 * refused, on the zod face — one silent no-op traded for another. The member stays declared and unwritable: `?: never`
 * on the interface, `retirementTombstone()` on the mirror. Suite "the near
 * miss" below is what separates the two outcomes on one instrument.
 *
 * ## ⛔ NOT inherited from the sibling arm
 *
 * Batch #70 (objectui#7742) tombstoned the same spelling on `KanbanSchema`, and
 * objectui#8802 then removed that arm whole. Those refusals were arm-scoped by
 * construction — a `type: "object-kanban"` document went on being accepted, and
 * `bare-kanban-node-key-retired-8802.test.ts` pinned exactly that. This
 * retirement is a separate ruling on this arm's own protocol row, and that
 * sibling pin's `allowCollapse` row moved here rather than being deleted.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { ObjectKanbanSchema } from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { ObjectKanbanSchema as TsObjectKanbanSchema } from '../objectql';

const ROOT = resolve(__dirname, '../../../..');
const RETIRED = 'allowCollapse';
/** A near miss of the retired spelling: never declared, so it takes the OTHER path. */
const NEAR_MISS = 'allowCollapsing';

/** The smallest node this arm accepts; every assertion below is a delta on it. */
const NODE = { type: 'object-kanban', objectName: 'task', groupBy: 'status' } as const;

/* -------------------------------------------------------------------------- */
/* Compile-time pins — read by tsc, not by vitest (which strips types).        */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends 1 & T ? true : false;

// The tombstone admits exactly one value — absence. ⭐ DELETING the member
// instead made this indexed access fall through `BaseSchema`'s index signature
// to `any` until objectui#8347 (it stops compiling now), and either way this
// pin goes red — so this pin is what keeps the retirement from decaying into a silent strip.
type _RetiredIsTombstone = Assert<Equal<TsObjectKanbanSchema['allowCollapse'], undefined>>;
type _RetiredIsNotAny = Assert<Equal<IsAny<TsObjectKanbanSchema['allowCollapse']>, false>>;
// Non-vacuity on the same instrument: a live member still resolves to its own
// declared type, so the `undefined` above is a reading and not the shape the
// whole interface collapsed to.
type _LiveMemberStillDeclared = Assert<Equal<TsObjectKanbanSchema['coverImageField'], string | undefined>>;
// …and the never-declared near miss is no member at all, which is what the
// retired key would look like had it been deleted rather than tombstoned (it
// fell through to `any` until objectui#8347 removed `BaseSchema`'s signature).
type _NearMissIsNoMember = Assert<Equal<'allowCollapsing' extends keyof TsObjectKanbanSchema ? true : false, false>>;
// Lit control for the detector: `IsAny` does answer `true`, so `_RetiredIsNotAny` is a reading.
type _IsAnyCanAnswerTrue = Assert<IsAny<any>>;

// The TS face still accepts a live board…
// (`quickAdd` stood in this literal until it was retired on this arm too —
// objectui#8285, pinned in `object-kanban-quick-add-retired-8285.test.ts`.)
const liveLiteral: TsObjectKanbanSchema = { ...NODE, coverImageField: 'cover' };
// …and REFUSES the retired spelling on a literal (a boolean is not `never`).
// This directive goes unused — and the type-check goes red with TS2578 — the
// moment the tombstone is widened back to `boolean`. A deletion keeps it used
// since objectui#8347 (the key is refused as undeclared) and is caught by the
// tombstone `Equal` row above instead.
// @ts-expect-error — `allowCollapse` is RETIRED on this node (objectui#8801); delete the key
const retiredLiteral: TsObjectKanbanSchema = { ...NODE, allowCollapse: true };
void liveLiteral;
void retiredLiteral;

/* -------------------------------------------------------------------------- */
/* Runtime — through `safeValidateSchema`, the tolerant node union.           */
/* -------------------------------------------------------------------------- */

interface IssueLike {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly code?: string;
  readonly errors?: readonly (readonly IssueLike[])[];
}

/** Flatten zod's nested union issues into `{ path, message, code }` rows. */
function flattenIssues(issues: readonly IssueLike[]): Array<{ path: string; message: string; code: string }> {
  return issues.flatMap((issue) => [
    { path: (issue.path ?? []).join('.'), message: issue.message ?? '', code: issue.code ?? '' },
    ...(issue.errors ?? []).flatMap((nested) => flattenIssues(nested)),
  ]);
}

function refusals(node: unknown): Array<{ path: string; message: string; code: string }> {
  const result = safeValidateSchema(node as never) as { success: boolean; error?: { issues?: readonly IssueLike[] } };
  return result.success ? [] : flattenIssues(result.error?.issues ?? []);
}

/** Refusals addressed at one key's own path. */
function atKey(node: unknown, key: string) {
  return refusals(node).filter((r) => r.path === key);
}

describe('the zod face refuses `allowCollapse` BY NAME', () => {
  it('the member is still DECLARED — a tombstone, not a deletion', () => {
    const shape = (ObjectKanbanSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toContain(RETIRED);
    // Control on the same instrument: a key this arm never declared is absent,
    // so "contains" above is a reading and not a shape that holds everything.
    expect(Object.keys(shape)).not.toContain(NEAR_MISS);
  });

  it.each([[true], [false], ['yes']])('refuses the value %p at the key\'s OWN path, with the prescription', (value) => {
    const found = atKey({ ...NODE, [RETIRED]: value }, RETIRED);
    expect(found).not.toEqual([]);
    const text = found.map((f) => f.message).join('\n');
    // The `s` flag is house style here: the guidance spans lines once rendered.
    expect(text).toMatch(/allowCollapse.*RETIRED.*objectui#8801/s);
    // ⭐ The RULING's own requirement for this text, not a style preference: it
    // must say where lane collapse actually lives, so the retirement does not
    // replace one fictional entry point with another.
    expect(text).toMatch(/KanbanColumn\.collapsed/s);
    expect(text).toMatch(/not a board-level authored toggle/s);
    expect(text).toMatch(/Delete the key/s);
  });

  it('reports `invalid_type`, the code a bare `z.never()` arm reports', () => {
    // `retirementTombstone()` customises the MESSAGE only; the accept set and
    // the issue code are the helper's documented invariants.
    const found = atKey({ ...NODE, [RETIRED]: true }, RETIRED);
    expect(found.map((f) => f.code)).toContain('invalid_type');
  });

  it('ONE string, BOTH author-facing channels — the `.describe()` metadata is the parse message', () => {
    const shape = (ObjectKanbanSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    const described = shape[RETIRED]?.description ?? '';
    expect(described).not.toEqual('');
    const parsed = atKey({ ...NODE, [RETIRED]: true }, RETIRED).map((f) => f.message);
    expect(parsed).toContain(described);
  });
});

describe('the near miss — what separates "refused by name" from "swept up as unknown"', () => {
  it('a never-declared neighbour is ACCEPTED, because this arm is not strict', () => {
    // ⭐ The discriminator. `BaseSchema` ends `.passthrough()`, so an undeclared
    // key is KEPT rather than refused — which is exactly why deleting the
    // member would have shipped the retirement as a silent accept. If this
    // assertion ever flips, the arm turned strict and the tombstone above is
    // no longer the thing doing the refusing.
    expect(atKey({ ...NODE, [NEAR_MISS]: true }, NEAR_MISS)).toEqual([]);
  });
});

describe('the positive direction — the declared members still parse', () => {
  it('the bare node is accepted, so the instrument still says yes', () => {
    // Firing control for every refusal above: without it they would all pass
    // under a validator that had started refusing everything.
    expect(refusals(NODE)).toEqual([]);
  });

  it.each([
    ['groupBy', 'status'],
    ['limit', 50],
    ['columns', [{ id: 'todo', title: 'To Do' }]],
    // The `ViewFilterRule` array: respelled (objectui#6152 round 8) from the AST
    // tuple array `[['status', '=', 'open']]`, which the row now refuses.
    ['filter', [{ field: 'status', operator: 'equals', value: 'open' }]],
    ['titleField', 'name'],
    ['cardFields', ['owner']],
    // `quickAdd` left this list when objectui#8285 retired it on this arm.
    ['coverImageField', 'cover'],
    // `{ condition, style }`: respelled (objectui#11522) from the retired native
    // `{ field: 'status', operator: 'equals', value: 'open' }`, now refused by name.
    ['conditionalFormatting', [{ condition: "record.status == 'open'", style: { backgroundColor: '#fee2e2' } }]],
  ])('still accepts the live member `%s`', (key, value) => {
    expect(refusals({ ...NODE, [key]: value })).toEqual([]);
  });

  it('and still refuses `groupField`, this arm\'s OTHER tombstone', () => {
    // The retirement narrowed one key. This is the neighbour that proves the
    // narrowing did not sweep the arm's existing refusals away with it.
    expect(atKey({ ...NODE, groupField: 'status' }, 'groupField')).not.toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Off-disk — the read-site reading the retirement rests on.                   */
/* -------------------------------------------------------------------------- */

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

describe('no registered board reads the key — the reading, re-derived here rather than remembered', () => {
  it('`@object-ui/plugin-kanban` names it in ZERO files, with controls firing in the same pass', () => {
    const counts = new Map<string, number>();
    const probes = [RETIRED, 'groupBy', 'coverImageField', 'conditionalFormatting'];
    for (const p of probes) counts.set(p, 0);
    for (const file of sourceFiles(join(ROOT, 'packages/plugin-kanban/src'))) {
      const src = readFileSync(file, 'utf8');
      for (const p of probes) if (src.includes(p)) counts.set(p, counts.get(p)! + 1);
    }
    // The controls are what make the zero a reading rather than a dead walk:
    // three keys of the same shape fire on the same instrument, same run.
    expect(counts.get('groupBy')).toBeGreaterThan(0);
    expect(counts.get('coverImageField')).toBeGreaterThan(0);
    expect(counts.get('conditionalFormatting')).toBeGreaterThan(0);
    expect(counts.get(RETIRED)).toBe(0);
  });

  it('TREE-SCOPED: nothing anywhere reads it as a property, declarations excluded', () => {
    // ⭐ Tree-scoped on purpose. A file-scoped absence pin sees only the files
    // its author thought of, and the reference that matters is the one they did
    // not know about. Property-access shape, so the two DECLARATION sites
    // (`allowCollapse?: never` and the mirror's `retirementTombstone()` call)
    // are excluded by the pattern itself rather than by an allow-list.
    const readPattern = new RegExp(`\\.${RETIRED}\\b`);
    const controlPattern = /\.groupBy\b/;
    const readers: string[] = [];
    let controlHits = 0;
    for (const root of ['packages', 'apps']) {
      for (const file of sourceFiles(join(ROOT, root))) {
        if (file.endsWith('object-kanban-allow-collapse-retired-8801.test.ts')) continue;
        const src = readFileSync(file, 'utf8');
        if (controlPattern.test(src)) controlHits += 1;
        if (readPattern.test(src)) readers.push(file.slice(ROOT.length + 1));
      }
    }
    expect(controlHits).toBeGreaterThan(0);
    expect(readers).toEqual([]);
  });

  it('both UNNAMED channels terminate before any sink, pinned as the source text that does it', () => {
    // A source grep alone cannot answer "no renderer reads this key": a
    // renderer can consume a key it never names. These are the two ends.
    const objectKanban = readFileSync(join(ROOT, 'packages/plugin-kanban/src/ObjectKanban.tsx'), 'utf8');
    const boardCore = readFileSync(join(ROOT, 'packages/plugin-kanban/src/KanbanBoardCore.tsx'), 'utf8');
    // PROP channel — the rest props are discarded, never spread onward.
    expect(objectKanban).toContain('void _props;');
    // SCHEMA channel — the key does ride this spread, and stops at a component
    // that NAMES every key it forwards. ⭐ Since objectui#11234 that component
    // is the internal `KanbanBoardCore`, which `ObjectKanban` renders; the
    // exported `KanbanRenderer` it rendered before now renders the same board.
    expect(objectKanban).toContain('...schema,');
    expect(objectKanban).toContain('<KanbanBoardCore');
    expect(boardCore).toContain('export const KanbanBoardCore: React.FC<KanbanBoardCoreProps> = ({');
  });
});
