import { describe, it, expect } from 'vitest';
import { FlowSchema } from './flow.zod';

// [#34655, ADR-0126 §4 amendment] `defaultActive` — the default of the
// packaged-flow switch. Optional with no materialized default, so a flow that
// does not declare it parses exactly as before the key.

const base = {
  name: 'draft_contract',
  label: 'Draft contract',
  type: 'record_change' as const,
  status: 'active' as const,
  nodes: [{ id: 'start', type: 'start', label: 'Start', config: { objectName: 'quote', triggerType: 'record-after-update' } }],
  edges: [],
};

describe('FlowSchema.defaultActive (#34655)', () => {
  it('accepts `false` and `true` and keeps the declared value', () => {
    expect(FlowSchema.parse({ ...base, defaultActive: false }).defaultActive).toBe(false);
    expect(FlowSchema.parse({ ...base, defaultActive: true }).defaultActive).toBe(true);
  });

  it('CONTROL: a flow that does not declare it parses with no `defaultActive` key at all', () => {
    const parsed = FlowSchema.parse(base);
    expect(parsed).not.toHaveProperty('defaultActive');
  });

  it('refuses a value that is not a boolean, at the key', () => {
    const result = FlowSchema.safeParse({ ...base, defaultActive: 'off' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['defaultActive']);
  });
});
