// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of the three approval objects that used to point
 * `nameField` at `id` (#20015).
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. A renderer that honours that order therefore
 * showed the raw id as the record page's H1 for `sys_approval_action`,
 * `sys_approval_approver` and `sys_approval_request`, because each of them
 * declared `nameField: 'id'` beside a composite `titleFormat`.
 *
 * Each object now points at `display_title`, a text formula over the same
 * columns. This file asserts, per object, through the real engine:
 *
 *  1. the title field ADR-0079's order resolves is `display_title`, not `id`;
 *  2. a seeded row read back through `findOne` carries the H1 the
 *     `titleFormat` intended, and that H1 is not the row's id;
 *  3. the server-side title accessor (`resolveRecordTitle`) agrees;
 *  4. the formula adds no stored column.
 *
 * Where a source column is nullable, a row without it is titled by the other
 * column rather than failing to evaluate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, resolveRecordTitle } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveDisplayField } from '@objectstack/spec/data';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';

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
function h1Of(schema: unknown, row: Record<string, unknown>): unknown {
  const field = resolveDisplayField(schema as any);
  return field === undefined ? undefined : row[field];
}

/** The stored row as a hook body holds it: no formula value on it. */
function storedOnly(row: Record<string, unknown>): Record<string, unknown> {
  const { display_title: _omit, ...rest } = row;
  return rest;
}

describe('[#20015] approval objects resolve a real record title under ADR-0079 order', () => {
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
    for (const o of [SysApprovalRequest, SysApprovalAction, SysApprovalApprover]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.20015');
    }
    await engine.syncSchemas();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('points all three objects at display_title, a text formula', () => {
    for (const schema of [SysApprovalRequest, SysApprovalAction, SysApprovalApprover]) {
      expect(resolveDisplayField(schema as any)).toBe('display_title');
      const field = (schema.fields as Record<string, any>).display_title;
      expect(field?.type).toBe('formula');
      expect(field?.returnType).toBe('text');
    }
  });

  it('sys_approval_request: the H1 is "{process_name} · {record_id}", not the id', async () => {
    const created = await engine.insert('sys_approval_request', {
      process_name: 'flow:deal_desk', object_name: 'opportunity', record_id: 'opp_42',
      status: 'pending',
    }, SYS);
    // The write response carries the title too (read-your-write).
    expect(created.display_title).toBe('flow:deal_desk · opp_42');
    const row = await engine.findOne('sys_approval_request', { where: { id: created.id } }, SYS);
    expect(row).not.toBeNull();

    expect(h1Of(SysApprovalRequest, row!)).toBe('flow:deal_desk · opp_42');
    expect(h1Of(SysApprovalRequest, row!)).not.toBe(row!.id);
    expect(h1Of(SysApprovalRequest, row!)).toBe(renderTitleFormat(SysApprovalRequest.titleFormat as string, row!));
    expect(resolveRecordTitle(SysApprovalRequest, storedOnly(row!))).toBe('flow:deal_desk · opp_42');
  });

  it('sys_approval_action: the H1 is "{action} · {step_name}", and the action alone without a step', async () => {
    const request = await engine.insert('sys_approval_request', {
      process_name: 'flow:deal_desk', object_name: 'opportunity', record_id: 'opp_43',
      status: 'pending',
    }, SYS);

    const stepped = await engine.insert('sys_approval_action', {
      request_id: request.id, action: 'approve', step_name: 'manager_review',
    }, SYS);
    const row = await engine.findOne('sys_approval_action', { where: { id: stepped.id } }, SYS);
    expect(h1Of(SysApprovalAction, row!)).toBe('approve · manager_review');
    expect(h1Of(SysApprovalAction, row!)).not.toBe(row!.id);
    expect(h1Of(SysApprovalAction, row!)).toBe(renderTitleFormat(SysApprovalAction.titleFormat as string, row!));
    expect(resolveRecordTitle(SysApprovalAction, storedOnly(row!))).toBe('approve · manager_review');

    const stepless = await engine.insert('sys_approval_action', {
      request_id: request.id, action: 'submit',
    }, SYS);
    const bare = await engine.findOne('sys_approval_action', { where: { id: stepless.id } }, SYS);
    expect(bare!.step_name ?? null).toBeNull();
    expect(h1Of(SysApprovalAction, bare!)).toBe('submit');
    expect(resolveRecordTitle(SysApprovalAction, storedOnly(bare!))).toBe('submit');
  });

  it('sys_approval_approver: the H1 is "{approver} · {request_id}", not the id', async () => {
    const request = await engine.insert('sys_approval_request', {
      process_name: 'flow:deal_desk', object_name: 'opportunity', record_id: 'opp_44',
      status: 'pending',
    }, SYS);
    const created = await engine.insert('sys_approval_approver', {
      request_id: request.id, approver: 'role:finance',
    }, SYS);
    const row = await engine.findOne('sys_approval_approver', { where: { id: created.id } }, SYS);

    expect(h1Of(SysApprovalApprover, row!)).toBe(`role:finance · ${request.id}`);
    expect(h1Of(SysApprovalApprover, row!)).not.toBe(row!.id);
    expect(h1Of(SysApprovalApprover, row!)).toBe(renderTitleFormat(SysApprovalApprover.titleFormat as string, row!));
    expect(resolveRecordTitle(SysApprovalApprover, storedOnly(row!))).toBe(`role:finance · ${request.id}`);
  });

  it('adds no stored column: the formula is computed on read', async () => {
    for (const [object, sourceColumn] of [
      ['sys_approval_request', 'process_name'],
      ['sys_approval_action', 'step_name'],
      ['sys_approval_approver', 'approver'],
    ] as const) {
      const columns = Object.keys(await driver.getKnex()(object).columnInfo());
      expect(columns).toContain(sourceColumn);
      expect(columns).not.toContain('display_title');
    }
  });
});
