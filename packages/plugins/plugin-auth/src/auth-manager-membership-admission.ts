// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 8] Who may join, and what joining settles — the audience gate
 * better-auth's `user.validateUserInfo` callback runs on every user creation,
 * the membership reconciler's one assembly of inputs that both creation seams
 * call, and the self-registration permission set a self-serve sign-up was
 * promised (landed, or reported as not granted) — moved out of
 * `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same audience verdicts and refusal codes, the
 * same bootstrap, invitation and operator-provisioning questions asked of the
 * manager, the same membership policy read, the same grant landing and the
 * same degradation report.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which `auth-manager-actor-guards.ts`,
 * `auth-manager-sign-in-lockout.ts`, `auth-manager-password-session-policy.ts`,
 * `auth-manager-database-hooks.ts`, `auth-manager-email-sms-delivery.ts`,
 * `auth-manager-plugin-assembly.ts` and `auth-manager-database-secret.ts`
 * follow, applied per method. The class keeps all four methods — the
 * published `dist/*.d.ts` lists each one — and each body is one literal of
 * exactly the {@link MembershipAdmissionHost} members that method reads, plus
 * a `.call`. The three that were `async` no longer are: each returns the moved
 * function's own promise, so a caller awaits the same promise the body
 * settles, with no extra wrapper.
 *
 * A method goes as a closure that calls it on the manager at call time, so a
 * test double or spy set on the manager is still the one a body reaches: the
 * bootstrap, invitation and operator-provisioning probes the audience gate
 * asks (which stay on the class), the stagings it writes, and
 * `getMembershipPolicy` (a live platform setting). `config` goes as a GETTER:
 * the class reassigns it after construction (`setRuntimeBaseUrl` and
 * `applyConfigPatch`), so it is read off the manager when a body reads it, as
 * before.
 *
 * `AuthManager` is imported here by VALUE, for one read: the public static
 * `AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD`, inside
 * `validateAudienceAdmission`, when better-auth calls the gate. The two
 * modules import each other, and that is safe because nothing reads the class
 * while they are first evaluated: this module's top level is imports, an
 * interface and function declarations.
 *
 * `settleMembership` below is governed by ADR-0093 D2: the membership
 * reconciler is the single owner of the "every user gets a membership"
 * invariant, and this is the manager's single assembly of its inputs, which
 * both creation seams call. `scripts/adr-anchors/` carries the invariant for
 * this file, as it does for `auth-manager.ts`.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import { AuthManager } from './auth-manager.js';
import {
  classifyCreationMethod,
  decideAudienceAdmission,
  invitationProofFor,
  isAdmittedByInvitationAlone,
  AUDIENCE_CONFIG_ERROR,
  type AudienceCreationClass,
  type InvitationProof,
} from './audience-posture.js';
import { GRANT_SET_NAME_FIELD } from './grant-set-name.js';
import { presentedInvitationId } from './presented-invitation.js';
import { withSystemReadContext } from './objectql-adapter.js';
import { reconcileMembership, type ReconcileOutcome } from './reconcile-membership.js';
import { isSsoProviderSource, readSsoProviderSignInOptions, ssoProviderIdOfSource } from './sso-sign-in-options.js';
import { shouldStampOwnerVerifiedAtCreation } from './walled-owner-operator-stamp.js';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` is a getter.
 */
export interface MembershipAdmissionHost {
  readonly config: AuthManager['config'];
  audienceLogError: AuthManager['audienceLogError'];
  enterpriseOAuthProviderIds: AuthManager['enterpriseOAuthProviderIds'];
  getAudience: AuthManager['getAudience'];
  getMembershipPolicy: AuthManager['getMembershipPolicy'];
  hasPendingInvitationFor: AuthManager['hasPendingInvitationFor'];
  hasPresentedPendingInvitation: AuthManager['hasPresentedPendingInvitation'];
  hasInvitationAdmissionInRequest: AuthManager['hasInvitationAdmissionInRequest'];
  isBootstrapCreation: AuthManager['isBootstrapCreation'];
  isOperatorProvisioning: AuthManager['isOperatorProvisioning'];
  isInvitationAdmissionInRequest: AuthManager['isInvitationAdmissionInRequest'];
  selfRegistrationSetResolvable: AuthManager['selfRegistrationSetResolvable'];
  stageInvitationAdmission: AuthManager['stageInvitationAdmission'];
  stageOwnerVerifiedStamp: AuthManager['stageOwnerVerifiedStamp'];
  stageSelfRegistrationGrant: AuthManager['stageSelfRegistrationGrant'];
}

/**
 * A sign-up admitted by its invitation alone is not bound into the
 * deployment's organization while its address is unverified: under
 * `invite_only`, one admitted by the invitation it PRESENTS; under
 * `email_domain`, one whose address is off the allowlist and which an
 * invitation addressed to it admitted (`isAdmittedByInvitationAlone`,
 * `audience-posture.ts`).
 *
 * The invitation is the admission ticket, and nothing more: the presented id
 * is carried by the accept link and by a copied link, and the address match
 * reads only the address the sign-up typed, so neither proves the invited
 * mailbox. Membership comes from accepting the invitation, which needs a
 * verified address (`invitation-accept-verified-email.ts`) and writes the role
 * the issuer chose, or from a platform administrator's Add Member.
 *
 * A policy-skip, not a bind deferred to the moment the address is verified:
 *  - the invitation is the instrument of admission for such a sign-up, and its
 *    acceptance already writes the membership once the address is verified; a
 *    second, role-less bind at verification would let a verified person who
 *    never accepted (or who declined) join the organization by a route no
 *    issuer chose;
 *  - ADR-0093 D7 decides membership at creation and nowhere later; a bind
 *    triggered by an identity update would be a new decision point on every
 *    path that can write `email_verified` (the verification link, an
 *    administrator's edit, a provider sign-in, a directory sync).
 *
 * Answers whether the user `userId` is such a sign-up, for the creation in the
 * request `ctx` (the endpoint context better-auth hands the admission gate
 * and both settle seams of one creation; `tryGetCurrentAuthEndpointContext()`
 * when a seam hands none). The admission is staged on that request
 * (`stageInvitationAdmission`), so it never reaches another creation of the
 * same address in another request, and every creation this request did not
 * admit by its invitation alone pays one in-memory lookup. A user row that
 * cannot be read while this request staged an admission answers yes: the
 * settle then binds nothing, the direction that keeps the rule.
 */
async function invitationSignUpAwaitsVerification(
  this: Pick<MembershipAdmissionHost, 'config' | 'hasInvitationAdmissionInRequest' | 'isInvitationAdmissionInRequest'>,
  userId: string,
  ctx: unknown,
): Promise<boolean> {
  if (!this.hasInvitationAdmissionInRequest(ctx)) return false;
  const engine = this.config.dataEngine;
  if (!engine) return true;
  try {
    const reader = withSystemReadContext(engine) as unknown as {
      find(object: string, query: Record<string, unknown>): Promise<unknown>;
    };
    const rows = await reader.find('sys_user', { where: { id: userId }, fields: ['id', 'email', 'email_verified'], limit: 1 });
    const row = (Array.isArray(rows) ? rows[0] : undefined) as { email?: unknown; email_verified?: unknown } | undefined;
    if (!row || typeof row.email !== 'string') return true;
    return this.isInvitationAdmissionInRequest(ctx, row.email) && !row.email_verified;
  } catch {
    return true;
  }
}

/** The request a settle seam runs in: the context it was handed, else better-auth's current one. */
async function settleRequestContext(ctx: unknown): Promise<unknown> {
  if (ctx && typeof ctx === 'object') return ctx;
  try {
    const { tryGetCurrentAuthEndpointContext } = await import('@better-auth/core/context');
    return tryGetCurrentAuthEndpointContext();
  } catch {
    return undefined;
  }
}

/** The body of `AuthManager#settleMembership`; the method's docblock there is its contract. */
export async function settleMembership(
  this: Pick<MembershipAdmissionHost, 'config' | 'getMembershipPolicy' | 'hasInvitationAdmissionInRequest' | 'isInvitationAdmissionInRequest'>,
  userId: unknown,
  ctx?: unknown,
): Promise<ReconcileOutcome | undefined> {
  try {
    const id = typeof userId === 'string' && userId ? userId : undefined;
    // A sign-up admitted by its invitation alone is not bound while its
    // address is unverified ({@link invitationSignUpAwaitsVerification}).
    if (id && (await invitationSignUpAwaitsVerification.call(this, id, await settleRequestContext(ctx)))) {
      this.config.logger?.info?.(
        '[membership] not bound: a sign-up admitted by its invitation alone joins by accepting the invitation once its address is verified',
        { userId: id },
      );
      return 'policy-skip';
    }
    const result = await reconcileMembership(
      this.config.dataEngine,
      id,
      {
        // #5152 — read through the accessor, not `this.config` directly: it is
        // the single source the backfill path reads too.
        policy: this.getMembershipPolicy(),
        resolveTargetOrg: async () => {
          const tenancy = this.config.getTenancy?.();
          // Single-org → default org; multi-org → none (invite/JIT own it).
          return tenancy ? await tenancy.defaultOrgId() : null;
        },
        logger: this.config.logger,
      },
    );
    return result.outcome;
  } catch {
    // reconcileMembership never throws, but guard regardless — membership
    // bookkeeping must never break user creation or session creation.
    return undefined;
  }
}

/** The body of `AuthManager#validateAudienceAdmission`; the method's docblock there is its contract. */
export async function validateAudienceAdmission(
  this: Pick<MembershipAdmissionHost, 'audienceLogError' | 'config' | 'enterpriseOAuthProviderIds' | 'getAudience' | 'hasPendingInvitationFor' | 'hasPresentedPendingInvitation' | 'isBootstrapCreation' | 'isOperatorProvisioning' | 'selfRegistrationSetResolvable' | 'stageInvitationAdmission' | 'stageOwnerVerifiedStamp' | 'stageSelfRegistrationGrant'>,
  data: {
    user?: Record<string, unknown>;
    source?: { action?: string; method?: string; oauth?: { providerId?: string }; sso?: { providerId?: string } };
  },
  ctx?: unknown,
): Promise<{ error: string; errorDescription?: string } | undefined> {
  try {
    // link-account / provider sign-in concern an EXISTING user's identity,
    // not audience admission — the posture judges only who may COME INTO
    // EXISTENCE.
    if (data?.source?.action !== 'create-user') return undefined;
    const audience = this.getAudience();
    const email = typeof data?.user?.email === 'string' ? (data.user.email as string) : undefined;
    // [#14157] A creation the deployment's own boot command staged is the
    // OPERATOR class — the vendor's `source.method` cannot carry that,
    // because the seed reaches better-auth through the same `signUpEmail`
    // API a person's sign-up does. See `stageOperatorProvisioning` for why
    // this is a declared ticket and not a wider bootstrap probe.
    // [#14373] …and why email alone no longer decides it: the ticket's
    // random value must also match, read off the SAME endpoint context the
    // `disableSignUp` before-hook already reads `ctx.body.email` from
    // (`getCurrentAuthEndpointContext()` — one context per request, shared
    // across the before/after hooks and this validateUserInfo callback).
    const provisioningTicket = (ctx as { body?: Record<string, unknown> } | undefined)?.body?.[
      AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD
    ];
    const creationClass: AudienceCreationClass = this.isOperatorProvisioning(email, provisioningTicket)
      ? 'operator'
      : classifyCreationMethod(data?.source, {
          enterpriseOAuthProviderIds: this.enterpriseOAuthProviderIds(),
        });
    // An SSO provider's own JIT toggle, read only where it can decide: a
    // provider-class creation through `@better-auth/sso` under `invite_only`
    // (`sso-sign-in-options.ts`; unreadable ⇒ off, so the posture applies).
    const ssoProvider =
      creationClass === 'provider' && isSsoProviderSource(data?.source) && audience.posture === 'invite_only' && !audience.invalid
        ? {
            allowJit: (
              await readSsoProviderSignInOptions(
                this.config.dataEngine ? (withSystemReadContext(this.config.dataEngine) as never) : undefined,
                ssoProviderIdOfSource(data?.source),
              )
            ).allowJit,
          }
        : undefined;
    let isBootstrap = false;
    let hasPendingInvitation = false;
    let proof: InvitationProof = 'none';
    if (creationClass === 'self-serve' || (ssoProvider !== undefined && !ssoProvider.allowJit)) {
      // Only the gated creations pay for the probes.
      isBootstrap = await this.isBootstrapCreation();
      if (!isBootstrap && email) {
        // Under `invite_only` a self-serve sign-up is admitted only by the
        // invitation it presents (`invitationProofFor`): its id, read off the
        // same parsed body the operator ticket above is read from.
        proof = invitationProofFor({
          audience,
          creationClass,
          method: data?.source?.method,
          emailVerified: data?.user?.emailVerified,
        });
        if (proof === 'presented') {
          hasPendingInvitation = await this.hasPresentedPendingInvitation(presentedInvitationId(ctx), email);
        } else if (proof === 'address') {
          hasPendingInvitation = await this.hasPendingInvitationFor(email);
        }
      }
    }
    // The method, the provider's word on the address and the deployment's
    // declared email verification: a social-provider creation is admitted only
    // with a provider-verified address under a posture whose admission rests on
    // the address (`decideAudienceAdmission`).
    const verdict = decideAudienceAdmission({
      audience,
      creationClass,
      email,
      hasPendingInvitation,
      isBootstrap,
      method: data?.source?.method,
      emailVerified: data?.user?.emailVerified,
      declaredEmailVerification: this.config.emailAndPassword?.requireEmailVerification,
      ...(ssoProvider ? { ssoProvider } : {}),
    });
    if (!verdict.admit) {
      if (verdict.code === AUDIENCE_CONFIG_ERROR) {
        // Config-unusable refusals are the operator's bug, not policy —
        // report at error level with the offending value in the line
        // (#5205: never let "your posture is not a posture" read as
        // "policy said no").
        this.audienceLogError(`[audience] refusing self-registration: ${verdict.message}`, {
          method: data?.source?.method,
        });
      } else {
        this.config.logger?.info?.('[audience] self-registration refused by posture', {
          code: verdict.code,
          method: data?.source?.method,
          posture: audience.posture,
        });
      }
      return { error: verdict.code, errorDescription: verdict.message };
    }
    // [#12751] Walled deployments: an ADMITTED creation of the declared
    // platform owner through an operator provisioning path (operator class,
    // or the bootstrap carve-out) is stamped email-verified at creation —
    // maintainer ruling 2026-08-28, 「运营方创建即视为已验证」. The decision
    // (and the per-path argument) lives in `walled-owner-operator-stamp.ts`;
    // this seam only STAGES it, because the admission gate is the one place
    // that holds the vendor's own `source.method` signal AND the bootstrap
    // probe. Consumed once by the composed `user.create.before` hook, so the
    // row is BORN verified; an email UPDATE can never traverse that seam,
    // which is what keeps a later change-to-owner-address from inheriting
    // the stamp.
    if (
      email &&
      shouldStampOwnerVerifiedAtCreation({ email, creationClass, isBootstrap })
    ) {
      this.stageOwnerVerifiedStamp(email);
    }
    // Admitted by its invitation alone (`isAdmittedByInvitationAlone`): the
    // membership settle does not bind this sign-up while its address is
    // unverified (`settleMembership`).
    if (email && isAdmittedByInvitationAlone({ audience, creationClass, email, proof, hasPendingInvitation })) {
      this.stageInvitationAdmission(ctx, email);
    }
    if (verdict.grantPermissionSet) {
      const setName = audience.selfRegistrationPermissionSet;
      if (!setName) {
        // Unreachable past entry validation; keep the fail-closed floor —
        // admitting without the declared grant would be ADR-0078's
        // "declared but inert" at runtime.
        const message =
          `audience posture '${audience.posture}' permits self-registration but declares no ` +
          'selfRegistrationPermissionSet — self-registration is refused until the configuration is fixed.';
        this.audienceLogError(`[audience] ${message}`);
        return { error: AUDIENCE_CONFIG_ERROR, errorDescription: message };
      }
      const resolvable = await this.selfRegistrationSetResolvable(setName);
      if (!resolvable) {
        const message =
          `the declared self-registration permission set '${setName}' cannot be resolved ` +
          '(not in the security catalog, switched off in sys_metadata_activation, or the store ' +
          'is unavailable) — ' +
          'self-registration is refused rather than admitting an ungranted user. ' +
          'Declare or switch on the set, or point selfRegistrationPermissionSet at an existing one.';
        this.audienceLogError(`[audience] ${message}`);
        return { error: AUDIENCE_CONFIG_ERROR, errorDescription: message };
      }
      if (email) this.stageSelfRegistrationGrant(email, setName);
    }
    return undefined;
  } catch (error) {
    // Fail CLOSED: an admission question this gate cannot answer must not
    // admit. The operator class never reaches I/O, and the SSO provider
    // read answers OFF rather than throwing, so neither lands here.
    const message = 'audience admission could not be evaluated — self-registration refused.';
    this.audienceLogError(`[audience] ${message}`, {
      error: (error as Error)?.message ?? String(error),
    });
    return { error: AUDIENCE_CONFIG_ERROR, errorDescription: message };
  }
}

/** The body of `AuthManager#landSelfRegistrationGrant`; the method's docblock there is its contract. */
export async function landSelfRegistrationGrant(
  this: Pick<MembershipAdmissionHost, 'config'>,
  engine: unknown,
  userId: string,
  setName: string,
  organizationId: string,
): Promise<void> {
  const sys = withSystemReadContext(engine as never) as any;
  const existing: any[] = await sys.find('sys_user_permission_set', {
    where: { user_id: userId, [GRANT_SET_NAME_FIELD]: setName },
    limit: 1,
  });
  if (existing.length > 0) return;
  const id = `ups_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await sys.insert(
    'sys_user_permission_set',
    { id, user_id: userId, [GRANT_SET_NAME_FIELD]: setName, organization_id: organizationId },
    { context: { isSystem: true } },
  );
  this.config.logger?.info?.('[audience] granted the declared self-registration permission set', {
    userId,
    permissionSet: setName,
    organizationId,
  });
}

/** The body of `AuthManager#reportUngrantedSelfRegistrant`; the method's docblock there is its contract. */
export function reportUngrantedSelfRegistrant(this: Pick<MembershipAdmissionHost, 'audienceLogError'>, userId: string, setName: string, cause: string): void {
  this.audienceLogError(
    `[audience] a self-registrant was ADMITTED but the declared permission set '${setName}' was NOT granted ` +
    `(user ${userId}) — the account works and everything looks normal, but it holds only baseline access, ` +
    `and nothing retries this. Fix: verify the set exists and is active for the target organization, then grant it ` +
    `manually (sys_user_permission_set) or have the user re-created. Cause: ${cause}`,
  );
}
