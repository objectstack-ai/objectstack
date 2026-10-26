/**
 * `notifications.badge*` — the bell-badge breakdown strings (#7233).
 *
 * `badgeTotal` is interpolated with the **named** placeholder `{{total}}`, not
 * i18next's `{{count}}`: "4 total" agrees with no noun, so it carries no plural
 * forms, and `count` would send i18next looking for `_one` / `_other`.
 *
 * The two addends DO agree with a noun — "1 notification", "1 pending
 * approval" — so since objectui#13133 they are count families: the call site
 * passes `count` and every pack spells `{{count}}` in the base key and in every
 * slot. A pack that kept the retired `{{unread}}` / `{{approvals}}` would not
 * fail loudly — i18next renders the literal hole as an empty string — so the
 * placeholder is pinned here per slot. Which slots a pack carries is owned by
 * `all-locales-key-parity.test.ts`; that i18next selects them, by
 * `plural-categories-11432.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

const readPath = (node: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (acc, seg) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined,
      node,
    );

const NAMED = [{ key: 'notifications.badgeTotal', placeholder: 'total' }] as const;

const FAMILIES = [
  { key: 'notifications.badgeNotifications', retired: 'unread' },
  { key: 'notifications.badgeApprovals', retired: 'approvals' },
] as const;

const SUFFIXES = ['', '_zero', '_one', '_two', '_few', '_many', '_other'] as const;

const LOCALES = Object.keys(builtInLocales) as (keyof typeof builtInLocales)[];

describe.each(LOCALES)('%s notifications.badge* (#7233)', (code) => {
  it.each(NAMED)('$key is a non-empty string carrying {{$placeholder}}', ({ key, placeholder }) => {
    const value = readPath(builtInLocales[code], key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
    expect(value as string).toContain(`{{${placeholder}}}`);
    // `count` would send i18next looking for `<key>_one` / `<key>_other`.
    expect(value as string).not.toContain('{{count}}');
  });

  it.each(FAMILIES)('$key is a count family whose every slot carries {{count}} (#13133)', ({ key, retired }) => {
    const slots = SUFFIXES.map((suffix) => [suffix, readPath(builtInLocales[code], key + suffix)] as const).filter(
      ([, value]) => value !== undefined,
    );
    // The base key plus at least `_one` / `_other`.
    expect(slots.map(([suffix]) => suffix)).toEqual(expect.arrayContaining(['', '_one', '_other']));
    for (const [, value] of slots) {
      expect(typeof value).toBe('string');
      expect(value as string).toContain('{{count}}');
      expect(value as string).not.toContain(`{{${retired}}}`);
    }
  });
});
