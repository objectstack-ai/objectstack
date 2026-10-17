---
'@objectstack/spec': minor
---

feat(spec)!: retire `page:header` `showStar` — the follow-star switch the reference console no longer draws (#23650)

**BREAKING** — `showStar` on a `page:header` component (`PageHeaderProps`) is now refused. Since objectui#12427 the header's record chip draws the follow star only where the host wires a favorites toggle into the record context, and the reference console wires none: the record's favorites entry is the header's ⋯ menu. So `showStar: true` (the default) drew nothing and `showStar: false` hid nothing. Delete the key; the ⋯ menu's favorites entry is unchanged, and metadata does not control it.

Clause-②: no (narrowing)

Measured before removal, at `140238a47`: no producer. No example app, skill, doc or package source in this repository authors the key outside the spec's own schema and tests, and neither does any app or example in objectui at the pinned `f96f771140f1`.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `showStar: true` or `showStar: false` in a `page:header`'s `properties` | nothing — delete the key; the record's favorites entry is the header's ⋯ menu |

**The one-line fix:** delete `showStar` from every `page:header`.

**What an author who still writes it sees.** `tsc` fails at a typed authoring site (`PageHeaderProps` types the key as retired), and `os validate`, `os build` and `os lint` refuse it as an `error` (`component-props-invalid`) at its own path with the prescription:

> `page:header` property `showStar` was removed in @objectstack/spec 18 (ADR-0087 D2) — the reference console draws no star beside the record title, so the key switched nothing: the record's favorites entry is the header's ⋯ menu, and metadata does not control it. Delete the key, whether it was `true` or `false`; the ⋯ menu's favorites entry is unchanged. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

A page's own parse keeps its component `properties` as an open bag, so an existing page carrying the key is never refused at load.

## The retirement kit

- **A `retiredKey()` tombstone** on `PageHeaderProps`, a `strictObject`, beside the `icon` and `breadcrumb` this row lost before it. `RETIRED_KEYS_BY_MAJOR[18]`: `ui/PageHeaderProps:showStar`. The authorable-surface row reads `[RETIRED]`, and the `showStar = true` default leaves the defaults baseline.
- **The D2 conversion `page-header-show-star-removed`** (protocol 18, retired from the load path) deletes the key from every `page:header` — region-level, nested in a container's `children`, and in a slotted page's named slot — `true` and `false` alike, one notice per header, as a lossless delete. It is scoped by component `type`: the same key name on another component is left alone.
- **The D3 entry `page-header-show-star-retired`** records the one case the conversion cannot decide: a host of your own that wires the favorites toggle now draws its star on every record header, a header that said `false` included.
- **No deprecation window**, per the project's startup-stage posture.

**Not part of it:** the record context's favorites hook in the published objectui component library (`onToggleFavorite`) stays — this removes the metadata switch, not the host hook. The renderer's read of the key leaves on the objectui side.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered page-header-show-star-removed, page-header-show-star-retired -->
