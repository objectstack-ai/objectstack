// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE PIN: `os serve` asks the multi-node gate a counted question, and its local
 * copy of the gate's verdict shape still matches the gate's own.
 *
 * The defect this guards is authoring-time and invisible to any behavioural
 * test. `serve.ts` reaches `@objectstack/service-cluster` through a dynamic,
 * non-literal specifier — deliberately, so the CLI carries no static dependency
 * on a package that ships with a distribution — and types the result with a
 * hand-written cast. That cast is the ONLY place the two shapes meet, so when
 * the gate widened to express a licensed node cap (`admitted` / `refused` /
 * `capped`), nothing propagated to the consumer: the cast still said
 * `{ allowed, reason }` and the call was still zero-arg. The gate could express
 * "3 admitted, 2 refused" and the only program that consults it could neither
 * ask the question nor read the answer — with every package building, every
 * test passing and every type-check green.
 *
 * Both halves are pinned because either one alone reproduces the silence:
 *
 *   1. a zero-arg call leaves `requested` undefined, so a cap-aware gate has
 *      nothing to clamp against and the partial-cap verdict is *unreachable*;
 *   2. a narrow local cast means the fields are *unreadable* even when set.
 *
 * The shape assertion derives BOTH sides from the file that owns each, rather
 * than checking either against a list written out here — a hard-coded expected
 * list would just relocate the divergence into this file, where it would be
 * equally silent. So the producer widening again turns this red, which makes
 * the next widening a decision (does `serve` need the new field?) instead of a
 * silent divergence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/cli/src/commands` → four levels up. */
const REPO_ROOT = resolve(HERE, '../../../..');

/** `packages/cli/src/commands/serve.ts` — the consumer. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/**
 * The producer, read from source rather than imported: the CLI has no
 * dependency on this package (that is the whole reason the cast exists), and
 * reading `src` also means the pin does not depend on anything being built.
 *
 * ⚠️ Addressed as a repo-relative literal off an escaping `REPO_ROOT` binding
 * on purpose — that is the shape BOTH halves of the repo's
 * `check:cross-package-test-inputs` gate see. (Its script is named without a
 * repo-relative path here: that gate collects path literals out of a test's
 * source, comments included, and would then require a glob for a file this test
 * never reads.)
 *
 * This note used to say the gate could not follow a `new URL('…',
 * import.meta.url)` seed or a `resolve()` nested straight into the
 * `readFileSync` call. It follows both, and has since #9763 — both are on its
 * published `RECOGNISED_PATH_SPELLINGS` list, printed in its failure text, and
 * each is pinned by a `--self-test` case; measured on ceb33a9f12, both produce
 * the escape flag. What they miss is the FLAT literal collector, which sees a
 * path only when the whole repo-relative string sits inside ONE quoted literal
 * starting at a top-level directory: written ascent-relative, this read's name
 * would reach the radius roster only through the resolver's reconstruction,
 * where the spelling below reaches it through both. So keep the whole path in
 * one literal — but for that reason, not because the alternatives are invisible.
 *
 * The spellings that genuinely produce no flag are the ones the detector cannot
 * resolve at all: a template-literal path, a `findUp` walk from `process.cwd()`,
 * segments arriving out of a variable or an array. Reaching for one of those
 * would leave this read **undeclared**: `@objectstack/cli` would then be absent
 * from `turbo ls --affected` for a cluster-only change and its `test` cache
 * would not hash this file, so the pin below would sit green through exactly
 * the drift it exists to catch. The declaration it needs lives in that script's
 * `CROSS_PACKAGE_TEST_INPUTS` and in `turbo.json`'s `@objectstack/cli#test`
 * inputs; removing either turns this file's own gate red.
 */
const GATE_SOURCE = readFileSync(
  join(REPO_ROOT, 'packages/services/service-cluster/src/multi-node-gate.ts'),
  'utf8',
);

/**
 * The property names of an `export interface`, each suffixed with `?` when
 * optional — optionality is part of the contract, so a field that quietly
 * becomes required must not read as agreement.
 *
 * Brace-matched rather than line-counted, and comment-stripped before the
 * property scan so TSDoc prose cannot be mistaken for a field. (A property
 * whose type is an inline object literal would over-collect its nested keys;
 * neither interface has one, and one appearing is itself worth a look.)
 */
function interfaceFields(source: string, name: string): string[] {
  const declaration = `export interface ${name} {`;
  const start = source.indexOf(declaration);
  expect(start, `${name} not found — did the declaration move or get renamed?`).toBeGreaterThan(-1);

  let depth = 1;
  let i = start + declaration.length;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  const body = source
    .slice(start + declaration.length, i - 1)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  return [...body.matchAll(/^\s*(\w+)(\??):/gm)].map((m) => `${m[1]}${m[2]}`).sort();
}

describe('os serve ↔ multi-node gate', () => {
  it('calls the gate WITH a requested node count', () => {
    // The exact regression: `checkMultiNodeAllowed()`. Passing nothing makes the
    // licensed-overflow verdict unreachable rather than merely unread.
    expect(SERVE_SOURCE).not.toMatch(/checkMultiNodeAllowed\(\s*\)/);
    expect(SERVE_SOURCE).toMatch(/checkMultiNodeAllowed\(\s*[^)\s]/);
  });

  it('passes the operator-declared replica count', () => {
    // A stated decision, not an accident: `OS_CLUSTER_REPLICAS` is a *declared*
    // desired count, identical in every replica, not a live membership count —
    // which is right for an advisory message about the operator's own
    // configuration, and is NOT sufficient for enforcement.
    expect(SERVE_SOURCE).toMatch(/checkMultiNodeAllowed\(\s*Number\(process\.env\.OS_CLUSTER_REPLICAS\)\s*\)/);
  });

  it('types the dynamic import with the mirrored verdict, not an inline literal', () => {
    expect(SERVE_SOURCE).toMatch(
      /checkMultiNodeAllowed:\s*\(requested\?:\s*number\)\s*=>\s*MultiNodeGateVerdict/,
    );
  });

  it("serve's local verdict mirror matches the gate's own resolved verdict", () => {
    const producer = interfaceFields(GATE_SOURCE, 'ResolvedMultiNodeVerdict');
    const consumer = interfaceFields(SERVE_SOURCE, 'MultiNodeGateVerdict');

    // Guard the extractor itself: two empty lists would agree vacuously and pin
    // nothing at all.
    expect(producer).toContain('capped');
    expect(producer).toContain('refused');
    expect(producer.length).toBeGreaterThan(3);

    expect(
      consumer,
      'packages/services/service-cluster/src/multi-node-gate.ts changed its resolved verdict shape. '
      + "serve.ts mirrors it by hand (no static dependency), so update `MultiNodeGateVerdict` in "
      + 'packages/cli/src/commands/serve.ts to match — and decide whether the operator warning '
      + 'should now read the new field.',
    ).toEqual(producer);
  });
});
