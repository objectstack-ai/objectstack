// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for the orphan-ledger-entry scan (the reverse direction of the
// liveness gate — see orphans.mts for why it exists).
//
// These matter more than a typical unit test: the tree was ORPHAN-FREE when the
// check landed, so a green `check:liveness` proves nothing about whether the
// scan can fire at all. That proof has to come from here. Real-ledger coverage
// is the gate's own CI job (`Spec property liveness`), which walks the live Zod
// schemas — this file owns the logic, including every case it must stay quiet on.

import { describe, it, expect } from 'vitest';
import { findOrphanEntries, ORPHAN_GUIDANCE } from './orphans.mts';

/** No property is a container unless a test says so. */
const noChildren = () => null;

/** A container map keyed by the dotted path the scan asks about. */
const containers = (map: Record<string, readonly string[]>) => (path: readonly string[]) =>
  map[path.join('.')] ?? null;

describe('findOrphanEntries — rows it must catch', () => {
  it('catches a top-level row whose key left the schema (the strict-removal shape)', () => {
    const orphans = findOrphanEntries({
      type: 'tool',
      props: { name: { status: 'live' }, category: { status: 'dead' } },
      shapeKeys: ['name'], // `category` was deleted from the `.strict()` ToolSchema
      childKeysOf: noChildren,
    });
    expect(orphans).toEqual([{ key: 'tool/category', level: 'top' }]);
  });

  it('catches a drilled child row whose key left its container', () => {
    const orphans = findOrphanEntries({
      type: 'report',
      props: { layout: { children: { columns: { status: 'live' }, aria: { status: 'dead' } } } },
      shapeKeys: ['layout'],
      childKeysOf: containers({ layout: ['columns'] }),
    });
    expect(orphans).toEqual([{ key: 'report/layout.aria', level: 'child' }]);
  });

  it('reports every orphan, not just the first', () => {
    const orphans = findOrphanEntries({
      type: 'view',
      props: {
        gone: { status: 'dead' },
        alsoGone: { status: 'live' },
        list: { children: { type: { status: 'live' }, responsive: { status: 'dead' } } },
      },
      shapeKeys: ['list'], // `gone` and `alsoGone` both left the schema
      childKeysOf: containers({ list: ['type'] }),
    });
    expect(orphans.map((o) => o.key)).toEqual(['view/gone', 'view/alsoGone', 'view/list.responsive']);
  });

  it('catches an orphan at DEPTH TWO — the level the scan used to stop above', () => {
    // Before the walk recursed, a nested `children` map was ignored wholesale,
    // so a row naming a key its container never had was not an orphan, not
    // unclassified, and not printed. The scan has to follow the walk down.
    const orphans = findOrphanEntries({
      type: 'dashboard',
      props: {
        widgets: {
          children: {
            chartConfig: { children: { stacked: { status: 'live' }, sparkline: { status: 'dead' } } },
          },
        },
      },
      shapeKeys: ['widgets'],
      childKeysOf: containers({ widgets: ['chartConfig'], 'widgets.chartConfig': ['stacked'] }),
    });
    expect(orphans).toEqual([{ key: 'dashboard/widgets.chartConfig.sparkline', level: 'child' }]);
  });

  it('keeps descending past a child that matches, to any depth the ledger declares', () => {
    const orphans = findOrphanEntries({
      type: 'dashboard',
      props: {
        a: { children: { b: { children: { c: { children: { gone: { status: 'live' } } } } } } },
      },
      shapeKeys: ['a'],
      childKeysOf: containers({ a: ['b'], 'a.b': ['c'], 'a.b.c': ['kept'] }),
    });
    expect(orphans).toEqual([{ key: 'dashboard/a.b.c.gone', level: 'child' }]);
  });
});

describe('findOrphanEntries — cases it must stay quiet on', () => {
  it('does NOT flag a `retiredKey()` tombstone — z.never() is still a property', () => {
    // The asymmetry this whole check exists to make legible: a tombstoned key
    // stays in the walked shape, so its row is correct and must stay. Flagging
    // it would tell the author to delete a row whose deletion fails CI as
    // UNCLASSIFIED — pushing them into an infinite loop between two gates.
    const orphans = findOrphanEntries({
      type: 'action',
      props: { shortcut: { status: 'dead', note: 'REMOVED — tombstoned, row stays' } },
      shapeKeys: ['shortcut'],
      childKeysOf: noChildren,
    });
    expect(orphans).toEqual([]);
  });

  it('defers `children` declared on a non-container to the forward pass', () => {
    // The forward walk already reports this as UNCLASSIFIED with a more precise
    // message ("declared children but property is not a container"). Two
    // headings for one fix reads as two problems.
    const orphans = findOrphanEntries({
      type: 'flow',
      props: { name: { children: { nope: { status: 'dead' } } } },
      shapeKeys: ['name'],
      childKeysOf: noChildren, // `name` is a string, not a container
    });
    expect(orphans).toEqual([]);
  });

  it('is quiet on a ledger that matches its schema exactly', () => {
    const orphans = findOrphanEntries({
      type: 'skill',
      props: { name: { status: 'live' }, tools: { status: 'live' } },
      shapeKeys: ['name', 'tools', 'label'], // an unclassified extra is the FORWARD pass's job
      childKeysOf: noChildren,
    });
    expect(orphans).toEqual([]);
  });

  it('handles an absent or empty props block without throwing', () => {
    const base = { type: 'page', shapeKeys: ['name'], childKeysOf: noChildren };
    expect(findOrphanEntries({ ...base, props: undefined })).toEqual([]);
    expect(findOrphanEntries({ ...base, props: {} })).toEqual([]);
  });

  it('does not confuse an entry FIELD with a child prop', () => {
    // `status`/`evidence`/`verifiedAt`/`note`/`authorWarn` live on the row, not
    // under `children` — only a declared `children` map is drilled.
    const orphans = findOrphanEntries({
      type: 'agent',
      props: {
        role: { status: 'live', evidence: 'x.ts:1', verifiedAt: '2026-07-30', authorWarn: true, note: 'n' },
      },
      shapeKeys: ['role'],
      childKeysOf: () => ['definitely', 'not', 'these'],
    });
    expect(orphans).toEqual([]);
  });
});

describe('findOrphanEntries — depth, and where it stops', () => {
  it("does NOT list an orphan's own subtree — the parent row is the single fix", () => {
    const orphans = findOrphanEntries({
      type: 'dashboard',
      props: { widgets: { children: { ghost: { children: { x: { status: 'live' }, y: { status: 'dead' } } } } } },
      shapeKeys: ['widgets'],
      childKeysOf: containers({ widgets: ['real'] }),
    });
    expect(orphans).toEqual([{ key: 'dashboard/widgets.ghost', level: 'child' }]);
  });

  it('defers a non-container at depth two to the forward pass, exactly as at depth one', () => {
    const orphans = findOrphanEntries({
      type: 'dashboard',
      props: { widgets: { children: { title: { children: { nope: { status: 'dead' } } } } } },
      shapeKeys: ['widgets'],
      childKeysOf: containers({ widgets: ['title'] }), // `title` is a string
    });
    expect(orphans).toEqual([]);
  });
});

describe('ORPHAN_GUIDANCE', () => {
  it('names both causes and the asymmetry, so the wrong fix is not the obvious one', () => {
    const text = ORPHAN_GUIDANCE.join(' ');
    expect(text).toMatch(/STRICT-REMOVAL/);
    expect(text).toMatch(/Delete the row/);
    expect(text).toMatch(/retiredKey\(\).*KEEPS the key/);
    expect(text).toMatch(/UNCLASSIFIED/);
    expect(text).toMatch(/Fix the walk, not the row/);
  });
});
