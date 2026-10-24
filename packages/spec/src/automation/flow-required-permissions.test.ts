// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FlowSchema.requiredPermissions` — who may START a flow (ruling record
 * 6377848497, letter A), the flow-level twin of an action's
 * `requiredPermissions` (ADR-0066 D4): the same value shape, a list of
 * capability names. The runtime checks it at every start door
 * (`packages/runtime/src/flow-start-admission.ts`); these pins hold the
 * authoring half: the key is a real authorable key, its value is the action's
 * shape, and it is kept on the parsed definition the doors read.
 */
import { describe, expect, it } from 'vitest';

import { ActionSchema } from '../ui/action.zod';
import { FlowSchema } from './flow.zod';

const GATED = {
  name: 'srm_bank_verify',
  label: 'Verify bank account',
  type: 'screen',
  runAs: 'system',
  requiredPermissions: ['srm_verify_bank_account'],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

describe('FlowSchema.requiredPermissions', () => {
  it('parses whole, and the parsed definition keeps the list the doors read', () => {
    const parsed = FlowSchema.safeParse(GATED);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.requiredPermissions).toEqual(['srm_verify_bank_account']);
  });

  it('is optional: a flow that declares none parses with the key absent', () => {
    const { requiredPermissions: _omit, ...bare } = GATED;
    const parsed = FlowSchema.safeParse(bare);
    expect(parsed.success).toBe(true);
    expect(parsed.data && 'requiredPermissions' in parsed.data).toBe(false);
  });

  it("takes the action's value shape — a list of names — and refuses another", () => {
    for (const value of ['srm_verify_bank_account', { srm_verify_bank_account: true }, [1]]) {
      const parsed = FlowSchema.safeParse({ ...GATED, requiredPermissions: value });
      expect(parsed.success, JSON.stringify(value)).toBe(false);
      expect(parsed.error?.issues.some((i) => i.path[0] === 'requiredPermissions')).toBe(true);
      // The action key refuses the same values: one shape, two positions.
      const action = ActionSchema.safeParse({
        name: 'verify_bank', label: 'Verify', type: 'flow', target: 'srm_bank_verify', requiredPermissions: value,
      });
      expect(action.success, `action ${JSON.stringify(value)}`).toBe(false);
    }
  });
});
