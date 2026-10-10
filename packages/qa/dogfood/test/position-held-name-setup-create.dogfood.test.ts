// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3, ADR-0048 addendum N.2/N.3] Under `single`, a Setup create of a
// position — or a rename into a name — that a package or a built-in already
// holds answers the metadata door's own refusal, `403 NOT_OVERRIDABLE`,
// through the data door: over the real showcase composition, over HTTP.
//
// ## Why an HTTP pin
//
// The refusal is pinned in `plugin-security`'s unit harness
// (`position-write-through.test.ts`), against the real metadata door but
// below the HTTP layer. What a Setup page receives is what the REST layer
// makes of that refusal — the status, the code, and whether the row the
// write-through wrote first is really undone — so this file asks the
// composed runtime, as an administrator's session does.
//
// ## What the pins hold
//
//  - precondition: the single posture; the showcase package holds `manager`,
//    and the metadata door refuses a save of it with `403 NOT_OVERRIDABLE`;
//  - `POST /api/v1/data/sys_position` under that name, and under the built-in
//    audience anchor `everyone`, answers the door's status and code, and
//    leaves the name's rows exactly as they were, with no environment
//    definition written;
//  - a rename into a held name answers the same, and the renamed row keeps
//    its old name and its definition;
//  - control: a create under a free name answers 201.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SYS = { context: { isSystem: true } } as const;
/** The metadata door's envelope for a save over a name a package or a built-in holds. */
const DOOR_REFUSAL = { status: 403, code: 'NOT_OVERRIDABLE' };
/** A position the showcase package declares. */
const HELD = 'manager';
/** The built-in audience anchor. */
const ANCHOR = 'everyone';

describe('[ADR-0131 D3] a Setup create or rename into a held position name answers the metadata door\'s refusal over HTTP (showcase)', () => {
  let dir: string;
  let stack: VerifyStack | undefined;
  let token: string;
  let ql: any;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack!.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, code: json?.code ?? json?.error?.code ?? null, json };
  };
  const outcome = (r: { status: number; code: unknown }) => ({ status: r.status, code: r.code });
  const rowIds = async (name: string) =>
    ((await ql.find('sys_position', { where: { name }, limit: 10 }, SYS)) as any[]).map((r) => r.id).sort();
  const envRows = async (name: string) =>
    ((await ql.find('sys_metadata', { where: { type: 'position', name }, limit: 10 }, SYS)) as any[])
      .map((r) => ({ organization_id: r.organization_id ?? null, state: r.state }));

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-held-position-'));
    stack = await bootShowcase({ databaseFile: join(dir, 'showcase.db') });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('PRECONDITION: single posture; the showcase package holds the name, and the metadata door refuses a save of it', async () => {
    expect(stack!.tenancy().requestedPosture).toBe('single');
    expect((ql.registry.getArtifactItem('position', HELD) as any)?._packageId).toBe('com.example.showcase');
    expect(await rowIds(HELD), 'the seeded row').toHaveLength(1);
    const put = await call('PUT', `/meta/position/${HELD}`, { name: HELD, label: 'Mine' });
    expect(outcome(put), JSON.stringify(put.json)).toEqual(DOOR_REFUSAL);
  });

  it.each([
    ['a package declares', HELD],
    ['the platform declares as an audience anchor', ANCHOR],
  ])('a create under a name %s answers the door\'s refusal and keeps no row and no definition', async (_holder, name) => {
    const before = await rowIds(name);
    const created = await call('POST', '/data/sys_position', { name, label: 'Mine' });
    expect(outcome(created), JSON.stringify(created.json)).toEqual(DOOR_REFUSAL);
    expect(await rowIds(name), 'the row the write-through wrote first was undone').toEqual(before);
    expect(await envRows(name)).toEqual([]);
  });

  it('a rename into a held name answers the same; the row keeps its name and its definition', async () => {
    const created = await call('POST', '/data/sys_position', { name: 'held_e2_lane_lead', label: 'Lane lead' });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const [id] = await rowIds('held_e2_lane_lead');
    const renamed = await call('PATCH', `/data/sys_position/${id}`, { name: HELD });
    expect(outcome(renamed), JSON.stringify(renamed.json)).toEqual(DOOR_REFUSAL);
    expect(await rowIds('held_e2_lane_lead')).toEqual([id]);
    expect(await envRows('held_e2_lane_lead')).toEqual([{ organization_id: null, state: 'active' }]);
    expect(await envRows(HELD)).toEqual([]);
  });
});
