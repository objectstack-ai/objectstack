// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Authz invalidation, middleware, session, driver options, posture, organization probe"
 * section of `ObjectQL`: the bodies of `executeWithMiddleware`,
 * `resolveSystemInsertOrganization` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link MiddlewareAndContextHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { redactPropagatedDriverFault } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isWriteEpochOperation } from './write-epoch.js';
import { ORGANIZATION_OBJECT, SystemWriteOrganizationRequiredError, carriesOrganization, resolveSystemWriteOrganization, resolveTenantFieldName } from './tenancy/system-write-organization.js';
import { isFederatedObject } from './federated-object.js';
import type { OperationContext } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface MiddlewareAndContextHost {
  readonly _registry: ObjectQL['_registry'];
  readonly middlewares: ObjectQL['middlewares'];
  probeInstallOrganizations: ObjectQL['probeInstallOrganizations'];
  resolveEnginePosture: ObjectQL['resolveEnginePosture'];
  readonly writeEpoch: ObjectQL['writeEpoch'];
}

/** The body of `ObjectQL#executeWithMiddleware`; the method's docblock there is its contract. */
export async function executeWithMiddleware(this: Pick<MiddlewareAndContextHost, 'middlewares' | 'writeEpoch'>, ctx: OperationContext, executor: () => Promise<any>): Promise<any> {
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

/** The body of `ObjectQL#resolveSystemInsertOrganization`; the method's docblock there is its contract. */
export async function resolveSystemInsertOrganization(this: Pick<MiddlewareAndContextHost, '_registry' | 'probeInstallOrganizations' | 'resolveEnginePosture'>, object: string, execCtx: ExecutionContext | undefined, rows: readonly Record<string, unknown>[]): Promise<string | undefined> {
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
