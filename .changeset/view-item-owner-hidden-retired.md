---
'@objectstack/spec': minor
---

feat(spec)!: retire the view item's `owner` and `hidden` keys — declared, stored, and read by nothing (#20085)

**BREAKING** — `owner` and `hidden` are removed from the view item
(`defineViewItem`, `ViewItemSchema`, and the `view` metadata door's ViewItem
record `{ name, object, viewKind, config }`). ADR-0049 enforce-or-remove; triage
direction, verbatim: 「retire both keys」.

Both keys were accepted by the strict authoring door and by the wire member the
`PUT /api/v1/meta/view` door validates, and `saveMetaItem` stored them verbatim —
but nothing ever read or wrote either. Measured before removal, each against a
lit control: no reader or writer of the view-item keys in the framework, in
objectui at its pinned commit and at `main`, or in cloud. Both view-switcher read
paths (`GET /meta/view?object=` and `getViewsByObject`) filter on `viewKind` +
`object` and sort on `order`. So `hidden: true` hid nothing, and a view with
`owner` set was listed for every user who can read the object. The `owner` half
was a visibility claim nothing enforced, which is the security shape ADR-0049 is
about. Per-user view scoping is a parked direction (ADR-0017, amended
2026-09-04), not a shipped mechanism.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| view item `owner` | delete the key. Nothing restricts a view item to one user today; a view item is visible to everyone who can read its object. |
| view item `hidden` | delete the key. To take a view out of the switcher, delete the view item (or stop shipping it from source). |

**The one-line fix: delete `owner:` and `hidden:` from every view item.**
`os migrate meta --from 17` lists the mechanical edits for existing sources.

⚠️ Runtime behaviour is deliberately **unchanged**. Neither key ever changed what
a view showed or to whom, so removing one removes no behaviour. What changes is
the answer an author gets: a view item carrying either key is now refused at
parse, with a prescription, instead of being saved with no effect.

### The retirement kit

- **Tombstones, on the shared shape.** Both keys are `retiredKey()` tombstones on
  the view-item base shape. That shape feeds two doors: the strict authoring door
  (`ViewItemSchema`) and the `.strip()` wire member (`ViewItemWireSchema`, which
  the `view` write door and the assembled-manifest `viewItems` channel both run).
  A bare deletion there would have been a silent strip (ADR-0104), so one
  tombstone serves both: `tsc` types the key `never` on `defineViewItem`'s input,
  and every parse raises the prescription.
- **D2 conversion `view-item-owner-hidden-removed`** (step 18, retired from the
  load path). It strips both keys from the view item **record** spelling as a
  lossless delete, in both collections a record travels in: `views` (stack
  sources, and stored `sys_metadata` rows, which the rehydration seam replays as
  `{ views: [row] }`) and the assembled-manifest `viewItems` channel (package
  export and environment artifacts). Without the second, an artifact assembled
  before this release would fail its registration parse.
- **`RETIRED_KEYS_BY_MAJOR[18]`**: `ui/ViewItem:owner`, `ui/ViewItem:hidden`,
  `ui/ViewItemWire:owner`, `ui/ViewItemWire:hidden`.
- **No liveness row, and no authorable-surface line.** Both instruments read a
  def's top-level `properties`, and `ViewItem` / `ViewItemWire` are
  discriminated unions that have none. So the four surface ratchets stay
  byte-identical on this retirement, and that reading is expected on this route.
- **No deprecation window**, per the project's startup-stage posture.

**The flattened-overlay members' own `owner` / `hidden` are a separate entry.**
Those two members of the `view` door (a lean personalization PUT carrying no
`config`) declare the same names on a different door, which this change does not
touch, and this conversion leaves overlays alone. They are retired in this same
release by their own changeset and their own conversion,
`view-overlay-owner-hidden-removed`, with the same prescription texts — so after
this release a `{ object, viewKind, hidden: true }` overlay is refused too.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec`
is published, so this is breaking for consumers no telemetry was consulted for.

Clause-②: no

<!-- adr-0087: registered view-item-owner-hidden-removed -->
