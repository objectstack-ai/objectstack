// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the `type: 'page'` view → page reference rule (#13216).
 *
 * Three of these carry the rule's reason for existing:
 *
 * 1. The **empty-collection** case — the same hole its nav twin was written
 *    for. `defineStack`'s cross-reference check is gated on
 *    `pageNames.size > 0`, so a stack that declares no `pages` has its
 *    view→page validation switched off, and that is exactly the state a stack
 *    is in when the target was never written. "Optimise" this rule by skipping
 *    page-less stacks and this test goes red.
 * 2. The **flattened-overlay rung**. `runtimeTypes: ['flow','view']` on the
 *    suite member is necessary and NOT sufficient (#9313's measured lesson):
 *    the shape `PUT /api/v1/meta/view` carries is a list view at the TOP level
 *    of a `views[]` entry, not under `list` / `listViews`. A walk that reads
 *    only the container rungs would make the crossing a silent no-op that
 *    reads as coverage.
 * 3. The **object rung** (`objects[].listViews.*`), which is where an object's
 *    built-in views are authored and where a page tab is most likely written.
 */

import { describe, expect, it } from 'vitest';

import { validateViewPageRefs, VIEW_PAGE_UNRESOLVED } from './validate-view-page-refs.js';

const mount = (pageName: string) => ({ type: 'page', pageName, columns: [] });

describe('validateViewPageRefs — the gap defineStack leaves', () => {
  it('flags a mount when the stack declares NO pages (the size>0 hole)', () => {
    const findings = validateViewPageRefs({
      views: [{ name: 'crm_lead', list: mount('missing_page') }],
    });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(VIEW_PAGE_UNRESOLVED);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('views[0].list.pageName');
    expect(f.where).toBe('view "crm_lead" › list');
    // The message must say WHY nothing else caught it, or the author has no way
    // to know this rule is the only thing speaking.
    expect(f.message).toContain('NO pages at all');
    expect(f.message).toContain('size > 0');
  });

  it('flags a mount when pages exist but the name is wrong', () => {
    const findings = validateViewPageRefs({
      views: [{ name: 'crm_lead', list: mount('typo') }],
      pages: [{ name: 'sales_dashboard' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).not.toContain('NO pages at all');
    expect(findings[0].message).toContain("mounts page 'typo'");
  });

  it('is silent when the mount resolves', () => {
    expect(validateViewPageRefs({
      views: [{ name: 'crm_lead', list: mount('sales_dashboard') }],
      pages: [{ name: 'sales_dashboard' }],
    })).toEqual([]);
  });

  it('is silent on every view type that is not a page mount', () => {
    expect(validateViewPageRefs({
      views: [{ name: 'crm_lead', list: { type: 'grid', columns: ['name'] } }],
      pages: [],
    })).toEqual([]);
  });

  it('accepts a name-keyed `pages` map as well as an array', () => {
    expect(validateViewPageRefs({
      views: [{ name: 'crm_lead', list: mount('sales_dashboard') }],
      pages: { sales_dashboard: { label: 'Sales' } },
    })).toEqual([]);
  });
});

describe('validateViewPageRefs — every rung a page mount can be authored on', () => {
  // The runtime write door's own shape: a list view at the TOP level of a
  // `views[]` entry (`viewKind: 'list'`, no nested `config`) — the shape the
  // runtime publish gate snapshots as `views: [item]`. Without this rung the
  // suite member's `view` crossing reports nothing at all.
  it('walks the FLATTENED list overlay (PUT /api/v1/meta/view)', () => {
    const findings = validateViewPageRefs({
      views: [{
        name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list', ...mount('missing_page'),
      }],
      pages: [{ name: 'sales_dashboard' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].pageName');
    expect(findings[0].where).toContain('flattened list overlay');
  });

  it('walks the standalone ViewItem RECORD (config one level down)', () => {
    const findings = validateViewPageRefs({
      views: [{
        name: 'crm_lead.dash', object: 'crm_lead', viewKind: 'list', config: mount('missing_page'),
      }],
      pages: [{ name: 'sales_dashboard' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].config.pageName');
    expect(findings[0].where).toContain('ViewItem record');
  });

  it('walks `objects[].listViews.<key>` — the object\'s built-in views', () => {
    const findings = validateViewPageRefs({
      objects: [{ name: 'crm_lead', listViews: { dash: mount('missing_page') } }],
      pages: [{ name: 'sales_dashboard' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].listViews.dash.pageName');
    expect(findings[0].where).toBe('object "crm_lead" › listViews.dash');
  });

  it('walks `views[].listViews.<key>` — a defineView aggregate\'s named views', () => {
    const findings = validateViewPageRefs({
      views: [{ name: 'crm_lead', listViews: { dash: mount('missing_page') } }],
      pages: [{ name: 'sales_dashboard' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].listViews.dash.pageName');
  });

  // A record body carries `config`; the overlay body does not. The two rungs
  // must not both fire on one entry — that would double-report one mount.
  it('reports a ViewItem record exactly once, not once per rung', () => {
    const findings = validateViewPageRefs({
      views: [{ name: 'v', object: 'crm_lead', viewKind: 'list', config: mount('missing_page') }],
      pages: [{ name: 'other' }],
    });
    expect(findings).toHaveLength(1);
  });
});

describe('validateViewPageRefs — deliberate non-findings', () => {
  it('skips an interpolated target (resolved at render time, ADR-0072 D1)', () => {
    expect(validateViewPageRefs({
      views: [{ name: 'v', list: { type: 'page', pageName: '${page}', columns: [] } }],
      pages: [{ name: 'sales_dashboard' }],
    })).toEqual([]);
  });

  it('is total on junk input rather than throwing', () => {
    expect(validateViewPageRefs(undefined)).toEqual([]);
    expect(validateViewPageRefs({ views: 'nope', objects: 7, pages: null })).toEqual([]);
    expect(validateViewPageRefs({ views: [null, 3], objects: [null] })).toEqual([]);
  });
});
