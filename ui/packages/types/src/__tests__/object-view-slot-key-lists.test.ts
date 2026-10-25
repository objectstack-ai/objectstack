// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectViewSchema`'s `table` and `form` slots SHIP the members they promise,
 * and their key lists cannot drift from the source schemas (objectui#6269).
 *
 * ## The defect
 *
 * The two slots were declared by deriving from the schema they document:
 *
 *   table?: Partial<Omit<ObjectGridSchema, 'type' | 'objectName'>>;
 *   form?:  Partial<Omit<ObjectFormSchema, 'type' | 'objectName' | 'mode'>>;
 *
 * Both derived types declared ZERO properties. `Omit<T, K>` is
 * `Pick<T, Exclude<keyof T, K>>`, and `keyof T` on a type carrying a string
 * index signature is `string | number` — the literal member names are ABSORBED.
 * `ObjectGridSchema` and `ObjectFormSchema` both inherited `BaseSchema`'s
 * `[key: string]: any` (objectui#5155) until objectui#8347, so each `Pick` rebuilt a type holding
 * the index signature and none of the named members. Measured through the
 * checker before the fix:
 *
 *   ObjectGridSchema                                              -> 61 members
 *   Omit<ObjectGridSchema, 'type' | 'objectName'>                 ->  0 members
 *   ObjectFormSchema                                              -> 67 members
 *   Omit<ObjectFormSchema, 'type' | 'objectName' | 'mode'>        ->  0 members
 *
 * ⚠️ Those two member counts are the HISTORICAL reading that produced this
 * pin, kept verbatim because the `-> 0` half is only legible beside them. The
 * LIVE counts are 63 and 69: objectui#6357 declared `bind` on `BaseSchema`,
 * both schemas inherit it, and this guard turned red naming them — which is
 * precisely the drift it exists to catch. The key was added to both slot
 * unions in the same change, so the slots still ship the full configuration.
 * objectui#11070 then declared `dataSource` (the spec's per-element binding)
 * on both source schemas and the guard named it again: the `form` slot carries
 * it, and the `table` slot withholds it as a record source the view owns.
 * objectui#10872 batch 9 declared `responsiveStyles` on `ObjectGridSchema`, and
 * the `table` slot withholds it as a node-level key. Section 1 pins the counts
 * as they stand; the "63 and 69" above are the reading of their day.
 *
 * Nothing errored — the index signature answered every key as `any` — so the
 * symptoms were in the tools that READ the declaration: `table: { colunms: 3 }`
 * type-checked, `table: { pageSize: 'ten' }` type-checked, and editor completion
 * inside `table: { … }` offered nothing at all for a slot documented as
 * "inherits from ObjectGridSchema".
 *
 * This is objectui#6151's collapse in PROPERTY position. #6151's guard
 * (`stack-schema-emitted-members.test.ts`) walks the `LayoutSchema` UNION; these
 * two are properties on `ObjectViewSchema`, not union members, so that walker
 * cannot see them. Hence a second pin rather than an extension of the first.
 *
 * ## The repair, and the hazard it introduces
 *
 * Each `Omit` became a `Partial<Pick<…, ExplicitKeyUnion>>`. `Pick` with
 * LITERAL keys never computes `keyof T`, so it cannot collapse. The cost is a
 * hand-written key list that silently drifts the moment a member is added to
 * the source schema — a member that exists on `ObjectGridSchema` but is missing
 * from `ObjectGridSlotKey` is simply not configurable through the slot, and
 * nothing says so.
 *
 * ⭐ Neutralising that drift is what this file is for. It recomputes each source
 * schema's declared members THROUGH THE CHECKER — the same instrument that
 * produced the 61 -> 0 measurement — and requires the slot's member set to
 * equal exactly "source members minus the identity keys the view fixes" and,
 * for `table`, minus the withheld set below. A member added to
 * `ObjectGridSchema` and placed in neither list turns this red.
 *
 * ## The `table` slot withholds what the view's grid does not honour (objectui#10976)
 *
 * The repair above made the slot declare EVERY `ObjectGridSchema` member, and
 * `ObjectView` hands its grid only some of them: it reads a fixed set off
 * `table` by name and relays `OBJECT_VIEW_TABLE_RELAY_KEYS` verbatim
 * (`@object-ui/plugin-view`). Every other member type-checked on the slot and
 * reached nothing — `table: { editable: true }` was one of them until it was
 * relayed. `TABLE_WITHHELD_KEYS` below is the set the slot no longer declares,
 * each with the reason it has no meaning on the view's grid, and section 4
 * holds the zod twin to the same set: it must refuse each one BY NAME, so the
 * two faces refuse the same keys. Which keys `ObjectView` hands its grid is
 * pinned from the side that can read the renderer,
 * `plugin-view/src/__tests__/ObjectView.tableSlotRelay-10976.test.tsx`.
 *
 * ## Why it emits its own declarations instead of reading `dist/`
 *
 * This repo's per-PR `test` job runs `pnpm test` with NO build ahead of it
 * (turbo's `test` task only `dependsOn: ["^build"]` — the DEPENDENCY closure,
 * never the package's own build), and `packages/types` has no workspace
 * dependencies, so nothing builds it. A guard reading `dist/objectql.d.ts`
 * would be absent-or-stale on a cold CI cache — vacuous exactly where it is
 * needed. So this file runs the package's OWN tsconfig through the compiler API
 * and measures the emitted declaration: the artifact a consumer resolves,
 * derived deterministically and with no dependence on CI job ordering. Same
 * reasoning as `stack-schema-emitted-members.test.ts` and
 * `package-exports-manifest.test.ts`.
 *
 * ## 🗑️ Removal condition (recorded at triage's request)
 *
 * These `Pick` lists exist because `BaseSchema` carried a root string index
 * signature. objectui#8347 removed it (the objectui#5155 phase this condition
 * waited for), so `keyof ObjectGridSchema` is the literal member union again
 * and `Omit` no longer collapses.
 * `ObjectFormSlotKey` and the `form` half of this file then become removable in
 * favour of the original `Omit` form. The `table` half does NOT: since
 * objectui#10976 its list is a deliberate subset, so an `Omit` would have to
 * name the withheld set, and what this file guards for `table` — that every
 * grid member is either handed to the grid or withheld, and that both faces
 * withhold the same keys — stays true work. `declaresStringIndex` below is the
 * tripwire that noticed the index signature going: it reports `false` for the
 * source schemas since objectui#8347, so the collapse half of this file is gone
 * and the `form` half may move back to `Omit` (not done here: the removal PR
 * flipped the tripwires and left the lists, which still hold).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import { ObjectViewSchema as ObjectViewMirror } from '../zod/objectql.zod.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The identity keys each slot deliberately withholds — the view fixes them. */
const TABLE_IDENTITY_KEYS = ['type', 'objectName'] as const;
const FORM_IDENTITY_KEYS = ['type', 'objectName', 'mode'] as const;

/**
 * objectui#10976 — the `ObjectGridSchema` members the `table` slot withholds,
 * by the reason each has no meaning on the grid `ObjectView` draws. Measured
 * against `ObjectGrid.tsx` and `ObjectView.tsx`, not listed from the card: a key
 * `ObjectGrid` reads and the view could hand it is relayed instead, and then it
 * is not here.
 */
const TABLE_WITHHELD_BY_REASON = {
  /**
   * `ObjectGrid` has no read of it, so nothing could draw it. Each is a
   * retirement tombstone on `ObjectGridSchema` itself since objectui#11068
   * (`bulkSpecActions`, `name`, `placeholder`, `rowSpecActions`, `showFilters`).
   */
  unread: ['bulkSpecActions', 'name', 'placeholder', 'rowSpecActions', 'showFilters'],
  /**
   * `ObjectGrid` honours it on its own node since objectui#11068, and the view
   * does not hand it on: that card enforced these without widening this slot —
   * `description` and `emptyState` first, `keyboardNavigation` with its build.
   */
  notRelayed: ['description', 'emptyState', 'keyboardNavigation'],
  /** The view owns it: its own record source, its own row click, its grid's identity. */
  viewOwned: ['bind', 'data', 'dataSource', 'id', 'navigation', 'onNavigate', 'staticData'],
  /**
   * A node-level key: a `BaseSchema` key, or `responsiveStyles`, which
   * `ObjectGridSchema` declares since objectui#10872 batch 9. `ObjectView` draws
   * its grid as a component, not as a schema node, so no renderer applies one
   * of these to it.
   */
  nodeLevel: ['ariaLabel', 'disabled', 'disabledOn', 'hidden', 'hiddenOn', 'responsiveStyles', 'style', 'testId', 'visible', 'visibleOn', 'visibleWhen'],
  /**
   * The legacy alias of a relayed key: `bulkActions`, `resizable`. `resizableColumns`
   * is also a retirement tombstone on `ObjectGridSchema` itself since objectui#6152
   * round 7 (`ObjectGrid` no longer reads it); the slot still refuses it with its own
   * message, as it does the `unread` five.
   */
  alias: ['batchActions', 'resizableColumns'],
} as const;

const TABLE_WITHHELD_KEYS: readonly string[] = Object.values(TABLE_WITHHELD_BY_REASON).flat();

/**
 * Retirement tombstones `ObjectGridSchema` declares itself (`?: never` on both
 * faces) that the slot keeps: they type nothing, and they carry the named
 * refusal and its guidance onto this face too. The five the grid retired in
 * objectui#11068 are in the withheld set above instead, refused by the slot's
 * own message, and so is `resizableColumns`, which the grid retired in
 * objectui#6152 round 7.
 */
const TABLE_INHERITED_TOMBSTONES = ['body', 'children', 'defaultSort'] as const;

/**
 * Members the slot carries BY REFERENCE from the spec's `object-grid` row that
 * the spec itself has since retired: `defaultFilters`, a tombstone in
 * `@objectstack/spec` 18 (objectstack#11509, objectui#12030). The zod twin
 * refuses it with the spec's own tombstone; the TypeScript face types it as the
 * spec's retired-key type, so no value compiles there either. Kept apart from
 * {@link TABLE_INHERITED_TOMBSTONES}, whose members are objectui's own `?: never`.
 */
const TABLE_SPEC_RETIRED_MEMBERS = ['defaultFilters'] as const;

/**
 * The one tombstone the zod `ObjectGridSchema` declares and its TypeScript twin
 * deliberately does not: `operators`, the misspelling of `operations`
 * (objectui#9739 — declaring `?: never` would write the misspelling into the
 * published interface). The nested `table` inherits it, so it is refused there
 * too; it is no member of the TypeScript slot, which refuses it as an unknown
 * key.
 */
const TABLE_MIRROR_ONLY_TOMBSTONES = ['operators'] as const;

/**
 * Emit declarations with the package's OWN build settings, into a scratch dir
 * under `node_modules/` — which is gitignored, and from which Node's module
 * resolution still walks up to `packages/types/node_modules`, so the emitted
 * `import type … from '@objectstack/spec/ui'` still resolves.
 */
function emitDeclarations(): { dir: string; objectql: string } {
  const configPath = join(packageRoot, 'tsconfig.json');
  const readConfig = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readConfig.error) {
    throw new Error(ts.flattenDiagnosticMessageText(readConfig.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, packageRoot);

  const dir = mkdtempSync(join(packageRoot, 'node_modules', '.view-slot-pin-'));
  const program = ts.createProgram([join(packageRoot, 'src', 'objectql.ts')], {
    ...parsed.options,
    outDir: dir,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    noEmit: false,
    // The real build is `composite`/incremental; neither is meaningful for a
    // one-shot emit into a scratch dir, and both would write build info next to
    // the package's real artifacts.
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
  });
  const emitted = program.emit();
  const objectql = join(dir, 'objectql.d.ts');
  if (!existsSync(objectql)) {
    const diagnostics = [...emitted.diagnostics, ...program.getSemanticDiagnostics()]
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .slice(0, 10);
    throw new Error(`declaration emit produced no objectql.d.ts:\n${diagnostics.join('\n')}`);
  }
  return { dir, objectql };
}

const { dir: scratchDir, objectql: emittedObjectql } = emitDeclarations();
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

const program = ts.createProgram([emittedObjectql], {
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});
const checker = program.getTypeChecker();

function exportedType(name: string): ts.Type {
  const sourceFile = program.getSourceFile(emittedObjectql);
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`no module symbol for ${emittedObjectql}`);
  const symbol = checker
    .getExportsOfModule(moduleSymbol)
    .find((s) => s.getName() === name);
  if (!symbol) throw new Error(`${name} is not exported from the emitted objectql.d.ts`);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

const memberNames = (type: ts.Type): string[] =>
  checker.getPropertiesOfType(type).map((p) => p.getName()).sort();

const declaresStringIndex = (type: ts.Type): boolean =>
  checker.getIndexInfoOfType(type, ts.IndexKind.String) !== undefined;

/** The type of one `ObjectViewSchema` slot, with `undefined` stripped. */
function slotType(slot: 'table' | 'form'): ts.Type {
  const view = exportedType('ObjectViewSchema');
  const property = checker.getPropertyOfType(view, slot);
  if (!property) throw new Error(`ObjectViewSchema declares no \`${slot}\` member`);
  return checker.getNonNullableType(checker.getTypeOfSymbol(property));
}

/* ── 1. Degenerate control — the SOURCE schemas still declare their members ── */

/**
 * ⚠️ Load-bearing. Section 2 compares the slot against the source schema; if
 * BOTH collapsed to zero the comparison would pass over two empty sets. These
 * numbers are what makes that impossible. They are re-derived here, not
 * inherited: bump them deliberately when a member is genuinely added.
 */
describe('the source schemas still declare their full member sets', () => {
  // 64 since objectui#10872 batch 9 declared `responsiveStyles` (withheld from the slot, above).
  it('ObjectGridSchema declares 64 members and no longer carries the #5155 index signature', () => {
    const grid = exportedType('ObjectGridSchema');
    expect(memberNames(grid)).toHaveLength(64);
    expect(memberNames(grid)).toEqual(expect.arrayContaining(['columns', 'pageSize', 'rowActions']));
    // Flipped to `false` by objectui#8347, which removed the root index
    // signature (the objectui#5155 phase this tripwire waited for): the `form`
    // `Pick` list this file pins is removable now (see the removal condition
    // in the header), and the `table` one stays deliberate.
    expect(declaresStringIndex(grid)).toBe(false);
  });

  it('ObjectFormSchema declares 69 members and no longer carries the #5155 index signature', () => {
    const form = exportedType('ObjectFormSchema');
    expect(memberNames(form)).toHaveLength(69);
    expect(memberNames(form)).toEqual(expect.arrayContaining(['fields', 'sections', 'submitText']));
    expect(declaresStringIndex(form)).toBe(false);
  });
});

/* ── 2. The measurement — the key lists equal members-minus-identity-keys ─── */

describe.each([
  { slot: 'table' as const, source: 'ObjectGridSchema', identity: TABLE_IDENTITY_KEYS, withheld: TABLE_WITHHELD_KEYS },
  { slot: 'form' as const, source: 'ObjectFormSchema', identity: FORM_IDENTITY_KEYS, withheld: [] as readonly string[] },
])('ObjectViewSchema.$slot ships $source’s configuration (objectui#6269)', ({ slot, source, identity, withheld }) => {
  it('declares EXACTLY the source members minus the identity keys the view fixes and the withheld set', () => {
    // Before the objectui#6269 fix this read `[]`.
    // Set equality, not a spot check: it fails when the slot collapses again,
    // AND when a member is added to the source schema without being added to
    // the key list or the withheld set (the duplicate-list hazard this pin
    // exists to neutralise).
    const expected = memberNames(exportedType(source)).filter(
      (k) => !(identity as readonly string[]).includes(k) && !withheld.includes(k),
    );
    expect(memberNames(slotType(slot))).toEqual(expected);
  });

  it('every withheld key is a member of the source schema — the set names no key that does not exist', () => {
    const source_members = memberNames(exportedType(source));
    expect(withheld.filter((k) => !source_members.includes(k))).toEqual([]);
  });

  it('withholds the identity keys the view already fixes', () => {
    const declared = memberNames(slotType(slot));
    for (const key of identity) expect(declared).not.toContain(key);
  });

  it('declares NO string index signature — that is what re-opens the defect', () => {
    // A `[key: string]: any` here would make every assertion above cosmetic:
    // excess-property checks on `table: { … }` literals would stop firing and
    // typos would be accepted again, exactly as before the fix.
    expect(declaresStringIndex(slotType(slot))).toBe(false);
  });

  it('keeps every member optional (the `Partial` wrapper survived)', () => {
    const required = checker
      .getPropertiesOfType(slotType(slot))
      .filter((p) => (p.getFlags() & ts.SymbolFlags.Optional) === 0)
      .map((p) => p.getName());
    expect(required).toEqual([]);
  });
});

/* ── 3. Spot checks — the members an author actually reaches for ─────────── */

describe('the slots offer the members their doc comments promise', () => {
  it.each(['columns', 'pageSize', 'rowActions', 'selectable', 'sort', 'className'])(
    'table declares `%s` as a named member, not merely via an index signature',
    (member) => {
      expect(memberNames(slotType('table'))).toContain(member);
    },
  );

  it.each(['fields', 'sections', 'layout', 'submitText', 'readOnly', 'className'])(
    'form declares `%s` as a named member, not merely via an index signature',
    (member) => {
      expect(memberNames(slotType('form'))).toContain(member);
    },
  );
});

/* ── 4. objectui#10976 — the `table` slot withholds, and both faces agree ─── */

/**
 * The zod twin's nested `table` object, resolved through its `.optional()` and
 * `z.lazy` the way the parser resolves it.
 */
function mirrorTableObject(): z.ZodObject {
  let node: z.ZodType = ObjectViewMirror.shape.table;
  for (let hop = 0; hop < 8; hop += 1) {
    if (node instanceof z.ZodObject) return node;
    if (node instanceof z.ZodOptional) node = node.unwrap() as z.ZodType;
    else if (node instanceof z.ZodLazy) node = node.unwrap() as z.ZodType;
    else break;
  }
  throw new Error('ObjectViewSchema.shape.table did not resolve to a zod object');
}

/** A shape member that refuses every value: a `z.never()` under any number of `.optional()`s. */
function refusesEverything(member: z.ZodType): boolean {
  let node: z.ZodType = member;
  while (node instanceof z.ZodOptional) node = node.unwrap() as z.ZodType;
  return node instanceof z.ZodNever;
}

const sampleView = (table: Record<string, unknown>) => ({ type: 'object-view', objectName: 'task', table });

describe('objectui#10976 — the table slot withholds what the view\'s grid does not honour', () => {
  it('the TypeScript slot declares none of the withheld keys', () => {
    const declared = memberNames(slotType('table'));
    expect(TABLE_WITHHELD_KEYS.filter((k) => declared.includes(k))).toEqual([]);
  });

  it('the slot keeps the three retirement tombstones `ObjectGridSchema` declares, as `never`', () => {
    const table = slotType('table');
    for (const key of TABLE_INHERITED_TOMBSTONES) {
      const member = checker.getPropertyOfType(table, key);
      expect(member, `\`${key}\` left the slot`).toBeDefined();
      const type = checker.getNonNullableType(checker.getTypeOfSymbol(member!));
      expect(type.flags & ts.TypeFlags.Never, `\`${key}\` is no longer \`never\` on the slot`).not.toBe(0);
    }
  });

  it('LIT CONTROL: the positive keys the slot hands the grid are declared', () => {
    const declared = memberNames(slotType('table'));
    for (const key of ['editable', 'frozenColumns', 'rowHeight', 'columns', 'pagination']) {
      expect(declared).toContain(key);
    }
  });

  it('the zod twin refuses EXACTLY the withheld keys and the inherited tombstones by name — the two faces agree', () => {
    const shape = mirrorTableObject().shape as Record<string, z.ZodType>;
    const refused = Object.keys(shape).filter((k) => refusesEverything(shape[k])).sort();
    expect(refused).toEqual(
      [...TABLE_WITHHELD_KEYS, ...TABLE_INHERITED_TOMBSTONES, ...TABLE_MIRROR_ONLY_TOMBSTONES, ...TABLE_SPEC_RETIRED_MEMBERS].sort(),
    );
  });

  it('the mirror-only tombstone is no member of the TypeScript slot', () => {
    const declared = memberNames(slotType('table'));
    for (const key of TABLE_MIRROR_ONLY_TOMBSTONES) expect(declared).not.toContain(key);
  });

  it.each(TABLE_WITHHELD_KEYS.map((k) => [k]))('`table.%s` is refused by the validator, at its own path, with guidance', (key) => {
    const r = ObjectViewMirror.safeParse(sampleView({ [key]: 'x' }));
    expect(r.success).toBe(false);
    const issue = r.success ? undefined : r.error.issues.find((i) => i.path.join('.') === `table.${key}`);
    expect(issue, `no issue at table.${key}`).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toContain('objectui#10976');
  });

  it('LIT CONTROL: a relayed key and a key read by name parse green on the same validator', () => {
    const r = ObjectViewMirror.safeParse(sampleView({ editable: true, frozenColumns: 2, columns: ['name'], pageSize: 25 }));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });
});
