// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 10] `SecurityPlugin#checkAuthoredRowWrite`, moved out of
 * `security-plugin.ts`: the `ISecurityService.checkAuthoredRowWrite` verdict,
 * whether an app-authored row policy admits one row for an `update` or a
 * `delete` — `admit` or `abstain`, never a refusal, and `abstain` on every
 * failure — together with the scope its probe read runs under,
 * `AUTHORED_ROW_WRITE_PROBE_CONTEXT`, which nothing else reads.
 *
 * A MOVE, not a redesign. The function below is the body of the method of the
 * same name as it stood, re-indented one level and otherwise unedited: the
 * same abstentions in the same order, the same provenance pre-check, the same
 * layered predicate and the same id-only probe read. The scope constant and
 * its docblock moved with it unedited, still unexported, and the probe still
 * spreads it at its one call site.
 *
 * ## How the moved body reaches the class
 *
 * The shape cuts 1 to 9 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps the public method — the published
 * `dist/*.d.ts` lists its name, docblock and position — and its body is one
 * literal of exactly the {@link AuthoredRowWriteHost} members it reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the plugin
 * at call time, so a test double or spy set on the plugin is still the one
 * the body reaches: the verdict still asks the plugin's set resolution, RLS
 * policy collection and layered RLS filter, and the `security` service
 * binding and every other caller still reach the method through the plugin.
 * The method was async and the function still is; the method now returns its
 * function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `logger` and `ql` are not declared `readonly` (`start()` assigns both after
 * construction), so they go as GETTERS, and each read happens when the body
 * makes it. Both are objects whose own methods the body calls, so no receiver
 * changes.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * The verdict and operation types are imported from
 * `@objectstack/spec/contracts`, the platform-ownership floor predicate from
 * `platform-ownership-policies.js`, and the clause predicate from
 * `rls-compiler.js`, as `security-plugin.ts` imports them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import type { AuthoredRowWriteOperation, AuthoredRowWriteVerdict } from '@objectstack/spec/contracts';
import type { SecurityPlugin } from './security-plugin.js';
import { isPlatformOwnershipFloorPolicy } from './platform-ownership-policies.js';
import { policyDeclaresClause } from './rls-compiler.js';

/**
 * The `SecurityPlugin` members the function below reads — every one of them,
 * and no other; the function's `this` is the `Pick` of the members it reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface AuthoredRowWriteHost {
  readonly logger: SecurityPlugin['logger'];
  readonly ql: SecurityPlugin['ql'];
  collectRLSPolicies: SecurityPlugin['collectRLSPolicies'];
  computeLayeredRlsFilter: SecurityPlugin['computeLayeredRlsFilter'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
}

/**
 * [#7281] The scope `checkAuthoredRowWrite`'s probe read runs under.
 *
 * The method asks ONE question — "does the declared, app-authored widener admit
 * this row for this operation?" — and that question is about the row and the
 * declaration, never about what the CALLER may see. Resolving it under the
 * caller's own context folded a READ decision into a WRITE question: on a
 * `private`-OWD object `plugin-sharing`'s read filter scopes every re-read to
 * owner-match OR shares, so a cross-owner row was invisible to the probe and
 * the verdict was `abstain` for a row the declaration names by predicate. The
 * by-id widener surface was therefore structurally dead on `private` — the
 * posture #5493 built it for (maintainer ruling, 2026-08-10: reading 2).
 *
 * Elevating the READ does not widen the ANSWER, because the predicate carries
 * the whole of the question and travels in the `where`, not in the scope:
 * `{ id } AND layer0(tenant wall) AND layer1(app-authored policies)`. Both
 * layers are computed from the CALLER's permission sets and the CALLER's
 * tenant BEFORE the read (see {@link SecurityPlugin.checkAuthoredRowWrite}), so
 * a row in another tenant, a row no authored policy matches, and a caller
 * holding no authored policy at all are all still `abstain` — measured, not
 * asserted (`authored-row-write-verdict.test.ts`, and the real-stack pin
 * `packages/qa/dogfood/test/authored-row-write-scope.dogfood.test.ts`).
 *
 * Principal-less on purpose: it carries no `userId`, so nothing downstream can
 * mistake it for the caller acting with more authority than they hold. It is
 * SPREAD at the single call site rather than passed by reference, so no
 * middleware can stamp state onto a shared object.
 */
const AUTHORED_ROW_WRITE_PROBE_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/** The body of `SecurityPlugin#checkAuthoredRowWrite`; the method's docblock there is its contract. */
export async function checkAuthoredRowWrite(
  this: Pick<AuthoredRowWriteHost, 'collectRLSPolicies' | 'computeLayeredRlsFilter' | 'logger' | 'ql' | 'resolvePermissionSetsForContext'>,
  object: string,
  recordId: string,
  operation: AuthoredRowWriteOperation,
  context?: any,
): Promise<AuthoredRowWriteVerdict> {
  try {
    if (!object || recordId == null || recordId === '') return 'abstain';
    if (operation !== 'update' && operation !== 'delete') return 'abstain';
    if (!this.ql) return 'abstain';
    // No principal, or a delegated identity this path cannot intersect —
    // both are "cannot measure", which is `abstain` (never `admit`).
    if (!context?.userId) return 'abstain';
    if (context?.onBehalfOf?.userId) return 'abstain';

    const permissionSets = await this.resolvePermissionSetsForContext(context);
    if (permissionSets.length === 0) return 'abstain';

    // Cheap provenance pre-check: if the caller holds NO app-authored policy
    // applicable to (object, operation), there is nothing that could admit by
    // declaration — answer without spending a database round-trip. This is
    // the same collection the compiler consumes, filtered by the same
    // provenance predicate, so the two cannot disagree about what "authored"
    // means.
    //
    // [#8059] The pre-check asks for an authored policy that ADMITS ROWS —
    // one carrying a `using` scope predicate. A `check`-only policy declares
    // no row scope at all (ADR-0058 D4: post-image validation), so it can
    // admit nothing, and the verdict for a caller holding only check-only
    // policies is `abstain` — which is the verdict this method already
    // returned before #8059 and must keep returning after it. It got there
    // by a route the fix removes: a check-only policy compiles to no `using`
    // filter, so Layer 1 was null and the `layer1 == null → abstain` rule
    // below fired. Site 1 now DERIVES a Layer 1 from the caller's select
    // narrowing in exactly that case, so without this clause the derived
    // readable-set scope would start answering `admit` — and `admit` is what
    // the by-id widener uses to WIDEN. That is precisely the masquerade the
    // doc comment above promises cannot happen (#5493 / #7281), so the
    // promise is now kept by an explicit test rather than by the accident of
    // a null Layer 1. Nothing narrows here: `abstain` changes nothing on its
    // own, and the pre-image gate still refuses on its own terms.
    const authored = this.collectRLSPolicies(
      permissionSets,
      object,
      operation,
      (context?.positions ?? []) as string[],
      context,
    ).filter((p) => !isPlatformOwnershipFloorPolicy(p) && policyDeclaresClause(p, 'using'));
    if (authored.length === 0) return 'abstain';

    const { layer0, layer1 } = await this.computeLayeredRlsFilter(
      permissionSets,
      object,
      operation,
      context,
      { dropPlatformOwnershipFloor: true },
    );
    // See the doc above: a null Layer 1 means no authored predicate is
    // gating this write, which is an abstention and not an admission.
    if (layer1 == null) return 'abstain';

    const parts = [{ id: recordId }, ...(layer0 ? [layer0] : []), layer1];
    // [#7281] The predicate is the question; the scope is not. Read ELEVATED
    // (see AUTHORED_ROW_WRITE_PROBE_CONTEXT) so the answer is decided by
    // `{id} AND layer0 AND layer1` alone, and projected to `id` so the probe
    // can only ever learn EXISTENCE — no column of a row the caller may not
    // read is materialised, let alone returned. The verdict remains evidence,
    // never authorization: the by-id write pre-image gate still resolves the
    // write under the caller's own context.
    const row = await this.ql.findOne(object, {
      where: { $and: parts },
      fields: ['id'],
      context: { ...AUTHORED_ROW_WRITE_PROBE_CONTEXT },
    });
    return row ? 'admit' : 'abstain';
  } catch (e) {
    this.logger.warn?.(
      `[security] checkAuthoredRowWrite could not resolve an authored-policy verdict for ` +
        `'${object}' record '${recordId}' (${operation}, user ${context?.userId ?? 'unknown'}) — ` +
        `abstaining (fail-closed: a verdict that cannot be resolved never lifts the sharing refusal)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    return 'abstain';
  }
}
