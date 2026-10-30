---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): New Package asks only for a name; the package ID, namespace, version and type sit behind Advanced

Clause-②: no
Metadata-protocol: none

The New Package dialog (Home → New → New Package, and Packages → New Package) used to open on a reverse-domain package ID, an object namespace, a SemVer version and a package type, all up front. Its first step now holds the display name and the optional description. The ID and namespace are still filled in from the name, and a line under the name says what they will be. The four technical fields sit in a collapsed **Advanced** section, where they stay editable; it opens by itself when one of them is what keeps **Create package** disabled, for example a name with no Latin letters to make an ID from. The dialog's description no longer explains reverse-domain IDs. Editing an existing package is unchanged.
