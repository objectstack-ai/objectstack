// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7481 — the tool-step list read
 *
 *   ✓ 查看对象结构 ×3      已完成
 *   ✓ 读取元数据结构        已完成
 *   ✓ 列出对象 ×2          已完成
 *   ✓ Get authoring rules  已完成
 *
 * on a zh console: `get_authoring_rules` (cloud#1837) had no `chatbot.tool.*`
 * entry, so `humanizeToolName` fell through to its English title-caser — the
 * exact cloud#1658 symptom, one tool at a time, and it recurs every time the
 * cloud AI packages register a tool.
 *
 * The registry (`@objectstack/spec`'s `PLATFORM_TOOLS_BY_PACKAGE`) is the
 * contract, so it is what this suite reads. The pinned spec could LAG the cloud
 * runtime, and a step label the user reads must not wait on a pin bump, so the
 * coverage set is `registry ∪ AHEAD_OF_PIN` — a hand-held escape hatch for names
 * the snapshot has not listed yet. A member the registry has caught up with must
 * be REMOVED from that list, which the last case here enforces, so the hand-held
 * half shrinks rather than growing into a second, permanent registry.
 *
 * ⭐ IT HAS SHRUNK TO NOTHING, AND THAT IS THE MECHANISM WORKING. The five names
 * this file was written around — `get_authoring_rules` (cloud#1837),
 * `load_tools`, `open_record`, `test_flow`, `toggle_flow` — are all in
 * `PLATFORM_TOOLS_BY_PACKAGE` as of `@objectstack/spec` 17.4.0, so
 * {@link AHEAD_OF_PIN} is empty and coverage is the registry alone
 * (objectui#8772 took the pin there). ⛔ The list is kept, not deleted: the next
 * tool the cloud registers ahead of a snapshot needs the same hatch, and
 * rebuilding it under pressure is how a permanent second registry starts.
 * {@link GRADUATED} keeps this file's guards honest while the list is empty —
 * see its note.
 *
 * The English pin that used to stand here — every `en` value byte-equal to the
 * title-caser's output — is retired with the rule it held (objectui#12724,
 * cloud#2927 Target 3, ruled 「同意」): every value, `en` included, is now a
 * sentence in its language, and `toolLabels-sentences-12724.test.ts` beside
 * this file holds the opposite assertion — no value equals the tool id or the
 * title-caser's output for it.
 */
import { describe, it, expect } from 'vitest';
import * as specSystem from '@objectstack/spec/system';
import { builtInLocales } from '@object-ui/i18n/locales';
import { humanizeToolName, toolTitleKey } from '../tool-display.js';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const REGISTRY = (
  specSystem as { PLATFORM_TOOLS_BY_PACKAGE?: Readonly<Record<string, readonly string[]>> }
).PLATFORM_TOOLS_BY_PACKAGE;

/**
 * Tools the cloud AI runtime registers that the PINNED spec snapshot does not
 * list yet — sourced from cloud `service-ai-studio`'s `plugin.ts` tool
 * definitions. Shrink this list on a pin bump — never grow it as a habit.
 *
 * EMPTY at this pin: every name it carried has graduated (see {@link GRADUATED}).
 */
const AHEAD_OF_PIN: readonly string[] = [];

/**
 * The names that HAVE graduated from {@link AHEAD_OF_PIN} into the registry.
 *
 * ⛔ Not a record for its own sake — it is the live instrument this file needs
 * while `AHEAD_OF_PIN` is empty. Every guard below was anchored on that list
 * being non-empty, so with it emptied they would read green against a
 * `PLATFORM_TOOLS_BY_PACKAGE` that had vanished, gone empty, or lost these very
 * names: `[].filter(…)` is `[]` and `arrayContaining([])` passes on anything.
 * Asserting these five ARE in the registry is the reading that cannot be
 * satisfied by an absent export, and it is the same fact the emptying rests on.
 */
const GRADUATED = ['get_authoring_rules', 'load_tools', 'open_record', 'test_flow', 'toggle_flow'] as const;

/** Every tool name that must carry a step label in every pack. */
const COVERED: string[] = [
  ...new Set([...Object.values(REGISTRY ?? {}).flat(), ...AHEAD_OF_PIN]),
].sort();

/** The pack's `chatbot.tool` block, reached through the one shape the reader uses. */
const toolsOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as { chatbot?: { tool?: Record<string, string> } }).chatbot?.tool;

/** A `useSafeTranslate()` stand-in bound to one pack — a real value wins, else the fallback. */
const ttFrom = (lang: LocaleCode) => (key: string, fallback: string): string => {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], builtInLocales[lang]);
  return typeof value === 'string' && value !== '' ? value : fallback;
};

describe('chatbot.tool.* covers every tool the runtime can show (objectui#7481)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it('reads a non-empty coverage set', () => {
    // Guards against the whole suite going vacuously green if the spec export
    // disappears. With `AHEAD_OF_PIN` empty the coverage set is the REGISTRY
    // alone, so the floor is read off the registry rather than off the
    // hand-held list — the two `AHEAD_OF_PIN` assertions that used to stand here
    // are both tautologies on an empty list.
    expect(REGISTRY, 'PLATFORM_TOOLS_BY_PACKAGE did not resolve').toBeTruthy();
    expect(COVERED.length).toBeGreaterThan(GRADUATED.length);
    expect(COVERED).toEqual(expect.arrayContaining([...GRADUATED, ...AHEAD_OF_PIN]));
  });

  it.each(LANGS)('%s defines a non-empty label for every covered tool', (lang) => {
    const block = toolsOf(lang);
    expect(block, `${lang} has no chatbot.tool block`).toBeTruthy();
    const missing = COVERED.filter((name) => {
      const value = block![name];
      return typeof value !== 'string' || value.trim() === '';
    });
    expect(missing, `${lang} is missing chatbot.tool entries`).toEqual([]);
  });

  it('AHEAD_OF_PIN carries only names the pinned registry still lacks', () => {
    // The moment the pin advances past a tool's registry entry, the hand-held
    // list must lose it — otherwise this file becomes a second registry that
    // nobody keeps in sync. This is the case that fired on the 17.4.0 bump and
    // named all five; they were removed rather than the assertion relaxed.
    const inRegistry = new Set(Object.values(REGISTRY ?? {}).flat());
    const caughtUp = AHEAD_OF_PIN.filter((name) => inRegistry.has(name));
    expect(caughtUp, 'remove these from AHEAD_OF_PIN — the pinned spec now lists them').toEqual([]);

    // ⚠️ The line above is a tautology while the list is empty, so it is not
    // left standing alone: the graduation it records is asserted directly. If
    // the registry ever stops listing one of these, THIS is what reddens —
    // and the repair would be to put that name back on `AHEAD_OF_PIN`.
    expect(GRADUATED.filter((name) => !inRegistry.has(name))).toEqual([]);
  });
});

describe('humanizeToolName resolves the newer tools through the pack (objectui#7481)', () => {
  it('zh: the card`s own step reads Chinese, not `Get authoring rules`', () => {
    expect(humanizeToolName('get_authoring_rules', ttFrom('zh'))).toBe('查阅编写规范');
    expect(humanizeToolName('get_authoring_rules', ttFrom('zh'))).not.toBe('Get authoring rules');
  });

  it('zh: the other four newly-mapped tools resolve too', () => {
    const tt = ttFrom('zh');
    for (const name of AHEAD_OF_PIN) {
      expect(humanizeToolName(name, tt), name).toBe(toolsOf('zh')![name]);
    }
  });

  it('an UNKNOWN tool still degrades to the English title-caser', () => {
    // The optionality this whole seam was built on (cloud#1658): a custom or
    // third-party tool must be no worse off than before.
    expect(humanizeToolName('forecast_revenue', ttFrom('zh'))).toBe('Forecast revenue');
    expect(toolTitleKey('forecast_revenue')).toBe('chatbot.tool.forecast_revenue');
  });
});
