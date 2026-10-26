/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `content/docs/guide/layout.md`'s SidebarNav material teaches the real
 * component (objectui#4840), and its Responsive Behavior section describes the
 * real breakpoints (objectui#4842).
 *
 * ## objectui#4840 — a node type that was never registered
 *
 * This is the same phantom-shape family as objectui#3999 (`packages/layout/README.md`,
 * pinned by `readme-sidebar-nav-example.test.ts`) and objectui#4793
 * (`content/docs/layout/app-shell.mdx`, pinned by `app-shell-docs-nav-example.test.ts`),
 * on a THIRD surface — and this one went one level further than either. Those
 * two misspelled the keys of a real React component. This page taught a JSON
 * NODE TYPE that does not exist: `registerLayout()` registers `page:card` and
 * `app-schema-renderer` (the `page-header` alias was a fifth until
 * objectui#10859 batch 8 retired it, and `responsive-grid` and
 * `navigation-renderer` were the third and fourth until objectui#11441), and
 * nothing in the repo registers `sidebar-nav`.
 * (`app-shell` was a sixth key until objectui#4841 deregistered it — for the
 * same reason, one step less far along: it resolved to a component that a JSON
 * document could never fill. `sidebar-nav` never resolved at all, which is why
 * this page's defect was the LOUDER of the two.)
 *
 * Measured on this tree, a `{ "type": "sidebar-nav", "items": [...] }` node
 * renders the renderer's red panel and no sidebar at all:
 *
 *     Unknown component type: sidebar-nav
 *     (OBJUI-001)
 *
 * So this defect was LOUDER than objectui#4827's `app-shell` one, which at least
 * resolved to a component and dropped keys quietly. Here nothing is parsed as
 * props, because nothing resolves. objectui#4841 has since given `app-shell` the
 * same treatment — deregistered, so it too now renders `Unknown component type`
 * rather than an empty shell.
 *
 * The page's `### Schema API` block also got the component's own shape wrong in
 * seven ways at once — `label` for `title`, `icon` as a string rather than a
 * component, `items` for `children`, invented `active` / `disabled` /
 * `defaultOpen`, `collapsible` as a boolean rather than the three-value union —
 * and omitted the real `title`. Those are what the table-parity halves below
 * hold to source.
 *
 * ## objectui#4842 — a behaviour promise, not a key
 *
 * The Responsive Behavior section promised `Hidden sidebar (toggle button in
 * header)` below 768px. `AppShell`'s header renders `{navbar}` and nothing else,
 * so a reader who believed it never put a `SidebarTrigger` in `navbar` and the
 * mobile sidebar had no way to open — silently, with nothing logged.
 * `content/docs/layout/app-shell.mdx` already stated this correctly ("no sidebar
 * toggle"); the two pages disagreed and this was the wrong one.
 *
 * Auditing the rest of that section found the tier structure itself was
 * fictional: it described three tiers split at 1024px and 768px, while the
 * implementation has exactly ONE breakpoint, 768px, and never reads `lg`. Its
 * "Compact header" claim was wrong too — the header is one height at every
 * breakpoint (`h-14` then; `h-12` since objectui#12639). The last describe
 * block pins the numbers the rewritten section now quotes.
 *
 * ## Scan surface — deliberately narrow
 *
 * This file judges `content/docs/guide/layout.md`'s SIDEBARNAV material and its
 * Responsive Behavior section only. The `### Props` / `#### NavItem` /
 * `#### NavGroup` tables are read from inside the `## SidebarNav Component`
 * section, NOT page-wide — the same page has a second `### Props` table, for
 * `AppShellProps`, which belongs to `guide-layout-app-shell-doc.test.ts`
 * (objectui#4827) and must not be picked up here.
 *
 * The fence scans are page-wide but filtered to fences that mention
 * `SidebarNav`, because the component is legitimately taught outside its own
 * section: the app-shell examples compose it, and `### 5. Sidebar Organization`
 * under Best Practices was a THIRD block of the same defect, rewritten with this
 * change. The quoted-`icon` ban in particular must stay scoped that way —
 * `NavigationRenderer` takes `icon` as a string (an icon NAME), whose
 * `resolveIcon` looks names up on purpose. A
 * page-wide ban on `icon: '…'` would be wrong.
 *
 * `packages/layout/README.md` belongs to `readme-sidebar-nav-example.test.ts`
 * and `content/docs/layout/app-shell.mdx` to `app-shell-docs-nav-example.test.ts`;
 * pinning the whole docs tree to source is objectui#3786's problem, not this one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BarChart3, DollarSign, Home, LayoutDashboard, Settings, Users } from 'lucide-react';
import type { NavGroup, NavItem, SidebarNavProps } from '../SidebarNav';

// The shared registration reader (objectui#4894). Plain JS, and this package's
// test program sets `allowJs: false`, so the import is untyped here — the local
// annotation below is what keeps the call site checked.
// @ts-expect-error — plain-JS shared helper, intentionally untyped
import { readComponentRegistrations } from '../../../../scripts/component-registrations.mjs';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Repo root — five levels up from `packages/layout/src/__tests__`. */
const REPO_ROOT = resolve(__dirname, '../../../..');
const GUIDE = readFileSync(join(REPO_ROOT, 'content', 'docs', 'guide', 'layout.md'), 'utf8');
const SIDEBAR_NAV_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'layout', 'src', 'SidebarNav.tsx'),
  'utf8',
);
const LAYOUT_INDEX_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'layout', 'src', 'index.ts'),
  'utf8',
);
const APP_SHELL_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'layout', 'src', 'AppShell.tsx'),
  'utf8',
);
/** The 768px the rewritten Responsive Behavior section is written around. */
const USE_MOBILE_SRC = readFileSync(
  join(REPO_ROOT, 'packages', 'components', 'src', 'hooks', 'use-mobile.tsx'),
  'utf8',
);

const GUIDE_LINES = GUIDE.split('\n').map((line) => line.trim());

// ---------------------------------------------------------------------------
// Half 1 — the page's SidebarNav examples, as typed values.
//
// `label:`, `icon: 'layout-dashboard'`, nested `items:` and the invented
// `active` / `disabled` are all rejected by `tsc` here, at the keyboard.
// ---------------------------------------------------------------------------

/** `## SidebarNav Component` → `### Basic Usage`. */
const basicNavItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Users', href: '/users', icon: Users, badge: '12' },
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
    children: [
      { title: 'Sales', href: '/reports/sales' },
      { title: 'Analytics', href: '/reports/analytics' },
    ],
  },
];

/** `### 5. Sidebar Organization`, the third block of the same defect. */
const organizationNavGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ title: 'Dashboard', href: '/', icon: Home }],
  },
  {
    label: 'Sales',
    items: [
      {
        title: 'Sales',
        href: '/sales',
        icon: DollarSign,
        children: [
          { title: 'Orders', href: '/orders' },
          { title: 'Invoices', href: '/invoices' },
        ],
      },
    ],
  },
  {
    label: 'System',
    items: [{ title: 'Settings', href: '/settings', icon: Settings }],
  },
];

/**
 * Both shapes have to be legal values of the SAME prop — that is the union the
 * `items` row documents. If `SidebarNavProps['items']` ever narrows to one of
 * them, these stop type-checking and the table has to move with the type.
 */
const flatItemsProp: SidebarNavProps['items'] = basicNavItems;
const groupedItemsProp: SidebarNavProps['items'] = organizationNavGroups;

// ---------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------

/** One prop of an interface: its name, whether it is optional, and its type. */
interface DeclaredProp {
  key: string;
  optional: boolean;
  type: string;
}

/** `title?: string` — how one prop reads in a failure message. */
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
 * `;`, so a key nested inside a type annotation — the `className?` in
 * `icon?: React.ComponentType<{ className?: string }>` — is never collected as a
 * prop of its own. Same construction as `guide-layout-app-shell-doc.test.ts`.
 */
function interfaceProps(src: string, name: string): DeclaredProp[] {
  const body = new RegExp(`(?:export )?interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(src);
  if (!body) throw new Error(`\`interface ${name}\` is gone from the source this test reads`);
  return [...stripComments(body[1]).matchAll(/^[ \t]*(\w+)(\??)\s*:\s*(.+?);[ \t]*$/gm)].map(
    (match) => ({ key: match[1], optional: match[2] === '?', type: match[3].trim() }),
  );
}

/**
 * The lines of the `## SidebarNav Component` section, up to the next `## `.
 *
 * Load-bearing: the page carries a SECOND `### Props` table, `AppShellProps`',
 * higher up. Reading tables page-wide would compare this component's rows with
 * that one's and belongs to a different test (objectui#4827).
 */
function sidebarNavSectionLines(): string[] {
  const start = GUIDE_LINES.indexOf('## SidebarNav Component');
  if (start === -1) {
    throw new Error('content/docs/guide/layout.md no longer has a `## SidebarNav Component` section');
  }
  let end = GUIDE_LINES.length;
  for (let i = start + 1; i < GUIDE_LINES.length; i += 1) {
    if (GUIDE_LINES[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return GUIDE_LINES.slice(start, end);
}

/**
 * Rows of the markdown table that follows `heading`, read as `DeclaredProp`s.
 *
 * Columns are `| Prop | Type | Required | Description |`; the first three are
 * what a props table can be wrong about in the way these issues are about.
 * `Required` is spelled `yes`/`no` rather than the interface's `?`, and anything
 * else is a malformed row rather than a silently-skipped one. Table cells escape
 * the union pipe as `\|`, so it is unescaped before comparison.
 */
function documentedProps(lines: string[], heading: string): DeclaredProp[] {
  const start = lines.indexOf(heading);
  if (start === -1) {
    throw new Error(
      `The SidebarNav section of content/docs/guide/layout.md no longer has a \`${heading}\` heading`,
    );
  }
  const props: DeclaredProp[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;
    if (!line.startsWith('|')) {
      if (props.length > 0) break;
      continue;
    }
    const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
    const key = /^`(\w+)`$/.exec(cells[1] ?? '')?.[1];
    if (!key) continue; // header row and the `| --- |` separator
    const type = (cells[2] ?? '').replace(/`/g, '').replace(/\\\|/g, '|').trim();
    const required = (cells[3] ?? '').toLowerCase();
    if (required !== 'yes' && required !== 'no') {
      throw new Error(
        `The \`${heading}\` row for \`${key}\` spells Required as "${cells[3]}"; it must be "yes" or "no".`,
      );
    }
    props.push({ key, optional: required === 'no', type });
  }
  return props;
}

/**
 * Every fenced code block on the page, with its info string and the 1-based line
 * its opening fence sits on — a JSON fence's first line is `{`, which identifies
 * nothing, so failures quote the line number instead.
 */
function fences(): { lang: string; body: string; line: number }[] {
  return [...GUIDE.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].map((match) => ({
    lang: match[1],
    body: match[2],
    line: GUIDE.slice(0, match.index).split('\n').length,
  }));
}

/** Fences anywhere on the page that are about this component. */
function sidebarNavFences(): { lang: string; body: string; line: number }[] {
  return fences().filter((fence) => fence.body.includes('SidebarNav'));
}

/**
 * Prop names on every `<SidebarNav …>` opening tag in `body`.
 *
 * Walks the tag rather than regexing the fence, tracking `{}` depth and string
 * quoting so a nested expression's identifiers and the words inside a quoted
 * attribute value are never collected as SidebarNav's own. Bare boolean
 * attributes (no `=`) are collected too. Same walker as
 * `guide-layout-app-shell-doc.test.ts`.
 */
function sidebarNavTagProps(body: string): string[] {
  const props: string[] = [];
  const TAG = '<SidebarNav';
  for (let start = body.indexOf(TAG); start !== -1; start = body.indexOf(TAG, start + 1)) {
    // Guard against matching a longer identifier, e.g. `<SidebarNavFoo`.
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
      else if ((ch === '>' || ch === '/') && depth === 0) break;
      tag += depth === 0 ? ch : ' ';
    }
    props.push(...[...tag.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0]));
  }
  return props;
}

/**
 * Component keys `registerLayout()` registers, read out of the source.
 *
 * `scripts/component-registrations.mjs` (objectui#4894) — the one reader the
 * four pins on this key list share. It replaced four copies of a regex that
 * accepted a single-quoted key and nothing else, which is a real failure here
 * and not a tidy one: this page LISTS the keys correctly, so a registration the
 * read misses reds the assertion below with the message "the page names a key
 * that is not registered" — sending the reader off to edit a page that was
 * right.
 */
function registeredKeys(): string[] {
  return readComponentRegistrations(LAYOUT_INDEX_SRC, 'packages/layout/src/index.ts').keys;
}

/**
 * The count words the intro sentence can spell its key list with.
 *
 * The number used to be hardcoded as `6` in the assertions below, which made a
 * pin that reads its key list out of source carry one fact that did not:
 * objectui#4841 deregistered `app-shell` and the count went to five, so the
 * literal was the only thing standing between an accurate page and a red test
 * for the wrong reason. The page's own word is read instead — the sentence and
 * the source still have to agree, but agreeing at any number is allowed.
 */
const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

describe("the guide's SidebarNav tables name exactly the real keys (objectui#4840)", () => {
  it.each([
    ['### Props', 'SidebarNavProps'],
    ['#### `NavItem`', 'NavItem'],
    ['#### `NavGroup`', 'NavGroup'],
  ])('%s matches `%s` — same order, optionality and type', (heading, name) => {
    const declared = interfaceProps(SIDEBAR_NAV_SRC, name);
    expect(declared.length, `no props parsed out of \`${name}\``).toBeGreaterThan(1);

    expect(
      documentedProps(sidebarNavSectionLines(), heading).map(format),
      [
        `The \`${heading}\` table in content/docs/guide/layout.md and \`${name}\` in`,
        'packages/layout/src/SidebarNav.tsx disagree about which keys exist. Those tables',
        'replaced a `Schema API` block that was wrong in seven ways at once (objectui#4840):',
        '`label` for `title`, `icon` as a string rather than a component, `items` for',
        '`children`, invented `active` / `disabled` / `defaultOpen`, and `collapsible` typed',
        'as a boolean when it is the union "offcanvas" | "icon" | "none".',
        '',
        'The expected list is READ OUT OF packages/layout/src/SidebarNav.tsx on every run, so',
        'this is never "update the test": add the new key to the table, or drop the row for the',
        'key that is gone. Only Prop / Type / Required are compared — Description is free prose.',
        '',
        `Declared by the component: ${declared.map(format).join('; ')}`,
      ].join('\n'),
    ).toEqual(declared.map(format));
  });

  it('and the example items really are `NavItem[]` / `NavGroup[]` (the compile-time half, made visible)', () => {
    // These reads are the point: a `const` nobody looks at is easy to delete,
    // and deleting it would silently retire the type-check that rejects
    // `label:` and `icon: 'layout-dashboard'` at the keyboard.
    expect(basicNavItems.map((item) => item.title)).toEqual(['Dashboard', 'Users', 'Reports']);
    expect(basicNavItems.map((item) => item.href)).toEqual(['/dashboard', '/users', '/reports']);
    // `icon` is a component, never a string — the defect objectui#3999 found on
    // the README, repeated here in JSON where no compiler could see it.
    expect(basicNavItems.some((item) => typeof item.icon === 'string')).toBe(false);
    // Nested rows live in `children`; the page used to spell this `items`.
    expect(basicNavItems[2].children?.map((child) => child.href)).toEqual([
      '/reports/sales',
      '/reports/analytics',
    ]);
    expect(organizationNavGroups.map((group) => group.label)).toEqual([
      'Overview',
      'Sales',
      'System',
    ]);
    expect(flatItemsProp).toBe(basicNavItems);
    expect(groupedItemsProp).toBe(organizationNavGroups);

    // The keys the page used to teach, and the reason this pin exists.
    const declared = interfaceProps(SIDEBAR_NAV_SRC, 'NavItem').map((prop) => prop.key);
    expect(declared).toContain('title');
    expect(declared).toContain('children');
    expect(declared).not.toContain('label');
    expect(declared).not.toContain('active');
    expect(declared).not.toContain('disabled');
    const props = interfaceProps(SIDEBAR_NAV_SRC, 'SidebarNavProps').map((prop) => prop.key);
    expect(props).toContain('title');
    expect(props).not.toContain('defaultOpen');
  });
});

describe("the guide's SidebarNav examples pass only real props (objectui#4840)", () => {
  it('every `<SidebarNav …>` prop on the page is a real one', () => {
    const declared = interfaceProps(SIDEBAR_NAV_SRC, 'SidebarNavProps').map((prop) => prop.key);
    expect(declared.length, 'no props parsed out of `SidebarNavProps`').toBeGreaterThan(1);

    const navFences = sidebarNavFences();
    expect(
      navFences.length,
      'no SidebarNav code fence found in content/docs/guide/layout.md at all',
    ).toBeGreaterThan(0);

    const used = [...new Set(navFences.flatMap((fence) => sidebarNavTagProps(fence.body)))];
    expect(used.length, 'no `<SidebarNav …>` tag found on the page at all').toBeGreaterThan(0);

    expect(
      used.filter((prop) => !declared.includes(prop)),
      [
        'A `<SidebarNav>` example in content/docs/guide/layout.md passes a prop the component',
        'does not declare (objectui#4840). The expected list is READ OUT OF',
        'packages/layout/src/SidebarNav.tsx on every run, so this is never "update the test":',
        'add the prop to `SidebarNavProps`, or stop teaching it.',
        `Declared: ${declared.join(', ')}`,
      ].join('\n'),
    ).toEqual([]);
  });

  it('and actually teaches `items`, `title` and `children`, so the scans are not passing on an empty set', () => {
    // "No undeclared props" is trivially true of no props, and "no `label:`" is
    // trivially true of a page with no examples. These are the spellings the
    // phantom ones displaced, so they are asserted positively.
    const navFences = sidebarNavFences();
    const used = new Set(navFences.flatMap((fence) => sidebarNavTagProps(fence.body)));
    expect(used.has('items'), '`items` is the only required prop and no example passes it').toBe(
      true,
    );

    const bodies = navFences.map((fence) => fence.body).join('\n');
    for (const spelling of ['title:', 'children:']) {
      expect(
        bodies.includes(spelling),
        [
          `No SidebarNav example in content/docs/guide/layout.md spells \`${spelling}\` any more.`,
          'The page used to teach `label:` for the row label and a nested `items:` for child',
          'rows; `title` and `children` are the real keys that replaced them (objectui#4840).',
          'A page that stops showing them sends readers back to the shape that renders a row',
          'with no label at all.',
        ].join('\n'),
      ).toBe(true);
    }
  });

  it('never spells `icon` as a string in a SidebarNav example', () => {
    for (const fence of sidebarNavFences()) {
      expect(
        /\bicon\s*:\s*['"`]/.test(fence.body),
        [
          `The SidebarNav example at content/docs/guide/layout.md:${fence.line} writes \`icon\` as a`,
          'quoted string. `NavItem.icon` is a `React.ComponentType`, rendered as `<item.icon />`',
          '(SidebarNav.tsx:60 and :109) — a string reaches React as an unknown lowercase tag and',
          'renders nothing (objectui#4840, objectui#3999). Import the Lucide component and pass it.',
          '',
          'Scope note: `NavigationRenderer` DOES take an icon NAME as a string,',
          "so this assertion is deliberately confined to fences that mention SidebarNav.",
        ].join('\n'),
      ).toBe(false);
    }
  });
});

describe('the guide authors no `sidebar-nav` JSON node (objectui#4840)', () => {
  it('`sidebar-nav` is still not a registered component key', () => {
    const keys = registeredKeys();
    expect(keys.length, 'no `ComponentRegistry.register` calls parsed out of index.ts').toBeGreaterThan(1);

    expect(
      keys,
      [
        '`sidebar-nav` is now registered. content/docs/guide/layout.md states as measured fact',
        'that the key does not resolve and that a node renders "Unknown component type"',
        '(objectui#4840). That paragraph is now false, and the PAGE — not this assertion — is',
        'what has to change: document the node, its `inputs`, and which of `SidebarNavProps`',
        'a JSON document can actually fill (`items` is plain data, but `icon` is a',
        '`React.ComponentType`, so the node needs an icon-name path of its own).',
      ].join('\n'),
    ).not.toContain('sidebar-nav');
  });

  it('and the page names exactly the keys that ARE registered', () => {
    const keys = registeredKeys();
    // The sentence reads: "registers five keys — `a`, `b` … and `e` — and nothing …".
    //
    // Whitespace is matched as `\s+` rather than a literal space throughout: the
    // sentence is markdown prose that gets re-wrapped whenever the key list
    // changes length, and with literal spaces this pin failed on a line break
    // landing between "and" and "nothing" — a rewrap, not a drift. Where the
    // lines break is not a fact this file should have an opinion about.
    const sentence = /registers (\w+) keys\s+—\s+([\s\S]*?)\s+—\s+and\s+nothing/.exec(GUIDE);
    if (!sentence) {
      throw new Error(
        'The `## SidebarNav Component` intro no longer carries its "registers <count> keys — … — and nothing" list',
      );
    }
    const spelled = NUMBER_WORDS[sentence[1].toLowerCase()];
    if (spelled === undefined) {
      throw new Error(
        `The \`## SidebarNav Component\` intro spells its key count "${sentence[1]}", which is not a number word this test can read. Spell it in words (e.g. "five"), or add the word to NUMBER_WORDS.`,
      );
    }
    const named = [...sentence[2].matchAll(/`([^`]+)`/g)].map((match) => match[1]);

    expect(
      named.slice().sort(),
      [
        'The key list in content/docs/guide/layout.md and the `ComponentRegistry.register` calls',
        'in packages/layout/src/index.ts disagree. The page names that list to make the point',
        'that `sidebar-nav` is absent from it (objectui#4840), so a stale list undermines the',
        'only claim it is there to support.',
        `Registered: ${keys.join(', ')}`,
      ].join('\n'),
    ).toEqual(keys.slice().sort());
    expect(
      named.length,
      `the page says "${sentence[1]} keys" but names a different number`,
    ).toBe(spelled);
    expect(
      keys.length,
      `the page says "${sentence[1]} keys" but the source registers a different number`,
    ).toBe(spelled);
  });

  it('no fence on the page contains a `{ "type": "sidebar-nav" }` node', () => {
    // The key is matched with OPTIONAL quotes on purpose. The block this issue
    // removed was fenced as `typescript` and spelled the node `type:
    // 'sidebar-nav'` with a bare key, so a JSON-only pattern would have walked
    // straight past the very block that declared the phantom shape.
    const offenders = fences().filter((fence) =>
      /["']?\btype["']?\s*:\s*["']sidebar-nav["']/.test(fence.body),
    );

    expect(
      offenders.map((fence) => `content/docs/guide/layout.md:${fence.line}`),
      [
        'A fence in content/docs/guide/layout.md authors a `sidebar-nav` node again',
        '(objectui#4840). The key is not registered anywhere in this repo, so the node does not',
        'resolve at all: the renderer replaces it with the red "Unknown component type:',
        'sidebar-nav" panel (OBJUI-001) and no sidebar renders. Teach the React composition',
        'instead, or put the tree in the app\'s `navigation` metadata when it must come from JSON.',
      ].join('\n'),
    ).toEqual([]);
  });
});

describe("the source facts the guide's Responsive Behavior section rests on (objectui#4842)", () => {
  it("`AppShell`'s header renders `navbar` and adds no toggle of its own", () => {
    const header = /<header[\s\S]*?<\/header>/.exec(APP_SHELL_SRC);
    if (!header) throw new Error('`AppShell` no longer renders a `header` element');

    expect(
      header[0],
      [
        'The `header` element in packages/layout/src/AppShell.tsx now renders something besides',
        '`{navbar}`. content/docs/guide/layout.md tells readers the header adds no controls of',
        'its own — in particular no sidebar toggle — and that they must render a',
        '`SidebarTrigger` inside `navbar` themselves, or the mobile sidebar can only be opened',
        'with Cmd/Ctrl+B (objectui#4842). content/docs/layout/app-shell.mdx says the same.',
        'If the shell now supplies a toggle, BOTH pages are wrong and have to change.',
      ].join('\n'),
    ).not.toMatch(/SidebarTrigger|toggleSidebar/);
    expect(header[0]).toContain('{navbar}');
  });

  it('the header is `h-12` at every breakpoint, with only its horizontal padding responsive', () => {
    const header = /<header[\s\S]*?>/.exec(APP_SHELL_SRC);
    if (!header) throw new Error('`AppShell` no longer renders a `header` element');

    // The page says "h-12 at EVERY breakpoint — there is no compact variant",
    // replacing a "Compact header" bullet that was never true (objectui#4842).
    // 48 px since objectui#12639, the console bar's one height.
    expect(header[0], 'the header is no longer `h-12`').toContain('h-12');
    expect(
      /(sm|md|lg):h-/.test(header[0]),
      [
        'The header now has a responsive height variant. content/docs/guide/layout.md states it',
        'is `h-12` at every breakpoint and that there is no compact variant (objectui#4842) —',
        'the page, not this assertion, is what has to change.',
      ].join('\n'),
    ).toBe(false);
    expect(header[0], 'the header padding steps are no longer `px-2 sm:px-4`').toContain(
      'px-2 sm:px-4',
    );
  });

  it('the mobile breakpoint is still 768px, and nothing in the shell reads `lg`', () => {
    const breakpoint = /const MOBILE_BREAKPOINT = (\d+)/.exec(USE_MOBILE_SRC);
    if (!breakpoint) {
      throw new Error('`MOBILE_BREAKPOINT` is gone from packages/components/src/hooks/use-mobile.tsx');
    }

    expect(
      Number(breakpoint[1]),
      [
        'The sidebar breakpoint moved. content/docs/guide/layout.md is written around a single',
        '768px boundary — Tailwind `md`, and this constant — after its three fictional tiers',
        'split at 1024px were removed (objectui#4842). Update the page with the new number.',
      ].join('\n'),
    ).toBe(768);

    // A Tailwind breakpoint prefix is `lg:` immediately followed by a utility;
    // `lg: "h-12 …"` (with a space) is a cva SIZE-VARIANT key, not a breakpoint,
    // which is why this matches `lg:` + non-space rather than the bare string.
    for (const [name, src] of [
      ['AppShell.tsx', APP_SHELL_SRC],
      ['SidebarNav.tsx', SIDEBAR_NAV_SRC],
    ] as const) {
      expect(
        /\blg:\S/.test(src),
        [
          `packages/layout/src/${name} now uses an \`lg:\` (1024px) utility.`,
          'content/docs/guide/layout.md states there is no separate tablet/desktop tier and that',
          '800px and 1400px get the same layout (objectui#4842). A real `lg` rule makes that',
          'false — re-audit the section against the new classes.',
        ].join('\n'),
      ).toBe(false);
    }
  });

  it('the content padding still steps the three ways the page quotes', () => {
    // The content element is the first element inside `SidebarInset` (the
    // shell's one `main` landmark; the content element is a `<div>` since
    // objectui#13334).
    const content = /<SidebarInset[\s\S]*?>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?(<div[\s\S]*?>)/.exec(APP_SHELL_SRC);
    if (!content) throw new Error('`AppShell` no longer renders a content element inside `SidebarInset`');

    for (const cls of ['p-3', 'sm:p-4', 'md:p-6', 'pb-20']) {
      expect(
        content[1],
        [
          `The content element in packages/layout/src/AppShell.tsx no longer has \`${cls}\`.`,
          'content/docs/guide/layout.md quotes these padding steps literally (objectui#4842);',
          'update the page to match the new classes.',
        ].join('\n'),
      ).toContain(cls);
    }
  });
});
