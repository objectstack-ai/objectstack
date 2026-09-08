#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-object-def-param-keys (#16711) -- an object-definition parameter must
 * DECLARE every key that is read off it, including the keys its base class
 * declared.
 *
 *   node scripts/check-object-def-param-keys.mjs
 *   node scripts/check-object-def-param-keys.mjs --list
 *   node scripts/check-object-def-param-keys.mjs --self-test
 *
 * ## The measured failure, twice, in two packages, over five weeks
 *
 * `SqlDriver` takes object definitions as inline object-literal parameter types
 * (`{ name: string; fields?: Record<string, any>; ... }`) and then reads keys
 * off them that the literal does not list, through `(obj as any).<key>`. Three
 * instances were carded one at a time before anyone called it a class:
 *
 *   #4311   `tenancy`    declared on `SqlDriver.initObjects` in August
 *   #16570  `indexes`    declared on the same three entry points in September
 *   #16711  `lifecycle`  the third, and the card that stopped counting them
 *
 * The failure is silent by construction. TypeScript's excess-property check
 * fires on a FRESH object literal and not on one bound to a variable first, so
 * the same object is accepted or refused depending only on where it is spelled:
 *
 *     await driver.initObjects([{ ...bare, lifecycle: { storage: … } }]);  // TS2353
 *     const hoisted = { ...bare, lifecycle: { storage: … } };
 *     await driver.initObjects([hoisted]);                                // accepted
 *
 * The loud outcome -- a compile error on a CORRECT call -- is the good one. The
 * bad one is an author, or an AI reading the signature, concluding the key is
 * not accepted and DROPPING it: a declared UNIQUE that is never synced, an
 * ADR-0057 rotation policy that is never armed, and nothing anywhere says so.
 *
 * ## ⭐ Why this gate is NOT scoped to one file, which is the whole point
 *
 * The obvious gate -- sweep `sql-driver.ts` for `(obj as any).<key>` against
 * the parameter types in the same file -- would have caught NEITHER historical
 * escape, and #16711's triage ruling says so in one sentence:
 *
 *     ⛔ 闸门若只盯 `sql-driver.ts`,#4311 与本次都拦不住
 *
 * `TursoDriver extends SqlDriver` and OVERRIDES `initObjects`. An override does
 * not inherit the base's parameter type, so its own, narrower literal is what
 * every caller of `@objectstack/driver-turso` sees. #4311's `tenancy` fix
 * landed on the base in August and was invisible from outside that package for
 * five weeks; #16570's `indexes` fix would have escaped identically. Meanwhile
 * the override's remote arm sends the whole object through as `schema`, so the
 * RUNTIME carries both keys and only the type face refuses them.
 *
 * So the question this gate answers is not "which keys does `SqlDriver` read
 * but not declare". It is the one the ruling reframed it into:
 *
 *     「一个子类在另一个已发布的包里静默遮蔽了基类的声明,
 *       使基类的修复从外面看不见」
 *
 * ## The three arms
 *
 * **A -- OVERRIDE NARROWING.** For every class in the corpus that extends
 * another class in the corpus, every method present on both: each parameter
 * position whose base type is an inline object literal (or an array of one)
 * must declare every key the base declares. This arm crosses package
 * boundaries by construction -- the corpus is the workspace, not a directory.
 *
 * **B -- UNDECLARED CAST READ.** Inside a method, `(x as any).<key>` where `x`
 * is a parameter annotated with an inline object literal -- or a `for…of`
 * binding over a parameter annotated with an array of one -- and `<key>` is not
 * in that literal. This is the original #16711 census instrument, generalised
 * off `sql-driver.ts` and onto every driver source in the tree.
 *
 * **C -- THE ESCAPE HATCHES.** Both arms above are made vacuous by two edits
 * that look like fixes: giving the parameter an index signature
 * (`[key: string]: unknown`), or replacing a base's object literal with an
 * opaque annotation in the override. Either makes every key "declared" and
 * deletes the whole layer of protection this class is about. #16711's 验收口径
 * item 4 names exactly this shape as the failure mode its negative control
 * exists for, so the gate refuses it directly rather than trusting a reviewer
 * to notice. Measured 0 on the tree this landed against, so the ledger below is
 * empty and adding to it is a maintainer's call.
 *
 * ## ⚠️ Why the corpus carries a POSITIVE CONTROL and refuses without it
 *
 * This gate's own development reproduced, on the first run, the exact trap
 * #16711's PM comment recorded on the file it scans: a `git ls-files` pathspec
 * of `packages`, a slash, a star, a slash, `src`, a slash, a double star, a
 * slash and `*.ts` matched only files at least one directory BELOW
 * `src/`, so `sql-driver.ts` and `turso-driver.ts` were both outside the
 * corpus. The gate printed `0 violations` and exited 0. Nothing about that
 * reading was distinguishable from a clean tree.
 *
 * A zero whose control does not fire has measured NOTHING. So the corpus
 * enumeration is checked against {@link REQUIRED_CORPUS_FILES} -- files that
 * must be in it for any verdict to mean anything -- and a run that cannot see
 * them exits {@link EXIT_CORPUS_UNVERIFIED} rather than green. That is the same
 * distinction `scripts/ts-parse.mjs` draws with `EXIT_UNPARSEABLE`: "nothing to
 * report" and "I could not read it" are different answers and must not share an
 * exit code.
 *
 * ## Why an AST and not a regex
 *
 * The signature this class hides behind WRAPS ACROSS LINES. #16711's PM comment
 * records a single-line grep for `indexes|tenancy` over the Turso override
 * returning nothing -- and its control returning nothing too, because
 * `override async initObjects(` and its parameter are on different lines. That
 * was a silence, not a negative, and it is the second time that trap fired on
 * that seat in one night. A parameter list is a tree, so this gate reads it as
 * one, through the repo's single sanctioned parser entry point
 * (`scripts/ts-parse.mjs#parseSourceFile`), which refuses a source it could not
 * read instead of scoring it clean.
 *
 * ## What it does NOT claim
 *
 * It compares DECLARED key sets, not assignability. It cannot tell you that a
 * declared `indexes?: any[]` is the right type for what the body does with it,
 * and it does not look at named type aliases or interfaces -- an object
 * definition passed as `ObjectMeta` is out of scan scope in both arms, because
 * a named type has one declaration site and does not have this class's failure
 * mode (a sibling method silently disagreeing about the same input). Arm C is
 * what keeps "make it a named opaque type" from being a route to green.
 *
 * The live sites this gate was built against, as symbol anchors so they do not
 * rot: `packages/drivers/driver-sql/src/sql-driver.ts#ensureShardTable`,
 * (`#initObjects`, `#registerObjectMetadata`, `#registerManagedObjectMetadata`,
 * `#detectManagedDrift`, `#rotateShards`, `#ensureRotation`) and
 * `packages/drivers/driver-turso/src/turso-driver.ts#TursoDriver` — whose
 * `initObjects` override and `registerRemoteFieldMetadata` helper are the two
 * members this gate reads there. ⚠️ Neither is spelled as a symbol anchor,
 * because neither has a resolvable declaration site under the shared resolver's
 * rule: `override async initObjects(` puts the name mid-line, which is the SAME
 * wrapped-signature shape that made a single-line grep for it return a silence
 * on this very file. Anchoring the class instead keeps the citation checked.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './git-env.mjs';
import { requireDefaultExport } from './import-prerequisite.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The exit status of "I could not read the tree I am supposed to judge".
 *
 * Distinct from 1 ("found violations") and from 0 ("nothing to report") for the
 * reason the header's positive-control section gives: those are three different
 * answers and a shared code makes two of them unreachable.
 */
export const EXIT_CORPUS_UNVERIFIED = 3;

/**
 * Files whose presence in the corpus is the gate's positive control.
 *
 * ⛔ These are not "important files"; they are the files whose ABSENCE has
 * already been observed to turn this gate into a green no-op. Both carry a live
 * class-member declaration this gate must be able to see, so a corpus that
 * misses either one cannot have judged the class at all.
 */
export const REQUIRED_CORPUS_FILES = [
  'packages/drivers/driver-sql/src/sql-driver.ts',
  'packages/drivers/driver-turso/src/turso-driver.ts',
  'packages/drivers/driver-sqlite-wasm/src/sqlite-wasm-driver.ts',
];

/**
 * Arm-C exemptions, keyed `<file>::<Class>.<method>#<paramIndex>`.
 *
 * ⛔ SHRINK-ONLY, and a maintainer's call. An entry here says "this parameter
 * may erase the base's declared shape", which switches arms A and B off for it.
 * Measured empty on the tree this gate landed against; an author whose override
 * needs a different type widens the BASE instead, which keeps both arms live.
 */
export const ARM_C_EXEMPT = Object.freeze({});

/**
 * The corpus: every tracked TypeScript source under a package's `src/`, minus
 * test and spec files.
 *
 * ⚠️ Enumerated with a plain `git ls-files packages` and filtered in JS on
 * purpose. The star-slash-double-star pathspec spelling reads as though it says
 * this, and does not: git's `**` requires at least one intervening directory,
 * so every file sitting directly in a `src/` -- which is where both driver
 * entry points live -- falls out of it silently. The filter below is the same
 * predicate written where it can be read.
 */
export function corpusFiles(root = ROOT) {
  const out = execFileSync('git', ['-C', root, 'ls-files', 'packages'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: gitFreeEnv(),
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => f.endsWith('.ts') && f.includes('/src/') && !/\.(test|spec)\.ts$/.test(f));
}

/**
 * The declared key set of an inline object-literal type, plus whether it
 * carries an index signature.
 */
function literalKeys(node) {
  const keys = [];
  let indexSignature = false;
  for (const member of node.members) {
    if (ts.isIndexSignatureDeclaration(member)) {
      indexSignature = true;
      continue;
    }
    if (!ts.isPropertySignature(member) || !member.name) continue;
    if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) keys.push(member.name.text);
  }
  return { keys, indexSignature };
}

/**
 * Classify a parameter's type annotation.
 *
 *   `object`  an inline object literal            -- judged
 *   `array`   an array of an inline object literal -- judged, element-wise
 *   `opaque`  anything else (named type, union, `any`, …) -- not judged
 *   `none`    no annotation at all                -- not judged
 *
 * Only the first two carry a decidable key set, which is the whole reason the
 * other two are reported as a kind rather than merged into "unknown": arm C
 * reads the difference between them and a base that HAD one.
 */
export function classifyParamType(typeNode) {
  if (!typeNode) return { kind: 'none' };
  if (ts.isTypeLiteralNode(typeNode)) return { kind: 'object', ...literalKeys(typeNode) };
  if (ts.isArrayTypeNode(typeNode) && ts.isTypeLiteralNode(typeNode.elementType)) {
    return { kind: 'array', ...literalKeys(typeNode.elementType) };
  }
  if (
    ts.isTypeReferenceNode(typeNode)
    && ts.isIdentifier(typeNode.typeName)
    && typeNode.typeName.text === 'Array'
    && typeNode.typeArguments?.length === 1
    && ts.isTypeLiteralNode(typeNode.typeArguments[0])
  ) {
    return { kind: 'array', ...literalKeys(typeNode.typeArguments[0]) };
  }
  return { kind: 'opaque', text: typeNode.getText() };
}

/** Strip parentheses so `((x as any)).k` reads the same as `(x as any).k`. */
function unwrap(expr) {
  let e = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/**
 * One source file's contribution: the classes it declares (with each method's
 * parameter shapes) and every arm-B cast read inside it.
 */
export function analyzeSource(fileName, text) {
  const sourceFile = parseSourceFile(fileName, text, ts.ScriptKind.TS);
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const classes = [];
  const castReads = [];

  const collectCastReads = (fnNode, ownerLabel) => {
    /** identifier -> the object shape it is known to carry */
    const env = new Map();
    for (const param of fnNode.parameters) {
      if (!ts.isIdentifier(param.name)) continue;
      const shape = classifyParamType(param.type);
      if (shape.kind === 'object' || shape.kind === 'array') {
        env.set(param.name.text, { ...shape, origin: 'a parameter' });
      }
    }

    const walk = (node) => {
      // `for (const obj of objects)` where `objects` is an array-shaped
      // parameter: the binding carries the element shape. This is not a nicety
      // -- #16711's `lifecycle` read is spelled exactly this way, and a gate
      // that only followed parameters directly would have missed it.
      if (
        ts.isForOfStatement(node)
        && ts.isVariableDeclarationList(node.initializer)
        && node.initializer.declarations.length === 1
        && ts.isIdentifier(node.expression)
      ) {
        const decl = node.initializer.declarations[0];
        const source = env.get(node.expression.text);
        if (ts.isIdentifier(decl.name) && source?.kind === 'array') {
          env.set(decl.name.text, {
            kind: 'object',
            keys: source.keys,
            indexSignature: source.indexSignature,
            origin: `an element of \`${node.expression.text}\``,
          });
        }
      }

      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const inner = unwrap(node.expression);
        if (
          ts.isAsExpression(inner)
          && inner.type.kind === ts.SyntaxKind.AnyKeyword
          && ts.isIdentifier(inner.expression)
        ) {
          const shape = env.get(inner.expression.text);
          const key = ts.isPropertyAccessExpression(node)
            ? node.name.text
            : (ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null);
          if (shape && key && !shape.indexSignature && !shape.keys.includes(key)) {
            castReads.push({
              file: fileName,
              line: lineOf(node),
              owner: ownerLabel,
              identifier: inner.expression.text,
              key,
              origin: shape.origin,
              declared: shape.keys,
            });
          }
        }
      }

      ts.forEachChild(node, walk);
    };

    if (fnNode.body) walk(fnNode.body);
  };

  const visit = (node) => {
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
      const extendsClause = node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
      const baseExpr = extendsClause?.types?.[0]?.expression;
      const methods = new Map();
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
        methods.set(member.name.text, {
          line: lineOf(member),
          params: member.parameters.map((p) => classifyParamType(p.type)),
        });
      }
      classes.push({
        name: node.name.text,
        base: baseExpr && ts.isIdentifier(baseExpr) ? baseExpr.text : null,
        file: fileName,
        line: lineOf(node),
        methods,
      });
    }

    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      collectCastReads(node, node.name.text);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      collectCastReads(node, node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { classes, castReads };
}

/**
 * Arms A and C, over the whole class index.
 *
 * A base class is resolved BY NAME. Two classes sharing a name is not resolved
 * by guessing: the pair is reported as `ambiguous` and judged by nothing, which
 * is visible in `--list` instead of silently skipped.
 */
export function findOverrideFindings(classes) {
  const byName = new Map();
  for (const c of classes) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }

  const narrowing = [];
  const erasure = [];
  const ambiguous = [];
  let comparedPairs = 0;

  for (const derived of classes) {
    if (!derived.base) continue;
    const candidates = byName.get(derived.base);
    if (!candidates || candidates.length === 0) continue;
    if (candidates.length > 1) {
      ambiguous.push({ derived: derived.name, file: derived.file, base: derived.base, count: candidates.length });
      continue;
    }
    const base = candidates[0];
    if (base === derived) continue;

    for (const [methodName, method] of derived.methods) {
      const baseMethod = base.methods.get(methodName);
      if (!baseMethod) continue;
      const arity = Math.min(method.params.length, baseMethod.params.length);
      for (let i = 0; i < arity; i++) {
        const basePar = baseMethod.params[i];
        const derPar = method.params[i];
        if (basePar.kind !== 'object' && basePar.kind !== 'array') continue;
        comparedPairs += 1;

        const exemptKey = `${derived.file}::${derived.name}.${methodName}#${i}`;
        if (Object.prototype.hasOwnProperty.call(ARM_C_EXEMPT, exemptKey)) continue;

        if (derPar.kind === 'opaque' || derPar.kind === 'none') {
          erasure.push({
            kind: 'erased',
            file: derived.file,
            line: method.line,
            derived: derived.name,
            base: base.name,
            baseFile: base.file,
            method: methodName,
            param: i,
            detail: derPar.kind === 'none' ? '(no annotation)' : derPar.text,
            exemptKey,
          });
          continue;
        }
        if (derPar.indexSignature || basePar.indexSignature) {
          erasure.push({
            kind: 'index-signature',
            file: derPar.indexSignature ? derived.file : base.file,
            line: derPar.indexSignature ? method.line : baseMethod.line,
            derived: derived.name,
            base: base.name,
            baseFile: base.file,
            method: methodName,
            param: i,
            detail: 'an index signature makes every key "declared"',
            exemptKey,
          });
          continue;
        }

        const missing = basePar.keys.filter((k) => !derPar.keys.includes(k));
        if (missing.length > 0) {
          narrowing.push({
            file: derived.file,
            line: method.line,
            derived: derived.name,
            base: base.name,
            baseFile: base.file,
            baseLine: baseMethod.line,
            method: methodName,
            param: i,
            missing,
            baseKeys: basePar.keys,
            derivedKeys: derPar.keys,
          });
        }
      }
    }
  }

  return { narrowing, erasure, ambiguous, comparedPairs };
}

/** Read the whole corpus and produce every finding, in one pass. */
export function sweep(root = ROOT) {
  const files = corpusFiles(root);
  const missingControls = REQUIRED_CORPUS_FILES.filter((f) => !files.includes(f));

  const classes = [];
  const castReads = [];
  if (missingControls.length === 0) {
    for (const rel of files) {
      const analyzed = analyzeSource(rel, readFileSync(resolve(root, rel), 'utf8'));
      classes.push(...analyzed.classes);
      castReads.push(...analyzed.castReads);
    }
  }

  return { files, missingControls, classes, castReads, ...findOverrideFindings(classes) };
}

// ───────────────────────────── self-test ─────────────────────────────

const SELF_TEST_VERDICT = 'check-object-def-param-keys self-test: OK';

/**
 * The `TursoDriver.initObjects` signature EXACTLY as it stood on `main` before
 * #16711 -- the gate's permanent firing control.
 *
 * ⭐ #16711's 验收口径 item 2: 「闸门自己要有发火对照…⛔ 只在修复后跑一次绿的
 * 闸门,与没有闸门无法区分」. Once the tree is fixed, the production sweep is
 * green forever, and a green sweep is the one reading that cannot tell a
 * working gate from a broken one. This fixture is the reading that can: it is
 * the real historical shape, it must go RED, and it stays in the self-test long
 * after the source it was copied from stopped looking like this.
 *
 * ⛔ Do not "update" it to today's signature. It is a dated record of a defect,
 * not a mirror of the file.
 */
const TURSO_OVERRIDE_BEFORE_16711 = `
class SqlDriver {
  async initObjects(
    objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }>,
  ): Promise<void> {}
}
class TursoDriver extends SqlDriver {
  override async initObjects(
    objects: Array<{ name: string; fields?: Record<string, any> }>,
  ): Promise<void> {}
}
`;

function analyzeSnippet(source) {
  const { classes, castReads } = analyzeSource('fixture.ts', source);
  return { ...findOverrideFindings(classes), castReads };
}

export function selfTest() {
  const failures = [];
  const t = (name, ok) => { if (!ok) failures.push(name); };

  // ── Arm A: the firing control, and both directions around it ──
  const before = analyzeSnippet(TURSO_OVERRIDE_BEFORE_16711);
  t(
    'FIRING CONTROL: the pre-#16711 TursoDriver override is RED for both keys',
    before.narrowing.length === 1
      && before.narrowing[0].method === 'initObjects'
      && before.narrowing[0].missing.join(',') === 'tenancy,indexes',
  );
  t(
    'FIRING CONTROL: it is red because of the SUBCLASS, not the base',
    before.narrowing[0]?.derived === 'TursoDriver' && before.narrowing[0]?.base === 'SqlDriver',
  );
  t('the widened override is green', analyzeSnippet(`
class SqlDriver {
  async initObjects(objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }>): Promise<void> {}
}
class TursoDriver extends SqlDriver {
  override async initObjects(objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }>): Promise<void> {}
}
`).narrowing.length === 0);
  t('an override declaring MORE than the base is green', analyzeSnippet(`
class A { m(o: { a?: 1 }): void {} }
class B extends A { override m(o: { a?: 1; b?: 2 }): void {} }
`).narrowing.length === 0);
  t('a method the base does not have is not compared', analyzeSnippet(`
class A { m(o: { a?: 1 }): void {} }
class B extends A { other(o: {}): void {} }
`).narrowing.length === 0);
  t('a class with no resolvable base is not compared', analyzeSnippet(`
class B extends Unknown { m(o: {}): void {} }
`).narrowing.length === 0);
  t('a duplicated base name is reported ambiguous, never guessed', analyzeSnippet(`
class A { m(o: { a?: 1 }): void {} }
class A { m(o: { a?: 1 }): void {} }
class B extends A { override m(o: {}): void {} }
`).ambiguous.length === 1);

  // ⭐ The wrap trap, pinned. #16711's PM comment recorded a single-line grep
  // for these two keys over this exact shape returning nothing -- AND its
  // control returning nothing -- because the parameter is on its own line.
  const wrapped = analyzeSnippet(`
class A {
  m(
    objects: Array<{
      name: string;
      tenancy?: any;
    }>,
  ): void {}
}
class B extends A {
  override m(
    objects: Array<{
      name: string;
    }>,
  ): void {}
}
`);
  t('a signature wrapped across lines is still read (the recorded grep trap)',
    wrapped.narrowing.length === 1 && wrapped.narrowing[0].missing.join(',') === 'tenancy');

  // ── Arm B: the undeclared cast read ──
  const armB = analyzeSnippet(`
class A {
  m(obj: { fields?: Record<string, any>; tenancy?: any }): void {
    const x = (obj as any).indexes;
  }
}
`);
  t('a cast read of an undeclared key is RED',
    armB.castReads.length === 1 && armB.castReads[0].key === 'indexes');
  t('a cast read of a DECLARED key is green', analyzeSnippet(`
class A {
  m(obj: { fields?: Record<string, any>; indexes?: any[] }): void {
    const x = (obj as any).indexes;
  }
}
`).castReads.length === 0);

  // ⭐ The `for…of` binding: #16711's `lifecycle` read is spelled this way, so a
  // gate that only followed parameters directly would have scored it clean.
  const loop = analyzeSnippet(`
class A {
  m(objects: Array<{ name: string; fields?: Record<string, any> }>): void {
    for (const obj of objects) {
      const p = (obj as any).lifecycle?.storage;
    }
  }
}
`);
  t('a cast read on a for…of binding over an array parameter is RED',
    loop.castReads.length === 1 && loop.castReads[0].key === 'lifecycle');
  t('optional-chained and element-access spellings are read too', analyzeSnippet(`
class A {
  m(obj: { a?: 1 }): void {
    const x = (obj as any)?.zzz;
    const y = (obj as any)['yyy'];
  }
}
`).castReads.length === 2);
  t('a cast on a NON-parameter identifier is out of scan scope', analyzeSnippet(`
class A {
  m(): void {
    const local: any = {};
    const x = (local as any).whatever;
  }
}
`).castReads.length === 0);
  t('a parameter with an opaque named type is out of scan scope', analyzeSnippet(`
class A {
  m(query: DriverQuery): void {
    const x = (query as any).groupBy;
  }
}
`).castReads.length === 0);

  // ── Arm C: the two edits that would make arms A and B vacuous ──
  const erased = analyzeSnippet(`
class A { m(o: { a?: 1; b?: 2 }): void {} }
class B extends A { override m(o: any): void {} }
`);
  t('replacing the base literal with an opaque type is RED (not silently skipped)',
    erased.erasure.length === 1 && erased.erasure[0].kind === 'erased');
  const idx = analyzeSnippet(`
class A { m(o: { a?: 1; b?: 2 }): void {} }
class B extends A { override m(o: { a?: 1; b?: 2; [k: string]: unknown }): void {} }
`);
  t('an index signature on the override is RED', idx.erasure.length === 1 && idx.erasure[0].kind === 'index-signature');
  t('an index signature makes arm B silent, so arm C has to hold that line', analyzeSnippet(`
class A {
  m(obj: { a?: 1; [k: string]: unknown }): void {
    const x = (obj as any).anything;
  }
}
`).castReads.length === 0);

  // ── The corpus predicate itself, which is where this gate's own bug was ──
  const files = corpusFiles();
  for (const control of REQUIRED_CORPUS_FILES) {
    t(`POSITIVE CONTROL: the corpus contains ${control}`, files.includes(control));
  }
  t('the corpus excludes test files', !files.some((f) => /\.(test|spec)\.ts$/.test(f)));
  t('the corpus is only package sources', files.every((f) => f.startsWith('packages/') && f.includes('/src/')));

  if (failures.length > 0) {
    console.error(`\n✗ check-object-def-param-keys self-test: ${failures.length} case(s) failed\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    process.exit(1);
  }
  console.log(`${SELF_TEST_VERDICT} (${files.length} corpus file(s), every control fired)`);
  return SELF_TEST_VERDICT;
}

// ───────────────────────────── main ─────────────────────────────

function report(result) {
  const { narrowing, erasure, castReads } = result;
  const total = narrowing.length + erasure.length + castReads.length;

  if (total === 0) {
    console.log(
      `check:object-def-param-keys: OK — ${result.files.length} source file(s), `
      + `${result.classes.length} class(es), ${result.comparedPairs} override parameter position(s) compared.`,
    );
    return 0;
  }

  console.error(`check:object-def-param-keys: ${total} problem(s)\n`);

  if (narrowing.length > 0) {
    console.error('  ── A · an override declares FEWER keys than the base it shadows ──');
    for (const v of narrowing) {
      console.error(`  ${v.file}:${v.line}  ${v.derived} extends ${v.base} — ${v.method}(param ${v.param})`);
      console.error(`      drops: ${v.missing.join(', ')}`);
      console.error(`      base declares {${v.baseKeys.join('; ')}} at ${v.baseFile}:${v.baseLine}`);
    }
    console.error('');
  }
  if (erasure.length > 0) {
    console.error('  ── C · the base\'s declared shape is erased rather than widened ──');
    for (const v of erasure) {
      console.error(`  ${v.file}:${v.line}  ${v.derived} extends ${v.base} — ${v.method}(param ${v.param}) [${v.kind}]`);
      console.error(`      ${v.detail}`);
    }
    console.error('');
  }
  if (castReads.length > 0) {
    console.error('  ── B · a key is READ off a parameter its own type does not declare ──');
    for (const v of castReads) {
      console.error(`  ${v.file}:${v.line}  ${v.owner}: (${v.identifier} as any).${v.key}`);
      console.error(`      ${v.identifier} is ${v.origin} declared {${v.declared.join('; ')}}`);
    }
    console.error('');
  }

  console.error(`An object-definition parameter is a CONTRACT with the people who call it.
TypeScript's excess-property check fires on a fresh object literal and not on
one bound to a variable first, so a key the type omits is refused at some call
sites and accepted at others — and the author who hits the refusal drops the
key, which is silent: an unsynced UNIQUE, an unarmed rotation policy.

Fix it by DECLARING the key on the parameter type — on the override AND on the
base, so a fix to one is visible from the other — and deleting the \`as any\`.
⛔ Not by loosening the parameter to \`any\` or adding an index signature: that
turns every line above green while deleting the protection they are about (arm
C above refuses exactly that, and #16711 item 4 is the negative control for it).`);
  return 1;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    selfTest();
    return;
  }

  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-object-def-param-keys: the self-test returned without reaching its verdict,\n'
      + 'so the sweep below would be running on an unverified instrument.\n',
    );
    process.exit(1);
  }

  const result = sweep();

  if (result.missingControls.length > 0) {
    console.error(`\n✗ check-object-def-param-keys — REFUSING to report on a corpus that lost its controls.\n`);
    console.error(`  ${result.files.length} file(s) enumerated, but these are not among them:\n`);
    for (const f of result.missingControls) console.error(`      ${f}`);
    console.error(`
Every one of those carries a declaration this gate exists to read, so a verdict
without them is not a clean tree — it is a gate that scanned the wrong set. This
is the failure this gate was written with: a \`git ls-files\` pathspec whose
\`**\` silently excluded every file sitting directly in a \`src/\`, which printed
"0 violations" and exited 0.

If a control file was legitimately moved or renamed, update REQUIRED_CORPUS_FILES
in scripts/check-object-def-param-keys.mjs in the same commit.`);
    process.exit(EXIT_CORPUS_UNVERIFIED);
  }

  if (argv.includes('--list')) {
    console.log(`corpus: ${result.files.length} file(s), ${result.classes.length} class(es)`);
    console.log(`override parameter positions compared: ${result.comparedPairs}`);
    for (const c of result.classes.filter((c) => c.base)) {
      console.log(`  ${c.file}:${c.line}  ${c.name} extends ${c.base}`);
    }
    if (result.ambiguous.length > 0) {
      console.log(`\nambiguous base names (judged by nothing):`);
      for (const a of result.ambiguous) console.log(`  ${a.file}  ${a.derived} extends ${a.base} (${a.count} declarations)`);
    }
  }

  const status = report(result);
  if (status !== 0) process.exit(status);
}

if (isEntrypoint(import.meta.url)) main(process.argv.slice(2));
