---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): the author panels speak the author's words, and the zh pack names `label` 显示名

Clause-②: no
Metadata-protocol: none

- A Lookup's related-object picker shows the placeholder 「选择对象…」 / "Select object…" (not `object_name`), in prose type, with a chevron; the roll-up child-object picker takes the same placeholder. The "every record is selectable" hint and the related-list help name the target by its label, and neither is drawn before a target is set.
- The post-save advisory toast shows the producer's sentence alone when the finding carries one; the rule id and locator stay on the developer face (a finding with no sentence).
- The Notify node's rows are rewritten in the author's words in en and zh: no key aliases, no literal defaults, no `info | warning | critical`; the topic row reads "Category" (zh 「通知类别」) and the severity options read 一般 / 警告 / 紧急 in zh.
- The object Settings tab keeps each metadata key off the panel at rest: the key is the setting title's hover text. The object inspector's `split.renderKey` is replaced by `split.keysOnHover`.
- The Studio zh pack names an item's `label` 显示名 throughout, where it said 标签 or 显示名称 (the add-field hints included).
