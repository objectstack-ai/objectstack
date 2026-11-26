---
'@object-ui/app-shell': patch
'@object-ui/layout': patch
'@object-ui/console': patch
---

fix(app-shell): a full-height console page gives the impersonation banner its height back

Clause-②: no
Metadata-protocol: none

- While an administrator impersonates a user, the console draws its banner above the page. Where it is drawn in place (every page on a phone, and Studio, Home and the organization pages on a desktop) the page below still took the whole viewport, so the document was taller than the window by the banner's height: a list's footer and bulk action bar sat below the fold and the page gained a second scrollbar. The same held for the read-rate and storage banners beside it.
- The banners drawn in place now publish their height as the CSS custom property `--os-chrome-banners` on the document root, and the console's full-height shells take the viewport less it: `AppShell` (`@object-ui/layout`, whose sidebar wrapper's own minimum height is overridden to match), Studio and its access-required screen, Home, the AI chat page, the organization layouts and the app-unavailable and no-app screens. While no banner is drawn in place, and anywhere outside the console, the property is unset and every shell keeps its viewport height. Inside an app on a desktop the banners are drawn into the content area, as before, and publish nothing.
