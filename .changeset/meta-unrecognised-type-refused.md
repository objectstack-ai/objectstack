---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

fix(metadata): `PUT /meta/:type` refuses a type name the platform does not have, instead of minting a namespace for it (#8421)

**BREAKING** accept-set narrowing on a published HTTP surface, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`). A write
that answered `200 {"success":true}` now answers `400 INVALID_REQUEST`:

```
PUT /api/v1/meta/fieldz/showcase_task.title
  before → 200, sys_metadata row persisted with type='fieldz'
  after  → 400 INVALID_REQUEST, nothing persisted
```

`fieldz` — or any typo — was neither a declared metadata type nor a known plural
spelling of one, so the boundary classified it as PLUGIN-registered, which every
authorization gate is permissive toward by construction. The row was persisted
under a type nothing reads and nothing serves, and the caller was told it had
succeeded. That silence is the real cost: a metadata-type typo, from a human or
from generated code, produced `success: true` and no indication the type is not
real.

**Why this is only now safe to refuse.** #7894 closed the sibling case (a plural
spelling of a type the platform DECLARES) and left this one open on purpose: a
static predicate cannot tell `fieldz` from a plugin kind, and the live-registry
alternative was measured to be worse than the defect — the live type set is
ITEM-POPULATED, so it omits every legitimate kind that has no items yet, which
is the state each kind is in immediately before its first create. What changed
is the platform, not the boundary's information: #8586 retired
`MetadataPluginConfig.additionalTypes` and with it the last channel by which a
plugin could DECLARE a metadata kind, so an unrecognised name can no longer be a
declaration this refusal has not heard about (maintainer ruling 2026-08-14).

**What still passes, pinned in both directions.** Every declared type in
`DEFAULT_METADATA_TYPE_REGISTRY`, in canonical and REST-plural spelling; every
manifest spelling and the singular each folds to; and the six plugin kinds that
have no static registry entry at all — `theme`, `webhook`, `connector`,
`sharing_rule`, `analytics_cube`, `rag_pipeline`. `PUT /meta/theme/dark` on a
deployment with zero themes is explicitly covered, because that first create is
exactly what a live-registry check would have broken.

**The refusal is scoped to the door that mints.** Reads are untouched: a running
kernel legitimately holds live type keys the static contract does not — `data`,
`kind` and `package` all enter the registry during an ordinary `registerApp`,
and `GET /api/v1/meta/types` lists that live set — so refusing unrecognised
names on the read path would answer 400 for types the same service advertises.
`DELETE` is untouched for the mirror-image reason: rows minted under an
unrecognised type before this change are real, nothing rewrites them on upgrade,
and refusing their deletion would turn the accumulation this fixes into an
accumulation nobody can clear.

**What breaks.** A caller creating metadata at runtime under a type name that is
in neither half of the static spelling contract. In this repo that set is empty
— all six plugin kinds are mapped — but an out-of-tree plugin that made its kind
live by registering an item of it, and then accepted runtime writes to that kind
through `/meta`, now needs its spelling in the contract. There is no
declared-kind channel to register one through today; that is the trade #8586's
retirement made, and this change is the half of it that stops silently accepting
what nothing can honour.

`@objectstack/spec` gains one export, `unrecognisedMetaTypeRefusal`, alongside
the #7894 verdict it deliberately does not merge with: one says *you spelled a
declared type wrongly* and can name the replacement, the other says *there is no
such type* and never guesses. The residue pin #7894 left behind
(`metadata-url-spelling.test.ts`, the case that asserted `fieldz` was refused by
nobody) is **flipped, not deleted**, and #7894's positive control keeps every
assertion it was written with.
