/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `content/docs/layout/app-shell.mdx`'s SidebarNav examples are THIS file's code
 * (objectui#4793).
 *
 * The published AppShell page (objectui.org/docs/layout/app-shell) taught two
 * nav examples spelled `{ label, href, icon: 'home' }`. Two of those three keys
 * are wrong: `NavItem` declares `title` / `href` / `icon`, and `icon` is a
 * COMPONENT (rendered `<item.icon />`, `SidebarNav.tsx:60` and `:109`), never an
 * icon name. `href` was the only correct one — so navigation worked while the
 * row rendered no label (`<span>{item.title}</span>` on `undefined`), no icon,
 * and a collapsed-sidebar tooltip of `undefined`. The same page also passed
 * `header={{ logo, title }}` and `footer={…}` to `SidebarNav`, neither of which
 * `SidebarNavProps` declares — the component destructures a fixed key list with
 * no rest element, so both objects were built and dropped on the floor.
 *
 * This is objectui#3999's defect (fixed for `packages/layout/README.md` in
 * PR #4792) reproduced on a second teaching surface, which is why the pin is
 * built the same way.
 *
 * ## The halves, and why each is a different kind of fact
 *
 * 1. **Compile-time.** The item arrays below are real TypeScript annotated with
 *    the real `NavItem`, imported from `../SidebarNav`, with real `lucide-react`
 *    components in `icon`. `packages/layout`'s `type-check` script compiles this
 *    file (`tsconfig.test.json`), so a shape `NavItem` cannot express stops the
 *    build here. This half is what catches `icon: 'home'` — a wrong VALUE type
 *    under a legal key, which no key-name check can see — and, via
 *    `completeExampleProps`, a `header`/`footer` prop that does not exist.
 *
 * 2. **Doc parity.** Each array is fenced by markers and asserted to appear in
 *    the MDX as a contiguous run of lines (compared trimmed). One source, two
 *    readers: editing the page's shape without editing this code — or the
 *    reverse — goes red. Without this, half 1 degenerates into type-checking a
 *    snippet nobody publishes.
 *
 * 3. **Whole-page scans.** Parity only guards the two blocks it marks; a NEW
 *    example added to the page later would be unguarded. So three narrow scans
 *    re-read every fence on the page that mentions `SidebarNav` and reject the
 *    exact defects this issue found: a quoted `icon:`, an item-level `label:`,
 *    and a `<SidebarNav>` prop that `SidebarNavProps` does not declare. The
 *    prop scan reads its expected key list OUT OF `SidebarNav.tsx`, so it can
 *    never rot into "update the test".
 *
 * ## The page's `AppShellProps` block (objectui#4808)
 *
 * Same page, same failure mode, opposite direction: the `## Component Props`
 * block reprints `AppShellProps` by hand and had gone stale by OMISSION — it
 * listed 5 props while `AppShell.tsx` declared 7, so `branding` (the whole
 * theme-customization entry point, `AppSchema.branding` landing in the
 * renderer) and `rightRail` (ADR-0057 P3a) were shipped, exported, commented
 * capabilities that a reader could only find by opening the source. Nothing
 * asserted false, so no scan built for wrong keys could see it; only a
 * both-directions comparison against the interface can. The block is therefore
 * parsed and compared to `AppShellProps` — props, order, optionality and type
 * text — with the expectation read OUT OF `AppShell.tsx` on every run, the same
 * never-"update the test" construction the `SidebarNavProps` scan above uses.
 *
 * Scope: this file scans `content/docs/layout/app-shell.mdx` and nothing else.
 * The `icon:`-as-string rejection in particular must NOT be widened to the docs
 * tree — `NavigationRenderer` really does take `icon` as a string (an icon
 * NAME it resolves through `resolveIcon`), so this is a fact about THIS
 * component's prop on THIS page. Pinning the whole
 * docs tree to source is objectui#3786's problem, not this one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Folder, Home, LayoutDashboard, Settings, Users } from 'lucide-react';
import type { NavItem, SidebarNavProps } from '../SidebarNav';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Repo root — four levels up from `packages/layout/src/__tests__`. */
const REPO_ROOT = resolve(__dirname, '../../../..');
const MDX_PATH = join(REPO_ROOT, 'content', 'docs', 'layout', 'app-shell.mdx');
const MDX = readFileSync(MDX_PATH, 'utf8');
const SIDEBAR_NAV_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'layout', 'src', 'SidebarNav.tsx'),
  'utf8',
);
/**
 * The page documents `@object-ui/layout`'s AppShell — every example on it
 * imports from `@object-ui/layout` — so this is the source of truth for its
 * props. `packages/app-shell` exports `MinimalAppShellProps` for a different,
 * same-named `AppShell` component; that one is not what this page teaches.
 */
const APP_SHELL_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'layout', 'src', 'AppShell.tsx'),
  'utf8',
);
const THIS_FILE = readFileSync(join(__dirname, 'app-shell-docs-nav-example.test.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Half 1 — the examples, as code. Everything between a BEGIN/END marker pair is
// asserted below to appear verbatim (trimmed) in app-shell.mdx.
// ---------------------------------------------------------------------------

/** The "Basic Usage" example's items. */
const basicItems: NavItem[] = [
  // >>> APP-SHELL MDX EXAMPLE basic BEGIN
  { title: 'Dashboard', href: '/', icon: Home },
  { title: 'Users', href: '/users', icon: Users },
  { title: 'Settings', href: '/settings', icon: Settings },
  // >>> APP-SHELL MDX EXAMPLE basic END
];

/** The "Complete Example" items — badge, and a nested `children` group. */
const completeItems: NavItem[] = [
  // >>> APP-SHELL MDX EXAMPLE complete BEGIN
  { title: 'Dashboard', href: '/', icon: LayoutDashboard, badge: '12' },
  {
    title: 'Projects',
    href: '/projects',
    icon: Folder,
    children: [
      { title: 'Active', href: '/projects/active' },
      { title: 'Archived', href: '/projects/archived' },
    ],
  },
  { title: 'Team', href: '/team', icon: Users },
  { title: 'Settings', href: '/settings', icon: Settings },
  // >>> APP-SHELL MDX EXAMPLE complete END
];

/**
 * The Complete Example's `SidebarNav` props, as a typed value. The page used to
 * pass `header={{ logo, title }}` and `footer={…}` here; both are absent from
 * `SidebarNavProps`, so restoring either makes this object stop compiling
 * (TS2353) instead of silently rendering nothing. `title` is the one real
 * branding prop, which is what the example was rewritten onto.
 */
const completeExampleProps: SidebarNavProps = {
  title: 'ObjectUI',
  items: completeItems,
};

// ---------------------------------------------------------------------------
// Marker extraction. Markers are matched by WHOLE-LINE equality against the
// strings these two helpers build, so the helpers' own source lines can never
// match themselves — this file reads itself, and a substring match would.
// ---------------------------------------------------------------------------

const beginMarker = (name: string): string => `// >>> APP-SHELL MDX EXAMPLE ${name} BEGIN`;
const endMarker = (name: string): string => `// >>> APP-SHELL MDX EXAMPLE ${name} END`;

/** The trimmed, non-empty lines of one marked example block. */
function exampleLines(name: string): string[] {
  const lines = THIS_FILE.split('\n').map((line) => line.trim());
  const begin = lines.indexOf(beginMarker(name));
  const end = lines.indexOf(endMarker(name));
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(
      `No \`${name}\` example block in this file. The markers are load-bearing: ` +
        'the MDX parity assertions below have nothing to compare without them.',
    );
  }
  return lines.slice(begin + 1, end).filter((line) => line.length > 0);
}

/** Index of `needle` as a contiguous run inside `haystack`, or -1. */
function indexOfSequence(haystack: string[], needle: string[]): number {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((line, offset) => haystack[i + offset] === line)) return i;
  }
  return -1;
}

const MDX_LINES = MDX.split('\n').map((line) => line.trim());

/** Fenced code blocks on the page that are about this component. */
function sidebarNavFences(): string[] {
  const fences = [...MDX.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  return fences.filter((body) => body.includes('SidebarNav'));
}

/**
 * Prop names on every `<SidebarNav …>` opening tag in `body`.
 *
 * Walks the tag rather than regexing the whole fence, tracking `{}` depth so
 * props of nested elements (`<Input placeholder=… />` inside a `navbar={…}`
 * expression, say) are never collected as SidebarNav's own.
 */
function sidebarNavTagProps(body: string): string[] {
  const props: string[] = [];
  const TAG = '<SidebarNav';
  for (let start = body.indexOf(TAG); start !== -1; start = body.indexOf(TAG, start + 1)) {
    // Guard against matching a longer identifier, e.g. `<SidebarNavFoo`.
    if (/[\w-]/.test(body[start + TAG.length] ?? '')) continue;
    let depth = 0;
    let i = start + TAG.length;
    let tag = '';
    for (; i < body.length; i += 1) {
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

/** One prop of an interface: its name, whether it is optional, and its type. */
interface DeclaredProp {
  key: string;
  optional: boolean;
  type: string;
}

/** Drop block and line comments, so a trailing `// …` never lands in a type. */
function stripComments(text: string): string {
  return mask(text);
}

/**
 * The props `interface <name>` declares in `src`, in declaration order.
 *
 * `export` is optional so the same parser reads both a `.tsx` source and the
 * hand-written copy inside an MDX fence. Each prop is matched anchored at line
 * start and terminated by the line's last `;`, so nested keys inside a type
 * (the `className?` in `icon?: React.ComponentType<{ className?: string }>`)
 * are never collected as props of their own.
 */
function interfaceProps(src: string, name: string): DeclaredProp[] {
  const body = new RegExp(`(?:export )?interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(src);
  if (!body) throw new Error(`\`interface ${name}\` is gone from the source this test reads`);
  return [...stripComments(body[1]).matchAll(/^[ \t]*(\w+)(\??)\s*:\s*(.+?);[ \t]*$/gm)].map(
    (match) => ({ key: match[1], optional: match[2] === '?', type: match[3].trim() }),
  );
}

/** Keys declared by an interface in `SidebarNav.tsx`, read off the source. */
function interfaceKeys(name: string): string[] {
  return interfaceProps(SIDEBAR_NAV_SRC, name).map((prop) => prop.key);
}

/** Fenced code blocks on the page that reprint `AppShellProps`. */
function appShellPropsFences(): string[] {
  const fences = [...MDX.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  return fences.filter((body) => body.includes('interface AppShellProps'));
}

describe("app-shell.mdx's SidebarNav examples are this file's type-checked code (objectui#4793)", () => {
  it.each(['basic', 'complete'])('app-shell.mdx carries the `%s` items verbatim', (name) => {
    const block = exampleLines(name);
    expect(block.length, `the \`${name}\` block is empty`).toBeGreaterThan(0);
    expect(
      indexOfSequence(MDX_LINES, block),
      [
        `The \`${name}\` example in content/docs/layout/app-shell.mdx no longer matches the code`,
        'in this file. One of the two moved on its own, which is exactly how the page came to',
        "teach `{ label, href, icon: 'home' }` (objectui#4793) — a shape `NavItem` has never",
        'had. Fix whichever is wrong, then make the other match; the code here is what `tsc`',
        'reads.',
        '',
        'Expected this run of lines (trimmed) in app-shell.mdx:',
        ...block.map((line) => `  ${line}`),
      ].join('\n'),
    ).toBeGreaterThanOrEqual(0);
  });

  it('and that code really is a `NavItem[]` (the compile-time half, made visible)', () => {
    // These reads are the point: a `const` nobody looks at is easy to delete,
    // and deleting it would silently retire the type-check above.
    expect(basicItems.map((item) => item.title)).toEqual(['Dashboard', 'Users', 'Settings']);
    expect(basicItems.map((item) => item.href)).toEqual(['/', '/users', '/settings']);
    expect(completeItems.map((item) => item.title)).toEqual([
      'Dashboard',
      'Projects',
      'Team',
      'Settings',
    ]);
    expect(completeItems[1].children?.map((child) => child.title)).toEqual(['Active', 'Archived']);

    // `icon` is a component, never a string — the defect this issue found.
    for (const item of [...basicItems, ...completeItems]) {
      expect(typeof item.icon).not.toBe('string');
      expect(item.icon).toBeTruthy();
    }

    // The one real branding prop the `header={{ logo, title }}` example became.
    expect(completeExampleProps.title).toBe('ObjectUI');
    expect(completeExampleProps.items).toBe(completeItems);
  });
});

describe("app-shell.mdx's SidebarNav examples spell only real keys (objectui#4793)", () => {
  it('declares its nav arrays as `NavItem[]`, which is what makes a typo a compile error', () => {
    const declaring = sidebarNavFences().filter((body) => body.includes('const navItems'));
    expect(declaring.length, 'no fence on the page declares `navItems` at all').toBeGreaterThan(0);

    for (const body of declaring) {
      expect(
        body.includes('const navItems: NavItem[] = ['),
        [
          'A SidebarNav example builds `navItems` without annotating it `NavItem[]`. The',
          'annotation is the entire reason a copied typo fails at the keyboard instead of',
          'rendering a blank sidebar (objectui#3999 / #4793); an unannotated array literal',
          'is inferred structurally and accepts any shape.',
        ].join('\n'),
      ).toBe(true);
    }
  });

  it('never spells `icon` as a string in a SidebarNav example', () => {
    const fences = sidebarNavFences();
    expect(fences.length, 'no SidebarNav code fence found on the page at all').toBeGreaterThan(0);

    for (const body of fences) {
      expect(
        /\bicon\s*:\s*['"`]/.test(body),
        [
          'A SidebarNav example writes `icon` as a quoted string. `NavItem.icon` is a',
          '`React.ComponentType`, rendered as `<item.icon />` — a string reaches React as an',
          'unknown lowercase tag and renders nothing (objectui#4793). Import the Lucide',
          'component and pass it.',
          '',
          'Scope note: `NavigationRenderer` DOES take `icon` as a string (an icon name), so this',
          'assertion is deliberately confined to SidebarNav fences on this one page.',
        ].join('\n'),
      ).toBe(false);
    }
  });

  it('never spells an item label as `label` (that key belongs to NavGroup)', () => {
    // `NavGroup.label` is a real key, so a fence that actually builds a
    // `NavGroup[]` is exempt — the defect is `label` on an ITEM, where the key
    // is `title`. Today no fence on this page builds groups; the exemption is
    // here so adding a grouped example later is not spuriously blocked.
    const fences = sidebarNavFences().filter((body) => !body.includes('NavGroup'));
    expect(fences.length, 'no non-grouped SidebarNav fence found on the page').toBeGreaterThan(0);

    for (const body of fences) {
      expect(
        /\blabel\s*:/.test(body),
        [
          'A SidebarNav example spells an item label as `label:`. `NavItem` declares `title`;',
          '`label` is `NavGroup`\'s key. Copied as-is the row renders no text at all, and its',
          'collapsed tooltip is `undefined` (objectui#4793).',
        ].join('\n'),
      ).toBe(false);
    }
  });

  it('passes only props that `SidebarNavProps` declares', () => {
    const declared = interfaceKeys('SidebarNavProps');
    expect(declared.length, 'no keys parsed out of `SidebarNavProps`').toBeGreaterThan(1);

    const used = [...new Set(sidebarNavFences().flatMap(sidebarNavTagProps))];
    expect(used.length, 'no `<SidebarNav …>` tag found on the page at all').toBeGreaterThan(0);

    expect(
      used.filter((prop) => !declared.includes(prop)),
      [
        'A `<SidebarNav>` example on content/docs/layout/app-shell.mdx passes a prop the',
        'component does not declare. `SidebarNav` destructures a fixed key list with NO rest',
        'element, so an undeclared prop is not "ignored with a warning" — the value is built',
        'and dropped, and the page promises UI that can never appear. That is exactly what',
        '`header={{ logo, title }}` and `footer={…}` did (objectui#4793).',
        '',
        'The expected list is READ OUT OF src/SidebarNav.tsx on every run, so this is never',
        '"update the test": add the prop to `SidebarNavProps`, or stop teaching it.',
        `Declared: ${declared.join(', ')}`,
      ].join('\n'),
    ).toEqual([]);
  });
});

describe("app-shell.mdx's `AppShellProps` block reprints the real interface (objectui#4808)", () => {
  /** `sidebar?: React.ReactNode` — how one prop reads in a failure message. */
  const format = (prop: DeclaredProp): string =>
    `${prop.key}${prop.optional ? '?' : ''}: ${prop.type}`;

  it('is the one block on the page, inside a fence', () => {
    expect(
      appShellPropsFences().length,
      [
        'content/docs/layout/app-shell.mdx should reprint `AppShellProps` in exactly one',
        'fenced block (the `## Component Props` section). Zero means the block was renamed',
        'or unfenced and the parity assertion below is comparing against nothing; more than',
        'one means two copies that can now disagree with each other as well as with source.',
      ].join('\n'),
    ).toBe(1);
  });

  it('lists every prop the component declares — same order, optionality and types', () => {
    const declared = interfaceProps(APP_SHELL_SRC, 'AppShellProps');
    expect(declared.length, 'no props parsed out of `AppShellProps`').toBeGreaterThan(1);

    const documented = interfaceProps(appShellPropsFences()[0], 'AppShellProps');

    expect(
      documented.map(format),
      [
        "The `AppShellProps` block on content/docs/layout/app-shell.mdx no longer matches the",
        'component. That block is a hand-written copy of the interface, and the way it rots is',
        'by OMISSION: it listed 5 of 7 props, so `branding` (the theming entry point) and',
        '`rightRail` (ADR-0057 P3a) were shipped, exported and documented in source while the',
        'page said they did not exist (objectui#4808). Nothing on the page was false, which is',
        'why only a both-directions comparison catches it.',
        '',
        'The expected list is READ OUT OF packages/layout/src/AppShell.tsx on every run, so',
        'this is never "update the test": add the prop to the page, or take it off the',
        'component. Prose about a prop is free — only the declaration lines are compared.',
        '',
        `Declared by the component: ${declared.map(format).join('; ')}`,
      ].join('\n'),
    ).toEqual(declared.map(format));
  });
});
