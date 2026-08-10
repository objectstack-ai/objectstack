// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Check Skill Examples (anti-drift, #3094)
 *
 * The TypeScript examples inside `skills/` are the first thing an AI reads when
 * authoring ObjectStack metadata, yet nothing type-checks them. When the spec
 * renames an export or tightens a discriminated union, the examples silently rot
 * (`defineDataset` → `defineSeed`, the removed `unique`/`async` validation
 * types, kanban's top-level `groupBy`) and the platform's headline
 * AI-native surface starts teaching code that no longer compiles. A third party
 * following the skill hits the wall first.
 *
 * Full extraction of every ```ts block is infeasible: most are *fragments*
 * (a `columns: [...]` subtree, a `kanban: {...}` literal) that would need a
 * hand-authored wrapper to compile, and wrapping them yields high false-positive
 * noise. So this gate is **opt-in**: a self-contained, should-compile block is
 * marked by a `<!-- os:check -->` HTML comment on the line directly above its
 * fence. The marker is an inert comment (renders to nothing) and — crucially —
 * leaves the fence info-string a bare ` ```ts ` / ` ```typescript `, so the
 * existing `check:doc-authoring` scanner (which keys on `^```(ts|typescript|tsx)$`)
 * still sees the block. A fence-meta tag like ` ```ts check ` would have punched
 * a hole in that gate.
 *
 * ── Sweeping the UNMARKED blocks: two traps ─────────────────────────────────
 * Periodically it is worth asking whether any unmarked block is genuine ROT
 * rather than a fragment. Two things make a naive sweep report a confident
 * "nothing found", and both bit a real attempt:
 *
 *   1. `tsc` reports syntactic diagnostics and then STOPS — it never runs the
 *      semantic pass for the program. Mark every block at once and the ~200
 *      syntactically-broken fragments suppress type-checking for ALL the rest,
 *      so a run producing only TS1xxx codes proves nothing. Exclude the
 *      syntax failures and re-run before concluding anything about rot.
 *   2. A block that omits its imports resolves bare type names against the DOM
 *      lib: `Plugin`, `Event`, `Response`, `Storage`, `Selection` all exist
 *      there. `const p: Plugin = { version, init }` then reports "version does
 *      not exist in type Plugin" against lib.dom's Plugin — an artefact, not
 *      drift. Check what the name actually resolved to before filing it.
 *
 * The 2026-07 sweep that applied both corrections found exactly one real rot in
 * `content/docs` (a FAQ recommending `FieldSchema.extend()`, impossible since
 * FieldSchema became a ZodPipe); everything else was fragments.
 *
 * Each marked block is written verbatim to a throwaway build dir and type-checked
 * with `tsc --noEmit` against the built `@objectstack/spec` declarations — the
 * exact surface a consumer's `import { … } from '@objectstack/spec'` resolves to.
 * Module resolution is wired via a `paths` map derived from the package's own
 * `exports` field, so it self-updates as the spec adds/removes subpath exports.
 *
 * Because it reads the built `dist/*.d.ts`, this runs AFTER the workspace build
 * step in CI — alongside `check:api-surface` / the example-app typecheck, its
 * fellow "real consumer" gates — not before it like `check:skill-refs`.
 *
 * Since #7181 that ordering is enforced rather than assumed: the type-check half
 * refuses a dist that is missing or older than `src/`. The existing "is the spec
 * built" guard below only answers ABSENCE; a present-but-stale dist type-checks
 * every example against the previous build and prints `✅ N prose examples
 * type-check against @objectstack/spec` — a green about a rename the developer
 * has already made and this run never saw. See lib/dist-freshness.ts.
 *
 * ── The third anti-idle assertion: no bare `any` in a marked block (#5943) ───
 * A marker is the author's claim "this block compiles", and the two guards above
 * (orphan marker, zero blocks) exist because a gate that checks nothing must not
 * report success. A bare `any` inside a marked block is the same failure wearing
 * a green badge: every property access on an `any` is unchecked, so `tsc` proves
 * exactly nothing about the lines a reader copies.
 *
 * #5720 is the measured specimen. Two marked hook examples were written
 * `export async function beforeUpdate(ctx: any)` and read `ctx.services`, which
 * a hook context does not have (the engine builds nine keys by name, the sandbox
 * ten, neither of them `services`) — so the copied hook short-circuits on the
 * optional chain and throws `PERMISSION_DENIED` on every write. This gate was
 * green throughout. Re-annotate the identical function bodies with the honest
 * `HookContext` and both report the same line:
 *
 *     error TS2339: Property 'services' does not exist on type
 *     '{ object: string; event: …; input: Record<string, unknown>; … }'
 *
 * The same `any` also hid #5605's `ctx.session?.positions`. One `any`, two
 * defects, zero diagnostics.
 *
 * SCOPE — the annotation must BE `any`, in a position where it erases checking
 * wholesale: a parameter, a variable/property/return annotation, a type alias,
 * or an `as any` / `satisfies any` / angle-bracket assertion. `any` NESTED inside a
 * larger type (`Record<string, any>`, `any[]`, `Promise<any>`) is deliberately
 * NOT flagged — the same line `check-exported-any.ts` draws for the same reason:
 * a nested `any` is a much broader question, and holding the gate at zero false
 * positives is what keeps red meaning broken.
 *
 * Casts and locals are in scope, and not for symmetry: a parameter-only rule is
 * defeated by exactly the edit an author reaches for when it goes red — move the
 * `any` one line down (`const c: any = ctx`) or into the access
 * (`(ctx as any).services`) — which would leave the gate green over an unchanged
 * defect. Measured at the time of writing, the whole 208-block corpus contained
 * three bare `any` annotations, all in one block, so the wider scope cost nothing
 * to adopt and there is no ratchet file: the baseline is zero and stays zero.
 *
 * Usage:
 *   tsx scripts/check-skill-examples.ts            # extract + type-check (CI)
 *   tsx scripts/check-skill-examples.ts --self-test  # pin the `any` detector, both directions
 *   tsx scripts/check-skill-examples.ts --keep     # also leave the build dir for inspection
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';

import { inspectDistFreshness } from './lib/dist-freshness';

// ── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SPEC_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.resolve(SPEC_DIR, '.examples-build');
const SPEC_PKG_JSON = path.resolve(SPEC_DIR, 'package.json');

/**
 * Prose trees whose code examples are copied verbatim by humans and AI, and so
 * must compile against the real spec.
 *
 * `skills/` was the original scope (#3094); `content/docs/` was not covered, and
 * the gap had exactly the shape this gate exists to close. When
 * `tool.requiresConfirmation` was removed (#3715) this gate caught the now-broken
 * `defineTool` example in `skills/objectstack-ai/SKILL.md` — the identical break
 * in a docs page would have shipped, because nothing compiled those pages. A
 * gate covering a fraction of the surface it appears to cover reads as coverage.
 *
 * `content/docs/references/` is excluded: `build-docs.ts` regenerates it from the
 * schemas, so its snippets cannot drift independently of their source.
 */
const SOURCE_ROOTS: Array<{
  dir: string;
  ext: string;
  label: string;
  marker: string;
  exclude?: string[];
}> = [
  { dir: path.resolve(REPO_ROOT, 'skills'), ext: '.md', label: 'skills', marker: '<!-- os:check -->' },
  {
    dir: path.resolve(REPO_ROOT, 'content/docs'),
    ext: '.mdx',
    label: 'docs',
    // MDX has no HTML comments — fumadocs-mdx fails the build outright on
    // `<!-- … -->` ("Unexpected character `!`… to create a comment in MDX, use
    // `{/* text */}`"). The marker must follow each format's own comment syntax.
    marker: '{/* os:check */}',
    exclude: [path.resolve(REPO_ROOT, 'content/docs/references')],
  },
];

/**
 * Every marker spelling, in any root. A block tagged with the WRONG root's
 * spelling would be silently unchecked (and, in `.mdx`, would also break the
 * docs build), so both forms are recognised for orphan detection and only the
 * root's own form actually opts a block in.
 */
const ALL_MARKERS = ['<!-- os:check -->', '{/* os:check */}'];

const KEEP = process.argv.includes('--keep');
const SELF_TEST = process.argv.includes('--self-test');

const rel = (p: string) => path.relative(REPO_ROOT, p);

// ── Extraction ───────────────────────────────────────────────────────────────

interface Example {
  /** Source markdown file (absolute). */
  source: string;
  /** 1-based line in the source of the FIRST code line inside the fence. */
  bodyStartLine: number;
  /** Raw fence body. */
  code: string;
  /** Flat file name written into the build dir. */
  fileName: string;
}

/** Every candidate prose file across `SOURCE_ROOTS`, with the root that owns it. */
function sourceFiles(): Array<{ file: string; root: (typeof SOURCE_ROOTS)[number] }> {
  const out: Array<{ file: string; root: (typeof SOURCE_ROOTS)[number] }> = [];
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root.dir)) continue;
    const walk = (dir: string) => {
      if (root.exclude?.some((x) => dir === x || dir.startsWith(x + path.sep))) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(root.ext)) out.push({ file: full, root });
      }
    };
    walk(root.dir);
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Flat, collision-free build-dir name for a block: `<root>__<path>__<n>.ts`.
 * Path separators become `_` so two pages of the same basename in different
 * folders (`ui/actions.mdx`, `protocol/objectui/actions.mdx`) cannot collide.
 */
function buildFileName(source: string, root: (typeof SOURCE_ROOTS)[number], n: number): string {
  const relPath = path.relative(root.dir, source).replace(new RegExp(`\\${root.ext}$`), '');
  return `${root.label}__${relPath.split(path.sep).join('_')}__${n}.ts`;
}

/**
 * Pull every marked ```ts / ```typescript block out of one markdown file.
 * A block is marked when the line immediately above its opening fence is
 * exactly the MARKER (ignoring surrounding whitespace).
 *
 * Also reports `orphans`: MARKER lines that are NOT directly above a ts fence.
 * A misplaced marker (a blank line slipped in between, or it precedes a bash /
 * json block) silently checks nothing — exactly the failure mode this gate
 * exists to prevent — so the caller treats an orphan as an error, not a no-op.
 */
function extractFromFile(
  source: string,
  root: (typeof SOURCE_ROOTS)[number],
): { examples: Example[]; orphans: number[] } {
  const lines = fs.readFileSync(source, 'utf-8').split('\n');
  const examples: Example[] = [];
  const claimed = new Set<number>(); // MARKER line indices that opened a real block
  let n = 0;

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^```(ts|typescript)\s*$/);
    if (!open) continue;
    const marked = i > 0 && lines[i - 1].trim() === root.marker;
    // Find the matching close fence regardless of marking, so `i` advances past
    // this block and we never treat its body as top-level markdown.
    let close = i + 1;
    while (close < lines.length && !/^```\s*$/.test(lines[close])) close++;
    if (marked) {
      claimed.add(i - 1);
      const body = lines.slice(i + 1, close);
      n += 1;
      examples.push({
        source,
        bodyStartLine: i + 2, // 1-based line of body[0]
        code: body.join('\n'),
        fileName: buildFileName(source, root, n),
      });
    }
    i = close; // skip to the close fence
  }

  const orphans: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Any marker spelling counts as an orphan claim — a wrong-format marker
    // checks nothing, which is precisely what this guard exists to catch.
    if (ALL_MARKERS.includes(lines[i].trim()) && !claimed.has(i)) orphans.push(i + 1); // 1-based
  }
  return { examples, orphans };
}

// ── Bare-`any` guard (#5943) ─────────────────────────────────────────────────

interface AnyFinding {
  /** 1-based line WITHIN the block body (body[0] is line 1). */
  line: number;
  /** 1-based column. */
  col: number;
  /** Human-readable position, e.g. "parameter `ctx`" — the prescription's subject. */
  where: string;
}

/**
 * Every position in which a bare `any` erases checking wholesale, keyed by the
 * PARENT node kind. The check is `parent.type === node` (or the assertion's own
 * type slot), so an `any` nested in a larger type — `Record<string, any>`,
 * `any[]`, `Promise<any>` — has a TypeReference/ArrayType parent and is not a
 * finding. That boundary is the gate's zero-false-positive line; widening it is
 * a different question with a different (much larger) baseline.
 */
function describeAnyPosition(node: ts.Node): string | null {
  const parent = node.parent;
  if (!parent) return null;

  const named = (name: ts.BindingName | ts.PropertyName | undefined): string =>
    name && ts.isIdentifier(name) ? ` \`${name.text}\`` : '';

  if (ts.isParameter(parent) && parent.type === node) return `parameter${named(parent.name)}`;
  if (ts.isVariableDeclaration(parent) && parent.type === node) return `variable${named(parent.name)}`;
  if ((ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.type === node)
    return `property${named(parent.name)}`;
  if (ts.isTypeAliasDeclaration(parent) && parent.type === node) return `type alias \`${parent.name.text}\``;
  if (ts.isAsExpression(parent) && parent.type === node) return '`as any` assertion';
  if (ts.isSatisfiesExpression(parent) && parent.type === node) return '`satisfies any` assertion';
  if (ts.isTypeAssertionExpression(parent) && parent.type === node) return '`< any >` type assertion';
  // Return annotations: functions, methods, arrows, getters, signatures.
  if (ts.isFunctionLike(parent) && parent.type === node) return 'return type';
  return null;
}

/**
 * Parse ONE marked block and report every bare `any` annotation in it.
 *
 * Parsing (not regex) because the corpus is prose: `'any'` appears in string
 * literal unions, in JSDoc, and in ordinary English inside comments — a
 * line-wise regex reported three such lines on this repo's own corpus and none
 * of them was a type annotation. `createSourceFile` never throws on malformed
 * input; a block too broken to parse yields no findings here and is caught by
 * the `tsc` pass that follows, which is the right division of labour.
 */
function findBareAny(code: string, fileName: string): AnyFinding[] {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2020, /* setParentNodes */ true, ts.ScriptKind.TS);
  const findings: AnyFinding[] = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const where = describeAnyPosition(node);
      if (where) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({ line: line + 1, col: character + 1, where });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  return findings;
}

// ── Module resolution derived from the spec's own `exports` ──────────────────

interface ExportEntry {
  import?: { types?: string };
  require?: { types?: string };
}

/**
 * Build a tsconfig `paths` map from `@objectstack/spec`'s published `exports`,
 * pointing each specifier at its built `.d.ts`. Deriving it from the real
 * exports means a new subpath export (or a removed one) is reflected here for
 * free — the map cannot drift from what consumers actually resolve.
 *
 * Returns the map plus the list of declaration files that must exist; a missing
 * root declaration means the spec was not built (or built with OS_SKIP_DTS), and
 * the caller fails loudly rather than checking against a stale/absent surface.
 */
function specPaths(): { paths: Record<string, string[]>; missing: string[] } {
  const pkg = JSON.parse(fs.readFileSync(SPEC_PKG_JSON, 'utf-8'));
  const exportsMap = pkg.exports as Record<string, ExportEntry | string>;
  const paths: Record<string, string[]> = {};
  const missing: string[] = [];

  for (const [key, entry] of Object.entries(exportsMap)) {
    const types =
      typeof entry === 'string'
        ? entry
        : (entry.require?.types ?? entry.import?.types);
    if (!types || !types.endsWith('.d.ts')) continue; // skip non-type conditions (css, etc.)
    const specifier = key === '.' ? '@objectstack/spec' : `@objectstack/spec/${key.slice(2)}`;
    const abs = path.resolve(SPEC_DIR, types);
    paths[specifier] = [abs];
    if (!fs.existsSync(abs)) missing.push(rel(abs));
  }
  return { paths, missing };
}

// ── tsc harness ──────────────────────────────────────────────────────────────

function writeBuildDir(examples: Example[], paths: Record<string, string[]>): void {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  for (const ex of examples) {
    // Written verbatim (no prepended wrapper) so a tsc line N maps to source
    // line (bodyStartLine + N - 1) with zero arithmetic guesswork. A block with
    // no import/export is a script, not a module; append `export {}` so two such
    // files can't collide on a global — appended at the end, it never shifts the
    // line of any real diagnostic.
    const isModule = /^\s*(import|export)\b/m.test(ex.code);
    fs.writeFileSync(
      path.join(BUILD_DIR, ex.fileName),
      ex.code + (isModule ? '' : '\nexport {};\n'),
    );
  }

  const tsconfig = {
    compilerOptions: {
      // A consumer-faithful, illustrative-code-friendly profile: strict enough
      // to catch real type drift, lax on the two rules that punish example code
      // (an import shown for context, an unused binding).
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      types: [],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      // `paths` values are absolute, so no `baseUrl` is needed — and omitting it
      // sidesteps TS 6.0's `baseUrl` deprecation (TS5101).
      paths,
    },
    include: ['*.ts'],
  };
  fs.writeFileSync(
    path.join(BUILD_DIR, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2),
  );
}

interface Diagnostic {
  file: string; // build-dir file name
  line: number;
  col: number;
  text: string; // full tsc line, from the code after the location
}

/** Parse `file.ts(line,col): error TSxxxx: message` lines from `tsc --pretty false`. */
function parseDiagnostics(output: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+:.*)$/;
  for (const raw of output.split('\n')) {
    const m = raw.match(re);
    if (!m) continue;
    diags.push({
      file: path.basename(m[1]),
      line: Number(m[2]),
      col: Number(m[3]),
      text: `${m[4]} ${m[5]}`,
    });
  }
  return diags;
}

function runTsc(): { code: number; output: string } {
  const tscBin = require.resolve('typescript/bin/tsc');
  const res = spawnSync(
    process.execPath,
    [tscBin, '--noEmit', '--pretty', 'false', '-p', path.join(BUILD_DIR, 'tsconfig.json')],
    { cwd: BUILD_DIR, encoding: 'utf-8' },
  );
  return { code: res.status ?? 1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Pin the bare-`any` detector on BOTH edges, over the real `extractFromFile`.
 *
 * A false negative makes the assertion dormant — green forever, which is
 * indistinguishable from a clean corpus and is the exact state #5720 shipped in.
 * A false positive is just as costly the other way: the three shapes below
 * (`Record<string, any>`, `any[]`, a `'any'` string-literal union member, the
 * word "any" in prose) all occur in the real corpus, and flagging any of them
 * would force a corpus-wide rewrite for no defect.
 *
 * Line numbers are asserted literally, not recomputed, because the block-line →
 * page-line arithmetic (`bodyStartLine + line - 1`) is the part that silently
 * drifts: a diagnostic pointing at the wrong line is worse than none.
 */
function selfTest(): never {
  const failures: string[] = [];
  const check = (cond: boolean, msg: string): void => {
    if (!cond) failures.push(msg);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-examples-selftest-'));
  try {
    const docsRoot = { dir, ext: '.mdx', label: 'docs', marker: '{/* os:check */}' };
    const skillsRoot = { dir, ext: '.md', label: 'skills', marker: '<!-- os:check -->' };

    // ── RED, docs: the #5720 shape, verbatim. `any` on line 9 of the page. ───
    const redDocs = path.join(dir, 'red.mdx');
    fs.writeFileSync(
      redDocs,
      [
        '# Fixture page', // 1
        '', // 2
        'Prose above the marked block.', // 3
        '', // 4
        '{/* os:check */}', // 5
        '```ts', // 6
        `import type { HookContext } from '@objectstack/spec';`, // 7
        '', // 8
        'export async function beforeUpdate(ctx: any): Promise<void> {', // 9  ← the defect
        '  void ctx;', // 10
        '}', // 11
        '```', // 12
        '',
      ].join('\n'),
      'utf8',
    );
    const red = extractFromFile(redDocs, docsRoot);
    check(red.examples.length === 1, `red fixture: extracted ${red.examples.length} block(s), expected 1`);
    check(red.orphans.length === 0, `red fixture: reported ${red.orphans.length} orphan marker(s), expected 0`);
    if (red.examples.length === 1) {
      const hits = findBareAny(red.examples[0].code, 'red.ts');
      check(hits.length === 1, `red fixture: found ${hits.length} bare \`any\`, expected 1 — the guard is DORMANT`);
      if (hits.length === 1) {
        const pageLine = red.examples[0].bodyStartLine + hits[0].line - 1;
        check(pageLine === 9, `red fixture: reported page line ${pageLine}, expected 9 — line mapping is wrong`);
        check(
          hits[0].where === 'parameter `ctx`',
          `red fixture: described the position as "${hits[0].where}", expected "parameter \`ctx\`"`,
        );
        const expectedCol =
          'export async function beforeUpdate(ctx: any): Promise<void> {'.indexOf(': any') + 3;
        check(hits[0].col === expectedCol, `red fixture: reported column ${hits[0].col}, expected ${expectedCol}`);
      }
    }

    // ── RED, skills: the four NON-parameter positions, all in one block. ─────
    const redSkill = path.join(dir, 'red.md');
    fs.writeFileSync(
      redSkill,
      [
        '# Skill fixture', // 1
        '', // 2
        '<!-- os:check -->', // 3
        '```ts', // 4
        'const api = ({} as unknown) as any;', // 5
        'const loose: any = 1;', // 6
        'type Loose = any;', // 7
        'function widen(): any {', // 8
        '  return 1;', // 9
        '}', // 10
        '```', // 11
        '',
      ].join('\n'),
      'utf8',
    );
    const skill = extractFromFile(redSkill, skillsRoot);
    check(skill.examples.length === 1, `skills fixture: extracted ${skill.examples.length} block(s), expected 1`);
    if (skill.examples.length === 1) {
      const ex = skill.examples[0];
      const got = findBareAny(ex.code, 'red-skill.ts')
        .map((h) => `${ex.bodyStartLine + h.line - 1}:${h.where}`)
        .sort();
      const want = [
        '5:`as any` assertion',
        '6:variable `loose`',
        '7:type alias `Loose`',
        '8:return type',
      ].sort();
      check(
        JSON.stringify(got) === JSON.stringify(want),
        `skills fixture: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)} — a bare-\`any\` position is unguarded, ` +
          `and moving the \`any\` there is exactly the edit a red parameter invites`,
      );
    }

    // ── GREEN: the same function honestly typed, plus every shape that must
    //    NOT be flagged, plus an UNMARKED block that must not be read at all. ─
    const green = path.join(dir, 'green.mdx');
    fs.writeFileSync(
      green,
      [
        '# Green fixture', // 1
        '', // 2
        '{/* os:check */}', // 3
        '```ts', // 4
        `import type { HookContext } from '@objectstack/spec';`, // 5
        '', // 6
        `type Kind = 'string' | 'number' | 'any';`, // 7  string literal, not a type
        '', // 8
        '/** Prose mentioning any old thing, and Record<string, any> in a comment. */', // 9
        'export async function beforeUpdate(ctx: HookContext): Promise<void> {', // 10
        '  const bag: Record<string, any> = {};', // 11 nested — out of scope by design
        '  const rows: any[] = [];', // 12 nested
        `  const kind: Kind = 'any';`, // 13 string literal
        '  void ctx; void bag; void rows; void kind;', // 14
        '}', // 15
        '```', // 16
        '', // 17
        'An UNMARKED block — the gate judges only what the author marked:', // 18
        '', // 19
        '```ts', // 20
        'export function unchecked(ctx: any) { void ctx; }', // 21
        '```', // 22
        '',
      ].join('\n'),
      'utf8',
    );
    const ok = extractFromFile(green, docsRoot);
    check(
      ok.examples.length === 1,
      `green fixture: extracted ${ok.examples.length} block(s), expected 1 — the UNMARKED block must not be read`,
    );
    if (ok.examples.length >= 1) {
      const hits = findBareAny(ok.examples[0].code, 'green.ts');
      check(
        hits.length === 0,
        `green fixture: ${hits.length} false positive(s) — ${hits.map((h) => `line ${h.line} (${h.where})`).join(', ')}. ` +
          `Nested \`any\`, \`'any'\` string literals and the word "any" in prose all occur in the real corpus.`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`✗ self-test: ${f}`);
    console.error(`\ncheck-skill-examples --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    '✅  self-test: flags a bare `any` parameter / variable / property / return / alias / cast in a\n' +
      '    marked block at the right page line, and flags nothing in an honestly typed one.',
  );
  process.exit(0);
}

function main() {
  if (SELF_TEST) selfTest();

  console.log('🧪 Type-checking prose TypeScript examples (skills + docs)...\n');

  const files = sourceFiles();
  const examples: Example[] = [];
  const orphans: string[] = [];
  for (const { file, root } of files) {
    const { examples: found, orphans: bad } = extractFromFile(file, root);
    examples.push(...found);
    for (const line of bad) orphans.push(`${rel(file)}:${line}`);
  }

  // A marker that is not directly above a ```ts fence checks nothing. Fail loudly
  // rather than let it read as covered — a placed-but-inert marker is worse than
  // no marker, because it looks intentional.
  if (orphans.length > 0) {
    fail(
      `Found an os:check marker not directly above a \`\`\`ts / \`\`\`typescript fence\n` +
        `(or written in the wrong comment syntax for its file type):\n\n` +
        orphans.map((o) => `  - ${o}`).join('\n') +
        `\n\n  The marker must be the line IMMEDIATELY above the code fence (no blank\n` +
        `  line between). Move it, or remove it if the block should not be checked.`,
    );
  }

  // Vacuous-green guard: opt-in tagging means "zero blocks" is far more likely
  // to be "the marker got renamed / stripped" than "no examples worth checking".
  // A gate that checks nothing must not report success.
  if (examples.length === 0) {
    fail(
      `No prose examples are marked for type-checking.\n\n` +
        `  Mark a self-contained, compilable block by putting\n\n` +
        SOURCE_ROOTS.map((r) => `    ${r.marker}   (in ${rel(r.dir)}/**/*${r.ext})`).join('\n') + `\n\n` +
        `  on the line directly above its \`\`\`ts fence in ${SOURCE_ROOTS.map((r) => `${rel(r.dir)}/**/*${r.ext}`).join(' or ')}.\n` +
        `  (If you just removed the last marker, that is almost certainly a mistake.)`,
    );
  }

  // Third anti-idle assertion (#5943): a marked block that annotates anything
  // `any` compiles by definition and proves nothing about it. Runs BEFORE the
  // build dir is written, so the author reads one crisp verdict instead of a
  // clean `tsc` run that silently covered nothing.
  const anyHits: string[] = [];
  for (const ex of examples) {
    for (const f of findBareAny(ex.code, ex.fileName)) {
      anyHits.push(`  ${rel(ex.source)}:${ex.bodyStartLine + f.line - 1}:${f.col}  ${f.where}`);
    }
  }
  if (anyHits.length > 0) {
    fail(
      `os:check block(s) annotate ${anyHits.length === 1 ? 'a value' : 'values'} \`any\` — the marker claims\n` +
        `"this compiles" while every property access on that value goes unchecked:\n\n` +
        anyHits.join('\n') +
        `\n\n  Fix it one of two ways:\n` +
        `    1. Annotate the real type (import it from @objectstack/spec) — that is the\n` +
        `       whole point of marking the block, and it is what catches the drift:\n` +
        `       \`(ctx: any)\` hid a hook example reading a \`ctx.services\` that no hook\n` +
        `       context has (#5720), and a \`ctx.session?.positions\` before it (#5605).\n` +
        `    2. Remove the os:check marker if the block is an illustrative fragment\n` +
        `       that cannot be typed against the spec (generated third-party code, a\n` +
        `       partial subtree). An unmarked block is honest; a marked \`any\` is not.\n\n` +
        `  Nested \`any\` (\`Record<string, any>\`, \`any[]\`, \`Promise<any>\`) is NOT flagged\n` +
        `  — only an annotation, cast or alias that IS \`any\`.`,
    );
  }

  // BEFORE any declaration is resolved (#7181, adopting #7122's primitive).
  //
  // Placement differs from the two sibling gates on purpose, because the ROUTE to
  // the dist differs: those resolve entry points in-process with
  // `ts.createProgram`, so their first `.d.ts` read is their first statement of
  // work. Here the declarations are reached indirectly — `specPaths()` turns the
  // exports map into a tsconfig `paths` table and a spawned `tsc` follows it — and
  // everything above this line (extraction, the orphan-marker guard, the zero-block
  // guard, the bare-`any` guard) is dist-independent and worth reporting even when
  // the build is stale. So the guard sits at the boundary rather than at the top:
  // no verdict below it is computed, and no honest finding above it is suppressed.
  //
  // The `missing` check immediately following is NOT redundant. It answers "was
  // the package built at all", which this also covers via `state: 'missing'`; but
  // it stays because it is the one that survives a PARTIAL dist — a subpath whose
  // `.d.ts` was never emitted while the newest declaration on disk is still newer
  // than `src/`, which the mtime rule reads as fresh.
  const freshness = inspectDistFreshness(
    SPEC_DIR,
    'check',
    'pnpm --filter @objectstack/spec check:skill-examples',
  );
  if (!freshness.fresh) {
    console.error(freshness.message);
    process.exit(1);
  }

  const { paths, missing } = specPaths();
  if (missing.some((m) => m.endsWith('index.d.ts')) && !fs.existsSync(paths['@objectstack/spec']?.[0] ?? '')) {
    fail(
      `@objectstack/spec is not built — no declarations to check examples against:\n\n` +
        missing.map((m) => `  - ${m} (missing)`).join('\n') +
        `\n\n  Build the spec first (CI does this in the "Build workspace packages" step):\n\n` +
        `    pnpm --filter @objectstack/spec build`,
    );
  }

  console.log(`   ${examples.length} marked example(s) across ${new Set(examples.map((e) => e.source)).size} file(s):`);
  for (const ex of examples) {
    console.log(`     • ${rel(ex.source)}:${ex.bodyStartLine} → ${ex.fileName}`);
  }
  console.log('');

  writeBuildDir(examples, paths);
  const { code, output } = runTsc();

  const byFile = new Map(examples.map((e) => [e.fileName, e]));
  const diags = parseDiagnostics(output);

  if (code === 0 && diags.length === 0) {
    console.log(`✅ ${examples.length} prose examples type-check against @objectstack/spec`);
    if (!KEEP) fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    return;
  }

  // Remap every diagnostic back to the source page:<real line> so the author
  // reads the error against the file they actually edit, not the throwaway copy.
  console.error(`\n✗ Prose TypeScript examples do not compile against @objectstack/spec:\n`);
  const grouped = new Map<string, string[]>();
  for (const d of diags) {
    const ex = byFile.get(d.file);
    const loc = ex ? `${rel(ex.source)}:${ex.bodyStartLine + d.line - 1}:${d.col}` : d.file;
    const key = ex ? rel(ex.source) : d.file;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(`  ${loc}\n      ${d.text}`);
  }
  for (const [, entries] of grouped) {
    for (const e of entries) console.error(e);
  }

  // A non-zero exit with no parseable diagnostics (e.g. a tsconfig error) must
  // still surface — print the raw tail so it is never a silent failure.
  if (diags.length === 0) {
    console.error(`\n  tsc exited ${code} but produced no parseable diagnostics. Raw output:\n`);
    console.error(output.split('\n').map((l) => `    ${l}`).join('\n'));
  }

  console.error(
    `\n  These are examples an AI copies verbatim. Fix the example to match the\n` +
      `  current spec, or drop its os:check marker if it is an intentional fragment.\n`,
  );
  if (!KEEP) fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  process.exit(1);
}

main();
