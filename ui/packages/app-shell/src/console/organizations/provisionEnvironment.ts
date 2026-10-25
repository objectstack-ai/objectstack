/**
 * provisionEnvironment
 *
 * Eagerly ensure a freshly created organization has its **production**
 * environment so a self-service "create another workspace" lands the user in a
 * ready console — no onboarding-wizard detour.
 *
 * ObjectStack runs a 1-production-environment-per-organization model: an org's
 * FIRST environment is born as its production env (allowed on every plan,
 * including free). The cloud control plane exposes this as
 * `POST /api/v1/cloud/environments`, which only needs a `displayName`; the org
 * is resolved from `organizationId` (preferred) → the better-auth active org →
 * the actor's first membership.
 *
 * The endpoint answers `201 { success, data: { environment, warnings,
 * durationMs, hostnameAssignment? } }` — the created row is nested under
 * `environment`, NOT flat on `data`.
 *
 * That shape is CONFIRMED producer-side, not inferred from this consumer —
 * the distinction matters, because the only in-repo artifact that ever pinned
 * this payload before objectui#6629 was a hand-written mock pinning the BUG
 * shape. Two independent producer-side sources, both in `objectstack-ai/
 * objectstack`: `packages/client/src/index.ts` (`environments.create`) records
 * the key set as measured against the cloud repo's `main` on 2026-08-28, naming
 * the handler `packages/service-cloud/src/routes/environment-lifecycle.ts`;
 * and `@objectstack/spec`'s `ProvisionEnvironmentResponseSchema`
 * (`src/cloud/environment.zod.ts`) declares `environment` REQUIRED.
 *
 * Idempotent + best-effort by contract:
 *   - Some control planes auto-provision the production env on org create (the
 *     `auto-default-environment` plugin). This call then races that plugin and
 *     the loser gets a 403 `PRODUCTION_ENV_LIMIT` / 409 — which is SUCCESS for
 *     us (the org is already born-with-env), not a failure.
 *   - On a genuine failure (5xx / network) the caller swallows the error and
 *     the onboarding gate provisions the env lazily on first navigation.
 *
 * @module
 */

import { createAuthenticatedFetch } from '@object-ui/auth';
import { getCloudBase } from '../../runtime-config.js';

/** Result of ensuring the org's production environment exists. */
export interface ProvisionedEnvironment {
  /** Environment id (control-plane `sys_environment` row), when this call minted it. */
  id?: string;
  /** Opaque system hostname, e.g. `os-<shortId>.<rootDomain>` for production. */
  hostname?: string;
  /**
   * True when the org already had its production env (the control plane
   * provisioned it on create). The born-with-env contract is still satisfied.
   */
  alreadyProvisioned?: boolean;
}

/**
 * Ensure the production environment exists for a just-created organization.
 *
 * Uses {@link createAuthenticatedFetch} so the request carries the Bearer token
 * and the active-org `X-Tenant-ID` header; `organizationId` is also sent in the
 * body so the target org is unambiguous even before the session active-org
 * switch has propagated. The env is named `Production` to match the
 * born-with-env convention used by the signup org.
 *
 * @throws on a genuine control-plane failure (5xx / network), or on a 2xx whose
 *   body doesn't carry the contractual `{ success, data: { environment } }`
 *   shape — a wrong-shaped `data` is refused, not absorbed (objectui#6707). A
 *   403/409 "already has its production env" is NOT an error — it resolves to
 *   `{ alreadyProvisioned: true }`.
 */
export async function provisionProductionEnvironment(opts: {
  organizationId: string;
  displayName?: string;
}): Promise<ProvisionedEnvironment> {
  const authFetch = createAuthenticatedFetch();
  const res = await authFetch(`${getCloudBase()}/api/v1/cloud/environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: opts.displayName ?? 'Production',
      organizationId: opts.organizationId,
    }),
  });
  if (!res.ok) {
    // 403 PRODUCTION_ENV_LIMIT / 409 ⇒ the org already owns its (one) production
    // env — born-with-env is satisfied, so this is success, not a failure.
    if (res.status === 403 || res.status === 409) {
      return { alreadyProvisioned: true };
    }
    throw new Error(`Failed to provision production environment (status ${res.status})`);
  }
  // Strict envelope read: the control plane wraps every success payload as
  // `{ success, data }` (cloud#1046), so `data` is the only place the created
  // environment lives. A bare body is a producer contract violation, not a
  // second accepted dialect — returning it (or an empty object) would report a
  // successful provision carrying no env at all. Throwing routes it to the
  // caller's documented failure path: the onboarding gate provisions lazily on
  // first navigation.
  const body = (await res.json().catch(() => null)) as {
    data?: { environment?: { id?: string; hostname?: string } };
  } | null;
  const data = body?.data;
  if (!data || typeof data !== 'object') {
    throw new Error(
      'Malformed control-plane response: expected a `{ success, data }` envelope from POST /cloud/environments',
    );
  }
  // ...and inside that envelope the created row sits ONE LEVEL DOWN, under
  // `environment` — the handler answers `{ environment, warnings, durationMs,
  // hostnameAssignment? }`, so `data.id` / `data.hostname` never existed on the
  // wire and reading `data` flat reported a successful provision whose `id` and
  // `hostname` were always `undefined` (objectui#6629). Projected explicitly
  // rather than returned whole, so the envelope's siblings can't ride along
  // into a value typed `ProvisionedEnvironment`.
  //
  // Read ONE dialect (AGENTS.md #0.1): no `data.environment ?? data` alias — a
  // flat payload is a producer contract violation, not a second spelling — and
  // the violation is REFUSED rather than absorbed (objectui#6707). The envelope
  // check above only catches a MISSING `data`; it says nothing about `data`'s
  // shape, so a producer that regressed to a flat payload would once again
  // resolve successfully with `id` and `hostname` `undefined` — the same silent
  // outcome #6629 fixed, reachable again by a producer change alone. Throwing
  // routes it to the caller's documented failure path instead: the sole caller
  // (`CreateWorkspaceDialog`) logs the warning and the onboarding gate
  // re-provisions lazily on first navigation, so a producer regression becomes
  // loud-ish and recoverable rather than a successful-looking no-op.
  const environment = data.environment;
  if (!environment || typeof environment !== 'object') {
    throw new Error(
      'Malformed control-plane response: `data.environment` is missing from POST /cloud/environments',
    );
  }
  return { id: environment.id, hostname: environment.hostname };
}
