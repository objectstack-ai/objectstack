---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): the Studio connector action Input repeater follows the run's declared-keys rule

Clause-②: yes (widening) — `@object-ui/i18n` gains the studio pack key `engine.inspector.flowNode.kv.undeclaredKey` (en, zh). Nothing is removed or narrowed.
Metadata-protocol: none

- **The repeater offers extras only where the run accepts them.** A `connector_action` step refuses, at run time, an input key the action's input schema does not declare. Studio now reads the schema the same way: an action whose schema lists `properties` (every shipped connector) is closed, and one that carries `additionalProperties` or `unevaluatedProperties` other than `false`, a `$ref`, `allOf` / `anyOf` / `oneOf`, `patternProperties` or another key-admitting keyword, or no `properties` at all, is open. An open action keeps the key/value repeater beside its typed fields, as before. A closed action keeps it only for a key it declares that no typed field can edit, such as an OpenAPI operation's `$ref` or schemaless request `body`, or Slack's `blocks`, and suggests those keys in the key cell. When every declared key has a typed field, the repeater is gone.
- **Keys the run refuses are marked, not dropped.** On a closed action, a stored input key the schema does not declare (one left behind by an older flow or an action switch) stays in the repeater with a line under it saying that the run refuses it and how to fix it. A key typed into the repeater that the action does not declare gets the same line. Studio never removes such a key on its own; the author removes it.
- An OpenAPI operation whose only input is a schemaless body now gets the judged repeater too, where it used to get the generic one.
