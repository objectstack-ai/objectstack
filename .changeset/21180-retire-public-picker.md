---
'@objectstack/spec': minor
'@objectstack/rest': minor
'@objectstack/lint': patch
---

**BREAKING** — an anonymous public form no longer offers record search. The form field's `publicPicker` block (`view.form.sections[].fields[].publicPicker`: `displayFields`, `maxResults`, `filter`, `object`) is removed, and the anonymous lookup route `GET /api/v1/forms/:slug/lookup/:field` is deleted. A public form's `lookup`, `master_detail` and `user` fields are now always left off its anonymous rendering, whatever the form declares.

Clause-②: yes (narrowing)

Retired immediately (ADR-0087 D2), with no alias window: the maintainer's ruling reverses the earlier one that had declared the key. Mainstream web-to-lead forms do not let an anonymous visitor search records either, and no example, template, plugin or first-party UI declared or called the picker.

## FROM → TO

| you wrote (17.5 and earlier) | write instead |
| --- | --- |
| `{ field: 'account', publicPicker: { displayFields: ['name'], maxResults: 10 } }` on a public form | delete the `publicPicker` block — the field is left off the anonymous rendering anyway |
| a public form whose visitors chose from a short, fixed list of records | a `select` field with static `options` listing the choices |
| a public form whose visitors had to pick an existing record | the same form behind sign-in (an internal form), where the lookup field searches with the signed-in user's own access |
| a client calling `GET /api/v1/forms/:slug/lookup/:field` | nothing to call: the path is no longer registered and answers what any unregistered path answers (`404 ENDPOINT_NOT_FOUND`) |

**The one-line fix:** delete the `publicPicker` block; an anonymous public form no longer offers record search. Use a `select` field with static `options`, or put the form behind sign-in.

**What an author who still writes it sees.** `tsc` fails at the authoring site (`FormFieldInput` types the key `never`), and the parse — `defineView()`, `defineStack({ views })`, `os validate`, `PUT /api/v1/meta/view/:name` — refuses it at `…sections[N].fields[N].publicPicker` with the prescription:

> `view.form.sections[].fields[].publicPicker` was removed in @objectstack/spec 17.6.0 (ADR-0087 D2) — an anonymous public form no longer offers record search: lookup, `master_detail` and `user` fields are always left off the anonymous rendering, and the anonymous record-search route (`GET /forms/:slug/lookup/:field`) no longer exists. Delete the key (the whole `publicPicker` block). To let a visitor choose from a fixed list, use a `select` field with static `options`; to let them pick an existing record, put the form behind sign-in. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.

**What a REST client sees.** The two error codes only that route produced, `LOOKUP_NOT_PUBLIC` and `LOOKUP_TARGET_MISSING`, leave the error-code ledger with it. `GET /api/v1/forms/:slug` and `POST /api/v1/forms/:slug/submit` are unchanged apart from the unconditional strip above.

## The retirement kit

- **A `retiredKey()` tombstone on the form field**, so the parse carries the prescription instead of a bare unknown-key verdict. The block's own schema and its two types go with it: `FormFieldPublicPickerSchema`, `FormFieldPublicPicker` and `FormFieldPublicPickerParsed` are no longer exported, and `ui/FormFieldPublicPicker` is no longer published as a JSON Schema.
- **The D2 conversion `form-field-public-picker-removed`** (protocol 18, retired from the load path) deletes the key from every form field of every form payload — `sections[]`, `groups[]`, top-level `fields[]` and nested rows. Its D3 record is the semantic entry `form-field-public-picker-retired`, which asks the author how a visitor should now choose.
- **`@objectstack/rest`:** the lookup route and its filter-lowering helper are deleted, and the resolve route's strip of lookup / `master_detail` / `user` fields no longer has an opt-in.
- **`@objectstack/lint`:** the preset-comparand rule no longer reads a picker's `filter` (its claiming reader for that position went with the key).

## What an operator with a STORED form sees

A `sys_metadata` view row saved before this release may still carry the key. Nothing breaks at read: the conversion replays on rehydration and strips it, so the view is served canonical and parses, and the field stays off the anonymous rendering either way. `os migrate meta --stored` lists those rows, and `--apply` rewrites them.

<!-- adr-0087: registered form-field-public-picker-removed, form-field-public-picker-retired -->
