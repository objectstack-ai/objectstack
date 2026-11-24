/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35418 — a row no person took reads as the platform's, not as
 * a comment by "—".
 *
 * The server records no actor on the rows the platform writes (ADR-0118 D1):
 * the note on why a request went to the organization's administrators, the
 * submitter-exclusion and no-approver notes, an auto-cancel. The timeline
 * drew the first three as "Commented · —". Now the actor reads "System", and
 * a `comment` row with no actor reads "System note". A person's comment, with
 * its author, keeps "Commented" (the live control in the same DOM).
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { ApprovalActionLite } from '../../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { ApprovalActionTimeline } from './ApprovalActionTimeline';
import { isSystemNote } from '../../utils/approvalSystemNote';

afterEach(cleanup);

const ACTIONS: ApprovalActionLite[] = [
  { id: 'a1', request_id: 'r1', action: 'submit', actor_id: 'u_amy', actor_name: 'Amy', created_at: '2026-11-19T08:00:00Z' },
  {
    id: 'a2', request_id: 'r1', action: 'comment', actor_id: null,
    comment: '审批人名单未指向任何人，因此已转交本组织管理员处理：岗位「销售经理」无人任职。',
    created_at: '2026-11-19T08:00:00Z',
  },
  { id: 'a3', request_id: 'r1', action: 'comment', actor_id: 'u_bob', actor_name: 'Bob', comment: 'Looks fine', created_at: '2026-11-19T09:00:00Z' },
  { id: 'a4', request_id: 'r1', action: 'cancel', actor_id: null, created_at: '2026-11-19T10:00:00Z' },
];

function renderIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <ApprovalActionTimeline actions={ACTIONS} />
    </I18nProvider>,
  );
}

/** The heading line of row `index`, as one string. */
function line(index: number): string {
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(ACTIONS.length);
  return (rows[index].querySelector('div')?.textContent ?? '').replace(/\s+/g, ' ');
}

describe('objectstack#35418 — the platform\'s rows on the approval timeline', () => {
  it('a comment row with no actor is a system note; a person\'s comment stays a comment', () => {
    expect(isSystemNote({ action: 'comment', actor_id: null })).toBe(true);
    expect(isSystemNote({ action: 'comment', actor_id: undefined })).toBe(true);
    expect(isSystemNote({ action: 'comment', actor_id: 'u_bob' })).toBe(false);
    expect(isSystemNote({ action: 'cancel', actor_id: null })).toBe(false);
  });

  it('English: "System note · System", and a person\'s comment keeps "Commented · Bob"', () => {
    renderIn('en');
    expect(line(1)).toContain('System note');
    expect(line(1)).toContain('System');
    expect(line(1)).not.toContain('Commented');
    expect(line(1)).not.toContain('—');
    expect(line(2)).toContain('Commented');
    expect(line(2)).toContain('Bob');
    // Any row no person took names the system as its actor, not "—".
    expect(line(3)).toContain('System');
    expect(line(3)).not.toContain('—');
  });

  it('zh-CN: 「系统说明 · 系统」，不写「评论」；本人评论仍是「评论 · Bob」', () => {
    renderIn('zh');
    expect(line(1)).toContain('系统说明');
    expect(line(1)).toContain('系统');
    expect(line(1)).not.toContain('评论');
    expect(line(2)).toContain('评论');
    expect(line(2)).toContain('Bob');
  });
});
