// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5115 — the WIRING half of the compile-time cross-datasource gate.
 *
 * `dataset-compiler.test.ts` pins the verdict; this file pins that the service
 * actually asks the question. `registerDataset` is the one door every dataset
 * goes through (pre-registered datasets at construction, `queryDataset` for
 * saved and Studio-draft datasets alike), so hooking the probes up there is
 * what moves the failure off the dashboard and onto the author. A compiler that
 * can reject but is never handed the probes would pass every unit test above
 * and change nothing in production.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService, type AnalyticsServiceConfig } from '../analytics-service.js';

/** opportunity (billing_db) --account--> crm_account (crm_db). */
const DATASOURCES: Record<string, string> = {
  opportunity: 'billing_db',
  crm_account: 'crm_db',
};

const relationshipResolver = (obj: string, rel: string) =>
  obj === 'opportunity' && rel === 'account'
    ? { object: 'crm_account', table: 'crm_account' }
    : undefined;

const crossDsDataset = DatasetSchema.parse({
  name: 'revenue_by_region',
  label: 'Revenue by region',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'region', label: 'Region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' }],
});

/** Silent by default — one case swaps in a spy to read the boot-time WARN. */
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as AnalyticsServiceConfig['logger'];

const serviceWith = (config: AnalyticsServiceConfig = {}) =>
  new AnalyticsService({
    relationshipResolver,
    getObjectDatasource: (o: string) => DATASOURCES[o],
    logger: silentLogger,
    ...config,
  });

describe('registerDataset rejects a cross-datasource join at compile time (#5115)', () => {
  it('throws when registering the dataset — no query needed', () => {
    expect(() => serviceWith().registerDataset(crossDsDataset)).toThrowError(
      /JOIN cannot cross datasources/,
    );
  });

  it('names both objects and both datasources, so the author can act', () => {
    const err = (() => {
      try {
        serviceWith().registerDataset(crossDsDataset);
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).toContain('base object "opportunity"');
    expect(err?.message).toContain('datasource "billing_db"');
    expect(err?.message).toContain('joined object "crm_account"');
    expect(err?.message).toContain('datasource "crm_db"');
  });

  it('fails the QUERY too — before any SQL is built or any driver is touched', async () => {
    // The point of the gate: the widget no longer gets as far as a statement,
    // so nothing depends on the driver's error text (that was #5033's job).
    const executeRawSql = vi.fn();
    const executeAggregate = vi.fn();
    const service = serviceWith({ executeRawSql, executeAggregate });

    await expect(
      service.queryDataset(crossDsDataset, { dimensions: ['region'], measures: ['revenue'] }),
    ).rejects.toThrow(/JOIN cannot cross datasources/);

    expect(executeRawSql).not.toHaveBeenCalled();
    expect(executeAggregate).not.toHaveBeenCalled();
  });

  it('does not take the kernel down at boot — a bad pre-registered dataset warns and is skipped', () => {
    // Pre-registered datasets are compiled in the constructor, which already
    // catches and warns per dataset. A metadata error must stay a metadata
    // error: the OTHER datasets in the same host still register.
    const warn = vi.fn();
    const sane = DatasetSchema.parse({
      name: 'pipeline',
      label: 'Pipeline',
      object: 'opportunity',
      dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
    });
    const service = serviceWith({
      datasets: [crossDsDataset, sane],
      logger: { info() {}, warn, error() {}, debug() {} } as AnalyticsServiceConfig['logger'],
    });

    expect(warn.mock.calls.map(String).join('\n')).toMatch(/JOIN cannot cross datasources/);
    expect(service.cubeRegistry.get('pipeline')).toBeDefined();
    expect(service.cubeRegistry.get('revenue_by_region')).toBeUndefined();
  });

  it('a host that wires NO datasource probe registers the same dataset unchanged', () => {
    // The tiering, at the seam that matters: every embedding without a data
    // engine (and every existing test double) must be unaffected by #5115.
    const service = new AnalyticsService({ relationshipResolver });
    const compiled = service.registerDataset(crossDsDataset);
    expect(compiled.cube.joins?.account?.name).toBe('crm_account');
  });

  it('a FEDERATED join target still registers (ADR-0062 D6 — FK-expand serves it)', () => {
    const service = serviceWith({ isExternalObject: (o) => o === 'crm_account' });
    expect(() => service.registerDataset(crossDsDataset)).not.toThrow();
  });
});
