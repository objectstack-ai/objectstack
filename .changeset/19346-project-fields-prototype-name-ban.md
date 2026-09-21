---
"@objectstack/spec": minor
---

**BREAKING (published artifact narrows)** — `packages/spec/json-schema/**` now states the `constructor` / `prototype` field-name ban that `ObjectSchema.fields` has always enforced, so a validator reading the published files stops answering PASS on `{"constructor":{"type":"text","label":"R"}}` at `data/Object.properties.fields` — a document the runtime refuses by name (#19346; #18670 item 2, through the `banned-keys` arm).

Clause-②: yes (narrowing)

**No arm joins the closed list.** The ban is over a FINITE list of two names, which is exactly what the existing `banned-keys` arm expresses, so this is a call site moving onto a declared pattern rather than a new public-contract decision. What moved is WHERE the refusal is written: from a `.refine()` on the record's KEY schema to a record-level `bannedKeys(['constructor', 'prototype'])` inside the existing `refuseRecordProtoKey(...)` wrapper. A key-schema `.refine()` is a `custom` check, and `z.toJSONSchema()` has no arm for one, so that rule reached the runtime and never the file.

**The rows retired, by name.** `packages/spec/dropped-refinements.baseline.json` goes from 204 entries / 569 sites to **204 entries / 560 sites** — nine site deletions, no entry deletions (every one of the nine schemas keeps other rows), and **0 sites added anywhere**:

| ledger entry | row deleted |
|:---|:---|
| `api/AssembledInstalledPackage` | `manifest.objects.element.fields.out.keyType` |
| `api/GetInstalledPackageResponse` | `data.options[1].manifest.objects.element.fields.out.keyType` |
| `api/InstalledPackageAtEitherStage` | `options[1].manifest.objects.element.fields.out.keyType` |
| `api/ListInstalledPackagesResponse` | `data.packages.element.options[1].manifest.objects.element.fields.out.keyType` |
| `api/ObjectDefinitionResponse` | `data.fields.out.keyType` |
| `data/Object` | `fields.out.keyType` |
| `system/ChangeSet` | `operations.element.options[3].object.fields.out.keyType` |
| `system/CreateObjectOperation` | `object.fields.out.keyType` |
| `system/MigrationOperation` | `options[3].object.fields.out.keyType` |

Generator census after: **560 dropped across 204 published schemas, 366 projected** — 224 `non-blank-string`, 129 `required-one-of`, **11 `banned-keys`** (2 before), 2 `dependent-required` — 9 undecidable. Across the published tree, **1524 of 1535 files are byte-identical**: the nine carriers above each gain the ban and lose their matching `x-dropped-refinements` row, and the remaining two are the bundle (`objectstack.json`) and the build-input hash.

**⛔ The set of documents the runtime accepts does not move.** The arm is EXACT rather than approximate: a JSON object's properties are exactly its own enumerable string-keyed ones and `propertyNames` judges exactly those names, and `bannedKeys` reads OWN properties and never `key in value` — which is what the key schema judged too, since a record's key loop only ever visits own keys. It is presence and never value: a banned key present with a `null` value is present on both sides. Measured with ajv 8 (draft 2020-12) on the generated `data/Object.json`, before and after, the verdict vector moves in one direction only — `{"constructor": …}` and `{"prototype": …}` go `true` to `false`, while an ordinary document and the near-miss controls `{"constructors": …}` and `{"to_string": …}` are accepted on both sides.

**⚠️ What DOES move is the refusal's location, and a consumer will see it at BOTH layers** — the raw zod issue, and the published `{field, code, message}` envelope every REST / data-API client reads (ADR-0114, built by `api/zod-issues-to-fields.ts`). Measured on this tree by parsing `{"name":"lead","label":"Lead","fields":{"title":{…},"constructor":{…}}}` with the schema before and after:

| layer | | before | after |
|:---|:---|:---|:---|
| raw zod issue | `path` | `['fields', '<the offending key>']` | `['fields']` |
| raw zod issue | `code` | `invalid_key` | `custom` |
| raw zod issue | where the reason text sits | nested one level down, under zod's fixed "Invalid key in record" | the issue's own `message` |
| published envelope | entries | **2** | **1** |
| published envelope | `field` | `fields.constructor` on both entries | `fields` |
| published envelope | `code` | `invalid_shape` (zod's "Invalid key in record") **and** `invalid_value` (the reason) | `invalid_value` alone |

⚠️ `invalid_shape` is a member of the published `FieldErrorCode` vocabulary and it no longer appears for this refusal at all. A client that branched on `invalid_shape` to detect a rejected field NAME must branch on `invalid_value` at `field: "fields"` instead, and must stop expecting two entries where it now receives one.

The message text is unchanged and still names both reserved words in full. The fix for a consumer that keyed on the old shape: match the issue at path `fields` with code `custom` — `field: "fields"`, `code: "invalid_value"` in the envelope — and read its `message` directly, instead of descending into an `invalid_key` issue's nested `issues[0]`. This is the cost of the projection: the closed list can only publish a RECORD-level predicate, and `.refine()` carries no per-key path, so a located-per-key refusal and a published refusal cannot both be had from one rule. The ban list is closed and two names long, so the slot is still named and the two candidate keys are both named in the message.

**⛔ `__proto__` is untouched, and it is a third name rather than a third case.** Its guard is `refuseRecordProtoKey`'s `z.preprocess` on the raw input, because zod's record parser skips that one name with an unconditional `continue` ABOVE the key schema — no schema, and therefore no projection, can ever see it. It holds no ledger row and gains no published keyword here. This change reaches two of the three names, never three.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author can write is removed, renamed or re-spelled: no spec key, no export and no config field changes, and the set of metadata documents the runtime accepts is exactly what it was. What changed is a machine-readable DECLARATION catching up with the runtime it always described, plus the shape of the issue the refusal raises -- so there is nothing for `objectstack migrate meta` to rewrite and no stored representation to convert. -->
