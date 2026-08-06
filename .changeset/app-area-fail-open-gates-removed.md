---
'@objectstack/spec': major
---

feat(spec)!: retire the two fail-open app-area gates — `app.areas[].visible` and `app.areas[].requiredPermissions` (#4651)

These were **not** inert authoring keys. They were capability gates that **failed
open**: an author wrote `requiredPermissions: ['sales.admin']` on a navigation
area, got a clean parse and a stored value, and the area — with everything under
it — was served and rendered to **every user**.

**This is a breaking change with a real migration.** Both keys are authorable
metadata keys on a `.strict()` schema, so existing `app` metadata that declares
either one now **fails to parse** with the prescription below. `authorable-surface.json`
is net **−2 keys**. This is not the "zero metadata migration" shape of the
same-window renames (#4661 C8, #4684 C9) — those kept every key.

**The retirement kit:**

| FROM | TO | Fix |
|---|---|---|
| `app.areas[].requiredPermissions` | *(removed)* | Delete the key. Gate each of the area's `navigation` items with `requiredPermissions` / `requiresService`, or gate the whole app with `requiredPermissions` on the AppSchema. |
| `app.areas[].visible` | *(removed)* | Delete the key. Move the same CEL expression onto the area's `navigation` items — a navigation **item**'s `visible` is evaluated per item by the shell. |

The retired alias spellings `visibleWhen` / `visibleOn` / `permissions` carry the
same prescriptions rather than renaming onto keys that are themselves gone.

Run `os migrate meta --from 16` to rewrite existing sources automatically
(ADR-0087 D2 conversion `app-area-fail-open-gates-removed`, wired into the
protocol-17 D3 chain step).

**Why they read alive — and why that made them worse than dead.** The *same key
names* are genuinely enforced one level up and one level down:

- **app-level** `requiredPermissions` — server-side: an app whose required
  permissions the caller lacks is dropped from `/meta` entirely;
- **item-level** `requiredPermissions` / `requiresService` — stripped server-side
  from the app's top-level `navigation` tree, and re-checked in the shell;
  item-level `visible` is a real CEL gate in the shell.

Three layers, of which the middle one was theatre — at the time of the
retirement `filterAppForUser` read the app's `requiredPermissions` and then
walked **only** `item.navigation`; it never touched `item.areas`, and the client
rendered every area in the switcher. ADR-0078 false compliance, the same shape as
`capabilities.readOnly` (#4583).

**Removed rather than enforced (ADR-0049), deliberately.** Enforcing area gates
is not wrong, it is unscoped: it needs semantics settled first — when an area is
filtered out, do its items disappear everywhere, or still participate in other
areas? does the server bind `user` for area-level CEL? — and a retirement must
not invent an authorization mechanism. Removing a gate that never gated is
strictly safer than shipping a major with it still declared, which would have
kept authors writing it for all of 17.x.

**The caveat this prescription used to carry is closed — in this same major.**
It read: per-item gating *inside* an area is enforced by the shell only, because
the server does not walk `areas`. #4722 landed inside the 17.0.0 window and made
that false: `filterAppForUser` now runs the **same** `filterNav` over every
`areas[].navigation`, so an **item**'s `requiredPermissions` / `requiresService`
is stripped server-side in **both** trees and a gated entry never ships in the
`/meta` body. So the retirement kit's advice needs no navigation restructuring —
gating the items of the area you already have is server-enforced.

Read that as the boundary closing, **not** as the area-level keys coming back.
They stay retired; #4722 gave an area no gate of its own, it enforces the items
inside one. And the other half of the asymmetry is unchanged, which is why
`requiredPermissions` is the key to reach for: `visible` (CEL) and
`requiresObject` are still evaluated client-side **only** at every level —
server-side CEL needs a bound `user` context the read layer does not have. So
anything that must never reach the browser goes in `requiredPermissions`, never
in `visible`. Trading one false belief for a weaker one would have repeated the
defect this removal exists to end.
