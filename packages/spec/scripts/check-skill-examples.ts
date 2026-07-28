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
 * Usage:
 *   tsx scripts/check-skill-examples.ts            # extract + type-check (CI)
 *   tsx scripts/check-skill-examples.ts --keep     # also leave the build dir for inspection
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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

function main() {
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
