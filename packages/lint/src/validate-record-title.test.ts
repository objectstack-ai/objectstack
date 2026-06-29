import { describe, it, expect } from 'vitest';
import {
  validateRecordTitle,
  TITLE_FORMAT_RETIRED,
  TITLE_UNRESOLVABLE,
} from './validate-record-title.js';

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
