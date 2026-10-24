/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7230 — field-level security on `DetailView`'s `$expand`.
 *
 * ## This site is DIFFERENT from the other four, and the difference is measured
 *
 * The card lists this call as "passes a column list, ungated". Measured on
 * `main`, that is half right and the other half is what makes it interesting:
 * the list it passes is `allFields`, collected from `schema.sections` /
 * `schema.fields` — and `schema` here is `gatedSchema`, which this component
 * ALREADY FLS-filters field by field (`DetailView.tsx`, the `gatedSchema` memo,
 * whose comment even names "$expand build" among the downstream uses it means
 * to protect).
 *
 * So this site is not ungated. It is **INPUT-gated** — precisely the route PR
 * #7229 measured as unsound and rejected. The consequence is not "a denied
 * lookup slips through in the ordinary case"; it is worse and narrower:
 *
 *   `buildExpandFields` reads an EMPTY column list as "no column restriction"
 *   and falls back to EVERY declared relation on the object.
 *
 * ⇒ Filtering the input therefore WIDENS the request in exactly the case where
 * the principal may read least. A detail view whose authored fields are all
 * denied has its column list gated down to `[]` and its `$expand` widened from
 * "the relations it asked for" to "every relation the object declares",
 * denied ones included. The same widening is reached with no authored field
 * list at all (a synthesized/auto-derived detail view), where the input filter
 * has nothing to remove and the expansion is maximal from the start.
 *
 * That is why the pins below are split into two groups, and why the split is
 * stated rather than hidden: PIN 1 and PIN 2 are GREEN in both directions —
 * they pin the property the input filter already delivers and this change must
 * not lose — while PIN 3 and PIN 4 are the RED ones that carry this card.
 * A green pin proves nothing on its own; naming which pins discriminate is the
 * discipline `RecordDetailView.sectionHeadingsRenderPath-6190.test.tsx` records.
 *
 * ## The fix is the same OUTPUT gate as everywhere else
 *
 * Moving the gate to `buildExpandFields`'s output closes the widening without
 * removing the input filter (which is load-bearing for the RENDER half), and it
 * makes the "`checkField` answers false for an undeclared key" trap
 * structurally unreachable — the helper returns only DECLARED reference-bearing
 * fields.
 *
 * The stub `checkField` is an ALLOWLIST, per `expandFls-7215.test.tsx`: the real
 * provider answers `true` for any field no policy mentions.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/** Stable stub identity — `perms` rides the fetch effect's dependency list. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { isLoaded: boolean; readable: string[] } = { isLoaded: true, readable: [] };
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

import { DetailView } from '../DetailView';

const OBJECT = 'opportunity';

/**
 * `account` is the readable `lookup` control, `owner_dept` the denied
 * `master_detail`, `secret_account` the denied `lookup` under test.
 * `computed_score` is deliberately NOT declared anywhere below — it is the
 * derived / host-joined key the ordering limit protects.
 */
const OBJECT_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  stage: { type: 'select', label: 'Stage' },
  account: { type: 'lookup', reference: 'accounts', label: 'Account' },
  secret_account: { type: 'lookup', reference: 'accounts', label: 'Secret Account' },
  owner_dept: { type: 'master_detail', reference: 'departments', label: 'Dept' },
};

const RECORD = { id: 'o1', name: 'Big deal' };

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => RECORD),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: OBJECT_FIELDS })),
  } as Record<string, any>;
}

/**
 * Render a fetching detail view and hand back the `$expand` it asked for.
 * The `waitFor` targets a real recorded `findOne`, so a component that stopped
 * fetching times out instead of reading as an empty expansion.
 */
async function expandFor(schemaExtra: Record<string, unknown>): Promise<string[]> {
  const ds = makeDataSource();
  render(
    <DetailView
      schema={{
        type: 'detail-view',
        objectName: OBJECT,
        resourceId: 'o1',
        ...schemaExtra,
      } as never}
      dataSource={ds as never}
    />,
  );
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  return (ds.findOne.mock.calls.at(-1)?.[2]?.$expand ?? []) as string[];
}

const AUTHORED = {
  sections: [
    {
      title: 'Basics',
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'account', label: 'Account' },
        { name: 'secret_account', label: 'Secret Account' },
        { name: 'owner_dept', label: 'Dept' },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.isLoaded = true;
  state.readable = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // `useRecordEditable` probes `/api/v1/security/explain` for the ROW-level
  // verdict whenever the object-level check passes (the stub above allows it).
  // happy-dom resolves that relative URL to a real socket, which the repo's
  // network-escape guard fails the file for (objectui#6640) — so serve it from
  // a double. Its answer is orthogonal to `$expand`: this file observes the
  // query parameters, not the edit affordance.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DetailView — `$expand` is FLS-gated on the helper OUTPUT (objectui#7230)', () => {
  describe('already delivered by the INPUT filter — green in both directions, and must stay so', () => {
    // ── PIN 1 ────────────────────────────────────────────────────────────
    it('does not expand a denied lookup that the authored field list names', async () => {
      state.readable = ['id', 'name', 'account'];
      const expand = await expandFor(AUTHORED);
      expect(expand).not.toContain('secret_account');
      expect(expand).not.toContain('owner_dept');
    });

    // ── PIN 2: the live control — the gate narrows, it never empties ─────
    it('still expands a lookup the principal CAN read', async () => {
      state.readable = ['id', 'name', 'account'];
      const expand = await expandFor(AUTHORED);
      expect(
        expand,
        'a gate that killed all expansion would show a bare foreign-key id where the '
          + 'related record’s display name belongs',
      ).toEqual(['account']);
    });
  });

  describe('the widening this card exists to close — RED before the output gate', () => {
    // ── PIN 3: input-gating to EMPTY widens to every relation ────────────
    it('does NOT widen to every declared relation when every authored field is denied', async () => {
      state.readable = ['id'];
      const expand = await expandFor(AUTHORED);
      expect(
        expand,
        '`buildExpandFields` reads an empty column list as "no column restriction" and '
          + 'falls back to every declared relation, so filtering its INPUT turns the most '
          + 'restricted principal into the one that asks for the most',
      ).toEqual([]);
    });

    // ── PIN 4: no authored field list at all ────────────────────────────
    it('gates a detail view that declares NO fields, where the expansion is maximal', async () => {
      state.readable = ['id', 'name', 'account'];
      const expand = await expandFor({});
      expect(
        expand,
        'with no `sections`/`fields` the input filter has nothing to remove and the helper '
          + 'expands every declared relation — the case an input-side gate cannot reach',
      ).toEqual(['account']);
    });
  });

  describe('limits', () => {
    // ── PIN 5: THE ORDERING LIMIT — an undeclared column is not judged ───
    it('leaves an UNDECLARED (derived / host-joined) field alone and keeps expanding', async () => {
      state.readable = ['id', 'name', 'account'];
      const expand = await expandFor({
        sections: [{
          title: 'Basics',
          fields: [
            { name: 'name', label: 'Name' },
            { name: 'computed_score', label: 'Score' },
            { name: 'account', label: 'Account' },
          ],
        }],
      });
      expect(
        expand,
        '`checkField` answers false for a key no policy mentions; the gate is on the '
          + 'helper’s OUTPUT, which contains only DECLARED reference-bearing fields, so a '
          + 'derived column is never judged and cannot take the expansion down with it',
      ).toEqual(['account']);
    });

    // ── PIN 6: deferral — an unanswered policy filters nothing ──────────
    it('filters NOTHING while `/me/permissions` has not answered', async () => {
      state.isLoaded = false;
      state.readable = [];
      const expand = await expandFor(AUTHORED);
      expect(
        expand,
        'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
          + 'forever, and a detail view with no PermissionProvider must keep expanding',
      ).toEqual(expect.arrayContaining(['account', 'secret_account', 'owner_dept']));
    });
  });
});
