// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2, #31720] A `packages[]` stack's RESIDUAL — the top-level items
 * no package body declares, which the `manifest` service registers under the
 * stack's own id after every body and never through the package door — is one
 * more holder of the stack's namespace. An item of the covered types that
 * bears a name another package of that namespace holds is refused, in the
 * package door's envelope, naming every holder; the whole artifact is put
 * back.
 *
 * Driven through the `manifest` service, the door both boot doors hand a stack
 * to. The CONTROLs pin what stays accepted: another namespace, a residual name
 * no package holds, a type outside the twelve, the residual owned by one of the
 * stack's own bodies, a shareable platform namespace.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { unclaimedTopLevel } from '@objectstack/metadata';
import { singularToPlural } from '@objectstack/spec/shared';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';
import { NAMESPACE_UNIQUE_TYPES, residualNamespacePackageOf, type NamespaceUniqueType } from './namespace-co-owner-names.js';

type Refusal = Error & {
  code?: string;
  status?: number;
  httpStatus?: number;
  conflicts?: Array<{ namespace: string; type: string; name: string; incomingPackageId: string; existingPackageIds: string[] }>;
};

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';
const RELEASE = 'com.acme.release';
const NAME = 'shared_item';

/**
 * The covered types a stack's top level can carry as residual: the residual
 * rule walks the stack's metadata collections (`ARTIFACT_FIELD_TO_TYPE` in
 * `@objectstack/metadata`), which carry no `jobs`, so a top-level job is never
 * a residual item (pinned below).
 */
const RESIDUAL_TYPES = NAMESPACE_UNIQUE_TYPES.filter((t) => t !== 'job');

/** A spec-valid item of each type (a package body is parsed on the load path). */
const item = (type: NamespaceUniqueType, name: string, tag: string): Record<string, unknown> => {
  const label = `${tag} ${type}`;
  switch (type) {
    case 'sharing_rule':
      return { name, label, type: 'criteria', object: 'crm_account', sharedWith: { type: 'team', value: 'sales' }, condition: 'true', accessLevel: 'read' };
    case 'assignment_rule':
      return { name, label, object: 'crm_account', entries: [{ name: 'e1', assignTo: { type: 'queue', value: 'triage' } }] };
    case 'hook':
      return { name, label, object: 'crm_account', events: ['beforeInsert'], body: { language: 'js', source: 'return;' } };
    case 'job':
      return { name, label, schedule: { type: 'cron', expression: '0 * * * *' }, handler: 'noop' };
    case 'app':
      return { name, label, navigation: [] };
    case 'page':
      return { name, label, type: 'app', regions: [] };
    case 'dashboard':
      return { name, label, widgets: [] };
    case 'report':
      return { name, label, dataset: 'ds', values: ['total'] };
    case 'book':
      return { name, label, groups: [] };
    case 'analytics_cube':
      return { name, title: label, sql: 'select 1', measures: {}, dimensions: {} };
    case 'tool':
      return { name, label, description: 'A tool', parameters: {} };
    default:
      return { name, label };
  }
};

const account = { name: 'crm_account', label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } };

/** A package body of namespace `ns`. */
const body = (id: string, ns: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  name: id.split('.').pop(),
  version: '1.0.0',
  type: 'app',
  namespace: ns,
  ...extra,
});

/**
 * A composed stack whose top level carries `residual` beside `bodies`, under
 * the stack's own manifest (`ownerId`, `ns`) — the shape `composeStacks`
 * flattens, as `manifest-service-residual-security-seal.test.ts` builds it.
 */
const stack = (ns: string, bodies: unknown[], residual: Record<string, unknown[]>, ownerId = RELEASE) => {
  const manifest = { id: ownerId, name: 'release', namespace: ns, version: '1.0.0', type: 'app' };
  return { ...manifest, manifest, packages: bodies.map((m) => ({ manifest: m })), ...residual };
};

const residualOf = (type: NamespaceUniqueType, tag = 'release') => ({ [singularToPlural(type)]: [item(type, NAME, tag)] });

/**
 * The stack's one body, in `ns`, declaring a dependency on alpha: the
 * install-time namespace gate admits a dependent as a co-owner of alpha's
 * namespace (ADR-0141 D5), where it refuses a stranger before any name is read.
 */
const betaOf = (ns: string, extra: Record<string, unknown> = {}) => body(BETA, ns, { dependencies: { [ALPHA]: '^1.0.0' }, ...extra });

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
});

async function boot() {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const svc = kernel.getService('manifest') as { register(m: unknown): void | Promise<void> };
  const register = async (artifact: unknown): Promise<Refusal | undefined> => {
    try {
      await svc.register(artifact);
      return undefined;
    } catch (e) {
      return e as Refusal;
    }
  };
  return { ql, register };
}

/** Install `alpha` (namespace `crm`) holding one `type` item named NAME, through its own artifact. */
async function withAlphaHolding(type: NamespaceUniqueType) {
  const env = await boot();
  const installed = await env.register({
    packages: [{ manifest: body(ALPHA, 'crm', { objects: [account], [singularToPlural(type)]: [item(type, NAME, 'alpha')] }) }],
  });
  expect(installed?.message).toBeUndefined();
  return env;
}

describe('the residual as a holder', () => {
  it('a top-level job is never residual: the residual rule walks no `jobs` collection', () => {
    const answer = unclaimedTopLevel(stack('crm', [body(BETA, 'crm')], { jobs: [item('job', NAME, 'release')] }));
    expect(answer?.items.map((i) => i.type)).toEqual([]);
  });

  it('reads as ONE holder under the residual owner id, in the stack\'s own namespace', () => {
    const s = stack('crm', [body(BETA, 'crm')], { pages: [item('page', 'home', 'r')], tools: [item('tool', 'lookup', 'r')] });
    expect(residualNamespacePackageOf(s, unclaimedTopLevel(s))).toEqual({
      packageId: RELEASE,
      namespace: 'crm',
      names: [{ type: 'page', name: 'home' }, { type: 'tool', name: 'lookup' }],
    });
  });

  it('is undefined for a stack with no residual, and for a residual holding none of the twelve', () => {
    const none = stack('crm', [body(BETA, 'crm', { pages: [item('page', 'home', 'b')] })], { pages: [item('page', 'home', 'b')] });
    expect(residualNamespacePackageOf(none, unclaimedTopLevel(none))).toBeUndefined();
    expect(residualNamespacePackageOf({ manifest: { id: RELEASE, namespace: 'crm' } }, undefined)).toBeUndefined();
  });
});

describe.each(RESIDUAL_TYPES)('%s — a residual item under a name another package of its namespace holds', (type) => {
  it('is refused at the manifest service, naming both holders, and the artifact is put back whole', async () => {
    const { ql, register } = await withAlphaHolding(type);
    const err = await register(stack('crm', [betaOf('crm')], residualOf(type)));
    expect([err?.code, err?.status, err?.httpStatus], err?.message).toEqual(['NAMESPACE_CONFLICT', 422, 422]);
    expect(err?.conflicts).toEqual([
      { namespace: 'crm', type, name: NAME, incomingPackageId: RELEASE, existingPackageIds: [ALPHA] },
    ]);
    expect(err?.message).toContain(`"${RELEASE}"`);
    expect(err?.message).toContain(`"${ALPHA}"`);
    // Put back whole: the stack's body is not installed, and the name keeps answering alpha's item.
    expect(ql.registry.getPackage(BETA)).toBeUndefined();
    expect((ql.registry.getItem(type, NAME) as { label?: string; title?: string } | undefined)?.[type === 'analytics_cube' ? 'title' : 'label'])
      .toBe(`alpha ${type}`);
  });

  it('CONTROL — the same residual in a stack of ANOTHER namespace registers', async () => {
    const { register } = await withAlphaHolding(type);
    expect((await register(stack('hr', [betaOf('hr')], residualOf(type))))?.message).toBeUndefined();
  });
});

describe('what the residual rule leaves alone', () => {
  it('CONTROL — a residual name no package of the namespace holds registers, under the residual owner id', async () => {
    const { ql, register } = await withAlphaHolding('page');
    expect((await register(stack('crm', [betaOf('crm')], { pages: [item('page', 'release_home', 'release')] })))?.message)
      .toBeUndefined();
    expect((ql.registry.getItem('page', 'release_home') as { label?: string } | undefined)?.label).toBe('release page');
  });

  it('CONTROL — a residual item of a type outside the twelve is not judged (a doc alpha also holds)', async () => {
    // Outside the twelve AND outside every other name rule (a dataset is phase
    // 1's one-holder type, a position the security catalog's, each refusing
    // on its own terms), so nothing judges it.
    // A fresh literal per registration: the registry stamps `_packageId` onto
    // the object it registers, and a shared literal would carry alpha's stamp.
    const doc = (label: string) => ({ name: NAME, label, content: `# ${label}` });
    const env = await boot();
    expect((await env.register({ packages: [{ manifest: body(ALPHA, 'crm', { docs: [doc('alpha doc')] }) }] }))?.message)
      .toBeUndefined();
    const err = await env.register(stack('crm', [betaOf('crm')], { docs: [doc('release doc')] }));
    expect(err?.message).toBeUndefined();
  });

  it('CONTROL — a shareable platform namespace is not judged', async () => {
    const env = await boot();
    expect((await env.register({ packages: [{ manifest: body(ALPHA, 'sys', { pages: [item('page', NAME, 'alpha')] }) }] }))?.message)
      .toBeUndefined();
    const err = await env.register(stack('sys', [betaOf('sys')], residualOf('page')));
    expect(err?.code, err?.message).not.toBe('NAMESPACE_CONFLICT');
  });
});

describe('order does not decide', () => {
  it('a package registered AFTER the stack, holding the residual\'s name, is refused at the package door, naming the residual\'s owner', async () => {
    const { ql, register } = await boot();
    expect((await register(stack('crm', [betaOf('crm')], residualOf('page'))))?.message).toBeUndefined();
    const err = await register({ packages: [{ manifest: body(ALPHA, 'crm', { pages: [item('page', NAME, 'alpha')] }) }] });
    expect([err?.code, err?.status], err?.message).toEqual(['NAMESPACE_CONFLICT', 422]);
    expect(err?.conflicts).toEqual([
      { namespace: 'crm', type: 'page', name: NAME, incomingPackageId: ALPHA, existingPackageIds: [RELEASE] },
    ]);
    expect(ql.registry.getPackage(ALPHA)).toBeUndefined();
  });

  it('uninstalling the residual\'s owner (a body id, the preserve shape) frees the residual\'s names: a package holding the name then installs', async () => {
    const { ql, register } = await boot();
    expect((await register(stack('crm', [betaOf('crm')], residualOf('page'), BETA)))?.message).toBeUndefined();
    expect((ql.registry.getItem('page', NAME) as { label?: string } | undefined)?.label).toBe('release page');
    expect(ql.registry.uninstallPackage(BETA)).toBe(true);
    expect(ql.registry.getItem('page', NAME)).toBeUndefined();
    expect((await register({ packages: [{ manifest: body(ALPHA, 'crm', { pages: [item('page', NAME, 'alpha')] }) }] }))?.message)
      .toBeUndefined();
    expect((ql.registry.getItem('page', NAME) as { label?: string } | undefined)?.label).toBe('alpha page');
  });

  it('CONTROL — the same stack registering again is not judged against its own residual', async () => {
    const { register } = await boot();
    const s = stack('crm', [betaOf('crm')], residualOf('page'));
    expect((await register(s))?.message).toBeUndefined();
    expect((await register(s))?.message).toBeUndefined();
  });

  it('CONTROL — a refused stack records no residual holder: the package after it installs', async () => {
    const { register } = await withAlphaHolding('tool');
    expect((await register(stack('crm', [betaOf('crm')], { ...residualOf('tool'), pages: [item('page', 'release_home', 'r')] })))?.code)
      .toBe('NAMESPACE_CONFLICT');
    const gamma = body('com.acme.gamma', 'crm', { dependencies: { [ALPHA]: '^1.0.0' }, pages: [item('page', 'release_home', 'gamma')] });
    expect((await register({ packages: [{ manifest: gamma }] }))?.message).toBeUndefined();
  });
});

describe('inside one artifact', () => {
  it('the residual never shares a covered name with one of the stack\'s own bodies: a body holding it claims the slot, so it is not residual', () => {
    for (const type of RESIDUAL_TYPES) {
      const s = stack('crm', [body(BETA, 'crm', residualOf(type, 'beta'))], residualOf(type));
      expect(unclaimedTopLevel(s)?.items, type).toEqual([]);
      expect(residualNamespacePackageOf(s, unclaimedTopLevel(s)), type).toBeUndefined();
    }
  });
});
