---
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

feat(app-shell,i18n): the Console draws the install refusal `DEPENDENCY_MISSING` in the author's terms, one line per unmet dependency

Clause-②: no
Metadata-protocol: none

ADR-0141 D2 refuses to install a package whose declared `dependencies` the environment does not satisfy (`422 DEPENDENCY_MISSING`, `details.unmet[]` naming each entry's `dependency`, `range`, what was `found` and the `installedVersion`). The Console showed the envelope's English sentence, the same in every locale and without the ranges.

- **`@object-ui/app-shell`:** the three install surfaces that go through `install-local` (the package page's Install, the catalog page's organization install on a self-hosted runtime, and Setup → Packages → Import) draw the refusal from its facts: a heading saying nothing was installed, then one line per unmet entry, such as 「请先安装 app.objectstack.hotcrm 6.x。」 or "Install com.acme.billing ^2.1.0 first. Version 1.4.0 is installed." `installLocal()` now carries the envelope's `details` on the error it throws, and the Packages page's request helper carries `code` and `details`. A refusal whose facts the Console cannot read in full (an older runtime, or a `found` value it does not know) keeps the server's message.
- **`@object-ui/i18n`:** `marketplace.install.dependencyMissing.*` (a heading and one line for each `found` value) in all ten locale packs.

What to do: nothing.
