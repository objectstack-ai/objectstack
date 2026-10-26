/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { DivSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import { forwardRef } from 'react';

/**
 * Deprecated types already reported in this module instance — the notice is a
 * property of the TYPE, not of the node, so one report per page load is the
 * whole signal. Mirrors the warn-once machinery in `layout/containers.tsx`.
 */
const _warnedDeprecations = new Set<string>();

/**
 * Report the deprecation ONCE per type per module load.
 *
 * The renderer used to warn on every single render, which turns any page with
 * many `div` nodes into a console flood: the docs schema-catalog index renders
 * 400+ example thumbnails and produced ~190 identical notices, burying the
 * real errors underneath (it twice cost a browser-verification run the signal
 * it was looking for — objectui#3965, discovered during #3903 / PR #3964).
 *
 * The deprecation itself is unchanged and still fires in dev builds; only the
 * repetition is dropped. Order matters: the production check returns BEFORE the
 * seen-set is marked, so a production render never suppresses the dev notice.
 */
function warnDeprecatedOnce(type: string, message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (_warnedDeprecations.has(type)) return;
  _warnedDeprecations.add(type);
  console.warn(message);
}

/**
 * The notice, including WHICH AUTHORING SURFACES it is about.
 *
 * ## Deprecated on BOTH surfaces — re-ruled in objectui#10757
 *
 * objectui#4000 scoped this deprecation to the JSON surface and kept the tag as
 * vocabulary of the `kind:'html'` tier. The maintainer's later ruling A on
 * objectstack#20112 supersedes that for this type: the published manifest
 * declares the html tier's intrinsic set, `div` stays deprecated there, and
 * `box` replaces it. So the declaration on the registration below names both
 * surfaces, and the html tier's compile (`layout/page.tsx`) REFUSES the tag —
 * a `forbidden-tag` error that names the declared replacement — instead of
 * compiling it straight through. That is the answer the published gate gives
 * for the same page, and it is a refusal, not a dev-only notice.
 *
 * An html author therefore never reaches this renderer with a `div` through
 * the console, and this notice is read by JSON authors. Its scope sentence
 * still names the html tier, so a reader of either surface can tell the notice
 * is about them too.
 *
 * ⛔ `span` keeps objectui#4000's provenance scope: the ruling names only `div`.
 *
 * ## The guidance was RE-RULED in objectui#6877 — it is no longer #4000's bytes
 *
 * objectui#4000 recorded the migration guidance as "byte-for-byte what it was",
 * and that pin was right for as long as the guidance was merely INCOMPLETE. It
 * became FALSE when the neutral `box` container landed (objectui#3965 /
 * PR #6878). Measured through the real `SchemaRenderer`, on a node carrying an
 * authored `className` and one text child — every replacement the old bullets
 * named changes the rendered result:
 *
 *   card       + `rounded-lg border bg-card text-card-foreground shadow-sm`,
 *              and the children move inside an extra `CardContent` element
 *              (1 element becomes 2)
 *   flex       + `flex flex-row justify-start items-start gap-1.5 sm:gap-2`
 *   container  + `w-full max-w-xl mx-auto p-2 sm:p-3 md:p-4`
 *   stack      + `flex flex-col justify-start items-stretch gap-1.5 sm:gap-2`
 *   grid       + `grid grid-cols-2 gap-4`
 *
 * and four of those five — `flex`, `container`, `stack`, `grid` — read
 * `children` ONLY, so a node that authored `body` loses its content SILENTLY,
 * at an unchanged element count. `box` is the one class-transparent swap, and
 * the old text never named it. (That was the measurement at the time. Since
 * objectui#6771 retired the `body` spelling, `card` and `div` itself read
 * `children` only as well, so `body` content is drawn by none of them and the
 * notice's `body` bullet says so.)
 *
 * That is why this is worth a re-ruling rather than a nice-to-have. Deprecation
 * guidance is followed LITERALLY, by humans and by generating models reading
 * the console alike, so a notice naming only non-drop-in replacements
 * manufactures exactly the conversions objectui#3965 measured and rejected.
 *
 * ⚠️ `box` is not unconditionally drop-in either, and the text below says so
 * instead of selling it as one: it too reads `children` only, so `body` content
 * has to move first. A recommendation that is true WITH a caveat beats a
 * cleaner one that is false — trading one false recommendation for another
 * would be worse than leaving the old text alone.
 *
 * The four surfaces that state this guidance move in ONE stroke: this notice,
 * the declaration below, `content/docs/components/basic/div.mdx`, and the
 * `components-basic-div` catalog category. They are held together by
 * `__tests__/div-guidance-names-box.test.tsx` (objectui#6877) and, for the
 * first two, by `__tests__/deprecation-guidance-agreement.test.tsx`
 * (objectui#6823).
 *
 * ⛔ `span`'s notice is a SEPARATE judgement and is deliberately untouched:
 * `box` is a block-level container, and nothing about the inline replacement
 * story changed. The same pin file asserts that this edit did not sweep it in.
 *
 * ## Quoting convention — load-bearing, not style
 *
 * Inside the bullets, DOUBLE QUOTES mean "component type name" and nothing
 * else; property names take backticks. The objectui#6823 agreement test reads
 * the offered alternatives out of both statements as their double-quoted runs,
 * so a `"body"` written with the wrong quotes would arrive as a component type
 * this notice claims to offer.
 */
const DIV_DEPRECATION_NOTICE =
  '[ObjectUI] The "div" component is deprecated on every authoring surface. Please use Shadcn components instead:\n' +
  '  - For a plain wrapper the drop-in swap is "box": same element, your `className` verbatim, no layout of its own.\n' +
  '  - Reach for "card", "flex", "container", "stack", or "grid" only when you want their layout — each injects classes of its own, and "card" also moves children into an extra element.\n' +
  '  - Move any `body` content into `children` first: `body` is the child-list spelling objectui#6771 retired, so validation refuses it by name, and neither this component nor any replacement above draws it.\n' +
  '  This applies to JSON-authored nodes and to kind:\'html\' pages alike: an html page refuses the\n' +
  '  tag when it compiles, naming the same replacement.\n' +
  'See documentation at https://www.objectui.org/docs/components for alternatives.';

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const DivRenderer = forwardRef<HTMLDivElement, { schema: DivSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: DivSchema; className?: string; [key: string]: any }, ref) => {
    // Deprecation notice, once per module load (objectui#3965, see
    // warnDeprecatedOnce). There is no provenance exemption any more: the
    // declaration below names both authoring surfaces (objectui#10757), so a
    // node the html tier's parser emitted is as deprecated as a JSON-authored
    // one. In the console such a node never gets this far, because the html
    // compile refuses the tag first. A host that compiles against its own
    // whitelist still hears about it here.
    warnDeprecatedOnce('div', DIV_DEPRECATION_NOTICE);

    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...divProps
    } = props;
    
    return (
    <div 
        ref={ref}
        className={className} 
        {...divProps}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    >
      {renderChildren(schema.children)}
    </div>
  );
  }
);

ComponentRegistry.register('div',
  DivRenderer,
  {
    namespace: 'ui',
    label: 'Container (Deprecated)',
    /**
     * The MACHINE-READABLE statement of the deprecation above (objectui#6674).
     *
     * Until this key existed, the only two statements that this type is
     * deprecated were `DIV_DEPRECATION_NOTICE` — a string literal inside a
     * renderer — and the word inside `label`. Neither can be consulted by a
     * gate, a test or a type, which is why a deprecated type could be authored
     * 85 times across 27 shipped exemplars with every check in the repository
     * green: both gates that touch component types ask whether the type
     * RESOLVES, and this one resolves.
     *
     * `surfaces` names BOTH authoring surfaces (objectui#10757, executing
     * ruling A on objectstack#20112, which supersedes objectui#4000's html-tier
     * exemption for this type). This list is the ONE authority its readers
     * consult, and none of them keeps a second list of tag names: the renderer
     * above no longer exempts html-tier nodes, and the html tier's compile
     * (`layout/page.tsx`) leaves every type deprecated on `'html'` out of its
     * whitelist and names `replacement` in the refusal.
     * `__tests__/div-deprecation-provenance.test.tsx` pins the declaration, the
     * refusal and the renderer to each other, so none of them can move alone.
     *
     * ⛔ On the JSON surface declaring this fails NO build. The catalog ratchet
     * (`examples/schema-catalog/test/deprecated-component-types.test.ts`,
     * objectui#6732) freezes the existing stock and refuses growth; draining it
     * is objectui#3965's worklist. On the html surface it IS a refusal: a
     * `kind:'html'` page that authors the tag fails to compile.
     */
    deprecated: {
      surfaces: ['json', 'html'],
      /**
       * Re-ruled with the notice above in objectui#6877 — the two are asserted
       * to offer the SAME set of alternatives (objectui#6823), so they cannot
       * be moved one at a time. Same quoting convention: double quotes are
       * component type names, backticks are property names.
       */
      replacement:
        'author "box" for a plain wrapper — the one drop-in swap; reach for "card", "flex", "container", "stack" or "grid" only when you want their layout, and move `body` content into `children` first',
    },
    inputs: [
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot' }
    ],
    defaultProps: {
      className: 'p-2 sm:p-4 border border-dashed border-gray-300 rounded min-h-[100px]'
    }
  }
);
