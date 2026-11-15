---
'@objectstack/spec': patch
'@objectstack/types': patch
'@objectstack/objectql': patch
---

fix(objectql): the duplicate refusal (`409 UNIQUE_VIOLATION`) now reads in the writer's language and names the fields of a composite unique index

Clause-②: yes (widening)
Metadata-protocol: none

A write refused by a unique constraint used to answer the fixed English sentence "A record with this value already exists" as the 409 body's `error`, whatever the request's `Accept-Language`, and never named the fields of a unique index over several columns, so the user could not tell which combination collided. The engine now composes that sentence in the writer's locale from the platform's operation message catalog, the catalog the `DELETE_RESTRICTED` refusal already uses, so a `zh-CN` request reads `已存在「工厂」、「牌号」、「成本周次」均相同的记录` where it read English. A composite key is named only when the columns the database reported match, as a set, a unique index the object declares, and only when every one of those fields has a label; otherwise the sentence names nothing, because a wrong field name is worse than none. The wire shape does not change: `code` stays `UNIQUE_VIOLATION`, the status stays 409, and `field` still names one column only when the database named exactly one. An English deployment reads the same sentences as before for a single field or none.

Three additions ride along. `BUILTIN_OPERATION_MESSAGES` (`@objectstack/spec/system`) gains `duplicate_record`, `duplicate_record_field` and `duplicate_record_fields` in every platform locale, so a deployment can override them with an `errors.duplicate_record*` translation. `@objectstack/types` exports `uniqueViolationColumns(error)`, the columns of a composite unique key the driver named, with the organization part set aside. `DuplicateRecordError` carries the composed sentence as `endUserMessage`. A MySQL refusal names an index and not its columns, so it still names no field.
