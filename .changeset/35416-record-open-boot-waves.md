---
'@object-ui/app-shell': patch
---

perf(console): a full-page record open asks its page list and object scope beside the permission read, and the app bar's package list after the page

Clause-②: no
Metadata-protocol: none

Opening a record page by its URL (a reload, a pasted link) waited one more round trip than it needed to, and shared the link with the largest response an app page reads:

- The console root's prefetch (`useAppObjectScopePrefetch`) now starts a record route's page list (`/meta/page`) and, under the same rule `AppContent` follows, the app package's object list, as soon as the app list names the app. Before, both left only once `AppContent` mounted, which is after `/auth/me/permissions` answers.
- `fetchSessionPackages` (the read behind the app bar's and the sidebar's Studio entries) waits until the page's own requests have stayed quiet for 750 ms (at most 8 s) before it reads `GET /api/v1/packages`, so that response no longer downloads beside the record. The entries it gates stay absent until it answers, as they already did while it was on the wire. Studio's own package reads are unchanged.
- New `whenQuiet(quietMs, maxMs)` in the settle signal; it resolves at once where no data layer counts requests.
