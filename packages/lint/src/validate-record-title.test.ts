import { describe, it, expect } from 'vitest';
import { TITLE_ELIGIBLE_TYPES } from '@objectstack/spec/data';
import {
  validateRecordTitle as validateRecordTitleUnrecorded,
  TITLE_FORMAT_RETIRED,
  TITLE_UNRESOLVABLE,
} from './validate-record-title.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Every call below records what it fired, and the last cases hold
// each recorded `fix:` line to one line of at most 200 characters — the pin
// covers every variant this suite exercises. Run the whole file.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateRecordTitle: typeof validateRecordTitleUnrecorded = (...args) => {
  const findings = validateRecordTitleUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/** One-object stack; `fields` is a name-keyed map (the parsed-config shape). */
function objStack(obj: Record<string, unknown>) {
  return { objects: [{ name: 'invoice', ...obj }] };
}

describe('validateRecordTitle (record-title contract, ADR-0079)', () => {
  it('an object with an explicit nameField is clean', () => {
    const findings = validateRecordTitle(
      objStack({ nameField: 'title', fields: { title: { type: 'text' } } }),
    );
    expect(findings).toHaveLength(0);
  });

  it('a deprecated displayNameField alias still resolves (no warning)', () => {
    const findings = validateRecordTitle(
      objStack({ displayNameField: 'subject', fields: { subject: { type: 'text' } } }),
    );
    expect(findings).toHaveLength(0);
  });

  it('a derivable title-eligible field (no explicit pointer) is clean', () => {
    // `name` is derivable → completeness status 'derived', not 'none'.
    const findings = validateRecordTitle(
      objStack({ fields: { name: { type: 'text' } } }),
    );
    expect(findings).toHaveLength(0);
  });

  it('warns (not errors) when titleFormat is declared', () => {
    const findings = validateRecordTitle(
      objStack({
        titleFormat: '{{record.first}} {{record.last}}',
        fields: { name: { type: 'text' } },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(TITLE_FORMAT_RETIRED);
    expect(findings[0].where).toBe('object "invoice"');
    expect(findings[0].path).toBe('objects[0]');
    expect(findings[0].message).toContain('titleFormat is retired (ADR-0079)');
    expect(findings[0].message).toContain('migrate to nameField');
    expect(findings[0].hint).toContain('nameField');
  });

  it('warns (not errors) when no title is resolvable (status: none)', () => {
    const findings = validateRecordTitle(
      objStack({ fields: { amount: { type: 'currency' }, when: { type: 'date' } } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(TITLE_UNRESOLVABLE);
    expect(findings[0].message).toContain('no resolvable record title');
    expect(findings[0].hint).toContain('nameField');
  });

  it('a nameField that points at a not-yet-present field (synthesized) is not flagged', () => {
    // status 'synthesized' (pointer set, field absent) is not 'none' → silent;
    // the runtime materializes the primary.
    const findings = validateRecordTitle(
      objStack({ nameField: 'name', fields: { amount: { type: 'currency' } } }),
    );
    expect(findings).toHaveLength(0);
  });

  it('reports BOTH rules when an object has titleFormat and no resolvable title', () => {
    const findings = validateRecordTitle(
      objStack({
        titleFormat: '{{record.amount}}',
        fields: { amount: { type: 'currency' } },
      }),
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.rule).sort()).toEqual(
      [TITLE_FORMAT_RETIRED, TITLE_UNRESOLVABLE].sort(),
    );
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('an empty-string titleFormat is not flagged', () => {
    const findings = validateRecordTitle(
      objStack({ titleFormat: '', fields: { name: { type: 'text' } } }),
    );
    expect(findings).toHaveLength(0);
  });

  it('a stack with no objects is clean', () => {
    expect(validateRecordTitle({})).toHaveLength(0);
    expect(validateRecordTitle({ objects: [] })).toHaveLength(0);
  });
});

// [#22161] Slice 16: each `fix:` line names its remedy in one line; why
// `titleFormat` is retired, how a title resolves and the runtime's fallback are
// `os explain RULE_ID`, which both ids gain with this slice.
describe('[#22161] one-line fixes — title-format-retired and title-unresolvable', () => {
  it('every `fix:` line the cases above fired is one line of at most 200 characters', () => {
    // A long object name, so the bound is not read on a short one alone.
    validateRecordTitle({
      objects: [{ name: 'regional_enterprise_account_hierarchy_snapshot', titleFormat: '{{record.a}}', fields: {} }],
    });
    const converted = fired.filter((f) => f.rule === TITLE_FORMAT_RETIRED || f.rule === TITLE_UNRESOLVABLE);
    // Coverage control: both ids fired.
    expect(new Set(converted.map((f) => f.rule))).toEqual(new Set([TITLE_FORMAT_RETIRED, TITLE_UNRESOLVABLE]));
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('each reads as one remedy', () => {
    const findings = validateRecordTitle(objStack({ titleFormat: '{{record.amount}}', fields: { amount: { type: 'currency' } } }));
    const byRule = new Map(findings.map((f) => [f.rule, f.hint]));
    expect(byRule.get(TITLE_FORMAT_RETIRED)).toBe(
      "Set nameField: '<field>' for a single-field title, or add a formula field (returnType: 'text') and " +
        'designate it via nameField; then drop titleFormat',
    );
    expect(byRule.get(TITLE_UNRESOLVABLE)).toBe(
      "Set nameField to a text/email field (or a formula field with returnType: 'text'), or add a text " +
        'field named "name"/"title"',
    );
  });

  it('`os explain` carries what the two `fix:` lines no longer say', () => {
    const facts: Record<string, readonly string[]> = {
      [TITLE_FORMAT_RETIRED]: [
        'render-only template',
        'neither return the title it draws nor query by it',
        'an explicit `nameField` takes precedence',
        'ADR-0079',
        'the schema still parses the key',
      ],
      [TITLE_UNRESOLVABLE]: [
        'auto-provisions a primary',
        '`Record #ID` floor',
        'An explicit title is far more useful',
        '`objectTitleCompleteness`',
      ],
    };
    for (const [rule, list] of Object.entries(facts)) {
      const entry = explainRule(rule);
      expect(entry, `no \`os explain ${rule}\` entry`).toBeDefined();
      const text = entry!.paragraphs.join('\n');
      for (const fact of list) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
    }
  });

  it("the unresolvable explanation's eligible types are the spec's `TITLE_ELIGIBLE_TYPES`", () => {
    // The explanation module imports nothing, so it spells the list out.
    const text = explainRule(TITLE_UNRESOLVABLE)!.paragraphs.join('\n');
    expect(TITLE_ELIGIBLE_TYPES.size).toBeGreaterThan(0);
    for (const type of TITLE_ELIGIBLE_TYPES) expect(text, type).toContain(`\`${type}\``);
  });
});
