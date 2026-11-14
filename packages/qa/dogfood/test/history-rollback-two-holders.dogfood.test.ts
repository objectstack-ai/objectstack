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
//    bare, an unattributed version included, and so does a name first saved
//    as the environment's own item and later under a package (M1): its bare
//    rollback restores the environment's versions as `main` does;
//  - a name two packages ship, one of them customized or neither, is two
//    holders to the bare doors as it is to the bare plain read (ADR-0150 D5);
//  - `?package=` on a type not stored per package is refused 400, never
//    accepted and dropped; and a rollback naming no installed package, of a
//    name no row holds, is refused rather than minting a row for it.

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
/** A flow both packages ship, only alpha's pair customizes. */
const SHIPPED_ONE = 'qa_hist_shipped_one_32905';
/** A flow both packages ship and neither customizes: no stored row. */
const SHIPPED_NONE = 'qa_hist_shipped_none_32905';
/** A runtime flow saved as the environment's own item, deleted, then saved in alpha's pair (M1). */
const TAKEN_OVER = 'qa_hist_taken_over_32905';
/** A runtime flow alpha's pair saved and then deleted: no row holds it. */
const GONE = 'qa_hist_gone_32905';

const flowBody = (name: string, label: string) => ({
  name, label, type: 'autolaunched', status: 'active',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

function holderPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.hist32905.${p}`, namespace: `h32905${p}`, name: `qa_hist32905_${p}`, version: '1.0.0', type: 'app' },
    flows: [flowBody(SHIPPED, `${p} shipped`), flowBody(SHIPPED_ONE, `${p} shipped one`), flowBody(SHIPPED_NONE, `${p} shipped none`)],
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
  const save = async (name: string, pkg: string | undefined, label: string, overrides?: string) => {
    const res = await call('PUT', `/meta/flow/${name}${pkg ? `?package=${pkg}` : ''}`,
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
    await save(SHIPPED_ONE, ALPHA_PAIR, 'alpha one r1', ALPHA);
    await save(SHIPPED_ONE, ALPHA_PAIR, 'alpha one r2', ALPHA);
    await save(TAKEN_OVER, undefined, 'env r1');
    await save(TAKEN_OVER, undefined, 'env r2');
    const dropped = await call('DELETE', `/meta/flow/${TAKEN_OVER}`);
    expect(dropped.status, JSON.stringify(dropped.json)).toBe(200);
    await save(TAKEN_OVER, ALPHA_PAIR, 'alpha took over');
    await save(GONE, ALPHA_PAIR, 'gone r1');
    const gone = await call('DELETE', `/meta/flow/${GONE}?package=${ALPHA_PAIR}`);
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
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

  it('a name two packages ship, only one customized, is refused bare at both doors, as the bare plain read refuses it', async () => {
    const read = await call('GET', `/meta/flow/${SHIPPED_ONE}`);
    expect(read.status, JSON.stringify(read.json)).toBe(409);
    const history = await call('GET', `/meta/flow/${SHIPPED_ONE}/history`);
    expect(history.status, JSON.stringify(history.json)).toBe(409);
    expect(codeOf(history.json)).toBe('RESOURCE_CONFLICT');
    expect(candidatesOf(history.json)).toEqual(candidatesOf(read.json));
    const own = versions((await call('GET', `/meta/flow/${SHIPPED_ONE}/history?package=${ALPHA_PAIR}`)).json);
    expect(own).toHaveLength(2);
    const rollback = await call('POST', `/meta/flow/${SHIPPED_ONE}/rollback`, { toVersion: own[0]! });
    expect(rollback.status, JSON.stringify(rollback.json)).toBe(409);
    expect(codeOf(rollback.json)).toBe('RESOURCE_CONFLICT');
    expect(await labelAt(SHIPPED_ONE, ALPHA_PAIR)).toBe('alpha one r2');
  });

  it('a name two packages ship and neither customized, no row stored, is refused bare at both doors, as the bare plain read refuses it', async () => {
    const read = await call('GET', `/meta/flow/${SHIPPED_NONE}`);
    expect(read.status, JSON.stringify(read.json)).toBe(409);
    const history = await call('GET', `/meta/flow/${SHIPPED_NONE}/history`);
    expect(history.status, JSON.stringify(history.json)).toBe(409);
    expect(codeOf(history.json)).toBe('RESOURCE_CONFLICT');
    expect(candidatesOf(history.json)).toEqual(candidatesOf(read.json));
    const rollback = await call('POST', `/meta/flow/${SHIPPED_NONE}/rollback`, { toVersion: 1 });
    expect(rollback.status, JSON.stringify(rollback.json)).toBe(409);
    expect(codeOf(rollback.json)).toBe('RESOURCE_CONFLICT');
  });

  it('?package= on a type not stored per package is refused 400 at both doors, never accepted and dropped', async () => {
    const history = await call('GET', `/meta/view/qa_hist_any_view/history?package=${ALPHA}`);
    expect(history.status, JSON.stringify(history.json)).toBe(400);
    expect(codeOf(history.json)).toBe('VALIDATION_ERROR');
    const rollback = await call('POST', `/meta/view/qa_hist_any_view/rollback?package=${ALPHA}`, { toVersion: 1 });
    expect(rollback.status, JSON.stringify(rollback.json)).toBe(400);
    expect(codeOf(rollback.json)).toBe('VALIDATION_ERROR');
  });

  it('a rollback naming no installed package, of a name no row holds, is refused and stores nothing; an installed holder restores', async () => {
    const [first] = versions((await call('GET', `/meta/flow/${GONE}/history`)).json);
    expect(first, 'the deleted name keeps its log').toBeTypeOf('number');
    const stray = await call('POST', `/meta/flow/${GONE}/rollback?package=com.qa.hist32905.nope`, { toVersion: first! });
    expect(stray.status, JSON.stringify(stray.json)).toBe(422);
    expect(codeOf(stray.json)).toBe('WRITABLE_PACKAGE_REQUIRED');
    expect((await call('GET', `/meta/flow/${GONE}?package=com.qa.hist32905.nope`)).status).not.toBe(200);
    const own = await call('POST', `/meta/flow/${GONE}/rollback?package=${ALPHA_PAIR}`, { toVersion: first! });
    expect(own.status, JSON.stringify(own.json)).toBe(200);
    expect(await labelAt(GONE, ALPHA_PAIR)).toBe('gone r1');
  });

  it('CONTROL (M1): a name the environment saved and a package took over restores the environment\'s versions, bare and addressed, as before', async () => {
    const bare = versions((await call('GET', `/meta/flow/${TAKEN_OVER}/history`)).json);
    const [envFirst, envSecond] = bare;
    expect(bare.length, JSON.stringify(bare)).toBeGreaterThanOrEqual(3);
    const res = await call('POST', `/meta/flow/${TAKEN_OVER}/rollback`, { toVersion: envFirst! });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(await labelAt(TAKEN_OVER, ALPHA_PAIR)).toBe('env r1');
    expect(versions((await call('GET', `/meta/flow/${TAKEN_OVER}/history?package=${ALPHA_PAIR}`)).json)).toContain(envSecond);
    const addressed = await call('POST', `/meta/flow/${TAKEN_OVER}/rollback?package=${ALPHA_PAIR}`, { toVersion: envSecond! });
    expect(addressed.status, JSON.stringify(addressed.json)).toBe(200);
    expect(await labelAt(TAKEN_OVER, ALPHA_PAIR)).toBe('env r2');
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
