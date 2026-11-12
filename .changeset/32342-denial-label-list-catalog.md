---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
---

fix(plugin-security, spec): the field-write 403's label list takes its quote marks and separator from the operation-message catalog

Clause-②: yes
Metadata-protocol: none

The field-write refusal's `userMessage` (`errors.field_edit_denied`) names the refused fields by label as a quoted list. The quote marks and the separator used to be a table inside plugin-security, keyed by locale prefix, so a locale added to the catalog rendered its sentence with another locale's list rules and nothing failed. They are now two entries of the operation-message catalog in every locale: `errors.field_label_quoted` (one label, `{{label}}`) and `errors.field_label_list_separator`. They resolve by the same locale ladder as the sentence, and a deployment can override them with a `translation` item, as it already could the sentence. A catalog locale that omits either entry fails the catalog's every-locale-defines-every-key test.

The rendered text does not change in en, zh-CN, ja-JP or es-ES, nor for a locale the catalog does not register. Before, a requested locale such as `jam` matched the `ja` prefix and put Japanese brackets inside the English fallback sentence; it now gets the English quote marks with the English sentence.
