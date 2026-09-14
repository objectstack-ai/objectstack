// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0130 D4 — #18204] The per-package leg's resolution context, asserted
 * against the FUNCTION the commands call.
 *
 * `compile.ts` (step 3b-ii) and `lint.ts` both build one package's stack with
 * {@link packageBodyAsStack}, handing it the artifact's own `packages[]` so a
 * reference into a SIBLING package's object resolves (#16611). Two neighbours
 * already measure parts of that, and neither covers what this file does:
 *
 *   - `packages/lint/src/validate-object-references.test.ts` runs the rule
 *     against a local three-key REPLICA of this function's output. It stays
 *     green if the CLI stops producing that shape — which is the only way this
 *     defect can ever return.
 *   - `test/build-multi-package-artifact.e2e.test.ts` runs the real command end
 *     to end, and is the stronger reading — but it carries the `*.e2e` name, so
 *     `OS_TEST_TIERS` puts it in the NIGHTLY population (`../../vitest-tiers.ts`)
 *     and the merge queue never runs it. A regression lands green and is found
 *     the next morning.
 *
 * So this file is the queue-tier half: the real `artifactPackages` +
 * `packageBodyAsStack`, the real rule, and no replica anywhere in the chain.
 *
 * ## The two LEVELS, which is the card
 *
 * #18204 reported one reference accepted at the field level and the same name
 * refused at the action-param level in the same build. That is what
 * `@objectstack/cli@17.4.0` does — its `packageBodyAsStack(body)` takes no
 * context argument at all, so the action-param site is judged against one
 * package's objects while the field site is not judged at all by that release's
 * rule. Both halves moved since; this pins them MOVED TOGETHER, because a
 * platform that accepts `Field.lookup('x')` and refuses `reference: 'x'` on an
 * action param is contradicting itself inside one command.
 *
 * ⛔ Not a "skip the site per package" pin. The dangling name is asserted
 * present at BOTH levels in the same call, so a context that silences the
 * ladder fails here exactly as loudly as a context that never arrives.
 */

import { describe, expect, it } from 'vitest';
import { validateObjectReferences } from '@objectstack/lint';

import { artifactPackages, packageBodyAsStack } from './artifact-packages.js';

/**
 * A two-package artifact in the shape `composeStacks(…, { manifest: 'preserve' })`
 * writes and `ObjectStackDefinitionSchema` parses: each entry's assembled body
 * under `manifest`. Modelled on `examples/app-multi-package`, whose `orders`
 * package reads `crm_account` out of its `core` sibling.
 */
const CORE_BODY = {
  id: 'com.example.multi.core',
  objects: [{ name: 'crm_account', fields: { name: { type: 'text' } } }],
};

const ORDERS_BODY = {
  id: 'com.example.multi.orders',
  dependencies: { 'com.example.multi.core': '^1.0.0' },
  objects: [
    {
      name: 'crm_order',
      fields: {
        name: { type: 'text' },
        // Level 1 — `Field.lookup()`'s target, accepted across packages by
        // ADR-0130 §1.5.
        account: { type: 'lookup', reference: 'crm_account' },
        ghost: { type: 'lookup', reference: 'crm_nowhere' },
      },
      actions: [
        {
          name: 'link_account',
          type: 'script',
          locations: [],
          params: [
            // Level 2 — the record picker's search target, the card's level.
            { name: 'account', type: 'lookup', reference: 'crm_account' },
            { name: 'phantom', type: 'lookup', reference: 'crm_nowhere_param' },
          ],
          body: { language: 'js', source: 'return { ok: true };', capabilities: [] },
        },
      ],
    },
  ],
};

const ARTIFACT = {
  manifest: { id: 'com.example.multi.core' },
  objects: CORE_BODY.objects,
  packages: [{ manifest: ORDERS_BODY }, { manifest: CORE_BODY }],
} as Record<string, unknown>;

/**
 * Exactly what `compile.ts` step 3b-ii does for one entry.
 *
 * ⛔ `context` takes no DEFAULT: a default would be applied to the CONTROL
 * leg's explicit `undefined` — the exact value the pre-#16611 call site passes
 * — and that leg would silently measure the fixed shape and pass.
 */
const perPackageStack = (index: number, context: unknown) =>
  packageBodyAsStack(artifactPackages(ARTIFACT)[index].body, context);

describe('packageBodyAsStack — the per-package leg resolves a sibling package at BOTH reference levels (#18204)', () => {
  it('CONTROL — with no context the SAME body errors at both levels, so the context is what does the work', () => {
    // Without this leg a green assertion below is indistinguishable from a rule
    // that stopped judging these sites at all.
    const paths = validateObjectReferences(perPackageStack(0, undefined)).map((f) => f.path);
    expect(paths).toEqual([
      'objects[0].fields.account.reference',
      'objects[0].fields.ghost.reference',
      'objects[0].actions[0].params[0].reference',
      'objects[0].actions[0].params[1].reference',
    ]);
  });

  it('resolves the sibling\'s object at both levels, and still refuses a name no package provides', () => {
    const findings = validateObjectReferences(perPackageStack(0, ARTIFACT.packages));
    // One equality carries all four verdicts: `crm_account` is absent at BOTH
    // levels (resolved through `packages[]`) and the two dangling names are
    // present at BOTH levels (the refusal MOVED — it did not disappear).
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].fields.ghost.reference',
      'objects[0].actions[0].params[1].reference',
    ]);
    expect(findings.map((f) => f.rule)).toEqual([
      'object-reference-unknown',
      'object-reference-unknown',
    ]);
    expect(findings.map((f) => f.severity)).toEqual(['error', 'error']);
  });

  it('judges the sibling from its own side unchanged', () => {
    // The context widens what a package can RESOLVE, never what it JUDGES: the
    // app package owns no reference, so it has nothing to report either way.
    expect(validateObjectReferences(perPackageStack(1, ARTIFACT.packages))).toEqual([]);
  });

  it('hands the rule the artifact\'s own entries — the body of each package is under `manifest`', () => {
    // The shape is the contract between this function and the rule: the rule
    // reads `packages[].manifest.<collection>`, so a context reduced to some
    // other entry shape resolves nothing while every type still checks.
    const stack = perPackageStack(0, ARTIFACT.packages) as { packages?: unknown; manifest?: unknown };
    expect(stack.packages).toBe(ARTIFACT.packages);
    expect(stack.manifest).toBe(artifactPackages(ARTIFACT)[0].body);
  });
});
