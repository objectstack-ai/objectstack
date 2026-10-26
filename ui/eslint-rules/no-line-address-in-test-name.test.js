/**
 * Pins `no-line-address-in-test-name` against BOTH directions, because the
 * class this rule closes is defined by an instrument that fails in both.
 *
 * The `invalid` block carries every shape the address is known to arrive in —
 * the five quote/modifier flavours of a literal name, and the INTERPOLATED
 * form where the address lives in a case table and never appears on an `it(`
 * line at all. A rule that only read `it(` string literals would pass the
 * first group and silently miss the second, which is exactly how the sweeps
 * before it under-counted the population six-fold.
 *
 * The `valid` block is the other half, and it is the answer to "where is a
 * line address legitimate". Every entry is a real shape from this tree,
 * reduced: an assertion message, a data field the title never names, a data
 * field a test asserts ON, a comment, and an address whose line number is
 * COMPUTED from a live read (derived, so it cannot rot). Without them the rule
 * would be a rule against writing `.ts:` anywhere near a test.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-line-address-in-test-name.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

ruleTester.run('no-line-address-in-test-name', rule, {
  valid: [
    // ── The carve-outs of design question 2 ──────────────────────────────
    // An assertion message: a human reads it AT THE POINT OF FAILURE, where
    // the assertion that failed is the context. Real shape:
    // readme-app-shell-example.test.ts.
    `it('AppShell declares every prop the README passes', () => {
       expect(undeclared, 'AppShell destructures a fixed key list (AppShell.tsx:233-241)').toEqual([]);
     });`,
    // A case-table field the title never names. `$key` is spliced, `producer`
    // is not, and `producer` is spliced into the FAILURE MESSAGE instead.
    // Real shape: gridNonAuthorKeys.test.tsx.
    // fixture-address: RuleTester input; the rule reads this token's SHAPE, so no real address would make the case any truer
    `const KEYS = [{ key: 'columnState', producer: 'app-shell/src/views/ObjectView.tsx:1848' }];
     it.each(KEYS)('the spec refuses $key as an unrecognized key', ({ key, producer }) => {
       expect(refuse(key), \`written by \${producer}\`).toBe(true);
     });`,
    // Data the test asserts ON — something checks it, so it is not the
    // unreadable class. Real shape: page-header-authorable-keys.test.tsx.
    `const REASONS = { icon: 'reads and draws it (PageHeader.tsx:123), objectui#3829.' };
     it('every renderer-own declaration says why', () => {
       expect(/#\\d+/.test(REASONS.icon)).toBe(true);
     });`,
    // A comment. ESLint hands rules an AST and this rule never reads comments.
    `// moved to SidebarNav.tsx:60 in objectui#4840
     it('renders the nav', () => { expect(1).toBe(1); });`,
    // Derived, not cited: the line number is COMPUTED from a live read of the
    // file, so it cannot rot. Real shape: guide-layout-sidebar-nav-doc.test.ts.
    'it(`the fence at layout.md:${fence.line} spells icon as a component`, () => { expect(1).toBe(1); });',
    // `$#` is the case INDEX — no case string reaches the name.
    `const ROWS = [{ src: 'a/b.ts:12' }];
     it.each(ROWS)('case $# round-trips', ({ src }) => { expect(src).toBeTruthy(); });`,
    // A fixed title cannot carry a row's string, whatever the table holds.
    `const ROWS = [{ src: 'a/b.ts:12' }];
     it.each(ROWS)('every corpus row round-trips', ({ src }) => { expect(src).toBeTruthy(); });`,

    // ── The known-negative SHAPES: things that look like an address ───────
    `it('pins the published range at 1.2.3', () => { expect(1).toBe(1); });`,      // version
    `it('renders the 12:30 slot', () => { expect(1).toBe(1); });`,                  // clock
    `it('reads layout.ts without opening it', () => { expect(1).toBe(1); });`,      // bare path
    `it('proxies to http://localhost:3000/api', () => { expect(1).toBe(1); });`,    // host:port
    // Somebody else's API — a member call that merely ends in `.it`.
    `page.it('navigates to Foo.tsx:12', () => {});`,
  ],

  invalid: [
    // ── Leg 1, the five literal flavours the earlier sweep enumerated ─────
    {
      code: `it('plugin-list ListView case chart legacy leg (ListView.tsx:2767-2768)', () => {});`,
      errors: [{ messageId: 'inTitle', data: { address: 'ListView.tsx:2767' } }],
    },
    {
      code: `it("app-shell ObjectView chart viewDef legacy leg (views/ObjectView.tsx:2218)", () => {});`,
      // fixture-address: RuleTester input and the expected data that must echo it; repairing either changes what this case pins
      errors: [{ messageId: 'inTitle', data: { address: 'views/ObjectView.tsx:2218' } }],
    },
    {
      code: 'it(`DashboardRenderer widget with a provider aggregate (DashboardRenderer.tsx:620)`, () => {});',
      errors: [{ messageId: 'inTitle' }],
    },
    {
      code: `describe('the retired member at layout.ts:66', () => {});`,
      // fixture-address: the parsed input and its expected message data; the rule under test reads this token, and both copies must stay equal
      errors: [{ messageId: 'inTitle', data: { address: 'layout.ts:66' } }],
    },
    {
      code: `it.skip('cites tsconfig.typetests.json:12 by line', () => {});`,
      errors: [{ messageId: 'inTitle' }],
    },
    {
      code: `it.each([1, 2])('case %s at ObjectChart.tsx:41', () => {});`,
      errors: [{ messageId: 'inTitle' }],
    },

    // ── Leg 2, the INTERPOLATED shape — the whole reason for the rule ─────
    // The address is in a case table, twenty lines from any `it(` line.
    {
      code: `const CORPUS = [{ src: 'showcase/flows/index.ts:39', cel: 'a == b' }];
             it.each(CORPUS)('adopts $src as structured rows', ({ cel }) => { expect(cel).toBeTruthy(); });`,
      errors: [{ messageId: 'inEachCase', data: { address: 'showcase/flows/index.ts:39' } }],
    },
    // ...through a derivation, so a `.filter()` cannot hide a row.
    {
      code: `const CORPUS = [{ src: 'showcase/flows/index.ts:1696', parens: true }];
             it.each(CORPUS.filter((c) => c.parens))('leaves $src on raw mode', () => {});`,
      errors: [{ messageId: 'inEachCase', data: { address: 'showcase/flows/index.ts:1696' } }],
    },
    // ...and through a nested path, `$row.src`.
    {
      code: `const CASES = [{ row: { src: 'packages/react/README.md:224' } }];
             it.each(CASES)('anchor for $row.src', () => {});`,
      // fixture-address: the input the rule extracts from and the address it must report; one fixture, and neither names a line to find
      errors: [{ messageId: 'inEachCase', data: { address: 'packages/react/README.md:224' } }],
    },
    // A POSITIONAL title cannot say which field arrives, so the whole row is
    // read — the safe direction, over-reporting rather than staying silent.
    {
      code: `it.each([['a', 'ListView.tsx:99']])('%s at %s', () => {});`,
      errors: [{ messageId: 'inEachCase', data: { address: 'ListView.tsx:99' } }],
    },

    // ── Leg 3, "cannot tell" must not be spelled like "clean" ─────────────
    {
      code: `const ADDR = 'ObjectView.tsx:1848';
             it.each(buildCases())('adopts $src', () => { use(ADDR); });`,
      errors: [{ messageId: 'inUnresolvedTable', data: { address: 'ObjectView.tsx:1848' } }],
    },
  ],
});
