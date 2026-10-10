// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysAutomationRun } from './sys-automation-run.object.js';

/**
 * `sys_automation_run` — the run row shows the WHOLE broken-sweep first filter.
 *
 * The filter is `selected_count > 0 AND acted_count = 0 AND unmeasured_count = 0`
 * (#4354, qualified as a filter and not a verdict by #12685). `highlightFields`
 * is how the object puts it on the run row itself, and the third operand is the
 * one that matters for reading the other two: `acted_count = 0` beside a
 * non-zero `unmeasured_count` means "cannot tell", not "did nothing".
 *
 * Measured on a stack composed as `serve` composes it (#22590): a flow whose
 * only effect is a `notify` step answers `selected 1, acted 0, unmeasured 1`,
 * because with reliable delivery on the in-app message is enqueued and written
 * by the outbox dispatcher after the run settles. With `unmeasured_count` off
 * the highlight set, that delivering sweep read `selected 1, acted 0` on the
 * run row: the same row as a sweep with nothing to do.
 *
 * ⛔ Do not "fix" a failure here by narrowing the list below. An operand leaves
 * the highlight set only together with the filter expression it belongs to.
 */
const FIRST_FILTER_OPERANDS = ['selected_count', 'acted_count', 'unmeasured_count'] as const;

describe('sys_automation_run — the highlight set carries every operand of the first filter', () => {
  const fields = SysAutomationRun.fields as Record<string, Record<string, unknown>>;

  it('each operand is a declared number column (so the containment below is not a typo match)', () => {
    for (const name of FIRST_FILTER_OPERANDS) {
      expect(fields[name], `${name} is expected to be a column`).toBeDefined();
      expect(fields[name].type).toBe('number');
    }
  });

  it('highlightFields contains selected_count, acted_count AND the qualifier unmeasured_count', () => {
    const highlight = SysAutomationRun.highlightFields ?? [];
    const missing = FIRST_FILTER_OPERANDS.filter((name) => !highlight.includes(name));
    expect(missing, `first-filter operands missing from highlightFields: ${missing.join(', ')}`).toEqual([]);
  });
});
