// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pending-changes sheet reports what the publish door would refuse —
 * objectui#5418.
 *
 * The card's walk ended at 发布 → 全部发布 with `security-owd-unset`, delivered
 * as a wall of English ADR prose in a toast that then vanished on a timer. The
 * finding is correct; the moment was not. This suite pins that the SAME rule is
 * now answered one click earlier, in the sheet the author is already reading,
 * and — just as importantly — that it stays silent for a package that is fine
 * and never takes the Publish button away.
 *
 * Driven through the real panel and the real `@objectstack/lint`: a mocked rule
 * here would pin the wiring and prove nothing about whether the console and the
 * door agree, which is the whole claim.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Spread the real module and override only the hook: `@object-ui/components`
// pulls its own `createSafeTranslation` from here for the Dialog close label,
// so a bare object mock breaks at import time rather than at assert time.
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

afterEach(() => {
  vi.restoreAllMocks();
});

/** The card's own object: created through `新建对象`, never given an OWD. */
const OWD_LESS_VISIT = {
  name: 'crmext_visit',
  label: '客户拜访',
  fields: { name: { type: 'text', label: '名称' }, visit_date: { type: 'date', label: '拜访日期' } },
};

function mockRoutes(draftBody: Record<string, unknown>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) {
      return ok([{ type: 'object', name: 'crmext_visit', packageId: 'com.test.crmext' }]);
    }
    if (url.includes('state=draft')) {
      return ok({ type: 'object', name: 'crmext_visit', item: draftBody });
    }
    if (/\/meta\/object(\?|$)/.test(url)) return ok([]); // nothing published yet — a NEW item
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const renderPanel = (extra = {}) =>
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.test.crmext" {...extra} />);

describe('DraftChangesPanel — pre-publish security posture (objectui#5418)', () => {
  it('names the object whose sharing baseline was never authored', async () => {
    mockRoutes(OWD_LESS_VISIT);
    renderPanel({ onPublish: vi.fn() });
    const block = await screen.findByTestId('draft-security-problems');
    // The item, addressed the way the server's own refusal addresses it.
    expect(block.textContent).toContain('object/crmext_visit');
    // The rule's fix-it HINT, not the ADR paragraph: the actionable half.
    expect(block.textContent).toMatch(/sharingModel/);
    // And where to go, which the toast never said.
    expect(block.textContent).toMatch(/Settings → Record sharing/);
  });

  it('reports without blocking — the server door stays the authority', async () => {
    mockRoutes(OWD_LESS_VISIT);
    const onPublish = vi.fn();
    renderPanel({ onPublish });
    await screen.findByTestId('draft-security-problems');
    // A console that refuses a publish the server would have accepted is the
    // worse failure: it has no override.
    expect(screen.getByTestId('draft-changes-publish')).not.toBeDisabled();
  });

  it('says nothing once the baseline is authored — the shape the create dialog now produces', async () => {
    mockRoutes({ ...OWD_LESS_VISIT, sharingModel: 'private' });
    renderPanel({ onPublish: vi.fn() });
    // Wait on the sheet settling (the entry lands), then assert the absence —
    // a bare `queryBy` would pass before the async lint had a chance to speak.
    await waitFor(() => expect(screen.getByTestId('draft-changes-publish')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByTestId('draft-security-problems')).not.toBeInTheDocument();
  });
});
