import { describe, it, expect } from 'vitest';
import {
  validateSeedReplaySafety as validateSeedReplaySafetyUnrecorded,
  SEED_INSERT_MODE_DUPLICATES_ON_REPLAY,
} from './validate-seed-replay-safety.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain seed-insert-mode-duplicates-on-replay`. Every direct
// call below records what it fired, and the last cases in this file hold each
// recorded verdict to one line of at most 200 characters — every firing
// variant this suite exercises, not a chosen few. Run the whole file: those
// cases read what the cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateSeedReplaySafety: typeof validateSeedReplaySafetyUnrecorded = (...args) => {
  const findings = validateSeedReplaySafetyUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

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

describe('[#22161] one-line verdicts — seed-insert-mode-duplicates-on-replay', () => {
  it('reads as one sentence', () => {
    const findings = validateSeedReplaySafety({ data: [{ object: 'z', mode: 'insert', records: [] }] });
    expect(findings.map((f) => f.message)).toEqual([
      "`mode: 'insert'` re-inserts every record on each replay boot (dev-server restart, package re-publish) "
        + 'with no existing-row check, so every restart duplicates its rows',
    ]);
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(SEED_INSERT_MODE_DUPLICATES_ON_REPLAY);
    expect(entry, 'no `os explain seed-insert-mode-duplicates-on-replay` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    // The idempotent modes are held to the rule by the silent case above.
    for (const fact of [
      'Seeds are replayed, not applied once',
      'no existing-row check',
      '`ignore` (skip rows that already exist)',
      '`upsert` (create or update)',
      '`externalId`',
      '(`[\'team\', \'project\']`)',
      'only from the second boot on',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === SEED_INSERT_MODE_DUPLICATES_ON_REPLAY);
    // The coverage control first: the id fired, on more than one seed.
    expect(converted.length).toBeGreaterThan(1);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});
