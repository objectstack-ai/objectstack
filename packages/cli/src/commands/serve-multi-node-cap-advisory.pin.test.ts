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
// The repo's one comment/code separator (#9367). The four shape assertions
// below used to match against RAW `SERVE_SOURCE` (#10514): a trailing comment
// describing the old call shape (e.g. quoting a reverted
// `checkMultiNodeAllowed(replicas)`) was indistinguishable from the real call.
// `interfaceFields()` further down does its own narrower, brace-matched strip
// over an `export interface` body and is deliberately left alone — out of
// scope for #10514, noted there so a future re-derivation doesn't read it as
// the same defect.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/cli/src/commands` → four levels up. */
const REPO_ROOT = resolve(HERE, '../../../..');

/** `packages/cli/src/commands/serve.ts` — the consumer. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/**
 * `SERVE_SOURCE` with every comment span blanked (offsets preserved) — what
 * the four shape assertions below actually match against (#10514), so a
 * comment naming `checkMultiNodeAllowed(…)` cannot satisfy — or hide behind —
 * any of them. `interfaceFields()` still reads raw `SERVE_SOURCE`; see the
 * import comment above for why that is out of scope here.
 */
const MASKED_SERVE_SOURCE = maskComments(SERVE_SOURCE);

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
 * resolve at all: a template-literal path, a BARE `process.cwd()` walk, segments
 * arriving out of a variable or an array. Reaching for one of those would leave
 * this read **undeclared**: `@objectstack/cli` would then be absent
 * from `turbo ls --affected` for a cluster-only change and its `test` cache
 * would not hash this file, so the pin below would sit green through exactly
 * the drift it exists to catch. The declaration it needs lives in that script's
 * `CROSS_PACKAGE_TEST_INPUTS` and in `turbo.json`'s `@objectstack/cli#test`
 * inputs; removing either turns this file's own gate red.
 *
 * ⚠️ BARE is load-bearing. This sentence used to name `a findUp walk from
 * process.cwd()` without it, and that clause went stale under the file while the
 * file stayed still. Since #10852 that detector resolves two ANCHOR predicates on
 * such a walk: one keyed on the scanned package's own manifest `name`, which
 * resolves to that package's root, and one keyed on a workspace-root marker file
 * (`pnpm-workspace.yaml` today), which resolves to the repo root. Both are on the
 * published `RECOGNISED_PATH_SPELLINGS` list printed in its failure text, and
 * each is pinned by a `--self-test` case — so re-derive from those two sources
 * rather than from this paragraph, which is prose and can rot again. What still
 * resolves to nothing is the unadorned `process.cwd()` expression with no
 * recognised predicate on it, and a `findUp` keyed on any other marker
 * (`turbo.json`, `.git`); both are pinned unresolved by their own cases.
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
    expect(MASKED_SERVE_SOURCE).not.toMatch(/checkMultiNodeAllowed\(\s*\)/);
    expect(MASKED_SERVE_SOURCE).toMatch(/checkMultiNodeAllowed\(\s*[^)\s]/);
  });

  it('passes the operator-declared replica count', () => {
    // A stated decision, not an accident: `OS_CLUSTER_REPLICAS` is a *declared*
    // desired count, identical in every replica, not a live membership count —
    // which is right for an advisory message about the operator's own
    // configuration, and is NOT sufficient for enforcement.
    expect(MASKED_SERVE_SOURCE).toMatch(/checkMultiNodeAllowed\(\s*Number\(process\.env\.OS_CLUSTER_REPLICAS\)\s*\)/);
  });

  it('types the dynamic import with the mirrored verdict, not an inline literal', () => {
    expect(MASKED_SERVE_SOURCE).toMatch(
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

/**
 * Vacuity proof (#10514): a synthetic regression shaped exactly like the
 * issue's own repro — the zero-arg call reintroduced, with a trailing comment
 * quoting the OLD argued call, the way a careless revert reads. Both legs are
 * shown so the RAW leg's wrong verdict — what this pin's assertions would
 * have produced before #10514 — is visible next to the MASKED leg's correct
 * one, not just asserted.
 */
describe('the shape assertions ignore a comment that quotes the old call (#10514)', () => {
  it('a reverted zero-arg call cannot hide behind a comment describing the argued call it replaced', () => {
    const regressed = [
      'const __gate = checkMultiNodeAllowed();',
      '// checkMultiNodeAllowed(Number(process.env.OS_CLUSTER_REPLICAS)) used to be called here',
    ].join('\n');

    // Pre-#10514 (raw): the negative assertion correctly catches the bad
    // shape…
    expect(regressed).toMatch(/checkMultiNodeAllowed\(\s*\)/);
    // …but the positive assertion is ALSO satisfied — by the comment alone —
    // which is exactly how this pin's "calls the gate WITH a requested node
    // count" test would have stayed green over the regression it exists to
    // catch.
    expect(regressed).toMatch(/checkMultiNodeAllowed\(\s*[^)\s]/);

    // Post-#10514 (masked): the comment is blanked, so the positive assertion
    // correctly fails to find an argued call — the regression is no longer
    // hidden.
    expect(maskComments(regressed)).not.toMatch(/checkMultiNodeAllowed\(\s*[^)\s]/);
  });
});

/**
 * THE SECOND PIN: serve's declared-count normalization still matches the gate's
 * own, byte for byte modulo comments and whitespace.
 *
 * The telemetry reading (#12667) has to report the count the operator DECLARED,
 * and the resolved verdict cannot give it back: `admitted` is `min(cap,
 * wanted)`, so `{admitted: 3, refused: 0}` is produced BOTH by "declared 3 under
 * a cap of 5" and by "declared nothing under a cap of 3". The declaration is
 * only knowable from `OS_CLUSTER_REPLICAS`, so `serve.ts` normalizes that value
 * itself — and a normalization that disagrees with the gate's would publish a
 * declaration the gate never saw (a `0` or a `2.7` the gate had already thrown
 * away as "not declared").
 *
 * Both sides are read from the file that OWNS each, for the same reason the
 * shape pin above is: an expected rule re-typed here would just relocate the
 * divergence into this file, where it would be equally silent.
 */

/**
 * The brace-matched body of a top-level `function <name>(…) … { … }`, with
 * comments blanked and whitespace collapsed, so two implementations can be
 * compared on what they DO.
 *
 * The first `{` after the declaration is taken as the body opener — true for
 * both functions compared below (neither has an object type or a destructured
 * parameter in its signature); a signature that grows one would need the scan
 * to skip the parameter list first, and would fail loudly here rather than
 * quietly compare the wrong span.
 */
function functionBody(source: string, name: string): string {
  const masked = maskComments(source);
  const at = masked.indexOf(`function ${name}(`);
  expect(at, `function ${name} not found — did it move or get renamed?`).toBeGreaterThan(-1);

  const open = masked.indexOf('{', at);
  expect(open, `function ${name} has no body brace`).toBeGreaterThan(-1);

  let depth = 1;
  let i = open + 1;
  for (; i < masked.length && depth > 0; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') depth--;
  }
  expect(depth, `function ${name} body is unbalanced`).toBe(0);

  return masked.slice(open + 1, i - 1).replace(/\s+/g, ' ').trim();
}

describe('os serve ↔ multi-node gate: the declared-count rule', () => {
  it("serve's `normalizeDeclaredNodeCount` still mirrors the gate's `normalizeCount`", () => {
    const producer = functionBody(GATE_SOURCE, 'normalizeCount');
    const consumer = functionBody(SERVE_SOURCE, 'normalizeDeclaredNodeCount');

    // Guard the extractor: two empty bodies would agree vacuously.
    expect(producer).toContain('Number.isFinite');
    expect(producer).toContain('Math.floor');
    expect(producer.length).toBeGreaterThan(40);

    expect(
      consumer,
      'packages/services/service-cluster/src/multi-node-gate.ts changed how it decides '
      + 'whether a requested node count counts as DECLARED. serve.ts mirrors that rule by '
      + 'hand (no static dependency) so its operator telemetry reports the same declaration '
      + 'the gate saw — update `normalizeDeclaredNodeCount` in '
      + 'packages/cli/src/commands/serve.ts to match.',
    ).toEqual(producer);
  });

  it('the telemetry reading is fed from the DECLARED env var, not from a count of anything', () => {
    // The whole card turns on this: `OS_CLUSTER_REPLICAS` is what the operator
    // wrote, identical in every replica. There is no membership count to read
    // instead, and a future edit that reached for one would be publishing a
    // number this process cannot know.
    expect(MASKED_SERVE_SOURCE).toMatch(
      /describeMultiNodeCapTelemetry\(\s*verdict\s*,\s*Number\(process\.env\.OS_CLUSTER_REPLICAS\)\s*\)/,
    );
  });
});
