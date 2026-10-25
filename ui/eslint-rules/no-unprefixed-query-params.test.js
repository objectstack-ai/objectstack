/**
 * Pins `no-unprefixed-query-params` in BOTH directions, because this rule is
 * only worth having if it discriminates. Every name on its list — `top`,
 * `limit`, `filter`, `sort`, `select`, `fields`, `count`, `offset` — is a
 * perfectly ordinary object key in this repo, so unlike its sibling
 * (`no-query-params-under-options`, whose `$`-key-under-`options` signature is
 * unmistakable anywhere) this one carries no signal at all away from a finder
 * call. A version that matched on the name alone would be uninstallable, and
 * the valid cases below are what say so.
 *
 * The invalid cases are the four live sites this rule was written for, in the
 * exact form they shipped (objectui#5458):
 *
 *   - `app-shell` `ObjectView.tsx` — `find(name, { limit: 0 })`. The one that
 *     INVERTED rather than widened: `$top: 0` means "no records", so the
 *     dropped key turned "count only, fetch nothing" into "fetch every row",
 *     on every mount and every refresh of every list view.
 *   - `app-shell` `metadata-admin/AssignedUsersSection.tsx` — `{ $filter: {…},
 *     limit: 1 }`, one line from three CORRECT calls. Those three neighbours
 *     are in the valid list below as the false-positive control: half-correct
 *     spelling inside one literal is the whole shape of this defect, so a rule
 *     that reported the correct half would be worse than none.
 *   - `plugin-dashboard` `DashboardFilterBar.tsx` — `fields` and `top` in ONE
 *     literal, under a comment describing the query as capped at 200 records.
 *     The card never named this site; the rule found it on its first repo-wide
 *     run, which is the argument for mechanising the family.
 *   - `apps/console` `sdui-workbench-preview.tsx` — deliberately ABSENT here,
 *     and that absence is the point. Its `find` call lives inside a template
 *     literal holding runtime page metadata, so the parser sees one
 *     `TemplateLiteral` and never a `CallExpression`. No AST rule can reach it;
 *     it was fixed by hand. Asserting it here would be asserting a capability
 *     the rule does not have.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-unprefixed-query-params.js';
import siblingRule from './no-query-params-under-options.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

ruleTester.run('no-unprefixed-query-params', rule, {
  valid: [
    // ── The correct spelling — the whole point of the rule.
    `dataSource.find(objectName, { $top: 100 });`,
    `dataSource.find(objectName, { $filter: filter, $top: 100, $orderby: 'name asc' });`,
    `adapter.findOne(objectName, { $select: ['id', 'name'] });`,

    // ── FALSE-POSITIVE CONTROL: the three correct neighbours that sit within a
    //    few lines of the `limit: 1` site in AssignedUsersSection.tsx, verbatim.
    //    The rule reported the fourth call in that file and none of these.
    `adapter.find('sys_user_permission_set', { $filter: { permission_set_id: id }, $top: 500 });`,
    `adapter.find('sys_position_permission_set', { $filter: { permission_set_id: id }, $top: 200 });`,
    `adapter.find('sys_user', { $filter: { id: { $in: userIds } }, $top: 1000 });`,

    // ── `Array.prototype.find`, which is a `.find(` member call too. Excluded
    //    by its own signature: a predicate first argument. Real ObjectView shapes.
    `const objectDef = objects.find((o) => o.name === objectName);`,
    `const targetView = views.find(function (v) { return v.id === vid; });`,
    // …including the two-argument form, where `thisArg` is the second argument.
    `rows.find(function (r) { return r.id === id; }, { count: 0, limit: 1 });`,

    // ── Keys off the closed list stay silent HERE. They were read as the
    //    adapter-specific params the index signature existed for; objectui#7497
    //    found none and closed the type, so on a typed site `tsc` refuses them
    //    now. This rule still does not report them: "any unprefixed key" is
    //    what it deliberately isn't.
    `adapter.find(objectName, { $top: 10, includeDeleted: true, tenant: 'acme' });`,
    `adapter.find(objectName, { $top: 10, cacheKey: key, signal: controller.signal });`,

    // ── A listed name away from a finder call carries no signal whatsoever.
    `const widget = { type: 'table', options: { sortBy: 'amount', limit: 5 } };`,
    `const pagination = { limit: 20, offset: 40, count: true };`,
    `renderList({ top: 200, filters: rules });`,
    `fetchPage(url, { limit: 50 });`,
    // A method that is not `find`/`findOne`. The boundary is deliberate.
    `adapter.query(objectName, { top: 200 });`,
    `adapter.aggregate(objectName, { limit: 10 });`,

    // ── Position matters: only the SECOND argument is a `QueryParams`.
    `client.find({ limit: 10 });`,
    `adapter.find(objectName, { $top: 1 }, { limit: 5, retries: 2 });`,

    // ── Only the TOP level of that argument. A field genuinely NAMED `limit`
    //    or `count`, filtered on, is normal data and must stay silent.
    `adapter.find('plan', { $filter: { limit: 5 }, $top: 20 });`,
    `adapter.find('usage', { $filter: { count: { $gt: 10 }, offset: 3 } });`,

    // ── Shapes the rule cannot judge, so it says nothing.
    `adapter.find(objectName, { [key]: 200 });`,
    // A computed key is silent even when its value happens to be a readable
    // string literal. `staticKeyName` is character-for-character the sibling
    // rule's, and the two must not fork: "computed means say nothing" is one
    // contract stated in both files, and a knowable-subset exception in one
    // copy only is the kind of silent divergence duplicated helpers die of.
    // No site has ever written a query option this way.
    `adapter.find(objectName, { ['top']: 200 });`,
    `adapter.find(objectName, { ...params });`,
    `adapter.find(objectName, params);`,
    `adapter.find(objectName);`,

    // ── The SIBLING's shape. `{ options: { $top: 100 } }` carries no
    //    unprefixed key at the top level, so THIS rule is correctly silent —
    //    `no-query-params-under-options` is what reports it, and the pin that
    //    it still does is at the bottom of this file.
    `dataSource.find(objectName, { options: { $top: 100 } });`,
  ],

  invalid: [
    // ── Live site 1: ObjectView.tsx, the inverting one.
    {
      code: `dataSource.find(objectDef.name, { limit: 0 }).then(read);`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },
    // ── Live site 2: AssignedUsersSection.tsx, beside the three valid cases above.
    {
      code: `adapter.find('sys_permission_set', { $filter: { name: permissionSetName }, limit: 1 });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },
    // ── Live site 3: DashboardFilterBar.tsx — TWO dropped keys in one literal,
    //    so two reports. `fields` is the projection (`$select`), `top` the cap.
    {
      code: `dataSource.find(from.object, { fields: [from.valueField], $filter: f, top: 200 });`,
      errors: [
        { messageId: 'unprefixedQueryOption', data: { key: 'fields', canonical: '$select' } },
        { messageId: 'unprefixedQueryOption', data: { key: 'top', canonical: '$top' } },
      ],
    },

    // ── Every listed spelling reports, and reports the key it really means —
    //    `limit`/`offset`/`filters`/`sort`/`fields` do NOT rename to `$limit`
    //    and friends, which is also why there is no autofixer.
    {
      code: `adapter.find(o, { top: 1, skip: 2, filter: f, filters: g });`,
      errors: [
        { key: 'top', canonical: '$top' }, { key: 'skip', canonical: '$skip' },
        { key: 'filter', canonical: '$filter' }, { key: 'filters', canonical: '$filter' },
      ].map((data) => ({ messageId: 'unprefixedQueryOption', data })),
    },
    {
      code: `adapter.find(o, { select: s, fields: f, orderby: 'a', sort: 'b' });`,
      errors: [
        { key: 'select', canonical: '$select' }, { key: 'fields', canonical: '$select' },
        { key: 'orderby', canonical: '$orderby' }, { key: 'sort', canonical: '$orderby' },
      ].map((data) => ({ messageId: 'unprefixedQueryOption', data })),
    },
    {
      code: `adapter.find(o, { expand: e, search: q, count: true, limit: 5, offset: 10 });`,
      errors: [
        { key: 'expand', canonical: '$expand' }, { key: 'search', canonical: '$search' },
        { key: 'count', canonical: '$count' }, { key: 'limit', canonical: '$top' },
        { key: 'offset', canonical: '$skip' },
      ].map((data) => ({ messageId: 'unprefixedQueryOption', data })),
    },

    // ── `findOne` is in scope for the same reason `find` is.
    {
      code: `adapter.findOne('contact', { select: ['id'] });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'select', canonical: '$select' } }],
    },

    // ── Static key spellings the rule must still read.
    {
      code: `adapter.find(o, { 'limit': 10 });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },
    {
      code: `adapter?.find(o, { limit: 10 });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },
    {
      code: `this.dataSource.find(o, { top: 200 });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'top', canonical: '$top' } }],
    },
    {
      code: `adapter['findOne'](o, { limit: 1 });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },

    // ── The doc page's old shape, which prose now warns against by name.
    {
      code: `adapter.find(o, { filters: [['status', '=', 'open']] });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'filters', canonical: '$filter' } }],
    },

    // ── A correct key beside a dropped one: only the dropped one reports.
    {
      code: `adapter.find(o, { $filter: f, $orderby: 'name asc', limit: 25 });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },
  ],
});

/**
 * The same rule under the parser it actually runs with. `eslint.config.js`
 * applies it to every `.ts`/`.tsx` file through typescript-eslint, and
 * TypeScript adds two shapes espree cannot express — a cast, and a type
 * declaration. They must go opposite ways.
 */
const tsRuleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

tsRuleTester.run('no-unprefixed-query-params (typescript)', rule, {
  valid: [
    // A TYPE is not a value, and none of these is a call.
    `interface Page { limit?: number; offset?: number }`,
    `type Finder = (o: string, p: { top?: number }) => void;`,
    `declare function find(o: string, p?: { limit?: number }): void;`,
    // Correct spelling, typed.
    `const params: QueryParams = { $top: 100 }; adapter.find(o, params);`,
    `adapter.find(o, { $top: 100 } as QueryParams);`,
  ],
  invalid: [
    // A type assertion skips excess-property checking, so the first two still
    // compile with the index signature gone (objectui#7497); the third is an
    // untyped source. This is the population the rule exists for, so a cast
    // must not be an escape.
    {
      code: `adapter.find(o, { limit: 1 } as QueryParams);`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },
    {
      code: `adapter.find(o, { top: 200 } satisfies QueryParams);`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'top', canonical: '$top' } }],
    },
    {
      code: `dataSource!.find(o, { limit: 0 });`,
      errors: [{ messageId: 'unprefixedQueryOption', data: { key: 'limit', canonical: '$top' } }],
    },
  ],
});

/**
 * REGRESSION CONTROL for the half that was already gated (objectui#4734).
 *
 * This rule is a SIBLING, not a replacement: the two anchor on different
 * shapes, carry different messages, and must be separately silenceable — one
 * `eslint-disable` may not switch off both halves of the class. Landing this
 * file must therefore leave `{ options: { $top: 100 } }` failing exactly as it
 * did before, so the sibling is re-run here on the two instances it was written
 * for. Its own test file covers it in full; this is the cross-check that the
 * two rules still divide the class between them and neither has swallowed the
 * other.
 */
const siblingTester = new RuleTester();

siblingTester.run('no-query-params-under-options (still gated)', siblingRule, {
  valid: [
    // The shape THIS card fixed is the new rule's business, not the sibling's.
    `dataSource.find(objectName, { limit: 0 });`,
    `dataSource.find(objectName, { $top: 100 });`,
  ],
  invalid: [
    // object-timeline (objectui#4009) and object-kanban (objectui#4025).
    {
      code: `find(objectName, { options: { $top: 100 } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
    {
      code: `dataSource.find(objectName, { $filter: filter, options: { $top: 100 } });`,
      errors: [{ messageId: 'deadOptionsKey' }],
    },
  ],
});
