// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D3/D4, epic #31527 red line 2, #32905] The `/meta` history and
// rollback doors of a flow name two packages hold, on a booted showcase.
//
// A flow is stored per `(package, name)`: each holder has its own
// `sys_metadata` row, and the name's versions are numbered across them, so its
// change log interleaves every holder's versions. Before this card the doors
// read the name alone: the bare history listed both holders' versions as one
// item's timeline, `?package=` was refused as unknown, and the bare rollback
// wrote whichever version it was given into ONE holder's row — measured: a
// version of `beta.custom`'s flow restored, answered 200, into
// `alpha.custom`'s row. Now:
//
//  - naming no package, both doors refuse the two-holder name `409
//    RESOURCE_CONFLICT` naming each holder (`details.candidates`), and the
//    rollback writes nothing;
//  - `?package=` (the `/layers?package=` spelling) reads that holder's
//    versions alone and restores only that holder's row; a version of the
//    other holder is refused `404 VERSION_NOT_FOUND`, writing nothing; the
//    base package a pair customizes addresses its pair's declared override;
//    a package that holds nothing of the name is refused naming the holders;
//  - a version recorded before the history row named its package is never
//    guessed onto one of two holders: no address lists or restores it;
//  - CONTROL: a name one package holds keeps its whole log and its rollback
//    bare, an unattributed version included.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { defineStack } from '@objectstack/spec';
import { bootShowcase } from './showcase-boot.js';

const BOOT_TIMEOUT = 300_000;
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
const ALPHA = 'com.qa.hist32905.alpha';
const BETA = 'com.qa.hist32905.beta';
const ALPHA_PAIR = `${ALPHA}.custom`;
const BETA_PAIR = `${BETA}.custom`;
/** A runtime flow both pairs save (no package ships it). */
const SHARED = 'qa_hist_shared_32905';
/** A flow both packages ship, each customized in its own pair. */
const SHIPPED = 'qa_hist_shipped_32905';
/** A runtime flow only alpha's pair holds: the CONTROL. */
const SOLO = 'qa_hist_solo_32905';

const flowBody = (name: string, label: string) => ({
  name, label, type: 'autolaunched', status: 'active',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

function holderPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.hist32905.${p}`, namespace: `h32905${p}`, name: `qa_hist32905_${p}`, version: '1.0.0', type: 'app' },
    flows: [flowBody(SHIPPED, `${p} shipped`)],
  } as never);
}

describe('the /meta history and rollback doors of a flow name two packages hold (ADR-0150 D3/D4, #32905)', () => {
  let stack: VerifyStack;
  let admin: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(admin, method, path, body);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const codeOf = (json: any) => (json?.error && typeof json.error === 'object' ? json.error.code : undefined) ?? json?.code;
  const versions = (json: any): number[] => (json?.events ?? []).map((e: any) => e.version);
  const labelAt = async (name: string, pkg: string) => (await call('GET', `/meta/flow/${name}?package=${pkg}`)).json?.item?.label;
  const save = async (name: string, pkg: string, label: string, overrides?: string) => {
    const res = await call('PUT', `/meta/flow/${name}?package=${pkg}`,
      { ...flowBody(name, label), ...(overrides ? { overrides: { package: overrides, basedOn: '1.0.0' } } : {}) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.seq as number;
  };
  const candidatesOf = (json: any) =>
    (json?.details?.candidates ?? []).map((c: any) => c.packageId ?? c.kind).sort();

  /** The version each save wrote, by holder. */
  const shared: Record<string, number[]> = { [ALPHA_PAIR]: [], [BETA_PAIR]: [] };
  let legacy: number;

  beforeAll(async () => {
    stack = await bootShowcase({ extraPlugins: [new AppPlugin(holderPackage('alpha') as never), new AppPlugin(holderPackage('beta') as never)] });
    admin = await stack.signIn();
    for (const base of [ALPHA, BETA]) {
      expect([200, 201]).toContain((await call('POST', `/packages/${base}/ensure-customization`)).status);
    }
    for (const round of [1, 2]) {
      for (const pair of [ALPHA_PAIR, BETA_PAIR]) {
        await save(SHARED, pair, `${pair} r${round}`);
        const all = (await call('GET', `/meta/flow/${SHARED}/history?package=${pair}`)).json;
        shared[pair] = versions(all);
      }
    }
    await save(SHIPPED, ALPHA_PAIR, 'alpha custom r1', ALPHA);
    await save(SHIPPED, BETA_PAIR, 'beta custom r1', BETA);
    await save(SHIPPED, ALPHA_PAIR, 'alpha custom r2', ALPHA);
    await save(SOLO, ALPHA_PAIR, 'solo r1');
    await save(SOLO, ALPHA_PAIR, 'solo r2');
    // A version of SHARED recorded before the history row named its package
    // (a release before this card): `package_id` left NULL.
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const rows: any[] = await ql.find('sys_metadata_history', { where: { type: 'flow', name: SHARED }, context: SYSTEM_CTX });
    legacy = Math.max(...rows.map((r) => Number(r.version))) + 1;
    const seq = Math.max(...((await ql.find('sys_metadata_history', { where: {}, context: SYSTEM_CTX })) as any[]).map((r) => Number(r.event_seq ?? 0))) + 1;
    await ql.insert('sys_metadata_history', {
      id: `legacy_${SHARED}`, event_seq: seq, type: 'flow', name: SHARED, version: legacy, operation_type: 'update',
      metadata: JSON.stringify(flowBody(SHARED, 'legacy unattributed')), checksum: 'legacy', previous_checksum: null,
      source: 'qa.legacy', recorded_by: null, recorded_at: new Date().toISOString(),
    }, { context: SYSTEM_CTX });
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the bare history of the two-holder name is refused 409 naming both holders', async () => {
    const res = await call('GET', `/meta/flow/${SHARED}/history`);
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(codeOf(res.json)).toBe('RESOURCE_CONFLICT');
    expect(candidatesOf(res.json)).toEqual([ALPHA_PAIR, BETA_PAIR].sort());
  });

  it('the bare rollback of the two-holder name is refused 409 naming both, and neither holder\'s row changes', async () => {
    for (const toVersion of [shared[ALPHA_PAIR]![0]!, shared[BETA_PAIR]![0]!]) {
      const res = await call('POST', `/meta/flow/${SHARED}/rollback`, { toVersion });
      expect(res.status, JSON.stringify(res.json)).toBe(409);
      expect(codeOf(res.json)).toBe('RESOURCE_CONFLICT');
      expect(candidatesOf(res.json)).toEqual([ALPHA_PAIR, BETA_PAIR].sort());
    }
    expect(await labelAt(SHARED, ALPHA_PAIR)).toBe(`${ALPHA_PAIR} r2`);
    expect(await labelAt(SHARED, BETA_PAIR)).toBe(`${BETA_PAIR} r2`);
  });

  it('?package= reads that holder\'s versions alone, never the other\'s or an unattributed one', async () => {
    const alpha = versions((await call('GET', `/meta/flow/${SHARED}/history?package=${ALPHA_PAIR}`)).json);
    const beta = versions((await call('GET', `/meta/flow/${SHARED}/history?package=${BETA_PAIR}`)).json);
    expect(alpha).toHaveLength(2);
    expect(beta).toHaveLength(2);
    expect(alpha.some((v) => beta.includes(v))).toBe(false);
    expect([...alpha, ...beta]).not.toContain(legacy);
  });

  it('?package= restores only that holder\'s row; the other holder\'s version and an unattributed one are refused, writing nothing', async () => {
    const other = await call('POST', `/meta/flow/${SHARED}/rollback?package=${ALPHA_PAIR}`, { toVersion: shared[BETA_PAIR]![0]! });
    expect(other.status, JSON.stringify(other.json)).toBe(404);
    expect(codeOf(other.json)).toBe('VERSION_NOT_FOUND');
    const unattributed = await call('POST', `/meta/flow/${SHARED}/rollback?package=${BETA_PAIR}`, { toVersion: legacy });
    expect(unattributed.status, JSON.stringify(unattributed.json)).toBe(404);
    expect(codeOf(unattributed.json)).toBe('VERSION_NOT_FOUND');
    expect(await labelAt(SHARED, ALPHA_PAIR)).toBe(`${ALPHA_PAIR} r2`);
    expect(await labelAt(SHARED, BETA_PAIR)).toBe(`${BETA_PAIR} r2`);

    const own = await call('POST', `/meta/flow/${SHARED}/rollback?package=${ALPHA_PAIR}`, { toVersion: shared[ALPHA_PAIR]![0]! });
    expect(own.status, JSON.stringify(own.json)).toBe(200);
    expect(await labelAt(SHARED, ALPHA_PAIR)).toBe(`${ALPHA_PAIR} r1`);
    expect(await labelAt(SHARED, BETA_PAIR)).toBe(`${BETA_PAIR} r2`);
    // The restore is alpha's version, and only alpha's log grew.
    expect(versions((await call('GET', `/meta/flow/${SHARED}/history?package=${ALPHA_PAIR}`)).json)).toHaveLength(3);
    expect(versions((await call('GET', `/meta/flow/${SHARED}/history?package=${BETA_PAIR}`)).json)).toHaveLength(2);
  });

  it('the base package a pair customizes addresses its pair\'s declared override, at both doors', async () => {
    expect((await call('GET', `/meta/flow/${SHIPPED}/history`)).status).toBe(409);
    const alpha = versions((await call('GET', `/meta/flow/${SHIPPED}/history?package=${ALPHA}`)).json);
    expect(alpha).toEqual(versions((await call('GET', `/meta/flow/${SHIPPED}/history?package=${ALPHA_PAIR}`)).json));
    expect(alpha).toHaveLength(2);
    const res = await call('POST', `/meta/flow/${SHIPPED}/rollback?package=${ALPHA}`, { toVersion: alpha[0]! });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(await labelAt(SHIPPED, ALPHA_PAIR)).toBe('alpha custom r1');
    expect(await labelAt(SHIPPED, BETA_PAIR)).toBe('beta custom r1');
  });

  it('a package that holds nothing of the name is refused naming the holders', async () => {
    for (const path of [`/meta/flow/${SHARED}/history?package=com.qa.nobody`]) {
      const res = await call('GET', path);
      expect(res.status, JSON.stringify(res.json)).toBe(409);
      expect(candidatesOf(res.json)).toEqual([ALPHA_PAIR, BETA_PAIR].sort());
    }
    const res = await call('POST', `/meta/flow/${SHARED}/rollback?package=com.qa.nobody`, { toVersion: shared[ALPHA_PAIR]![0]! });
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(await labelAt(SHARED, ALPHA_PAIR)).toBe(`${ALPHA_PAIR} r1`);
  });

  it('CONTROL: a name one package holds keeps its whole log and its bare rollback, as before', async () => {
    const bare = versions((await call('GET', `/meta/flow/${SOLO}/history`)).json);
    expect(bare).toHaveLength(2);
    expect(versions((await call('GET', `/meta/flow/${SOLO}/history?package=${ALPHA_PAIR}`)).json)).toEqual(bare);
    const res = await call('POST', `/meta/flow/${SOLO}/rollback`, { toVersion: bare[0]! });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(await labelAt(SOLO, ALPHA_PAIR)).toBe('solo r1');
  });
});
