#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-widget-option-census -- `CONSUMED_WIDGET_OPTION_KEYS` is DERIVED from
 * the spec, not pinned against itself.
 *
 *   node scripts/check-widget-option-census.mjs              # the comparison
 *   node scripts/check-widget-option-census.mjs --list       # both sides, printed
 *   node scripts/check-widget-option-census.mjs --self-test  # verify the reader
 *
 * ## The defect this closes (#12926, filed out of the #12810 port)
 *
 * `checkDashboardWidgetOptions` in `@objectstack/sdui-parser` warns on any
 * dashboard widget `options` key outside `CONSUMED_WIDGET_OPTION_KEYS`. Five of
 * that array's six members are exactly the properties
 * `DashboardWidgetOptionsSchema` declares in `packages/spec/src/ui/dashboard.zod.ts`
 * -- and the array is a LITERAL PIN. objectui re-derives its copy every test
 * run; this copy is asserted equal to six expected strings, which pins the
 * parser against ITSELF. Adding a key to the schema does not fail that test:
 * it stays green and becomes wrong.
 *
 * The failure is ONE-DIRECTIONAL, and that is what makes it worth a gate. The
 * spec ships from THIS repo, so a declared key can land here without anyone
 * touching the parser. That key is then spec-legal, consumed by the objectui
 * renderer, and WARNED ABOUT here: a false positive on legal metadata, which is
 * the shape that gets a diagnostic deleted by the next person who hits it.
 *
 * The reverse direction is not a defect: `description` is genuinely undeclared
 * in the schema and genuinely written into `options` by `translateDashboard`.
 * So this gate asserts an ASYMMETRY, never an equality -- see NON_DECLARED_MEMBERS.
 *
 * ## Why a gate script rather than a test in the package
 *
 * `@objectstack/sdui-parser` takes no dependency on `@objectstack/spec`: it is
 * dependency-free and hoistable by design (`dependencies` and
 * `peerDependencies` are absent from its manifest; `devDependencies` is
 * `typescript` and `vitest`). Deriving in-package means taking the spec as a
 * test input, which pulls the package into `check:cross-package-test-inputs` (a
 * `turbo.json` `inputs` declaration) and into `check:test-source-alias` (a
 * vitest alias or a `KNOWN_UNALIASED_TEST_IMPORTS` registration). That is a
 * design decision about the package's purity and is deliberately NOT taken
 * here. A cross-package claim read by source text is where this repo already
 * keeps cross-package claims.
 *
 * ## Reading a zod shape by source text -- the four readers that cannot
 *
 * The hard half is "which keys does `DashboardWidgetOptionsSchema` DECLARE",
 * answered over source text with no zod, no TypeScript and no build. Four
 * cheaper readers were measured against this tree's real file plus six
 * mutations before the one below was written. Each cheaper reader is wrong in
 * a way a clean tree cannot show you:
 *
 *   mutation \ reader              raw+anchored  raw+loose  masked+anchored  masked+loose  THIS
 *   prose mention in a docblock         ok        FABRICATES      ok             ok         ok
 *   property commented OUT (block)   FABRICATES   FABRICATES      ok             ok         ok
 *   property commented OUT (line)       ok        FABRICATES      ok             ok         ok
 *   key-shaped text in .describe()      ok        FABRICATES      ok         FABRICATES     ok
 *   a nested inline z.object({})     2 of 6 keys  2 of 6 keys  2 of 6 keys   2 of 6 keys    ok
 *   a genuinely new declared key        ok            ok           ok             ok        ok
 *
 * The doc-comment row is the one the card was filed with: `dateGranularity`
 * appears inside docblocks at two places in that file, so a loose reader counts
 * prose as a declaration. The row that decides the design is the LAST failing
 * one. A nested `z.object({...})` inside a property value truncates every
 * reader whose scope ends at the first `})`, and truncation is the direction
 * that fails GREEN here: this gate's claim is "every declared key is consumed",
 * so a reader that sees 2 of 6 keys asserts less and passes. That is the same
 * silent-pass shape the card exists to end, re-manufactured inside its fix.
 *
 * So the reader below is depth-aware over a mask that blanks comment spans AND
 * string/template/regex CONTENT, from the repo's one comment scanner
 * (`scripts/js-comment-mask.mjs`). Where it cannot see -- a spread inside the
 * shape, an `.extend()`/`.merge()` on the declaration -- it REFUSES rather than
 * under-reports.
 *
 * ## Why this file re-implements a depth walk instead of importing one
 *
 * `scripts/check-stack-collection-maps.mjs` exports `sliceBody`/`objectEntries`,
 * which answer this question correctly (they were the fifth reader measured,
 * and they score `ok` on all six rows above). They are not imported here, and
 * the reason is mechanical rather than aesthetic: `scripts/pm/dispatch-gates.mjs`
 * gives a gate the module-body path literals of everything it imports as its
 * OWN watch hints. Measured on this tree:
 *
 *   scripts/js-comment-mask.mjs             inheritable literals: 0
 *   scripts/invoked-as.mjs                  inheritable literals: 0
 *   scripts/check-stack-collection-maps.mjs inheritable literals: 8
 *
 * Importing it would make this gate claim `packages/objectql/src/engine.ts`,
 * `packages/runtime/src/app-plugin.ts`, `examples/app-showcase/src/coverage.ts`
 * and five more as its population -- a fabricated watch hint on eight files it
 * never opens, named to every dispatch that touches them. The three files this
 * gate reads are spelled below as literals, and they are the whole population.
 *
 * ## Zero is a refusal, never a pass
 *
 * Every read here can come back empty for a reason that has nothing to do with
 * the tree being correct: a renamed schema, a moved file, a shape this reader
 * cannot walk. "No declared key is missing from the consumed set" is vacuously
 * TRUE over zero declared keys, so an empty read would print the healthiest
 * green this gate can print. Each reader therefore returns `null` on failure
 * and the caller turns that into a non-zero exit naming what could not be read.
 *
 * ## What this gate does NOT claim
 *
 * The objectui half. `CONSUMED_WIDGET_OPTION_KEYS` is a census of RENDERER READ
 * SITES, and this repo ships no dashboard renderer -- objectui's own census
 * test owns that side against `DatasetWidget.tsx`. This gate holds the half
 * that is measurable from here: every key the SPEC declares is in the array.
 * The port's pin test (`packages/sdui-parser/src/__tests__/dashboard-widget-options.test.ts`)
 * stays exactly as it is; it pins the emitted diagnostic and the array's shape,
 * which is a different claim from this one and still the only witness for it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** Where the five DECLARED keys live -- the spec, which ships from this repo. */
const SPEC_FILE = 'packages/spec/src/ui/dashboard.zod.ts';

/** Where the pinned census lives -- the dependency-free parser. */
const PARSER_FILE = 'packages/sdui-parser/src/dashboard-widget-options.ts';

/** The zod schema whose declared properties are the derived half. */
const SCHEMA_NAME = 'DashboardWidgetOptionsSchema';

/** The parser's census array. */
const CENSUS_NAME = 'CONSUMED_WIDGET_OPTION_KEYS';

/**
 * The members of the census that are legitimately NOT declared by the schema,
 * each with the site that makes it legitimate.
 *
 * This is the one thing here that cannot be derived from the schema, and it is
 * a LEDGER rather than a hard-coded skip so that a SECOND undeclared key cannot
 * arrive silently: a census member that is neither declared nor listed here is
 * a finding, and a row here is checked from both ends -- its key must still be
 * in the census, must still be absent from the schema, and its witness must
 * still be present in code (not prose) in the file named.
 *
 * ⛔ Do not "align the two sides" by deleting `description` from the census.
 * It is a real read site in this repo, and removing it would make
 * `translateDashboard`'s own output warn.
 */
const NON_DECLARED_MEMBERS = [
  {
    key: 'description',
    evidence: 'packages/spec/src/system/i18n-resolver.ts',
    witness: 'description: subCaption',
    why:
      'the metric sub-caption channel: `translateDashboard` writes the resolved '
      + '`subCaption` into the widget\'s `options.description`, documented on '
      + '`WidgetLike.options`. Undeclared in the schema on purpose -- it is a '
      + 'RESOLVER output, not an authorable query key.',
  },
];

// ── Source reading ──────────────────────────────────────────────────────────

/**
 * `source` with comment spans AND string/template/regex CONTENT blanked, same
 * length, newlines kept -- so an offset into the result indexes the original.
 *
 * Both halves are load-bearing and they close different holes. Blanking
 * comments is what stops a docblock's `` `dateGranularity` `` and a
 * commented-out property from reading as declarations. Blanking literal
 * CONTENT is what stops `.describe('fakeInString: order by this')` from
 * reading as one, and -- the part that is not about keys at all -- what keeps a
 * brace inside a string out of the bracket counter.
 *
 * Delimiters survive (the scanner flags literal content, not its quotes), so a
 * quoted object key and an array of string literals are both still locatable.
 */
export function structureMask(source) {
  const flags = scanSource(source);
  return blank(blank(source, flags.comment), flags.literal);
}

/**
 * The offset just past `export const <name>` in `mask`, or -1.
 *
 * Anchored on the DECLARATION, not on the identifier: both names below are
 * spelled again at their use sites, and a scan that started from the first
 * occurrence would read a different construct entirely.
 */
function declarationAt(mask, name) {
  const m = new RegExp(`\\bexport\\s+const\\s+${name}\\b`).exec(mask);
  return m ? m.index + m[0].length : -1;
}

/** The offset of the single `=` that opens a declaration's initialiser, or -1. */
function initialiserAt(mask, from) {
  for (let i = from; i < mask.length; i++) {
    if (mask[i] !== '=') continue;
    if (mask[i + 1] === '=' || mask[i + 1] === '>') continue;
    if ('=!<>+-*/%&|^'.includes(mask[i - 1])) continue;
    return i;
  }
  return -1;
}

/**
 * The contents of the balanced bracket that opens at `openAt`, as `[start,end)`
 * offsets into the source, or `null` when it never closes.
 */
function balancedSpan(mask, openAt) {
  const open = mask[openAt];
  const close = open === '{' ? '}' : open === '[' ? ']' : ')';
  let depth = 0;
  for (let i = openAt; i < mask.length; i++) {
    if (mask[i] === open) depth += 1;
    else if (mask[i] === close) {
      depth -= 1;
      if (depth === 0) return { start: openAt + 1, end: i };
    }
  }
  return null;
}

/** Structural depth of `mask[i]` relative to `from`, counting all three pairs. */
function walkDepth(mask, from, to, visit) {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const ch = mask[i];
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue; }
    if (depth === 0) visit(i);
  }
}

/**
 * The property names an object-literal body declares at its own top level.
 *
 * Returns `null` when the body carries a shape this reader cannot see through
 * -- today that is a spread. A spread's keys come from elsewhere, so counting
 * only the visible ones would UNDER-report, and under-reporting is the
 * direction this gate fails green in.
 */
export function topLevelKeys(source, span) {
  const mask = structureMask(source);
  const keys = [];
  let unreadable = null;
  let skipTo = -1;

  walkDepth(mask, span.start, span.end, (i) => {
    if (i < skipTo) return;
    if (mask[i] === '.' && mask.slice(i, i + 3) === '...') {
      unreadable = 'a spread (`...`) at the top level of the shape';
      return;
    }
    // A key STARTS a member, so it is preceded by the opening brace, a comma,
    // or whitespace (a blanked docblock is whitespace). Anything else — a `.`
    // above all — is the middle of an expression in the previous member's value.
    const before = mask[i - 1];
    if (!(i === span.start || before === ',' || before === '{' || /\s/.test(before))) return;

    if (mask[i] === "'" || mask[i] === '"') {
      const quoted = /^(['"])([A-Za-z_$][\w$]*)\1\s*:/.exec(source.slice(i, i + 120));
      const close = mask.indexOf(mask[i], i + 1);
      skipTo = close === -1 ? span.end : close + 1;
      if (quoted) keys.push(quoted[2]);
      return;
    }
    const bare = /^([A-Za-z_$][\w$]*)\s*:/.exec(mask.slice(i, i + 120));
    if (bare) keys.push(bare[1]);
  });

  if (unreadable) return { keys: null, unreadable };
  return { keys: [...new Set(keys)], unreadable: null };
}

/**
 * The keys `SCHEMA_NAME` declares, or `{ keys: null, why }` when the shape
 * cannot be read. Never an empty array on success.
 */
export function declaredKeys(source) {
  const mask = structureMask(source);
  const at = declarationAt(mask, SCHEMA_NAME);
  if (at === -1) return { keys: null, why: `no \`export const ${SCHEMA_NAME}\` declaration in this source` };

  const objectCall = /\bz\.(?:object|strictObject|looseObject)\s*\(\s*\{/.exec(mask.slice(at));
  if (!objectCall) {
    return {
      keys: null,
      why: `\`${SCHEMA_NAME}\` is declared but its initialiser opens no \`z.object({\` this reader can walk`,
    };
  }
  const openAt = at + objectCall.index + objectCall[0].length - 1;
  const span = balancedSpan(mask, openAt);
  if (!span) return { keys: null, why: `the \`z.object({\` opened by \`${SCHEMA_NAME}\` never closes` };

  // Composition applied AFTER the literal contributes keys this reader cannot
  // see. Refuse rather than answer for the literal alone.
  const semi = mask.indexOf(';', span.end);
  const tail = mask.slice(span.end, semi === -1 ? mask.length : semi);
  const composed = /\.(extend|merge|and|catchall)\s*\(/.exec(tail);
  if (composed) {
    return {
      keys: null,
      why: `\`${SCHEMA_NAME}\` composes its shape with \`.${composed[1]}(\` after the object literal — `
        + 'this reader sees only the literal, so it would under-report',
    };
  }

  const { keys, unreadable } = topLevelKeys(source, span);
  if (unreadable) return { keys: null, why: `\`${SCHEMA_NAME}\`'s shape carries ${unreadable}` };
  if (keys.length === 0) return { keys: null, why: `\`${SCHEMA_NAME}\` declares no properties this reader can see` };
  return { keys, why: null };
}

/**
 * The strings `CENSUS_NAME` lists, or `{ keys: null, why }`.
 *
 * The `[` searched for is the one after the initialiser's `=`, deliberately:
 * the declaration is annotated `readonly string[]`, whose own `[` comes FIRST.
 */
export function censusKeys(source) {
  const mask = structureMask(source);
  const at = declarationAt(mask, CENSUS_NAME);
  if (at === -1) return { keys: null, why: `no \`export const ${CENSUS_NAME}\` declaration in this source` };

  const eq = initialiserAt(mask, at);
  if (eq === -1) return { keys: null, why: `\`${CENSUS_NAME}\` is declared with no initialiser` };
  const openAt = mask.indexOf('[', eq);
  if (openAt === -1) return { keys: null, why: `\`${CENSUS_NAME}\`'s initialiser is not an array literal` };
  const span = balancedSpan(mask, openAt);
  if (!span) return { keys: null, why: `\`${CENSUS_NAME}\`'s array literal never closes` };

  const keys = [];
  // `skipTo` is not optional bookkeeping: literal CONTENT is blanked but the
  // DELIMITERS are code, so a walk that did not step past a string's closing
  // quote would read that quote as the OPENING of the next one and hand back
  // the comma and whitespace between two members as a census entry.
  let skipTo = -1;
  walkDepth(mask, span.start, span.end, (i) => {
    if (i < skipTo) return;
    const ch = mask[i];
    if (ch !== "'" && ch !== '"') return;
    const end = mask.indexOf(ch, i + 1);
    if (end === -1 || end >= span.end) return;
    skipTo = end + 1;
    const text = source.slice(i + 1, end);
    if (text.length > 0) keys.push(text);
  });

  if (keys.length === 0) return { keys: null, why: `\`${CENSUS_NAME}\` lists no string literals` };
  return { keys: [...new Set(keys)], why: null };
}

// ── The comparison ──────────────────────────────────────────────────────────

/**
 * The verdict over three source texts, taken as DATA so the self-test drives
 * the same code the real run does.
 *
 * `evidence` maps a ledger row's `evidence` path to its source text.
 */
export function judge({ spec, parser, evidence = {} }) {
  const problems = [];

  const declared = declaredKeys(spec);
  const census = censusKeys(parser);

  // Refusals first, and they are terminal: every comparison below is vacuous
  // over an unread side, so answering "no problems" would be the loudest
  // possible way to be wrong.
  if (declared.keys === null) {
    problems.push(
      `UNREADABLE: could not derive the declared keys from ${SPEC_FILE} — ${declared.why}.\n`
      + '    This is a REFUSAL, not a finding: with no declared keys the comparison below is\n'
      + '    vacuously true, so it would print green over a schema nobody read. Point the\n'
      + '    reader at the shape (or teach it the construct) rather than deleting this gate.',
    );
  }
  if (census.keys === null) {
    problems.push(
      `UNREADABLE: could not derive the census from ${PARSER_FILE} — ${census.why}.\n`
      + '    Same refusal as above, from the other side.',
    );
  }
  if (problems.length > 0) return { problems, declared: declared.keys, census: census.keys };

  const censusSet = new Set(census.keys);
  const declaredSet = new Set(declared.keys);

  // ── The one-directional failure this gate exists for ──────────────────────
  for (const key of declared.keys) {
    if (censusSet.has(key)) continue;
    problems.push(
      `UNCONSUMED-BY-THE-PARSER: \`${key}\` is declared by ${SCHEMA_NAME} in ${SPEC_FILE}\n`
      + `    but is missing from \`${CENSUS_NAME}\` in ${PARSER_FILE}.\n`
      + '    Authoring metadata that sets it is spec-legal and consumed by the objectui\n'
      + '    renderer, and this parser warns about it: a FALSE POSITIVE on legal metadata.\n'
      + `    Fix: add '${key}' to the array (it is alphabetical), and check objectui's copy\n`
      + '    of the same census in the same breath — the two must stay in lockstep.',
    );
  }

  // ── The other direction, which is legal only through a ledger row ─────────
  const ledgerByKey = new Map(NON_DECLARED_MEMBERS.map((r) => [r.key, r]));
  for (const key of census.keys) {
    if (declaredSet.has(key) || ledgerByKey.has(key)) continue;
    problems.push(
      `UNDECLARED-AND-UNLEDGERED: \`${key}\` is in \`${CENSUS_NAME}\` but ${SCHEMA_NAME}\n`
      + `    does not declare it and NON_DECLARED_MEMBERS in ${SELF} does not record it.\n`
      + '    A census member with no schema declaration needs a real write site: name the\n'
      + '    file and the witness in NON_DECLARED_MEMBERS, or remove the key. An unrecorded\n'
      + '    one reads exactly like `description` and is how a second exemption arrives\n'
      + '    without anyone deciding it should.',
    );
  }

  // ── Both ends of every ledger row ─────────────────────────────────────────
  for (const row of NON_DECLARED_MEMBERS) {
    if (!censusSet.has(row.key)) {
      problems.push(
        `STALE LEDGER ROW: NON_DECLARED_MEMBERS records \`${row.key}\`, which is no longer in\n`
        + `    \`${CENSUS_NAME}\`. Delete the row in the PR that removed the key.`,
      );
      continue;
    }
    if (declaredSet.has(row.key)) {
      problems.push(
        `STALE LEDGER ROW: \`${row.key}\` is now DECLARED by ${SCHEMA_NAME}, so it is derived\n`
        + '    like every other key and needs no exemption. Delete the row.',
      );
      continue;
    }
    const source = evidence[row.evidence];
    if (source === undefined) {
      problems.push(
        `UNREADABLE: ${row.evidence} — the evidence for \`${row.key}\` — is not in the scan set.`,
      );
      continue;
    }
    if (!structureMask(source).includes(row.witness)) {
      problems.push(
        `WITNESS GONE: \`${row.key}\` is exempted from derivation because ${row.evidence}\n`
        + `    writes it into \`options\` (\`${row.witness}\`), and that write is no longer in\n`
        + '    that file\'s CODE. Either it moved — repoint the row — or it is gone, in which\n'
        + '    case the key is now unwitnessed and belongs out of the census.',
      );
    }
  }

  return { problems, declared: declared.keys, census: census.keys };
}

/** This file, repo-relative — named in a message, so derived rather than typed. */
const SELF = 'scripts/check-widget-option-census.mjs';

// ── Real-tree wiring ────────────────────────────────────────────────────────

function readTree(root = REPO_ROOT) {
  const read = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const evidence = {};
  for (const row of NON_DECLARED_MEMBERS) {
    const text = read(row.evidence);
    if (text !== null) evidence[row.evidence] = text;
  }
  return { spec: read(SPEC_FILE) ?? '', parser: read(PARSER_FILE) ?? '', evidence };
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const tree = readTree();
  const { problems, declared, census } = judge(tree);

  if (process.argv.includes('--list')) {
    console.log(`declared by ${SCHEMA_NAME} (${SPEC_FILE}):`);
    for (const k of declared ?? []) console.log(`  ${k}`);
    console.log(`\n${CENSUS_NAME} (${PARSER_FILE}):`);
    for (const k of census ?? []) console.log(`  ${k}${(declared ?? []).includes(k) ? '' : '   [non-declared]'}`);
    console.log('\nNON_DECLARED_MEMBERS:');
    for (const r of NON_DECLARED_MEMBERS) console.log(`  ${r.key} — ${r.evidence} (${r.witness})`);
    process.exit(0);
  }

  if (problems.length > 0) {
    console.error(`\n✗ check-widget-option-census: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `OK  check-widget-option-census: ${declared.length} key(s) declared by ${SCHEMA_NAME} are all in `
    + `\`${CENSUS_NAME}\` (${census.length} member(s)); `
    + `${NON_DECLARED_MEMBERS.length} non-declared member(s) each still witnessed.`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────

const SPEC_FIXTURE = `
/**
 * Widget \`options\`. The renderer lowers \`dateGranularity\`, \`order\` and
 * \`limit\` into the DatasetSelection it posts.
 */
export const ${SCHEMA_NAME} = lazySchema(() => z.object({
  /**
   * Bucket the widget's date dimensions. Overrides the dimension's own
   * \`dateGranularity\` default for this widget only.
   */
  dateGranularity: DateGranularity.optional().describe('Bucket selected date dimensions'),

  sortBy: z.string().optional().describe('Dimension/measure name to order by'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction for sortBy'),
  limit: z.number().int().positive().optional().describe('Max rows (applied after ordering)'),
  stageOrder: z.array(z.union([z.string(), z.number()])).optional()
    .describe('Explicit category order'),
}).passthrough().describe('Widget configuration'));

export const SomethingElseSchema = z.object({
  granularity: 'a sentence mentioning options.dateGranularity in prose',
});
`;

const censusFixture = (keys) =>
  `export const ${CENSUS_NAME}: readonly string[] = [\n`
  + keys.map((k) => `  '${k}',\n`).join('')
  + '];\n';

const CENSUS_FIXTURE = censusFixture([
  'dateGranularity', 'description', 'limit', 'sortBy', 'sortOrder', 'stageOrder',
]);

const EVIDENCE_FIXTURE = {
  'packages/spec/src/system/i18n-resolver.ts':
    'if (subCaption) next.options = { ...w.options, description: subCaption };\n',
};

function selfTest() {
  const base = { spec: SPEC_FIXTURE, parser: CENSUS_FIXTURE, evidence: EVIDENCE_FIXTURE };
  const cases = [
    {
      label: 'the real shape, read cleanly → GREEN',
      tree: base,
      expect: 'green',
    },
    {
      // THE POSITIVE CONTROL: the whole reason the gate exists.
      label: 'a declared key the parser does not consume → RED, naming it',
      tree: { ...base, spec: SPEC_FIXTURE.replace('  sortBy:', "  brandNewKey: z.string().optional().describe('x'),\n  sortBy:") },
      expect: 'red',
      mutates: ['brandNewKey'],
      wants: [/UNCONSUMED-BY-THE-PARSER/, /brandNewKey/],
    },
    {
      // ⭐ THE MANDATORY NEGATIVE CONTROL (#12926): a fake key added inside a
      // doc COMMENT must not move this gate. `dateGranularity` really does
      // appear inside two docblocks in the file this reads.
      label: 'a fake key in a DOC COMMENT → GREEN (prose is not a declaration)',
      tree: {
        ...base,
        spec: SPEC_FIXTURE.replace(
          'default for this widget only.',
          'default for this widget only. Also fakeInProse: nothing at all.',
        ),
      },
      expect: 'green',
      mutates: ['fakeInProse'],
      // The mutation has to LAND, or this case proves only that the gate can
      // be run: a `replace` whose needle is absent is a silent no-op and the
      // fixture stays clean. Asserted below through `mutates`.
    },
    {
      label: 'a property commented OUT in a block comment → GREEN',
      tree: { ...base, spec: SPEC_FIXTURE.replace('  sortBy:', '  /*\n  fakeCommentedOut: z.string().optional(),\n  */\n  sortBy:') },
      expect: 'green',
      mutates: ['fakeCommentedOut'],
    },
    {
      label: 'a property commented OUT on a line → GREEN',
      tree: { ...base, spec: SPEC_FIXTURE.replace('  sortBy:', '  // fakeLineComment: z.string().optional(),\n  sortBy:') },
      expect: 'green',
      mutates: ['fakeLineComment'],
    },
    {
      label: 'key-shaped text inside a .describe() STRING → GREEN',
      tree: { ...base, spec: SPEC_FIXTURE.replace("describe('Dimension/measure name to order by')", "describe('fakeInString: order by this')") },
      expect: 'green',
      mutates: ['fakeInString'],
    },
    {
      // The row that decided the reader, and the only case here shaped to be
      // DISCRIMINATING. A nested literal truncates every scope that ends at the
      // first `})`, and truncation fails GREEN — so the fixture puts the nested
      // object EARLY, gives it a census entry so it draws no finding of its
      // own, and hangs `tailKey` off the END of the shape. A truncating reader
      // never reaches `tailKey` and prints green; this one reds naming it.
      // `nestedFake` must not be named: depth is the other half of the rule.
      label: 'a nested inline z.object({}) → the reader still reaches the LAST key past it',
      tree: {
        parser: censusFixture(['dateGranularity', 'description', 'limit', 'sortBy', 'sortOrder', 'stageOrder', 'window']),
        evidence: EVIDENCE_FIXTURE,
        spec: SPEC_FIXTURE
          .replace('  sortBy:', '  window: z.object({ nestedFake: z.string() }).optional(),\n  sortBy:')
          .replace("    .describe('Explicit category order'),", "    .describe('Explicit category order'),\n  tailKey: z.string().optional(),"),
      },
      expect: 'red',
      mutates: ['window: z.object({ nestedFake', 'tailKey'],
      wants: [/UNCONSUMED-BY-THE-PARSER/, /`tailKey`/],
      rejects: [/nestedFake/, /`window`/],
    },
    {
      label: 'a second undeclared census member with no ledger row → RED',
      tree: { ...base, parser: censusFixture(['dateGranularity', 'description', 'invert', 'limit', 'sortBy', 'sortOrder', 'stageOrder']) },
      expect: 'red',
      wants: [/UNDECLARED-AND-UNLEDGERED/, /`invert`/],
    },
    {
      label: '`description` alone stays legal — the ledgered exemption → GREEN',
      tree: base,
      expect: 'green',
    },
    {
      label: 'the ledger row\'s witness gone from the evidence file → RED',
      tree: { ...base, evidence: { 'packages/spec/src/system/i18n-resolver.ts': 'const unrelated = 1;\n' } },
      expect: 'red',
      wants: [/WITNESS GONE/, /description/],
    },
    {
      label: 'the witness present only as PROSE in the evidence file → RED',
      tree: {
        ...base,
        evidence: { 'packages/spec/src/system/i18n-resolver.ts': '// once wrote description: subCaption here\nconst x = 1;\n' },
      },
      expect: 'red',
      wants: [/WITNESS GONE/],
    },
    {
      label: '`description` removed from the census → RED as a stale row, not silence',
      tree: { ...base, parser: censusFixture(['dateGranularity', 'limit', 'sortBy', 'sortOrder', 'stageOrder']) },
      expect: 'red',
      wants: [/STALE LEDGER ROW/, /description/],
    },
    {
      label: 'the schema renamed away → REFUSE, never a clean run',
      tree: { ...base, spec: SPEC_FIXTURE.replace(SCHEMA_NAME, 'WidgetOptionsSchemaRenamed') },
      expect: 'red',
      mutates: ['WidgetOptionsSchemaRenamed'],
      wants: [/UNREADABLE/, /declaration in this source/],
    },
    {
      label: 'the census array emptied → REFUSE, never a clean run',
      tree: { ...base, parser: censusFixture([]) },
      expect: 'red',
      wants: [/UNREADABLE/, /no string literals/],
    },
    {
      label: 'a spread inside the shape → REFUSE (the keys come from elsewhere)',
      tree: { ...base, spec: SPEC_FIXTURE.replace('  sortBy:', '  ...BaseWidgetOptions.shape,\n  sortBy:') },
      expect: 'red',
      mutates: ['...BaseWidgetOptions.shape'],
      wants: [/UNREADABLE/, /spread/],
    },
    {
      label: 'an .extend() on the declaration → REFUSE (this reader sees only the literal)',
      tree: { ...base, spec: SPEC_FIXTURE.replace('.passthrough().describe(\'Widget configuration\'));', '.extend({ later: z.string() }).passthrough());') },
      expect: 'red',
      mutates: ['.extend({ later'],
      wants: [/UNREADABLE/, /extend/],
    },
  ];

  let failed = 0;
  for (const c of cases) {
    // A fixture built with `.replace()` whose needle has drifted is a SILENT
    // no-op: the case then runs against the clean baseline, agrees with its
    // expectation for the wrong reason, and prints a tick. So every mutating
    // case declares a token that must be present in the source it mutated.
    const mutationMisses = (c.mutates ?? []).filter(
      (token) => !`${c.tree.spec}\n${c.tree.parser}`.includes(token),
    );
    if (mutationMisses.length > 0) {
      failed += 1;
      console.error(`  ✗ ${c.label}\n      the fixture mutation did not land: ${mutationMisses.join(', ')} absent from the source`);
      continue;
    }

    let problems;
    try {
      ({ problems } = judge(c.tree));
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${c.label}\n      threw: ${e.message}`);
      continue;
    }
    const red = problems.length > 0;
    if (red !== (c.expect === 'red')) {
      failed += 1;
      console.error(`  ✗ ${c.label}\n      expected ${c.expect}, got ${red ? 'red' : 'green'}: ${problems.join(' | ')}`);
      continue;
    }
    const blob = problems.join('\n');
    const missing = (c.wants ?? []).filter((rx) => !rx.test(blob));
    const surplus = (c.rejects ?? []).filter((rx) => rx.test(blob));
    if (missing.length > 0 || surplus.length > 0) {
      failed += 1;
      console.error(
        `  ✗ ${c.label}\n      ${missing.length > 0 ? `message does not name ${missing.map((m) => `/${m.source}/`).join(', ')}` : ''}`
        + `${surplus.length > 0 ? ` message names ${surplus.map((m) => `/${m.source}/`).join(', ')} and must not` : ''}\n      ${blob}`,
      );
      continue;
    }
    console.log(`  ✓ ${c.label}`);
  }

  // ── Instrument checks against the REAL tree ───────────────────────────────
  //
  // The cases above run on fixtures; these prove the readers still reach the
  // real files. A fixture-only self-test passes over a tree the gate can no
  // longer read, which is the failure this gate refuses everywhere else.
  const tree = readTree();
  const realDeclared = declaredKeys(tree.spec);
  const realCensus = censusKeys(tree.parser);
  const checks = [
    [realDeclared.keys !== null && realDeclared.keys.length >= 5,
      `real tree: ${SCHEMA_NAME} in ${SPEC_FILE} reads as ${JSON.stringify(realDeclared.keys)}`],
    [realCensus.keys !== null && realCensus.keys.length >= 5,
      `real tree: ${CENSUS_NAME} in ${PARSER_FILE} reads as ${JSON.stringify(realCensus.keys)}`],
    [realDeclared.keys !== null && !realDeclared.keys.includes('granularity'),
      'real tree: the reader does not reach the sibling schema further down the spec file'],
    [NON_DECLARED_MEMBERS.every((r) => tree.evidence[r.evidence] !== undefined),
      'real tree: every ledger row\'s evidence file is readable'],
  ];
  for (const [ok, line] of checks) {
    if (ok) console.log(`  ✓ ${line}`);
    else { failed += 1; console.error(`  ✗ ${line}`); }
  }

  if (failed > 0) {
    console.error(`\n✗ check-widget-option-census self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(
    `\n✓ check-widget-option-census self-test: ${cases.length} cases pass, `
    + 'negative controls (comment, commented-out property, string) and refusals included.',
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
