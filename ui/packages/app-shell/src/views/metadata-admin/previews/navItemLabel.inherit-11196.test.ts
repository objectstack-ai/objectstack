// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11196 — the designer names a label-less nav entry by the RUNTIME's
 * inheritance rule, called and never restated.
 *
 * The spec made a nav entry's `label` optional: absent ⇒ the entry shows, at
 * render time, the current label of what it opens. The console draws that with
 * `resolveNavItemLabel` (`@object-ui/layout`) and a target resolver; the
 * designer surfaces read the entry through `navEntryLabelText`, which asks that
 * same function. The pins:
 *
 *  - PARITY: for an entry of every nav type, with and without a resolver, the
 *    designer's text for a label-less entry IS the runtime function's answer.
 *    A second, hand-kept ladder in the designer would drift from it; this is
 *    what would go red.
 *  - the ladder's rungs as the designer sees them: the target's metadata label,
 *    else its machine name, else the entry's `id`;
 *  - CONTROL: an authored label renders verbatim, never swapped for the
 *    target's label — not even one spelled like the target's machine name;
 *  - a present label that resolves to nothing (an empty map) is not absent;
 *  - `clearedLabel`, the inverse of `renamedLabel`: a string clears to no key
 *    at all, never to `''`; a map loses only the designer locale's own entry.
 */

import { describe, it, expect } from 'vitest';
import { resolveNavItemLabel, type NavTargetLabelResolver } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import {
  clearedLabel,
  inheritedNavEntryText,
  navEntryLabelText,
  type NavEntryLike,
} from './navItemLabel';

/** A host's metadata, as the console's `useNavTargetLabel` would answer it. */
const METADATA: NavTargetLabelResolver = (target) => {
  switch (target.kind) {
    case 'object':
      return target.objectName === 'lead' ? 'Leads' : undefined;
    case 'view':
      return target.objectName === 'lead' && target.viewName === 'board' ? 'Lead board' : undefined;
    case 'dashboard':
      return target.dashboardName === 'sales' ? 'Sales Overview' : undefined;
    default:
      return undefined;
  }
};

/** One label-less entry of every nav type, and the targets the resolver cannot name. */
const LABEL_LESS: NavEntryLike[] = [
  { id: 'nav_leads', type: 'object', objectName: 'lead' },
  { id: 'nav_board', type: 'object', objectName: 'lead', viewName: 'board' },
  { id: 'nav_kanban', type: 'object', objectName: 'lead', viewName: 'kanban' },
  { id: 'nav_deals', type: 'object', objectName: 'deal' },
  { id: 'nav_deal_view', type: 'object', objectName: 'deal', viewName: 'open_deals' },
  { id: 'nav_sales', type: 'dashboard', dashboardName: 'sales' },
  { id: 'nav_ops', type: 'dashboard', dashboardName: 'ops' },
  { id: 'nav_home', type: 'page', pageName: 'home_page' },
  { id: 'nav_pipe', type: 'report', reportName: 'pipeline' },
  { id: 'nav_docs', type: 'url', url: 'https://docs.example.com' },
  { id: 'nav_dir', type: 'component', componentRef: 'metadata:directory' },
  { id: 'nav_run', type: 'action', actionDef: { actionName: 'quick_create' } },
  { id: 'nav_guide', type: 'doc', book: 'crm_manual', doc: 'crm_lead_guide' },
  { id: 'nav_manual', type: 'doc', book: 'crm_manual' },
  { id: 'nav_doc_empty', type: 'doc' },
  { id: 'nav_admin', type: 'group', children: [] },
  { id: 'nav_empty_object', type: 'object' },
  { id: 'nav_sep', type: 'separator' },
];

describe('objectui#11196 — a label-less entry reads as the runtime draws it', () => {
  for (const resolver of [METADATA, undefined]) {
    const which = resolver ? 'with a target resolver' : 'with no target resolver';
    it(`PARITY ${which}: the designer's text is resolveNavItemLabel's own answer, for every nav type`, () => {
      for (const entry of LABEL_LESS) {
        const runtime = resolveNavItemLabel(entry as unknown as NavigationItem, undefined, resolver);
        expect(navEntryLabelText(entry, 'en-US', resolver), JSON.stringify(entry)).toBe(runtime);
        expect(inheritedNavEntryText(entry, resolver), JSON.stringify(entry)).toBe(runtime);
      }
    });
  }

  it("inherits the target's current label, else its machine name, else the entry's id", () => {
    const text = (entry: NavEntryLike) => navEntryLabelText(entry, 'en-US', METADATA);
    expect(text({ id: 'nav_leads', type: 'object', objectName: 'lead' })).toBe('Leads');
    expect(text({ id: 'nav_board', type: 'object', objectName: 'lead', viewName: 'board' })).toBe('Lead board');
    // An unlabelled view falls to its object's label, then to the viewName.
    expect(text({ id: 'nav_kanban', type: 'object', objectName: 'lead', viewName: 'kanban' })).toBe('Leads');
    expect(text({ id: 'nav_deal_view', type: 'object', objectName: 'deal', viewName: 'open_deals' })).toBe('open_deals');
    expect(text({ id: 'nav_sales', type: 'dashboard', dashboardName: 'sales' })).toBe('Sales Overview');
    // A target the host cannot read (a draft, an unsaved record) is named by its machine name.
    expect(text({ id: 'nav_deals', type: 'object', objectName: 'deal' })).toBe('deal');
    expect(text({ id: 'nav_ops', type: 'dashboard', dashboardName: 'ops' })).toBe('ops');
    // A page never asks the resolver: its machine name is its text (what NavigationSyncEffect used to store).
    expect(text({ id: 'nav_home', type: 'page', pageName: 'home_page' })).toBe('home_page');
    // A doc entry: the page it opens, else its book, else its id (objectui#11197's rung).
    expect(text({ id: 'nav_guide', type: 'doc', book: 'crm_manual', doc: 'crm_lead_guide' })).toBe('crm_lead_guide');
    expect(text({ id: 'nav_manual', type: 'doc', book: 'crm_manual' })).toBe('crm_manual');
    expect(text({ id: 'nav_doc_empty', type: 'doc' })).toBe('nav_doc_empty');
    // No target of its own: the entry's id.
    expect(text({ id: 'nav_admin', type: 'group', children: [] })).toBe('nav_admin');
    expect(text({ id: 'nav_empty_object', type: 'object' })).toBe('nav_empty_object');
  });

  it('answers the empty string for what the rule names nothing: a separator, and an entry with no target and no id', () => {
    expect(navEntryLabelText({ id: 'nav_sep', type: 'separator' }, 'en-US', METADATA)).toBe('');
    expect(navEntryLabelText({ type: 'group', children: [] }, 'en-US', METADATA)).toBe('');
  });

  it('CONTROL: an authored label renders verbatim and is never swapped for the target label', () => {
    expect(navEntryLabelText({ id: 'nav_leads', type: 'object', objectName: 'lead', label: 'Hot prospects' }, 'en-US', METADATA)).toBe(
      'Hot prospects',
    );
    // Spelled like the target's machine name: still authored, still verbatim.
    expect(navEntryLabelText({ id: 'nav_leads', type: 'object', objectName: 'lead', label: 'lead' }, 'en-US', METADATA)).toBe('lead');
    // A locale map resolves in the designer locale.
    const map = { en: 'Prospects', 'zh-CN': '潜在客户' };
    expect(navEntryLabelText({ id: 'nav_leads', type: 'object', objectName: 'lead', label: map }, 'zh-CN', METADATA)).toBe('潜在客户');
    expect(navEntryLabelText({ id: 'nav_leads', type: 'object', objectName: 'lead', label: map }, 'en-US', METADATA)).toBe('Prospects');
  });

  it('a present label that resolves to nothing is not absent: it inherits nothing', () => {
    expect(navEntryLabelText({ id: 'nav_leads', type: 'object', objectName: 'lead', label: {} }, 'en-US', METADATA)).toBe('');
  });

  it("inheritedNavEntryText answers the inherited text even for an entry that has a label (an inspector's placeholder)", () => {
    expect(inheritedNavEntryText({ id: 'nav_leads', type: 'object', objectName: 'lead', label: 'Hot prospects' }, METADATA)).toBe('Leads');
  });
});

describe('objectui#11196 — clearedLabel restores inheritance, the inverse of renamedLabel', () => {
  it('a plain string, or no label, clears to NO key — never to the empty string', () => {
    expect(clearedLabel('Hot prospects', 'en-US')).toBeUndefined();
    expect(clearedLabel(undefined, 'en-US')).toBeUndefined();
  });

  it("a map loses only the designer locale's own entry, and every other language keeps its text", () => {
    expect(clearedLabel({ en: 'Accounts', 'zh-CN': '客户' }, 'zh-CN')).toEqual({ en: 'Accounts' });
    // The bare language is the locale's own entry when there is no exact tag.
    expect(clearedLabel({ en: 'Accounts', zh: '客户' }, 'zh-CN')).toEqual({ en: 'Accounts' });
    expect(clearedLabel({ en: 'Accounts', 'zh-CN': '客户' }, 'en-US')).toEqual({ 'zh-CN': '客户' });
  });

  it('an entry the locale only reached as a fallback is not its own, and is kept', () => {
    expect(clearedLabel({ en: 'Accounts' }, 'zh-CN')).toEqual({ en: 'Accounts' });
  });

  it('a map left with no text in any language clears to no key', () => {
    expect(clearedLabel({ 'zh-CN': '客户' }, 'zh-CN')).toBeUndefined();
  });
});
