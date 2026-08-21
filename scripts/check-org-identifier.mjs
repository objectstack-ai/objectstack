#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-org-identifier -- keeps author-facing reference code on the blessed
// org name in hook/action bodies.
//
// #3280 made `organizationId` the blessed developer-facing name for the
// caller's active org across the JS authoring surface: a hook or action body
// reads `ctx.user.organizationId` / `ctx.session.organizationId`, matching the
// `organization_id` column and `current_user.organizationId` in RLS. The old
// `ctx.session.tenantId` was a deprecated alias; #3290 REMOVED it from the
// hook/action `ctx.session` surface entirely (the v16 major — see
// `content/docs/releases/v16.mdx`), so any session-borne
// `tenantId` read in an authoring body now resolves to `undefined` and is
// simply a bug.
//
// This is a hard-fail guard, not a ratchet: the scanned surfaces carry ZERO
// occurrences today, so any match is a NEW one and fails. It is deliberately
// NARROW:
//   • Scope is author-facing reference code: examples/, apps/, AND packages/
//     (#3290). The framework's own hook/action surface no longer emits or reads
//     `session.tenantId` (engine `buildSession`, the record-change trigger, and
//     the ObjectQL audit-stamp plugin were migrated to `organizationId`), so
//     packages/ is now held to the same bar as reference apps -- an author or AI
//     copying a package example body will not find the removed name.
//   • The generic DRIVER-LAYER tenancy knob is untouched and never matched: a
//     finding requires a receiver this gate has SHOWN to be a session, so
//     `execCtx.tenantId` / `opts.tenantId` / `DriverOptions.tenantId` (a
//     configurable isolation column, legitimately an *environment* id in
//     database-per-tenant kernels) do not trip it. For the rare genuine
//     driver-layer `session.tenantId`, add an `os-allow-tenant-id` comment on
//     the same line.
//   • Test/spec files are EXCLUDED, and the exclusion is WHOLESALE: it drops
//     the FILE, not a shape inside it. The population it is written for is
//     real -- a body naming the removed token to assert its ABSENCE
//     (`expect(session.tenantId).toBeUndefined()`) is not a reference body an
//     author copies a hook from. But "asserts its absence" is narrower than
//     the exclusion, which also drops fixtures that CONSTRUCT the removed
//     dialect as INPUT. That second population is not a reference body either,
//     and it is invisible to the DETECTOR as well -- so this filter is not what
//     hides it. Measured under "What the test exclusion covers" below (#9809).
//   • Comments are SKIPPED -- a migration note that NAMES the removed alias to
//     explain its removal is documentation, not an executable read. Which spans
//     ARE comments is decided by the ONE shared string-, template- and regex-
//     aware scanner (`scripts/js-comment-mask.mjs`, #9367) for the TEXT rule,
//     and by the parser itself for the BINDING rule (comments are trivia, so a
//     syntax tree cannot mistake one for code).
//   • skills/ and content/docs/ are EXCLUDED: prose there may still name the
//     removed alias when documenting the migration.
//
//   node scripts/check-org-identifier.mjs
//   node scripts/check-org-identifier.mjs --self-test
//   node scripts/check-org-identifier.mjs --list-bindings   (the discovered population)
//
// Scope: tracked sources under examples/, apps/, and packages/ (git ls-files).
//
// ## Why the comment split is not this gate's own business (#9444)
//
// This gate used to answer "comment or code?" per line, with a `trimmed`
// `startsWith` triple and then
//
//     const code = line.replace(/\/\/.*$/, '');
//
// which truncates at the FIRST doubled slash on the line, whatever that slash
// is. A URL or any slash-bearing string literal therefore deleted the rest of
// its own line -- including the very `session.tenantId` read this gate exists
// to catch. Silent under-reporting: the gate printed OK over a line it had
// truncated, the failure direction AGENTS.md calls worse than no verifier.
//
// It was wrong in the MIRROR direction too, which the card did not name. Only a
// line whose first non-space characters were `*`, `//` or `/*` counted as a
// comment, so an interior line of a block comment (`/*` on one line, prose with
// no leading `*` on the next) and a trailing `/* … */` on a code line both read
// as live code: the gate would have MANUFACTURED a finding out of prose. Both
// directions are gone with one shared mask, and both are pinned in `--self-test`.
//
// ## Why a RECEIVER NAME is not the anchor any more (#9691)
//
// Until #9691 the whole detector was one line:
//
//     const PATTERN = /\bsession\s*\??\.\s*tenantId\b/;   // receiver must be spelled `session`
//
// and the header above claimed "the scanned surfaces carry ZERO occurrences
// today". That was never an observation about the tree. A hook body binds its
// session to a local before reading it, and the shipped offender that #9516
// removed spelled that local `sess`:
//
//     const sess: any = (ctx as any).session ?? {};
//     const tenantId = recordOrgId ?? sess.tenantId;      // gate: no match
//
// CENSUS on 11b779e0f, over the 2057 scanned files (`--list-bindings` reproduces
// the binding half):
//
//   .tenantId property reads, all receivers ......................... 111
//   ... whose receiver is spelled `session` (what the old PATTERN saw)   0
//   ... reached through a local bound from `….session` ................. 2
//   locals bound from an expression ending in `.session` ............... 8
//   ... distinct SPELLINGS of that local .... 4  (session x3, sess x2, s x2, adminSession)
//   destructuring escapes (`const { tenantId } = ….session`) ........... 0
//
// So the old pattern matched NOTHING in the corpus, and the two reads it could
// not see are BOTH live on `main` -- one of them defective (see below). A green
// run was an artifact of the receiver spelling, on every PR, for the whole life
// of the guard.
//
// ⛔ The obvious repair -- widen to a vocabulary `session|sess|s|ctx|…` -- is
// the one this gate must NOT take, and the census says why in one row: the most
// common alias after `session` is the single letter `s`. A vocabulary
// containing `s` fires on every unrelated one-letter receiver in the tree
// (`s.tenantId` where `s` is a driver option bag is exactly the axis the
// bullet above promises never to match), and a vocabulary WITHOUT it misses
// two of the eight real bindings. Either way the next alias is invisible again,
// which is the defect, not a symptom of it.
//
// ⚠️ And the cheapest way to satisfy the OLD gate was actively harmful, the
// #9657 shape: a red `session.tenantId` was silenced by binding the session to
// a differently-named local and reading that. The code stays dead, the gate
// goes quiet, and the escape is permanent. A name-anchored gate rewards the
// rename it cannot see.
//
// ## What the anchor is instead
//
// A structural one: a receiver is a session because this file SHOWED it being
// filled from a `.session` expression, not because of how it is spelled. Two
// rules run over every scanned file and their findings are merged by line:
//
//   TEXT rule    -- `maskComments` + PATTERN, unchanged. It still owns the
//                   literal `session.tenantId` / `session?.tenantId` /
//                   `this.session . tenantId` shapes AND the authoring-sample
//                   case (a removed alias taught inside a string or template is
//                   a finding: an author copies what they read).
//   BINDING rule -- a syntax tree. A local (`const/let/var`) or a same-file
//                   function PARAMETER whose value came from an expression
//                   ending in `.session` is session-valued; a `.tenantId` read
//                   off such a receiver is a finding. Propagation is transitive
//                   (`const a = ctx.session; const b = a;`) and follows
//                   same-file call sites one function at a time, so the
//                   2-hop `stampData(…, hookCtx.session, …) -> applyToRecord`
//                   shape in `packages/objectql/src/plugin.ts` is inside the
//                   population rather than beyond it.
//
// ⛔ A TYPE-based anchor was priced and is NOT available here. All 8 binding
// sites in the census reach their session through an `any`: 7 are `(ctx: any)`
// hook handlers or `(ctx as any).session`, and the 8th
// (`record-change-trigger.ts`) annotates a hand-written inline literal type,
// not `HookContext['session']`. A checker-based rule would resolve every one of
// them to `any` and grade nothing -- it would be a THIRD blind gate, not a
// stronger one. The provenance anchor works precisely because it does not need
// the declared type.
//
// ## Known limits, stated rather than discovered later (#9747)
//
//   • Flow ACROSS files is not followed. A helper in another module that takes
//     a session and reads `.tenantId` is invisible to both rules. Measured: 7
//     call sites in the corpus pass a `.session` expression as an argument, all
//     7 same-file, 0 of them reading `.tenantId` today.
//   • A session reaching a receiver through a container (array element, map
//     value, spread into a new object) is not followed.
//   • The BINDING rule reads code, not strings: an aliased read taught inside a
//     template literal is seen by neither rule (the TEXT rule catches only the
//     literal spelling there).
//   • A `session` OBJECT LITERAL is not a read, so no rule scores it. Both
//     rules resolve a session-valued RECEIVER and grade a `.tenantId` READ off
//     it; `session: { tenantId: … }` CONSTRUCTS the removed dialect instead and
//     scores zero in test and non-test files alike (#9809, below).
// These are the shapes to widen to if one ever goes live. They are named here
// so a future green is read as "clean where this gate can see", never as proof.
//
// ## What the test exclusion covers, and what it does not (#9809)
//
// The bullet above used to justify the exclusion as "tests assert the alias is
// GONE". That is true of one population and silent about a second: a fixture
// can also CONSTRUCT the removed dialect, handing the code under test a
// `session: { …, tenantId: … }` literal that `HookContextSchema` strips and
// `ObjectQLEngine.buildSession` never emits. The second shape is the one that
// can hold a production defect green, because the fixture supplies the very key
// production cannot -- which is how the pre-#9691 attachment fixture kept
// `callerContext()` reading a dead name for two majors.
//
// ⚠️ But the exclusion is NOT what hides that shape, and this is the correction
// worth carrying. Both rules grade a `.tenantId` READ off a receiver shown to
// be a session. An object literal whose KEY is `tenantId` under a `session:`
// property is a CONSTRUCTION, not a read, so no rule scores it -- and it scores
// zero in the scanned population too. Measured by running `findOffenders` over
// each shape under a NON-test filename, i.e. with the exclusion bypassed:
//
//   `expect(session.tenantId).toBeUndefined()`  (assertion side) ........ 1
//   `session: { userId, tenantId, positions }`  (input side) ............ 0
//   the verbatim pre-#9691 phantom-green, input + echoed expectation .... 0
//
// So deleting the test exclusion would not surface a single construction site.
// Reaching them is a NEW recognizer on a new axis (literal construction), not a
// loosening of this filter -- which is what makes it a judgement call rather
// than a repair, and the census says it is not earned yet.
//
// CENSUS on 83f8267f5 (2026-08-19), over the 2449 test/spec files the exclusion
// drops -- 2058 files remain scanned. Reproduce with:
//
//   rg -l --multiline --multiline-dotall 'session\s*:\s*\{[^{}]*\btenantId\b' \
//     -g '*.test.ts' -g '*.spec.ts' examples apps packages
//
//   `session: { … tenantId … }` literals in EXCLUDED test files ......... 4
//   ... of them wrong today ............................................ 0
//   the same literal in the SCANNED (non-test) population ............... 0
//
//     packages/spec/src/data/hook.test.ts:619                   #3290 absence pin
//     packages/plugins/plugin-audit/src/audit-writers.test.ts:1666  absence pin
//     packages/plugins/plugin-audit/src/comment-access-hooks.test.ts:529  #9691
//     packages/services/service-storage/src/attachment-access-hooks.test.ts:750
//
// (The recipe reports 5 matches across those 4 files: `hook.test.ts` carries a
// second one whose `tenantId` sits inside a COMMENT in the literal's body.)
//
// ⛔ The distinguishing signal is NOT "input side vs assertion side". All four
// deliberate pins put the removed key on the INPUT side -- constructing the
// dialect on purpose is HOW you pin that it gets stripped. What separates them
// from a phantom-green is whether the fixture asserts the key's FATE (absent,
// or inert downstream) or echoes its VALUE back as expected output. Even that
// does not reduce to a text rule: `attachment-access-hooks.test.ts` legitimately
// asserts `toEqual({ …, tenantId: 'org_1', … })` one test earlier, because
// `tenantId` on the way OUT is `ExecutionContext`'s driver-layer name for the
// same value -- byte-identical to what a phantom-green would write. A recognizer
// on this axis has to tell those two apart, and today it would ship catching
// nothing: 4 sites, 0 wrong.
//
// Both shapes are pinned in `--self-test`, so this stays executable rather than
// remembered. An author who later builds the construction-axis recognizer will
// see the input-shape cases flip from 0 to 1: that is the contract moving on
// purpose, not a regression.
//
// ## The population invariant -- zero is a broken scan, not a clean repo
//
// The BINDING rule is only as good as the population it discovers, and this
// gate spent its whole life certifying a corpus it could not read. So the
// discovered count is PRINTED on every run and a count of ZERO is a FAILURE:
// hook and action bodies bind their session before reading it, so a corpus
// with no session binding at all means the resolver stopped working, not that
// the tree got clean. (The germ is `check-engine-double-contract`'s DISCOVERED
// invariant -- "Zero is not a clean repo, it is a broken scan" -- generalised
// here to the one population this gate depends on.) Measured stability: 8
// bindings today, and the two files that carry the only `.tenantId` reads have
// not changed shape since #7141 / #7145 introduced them.
//
// ## LIVE or LATENT, measured on 51a46a440's successor (af2a989be)
//
// Corpus: 2051 author-facing source files. Projections (this gate's old strip
// vs `maskComments`) disagree on the text of **271** files, but the gate's
// VERDICT changes on **0** -- every one of the 10 corpus lines that names
// `session.tenantId` today is inside a comment, and old and new agree on all
// ten. So the #9444 defect is LATENT here; the #9691 defect above was LIVE.
// The measurement that means something for the comment half is the NEAR MISS:
// **665 lines across 181 files** carry a doubled slash inside a string,
// template or regex literal. The day one of them also carries the removed read,
// the old gate goes quiet.
//
// ## Why `maskComments` and not `stripComments`
//
// The TEXT rule reports a FILE and a LINE, so it takes the blanking projection:
// the masked text stays byte-for-byte aligned with the source and line `i` is
// still line `i`. Cost measured over the same 2051 files (best of 3, scan +
// match only): old per-line strip 195ms, `maskComments` 2088ms, `stripComments`
// 1275ms. #9367 measured a 51x cliff (6.4s -> 5m27s) when a LAZY `[\s\S]*?`
// matcher was dragged across the whitespace blanking leaves behind; this gate's
// matcher is a short anchored pattern run per line, so it is not exposed to
// that. The BINDING rule parses only the files that contain the word `session`
// at all -- 254 of 2057, +1.2s -- so the whole gate stays around 3s.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';
import { maskComments } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOTS = ['examples', 'apps', 'packages'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cts', '.mts'];
const EXCLUDED = /(^|\/)(node_modules|dist|build|\.next|\.turbo)\//;
// Dropped WHOLESALE: absence pins and fixtures that CONSTRUCT the removed
// dialect alike. Neither is a reference body an author copies -- and the
// construction shape is invisible to both rules anyway, so this filter is not
// what hides it (#9809, header).
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)__tests__\/)/;

// `ctx.session.tenantId`, `session?.tenantId`, `this.session . tenantId`, … --
// the literal `session` receiver immediately before `.tenantId`. Anchored on the
// `session` word so `execCtx.tenantId` / `opts.tenantId` never match. This is
// the TEXT half only; a receiver under any OTHER name is the BINDING rule's job.
const PATTERN = /\bsession\s*\??\.\s*tenantId\b/;
const ALLOW_MARKER = 'os-allow-tenant-id';

const SESSION_PROP = 'session';
const TENANT_PROP = 'tenantId';
/** Transitive propagation depth. The deepest real chain in the corpus is 2
 * hops (`stampData` -> `applyToRecord`); the cap only bounds pathological input. */
const FIXPOINT_ROUNDS = 6;

// ── the binding rule ──────────────────────────────────────────────────────

/** Peel the wrappers that carry a value through unchanged. */
function unwrap(node) {
  let e = node;
  while (
    e &&
    (ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isTypeAssertionExpression?.(e) ||
      e.kind === ts.SyntaxKind.NonNullExpression ||
      e.kind === ts.SyntaxKind.SatisfiesExpression)
  ) {
    e = e.expression;
  }
  return e;
}

/** The property being read, for `a.b` and `a['b']` alike; undefined otherwise. */
function readProperty(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/**
 * Does this expression EVALUATE to a session?
 *
 * `isSessionIdent(identifierNode)` answers the same question for a bare name,
 * which is how the fixpoint feeds itself. Note what is deliberately NOT here:
 * the receiver's spelling. `ctx?.session ?? {}`, `(ctx as any).session`,
 * `ctx['session']` and `a` (where `a` was already shown to be one) all qualify;
 * `opts`, `execCtx` and every other name qualify only by provenance.
 */
function isSessionValued(expr, isSessionIdent) {
  const e = unwrap(expr);
  if (!e) return false;
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    // `x.session ?? {}` / `x.session || {}` -- the fallback is the empty-object
    // guard every one of these bindings writes; either arm being a session is
    // enough, because the read that follows is the read either way.
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      return isSessionValued(e.left, isSessionIdent) || isSessionValued(e.right, isSessionIdent);
    }
    return false;
  }
  if (ts.isConditionalExpression(e)) {
    return isSessionValued(e.whenTrue, isSessionIdent) || isSessionValued(e.whenFalse, isSessionIdent);
  }
  if (ts.isIdentifier(e)) return isSessionIdent(e);
  return readProperty(e) === SESSION_PROP;
}

/** The node a declaration's name is visible inside -- block, function or file. */
function scopeOf(node) {
  let p = node.parent;
  while (p) {
    if (
      ts.isBlock(p) ||
      ts.isSourceFile(p) ||
      ts.isModuleBlock(p) ||
      ts.isCaseBlock(p) ||
      ts.isFunctionLike(p)
    ) {
      return p;
    }
    p = p.parent;
  }
  return node.getSourceFile();
}

function contains(scope, node) {
  return node.pos >= scope.pos && node.end <= scope.end;
}

/**
 * Every session-valued binding in one parsed file, plus every declaration that
 * SHADOWS one of those names, so a read resolves to the nearest declaration
 * rather than to any same-named binding anywhere in the file.
 *
 * ⛔ Per-FILE name matching (what #9691's sketch proposed) is the version of
 * this that manufactures findings: a file that binds `const s = ctx.session` in
 * one function and takes an unrelated `s` in another would report the second.
 * Resolving to the innermost enclosing declaration costs one ancestor walk and
 * removes the whole class -- pinned in `--self-test`.
 */
function collectBindings(sf) {
  const sessionBindings = []; // { name, scope, decl }
  const allDeclarations = []; // { name, scope }  -- session or not
  const localFunctions = new Map(); // name -> [functionLikeNode]

  const declare = (name, node) => allDeclarations.push({ name, scope: scopeOf(node) });

  const walk = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declare(node.name.text, node);
      const init = node.initializer && unwrap(node.initializer);
      if (init && (ts.isFunctionExpression(init) || ts.isArrowFunction(init))) {
        const list = localFunctions.get(node.name.text) ?? [];
        list.push(init);
        localFunctions.set(node.name.text, list);
      }
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      declare(node.name.text, node);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      const list = localFunctions.get(node.name.text) ?? [];
      list.push(node);
      localFunctions.set(node.name.text, list);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  const isSessionIdent = (ident) => {
    let best = null;
    for (const b of sessionBindings) {
      if (b.name !== ident.text || !contains(b.scope, ident)) continue;
      if (!best || b.scope.pos > best.scope.pos) best = b;
    }
    if (!best) return false;
    // A nearer declaration of the same name shadows the session binding.
    for (const d of allDeclarations) {
      if (d.name !== ident.text || !contains(d.scope, ident)) continue;
      if (d.scope.pos > best.scope.pos) return false;
    }
    return true;
  };

  const known = new Set();
  const remember = (name, scope, decl) => {
    const key = `${name}@${decl.pos}`;
    if (known.has(key)) return false;
    known.add(key);
    sessionBindings.push({ name, scope, decl });
    return true;
  };

  // Fixpoint: a binding can be session-valued only because ANOTHER one already
  // is, and a call site can only be read after its callee's params are known.
  for (let round = 0; round < FIXPOINT_ROUNDS; round++) {
    let grew = false;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isSessionValued(node.initializer, isSessionIdent)) {
          grew = remember(node.name.text, scopeOf(node), node) || grew;
        }
      }
      // Same-file call: `helper(ctx.session)` makes `helper`'s parameter a
      // session for the whole of its body. Only a name declared as a function
      // EXACTLY ONCE in this file is followed -- an overloaded or reassigned
      // name is not something a syntax tree can resolve honestly.
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const fns = localFunctions.get(node.expression.text);
        if (fns && fns.length === 1) {
          const fn = fns[0];
          node.arguments.forEach((arg, i) => {
            const param = fn.parameters[i];
            if (!param || !ts.isIdentifier(param.name)) return;
            if (isSessionValued(arg, isSessionIdent)) {
              grew = remember(param.name.text, fn, param) || grew;
            }
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (!grew) break;
  }

  return { sessionBindings, isSessionIdent };
}

/**
 * `<session-valued receiver>.tenantId` reads in one parsed file.
 *
 * The receiver must be a bare identifier this file showed being filled from a
 * `.session` expression. A property-access receiver (`ctx.session.tenantId`)
 * is the TEXT rule's job and is skipped here so the two rules do not both
 * claim the same line for different reasons.
 */
function collectBoundReads(sf, isSessionIdent) {
  const hits = [];
  const visit = (node) => {
    if (readProperty(node) === TENANT_PROP) {
      const recv = unwrap(node.expression);
      if (recv && ts.isIdentifier(recv) && isSessionIdent(recv)) {
        hits.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          via: recv.text,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function parse(text, file) {
  // `scriptKind` left to the parser so `.tsx` / `.jsx` / `.mjs` are inferred
  // from the name. The parser is error-tolerant: a file it cannot fully parse
  // still yields the nodes around the failure rather than throwing.
  return parseSourceFile(file, text);
}

// ── the gate ──────────────────────────────────────────────────────────────

/**
 * Every removed-alias read in one source, as `{ file, line, text, via }`.
 *
 * `via` names the receiver the BINDING rule resolved, or `session` for a TEXT
 * hit, so the message can tell the author WHY this line is a finding when the
 * word `session` is nowhere on it.
 *
 * The comment/code split comes from `maskComments`, once per file, and the
 * masked text is index-aligned with the raw text, so a finding still quotes the
 * RAW line the author will open.
 *
 * The waiver is read from the RAW line ON PURPOSE. It is documented as a
 * comment on the offending line, and the mask blanks comments -- testing the
 * masked line for it would silently revoke every waiver in the tree, which is
 * the sort of change a green run cannot show you.
 */
export function findOffenders(text, file) {
  const lines = text.split('\n');
  const byLine = new Map();

  const code = maskComments(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!PATTERN.test(code[i] ?? '')) continue;
    byLine.set(i + 1, { file, line: i + 1, text: lines[i].trim(), via: SESSION_PROP });
  }

  let bindings = 0;
  if (text.includes(SESSION_PROP)) {
    const sf = parse(text, file);
    const { sessionBindings, isSessionIdent } = collectBindings(sf);
    bindings = sessionBindings.length;
    for (const hit of collectBoundReads(sf, isSessionIdent)) {
      if (byLine.has(hit.line)) continue;
      byLine.set(hit.line, {
        file,
        line: hit.line,
        text: (lines[hit.line - 1] ?? '').trim(),
        via: hit.via,
      });
    }
  }

  const offenders = [...byLine.values()]
    .filter((o) => !(lines[o.line - 1] ?? '').includes(ALLOW_MARKER))
    .sort((a, b) => a.line - b.line);
  offenders.bindings = bindings;
  return offenders;
}

/** The discovered session-binding population of one source (population invariant). */
export function countSessionBindings(text, file) {
  if (!text.includes(SESSION_PROP)) return [];
  const sf = parse(text, file);
  return collectBindings(sf).sessionBindings.map((b) => ({
    file,
    line: sf.getLineAndCharacterOfPosition(b.decl.getStart(sf)).line + 1,
    name: b.name,
  }));
}

/**
 * The shapes, not the corpus.
 *
 * A green run over today's tree proves only that today's tree lacks the shape,
 * and for a zero-occurrence hard-fail guard it can prove nothing else -- so
 * these cases ARE this gate's contract. `BLIND` marks a case the pre-#9444 strip
 * got wrong by MISSING a real read; `FABRICATE` marks one it got wrong by
 * inventing a finding out of prose; `RENAMED` marks one the pre-#9691
 * name-anchored PATTERN could not see at all.
 *
 * ⛔ The `RENAMED` cases are deliberately spelled with receivers no vocabulary
 * would ever contain (`hookState`, `zzz`, an anonymous parameter). #9750's dev
 * measured a harness that passed `284/284` with the guarantee absent; a case
 * that a widened alias list could satisfy would be that harness. These can be
 * satisfied only by resolving where the value came from.
 */
function selfTest() {
  const BT = String.fromCharCode(96); // backtick, kept out of the literals below
  const cases = [
    // [source, expected offender count, label]
    ["  const docs = 'https://objectstack.ai/x'; return session.tenantId;", 1,
      'BLIND: a URL in a string hid the read behind it (#9444)'],
    ['  const glob = ' + "'packages//src'" + '; const t = ctx.session.tenantId;', 1,
      'BLIND: a bare doubled slash inside a string'],
    ["  const p = /https:\\/\\//; return session.tenantId;", 1,
      'BLIND: a regex literal whose escaped slashes read as a comment opener'],
    ['  const hint = ' + BT + 'see https://x/y' + BT + '; return session?.tenantId;', 1,
      'BLIND: the same shape inside a template literal'],
    ['/*\n a block comment interior line naming session.tenantId\n*/\nconst ok = 1;', 0,
      'FABRICATE: an interior comment line with no leading star'],
    ['doThing(); /* session.tenantId was removed in v11 */', 0,
      'FABRICATE: a trailing block comment on a code line'],
    ['const org = ctx.user.organizationId; // session.tenantId is gone (#3290)', 0,
      'a trailing line comment naming the alias is documentation'],
    ['// the deprecated session.tenantId alias was removed in v11', 0,
      'a whole-line comment is documentation'],
    ['/**\n * the deprecated session.tenantId alias was removed in v11\n */\nconst ok = 1;', 0,
      'a JSDoc continuation line inside a real docblock is documentation'],
    ['const t = ctx.session.tenantId; // os-allow-tenant-id: driver isolation column', 0,
      'the waiver marker still exempts the line'],
    ['const t = execCtx.tenantId ?? opts.tenantId;', 0,
      'the driver-layer tenancy knob is never matched'],
    ['const t = this.session . tenantId;', 1,
      'whitespace between the receiver and the property'],
    ['/** doc naming session.tenantId */\nreturn session.tenantId;', 1,
      'a docblock does not swallow the code line under it'],
    ['const sample = ' + BT + 'ctx.session.tenantId' + BT + ';', 1,
      'a string is not a comment: an authoring sample teaching the removed alias is a finding'],

    // ── #9691: the receiver name is not the anchor ──────────────────────
    ['function h(ctx) {\n  const sess = (ctx).session ?? {};\n  return recordOrgId ?? sess.tenantId;\n}', 1,
      'RENAMED: the shipped pre-#9516 shape -- `sess`, which the old PATTERN scored zero'],
    ['function h(ctx) {\n  const hookState = ctx.session;\n  return hookState.tenantId;\n}', 1,
      'RENAMED: a receiver no alias vocabulary would ever list'],
    ['function h(ctx) {\n  const a = ctx.session;\n  const zzz = a;\n  return zzz.tenantId;\n}', 1,
      'RENAMED: transitive -- the session is two rebinds away from the read'],
    ['function h(ctx) {\n  const sess =\n    (ctx).session ?? {};\n  return sess.tenantId;\n}', 1,
      'RENAMED: the binding spans two lines -- a single-line scan returns a false zero (#9681)'],
    ["function h(ctx) {\n  const s = ctx['session'];\n  return s['tenantId'];\n}", 1,
      'RENAMED: element access on both hops'],
    ['function pick(anything) {\n  return anything.tenantId;\n}\nfunction h(ctx) {\n  return pick(ctx.session);\n}', 1,
      'RENAMED: a same-file helper PARAMETER fed a session -- the receiver has no session-ish name at all'],
    ['function h(ctx) {\n  const s = ctx.session;\n  return s.tenantId; // os-allow-tenant-id: driver isolation column\n}', 0,
      'the waiver marker exempts an ALIASED read too'],

    // ── #9691: and it must not manufacture findings ─────────────────────
    ['function h(opts) {\n  const s = opts.driverOptions;\n  return s.tenantId;\n}', 0,
      'NO FALSE RED: a one-letter receiver that is NOT a session -- the vocabulary answer would fire here'],
    ['function a(ctx) {\n  const s = ctx.session;\n  return s.organizationId;\n}\nfunction b(opts) {\n  const s = opts;\n  return s.tenantId;\n}', 0,
      'NO FALSE RED: same name, different scope -- the read resolves to the nearer declaration'],
    ['function h(ctx) {\n  const s = ctx.session;\n  return s.organizationId;\n}', 0,
      'the blessed name on a session receiver is the whole point and is never a finding'],
    ['function pick(o) {\n  return o.tenantId;\n}\nfunction h(opts) {\n  return pick(opts);\n}', 0,
      'NO FALSE RED: the same helper fed DRIVER options does not become a session'],
    ['function h(ctx) {\n  const sess = ctx.session;\n  // sess.tenantId was removed in v11 (#3290)\n  return sess.organizationId;\n}', 0,
      'a comment naming an ALIASED read is documentation -- the tree never sees it'],
    ['function h(ctx) {\n  const execCtx = ctx.input.options.context;\n  return execCtx.tenantId;\n}', 0,
      'NO FALSE RED: the driver-layer envelope is not reached through `.session`'],

    // ── #9809: what the test exclusion covers, and what it does not ─────
    // These run through the DETECTOR under a non-test filename, so they state
    // what the RULES do independently of the TEST_FILE filter. An author who
    // builds the construction-axis recognizer flips the two 0s to 1s: that is
    // the contract moving on purpose, not a regression.
    ['expect(session.tenantId).toBeUndefined();', 1,
      'ABSENCE PIN: the shape the test exclusion is written for -- a finding but for the filter'],
    ["await hook({\n  object: 'sys_attachment',\n  session: { userId: 'u1', tenantId: 'stale_org', positions: ['p1'] },\n});", 0,
      'CONSTRUCTION: a `session:` literal spelling the removed key is not a READ, so no rule scores it -- deleting the exclusion would not reach it'],
    ["await hook({\n  session: { userId: 'u1', tenantId: 'org_1' },\n});\nexpect(canEdit.mock.calls[0][2]).toEqual({ userId: 'u1', tenantId: 'org_1' });", 0,
      'CONSTRUCTION: the verbatim pre-#9691 phantom-green -- input literal plus echoed expectation, invisible to both rules'],
  ];

  let failed = 0;
  for (const [src, want, label] of cases) {
    const got = findOffenders(src, 'self-test.ts').length;
    if (got !== want) {
      console.error(`  ✗ self-test "${label}": expected ${want} offender(s), got ${got}`);
      failed++;
    }
  }

  // The population invariant is itself a contract: a resolver that discovers
  // nothing must not be able to pass this harness.
  const populated = countSessionBindings(
    'function h(ctx) {\n  const sess = ctx.session ?? {};\n  return sess.organizationId;\n}',
    'self-test.ts',
  );
  if (populated.length !== 1) {
    console.error(
      `  ✗ self-test "the binding population is discovered at all": expected 1 binding, got ${populated.length}`,
    );
    failed++;
  }

  if (failed) {
    console.error(`\n✗ check-org-identifier self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ check-org-identifier self-test: ${cases.length + 1} cases pass.`);
}

function sourceFiles(root) {
  // Newline-delimited on purpose (not `-z`): tracked paths under these roots
  // never contain a newline, and avoiding the NUL delimiter keeps this very
  // script free of any raw NUL byte (which would make it invisible to grep -- the
  // exact #3127 failure mode this repo already guards with check:nul-bytes).
  return execFileSync('git', ['ls-files', '--', ...ROOTS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)))
    .filter((f) => !EXCLUDED.test(f))
    .filter((f) => !TEST_FILE.test(f));
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const root = repoRoot();
  const files = sourceFiles(root);

  if (process.argv.includes('--list-bindings')) {
    const all = [];
    for (const file of files) {
      all.push(...countSessionBindings(readFileSync(join(root, file), 'utf8'), file));
    }
    const spellings = new Map();
    for (const b of all) spellings.set(b.name, (spellings.get(b.name) ?? 0) + 1);
    for (const b of all) console.log(`  ${b.file}:${b.line}  ${b.name}`);
    console.log(
      `\n${all.length} session binding(s), ${spellings.size} distinct spelling(s): ` +
        [...spellings].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} x${c}`).join(', '),
    );
    process.exit(0);
  }

  const offenders = [];
  let bindings = 0;
  for (const file of files) {
    const found = findOffenders(readFileSync(join(root, file), 'utf8'), file);
    bindings += found.bindings ?? 0;
    offenders.push(...found);
  }

  // ⛔ Zero is not a clean repo, it is a broken scan. The BINDING rule certifies
  // nothing if it discovered no session to anchor on, and this gate spent its
  // whole life printing OK over a population it could not read (#9691).
  if (bindings === 0) {
    console.error(
      'check-org-identifier: the session-binding resolver discovered ZERO session-valued\n' +
        'receivers in the scan roots. Hook and action bodies bind their session before\n' +
        'reading it, so zero means this gate stopped being able to read the tree -- NOT\n' +
        'that the tree is clean. Run `node scripts/check-org-identifier.mjs --list-bindings`\n' +
        'and `--self-test`; a green result here would be the exact silent under-reporting\n' +
        'the guard exists to prevent.',
    );
    process.exit(1);
  }

  if (offenders.length === 0) {
    console.log(
      `check-org-identifier: OK (${files.length} author-facing source file(s), ` +
        `${bindings} session binding(s) resolved, no removed session.tenantId alias).`,
    );
    process.exit(0);
  }

  const plural = offenders.length === 1 ? 'occurrence' : 'occurrences';
  console.error(
    `check-org-identifier: ${offenders.length} removed \`session.tenantId\` ${plural} in author-facing code\n`,
  );
  for (const o of offenders) {
    const how = o.via === SESSION_PROP ? '' : `  [receiver \`${o.via}\` was bound from a \`.session\` expression]`;
    console.error(`  • ${o.file}:${o.line}  ${o.text}${how}`);
  }
  console.error(`
\`session.tenantId\` was REMOVED from the hook/action ctx.session surface (#3290);
it no longer carries a value. In a hook or action body read the caller's active
org under the blessed name instead:

    const org = ctx.user?.organizationId ?? ctx.session?.organizationId;

It matches the \`organization_id\` column and \`current_user.organizationId\` in
RLS. For a genuine driver-layer use (a configurable isolation column, not the
caller's org), add an \`${ALLOW_MARKER}\` comment on the line.

⛔ Renaming the receiver is NOT a fix. This gate resolves where the value came
from, not what it is spelled, so \`const s = ctx.session; s.tenantId\` is the
same finding under a different name -- and before #9691 that rename was the
cheapest way to silence it while leaving the dead read in place.`);
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
