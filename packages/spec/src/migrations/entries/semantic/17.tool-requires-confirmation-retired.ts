// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'tool-requires-confirmation-retired',
  surface: 'ai.tool.requiresConfirmation',
  replacement:
    'put the operation behind an ACTION and set `ai.requiresConfirmation: true` there — that '
    + 'is the flag the HITL approval queue actually reads, and the only path that stops '
    + 'execution',
  reason:
    '`ToolSchema.requiresConfirmation` accepted `true` and no execution path ever read it: '
    + 'not the LLM tool set (a tool reaches the model as name / description / parameters '
    + 'only), not `ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, and not the MCP '
    + 'bridge, which derives `destructiveHint` from a hardcoded name list. Setting it on a '
    + 'destructive tool produced NO PAUSE. For an ordinary dead property that is untidy; for '
    + 'a SAFETY property it is false compliance, the case ADR-0049 exists for — an author '
    + 'gates a destructive tool, sees the flag accepted, and ships believing a human is in '
    + 'the loop. It is made worse by the near-miss: `action.ai.requiresConfirmation` carries '
    + 'the same name and DOES work, so the mistake reads as correct in review. This is '
    + 'registered as a semantic entry rather than a mechanical conversion because the rewrite '
    + 'is not a rename at all — the replacement lives on a different metadata object at a '
    + 'different layer, and deciding which action should carry the gate (or whether the '
    + 'operation should be an action at all) is a judgement the chain cannot make. Deleting '
    + 'the key mechanically would be the worst possible transform here: it would leave the '
    + 'metadata parsing green while silently completing the removal of a safety gate the '
    + 'author believed was in place. `ToolSchema` was made `.strict()` in the same change, '
    + 'which is load-bearing rather than tidying — removing a key from a non-strict schema '
    + 'swaps one silent no-op for another, so the retired key now REJECTS and the parse error '
    + 'carries the prescription, that being the one channel every consumer bumping '
    + '`@objectstack/spec` is guaranteed to hit. Registered by the #6350 stock '
    + 'reconciliation: the `retiredKey()` tombstone shipped with #3715 and still stands in '
    + '`ai/tool.zod.ts`, but the ledger half never did. A retirement needs both — the '
    + 'tombstone is the proof the removal was declared, this entry is what `spec-changes.json`'
    + ', the upgrade guide and `os migrate meta` project to consumers. ADR-0033 §2 / '
    + 'ADR-0049 / ADR-0087, #3715 (backfilled #6350).',
  acceptanceCriteria:
    'No tool definition carries `requiresConfirmation`; the key now raises a located parse '
    + 'error naming the replacement, so the sweep is "fix until nothing raises". ⚠️ The '
    + 'load-bearing half is what happens NEXT, and no gate can check it for you: for every '
    + 'tool that carried the flag, decide whether that operation genuinely needs a human in '
    + 'the loop. If it does, move it behind an action carrying `ai.requiresConfirmation: '
    + 'true` and prove the pause exists — invoke it and observe the approval queue hold it, '
    + 'rather than assuming the declaration. If it does not, delete the key knowingly. '
    + 'Deleting it without that decision leaves exactly the state the retirement exists to '
    + 'end: a destructive tool nobody is approving, now without even the false flag to show '
    + 'that somebody once meant to.',
};
