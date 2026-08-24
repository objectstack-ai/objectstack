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
 * #10924's sweep of `packages/spec/src` re-measured both traps on a fresh
 * corpus and is worth recording, because the numbers argue the design: 146
 * fenced ts blocks, of which 128 carry no import of their own (fragments by
 * construction — a `columns: [...]` subtree, a `case 'in':` excerpt of a
 * consumer's switch). Of the 18 self-contained ones, trap 1 fired immediately:
 * three are ellipsis-placeholder prose (`defineStack({ ... })`, `{ ... }` in
 * argument position) whose TS1109 syntax errors suppressed the semantic pass
 * for the entire program — the first run reported 15 "clean" blocks that had
 * simply never been type-checked. Excluding those three and re-running turned
 * six of the remaining fifteen red on real semantics. So: mark deliberately,
 * and never read a run containing TS1xxx codes as evidence about rot.
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
 * ── SURFACES (#10969) ─────────────────────────────────────────────────────
 * Until #10969 the only prose scanned was `skills/**` + `content/docs/**`, and
 * the only thing marked blocks were checked against was `@objectstack/spec`.
 * TSDoc `@example` blocks inside `packages/client-react/src` and
 * `packages/client/src` — the SDK's own hand-written docs, not generated
 * prose — carried the identical unguarded-rot shape (#10750 found two: the
 * copied `useQuery`/`usePagination` examples read `data?.value`, a key
 * `PaginatedResult` never declared).
 *
 * Rather than a second extractor, the file/marker/tsc pipeline is now
 * SURFACE-parameterised (`SURFACES` below): each surface names its own
 * prose roots, its own throwaway build dir (which package's `node_modules`
 * a bare specifier like `react` or the surface's own package name resolves
 * against), and its own package(s) to derive a `paths` map from. Adding a
 * surface is a new `SURFACES` entry, not a fork — #10924's
 * `packages/spec/src/**` TSDoc channel was the next candidate and landed as
 * exactly that: one root, one surface entry, zero new extraction code.
 *
 * TWO differences from the original skills/docs surface, both load-bearing:
 *
 *   1. **The marker lives inside a JSDoc block comment**, not free-standing
 *      prose, so every source line carries a leading JSDoc gutter (` * `).
 *      A root flagged `commentPrefixed: true` has that gutter stripped —
 *      from the fence-open/close lines, the marker line, AND the block
 *      body — before any of the existing regexes see it; see
 *      `logicalLines()`. This also means the MDX root's curly-brace-wrapped
 *      marker spelling cannot be reused verbatim here: written out it ENDS
 *      in the two characters star then slash, and a block comment is
 *      terminated by the first such pair it contains — that spelling would
 *      close the JSDoc comment early and turn the rest of it (fence
 *      included) into a syntax error in the REAL source file, not just the
 *      throwaway copy. (This paragraph avoids spelling that pair out for
 *      the same reason.) `<!-- os:check -->` ends in no such pair, so it is
 *      reused as-is for this surface too; it also renders inert if a
 *      future TSDoc/TypeDoc pass ever treats `@example` prose as markdown.
 *   2. **The examples are `tsx`, not `ts`** — every one of the 19 blocks
 *      this surface adds is fenced ` ```tsx ` (React components), and the
 *      original fence-language regex matched only `ts`/`typescript`. A
 *      marker placed above a `tsx` fence would previously have been a
 *      silent no-op — no orphan, no extraction, nothing — because the
 *      `open` regex never matched, so the FIRST check this file makes of
 *      the tsx corpus is with `tsx` finally recognised as a fence language
 *      (`FENCE_OPEN_RE`), and the block is written out with a matching
 *      `.tsx` build-file extension so JSX syntax is legal in it at all.
 *
 * Module resolution for the client surface is NOT `paths`-only like spec's:
 * `@objectstack/client-react`'s examples need `react`'s real types, which
 * live in ITS OWN `node_modules` (pnpm does not hoist them to the repo
 * root — measured, not assumed), so that surface's throwaway build dir is
 * created INSIDE `packages/client-react/` rather than beside `packages/spec`.
 * `@objectstack/client` resolves the same way through client-react's
 * workspace-linked `node_modules/@objectstack/client` symlink; each
 * surface's OWN package(s) still get an explicit `paths` self-entry
 * (`packagePaths()`, generalised from the old `specPaths()`) so a block can
 * `import { useQuery } from '@objectstack/client-react'` the same way a
 * real consumer would, rather than relying on a same-package self-import
 * trick that may or may not resolve.
 *
 * ── Fence-awareness in the orphan scan ────────────────────────────────────
 * The orphan-marker guard (`extractFromFile`) is fence-aware: a marker
 * spelling shown as example text INSIDE some other fenced block (e.g. a
 * ```md illustration showing what `<!-- os:check -->` looks like) is not
 * adjacent, at top level, to a real fence, so it claims nothing and must not
 * be reported as a misplaced marker either — otherwise this gate's own
 * convention could never be documented in the roots it governs. `fenceSpans()`
 * tracks every top-level fence of ANY language (lifted from the #10533
 * fence-awareness shape in `scripts/check-role-word.mjs`); a marker at true
 * top level that is merely not adjacent to its fence is unaffected and still
 * fails loudly.
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
const CLIENT_REACT_DIR = path.resolve(REPO_ROOT, 'packages/client-react');
const CLIENT_DIR = path.resolve(REPO_ROOT, 'packages/client');

/** A prose/source root: where to look, what to look for, how to read it. */
interface SourceRoot {
  dir: string;
  /** File extension(s) this root scans. A single string, or several for a
   *  root that spans more than one (unused today, kept for #10924). */
  ext: string | string[];
  label: string;
  marker: string;
  /** Absolute directories to skip entirely (existing: generated docs). */
  exclude?: string[];
  /** Skip individual files by basename — e.g. test files, which are not the
   *  documented SDK surface even though they share the source root's `ext`. */
  excludeFile?: (name: string) => boolean;
  /** True when this root's prose lives inside a JSDoc/TSDoc block comment
   *  rather than free-standing markdown — every line then carries a leading
   *  JSDoc gutter (` * `) that must be stripped before the fence/marker
   *  regexes, or the body, ever see it. See the header comment's "SURFACES"
   *  section for why the MDX root's wrapper marker form can't be reused
   *  verbatim here. */
  commentPrefixed?: boolean;
}

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
const SKILLS_DOCS_ROOTS: SourceRoot[] = [
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

/** `.test.ts(x)` / `.spec.ts(x)` files are not the documented SDK surface. */
const isTestFile = (name: string): boolean => /\.(test|spec)\.tsx?$/.test(name);

/**
 * `packages/spec/src` — the schema package's OWN TSDoc code blocks (#10924).
 *
 * This is the ADR-0033 authoring channel: a schema's `@example` sits inches
 * from the tombstone written for the same reader, and is the text an AI author
 * copies. Until this root landed nothing compiled it — `check:doc-formula-
 * expressions` walks the same `@example`s but judges *formula expressions*
 * with `@objectstack/formula`, never TypeScript — so an example could name a
 * retired key, a renamed export or a tightened union and stay green
 * indefinitely. The measured specimen: `AgentSchema`'s own `@example` wrote
 * `knowledge: { … }`, a key the same file declares `retiredKey()`
 * (`z.never()`), which surfaces as `undefined` in `z.input` and so fails
 * `tsc` with TS2322 — a compile-only gate catches this class with no runner.
 *
 * Same shape as the client SDK roots above (JSDoc gutter, `commentPrefixed`),
 * and opt-in for the same reason, only more so: of the 146 fenced ts blocks in
 * this root, 128 do not even carry their own imports, and among the 18 that do,
 * three are ellipsis-placeholder fragments (`defineStack({ ... })`) that are
 * correct as prose and can never compile. A blanket sweep here would misfire on
 * every one of them; the marker is what separates "this is a claim" from "this
 * illustrates".
 */
const SPEC_SRC_ROOTS: SourceRoot[] = [
  {
    dir: path.resolve(SPEC_DIR, 'src'),
    ext: '.ts',
    label: 'spec',
    marker: '<!-- os:check -->',
    commentPrefixed: true,
    excludeFile: isTestFile,
  },
];

/**
 * `packages/client-react/src` + `packages/client/src` — the SDK's own
 * hand-written TSDoc `@example` blocks (#10969). See the header comment's
 * "SURFACES" section for the two ways this root type differs from prose
 * markdown: the JSDoc comment gutter, and the `tsx` fence language.
 */
const CLIENT_SDK_ROOTS: SourceRoot[] = [
  {
    dir: path.resolve(CLIENT_REACT_DIR, 'src'),
    ext: '.tsx',
    label: 'client-react',
    marker: '<!-- os:check -->',
    commentPrefixed: true,
    excludeFile: isTestFile,
  },
  {
    dir: path.resolve(CLIENT_DIR, 'src'),
    ext: '.ts',
    label: 'client',
    marker: '<!-- os:check -->',
    commentPrefixed: true,
    excludeFile: isTestFile,
  },
];

/**
 * A surface groups prose/source roots that share ONE module-resolution
 * environment — one throwaway build dir (so a bare specifier resolves the
 * same way for every block written into it) and one `paths` map, derived
 * from each surface's own package(s) `exports`. See the header comment's
 * "SURFACES" section for why the client surface needs its own resolution
 * dir (react's real types) rather than reusing spec's.
 */
interface Surface {
  name: string;
  roots: SourceRoot[];
  /** Where the throwaway build dir + tsconfig.json live. Module resolution
   *  for bare specifiers (react, workspace packages) walks up from here. */
  resolutionDir: string;
  /** Basename of the throwaway build dir inside `resolutionDir`. Two surfaces
   *  MAY share a `resolutionDir` (spec's prose and its own source both resolve
   *  against `packages/spec`) — they must NOT share a build dir: `writeBuildDir`
   *  wipes it on entry, so the second surface would delete the first's blocks.
   *  Sequential execution hides that today, but `--keep` would silently retain
   *  only the last surface's dir. Defaults to `.examples-build`; every value
   *  needs a `.gitignore` entry — `assertDistinctBuildDirs()` enforces that no
   *  two surfaces collide, `assertGitignoredBuildDirs()` enforces that the
   *  entry actually exists (#11440). */
  buildDirName?: string;
  /** package.json dirs whose `exports` become explicit `paths` entries —
   *  what lets a block `import` its own surface's package by name. */
  selfPackages: string[];
}

/** @see Surface.buildDirName */
const DEFAULT_BUILD_DIR = '.examples-build';
const buildDirOf = (s: Surface): string => path.join(s.resolutionDir, s.buildDirName ?? DEFAULT_BUILD_DIR);

const SURFACES: Surface[] = [
  {
    name: 'skills + docs (@objectstack/spec)',
    roots: SKILLS_DOCS_ROOTS,
    resolutionDir: SPEC_DIR,
    selfPackages: [SPEC_DIR],
  },
  {
    name: 'spec source TSDoc (@objectstack/spec)',
    roots: SPEC_SRC_ROOTS,
    // Same package as the prose surface above, so the same resolution env —
    // but its OWN build dir (see `Surface.buildDirName`).
    resolutionDir: SPEC_DIR,
    buildDirName: '.examples-build-src',
    selfPackages: [SPEC_DIR],
  },
  {
    name: 'client SDK (@objectstack/client-react, @objectstack/client)',
    roots: CLIENT_SDK_ROOTS,
    // client-react's node_modules is the one with react's real types (pnpm
    // does not hoist them to the repo root) AND workspace-linked access to
    // @objectstack/client, so it is the resolution root for both files.
    resolutionDir: CLIENT_REACT_DIR,
    selfPackages: [CLIENT_REACT_DIR, CLIENT_DIR],
  },
];

/**
 * Every marker spelling, across every root of every surface. A block tagged
 * with the WRONG root's spelling would be silently unchecked (and, in
 * `.mdx`, would also break the docs build), so every form is recognised for
 * orphan detection and only a root's own form actually opts a block in.
 */
const ALL_MARKERS = Array.from(new Set(SURFACES.flatMap((s) => s.roots.map((r) => r.marker))));

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

/** Every candidate prose/source file across a surface's roots, with the root that owns it. */
function sourceFiles(roots: SourceRoot[]): Array<{ file: string; root: SourceRoot }> {
  const out: Array<{ file: string; root: SourceRoot }> = [];
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue;
    const exts = Array.isArray(root.ext) ? root.ext : [root.ext];
    const walk = (dir: string) => {
      if (root.exclude?.some((x) => dir === x || dir.startsWith(x + path.sep))) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (exts.some((ext) => e.name.endsWith(ext)) && !root.excludeFile?.(e.name)) {
          out.push({ file: full, root });
        }
      }
    };
    walk(root.dir);
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Flat, collision-free build-dir name for a block: `<root>__<path>__<n><ext>`.
 * Path separators become `_` so two pages of the same basename in different
 * folders (`ui/actions.mdx`, `protocol/objectui/actions.mdx`) cannot collide.
 *
 * `buildExt` is the FENCE's language (`.tsx` for a ` ```tsx ` block, `.ts`
 * otherwise), not the source root's own extension — a `.tsx` source file can
 * still fence a plain `.ts` example, and JSX syntax is only legal in a file
 * TypeScript treats as `.tsx`, so the two must be allowed to differ.
 */
function buildFileName(source: string, root: SourceRoot, n: number, buildExt: '.ts' | '.tsx'): string {
  const exts = Array.isArray(root.ext) ? root.ext : [root.ext];
  let relPath = path.relative(root.dir, source);
  for (const ext of exts) {
    if (relPath.endsWith(ext)) {
      relPath = relPath.slice(0, -ext.length);
      break;
    }
  }
  return `${root.label}__${relPath.split(path.sep).join('_')}__${n}${buildExt}`;
}

/** Fence languages this gate recognises as TypeScript. `tsx` matters only for
 *  `commentPrefixed` roots today — every #10969 block is a React component —
 *  but is recognised for every root so a marker over a markdown `tsx` fence
 *  (several already exist, unmarked, in skills/docs) is no longer a silent
 *  no-op the day someone marks one. */
const FENCE_OPEN_RE = /^```(ts|tsx|typescript)\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
/** The JSDoc continuation gutter: optional leading whitespace, one `*`, at
 *  most one following space. Strips ` *   const x = 1;` → `  const x = 1;`
 *  (indentation beyond the gutter is real code indentation and is kept). */
const JSDOC_GUTTER_RE = /^\s*\*\s?/;

/**
 * ANY CommonMark-shaped opening code fence — every language, not just the
 * ts/tsx/typescript ones `FENCE_OPEN_RE` recognises for compilation: up to
 * three spaces of indent, a run of three or more backticks, and an info
 * string that cannot itself contain a backtick. Lifted from the #10533
 * fence-awareness shape in `scripts/check-role-word.mjs`.
 */
const ANY_FENCE_OPEN_RE = /^ {0,3}(`{3,})([^`]*)$/;

/**
 * Every line index that lies INSIDE some top-level fenced block — of ANY
 * language, spanning both its opening and closing fence line. This gate's own
 * `os:check` convention has to be documentable in the very roots it governs
 * (e.g. a ```` ```md ```` illustration showing the marker's exact spelling),
 * and a marker shown as example text inside such a fence claims nothing — it
 * is not adjacent to a real fence the author intends to check, so it must not
 * be flagged as a misplaced (orphan) marker either. The closing run length
 * must match or exceed the opener's (a `````` fence wrapping a ```ts example
 * closes on ITS OWN fence, not the inner one), and an unclosed fence runs to
 * the end of the document (CommonMark), so it consumes the rest of the file
 * rather than leaving the tail ambiguous.
 */
function fenceSpans(lines: string[]): boolean[] {
  const inFence = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    const open = ANY_FENCE_OPEN_RE.exec(lines[i]);
    if (!open) continue;
    const run = open[1].length;
    const closeFence = new RegExp(`^ {0,3}\`{${run},}[ \\t]*$`);
    let end = i + 1;
    while (end < lines.length && !closeFence.test(lines[end])) end++;
    for (let s = i; s < Math.min(end + 1, lines.length); s++) inFence[s] = true;
    i = end;
  }
  return inFence;
}

/**
 * The lines a root's regexes actually match against. Identical to the raw
 * file lines for markdown roots; for a `commentPrefixed` root, the JSDoc
 * gutter is stripped from every line first — so a marker, a fence, and a
 * block's body all read the same whether they came from a `.md` file or a
 * JSDoc-wrapped `@example` in `.tsx` source (see the header comment's
 * "SURFACES" section for why the wrapper marker forms can't be reused
 * verbatim, and why that comment itself avoids the very sequence being
 * described here).
 */
function logicalLines(rawLines: string[], root: SourceRoot): string[] {
  return root.commentPrefixed ? rawLines.map((l) => l.replace(JSDOC_GUTTER_RE, '')) : rawLines;
}

/**
 * Pull every marked ```ts / ```tsx / ```typescript block out of one prose or
 * source file. A block is marked when the line immediately above its opening
 * fence is exactly the MARKER (ignoring surrounding whitespace) — after
 * gutter-stripping, for a `commentPrefixed` root.
 *
 * Also reports `orphans`: top-level MARKER lines that are NOT directly above
 * a ts fence. A misplaced marker (a blank line slipped in between, or it
 * precedes a bash / json block) silently checks nothing — exactly the
 * failure mode this gate exists to prevent — so the caller treats an orphan
 * as an error, not a no-op. A marker occurrence INSIDE some other fenced
 * block (`fenceSpans()`) is example text illustrating the convention, not a
 * claim, and is excluded from this scan for the same reason it is excluded
 * from extraction above: it is not adjacent, at top level, to a real fence.
 */
function extractFromFile(source: string, root: SourceRoot): { examples: Example[]; orphans: number[] } {
  const rawLines = fs.readFileSync(source, 'utf-8').split('\n');
  const lines = logicalLines(rawLines, root);
  const examples: Example[] = [];
  const claimed = new Set<number>(); // MARKER line indices that opened a real block
  let n = 0;

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE_OPEN_RE);
    if (!open) continue;
    const marked = i > 0 && lines[i - 1].trim() === root.marker;
    // Find the matching close fence regardless of marking, so `i` advances past
    // this block and we never treat its body as top-level markdown.
    let close = i + 1;
    while (close < lines.length && !FENCE_CLOSE_RE.test(lines[close])) close++;
    if (marked) {
      claimed.add(i - 1);
      const body = lines.slice(i + 1, close);
      n += 1;
      examples.push({
        source,
        bodyStartLine: i + 2, // 1-based line of body[0]
        code: body.join('\n'),
        fileName: buildFileName(source, root, n, open[1] === 'tsx' ? '.tsx' : '.ts'),
      });
    }
    i = close; // skip to the close fence
  }

  const inFence = fenceSpans(lines);
  const orphans: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Top level only. A marker shown INSIDE some other fenced block (e.g. a
    // ```md illustration of this very convention) is example text, not a
    // claim — see `fenceSpans()`.
    if (inFence[i]) continue;
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
  // `.tsx` MUST parse as TSX, not TS (#10969): under ScriptKind.TS, `<Foo>` at
  // an expression position is an old-style type-assertion prefix, not JSX —
  // so a React example's `<div>…</div>` mis-parses into a cascade of syntax
  // nodes this walker was never designed to see. `createSourceFile` degrades
  // silently on that (never throws), which would make this guard exactly the
  // kind of dormant checker its own docblock above warns about: not wrong
  // NOISILY, just quietly not looking at what it claims to.
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2020, /* setParentNodes */ true, scriptKind);
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

// ── Module resolution derived from each surface's own package `exports` ──────

/**
 * `package.json#exports` condition objects come in two shapes across this
 * monorepo, measured rather than assumed (#10969): spec nests `types` one
 * level down per condition (`{ import: { types, default }, require: {…} }`,
 * to carry a `browser` variant too) — client-react's and client's `exports`
 * are FLAT (`{ types, import, require }`, `types` a sibling of the
 * conditions, not nested under either). Both are legal `package.json`
 * shapes; a resolver written against only the nested one silently resolves
 * every flat-shaped package to `undefined` — no error, just an empty
 * `paths` map, which is indistinguishable from "package not built" three
 * lines later. `resolveTypes()` reads either.
 */
interface ExportEntry {
  types?: string;
  import?: { types?: string };
  require?: { types?: string };
}

/** The declared `.d.ts` for one export condition object, flat or nested shape alike. */
function resolveTypes(entry: ExportEntry | string): string | undefined {
  if (typeof entry === 'string') return entry;
  return entry.types ?? entry.require?.types ?? entry.import?.types;
}

/**
 * Build a tsconfig `paths` map from ONE package's own published `exports`,
 * pointing each specifier at its built `.d.ts` — generalised from the
 * original `specPaths()` (#10969) so a surface can self-import ITS OWN
 * package the same way `@objectstack/spec`'s examples always have, whether
 * that package is spec, client-react, or client. Deriving it from the real
 * exports means a new subpath export (or a removed one) is reflected here for
 * free — the map cannot drift from what consumers actually resolve.
 *
 * Returns the map plus the list of declaration files that must exist; a missing
 * root declaration means the package was not built (or built with OS_SKIP_DTS),
 * and the caller fails loudly rather than checking against a stale/absent surface.
 */
function packagePaths(pkgDir: string): { paths: Record<string, string[]>; missing: string[] } {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(pkgDir, 'package.json'), 'utf-8'));
  const exportsMap = (pkg.exports ?? {}) as Record<string, ExportEntry | string>;
  const paths: Record<string, string[]> = {};
  const missing: string[] = [];

  for (const [key, entry] of Object.entries(exportsMap)) {
    const types = resolveTypes(entry);
    if (!types || !types.endsWith('.d.ts')) continue; // skip non-type conditions (css, etc.)
    const specifier = key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`;
    const abs = path.resolve(pkgDir, types);
    paths[specifier] = [abs];
    if (!fs.existsSync(abs)) missing.push(rel(abs));
  }
  return { paths, missing };
}

/** `packagePaths()` merged across every self-package a surface declares. */
function surfacePaths(pkgDirs: string[]): { paths: Record<string, string[]>; missing: string[] } {
  const paths: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const dir of pkgDirs) {
    const r = packagePaths(dir);
    Object.assign(paths, r.paths);
    missing.push(...r.missing);
  }
  return { paths, missing };
}

// ── tsc harness ──────────────────────────────────────────────────────────────

function writeBuildDir(buildDir: string, examples: Example[], paths: Record<string, string[]>): void {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  for (const ex of examples) {
    // Written verbatim (no prepended wrapper) so a tsc line N maps to source
    // line (bodyStartLine + N - 1) with zero arithmetic guesswork. A block with
    // no import/export is a script, not a module; append `export {}` so two such
    // files can't collide on a global — appended at the end, it never shifts the
    // line of any real diagnostic.
    const isModule = /^\s*(import|export)\b/m.test(ex.code);
    fs.writeFileSync(
      path.join(buildDir, ex.fileName),
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
      // React examples (#10969) need JSX; harmless for plain-`.ts` surfaces —
      // a `.ts` file cannot contain JSX syntax regardless of this option, so
      // one shared profile covers every surface without branching on it.
      jsx: 'react-jsx',
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
    include: ['*.ts', '*.tsx'],
  };
  fs.writeFileSync(
    path.join(buildDir, 'tsconfig.json'),
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

function runTsc(buildDir: string): { code: number; output: string } {
  const tscBin = require.resolve('typescript/bin/tsc');
  const res = spawnSync(
    process.execPath,
    [tscBin, '--noEmit', '--pretty', 'false', '-p', path.join(buildDir, 'tsconfig.json')],
    { cwd: buildDir, encoding: 'utf-8' },
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

    // ── commentPrefixed roots (#10969): the JSDoc-gutter-stripping and
    //    tsx-fence-language logic the client SDK surface depends on. Every
    //    check above exercises free-standing markdown; nothing above would
    //    catch the gutter stripping being dormant (every real `.tsx` fixture
    //    line starts with ` * `, so a regex that forgot to strip it would
    //    simply never match a fence-open line and would silently extract
    //    ZERO blocks — the exact failure mode the vacuous-green guard in
    //    `main()` exists to catch, but only once a REAL corpus is at stake). ──
    const tsxRoot: SourceRoot = {
      dir,
      ext: '.tsx',
      label: 'client-react',
      marker: '<!-- os:check -->',
      commentPrefixed: true,
    };

    // RED: a `.tsx` file, JSDoc-wrapped, fenced ```tsx (not ```ts — #10969's
    // whole corpus is tsx), with the block body written the way a real
    // source file's Prettier-formatted docblock writes it: every line
    // prefixed ` * `, including a blank continuation line as bare ` *`.
    const redHook = path.join(dir, 'red-hook.tsx');
    fs.writeFileSync(
      redHook,
      [
        '// Copyright', // 1
        '', // 2
        '/**', // 3
        ' * Hook for querying data', // 4
        ' *', // 5
        ' * <!-- os:check -->', // 6
        ' * ```tsx', // 7
        ' * function TaskList() {', // 8
        ' *   const ctx: any = useQuery();', // 9  ← the defect, gutter still on
        ' *   return <div>{ctx}</div>;', // 10
        ' * }', // 11
        ' * ```', // 12
        ' */', // 13
        'export function useQuery() {}', // 14
      ].join('\n'),
      'utf8',
    );
    const redTsx = extractFromFile(redHook, tsxRoot);
    check(
      redTsx.examples.length === 1,
      `tsx fixture: extracted ${redTsx.examples.length} block(s), expected 1 — gutter-stripped fence detection is DORMANT`,
    );
    check(redTsx.orphans.length === 0, `tsx fixture: reported ${redTsx.orphans.length} orphan marker(s), expected 0`);
    if (redTsx.examples.length === 1) {
      const ex = redTsx.examples[0];
      check(
        !ex.code.includes(' * ') && !ex.code.startsWith('*'),
        `tsx fixture: extracted body still carries a JSDoc gutter — ${JSON.stringify(ex.code.split('\n')[0])}`,
      );
      check(
        ex.fileName.endsWith('.tsx'),
        `tsx fixture: build file name "${ex.fileName}" does not end in .tsx — a \`\`\`tsx fence must build as tsx, not ts, or JSX in the body is a syntax error`,
      );
      const hits = findBareAny(ex.code, ex.fileName);
      check(hits.length === 1, `tsx fixture: found ${hits.length} bare \`any\`, expected 1 — the guard is DORMANT on tsx`);
      if (hits.length === 1) {
        const pageLine = ex.bodyStartLine + hits[0].line - 1;
        check(pageLine === 9, `tsx fixture: reported page line ${pageLine}, expected 9`);
      }
    }

    // RED: a marker present but NOT directly above a fence (a blank JSDoc
    // continuation line — ` *` — sits between them) must still be caught as
    // an orphan once its gutter is stripped, not silently ignored because
    // the raw line (`" *   <!-- os:check -->"`... ) never equals the raw
    // marker text.
    const orphanHook = path.join(dir, 'orphan-hook.tsx');
    fs.writeFileSync(
      orphanHook,
      [
        '/**', // 1
        ' * <!-- os:check -->', // 2
        ' *', // 3  ← blank gutter line breaks marker/fence adjacency
        ' * ```tsx', // 4
        ' * const x = 1;', // 5
        ' * ```', // 6
        ' */', // 7
      ].join('\n'),
      'utf8',
    );
    const orphanTsx = extractFromFile(orphanHook, tsxRoot);
    check(
      orphanTsx.examples.length === 0,
      `orphan fixture: extracted ${orphanTsx.examples.length} block(s), expected 0 — the marker is not adjacent to the fence`,
    );
    check(
      orphanTsx.orphans.length === 1,
      `orphan fixture: reported ${orphanTsx.orphans.length} orphan marker(s), expected 1 — a misplaced gutter-wrapped ` +
        `marker must not be silently ignored`,
    );

    // ── commentPrefixed + a ```ts fence (#10924's spec-source surface). The
    //    tsx fixture above pins gutter-stripping against a ```tsx fence; this
    //    root is the other combination — a `.ts` source file whose docblock
    //    fences plain ```ts — and it is the one #10924's entire corpus uses.
    //    Without this, a regression that recognised a gutter-wrapped fence
    //    ONLY when its language was `tsx` would leave the whole spec-source
    //    surface extracting zero blocks, and the per-surface vacuous-green
    //    guard in `main()` is the only thing that would notice — a hard error
    //    a long way from its cause. Also pins that a marker sitting between
    //    `@example` and the fence still counts as adjacent: that is where
    //    every marker in the real spec corpus lives.
    const specSrcRoot: SourceRoot = {
      dir,
      ext: '.ts',
      label: 'spec',
      marker: '<!-- os:check -->',
      commentPrefixed: true,
      excludeFile: isTestFile,
    };
    const specSrc = path.join(dir, 'schema.zod.ts');
    fs.writeFileSync(
      specSrc,
      [
        '// Copyright', //                                                  1
        '', //                                                              2
        '/**', //                                                           3
        ' * A schema with a documented example.', //                        4
        ' *', //                                                            5
        ' * @example', //                                                   6
        ' * <!-- os:check -->', //                                          7
        ' * ```ts', //                                                      8
        " * import { defineSkill } from '@objectstack/spec';", //           9
        ' *', //                                                           10
        " * const skill = defineSkill({ name: 'a' });", //                  11
        ' * ```', //                                                       12
        ' */', //                                                          13
        'export const SchemaLike = 1;', //                                 14
      ].join('\n'),
      'utf8',
    );
    const specExtract = extractFromFile(specSrc, specSrcRoot);
    check(
      specExtract.examples.length === 1,
      `spec-source fixture: extracted ${specExtract.examples.length} block(s), expected 1 — a gutter-wrapped ` +
        '```ts fence is DORMANT, and every block in the spec-source corpus is exactly that shape',
    );
    check(
      specExtract.orphans.length === 0,
      `spec-source fixture: reported ${specExtract.orphans.length} orphan marker(s), expected 0 — a marker on the ` +
        'line between `@example` and its fence IS adjacent',
    );
    if (specExtract.examples.length === 1) {
      const ex = specExtract.examples[0];
      check(
        ex.fileName.endsWith('.ts') && !ex.fileName.endsWith('.tsx'),
        `spec-source fixture: build file name "${ex.fileName}" should end in .ts for a \`\`\`ts fence`,
      );
      check(
        ex.code.split('\n')[0] === "import { defineSkill } from '@objectstack/spec';",
        `spec-source fixture: extracted body still carries a JSDoc gutter — ${JSON.stringify(ex.code.split('\n')[0])}`,
      );
      // body[0] is source line 9; `bodyStartLine` is what every diagnostic is
      // remapped through, and an off-by-one here points authors at prose.
      check(
        ex.bodyStartLine === 9,
        `spec-source fixture: bodyStartLine ${ex.bodyStartLine}, expected 9 — diagnostics would point at the wrong line`,
      );
    }
    // A `.test.ts` sibling must be skipped by `excludeFile` even when it
    // carries a perfectly good marked block: test fixtures are not the
    // documented surface, and extracting them would type-check assertions.
    const specTest = path.join(dir, 'schema.test.ts');
    fs.writeFileSync(specTest, ['/**', ' * <!-- os:check -->', ' * ```ts', ' * const x = 1;', ' * ```', ' */'].join('\n'), 'utf8');
    check(
      sourceFiles([specSrcRoot]).every((f) => f.file !== specTest),
      'spec-source fixture: a `.test.ts` file was scanned — `excludeFile` is not applied to this root',
    );

    // ── Fence-awareness (fenceSpans): the os:check convention has to be
    //    documentable in the very roots it governs. A marker shown as example
    //    text INSIDE some other fenced block (here a ```md illustration of
    //    the marker's exact spelling) must not be reported as an orphan —
    //    but a REAL misplaced marker at top level (not inside any fence,
    //    just not adjacent to its fence) must still be an error: this gate's
    //    hard-error posture must not weaken. Both live in one fixture so a
    //    fix that over-widens the exemption (e.g. treating every marker as
    //    "documented") is caught by the same run that proves the narrow case.
    const fenceFixture = path.join(dir, 'fence-aware.md');
    fs.writeFileSync(
      fenceFixture,
      [
        '# Fence-awareness fixture', // 1
        '', // 2
        'Documenting the marker syntax itself, inside a wrapping fence:', // 3
        '', // 4
        '```md', // 5
        '<!-- os:check -->', // 6  ← INSIDE the fence: example text, not a claim
        '```', // 7
        '', // 8
        'A genuine misplaced marker (blank line breaks adjacency) must still fail:', // 9
        '', // 10
        '<!-- os:check -->', // 11 ← top-level, but NOT adjacent to the fence below
        '', // 12
        '```ts', // 13
        'const x = 1;', // 14
        '```', // 15
        '',
      ].join('\n'),
      'utf8',
    );
    const fenceAware = extractFromFile(fenceFixture, skillsRoot);
    check(
      fenceAware.examples.length === 0,
      `fence-awareness fixture: extracted ${fenceAware.examples.length} block(s), expected 0 — neither marker is ` +
        `adjacent to a real ts fence`,
    );
    check(
      JSON.stringify(fenceAware.orphans) === JSON.stringify([11]),
      `fence-awareness fixture: reported orphan line(s) ${JSON.stringify(fenceAware.orphans)}, expected [11] — line 6 ` +
        "(inside the ```md fence) must NOT be an orphan, and line 11 (a genuine top-level misplaced marker) must " +
        'STILL be one — a false orphan there is exactly the defect that makes this convention undocumentable, and a ' +
        "silenced real orphan would weaken the gate's hard-error posture",
    );

    // ── Build-dir distinctness (#10924). The REAL surfaces are asserted on
    //    every run by `assertDistinctBuildDirs()`; these two fixtures pin the
    //    predicate underneath it in both directions, because a guard that can
    //    only ever return null is indistinguishable from a correct config —
    //    the dormant-checker failure this file's own docblocks keep naming.
    const surfaceStub = (name: string, resolutionDir: string, buildDirName?: string): Surface => ({
      name,
      roots: [],
      resolutionDir,
      buildDirName,
      selfPackages: [],
    });
    check(
      findDuplicateBuildDir(SURFACES) === null,
      'build-dir fixture: the REAL surfaces share a build dir — one of them would wipe the other',
    );
    const clash = findDuplicateBuildDir([
      surfaceStub('alpha', SPEC_DIR),
      surfaceStub('beta', SPEC_DIR), // same resolutionDir, both defaulting
    ]);
    check(
      clash !== null && clash.first === 'alpha' && clash.second === 'beta',
      `build-dir fixture: two surfaces defaulting into one resolution dir were NOT reported (got ${JSON.stringify(clash)}) ` +
        '— that is the collision the guard exists to catch',
    );
    check(
      findDuplicateBuildDir([
        surfaceStub('alpha', SPEC_DIR),
        surfaceStub('beta', SPEC_DIR, '.examples-build-src'),
      ]) === null,
      'build-dir fixture: a distinct `buildDirName` on a shared resolution dir was reported as a clash — ' +
        'sharing a resolution dir is legitimate and must stay legal',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── Gitignore coverage (#11440). `assertGitignoredBuildDirs()` runs against
  //    the REAL repo on every invocation (pinned below, over the true
  //    SURFACES/REPO_ROOT); this fixture pins the predicate underneath it —
  //    `isGitIgnored` / `findUnignoredBuildDir` — against a throwaway git repo,
  //    in both directions. Same "a guard that can only ever return null is
  //    indistinguishable from a correct config" reasoning as the build-dir-
  //    distinctness fixture just above: without the negative case, a detector
  //    that always reports "ignored" would pass every run silently.
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-examples-gitignore-selftest-'));
  try {
    // Local copy: the build-dir-distinctness fixture's `surfaceStub` above is
    // scoped to its own `try` block and does not reach here.
    const surfaceStub = (name: string, resolutionDir: string, buildDirName?: string): Surface => ({
      name,
      roots: [],
      resolutionDir,
      buildDirName,
      selfPackages: [],
    });
    spawnSync('git', ['init', '-q'], { cwd: gitDir });
    fs.writeFileSync(path.join(gitDir, '.gitignore'), '.examples-build/\n', 'utf8');
    const ignoredSurface = surfaceStub('ignored-surface', gitDir); // default build dir: .examples-build
    const unignoredSurface = surfaceStub('unignored-surface', gitDir, '.examples-build-uncovered');

    check(
      isGitIgnored(buildDirOf(ignoredSurface), gitDir) === true,
      'gitignore fixture: a build dir covered by .gitignore was reported as NOT ignored',
    );
    check(
      isGitIgnored(buildDirOf(unignoredSurface), gitDir) === false,
      'gitignore fixture: a build dir with NO .gitignore coverage was reported as ignored',
    );
    check(
      findUnignoredBuildDir([ignoredSurface], gitDir) === null,
      'gitignore fixture: a fully-covered surface list was reported as having an unignored dir',
    );
    const gap = findUnignoredBuildDir([ignoredSurface, unignoredSurface], gitDir);
    check(
      gap !== null && gap.name === 'unignored-surface',
      `gitignore fixture: the unignored surface was NOT flagged (got ${JSON.stringify(gap)}) — this is the ` +
        'exact defect #11440 describes: the gap is invisible on a clean run and only a dedicated assert catches it',
    );

    // The real-repo check `assertGitignoredBuildDirs()` runs unconditionally in
    // `main()`: reverse-verified by running this self-test against origin/main
    // BEFORE the `.gitignore` fix landed, where it failed naming exactly
    // "client SDK (@objectstack/client-react, @objectstack/client)".
    check(
      findUnignoredBuildDir(SURFACES) === null,
      'gitignore fixture: a REAL surface build dir is not covered by .gitignore — see assertGitignoredBuildDirs()',
    );
  } finally {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }

  // ── Non-git-repo indeterminacy (#11440, caught by the real test suite, not
  //    this file). `dist-freshness-adoption.test.ts` runs this SAME script
  //    against a "repo-shaped" temp tree that is deliberately NOT a real git
  //    checkout (its own header explains why: making the real
  //    `packages/spec/dist` stale would corrupt whatever else is running in
  //    the container). `git check-ignore` there exits 128 ("fatal: not a git
  //    repository"), and a FIRST version of `isGitIgnored` read any non-zero
  //    status as "not ignored" — which made `assertGitignoredBuildDirs()` fail
  //    first in every one of that file's cases, ahead of the dist-freshness
  //    refusal they exist to probe. This fixture pins the fix directly: a
  //    non-git `cwd` must read as INDETERMINATE (`null`), never as a gap.
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-examples-nongit-selftest-'));
  try {
    check(
      isGitIgnored(path.join(nonGitDir, '.examples-build'), nonGitDir) === null,
      'non-git fixture: a cwd with no .git ancestor was reported as ignored/not-ignored rather than indeterminate — ' +
        'this is the exact defect that broke dist-freshness-adoption.test.ts, which runs this script against a ' +
        'deliberately non-git sandbox tree',
    );
    const surfaceStub = (name: string, resolutionDir: string): Surface => ({
      name,
      roots: [],
      resolutionDir,
      selfPackages: [],
    });
    check(
      findUnignoredBuildDir([surfaceStub('sandboxed', nonGitDir)], nonGitDir) === null,
      'non-git fixture: a surface resolved against a non-git tree was reported as an unignored gap — indeterminate ' +
        'must not be treated as a violation, or every sandboxed caller of this script fails on an assert that has ' +
        'nothing to do with what it is testing',
    );
  } finally {
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`✗ self-test: ${f}`);
    console.error(`\ncheck-skill-examples --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    '✅  self-test: flags a bare `any` parameter / variable / property / return / alias / cast in a\n' +
      '    marked block at the right page line, and flags nothing in an honestly typed one; a\n' +
      '    JSDoc-gutter-wrapped ```tsx block (client SDK surface) extracts, strips and maps lines\n' +
      '    identically, and a misplaced gutter-wrapped marker is still caught as an orphan; a marker\n' +
      '    shown as example text inside another fenced block is not an orphan, while a genuine\n' +
      '    top-level misplaced marker still is; a gutter-wrapped ```ts block (spec-source\n' +
      '    surface) extracts with the right build extension, body and line mapping, its\n' +
      '    `.test.ts` sibling is skipped, two surfaces sharing one build dir are caught, a\n' +
      '    surface whose build dir is not covered by .gitignore is caught too, and a non-git\n' +
      '    cwd reads as indeterminate rather than as a false violation.',
  );
  process.exit(0);
}

/**
 * No two surfaces may write into the same throwaway build dir.
 *
 * `writeBuildDir()` wipes its target on entry, so a shared dir means the
 * second surface deletes the first's extracted blocks. Sequential execution
 * makes that invisible today — each surface's `tsc` has already run by then —
 * which is exactly why it is asserted rather than left to be noticed: the
 * first symptom would be `--keep` retaining only the last surface's dir, and
 * the first *real* symptom would be a surface silently type-checking another
 * surface's blocks the day this loop is reordered or parallelised. Sharing a
 * `resolutionDir` is legitimate and stays legal (#10924's spec-source surface
 * resolves against `packages/spec` just as the prose surface does); sharing
 * the dir underneath it is not.
 */
function findDuplicateBuildDir(
  surfaces: Surface[],
): { dir: string; first: string; second: string } | null {
  const seen = new Map<string, string>();
  for (const surface of surfaces) {
    const dir = buildDirOf(surface);
    const first = seen.get(dir);
    if (first) return { dir, first, second: surface.name };
    seen.set(dir, surface.name);
  }
  return null;
}

function assertDistinctBuildDirs(): void {
  const clash = findDuplicateBuildDir(SURFACES);
  if (clash) {
    fail(
      `Surfaces "${clash.first}" and "${clash.second}" both use the build dir ${rel(clash.dir)}.\n\n` +
        `  A build dir is wiped when it is written, so the second surface would delete the\n` +
        `  first's extracted blocks. Give one of them a distinct \`buildDirName\` (and add it\n` +
        `  to .gitignore).`,
    );
  }
}

/**
 * Whether `dir` (an absolute path) is covered by `.gitignore`, judged from `cwd`
 * — or `null` when `cwd` is not inside a git working tree at all, in which case
 * the question has no answer rather than a negative one.
 *
 * Every real build dir uses a directory-only `.gitignore` pattern (a trailing
 * `/`), and git only matches those against a path it can see IS a directory —
 * either because the path exists on disk, or because the query itself carries
 * a trailing separator. A build dir is normally absent (this gate deletes it
 * on exit — that is the whole trap #11440 describes), so querying the bare
 * path reads every real surface as "not ignored" even when `.gitignore` is
 * correct: measured against all three surfaces in this file before adding the
 * trailing separator below.
 *
 * `git check-ignore -q` exits 0 when ignored, 1 when not, and — measured via
 * this file's OWN sandboxed tests (`dist-freshness-adoption.test.ts` copies
 * `scripts/` into a repo-SHAPED temp tree that is deliberately not a real git
 * checkout) — 128 with "fatal: not a git repository" when `cwd` isn't one.
 * Reading that 128 as "not ignored" is exactly the false-positive shape this
 * file's own docblocks warn about elsewhere: it fired the NEW assert first in
 * every one of that file's cases, ahead of the dist-freshness refusal they
 * exist to probe, and was caught by running the real test suite rather than
 * assumed clean from the self-test's own throwaway (and therefore real) git
 * repo. Any status other than 0 or 1 is therefore reported as indeterminate.
 */
function isGitIgnored(dir: string, cwd: string = REPO_ROOT): boolean | null {
  const res = spawnSync('git', ['check-ignore', '-q', `${dir}${path.sep}`], { cwd, encoding: 'utf-8' });
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  return null;
}

/**
 * The first surface whose build dir `.gitignore` DEFINITELY does not cover, or
 * null. "Definitely" excludes `isGitIgnored`'s `null` (indeterminate — `cwd` is
 * not a git working tree) as well as `true` (covered); only an authoritative
 * `false` counts as a gap, so this reports nothing at all outside a real repo.
 *
 * `assertDistinctBuildDirs` above stops two surfaces from wiping each other;
 * nothing stopped a THIRD kind of mistake — a surface whose build dir nobody
 * ever added to `.gitignore` at all. #10969 added the client SDK surface (its
 * `resolutionDir` is `packages/client-react`, not `packages/spec`, because it
 * needs react's real types) and its `.examples-build/` sat unignored for two
 * cards before anyone noticed: invisible on every clean run (this gate
 * deletes the dir on exit), and only surfaced by `--keep` or a run killed
 * mid-flight, at which point `git add -A` — routine in this repo — commits
 * the extracted blocks into whatever PR is open. This walks `SURFACES` so a
 * fourth surface gets the same check for free, the same reasoning
 * `assertDistinctBuildDirs` already applies one class over.
 */
function findUnignoredBuildDir(surfaces: Surface[], cwd: string = REPO_ROOT): { dir: string; name: string } | null {
  for (const surface of surfaces) {
    const dir = buildDirOf(surface);
    if (isGitIgnored(dir, cwd) === false) return { dir, name: surface.name };
  }
  return null;
}

function assertGitignoredBuildDirs(): void {
  const gap = findUnignoredBuildDir(SURFACES);
  if (gap) {
    fail(
      `Surface "${gap.name}"'s build dir ${rel(gap.dir)} is not covered by .gitignore.\n\n` +
        `  This gate deletes the dir on a clean run, so the gap is invisible until \`--keep\`\n` +
        `  or an interrupted run leaves it behind — at which point a routine \`git add -A\`\n` +
        `  commits the extracted blocks into someone's PR. Add \`${rel(gap.dir)}/\` to .gitignore.`,
    );
  }
}

/** A package.json's own `name` field — used to look its self-entry up in the
 *  `paths` map `surfacePaths()` derived from it. */
function pkgName(pkgDir: string): string {
  return JSON.parse(fs.readFileSync(path.resolve(pkgDir, 'package.json'), 'utf-8')).name as string;
}

function main() {
  if (SELF_TEST) selfTest();

  assertDistinctBuildDirs();
  assertGitignoredBuildDirs();

  console.log(`🧪 Type-checking prose TypeScript examples (${SURFACES.map((s) => s.name).join(' · ')})...\n`);

  const bySurface = SURFACES.map((surface) => {
    const examples: Example[] = [];
    const orphans: string[] = [];
    for (const { file, root } of sourceFiles(surface.roots)) {
      const { examples: found, orphans: bad } = extractFromFile(file, root);
      examples.push(...found);
      for (const line of bad) orphans.push(`${rel(file)}:${line}`);
    }
    return { surface, examples, orphans };
  });

  // A marker that is not directly above a ```ts/```tsx fence checks nothing.
  // Fail loudly rather than let it read as covered — a placed-but-inert
  // marker is worse than no marker, because it looks intentional. Checked
  // across every surface up front, before any surface's zero-block or
  // compile verdict, so a misplaced marker is never masked by an unrelated
  // surface's failure.
  const allOrphans = bySurface.flatMap((s) => s.orphans);
  if (allOrphans.length > 0) {
    fail(
      `Found an os:check marker not directly above a \`\`\`ts / \`\`\`tsx / \`\`\`typescript fence\n` +
        `(or written in the wrong comment syntax for its file type — inside a JSDoc block\n` +
        `comment a blank gutter line between the marker and the fence breaks adjacency too):\n\n` +
        allOrphans.map((o) => `  - ${o}`).join('\n') +
        `\n\n  The marker must be the line IMMEDIATELY above the code fence (no blank\n` +
        `  line between). Move it, or remove it if the block should not be checked.`,
    );
  }

  // Vacuous-green guard, PER SURFACE (#10969 strengthens this from a single
  // global total): opt-in tagging means "zero blocks on this surface" is far
  // more likely to be "the marker got renamed / stripped on just this
  // surface" than "no examples worth checking" — and a global total would
  // hide exactly that behind a healthy count from an unrelated surface. Each
  // surface must independently prove it found something.
  for (const { surface, examples } of bySurface) {
    if (examples.length === 0) {
      fail(
        `No marked examples found for surface "${surface.name}".\n\n` +
          `  Mark a self-contained, compilable block by putting\n\n` +
          surface.roots
            .map((r) => `    ${r.marker}   (in ${rel(r.dir)}/**/*${Array.isArray(r.ext) ? r.ext.join('|') : r.ext})`)
            .join('\n') +
          `\n\n  on the line directly above its \`\`\`ts / \`\`\`tsx fence.\n` +
          `  (If you just removed the last marker on this surface, that is almost certainly a mistake.)`,
      );
    }
  }

  const allExamples = bySurface.flatMap((s) => s.examples);

  // Third anti-idle assertion (#5943): a marked block that annotates anything
  // `any` compiles by definition and proves nothing about it. Runs BEFORE any
  // build dir is written, so the author reads one crisp verdict instead of a
  // clean `tsc` run that silently covered nothing. Across every surface —
  // the defect this closes (#5720, #5605) is not surface-specific.
  const anyHits: string[] = [];
  for (const ex of allExamples) {
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
        `    1. Annotate the real type (import it from the surface's own package) — that is\n` +
        `       the whole point of marking the block, and it is what catches the drift:\n` +
        `       \`(ctx: any)\` hid a hook example reading a \`ctx.services\` that no hook\n` +
        `       context has (#5720), and a \`ctx.session?.positions\` before it (#5605).\n` +
        `    2. Remove the os:check marker if the block is an illustrative fragment\n` +
        `       that cannot be typed against the real declarations (generated third-party\n` +
        `       code, a partial subtree). An unmarked block is honest; a marked \`any\` is not.\n\n` +
        `  Nested \`any\` (\`Record<string, any>\`, \`any[]\`, \`Promise<any>\`) is NOT flagged\n` +
        `  — only an annotation, cast or alias that IS \`any\`.`,
    );
  }

  console.log(`   ${allExamples.length} marked example(s) across ${new Set(allExamples.map((e) => e.source)).size} file(s), ${bySurface.length} surface(s):`);
  for (const { surface, examples } of bySurface) {
    console.log(`     • ${surface.name}: ${examples.length} block(s)`);
  }
  console.log('');

  // Per-surface compile pass. Each surface owns its own throwaway build dir
  // (so bare specifiers like `react` resolve against ITS resolutionDir's
  // node_modules — see the header comment's "SURFACES" section) and its own
  // `paths` map (so it can self-import its own package(s)), but diagnostics
  // from every surface are collected and reported together at the end —
  // one gate, one verdict, whichever surfaces broke named in it.
  const buildDirs: string[] = [];
  let anyDiags = false;
  const diagBlocks: string[] = [];

  for (const { surface, examples } of bySurface) {
    // BEFORE any declaration is resolved (#7181, adopting #7122's primitive).
    //
    // Placement differs from the two sibling gates on purpose, because the ROUTE to
    // the dist differs: those resolve entry points in-process with
    // `ts.createProgram`, so their first `.d.ts` read is their first statement of
    // work. Here the declarations are reached indirectly — `surfacePaths()` turns
    // each self-package's exports map into a tsconfig `paths` table and a spawned
    // `tsc` follows it — and everything above this loop (extraction, the
    // orphan-marker guard, the zero-block guard, the bare-`any` guard) is
    // dist-independent and worth reporting even when a build is stale. So the
    // guard sits at the boundary rather than at the top: no verdict below it is
    // computed for a stale surface, and no honest finding above it is suppressed.
    let staleMessage: string | null = null;
    for (const pkgDir of surface.selfPackages) {
      const freshness = inspectDistFreshness(pkgDir, 'check', 'pnpm --filter @objectstack/spec check:skill-examples');
      if (!freshness.fresh) {
        staleMessage = freshness.message;
        break;
      }
    }
    if (staleMessage) {
      console.error(`\n[${surface.name}]`);
      console.error(staleMessage);
      process.exit(1);
    }

    const { paths, missing } = surfacePaths(surface.selfPackages);
    // NOT redundant with the freshness check above. That answers "is dist
    // OLDER than src"; this is the one that survives a PARTIAL dist — a
    // self-package whose `.d.ts` was never emitted at all while the newest
    // declaration elsewhere on disk is still newer than `src/`, which the
    // mtime rule alone would read as fresh.
    const unbuiltSelfPackages = surface.selfPackages.filter((dir) => !fs.existsSync(paths[pkgName(dir)]?.[0] ?? ''));
    if (unbuiltSelfPackages.length > 0) {
      fail(
        `[${surface.name}] not built — no declarations to check examples against:\n\n` +
          missing.map((m) => `  - ${m} (missing)`).join('\n') +
          `\n\n  Build first (CI does this in the "Build workspace packages" step):\n\n` +
          unbuiltSelfPackages.map((d) => `    pnpm --filter ${pkgName(d)} build`).join('\n'),
      );
    }

    const buildDir = buildDirOf(surface);
    buildDirs.push(buildDir);
    writeBuildDir(buildDir, examples, paths);
    const { code, output } = runTsc(buildDir);

    const byFile = new Map(examples.map((e) => [e.fileName, e]));
    const diags = parseDiagnostics(output);

    if (code === 0 && diags.length === 0) continue;

    anyDiags = true;
    diagBlocks.push(`\n✗ [${surface.name}] examples do not compile:\n`);
    // Remap every diagnostic back to the source page:<real line> so the author
    // reads the error against the file they actually edit, not the throwaway copy.
    const grouped = new Map<string, string[]>();
    for (const d of diags) {
      const ex = byFile.get(d.file);
      const loc = ex ? `${rel(ex.source)}:${ex.bodyStartLine + d.line - 1}:${d.col}` : d.file;
      const key = ex ? rel(ex.source) : d.file;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(`  ${loc}\n      ${d.text}`);
    }
    for (const [, entries] of grouped) diagBlocks.push(...entries);

    // A non-zero exit with no parseable diagnostics (e.g. a tsconfig error) must
    // still surface — print the raw tail so it is never a silent failure.
    if (diags.length === 0) {
      diagBlocks.push(`\n  tsc exited ${code} but produced no parseable diagnostics. Raw output:\n`);
      diagBlocks.push(output.split('\n').map((l) => `    ${l}`).join('\n'));
    }
  }

  if (!anyDiags) {
    console.log(`✅ ${allExamples.length} prose examples type-check across ${bySurface.length} surface(s)`);
    if (!KEEP) for (const d of buildDirs) fs.rmSync(d, { recursive: true, force: true });
    return;
  }

  console.error(diagBlocks.join('\n'));
  console.error(
    `\n  These are examples an AI copies verbatim. Fix the example to match the\n` +
      `  current declarations, or drop its os:check marker if it is an intentional fragment.\n`,
  );
  if (!KEEP) for (const d of buildDirs) fs.rmSync(d, { recursive: true, force: true });
  process.exit(1);
}

main();
