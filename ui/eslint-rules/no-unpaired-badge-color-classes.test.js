/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit test for the local ESLint rule that requires a `getBadgeHexAppearance`
 * consult in scope wherever `getBadgeColorClasses` is called (objectui#5191).
 * Plain JS so it needs no package tsconfig.
 *
 * The `valid` cases are the shapes that exist on `main` today, transcribed from
 * the live call sites (plugin-grid ObjectGrid group header + compact card,
 * plugin-kanban card badges) plus the spellings a correct author may reasonably
 * reach for next. The `invalid` cases are the historical defect shape
 * (objectui#5141, objectui#5183) and the ways a fifth site could try to look
 * paired without being paired.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-unpaired-badge-color-classes.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-unpaired-badge-color-classes', rule, {
  valid: [
    // The canonical pair, as plugin-kanban writes it (ObjectKanban.tsx).
    `
      import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
      function KanbanBadge(opt, raw) {
        const hexBadge = getBadgeHexAppearance(opt?.color);
        const colorClass = hexBadge ? hexBadge.className : getBadgeColorClasses(opt?.color, raw);
        return { colorClass, colorStyle: hexBadge?.style };
      }
    `,
    // The nested-ternary shape of ObjectGrid's compact card, where a third
    // branch falls back to a local pipeline-stage heuristic.
    `
      import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
      function CompactCardBadge(optMeta, rawValue) {
        const hexBadge = getBadgeHexAppearance(optMeta.color);
        return hexBadge
          ? hexBadge.className
          : optMeta.color
            ? getBadgeColorClasses(optMeta.color, rawValue)
            : stageBadgeColor(String(rawValue));
      }
    `,
    // Scope-level, not syntax-level: the if/else spelling pairs exactly as well
    // as the ternary. A rule that read the conditional shape would reject this
    // correct code, and rewriting the branch would defeat it.
    `
      import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
      function resolve(color, value) {
        const hexBadge = getBadgeHexAppearance(color);
        let cls;
        if (hexBadge) {
          cls = hexBadge.className;
        } else {
          cls = getBadgeColorClasses(color, value);
        }
        return cls;
      }
    `,
    // An ENCLOSING scope counts: hoisting a loop-invariant consult above the
    // callback is good code, and the class call inside the callback still sees
    // it. (Flagging this is how a preventive rule earns itself deleted.)
    `
      import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
      function Legend(color, values) {
        const hexBadge = getBadgeHexAppearance(color);
        return values.map((v) => (hexBadge ? hexBadge.className : getBadgeColorClasses(color, v)));
      }
    `,
    // Module scope encloses every call in the file.
    `
      import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
      const hexBadge = getBadgeHexAppearance(DECLARED_COLOR);
      function badge(value) {
        return hexBadge ? hexBadge.className : getBadgeColorClasses(DECLARED_COLOR, value);
      }
    `,
    // Aliased imports are followed on both halves.
    `
      import {
        getBadgeColorClasses as badgeClasses,
        getBadgeHexAppearance as badgeHex,
      } from '@object-ui/fields';
      function resolve(color, value) {
        const hex = badgeHex(color);
        return hex ? hex.className : badgeClasses(color, value);
      }
    `,
    // Namespace import: matched on the member name, and paired the same way.
    `
      import * as fields from '@object-ui/fields';
      function resolve(color, value) {
        const hex = fields.getBadgeHexAppearance(color);
        return hex ? hex.className : fields.getBadgeColorClasses(color, value);
      }
    `,
    // The consult may be written after the call it guards — the rule resolves
    // pairing over the whole module, not in traversal order.
    `
      import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
      function resolve(color, value) {
        const cls = hex ? hex.className : getBadgeColorClasses(color, value);
        const hex = getBadgeHexAppearance(color);
        return cls;
      }
    `,
    // Nothing to do with badges.
    `
      import { formatCurrency } from '@object-ui/fields';
      const label = formatCurrency(12);
    `,
    // A JSX surface that pairs, carrying the style half through to the element.
    `
      import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
      function Cell({ option, val }) {
        const hexBadge = getBadgeHexAppearance(option?.color);
        const colorClasses = hexBadge ? hexBadge.className : getBadgeColorClasses(option?.color, val);
        return <Badge className={colorClasses} style={hexBadge?.style} />;
      }
    `,
  ],
  invalid: [
    // The historical defect shape: the class helper imported and called alone.
    // This is what every site fixed by objectui#5141 and objectui#5183 looked
    // like before the fix.
    {
      code: `
        import { getBadgeColorClasses } from '@object-ui/fields';
        function StatusBadge({ option, value }) {
          return <Badge className={getBadgeColorClasses(option?.color, value)} />;
        }
      `,
      errors: [{ messageId: 'unpaired' }],
    },
    // Assigned rather than inlined — same defect, no conditional to inspect.
    {
      code: `
        import { getBadgeColorClasses } from '@object-ui/fields';
        function resolve(color, value) {
          const cls = getBadgeColorClasses(color, value);
          return cls;
        }
      `,
      errors: [{ messageId: 'unpaired' }],
    },
    // An alias does not hide the call.
    {
      code: `
        import { getBadgeColorClasses as badgeClasses } from '@object-ui/fields';
        function resolve(color, value) {
          return badgeClasses(color, value);
        }
      `,
      errors: [{ messageId: 'unpaired' }],
    },
    // Nor does the namespace form.
    {
      code: `
        import * as fields from '@object-ui/fields';
        function resolve(color, value) {
          return fields.getBadgeColorClasses(color, value);
        }
      `,
      errors: [{ messageId: 'unpaired' }],
    },
    // THE HOLE THIS SCOPE RULE CLOSES: a consult in a SIBLING function does not
    // pair. Otherwise one correct site would license every unpaired site added
    // beside it in the same file — and the files that already pair (ObjectGrid,
    // ObjectKanban) are exactly where a fifth badge surface gets written.
    {
      code: `
        import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
        function groupHeader(color, value) {
          const hexBadge = getBadgeHexAppearance(color);
          return hexBadge ? hexBadge.className : getBadgeColorClasses(color, value);
        }
        function newCardSurface(color, value) {
          return getBadgeColorClasses(color, value);
        }
      `,
      errors: [{ messageId: 'unpaired' }],
    },
    // A consult buried in a NESTED callback is not visible to the outer call
    // either — direction matters, enclosing only.
    {
      code: `
        import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
        function resolve(color, values) {
          values.forEach((v) => { getBadgeHexAppearance(v.color); });
          return getBadgeColorClasses(color, values[0]);
        }
      `,
      errors: [{ messageId: 'unpaired' }],
    },
    // The rule counts SITES, not files: two unpaired calls report twice.
    {
      code: `
        import { getBadgeColorClasses } from '@object-ui/fields';
        function a(c, v) { return getBadgeColorClasses(c, v); }
        function b(c, v) { return getBadgeColorClasses(c, v); }
      `,
      errors: [{ messageId: 'unpaired' }, { messageId: 'unpaired' }],
    },
    // Importing the hex helper without ever calling it is not a consult.
    {
      code: `
        import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
        function resolve(color, value) {
          return getBadgeColorClasses(color, value);
        }
      `,
      errors: [{ messageId: 'unpaired' }],
    },
  ],
});
