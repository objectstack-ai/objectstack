// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: **`os start` hands its `--port` to the child on the channel the child
 * reads FIRST, and states no address of its own** (#12992).
 *
 * ## The defect, measured on a real boot
 *
 * ```
 *   OS_PORT=41077 os start --port 41078
 *     banner:            Console: http://localhost:41078/_console/
 *     curl finds it on:  41077
 * ```
 *
 * Two independent halves, and this file pins both:
 *
 *  1. **The channel.** `start` wrote the flag as `PORT` and never cleared the
 *     inherited `OS_PORT`. The child resolves
 *     `readEnvWithDeprecation('OS_PORT', 'PORT')` — `OS_PORT` first — so an
 *     explicit flag lost to an environment variable its own help text says it
 *     overrides.
 *  2. **The address.** The banner was a SECOND resolution of the same question,
 *     computed in the parent with the opposite precedence. Nothing reconciled
 *     the two, so `start` printed a URL it was not serving.
 *
 * ## ⚠️ The instrument: `OS_PORT` CONTAINS `PORT`
 *
 * Every assertion below is over object KEYS and exact values, never substring
 * containment of a rendered message — `serve-port-validation.test.ts` documents
 * why a `toContain`/`not.toContain` pair on this pair of names reports the
 * `OS_PORT` reading as also naming `PORT`. Where this file does assert that a
 * value is ABSENT, the same probe is first shown finding it present (the
 * positive control in `forwards nothing at all when no flag was given`), so an
 * absence here is a measurement rather than a probe that never worked.
 *
 * ## Why the behavioural half reads through the CHILD's reader
 *
 * The point of the card is that the parent and the child answered one question
 * two ways. A test that re-implemented the child's precedence would be a THIRD
 * answer, free to agree with the parent while the real child disagreed. So the
 * composed environment is handed to `readEnvWithDeprecation('OS_PORT', 'PORT',
 * { silent: true })` — the exact expression `commands/serve.ts` uses for its
 * port flag's default — and that reader's answer is what is asserted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readEnvWithDeprecation } from '@objectstack/types';
import { parseRequestedPort } from '../utils/port-contract.js';
import { childPortEnv } from './start.js';

/** The operator's own value, inherited by `start` and passed down. */
const OPERATOR_OS_PORT = '41077';
/** What the operator typed at `--port`. It must win. */
const FLAG_PORT = 41078;

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

/**
 * The child environment `start` composes, reduced to the part this card is
 * about: an inherited environment, plus whatever the port channel contributes.
 */
function composeChildEnv(flagPort: number | undefined, inherited: Record<string, string> = {}) {
  return { ...inherited, ...childPortEnv(flagPort) };
}

/**
 * What the CHILD would resolve from that environment — through the child's own
 * reader, not a re-derivation of its precedence.
 */
function portTheChildWouldRead(childEnv: Record<string, string | undefined>): string | undefined {
  for (const key of ['OS_PORT', 'PORT']) delete process.env[key];
  Object.assign(process.env, childEnv);
  return readEnvWithDeprecation('OS_PORT', 'PORT', { silent: true });
}

describe('`os start` forwards --port on the channel its child reads first', () => {
  it('an explicit --port beats an inherited $OS_PORT — the whole defect', () => {
    const childEnv = composeChildEnv(FLAG_PORT, { OS_PORT: OPERATOR_OS_PORT });

    // Before the repair this read back '41077': the flag travelled as `PORT`,
    // which the child ranks LAST, and the inherited OS_PORT won.
    expect(portTheChildWouldRead(childEnv)).toBe(String(FLAG_PORT));
    expect(parseRequestedPort(portTheChildWouldRead(childEnv)!)).toBe(FLAG_PORT);
  });

  it('states the one value on the canonical name AND its legacy alias', () => {
    const env = childPortEnv(FLAG_PORT);

    // Exact values, never containment — see the instrument note in the header.
    expect(env.OS_PORT).toBe(String(FLAG_PORT));
    expect(env.PORT).toBe(String(FLAG_PORT));
    // ⭐ The two must AGREE. A child whose environment named two different
    // ports would be this card's defect moved one layer down, where app code
    // reading `process.env.PORT` directly (see
    // `examples/app-showcase/src/system/self-url.ts`) would compute an address
    // for a port nothing is listening on.
    expect(env.OS_PORT).toBe(env.PORT);
  });

  it('overwrites BOTH inherited spellings, leaving no stale port behind', () => {
    const childEnv = composeChildEnv(FLAG_PORT, { OS_PORT: OPERATOR_OS_PORT, PORT: '39999' });

    expect(childEnv.OS_PORT).toBe(String(FLAG_PORT));
    expect(childEnv.PORT).toBe(String(FLAG_PORT));
    expect(Object.values(childEnv)).not.toContain(OPERATOR_OS_PORT);
  });

  it('forwards --port 0, which the falsy guard used to drop', () => {
    // `port-contract.ts` measures `listen(0) → OK` and declares MIN_PORT = 0:
    // zero is a REQUEST for a kernel-assigned port, not an error. The old
    // `flags.port ? …` guard was falsy for it, so `os start --port 0` forwarded
    // nothing — measured on the unrepaired command, it printed
    // `http://localhost:0/_console/` and bound the inherited 41077 instead.
    const childEnv = composeChildEnv(0, { OS_PORT: OPERATOR_OS_PORT });

    expect(childEnv.OS_PORT).toBe('0');
    expect(portTheChildWouldRead(childEnv)).toBe('0');
    expect(parseRequestedPort('0')).toBe(0);
  });

  it('forwards nothing at all when no flag was given — with its positive control', () => {
    const hasPortKey = (env: Record<string, unknown>) =>
      Object.prototype.hasOwnProperty.call(env, 'OS_PORT')
      || Object.prototype.hasOwnProperty.call(env, 'PORT');

    // ⭐ POSITIVE CONTROL first: the same probe, on the same helper, DOES see
    // the keys when a flag is given. Without this line the assertion below
    // would pass just as happily against a probe that can never see anything.
    expect(hasPortKey(childPortEnv(FLAG_PORT))).toBe(true);
    expect(hasPortKey(childPortEnv(undefined))).toBe(false);

    // …so an operator's own environment reaches the child untouched, under its
    // own names, which is what `start`'s refusal door one process earlier
    // depends on being true.
    const childEnv = composeChildEnv(undefined, { OS_PORT: OPERATOR_OS_PORT, PORT: '39999' });
    expect(childEnv.OS_PORT).toBe(OPERATOR_OS_PORT);
    expect(childEnv.PORT).toBe('39999');
    expect(portTheChildWouldRead(childEnv)).toBe(OPERATOR_OS_PORT);
  });
});

describe('structural: `start` states no address of its own', () => {
  /**
   * Find every `localhost:<something>` address BUILT in a file, off the AST.
   *
   * Deliberately not a text scan, for the reason the sibling pin
   * (`artifact-child-env.pin.test.ts`) records: a regex comment-stripper once
   * reported `start.ts` clean while the file carried the very write under test,
   * because a `/*` inside a flag description opened a phantom block comment. The
   * parser decides what is code and what is prose.
   *
   * Template literals ONLY. A plain string cannot interpolate a port, and the
   * prose in this file's own header talks about `http://localhost:41078/` — the
   * detector must not be confused by either.
   */
  const localhostAddressesBuilt = (file: string): string[] => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const hits: string[] = [];

    const at = (node: ts.Node) =>
      `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;

    const visit = (node: ts.Node): void => {
      if (ts.isTemplateExpression(node)) {
        const text = node.head.text + node.templateSpans.map((s) => s.literal.text).join('');
        if (/localhost:/.test(node.head.text) || /localhost:?$/.test(node.head.text.trimEnd())) {
          hits.push(`${at(node)} \`${text}\``);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return hits;
  };

  it('start.ts interpolates no localhost address', () => {
    expect(
      localhostAddressesBuilt('start.ts'),
      'start.ts must not compose an address from a port it resolved itself. Both facts such a '
      + 'row asserts — the bound port and whether a Console is mounted — belong to the `serve` '
      + 'child, which states them together after its listen(). See the ⛔ block above '
      + "`printStep('Starting server...')`.",
    ).toEqual([]);
  });

  it('the detector can see one — positive control', () => {
    // The exact line this card deleted, fed to the same scanner. If this ever
    // returns [], the assertion above is vacuous and proves nothing.
    const specimen = "const p = 1; const s = `http://localhost:${p}/_console/`;";
    const sourceFile = ts.createSourceFile('specimen.ts', specimen, ts.ScriptTarget.Latest, true);
    const hits: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isTemplateExpression(node) && /localhost:/.test(node.head.text)) hits.push('hit');
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(hits).toHaveLength(1);
  });
});
