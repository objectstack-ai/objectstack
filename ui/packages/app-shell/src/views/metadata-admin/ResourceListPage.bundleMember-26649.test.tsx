// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26649 — Setup's metadata list tells two members of one name
 * apart, and each row opens its OWN member.
 *
 * Measured on the card: a template carried in two locales listed as two rows
 * that both linked to `…/email_template/NAME?scope=environment`, so both opened
 * the same member and the other language could not be opened from Setup. The
 * list read serves each member as its own row with the body's `locale`; the
 * type declares that field as its bundle member (`bundleMemberField`,
 * `default-schemas.ts`), because the server serves no member key.
 *
 * What is pinned, each against a control:
 *
 *  - two members of one name are two rows whose links differ by `?member=`,
 *    and the scope the link already carried is kept;
 *  - the member shows in its own column, labelled through the default-column
 *    vocabulary;
 *  - a row that declares no member (the canonical one) links by its name alone;
 *  - CONTROL: a type with no members gets no column and no `?member=`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter } from 'react-router-dom';

const TEMPLATES: Record<string, unknown>[] = [
  { name: 'duly.task_overdue', label: 'Task overdue escalation — owner', locale: 'en', subject: 'Overdue' },
  { name: 'duly.task_overdue', label: '任务逾期升级提醒 — 负责人', locale: 'zh-CN', subject: '逾期' },
  { name: 'auth.welcome', label: 'Welcome', subject: 'Hi' },
];
const PAGES: Record<string, unknown>[] = [{ name: 'home_page', label: 'Home', locale: 'en' }];

/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) => (type === 'email_template' ? TEMPLATES : type === 'page' ? PAGES : []),
};

const ENTRIES = [
  { type: 'email_template', label: 'Email Template', allowEnvironmentOverlay: true, allowRuntimeCreate: true },
  { type: 'page', label: 'Page', allowEnvironmentOverlay: true, allowRuntimeCreate: true },
];

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

vi.mock('../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => true,
}));

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { t } from './i18n';

registerDefaultMetadataSchemas();

afterEach(() => {
  cleanup();
});

function mount(type: string, search: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}${search}`]}>
      <MetadataResourceListPage type={type} />
    </MemoryRouter>,
  );
}

/** Every row link's href, in row order, for items named `name`. */
async function hrefsOf(name: string): Promise<string[]> {
  const rows = await screen.findAllByTestId(`metadata-row-${name}`);
  return rows.map((row) => within(row).getByRole('link').getAttribute('href') ?? '');
}

function queryOf(href: string): URLSearchParams {
  const q = href.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : href.slice(q + 1));
}

describe('Setup list: each bundle member opens itself (objectstack#26649)', () => {
  it('two members of one template are two rows whose links differ by ?member=, keeping the scope', async () => {
    mount('email_template', '?scope=environment');
    const hrefs = await hrefsOf('duly.task_overdue');

    expect(hrefs).toHaveLength(2);
    expect(hrefs.map((h) => queryOf(h).get('member'))).toEqual(['en', 'zh-CN']);
    for (const href of hrefs) {
      expect(href).toMatch(/\/duly\.task_overdue\?/);
      expect(queryOf(href).get('scope')).toBe('environment');
    }
    expect(new Set(hrefs).size).toBe(2);
  });

  it('a member that declares no locale (the canonical one) links by its name alone', async () => {
    mount('email_template', '?scope=environment');
    const [href] = await hrefsOf('auth.welcome');

    expect(queryOf(href!).has('member')).toBe(false);
    expect(queryOf(href!).get('scope')).toBe('environment');
  });

  it('the member shows in its own column, second, labelled Locale', async () => {
    mount('email_template', '?scope=environment');
    await hrefsOf('duly.task_overdue');

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers[1]).toBe(t('engine.list.col.locale', 'en-US'));
    expect(t('engine.list.col.locale', 'en-US')).toBe('Locale');
    const [enRow, zhRow] = screen.getAllByTestId('metadata-row-duly.task_overdue');
    expect(within(enRow!).getAllByRole('cell')[1]).toHaveTextContent('en');
    expect(within(zhRow!).getAllByRole('cell')[1]).toHaveTextContent('zh-CN');
  });

  it('CONTROL: a type with no members gets no Locale column and no ?member=, whatever its body carries', async () => {
    mount('page', '?scope=environment');
    const [href] = await hrefsOf('home_page');

    expect(queryOf(href!).has('member')).toBe(false);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).not.toContain(t('engine.list.col.locale', 'en-US'));
  });
});
