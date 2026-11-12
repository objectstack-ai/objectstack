// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D1–D4] The spec half of one-way sync-in, beside federation.
 *
 * Pinned, each refusal on a MINIMAL stack with its LEGAL TWIN silent:
 *
 * - parse (`MappingSchema`): a mapping carries at most one source; a sourced
 *   mapping writes in `mode: 'upsert'` with an `upsertKey`; `paging` states
 *   the parameter its style needs and none it refuses; `deletePolicy` has NO
 *   schema default (its absence reads `mark`, the engine's reading);
 * - build (`defineStack`, `STACK_CROSS_REFERENCE_INVALID` / 422): a sourced
 *   mapping's `targetObject` is `managedBy: 'synced'`; `datasourceSource.object`
 *   is an object this stack declares and a federated one; `source_key_missing`;
 *   `source_key_not_exact`; a halvable `watermark.field`; `watermark_not_exact`;
 *   `watermark_field_unmapped`;
 * - `job.pull` accepts a mapping with either source.
 *
 * The engine that reads these keys is the P2 engine card; until it lands each
 * new key is a `planned` liveness row that warns its author.
 */
import { describe, expect, it } from 'vitest';
import { MappingSchema } from './mapping.zod';
import { defineStack } from '../stack.zod';

describe('MappingSchema — the rules a sourced mapping states alone (parse)', () => {
  const datasourceSource = { object: 'erp_order', watermark: { field: 'updated_at', start: '2026-01-01T00:00:00Z' } };
  const connectorSource = { connector: 'orders_api', action: 'request' };
  const legal = {
    name: 'orders_sync',
    targetObject: 'order',
    fieldMapping: [{ source: 'id', target: 'external_id' }],
    mode: 'upsert',
    upsertKey: ['external_id'],
  };
  const issuesOf = (input: Record<string, unknown>) => {
    const r = MappingSchema.safeParse(input);
    return r.success ? [] : r.error.issues;
  };

  it('legal twins: either source alone, upsert with a key, parses', () => {
    expect(issuesOf({ ...legal, datasourceSource })).toEqual([]);
    expect(issuesOf({ ...legal, connectorSource })).toEqual([]);
  });

  it('both sources at once are refused at `datasourceSource`', () => {
    const issues = issuesOf({ ...legal, datasourceSource, connectorSource });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['datasourceSource']);
    expect(issues[0]!.message).toContain('`connectorSource`');
  });

  it.each(['insert', 'update'])("a sourced mapping in mode '%s' is refused at `mode`", (mode) => {
    const issues = issuesOf({ ...legal, mode, datasourceSource });
    expect(issues.map((i) => i.path)).toEqual([['mode']]);
    expect(issues[0]!.message).toContain("'upsert'");
  });

  it('a sourced mapping with no mode is refused (the mode default is insert)', () => {
    const { mode: _mode, ...noMode } = legal;
    expect(issuesOf({ ...noMode, connectorSource }).map((i) => i.path)).toEqual([['mode']]);
  });

  it.each([[undefined], [[]]])('a sourced upsert with upsertKey %j is refused at `upsertKey`', (upsertKey) => {
    const issues = issuesOf({ ...legal, upsertKey, datasourceSource });
    expect(issues.map((i) => i.path)).toEqual([['upsertKey']]);
  });

  it('an unsourced mapping keeps its own mode rules — an import may insert without a key (twin)', () => {
    expect(issuesOf({ name: 'orders_import', targetObject: 'order', fieldMapping: [], mode: 'insert' })).toEqual([]);
  });

  it('`deletePolicy` accepts mark and ignore on either source, and has no schema default', () => {
    for (const deletePolicy of ['mark', 'ignore']) {
      expect(issuesOf({ ...legal, datasourceSource: { ...datasourceSource, deletePolicy } }), deletePolicy).toEqual([]);
      expect(issuesOf({ ...legal, connectorSource: { ...connectorSource, deletePolicy } }), deletePolicy).toEqual([]);
    }
    expect(issuesOf({ ...legal, datasourceSource: { ...datasourceSource, deletePolicy: 'purge' } })).not.toEqual([]);
    const parsed = MappingSchema.parse({ ...legal, datasourceSource, connectorSource: undefined });
    expect(parsed.datasourceSource).not.toHaveProperty('deletePolicy');
    const parsedConnector = MappingSchema.parse({ ...legal, connectorSource });
    expect(parsedConnector.connectorSource).not.toHaveProperty('deletePolicy');
  });

  it('the watermark needs a field and a start; a near-miss spelling is pointed at the key', () => {
    expect(issuesOf({ ...legal, datasourceSource: { object: 'erp_order', watermark: { field: 'updated_at' } } })).not.toEqual([]);
    const r = MappingSchema.safeParse({
      ...legal,
      datasourceSource: { object: 'erp_order', watermark: { timestampField: 'updated_at', start: 0 } },
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('`field`');
  });

  it('`paging` states the parameter its style needs, and `none` states none', () => {
    const paging = (p: Record<string, unknown>) => issuesOf({ ...legal, connectorSource: { ...connectorSource, paging: p } });
    // legal twins
    expect(paging({ style: 'none' })).toEqual([]);
    expect(paging({ style: 'page', param: 'page' })).toEqual([]);
    expect(paging({ style: 'offset', param: 'offset' })).toEqual([]);
    expect(paging({ style: 'cursor', param: 'after', nextPath: '$.next' })).toEqual([]);
    // refusals
    expect(paging({ style: 'none', param: 'page' })).not.toEqual([]);
    expect(paging({ style: 'none', nextPath: '$.next' })).not.toEqual([]);
    expect(paging({ style: 'page' })).not.toEqual([]);
    expect(paging({ style: 'cursor', param: 'after' })).not.toEqual([]);
    expect(paging({ style: 'scroll', param: 'x' })).not.toEqual([]);
  });

  it('a connector-side delete mode is refused and pointed at `deletePolicy`', () => {
    const r = MappingSchema.safeParse({ ...legal, datasourceSource: { ...datasourceSource, deleteMode: 'soft' } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('`deletePolicy`');
  });
});

describe('defineStack — the rules a sourced mapping needs the stack for (build)', () => {
  type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };
  const refusal = (stack: Record<string, unknown>): Envelope | null => {
    try {
      defineStack(stack as never);
      return null;
    } catch (e) {
      return e as Envelope;
    }
  };

  const warehouse = { name: 'warehouse', driver: 'sqlite', config: { filename: ':memory:' }, schemaMode: 'external', external: {} };
  const erpOrder = (extra: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) => ({
    name: 'erp_order',
    label: 'ERP order',
    sharingModel: 'private',
    datasource: 'warehouse',
    external: { remoteName: 'orders', columnMap: { order_no: 'id' } },
    fields: { updated_at: { type: 'datetime', label: 'Updated' }, ...fields },
    ...extra,
  });
  const order = (extra: Record<string, unknown> = {}) => ({
    name: 'order',
    label: 'Order',
    managedBy: 'synced',
    sharingModel: 'public_read',
    fields: { external_id: { type: 'text', label: 'External id' }, source_updated_at: { type: 'datetime', label: 'Source updated' } },
    ...extra,
  });
  const mapping = (ds: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    name: 'orders_sync',
    targetObject: 'order',
    mode: 'upsert',
    upsertKey: ['external_id'],
    fieldMapping: [
      { source: 'id', target: 'external_id' },
      { source: 'updated_at', target: 'source_updated_at' },
    ],
    datasourceSource: { object: 'erp_order', watermark: { field: 'updated_at', start: '2026-01-01T00:00:00Z' }, ...ds },
    ...extra,
  });
  const stack = (parts: { source?: unknown; target?: unknown; mapping?: unknown } = {}) => ({
    datasources: [warehouse],
    objects: [parts.source ?? erpOrder(), parts.target ?? order()],
    mappings: [parts.mapping ?? mapping()],
  });
  const single = (s: Record<string, unknown>): string => {
    const err = refusal(s);
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err?.status).toBe(422);
    expect(err?.issues).toHaveLength(1);
    return String(err!.issues![0]);
  };

  it('legal twin: a federated source, an exact key, a halvable watermark copied onto its type, a synced target', () => {
    expect(refusal(stack())).toBeNull();
  });

  it("the target is not managedBy: 'synced' — refused, for either source", () => {
    expect(single(stack({ target: order({ managedBy: undefined }) }))).toMatch(/not managedBy: 'synced' \(it is unset\)/);
    expect(single(stack({ target: order({ managedBy: 'engine-owned' }) }))).toContain("(it is 'engine-owned')");
    const viaConnector = mapping();
    delete (viaConnector as Record<string, unknown>).datasourceSource;
    (viaConnector as Record<string, unknown>).connectorSource = { connector: 'orders_api', action: 'request' };
    expect(single({ objects: [order({ managedBy: undefined })], mappings: [viaConnector] })).toContain('its connectorSource');
    expect(refusal({ objects: [order()], mappings: [viaConnector] })).toBeNull();
  });

  it('the source object is not one this stack declares', () => {
    expect(single(stack({ mapping: mapping({ object: 'erp_ordr' }) }))).toContain('which is not defined in objects');
  });

  it('the source object is not federated', () => {
    const managed = erpOrder({ external: undefined, datasource: undefined });
    expect(single(stack({ source: managed }))).toContain('is not federated');
  });

  it('source_key_missing — no remote column maps onto id', () => {
    const noKey = erpOrder({ external: { remoteName: 'orders', columnMap: { order_no: 'number' } } });
    expect(single(stack({ source: noKey }))).toContain('source_key_missing');
    const noMap = erpOrder({ external: { remoteName: 'orders' } });
    expect(single(stack({ source: noMap }))).toContain('source_key_missing');
  });

  it('source_key_not_exact — a fraction, an integer of no or too wide a precision, or a non-key type', () => {
    for (const id of [
      { type: 'number', label: 'Id' },
      { type: 'number', label: 'Id', scale: 0 },
      { type: 'number', label: 'Id', scale: 0, precision: 18 },
      { type: 'datetime', label: 'Id' },
    ]) {
      expect(single(stack({ source: erpOrder({}, { id }) })), JSON.stringify(id)).toContain('source_key_not_exact');
    }
  });

  it('legal twins of the key: a string id, or an integer of at most 15 digits', () => {
    expect(refusal(stack({ source: erpOrder({}, { id: { type: 'text', label: 'Id' } }) }))).toBeNull();
    expect(refusal(stack({ source: erpOrder({}, { id: { type: 'number', label: 'Id', scale: 0, precision: 15 } }) }))).toBeNull();
  });

  it('the watermark field is not a field of the source object', () => {
    expect(single(stack({ mapping: mapping({ watermark: { field: 'modified', start: 0 } }) }))).toContain('is not a field of the source object');
  });

  it('a watermark that cannot be halved — text, or a number with no scale: 0', () => {
    const text = erpOrder({}, { updated_at: { type: 'text', label: 'Updated' } });
    expect(single(stack({ source: text }))).toContain("of type 'text'");
    const fraction = erpOrder({}, { updated_at: { type: 'number', label: 'Updated' } });
    expect(single(stack({ source: fraction }))).toContain('does not declare scale: 0');
  });

  it('watermark_not_exact — an integer watermark of no or too wide a precision', () => {
    for (const precision of [undefined, 19]) {
      const src = erpOrder({}, { updated_at: { type: 'number', label: 'Version', scale: 0, precision } });
      const tgt = order({ fields: { ...order().fields, source_updated_at: { type: 'number', label: 'Version', scale: 0 } } });
      expect(single(stack({ source: src, target: tgt })), String(precision)).toContain('watermark_not_exact');
    }
  });

  it('legal twins of the watermark: a date, or an exact integer copied onto a number', () => {
    const date = erpOrder({}, { updated_at: { type: 'date', label: 'Updated' } });
    const dateTarget = order({ fields: { ...order().fields, source_updated_at: { type: 'date', label: 'Updated' } } });
    expect(refusal(stack({ source: date, target: dateTarget }))).toBeNull();
    const version = erpOrder({}, { updated_at: { type: 'number', label: 'Version', scale: 0, precision: 15 } });
    const versionTarget = order({ fields: { ...order().fields, source_updated_at: { type: 'number', label: 'Version' } } });
    expect(refusal(stack({ source: version, target: versionTarget }))).toBeNull();
  });

  it('watermark_field_unmapped — not copied, copied through a transform, or onto a field of another type', () => {
    const notCopied = mapping({}, { fieldMapping: [{ source: 'id', target: 'external_id' }] });
    expect(single(stack({ mapping: notCopied }))).toContain('watermark_field_unmapped');
    const transformed = mapping({}, {
      fieldMapping: [
        { source: 'id', target: 'external_id' },
        { source: 'updated_at', target: 'source_updated_at', transform: 'map', params: { valueMap: {} } },
      ],
    });
    expect(single(stack({ mapping: transformed }))).toContain('watermark_field_unmapped');
    const ontoText = mapping({}, {
      fieldMapping: [
        { source: 'id', target: 'external_id' },
        { source: 'updated_at', target: 'external_id' },
      ],
    });
    expect(single(stack({ mapping: ontoText }))).toContain('watermark_field_unmapped');
  });

  it('a job pull names a mapping with a datasourceSource — accepted (either source)', () => {
    const job = { name: 'orders_sync_hourly', schedule: { type: 'interval', intervalMs: 3_600_000 }, pull: { mapping: 'orders_sync' } };
    expect(refusal({ ...stack(), jobs: [job] })).toBeNull();
    const unsourced = mapping();
    delete (unsourced as Record<string, unknown>).datasourceSource;
    const err = refusal({ ...stack({ mapping: unsourced }), jobs: [job] });
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(String(err!.issues![0])).toContain('declares no source');
  });
});
