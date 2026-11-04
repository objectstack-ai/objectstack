// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Authz invalidation, middleware, session, driver options, posture, organization probe"
 * section of `ObjectQL`: the bodies of `attachAuthzInvalidationPubSub`,
 * `detachAuthzInvalidationPubSub`, `registerMiddleware`, `hasObjectMiddleware`,
 * `executeWithMiddleware`, `buildReferentialFieldClear`,
 * `claimReferentialCascadeDelete`, `probeInstallOrganizations`,
 * `invalidateOrganizationProbe`, `resolveSystemInsertOrganization`,
 * `transactionCoversDriverFor` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link MiddlewareAndContextFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link MiddlewareAndContextHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `middlewareAndContextHost` in `engine-facet-hosts.ts`, built
 * once per engine by the class's static block. Methods go as closures that
 * call them on the engine at call time, so a subclass override or an instance
 * spy is still the one reached; fields and accessors go as GETTERS, read when
 * the body reads them, as they were on the class, and a field a body assigns
 * goes with a SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { IPubSub } from '@objectstack/spec/contracts';
import { redactPropagatedDriverFault } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isWriteEpochOperation } from './write-epoch.js';
import { bridgeAuthzInvalidation } from './authz-invalidation-bridge.js';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { ORGANIZATION_OBJECT, SystemWriteOrganizationRequiredError, carriesOrganization, resolveSystemWriteOrganization, resolveTenantFieldName } from './tenancy/system-write-organization.js';
import { isFederatedObject } from './federated-object.js';
import type { EngineMiddleware, OperationContext } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link MiddlewareAndContextFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface MiddlewareAndContextHost {
  readonly _registry: ObjectQL['_registry'];
  authzInvalidationBinding: ObjectQL['authzInvalidationBinding'];
  authzInvalidationDetach: ObjectQL['authzInvalidationDetach'];
  readonly cascadeIssuedDeletes: ObjectQL['cascadeIssuedDeletes'];
  detachAuthzInvalidationPubSub: ObjectQL['detachAuthzInvalidationPubSub'];
  find: ObjectQL['find'];
  getDriver: ObjectQL['getDriver'];
  readonly logger: ObjectQL['logger'];
  readonly middlewares: ObjectQL['middlewares'];
  organizationProbeMemo: ObjectQL['organizationProbeMemo'];
  probeInstallOrganizations: ObjectQL['probeInstallOrganizations'];
  resolveEnginePosture: ObjectQL['resolveEnginePosture'];
  readonly txStore: ObjectQL['txStore'];
  readonly writeEpoch: ObjectQL['writeEpoch'];
}

/** The bodies of the "Authz invalidation, middleware, session, driver options, posture, organization probe" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class MiddlewareAndContextFacet {
  /** The body of `ObjectQL#attachAuthzInvalidationPubSub`; the method's docblock there is its contract. */
  static attachAuthzInvalidationPubSub(this: Pick<MiddlewareAndContextHost, 'authzInvalidationBinding' | 'authzInvalidationDetach' | 'detachAuthzInvalidationPubSub' | 'logger' | 'writeEpoch'>, pubsub: IPubSub, nodeId: string): () => void {
    if (
      this.authzInvalidationBinding?.pubsub === pubsub &&
      this.authzInvalidationBinding?.nodeId === nodeId
    ) {
      return () => this.detachAuthzInvalidationPubSub();
    }
    this.detachAuthzInvalidationPubSub();
    this.authzInvalidationDetach = bridgeAuthzInvalidation({
      epoch: this.writeEpoch,
      pubsub,
      nodeId,
      logger: this.logger,
    });
    this.authzInvalidationBinding = { pubsub, nodeId };
    this.logger.info('ObjectQL attached to the authz.invalidated cluster channel', {
      nodeId,
    });
    return () => this.detachAuthzInvalidationPubSub();
  }

  /** The body of `ObjectQL#detachAuthzInvalidationPubSub`; the method's docblock there is its contract. */
  static detachAuthzInvalidationPubSub(this: Pick<MiddlewareAndContextHost, 'authzInvalidationBinding' | 'authzInvalidationDetach'>): void {
    const detach = this.authzInvalidationDetach;
    this.authzInvalidationDetach = undefined;
    this.authzInvalidationBinding = undefined;
    detach?.();
  }

  /** The body of `ObjectQL#registerMiddleware`; the method's docblock there is its contract. */
  static registerMiddleware(this: Pick<MiddlewareAndContextHost, 'logger' | 'middlewares'>, fn: EngineMiddleware, options?: { object?: string }): void {
    this.middlewares.push({ fn, object: options?.object });
    this.logger.debug('Registered middleware', { object: options?.object, total: this.middlewares.length });
  }

  /** The body of `ObjectQL#hasObjectMiddleware`; the method's docblock there is its contract. */
  static hasObjectMiddleware(this: Pick<MiddlewareAndContextHost, 'middlewares'>, objectName: string): boolean {
    return this.middlewares.some((m) => !!m.object && m.object !== '*' && m.object === objectName);
  }

  /**
   * Execute an operation through the middleware chain
   */
  static async executeWithMiddleware(this: Pick<MiddlewareAndContextHost, 'middlewares' | 'writeEpoch'>, ctx: OperationContext, executor: () => Promise<any>): Promise<any> {
    // [#11968] Advance the write epoch FIRST — ahead of every middleware, and
    // so ahead of any `isSystem` bypass one of them applies. The writes most
    // likely to change what a caller may see are system ones: the platform
    // seeder, a package publish, the auto-org-admin grant. A guard that only
    // saw user writes would leave cached authorization standing across exactly
    // the grants that matter. (`@objectstack/plugin-security` made the same
    // choice inside its own middleware in #10757; hoisting it here is what
    // makes the covered set identical BY CONSTRUCTION to "everything the
    // middleware chain sees", instead of identical by two authors agreeing.)
    //
    // ⛔ Do not move this below the `applicable` filter: that filter is a
    // per-object middleware selector, and an epoch that only advanced when some
    // middleware happened to be registered for the written object would be a
    // seam with holes in it.
    if (isWriteEpochOperation(ctx.operation)) {
      this.writeEpoch.bump('write');
    }

    const applicable = this.middlewares.filter(m =>
      !m.object || m.object === '*' || m.object === ctx.object
    );

    let index = 0;
    const next = async (): Promise<void> => {
      if (index < applicable.length) {
        const mw = applicable[index++];
        await mw.fn(ctx, next);
      } else {
        try {
          ctx.result = await executor();
        } catch (e) {
          // [#21274] The engine BOUNDARY for every operation this seam runs
          // (find, findOne, count, aggregate, insert, update, delete): a driver
          // error leaves the engine with its bound statement and the caller's
          // values cut, from `message`, `stack`, the driver's own
          // statement-bearing properties and `cause` — the class and the codes
          // kept. Innermost, so a middleware that logs what it caught gets
          // the cut too. The executors' own log lines ran before this, from
          // the raw error, and are unchanged. See `redactPropagatedDriverFault`.
          throw redactPropagatedDriverFault(e);
        }
      }
    };

    await next();
    return ctx.result;
  }

  /**
   * [commit 34ce8e7db] Build the declared `HookContext.referentialFieldClear` marker —
   * the read-only hook-context projection of the operation-private
   * `__referentialFieldClear` that {@link ObjectQL.cascadeDeleteRelations}
   * stamps on the cleanup write's ExecutionContext (#3023).
   *
   * `true | undefined`, never `false`: the key is ABSENT from every dispatch
   * whose envelope does not carry the marker, so a handler reads it as
   * `ctx.referentialFieldClear === true` and an absent key keeps meaning "not
   * a referential cleanup" — the same back-compatible direction as `dispatch`.
   *
   * Why a projection of the ENVELOPE rather than a fresh per-call-site signal:
   * the `__` key's semantics have always been operation-scoped — the cleanup
   * context is `{ ...callerContext, transaction, __referentialFieldClear: true }`,
   * plugin-security's ownership-anchor exemption keys on the envelope, and a
   * write a hook issues through `ctx.api` during a cleanup dispatch inherits
   * it — so the declared face projects the fact faithfully instead of quietly
   * re-scoping it. Consumed by `update()`'s hook-context assembly only: every
   * reference-cleanup write the engine issues is an update, and the per-row /
   * after-phase contexts ride the batch context's spread.
   */
  static buildReferentialFieldClear(execCtx?: ExecutionContext): true | undefined {
    return (execCtx as any)?.__referentialFieldClear === true ? true : undefined;
  }

  /**
   * [#23221] Build the declared `HookContext.referentialCascadeDelete` marker,
   * the delete twin of {@link buildReferentialFieldClear}: `true` when THIS
   * `delete()` of `object`/`id` is the child delete
   * {@link walkReferencingRelations} issued for a `cascade` relation, and
   * `undefined` for every other delete — the same "absent unless true"
   * contract, so a handler reads `ctx.referentialCascadeDelete === true`.
   *
   * Reads {@link cascadeIssuedDeletes}, not the envelope (that field says why),
   * and CLAIMS the token it matches. Called once per `delete()`, below the
   * `afterDelete` unit re-entry (`opensAfterAbortUnit`): a call that re-enters
   * itself returns before reaching here, so the claim is made by the inner
   * call, the one that dispatches the hooks, and nothing later inside it can
   * match the same token again.
   */
  static claimReferentialCascadeDelete(this: Pick<MiddlewareAndContextHost, 'cascadeIssuedDeletes'>, object: string, id: unknown): true | undefined {
    const issued = this.cascadeIssuedDeletes.getStore();
    if (!issued || issued.claimed || id == null) return undefined;
    if (issued.object !== object || issued.id !== String(id)) return undefined;
    issued.claimed = true;
    return true;
  }

  /**
   * [#8844] The install's organizations, capped at two — only "none / exactly
   * one / several" changes any decision.
   *
   * Memoised because a cron loop inserting N rows would otherwise pay N probes
   * for an answer that changes only when `sys_organization` itself is written,
   * and every such write passes through this engine's own write faces, which
   * clear it ({@link invalidateOrganizationProbe}). The stale window is
   * therefore an organization created by ANOTHER process against the same
   * database — and on the `single` posture this memo serves, a second
   * organization appearing is the ambiguous topology the next boot refuses
   * anyway.
   *
   * `isSystem` on the read: resolving the install's organization must not
   * depend on the caller's own reach, and this runs on writes that have no
   * caller reach at all.
   *
   * [#9261] "The probe found no organizations" and "the probe could not run"
   * are different facts (ADR-0110 D3), and this returns the FIRST one only when
   * it measured it. The `catch {}` this replaces answered both with `[]`, which
   * `resolveSystemWriteOrganization` then read as "no organization yet" (a
   * branch that landed the row; since ADR-0131 D9 a registered-but-empty
   * organization object is refused instead) — so one
   * transient failure silently skipped both halves of the #8844 ruling: the
   * single-organization stamp (rows land untenanted and fork exactly the
   * counter the ruling exists to protect) and the multi-organization REFUSAL
   * (fail-open on a guard that must be loud, the #8895 shape). The memo made
   * the damage outlive the outage — the invented answer was cached until an
   * organization write happened to clear it.
   *
   * **Exactly one cause is benign, and it was measured rather than assumed.**
   * `sys_organization` ROUTES but its TABLE was never provisioned (schema sync
   * not run yet): it cannot hold a row, so zero really is the count. Asked
   * through the shared `isMissingTableError` predicate
   * (`@objectstack/metadata/errors`, #4825) — the same call
   * `resolveFileReferences` and `cascadeDeleteRelations` make — never a
   * hand-rolled code test.
   *
   * A SECOND benign cause, now that an unresolved name is refused rather than
   * handed to the driver: `sys_organization` is not registered at all (a lean
   * embedding, a bare-kernel test). Before an in-process verb refused an
   * unresolved name, that install reached the driver and read `[]` on a
   * tolerant one or a MISSING TABLE on a strict one — the one driver cause
   * above. It now resolves to the engine's own `OBJECT_NOT_FOUND` before any
   * driver is asked, so this probe asks the REGISTRY first and treats an
   * absent `sys_organization` as the lean-install case it always was: there is
   * no organization object here, so there is no organization to derive. This
   * is the probe handling absence itself, on a path a body cannot reach — it
   * never relies on the resolver's old raw-table fall-through, which is now
   * gone. It is not a spelling allow-list: the question is "is the object
   * provisioned," asked of the one registry, not "is this one of N names."
   *
   * Everything else — connection loss, pool exhaustion, a timeout mid-boot, a
   * datasource that never connected ({@link DatasourceUnavailableError}), a
   * permission denial — means organizations may well exist and simply were not
   * seen. It PROPAGATES, envelope intact, and ⛔ nothing is memoised on that
   * path: the write that asked fails loudly instead of being filed under a
   * guessed topology, and the next write re-probes rather than inheriting the
   * guess. No new error code and no new response field — the caller receives
   * the probe's own failure, the same disposition #8895 gave the
   * referential-integrity probe.
   */
  static async probeInstallOrganizations(this: Pick<MiddlewareAndContextHost, '_registry' | 'find' | 'organizationProbeMemo'>): Promise<readonly string[]> {
    if (this.organizationProbeMemo) return this.organizationProbeMemo;
    // The lean-install case: no `sys_organization` object is registered, so
    // there is no organization to derive. Asking the registry first keeps the
    // probe off the resolver's refusal for an unregistered name (a path a body
    // cannot reach), exactly as the old raw-table fall-through read `[]`.
    if (!this._registry.getObject(ORGANIZATION_OBJECT)) {
      this.organizationProbeMemo = [];
      return this.organizationProbeMemo;
    }
    let ids: readonly string[] = [];
    try {
      const rows = await this.find(ORGANIZATION_OBJECT, {
        fields: ['id'],
        limit: 2,
        context: { isSystem: true },
      });
      ids = (Array.isArray(rows) ? rows : [])
        .map((r: any) => (r?.id ?? r?._id))
        .filter((id: unknown) => id != null && String(id) !== '')
        .map((id: unknown) => String(id));
    } catch (error) {
      // The one benign cause only — anything else is an outage, not an
      // emptiness, and must not be memoised as one.
      if (!isMissingTableError(error, ORGANIZATION_OBJECT)) throw error;
      ids = [];
    }
    this.organizationProbeMemo = ids;
    return ids;
  }

  /** [#8844] Drop the memo — any write that can change the organization set. */
  static invalidateOrganizationProbe(this: Pick<MiddlewareAndContextHost, 'organizationProbeMemo'>): void {
    this.organizationProbeMemo = undefined;
  }

  /**
   * [#8844] Resolve the organization a SYSTEM-context insert carries, per the
   * 2026-08-15 ruling (Option 1) — or refuse it.
   *
   * Returns the organization id to thread as `DriverOptions.tenantId` (the same
   * knob a session write sets, so the driver stamps the column and the counter
   * scopes by it), or `undefined` when there is nothing to resolve. Throws
   * {@link SystemWriteOrganizationRequiredError} wherever no owner is
   * derivable (ADR-0131 D9): a wall, several organizations, or — under
   * `single`, in a composition that registers the organization object — none.
   *
   * Called AFTER the beforeInsert hooks on purpose: a hook that stamps the
   * organization itself has carried it, and must not then be refused for a
   * value it just supplied.
   *
   * Every early return below is a population the refusal must not touch — see
   * the module header for why each is outside the rule by construction rather
   * than by exemption. They are ordered cheapest-first, so an ordinary write
   * pays two property reads and a regexp.
   */
  static async resolveSystemInsertOrganization(this: Pick<MiddlewareAndContextHost, '_registry' | 'probeInstallOrganizations' | 'resolveEnginePosture'>, object: string, execCtx: ExecutionContext | undefined, rows: readonly Record<string, unknown>[]): Promise<string | undefined> {
    // Already carrying an organization on the context — a session write, or a
    // system write that threaded one. Nothing to resolve; this is the shape the
    // ruling asks every system write to reach.
    if (carriesOrganization(execCtx?.tenantId)) return undefined;
    // [ADR-0131 D9, C8 stage 8b] Under every posture a platform object has no
    // exemption: with a tenant column it is in scope like any other object, so
    // its organization-less system insert is stamped with the derived
    // organization or refused below — never left NULL. The walled half landed
    // in 18.x, after the stages that gave the walled writers (identity mail,
    // global audit, declared webhooks) an organization or a sibling of their
    // own. ⛔ Never re-introduce a per-table or per-posture cut here: a table
    // whose rows are deployment-level declares no organization column
    // (`sys_secret` and `sys_flow_credential` since the steps 5+6 landing,
    // #24582) and exits below, on the missing tenant field.
    const objectSchema = this._registry.getObject(object) as any;
    // A federated object's schema is the REMOTE's (ADR-0015); the platform's
    // injected column says nothing about it, which is the same reason
    // `buildDriverOptions` withholds `tenantId` there.
    if (isFederatedObject(objectSchema)) return undefined;
    const tenantField = resolveTenantFieldName(objectSchema);
    if (!tenantField) return undefined;
    // A row that names its own organization has carried one explicitly. Only a
    // row still missing it can fork a counter, so a batch where every row is
    // stamped resolves nothing — and a batch where some are not is decided by
    // the ones that are not.
    if (rows.every((row) => carriesOrganization(row?.[tenantField]))) return undefined;

    const posture = this.resolveEnginePosture();
    // [ADR-0131 D9] Zero organizations is refused under `single` only where
    // the composition registers the organization object; the composition that
    // registers none keeps today's branch (`no-organization-object`). The
    // probe itself is unchanged and answers `[]` for both — this is the one
    // fact that tells them apart, read from the same registry the probe reads.
    const decision = await resolveSystemWriteOrganization({
      posture,
      probeOrganizations: () => this.probeInstallOrganizations(),
      organizationObjectRegistered: !!this._registry.getObject(ORGANIZATION_OBJECT),
    });
    if (decision.kind === 'derived') return decision.organizationId;
    if (decision.kind === 'no-organization-object') return undefined;
    throw new SystemWriteOrganizationRequiredError(
      object,
      posture,
      decision.reason,
      decision.organizationCount,
    );
  }

  /**
   * Does the open transaction `tx` actually cover the driver `object` resolves
   * to? — the same-origin question, asked by instance IDENTITY (#5351).
   *
   * Answers `true` in two cases: the resolved driver IS the transaction's
   * owner, or the engine cannot tell who the owner is. The second case is the
   * DECLARED LIMIT of this gate, not an oversight, and it is exactly one
   * shape: a handle the engine never opened and cannot attribute.
   *
   * `TransactionScope` (#5724) records the owner for every transaction the
   * engine opens, and `transaction()` also threads that same handle down as
   * `execCtx.transaction`, so the dominant explicit-threading path is covered
   * by identity-matching the handle back to the store entry. What is NOT
   * covered:
   *
   * - `ScopedContext`'s discrete `beginTransaction`/`commit`/`rollback` trio,
   *   which threads the handle across `setImmediate` boundaries where
   *   AsyncLocalStorage does not survive, and so never populates txStore;
   * - any handle an outside caller obtained elsewhere and passed in as
   *   `execCtx.transaction`.
   *
   * For those the engine holds an opaque driver object with no back-reference
   * to its driver, so there is no honest comparison to make. Guessing — say,
   * assuming an unattributed handle belongs to the default driver — would
   * refuse legitimate single-datasource work on one side and carve out writes
   * that were genuinely covered on the other. So the gate declines to judge and
   * the pre-#5351 behaviour stands on that path: recorded in the ADR-0067/0119
   * revision, and closable only by making handle ownership discoverable on
   * `IDataDriver` (filed separately).
   */
  static transactionCoversDriverFor(this: Pick<MiddlewareAndContextHost, 'getDriver' | 'txStore'>, object: string, tx: unknown): boolean {
    const store = this.txStore.getStore();
    // The scope describes the handle in the store. An explicitly-threaded
    // handle is covered by it only when it IS that handle.
    const scope = store !== undefined && tx === store.transaction ? store.scope : undefined;
    if (!scope) return true;
    return this.getDriver(object) === scope.driver;
  }
}
