---
"@objectstack/spec": patch
---

fix(spec): the `manifest.namespace` refusal now names the leading-letter rule its pattern enforces

Clause-②: no

`manifest.namespace` is enforced by `^[a-z][a-z0-9_]{1,19}$`, so its FIRST character must be a lowercase letter. Its refusal sentence and its TSDoc `Rules:` line stated only the length and the charset, so `1leave` and `_leave` satisfied every clause an author was shown and were still refused, by a sentence that could not say why.

- **The refusal sentence** is now `Namespace must be 2-20 chars, start with a lowercase letter, and contain only lowercase letters, digits and underscores`. It was `Namespace must be 2-20 chars, lowercase alphanumeric + underscore`.
- **The same sentence on the publish payload.** `PackageSchema.namespace` and `CreatePackageRequestSchema.namespace` (`marketplace/package.zod.ts`, and through them the scaffold-only `TemplateManifestSchema.namespace`) carried a byte-identical copy of the old sentence and carry the new one. A new pin holds all four fields to `manifest.namespace`'s sentence, not only to its verdicts.
- **The TSDoc `Rules:` line** now reads `2-20 characters, starting with a lowercase letter; lowercase letters, digits, and underscores only`.
- **Doors that surface the sentence verbatim** carry the new text with no change of their own. For example, `duplicatePackage`'s refusal of an explicit `targetNamespace` reads the declaration's message, so its rule clause now names the leading letter too.

The accept set is unchanged: the pattern is byte-identical, and every value that parsed before still parses. Only the text shown on a refusal changes. A consumer that matched the old sentence verbatim needs to match the new one.
