#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * measure-markdown-ts-blocks -- do the fenced TypeScript blocks in package-root
 * Markdown compile? (#18715)
 *
 *   node scripts/measure-markdown-ts-blocks.mjs                 # the census
 *   node scripts/measure-markdown-ts-blocks.mjs --json          # machine-readable
 *   node scripts/measure-markdown-ts-blocks.mjs --only <path>   # one file (repeatable)
 *   node scripts/measure-markdown-ts-blocks.mjs --controls-only # just the two controls
 *   node scripts/measure-markdown-ts-blocks.mjs --self-test     # the extractor's own battery
 *
 * ⛔ THIS IS A MEASUREMENT INSTRUMENT, NOT A GATE. It exits 0 on any census
 * outcome, is wired into no CI job and no package `test`/`lint` chain, and
 * nothing in this repository fails because of what it reports. Turning a
 * census into a required gate is a NEW REQUIRED GATE — the maintainer's floor
 * — and the wiring options belong in a letter to the maintainer, never in a
 * `package.json` edit made by whoever wrote the instrument.
 *
 * It exits non-zero for exactly one reason: THE INSTRUMENT ITSELF COULD NOT
 * RUN (its controls misbehaved, or the workspace is not built). "Could not
 * run" is a failure, not a skip — a census that silently degrades to "0
 * failures" because nothing resolved is the worst possible output.
 *
 * ## POPULATION
 *
 * Markdown sitting at the ROOT of a package: every `*.md` directly inside a
 * directory under `packages/` that has a `package.json`. Two strata are
 * reported separately and ⛔ never summed into one headline:
 *
 *   - HAND-WRITTEN — README.md, ARCHITECTURE.md, PHASE2_IMPLEMENTATION.md, …
 *     A failing block here is a defect an author can repair.
 *   - CHANGELOG.md — RELEASE-OWNED and compiled by `changeset version` from
 *     `.changeset/*.md` (AGENTS.md, Documentation Guardrails). Its blocks are
 *     HISTORY: before/after migration snippets that deliberately show removed
 *     APIs. A failing block here is frequently CORRECT documentation, and it
 *     cannot be repaired in a code PR at all. Counting the two together
 *     produces a number nobody can act on.
 *
 * `content/docs/**` is a DIFFERENT population with its own gates and is out of
 * scope here (#18715 holds it out explicitly).
 *
 * ## THE ELISION CONVENTION — the one real design question, and its answer
 *
 * These documents are full of partial snippets. A census that counts every
 * partial block as a failure measures nothing. So how does a block declare
 * itself partial?
 *
 * ⛔ THE OBVIOUS ANSWER IS DISQUALIFIED, and this instrument proves it rather
 * than asserting it. The obvious answer is an EXCLUSION rule: a block carrying
 * an elision marker (`// ...`) is skipped. Run that rule against the one
 * failure this repository has already PROVEN — `PHASE2_IMPLEMENTATION.md`'s
 * pre-#18712 `kernel.logger` block, measured at `tsc --noEmit --strict` exit 2
 * with TS2341 — and it is excluded, because that block ends with the line
 * `// ... plugin registration code ...`. An exclusion rule would have hidden
 * the only defect in this family anyone has ever measured. That is the whole
 * argument, and `FIRING_CONTROL` below is the standing proof of it.
 *
 * ✅ THE RULE THIS INSTRUMENT USES IS A TOLERANCE RULE, not an exclusion rule.
 * Every block is compiled. What a legitimately partial block can PRODUCE is
 * forgiven; nothing else is:
 *
 *   forgiven  TS2304 / TS2552 / TS2503  a name or namespace the block elided
 *   forgiven  TS2307 on a RELATIVE specifier  the reader's own file
 *             (`./my-kernel`, `./objectstack.config.js`) — never a
 *             `@objectstack/*` one, see below
 *   counted   everything else, including TS2341 (private member), TS2339
 *             (no such property), TS2345 (wrong argument type), TS2305 /
 *             TS2724 (no such export) and TS2307 on a `@objectstack/*`
 *             specifier
 *
 * TS2307 on a `@objectstack/*` specifier is deliberately NOT forgiven: the
 * `paths` map this instrument compiles against is generated from each
 * package's own `exports` map, so an unresolved one means the document tells a
 * reader to import a subpath the package does not publish. That is the
 * `check-published-readme-exports` family of defect, arriving here for free.
 *
 * ## BOTH NUMBERS, AND WHICH DIRECTION EACH ONE LIES IN
 *
 * The census reports RAW and TOLERANT side by side, and neither is "the"
 * answer:
 *
 *   RAW       every block with at least one diagnostic. An UPPER BOUND: it
 *             counts fragments that were never meant to stand alone.
 *   TOLERANT  every block with at least one diagnostic outside the forgiven
 *             set. A LOWER BOUND, and this is the direction that matters: a
 *             forgiven TS2304 leaves that name typed `any`, and every
 *             downstream use of it is then unchecked. Real defects hide behind
 *             an elision; they never appear because of one.
 *
 * ⇒ The honest sentence is "between TOLERANT and RAW", and the gate question
 * is answered by TOLERANT, because that is the number a gate could be built to
 * hold at zero.
 *
 * ## THE FORWARD CONVENTION, for the blocks tolerance cannot absolve
 *
 * A block that is a bare fragment — a type signature, half an object literal —
 * produces SYNTAX errors, and ⛔ syntax is not forgiven: a tolerance rule that
 * forgave TS1xxx would forgive a typo. Those blocks need an explicit
 * declaration, and the proposed spelling is an info-string tag:
 *
 *     ```ts partial
 *
 * ⛔ Zero blocks in the corpus carry it today, so it contributes nothing to
 * this census — it is stated so the census can COUNT how many blocks would
 * need one (`needs-explicit-partial-tag` below), which is the cost line the
 * wiring letter needs. An `exclusion` census is also printed, labelled as the
 * disqualified reading, so the number cannot hide inside the convention.
 *
 * ## THE TWO CONTROLS — run on EVERY census, not only under --self-test
 *
 * An instrument that finds zero failures and was never shown capable of
 * finding one has measured nothing.
 *
 *   GREEN_CONTROL   a block that MUST compile. It fails when the workspace is
 *                   not built (no `dist/*.d.ts` to resolve against), which is
 *                   the state in which every other block would report TS2307
 *                   and the census would read as a catastrophe made of
 *                   nothing. The run REFUSES instead of printing it.
 *   FIRING_CONTROL  the reconstructed pre-#18712 `kernel.logger` block, which
 *                   MUST be reported as failing, MUST carry TS2341, and MUST
 *                   still fail under the tolerance rule. It is also the proof
 *                   that the exclusion rule is disqualified: the same fixture
 *                   is reported as EXCLUDED by that rule, every run.
 *
 * Both go through the identical path as corpus blocks — same extractor, same
 * normalisation, same program — so a control green is a statement about the
 * instrument that actually ran.
 *
 * ## NORMALISATION, stated because it changes the bytes compiled
 *
 *   1. The opening fence's indentation is stripped from every body line, so a
 *      block inside a list item compiles as the code the reader sees.
 *   2. `export {};` is appended to every block. One tsc program holds every
 *      block at once; without it a block with no import/export is a SCRIPT in
 *      the global scope and collides with every other one (TS2451 on names
 *      like `kernel`), which would be a census of this instrument's own
 *      packaging. Appending at the end leaves every reported line number
 *      equal to the line number in the Markdown.
 *
 * ## COMPILER OPTIONS, and why each deviation from the repo's own tsconfig
 *
 *   strict: true            — #18715's proven measurement is `tsc --noEmit
 *                             --strict`; kept verbatim so this instrument and
 *                             that reading answer the same question.
 *   moduleResolution:       — `exports` maps are honoured (so an unpublished
 *     Bundler                 subpath still fails) WITHOUT NodeNext's
 *                             mandatory `.js` extension on relative
 *                             specifiers, which would manufacture a failure
 *                             out of a documentation style choice.
 *   noUnusedLocals: false   — a snippet that declares a value to SHOW it is
 *   noUnusedParameters:       not a defect. The repo's own tsconfig turns
 *     false                   these on for source; doing so here would count
 *                             prose as breakage.
 *   lib: ES2022 + DOM       — deliberately generous. Every ambient name the
 *   types: node               instrument can supply is one fewer manufactured
 *                             failure.
 */

import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const nodeRequire = createRequire(import.meta.url);
const ts = nodeRequire('typescript');

// ── Population ─────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.git', 'json-schema']);

/** Every directory under `root` that carries a package.json, `root` included. */
export function findPackageRoots(root, out = []) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    findPackageRoots(join(root, entry.name), out);
  }
  if (existsSync(join(root, 'package.json'))) out.push(root);
  return out;
}

export function populationFiles() {
  const files = [];
  for (const pkgRoot of findPackageRoots(PACKAGES_DIR)) {
    for (const name of readdirSync(pkgRoot)) {
      if (name.endsWith('.md')) files.push(join(pkgRoot, name));
    }
  }
  return files.sort();
}

/** CHANGELOG.md is release-owned history, reported as its own stratum. */
export const stratumOf = (file) => (/(^|\/)CHANGELOG\.md$/.test(file) ? 'changelog' : 'handwritten');

/** The literal `packages/<pkg>/*.md` glob #18715 names, kept as a reportable sub-stratum. */
export const isDepthOne = (relPath) => relPath.split('/').length === 3;

// ── Extraction ─────────────────────────────────────────────────────────────

const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*)$/;
const TS_LANGS = new Set(['ts', 'typescript', 'tsx']);

/**
 * Fenced blocks whose info-string's FIRST word is a TypeScript language.
 * A fence opened inside an already-open block is body text, never a new block:
 * a ```ts fence quoted inside a ```md example is not code this repo ships.
 */
export function extractBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = FENCE_RE.exec(lines[i]);
    if (!m) {
      if (open) open.body.push(lines[i]);
      continue;
    }
    const [, indent, fence, info] = m;
    if (!open) {
      open = { indent, char: fence[0], len: fence.length, info: info.trim(), firstBodyLine: i + 2, body: [] };
      continue;
    }
    const closes = fence[0] === open.char && fence.length >= open.len && info.trim() === '';
    if (!closes) {
      open.body.push(lines[i]);
      continue;
    }
    const lang = open.info.split(/\s+/)[0].toLowerCase();
    if (TS_LANGS.has(lang)) {
      const dedent = open.indent.length
        ? open.body.map((l) => (l.startsWith(open.indent) ? l.slice(open.indent.length) : l.replace(/^[ \t]+/, '')))
        : open.body;
      blocks.push({
        lang,
        info: open.info,
        firstBodyLine: open.firstBodyLine,
        declaredPartial: /(^|\s)partial(\s|$)/.test(open.info),
        code: dedent.join('\n'),
      });
    }
    open = null;
  }
  return blocks;
}

/**
 * The INFERRED elision marker: a comment carrying an ellipsis, or a bare `...`
 * line. Used ONLY to compute the disqualified `exclusion` reading — the
 * tolerance rule never consults it.
 */
export function hasElisionMarker(code) {
  return code.split('\n').some((line) => {
    const t = line.trim();
    if (t === '...') return true;
    if (t.startsWith('//') && t.includes('...')) return true;
    if (t.startsWith('/*') && t.includes('...')) return true;
    if (t.startsWith('*') && t.includes('...')) return true;
    return false;
  });
}

/** One tsc program holds every block, so every block must be a module. */
export const normalise = (code) => `${code}\nexport {};\n`;

// ── Diagnostic classification ──────────────────────────────────────────────

const FORGIVEN_NAME_CODES = new Set([2304, 2552, 2503]);
const SYNTAX_MAX = 1999;

/**
 * Pure so the self-test can drive it without a compiler: takes the two fields
 * of a diagnostic that decide its family.
 */
export function classifyDiagnostic({ code, message }) {
  if (code >= 1000 && code <= SYNTAX_MAX) return { family: 'syntax', forgiven: false };
  if (FORGIVEN_NAME_CODES.has(code)) return { family: 'elided-name', forgiven: true };
  if (code === 2307) {
    const spec = /Cannot find module '([^']+)'/.exec(message)?.[1] ?? '';
    if (spec.startsWith('.')) return { family: 'doc-local-path', forgiven: true, specifier: spec };
    if (spec.startsWith('@objectstack/')) return { family: 'unpublished-subpath', forgiven: false, specifier: spec };
    return { family: 'external-not-installed', forgiven: true, specifier: spec };
  }
  if (code >= 7000 && code <= 7099) return { family: 'implicit-any', forgiven: false };
  return { family: 'semantic', forgiven: false };
}

/** The families `classifyDiagnostic` marks forgiven — a legitimately partial block can produce these and nothing else. */
export const FORGIVEN_FAMILIES = new Set(['elided-name', 'doc-local-path', 'external-not-installed']);

export const flattenMessage = (d) => ts.flattenDiagnosticMessageText(d.messageText, ' ');

// ── Controls ───────────────────────────────────────────────────────────────

/** MUST compile. Its failure means the workspace is not built — refuse, never report. */
export const GREEN_CONTROL = [
  '# green control',
  '',
  '```ts',
  "import { ObjectKernel } from '@objectstack/core';",
  '',
  'const KernelCtor: typeof ObjectKernel = ObjectKernel;',
  'export { KernelCtor };',
  '```',
  '',
].join('\n');

/**
 * MUST be reported failing, with TS2341, under BOTH readings.
 * Reconstructed byte-for-byte from PR #18712's diff (the `-` side of
 * packages/core/PHASE2_IMPLEMENTATION.md's "Integration with Kernel" block),
 * the one failure in this family anyone has measured: `tsc --noEmit --strict`
 * exit 2, TS2341 `Property 'logger' is private`.
 *
 * ⭐ Its last comment line is `// ... plugin registration code ...`, which is
 * why the exclusion reading is reported as DISQUALIFIED rather than offered.
 */
export const FIRING_CONTROL = [
  '# firing control',
  '',
  '```typescript',
  'import { ',
  '  ObjectKernel,',
  '  PluginHealthMonitor,',
  '  HotReloadManager,',
  '  DependencyResolver,',
  '  PluginPermissionManager,',
  '  PluginSandboxRuntime',
  "} from '@objectstack/core';",
  '',
  "const kernel = new ObjectKernel({ logger: { level: 'info' } });",
  '',
  '// Initialize Phase 2 components',
  'const healthMonitor = new PluginHealthMonitor(kernel.logger);',
  'const hotReload = new HotReloadManager(kernel.logger);',
  'const depResolver = new DependencyResolver(kernel.logger);',
  'const permManager = new PluginPermissionManager(kernel.logger);',
  'const sandbox = new PluginSandboxRuntime(kernel.logger);',
  '',
  '// Register plugins with enhanced features',
  '// ... plugin registration code ...',
  '',
  '// Bootstrap kernel',
  'await kernel.bootstrap();',
  '```',
  '',
].join('\n');

// ── Resolution: a `paths` map generated from each package's own exports map ──

/** Walk a conditional exports value for the `types` condition an importer sees. */
export function pickTypesTarget(value) {
  if (typeof value === 'string') return /\.d\.[cm]?ts$/.test(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.types === 'string') return value.types;
  for (const condition of ['import', 'node', 'default', 'require', 'browser']) {
    if (condition in value) {
      const found = pickTypesTarget(value[condition]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * ⛔ A subpath with no entry here gets NO mapping, so it fails TS2307 and is
 * counted — that is the point: the census sees exactly what a consumer sees.
 */
export function workspacePaths(packageRoots) {
  const paths = {};
  for (const dir of packageRoots) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!manifest.name || manifest.private === true) continue;
    const add = (specifier, target) => {
      if (target) paths[specifier] = [join(dir, target)];
    };
    if (manifest.exports && typeof manifest.exports === 'object') {
      for (const [key, value] of Object.entries(manifest.exports)) {
        if (!key.startsWith('.')) continue;
        const specifier = key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`;
        add(specifier, pickTypesTarget(value));
      }
    } else if (typeof manifest.exports === 'string') {
      add(manifest.name, pickTypesTarget(manifest.exports));
    }
    if (!paths[manifest.name] && typeof manifest.types === 'string') add(manifest.name, manifest.types);
  }
  return paths;
}

/** Third-party packages live in each package's own store under pnpm, never at the root. */
export function externalPaths(specifiers, packageRoots) {
  const paths = {};
  const searchRoots = [REPO_ROOT, ...packageRoots];
  for (const specifier of specifiers) {
    if (specifier.startsWith('.') || specifier.startsWith('@objectstack/') || specifier.startsWith('node:')) continue;
    const parts = specifier.split('/');
    const pkgName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    for (const root of searchRoots) {
      const candidate = join(root, 'node_modules', pkgName);
      if (existsSync(candidate)) {
        paths[pkgName] = [candidate];
        paths[`${pkgName}/*`] = [join(candidate, '*')];
        break;
      }
    }
  }
  return paths;
}

const IMPORT_SPECIFIER_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
export const specifiersIn = (code) => [...code.matchAll(IMPORT_SPECIFIER_RE)].map((m) => m[1]);

// ── Compilation ────────────────────────────────────────────────────────────

function compilerOptions(paths) {
  return {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    forceConsistentCasingInFileNames: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    baseUrl: REPO_ROOT,
    typeRoots: [join(REPO_ROOT, 'node_modules', '@types')],
    types: ['node'],
    paths,
  };
}

/**
 * One program for every block at once. Per-block programs would multiply the
 * `.d.ts` closure by a thousand; the `export {}` normalisation is what makes
 * one program safe.
 */
function compile(units, packageRoots) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'os-md-ts-census-'));
  const cleanup = () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* a leftover temp dir is not worth failing a census over */
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  try {
    const fileNames = units.map((unit, index) => {
      const file = join(tmpDir, `block-${String(index).padStart(4, '0')}.${unit.lang === 'tsx' ? 'tsx' : 'ts'}`);
      writeFileSync(file, normalise(unit.code));
      unit.compiledAs = file;
      return file;
    });
    const specifiers = new Set(units.flatMap((unit) => specifiersIn(unit.code)));
    const paths = { ...workspacePaths(packageRoots), ...externalPaths(specifiers, packageRoots) };
    const program = ts.createProgram(fileNames, compilerOptions(paths));
    const byFile = new Map(fileNames.map((f) => [f, []]));
    const global = [];
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      const record = {
        code: diagnostic.code,
        message: flattenMessage(diagnostic),
        line: diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
          : null,
      };
      const bucket = diagnostic.file ? byFile.get(diagnostic.file.fileName) : null;
      if (bucket) bucket.push(record);
      else if (!diagnostic.file) global.push(record);
    }
    for (const unit of units) {
      unit.diagnostics = (byFile.get(unit.compiledAs) ?? []).map((record) => ({
        ...record,
        ...classifyDiagnostic(record),
      }));
      unit.raw = unit.diagnostics.length > 0;
      unit.tolerant = unit.diagnostics.some((d) => !d.forgiven);
      unit.elided = hasElisionMarker(unit.code);
      const unforgiven = unit.diagnostics.filter((d) => !d.forgiven);
      unit.syntaxOnly = unforgiven.length > 0 && unforgiven.every((d) => d.family === 'syntax');
    }
    return { global, paths };
  } finally {
    cleanup();
  }
}

// ── Census ─────────────────────────────────────────────────────────────────

function collectUnits(only) {
  let files = populationFiles();
  if (only.length) files = files.filter((f) => only.some((o) => relative(REPO_ROOT, f).includes(o)));
  const units = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    extractBlocks(readFileSync(file, 'utf8')).forEach((block, index) => {
      units.push({ ...block, file: rel, index, kind: 'corpus', stratum: stratumOf(rel), depthOne: isDepthOne(rel) });
    });
  }
  return { files, units };
}

function controlUnits() {
  return [
    { ...extractBlocks(GREEN_CONTROL)[0], file: 'control:green', index: 0, kind: 'control', control: 'green', stratum: 'control' },
    { ...extractBlocks(FIRING_CONTROL)[0], file: 'control:firing', index: 0, kind: 'control', control: 'firing', stratum: 'control' },
  ];
}

/** The refusal list. Empty means the instrument proved it can fire before reporting. */
export function controlProblems(controls) {
  const problems = [];
  const green = controls.find((c) => c.control === 'green');
  const firing = controls.find((c) => c.control === 'firing');
  if (!green) problems.push('GREEN_CONTROL did not extract to a block — the extractor is broken.');
  else if (green.raw) {
    problems.push(
      `GREEN_CONTROL did NOT compile (${green.diagnostics.map((d) => `TS${d.code}`).join(', ')}). `
        + 'A block that must compile did not, so nothing else this run would report is a reading. '
        + 'The usual cause is an unbuilt workspace: run `pnpm build` so each package has the '
        + '`dist/*.d.ts` its own exports map points at, then re-run.',
    );
    for (const d of green.diagnostics.slice(0, 4)) problems.push(`  GREEN_CONTROL TS${d.code}: ${d.message}`);
  }
  if (!firing) problems.push('FIRING_CONTROL did not extract to a block — the extractor is broken.');
  else {
    if (!firing.raw) {
      problems.push(
        'FIRING_CONTROL compiled CLEAN. It reconstructs the pre-#18712 `kernel.logger` block, which measured '
          + 'exit 2 / TS2341. An instrument that cannot reproduce the one failure this family has proven has '
          + 'measured nothing, so this run reports nothing.',
      );
    }
    if (!firing.diagnostics.some((d) => d.code === 2341)) {
      problems.push(
        'FIRING_CONTROL did not produce TS2341 (private member access). It may be failing for an unrelated '
          + `reason — it reported: ${firing.diagnostics.map((d) => `TS${d.code}`).join(', ') || 'nothing'}.`,
      );
    }
    if (firing.raw && !firing.tolerant) {
      problems.push('The tolerance rule FORGAVE the firing control — the rule has been widened until it hides the proven defect.');
    }
    if (!firing.elided) {
      problems.push(
        'FIRING_CONTROL no longer carries an elision marker, so this run cannot demonstrate why the exclusion '
          + 'reading is disqualified. Restore the `// ... plugin registration code ...` line from PR #18712.',
      );
    }
  }
  return problems;
}

const EMPTY_STRATUM = () => ({
  blocks: 0, raw: 0, tolerant: 0, elided: 0, syntaxOnly: 0,
  exclusionConsidered: 0, exclusionFail: 0, files: new Set(), filesFailing: new Set(),
});

export function summarise(units) {
  const strata = {};
  const depthOne = EMPTY_STRATUM();
  const families = {};
  for (const unit of units) {
    const bucket = (strata[unit.stratum] ??= EMPTY_STRATUM());
    for (const target of unit.depthOne ? [bucket, depthOne] : [bucket]) {
      target.blocks += 1;
      target.files.add(unit.file);
      if (unit.raw) target.raw += 1;
      if (unit.tolerant) {
        target.tolerant += 1;
        target.filesFailing.add(unit.file);
      }
      if (unit.elided) target.elided += 1;
      if (unit.syntaxOnly) target.syntaxOnly += 1;
      if (!unit.elided) {
        target.exclusionConsidered += 1;
        if (unit.raw) target.exclusionFail += 1;
      }
    }
    for (const d of unit.diagnostics) {
      const f = (families[d.family] ??= { diagnostics: 0, blocks: new Set(), codes: {} });
      f.diagnostics += 1;
      f.blocks.add(`${unit.file}#${unit.index}`);
      f.codes[`TS${d.code}`] = (f.codes[`TS${d.code}`] ?? 0) + 1;
    }
  }
  return { strata, depthOne, families };
}

const pct = (n, d) => (d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1).padStart(5)}%`);

function reportStratum(label, s) {
  console.log(`\n  ${label}`);
  console.log(`    files with TS blocks ......... ${s.files.size}`);
  console.log(`    fenced ts/typescript/tsx .... ${s.blocks}`);
  console.log(`    RAW      fail ............... ${String(s.raw).padStart(4)}  ${pct(s.raw, s.blocks)}   (upper bound)`);
  console.log(`    TOLERANT fail ............... ${String(s.tolerant).padStart(4)}  ${pct(s.tolerant, s.blocks)}   (lower bound — the gate-able number)`);
  console.log(`    files carrying >=1 tolerant fail: ${s.filesFailing.size}`);
  console.log(`    blocks whose only unforgiven diagnostics are SYNTAX (would need an explicit \`partial\` tag): ${s.syntaxOnly}`);
  console.log(`    [disqualified] EXCLUSION reading: ${s.exclusionFail} fail of ${s.exclusionConsidered} considered, ${s.elided} blocks skipped for carrying an elision marker`);
}

function report(units, controls, summary, files) {
  const firing = controls.find((c) => c.control === 'firing');
  console.log('markdown TS block census — package-root Markdown under packages/ (#18715)');
  console.log('\nCONTROLS (they run on every census, so a zero is a reading and not a dead search)');
  console.log('  GREEN_CONTROL  compiles clean — `@objectstack/*` resolves through the built exports maps.');
  console.log(
    `  FIRING_CONTROL reports ${firing.diagnostics.length} diagnostic(s) including `
      + `TS2341 at block line ${firing.diagnostics.find((d) => d.code === 2341)?.line ?? '?'} — `
      + 'the pre-#18712 `kernel.logger` block, reconstructed from that PR\'s diff, is caught.',
  );
  console.log(
    '  FIRING_CONTROL also carries an elision marker, so the EXCLUSION reading SKIPS it. '
      + 'That is why exclusion is reported below as disqualified rather than offered.',
  );

  console.log('\nPOPULATION');
  console.log(`  package roots scanned ....... ${findPackageRoots(PACKAGES_DIR).length}`);
  console.log(`  package-root .md files ...... ${files.length}`);

  for (const [label, key] of [['HAND-WRITTEN (repairable by an author)', 'handwritten'], ['CHANGELOG.md (release-owned history)', 'changelog']]) {
    if (summary.strata[key]) reportStratum(label, summary.strata[key]);
  }
  reportStratum('SUB-STRATUM: the literal packages/<pkg>/*.md glob #18715 names', summary.depthOne);

  console.log('\nDIAGNOSTIC FAMILIES (every diagnostic on every corpus block)');
  const rows = Object.entries(summary.families).sort((a, b) => b[1].diagnostics - a[1].diagnostics);
  for (const [family, f] of rows) {
    const mark = FORGIVEN_FAMILIES.has(family) ? 'forgiven' : 'COUNTED ';
    const top = Object.entries(f.codes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}x${n}`).join(' ');
    console.log(`  ${mark}  ${family.padEnd(24)} ${String(f.diagnostics).padStart(5)} diagnostics in ${String(f.blocks.size).padStart(4)} blocks   ${top}`);
  }

  console.log('\nPER FILE — blocks / raw fail / tolerant fail  (files with at least one tolerant fail)');
  const perFile = new Map();
  for (const unit of units) {
    const row = perFile.get(unit.file) ?? { blocks: 0, raw: 0, tolerant: 0, stratum: unit.stratum };
    row.blocks += 1;
    if (unit.raw) row.raw += 1;
    if (unit.tolerant) row.tolerant += 1;
    perFile.set(unit.file, row);
  }
  const failing = [...perFile.entries()].filter(([, r]) => r.tolerant > 0).sort((a, b) => b[1].tolerant - a[1].tolerant);
  for (const [file, r] of failing) {
    console.log(`  ${String(r.blocks).padStart(4)} ${String(r.raw).padStart(4)} ${String(r.tolerant).padStart(4)}  ${file}`);
  }
  const clean = [...perFile.entries()].filter(([, r]) => r.tolerant === 0);
  console.log(`\n  ${clean.length} file(s) with TS blocks and zero tolerant failures.`);
  console.log('\n⛔ This is a census. It exits 0 on every outcome and gates nothing.');
}

function toJson(units, controls, summary, files) {
  const plain = (s) => ({ ...s, files: s.files.size, filesFailing: s.filesFailing.size });
  return {
    issue: 18715,
    population: { packageRoots: findPackageRoots(PACKAGES_DIR).length, markdownFiles: files.length },
    controls: controls.map((c) => ({
      control: c.control,
      diagnostics: c.diagnostics.map((d) => ({ code: d.code, family: d.family, forgiven: d.forgiven, line: d.line })),
      elided: c.elided,
      tolerantFail: c.tolerant,
    })),
    strata: Object.fromEntries(Object.entries(summary.strata).map(([k, v]) => [k, plain(v)])),
    depthOneSubStratum: plain(summary.depthOne),
    families: Object.fromEntries(Object.entries(summary.families).map(([k, v]) => [k, { diagnostics: v.diagnostics, blocks: v.blocks.size, codes: v.codes }])),
    blocks: units.map((u) => ({
      file: u.file, index: u.index, lang: u.lang, firstBodyLine: u.firstBodyLine,
      stratum: u.stratum, elided: u.elided, declaredPartial: u.declaredPartial,
      rawFail: u.raw, tolerantFail: u.tolerant, syntaxOnly: u.syntaxOnly,
      diagnostics: u.diagnostics.map((d) => ({ code: d.code, family: d.family, forgiven: d.forgiven, line: d.line, message: d.message })),
    })),
  };
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// Set as `selfTest()`'s LAST statement, after its verdict prints, and read at
// the dispatch: a `return` above the verdict prints nothing and still exits 0,
// which would report a self-test that never finished as one that passed.
let selfTestReachedVerdict = false;

// The roster is a LITERAL the table is checked against — ⛔ never derived from
// the table, because `cases.length` moves with the table and a deleted row
// would delete its own floor. Each row LABEL is one battery with a floor of 1;
// `registerCase(c.label)` is the FIRST statement of the loop body, so the floor
// asserts REACH and a row whose guard always skipped would read DID NOT RUN.
//
// SCOPE: these batteries cover the EXTRACTOR, the elision proxy, the
// classifier and the fixtures — everything that needs no compiler. The two
// CONTROLS are deliberately not here: they need a built workspace, and they
// run on every census rather than only when someone types `--self-test`.
// `controlProblems()` is their refusal, and it is not optional either.
const SELF_TEST_BATTERIES = Object.freeze({
  'extract — a plain ```ts fence is a block': 1,
  'extract — a ```typescript fence is a block': 1,
  'extract — a ```tsx fence is a block': 1,
  'extract — a tilde fence is a block': 1,
  'extract — a non-TypeScript language is not a block': 1,
  'extract — an indented fence is dedented to column 0': 1,
  'extract — a ts fence nested inside another fence is body, not a block': 1,
  'extract — an unterminated fence yields no block': 1,
  'extract — an info string carrying `partial` reads as declared-partial': 1,
  'elision — a trailing `// ... plugin registration code ...` is a marker': 1,
  'elision — ordinary comments are not an elision marker': 1,
  'classify — TS2304 is FORGIVEN (the name the block elided)': 1,
  'classify — TS2341 is COUNTED (private member — the one proven defect)': 1,
  'classify — TS2307 on a relative specifier is FORGIVEN': 1,
  'classify — TS2307 on an @objectstack specifier is COUNTED': 1,
  'classify — TS1005 syntax is COUNTED, never forgiven as elision': 1,
  'normalise — `export {}` is appended and body line numbers are unchanged': 1,
  'fixture — FIRING_CONTROL extracts to one block that reads kernel.logger': 1,
  'fixture — FIRING_CONTROL carries the elision marker that disqualifies exclusion': 1,
  'fixture — GREEN_CONTROL extracts to one block importing @objectstack/core': 1,
  'population — stratumOf separates CHANGELOG.md from hand-written Markdown': 1,
  'population — isDepthOne separates a depth-1 package root from a nested one': 1,
  'exports — pickTypesTarget reads the types entry under the import condition': 1,
  'exports — a subpath a package does not export gets no mapping': 1,
});

// Deleting an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 24;

const md = (...lines) => lines.join('\n');

function selfTest() {
  const cases = [
    { label: 'extract — a plain ```ts fence is a block', run: () => (extractBlocks(md('```ts', 'const a = 1;', '```')).length === 1 ? null : 'expected 1 block') },
    { label: 'extract — a ```typescript fence is a block', run: () => (extractBlocks(md('```typescript', 'const a = 1;', '```'))[0]?.lang === 'typescript' ? null : 'expected a typescript block') },
    { label: 'extract — a ```tsx fence is a block', run: () => (extractBlocks(md('```tsx', 'const a = <b />;', '```'))[0]?.lang === 'tsx' ? null : 'expected a tsx block') },
    { label: 'extract — a tilde fence is a block', run: () => (extractBlocks(md('~~~ts', 'const a = 1;', '~~~')).length === 1 ? null : 'expected 1 block from a tilde fence') },
    { label: 'extract — a non-TypeScript language is not a block', run: () => (extractBlocks(md('```json', '{}', '```')).length === 0 ? null : 'json counted as TypeScript') },
    {
      label: 'extract — an indented fence is dedented to column 0',
      run: () => {
        const b = extractBlocks(md('- item', '', '  ```ts', '  const a = 1;', '  ```'))[0];
        return b && b.code === 'const a = 1;' ? null : `expected dedented code, got ${JSON.stringify(b?.code)}`;
      },
    },
    {
      label: 'extract — a ts fence nested inside another fence is body, not a block',
      run: () => (extractBlocks(md('````md', '```ts', 'const a = 1;', '```', '````')).length === 0 ? null : 'a quoted fence was counted as shipped code'),
    },
    { label: 'extract — an unterminated fence yields no block', run: () => (extractBlocks(md('```ts', 'const a = 1;')).length === 0 ? null : 'an unterminated fence produced a block') },
    { label: 'extract — an info string carrying `partial` reads as declared-partial', run: () => (extractBlocks(md('```ts partial', 'const a = 1;', '```'))[0]?.declaredPartial === true ? null : 'the partial tag was not read') },
    { label: 'elision — a trailing `// ... plugin registration code ...` is a marker', run: () => (hasElisionMarker('const a = 1;\n// ... plugin registration code ...') ? null : 'marker missed') },
    { label: 'elision — ordinary comments are not an elision marker', run: () => (hasElisionMarker('// build the kernel\nconst a = 1;') ? 'an ordinary comment read as an elision' : null) },
    { label: 'classify — TS2304 is FORGIVEN (the name the block elided)', run: () => (classifyDiagnostic({ code: 2304, message: "Cannot find name 'kernel'." }).forgiven ? null : 'TS2304 not forgiven') },
    { label: 'classify — TS2341 is COUNTED (private member — the one proven defect)', run: () => (classifyDiagnostic({ code: 2341, message: "Property 'logger' is private." }).forgiven ? 'TS2341 forgiven — the proven defect would be invisible' : null) },
    { label: 'classify — TS2307 on a relative specifier is FORGIVEN', run: () => (classifyDiagnostic({ code: 2307, message: "Cannot find module './my-kernel' or its corresponding type declarations." }).forgiven ? null : 'a doc-local path was counted') },
    { label: 'classify — TS2307 on an @objectstack specifier is COUNTED', run: () => (classifyDiagnostic({ code: 2307, message: "Cannot find module '@objectstack/core/plugin' or its corresponding type declarations." }).forgiven ? 'an unpublished subpath was forgiven' : null) },
    { label: 'classify — TS1005 syntax is COUNTED, never forgiven as elision', run: () => (classifyDiagnostic({ code: 1005, message: "';' expected." }).family === 'syntax' && !classifyDiagnostic({ code: 1005, message: '' }).forgiven ? null : 'syntax forgiven') },
    {
      label: 'normalise — `export {}` is appended and body line numbers are unchanged',
      run: () => {
        const b = extractBlocks(md('# t', '', '```ts', 'const a = 1;', '```'))[0];
        if (b.firstBodyLine !== 4) return `firstBodyLine ${b.firstBodyLine}, expected 4`;
        const n = normalise(b.code);
        return n.startsWith('const a = 1;') && n.includes('export {};') ? null : 'normalisation changed the head of the block';
      },
    },
    {
      label: 'fixture — FIRING_CONTROL extracts to one block that reads kernel.logger',
      run: () => {
        const b = extractBlocks(FIRING_CONTROL);
        if (b.length !== 1) return `expected 1 block, got ${b.length}`;
        return b[0].code.includes('kernel.logger') ? null : 'the fixture no longer reaches into kernel.logger';
      },
    },
    { label: 'fixture — FIRING_CONTROL carries the elision marker that disqualifies exclusion', run: () => (hasElisionMarker(extractBlocks(FIRING_CONTROL)[0].code) ? null : 'the fixture lost its elision marker, and with it the exclusion argument') },
    {
      label: 'fixture — GREEN_CONTROL extracts to one block importing @objectstack/core',
      run: () => {
        const b = extractBlocks(GREEN_CONTROL);
        if (b.length !== 1) return `expected 1 block, got ${b.length}`;
        return specifiersIn(b[0].code).includes('@objectstack/core') ? null : 'the green control stopped importing anything';
      },
    },
    { label: 'population — stratumOf separates CHANGELOG.md from hand-written Markdown', run: () => (stratumOf('packages/core/CHANGELOG.md') === 'changelog' && stratumOf('packages/core/README.md') === 'handwritten' ? null : 'stratum split broken') },
    { label: 'population — isDepthOne separates a depth-1 package root from a nested one', run: () => (isDepthOne('packages/core/README.md') && !isDepthOne('packages/plugins/plugin-auth/README.md') ? null : 'depth-1 sub-stratum broken') },
    {
      label: 'exports — pickTypesTarget reads the types entry under the import condition',
      run: () => {
        const target = pickTypesTarget({ browser: { import: { types: './dist/browser.d.mts' } }, import: { types: './dist/index.d.mts', default: './dist/index.mjs' }, require: { types: './dist/index.d.ts' } });
        return target === './dist/index.d.mts' ? null : `picked ${target}`;
      },
    },
    {
      label: 'exports — a subpath a package does not export gets no mapping',
      run: () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-md-ts-selftest-'));
        try {
          writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@x/y', exports: { '.': { types: './dist/index.d.ts' } } }));
          const paths = workspacePaths([dir]);
          return paths['@x/y'] && !paths['@x/y/secret'] ? null : 'an unexported subpath was mapped anyway';
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ];

  let failed = 0;
  const batterySeen = new Map();
  const registerCase = (name) => batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  for (const c of cases) {
    registerCase(c.label);
    let verdict;
    try {
      verdict = c.run();
    } catch (error) {
      verdict = `threw: ${error.message}`;
    }
    if (verdict) {
      failed += 1;
      console.error(`  ✗ ${c.label}\n      ${verdict}`);
    }
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failed += 1;
    console.error(`  ✗ SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (name in SELF_TEST_BATTERIES) continue;
    failed += 1;
    console.error(`  ✗ battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    failed += 1;
    console.error(count === 0
      ? `  ✗ battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
      : `  ✗ battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`);
  }

  if (failed > 0) {
    console.error(`\n✗ measure-markdown-ts-blocks self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ measure-markdown-ts-blocks self-test: ${cases.length} cases pass, ${declared.length} batteries at or above floor.`);
  selfTestReachedVerdict = true;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ measure-markdown-ts-blocks self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test that never\n'
          + 'finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const wantJson = argv.includes('--json');
  const controlsOnly = argv.includes('--controls-only');
  const only = argv.flatMap((arg, i) => (arg === '--only' && argv[i + 1] ? [argv[i + 1]] : []));

  const packageRoots = findPackageRoots(PACKAGES_DIR);
  const { files, units } = controlsOnly ? { files: [], units: [] } : collectUnits(only);
  const controls = controlUnits();
  const { global } = compile([...controls, ...units], packageRoots);

  const problems = controlProblems(controls);
  for (const g of global) problems.push(`compiler option diagnostic TS${g.code}: ${g.message}`);
  if (problems.length > 0) {
    console.error('✗ measure-markdown-ts-blocks REFUSES to report a census:\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      '\n"could not run" is a failure, not a skip. A census that degraded to "0 failures" because\n'
        + 'nothing resolved would be the worst output this instrument could produce.\n',
    );
    process.exit(1);
  }

  const summary = summarise(units);
  if (wantJson) console.log(JSON.stringify(toJson(units, controls, summary, files), null, 2));
  else if (controlsOnly) console.log('✓ both controls behaved: GREEN compiles, FIRING reports TS2341 and survives the tolerance rule.');
  else report(units, controls, summary, files);
}

main();
