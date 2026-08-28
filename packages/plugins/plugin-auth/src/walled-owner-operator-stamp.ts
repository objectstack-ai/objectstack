// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12751] On a walled deployment, the declared platform owner is
 * email-verified at OPERATOR-provisioned creation.
 *
 * Maintainer ruling 2026-08-28 (cloud#1677, verbatim):
 * 「运营方创建即视为已验证」— the declared platform owner
 * (`OS_PLATFORM_OWNER_EMAIL`), when its account comes into existence through
 * the operator's own bootstrap/provisioning path on a walled deployment, is
 * stamped email-verified at creation. The trust anchor is the operator's
 * env-var declaration PLUS the operator-executed creation — not a mailbox
 * round-trip; SMTP stays required only for inviting OTHERS. This extends the
 * #11343 precedent (the dev-boot seeded admin, `auth-plugin.ts`
 * `maybeSeedDevAdmin`: "provisioned by the deployment's own boot command with
 * operator-known credentials — not an unknown self-registrant") to
 * production walled boots, whose owner previously had NO in-product way to
 * ever satisfy the verified-elevation invariant when no mail transport and
 * no federated sign-in were wired (`WALLED_OWNER_NO_VERIFICATION_PATH`).
 * Rejected alternatives, from the same ruling: mandating a mail transport
 * out of the box, and a separate CLI stamp command.
 *
 * ## Which creation paths qualify as "operator-provisioned", and why
 *
 * The classification is [#11739]'s audience taxonomy
 * (`classifyCreationMethod`) — deliberately NOT a second, parallel reading of
 * the same question:
 *
 *  - **`operator` class** (`admin` create-user / bulk import, `scim`):
 *    qualifies. An `admin` creation only exists inside an authenticated
 *    admin session — it IS the provisioning mechanism the closed postures
 *    point operators at. A `scim` creation is executed by the
 *    operator-registered directory: registering the IdP is the operator
 *    declaring "this directory is my audience" (audience-posture.ts), and
 *    the provisioning request is that declaration acting.
 *  - **`self-serve` class WITH the bootstrap carve-out** (`isBootstrap`:
 *    zero human users — the very first account on a fresh install):
 *    qualifies. On a walled deployment self-registration is closed; the one
 *    self-serve creation a fresh walled boot admits is the bootstrap
 *    carve-out, which exists precisely because the first account is presumed
 *    to be the operator standing the deployment up ("a fresh install must
 *    never lock its operator out"). The declared-owner match narrows that
 *    presumption further: the address only the operator's own environment
 *    declaration names. Residual exposure — a stranger who reaches the
 *    sign-up endpoint of a freshly booted walled deployment BEFORE the
 *    operator does, typing the operator's own declared address — is the
 *    same first-account trust the carve-out already extends, and the
 *    pre-#12751 outcome of that race was already operator intervention
 *    (address squatted unverified, elevation refused forever, deployment
 *    dead for its owner). The ruling accepts the env declaration + the
 *    creation act as the anchor.
 *  - **`self-serve` class WITHOUT the carve-out**: NEVER qualifies — a
 *    self-registrant typing the owner's address proves nothing (#11343's
 *    whole point), and that includes an invitation-admitted registration
 *    (the invitation carve-out admits the CREATION; it does not verify the
 *    mailbox).
 *  - **`provider` class** (enterprise SSO / operator-registered OIDC JIT):
 *    deliberately NOT stamped here. The IdP asserts its own
 *    `emailVerified` at insert (better-auth writes it straight off the
 *    provider profile), and overriding an authority that DECLINED to assert
 *    the address would manufacture verification nobody stands behind. A
 *    verified IdP claim already arrives verified without this module.
 *
 * ## The bounds (the contract, not suggestions)
 *
 *  - ONLY under the walled posture family (`postureEnforcesWall` over the
 *    REQUESTED posture — the same input the elevation gate reads, for the
 *    same fail-stricter reason documented in `bootstrapPlatformAdmin`).
 *  - ONLY the account whose email equals the declared
 *    `OS_PLATFORM_OWNER_EMAIL`, compared the way the elevation gate compares
 *    (trimmed, case-insensitive — mirrored, not reinvented).
 *  - ONLY at CREATION, through the seam below. A later email UPDATE to the
 *    owner address inherits nothing: the decision is staged from the
 *    creation-time admission gate and consumed once by the `user.create`
 *    before-hook, a seam an update can never traverse.
 *  - Dev-boot behaviour (#11343's seed stamp) is unchanged: on a walled dev
 *    boot whose declared owner is the seeded address, this module stamps the
 *    same account the seed would have stamped a moment later — idempotent by
 *    construction.
 *
 * ## Wiring
 *
 * The DECISION lives here, pure over its inputs plus the two env
 * resolutions. AuthManager stages it in `validateAudienceAdmission` (the one
 * admission seam every creation path flows through, where the vendor's own
 * `source.method` signal and the bootstrap probe already exist) and consumes
 * it in the composed `user.create.before` database hook, so the row is BORN
 * `emailVerified: true` — the same shape as a trusted-SSO insert. The
 * elevation itself needs no new trigger: the creation write already replays
 * `bootstrapPlatformAdmin` (`shouldReplayBootstrapFor`, `create` arm).
 */

import {
  resolvePlatformOwnerEmail,
  resolveTenancyPosture,
} from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import type { AudienceCreationClass } from './audience-posture.js';

/**
 * Does this creation come into existence through an operator provisioning
 * path? See the module doc for the per-path argument.
 */
export function isOperatorProvisionedCreation(
  creationClass: AudienceCreationClass,
  isBootstrap: boolean,
): boolean {
  if (creationClass === 'operator') return true;
  return creationClass === 'self-serve' && isBootstrap;
}

/**
 * The whole stamp decision: walled posture family + declared-owner email
 * match + operator-provisioned creation. `false` for every other shape —
 * including every shape on an unwalled deployment, where elevation never
 * demands a verified owner and the stamp would be an unearned state change.
 *
 * The email comparison mirrors `bootstrapPlatformAdmin`'s owner match
 * (candidate: `String(email).trim().toLowerCase()`; declared: already
 * trimmed by `resolvePlatformOwnerEmail`, lowercased here) — the two MUST
 * agree, or an account this module stamps is one the gate then fails to
 * elevate.
 */
export function shouldStampOwnerVerifiedAtCreation(input: {
  email: string | undefined;
  creationClass: AudienceCreationClass;
  isBootstrap: boolean;
}): boolean {
  if (!isOperatorProvisionedCreation(input.creationClass, input.isBootstrap)) return false;
  if (!postureEnforcesWall(resolveTenancyPosture())) return false;
  const declared = resolvePlatformOwnerEmail();
  if (!declared) return false;
  const candidate = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!candidate) return false;
  return candidate === declared.toLowerCase();
}
