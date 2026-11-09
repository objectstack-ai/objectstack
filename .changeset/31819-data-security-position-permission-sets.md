---
'@objectstack/skills': patch
---

docs(skills): objectstack-data `security.md` teaches how a package's position resolves the permission sets it names

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/security.md`, section "Positions grant only what they name", now states the rule the security catalog enforces since ADR-0150 E3: a package's position reads each `permissionSets` name as its own package's set, else the one holder in its declared `dependencies` closure plus `sys`. Otherwise the name is refused. Two refusals are taught, each with an example: `outside-closure` (only a package the position's package does not depend on holds the set, or only the environment does, such as a set authored in Setup) and `ambiguous-in-closure` (two holders it reaches; a second package shipping a set name is already refused at install). A refused name still loads; the boot's catalog reference report logs it with every candidate, and the position grants nothing through that name while its other sets still grant. Stored grants, environment-authored positions, administrator overlays of a package position and the `everyone`/`guest` anchors still resolve across the whole environment. `evals/hooks-security-seeds-datasources.json` gains case 19, which requires the position's `permissionSets` entry plus a manifest `dependencies` entry on the set's package and refuses redeclaring the set in the position's package.

The file sat 16 bytes under its token ceiling. One restatement is cut in the same file: the `secret` paragraph's "**Fail-closed:** with no crypto provider, writes throw rather than persist cleartext." (86 B), which survives as "fail-closed (ADR-0100)" in the `secret` row of `rules/field-types.md`. The remainder raises the ceiling under standing ruling 6513306068, letter B: 「A:先削重复,余额按实测提高」. The file goes from 15056 to 15834 bytes, and the ceiling from 3768 to 3959 tokens, pinned at the measurement.
