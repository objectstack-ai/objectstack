/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10981 — the family closure for the published "no error, no warning"
 * claims, after objectui#10928 (`not-a-container`) and objectui#10959
 * (`unknown-prop`).
 *
 * Four more sites in this package said an authored value drew no error and no
 * warning. The parser tier's `validateTree` (`@object-ui/sdui-parser`)
 * answered each of them when objectui#10981 landed, with the code the
 * registration's declared inputs decide (one has moved since — the `bind` row):
 *
 *   - `FormSchema.mode` (`zod/form.zod.ts`, objectui#10286, zod face):
 *     `form` declares no `mode` input, so every spelling draws `unknown-prop`.
 *   - `TimelineSchema.events` (`data-display.ts`, objectui#6170, TS face):
 *     neither the presentational `TimelineRenderer` registration this type
 *     describes nor the view registration the bare key resolves to declares
 *     `events`, so it draws `unknown-prop`.
 *   - `BaseSchema.bind` on `data-table` (`base.ts`, TS face): this one was
 *     not silent at render: `data-table` has logged a console warning for an
 *     authored `bind` since objectui#6575. When objectui#10981 landed, the
 *     parser tier answered it with `unknown-prop` too, and the clause named
 *     both. objectui#11008 made `bind` a base prop of `validateTree` — every
 *     node may carry it, so it draws nothing there — and the clause now names
 *     the console warning as the one signal and the parser tier as silent.
 *   - The bare `exportOptions` array on `object-grid` (`zod/objectql.zod.ts`,
 *     objectui#7762, the source note above the refusal string): the
 *     registration declares `exportOptions` as an object, so an array draws
 *     `type-mismatch`, not `unknown-prop`.
 *
 * ## Why this file pins the prose, and where the parser half lives
 *
 * `@object-ui/types` declares no workspace dependency and its tests import
 * none, so `@object-ui/sdui-parser` is not importable here (the same reason as
 * the objectui#10928 and objectui#10959 pins). The four readings behind these
 * clauses — every key spelling and value shape each sentence describes, over
 * the live registry, with a render leg — are on objectui#10981's pull request:
 * a record of one run, not re-derived here. The `data-table` render warning is
 * pinned in `packages/components`, by `skill-guide-data-table-binding.test.tsx`;
 * the parser tier's silence on a `bind` since objectui#11008 is re-derived there
 * too, over the live registry, by `bind-base-prop-parser-tier-11008.test.tsx`.
 *
 * ## What is pinned, and what is deliberately not
 *
 * One string per site, as a substring: on the zod face read through the
 * refusal with its code and path first, on the TS face read off the member's
 * docblock. Then the closure walk: over every non-test `.ts` file of this
 * package's `src`, no joined text still pairs "no error" with "no warning",
 * and every "no … error or warning" phrasing names the parser tier in its own
 * sentence or the next one. The rest of each string is NOT pinned; the sites'
 * own pins read it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FormSchema } from '../zod/form.zod';
import { ObjectGridSchema } from '../zod/objectql.zod';

/** The clause each site now carries. */
const UNKNOWN_PROP_TAIL = "only the parser tier's `unknown-prop` warning noticed it";
const FORM_CLAUSE = `rendered the same form — no render-time error or warning; ${UNKNOWN_PROP_TAIL}`;
const TIMELINE_CLAUSE = `drew an EMPTY rail, with no render-time error or warning; ${UNKNOWN_PROP_TAIL}`;
const BIND_CLAUSE =
  'with no render-time error; nothing on the page says why. The one signal is a render-time console warning '
  + '(`[ObjectUI] DataTable bind:`, objectui#6575; pinned in '
  + '`components/src/__tests__/skill-guide-data-table-binding.test.tsx`). The parser tier stays silent on it: '
  + '`validateTree` counts `bind` among the base props every node may carry (objectui#11008), '
  + 'so a `bind` draws no `unknown-prop` there, on `data-table` or on any other node';
/** The objectui#10981 wording, false since objectui#11008 made `bind` a parser-tier base prop. */
const RETIRED_BIND_CLAUSE = "the parser tier's `unknown-prop` warning both name it";
const EXPORT_CLAUSE =
  "no render-time error, warning or console line (only the parser tier's `type-mismatch` warning noticed it)";

/** The phrasings they replaced — false about the parser tier. */
const RETIRED = ['no error, no warning', 'no error and no warning'];

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
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const SRC = 'packages/types/src';

/**
 * Text as a reader sees it: JSDoc and line-comment continuations joined,
 * `'…' + '…'` concatenations joined, escaped quotes unescaped.
 */
const joinText = (src: string): string =>
  src
    .replace(/(['"`])\s*\+\s*\n?\s*(['"`])/g, '')
    .replace(/\n\s*\*\/?\s?/g, ' ')
    .replace(/\n\s*\/\/\s?/g, ' ')
    .replace(/\\(['"`])/g, '$1')
    .replace(/[ \t]+/g, ' ');

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
  return joinText(before.slice(open));
}

/** The issue a schema raises at exactly `[key]`, if any. */
function issueAt(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }, key: string) {
  return result.success ? undefined : result.error?.issues.find((i) => i.path.length === 1 && i.path[0] === key);
}

describe('objectui#10981 — the `FormSchema.mode` refusal names the parser tier\'s `unknown-prop`', () => {
  const NODE = { type: 'form' as const, fields: [{ name: 'title', label: 'Title', type: 'text' }] };

  it('`mode` is refused by name, and the refusal names `unknown-prop`', () => {
    const issue = issueAt(FormSchema.safeParse({ ...NODE, mode: 'edit' }), 'mode');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.path).toEqual(['mode']);
    expect(issue?.message).toContain(FORM_CLAUSE);
    for (const old of RETIRED) expect(issue?.message).not.toContain(old);
  });

  it('every spelling the objectui#10286 pin refuses carries it, and so does the `.describe()` text', () => {
    const stale = ['edit', 'read', 'disabled', 'create', 'view'].filter(
      (mode) => !issueAt(FormSchema.safeParse({ ...NODE, mode }), 'mode')?.message.includes(FORM_CLAUSE),
    );
    expect(stale).toEqual([]);
    expect(FormSchema.shape.mode.description).toContain(FORM_CLAUSE);
  });
});

describe('objectui#10981 — the `exportOptions` note names the parser tier\'s `type-mismatch`', () => {
  const NODE = { type: 'object-grid' as const, objectName: 'accounts' };

  it('a bare array is refused at `exportOptions` with the one string the note sits above', () => {
    const issue = issueAt(ObjectGridSchema.safeParse({ ...NODE, exportOptions: ['csv', 'xlsx'] }), 'exportOptions');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.path).toEqual(['exportOptions']);
    expect(issue?.message).toBe(ObjectGridSchema.shape.exportOptions.description);
  });

  it('the note above `OBJECT_GRID_EXPORT_OPTIONS_GUIDANCE` carries the clause, and names no `unknown-prop`', () => {
    const src = read(`${SRC}/zod/objectql.zod.ts`);
    const decl = src.indexOf('\nconst OBJECT_GRID_EXPORT_OPTIONS_GUIDANCE =');
    expect(decl, 'the guidance constant moved').toBeGreaterThan(-1);
    const open = src.lastIndexOf('/**', decl);
    const note = joinText(src.slice(open, decl));
    expect(note).toContain('objectui#7762');
    expect(note).toContain(EXPORT_CLAUSE);
    for (const old of RETIRED) expect(note).not.toContain(old);
    expect(note).not.toContain('`unknown-prop`');
  });
});

describe('objectui#10981 — the TS-face docblocks name what the parser tier answers', () => {
  it('`TimelineSchema.events` (objectui#6170) names `unknown-prop`', () => {
    const doc = memberDocblock(read(`${SRC}/data-display.ts`), 'TimelineSchema', 'events');
    expect(doc).toContain('RETIRED (objectui#6170');
    expect(doc).toContain(TIMELINE_CLAUSE);
    for (const old of RETIRED) expect(doc).not.toContain(old);
  });

  it('`BaseSchema.bind` names the `data-table` console warning as the one signal, and the parser tier as silent (objectui#11008)', () => {
    const doc = memberDocblock(read(`${SRC}/base.ts`), 'BaseSchema', 'bind');
    expect(doc).toContain('`data-table` does NOT');
    expect(doc).toContain(BIND_CLAUSE);
    expect(doc).not.toContain(RETIRED_BIND_CLAUSE);
    for (const old of RETIRED) expect(doc).not.toContain(old);
  });
});

describe('objectui#10981 — the closure walk over this package\'s `src`', () => {
  /** Every non-test `.ts` file under `src`, relative to the repo root. */
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        if (name !== '__tests__') walk(abs);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        files.push(relative(REPO_ROOT, abs));
      }
    }
  };
  walk(join(REPO_ROOT, SRC));
  const texts = files.map((f) => [f, joinText(read(f))] as const);

  /** "no error" and "no warning" paired, in either order — the retired shape. */
  const PAIRED = [
    /\bno (?:[\w-]+ )?errors?\b[^.;]{0,60}?\bno (?:[\w-]+ )?warnings?\b/gi,
    /\bno (?:[\w-]+ )?warnings?\b[^.;]{0,60}?\bno (?:[\w-]+ )?errors?\b/gi,
    /\bwithout (?:an? |any )?(?:[\w-]+ )?errors? (?:or|nor|and) (?:an? |any )?(?:[\w-]+ )?warnings?\b/gi,
    /\bneither (?:an? )?errors? nor (?:an? )?warnings?\b/gi,
  ];
  /** "no … error or warning" — the family's corrected shape, which must name the parser tier. */
  const COMBINED = /\bno (?:[\w-]+ )?errors? (?:or|nor|and) (?:[\w-]+ )?warnings?\b/gi;
  const PARSER_TIER = "the parser tier's";

  /**
   * Where the parser tier has to be named: anywhere from the phrasing to the
   * end of the sentence AFTER the one it sits in.
   *
   * The phrasing speaks for the render tier only, so the text must go on to say
   * what the parser tier did. The family writes that in one of two places. Most
   * sites keep it in the same sentence ("…; only the parser tier's
   * `unknown-prop` warning noticed it"). A site where the parser tier is
   * genuinely silent gives it the next sentence, because it has a reason to
   * record: objectui#9256's `metric-card` refusal says that "in a widget slot
   * nothing else noticed it either: the parser tier's `not-a-container` warning
   * (objectui#9910) walks `children`, never `widgets`". A fixed character count
   * after the match is not that rule. It was 80 here, and it failed the
   * `metric-card` text, which names the parser tier correctly but a little
   * further on. Any count is too short for some honest sentence and long
   * enough to reach an unrelated one somewhere else.
   *
   * A sentence ends at `.`, `!` or `?` followed by whitespace, the end of the
   * text, or a closing quote (a zod string ends in `.'`). So the dots in
   * `zod/form.zod.ts` or `.describe()` end nothing. `MAX_WINDOW` does not set
   * the rule. It only stops a text with no sentence end from reaching the rest
   * of its file.
   */
  const MAX_WINDOW = 600;
  const windowAfter = (t: string, from: number): string => {
    const end = /[.!?](?=['"`]?(?:\s|$))/g;
    end.lastIndex = from;
    const own = end.exec(t);
    const next = own ? end.exec(t) : null;
    return t.slice(from, Math.min(next ? next.index + 1 : t.length, from + MAX_WINDOW));
  };

  it('the walk reaches the four sites and both earlier waves (non-vacuity, by name rather than by count)', () => {
    const names = files.map((f) => f.slice(SRC.length + 1));
    for (const f of ['base.ts', 'data-display.ts', 'zod/form.zod.ts', 'zod/objectql.zod.ts']) expect(names).toContain(f);
    const text = (f: string) => texts.find(([p]) => p === `${SRC}/${f}`)?.[1] ?? '';
    expect(text('zod/navigation.zod.ts')).toContain(UNKNOWN_PROP_TAIL);
    expect(text('ai.ts')).toContain("only the parser tier's `not-a-container` warning (objectui#9910) noticed it");
  });

  it('no file still pairs "no error" with "no warning"', () => {
    const hits = texts.flatMap(([f, t]) => PAIRED.flatMap((re) => [...t.matchAll(re)].map((m) => `${f}: «${m[0]}»`)));
    expect(hits).toEqual([]);
  });

  it('every "no … error or warning" phrasing names the parser tier in the same or the next sentence', () => {
    const bare = texts.flatMap(([f, t]) =>
      [...t.matchAll(COMBINED)]
        .map((m) => windowAfter(t, m.index ?? 0))
        .filter((w) => !w.includes(PARSER_TIER))
        .map((w) => `${f}: «${w}»`),
    );
    expect(bare).toEqual([]);
  });
});
