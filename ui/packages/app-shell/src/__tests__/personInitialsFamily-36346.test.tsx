/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36346 — every face that draws a person's initials draws them
 * letters-only, by the one `getPersonInitials` rule: a display name such as
 * "Alice (Sales)" gives "AS" on each of them, never "A(".
 *
 * ## Why this file lives in `app-shell`
 *
 * The faces sit in four packages — the kanban card owner in `plugin-kanban`,
 * the history timeline in `plugin-detail`, the user menu's `getUserInitials`
 * in `auth` and the presence stack in `collaboration` — and none depends on all
 * the others. `app-shell` depends on all four, so the REAL faces are mounted
 * here side by side with no new dependency edge. The rule's own cases (CJK,
 * single words, no letter at all) are pinned beside it in `@object-ui/fields`.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanban } from '@object-ui/plugin-kanban';
import { HistoryTimeline } from '@object-ui/plugin-detail';
import { getUserInitials } from '@object-ui/auth';
import { PresenceAvatars } from '@object-ui/collaboration';
// Loads the board's lazy chunk at module scope (AGENTS.md, test discipline).
import '../../../plugin-kanban/src/KanbanImpl';

const NAME = 'Alice (Sales)';
const INITIALS = 'AS';

afterEach(cleanup);

describe('every initials face draws letters only for "Alice (Sales)" (objectstack#36346)', () => {
  it('the kanban card owner', async () => {
    const def = {
      name: 'deal',
      label: 'Deal',
      fields: {
        name: { type: 'text', label: 'Name' },
        stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
        owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
      },
    };
    const store = new ValueDataSource<Record<string, unknown>>({
      items: [{ id: 'd1', name: 'Deal one', stage: 'open', owner_id: { id: 'u1', name: NAME } }],
    });
    const adapter = {
      find: vi.fn(async (object: string, params: any) => store.find(object, params)),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => def),
    } as any;
    render(
      <SchemaRendererProvider dataSource={adapter}>
        <ObjectKanban
          schema={{ type: 'object-kanban', objectName: 'deal', groupBy: 'stage' } as any}
          dataSource={adapter}
          ownerField="owner_id"
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(document.querySelector('[data-kanban-card-owner]')).not.toBeNull());
    const avatar = document.querySelector('[data-kanban-card-owner]') as HTMLElement;
    expect(avatar).toHaveAttribute('aria-label', NAME);
    expect(avatar).toHaveTextContent(INITIALS);
  });

  it('the history timeline', () => {
    render(
      <HistoryTimeline
        entries={[{ id: 'h1', action: 'update', user_id: 'u1', user_name: NAME, created_at: '2026-01-01T00:00:00Z' }]}
      />,
    );
    expect(screen.getByText(INITIALS)).toBeInTheDocument();
  });

  it('the user menu (`getUserInitials`, drawn by UserMenu, AccountMenu and the profile page)', () => {
    expect(getUserInitials({ name: NAME, email: 'alice@example.com' })).toBe(INITIALS);
  });

  it('the presence stack', () => {
    const { container } = render(
      <PresenceAvatars
        users={[{ userId: 'u1', userName: NAME, color: '#000', status: 'active', lastActivity: '2026-01-01T00:00:00Z' }]}
      />,
    );
    expect(within(container).getByText(INITIALS)).toBeInTheDocument();
  });
});
