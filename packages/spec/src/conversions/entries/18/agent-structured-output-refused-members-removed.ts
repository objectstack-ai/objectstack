// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `agent-structured-output-refused-members-removed`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `agentStructuredOutputRefusedMembersRemoved` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict } from '../shared.js';

/**
 * The members of an agent's `structuredOutput` the runtime refused — the
 * `regex`, `grammar` and `xml` formats and the `coerce_types` transform step —
 * leave the spec (protocol 18, #21277; ADR-0049 enforce-or-remove, ruling
 * record 5945617233, letter A).
 *
 * Cloud's AI service, the one runtime that executes agents, enforces
 * `structuredOutput` on every final answer and refuses each of these four,
 * typed, before an agent's first turn: the spec never had a key to carry the
 * pattern or grammar a `regex` / `grammar` answer would be checked against, a
 * final answer is checked only as JSON, and no coercion engine exists. Before
 * that reader landed nothing read the block at all. So no authored value of
 * any of the four ever produced the behaviour it named, and authoring now
 * refuses them by name (`enumWithRetiredValues`, ai/agent.zod.ts).
 *
 * Three edits, each the least that leaves a parseable agent:
 *
 * - **A retired `format`** — the format is REQUIRED, so stripping it alone
 *   would hand back a block that cannot parse, and no mechanical rewrite can
 *   say which JSON contract the author wanted instead. The whole
 *   `structuredOutput` block is deleted: the agent's answer was never checked
 *   against a regex, grammar or XML shape, so what goes is a contract that was
 *   never kept. One notice, at the block's `format`, naming the value; the D3
 *   entry `agent-structured-output-refused-members-retired` carries the
 *   judgement left — whether the agent needs a `json_schema` contract.
 * - **A retired `fallbackFormat`** — optional, so the key alone is deleted;
 *   the primary format and every other key stay.
 * - **`coerce_types` in `transformPipeline`** — the step alone is filtered out
 *   and the other steps keep their order. The key stays even when the list
 *   empties, as `hook-body-crypto-hash-removed` keeps an empty grant set:
 *   deleting the key would change what the author declared about the steps
 *   that remain.
 *
 * A block deleted for its `format` emits only that one notice — the retired
 * members inside it go with it. Idempotent by construction: a second pass
 * finds no retired member and returns the input reference.
 *
 * Retired from the load path: an author is refused at parse with the
 * prescription; data at rest (`applyConversionsToStoredItem`) and
 * `os migrate meta` replay it.
 */
const agentStructuredOutputRefusedMembersRemoved: MetadataConversion = {
  id: 'agent-structured-output-refused-members-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface:
    'agent.structuredOutput.format / agent.structuredOutput.fallbackFormat / '
    + 'agent.structuredOutput.transformPipeline',
  summary:
    "agent structured-output formats 'regex' / 'grammar' / 'xml' and the transform step 'coerce_types' "
    + 'removed: the AI runtime refused each before the first turn, because structured output is checked '
    + 'only as JSON and no coercion engine exists. A block whose format was retired is deleted, a retired '
    + 'fallback format is deleted, and the coerce step is dropped from the pipeline',
  apply(stack, emit) {
    const RETIRED_FORMATS: ReadonlySet<unknown> = new Set(['regex', 'grammar', 'xml']);
    return mapCollection(stack, 'agents', (agent, path) => {
      const block = agent.structuredOutput;
      if (!isDict(block)) return agent;
      const where = `${path}.structuredOutput`;
      if (RETIRED_FORMATS.has(block.format)) {
        emit({ from: String(block.format), to: '(removed)', path: `${where}.format` });
        const next: Dict = { ...agent };
        delete next.structuredOutput;
        return next;
      }
      let nextBlock: Dict = block;
      if (RETIRED_FORMATS.has(block.fallbackFormat)) {
        emit({ from: String(block.fallbackFormat), to: '(removed)', path: `${where}.fallbackFormat` });
        nextBlock = { ...nextBlock };
        delete nextBlock.fallbackFormat;
      }
      const steps = block.transformPipeline;
      if (Array.isArray(steps) && steps.includes('coerce_types')) {
        emit({ from: 'coerce_types', to: '(removed)', path: `${where}.transformPipeline` });
        nextBlock = { ...nextBlock, transformPipeline: steps.filter((s) => s !== 'coerce_types') };
      }
      return nextBlock === block ? agent : { ...agent, structuredOutput: nextBlock };
    });
  },
  fixture: {
    before: {
      agents: [
        {
          // A retired primary format: the whole block goes, its other keys with it.
          name: 'pattern_agent',
          label: 'Pattern',
          structuredOutput: { format: 'regex', maxRetries: 2, transformPipeline: ['trim', 'coerce_types'] },
        },
        {
          // A JSON format with a retired fallback and the coerce step: both are
          // dropped surgically, and the order of the surviving steps is kept.
          name: 'invoice_agent',
          label: 'Invoice',
          structuredOutput: {
            format: 'json_schema',
            schema: { type: 'object', properties: { total: { type: 'number' } } },
            fallbackFormat: 'xml',
            transformPipeline: ['trim', 'coerce_types', 'parse_json', 'validate'],
          },
        },
        {
          // Only the coerce step: the key stays, now an empty list.
          name: 'coerce_agent',
          label: 'Coerce',
          structuredOutput: { format: 'json_object', transformPipeline: ['coerce_types'] },
        },
        {
          // Already canonical, and an agent with no block at all: both ride
          // through untouched — the walk dispatches on a retired MEMBER, never
          // on the block's presence.
          name: 'json_agent',
          label: 'JSON',
          structuredOutput: { format: 'json_object', fallbackFormat: 'json_schema', transformPipeline: ['parse_json'] },
        },
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    after: {
      agents: [
        { name: 'pattern_agent', label: 'Pattern' },
        {
          name: 'invoice_agent',
          label: 'Invoice',
          structuredOutput: {
            format: 'json_schema',
            schema: { type: 'object', properties: { total: { type: 'number' } } },
            transformPipeline: ['trim', 'parse_json', 'validate'],
          },
        },
        {
          name: 'coerce_agent',
          label: 'Coerce',
          structuredOutput: { format: 'json_object', transformPipeline: [] },
        },
        {
          name: 'json_agent',
          label: 'JSON',
          structuredOutput: { format: 'json_object', fallbackFormat: 'json_schema', transformPipeline: ['parse_json'] },
        },
        { name: 'plain_agent', label: 'Plain' },
      ],
    },
    // Four: the deleted block (one, though it held a retired step too), the
    // invoice agent's fallback and its step, and the coerce agent's step.
    expectedNotices: 4,
  },
};

export { agentStructuredOutputRefusedMembersRemoved };
