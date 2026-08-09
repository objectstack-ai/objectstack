---
"@objectstack/spec": major
---

refactor(spec)!: retire three SDUI page-component props no renderer honours — `page:header.icon`, `page:card.actions`, `record:details.layout` (#6946)

Maintainer ruling 2026-08-09 (decision-inbox round, 「全部接受」): objectui#3829
route (c) retires `PageHeaderProps.icon` and `PageCardProps.actions` upstream;
objectui#3818 retires `RecordDetailsProps.layout`. All three are the ADR-0049
declared-but-unenforced shape on the platform contract — the spec advertised
configuration objectui drops on the floor, and the author got a success receipt
for it.

FROM → TO, per key:

- **`page:header.icon` → delete the key.** objectui resolves `icon` only per
  header ACTION (`action.icon`); the header's own props bag is never asked for
  one, and the component registration publishes no `icon` input. The header's
  own identity is drawn by the record chrome (`recordChrome`, on by default),
  and each action carries its own icon.
- **`page:card.actions` → author the buttons as components in `children` or
  `footer`.** The card renderer builds its `<Card>` from `title`, `bordered`,
  `children` and `footer`; there is no actions area in the markup and no
  `actions` input in the registration. `element:button` and
  `record:quick_actions` are what actually render.
- **`record:details.layout` → delete the key; `sections` already decides the
  body.** This one WAS read — and only against `inline` | `compact`, two values
  its `auto` | `custom` enum never permitted, so both legal values took the same
  branch and the key selected nothing. Authoring `sections` gives the explicit
  groups (the old `custom`); omitting it falls back to the object's
  `highlightFields` (the old `auto`).

⚠️ Two live keys share these leaf names and are UNTOUCHED: `page:header.actions`
(read by the header renderer) and `record:highlights.layout` (`horizontal` |
`vertical`, honoured). Every strip here is scoped by component `type`, never by
key name.

The retirement kit:

- **Tombstones** (`retiredKey()`) on all three, so the removal is audible in the
  two channels an upgrading author actually hits: the input type becomes `never`
  and the parse raises the prescription itself, not a generic "unrecognized key".
- **ADR-0087 D2 conversions + D3 chain steps** —
  `page-structure-inert-keys-removed` (objectui#3829's two keys) and
  `record-details-layout-removed` (objectui#3818's). Both are pure lossless
  strips: none of the three ever had an effect to lose, and none has a lossless
  rewrite target. `os migrate meta --from 16` rewrites existing sources.
- **`RETIRED_KEYS_BY_MAJOR[17]`** carries all three by exact key
  (`ui/PageHeaderProps:icon`, `ui/PageCardProps:actions`,
  `ui/RecordDetailsProps:layout`).
- Four in-repo pages stop authoring `page:header.icon` — the showcase's
  project workspace and the published `mcp` / `cloud-connection` platform pages.
  None of them ever drew an icon.
- Baselines regenerated: `authorable-surface/ui.json` gains three `[RETIRED]`
  marks. `api-surface/`, `api-surface-signatures.json` and
  `json-schema.manifest/` are byte-identical, which is the correct reading for
  the tombstone route — those ratchets record export and def EXISTENCE, and a
  tombstone narrows a def's keys without deleting the def.

No runtime behaviour changes — that impossibility is the reason for the removal.

Sequencing: objectui#3829 (drop the two parity-gate exemptions) and
objectui#3818 (delete the `layout` input and the dead `inline|compact` branch)
are Blocked-by #6946 and proceed on the next `.objectui-sha` pin bump.

<!-- adr-0087: registered page-structure-inert-keys-removed, record-details-layout-removed -->

