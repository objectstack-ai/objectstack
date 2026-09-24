// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of `sys_http_delivery`, which used to point `nameField` at
 * `id` (#20015).
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. A renderer that honours that order therefore
 * showed the raw delivery UUID as the record page's H1, because the object
 * declared `nameField: 'id'` beside `titleFormat: '{label} → {url}'`.
 *
 * The object now points at `display_title`, a text formula over the same
 * columns. This file asserts, through the real engine: the title field
 * ADR-0079's order resolves; the H1 a seeded row reads back with, in both the
 * labelled and the label-less shape; that the server-side title accessor
 * agrees; and that the formula adds no stored column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, resolveRecordTitle } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveDisplayField } from '@objectstack/spec/data';
import { HttpDelivery } from './http-delivery.object.js';

const SYS = { context: { isSystem: true } } as any;

/**
 * The H1 a `titleFormat`-first renderer draws: each `{field}` placeholder
 * substituted with the row's value. It is the reference the formula has to
 * reproduce, not a second title resolver.
 */
function renderTitleFormat(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key: string) => String(row[key] ?? ''));
}

/** The H1 under ADR-0079's order: the value at the resolved title field. */
function h1Of(row: Record<string, unknown>): unknown {
  const field = resolveDisplayField(HttpDelivery as any);
  return field === undefined ? undefined : row[field];
}

/** The stored row as a hook body holds it: no formula value on it. */
function storedOnly(row: Record<string, unknown>): Record<string, unknown> {
  const { display_title: _omit, ...rest } = row;
  return rest;
}

/** Every column the object requires, so each case names only what it varies. */
function delivery(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = new Date('2026-09-24T00:00:00Z');
  return {
    source: 'webhook', ref_id: 'wh_1', dedup_key: `evt_${Math.random().toString(36).slice(2)}`,
    url: 'https://hooks.example.com/in', payload_json: '{}', partition_key: 0,
    status: 'pending', attempts: 0, created_at: now, updated_at: now,
    ...overrides,
  };
}

describe('[#20015] sys_http_delivery resolves a real record title under ADR-0079 order', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;

  beforeAll(async () => {
    engine = new ObjectQL();
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(HttpDelivery as any, 'com.objectstack.test.20015');
    await engine.syncSchemas();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('points nameField at display_title, a text formula', () => {
    expect(resolveDisplayField(HttpDelivery as any)).toBe('display_title');
    const field = (HttpDelivery.fields as Record<string, any>).display_title;
    expect(field?.type).toBe('formula');
    expect(field?.returnType).toBe('text');
  });

  it('the H1 is "{label} → {url}", not the delivery UUID', async () => {
    const created = await engine.insert('sys_http_delivery', delivery({ label: 'order.created' }), SYS);
    const row = await engine.findOne('sys_http_delivery', { where: { id: created.id } }, SYS);
    expect(row).not.toBeNull();

    expect(h1Of(row!)).toBe('order.created → https://hooks.example.com/in');
    expect(h1Of(row!)).not.toBe(row!.id);
    expect(h1Of(row!)).toBe(renderTitleFormat(HttpDelivery.titleFormat as string, row!));
    expect(resolveRecordTitle(HttpDelivery, storedOnly(row!))).toBe('order.created → https://hooks.example.com/in');
  });

  it('a delivery with no label is titled by its target URL alone', async () => {
    const created = await engine.insert('sys_http_delivery', delivery({}), SYS);
    const row = await engine.findOne('sys_http_delivery', { where: { id: created.id } }, SYS);
    expect(row!.label ?? null).toBeNull();

    expect(h1Of(row!)).toBe('https://hooks.example.com/in');
    expect(resolveRecordTitle(HttpDelivery, storedOnly(row!))).toBe('https://hooks.example.com/in');
  });

  it('adds no stored column: the formula is computed on read', async () => {
    const columns = Object.keys(await driver.getKnex()('sys_http_delivery').columnInfo());
    expect(columns).toContain('url');
    expect(columns).not.toContain('display_title');
  });
});
