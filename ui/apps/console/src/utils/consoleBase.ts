/**
 * Console mount base — the prefix a FULL-PAGE navigation needs.
 *
 * Lifted out of `pages/auth/LoginPage` (objectui#4181), where it was
 * module-private. It had already been copied once into `RegisterPage`, and
 * `SetupPage` — which needed it just as much — silently went without: its two
 * first-run exits navigated to a bare `'/'` and dropped a brand-new owner
 * outside the SPA on the first screen after creating their account. One
 * implementation, three callers, so the next basename fix lands in one place.
 *
 * ## The rule
 *
 * `window.location.assign` bypasses React Router's `basename`, so a path
 * produced by the router (e.g. `?redirect=/settings` — already
 * basename-stripped) or a literal like `/organizations` would resolve to
 * `http://host/settings`, missing the `/_console` mount and 404-ing.
 *
 * ## Why reading `BASE_URL` is the correct source, in all three mounts
 *
 * The router takes its basename from the injected `<base href>`
 * (`App.tsx:resolveBasename`) while this helper reads `import.meta.env.BASE_URL`
 * — two different sources, which is worth spelling out because they agree only
 * for a reason, not by construction:
 *
 *  - **dev / default `/` mount** — Vite resolves a relative `base` to `'/'` in
 *    serve mode, so this is a no-op prefix and both spellings coincide. This is
 *    why a standalone `os dev` run can never reveal the bug.
 *  - **embedded, the shipped default** (`vite.config.ts` `base: './'`, no
 *    `VITE_BASE_PATH`) — `BASE_URL` is the literal `'./'`, so this returns a
 *    RELATIVE url (`'./'`, `'./organizations'`). `location.assign` resolves it
 *    against the document base URL, which is exactly the `<base href="/_console/">`
 *    the framework CLI injects — the same element the router reads. So the two
 *    sources land on one answer via the browser, not via a shared constant.
 *  - **pinned absolute base** (`VITE_BASE_PATH=/_console/`) — `BASE_URL` is
 *    `'/_console/'` and this returns an absolute `/_console/…`.
 *
 * Paths already targeting another absolute SPA mount (`/_studio`, `/_account`,
 * …) pass through untouched.
 */
export function withConsoleBase(path: string): string {
  if (path.startsWith('/_')) return path;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return base + (path.startsWith('/') ? path : `/${path}`);
}

/**
 * A console route as a ROOT-RELATIVE url (`/_console/accept-invitation/ID`) —
 * the form a SERVER-side redirect target needs, such as the `callbackURL`
 * better-auth writes into the email-verification link (objectui#10893).
 *
 * `withConsoleBase` is not enough there. In the shipped embeddable build it
 * returns a document-relative `./…`, which only a browser resolves (against
 * `<base href>`); the server never sees that base. better-auth accepts only a
 * root-relative path or a trusted absolute URL and answers `./…` with
 * `403 INVALID_CALLBACK_URL` — failing the whole sign-up, not just the
 * redirect. So this resolves `withConsoleBase`'s answer exactly the way
 * `location.assign` would, then keeps the path, query and hash. Every mount
 * therefore agrees with where a full-page navigation to the same route lands.
 */
export function withConsoleBaseRootRelative(path: string): string {
  const url = new URL(withConsoleBase(path), document.baseURI);
  return `${url.pathname}${url.search}${url.hash}`;
}
