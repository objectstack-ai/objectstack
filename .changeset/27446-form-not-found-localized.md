---
'@object-ui/console': patch
---

fix(console): `/forms/NAME` for a form that does not exist renders the console's localized not-found state, not a raw English error (#27446)

Clause-②: no
Metadata-protocol: none

The internal form route threw `Form metadata not found: view/NAME` for any failed `/meta/view` read, and the page rendered that English text verbatim, whatever the session language.

- **A 404 is "no such form".** The page now draws the console's shared not-found state, with the catch-all route's pack keys (`console.notFound.title`, `console.notFound.description`, `console.notFound.back`) in the session language, and a Go back button. The metadata route answers 404 both for a missing view and for one the caller may not read, so the page says the one thing both mean.
- **Every other failure keeps the error banner.** A non-404 failure now says `Could not load form metadata (STATUS): view/NAME`, instead of claiming the form was not found.
- No i18n key is added or changed. The public `/f/:slug` route is unchanged.
