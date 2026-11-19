// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { ACTION_NO_OBJECT_BINDING, validateActionObjectBinding } from './validate-action-object-binding.js';

const action = (extra: Record<string, unknown>) => ({ name: 'mark_done', label: 'Mark done', type: 'script', ...extra });

describe('action-no-object-binding', () => {
  it('refuses a standalone action that declares a location and no objectName', () => {
    const findings = validateActionObjectBinding({ actions: [action({ locations: ['record_header'] })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: ACTION_NO_OBJECT_BINDING, severity: 'error', path: 'actions[0].objectName' });
    expect(findings[0].hint).toContain('locations: []');
  });

  it('is silent on a bound action, a headless one, one with no `locations`, and one embedded on its object', () => {
    expect(validateActionObjectBinding({
      actions: [
        action({ objectName: 'qa_task', locations: ['record_header'] }),
        action({ name: 'sync_all', locations: [] }),
        action({ name: 'unplaced' }),
      ],
      objects: [{ name: 'qa_task', actions: [action({ locations: ['record_header'] })] }],
    })).toEqual([]);
  });

  it('the runtime publish gate refuses the `action` write', () => {
    const verdict = runRuntimeAuthoringRules({ type: 'action', item: action({ locations: ['list_toolbar'] }) });
    expect(verdict.errors.map((f) => f.rule)).toContain(ACTION_NO_OBJECT_BINDING);
  });
});
