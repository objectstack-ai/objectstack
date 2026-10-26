// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `verify-stand-in/no-asserted-driver-argument`. The root `eslint.config.mjs`
// keeps the guarded set (`VERIFY_STAND_IN_CHECKS`, reconciled against
// `packages/verify/src` by `pnpm check:verify-stand-in`) and hands its names to
// this rule as the `checks` option.
//
// The comments below moved verbatim from `eslint.config.mjs`; "above" and
// "below" in them refer to that file.

/**
 * A node as the helpers below read it. `@typescript-eslint/parser` emits
 * TS-only node types and fields (`TSAsExpression`, `typeAnnotation`) that
 * ESLint's ESTree types do not declare, so the walk is untyped by design.
 * @typedef {any} ParserNode
 */

// ---------------------------------------------------------------------------
// [#6399] `@objectstack/verify` structural stand-in erasure guard.
//
// The third member of the family above, and the narrowest. `checkReadCoercion`
// and `checkDateBucketParity` take their driver STRUCTURALLY — `CoercibleDriver`
// / `BucketableDriver` — so an out-of-tree driver (cloud's `driver-turso` in
// remote mode) can run the identical contract without importing a concrete
// driver type. That parameter type is not decoration around the check: for the
// compile-time half of the conformance it IS the check. Assert the argument and
// the stand-in stops standing for anything, at that call site, while the code
// reads exactly like the checked kind.
//
// #6354/PR #6396 is the bill: TEN `as never` casts — every call site of both
// helpers — had switched that half off, long enough that nobody remembered
// writing them. They were provably dead (removing all ten left three packages'
// typecheck at exit=0) and the compile-time check they had been hiding is
// provably live (adding a member no real driver can have turned all ten sites
// red, 8+2 matching the cast count exactly). Nothing rang for either fact.
//
// ⚠️ The cost is highest on the FAKE-driver side. Six of the ten sites pass a
// hand-written literal; four pass a real driver. A real driver comes from
// production code and mostly satisfies the stand-in whether or not anyone
// checks — a hand-written fake is precisely the thing that drifts, and it is
// the arm an assertion silences most cheaply.
//
// Scope is argument 0 — the driver — and nothing else. The options bag is a
// different type with its own `unknown` slots, and an assertion there is
// #6394's subject, not this rule's.
//
// WHY A DEDICATED RULE, not a widened `check:query-options-erasure`: measured,
// that ratchet cannot reach these sites at all. `query-options/no-any-erasure`
// keys on a MEMBER-expression callee named `find|findOne|count|aggregate` and
// only inspects arguments at index >= 1; every site here is a bare-identifier
// callee with the driver at index 0. Teaching it the word `never` would have
// matched zero of the ten while pulling several hundred unrelated `as never`
// sites into its baseline and blurring what "query/options type erasure" means.
//
// WHY NOT a blanket ban on `as never` at call arguments in tests: 550 of the
// repo's 703 `as never` assertions sit at a call-argument position, 536 of them
// in test files across 33 packages, and the large majority are legitimate —
// a negative test constructing input `tsc` is supposed to refuse. That is the
// same trade-off QUERY_OPTIONS_TEST_GLOBS already resolved the same way: a
// blocking rule there fights the tests that prove the contract is enforced.

export const VERIFY_STAND_IN_MESSAGE =
  'Do not type-assert the driver argument of a @objectstack/verify conformance check. ' +
  '`checkReadCoercion(driver)` / `checkDateBucketParity(driver)` declare that parameter as a ' +
  'structural stand-in (`CoercibleDriver` / `BucketableDriver`) so any driver — including an ' +
  'out-of-tree one — can run the identical contract; that declaration is the compile-time half ' +
  'of the conformance, and an assertion on the argument deletes it for this call site while ' +
  'looking identical to a call that has it. Ten such casts (`as never`, every call site of both ' +
  'helpers) lived in this repo long enough that nobody remembered writing them — all ten dead, ' +
  'and the check underneath them alive (#6354 / PR #6396). Six of the ten passed a HAND-WRITTEN ' +
  'fake driver, which is the arm that actually drifts. Pass the driver unasserted. If it does ' +
  'not satisfy the stand-in, that is the finding — fix the driver or widen the stand-in ' +
  'deliberately, in `packages/verify/src`, where the change is reviewed once instead of ' +
  'silenced per call site. See issues #6354, #6394 and #6399.';

/** @type {{ rules: Record<string, import('eslint').Rule.RuleModule> }} */
export const verifyStandInPlugin = {
  rules: {
    'no-asserted-driver-argument': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Ban type-asserting the driver argument of a @objectstack/verify structural conformance check.',
        },
        // Required: a config that drops the guarded set fails validation
        // instead of running the rule against no check at all.
        schema: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: [{
            type: 'object',
            properties: {
              checks: { type: 'array', items: { type: 'string' }, minItems: 1 },
            },
            required: ['checks'],
            additionalProperties: false,
          }],
        },
        messages: { erased: VERIFY_STAND_IN_MESSAGE },
      },
      create(context) {
        const guarded = new Set(context.options[0].checks);

        /**
         * True when `node` is, or wraps, ANY type assertion.
         *
         * Deliberately wider than `erasesToAny` above: on this argument there is
         * no assertion worth allowing. `as unknown as BucketableDriver` is the
         * sanctioned escape for engine query OPTIONS because a test may need
         * off-contract input on purpose; here the parameter type is the contract
         * UNDER TEST, so re-labelling the argument with it asserts exactly the
         * thing the call was supposed to prove. Every one of the ten historical
         * casts would be re-admitted by an `any`-only test.
         */
        const isAsserted = (/** @type {ParserNode} */ node) => {
          for (let cur = node; cur; cur = cur.expression) {
            if (cur.type === 'TSAsExpression' || cur.type === 'TSTypeAssertion') return true;
            if (cur.type === 'TSNonNullExpression') continue;
            return false;
          }
          return false;
        };

        /**
         * True when `name` resolves, in scope, to a variable declared `: any` or
         * `: never` — the split form (`const d: any = brokenDriver(); check(d)`),
         * which erases the stand-in exactly as the inline assertion does and is
         * the first shape someone reaches for once the inline one is blocked.
         * Scope analysis, not a name heuristic — same mechanism, and the same
         * reason, as `slot-lookup/no-any-assignment`.
         */
        const declaredErasedVariable = (/** @type {string} */ name, /** @type {ParserNode} */ node) => {
          for (let scope = /** @type {import('eslint').Scope.Scope | null} */ (context.sourceCode.getScope(node)); scope; scope = scope.upper) {
            const variable = scope.variables.find((v) => v.name === name);
            if (!variable) continue;
            return variable.defs.some((/** @type {{ node: ParserNode }} */ d) => {
              const kind = d.node?.id?.typeAnnotation?.typeAnnotation?.type;
              return (
                d.node?.type === 'VariableDeclarator' &&
                (kind === 'TSAnyKeyword' || kind === 'TSNeverKeyword')
              );
            });
          }
          return false;
        };

        return {
          CallExpression(node) {
            // Bare-identifier callee only. These names are distinctive enough to
            // treat as reserved, and matching the name rather than the resolved
            // import is what keeps a re-export or a test-local alias from
            // quietly leaving the rule behind.
            if (node.callee?.type !== 'Identifier' || !guarded.has(node.callee.name)) return;
            const driver = node.arguments?.[0];
            if (!driver) return;
            if (isAsserted(driver)) {
              context.report({ node: driver, messageId: 'erased' });
              return;
            }
            if (driver.type === 'Identifier' && declaredErasedVariable(driver.name, node)) {
              context.report({ node: driver, messageId: 'erased' });
            }
          },
        };
      },
    },
  },
};
