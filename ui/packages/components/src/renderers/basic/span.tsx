/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import { isHtmlTierNode } from '@object-ui/sdui-parser';
import type { TextSpanSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import { forwardRef } from 'react';

/**
 * Deprecated types already reported in this module instance — the notice is a
 * property of the TYPE, not of the node, so one report per page load is the
 * whole signal. Mirrors the warn-once machinery in `basic/div.tsx`.
 */
const _warnedDeprecations = new Set<string>();

/**
 * Report the deprecation ONCE per type per module load.
 *
 * The renderer used to warn on every single render, so a page with many inline
 * nodes turned the console into a flood that buries the page's real errors
 * (objectui#3965 measured ~190 identical `div` notices on the docs
 * schema-catalog index). PR #3998 fixed `div` and named `span` as the
 * follow-up; this is that follow-up (objectui#4917).
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
 * The notice, including WHICH AUTHORING SURFACE it is about.
 *
 * Scope is part of the message, not decoration. This type is deprecated on the
 * JSON surface and simultaneously a permanent, first-class tag of the
 * `kind:'html'` tier — an author there writes the plain inline tag and our own
 * parser maps it straight through, and no other spelling exists for them to
 * migrate to. A notice that says the type is deprecated FULL STOP is therefore
 * false for one of its two readers, and it was the reader who could do nothing
 * about it who kept receiving it (objectui#4000, ruled for `div`; the same
 * ruling applies here because `basic/html-elements.tsx` deliberately leaves
 * this tag out of its own TAGS list — it is registered by this module).
 *
 * The migration guidance below is byte-for-byte what it was: this issue narrows
 * WHO is told, it does not water down WHAT they are told.
 */
const SPAN_DEPRECATION_NOTICE =
  '[ObjectUI] The "span" component is deprecated for JSON-authored pages. Please use Shadcn components instead:\n' +
  '  - For badges/labels: use "badge" component\n' +
  '  - For inline text emphasis: use "text" component with appropriate className\n' +
  '  This applies to JSON-authored nodes. In a kind:\'html\' page the tag is part of that tier\'s own\n' +
  '  vocabulary, is compiled straight through, and is not reported here.\n' +
  'See documentation at https://www.objectui.org/docs/components for alternatives.';

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const SpanRenderer = forwardRef<HTMLSpanElement, { schema: TextSpanSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: TextSpanSchema; className?: string; [key: string]: any }, ref) => {
    // Deprecation notice — JSON-authored nodes only (objectui#4000), once per
    // module load (objectui#3965, see warnDeprecatedOnce). Both rulings landed
    // for `div` first; objectui#4917 brings this renderer level with it.
    //
    // ORDER, same discipline as the production early-return inside
    // warnDeprecatedOnce: the exemption is checked BEFORE the seen-set is
    // marked. An html-tier node rendering first must not latch the guard, or it
    // would swallow the notice a JSON-authored node earns later on the same
    // page — silencing exactly the reader this notice is for.
    //
    // The test is provenance, established by the producer (the parser stamps
    // what it emits), not a guess about the node's shape here.
    if (!isHtmlTierNode(schema)) {
      warnDeprecatedOnce('span', SPAN_DEPRECATION_NOTICE);
    }


    // Extract designer-related props
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...spanProps
    } = props;
    
    return (
    <span 
        ref={ref}
        className={className} 
        {...spanProps}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    >
      {/*
        The canonical child key is `children` (objectui#5027).

        This read used to be `schema.body`, which no producer on either
        authoring surface emits: `TextSpanSchema` declares `value` and
        `children`, the html tier's parser assigns compiled child nodes to
        `children` (`sdui-parser/src/parse.ts`), and the sibling `div` renderer
        reads `children` too. So the tag rendered EMPTY and dropped its content
        without a diagnostic — the parser's tree validation does not inspect
        child keys.

        `body` is deliberately not accepted as a second spelling. Adding a
        tolerant read here would fossilize a second de-facto contract for the
        one type whose declaration never named it (Commandment #0.1), and the
        sweep for this issue found nothing in the repo authoring it on this tag.
        `__tests__/span-children-rendering.test.tsx` pins both halves.

        `value` IS read, as the fallback (objectui#5050). It is not an alias
        anybody invented on the read side: `TextSpanSchema` declares it
        (`packages/types/src/layout.ts`) and the published doc's Schema block
        lists it, both calling it the text content — and the renderer read
        neither `value` nor, before #5027, any key a producer emits. So an
        author following the type or the docs got the same empty element the
        html tier got, one key over. Ruled 2026-08-17: wire it, rather than
        retract two declared surfaces that have been published as true.

        PRECEDENCE — child content wins. This is the family shape `text`
        already sets one file over (`schema.content || schema.value` in
        `basic/text.tsx`), not a rule invented for this type: the richer key
        wins and the scalar is what you fall back to. `renderChildren` returns
        `null` for an absent, empty-string or empty-array `children`, so "no
        child content" is exactly when `value` renders.

        Note the asymmetry with the `body` paragraph above, since both
        paragraphs are about a key this renderer did not use to read: `body` is
        declared NOWHERE for this type and refused; `value` is declared TWICE
        for it and honored. The question is never "is a tolerant read
        convenient" but "did we publish this key as authorable".
      */}
      {renderChildren(schema.children) || schema.value}
    </span>
  );
  }
);

ComponentRegistry.register('span',
  SpanRenderer,
  {
    namespace: 'ui',
    label: 'Inline Container (Deprecated)',
    /**
     * The MACHINE-READABLE statement of the deprecation above (objectui#6674),
     * level with the sibling `div` registration for the same reason
     * objectui#4917 brought this renderer level with it: `SPAN_DEPRECATION_NOTICE`
     * is a string literal and `label` is prose, and no gate can read either.
     *
     * `surfaces` carries the objectui#4000 ruling — deprecated on the JSON
     * authoring surface, permanent vocabulary of the `kind:'html'` tier — as the
     * same fact the `isHtmlTierNode` exemption above applies at runtime.
     * `__tests__/span-deprecation-provenance.test.tsx` pins the two together.
     */
    deprecated: {
      surfaces: ['json'],
      replacement:
        'use "badge" for labels, or "text" with a className for inline emphasis',
    },
    inputs: [
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot', description: 'Inline content, rendered ahead of `value`' }
    ],
    defaultProps: {
      className: 'px-1.5 py-0.5 sm:px-2 sm:py-1'
    }
  }
);
