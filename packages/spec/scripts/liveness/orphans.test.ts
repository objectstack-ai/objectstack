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
      childKeysOf: (key) => (key === 'layout' ? ['columns'] : null),
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
      childKeysOf: (key) => (key === 'list' ? ['type'] : null),
    });
    expect(orphans.map((o) => o.key)).toEqual(['view/gone', 'view/alsoGone', 'view/list.responsive']);
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
