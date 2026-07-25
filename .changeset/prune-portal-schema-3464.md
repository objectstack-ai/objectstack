---
"@objectstack/spec": minor
---

feat(spec)!: remove the dead PortalSchema (portal metadata was never enforced)

`PortalSchema` and its top-level `portals` collection on `StackSchema` were a
forward-looking design that was **never wired to a runtime** — no metadata-type
registration, no dispatcher route family, no auth scope, and no
LayoutDispatcher / NavigationBuilder / ThemeProvider ever consumed it. Authoring
a portal was already documented as a no-op and marked
`[EXPERIMENTAL — not enforced]`. This removes the dead schema rather than
building a portal runtime (issue #3464, disposition **A — prune**).

**Removed exports** (`@objectstack/spec`, from `ui/portal.zod`):
`PortalSchema`, `Portal`, `definePortal`, and the `PortalInput` /
`PortalTheme` / `PortalNavItem` (+ `PortalViewNavItem`, `PortalActionNavItem`,
`PortalDashboardNavItem`, `PortalUrlNavItem`) / `PortalAnonymousEntry` /
`PortalAnonymousRoute` / `PortalRateLimit` / `PortalSeo` / `PortalAuthMode` /
`PortalLayout` schemas and inferred types. The `portals` key is removed from
`StackSchema` / `defineStack()`.

**Migration**: none required for behavior — authoring a portal had no runtime
effect. Any `portals: [...]` entry in a `defineStack()` config was already
ignored at runtime and should be deleted (with the schema gone it is an
excess-property type error). To project a scoped UI to external users today,
compose the existing `apps` / `views` surfaces and gate admission with
`positions` + permission sets (`externalSharingModel` on the objects you
expose).

Refs #3464, #1893, #1878.
