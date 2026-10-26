/**
 * ObjectUI ESLint rule: no-bare-node-slot-guard
 *
 * Forbids a bare `&&` whose left operand is a SchemaNode SLOT and whose value
 * becomes a React child.
 *
 * ## The defect
 *
 * `{schema.footer && <CardFooter>{renderChildren(schema.footer)}</CardFooter>}`
 * does not evaluate to `false` when the slot is falsy — it evaluates to the
 * slot's own value. React ignores `false`, `null`, `undefined` and `''`, but it
 * RENDERS numbers. A node slot's published zod face carries a `z.number()` arm
 * (`nodeUnionOptions` in `packages/types/src/zod/base.zod.ts`), so `footer: 0`
 * is legal authored input, and it paints a stray `0` into the DOM.
 *
 * The bridge does not save it. `toRenderableSchema` has mapped falsy primitives
 * onto nothing since objectui#8908, and `renderChildren`'s own first leg is
 * `if (!children) return null` — but `&&` SHORT-CIRCUITS, so neither of them is
 * reached. The raw `0` has already been produced before any renderer runs.
 *
 * ## Why a rule and not eleven ternaries
 *
 * The class was patched one instance at a time three times — objectui#8331
 * (`DataTableSchema.emptyAction`), objectui#9033 (`header-bar`'s
 * `rightContent`), and then objectui#9162 found ELEVEN more sites that the
 * second round's grep could not see, because that grep was keyed on the
 * spelling of the RIGHT operand (`toRenderableSchema`) while the trap depends
 * only on the LEFT one. Correcting eleven instances leaves the error-permitting
 * construct in the tree and the twelfth slot gets written wrong. This rule
 * deletes the construct instead: `renderChildren(value)` and
 * `renderNodeSlot(value, wrap)` already answer every falsy input with `null`,
 * so there is no shape left that needs an `&&`, and the `&&` is refused.
 *
 * ## What it keys on — the LEFT operand, derived, not listed
 *
 * A hard-coded list of slot names ("children", "footer", …) would be exactly
 * the objectui#9033 mistake one level up: it would answer for today's names and
 * go quiet on the twelfth. Instead the rule derives the slot set PER FILE from
 * the file's own text: an expression is a node slot here if this file hands it
 * to a node renderer — `renderChildren(x)`, `renderNodeSlot(x, …)`,
 * `toRenderableSchema(x)`, or `<SchemaRenderer schema={x} />`. A twelfth slot is
 * rendered through one of those (that is what rendering a node IS), so the rule
 * sees it the moment it is written, with no list to update.
 *
 * `||`, `&&` and `??` chains are flattened on both sides, because
 * `(schema.title || schema.description || schema.header) && <CardHeader>…`
 * leaks through the `||` for exactly the same reason — `undefined || 0` is `0`.
 *
 * ## What it deliberately does NOT flag
 *
 * - `{schema.showClose && <DrawerClose/>}` — `showClose` is a declared boolean
 *   and is never handed to a node renderer, so it is not in the derived set.
 * - `{schema.title && <CardTitle>{schema.title}</CardTitle>}` — `title` is a
 *   declared `string`; React renders `''` as no characters. Same reason.
 * - `{items.length > 0 && …}` — the left operand is a comparison, already a
 *   boolean.
 * - An `&&` outside JSX child position (`const x = a && b`). The rule is about
 *   what reaches React as a child; a value assigned first is reported at the
 *   place it is actually rendered, if it is rendered bare at all.
 *
 * ## No autofixer, on purpose
 *
 * The two correct rewrites are not interchangeable. A slot rendered bare wants
 * `{renderChildren(x)}`; a slot wrapped in chrome that must disappear with it
 * wants `renderNodeSlot(x, (c) => <Chrome>{c}</Chrome>)`. Guessing wrong emits
 * empty chrome — a visible, silent layout change — so the author picks.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

/** Calls whose argument is, by construction, a renderable node slot. */
const NODE_RENDERER_CALLS = new Set([
  'renderChildren',
  'renderNodeSlot',
  'toRenderableSchema',
]);

/** Components whose `schema` prop is, by construction, a renderable node slot. */
const NODE_RENDERER_COMPONENTS = new Set(['SchemaRenderer']);

/**
 * Flatten a `&&` / `||` / `??` chain into its leaf operands. Every leaf of such
 * a chain can be the chain's own value, so every leaf is a candidate leak.
 */
function flattenLogical(node, out) {
  if (
    node.type === 'LogicalExpression' &&
    (node.operator === '&&' || node.operator === '||' || node.operator === '??')
  ) {
    flattenLogical(node.left, out);
    flattenLogical(node.right, out);
    return out;
  }
  out.push(node);
  return out;
}

/** Strip the parentheses/`as`/`!` noise that would otherwise defeat text matching. */
function unwrap(node) {
  let n = node;
  for (;;) {
    if (n.type === 'TSAsExpression' || n.type === 'TSNonNullExpression') {
      n = n.expression;
      continue;
    }
    if (n.type === 'ChainExpression') {
      n = n.expression;
      continue;
    }
    return n;
  }
}

/**
 * True when this expression's value can reach React as a child — i.e. it is (or
 * is the tail of) an expression inside a `{…}` container in element position,
 * not in an attribute.
 */
function isInJsxChildPosition(node) {
  let child = node;
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'JSXExpressionContainer') {
      // An attribute value (`prop={x && y}`) is handed to the component, not to
      // React's child reconciler, so the numeric-falsy leak does not apply.
      return (
        parent.parent &&
        (parent.parent.type === 'JSXElement' || parent.parent.type === 'JSXFragment')
      );
    }
    // Only keep climbing through positions whose value IS the enclosing value.
    if (
      (parent.type === 'LogicalExpression' && parent.right === child) ||
      (parent.type === 'ConditionalExpression' &&
        (parent.consequent === child || parent.alternate === child)) ||
      parent.type === 'TSAsExpression' ||
      parent.type === 'TSNonNullExpression' ||
      parent.type === 'ChainExpression'
    ) {
      child = parent;
      parent = parent.parent;
      continue;
    }
    return false;
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid a bare `&&` guard whose left operand is a SchemaNode slot — the guard renders the slot value itself, and a legal authored `0` leaks into the DOM (objectui#8331 / #9033 / #9162).',
      recommended: true,
    },
    schema: [],
    messages: {
      bareNodeSlotGuard:
        'This `&&` guards a SchemaNode slot with the slot itself, so an authored `{{slot}}: 0` — which the published validator accepts — renders a stray "0" into the DOM (objectui#9162). `&&` short-circuits before `renderChildren`, so its `if (!children) return null` leg never runs. Render the slot through the guard instead: `{renderChildren({{slot}})}` when it is bare, or `renderNodeSlot({{slot}}, (c) => <Chrome>{c}</Chrome>)` when chrome must disappear with it.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    /** Source text of every expression this file hands to a node renderer. */
    const slotTexts = new Set();
    /** `&&` nodes in child position, collected in pass 1, judged in pass 2. */
    const candidates = [];

    function recordSlot(expr) {
      if (!expr) return;
      for (const leaf of flattenLogical(expr, [])) {
        const u = unwrap(leaf);
        if (u.type === 'MemberExpression' || u.type === 'Identifier') {
          slotTexts.add(sourceCode.getText(u));
        }
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : null;
        if (name && NODE_RENDERER_CALLS.has(name) && node.arguments.length > 0) {
          recordSlot(node.arguments[0]);
        }
      },

      JSXAttribute(node) {
        if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'schema') return;
        const owner = node.parent;
        if (owner?.type !== 'JSXOpeningElement') return;
        const tag = owner.name;
        const tagName =
          tag?.type === 'JSXIdentifier'
            ? tag.name
            : tag?.type === 'JSXMemberExpression' && tag.property?.type === 'JSXIdentifier'
              ? tag.property.name
              : null;
        if (!tagName || !NODE_RENDERER_COMPONENTS.has(tagName)) return;
        if (node.value?.type === 'JSXExpressionContainer') {
          recordSlot(node.value.expression);
        }
      },

      LogicalExpression(node) {
        if (node.operator !== '&&') return;
        if (!isInJsxChildPosition(node)) return;
        candidates.push(node);
      },

      'Program:exit'() {
        for (const node of candidates) {
          // Every leaf of the LEFT side can be the `&&`'s value when the chain
          // short-circuits, so each is a candidate leak.
          for (const leaf of flattenLogical(node.left, [])) {
            const u = unwrap(leaf);
            if (u.type !== 'MemberExpression' && u.type !== 'Identifier') continue;
            const text = sourceCode.getText(u);
            if (!slotTexts.has(text)) continue;
            context.report({
              node: u,
              messageId: 'bareNodeSlotGuard',
              data: { slot: text },
            });
            break;
          }
        }
      },
    };
  },
};
