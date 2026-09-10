// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16013] The ONE classification an admission door performs on the `tenancy`
 * service's rejection — and DELIBERATELY not the resolution that reaches it.
 *
 * ## What this owns, and the whole reason it is this narrow
 *
 * Six admission seams each hand-wrote the same three lines: read the posture
 * through {@link effectiveTenancyPosture}, and on a rejection tell the
 * REGISTRY's two facts apart —
 *
 *  - **never registered** ⇒ branded ({@link isServiceNotRegisteredError},
 *    #13905) ⇒ quiet `undefined`. An embedding with no `plugin-auth` is a
 *    SUPPORTED composition; `resolveAuthzContext` runs both
 *    posture-conditional API-key refusals (`organization_required`,
 *    `organization_membership_ended`) ONLY on a present posture, so the quiet
 *    answer is "run no posture-conditional refusal at all";
 *  - **registered and unable to answer** ⇒ unbranded ⇒
 *    {@link AuthzStoreUnavailableError}`('tenancy', err)` (ADR-0112
 *    `SERVICE_UNAVAILABLE` / 503). The posture is an authorization INPUT, so
 *    admission was never DECIDED and must not be answered. ⛔ A
 *    `try { … } catch { undefined }` here is exactly the permissive-on-failure
 *    defect #13906 decision 1 option A exists to repair: a FAILURE reading as
 *    "this check does not apply".
 *
 * That classification is the part nobody may get wrong, and it is the part
 * that is genuinely the same everywhere. ⛔ **The RESOLUTION is not.** The
 * seams differ irreducibly in how they reach the service and in why a missing
 * async accessor must stay quiet:
 *
 *  - `rest-server.ts` branches on **kernel-vs-provider** — two wirings, and
 *    asking twice would let a provider bound to the LOCAL kernel answer for a
 *    request that resolved to another environment;
 *  - four seams read `ctx.getKernel()`; `service-storage` reads an
 *    already-normalised `StorageGateRegistry` slice (#15169);
 *  - each seam's "a missing async accessor stays quiet" argument is its OWN.
 *    `service-storage`'s is that door's declared degrade-to-ungated contract
 *    (`buildFileReadAuthorizer` already returns `undefined` with no auth
 *    service or engine); the others' is the `KernelBase`/`LiteKernel` host
 *    shape. ⛔ They are per-seam justifications, not interchangeable prose.
 *
 * ⇒ a helper that also owned **how** the service is reached would be wrong for
 * some seam or grow a flag per seam — the copies again, with an extra step.
 * So the caller keeps its own accessor-presence guard, its own wiring branch
 * and its own reason, and hands this function a thunk.
 *
 * ## Why a THUNK and not an already-resolved service
 *
 * Measured, not stylistic: the REJECTION is the input this classifies, so the
 * resolution has to happen inside this function's `try`. A caller that awaited
 * the service first would have to hold a `catch` of its own to get here — and
 * a per-seam `catch` is precisely the thing this exists to delete. A thunk
 * that throws synchronously is classified identically, because it is invoked
 * inside the `try`.
 *
 * ## ⚠️ The trap: `rethrowAuthzStoreUnavailable` is NOT this
 *
 * That function is the MIRROR half — it re-raises a brand a net ALREADY holds
 * and swallows everything else. This one runs the other direction: it MINTS
 * the brand from a raw, unbranded registry rejection. Neither substitutes for
 * the other.
 *
 * ## ⚠️ Why `'tenancy'` is fixed rather than a parameter
 *
 * This function reads a posture, so it is the tenancy service or it is
 * nothing: it returns {@link effectiveTenancyPosture}'s value and nothing else
 * would type-check into it. A `object` parameter would only let a caller mint
 * the outage brand under a name the read did not use. Other services mint the
 * same brand under their own names (`'objectql'`, `'auth_gate'`,
 * `resolve-authz-context.ts`'s parameterised `object`) — those are a different
 * extraction and ⛔ not this one.
 */

import type { TenancyPosture } from '@objectstack/spec/security';

import { isServiceNotRegisteredError } from '../service-not-registered.js';

import { effectiveTenancyPosture, type TenancyPostureSource } from './api-key.js';
import { AuthzStoreUnavailableError } from './authz-store-unavailable.js';

/**
 * How a seam reaches its `tenancy` service. Invoked INSIDE the classification's
 * `try`, so a synchronous throw and a rejected promise classify identically.
 *
 * Structural on purpose, exactly as {@link TenancyPostureSource} is:
 * `@objectstack/core` must not depend on the plugin that provides the service.
 */
export type TenancyServiceResolver = () =>
  | Promise<TenancyPostureSource | undefined | null>
  | TenancyPostureSource
  | undefined
  | null;

/**
 * Classify a `tenancy` read into the admission posture, or into the loud
 * outage — #13906 decision 1 option A, in one place.
 *
 * @param resolveTenancyService How THIS seam reaches the service. The caller
 *   owns the wiring fact (is there a kernel? an async accessor? a provider?)
 *   and answers `undefined` itself when its own wiring is absent; this
 *   function is only reached once the seam has decided to ask.
 * @returns The effective posture, or `undefined` for the supported
 *   no-tenancy composition.
 * @throws {AuthzStoreUnavailableError} for every rejection that is NOT the
 *   registry's branded "never registered".
 */
export async function classifyAdmissionTenancyPosture(
  resolveTenancyService: TenancyServiceResolver,
): Promise<TenancyPosture | undefined> {
  try {
    return effectiveTenancyPosture(await resolveTenancyService());
  } catch (err) {
    if (!isServiceNotRegisteredError(err)) {
      throw new AuthzStoreUnavailableError('tenancy', err);
    }
    return undefined;
  }
}
