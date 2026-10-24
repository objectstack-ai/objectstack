/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A rejected card move must render the refusal text the PRODUCER marked as
 * user-facing, instead of substituting a generic string for it. objectui#5902,
 * inheriting the objectui#5210 ruling (already implemented for the console
 * form) onto this drag-write surface.
 *
 * ── Why this needs a surface pin and not a reader unit test ────────────────
 * `declaredUserMessage` already has unit tests, and
 * `error-message.normalisation-boundary.test.ts` already pins that the marking
 * survives the adapter's re-wraps. Neither of them can see this defect: the
 * marking arrived at this file intact and the toast dropped it on the floor.
 * The only thing that fails when a surface stops reading the marking is a pin
 * ON that surface, driven end to end.
 *
 * ── Fixtures come through the real boundary ───────────────────────────────
 * Every error below is built as a wire-shaped rejection and pushed through
 * `normaliseClientError`, the same adapter boundary a real `dataSource.update`
 * failure crosses. Hand-rolling the post-boundary shape here would pin this
 * surface against THIS file's idea of where the marking lives — which is the
 * asymmetry that makes it worth pinning at all: `ConcurrentUpdateError` parks
 * it on a typed top-level member, `DataApiValidationError` parks it in the
 * details bag, and a 403 is passed through untouched. All three must reach the
 * user identically, because the contract is status-agnostic.
 *
 * ── Direction of these pins ───────────────────────────────────────────────
 *  - the three MARKED arms   → RED before the fix (they read the generic
 *                              substitution), GREEN after. These are the issue.
 *  - the three UNMARKED arms → GREEN before and after. Without them a fix that
 *                              simply printed `String(error)` would pass, and
 *                              that is the objectstack#3821 defect this
 *                              surface's substitution exists to prevent.
 *
 * The board is driven through `DndContext`'s real `onDragEnd`, captured by the
 * module mock below — the same harness `ObjectKanban.rejectedMoveRollback.test.tsx`
 * uses, and for the same reason: dnd-kit's pointer sensors need layout and
 * pointer-capture that jsdom does not provide.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import { normaliseClientError } from '@object-ui/data-objectstack';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time rather than racing it against a
// `findBy` budget (AGENTS.md §测试纪律); specifier byte-identical to `./index`'s
// so the component's own `React.lazy` factory resolves from the ESM cache.
import './KanbanImpl';

// `vi.hoisted` so the mock factory — hoisted above every import — can reach this
// box. A plain `const` would still be in its TDZ when `@dnd-kit/core` is first
// requested by `KanbanImpl`.
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const ReactMod = await import('react');
  const CapturingDndContext = (props: Record<string, unknown>) => {
    dnd.onDragEnd = props.onDragEnd as (event: unknown) => void;
    return ReactMod.createElement(actual.DndContext, props as never);
  };
  return { ...actual, DndContext: CapturingDndContext };
});

registerAllFields();

/**
 * The sentence the application author wrote for their user. Deliberately
 * unlike every generic string this surface can produce — "Save failed", "You
 * are not authorized to perform this action.", and the raw server text — so an
 * assertion on it cannot pass by accident on the pre-fix code path.
 */
const MARKED = 'Cards cannot leave Backlog until finance signs off.';

const objectDef = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: {
      type: 'picklist',
      label: 'Status',
      options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'in_progress', label: 'In Progress' },
      ],
    },
  },
};

const CARD = 'Fix the widget';

const schema = {
  type: 'object-kanban',
  objectName: 'task',
  groupBy: 'status',
  cardTitle: 'title',
  columns: [
    { id: 'backlog', title: 'Backlog' },
    { id: 'in_progress', title: 'In Progress' },
  ],
} satisfies ObjectKanbanSchema;

const serverRecords = () => [{ id: 't1', title: CARD, status: 'backlog' }];

/** 409 CONCURRENT_UPDATE as it arrives on the wire, optionally marked. */
const conflict = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('Record was modified by another user'), {
      code: 'CONCURRENT_UPDATE',
      httpStatus: 409,
      details: {
        currentVersion: '2026-05-22T07:14:00.000Z',
        ...(userMessage ? { userMessage } : {}),
      },
    }),
  );

/** 400 VALIDATION_FAILED as it arrives on the wire, optionally marked. */
const validation = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      httpStatus: 400,
      details: {
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'status', message: 'Invalid status transition' }],
        ...(userMessage ? { userMessage } : {}),
      },
    }),
  );

/**
 * 403 — returned by `normaliseClientError` untouched, so the marking sits on
 * the error itself. This is the arm the ruling was reported on, and the one
 * where the substitution is strongest: `isPermissionError` claims it, so the
 * marked text has to win ahead of the "not authorized" string.
 */
const forbidden = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('FORBIDDEN: insufficient privileges to update task t1'), {
      code: 'FORBIDDEN',
      httpStatus: 403,
      ...(userMessage ? { userMessage } : {}),
    }),
  );

function makeDataSource(rejectWith: unknown): DataSource {
  return {
    getObjectSchema: vi.fn(async () => objectDef),
    find: vi.fn(async () => ({ value: serverRecords() })),
    update: vi.fn(async () => {
      throw rejectWith;
    }),
  } as unknown as DataSource;
}

/** Mount the board and settle every async state update before the drag. */
async function mountBoard(dataSource: DataSource) {
  render(<ObjectKanban schema={schema} dataSource={dataSource} />);
  expect(await screen.findByText(CARD)).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Drop the card onto "In Progress" and return the single toast text. */
async function dropAndReadToast(): Promise<unknown> {
  expect(dnd.onDragEnd).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 't1' }, over: { id: 'in_progress' } });
  });
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  return (toast.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
}

beforeEach(() => {
  dnd.onDragEnd = undefined;
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
  // The surface logs the raw error for the console; keep the run readable.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectKanban — a marked refusal reaches the card-move toast (#5902)', () => {
  it('renders the marking on a 409 CONCURRENT_UPDATE (typed top-level member)', async () => {
    await mountBoard(makeDataSource(conflict(MARKED)));
    expect(await dropAndReadToast()).toBe(MARKED);
  });

  it('renders the marking on a 400 VALIDATION_FAILED (details bag)', async () => {
    await mountBoard(makeDataSource(validation(MARKED)));
    expect(await dropAndReadToast()).toBe(MARKED);
  });

  it('renders the marking on a 403, ahead of the "not authorized" substitution', async () => {
    // Status-agnostic by contract: a 403 is where this was reported, not a
    // fence the marking respects.
    await mountBoard(makeDataSource(forbidden(MARKED)));
    expect(await dropAndReadToast()).toBe(MARKED);
  });

  it('keeps the generic string for an UNMARKED 409', async () => {
    await mountBoard(makeDataSource(conflict()));
    const said = await dropAndReadToast();
    expect(said).not.toBe(MARKED);
    expect(said).toBe('Record was modified by another user');
  });

  it('keeps the generic string for an UNMARKED 400', async () => {
    await mountBoard(makeDataSource(validation()));
    const said = await dropAndReadToast();
    expect(said).not.toBe(MARKED);
    expect(said).toBe('Validation failed');
  });

  it('keeps the localized substitution for an UNMARKED 403', async () => {
    // objectstack#3821: an unmarked permission denial must NOT dump the server
    // text ("…insufficient privileges to update task t1") in front of the user.
    await mountBoard(makeDataSource(forbidden()));
    const said = await dropAndReadToast();
    expect(said).toBe('You are not authorized to perform this action.');
    expect(String(said)).not.toContain('insufficient privileges');
  });
});
