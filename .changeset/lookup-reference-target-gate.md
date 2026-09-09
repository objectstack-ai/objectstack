---
'@objectstack/lint': minor
'@objectstack/cli': patch
---

`object-reference-unknown` now judges a field's `reference` — the target of `Field.lookup()` / `Field.masterDetail()` / `Field.user()` — with the same four-rung ladder it applies to every other object-name site, and `os build`'s per-package run resolves those names across the artifact's `packages[]`

`FieldSchema.reference` is `z.string()`: the schema holds it present and non-empty on `lookup` / `master_detail`, and nothing anywhere asked whether the name resolved. So `os validate`, `os lint` and `os build` all exited 0 — no diagnostic of any severity — on `Field.lookup('zzz_object_that_does_not_exist')` (measured on 17.3.0), and the miss surfaced only at runtime: the record picker asking the REST layer for an object that is not registered (404 `OBJECT_NOT_FOUND`), `$expand` failing on the field, the form rendering a control that can never resolve a value.

The site joins `validateObjectReferences` and rides its existing ladder, so the three commands judge it identically:

1. resolves in the stack's own objects, or in the objects an entry of this artifact's `packages[]` provides → ok;
2. resolves in `PLATFORM_PROVIDED_OBJECT_NAMES` (`sys_user`, the target `Field.user()` writes) → ok;
3. unresolved and not platform-prefixed → **`error`** — `os validate` / `os build` / `os lint` exit 1;
4. unresolved, platform-prefixed, registered by nothing (`sys_approval_process`) → the existing `object-reference-unregistered-platform` advisory.

Judged: `lookup`, `master_detail`, `user`. Not judged, on purpose: `tree` (the object schema already refuses any target but the own name), a `reference` on a non-relationship type (inert), and `objectExtensions[].fields` (an extension targets an object another package owns, routinely one this artifact does not carry).

## Migration

**A build that used to pass can now fail.** Rung 3 is a new `error`-level refusal on a published accept set. Point the field at one of the stack's own objects, at an object another package of the same artifact ships, or at a platform object by its full name (`sys_user`, not `user`); the finding names the objects that resolve and suggests the nearest one.

**A reference into a sibling package of the same release artifact resolves — it needs no annotation.** ADR-0130 makes the release artifact the co-ownership boundary, so `os build`'s per-package leg now hands each package's stack the artifact's `packages[]` as resolution context (`compile.ts`). A module's `crm_order.account` → its App package's `crm_account` is an ordinary rung-1 resolution on all three commands. This changes what a rule can resolve, never what it judges: the collections judged per package are still that package's own, and a name no entry of `packages[]` provides still errors on the per-package run exactly as it does on the union one.

**A reference into another RELEASE ARTIFACT still has no rung** — an app naming an object a separate product ships (HotCLM's `clm_contract.crm_contract` → HotCRM). It is unresolved and unprefixed, so rung 3 refuses it. The declared escape for that case resolves against declared manifest dependencies and is its own change; ⛔ it is deliberately not an authored per-field marker, which would be a one-line switch that silences the gate.
