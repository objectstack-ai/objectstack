// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cuts 5 and 6] Step 3.7's Layer 0 tenant write wall of
 * `SecurityPlugin`, moved out of `security-plugin.ts`:
 *
 * - `composeWriteTenantWall` (cut 5), the wall composed once for one write:
 *   the ADR-0123 D2 scope pre-test that refuses a write with no active
 *   organization, the parts every row is held to (ADR-0095 D1, and the
 *   delegator's own wall under ADR-0090 D10), and the judgements that read
 *   them — the payload half, and the stored-image seam with its landing
 *   refusals (#24784, #24821).
 * - `organizationWallRefusal` (cut 6), that scope pre-test itself: which
 *   principal the no-active-organization wall refuses. `canWriteObject` asks
 *   it too, so the two doors share one spelling of the wall. The two
 *   module-level declarations only these bodies read moved with it:
 *   `callerHasOrganizationScope`, and `carriesActiveOrganization`, which the
 *   cut-5 body reads too.
 * - `writeWallVerdict` (cut 6), the wall's verdict on each row of a write
 *   PREVIEW (#25062), which the engine asks through `registerWriteWallVerdict`.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same pre-test, ordered ahead of the forge guard,
 * the same refusals with the same spellings, the same seam conditions, the
 * same preview answers. The two module-level declarations are as they stood,
 * docblocks included; `carriesActiveOrganization` is again declared without
 * `export`, as before cut 5. Nothing here logs or throws on a refusal, as
 * before: the middleware logs and throws each one (`raiseWriteWallRefusal`),
 * and the write preview answers it as a row's verdict.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 5 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps every method — the published
 * `dist/*.d.ts` lists each one's name, docblock and position, and
 * `writeWallVerdict`'s full signature, because it is public — and each body is
 * one literal of exactly the {@link WriteTenantWallHost} members that method
 * reads, plus a `.call`. A method is handed over as a closure that calls it on
 * the plugin at call time, so a test double or spy set on the plugin is still
 * the one the body reaches: the wall's pre-test is still the plugin's
 * `organizationWallRefusal`, the caller's Layer 0 is still the read side's,
 * through `computeWriteTenantWall` and `computeWriteTenantCheckFilter`, and the
 * preview still reaches the prologue (`resolveOperationPrincipals`) and the
 * wall (`composeWriteTenantWall`) through the plugin. Each method was async and
 * each function still is; each method now returns its function's promise.
 *
 * The two fields the bodies read go as GETTERS, by the rule cut 1 set:
 * `tenancyPosture` is not declared `readonly` (`start()` resolves it after
 * construction), and `orgScopingEnabled` is the class's own getter over it.
 * Each read happens when the body makes it, as before. That includes the
 * reads inside the judgements `composeWriteTenantWall` returns: the developer
 * messages of `denyOrganizationRemoval` and of `judgeLanding`'s two refusals
 * read `tenancyPosture` when the middleware or the preview calls them, through
 * the host, so they read the plugin's value at that time.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * `WriteTenantWall`, `WriteWallRefusal` and `WriteWallRowVerdict` keep their
 * one declaration there, where the method signatures, `raiseWriteWallRefusal`
 * and `start()` read them; this module names all three through the class's own
 * signatures (below). `isTenantWallDenial` stays there too, because
 * `tenant-layer.ts` names it as living in that file, and is exported and
 * imported here by value. It is read only inside a function body, at call
 * time, never while either module evaluates, so the two-way import is safe
 * under ESM, and the published bundle holds one module. `matchesFilterCondition`
 * is imported from `@objectstack/formula`, `postureUsesUnionScope` and
 * `TenancyPosture` from `@objectstack/spec/security` and `PermissionDeniedError`
 * from `errors.js`, as `security-plugin.ts` imported them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { isTenantWallDenial } from './security-plugin.js';
import type { PermissionSet, TenancyPosture } from '@objectstack/spec/security';
import { postureUsesUnionScope } from '@objectstack/spec/security';
import { matchesFilterCondition } from '@objectstack/formula';
import { PermissionDeniedError } from './errors.js';

/**
 * Step 3.7's composed wall, as the class declares it: the `WriteTenantWall`
 * interface stays in `security-plugin.ts`, and the moved body names it exactly
 * as it did.
 */
type WriteTenantWall = Awaited<ReturnType<SecurityPlugin['composeWriteTenantWall']>>;

/**
 * One refusal of the wall, as the class declares it: the `WriteWallRefusal`
 * interface stays in `security-plugin.ts`, and the moved body names it exactly
 * as it did.
 */
type WriteWallRefusal = NonNullable<WriteTenantWall['preTest']>;

/**
 * The preview's verdict on one row, as the class declares it: the
 * `WriteWallRowVerdict` type stays in `security-plugin.ts`, and the moved body
 * names it exactly as it did.
 */
type WriteWallRowVerdict = NonNullable<Awaited<ReturnType<SecurityPlugin['writeWallVerdict']>>>[number];

/**
 * [ADR-0123 D2] Does this execution context carry ANY organization scope the
 * tenant wall could enforce with?
 *
 * The answer is posture-shaped, and that is the whole reason this is a function
 * rather than an `if (!ctx.tenantId)` at the call site: under `isolated` the
 * scope is the ACTIVE organization (`tenantId`), under `group` it is the
 * caller's MEMBERSHIP SET (`accessible_org_ids`) and the active organization no
 * longer bounds anything (ADR-0105 D2). Asking only about `tenantId` would
 * refuse every `group` caller who is legitimately scoped by membership; asking
 * only about the set would let an `isolated` caller through on a set the
 * `isolated` wall never reads.
 *
 * This is a cheap PRE-TEST, never the verdict. It exists so the common paths —
 * the `single` posture, and any caller who does have an organization — skip the
 * layered RLS compile entirely. The verdict is always
 * {@link isTenantWallDenial} over the Layer 0 filter, which is the one place
 * that knows about platform-admin exemptions, non-tenant objects and phantom
 * anchors.
 *
 * It answers the SCOPE question only. Under a union-scope posture a caller
 * scoped by membership can still lack the organization a NEW row lands in —
 * the active one ({@link carriesActiveOrganization}) — and step 3.7 judges
 * that separately, on the stored image of an insert.
 */
function callerHasOrganizationScope(context: any, posture: TenancyPosture): boolean {
  if (postureUsesUnionScope(posture)) {
    const orgIds = context?.accessible_org_ids;
    return Array.isArray(orgIds) && orgIds.length > 0;
  }
  return carriesActiveOrganization(context);
}

/**
 * [ADR-0105 D5 · ADR-0123 D2] Does this execution context carry an ACTIVE
 * organization (`tenantId`)? In every posture that is where a new row lands:
 * the engine stamps an insert's organization from it. Under `isolated` it is
 * also the whole read scope; under `group` the membership set is the read
 * scope and the active organization stays the write target (ADR-0105 D2).
 */
function carriesActiveOrganization(context: any): boolean {
  const tenantId = context?.tenantId;
  return tenantId != null && tenantId !== '';
}

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. Every field here is a
 * getter on the host; see the module header.
 */
export interface WriteTenantWallHost {
  readonly orgScopingEnabled: SecurityPlugin['orgScopingEnabled'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  composeWriteTenantWall: SecurityPlugin['composeWriteTenantWall'];
  computeWriteTenantCheckFilter: SecurityPlugin['computeWriteTenantCheckFilter'];
  computeWriteTenantWall: SecurityPlugin['computeWriteTenantWall'];
  organizationWallRefusal: SecurityPlugin['organizationWallRefusal'];
  resolveOperationPrincipals: SecurityPlugin['resolveOperationPrincipals'];
}

/** The body of `SecurityPlugin#composeWriteTenantWall`; the method's docblock there is its contract. */
export async function composeWriteTenantWall(
  this: Pick<WriteTenantWallHost, 'computeWriteTenantCheckFilter' | 'computeWriteTenantWall' | 'orgScopingEnabled' | 'organizationWallRefusal' | 'tenancyPosture'>,
  object: string,
  operation: 'insert' | 'update',
  context: any,
  writeRows: readonly Record<string, unknown>[],
  singlePayload: boolean,
  principals: { permissionSets: PermissionSet[]; delegatorSets: PermissionSet[] | null; delegatorContext: any },
  refusal: { positions: unknown; permissionSets: unknown },
): Promise<WriteTenantWall> {
  const { permissionSets, delegatorSets, delegatorContext } = principals;
  const { positions, permissionSets: explicitPermissionSets } = refusal;

  // ── [ADR-0123 D2] NO ACTIVE ORGANIZATION → refuse the write, loudly ──
  //
  // The forge guard below validates SUPPLIED values only, and says so. It
  // is the right shape for what it guards (a payload naming ANOTHER
  // tenant), but it leaves the opposite case wide open: a payload naming
  // NO tenant, written by a caller who HAS no tenant. Nothing downstream
  // fills it either — auto-stamping lives in the enterprise
  // `@objectstack/organizations` runtime and has nothing to stamp when the
  // caller carries no active organization. So the row landed with
  // `organization_id` NULL, and the read wall then hid it from EVERY
  // reader including the author who had just created it: a write that
  // succeeds and a record nobody can reach.
  //
  // Both halves were individually defensible, which is why this sat. The
  // rule that resolves them (ADR-0123 D2, from the #8247 ruling): under an
  // authenticated session with no active organization, tenant-scoped READS
  // resolve to nothing (Layer 0's deny sentinel — unchanged, below in
  // `computeTenantLayer0Filter`) and tenant-scoped WRITES are REFUSED,
  // with a message that NAMES the missing active organization. If a write
  // cannot say which tenant its row belongs to, it does not land.
  //
  // The verdict is DERIVED, never re-derived: `computeWriteTenantCheckFilter`
  // is the same Layer 0 the read side computes, so every exemption stays in
  // one place — a `tenancy.enabled:false` platform-global object, an object
  // with no `organization_id` column, a federated phantom anchor (#7835), a
  // true PLATFORM_ADMIN on a posture-permitting object (ADR-0095 D3), and
  // the whole `single` posture all yield `null` here and are untouched.
  // System / boot writes never reach this line at all (`isSystem`
  // short-circuits the middleware). Under `group`, "no organization scope"
  // means an EMPTY membership set — ADR-0105 D2's own fail-closed rule.
  // A member WITH a membership set but no active organization passes this
  // pre-test and still has nowhere for a NEW row to land; that insert is
  // refused with this same answer on its stored image, below ([#24784]).
  // So is the insert of a platform operator crossing the wall with no
  // active organization: crossing exempts it from this pre-test, not
  // from needing somewhere to land ([#24821]).
  //
  // The cheap posture/context pre-test comes first on purpose: the common
  // deployment is `single` (Layer 0 inert), and the common caller HAS an
  // active organization. Neither pays for the layered compile inside
  // `organizationWallRefusal` — the one verdict `canWriteObject` asks too.
  //
  // Ordered AHEAD of the forge guard deliberately. A caller with no
  // organization scope at all who also supplies a foreign `organization_id`
  // would satisfy both; "you have no active organization" is the actionable
  // half — the supplied value is not the reason the write cannot land.
  // `delete` is deliberately absent: it places no row and decides no
  // tenant, so its target is selected through the Layer 0 ROW wall, which
  // already resolves to nothing (ADR-0123 D2, stated there as a boundary
  // rather than left as an omission).
  //
  // The refusal has ONE spelling, answered from two points: here on the
  // scope pre-test, and on the stored image of a union-scope insert with
  // no active organization (below). Only the operator half differs,
  // because the two say different things about the context.
  const refuseNoActiveOrganization = (refused: 'caller' | 'delegator', developerMessage: string): WriteWallRefusal => {
    const principal = refused === 'delegator' ? 'the delegating principal' : 'this session';
    return {
      field: '_record',
      warning:
        `[Security] Layer 0 tenant wall REFUSED ${operation} '${object}' — ` +
        `${principal} has no active organization to place the record in (ADR-0123 D2, fail-closed)`,
      error: new PermissionDeniedError(
        `[Security] Access denied: '${object}' is scoped to an organization, and ` +
          `${principal} has no active organization — so this ${operation} has no ` +
          `organization to place the record in. Join or select an active organization and retry.`,
        { operation, object, positions, permissionSets: explicitPermissionSets },
        developerMessage,
      ),
    };
  };
  const denied = await this.organizationWallRefusal(
    permissionSets,
    object,
    operation,
    context,
    delegatorSets,
    delegatorContext,
  );
  if (denied) {
    // The whole write is refused here, so nothing below is composed: the
    // parts are never computed for a write the pre-test refuses.
    return {
      preTest: refuseNoActiveOrganization(
        denied,
        `[ADR-0123 D2] Tenant-scoped writes are refused when the execution context carries no active ` +
          `organization: tenancy posture '${this.tenancyPosture}' walls '${object}', and ` +
          `${denied === 'delegator' ? "the delegator's" : "the caller's"} context resolved neither ` +
          `\`tenantId\` nor a non-empty \`accessible_org_ids\`. Reads under this state resolve to nothing; ` +
          `writes are refused rather than landing a row with a NULL organization that no reader — ` +
          `including its own author — could ever see. System contexts and platform operators are unaffected.`,
      ),
      judgePayload: () => null,
      storedImage: null,
    };
  }

  // A row carries an organization to judge only when it NAMES one: an
  // absent or empty value is the auto-stamp's to fill (ADR-0095 D1,
  // "Not touched": judging it would refuse a legitimate insert before
  // the stamp runs). One predicate, read by both halves below.
  const namesOrganization = (r: Record<string, unknown>): boolean =>
    r.organization_id != null && r.organization_id !== '';
  // [#22278] …except on UPDATE, where no stamp runs: a row that SETS the
  // column to `null` or `''` empties the organization of a row that has
  // one, and that is refused wherever the wall applies. Own-property, so
  // an update that never names the column is untouched; an `undefined`
  // value is a column the statement leaves alone, not an emptied one.
  const emptiesOrganization = (r: Record<string, unknown>): boolean =>
    operation === 'update' &&
    Object.prototype.hasOwnProperty.call(r, 'organization_id') &&
    (r.organization_id === null || r.organization_id === '');
  // The wall is computed when a payload names an organization (as
  // before) or when a walled posture may have a hook name one ([#20013]
  // below). The `single` posture composes no Layer 0 at all, so it pays
  // for nothing it did not already pay for.
  let tenantParts: Record<string, unknown>[] = [];
  // The CALLER's own Layer 0 for this write — `null` where the wall does
  // not apply to it (a non-tenant object, a phantom anchor, a platform
  // operator crossing on a posture-permitting object, `single`).
  let callerTenantCheck: Record<string, unknown> | null = null;
  // Whether that `null` is a platform operator CROSSING the wall on a
  // posture-permitting object (ADR-0095 D3) — the wall stands for every
  // other caller on the object.
  let callerCrossesTenantWall = false;
  if (writeRows.some(namesOrganization) || this.orgScopingEnabled) {
    const callerWall = await this.computeWriteTenantWall(
      permissionSets,
      object,
      operation,
      context,
    );
    const tenantCheck = callerWall.layer0;
    callerTenantCheck = tenantCheck;
    callerCrossesTenantWall = callerWall.crossedByPlatformAdmin;
    // [ADR-0090 D10] The post-image must also satisfy the delegator's tenant
    // wall — an on-behalf-of write may not land a row in a tenant the
    // delegator itself could not reach.
    const delTenantCheck = delegatorSets
      ? await this.computeWriteTenantCheckFilter(delegatorSets, object, operation, delegatorContext)
      : null;
    tenantParts = [tenantCheck, delTenantCheck].filter(Boolean) as Record<string, unknown>[];
  }
  const clearsWall = (row: Record<string, unknown>): boolean =>
    tenantParts.every((f) => matchesFilterCondition(row as any, f as any));
  // The ONE refusal, shared by both halves — so a value the caller sent
  // and a value a hook wrote are refused identically.
  const denyTenantPlacement = (source: string): WriteWallRefusal => ({
    field: 'organization_id',
    warning:
      `[Security] Layer 0 tenant CHECK FAILED on ${operation} '${object}' — write denied ` +
      `(fail-closed); ${source} organization_id is outside the caller's organization scope`,
    error: new PermissionDeniedError(
      `[Security] Access denied: the ${operation} would place '${object}' in another tenant ` +
        `(organization_id is outside the caller's organization scope)`,
      { operation, object, positions, permissionSets: explicitPermissionSets },
    ),
  });
  // [#22278] The refusal of an emptied organization, shared by both
  // halves the same way. Its own sentence: the row is not placed in
  // another tenant, it is left in none.
  const denyOrganizationRemoval = (source: string): WriteWallRefusal => ({
    field: 'organization_id',
    warning:
      `[Security] Layer 0 tenant CHECK FAILED on ${operation} '${object}' — write denied ` +
      `(fail-closed); ${source} organization_id is empty`,
    error: new PermissionDeniedError(
      `[Security] Access denied: the ${operation} would leave '${object}' with no organization ` +
        `(an organization-scoped row keeps an organization on update)`,
      { operation, object, positions, permissionSets: explicitPermissionSets },
      `[ADR-0095 D1] tenancy posture '${this.tenancyPosture}' walls '${object}', so a non-system update ` +
        `must leave the row in an organization the Layer 0 wall admits. An empty organization_id is in none: ` +
        `the row would drop out of every reader's scope, and an organization-scoped grant row would apply in ` +
        `every organization. System contexts and platform operators on posture-permitting objects are unaffected.`,
    ),
  });
  // ── [ADR-0123 D2 · ADR-0105 D2/D5 · #24784] A union-scope INSERT with no active organization ──
  //
  // Under a union-scope posture (`group`) the scope pre-test above reads
  // the MEMBERSHIP SET, so a member whose session has no active
  // organization passes it — rightly, for everything the set bounds:
  // reads, and updates and deletes, whose rows the membership wall
  // selected and which keep the organization they already have. An
  // insert is the one write that needs somewhere NEW to land, and that is
  // the ACTIVE organization: the engine stamps a new row from `tenantId`
  // (ADR-0105 D5), and the column is read-only to a session payload. So
  // that member's row had no organization to land in, and the engine met
  // it as an organization-less SYSTEM write and refused it
  // `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` with a 500. ADR-0123 D2's
  // answer for the state is the 403 `isolated` gives the same session;
  // this gives it here, before the engine is reached.
  //
  // Judged on the STORED image (the seam below), not on the payload: the
  // image is the row after the `beforeInsert` chain, the same rows the
  // engine's own organization check reads one step later. So the refusal
  // covers exactly the rows that would have met that 500, and nothing the
  // store admitted before is refused now. Only the CALLER's own wall
  // decides whether the object is walled for it — a platform operator
  // crossing on a posture-permitting object is the arm below — and the
  // delegator keeps the pre-test's leg, unchanged. `isolated` never
  // reaches this: its pre-test reads the active organization itself.
  const insertLacksActiveOrganization =
    operation === 'insert' &&
    postureUsesUnionScope(this.tenancyPosture) &&
    callerTenantCheck != null &&
    !carriesActiveOrganization(context);
  // ── [ADR-0123 D2/D4 · ADR-0131 D9 · ADR-0095 D3 · #24821] …and a platform operator's ──
  //
  // A true `PLATFORM_ADMIN` CROSSES the wall on a posture-permitting
  // object (ADR-0095 D3): its Layer 0 is `null` there, so neither the
  // pre-test nor the arm above reaches it, under `isolated` or `group`.
  // Crossing lets the operator read every organization's rows and update
  // them where they are; it does not give a NEW row an organization. The
  // row lands where the session's does — the engine stamps it from
  // `tenantId` and strips the column from a session payload — and with
  // no active organization it has none. ADR-0131 D9 refuses that write in
  // every walled posture ("nothing defaults to any owner other than the
  // derivable one"), and the engine did refuse it, as an
  // organization-less SYSTEM write: `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`,
  // status 500, its prose withheld from the wire. The condition is the
  // member's — no active organization, a row with nowhere to land — so
  // the answer is the member's too: one refusal, one spelling (ADR-0112
  // D3), naming what is missing (ADR-0123 D4).
  //
  // On the same STORED image as the arm above, for the same reason: a
  // row a hook places, or one that names its organization where the
  // engine keeps a session's value, carries one and lands as before.
  // Reads and updates by the operator are untouched.
  const operatorInsertLacksActiveOrganization =
    operation === 'insert' &&
    callerCrossesTenantWall &&
    !carriesActiveOrganization(context);
  const walled = tenantParts.length > 0;

  return {
    preTest: null,
    judgePayload: (rows) => {
      // EVERY supplied row must clear the wall — one forged row in a bulk
      // payload denies the whole write (fail closed, no partial landing).
      if (walled && !rows.filter(namesOrganization).every(clearsWall)) return denyTenantPlacement('a supplied');
      // [#22278] …and no row of an UPDATE payload may empty the column.
      if (walled && rows.some(emptiesOrganization)) return denyOrganizationRemoval('a supplied');
      return null;
    },
    // [#20013] The seam is installed whenever the wall applies to the write,
    // and [#24821] for a crossing platform operator's insert with no active
    // organization too: its own Layer 0 is `null`, so the parts can be empty
    // while its rows still need somewhere to land. With no wall part
    // `judgeRow` admits every row. Array UPDATE payloads are left as step
    // 3.6 leaves them: the engine takes one payload per update.
    storedImage:
      (walled || operatorInsertLacksActiveOrganization) && (operation === 'insert' || singlePayload)
        ? {
            judgeLanding: (rows) => {
              // First, as the pre-test's refusal is first: the session's
              // state is the actionable half. One row with nowhere to land
              // refuses the whole write — no partial landing.
              const someRowHasNowhereToLand = (): boolean =>
                rows.some((row) => !!row && typeof row === 'object' && !namesOrganization(row));
              if (operatorInsertLacksActiveOrganization && someRowHasNowhereToLand()) {
                return refuseNoActiveOrganization(
                  'caller',
                  `[ADR-0123 D2 · ADR-0131 D9] Tenant-scoped inserts are refused when the execution context carries ` +
                    `no active organization: tenancy posture '${this.tenancyPosture}' walls '${object}', and ` +
                    `this caller is a platform operator crossing the wall there (ADR-0095 D3). Crossing lets it read ` +
                    `every organization's rows and update them where they are; a new row still lands in the active ` +
                    `organization, and the caller's context carries no \`tenantId\` while the stored row names no ` +
                    `organization, so this insert has none to land in. It is refused rather than reaching the engine ` +
                    `as an organization-less system write. System contexts are unaffected.`,
                );
              }
              if (insertLacksActiveOrganization && someRowHasNowhereToLand()) {
                return refuseNoActiveOrganization(
                  'caller',
                  `[ADR-0123 D2] Tenant-scoped writes are refused when the execution context carries no active ` +
                    `organization: tenancy posture '${this.tenancyPosture}' walls '${object}', and the ` +
                    `caller's context carries no \`tenantId\`. Under this posture the membership set ` +
                    `(\`accessible_org_ids\`) bounds what the caller reads, while a new row lands in the active ` +
                    `organization (ADR-0105 D5), so this insert has none to land in. Reads under this state keep ` +
                    `spanning the membership set; the insert is refused rather than reaching the engine as an ` +
                    `organization-less system write. System contexts and platform operators are unaffected.`,
                );
              }
              return null;
            },
            judgeRow: (row) => {
              if (namesOrganization(row) && !clearsWall(row)) return denyTenantPlacement("the stored row's");
              if (emptiesOrganization(row)) return denyOrganizationRemoval("the stored row's");
              return null;
            },
            // ── [#24822 · ADR-0105 D5] The write's organization is JUDGED here ──
            //
            // `judgeRow` holds a stored row's `organization_id` to the wall
            // whenever the wall has parts, and the payload half above already
            // refused every supplied value outside them (and, on an update,
            // every emptied one). So the engine may leave a caller's explicit
            // value on the row for this verdict instead of stripping it as
            // `readonly`: on an insert, rather than storing the active
            // organization in its place; on an update, rather than keeping the
            // row's own organization against a re-point the wall admitted.
            // Both replacements were silent: a 2xx, with the row in another
            // organization than the one the wall admitted. The member says so,
            // and the engine reads nothing else.
            //
            // Set ONLY where the wall's own parts are composed in (`tenantParts`
            // non-empty). The crossing operator's seam
            // (`operatorInsertLacksActiveOrganization` with no parts) judges no
            // organization: its `judgeRow` admits every row. The business
            // `check` seam of step 3.6 never reaches this composition. Neither
            // sets it, so the strip there runs as before.
            //
            // And only on the two operations whose stored rows this seam is
            // handed: an insert (its rows), and an update whose payload is ONE
            // row (the by-id image, and every row the predicate path matched,
            // each merged with that payload). An ARRAY update payload never
            // reaches this composition (the condition above), so it is stated
            // again here rather than inferred: the member is the seam's own
            // claim about what it judges, and it must stay true if that
            // condition ever moves. [#25062] The write preview reads this
            // same value for each row it admits, and spares the column where
            // the write does.
            judgesOrganization:
              walled && (operation === 'insert' || (operation === 'update' && singlePayload)),
          }
        : null,
  };
}

/** The body of `SecurityPlugin#organizationWallRefusal`; the method's docblock there is its contract. */
export async function organizationWallRefusal(
  this: Pick<WriteTenantWallHost, 'computeWriteTenantCheckFilter' | 'orgScopingEnabled' | 'tenancyPosture'>,
  permissionSets: PermissionSet[],
  object: string,
  operation: string,
  context: any,
  delegatorSets: PermissionSet[] | null,
  delegatorContext: any,
): Promise<'caller' | 'delegator' | null> {
  if (!this.orgScopingEnabled || callerHasOrganizationScope(context, this.tenancyPosture)) return null;
  const callerWall = await this.computeWriteTenantCheckFilter(permissionSets, object, operation, context);
  // [ADR-0090 D10] The delegator is walled on its own context, exactly as
  // the forge guard walls it — an on-behalf-of write may not land a row
  // the delegator itself could not place.
  const delegatorWall =
    delegatorSets && !callerHasOrganizationScope(delegatorContext, this.tenancyPosture)
      ? await this.computeWriteTenantCheckFilter(delegatorSets, object, operation, delegatorContext)
      : null;
  return isTenantWallDenial(callerWall)
    ? 'caller'
    : isTenantWallDenial(delegatorWall)
      ? 'delegator'
      : null;
}

/** The body of `SecurityPlugin#writeWallVerdict`; the method's docblock there is its contract. */
export async function writeWallVerdict(
  this: Pick<WriteTenantWallHost, 'composeWriteTenantWall' | 'resolveOperationPrincipals'>,
  object: string,
  operation: 'insert' | 'update',
  context: any,
  rows: readonly Record<string, unknown>[],
): Promise<WriteWallRowVerdict[] | null> {
  if (!context || typeof context !== 'object' || context.isSystem || !context.userId) return null;
  if (operation !== 'insert' && operation !== 'update') return null;
  let principals: Awaited<ReturnType<SecurityPlugin['resolveOperationPrincipals']>>;
  try {
    principals = await this.resolveOperationPrincipals(operation, object, context);
  } catch {
    return null;
  }
  const isRow = (row: unknown): row is Record<string, unknown> =>
    !!row && typeof row === 'object' && !Array.isArray(row);
  const wall = await this.composeWriteTenantWall(
    object,
    operation,
    context,
    rows.filter(isRow),
    true,
    principals,
    { positions: context.positions ?? [], permissionSets: context.permissions ?? [] },
  );
  return rows.map((row): WriteWallRowVerdict => {
    if (!isRow(row)) return { admitted: true, judgesOrganization: false };
    const refused = wall.preTest ?? wall.judgePayload([row]) ?? wall.storedImage?.judgeLanding([row]) ?? null;
    return refused
      ? { admitted: false, field: refused.field, code: refused.error.code, message: refused.error.message }
      : { admitted: true, judgesOrganization: wall.storedImage?.judgesOrganization === true };
  });
}
