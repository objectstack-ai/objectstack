// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { deriveCrudCases } from './derive';

describe('deriveCrudCases — federated (external) objects (ADR-0015)', () => {
  it('blocks a read-only external object so verify never probe-inserts it', () => {
    const config = {
      datasources: [{ name: 'wh', schemaMode: 'external', external: { allowWrites: false } }],
      objects: [
        { name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders' }, fields: { amount: { type: 'number' } } },
      ],
    };
    const c = deriveCrudCases(config).find((x) => x.object === 'wh_order');
    expect(c?.blocked).toMatch(/external read-only/);
  });

  it('blocks when the object opts in but the datasource does not', () => {
    const config = {
      datasources: [{ name: 'wh', schemaMode: 'external', external: { allowWrites: false } }],
      objects: [
        { name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders', writable: true }, fields: { amount: { type: 'number' } } },
      ],
    };
    const c = deriveCrudCases(config).find((x) => x.object === 'wh_order');
    expect(c?.blocked).toMatch(/external read-only/);
  });

  it('does NOT block a fully write-opted-in external object (datasource + object)', () => {
    const config = {
      datasources: [{ name: 'wh', schemaMode: 'external', external: { allowWrites: true } }],
      objects: [
        { name: 'wh_order', datasource: 'wh', external: { remoteName: 'orders', writable: true }, fields: { amount: { type: 'number' } } },
      ],
    };
    const c = deriveCrudCases(config).find((x) => x.object === 'wh_order');
    expect(c?.blocked).toBeFalsy();
  });

  it('leaves managed objects unaffected', () => {
    const config = { objects: [{ name: 'task', fields: { title: { type: 'text' } } }] };
    const c = deriveCrudCases(config).find((x) => x.object === 'task');
    expect(c?.blocked).toBeFalsy();
  });
});
