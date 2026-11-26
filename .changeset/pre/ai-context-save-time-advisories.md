---
'@objectstack/lint': patch
---

A context pack (`ai_context`) saved at runtime is now judged by `validateAiContext` on the publish door (ADR-0160 D1: author defects are "reported at save and by `os validate`"). A pack that names a field or object the live objects do not define, a related list with no link to the root, or a body that is not a long-text field is saved and told so on the save response's existing `advisories`, with the same rule ids (`ai-context-field-unknown`, `ai-context-object-unknown`, `ai-context-related-link-unknown`, `ai-context-body-not-long-text`) and, for a write that names no package, the messages `os validate` prints; under a package, an object outside the package's closure (the package, its declared `dependencies` and platform objects) is told so, with the remedy to declare the dependency. The save is never refused for them, as for every advisory rule on that door; a draft save is not judged.

Clause-②: no
Metadata-protocol: none
