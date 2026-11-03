---
'create-objectstack': patch
'@objectstack/cli': patch
---

fix(scaffold): a scaffolded namespace is at most 13 characters, so a fresh project from a long name validates with no `namespace-no-customization-pair` warning (#28992)

Clause-②: no
Metadata-protocol: none

`npx create-objectstack` and `os init` derive `manifest.namespace` from the project name. They truncated it at 20 characters, the manifest grammar's limit, while a namespace longer than 13 has no paired customization namespace (ADR-0146 D3). So `qa-console-first-paint` scaffolded the namespace `qa_console_first_pai`, and the project's first `os validate` warned about it and about the object names it prefixes, none of which the author wrote.

Both scaffolders now cap the namespace at `MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH` (13): `qa-console-first-paint` gets `qa_console_fi`, and every object name and file the scaffold derives from the namespace follows it. A truncated namespace never ends in `_`. `os init` reads the constant from `@objectstack/spec/kernel`; `create-objectstack`, which does not depend on the spec at runtime, keeps its own copy, pinned equal to the spec constant by a test. Project names whose namespace already fit are scaffolded exactly as before.
