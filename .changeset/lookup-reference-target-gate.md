---
'@objectstack/lint': minor
---

`object-reference-unknown` now judges a field's `reference` — the target of `Field.lookup()` / `Field.masterDetail()` / `Field.user()` — with the same four-rung ladder it applies to every other object-name site

`FieldSchema.reference` is `z.string()`: the schema holds it present and non-empty on `lookup` / `master_detail`, and nothing anywhere asked whether the name resolved. So `os validate`, `os lint` and `os build` all exited 0 — no diagnostic of any severity — on `Field.lookup('zzz_object_that_does_not_exist')` (measured on 17.3.0), and the miss surfaced only at runtime: the record picker asking the REST layer for an object that is not registered (404 `OBJECT_NOT_FOUND`), `$expand` failing on the field, the form rendering a control that can never resolve a value.

The site joins `validateObjectReferences` and rides its existing ladder, so the three commands judge it identically:

1. resolves in the stack's own objects → ok;
2. resolves in `PLATFORM_PROVIDED_OBJECT_NAMES` (`sys_user`, the target `Field.user()` writes) → ok;
3. unresolved and not platform-prefixed → **`error`** — `os validate` / `os build` / `os lint` exit 1;
4. unresolved, platform-prefixed, registered by nothing (`sys_approval_process`) → the existing `object-reference-unregistered-platform` advisory.

Judged: `lookup`, `master_detail`, `user`. Not judged, on purpose: `tree` (the object schema already refuses any target but the own name), a `reference` on a non-relationship type (inert), and `objectExtensions[].fields` (an extension targets an object another package owns, so its references are cross-package by construction — see below).

## Migration

**A build that used to pass can now fail.** Rung 3 is a new `error`-level refusal on a published accept set. Point the field at one of the stack's own objects, or at a platform object by its full name (`sys_user`, not `user`); the finding names the defined objects and suggests the nearest one.

**Cross-package references have no rung yet.** A lookup from one package into an object a sibling package ships (a module's `crm_order.account` → its App package's `crm_account`, or an app referencing an object HotCRM provides) is unresolved and unprefixed, so rung 3 refuses it whenever the referencing stack is judged alone — `os build`'s per-package run included. The declared escape (an authored marker on the field, or resolution against the artifact's composition) is a separate authorable surface and is not part of this change.
