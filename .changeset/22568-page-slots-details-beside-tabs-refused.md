---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
---

feat(spec)!: `PageSchema` refuses a page that authors both `slots.details` and `slots.tabs`; the `sys_user` record page carries its details grid as its first tab

Clause-②: yes (narrowing)

<!-- adr-0087: registered page-slots-details-beside-tabs-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** The slot map read as seven independent slots, and two of them are not. On a slotted record page `details` replaces the body of the Details tab, that tab lives inside the synthesized `page:tabs` strip, and `tabs` replaces the whole strip. The console's default-page synthesizer therefore reads `tabs` and never reads `details` when both are authored. A page authoring both passed `PageSchema.parse`, `objectstack validate` and the metadata save door, and its details body (its `sections`, its `hideFields`) silently never applied. The platform's own `sys_user` record page was one: its Identity and Audit sections never showed, and the ban columns it hides were never hidden by it.

**What is refused.** A page whose `slots` map carries both a `details` and a `tabs` key, at `slots.details`, with a `custom` issue that names both slots and the fix. Either slot may be one component or an array; an empty `details: []` is refused like a full one, and the page's `kind` does not matter. That covers `PageSchema`, `definePage`, `defineStack` (`STACK_SCHEMA_INVALID`, 422), `os validate` and the metadata save door (`422 INVALID_METADATA`). The check is exported as `checkPageSlotPair`, for a mirror built from `PageSchema.shape` to re-attach.

**What is still accepted, byte for byte.** A page authoring only `details`, only `tabs`, or neither.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `slots: { details: { type: 'record:details', … }, tabs: { type: 'page:tabs', properties: { items: [ … ] } } }` | `slots: { tabs: { type: 'page:tabs', properties: { items: [ { label: 'Details', children: [ { type: 'record:details', … } ] }, … ] } } }` |
| both slots, wanting the synthesized tabs with your details body | `slots: { details: { type: 'record:details', … } }`, with no `tabs` slot |

**The one-line fix: move the `record:details` component into the `tabs` items (the first item's `children`, by convention) and delete `slots.details`.** Its `sections` and `hideFields` move unchanged. The page then shows the details body it always declared, which is a visible change on every page that authored the pair.

**Who is affected, measured.** In this repository, only the `sys_user` record page (`sys_user_detail` in `@objectstack/platform-objects`) authored both slots; no example app page does. hotcrm's one slotted page authors `header` and `discussion` only. Deployed metadata was not measured. A page row already stored with the pair is replayed unchanged at load, so it renders as before (the authored tabs, without the details body); its read diagnostics name the pair, and saving it again is refused until the details body moves.

### The kit

- **The refusal.** `checkPageSlotPair`, attached to `PageSchema` by identifier beside its three other object-level checks. No new error code.
- **The producer.** `sys_user_detail` moves its `record:details`, with its `sections` and `hideFields` unchanged, in as the first `tabs` item.
- **The ledger.** The D3 semantic entry `page-slots-details-beside-tabs-refused` (protocol 18) and its step-18 rationale fragment. No key is removed, so there is no tombstone, and there is no D2 conversion: which tab item carries the details body, and under which label, is the author's decision.
