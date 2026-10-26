/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10928 — what a content channel on a reads-NEITHER node drew, stated
 * for BOTH tiers.
 *
 * The family-D / E3 refusals (objectui#9256) explain why `body` and `children`
 * are refused by name on a node whose renderer reads neither: an authored value
 * rendered NOTHING. They used to go on "no error, no warning, no element". The
 * render half of that is true — `SchemaRenderer` strips both keys out of the
 * props bag it spreads and no renderer reads them. The warning half was false:
 * the parser tier's `validateTree` (`@object-ui/sdui-parser`) warns
 * `not-a-container` for a child list under a registration that declares no
 * `children` input (objectui#9910), and it answers a `body` child list with the
 * same code (`checkRetiredBodyDialect`, objectui#6771). A reads-neither
 * registration declares no `children` input. So the clause now reads, on both
 * members, in the builders and in the literals alike:
 *
 *   "no render-time error or warning and no element; only the parser tier's
 *    `not-a-container` warning (objectui#9910) noticed it"
 *
 * ## Why this file pins the prose, and where the parser half is pinned
 *
 * `@object-ui/types` declares no workspace dependency, and its tests import
 * none: `@object-ui/sdui-parser` is not importable here without declaring it,
 * which a prose pin does not justify. The behaviour the clause describes is
 * held where the parser and the registry live, and those pins are named here
 * so a change to either side has a place to look:
 *
 *   - `containment-declared-slot-9910.test.ts` ("neither declared draws the
 *     warning") and `body-dialect-6771.test.ts` ("a `body` child list under a
 *     NON-container draws `not-a-container`") in `packages/sdui-parser`;
 *   - `container-declaration-ratchet.test.tsx` in `packages/components`, which
 *     holds declared-slot ⇔ rendered-list over the live registry in both
 *     directions, so a registration that renders no child list cannot declare
 *     the `children` input without going red there.
 *
 * The live-registry reading taken for this change (every registry key of
 * every reads-neither node, with a `div` control) is on objectui#10928's pull
 * request — a record of one run, not re-derived here.
 *
 * ## What is pinned, and what is deliberately not
 *
 * The clause as a substring, on the shared builder and on one arm from each of
 * the three sources that compose these messages (a literal, the shared
 * `neitherContentChannelGuidance`, and `ai.zod.ts`'s local builder), each read
 * through the arm's refusal with its code and path. Then the population: every
 * exported member whose refusal is the family-D sentence carries it, so a later
 * slice that copies an older literal goes red here. The rest of each message is
 * NOT pinned; the family's own pins read it.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as Z from '../zod/index.zod';
import { neitherContentChannelGuidance } from '../zod/tombstone.zod';
import { AccordionSchema } from '../zod/disclosure.zod';
import { ObjectGridSchema } from '../zod/objectql.zod';
import { AIFormAssistSchema } from '../zod/ai.zod';

/** The corrected clause, as every family-D / E3 refusal now carries it. */
const CLAUSE =
  "no render-time error or warning and no element; only the parser tier's `not-a-container` warning (objectui#9910) noticed it";

/** The clause it replaced — false about the parser tier. */
const RETIRED_CLAUSE = 'no error, no warning, no element';

/** The family-D sentence that marks a member as one of these refusals. */
const FAMILY_D = 'reads NEITHER content channel:';

const CONTENT = [{ type: 'text', content: 'x' }];
const CHANNELS = ['body', 'children'] as const;

/** The issue a schema raises at exactly this key, if any. */
const issueAt = (schema: z.ZodType, doc: Record<string, unknown>, key: string) => {
  const r = schema.safeParse(doc);
  return r.success ? undefined : r.error.issues.find((i) => i.path.length === 1 && i.path[0] === key);
};

describe('objectui#10928 — the shared builder states both tiers', () => {
  const text = neitherContentChannelGuidance('probe-node', 'probe route', '`probe`');

  it('carries the corrected clause exactly where the retired one stood', () => {
    expect(text).toContain(`rendered NOTHING — ${CLAUSE}. What it renders instead: \`probe\`.`);
  });

  it('no longer says the author got "no warning"', () => {
    expect(text).not.toContain(RETIRED_CLAUSE);
  });
});

describe('objectui#10928 — one arm per message source, read through its refusal', () => {
  const ARMS = [
    ['a literal (`accordion`)', AccordionSchema, 'accordion'],
    ['the shared builder (`object-grid`)', ObjectGridSchema, 'object-grid'],
    ['ai.zod.ts\'s local builder (`ai-form-assist`)', AIFormAssistSchema, 'ai-form-assist'],
  ] as const;

  for (const [source, schema, type] of ARMS) {
    it.each(CHANNELS)(`${source} — \`%s\` is refused by name, and the refusal names the parser tier's warning`, (key) => {
      const issue = issueAt(schema as unknown as z.ZodType, { type, [key]: CONTENT }, key);
      expect(issue?.code).toBe('invalid_type');
      expect(issue?.message).toContain(FAMILY_D);
      expect(issue?.message).toContain(CLAUSE);
      expect(issue?.message).not.toContain(RETIRED_CLAUSE);
    });
  }
});

describe('objectui#10928 — the population: every family-D refusal carries the corrected clause', () => {
  const members: { name: string; key: string; text: string }[] = [];
  for (const [name, value] of Object.entries(Z)) {
    if (!(value instanceof z.ZodObject)) continue;
    for (const key of CHANNELS) {
      const text = (value.shape as Record<string, z.ZodType | undefined>)[key]?.description;
      if (text?.includes(FAMILY_D)) members.push({ name, key, text });
    }
  }

  it('the walk reaches all three message sources (non-vacuity, by name rather than by count)', () => {
    const found = new Set(members.map((m) => `${m.name}.${m.key}`));
    for (const name of ['AccordionSchema', 'ObjectGridSchema', 'AIFormAssistSchema']) {
      for (const key of CHANNELS) expect(found, `${name}.${key}`).toContain(`${name}.${key}`);
    }
  });

  it('none of them still says "no error, no warning, no element", and each names `not-a-container`', () => {
    const stale = members.filter((m) => m.text.includes(RETIRED_CLAUSE) || !m.text.includes(CLAUSE));
    expect(stale.map((m) => `${m.name}.${m.key}`)).toEqual([]);
  });
});
