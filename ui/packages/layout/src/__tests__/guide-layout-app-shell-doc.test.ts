/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `content/docs/guide/layout.md`'s AppShell material teaches only real props
 * (objectui#4827).
 *
 * This is the same phantom-key fact as objectui#4817 (`packages/layout/README.md`,
 * pinned by `readme-app-shell-example.test.ts`) and objectui#4808
 * (`content/docs/layout/app-shell.mdx`, pinned by `app-shell-docs-nav-example.test.ts`),
 * on a THIRD teaching surface — and this one was the worst of the three, because
 * its carrier was JSON.
 *
 * The page's `### Schema API` block declared ten keys for a
 * `{ "type": "app-shell" }` node, of which `AppShellProps` has ever declared
 * two: `header`, `body`, `sidebarCollapsible`, `sidebarDefaultOpen`,
 * `headerClassName`, `sidebarClassName` and `contentClassName` do not exist,
 * and four of them were demonstrated a second time in the `### Custom Classes`
 * example. On the React surfaces a copied phantom prop at least reaches a
 * TypeScript consumer as an error; in a JSON document nothing checked it —
 * `app-shell` was registered with no `inputs` (`packages/layout/src/index.ts`),
 * so `sdui-parser`'s unknown-prop check had nothing to compare a node against
 * and reported nothing at all.
 *
 * That registration is GONE (objectui#4841, ADR-0049 enforce-or-remove, remove
 * side). The key resolves to nothing now, so the node is refused by name instead
 * of silently under-rendering — `app-shell-not-a-component-key.test.tsx` owns
 * that fact and measures the diagnostic. This file is unchanged in what it
 * judges: the page's React material, and that no fence on it authors the node.
 *
 * ## What the page says now, and what the halves below hold to it
 *
 * The page was rewritten to teach `AppShell` as what it is — a React component
 * whose four node slots (`sidebar` / `navbar` / `children` / `rightRail`) a JSON
 * document cannot fill. Those claims were measured against this tree, not
 * inferred, and they are what objectui#4841 then acted on — the three bullets
 * below describe the registration as it behaved BEFORE it was removed:
 *
 *   - `className`, `defaultOpen` and `branding` DO survive the JSON path. They
 *     are plain data, `SchemaRenderer` spreads them onto the component, and a
 *     rendered `{ "type": "app-shell", "branding": {…} }` node really did set
 *     `document.title` and `--primary`.
 *   - `children` does NOT. `SchemaRenderer` strips `children` (and `body`) out
 *     of a node before spreading the rest as props, and `AppShell` reads its
 *     `children` PROP, never `schema.children`. The `<main>` element rendered
 *     empty with zero console output — the silent half of this issue.
 *   - `sidebar` / `navbar` / `rightRail` do NOT. A JSON value arrives as a plain
 *     object, and `AppShell` renders it directly, so React throws and the node
 *     is replaced by the renderer's error box (`Objects are not valid as a React
 *     child`). Loud, but still not the UI the page promised.
 *
 * 1. **Compile-time.** The prop objects below are real `AppShellProps` values
 *    imported from `../AppShell`, mirroring the four `<AppShell …>` examples the
 *    page now shows. `packages/layout`'s `type-check` script compiles this file
 *    (`tsconfig.test.json`), so re-adding `header` — or `headerClassName` —
 *    makes them stop compiling (TS2353) instead of silently rendering nothing.
 *
 * 2. **Props-table parity.** The `### Props` table is a hand-written copy of the
 *    interface and rots the same way the `Schema API` block did, so its rows are
 *    not hand-listed here either: props, order, optionality and type text are
 *    read OUT OF `AppShell.tsx` on every run. Inventing a key, dropping one, or
 *    adding one to the interface and not the table is red.
 *
 * 3. **Whole-page tag scan.** Parity guards the table and the compile-time half
 *    guards the objects it declares; a NEW `<AppShell>` example pasted in later
 *    would be guarded by neither. So every fence on the page is re-read, the
 *    props of each `<AppShell …>` opening tag collected, and any the interface
 *    does not declare rejected — again with the expected key list read out of
 *    source, so this can never rot into "update the test".
 *
 * 4. **No JSON `app-shell` node.** The four `React.ReactNode` slots are the
 *    whole point of an app shell, and none of them can be written in JSON, so a
 *    `{ "type": "app-shell" }` node on this page is the defect itself and not
 *    merely a stale spelling of it. The fences are checked for that node shape.
 *
 * 5. **The two source facts the page's prose rests on**, so the prose cannot go
 *    stale silently: `AppShell` still destructures a fixed key list with no rest
 *    element (which is why an undeclared prop vanishes without a warning), and
 *    `SchemaRenderer` still strips `children`/`body` before spreading a node's
 *    keys as props (which is why the `<main>` element comes out empty).
 *
 * ## Scan surface — deliberately narrow
 *
 * This file judges `content/docs/guide/layout.md`'s APP-SHELL material only: the
 * `### Props` table, the `<AppShell …>` opening tags in its fences, and whether
 * any fence authors an `app-shell` JSON node. The same page's `page`,
 * `page-header` and `sidebar-nav` sections are NOT audited here and must not be
 * swept in — they describe different components with pins of their own (the
 * `page` node's are the `page-*-refusal-*` files in `@object-ui/types`), so a
 * file-wide ban on this file's spellings would judge material it does not own.
 * (The `page` section's Schema API block used to declare `headerClassName` /
 * `bodyClassName`; objectui#11318 removed them as unread.) `packages/layout/README.md`
 * belongs to `readme-app-shell-example.test.ts` (objectui#4817) and
 * `content/docs/layout/app-shell.mdx` to `app-shell-docs-nav-example.test.ts`
 * (objectui#4793 / #4808); pinning the whole docs tree to source is
 * objectui#3786's problem, not this one.
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
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Repo root — five levels up from `packages/layout/src/__tests__`. */
const REPO_ROOT = resolve(__dirname, '../../../..');
const GUIDE = readFileSync(join(REPO_ROOT, 'content', 'docs', 'guide', 'layout.md'), 'utf8');
const APP_SHELL_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'layout', 'src', 'AppShell.tsx'),
  'utf8',
);
/**
 * The renderer the page's "In a JSON node" section describes. Read for the one
 * fact that section rests on — that `children` is stripped before a node's keys
 * are spread as props — so the claim cannot quietly become false.
 */
const SCHEMA_RENDERER_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'react', 'src', 'SchemaRenderer.tsx'),
  'utf8',
);

const GUIDE_LINES = GUIDE.split('\n').map((line) => line.trim());

// ---------------------------------------------------------------------------
// Half 1 — the page's four `<AppShell>` examples, as typed values.
//
// `header` / `body` (the Schema API block) and `headerClassName` /
// `sidebarClassName` / `contentClassName` (the Custom Classes block) are
// rejected by `tsc` here, at the keyboard. `null` is a legal `React.ReactNode`,
// so the slots can be typed without dragging JSX into a `.ts` file.
// ---------------------------------------------------------------------------

/** `### Basic Usage`. Re-adding `header:` here is TS2353. */
const basicExampleProps: AppShellProps = {
  navbar: null,
  sidebar: null,
  children: null,
};

/**
 * `### Full Application Layout`. This one used to pass `sidebarCollapsible` and
 * `sidebarDefaultOpen`; the shell declares neither — `defaultOpen` is its own
 * initial-state prop, and collapse behaviour belongs to the sidebar node.
 */
const fullLayoutExampleProps: AppShellProps = {
  navbar: null,
  sidebar: null,
  defaultOpen: true,
  children: null,
};

/** `### Landing Page (No Sidebar)`. Used to pass `header` and `body`. */
const landingExampleProps: AppShellProps = {
  navbar: null,
  children: null,
};

/**
 * `### Custom Classes`. That example used to teach `headerClassName` /
 * `sidebarClassName` / `contentClassName`; there is no per-slot className at
 * all, and restoring any of them stops this object from compiling.
 */
const customClassesExampleProps: AppShellProps = {
  className: 'bg-background',
  navbar: null,
  sidebar: null,
  children: null,
};

// ---------------------------------------------------------------------------
// Readers: interface props, table rows, and the props each example tag passes.
// ---------------------------------------------------------------------------

/** One prop of an interface: its name, whether it is optional, and its type. */
interface DeclaredProp {
  key: string;
  optional: boolean;
  type: string;
}

/** `sidebar?: React.ReactNode` — how one prop reads in a failure message. */
const format = (prop: DeclaredProp): string =>
  `${prop.key}${prop.optional ? '?' : ''}: ${prop.type}`;

/** Drop block and line comments, so a trailing `// …` never lands in a type. */
function stripComments(text: string): string {
  return mask(text);
}

/**
 * The props `interface <name>` declares in `src`, in declaration order.
 *
 * Each prop is matched anchored at line start and terminated by the line's last
 * `;`, so keys nested inside a type annotation are never collected as props of
 * their own. Same construction as `app-shell-docs-nav-example.test.ts`.
 */
function interfaceProps(src: string, name: string): DeclaredProp[] {
  const body = new RegExp(`(?:export )?interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(src);
  if (!body) throw new Error(`\`interface ${name}\` is gone from the source this test reads`);
  return [...stripComments(body[1]).matchAll(/^[ \t]*(\w+)(\??)\s*:\s*(.+?);[ \t]*$/gm)].map(
    (match) => ({ key: match[1], optional: match[2] === '?', type: match[3].trim() }),
  );
}

/**
 * Rows of the markdown table that follows the page's `### Props` heading, read
 * as `DeclaredProp`s so they can be compared with the interface directly.
 *
 * Columns are `| Prop | Type | Required | In a JSON node | Description |`; the
 * first three are the ones a props table can be wrong about in the way this
 * issue is about. `Required` is spelled `yes`/`no` rather than the interface's
 * `?`, and anything else is a malformed row rather than a silently-skipped one.
 */
function documentedProps(): DeclaredProp[] {
  const start = GUIDE_LINES.indexOf('### Props');
  if (start === -1) {
    throw new Error('content/docs/guide/layout.md no longer has a `### Props` heading');
  }
  const props: DeclaredProp[] = [];
  for (let i = start + 1; i < GUIDE_LINES.length; i += 1) {
    const line = GUIDE_LINES[i];
    if (line.length === 0) continue;
    if (!line.startsWith('|')) {
      if (props.length > 0) break;
      continue;
    }
    const cells = line.split('|').map((cell) => cell.trim());
    const key = /^`(\w+)`$/.exec(cells[1] ?? '')?.[1];
    if (!key) continue; // header row and the `| --- |` separator
    const type = (cells[2] ?? '').replace(/`/g, '').trim();
    const required = (cells[3] ?? '').toLowerCase();
    if (required !== 'yes' && required !== 'no') {
      throw new Error(
        `The \`### Props\` row for \`${key}\` spells Required as "${cells[3]}"; it must be "yes" or "no".`,
      );
    }
    props.push({ key, optional: required === 'no', type });
  }
  return props;
}

/**
 * Every fenced code block on the page, with its info string and the 1-based
 * line its opening fence sits on — a JSON fence's first line is `{`, which
 * identifies nothing, so failures quote the line number instead.
 */
function fences(): { lang: string; body: string; line: number }[] {
  return [...GUIDE.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].map((match) => ({
    lang: match[1],
    body: match[2],
    line: GUIDE.slice(0, match.index).split('\n').length,
  }));
}

/**
 * Prop names on every `<AppShell …>` opening tag in `body`.
 *
 * Walks the tag rather than regexing the fence, tracking `{}` depth and string
 * quoting so a nested element's props — the `className` on the `<span>` inside
 * `navbar={…}`, or the whole `<SidebarNav …/>` inside `sidebar={…}` — and the
 * words inside a quoted attribute value are never collected as AppShell's own.
 * Bare boolean attributes (`defaultOpen` with no `=`) are collected too, which
 * is the one thing objectui#4817's README walker could not see.
 */
function appShellTagProps(body: string): string[] {
  const props: string[] = [];
  const TAG = '<AppShell';
  for (let start = body.indexOf(TAG); start !== -1; start = body.indexOf(TAG, start + 1)) {
    // Guard against matching a longer identifier, e.g. `<AppShellFoo`.
    if (/[\w-]/.test(body[start + TAG.length] ?? '')) continue;
    let depth = 0;
    let quote: string | null = null;
    let tag = '';
    for (let i = start + TAG.length; i < body.length; i += 1) {
      const ch = body[i];
      if (quote) {
        if (ch === quote) quote = null;
        tag += ' ';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        tag += ' ';
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
      tag += depth === 0 ? ch : ' ';
    }
    props.push(...[...tag.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0]));
  }
  return props;
}

describe("the guide's AppShellProps table names exactly the real props (objectui#4827)", () => {
  it('lists every prop the component declares — same order, optionality and type', () => {
    const declared = interfaceProps(APP_SHELL_SRC, 'AppShellProps');
    expect(declared.length, 'no props parsed out of `AppShellProps`').toBeGreaterThan(1);

    expect(
      documentedProps().map(format),
      [
        'The `### Props` table in content/docs/guide/layout.md and the interface in',
        'packages/layout/src/AppShell.tsx disagree about which props exist. That table replaced',
        'a `Schema API` block which declared ten keys for a JSON `app-shell` node, seven of',
        'which the component has never had (objectui#4827) — and a JSON carrier has no',
        'TypeScript consumer to catch them, so every one was dropped in silence.',
        '',
        'The expected list is READ OUT OF packages/layout/src/AppShell.tsx on every run, so this',
        'is never "update the test": add the new prop to the table, or drop the row for the prop',
        'that is gone. Only Prop / Type / Required are compared — the Description and',
        '"In a JSON node" columns are free prose.',
        '',
        `Declared by the component: ${declared.map(format).join('; ')}`,
      ].join('\n'),
    ).toEqual(declared.map(format));
  });

  it('and the example prop objects really are `AppShellProps` (the compile-time half, made visible)', () => {
    // These reads are the point: a `const` nobody looks at is easy to delete,
    // and deleting it would silently retire the type-check that rejects
    // `header` / `body` / `headerClassName` at the keyboard.
    const declared = interfaceProps(APP_SHELL_SRC, 'AppShellProps').map((prop) => prop.key);
    const examples = [
      basicExampleProps,
      fullLayoutExampleProps,
      landingExampleProps,
      customClassesExampleProps,
    ];
    for (const key of examples.flatMap((example) => Object.keys(example))) {
      expect(declared, `\`${key}\` is not declared by AppShellProps`).toContain(key);
    }
    expect(Object.keys(basicExampleProps).sort()).toEqual(['children', 'navbar', 'sidebar']);
    expect(fullLayoutExampleProps.defaultOpen).toBe(true);
    expect(Object.keys(landingExampleProps).sort()).toEqual(['children', 'navbar']);
    expect(customClassesExampleProps.className).toBe('bg-background');
    // The keys the page used to teach, and the reason this pin exists.
    expect(declared).toContain('navbar');
    expect(declared).not.toContain('header');
    expect(declared).not.toContain('body');
    expect(declared).not.toContain('headerClassName');
  });
});

describe("the guide's AppShell examples pass only props AppShellProps declares (objectui#4827)", () => {
  it('every `<AppShell …>` prop on the page is a real one', () => {
    const declared = interfaceProps(APP_SHELL_SRC, 'AppShellProps').map((prop) => prop.key);
    expect(declared.length, 'no props parsed out of `AppShellProps`').toBeGreaterThan(1);

    const appShellFences = fences().filter((fence) => fence.body.includes('AppShell'));
    expect(
      appShellFences.length,
      'no AppShell code fence found in content/docs/guide/layout.md at all',
    ).toBeGreaterThan(0);

    const used = [...new Set(appShellFences.flatMap((fence) => appShellTagProps(fence.body)))];
    expect(used.length, 'no `<AppShell …>` tag found on the page at all').toBeGreaterThan(0);

    expect(
      used.filter((prop) => !declared.includes(prop)),
      [
        'An `<AppShell>` example in content/docs/guide/layout.md passes a prop the component',
        'does not declare. `AppShell` destructures a fixed key list with NO rest element, so an',
        'undeclared prop is not "ignored with a warning" — the node is built and dropped, and',
        'the page promises UI that can never appear (objectui#4827).',
        '',
        'The expected list is READ OUT OF packages/layout/src/AppShell.tsx on every run, so this',
        'is never "update the test": add the prop to `AppShellProps`, or stop teaching it.',
        `Declared: ${declared.join(', ')}`,
      ].join('\n'),
    ).toEqual([]);
  });

  it('and actually teaches `navbar`, so the scan above is not passing on an empty set', () => {
    // "No undeclared props" is trivially true of no props. `navbar` is the slot
    // the phantom `header` displaced, so it is asserted positively.
    const used = new Set(
      fences()
        .filter((fence) => fence.body.includes('AppShell'))
        .flatMap((fence) => appShellTagProps(fence.body)),
    );

    expect(
      used.has('navbar'),
      [
        'No `<AppShell>` example in content/docs/guide/layout.md passes `navbar` any more.',
        '`navbar` is the ONLY entry point for top-bar content; a page that stops showing it',
        'sends readers looking for the `header` key objectui#4827 was filed about, which has',
        'never existed on this component.',
        `Props currently passed: ${[...used].join(', ') || '(none)'}`,
      ].join('\n'),
    ).toBe(true);
  });
});

describe('the guide authors no `app-shell` JSON node (objectui#4827)', () => {
  it('no fence on the page contains a `{ "type": "app-shell" }` node', () => {
    const offenders = fences().filter((fence) => /["']type["']\s*:\s*["']app-shell["']/.test(fence.body));

    expect(
      offenders.map((fence) => `content/docs/guide/layout.md:${fence.line}`),
      [
        'A fence in content/docs/guide/layout.md authors an `app-shell` node again',
        '(objectui#4827). The key is not registered at all any more (objectui#4841), so the',
        'node resolves to nothing: the renderer replaces it with the red "Unknown component',
        'type: app-shell" panel (OBJUI-001) and sdui-parser reports `unknown-component`. It was',
        'deregistered because four of the seven props are `React.ReactNode` slots a JSON',
        'document can fill none of — `children` was stripped by SchemaRenderer before a node\'s',
        'keys were spread as props, so `<main>` rendered EMPTY with nothing logged, and a schema',
        'in `sidebar` / `navbar` / `rightRail` reached the component as a plain object, which',
        'React refuses to render. Teach the React composition instead, or `app-schema-renderer`',
        'when the whole shell has to come from metadata.',
        '',
        'If `app-shell` is ever made authorable — registered again WITH inputs AND the slots fed',
        'from the schema — this assertion is the right place to record that, but it must be a',
        'change to the component, not to the page.',
      ].join('\n'),
    ).toEqual([]);
  });
});

describe("the source facts the guide's JSON section rests on (objectui#4827)", () => {
  it('`AppShell` still destructures a fixed key list with no rest element', () => {
    const params = /export function AppShell\(\{([\s\S]*?)\}: AppShellProps\)/.exec(APP_SHELL_SRC);
    if (!params) throw new Error('`export function AppShell({ … }: AppShellProps)` is gone');

    expect(
      params[1].includes('...'),
      [
        'AppShell now takes a rest element. The guide tells readers that anything not on the',
        'prop list is "built and then dropped on the floor" — the exact mechanism that made',
        "objectui#4827's phantom keys silent. With a rest element that is no longer true, and",
        'the page needs rewriting rather than this assertion relaxing.',
      ].join('\n'),
    ).toBe(false);
  });

  it('`SchemaRenderer` still strips `children` and `body` before spreading a node as props', () => {
    const strip = /const \{([\s\S]*?)\.\.\.componentProps\s*\n\s*\} = evaluatedSchema;/.exec(
      SCHEMA_RENDERER_SRC,
    );
    if (!strip) {
      throw new Error(
        "SchemaRenderer's metadata-strip destructuring is gone from packages/react/src/SchemaRenderer.tsx",
      );
    }
    const stripped = [...stripComments(strip[1]).matchAll(/^[ \t]*(\w+)\s*:/gm)].map((m) => m[1]);

    for (const key of ['children', 'body']) {
      expect(
        stripped,
        [
          `SchemaRenderer no longer strips \`${key}\` out of a node before spreading its keys as`,
          'props. content/docs/guide/layout.md states that a JSON `app-shell` node renders an',
          'EMPTY `<main>` for exactly that reason (objectui#4827); if the key now reaches the',
          'component, that paragraph is false and the page — not this assertion — is what has to',
          'change.',
          `Currently stripped: ${stripped.join(', ')}`,
        ].join('\n'),
      ).toContain(key);
    }
  });
});
