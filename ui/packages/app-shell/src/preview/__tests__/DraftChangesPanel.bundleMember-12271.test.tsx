/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12271 — the review sheet addresses a bundle member.
 *
 * Since objectstack#23073 each `_drafts` row of a type whose identity is a pair
 * (today only `email_template`, `(name, locale)`) carries `member`, and the
 * by-name `/meta` doors take it back as `?member=`. Two languages of one
 * template are therefore two drafts with the same `type` and `name`. The sheet
 * keyed its rows on `type:name` and read every body without a selector, so it
 * drew them as one row (twice) and read the canonical body for both.
 *
 * Pinned here, against a mocked server that answers each member's own body:
 *  - two members of one name are two rows, each showing its member;
 *  - each row's drill-in reads published and draft with its own `?member=`,
 *    and diffs its own bodies;
 *  - a member's NEW / UPDATE mark comes from its own published read, not from
 *    the name being in the published list;
 *  - an entry with no `member` sends no `?member=` at all.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import { DraftChangesPanel } from '../DraftChangesPanel';

afterEach(() => {
  vi.restoreAllMocks();
});

type Body = Record<string, unknown>;

/** Bodies keyed `type/name` or `type/name#member`; absent = 404. */
interface Fixture {
  drafts: Array<{ type: string; name: string; member?: string }>;
  publishedNames: Record<string, string[]>;
  published: Record<string, Body>;
  draft: Record<string, Body>;
}

function mockServer(fx: Fixture): string[] {
  const urls: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const missing = { ok: false, status: 404, json: async () => ({}) };
    if (url.includes('/_drafts')) {
      return ok({
        drafts: fx.drafts.map((d) => ({
          ...d,
          label: null,
          packageId: 'com.x',
          updatedAt: null,
          updatedBy: null,
        })),
      });
    }
    const [path, query = ''] = url.split('?');
    const [type, name] = path.replace('/api/v1/meta/', '').split('/');
    if (!name) return ok((fx.publishedNames[type] ?? []).map((n) => ({ name: n })));
    const member = new URLSearchParams(query).get('member');
    const key = member === null ? `${type}/${name}` : `${type}/${name}#${member}`;
    if (query.includes('state=draft')) {
      return fx.draft[key] ? ok({ type, name, item: fx.draft[key] }) : missing;
    }
    return fx.published[key] ? ok(fx.published[key]) : missing;
  }) as unknown as typeof fetch;
  return urls;
}

function renderPanel() {
  return render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" onPublish={vi.fn()} />);
}

/** The row toggle whose member cell reads `member`. */
function memberRow(member: string): HTMLElement {
  const hit = screen
    .getAllByTestId('draft-entry-toggle')
    .find((el) => el.querySelector('[data-testid="draft-entry-member"]')?.textContent === member);
  if (!hit) throw new Error(`no row for member ${member}`);
  return hit;
}

const fixture: Fixture = {
  drafts: [
    { type: 'email_template', name: 'welcome', member: 'en-US' },
    { type: 'email_template', name: 'welcome', member: 'zh-CN' },
    { type: 'object', name: 'visit' },
  ],
  // The NAME is published (its en-US member is); the zh-CN member is not.
  publishedNames: { email_template: ['welcome'], object: ['visit'] },
  published: {
    'email_template/welcome#en-US': { name: 'welcome', subject: 'Welcome' },
    'object/visit': { name: 'visit', label: 'Visit' },
  },
  draft: {
    'email_template/welcome#en-US': { name: 'welcome', subject: 'Welcome aboard' },
    'email_template/welcome#zh-CN': { name: 'welcome', subject: '欢迎', body: '你好' },
    'object/visit': { name: 'visit', label: 'Customer Visit' },
  },
};

describe('two members of one email_template are two rows (objectui#12271)', () => {
  it('lists each member as its own row, showing its member', async () => {
    mockServer(fixture);
    renderPanel();

    await waitFor(() => expect(screen.getAllByTestId('draft-entry-toggle')).toHaveLength(3));
    expect(screen.getAllByTestId('draft-entry-member').map((el) => el.textContent)).toEqual([
      'en-US',
      'zh-CN',
    ]);
  });

  it("classifies each member by its own published read, not by the name list", async () => {
    const urls = mockServer(fixture);
    renderPanel();

    await waitFor(() => expect(within(memberRow('zh-CN')).getByText('New')).toBeInTheDocument());
    expect(within(memberRow('en-US')).getByText('Update')).toBeInTheDocument();
    expect(urls).toContain('/api/v1/meta/email_template/welcome?package=com.x&member=zh-CN');
    expect(urls).toContain('/api/v1/meta/email_template/welcome?package=com.x&member=en-US');
  });

  it("expanding a member reads and diffs that member's own bodies", async () => {
    const urls = mockServer(fixture);
    renderPanel();

    await waitFor(() => expect(screen.getAllByTestId('draft-entry-toggle')).toHaveLength(3));
    fireEvent.click(memberRow('zh-CN'));

    await waitFor(() => expect(screen.getByTestId('draft-entry-detail')).toBeInTheDocument());
    const detail = screen.getByTestId('draft-entry-detail');
    // zh-CN is new: its draft adds `body` and `subject` against no published body.
    expect(detail).toHaveTextContent('+ body');
    expect(detail).toHaveTextContent('+ subject');
    expect(urls).toContain('/api/v1/meta/email_template/welcome?state=draft&package=com.x&member=zh-CN');
    // The canonical body was never read for this row.
    expect(urls).not.toContain('/api/v1/meta/email_template/welcome?state=draft&package=com.x');
    // Only the expanded row opened: the en-US row stays collapsed.
    expect(memberRow('en-US')).toHaveAttribute('aria-expanded', 'false');
    expect(memberRow('zh-CN')).toHaveAttribute('aria-expanded', 'true');
  });

  it('expanding the other member reads its own selector and changes its own key', async () => {
    const urls = mockServer(fixture);
    renderPanel();

    await waitFor(() => expect(screen.getAllByTestId('draft-entry-toggle')).toHaveLength(3));
    fireEvent.click(memberRow('en-US'));

    await waitFor(() => expect(screen.getByTestId('draft-entry-detail')).toBeInTheDocument());
    expect(screen.getByTestId('draft-entry-detail')).toHaveTextContent('~ subject');
    expect(screen.getByTestId('draft-entry-detail')).not.toHaveTextContent('body');
    expect(urls).toContain('/api/v1/meta/email_template/welcome?state=draft&package=com.x&member=en-US');
  });
});

describe('an entry without member sends no selector (objectui#12271)', () => {
  it('reads a name-only draft exactly as before', async () => {
    const urls = mockServer(fixture);
    renderPanel();

    await waitFor(() => expect(screen.getAllByTestId('draft-entry-toggle')).toHaveLength(3));
    const visit = screen
      .getAllByTestId('draft-entry-toggle')
      .find((el) => el.querySelector('.font-mono')?.textContent === 'visit')!;
    expect(visit.querySelector('[data-testid="draft-entry-member"]')).toBeNull();
    fireEvent.click(visit);

    await waitFor(() => expect(screen.getByTestId('draft-entry-detail')).toBeInTheDocument());
    const objectReads = urls.filter((u) => u.startsWith('/api/v1/meta/object'));
    expect(objectReads).toEqual(
      expect.arrayContaining([
        '/api/v1/meta/object',
        '/api/v1/meta/object/visit?package=com.x',
        '/api/v1/meta/object/visit?state=draft&package=com.x',
      ]),
    );
    expect(objectReads.some((u) => u.includes('member='))).toBe(false);
  });
});
