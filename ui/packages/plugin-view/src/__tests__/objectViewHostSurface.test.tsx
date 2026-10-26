/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-view` — the HOST-COMPOSITION SURFACE ledger.
 *
 * TWO records live here, in the same shape and for the same reason: a
 * maintainer ruled that something this component reads or renders stays HOST
 * surface rather than becoming authored surface, and a census has to be able
 * to read that ruling somewhere other than a closed issue.
 *
 *   1. objectui#5097 — the 27 `renderListView` keys stay undeclared, and stay
 *      read. Sections 1-3 below.
 *   2. objectui#5321 — the `tree` and `chart` view-type branches stay
 *      unauthored, and stay reachable from a host `views` prop. Section 4.
 *
 * =========================================================================
 * RECORD 1 — the 27 keys ruled HOST-COMPOSITION SURFACE (objectui#5097)
 * =========================================================================
 *
 * ## The card, and the ruling
 *
 * objectui#5097 measured 31 distinct keys that `ObjectView`'s `renderListView`
 * delegation branch reads off the object-view node through `(schema as any).K`
 * and forwards to the host's list renderer. Four were declared members of
 * `ObjectViewSchema`; 27 are not. objectui#13118 dropped one of the four,
 * `filterableFields`, with the spec's retirement of the key (objectstack#24640,
 * ruling C), so the branch reads 30 today: three declared, the 27 unchanged.
 *
 * The maintainer ruled on 2026-08-18 (verbatim 「同意」) that the 27 are HOST
 * surface, exempted with reasons — not authored surface — on a MEASURED
 * REACHABILITY basis: the branch runs only when a host passes `renderListView`,
 * and the registered renderer never does, so the schema-registration path
 * documented to authors cannot reach these keys at all. Declaring them would
 * promise authors a surface that does nothing on their path.
 *
 * This file is where that word "deliberate" is said to the tooling, so the next
 * census re-files the card only if something really changed.
 *
 * ## Why this pins the PROPERTY, not the enumeration
 *
 * The sibling exemption for `object-grid` (objectui#5091, PR #5241) could
 * afford four assertions per key: there were three keys. Twenty-seven of them
 * written out four times over would be noise nobody re-reads, and noise is how
 * a stale list survives. So the three things that actually carry the ruling are
 * pinned as properties instead:
 *
 *   1. THE SET IS WHAT THE DOC SAYS IT IS. The key set is re-derived from the
 *      `#region` fence in `ObjectView.tsx` at test time and compared with
 *      `OBJECT_VIEW_HOST_COMPOSITION_KEYS`, so adding or removing a read
 *      without touching the list fails BY NAME. A hand-copied list in a test
 *      would only ever agree with itself.
 *   2. THE RULING'S BASIS HOLDS. The registered renderer passes no
 *      `renderListView`, so the branch is unreachable from the authored path.
 *      If a future change starts supplying it, 27 keys are silently promoted to
 *      the authored path — that must fail loudly, here, rather than be found by
 *      the next census.
 *   3. THE READS STILL HAPPEN. Deleting a read is the one move that silently
 *      blanks a stored app-shell document, and it is exactly what a reader of
 *      "not authored surface" is most likely to think is the tidy finish.
 *
 * ## What is NOT owed here, and why
 *
 * PR #5241's assertions 2 and 3 — "the spec rejects the key by name", "the real
 * validator answers `unknown-prop`" — do not transfer, because
 * `@objectstack/spec` carries no `object-view` entry in `ComponentPropsMap` at
 * all. That absence is itself pinned below: it is what makes the repo-wide
 * `registry-inputs-spec-parity` gate (which derives its expectations FROM
 * `ComponentPropsMap`) inapplicable to this node in either direction, so the
 * exemption owes that gate nothing. If the spec ever starts modelling
 * `object-view`, this exemption needs re-reading, and the pin says so.
 */

import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import ts from 'typescript';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ComponentPropsMap, ObjectListViewSchema as SpecObjectListViewSchema } from '@objectstack/spec/ui';
import type { NamedListView, ObjectViewSchema, ViewType } from '@object-ui/types';

import {
  ObjectView,
  OBJECT_VIEW_HOST_COMPOSITION_KEYS,
  OBJECT_VIEW_DECLARED_FORWARDED_KEYS,
  OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES,
} from '../ObjectView';
// Module scope, not a hook: this import IS the registration.
import '../index';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

// The source is read from disk rather than imported: the claim being pinned is
// about the READS in the file, and `import.meta.url` is not a file URL under
// this runner. Both candidates are covered so the pin holds whether vitest is
// invoked from the repo root or from the package.
const SOURCE_PATH = [
  resolve(process.cwd(), 'src/ObjectView.tsx'),
  resolve(process.cwd(), 'packages/plugin-view/src/ObjectView.tsx'),
].find((candidate) => existsSync(candidate));
if (!SOURCE_PATH) throw new Error('objectViewHostSurface pin cannot locate plugin-view/src/ObjectView.tsx');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
const REGION_OPEN = '// #region object-view HOST-COMPOSITION SURFACE (objectui#5097)';
const REGION_CLOSE = '// #endregion object-view HOST-COMPOSITION SURFACE (objectui#5097)';

/**
 * Comments removed before any read is derived. Not defensive tidiness: the
 * exemption block deliberately SPELLS the cast form out in prose to explain
 * itself, and the first run of this pin duly reported a host key named `K`.
 * A derivation that reads its own documentation is not a derivation.
 * Line comments are cut only where `//` is not preceded by `:`, so a URL in a
 * string literal cannot swallow the rest of its line.
 */
const stripComments = (code: string): string => mask(code);

/** Every cast read of a key off `schema` in a slice of CODE, distinct, sorted. */
const castReadsIn = (slice: string): string[] =>
  [
    ...new Set(
      [...stripComments(slice).matchAll(/\(schema as any\)\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ),
  ].sort();

const regionSlice = (): string => {
  const start = SOURCE.indexOf(REGION_OPEN);
  const end = SOURCE.indexOf(REGION_CLOSE);
  expect(
    start >= 0 && end > start,
    'The `#region object-view HOST-COMPOSITION SURFACE` fence in ObjectView.tsx is gone or reordered.\n'
      + 'It is load-bearing, not decoration: it is how this pin knows which reads the objectui#5097\n'
      + 'exemption covers. Restore it rather than deleting this test.',
  ).toBe(true);
  return SOURCE.slice(start, end);
};

// ---------------------------------------------------------------------------
// 1. The set is what the doc says it is.
// ---------------------------------------------------------------------------

describe('the forwarded key set equals the documented exemption (objectui#5097)', () => {
  // Widened to `string[]` deliberately: the constants are `as const`, and
  // comparing them against a set DERIVED from the source is the whole point —
  // narrowed literal types would make the compiler, not the file, the authority
  // on which keys exist.
  const exempt: string[] = [...OBJECT_VIEW_HOST_COMPOSITION_KEYS].sort();
  const declared: string[] = [...OBJECT_VIEW_DECLARED_FORWARDED_KEYS].sort();

  it('the fence reads exactly the 27 exempt keys plus the 3 declared ones', () => {
    expect(castReadsIn(regionSlice())).toEqual([...exempt, ...declared].sort());
  });

  it('subtracting the declared members leaves exactly the exempt list — by name', () => {
    const read = castReadsIn(regionSlice());
    expect(
      read.filter((k) => !declared.includes(k)),
      'A `(schema as any)` read inside the objectui#5097 fence was added or removed without\n'
        + 'updating OBJECT_VIEW_HOST_COMPOSITION_KEYS. That list is the exemption record the next\n'
        + 'census reads; a read it does not name is an undocumented host key, and a name with no\n'
        + 'read is a stale exemption. Update the list AND its comment block, in the same change.',
    ).toEqual(exempt);
  });

  it('the exemption covers 27 keys, the count the ruling was made on', () => {
    expect(OBJECT_VIEW_HOST_COMPOSITION_KEYS).toHaveLength(27);
    // 4 until objectui#13118 retired `filterableFields`.
    expect(OBJECT_VIEW_DECLARED_FORWARDED_KEYS).toHaveLength(3);
    // Disjoint: a key cannot be both declared surface and exempt host surface.
    expect(exempt.filter((k) => declared.includes(k))).toEqual([]);
  });

  it('NO exempt key is read outside the fence — the objectui#5248 resolution', () => {
    // This assertion used to read `.toEqual(['conditionalFormatting'])`.
    //
    // objectui#5097 measured one asymmetry: `generateViewSchema`'s kanban
    // branch read `conditionalFormatting` off the object-view node too, and
    // that branch runs exactly when no host supplied `renderListView` — i.e. on
    // the path the REGISTERED renderer takes. For that one key the ruling's
    // "the authored path cannot reach it" basis was narrower than for its 26
    // neighbours, and objectui#5248 was filed to settle it.
    //
    // Maintainer ruling 2026-08-19 (verbatim 「全部接受」): Option 2, gated on a
    // liveness check — which came back empty (no authored document in either
    // repo puts the key on an object-view node), so the fallback read was
    // dropped rather than the key declared. The set of exempt keys read outside
    // the fence is therefore EMPTY, and the exemption's basis now holds for all
    // 27 without exception. That is what this pins.
    //
    // ⛔ Do not "fix" a failure here by re-listing a key. A key read out here is
    // author-reachable; putting it back on this list is how the exemption stops
    // describing anything.
    const outside = castReadsIn(SOURCE.replace(regionSlice(), ''));
    expect(
      outside,
      'A host-composition key is read outside the objectui#5097 fence again. Reads out there are on\n'
        + 'the AUTHOR-reachable path, which is the basis the exemption rests on — so this is a\n'
        + 'contract change, not a refactor. objectui#5248 closed the one asymmetry that existed\n'
        + '(the kanban branch\'s `conditionalFormatting` fallback); re-opening one needs a ruling,\n'
        + 'not an edit to this expectation.',
    ).toEqual([]);
  });

  it('`conditionalFormatting` in particular is no longer read outside the fence (objectui#5248)', () => {
    // Named separately from the property above: the property would also pass if
    // the whole file stopped using the cast form, and this key is the one the
    // ruling is about. Its read inside the fence is asserted by the tests above
    // and by the delegation test at the bottom of this file — the key stays
    // host surface, it just stopped being author-reachable.
    expect(castReadsIn(SOURCE.replace(regionSlice(), ''))).not.toContain('conditionalFormatting');
    expect(castReadsIn(regionSlice())).toContain('conditionalFormatting');
  });
});

// ---------------------------------------------------------------------------
// 1b. The same fence, read for its NAMED-VIEW rungs (objectui#10758).
// ---------------------------------------------------------------------------
//
// Section 1 reads the fence for what it takes off the NODE. The fence also
// reads the active NAMED view (`currentNamedViewConfig`, a `listViews` entry —
// the protocol's strict `ObjectListViewSchema` since objectui#7928), and
// objectui#10758 (bucket ① of the objectui#7924 ruling) made it read every
// protocol member it relays from there first. What is pinned here:
//
//   - the named-view read set inside the fence, BY NAME, so a rung that stops
//     reading the named view fails by its name;
//   - the PROPERTY behind it: every rung the `list-view` literal writes for a
//     member the protocol declares on a named view reads the named view, and
//     the three that do not are named with their reason — so a future rung
//     for a protocol member that skips the named view fails here;
//   - its converse: no rung reads a key off the named view that the protocol
//     does not declare there (⛔ no non-protocol key, ⛔ no alias).
//
// The literal is walked with the TypeScript parser, over the fence slice only.

/** Top-level rungs of the `list-view` literal handed to `renderListView`: name → does its value read the named view. */
const namedViewRungs = (): Record<string, boolean> => {
  const sf = ts.createSourceFile('fence.tsx', regionSlice(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let literal: ts.ObjectLiteralExpression | undefined;
  const find = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'renderListView') {
      const arg = n.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'schema'
            && ts.isObjectLiteralExpression(p.initializer)) literal = p.initializer;
        }
      }
    }
    ts.forEachChild(n, find);
  };
  find(sf);
  expect(literal, 'the fence no longer hands `renderListView` a `schema: { … }` object literal').toBeDefined();
  const out: Record<string, boolean> = {};
  for (const p of literal!.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
    let reads = false;
    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === 'currentNamedViewConfig') reads = true;
      ts.forEachChild(n, walk);
    };
    walk(p.initializer);
    out[p.name.text] = reads;
  }
  return out;
};

/** Every `currentNamedViewConfig?.KEY` read in a slice of CODE, distinct, sorted. */
const namedViewReadsIn = (slice: string): string[] =>
  [...new Set([...stripComments(slice).matchAll(/currentNamedViewConfig\?\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].sort();

/**
 * The named-view reads inside the fence — the pinned READING. The first eight
 * were there before objectui#10758 (objectui#8980 and earlier); the rest are
 * bucket ①.
 */
const FENCE_NAMED_VIEW_READS = [
  'addRecord', 'allowPrinting', 'appearance', 'aria', 'bulkActionDefs', 'bulkActions', 'columns',
  'compactToolbar', 'conditionalFormatting', 'data', 'description', 'emptyState', 'exportOptions',
  'fieldOrder', 'grouping', 'hiddenFields', 'inlineEdit', 'label', 'navigation',
  'pagination', 'resizable', 'rowActions', 'rowColor', 'rowHeight', 'searchableFields', 'selection',
  'sharing', 'showRecordCount', 'userActions', 'userFilters',
];

/**
 * The rungs for a protocol member that do NOT read the named view, each for a
 * stated reason: `type` is the node's identity (`'list-view'`), not the view's
 * kind; `filter` / `sort` take the named view's segment UPSTREAM, in
 * `authoredFilters` / `mergedSort`, before the fence.
 */
const PROTOCOL_RUNGS_READ_UPSTREAM = ['filter', 'sort', 'type'];

describe('the fence reads the named view first for every protocol member it relays (objectui#10758)', () => {
  const protocol = Object.keys(SpecObjectListViewSchema.shape);

  it('the named-view reads inside the fence are exactly the pinned set — by name', () => {
    expect(namedViewReadsIn(regionSlice())).toEqual(FENCE_NAMED_VIEW_READS);
  });

  it('every rung for a protocol member reads the named view, except the three read upstream', () => {
    const rungs = namedViewRungs();
    const protocolRungs = Object.keys(rungs).filter((k) => protocol.includes(k)).sort();
    const skipping = protocolRungs.filter((k) => !rungs[k]);
    expect(
      skipping,
      'A rung in the `list-view` literal relays a member the protocol declares on a named view, and does\n'
        + 'not read the named view. objectui#10758 made the named view the first source for every such\n'
        + 'member (`currentNamedViewConfig?.KEY`, then the host `views` entry, then the node only where the\n'
        + 'rung already had one). Add the named-view read; ⛔ do not add a `(schema as any)` read.',
    ).toEqual(PROTOCOL_RUNGS_READ_UPSTREAM);
    // The upstream three really are upstream reads of the named view.
    const code = stripComments(SOURCE);
    expect(code).toMatch(/const mergedSort = currentNamedViewConfig\?\.sort/);
    expect(code).toMatch(/view: currentNamedViewConfig\?\.filter \|\|/);
    expect(stripComments(regionSlice())).toMatch(/filter: mergedFilters,/);
    expect(stripComments(regionSlice())).toMatch(/sort: mergedSort,/);
  });

  it('no rung reads a key off the named view that the protocol does not declare there — no alias, no local key', () => {
    const offProtocol = namedViewReadsIn(regionSlice()).filter((k) => !protocol.includes(k));
    expect(offProtocol).toEqual([]);
    // Control on the same instrument: the fence DOES relay non-protocol keys —
    // off the node only (`allowExport` is objectui's own, ruled on
    // objectui#7924; objectui#11013 dropped its host-entry read) — so "none
    // off the named view" is a reading.
    const rungs = namedViewRungs();
    expect(rungs).toHaveProperty('allowExport', false);
    expect(protocol).not.toContain('allowExport');
  });

  it('the named-view rungs added no cast read — the objectui#5097 exemption count is untouched', () => {
    // Section 1 already pins the cast set by name; this names the link: the
    // three rungs objectui#10758 ADDED are view-sourced only.
    const cast = castReadsIn(regionSlice());
    for (const k of ['description', 'exportOptions', 'bulkActionDefs', 'rowHeight']) {
      expect(cast, `\`${k}\` is now read off the node through a cast`).not.toContain(k);
      expect(namedViewReadsIn(regionSlice())).toContain(k);
    }
    expect(cast).toHaveLength(OBJECT_VIEW_HOST_COMPOSITION_KEYS.length + OBJECT_VIEW_DECLARED_FORWARDED_KEYS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. The ruling's basis: the registered renderer cannot reach the branch.
// ---------------------------------------------------------------------------

describe("the registered renderer cannot reach the delegation branch — the ruling's basis (objectui#5097)", () => {
  const registered = ComponentRegistry.get('object-view') as React.FC<{ schema: unknown }>;

  it('is registered, under one tag only', () => {
    expect(registered).toBeTypeOf('function');
    // One renderer under two tags was two chances to disagree with itself, so
    // this row used to pin the `view` alias to it. objectui#10859 batch 8
    // retired the alias (`objectui validate` refused it at `type`, and nothing
    // authored it): `object-view` is the one tag that reaches this renderer.
    expect(ComponentRegistry.get('view')).toBeUndefined();
    expect(ComponentRegistry.get('plugin-view:view')).toBeUndefined();
  });

  it('passes ObjectView no `renderListView`, so the branch never runs', () => {
    let passed: Record<string, unknown> | null = null;
    let renderedType: unknown = null;
    // The renderer is called as a plain function inside a probe component: it
    // holds exactly one hook (`useContext`), the call happens once, and the
    // element it returns is inspected and then discarded rather than mounted —
    // so this asserts what the registration PASSES without paying for an
    // ObjectView mount or a data fetch.
    const Probe: React.FC = () => {
      const element = registered({
        schema: { type: 'object-view', objectName: 'task' },
      }) as React.ReactElement;
      renderedType = element.type;
      passed = element.props as Record<string, unknown>;
      return null;
    };
    render(<Probe />);

    expect(renderedType).toBe(ObjectView);
    expect(
      passed,
      'The registered `object-view` renderer now supplies `renderListView`. That single prop is the\n'
        + "whole basis of the 2026-08-18 ruling on objectui#5097: it promotes 27 keys from host\n"
        + 'composition surface to the AUTHORED path, where nothing declares them and tsc cannot see\n'
        + 'them. Re-open objectui#5097 before landing this.',
    ).not.toHaveProperty('renderListView');
  });

  it('publishes none of the 27 on either tag, while publishing the declared control', () => {
    const inputsOf = (type: string): string[] =>
      ((ComponentRegistry.getConfig(type) as { inputs?: Array<{ name: string }> } | undefined)?.inputs ?? [])
        .map((i) => i.name);

    for (const tag of ['object-view', 'view']) {
      for (const key of OBJECT_VIEW_HOST_COMPOSITION_KEYS) {
        expect(
          inputsOf(tag),
          `\`${tag}\` now publishes \`${key}\` as authoring surface — the objectui#5097 ruling keeps it`
            + ' off the authored path.',
        ).not.toContain(key);
      }
    }
    // The control: without it, "publishes none of them" would pass just as
    // happily against a registration that publishes nothing at all.
    expect(inputsOf('object-view')).toEqual(
      expect.arrayContaining(['navigation', 'searchableFields']),
    );
    // objectui#13118: `filterableFields` left the control with the spec's
    // retirement of the key; the registration publishes it no longer.
    expect(inputsOf('object-view')).not.toContain('filterableFields');
  });

  it('the spec models no `object-view`, so the parity gate is owed nothing', () => {
    expect(
      Object.keys(ComponentPropsMap),
      '`@objectstack/spec` now models `object-view`. The objectui#5097 exemption was ruled on the\n'
        + 'basis that the contract has no verdict on this node at all — with a props schema present,\n'
        + 'the repo-wide registry-inputs-spec-parity gate starts covering it and the 27 keys need\n'
        + 're-reading against the spec.',
    ).not.toContain('object-view');
  });
});

// ---------------------------------------------------------------------------
// 3. The reads themselves — unchanged by the ruling, and the half a reader of
//    "not authored surface" is most likely to delete.
// ---------------------------------------------------------------------------

/** One plausible sentinel per forwarded key, distinct enough to trace. */
const SENTINELS: Record<string, unknown> = {
  addDeleteRecordsInline: true,
  addRecord: { enabled: true },
  addRecordViaForm: true,
  allowExport: true,
  allowPrinting: true,
  aria: { label: 'Tasks' },
  bulkActions: ['delete'],
  clickIntoRecordDetails: true,
  collapseAllByDefault: true,
  color: '#112233',
  compactToolbar: true,
  conditionalFormatting: [{ condition: "record.stage == 'won'", style: { color: '#ff0000' } }],
  emptyState: { title: 'Nothing here yet' },
  fieldTextColor: { name: '#0000ff' },
  hiddenFields: ['secret'],
  inlineEdit: true,
  pagination: { pageSize: 25 },
  prefixField: 'name',
  resizable: true,
  rowActionDefs: [{ name: 'archive', label: 'Archive' }],
  rowActions: ['edit'],
  selection: { mode: 'multiple' },
  sharing: { enabled: true },
  showDescription: true,
  showRecordCount: true,
  userFilters: [{ field: 'owner', operator: 'eq', value: 'me' }],
  wrapHeaders: true,
  // The three declared members ride the same branch.
  data: { api: '/api/tasks' },
  navigation: { mode: 'drawer' },
  searchableFields: ['name'],
  // RETIRED (objectui#13118) — carried by the node and forwarded no longer;
  // the last row below asserts it does not reach the host renderer.
  filterableFields: ['stage'],
};

describe('every forwarded key still reaches the host renderer (objectui#5097)', () => {
  const forwardedSchema = (): Record<string, unknown> => {
    const seen: Array<Record<string, unknown>> = [];
    const ds = {
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
    };
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', ...SENTINELS } as unknown as ObjectViewSchema}
        dataSource={ds as never}
        renderListView={({ schema: s }: { schema: Record<string, unknown> }) => {
          seen.push(s);
          return <div data-testid="delegated" />;
        }}
      />,
    );
    expect(seen.length).toBeGreaterThan(0);
    return seen[0];
  };

  it('forwards all 30 reads — 27 exempt plus 3 declared — by name', () => {
    const forwarded = forwardedSchema();
    const keys = [...OBJECT_VIEW_HOST_COMPOSITION_KEYS, ...OBJECT_VIEW_DECLARED_FORWARDED_KEYS];
    const got = Object.fromEntries(keys.map((k) => [k, forwarded[k]]));
    const want = Object.fromEntries(keys.map((k) => [k, SENTINELS[k]]));
    expect(
      got,
      'A key on the objectui#5097 exemption list stopped reaching the host list renderer. The ruling\n'
        + 'kept every read: "not authored surface" is a statement about who WRITES the key, never a\n'
        + 'licence to stop reading it. A dropped read silently blanks that setting in every stored\n'
        + 'app-shell document that carries it.',
    ).toEqual(want);
  });

  it('the retired `filterableFields` reaches the host renderer from no source (objectui#13118)', () => {
    // `@objectstack/spec` 18 retires the key (objectstack#24640, ruling C) and
    // no per-view Filter-panel whitelist replaces it, so the node's value is
    // dropped here rather than relayed into a `ListView` that reads nothing.
    // The control on the same render: a declared sibling still arrives.
    const forwarded = forwardedSchema();
    expect(SENTINELS.filterableFields).toEqual(['stage']);
    expect(forwarded).not.toHaveProperty('filterableFields');
    expect(forwarded.searchableFields).toEqual(SENTINELS.searchableFields);
  });
});

// ===========================================================================
// RECORD 2 — the `tree` and `chart` view-type branches (objectui#5321)
// ===========================================================================
//
// ## The card, and the ruling
//
// `generateViewSchema` switches on eight view types and returns a renderer
// schema for each. The type an AUTHOR uses to select one admits six of them:
// `ObjectViewSchema.defaultViewType` and `NamedListView.type` are the same
// seven-value union and neither spells `tree` or `chart`. The one segment that
// can is the `views` PROP, typed `ViewType`, which carries both. So those two
// branches — the tree branch's `viewOptions.tree.*` config surface and the
// ADR-0021 dataset-bound chart shape included — are reachable only when a HOST
// composes this component.
//
// Maintainer ruling, 2026-08-20, verbatim 「其他接受你的建议。」: option B —
// RECORD the host-only exemption, following record 1's precedent, rather than
// declare two more authored members. Two more members is a permanent
// authoring-surface obligation with no measured pull; the exemption gets
// revisited the day a real metadata-authoring need arrives.
//
// ## Where each half of the claim is pinned, and why it splits
//
// The exemption asserts two things, and they fail in different tools:
//
//   - "an author cannot select these" is a COMPILE-TIME claim. It is pinned by
//     the type-level assertions below, which fail `pnpm type-check` (the
//     package's script runs `tsc -p tsconfig.test.json` over this file). It
//     cannot be pinned at runtime: types are erased before vitest runs, so a
//     force-cast `defaultViewType: 'tree'` WOULD reach the branch, and a
//     runtime test claiming otherwise could only pass by testing something
//     else.
//   - "a host still can" is a RUNTIME claim, and it is the basis the ruling
//     rests on, so it is measured rather than asserted in prose:
//     `ObjectView.hostOnlyViewTypes.test.tsx` drives both branches through a
//     `views` prop.
//
// What is pinned HERE is the record itself: that the branch set is what this
// record says it is, and that the two names still describe real branches.

const VIEW_TYPE_REGION_OPEN = '// #region object-view VIEW-TYPE BRANCHES (objectui#5321)';
const VIEW_TYPE_REGION_CLOSE = '// #endregion object-view VIEW-TYPE BRANCHES (objectui#5321)';

/** The `generateViewSchema` switch, sliced out of the source by its fence. */
const branchSlice = (): string => {
  const start = SOURCE.indexOf(VIEW_TYPE_REGION_OPEN);
  const end = SOURCE.indexOf(VIEW_TYPE_REGION_CLOSE);
  expect(
    start >= 0 && end > start,
    'The `#region object-view VIEW-TYPE BRANCHES` fence in ObjectView.tsx is gone or reordered.\n'
      + 'It is load-bearing, not decoration: it is how this record knows which view-type branches\n'
      + 'exist. Restore it rather than deleting this test.',
  ).toBe(true);
  return SOURCE.slice(start, end);
};

/** Every `case '…':` label in a slice of CODE, distinct, sorted. */
const caseLabelsIn = (slice: string): string[] =>
  [...new Set([...stripComments(slice).matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]))].sort();

/** The eight branches the card was measured on. */
const MEASURED_BRANCHES = [
  'calendar', 'chart', 'gallery', 'gantt', 'kanban', 'map', 'timeline', 'tree',
];

// ---------------------------------------------------------------------------
// 4. The record is what the source says it is.
// ---------------------------------------------------------------------------

describe('the host-only view-type record matches the branches (objectui#5321)', () => {
  const recorded: string[] = [...OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES].sort();

  it('the fenced switch carries exactly the eight branches the card measured', () => {
    expect(
      caseLabelsIn(branchSlice()),
      'A view-type branch was added to or removed from `generateViewSchema`. That is a contract\n'
        + 'question, not a refactor: a NEW branch is authorable only if an author can spell it, so\n'
        + 'check it against `ObjectViewSchema.defaultViewType` / `NamedListView.type` and either\n'
        + 'declare it there or add it to OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES with a ruling.\n'
        + 'objectui#5321 is the precedent for the second route.',
    ).toEqual(MEASURED_BRANCHES);
  });

  it('every recorded host-only type is a real branch — no stale name', () => {
    expect(recorded.filter((t) => !caseLabelsIn(branchSlice()).includes(t))).toEqual([]);
  });

  it('the record names the two the ruling was made on', () => {
    // Hand-written on purpose: this is the RECORD, and the ruling is what puts
    // a name on it. A name appearing here without one is how an exemption stops
    // describing anything — the failure this expectation exists to cause.
    expect(
      recorded,
      'OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES changed. The maintainer ruled on exactly two names\n'
        + '(2026-08-20, objectui#5321). Adding a third — or dropping one — is a new ruling, not an\n'
        + 'edit to this list.',
    ).toEqual(['chart', 'tree']);
  });
});

// ---------------------------------------------------------------------------
// 4b. The compile-time half: the authored unions still exclude both.
// ---------------------------------------------------------------------------
//
// These fail `tsc`, not vitest, and that is the point — the claim they carry
// ("no authored document can select these") is a claim about what the compiler
// accepts. If one of them stops compiling, the exemption is STALE: someone
// widened an authored union, which is exactly the option the 2026-08-20 ruling
// rejected. Re-open objectui#5321 rather than deleting the assertion; the two
// branches and their config surfaces become authoring surface the moment the
// union admits them, with docs and migration owed.

/** The view-type union an AUTHOR writes on an object-view node. */
type AuthoredViewType = NonNullable<ObjectViewSchema['defaultViewType']>;
/** The same union on a named list view. */
type NamedViewType = NonNullable<NamedListView['type']>;

type Assert<T extends true> = T;
/** `true` only when member `M` is NOT part of union `U`. */
type NotIn<M extends string, U extends string> = M extends U ? false : true;
/** `true` only when member `M` IS part of union `U`. */
type IsIn<M extends string, U extends string> = M extends U ? true : false;

// The exemption: neither authored union admits either name.
type _TreeIsNotAuthored = Assert<NotIn<'tree', AuthoredViewType>>;
type _ChartIsNotAuthored = Assert<NotIn<'chart', AuthoredViewType>>;
type _TreeIsNotANamedView = Assert<NotIn<'tree', NamedViewType>>;
type _ChartIsNotANamedView = Assert<NotIn<'chart', NamedViewType>>;

// The other side of it: the HOST union must still carry both, or the exemption
// describes a path that no longer exists and the branches really are dead.
type _TreeIsHostSelectable = Assert<IsIn<'tree', ViewType>>;
type _ChartIsHostSelectable = Assert<IsIn<'chart', ViewType>>;

describe('the type-level half of the record (objectui#5321)', () => {
  it('is carried by the compiler, not by this suite', () => {
    // A placeholder with a purpose: the assertions above are type aliases, so
    // this file would otherwise report nothing about them and a reader could
    // reasonably think the vitest run had checked the unions. It has not —
    // `pnpm --filter @object-ui/plugin-view type-check` has.
    expect([...OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES]).toHaveLength(2);
  });
});
