/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13341 — after one write, the list asks each row's question once.
 *
 * Reported on Setup: every save, delete or action was followed by 2–6
 * `POST /api/v1/security/explain` calls, six after one business-unit create.
 * The list's half of that count is this hook. After the create, the rows'
 * answers are forgotten (objectui#10184) and the list asks again, and two
 * further things used to multiply that one re-check:
 *
 *   - the same write announced again while the re-check was on the wire (the
 *     console's `useMutationInvalidationBridge` announces every `DataSource`
 *     write, and the list host announces its own write too) staled the
 *     re-check, so every row was asked a second time;
 *   - the list's own re-read landing while the re-check was on the wire
 *     changed the id list, and the hook asked again about every row with no
 *     finished answer, the rows already on the wire among them.
 *
 * The explain endpoint here HOLDS every request until the test answers it, so
 * "on the wire" is literal and every count is a count of requests sent. Each
 * row is counted per operation, across every request that named it.
 *
 * Controls, each against the hole a fix could leave:
 *   - the re-check is still sent (one fresh request, not zero) and its answer
 *     is shown, so a verdict the write changed is followed;
 *   - a row that was on the wire BEFORE the change is still refused and asked
 *     again (objectui#10184), while the rows the change did not touch are
 *     joined rather than asked a second time;
 *   - a change announced after the re-check has answered asks again.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import {
  useRecordCrudVerdicts,
  __clearRecordCrudVerdictCache,
  type RecordCrudOperation,
} from './useRecordCrudVerdicts';

const OBJECT = 'sys_business_unit';

function me(userId: string): MePermissionsResponse {
  return {
    authenticated: true,
    userId,
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

const asAdmin = ({ children }: { children: React.ReactNode }) => (
  <MePermissionsProvider initialPermissions={me('admin')}>{children}</MePermissionsProvider>
);

interface HeldAsk {
  body: { object: string; operation: RecordCrudOperation; recordIds: string[] };
  /** The verdict per row, decided when the test answers. */
  answer: (visible: (id: string) => boolean) => Promise<void>;
  answered: boolean;
}

/** An explain endpoint that answers nothing until the test says so. */
function heldExplain() {
  const asks: HeldAsk[] = [];
  const fetchMock = vi.fn((_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Promise((resolve) => {
      const ask: HeldAsk = {
        body,
        answered: false,
        answer: async (visible) => {
          ask.answered = true;
          await act(async () => {
            resolve({
              ok: true,
              json: async () => ({
                allowed: true,
                records: (body.recordIds as string[]).map((recordId) => ({ recordId, visible: visible(recordId) })),
              }),
            });
            await new Promise((r) => setTimeout(r, 0));
          });
        },
      };
      asks.push(ask);
    });
  });
  return { asks, fetchMock };
}

/** Answer every held ask, and whatever that sets off, until nothing is held. */
async function answerAll(asks: HeldAsk[], visible: (id: string) => boolean) {
  for (let round = 0; round < 10 && asks.some((a) => !a.answered); round++) {
    for (const a of asks) if (!a.answered) await a.answer(visible);
  }
}

/** How many requests named each `operation:recordId`, from `from` on. */
function perRow(asks: HeldAsk[], from = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of asks.slice(from)) {
    for (const id of a.body.recordIds) {
      const k = `${a.body.operation}:${id}`;
      out[k] = (out[k] ?? 0) + 1;
    }
  }
  return out;
}

const once = (ids: string[]) =>
  Object.fromEntries(ids.flatMap((id) => [[`update:${id}`, 1], [`delete:${id}`, 1]]));

function usePage(recordIds: string[]) {
  const lookup = useRecordCrudVerdicts({ objectName: OBJECT, recordIds, update: true, delete: true });
  return Object.fromEntries(recordIds.map((id) => [id, { update: lookup(id, 'update'), delete: lookup(id, 'delete') }]));
}

const PAGE = ['bu1', 'bu2', 'bu3'];

async function openSettled(asks: HeldAsk[], ids = PAGE) {
  const hook = renderHook(({ rows }) => usePage(rows), { wrapper: asAdmin, initialProps: { rows: ids } });
  await waitFor(() => expect(asks).toHaveLength(2));
  await answerAll(asks, () => true);
  await waitFor(() => expect(hook.result.current[ids[0]]).toEqual({ update: true, delete: true }));
  return hook;
}

describe('useRecordCrudVerdicts — one write, one question per row (objectui#13341)', () => {
  let held: ReturnType<typeof heldExplain>;
  beforeEach(() => {
    __clearRecordCrudVerdictCache();
    held = heldExplain();
    vi.stubGlobal('fetch', held.fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a create announced twice, with the list re-read landing between, asks each row once per operation', async () => {
    const { asks } = held;
    const hook = await openSettled(asks);
    const before = asks.length;

    // The create, as the console's bridge announces it: object-wide, since a
    // create event carries no id.
    act(() => notifyDataChanged({ objectName: OBJECT }));
    await waitFor(() => expect(asks.length).toBe(before + 2));
    // The list host announces its own write again, while the re-check is held.
    act(() => notifyDataChanged({ objectName: OBJECT }));
    // The list's re-read lands with the new row, still while it is held.
    hook.rerender({ rows: [...PAGE, 'bu4'] });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await answerAll(asks, () => true);

    expect(perRow(asks, before)).toEqual(once([...PAGE, 'bu4']));
    expect(hook.result.current.bu4).toEqual({ update: true, delete: true });
  });

  it('the re-check is sent and its answer shown: a write that revoked a row is followed', async () => {
    const { asks } = held;
    const hook = await openSettled(asks);
    const before = asks.length;

    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'bu2' }));
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'bu2' }));
    await answerAll(asks, (id) => id !== 'bu2');

    expect(perRow(asks, before)).toEqual(once(['bu2']));
    await waitFor(() => expect(hook.result.current.bu2).toEqual({ update: false, delete: false }));
    expect(hook.result.current.bu1).toEqual({ update: true, delete: true });
  });

  it('a row on the wire BEFORE the change is refused and asked again, and the rows it did not touch are joined', async () => {
    const { asks } = held;
    const hook = renderHook(() => usePage(PAGE), { wrapper: asAdmin });
    await waitFor(() => expect(asks).toHaveLength(2));

    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'bu1' }));
    await waitFor(() => expect(asks.length).toBeGreaterThan(2));
    // The pre-change answers say yes; the re-check says no.
    for (const a of asks.slice(0, 2)) await a.answer(() => true);
    await answerAll(asks, (id) => id !== 'bu1');

    await waitFor(() => expect(hook.result.current.bu1).toEqual({ update: false, delete: false }));
    expect(perRow(asks, 2)).toEqual(once(['bu1']));
  });

  it('control — a change announced after the re-check answered asks again', async () => {
    const { asks } = held;
    await openSettled(asks);
    const before = asks.length;

    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'bu3' }));
    await answerAll(asks, () => true);
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: 'bu3' }));
    await answerAll(asks, () => true);

    expect(perRow(asks, before)).toEqual({ 'update:bu3': 2, 'delete:bu3': 2 });
  });
});
