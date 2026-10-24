// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 13] What `SecurityPlugin#start` registers after the
 * authorization middleware, moved out of `security-plugin.ts`: the run of
 * statements from the position-catalog refusal to the end of `start()`. In the
 * order they stand, it registers the `sys_user_position` catalog refusal and
 * the grant-holder membership refusal on the engine, the permission-set name
 * hooks, the platform bootstrap on `kernel:ready` (the managed-object write
 * denies, the platform-admin bootstrap, the permission-door registrations and
 * the audience-binding sync), the boot reports on `kernel:bootstrapped`, the
 * middleware that replays the bootstrap after a qualifying write, the
 * `sys_member` middleware that reconciles `organization_admin` grants, and the
 * `organization_admin` backfill on `kernel:ready`.
 *
 * A MOVE, not a redesign. The function below is that run of statements as it
 * stood in `start()`, with every comment above and between them, re-indented
 * one level and otherwise unedited. It registers the same things in the same
 * order, with the same once-guards: the run's own `let` locals, which nothing
 * else in `start()` read. `start()` calls it from the same place, right after
 * it logs the security middleware's registration, and the comment that closed
 * `start()` stays there.
 *
 * ## How the run reaches the class
 *
 * The shape cuts 11 and 12 used for one statement of `start()`
 * (`security-plugin-security-service.ts`, `security-plugin-authz-middleware.ts`),
 * here for a run of statements. The run closed over two of `start()`'s locals
 * and nothing else, the plugin context and the engine, so the function takes
 * them as parameters, typed as the run saw them. A method is handed over as a
 * closure that calls it on the plugin at call time, so a test double or spy
 * set on the plugin is still the one the hooks reach.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `bootstrapPermissionSets` is declared `readonly`, so it goes by value: the
 * same array, whose sets the managed-object denies extend in place.
 * `metadata` and `tenancyPosture` are not, so they go as GETTERS, read when
 * the hooks run. `claimTargetAdminUserId` is the one member the run WRITES:
 * the bootstrap records the platform admin it found or promoted, which the
 * seed-ownership claim re-owns seeded rows to. It goes as a get/set pair, the
 * shape `auth-manager-request-routing.ts` used for its memo (#25508), so the
 * write lands on the plugin, where the claim reads it.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import { type PluginContext, createSecurityCatalogReader } from '@objectstack/core';
import type { IObjectQLEngine, SeedSettlementSnapshot } from '@objectstack/spec/contracts';
import { postureEnforcesWall } from '@objectstack/spec/security';
import type { SecurityPlugin } from './security-plugin.js';
import { POSITION_ASSIGNMENT_OBJECT, createPositionCatalogRefusal } from './position-catalog-refusal.js';
import { registerGrantHolderMembershipRefusal } from './grant-holder-membership-refusal.js';
import { registerGrantPermissionSetNameHooks } from './grant-permission-set-name.js';
import { reportCatalogReferences } from './catalog-reference-report.js';
import {
  reportAccessUpgrade,
  SHARING_RULES_SERVICE,
  type AccessUpgradeNotifier,
  type DeclaredSharingRuleReader,
} from './access-upgrade-report.js';
import { reportUpgradeImpact, SETTINGS_SERVICE, type SettingsManifestReader } from './upgrade-impact-report.js';
import { applyManagedWriteDenies } from './managed-object-write-denies.js';
import { reportPackagedPermissionSetOverlays } from './packaged-permission-set-overlay-detection.js';
import { registerObjectPostureGate } from './object-posture-gate.js';
import { registerPackagedPermissionSetLockGate } from './packaged-permission-set-lock-gate.js';
import { registerSecurityCatalogEcho, echoStoredSecurityCatalogOverlays } from './security-catalog-echo.js';
import { reconcileAudienceBindingSuggestions } from './suggested-audience-bindings.js';
import { cleanupPackagePermissions } from './cleanup-package-permissions.js';
import { readDeclared } from './declared-capability-context.js';
import { readSeededRecordIds, readSeedSettlementSnapshot } from './security-plugin-seed-claim.js';
import { bootstrapPlatformAdmin, shouldReplayBootstrapFor } from './bootstrap-platform-admin.js';
import {
  backfillOrgAdminGrants,
  extractMemberPairs,
  reconcileOrgAdminGrant,
} from './auto-org-admin-grant.js';

/**
 * The `SecurityPlugin` members the function below reads or writes — every one
 * of them, and no other; the function's `this` is the `Pick` of them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member the
 * class does not have is a compile error. Fields the run only reads are
 * `readonly` here; `claimTargetAdminUserId`, which it writes, is not. See the
 * module header for which members are getters and which is a get/set pair.
 */
export interface StartHooksHost {
  readonly bootstrapPermissionSets: SecurityPlugin['bootstrapPermissionSets'];
  claimTargetAdminUserId: SecurityPlugin['claimTargetAdminUserId'];
  readonly metadata: SecurityPlugin['metadata'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  declareEveryone: SecurityPlugin['declareEveryone'];
  deploymentAcceptance: SecurityPlugin['deploymentAcceptance'];
  deploymentOrgScopingEntitlement: SecurityPlugin['deploymentOrgScopingEntitlement'];
}

/** The registrations `SecurityPlugin#start` makes after the authorization middleware, in that order; the comments inside are their contract. */
export function registerStartHooks(
  this: Pick<StartHooksHost, 'bootstrapPermissionSets' | 'claimTargetAdminUserId' | 'declareEveryone' | 'deploymentAcceptance' | 'deploymentOrgScopingEntitlement' | 'metadata' | 'tenancyPosture'>,
  ctx: PluginContext,
  ql: IObjectQLEngine,
): void {
  // [ADR-0057 D4 / ADR-0112] A `sys_user_position` write whose `position`
  // names no `sys_position` catalog row is refused (`400 VALIDATION_FAILED`,
  // `reference_not_found` at `position`) instead of answering 201 over an
  // assignment that resolves to nothing. Registered AFTER the security
  // middleware, so it runs INSIDE it: the delegated-admin gate and the CRUD
  // check have both passed before the catalog is consulted, and a caller who
  // may not write the table is refused on authority, never on the value.
  // Scope, predicate and stand-downs: `position-catalog-refusal.ts`.
  ql.registerMiddleware(
    createPositionCatalogRefusal({ ql, logger: ctx.logger }),
    { object: POSITION_ASSIGNMENT_OBJECT },
  );
  // A user-bound grant scoped to an organization names a member of it: `grant-holder-membership-refusal.ts`.
  registerGrantHolderMembershipRefusal(ql, ctx.logger);

  // [ADR-0131 D4] `sys_user_permission_set.permission_set` is the grant's one
  // reference to its set, by name: a non-system write naming a set the
  // security catalog does not hold is refused (`400 VALIDATION_FAILED`,
  // `reference_not_found` at `permission_set`), the sibling of the
  // `sys_user_position.position` refusal above. Engine hooks; see
  // `grant-permission-set-name.ts`.
  if (!registerGrantPermissionSetNameHooks(ql, ctx.logger)) {
    ctx.logger.warn(
      '[security] the ObjectQL engine exposes no hook registry — a sys_user_permission_set write naming a ' +
        'permission set the security catalog does not hold is NOT refused',
    );
  }

  // [ADR-0131 D3, C3 stage 8] No data-door write-through and no walled
  // catalog data-door refusal is registered: the catalog objects are
  // retired, so no `sys_position`, `sys_permission_set` or `sys_capability`
  // write reaches the engine at all. A position, permission set or
  // capability is written through the metadata door alone, which registers
  // it in the security catalog (on an environment kernel through the echo
  // `runBootstrap` wires, `security-catalog-echo.ts`) and, under a wall,
  // refuses a tenant with the same verdict (`walledCatalogWriteVerdict`).

  // Defer platform admin bootstrap until all plugins finish starting —
  // sys_user / sys_user_permission_set objects must be registered (by
  // plugin-auth and platform-objects respectively) before the promotion
  // can write its grant. Falls back to immediate execution when the
  // kernel does not expose `hook` (test stubs).
  let bootstrapRanOnce = false;
  const readSeedSettlement = (): SeedSettlementSnapshot | undefined => readSeedSettlementSnapshot(ctx);
  // [#22801 → A] Same once-guard for the `permission` mutation listener
  // that re-derives `everyone` (registered in `runBootstrap`).
  let everyoneMutationWired = false;
  // The security catalog's echo is wired once and its boot pass runs once,
  // though runBootstrap re-runs (e.g. after the first user insert): the
  // projector replaces idempotently, and the pass would only repeat work.
  let catalogEchoWired = false;
  let catalogEchoBooted = false;
  // [#3325 / ADR-0092] Union the better-auth managed-object write denies into
  // the default sets from the LIVE registry, replacing the hand-maintained
  // baseline as the source of truth (a newly-declared identity table is then
  // covered without editing a list). This mutates the shared
  // `bootstrapPermissionSets` instances IN PLACE — the same objects the
  // permission evaluator resolves — so it runs once, before the bootstrap
  // below (the transform is idempotent, but the once-flag avoids re-reading
  // the registry / re-logging on every runBootstrap re-entry). See managed-object-write-denies.ts.
  let managedDeniesApplied = false;

  const runBootstrap = async () => {
    try {
      if (!managedDeniesApplied) {
        const { applied, skippedExisting } = applyManagedWriteDenies(
          this.bootstrapPermissionSets,
          readDeclared(ql, 'object'),
        );
        managedDeniesApplied = true;
        if (applied > 0) {
          ctx.logger.info(
            `[security] managed-object write denies unioned from registry (ADR-0092): ` +
              `${applied} injected, ${skippedExisting} already present`,
          );
        }
      }
      const report = await bootstrapPlatformAdmin(ql, this.bootstrapPermissionSets, {
        logger: ctx.logger,
        // Read per run, never cached: a pass at `kernel:ready` and a replay
        // after a later sign-up see different tallies, and it is exactly the
        // difference that decides whether that pass's claim is the last word.
        seedSettlement: readSeedSettlement(),
        seededRecordIds: readSeededRecordIds(ctx),
      });
      // Remember the claim's target for the `app:seeded` re-run
      // ({@link claimSeedOwnershipOnSettle}). Only ever overwritten with a
      // real answer: a later pass that returns none (walled posture, an
      // unreadable engine) must not erase the admin an earlier pass resolved.
      if (report?.adminUserId) this.claimTargetAdminUserId = report.adminUserId;
      try {
        const protocol: any = ctx.getService?.('protocol');
        // [ADR-0090 D5, #22801 → A] Every landed `permission` mutation —
        // publish, direct-active save or delete, through any door — runs the
        // suggestion reconcile and derives `everyone` again, so an accepted
        // set whose new body no longer qualifies (dropped `isDefault`, a
        // forbidden bit, deleted) stops granting at once rather than at the
        // next boot. Unconditional on the body: whether a set still qualifies
        // is `readAcceptedEveryoneSets`' question, asked of what the catalog
        // now serves. Drafts change nothing the catalog serves. Wired once;
        // the listener is fire-and-forget, so it owns its failures, and
        // `declareEveryone` never throws.
        if (!everyoneMutationWired && protocol && typeof protocol.onMetadataMutation === 'function') {
          protocol.onMetadataMutation((evt: { type?: string; state?: string }) => {
            if (evt?.type !== 'permission' || evt.state === 'draft') return;
            void (async () => {
              try {
                await reconcileAudienceBindingSuggestions(ql, ctx.logger, this.deploymentAcceptance());
              } catch (e) {
                ctx.logger.warn('[security] audience-binding suggestion sync failed (non-fatal)', { error: (e as Error).message });
              }
              await this.declareEveryone(ctx.logger);
            })();
          });
          everyoneMutationWired = true;
        }
        // [#2747] When the owning package is uninstalled, remove the
        // package's suggestion rows and revoke the grants naming the sets it
        // declared (`args.declared`, captured by the door before it withdrew
        // the package) so grants die with the package — the "no ghost
        // grants" clause of ADR-0090 D5.
        if (protocol && typeof protocol.registerUninstallCleanup === 'function') {
          protocol.registerUninstallCleanup(
            'security.package-permissions',
            async (args: { packageId: string; declared?: { permission?: string[] } }) => {
              const r = await cleanupPackagePermissions(ql, args.packageId, ctx.logger, args.declared);
              // [#22801 → A] The package's acceptance rows are gone with it;
              // `everyone` is derived again without its sets.
              await this.declareEveryone(ctx.logger);
              return {
                success: true,
                removed: r.userGrants + r.suggestions,
              };
            },
          );
        }
        // [ADR-0131 D3] The security catalog's echo: the awaited mutation
        // projector for `permission` and `position`, then one pass over the
        // stored env-wide overlays. On an ENVIRONMENT kernel the metadata
        // door registers no stored row in the engine registry, so the
        // catalog finds a metadata-door set or position only in the
        // metadata service, and this is what puts it there. It writes no
        // row (C3 stage 8 retired them) and decides nothing. Before the
        // suggestion reconcile below, which reads the catalog. See
        // `security-catalog-echo.ts`.
        if (!catalogEchoWired) {
          catalogEchoWired = registerSecurityCatalogEcho(protocol, {
            ql, metadata: this.metadata, logger: ctx.logger,
          });
        }
        if (catalogEchoWired && !catalogEchoBooted) {
          catalogEchoBooted = true;
          try {
            await echoStoredSecurityCatalogOverlays(protocol, {
              ql, metadata: this.metadata, logger: ctx.logger,
            });
          } catch (e) {
            ctx.logger.warn('[security] the security-catalog echo of stored overlays failed at boot', { error: (e as Error).message });
          }
        }
        // [#3050] OWD posture authoring gate — pre-persistence veto on
        // runtime-authored `object` bodies: env-tighten-only over packaged
        // declarations (ADR-0086 D1) + external ≤ internal (ADR-0090 D11).
        // Feature-detected; protocols predating registerAuthoringGate keep
        // the legacy (CLI-lint-only) behavior.
        registerObjectPostureGate(protocol);
        // [commit 5619aace3 — maintainer ruling 2026-08-25, option B] The packaged-
        // permission-set lock's METADATA-door registration: the same
        // classifier and error classes the data door runs
        // (`packaged-permission-set-lock.ts`), now consulted on the
        // pre-persistence seam for `permission` bodies too — so an
        // `OS_METADATA_WRITABLE=permission` hatch write targeting a
        // package-declared set is refused before persistence instead of
        // minting the overlay the lock exists to prevent, while writes to
        // non-packaged names keep the documented hatch behavior. One
        // spelling of "package-declared", two doors, one refusal.
        registerPackagedPermissionSetLockGate(protocol, ql);
        // [maintainer ruling 2026-08-24 — 「同意 第一步(创业阶段,Salesforce
        // 式)」, item 3] The DETECTION READING for sets that were already
        // silently forked before the save door was locked: count + NAMES,
        // reported loudly. ⛔ Reaps nothing, merges nothing, migrates
        // nothing — disposition of an existing fork is a follow-up reading
        // for the maintainer. A deployment upgraded onto ADR-0048's
        // cold-boot check holding such a fork does not boot at all; its
        // remedy is the offline `os migrate security-catalog-overlays`.
        //
        // Own try/catch, same discipline as its neighbours: a failure here
        // must never take down boot, and must never read as "the
        // reconciliation also failed".
        try {
          await reportPackagedPermissionSetOverlays(ql, { logger: ctx.logger });
        } catch (e) {
          ctx.logger.warn('[security] packaged permission-set overlay detection failed', { error: (e as Error).message });
        }
      } catch (e) {
        ctx.logger.warn('[security] permission-set door registration failed', { error: (e as Error).message });
      }
      // [ADR-0090 D5/D9] Reconcile the suggested-audience-binding surface:
      // every declared `isDefault: true` set the `everyone` definition does
      // not already name becomes a PENDING suggestion row awaiting a
      // `manage_metadata` holder's decision — never auto-bound. ONE
      // deployment-level pass, owned by the Default Organization (#22801 → A).
      try {
        await reconcileAudienceBindingSuggestions(ql, ctx.logger, this.deploymentAcceptance());
      } catch (e) {
        ctx.logger.warn('[security] audience-binding suggestion sync failed (non-fatal)', { error: (e as Error).message });
      }
      bootstrapRanOnce = true;
      ctx.logger.info('[security] platform bootstrap complete', report);
      return report;
    } catch (e) {
      ctx.logger.warn('[security] platform bootstrap failed', { error: (e as Error).message });
      return undefined;
    }
  };
  if (typeof (ctx as any).hook === 'function') {
    (ctx as any).hook('kernel:ready', runBootstrap);
  } else {
    void runBootstrap();
  }

  // [ADR-0131 D3/D4] The catalog reference report: per organization, every
  // assignment and grant whose name the security catalog does not resolve,
  // and every grant that names nothing. A reference that resolves nowhere
  // confers nothing; this is what makes that loud. A grant written before
  // the name column existed is named by the v18 ceremony's verified
  // rewrite (`os migrate organization-ownership --apply`, ADR-0131 D10),
  // never at boot. It writes nothing. Only at `kernel:bootstrapped`: run any earlier, it
  // would judge a catalog that is still being filled. See `catalog-reference-report.ts`.
  if (typeof (ctx as any).hook === 'function') {
    (ctx as any).hook('kernel:bootstrapped', async (): Promise<void> => {
      try {
        await reportCatalogReferences(ql as any, {
          catalog: createSecurityCatalogReader({ registry: (ql as any).registry, metadata: this.metadata }),
          logger: ctx.logger,
        });
      } catch (e) {
        ctx.logger.warn(
          '[security] the catalog reference report did not run — assignments and grants whose names the ' +
            'security catalog does not resolve go unreported for this boot',
          { error: (e as Error)?.message },
        );
      }
      // [ADR-0126 §6 wall 3] The access upgrade report: the customer's
      // switch-offs, clones and sharing rule rows against the registry this
      // boot registered, raised to the administrator (`single`) or the
      // operator alone (walled). It writes and refuses nothing. See
      // `access-upgrade-report.ts`.
      try {
        const optional = <T,>(name: string): T | undefined => {
          try { return ctx.getService<T>(name) ?? undefined; } catch { return undefined; }
        };
        const sharingRules = optional<Partial<DeclaredSharingRuleReader>>(SHARING_RULES_SERVICE);
        const messaging = optional<Partial<AccessUpgradeNotifier>>('messaging');
        await reportAccessUpgrade(ql as any, {
          catalog: createSecurityCatalogReader({ registry: (ql as any).registry, metadata: this.metadata }),
          sharingRules: typeof sharingRules?.listDeclaredRules === 'function'
            ? (sharingRules as DeclaredSharingRuleReader) : undefined,
          messaging: typeof messaging?.emit === 'function' ? (messaging as AccessUpgradeNotifier) : undefined,
          walled: postureEnforcesWall(this.tenancyPosture),
          logger: ctx.logger,
        });
      } catch (e) {
        ctx.logger.warn(
          '[security] the access upgrade report did not run — a switch-off, clone or sharing rule an upgrade left ' +
            'behind goes unreported for this boot',
          { error: (e as Error)?.message },
        );
      }
      // [#24447] The upgrade impact report: the same comparison for the
      // non-access classes — flow, action and webhook switches, stored
      // overlays and object rows, object extensions, navigation
      // contributions and stored settings — raised the same way. It writes
      // and refuses nothing. See `upgrade-impact-report.ts`.
      try {
        const optional = <T,>(name: string): T | undefined => {
          try { return ctx.getService<T>(name) ?? undefined; } catch { return undefined; }
        };
        const settings = optional<Partial<SettingsManifestReader>>(SETTINGS_SERVICE);
        const messaging = optional<Partial<AccessUpgradeNotifier>>('messaging');
        await reportUpgradeImpact(ql as any, {
          settings: typeof settings?.listManifests === 'function' ? (settings as SettingsManifestReader) : undefined,
          messaging: typeof messaging?.emit === 'function' ? (messaging as AccessUpgradeNotifier) : undefined,
          walled: postureEnforcesWall(this.tenancyPosture),
          logger: ctx.logger,
        });
      } catch (e) {
        ctx.logger.warn(
          '[security] the upgrade impact report did not run — a switch, stored row, extension or setting an ' +
            'upgrade left behind goes unreported for this boot',
          { error: (e as Error)?.message },
        );
      }
    });
  }

  // ── Re-run the seed-ownership CLAIM when the seed actually settles ────────
  //
  // Subscribed in `init()`, not here — see {@link claimSeedOwnershipOnSettle}.
  // `runBootstrap` above only NAMES the claim's target for it
  // (`this.claimTargetAdminUserId`); a seed that settles before this boot's
  // bootstrap has run resolves the target itself, by the same rule.

  // Re-run bootstrap after a sys_user write that can change the promotion
  // answer, so the platform admin is promoted without a server restart:
  //
  //  - `single` posture + INSERT: the user that signs up after boot may be
  //    the first-user promotion target (and, in multi-tenant mode, gets
  //    bound to the seeded default organization).
  //  - [#11974 / #11663 L4] That is the WHOLE trigger set now. Under walled
  //    postures the bootstrap writes no grant — standing is config-derived
  //    at request time (`resolve-authz-context.ts` §6b-config) — so no
  //    `sys_user` write can change its answer and the replay never fires.
  //    Commit c0714eb5d's UPDATE arm (`email_verified` / `email`) retired with the
  //    walled elevation it existed to re-attempt.
  //
  // The trigger set is `shouldReplayBootstrapFor` — the SAME predicate its
  // pins consume — and the function itself is idempotent, bailing out as
  // soon as any platform admin exists.
  //
  // We deliberately do NOT auto-create a "personal workspace" for
  // every subsequent self-service signup. In a B2B / invitation-
  // driven product (the framework's primary target), users must
  // either accept an invitation or explicitly create their first
  // organization. The account UI's /register flow already routes
  // users with zero memberships to /organizations/new for exactly
  // this case.
  ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    await next();
    if (shouldReplayBootstrapFor(opCtx)) {
      if (bootstrapRanOnce) {
        await runBootstrap();
      }
    }
  });

  // ── Auto-grant `organization_admin` on sys_member lifecycle ─────────
  //
  // For every `sys_member` row whose role is `owner` or `admin`, keep
  // a `sys_user_permission_set` row scoped to that organization in
  // sync. See `auto-org-admin-grant.ts` for the full rationale and
  // the anti-escalation argument (org_admin is read-only on the
  // global RBAC tables, so a freshly-granted admin cannot rebind
  // themselves to `admin_full_access`).
  //
  // We register one middleware that handles insert / update / delete
  // uniformly by always reconciling every (user, org) pair touched
  // by the operation. `reconcileOrgAdminGrant` is idempotent so a
  // double-fire (e.g. better-auth followed by an org plugin
  // synchronizer) is harmless.
  ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    await next();
    if (opCtx?.object !== 'sys_member') return;
    const op = opCtx?.operation;
    if (
      op !== 'insert' &&
      op !== 'create' &&
      op !== 'update' &&
      op !== 'delete' &&
      op !== 'remove'
    ) {
      return;
    }
    const pairs = extractMemberPairs(opCtx);
    // [#4586] Carry the triggering write's ATTRIBUTED human into the grant.
    // better-auth's membership writes authorize as the system on purpose, so
    // `opCtx.context.userId` is empty by construction and `granted_by` was
    // always null; `attributedUserId` is the channel that does name the
    // admin who clicked. Read as attribution only — it decides nothing about
    // whether this reconcile may run, and the reconciler's own writes stay
    // system-context.
    const attributedUserId =
      typeof opCtx?.context?.attributedUserId === 'string' && opCtx.context.attributedUserId
        ? opCtx.context.attributedUserId
        : undefined;
    for (const { userId, orgId } of pairs) {
      try {
        await reconcileOrgAdminGrant(ql, userId, orgId, {
          logger: ctx.logger,
          posture: this.tenancyPosture,
          // [#12699] The deployment's declared suppression of the unbounded
          // walled-posture grant — read live, like the posture is cached-at-
          // start: both are deployment facts, but the entitlement's declarer
          // may register between init and this middleware's first fire.
          suppressUnboundedOrgAdminGrant:
            this.deploymentOrgScopingEntitlement().suppressUnboundedOrgAdminGrant,
          ...(attributedUserId ? { attributedUserId } : {}),
        });
      } catch (e) {
        ctx.logger.warn?.('[security] org_admin reconcile failed', {
          userId,
          orgId,
          error: (e as Error).message,
        });
      }
    }
  });

  // Backfill organization_admin grants after the platform admin
  // bootstrap settles on kernel:ready. Idempotent — only inserts
  // missing rows and revokes orphaned ones, never duplicates.
  const runOrgAdminBackfill = async () => {
    try {
      await backfillOrgAdminGrants(ql, {
        logger: ctx.logger,
        posture: this.tenancyPosture,
        // [#12699] Same live read as the middleware call site above.
        suppressUnboundedOrgAdminGrant:
          this.deploymentOrgScopingEntitlement().suppressUnboundedOrgAdminGrant,
      });
    } catch (e) {
      ctx.logger.warn?.('[security] organization_admin backfill failed', {
        error: (e as Error).message,
      });
    }
  };
  if (typeof (ctx as any).hook === 'function') {
    (ctx as any).hook('kernel:ready', runOrgAdminBackfill);
  } else {
    void runOrgAdminBackfill();
  }
}
