// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D3/D4, #33308] The `/meta` diff door of a flow name two packages
// hold, on a booted showcase — the third door of the family whose history and
// rollback doors `history-rollback-two-holders.dogfood.test.ts` pins.
//
// A flow is stored per `(package, name)`: each holder has its own
// `sys_metadata` row, and the name's versions are numbered across them. Before
// this card the diff door read the name alone: measured, the bare
// `diff?from=<alpha's v1>&to=<beta's v1>` answered 200, one holder's body
// compared against the other's as if one item's, and `?package=` was refused
// as an unknown parameter. Now it reads the slot the history and rollback
// doors read (`historySlotOf`):
//
//  - naming no package, the two-holder name is refused `409 RESOURCE_CONFLICT`
//    naming each holder (`details.candidates`), the default range and a named
//    one alike, and so is a name the bare plain read refuses (two packages
//    ship it, one customized);
//  - `?package=` compares that holder's versions alone: its own active row as
//    the default `to` side, its own nearest earlier differing version as the
//    default `from` side; a version of the other holder, or one recorded
//    before the history row named its package, is refused `404
//    VERSION_NOT_FOUND`, comparing nothing;
//  - CONTROL: a name one package holds diffs bare as before, and so does a
//    name first saved as the environment's own item and later taken over by a
//    package (M1): the environment's versions are its sole slot's;
//  - `?package=` naming a package that neither holds nor ships the name is
//    refused `409` naming the holders, in the protocol's order with their
//    `kind` at the wire; the environment's slot addressed through a package
//    (the read falls back to the package-less row) compares that row's
//    versions alone, its own active row the `to` side;
//  - `?package=` on a type not stored per package is refused 400, never
//    accepted and dropped.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { defineStack } from '@objectstack/spec';
import { bootShowcase } from './showcase-boot.js';

const BOOT_TIMEOUT = 300_000;
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
const ALPHA = 'com.qa.diff33308.alpha';
const BETA = 'com.qa.diff33308.beta';
const ALPHA_PAIR = `${ALPHA}.custom`;
const BETA_PAIR = `${BETA}.custom`;
/** A runtime flow both pairs save (no package ships it). */
const SHARED = 'qa_diff_shared_33308';
/** A runtime flow only alpha's pair holds: the CONTROL. */
const SOLO = 'qa_diff_solo_33308';
/** A flow both packages ship, only alpha's pair customizes. */
const SHIPPED_ONE = 'qa_diff_shipped_one_33308';
/** A runtime flow saved as the environment's own item, deleted, then saved in alpha's pair (M1). */
const TAKEN_OVER = 'qa_diff_taken_over_33308';
/** A runtime flow saved as the environment's own item, then saved in alpha's pair beside it: two row slots, one of them the environment's. */
const ENV_BESIDE = 'qa_diff_env_beside_33308';

const flowBody = (name: string, label: string) => ({
  name, label, type: 'autolaunched', status: 'active',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

function holderPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.diff33308.${p}`, namespace: `d33308${p}`, name: `qa_diff33308_${p}`, version: '1.0.0', type: 'app' },
    flows: [flowBody(SHIPPED_ONE, `${p} shipped one`)],
  } as never);
}

describe('the /meta diff door of a flow name two packages hold (ADR-0150 D3/D4, #33308)', () => {
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
  };
  const candidatesOf = (json: any) =>
    (json?.details?.candidates ?? []).map((c: any) => c.packageId ?? c.kind).sort();
  /** The holders as the wire lists them: order and `kind` kept. */
  const holdersOf = (json: any) =>
    (json?.details?.candidates ?? []).map((c: any) => (c.kind === 'package' ? { kind: c.kind, packageId: c.packageId } : { kind: c.kind }));
  const diffLabel = (json: any) => (json?.changed ?? []).find((e: any) => e.path === 'label');
  const ownVersions = async (name: string, pkg: string) =>
    versions((await call('GET', `/meta/flow/${name}/history?package=${pkg}`)).json);

  /** The versions each holder's saves wrote, read back from the history door. */
  const shared: Record<string, number[]> = { [ALPHA_PAIR]: [], [BETA_PAIR]: [] };
  let legacy: number;

  beforeAll(async () => {
    stack = await bootShowcase({ extraPlugins: [new AppPlugin(holderPackage('alpha') as never), new AppPlugin(holderPackage('beta') as never)] });
    admin = await stack.signIn();
    for (const base of [ALPHA, BETA]) {
      expect([200, 201]).toContain((await call('POST', `/packages/${base}/ensure-customization`)).status);
    }
    // Interleaved: alpha r1, beta r1, alpha r2, beta r2.
    for (const round of [1, 2]) {
      for (const pair of [ALPHA_PAIR, BETA_PAIR]) await save(SHARED, pair, `${pair} r${round}`);
    }
    for (const pair of [ALPHA_PAIR, BETA_PAIR]) shared[pair] = await ownVersions(SHARED, pair);
    await save(SOLO, ALPHA_PAIR, 'solo r1');
    await save(SOLO, ALPHA_PAIR, 'solo r2');
    await save(SHIPPED_ONE, ALPHA_PAIR, 'alpha one r1', ALPHA);
    await save(TAKEN_OVER, undefined, 'env r1');
    await save(TAKEN_OVER, undefined, 'env r2');
    const dropped = await call('DELETE', `/meta/flow/${TAKEN_OVER}`);
    expect(dropped.status, JSON.stringify(dropped.json)).toBe(200);
    await save(TAKEN_OVER, ALPHA_PAIR, 'alpha took over');
    await save(ENV_BESIDE, undefined, 'env beside r1');
    await save(ENV_BESIDE, undefined, 'env beside r2');
    await save(ENV_BESIDE, ALPHA_PAIR, 'alpha beside r1');
    // A version of SHARED recorded before the history row named its package
    // (a release before ADR-0150 D4's attribution): `package_id` left NULL.
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

  it('the bare diff of the two-holder name is refused 409 naming both holders, the default range and a named one alike', async () => {
    expect(shared[ALPHA_PAIR]).toHaveLength(2);
    expect(shared[BETA_PAIR]).toHaveLength(2);
    for (const path of [
      `/meta/flow/${SHARED}/diff`,
      `/meta/flow/${SHARED}/diff?from=${shared[ALPHA_PAIR]![0]}&to=${shared[BETA_PAIR]![0]}`,
    ]) {
      const res = await call('GET', path);
      expect(res.status, `${path}: ${JSON.stringify(res.json)}`).toBe(409);
      expect(codeOf(res.json)).toBe('RESOURCE_CONFLICT');
      expect(candidatesOf(res.json)).toEqual([ALPHA_PAIR, BETA_PAIR].sort());
      // At the wire: every bound package in the protocol's order, each with its `kind`.
      expect(holdersOf(res.json), path).toEqual([
        { kind: 'package', packageId: ALPHA_PAIR },
        { kind: 'package', packageId: BETA_PAIR },
      ]);
    }
  });

  it('a package that neither holds nor ships the name is refused 409 at the diff door, naming the holders, comparing nothing', async () => {
    const res = await call('GET', `/meta/flow/${SHARED}/diff?package=${ALPHA}`);
    expect(res.status, JSON.stringify(res.json)).toBe(409);
    expect(codeOf(res.json)).toBe('RESOURCE_CONFLICT');
    expect(holdersOf(res.json)).toEqual([
      { kind: 'package', packageId: ALPHA_PAIR },
      { kind: 'package', packageId: BETA_PAIR },
    ]);
    expect(res.json.fromVersion).toBeUndefined();
    expect(res.json.changed).toBeUndefined();
  });

  it('the environment\'s slot addressed through a package: the package-less row\'s versions alone, its own active row the to side', async () => {
    const bare = await call('GET', `/meta/flow/${ENV_BESIDE}/diff`);
    expect(bare.status, JSON.stringify(bare.json)).toBe(409);
    // The bound package first, then the environment's own row.
    expect(holdersOf(bare.json)).toEqual([{ kind: 'package', packageId: ALPHA_PAIR }, { kind: 'environment' }]);
    // A read naming beta's pair (no row of the name, nothing shipped) falls back to the package-less row.
    const env = await ownVersions(ENV_BESIDE, BETA_PAIR);
    expect(env).toHaveLength(2);
    const res = await call('GET', `/meta/flow/${ENV_BESIDE}/diff?package=${BETA_PAIR}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect([res.json.fromVersion, res.json.toVersion]).toEqual(env);
    expect(diffLabel(res.json)).toEqual({ path: 'label', from: 'env beside r1', to: 'env beside r2' });
    // Alpha's own slot beside it: its one version, no earlier one of its own.
    const [alphaOnly] = await ownVersions(ENV_BESIDE, ALPHA_PAIR);
    const alpha = await call('GET', `/meta/flow/${ENV_BESIDE}/diff?package=${ALPHA_PAIR}`);
    expect(alpha.status, JSON.stringify(alpha.json)).toBe(200);
    expect([alpha.json.fromVersion, alpha.json.toVersion]).toEqual([null, alphaOnly]);
  });

  it('a name two packages ship, one customized, is refused bare at the diff door as the bare plain read refuses it', async () => {
    const read = await call('GET', `/meta/flow/${SHIPPED_ONE}`);
    expect(read.status, JSON.stringify(read.json)).toBe(409);
    const diff = await call('GET', `/meta/flow/${SHIPPED_ONE}/diff`);
    expect(diff.status, JSON.stringify(diff.json)).toBe(409);
    expect(codeOf(diff.json)).toBe('RESOURCE_CONFLICT');
    expect(candidatesOf(diff.json)).toEqual(candidatesOf(read.json));
  });

  it('?package= diffs that holder\'s versions alone: its own active row against its own nearest earlier version', async () => {
    for (const pair of [ALPHA_PAIR, BETA_PAIR]) {
      const own = shared[pair]!;
      const res = await call('GET', `/meta/flow/${SHARED}/diff?package=${pair}`);
      expect(res.status, `${pair}: ${JSON.stringify(res.json)}`).toBe(200);
      expect([res.json.fromVersion, res.json.toVersion], pair).toEqual(own);
      expect(diffLabel(res.json), pair).toEqual({ path: 'label', from: `${pair} r1`, to: `${pair} r2` });
      expect(await labelAt(SHARED, pair)).toBe(`${pair} r2`);
    }
    const [from, to] = shared[ALPHA_PAIR]!;
    const named = await call('GET', `/meta/flow/${SHARED}/diff?package=${ALPHA_PAIR}&from=${from}&to=${to}`);
    expect(named.status, JSON.stringify(named.json)).toBe(200);
    expect([named.json.fromVersion, named.json.toVersion]).toEqual([from, to]);
    expect(diffLabel(named.json)).toEqual({ path: 'label', from: `${ALPHA_PAIR} r1`, to: `${ALPHA_PAIR} r2` });
  });

  it('?package= refuses another holder\'s version, and an unattributed one, 404, comparing nothing', async () => {
    const [alphaFirst] = shared[ALPHA_PAIR]!;
    const [betaFirst] = shared[BETA_PAIR]!;
    for (const query of [`from=${betaFirst}&to=${alphaFirst}`, `to=${betaFirst}`]) {
      const res = await call('GET', `/meta/flow/${SHARED}/diff?package=${ALPHA_PAIR}&${query}`);
      expect(res.status, `${query}: ${JSON.stringify(res.json)}`).toBe(404);
      expect(codeOf(res.json)).toBe('VERSION_NOT_FOUND');
      expect(JSON.stringify(res.json), 'names whose version it is').toContain(BETA_PAIR);
    }
    const unattributed = await call('GET', `/meta/flow/${SHARED}/diff?package=${BETA_PAIR}&from=${legacy}`);
    expect(unattributed.status, JSON.stringify(unattributed.json)).toBe(404);
    expect(codeOf(unattributed.json)).toBe('VERSION_NOT_FOUND');
  });

  it('CONTROL: a name one holder holds diffs bare as before, and ?package= of its holder answers the same', async () => {
    const bare = versions((await call('GET', `/meta/flow/${SOLO}/history`)).json);
    expect(bare).toHaveLength(2);
    const named = await call('GET', `/meta/flow/${SOLO}/diff?from=${bare[0]}&to=${bare[1]}`);
    expect(named.status, JSON.stringify(named.json)).toBe(200);
    expect(diffLabel(named.json)).toEqual({ path: 'label', from: 'solo r1', to: 'solo r2' });
    const range = await call('GET', `/meta/flow/${SOLO}/diff`);
    expect(range.status, JSON.stringify(range.json)).toBe(200);
    expect([range.json.fromVersion, range.json.toVersion]).toEqual(bare);
    expect((await call('GET', `/meta/flow/${SOLO}/diff?package=${ALPHA_PAIR}`)).json).toEqual(range.json);
  });

  it('CONTROL (M1): the environment\'s versions of a name a package took over diff bare, as before', async () => {
    const [envFirst, envSecond] = versions((await call('GET', `/meta/flow/${TAKEN_OVER}/history`)).json);
    const env = await call('GET', `/meta/flow/${TAKEN_OVER}/diff?from=${envFirst}&to=${envSecond}`);
    expect(env.status, JSON.stringify(env.json)).toBe(200);
    expect(diffLabel(env.json)).toEqual({ path: 'label', from: 'env r1', to: 'env r2' });
  });

  it('?package= on a type not stored per package is refused 400 at the diff door, never accepted and dropped', async () => {
    const res = await call('GET', `/meta/view/qa_diff_any_view/diff?package=${ALPHA}`);
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    expect(codeOf(res.json)).toBe('VALIDATION_ERROR');
    // The protocol's reason, not the door's unknown-parameter refusal it answered before.
    expect(JSON.stringify(res.json)).toContain('not stored per package');
  });
});
