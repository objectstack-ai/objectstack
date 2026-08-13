// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5320/#8070] The assembled-manifest view channel — vocabulary and partition.
 *
 * Three contracts under test, each an inversion of a probe the #5320 fork
 * measured against a built dist (2026-08-12):
 *
 *  1. `AssembledViewArtifactSchema` accepts EXACTLY the non-container branches
 *     of the `view` metadata vocabulary — the three classes the fork measured
 *     as stack-schema-refused yet metadata-door-legal (expanded `viewKind`
 *     items, tenant-authored standalone ViewItems, flattened overlays) — and
 *     refuses containers, which travel in `views:`.
 *  2. `partitionAssembledViewArtifacts` re-aggregates: the minimal
 *     single-container export set (container + its 2 expanded items) folds to
 *     `views:[container]` with NOTHING in `viewItems:` (the import side's own
 *     expansion re-derives both), while artifacts no container re-derives
 *     travel in `viewItems:` — never dropped.
 *  3. The authored stack surface REFUSES a hand-written `viewItems:` with the
 *     machine-assembled prescription (decision documented in
 *     `assembled-views.zod.ts`: refuse-loudly, not legal-by-design).
 */

import { describe, it, expect } from 'vitest';
import {
  ASSEMBLED_VIEW_ITEMS_KEY,
  AssembledViewArtifactSchema,
  partitionAssembledViewArtifacts,
  expandViewContainer,
} from './index';
import { ObjectStackDefinitionSchema } from '../stack.zod';

const DATA = { provider: 'object', object: 'account' } as const;

/** The minimal schema-valid container of the fork's probe: a default list and
 *  a default form → expands to `account.default` + `account.form`. */
const CONTAINER = {
  name: 'account',
  object: 'account',
  list: { type: 'grid', columns: ['name'], data: DATA },
  form: { type: 'simple', sections: [{ label: 'Details', fields: [{ field: 'name' }] }] },
} as const;

const STANDALONE_ITEM = {
  name: 'account.hot',
  object: 'account',
  viewKind: 'list',
  config: { type: 'grid', columns: [{ field: 'name' }] },
} as const;

describe('AssembledViewArtifactSchema — the non-container view vocabulary (#5320)', () => {
  it('accepts an expanded viewKind item (what the ADR-0017 dual-read exports)', () => {
    const [expanded] = expandViewContainer('account', CONTAINER);
    expect(expanded.viewKind).toBe('list');
    const r = AssembledViewArtifactSchema.safeParse(expanded);
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('accepts a tenant-authored standalone ViewItem (vocabulary branch 1)', () => {
    const r = AssembledViewArtifactSchema.safeParse(STANDALONE_ITEM);
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('accepts a flattened list overlay (vocabulary branch 3)', () => {
    const r = AssembledViewArtifactSchema.safeParse({
      name: 'account.default',
      object: 'account',
      viewKind: 'list',
      type: 'grid',
      columns: ['name'],
      isPinned: true,
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('accepts a flattened form overlay (vocabulary branch 4)', () => {
    const r = AssembledViewArtifactSchema.safeParse({
      name: 'account.form',
      object: 'account',
      viewKind: 'form',
      type: 'simple',
      sections: [{ label: 'Details', fields: [{ field: 'name' }] }],
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('refuses a container — containers travel in `views:`, not `viewItems:`', () => {
    expect(AssembledViewArtifactSchema.safeParse(CONTAINER).success).toBe(false);
  });

  it('refuses a bag that speaks no view vocabulary', () => {
    expect(AssembledViewArtifactSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe('partitionAssembledViewArtifacts — re-aggregation where a container exists', () => {
  it('folds the minimal single-container export set to the container alone', () => {
    // What the registry holds after registering CONTAINER: the container under
    // the bare object key AND its expanded items (dual-read) — the exact 3-entry
    // set the fork's probe read back from `getMetaItems('view', pkg)`.
    const expanded = expandViewContainer('account', CONTAINER);
    expect(expanded.map((v) => v.name).sort()).toEqual(['account.default', 'account.form']);

    const { views, viewItems, folded } = partitionAssembledViewArtifacts([
      CONTAINER,
      ...(expanded as unknown as Record<string, unknown>[]),
    ]);
    expect(views).toEqual([CONTAINER]);
    expect(viewItems).toEqual([]);
    expect(folded.sort()).toEqual(['account.default', 'account.form']);
  });

  it('keeps a standalone ViewItem — no container to re-aggregate from', () => {
    const { views, viewItems, folded } = partitionAssembledViewArtifacts([
      CONTAINER,
      STANDALONE_ITEM as unknown as Record<string, unknown>,
    ]);
    expect(views).toEqual([CONTAINER]);
    expect(viewItems).toEqual([STANDALONE_ITEM]);
    expect(folded).toEqual([]);
  });

  it('keeps an expanded item whose stored body DIVERGED from its container', () => {
    // A tenant edited the expanded item after registration: folding it away
    // would silently revert the edit on the next import. It must travel.
    const [expandedList] = expandViewContainer('account', CONTAINER);
    const edited = {
      ...(expandedList as unknown as Record<string, unknown>),
      config: { type: 'grid', columns: ['name', 'industry'], data: DATA },
    };
    const { viewItems, folded } = partitionAssembledViewArtifacts([CONTAINER, edited]);
    expect(viewItems).toEqual([edited]);
    expect(folded).toEqual([]);
  });

  it('keeps a personalised expanded item (round-trip keys are payload, not noise)', () => {
    const [expandedList] = expandViewContainer('account', CONTAINER);
    const pinned = { ...(expandedList as unknown as Record<string, unknown>), isPinned: true };
    const { viewItems } = partitionAssembledViewArtifacts([CONTAINER, pinned]);
    expect(viewItems).toEqual([pinned]);
  });

  it('keeps a flattened overlay', () => {
    const overlay = {
      name: 'account.default',
      object: 'account',
      viewKind: 'list',
      type: 'grid',
      columns: ['name'],
      isPinned: true,
    };
    const { viewItems } = partitionAssembledViewArtifacts([overlay]);
    expect(viewItems).toEqual([overlay]);
  });

  it('classes an EMPTY container as a container, not a viewItem', () => {
    // Schema-legal ({} with identity only), registers nothing on expansion —
    // but it is container-shaped and must not be smuggled into `viewItems:`,
    // where the strict artifact union would refuse it.
    const empty = { name: 'account', object: 'account' };
    const { views, viewItems } = partitionAssembledViewArtifacts([empty]);
    expect(views).toEqual([empty]);
    expect(viewItems).toEqual([]);
  });
});

describe('authored `viewItems:` is refused loudly (machine-assembled only)', () => {
  it('names the channel and the prescription in the refusal', () => {
    const r = ObjectStackDefinitionSchema.safeParse({
      manifest: { id: 'com.test.app', name: 'test', version: '1.0.0', type: 'app' },
      [ASSEMBLED_VIEW_ITEMS_KEY]: [STANDALONE_ITEM],
    });
    expect(r.success).toBe(false);
    const issue = (r as { error: { issues: Array<{ path: unknown[]; message: string }> } }).error
      .issues.find((i) => i.path[0] === ASSEMBLED_VIEW_ITEMS_KEY);
    expect(issue, 'refusal must be located at the `viewItems` key').toBeTruthy();
    expect(issue!.message).toContain('machine-assembled');
    expect(issue!.message).toContain('defineView');
    expect(issue!.message).toContain('metadata door');
  });

  it('does not disturb a well-formed authored stack (containers in `views:`)', () => {
    const r = ObjectStackDefinitionSchema.safeParse({
      manifest: { id: 'com.test.app', name: 'test', version: '1.0.0', type: 'app' },
      views: [CONTAINER],
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});
