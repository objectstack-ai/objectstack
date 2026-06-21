// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0060 D5 extension — the flow trigger-type ledger is a CHECKED artifact on
// the same reusable checkLedger helper (the FOURTH surface: authz / expression /
// validation-rule / flow-trigger). The ratchet re-discovers every `Flow.type`
// enum value from flow.zod.ts and fails the build if one is unclassified — so a
// new flow trigger type added without a runtime that fires it (a flow that is
// authorable but never runs — the flow-shaped #1887) can't ship silently.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkLedger } from '@objectstack/verify';
import { FLOW_TRIGGER_SURFACE } from './flow-trigger-conformance.ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../..');
const FLOW_ZOD = join(REPO_ROOT, 'packages/spec/src/automation/flow.zod.ts');

/** Re-discover every `Flow.type` enum value (the one tagged `.describe('Flow type')`). */
function discoverFlowTypes(): Set<string> {
  const src = readFileSync(FLOW_ZOD, 'utf8');
  const m = src.match(/type:\s*z\.enum\(\[([^\]]+)\]\)\s*\.describe\('Flow type'\)/);
  if (!m) throw new Error('Flow.type enum not found in flow.zod.ts — discovery is stale');
  const found = new Set<string>();
  for (const lit of m[1].matchAll(/'([a-z_]+)'/g)) found.add(lit[1]);
  return found;
}

describe('ADR-0060 D5 — flow trigger-type conformance ledger', () => {
  it('is a sound conformance ledger + ratchet, every flow type has a runtime + proof', () => {
    const problems = checkLedger(FLOW_TRIGGER_SURFACE, {
      proofRoot: REPO_ROOT,
      discover: discoverFlowTypes,
      proofRequiredForEnforced: true,
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('sanity: discovery finds the known flow types', () => {
    const found = discoverFlowTypes();
    for (const t of ['record_change', 'api', 'schedule', 'autolaunched', 'screen']) {
      expect(found.has(t), `flow type '${t}' not discovered`).toBe(true);
    }
  });
});
