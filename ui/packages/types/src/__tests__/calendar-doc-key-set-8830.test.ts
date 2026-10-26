/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8830 — the calendar plugin page's "CalendarConfig" section states a
 * KEY SET and a COUNT. Both are now derived from the two sources they describe,
 * on every run, instead of being maintained by hand.
 *
 * ## The defect
 *
 * The section carried one sentence that fused two different faces into a single
 * false claim: that `CalendarConfig` is the spec's strict four-key schema, that
 * "a fifth key is rejected rather than ignored", and that `ObjectCalendar`
 * "destructures exactly" those same four — "so the list above is also the whole
 * of what the renderer reads".
 *
 * Measured on the dispatch base, with `@objectstack/spec` 17.4.0 installed then:
 *
 *   SPEC FACE      `CalendarConfigSchema` is a strict object of exactly
 *                  `startDateField` / `endDateField` / `titleField` /
 *                  `colorField`, and refuses `allDayField` BY NAME with an
 *                  `unrecognized_keys` diagnostic. True, and the only half the
 *                  old sentence got right.
 *   RENDERER FACE  `ObjectCalendar` reads FIVE keys off the `calendar` block —
 *                  those four plus objectui's own `allDayField`, load-bearing
 *                  since objectui#8026.
 *   AUTHORING FACE `a fifth key is rejected` is false on both objectui paths.
 *                  Neither published face of `ObjectCalendarSchema` declares the
 *                  `calendar` container at all, so the block rides
 *                  `BaseSchema`'s passthrough unexamined; on the list-view path
 *                  the container IS declared, as this package's own mirror of
 *                  the spec schema, which keeps `.passthrough()` for exactly
 *                  this. Both admit `allDayField`.
 *
 * ## ⛔ Why this file is a DERIVATION and not a corrected number
 *
 * The enumeration had already drifted once — `allDayField` became load-bearing
 * in objectui#8026 and the page was never revisited — and the card that caught
 * it measured only the one key it happened to notice. Adding that key to the
 * list would reproduce the same hand-maintained enumeration with a fresher
 * value in it. So nothing here is restated: the renderer's key set is parsed out
 * of `ObjectCalendar.tsx` and the spec's out of `CalendarConfigSchema.shape`,
 * and the page is compared against both. A red here always means "the page
 * drifted from the renderer (or the spec)", never "update the test".
 *
 * ⚠️ The derivation FAILS LOUDLY rather than vacuously. A renamed resolver, a
 * renamed local, or a moved section throws — an empty key set can never pass as
 * agreement, which is the failure mode a hand-written list has by construction.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CalendarConfigSchema } from '@objectstack/spec/ui';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const ROOT = uiRoot();
const RENDERER = join(ROOT, 'packages/plugin-calendar/src/ObjectCalendar.tsx');
const DOC_PAGE = join(ROOT, 'content/docs/plugins/plugin-calendar.mdx');
const SECTION = '### CalendarConfig';

/** Blank comments out but keep every newline, so nothing shifts under us. */
function withoutComments(src: string): string {
  return mask(src);
}

/**
 * Every key `ObjectCalendar` reads off the resolved calendar config, from the
 * three constructs that can read one: the resolver's own return arms, the
 * destructures of the resolved config, and its member reads.
 */
function rendererConfigKeys(): Set<string> {
  const code = withoutComments(readFileSync(RENDERER, 'utf8'));
  const keys = new Set<string>();

  const start = code.indexOf('function getCalendarConfig');
  if (start < 0) throw new Error(`getCalendarConfig not found in ${RENDERER}`);
  let depth = 0;
  let end = -1;
  for (let i = code.indexOf('{', start); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error(`unterminated getCalendarConfig in ${RENDERER}`);
  const body = code.slice(start, end);

  // 1. The arms that BUILD a config: `titleField: (schema as any).titleField,`
  for (const m of body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*\(schema as any\)/gm)) keys.add(m[1]);
  // 2. `const { a, b } = calendarConfig;`
  for (const m of code.matchAll(/const\s*\{([^}]*)\}\s*=\s*calendarConfig\b/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(':')[0].trim();
      if (name) keys.add(name);
    }
  }
  // 3. `calendarConfig.titleField` / `calendarConfig?.titleField`
  for (const m of code.matchAll(/calendarConfig\??\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);

  if (keys.size === 0) throw new Error(`derived an EMPTY config key set from ${RENDERER}`);
  return keys;
}

/** The `### CalendarConfig` section of the page, up to the next level-2 heading. */
function docSection(): string {
  const page = readFileSync(DOC_PAGE, 'utf8');
  const from = page.indexOf(SECTION);
  if (from < 0) throw new Error(`"${SECTION}" not found in ${DOC_PAGE}`);
  const rest = page.slice(from + SECTION.length);
  const to = rest.search(/^## /m);
  return rest.slice(0, to < 0 ? undefined : to);
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

describe('objectui#8830 — the page states the renderer\'s key set, derived on every run', () => {
  it('the renderer reads the four spec keys plus objectui\'s own `allDayField`', () => {
    // Not the assertion this file exists for — the control that proves the
    // derivation above is reading the renderer and not producing noise.
    expect([...rendererConfigKeys()].sort()).toEqual([
      'allDayField', 'colorField', 'endDateField', 'startDateField', 'titleField',
    ]);
  });

  it('the section\'s inline key list is exactly what the renderer reads', () => {
    const section = docSection().replace(/```[\s\S]*?```/g, '');
    const spans = [...section.matchAll(/`\{([^`{}]+)\}`/g)];
    expect(spans, `${SECTION} states no inline key list`).toHaveLength(1);
    const stated = spans[0][1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    expect(stated).toEqual([...rendererConfigKeys()].sort());
  });

  it('the count the section states is the count the renderer answers', () => {
    const section = docSection();
    const derived = rendererConfigKeys().size;
    const word = NUMBER_WORDS[derived];
    expect(word, `no English word for a set of ${derived}`).toBeDefined();
    expect(section).toContain(`reads **${word}** keys`);
    // The stale claim this card removed, pinned as absent: the renderer's read
    // set is NOT the spec's accept set, and the page must never say it is.
    expect(section).not.toContain('these four are the whole of it');
  });

  it('the section\'s `plaintext` fence still describes the SPEC type, not the renderer\'s set', () => {
    // ⛔ The wrong repair for this drift is shoving `allDayField` into the fence:
    // `CalendarConfig` is a re-export of the spec's schema and that key is
    // refused there by name. The fence tracks the spec; the prose tracks the
    // renderer; the two are different sets on purpose.
    const fence = /```plaintext\n([\s\S]*?)```/.exec(docSection());
    if (!fence) throw new Error(`${SECTION} has no plaintext fence`);
    const listed = [...fence[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\??\s*:/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(Object.keys((CalendarConfigSchema as unknown as { shape: Record<string, unknown> }).shape).sort());
  });

  it('the spec schema accepts `allDayField` since 17.5.0, and still refuses an undeclared key BY NAME', () => {
    // Through `@objectstack/spec` 17.4.0 this row asserted `allDayField` as the
    // REFUSED fifth key. 17.5.0 declares it (objectui#11073), so the fence above
    // lists five keys and the refusal half moves to a key the spec never had.
    const five = { startDateField: 's', endDateField: 'e', titleField: 't', colorField: 'c', allDayField: 'isAllDay' };
    expect(CalendarConfigSchema.safeParse(five).success).toBe(true);
    const refused = CalendarConfigSchema.safeParse({ ...five, dateField: 'kickoff' });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.error.issues.map((i) => i.code)).toContain('unrecognized_keys');
      expect(JSON.stringify(refused.error.issues)).toContain('dateField');
    }
  });
});
