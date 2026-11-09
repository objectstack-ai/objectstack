---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix(runtime, metadata-protocol): the permission-set clone door copies a platform set whose grants name an object this deployment does not install — `member_default` copies into its package's customization pair again on a boot without `@objectstack/plugin-audit`

Clause-②: yes (widening) — `ObjectStackProtocolImplementation.saveMetaItem`'s request gains one optional key, `inheritedGrantObjects`, reachable from `@objectstack/metadata-protocol`'s `.` entry types
Metadata-protocol: none

- **What failed:** cloning a set through `POST /api/v1/security/permission-sets/:name/clone` answered `422 INVALID_METADATA` when the source grants on an object no package registers here. The commonest source is the platform baseline `member_default`, which grants `sys_comment` and `sys_activity`. `@objectstack/plugin-audit` registers both objects, and it is an optional package: a deployment that does not install it could not clone `member_default` at all.
- **The rule it now follows:** the save door's unknown-grant refusal (#28990) already leaves alone a grant the set itself already holds, because that grant is not the current write's. A clone's grants are the source's, copied verbatim, so the same holds for a copy. The clone door now tells the save which grant keys the copy inherits (`inheritedGrantObjects`), and the refusal does not judge those.
- **Still refused:** an unknown object that the save does not say it inherits is this write's grant, and is refused exactly as before. That covers a `/meta` save, a re-save that adds a grant, and a draft's publish. No HTTP door forwards the new key.
