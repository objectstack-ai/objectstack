// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a cloud-managed environment's settings doors tell the console, read by
 * their declared shapes (`cloud-managed-settings.ts` in service-settings).
 *
 * A hosted environment's file storage and its AI provider are provided and
 * configured by the hosting platform. The server answers that in two ways:
 *
 *  - a door it refuses (the whole `storage` namespace, a write naming a hidden
 *    `ai` key, the refused actions) answers `409 RESOURCE_CONFLICT` with
 *    `error.details.managedBy: 'platform'`;
 *  - the `ai` namespace is served PROJECTED: its provider, model and
 *    credential keys are left out, so nothing errors.
 *
 * ⛔ The refusal is read by its code and `details.managedBy`, never by its
 * message: `RESOURCE_CONFLICT` is a shared code, and a 409 without
 * `managedBy: 'platform'` stays an ordinary failure.
 */

/** The `details.managedBy` value that names the hosting platform. */
const MANAGED_BY_PLATFORM = 'platform';

/**
 * Whether a failed settings call was refused because the hosting platform
 * manages what was asked for. `status` is the HTTP status, `body` the raw
 * error body (`{ success: false, error: { code, message, details } }`).
 */
export function isPlatformManagedRefusal(status: number | undefined, body: unknown): boolean {
  if (status !== 409 || !body || typeof body !== 'object') return false;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const { code, details } = error as { code?: unknown; details?: unknown };
  if (code !== 'RESOURCE_CONFLICT' || !details || typeof details !== 'object') return false;
  return (details as { managedBy?: unknown }).managedBy === MANAGED_BY_PLATFORM;
}

/** The namespace whose provider keys a hosted environment withholds. */
export const AI_PROVIDER_NAMESPACE = 'ai';
/** The key that names the AI provider; the projection drops it first. */
const AI_PROVIDER_KEY = 'provider';

/**
 * Whether the AI page should say its provider is managed by the platform.
 *
 * Two served facts, both required: the auth config's `features.cloudManaged`
 * (plugin-auth answers it from the same `isCloudManaged()` the settings
 * projection reads) says this environment is hosted, and the served manifest
 * carrying no `provider` key says the projection actually ran. A hosted
 * server that still serves the provider draws its form and no line, so the
 * line never sits above a provider field it calls managed.
 */
export function aiProviderManagedByPlatform(
  namespace: string,
  specifiers: ReadonlyArray<{ key?: string }>,
  features: { cloudManaged?: unknown } | null | undefined,
): boolean {
  if (namespace !== AI_PROVIDER_NAMESPACE || features?.cloudManaged !== true) return false;
  return !specifiers.some((s) => s.key === AI_PROVIDER_KEY);
}
