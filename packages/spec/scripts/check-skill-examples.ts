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
 * ── The fourth assertion: REFUSE when a marked block does not PARSE (#12051) ─
 * Trap 1 above is written as advice to whoever sweeps the corpus by hand. It is
 * also a property of this gate's own run, and arrives through the gate's front
 * door: the build-file extension is taken from the FENCE LANGUAGE, so a marked
 * block whose body is JSX under a ` ```ts ` fence lands in a `.ts` file, where
 * JSX is a syntax error — and one syntactic diagnostic anywhere in the program
 * means the semantic pass never runs, for any file in it.
 *
 * The run went red before this landed (measured — the "Parse-level refusal"
 * section records the ablation and corrects #12051's claim that it stayed
 * green), but it went red in the vocabulary of a semantic result, over a surface
 * whose semantic pass had not run. Two guards now separate those states: marked
 * blocks that do not parse produce a REFUSE verdict naming the surface and the
 * count of blocks left unchecked, and the unmarked JSX-under-a-ts-fence
 * population is swept before anyone arms it. The green line says which of the
 * two happened, and is printed only when every surface reached `tsc`.
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
 * ── Fence-awareness, in BOTH of extractFromFile's loops ───────────────────
 * `fenceOwners()` tracks every top-level fence of ANY language (lifted from
 * the #10533 fence-awareness shape in `scripts/check-role-word.mjs`), and both
 * loops read it, because this gate's own convention has to be documentable in
 * the very roots it governs:
 *
 *   - ORPHAN scan (#10791): a marker spelling shown as example text INSIDE
 *     some other fenced block (e.g. a ```md illustration showing what
 *     `<!-- os:check -->` looks like) is not adjacent, at top level, to a real
 *     fence, so it claims nothing and must not be reported as a misplaced
 *     marker either. A marker at true top level that is merely not adjacent to
 *     its fence is unaffected and still fails loudly.
 *   - EXTRACTION (#11355): the same reasoning one step further in. #10791
 *     deliberately left extraction alone (its card scoped the fix to the
 *     orphan-scan defect), so a bare ` ```ts ` / ` ```tsx ` /
 *     ` ```typescript ` fence-open line was still recognised wherever it
 *     appeared, with no notion of sitting inside a wrapping fence. A marker
 *     ALONE nested in an illustration was therefore handled correctly, while a
 *     FULLY worked one — marker and real ts fence, both written as example
 *     text inside the wrapper — was extracted and handed to `tsc` as a genuine
 *     example, to compile by luck or to fail the whole gate against
 *     documentation prose. No such occurrence existed in the corpus when this
 *     was found (extraction counts are identical either side of the fix), so
 *     the self-test's nested-illustration fixture is where the defect is
 *     measurable at all: nested, the worked illustration extracts nothing;
 *     un-nested, the identical payload extracts every block.
 *   - SHARED CLOSER (#11690): #11355 gave both loops one shared notion of fence
 *     OPENING (`owners[i] === i`), but the BODY END was still re-derived twice —
 *     the walk's own indent/run-length-aware closer inside `fenceOwners()`, and
 *     a second, looser `^```\s*$` (exactly three backticks, column 0) inside
 *     `extractFromFile`'s extraction loop — and the two disagreed on an
 *     indented or four-or-more-backtick closing line (closes the walk's span,
 *     not extraction's) and on a CR-trailing one from a CRLF file (closes
 *     extraction's, not the walk's, which then reads the fence as unclosed —
 *     consuming, per CommonMark, every later block and orphan in the file
 *     too). Latent, no occurrence in the corpus. Fixed the same way as the two
 *     bullets above: `fenceOwners()` now returns each opener's `closeLine`
 *     alongside `owners`, and extraction reads it instead of re-deriving one —
 *     one closer predicate, not two that can drift apart.
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

/**
 * One top-level `ts` / `tsx` / `typescript` fenced block — MARKED OR NOT (#12051).
 *
 * `Example` is the opt-in compile claim; this is the raw population the fence
 * language itself is judged over. The distinction matters in one direction only:
 * an unmarked block is never compiled, so it cannot break a build today — but
 * its fence language is what will decide its build-file extension the moment
 * anyone marks it, and JSX under a `ts` fence stops the whole surface's semantic
 * pass at that moment. Recording unmarked fences is what lets the gate refuse
 * the tripwire before it is armed rather than after.
 */
interface FencedBlock {
  /** Source file (absolute). */
  source: string;
  /** The fence's info string: `ts`, `tsx` or `typescript`. */
  lang: string;
  /** 1-based line of the fence-OPEN line itself. */
  fenceLine: number;
  /** 1-based line in the source of the FIRST code line inside the fence. */
  bodyStartLine: number;
  /** Raw fence body. */
  code: string;
  /** Is an `os:check` marker directly above this fence? */
  marked: boolean;
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
 *  no-op the day someone marks one.
 *
 *  There is deliberately no sibling `FENCE_CLOSE_RE` here (#11690 retired it):
 *  a block's body END is read from `fenceOwners()`'s own `closeLine`, the SAME
 *  indent/run-length-aware regex that decided this line opens a top-level
 *  fence in the first place. A second, looser closer (`^```\s*$` — exactly
 *  three backticks at column 0) used to be re-derived here and disagreed with
 *  the walk's closer in both directions: an indented (≤3 spaces) or
 *  four-or-more-backtick closing line closed the walk's span but not this
 *  one, and a closing line with a trailing CR (a CRLF file) closed this one
 *  (`\s` matches CR) but not the walk's (`[ \t]` does not) — so extraction's
 *  body could run past, or short of, the fence the walk actually closed. */
const FENCE_OPEN_RE = /^```(ts|tsx|typescript)\s*$/;
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
 * Which TOP-LEVEL fenced block owns each line — of ANY language, spanning both
 * its opening and closing fence line. The value is the index of the line that
 * OPENED the block, or `-1` for a line at true top level. A line that opens a
 * top-level fence owns itself, which makes the array answer both questions this
 * file asks of it, one per loop in `extractFromFile()`:
 *
 *   - `owners[i] >= 0` — "line i is inside some fence". The ORPHAN scan's
 *     question (#10791): this gate's own `os:check` convention has to be
 *     documentable in the very roots it governs (e.g. a ```` ```md ````
 *     illustration showing the marker's exact spelling), and a marker shown as
 *     example text inside such a fence claims nothing — it is not adjacent to a
 *     real fence the author intends to check, so it must not be flagged as a
 *     misplaced (orphan) marker either.
 *   - `owners[i] === i` — "line i opens a fence AT TOP LEVEL". The EXTRACTION
 *     loop's question (#11355): a ` ```ts ` fence-open line written as example
 *     text inside a wrapping fence is part of an illustration, not a block this
 *     gate should hand to `tsc`. Extraction was NOT fence-aware until #11355 —
 *     it matched a bare ts/tsx/typescript fence-open line wherever it appeared,
 *     so a FULLY worked nested illustration (the marker AND a real ts fence,
 *     both nested) would have been extracted and compiled as if it were a real
 *     example, failing the gate with a diagnostic pointing at documentation
 *     prose. (No occurrence existed in the corpus; the self-test is where the
 *     defect is measurable.)
 *
 * The two readings share ONE walk on purpose: two independent notions of "am I
 * in a fence" in one file is how the halves drifted apart in the first place.
 *
 * `FENCE_OPEN_RE` is a strict subset of `ANY_FENCE_OPEN_RE` — three backticks
 * plus an info string containing no backtick — so every line the extraction
 * loop recognises is one this walk also opens a span on. A genuine top-level ts
 * fence therefore always owns itself, and the `owners[i] === i` guard can never
 * suppress one.
 *
 * The closing run length must match or exceed the opener's (a `````` fence
 * wrapping a ```ts example closes on ITS OWN fence, not the inner one), and an
 * unclosed fence runs to the end of the document (CommonMark), so it consumes
 * the rest of the file rather than leaving the tail ambiguous.
 *
 * Also returns `closeLine`: for every line that OPENS a top-level fence
 * (`owners[i] === i`), the index of the line that closed it — or
 * `lines.length` when the fence ran unclosed to EOF. This is the SAME value
 * the walk above used internally to decide where the span ends; `extractFromFile`
 * reads it directly instead of re-deriving a body end with its own, looser
 * closer regex (#11690) — one closer predicate, shared by both loops, rather
 * than two that can drift apart on an indented, over-long, or CR-trailing
 * closing line.
 */
function fenceOwners(lines: string[]): { owners: number[]; closeLine: number[] } {
  const owners = new Array<number>(lines.length).fill(-1);
  const closeLine = new Array<number>(lines.length).fill(-1);
  for (let i = 0; i < lines.length; i++) {
    const open = ANY_FENCE_OPEN_RE.exec(lines[i]);
    if (!open) continue;
    const run = open[1].length;
    const closeFence = new RegExp(`^ {0,3}\`{${run},}[ \\t]*$`);
    let end = i + 1;
    while (end < lines.length && !closeFence.test(lines[end])) end++;
    for (let s = i; s < Math.min(end + 1, lines.length); s++) owners[s] = i;
    closeLine[i] = end;
    i = end;
  }
  return { owners, closeLine };
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
 * BOTH halves are fence-aware, via one `fenceOwners()` walk. A ts fence-open
 * line that is itself example text inside a wrapping fence opens nothing (a
 * fully worked nested illustration — marker AND real ts fence — would
 * otherwise be extracted and compiled as if it were a real example, #11355),
 * and a marker shown inside such a fence claims nothing (#10791) and so is no
 * orphan either. The two exclusions are the same fact read twice: the block is
 * not, at top level, a real fence the author intends this gate to check.
 *
 * Also reports `orphans`: top-level MARKER lines that are NOT directly above
 * a ts fence. A misplaced marker (a blank line slipped in between, or it
 * precedes a bash / json block) silently checks nothing — exactly the
 * failure mode this gate exists to prevent — so the caller treats an orphan
 * as an error, not a no-op.
 */
function extractFromFile(
  source: string,
  root: SourceRoot,
): { examples: Example[]; orphans: number[]; fences: FencedBlock[] } {
  const rawLines = fs.readFileSync(source, 'utf-8').split('\n');
  const lines = logicalLines(rawLines, root);
  const { owners, closeLine } = fenceOwners(lines);
  const examples: Example[] = [];
  const fences: FencedBlock[] = [];
  const claimed = new Set<number>(); // MARKER line indices that opened a real block
  let n = 0;

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE_OPEN_RE);
    if (!open) continue;
    // Top level only (#11355). A ts fence-open line INSIDE some other fence is
    // part of an illustration of this very convention, not a block to compile —
    // see `fenceOwners()`. A genuine top-level ts fence owns itself, so this
    // guard cannot suppress one.
    if (owners[i] !== i) continue;
    const marked = i > 0 && lines[i - 1].trim() === root.marker;
    // Body end is the SAME line the walk above closed this fence on (#11690) —
    // never re-derived with a second, looser regex that could disagree with it.
    const close = closeLine[i];
    const body = lines.slice(i + 1, close);
    // EVERY top-level ts/tsx/typescript fence, marked or not (#12051). Marking
    // is what makes a block a compile CLAIM, but the fence language is a
    // property of the block itself, and an unmarked JSX block wearing a `ts`
    // fence is a loaded tripwire rather than a non-issue: the day someone marks
    // it, it stops the whole surface's semantic pass. The same walk answers both
    // questions, so there is no second notion of "which fences exist" to drift.
    fences.push({
      source,
      lang: open[1],
      fenceLine: i + 1, // 1-based line of the fence-OPEN line
      bodyStartLine: i + 2, // 1-based line of body[0]
      code: body.join('\n'),
      marked,
    });
    if (marked) {
      claimed.add(i - 1);
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

  const orphans: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Top level only. A marker shown INSIDE some other fenced block (e.g. a
    // ```md illustration of this very convention) is example text, not a
    // claim — see `fenceOwners()`.
    if (owners[i] >= 0) continue;
    // Any marker spelling counts as an orphan claim — a wrong-format marker
    // checks nothing, which is precisely what this guard exists to catch.
    if (ALL_MARKERS.includes(lines[i].trim()) && !claimed.has(i)) orphans.push(i + 1); // 1-based
  }
  return { examples, orphans, fences };
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

// ── Parse-level refusal: a block that does not PARSE checks nothing (#12051) ─

/**
 * `tsc` reports syntactic diagnostics and then STOPS — the semantic pass never
 * runs, for ANY file in the program. That is documented at the top of this file
 * as a trap for whoever SWEEPS the corpus by hand; #12051 is the same mechanism
 * arriving through the gate's own front door, because the build-file extension
 * is derived from the FENCE LANGUAGE (`buildFileName`): a marked block whose
 * body is JSX but whose fence says ` ```ts ` / ` ```typescript ` is written to a
 * `.ts` file, where JSX is a syntax error, and every semantic diagnostic on that
 * surface — 227 blocks on the skills+docs surface at the time of writing —
 * vanishes with it.
 *
 * ⚠️ MEASURED CORRECTION to #12051's own headline. The card states the gate
 * "still prints a green verdict" under this condition and that the answer to
 * "would this gate still be green if its semantic pass never ran?" is *yes*.
 * Ablated on the real corpus before this change (one JSX line forced into a
 * marked ` ```ts ` block in `content/docs/permissions/sso.mdx`), the pre-fix
 * gate printed `✗ … examples do not compile` and exited 1 — the verdict line
 * DID change. The green path was never reachable: `tsc` exits non-zero on a
 * syntactic diagnostic and prints it, and the surface loop only skips a surface
 * on `code === 0 && diags.length === 0`.
 *
 * What was real, and is what this section closes, is the DEGRADATION either
 * side of that red:
 *
 *   - the failure text read as ordinary type drift ("Fix the example to match
 *     the current declarations"), while the truth was that the surface had not
 *     been type-checked at all;
 *   - the 226 other blocks' semantic pass had silently not run, and nothing in
 *     the output said so — an author who fixes the five reported syntax errors
 *     is *then* meeting the surface's real diagnostics for the first time;
 *   - and nothing enumerated the unmarked JSX-in-`ts`-fence blocks that become
 *     this failure the moment anyone marks them.
 *
 * So the refusal below is not "make a green run red". It is: make the gate say
 * WHICH of the two things happened, and never let a surface's un-run semantic
 * pass be reported in the vocabulary of a semantic result.
 */

/**
 * The exact bytes a block is written to disk as.
 *
 * Shared by `writeBuildDir()` and every parse guard here on purpose: a guard
 * that clears a *different* string than the compiler reads is the dormant-checker
 * shape this file keeps closing. The one transformation (`export {}` for a
 * non-module block) is appended at the END so it never shifts the line of a real
 * diagnostic.
 */
function buildFileText(code: string): string {
  const isModule = /^\s*(import|export)\b/m.test(code);
  return code + (isModule ? '' : '\nexport {};\n');
}

interface ParseUnit {
  /** Unique within one call; the extension decides TS vs TSX parsing. */
  name: string;
  text: string;
}

/**
 * Syntactic diagnostics per file, from TypeScript's OWN parser.
 *
 * `program.getSyntacticDiagnostics()` is precisely the predicate `tsc` itself
 * uses to decide whether to run the semantic pass, so this guard cannot drift
 * from the compiler's behaviour the way a "TS1xxx means syntax" code-range
 * heuristic would (several 1xxx codes are grammar errors the CHECKER reports,
 * which do NOT suppress the semantic pass — reading them as refusal-worthy
 * would manufacture a REFUSE over a surface that was in fact fully checked).
 *
 * ONE program for the whole population, not one per block: the population scan
 * below runs over every ts fence in every root (~1k blocks), and a program per
 * block is the same answer at a thousand times the cost.
 *
 * `noLib` + `noResolve` are load-bearing, not tuning. This guard runs BEFORE the
 * dist-freshness refusal, so it must not read `dist` at all: resolving
 * `@objectstack/spec` here would make a parse-level verdict depend on build
 * state, which is exactly the coupling that makes a guard unrunnable in the
 * situations it matters most. Parsing needs neither.
 */
function syntacticErrorsByFile(units: ParseUnit[]): Map<string, readonly ts.Diagnostic[]> {
  const texts = new Map(units.map((u) => [u.name, u.text]));
  const sources = new Map<string, ts.SourceFile>(
    units.map((u) => [
      u.name,
      ts.createSourceFile(
        u.name,
        u.text,
        ts.ScriptTarget.ES2020,
        /* setParentNodes */ false,
        u.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    ]),
  );

  const host: ts.CompilerHost = {
    getSourceFile: (name) => sources.get(name),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => texts.has(name),
    readFile: (name) => texts.get(name),
    resolveModuleNames: (names) => names.map(() => undefined),
  };

  const program = ts.createProgram({
    rootNames: units.map((u) => u.name),
    options: {
      noLib: true,
      noResolve: true,
      target: ts.ScriptTarget.ES2020,
      // Matches `writeBuildDir`'s tsconfig, so a `.tsx` unit parses JSX here the
      // same way it will there.
      jsx: ts.JsxEmit.ReactJSX,
    },
    host,
  });

  const out = new Map<string, readonly ts.Diagnostic[]>();
  for (const u of units) {
    const sf = program.getSourceFile(u.name);
    out.set(u.name, sf ? program.getSyntacticDiagnostics(sf) : []);
  }
  return out;
}

/** A parse diagnostic rendered against the block body: 1-based line/col + text. */
function formatParseError(d: ts.Diagnostic): { line: number; col: number; text: string } {
  const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return { line: line + 1, col: character + 1, text: `error TS${d.code}: ${message}` };
  }
  return { line: 1, col: 1, text: `error TS${d.code}: ${message}` };
}

/**
 * Does this body contain a real JSX node when parsed as TSX?
 *
 * The second half of the zero-false-positive predicate. "Fails to parse as `.ts`
 * but parses clean as `.tsx`" is nearly sufficient on its own, but *nearly* is
 * how a guard acquires a false positive that costs someone a corpus rewrite —
 * so the JSX node is required to actually be there before this gate tells an
 * author their block is JSX.
 */
function containsJsx(code: string): boolean {
  const sf = ts.createSourceFile('probe.tsx', code, ts.ScriptTarget.ES2020, false, ts.ScriptKind.TSX);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** A block whose body is JSX while its fence claims plain TypeScript. */
interface FenceLanguageMismatch {
  source: string;
  fenceLine: number;
  lang: string;
  marked: boolean;
}

/**
 * The POPULATION half (#12051): every `ts`/`typescript`-fenced block whose body
 * is JSX, marked or not, across every root this gate already reads.
 *
 * The predicate is deliberately three-part and each part removes a class of
 * false positive:
 *
 *   1. does NOT parse as `.ts` — a body that parses fine either way has no
 *      fence-language defect to report;
 *   2. parses CLEAN as `.tsx` — this is what separates JSX from the corpus's
 *      ordinary prose fragments. `defineStack({ ... })` and a `columns: [...]`
 *      subtree fail to parse BOTH ways (TS1109), and are correct as prose;
 *   3. contains an actual JSX node.
 *
 * Measured over the real corpus, 1 and 2 together already selected exactly the
 * JSX blocks; 3 is kept because the cost is one extra parse of an already-broken
 * block and the alternative is a guard whose zero-false-positive claim rests on
 * "nothing else happened to qualify today".
 *
 * ⚠️ Why this cannot live in `check:doc-authoring`'s `FENCE_OPEN` instead
 * (#12051's third open question, answered here rather than forked to devx): that
 * scanner is line-wise — `FENCE_OPEN` matches the fence-open LINE and the body
 * is then tested one line at a time against a literal regex. It never parses a
 * block, so it cannot distinguish JSX from any other text, and widening it to
 * carry this check would mean giving a devx-owned lint its own TypeScript
 * parser. The check belongs where the fence language is *consumed* — here, where
 * it decides a build-file extension — not where fences are merely recognised.
 */
function findJsxInTsFence(fences: FencedBlock[]): FenceLanguageMismatch[] {
  const candidates = fences.filter((f) => f.lang === 'ts' || f.lang === 'typescript');
  if (candidates.length === 0) return [];

  const tsErrors = syntacticErrorsByFile(candidates.map((f, i) => ({ name: `fence-${i}.ts`, text: f.code })));
  const broken = candidates.filter((_, i) => (tsErrors.get(`fence-${i}.ts`) ?? []).length > 0);
  if (broken.length === 0) return [];

  const tsxErrors = syntacticErrorsByFile(broken.map((f, i) => ({ name: `fence-${i}.tsx`, text: f.code })));
  return broken
    .filter((f, i) => (tsxErrors.get(`fence-${i}.tsx`) ?? []).length === 0 && containsJsx(f.code))
    .map((f) => ({ source: f.source, fenceLine: f.fenceLine, lang: f.lang, marked: f.marked }));
}

/** A MARKED block that does not parse — so nothing on its surface got checked. */
interface UnparsedExample {
  example: Example;
  errors: { line: number; col: number; text: string }[];
  /** True when the body would parse clean as `.tsx` and really is JSX. */
  jsxUnderTsFence: boolean;
}

/**
 * The REFUSAL half (#12051): marked blocks on one surface that do not PARSE.
 *
 * Runs over the EXACT text `writeBuildDir` will write (`buildFileText`), so the
 * verdict is about the file `tsc` reads, not about a near-copy of it.
 */
function findUnparsedExamples(examples: Example[]): UnparsedExample[] {
  const errors = syntacticErrorsByFile(examples.map((ex) => ({ name: ex.fileName, text: buildFileText(ex.code) })));
  const out: UnparsedExample[] = [];
  for (const ex of examples) {
    const diags = errors.get(ex.fileName) ?? [];
    if (diags.length === 0) continue;
    const asTsx = ex.fileName.endsWith('.tsx')
      ? diags
      : (syntacticErrorsByFile([{ name: 'probe.tsx', text: buildFileText(ex.code) }]).get('probe.tsx') ?? []);
    out.push({
      example: ex,
      // Three is enough to recognise the shape; a JSX body in a `.ts` file
      // produces a cascade, and printing all of it buries the prescription.
      errors: diags.slice(0, 3).map(formatParseError),
      jsxUnderTsFence: !ex.fileName.endsWith('.tsx') && asTsx.length === 0 && containsJsx(ex.code),
    });
  }
  return out;
}

// ── tsc harness ──────────────────────────────────────────────────────────────

function writeBuildDir(buildDir: string, examples: Example[], paths: Record<string, string[]>): void {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  for (const ex of examples) {
    // Written verbatim (no prepended wrapper) so a tsc line N maps to source
    // line (bodyStartLine + N - 1) with zero arithmetic guesswork. A block with
    // no import/export is a script, not a module; `buildFileText` appends
    // `export {}` so two such files can't collide on a global — appended at the
    // end, it never shifts the line of any real diagnostic. That helper is
    // shared with the parse guards (#12051) so both read the same bytes.
    fs.writeFileSync(path.join(buildDir, ex.fileName), buildFileText(ex.code));
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

/**
 * REFUSE — "this gate produced no result", as distinct from `fail()`'s "this
 * gate produced a result and it is bad" (#12051).
 *
 * Deliberately NOT `fail()` with a different string: the two states need two
 * verdict tokens a reader can grep for and tell apart at a glance, and stacking
 * the prefixes (`✗ ⛔ REFUSE`) reads as one emphatic failure rather than as a
 * different KIND of failure. Same exit code — a refusal is still a red build,
 * because a gate that cannot check its surface must never look like one that
 * did.
 */
function refuse(message: string): never {
  console.error(`\n⛔ REFUSE — ${message}\n`);
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

    // ── Fence-awareness in EXTRACTION (#11355). The fixture above pins the
    //    ORPHAN half — a bare marker nested in an illustration. This one is
    //    the other half, and the one #10791 deliberately left open: a FULLY
    //    worked illustration, marker AND a real ```ts fence, all of it example
    //    text inside a wrapping fence. Before #11355 the extraction loop had no
    //    notion of being inside another fence, so it read the nested fence-open
    //    as a genuine block, extracted the payload and handed it to `tsc` —
    //    failing the gate against documentation prose (or, worse, compiling by
    //    luck and reporting coverage of a block nobody claimed).
    //
    //    The payload is deliberately uncompilable, so a regression is not just
    //    a count that drifts: the poisoned text reaching an `Example.code` is
    //    itself the assertion, and downstream it would reach `tsc`.
    //
    //    Both payloads sit AFTER an inner ``` close but before the wrapper's
    //    own ````` close, so a length-blind closer (one that ended the wrapper
    //    on the inner fence) surfaces here as a second extracted block rather
    //    than as silence.
    const POISON_A = `const poison: number = 'not a number';`;
    const POISON_B = `const alsoPoison: number = 'not a number either';`;
    const REAL_CLAIM = 'const real: number = 1;';

    const nestedWorked = path.join(dir, 'nested-worked.md');
    fs.writeFileSync(
      nestedWorked,
      [
        '# Worked nested illustration', // 1
        '', // 2
        'Showing an author how to mark a block — marker and fence alike are', // 3
        'example text here, not a claim:', // 4
        '', // 5
        '`````md', // 6  ← wrapping fence, five backticks
        '<!-- os:check -->', // 7  ← illustrated marker
        '```ts', // 8  ← illustrated REAL ts fence-open
        POISON_A, // 9
        '```', // 10
        '', // 11
        '<!-- os:check -->', // 12
        '```ts', // 13
        POISON_B, // 14
        '```', // 15
        '`````', // 16 ← the wrapper's own close
        '', // 17
        'And the one real claim, at top level:', // 18
        '', // 19
        '<!-- os:check -->', // 20
        '```ts', // 21
        REAL_CLAIM, // 22
        '```', // 23
        '',
      ].join('\n'),
      'utf8',
    );
    const nested = extractFromFile(nestedWorked, skillsRoot);
    check(
      nested.examples.length === 1,
      `nested-illustration fixture: extracted ${nested.examples.length} block(s), expected 1 — a worked illustration ` +
        'nested inside a wrapping fence is example text; extracting it hands documentation prose to `tsc`',
    );
    check(
      nested.examples.every((e) => !e.code.includes('poison') && !e.code.includes('Poison')),
      `nested-illustration fixture: an illustrated payload reached an extracted block — ` +
        `${JSON.stringify(nested.examples.map((e) => e.code))}`,
    );
    check(
      nested.orphans.length === 0,
      `nested-illustration fixture: reported ${nested.orphans.length} orphan marker(s), expected 0 — the illustrated ` +
        'markers are inside the wrapper, and skipping their fences must not turn them into orphans instead',
    );
    if (nested.examples.length === 1) {
      const ex = nested.examples[0];
      check(
        ex.code === REAL_CLAIM,
        `nested-illustration fixture: extracted ${JSON.stringify(ex.code)}, expected ${JSON.stringify(REAL_CLAIM)}`,
      );
      check(
        ex.bodyStartLine === 22,
        `nested-illustration fixture: bodyStartLine ${ex.bodyStartLine}, expected 22 — skipping a wrapper must not ` +
          'shift the line a diagnostic is reported against',
      );
    }

    // The CONTROL, and the load-bearing half of this pair: the identical three
    // claims with the wrapper's two lines removed. Without it, a guard that
    // simply stopped extracting anything would pass the assertions above — the
    // #10533 (B3) shape, where the green has to be shown to come from the
    // nesting rather than from the payload or the marking.
    const unnestedWorked = path.join(dir, 'unnested-worked.md');
    fs.writeFileSync(
      unnestedWorked,
      [
        '<!-- os:check -->', // 1
        '```ts', // 2
        POISON_A, // 3
        '```', // 4
        '', // 5
        '<!-- os:check -->', // 6
        '```ts', // 7
        POISON_B, // 8
        '```', // 9
        '', // 10
        '<!-- os:check -->', // 11
        '```ts', // 12
        REAL_CLAIM, // 13
        '```', // 14
        '',
      ].join('\n'),
      'utf8',
    );
    const unnested = extractFromFile(unnestedWorked, skillsRoot);
    check(
      unnested.examples.length === 3,
      `un-nested control: extracted ${unnested.examples.length} block(s), expected 3 — the SAME payloads, minus the ` +
        'wrapping fence, must all extract, or the nested case above proves nothing about nesting',
    );
    check(
      JSON.stringify(unnested.examples.map((e) => e.bodyStartLine)) === JSON.stringify([3, 8, 13]),
      `un-nested control: body start lines ${JSON.stringify(unnested.examples.map((e) => e.bodyStartLine))}, expected [3,8,13]`,
    );
    check(
      unnested.orphans.length === 0,
      `un-nested control: reported ${unnested.orphans.length} orphan marker(s), expected 0`,
    );

    // The same nesting inside a `commentPrefixed` root. The guard reads the
    // GUTTER-STRIPPED lines (`logicalLines()`), and nothing else here would
    // catch it being computed over the raw ones instead: a raw-line walk never
    // recognises ` * `````md ` as a fence, so every nested fence below reads as
    // top level again and the defect returns on precisely the roots whose prose
    // lives in docblocks.
    const nestedDoc = path.join(dir, 'nested-doc.ts');
    fs.writeFileSync(
      nestedDoc,
      [
        '/**', // 1
        ' * How to mark an example, illustrated:', // 2
        ' *', // 3
        ' * `````md', // 4
        ' * <!-- os:check -->', // 5
        ' * ```ts', // 6
        ` * ${POISON_A}`, // 7
        ' * ```', // 8
        ' * `````', // 9
        ' *', // 10
        ' * @example', // 11
        ' * <!-- os:check -->', // 12
        ' * ```ts', // 13
        ` * ${REAL_CLAIM}`, // 14
        ' * ```', // 15
        ' */', // 16
        'export const Documented = 1;', // 17
      ].join('\n'),
      'utf8',
    );
    const nestedGutter = extractFromFile(nestedDoc, specSrcRoot);
    check(
      nestedGutter.examples.length === 1 && nestedGutter.examples[0].code === REAL_CLAIM,
      `gutter-wrapped nested fixture: extracted ${JSON.stringify(nestedGutter.examples.map((e) => e.code))}, expected ` +
        `only ${JSON.stringify([REAL_CLAIM])} — fence ownership must be judged on gutter-stripped lines`,
    );
    check(
      nestedGutter.orphans.length === 0,
      `gutter-wrapped nested fixture: reported ${nestedGutter.orphans.length} orphan marker(s), expected 0`,
    );

    // ── Shared fence-closer predicate (#11690). #11355 gave both loops one
    //    shared notion of fence OPENING (`owners[i] === i`), but the body END
    //    was still re-derived twice: `fenceOwners()`'s own indent/run-length
    //    -aware closer for the walk, and a second, looser `^```\s*$` (exactly
    //    three backticks, column 0) inside extraction. The two fixtures below
    //    each pin one closing-line spelling the walk accepts but the OLD
    //    extraction regex did not — an indented (≤3-space) closer, and a
    //    four-or-more-backtick closer — by placing a SECOND real, marked
    //    block right after the divergent close: under the old two-closer
    //    code, extraction ran past the real close looking for a bare
    //    column-0 `` ``` ``, swallowed the second block's marker and fence
    //    whole into the first block's body, and the second claim never
    //    extracted as its own block at all (verified against the pre-fix
    //    code: one merged, poisoned example, not two). Now both loops read
    //    the SAME `closeLine`, so the two blocks extract independently.
    const INDENTED_BODY = 'const indented: number = 1;';
    const AFTER_INDENT_CLAIM = 'const afterIndent: number = 2;';
    const indentedClose = path.join(dir, 'indented-close.md');
    fs.writeFileSync(
      indentedClose,
      [
        '<!-- os:check -->', // 1
        '```ts', // 2
        INDENTED_BODY, // 3
        '  ```', // 4  ← closer indented 2 spaces: closes the WALK (≤3-space indent allowed) but not the old column-0-only extraction regex
        '', // 5
        '<!-- os:check -->', // 6
        '```ts', // 7
        AFTER_INDENT_CLAIM, // 8
        '```', // 9
        '',
      ].join('\n'),
      'utf8',
    );
    const indented = extractFromFile(indentedClose, skillsRoot);
    check(
      indented.examples.length === 2,
      `indented-closer fixture: extracted ${indented.examples.length} block(s), expected 2 — the OLD extraction ` +
        "regex ran past line 4's indented close to line 9's bare column-0 fence, merging both blocks into one",
    );
    if (indented.examples.length === 2) {
      check(
        indented.examples[0].code === INDENTED_BODY,
        `indented-closer fixture: first block body was ${JSON.stringify(indented.examples[0].code)}, expected ` +
          `${JSON.stringify(INDENTED_BODY)} — extraction must close on the SAME indented line the walk closed on`,
      );
      check(
        indented.examples[1].code === AFTER_INDENT_CLAIM,
        `indented-closer fixture: second block body was ${JSON.stringify(indented.examples[1].code)}, expected ` +
          `${JSON.stringify(AFTER_INDENT_CLAIM)} — it must still extract as its own block, not be swallowed into the first`,
      );
    }
    check(
      indented.orphans.length === 0,
      `indented-closer fixture: reported ${indented.orphans.length} orphan marker(s), expected 0`,
    );

    const RUNLEN_BODY = 'const runlen: number = 1;';
    const AFTER_RUNLEN_CLAIM = 'const afterRunlen: number = 2;';
    const runlenClose = path.join(dir, 'runlen-close.md');
    fs.writeFileSync(
      runlenClose,
      [
        '<!-- os:check -->', // 1
        '```ts', // 2
        RUNLEN_BODY, // 3
        '````', // 4  ← 4-backtick closer: satisfies the walk's run-length-aware `{run,}` but not the old exact-3 extraction regex
        '', // 5
        '<!-- os:check -->', // 6
        '```ts', // 7
        AFTER_RUNLEN_CLAIM, // 8
        '```', // 9
        '',
      ].join('\n'),
      'utf8',
    );
    const runlen = extractFromFile(runlenClose, skillsRoot);
    check(
      runlen.examples.length === 2,
      `run-length-closer fixture: extracted ${runlen.examples.length} block(s), expected 2 — same merge-past-the-` +
        'real-close failure as the indented case, triggered by an over-long closer instead',
    );
    if (runlen.examples.length === 2) {
      check(
        runlen.examples[0].code === RUNLEN_BODY,
        `run-length-closer fixture: first block body was ${JSON.stringify(runlen.examples[0].code)}, expected ` +
          `${JSON.stringify(RUNLEN_BODY)}`,
      );
      check(
        runlen.examples[1].code === AFTER_RUNLEN_CLAIM,
        `run-length-closer fixture: second block body was ${JSON.stringify(runlen.examples[1].code)}, expected ` +
          `${JSON.stringify(AFTER_RUNLEN_CLAIM)}`,
      );
    }
    check(
      runlen.orphans.length === 0,
      `run-length-closer fixture: reported ${runlen.orphans.length} orphan marker(s), expected 0`,
    );

    // A THIRD spelling combining both attributes at once (indent AND an
    // over-long run together) — the boundary the shared regex's `{0,3}` and
    // `{run,}` quantifiers must both clear in the same line, not just one at
    // a time.
    const COMBO_BODY = 'const combo: number = 1;';
    const AFTER_COMBO_CLAIM = 'const afterCombo: number = 2;';
    const comboClose = path.join(dir, 'combo-close.md');
    fs.writeFileSync(
      comboClose,
      [
        '<!-- os:check -->', // 1
        '```ts', // 2
        COMBO_BODY, // 3
        '   ````', // 4  ← 3-space indent AND 4 backticks together
        '', // 5
        '<!-- os:check -->', // 6
        '```ts', // 7
        AFTER_COMBO_CLAIM, // 8
        '```', // 9
        '',
      ].join('\n'),
      'utf8',
    );
    const combo = extractFromFile(comboClose, skillsRoot);
    check(
      combo.examples.length === 2 &&
        combo.examples[0].code === COMBO_BODY &&
        combo.examples[1].code === AFTER_COMBO_CLAIM,
      `combined indent+run-length fixture: got ${JSON.stringify(combo.examples.map((e) => e.code))}, expected ` +
        `${JSON.stringify([COMBO_BODY, AFTER_COMBO_CLAIM])}`,
    );
    check(
      combo.orphans.length === 0,
      `combined indent+run-length fixture: reported ${combo.orphans.length} orphan marker(s), expected 0`,
    );

    // The FOURTH spelling: a trailing CR (a CRLF-line-ended file) closes the
    // OLD extraction regex (`\s*` matches CR) but not the walk's (`[ \t]*`
    // does not) — the reverse direction from the three above. Pre-#11690 this
    // was the one divergence that looked "clean": extraction's own closer
    // matched the CR-line and reported a short, plausible one-line body,
    // while the walk (silently, underneath it) had already decided the fence
    // never closed at all and swallowed the second marker+fence with NO
    // extraction and NO orphan report — the exact silent-suppression #11355
    // introduced this file's docblock warns about. Now that extraction reads
    // the walk's OWN `closeLine`, its reported body honestly reflects what
    // the walk believes this span contains — including the buried second
    // block — rather than quietly disagreeing with it. This is still a
    // latent gap in CRLF handling (no occurrence in the corpus, per the
    // issue), but the two loops no longer give two different answers about
    // where the fence ends.
    const CR_BODY = 'const crClosed: number = 1;';
    const AFTER_CR_CLAIM = 'const afterCr: number = 2;';
    const crClose = path.join(dir, 'cr-close.md');
    fs.writeFileSync(
      crClose,
      ['<!-- os:check -->', '```ts', CR_BODY, '```\r', '', '<!-- os:check -->', '```ts', AFTER_CR_CLAIM, '```', ''].join(
        '\n',
      ),
      'utf8',
    );
    const crFixture = extractFromFile(crClose, skillsRoot);
    const crExpectedBody = [CR_BODY, '```\r', '', '<!-- os:check -->', '```ts', AFTER_CR_CLAIM].join('\n');
    check(
      crFixture.examples.length === 1,
      `CR-closer fixture: extracted ${crFixture.examples.length} block(s), expected 1 — the walk reads the CR-` +
        'trailing close as non-closing and treats the whole rest of the fixture as one unclosed span, so the second ' +
        'marked block must NOT extract as its own example',
    );
    if (crFixture.examples.length === 1) {
      check(
        crFixture.examples[0].code === crExpectedBody,
        `CR-closer fixture: body was ${JSON.stringify(crFixture.examples[0].code)}, expected ` +
          `${JSON.stringify(crExpectedBody)} — extraction's reported body must match what the WALK considers this ` +
          "span's content (including the buried second block), not a shorter body computed by extraction's own " +
          'independent closer',
      );
    }
    check(
      crFixture.orphans.length === 0,
      `CR-closer fixture: reported ${crFixture.orphans.length} orphan marker(s), expected 0 — the second marker is ` +
        "inside the walk's (still open) span, not an orphan",
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

    // ── Fence language vs body language, and refusal (#12051) ─────────────
    //
    // Both directions, because both failures are silent. A false NEGATIVE here
    // is the defect itself: the guard passes, someone marks a JSX block under a
    // `ts` fence, and the surface's semantic pass stops running while the gate
    // reports in the vocabulary of a compile result. A false POSITIVE is just
    // as costly the other way — the corpus is full of prose fragments that
    // parse as neither TS nor TSX, and flagging those would force a rewrite of
    // documentation that is correct as written.
    const JSX_BODY = ['function Card() {', '  return <div className="card">hi</div>;', '}'].join('\n');
    const FRAGMENT_BODY = 'defineStack({ ... })';

    const jsxFences = path.join(dir, 'jsx-fences.md');
    fs.writeFileSync(
      jsxFences,
      [
        '<!-- os:check -->', // 1
        '```ts', // 2  ← MARKED JSX under a plain-ts fence: the live defect
        ...JSX_BODY.split('\n'), // 3-5
        '```', // 6
        '', // 7
        '```typescript', // 8  ← UNMARKED JSX: the loaded tripwire
        ...JSX_BODY.split('\n'), // 9-11
        '```', // 12
        '', // 13
        '<!-- os:check -->', // 14
        '```tsx', // 15  ← the SAME body, correctly fenced: must NOT be flagged
        ...JSX_BODY.split('\n'), // 16-18
        '```', // 19
        '', // 20
        '```ts', // 21  ← UNMARKED prose fragment: parses as NEITHER, not a fence defect
        FRAGMENT_BODY, // 22
        '```', // 23
        '',
      ].join('\n'),
      'utf8',
    );
    const fenced = extractFromFile(jsxFences, skillsRoot);
    check(
      fenced.fences.length === 4,
      `fence-language fixture: collected ${fenced.fences.length} fence(s), expected 4 — unmarked fences must be ` +
        'collected too, or the tripwire half of the guard cannot see anything',
    );
    check(
      fenced.examples.length === 2,
      `fence-language fixture: extracted ${fenced.examples.length} marked block(s), expected 2`,
    );
    const mismatches = findJsxInTsFence(fenced.fences);
    check(
      mismatches.length === 2,
      `fence-language fixture: flagged ${mismatches.length} JSX-under-ts fence(s), expected 2 — got ` +
        JSON.stringify(mismatches.map((m) => `${m.fenceLine}:${m.lang}:${m.marked ? 'marked' : 'unmarked'}`)),
    );
    check(
      JSON.stringify(mismatches.map((m) => m.fenceLine)) === JSON.stringify([2, 8]),
      `fence-language fixture: flagged lines ${JSON.stringify(mismatches.map((m) => m.fenceLine))}, expected [2,8] — ` +
        'line 15 is the same body under a ```tsx fence (correct, must not be flagged) and line 21 is a prose ' +
        'fragment that parses as neither TS nor TSX (not a fence-language defect)',
    );
    check(
      JSON.stringify(mismatches.map((m) => m.marked)) === JSON.stringify([true, false]),
      `fence-language fixture: marked flags ${JSON.stringify(mismatches.map((m) => m.marked))}, expected [true,false] — ` +
        'an UNMARKED JSX block must still be reported; it is the tripwire, not a non-issue',
    );

    // The refusal half, over the marked blocks of the same fixture. The JSX one
    // must refuse AND be diagnosed as a fence-language defect; the correctly
    // fenced one must parse clean, or the guard is flagging JSX rather than the
    // mismatch.
    const unparsed = findUnparsedExamples(fenced.examples);
    check(
      unparsed.length === 1,
      `refusal fixture: ${unparsed.length} marked block(s) failed to parse, expected 1 — the tsx-fenced block ` +
        'carries the identical body and must parse clean',
    );
    if (unparsed.length === 1) {
      check(
        unparsed[0].example.fileName.endsWith('.ts') && !unparsed[0].example.fileName.endsWith('.tsx'),
        `refusal fixture: the failing block was written as ${unparsed[0].example.fileName} — the plain-ts fence ` +
          'is what puts a JSX body in a .ts file, and that is the whole mechanism',
      );
      check(
        unparsed[0].jsxUnderTsFence,
        'refusal fixture: the failing block was NOT diagnosed as JSX-under-a-ts-fence — without that the author ' +
          'reads a cascade of TS1005s and has no way to reach the one-word fix',
      );
      check(
        unparsed[0].errors.length > 0 && /TS\d+/.test(unparsed[0].errors[0].text),
        `refusal fixture: reported no parse diagnostic text (got ${JSON.stringify(unparsed[0].errors)})`,
      );
      const pageLine = unparsed[0].example.bodyStartLine + unparsed[0].errors[0].line - 1;
      check(
        pageLine >= 3 && pageLine <= 5,
        `refusal fixture: mapped the first parse error to page line ${pageLine}, expected 3-5 (the JSX body) — ` +
          'a refusal pointing at the wrong line is worse than none',
      );
    }

    // A marked ellipsis fragment refuses too. Refusal is about PARSING, not
    // about JSX: this is the shape the file header records as having suppressed
    // a whole sweep's semantic pass (#10924's three TS1109 blocks), and it must
    // reach the same verdict by the same route — with `jsxUnderTsFence` false,
    // so the JSX prescription is not offered for a defect that is not JSX.
    const markedFragment = path.join(dir, 'marked-fragment.md');
    fs.writeFileSync(
      markedFragment,
      ['<!-- os:check -->', '```ts', FRAGMENT_BODY, '```', ''].join('\n'),
      'utf8',
    );
    const fragmentExtract = extractFromFile(markedFragment, skillsRoot);
    const fragmentUnparsed = findUnparsedExamples(fragmentExtract.examples);
    check(
      fragmentUnparsed.length === 1 && !fragmentUnparsed[0].jsxUnderTsFence,
      `marked-fragment fixture: expected 1 refusal with jsxUnderTsFence=false, got ${JSON.stringify(
        fragmentUnparsed.map((u) => u.jsxUnderTsFence),
      )} — a non-JSX parse failure must refuse without recommending a tsx retag`,
    );
    check(
      findJsxInTsFence(fragmentExtract.fences).length === 0,
      'marked-fragment fixture: a prose ellipsis fragment was reported as JSX under a ts fence — that is the ' +
        'false positive that would force a corpus-wide rewrite of correct documentation',
    );

    // The bytes the refusal guard parses ARE the bytes `writeBuildDir` writes.
    // Pinned directly, because the two drifting apart is how a guard ends up
    // clearing a string the compiler never reads.
    check(
      buildFileText('const a = 1;') === 'const a = 1;\nexport {};\n',
      `buildFileText fixture: a non-module block was not given its \`export {}\` (got ${JSON.stringify(buildFileText('const a = 1;'))})`,
    );
    check(
      buildFileText("import { z } from 'zod';") === "import { z } from 'zod';",
      'buildFileText fixture: a block that is already a module was given an extra `export {}`',
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
      '    top-level misplaced marker still is; a FULLY worked nested illustration (marker AND a\n' +
      '    real ```ts fence, wrapper-nested, gutter-wrapped or not) extracts NOTHING while the\n' +
      '    identical payloads un-nested all extract; a gutter-wrapped ```ts block (spec-source\n' +
      '    surface) extracts with the right build extension, body and line mapping, its\n' +
      '    `.test.ts` sibling is skipped, two surfaces sharing one build dir are caught, a\n' +
      '    surface whose build dir is not covered by .gitignore is caught too, and a non-git\n' +
      '    cwd reads as indeterminate rather than as a false violation; an indented, an over-long,\n' +
      '    and a combined indent+over-long closing fence all extract identically to the walk\'s own\n' +
      '    span, and a CR-trailing closer reads as unclosed the SAME way for both loops instead of\n' +
      '    disagreeing about where the fence ends; a JSX body under a ```ts fence is flagged whether\n' +
      '    it is marked or not, the identical body under a ```tsx fence is not, a prose ellipsis\n' +
      '    fragment (parses as neither) is not, a marked block that does not parse REFUSES with its\n' +
      '    first error mapped to the right page line — recommending a tsx retag only when the body\n' +
      '    really is JSX — and the bytes the refusal parses are the bytes the build dir is written\n' +
      '    with.',
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
    const fences: FencedBlock[] = [];
    for (const { file, root } of sourceFiles(surface.roots)) {
      const { examples: found, orphans: bad, fences: all } = extractFromFile(file, root);
      examples.push(...found);
      fences.push(...all);
      for (const line of bad) orphans.push(`${rel(file)}:${line}`);
    }
    return { surface, examples, orphans, fences };
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

  // ── REFUSE, rather than degrade (#12051) ──────────────────────────────────
  //
  // A marked block that does not PARSE does not produce a type-checking result
  // that is merely wrong — it produces NO type-checking result for its entire
  // surface, because tsc reports syntactic diagnostics and then stops before the
  // semantic pass, for every file in the program. Before this guard the run
  // still went red (measured — see the "Parse-level refusal" section), but it
  // went red saying "examples do not compile … fix the example to match the
  // current declarations": the vocabulary of a semantic result, over a surface
  // where the semantic pass had not run. The reader's next move — fix these
  // diagnostics, trust the rest — is wrong in a way the output gave them no way
  // to see.
  //
  // So the verdict is separated from the diagnosis. REFUSE says: this surface
  // was not checked, here is what stopped it, and here is how many blocks that
  // leaves unchecked. It runs BEFORE the dist-freshness refusal and before any
  // build dir is written, because parsing depends on neither — and before the
  // bare-`any` guard below, which walks a `createSourceFile` tree: that call
  // degrades silently on input it cannot parse (it never throws), so running it
  // over an unparseable block is the dormant-checker shape its own docblock
  // warns about. Refusing first means every guard after this line is looking at
  // a tree TypeScript actually built.
  const refusals = bySurface
    .map(({ surface, examples }) => ({ surface, examples, unparsed: findUnparsedExamples(examples) }))
    .filter((r) => r.unparsed.length > 0);
  if (refusals.length > 0) {
    const lines: string[] = [];
    for (const { surface, examples, unparsed } of refusals) {
      lines.push(
        `[${surface.name}] was NOT type-checked.\n\n` +
          `   ${unparsed.length} marked block(s) do not parse. TypeScript reports syntactic errors and\n` +
          `   then STOPS: the semantic pass never runs, for any file in the program. So the other\n` +
          `   ${examples.length - unparsed.length} marked block(s) on this surface were not type-checked either — this run\n` +
          `   proves nothing about them, in either direction.\n`,
      );
      for (const u of unparsed) {
        lines.push(`   ${rel(u.example.source)}  (block written as ${u.example.fileName})`);
        for (const e of u.errors) {
          lines.push(`     ${rel(u.example.source)}:${u.example.bodyStartLine + e.line - 1}:${e.col}  ${e.text}`);
        }
        if (u.jsxUnderTsFence) {
          lines.push(
            `     ↳ This body is JSX and parses clean as .tsx. Its fence says \`\`\`ts / \`\`\`typescript,\n` +
              `       which is what put it in a .ts file. Retag the fence \`\`\`tsx.`,
          );
        }
        lines.push('');
      }
    }
    refuse(
      lines.join('\n') +
        `  Fix the parse errors, or drop the os:check marker from a block that is an\n` +
        `  illustrative fragment rather than a compile claim (an ellipsis placeholder like\n` +
        `  \`defineStack({ ... })\` is correct as prose and can never parse).\n\n` +
        `  ⚠️ Do NOT read the diagnostics above as this surface's problem list. They are the\n` +
        `     reason there IS no problem list yet. Re-run once they are gone — that run is the\n` +
        `     first one whose result means anything.`,
    );
  }

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

  // The UNMARKED population (#12051): JSX bodies under a ` ```ts ` /
  // ` ```typescript ` fence, across every root this gate reads.
  //
  // The build-file extension is derived from the fence language, so a JSX body
  // under a plain-ts fence is written to a `.ts` file where JSX cannot parse,
  // and a program carrying one syntactic error never reaches its semantic pass
  // — for ANY file in it. An unmarked block of that shape breaks nothing today,
  // because nothing compiles it; it is a tripwire, and marking it is a one-line
  // edit. So it is swept here rather than left to be discovered by the surface
  // -wide loss of type-checking it causes on the day someone arms it.
  //
  // MARKED blocks are deliberately NOT reported here — the REFUSE guard above
  // owns every marked block that fails to parse, JSX or otherwise, and says the
  // one thing this message cannot: that the surface has no result at all. One
  // block, one verdict; a defect that appears in two of them teaches the reader
  // to skim both.
  const fenceMismatches = bySurface.flatMap((s) => findJsxInTsFence(s.fences)).filter((m) => !m.marked);
  if (fenceMismatches.length > 0) {
    fail(
      `JSX inside a \`\`\`ts / \`\`\`typescript fence — the fence language decides the build-file\n` +
        `extension, and JSX is a SYNTAX error in a .ts file:\n\n` +
        fenceMismatches.map((m) => `  - ${rel(m.source)}:${m.fenceLine}  (\`\`\`${m.lang}, unmarked)`).join('\n') +
        `\n\n  Retag each fence \`\`\`tsx. Nothing else about the block changes: \`tsx\` is already\n` +
        `  accepted by this gate and by check:doc-authoring's fence scanner.\n\n` +
        `  None of these is marked, so none breaks a build today — that is why they are worth\n` +
        `  reporting now. Marking one is a one-line edit, and what it buys is a surface-wide\n` +
        `  loss of type-checking (${allExamples.length} marked blocks across ${bySurface.length} surfaces at present) delivered as an\n` +
        `  ordinary-looking compile error. The fence language is also what every reader and\n` +
        `  every syntax highlighter goes by, so the retag is right on its own terms.`,
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
  // Which surfaces actually reached `tsc` (#12051). The green line below is a
  // claim about the SEMANTIC pass, so it is printed only when every surface got
  // one — and "every surface" is asserted from a set built inside the loop
  // rather than assumed from the loop existing. The refusal above makes the
  // syntactic half of that claim true; this makes the "for all surfaces" half
  // true against the next edit that adds a skip or an early `continue` up here.
  const compiled = new Set<string>();

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
    // Every marked block on this surface parsed (the refusal above proved it),
    // so tsc's syntactic pass was clean and its semantic pass ran. Record that
    // this surface has a real result — clean or not.
    compiled.add(surface.name);

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
    if (compiled.size !== bySurface.length) {
      const skipped = bySurface.map((s) => s.surface.name).filter((n) => !compiled.has(n));
      refuse(
        `${skipped.length} surface(s) never reached tsc: ${skipped.join(', ')}.\n\n` +
          `  Nothing below this line may report success: a green verdict here would be a claim\n` +
          `  about a semantic pass that did not run. This is an internal invariant (#12051) — if\n` +
          `  you just added a skip or an early \`continue\` to the compile loop, that is the cause,\n` +
          `  and the fix is to give the skipped surface its own verdict rather than to relax this.`,
      );
    }
    console.log(
      `✅ ${allExamples.length} prose examples type-check across ${bySurface.length} surface(s)` +
        ` — every marked block parsed, so tsc ran the SEMANTIC pass on all of them`,
    );
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
