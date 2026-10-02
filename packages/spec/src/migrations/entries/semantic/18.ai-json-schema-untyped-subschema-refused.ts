// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21289 — the two JSON-Schema slots the cloud AI runtime compiles,
// `action.ai.outputSchema` and `agent.structuredOutput.schema`, were open
// records, so a schema whose untyped subschema carries a type-scoped keyword
// (`properties`, `items`, `pattern`, …) passed every authoring door and was then
// refused by the runtime's one shared guard before the action or agent ran.
// Both slots now come from one factory (`shared/ai-json-schema-slot.ts`) that
// mirrors that guard's keyword set and descent exactly and refuses at the
// subschema's path. D3 only: the runtime already refused every such schema, so
// nothing that worked stops working; supplying a `type` is a judgment about the
// author's intent (adding one also narrows what the schema accepts), not a
// lossless rewrite; and the authored census found nothing to respell.
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'ai-json-schema-untyped-subschema-refused',
  surface: 'action.ai.outputSchema (stack actions and object-nested actions) and '
    + 'agent.structuredOutput.schema — a JSON Schema in which an object subschema with no type '
    + 'carries a type-scoped keyword',
  replacement: 'the same schema with a `"type"` declared on every subschema that carries a '
    + 'type-scoped keyword: `"object"` beside `properties`, `required`, `additionalProperties`, '
    + '`patternProperties`, `propertyNames`, `minProperties` or `maxProperties`; `"array"` beside '
    + '`items`, `prefixItems`, `contains`, `minItems`, `maxItems` or `uniqueItems`; `"string"` '
    + 'beside `minLength`, `maxLength`, `pattern` or `format`; `"number"` or `"integer"` beside '
    + '`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` or `multipleOf`. A subschema '
    + 'meant to accept several types declares them as an array (`"type": ["string", "null"]`).',
  reason: 'Both slots are compiled by the cloud AI runtime — `action.ai.outputSchema` before the '
    + 'action runs, to validate its result, and `agent.structuredOutput.schema` as the agent\'s '
    + 'structured-output contract — and both readers call one guard whose schema reader does not '
    + 'check a type-scoped keyword on a subschema that declares no `type`. That guard refuses the '
    + 'whole schema before anything runs. The spec declared both slots as open records, so such a '
    + 'schema passed `defineStack`, `objectstack validate` and the metadata save door, and the '
    + 'author learned of it only when the action or agent was invoked. Both slots are now one '
    + 'declaration that mirrors the guard exactly — the same 22 type-scoped keywords (`properties`, '
    + '`required`, `additionalProperties`, `patternProperties`, `propertyNames`, `minProperties`, '
    + '`maxProperties`, `items`, `prefixItems`, `contains`, `minItems`, `maxItems`, `uniqueItems`, '
    + '`minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, `exclusiveMinimum`, '
    + '`exclusiveMaximum`, `multipleOf`), present with any value on an object node whose `type` is '
    + 'absent; the same descent into every value of `properties`, `patternProperties`, `$defs`, '
    + '`definitions` and `dependentSchemas` and into the single subschema or each array entry of '
    + '`items`, `additionalProperties`, `contains`, `propertyNames`, `not`, `if`, `then`, `else`, '
    + '`unevaluatedProperties`, `unevaluatedItems`, `anyOf`, `oneOf`, `allOf` and `prefixItems`, '
    + 'under typed and untyped parents alike, without following `$ref` — and refuses each offending '
    + 'subschema at its own path with the `type` to declare named. Boolean subschemas, `{}`, a '
    + 'node with any `type` value, and an untyped node carrying only keywords outside the list '
    + '(`enum`, `const`, `$ref`, `anyOf`, `title`, …) are accepted, as the runtime accepts them. '
    + 'Measured on the built package: the per-type schema the metadata save door validates with '
    + 'refuses an action, an object-nested action or an agent carrying such a schema at the '
    + 'subschema path, and `defineStack` throws with the same path; the same schema with `type` '
    + 'declared is accepted at both. Read from source and not run: a row already stored still '
    + 'loads, because the database loader replays the conversion chain and parses nothing, and its '
    + 'next save is refused until the `type` is declared. No conversion is registered: '
    + 'every refused schema was already refused by the runtime, so nothing that worked stops '
    + 'working; and supplying a `type` is a judgment about what the author meant, not a lossless '
    + 'rewrite, because declaring one also narrows what the schema accepts. Population measured at '
    + 'the change, on origin/main 135daaa06b: zero untyped subschemas in the three authorings of '
    + 'either slot across the package fixtures (one action `ai.outputSchema`, two '
    + '`structuredOutput.schema`), and zero authorings of either slot in the examples, the '
    + 'documentation and the published skills; the one `outputSchema` the examples carry is a '
    + 'connector action\'s, a different key. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `ai.outputSchema` on an action (stack-level and object-nested) and '
    + 'every `structuredOutput.schema` on an agent parses: `objectstack validate` reports no '
    + 'issue whose message reads `uses "…" without a "type"` at either slot, and every subschema '
    + 'in either schema that carries a type-scoped keyword declares its `type`. The action or '
    + 'agent then runs past the AI runtime\'s schema compilation instead of being refused before '
    + 'it runs.',
};
