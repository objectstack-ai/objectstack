/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `packages/layout/README.md`'s AppShell examples spell only real props
 * (objectui#4817).
 *
 * The npm landing page for this package taught `<AppShell header={…}>`.
 * `AppShellProps` has never declared `header` — the top bar's entry point is
 * `navbar` — and `AppShell` destructures a FIXED key list with no rest element
 * (`AppShell.tsx:233-241`), so the node was built and dropped on the floor with
 * no warning of any kind. `AppShell` renders the `<header>` element itself
 * (`:248`) and fills it from `{navbar}` (`:249`), so a reader who copied the
 * example verbatim got a shell whose top bar was permanently empty. Two further
 * fences on the same page had the same defect in two more spellings: the
 * "Usage with React Router" example passed `header={…}` too, and "Customization"
 * passed `headerClassName` / `sidebarClassName`, neither of which exists either
 * (there is no per-slot className at all — `className` goes to the content element).
 *
 * This is objectui#3999's defect (SidebarNav, same README, pinned by
 * `readme-sidebar-nav-example.test.ts`) and objectui#4793's (SidebarNav on
 * `content/docs/layout/app-shell.mdx`, pinned by
 * `app-shell-docs-nav-example.test.ts`) reproduced on a third teaching surface,
 * which is why this pin is built the same way.
 *
 * ## The halves, and why each is a different kind of fact
 *
 * 1. **Compile-time.** The prop objects below are real `AppShellProps` values
 *    imported from `../AppShell`. `packages/layout`'s `type-check` script
 *    compiles this file (`tsconfig.test.json`), so re-adding `header` — or
 *    `headerClassName` — makes them stop compiling (TS2353 "Object literal may
 *    only specify known properties") instead of silently rendering nothing.
 *    This half catches an undeclared key at the keyboard.
 *
 * 2. **Props-table parity.** The `#### \`AppShellProps\`` table this issue added
 *    to the README is a SECOND surface that can rot exactly the way the example
 *    did, so its keys are not hand-listed here either: the expected list is read
 *    out of `AppShell.tsx`'s interface body on every run. Documenting a key that
 *    does not exist, or adding one to the interface and not the table, is red.
 *    This half asserts KEYS only — that each documented row names a real
 *    authoring prop — which is all a key table can be wrong about.
 *
 * 3. **Whole-section scan.** Parity guards the table; the compile-time half
 *    guards the two objects it declares. A NEW `<AppShell>` example pasted into
 *    the README later would be guarded by neither. So the last two tests re-read
 *    every fence on the page that mentions `AppShell`, collect the props of each
 *    `<AppShell …>` opening tag, and reject any the interface does not declare —
 *    with the expected key list read OUT OF the source, so this can never rot
 *    into "update the test".
 *
 * ## Scan surface — deliberately narrow
 *
 * This file reads `packages/layout/README.md` and `packages/layout/src/AppShell.tsx`,
 * and nothing else. Within that README it judges only the `<AppShell …>` opening
 * tags: the `SidebarNav` section, its props tables and the `<SidebarNav …>` tag
 * nested inside the router example's `sidebar={…}` belong to
 * `readme-sidebar-nav-example.test.ts` (objectui#3999) and are not touched here
 * — which is why `appShellTagProps` walks the tag with brace-depth tracking
 * rather than regexing the fence, so a nested element's props are never
 * collected as AppShell's own. `content/docs/layout/app-shell.mdx` is
 * `app-shell-docs-nav-example.test.ts`'s surface (objectui#4793), and pinning
 * the whole docs tree to source is objectui#3786's problem, not this one.
 *
 * Note also that `@object-ui/app-shell` exports a DIFFERENT props type for its
 * own `AppShell`, `MinimalAppShellProps` (`packages/app-shell/src/types.ts`),
 * which really does declare `header` — that is a separate component, and
 * reading this one's key list off this one's source is what keeps the two from
 * being conflated again. Until objectui#6349 (batch 9) it was also spelled
 * `AppShellProps`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppShellProps } from '../AppShell';

/** `packages/layout` — two levels up from `src/__tests__`. */
const PKG_DIR = resolve(__dirname, '../..');
const README = readFileSync(join(PKG_DIR, 'README.md'), 'utf8');
const APP_SHELL_SRC = readFileSync(join(PKG_DIR, 'src', 'AppShell.tsx'), 'utf8');

const README_LINES = README.split('\n').map((line) => line.trim());

// ---------------------------------------------------------------------------
// Half 1 — the README's two `<AppShell>` examples, as typed values.
//
// These are not decoration: `header` (the defect) and `headerClassName` /
// `sidebarClassName` (the same defect in the Customization fence) are rejected
// by `tsc` here, at the keyboard, which is the only half that can catch a bad
// prop before it is published. `null` is a legal `React.ReactNode`, so the
// slots can be typed without dragging JSX into a `.ts` file.
// ---------------------------------------------------------------------------

/** The `### AppShell` fence's props. Re-adding `header:` here is TS2353. */
const basicExampleProps: AppShellProps = {
  navbar: null,
  sidebar: null,
  children: null,
};

/**
 * The `## Customization` fence's props. That example used to pass
 * `headerClassName` / `sidebarClassName`; `AppShellProps` declares neither, and
 * restoring either one stops this object from compiling.
 */
const customizationExampleProps: AppShellProps = {
  className: 'bg-gray-50',
  navbar: null,
  sidebar: null,
  children: null,
};

// ---------------------------------------------------------------------------
// Readers: interface keys, table keys, and the props each example tag passes.
// ---------------------------------------------------------------------------

/** Keys declared by an interface in `AppShell.tsx`, read off the source. */
function interfaceKeys(name: string): string[] {
  const body = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(APP_SHELL_SRC);
  if (!body) throw new Error(`\`export interface ${name}\` is gone from AppShell.tsx`);
  // Anchored at line start, so neither JSDoc lines (which start with `*` or
  // `/`) nor keys nested inside a type annotation are collected.
  return [...body[1].matchAll(/^\s*(\w+)\??\s*:/gm)].map((match) => match[1]);
}

/** First-column keys of the markdown table that follows a `#### \`Name\`` heading. */
function documentedKeys(heading: string): string[] {
  const start = README_LINES.indexOf(`#### \`${heading}\``);
  if (start === -1) throw new Error(`README no longer has a \`#### \`${heading}\`\` section`);
  const keys: string[] = [];
  for (let i = start + 1; i < README_LINES.length; i += 1) {
    const line = README_LINES[i];
    if (line.length === 0) continue;
    if (!line.startsWith('|')) {
      if (keys.length > 0) break;
      continue;
    }
    const cell = line.split('|')[1]?.trim() ?? '';
    const key = /^`(\w+)`$/.exec(cell)?.[1];
    if (key) keys.push(key);
  }
  return keys;
}

/** Fenced code blocks in the README that are about this component. */
function appShellFences(): string[] {
  const fences = [...README.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  return fences.filter((body) => body.includes('AppShell'));
}

/**
 * Prop names on every `<AppShell …>` opening tag in `body`.
 *
 * Walks the tag rather than regexing the fence, tracking `{}` depth so props of
 * nested elements — the `className` on the `<div>` inside `navbar={…}`, or the
 * whole `<SidebarNav items={…} />` inside the router example's `sidebar={…}` —
 * are never collected as AppShell's own.
 */
function appShellTagProps(body: string): string[] {
  const props: string[] = [];
  const TAG = '<AppShell';
  for (let start = body.indexOf(TAG); start !== -1; start = body.indexOf(TAG, start + 1)) {
    // Guard against matching a longer identifier, e.g. `<AppShellFoo`.
    if (/[\w-]/.test(body[start + TAG.length] ?? '')) continue;
    let depth = 0;
    let tag = '';
    for (let i = start + TAG.length; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
      tag += depth === 0 ? ch : ' ';
    }
    props.push(...[...tag.matchAll(/([A-Za-z_$][\w$]*)\s*=/g)].map((match) => match[1]));
  }
  return props;
}

describe("the README's AppShellProps table names exactly the real keys (objectui#4817)", () => {
  it('`AppShellProps` is documented key-for-key', () => {
    const declared = interfaceKeys('AppShellProps');
    expect(declared.length, 'no keys parsed out of `AppShellProps`').toBeGreaterThan(1);

    expect(
      documentedKeys('AppShellProps').slice().sort(),
      [
        'The `AppShellProps` table in packages/layout/README.md and the interface in',
        'src/AppShell.tsx disagree about which props exist. The expected list is READ OUT OF',
        'the source on every run, so this is never "update the test": add the new prop to the',
        'table, or drop the row for the prop that is gone. A README is this package\'s npm',
        'landing page; a prop it invents is a node AppShell silently discards (objectui#4817).',
      ].join('\n'),
    ).toEqual(declared.slice().sort());
  });

  it('and the example prop objects really are `AppShellProps` (the compile-time half, made visible)', () => {
    // These reads are the point: a `const` nobody looks at is easy to delete,
    // and deleting it would silently retire the type-check that rejects
    // `header` / `headerClassName` at the keyboard.
    const declared = interfaceKeys('AppShellProps');
    for (const key of [...Object.keys(basicExampleProps), ...Object.keys(customizationExampleProps)]) {
      expect(declared, `\`${key}\` is not declared by AppShellProps`).toContain(key);
    }
    expect(Object.keys(basicExampleProps).sort()).toEqual(['children', 'navbar', 'sidebar']);
    expect(customizationExampleProps.className).toBe('bg-gray-50');
    // The prop the README used to spell `header`, and the reason this pin exists.
    expect(declared).toContain('navbar');
    expect(declared).not.toContain('header');
  });
});

describe("the README's AppShell examples pass only props AppShellProps declares (objectui#4817)", () => {
  it('every `<AppShell …>` prop on the page is a real one', () => {
    const declared = interfaceKeys('AppShellProps');
    expect(declared.length, 'no keys parsed out of `AppShellProps`').toBeGreaterThan(1);

    const fences = appShellFences();
    expect(fences.length, 'no AppShell code fence found in the README at all').toBeGreaterThan(0);

    const used = [...new Set(fences.flatMap(appShellTagProps))];
    expect(used.length, 'no `<AppShell …>` tag found in the README at all').toBeGreaterThan(0);

    expect(
      used.filter((prop) => !declared.includes(prop)),
      [
        'An `<AppShell>` example in packages/layout/README.md passes a prop the component does',
        'not declare. `AppShell` destructures a fixed key list with NO rest element',
        '(AppShell.tsx:233-241), so an undeclared prop is not "ignored with a warning" — the',
        'node is built and dropped, and the README promises UI that can never appear. That is',
        'exactly what `header={…}` did: the top bar stayed empty for everyone who copied the',
        'snippet, and `headerClassName` / `sidebarClassName` did the same for styling',
        '(objectui#4817).',
        '',
        'The expected list is READ OUT OF src/AppShell.tsx on every run, so this is never',
        '"update the test": add the prop to `AppShellProps`, or stop teaching it.',
        `Declared: ${declared.join(', ')}`,
      ].join('\n'),
    ).toEqual([]);
  });

  it('and actually teaches `navbar`, so the scan above is not passing on an empty set', () => {
    // Without this the test above would stay green if every `<AppShell>` example
    // lost its props, or the top-bar slot quietly stopped being documented at
    // all: "no undeclared props" is trivially true of no props. `navbar` is the
    // fact objectui#4817 is about, so it is asserted positively.
    const used = new Set(appShellFences().flatMap(appShellTagProps));

    expect(
      used.has('navbar'),
      [
        'No `<AppShell>` example in packages/layout/README.md passes `navbar` any more.',
        '`navbar` is the ONLY entry point for top-bar content (AppShell.tsx:249); a page that',
        'stops showing it sends readers looking for the `header` prop that objectui#4817 was',
        'filed about, which has never existed.',
        `Props currently passed: ${[...used].join(', ') || '(none)'}`,
      ].join('\n'),
    ).toBe(true);

    expect(
      used.has('header'),
      [
        'An `<AppShell>` example in packages/layout/README.md is passing `header` again.',
        'That prop does not exist on this component (objectui#4817). Note that',
        '`@object-ui/app-shell`\'s own `AppShell` takes `MinimalAppShellProps`, which DOES',
        'declare `header` — this README documents `@object-ui/layout`\'s, whose top-bar',
        'slot is `navbar`.',
      ].join('\n'),
    ).toBe(false);
  });
});
