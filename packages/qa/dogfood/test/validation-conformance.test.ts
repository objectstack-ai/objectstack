// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0060 P2 — the validation-rule conformance ledger is a CHECKED artifact,
// built on the SAME reusable checkLedger helper as the authz and expression
// ledgers (proving the pattern composes: a new surface is a filled-in table, not
// a re-derived discipline). The ratchet re-discovers every `validations` union
// rule type from spec source and fails the build if any is unclassified — so a
// new validation rule type added without runtime enforcement (the pre-ADR-0020
// `state_machine` failure) can't ship silently.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkLedger } from '@objectstack/verify';
import { VALIDATION_SURFACE } from './validation-conformance.ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const VALIDATION_ZOD = join(REPO_ROOT, 'packages/spec/src/data/validation.zod.ts');

/** Re-discover every `validations` union rule type from its discriminator. */
function discoverRuleTypes(): Set<string> {
  const src = readFileSync(VALIDATION_ZOD, 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/type:\s*z\.literal\('([a-z_]+)'\)/g)) found.add(m[1]);
  return found;
}

describe('ADR-0060 P2 — validation-rule conformance ledger', () => {
  it('is a sound conformance ledger + ratchet, every rule type enforced + proven', () => {
    const problems = checkLedger(VALIDATION_SURFACE, {
      proofRoot: REPO_ROOT,
      discover: discoverRuleTypes,
      proofRequiredForEnforced: true, // a write-path guard must carry a runtime proof
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('sanity: discovery finds the known rule types', () => {
    const found = discoverRuleTypes();
    for (const t of ['state_machine', 'script', 'cross_field', 'format', 'json_schema', 'conditional']) {
      expect(found.has(t), `rule type '${t}' not discovered`).toBe(true);
    }
  });
});
