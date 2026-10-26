// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  runtimeViewToInspectorDraft,
  inspectorDraftToRuntimeView,
  storedViewToRuntimeView,
} from './view-config-adapter';

describe('view-config-adapter', () => {
  describe('runtimeViewToInspectorDraft', () => {
    it('maps a flat grid view into a list ViewItem draft', () => {
      const view = {
        id: 'my_leads',
        label: 'My Leads',
        type: 'grid',
        columns: ['name', 'status'],
        filter: [{ field: 'owner', op: 'eq', value: 'me' }],
        sort: [{ field: 'name', order: 'asc' }],
        showSearch: true,
      };
      const draft = runtimeViewToInspectorDraft(view, 'crm_lead');
      expect(draft.name).toBe('my_leads');
      expect(draft.object).toBe('crm_lead');
      expect(draft.viewKind).toBe('list');
      expect(draft.label).toBe('My Leads');
      expect(draft.config.type).toBe('grid');
      expect(draft.config.columns).toEqual(['name', 'status']);
      expect(draft.config.data).toEqual({ object: 'crm_lead' });
      expect(draft.config.showSearch).toBe(true);
    });

    it('classifies form/detail types as the form family', () => {
      expect(
        runtimeViewToInspectorDraft({ id: 'f', type: 'form' }, 'o').viewKind,
      ).toBe('form');
      expect(
        runtimeViewToInspectorDraft({ id: 'd', type: 'detail' }, 'o').viewKind,
      ).toBe('form');
    });

    it('defaults a missing type to grid and columns to []', () => {
      const draft = runtimeViewToInspectorDraft({ id: 'v' }, 'o');
      expect(draft.config.type).toBe('grid');
      expect(draft.config.columns).toEqual([]);
      expect(draft.viewKind).toBe('list');
    });
  });

  describe('inspectorDraftToRuntimeView', () => {
    it('flattens a draft back, dropping the inspector data wrapper', () => {
      const draft = {
        name: 'my_leads',
        object: 'crm_lead',
        viewKind: 'list' as const,
        label: 'My Leads',
        config: {
          type: 'grid',
          label: 'My Leads',
          columns: ['name'],
          data: { object: 'crm_lead' },
          showSearch: true,
        },
      };
      const flat = inspectorDraftToRuntimeView(draft);
      expect(flat.id).toBe('my_leads');
      expect(flat.label).toBe('My Leads');
      expect(flat.type).toBe('grid');
      expect(flat.columns).toEqual(['name']);
      expect(flat.showSearch).toBe(true);
      expect('data' in flat).toBe(false);
    });
  });

  describe('round-trip fidelity', () => {
    it('preserves a grid (list) view through draft and back', () => {
      const view = {
        id: 'all_leads',
        label: 'All Leads',
        type: 'grid',
        columns: ['name', 'status', 'owner'],
        filter: [{ field: 'status', op: 'eq', value: 'open' }],
        sort: [{ field: 'created_at', order: 'desc' }],
        showSearch: true,
        showFilters: false,
        pageSize: 50,
        kanban: { groupByField: 'stage' },
      };
      const back = inspectorDraftToRuntimeView(
        runtimeViewToInspectorDraft(view, 'crm_lead'),
      );
      // id/label preserved; every payload field round-trips (data wrapper aside).
      expect(back.id).toBe(view.id);
      expect(back.label).toBe(view.label);
      expect(back.type).toBe(view.type);
      expect(back.columns).toEqual(view.columns);
      expect(back.filter).toEqual(view.filter);
      expect(back.sort).toEqual(view.sort);
      expect(back.showSearch).toBe(true);
      expect(back.showFilters).toBe(false);
      expect(back.pageSize).toBe(50);
      expect(back.kanban).toEqual({ groupByField: 'stage' });
    });

    it('preserves a form view through draft and back', () => {
      const view = {
        id: 'lead_form',
        label: 'Lead Form',
        type: 'form',
        sections: [{ label: 'Basics', fields: ['name'] }],
      };
      const draft = runtimeViewToInspectorDraft(view, 'crm_lead');
      expect(draft.viewKind).toBe('form');
      const back = inspectorDraftToRuntimeView(draft);
      expect(back.id).toBe('lead_form');
      expect(back.label).toBe('Lead Form');
      expect(back.type).toBe('form');
      expect(back.sections).toEqual(view.sections);
      expect('data' in back).toBe(false);
    });
  });

  // objectui#10210 — the body a pending-draft read hands the panel to resume.
  describe('storedViewToRuntimeView', () => {
    it('reads a ViewItem envelope back to the runtime view, keyed by its row name', () => {
      const back = storedViewToRuntimeView({
        name: 'crm_lead.all',
        object: 'crm_lead',
        viewKind: 'list',
        label: 'Everything',
        isDefault: true,
        config: { type: 'grid', columns: [{ field: 'name' }], data: { provider: 'object', object: 'crm_lead' } },
      });
      expect(back.id).toBe('crm_lead.all');
      expect(back.label).toBe('Everything');
      expect(back.type).toBe('grid');
      expect(back.columns).toEqual([{ field: 'name' }]);
      expect(back.isDefault).toBe(true);
      expect('config' in back).toBe(false);
    });

    it('returns a flat stored view (a draft saved before objectui#10210) as it is', () => {
      const flat = { id: 'crm_lead.all', name: 'crm_lead.all', label: 'Everything', type: 'grid', columns: [] };
      expect(storedViewToRuntimeView(flat)).toBe(flat);
    });
  });
});
