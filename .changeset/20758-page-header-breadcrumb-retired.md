---
'@objectstack/spec': minor
---

feat(spec)!: retire a page header's `breadcrumb` switch — no renderer ever drew a trail for it (#20758)

**BREAKING** — `breadcrumb` on a `page:header` component (`PageHeaderProps`) is retired, with its `true` default: no renderer ever drew a trail for it. objectui drew an empty slot that nothing filled, and the console draws the navigation trail once, in the app shell's header. Delete the key, whether it was `true` or `false`. The shell's trail is unchanged.

Clause-②: no (narrowing)

Measured before removal: objectui's `PageHeaderRenderer` reads the key only to draw an empty `div[data-page-breadcrumb-slot]`, and nothing fills it. The one producer is objectui's Studio page-block inspector ("Show breadcrumb"), so stored pages may carry either value. The one in-repo author found was the published `objectstack-ui` skill's record-page example. No example app authors it. The `nav:breadcrumb` component type is not part of this retirement: the Studio page palette still offers it.

## FROM → TO

| you wrote (17.5 and earlier) | write instead |
| --- | --- |
| `{ type: 'page:header', properties: { title, breadcrumb: true } }` | `{ type: 'page:header', properties: { title } }` |
| `{ type: 'page:header', properties: { title, breadcrumb: false } }` | `{ type: 'page:header', properties: { title } }` |

**The one-line fix:** delete `breadcrumb` from every `page:header`'s `properties`.

**What an author who still writes it sees.** A page is never refused for it. A page component's `properties` is an open bag, so `definePage()`, `defineStack({ pages })` and the page write door accept the page as before. `os validate` / `os build` / `os lint` report the key as a warning at `properties.breadcrumb`, with the prescription:

> `page:header` property `breadcrumb` was removed in @objectstack/spec 17 (ADR-0087 D2) — no renderer ever drew a trail for it: objectui drew an empty slot and nothing filled it, and the navigation trail is drawn once, by the app shell's header. Delete the key, whether it was `true` or `false`; the shell's trail is unchanged. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.

A typed `PageHeaderProps` input fails `tsc` at the key.

## The retirement kit

- **A `retiredKey()` tombstone** on `PageHeaderProps`, a `strictObject`, beside the `icon` that row lost at 17. `RETIRED_KEYS_BY_MAJOR[18]`: `ui/PageHeaderProps:breadcrumb`. No retired-default residue stage is owed: the `true` default was never written into a built artifact, because a page parses its component `properties` as an open bag and only the advisory props lint reads this row.
- **The D2 conversion `page-header-breadcrumb-removed`** (protocol 18, retired from the load path) deletes the key from every `page:header`, `true` and `false` alike, with one notice per header. It reaches headers in regions, nested in a container's `children`, and in a slotted page's named slots. A stored `page` row or a built artifact that carries the key loads through the rehydration seams, which replay it.
- **The D3 entry `page-header-breadcrumb-retired`**: a header that said `false` reads as absent after the strip, so it shows the empty slot's spacing again until the renderer stops drawing the slot.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered page-header-breadcrumb-removed, page-header-breadcrumb-retired -->
