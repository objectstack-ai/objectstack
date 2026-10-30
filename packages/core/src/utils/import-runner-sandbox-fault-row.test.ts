// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22741] An import row for the sandbox's OWN fault reads the create door's
 * fault sentence, never the runner's diagnostic text. This is the enumeration
 * pin that closes the import-row versus data-door fault-text family (#22694 the
 * refusal, #22718 the crash and the declared 5xx, this card the rest).
 *
 * ## What was measured broken
 *
 * The REAL `QuickJSScriptRunner`, at `eed637c09f`, fed to the real
 * `mapDataError` and `runImport`: a hook body that burns its CPU budget, one
 * stuck past the wall-clock ceiling, one denied `api.read`, one denied `log`
 * and one whose `ctx.api` method is missing each threw a `SandboxError` with no
 * `innerMessage`. The create door answered every one `500 INTERNAL_ERROR`
 * `Internal server error`; the row answered the runner's text, e.g.
 * `hook 'mz_lock_insert' exceeded CPU budget of 50ms (after 0 pump iterations)`.
 * `toFailedResult` takes the door's sentence only for a sandbox ORIGIN (a
 * non-empty `innerMessage`), and these errors have none.
 *
 * ## Why an enumeration, and what it iterates
 *
 * The population is read from the producer, not listed here.
 * `packages/runtime/src/sandbox/quickjs-runner.ts` is parsed with the
 * TypeScript compiler, and every `new SandboxError(…)` that passes no
 * `innerMessage` is a site, as is every `throwSandboxFault(vm, …)` call, whose
 * `SandboxError` the pump loop rebuilds with no `innerMessage` once the fault
 * has crossed the VM. Each site's message is rendered from its own template
 * literal, with a fixed sample per interpolation. So:
 *
 *  - a new fault site is in the population the day it lands, and turns this
 *    file red if its row does not read the door's sentence;
 *  - a site this file cannot render (an interpolation with no sample, a
 *    message that is not a literal and not a declared relay) is red too, and
 *    the failure names it.
 *
 * Comments are not code: the two `throw new SandboxError(` examples inside the
 * runner's doc comments are not sites, because the parser never sees them.
 *
 * The class is REPRODUCED, because `@objectstack/core` sits below
 * `@objectstack/runtime`, but its `name` is READ from the producer's
 * constructor (`this.name = '…'`). A rename there reaches every case below.
 *
 * §2 runs the relay half: a construction that DOES set `innerMessage`, after
 * its body crashed one VM hop down, arrives at the outer pump as a fault with
 * that construction's `.message` and no `innerMessage`. §3 holds the controls,
 * which stay unchanged by this card: driver text, and errors the sandbox did
 * not raise. `import-runner-sandbox-refusal-row.test.ts` §4 is the driver-text
 * control #22718's ablation B pinned, and it is not edited here.
 *
 * [#22868] The sample object name in a rendered message IS the import's
 * object. Two sites name it — the `ctx.api.object(…)` capability gate and the
 * missing-method arm — and `mapDataError`'s unknown-object heuristic answered
 * those `404 OBJECT_NOT_FOUND` (a quoted requested-object name plus `not`)
 * until the door asked `isSandboxOwnFault` first. So §1 holds each site that
 * names the requested object to the door's `500`, and §3 holds the controls
 * that keep the heuristic's other answers where they were.
 *
 * [#26903/#26965] The capability gates call `throwCapabilityDenial(vm, origin,
 * capability, message)`, not `throwSandboxFault`. Since #26965 that helper
 * answers EVERY origin's denial (hook, action, job) as a coded refusal, so a
 * capability gate is no longer a fault site: §4 holds each one to the refusal
 * the runner hands out. The census reads both halves from the producer rather
 * than trusting this comment:
 *
 *  - the helper's body calls no `throwSandboxFault` (it has no fault arm), and
 *    no fault site's message reads as a capability denial;
 *  - each gate's message (argument 3) is rendered as before, then run through
 *    the helper's own sentence template (its `new Error(…)`) with the code and
 *    status its `Object.assign` declares, once per origin kind.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';
import { mapDataError, INTERNAL_ERROR_MESSAGE, isSandboxOwnFault } from '@objectstack/types';
import { runImport, sanitizeRowError, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, '../../../runtime/src/sandbox/quickjs-runner.ts');
const SOURCE = ts.createSourceFile(RUNNER, readFileSync(RUNNER, 'utf8'), ts.ScriptTarget.Latest, true);

const OBJECT = 'mz_locked';

/**
 * One sample per interpolation the runner's fault messages use. A message
 * naming an expression not listed here is unrenderable, and §1's census says
 * which. `objectName` is the import's object (see the header).
 */
const SAMPLES: Readonly<Record<string, string>> = {
  'args.origin.kind': 'hook',
  'args.origin.name': 'mz_lock_insert',
  'origin.kind': 'hook',
  'origin.name': 'mz_lock_insert',
  cpuBudget: '50',
  wallCeiling: '30000',
  pumps: '3',
  'formatErr(msg)': 'SyntaxError: unexpected token',
  objectName: OBJECT,
  method: 'find',
  required: 'api.read',
  fieldName: 'owner',
};

/** The helper every capability gate throws through, read below from the producer. */
const CAPABILITY_HELPER = 'throwCapabilityDenial';

/** [#26965] Every origin a body runs under answers a denial the same way; §4 renders each. */
const ORIGIN_KINDS = ['hook', 'action', 'job'] as const;

/** A placeholder for `origin.kind` in a gate's rendered message, filled per kind in §4. */
const ORIGIN_KIND_HOLE = '@@origin.kind@@';

/** §2: the error a nested body threw, so the construction it lands in is a CRASH. */
const CRASH_SAMPLES: Readonly<Record<string, string>> = {
  ...SAMPLES,
  'formatErr(err)': 'TypeError: boom',
  errStr: 'TypeError: boom',
};

/**
 * The single-argument constructions whose message is not a literal: each one
 * re-raises a fault that other sites produce. A relay missing from the
 * runner, or a new non-literal one, fails §1's census.
 */
const RELAYS: Readonly<Record<string, string>> = {
  message: '`throwSandboxFault` builds the error for each of its call sites, which are sites here in their own right',
  'withoutSandboxErrorPrefix(String(errStr))':
    'the pump loop rebuilds a fault marked across the VM hop: the `throwSandboxFault` messages, the host-side faults thrown inside a host call (sites here), and a nested body\'s crash (§2)',
};

/** Each named fault kind, with the number of sites measured at `eed637c09f` as its floor. */
const KINDS: ReadonlyArray<readonly [kind: string, pattern: RegExp, floor: number]> = [
  ['CPU budget', /exceeded CPU budget/, 1],
  ['wall-clock ceiling', /exceeded wall-clock ceiling/, 1],
  ['ctx.api unavailable', /^ctx\.api unavailable/, 1],
  ['install failure', /^failed to install/, 4],
  ['marshal failure', /^failed to marshal/, 1],
  ['nested transaction refusal', /^nested ctx\.api\.transaction/, 1],
  ['missing ctx.api method', /not implemented$/, 1],
];

interface Site {
  label: string;
  message: string;
}

function lineOf(node: ts.Node): number {
  return SOURCE.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function render(node: ts.Expression, samples: Readonly<Record<string, string>>): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return render(node.expression, samples);
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const expr = span.expression.getText();
      if (!(expr in samples)) throw new Error(`no sample for the interpolation \`${expr}\``);
      out += samples[expr] + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return render(node.left, samples) + render(node.right, samples);
  }
  throw new Error(`a message that is neither a literal nor a declared relay: \`${node.getText()}\``);
}

/** The `name` the producer's constructor assigns, read from the source. */
function producerName(): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'SandboxError') {
      for (const member of node.members) {
        if (!ts.isConstructorDeclaration(member) || member.body === undefined) continue;
        for (const st of member.body.statements) {
          if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression)) continue;
          const { left, right, operatorToken } = st.expression;
          if (
            operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(left) &&
            left.expression.kind === ts.SyntaxKind.ThisKeyword &&
            left.name.text === 'name' &&
            ts.isStringLiteral(right)
          ) {
            found = right.text;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(SOURCE);
  return found;
}

const census = (() => {
  const faults: Site[] = [];
  const crashes: Site[] = [];
  const relays: string[] = [];
  const unrenderable: string[] = [];
  const capabilityGates: CapabilityGate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'SandboxError') {
      const args = node.arguments ?? [];
      const at = `quickjs-runner.ts:${lineOf(node)}`;
      if (args.length === 1) {
        const text = args[0].getText();
        if (text in RELAYS) {
          relays.push(text);
        } else {
          try {
            faults.push({ label: `${at} new SandboxError(…)`, message: render(args[0], SAMPLES) });
          } catch (e) {
            unrenderable.push(`${at}: ${(e as Error).message}`);
          }
        }
      } else if (args.length >= 2) {
        try {
          crashes.push({ label: `${at} new SandboxError(…, innerMessage), relayed`, message: render(args[0], CRASH_SAMPLES) });
        } catch (e) {
          unrenderable.push(`${at} (relayed): ${(e as Error).message}`);
        }
      } else {
        unrenderable.push(`${at}: a construction with no message`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'throwSandboxFault') {
      const at = `quickjs-runner.ts:${lineOf(node)}`;
      const text = node.arguments[1]?.getText() ?? '';
      if (text in RELAYS) {
        relays.push(text);
      } else {
        try {
          faults.push({ label: `${at} throwSandboxFault(…)`, message: render(node.arguments[1], SAMPLES) });
        } catch (e) {
          unrenderable.push(`${at}: ${(e as Error).message}`);
        }
      }
    }
    // [#26965] A capability gate: a refusal for every origin, held by §4.
    // Its message is rendered per origin kind there; `origin.kind` stays a
    // placeholder here.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === CAPABILITY_HELPER) {
      const at = `quickjs-runner.ts:${lineOf(node)}`;
      try {
        capabilityGates.push({
          label: `${at} ${CAPABILITY_HELPER}(…)`,
          message: render(node.arguments[3], { ...SAMPLES, 'origin.kind': ORIGIN_KIND_HOLE }),
          // The capability is a literal token, or the `required` parameter a
          // gate passes on (its sample is the token it is called with).
          capability: ts.isIdentifier(node.arguments[2]) && node.arguments[2].text in SAMPLES
            ? SAMPLES[node.arguments[2].text]
            : render(node.arguments[2], SAMPLES),
        });
      } catch (e) {
        unrenderable.push(`${at}: ${(e as Error).message}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(SOURCE);
  return { faults, crashes, relays, unrenderable, capabilityGates };
})();

/** The value a `const NAME = <literal>` declaration in the producer holds. */
function constValue(name: string): string | number | undefined {
  let found: string | number | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) found = init.text;
      else if (ts.isNumericLiteral(init)) found = Number(init.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(SOURCE);
  return found;
}

/**
 * [#26965] The capability helper, read from its body: whether it can still
 * reach `throwSandboxFault`, the sentence template its `new Error(…)` builds,
 * and the `code` / `status` its `Object.assign` declares.
 */
const capabilityHelper = (() => {
  let callsFault = false;
  let template: ts.Expression | undefined;
  let code: unknown;
  let status: unknown;
  const valueOf = (e: ts.Expression): unknown => {
    if (ts.isStringLiteral(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (ts.isIdentifier(e)) return constValue(e.text);
    return undefined;
  };
  const visitBody = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'throwSandboxFault') callsFault = true;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Error') template = node.arguments?.[0];
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === 'code') code = valueOf(node.initializer);
      if (node.name.text === 'status') status = valueOf(node.initializer);
    }
    ts.forEachChild(node, visitBody);
  };
  let params: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === CAPABILITY_HELPER && node.body) {
      params = node.parameters.map((p) => p.name.getText());
      visitBody(node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(SOURCE);
  const [, origin, capability, message] = params;
  /** The sentence the helper builds for one gate under one origin kind. */
  const sentence = (gate: CapabilityGate, kind: string): string => {
    if (template === undefined) throw new Error(`${CAPABILITY_HELPER} builds no \`new Error(…)\``);
    const gateText = gate.message.split(ORIGIN_KIND_HOLE).join(kind);
    return render(template, {
      [`${message}.replace(/\\.$/, '')`]: gateText.replace(/\.$/, ''),
      [message]: gateText,
      [capability]: gate.capability,
      [`${origin}.kind`]: kind,
    });
  };
  return { callsFault, code, status, sentence, found: params.length === 4 };
})();

interface CapabilityGate extends Site {
  capability: string;
}

/**
 * [#26965] The error the runner hands out for a denied capability: the pump
 * loop's relay of a coded refusal — the `<kind> '<name>' threw:` wrapper in
 * `.message` for the log, the sentence in `innerMessage`, and the code and
 * status the refusal carried across the VM.
 */
function capabilityRefusal(gate: CapabilityGate, kind: string): Error {
  const text = capabilityHelper.sentence(gate, kind);
  const err = new Error(`${kind} '${SAMPLES['origin.name']}' threw: ${PRODUCER_NAME}: ${text}`);
  err.name = PRODUCER_NAME ?? 'unread';
  return Object.assign(err, { innerMessage: text, code: capabilityHelper.code, status: capabilityHelper.status });
}

const PRODUCER_NAME = producerName();

/** [#22868] The fault sites whose rendered message quotes the requested object. */
function namingTheObject(): Site[] {
  return census.faults.filter((s) => s.message.includes(`'${OBJECT}'`));
}

/** [#26965] The capability gates whose rendered message quotes the requested object. */
function gatesNamingTheObject(): CapabilityGate[] {
  return census.capabilityGates.filter((s) => s.message.includes(`'${OBJECT}'`));
}

/** The producer's own fault: its declared `name`, and no `innerMessage`. */
function ownFault(message: string): Error {
  const err = new Error(message);
  err.name = PRODUCER_NAME ?? 'unread';
  return err;
}

type CreateArgs = Parameters<ImportProtocolLike['createData']>[0];

const baseOpts = {
  objectName: OBJECT,
  metaMap: new Map<string, ExportFieldMeta>([['name', { name: 'name', type: 'text' }]]),
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

/** Inline path: no bulk primitive, so each row is one `createData`. */
function inlineProtocol(fail: () => Error): ImportProtocolLike {
  return {
    findData: vi.fn(async () => []),
    createData: vi.fn(async (args: CreateArgs) => {
      if (args.data.name === 'r1') throw fail();
      return { id: `id_${String(args.data.name)}` };
    }),
    updateData: vi.fn(),
  };
}

async function rowFor(fail: () => Error) {
  const summary = await runImport({ ...baseOpts, p: inlineProtocol(fail), rows: [{ name: 'r1' }] });
  expect(summary.errors).toBe(1);
  return summary.results[0];
}

/** The door's verdict FIRST: a fault, its text withheld. Anti-vacuity for every row assertion below. */
function expectDoorWithholds(err: Error, message: string) {
  const door = mapDataError(err, OBJECT);
  expect(door.status).toBe(500);
  expect(door.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });
  expect(String(door.body.error)).not.toContain(message);
  return door;
}

describe('[#22741] §1 — every fault the runner raises itself reads the door\'s sentence on the row', () => {
  it('census: the producer is read, every construction is classified, and each named kind is present', () => {
    expect(PRODUCER_NAME, 'the `this.name = …` assignment in SandboxError\'s constructor').toBeTypeOf('string');
    expect(census.unrenderable, 'sites this pin cannot render; add a sample or a relay').toEqual([]);
    expect([...new Set(census.relays)].sort()).toEqual(Object.keys(RELAYS).sort());
    // [#26965] The capability gates throw through the helper, and the helper
    // has no fault arm: no gate is a fault row here (§4 holds them).
    expect(census.capabilityGates.length, `${CAPABILITY_HELPER} call sites`).toBeGreaterThanOrEqual(5);
    expect(capabilityHelper.found, `${CAPABILITY_HELPER} is declared with (vm, origin, capability, message)`).toBe(true);
    expect(capabilityHelper.callsFault, `${CAPABILITY_HELPER} reaches throwSandboxFault`).toBe(false);
    expect(census.faults.filter((s) => /^capability '/.test(s.message)), 'a capability denial raised as a fault').toEqual([]);
    for (const [kind, pattern, floor] of KINDS) {
      const n = census.faults.filter((s) => pattern.test(s.message)).length;
      expect(n, `${kind}: sites found`).toBeGreaterThanOrEqual(floor);
    }
    // §2's population: the constructions that set `innerMessage` (crash and refusal sites).
    expect(census.crashes.length).toBeGreaterThanOrEqual(4);
    // [#22868] The fault site that names the requested object: the
    // missing-method arm, held to `500` below. [#26965] The `ctx.api.object(…)`
    // capability gate names it too, and §4 holds it to its `403`.
    const named = namingTheObject();
    expect(named.filter((s) => /not implemented$/.test(s.message)).length, 'missing ctx.api method').toBeGreaterThanOrEqual(1);
    expect(gatesNamingTheObject().length, 'the ctx.api.object(…) capability gate').toBeGreaterThanOrEqual(1);
  });

  it.each(census.faults.map((s) => [s.label, s.message] as const))('%s', async (_label, message) => {
    const err = ownFault(message);
    expect(isSandboxOwnFault(err)).toBe(true);
    const door = expectDoorWithholds(err, message);

    const row = await rowFor(() => ownFault(message));
    expect(row).toEqual({ row: 1, ok: false, action: 'failed', error: door.body.error, code: 'IMPORT_ROW_FAILED' });
  });

  it('the batched write paths reach the same answer (the budget fault)', async () => {
    const budget = census.faults.find((s) => /exceeded CPU budget/.test(s.message))!.message;
    const insertManyData = vi.fn(async (args: { records: Array<Record<string, unknown>> }) => ({
      outcomes: args.records.map((r) => (r.name === 'r1'
        ? { ok: false, error: ownFault(budget) }
        : { ok: true, record: { id: `id_${String(r.name)}` } })),
    }));
    const p = { ...inlineProtocol(() => ownFault(budget)), createManyData: vi.fn(), insertManyData } as unknown as ImportProtocolLike;
    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r0' }, { name: 'r1' }, { name: 'r2' }] });

    expect(insertManyData).toHaveBeenCalledTimes(1);
    expect(summary.created).toBe(2);
    expect(summary.results[1]).toEqual({ row: 2, ok: false, action: 'failed', error: INTERNAL_ERROR_MESSAGE, code: 'IMPORT_ROW_FAILED' });
    expect(JSON.stringify(summary)).not.toMatch(/exceeded CPU budget|mz_lock_insert/);
  });
});

describe('[#22741] §2 — a nested body\'s crash, relayed one VM hop up as the sandbox\'s fault', () => {
  it.each(census.crashes.map((s) => [s.label, s.message] as const))('%s', async (_label, message) => {
    const err = ownFault(message);
    expect(isSandboxOwnFault(err)).toBe(true);
    const door = expectDoorWithholds(err, message);

    const row = await rowFor(() => ownFault(message));
    expect(row).toEqual({ row: 1, ok: false, action: 'failed', error: door.body.error, code: 'IMPORT_ROW_FAILED' });
    expect(JSON.stringify(row)).not.toMatch(/TypeError|boom|threw:/);
  });
});

describe('[#22741] §3 — controls: what the predicate must NOT change', () => {
  const budget = () => census.faults.find((s) => /exceeded CPU budget/.test(s.message))!.message;

  it('CONTROL — the same text on an error the sandbox did not raise keeps the row\'s own reading', async () => {
    // The predicate reads the producer's class identity, never the message.
    const err = () => new Error(budget());
    expect(isSandboxOwnFault(err())).toBe(false);
    expect(mapDataError(err(), OBJECT).status).toBe(500);
    expect((await rowFor(err)).error).toBe(sanitizeRowError(budget()));
  });

  it.each([
    ['SQLite', `SQLITE_ERROR: no such table: ${OBJECT}`],
    ['Postgres', `relation "${OBJECT}" does not exist`],
  ])('CONTROL [#22868] — a real %s missing-relation text on the requested object keeps the heuristic\'s reading', (_driver, text) => {
    // [#27702] That reading is a store fault, not `OBJECT_NOT_FOUND`: no
    // unregistered name reaches a driver, so the relation is a registered
    // object's missing storage.
    const door = mapDataError(new Error(text), OBJECT);
    expect(door.status).toBe(500);
    expect(door.body.code).toBe('DATABASE_ERROR');
  });

  it('CONTROL [#22868] — the same object-naming texts, thrown by anything but the sandbox, keep the heuristic\'s 404', () => {
    // The door asks the producer's identity, never the words: no second rule.
    const named: Site[] = [
      ...namingTheObject(),
      ...gatesNamingTheObject().map((g) => ({ label: g.label, message: g.message.split(ORIGIN_KIND_HOLE).join('hook') })),
    ];
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const { label, message } of named) {
      const err = new Error(message);
      expect(isSandboxOwnFault(err), label).toBe(false);
      const door = mapDataError(err, OBJECT);
      expect(door.status, label).toBe(404);
      expect(door.body.code, label).toBe('OBJECT_NOT_FOUND');
    }
  });

  it('CONTROL — a code-defined hook\'s native TypeError keeps its text, as the filing says', async () => {
    const text = "Cannot read properties of undefined (reading 'owner')";
    const err = () => new TypeError(text);
    expect(isSandboxOwnFault(err())).toBe(false);
    expect((await rowFor(err)).error).toBe(text);
  });

  it('CONTROL — driver text keeps `sanitizeRowError`\'s reading although its door answers 5xx', async () => {
    const sql = "insert into `mz_locked` (`name`) values ('r1') - SQLITE_BUSY: database is locked";
    expect(isSandboxOwnFault(new Error(sql))).toBe(false);
    expect(mapDataError(new Error(sql), OBJECT).status).toBeGreaterThanOrEqual(500);
    expect((await rowFor(() => new Error(sql))).error).toBe('SQLITE_BUSY: database is locked');
  });

  it('CONTROL — a sandboxed body\'s refusal or crash is the origin rule\'s, not this predicate\'s', () => {
    const refusal = Object.assign(ownFault("hook 'g' threw: Error: Locked."), { innerMessage: 'Locked.' });
    const crash = Object.assign(ownFault("hook 'g' threw: TypeError: boom"), { innerMessage: 'TypeError: boom' });
    expect(isSandboxOwnFault(refusal)).toBe(false);
    expect(isSandboxOwnFault(crash)).toBe(false);
    for (const value of [undefined, null, 'SandboxError', { name: 'SandboxErrorX' }]) {
      expect(isSandboxOwnFault(value), String(value)).toBe(false);
    }
  });
});

describe('[#26965] §4 — a capability denial is a coded refusal for every origin, on the door and on the row', () => {
  it('the helper declares the standard catalog code at its status', () => {
    expect(capabilityHelper.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect(capabilityHelper.status).toBe(403);
  });

  const cases = census.capabilityGates.flatMap((gate) => ORIGIN_KINDS.map((kind) => [`${gate.label}, ${kind} origin`, gate, kind] as const));

  it.each(cases)('%s', async (_label, gate, kind) => {
    const sentence = capabilityHelper.sentence(gate, kind);
    // The remedy names the body's own owner, never another origin's.
    expect(sentence).toContain(`capability '${gate.capability}' not granted to ${kind} '`);
    expect(sentence).toContain(`Grant it by adding '${gate.capability}' to the ${kind}'s body.capabilities.`);

    const err = capabilityRefusal(gate, kind);
    expect(isSandboxOwnFault(err)).toBe(false);
    // The door answers the refusal, never the fault's 500 nor, for the gate
    // that names the requested object, the unknown-object heuristic's 404.
    const door = mapDataError(err, OBJECT);
    expect(door.status).toBe(403);
    expect(door.body).toMatchObject({ error: sentence, code: 'INSUFFICIENT_PRIVILEGES' });

    // The row stays a row error, reading the refusal's own sentence and code.
    const row = await rowFor(() => capabilityRefusal(gate, kind));
    expect(row).toEqual({ row: 1, ok: false, action: 'failed', error: sentence, code: 'INSUFFICIENT_PRIVILEGES' });
  });
});
