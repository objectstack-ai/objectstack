/**
 * ObjectUI ESLint rule: no-synthetic-event-trigger
 *
 * Bans dispatching a synthetic `KeyboardEvent` / `MouseEvent` / `PointerEvent`
 * to *trigger* behavior (e.g. `el.dispatchEvent(new MouseEvent('click'))` or
 * `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))`).
 *
 * Such "synthetic triggers" depend on a global listener being mounted and the
 * host (browser/OS) not intercepting the event first — neither of which an
 * automated (AI) test can assume. They are the anti-pattern that hid the
 * "command palette button doesn't open under automation" bug. Call the real
 * command/handler directly instead (ADR-0054 invariant C1).
 *
 * NOT flagged: `CustomEvent` / `PopStateEvent` dispatch (legitimate event-bus /
 * history-nudge patterns per the 2026-06 audit).
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const BANNED = new Set(['KeyboardEvent', 'MouseEvent', 'PointerEvent']);

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow dispatching synthetic KeyboardEvent/MouseEvent/PointerEvent to trigger behavior; call the command directly (ADR-0054 C1).',
      recommended: true,
    },
    schema: [],
    messages: {
      banned:
        'Do not dispatch a synthetic {{name}} to trigger behavior (ADR-0054 C1). Call the command/handler directly (e.g. an idempotent open()/toggle from context) instead of re-emitting an event a global listener must catch.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'dispatchEvent'
        ) {
          return;
        }
        const arg = node.arguments[0];
        if (arg && arg.type === 'NewExpression' && arg.callee.type === 'Identifier' && BANNED.has(arg.callee.name)) {
          context.report({ node: arg, messageId: 'banned', data: { name: arg.callee.name } });
        }
      },
    };
  },
};
