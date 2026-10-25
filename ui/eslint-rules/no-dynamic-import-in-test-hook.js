/**
 * ObjectUI ESLint rule: no-dynamic-import-in-test-hook
 *
 * Bans `await import(…)` in a `beforeAll`/`beforeEach` body. Import the module
 * at module scope instead.
 *
 * A dynamic import inside a hook bills the module's cold Vite transform to
 * `hookTimeout`. That transform is unbounded work — under full-suite
 * parallelism the transform pipeline is saturated (the `dom-heavy` project
 * alone spends ~60s in transform) — so the hook's budget is really a bet on
 * machine load, and the test's reliability stops depending on the code it
 * covers. Imported at module scope the same cost lands in the file's import
 * phase, which no test or hook timeout applies to.
 *
 * This exists because raising the timeout is the intuitive "fix" and it does
 * not work. objectui#3010 found five load-sensitive flaky tests of this shape;
 * a sweep then found 36 more files, EVERY one already carrying a raised
 * timeout, on an escalating ladder — 15s → 30s → 60s. One of them even left
 * the escalation as advice (`// Increase timeout to 30 seconds for heavy
 * renderer imports`), and `plugin-kanban` blew its raised 15s budget anyway at
 * 15021ms. #3021 converted the four riskiest. The prose rule in AGENTS.md §9
 * did not hold on its own, which is why this is mechanical.
 *
 * Scope, deliberately narrow to stay false-positive free:
 *  - Only `beforeAll` / `beforeEach` as BARE identifiers. A `foo.beforeAll()`
 *    member call is somebody else's API.
 *  - The hook frame RESETS inside a nested function, so a lazy FACTORY —
 *    `registerLazy('x', () => import('./x'))` — is fine: the hook registers
 *    the loader, it does not run the import.
 *  - A hook that also establishes per-run module state (`vi.resetModules`,
 *    `vi.doMock`, `vi.doUnmock`, `vi.stubEnv`, `vi.stubGlobal`) is EXEMPT. The
 *    re-import is the point there — it has to observe state that only exists
 *    at hook time, so hoisting it would break the test rather than speed it up.
 *
 * No autofixer on purpose. The mechanical cases are a one-line move, but the
 * general case captures the module into a variable the tests read, and hoisting
 * that means introducing top-level await and reordering side effects — not a
 * rewrite a fixer should make unattended.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

/** Vitest lifecycle hooks whose body is billed to `hookTimeout`. */
const HOOKS = new Set(['beforeAll', 'beforeEach']);

/**
 * `vi.*` calls that establish per-run module state. A dynamic import in the
 * same hook is deliberately re-reading that state, so it cannot be hoisted.
 */
const MODULE_STATE_HELPERS = new Set([
  'resetModules',
  'doMock',
  'doUnmock',
  'stubEnv',
  'stubGlobal',
]);

/** True for `beforeAll(fn)` / `beforeEach(fn, timeout)` — bare identifier only. */
function isHookCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    HOOKS.has(node.callee.name)
  );
}

/** True for `vi.resetModules()` / `vitest.doMock(…)` and friends. */
function isModuleStateHelper(node) {
  const callee = node.callee;
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    (callee.object.name === 'vi' || callee.object.name === 'vitest') &&
    callee.property.type === 'Identifier' &&
    MODULE_STATE_HELPERS.has(callee.property.name)
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `await import(…)` inside a beforeAll/beforeEach body — it bills an unbounded module transform to hookTimeout, making the test load-sensitive (objectui#3010/#3021).',
      recommended: true,
    },
    schema: [],
    messages: {
      banned:
        "Do not load a module inside '{{hook}}' — the cold transform is billed to hookTimeout, so the test passes or fails on machine load. Import it at module scope instead (`import '{{source}}';`), which moves the cost to the import phase where no test or hook timeout applies. Raising the timeout is not the fix: every one of the 36 files found this way already had a raised timeout, escalating 15s -> 30s -> 60s (objectui#3010/#3021, AGENTS.md section 9). If the import must re-read per-run state, keep it and call vi.resetModules() in the same hook.",
    },
  },
  create(context) {
    // One frame per enclosing function. `hook` is the hook name when this
    // function is *directly* the hook's callback, else undefined — so the frame
    // resets inside a nested function and a lazy factory never reports.
    const frames = [{ hook: undefined, candidates: [], exempt: false }];
    const top = () => frames[frames.length - 1];

    return {
      ':function'(node) {
        const parent = node.parent;
        const hook = isHookCall(parent) && parent.arguments.includes(node)
          ? parent.callee.name
          : undefined;
        frames.push({ hook, candidates: [], exempt: false });
      },

      ':function:exit'() {
        const frame = frames.pop();
        if (!frame.hook || frame.exempt) return;
        for (const { node, source } of frame.candidates) {
          context.report({
            node,
            messageId: 'banned',
            data: { hook: frame.hook, source },
          });
        }
      },

      // `import('…')` — parsers spell this `ImportExpression`.
      ImportExpression(node) {
        const frame = top();
        if (!frame.hook) return;
        frame.candidates.push({
          node,
          source: node.source?.type === 'Literal' ? String(node.source.value) : 'the-module',
        });
      },

      CallExpression(node) {
        // Mark the whole hook exempt, wherever in its body the helper sits.
        if (!isModuleStateHelper(node)) return;
        for (let i = frames.length - 1; i >= 0; i -= 1) {
          if (frames[i].hook) {
            frames[i].exempt = true;
            return;
          }
        }
      },
    };
  },
};
