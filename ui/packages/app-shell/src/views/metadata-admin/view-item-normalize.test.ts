// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  isAggregatedViewContainer,
  viewDisplayType,
} from './view-item-normalize';

const calendarItem = {
  name: 'crm_campaign.campaign_calendar',
  object: 'crm_campaign',
  viewKind: 'list',
  label: 'Launch Calendar',
  scope: 'package',
  _provenance: 'package',
  config: {
    name: 'campaign_calendar',
    label: 'Launch Calendar',
    type: 'calendar',
    data: { provider: 'object', object: 'crm_campaign' },
    columns: ['name', 'channel', 'status'],
    calendar: {
      startDateField: 'start_date',
      endDateField: 'end_date',
      titleField: 'name',
      colorField: 'name',
    },
  },
};

const formItem = {
  name: 'crm_lead.intake_form',
  object: 'crm_lead',
  viewKind: 'form',
  label: 'Intake',
  scope: 'shared',
  config: { type: 'simple', data: { object: 'crm_lead' }, sections: [] },
};

describe('isAggregatedViewContainer', () => {
  it('accepts a bare container with listViews/formViews', () => {
    expect(isAggregatedViewContainer({ name: 'crm_lead', listViews: {}, formViews: {} })).toBe(true);
    expect(isAggregatedViewContainer({ name: 'crm_lead', list: {} })).toBe(true);
    expect(isAggregatedViewContainer({ name: 'crm_lead', form: {} })).toBe(true);
  });
  it('rejects an expanded ViewItem (carries viewKind)', () => {
    expect(isAggregatedViewContainer(calendarItem)).toBe(false);
    expect(isAggregatedViewContainer({ name: 'x', viewKind: 'list', list: {} })).toBe(false);
  });
  it('rejects an item with none of the aggregate buckets', () => {
    expect(isAggregatedViewContainer({ name: 'x' })).toBe(false);
    expect(isAggregatedViewContainer(null)).toBe(false);
  });
});

describe('viewDisplayType', () => {
  it('reads config.type for an expanded list item', () => {
    expect(viewDisplayType(calendarItem)).toBe('calendar');
  });
  it('reads config.type for an expanded form item', () => {
    expect(viewDisplayType(formItem)).toBe('simple');
  });
  it('reads a flat legacy view`s top-level type', () => {
    expect(viewDisplayType({ name: 'x', type: 'grid' })).toBe('grid');
  });
  it('falls back to the family when only viewKind is present', () => {
    expect(viewDisplayType({ name: 'x', viewKind: 'list', config: {} })).toBe('list');
    expect(viewDisplayType({ name: 'x', viewKind: 'form', config: {} })).toBe('form');
  });
  it('returns undefined for an aggregated container', () => {
    expect(viewDisplayType({ name: 'crm_lead', listViews: {} })).toBeUndefined();
  });
});
