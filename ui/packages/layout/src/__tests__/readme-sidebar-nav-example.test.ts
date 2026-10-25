/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The README's `SidebarNav` examples are THIS file's code (objectui#3999).
 *
 * `packages/layout/README.md` used to hand every reader of the npm landing page
 * a nav item spelled `{ label, path, icon: 'home' }`. All three keys are wrong,
 * and not by a typo — `NavItem` declares `title` / `href` / `icon`, where `icon`
 * is a COMPONENT (`<item.icon />`, `SidebarNav.tsx:60` and `:109`), never an
 * icon name. Copied verbatim the example produced rows with no label at all
 * (`<span>{item.title}</span>` on `undefined`), a `NavLink` with
 * `to={undefined}`, and the string `'home'` handed to React as an unknown
 * lowercase tag. TypeScript consumers got a compile error; JS consumers — and
 * anyone (AI authors above all) who copies the snippet and then "fixes it until
 * it compiles" — got a blank sidebar, which is the audience a README has.
 *
 * ## The three halves, and why each is a different kind of fact
 *
 * 1. **Compile-time.** The example arrays below are real TypeScript annotated
 *    with the real `NavItem` / `NavGroup`, imported from `../SidebarNav`, with
 *    real `lucide-react` components in `icon`. `packages/layout`'s
 *    `type-check` script compiles this file (`tsconfig.test.json`), so a
 *    README shape that `NavItem` cannot express stops the build here. This is
 *    the half that catches `icon: 'home'`: a wrong VALUE type under a legal
 *    key, which no key-name check can see.
 *
 * 2. **Doc parity.** Each example is fenced by markers and asserted to appear
 *    in `README.md` as a contiguous run of lines (compared trimmed, so the
 *    router snippet's JSX indentation is not part of the contract). One source,
 *    two readers: editing the README's shape without editing the code — or the
 *    reverse — goes red. Without this, half 1 degenerates into type-checking a
 *    snippet nobody publishes.
 *
 * 3. **Props-table parity.** The table this issue added to the README is a
 *    SECOND surface that can rot exactly the way the example did, so it is not
 *    hand-listed here either: the expected keys are read out of
 *    `SidebarNav.tsx`'s interface bodies. Adding a key to `NavItem` without
 *    documenting it, or documenting a key that no longer exists, is red.
 *    This half asserts KEYS only — that each documented row names a real
 *    authoring key — which is all a table can be wrong about; the values those
 *    keys accept are half 1's job.
 *
 * The scan in half 3's last test is deliberately narrow: it re-reads the fenced
 * blocks that mention `SidebarNav` and rejects a quoted `icon:`.
 * `NavigationRenderer` really does take an icon NAME as a string (its
 * `resolveIcon`), so this must never become a README-wide ban on `icon: '…'` —
 * it is a fact about THIS component's prop, scoped to THIS component's
 * examples.
 *
 * Not covered, on purpose: `content/docs/layout/sidebar-nav.mdx` already spelled
 * these examples correctly, and pinning the whole docs tree to source is
 * objectui#3786's problem, not this one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FolderOpen, Home, Settings, Users } from 'lucide-react';
import type { NavGroup, NavItem, SidebarNavProps } from '../SidebarNav';

/** `packages/layout` — two levels up from `src/__tests__`. */
const PKG_DIR = resolve(__dirname, '../..');
const README = readFileSync(join(PKG_DIR, 'README.md'), 'utf8');
const SIDEBAR_NAV_SRC = readFileSync(join(PKG_DIR, 'src', 'SidebarNav.tsx'), 'utf8');
const THIS_FILE = readFileSync(join(__dirname, 'readme-sidebar-nav-example.test.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Half 1 — the examples, as code. Everything between a BEGIN/END marker pair is
// asserted below to appear verbatim (trimmed) in README.md.
// ---------------------------------------------------------------------------

// >>> README EXAMPLE basic BEGIN
const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: Home },
  { title: 'Users', href: '/users', icon: Users },
  { title: 'Settings', href: '/settings', icon: Settings },
];
// >>> README EXAMPLE basic END

// >>> README EXAMPLE grouped BEGIN
const navGroups: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: Home },
      {
        title: 'Projects',
        href: '/projects',
        icon: FolderOpen,
        badge: 3,
        children: [
          { title: 'Active', href: '/projects/active' },
          { title: 'Archived', href: '/projects/archived', badge: 'WIP', badgeVariant: 'outline' },
        ],
      },
    ],
  },
  {
    label: 'System',
    items: [{ title: 'Settings', href: '/settings', icon: Settings }],
  },
];
// >>> README EXAMPLE grouped END

/** The "Usage with React Router" snippet passes its items inline to the JSX. */
const routerItems: NavItem[] = [
  // >>> README EXAMPLE router BEGIN
  { title: 'Dashboard', href: '/', icon: Home },
  { title: 'Users', href: '/users', icon: Users },
  // >>> README EXAMPLE router END
];

/**
 * Both example shapes have to be legal values of the SAME prop — that is the
 * union the README's `items` row documents. If `SidebarNavProps['items']` ever
 * narrows to one of them, these two stop type-checking and the row has to move
 * with the type.
 */
const flatItemsProp: SidebarNavProps['items'] = navItems;
const groupedItemsProp: SidebarNavProps['items'] = navGroups;

// ---------------------------------------------------------------------------
// Marker extraction. Markers are matched by WHOLE-LINE equality against the
// strings these two helpers build, so the helpers' own source lines can never
// match themselves — this file reads itself, and a substring match would.
// ---------------------------------------------------------------------------

const beginMarker = (name: string): string => `// >>> README EXAMPLE ${name} BEGIN`;
const endMarker = (name: string): string => `// >>> README EXAMPLE ${name} END`;

/** The trimmed, non-empty lines of one marked example block. */
function exampleLines(name: string): string[] {
  const lines = THIS_FILE.split('\n').map((line) => line.trim());
  const begin = lines.indexOf(beginMarker(name));
  const end = lines.indexOf(endMarker(name));
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(
      `No \`${name}\` example block in this file. The markers are load-bearing: ` +
        'the README parity assertions below have nothing to compare without them.',
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

const README_LINES = README.split('\n').map((line) => line.trim());

/** Fenced code blocks in the README that are about this component. */
function sidebarNavFences(): string[] {
  const fences = [...README.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  return fences.filter((body) => body.includes('SidebarNav'));
}

// ---------------------------------------------------------------------------
// Interface keys, read out of SidebarNav.tsx rather than listed here.
// ---------------------------------------------------------------------------

function interfaceKeys(name: string): string[] {
  const body = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(SIDEBAR_NAV_SRC);
  if (!body) throw new Error(`\`export interface ${name}\` is gone from SidebarNav.tsx`);
  // Anchored at line start, so nested keys inside a type (the `className?` in
  // `icon?: React.ComponentType<{ className?: string }>`) are not collected.
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

describe("the README's SidebarNav examples are this file's type-checked code (objectui#3999)", () => {
  it.each(['basic', 'grouped', 'router'])(
    'README.md carries the `%s` example verbatim',
    (name) => {
      const block = exampleLines(name);
      expect(block.length, `the \`${name}\` block is empty`).toBeGreaterThan(0);
      expect(
        indexOfSequence(README_LINES, block),
        [
          `The \`${name}\` example in packages/layout/README.md no longer matches the code in this`,
          'file. One of the two moved on its own, which is exactly how the README came to teach',
          '`{ label, path, icon: \'home\' }` (objectui#3999) — a shape `NavItem` has never had.',
          'Fix whichever is wrong, then make the other match; the code here is what `tsc` reads.',
          '',
          'Expected this run of lines (trimmed) in README.md:',
          ...block.map((line) => `  ${line}`),
        ].join('\n'),
      ).toBeGreaterThanOrEqual(0);
    },
  );

  it('and that code really is a `NavItem[]` / `NavGroup[]` (the compile-time half, made visible)', () => {
    // These reads are the point: a `const` nobody looks at is easy to delete,
    // and deleting it would silently retire the type-check above.
    expect(navItems.map((item) => item.title)).toEqual(['Dashboard', 'Users', 'Settings']);
    expect(navItems.map((item) => item.href)).toEqual(['/dashboard', '/users', '/settings']);
    // `icon` is a component, never a string — the third defect this issue found.
    expect(navItems.every((item) => typeof item.icon === 'function' || typeof item.icon === 'object')).toBe(true);
    expect(navItems.some((item) => typeof item.icon === 'string')).toBe(false);

    expect(navGroups.map((group) => group.label)).toEqual(['Workspace', 'System']);
    expect(navGroups[0].items[1].children?.map((child) => child.href)).toEqual([
      '/projects/active',
      '/projects/archived',
    ]);

    expect(routerItems.map((item) => item.href)).toEqual(['/', '/users']);
    expect(flatItemsProp).toBe(navItems);
    expect(groupedItemsProp).toBe(navGroups);
  });
});

describe("the README's SidebarNav props tables name exactly the real keys (objectui#3999)", () => {
  it.each([
    ['SidebarNavProps'],
    ['NavItem'],
    ['NavGroup'],
  ])('`%s` is documented key-for-key', (name) => {
    const declared = interfaceKeys(name);
    expect(declared.length, `no keys parsed out of \`${name}\``).toBeGreaterThan(1);

    expect(
      documentedKeys(name).slice().sort(),
      [
        `The \`${name}\` table in packages/layout/README.md and the interface in`,
        'src/SidebarNav.tsx disagree about which keys exist. The expected list is READ OUT OF',
        'the source on every run, so this is never "update the test": add the new key to the',
        'table, or drop the row for the key that is gone. A README is this package\'s npm',
        'landing page; a key it invents is a shape the component cannot consume (objectui#3999).',
      ].join('\n'),
    ).toEqual(declared.slice().sort());
  });

  it('never spells `icon` as a string in a SidebarNav example', () => {
    const fences = sidebarNavFences();
    expect(fences.length, 'no SidebarNav code fence found in the README at all').toBeGreaterThan(0);

    for (const body of fences) {
      expect(
        /\bicon\s*:\s*['"`]/.test(body),
        [
          'A SidebarNav example writes `icon` as a quoted string. `NavItem.icon` is a',
          '`React.ComponentType`, rendered as `<item.icon />` — a string reaches React as an',
          'unknown lowercase tag and renders nothing (objectui#3999). Import the Lucide',
          'component and pass it.',
          '',
          'Scope note: `NavigationRenderer` DOES take `icon` as a string (an icon name), so this',
          'assertion is deliberately confined to fences that mention SidebarNav.',
        ].join('\n'),
      ).toBe(false);
    }
  });
});
