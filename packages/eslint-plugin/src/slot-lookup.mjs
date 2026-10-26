// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `slot-lookup/no-any-assignment`. The root `eslint.config.mjs` keeps the two
// slot lists (`SLOT_LOOKUPS`, `UNCONTRACTED_SLOTS`) and hands them to this rule
// as options, because its `no-restricted-syntax` selectors read the same lists.
//
// The comments below moved verbatim from `eslint.config.mjs`; "above", "below"
// and "selector N" in them refer to that file.

/**
 * A node as the helpers below read it. `@typescript-eslint/parser` emits
 * TS-only node types and fields (`TSAsExpression`, `typeAnnotation`) that
 * ESLint's ESTree types do not declare, so the walk is untyped by design.
 * @typedef {any} ParserNode
 */

// Exported so `scripts/check-slot-lookup-ratchet.mjs` can identify THIS rule's
// reports among the other `no-restricted-syntax` rules, by exact message —
// the counter and the rule must never be able to disagree about what counts.
export const SLOT_LOOKUP_ANY_MESSAGE =
  'Do not erase a service-lookup result to `any` (`: any`, `as any`, or a ' +
  '`getService<any>(…)` type argument) — the lookup already returns the slot\'s ' +
  'contract (#4168/#4176/#4202), and this switches that checking off ' +
  'for the call site while looking identical to code that has it. Every such ' +
  'annotation found so far was hiding a real gap, including a project-membership ' +
  'gate that silently stopped gating and two datasource-registration branches ' +
  'probing a method no metadata service has (#4251). Pass the slot\'s contract ' +
  'type instead (`getService<IDataEngine>(\'data\')`). If the slot genuinely has ' +
  'no contract, add its name to UNCONTRACTED_SLOTS in eslint.config.mjs with a ' +
  'note, so the exemption is reviewed once and visible in one place — see ' +
  'issues #4127 and #4251.';

// [#4251] The FOURTH erasure shape: the declaration and the lookup split apart.
//
//   let ql: any;
//   try { ql = ctx.getService('objectql'); } catch { /* optional */ }
//
// The contract is erased exactly as in `const ql: any = ctx.getService(…)`, and
// all three selectors below miss it: selector 1 needs the call inside the
// declarator (here the declarator has no init), selector 2 needs `as`, selector
// 3 needs a type argument. 23 sites repo-wide used it, 12 of them in files no
// longer grandfathered — i.e. lint covered them and said nothing. Worse, that
// number GREW with every batch: sweeping a file removes it from the baseline,
// and the baseline's monotonicity check means it can never be re-added, so each
// batch converted more of this shape from "grandfathered" into "silently clean".
// A ratchet that looks cleaner the more you use it is the #4342 failure again.
//
// This is a RULE and not a fourth selector because esquery cannot do it. A
// selector can match `AssignmentExpression:has(CallExpression[…])`, but it
// cannot tell which declaration the assigned identifier resolves to — so it
// would equally flag the correctly-typed form this whole work line is trying to
// produce (`let i18nService: II18nService | undefined; i18nService = …`, 8 such
// sites today, in runtime/app-plugin.ts and service-automation among others).
// Resolving the identifier to its declaration needs SCOPE analysis, which is
// cheap and needs no type information — so this stays out of the typed-lint
// pass that the KNOWN RESIDUAL below still waits on.
/** @type {{ rules: Record<string, import('eslint').Rule.RuleModule> }} */
export const slotLookupPlugin = {
  rules: {
    'no-any-assignment': {
      meta: {
        type: 'problem',
        docs: { description: 'Ban assigning a service-lookup result to an `any`-declared variable.' },
        // Required: a config that drops the lists fails validation instead of
        // running the rule against an empty lookup set.
        schema: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: [{
            type: 'object',
            properties: {
              lookups: { type: 'array', items: { type: 'string' }, minItems: 1 },
              uncontracted: { type: 'array', items: { type: 'string' } },
            },
            required: ['lookups', 'uncontracted'],
            additionalProperties: false,
          }],
        },
        messages: { erased: SLOT_LOOKUP_ANY_MESSAGE },
      },
      create(context) {
        const { lookups, uncontracted: uncontractedSlots } = context.options[0];
        const lookupNames = new Set(lookups);
        // Spliced into a regex exactly as the config's selectors splice it.
        const uncontracted = new RegExp(`^(${uncontractedSlots.join('|')})$`);

        /** The slot-lookup call inside `node`, or null. Mirrors the selectors' `:has`. */
        const findLookupCall = (/** @type {ParserNode} */ node) => {
          /** @type {ParserNode} */
          let found = null;
          const walk = (/** @type {ParserNode} */ n) => {
            if (found || !n || typeof n.type !== 'string') return;
            if (
              n.type === 'CallExpression' &&
              n.callee?.type === 'MemberExpression' &&
              lookupNames.has(n.callee.property?.name)
            ) {
              // Same exemption channel as the selectors: the slot name is read
              // off a literal argument, so an UNCONTRACTED_SLOTS lookup is
              // legitimately `any` and must not be reported.
              const exempt = n.arguments.some(
                (/** @type {ParserNode} */ a) => a?.type === 'Literal' && uncontracted.test(String(a.value)),
              );
              if (!exempt) { found = n; return; }
            }
            for (const key of Object.keys(n)) {
              if (key === 'parent') continue;
              const child = n[key];
              if (Array.isArray(child)) child.forEach(walk);
              else if (child && typeof child.type === 'string') walk(child);
            }
          };
          walk(node);
          return found;
        };

        /** True when `name` resolves, in scope, to a variable declared `: any`. */
        const declaredAny = (/** @type {string} */ name, /** @type {ParserNode} */ node) => {
          /** @type {import('eslint').Scope.Scope | null} */
          let scope = context.sourceCode.getScope(node);
          for (; scope; scope = scope.upper) {
            const variable = scope.variables.find((v) => v.name === name);
            if (!variable) continue;
            return variable.defs.some(
              (/** @type {{ node: ParserNode }} */ d) => d.node?.id?.typeAnnotation?.typeAnnotation?.type === 'TSAnyKeyword',
            );
          }
          return false;
        };

        return {
          AssignmentExpression(node) {
            if (node.left.type !== 'Identifier') return;
            if (!findLookupCall(node.right)) return;
            if (!declaredAny(node.left.name, node)) return;
            context.report({ node, messageId: 'erased' });
          },
        };
      },
    },
  },
};
