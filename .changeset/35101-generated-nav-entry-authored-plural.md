---
'@object-ui/plugin-designer': patch
'@object-ui/console': patch
---

fix(plugin-designer): the app wizard decides a generated navigation entry's plural label from the object as authored, not as the console's locale serves it

Clause-②: yes (widening)
Metadata-protocol: none

When the Create app or Edit app wizard leaves the Objects step, it generates one navigation entry for each newly selected object. The entry carries no label unless the object declares a plural label that differs from its label and its name. That decision, and the text it stored, came from the served object list, which is translated for the reader's locale. So a zh-CN session stored the translated plural, such as `项目列表`, as the app's source text, readers in every other locale were served it, and whether a label was stored at all depended on the editor's language. The wizard now reads each newly selected object from the untranslated layers through `ObjectStackAdapter.getAuthoredItem('object', name, { packageId })`, at the package the served object came from, and decides and stores the authored plural label (`Projects`). The Next button waits for these reads, and the step buttons and the object selection are disabled until they settle, so the selection cannot change under them. If an object's stored definition cannot be read, its entry carries no label and inherits the object's label at render time; it never falls back to the served text. To show the plural in another locale, translate the entry under `apps.<app>.navigation.<object>.label`. Entries already stored are not rewritten.

`AppCreationWizardProps` gains the optional `readAuthoredObject(objectName)` prop, which `CreateAppPage` and `EditAppPage` now pass. A host that renders `AppCreationWizard` without it gets entries with no label: they inherit the object's label at render time.
