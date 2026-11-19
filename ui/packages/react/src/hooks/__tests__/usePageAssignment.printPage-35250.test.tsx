/**
 * ObjectUI — usePageAssignment: a print page never wins the declaration-order fallback
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#35250. A page that declares `print` (`PageSchema.print`) is a
 * PRINT PAGE: a document authored in the page's own printable blocks, drawn
 * with no stage path, no tabs, no related lists and no edit flow. When an
 * object had no `isDefault` record page, the record route took the FIRST
 * record page of the object in declaration order, so an app that authored
 * only a print page for an object (a quote, a contract) opened every record
 * as that printed document instead of the synthesized record page.
 *
 * The declaration-order fallback now skips print pages: with no default and
 * no app-scoped page, the first record page that does not declare `print`
 * opens, and with none the hook answers null so the record route draws the
 * synthesized default page.
 *
 * Unchanged, and pinned here as controls:
 *  - a print page still opens on the named record page route, which asks for
 *    it by name (`pageName`) and accepts it through `isRecordPageOf`;
 *  - a non-default record page that does not print still wins when it is the
 *    only candidate, and the `isDefault` record page still wins over both;
 *  - a print page the author DECLARES as the default (`isDefault: true`) or
 *    scopes to an app (`apps`) still opens there: those slots are the spec's
 *    one reading (`defaultRecordPageObject`), and this hook honours what the
 *    platform judges to be the default with no reading of its own.
 *
 * Every fixture is parsed by `PageSchema` first, so no pin rests on a page an
 * author could not write.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { MetadataCtx } from '../../context/AppShellContext';
import { usePageAssignment, isRecordPageOf, type PageAssignmentOptions } from '../usePageAssignment';

/** A metadata context carrying exactly the `pages` list under test. */
function wrapperFor(pages: any[]) {
  const ctx: any = {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [],
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider>;
  };
}

async function assign(pages: any[], objectName: string, opts: PageAssignmentOptions = {}) {
  const { result } = renderHook(() => usePageAssignment(objectName, opts), {
    wrapper: wrapperFor(pages),
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

const OBJECT = 'crm_quote';

/** An authored `full` record page of `object` that does not print. */
const recordPage = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  type: 'record',
  object: OBJECT,
  regions: [{ name: 'main', components: [{ type: 'record:details' }] }],
  ...extra,
});

/** A print page of `object`: a `full` record page that declares `print`. */
const printPage = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  type: 'record',
  object: OBJECT,
  regions: [
    { name: 'header', components: [{ type: 'element:text', properties: { content: 'Quote' } }] },
    { name: 'main', components: [{ type: 'record:details' }, { type: 'record:line_items' }] },
  ],
  print: { paperSize: 'A4', repeatHeader: true },
  ...extra,
});

describe('fixtures are pages an author can write', () => {
  it('every fixture parses through PageSchema', () => {
    for (const page of [
      recordPage('quote_detail'),
      recordPage('quote_detail_default', { isDefault: true }),
      printPage('quote_print_page'),
      printPage('quote_print_default', { isDefault: true }),
      printPage('quote_print_scoped', { apps: ['sales'] }),
    ]) {
      const parsed = PageSchema.safeParse(page);
      expect(parsed.success, `${page.name}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
    }
  });
});

describe('usePageAssignment — a print page is not a fallback record page (objectstack#35250)', () => {
  it('an object whose only page is a print page resolves to null, so the record route draws the synthesized default', async () => {
    const result = await assign([printPage('quote_print_page')], OBJECT);
    expect(result.current.page).toBeNull();
    expect(result.current.slots).toBeNull();
  });

  it('a print page declared first does not shadow a later record page that does not print', async () => {
    const result = await assign([printPage('quote_print_page'), recordPage('quote_detail')], OBJECT);
    expect(result.current.page?.name).toBe('quote_detail');
  });

  it('the fallback keeps declaration order among the pages that do not print', async () => {
    const result = await assign(
      [printPage('quote_print_page'), recordPage('first_detail'), recordPage('second_detail')],
      OBJECT,
    );
    expect(result.current.page?.name).toBe('first_detail');
  });

  it('an app named on the route with no page scoped to it still skips the print page', async () => {
    const result = await assign([printPage('quote_print_page')], OBJECT, { app: 'sales' });
    expect(result.current.page).toBeNull();
    expect(result.current.slots).toBeNull();
  });
});

describe('controls — what the fallback change leaves as it was', () => {
  it('a non-default record page that does not print still wins when it is the only candidate', async () => {
    const result = await assign([recordPage('quote_detail')], OBJECT);
    expect(result.current.page?.name).toBe('quote_detail');
  });

  it('the isDefault record page wins over a print page declared before it', async () => {
    const result = await assign(
      [printPage('quote_print_page'), recordPage('quote_detail'), recordPage('quote_detail_default', { isDefault: true })],
      OBJECT,
    );
    expect(result.current.page?.name).toBe('quote_detail_default');
  });

  it('the named record page route still opens the print page: `pageName` returns it and `isRecordPageOf` accepts it', async () => {
    const pages = [recordPage('quote_detail'), printPage('quote_print_page')];
    const result = await assign(pages, OBJECT, { pageName: 'quote_print_page' });
    expect(result.current.page?.name).toBe('quote_print_page');
    expect(result.current.page?.print).toEqual({ paperSize: 'A4', repeatHeader: true });
    expect(isRecordPageOf(result.current.page, OBJECT)).toBe(true);
  });

  it('a print page the author declares as the default record page still opens: the declared default is honoured as the spec reads it', async () => {
    const result = await assign(
      [recordPage('quote_detail'), printPage('quote_print_default', { isDefault: true })],
      OBJECT,
    );
    expect(result.current.page?.name).toBe('quote_print_default');
  });

  it('a print page scoped to the app the record opens in still opens inside that app', async () => {
    const pages = [recordPage('quote_detail'), printPage('quote_print_scoped', { apps: ['sales'] })];
    expect((await assign(pages, OBJECT, { app: 'sales' })).current.page?.name).toBe('quote_print_scoped');
    // Outside that app the scope decides nothing and the print page is skipped.
    expect((await assign(pages, OBJECT)).current.page?.name).toBe('quote_detail');
  });
});
