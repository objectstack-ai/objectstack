/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6898 — field-level security on the `$select` PROJECTION.
 *
 * ## The two halves
 *
 * objectui#6799 closed the RENDER half: `generateColumns()` drops a column
 * naming a declared field the principal cannot read. This is the FETCH half —
 * what `getSelectFields()` hands the server. Before this change the field name
 * was still in `$select`, so the column was hidden while the value was still
 * being ASKED for.
 *
 * ## What the escalation gate measured (why this file pins a p2, not a p1)
 *
 * ObjectStack's own server enforces FLS on the RECORD, not on the projection:
 * `plugin-security`'s read middleware runs `FieldMasker.maskResults`, whose
 * `maskRecord` DELETES an unreadable key from every returned row, and
 * `predicate-guard.ts` states outright that the projection is deliberately not
 * guarded because "selecting a hidden field is harmless because FieldMasker
 * strips it from the result". Pinned end-to-end over real HTTP in objectstack's
 * `showcase-fls-read-mask-strip.dogfood.test.ts`: `?select=name,<denied>`
 * answers 200 with the denied key ABSENT.
 *
 * So against ObjectStack this gate is defence-in-depth and nothing here is
 * load-bearing for that backend. It is load-bearing for any backend that does
 * not strip — the same argument objectui#6723 / objectui#6799 accepted for the
 * render half.
 *
 * ## The limit is the point (PIN 4 / PIN 5)
 *
 * Only keys the object DECLARES are judged. `checkField` answers `false` for a
 * field no policy mentions, so judging an undeclared key would strip a host's
 * derived or joined column out of its own query — a different, wrong rule. And
 * the judged key is read through `columnIdentity`, never off a bare string, so
 * the legacy `{ name }` spelling cannot walk a denied field through (PIN 5).
 *
 * ## `id` and the predicate operands (the card's decision point 2)
 *
 * `id` is force-added for row navigation and predicate operands are added
 * though no column shows them, so a NAIVE filter breaks navigation or an action
 * rather than closing a hole. PIN 3 pins that `id` survives even when the
 * policy denies it — structurally, because `ensureId` composes AFTER the gate.
 *
 * ## Why the stub `checkField` is an ALLOWLIST
 *
 * Inherited from `authoredColumnsFls-6799.test.tsx` for the same reason:
 * `PermissionProvider` answers `true` for a field no policy mentions, so under
 * it the limit would be untestable and PIN 4 would be green in both worlds for
 * the wrong reason. The stub models a server that ENUMERATES readable fields.
 *
 * ## ABLATION — see the PR body for the recorded run.
 *
 * This file imports `../ObjectGrid` relatively and the root vitest config
 * aliases `@object-ui/*` to each package's `src`, so no build step stands
 * between the edit and the run: the ablation reads source directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

/** Stable stub identity — `ObjectGrid` carries `perms` in memo dep arrays. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { isLoaded: boolean; readable: string[] } = {
    isLoaded: true,
    readable: [],
  };
  return {
    state,
    permsStub: {
      get isLoaded() { return state.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? state.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';

const OBJECT = 'opportunity';

/**
 * `salary` is DECLARED and denied — the field under test. `computed_score` is
 * deliberately NOT declared: it is the derived / host-joined key the limit
 * protects. `stage` is declared and readable, and is the predicate operand.
 */
const OBJECT_FIELDS = {
  name: { type: 'text', label: 'Name' },
  salary: { type: 'number', label: 'Salary' },
  stage: { type: 'select', label: 'Stage' },
};

const makeDataSource = (schemaExtra: Record<string, unknown> = {}) => ({
  // `vi.fn().mockResolvedValue(...)` rather than `vi.fn(async () => ...)`: the
  // inline implementation narrows the mock's ARG tuple to `[]`, and every
  // assertion here reads `find.mock.calls.at(-1)?.[1].$select` — the second arg.
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({
    name: OBJECT,
    fields: OBJECT_FIELDS,
    ...schemaExtra,
  })),
});

/** Render a grid and return the `$select` it actually asked the server for. */
const selectFor = async (
  schemaExtra: Record<string, unknown>,
  objectSchemaExtra: Record<string, unknown> = {},
): Promise<string[]> => {
  const ds = makeDataSource(objectSchemaExtra);
  const schema: any = { type: 'object-grid', objectName: OBJECT, ...schemaExtra };
  render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds as never} />
    </ActionProvider>,
  );
  await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
};

beforeEach(() => {
  vi.clearAllMocks();
  state.isLoaded = true;
  state.readable = [];
});
afterEach(() => cleanup());

describe('ObjectGrid — `$select` is FLS-gated (objectui#6898)', () => {
  // ── PIN 1: the defect itself ────────────────────────────────────────────
  it('does NOT ask the server for a declared column the principal cannot read', async () => {
    state.readable = ['name', 'stage', 'id'];
    const select = await selectFor({ columns: ['name', 'salary'] });
    expect(
      select,
      'the denied declared field is still being REQUESTED — objectui#6799 hid the column, '
        + 'this is the fetch half and the value would still arrive from a non-enforcing backend',
    ).not.toContain('salary');
  });

  it('still asks for the readable columns — the gate narrows, it never empties', async () => {
    state.readable = ['name', 'stage', 'id'];
    const select = await selectFor({ columns: ['name', 'salary'] });
    expect(select).toContain('name');
  });

  // ── PIN 2: the `fields` arm, not just `columns` ─────────────────────────
  it('gates the `fields` arm too, not only the `columns` arm', async () => {
    state.readable = ['name', 'id'];
    const select = await selectFor({ fields: ['name', 'salary'] });
    expect(select).not.toContain('salary');
    expect(select).toContain('name');
  });

  // ── PIN 3: navigation survives (the card's decision point 2) ────────────
  it('keeps `id` even when the policy denies it — row navigation must not break', async () => {
    // `id` deliberately absent from `readable`: the pathological case.
    state.readable = ['name'];
    const select = await selectFor({ columns: ['id', 'name'] });
    expect(
      select,
      'without `id` the record key is undefined and row click / the primary-field '
        + 'link silently no-op — a naive filter breaks navigation rather than closing a hole',
    ).toContain('id');
  });

  // ── PIN 4: THE LIMIT — undeclared keys are not this gate's business ─────
  it('leaves an UNDECLARED (derived / host-joined) key in the projection', async () => {
    state.readable = ['name', 'id'];
    const select = await selectFor({ columns: ['name', 'computed_score'] });
    expect(
      select,
      '`checkField` answers false for a field no policy mentions, so judging an undeclared '
        + 'key is a different, wrong rule — it would strip a host derived column from its own query',
    ).toContain('computed_score');
  });

  // ── PIN 5: the judged key is read through `columnIdentity` ──────────────
  it('judges the legacy `{ name }` spelling — a bare-string read would wave it through', async () => {
    state.readable = ['name', 'id'];
    const select = await selectFor({ columns: [{ name: 'salary' }, { field: 'name' }] });
    expect(select).not.toContain('salary');
    expect(select).toContain('name');
  });

  // ── PIN 6/7: the predicate harvest is gated, readable operands survive ──
  it('drops a denied predicate operand from the projection', async () => {
    state.readable = ['name', 'id'];
    const select = await selectFor({
      columns: ['name'],
      rowActionDefs: [{
        name: 'raise', label: 'Raise', type: 'api', locations: ['list_item'],
        target: '/x', visible: 'record.salary > 0',
      }],
    });
    expect(
      select,
      'against ObjectStack the server already DELETES this key from every row, so the '
        + 'operand never arrived and CEL already failed closed — dropping it changes what '
        + 'we ASK for, not what we got',
    ).not.toContain('salary');
  });

  it('keeps a READABLE predicate operand — objectui#3501 must not regress', async () => {
    state.readable = ['name', 'stage', 'id'];
    const select = await selectFor({
      columns: ['name'],
      rowActionDefs: [{
        name: 'advance', label: 'Advance', type: 'api', locations: ['list_item'],
        target: '/x', visible: 'record.stage == "open"',
      }],
    });
    expect(
      select,
      'the operand of a predicate this principal CAN read must still be projected, or CEL '
        + 'faults `No such key`, fails closed, and the row action vanishes for everyone',
    ).toContain('stage');
  });

  // ── PIN 8: deferral — an unanswered policy filters nothing ──────────────
  it('filters NOTHING while `/me/permissions` has not answered', async () => {
    state.isLoaded = false;
    state.readable = [];
    const select = await selectFor({ columns: ['name', 'salary'] });
    expect(
      select,
      'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
        + 'forever, and a grid with no PermissionProvider must keep working',
    ).toEqual(expect.arrayContaining(['name', 'salary']));
  });

  // ── PIN 9: the gate is not DEAD — it must survive the async answer ──────
  //
  // `/me/permissions` resolves asynchronously, so on the first render
  // `isLoaded` is false and the gate defers. If the fetch effect does not
  // depend on `perms.isLoaded`, nothing ever rebuilds the projection and the
  // gate never runs on the only fetch most grids make. This is the pin that
  // fails if that dependency is dropped, and no other case here would notice.
  it('re-projects once the policy answers — the gate is not dead on the first fetch', async () => {
    state.isLoaded = false;
    state.readable = ['name', 'id'];
    const ds = makeDataSource();
    const schema: any = { type: 'object-grid', objectName: OBJECT, columns: ['name', 'salary'] };
    const { rerender } = render(
      <ActionProvider>
        <ObjectGrid schema={schema} dataSource={ds as never} />
      </ActionProvider>,
    );
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(
      (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[],
      'baseline: while unanswered the denied field is still requested',
    ).toContain('salary');

    // The policy answers.
    state.isLoaded = true;
    rerender(
      <ActionProvider>
        <ObjectGrid schema={schema} dataSource={ds as never} />
      </ActionProvider>,
    );
    await vi.waitFor(() => {
      const latest = (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
      expect(
        latest,
        'the projection was never rebuilt after the policy answered — `perms.isLoaded` is '
          + 'missing from the fetch effect deps and this gate is dead in practice',
      ).not.toContain('salary');
    });
  });
});
