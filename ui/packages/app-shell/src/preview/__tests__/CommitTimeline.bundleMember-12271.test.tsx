/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12271 — the build history shows the bundle member of each touched
 * item that carries one (objectstack#23073, `ListPackageCommitsResponseSchema`
 * `commits[].items[].member`), so a commit that touched two languages of one
 * `email_template` names both. A commit whose items carry no member renders
 * exactly as before: nothing extra.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import { CommitTimeline } from '../CommitTimeline';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockCommits(commits: unknown[]) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ commits }),
  })) as unknown as typeof fetch;
}

const item = (type: string, name: string, member?: string) => ({
  type,
  name,
  ...(member ? { member } : {}),
  existedBefore: true,
  prevVersion: 1,
});

describe('CommitTimeline shows the member where an item carries one (objectui#12271)', () => {
  it('names each member of a commit that touched two languages of one template', async () => {
    mockCommits([
      {
        id: 'c1',
        operation: 'apply',
        itemCount: 3,
        items: [
          item('email_template', 'welcome', 'en-US'),
          item('email_template', 'welcome', 'zh-CN'),
          item('object', 'visit'),
        ],
      },
    ]);
    render(<CommitTimeline open onOpenChange={() => {}} packageId="com.x" />);

    const list = await screen.findByTestId('commit-member-items');
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'email_template/welcome · en-US',
      'email_template/welcome · zh-CN',
    ]);
  });

  it('adds nothing for a commit whose items carry no member', async () => {
    mockCommits([
      { id: 'c2', operation: 'apply', itemCount: 1, items: [item('object', 'visit')] },
    ]);
    render(<CommitTimeline open onOpenChange={() => {}} packageId="com.x" />);

    await screen.findByTestId('commit-row');
    expect(screen.queryByTestId('commit-member-items')).toBeNull();
  });
});
