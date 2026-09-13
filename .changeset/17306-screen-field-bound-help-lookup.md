---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

A flow screen field can now express a numeric bound, help text and a lookup target — spelled with the object field's own key names

<!-- adr-0087: registered screen-field-lookup-reference-required -->

`ScreenFieldConfigSchema` was `.strict` over exactly
`name`/`label`/`type`/`required`/`options`/`defaultValue`/`placeholder`/`visibleWhen`,
so three ordinary authoring intents had **no expression at all**. They did not
degrade quietly — `max`, `helpText` and every lookup-target spelling were
refused BY NAME — but a loud refusal with no landing key is still a dead end,
and the reference app worked around all three in prose: a discount ceiling
interpolated into the `label` and the `placeholder` (with a comment explaining
why there was no `max`), and a `type: 'lookup'` field whose `placeholder` asked
a human to type a record id because the picker could not be pointed anywhere.

Four keys land, and **their names are derived from `FieldSchema`, not invented**
— one platform, one field vocabulary, so a name learned on an object field means
the same thing on a screen field:

| Key | Derived from | |
|:---|:---|:---|
| `min` / `max` | `FieldSchema.min` / `.max` | the bound pair |
| `inlineHelpText` | `FieldSchema.inlineHelpText` | help under the input — `FieldSchema` renames `help`/`helpText`/`hint`/`tooltip` onto it, so a screen-local `helpText` would have been a second contract for one question |
| `reference` | `FieldSchema.reference` | the object a `type: 'lookup'` field picks records from |

**The bound is enforced, not advisory.** It rides to the client on
`ScreenFieldSpec` so the user is stopped at the input, **and**
`validateScreenInputs` re-checks it when the run resumes (`min_value` /
`max_value`, both already in the ADR-0114 D2 field-error catalog — no new error
code). A screen field's declared contract is the only contract behind it, so a
bound the dialog alone applied would be bypassed by any caller posting to
`resume` directly — the gap #4477 closed for `required`.

That sentence needs no "when the value is a number" qualifier, because the
value SHAPE is checked first: on a `type: 'number'` field a present value that
is not a finite JSON number is refused with `invalid_type` (also already in the
catalog — still no new code), ⛔ **not coerced**. Before this, a bound pass that
compares numbers was satisfied by anything that never reached it, so `"25"`
under a `max` of `20` was conformant. One member of the open `type` vocabulary
is read as a value domain; every other widget hint stays open, and a bound on a
non-numeric field still constrains nothing.

**Delivered with its rendering, not ahead of it.** The executor forwards all
four onto the wire and the Studio designer form offers all four as repeater
columns; `builtin-node-form-zod-ledger.test.ts` reconciles the two key sets
against the Zod in both directions, so a key declared here and absent from the
form fails that test rather than shipping as a field nobody can author.

**BREAKING** in the accept-set sense, in TWO places — landing as `minor` on
both packages because the launch-window guard (`check-changeset-no-major`)
keeps breaking changes off `major` outside pre-mode, not because the narrowing
is small. Both were ruled (maintainer ruling A′, decision batch #130 item 1,
2026-09-13); this release is **not** purely additive.

1. `reference` is **required** when `type` is `lookup`, as it is on an object
   field. A picker with no target object resolves nothing — ADR-0078's own
   example of silently-inert metadata — and a degraded shape that ships today
   is not a reason to bend the contract to it. A stored flow with a bare
   `lookup` screen field parsed before and does not now. There is **no lossless
   conversion**: nothing in the metadata says which object the author meant, so
   this is an ADR-0087 **semantic** migration entry — a structured TODO
   (`screen-field-lookup-reference-required`) that names the flow and the field
   for a human to answer — and ⛔ never a D2 conversion that would have to
   invent a target.
2. A non-number submitted for a `type: 'number'` screen field is refused on
   resume (`invalid_type`) instead of passing silently. A resume bag that was
   accepted before can be refused now; it was never doing what its author
   declared.

Everything else is additive: the bound itself fires only on a field that
declares one, which nothing did before this release.

The neighbouring spellings are refused **with their landing key** rather than
with a bare key list: `help`/`helpText`/`hint`/`tooltip` name `inlineHelpText`,
and `object`/`referenceTo`/`targetObject`/`lookupObject`/`relatedTo`/`target`
name `reference`. ⚠️ `object` means different things one level apart — on the
screen **node** it renames to `objectName`, on a screen **field** it can only
mean the lookup target — so it earns its own row on both.

**One stale claim corrected in passing, because this change falsified it.** The
flows translation surface documented `help`'s exclusion as *"`ScreenFieldConfig`
declares nothing help-shaped at all"*, in `translation.zod.ts`'s guidance string
(which enumerated the old key set verbatim), its doc block, and
`i18n-resolver.ts`'s `FLOW_SCREEN_FIELD_COPY_KEYS`. The screen field now
declares `inlineHelpText`, so the copy is real. The exclusion **stands** — the
flows bundle still carries `label` and `placeholder` only, and growing that face
is a ruled step against the #7646 enumeration, not a resolver-side accretion —
but its reason is now stated as a not-yet instead of telling an author the field
has no help copy when it has. ⛔ No translation key was added and no resolver
behaviour moved.
