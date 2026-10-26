// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `query-options/no-any-erasure`. The root `eslint.config.mjs` registers it and
// owns its scope: `QUERY_OPTIONS_TEST_GLOBS`, the counted baseline it ignores,
// and the rule id the ratchet reads.
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
// [#4918] Engine query-options `any`-erasure guard.
//
// The same failure as the slot-lookup rule above, one layer further in: the
// contract exists, `tsc` is willing to enforce it, and one annotation switches
// that off for the call site while looking identical to code that has it.
//
// `IDataEngine.find/findOne/count/aggregate` declare their options as
// `EngineQueryOptions` / `EngineCountOptions` / `EngineAggregateOptions`
// (`packages/spec/src/contracts/data-engine.ts`), and `IDataDriver` declares the
// same slots as `QueryAST` + `DriverOptions`. For an INTERNAL caller `tsc` is
// the ONLY enforced channel on that path: the protocol's ingress normalizer does
// not run on calls the protocol itself makes to `this.engine.find`, and the
// options schemas are not `.strict()`, so an unknown key is silently DROPPED
// rather than rejected. Erase the type and a wrong key becomes a no-op that
// nothing anywhere reports.
//
// #4674 is the bill: two internal queries spelled their sort
// `{ field, direction: 'desc' }` — another contract's vocabulary — where the
// QueryAST shape is `SortNodeSchema` = `{ field, order }`. Both drivers
// normalize off `.order` with no fallback, so both queries ran ASCENDING, and
// because both carried a `limit` the wrong direction changed WHICH ROWS came
// back: metadata audit history returned the oldest events (never an object's
// recent changes) and global search returned the stalest matches. `#4720`
// restored those two sites, `#4721` closed the external (REST/RPC) callers with
// a strict schema plus an ingress normalizer, and this rule is the third leg —
// it stops the erasure regrowing on the internal side.
const ENGINE_QUERY_READ_METHODS = ['find', 'findOne', 'count', 'aggregate'];

export const QUERY_OPTIONS_ANY_MESSAGE =
  'Do not erase an engine query-options value to `any` — not as `find(obj, { … } ' +
  'as any)`, not as an `orderBy: … as any`, and not as a `const opts: any` that is ' +
  'then passed as the options argument. `EngineQueryOptions` (and `QueryAST` on the ' +
  'driver side) already declare every key these methods read, and for an internal ' +
  'caller `tsc` is the ONLY channel that enforces them: the protocol\'s ingress ' +
  'normalizer does not run on a direct engine call, and the options schemas are not ' +
  '`.strict()`, so an unknown key is silently DROPPED, never rejected. That is #4674 ' +
  '— two queries sorted by `direction` (another contract\'s vocabulary) instead of ' +
  '`order` (SortNodeSchema\'s), both with a `limit`, so both quietly returned the ' +
  'OLDEST rows: audit history that never showed an object\'s recent changes, and a ' +
  'global search that truncated away the freshly-edited records. The declared type ' +
  'would have rejected `direction` at the call site; the erasure is the only reason ' +
  'it compiled. Type the value instead (`const opts: EngineQueryOptions = { … }`, or ' +
  'just drop the assertion — these signatures already infer). If the value is ' +
  'DELIBERATELY off-contract — a test asserting the engine REJECTS an unknown option ' +
  '— write `as unknown as EngineQueryOptions`: that names the contract being ' +
  'bypassed, keeps the rest of the call type-checked, and greps as an intentional ' +
  'act, none of which a bare `as any` does. See issues #4674, #4720, #4721, #4918.';

// This is a dedicated PLUGIN rule and not three more `no-restricted-syntax`
// selectors, for two reasons that both matter:
//
//   1. Flat config does not MERGE rule options. A second block setting
//      `no-restricted-syntax` over `packages/**` would REPLACE the
//      slot-lookup block's selector list for every file both blocks match —
//      silently deleting that rule. The two guards also need independent
//      `ignores` (their unswept sets are different files), which one shared
//      block cannot give them.
//   2. The split form needs SCOPE analysis to resolve an identifier to its
//      declaration, which esquery cannot express — the same reason
//      `slot-lookup/no-any-assignment` exists. Scope analysis needs no type
//      information, so this still runs in the plain (untyped) lint pass.
//
// KNOWN RESIDUAL, stated rather than implied: an erasure that happens through
// a typed indirection — a helper declared `(o, q?: any) => engine.find(o, q)`,
// or a wrapper whose own return type is `Promise<any>` — erases the contract
// just as effectively and this rule cannot see it (an `: any` PARAMETER
// forwarded into a query is a real shape, ~50 sites, almost all of them test
// doubles; judging it needs the call graph, not one file's scopes). Same
// boundary as the slot-lookup rule's own KNOWN RESIDUAL, and the same answer:
// it belongs to a typed-lint pass, not here.
/** @type {{ rules: Record<string, import('eslint').Rule.RuleModule> }} */
export const queryOptionsPlugin = {
  rules: {
    'no-any-erasure': {
      meta: {
        type: 'problem',
        docs: { description: 'Ban erasing an engine query-options value to `any`.' },
        schema: [],
        messages: { erased: QUERY_OPTIONS_ANY_MESSAGE },
      },
      create(context) {
        const methods = new Set(ENGINE_QUERY_READ_METHODS);

        /**
         * True when `node` is, or wraps, an `any` assertion.
         *
         * Walks the whole assertion chain rather than testing the outermost
         * node, so `{ … } as any as EngineQueryOptions` is caught too: that
         * spelling checks the literal against nothing and then re-labels the
         * result with the contract, which erases the keys exactly as `as any`
         * does while reading as if it were typed. `as unknown as X` is NOT
         * matched, on purpose — see the message.
         */
        const erasesToAny = (/** @type {ParserNode} */ node) => {
          for (let cur = node; cur; cur = cur.expression) {
            if (cur.type === 'TSAsExpression' || cur.type === 'TSTypeAssertion') {
              if (cur.typeAnnotation?.type === 'TSAnyKeyword') return true;
              continue;
            }
            if (cur.type === 'TSNonNullExpression') continue;
            return false;
          }
          return false;
        };

        /**
         * True when `name` resolves, in scope, to a local VARIABLE declared
         * `: any` — the split form (`const opts: any = { … }` … `find(o, opts)`)
         * that #4674's global-search site actually used.
         *
         * Scope analysis, not a name heuristic: a rule keyed on the identifier's
         * spelling would flag every `const options: any` in the repo whether or
         * not it ever reaches a query, and miss the ones spelled anything else.
         * Deliberately restricted to variable declarations — an `: any`
         * PARAMETER forwarded into a query is a different (and much larger,
         * mostly test-double) population, out of this cut's scope.
         */
        const declaredAnyVariable = (/** @type {string} */ name, /** @type {ParserNode} */ node) => {
          for (let scope = /** @type {import('eslint').Scope.Scope | null} */ (context.sourceCode.getScope(node)); scope; scope = scope.upper) {
            const variable = scope.variables.find((v) => v.name === name);
            if (!variable) continue;
            return variable.defs.some(
              (/** @type {{ node: ParserNode }} */ d) =>
                d.node?.type === 'VariableDeclarator' &&
                d.node.id?.typeAnnotation?.typeAnnotation?.type === 'TSAnyKeyword',
            );
          }
          return false;
        };

        return {
          CallExpression(node) {
            if (node.callee?.type !== 'MemberExpression') return;
            const property = node.callee.property;
            if (property?.type !== 'Identifier' || !methods.has(property.name)) return;

            node.arguments.forEach((argument, index) => {
              // Argument 0 is the object/table NAME on every one of these
              // signatures; the options bags are 1 (the query) and 2
              // (`BaseEngineOptions` / `DriverOptions`). Starting at 1 is also
              // what keeps `Array.prototype.find(cb)` — same method name,
              // callback at index 0 — out of the rule entirely.
              if (index < 1 || !argument) return;
              if (erasesToAny(argument)) {
                context.report({ node: argument, messageId: 'erased' });
                return;
              }
              if (argument.type === 'Identifier' && declaredAnyVariable(argument.name, node)) {
                context.report({ node: argument, messageId: 'erased' });
              }
            });
          },

          // `orderBy` is scoped in by name because it is the key #4674 was
          // actually wrong about, and it is erased one level below the argument
          // — `...(ast.orderBy ? { orderBy: ast.orderBy as any } : {})` sits
          // inside an otherwise-typed options literal, so the argument-position
          // check above cannot see it. `SortNodeSchema` is the shape everywhere
          // this key appears.
          Property(node) {
            if (node.computed) return;
            const key = node.key;
            const isOrderBy =
              (key?.type === 'Identifier' && key.name === 'orderBy') ||
              (key?.type === 'Literal' && key.value === 'orderBy');
            if (!isOrderBy) return;
            if (erasesToAny(node.value)) {
              context.report({ node: node.value, messageId: 'erased' });
            }
          },
        };
      },
    },
  },
};
