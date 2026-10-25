/**
 * ObjectUI ESLint rule: no-unprefixed-query-params
 *
 * Sibling of `no-query-params-under-options`, for the other half of the same
 * defect class: a query option written WITHOUT its `$`, at the TOP level of a
 * `find`/`findOne` params object — `find(obj, { top: 200 })` instead of
 * `find(obj, { $top: 200 })`.
 *
 * `QueryParams` (`packages/types/src/data.ts`) declares every query option with
 * a leading `$` — `$select`, `$filter`, `$orderby`, `$skip`, `$top`, `$expand`,
 * `$search`, `$searchFields`, `$count` — and `convertQueryParams` in
 * `@object-ui/data-objectstack` builds its outgoing options by copying exactly
 * those. An unprefixed key reaches no branch and is dropped: no throw, no
 * warning. Until objectui#7497 `QueryParams` also carried `[key: string]: any`,
 * so the type system accepted both spellings equally and nothing rejected the
 * dead one; the index signature is gone, so a TYPED literal is now refused by
 * `tsc` as well. This rule keeps its place for the sites `tsc` cannot judge —
 * an `as any` / untyped data source, a JS file, and an `as QueryParams`
 * assertion, which skips excess-property checking — and because it fires at
 * write time with the canonical spelling in the message.
 *
 * The consequence for a dropped cap is an UNBOUNDED read, not a truncated one.
 * The platform's GET list route has no default page size — the pinned
 * `@objectstack/client` serializes `top` only when the caller supplied it
 * (`if (normalizedOptions.top != null)`) — so an absent `top` returns the whole
 * match set. The symptom is therefore invisible until the object is large, and
 * when it appears it reads as a data problem rather than a code problem.
 *
 * Three live sites existed when this rule landed (objectui#5458):
 *
 *  - `app-shell` `ObjectView.tsx` — `find(name, { limit: 0 })` for the footer's
 *    record count. `$top: 0` is honoured end to end as "no records", so the
 *    dropped key did not merely widen the read, it INVERTED the call: "count
 *    only, fetch nothing" became "fetch every row in the object", on every
 *    mount and every refresh of every list view.
 *  - `app-shell` `metadata-admin/AssignedUsersSection.tsx` — `{ $filter: {…},
 *    limit: 1 }`, one line away from three correct calls (`$top: 500`, `$top:
 *    200`, `$top: 1000`). Half-correct spelling in a single object literal is
 *    the shape a reviewer's eye slides over, which is the argument for
 *    mechanising this rather than reviewing it.
 *  - `apps/console` `sdui-workbench-preview.tsx` — `{ top: 200 }`, inside a
 *    template literal holding runtime page metadata. See the boundary note
 *    below: this rule does NOT catch that one, and cannot.
 *
 * A FOURTH site, which the card that commissioned this rule never named, was
 * found by the rule itself on its first repo-wide run: `plugin-dashboard`
 * `DashboardFilterBar.tsx` passed `fields` AND `top` in the same literal, so a
 * dashboard filter's option list read every row and every column of its source
 * object while its own comment described it as capped at 200. That is the
 * argument for the rule in one site: two dropped keys, in one call, under a
 * comment asserting the opposite.
 *
 * ## Scope, deliberately narrow so it discriminates
 *
 * Two independent narrowings, both load-bearing:
 *
 *  1. **Only a KNOWN query-option name.** Not "any unprefixed key". When this
 *     rule landed the index signature was read as room for adapter-specific
 *     params, so flagging every unprefixed key would have reported the shape
 *     the type was written to allow — and a rule that cries wolf gets switched
 *     off. objectui#7497's census then found NO such params anywhere and closed
 *     the type, so on a typed site every unprefixed key is now a `tsc` error;
 *     the closed list still keeps this rule's report meaningful on the untyped
 *     sites only it can see. Every entry maps to a real `QueryParams` key.
 *  2. **Only the second argument of a `find`/`findOne` CALL.** Unlike its
 *     sibling — whose `options`-holding-a-`$`-key signature is unmistakable
 *     anywhere — every name on the list (`top`, `limit`, `filter`, `sort`,
 *     `select`, `count`, …) is a perfectly ordinary object key elsewhere in
 *     this repo. Outside a finder call the name carries no signal at all, so
 *     the call is what makes the report meaningful.
 *
 * `Array.prototype.find` is a `.find(` member call too. It is excluded by its
 * own signature rather than by naming: its first argument is a predicate, so a
 * call whose first argument is a function literal is skipped. The key list is a
 * second, independent filter — an array `find`'s optional second argument is a
 * `thisArg`, which is not an object literal carrying `top`/`limit`.
 *
 * Only STATIC key names report — an identifier or a string literal. A computed
 * key (`{ [k]: v }`) cannot be judged without running the code and a spread
 * (`{ ...params }`) hides its keys, so neither says anything. Same rule as the
 * sibling, same reason: null always means "say nothing".
 *
 * ## Known boundaries, recorded rather than silently omitted
 *
 *  - **Source inside a string is invisible to it.** `sdui-workbench-preview.tsx`
 *    holds its page source in a template literal, which the parser sees as one
 *    `TemplateLiteral` token and never as a `CallExpression`. No AST rule can
 *    reach it. That site was fixed by hand for objectui#5458; a text scan is
 *    the only mechanism that would gate it, and a text scan over this key list
 *    would match the prose in this very file.
 *  - **Only these spellings.** `orderBy` (camelCase) and `pageSize` are the
 *    same mistake in spirit and are deliberately NOT listed: no site has ever
 *    used them here, and the argument for this rule is that it discriminates.
 *    Add one when a real instance appears, with the instance cited — which is
 *    exactly how `fields` got on the list. It is not a `$`-less `$fields` (no
 *    such key exists); it is an alias for `$select`, the same kind of entry as
 *    `limit` -> `$top` and `offset` -> `$skip`, and it earned its place on a
 *    live site: `plugin-dashboard` `DashboardFilterBar.tsx` passed `fields` and
 *    `top` in ONE literal, so the filter-option query fetched every row and
 *    every column of the source object.
 *
 * No autofixer. `limit` and `offset` do not rename to `$limit`/`$offset` — they
 * rename to `$top`/`$skip` — and `filters` collapses to `$filter`, so a fix
 * would have to merge into a key that may already be present in the same
 * literal. More importantly `ObjectView`'s `limit: 0` needed a judgement about
 * what the call MEANT before it could be rewritten; a fixer would have made
 * that silently. objectui#5458.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

/**
 * Unprefixed spellings that are really query options, mapped to the
 * `QueryParams` key each one means. Closed on purpose — see the scope note.
 *
 * EXPORTED for objectui#5944, which needs the canonical (`$`-prefixed) half of
 * this map to mutate a real page source and prove the gate over page-source
 * template literals can go red. `eslint-rules/` is a repo-local plugin
 * directory, not a workspace package — it has no `package.json` and is not in
 * `pnpm-workspace.yaml` — so a named export here widens no published surface.
 * The point of exporting rather than copying: a second list of these spellings
 * would drift from this one silently, and the drift would show up as a gate
 * that quietly stops covering a spelling.
 */
export const QUERY_OPTION_SPELLINGS = {
  top: '$top',
  limit: '$top',
  skip: '$skip',
  offset: '$skip',
  filter: '$filter',
  filters: '$filter',
  select: '$select',
  fields: '$select',
  orderby: '$orderby',
  sort: '$orderby',
  expand: '$expand',
  search: '$search',
  count: '$count',
};

/** Methods whose second argument is a `QueryParams`. */
const FINDER_METHODS = new Set(['find', 'findOne']);

/**
 * Static name of a property key, or null when it cannot be read off the AST
 * (computed keys, spreads). Null always means "say nothing".
 */
function staticKeyName(node) {
  if (node.type === 'SpreadElement' || node.type === 'ExperimentalSpreadProperty') return null;
  if (node.computed) return null;
  const key = node.key;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

/**
 * Static method name of a member call (`a.find`, `a?.find`, `a['find']`), or
 * null for anything whose callee cannot be read off the AST.
 */
function calleeMethodName(callee) {
  if (!callee || callee.type !== 'MemberExpression') return null;
  const property = callee.property;
  if (callee.computed) {
    return property.type === 'Literal' && typeof property.value === 'string'
      ? property.value
      : null;
  }
  return property.type === 'Identifier' ? property.name : null;
}

/**
 * Look through the TypeScript wrappers that do not change the value, so a
 * params literal written `{ limit: 1 } as QueryParams` is still read as the
 * object literal it is. A type assertion skips excess-property checking, so
 * that cast compiles even now that `QueryParams` has no index signature
 * (objectui#7497) — exactly the population this rule exists for; an evasion by
 * `as` would be silent and would look deliberate.
 */
function unwrapExpression(node) {
  let current = node;
  while (
    current
    && (current.type === 'TSAsExpression'
      || current.type === 'TSSatisfiesExpression'
      || current.type === 'TSNonNullExpression'
      || current.type === 'TSTypeAssertion')
  ) {
    current = current.expression;
  }
  return current;
}

/** `arr.find(predicate)` — an array search, not a data read. */
function firstArgumentIsPredicate(node) {
  const first = unwrapExpression(node.arguments[0]);
  if (!first) return false;
  return first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a query option spelled without its `$` in the params of a `find`/`findOne` call — `QueryParams` declares them all `$`-prefixed and `convertQueryParams` copies exactly those, so the unprefixed key is dropped and the query silently runs unbounded (objectui#5458).',
      recommended: true,
    },
    schema: [],
    messages: {
      unprefixedQueryOption:
        '`{{key}}` is not a `QueryParams` key — write `{{canonical}}`. `QueryParams` (@object-ui/types) declares every query option with a leading `$`, and `convertQueryParams` (@object-ui/data-objectstack) copies exactly those keys, so `{{key}}` reaches no branch and is dropped: no throw, no warning. `QueryParams` has no index signature since objectui#7497, so a typed literal is refused by `tsc` too; this rule reaches the sites `tsc` cannot — untyped sources, JS, and `as QueryParams` assertions, which skip excess-property checks. When the dropped key is a cap the read becomes UNBOUNDED rather than truncated — the platform GET list route has no default page size, so the query returns the whole match set and stays invisible until the object is large. See objectui#5458.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!FINDER_METHODS.has(calleeMethodName(node.callee))) return;
        if (firstArgumentIsPredicate(node)) return;

        const params = unwrapExpression(node.arguments[1]);
        if (!params || params.type !== 'ObjectExpression') return;

        for (const property of params.properties) {
          const key = staticKeyName(property);
          if (key === null) continue;
          const canonical = QUERY_OPTION_SPELLINGS[key];
          if (!canonical) continue;

          context.report({
            node: property.key,
            messageId: 'unprefixedQueryOption',
            data: { key, canonical },
          });
        }
      },
    };
  },
};
