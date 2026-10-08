// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21277 — ADR-0049 enforce-or-remove (ruling record 5945617233, letter A) —
// the D3 entry of the `agent-structured-output-refused-members-removed`
// family: one entry for the four members, because they leave for one reason
// (the runtime that executes agents refused each before the first turn) and
// share one replacement channel (a JSON contract). Value-level retirements, so
// nothing lands in RETIRED_KEYS_BY_MAJOR: no authorable KEY changed, and the
// four surface ratchets stay byte-identical.
export const entry: SemanticMigration = {
  id: 'agent-structured-output-refused-members-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code span.
  surface:
    "agent.structuredOutput — the values 'regex', 'grammar' and 'xml' left StructuredOutputFormat "
    + "(at format and fallbackFormat) and 'coerce_types' left TransformPipelineStep (at "
    + "transformPipeline); 'json_object', 'json_schema', 'trim', 'parse_json' and 'validate' are "
    + 'unchanged',
  replacement:
    'a JSON contract: `format: json_schema` with a JSON Schema in `schema` when the answer must have '
    + 'a shape, or `format: json_object` when any JSON value will do — or no `structuredOutput` block '
    + 'at all when the agent needs no output contract. A fallback format names one of the two JSON '
    + 'formats or is left out. In place of `coerce_types`, declare the exact types in `schema`, so the '
    + 'answer is validated as the model wrote it',
  reason:
    'ADR-0049 enforce-or-remove. The cloud AI runtime, the one runtime that executes agents, enforces '
    + '`structuredOutput` on every final answer and refuses an agent that declares any of these four '
    + 'members before its first turn: the spec never had a key to carry the pattern or grammar a '
    + '`regex` or `grammar` answer would be checked against, a final answer is checked only as JSON, '
    + 'and no coercion engine exists. Hosted model APIs constrain a final answer by JSON Schema only; '
    + 'regex and grammar constraints live in inference engines and in tool-input formats, not on an '
    + "agent's answer. The D2 conversion `agent-structured-output-refused-members-removed` makes each "
    + 'stored or existing source parse: it DELETES a block whose `format` was retired, deletes a '
    + 'retired `fallbackFormat`, and drops `coerce_types` from the pipeline. The deletion of a block is '
    + 'the edit that needs judgement: it removes an output contract the runtime never kept, and only '
    + 'the author can say whether the agent should now carry a `json_schema` contract instead — the '
    + 'conversion cannot write the schema the author meant',
  acceptanceCriteria:
    'No agent declares `format` or `fallbackFormat` as `regex`, `grammar` or `xml`, and no '
    + '`transformPipeline` lists `coerce_types`; each is refused at parse with its prescription, and '
    + 'TypeScript rejects each at a `StructuredOutputFormat` or `TransformPipelineStep` position. Every '
    + 'agent whose block the conversion deleted either carries a `json_schema` contract whose `schema` '
    + 'states the answer it must give, or the author has confirmed it needs no output contract. An '
    + 'agent that relied on coercion declares the exact types in `schema` and a test turn returns an '
    + 'answer that validates without conversion.',
  conversionIds: ['agent-structured-output-refused-members-removed'],
  relevantWhen: { kind: 'stack-declares', keys: ['agents'] },
};
