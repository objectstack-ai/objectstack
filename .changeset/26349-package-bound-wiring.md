---
'@object-ui/app-shell': patch
---

fix(app-shell): the permission editor tells the delegated-admin companion list whether it edits under a package, instead of the list guessing from its presentation

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`:** `PermissionMatrixEditPage` now passes `packageBound={!!packageId}` to `PermissionAdvancedFacets` at both of its mounts (Setup's stacked page and the Studio Access pillar's tabs). The facet's `packageBound` prop defaults to `false` and no longer reads its value from `only`, which picks a presentation, not a binding. What an author sees does not change today: the Studio Access pillar always edits under a package and Setup's permission page never does. A host that sets one without the other now gets the face that matches its binding: under a package the companion grants are listed unmarked with the package note, otherwise they are marked with the one-click grant.

What to do: nothing.
