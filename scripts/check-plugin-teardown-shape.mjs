#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-plugin-teardown-shape (#10619) -- a `Plugin` implementation that spells
 * its teardown `stop()` / `shutdown()` / `close()` / `dispose()` and declares no
 * `destroy()` is never torn down, because `destroy()` is the only teardown hook
 * the kernel calls.
 *
 *   node scripts/check-plugin-teardown-shape.mjs              # audit packages/**
 *   node scripts/check-plugin-teardown-shape.mjs --list       # print the census
 *   node scripts/check-plugin-teardown-shape.mjs --self-test  # verify the checker
 *
 * ## The defect
 *
 * `Plugin` (`packages/core/src/types.ts`) declares `init()`, `start?(ctx)` and
 * `destroy?()`. There is no `stop()` on it. `ObjectKernel.performShutdown()`
 * and `LiteKernel.destroy()` walk the plugins in reverse and call
 * `plugin.destroy()` -- nothing anywhere calls `stop()`, `dispose()`, `close()`
 * or `shutdown()` on a plugin.
 *
 * So a plugin whose teardown is spelled `stop()` keeps its timers armed after
 * `await kernel.shutdown()` has RESOLVED. #9371 measured that as 48 further
 * delivery reads/writes in the 80 ms after a resolved shutdown, and its bill
 * landed as merge-queue evictions of two green PRs -- because a host process
 * survives the leak (the timers are `unref`'d) while a test process does not.
 *
 * ## Why a gate rather than the six repairs
 *
 * The trap is an ASYMMETRY, and it is what let this survive review in two
 * packages. `start?()` IS on the interface and does fire, so a `start`/`stop`
 * pair reads symmetric to a reviewer while only one half is ever called. Fix
 * the known instances and the next one arrives spelled `shutdown()` or
 * `close()`; a gate makes the whole class unreachable.
 *
 * ## The teardown roster, and what is deliberately NOT on it
 *
 * ON THE ROSTER -- `stop`, `shutdown`, `close`, `dispose`. These four are the
 * whole of the JS/Node vocabulary an author reaches for when they mean "the
 * runtime will call this at the end of my object's life": `server.close()`,
 * `Symbol.dispose`, and the `stop`/`shutdown` pair every long-running service
 * uses. Measured over this tree's 54 `Plugin` implementations at the time of
 * writing: `stop` x10, `dispose` x2, `close` x0 methods, `shutdown` x0. Two of
 * the four have no instance today and that is the POINT -- the class closes for
 * the seventh instance, not for the sixth.
 *
 * OFF THE ROSTER, on purpose. Every exclusion below was considered and turned
 * down for a stated reason, because a roster chosen silently is the thing that
 * goes stale:
 *
 *   - `end`, `release`, `disconnect`, `abort`, `cancel`, `drain`, `flush`,
 *     `unbind` -- each names ONE resource, request or period, not the object's
 *     own end of life. `disconnect()` on a connector plugin plausibly drops a
 *     single connection; `release()` releases a lock; `end()` ends a stream.
 *     Each has a live domain reading in this product and none has an instance
 *     here, so the roster would buy a false-positive risk for nothing.
 *   - `cleanup`, `teardown` -- test-harness vocabulary. A helper named
 *     `cleanup()` inside a plugin is ordinary, and no plugin in this tree spells
 *     its own teardown that way.
 *   - `deactivate`, `unload`, `unmount`, `finalize`, `quit`, `halt`,
 *     `terminate`, `kill` -- no instance, no precedent in this repo's runtime
 *     surface, and each is more plausible as a DOMAIN verb (deactivate a user,
 *     unload a package) than as a plugin's teardown.
 *
 * The one roster member carrying a live domain reading is `close` -- an
 * approval or an accounting period is "closed". It is kept because it is the
 * canonical Node teardown verb, and because the shape rule below already
 * removes the one specimen in this tree that would otherwise have been a false
 * positive (see the next section). If a genuine domain `close()` ever lands on
 * a `Plugin` class, the answer is to put that method on the SERVICE the plugin
 * registers -- domain verbs do not belong on the lifecycle object -- not to
 * widen this gate.
 *
 * `DELIBERATELY_EXCLUDED` below carries those names as DATA, and the self-test
 * asserts each one stays green. The exclusions are therefore pinned by cases,
 * not asserted by this paragraph.
 *
 * ## What counts as "declares a teardown-shaped method"
 *
 * A member of the class, not static, whose name is on the roster AND which is a
 * FUNCTION THE AUTHOR WROTE ON THE CLASS -- either a method with a body, or a
 * property initialised to an arrow/function expression.
 *
 * Both spellings are required, not one: 3 of this tree's 10 `stop` instances
 * are `stop = async (ctx) => { ... }` properties (`MetadataPlugin`,
 * `AppPlugin`, `ExternalValidationPlugin`), so a method-only scan misses them
 * and reports a smaller, confident, wrong number.
 *
 * A property that merely HOLDS a callback is not a declared teardown, and this
 * distinction is measured rather than assumed: `ConnectorMcpPlugin` keeps
 * `private close?: () => Promise<void>` -- a handle taken from a bundle, which
 * it calls from a real `destroy()`. That is correct code, it is the exact shape
 * a name-only scan would flag, and the self-test pins it green.
 *
 * ## What counts as the population
 *
 * Every non-`.d.ts` TypeScript source under `packages/**` whose text contains
 * the `implements` keyword, parsed through `scripts/ts-parse.mjs`, and every
 * class in it whose `implements` clause names `Plugin`.
 *
 *   - The pre-filter is sound rather than merely fast: `implements` is required
 *     SYNTAX for the shape being looked for, and its presence is a property of
 *     the source TEXT, so no parse state can hide it.
 *   - The `Plugin` symbol is NOT required to come from `@objectstack/core`.
 *     Measured: `CloudConnectionPlugin` declares its own structural `Plugin`
 *     interface on purpose ("dependency-light, no @objectstack/core") and is
 *     registered on the same kernel, torn down by the same `destroy()` loop.
 *     An import-anchored population would exclude exactly that plugin.
 *   - Test sources are IN the population. The kernel drives fixture plugins in
 *     tests too, so a fixture with `stop()` and no `destroy()` leaks in exactly
 *     the process where #9371's bill actually landed. Measured: zero test-file
 *     instances today, so including them costs nothing now and avoids an
 *     untested carve-out later.
 *   - `examples/` and `apps/` are not scanned because they contain no `Plugin`
 *     implementation at all -- swept at the time of writing, and a population
 *     literal naming an empty subtree is a dead declaration.
 *
 * ## Why every unreadable state is a REFUSAL, not a quiet pass
 *
 * This is a gate that computes its own population, so it is exactly the kind
 * that can pass while reading nothing: a population that resolves to zero
 * files, or to zero `Plugin` classes, produces an empty finding list, and an
 * empty finding list has no violations in it. Both exit 1 naming what could not
 * be read, as does a source that cannot be READ. A source that cannot be PARSED
 * is refused one level down by `scripts/ts-parse.mjs`, which names the file and
 * exits `EXIT_UNPARSEABLE` -- a different non-zero code, and deliberately so:
 * routing every parse through that module is what `check:parse-guard` enforces.
 * The self-test pins each refusal AND pairs it with a readable tree that still
 * returns a verdict, so "refuses unconditionally" cannot satisfy the battery.
 *
 * ## The known list
 *
 * `KNOWN_TEARDOWN_UNREACHED` baselined the instances that existed when this
 * gate landed. It is a ratchet that only shrinks -- an entry is deleted when
 * its plugin is repaired, and a stale entry is itself a failure. As of #10772
 * it is EMPTY: every baselined instance has been repaired (six under #10371,
 * the remaining five under #10772), so the gate now judges the whole
 * population with no exemptions at all.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * The declared population, in the subtree spelling this repo uses everywhere
 * for exactly that (`paths:` filters, turbo inputs, the `files` field).
 *
 * It is spelled as a glob and not as the bare word `packages` on purpose:
 * `scripts/pm/dispatch-gates.mjs` refuses a bare single-segment hint as too
 * generic, so a gate that declares its population that way is unnameable by any
 * dispatch derivation and lands already invisible.
 */
const POPULATION = 'packages/**';

/** The population's root directory, derived from the declaration above. */
const POPULATION_ROOT = POPULATION.split('/')[0];

/** Directories with no first-party source in them. */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.turbo', '.cache', '.next', '.git',
]);

/** The teardown names. See the header for how this roster was decided. */
export const TEARDOWN_ALIASES = ['stop', 'shutdown', 'close', 'dispose'];

/** The kernel's one teardown hook. */
const KERNEL_HOOK = 'destroy';

/**
 * Names considered for the roster and turned down, with the reason. Kept as
 * data so the self-test can assert each one stays green -- an exclusion pinned
 * by a case rather than by the header's prose.
 */
export const DELIBERATELY_EXCLUDED = {
  end: 'ends one stream or period, not the object',
  release: 'releases one lock or handle',
  disconnect: 'drops one connection, not the plugin',
  abort: 'request-scoped',
  cancel: 'request-scoped',
  drain: 'drains one queue',
  flush: 'flushes one buffer',
  unbind: 'unbinds one binding',
  cleanup: 'test-harness vocabulary',
  teardown: 'test-harness vocabulary',
  deactivate: 'a domain verb here (deactivate a user)',
  unload: 'a domain verb here (unload a package)',
  unmount: 'no precedent in this runtime',
  finalize: 'no precedent in this runtime',
  quit: 'no precedent in this runtime',
  halt: 'no precedent in this runtime',
  terminate: 'no precedent in this runtime',
  kill: 'no precedent in this runtime',
};

/**
 * The positive control: the REAL pre-repair specimen, not a synthesised class.
 *
 * `MessagingServicePlugin` as it stood on `main` immediately before PR #10375
 * landed the #9371 fix -- `async stop()`, no `destroy()`. The revision is the
 * squash merge's first parent, so the fixture is pinned to a commit rather than
 * to a copy of a file that could be edited into passing.
 */
const POSITIVE_CONTROL = {
  rev: '621a487607881c66b2899b7e3477115229a156b4',
  path: 'packages/services/service-messaging/src/messaging-service-plugin.ts',
  cls: 'MessagingServicePlugin',
  alias: 'stop',
};

/**
 * Every `Plugin` implementation that declared a teardown alias and no
 * `destroy()` when this gate landed -- and, since #10772, NONE OF THEM.
 *
 * ⛔ SHRINK-ONLY. The list only ever shrinks: an entry is DELETED when its
 * plugin grows a real `destroy()`, and a stale entry fails this gate. It is
 * closed to new entries -- see the failure text.
 *
 * The burn-down, so the empty array is a MEASURED state and not an abandoned
 * one. Eleven entries landed with the gate. Six were the instances #10371
 * enumerates, and #10371 repaired them. The other five were derived here
 * rather than adopted from that card, filed as #10772 and repaired there:
 * `MetadataPlugin`, `AppPlugin` and `ExternalValidationPlugin` spelled the
 * alias as an arrow PROPERTY (which a method-only reading of the class
 * misses -- that is precisely why #10371's own enumeration was short by
 * five), and `EmailServicePlugin` / `WebhookOutboxPlugin` spelled it
 * `dispose` -- the "seventh spelling" this gate's roster was widened for
 * before any instance of it existed, already present when the roster was
 * measured.
 *
 * An empty ratchet is the state this gate exists to reach, not a reason to
 * delete it: the roster, the population and the refusals are what keep the
 * class closed for the NEXT instance, and the self-test's live-tree case
 * ("neither short nor stale") is what keeps this array honest either way.
 */
const KNOWN_TEARDOWN_UNREACHED = [];

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/** Every TypeScript source under `dir`, recursively, skipping build output. */
export function walkSources(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(abs, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.d\.(ts|mts|cts)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** TSX only for `.tsx` -- forcing TSX on a `.ts` makes every generic wreckage. */
function scriptKindFor(fileName) {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Does this class's `implements` clause name `Plugin`? */
function implementsPlugin(node, sourceFile) {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
    for (const type of clause.types) {
      const text = type.expression.getText(sourceFile);
      if (text === 'Plugin' || text.endsWith('.Plugin')) return true;
    }
  }
  return false;
}

/**
 * The names of the functions this class DECLARES on itself -- a method with a
 * body, or a property initialised to an arrow/function expression. Static
 * members are not lifecycle hooks and are excluded; so is a property that
 * merely holds a callback, which is the `ConnectorMcpPlugin` shape.
 */
export function declaredFunctionNames(node) {
  const names = new Set();
  for (const member of node.members) {
    const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
    if (modifiers.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
    if (!member.name || !ts.isIdentifier(member.name)) continue;
    if (ts.isMethodDeclaration(member) && member.body) {
      names.add(member.name.text);
      continue;
    }
    if (
      ts.isPropertyDeclaration(member)
      && member.initializer
      && (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
    ) {
      names.add(member.name.text);
    }
  }
  return names;
}

/**
 * The `Plugin` implementations in one source, with the teardown aliases and the
 * kernel hook each one declares.
 *
 * @returns {Array<{cls: string, line: number, aliases: string[], hasKernelHook: boolean}>}
 */
export function pluginClassesIn(fileName, source) {
  const sourceFile = parseSourceFile(fileName, source, scriptKindFor(fileName));
  const found = [];
  const visit = (node) => {
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && implementsPlugin(node, sourceFile)) {
      const declared = declaredFunctionNames(node);
      found.push({
        cls: node.name?.text ?? '(anonymous)',
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        aliases: TEARDOWN_ALIASES.filter((a) => declared.has(a)),
        hasKernelHook: declared.has(KERNEL_HOOK),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Audit one tree. Returns the census and either the findings or a refusal --
 * never an empty finding list standing in for a population it could not read.
 *
 * @param {string} root  A directory containing the population root.
 * @returns {{files: number, classes: number, findings: Array<object>, refusal: string | null}}
 */
export function audit(root) {
  const populationDir = join(root, POPULATION_ROOT);
  let populationExists = false;
  try {
    populationExists = statSync(populationDir).isDirectory();
  } catch {
    populationExists = false;
  }
  if (!populationExists) {
    return {
      files: 0,
      classes: 0,
      findings: [],
      refusal: `the population root ${POPULATION} does not resolve to a directory under ${root}`,
    };
  }

  const files = walkSources(populationDir);
  if (files.length === 0) {
    return {
      files: 0,
      classes: 0,
      findings: [],
      refusal: `${POPULATION} resolved to a directory containing no TypeScript source`,
    };
  }

  const findings = [];
  let classes = 0;
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    let source;
    try {
      source = readFileSync(abs, 'utf8');
    } catch (error) {
      return {
        files: files.length,
        classes,
        findings: [],
        refusal: `${rel} could not be read (${error.code ?? error.message}) -- a source this gate cannot read is not a source with nothing to report`,
      };
    }
    if (!source.includes('implements')) continue;
    for (const found of pluginClassesIn(abs, source)) {
      classes += 1;
      if (found.hasKernelHook || found.aliases.length === 0) continue;
      for (const alias of found.aliases) {
        findings.push({ file: rel, cls: found.cls, alias, line: found.line });
      }
    }
  }

  if (classes === 0) {
    return {
      files: files.length,
      classes: 0,
      findings: [],
      refusal: `${files.length} source(s) under ${POPULATION} and not one Plugin implementation among them -- the population is unresolvable, which is not the same as clean`,
    };
  }

  return { files: files.length, classes, findings, refusal: null };
}

/** The ratchet key. One class may hold more than one alias. */
const keyOf = (row) => `${row.file}::${row.cls}::${row.alias}`;

/**
 * Compare observed findings against the known list, in both directions.
 *
 * @returns {{fresh: Array<object>, stale: Array<object>, held: number}}
 */
export function judge(findings, known) {
  const observed = new Map(findings.map((f) => [keyOf(f), f]));
  const declared = new Map(known.map((k) => [keyOf(k), k]));
  return {
    fresh: [...observed.values()].filter((f) => !declared.has(keyOf(f))),
    stale: [...declared.values()].filter((k) => !observed.has(keyOf(k))),
    held: [...observed.keys()].filter((k) => declared.has(k)).length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const { files, classes, findings, refusal } = audit(REPO_ROOT);
  if (refusal) {
    console.error(`❌  check:plugin-teardown-shape -- REFUSING to report a verdict: ${refusal}.`);
    console.error(
      '\n    A gate that computes its own population can pass while reading nothing,'
      + '\n    and an empty finding list is indistinguishable from a clean one. This'
      + '\n    exits non-zero instead. Restore the population or fix the tool.',
    );
    return 1;
  }

  const { fresh, stale, held } = judge(findings, KNOWN_TEARDOWN_UNREACHED);

  if (fresh.length) {
    console.error(
      `❌  check:plugin-teardown-shape -- ${fresh.length} Plugin implementation(s) declare a teardown the kernel never calls:\n`,
    );
    for (const f of fresh) {
      console.error(`  ${f.file}:${f.line}  ${f.cls}.${f.alias}()  -- no ${KERNEL_HOOK}()`);
    }
    console.error(
      `\n    The kernel's only teardown hook is ${KERNEL_HOOK}(). ObjectKernel.performShutdown()`
      + '\n    and LiteKernel.destroy() walk the plugins in reverse and call it; nothing'
      + `\n    anywhere calls ${TEARDOWN_ALIASES.join('(), ')}() on a plugin. So whatever the`
      + '\n    method above releases is still held after `await kernel.shutdown()` RESOLVES.'
      + '\n'
      + `\n    The repair is the #9371 one (PR #10375): move the body into ${KERNEL_HOOK}(), and`
      + '\n    keep the old name as a delegating alias, because it is public API of an'
      + '\n    exported class:'
      + '\n'
      + `\n      async ${KERNEL_HOOK}(): Promise<void> { /* the body that was in the alias */ }`
      + `\n      async ${TEARDOWN_ALIASES[0]}(): Promise<void> { await this.${KERNEL_HOOK}(); }`
      + '\n'
      + '\n    ⛔ Do not add an entry to KNOWN_TEARDOWN_UNREACHED to get past this. That'
      + '\n    list is shrink-only and closed to new entries: it baselined the instances'
      + '\n    that predate this gate, and since #10772 it is EMPTY -- every one of them'
      + '\n    has been repaired. Widening it is not a fix; it would reopen the class'
      + '\n    this gate exists to close, and it would be the first entry back.',
    );
    return 1;
  }

  if (stale.length) {
    console.error(`❌  check:plugin-teardown-shape -- ${stale.length} stale KNOWN_TEARDOWN_UNREACHED entry/entries:\n`);
    for (const s of stale) {
      console.error(`  ${s.file}  ${s.cls}.${s.alias}()  -- no longer unreached (${s.repair})`);
    }
    console.error(
      '\n    Good news, and the list must say so: delete each line above from'
      + '\n    KNOWN_TEARDOWN_UNREACHED in scripts/check-plugin-teardown-shape.mjs. The'
      + '\n    list only shrinks, and a stale line is how it would have started drifting'
      + '\n    into an allowlist nobody re-reads.',
    );
    return 1;
  }

  const repairCards = [...new Set(KNOWN_TEARDOWN_UNREACHED.map((k) => k.repair))].sort();
  console.log(
    `✓ check:plugin-teardown-shape: ${classes} Plugin implementation(s) across ${files} source(s) under ${POPULATION}; `
    + `every teardown-shaped method (${TEARDOWN_ALIASES.join(' / ')}) sits beside a real ${KERNEL_HOOK}() `
    + `(${held} known-unreached, ⛔ SHRINK-ONLY`
    + `${repairCards.length ? `, repair tracked on ${repairCards.join(' / ')}` : ', baseline fully burned down'}).`,
  );
  return 0;
}

/** `--list`: the whole census, for burning the known list down. */
function list() {
  const { files, classes, findings, refusal } = audit(REPO_ROOT);
  if (refusal) {
    console.error(`REFUSED: ${refusal}`);
    return 1;
  }
  const declared = new Set(KNOWN_TEARDOWN_UNREACHED.map(keyOf));
  for (const f of findings.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    console.log(`${declared.has(keyOf(f)) ? 'known' : 'FRESH'}  ${f.file}:${f.line}  ${f.cls}.${f.alias}()`);
  }
  console.log(`\n${classes} Plugin implementation(s) in ${files} source(s); ${findings.length} unreached teardown(s).`);
  return 0;
}

/**
 * `--audit-root <dir>`: audit an arbitrary tree and print the finding count.
 *
 * The self-test's out-of-process leg, and its only caller. It exists because
 * `ts-parse.mjs` refuses an unparseable source by ending the PROCESS, which is
 * the behaviour being asserted and cannot be observed from inside it.
 */
function auditRoot(root) {
  const { files, classes, findings, refusal } = audit(root);
  if (refusal) {
    console.error(`REFUSED: ${refusal}`);
    return 1;
  }
  console.log(`OK files=${files} classes=${classes} findings=${findings.length}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test -- fixture trees, and one REAL revision
// ---------------------------------------------------------------------------

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const SELF = fileURLToPath(import.meta.url);
  const dir = mkdtempSync(join(tmpdir(), 'teardown-shape-'));

  /** Build a fixture tree: `{ 'a/b.ts': source }` under `<tmp>/<name>/packages`. */
  const tree = (name, sources) => {
    const root = join(dir, name);
    for (const [rel, source] of Object.entries(sources)) {
      const abs = join(root, POPULATION_ROOT, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, source);
    }
    return root;
  };

  const plugin = (cls, body) => `import type { Plugin } from '@objectstack/core';\nexport class ${cls} implements Plugin {\n  name = '${cls}';\n  async init(): Promise<void> {}\n${body}\n}\n`;

  /** A tree that must always produce a verdict -- the paired control for every refusal. */
  const READABLE = { 'ok/src/p.ts': plugin('OkPlugin', '  async destroy(): Promise<void> {}') };

  try {
    // -- the positive control: the REAL pre-#10375 revision ------------------
    const show = spawnSync('git', ['show', `${POSITIVE_CONTROL.rev}:${POSITIVE_CONTROL.path}`], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    if (show.status !== 0) {
      console.error(
        `✗ check-plugin-teardown-shape self-test: cannot read the positive control at ${POSITIVE_CONTROL.rev}.`
        + '\n  The fixture is pinned to a commit rather than to an editable copy, so a checkout'
        + '\n  that cannot reach it cannot run this battery. Deepen the clone:'
        + '\n    git fetch --unshallow origin main',
      );
      rmSync(dir, { recursive: true, force: true });
      return 1;
    }
    const preFix = tree('positive', { [POSITIVE_CONTROL.path.slice(POPULATION_ROOT.length + 1)]: show.stdout });
    const preFixResult = audit(preFix);
    t(
      `the REAL pre-#10375 ${POSITIVE_CONTROL.cls} reds on ${POSITIVE_CONTROL.alias}()`,
      preFixResult.refusal === null
        && preFixResult.findings.length === 1
        && preFixResult.findings[0].cls === POSITIVE_CONTROL.cls
        && preFixResult.findings[0].alias === POSITIVE_CONTROL.alias,
      JSON.stringify(preFixResult.findings),
    );

    // -- the negative control from the same file, as REPAIRED ----------------
    const repaired = readFileSync(join(REPO_ROOT, POSITIVE_CONTROL.path), 'utf8');
    const postFix = tree('repaired', { [POSITIVE_CONTROL.path.slice(POPULATION_ROOT.length + 1)]: repaired });
    const postFixResult = audit(postFix);
    t(
      `the SAME file after the #9371 repair is green (${POSITIVE_CONTROL.alias}() delegates to ${KERNEL_HOOK}())`,
      postFixResult.refusal === null && postFixResult.findings.length === 0,
      JSON.stringify(postFixResult.findings),
    );

    // -- the delegating alias, both directions -------------------------------
    const aliasForward = audit(tree('alias-forward', {
      'a/src/p.ts': plugin('ForwardPlugin', `  async ${KERNEL_HOOK}(): Promise<void> {}\n  async stop(): Promise<void> { await this.${KERNEL_HOOK}(); }`),
    }));
    t('stop() delegating to destroy() stays GREEN', aliasForward.findings.length === 0, JSON.stringify(aliasForward.findings));

    const aliasReverse = audit(tree('alias-reverse', {
      'a/src/p.ts': plugin('ReversePlugin', `  async stop(): Promise<void> {}\n  async ${KERNEL_HOOK}(): Promise<void> { await this.stop(); }`),
    }));
    t('destroy() delegating to stop() stays GREEN', aliasReverse.findings.length === 0, JSON.stringify(aliasReverse.findings));

    const destroyOnly = audit(tree('destroy-only', {
      'a/src/p.ts': plugin('PlainPlugin', `  async ${KERNEL_HOOK}(): Promise<void> {}`),
    }));
    t('destroy() with no alias at all stays GREEN', destroyOnly.findings.length === 0, JSON.stringify(destroyOnly.findings));

    // -- every roster name reds --------------------------------------------
    for (const alias of TEARDOWN_ALIASES) {
      const r = audit(tree(`roster-${alias}`, {
        'a/src/p.ts': plugin('RosterPlugin', `  async ${alias}(): Promise<void> {}`),
      }));
      t(`${alias}() with no ${KERNEL_HOOK}() REDS`, r.findings.length === 1 && r.findings[0].alias === alias, JSON.stringify(r.findings));
    }

    // -- the arrow-property spelling, which a method-only scan misses --------
    const arrowProp = audit(tree('arrow-prop', {
      'a/src/p.ts': plugin('ArrowPlugin', '  stop = async (ctx: unknown): Promise<void> => { void ctx; };'),
    }));
    t('an arrow-PROPERTY alias reds (the MetadataPlugin/AppPlugin spelling)',
      arrowProp.findings.length === 1 && arrowProp.findings[0].alias === 'stop', JSON.stringify(arrowProp.findings));

    // -- a stored callback handle is not a declared teardown ----------------
    const handleWithHook = audit(tree('handle-with-hook', {
      'a/src/p.ts': plugin('HandlePlugin', `  private close?: () => Promise<void>;\n  async ${KERNEL_HOOK}(): Promise<void> { await this.close?.(); }`),
    }));
    t('a stored close HANDLE beside a real destroy() is GREEN (the ConnectorMcpPlugin shape)',
      handleWithHook.findings.length === 0, JSON.stringify(handleWithHook.findings));

    const handleAlone = audit(tree('handle-alone', {
      'a/src/p.ts': plugin('BareHandlePlugin', '  private close?: () => Promise<void>;'),
    }));
    t('a stored close HANDLE with no destroy() is still GREEN -- a handle is not a hook',
      handleAlone.findings.length === 0, JSON.stringify(handleAlone.findings));

    // -- the exclusions, pinned as cases rather than asserted in prose ------
    for (const name of Object.keys(DELIBERATELY_EXCLUDED)) {
      const r = audit(tree(`excluded-${name}`, {
        'a/src/p.ts': plugin('ExcludedPlugin', `  async ${name}(): Promise<void> {}`),
      }));
      t(`${name}() is off the roster and stays GREEN`, r.findings.length === 0, JSON.stringify(r.findings));
    }

    // -- population boundaries ---------------------------------------------
    const notAPlugin = audit(tree('not-a-plugin', {
      'a/src/p.ts': `import type { Plugin } from '@objectstack/core';\nexport class NotAPlugin implements Disposable {\n  async stop(): Promise<void> {}\n  [Symbol.dispose]() {}\n}\nexport class RealPlugin implements Plugin {\n  name = 'r';\n  async init(): Promise<void> {}\n  async ${KERNEL_HOOK}(): Promise<void> {}\n}\n`,
    }));
    t('a class that does not implement Plugin is out of population',
      notAPlugin.refusal === null && notAPlugin.findings.length === 0, JSON.stringify(notAPlugin));

    const localInterface = audit(tree('local-plugin-iface', {
      'a/src/p.ts': 'interface Plugin { name: string; init(): Promise<void>; }\nexport class LocalPlugin implements Plugin {\n  name = \'l\';\n  async init(): Promise<void> {}\n  async stop(): Promise<void> {}\n}\n',
    }));
    t('a locally-declared structural Plugin is IN population (the CloudConnectionPlugin shape)',
      localInterface.findings.length === 1 && localInterface.findings[0].cls === 'LocalPlugin', JSON.stringify(localInterface.findings));

    const staticMember = audit(tree('static-member', {
      'a/src/p.ts': plugin('StaticPlugin', '  static async stop(): Promise<void> {}'),
    }));
    t('a STATIC method of that name is not a lifecycle hook', staticMember.findings.length === 0, JSON.stringify(staticMember.findings));

    const testFixture = audit(tree('test-fixture', {
      'a/src/p.test.ts': plugin('FixturePlugin', '  async stop(): Promise<void> {}'),
    }));
    t('a test source is IN the population', testFixture.findings.length === 1, JSON.stringify(testFixture.findings));

    const declarations = audit(tree('declarations', {
      'a/src/p.d.ts': plugin('DeclaredPlugin', '  stop(): Promise<void>;'),
      ...READABLE,
    }));
    t('a .d.ts declaration file is not scanned', declarations.refusal === null && declarations.findings.length === 0, JSON.stringify(declarations));

    // -- the ratchet, in both directions -----------------------------------
    const known = [{ file: 'a/src/p.ts', cls: 'P', alias: 'stop', repair: '#10371' }];
    const exact = judge([{ file: 'a/src/p.ts', cls: 'P', alias: 'stop' }], known);
    t('a finding already on the known list is held, not fresh', exact.fresh.length === 0 && exact.stale.length === 0 && exact.held === 1);
    const freshOne = judge([{ file: 'a/src/q.ts', cls: 'Q', alias: 'stop' }], known);
    t('a finding NOT on the known list is fresh', freshOne.fresh.length === 1 && freshOne.stale.length === 1);
    const staleOne = judge([], known);
    t('a known entry that no longer reds is stale', staleOne.stale.length === 1 && staleOne.fresh.length === 0);
    const renamed = judge([{ file: 'a/src/p.ts', cls: 'P', alias: 'dispose' }], known);
    t('a known entry whose alias was RENAMED reads as one stale plus one fresh',
      renamed.fresh.length === 1 && renamed.stale.length === 1);

    // -- refusals, each PAIRED with a tree that still returns a verdict -----
    const emptyTree = tree('refuse-empty', {});
    mkdirSync(join(emptyTree, POPULATION_ROOT), { recursive: true });
    const emptyResult = audit(emptyTree);
    const pairedGreen = audit(tree('refuse-empty-pair', READABLE));
    t('a population with no source REFUSES, while a readable tree still returns a verdict',
      emptyResult.refusal !== null && pairedGreen.refusal === null && pairedGreen.findings.length === 0,
      JSON.stringify({ emptyResult, pairedGreen }));

    const noPopulation = audit(join(dir, 'refuse-missing-root'));
    const pairedRed = audit(tree('refuse-missing-pair', { 'a/src/p.ts': plugin('LeakyPlugin', '  async stop(): Promise<void> {}') }));
    t('a missing population root REFUSES, while a readable tree still reds',
      noPopulation.refusal !== null && pairedRed.refusal === null && pairedRed.findings.length === 1,
      JSON.stringify({ noPopulation, findings: pairedRed.findings }));

    const noPlugins = audit(tree('refuse-no-plugins', {
      'a/src/p.ts': 'export class NotAPlugin implements Iterable<string> {\n  *[Symbol.iterator]() { yield \'x\'; }\n  async stop(): Promise<void> {}\n}\n',
    }));
    t('a population with sources but ZERO Plugin implementations REFUSES rather than reporting clean',
      noPlugins.refusal !== null, JSON.stringify(noPlugins));

    // A DANGLING SYMLINK named like a source. It is a directory entry the walk
    // must collect (not a directory, right extension) whose read then throws --
    // and it fails that way for every uid, where `chmod 000` would not stop
    // root. The rest of the tree is ordinary and readable, so a gate that
    // refused unconditionally could not tell the two apart.
    const unreadableRoot = tree('refuse-unreadable', READABLE);
    mkdirSync(join(unreadableRoot, POPULATION_ROOT, 'b', 'src'), { recursive: true });
    symlinkSync('./nowhere-at-all.ts', join(unreadableRoot, POPULATION_ROOT, 'b', 'src', 'p.ts'));
    const unreadable = audit(unreadableRoot);
    t('a source that cannot be READ refuses, and the same tree is otherwise readable',
      unreadable.refusal !== null && unreadable.refusal.includes('p.ts')
        && audit(tree('refuse-unreadable-pair', READABLE)).refusal === null,
      JSON.stringify(unreadable));

    // -- the unparseable leg, out of process: ts-parse ends the PROCESS -----
    const wreckRoot = tree('refuse-unparseable', {
      ...READABLE,
      'b/src/wreck.ts': 'export class WreckPlugin implements Plugin {\n<<<<<<< HEAD\n  async stop() {}\n=======\n  async destroy() {}\n>>>>>>> other\n}\n',
    });
    const wreck = spawnSync(process.execPath, [SELF, '--audit-root', wreckRoot], { encoding: 'utf8' });
    t('an UNPARSEABLE source refuses out of process, naming the file',
      wreck.status !== 0 && wreck.status !== null && /wreck\.ts/.test(`${wreck.stderr}${wreck.stdout}`),
      JSON.stringify({ status: wreck.status, err: (wreck.stderr || '').slice(0, 200) }));

    const parseable = spawnSync(process.execPath, [SELF, '--audit-root', tree('parseable-pair', READABLE)], { encoding: 'utf8' });
    t('...while the same entry point returns a verdict for a readable tree',
      parseable.status === 0 && /findings=0/.test(parseable.stdout),
      JSON.stringify({ status: parseable.status, out: (parseable.stdout || '').trim() }));

    // -- and the live tree agrees with the checked-in ratchet ---------------
    const live = audit(REPO_ROOT);
    const liveJudgement = live.refusal ? null : judge(live.findings, KNOWN_TEARDOWN_UNREACHED);
    t('the live tree resolves a real population (not zero, not a refusal)',
      live.refusal === null && live.classes > 0 && live.files > 0, JSON.stringify({ refusal: live.refusal, classes: live.classes }));
    t('the checked-in known list is neither short nor stale against the live tree',
      liveJudgement !== null && liveJudgement.fresh.length === 0 && liveJudgement.stale.length === 0,
      JSON.stringify(liveJudgement));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-plugin-teardown-shape self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-plugin-teardown-shape self-test: ${cases.length} cases pass `
    + `(real pre-#10375 fixture reds, the repaired file and both delegating-alias directions stay green, `
    + `every roster name reds, every excluded name stays green, and all five refusals are paired with a tree that still returns a verdict).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  else if (argv.includes('--list')) process.exit(list());
  else if (argv.includes('--audit-root')) process.exit(auditRoot(argv[argv.indexOf('--audit-root') + 1]));
  else process.exit(main());
}
