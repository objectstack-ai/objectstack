// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11173 — the `page:header` panel on screen after the designer's
 * `breadcrumb` toggle left `BLOCK_CONFIG['page:header']`.
 *
 * The sibling `previews/__tests__/block-config.test.ts` pins the TABLE (the
 * curated field set is `title` / `subtitle`). This file pins the two facts only
 * a real render and a real commit can answer:
 *
 *   - the panel offers no breadcrumb control, in either locale;
 *   - a page that ALREADY carries `breadcrumb` (a released designer build wrote
 *     it) opens, and its next save keeps the key. That is the triage ruling on
 *     the card: no strip in the designer. objectstack#20758's ADR-0087
 *     conversion is the one strip, on load, with its notice; a second strip
 *     here would be a second mechanism and would hide that notice. So
 *     `RETIRED_BLOCK_PROP_KEYS` has no `page:header` entry, and the round-trip
 *     case below is the control that goes red if one is added.
 *
 * FIXTURE DISCIPLINE (#3216's method, as in the sibling suites): the page is
 * authored the way a user does and fed through `PageSchema.parse`, so the
 * fixture cannot drift from the spec. `PageSchema` does not judge a block's
 * `properties` (the sibling `PageBlockInspector.retiredBlockProps.test.tsx`
 * header records that measurement), so the stored fixture keeps parsing when a
 * later spec pin tombstones the key.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';

// objectui#4697 — see PageBlockInspector.i18n.test.tsx for the full mechanism;
// same STABLE stub, short-circuiting useObjectFields/useObjectOptions's
// mount-time fetch instead of letting it escape to the real network. No
// assertion here reads the fetched object list or its fields.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(cleanup);

const BLOCK_PATH = 'regions[0].components[0]';

/** A record page carrying one `page:header` block with the given properties. */
function pageDraft(properties: Record<string, unknown>): Record<string, unknown> {
  return PageSchema.parse({
    name: 'account_record',
    label: 'Account',
    type: 'record',
    object: 'account',
    template: 'default',
    regions: [{ name: 'main', components: [{ type: 'page:header', id: 'b1', properties }] }],
  }) as unknown as Record<string, unknown>;
}

function renderInspector(
  draft: Record<string, unknown>,
  locale: 'en-US' | 'zh-CN',
  onPatch = vi.fn(),
) {
  render(
    <PageBlockInspector
      type="page"
      name="account_record"
      draft={draft}
      selection={{ kind: 'block', id: BLOCK_PATH }}
      onPatch={onPatch}
      onClearSelection={() => {}}
      readOnly={false}
      locale={locale as never}
    />,
  );
  return onPatch;
}

/** The block's `properties` as the inspector last committed them. */
function committedProps(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const patch = onPatch.mock.calls.at(-1)![0] as {
    regions: Array<{ components: Array<{ properties: Record<string, unknown> }> }>;
  };
  return patch.regions[0].components[0].properties;
}

const LABELS = {
  'en-US': { title: 'Title', subtitle: 'Subtitle' },
  'zh-CN': { title: '标题', subtitle: '副标题' },
} as const;

describe('page:header inspector · no breadcrumb toggle (objectui#11173)', () => {
  it.each(['en-US', 'zh-CN'] as const)('%s: offers title and subtitle, and no toggle at all', (locale) => {
    renderInspector(pageDraft({}), locale);
    // Non-vacuity: the curated section IS rendering, so the zeroes below are a
    // reading about the toggle rather than about an empty panel.
    expect(screen.getByLabelText(LABELS[locale].title)).toBeTruthy();
    expect(screen.getByLabelText(LABELS[locale].subtitle)).toBeTruthy();
    // The toggle was the header's only boolean control, so no checkbox is left.
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    // Neither label spelling, and no raw key standing in for a missing one.
    expect(screen.queryByText('Show breadcrumb')).toBeNull();
    expect(screen.queryByText('显示面包屑')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('engine.inspector.pageBlock.');
  });
});

describe('page:header inspector · a stored `breadcrumb` round-trips (objectui#11173)', () => {
  /** A block saved by a released build, while the toggle was still offered. */
  const stored = () => pageDraft({ title: 'Account', breadcrumb: true });

  it('opens: the stored key stays visible, in Advanced under its raw name', () => {
    renderInspector(stored(), 'en-US');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Account');
    // No longer curated, so the generic editor shows it; it was not dropped on
    // read, which is what a strip would have done.
    const box = screen.getByLabelText('breadcrumb') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
  });

  it('saves: an edit to another field keeps `breadcrumb` in the committed document', () => {
    const onPatch = renderInspector(stored(), 'en-US');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Customer' } });
    // Everything the block carried rides out; only the edited field moved.
    expect(committedProps(onPatch)).toEqual({ title: 'Customer', breadcrumb: true });
  });
});
