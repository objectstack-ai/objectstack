---
"@objectstack/spec": patch
---

**A `defineStack` or `composeStacks` call that refuses now carries the ADR-0087 conversions it applied on the error it throws, so `stackConversionsOf(error)` reads them off a caught refusal.**

`defineStack` rewrites a deprecated metadata spelling to its canonical shape before it validates, and records each conversion on the stack it returns (`stackConversionsOf(stack)`). A call that then refused returned no stack, so the conversions it had applied were lost: they reached stderr only, as a warn-once line that a second stack with the same path does not print again. A tool that catches the refusal, such as a `--json` door, had no way to report both the refusal and the retiring spelling.

- `defineStack` (strict and `strict: false`) stamps the conversions applied so far on every ADR-0112 refusal it throws after its conversion pass: the schema parse, the six cross-field refusals and the bound-action merge's shape refusal. The record is the same `ConversionNotice[]` a built stack carries, under the same symbol key, non-enumerable and frozen. A refusal whose source needed no conversion carries an empty record.
- `composeStacks` stamps its inputs' records on every refusal it throws, by the same rule it uses for the artifact it returns.
- `stackConversionsOf(value)` now also reads the record off such a refusal: `catch (error) { const conversions = stackConversionsOf(error); }`. It still answers `[]` for any other value, including a plain `Error` and a throw that is not one of these refusals.

Nothing is accepted or refused differently. Each refusal keeps its `code`, `status`, `name`, message and `issues`, and `hasStackProvenance` still answers `false` for it. No export is added.

Clause-②: no
