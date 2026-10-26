// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 15] The organization plugin's factory — the arrow
 * `buildPluginList` hands `addOptionalPlugin` for `organization`, which loads
 * better-auth's `organization` plugin and builds it with this deployment's
 * options — moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of that arrow, as it
 * stood, re-indented two levels and otherwise unedited: the same closed
 * organization-role vocabulary and the roles map built from it, stored on the
 * manager for the guards that read it back; the same options object, with the
 * same schema, teams, invitation verification declaration, organization limit
 * and membership limit; the same organization hooks (creation, invitation,
 * acceptance, slug change and deletion) with their refusal codes; the same
 * invitation e-mail; and the same rebuilt invitation listing, with its warning
 * when the vendor no longer exposes it — in the same order.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which the fourteen `auth-manager-*.ts`
 * modules split out before this one follow, applied to a closure as
 * `auth-manager-after-hook.ts` applies it. `buildPluginList` keeps its place,
 * its docblock and its signature, and the `organization` call to
 * `addOptionalPlugin` keeps its place in it: the arrow there is now one
 * literal of exactly the {@link OrganizationPluginHost} members the body
 * reads, plus a `.call`. The `async` moved from that arrow to the function
 * below, and the arrow returns the function's own promise, so
 * `addOptionalPlugin` awaits the same promise the body settles, with no extra
 * wrapper.
 *
 * The body's `this` was the manager, the arrow's lexical receiver; it is now
 * that host. Every member it reads but two is a method, and each goes as a
 * closure that calls it on the manager at call time, so a test double or spy
 * set on the manager is still the one the body reaches, including from the
 * organization hooks and the invitation e-mail, which better-auth runs long
 * after the function returns. `config` goes as a GETTER, because the class
 * reassigns it after construction (`setRuntimeBaseUrl` and
 * `applyConfigPatch`), so the body reads the manager's current one.
 * `orgRolesMap` goes as a get/set pair, because the body stores the roles map
 * it builds on the manager, where the actor guards read it back: the field
 * stays the one the manager holds. The arrow builds the host each time
 * `addOptionalPlugin` runs the factory, as every method stub in this series
 * does, so nothing the body reads is captured early. The arrow read no local
 * of `buildPluginList`, so the function takes no parameter, as the arrow took
 * none.
 *
 * The body reads nine top-level declarations of `auth-manager.ts`: the five
 * organization hook refusal codes, the slug guard's and the invitation
 * placement check's read-fault answers, the placement gate's refusal test,
 * and `readInvitationPlacementIntent`. That file exports them and this module
 * imports them by VALUE, for reads inside the function, when the plugin is
 * built or a hook runs. `index.ts` lists `auth-manager.ts`'s published names
 * one by one, so those exports are not published. The two modules import each
 * other, and that is safe because nothing reads the bindings while they are
 * first evaluated: this module's top level is imports, an interface and a
 * function declaration.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { OrganizationOptions } from 'better-auth/plugins/organization';
import { isCloudManaged } from '@objectstack/core';
import { MEMBERSHIP_ROLE_DELEGATED_ADMIN, MEMBERSHIP_ROLE_EXTERNAL } from '@objectstack/spec';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { resolveOrgLimit, resolveTenancyPosture } from '@objectstack/types';
import {
  INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE_CODE,
  INVITE_PLACEMENT_UNSUPPORTED_CODE,
  ORGANIZATION_CREATION_DISABLED_CODE,
  ORGANIZATION_RESERVED_IDENTIFIER_CODE,
  ORGANIZATION_SLUG_LOCKED_CODE,
  invitationPlacementReadFaultApiError,
  isInvitationPlacementGateRefusal,
  readInvitationPlacementIntent,
  slugGuardReadFaultApiError,
  type AuthManager,
} from './auth-manager.js';
import { buildOrganizationPluginSchema } from './auth-schema-config.js';
import { CLOUD_MANAGED_REFUSAL_CODE, CLOUD_MANAGED_REFUSAL_MESSAGES } from './cloud-managed.js';
import { invitationRoleCapFailure, isPlainMemberInvitation } from './invitation-role-cap.js';
import { invitationRoleLabel } from './invitation-role-label.js';
import { applyDeclaredInvitationVerificationToListing } from './list-user-invitations-verification.js';
import { resolveMembershipLimitOption } from './membership-limit.js';
import { withSystemContext, withSystemReadContext } from './objectql-adapter.js';
import { isDefaultOrganizationTarget, removeOrganizationAuthStructure } from './organization-delete.js';
import { isPlaceholderEmail } from './placeholder-email.js';

/**
 * The `AuthManager` members the function below reads — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too, and naming a member the class does not have is a compile error.
 * `config` is read-only here: the host hands it out through a getter.
 * `orgRolesMap` is the one member the body writes: the host carries it as a
 * get/set pair over the manager's own field (see the module header).
 */
export interface OrganizationPluginHost {
  readonly config: AuthManager['config'];
  emailLocaleArg: AuthManager['emailLocaleArg'];
  getAppName: AuthManager['getAppName'];
  getConsolePageUrl: AuthManager['getConsolePageUrl'];
  getDataEngine: AuthManager['getDataEngine'];
  getEmailService: AuthManager['getEmailService'];
  multiOrgPostureEffective: AuthManager['multiOrgPostureEffective'];
  orgRolesMap: AuthManager['orgRolesMap'];
  resolveMembershipRole: AuthManager['resolveMembershipRole'];
  storedRecipientLocale: AuthManager['storedRecipientLocale'];
}

/** The body of `buildPluginList`'s `organization` factory arrow; the comments there and in it are its contract. */
export async function buildOrganizationPlugin(this: OrganizationPluginHost) {
  const { organization } = await import('better-auth/plugins/organization');
  // [ADR-0108 / #3723] The org-role vocabulary is CLOSED — better-auth's
  // own `owner`/`admin`/`member` plus `delegated_admin`. App-declared
  // `position` / `permission` names are NOT registered here.
  //
  // They were, until this change: an app role registered with better-auth
  // became storable in `sys_member.role`, and every value in that column is
  // projected into `current_user.positions` by `resolve-authz-context`. So
  // the membership role was a capability channel carrying none of ADR-0090
  // D12's controls — no `granted_by`, no validity window, no subtree or
  // allowlist check — which is exactly what ADR-0057 D4 ("never as the
  // authority for RBAC") and ADR-0090 D3's word ban forbid. An app that
  // wants `sales_rep` declares a POSITION; the one-step admission flow is
  // an invitation carrying placement (ADR-0105 D8), which is governed and
  // reaches further (a delegated admin may use it; this never could).
  //
  // [ADR-0105 D8 / #3697] The map registers `delegated_admin` — the one
  // role that may reach `/organization/invite-member` without being an org
  // admin. Without it D8's scope-bounded issuance gate has no caller:
  // better-auth grants `invitation:["create"]` to owner/admin only, and
  // under a wall-enforcing posture those two are auto-elevated to tenant
  // admins, for whom the gate short-circuits and narrows nothing.
  //
  // Deliberately `create` WITHOUT `cancel`: better-auth's cancel route
  // (`crud-invites.mjs`) checks only `invitation:["cancel"]` — no inviterId
  // attribution — so the permission would mean "cancel anyone's pending
  // invitation in the org". Attributed cancel needs its own guard first.
  let customOrgRoles: Record<string, any> | undefined;
  try {
    const accessMod = await import('better-auth/plugins/organization/access');
    const { defaultAc, memberAc, defaultRoles } = accessMod as any;
    // Better-Auth's `hasPermission` does `{...options.roles || defaultRoles}`
    // (precedence: `||` then spread). When we pass our own `roles`, the
    // built-in owner/admin/member are silently dropped, so even the org
    // owner loses `invitation:create` and every mutation 403s. We must
    // re-include the defaults alongside `delegated_admin` — and if the
    // library ever stops exporting them, build NOTHING and let better-auth
    // fall back to its own defaults rather than ship a map missing `owner`.
    if (defaultAc && memberAc && defaultRoles && typeof memberAc.statements === 'object') {
      const built: Record<string, any> = { ...defaultRoles };
      const stmts = memberAc.statements;
      built[MEMBERSHIP_ROLE_DELEGATED_ADMIN] = defaultAc.newRole({
        ...stmts,
        invitation: ['create'],
      });
      // [Ruling 6355206139] `external` — a portal user inside the
      // organization: no organization, member, invitation, team or
      // access-control statement at all. It confers less than `member`,
      // which is why any issuer may invite to it (E3).
      built[MEMBERSHIP_ROLE_EXTERNAL] = defaultAc.newRole(
        Object.fromEntries(Object.keys(stmts).map((resource) => [resource, []])),
      );
      customOrgRoles = built;
    }
  } catch {
    customOrgRoles = undefined;
  }
  // [#8289] Same map, same request lifetime — see the field's doc for why
  // the before-hook cannot read it back off `ctx`.
  this.orgRolesMap = customOrgRoles;
  // [#16569] Held as a named object rather than an inline literal: the
  // rebuilt `/organization/list-user-invitations` endpoint below needs the
  // VERY object the vendor plugin was constructed with — it is what the
  // vendor's own `getOrgAdapter(ctx.context, options)` reads, and the
  // declaration it honours lives on it.
  const organizationOptions = {
    schema: buildOrganizationPluginSchema(),
    // Enable the team sub-feature so the framework's `sys_team` /
    // `sys_team_member` tables (already declared in platform-objects)
    // are actually wired up to better-auth's CRUD endpoints
    // (`/organization/{create,update,remove,list}-team[s]` and
    // `/organization/{add,remove,list}-team-member[s]`). The Account
    // portal exposes a Teams page; without this flag those endpoints
    // 404 and the section silently breaks.
    teams: { enabled: true },
    // Without a mailer wired in framework, requiring email verification
    // before accepting invitations dead-ends every invite flow with
    // FORBIDDEN EMAIL_VERIFICATION_REQUIRED…. Default-off here keeps
    // the built-in /accept-invitation route usable for pilots; operators
    // who wire a real mailer can re-enable downstream.
    requireEmailVerificationOnInvitation: false,
    // Cap how many orgs a user can CREATE (OS_ORG_LIMIT). Counts only orgs
    // the user OWNS (role=owner) — never orgs they were merely invited into —
    // so a generous cap stops scripted org/free-env spam (each new org can
    // auto-provision a free environment on the cloud control plane) WITHOUT
    // ever blocking a collaborator who belongs to many orgs. Unset → no
    // limit (self-host default). Fail-open: if the count can't be taken we
    // allow creation rather than block a legitimate user on an infra hiccup.
    organizationLimit: async (user: { id?: string }) => {
      const limit = resolveOrgLimit();
      if (limit == null) return false;
      const engine = this.config.dataEngine;
      const uid = typeof user?.id === 'string' ? user.id : '';
      if (!engine || !uid) return false;
      try {
        // `sys_member` is tenant-scoped (organization_id). We need to count
        // the user's owned orgs ACROSS tenants, so read with the system
        // context (isSystem) to bypass org-scoping — otherwise the query
        // returns nothing and the limit never fires.
        const owned = await withSystemReadContext(engine).count('sys_member', {
          where: { user_id: uid, role: 'owner' },
        });
        return (owned ?? 0) >= limit;
      } catch {
        return false;
      }
    },
    // How many MEMBERS one organization may hold — a different question
    // from `organizationLimit` above, and one this platform does not limit:
    // entitlements meter AI seats, and plain membership is not a billed
    // axis. It must still be stated, because better-auth substitutes a
    // vendor default of 100 for an absent `membershipLimit`
    // (`count >= (membershipLimit || 100)`), which reaches the operator as
    // `Organization membership limit reached` — a refusal nobody here ever
    // chose, on an axis nothing here bills. A deployment that DOES want a
    // ceiling sets `OS_ORG_MEMBERSHIP_LIMIT`.
    //
    // MAX_SAFE_INTEGER rather than Infinity: the value is compared, but it
    // also travels through option plumbing that may assume a finite number,
    // and nine quadrillion members is unlimited by any measure that matters.
    membershipLimit: resolveMembershipLimitOption(),
    ...(customOrgRoles ? { roles: customOrgRoles } : {}),
    // ── Slug-change guard ─────────────────────────────────────
    // An org's slug is baked into every env hostname at creation
    // time (see service-tenant `project-provisioning.ts`). Renaming
    // it while live envs exist would silently desync the URL from
    // the org identity. Block the change here; the cloud Console
    // surfaces this as an actionable error and points users to
    // `change_hostname` or archiving the env. Org `name` (display
    // label) is unaffected — only `slug` is guarded.
    //
    // We resolve the data engine lazily so non-cloud apps (which
    // never seed `sys_environment`) keep working: any lookup error
    // is treated as "no envs to protect".
    organizationHooks: {
      // Gate fresh organization creation behind the deployment's TENANCY
      // POSTURE. The plugin itself is always installed (so list/update/invite
      // endpoints keep responding); only the `create` operation is denied,
      // and only where no organization wall is enforced — creating an
      // organization there would mint a boundary nothing keeps (ADR-0049 at
      // the deployment layer).
      //
      // [#5233] The judge is the tenancy POSTURE, never the
      // `OS_MULTI_ORG_ENABLED` boolean ADR-0105 D1 demoted — that one reads
      // `false` on a deployment configured with only the authoritative
      // `OS_TENANCY_POSTURE=isolated`, so the whole organization wall
      // mounted and every org-less user's guided "create your workspace"
      // path still 403'd. Same defect shape as cloud#1020.
      //
      // [#5261] And the judge is the EFFECTIVE posture
      // (`multiOrgPostureEffective()` — the `tenancy` service's answer),
      // not the requested one, so this gate and `/auth/config`'s
      // `features.multiOrgEnabled` are literally the same derivation. On the
      // ADR-0093 D5 degraded shape they used to disagree: the console hid
      // the button while the route minted organizations no engine walls.
      beforeCreateOrganization: async ({ organization }: any = {}) => {
        // [ADR-0120 D3] `'__global__'` is the platform's name for the
        // NULL-organization bucket: the autonumber sequence table keys
        // org-less rows by it, and every organization-scoped unique index
        // folds NULL into it via `COALESCE(organization_id, '__global__')`.
        // An organization minted with that token as its id (or slug — the
        // only caller-controllable identifier here) would collide with the
        // platform bucket, so the token is reserved at this seam.
        if (organization?.id === '__global__' || organization?.slug === '__global__') {
          const { APIError } = await import('better-auth/api');
          throw new APIError('BAD_REQUEST', {
            message:
              "'__global__' is reserved for the platform (no-organization) bucket " +
              '(ADR-0120 D3) and cannot be used as an organization id or slug.',
            code: ORGANIZATION_RESERVED_IDENTIFIER_CODE,
          });
        }
        if (!this.multiOrgPostureEffective()) {
          const { APIError } = await import('better-auth/api');
          throw new APIError('FORBIDDEN', {
            message:
              'Creating additional organizations is disabled on this deployment.',
            code: ORGANIZATION_CREATION_DISABLED_CODE,
          });
        }
      },
      // Run host-provided org-creation side effects (e.g. the cloud control
      // plane provisions the org's born-with production environment). The
      // org-plugin's models don't fire core databaseHooks, so this is the
      // only server-side seam for "every org is born with its prod env".
      // Failure-isolated: org creation must not roll back on a side-effect miss.
      afterCreateOrganization: async ({ organization, member, user }: any) => {
        const cb = this.config.onOrganizationCreated;
        if (typeof cb !== 'function') return;
        try {
          await cb({
            organizationId: organization?.id,
            userId: user?.id ?? member?.userId,
            name: organization?.name,
            slug: organization?.slug,
          });
        } catch (err: any) {
          console.warn('[auth] onOrganizationCreated callback failed:', err?.message ?? String(err));
        }
      },
      // [ADR-0105 D8] Issuance gate. A placement intent on an invitation
      // is a REQUEST; the authority to honour it is the ISSUER's
      // `adminScope` (ADR-0090 D12), judged HERE — at issuance, while the
      // actor is the inviter — not at acceptance, when the actor is the
      // invitee. Rejecting throws out of the endpoint, so no invitation
      // row is created.
      //
      // Fail closed on a missing service: without plugin-security there
      // is no gate, and honouring an unchecked placement would hand
      // `organization_admin` the RBAC-write authority it is deliberately
      // denied (auto-org-admin-grant.ts keeps it read-only on those
      // tables precisely so a fresh org admin cannot rebind themselves).
      beforeCreateInvitation: async ({ invitation, inviter, organization }: any) => {
        // [#25083] A cloud-managed environment creates no invitation at
        // all: the organisation that hosts it invites its people in the
        // cloud. The `before` hook refuses `/organization/invite-member`
        // first, resends included; this arm is the second line, for any
        // other path that reaches the hook. First here, before the role
        // cap and the placement gate, because no invitation is issuable
        // whatever its role or placement.
        if (isCloudManaged()) {
          const { APIError } = await import('better-auth/api');
          throw new APIError('CONFLICT', {
            message: CLOUD_MANAGED_REFUSAL_MESSAGES.invitation,
            code: CLOUD_MANAGED_REFUSAL_CODE,
          });
        }
        const inviterUserId = inviter?.id ?? inviter?.userId ?? null;
        const organizationId = organization?.id ?? invitation?.organizationId;

        // [#3697] Role cap — FIRST, and for EVERY invitation, placement or
        // not: the escalation it closes (invite an `admin`, acceptance
        // auto-elevates to `organization_admin` → tenant admin) needs no
        // placement intent at all. Skipped for a plain `member` invitation,
        // which can never trip the cap — so the ordinary path pays nothing.
        if (!isPlainMemberInvitation(invitation?.role)) {
          // [#23945] Each refusal carries its ADR-0112 code beside its
          // message, the way better-auth's own `owner` refusal on this
          // endpoint does. A membership read that THROWS never reaches
          // this verdict: `resolveMembershipRole` answers it as an outage
          // (503 `SERVICE_UNAVAILABLE`), not as a refusal.
          const refusal = invitationRoleCapFailure(
            invitation?.role,
            await this.resolveMembershipRole(inviterUserId, organizationId),
          );
          if (refusal) {
            const { APIError } = await import('better-auth/api');
            throw new APIError('FORBIDDEN', { message: refusal.message, code: refusal.code });
          }
        }

        const intent = readInvitationPlacementIntent(invitation);
        if (!intent) return;

        const svc = await this.config.invitationPlacement?.().catch(() => undefined);
        if (!svc) {
          const { APIError } = await import('better-auth/api');
          throw new APIError('FORBIDDEN', {
            message:
              'Invitation placement (business unit + positions) requires the delegated-administration runtime; this deployment cannot authorize it.',
            code: INVITE_PLACEMENT_UNSUPPORTED_CODE,
          });
        }

        try {
          await svc.assertIssuable({
            intent,
            // WHO is issuing — not a context. The service resolves this
            // user's real grants through the shared authz resolver; a
            // hand-built context here would carry no positions and refuse
            // every delegate.
            actorUserId: inviterUserId,
            organizationId,
          });
        } catch (err: any) {
          // [#24243] Only the gate's own refusal is a scope verdict. A throw
          // that is not one (the issuer's grants could not be read) reached
          // no verdict, so it answers 503 with its code rather than wearing
          // the refusal's 403, its code and a driver's message.
          if (!isInvitationPlacementGateRefusal(err)) {
            throw await invitationPlacementReadFaultApiError(err);
          }
          const { APIError } = await import('better-auth/api');
          throw new APIError('FORBIDDEN', {
            message: err?.message ?? 'Invitation placement is outside your delegated administration scope.',
            code: INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE_CODE,
          });
        }
      },
      // [ADR-0105 D8] Accept-time application + host seam. The placement
      // the issuance gate approved lands WITH the better-auth membership,
      // so the invitee arrives already in the right unit and role. The
      // apply is idempotent (a replayed acceptance converges) and
      // failure-isolated — a placement miss must not undo a valid
      // membership; the host seam still fires either way.
      afterAcceptInvitation: async ({ invitation, member, user, organization }: any) => {
        const intent = readInvitationPlacementIntent(invitation);
        if (intent) {
          try {
            const svc = await this.config.invitationPlacement?.();
            if (svc) {
              await svc.apply({
                intent,
                userId: String(user?.id ?? member?.userId),
                organizationId: organization?.id ?? invitation?.organizationId ?? member?.organizationId,
                grantedBy: invitation?.inviterId ?? invitation?.inviter_id ?? null,
              });
            }
          } catch (err: any) {
            console.warn(
              '[auth] invitation placement failed (membership kept):',
              err?.message ?? String(err),
            );
          }
        }

        const cb = this.config.onInvitationAccepted;
        if (typeof cb !== 'function') return;
        try {
          await cb({
            invitationId: invitation?.id,
            organizationId: organization?.id ?? invitation?.organizationId ?? member?.organizationId,
            userId: user?.id ?? member?.userId,
            memberId: member?.id,
            role: member?.role ?? invitation?.role,
            email: invitation?.email,
            invitation,
            member,
          });
        } catch (err: any) {
          console.warn('[auth] onInvitationAccepted callback failed:', err?.message ?? String(err));
        }
      },
      beforeUpdateOrganization: async ({ organization, member }: any) => {
        const newSlug = organization?.slug;
        const orgId = member?.organizationId;
        if (!newSlug || !orgId) return;

        // [#21941] The guard reads only what this composition registers,
        // and FAILS CLOSED when a registered read cannot answer.
        //
        //  - NO DATA ENGINE ⇒ the guard does not apply. Only a standalone
        //    `AuthManager` lacks one (`AuthPlugin` declares ObjectQL a hard
        //    dependency), and it then runs on better-auth's in-memory store:
        //    no engine registers `sys_environment`, so no environment can
        //    reference the organization.
        //  - `sys_environment` NOT REGISTERED ⇒ the guard does not apply,
        //    for the same reason, and nothing is read. It is a cloud-provided
        //    object (`CLOUD_PROVIDED_OBJECT_NAMES`), so this is the
        //    open-source composition's answer. The question is the
        //    registry's own (`getSchema`), never a caught throw; an engine
        //    that cannot be asked reads as before — it is asked, and a fault
        //    refuses.
        //  - A REGISTERED READ THAT THROWS ⇒ refused, `503
        //    SERVICE_UNAVAILABLE` (`slugGuardReadFaultApiError`). It used to
        //    end the hook without refusing, which let the slug change through
        //    whenever either read faulted.
        const rawEngine = this.config.dataEngine;
        if (!rawEngine) return;
        const schemaOf = (rawEngine as { getSchema?: (object: string) => unknown }).getSchema;
        if (typeof schemaOf === 'function' && !schemaOf.call(rawEngine, 'sys_environment')) return;

        // Both reads run as the platform (`withSystemContext`): this hook
        // IS the slug guard — the organization id is the `where`, not the
        // reader — so neither read reaches the engine with no principal
        // and no opt-in (the security middleware's former principal-less
        // hand-off, which ADR-0096 D5 replaced with a refusal).
        const dataEngine = withSystemContext(rawEngine) as any;

        let currentSlug: string | undefined;
        try {
          const current = await dataEngine.findOne('sys_organization', {
            where: { id: orgId },
          });
          currentSlug = current?.slug;
        } catch (err) {
          throw await slugGuardReadFaultApiError('sys_organization', err);
        }
        if (!currentSlug || currentSlug === newSlug) return;

        let activeEnvs = 0;
        try {
          const envs = await dataEngine.find('sys_environment', {
            where: { organization_id: orgId },
          });
          activeEnvs = (envs ?? []).filter(
            (e: any) => e?.status !== 'archived' && e?.status !== 'failed',
          ).length;
        } catch (err) {
          throw await slugGuardReadFaultApiError('sys_environment', err);
        }

        if (activeEnvs > 0) {
          const { APIError } = await import('better-auth/api');
          // [#24243] The message states only what the guard read: environment
          // rows by `organization_id`, counted by `status`. No hostname is
          // read, so none is named as a remedy.
          throw new APIError('FORBIDDEN', {
            message:
              `Cannot change the organization slug while the organization has ${activeEnvs} ` +
              `active environment(s), meaning any environment that is neither archived nor ` +
              `failed. Archive those environments first, or keep the current slug.`,
            code: ORGANIZATION_SLUG_LOCKED_CODE,
          });
        }
      },
      // [#24948] The teams, their members and the organization-admin
      // grants are the organization's own auth structure, and better-auth's
      // delete leaves them behind. They go here, inside the request's
      // transaction (`handleRequest`), after the `hooks.before` refusal has
      // found no records left. The Default Organization is the
      // last-administrator guard's to answer, so its structure is not
      // touched: when that guard admits the delete, the engine's own
      // refusal still holds while anything names it.
      beforeDeleteOrganization: async ({ organization }: any) => {
        const engine = this.getDataEngine();
        const organizationId = organization?.id;
        if (!engine || typeof organizationId !== 'string' || !organizationId) return;
        if (await isDefaultOrganizationTarget(engine, organization, postureEnforcesWall(resolveTenancyPosture()))) return;
        await removeOrganizationAuthStructure(engine, organizationId);
      },
    },
    // No mailer is wired in framework yet — log the accept URL so
    // operators / UI can fall back to copy-paste flows. Replace this
    // with a real mail integration when available.
    sendInvitationEmail: async ({ email: recipientEmail, invitation, organization: org, inviter }) => {
      // The accept-invitation page is a Console SPA route; the Console
      // builds the very same link for its "copy invitation link" action
      // (`${origin}${BASE_URL}accept-invitation/<id>`). Compose it through
      // the single-source helper so the `/_console` prefix and absolute
      // https origin are guaranteed.
      const acceptUrl = this.getConsolePageUrl(`/accept-invitation/${invitation.id}`);
      // #2766 V1.5 — placeholder addresses are never real recipients.
      if (isPlaceholderEmail(recipientEmail)) {
        throw new Error(
          `Invitation email refused: ${recipientEmail} is a placeholder address (PLACEHOLDER_EMAIL).`,
        );
      }
      const emailService = this.getEmailService();
      if (!emailService) {
        // #2766 — the accept URL is a bearer credential; only print it in
        // dev, never in production logs.
        const dev = (globalThis as any)?.process?.env?.NODE_ENV !== 'production';
        console.warn(
          `[AuthManager] Invitation email not configured. ` +
          `To: ${recipientEmail} (org: ${org?.name ?? invitation.organizationId}, ` +
          `role: ${invitation.role}, inviter: ${inviter?.user?.email ?? 'unknown'})` +
          (dev ? ` URL: ${acceptUrl}` : ' (accept URL suppressed outside dev)'),
        );
        return;
      }
      // #14641 — the invitee's OWN stored language, when the address
      // already carries a `sys_user` row. Two branches, and the split is
      // the whole point:
      //
      //  1. the address HAS a row — an existing platform user invited into
      //     a second organization, or a re-invitation (better-auth's
      //     `create-invitation` refuses only an address that is already a
      //     member of THIS org, measured in the installed 1.7.x
      //     `routes/crud-invites.mjs`, so an existing account being invited
      //     elsewhere reaches this callback normally). Their column is a
      //     language they chose for themselves — the same authority the
      //     reset / verification sends read since commit 35e94c96b.
      //  2. NO row — a genuinely new invitee. Their language is still truly
      //     unknown at invitation time, so the deployment default stands,
      //     exactly as before.
      //
      // Matched EXACTLY on the address, which is safe here rather than
      // merely tolerable: better-auth lowercases the invitee address on the
      // invite route (`crud-invites.mjs` — both the create and the resend
      // branch) and lowercases the stored `user.email` on sign-up
      // (`api/routes/sign-up.mjs`), so both sides of this predicate are
      // already in the same case. A spelling that resolves no row lands on
      // the deployment default, which is the documented floor rather than a
      // failure.
      const storedLocale = await this.storedRecipientLocale({ email: recipientEmail });
      // #14319 — DELIBERATELY no request argument, and the only one of
      // the five sends without one. better-auth DOES hand this callback
      // a `ctx.request`, but it is the INVITER's: stamping their
      // browser language onto the invitee's mail would recreate this
      // very card one seat over. The 2026-09-02 ruling enumerates
      // signup, sign-in and password reset — sends where the requester
      // IS the recipient — and the superseded 2026-08-13 ruling named
      // invitations as its own counterexample. #13881's ruling item 3
      // fixes the chain as RECIPIENT locale → deployment default, so
      // the inviter direction stays rejected: what #14641 added above
      // is the invitee's own column, never the inviter's header.
      const mailLocale = this.emailLocaleArg(undefined, storedLocale);
      // #24154 — `{{role}}` names the membership role by its option LABEL
      // in the mail's own locale (`成员`, not `member`): every body of the
      // template interpolates this one value, so the zh-CN mail stops
      // printing the stored enum inside a Chinese sentence. Never throws;
      // a value with no label is named as stored, with one warn.
      const roleLabel = await invitationRoleLabel(invitation.role || '', mailLocale.locale, {
        getI18n: this.config.getI18n,
        warn: (msg, meta) =>
          this.config.logger ? this.config.logger.warn(msg, meta) : console.warn(msg, meta),
      });
      const expiry = invitationExpiryArg(invitation.expiresAt);
      if (expiry.expiresAt === undefined) {
        const msg =
          `[AuthManager] invitation mail: invitation '${invitation.id}' carries no readable expiry, ` +
          'so the auth.invitation mail (which states when it expires) will be refused and not sent; ' +
          'resend the invitation once its expiry is set';
        const meta = { invitationId: invitation.id, expiresAt: String(invitation.expiresAt) };
        if (this.config.logger) this.config.logger.warn(msg, meta);
        else console.warn(msg, meta);
      }
      try {
        await emailService.sendTemplate({
          template: 'auth.invitation',
          to: recipientEmail,
          ...mailLocale,
          data: {
            inviter: {
              name: inviter?.user?.name ?? inviter?.user?.email ?? 'A teammate',
              email: inviter?.user?.email ?? '',
            },
            organization: { name: org?.name ?? invitation.organizationId },
            role: roleLabel,
            acceptUrl,
            appName: this.getAppName(),
            // When the link stops working (better-auth's window, 48 h by
            // default): every body says so, so an invitation opened late is
            // not a surprise at the accept page. Handed over as an ISO-8601
            // instant; the template's `datetime` formatter renders it in the
            // mail's locale. The template declares it REQUIRED, so an
            // unreadable value is never invented: it is left out, said so
            // once below, and the send is refused (`MISSING_VARIABLES`).
            ...expiry,
          },
          relatedObject: 'sys_invitation',
          relatedId: invitation.id,
          // commit b706af987 — the invitation HOLDS its organization; thread it so
          // the sys_email row is stamped: tenant mail. Mail about a person
          // (reset / verification / magic link) is identity mail instead.
          ...(invitation.organizationId
            ? { organizationId: String(invitation.organizationId) }
            : {}),
        });
      } catch (err: any) {
        // Do NOT rethrow: the invitation row was already persisted by
        // better-auth; an email-transport failure must not turn the
        // invite request into a 500. The admin can resend the invite.
        console.error(`[AuthManager] sendInvitationEmail failed (swallowed): ${err?.message ?? err}`);
      }
    },
  } satisfies OrganizationOptions;
  const organizationPlugin: any = organization(organizationOptions);

  // [#16569] `GET /organization/list-user-invitations` — make the vendor's
  // listing honour the `requireEmailVerificationOnInvitation: false`
  // declared above, the way `accept-invitation`, `reject-invitation` and
  // `get-invitation` already do. better-auth 1.7.2's `listUserInvitations`
  // refuses every unverified session UNCONDITIONALLY (it never reads the
  // option), so on exactly the no-mailer deployment the declaration exists
  // for, an invitee could accept an invitation but never list it and the
  // SDK's `organizations.invitations.listMine()` inbox was empty-by-403.
  // Rebuilt IN PLACE on this plugin's own endpoints record — the same
  // shape as `applyPlatformAdminImpersonation` above, for the same reasons
  // (one owner for the path; every hook keyed on it still fires; the
  // request contract is the vendor's own options object, never a copy).
  // The listing itself stays the vendor's `getOrgAdapter(...)
  // .listUserInvitations(sessionEmail)`: no second definition of which
  // rows a session may see. `list-user-invitations-verification.ts`
  // carries the full reading.
  const listingRewired = await applyDeclaredInvitationVerificationToListing(
    organizationPlugin,
    organizationOptions,
  );
  if (!listingRewired) {
    // The vendor renamed or dropped the endpoint. Say so loudly: the
    // route then falls back to the vendor's own handler, which refuses
    // every unverified session — an empty inbox, not an open door.
    // `warn`, not `error` (AGENTS.md → Degradation log levels): the
    // system is VISIBLY smaller — the inbox answers a 403 the caller sees
    // — and nothing claims a persistence it did not perform.
    console.warn(
      '[AuthManager] better-auth\'s organization plugin no longer exposes a ' +
      '`listUserInvitations` endpoint at /organization/list-user-invitations, ' +
      'so the declared `requireEmailVerificationOnInvitation` could NOT be ' +
      'applied to the invitation inbox. Unverified users will be refused ' +
      '(403 EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION) until ' +
      'list-user-invitations-verification.ts is updated for the new vendor shape.',
    );
  }
  return organizationPlugin;
}

/**
 * The `expiresAt` fragment of the invitation mail's data: the invitation's
 * expiry as an ISO-8601 instant, or nothing when the value does not read as a
 * date. better-auth hands the callback a `Date`; a string or epoch number is
 * read the same way. A value that is not a real instant is left out rather
 * than rendered as `Invalid Date`; the template declares the variable
 * required, so that send is refused rather than sent with a dangling sentence.
 */
function invitationExpiryArg(expiresAt: unknown): { expiresAt?: string } {
  if (!(expiresAt instanceof Date) && typeof expiresAt !== 'string' && typeof expiresAt !== 'number') return {};
  const instant = new Date(expiresAt);
  return Number.isNaN(instant.getTime()) ? {} : { expiresAt: instant.toISOString() };
}
