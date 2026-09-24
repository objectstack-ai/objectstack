// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of `sys_automation_run`, which used to point `nameField`
 * at `id` (#20015).
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. A renderer that honours that order therefore
 * showed the raw run id as the record page's H1, because the object declared
 * `nameField: 'id'` beside `titleFormat: '{flow_name} · {node_id}'`.
 *
 * The object now points at `display_title`, a text formula over the same
 * columns. This file asserts, through the real engine: the title field
 * ADR-0079's order resolves; the H1 a seeded row reads back with, in both the
 * node and the node-less shape; that the server-side title accessor agrees;
 * and that the formula adds no stored column.
 *
 * The pointer-pair verdict pin (`sys-automation-run-pointer-pair-verdict.test.ts`)
 * reads the same pointer for a different fact — that the title is not a key a
 * seed row could match.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, resolveRecordTitle } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveDisplayField } from '@objectstack/spec/data';
import { SysAutomationRun } from './sys-automation-run.object.js';

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
  const field = resolveDisplayField(SysAutomationRun as any);
  return field === undefined ? undefined : row[field];
}

/** The stored row as a hook body holds it: no formula value on it. */
function storedOnly(row: Record<string, unknown>): Record<string, unknown> {
  const { display_title: _omit, ...rest } = row;
  return rest;
}

describe('[#20015] sys_automation_run resolves a real record title under ADR-0079 order', () => {
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
    engine.registry.registerObject(SysAutomationRun as any, 'com.objectstack.test.20015');
    await engine.syncSchemas();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('points nameField at display_title, a text formula', () => {
    expect(resolveDisplayField(SysAutomationRun as any)).toBe('display_title');
    const field = (SysAutomationRun.fields as Record<string, any>).display_title;
    expect(field?.type).toBe('formula');
    expect(field?.returnType).toBe('text');
  });

  it('the H1 is "{flow_name} · {node_id}", not the run id', async () => {
    const created = await engine.insert('sys_automation_run', {
      flow_name: 'quote_approval', node_id: 'manager_gate', status: 'paused',
      started_at: new Date('2026-09-24T00:00:00Z'),
    }, SYS);
    const row = await engine.findOne('sys_automation_run', { where: { id: created.id } }, SYS);
    expect(row).not.toBeNull();

    expect(h1Of(row!)).toBe('quote_approval · manager_gate');
    expect(h1Of(row!)).not.toBe(row!.id);
    expect(h1Of(row!)).toBe(renderTitleFormat(SysAutomationRun.titleFormat as string, row!));
    expect(resolveRecordTitle(SysAutomationRun, storedOnly(row!))).toBe('quote_approval · manager_gate');
  });

  it('a run with no node is titled by its flow alone', async () => {
    const created = await engine.insert('sys_automation_run', {
      flow_name: 'nightly_sweep', status: 'completed',
      started_at: new Date('2026-09-24T00:00:00Z'),
    }, SYS);
    const row = await engine.findOne('sys_automation_run', { where: { id: created.id } }, SYS);
    expect(row!.node_id ?? null).toBeNull();

    expect(h1Of(row!)).toBe('nightly_sweep');
    expect(resolveRecordTitle(SysAutomationRun, storedOnly(row!))).toBe('nightly_sweep');
  });

  it('adds no stored column: the formula is computed on read', async () => {
    const columns = Object.keys(await driver.getKnex()('sys_automation_run').columnInfo());
    expect(columns).toContain('flow_name');
    expect(columns).not.toContain('display_title');
  });
});
