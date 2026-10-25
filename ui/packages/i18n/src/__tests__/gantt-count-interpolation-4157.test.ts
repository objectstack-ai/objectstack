/**
 * The three `{count}` gantt dialog strings use i18next `{{count}}`
 * interpolation in every pack (objectui#4157).
 *
 * ## The defect this pins
 *
 * `gantt.conflict.body` was authored with SINGLE braces and resolved by a
 * literal `t(key).replace('{count}', n)` at the call site. All ten packs were
 * later written (correctly, by i18next convention) with `{{count}}` — and
 * `"…{{count}}…".replace("{count}", "2")` consumes the INNER seven characters,
 * leaving `{2}` on screen. The user-visible symptom was a literal `{2}` in the
 * conflict dialog under every loaded locale.
 *
 * Nothing caught it, and that is the interesting part:
 *
 *  - `all-locales-key-parity`'s placeholder check compares placeholder *shape*
 *    between packs. All ten packs agreed with each other, so it stayed green.
 *  - `check:i18n-en-drift` compares an `en` value against its own history — the
 *    packs never drifted from `en`, they were born matching it.
 *  - `check:i18n-call-site-keys` reads KEYS, never interpolation syntax.
 *
 * The invariant no existing gate can express is the **absolute** form: pack
 * spelling versus the syntax the render call site actually resolves. This file
 * asserts it directly, the same way `gantt-quickfilter-locale-parity.test.ts`
 * pins the opposite (deliberately single-brace) convention for
 * `gantt.quickFilter.resultSummary`.
 *
 * The two sibling keys (`autoScheduleDlg.body` / `.skipped`) were NOT broken —
 * they were single-brace on both sides and rendered correctly. They are
 * converted with the defect so the gantt's two write-confirmation dialogs stop
 * carrying two different interpolation idioms three lines apart in
 * `GanttView.tsx`, which is how the conflict key drifted in the first place.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

/** Dotted paths under `gantt.` whose call site passes `{ count }` to `t()`. */
const COUNT_KEYS = [
  'conflict.body',
  'autoScheduleDlg.body',
  'autoScheduleDlg.skipped',
] as const;

const LANGS = Object.keys(builtInLocales);

/** A `{word}` NOT wrapped in a second pair of braces. */
const SINGLE_BRACE = /(?<!\{)\{\w+\}(?!\})/;

const at = (lang: string, dotted: string): string | undefined =>
  dotted
    .split('.')
    .reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], (builtInLocales as Record<string, unknown>)[lang]) as
    | string
    | undefined;

describe('gantt count-interpolation spelling (objectui#4157)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s spells every count placeholder as i18next {{count}}', (lang) => {
    for (const key of COUNT_KEYS) {
      const value = at(lang, `gantt.${key}`);
      expect(typeof value, `${lang}.gantt.${key} is missing`).toBe('string');
      expect(value, `${lang}.gantt.${key} lost its {{count}} placeholder`).toContain('{{count}}');
      // The absolute form is the point: a pack respelled to `{count}` renders
      // the raw placeholder now that the call site passes `{ count }` to
      // i18next instead of doing a literal string replace.
      expect(
        SINGLE_BRACE.test(value!),
        `${lang}.gantt.${key} still carries a single-brace placeholder: ${value}`,
      ).toBe(false);
    }
  });

  it('the English pack still reads as the source of the bundled defaults', () => {
    // Byte-exact: `plugin-gantt`'s standalone fallback map (used when the gantt
    // is embedded without an I18nProvider) must agree with the `en` pack, or a
    // provider-less embed disagrees with an `en` session. Asserted as literals
    // rather than by importing the plugin — `@object-ui/plugin-gantt` depends
    // on this package, so reading it back here would invert the dependency.
    expect(at('en', 'gantt.conflict.body')).toBe(
      'This move conflicts with dependency constraints. Auto-reschedule {{count}} affected task(s)?',
    );
    expect(at('en', 'gantt.autoScheduleDlg.body')).toBe(
      'Shift {{count}} task(s) later to satisfy dependency links?',
    );
    expect(at('en', 'gantt.autoScheduleDlg.skipped')).toBe(
      '{{count}} locked task(s) also violate links and were skipped.',
    );
  });
});
