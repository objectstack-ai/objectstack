// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

// The stored pass replays the FULL chain (ADR-0087 addendum, #3903): a row at
// rest was written under some past protocol and has no author to be taught by
// a tombstone, so `retiredFromLoadPath` entries — which the authored load seam
// skips — MUST apply here.
describe('applyConversionsToStoredItem (stored sys_metadata rows, #3903)', () => {
  it('replays a RETIRED conversion over a stored object row (conditionalRequired → requiredWhen)', () => {
    const row = {
      name: 'crm_task',
      label: 'Task',
      fields: { due_date: { type: 'date', conditionalRequired: 'record.stage == "closed"' } },
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) });
    expect(out.fields.due_date).toEqual({ type: 'date', requiredWhen: 'record.stage == "closed"' });
    expect(notices.map((n) => n.conversionId)).toContain('field-conditionalRequired-to-requiredWhen');
  });

  it('replays a retired conversion over a standalone stored action row (execute → target)', () => {
    const row = { name: 'convert', label: 'Convert', type: 'script', execute: 'convertHandler' };
    const out = applyConversionsToStoredItem('action', row) as Record<string, unknown>;
    expect(out.target).toBe('convertHandler');
    expect('execute' in out).toBe(false);
  });

  it('reaches actions EMBEDDED in a stored object row', () => {
    const row = {
      name: 'crm_lead',
      label: 'Lead',
      actions: [{ name: 'convert', type: 'script', execute: 'convertHandler' }],
    };
    const out = applyConversionsToStoredItem('object', row) as { actions: Array<Record<string, unknown>> };
    expect(out.actions[0]!.target).toBe('convertHandler');
    expect('execute' in out.actions[0]!).toBe(false);
  });

  it('accepts the legacy PLURAL row-type spelling', () => {
    const row = { name: 'crm_deal', label: 'Deal', sharingModel: 'read' };
    const out = applyConversionsToStoredItem('objects', row) as Record<string, unknown>;
    expect(out.sharingModel).toBe('public_read');
  });

  it('is idempotent — a canonical row passes through by reference', () => {
    const row = {
      name: 'crm_task',
      label: 'Task',
      fields: { due_date: { type: 'date', requiredWhen: 'record.stage == "closed"' } },
    };
    expect(applyConversionsToStoredItem('object', row)).toBe(row);
  });

  it('never mutates the stored input', () => {
    const row = {
      name: 'crm_task',
      fields: { due_date: { type: 'date', conditionalRequired: 'record.x == 1' } },
    };
    const snapshot = structuredClone(row);
    applyConversionsToStoredItem('object', row);
    expect(row).toEqual(snapshot);
  });

  it('passes through unknown types and non-object items unchanged', () => {
    const row = { name: 'h', object: 'crm_lead', event: 'afterInsert' };
    expect(applyConversionsToStoredItem('some_plugin_type', row)).toBe(row);
    expect(applyConversionsToStoredItem('object', null)).toBe(null);
    expect(applyConversionsToStoredItem('object', 'not-a-dict')).toBe('not-a-dict');
    const arr = [{ name: 'x' }];
    expect(applyConversionsToStoredItem('object', arr)).toBe(arr);
  });

  // #4456 — the driver-factory `??` fallback graduation. A runtime datasource
  // persisted before the #4410 config gate may carry the legacy spellings; the
  // stored pass MUST serve it canonical, because the factory now reads exactly
  // one spelling per key (deleting the fallbacks without this replay would
  // silently move a sqlite `file:` row's data to `:memory:`).
  describe('stored datasource rows (datasource-config-driver-key-aliases, #4456)', () => {
    it.each([
      ['sqlite', { file: './data/app.db' }, { filename: './data/app.db' }],
      ['sqlite', { database: './data/app.db' }, { filename: './data/app.db' }],
      ['postgres', { connectionString: 'postgresql://db/x', user: 'svc' }, { url: 'postgresql://db/x', username: 'svc' }],
      ['mysql', { host: 'db', database: 'orders', user: 'svc' }, { host: 'db', database: 'orders', username: 'svc' }],
      ['mongo', { uri: 'mongodb://db/x', user: 'svc' }, { url: 'mongodb://db/x', username: 'svc' }],
    ])('serves a stored %s row with legacy config keys canonical', (driver, config, expected) => {
      const row = { name: 'legacy_ds', driver, config, origin: 'runtime' };
      const out = applyConversionsToStoredItem('datasource', row) as { config: Record<string, unknown> };
      expect(out.config).toEqual(expected);
      expect(out).toMatchObject({ name: 'legacy_ds', driver, origin: 'runtime' });
    });

    it('leaves `database` alone for the drivers where it is canonical', () => {
      const row = { name: 'wh', driver: 'postgres', config: { host: 'db', database: 'analytics' } };
      expect(applyConversionsToStoredItem('datasource', row)).toBe(row);
    });

    it('lets a canonical key win over a shadowed legacy alias', () => {
      const row = { name: 'ds', driver: 'sqlite', config: { filename: './real.db', file: './stale.db' } };
      const out = applyConversionsToStoredItem('datasource', row) as { config: Record<string, unknown> };
      // renameKey convention: canonical present → alias left shadowed, untouched.
      expect(out.config).toEqual({ filename: './real.db', file: './stale.db' });
    });
  });

  it('threads the conflict guard context through (flow callers that own a registry)', () => {
    const flow = {
      name: 'notify_flow',
      nodes: [{ id: 'n1', type: 'webhook', config: { url: 'https://hooks.example.com' } }],
    };
    const conflicts: string[] = [];
    const out = applyConversionsToStoredItem('flow', flow, {
      reservedNodeTypes: new Set(['webhook']),
      onConflict: (c) => conflicts.push(c.token),
    }) as typeof flow;
    // A live executor owns 'webhook' → the rename is refused and reported.
    expect(out.nodes[0]!.type).toBe('webhook');
    expect(conflicts).toEqual(['webhook']);
  });
});
