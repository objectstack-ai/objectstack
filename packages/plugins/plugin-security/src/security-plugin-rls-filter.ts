// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 7] The RLS filter layers of `SecurityPlugin`, moved out of
 * `security-plugin.ts`:
 *
 * - `computeLayeredRlsFilter`, the ADR-0095 D1 split every row filter is
 *   composed from: Layer 0 (the tenant wall, with its one platform-admin
 *   exemption and the verified platform owner's read crossing, #12974) and
 *   Layer 1 (business RLS, with the ownership floor's replacements, the #7665
 *   derived write scope and the field-existence net), BEFORE the AND-compose.
 *   `computeRlsFilter` composes them, and the explain engine reads the split.
 * - `isVerifiedPlatformOwnerSession`, the fail-closed probe the read wall's
 *   owner crossing asks (#12974, #13147).
 * - `computeWriteCheckFilter`, the ADR-0058 D4 post-image `check` compile.
 * - `stageRlsMembership`, the ADR-0105 D11 membership staging both compiles
 *   ask before they run. Since #25234 (ruling A) it also stages the declared
 *   membership keys the policies about to compile read
 *   (`object-membership-keys.ts`), so its resolver half is
 *   `stageResolverMembership`.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same layers in the same order, the same floor
 * drops, the same deny sentinel, the same owner-crossing log line and event
 * name, the same fail-closed answers. `computeLayeredRlsFilter`'s return type
 * is repeated as the method declares it, with the docblocks of its two
 * members.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 6 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps all four private methods — the
 * published `dist/*.d.ts` lists each one's name, docblock and position — and
 * each body is one literal of exactly the {@link RlsFilterHost} members that
 * method reads, plus a `.call`. A method is handed over as a closure that calls
 * it on the plugin at call time, so a test double or spy set on the plugin is
 * still the one the body reaches: the layered computation still stages
 * membership, asks the owner probe and the platform-admin probe, and reads the
 * floor predicate through the plugin, and the explain engine, `computeRlsFilter`
 * and every other caller still reach these methods through the plugin. All
 * four methods were async and all four functions still are; each method now
 * returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `datetimeFieldNamesCache`, `numberComparandFieldsCache` and
 * `tenancyDisabledCache` are declared `readonly` and go by value, so the
 * bodies read the plugin's own maps. `logger`, `metadata`,
 * `permissionEvaluator`, `ql`, `rlsCompiler`, `rlsMembershipResolver` and
 * `tenancyPosture` are not declared `readonly`, so they go as GETTERS, and each
 * read happens when the body makes it.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * `computeRlsFilter`, `hasPlatformAdminPosture` and
 * `platformFloorYieldsToObjectWriteModel` stay in the class whole: each body
 * is shorter than its stub would be. `RlsFilterOptions` keeps its one
 * declaration there, where the middleware, the explain path and the floor-drop
 * resolution read it; this module names it through the class's own signature
 * (below). Two module-level functions stay there too, and are exported and
 * imported here by value: `isCarriedPosture`, which the capability list's
 * docblock names in place, and `writeCheckPolicies`, which ADR-0066 and the
 * spec liveness ledger anchor in that file. Each is read only inside a function
 * body, at call time, never while either module evaluates, so the two-way
 * import is safe under ESM, and the published bundle holds one module.
 *
 * The imports only these bodies read moved here: the Layer 0 verdict ladder
 * from `tenant-layer.js`, the owner-crossing event name and row predicate from
 * `platform-owner-wall-bypass.js`, the declared-administrator parser from
 * `@objectstack/core`, and the reserved membership keys from
 * `@objectstack/spec/contracts`. `security-plugin.ts` keeps the two of them
 * its docblocks link to (`isConfiguredPlatformAdminEmail`,
 * `isVerifiedPlatformOwnerRow`), as before. The deny sentinel and the clause
 * test are imported from `rls-compiler.js`, the floor test from
 * `platform-ownership-policies.js`, and `PermissionSet` and
 * `TenantLayer0Verdict` from `@objectstack/spec/security`, as
 * `security-plugin.ts` imports them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { isCarriedPosture, writeCheckPolicies } from './security-plugin.js';
import type { PermissionSet, RowLevelSecurityPolicy, TenantLayer0Verdict } from '@objectstack/spec/security';
import { RESERVED_RLS_MEMBERSHIP_KEYS } from '@objectstack/spec/contracts';
import { isConfiguredPlatformAdminEmail, resolvePlatformAdminEmails } from '@objectstack/core';
import { RLS_DENY_FILTER, policyDeclaresClause } from './rls-compiler.js';
import { isPlatformOwnershipFloorPolicy } from './platform-ownership-policies.js';
import { noteResolverStagedKeys, stageDeclaredMembershipKeys } from './object-membership-keys.js';
import {
  computeTenantLayer0Verdict,
  tenantLayer0FilterOf,
  tenantLayer0InputOf,
  type TenantLayer0Input,
} from './tenant-layer.js';
import {
  PLATFORM_OWNER_WALL_BYPASS_EVENT,
  isVerifiedPlatformOwnerRow,
} from './platform-owner-wall-bypass.js';

/**
 * The layered computation's options, as the class declares them: the
 * `RlsFilterOptions` interface stays in `security-plugin.ts`, and the moved
 * bodies name it exactly as they did.
 */
type RlsFilterOptions = NonNullable<Parameters<SecurityPlugin['computeLayeredRlsFilter']>[4]>;

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface RlsFilterHost {
  readonly datetimeFieldNamesCache: SecurityPlugin['datetimeFieldNamesCache'];
  readonly logger: SecurityPlugin['logger'];
  readonly metadata: SecurityPlugin['metadata'];
  readonly numberComparandFieldsCache: SecurityPlugin['numberComparandFieldsCache'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly rlsCompiler: SecurityPlugin['rlsCompiler'];
  readonly rlsMembershipResolver: SecurityPlugin['rlsMembershipResolver'];
  readonly tenancyDisabledCache: SecurityPlugin['tenancyDisabledCache'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  collectRLSPolicies: SecurityPlugin['collectRLSPolicies'];
  extractTargetField: SecurityPlugin['extractTargetField'];
  getObjectFieldNames: SecurityPlugin['getObjectFieldNames'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  hasPlatformAdminPosture: SecurityPlugin['hasPlatformAdminPosture'];
  isVerifiedPlatformOwnerSession: SecurityPlugin['isVerifiedPlatformOwnerSession'];
  platformFloorYieldsToObjectWriteModel: SecurityPlugin['platformFloorYieldsToObjectWriteModel'];
  stageRlsMembership: SecurityPlugin['stageRlsMembership'];
}

/**
 * The body of `SecurityPlugin#computeLayeredRlsFilter`. Its contract is the
 * `[C2 / ADR-0095 D1]` docblock there, which sits above `hasPlatformAdminPosture`'s.
 */
export async function computeLayeredRlsFilter(
  this: Pick<RlsFilterHost, 'collectRLSPolicies' | 'datetimeFieldNamesCache' | 'extractTargetField' | 'getObjectFieldNames' | 'getObjectSecurityMeta' | 'hasPlatformAdminPosture' | 'isVerifiedPlatformOwnerSession' | 'logger' | 'metadata' | 'numberComparandFieldsCache' | 'permissionEvaluator' | 'platformFloorYieldsToObjectWriteModel' | 'ql' | 'rlsCompiler' | 'stageRlsMembership' | 'tenancyDisabledCache' | 'tenancyPosture'>,
  permissionSets: PermissionSet[],
  object: string,
  operation: string,
  context: any,
  opts?: RlsFilterOptions,
): Promise<{
  layer0: Record<string, unknown> | null;
  layer1: Record<string, unknown> | null;
  /**
   * [#15813] What Layer 0 DECIDED — `layer0` is this verdict's projection
   * (`tenantLayer0FilterOf`), never a sibling computation. The engine
   * middleware records it on the operation context so a producer downstream
   * reads the wall's decision instead of re-deriving the wall.
   */
  tenantLayer0Verdict: TenantLayer0Verdict;
  /**
   * [ADR-0095 D3 · #24821] True only when a true `PLATFORM_ADMIN` crossing on
   * a posture-permitting object is what made {@link tenantLayer0Verdict}
   * `none` — the wall stands for every other caller on this object.
   */
  crossedByPlatformAdmin: boolean;
}> {
  // [ADR-0095 D1] Effective filter = Layer0(tenant) AND Layer1(business RLS).
  // The two are computed independently and never share a compiler, a merge
  // step, or a bypass bit (closes W1 by construction, W2 structurally).
  const meta = await this.getObjectSecurityMeta(object);
  const isWrite = operation === 'insert' || operation === 'update' || operation === 'delete';
  // Posture permits a platform admin to cross the tenant wall (ADR-0066 ①):
  // private / platform-global / better-auth-managed objects. Public tenant
  // business objects do NOT permit it, so a platform admin stays org-scoped.
  const posturePermits = meta.isPrivate || meta.tenancyDisabled || meta.isBetterAuthManaged;
  // The superuser bit (`viewAllRecords`/`modifyAllRecords`) governs the BUSINESS
  // RLS (Layer 1) short-circuit below — a TENANT_ADMIN legitimately sees every
  // row WITHIN its org, no ownership/depth/sharing narrowing (ADR-0095 D2).
  const superuserBypass = posturePermits
    ? (isWrite
        ? this.permissionEvaluator.hasSuperuserWriteBypass(object, permissionSets, { isPrivate: meta.isPrivate })
        : this.permissionEvaluator.hasSuperuserReadBypass(object, permissionSets, { isPrivate: meta.isPrivate }))
    : false;
  // [Finding 2 / #2937 / ADR-0099 D1 (P1)] The Layer 0 cross-tenant EXEMPTION
  // is stricter than the superuser bit: it requires a TRUE PLATFORM_ADMIN, so a
  // tenant `organization_admin` (which also holds the superuser bit via its `'*'`
  // wildcard) stays org-scoped even on private objects (invariant I1). The tier
  // signal is the CARRIED rung when the context passed the resolver (#2956); the
  // capability probe is the fallback for hand-built contexts that carry no rung.
  // Both are computed so a disagreement (only possible on the fallback-eligible
  // divergence class — scoped `admin_full_access` / piecemeal platform caps) is
  // logged as a defect (ADR-0099 I4) and the NARROWER rung verdict is enforced.
  const carriedPosture = context?.posture;
  const probePlatformAdmin = this.hasPlatformAdminPosture(permissionSets);
  let platformPosture: boolean;
  if (isCarriedPosture(carriedPosture)) {
    platformPosture = carriedPosture === 'PLATFORM_ADMIN';
    if (platformPosture !== probePlatformAdmin) {
      // rung ⊆ probe (I3), so this only fires as probe=true / rung≠PLATFORM_ADMIN
      // — the adjudicated narrowing (#3211 G1). A breadcrumb, never a throw.
      this.logger.warn?.(
        '[authz/ADR-0099] Layer 0 exemption: carried posture rung and capability probe disagree; ' +
          'enforcing the (narrower) carried rung',
        { object, operation, carriedPosture, probePlatformAdmin, userId: context?.userId },
      );
    }
  } else {
    platformPosture = probePlatformAdmin;
  }
  const isPlatformAdmin = superuserBypass && platformPosture;

  // Field set drives BOTH the Layer 1 field-existence net and the Layer 0
  // "is this a tenant object?" check.
  const objectFields = await this.getObjectFieldNames(this.metadata, object, this.ql);
  const tenancyDisabled = this.tenancyDisabledCache.get(object) === true || meta.tenancyDisabled;

  // [ADR-0105 D11] Stage app-resolved membership sets before Layer 1 compiles,
  // so `field IN (current_user.<key>)` predicates can resolve. Lazy (only when
  // a resolver is registered) and memoized per request — resolution is I/O and
  // the same context is reused across every object touched by one request.
  await this.stageRlsMembership(context);

  // ── Layer 1: business RLS (ownership / unit depth / sharing / _self carve-outs).
  // The wildcard tenant policy has LEFT this layer (retired from the seeds), so
  // this superuser short-circuit now governs BUSINESS RLS only — it can no
  // longer skip the tenant wall (that is Layer 0's own exemption, below).
  let layer1: Record<string, unknown> | null = null;
  if (!(posturePermits && superuserBypass)) {
    let collected = this.collectRLSPolicies(permissionSets, object, operation, (context?.positions ?? []) as string[], context);
    // [#8023] An object whose author DECLARED `sharingModel:
    // 'public_read_write'` does not inherit the platform's wildcard `update`
    // ownership floor AT ALL. QA #7637 measured the contradiction it caused
    // on the stock showcase: `showcase_project` declares that OWD, the access
    // matrix grants `showcase_contributor` `edit: true`, no RLS is authored —
    // and a PATCH of a row the persona had not created answered 403 with the
    // record-level sentence. The floor is `member_default`'s
    // `owner_only_writes` (object `'*'`, `created_by == current_user.id`,
    // positions `['org_member']`), and it survived because the by-id gate
    // only lets `ISharingService` REPLACE it on a positive `allow`, while a
    // public object makes the service `abstain`.
    //
    // ⚠️ THE PLACEMENT IS THE FIX, not just where it reads best. Removing the
    // floor HERE — before the #7665 derive-from-select branch below — leaves
    // the update class EMPTY, so that branch then derives the write scope
    // from the caller's SELECT narrowing and "you cannot mutate what you
    // cannot see" still holds on this very object (#7792's by-id
    // write-visibility property, which the card names as a non-regression
    // criterion). Removing it at the `dropPlatformOwnershipFloor` filter
    // further down would instead compile Layer 1 to null and hand back an
    // UNGATED by-id write — the same hole #7665 closed, reopened by a fix for
    // a different bug.
    //
    // Scope, stated twice because each half is load-bearing:
    //   - only the PLATFORM's floor is dropped (provenance, ADR-0105 D3): an
    //     app-authored policy spelling the identical predicate still reaches
    //     the compiler and still refuses (ADR-0049);
    //   - only `update` (`owdOpenWritesCoversOperation`): `owner_only_deletes`
    //     stays, because `public_read_write` is "see and edit" and the alias
    //     that also meant delete was removed for being wider than it.
    // Layer 0 (the tenant wall) is untouched — a `public_read_write` object is
    // org-wide open, never cross-tenant open.
    //
    // Both drops below ask ONE predicate,
    // {@link platformFloorYieldsToObjectWriteModel}, which the post-image
    // check (`computeWriteCheckFilter`) asks too, so the floor a defaulted
    // check composes is the floor this pre-image composed.
    //
    // [commit 6feac910b] An ADR-0055 `controlled_by_parent` detail does not inherit the
    // platform's wildcard write ownership floor either — for a DIFFERENT
    // reason from the OWD above, and under one extra condition.
    //
    // The reason: the detail's OWD does not say nothing about writes, it says
    // "derive them from the master", and the master has its own gate
    // (`assertControlledByParentWrite`, step 2.8). Running the floor as well
    // made two gates answer one write and let the widener-blind one win — the
    // detail became creator-only, a row-level write rule its author never
    // declared and no mechanism could drop, `modifyAllRecords` included
    // (`checkEdit` abstains on the `public`-mapped model above its bypass
    // branch, so step 2.7's `dropPlatformOwnershipFloor` could never fire
    // here). Maintainer ruling 2026-08-15: the master gate is the SOLE
    // row-write authority for such a detail.
    //
    // The extra condition is the ruling's own precondition, and it is why
    // this reads an `opts` flag while the OWD line above reads only `meta`:
    // the floor comes off only where the master gate DEMONSTRABLY covers the
    // same operation, which is a fact about the call site. The by-id write
    // pre-image gate vouches for it (step 2.8 runs immediately below it on
    // the same pass, under a superset of its own guard); the bulk-write path
    // does not and must not, because `assertControlledByParentWrite` returns
    // early with no single id and nothing would replace the floor there.
    // Both directions are pinned in
    // `controlled-by-parent-detail-write-authority.test.ts`.
    //
    // ⚠️ THE PLACEMENT IS LOAD-BEARING, on exactly the reasoning #8023
    // records two comments up. Dropping the floor HERE — ahead of the #7665
    // derive-from-select branch — leaves the write class empty, so a detail
    // that DOES author select policies still derives its write scope from
    // its own read narrowing. Dropping it at the `dropPlatformOwnershipFloor`
    // filter further down would skip that branch and compile Layer 1 to null.
    // Scope, both halves load-bearing:
    //   - only the PLATFORM's floor (provenance, ADR-0105 D3) — an
    //     app-authored policy spelling the identical predicate still reaches
    //     the compiler and still refuses (ADR-0049);
    //   - only the write classes the master gate covers
    //     (`masterGateCoversOperation`), which is every class the floor ships.
    // Layer 0 (the tenant wall) is untouched, and so is the read path: the
    // floor is a write-side construct that never applied to `select`.
    if (this.platformFloorYieldsToObjectWriteModel(meta, object, operation, opts)) {
      collected = collected.filter((p) => !isPlatformOwnershipFloorPolicy(p));
    }
    // [#7665] The write-visibility floor: a write target must be inside the
    // caller's READABLE set. When NO policy of the write class applies to
    // this (principal, object, operation) — nothing authored for the class,
    // and the platform ownership floor outside its `positions` domain — the
    // write class used to compile to a null Layer 1, and every write-side
    // row gate composed from it became a no-op at once: the by-id pre-image
    // gate (step 2.7), the controlled_by_parent master check, and the bulk
    // write AST injection. QA #7637 measured the result on the stock
    // showcase (select-only narrowing, `contributor` position, OWD
    // `public_read_write`): a contributor PATCHed by id records they could
    // not read — on the master AND on a controlled_by_parent detail — while
    // the read side correctly hid them.
    //
    // So an empty write-class collection now DERIVES the write scope from
    // the caller's SELECT narrowing — the same policies, compiled by the
    // same compiler, that the read path enforces. "You cannot mutate what
    // you cannot see" then holds by construction, and the explain engine
    // reports the same narrowing for update/delete that it reports for
    // read, instead of "No RLS policy applies".
    //
    // Deliberately NOT derived:
    //   - when ANY write-class policy applies (an authored predicate, or
    //     the in-domain platform floor): those paths keep their exact
    //     semantics, including every widening direction #7401 / #6736
    //     track — #7665 criterion 5 (derive ONLY when no update-scope
    //     predicate exists). `checkAuthoredRowWrite` is additionally
    //     protected by its own authored-set pre-check, so a derived scope
    //     can never masquerade as an authored admission (#5493 / #7281);
    //   - for `insert` — there is no pre-existing row to be visible (a
    //     controlled_by_parent detail INSERT is still gated through its
    //     master's derived scope by step 2.8);
    //   - when the caller holds the read-side superuser bypass on a
    //     posture-permitting object — their readable set is unbounded, so
    //     the readability requirement imposes nothing. This is the mirror
    //     of the read path's own Layer-1 short-circuit above, so the
    //     derived write scope can never be NARROWER than the read scope it
    //     is derived from.
    //
    // [#8059 site 1] The trigger asks whether a write-scope PREDICATE
    // applies — NOT whether the applicable set is merely non-empty. Those
    // read the same only while every write-class policy carries a `using`.
    // A policy declaring `check` alone gates nothing about WHICH existing
    // row may be targeted (it validates the post-image, ADR-0058 D4), yet
    // it is fully applicable on object + `positions` + operation, so the
    // emptiness test counted it and switched the derivation off. The
    // collected policy then compiled to no row filter — it carries no
    // `using` for the compiler to read — so Layer 1 was null exactly as it
    // was before #7665, and every write-side row gate composed from it went
    // back to being a no-op. Measured on the stock showcase: a contributor
    // GET-404s `showcase_invoice` and PATCHes it by id, 200, row changed,
    // because `invoice_owner_immutable` is `operation: 'update'` with
    // `check` only. #7665 criterion 5 is a statement about PREDICATES, and
    // this is it, spelled the way the criterion reads.
    //
    // The predicate test is a superset of the old emptiness test (an empty
    // collection carries no `using` either), so every path #7665 pinned is
    // reached on exactly the same inputs as before.
    if (
      !collected.some((p) => policyDeclaresClause(p, 'using')) &&
      (operation === 'update' || operation === 'delete') &&
      !(
        posturePermits &&
        this.permissionEvaluator.hasSuperuserReadBypass(object, permissionSets, { isPrivate: meta.isPrivate })
      )
    ) {
      collected = this.collectRLSPolicies(permissionSets, object, 'select', (context?.positions ?? []) as string[], context);
    }
    // [#5492] Provenance composition: the caller (the by-id write pre-image
    // gate) has already asked the declared write authority — `ISharingService`
    // — and received a positive `allow`. Its answer REPLACES the platform's own
    // ownership floor, which is the widener-blind second implementation of the
    // same "ownership" contract. Only the PLATFORM's floor is replaceable; an
    // app-authored policy — even one spelling the identical predicate under a
    // different name — reaches the compiler untouched (ADR-0049, and the
    // ADR-0105 F1 lesson that a token match swallows authored policies).
    const allRlsPolicies = opts?.dropPlatformOwnershipFloor
      ? collected.filter((p) => !isPlatformOwnershipFloorPolicy(p))
      : collected;
    if (allRlsPolicies.length > 0) {
      // Field-existence safety, in TWO passes that answer two different
      // questions. Schema-lookup failure runs neither: a schema that cannot
      // be loaded must not manufacture denials.
      //
      // Pass 1, HERE — the ADR-0095 delta c carve-out, and only that. A
      // wildcard `organization_id`-leading policy on an object that opted OUT
      // of tenancy is NOT APPLICABLE to it, so it is skipped WITHOUT
      // contributing to the deny sentinel; a leading miss on any other column
      // is a deny contribution. `extractTargetField`'s leading `==` / `=` /
      // `in` shape match is exactly the right instrument for that carve-out,
      // because the shape it recognises is the shape the platform's own
      // tenant policy is authored in.
      //
      // Pass 2, in the COMPILER — every column named ANYWHERE in the
      // predicate, in any position and any polarity. ⚠️ This pass is what
      // pass 1 cannot do and must not be widened to do: a predicate naming an
      // undeclared column in a NEGATION-carrying position (`nope != "x"`,
      // `!(nope == 1)`, `!(nope in […])`, or a trailing `||` arm) returned
      // `null` from `extractTargetField`, so the policy was KEPT, `dropped`
      // never incremented, the sentinel never armed — and a row that has no
      // such column SATISFIES the negation, so the authored narrowing widened
      // to every row inside the tenant wall instead of denying. Teaching the
      // regex more spellings would only move the same defect one level over;
      // the compiler judges the compiled tree, where a negation is a `$not`
      // node and has no spelling left to hide behind. The matcher's
      // include-direction ruling is untouched — it never sees the phantom.
      let dropped = 0;
      const compilable = objectFields
        ? allRlsPolicies.filter((p) => {
            const targetField = this.extractTargetField(p.using);
            if (!targetField) return true;
            if (objectFields.has(targetField)) return true;
            if (tenancyDisabled && targetField === 'organization_id') {
              return false;
            }
            dropped++;
            return false;
          })
        : allRlsPolicies;
      // [#25234 ruling A] The declared membership keys these policies read,
      // staged before they compile. The resolver's half ran above.
      await this.stageRlsMembership(context, compilable, object);
      layer1 = this.rlsCompiler.compileFilter(
        compilable,
        context,
        'using',
        objectFields
          ? {
              declared: objectFields,
              datetime: this.datetimeFieldNamesCache.get(object),
              number: this.numberComparandFieldsCache.get(object),
            }
          : undefined,
      );
      // Every applicable policy dropped for a missing field → deny sentinel,
      // by reference (ADR-0139 D2 step 2: recognised by identity).
      if (layer1 == null && dropped > 0) {
        layer1 = RLS_DENY_FILTER;
      }
    }
  }

  // ── Layer 0: tenant isolation — independent, always-first, AND-composed.
  // Decides "tenant object?" directly from the field set + tenancy posture (NOT
  // via extractTargetField's `=`-only shape match), so a `tenancy.enabled:false`
  // global object correctly contributes nothing (ADR-0095 delta c).
  // [#15813] The verdict is computed ONCE; the filter injected below is its
  // projection. Recording the verdict costs no second computation.
  // The input is gathered by `tenantLayer0InputOf` (`tenant-layer.ts`), the
  // one builder every reader of the wall shares, so the declared
  // membership-key read walls its roster read with this same input.
  const tenantLayer0Input: TenantLayer0Input = tenantLayer0InputOf({
    tenancyPosture: this.tenancyPosture,
    context,
    meta,
    objectFields,
    tenancyDisabled,
    isPlatformAdmin,
  });
  const tenantLayer0Verdict = computeTenantLayer0Verdict(tenantLayer0Input);
  const layer0 = tenantLayer0FilterOf(tenantLayer0Verdict);
  // [ADR-0095 D3 · ADR-0123 D2 · #24821] Did the platform operator's crossing,
  // and nothing else, make this verdict `none`? Asked of the ONE ladder a
  // second time with only the exemption's own fact withheld, so no rung —
  // posture, tenant object, phantom anchor — is re-derived here. A `single`
  // posture or a non-tenant object answers `none` both ways and is not a
  // crossing. Step 3.7 reads it: crossing lets an operator read and update
  // every organization's rows, and does not give a NEW row an organization.
  const crossedByPlatformAdmin =
    tenantLayer0Verdict.kind === 'none' &&
    isPlatformAdmin &&
    computeTenantLayer0Verdict({ ...tenantLayer0Input, isPlatformAdmin: false }).kind !== 'none';

  // [#12974] Verified platform OWNER crosses the Layer 0 org wall — READS
  // ONLY. Maintainer ruling 2026-08-29, verbatim and untranslated: 「能不能
  // 简单点，对于超级管理员，配置了环境变量邮箱的，在执行墙的时候不要强制加上
  // org_id 的过滤」— the ruling is about the wall's FILTER on operator
  // screens reading; the director's correction (same card, after the dogfood
  // gate) scopes the door accordingly. When the READ wall ARMS (layer0
  // non-null on a select/count/aggregate: the `isolated` equality, the
  // `group` union, or the fail-closed deny sentinel an org-less session
  // otherwise hits), the org filter is NOT appended for a session whose
  // account is the VERIFIED declared platform owner (`OS_PLATFORM_OWNER_EMAIL`
  // under commit c0714eb5d's verified-email predicate — the same match the elevation
  // gate makes; see `isVerifiedPlatformOwnerSession` for the fail-closed
  // ladder). Everyone else's wall is byte-identical to before: the probe
  // answers `false` on env-unset before touching any row, and it is not even
  // consulted while Layer 0 contributes nothing.
  //
  // WRITES keep today's behaviour for everyone INCLUDING the owner (`isWrite`
  // guards the branch): an org-less tenant-scoped write is REFUSED 403 naming
  // the missing active organization — the ADR-0123 D2 contract, whose verdict
  // is DERIVED from this very computation (`computeWriteTenantCheckFilter` →
  // the deny sentinel). Lifting the write twin would not grant the owner a
  // cross-org write; it would mint exactly the NULL-organization rows the
  // platform is eliminating, and it measurably broke the dogfood pin (500
  // where the 403 refusal belongs). The by-id write PRE-IMAGE read carries
  // the write operation name through this method, so it stays walled too.
  //
  // ONLY the read-side Layer 0 is lifted. Layer 1 (business RLS, object/field
  // permissions, the write `check` path) is untouched by construction — this
  // branch rewrites the `layer0` half of the split and nothing else.
  if (!isWrite && layer0 !== null && (await this.isVerifiedPlatformOwnerSession(context))) {
    // The audit floor (hard piece 3 of the ruling): a structured warn-level
    // log with the stable event name, per wall-bypassing READ computation —
    // the only bypass kind left. plugin-audit is not wired into
    // plugin-security (no dependency in either direction; its `audit`
    // service ingress is a CLOSED auth-session vocabulary), so the
    // `sys_audit_log` ledger is deliberately not the sink here. Named after
    // the cloud precedent (`cross_org_admin_read`).
    this.logger.warn?.(
      `[security] ${PLATFORM_OWNER_WALL_BYPASS_EVENT}: verified platform owner crossed ` +
        'the Layer 0 organization wall on a read — the org filter below was NOT appended (only the ' +
        "declared platform owner's reads cross it; writes stay walled for everyone)",
      {
        event: PLATFORM_OWNER_WALL_BYPASS_EVENT,
        object,
        operation,
        userId: context?.userId,
        organizationId: context?.tenantId ?? null,
        tenancyPosture: this.tenancyPosture,
        suppressedFilter: layer0,
      },
    );
    // [#15813] The recorded verdict follows the wall as APPLIED: lifted here,
    // so `none` — a reader must not learn an organization from a wall that
    // was not appended.
    return { layer0: null, layer1, tenantLayer0Verdict: { kind: 'none' }, crossedByPlatformAdmin };
  }

  return { layer0, layer1, tenantLayer0Verdict, crossedByPlatformAdmin };
}

/** The body of `SecurityPlugin#isVerifiedPlatformOwnerSession`; the method's docblock there is its contract. */
export async function isVerifiedPlatformOwnerSession(
  this: Pick<RlsFilterHost, 'ql'>,
  context: any,
): Promise<boolean> {
  const declared = resolvePlatformAdminEmails();
  if (declared.emails.length === 0) return false;
  if (!context || typeof context !== 'object') return false;
  const userId = context.userId;
  if (typeof userId !== 'string' || userId === '') return false;
  if (typeof context.__verifiedPlatformOwner === 'boolean') return context.__verifiedPlatformOwner;
  if (typeof context.email === 'string' && context.email.trim() !== '') {
    if (!isConfiguredPlatformAdminEmail(context.email, declared)) {
      context.__verifiedPlatformOwner = false;
      return false;
    }
  }
  let row: unknown = null;
  try {
    if (typeof this.ql?.findOne === 'function') {
      row = await this.ql.findOne('sys_user', { where: { id: userId }, context: { isSystem: true } });
    } else if (typeof this.ql?.find === 'function') {
      const rows = await this.ql.find('sys_user', { where: { id: userId }, limit: 1, context: { isSystem: true } });
      row = Array.isArray(rows) ? rows[0] : ((rows as any)?.value?.[0] ?? null);
    }
  } catch {
    row = null;
  }
  const verdict = isVerifiedPlatformOwnerRow(row, declared);
  context.__verifiedPlatformOwner = verdict;
  return verdict;
}

/** The body of `SecurityPlugin#computeWriteCheckFilter`; the method's docblock there is its contract. */
export async function computeWriteCheckFilter(
  this: Pick<RlsFilterHost, 'collectRLSPolicies' | 'datetimeFieldNamesCache' | 'getObjectFieldNames' | 'getObjectSecurityMeta' | 'metadata' | 'numberComparandFieldsCache' | 'permissionEvaluator' | 'platformFloorYieldsToObjectWriteModel' | 'ql' | 'rlsCompiler' | 'stageRlsMembership'>,
  permissionSets: PermissionSet[],
  object: string,
  operation: string,
  context: any,
  preImageOpts?: RlsFilterOptions,
): Promise<Record<string, unknown> | null> {
  // [ADR-0066 ①] modifyAllRecords bypasses write-side RLS (incl. the post-image
  // check) on private/platform-global objects.
  const meta = await this.getObjectSecurityMeta(object);
  if (
    (meta.isPrivate || meta.tenancyDisabled || meta.isBetterAuthManaged) &&
    this.permissionEvaluator.hasSuperuserWriteBypass(object, permissionSets, { isPrivate: meta.isPrivate })
  ) {
    return null;
  }
  // [#8059 site 2] `heldPositions` is threaded through, exactly as every
  // other `collectRLSPolicies` call site threads it. Omitting it did not
  // widen the check — it DELETED it: `getApplicablePolicies` evaluates the
  // ADR-0090 P2 applicability domain against the positions it is given, so
  // with `[]` every policy declaring `positions` failed the domain test and
  // was filtered out of the post-image check FOR EVERY CALLER, holder and
  // non-holder alike. A position-scoped `check` clause was therefore inert
  // (ADR-0049 enforce-or-remove; the same class #3539 closed for org-scoped
  // policies) — the showcase's `invoice_owner_immutable` among them, which
  // is why the by-id write measured in #8059 was not stopped on the way out
  // either once site 1 had let it past the row gate. The domain still
  // decides: a non-holder is outside it and the policy still does not apply
  // to them.
  // The platform ownership floor takes part in a defaulted check exactly
  // when the pre-image gate kept it: the same three replacements drop it here
  // (an `allow` from the declared write authority, a `public_read_write` OWD,
  // a covering master gate), and nothing else does.
  const floorReplaced =
    !!preImageOpts?.dropPlatformOwnershipFloor ||
    this.platformFloorYieldsToObjectWriteModel(meta, object, operation, preImageOpts);
  const withCheck = writeCheckPolicies(
    this.collectRLSPolicies(
      permissionSets,
      object,
      operation,
      (context?.positions ?? []) as string[],
      context,
    ),
    { keepOwnershipFloor: !floorReplaced },
  );
  if (withCheck.length === 0) return null;
  // [ADR-0105 D11 / commit 1d73d45c1] Stage the app-resolved membership sets on THIS
  // context before the `check` clause compiles — the same staging the read
  // side performs before Layer 1 compiles (`computeLayeredRlsFilter`). A
  // bare insert performs no read, so without this line the `check` twin of
  // a `using` clause that reads a resolver key
  // (`record.f in current_user.<key>`) compiled against a context in which
  // the key had never been staged: unresolved variable → policy dropped →
  // `RLS_DENY_FILTER` → every such insert refused. The two write shapes
  // that DID pass did so by accident of an earlier read on the SAME context
  // object (the by-id pre-image at 2.7, the controlled_by_parent master
  // read) having staged it first; staging is memoized per context, so
  // those shapes still resolve exactly once. This OBTAINS the context the
  // check should always have had — it relaxes nothing: no resolver, a
  // throwing resolver or an unresolved key still drop the policy and still
  // fail closed, on this path as on the read path.
  // [#25234 ruling A] With the policies, so the declared membership keys a
  // `check` reads are staged too — the same keys its `using` twin stages.
  await this.stageRlsMembership(context, withCheck, object);
  // [#17042] The write face's field-existence net — which this path had NONE
  // of. `computeWriteCheckFilter` compiled `check` clauses with no column
  // check at all, so a phantom column in a negated position
  // (`nope != "x"`, `!(nope == 1)`, `!(nope in […])`, a trailing `||` arm)
  // was satisfied VACUOUSLY by the post-image and PERMITTED the write the
  // policy was authored to refuse — measured on both SQL drivers, the write
  // being driver-independent because the check is evaluated in-process
  // against the post-image (`matchesFilterCondition`, step 3.6). Only a
  // POSITIVE phantom refused, by accident of `looseEq(undefined, value)`
  // being false, which is why the hole was invisible to a suite that tested
  // the positive shape. The guard is the SAME one the read layer passes, so
  // the two faces can never again disagree about what an undeclared column
  // means. `null` (schema not loadable) passes no guard and behaves as before.
  const objectFields = await this.getObjectFieldNames(this.metadata, object, this.ql);
  return this.rlsCompiler.compileFilter(
    withCheck,
    context,
    'check',
    objectFields
      ? {
          declared: objectFields,
          datetime: this.datetimeFieldNamesCache.get(object),
          number: this.numberComparandFieldsCache.get(object),
        }
      : undefined,
  );
}

/** The body of `SecurityPlugin#stageRlsMembership`; the method's docblock there is its contract. */
export async function stageRlsMembership(
  this: Pick<RlsFilterHost, 'datetimeFieldNamesCache' | 'getObjectFieldNames' | 'getObjectSecurityMeta' | 'logger' | 'metadata' | 'numberComparandFieldsCache' | 'ql' | 'rlsCompiler' | 'rlsMembershipResolver' | 'tenancyDisabledCache' | 'tenancyPosture'>,
  context: any,
  policies?: readonly RowLevelSecurityPolicy[],
  object?: string,
): Promise<void> {
  if (!context || typeof context !== 'object') return;
  await stageResolverMembership.call(this, context);
  // [#25234 ruling A] The declarative second source: the keys these policies
  // read that an object declares (`object-membership-keys.ts`), per key and
  // memoized per request. After the resolver, so a key both sources claim is
  // withdrawn before anything compiles against it.
  if (policies && policies.length > 0) await stageDeclaredMembershipKeys(this, context, policies, object);
}

/** The registered resolver's half of {@link stageRlsMembership}: once per request. */
async function stageResolverMembership(
  this: Pick<RlsFilterHost, 'logger' | 'rlsMembershipResolver'>,
  context: any,
): Promise<void> {
  if (!this.rlsMembershipResolver) return;
  // One resolution per request: the same context object is threaded through
  // every object the operation touches.
  if (context.__rlsMembershipStaged) return;
  context.__rlsMembershipStaged = true;

  let resolved: Record<string, string[]> = {};
  try {
    resolved = (await this.rlsMembershipResolver.resolve({
      userId: context.userId,
      tenantId: context.tenantId,
      accessible_org_ids: context.accessible_org_ids,
      positions: context.positions,
      permissions: context.permissions,
    })) ?? {};
  } catch (e) {
    this.logger.warn?.(
      '[security/ADR-0105] rls-membership-resolver threw — its keys stay unresolved and the ' +
        'policies referencing them will fail closed',
      { error: (e as Error)?.message },
    );
    return;
  }

  const bag: Record<string, string[]> = { ...(context.rlsMembership ?? {}) };
  const staged: string[] = [];
  for (const [key, value] of Object.entries(resolved)) {
    if (RESERVED_RLS_MEMBERSHIP_KEYS.includes(key)) {
      this.logger.warn?.(
        '[security/ADR-0105] rls-membership-resolver tried to supply a RESERVED context key — ignored',
        { key },
      );
      continue;
    }
    if (!Array.isArray(value)) continue;
    // An already-staged key wins: a caller-supplied bag is closer to the
    // request than a generic resolver.
    if (bag[key] === undefined) {
      bag[key] = value.filter((v) => typeof v === 'string');
      staged.push(key);
    }
  }
  // [#25234] Which keys the resolver supplied, so a key a declaration claims
  // too can be withdrawn from the bag (one namespace, neither source wins).
  noteResolverStagedKeys(context, staged);
  if (Object.keys(bag).length > 0) context.rlsMembership = bag;
}
