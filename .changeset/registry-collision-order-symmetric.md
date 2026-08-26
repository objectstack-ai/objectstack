---
'@objectstack/objectql': patch
---

fix(objectql): the `[Registry] Collision` warning fires in the cold-boot order too (#12027)

The artifact-vs-DB collision warning was order-asymmetric, and silent in the
order a kernel boot actually produces. It was guarded on `packageId &&`, so it
spoke only when the PACKAGE registered second — but the artifact reaches the
registry in kernel Phase 1 (`AppPlugin.init` -> `manifest.register`) and the
`sys_metadata` overlay is rehydrated in Phase 2 (`ObjectQLPlugin.start` ->
`loadMetaFromDb`), under the bare name with no package id. The kernel runs
init-all then start-all, so at boot the overlay is ALWAYS the second arrival —
the exact order the guard excluded. The direction that did warn is the
late-registration one: a marketplace install, a post-`start()`
`manifest.register`, an HMR reload.

The consequence is worse than a missing line, because the mechanism looked
sound to anyone who had seen it work: ADR-0005 says this warning is what makes
the silent shadowing "discoverable in startup logs", and in the only order
startup produces it was not discoverable at all. Measured on a real
`@objectstack/example-crm` boot before the fix: one stored `view` overlay of a
packaged view produced 0 collision lines and 4 silent shadowings (the container
plus its three expanded ViewItems).

The cold-boot direction now warns with its own message rather than a widened
version of the existing one. Both orders end in the same state — the runtime
row wins either way — but the event differs, and the event is what an operator
acts on: a package that is dead on arrival behind a row that predates it,
versus a stored row taking over a definition this process just loaded from
code. Which definition wins is unchanged in both orders, and pinned as such.

Graded `patch`: this adds a diagnostic to a path that printed nothing. No API
changes, no accept/reject behaviour changes, and resolution order is untouched.
The one operator-visible effect worth stating is the log itself — a deployment
that customizes packaged metadata will see one new `[Registry] Collision` line
per shadowed name per process, where it previously saw none. Volume was
measured rather than assumed: 0 lines on a stock boot (a stock `sys_metadata`
holds no overlay of a packaged name), and the line marks the transition into
the bare slot rather than the state, so the read-side hydration and the
write-through do not re-emit it on later reads and writes.
