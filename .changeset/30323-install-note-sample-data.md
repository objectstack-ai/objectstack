---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the install note says how many sample records an install loaded, and clears them in place

Clause-②: no
Metadata-protocol: none

- **The install note.** After an install into this runtime, the package page's result now says how many sample records the install loaded, read from the install answer's own `data.seeded` report (`inserted + updated + skipped` of an `inline` run), with a "Purge sample data" button right there. An install over an existing one adds that installing again loads the sample data again, including any that was cleared. An install that loaded none (no seed datasets, a copy, a walled session with no active organization) shows nothing new. The success sentence is definite where the runtime answered that it loaded the app: "… is now in the app switcher."
- **The console's own confirm.** Purging sample data (from the install note, or the ⋯ menu, local or cloud) asks in the console's dialog instead of the browser's. When this session installed the package, the dialog says how many sample records will go at most: the number the install loaded. The clearing rule is unchanged: only rows that carry a seed record's key are deleted.
- **A reach from the app's own pages.** When the installer leaves the package page, a console banner (the `banner` notification `ConsoleLayout` draws above every page) says the app holds sample data, with a "Purge sample data" action that brings them back to the package page with the confirm open. Clearing withdraws it. It lasts for the console session; the runtime serves no count of sample rows after the install answer.
- **Types.** `LocalManagedInstallResult` and `LocalUnmanagedInstallResult` gain the optional `seeded` (`LocalInstallSeeded`).
- **Strings.** `@object-ui/i18n` gains `marketplace.detail.sampleDataLoaded`, `sampleDataReloaded`, `purgeConfirmAtMost` (count families), `sampleDataBannerTitle` and `sampleDataBannerMessage` in all 10 locales, and rewords `marketplace.install.localSuccess` in all 10.
