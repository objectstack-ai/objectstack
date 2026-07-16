// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0060 P2 — Validation-Rule Conformance ledger (the third instance of the
// reusable pattern). One row per `validations` union rule type, each pinned to
// its runtime enforcement site and a proof. ADR-0020 wired this whole union into
// the write path (engine insert/update → rule-validator.ts), turning every rule
// type from declaration into enforcement; this ledger makes that a CHECKED fact
// and — via the ratchet — makes a NEW rule type with no enforcement a build break
// (the exact pre-ADR-0020 `state_machine` disease).

import type { ConformanceRow } from '@objectstack/verify';

const RULE_VALIDATOR = 'packages/objectql/src/validation/rule-validator.ts';
const PROOF = 'packages/objectql/src/validation/rule-validator.test.ts';

export const VALIDATION_SURFACE: ConformanceRow[] = [
  {
    id: 'rule-state-machine',
    summary: 'state_machine — legal status-transition guard (ADR-0020 D3)',
    surface: 'validation.zod.ts:state_machine',
    state: 'enforced',
    enforcement: `${RULE_VALIDATOR} checkStateMachine — engine insert/update path rejects an illegal from→to transition`,
    covers: ['state_machine'],
    proof: PROOF,
  },
  {
    id: 'rule-script',
    summary: 'script — arbitrary CEL failure predicate',
    surface: 'validation.zod.ts:script',
    state: 'enforced',
    enforcement: `${RULE_VALIDATOR} checkPredicate — CEL predicate; TRUE = violation`,
    covers: ['script'],
    proof: PROOF,
  },
  {
    id: 'rule-cross-field',
    summary: 'cross_field — multi-field CEL invariant',
    surface: 'validation.zod.ts:cross_field',
    state: 'enforced',
    enforcement: `${RULE_VALIDATOR} checkPredicate — evaluated against the merged record (prior ∪ change)`,
    covers: ['cross_field'],
    proof: PROOF,
  },
  {
    id: 'rule-format',
    summary: 'format — value-shape rule (regex/builtin)',
    surface: 'validation.zod.ts:format',
    state: 'enforced',
    enforcement: `${RULE_VALIDATOR} checkFormat`,
    covers: ['format'],
    proof: PROOF,
  },
  {
    id: 'rule-json-schema',
    summary: 'json_schema — structural validation of a JSON field',
    surface: 'validation.zod.ts:json_schema',
    state: 'enforced',
    enforcement: `${RULE_VALIDATOR} checkJsonSchema`,
    covers: ['json_schema'],
    proof: PROOF,
  },
  {
    id: 'rule-conditional',
    summary: 'conditional — when/then predicate rule',
    surface: 'validation.zod.ts:conditional',
    state: 'enforced',
    enforcement: `${RULE_VALIDATOR} checkConditional`,
    covers: ['conditional'],
    proof: PROOF,
  },
];
