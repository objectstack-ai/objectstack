/**
 * ObjectUI ESLint rule: no-unused-imports
 *
 * Errors on an unused IMPORT binding, and on nothing else.
 *
 * ## Why this exists (objectui#4806 R2, filed as #6467)
 *
 * `@typescript-eslint/no-unused-vars` watches one population with one
 * severity, and this repo needs two severities over two subsets of it. The
 * measurement on #4806 is what forces the split: of 822 findings, 613 (74.6%)
 * sat on names the author had already marked `_` — deliberate declarations,
 * closed by the ignore patterns in `eslint.config.js` — and of the 209 left,
 * the genuinely-unjustified subclass was the unused IMPORT: 108 sites when
 * re-measured for #6467 (114 ten days earlier). An unused import has no
 * legitimate construct behind it the way an unused BINDING does — no
 * type-level assertion (`type _NotAny = Assert< … >`), no deliberate-omit
 * destructuring, no positional parameter that must exist to reach the next
 * one. It is dead weight in the module graph every time, so it can be an
 * error while the rest of the rule stays a warning.
 *
 * ## Why it delegates instead of re-implementing
 *
 * The whole rule body is `@typescript-eslint/no-unused-vars`, run unmodified,
 * with its reports filtered down to import bindings. Nothing here decides what
 * "unused" means. That matters more than the line count it saves: the two
 * halves of the split are configured from the same options object in
 * `eslint.config.js`, and they run the same analysis, so they cannot drift
 * apart into two different opinions of the same word — which is exactly the
 * failure mode a hand-written second analyser would have. Type-only usage,
 * declaration merging, `export { x }` re-exports, the JSX pragma and the
 * ignore patterns are all handled once, upstream.
 *
 * The alternative considered was `eslint-plugin-unused-imports` (v4.4.1, peer
 * ranges `eslint ^10 || ^9 || ^8` and `@typescript-eslint/eslint-plugin ^8`,
 * so it would have installed cleanly here). It works the same way — wrap and
 * filter — but its intended shape is to also REPLACE the base rule with its
 * own vendored fork of `no-unused-vars` (`unused-imports/no-unused-vars`) to
 * avoid double-reporting. That fork tracks typescript-eslint's rule on its own
 * schedule, which is a far bigger change to this repo's lint semantics than
 * the gate this card charters, and it is the one dependency this repo would
 * take on purely to avoid the thirty lines below. Eight sibling ratchets
 * already live in this directory; this is a ninth.
 *
 * ## Double reporting is expected, and is the chartered shape
 *
 * An unused import is reported TWICE: once as a warning by
 * `@typescript-eslint/no-unused-vars` (which cannot be told to skip imports —
 * its options can narrow by NAME and by declaration KIND, never by "came from
 * an import") and once as an error here. `.github/workflows/lint.yml` sets no
 * `--max-warnings`, so the warning half is inert in CI and only the error
 * fails a build. Silencing the warning half would mean replacing the base rule
 * outright, which #6467's charter explicitly does not do: unused locals,
 * parameters and caught errors stay at exactly the severity they had.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
import tseslint from 'typescript-eslint';

const baseRule = tseslint.plugin.rules['no-unused-vars'];

/**
 * The three ways a module binding enters a scope. A `require()` result is a
 * variable, not an import, and stays with the warning half.
 */
const IMPORT_SPECIFIERS = new Set([
  'ImportSpecifier',
  'ImportDefaultSpecifier',
  'ImportNamespaceSpecifier',
]);

/**
 * True when the reported node is the LOCAL name an import declaration binds.
 *
 * `parent.local === node` rather than a bare parent-type test: in
 * `import { a as b }` the specifier holds two identifiers, and only `b` is the
 * binding this repo can act on — `a` is the exported name in the other module.
 */
function isImportBinding(node) {
  return (
    node != null &&
    node.type === 'Identifier' &&
    node.parent != null &&
    IMPORT_SPECIFIERS.has(node.parent.type) &&
    node.parent.local === node
  );
}

export default {
  meta: {
    ...baseRule.meta,
    docs: {
      ...baseRule.meta.docs,
      description: 'Disallow unused imports (the import subclass of no-unused-vars)',
    },
  },
  defaultOptions: baseRule.defaultOptions,
  create(context) {
    // Prototype-delegating rather than a copy: the base rule reads
    // `sourceCode`, `options`, `filename` and friends off the context, and a
    // hand-copied subset would silently drop whatever a future version starts
    // reading. Only `report` is shadowed.
    const importsOnly = Object.create(context, {
      report: {
        value: (descriptor) => {
          if (isImportBinding(descriptor.node)) context.report(descriptor);
        },
        writable: true,
        enumerable: true,
        configurable: true,
      },
    });
    return baseRule.create(importsOnly);
  },
};
