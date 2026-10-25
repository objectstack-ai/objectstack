/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7923 — `content/docs/api/schema-reference.md`'s `ObjectViewSchema`
 * example may only author `listViews` entry keys that `NamedListView` declares.
 *
 * ## The defect this pin closes
 *
 * The example's `my-deals` entry carried `"default": true`. `NamedListView`
 * (`../objectql.ts`) declares no `default` member and
 * `packages/plugin-view/src/ObjectView.tsx:701` picks the opening view from the
 * NODE-level `ObjectViewSchema.defaultListView`, falling back to the first key —
 * nothing anywhere reads an entry-level flag. So the example taught a key that
 * does not exist, and the view it labelled "default" never opened first, while
 * the SAME page's property table twenty rows below already documented
 * `defaultListView` correctly. The page contradicted itself.
 *
 * ## Why a fixture pin and not a type annotation
 *
 * Annotating the snippet against `ObjectViewSchema` would have caught nothing
 * when this was written: `BaseSchema` closed with `[key: string]: any`
 * (`../base.ts`), so every invented key type-checked through the index signature
 * — measured directly in objectui#7927 (probe P5: renaming `titleField` to
 * `titleFieldd` inside an annotated block left `check:doc-snippets` at exit 0).
 * The annotation checked a key's TYPE and never its NAME (objectui#8347 has
 * since removed the signature). `NamedListView` is a standalone interface that
 * does NOT extend `BaseSchema`, so its declared members are a genuinely closed
 * list — which is what makes a name-level comparison possible here at all.
 *
 * Nor does any gate cover the block: `check-doc-snippet-types.mjs` compiles
 * `ts` / `tsx` / `typescript` fences only (`TS_FENCE_LANGUAGES`), and this
 * example is a ```json fence, so it is collected and never compiled
 * (objectui#5250). The page is on that gate's covered surface — it is not in
 * `UNGATED_DOCS` — which is precisely why "covered" did not mean "checked".
 *
 * ## Both sides are parsed off disk, never restated here
 *
 * The shape is `packages/plugin-calendar/src/readme-calendar-view-schema.test.ts`
 * (objectui#7925): the declaration is brace-matched out of the interface source
 * and the doc side is parsed out of the markdown on every run, so a red here
 * always means "fix the doc (or the declaration)", never "update the test".
 * Restating the member list in this file would reproduce the original defect one
 * layer up — the doc was itself a confident hand-written restatement.
 * Everything that could make this pin pass vacuously — a moved heading, a
 * renamed interface, a fence that stopped being JSON — throws LOUDLY instead.
 *
 * ⛔ Out of scope, deliberately: the example's `filter` DIALECT (the ObjectQL
 * tuple form `[["owner", "=", …]]` versus the `{ field, operator, value }`
 * objects `packages/plugin-view/README.md` teaches). `NamedListView.filter` is
 * an untyped array so both spellings are declared-legal and this pin cannot and
 * must not adjudicate them; which one `mergeFilterNodes` runs is unmeasured.
 * That is objectui#2890's half. The filter LINE is additionally held verbatim
 * by `object-view-unmirrored-keys-7779.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const ROOT = uiRoot();
const DOC = 'content/docs/api/schema-reference.md';
const DECLARATION = 'packages/types/src/objectql.ts';
const HEADING = '\n### ObjectViewSchema\n';
const INTERFACE = 'NamedListView';

function readRepo(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/**
 * The own (not inherited) top-level member names of a TS interface, by brace
 * matching rather than a line regex: the body carries JSDoc blocks, nested
 * object literals (`sharing`, `addRecord`, `emptyState`, `aria`) and union
 * types with their own punctuation, and a nested member must NOT be counted as
 * a top-level one.
 */
function interfaceMembers(rel: string, name: string): Set<string> {
  const src = readRepo(rel);
  const opener = new RegExp(`export interface ${name}\\b[^{]*\\{`).exec(src);
  if (!opener) throw new Error(`interface ${name} not found in ${rel} — this pin reads it there`);

  let i = opener.index + opener[0].length;
  const start = i;
  for (let depth = 1; depth > 0; i += 1) {
    if (i >= src.length) throw new Error(`unterminated interface ${name} in ${rel}`);
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }

  const body = mask(src.slice(start, i - 1));

  const members = new Set<string>();
  let depth = 0;
  let buf = '';
  const flush = () => {
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)(?:\?)?\s*:/.exec(buf.trim());
    if (m) members.add(m[1]);
    buf = '';
  };
  for (const ch of body) {
    if ('{(['.includes(ch)) depth += 1;
    if ('})]'.includes(ch)) depth -= 1;
    if ((ch === ';' || ch === '\n') && depth === 0) flush();
    else buf += ch;
  }
  flush();

  if (members.size === 0) throw new Error(`parsed zero members out of ${name} in ${rel}`);
  return members;
}

/** The `object-view` example under the `### ObjectViewSchema` heading, parsed. */
function objectViewExample(): Record<string, unknown> {
  const src = readRepo(DOC);
  const heading = src.indexOf(HEADING);
  if (heading < 0) throw new Error(`"${HEADING.trim()}" heading not found in ${DOC} — the example moved`);

  const next = src.indexOf('\n### ', heading + HEADING.length);
  const section = src.slice(heading, next < 0 ? src.length : next);
  const fence = /```json\n([\s\S]*?)\n```/.exec(section);
  if (!fence) throw new Error(`no json fence under "${HEADING.trim()}" in ${DOC}`);

  const node = JSON.parse(fence[1]) as Record<string, unknown>;
  if (node.type !== 'object-view') {
    throw new Error(`the first json fence under "${HEADING.trim()}" is not an object-view node (type: ${String(node.type)})`);
  }
  return node;
}

function namedListViews(node: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const views = node.listViews;
  if (views == null || typeof views !== 'object') throw new Error(`the ${DOC} object-view example no longer authors \`listViews\``);
  const entries = views as Record<string, Record<string, unknown>>;
  if (Object.keys(entries).length === 0) throw new Error(`the ${DOC} object-view example authors an EMPTY \`listViews\` — this pin would pass vacuously`);
  return entries;
}

/**
 * The predicate. Every key authored across the example's named views that
 * `NamedListView` does not declare — `[]` is the passing reading. The positive
 * control below runs this same function, so the control cannot drift from it.
 */
function undeclaredKeys(entries: Record<string, Record<string, unknown>>, declared: Set<string>): string[] {
  const offending = new Set<string>();
  for (const view of Object.values(entries)) {
    for (const key of Object.keys(view)) if (!declared.has(key)) offending.add(key);
  }
  return [...offending].sort();
}

const declared = interfaceMembers(DECLARATION, INTERFACE);
const example = objectViewExample();
const views = namedListViews(example);

describe(`objectui#7923 — ${DOC}'s object-view example against \`${INTERFACE}\``, () => {
  it('parsed a real declaration and a real example — the live controls, so a zero below is a reading', () => {
    // If the brace matcher silently produced junk, `label` (the interface's one
    // REQUIRED member) is the first thing to go missing.
    expect([...declared], `\`${INTERFACE}\` no longer declares \`label\` — the parse is wrong, not the doc`).toContain('label');
    expect(declared.size, `\`${INTERFACE}\` parsed to ${declared.size} members; it declares dozens (objectui#7924)`).toBeGreaterThan(30);
    // And the doc side: two named views, one of which is the one this card fixed.
    expect(Object.keys(views).sort()).toEqual(['all', 'my-deals']);
  });

  it(`authors no key \`${INTERFACE}\` does not declare — \`default\` was the offender`, () => {
    expect(
      undeclaredKeys(views, declared),
      `${DOC}'s object-view example authors \`listViews\` key(s) that \`${INTERFACE}\` ` +
        '(packages/types/src/objectql.ts) does not declare. An undeclared key here is not ' +
        'caught by anything else: the fence is JSON so no snippet gate compiles it, and ' +
        'the typed-literal refusal objectui#7927 ruled (executed by objectui#8347) never sees a JSON fence. ' +
        'Fix the doc — or declare the key AND give it a read site.',
    ).toEqual([]);
  });

  it('names its opening view at the NODE level, with a key that exists', () => {
    // The renderer reads `schema.defaultListView` (ObjectView.tsx:701) and
    // otherwise opens the first key. This is where "which view opens first"
    // has to be spelled for the example's stated intent to be true.
    const key = example.defaultListView;
    expect(typeof key, `${DOC}'s object-view example must spell \`defaultListView\` — the entry-level flag it used to carry was read by nothing`).toBe('string');
    expect(Object.keys(views), `\`defaultListView\` names "${String(key)}", which is not one of the example's own listViews`).toContain(key as string);
  });

  it('POSITIVE CONTROL: the same predicate goes red on the key this card removed', () => {
    // The control's precondition, stated as an assertion rather than assumed:
    // if `default` ever becomes a declared AND read member, this line is the
    // tripwire that says so — re-take objectui#7923's decision, do not delete
    // this test.
    expect(
      declared.has('default'),
      `\`${INTERFACE}\` now declares \`default\`. This control planted it precisely because it did not; re-take objectui#7923 before touching this file.`,
    ).toBe(false);

    const planted: Record<string, Record<string, unknown>> = { ...views, 'my-deals': { ...views['my-deals'], default: true } };
    expect(undeclaredKeys(planted, declared)).toEqual(['default']);
    // …and the untouched entry is still clean, so the red above is the plant.
    expect(undeclaredKeys({ all: planted.all }, declared)).toEqual([]);
  });
});
