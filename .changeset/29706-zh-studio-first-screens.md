---
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

Studio in zh-CN no longer mixes English into three first screens.

- **New package form.** Studio's landing mounts the form before the lazily fetched zh catalogue arrives, and the form kept its first, English labels ("Display name", "Human-readable package name") under the translated title. The form is now rebuilt once the catalogue lands.
- **Automations rail.** A flow on an object that is not published yet was grouped under the object's machine name, shown uppercased. The rail's object index now includes the package's draft objects, so the group reads the object's label.
- **Column picker.** "Add field" listed the platform's injected columns (created/updated at and by, owner) ahead of the builder's own fields. The builder's fields now come first, then the system ones, each in the order the object serves them.
