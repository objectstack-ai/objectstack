// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { applyConversionsToStoredItem } from './stored.js';
import { CONVERSION_TODO_CODE, type ConversionNotice, type ConversionTodoNotice } from './types.js';

// The stored pass replays the FULL registered chain (ADR-0087 addendum, #3903):
// a row at rest was written under some past protocol and has no author to be
// taught by a tombstone, so `retiredFromLoadPath` entries — which the authored
// load seam skips — MUST apply here. "Registered" is the bound: a kit that has
// aged out of the tree (ADR-0087 amendment 2026-10-26, #25767 — retired at or
// below 16.x, at 18) is not in the table any more, so a row still carrying one
// of those keys is NOT canonicalized here; it meets the strict refusal at the
// parse, and is rehydrated on a release that still carried the kit first.
describe('applyConversionsToStoredItem (stored sys_metadata rows)', () => {
  it('replays a RETIRED conversion over a stored object row (externalSharingModel removed)', () => {
    const row = {
      name: 'portal_case',
      label: 'Case',
      sharingModel: 'public_read',
      externalSharingModel: 'private',
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) }) as Record<string, unknown>;
    expect(out).toEqual({ name: 'portal_case', label: 'Case', sharingModel: 'public_read' });
    expect(notices.map((n) => n.conversionId)).toContain('object-external-sharing-model-removed');
  });

  it('replays a retired conversion over a standalone stored action row (aria removed)', () => {
    const row = { name: 'escalate', label: 'Escalate', type: 'script', aria: { ariaLabel: 'Escalate', role: 'button' } };
    const out = applyConversionsToStoredItem('action', row) as Record<string, unknown>;
    expect(out).toEqual({ name: 'escalate', label: 'Escalate', type: 'script' });
    expect('aria' in out).toBe(false);
  });

  it('reaches actions EMBEDDED in a stored object row', () => {
    const row = {
      name: 'crm_lead',
      label: 'Lead',
      actions: [{ name: 'reopen', type: 'script', aria: { ariaDescribedBy: 'reopen_help' } }],
    };
    const out = applyConversionsToStoredItem('object', row) as { actions: Array<Record<string, unknown>> };
    expect(out.actions[0]).toEqual({ name: 'reopen', type: 'script' });
    expect('aria' in out.actions[0]!).toBe(false);
  });

  // [#25767] The bound stated above, pinned: a ≤16.x kit is gone from the
  // registered table, so its key is left exactly as stored — the row is not
  // half-migrated by some other entry, and nothing is reported. This is what
  // makes "rehydrate on ≤18.1 first" the prescription rather than a courtesy.
  it('leaves an aged-out key (≤16.x kit) as stored — the stored pass converts only what is registered', () => {
    const row = {
      name: 'crm_task',
      label: 'Task',
      enable: { trash: false, searchable: true },
      fields: { due_date: { type: 'date', conditionalRequired: 'record.stage == "closed"' } },
    };
    const notices: ConversionNotice[] = [];
    expect(applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) })).toBe(row);
    expect(notices).toEqual([]);
  });

  // #8321 — the authoring schema now refuses non-integer/negative
  // `scale`/`precision`, but a tenant with `scale: 2.5` already at rest in
  // `sys_metadata` must NOT become unloadable: the retired D2 conversion
  // drops the meaningless key (behaviour-preserving — #7501's enforcement
  // deliberately skipped malformed declarations, so it enforced nothing)
  // and the rest of the row survives byte-identically.
  it('drops a malformed stored scale/precision instead of breaking the row', () => {
    const row = {
      name: 'crm_deal',
      label: 'Deal',
      fields: {
        amount: { type: 'number', precision: 18, scale: 2.5 },
        weight: { type: 'number', precision: -1, scale: 2 },
        quantity: { type: 'number', precision: 10, scale: 0 },
      },
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) });
    expect(out.fields.amount).toEqual({ type: 'number', precision: 18 });
    expect(out.fields.weight).toEqual({ type: 'number', scale: 2 });
    // A well-formed count is untouched.
    expect(out.fields.quantity).toEqual({ type: 'number', precision: 10, scale: 0 });
    expect(
      notices.filter((n) => n.conversionId === 'field-malformed-scale-precision-removed'),
    ).toHaveLength(2);
  });

  it('accepts the legacy PLURAL row-type spelling', () => {
    const row = { name: 'crm_deal', label: 'Deal', sharingModel: 'private', externalSharingModel: 'private' };
    const out = applyConversionsToStoredItem('objects', row) as Record<string, unknown>;
    expect(out).toEqual({ name: 'crm_deal', label: 'Deal', sharingModel: 'private' });
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
      sharingModel: 'private',
      externalSharingModel: 'private',
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

  // Commit e2798fab7 renamed the canonical mongo id to `mongodb`;
  // `datasource-driver-mongo-to-mongodb` (retired from the load path at 18,
  // #23543 F1) converges the stored spelling here. The driver-factory `??`
  // fallback graduation that used to run over the same row
  // (`datasource-config-driver-key-aliases`, #4456) aged out with the 16.x kits
  // (#25767): a runtime datasource row still spelling `file:`/`uri:`/`user:` is
  // served as stored, and is rehydrated on a release ≤18.1 to be canonicalized.
  describe('stored datasource rows (datasource-driver-mongo-to-mongodb)', () => {
    it.each([
      ['mongo', 'mongodb'],
      ['mongodb', 'mongodb'],
    ])('serves a stored %s row as %s, config untouched', (driver, servedDriver) => {
      const config = { url: 'mongodb://db/x', username: 'svc' };
      const row = { name: 'legacy_ds', driver, config, origin: 'runtime' };
      const out = applyConversionsToStoredItem('datasource', row) as { config: Record<string, unknown> };
      expect(out.config).toEqual(config);
      expect(out).toMatchObject({ name: 'legacy_ds', driver: servedDriver, origin: 'runtime' });
    });

    it('leaves a canonical row of another driver alone, by reference', () => {
      const row = { name: 'wh', driver: 'postgres', config: { host: 'db', database: 'analytics' } };
      expect(applyConversionsToStoredItem('datasource', row)).toBe(row);
    });

    it('leaves a pre-#4410 legacy config spelling as stored — the alias kit aged out (#25767)', () => {
      const row = { name: 'ds', driver: 'sqlite', config: { file: './data/app.db' } };
      expect(applyConversionsToStoredItem('datasource', row)).toBe(row);
    });
  });

  // #19620 — `translation` has no manifest-collection spelling, so until this
  // the stored pass returned every translation row untouched and no seam ever
  // replayed a translation conversion over one. The item door's `settings` is
  // the case that made it matter: a stored item's copy overrides the
  // platform's, because the runtime-authored layer is read over the bundles.
  describe('stored translation rows (translation-per-app-settings-removed)', () => {
    const storedItem = () => ({
      name: 'zh-CN',
      locale: 'zh-CN',
      settings: { mail: { title: '邮件' } },
      apps: { crm: { label: '客户关系管理' } },
    });

    it.each(['translation', 'translations'])('drops `settings` from a stored `%s` row, loudly, keeping the rest', (type) => {
      const notices: ConversionNotice[] = [];
      const out = applyConversionsToStoredItem(type, storedItem(), { onNotice: (n) => notices.push(n) });
      expect(out).toEqual({ name: 'zh-CN', locale: 'zh-CN', apps: { crm: { label: '客户关系管理' } } });
      expect(notices.map((n) => [n.conversionId, n.from, n.to])).toEqual([
        ['translation-per-app-settings-removed', 'settings', '(removed)'],
      ]);
    });

    it('CONTROL — a canonical translation row passes through by reference', () => {
      const row = { name: 'zh-CN', locale: 'zh-CN', apps: { crm: { label: '客户关系管理' } } };
      expect(applyConversionsToStoredItem('translation', row)).toBe(row);
    });
  });

  // [#23543 F5-http] A stored flow row written with a retired callout name
  // still loads, as `http`: the rename left the authoring funnel, not this
  // seam. Until 18 a caller's live-name set naming the old token made it a
  // refused conflict instead (ADR-0078's guard); the engine now refuses an
  // executor under a reserved name, so the guard is gone, the rewrite is
  // unconditional, and (#24001) the conflict channel left with it.
  it('rewrites a stored flow\'s retired callout node type to http, unconditionally', () => {
    const flow = {
      name: 'notify_flow',
      nodes: [
        { id: 'n1', type: 'webhook', config: { url: 'https://hooks.example.com' } },
        { id: 'n2', type: 'http_request', config: { url: 'https://example.com' } },
        { id: 'n3', type: 'http_call', config: { url: 'https://example.com' } },
      ],
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('flow', flow, {
      onNotice: (n) => notices.push(n),
    }) as typeof flow;
    expect(out.nodes.map((n) => n.type)).toEqual(['http', 'http', 'http']);
    expect(out.nodes.map((n) => n.config)).toEqual(flow.nodes.map((n) => n.config));
    expect(notices.map((n) => [n.conversionId, n.from, n.to])).toEqual([
      ['flow-node-http-callout-rename', 'webhook', 'http'],
      ['flow-node-http-callout-rename', 'http_request', 'http'],
      ['flow-node-http-callout-rename', 'http_call', 'http'],
    ]);
  });

  // [#17321] The TODO lane rides through the stored seam:
  // `StoredConversionOptions` omits only `includeRetired`, so
  // `onTodo` reaches the (retired, replayed-at-rest) filter conversion.
  it('threads the TODO sink through — a stored page filter left as stored is reported, not silent', () => {
    const page = {
      name: 'pipeline',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'object-grid', properties: { objectName: 'deal', filter: { stage: 'open' } } },
            { type: 'object-kanban', properties: { objectName: 'deal', filter: { $or: [{ stage: 'open' }, { stage: 'won' }] } } },
          ],
        },
      ],
    };
    const notices: ConversionNotice[] = [];
    const todos: ConversionTodoNotice[] = [];
    const out = applyConversionsToStoredItem('page', page, {
      onNotice: (n) => notices.push(n),
      onTodo: (t) => todos.push(t),
    }) as typeof page;
    const components = out.regions[0]!.components as Array<{ properties: { filter: unknown } }>;
    expect(components[0]!.properties.filter).toEqual([{ field: 'stage', operator: 'equals', value: 'open' }]);
    // Byte-identical: the combinator is never flattened, only named.
    expect(components[1]!.properties.filter).toEqual({ $or: [{ stage: 'open' }, { stage: 'won' }] });
    expect(notices.map((n) => n.path)).toEqual(['pages[0].regions[0].components[0].properties.filter']);
    expect(todos.map((t) => [t.code, t.conversionId, t.path])).toEqual([
      [CONVERSION_TODO_CODE, 'page-component-filter-record-to-rule-array', 'pages[0].regions[0].components[1].properties.filter'],
    ]);
    expect(todos[0]!.reason).toContain('`$or`');
  });
});
