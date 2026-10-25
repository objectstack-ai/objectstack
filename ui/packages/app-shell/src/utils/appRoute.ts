/**
 * ADR-0048 (option A) — the `/apps/<segment>` route is keyed on the **package
 * id** (reverse-domain, globally unique), not the app's display name. This makes
 * two vendors' same-named apps unambiguous and self-describing in the URL.
 *
 * - `appRouteSegment(app)` — the canonical route segment for linking TO an app
 *   (its package id; falls back to `name` for runtime/DB apps with no
 *   `_packageId`).
 * - `matchAppBySegment(apps, seg)` — resolve a route segment back to its app,
 *   preferring the package id and falling back to the app name. The name
 *   fallback doubles as a per-tenant friendly alias and keeps legacy
 *   name-based URLs/bookmarks working. Callers keep their own
 *   default/first-app fallback around this match.
 * - `resolveHostAppSegment(apps, preferred)` — which app should HOST a
 *   framework-owned, app-independent page for this user (see below).
 */

/**
 * The minimal app shape THESE ROUTE HELPERS read.
 *
 * ⚠️ Renamed off `AppLike` at objectui#7265, and the rename is the fix rather
 * than a workaround. `@objectstack/spec/system` exports an `AppLike` of its own:
 * the minimal app document `translateApp` consumes — `{ name, label,
 * description, navigation }` with `name` REQUIRED — i.e. the keys the
 * TRANSLATOR reads. These helpers read a disjoint set for a different purpose,
 * and adopting the spec's shape would make this module worse in both
 * directions:
 *
 *   - `_packageId` is the ADR-0048 route key and the FIRST thing every function
 *     here reads. The spec's shape does not declare it; it would arrive through
 *     that shape's `[key: string]: any`, i.e. as `any`, taking the
 *     `typeof packageId !== 'string'` guard in `studioPackageId` with it. Same
 *     for `active` / `hidden`, which `filterActiveApps` reads;
 *   - `name` is optional here on purpose. `resolveHostAppSegment`'s documented
 *     step 4 exists FOR "the degenerate app carrying neither `_packageId` nor
 *     `name`", so a required `name` would assert away the one case that branch
 *     was written to serve.
 *
 * `unknown` (not `string`) on both members is deliberate for the same reason the
 * guards exist: these helpers are handed apps straight out of the metadata
 * catalog and must narrow before using either. `spec-symbol-parity.test.ts`
 * holds the two-way ratchet on the rename.
 */
type AppRouteLike = { name?: unknown; _packageId?: unknown } & Record<string, unknown>;

export function appRouteSegment(app: AppRouteLike | null | undefined): string | undefined {
  if (!app) return undefined;
  const seg = (app._packageId as string | undefined) ?? (app.name as string | undefined);
  return seg ?? undefined;
}

export function matchAppBySegment<T extends AppRouteLike>(
  apps: readonly T[] | null | undefined,
  seg: string | null | undefined,
): T | undefined {
  if (!apps || seg == null) return undefined;
  return apps.find((a) => a?._packageId === seg) ?? apps.find((a) => a?.name === seg);
}

/**
 * The console's own administration app. Only ever a LAST RESORT for the
 * resolution below — historically it was hardcoded as the FIRST choice, which
 * is the defect objectstack#7231 / objectui#4074 removed.
 */
const SETUP_APP_SEGMENT = 'setup';

/**
 * The apps a user can actually open, in metadata order. `active === false`
 * deactivates an app; `hidden === true` keeps it out of the launcher (personal
 * settings and similar chrome). Neither is a place to send someone.
 *
 * One definition, because "an app the user can open" has to mean the same thing
 * to Home's launcher and to every producer that builds a link into an app.
 *
 * ⛔ Do NOT add `_unpublished` to this predicate (objectstack#6955 / objectstack-ai/objectstack#4829 A1).
 * It is the machine-managed ADR-0045 publish gate, and it is enforced
 * SERVER-SIDE — the REST metadata gate withholds unpublished apps from
 * non-builders, so any that reach this function belong to a builder entitled to
 * open them. Filtering here would hide a builder's own in-progress app from the
 * builder (and strand every link this module builds into it) while buying no
 * protection the server was not already providing. `hidden` is the opposite
 * case: it has no other enforcement point anywhere, so this filter IS its whole
 * implementation. Two keys, two layers; this reads exactly one of them. Pinned
 * by `__tests__/appRoute.test.ts`.
 */
export function filterActiveApps<T extends AppRouteLike>(apps: readonly T[] | null | undefined): T[] {
  if (!apps) return [];
  return apps.filter((a) => a?.active !== false && a?.hidden !== true);
}

/**
 * Which app should host a framework-owned, **app-independent** page for this
 * user — the Approvals Inbox (objectstack#7231), the full inbox
 * (`sys_inbox_message`) and the activity list (`sys_activity`) (objectui#4074).
 *
 * Those pages are mounted for every app (`system/approvals` sits in the host's
 * route fragment as BOTH `extraRoutes` and `extraRoutesNoApp`; `sys_*` objects
 * are framework-owned and resolve at `/apps/{any app}/{object}`), so the app
 * segment in their URL is a statement about WHERE THE USER IS, never about
 * where the page lives. Hardcoding `setup` there was a dead end for every
 * business user without access to the setup app, and an unannounced app switch
 * for everyone else — both measured in a browser on objectui#4074.
 *
 * Resolution order, each step falling through only when the previous one cannot
 * name an app the user can actually open:
 *   1. `preferred` — the app they are in, or last had open — RE-CHECKED against
 *      the live active list, so an app that was deactivated or hidden since is
 *      not resurrected as a link;
 *   2. their first active app — arbitrary but reachable, and on a business
 *      user's workspace that is a business app rather than `setup`;
 *   3. `preferred` unchecked, but ONLY when the list names no app at all. An
 *      empty list means "not loaded yet" (the pre-catalog render, or a consumer
 *      outside `MetadataProvider`) at least as often as it means "this user has
 *      no apps", and demoting a user who is demonstrably rendering inside
 *      `/apps/{preferred}/…` to `setup` would reintroduce the very defect this
 *      resolves. A caller with a genuinely empty workspace has no reachable app
 *      to offer anyway;
 *   4. `setup`. What is left is the degenerate app carrying neither
 *      `_packageId` nor `name` — nothing addressable to build a URL from — so
 *      the historical target is the least-surprising last resort rather than a
 *      broken link.
 *
 * Note step 1 takes ONE `preferred` hint: callers inside the `/apps/:appName/*`
 * router pass `currentAppName ?? params.appName` (the shell's published app,
 * then the URL's own segment); Home renders outside that router and has only
 * `currentAppName`, which is stale by construction — hence the re-check.
 */
export function resolveHostAppSegment(
  apps: readonly AppRouteLike[] | null | undefined,
  preferred: string | null | undefined,
): string {
  const active = filterActiveApps(apps);
  const stillActive = appRouteSegment(matchAppBySegment(active, preferred));
  if (stillActive) return stillActive;
  const firstActive = appRouteSegment(active[0]);
  if (firstActive) return firstActive;
  if (active.length === 0 && preferred) return preferred;
  return SETUP_APP_SEGMENT;
}

/**
 * App → Studio reverse bridge (ADR-0080). Resolves a running app to its owning
 * package's design surface (`/studio/:packageId/data`), or `null` when there is
 * nothing to open:
 * - the viewer is not a workspace admin (designing mutates shared package
 *   metadata, so the entry point is admin-only — mirrors the runtime editors);
 * - the app has no owning package (runtime/DB apps), or its container is the
 *   DB-authored `sys_metadata` pseudo-package, which is not a package the
 *   Studio design surface can open.
 *
 * Writability of the target package is NOT checked here — the ADR-0070 D4 gate
 * stays the server-side authority, and the Studio surface itself renders
 * read-only packages as browse-only.
 */
export function appStudioDesignPath(
  app: AppRouteLike | null | undefined,
  isWorkspaceAdmin: boolean,
): string | null {
  if (!isWorkspaceAdmin) return null;
  const packageId = studioPackageId(app);
  if (!packageId) return null;
  return `/studio/${encodeURIComponent(packageId)}/data`;
}

/**
 * Deep-link from a running app straight to a specific interface's design
 * surface in Studio's Interfaces pillar — e.g. viewing a dashboard opens
 * `/studio/:packageId/interfaces?surface=dashboard:<name>`, which the pillar's
 * `?surface=` restore honors (see `nav-selection.ts`). Same admin/package
 * guards as {@link appStudioDesignPath}; returns null when the surface identity
 * is incomplete so the caller can fall back to the plain design path.
 *
 * The `surface` param value is `type:name`; types never contain `:`, so the
 * pillar splits on the first colon. Only the name is percent-encoded — the
 * type is a fixed keyword (`dashboard`/`report`/…).
 */
export function appStudioSurfacePath(
  app: AppRouteLike | null | undefined,
  isWorkspaceAdmin: boolean,
  surface: { type?: string | null; name?: string | null } | null | undefined,
): string | null {
  if (!isWorkspaceAdmin) return null;
  const packageId = studioPackageId(app);
  if (!packageId) return null;
  const type = surface?.type;
  const name = surface?.name;
  if (!type || !name) return null;
  const value = `${type}:${encodeURIComponent(name)}`;
  return `/studio/${encodeURIComponent(packageId)}/interfaces?surface=${value}`;
}

/**
 * Deep-link from a running app straight to a specific **object's** design
 * surface in Studio's Data pillar — e.g. viewing the `account` records page
 * opens `/studio/:packageId/data?surface=object:account`, which the Data
 * pillar's `?surface=` restore honors (see `DataPillar` in
 * `StudioDesignSurface`). Same admin/package guards as
 * {@link appStudioDesignPath}; returns null when the object name is missing so
 * the caller can fall back to the plain Data tab.
 *
 * The `surface` param value is `object:<name>` — the same `type:name` shape the
 * Interfaces pillar uses; only the name is percent-encoded (`object` is a fixed
 * keyword).
 */
export function appStudioObjectPath(
  app: AppRouteLike | null | undefined,
  isWorkspaceAdmin: boolean,
  objectName: string | null | undefined,
): string | null {
  if (!isWorkspaceAdmin) return null;
  const packageId = studioPackageId(app);
  if (!packageId) return null;
  if (!objectName) return null;
  const value = `object:${encodeURIComponent(objectName)}`;
  return `/studio/${encodeURIComponent(packageId)}/data?surface=${value}`;
}

/**
 * Route types that correspond to a designable **interface** surface in Studio's
 * Interfaces pillar. The console route type (`/apps/:pkg/<type>/<name>`) doubles
 * as the Studio surface type — the keywords match `resolveSurface` in
 * `StudioDesignSurface` (`dashboard` / `page` / `report`).
 */
const INTERFACE_SURFACE_ROUTE_TYPES = new Set(['dashboard', 'page', 'report']);

/**
 * Console `/apps/:pkg/<type>` route types that are NOT object records — the
 * interface surfaces (handled above) plus the `system` settings area. Any other
 * route type IS the object name (see `AppHeader`'s breadcrumb switch: the
 * `else if (routeType)` branch treats it as an object), so it deep-links the
 * Data pillar to that object.
 */
const NON_OBJECT_ROUTE_TYPES = new Set([...INTERFACE_SURFACE_ROUTE_TYPES, 'system']);

/**
 * App → Studio bridge target for a running-app route (ADR-0080). When the route
 * names a specific interface (a dashboard, page, or report — see
 * {@link INTERFACE_SURFACE_ROUTE_TYPES}), deep-link straight to THAT surface in
 * the Interfaces pillar via {@link appStudioSurfacePath}. When it names an
 * object record page (the route type IS the object name), deep-link that object
 * in the Data pillar via {@link appStudioObjectPath}. Otherwise (bare app root,
 * a `system` route, or an interface list route with no surface name) fall back
 * to the package's generic Data tab via {@link appStudioDesignPath}. Returns
 * null when the bridge should not render (non-admin / no owning package).
 * Centralizes the route-type → surface-type mapping so `AppHeader` stays
 * declarative and the decision is unit-tested here.
 */
export function appStudioRoutePath(
  app: AppRouteLike | null | undefined,
  isWorkspaceAdmin: boolean,
  route: { type?: string | null; name?: string | null } | null | undefined,
): string | null {
  const type = route?.type;
  const name = route?.name;
  if (type && name && INTERFACE_SURFACE_ROUTE_TYPES.has(type)) {
    return appStudioSurfacePath(app, isWorkspaceAdmin, { type, name });
  }
  if (type && !NON_OBJECT_ROUTE_TYPES.has(type)) {
    return appStudioObjectPath(app, isWorkspaceAdmin, type);
  }
  return appStudioDesignPath(app, isWorkspaceAdmin);
}

/** Shared guard: the owning package id usable by the Studio design surface. */
function studioPackageId(app: AppRouteLike | null | undefined): string | null {
  const packageId = app?._packageId;
  if (typeof packageId !== 'string' || !packageId || packageId === 'sys_metadata') return null;
  return packageId;
}

/**
 * Where a notification's `action_url` should actually take the user
 * (objectui#5179).
 *
 * ## The contract this reads
 *
 * `action_url` is **app-relative**, and the producer says so in as many words.
 * `service-messaging`'s `actionUrlFor()` takes an explicit `payload.url` when
 * one is given, and otherwise synthesizes `/{object}/{id}` from the emit's
 * `source` "so the materialization is self-sufficient for navigation (the bell
 * no longer has the L2 event's `source_object/source_id` to fall back on —
 * ADR-0030 L5)". Its own pins carry that shape: `/showcase_task/t_42`,
 * `/opportunities/42`.
 *
 * So the field names a RECORD, not a console route. Which app hosts it is the
 * client's question — the same one {@link resolveHostAppSegment} answers for
 * `sys_inbox_message` and `sys_activity`, and for the same reason: notifications
 * are app-independent, so the app segment in the URL is a statement about WHERE
 * THE USER IS.
 *
 * Navigating the field verbatim is what objectui#5179 reported. `/showcase_task/t_42`
 * matches no route, so the console's catch-all (`<Route path="*" element={<Navigate
 * to="/" replace />} />`) forwards it to `/`, and `RootLandingRedirect` resolves
 * that to `/apps/<default app>` — the app landing page. Mark-as-read has already
 * fired by then, so the user's pointer to the record is not misdirected but gone.
 *
 * ## Why a resolver rather than a prefix at each call site
 *
 * Both producers of this navigation — Home's action centre and the top-bar bell
 * — had their own answer, and the two disagreed with each other AND with the
 * two "see all" drills sitting in the same files. One resolver is what makes
 * them incapable of drifting again; it is the same argument objectui#4074 made
 * for `resolveHostAppSegment` one screen up.
 *
 * ## The three shapes, and why each is distinguished
 *
 * - **external** (`https://…`, or any other scheme) — a producer-supplied
 *   `payload.url` pointing off-console. It must never be hosted: prefixing
 *   would build `/apps/crm/https://…`, a route that does not exist. The caller
 *   decides how to open it, because "new tab" is a UI decision, not a routing one.
 * - **already a console route** (`/apps/…`) — an explicit `payload.url` that has
 *   already named its app. Hosting it twice (`/apps/crm/apps/acme/…`) would
 *   break the one case that worked before this fix.
 * - **app-relative** (everything else) — the synthesized `/{object}/{id}`, and
 *   the case this exists for. Hosted under `hostAppSegment`.
 *
 * Returns `null` for an absent or blank url, so callers keep their own fallback
 * (Home opens the full inbox; the bell has no link to follow) rather than
 * receiving a fabricated target. A protocol-relative `//host/path` counts as
 * external — it is a URL to another origin, whatever the current scheme.
 */
export type NotificationTarget =
  /** Off-console. Hand to `window.open`, never to the router. */
  | { kind: 'external'; url: string }
  /** An in-console path, ready for `navigate()`. */
  | { kind: 'route'; path: string };

export function resolveNotificationTarget(
  actionUrl: string | null | undefined,
  hostAppSegment: string,
): NotificationTarget | null {
  const url = (actionUrl ?? '').trim();
  if (!url) return null;
  // Any scheme (`https:`, `mailto:`, …) or a protocol-relative `//host` is off
  // this console's router. Deliberately broader than an http(s) test: a
  // `mailto:` link prefixed into `/apps/crm/mailto:…` is just as broken.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return { kind: 'external', url };
  const rel = url.startsWith('/') ? url : `/${url}`;
  // Already addressed to an app — `/apps` alone included, which is the app
  // launcher rather than a record, but still this console's own route.
  if (rel === '/apps' || rel.startsWith('/apps/')) return { kind: 'route', path: rel };
  return { kind: 'route', path: `/apps/${hostAppSegment}${rel}` };
}
