---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): after a reload, the package page still says how many sample records a purge would delete

Clause-②: no
Metadata-protocol: none

- **The count on any visit.** The package page of a local install now reads the runtime's count of the sample rows a purge would delete right now (`GET /api/v1/marketplace/install-local/:manifestId/sample-data`), on every visit and again after an install, a reseed or a purge. Before, the purge confirm and the banner that follows the installer to the app knew a count only for an install made in the same browser session; a reload lost it.
- **The confirm.** The local purge confirm draws that count. When it cannot be read (refused, failed), it draws the count this session's install answered, as before. A read that began before an install, reseed or purge of this session answered is older than that answer and is not used.
- **The banner.** A count above zero raises the sample-data banner on leaving the page, as an install of this session does. A count of `0` drops what the session knew: no banner, and no count line in the confirm.
- **Types.** `marketplaceApi` gains `countLocalSampleData` and `LocalSampleDataCount`.
- **Strings.** `@object-ui/i18n` rewords `marketplace.detail.purgeConfirmAtMost` (all plural forms) in all 10 locales: it no longer says the count is "the number this install loaded", which is not what the runtime's count is. It stays an upper bound ("Up to N sample records will be deleted."), true of both counts. No key is added.
