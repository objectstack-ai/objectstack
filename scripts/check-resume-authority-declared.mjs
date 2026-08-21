#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-resume-authority-declared -- a pausing action descriptor must SAY who
// may resume the pauses it creates (objectstack#5561, from objectstack#3823).
//
//   node scripts/check-resume-authority-declared.mjs
//   node scripts/check-resume-authority-declared.mjs --list
//   node scripts/check-resume-authority-declared.mjs --self-test
//   node scripts/check-resume-authority-declared.mjs --packages-dir <path>
//
// ## The failure mode this exists for
//
// The #3801 resume gate keys on the SUSPENDED NODE: a pause whose descriptor
// declares `resumeAuthority: 'service'` continues only through the service that
// authorizes and records the decision, while `'any'` leaves the generic route
// (`POST /automation/:name/runs/:runId/resume`) open as the intended door. So the
// gate covers a pausing node type exactly when its author remembered the field.
//
// #3823 is what forgetting costs. ADR-0044 pointed an approval's revise edge at
// a generic `wait`; `wait` is legitimately `'any'` (an external producer is meant
// to resume a signal wait); the pause standing in a service-owned position
// inherited that value without anyone choosing it. Demonstrated cost: an
// unaudited resubmit, plus a destroyed remote run.
//
// Until #5561 the omission was not merely unnoticed, it was UNOBSERVABLE:
// `ActionDescriptorSchema.resumeAuthority` carried `.default('any')`, so
// `defineActionDescriptor` filled the key and produced a descriptor
// byte-identical to an explicit `'any'`. #5561 step one removed that default,
// which is what lets both this gate and the engine's registration warning exist.
//
// #5561 step two then flipped what an omission MEANS at run time: an undeclared
// pausing type resolves to `'service'`, so the generic route refuses its pauses
// instead of walking them. That raises this gate's stakes rather than changing
// its rule -- an omission that used to ship a silent hole now ships a node whose
// runs cannot be continued by the route its author probably intended. The rule
// is still "state your intent"; the finding text names the new consequence.
//
// ## Why a repo gate ALONGSIDE the registration warning
//
// They catch different populations, and this one catches the population that has
// actually bitten us. The runtime warning speaks to whoever reads a server log
// -- the right channel for a third-party plugin, of which this tree has none.
// #3823 was OUR OWN executor, written in this repo, and the moment to tell its
// author is the pull request, not a production log line. Failing CI is also the
// only form of this signal that is impossible to miss: a pausing descriptor that
// never declares its authority cannot merge.
//
// ## What it checks
//
//   DISCOVERED  the scan found `defineActionDescriptor({...})` literals at all.
//               Zero is not "a clean repo", it is a broken scan: DECLARED
//               iterates the discovered set, so a discovery that silently stops
//               matching would make this script print OK while reading nothing
//               (the #4868 family -- a check that runs, passes, and structurally
//               cannot reach its subject).
//   DECLARED    every discovered descriptor with `supportsPause: true` also
//               declares `resumeAuthority`. The value is not judged: `'any'` and
//               `'service'` are both correct answers, and which one is right is
//               the author's call. Only the SILENCE is a finding.
//
// ## What it cannot see (stated up front, not discovered later)
//
//   1. An executor that suspends while leaving `supportsPause` false is invisible
//      here and to the registration warning alike -- both key on the author's own
//      literal, which is what makes this gate decidable without a call graph.
//      That used to mean such an executor shipped a fail-open pause (#5703); as
//      of objectstack#6667 the ENGINE refuses the suspension at its boundary
//      instead, so the mismatch fails the run that produced it and the reader
//      hears it from the run that broke rather than from this gate. The division
//      of labour is deliberate: this gate judges declarations at authoring time,
//      the engine judges behaviour at run time, and neither can see the other's
//      subject.
//   1b. **Test fixtures are deliberately out of scope.** The subject here is the
//      SHIPPED node vocabulary — descriptors a real engine registers in a real
//      deployment. A fixture registers into a throwaway engine and ships to
//      nobody, and more decisively: an undeclared pausing descriptor is exactly
//      what the registration warning's own tests must construct
//      (`resume-authority-declaration.test.ts`), and since step two so must the
//      resume gate's own tests (`resume-authority-gate.test.ts`, which pins that
//      an undeclared pause is refused). Gating fixtures would make both
//      mechanisms untestable; every such fixture in the tree is deliberate and
//      constructs the omission on purpose. (Note this is the mirror of
//      `check-engine-double-contract.mjs`, which scans ONLY tests: each gate's
//      scope is its subject, not a repo-wide sweep.)
//   2. Descriptors assembled dynamically -- spread from a variable, built by a
//      helper, or `JSON.parse`d -- are skipped rather than guessed at. The tree
//      writes none today (proved by DISCOVERED's count matching the literals),
//      and a scanner that tried to follow a spread would trade a decidable
//      criterion for a heuristic, which is how a gate starts producing false
//      positives and then gets switched off.
//   3. Third-party plugins outside this repo. That is the registration
//      warning's job, by construction.
//
// ## Why AST, not regex
//
// `supportsPause: true` and `resumeAuthority` can sit any distance apart, in any
// order, inside a literal that also carries a `configSchema` JSON Schema tens of
// lines long with nested `properties` of its own -- `screen`'s descriptor is 150
// lines. A regex over "supportsPause: true ... resumeAuthority" cannot tell a
// TOP-LEVEL descriptor property from an identically-named key nested inside that
// JSON Schema, and it cannot tell which literal a match belongs to. Object
// structure decides this, so the checker reads structure.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SCAN_ROOTS = ['packages', 'examples'];

/** The factory whose argument IS an action descriptor (packages/spec). */
const FACTORY = 'defineActionDescriptor';

// ── Discovery ───────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === '.cache') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    // Shipped sources only: no declaration files, no test fixtures (see "What it
    // cannot see" 1b — an undeclared pausing descriptor is a legitimate fixture).
    else if (
      /\.(ts|tsx|mts)$/.test(e.name)
      && !/\.d\.ts$/.test(e.name)
      && !/\.(test|spec)\.(ts|tsx|mts)$/.test(e.name)
    ) out.push(p);
  }
  return out;
}

function sourceFiles(scanRoots) {
  const out = [];
  for (const r of scanRoots) walk(join(ROOT, r), out);
  return out.sort();
}

/** The `name` of a top-level property in an object literal, or null. */
function propertyName(prop) {
  if (!ts.isPropertyAssignment(prop)) return null;
  const n = prop.name;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isStringLiteral(n)) return n.text;
  return null;
}

/**
 * Read the descriptor facts this gate judges out of ONE literal.
 *
 * Only top-level properties are read. That is the load-bearing difference from
 * a textual scan: `screen`'s descriptor nests a JSON Schema whose `properties`
 * could carry any key name at all, and a nested `supportsPause` would be author
 * data, not a capability declaration.
 */
function readDescriptor(objectLiteral) {
  let supportsPause = null;
  let declaresResumeAuthority = false;
  let type = null;

  for (const prop of objectLiteral.properties) {
    const name = propertyName(prop);
    if (name === null) continue;
    if (name === 'resumeAuthority') declaresResumeAuthority = true;
    if (name === 'supportsPause') {
      const init = prop.initializer;
      if (init.kind === ts.SyntaxKind.TrueKeyword) supportsPause = true;
      else if (init.kind === ts.SyntaxKind.FalseKeyword) supportsPause = false;
      else supportsPause = 'dynamic';
    }
    if (name === 'type' && ts.isStringLiteral(prop.initializer)) type = prop.initializer.text;
  }

  return { type, supportsPause, declaresResumeAuthority };
}

/** Every `defineActionDescriptor({ ... })` literal in one source text. */
function scanSource(fileName, text) {
  const sf = parseSourceFile(fileName, text);
  const found = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === FACTORY
      && node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isObjectLiteralExpression(arg)) {
        const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1;
        found.push({ line, ...readDescriptor(arg) });
      } else {
        // Not a literal (spread from a variable, a helper's return value). Recorded
        // as opaque so `--list` shows it and DISCOVERED counts it, but never judged:
        // see "What it cannot see" #2.
        const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1;
        found.push({ line, type: null, supportsPause: 'dynamic', declaresResumeAuthority: false, opaque: true });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return found;
}

function audit(scanRoots = DEFAULT_SCAN_ROOTS) {
  const errors = [];
  const found = [];

  for (const abs of sourceFiles(scanRoots)) {
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes(FACTORY)) continue;
    const descriptors = scanSource(abs, text);
    if (descriptors.length === 0) continue;
    found.push({ file: relative(ROOT, abs), descriptors });
  }

  // DISCOVERED
  if (found.length === 0) {
    errors.push(
      'DISCOVERED: the scan found no defineActionDescriptor() literal anywhere. That is not a clean '
        + 'repo, it is a broken scan — DECLARED iterates this set, so it passes vacuously and this '
        + 'script reports OK while reading nothing. Fix the discovery before trusting a green run.',
    );
  }

  // DECLARED
  for (const { file, descriptors } of found) {
    for (const d of descriptors) {
      if (d.supportsPause !== true) continue;
      if (d.declaresResumeAuthority) continue;
      const named = d.type ? `'${d.type}'` : `the descriptor at line ${d.line}`;
      errors.push(
        `DECLARED: ${file}:${d.line} — node type ${named} declares supportsPause: true but never `
          + 'declares resumeAuthority, so the #3801 resume gate REFUSES every pause it creates on the '
          + 'generic resume route (an unclaimed pause is fail-closed since #5561 step two). Add the '
          + "field to the descriptor: resumeAuthority: 'any' if that route IS the intended door (a "
          + "screen's collected inputs, a signal wait's external producer), or 'service' if resuming is "
          + 'the tail of a decision some service must authorize and record first (an approval). Both '
          + 'values are accepted here — only the silence is the finding, because an inherited value is '
          + 'one nobody chose, which is how #3823 walked past an unrecorded approval decision.',
      );
    }
  }

  return { found, errors };
}

function counts(found) {
  let total = 0;
  let pausing = 0;
  let declared = 0;
  let opaque = 0;
  for (const f of found) {
    for (const d of f.descriptors) {
      total++;
      if (d.opaque) opaque++;
      if (d.supportsPause === true) {
        pausing++;
        if (d.declaresResumeAuthority) declared++;
      }
    }
  }
  return { total, pausing, declared, opaque };
}

function report({ list = false, scanRoots = DEFAULT_SCAN_ROOTS } = {}) {
  const { found, errors } = audit(scanRoots);
  const { total, pausing, declared, opaque } = counts(found);

  console.log(
    `\naction descriptors: ${total} literal(s) in ${found.length} file(s) — ${pausing} pausing, `
      + `${declared} of those declare resumeAuthority`
      + `${opaque ? `, ${opaque} assembled dynamically (not judged)` : ''}.\n`,
  );

  if (list) {
    for (const { file, descriptors } of found) {
      for (const d of descriptors) {
        const kind = d.opaque ? 'opaque ' : d.supportsPause === true ? 'pausing' : 'plain  ';
        const auth = d.supportsPause === true ? (d.declaresResumeAuthority ? ' declared' : ' UNDECLARED') : '';
        console.log(`  ${kind}  ${file}:${d.line}  ${d.type ?? '(dynamic type)'}${auth}`);
      }
    }
    console.log('');
  }

  if (errors.length) {
    for (const e of errors) console.error(`  x ${e}`);
    console.error(
      '\nNote: a run pauses because execute() returned suspend: true, not because a descriptor said '
        + 'so. An executor that suspends while leaving supportsPause false is invisible to this gate '
        + "AND to the engine's registration warning — since #6667 the engine refuses that suspension "
        + 'at its boundary, so the mismatch fails the run instead of parking an unresumable one.\n',
    );
    console.error(`check-resume-authority-declared: ${errors.length} problem(s).\n`);
    process.exit(1);
  }

  if (!list) {
    for (const { file, descriptors } of found) {
      for (const d of descriptors.filter((x) => x.supportsPause === true)) {
        console.log(`  pausing  ${file}:${d.line}  ${d.type ?? '(dynamic type)'} → declared`);
      }
    }
    console.log('');
  }
  console.log(
    `check-resume-authority-declared: OK — every pausing descriptor declares its resume authority `
      + `(${declared}/${pausing}). A suspension from a type that declares supportsPause: false is `
      + `refused by the engine at run time (#6667), not by this gate.\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard (#4118). This drives the detector at
// both sides of every decision it makes, so a refactor that neuters it fails
// here rather than turning every future PR green.

function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };

  const descriptor = (body) => `import { defineActionDescriptor } from '@objectstack/spec/automation';
engine.registerNodeExecutor({
  type: 'x',
  descriptor: defineActionDescriptor({
${body}
  }),
  async execute() { return { success: true }; },
});
`;

  // ── The finding itself, and its two silences.
  let d = scanSource('a.ts', descriptor("    type: 'x', version: '1.0.0', name: 'X', supportsPause: true,"));
  expect('finds a pausing descriptor that omits resumeAuthority',
    d.length === 1 && d[0].supportsPause === true && d[0].declaresResumeAuthority === false);
  expect('reads the node type for the message', d[0].type === 'x');

  d = scanSource('a.ts', descriptor("    type: 'x', version: '1.0.0', name: 'X', supportsPause: true, resumeAuthority: 'any',"));
  expect("an explicit 'any' satisfies the gate", d.length === 1 && d[0].declaresResumeAuthority === true);

  d = scanSource('a.ts', descriptor("    type: 'x', version: '1.0.0', name: 'X', supportsPause: true, resumeAuthority: 'service',"));
  expect("an explicit 'service' satisfies the gate", d.length === 1 && d[0].declaresResumeAuthority === true);

  // ── Scope: a non-pausing descriptor is not asked the question.
  d = scanSource('a.ts', descriptor("    type: 'x', version: '1.0.0', name: 'X',"));
  expect('a descriptor with no supportsPause is out of scope', d.length === 1 && d[0].supportsPause === null);

  d = scanSource('a.ts', descriptor("    type: 'x', version: '1.0.0', name: 'X', supportsPause: false,"));
  expect('supportsPause: false is out of scope', d.length === 1 && d[0].supportsPause === false);

  // ── Structure, not text: the property must be the descriptor's OWN, not a
  //    key of the same name nested inside its configSchema JSON Schema. This is
  //    the case a regex cannot decide, and `screen` really does nest a schema.
  const nested = descriptor(`    type: 'x', version: '1.0.0', name: 'X',
    configSchema: {
      type: 'object',
      properties: {
        supportsPause: { type: 'boolean', title: 'Author field that happens to share the name' },
        resumeAuthority: { type: 'string' },
      },
    },`);
  d = scanSource('a.ts', nested);
  expect('a nested supportsPause key is not read as a capability',
    d.length === 1 && d[0].supportsPause === null && d[0].declaresResumeAuthority === false);

  const nestedUnderPausing = descriptor(`    type: 'x', version: '1.0.0', name: 'X',
    supportsPause: true,
    configSchema: {
      type: 'object',
      properties: { resumeAuthority: { type: 'string' } },
    },`);
  d = scanSource('a.ts', nestedUnderPausing);
  expect('a nested resumeAuthority key does not satisfy the gate for a pausing descriptor',
    d.length === 1 && d[0].supportsPause === true && d[0].declaresResumeAuthority === false);

  // ── Two descriptors in one file are judged separately (crud-nodes.ts ships
  //    four), and a violation next to a compliant one is still found.
  const two = `import { defineActionDescriptor } from '@objectstack/spec/automation';
const a = defineActionDescriptor({ type: 'a', version: '1.0.0', name: 'A', supportsPause: true, resumeAuthority: 'service' });
const b = defineActionDescriptor({ type: 'b', version: '1.0.0', name: 'B', supportsPause: true });
`;
  d = scanSource('two.ts', two);
  expect('judges sibling descriptors independently',
    d.length === 2 && d[0].declaresResumeAuthority === true && d[1].declaresResumeAuthority === false);

  // ── A dynamically assembled argument is recorded, never judged.
  d = scanSource('dyn.ts', "const d = defineActionDescriptor(base);\n");
  expect('a non-literal argument is opaque, not a violation', d.length === 1 && d[0].opaque === true);

  d = scanSource('spread.ts',
    "const d = defineActionDescriptor({ ...base, supportsPause: true });\n");
  expect('a spread literal is still read for its own explicit properties',
    d.length === 1 && d[0].supportsPause === true && d[0].declaresResumeAuthority === false);

  // ── A same-named local factory is not the spec's. Deliberately still counted:
  //    the criterion is the literal's shape, and a hand-rolled factory producing
  //    a descriptor has the same obligation. Asserted so the choice is visible.
  d = scanSource('local.ts',
    "function defineActionDescriptor(x: any) { return x; }\nconst d = defineActionDescriptor({ type: 'x', supportsPause: true });\n");
  expect('a same-named local factory is judged too (documented choice)',
    d.length === 1 && d[0].supportsPause === true);

  expect('a file with no descriptors yields nothing', scanSource('empty.ts', 'export const x = 1;\n').length === 0);

  // ── Wiring: discovery must reach the real tree, and specifically the four
  //    pausing built-ins #5561 declared. Deliberately NOT asserted here: that the
  //    tree is clean. That is the gated run's job, and duplicating it would make
  //    a genuine violation surface as a self-test failure — the least legible
  //    message available.
  const { found } = audit();
  expect('discovers descriptors in the real tree', found.length > 0);
  const pausingTypes = new Set();
  for (const f of found) {
    for (const dd of f.descriptors) if (dd.supportsPause === true && dd.type) pausingTypes.add(dd.type);
  }
  for (const t of ['screen', 'wait', 'subflow', 'map']) {
    expect(`discovery reaches the '${t}' pausing built-in`, pausingTypes.has(t));
  }

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-resume-authority-declared --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: finds a pausing descriptor that omits resumeAuthority, accepts either declared '
      + 'value, leaves non-pausing descriptors alone, reads TOP-LEVEL properties only (a configSchema '
      + 'key of the same name neither triggers nor satisfies it), judges sibling descriptors '
      + 'independently, treats a non-literal argument as opaque rather than as a violation, and proves '
      + 'discovery reaches the four pausing built-ins.',
  );
}

const argv = process.argv.slice(2);
const dirFlag = argv.indexOf('--packages-dir');
const scanRoots = dirFlag === -1 ? DEFAULT_SCAN_ROOTS : [argv[dirFlag + 1]];

if (argv.includes('--self-test')) selfTest();
else report({ list: argv.includes('--list'), scanRoots });
