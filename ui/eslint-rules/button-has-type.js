/**
 * ObjectUI ESLint rule: button-has-type
 *
 * Requires every plain `<button>` JSX element to declare `type`.
 *
 * HTML's default for a `<button>` with no `type` is `type="submit"`. Inside a
 * `<form>` that makes every untyped button a submit button: one click submits
 * the enclosing form (full page reload / duplicate save / lost draft) instead
 * of running its own handler. The trap is that the button's own file usually
 * looks innocent — the defect only appears once the component is COMPOSED into
 * a form, which in a server-driven-UI renderer is a JSON metadata decision made
 * by someone who never reads this file. So "it isn't in a form today" is not a
 * defence, it is the dormancy.
 *
 * This is mechanical because the prose did not hold. The same defect class was
 * patched one instance at a time three times — objectui#3344 (combobox
 * trigger), objectstack#5236 / PR #3926 (`filter-tab-add`), objectstack#6952 /
 * PR #3948 (`UserFilters`) — and each round only covered the sites that were
 * being looked at that day, while the population stayed in the hundreds and
 * nothing stopped the next one from being written (objectui#4045). The rule
 * ends the class instead of the instances: `type` is not in the type system
 * (React's `ButtonHTMLAttributes.type` is optional), so nothing else rejects it
 * at write time.
 *
 * Flagged: the lowercase intrinsic `button` only. A `<Button>` COMPONENT is a
 * different contract — its own implementation is responsible for the DOM
 * attribute, and `@object-ui/components`' Button already sets it.
 *
 * A `{...spread}` does NOT satisfy the rule. It may or may not carry `type` at
 * runtime and no checker can tell which, so exempting it would reopen the hole
 * for exactly the buttons whose props come from elsewhere. Measured cost of the
 * strict reading at the time of writing: one site in the whole repo has a real
 * JSX spread attribute on a `<button>` (`plugin-view/ManageViewsDialog.tsx`)
 * and it already declares `type="button"` explicitly.
 *
 * Radix `*Trigger asChild` children are NOT special-cased. They are flagged
 * like any other button — deliberately. Radix's `Primitive.button` does supply
 * `type="button"` through its Slot today (verified on
 * `@radix-ui/react-popover@1.1.23`, `dist/index.mjs:89`), so those sites are
 * covered *at runtime*, but that is an upstream implementation detail, not a
 * contract — which is precisely the note
 * `packages/components/src/custom/combobox.tsx` already carries ("declare the
 * contract locally"). Declaring it locally is cheap and survives an upstream
 * change.
 *
 * No autofixer on purpose. `type="button"` is the right answer for nearly every
 * site, but "nearly" is the problem: a genuine submit button silently rewritten
 * to `type="button"` stops submitting its form, and that failure is invisible
 * to every test that does not click it. The author picks `button` / `submit` /
 * `reset`; the rule only refuses to let the choice go unmade.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

const CORRECTION =
  'Add `type="button"` (or `type="submit"` / `type="reset"` if that is genuinely what it does).';

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require an explicit `type` on plain `<button>` elements — HTML defaults to type="submit", so an untyped button submits any form it is composed into (objectui#3344 family, objectui#4045).',
      recommended: true,
    },
    schema: [],
    messages: {
      missingType: `This <button> does not declare \`type\`, so HTML defaults it to \`type="submit"\` — composed into a <form> it submits the form instead of running its own handler (objectui#3344 family, objectui#4045). ${CORRECTION}`,
      spreadType: `This <button> does not declare \`type\` — a {...spread} may or may not carry one at runtime, which is exactly the case that cannot be checked (objectui#4045). Declare it on the element: ${CORRECTION}`,
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        // Intrinsic `button` only — `<Button>` is a component contract.
        if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'button') {
          return;
        }
        let hasSpread = false;
        for (const attr of node.attributes) {
          if (attr.type === 'JSXSpreadAttribute') {
            hasSpread = true;
            continue;
          }
          if (
            attr.type === 'JSXAttribute' &&
            attr.name?.type === 'JSXIdentifier' &&
            attr.name.name === 'type'
          ) {
            return;
          }
        }
        context.report({
          node,
          messageId: hasSpread ? 'spreadType' : 'missingType',
        });
      },
    };
  },
};
