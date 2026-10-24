---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/lint': minor
---

feat(spec,cli,lint): a form section entry's `label`, `placeholder` and `helpText` are translatable at `objects.<object>._sections.<section>.fields.<field>`

Clause-②: yes (widening)
Metadata-protocol: added

A form section entry (`{ field, label, placeholder, helpText }` in a form view's `sections[].fields`) can override the object field's copy for that form. Before this change a translation pack had no key for those three strings, so a form's entry overrides stayed in the authoring language for every reader, the anonymous `GET /forms/:slug` visitor included.

- **`@objectstack/spec`:** the `_sections.<section>` node of an object translation gains `fields`, keyed by the entry's `field`, each carrying `label`, `placeholder` and `helpText` (strict; `help`, `hint` and `tooltip` are refused with the rename to `helpText`). `translateView` overlays them onto a served form view's `config.sections[].fields[]` under the section rules: the key is the section's `name` and the entry's `field`, only copy the entry authors is translated, a missing key keeps the authored string, and a string edited on top of the packaged view keeps the edit (ADR-0029 D9.2a). An entry in a section with no `name`, and a bare field-name entry, have no key.
- **`@objectstack/cli`:** `os i18n extract` scaffolds the key for every entry string a form view's named section authors, and `os i18n check` / `os lint` coverage report a locale that leaves one untranslated, in the `section` bucket.
- **`@objectstack/lint`:** `translation-target-unknown` reports a `_sections.<section>.fields.<field>` key that no form view section of that name declares as an entry object.

Example (`zh-CN` bundle):

```ts
objects: {
  crm_case: {
    _sections: {
      submitter: {
        label: '关于您',
        fields: { contact_name: { label: '您的姓名', placeholder: '张三', helpText: '与证件一致' } },
      },
    },
  },
}
```
