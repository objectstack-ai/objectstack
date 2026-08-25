import { describe, it, expect } from 'vitest';
import { FeedItemType, FeedFilterMode, SYS_ACTIVITY_BUILTIN_TYPES } from './feed.zod';

describe('FeedItemType', () => {
  it('should accept all valid feed item types', () => {
    const types = [
      'comment', 'field_change', 'task', 'event', 'email', 'call',
      'note', 'file', 'record_create', 'record_delete', 'approval',
      'sharing', 'system',
    ];
    types.forEach(type => {
      expect(() => FeedItemType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid types', () => {
    expect(() => FeedItemType.parse('unknown')).toThrow();
    expect(() => FeedItemType.parse('')).toThrow();
  });
});

describe('SYS_ACTIVITY_BUILTIN_TYPES (#11807)', () => {
  /**
   * Mechanical invariants only. The semantic pin — every entry has a recorded
   * writer disposition — lives with the object that declares the column:
   * `plugin-audit/src/objects/sys-activity-type-vocabulary.test.ts` (the writer
   * census). That census reads the object's declared options, and the object
   * derives them from this constant, so an edit here without a census redo goes
   * red THERE. Duplicating the census literal in this package would create a
   * second inventory that can drift from the first — exactly what #11807 exists
   * to end.
   */
  it('is a non-empty set of unique snake_case machine names', () => {
    expect(SYS_ACTIVITY_BUILTIN_TYPES.length).toBeGreaterThan(0);
    expect(new Set(SYS_ACTIVITY_BUILTIN_TYPES).size).toBe(SYS_ACTIVITY_BUILTIN_TYPES.length);
    for (const type of SYS_ACTIVITY_BUILTIN_TYPES) {
      // Machine-name convention (Prime Directive #3), and also what guarantees
      // Field.select()'s snake_case option normalization is an identity when
      // the sys_activity declaration spreads this constant into its options.
      expect(type).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  /**
   * The vocabulary is OPEN (#11507): the published shape must not be able to
   * reject anything. A plain readonly tuple has no parse/validate affordance;
   * a z.enum here would read as a value-domain validator and re-close the
   * vocabulary the day someone calls .parse() with it.
   */
  it('is a plain tuple, not a Zod schema — the open vocabulary must not gain a validator', () => {
    expect(Array.isArray(SYS_ACTIVITY_BUILTIN_TYPES)).toBe(true);
    expect(
      (SYS_ACTIVITY_BUILTIN_TYPES as unknown as { parse?: unknown }).parse,
    ).toBeUndefined();
    expect(
      (SYS_ACTIVITY_BUILTIN_TYPES as unknown as { safeParse?: unknown }).safeParse,
    ).toBeUndefined();
  });
});

describe('FeedFilterMode', () => {
  it('should accept valid filter modes', () => {
    ['all', 'comments_only', 'changes_only', 'tasks_only'].forEach(mode => {
      expect(() => FeedFilterMode.parse(mode)).not.toThrow();
    });
  });

  it('should reject invalid filter mode', () => {
    expect(() => FeedFilterMode.parse('custom')).toThrow();
  });
});
