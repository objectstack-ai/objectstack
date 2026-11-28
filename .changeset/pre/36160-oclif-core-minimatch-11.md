---
'@objectstack/cli': patch
---

build(cli): `@objectstack/cli` now declares `@oclif/core` `^5.1.12`, the first release on the 5.1 line that depends on minimatch 11

Clause-②: no
Metadata-protocol: none

The previous `^5.1.2` range admitted `@oclif/core` releases that depend on minimatch 10, which GHSA-g3hv-75wg-m249 (a potential denial of service through glob-part amplification) affects up to 11.0.1. An install that resolves the CLI fresh already picks a newer 5.1 release; the raised floor keeps a lockfile that still holds an older one from satisfying the range. No command, flag or output changes.

Nothing to migrate.
