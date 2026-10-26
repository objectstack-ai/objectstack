import { describe, it, expect } from 'vitest';
import { detectStatusField } from '../record-semantics';

describe('detectStatusField (ADR-0085 stageField role)', () => {
  it('returns null for missing defs', () => {
    expect(detectStatusField(undefined)).toBeNull();
    expect(detectStatusField(null)).toBeNull();
  });

  it('honours an explicit stageField role', () => {
    expect(
      detectStatusField({ stageField: 'pipeline', fields: { pipeline: {}, status: {} } }),
    ).toBe('pipeline');
  });

  it('stageField: false suppresses detection even with a status-named field', () => {
    expect(
      detectStatusField({ stageField: false, fields: { status: { type: 'select' } } }),
    ).toBeNull();
  });

  it('falls back to conventional names in order', () => {
    expect(detectStatusField({ fields: { phase: {}, stage: {} } })).toBe('stage');
    expect(detectStatusField({ fields: { state: {} } })).toBe('state');
  });

  it('falls back to status/stage TYPES when no conventional name exists', () => {
    expect(
      detectStatusField({ fields: { lifecycle: { type: 'Status' } } }),
    ).toBe('lifecycle');
  });

  it('returns null when nothing matches — callers must not invent a field', () => {
    expect(detectStatusField({ fields: { name: { type: 'text' } } })).toBeNull();
  });
});
