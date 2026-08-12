---
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
"@objectstack/spec": patch
---

fix(runtime): refuse to disable or delete a read-only package on the `/packages` lifecycle routes (#7560)

`PATCH /packages/<id>/disable` and `DELETE /packages/<id>` answered **200** on a
platform package, and the `DELETE` really removed it from the running process's
registry listing. One authorized API call took platform functionality out of a
live deployment. Reproduced on two platform packages in the QA run behind #7514.

**Blast radius, measured.** The card reported that the packages come back after a
restart — true for `DELETE` (they are code-loaded, so nothing is permanently
destroyed), but **not** for `disable`: `setPackageDisabled` persists the choice
to `<OS_HOME>/package-state/<env>.json`, which `SchemaRegistry` replays at boot.
A disabled platform package stayed disabled across restarts.

**Two axes, not one.** #7033 / PR #7083 gave the whole `/packages` domain caller
authorization (`manage_metadata` on writes, the ADR-0106 D4 set on reads, an
anonymous floor) — *who may call the route*. This is the second, missing check
on the same routes: *what the route may do once the caller is allowed*. An
authorized admin — and `isSystem` — is now refused, because read-only is a
property of the **package**, not of the caller. The caller gate is unchanged;
tightening it would not have fixed this and would have broken legitimate admins.

**No new vocabulary.** The refusal is ADR-0070's existing one, reused: `422` /
`WRITABLE_PACKAGE_REQUIRED`, the code `saveMetaItem` already throws when asked to
author *into* a read-only package. The predicate behind it moved out of
`ObjectStackProtocolImplementation`'s private method into
`@objectstack/metadata-protocol`'s exported `isWritablePackage(engine, id)` and
is now **referenced** by both callers — a second hand-kept copy of "which
packages are read-only" is exactly the drift that let `DELETE` remove a platform
package while `saveMetaItem` was refusing to add one field to it. Both read-only
signals are covered: a booted code package (`engine.manifests`) and a
platform-delivered manifest `scope` of `system` / `cloud`.

Packages an org owns (project-scoped bases, ADR-0048 authoring workspaces) still
disable, re-enable and delete exactly as before — pinned in both directions, on
the registry listing rather than on the status code, since the listing is where
the original defect's harm actually showed.
