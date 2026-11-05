---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the install result says when a package was installed without a protocol compatibility check

Clause-②: yes (widening)
Metadata-protocol: none

- **What the administrator now reads.** `POST /api/v1/marketplace/install-local` answers `data.protocolCheckSkipped` when its protocol handshake admitted the package without checking it: the package declares no `engines.protocol` (`no-range`), or a range the runtime cannot read (`unparsed-range`). The three Console surfaces that show an install result now draw it as a caution line under the success sentence: the package page's Install result, the catalog's organization install message, and Setup → Packages → Import. The line names the package, the platform protocol it was installed under and, for `unparsed-range`, the range it declared, in the reader's locale. A `reason` this Console does not know shows the server's own `message`. An install whose range was checked shows nothing new.
- **Types.** `LocalManagedInstallResult` and `LocalUnmanagedInstallResult` gain the optional `protocolCheckSkipped`.
- **New strings.** `@object-ui/i18n` gains `marketplace.install.protocolCheckSkipped.noRange` and `.unparsedRange` in all 10 locales.
