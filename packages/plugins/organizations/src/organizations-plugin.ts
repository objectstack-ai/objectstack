// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import { claimOrphanOrgRows } from './claim-orphan-org-rows.js';
import { isDefaultOrganizationBootstrapTrigger } from '@objectstack/plugin-auth';
import { ensureDefaultOrganization } from './ensure-default-organization.js';
import { assertWalledMembershipPolicyDeclared } from './membership-policy-gate.js';
import {
  organizationsObjects,
  organizationsPluginManifestHeader,
} from './manifest.js';

/**
 * Resolve a kernel service that may be registered ASYNC (a service factory).
 *
 * The real kernel's sync `getService` THROWS "Service '<name>' is async - use
 * await" for factory-registered services — which silently disabled the
 * primary per-org seed-replay path on every boot (the `seed-replayer`
 * callable AppPlugin registers is async; #881). Prefer `getServiceAsync`
 * when the host exposes it; fall back to the sync lookup for embeddings and
 * tests that register plain values. Returns `undefined` when the service is
 * not registered either way — callers decide how loudly that matters.
 */
async function resolveKernelService(kernel: any, name: string): Promise<any> {
  if (typeof kernel?.getServiceAsync === 'function') {
    try {
      const svc = await kernel.getServiceAsync(name);
      if (svc != null) return svc;
    } catch {
      /* not registered async — try the sync path below */
    }
  }
  try {
    return kernel?.getService?.(name);
  } catch {
    return undefined;
  }
}

export interface OrganizationsPluginOptions {
  /**
   * Whether to auto-create a `Default Organization` (slug `default`)
   * and bind the first platform admin as `owner` when they have zero
   * memberships. Set to `false` for deployments that fully self-manage
   * org provisioning via invitation links or a custom onboarding flow.
   *
   * @default true
   */
  ensureDefaultOrganization?: boolean;

  // ⛔ There is deliberately NO option here for cloning one organization's
  // rows into another (cloud#1345). `cloneSeedDataUnderGroupPosture` used to
  // sit at this spot, gating a donor-org clone that ran by default under
  // `isolated`. Both the option and the clone are gone: the maintainer's
  // ruling denies the REQUIREMENT, not merely the default, so there is no
  // knob to re-enable and none is to be re-added. Demo data on signup is the
  // app's own seed definitions replayed per tenant (`seed-datasets` /
  // `seed-replayer`).
}

/**
 * OrganizationsPlugin — the multi-organization runtime, in open core
 * (ADR-0132; cloud ADR-0081 D2 had moved it to the commercial runtime and
 * this is the round trip back). The machinery shipped here originally as
 * `plugin-org-scoping`, was migrated verbatim into the closed
 * `@objectstack/organizations`, and has now returned under that second name —
 * the service name `org-scoping` was kept on purpose through both moves, so
 * no consumer ever had to follow it. What stays commercial is the
 * ENTITLEMENT and nothing else.
 *
 * ⚠️ A package with this exact name also exists, private, in the commercial
 * repo, and that is the DESIGN, not a collision to repair. It subclasses this
 * class and calls its licence gate in its own constructor; every commercial
 * host declares the name as `workspace:*`, which pnpm can only resolve to
 * that local package — never to the registry — so a commercial deployment
 * mounts the gated subclass while an open deployment, declaring the same name
 * from npm, mounts this one. One spelling, resolved from the manifest that
 * declares it. ⛔ Do not "de-duplicate" the two by giving this class a way to
 * know which it is.
 *
 * Makes `sys_organization` a first-class row-level isolation boundary:
 *
 *   1. **insert auto-stamp** — on every authenticated `insert` whose
 *      target object declares `organization_id`, fill the column from
 *      `ExecutionContext.tenantId`. Without this, freshly-created
 *      rows have `organization_id = NULL` and the default
 *      `tenant_isolation` RLS policy hides them from the very user
 *      who just created them.
 *
 *   2. **per-org seed replay** — after `sys_organization` insert, load
 *      the APP's own demo seed data into the new org. Two paths:
 *        a. replay registered `seed-datasets` via the kernel-level
 *           `seed-replayer` callable (set by AppPlugin),
 *        b. for the FIRST org, `claimOrphanOrgRows` adopts any
 *           NULL-org rows a previous inline-seed may have inserted.
 *      Neither reads another organization's rows, and that is the
 *      INVARIANT (cloud#1345): a new organization's data comes from
 *      the app's seed definitions, or the organization starts empty.
 *      A third path used to exist — `cloneOrgSeedData` shallow-cloned
 *      the FIRST organization's business rows into every subsequent
 *      one — and it is retired, not disabled: on a self-serve SaaS
 *      deployment it handed customer #2 a copy of customer #1's
 *      records. ⛔ Do not re-add a donor-clone path here in any form.
 *
 *   3. **default-org bootstrap** — on `kernel:ready` and after every
 *      `sys_user_permission_set` insert, ensure the platform admin has
 *      a Default Organization to operate in (idempotent on slug
 *      `default` + admin's existing memberships).
 *
 * Why split from plugin-security:
 *   - plugin-security is a single-tenant-aware RBAC + RLS engine; it
 *     should not know about Organization-specific seed flows.
 *   - This plugin is purely opt-in: not installing it gives a
 *     single-ORG deployment (no `organization_id` injection, no per-org
 *     seed replay; the member-management BASICS — single-org default-org
 *     bootstrap + better-auth invitations — stay in the open plugin-auth,
 *     cloud ADR-0081 D1). plugin-security detects this plugin's presence via
 *     `getService('org-scoping')` and adjusts RLS policy stripping
 *     accordingly.
 *
 * Naming note: "org-scoping" deliberately avoids the word "tenant"
 * because in ObjectStack "tenant" already means *physical isolation*
 * (one Environment = one database, per ADR-0002 and driver-turso's
 * multi-tenant router). This plugin is about LOGICAL row-level
 * scoping inside a single database — orthogonal to physical tenancy.
 *
 * Dependencies:
 *   - `objectql` (engine middleware host)
 */
export class OrganizationsPlugin implements Plugin {
  name = 'com.objectstack.organizations';
  type = 'standard' as const;
  version = '1.0.0';
  dependencies = ['com.objectstack.engine.objectql'];

  /**
   * [ADR-0105 D12, as amended by ADR-0132] Which tenancy postures THIS runtime
   * entitles.
   *
   * The core reads this off the `org-scoping` service and fails closed on any
   * posture not listed (`OrgScopingEntitlement` in
   * `@objectstack/spec/security`). ADR-0105 D12 argued this declaration into
   * the commercial runtime, on the reasoning that "which shapes of multi-org"
   * is a PACKAGING question open core should not answer. ADR-0132 settles it
   * the other way for the open package: **an open install is entitled to both
   * walled postures by construction.** There is no packaging question left to
   * answer here — an installation that has this package has the wall, in both
   * of the shapes the wall comes in — so the declaration below is the
   * open runtime's own constant, not a tier.
   *
   * Declared explicitly even though it matches the core default (omitting the
   * field entitles every walled posture), because the two `readonly` names are
   * what `OrgScopingEntitlement` reads and a silent default is harder to trace
   * from a boot refusal than a literal is. Removing a posture makes every
   * deployment that requested it refuse to boot (ADR-0093 D5).
   *
   * ⛔ And this is NOT the place a tier is drawn. The sentence that used to
   * stand here invited the opposite — narrowing the boundary later, "gating it
   * behind a licence flag", was advertised as a one-line edit at this spot.
   * That edit is now forbidden in this file and in this package: ADR-0132
   * boundary 3 is that the open package carries no licence check of any kind,
   * offers no hook for one, and takes no entitlement callback. A deployment
   * that wants multi-org gated buys that from the commercial runtime, which
   * subclasses this class and answers its own gate in its own constructor —
   * cloud code, cloud gate, on cloud's side of the split.
   *
   * - `isolated` — the hard legal-entity wall (`organization_id = active org`).
   * - `group` — organizations as membership boundaries over one shared dataset,
   *   with union read access (`organization_id IN accessible_org_ids`).
   */
  readonly supportedPostures: readonly ('single' | 'group' | 'isolated')[] = ['group', 'isolated'];

  /** Per-object field-name cache; same shape as SecurityPlugin's. */
  private readonly fieldNamesCache = new Map<string, Set<string> | null>();

  private readonly opts: Required<OrganizationsPluginOptions>;

  // ⛔ NO LICENCE GATE HERE, and none is to be added (ADR-0132 boundary 3).
  // The closed package's constructor opened with `assertMultiOrgEntitled()`;
  // that call and its gate stayed in `@objectstack/organizations` when the
  // rest of this file moved. Constructing this plugin is enough to run
  // multi-org, on purpose — that IS the decision, not an omission someone
  // should repair. The commercial runtime keeps the refusal by SUBCLASSING:
  // its own `OrganizationsPlugin extends` this one and calls its gate in its
  // own constructor, so the entitlement is answered at construction exactly
  // as before (cloud#1020's requirement) with no seam on this side.
  // ⛔ Do not add an `assertEntitled` option, a hook, a callback, or a
  // protected method for a subclass to override "for" gating — any of those
  // is the hook boundary 3 forbids, and a host could reach it.
  constructor(options: OrganizationsPluginOptions = {}) {
    this.opts = {
      ensureDefaultOrganization: options.ensureDefaultOrganization !== false,
    };
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing Organizations Plugin...');
    // The service name stays 'org-scoping' ON PURPOSE (cloud ADR-0081 D2, kept by ADR-0132): it is
    // plugin-security's "multi-tenant mode is on" probe (SecurityPlugin
    // queries `getService('org-scoping')` and keeps wildcard
    // `current_user.organization_id` RLS policies when this returns) AND the
    // `requiresService: 'org-scoping'` nav-gate anchor. Renaming it would
    // silently flip RLS posture and nav visibility across every deployment.
    ctx.registerService('org-scoping', this);

    ctx
      .getService<{ register(m: any): void }>('manifest')
      .register({
        ...organizationsPluginManifestHeader,
        objects: organizationsObjects,
      });
    ctx.logger.info('Organizations Plugin initialized');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Starting Organizations Plugin...');

    // ── MEMBERSHIP-POLICY gate (cloud#1092) ──────────────────────────
    // A walled deployment must DECLARE what a new user joins; running
    // the framework default `auto` because nobody said otherwise is
    // refused. See membership-policy-gate.ts for what counts as a
    // declaration and why the undeclared case is fatal rather than a
    // warning.
    //
    // FIRST statement of start(), above the ObjectQL probe below, so no
    // early return can skip it — the wall is being mounted either way.
    //
    // On `kernel:bootstrapped`, not here and not `kernel:ready`:
    //   • the answer lives in the `auth` settings namespace, and
    //     SettingsServicePlugin late-binds its DATA ENGINE inside its own
    //     `kernel:ready` handler. Reading during Phase 2 — or from an
    //     earlier `kernel:ready` handler, since hook order is registration
    //     order — sees env + manifest defaults only, so a deployment that
    //     configured `invite-only` through Setup (a stored `sys_setting`
    //     row) would be refused for not having configured it.
    //   • `kernel:bootstrapped` is the framework's documented "all
    //     synchronous bootstrap has settled" anchor and it fires BEFORE
    //     `kernel:listening` opens the socket — so this is still a boot
    //     refusal, not a runtime one. No request is ever served by a
    //     deployment this rejects.
    //
    // Throwing (not `process.exit`) is deliberate: kernel bootstrap
    // propagates it, `objectstack serve` prints the message verbatim and
    // exits 1, and a multi-tenant host embedding this plugin can catch it
    // per-kernel instead of taking down every other environment it serves.
    const runMembershipPolicyGate = () => assertWalledMembershipPolicyDeclared(ctx);
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:bootstrapped', runMembershipPolicyGate);
    } else {
      // No hook seam (a lean embedding / test kernel). Run it inline: a
      // deployment that cannot be asked later must still be asked.
      await runMembershipPolicyGate();
    }

    let ql: any;
    let metadata: any;
    try {
      ql = ctx.getService('objectql');
      try {
        metadata = ctx.getService('metadata');
      } catch {
        metadata = undefined;
      }
    } catch {
      ctx.logger.warn(
        'ObjectQL service not available, org-scoping middleware not registered',
      );
      return;
    }
    if (!ql || typeof ql.registerMiddleware !== 'function') {
      ctx.logger.warn(
        'ObjectQL engine does not support middleware, org-scoping middleware not registered',
      );
      return;
    }

    // ── Middleware A: auto-stamp `organization_id` on insert ──────────
    ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.context?.isSystem) return next();
      if (
        opCtx.operation === 'insert' &&
        opCtx.data &&
        typeof opCtx.data === 'object' &&
        !Array.isArray(opCtx.data) &&
        opCtx.context?.tenantId
      ) {
        const fields = await this.getObjectFieldNames(metadata, opCtx.object, ql);
        if (fields && fields.has('organization_id')) {
          const data = opCtx.data as Record<string, unknown>;
          // [#2937] AUTHORITATIVE stamp for USER-context inserts. A user may not
          // choose which tenant a row lands in: their insert ALWAYS carries the
          // caller's active organization, so a supplied — possibly FORGED —
          // `organization_id` pointing at another org is OVERWRITTEN, never
          // trusted. (Previously this only FILLED a missing value, so a forged
          // non-empty value slipped through and — absent the Layer 0 insert
          // post-image check — landed in the victim tenant.) `isSystem`
          // short-circuited above (line ~136), so legitimate on-behalf writes
          // that deliberately set another org — the per-org seed replay
          // / orphan-claim, imports, migrations — run under SYSTEM_CTX and are
          // untouched. A non-`isSystem` context with a tenant but NO principal
          // (a service acting with an org scope) keeps the prior fill-only
          // semantics so it can still set an explicit value.
          const isUserContext = !!opCtx.context.userId;
          if (isUserContext) {
            data.organization_id = opCtx.context.tenantId;
          } else if (data.organization_id == null || data.organization_id === '') {
            data.organization_id = opCtx.context.tenantId;
          }
        }
      }
      await next();
    });

    // ── Middleware B: per-org seed pipeline on sys_organization insert ─
    ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      await next();
      if (
        opCtx?.object !== 'sys_organization' ||
        (opCtx?.operation !== 'create' && opCtx?.operation !== 'insert')
      ) {
        return;
      }
      const newOrgId = opCtx?.result?.id ?? opCtx?.data?.id;
      if (!newOrgId) return;

      const kernel: any = (ctx as any).kernel ?? ctx;
      const datasetsRaw = await resolveKernelService(kernel, 'seed-datasets');
      const datasets: any[] | undefined =
        Array.isArray(datasetsRaw) && datasetsRaw.length > 0 ? datasetsRaw : undefined;

      // Count existing orgs to pick the right fallback path.
      let orgCount = 0;
      try {
        const allOrgs = await ql.find(
          'sys_organization',
          { limit: 2, fields: ['id'] },
          { context: { isSystem: true } },
        );
        const list: any[] = Array.isArray(allOrgs)
          ? allOrgs
          : Array.isArray(allOrgs?.records)
            ? allOrgs.records
            : [];
        orgCount = list.length;
      } catch (e) {
        ctx.logger.warn('[org-scoping] failed to count organizations', {
          error: (e as Error).message,
        });
      }

      // Primary path: SeedLoader replay scoped to newOrgId.
      let replayed = false;
      try {
        const replayer: any = await resolveKernelService(kernel, 'seed-replayer');
        if (typeof replayer === 'function') {
          const summary = await replayer(newOrgId);
          const total = (summary?.inserted ?? 0) + (summary?.updated ?? 0);
          ctx.logger.info(
            `[org-scoping] per-org seed replay for ${newOrgId}: +${summary?.inserted ?? 0} inserted, ${summary?.updated ?? 0} updated, ${summary?.errors?.length ?? 0} error(s)`,
            {
              organizationId: newOrgId,
              errors: summary?.errors?.slice?.(0, 5),
            },
          );
          if (total > 0) replayed = true;
        } else if (datasets) {
          ctx.logger.warn(
            '[org-scoping] per-org seed: datasets present but no replayer registered',
            { organizationId: newOrgId },
          );
        }
      } catch (e) {
        ctx.logger.warn(
          '[org-scoping] per-org seed replay failed, falling back',
          { organizationId: newOrgId, error: (e as Error).message },
        );
      }
      if (replayed) return;

      // Fallback A: legacy claim for first org.
      if (orgCount === 1) {
        try {
          const claims = await claimOrphanOrgRows(ql, newOrgId, { logger: ctx.logger });
          if (claims.length > 0) {
            const total = claims.reduce((s, c) => s + c.count, 0);
            ctx.logger.info(
              `[org-scoping] claimed ${total} orphan seed row(s) for first organization ${newOrgId}`,
              { breakdown: claims },
            );
            return;
          }
        } catch (e) {
          ctx.logger.warn('[org-scoping] claim-orphan-org-rows failed', {
            error: (e as Error).message,
          });
        }
      }

      // ⛔ NO THIRD PATH (cloud#1345). There used to be a "Fallback B"
      // here: for every org after the first, `cloneOrgSeedData`
      // shallow-copied the FIRST organization's business rows into the
      // new one. On a self-serve SaaS deployment — one database, orgs
      // that are real customers (cloud#1331) — that meant customer #2's
      // signup cloned customer #1's accounts, contacts and
      // opportunities into their org. The wall then isolated the two
      // copies correctly; the disclosure had already happened at clone
      // time.
      //
      // The maintainer's ruling (2026-08-16) denies the REQUIREMENT,
      // not merely the default: 「每个新组织注册时克隆第一个组织的全部
      // 业务行，没有这个需求啊，比如 hotcrm seed 数据应该从代码中加载。」
      // So it is removed rather than defaulted off — a template-donor
      // variant is equally unwanted, and a disabled copy is a permanent
      // maintenance obligation bought for nothing.
      //
      // Where a populated-on-signup experience IS wanted, it comes from
      // the app's own seed definitions replayed per tenant — the
      // primary path above. An org whose deployment ships no seed
      // datasets simply starts EMPTY, which is the correct outcome.
      if (orgCount > 1 && !replayed) {
        ctx.logger.info(
          `[org-scoping] organization ${newOrgId} starts empty: no app seed datasets replayed. ` +
            'Demo data on signup comes from the app\'s own seed definitions — never from another organization\'s rows (cloud#1345).',
          { organizationId: newOrgId },
        );
      }
    });

    // ── Default-org bootstrap on kernel:ready + on admin grant ────────
    if (this.opts.ensureDefaultOrganization) {
      const runEnsure = async () => {
        try {
          const res = await ensureDefaultOrganization(ql, { logger: ctx.logger });
          if (res.defaultOrgCreated) {
            ctx.logger.info(
              `[org-scoping] created Default Organization ${res.defaultOrgId} for platform admin`,
            );
          }
        } catch (e) {
          ctx.logger.warn?.('[org-scoping] ensureDefaultOrganization failed', {
            error: (e as Error).message,
          });
        }
      };
      if (typeof (ctx as any).hook === 'function') {
        (ctx as any).hook('kernel:ready', runEnsure);
      } else {
        void runEnsure();
      }
      // Re-run after every write that can move the "who is the platform
      // admin" answer, asking the framework's OWN predicate rather than a
      // second opinion about it (#13685 exports it for exactly
      // this — "every wiring consumes the SAME predicate instead of
      // re-deriving it", the `shouldReplayBootstrapFor` pattern).
      //
      // Why this stopped being "on admin grant" alone: #13514
      // (L4) retired the walled grant row, so on a walled deployment the
      // grant-insert arm never fires again and `kernel:ready` (which runs
      // before any user exists) was the only run left — the default org
      // never appeared, which is how cloud's guided-path suite caught it.
      // The declared owner becomes resolvable on the `sys_user` write that
      // creates the row or moves `email`/`email_verified`, and those arms
      // are in the predicate. The helper is idempotent and short-circuits in
      // one query once the org exists, so the extra re-runs are cheap.
      ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        await next();
        if (isDefaultOrganizationBootstrapTrigger(opCtx ?? {})) {
          await runEnsure();
        }
      });
    }

    ctx.logger.info('Organizations middleware registered on ObjectQL engine');
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Resolve the column-name set for an object (mirrors SecurityPlugin's
   * loader so the two plugins behave consistently). Returns `null` if
   * the schema can't be loaded — caller skips injection.
   */
  private async getObjectFieldNames(
    metadata: any,
    objectName: string,
    ql?: any,
  ): Promise<Set<string> | null> {
    if (this.fieldNamesCache.has(objectName)) {
      return this.fieldNamesCache.get(objectName) ?? null;
    }
    const result = await this.loadObjectFieldNames(metadata, objectName, ql);
    if (result) this.fieldNamesCache.set(objectName, result);
    return result;
  }

  private async loadObjectFieldNames(
    metadata: any,
    objectName: string,
    ql?: any,
  ): Promise<Set<string> | null> {
    try {
      let obj: any =
        typeof ql?.getSchema === 'function' ? ql.getSchema(objectName) : null;
      if (!obj || !obj.fields) {
        obj = await metadata?.get?.('object', objectName);
      }
      if (!obj || !obj.fields) return null;
      const set = new Set<string>(['id']);
      if (Array.isArray(obj.fields)) {
        for (const f of obj.fields) {
          if (f?.name) set.add(String(f.name));
        }
      } else if (typeof obj.fields === 'object') {
        for (const key of Object.keys(obj.fields)) {
          set.add(key);
          const v = (obj.fields as Record<string, any>)[key];
          if (v && typeof v === 'object' && v.name) set.add(String(v.name));
        }
      } else {
        return null;
      }
      return set;
    } catch {
      return null;
    }
  }
}
