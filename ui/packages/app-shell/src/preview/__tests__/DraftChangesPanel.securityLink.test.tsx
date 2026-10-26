// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The security block's item name becomes a way IN — objectui#5476.
 *
 * objectui#5418 gave the pre-publish block the right words: it names the draft
 * the publish door would refuse (`object/crmext_visit`), quotes the rule's
 * fix-it hint, and says "Fix it on the object under Settings → Record
 * sharing". What it could not do was take you there.
 *
 * This suite pins both directions of that, because only one of them is new:
 *
 *  - Inside Studio a host publishes the surface channel, so the name is a
 *    control that asks for that exact object.
 *  - This sheet's OTHER home is the Home / draft-preview bar, where the Studio
 *    object editor is not a reachable destination at all. There the name stays
 *    the prose it has always been. A link that goes nowhere would be strictly
 *    worse than the sentence telling you where to go, so the degradation is
 *    asserted here rather than described in a comment.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';

// Same targeted override as the sibling security suite: `@object-ui/components`
// pulls `createSafeTranslation` from this module, so a bare object mock breaks
// at import time rather than at assert time.
vi.mock('@object-ui/i18n', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...mod,
    useObjectTranslation: () => ({
      t: (_k: string, o?: { defaultValue?: string; count?: number }) =>
        (o?.defaultValue ?? _k).replace('{{count}}', String(o?.count ?? '')),
    }),
  };
});

import { DraftChangesPanel } from '../DraftChangesPanel';
import { SurfaceDeepLinkProvider } from '../../views/studio-design/surfaceDeepLinkChannel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The card's own object: created through `新建对象`, never given an OWD. */
const OWD_LESS_VISIT = {
  name: 'crmext_visit',
  label: '客户拜访',
  fields: { name: { type: 'text', label: '名称' } },
};

function mockRoutes() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) {
      return ok([{ type: 'object', name: 'crmext_visit', packageId: 'com.test.crmext' }]);
    }
    if (url.includes('state=draft')) {
      return ok({ type: 'object', name: 'crmext_visit', item: OWD_LESS_VISIT });
    }
    if (/\/meta\/object(\?|$)/.test(url)) return ok([]);
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const panel = <DraftChangesPanel open onOpenChange={() => {}} packageId="com.test.crmext" onPublish={vi.fn()} />;

describe('DraftChangesPanel — reaching the object the publish door refuses (objectui#5476)', () => {
  it('offers the named item as a control that asks for that surface, inside Studio', async () => {
    mockRoutes();
    const onRequest = vi.fn();
    render(<SurfaceDeepLinkProvider onRequest={onRequest}>{panel}</SurfaceDeepLinkProvider>);

    const block = await screen.findByTestId('draft-security-problems');
    const link = within(block).getByRole('button', { name: 'object/crmext_visit' });
    fireEvent.click(link);

    // The surface identity, not a Studio route the sheet had to know how to build.
    expect(onRequest).toHaveBeenCalledWith({ type: 'object', name: 'crmext_visit' });
  });

  it('degrades to prose where nothing is listening — the Home / draft-preview bar', async () => {
    mockRoutes();
    render(panel);

    const block = await screen.findByTestId('draft-security-problems');
    // No control at all — not a disabled one, not a dead anchor.
    expect(within(block).queryByRole('button', { name: 'object/crmext_visit' })).toBeNull();
    expect(within(block).queryByRole('link')).toBeNull();
    // And what #5418 shipped is intact: the item is still named, and the
    // sentence still says where to fix it.
    expect(block.textContent).toContain('object/crmext_visit');
    expect(block.textContent).toMatch(/Settings → Record sharing/);
  });
});
