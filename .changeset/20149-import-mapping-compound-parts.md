---
"@objectstack/spec": minor
"@objectstack/rest": minor
"@objectstack/lint": minor
---

feat(spec,rest,lint): an import mapping target may name a declared part of a compound field (`mailing_address.street`), and the importer assembles the parts into one value (#20149)

Clause-②: yes

**What was missing.** A mapping could write each source column to one flat
field only, so nothing could build an `address` value from the separate
street / city / state / postal code / country columns a spreadsheet carries.
A dotted target such as `mailing_address.street` named no field and was
refused at `objectstack validate`, on the dry run and on the commit.

**What changes.**

- `@objectstack/spec`: `ImportFieldMappingSchema.target` declares the part
  path. A target may name `field.part` when `field` is a declared field whose
  stored value schema is a closed object of optional strings (today:
  `address`), and `part` is a key that schema declares: `street`, `city`,
  `state`, `postalCode`, `country`, `countryCode`, `formatted`. The part names
  are read from the value schema, never listed by hand. The one verdict,
  `judgeImportMappingTarget`, answers the new `{ kind: 'part', field, part }`;
  `indexImportMappingTargets` carries each compound field's parts on
  `parts`; `unknownImportMappingTargets` gives each refused target a `reason`
  (`unknown` or `collides`) and, for a dotted target, what its `head` names.
  `location` is not compound for import: its parts are required numbers, so a
  value assembled from text cells would be the wrong type.
- `@objectstack/rest`: `applyMappingToRows` assembles every part target of a
  row into one value under the field's key, before the engine sees the row,
  whatever transform produced the part (`none`, `map`, `constant`, `join`,
  each element of a `split`). A blank part cell (empty, whitespace or a
  `nullValues` token) is left out, string parts are trimmed under
  `trimWhitespace`, and a row whose parts are all blank leaves the field
  unset, as a blank flat cell does. On an update the assembled value replaces
  the stored one. The dry run and the commit judge the same assembled row.
- `@objectstack/lint`: `mapping-target-field-unknown` accepts a declared part
  and reports what stays refused, naming the legal parts each time.

**Still refused, at `objectstack validate`, on the dry run and on the commit
(`400 INVALID_FIELD`, before any row):**

- a part the value does not declare (`mailing_address.stret`); the refusal
  lists the declared parts;
- a dotted path on a field with no parts (`full_name.first`). A dotted target
  never traverses a reference (`account.name`): map the column to the
  reference field with transform `lookup`;
- a mapping that writes a field both whole and by part (`mailing_address` and
  `mailing_address.street`): one row carries one value for the field. Map it
  whole or by its parts, not both.

**What to do.** Nothing, unless you want the capability: point each address
column at `field.part`, for example `{ source: 'Zip', target:
'mailing_address.postalCode' }`.
