/**
 * Resolve the absolute URL of the console "home" route used after switching
 * the active organization.
 *
 * History:
 *   - `${origin}${import.meta.env.BASE_URL}home` broke portable builds
 *     (`base: './'`), producing `https://host./home` — trailing-dot host.
 *   - `new URL('home', document.baseURI)` fixed that, but `document.baseURI`
 *     falls back to the current page URL when no `<base>` tag is present.
 *     From `/home/home/` that resolves to `/home/home/home`, and each
 *     subsequent navigation appended another `/home` segment.
 *
 * The robust resolution: read `<base href>` explicitly. When present it
 * carries the deployment mount (`/_console/`, `/`, or `./`); when absent
 * we resolve against the document origin root, which is independent of the
 * current SPA route.
 */
export function resolveHomeUrl(baseURI?: string): string {
  if (baseURI !== undefined) {
    return new URL('home', baseURI).toString();
  }
  return new URL('home', consoleRoot()).toString();
}

/** The deployment-mounted console root (`/_console/`, `/`, …). */
function consoleRoot(): URL {
  const baseHref = document.querySelector('base')?.getAttribute('href');
  return baseHref
    ? new URL(baseHref, window.location.origin)
    : new URL('/', window.location.origin);
}

/**
 * The console ROOT URL (not `/home`). Used after switching/creating an org so
 * the SPA's root route runs `RootLandingRedirect`, which resolves the right
 * landing: a single-app workspace lands IN that app (skipping the redundant
 * launcher), and only a multi-app workspace falls back to `/home`.
 */
export function resolveRootUrl(baseURI?: string): string {
  if (baseURI !== undefined) {
    // The mount directory of the base URI ('.' resolves to the dir), e.g.
    // '/_console/organizations' → '/_console/', '/_console/' → '/_console/'.
    return new URL('.', baseURI).toString();
  }
  return consoleRoot().toString();
}

/**
 * Resolve an arbitrary router-relative path (e.g. `apps/my_app`) against the
 * console's deployment mount, for full-page navigations (`window.open`,
 * `window.location.assign`, a plain `<a href>`) that fall outside React
 * Router and so never see its `basename`. A raw absolute path like
 * `/apps/my_app` resolves against the document origin, not the SPA mount —
 * dropping the `/_console/` prefix and 404ing when the host serves the
 * console under a sub-path. See {@link resolveHomeUrl} above for the
 * mount-resolution history this reuses.
 */
export function resolveConsoleUrl(path: string, baseURI?: string): string {
  return new URL(path.replace(/^\//, ''), resolveRootUrl(baseURI)).toString();
}

/**
 * Resolve the public share-link landing base — the console-mounted `/s` route
 * that `SharedRecordPage` serves (`/_console/s/:token` on a CLI-served
 * deployment). `ShareDialog` appends `/:token` to it for the link a user
 * copies and hands to a recipient.
 *
 * `ShareDialog`'s own default is `${origin}/s/:token`, which 404s wherever the
 * console is not root-mounted. The link is a full-page destination pasted into
 * another browser, so it needs exactly the deployment-mount resolution the
 * navigations above already do — and it takes it from {@link resolveConsoleUrl}
 * rather than a private copy. This helper replaced the third hand-rolled
 * base-href reader in the console (objectui#4482); objectui#4472 removed the
 * other two. One resolver, so the next change to mount semantics cannot reach
 * some call sites and miss others.
 *
 * Returns `undefined` — not a guessed URL — with no DOM, so `ShareDialog`
 * applies its own fallback instead of rendering a link built from an origin
 * that does not exist. That guard is the one thing this adds over a bare
 * `resolveConsoleUrl('s')` call.
 *
 * Deliberately takes no `baseURI` argument, unlike its three siblings: the
 * mount is only ever carried by the injected `<base href>`, and a resolver
 * with no other input cannot be pinned by a test that steers something the
 * production path never reads (the `vi.stubEnv('BASE_URL', …)` trap recorded
 * in objectui#4482 — Vite inlines `import.meta.env` at transform time, so such
 * a test is permanently green).
 */
export function resolvePublicShareBase(): string | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  return resolveConsoleUrl('s');
}
