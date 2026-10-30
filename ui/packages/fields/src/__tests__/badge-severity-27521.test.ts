/**
 * objectstack#27521 row 4 — a severity value with no declared colour reads in
 * the severity colours, not in a hashed one: `info` was drawn orange, the
 * colour of an alarm, for being the quietest level.
 */
import { describe, it, expect } from 'vitest';
import { getBadgeColorClasses, getSemanticColorName } from '../index';

describe('severity values with no declared colour (objectstack#27521)', () => {
  it('info is blue and warning is yellow', () => {
    expect(getBadgeColorClasses(undefined, 'info')).toContain('bg-blue-50');
    expect(getBadgeColorClasses(undefined, 'warning')).toContain('bg-yellow-50');
    expect(getSemanticColorName(undefined, 'info')).toBe('blue');
  });

  it('CONTROL: critical stays red, and a declared colour still wins', () => {
    expect(getBadgeColorClasses(undefined, 'critical')).toContain('bg-red-50');
    expect(getBadgeColorClasses('green', 'info')).toContain('bg-green-50');
  });
});
