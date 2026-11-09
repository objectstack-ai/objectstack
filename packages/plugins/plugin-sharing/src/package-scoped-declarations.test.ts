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
 * the first package registered (and `queuesOf` the last). The last block is
 * the one reference this plugin reads that a package writes: a declared
 * rule's queue recipient, resolved from the rule's package (D3), so a holder
 * outside its declared closure, or only the environment (D3 (a)), is refused.
 * Each refusal pin was ablated once (the loosened answer put back, the pin
 * read red, restored); the readings are in the PR body.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { createDeclaredSharingRuleSource } from './declared-sharing-rules.js';
import { SharingRuleService, bindDeclaredRuleNameGuard } from './sharing-rule-service.js';
import { OwnershipQueueService } from './ownership-queue-service.js';
import { assignmentRuleRowIssues } from './assignment-rule-hooks.js';
import { PackageScopedNameRefusedError, resolveDeclaredName } from './package-scoped-declarations.js';

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';

type Row = Record<string, any>;

const manifest = (id: string, deps: string[] = []) =>
  ({
    id,
    name: id,
    version: '1.0.0',
    type: 'app',
    namespace: id.split('.').pop(),
    ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
  }) as never;

let registry: SchemaRegistry;
const install = (id: string, deps: string[] = []) => registry.installPackage(manifest(id, deps), 'code');
const declare = (type: string, packageId: string, item: Row) =>
  registry.registerItem<Row>(type, { ...item, _packageId: packageId }, 'name', packageId);

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
      const rows = (tables[object] ?? []).filter((row) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`test double: combinator '${k}' is not implemented`);
          if (v === null || typeof v !== 'object') return row[k] === v;
          const ops = Object.keys(v as object);
          if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`test double: operator ${ops.join(',')} on '${k}' is not implemented`);
          return (v as { $in: unknown[] }).$in.includes(row[k]);
        }),
      );
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
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

/** The warnings a reader logs, kept. */
const logs = () => {
  const warnings: Array<{ msg: string; meta?: any }> = [];
  return { warnings, logger: { warn: (msg: string, meta?: any) => warnings.push({ msg, meta }) } };
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
    const { warnings, logger } = logs();
    const source = createDeclaredSharingRuleSource({ engine: { registry }, logger });
    expect(await source.list()).toEqual([]);
    expect(await source.list()).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].meta).toMatchObject({ type: 'sharing_rule', name: 'emea_share', candidates: [ALPHA, BETA] });
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
    const { warnings, logger } = logs();
    const queues = new OwnershipQueueService({ engine: () => makeEngine(TABLES()) as any, logger });
    expect(await queues.resolveQueue('triage', 'org_a')).toBeNull();
    expect(await queues.expandMembers('triage', 'org_a')).toEqual([]);
    expect(await queues.isMember('u_alpha', 'triage', 'org_a')).toBe(false);
    const refused = await queues.expandMembers('triage', 'org_a', { onFailedRead: 'refuse' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].meta).toMatchObject({ type: 'queue', name: 'triage', candidates: [ALPHA, BETA] });
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
  it('revokes the refused name’s standing grants in the orphan sweep, reported once as a refusal naming both', async () => {
    const { warnings, logger } = logs();
    const engine = makeEngine({
      sys_record_share: [
        { id: 'g_refused', source: 'rule', source_id: 'emea_share', organization_id: 'org_a' },
        { id: 'g_orphan', source: 'rule', source_id: 'gone_rule', organization_id: 'org_a' },
      ],
    });
    const revoked: string[] = [];
    const sharing = { revoke: async (id: string) => void revoked.push(id) };
    const source = createDeclaredSharingRuleSource({ engine: { registry } });
    const rules = new SharingRuleService({ engine: engine as any, sharing: sharing as any, declaredRules: source, logger });
    expect(await rules.sweepOrphanedRuleGrants()).toBe(2);
    expect(await rules.sweepOrphanedRuleGrants()).toBe(2);
    expect(revoked).toEqual(['g_refused', 'g_orphan', 'g_refused', 'g_orphan']);
    const refusals = warnings.filter((w) => w.msg.includes('come back once the rule is addressed by package'));
    expect(refusals).toHaveLength(1);
    expect(refusals[0].meta).toMatchObject({ name: 'emea_share', candidates: [ALPHA, BETA] });
    // The vanished rule's grant is the only one counted as an orphan.
    expect(warnings.filter((w) => w.msg.includes('rule row no longer exists')).map((w) => w.meta)).toEqual([{ grants: 1 }, { grants: 1 }]);
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

describe('a declared rule’s queue recipient resolves from the rule’s package (ADR-0150 D3)', () => {
  /** ALPHA's declared rule `share_support`, granting to queue `support`, and its org_a projection. */
  const declaredQueueRule = () => {
    declare('sharing_rule', ALPHA, {
      ...sharingRule('share_support', 'unused'),
      sharedWith: { type: 'queue', value: 'support' },
    });
    return {
      id: 'share_support',
      name: 'share_support',
      label: 'share_support',
      object_name: 'account',
      organization_id: 'org_a',
      criteria: { region: 'emea' },
      recipient_type: 'queue' as const,
      recipient_id: 'support',
      access_level: 'read' as const,
      active: true,
      managed_by: 'package' as const,
    };
  };

  /** The rule service over the real registry and queue service, with one standing grant to `userId`. */
  const serviceWithGrant = (userId: string) => {
    const engine = makeEngine({
      ...TABLES(),
      sys_record_share: [{ id: 'rs_1', source: 'rule', source_id: 'share_support', organization_id: 'org_a', recipient_id: userId }],
    });
    const queues = new OwnershipQueueService({ engine: () => engine as any });
    const source = createDeclaredSharingRuleSource({ engine: { registry } });
    return new SharingRuleService({
      engine: engine as any,
      sharing: {} as any,
      declaredRules: source,
      ownershipQueues: () => queues,
      logger: { warn: () => {}, error: () => {} },
    });
  };

  it('refuses a queue held only by a package outside the rule package’s declared closure, naming it', async () => {
    const rule = declaredQueueRule();
    declare('queue', BETA, queue('support', 'beta_agent'));
    const refused = await serviceWithGrant('u_beta').revokeRuleGrantsForRetiredRecipients(rule).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
    expect((refused as PackageScopedNameRefusedError).refusal).toMatchObject({
      reason: 'outside-closure',
      callerPackageId: ALPHA,
      candidates: [{ kind: 'package', packageId: BETA }],
    });
  });

  it('refuses a queue only an environment-authored registry item holds (D3 (a))', async () => {
    const rule = declaredQueueRule();
    registry.registerItem('queue', queue('support', 'beta_agent'), 'name');
    const refused = await serviceWithGrant('u_beta').revokeRuleGrantsForRetiredRecipients(rule).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
    expect((refused as PackageScopedNameRefusedError).refusal).toMatchObject({
      reason: 'outside-closure',
      candidates: [{ kind: 'environment' }],
    });
  });

  it('serves the queue of a package the rule’s package declares a dependency on', async () => {
    registry = new SchemaRegistry();
    install(BETA);
    install(ALPHA, [BETA]);
    const rule = declaredQueueRule();
    declare('queue', BETA, queue('support', 'beta_agent'));
    // The standing grant to the queue's one member is still desired: nothing revoked.
    expect(await serviceWithGrant('u_beta').revokeRuleGrantsForRetiredRecipients(rule)).toBe(0);
  });

  it('serves the rule package’s own queue', async () => {
    const rule = declaredQueueRule();
    declare('queue', ALPHA, queue('support', 'alpha_agent'));
    expect(await serviceWithGrant('u_alpha').revokeRuleGrantsForRetiredRecipients(rule)).toBe(0);
  });
});

describe('a queue read from a caller package resolves by D3 (ADR-0150, the queue contract’s callerPackageId)', () => {
  const GAMMA = 'com.acme.gamma';

  /** Holders of the two packages' positions, plus GAMMA's, in org_a. */
  const tables = (): Record<string, Row[]> => ({
    sys_user_position: [
      ...TABLES().sys_user_position,
      { id: 'up_3', position: 'gamma_agent', user_id: 'u_gamma', organization_id: 'org_a' },
    ],
  });

  /** ALPHA's declared rule `share_support`, granting to queue `support`, and its org_a projection. */
  const declaredQueueRule = () => {
    declare('sharing_rule', ALPHA, {
      ...sharingRule('share_support', 'unused'),
      sharedWith: { type: 'queue', value: 'support' },
    });
    return {
      id: 'share_support',
      name: 'share_support',
      label: 'share_support',
      object_name: 'account',
      organization_id: 'org_a',
      criteria: { region: 'emea' },
      recipient_type: 'queue' as const,
      recipient_id: 'support',
      access_level: 'read' as const,
      active: true,
      managed_by: 'package' as const,
    };
  };

  const queueService = () => {
    const engine = makeEngine(tables());
    return { engine, queues: new OwnershipQueueService({ engine: () => engine as any }) };
  };

  /**
   * ALPHA (the rule's package P) declares a dependency on BETA (D); GAMMA (U)
   * is unrelated. BETA and GAMMA each declare queue `support`.
   */
  const dependencyAndUnrelated = () => {
    registry = new SchemaRegistry();
    install(BETA);
    install(GAMMA);
    install(ALPHA, [BETA]);
    declare('queue', BETA, queue('support', 'beta_agent'));
    declare('queue', GAMMA, queue('support', 'gamma_agent'));
  };

  it('resolves to the dependency’s queue, not the unrelated package’s, for every read that takes a name', async () => {
    dependencyAndUnrelated();
    const { queues } = queueService();
    const fromAlpha = { callerPackageId: ALPHA };
    expect(await queues.resolveQueue('support', 'org_a', fromAlpha)).toMatchObject({ name: 'support', source: 'declared', packageId: BETA });
    expect(await queues.expandMembers('support', 'org_a', fromAlpha)).toEqual(['u_beta']);
    expect(await queues.expandMembers('support', 'org_a', { ...fromAlpha, onFailedRead: 'refuse' })).toEqual(['u_beta']);
    expect(await queues.isMember('u_beta', 'support', 'org_a', fromAlpha)).toBe(true);
    expect(await queues.isMember('u_gamma', 'support', 'org_a', { ...fromAlpha, onFailedRead: 'refuse' })).toBe(false);
  });

  it('serves the declared rule’s queue recipient from the dependency: its member’s standing grant is still desired', async () => {
    dependencyAndUnrelated();
    const rule = declaredQueueRule();
    const engine = makeEngine({
      ...tables(),
      sys_record_share: [{ id: 'rs_1', source: 'rule', source_id: 'share_support', organization_id: 'org_a', recipient_id: 'u_beta' }],
    });
    const queues = new OwnershipQueueService({ engine: () => engine as any });
    const service = new SharingRuleService({
      engine: engine as any,
      sharing: {} as any,
      declaredRules: createDeclaredSharingRuleSource({ engine: { registry } }),
      ownershipQueues: () => queues,
      logger: { warn: () => {}, error: () => {} },
    });
    expect(await service.revokeRuleGrantsForRetiredRecipients(rule)).toBe(0);
    expect(await service.queueRecipientPackageOf(rule)).toBe(ALPHA);
  });

  it('refuses when the caller’s closure reaches two holders, naming both', async () => {
    registry = new SchemaRegistry();
    install(BETA);
    install(GAMMA);
    install(ALPHA, [BETA, GAMMA]);
    declare('queue', BETA, queue('support', 'beta_agent'));
    declare('queue', GAMMA, queue('support', 'gamma_agent'));
    const { queues } = queueService();
    const fromAlpha = { callerPackageId: ALPHA };
    expect(await queues.resolveQueue('support', 'org_a', fromAlpha)).toBeNull();
    expect(await queues.expandMembers('support', 'org_a', fromAlpha)).toEqual([]);
    expect(await queues.isMember('u_beta', 'support', 'org_a', fromAlpha)).toBe(false);
    for (const read of [
      () => queues.expandMembers('support', 'org_a', { ...fromAlpha, onFailedRead: 'refuse' }),
      () => queues.isMember('u_beta', 'support', 'org_a', { ...fromAlpha, onFailedRead: 'refuse' }),
    ]) {
      const refused = await read().catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
      expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
      expect((refused as PackageScopedNameRefusedError).refusal).toMatchObject({
        reason: 'ambiguous-in-closure',
        callerPackageId: ALPHA,
        candidates: [
          { kind: 'package', packageId: BETA },
          { kind: 'package', packageId: GAMMA },
        ],
      });
    }
  });

  it('reads environment-wide without a caller package, as before the key: the same two holders are refused', async () => {
    dependencyAndUnrelated();
    const { queues } = queueService();
    for (const options of [undefined, { callerPackageId: null }, { callerPackageId: '' }]) {
      expect(await queues.resolveQueue('support', 'org_a', options)).toBeNull();
      expect(await queues.expandMembers('support', 'org_a', options ?? undefined)).toEqual([]);
      expect(await queues.isMember('u_beta', 'support', 'org_a', options ?? undefined)).toBe(false);
      const refused = await queues.expandMembers('support', 'org_a', { ...options, onFailedRead: 'refuse' }).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
      expect((refused as PackageScopedNameRefusedError).refusal).toMatchObject({
        reason: 'ambiguous-in-environment',
        callerPackageId: null,
        candidates: [
          { kind: 'package', packageId: BETA },
          { kind: 'package', packageId: GAMMA },
        ],
      });
    }
  });

  it('serves nothing when the holder the caller reaches is disabled, never the unrelated package’s queue', async () => {
    dependencyAndUnrelated();
    registry.disablePackage(BETA);
    const { queues } = queueService();
    expect(await queues.resolveQueue('support', 'org_a', { callerPackageId: ALPHA })).toBeNull();
    expect(await queues.expandMembers('support', 'org_a', { callerPackageId: ALPHA, onFailedRead: 'refuse' })).toEqual([]);
  });

  it('looks through every holder’s positions, so a position move in the dependency’s queue reaches the rule', async () => {
    dependencyAndUnrelated();
    const { queues } = queueService();
    expect(await queues.queuesNaming('position', new Set(['beta_agent']), 'org_a')).toEqual(['support']);
    expect(await queues.queuesNaming('position', new Set(['gamma_agent']), 'org_a')).toEqual(['support']);
  });
});
