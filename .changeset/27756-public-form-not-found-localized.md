---
'@object-ui/console': patch
---

fix(console): a missing or unavailable public `/f/:slug` form tells the guest so in their language, not as a raw English error (#27756)

Clause-②: no
Metadata-protocol: none

The public form route threw `Failed to load form (STATUS): BODY` for any failed `GET /forms/:slug`, and the page rendered that English text verbatim to the anonymous visitor, server body included, whatever the session language.

- **A 404 is "no such form".** The resolver answers 404 for a slug that is unknown, unpublished or no longer anonymous. The page now draws the console's shared not-found state (`console.notFound.title`, `console.notFound.description`), as the internal `/forms/NAME` route does. There is no Go back button on this route: the visitor is a guest from a shared link, with no console page to return to.
- **Every other failure keeps a banner, localized.** It reads the existing `form.errorLoading` key ("Error loading form"). The server's body is never read, so it cannot reach the page.
- No i18n key is added or changed.
