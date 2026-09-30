// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `mapping.connectorSource` — the target-side pull binding.
 *
 * Connector-attached sync was ruled ENFORCE on the maintainer's criterion for a
 * declared-but-unenforced family, with the definition MOVED off the connector
 * (`connector.syncConfig` / `connector.fieldMappings` are tombstones now —
 * `integration/connector-sync-retirement.test.ts`) and onto its target, where
 * the mainstream binds it: this mapping already names the object it writes, its
 * field map, its write mode and its match key; `connectorSource` adds only where
 * the rows come from. Version 1 is a one-way pull, full or
 * timestamp-incremental, from a `rest` / `openapi` connector instance.
 *
 * What is pinned here is the CONTRACT this stage lands — the shape, its closed
 * door and the keys it deliberately does not carry. The pull executor is the
 * next stage; until it reads the binding the ledger rows are `planned` with
 * `authorWarn` (`liveness/mapping.json`), which the last block pins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MappingSchema, type Mapping } from './mapping.zod';

const BASE = {
  name: 'orders_pull',
  targetObject: 'order',
  fieldMapping: [{ source: 'id', target: 'external_id' }],
  mode: 'upsert',
  upsertKey: ['external_id'],
} as const;

const FULL_PULL = {
  connector: 'orders_api',
  action: 'request',
  input: { method: 'GET', path: '/orders' },
  recordsPath: 'body.items',
} as const;

const INCREMENTAL_PULL = {
  ...FULL_PULL,
  watermark: { field: 'updated_at', param: 'updated_since' },
} as const;

function issues(input: unknown) {
  const result = MappingSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
}

describe('mapping.connectorSource — the shape', () => {
  it('a mapping without a source binding is unchanged — the import door keeps working as before', () => {
    const parsed = MappingSchema.parse(BASE);
    expect(parsed).not.toHaveProperty('connectorSource');
    // CONTROL: the live defaults still apply.
    expect(parsed.sourceFormat).toBe('csv');
  });

  it('accepts a full pull and a timestamp-incremental pull, byte-for-byte', () => {
    for (const source of [FULL_PULL, INCREMENTAL_PULL]) {
      const parsed = MappingSchema.parse({ ...BASE, connectorSource: source });
      expect(parsed.connectorSource).toEqual(source);
    }
  });

  it('the minimum is a connector and a read action — `input`, `recordsPath` and `watermark` are optional', () => {
    const parsed = MappingSchema.parse({ ...BASE, connectorSource: { connector: 'orders_api', action: 'list_orders' } });
    expect(parsed.connectorSource).toEqual({ connector: 'orders_api', action: 'list_orders' });
    // No default materializes on the binding: every key present is one the
    // author wrote, which is what keeps the ledger's `authorWarn` truthful.
    expect(Object.keys(parsed.connectorSource!)).toEqual(['connector', 'action']);
  });

  it('refuses a binding missing its connector or its action, at the named path', () => {
    expect(issues({ ...BASE, connectorSource: { action: 'request' } }).map((i) => i.path)).toEqual(['connectorSource.connector']);
    expect(issues({ ...BASE, connectorSource: { connector: 'orders_api' } }).map((i) => i.path)).toEqual(['connectorSource.action']);
    expect(issues({ ...BASE, connectorSource: { connector: 'orders_api', action: '' } }).map((i) => i.path)).toEqual(['connectorSource.action']);
  });

  it('`connector` takes a connector NAME — the connector schema\'s own spelling, and nothing else', () => {
    // Same pattern as `ConnectorSchema.name`, so every legal connector is
    // nameable and nothing illegal is.
    expect(issues({ ...BASE, connectorSource: { ...FULL_PULL, connector: '_legacy_erp' } })).toEqual([]);
    expect(issues({ ...BASE, connectorSource: { ...FULL_PULL, connector: 'Orders-API' } }).map((i) => i.path))
      .toEqual(['connectorSource.connector']);
  });

  it('a watermark needs BOTH its halves — the record field it reads and the request parameter it sends', () => {
    expect(issues({ ...BASE, connectorSource: { ...FULL_PULL, watermark: { field: 'updated_at' } } }).map((i) => i.path))
      .toEqual(['connectorSource.watermark.param']);
    expect(issues({ ...BASE, connectorSource: { ...FULL_PULL, watermark: { param: 'since' } } }).map((i) => i.path))
      .toEqual(['connectorSource.watermark.field']);
  });

  it('compiles as the author shape: `Mapping` takes the binding with nothing defaulted', () => {
    // Written out rather than spread from the `as const` fixtures: a readonly
    // tuple is not the author's array type, and this case is about the binding.
    const mapping: Mapping = {
      name: 'orders_pull',
      targetObject: 'order',
      fieldMapping: [{ source: 'id', target: 'external_id' }],
      connectorSource: {
        connector: 'orders_api',
        action: 'request',
        watermark: { field: 'updated_at', param: 'updated_since' },
      },
    };
    expect(MappingSchema.safeParse(mapping).success).toBe(true);
    const wrong: Mapping = {
      name: 'orders_pull',
      targetObject: 'order',
      fieldMapping: [{ source: 'id', target: 'external_id' }],
      // @ts-expect-error — `schedule` is not a key of the binding: a `job` owns the cadence.
      connectorSource: { connector: 'orders_api', action: 'request', schedule: '0 6 * * *' },
    };
    expect(MappingSchema.safeParse(wrong).success).toBe(false);
  });
});

describe('mapping.connectorSource — the closed door and what it does not carry', () => {
  // The binding is a `strictObject`: an unknown key THROWS with a prescription
  // rather than being dropped. Its guidance table exists because the retired
  // connector-side vocabulary must land on an answer here, never on a "did you
  // mean" pointing at a neighbouring key that does something else.
  const refusal = (key: string, value: unknown = 'x') => {
    const found = issues({ ...BASE, connectorSource: { ...FULL_PULL, [key]: value } });
    expect(found, `${key} must be refused`).toHaveLength(1);
    expect(found[0]!.path).toBe('connectorSource');
    expect(found[0]!.code).toBe('unrecognized_keys');
    return found[0]!.message;
  };

  it('a cadence key is refused and pointed at a `job` — no schedule key returns', () => {
    for (const key of ['schedule', 'cron', 'interval']) {
      const message = refusal(key, '0 6 * * *');
      expect(message, key).toContain('`job`');
      expect(message, key).toContain('`Job.schedule`');
    }
  });

  it('the retired policy keys are refused and say version 1 has no such policy', () => {
    for (const key of ['deleteMode', 'conflictResolution', 'direction']) {
      const message = refusal(key, 'soft_delete');
      expect(message, key).toContain('one-way pull');
      expect(message, key).toContain('`upsertKey`');
    }
    expect(refusal('strategy', 'incremental')).toContain('`watermark`');
  });

  it('a credential is refused and pointed at the connector instance', () => {
    for (const key of ['auth', 'credentialRef']) {
      const message = refusal(key, 'ERP_TOKEN');
      expect(message, key).toContain('connector instance holds the credential');
    }
  });

  it('a near-miss spelling is steered to the declared key', () => {
    expect(refusal('operationId', 'listOrders')).toContain('action');
    expect(refusal('itemsPath', 'body.items')).toContain('recordsPath');
    const cursor = issues({ ...BASE, connectorSource: { ...FULL_PULL, cursor: { field: 'updated_at', param: 'since' } } });
    expect(cursor[0]!.message).toContain('watermark');
  });

  it('the connector-side keys are not smuggled in at the mapping\'s top level either', () => {
    // `syncConfig` has no meaning on a mapping; the strict top level refuses it
    // rather than dropping it. (`fieldMappings` is the one exception: it is a
    // long-standing alias of `fieldMapping` on this type, and stays one.)
    const found = issues({ ...BASE, syncConfig: { strategy: 'full' } });
    expect(found.map((i) => [i.path, i.code])).toEqual([['', 'unrecognized_keys']]);
  });
});

describe('mapping.connectorSource — declared, not executed: the ledger says so', () => {
  const LEDGER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../liveness/mapping.json');

  it('every key of the binding is `planned`, and the container warns the author', () => {
    const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) as {
      props: Record<string, { status: string; authorWarn?: boolean; children?: Record<string, { status: string; children?: Record<string, { status: string }> }> }>;
    };
    const row = ledger.props.connectorSource;
    expect(row, 'connectorSource must have a ledger row').toBeDefined();
    expect(row!.status).toBe('planned');
    expect(row!.authorWarn).toBe(true);
    const children = row!.children!;
    expect(Object.keys(children).sort()).toEqual(['action', 'connector', 'input', 'recordsPath', 'watermark']);
    for (const [key, child] of Object.entries(children)) expect(child.status, key).toBe('planned');
    expect(Object.keys(children.watermark!.children!).sort()).toEqual(['field', 'param']);
    // CONTROL: the executed target half of the same type is live — the
    // `planned` above is a statement about the binding, not about the type.
    for (const key of ['targetObject', 'fieldMapping', 'mode', 'upsertKey']) {
      expect(ledger.props[key]!.status, key).toBe('live');
    }
  });

  it('the schema says it too, where an author reads it', () => {
    const shape = (MappingSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    expect(shape.connectorSource!.description).toContain('the pull is not executed yet');
  });
});
