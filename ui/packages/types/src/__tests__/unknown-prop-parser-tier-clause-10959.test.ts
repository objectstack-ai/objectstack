/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10959 — what an unread `header-bar` key and an unread `body` drew,
 * stated for BOTH tiers. The sibling of objectui#10928, with a different code.
 *
 * Two families of published text said an authored value drew "no error, no
 * warning":
 *
 *   - the `HeaderBarSchema` refusals of objectui#10387 (`title`, `logo`, `nav`,
 *     `left`, `center`, `right`, `sticky`, `height`) and objectui#10286
 *     (`variant`), on the zod face (message and `.describe()` are one string);
 *   - the `body?: never` docblocks objectui#8284 put on the nine nodes whose
 *     renderer reads `children` (`box`, `span`, `container`, `flex`, `stack`,
 *     `grid`, `scroll-area` in `layout.ts`; `toggle`, `form` in `form.ts`),
 *     which ship in the emitted `.d.ts`.
 *
 * The render half is true: the value changed nothing on the page and logged
 * nothing. The warning half was false. The parser tier's `validateTree`
 * (`@object-ui/sdui-parser`) answers a key its registration does not declare
 * with `unknown-prop`, and `header-bar` declares only `crumbs`, `search`,
 * `actions` and `rightContent`. It answers `body` the same way on these nine,
 * whatever its shape, because each of them declares the `children` input:
 * `checkRetiredBodyDialect` gives `not-a-container` only where that input is
 * missing, which is why objectui#10928's clause would be false here. So the
 * clause now names `unknown-prop`:
 *
 *   refusal strings: "no render-time error or warning and no element; only the
 *                     parser tier's `unknown-prop` warning noticed it"
 *                    (`variant` says "no class" where the others say
 *                     "no element", as it did before)
 *   docblocks:       "rendered an EMPTY element with no render-time error or
 *                     warning; only the parser tier's `unknown-prop` warning
 *                     noticed it"
 *
 * ## Why this file pins the prose, and where the parser half lives
 *
 * `@object-ui/types` declares no workspace dependency and its tests import
 * none, so `@object-ui/sdui-parser` is not importable here without declaring
 * it (the same reason as objectui#10928's pin). The `body` half of the parser
 * behaviour is pinned in `packages/sdui-parser`: "the retired `body` spelling
 * follows the SAME predicate" in `containment-declared-slot-9910.test.ts`, and
 * "a `body` child list under a CONTAINER draws `unknown-prop` naming
 * `children`" in `body-dialect-6771.test.ts`. The `header-bar` half is the
 * generic undeclared-key branch of `validateTree`; no pin names `header-bar`
 * there. The live-registry reading taken for this change (every key above, on
 * `header-bar` and `ui:header-bar` and on the bare and `ui:` key of the nine,
 * with a render leg and a `not-a-container` control) is on objectui#10959's
 * pull request: a record of one run, not re-derived here.
 *
 * ## What is pinned, and what is deliberately not
 *
 * The clause as a substring. On the zod face: one `header-bar` key of each
 * clause form, read through its refusal with its code and path, then every
 * `header-bar` member whose refusal is one of these two retirements. On the TS
 * face: the `body` docblock of `BoxSchema` and of `FormSchema`, then every
 * docblock in `layout.ts` and `form.ts` that carries objectui#8284's sentence.
 * The rest of each string is NOT pinned; `header-bar-unread-keys-10387`,
 * `mirror-groups-cd-10286` and the objectui#8284 pins read it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { HeaderBarSchema } from '../zod/navigation.zod';

/** The clause the parser tier makes true — every site below ends on it. */
const TAIL = "only the parser tier's `unknown-prop` warning noticed it";

/** The refusal strings' clause, in its two forms. */
const ELEMENT_CLAUSE = `no render-time error or warning and no element; ${TAIL}`;
const CLASS_CLAUSE = `no render-time error or warning and no class; ${TAIL}`;

/** The docblocks' clause. */
const DOCBLOCK_CLAUSE = `rendered an EMPTY element with no render-time error or warning; ${TAIL}`;

/** The clauses they replaced — false about the parser tier. */
const RETIRED_STRING_CLAUSE = 'no error, no warning';
const RETIRED_DOCBLOCK_CLAUSE = 'with no error and no warning';

/** objectui#10928's code, which would be false on every site here. */
const WRONG_CODE = '`not-a-container`';

/** The sentence that marks a docblock as one of objectui#8284's `body` refusals. */
const MARK_8284 = 'Before objectui#8284 tombstoned it here, `body` was inherited-and-optional';

/**
 * The repo root, derived from THIS FILE's own location and never from the cwd
 * (objectui#7799): bare `import.meta.url`, taken apart by hand (the spelling
 * landed for objectui#7791, PR #7796).
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / types / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const LAYOUT = 'packages/types/src/layout.ts';
const FORM = 'packages/types/src/form.ts';

/** A docblock's text with its ` * ` continuations joined, as a reader sees it. */
const joinDocblock = (doc: string): string => doc.replace(/\s*\n\s*\*\s?/g, ' ');

/** The docblock on `member` inside `export interface name`, joined. */
function memberDocblock(src: string, name: string, member: string): string {
  const start = src.indexOf(`export interface ${name} `);
  expect(start, `interface ${name} not found`).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  const body = src.slice(start, end);
  const at = body.search(new RegExp(`\\n\\s*${member}\\?:`));
  expect(at, `member ${name}.${member} not found`).toBeGreaterThan(-1);
  const before = body.slice(0, at);
  const open = before.lastIndexOf('/**');
  expect(open, `no docblock before ${name}.${member}`).toBeGreaterThan(-1);
  return joinDocblock(before.slice(open));
}

describe('objectui#10959 — a header-bar refusal names the parser tier\'s `unknown-prop`', () => {
  const NODE = { type: 'header-bar' as const, crumbs: [{ label: 'Home' }] };
  const ARMS = [
    ['title', 'My App', ELEMENT_CLAUSE],
    ['variant', 'floating', CLASS_CLAUSE],
  ] as const;

  it.each(ARMS)('`%s` is refused by name, and the refusal names `unknown-prop`', (key, value, clause) => {
    const result = HeaderBarSchema.safeParse({ ...NODE, [key]: value });
    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues.find((i) => i.path.length === 1 && i.path[0] === key);
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.path).toEqual([key]);
    expect(issue?.message).toContain(clause);
    expect(issue?.message).not.toContain(RETIRED_STRING_CLAUSE);
    expect(issue?.message).not.toContain(WRONG_CODE);
  });
});

describe('objectui#10959 — every header-bar retirement carries the clause', () => {
  const shape = HeaderBarSchema.shape as Record<string, z.ZodType>;
  const members = Object.entries(shape)
    .map(([key, schema]) => ({ key, text: schema.description ?? '' }))
    .filter((m) => /^REFUSED \(objectui#(?:10387|10286), ADR-0049\)/.test(m.text));

  it('the walk reaches both retirements (non-vacuity, by name rather than by count)', () => {
    const keys = members.map((m) => m.key);
    expect(keys).toContain('title');
    expect(keys).toContain('variant');
  });

  it('none of them still says "no error, no warning", and each names `unknown-prop`', () => {
    const stale = members.filter((m) => m.text.includes(RETIRED_STRING_CLAUSE) || !m.text.includes(TAIL));
    expect(stale.map((m) => m.key)).toEqual([]);
  });
});

describe('objectui#10959 — the `body?: never` docblocks name the parser tier\'s `unknown-prop`', () => {
  const sources = [
    [LAYOUT, read(LAYOUT)],
    [FORM, read(FORM)],
  ] as const;

  it.each([
    [LAYOUT, 'BoxSchema'],
    [FORM, 'FormSchema'],
  ])('%s — `%s.body` carries the clause', (path, name) => {
    const doc = memberDocblock(read(path), name, 'body');
    expect(doc).toContain(MARK_8284);
    expect(doc).toContain(DOCBLOCK_CLAUSE);
    expect(doc).not.toContain(RETIRED_DOCBLOCK_CLAUSE);
    expect(doc).not.toContain(WRONG_CODE);
  });

  it('every objectui#8284 `body` docblock in both files carries it (non-vacuity: both files reached)', () => {
    const stale: string[] = [];
    for (const [path, src] of sources) {
      const docs = (src.match(/\/\*\*[\s\S]*?\*\//g) ?? []).map(joinDocblock).filter((d) => d.includes(MARK_8284));
      expect(docs.length, `${path}: no objectui#8284 docblock found`).toBeGreaterThan(0);
      docs.forEach((d, i) => {
        if (d.includes(RETIRED_DOCBLOCK_CLAUSE) || !d.includes(DOCBLOCK_CLAUSE)) stale.push(`${path} #${i}`);
      });
    }
    expect(stale).toEqual([]);
  });
});
