/**
 * ObjectUI ESLint rule: no-unpaired-badge-color-classes
 *
 * `@object-ui/fields` answers "what colour is this badge?" in two incompatible
 * currencies:
 *
 *   getBadgeColorClasses(color, value) -> a class string. Complete-looking, and
 *     structurally unable to carry a runtime colour: an author-declared hex is
 *     quantized onto one of the nine palette families.
 *   getBadgeHexAppearance(color) -> `{ className, style }` or `undefined`. The
 *     correct answer for a declared hex — the className reads CSS custom
 *     properties that only the `style` half supplies.
 *
 * Reaching for the first one alone renders a plausible NEIGHBOURING colour
 * rather than breaking, so it fails only for authors who declared a hex and it
 * fails quietly. That is the defect objectui#5141 fixed in the cell renderer
 * and objectui#5183 fixed at four more sites — twice in two weeks, per-site
 * both times, because nothing rejected the class-only call at write time
 * (objectui#5191).
 *
 * The paired form, as every live call site writes it:
 *
 *     const hexBadge = getBadgeHexAppearance(option?.color);
 *     const colorClass = hexBadge
 *       ? hexBadge.className
 *       : getBadgeColorClasses(option?.color, value);
 *     // ... and `hexBadge?.style` travels with the class to the element.
 *
 * WHAT COUNTS AS PAIRED — lexical visibility, not syntax. A
 * `getBadgeColorClasses` call is paired when a `getBadgeHexAppearance` call
 * appears in the SAME function scope or in one ENCLOSING it (module scope
 * included). Consequences, each pinned in the rule's test:
 *   - the `if/else` spelling pairs as well as the ternary — the rule reads
 *     scopes, not conditional shapes, so it cannot be defeated by rewriting the
 *     branch;
 *   - hoisting a loop-invariant `getBadgeHexAppearance` above a `.map()` and
 *     calling the class helper inside the callback stays clean (the consult is
 *     in an enclosing scope, which is what "visible" means);
 *   - a consult in a SIBLING function does NOT pair — otherwise one paired site
 *     in a large file would license every unpaired one added next to it, which
 *     is precisely the fifth-call-site this rule exists to reject.
 *
 * Import aliases are followed (`getBadgeColorClasses as badgeClasses`), and the
 * namespace form (`fields.getBadgeColorClasses(...)`) is matched on the member
 * name. Known limit: passing either helper around as a bare function reference
 * (`const f = getBadgeColorClasses`) is not tracked — no call site in this repo
 * does that, and adding a reference-flow pass would trade a large false-positive
 * surface for a case nobody writes.
 *
 * Not enforced inside `packages/fields` itself (see eslint.config.js): that
 * package DEFINES both helpers and unit-tests each half in isolation, so its
 * deliberate single-helper calls are the helper's own coverage, not a badge
 * surface.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

const CLASS_HELPER = 'getBadgeColorClasses';
const HEX_HELPER = 'getBadgeHexAppearance';
const FIELDS_PACKAGE = '@object-ui/fields';

/**
 * The called name for both spellings a call site can use: a direct identifier
 * (`getBadgeColorClasses(...)`) and a non-computed member access on a namespace
 * import (`fields.getBadgeColorClasses(...)`).
 */
function calleeName(callee) {
  if (!callee) return undefined;
  if (callee.type === 'Identifier') return callee.name;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property &&
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
        'Require a getBadgeHexAppearance consult in scope wherever getBadgeColorClasses is called — the class string alone quantizes an author-declared hex onto a palette family (objectui#5141/#5183/#5191).',
      recommended: true,
    },
    schema: [],
    messages: {
      unpaired:
        "`{{name}}` alone quantizes an author-declared hex onto one of the nine palette families — the defect fixed per-site in objectui#5141 and objectui#5183. Consult `getBadgeHexAppearance(color)` in this scope (or an enclosing one) first, use its `className` AND carry its `style` through to the element, and fall back to `{{name}}(color, value)` only when it returns `undefined`.",
    },
  },
  create(context) {
    // Local names each helper is reachable under in this module. The canonical
    // spelling is always in the set so a re-export or a namespace member is
    // matched even when no direct import declares it here.
    const classNames = new Set([CLASS_HELPER]);
    const hexNames = new Set([HEX_HELPER]);

    // Functions currently open, innermost last. Empty === module scope.
    const fnStack = [];
    // The nearest enclosing function of every hex consult seen in this module
    // (`null` for a consult at module scope, which every scope below can see).
    const hexScopes = new Set();
    // Deferred to `Program:exit` so a consult written after the class call —
    // lexically visible all the same — is not missed by traversal order.
    const classCalls = [];

    return {
      ImportDeclaration(node) {
        if (!node.source || node.source.value !== FIELDS_PACKAGE) return;
        for (const spec of node.specifiers) {
          if (spec.type !== 'ImportSpecifier') continue;
          if (!spec.imported || spec.imported.type !== 'Identifier') continue;
          if (spec.imported.name === CLASS_HELPER) classNames.add(spec.local.name);
          if (spec.imported.name === HEX_HELPER) hexNames.add(spec.local.name);
        }
      },

      ':function'(node) {
        fnStack.push(node);
      },
      ':function:exit'() {
        fnStack.pop();
      },

      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!name) return;
        if (hexNames.has(name)) {
          hexScopes.add(fnStack.length ? fnStack[fnStack.length - 1] : null);
          return;
        }
        if (classNames.has(name)) {
          // `null` first: module scope encloses every call in the file.
          classCalls.push({ node, name, scopes: [null, ...fnStack] });
        }
      },

      'Program:exit'() {
        for (const call of classCalls) {
          if (call.scopes.some((scope) => hexScopes.has(scope))) continue;
          context.report({
            node: call.node,
            messageId: 'unpaired',
            data: { name: call.name },
          });
        }
      },
    };
  },
};
