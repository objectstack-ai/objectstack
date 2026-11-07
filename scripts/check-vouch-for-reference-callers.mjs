#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Call-site census of the vouched-reference mark.
 *
 *   node scripts/check-vouch-for-reference-callers.mjs
 *   node scripts/check-vouch-for-reference-callers.mjs --self-test
 *   node scripts/check-vouch-for-reference-callers.mjs --ts-only
 *
 * ## The rule it holds
 *
 * A write that is not a system write may name, in a `lookup`, `user` or
 * `master_detail` field, only a record its caller's own read door returns
 * (`assertReferencesResolve`, objectql). The one exception is a reference a
 * service verb vouches for on its own write (`vouchForReference`,
 * `@objectstack/core`): a record the same call authorized for the caller, set
 * only after that verb's own authorization, and never on a context a request,
 * an import, a flow or an agent tool hands the engine. Whether a call site
 * honours that is a judgement a reviewer makes once, when the call site is
 * written. This gate makes sure no call site arrives without that review: every
 * production source file on the scan surface (below) that sets the mark is
 * named in {@link ALLOWED_CALLERS} with the exact number of call sites it
 * holds, and the gate is red when a file outside the list sets it, when a
 * listed file holds more or fewer call sites than its row, and when a row
 * names a file that no longer sets it.
 *
 * ## One rule for every spelling: a mention the census cannot count is a finding
 *
 * The mark has three names: the function `vouchForReference`, the context key
 * `VOUCHED_REFERENCES`, and the key's `Symbol.for` description
 * (`objectstack.core.vouchedReferences`). Outside the module that defines them,
 * every occurrence of any of the three — in code or in a string literal — is
 * exactly one of:
 *
 *  1. a direct call, `vouchForReference(…)` (a type argument list allowed),
 *     not reached through a member, a bracket or a string. It is COUNTED, and
 *     the count is what {@link ALLOWED_CALLERS} pins;
 *  2. an unrenamed specifier of an `import { … } from` or `export { … } from`
 *     statement, `vouchForReference` or `VOUCHED_REFERENCES` as itself. It sets
 *     nothing and is not counted;
 *  3. a FINDING: anything else. A rename on import or export, a namespace or
 *     member access, a bracket or string-keyed access, a value alias, `.call`
 *     or `.apply`, a `require` destructuring, the key as a computed property or
 *     an argument to `Object.defineProperty` / `Reflect.set`, or the symbol's
 *     description in any literal. Each would let a call or a hand-built key
 *     reach the context without a counted call, so each is red, naming the file
 *     and line, and the remedy is the same: call `vouchForReference` directly,
 *     unrenamed, and add the row.
 *
 * And because the description can be assembled, a `Symbol.for(…)` whose
 * argument the census cannot read is a finding too, in any scanned file: the
 * argument must be one plain string literal, a template literal with no
 * substitution, or a bare identifier bound in the same file by `const` to a
 * plain string literal. Anything else — an imported constant, a concatenation,
 * a call, a substituted template — is red, naming the file and line.
 *
 * Code is told from prose by `maskComments` (`scripts/js-comment-mask.mjs`),
 * which blanks comment spans and keeps string, template and regex literals,
 * so a `//` inside a string never hides the code after it and a `/* … *\/`
 * span never hides the code beside it. The `Symbol.for` argument is read off
 * `maskCommentsAndLiterals`, so a `Symbol.for(` written inside a string or a
 * template (generated source) is not a call.
 *
 * Test files (`*.test.*`, `*.spec.*`, `*.testkit.*`, `__tests__/`,
 * `__fixtures__/`) are outside the census: they set the mark on purpose to pin
 * what it admits.
 *
 * ## Two surfaces: the full one, and `packages/**` `.ts` alone
 *
 * The scan surface is git's (`git ls-files --cached --others --exclude-standard`),
 * so build output never reads as a call site.
 *
 * The bare run judges `packages/`, `examples/` and `apps/` — every workspace
 * tree that can depend on `@objectstack/core` and boot the kernel in-process —
 * over every source extension (`.ts`, `.mts`, `.cts`, `.tsx`, `.js`, `.mjs`,
 * `.cjs`, `.jsx`). It is the authority: the lint step runs it on every PR, with
 * no cache in front of it.
 *
 * `--ts-only` judges the files under `packages/` ending in `.ts` and nothing
 * else, and it exists for one caller: the pin in `@objectstack/core`
 * (`src/security/vouched-reference-callers.pin.test.ts`). That pin's re-run
 * radius is the `@objectstack/core` entry of
 * `scripts/cross-package-test-inputs.mjs`, `packages/**` ending in `.ts`,
 * mirrored in its `test:repo` turbo inputs. A pin that judged a wider set than
 * that radius would judge files whose edits never re-run it, and replay a
 * cached green over them; so the pin judges the radius, the lint step judges
 * the rest (`examples/`, `apps/` and the other extensions), and the radius
 * stays `packages/**` `.ts` for the reason that entry's comment gives. Under
 * `--ts-only`, a row for a file outside the surface is not judged stale: the
 * bare run judges it.
 *
 * Adding a caller is an edit to {@link ALLOWED_CALLERS} in the same change,
 * with the reason in the row: what the verb created or authorized for the
 * caller, and which authorization it asked first.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { maskComments, maskCommentsAndLiterals } from './js-comment-mask.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The module that defines the mark; its own spellings are not call sites. */
const DEFINING_MODULE = 'packages/core/src/security/vouched-reference.ts';

/**
 * Every production file that sets the mark, with its exact call-site count and
 * the reason it may. Equality, not a ceiling: one more call site is a new
 * vouch nobody reviewed, one fewer is a row that no longer says what the file
 * does.
 */
export const ALLOWED_CALLERS = Object.freeze({
  'packages/services/service-storage/src/file-attachment-service.ts': {
    count: 2,
    reason:
      'the file-attachments writer: attachFileAs vouches for the sys_file it created in the same call, and ' +
      "attachUploadAs for the caller's own unheld pending upload it commits in the same unit — each only for " +
      'sys_attachment.file_id, after that verb\'s own attach authorization',
  },
});

/** The trees the bare run reads; `--ts-only` reads the first alone. */
export const SCAN_ROOTS = Object.freeze(['packages', 'examples', 'apps']);

/**
 * The same three roots in the spelling `scripts/pm/dispatch-gates.mjs` can
 * read: it reads a gate's SOURCE TEXT for path literals and refuses a bare
 * single-segment word as too generic, so `SCAN_ROOTS` alone would leave this
 * gate in no dispatch brief while CI runs it on every PR. The census really
 * does walk each root whole (every source extension, tests aside), so the
 * subtree spelling is the true one — the declaration `check-org-identifier.mjs`
 * makes over the same three roots. Nothing here reads this array; the
 * self-test holds it equal to `SCAN_ROOTS` in both directions, so widening or
 * renaming a root cannot leave it describing the old population.
 */
export const ROOT_DIR_WATCH_HINTS = Object.freeze(['packages/**', 'examples/**', 'apps/**']);

const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_FILE = /(?:\.test\.|\.spec\.|\.testkit\.|\/__tests__\/|\/__fixtures__\/)/;

/**
 * Whether the census reads `path`: a production source file under a scan
 * root, on the full surface or, with `tsOnly`, the `packages/**` `.ts` one
 * (see "Two surfaces" above).
 */
export function inScanSurface(path, { tsOnly = false } = {}) {
  if (!SOURCE_FILE.test(path) || TEST_FILE.test(path)) return false;
  if (tsOnly) return path.startsWith('packages/') && path.endsWith('.ts');
  return SCAN_ROOTS.some((root) => path.startsWith(`${root}/`));
}

const FN = 'vouchForReference';
const KEY = 'VOUCHED_REFERENCES';
const DESCRIPTION = 'vouchedReferences';
/** Every occurrence of a name of the mark; the description matches inside any longer literal. */
const MENTION = /(?<![\w$])(vouchForReference|VOUCHED_REFERENCES)(?![\w$])|vouchedReferences/g;
/** An `import { … } from` / `export { … } from` statement's specifier list. */
const SPECIFIER_LIST = /\b(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^{}]*)\}\s*from\b/g;
/** After a name: an optional type argument list, then the call's open paren. */
const CALL_TAIL = /^\s*(?:<[^<>()]*>)?\s*\(/;

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;
const blankSpan = (text, from, to) =>
  text.slice(0, from) + text.slice(from, to).replace(/[^\n]/g, ' ') + text.slice(to);

/**
 * The census of one file's text: its counted call sites, and a finding for
 * every mention of the mark it cannot count and every `Symbol.for` argument it
 * cannot read.
 */
export function censusOf(path, text) {
  const findings = [];
  if (path === DEFINING_MODULE) return { calls: 0, findings };
  const source = String(text);
  let code = maskComments(source);
  const at = (offset) => `${path}:${lineAt(source, offset)}`;

  // 2. Unrenamed import/export-from specifiers set nothing: blank them before
  //    the mention pass. A renamed one is a finding and is blanked too, so it
  //    is reported once.
  for (const m of [...code.matchAll(SPECIFIER_LIST)]) {
    const listStart = m.index + m[0].indexOf('{') + 1;
    let offset = listStart;
    for (const raw of m[1].split(',')) {
      const spec = raw.trim().replace(/^type\s+/, '');
      const names = spec.match(/(?<![\w$])(?:vouchForReference|VOUCHED_REFERENCES)(?![\w$])|vouchedReferences/);
      if (names) {
        if (spec !== FN && spec !== KEY) {
          findings.push(`${at(offset)}: renames ${names[0]} on ${m[0].trimStart().startsWith('export') ? 'export' : 'import'} (\`${spec}\`) — a rename hides every later use from this census; import it as itself`);
        }
        code = blankSpan(code, offset, offset + raw.length);
      }
      offset += raw.length + 1;
    }
  }

  // 1 and 3. Every remaining mention is a counted direct call or a finding.
  let calls = 0;
  for (const m of code.matchAll(MENTION)) {
    const name = m[1] ?? DESCRIPTION;
    const before = code.slice(0, m.index).replace(/\s+$/, '');
    const prev = before.slice(-1);
    const reached = prev === '.' || prev === '[' || prev === "'" || prev === '"' || prev === '`';
    if (name === FN && !reached && CALL_TAIL.test(code.slice(m.index + FN.length))) {
      calls += 1;
      continue;
    }
    const what =
      name === DESCRIPTION
        ? "spells the mark's symbol description"
        : name === KEY
          ? 'reaches the context key VOUCHED_REFERENCES'
          : 'reaches vouchForReference without a direct call';
    findings.push(
      `${at(m.index)}: ${what} — a spelling this census cannot count. Call vouchForReference directly, unrenamed, ` +
        'and add the file to ALLOWED_CALLERS',
    );
  }

  // The description assembled at run time: every Symbol.for argument must be readable.
  findings.push(...unreadableSymbolFor(path, source, code));
  return { calls, findings };
}

/** `Symbol.for(…)` calls in code whose argument the census cannot read (see the header). */
function unreadableSymbolFor(path, source, commentsMasked) {
  const findings = [];
  const codeOnly = maskCommentsAndLiterals(source);
  for (const m of codeOnly.matchAll(/\bSymbol\s*\.\s*for\s*\(/g)) {
    const argStart = m.index + m[0].length;
    const shown = commentsMasked.slice(argStart);
    const plain = /^\s*(['"])(?:(?!\1)[^\\\n]|\\.)*\1\s*,?\s*\)/.test(shown);
    const template = /^\s*`([^`]*)`\s*,?\s*\)/.exec(shown);
    if (plain || (template && !template[1].includes('${'))) continue;
    const ident = /^\s*([A-Za-z_$][\w$]*)\s*\)/.exec(codeOnly.slice(argStart));
    if (ident) {
      const bound = new RegExp(
        `\\bconst\\s+${ident[1].replace(/\$/g, '\\$')}\\s*(?::[^=;]+)?=\\s*(['"])(?:(?!\\1)[^\\\\\\n]|\\\\.)*\\1\\s*(?:as\\s+const\\s*)?[;,\\n]`,
      );
      if (bound.test(commentsMasked)) continue;
    }
    findings.push(
      `${path}:${lineAt(source, m.index)}: Symbol.for is fed an argument this census cannot read — use a plain string ` +
        'literal, or a const in this file bound to one, so the description it registers is visible',
    );
  }
  return findings;
}

/** The verdict over a set of `{ path, text }` files against `allowed`. */
export function check(files, allowed = ALLOWED_CALLERS) {
  const problems = [];
  if (files.length === 0) {
    problems.push('the scan found no source files at all — an empty scan proves nothing, so it is refused');
    return { problems, counts: new Map() };
  }
  const counts = new Map();
  for (const { path, text } of files) {
    if (!inScanSurface(path)) continue;
    const { calls, findings } = censusOf(path, text);
    problems.push(...findings);
    if (calls > 0) counts.set(path, calls);
  }
  for (const [path, calls] of counts) {
    const row = allowed[path];
    if (!row) {
      problems.push(
        `${path}: sets the vouched-reference mark ${calls} time(s) and is not in ALLOWED_CALLERS. A vouch lets one ` +
          "reference skip the caller's read door; add the row with its reason only after review, or write as the caller.",
      );
    } else if (row.count !== calls) {
      problems.push(
        `${path}: sets the vouched-reference mark ${calls} time(s); its ALLOWED_CALLERS row pins ${row.count}. ` +
          'Every call site is reviewed on its own: update the row (and its reason) in the same change.',
      );
    }
  }
  for (const path of Object.keys(allowed)) {
    if (!counts.has(path)) {
      problems.push(
        `${path}: is in ALLOWED_CALLERS and no longer sets the mark. Remove the stale row in the same change, or ` +
          'restore the call it pins if its removal was not meant.',
      );
    }
  }
  return { problems, counts };
}

/**
 * The verdict on one surface: `files` and the rows of `allowed` narrowed to
 * it first, so under `tsOnly` a row for a file outside the `packages/**` `.ts`
 * surface is left to the bare run rather than reported stale.
 */
export function verdict(files, allowed = ALLOWED_CALLERS, { tsOnly = false } = {}) {
  const onSurface = (path) => inScanSurface(path, { tsOnly });
  const rows = Object.fromEntries(Object.entries(allowed).filter(([path]) => onSurface(path)));
  return check(files.filter((f) => onSurface(f.path)), rows);
}

/** The files the census reads: what git sees under the scan roots, never build output. */
function readTree({ tsOnly = false } = {}) {
  const roots = tsOnly ? ['packages'] : [...SCAN_ROOTS];
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...roots], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const files = [];
  for (const path of out.split('\0')) {
    if (!path || !inScanSurface(path, { tsOnly })) continue;
    let text;
    try {
      text = readFileSync(join(REPO, path), 'utf8');
    } catch {
      continue; // listed by git, deleted in the working tree
    }
    // A fixed-string prefilter, an exact superset of what censusOf can find.
    if (![FN, KEY, DESCRIPTION, 'Symbol'].some((needle) => text.includes(needle))) text = '';
    files.push({ path, text });
  }
  return files;
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// Table-driven, as `check-agent-model-declared.mjs`'s: each row LABEL is a
// declared battery with a floor of 1, registered as the first statement of the
// loop body; the roster's own size is pinned; and the verdict sets a flag the
// dispatch refuses without (AGENTS.md, "Writing a --self-test").

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'an allow-listed file with exactly its pinned call sites → GREEN': 1,
  'a call from a file outside the allow-list → RED': 1,
  'an allow-listed file with one more call site than its row → RED': 1,
  'an allow-listed file with one fewer call site than its row → RED': 1,
  'a row naming a file that no longer sets the mark → RED (stale row), naming both remedies': 1,
  'an import that renames vouchForReference → RED': 1,
  'the key built by hand as [VOUCHED_REFERENCES] → RED': 1,
  'the symbol spelled by hand with Symbol.for → RED': 1,
  'a test file that sets the mark → GREEN (outside the census)': 1,
  'a comment mention, line or block, is no call site → GREEN': 1,
  'the defining module’s own spellings → GREEN': 1,
  'an empty scan → RED, never a green skip': 1,
  'a call from a .mjs file on the full surface → RED': 1,
  'the same .mjs call under --ts-only → GREEN (the bare run judges it)': 1,
  'a row for a non-.ts file under --ts-only → not judged stale': 1,
  'the key renamed on import, then used as [MARK] → RED': 1,
  'the key through a namespace, [ns.VOUCHED_REFERENCES] → RED': 1,
  'the key set with Object.defineProperty → RED': 1,
  'the key set with Reflect.set → RED': 1,
  'Symbol.for fed a const holding the description → RED': 1,
  'Symbol.for fed an imported or computed constant → RED': 1,
  'Symbol.for fed a substituted template → RED': 1,
  'Symbol.for fed a same-file const bound to another plain literal → GREEN': 1,
  'Symbol.for written inside a string of generated source → GREEN': 1,
  'a value alias of vouchForReference → RED': 1,
  'vouchForReference.call → RED': 1,
  'vouchForReference.apply → RED': 1,
  'a require destructuring rename → RED': 1,
  "string-keyed access, core['vouchForReference'](…) → RED": 1,
  'a namespace call, core.vouchForReference(…) → RED': 1,
  'a template-literal mention → RED (a string mention is no exemption)': 1,
  'a // inside a string before a call on the same line does not hide the call → RED': 1,
  'a /* … */ span before code on the same line does not hide the call → RED': 1,
  'unrenamed import and re-export specifiers, and a call with a type argument → GREEN': 1,
  'a call under examples/ on the full surface → RED': 1,
  'the same examples/ call under --ts-only → GREEN (outside its radius)': 1,
  'a rename on re-export → RED': 1,
  'ROOT_DIR_WATCH_HINTS declares every scan root as its subtree': 1,
  'ROOT_DIR_WATCH_HINTS declares no root the census does not walk, and no bare word': 1,
});
const SELF_TEST_BATTERY_FLOOR = 39;

function selfTest() {
  const VERB = 'packages/services/demo/src/verb.ts';
  const OTHER = 'packages/rest/src/door.ts';
  const SCRIPT = 'packages/plugins/demo/scripts/seed.mjs';
  const CJS = 'packages/plugins/demo/src/legacy.cjs';
  const EXAMPLE = 'examples/app-demo/src/hook.ts';
  const ALLOW = { [VERB]: { count: 1, reason: 'demo' } };
  const call = "  const ctx = vouchForReference(context, { object: 'o', field: 'f', id });\n";
  const imp = "import { vouchForReference } from '@objectstack/core';\n";
  const filler = { path: 'packages/core/src/other.ts', text: 'export const x = 1;\n' };
  const verb = { path: VERB, text: imp + call };
  const other = (text) => [verb, { path: OTHER, text }];

  const cases = [
    { label: 'an allow-listed file with exactly its pinned call sites → GREEN', files: [verb], expect: 'green' },
    { label: 'a call from a file outside the allow-list → RED', files: other(call), expect: 'red', names: OTHER },
    { label: 'an allow-listed file with one more call site than its row → RED', files: [{ path: VERB, text: imp + call + call }], expect: 'red', names: VERB },
    { label: 'an allow-listed file with one fewer call site than its row → RED', files: [verb], allow: { [VERB]: { count: 2, reason: 'demo' } }, expect: 'red', names: VERB },
    { label: 'a row naming a file that no longer sets the mark → RED (stale row), naming both remedies', files: [filler], expect: 'red', names: 'restore the call it pins' },
    { label: 'an import that renames vouchForReference → RED', files: other("import { vouchForReference as vouch } from '@objectstack/core';\n"), expect: 'red', names: OTHER },
    { label: 'the key built by hand as [VOUCHED_REFERENCES] → RED', files: other('  const ctx = { ...context, [VOUCHED_REFERENCES]: [ref] };\n'), expect: 'red', names: OTHER },
    { label: 'the symbol spelled by hand with Symbol.for → RED', files: other("  const k = Symbol.for('objectstack.core.vouchedReferences');\n"), expect: 'red', names: OTHER },
    { label: 'a test file that sets the mark → GREEN (outside the census)', files: [verb, { path: 'packages/rest/src/door.test.ts', text: call + '  ({ [VOUCHED_REFERENCES]: [] });\n' }], expect: 'green' },
    { label: 'a comment mention, line or block, is no call site → GREEN', files: other("// vouchForReference(context, ref) is the verb's\n/*\n  vouchForReference(x) with no leading star\n  VOUCHED_REFERENCES too\n*/\nexport const y = 2;\n"), expect: 'green' },
    { label: 'the defining module’s own spellings → GREEN', files: [verb, { path: DEFINING_MODULE, text: "export const VOUCHED_REFERENCES = Symbol.for('objectstack.core.vouchedReferences');\nexport function vouchForReference(context, reference) {\n  return { ...context, [VOUCHED_REFERENCES]: [] };\n}\n" }], expect: 'green' },
    { label: 'an empty scan → RED, never a green skip', files: [], expect: 'red', names: 'no source files' },
    { label: 'a call from a .mjs file on the full surface → RED', files: [verb, { path: SCRIPT, text: call }], expect: 'red', names: SCRIPT },
    { label: 'the same .mjs call under --ts-only → GREEN (the bare run judges it)', tsOnly: true, files: [verb, { path: SCRIPT, text: call }], expect: 'green' },
    { label: 'a row for a non-.ts file under --ts-only → not judged stale', tsOnly: true, files: [verb], allow: { ...ALLOW, [SCRIPT]: { count: 1, reason: 'demo' } }, expect: 'green' },
    { label: 'the key renamed on import, then used as [MARK] → RED', files: other("import { VOUCHED_REFERENCES as MARK } from '@objectstack/core';\nconst ctx = { ...context, [MARK]: [ref] };\n"), expect: 'red', names: `${OTHER}:1` },
    { label: 'the key through a namespace, [ns.VOUCHED_REFERENCES] → RED', files: other("import * as ns from '@objectstack/core';\nconst ctx = { ...context, [ns.VOUCHED_REFERENCES]: [ref] };\n"), expect: 'red', names: `${OTHER}:2` },
    { label: 'the key set with Object.defineProperty → RED', files: other("import { VOUCHED_REFERENCES } from '@objectstack/core';\nObject.defineProperty(ctx, VOUCHED_REFERENCES, { value: [ref] });\n"), expect: 'red', names: `${OTHER}:2` },
    { label: 'the key set with Reflect.set → RED', files: other("import { VOUCHED_REFERENCES } from '@objectstack/core';\nReflect.set(ctx, VOUCHED_REFERENCES, [ref]);\n"), expect: 'red', names: `${OTHER}:2` },
    { label: 'Symbol.for fed a const holding the description → RED', files: other("const D = 'objectstack.core.vouchedReferences';\nconst k = Symbol.for(D);\n"), expect: 'red', names: `${OTHER}:1` },
    { label: 'Symbol.for fed an imported or computed constant → RED', files: other("import { PREFIX } from './keys.js';\nconst k = Symbol.for(PREFIX + 'vouched' + 'References');\nconst j = Symbol.for(PREFIX);\n"), expect: 'red', names: `${OTHER}:3` },
    { label: 'Symbol.for fed a substituted template → RED', files: other("const k = Symbol.for(`objectstack.core.${'vouched'}References`);\n"), expect: 'red', names: `${OTHER}:1` },
    { label: 'Symbol.for fed a same-file const bound to another plain literal → GREEN', files: other("const OTHER_KEY = '@objectstack/demo:other';\nexport const OTHER_MARK = Symbol.for(OTHER_KEY);\nexport const T = Symbol.for(`plain.template`);\n"), expect: 'green' },
    { label: 'Symbol.for written inside a string of generated source → GREEN', files: other("const lines = [`const k = Symbol.for(${JSON.stringify(key)});`];\n"), expect: 'green' },
    { label: 'a value alias of vouchForReference → RED', files: other(imp + 'const v = vouchForReference;\nv(context, ref);\n'), expect: 'red', names: `${OTHER}:2` },
    { label: 'vouchForReference.call → RED', files: other(imp + 'vouchForReference.call(null, context, ref);\n'), expect: 'red', names: `${OTHER}:2` },
    { label: 'vouchForReference.apply → RED', files: other(imp + 'vouchForReference.apply(null, [context, ref]);\n'), expect: 'red', names: `${OTHER}:2` },
    { label: 'a require destructuring rename → RED', files: [verb, { path: CJS, text: "const { vouchForReference: v } = require('@objectstack/core');\nv(context, ref);\n" }], expect: 'red', names: `${CJS}:1` },
    { label: "string-keyed access, core['vouchForReference'](…) → RED", files: other("import * as core from '@objectstack/core';\ncore['vouchForReference'](context, ref);\n"), expect: 'red', names: `${OTHER}:2` },
    { label: 'a namespace call, core.vouchForReference(…) → RED', files: other("import * as core from '@objectstack/core';\ncore.vouchForReference(context, ref);\n"), expect: 'red', names: `${OTHER}:2` },
    { label: 'a template-literal mention → RED (a string mention is no exemption)', files: other('const s = `vouchForReference(x)`;\n'), expect: 'red', names: `${OTHER}:1` },
    { label: 'a // inside a string before a call on the same line does not hide the call → RED', files: other("const u = 'https://example.test/a'; const c = vouchForReference(context, ref);\n"), expect: 'red', names: 'not in ALLOWED_CALLERS' },
    { label: 'a /* … */ span before code on the same line does not hide the call → RED', files: other('/* the verb */ const c = vouchForReference(context, ref);\n'), expect: 'red', names: 'not in ALLOWED_CALLERS' },
    { label: 'unrenamed import and re-export specifiers, and a call with a type argument → GREEN', files: [{ path: VERB, text: "import {\n  type VouchedReference,\n  vouchForReference,\n} from '@objectstack/core';\nconst ctx = vouchForReference<Ctx>(context, ref);\n" }, { path: 'packages/core/src/security/index.ts', text: "export {\n  VOUCHED_REFERENCES,\n  vouchForReference,\n} from './vouched-reference.js';\n" }], expect: 'green' },
    { label: 'a call under examples/ on the full surface → RED', files: [verb, { path: EXAMPLE, text: imp + call }], expect: 'red', names: EXAMPLE },
    { label: 'the same examples/ call under --ts-only → GREEN (outside its radius)', tsOnly: true, files: [verb, { path: EXAMPLE, text: imp + call }], expect: 'green' },
    { label: 'a rename on re-export → RED', files: other("export { vouchForReference as vouch } from '@objectstack/core';\n"), expect: 'red', names: `${OTHER}:1` },
    { label: 'ROOT_DIR_WATCH_HINTS declares every scan root as its subtree', holds: () => SCAN_ROOTS.every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)) },
    {
      label: 'ROOT_DIR_WATCH_HINTS declares no root the census does not walk, and no bare word',
      holds: () =>
        ROOT_DIR_WATCH_HINTS.length === SCAN_ROOTS.length &&
        ROOT_DIR_WATCH_HINTS.every((h) => h.endsWith('/**') && SCAN_ROOTS.includes(h.slice(0, -3))),
    },
  ];

  const batterySeen = new Map();
  let failed = 0;
  for (const c of cases) {
    batterySeen.set(c.label, (batterySeen.get(c.label) ?? 0) + 1);
    if (c.holds) {
      if (!c.holds()) {
        failed += 1;
        console.error(`✗ ${c.label}\n    SCAN_ROOTS ${JSON.stringify(SCAN_ROOTS)}, ROOT_DIR_WATCH_HINTS ${JSON.stringify(ROOT_DIR_WATCH_HINTS)}`);
      }
      continue;
    }
    const { problems } = verdict(c.files, c.allow ?? ALLOW, { tsOnly: c.tsOnly === true });
    const red = problems.length > 0;
    const ok =
      (c.expect === 'green' && !red) ||
      (c.expect === 'red' && red && (!c.names || problems.some((p) => p.includes(c.names))));
    if (!ok) {
      failed += 1;
      console.error(`✗ ${c.label}\n    expected ${c.expect}${c.names ? ` naming ${c.names}` : ''}, got: ${red ? problems.join(' | ') : 'green'}`);
    }
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  const labels = cases.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
  if (duplicated.length > 0) floorFailure(`row label(s) used more than once: ${duplicated.join(', ')}`);
  for (const [name] of batterySeen) {
    if (!declared.includes(name)) floorFailure(`battery "${name}" ran but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const seen = batterySeen.get(name) ?? 0;
    if (seen < SELF_TEST_BATTERIES[name]) {
      floorFailure(`battery "${name}" DID NOT RUN — ${seen} case(s) registered, ${SELF_TEST_BATTERIES[name]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ check-vouch-for-reference-callers self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`✓ check-vouch-for-reference-callers self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '✗ check-vouch-for-reference-callers self-test: selfTest() returned without reaching its verdict, so no ' +
          'success line was printed; exiting 0 would report a self-test that never finished as one that passed.',
      );
      process.exit(1);
    }
    return;
  }
  const tsOnly = process.argv.includes('--ts-only');
  const { problems, counts } = verdict(readTree({ tsOnly }), ALLOWED_CALLERS, { tsOnly });
  if (problems.length > 0) {
    console.error(`✗ check-vouch-for-reference-callers: ${problems.length} finding(s)\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const listed = [...counts].map(([path, n]) => `${path} (${n})`).join(', ');
  const surface = tsOnly ? 'the .ts surface' : `${SCAN_ROOTS.join('/, ')}/, every source extension`;
  console.log(`✓ check-vouch-for-reference-callers: every call site that sets the vouched-reference mark is allow-listed (${surface}) — ${listed}.`);
}

if (isEntrypoint(import.meta.url)) {
  main();
}
