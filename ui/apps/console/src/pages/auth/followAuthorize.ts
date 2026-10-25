/**
 * Complete an OAuth2 / OIDC authorization hand-off after the user has
 * authenticated on this (the cloud / IdP) origin.
 *
 * When an environment federates login to the cloud ("Continue with
 * ObjectStack"), the env (relying party) sends the browser to the cloud's
 * `/oauth2/authorize`. better-auth's oauth-provider, finding an active
 * session + a consent-skipped client, wants to hand a `?code=&state=` back
 * to the env's callback. Crucially it answers a **same-origin fetch** with
 * `200 { redirect: true, url }` and only emits a real `302` for a top-level
 * navigation (see `authorize.mjs` → `handleRedirect` / `isBrowserFetchRequest`
 * in @better-auth/oauth-provider).
 *
 * So a plain `window.location.assign('/oauth2/authorize?…')` is wrong: for a
 * browser-fetch-shaped request it renders the JSON body and strands the user
 * on the "Signing you in…" spinner. We instead fetch the endpoint and follow
 * the `url` it returns ourselves — the same pattern {@link OAuthConsentPage}
 * already uses for the consent POST.
 *
 * If the response isn't the expected JSON shape (an error, a consent page,
 * an opaque redirect, …) we fall back to a top-level navigation so the
 * server can drive its own 302 / error / consent flow rather than leaving
 * the user stuck.
 *
 * @param search the current `window.location.search` (the signed authorize
 *   params better-auth handed us when it redirected here).
 */
export function followOauthAuthorize(search: string): void {
  const authorizeUrl = `/api/v1/auth/oauth2/authorize${search}`;
  const navigateTopLevel = () => window.location.assign(authorizeUrl);

  fetch(authorizeUrl, {
    credentials: 'include',
    // 200-JSON is expected for a fetch; never chase a cross-origin 302 into
    // a CORS error — fall back to a top-level navigation instead.
    redirect: 'manual',
    headers: { accept: 'application/json' },
  })
    .then(async (res) => {
      const data = (await res.json().catch(() => null)) as
        | { url?: string; redirect_uri?: string; redirectURI?: string; redirect?: boolean }
        | null;
      const next = data?.url ?? data?.redirect_uri ?? data?.redirectURI;
      if (res.ok && next) {
        window.location.href = next;
        return;
      }
      navigateTopLevel();
    })
    .catch(navigateTopLevel);
}
