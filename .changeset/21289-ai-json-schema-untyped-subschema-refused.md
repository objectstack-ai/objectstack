---
'@objectstack/spec': minor
---

feat(spec)!: `action.ai.outputSchema` and `agent.structuredOutput.schema` refuse an untyped subschema that carries a type-scoped keyword, at its path, as the AI runtime does (#21289)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ai-json-schema-untyped-subschema-refused -->

**BREAKING** — an accept-set narrowing on two published authoring slots, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. Every schema it refuses was already refused by the AI runtime before the action or agent ran, so nothing that worked stops working; what moves is where the refusal is reported — at authoring, at the subschema's path, instead of at the first invocation.

**`@objectstack/spec`**

- **`action.ai.outputSchema`** (stack actions and object-nested actions) and **`agent.structuredOutput.schema`** were open records. The cloud AI runtime compiles both through one guard whose schema reader does not check a type-scoped keyword on a subschema with no `type`, and refuses the whole schema. Both slots are now declared by one factory that mirrors that guard exactly:
  - **refused:** an object node whose `type` is absent and which carries any of the 22 type-scoped keywords (`properties`, `required`, `additionalProperties`, `patternProperties`, `propertyNames`, `minProperties`, `maxProperties`, `items`, `prefixItems`, `contains`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`), with any value;
  - **where:** the schema root, every value of `properties`, `patternProperties`, `$defs`, `definitions` and `dependentSchemas`, and the subschema (or each array entry) of `items`, `additionalProperties`, `contains`, `propertyNames`, `not`, `if`, `then`, `else`, `unevaluatedProperties`, `unevaluatedItems`, `anyOf`, `oneOf`, `allOf` and `prefixItems` — under typed parents too; `$ref` is not followed;
  - **accepted:** boolean subschemas, `{}`, a node with any `type` value, and an untyped node carrying only keywords outside the list (`enum`, `const`, `$ref`, `anyOf`, `title`, `description`, `default`, …);
  - each offending subschema is its own issue, located at the slot path plus the subschema path (`ai.outputSchema.properties.customer`), and the message names the keyword and the `type` to declare.
- The TypeScript types of both slots are unchanged (`Record<string, unknown>`). The published JSON Schema does not state the rule: it is a refinement, which the JSON Schema projection does not carry, so a JSON Schema validator still accepts such a schema in either slot. The affected published schemas name the slot in their `x-dropped-refinements` list.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `outputSchema: { properties: { id: { type: 'string' } }, required: ['id'] }` | `outputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }` |
| `schema: { type: 'object', properties: { tags: { items: { type: 'string' } } } }` | `schema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } }` |
| `{ properties: { code: { pattern: '^[A-Z]+$' } } }` anywhere in either slot | `{ type: 'object', properties: { code: { type: 'string', pattern: '^[A-Z]+$' } } }` |

The one-line fix: declare its `type` on every subschema that carries a type-scoped keyword — `"object"`, `"array"`, `"string"`, or `"number"` / `"integer"`, as the refusal names.

## Who is affected, measured

On `origin/main` `135daaa06b`: the package fixtures author either slot three times (one action `ai.outputSchema`, two `structuredOutput.schema`), every subschema typed; the examples, the documentation and the published skills author neither slot. No fixture needed a change. Deployed metadata was not measured. A stored action or agent carrying such a schema still loads; its next save is refused until the `type` is declared.
