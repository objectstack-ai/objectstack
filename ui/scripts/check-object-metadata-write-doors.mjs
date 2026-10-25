#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every in-repo DOOR that can PUT an object-metadata document must apply the
 * object-metadata write invariant.
 *
 * Run:  node scripts/check-object-metadata-write-doors.mjs   (also `pnpm check:metadata-write-doors`)
 *       node scripts/check-object-metadata-write-doors.mjs --list   (the whole derived door census)
 * Exit: 0 = every object-capable door reaches `assertObjectMetadataWritable`,
 *       1 = at least one does not, or the census collapsed.
 *
 * ## The defect class this closes (objectui#8676, from objectui#7714 / objectui#8057)
 *
 * objectui#7714 ruled a client behaviour — a half-filled relationship is held
 * client-side and the PUT body never carries one without a non-empty
 * `reference` — and its PR implemented that ruling by ENUMERATING the writers it
 * knew of. Two of them. objectui#8057 then hit the same defect on a third writer
 * in that card's own required dogfood, and objectui#8676's sweep found nine
 * more. The sentence that outlives all three cards:
 *
 * > a ruling that enumerates writers is only as good as the enumeration.
 *
 * ⭐ And the half that outlives even that: the sweep the question is naturally
 * asked in CANNOT SEE its own subject. `git grep 'client\.save('` returns ZERO
 * over `ResourceEditPage.tsx`, the file objectui#8057 is entirely about, because
 * the call is `client.save<any>(type, …)` and the generic argument sits between
 * the name and the paren. A second writer hides identically. A third method
 * (`client.meta.saveItem(`) is not that spelling at all. And the door this gate
 * found that no `.save`-shaped sweep of any spelling can see is
 * `importObjectDraft`, a hand-rolled `fetch` PUT to `/api/v1/meta/object/:name`.
 *
 * ⇒ So this gate does not enumerate writers, and ⛔ no fix for this class ever
 * should. It enumerates DOORS.
 *
 * ## Why doors, and why that is not the same trick with a shorter list
 *
 * The writer set is OPEN — any component may decide to save an object, and
 * nothing in the repo has to tell anyone when one is added. The door set is
 * CLOSED and this repository owns it: bytes reach `PUT /meta/:type/:name` only
 * through code that is in this tree. So the census below is derived from the
 * TRANSPORT — what actually issues the request — and every writer, named or
 * not, past or future, arrives through one of the doors it finds. A writer
 * added tomorrow needs no entry anywhere; a DOOR added tomorrow reddens this
 * gate by construction, because the census is re-derived on every run.
 *
 * That is the difference between this and a list. A list is a claim about the
 * world; this is a measurement of the tree.
 *
 * ## The census, stated as a rule
 *
 *   DOORS     over `packages/<pkg>/src/**` and `apps/<app>/src/**`, excluding
 *             tests:
 *               (A) RAW — a call carrying a `method: 'PUT'` object literal at
 *                   any argument position, one of whose other arguments RESOLVES
 *                   to a URL on the `/meta` path. ⭐ Resolved, not read: the
 *                   repo's central door spells its URL through a template, a
 *                   field, and a helper's return value, and says nothing at the
 *                   call site. See {@link resolveUrl}.
 *               (B) SDK — any call to a member named `saveItem` with three or
 *                   more arguments. That is `@objectstack/client`'s metadata
 *                   write door, which lives in a package this repo does not own
 *                   and therefore cannot be guarded from the inside.
 *   TYPE      for (A) the literal path segment following `/meta/`, when the URL
 *             spells one; for (B) the first argument, when it is a string
 *             literal. Anything else is UNKNOWN.
 *   CAPABLE   TYPE is `object`, or TYPE is UNKNOWN. A door whose type is a
 *             literal other than `object` cannot carry an object document and
 *             is exempt — `view`, `app`, `flow`, `dashboard` writes are not this
 *             invariant's business.
 *   GUARDED   the nearest enclosing function body contains a call to
 *             `assertObjectMetadataWritable`.
 *   FINDING   a CAPABLE door that is not GUARDED.
 *
 * ⭐ `MetadataClient.save` call sites are deliberately NOT in the census, and
 * that absence is the whole point rather than a gap: `MetadataClient.save` IS
 * door (A) at `packages/data-objectstack/src/metadata-client.ts`, so every one
 * of its callers is covered by guarding that single door. Enumerating them
 * would re-introduce exactly the list this gate exists to abolish.
 *
 * ## What it deliberately does NOT answer
 *
 * Each is a boundary, not an oversight:
 *
 *   1. **Writes that are not PUT.** `publish`, `reset` and `rollback` POST to
 *      `/meta/:type/:name/<verb>` with no body of fields; they promote or
 *      discard a document the door already judged. A future POST route that
 *      accepts a fields-bearing body would be outside this census.
 *   2. **A door built by indirection.** A `fetch` whose method string arrives in
 *      a variable, or whose URL is assembled far from the call, is not matched.
 *      The census is syntactic; it reads what is written at the call.
 *   3. **Whether a guarded door's body is CORRECT.** That is
 *      `object-metadata-write-guard.*.test.ts`'s job. This gate answers
 *      coverage, and coverage only — the same split objectui#8676 was graded on.
 *   4. **Metadata written by a consumer of the published packages.** A host app
 *      that builds its own client reaches the server without passing through
 *      this tree at all.
 *
 * ## Population self-proof
 *
 * A census that finds nothing passes while asserting nothing — the failure mode
 * objectui#8676 is a card about. So the gate refuses to report OK unless it
 * found at least one door of EACH kind and at least one guarded door. A refactor
 * that renames the transport turns this red rather than green.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
// ⛔ NOT a hand-typed `process.argv[1]` comparison. Node resolves symlinks for
// the module graph but leaves `process.argv[1]` as the caller typed it, so a
// hand-typed guard reached through a symlink answers false and the gate does
// NOTHING -- exit 0, no output, which a wrapper holding only `result.status`
// cannot tell apart from a pass. `scripts/invoked-as.mjs` is the one predicate,
// and `check:entry-guard` enforces that every `scripts/` entry goes through it.
import { isEntrypoint } from './invoked-as.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..');

/** The guard every object-capable door must reach. */
const GUARD_SYMBOL = 'assertObjectMetadataWritable';

/** The metadata type whose documents this invariant judges. */
const OBJECT_TYPE = 'object';

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function isTestPath(path) {
  return (
    /\.(test|spec)\.[cm]?tsx?$/.test(path)
    || path.split(sep).includes('__tests__')
    || path.split(sep).includes('__mocks__')
  );
}

function collectSources(root) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectSources(full));
      continue;
    }
    if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    if (isTestPath(full)) continue;
    out.push(full);
  }
  return out;
}

/** Every `<workspaceDir>/<name>/src` that exists under `root`. */
export function sourceRoots(root = REPO_ROOT) {
  const roots = [];
  for (const workspace of ['packages', 'apps']) {
    const base = join(root, workspace);
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const src = join(base, entry.name, 'src');
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        /* a package without a `src` directory is not a source root */
      }
    }
  }
  return roots;
}

export function parse(file) {
  const text = readFileSync(file, 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** The source text of a node, with template substitutions left as written. */
function textOf(node) {
  return node?.getText?.() ?? '';
}

const EXPANSION_ROUNDS = 6;
const EXPANSION_LIMIT = 40_000;

/**
 * Everything in one file that a URL expression could be spelled through:
 * `const` initialisers, `this.X = …` assignments, and the return expressions of
 * same-file functions.
 *
 * ⭐ This exists because the MOST IMPORTANT door in the repo is invisible
 * without it. `MetadataClient.save` issues `this.fetchImpl(url, { method: 'PUT' })`,
 * and `url` is a template over `this.base`, which the constructor sets from
 * `buildBase(config)`, which returns a template over `META_PREFIX`. Read at the
 * call, that URL says nothing at all. A gate that only read the call would have
 * reported a clean census with the repo's central metadata door missing from it
 * -- a confident zero over a population it never searched, which is the exact
 * failure objectui#8676 is about. So the URL is RESOLVED rather than read.
 */
export function spellingsIn(source) {
  const idents = new Map();
  const returns = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (!idents.has(node.name.text)) idents.set(node.name.text, textOf(node.initializer));
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const key = `this.${node.left.name.text}`;
      if (!idents.has(key)) idents.set(key, textOf(node.right));
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const collected = [];
      const walk = (inner) => {
        if (ts.isReturnStatement(inner) && inner.expression) collected.push(textOf(inner.expression));
        ts.forEachChild(inner, walk);
      };
      ts.forEachChild(node.body, walk);
      if (collected.length && !returns.has(node.name.text)) returns.set(node.name.text, collected.join(' '));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return { idents, returns };
}

/** Replace `NAME(...)` (balanced) with `replacement`, every occurrence. */
function replaceCall(text, name, replacement) {
  let out = '';
  let index = 0;
  const needle = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let match;
  while ((match = needle.exec(text)) !== null) {
    if (match.index < index) continue;
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < text.length && depth > 0) {
      if (text[cursor] === '(') depth += 1;
      else if (text[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) break;
    out += text.slice(index, match.index) + `(${replacement})`;
    index = cursor;
    needle.lastIndex = cursor;
  }
  return out + text.slice(index);
}

/**
 * Expand a URL expression until it either spells a `/meta` path or stops
 * growing. Each name is substituted at most once, so a self-referential
 * spelling terminates instead of looping.
 */
export function resolveUrl(node, spellings) {
  let text = textOf(node);
  const used = new Set();
  for (let round = 0; round < EXPANSION_ROUNDS; round += 1) {
    const before = text;
    for (const [name, value] of spellings.returns) {
      if (used.has(`fn:${name}`) || !new RegExp(`\\b${name}\\s*\\(`).test(text)) continue;
      used.add(`fn:${name}`);
      text = replaceCall(text, name, value);
    }
    for (const [name, value] of spellings.idents) {
      if (used.has(name)) continue;
      const pattern = name.startsWith('this.')
        ? new RegExp(`\\bthis\\.${name.slice(5)}\\b`, 'g')
        : new RegExp(`\\b${name}\\b`, 'g');
      if (!pattern.test(text)) continue;
      used.add(name);
      text = text.replace(pattern, `(${value})`);
    }
    if (text === before || text.length > EXPANSION_LIMIT) break;
  }
  return text;
}

/** `'object'` for a string literal argument, `null` for anything else. */
function literalString(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Does this object literal carry `method: 'PUT'`? */
function isPutInit(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((prop) => {
    if (!ts.isPropertyAssignment(prop)) return false;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    return key === 'method' && literalString(prop.initializer) === 'PUT';
  });
}

/**
 * The metadata type a URL expression spells, or `null` when it does not spell
 * one literally. Reads the segment that follows `/meta/` in the written text,
 * so both `'/api/v1/meta/object/' + x` and a template literal are covered.
 */
function typeFromUrl(resolved) {
  const match = /\/meta\/([A-Za-z0-9_-]+)(\/|$)/.exec(resolved);
  return match ? match[1] : null;
}

/** `/metadata` is a different path; the negative lookahead keeps it out. */
function urlTouchesMeta(resolved) {
  return /\/meta(?![A-Za-z0-9_-])/.test(resolved);
}

/** The nearest enclosing function-like node, or the source file. */
function enclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current)
      || ts.isFunctionExpression(current)
      || ts.isArrowFunction(current)
      || ts.isMethodDeclaration(current)
      || ts.isConstructorDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

function callsGuard(scope) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name === GUARD_SYMBOL) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function censusDoors(root = REPO_ROOT) {
  const doors = [];
  for (const sourceRoot of sourceRoots(root)) {
    for (const file of collectSources(sourceRoot)) {
      const source = parse(file);
      const rel = relative(root, file);
      const spellings = spellingsIn(source);
      const visit = (node) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const memberName = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;

          // (A) RAW — a `PUT` whose URL RESOLVES to a `/meta` path. The init may
          // sit at any argument position (a `fetch`-alike wrapper takes it last),
          // so every argument is offered to both tests rather than positions 0
          // and 1 being assumed.
          if (node.arguments.some((argument) => isPutInit(argument))) {
            const candidates = node.arguments.filter((argument) => !isPutInit(argument));
            // As WRITTEN first, RESOLVED only as a fallback. Substitution is
            // textual, so a name that also occurs inside the path (`app`, in
            // `/meta/app/`) would be rewritten and turn a door that names its
            // type into one that does not. Reading the literal first keeps the
            // precise answer precise; resolution is for the doors that say
            // nothing at the call at all.
            const metaUrl = candidates.map((argument) => textOf(argument)).find((written) => urlTouchesMeta(written))
              ?? candidates.map((argument) => resolveUrl(argument, spellings)).find((resolved) => urlTouchesMeta(resolved));
            if (metaUrl !== undefined) {
              doors.push({
                kind: 'raw',
                file: rel,
                line: lineOf(source, node),
                type: typeFromUrl(metaUrl),
                guarded: callsGuard(enclosingFunction(node)),
                written: textOf(callee),
              });
            }
          }

          // (B) SDK — `@objectstack/client`'s metadata write door.
          if (memberName === 'saveItem' && node.arguments.length >= 3) {
            doors.push({
              kind: 'sdk',
              file: rel,
              line: lineOf(source, node),
              type: literalString(node.arguments[0]),
              guarded: callsGuard(enclosingFunction(node)),
              written: textOf(callee),
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
    }
  }
  return doors.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
}

/**
 * The whole verdict for one tree, as data. The CLI below is a thin printer over
 * it, and the gate's own suite drives it against fixture trees.
 */
export function analyze(root = REPO_ROOT) {
  const doors = censusDoors(root);
  const capable = doors.filter((door) => door.type === null || door.type === OBJECT_TYPE);
  const findings = capable.filter((door) => !door.guarded);
  const counters = {
    doors: doors.length,
    raw: doors.filter((door) => door.kind === 'raw').length,
    sdk: doors.filter((door) => door.kind === 'sdk').length,
    capable: capable.length,
    guarded: capable.filter((door) => door.guarded).length,
    exempt: doors.length - capable.length,
  };
  const collapsed = counters.raw === 0 || counters.sdk === 0 || counters.guarded === 0;
  return { doors, capable, findings, counters, collapsed };
}

/** `true` when this module was started as a program rather than imported. */
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // Imported by the suite that tests it; the CLI below must not run or exit.
} else {
  const { doors, capable, findings, counters } = analyze();
  const rawCount = counters.raw;
  const sdkCount = counters.sdk;
  const guardedCount = counters.guarded;

  if (process.argv.includes('--list')) {
    for (const door of doors) {
      const verdict = door.type !== null && door.type !== OBJECT_TYPE
        ? `exempt (type '${door.type}')`
        : door.guarded
          ? 'guarded'
          : 'UNGUARDED';
      console.log(
        `${door.kind.toUpperCase().padEnd(3)}  ${door.file}:${door.line}  `
          + `type=${door.type ?? '<runtime>'}  ${verdict}  [${door.written}]`,
      );
    }
  }

  if (rawCount === 0 || sdkCount === 0 || guardedCount === 0) {
    console.error(
      'x  the door census collapsed and this gate is asserting nothing:\n'
        + `      raw PUT doors found : ${rawCount}\n`
        + `      SDK saveItem doors  : ${sdkCount}\n`
        + `      guarded doors       : ${guardedCount}\n\n`
        + 'Every one of those must be non-zero for a green run to mean anything. A zero here is a\n'
        + 'renamed transport, a moved source root, or a matcher that stopped matching -- not a repo\n'
        + 'with no metadata writes. Fix the census before reading any verdict off it (objectui#8676).',
    );
    process.exit(1);
  }

  if (!findings.length) {
    console.log(
      `OK  ${doors.length} metadata write door(s) derived (${rawCount} raw PUT, ${sdkCount} SDK), `
        + `${capable.length} can carry an object document, ${guardedCount} reach ${GUARD_SYMBOL}, `
        + `${doors.length - capable.length} exempt by a non-object literal type -- no writer list anywhere.`,
    );
    process.exit(0);
  }

  console.error(
    `x  ${findings.length} metadata write door(s) can PUT an object document without the invariant:\n`,
  );
  for (const finding of findings) {
    console.error(
      `      ${finding.file}:${finding.line}  (${finding.kind})  `
        + `type=${finding.type ?? '<runtime value, so it can be \'object\'>'}\n`
        + `          ${finding.written}(...)`,
    );
  }
  console.error(
    `\nEach door above puts bytes on the wire without calling ${GUARD_SYMBOL}, so objectui#7714's ruled\n`
      + 'invariant -- a PUT body never carries a relationship field without a non-empty `reference` --\n'
      + 'does not hold for anything that writes through it. That ruling was enumerated in prose twice and\n'
      + 'falsified twice (objectui#8057, objectui#8676).\n\n'
      + 'Fix it AT THE DOOR: call assertObjectMetadataWritable(type, body, <door name>) from\n'
      + '@object-ui/data-objectstack before the request. ⛔ Do not fix it by guarding the writers that\n'
      + 'call the door -- that is the enumeration this gate exists to make unnecessary.',
  );
  process.exit(1);
}
