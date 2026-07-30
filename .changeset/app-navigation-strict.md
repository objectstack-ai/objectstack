---
"@objectstack/spec": major
"@objectstack/platform-objects": patch
---

feat(spec)!: reject unknown keys across the app shell and navigation tree (#4001 app step, PR B)

Closes the last high-traffic authorable surface in the unknown-key strictness
ratchet (flow + permission #4071, RLS / sharing / position #4099, approval
#4119, App dead-key tombstones #4142). The app shell is the densest
hand-authored surface on the platform — a navigation tree is where an author
or AI is most likely to write a key from memory — so a silent strip here was
the most probable instance of the #3405 trap.

- **`AppSchema`** and its sub-schemas (`AppBrandingSchema`,
  `NavigationAreaSchema`, `AppContextSelectorSchema` + its `optionsSource` /
  `filter` blocks, `NavigationContributionSchema`) are `.strict()`.
- **`NavigationItemSchema` becomes a DISCRIMINATED union on `type`.** This is
  what makes strict readable: a plain union of strict members answers one
  unknown key with an `invalid_union` aggregate naming all nine branches,
  while discriminating on `type` first yields a single `unrecognized_keys`
  issue against the branch the author actually wrote — at an exact path
  through nested `children` — and a mistyped `type` gets its own "Invalid
  discriminator value". Each variant carries its own suggestion pool, so a
  `url` item is never told about `dashboardName`.
- **Still OPEN by design:** `PageNavItem.params`, `ComponentNavItem.params`
  and `ActionNavItem.actionDef.params` — per-target payloads owned by the
  page / component / action, not by the nav item.

**A real defect the gate caught, in the platform's own app:** `ACCOUNT_APP`
declared `defaultOpen` on three navigation groups. That was never a schema
key — `expanded` is — so all three shipped COLLAPSED while their author
believed they opened by default. Fixed at the producer (contract-first) and
`defaultOpen` / `open` / `collapsed` / `isOpen` now alias to `expanded`.

**Migration.** Any key now rejected was previously stripped and had no
runtime effect. The error carries the fix; mappings include
`menu`/`sidebar`/`tabs`/`items` → `navigation`, `title` → `label`,
`permissions` → `requiredPermissions`, `sort`/`position` → `order`,
`defaultOpen` → `expanded`, `args` → `params` (actionDef), `primary` →
`primaryColor`, `url` → `endpoint` (options source), plus wrong-layer
pointers: `pages`/`views`/`flows` are not App fields, and a payload named on
the wrong variant points at the `type` that owns it.

The `visibleWhen` → `visible` alias is the load-bearing one: ADR-0089 made
`visibleWhen` canonical on view/page schemas, so an author who learned it
there would silently lose a nav entry's visibility gate — a capability gate
failing open, the worst shape of the silent-strip bug.
