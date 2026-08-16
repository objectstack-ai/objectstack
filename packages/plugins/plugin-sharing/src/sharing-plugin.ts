// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveAuthzContext } from '@objectstack/core';
import type { EngineMiddleware, OperationContext } from '@objectstack/objectql';
import type {
  AuthSessionApi,
  IAuthService,
  IHierarchyScopeResolver,
  IHttpRequest,
  IHttpServer,
  II18nService,
  IMetadataService,
  IObjectQLEngine,
} from '@objectstack/spec/contracts';
// [#6206] The share-link routes' context is the FULL authorization envelope —
// it feeds enforcement (`engine.find`), so it is an `ExecutionContext`, never
// the route-local `ShareLinkExecutionContext`.
import type { ExecutionContext } from '@objectstack/spec/kernel';
// [#8430, extending #8220] The ONE filter-subtree provenance mechanism. This
// middleware is a read-scope merge boundary and stamps the same spec-declared
// mark `plugin-security` and `service-analytics` stamp at theirs — never a
// local flag, never a second spelling of the same idea.
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import { SysRecordShare, SysSharingRule, SysShareLink } from './objects/index.js';
import { SysBusinessUnit, SysBusinessUnitMember } from '@objectstack/platform-objects/identity';
import {
  SharingService,
  type SharingEngine,
  type SharingSecurityProbe,
  type SharingTenancyProbe,
} from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { ShareLinkService } from './share-link-service.js';
import { registerShareLinkRoutes } from './share-link-routes.js';
import { bindRuleHooks, unbindAllRuleHooks, bindRuleCriteriaGuard, RULE_REBIND_TRIGGER_PACKAGE } from './rule-hooks.js';
import { bindRuleProvenanceStamp, unbindRuleProvenanceStamp } from './sharing-rule-provenance.js';
import { bindPrimaryBuHooks, backfillPrimaryBu } from './primary-bu-projection.js';
import { bindBusinessUnitTreeRecompute } from './bu-tree-recompute.js';
import { bindRecordShareCascade } from './record-share-cascade.js';
import { bootstrapDeclaredSharingRules } from './bootstrap-declared-sharing-rules.js';

export interface SharingPluginOptions {
  /** Extra object names that bypass sharing entirely. */
  bypassObjects?: string[];
  /**
   * Disable enforcement (read filter + canEdit) while still registering
   * the schema + service. Useful in development to flip enforcement on
   * via env var without rebuilding.
   */
  enforce?: boolean;
  /**
   * Disable the public share-link REST routes. The `IShareLinkService`
   * is always registered (other services may depend on it); only the
   * HTTP surface is suppressed.
   */
  registerShareLinkRoutes?: boolean;
  /**
   * Base path for the share-link REST surface. Defaults to
   * `/api/v1/share-links`.
   */
  shareLinkBasePath?: string;
}

/**
 * [#2926 ③] Boot backfill: rule grants are materialized by the write hooks,
 * but seed rows are written with `isSystem` (which the hooks deliberately
 * skip — see rule-hooks.ts), so a fresh deploy's seed data carried no
 * `sys_record_share` rows until each record was touched at runtime.
 * Reconcile every rule once per boot: `evaluateRule` is idempotent
 * (diff-based grant/update/revoke), so repeated boots are no-ops.
 * Best-effort per rule — one broken rule must not block startup or its
 * siblings. Returns the number of rules successfully reconciled.
 *
 * [#4433] Callers must pass EVERY rule, not just the active ones. This pass is
 * the last line of defence for withdrawal: `evaluateRule` purges the grants of
 * a rule it finds inactive, so an inactive rule in this list is what turns a
 * restart into a repair. Handed only active rules — as it was — the pass could
 * physically never revoke anything a deactivated rule had left behind, which
 * is why the #4433 repro survived a full restart with the rule reading
 * `active: false` and the grant still answering.
 */
export async function backfillRuleGrants(
  ruleService: SharingRuleService,
  rules: Array<{ id?: string; name?: string }>,
  logger?: { info?: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void },
): Promise<number> {
  const start = Date.now();
  let reconciled = 0;
  for (const rule of rules) {
    try {
      await ruleService.evaluateRule((rule.id ?? rule.name) as string, { isSystem: true } as any);
      reconciled += 1;
    } catch (err: any) {
      logger?.warn?.('SharingServicePlugin: boot rule backfill failed for rule', {
        rule: rule.name ?? rule.id,
        error: err?.message,
      });
    }
  }
  if (rules.length > 0) {
    logger?.info?.('SharingServicePlugin: boot rule backfill done', {
      rules: rules.length,
      reconciled,
      ms: Date.now() - start,
    });
  }
  // [#3929 follow-up] One aggregate line for the legacy criteria-less rules
  // the pass just walked (each also warned once, above, via the per-rule
  // dedup): the operator-facing summary of what is under-sharing and why.
  const inert = ruleService.inertRuleNames;
  if (inert.length > 0) {
    logger?.warn?.(
      'SharingServicePlugin: rule(s) with no usable criteria are matching NO records — their ' +
        'grants are revoked on reconcile (ADR-0049). Fix the criteria or set active: false.',
      { count: inert.length, rules: inert },
    );
  }
  return reconciled;
}

/**
 * [#3865] Boot backfill: normalise stored `access_level: 'full'` rows to
 * `'edit'` on `sys_sharing_rule` and `sys_record_share`.
 *
 * `full` was declared "Full Access (Transfer, Share, Delete)" but no code path
 * granted any of those verbs because of it — both enforcement gates matched
 * `access_level in ('edit','full')`, so it was byte-equivalent to `edit`
 * (ADR-0078 declared-but-unenforced). Having retired it from the authoring
 * surface, this closes the loop on rows already persisted.
 *
 * **Behaviour-preserving by construction**: the two levels were already
 * equivalent, so no principal gains or loses access. Contrast the OWD
 * `sharingModel: 'full'` retirement (ADR-0090 D4), which changed posture and
 * therefore had to be delegated to the author rather than auto-migrated.
 *
 * Writes with `isSystem` so the provenance stamp hook treats this as the
 * package door, not an admin edit — a package-seeded rule must NOT come out of
 * this marked `customized`, or the seeder would stop updating it forever
 * (#2909 T1).
 *
 * Best-effort and idempotent: a missing table or a failed row is logged and
 * skipped, never fatal to boot, and a second run finds nothing to do.
 */
export async function backfillRetiredAccessLevels(
  engine: SharingEngine,
  logger?: { info?: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void },
): Promise<{ rules: number; shares: number }> {
  const BATCH = 500;
  const SYS = { isSystem: true, positions: [], permissions: [] } as any;
  const counts = { rules: 0, shares: 0 };

  const normalizeObject = async (object: 'sys_sharing_rule' | 'sys_record_share'): Promise<number> => {
    let migrated = 0;
    // Re-query per batch rather than paginating: each pass mutates the very
    // predicate it selects on, so offsets would skip rows. Bounded by a
    // no-progress break so a silently-failing update can't spin forever.
    for (;;) {
      const rows = await engine.find(object, {
        where: { access_level: 'full' },
        fields: ['id'],
        limit: BATCH,
        context: SYS,
      });
      const batch = Array.isArray(rows) ? rows : [];
      if (batch.length === 0) break;

      let updatedThisPass = 0;
      for (const row of batch) {
        const id = (row as any)?.id;
        if (!id) continue;
        try {
          await engine.update(object, { id, access_level: 'edit' }, { context: SYS });
          updatedThisPass += 1;
        } catch (err: any) {
          logger?.warn?.('SharingServicePlugin: access-level backfill failed for row', {
            object,
            id,
            error: err?.message,
          });
        }
      }
      migrated += updatedThisPass;
      if (updatedThisPass === 0) {
        logger?.warn?.('SharingServicePlugin: access-level backfill made no progress — stopping', {
          object,
          remaining: batch.length,
        });
        break;
      }
    }
    return migrated;
  };

  for (const object of ['sys_sharing_rule', 'sys_record_share'] as const) {
    try {
      const migrated = await normalizeObject(object);
      if (object === 'sys_sharing_rule') counts.rules = migrated;
      else counts.shares = migrated;
    } catch (err: any) {
      // Table absent (plugin loaded without its objects) or driver refusing the
      // filter — never fatal, the gates still honour `full` meanwhile.
      logger?.warn?.('SharingServicePlugin: access-level backfill skipped', {
        object,
        error: err?.message,
      });
    }
  }

  if (counts.rules > 0 || counts.shares > 0) {
    logger?.info?.("SharingServicePlugin: normalised retired access_level 'full' → 'edit'", counts);
  }
  return counts;
}

/**
 * SharingServicePlugin — registers `sys_record_share`, the `sharing`
 * service, and the engine middleware that enforces
 * `object.sharingModel`.
 *
 * Enforcement is opt-in per object:
 *
 *   - `sharingModel: 'private'` → reads filtered to `(owner_id == me) OR
 *     (record explicitly shared with me)`. Writes require ownership or
 *     an `edit` share.
 *   - `sharingModel: 'public_read'` → reads unrestricted; writes gated as
 *     above (typical "everyone can see, only owner can edit").
 *   - any other value (or no value) → no enforcement. This keeps
 *     existing CRM behaviour identical until admins explicitly enable
 *     sharing on a per-object basis.
 *
 * @example
 * ```ts
 * import { SharingServicePlugin } from '@objectstack/plugin-sharing';
 *
 * kernel.use(new SharingServicePlugin());
 *
 * // Mark an object private — middleware enforces from this point on.
 * defineObject({
 *   name: 'account',
 *   sharingModel: 'private',
 *   fields: { owner_id: Field.lookup('sys_user'), ... },
 * });
 * ```
 */
export class SharingServicePlugin implements Plugin {
  name = 'com.objectstack.service.sharing';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: SharingPluginOptions;
  private service?: SharingService;
  private ruleService?: SharingRuleService;
  private linkService?: ShareLinkService;
  /** Resolved once in `kernel:ready`; reused by the `kernel:bootstrapped` backfills. */
  private engine?: SharingEngine;

  /**
   * [#4433] Has the `kernel:bootstrapped` rule-grant backfill finished?
   *
   * This is the real question the rule-write trigger needs to answer before it
   * decides to skip a reconcile — "is the boot pass going to cover this write
   * anyway?" It used to ask `session.isSystem` instead, which is a different
   * question with a very different answer: `SharingRuleService.defineRule`
   * writes `sys_sharing_rule` with SYSTEM_CTX **always** (it must, to reach a
   * platform table the sharing middleware otherwise gates), so every runtime
   * authoring write — including `POST /sharing/rules` with `active: false` —
   * looked exactly like boot seeding and was skipped. That is the whole of
   * #4433's first half: deactivation returned 200, and nothing reconciled.
   */
  private ruleGrantsBootReconciled = false;

  constructor(options: SharingPluginOptions = {}) {
    this.options = options;
  }

  /**
   * Serializes rule-hook rebinds triggered by `sys_sharing_rule` data
   * changes, so two rapid writes can't interleave their unbind→bind
   * sequences and leave the older rule snapshot bound.
   */
  private ruleRebindChain: Promise<void> = Promise.resolve();

  /**
   * [#2592] Rebind rule hooks whenever `sys_sharing_rule` DATA changes.
   *
   * `bindRuleHooks` above runs once at `kernel:ready` and registers
   * lifecycle hooks only for the objects that had ≥1 rule at that moment.
   * Rule *evaluation* reads `sys_sharing_rule` live, but a rule created at
   * runtime for an object with no boot-time rule never got a hook — so it
   * silently no-oped until the next restart. And because authoring a rule
   * is a data INSERT (not a metadata publish), the `metadata:reloaded`
   * rebind pattern (#2576) never fires here — the trigger must be a
   * data-change hook on the rule table itself.
   *
   * The rebind mirrors boot exactly: unbind the whole rule-hook package,
   * re-bind from a fresh `listRules()`. Runs AFTER the write inside the
   * same lifecycle pipeline (awaited, so the rule is enforceable the moment
   * the authoring call returns), but never fails the write — a rebind
   * failure logs and leaves the previous bindings in place.
   *
   * [#3821] The rebind alone only makes the rule apply to records written
   * FROM NOW ON. Authoring in the Setup UI therefore looked inert: an admin
   * created a rule, switched it on, and the recipient still saw nothing —
   * the rule only reached a record once somebody happened to touch it. Worse
   * in the other direction, switching a rule OFF (or deleting it) left every
   * grant it had already issued in place, and boot backfill only reconciles
   * ACTIVE rules, so those grants survived restarts forever: the UI said
   * "disabled" while the access was still live.
   *
   * So each write now also reconciles THAT rule's grants — the same
   * `evaluateRule` the REST `/sharing/rules/:id/evaluate` endpoint runs, which
   * is diff-based and purges when the rule is inactive. Deletes can't go
   * through it (the row is gone, `RULE_NOT_FOUND`), so they purge directly.
   *
   * [#4433] The reconcile is skipped only until the `kernel:bootstrapped`
   * backfill has run — NOT for every `isSystem` write, as it was. #3821 built
   * this seam and then gated it on the one predicate that switches it off
   * everywhere it mattered: `defineRule` — the sole implementation behind
   * `POST /sharing/rules`, the documented way to deactivate a rule — writes
   * with SYSTEM_CTX unconditionally, so the `isSystem` skip caught 100% of
   * REST authoring. The withdrawal path was present, tested (against a mocked
   * `session` the real path never sends) and unreachable in production: an
   * admin saving `active: false` got a 200 and no reconcile, and because boot
   * backfill then only walked ACTIVE rules, the orphaned grant outlived every
   * restart. Boot phase is the honest predicate — before it, the backfill owes
   * this table a pass; after it, nothing else will do the work.
   */
  private bindRuleRebindTriggers(engine: any, ctx: PluginContext): void {
    const scheduleRebind = (): Promise<void> => {
      const run = this.ruleRebindChain.then(async () => {
        const ruleService = this.ruleService;
        if (!ruleService) return;
        const rules = await ruleService.listRules({ activeOnly: true }, { isSystem: true } as any);
        unbindAllRuleHooks(engine);
        bindRuleHooks(engine, ruleService, rules, ctx.logger as any);
      });
      // The chain must never hold a rejection (it would poison later
      // rebinds); callers observe failures through `run`.
      this.ruleRebindChain = run.catch(() => undefined);
      return run;
    };
    /**
     * Reconcile the written rule's grants, chained behind the rebind so two
     * rapid writes can't interleave their reconciles. Best-effort: a failure
     * logs and leaves the previous grants alone — it must never fail the
     * authoring write.
     */
    const scheduleReconcile = (ruleId: string, deleted: boolean): Promise<void> => {
      const run = this.ruleRebindChain.then(async () => {
        const ruleService = this.ruleService;
        if (!ruleService) return;
        if (deleted) {
          await ruleService.revokeRuleGrants(ruleId);
          return;
        }
        await ruleService.evaluateRule(ruleId, { isSystem: true } as any);
      });
      this.ruleRebindChain = run.catch(() => undefined);
      return run;
    };

    const makeHandler = (deleted: boolean) => async (hookCtx: any) => {
      try {
        await scheduleRebind();
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: sharing-rule hook rebind failed — previous bindings kept', {
          error: err?.message,
        });
      }
      // [#4433] Skip only while the boot backfill still owes this table a
      // pass. Declared-rule seeding and package bootstrap run before
      // `kernel:bootstrapped`, and that pass reconciles every rule, so
      // reconciling here would duplicate it. Once it has run, every write
      // reconciles — regardless of `isSystem`, which cannot distinguish boot
      // seeding from an admin's `POST /sharing/rules` (both arrive as
      // SYSTEM_CTX from `defineRule`).
      if (!this.ruleGrantsBootReconciled) return;
      const data = hookCtx?.result ?? hookCtx?.input?.data ?? {};
      const ruleId = String(data?.id ?? hookCtx?.input?.id ?? '');
      if (!ruleId) return;
      try {
        await scheduleReconcile(ruleId, deleted);
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: sharing-rule grant reconcile failed — grants left unchanged', {
          rule: ruleId,
          error: err?.message,
        });
      }
    };

    for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
      engine.registerHook(event, makeHandler(event === 'afterDelete'), {
        object: 'sys_sharing_rule',
        packageId: RULE_REBIND_TRIGGER_PACKAGE,
        priority: 200,
      });
    }
    ctx.logger.info('SharingServicePlugin: sharing-rule data-change rebind triggers bound');
  }

  async init(ctx: PluginContext): Promise<void> {
    // Register sys_record_share via the manifest service.
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service.sharing',
      name: 'Sharing Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      defaultDatasource: 'cloud',
      namespace: 'sys',
      objects: [SysRecordShare, SysSharingRule, SysBusinessUnit, SysBusinessUnitMember, SysShareLink],
      // ADR-0029 D7 — contribute the sharing entries into the Setup app's
      // `group_access_control` slot (priority 200 so they sit after plugin-
      // security's Roles / Permission Sets). This plugin owns these objects (K2).
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_access_control',
          priority: 200,
          items: [
            { id: 'nav_sharing_rules', type: 'object', label: 'Sharing Rules', objectName: 'sys_sharing_rule', icon: 'share-2', requiresObject: 'sys_sharing_rule', requiredPermissions: ['manage_platform_settings'] },
            { id: 'nav_record_shares', type: 'object', label: 'Record Shares', objectName: 'sys_record_share', icon: 'link', requiresObject: 'sys_record_share', requiredPermissions: ['manage_platform_settings'] },
          ],
        },
      ],
    });

    // ADR-0029 D8 — contribute this plugin's object translations to the i18n
    // service on kernel:ready (the i18n plugin may register after this one).
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', async () => {
        try {
          const i18n = ctx.getService<II18nService>('i18n');
          if (i18n && typeof i18n.loadTranslations === 'function') {
            const { SharingTranslations } = await import('./translations/index.js');
            for (const [locale, data] of Object.entries(SharingTranslations)) {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
            }
          }
        } catch { /* i18n optional */ }
      });
    }
    ctx.logger.info('SharingServicePlugin: schema registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      // The engine SEEN WHOLE (`registerHook` / `unregisterHooksByPackage` /
      // `registerMiddleware` are all bound below), which is the `objectql`
      // slot. Its ledger entry records it as "the SAME instance as `data`,
      // seen whole", so the alias fallback resolves the same object.
      let engine: IObjectQLEngine | null = null;
      try { engine = ctx.getService<IObjectQLEngine>('objectql'); }
      catch { try { engine = ctx.getService<IObjectQLEngine>('data'); } catch { /* ignore */ } }
      if (!engine) {
        ctx.logger.warn('SharingServicePlugin: no ObjectQL engine — service NOT registered');
        return;
      }
      this.engine = engine as SharingEngine;

      this.service = new SharingService({
        engine: engine as SharingEngine,
        bypassObjects: this.options.bypassObjects,
        logger: ctx.logger as any,
        // [ADR-0057] Late-bound lookup of the enterprise hierarchy resolver.
        // Open edition: not registered → hierarchy scopes fail closed to own.
        hierarchyResolver: () => {
          try { return ctx.getService<IHierarchyScopeResolver>('hierarchy-scope-resolver'); }
          catch { return null; }
        },
        // [ADR-0111 D1/D2] Late-bound security probe for canManageShares'
        // Modify-All path. Absent (no plugin-security) → owner-only, fail
        // closed — a degraded security stack never widens sharing authority.
        securityService: () => {
          // The named surface this option already requires — plugin-security is
          // OPTIONAL, so the consumer declares the slice it probes rather than
          // taking a runtime dependency on `ISecurityService`.
          try { return ctx.getService<SharingSecurityProbe>('security'); }
          catch { return null; }
        },
        // [ADR-0105 D1 / #5859] Late-bound tenancy posture — read exactly the
        // way SecurityPlugin reads it for the Layer 0 wall, so the two layers
        // can never disagree about whether an organization wall is in force.
        // Absent (no plugin-auth) → the org gate assumes WALLED and refuses to
        // widen a hierarchy scope that carries no organization; an unresolvable
        // posture is not evidence of `single`.
        tenancy: () => {
          try { return ctx.getService<SharingTenancyProbe>('tenancy'); }
          catch { return null; }
        },
      });
      ctx.registerService('sharing', this.service);

      // [ADR-0057 D12] Maintain sys_user.primary_business_unit_id as a
      // denormalised projection of sys_business_unit_member.is_primary so a
      // user-lookup can filter candidates by business unit. Bound regardless of
      // `enforce` — it is a data projection, not an access-control surface.
      try {
        if (typeof engine.registerHook === 'function' && typeof engine.unregisterHooksByPackage === 'function') {
          bindPrimaryBuHooks(engine, ctx.logger as any);
          await backfillPrimaryBu(engine, ctx.logger as any);
        }
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: primary-bu projection not started', { error: err?.message });
      }

      // [#5103] Record delete ⇒ every share on that record is revoked, whatever
      // its source. Bound REGARDLESS of `enforce`, and deliberately: with
      // enforcement off the rows are not consulted, but they are still written
      // (by rules, by the share REST surface in a host that mounts it) and
      // still accumulate — and a deployment that flips `enforce` back on must
      // not inherit a table of dangling grants. Same reasoning as the primary-BU
      // projection above: this is data hygiene on a table this plugin owns, not
      // an access-control surface.
      //
      // Not bound per object: the posture is judged per delete from live
      // metadata, so an object that gains `sharingModel` after boot is covered
      // without a rebind (see record-share-cascade.ts).
      //
      // [#5190] The same hook pair also reclaims `sys_share_link` — a link is a
      // capability token, so an orphan of it is worse than an orphaned grant:
      // no principal is named, and a reused record id hands the new record to
      // whoever kept the URL. The link service is passed as a GETTER because it
      // is constructed further down this same handler; `resolveToken` refuses
      // dead-record links regardless of whether this hook ever runs.
      try {
        if (typeof engine.registerHook === 'function' && typeof engine.unregisterHooksByPackage === 'function') {
          bindRecordShareCascade(engine, this.service, ctx.logger as any, () => this.linkService);
        } else {
          ctx.logger.warn(
            'SharingServicePlugin: engine has no hook API — record deletes will NOT revoke their ' +
              'sys_record_share / sys_share_link rows; the kernel:bootstrapped orphan sweeps are the ' +
              'only reclaim',
          );
        }
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: record-share delete cascade not bound', { error: err?.message });
      }

      // Enforcement (read-filter middleware + sharing-rule hooks) is opt-out
      // via `enforce: false`. The share-link service below is registered
      // REGARDLESS — capability-token sharing does not depend on principal-
      // based RLS enforcement, and multi-tenant hosts mount this plugin purely
      // for the `shareLinks` service (per-env enforcement is applied elsewhere).
      if (this.options.enforce === false) {
        ctx.logger.info('SharingServicePlugin: enforcement disabled (enforce=false) — share-link service still registered');
      } else {
        const mw = buildSharingMiddleware(this.service, ctx.logger as any);
        if (typeof engine.registerMiddleware === 'function') {
          engine.registerMiddleware(mw, { object: '*' });
          ctx.logger.info('SharingServicePlugin: enforcement middleware installed');
        } else {
          ctx.logger.warn('SharingServicePlugin: engine has no registerMiddleware — enforcement not applied');
        }

        // Rule evaluator + hot-rebindable lifecycle hooks.
        try {
          this.ruleService = new SharingRuleService({
            engine: engine as SharingEngine,
            sharing: this.service,
            logger: ctx.logger as any,
          });
          ctx.registerService('sharingRules', this.ruleService);

          // [ADR-0057 D6 / #2077] Seed stack-declared sharingRules into
          // sys_sharing_rule BEFORE listRules so the lifecycle hooks bind to a
          // populated table (previously rules were decorative — ruleCount: 0).
          try {
            let metadataService: IMetadataService | null = null;
            try { metadataService = ctx.getService<IMetadataService>('metadata'); } catch { /* optional */ }
            if (metadataService) {
              await bootstrapDeclaredSharingRules(this.ruleService, metadataService, engine, ctx.logger as any);
            }
          } catch (err: any) {
            ctx.logger.warn('SharingServicePlugin: sharing-rule seeding failed', { error: err?.message });
          }

          if (typeof engine.registerHook === 'function' && typeof engine.unregisterHooksByPackage === 'function') {
            const rules = await this.ruleService.listRules({ activeOnly: true }, { isSystem: true } as any);
            unbindAllRuleHooks(engine);
            bindRuleHooks(engine, this.ruleService, rules, ctx.logger as any);
            this.bindRuleRebindTriggers(engine, ctx);

            // [#7729] A rule whose recipient resolves through the BUSINESS-UNIT
            // graph changes audience when the graph moves, not when the shared
            // record is written — and `bindRuleHooks` above binds only on each
            // rule's own object, so a re-parent or a membership edit reached
            // nothing. Left unbound, a business unit moved OUT of a shared
            // subtree kept its members' read access until somebody happened to
            // write the shared record: a revocation with no bound in time.
            //
            // Bound OUTSIDE the rebind seam on purpose. It carries no rule
            // snapshot — the handler reads `listRules()` live on each BU write —
            // so a runtime-authored rule is picked up without a rebind, and
            // `unbindAllRuleHooks` (which every rebind calls) cannot tear it
            // down. Inside `enforce`, unlike the primary-BU projection next to
            // it: this one IS an access-control surface.
            bindBusinessUnitTreeRecompute(engine, this.ruleService, ctx.logger as any);

            // [#3896] Authoring a rule in Setup is a plain INSERT on
            // sys_sharing_rule — it bypasses defineRule's validation, so the
            // match-all criteria gate has to sit on the table itself too.
            bindRuleCriteriaGuard(engine, ctx.logger as any);

            // [#2909 T1] Stamp `customized` on admin edits of seeded rules so
            // the boot seeder stops overwriting them (seed-not-clobber).
            unbindRuleProvenanceStamp(engine);
            bindRuleProvenanceStamp(engine, ctx.logger as any);

            // [#2926 ③] Reconciling existing rows against every rule is
            // deferred to `kernel:bootstrapped` (below): seed data is loaded on
            // `kernel:ready` (raced against a budget, and the AppPlugin's seed
            // hook is a *different* kernel:ready handler), so a backfill here
            // would race the very records it must materialize. `kernel:bootstrapped`
            // fires only after every kernel:ready handler has settled.
          } else {
            ctx.logger.warn('SharingServicePlugin: engine has no hook API — sharing rule auto-evaluation disabled');
          }
        } catch (err: any) {
          ctx.logger.warn('SharingServicePlugin: sharing-rule subsystem not started', { error: err?.message });
        }
      }

      // ── Share-Link service (capability tokens) ────────────────
      //
      // Registered alongside the principal-based sharing service so
      // both surfaces resolve through the same kernel. The HTTP
      // endpoints are optional — services that just want programmatic
      // access can set `registerShareLinkRoutes: false` and call the
      // service via `ctx.getService('shareLinks')`.
      try {
        this.linkService = new ShareLinkService({
          engine: engine as SharingEngine,
          // [#5190] The cascade / orphan sweep report through the plugin logger.
          logger: ctx.logger as any,
          // [ADR-0111 D8] Let a record's share-manager (owner / Modify All)
          // revoke a link someone else minted on their record. `this.service`
          // is always constructed above — even under `enforce: false` (the
          // multi-tenant share-link-only config), where only the RLS middleware
          // is skipped — so the probe is available in every posture.
          canManageShares: this.service
            ? (o, r, c) => this.service!.canManageShares(o, r, c as any)
            : undefined,
        });
        ctx.registerService('shareLinks', this.linkService);

        if (this.options.registerShareLinkRoutes !== false) {
          // [#4251 B5] Canonical name FIRST, alias second. This read was
          // `http-server`-only, and that is the DEPRECATED alias: the ledger
          // records `http.server` as canonical and as the only name present on
          // every provider path (`runtime.ts`'s `config.server` path registers
          // no alias). On that path the share-link REST routes silently never
          // mounted. Per-name `try` because `getService` throws on an empty
          // slot, so both names cannot share one `try` (#4393).
          // Neither name present → no HTTP server; the service stays reachable
          // via getService.
          const readServer = (name: string): IHttpServer | null => {
            try { return ctx.getService<IHttpServer>(name); } catch { return null; }
          };
          const http: IHttpServer | null = readServer('http.server') ?? readServer('http-server');
          if (http) {
            // [Finding-2] Derive the caller from the platform's VERIFIED
            // resolution (session / API key / OAuth), never from spoofable
            // `x-user-id` headers. An unresolvable request → anonymous (the
            // authed routes then 401).
            //
            // [#6206 / #6430 — maintainer ruling A, 2026-08-07] The envelope is
            // handed on WHOLE. This assembly used to name four fields
            // (`userId`/`tenantId`/`positions`/`permissions`) and the resulting
            // object was passed straight into `engine.find` as the [Finding-2]
            // visibility check's context — so `accessible_org_ids`,
            // `org_user_ids`, `systemPermissions`, `posture` and
            // `tabPermissions` never reached enforcement. Under the `group`
            // tenancy posture `accessible_org_ids` IS the Layer 0 wall
            // (ADR-0105 D2) and an absent set DENIES, so link creation answered
            // a blanket 403 on a posture that ships. `posture` is likewise
            // resolved once by the resolver and carried (ADR-0095 D2) — never
            // re-derived at the enforcement site, which is exactly what a
            // per-site subset forces the next layer to do.
            //
            // A spread, not a field list, on purpose: a field list is how this
            // seam broke, and it breaks again the day `ResolvedAuthzContext`
            // grows a dimension nobody remembers to add here. The route's own
            // 401 decision reads `userId` off the same object (see
            // `ShareLinkExecutionContext` in the contract for that boundary).
            const ql = engine;
            const verifiedContextFromRequest = async (req: IHttpRequest): Promise<ExecutionContext> => {
              try {
                const headers = new Headers();
                for (const [k, v] of Object.entries(req.headers ?? {})) {
                  if (v == null) continue;
                  headers.set(String(k), Array.isArray(v) ? v.join(',') : String(v));
                }
                const getSession = async (h: any) => {
                  try {
                    // Both members are OPTIONAL on the contract, and that is
                    // load-bearing: the shipped plugin-auth registers an
                    // `AuthManager`, which has no `api` member at all (#4127
                    // batch 4), so on every real stack this falls through to
                    // `getApi()`. Typed, the optionality is visible; erased, the
                    // dead first branch looked like the primary path.
                    const authService = ctx.getService<IAuthService>('auth');
                    let api: AuthSessionApi | undefined = authService?.api;
                    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
                    return await api?.getSession?.({ headers: h });
                  } catch {
                    return undefined;
                  }
                };
                const authz = await resolveAuthzContext({ ql, headers, getSession });
                // `isSystem: false` states what the absence of the flag already
                // means (ADR-0118 D2: absence is never system) and matches what
                // both sibling transports build — `rest-server.ts` and
                // `runtime/src/security/resolve-execution-context.ts`.
                return { ...authz, isSystem: false };
              } catch {
                return {}; // anonymous → authed routes 401
              }
            };
            registerShareLinkRoutes(http, this.linkService, engine as SharingEngine, {
              basePath: this.options.shareLinkBasePath,
              contextFromRequest: verifiedContextFromRequest,
            });
            ctx.logger.info(
              'SharingServicePlugin: share-link routes mounted at ' +
                (this.options.shareLinkBasePath ?? '/api/v1/share-links'),
            );
          } else {
            ctx.logger.warn(
              'SharingServicePlugin: no HTTP server — share-link REST routes not registered. ' +
                'ShareLinkService is still reachable via kernel.getService("shareLinks").',
            );
          }
        }
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: share-link subsystem not started', { error: err?.message });
      }
    });

    // [#2926 ③] Materialize sharing grants for rows already present at boot —
    // notably SeedLoader-inserted seed records, whose write goes through the
    // isSystem short-circuit in the rule hooks and therefore never produces a
    // `sys_record_share`. Runs on `kernel:bootstrapped` — the anchor that fires
    // after every `kernel:ready` handler (including the AppPlugin seed loader)
    // has settled — so the reconcile sees the seeded rows. Idempotent: a runtime
    // write that already materialized a grant is reconciled to the same state.
    ctx.hook('kernel:bootstrapped', async () => {
      // [#3865] Normalise retired `access_level: 'full'` rows FIRST, so the
      // rule reconcile below materialises grants from already-canonical rules
      // (and any `full` share rows it re-grants land as `edit` in one pass
      // instead of being rewritten on the next boot).
      try {
        if (this.engine) await backfillRetiredAccessLevels(this.engine, ctx.logger as any);
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: access-level backfill (kernel:bootstrapped) failed', { error: err?.message });
      }

      // [#5103] Reclaim share rows whose RECORD no longer exists — the
      // convergence path for orphans the cascade could not have caught: rows
      // that predate it, a hook that failed, a process that died between the
      // delete and the revoke, and deletes on the one posture the cascade
      // deliberately skips (an unmarked system object). Runs BEFORE the
      // rule-grant passes and outside the `ruleService` guard: this sweep is
      // source-agnostic and must also run in the `enforce: false` posture,
      // where there is no rule service at all.
      //
      // Bounded per boot (keyset pages + a scan cap that reports itself) so a
      // table that only grows cannot make startup cost grow with it.
      try {
        if (this.service) {
          const swept = await this.service.sweepOrphanedRecordShares();
          if (swept.truncated) {
            ctx.logger.info(
              'SharingServicePlugin: orphaned share sweep hit its per-boot scan cap — the remaining ' +
                'rows are examined on the next boot',
              { scanned: swept.scanned, revoked: swept.revoked },
            );
          }
        }
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: orphaned record-share sweep (kernel:bootstrapped) failed', { error: err?.message });
      }

      // [#5190] The same pass for `sys_share_link`. Separate try/catch, not a
      // second statement inside the one above: a driver error reclaiming grants
      // must not also skip the capability tokens, which are the leftovers that
      // do not need a named recipient to be exercised. Same bounded shape
      // (keyset pages, a self-reporting scan cap), and — like the share sweep —
      // it runs in every posture, including `enforce: false`, where a host
      // mounts this plugin purely for the share-link surface.
      try {
        if (this.linkService) {
          const swept = await this.linkService.sweepOrphanedShareLinks();
          if (swept.truncated) {
            ctx.logger.info(
              'SharingServicePlugin: orphaned share-link sweep hit its per-boot scan cap — the ' +
                'remaining rows are examined on the next boot (they cannot be resolved meanwhile: ' +
                'the token check re-asks whether the record exists)',
              { scanned: swept.scanned, revoked: swept.revoked },
            );
          }
        }
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: orphaned share-link sweep (kernel:bootstrapped) failed', { error: err?.message });
      }

      if (!this.ruleService) return;
      try {
        // [#4433] EVERY rule, not `activeOnly` — a deactivated rule's grants
        // are withdrawn by reconciling it, so excluding inactive rules made
        // the boot pass structurally incapable of repairing them.
        const rules = await this.ruleService.listRules({}, { isSystem: true } as any);
        await backfillRuleGrants(this.ruleService, rules, ctx.logger as any);
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: boot rule backfill (kernel:bootstrapped) failed', { error: err?.message });
      }
      // [#4433] Grants whose rule row is gone entirely are unreachable by
      // reconciling rules — there is no rule left to iterate. Sweep them
      // separately so "the rule is gone" and "its access is gone" mean the
      // same thing after a restart, whichever path removed the rule.
      try {
        await this.ruleService.sweepOrphanedRuleGrants();
      } catch (err: any) {
        ctx.logger.warn('SharingServicePlugin: orphaned rule-grant sweep (kernel:bootstrapped) failed', { error: err?.message });
      }
      // Withdrawal is now complete for this boot; runtime rule writes own it
      // from here (see bindRuleRebindTriggers).
      this.ruleGrantsBootReconciled = true;
    });
  }
}

/**
 * Build the engine middleware that injects read filters and gates
 * write operations. Exported so it can be unit-tested without booting
 * a kernel. `log` is optional — the [ADR-0111 D10] delete-denial breadcrumb
 * is best-effort and absent in unit tests.
 *
 * [#5493] The by-id write gate DEFERS before it hard-refuses: a refusal is
 * checked against `service.probeAuthoredRowWrite`, the security service's
 * app-authored RLS verdict, and only stands when that verdict is not `admit`.
 * The probe is reached through the `security` late-binding the passed
 * {@link SharingService} already holds, so this builder's signature — and every
 * caller of it — is unchanged, and a stack without `@objectstack/plugin-security`
 * behaves exactly as before.
 */
export function buildSharingMiddleware(
  service: SharingService,
  log?: { warn?: (msg: string, meta?: any) => void },
): EngineMiddleware {
  return async function sharingMiddleware(ctx: OperationContext, next: () => Promise<void>) {
    const op = ctx.operation;
    const exec = ctx.context as any;

    // READS — AND the visibility filter into the AST.
    if (op === 'find' || op === 'findOne' || op === 'count' || op === 'aggregate') {
      // [ADR-0111 D5] `sys_record_share` sits on the sharing BYPASS list (the
      // enforcement queries must not recurse through their own gate), which
      // used to leave its read surface wide open — any authenticated caller
      // could enumerate every share row via `/data/sys_record_share` ("who can
      // see what", plus the share ids the revoke gate protects). Non-system
      // callers without sharing-admin capability are scoped to rows that NAME
      // them (as recipient or grantor); principal-less callers see nothing.
      // The Setup admin views hold `manage_sharing` (seeded into
      // `admin_full_access`; `manage_platform_settings` honoured as the legacy
      // gate those pages used) and keep the tenant-wide list.
      if (ctx.object === 'sys_record_share' && !exec?.isSystem) {
        const caps: string[] = Array.isArray(exec?.systemPermissions) ? exec.systemPermissions : [];
        if (!caps.includes('manage_sharing') && !caps.includes('manage_platform_settings')) {
          const selfScope = exec?.userId
            ? { $or: [{ recipient_id: exec.userId }, { granted_by: exec.userId }] }
            : { id: '__deny_all__' };
          const ast: any = ctx.ast ?? {};
          // [#8430] Same two marks as the general read merge below — this
          // branch is a merge boundary too, and its scope is as
          // platform-authored as any sharing filter.
          markFilterSubtreeProvenance(selfScope, 'policy');
          vouchCallerWhereBeforeRewrite(ast, ctx.options);
          ast.where = composeAnd(ast.where, selfScope);
          ast.filter = composeAnd(ast.filter, selfScope);
          ctx.ast = ast;
        }
        return next();
      }
      let filter = await service.buildReadFilter(ctx.object, exec ?? {});
      // [#8430, extending #8220 / A of the #7929 ruling] Mark the injected
      // sharing scope `'policy'` at the moment it is produced, BEFORE any
      // composition blurs it into a shared `$and`. Its refusals keep the
      // #7929 redaction — which is what they already got as an unmarked
      // subtree, so this changes no behaviour; it makes the withhold a
      // DECLARED verdict instead of an accident of the mark's absence, and
      // that matters the moment such a scope is ever nested inside a subtree
      // some other boundary vouched (an unmarked node INHERITS its ancestor's
      // mark positionally — `resolveFilterSubtreeProvenance`, innermost wins).
      markFilterSubtreeProvenance(filter, 'policy');
      // [ADR-0090 D10] Agent/service intersection on the OWD/sharing axis. When
      // the principal acts on behalf of a user, the owner-match and record
      // shares are IDENTITY-scoped — so we re-run the visibility filter under
      // the DELEGATOR's own identity + depth (stashed by plugin-security as
      // `__delegatorReadScope`) and AND it in. The delegated principal then
      // sees only rows BOTH identities may see (an over-privileged agent can
      // never exceed the user it stands in for). Non-delegated path unchanged.
      if (exec?.onBehalfOf?.userId) {
        const delFilter = await service.buildReadFilter(ctx.object, {
          ...exec,
          userId: exec.onBehalfOf.userId,
          onBehalfOf: undefined,
          __readScope: exec.__delegatorReadScope,
        });
        // [#8430] The delegator's visibility filter is policy the caller never
        // wrote either. Marked on its own object, so the `$and` wrapper
        // `composeAnd` builds around the pair leaves both arms marked.
        markFilterSubtreeProvenance(delFilter, 'policy');
        filter = composeAnd(filter, delFilter);
      }
      if (filter) {
        const ast: any = ctx.ast ?? {};
        // [#8430] The author half, and the only user-visible change on this
        // card: vouch the caller's own predicate BEFORE the rewrite below
        // makes it unrecognisable to every later boundary.
        vouchCallerWhereBeforeRewrite(ast, ctx.options);
        ast.where = composeAnd(ast.where, filter);
        ast.filter = composeAnd(ast.filter, filter);
        ctx.ast = ast;
      }
      return next();
    }

    // WRITES — gate on the per-VERB check. [ADR-0111 D3] update and delete no
    // longer share a gate: `canEdit` accepts an edit-level share, `canDelete`
    // does not (a share widens which rows a principal reaches, never which
    // verbs). The middleware picks the gate by `op`.
    if (op === 'update' || op === 'delete') {
      const verb: 'update' | 'delete' = op;
      const gate = (o: string, id: string, c: any) =>
        verb === 'delete' ? service.canDelete(o, id, c) : service.canEdit(o, id, c);
      const data: any = ctx.data;
      const options: any = ctx.options;
      const id = inferTargetId(data, options);
      if (id != null) {
        let ok = await gate(ctx.object, String(id), exec ?? {});
        // [ADR-0090 D10] The delegator must ALSO be able to perform the write —
        // an on-behalf-of write may only touch rows the delegator could touch.
        if (ok && exec?.onBehalfOf?.userId) {
          ok = await gate(ctx.object, String(id), {
            ...exec,
            userId: exec.onBehalfOf.userId,
            onBehalfOf: undefined,
            __writeScope: exec.__delegatorWriteScope,
          });
        }
        if (!ok) {
          // [#5493 / maintainer ruling 2026-08-08, issue comment 5226389104]
          // Row-level write authority is ONE composite determination. Before
          // this middleware HARD-REFUSES a by-id write, it asks the other half
          // whether an APP-AUTHORED RLS widener admits this row by declaration.
          //
          // The measured defect: on an object where record sharing enforces
          // (a `private`/`public_read` OWD *and* an `owner_id` field), this
          // gate answered FORBIDDEN before RLS was ever consulted, so an
          // app-declared update-widener was never asked. On an object where
          // sharing ABSTAINS — a `public` model, `controlled_by_parent`, or no
          // `owner_id` column — `canEdit` already answered `true` and the same
          // widener worked. Half a mechanism, discriminated by a property no
          // author declares.
          //
          // `admit` does NOT authorize the write: it retracts THIS authority's
          // refusal and hands the row to the security pre-image gate, which
          // composes per #6684/#5492 and makes the final row decision. Every
          // other outcome — `abstain`, no security service, a service without
          // the method, a throwing probe — leaves the refusal below untouched,
          // byte for byte.
          //
          // By-id only, and deliberately: the bulk path composes a FILTER
          // rather than a verdict and is tracked separately (#6736). Nothing
          // here touches it.
          const authored = await service.probeAuthoredRowWrite(
            ctx.object,
            String(id),
            verb,
            exec ?? {},
          );
          if (authored === 'admit') return next();

          // [ADR-0111 D10] A fail-closed delete denial gets a specific,
          // greppable reason so the "edit-share does not grant delete"
          // tightening is diagnosable rather than a mystery 403.
          if (verb === 'delete') {
            log?.warn?.(
              `[sharing] delete denied on ${ctx.object} ${id}: an edit-level share does not grant delete; ` +
                `delete requires ownership, write depth, or Modify All Data (ADR-0111 D3)`,
              { object: ctx.object, recordId: String(id), userId: exec?.userId },
            );
          }
          const err: any = new Error(
            `FORBIDDEN: insufficient privileges to ${op} ${ctx.object} ${id}`,
          );
          err.code = 'FORBIDDEN';
          err.status = 403;
          throw err;
        }
        return next();
      }

      // Bulk (multi) write — no single id to gate (#2982). AND the writable-rows
      // filter into the AST so the update/delete only touches rows the caller
      // may write, exactly as the read path scopes finds. The verb is threaded
      // through so a bulk DELETE scopes to owned rows alone (no share widening),
      // while a bulk UPDATE keeps the edit-share widening (ADR-0111 D3).
      //
      // [#8792, maintainer ruling 2026-08-15] ⛔ This merge carries NO
      // `markFilterSubtreeProvenance` and NO `vouchCallerWhereBeforeRewrite`,
      // and that is RULED, not an oversight. #8220 declares the mark for
      // READ-scope merge boundaries; write-scope refusal semantics stay
      // deliberately unspecified rather than inherited from it. So the
      // asymmetry with the read path above — which marks each injected scope
      // `'policy'` and vouches the caller's `where` `'author'` — is the ruled
      // boundary itself. ⛔ Do not "complete" the pattern here. Why:
      //
      //  - nothing is disclosed by the omission. Unmarked ⇒ WITHHELD, so a
      //    cross-field refusal raised anywhere in this composed tree already
      //    keeps the #7929 redaction. Unmarked is the SAFE fail direction, and
      //    it is what happens today;
      //  - marking the injected filter `'policy'` would therefore change no
      //    behaviour at all, and the only thing the `'author'` vouch would ADD
      //    is the author's own diagnostic on the author's own predicate — an
      //    author-experience gain, never a disclosure fix;
      //  - ⚠️ and that gain is not free, which is the real reason. Vouching the
      //    caller's `where` on a WRITE boundary WIDENS what a bulk
      //    update/delete refusal is permitted to name, on a boundary whose
      //    current behaviour is exactly that redaction. Widening a disclosure
      //    surface is a product decision wearing a lint's clothing;
      //  - and there is no inherited answer to widen it BY. A bulk write that
      //    refuses has already passed the per-verb gate (ADR-0111 D3) and the
      //    `probeAuthoredRowWrite` deferral above, so "what may a refusal name
      //    here" is a question read scope never had to answer.
      //
      // Re-open trigger, named by the ruling so this is not a permanent "no":
      // a real report of an author unable to diagnose a bulk-write refusal on
      // their own predicate. That makes the extension a pulled feature with a
      // consumer attached, and it returns as a decision — with write-scope
      // refusal semantics to specify and pin at a real driver, and #8836's
      // request-scoped invariant to carry (no filter object that can be
      // vouched `'author'` may outlive the request that vouched it).
      let writeFilter = await service.buildWriteFilter(ctx.object, exec ?? {}, verb);
      // [ADR-0090 D10] Intersect the delegator's writable set for on-behalf-of.
      if (exec?.onBehalfOf?.userId) {
        const delFilter = await service.buildWriteFilter(ctx.object, {
          ...exec,
          userId: exec.onBehalfOf.userId,
          onBehalfOf: undefined,
          __writeScope: exec.__delegatorWriteScope,
        }, verb);
        // [#8792] Unmarked deliberately too — same ruling, same reasons as
        // above, not repeated here. Its read-path twin (the delegator's
        // `buildReadFilter`) IS marked `'policy'`; that difference is the ruled
        // read/write boundary, not drift between two copies of one pattern.
        writeFilter = composeAnd(writeFilter, delFilter);
      }
      if (writeFilter) {
        const ast: any = ctx.ast ?? {};
        ast.where = composeAnd(ast.where, writeFilter);
        ast.filter = composeAnd(ast.filter, writeFilter);
        ctx.ast = ast;
      }
      return next();
    }

    // INSERT / others pass through — ownership stamping is the
    // application's job (and is enforced by existing field defaults).
    return next();
  };
}

/**
 * [#8430, extending #8220 / A of the #7929 maintainer ruling 2026-08-12]
 * Vouch the caller's own predicate as `'author'` in the instant before this
 * middleware rewrites `ast.where` — the third read-scope merge boundary, after
 * `plugin-security`'s CRUD injection and `service-analytics`' `withReadScope`.
 *
 * ## The identity vouch, and why it is the whole safety argument
 *
 * The mark is stamped ONLY when `ast.where` is still, by object identity, the
 * `where` the caller handed the engine (`options.where` — the engine builds the
 * AST by spread and `resolveWhereTokens` returns its input by reference on a
 * placeholder-free tree, so identity holds for an untouched query). That
 * identity is the entire evidence base: if it holds, every node inside the
 * subtree is the caller's own, so vouching the subtree cannot vouch anyone
 * else's predicate. If a sibling middleware already composed into `ast.where`,
 * or the engine rewrote it resolving `{current_user_id}`-style tokens, identity
 * FAILS and nothing is vouched — the tree stays unmarked, and unmarked
 * WITHHOLDS. ⛔ Never widen this to a shape test or a "looks like the caller's"
 * heuristic: the mark is permission to reveal, never a guess, and a wholesale
 * mark on a tree that might hold another plugin's policy would disclose it.
 *
 * ## Why the arms of a pure `{$and:[…]}` are marked too
 *
 * {@link composeAnd} below has two branches, and they treat a mark differently.
 * The nesting branch keeps the caller's object IN the tree, so a mark on it
 * survives by reference. The FLATTENING branch — taken for a pure
 * `{$and:[…]}`, which is exactly what `lowerWhereFilterArray`/`parseFilterAST`
 * produce for the array authoring form — spreads the arms into a NEW root and
 * drops the marked object out of the tree entirely, taking the vouch with it.
 * Marking each arm as well is not a widening of the claim: the identity vouch
 * already attests the whole subtree is the caller's, and an arm of it is a
 * strictly smaller part of the same subtree. The condition mirrors
 * `composeAnd`'s own, so the arms are marked exactly when they are about to be
 * spread — ⛔ keep the two in step if either changes.
 *
 * Marking is first-mark-wins and never throws (see
 * `markFilterSubtreeProvenance`), so calling this when `plugin-security` has
 * already vouched the same object is a no-op, and a frozen caller filter simply
 * stays unmarked — withheld.
 */
function vouchCallerWhereBeforeRewrite(ast: { where?: unknown }, options: unknown): void {
  const callerWhere = ast.where;
  if (callerWhere === null || typeof callerWhere !== 'object') return;
  if (callerWhere !== (options as { where?: unknown } | undefined)?.where) return;
  markFilterSubtreeProvenance(callerWhere, 'author');
  const arms = (callerWhere as { $and?: unknown }).$and;
  if (Array.isArray(arms) && Object.keys(callerWhere).length === 1) {
    for (const arm of arms) markFilterSubtreeProvenance(arm, 'author');
  }
}

function composeAnd(existing: unknown, addition: unknown): unknown {
  if (existing == null) return addition;
  if (addition == null) return existing;
  // Both objects — merge with $and.
  if (
    typeof existing === 'object' && existing !== null && !Array.isArray(existing) &&
    typeof addition === 'object' && addition !== null && !Array.isArray(addition)
  ) {
    const ex: any = existing;
    // Flatten only when `existing` is a PURE `{$and:[…]}` — an object mixing
    // `$and` with sibling top-level keys (`{$and:[…], status:'x'}`) must NOT be
    // spread, or those siblings are silently DROPPED (a caller's AND-ed
    // predicate quietly widening the write — data loss on bulk delete/update).
    if (Array.isArray(ex.$and) && Object.keys(ex).length === 1) {
      return { $and: [...ex.$and, addition] };
    }
    // Otherwise nest the whole existing object into $and to preserve semantics.
    return { $and: [existing, addition] };
  }
  return { $and: [existing, addition] };
}

function inferTargetId(data: any, options: any): string | number | undefined {
  if (data && typeof data === 'object' && data.id != null) return data.id;
  if (options && typeof options === 'object') {
    if (options.id != null) return options.id;
    if (options.where && typeof options.where === 'object' && options.where.id != null) {
      return options.where.id;
    }
    if (options.filter && typeof options.filter === 'object' && options.filter.id != null) {
      return options.filter.id;
    }
  }
  return undefined;
}
