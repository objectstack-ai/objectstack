// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { metricDrillFilter, readMeasureDrillScope } from '../metricDrill';

describe('metricDrillFilter — the list a KPI tile opens (ADR-0021 D2)', () => {
  it('offers no click when the answer names no object', () => {
    expect(metricDrillFilter({ object: undefined, measureScope: {}, runtimeFilter: undefined })).toBeNull();
  });

  it('offers no click when the answer did not state the measure scope', () => {
    expect(metricDrillFilter({ object: 'crm_opportunity', measureScope: undefined, runtimeFilter: { stage: 'closed_won' } })).toBeNull();
  });

  it('opens the widget filter alone when the measure has no scope of its own', () => {
    expect(
      metricDrillFilter({ object: 'crm_opportunity', measureScope: {}, runtimeFilter: { stage: { $nin: ['closed_won', 'closed_lost'] } } }),
    ).toEqual({ stage: { $nin: ['closed_won', 'closed_lost'] } });
  });

  it('opens every record when neither side filters', () => {
    expect(metricDrillFilter({ object: 'crm_opportunity', measureScope: {}, runtimeFilter: undefined })).toEqual({});
  });

  it('keeps the measure scope AND the widget filter, never only one of them', () => {
    const filter = metricDrillFilter({ object: 'invoice', measureScope: { status: 'paid' }, runtimeFilter: { region: 'emea' } });
    expect(filter).toEqual({ $and: [{ region: 'emea' }, { status: 'paid' }] });
  });

  it('keeps the measure scope when the widget declares no filter', () => {
    expect(metricDrillFilter({ object: 'invoice', measureScope: { status: 'paid' }, runtimeFilter: undefined })).toEqual({ status: 'paid' });
  });

  it('bounds the list by the answer date window', () => {
    const filter = metricDrillFilter({
      object: 'crm_opportunity',
      measureScope: {},
      runtimeFilter: { stage: 'closed_won' },
      ranges: { close_date: { field: 'close_date', gte: '2026-10-01', lt: '2027-01-01' } },
    });
    expect(JSON.stringify(filter)).toContain('2026-10-01');
    expect(JSON.stringify(filter)).toContain('closed_won');
  });

  it('offers no click when the widget filter cannot become a list filter', () => {
    // A scalar on a list operator is refused by the shared drill sink.
    expect(metricDrillFilter({ object: 'invoice', measureScope: { status: 'paid' }, runtimeFilter: [['stage', 'in', 'won']] })).toBeNull();
  });
});

describe('readMeasureDrillScope — the answer drillScopes entry', () => {
  it('reads the tile measure entry', () => {
    expect(readMeasureDrillScope({ drillScopes: { paid_count: { status: 'paid' } } }, 'paid_count')).toEqual({ status: 'paid' });
  });

  it('reads an empty entry as a scope with no extra condition', () => {
    expect(readMeasureDrillScope({ drillScopes: { total_amount: {} } }, 'total_amount')).toEqual({});
  });

  it('reads a missing entry, a missing map or no measure as "no scope"', () => {
    expect(readMeasureDrillScope({ drillScopes: { opp_count: {} } }, 'paid_rate')).toBeUndefined();
    expect(readMeasureDrillScope({}, 'total_amount')).toBeUndefined();
    expect(readMeasureDrillScope(undefined, 'total_amount')).toBeUndefined();
    expect(readMeasureDrillScope({ drillScopes: { total_amount: {} } }, undefined)).toBeUndefined();
  });
});
