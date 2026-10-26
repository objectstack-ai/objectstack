/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AppShellBranding.title` is described the same way on every surface that
 * describes it, and that description is the one the code implements
 * (objectui#6872).
 *
 * ## The defect
 *
 * `AppShell.tsx` declared `title` with the JSDoc `Page title suffix (sets
 * document.title)`, while `useAppShellBranding` assigns `document.title = title`
 * wholesale — no concatenation anywhere. The suffix is composed by the CALLER
 * (`ConsoleLayout.tsx` builds `"App label — Product name"` and passes the
 * finished string in). So the word "suffix" was backwards, and three sibling
 * teaching surfaces already had it right:
 *
 *   - `content/docs/layout/app-shell.mdx` — "assigned to `document.title` as
 *     given. It is the whole title, not a suffix: …"
 *   - `packages/layout/README.md`, `#### AppShellProps` table — "`title` sets
 *     `document.title`"
 *   - `content/docs/guide/layout.md`, `### Props` table — same clause
 *
 * The JSDoc matters more than a README line: it ships in `dist/index.d.ts` and is
 * the ONLY description a consumer reads on editor hover. Following it produces a
 * truncated title with no error of any kind.
 *
 * ## What is pinned, and why each pin is shaped the way it is
 *
 * 1. **Present.** A pin that only says "the JSDoc does not say suffix" passes on
 *    a JSDoc that has been DELETED — and an absent description on a published
 *    `.d.ts` is worse than a wrong one (the hover shows nothing). So the first
 *    assertion is that `title` carries a non-empty doc comment at all.
 *
 * 2. **States the whole-assignment behaviour.** The comment must name
 *    `document.title` and say the value is used as given / is the whole title.
 *    The old wording is run through the same reader as a built-in RED control,
 *    so the reader is known to reject it rather than merely known to accept the
 *    new text.
 *
 * 3. **Never a suffix, on any surface.** Every occurrence of the word "suffix"
 *    in a `title` description must be the negated one ("not a suffix"). This is
 *    checked on all four surfaces, so the reversed wording cannot reappear on
 *    any of them.
 *
 * 4. **The surfaces agree.** The disease on this card was one behaviour with
 *    several descriptions and one of them reversed; a FOURTH wording would be
 *    the same defect again. So the JSDoc must be, after whitespace
 *    normalization, the SAME text as the `content/docs/layout/app-shell.mdx`
 *    bullet it was copied from, and the two props-table cells (README, guide)
 *    must carry the same `title` clause as each other. The wording is read off
 *    the sibling files on every run — nothing is hand-copied into this test, so
 *    it cannot rot into "update the test".
 *
 * 5. **Distinct per field.** The caricature of "one behaviour, one description"
 *    is a source where EVERY field's JSDoc was replaced by the same constant
 *    string — every single-field pin above stays green under that if the
 *    constant happens to be the right sentence. So the four fields the
 *    interface declares (read off the source, not hand-listed) must each carry
 *    a doc comment and those comments must be pairwise distinct.
 *
 * 6. **The code half, by source.** `AppShell.tsx` writes `document.title` in
 *    exactly TWO places, one per role, and each right-hand side is a bare
 *    identifier — no template, no `+`, no `+=`. The forward write assigns
 *    `title`; the cleanup write restores the captured `previousTitle`
 *    (objectui#8637). The behavioural version of this pin (render, then read
 *    `document.title`) lives in `app-shell-branding-title-assignment.test.tsx`
 *    and `app-shell-branding-title-restore.test.tsx`; this half exists so a
 *    source diff that adds a writer beyond those two roles is caught by the
 *    same file that pins the wording, since another writer would change what
 *    the correct wording is.
 *
 *    ⚠️ This started life as "exactly one writer" and it FAILED on
 *    objectui#8637's restore, which is the pin doing its job rather than a
 *    reason to relax it. What was kept is every property that made it worth
 *    having: the assigning writer is still exactly one, its operator is still
 *    `=`, its right-hand side is still the bare `title`, and the total is still
 *    an exact count — so a third writer is still a failure. What was added is
 *    strictly more pinning, not less: the restore's own right-hand side is now
 *    named too, so the cleanup cannot quietly start composing a title either.
 *
 * ## Scan surface
 *
 * `packages/layout/src/AppShell.tsx`, `packages/layout/README.md`,
 * `content/docs/guide/layout.md`, `content/docs/layout/app-shell.mdx` — and
 * within each, only the description of `AppShellBranding.title` (plus, for #5,
 * the doc comments of the interface's other fields). The `<AppShell …>`
 * examples and the props-table KEYS on those pages belong to
 * `readme-app-shell-example.test.ts`, `guide-layout-app-shell-doc.test.ts` and
 * `app-shell-docs-nav-example.test.ts` and are not judged here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** `packages/layout` — two levels up from `src/__tests__`. */
const PKG_DIR = resolve(__dirname, '../..');
/** Repository root — two more. */
const REPO_ROOT = resolve(PKG_DIR, '../..');

const APP_SHELL_SRC = readFileSync(join(PKG_DIR, 'src', 'AppShell.tsx'), 'utf8');
const README = readFileSync(join(PKG_DIR, 'README.md'), 'utf8');
const GUIDE = readFileSync(join(REPO_ROOT, 'content', 'docs', 'guide', 'layout.md'), 'utf8');
const MDX = readFileSync(join(REPO_ROOT, 'content', 'docs', 'layout', 'app-shell.mdx'), 'utf8');

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Collapse all whitespace runs to one space and trim, so line wrapping is not a difference. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * `normalize`, then lower-case the first character. The JSDoc is a sentence and
 * opens with a capital; the mdx bullet continues after its `- \`title\` — ` lead
 * and opens lower-case. That one letter is the only difference the copy is
 * allowed to have.
 */
function normalizeSentenceStart(text: string): string {
  const n = normalize(text);
  return n.charAt(0).toLowerCase() + n.slice(1);
}

/** The body of `export interface NAME { … }` in `AppShell.tsx`. */
function interfaceBody(name: string): string {
  const body = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(APP_SHELL_SRC);
  if (!body) throw new Error(`\`export interface ${name}\` is gone from AppShell.tsx`);
  return body[1];
}

/**
 * Keys declared by an interface, read off the source. Anchored at line start,
 * so JSDoc lines (which start with `*` or `/`) are never collected as keys.
 */
function interfaceKeys(name: string): string[] {
  return [...interfaceBody(name).matchAll(/^\s*(\w+)\??\s*:/gm)].map((match) => match[1]);
}

/**
 * The doc comment immediately preceding `KEY?:` / `KEY:` inside an interface
 * body, with the comment delimiters and each line's leading `*` stripped, then
 * whitespace-normalized. `null` when the key has no doc comment at all — which
 * is the "strictly worse than the bug" shape pin #1 exists to reject.
 */
function fieldDoc(interfaceName: string, key: string): string | null {
  const body = interfaceBody(interfaceName);
  // Tempered: the capture may not contain `*/`, so this matches the comment
  // DIRECTLY above the key, not a lazy span from the interface's first `/**`.
  const re = new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*?)\\*/\\s*\\n\\s*${key}\\??\\s*:`);
  const match = re.exec(body);
  if (!match) return null;
  const text = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join(' ');
  return normalize(text);
}

/**
 * The `title` bullet of the `AppShellBranding` prose on
 * `content/docs/layout/app-shell.mdx`, with its `- \`title\` — ` lead removed
 * and whitespace normalized. The bullet runs until the next list item or a
 * blank line.
 */
function mdxTitleBullet(): string {
  const match = /^- `title` — ([\s\S]*?)(?=\n- |\n\n)/m.exec(MDX);
  if (!match) throw new Error('the `- `title` — …` bullet is gone from content/docs/layout/app-shell.mdx');
  return normalize(match[1]);
}

/** The `| \`branding\` | … |` props-table row of a markdown page, trimmed. */
function brandingRow(page: string, where: string): string {
  const row = page.split('\n').map((line) => line.trim()).find((line) => line.startsWith('| `branding` |'));
  if (!row) throw new Error(`no \`| \`branding\` |\` props-table row in ${where}`);
  return row;
}

/** The `\`title\` … \`document.title\`` clause inside a props-table cell. */
function titleClause(row: string, where: string): string {
  const match = /`title`[^,.;|]*`document\.title`/.exec(row);
  if (!match) {
    throw new Error(
      `${where}'s \`branding\` row no longer has a \`title\` … \`document.title\` clause: ${row}`,
    );
  }
  return normalize(match[0]);
}

/**
 * Does a `title` description state the whole-assignment behaviour? It must
 * name `document.title` and say the value is used as given / is the whole
 * title. Deliberately a predicate, so the OLD wording can be run through it
 * below as a red control.
 */
function describesWholeAssignment(text: string): boolean {
  return /`document\.title` as given/.test(text) && /whole title, not a suffix/.test(text);
}

/** Every `suffix` in `text` is the negated one. */
function onlyNegatedSuffix(text: string): boolean {
  return [...text.matchAll(/suffix/g)].every((match) => text.slice(0, match.index).endsWith('not a '));
}

const OLD_JSDOC = 'Page title suffix (sets document.title)';

// ---------------------------------------------------------------------------
// The JSDoc — the surface that ships in `dist/index.d.ts`
// ---------------------------------------------------------------------------

describe('`AppShellBranding.title` JSDoc (objectui#6872)', () => {
  const doc = fieldDoc('AppShellBranding', 'title');

  it('is present — a deleted description is worse than a wrong one on a published .d.ts', () => {
    expect(
      doc,
      [
        '`AppShellBranding.title` in packages/layout/src/AppShell.tsx carries no doc comment.',
        'That comment ships in dist/index.d.ts and is the only description a consumer reads on',
        'editor hover; deleting it is not a fix for objectui#6872, it is a worse defect.',
      ].join('\n'),
    ).not.toBeNull();
    expect(doc!.length).toBeGreaterThan(0);
  });

  it('states the whole-assignment behaviour: `document.title` as given, the whole title, not a suffix', () => {
    expect(
      describesWholeAssignment(doc ?? ''),
      [
        '`AppShellBranding.title` JSDoc does not describe what useAppShellBranding does.',
        `The code assigns \`document.title = title\` wholesale; the comment reads: ${JSON.stringify(doc)}`,
        'Copy the wording from content/docs/layout/app-shell.mdx — do not invent another phrasing.',
      ].join('\n'),
    ).toBe(true);
  });

  it('never calls the value a suffix except to deny it', () => {
    expect(onlyNegatedSuffix(doc ?? '')).toBe(true);
  });

  it('the reader rejects the wording this issue removed (red control for the pin above)', () => {
    // Without this the two tests above could be green because the predicate
    // accepts everything. The reversed wording must FAIL both predicates.
    expect(describesWholeAssignment(OLD_JSDOC)).toBe(false);
    expect(onlyNegatedSuffix(OLD_JSDOC)).toBe(false);
    // And the source no longer carries it anywhere.
    expect(APP_SHELL_SRC).not.toContain(OLD_JSDOC);
  });
});

// ---------------------------------------------------------------------------
// The surfaces agree
// ---------------------------------------------------------------------------

describe('every surface describes `AppShellBranding.title` the same way (objectui#6872)', () => {
  it('the JSDoc is the `content/docs/layout/app-shell.mdx` bullet, verbatim modulo whitespace and sentence case', () => {
    const doc = fieldDoc('AppShellBranding', 'title');
    const bullet = mdxTitleBullet();
    expect(
      doc === null ? null : normalizeSentenceStart(doc),
      [
        'The `AppShellBranding.title` JSDoc and the `title` bullet under `branding` on',
        'content/docs/layout/app-shell.mdx have drifted apart. objectui#6872 exists because one',
        'behaviour had several descriptions and one of them was reversed; keep ONE wording and',
        'change both together.',
      ].join('\n'),
    ).toBe(normalizeSentenceStart(bullet));
  });

  it('the mdx bullet itself states whole assignment and never calls it a suffix', () => {
    const bullet = mdxTitleBullet();
    expect(describesWholeAssignment(bullet)).toBe(true);
    expect(onlyNegatedSuffix(bullet)).toBe(true);
  });

  it('the README and guide props tables carry the same `title` clause, and it names `document.title`', () => {
    const readmeRow = brandingRow(README, 'packages/layout/README.md');
    const guideRow = brandingRow(GUIDE, 'content/docs/guide/layout.md');
    const readmeClause = titleClause(readmeRow, 'packages/layout/README.md');
    const guideClause = titleClause(guideRow, 'content/docs/guide/layout.md');
    expect(readmeClause).toBe(guideClause);
    expect(readmeClause).toMatch(/^`title` sets `document\.title`$/);
    expect(onlyNegatedSuffix(readmeRow)).toBe(true);
    expect(onlyNegatedSuffix(guideRow)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Distinct per field — the caricature of "one constant string for every prop"
// ---------------------------------------------------------------------------

describe('`AppShellBranding` fields are each described, and each differently (objectui#6872)', () => {
  it('every declared field carries its own doc comment', () => {
    const keys = interfaceKeys('AppShellBranding');
    expect(keys, 'the interface declares no keys at all').toContain('title');
    expect(keys.length).toBeGreaterThan(1);
    const docs = keys.map((key) => [key, fieldDoc('AppShellBranding', key)] as const);
    const undocumented = docs.filter(([, doc]) => doc === null || doc.length === 0).map(([key]) => key);
    expect(undocumented, 'fields with no doc comment').toEqual([]);
    const distinct = new Set(docs.map(([, doc]) => doc));
    expect(
      distinct.size,
      [
        'Two or more `AppShellBranding` fields share one doc comment. A description that is the',
        'same for every field describes none of them; each field says what IT does.',
        JSON.stringify(Object.fromEntries(docs), null, 2),
      ].join('\n'),
    ).toBe(docs.length);
  });
});

// ---------------------------------------------------------------------------
// The code half, by source
// ---------------------------------------------------------------------------

describe('`AppShell.tsx` writes `document.title` wholesale, in two roles (objectui#6872, objectui#8637)', () => {
  /** Every `document.title = …` / `+= …` in the source, as `[whole, operator, rhs]`. */
  const writers = [...APP_SHELL_SRC.matchAll(/document\.title\s*(\+?=)\s*([^;\n]+);/g)];
  /** The forward write; the restore is the one whose right-hand side is the captured title. */
  const assigning = writers.filter((match) => match[2].trim() !== 'previousTitle');
  const restoring = writers.filter((match) => match[2].trim() === 'previousTitle');

  it('exactly two writers, one per role — nothing else touches the tab title', () => {
    expect(
      writers.map((match) => match[0]),
      [
        'A `document.title` writer appeared or disappeared in AppShell.tsx. This hook is the ONE',
        'writer while a shell is mounted (objectui#8637), and that is exactly two source writes:',
        'the forward assignment of `title`, and the cleanup restore of `previousTitle`. A third',
        'would change the wording every surface carries; a missing restore strands the shell',
        'title on the tab and pushes the host back to a route-keyed reset, which is the defect.',
      ].join('\n'),
    ).toHaveLength(2);
    expect(assigning.map((match) => match[0]), 'the forward writer').toHaveLength(1);
    expect(restoring.map((match) => match[0]), 'the restore writer').toHaveLength(1);
  });

  it('the forward writer assigns the bare `title`', () => {
    const [, operator, rhs] = assigning[0];
    expect(operator).toBe('=');
    expect(
      rhs.trim(),
      [
        '`document.title` is no longer assigned the `title` prop as given. The suffix is composed',
        'by the CALLER (ConsoleLayout.tsx passes "App label — Product name"); appending here would',
        'double-concatenate for every caller that already builds the whole string.',
      ].join('\n'),
    ).toBe('title');
  });

  it('the restore writer replays the captured title, and composes nothing', () => {
    const [, operator, rhs] = restoring[0];
    expect(operator).toBe('=');
    expect(
      rhs.trim(),
      'the cleanup must put back what it captured, not build a new title out of it',
    ).toBe('previousTitle');
  });
});
