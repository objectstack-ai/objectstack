import { describe, it, expect } from 'vitest';
import {
  validateSeedReplaySafety,
  SEED_INSERT_MODE_DUPLICATES_ON_REPLAY,
} from './validate-seed-replay-safety.js';

describe('validateSeedReplaySafety (framework#3434 replay-unsafe seed gate)', () => {
  it('passes a stack with no seed data', () => {
    expect(validateSeedReplaySafety({})).toHaveLength(0);
    expect(validateSeedReplaySafety({ data: [] })).toHaveLength(0);
  });

  it('passes idempotent modes (ignore / upsert / update / replace) and the default (unset)', () => {
    const findings = validateSeedReplaySafety({
      data: [
        { object: 'a', mode: 'ignore', externalId: ['team', 'project'], records: [] },
        { object: 'b', mode: 'upsert', externalId: 'code', records: [] },
        { object: 'c', mode: 'update', records: [] },
        { object: 'd', mode: 'replace', records: [] },
        { object: 'e', records: [] }, // mode unset → defaults to upsert, safe
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("flags a mode: 'insert' seed with location + an actionable fix hint", () => {
    const findings = validateSeedReplaySafety({
      data: [
        { object: 'showcase_project_membership', mode: 'insert', records: [{ team: 'x', project: 'y' }] },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: SEED_INSERT_MODE_DUPLICATES_ON_REPLAY,
      path: 'data[0].mode',
    });
    expect(findings[0].where).toContain('showcase_project_membership');
    expect(findings[0].message).toContain('replay');
    // Hint steers to the idempotent modes and the composite externalId the fix added.
    expect(findings[0].hint).toContain('ignore');
    expect(findings[0].hint).toContain('upsert');
    expect(findings[0].hint).toContain('externalId');
    expect(findings[0].hint).toContain("['team', 'project']");
  });

  it('flags each insert seed and reports its index in the path; leaves safe seeds alone', () => {
    const findings = validateSeedReplaySafety({
      data: [
        { object: 'safe', mode: 'upsert', records: [] },
        { object: 'bad_one', mode: 'insert', records: [] },
        { object: 'also_safe', mode: 'ignore', records: [] },
        { object: 'bad_two', mode: 'insert', records: [] },
      ],
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.path)).toEqual(['data[1].mode', 'data[3].mode']);
    expect(findings.map((f) => f.where)).toEqual(['seed "bad_one"', 'seed "bad_two"']);
  });

  it('falls back to a data[i] location when a seed has no object name', () => {
    const findings = validateSeedReplaySafety({ data: [{ mode: 'insert', records: [] }] });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('data[0]');
  });

  it('ignores non-object entries defensively', () => {
    const findings = validateSeedReplaySafety({ data: [null, 'insert', 42, { object: 'z', mode: 'insert', records: [] }] });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toContain('z');
  });
});
