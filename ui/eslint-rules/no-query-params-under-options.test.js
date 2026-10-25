/**
 * Pins `no-query-params-under-options` in BOTH directions, because the rule is
 * only worth having if it discriminates: `options` is a normal key in this repo
 * (measured at the time of writing: 47 object literals carry an `options`
 * object property, none of them with a `$`-prefixed key), so a rule that
 * blanket-matched on the name would be uninstallable.
 *
 * The valid cases are therefore real shapes lifted from the repo —
 * `options: { data }` (plugin-dashboard fixtures), `options: { kanban,
 * calendar }` (ObjectView / ListView view registries), `options: { sortBy,
 * sortOrder, limit }` (DatasetWidget), `options: { empty, selectFirst }` (every
 * i18n locale) — plus the shapes the rule deliberately cannot judge (computed
 * keys, spreads) and the correct spelling it exists to leave alone.
 *
 * The invalid cases are the two live instances this rule was written for, in
 * the exact form they shipped: `object-timeline`'s whole fetch
 * (`find(objectName, { options: { $top: 100 } })`, objectui#4009 /
 * objectstack#7137) and `object-kanban`'s split spelling (`$filter` at the top
 * level, the cap under `options`, objectui#4025) — the second being the one
 * that made a board fetch every row the server would return.
 *
 * The prose direction needs no case here and deliberately has none: every
 * remaining textual match in the repo is a comment or a test header describing
 * that history, and an AST rule cannot see a comment. That is the whole reason
 * the card chose an AST signature over a text scan.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-query-params-under-options.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

ruleTester.run('no-query-params-under-options', rule, {
  valid: [
    // The correct spelling — the whole point of the rule.
    `dataSource.find(objectName, { $top: 100 });`,
    `dataSource.find(objectName, { $filter: filter, $top: 100, $orderby: 'name asc' });`,
    // A primary-key lookup capped at the top level (packages/fields).
    `dataSource.find(objectName, { $filter: { _id: id }, $top: 1 });`,

    // `options` objects with no `$`-prefixed key at all — all real repo shapes.
    `renderWidget(widget, { options: { data: rows } });`,
    `const schema = { options: { kanban: {}, calendar: {}, timeline: {} } };`,
    `const widget = { type: 'table', options: { sortBy: 'amount', sortOrder: 'desc', limit: 5 } };`,
    `const strings = { options: { empty: 'No options', selectFirst: 'Select first' } };`,
    `const view = { options: {} };`,

    // A `$`-prefixed key at the top level, beside a legitimate `options` object:
    // the sibling is not what makes the mistake.
    `dataSource.find(objectName, { $top: 100 }, { options: { density: 'compact' } });`,

    // Not an object literal on the right-hand side — nothing to read.
    `const params = { options };`,
    `const params = { options: buildOptions() };`,
    `const params = { options: existingOptions };`,
    `const params = { options: null };`,

    // Keys the AST cannot resolve. Both directions of "say nothing" rather than
    // guess: a computed key may or may not be `$top`, a spread hides its keys.
    `const params = { options: { [key]: 100 } };`,
    `const params = { options: { ...queryParams } };`,
    `const params = { [wrapper]: { $top: 100 } };`,

    // A different wrapper name is a different question — this rule is about the
    // one spelling that has already cost two blocks their row caps.
    `const params = { config: { $top: 100 } };`,
    `const params = { query: { $top: 100 } };`,

    // `$`-prefixed keys nested one level deeper under a legitimate `options`
    // object are somebody else's structure, not a misplaced query param.
    `const params = { options: { filter: { $gt: 5 } } };`,

    // A Mongo-style operator object under a NON-`options` field name is exactly
    // how `$filter` is written repo-wide, and must stay silent.
    `dataSource.find(objectName, { $filter: { amount: { $gte: 100 } }, $top: 50 });`,
  ],
  invalid: [
    // objectui#4009 / objectstack#7137 — object-timeline's entire fetch.
    {
      code: `const result = await dataSource.find(objectName, { options: { $top: 100 } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // objectui#4025 — object-kanban: `$filter` top level, the cap stranded
    // under `options`. The board fetched every row the server would return.
    {
      code: `const result = await dataSource.find(objectName, { $filter: filter, options: { $top: 100 } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // Any `$`-prefixed key, not just the paging pair — the whole OData surface
    // is declared at the top level.
    {
      code: `find(obj, { options: { $filter: { status: 'open' } } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    {
      code: `find(obj, { options: { $orderby: 'name asc' } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    {
      code: `find(obj, { options: { $select: ['id', 'name'] } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    {
      code: `find(obj, { options: { $expand: ['owner'] } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // An adapter-specific `$`-prefixed key is dead there for the same reason.
    {
      code: `find(obj, { options: { $customAdapterKey: true } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // Quoted keys are the same keys.
    {
      code: `find(obj, { 'options': { '$top': 100 } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // One mistake, one report — the wrapper is the defect, not each key. A
    // per-key report would put three squiggles on one grouping.
    {
      code: `find(obj, { options: { $top: 100, $skip: 20, $orderby: 'name' } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // A spread hides its own keys but does not excuse the visible one.
    {
      code: `find(obj, { options: { ...base, $top: 100 } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // The params object need not be written at the call site — the type system
    // accepts this spelling just as readily one variable away.
    {
      code: `const params = { options: { $top: 100 } }; dataSource.find(objectName, params);`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // Nested anywhere, at any depth.
    {
      code: `const config = { data: { query: { options: { $top: 100 } } } };`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    // Two separate wrappers are two separate mistakes.
    {
      code: `const a = { options: { $top: 100 } }; const b = { options: { $skip: 20 } };`,
      errors: [{ messageId: 'deadOptionsKey' }, { messageId: 'deadOptionsKey' }],
    },
    // The message has to say where the key belongs, or the author is left to
    // guess the correct spelling — which is how the second instance happened.
    {
      code: `find(obj, { options: { $top: 100 } });`,
      errors: [
        {
          message: /`\$top` is nested under `options`.+declares these keys at the TOP level.+find\(obj, \{ \$top: 100 \}\)/s,
        },
      ],
    },
  ],
});

/**
 * The same rule under the parser it actually runs with. `eslint.config.js`
 * applies it to every `.ts`/`.tsx` file through typescript-eslint, and
 * TypeScript adds shapes espree cannot express — one of which MUST stay silent.
 */
const tsRuleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

tsRuleTester.run('no-query-params-under-options (typescript)', rule, {
  valid: [
    // A TYPE declaration is not a value. `QueryParams` itself, and every
    // adapter option type in the repo, declares object-shaped members this way;
    // a rule that reported here would be unusable in `packages/types`.
    `interface FetchConfig { options?: { $top?: number; $skip?: number } }`,
    `type FetchConfig = { options?: { $top?: number } };`,
    `declare function find(obj: string, params?: { options?: { $top?: number } }): void;`,
    // A typed but correct call.
    `const params: QueryParams = { $top: 100, $filter: { status: 'open' } };`,
  ],
  invalid: [
    // A cast does not change the shape, and `satisfies` is where the index
    // signature's tolerance is most visible: this passes type-checking.
    {
      code: `const params = { options: { $top: 100 } } as QueryParams;`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    {
      code: `const params = { options: { $top: 100 } } satisfies QueryParams;`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    {
      code: `const params: QueryParams = { options: { $top: 100 } };`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
  ],
});
