/**
 * objectstack#27521 row 4 — `info` was drawn orange, the colour of an alarm,
 * for being the quietest level. The first remedy taught the renderer's value
 * table `info` and `warning`; the ruling on objectstack#36882 (option A,
 * comment 7178358629) moved the remedy to the declaration: a select option is
 * coloured if and only if its author declared a colour, so a severity field
 * that wants severity colours declares them on its options (the platform's
 * `sys_notification.severity` does, pinned in `@objectstack/platform-objects`).
 *
 * This file pins both halves at the helper: the declared path paints the
 * severity colours, and no colour is ever derived from the value.
 */
import { describe, it, expect } from 'vitest';
import { getBadgeColorClasses, getSemanticColorName } from '../index';

/** Any palette-family utility, light or `dark:`. */
const FAMILY_CLASS = /(^|\s)(dark:)?(bg|text|border)-(gray|red|orange|yellow|green|blue|indigo|purple|pink)-\d/;
const NEUTRAL = 'bg-muted text-muted-foreground border-border';

describe('severity values with declared colours (objectstack#27521, objectstack#36882)', () => {
  it('a declared info is blue, warning yellow and critical red', () => {
    expect(getBadgeColorClasses('blue', 'info')).toContain('bg-blue-50');
    expect(getBadgeColorClasses('yellow', 'warning')).toContain('bg-yellow-50');
    expect(getBadgeColorClasses('red', 'critical')).toContain('bg-red-50');
    expect(getSemanticColorName('blue', 'info')).toBe('blue');
  });

  it('the declaration decides, not the value: a declared colour wins over any reading of the value', () => {
    expect(getBadgeColorClasses('green', 'info')).toContain('bg-green-50');
    expect(getBadgeColorClasses('#2563eb', 'critical')).toContain('bg-blue-50');
  });
});

describe('severity values with no declared colour render neutral (objectstack#36882)', () => {
  it('info, warning and critical carry no palette family, light or dark', () => {
    for (const value of ['info', 'warning', 'critical']) {
      const classes = getBadgeColorClasses(undefined, value);
      expect(classes).toBe(NEUTRAL);
      expect(classes).not.toMatch(FAMILY_CLASS);
      expect(getSemanticColorName(undefined, value)).toBeUndefined();
    }
  });

  it('CONTROL: the family pattern does match a declared family, light and dark', () => {
    const classes = getBadgeColorClasses('red', 'critical');
    expect(classes).toMatch(FAMILY_CLASS);
    expect(classes).toMatch(/(^|\s)dark:bg-red-/);
  });
});
