---
'@objectstack/spec': minor
---

feat(spec): an AI blueprint field can declare `multiple`, `accept` and `maxSize`

Clause-②: yes (widening) — a blueprint field carrying `multiple` on a type that can hold several values, or `accept` / `maxSize`, parses where it was refused as an unrecognized key; the strict mirror gains the same three keys, nullable. `@objectstack/spec/data` gains one export, `multiDeclarableFieldTypes()`. Nothing is removed or narrowed.
Metadata-protocol: added
Skills-docs: none — `skills/**` teaches no blueprint field key; the blueprint guide the design model reads lives with the applier in cloud, which carries the keys next.

`BlueprintFieldSchema` (what `apply_blueprint` parses) and its strict mirror (what the in-app design model generates against) now declare three keys the object field contract already had, with `FieldSchema`'s own value shapes:

- **`multiple`** (boolean): several values in one field — several related records on a `lookup` / `user`, several files on a `file` / `image`, several chosen options on a `select`. "An expense claim with its e-invoices attached" is now one blueprint field, `{ name: 'invoices', type: 'file', multiple: true }`.
- **`accept`** (array of MIME types or extensions) and **`maxSize`** (a positive integer, in bytes): the upload types and the size limit of a media field.

FROM → TO for an author: before, `{ type: 'file', multiple: true }` in a blueprint was refused with `unrecognized_keys` at the field's `multiple`; now it parses, and the applier carries the key into the built field. At the `apply_blueprint` door nothing an author wrote before parses differently: the door refused the three keys, and a field that declares none of them parses exactly as before and gains no key. A direct `BlueprintFieldSchema.parse` (or `SolutionBlueprintSchema.parse`) is different, because it used to strip an undeclared key: FROM `{ type: 'text', multiple: true }`, `{ type: 'file', maxSize: 0 }` or `{ type: 'select', options, multiple: true, defaultValue: 'open' }` parsing with the key silently dropped, TO each refused at that key (`multiple`, `maxSize`, `defaultValue`). The fix is the one the message names: drop the key, or give it a value the field takes.

- **`multiple: true` is refused by name where the built field refuses it.** The blueprint field judges it against `FieldSchema`'s own declarable set, exported as `multiDeclarableFieldTypes()` rather than copied, so `multiple: true` is refused on exactly the types the built field refuses it on. A `radio` field is refused as on `FieldSchema`: a radio group is single-choice. The refusal lands on the field's `multiple` and names the types that take it.
- **A multi-value `select` takes no blueprint `defaultValue`.** It stores a list, and a blueprint default is one value; the built field would refuse the scalar too. The refusal lands on the field's `defaultValue`.
- **A multi-value `select`'s options take no `kind`.** A lifecycle kind says where one record stands, and the field holds no single option code per record; the built field refuses it too. One refusal per option, at that option's `kind`. Such a field is never an object's `stageField` either: the object's stage-field rule refuses it at `stageField`.
- **`accept` / `maxSize` outside the media family** parse and are read by nothing, as on `FieldSchema`; the describes say so.
