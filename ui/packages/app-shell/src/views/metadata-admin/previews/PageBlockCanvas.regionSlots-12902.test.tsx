// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's "Add region" writes only a name the page's template places
 * (objectui#12902).
 *
 * The spec's `checkPageRegionPlacement` judges a `kind: 'full'` page under
 * `page.template ?? 'default'` and refuses, at `os validate` and at the save
 * door, a region that template does not place. The canvas used to append
 * `region_N` whatever the template, so its own button wrote a draft the save
 * refused on every template but `dashboard`. Each pin below drives the button
 * until it has nothing left to offer and runs the spec's own check on every
 * draft it produced.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { checkPageRegionPlacement, PAGE_TEMPLATE_SLOTS } from '@objectstack/spec/ui';
import { PageBlockCanvas, regionOffer } from './PageBlockCanvas';

afterEach(cleanup);

type Region = { name: string; components: unknown[] };
type Draft = { name: string; type: string; template?: string; regions: Region[] };

/** The spec's own placement issues for a draft, as `regions[i].name` messages. */
function specIssues(draft: Draft): string[] {
  const issues: string[] = [];
  checkPageRegionPlacement(draft as never, {
    addIssue: (issue: { path?: Array<string | number>; message: string }) => {
      issues.push(`${(issue.path ?? []).join('.')}: ${issue.message}`);
    },
  } as never);
  return issues;
}

/** Renders the canvas over a draft that every patch updates, and records each draft. */
function Harness({ initial, drafts }: { initial: Draft; drafts: Draft[] }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <PageBlockCanvas
      draft={draft as never}
      onPatch={(patch) => {
        const next = { ...draft, ...(patch as Partial<Draft>) };
        drafts.push(next);
        setDraft(next);
      }}
    />
  );
}

function addRegionButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Add region/i }) as HTMLButtonElement;
}

/** The names the open "Add region" menu offers. */
function offered(): string[] {
  return Array.from(document.querySelectorAll('[data-add-region]')).map((el) => el.getAttribute('data-add-region') ?? '');
}

/** Pick the first name the open menu offers; returns that name. */
function pickFirstOffered(): string {
  const [first] = Array.from(document.querySelectorAll('[data-add-region]'));
  expect(first, 'the open menu offers a name').toBeDefined();
  const name = first.getAttribute('data-add-region') ?? '';
  fireEvent.click(first);
  return name;
}

const SLOTTED: Array<[label: string, template: string | undefined]> = [
  ['no template', undefined],
  ['default', 'default'],
  ['header-sidebar-main', 'header-sidebar-main'],
  ['three-column', 'three-column'],
];

describe('"Add region" offers only an unfilled slot of the template (objectui#12902)', () => {
  it.each(SLOTTED)('%s: every name it writes passes the spec check, until every slot is filled', (_label, template) => {
    const slots: readonly string[] = PAGE_TEMPLATE_SLOTS[(template ?? 'default') as keyof typeof PAGE_TEMPLATE_SLOTS];
    const initial: Draft = { name: 'sample_page', type: 'home', ...(template ? { template } : {}), regions: [] };
    const drafts: Draft[] = [];
    render(<Harness initial={initial} drafts={drafts} />);

    const written: string[] = [];
    for (let i = 0; i < slots.length; i += 1) {
      fireEvent.click(addRegionButton());
      // Only the slots no region fills yet are on offer.
      expect(offered()).toEqual(slots.filter((s) => !written.includes(s)));
      written.push(pickFirstOffered());
      const produced = drafts[drafts.length - 1];
      expect(produced.regions.map((r) => r.name)).toEqual(written);
      expect(specIssues(produced)).toEqual([]);
    }

    expect([...written].sort()).toEqual([...slots].sort());
    // Every slot filled: the control is disabled and says why.
    const button = addRegionButton();
    expect(button.disabled).toBe(true);
    const reason = document.querySelector('[data-add-region-reason]');
    expect(reason).not.toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe(reason!.id);
    fireEvent.click(button);
    expect(offered()).toEqual([]);
  });

  it('a page that already holds an off-slot region is offered no name colliding with a filled slot, case-insensitively', () => {
    const draft = { name: 'sample_page', type: 'home', regions: [{ name: 'MAIN', components: [] }, { name: 'aside', components: [] }] };
    expect(regionOffer(draft, draft.regions)).toEqual({
      template: 'default',
      known: true,
      slots: ['header', 'sidebar', 'footer'],
      gridCell: null,
    });
  });
});

describe('"Add region" on `dashboard` writes a grid cell name the spec accepts (objectui#12902)', () => {
  it('offers header, footer and a fresh grid cell; each name it writes passes the spec check', () => {
    const drafts: Draft[] = [];
    render(<Harness initial={{ name: 'sample_page', type: 'home', template: 'dashboard', regions: [] }} drafts={drafts} />);

    fireEvent.click(addRegionButton());
    expect(offered()).toEqual(['header', 'footer', 'region_1']);
    pickFirstOffered();
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(addRegionButton());
      pickFirstOffered();
    }
    // Header and footer are slots, filled once; then grid cells, each a fresh name.
    const last = drafts[drafts.length - 1];
    expect(last.regions.map((r) => r.name)).toEqual(['header', 'footer', 'region_3', 'region_4']);
    for (const produced of drafts) expect(specIssues(produced)).toEqual([]);

    // A grid cell is always on offer, so the control never runs out.
    expect(addRegionButton().disabled).toBe(false);
  });

  it('the grid cell name never repeats a region the page already holds', () => {
    const regions = [{ name: 'region_2', components: [] }];
    expect(regionOffer({ template: 'dashboard' }, regions).gridCell).toBe('region_3');
    expect(regionOffer({ template: 'dashboard' }, [{ name: 'region_1', components: [] }, ...regions]).gridCell).toBe('region_3');
  });
});

describe('"Add region" on a template the spec does not declare (objectui#12902)', () => {
  it('offers nothing: disabled, with a reason', () => {
    render(<Harness initial={{ name: 'sample_page', type: 'home', template: 'full-width', regions: [] }} drafts={[]} />);
    const button = addRegionButton();
    expect(button.disabled).toBe(true);
    expect(document.querySelector('[data-add-region-reason]')).not.toBeNull();
  });
});
