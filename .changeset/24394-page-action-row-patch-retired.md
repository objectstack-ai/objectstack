---
'@objectstack/spec': minor
---

feat(spec)!: retire a page action row's own `patch` — a row's `operation: 'update'` runs the declared action its `name` names, and the platform action route writes that action's `patch` (#24394)

**BREAKING** — `patch` on a page action row (`action:button`, `action:icon`, and each `action:group` / `action:menu` member of `properties.actions`) is now refused. A row's `operation: 'update'` posts to the platform action route under the row's `name`. The route resolves that declared action by name and writes the action's own `patch`, merged under the request's params. The row's `patch` was never sent: the reference console read it only for its Undo snapshot. Beside `operation: 'update'` a row now needs a `name`, since without one it has no declared action to run and the console refused it before any request. A row's static `params` are written only where that action declares them, and the route refuses any other with a 400 (ADR-0104 D2). `ActionSchema.patch`, the action's own declaration, is unchanged.

Clause-②: yes (narrowing)

Both directions, measured on the built rows. Narrowing: every row `patch` is refused, and a row with `operation: 'update'` and no `name` (an input list or static `params` included) is refused at `name`. Widening: a row with `operation: 'update'` and a `name` but no `patch` and no `params` now parses; before, the rows refused it at `patch` as having nothing to write, though its write is the named action's `patch`.

Measured before removal, at `71fa166e96`: no producer. No page action row in this repository's examples or apps authors `patch` (or any `operation`), and neither does any objectui page row at the pinned `0707b4ae37` or at objectui `main` `4b7ce47`.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `operation: 'update'` with a `patch` on a page action row | the values in the `patch` of the declared action the row's `name` names (`defineAction({ name, operation: 'update', patch })`), the row keeping only `operation: 'update'` and that `name` |
| `patch` on a page action row with no `operation` | nothing — delete the key; it was already refused |
| `operation: 'update'` on a page action row with no `name` | a `name` naming the declared `operation: 'update'` action |

**The one-line fix:** move each row's `patch` values onto the declared action its `name` names, then delete the row's `patch`.

**What an author who still writes it sees.** `tsc` fails at a typed authoring site (the rows type the key as retired), and `os validate`, `os build` and `os lint` refuse it as an `error` (`component-props-invalid`) at its own path (`properties.patch`, `properties.actions.N.patch`) with the prescription:

> An `action:button`'s `patch` was removed in @objectstack/spec 18 (ADR-0110 D2) — a page action row's `operation: 'update'` runs the declared action its `name` names, and the platform action route resolves that action by name and writes ITS `patch`, so the row's own `patch` was never sent and never written. Move the values into the `patch` of the action the row's `name` names, then delete the key. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

A page's own parse keeps its component `properties` as an open bag, so an existing page carrying the key is never refused at load.

## The retirement kit

- **A `retiredKey()` tombstone** at `patch` on `ActionButtonProps`, `ActionIconProps` and the `action:group` / `action:menu` member. `RETIRED_KEYS_BY_MAJOR[18]`: `ui/ActionButtonProps:patch`, `ui/ActionIconProps:patch` (the member's keys have no surface row of their own). The authorable-surface rows read `[RETIRED]`.
- **The rows' half of the declarative-update judge** reads the row's own surface: a row has no "`patch` without `operation`" rule of its own (its tombstone refuses every `patch`), and its "nothing to write" rule asks for the `name`. `ActionSchema`'s half of every rule, and every text it prints, is unchanged.
- **The D2 conversion `page-action-row-patch-removed`** (protocol 18, retired from the load path) deletes the key from every node and member — region-level, nested in a container's `children`, and in a slotted page's named slot — one notice per row. It is scoped by component `type`: the same key name on another component is left alone.
- **The D3 entry `ui-page-action-row-patch-retired`** records the judgement the strip cannot make: when the named action's own `patch` lacks a value the row carried, that value was never written, and adding it to the action changes what the action writes.
- **No deprecation window**, per the project's startup-stage posture.

**Not part of it:** objectui's renderers still forward the row's `patch`, its runner still reads it for the Undo snapshot, and its component registry still lists a `patch` input on `action:button` / `action:icon` (so the tracked `sdui.manifest.json` advertises it to the html-tier page gate until the pin moves). Those reads leave on the objectui side.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered page-action-row-patch-removed, ui-page-action-row-patch-retired -->
