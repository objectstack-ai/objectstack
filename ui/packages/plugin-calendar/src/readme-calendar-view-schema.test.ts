/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `packages/plugin-calendar/README.md`'s "Schema API -> CalendarView" fence
 * describes real `CalendarViewSchema` keys, with the requiredness the schema
 * actually declares (objectui#5045).
 *
 * ## Why this file exists
 *
 * The fence had drifted from the type in four separate ways at once, and every
 * one of them was reader-facing on the npm landing page:
 *
 *   - `events?` — the schema's ONLY required key besides `type`, published as
 *     optional. A reader following the README omits it and TypeScript rejects
 *     the node;
 *   - `defaultDate?: string` — the schema says `string | Date`;
 *   - `onDateClick` — not on `CalendarViewSchema` at all. It is a
 *     `CalendarViewProps` prop, i.e. a different package's *component* surface,
 *     so the README sent readers to a key the schema does not have;
 *   - six keys of thirteen listed, with nothing saying the list was partial.
 *
 * Nothing was holding the fence to the type, so all four drifted silently and
 * were found by reading. That is the failure mode `readme-registration-keys`
 * in `@object-ui/layout` names for the same class of defect: "someone read it"
 * is not a mechanism. This card's fix was another hand-correction; this pin is
 * what stops the next one being needed.
 *
 * ## Exhaustiveness is deliberately NOT asserted
 *
 * The fence is a declared PARTIAL summary — it names the author-facing keys and
 * points at `CalendarViewSchema` for the rest. A pin demanding all thirteen
 * would convert an editorial choice into a gate and force every future schema
 * key into the README. What is asserted is the direction that misleads a
 * reader: a key the README names must EXIST, and must carry the requiredness
 * the schema gives it.
 *
 * ## Both sides are parsed from source, never restated here
 *
 * Hardcoding the key list in this file would reproduce the defect one layer up
 * — the README was itself a confident hand-written restatement of the schema.
 * So `CalendarViewSchema` and `BaseSchema` are read out of
 * `packages/types/src/*.ts` on every run, and a red test here always means "fix
 * the README (or the schema)", never "update the test". A moved or renamed
 * interface fails LOUDLY rather than vacuously passing an empty key set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { uiRoot } from '../../../scripts/ui-root.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const ROOT = uiRoot();
const README = join(ROOT, 'packages/plugin-calendar/README.md');

interface Key {
  optional: boolean;
}

/**
 * The own (not inherited) property declarations of a TS interface, by brace
 * matching rather than a line regex — the bodies here carry JSDoc blocks and
 * function types with their own braces and semicolons.
 */
function interfaceKeys(file: string, name: string): Map<string, Key> {
  const src = readFileSync(file, 'utf8');
  const opener = new RegExp(`export interface ${name}\\b[^{]*\\{`).exec(src);
  if (!opener) throw new Error(`interface ${name} not found in ${file}`);

  let i = opener.index + opener[0].length;
  const start = i;
  for (let depth = 1; depth > 0; i += 1) {
    if (i >= src.length) throw new Error(`unterminated interface ${name} in ${file}`);
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }

  const body = mask(src.slice(start, i - 1));

  const keys = new Map<string, Key>();
  let depth = 0;
  let buf = '';
  const flush = () => {
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:/.exec(buf.trim());
    if (m) keys.set(m[1], { optional: Boolean(m[2]) });
    buf = '';
  };
  for (const ch of body) {
    if ('{(['.includes(ch)) depth += 1;
    if ('})]'.includes(ch)) depth -= 1;
    if ((ch === ';' || ch === '\n') && depth === 0) flush();
    else buf += ch;
  }
  flush();

  if (keys.size === 0) throw new Error(`parsed zero keys out of ${name} in ${file}`);
  return keys;
}

/** The "Schema API -> CalendarView" fence, and the keys it publishes. */
function readmeFence(): { keys: Map<string, Key>; ownCountClaim: number } {
  const src = readFileSync(README, 'utf8');
  const heading = src.indexOf('\n### CalendarView\n');
  if (heading < 0) throw new Error('"### CalendarView" heading not found in the README');

  const section = src.slice(heading, src.indexOf('\n### ', heading + 1));
  const fence = /```typescript\n([\s\S]*?)\n```/.exec(section);
  if (!fence) throw new Error('no typescript fence under "### CalendarView"');

  const keys = new Map<string, Key>();
  for (const line of fence[1].split('\n')) {
    const m = /^ {2}([A-Za-z_$][\w$]*)(\?)?:/.exec(line);
    if (m) keys.set(m[1], { optional: Boolean(m[2]) });
  }
  if (keys.size === 0) throw new Error('parsed zero keys out of the README fence');

  const claim = /declares (\d+) keys of\s+its own/.exec(section);
  if (!claim) throw new Error('the fence no longer states how many keys the schema declares');

  return { keys, ownCountClaim: Number(claim[1]) };
}

const TYPES = join(ROOT, 'packages/types/src');
const own = interfaceKeys(join(TYPES, 'complex.ts'), 'CalendarViewSchema');
const base = interfaceKeys(join(TYPES, 'base.ts'), 'BaseSchema');
const fence = readmeFence();

describe('plugin-calendar README: "Schema API -> CalendarView"', () => {
  it('names only keys `CalendarViewSchema` or `BaseSchema` actually declares', () => {
    const phantom = [...fence.keys.keys()].filter((k) => !own.has(k) && !base.has(k));
    expect(
      phantom,
      `README publishes ${JSON.stringify(phantom)} as \`calendar-view\` schema keys, but ` +
        'neither `CalendarViewSchema` nor `BaseSchema` declares them. `onDateClick` is the ' +
        'original offender: a `CalendarViewProps` component prop, not a schema key.',
    ).toEqual([]);
  });

  it('gives every key the requiredness the schema declares', () => {
    const wrong: string[] = [];
    for (const [key, { optional }] of fence.keys) {
      const declared = own.get(key) ?? base.get(key);
      if (declared && declared.optional !== optional) {
        wrong.push(`${key}: README says ${optional ? 'optional' : 'required'}, schema says ${declared.optional ? 'optional' : 'required'}`);
      }
    }
    expect(
      wrong,
      'The README must not restate the schema\'s requiredness incorrectly — `events` is the ' +
        'schema\'s only required key besides `type`, and was published as `events?`.',
    ).toEqual([]);
  });

  it('states the number of keys `CalendarViewSchema` declares, and states it correctly', () => {
    expect(
      fence.ownCountClaim,
      'The README tells readers how many keys the full schema has. That figure is prose and ' +
        'drifts like any other; it is held to the interface here.',
    ).toBe(own.size);
  });
});
