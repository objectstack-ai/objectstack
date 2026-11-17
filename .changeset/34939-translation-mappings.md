---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

feat(spec): a named import mapping's label is translatable at `mappings.NAME.label`

Clause-②: yes (widening) — a new optional translation group `mappings` (one key per mapping, `label`) on `TranslationDataSchema`, `PlatformTranslationDataSchema`, `ServedTranslationDataSchema` and `TranslationItemSchema`, a new `translateMapping` export from `@objectstack/spec/system` registered for the `mapping` type, and a new `MetadataProtocol.getPackagedMappingBase`; nothing that parsed before is refused
Metadata-protocol: added
Skills-docs: follow-up owed — #34962 (skills/objectstack-i18n/SKILL.md group list)

An import mapping's `label` is the name the import wizard offers it by, and until now it showed the authored text in every locale: the bundle had no key for it. A bundle now translates it:

```ts
'zh-CN': { mappings: { crm_lead_feed: { label: '线索导入' } } }
```

- `GET /meta/mapping` (list and item) serves the label in the reader's locale. A shipped mapping overridden through its `.custom` pair follows the ADR-0146 D2 order every other translated label follows: a label the override changed keeps its own text unless the pair translates it, and a label it left alone takes the pair's translation, then the package's. The packaged base is now available for `mapping` (`getPackagedMappingBase`), so the override's label is judged against it.
- Only `label` has a key. A mapping declares no `description`, and its `fieldMapping` holds column and field names rather than copy — the refusal for either names where to translate instead (a target field's label is `objects.OBJECT.fields.FIELD.label`). The singular `mapping` and the label aliases `name` / `title` are refused with the declared spelling named.
- `os i18n extract` scaffolds the key, `os i18n check` reports a gap as `i18n/missing-mapping`, and `os validate` reports a key naming no mapping of the stack as `translation-target-unknown`, with the nearest name suggested.
- Studio's translation preview shows the group as **Import Mappings** (导入映射), and the Studio translation table walks it.
