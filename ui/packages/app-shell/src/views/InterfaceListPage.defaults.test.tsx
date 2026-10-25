// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  defaultColumnsFromObject,
  defaultKanbanFromObject,
  defaultCalendarFromObject,
  defaultGalleryFromObject,
} from './InterfaceListPage';

/**
 * ADR-0047: when a page whitelists a visualization (appearance.allowedVisualizations)
 * but the source view carries no binding for it, InterfaceListPage derives a
 * sensible default from the object's fields — so the switcher actually offers
 * and renders the viz (Airtable auto-picks a stack field on switch). Without
 * this, ListView.availableViews silently drops the whitelisted viz.
 */
const taskObject = {
  fields: {
    id: { type: 'autonumber' },
    title: { type: 'text' },
    status: { type: 'select' },
    due_date: { type: 'date' },
    cover: { type: 'image' },
    created_at: { type: 'datetime' },
  },
};

describe('InterfaceListPage default viz bindings', () => {
  it('kanban: picks the first select field as the group field (both aliases)', () => {
    expect(defaultKanbanFromObject(taskObject)).toEqual({ groupByField: 'status' });
  });

  it('kanban: falls back to a status-like field name when no select type exists', () => {
    const obj = { fields: { title: { type: 'text' }, stage: { type: 'text' } } };
    expect(defaultKanbanFromObject(obj)).toEqual({ groupByField: 'stage' });
  });

  it('kanban: undefined when nothing groupable', () => {
    expect(defaultKanbanFromObject({ fields: { title: { type: 'text' }, note: { type: 'text' } } })).toBeUndefined();
  });

  it('calendar: picks the first date field (skipping system audit columns)', () => {
    expect(defaultCalendarFromObject(taskObject)).toEqual({ startDateField: 'due_date' });
  });

  it('gallery: picks the first image field', () => {
    expect(defaultGalleryFromObject(taskObject)).toEqual({ coverField: 'cover' });
  });

  it('ignores hidden and system fields', () => {
    const obj = { fields: { created_at: { type: 'datetime' }, hidden_sel: { type: 'select', hidden: true }, real_sel: { type: 'select' } } };
    expect(defaultKanbanFromObject(obj)).toEqual({ groupByField: 'real_sel' });
  });
});

describe('defaultColumnsFromObject', () => {
  // Mirrors how the framework's `applySystemFields` presents an object to the
  // console: injected system fields (owner_id, audit columns) are spread to the
  // FRONT of the field map and carry `system: true`; owner_id is deliberately
  // non-hidden / non-readonly because ownership is reassignable.
  const fieldZooLike = {
    fields: {
      owner_id: { type: 'lookup', label: 'Owner', system: true },
      created_at: { type: 'datetime', system: true, readonly: true },
      created_by: { type: 'lookup', system: true, readonly: true },
      organization_id: { type: 'lookup', system: true, hidden: true },
      name: { type: 'text' },
      f_email: { type: 'email' },
      f_number: { type: 'number' },
    },
  };

  it('does NOT lead with the injected owner_id — business fields come first', () => {
    const cols = defaultColumnsFromObject(fieldZooLike);
    expect(cols[0]).toBe('name');
    expect(cols).not.toContain('owner_id');
    expect(cols).not.toContain('created_at');
    expect(cols).not.toContain('organization_id');
    expect(cols).toEqual(['name', 'f_email', 'f_number']);
  });

  it('excludes owner_id even when it arrives without the system flag (name fallback)', () => {
    const cols = defaultColumnsFromObject({
      fields: { owner_id: { type: 'lookup' }, title: { type: 'text' } },
    });
    expect(cols).toEqual(['title']);
  });

  it('honors highlightFields as the curated override', () => {
    const cols = defaultColumnsFromObject({
      highlightFields: ['name', 'owner_id'],
      fields: fieldZooLike.fields,
    });
    // Curated list wins verbatim (only dropping names with no field def).
    expect(cols).toEqual(['name', 'owner_id']);
  });

  // objectui#7245 — the same fix as `ObjectView.defaultListColumnsFromObject`.
  // These two are documented mirrors of one another, so the pin is mirrored too:
  // a curated `highlightFields` that (correctly) omits the title field left an
  // interface page's rows with no column identifying them.
  describe('#7245: the synthesized default always leads with the name field', () => {
    const showcaseAccount = {
      nameField: 'name',
      highlightFields: ['status', 'industry', 'annual_revenue'],
      fields: {
        name: { type: 'text', label: 'Account Name' },
        industry: { type: 'select' },
        annual_revenue: { type: 'currency' },
        status: { type: 'select' },
        organization_id: { type: 'lookup', system: true, hidden: true },
      },
    };

    it('THE REPRO: prepends nameField to a curated list that omits it', () => {
      expect(defaultColumnsFromObject(showcaseAccount)).toEqual([
        'name',
        'status',
        'industry',
        'annual_revenue',
      ]);
    });

    it('does not duplicate, and moves a late-listed nameField to the front', () => {
      expect(
        defaultColumnsFromObject({ ...showcaseAccount, highlightFields: ['status', 'name'] }),
      ).toEqual(['name', 'status']);
    });

    it('leads the derived walk BEFORE the six-column cap', () => {
      const fields: Record<string, any> = {};
      for (let i = 0; i < 9; i++) fields[`b_${i}`] = { type: 'text' };
      fields.headline = { type: 'text' };
      const cols = defaultColumnsFromObject({ nameField: 'headline', fields });
      expect(cols).toHaveLength(6);
      expect(cols[0]).toBe('headline');
    });

    it('still appends the org attribution column last', () => {
      expect(defaultColumnsFromObject(showcaseAccount, { orgAttribution: true })).toEqual([
        'name',
        'status',
        'industry',
        'annual_revenue',
        'organization_id',
      ]);
    });
  });

  it('caps the auto-derived business columns at six', () => {
    const fields: Record<string, any> = { owner_id: { type: 'lookup', system: true } };
    for (let i = 0; i < 10; i++) fields[`b_${i}`] = { type: 'text' };
    const cols = defaultColumnsFromObject({ fields });
    expect(cols).toHaveLength(6);
    expect(cols).not.toContain('owner_id');
    expect(cols[0]).toBe('b_0');
  });

  // ADR-0105 group posture: organization_id is appended as a TRAILING
  // attribution column for org-walled objects; business fields still lead.
  describe('orgAttribution (ADR-0105 group posture)', () => {
    it('appends organization_id last for an org-walled object', () => {
      const cols = defaultColumnsFromObject(fieldZooLike, { orgAttribution: true });
      expect(cols).toEqual(['name', 'f_email', 'f_number', 'organization_id']);
    });

    it('does not append for an object without organization_id', () => {
      const cols = defaultColumnsFromObject(
        { fields: { title: { type: 'text' } } },
        { orgAttribution: true },
      );
      expect(cols).toEqual(['title']);
    });

    it('is a no-op when the flag is off (non-group postures unchanged)', () => {
      expect(defaultColumnsFromObject(fieldZooLike, { orgAttribution: false })).toEqual(
        defaultColumnsFromObject(fieldZooLike),
      );
    });
  });
});
