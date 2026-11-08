// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declared sharing rules, queues and assignment rules on `(package, name)` —
 * ADR-0150 D3/D4, child E4 of epic #31527.
 *
 * The registry is the real `SchemaRegistry`: packages installed through
 * `installPackage`, items registered under each package's composite slot, as
 * `AppPlugin` registers a manifest's `sharingRules` / `queues` /
 * `assignmentRules`. Every reader of the three types in this plugin is driven
 * through its public entry: the declared-rule source and the sharing-rule
 * service's by-name read (its write guard, the activation door's lookup), the
 * ownership-queue service, and the `sys_assignment_rule` save guard.
 *
 * Red line 1 (never loosens) is the `one holder` block: a name one package
 * declares answers exactly what it answered before. Red line 2 (ambiguity is
 * reported, never guessed) is the `two holders` block: a name two packages
 * declare is refused, naming both, by every reader — where `main` answered
 * the first package registered (and `queuesOf` the last). Each refusal pin was
 * ablated once (the first-registered pick put back, the pin read red,
 * restored); the readings are in the PR body.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { createDeclaredSharingRuleSource } from './declared-sharing-rules.js';
import { SharingRuleService, bindDeclaredRuleNameGuard } from './sharing-rule-service.js';
import { OwnershipQueueService } from './ownership-queue-service.js';
import { assignmentRuleRowIssues } from './assignment-rule-hooks.js';
import { PackageScopedNameRefusedError, resolveDeclaredName } from './package-scoped-declarations.js';

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';

type Row = Record<string, any>;

const manifest = (id: string) =>
  ({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() }) as never;

let registry: SchemaRegistry;
const install = (id: string) => registry.installPackage(manifest(id), 'code');
const declare = (type: string, packageId: string, item: Row) =>
  registry.registerItem(type, { ...item, _packageId: packageId }, 'name', packageId);

/** A sharing rule `name`, granting `position` read on `account`. */
const sharingRule = (name: string, position: string): Row => ({
  name,
  label: `${name} via ${position}`,
  object: 'account',
  condition: "record.region == 'emea'",
  sharedWith: { type: 'position', value: position },
  accessLevel: 'read',
});

/** A queue `name`, staffed by `position`. */
const queue = (name: string, position: string): Row => ({
  name,
  label: `${name} (${position})`,
  members: [{ type: 'position', value: position }],
});

/** An assignment rule `name` on `account`, round-robin to queue `q`. */
const assignmentRule = (name: string): Row => ({
  name,
  object: 'account',
  entries: [{ name, assignTo: { type: 'queue', value: 'triage' }, strategy: 'round_robin' }],
});

/** The engine slice the three readers use, over the real registry and in-memory tables. */
function makeEngine(tables: Record<string, Row[]> = {}) {
  const hooks: Array<{ event: string; object: string; handler: (ctx: any) => any; packageId?: string }> = [];
  return {
    registry,
    hooks,
    getSchema: () => undefined,
    async find(object: string, options?: any) {
      const where = options?.where ?? options?.filter ?? {};
      return (tables[object] ?? []).filter((row) =>
        Object.entries(where).every(([k, v]) =>
          v && typeof v === 'object' && '$in' in (v as object) ? (v as any).$in.includes(row[k]) : row[k] === v,
        ),
      );
    },
    async insert(_object: string, data: any) {
      return data;
    },
    async update(_object: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      return {};
    },
    async delete(_object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      return {};
    },
    registerHook(event: string, handler: (ctx: any) => any, o?: { object?: string; packageId?: string }) {
      hooks.push({ event, object: String(o?.object), handler, packageId: o?.packageId });
    },
    unregisterHooksByPackage(packageId: string) {
      const before = hooks.length;
      for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i].packageId === packageId) hooks.splice(i, 1);
      return before - hooks.length;
    },
  };
}

/** Holder positions behind the queues and rules (organization `org_a`). */
const TABLES = (): Record<string, Row[]> => ({
  sys_user_position: [
    { id: 'up_1', position: 'alpha_agent', user_id: 'u_alpha', organization_id: 'org_a' },
    { id: 'up_2', position: 'beta_agent', user_id: 'u_beta', organization_id: 'org_a' },
  ],
});

const logs = () => {
  const errors: Array<{ msg: string; meta?: any }> = [];
  return { errors, logger: { warn: () => {}, error: (msg: string, meta?: any) => errors.push({ msg, meta }) } };
};

beforeEach(() => {
  registry = new SchemaRegistry();
  install(ALPHA);
  install(BETA);
});

describe('one holder: every reader answers what it answered before (red line 1)', () => {
  beforeEach(() => {
    declare('sharing_rule', ALPHA, sharingRule('emea_share', 'alpha_agent'));
    declare('queue', ALPHA, queue('triage', 'alpha_agent'));
    declare('assignment_rule', ALPHA, assignmentRule('route_accounts'));
  });

  it('serves the one package’s sharing rule, by list and by name', async () => {
    const source = createDeclaredSharingRuleSource({ engine: { registry } });
    const listed = await source.list();
    expect(listed.map((r) => [r.name, r.recipientId, r.packageId])).toEqual([['emea_share', 'alpha_agent', ALPHA]]);
    const rules = new SharingRuleService({ engine: makeEngine() as any, sharing: {} as any, declaredRules: source, logger: { warn: () => {} } });
    expect((await rules.declaredRuleNamed('emea_share'))?.recipientId).toBe('alpha_agent');
  });

  it('resolves the one package’s queue, and expands its members', async () => {
    const queues = new OwnershipQueueService({ engine: () => makeEngine(TABLES()) as any });
    expect(await queues.declaredQueueNamed('triage')).toEqual({ name: 'triage', packageId: ALPHA });
    expect((await queues.resolveQueue('triage', 'org_a'))?.packageId).toBe(ALPHA);
    expect(await queues.expandMembers('triage', 'org_a')).toEqual(['u_alpha']);
    expect(await queues.queuesOf('u_alpha', 'org_a')).toEqual(['triage']);
  });

  it('refuses an authored assignment rule under the declared name, as before', async () => {
    const issues = await assignmentRuleRowIssues(makeEngine() as any, { name: 'route_accounts' }, 'org_a');
    expect(issues.find((i) => i.field === 'name')?.message).toMatch(/^'route_accounts' is the name of an assignment rule an installed app provides/);
  });
});

describe('two holders: a name two packages declare is refused, naming both (red line 2)', () => {
  beforeEach(() => {
    declare('sharing_rule', ALPHA, sharingRule('emea_share', 'alpha_agent'));
    declare('sharing_rule', BETA, sharingRule('emea_share', 'beta_agent'));
    declare('queue', ALPHA, queue('triage', 'alpha_agent'));
    declare('queue', BETA, queue('triage', 'beta_agent'));
    declare('assignment_rule', ALPHA, assignmentRule('route_accounts'));
    declare('assignment_rule', BETA, assignmentRule('route_accounts'));
  });

  it('the shared resolver names both holders (the refusal every reader below carries)', () => {
    const answer = resolveDeclaredName(registry, 'queue', 'triage', registry.listItems('queue'));
    expect(answer.status).toBe('refused');
    if (answer.status !== 'refused') return;
    expect(answer.refusal.reason).toBe('ambiguous-in-environment');
    expect(answer.refusal.candidates).toEqual([
      { kind: 'package', packageId: ALPHA },
      { kind: 'package', packageId: BETA },
    ]);
  });

  it('serves neither sharing rule, and reports the name once, naming both packages', async () => {
    const { errors, logger } = logs();
    const source = createDeclaredSharingRuleSource({ engine: { registry }, logger });
    expect(await source.list()).toEqual([]);
    expect(await source.list()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].meta).toMatchObject({ type: 'sharing_rule', name: 'emea_share', candidates: [ALPHA, BETA] });
  });

  it('refuses the sharing rule by name with 409 RESOURCE_CONFLICT naming both packages', async () => {
    const source = createDeclaredSharingRuleSource({ engine: { registry } });
    const rules = new SharingRuleService({ engine: makeEngine() as any, sharing: {} as any, declaredRules: source, logger: { warn: () => {} } });
    const refused = await rules.declaredRuleNamed('emea_share').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect((refused as Error).message).toContain(ALPHA);
    expect((refused as Error).message).toContain(BETA);
  });

  it('still refuses an authored sharing rule taking that name (the guard is not loosened)', async () => {
    const engine = makeEngine();
    const source = createDeclaredSharingRuleSource({ engine: { registry } });
    const rules = new SharingRuleService({ engine: engine as any, sharing: {} as any, declaredRules: source, logger: { warn: () => {} } });
    bindDeclaredRuleNameGuard(engine as any, rules);
    const insert = engine.hooks.find((h) => h.event === 'beforeInsert' && h.object === 'sys_sharing_rule')!;
    const refused = await Promise.resolve(insert.handler({ input: { data: { name: 'emea_share' } }, session: {} })).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
  });

  it('resolves the queue nowhere — neither package’s members — and refuses it under onFailedRead refuse', async () => {
    const { errors, logger } = logs();
    const queues = new OwnershipQueueService({ engine: () => makeEngine(TABLES()) as any, logger });
    expect(await queues.resolveQueue('triage', 'org_a')).toBeNull();
    expect(await queues.expandMembers('triage', 'org_a')).toEqual([]);
    expect(await queues.isMember('u_alpha', 'triage', 'org_a')).toBe(false);
    const refused = await queues.expandMembers('triage', 'org_a', { onFailedRead: 'refuse' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(errors).toHaveLength(1);
    expect(errors[0].meta).toMatchObject({ type: 'queue', name: 'triage', candidates: [ALPHA, BETA] });
  });

  it('serves neither queue to a user’s queues (main served the LAST one listed there)', async () => {
    const queues = new OwnershipQueueService({ engine: () => makeEngine(TABLES()) as any });
    expect(await queues.queuesOf('u_alpha', 'org_a')).toEqual([]);
    expect(await queues.queuesOf('u_beta', 'org_a')).toEqual([]);
  });

  it('refuses the activation door’s queue lookup with 409, naming both packages', async () => {
    const queues = new OwnershipQueueService({ engine: () => makeEngine(TABLES()) as any });
    const refused = await queues.declaredQueueNamed('triage').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
    expect((refused as Error).message).toContain(ALPHA);
    expect((refused as Error).message).toContain(BETA);
    // Still a declared name: no `sys_queue` row may take it.
    expect(queues.isDeclaredQueueName('triage')).toBe(true);
  });

  it('refuses an authored assignment rule under the name, naming both packages', async () => {
    const issues = await assignmentRuleRowIssues(makeEngine() as any, { name: 'route_accounts' }, 'org_a');
    const message = issues.find((i) => i.field === 'name')?.message ?? '';
    expect(message).toMatch(/^'route_accounts' is the name of an assignment rule 2 installed apps provide/);
    expect(message).toContain(ALPHA);
    expect(message).toContain(BETA);
  });
});

describe('a listing that cannot be asked (package, name) gets no pick either', () => {
  it('refuses a name two holders list, and answers a name one holder lists', () => {
    const listed = [
      { name: 'triage', _packageId: ALPHA },
      { name: 'triage', _packageId: BETA },
      { name: 'billing', _packageId: ALPHA },
    ];
    const refused = resolveDeclaredName(undefined, 'queue', 'triage', listed);
    expect(refused.status).toBe('refused');
    if (refused.status === 'refused') expect(refused.refusal.candidates.map((c) => (c.kind === 'package' ? c.packageId : c.kind))).toEqual([ALPHA, BETA]);
    expect(resolveDeclaredName(undefined, 'queue', 'billing', listed)).toEqual({ status: 'resolved', item: listed[2] });
  });
});
