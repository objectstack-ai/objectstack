/**
 * ObjectUI ESLint rule: no-query-params-under-options
 *
 * Bans `$`-prefixed query keys nested under an `options` key —
 * `find(obj, { options: { $top: 100 } })` instead of `find(obj, { $top: 100 })`.
 *
 * `QueryParams` (`packages/types/src/data.ts`) declares `$top`/`$skip`/
 * `$filter`/`$orderby`/`$select`/`$expand`/`$search` at the TOP level, and
 * `options` is not one of its keys. No adapter in this repo reads
 * `params.options` — `convertQueryParams` in `@object-ui/data-objectstack` and
 * `ApiDataSource` both read `params.$top` — so a cap written under `options`
 * never reaches the wire and the query silently runs unbounded.
 *
 * When this rule landed nothing else caught it: `QueryParams` carried
 * `[key: string]: any`, read as room for adapter-specific params, so the type
 * system accepted both spellings equally — `{ options: { $top: 100 } }`
 * type-checked exactly as well as `{ $top: 100 }`, and the two mean completely
 * different things (the first means nothing at all). objectui#7497 closed the
 * type, so a typed literal is now a `tsc` error too; this rule still reaches
 * untyped sources, JS, and `as QueryParams` assertions, and fires at write time.
 *
 * Two live instances existed, written by different people at different times:
 *
 *  - `object-timeline` — the whole fetch was
 *    `find(objectName, { options: { $top: 100 } })` (fixed in objectui#4009 /
 *    objectstack#7137).
 *  - `object-kanban` — `$filter` at the top level, the cap under `options`, so
 *    a board over a large object fetched every row the server would return for
 *    as long as the block existed (fixed for objectui#4025).
 *
 * That is the reason this is mechanical rather than a review item: the shape
 * reads as a deliberate grouping ("query options"), it type-checks, it
 * publishes, and the symptom (too many rows) looks like a data problem rather
 * than a code problem — so a review catches it once and then misses the next
 * one. Error level, at write time: the editor squiggle interrupts at the moment
 * the grouping is typed, which is where both authors made the mistake.
 * objectui#4734.
 *
 * Scope, deliberately narrow so it discriminates rather than blanket-matches
 * (measured on the repo at the time of writing: 47 object literals carry an
 * `options` object property, and NOT ONE of them holds a `$`-prefixed key —
 * `options: { data }`, `options: { kanban, calendar }`, `options: { sortBy,
 * limit }` and so on are all normal and must stay silent):
 *
 *  - Only a `$`-prefixed key makes it a hit. `options` on its own is a
 *    perfectly good key in this repo and always will be.
 *  - Only STATIC key names — an identifier or a string literal. A computed key
 *    (`{ [k]: v }`) cannot be judged without running the code, and a spread
 *    (`{ ...params }`) hides its keys, so neither reports.
 *  - Only an object-literal `options` property whose initializer is itself an
 *    object literal. Prose gets this for free: every remaining textual match in
 *    the repo is a comment or a test header describing the history, and an AST
 *    rule never sees those.
 *
 * A known and deliberate boundary: the rule does not look at what the object
 * is passed to, so a data field literally named `options` filtered with a
 * Mongo-style operator (`$filter: { options: { $in: [...] } }`) would report.
 * No such site exists in the repo — the census above found none — so the rule
 * is not narrowed for it. If one ever appears, the narrowing that fits is
 * "skip when the `options` property sits inside a `$`-prefixed property's
 * value", which loses nothing real: nobody writes the dead spelling inside a
 * filter.
 *
 * No autofixer on purpose. Hoisting the keys means merging them into the
 * enclosing object, which can collide with a key already there (kanban had a
 * top-level `$filter` beside the dead `options`), and dropping the now-empty
 * wrapper is only safe when it held nothing else. Both are judgement calls.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

/** The key whose object value is dead weight on a `QueryParams`. */
const DEAD_KEY = 'options';

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

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `$`-prefixed query keys nested under an `options` key — `QueryParams` declares them at the top level and no adapter reads `params.options`, so the value never reaches the wire (objectui#4734).',
      recommended: true,
    },
    schema: [],
    messages: {
      deadOptionsKey:
        '{{keys}} {{verb}} nested under `options`, where nothing reads {{them}}. `options` is not a `QueryParams` key and no data adapter in this repo reads `params.options`, so a cap or filter written there never reaches the wire — the query silently runs unbounded, which reads as a data problem rather than a code problem. `QueryParams` (@object-ui/types) declares these keys at the TOP level of the params object: write `find(obj, { $top: 100 })`, not `find(obj, { options: { $top: 100 } })`. Two blocks lost their row caps to exactly this spelling (objectui#4009, objectui#4025); see objectui#4734.',
    },
  },
  create(context) {
    return {
      Property(node) {
        if (staticKeyName(node) !== DEAD_KEY) return;
        if (node.value.type !== 'ObjectExpression') return;

        const dead = node.value.properties
          .map((prop) => staticKeyName(prop))
          .filter((name) => name !== null && name.startsWith('$'));
        if (dead.length === 0) return;

        context.report({
          node: node.key,
          messageId: 'deadOptionsKey',
          data: {
            keys: dead.map((name) => `\`${name}\``).join(', '),
            verb: dead.length === 1 ? 'is' : 'are',
            them: dead.length === 1 ? 'it' : 'them',
          },
        });
      },
    };
  },
};
