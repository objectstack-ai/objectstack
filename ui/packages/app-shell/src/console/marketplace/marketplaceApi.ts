/**
 * Marketplace REST helper.
 *
 * Thin fetch wrapper around the tenant runtime's marketplace proxy
 * (`/api/v1/marketplace/*`). The proxy forwards to the configured
 * cloud control plane (`OS_CLOUD_URL`) — only browse endpoints are
 * exposed. Install is performed against the cloud action endpoint
 * directly (via `installPackage()` below), which requires the user
 * to have a cloud session.
 *
 * See:
 *   cloud/packages/service-cloud/src/routes/marketplace.ts
 *   framework/packages/runtime/src/cloud/marketplace-proxy-plugin.ts
 */

import { getCloudBase } from '../../runtime-config.js';
import { TokenStorage } from '@object-ui/auth';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
const API_BASE = `${SERVER_URL}/api/v1/marketplace`;

/**
 * Attach the Bearer token to same-origin `/api/v1/cloud-connection/*` calls.
 *
 * objectui authenticates with a Bearer token (better-auth, stored in
 * localStorage by `@object-ui/auth` and normally injected by the app's
 * `createAuthenticatedFetch` wrapper). These marketplace routes use raw
 * `fetch()` and so bypass that wrapper — relying on `credentials: 'include'`
 * (the session cookie) alone is NOT enough on a tenant runtime: after
 * platform SSO the env's session cookie is not reliably presented, so the
 * cloud-connection route's `resolveEnvSession` finds no session and returns
 * 401 "Sign in to this environment." even though the user is signed in.
 * Injecting the Bearer (which the server's `getSession` accepts) fixes it.
 * `credentials: 'include'` is kept so the cookie still rides along when set.
 */
function withEnvAuth(headers: Record<string, string>): Record<string, string> {
  const token = TokenStorage.get();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

/**
 * Read a code + human message out of a failed cloud response, whichever dialect
 * it arrived in.
 *
 * The routes behind this file (`service-cloud`) answer failures in two shapes,
 * and are mid-conversion from one to the other (cloud#944):
 *
 *   { success: false, error: '<message>' }              today, via `fail()`
 *   { success: false, error: { code, message } }        the declared envelope
 *
 * Seven call sites in this file each hand-rolled their own read of that, in
 * four different ways, and the spread was not harmless:
 *
 *   - two read `payload?.error` bare, with no nested fallback. Once the
 *     producer converts, those receive an OBJECT where the surrounding type
 *     declares `error?: string` — and an object handed to a toast as a React
 *     child crashes the page. That is objectstack#3913's exact symptom, which
 *     `interpretActionResponse` already exists to prevent on the actions route.
 *   - two read only the nested form, so against a server shipping TODAY they
 *     find nothing and degrade a real explanation into a bare status code.
 *
 * So this is not only preparation for the conversion — it fixes messages that
 * are already being swallowed. One function, so the next reader has one place
 * to look and the next route has nothing to hand-roll.
 *
 * The `typeof … === 'string'` guard is what makes it safe to hand the result
 * straight to a `string` field: an unexpected shape degrades to the code rather
 * than travelling onward as an object.
 */
export function readApiError(
  payload: any,
  res: { status: number; statusText: string },
): { code: string; message: string } {
  const code = payload?.error?.code ?? payload?.code ?? `HTTP_${res.status}`;
  const raw =
    payload?.error?.message   // the declared envelope
    ?? payload?.error         // `fail()`'s bare string
    ?? payload?.message       // a few routes put the text here
    ?? res.statusText;
  return { code: String(code), message: typeof raw === 'string' ? raw : String(code) };
}

/**
 * Per-locale overrides for translatable package fields. Mirrors
 * `PackageTranslation` from @objectstack/spec/cloud — duplicated here
 * to avoid pulling the spec package into the app-shell bundle.
 * See framework/packages/spec/src/cloud/package.zod.ts.
 */
export interface MarketplacePackageTranslation {
  displayName?: string;
  description?: string;
  readme?: string;
  tagline?: string;
  screenshotCaptions?: Record<string, string>;
}

export type MarketplacePackageTranslations = Record<string, MarketplacePackageTranslation>;

export interface MarketplacePackageSummary {
  id: string;
  manifest_id: string;
  display_name: string;
  description?: string | null;
  category?: string | null;
  tags?: string | null;
  icon_url?: string | null;
  homepage_url?: string | null;
  license?: string | null;
  publisher?: string | null;
  is_starter?: boolean;
  created_at?: string;
  updated_at?: string;
  /**
   * Locale-keyed overrides for display_name / description / readme.
   * Optional on the wire: older control planes / older runtimes may not
   * project this column yet. UI should fall back to the base field.
   */
  translations?: MarketplacePackageTranslations | null;
  latest_version: MarketplacePackageVersion | null;
}

export interface MarketplacePackageDetail extends MarketplacePackageSummary {
  readme?: string | null;
}

/**
 * Structured permission grants a plugin requests (ADR-0025 §3.2).
 *
 * Owned by `@objectstack/spec/kernel` — the local copy was member-for-member
 * identical, which is exactly the copy that silently rots the day the spec adds
 * a grant kind (objectstack#4115).
 */
export type { PluginPermissions } from '@objectstack/spec/kernel';

/**
 * Trust / isolation tier a plugin runs under (ADR-0025 §3.6).
 *
 * Owned by `@objectstack/spec/kernel`'s `PluginRuntimeSchema`
 * (`z.enum(['node', 'sandbox', 'worker'])`) — the same reasoning as
 * `PluginPermissions` above, and the same defect one field over: this was
 * declared `string` here, i.e. looser than the contract the producer validates
 * against, and the looseness leaked a raw wire value onto the trust-tier badge
 * of the panel that grants code execution (objectui#3846).
 */
export type { PluginRuntime } from '@objectstack/spec/kernel';

import type { MetadataLock, PluginPermissions, PluginRuntime } from '@objectstack/spec/kernel';
import { isPlainRecord } from '@objectstack/spec/data';

export interface MarketplacePackageVersion {
  id: string;
  version: string;
  status?: string;
  is_prerelease?: boolean;
  published_at?: string | null;
  // Human-authored "what changed in this version" notes (ADR-0010 version
  // lifecycle / UX#6). Distinct from the package-level description; shown per
  // version in the detail page's version history.
  release_notes?: string | null;
  listing_status?: string;
  reviewed_at?: string | null;

  // Plugin distribution disclosure (ADR-0025 PD4 §3.11). Present only for
  // code-bearing versions; the control plane exposes verification STATUS,
  // never the raw signatures.
  artifact_kind?: string;
  /** True when this version carries executable code (a `plugin` artifact). */
  contains_code?: boolean;
  /** Trust tier the plugin runs under — the spec's closed three-member enum. */
  runtime?: PluginRuntime;
  /** Dependency packaging: 'bundled' | 'manifest-deps'. */
  packaging?: string;
  /** Structured permission set the plugin asks the installer to grant. */
  permissions?: PluginPermissions | null;
  /** Compatibility ranges ({ platform, protocol }). */
  engines?: { platform?: string; protocol?: string } | null;
  /** Whether the artifact carries a verified publisher signature. */
  signed?: boolean;
  /** Whether the marketplace counter-signed (reviewed + approved) this version. */
  platform_verified?: boolean;
}

export interface MarketplaceListResponse {
  items: MarketplacePackageSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface MarketplaceDetailResponse {
  package: MarketplacePackageDetail;
  versions: MarketplacePackageVersion[];
}

/**
 * A browse request. A failure the server ANSWERED rejects with an `Error` that
 * carries the response's `status` and `code`; a request no server answered (a
 * network failure, a CORS refusal, an abort) rejects with whatever `fetch`
 * threw, which has no `status`. `MarketplacePage` tells the two apart by that
 * member, because only the second is a question of being online
 * (objectui#11688).
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'omit',
    headers: { 'Accept': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  // Read once, as text. A hop in front of the control plane that is not an
  // ObjectStack route (an egress proxy, a gateway) refuses in `text/plain`,
  // the runtime's proxy forwards that body verbatim, and the text IS the
  // cause: "Host not in allowlist: cloud.objectos.ai". Parsing straight to
  // JSON threw it away and left the bare status text ("Forbidden") to show
  // (objectui#11688).
  const body = await res.text().catch(() => '');
  let payload: any = null;
  try { payload = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const { code, message } = readApiError(payload, res);
    const plainText =
      payload === null && (res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/plain')
        ? body.trim()
        : '';
    const err = new Error(plainText || message);
    (err as any).code = code;
    (err as any).status = res.status;
    throw err;
  }
  // Cloud helpers return `{ success: true, data: ... }`; unwrap when present.
  return (payload?.data ?? payload) as T;
}

export async function listMarketplacePackages(params: { q?: string; category?: string; limit?: number; offset?: number } = {}): Promise<MarketplaceListResponse> {
  const usp = new URLSearchParams();
  if (params.q) usp.set('q', params.q);
  if (params.category) usp.set('category', params.category);
  if (params.limit != null) usp.set('limit', String(params.limit));
  if (params.offset != null) usp.set('offset', String(params.offset));
  const qs = usp.toString();
  return call<MarketplaceListResponse>(`/packages${qs ? `?${qs}` : ''}`);
}

export async function getMarketplacePackage(id: string): Promise<MarketplaceDetailResponse> {
  return call<MarketplaceDetailResponse>(`/packages/${encodeURIComponent(id)}`);
}

/**
 * How install-local installs a package (ADR-0131 D6): `managed` registers it
 * as code that receives its upgrades; `unmanaged` copies its metadata once into
 * this runtime as the environment's own, which follows no upgrade.
 *
 * The console's reading of the two values the install door
 * (`POST /api/v1/marketplace/install-local`) takes as `installMode`. Written
 * here, not derived: the `@objectstack/spec` this package resolves declares no
 * install mode.
 */
export type LocalInstallMode = 'managed' | 'unmanaged';

/** Every install mode, in the order the package page lists them. */
const LOCAL_INSTALL_MODES: readonly LocalInstallMode[] = ['managed', 'unmanaged'];

/**
 * The install modes a package version's manifest declares: its `installModes`
 * key, read from the manifest install-local itself fetches and judges
 * (`GET /packages/:id/versions/:versionId/manifest`; install-local installs
 * `latest` when it is given no version, and so does the package page).
 *
 * The key is read where the door reads it: a compiled artifact nests its
 * manifest under `manifest:`, a flat package body carries it at the top.
 *
 * - `undefined` when the manifest declares no `installModes`. ⛔ Absence is
 *   not resolved to a default here: what it means is the door's answer, and
 *   the page sends no `installMode` for it.
 * - `undefined` too for a declaration the spec refuses (not a non-empty list
 *   of the two modes). The door refuses that package whatever mode is sent
 *   (`PLUGIN_MANIFEST_INVALID`), so the page offers no choice the door would
 *   refuse, and shows the door's own message.
 * - Otherwise each declared mode once: a mode named twice changes nothing
 *   (the spec's reading of the key).
 */
export async function getDeclaredInstallModes(
  packageId: string,
  versionId = 'latest',
): Promise<readonly LocalInstallMode[] | undefined> {
  const data = await call<{ manifest?: unknown } | null>(
    `/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/manifest`,
  );
  const body = data?.manifest;
  if (!isPlainRecord(body)) return undefined;
  const declared = (isPlainRecord(body.manifest) ? body.manifest : body).installModes;
  if (!Array.isArray(declared) || declared.length === 0) return undefined;
  if (!declared.every((m) => (LOCAL_INSTALL_MODES as readonly unknown[]).includes(m))) return undefined;
  return LOCAL_INSTALL_MODES.filter((m) => declared.includes(m));
}

/**
 * Install a package into an environment by calling the cloud's
 * `install_package` action **directly** (not via the proxy). Requires the
 * caller's browser to have a valid cloud session cookie — typically
 * because the user has signed into cloud at least once and the cookie
 * domain covers this origin. When that's not the case the call fails
 * with 401; the UI can then surface a "Sign in on cloud" link.
 *
 * `cloudBaseUrl` is supplied by the server at boot via
 * `/api/v1/runtime/config` (see `runtime-config.ts`); we read it through
 * `getCloudBase()` rather than hardcoding `VITE_CLOUD_URL` or sniffing
 * `window.location.hostname`. When the runtime *is* the cloud,
 * `getCloudBase()` returns `''` and we fall back to same-origin.
 */

export interface InstallResponse {
  installation?: { id: string; environment_id: string; package_id: string; version: string };
  message?: string;
  [k: string]: any;
}

export async function installPackage(input: {
  packageId: string;
  environmentId: string;
  seedSampleData?: boolean;
}): Promise<InstallResponse> {
  const cloudBase = getCloudBase();

  // ── In-environment (tenant runtime) path ──────────────────────────────
  // When `getCloudBase()` is non-empty we're a *tenant runtime* (e.g.
  // crm.objectos.app) whose marketplace browses a *separate* cloud origin.
  // POSTing the install straight to `${cloudBase}/api/v1/actions/...` is a
  // cross-origin, credentialed request that the browser blocks with
  // "Failed to fetch" (no CORS allowance + cross-site cookie). Instead we
  // call the SAME-ORIGIN `/api/v1/cloud-connection/install` route that the
  // cloud-owned runtime plugin mounts: it authorizes via the environment's
  // own session and forwards to cloud server-to-server (no CORS, no leaked
  // cross-site cookie). The target environment is the current one, resolved
  // by hostname on the server. See
  // docs/design/cloud-account-binding-marketplace-install.md (cloud repo).
  if (cloudBase) {
    const res = await fetch(`/api/v1/cloud-connection/install`, {
      method: 'POST',
      credentials: 'include',
      headers: withEnvAuth({ 'Accept': 'application/json', 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        package_id: input.packageId,
        seed_sample_data: !!input.seedSampleData,
      }),
    });
    let payload: any = null;
    try { payload = await res.json(); } catch { /* empty */ }
    if (!res.ok || payload?.success === false) {
      const { code, message } = readApiError(payload, res);
      const err = new Error(typeof message === 'string' ? message : `${code}`);
      (err as any).code = code;
      (err as any).status = res.status;
      throw err;
    }
    return (payload?.data ?? payload) as InstallResponse;
  }

  // ── Cloud control-plane path (runtime IS cloud) ───────────────────────
  // Same-origin direct call to the install action.
  const base = SERVER_URL;
  const res = await fetch(`${base}/api/v1/actions/sys_package/install_package`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordId: input.packageId,
      params: {
        environment_id: input.environmentId,
        seed_sample_data: !!input.seedSampleData,
      },
    }),
  });
  let payload: any = null;
  try { payload = await res.json(); } catch { /* empty */ }
  // A server older than objectstack#3913 reports a failed install action as
  // HTTP 200 `{success: true, data: {success: false, error}}` — checking only
  // `res.ok` reported a package as installed when it was not. Current servers
  // answer with a real status, which `!res.ok` catches first.
  const inner = payload?.data;
  const innerFailed = !!inner && typeof inner === 'object' && inner.success === false;
  if (!res.ok || innerFailed) {
    // The inner branch reads a DIFFERENT object — the 200-with-`data.success:
    // false` shape above — so it stays hand-read; only the outer one is shared.
    const outer = readApiError(payload, res);
    const code = payload?.code ?? outer.code;
    const message = innerFailed ? (inner.error ?? res.statusText) : outer.message;
    const err = new Error(typeof message === 'string' ? message : `${code}`);
    (err as any).code = code;
    (err as any).status = res.status;
    throw err;
  }
  return (payload?.data ?? payload) as InstallResponse;
}

/**
 * Helper: list environments visible to the current cloud user (active
 * organisation). Used to populate the install dialog's environment picker.
 * Calls cloud directly — same auth model as `installPackage`.
 */
export interface CloudEnvironment {
  id: string;
  display_name?: string;
  hostname?: string;
  organization_id?: string;
  plan?: string;
  status?: string;
}

export async function listCloudEnvironments(): Promise<CloudEnvironment[]> {
  const base = getCloudBase() || SERVER_URL;
  const res = await fetch(`${base}/api/v1/data/sys_environment?limit=200`, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`HTTP_${res.status}`);
    (err as any).status = res.status;
    throw err;
  }
  const payload: any = await res.json().catch(() => ({}));
  // Cloud's data API returns `{ object, records, total, hasMore }`.
  // We keep `data` / `items` as fallbacks for older builds.
  const rows = payload?.records ?? payload?.data ?? payload?.items ?? payload ?? [];
  return Array.isArray(rows) ? (rows as CloudEnvironment[]) : [];
}

/**
 * List orgs in which the current cloud user has an `owner` or `admin`
 * role on `sys_member`. Used to filter the install dialog's env picker
 * — only envs whose `organization_id` is in this set are installable
 * (the backend enforces the same gate; this is the UX mirror).
 *
 * Returns an empty set on 401 / network failure so the install dialog
 * can render a clean "no installable environments" state.
 *
 * Hardening: we *always* re-filter rows by the caller's session
 * `user_id` because the data API currently returns sys_member rows
 * without per-caller scoping. Without this, the dialog would pick up
 * every org in the system and offer their envs as install targets.
 */
export async function listInstallableOrgIds(): Promise<Set<string>> {
  const base = getCloudBase() || SERVER_URL;
  let meId: string | null = null;
  try {
    const meRes = await fetch(`${base}/api/v1/auth/get-session`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (meRes.ok) {
      const meBody: any = await meRes.json().catch(() => ({}));
      meId = meBody?.user?.id ?? null;
    }
  } catch {
    /* fall through — meId stays null and we return empty set */
  }
  if (!meId) return new Set();

  const url = `${base}/api/v1/data/sys_member?limit=200`;
  // Assigned in the try below before the read; the only fall-through path is a
  // successful fetch (both the !ok branch and the catch return early).
  let payload: any;
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return new Set();
    payload = await res.json().catch(() => ({}));
  } catch {
    return new Set();
  }
  const rows: any[] = payload?.records ?? payload?.data ?? payload?.items ?? payload ?? [];
  if (!Array.isArray(rows)) return new Set();
  const ids = new Set<string>();
  for (const row of rows) {
    const rowUserId = String(row?.user_id ?? row?.userId ?? '');
    if (rowUserId !== meId) continue;
    const role = String(row?.role ?? '').toLowerCase();
    const orgId = row?.organization_id ?? row?.organizationId;
    if (orgId && (role === 'owner' || role === 'admin')) {
      ids.add(String(orgId));
    }
  }
  return ids;
}

/**
 * The upstream control plane's front door — the cloud base URL the RUNTIME
 * told us about (`/api/v1/runtime/config` → `cloudUrl`), with NO path appended.
 * `''` when this runtime has no upstream cloud, which callers MUST read as
 * "render no link at all".
 *
 * ## Why nothing is appended (objectui#7253)
 *
 * This used to compose `${base}/apps/cloud-control/sys_environment` (upgrade)
 * and `${base}/apps/cloud-control/sys_package/<id>` (install). Both were dead:
 * on the rig the upgrade CTA landed on the control plane's API 404,
 * `{"success":false,"error":{"code":"ENDPOINT_NOT_FOUND"}}`. The composition
 * guessed THREE control-plane-owned facts and got all three wrong —
 *
 *   - the console's MOUNT: the SPA is served under `/_console/`, injected by
 *     the host; a path starting at the origin hits the API router instead.
 *   - the app SLUG: the Cloud app's `name` is `cloud_control`, not
 *     `cloud-control`.
 *   - the ROUTE: the plan/billing entry is a Page, not the `sys_environment`
 *     object list.
 *
 * None of these are knowable from a tenant runtime: they are properties of the
 * deployment that serves the CONTROL PLANE's console, and the only thing the
 * runtime config tells us about it is its origin. Composing them here is the
 * same class of guess whichever page we aim at, so this returns the origin and
 * stops. That origin is a real destination: the console mount claims `/` and
 * 302s to `/_console/` (objectos-runtime `mountConsoleStatic`, `rootRedirect`
 * default on), landing the user in the Cloud app whose nav carries Billing.
 *
 * ⛔ Do NOT re-add a path here "temporarily". The durable fix is a
 * control-plane-DECLARED URL, one that arrives from cloud page metadata — the
 * way the since-retired `cloud:onboarding-next` widget received its
 * `environmentsRoute` (objectui#12954). Until the control plane publishes an
 * equivalent for the tenant SPA (reported alongside this fix), the origin is
 * the most specific target we are entitled to name.
 *
 * The former `|| 'https://cloud.objectos.app'` default is gone with it: a
 * runtime with no upstream cloud has no control plane to send anyone to, and
 * bouncing a self-hosted or air-gapped user to the vendor's SaaS is a worse
 * answer than showing no link.
 */
export function cloudConsoleUrl(): string {
  return getCloudBase();
}

/**
 * Look up whether a package is already installed in the given environment.
 * Returns the installed version string when an `enabled=true` row exists,
 * or `null` when no install row is found.
 *
 * Used by `MarketplacePackagePage` to flip the primary CTA from
 * "Install to Cloud" → "Installed" on initial render — without it, the
 * button keeps inviting users to install a package that's already
 * installed and the install call surfaces a confusing "already exists"
 * error.
 */
export interface CloudInstallationInfo {
  installationId: string;
  version: string;
  withSampleData: boolean;
}

export async function getCloudInstalledVersion(
  packageId: string,
  environmentId: string,
): Promise<string | null> {
  const info = await getCloudInstallationInfo(packageId, environmentId);
  return info ? info.version : null;
}

/**
 * Richer companion to {@link getCloudInstalledVersion}. Returns the
 * full installation handle (id, version, sample-data flag) so the
 * Marketplace UI can render reseed / purge actions.
 */
export async function getCloudInstallationInfo(
  packageId: string,
  environmentId: string,
): Promise<CloudInstallationInfo | null> {
  if (!packageId) return null;

  // ── In-environment (tenant runtime) path ──────────────────────────────
  // When `getCloudBase()` is non-empty we're a tenant runtime browsing a
  // *separate* cloud origin. A direct `${cloudBase}/api/v1/data/...` read is
  // a cross-origin, cross-site-cookie request the browser blocks — the exact
  // reason `installPackage()` routes through the same-origin proxy. Mirror it
  // here: the cloud-owned runtime plugin's `/cloud-connection/installation`
  // route resolves the env by hostname and queries the control plane
  // server-to-server. Without this, the "Installed" CTA never flips and an
  // already-installed package keeps inviting another install.
  const cloudBase = getCloudBase();
  if (cloudBase) {
    try {
      const res = await fetch(
        `/api/v1/cloud-connection/installation?package_id=${encodeURIComponent(packageId)}`,
        { credentials: 'include', headers: withEnvAuth({ 'Accept': 'application/json' }) },
      );
      if (!res.ok) return null;
      const payload: any = await res.json().catch(() => ({}));
      const data: any = payload?.data ?? payload ?? {};
      if (!data.installed) return null;
      return {
        installationId: String(data.installationId ?? ''),
        version: String(data.version ?? 'installed'),
        withSampleData: data.withSampleData === true,
      };
    } catch {
      return null;
    }
  }

  // ── Cloud control-plane path (runtime IS cloud) ───────────────────────
  // Use the dedicated installed-state route, NOT the generic
  // `/api/v1/data/sys_package_installation`. The control plane does not expose
  // sys_package_installation rows through the generic data API (the row exists
  // but the read returns empty), and that row carries `package_version_id`, not
  // a version string. The dedicated route reads the control DB directly and
  // resolves the human-readable version — and now enforces org membership for
  // user-mode callers. Same response shape as the tenant proxy above.
  if (!environmentId) return null;
  const base = SERVER_URL;
  try {
    const res = await fetch(
      `${base}/api/v1/cloud/environments/${encodeURIComponent(environmentId)}/installations/${encodeURIComponent(packageId)}`,
      { credentials: 'include', headers: { 'Accept': 'application/json' } },
    );
    if (!res.ok) return null;
    const payload: any = await res.json().catch(() => ({}));
    const data: any = payload?.data ?? payload ?? {};
    if (!data.installed) return null;
    return {
      installationId: String(data.installationId ?? ''),
      version: String(data.version ?? 'installed'),
      withSampleData: data.withSampleData === true,
    };
  } catch {
    return null;
  }
}

/**
 * The outcome of a cloud sample-data action. A refusal carries its error
 * `code` beside the `error` text (objectui#10432).
 *
 * The text alone is not enough. In the 5xx band the control plane withholds
 * the producer's sentence (cloud#1145), so `error` holds the generic constant
 * there, and `code` is the one member that still says which fault occurred.
 * cloud#2072 relies on exactly that: a control plane with no environment
 * kernels refuses re-seed / purge with HTTP 500 and
 * `ENVIRONMENT_KERNEL_UNAVAILABLE`, a composition fact the caller must not
 * offer to retry, while `INTERNAL_ERROR` stays the retryable fault.
 *
 * `code` is absent when no response arrived (a network error, or a missing
 * installation id refused before the request).
 */
export interface SampleDataActionResult {
  ok: boolean;
  error?: string;
  code?: string;
}

/** POST /api/v1/cloud/installations/:id/reseed-sample-data */
export async function reseedSampleData(installationId: string): Promise<SampleDataActionResult> {
  if (!installationId) return { ok: false, error: 'installation id required' };
  const base = getCloudBase() || SERVER_URL;
  try {
    const res = await fetch(`${base}/api/v1/cloud/installations/${encodeURIComponent(installationId)}/reseed-sample-data`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const payload: any = await res.json().catch(() => ({}));
    if (!res.ok || payload?.success === false) {
      const { code, message } = readApiError(payload, res);
      return { ok: false, error: message, code };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/** POST /api/v1/cloud/installations/:id/purge-sample-data */
export async function purgeSampleData(installationId: string): Promise<SampleDataActionResult & { deleted?: number }> {
  if (!installationId) return { ok: false, error: 'installation id required' };
  const base = getCloudBase() || SERVER_URL;
  try {
    const res = await fetch(`${base}/api/v1/cloud/installations/${encodeURIComponent(installationId)}/purge-sample-data`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const payload: any = await res.json().catch(() => ({}));
    if (!res.ok || payload?.success === false) {
      const { code, message } = readApiError(payload, res);
      return { ok: false, error: message, code };
    }
    return { ok: true, deleted: Number(payload?.data?.deleted ?? 0) };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

// ────────────────────────────────────────────────────────────────────
// Local install (this runtime's kernel — not a cloud environment)
// ────────────────────────────────────────────────────────────────────
//
// Architecturally distinct from cloud install:
//   - Single target = the local kernel; no env picker.
//   - Same-origin POST against the local runtime (no CORS).
//   - Local AuthPlugin session is sufficient — no cloud account required.
//   - Manifest is cached on disk so the app keeps working offline.
//
// Backend: framework/packages/runtime/src/cloud/marketplace-install-local-plugin.ts

/**
 * The marker the install-local listing puts on an entry this runtime's startup
 * rehydrate refused to load (objectstack#21822, served since `@objectstack/*`
 * 17.7.0). CLOSED on the server: exactly these two members.
 *
 * `code` is the refusal's error code. The one the server sends today is
 * `OS_PROTOCOL_INCOMPATIBLE`, and `requiredRange` is then the protocol range the
 * package declares (the same `requiredRange` the install door's 422 carries in
 * `error.details`). It is typed `string` rather than that literal because the
 * console names a code it has no sentence for instead of hiding the row.
 */
export interface LocalInstallNotLoaded {
  code: string;
  requiredRange: string;
}

/**
 * One item of `GET /api/v1/marketplace/install-local` (`listLocalInstalls`), and
 * the shape `listInstalledPackages` maps the control plane's rows into.
 *
 * Two members are absent by the server's rule, never `false` or `null`:
 *   - `installedBy` for a caller without `manage_metadata` (a narrowed caller);
 *   - `withSampleData` on an entry carrying `notLoaded`, which stands IN PLACE
 *     of it: the listing reads no rows of a package the runtime did not load.
 */
export interface LocalInstallEntry {
  packageId: string;
  versionId: string;
  manifestId: string;
  version: string;
  installedAt: string;
  installedBy?: string | null;
  /** Whether the bundled seed datasets are currently loaded in the local
   *  kernel DB. True after install (with seed) or reseed; false after purge. */
  withSampleData?: boolean;
  /** Present only when this runtime refused to load the package at startup
   *  (objectui#11645). The entry is still installed: Uninstall and a
   *  compatible re-install act on it. */
  notLoaded?: LocalInstallNotLoaded;
}

/** A `managed` install-local answer: the package registered as code. */
export interface LocalManagedInstallResult {
  /** Never sent on a managed answer: only the `unmanaged` answer names its mode. */
  installMode?: never;
  manifestId: string;
  version: string;
  versionId: string;
  installedAt: string;
  hotLoaded: boolean;
  upgradedFrom: string | null;
  note?: string;
}

/**
 * One protection lock an `unmanaged` copy dropped: the item, the lock the
 * package shipped on it, and the package's reason verbatim. The console's
 * reading of one entry of the install door's `strippedLocks` answer; only
 * `lock` is typed from the spec, whose answer shape this package's resolved
 * `@objectstack/spec` does not declare.
 */
export interface LocalInstallStrippedLock {
  type: string;
  name: string;
  lock: Exclude<MetadataLock, 'none'>;
  reason?: string;
}

/**
 * The `unmanaged` install-local answer (ADR-0131 D6): the package's metadata
 * copied once into a new writable base, `targetPackageId`. Nothing is
 * registered under the package's own id, so the install-local listing does not
 * list it. `strippedLocks` is every lock the copy dropped; empty when the
 * package locked nothing.
 */
export interface LocalUnmanagedInstallResult {
  installMode: 'unmanaged';
  manifestId: string;
  version: string;
  versionId: string;
  installedAt: string;
  installedFrom: { packageId: string; version?: string };
  targetPackageId: string;
  namespace: string;
  copiedCount: number;
  copied: Array<{ type: string; name: string }>;
  strippedLocks: LocalInstallStrippedLock[];
  note?: string;
}

export type LocalInstallResult = LocalManagedInstallResult | LocalUnmanagedInstallResult;

/**
 * Org-scoped catalog (ADR-0007 step ②). The caller's own organization's
 * packages (visibility org/private) — discoverable + installable from inside
 * the environment via the same-origin /cloud-connection/org-packages proxy,
 * distinct from the public marketplace browse. `connected: false` → not
 * cloud-bound (self-hosted), so there is no org catalog to show.
 */
export interface OrgPackageSummary {
  id: string;
  manifest_id: string;
  display_name: string;
  description?: string | null;
  category?: string | null;
  icon_url?: string | null;
  visibility?: string;
  latest_version?: string | null;
}
export interface OrgPackagesResult {
  connected: boolean;
  items: OrgPackageSummary[];
}
export async function listOrgPackages(): Promise<OrgPackagesResult> {
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/cloud-connection/org-packages`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { connected: false, items: [] };
    const payload: any = await res.json().catch(() => ({}));
    const data: any = payload?.data ?? {};
    const items: OrgPackageSummary[] = Array.isArray(data.items) ? data.items : [];
    return { connected: data.connected === true, items };
  } catch {
    return { connected: false, items: [] };
  }
}

/**
 * `POST /install-local`. `installMode` is sent only when the caller names one
 * (ADR-0131 D6); absent, the door applies its own default. A refusal rejects
 * with the envelope's own `message`, its `code` and `status` beside it — the
 * install-mode refusals included (`INSTALL_MODE_NOT_PERMITTED`,
 * `UNMANAGED_INSTALL_WALLED_POSTURE`, `RESOURCE_CONFLICT`).
 *
 * The first overload is the door's own rule for a request that names no mode:
 * it installs managed and answers the managed shape, as every install did
 * before the mode existed.
 */
export function installLocal(input: {
  packageId: string;
  versionId?: string;
  installMode?: undefined;
}): Promise<LocalManagedInstallResult>;
export function installLocal(input: {
  packageId: string;
  versionId?: string;
  installMode?: LocalInstallMode;
}): Promise<LocalInstallResult>;
export async function installLocal(input: {
  packageId: string;
  versionId?: string;
  installMode?: LocalInstallMode;
}): Promise<LocalInstallResult> {
  const res = await fetch(`${API_BASE}/install-local`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packageId: input.packageId,
      ...(input.versionId ? { versionId: input.versionId } : {}),
      ...(input.installMode ? { installMode: input.installMode } : {}),
    }),
  });
  let payload: any = null;
  try { payload = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const { code, message } = readApiError(payload, res);
    const err = new Error(typeof message === 'string' ? message : `${code}`);
    (err as any).code = code;
    (err as any).status = res.status;
    throw err;
  }
  return (payload?.data ?? payload) as LocalInstallResult;
}

/**
 * `GET /api/v1/marketplace/install-local`, strictly: a failed request or an
 * answer with no `items` array throws instead of reading as "nothing
 * installed". The Packages page lists the marketplace installs from this
 * (objectui#12675): an empty answer would silently drop the rows of the
 * installs the runtime did not load, and the actions of the ones it did.
 * The page's Source column does not read it: since objectui#12790 it reads
 * each row's served `source`.
 */
export async function fetchLocalInstalls(): Promise<LocalInstallEntry[]> {
  const res = await fetch(`${API_BASE}/install-local`, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(readApiError(payload, res).message);
  const items = payload?.data?.items ?? payload?.items;
  if (!Array.isArray(items)) {
    throw new Error(`GET ${API_BASE}/install-local answered without an items list.`);
  }
  return items as LocalInstallEntry[];
}

/** {@link fetchLocalInstalls}, with any failure read as an empty list. */
export async function listLocalInstalls(): Promise<LocalInstallEntry[]> {
  try {
    return await fetchLocalInstalls();
  } catch {
    return [];
  }
}

/**
 * Cloud-managed installed list (ADR-0007 step ①).
 *
 * For a cloud-connected environment, the authoritative "what's installed"
 * lives in the control plane's `sys_package_installation`, NOT the runtime's
 * local `.objectstack/installed-packages/` cache. A tenant SPA can't read the
 * control plane cross-origin, so the env's own runtime proxies it at the
 * same-origin `/api/v1/cloud-connection/installed` route. This surfaces
 * packages installed via ANY path (CLI `--env --install`, marketplace, REST).
 *
 * `connected: false` means this runtime is self-hosted / not cloud-bound — the
 * caller should fall back to {@link listLocalInstalls}.
 */
export interface InstalledPackagesResult {
  connected: boolean;
  items: LocalInstallEntry[];
}

export async function listInstalledPackages(): Promise<InstalledPackagesResult> {
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/cloud-connection/installed`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { connected: false, items: [] };
    const payload: any = await res.json().catch(() => ({}));
    const data: any = payload?.data ?? {};
    const pkgs: any[] = Array.isArray(data.packages) ? data.packages : [];
    const items: LocalInstallEntry[] = pkgs.map((p) => {
      const manifestId = String(p.packageId ?? p.package_id ?? '');
      return {
        packageId: manifestId,
        versionId: String(p.package_version_id ?? ''),
        manifestId,
        version: String(p.version ?? 'installed'),
        installedAt: String(p.installed_at ?? p.installedAt ?? ''),
        installedBy: (p.installed_by ?? p.installedBy ?? null) as string | null,
        withSampleData: p.with_sample_data === true || p.withSampleData === true,
      };
    });
    return { connected: data.connected === true, items };
  } catch {
    return { connected: false, items: [] };
  }
}

/**
 * What the marketplace slice lists as installed — the read the Installed Apps
 * list made, now what the Packages page's marketplace rows act on: their
 * Details and Uninstall, and the rows of installs the runtime did not load
 * (objectui#12675). It names no registry row's Source; the page reads the
 * served `source` for that (objectui#12790). `cloud` = the control plane's
 * list (a cloud-connected environment: installs by any path); `local` = this
 * runtime's install-local ledger. The local leg is strict
 * ({@link fetchLocalInstalls}).
 */
export async function readMarketplaceInstalls(): Promise<{ source: 'cloud' | 'local'; items: LocalInstallEntry[] }> {
  const cloud = await listInstalledPackages();
  if (cloud.connected) return { source: 'cloud', items: cloud.items };
  return { source: 'local', items: await fetchLocalInstalls() };
}

export async function uninstallLocal(manifestId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/install-local/${encodeURIComponent(manifestId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const payload: any = await res.json().catch(() => ({}));
    throw new Error(readApiError(payload, res).message);
  }
}

export interface LocalSampleDataResult {
  manifestId: string;
  inserted?: number;
  updated?: number;
  deleted?: number;
  skipped?: number;
  errors?: number;
  withSampleData: boolean;
}

async function postLocalSampleAction(manifestId: string, action: 'reseed' | 'purge'): Promise<LocalSampleDataResult> {
  const path = action === 'reseed' ? 'reseed-sample-data' : 'purge-sample-data';
  const res = await fetch(`${API_BASE}/install-local/${encodeURIComponent(manifestId)}/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message ?? res.statusText;
    const err = new Error(typeof message === 'string' ? message : `HTTP_${res.status}`);
    (err as any).code = payload?.error?.code ?? `HTTP_${res.status}`;
    throw err;
  }
  return (payload?.data ?? payload) as LocalSampleDataResult;
}

export function reseedLocalSampleData(manifestId: string): Promise<LocalSampleDataResult> {
  return postLocalSampleAction(manifestId, 'reseed');
}

export function purgeLocalSampleData(manifestId: string): Promise<LocalSampleDataResult> {
  return postLocalSampleAction(manifestId, 'purge');
}
