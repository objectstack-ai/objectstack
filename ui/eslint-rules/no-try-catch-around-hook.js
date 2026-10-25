/**
 * ObjectUI ESLint rule: no-try-catch-around-hook
 *
 * Bans wrapping a React hook call in `try`/`catch`.
 *
 * A `catch` that swallows a throw from a hook desyncs hook order on the next
 * render: the hooks that already ran before the throw were registered, the
 * ones after it were not, and React matches hooks positionally. The result is
 * the classic "Rendered fewer hooks than expected" crash, or silently reading
 * another hook's state.
 *
 * This exists because the pattern kept getting copy-pasted. objectui#2595 /
 * #2596 fixed it in `@object-ui/i18n`'s `createSafeTranslation`, but nine
 * plugin-local re-implementations kept their own `try { useObjectTranslation() }
 * catch {}` (objectui#2879) — every one of them written to make a hook
 * "provider-safe", which the hook already is.
 *
 * The correct pattern for "no provider mounted" is a VALUE probe after the
 * hook has run (e.g. `t(testKey) === testKey` → use English defaults), not a
 * `catch`. See `packages/i18n/src/useSafeTranslation.ts`.
 *
 * Scope, deliberately narrow to stay false-positive free:
 *  - Only `use*` names, per React's own convention.
 *  - Bare identifiers and `React.useX` only. `vi.useRealTimers()` and
 *    `jest.useFakeTimers()` are test utilities, not hooks.
 *  - The try-depth RESETS inside a nested function. A hook called in a
 *    callback that merely happens to be written inside a try —
 *    `renderHook(() => useCondition(...))` — runs during React's render of
 *    that component, not in the try's synchronous flow, and is fine.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

/** React's own convention: a hook is `use` followed by a non-lowercase char. */
function isHookName(name) {
  return typeof name === 'string' && /^use[A-Z0-9]/.test(name);
}

/**
 * Resolve the called name, but only for shapes that can be a React hook.
 * `vi.useRealTimers()` / `jest.useFakeTimers()` are namespaced test helpers
 * that match the `use*` spelling by coincidence, so member calls are accepted
 * only on `React`.
 */
function hookCalleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'React' &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name;
  }
  return undefined;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling a React hook inside try/catch — a caught throw desyncs hook order on the next render (objectui#2595/#2596/#2879).',
      recommended: true,
    },
    schema: [],
    messages: {
      banned:
        "Do not call the hook '{{name}}' inside try/catch — a caught throw desyncs hook order on the next render (objectui#2879). Call the hook unconditionally and probe its RETURN VALUE for the degraded case; see createSafeTranslation in packages/i18n/src/useSafeTranslation.ts.",
    },
  },
  create(context) {
    // Stack of try-depths, one frame per enclosing function. Entering a
    // function pushes a fresh 0 so a callback written inside a try starts
    // clean; leaving pops back to the outer count.
    const frames = [0];
    const bump = (n) => { frames[frames.length - 1] += n; };

    const enterFn = () => { frames.push(0); };
    const exitFn = () => { frames.pop(); };

    return {
      ':function': enterFn,
      ':function:exit': exitFn,

      'TryStatement > BlockStatement': () => bump(1),
      'TryStatement > BlockStatement:exit': () => bump(-1),
      'CatchClause > BlockStatement': () => bump(1),
      'CatchClause > BlockStatement:exit': () => bump(-1),

      CallExpression(node) {
        if (frames[frames.length - 1] === 0) return;
        const name = hookCalleeName(node.callee);
        if (!isHookName(name)) return;
        context.report({ node, messageId: 'banned', data: { name } });
      },
    };
  },
};
