/**
 * ObjectUI ESLint rule: no-line-address-in-test-name
 *
 * Bans a source LINE ADDRESS -- `SomeFile.tsx:123` -- from anything that
 * becomes part of a resolved test name.
 *
 * ## The property, and why per-instance repair never closed it
 *
 * A line address inside a test name is read by NOTHING. It is not an
 * assertion, no gate parses it, and the file it points at is never opened. So
 * it cannot fail: it rots the first time a line is inserted above the thing it
 * cites, and the rot stays invisible until a reader believes it. objectui#7853
 * ruled the class -- CITE THE ASSERTION BY CONTENT, NOT BY LINE ADDRESS --
 * and landed as `fa7d66c45`; #6548, #6998, #7289, #7913 and #8045 are the
 * repairs that followed it, one instance at a time, and the class kept
 * recurring. This rule is objectui#8047, the mechanical form of that ruling.
 *
 * ## Why a NAME-AGNOSTIC reading, and not a scan of `it(` lines
 *
 * The instrument matters more than the count here. Measured on `origin/main`
 * at `868e82501`, over the 2454 test files under `packages/`:
 *
 *   - an enumeration anchored on the `it(` LINE finds 6 raw hits in 2 files
 *     -- and one of those 6 is a false positive, a docblock-style sentence
 *     ("...reads and draws it (PageHeader.tsx:123...")  that merely looks like
 *     a test declaration;
 *   - a name-agnostic scan of quoted addresses on non-comment lines finds 45
 *     raw hits in 7 files -- and roughly 30 of those reach a resolved test
 *     name through `it.each($src)` interpolation, from a case table that never
 *     appears on an `it(` line at all.
 *
 * So the `it(`-anchored instrument under-counts the live population by about
 * six-fold AND over-reports at the same time. That is not a sloppy regex; it
 * is the class's defining property turned on its observer -- you cannot grep
 * reliably for a citation that has no fixed syntactic home. A rule that read
 * only `it(` string literals would reproduce the exact blind spot it exists to
 * remove.
 *
 * ## Design question 1 -- resolved names, or strings that REACH a name
 *
 * Two designs answer the interpolation problem. The rejected one is to judge
 * genuinely RESOLVED names by collecting them with the runtime
 * (`vitest list --json`). It is disqualified twice over:
 *
 *   - in PRINCIPLE, collection EXECUTES every test module's top level, so a
 *     syntax-only citation check would acquire the power to fail on an
 *     unrelated runtime error, a missing DOM global or a slow transform. A
 *     check on the text of a name must not depend on the suite booting.
 *   - in COST, measured in this container: `vitest list --json` over ONE
 *     `plugin-charts` file took 11.9s, and over ONE `app-shell` `dom` file it
 *     had still emitted nothing after NINE MINUTES. There are 2454 test files.
 *
 * So this rule takes the other design: reject the address in any string that
 * REACHES a test title, decided on the AST rather than on the `it(` line. The
 * three legs are `Leg 1/2/3` below, and leg 3 exists so that "the rule could
 * not tell" is never spelled the same way as "there is nothing here".
 *
 * ## Design question 2 -- where a line address is LEGITIMATE
 *
 * The population deliberately does NOT sprawl to every string in a test file.
 * Three carve-outs, each with an instance measured in this tree today:
 *
 *   1. COMMENTS. A human reads them beside the code they annotate, and the
 *      next reader of that code corrects a wrong one. This rule never reads a
 *      comment: ESLint hands rules an AST, and nothing here inspects
 *      `sourceCode.getAllComments()`.
 *   2. ASSERTION AND FAILURE MESSAGES. A human reads these AT THE POINT OF
 *      FAILURE, where the assertion that actually failed is the context. In
 *      tree: `readme-app-shell-example.test.ts:231` and `:255`,
 *      `guide-layout-sidebar-nav-doc.test.ts:490`, and the four `producer:`
 *      fields in `gridNonAuthorKeys.test.tsx` that its line 229 splices into a
 *      failure message. Not a title argument, not a case-table string, so not
 *      reported.
 *   3. DATA THE TEST ASSERTS ON. `page-header-authorable-keys.test.tsx`'s
 *      `RENDERER_OWN_DECLARED` rationale carries an address and IS read --
 *      line 227 asserts on that very string. Something checks it, so it is not
 *      the unreadable class.
 *
 * The boundary is worth stating as a number, measured on `868e82501`: a rule
 * over EVERY string in a test file reports 45 hits in 7 files; this rule
 * reports 37 in 3. The 8 it drops are the carve-outs above, and dropping them
 * is the point -- the remedy for a reported failure message is deleting useful
 * provenance a human reads.
 *
 * The carve-out is drawn on the TITLE'S OWN REACH, not on a keyword list. For
 * `it.each(ROWS)('the spec refuses $key ...')` only the `key` field of each
 * row can arrive in the name, so a sibling `producer:` field carrying an
 * address is data and is not reported -- that is `gridNonAuthorKeys.test.tsx`,
 * four hits, and it is why leg 2 reads the title's `$path` set rather than the
 * whole row. A POSITIONAL title (`%s`, `$0`) or a template title cannot say
 * which field arrives, so those read the whole row: over-reporting is the safe
 * direction here, silence is not.
 *
 * ## The residual gap, stated rather than papered over
 *
 * Leg 3 fires only for a NAMED title (`$src`) over a table the rule cannot
 * resolve, because a named title is what says the rows are objects carrying
 * fields -- the shape every recorded instance of this class has had. A
 * POSITIONAL title over an opaque table (`it.each(covered)('%s declares ...')`
 * in `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`, the one
 * in-tree instance) is therefore NOT covered. Reporting it would mean scanning
 * that whole file and reporting a rationale record the test asserts on --
 * carve-out 3, a false positive -- and the remedy offered would be to hoist a
 * table computed from the live component registry, which cannot be hoisted.
 * The gap is one site today; it is written here so the next reader does not
 * mistake this rule's silence there for coverage.
 *
 * One shape is deliberately NOT reported, and it is the boundary's mirror: an
 * address whose line number is COMPUTED from a live read of the cited file
 * (`` `...layout.md:${fence.line}...` ``, real code in
 * `guide-layout-sidebar-nav-doc.test.ts`) cannot rot -- it is derived, not
 * cited. It is pinned as a valid case in this rule's tests.
 *
 * ## No autofixer, on purpose
 *
 * The repair at most sites is a DELETION -- the symbol or heading text is
 * already in the name -- but not at all of them: where the address is the
 * case's only identity (`it.each(CORPUS)('adopts $src ...')`) removing it
 * merges names, and choosing the replacement identity is an authoring decision.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

/**
 * File extensions that make `NAME.ext:NNN` a SOURCE ADDRESS rather than a
 * coincidence. The list is explicit so the two known-negative shapes stay
 * negative for a structural reason and not by luck: a version number (`1.2.3`)
 * has no `:`, and a clock time (`12:30`) has no extension. A host:port
 * (`http://example.com:3000`) is excluded the same way -- `com` is not here.
 */
const SOURCE_EXT = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'md', 'mdx', 'yml', 'yaml',
  'css', 'scss', 'html', 'vue', 'svelte', 'snap', 'sh', 'py', 'toml',
];

/**
 * `NAME.ext:NNN`. The name part may carry directories (`views/ObjectView.tsx`)
 * and scope characters, and must end in a word character so a trailing dot
 * cannot start it. A leading boundary keeps `foo.mjs:12` from matching inside
 * `barfoo.mjs:12`'s tail only -- the whole run is taken either way.
 */
const ADDRESS = new RegExp(
  String.raw`[A-Za-z0-9_@$./-]*[A-Za-z0-9_$-]\.(?:${SOURCE_EXT.join('|')}):\d+`,
);

/**
 * `$prop` / `$prop.nested` -- vitest splices the NAMED property of the case
 * object into the title. `$#` is excluded on purpose: it is the case INDEX, so
 * it carries no case string into the name.
 */
const NAMED_SUBSTITUTION = /\$([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;

/**
 * Substitutions that splice case data POSITIONALLY, so the rule cannot say
 * which field arrives: printf placeholders (`%s`, `%d`, ...) and `$0`-style
 * tuple positions. `%%` is an escaped percent and carries nothing.
 */
const POSITIONAL_SUBSTITUTION = /%(?!%)[sdifjoO#]|\$\d/;

/** Vitest/Jest declaration roots whose first argument names a test or a suite. */
const DECLARATIONS = new Set(['it', 'test', 'describe', 'bench', 'suite']);

/** Modifier chain allowed between the root and the call: `it.skip.each(...)`. */
const MODIFIERS = new Set([
  'each', 'for', 'skip', 'only', 'todo', 'fails', 'concurrent', 'sequential',
  'runIf', 'skipIf', 'extend', 'scoped', 'shuffle',
]);

/** Array methods that return a subset/reshuffle, so the receiver over-approximates. */
const ARRAY_DERIVATIONS = new Set([
  'filter', 'map', 'slice', 'concat', 'flat', 'flatMap', 'reverse',
  'toSorted', 'toReversed', 'sort', 'entries', 'values',
]);

/**
 * Walks `it.skip.each` down to its root identifier, reporting the modifiers
 * seen on the way. Returns null for anything that is not a declaration call --
 * `foo.describe()` is somebody else's API.
 */
function classifyCallee(callee) {
  const modifiers = [];
  let node = callee;
  while (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    modifiers.unshift(node.property.name);
    node = node.object;
  }
  if (node.type !== 'Identifier' || !DECLARATIONS.has(node.name)) return null;
  if (!modifiers.every((m) => MODIFIERS.has(m))) return null;
  return { root: node.name, isEach: modifiers.includes('each') || modifiers.includes('for') };
}

/** Every string this node contributes to a title, with the node to report on. */
function titleStrings(node) {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [{ text: node.value, node }];
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => ({ text: q.value.cooked ?? q.value.raw, node: q }));
  return [];
}

/**
 * How a title takes case data, which decides WHICH strings of a row can reach
 * the name -- the difference between reporting a row's provenance field and
 * reporting only the field the title actually names.
 *
 *   { kind: 'none' }      nothing from the row reaches the title.
 *   { kind: 'named', paths } only these property paths reach it.
 *   { kind: 'opaque' }    positional or computed -- any string in the row may.
 */
function titleSubstitution(node) {
  // A template title splices an arbitrary expression: nothing static to name.
  if (node && node.type === 'TemplateLiteral' && node.expressions.length > 0) return { kind: 'opaque' };
  const chunks = titleStrings(node);
  if (chunks.some((c) => POSITIONAL_SUBSTITUTION.test(c.text))) return { kind: 'opaque' };
  const paths = new Set();
  for (const chunk of chunks) {
    NAMED_SUBSTITUTION.lastIndex = 0;
    let m;
    while ((m = NAMED_SUBSTITUTION.exec(chunk.text)) !== null) paths.add(m[1]);
  }
  return paths.size ? { kind: 'named', paths } : { kind: 'none' };
}

/**
 * The strings a row contributes to the title. For a NAMED title only the named
 * property paths are read -- a sibling field the title never mentions is data,
 * not a name, and this is where the `producer:` fields of
 * `gridNonAuthorKeys.test.tsx` stop being reported. Anything the walk cannot
 * follow (a row that is not an object literal, a path that dead-ends in a
 * computed key) falls back to the whole row, so the miss direction stays loud.
 */
function rowStringsForNamedPaths(row, paths) {
  if (!row || row.type !== 'ObjectExpression') return collectStrings(row);
  const out = [];
  for (const path of paths) {
    let node = row;
    for (const segment of path.split('.')) {
      if (!node || node.type !== 'ObjectExpression') { node = undefined; break; }
      const prop = node.properties.find(
        (pr) => pr.type === 'Property' && !pr.computed
          && ((pr.key.type === 'Identifier' && pr.key.name === segment)
            || (pr.key.type === 'Literal' && String(pr.key.value) === segment)),
      );
      node = prop ? prop.value : undefined;
    }
    if (node) out.push(...collectStrings(node));
  }
  return out;
}

/**
 * Resolves an `each` case table to the array literal whose strings can reach
 * the title. Deliberately OVER-approximates: `CORPUS.filter(fn)` resolves to
 * all of `CORPUS`, because a filter can only drop rows, and over-reporting a
 * row that will not run is loud while under-reporting is silent. Returns null
 * when nothing static is reachable -- leg 3 then takes over, and the caller
 * must not read null as "no addresses here".
 */
function resolveTable(node, scope) {
  if (!node) return null;
  if (node.type === 'ArrayExpression') return node;
  if (node.type === 'TemplateLiteral') return node;
  if (node.type === 'Identifier') {
    let s = scope;
    while (s) {
      const variable = s.variables.find((v) => v.name === node.name);
      if (variable) {
        const defs = variable.defs.filter((d) => d.node && d.node.type === 'VariableDeclarator' && d.node.init);
        if (defs.length !== 1) return null;
        return resolveTable(defs[0].node.init, s);
      }
      s = s.upper;
    }
    return null;
  }
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    return resolveTable(node.expression, scope);
  }
  if (
    node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.property.type === 'Identifier'
    && ARRAY_DERIVATIONS.has(node.callee.property.name)
  ) {
    return resolveTable(node.callee.object, scope);
  }
  return null;
}

/** Every string literal / template chunk anywhere under `node`. */
function collectStrings(node, out = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out, seen);
    return out;
  }
  if (typeof node.type !== 'string') return out;
  if (node.type === 'Literal' && typeof node.value === 'string') out.push({ text: node.value, node });
  else if (node.type === 'TemplateElement') out.push({ text: node.value.cooked ?? node.value.raw, node });
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    collectStrings(node[key], out, seen);
  }
  return out;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban a source line address (`File.tsx:123`) from anything that becomes part of a test name — nothing reads it, so it cannot fail, and it rots on the next insertion above the line it cites (objectui#7853, objectui#8047).',
    },
    schema: [],
    messages: {
      inTitle:
        'Test name cites `{{address}}` by LINE ADDRESS. Nothing reads a test name, so this citation cannot fail and rots on the next insertion above that line. Cite the assertion by CONTENT — the symbol, heading or text — per objectui#7853.',
      inEachCase:
        'This `each` case table carries the line address `{{address}}`, and the title interpolates case data, so the address reaches the test name. Nothing reads a test name, so it cannot fail and rots silently (objectui#7853). Cite the case by CONTENT.',
      inUnresolvedTable:
        'This `each` title interpolates case data from a table this rule cannot read statically, and `{{address}}` appears as a string in this file — so it may reach a test name unchecked. Hoist the cases to a `const` array literal so the citation check can see them, or cite by CONTENT instead of by line address (objectui#7853).',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    // Two `each` sites may share one case table (`CORPUS` and
    // `CORPUS.filter(...)` in this tree), so the same string is reached twice.
    // One report per (position, address) keeps the count a count of DEFECTS.
    const alreadyReported = new Set();

    /** Reports the FIRST address in `text`, if any, at `node`. */
    const reportAddress = (messageId, text, node) => {
      const m = ADDRESS.exec(text);
      if (!m) return false;
      const key = `${node.range[0]}:${node.range[1]}:${m[0]}`;
      if (alreadyReported.has(key)) return true;
      alreadyReported.add(key);
      context.report({ node, messageId, data: { address: m[0] } });
      return true;
    };

    return {
      CallExpression(node) {
        // `it('name', fn)` puts the declaration on `node.callee`; the `each`
        // forms wrap it -- `it.each(TABLE)('name', fn)` is a call whose callee
        // is itself a call, and `it.each\`…\`('name', fn)` a tagged template.
        const outer = node.callee;
        const decl = outer.type === 'CallExpression' ? outer.callee
          : outer.type === 'TaggedTemplateExpression' ? outer.tag
            : outer;
        const kind = classifyCallee(decl);
        if (!kind) return;

        // Leg 1 — the title argument itself. For an `each` form the title is
        // still argument 0 of the returned call, so this is the same read.
        const title = node.arguments[0];
        let reported = false;
        for (const chunk of titleStrings(title)) {
          if (reportAddress('inTitle', chunk.text, chunk.node)) reported = true;
        }
        if (!kind.isEach || reported) return;

        // Legs 2 and 3 apply only when case data is actually spliced in. A
        // fixed title cannot carry a row's string no matter what the table
        // holds, and `$#` splices only the index.
        const substitution = titleSubstitution(title);
        if (substitution.kind === 'none') return;

        const tableArg = outer.type === 'CallExpression' ? outer.arguments[0]
          : outer.type === 'TaggedTemplateExpression' ? outer.quasi
            : undefined;
        if (tableArg === undefined) return;
        const scope = sourceCode.getScope ? sourceCode.getScope(node) : context.getScope();
        const table = resolveTable(tableArg, scope);

        if (table) {
          // Leg 2 — the resolved table, read through the title's own reach.
          const rows = table.type === 'ArrayExpression' ? table.elements.filter(Boolean) : [table];
          for (const row of rows) {
            const chunks = substitution.kind === 'named'
              ? rowStringsForNamedPaths(row, substitution.paths)
              : collectStrings(row);
            for (const chunk of chunks) reportAddress('inEachCase', chunk.text, chunk.node);
          }
          return;
        }

        // Leg 3 — the table is not statically legible. Silence here would be
        // indistinguishable from "clean", which is the exact failure this rule
        // exists to stop, so fall back to the whole file and say so. Confined
        // to NAMED titles: `$src` says the rows are objects carrying fields, the
        // shape every recorded instance of this class has had. The residual gap
        // — a POSITIONAL title over an opaque table — is stated in the header
        // rather than papered over.
        if (substitution.kind !== 'named') return;
        for (const chunk of collectStrings(sourceCode.ast)) {
          reportAddress('inUnresolvedTable', chunk.text, tableArg);
        }
      },
    };
  },
};

export default rule;
