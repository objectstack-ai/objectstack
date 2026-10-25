/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import { renderChildren } from '../../lib/utils';
import { forwardRef } from 'react';

const tags = ['aside', 'main', 'header', 'nav', 'footer', 'section', 'article'] as const;

tags.forEach(tag => {
  // Index signature on the parameter annotation, not on the `forwardRef` type
  // argument — mechanism note on `action:bar` (objectui#4422), pinned by
  // `__tests__/forwardref-props-annotation.guard.test.ts`. This factory covers
  // seven semantic tags with no schema type of their own, so `schema` stays
  // `any`; the annotation is written like its siblings' so the guard needs no
  // per-file carve-out.
  const Component = forwardRef<HTMLElement, { schema: any; className?: string }>(({ schema, className, ...props }: { schema: any; className?: string; [key: string]: any }, ref) => {
      // Extract designer-related props
      const { 
          'data-obj-id': dataObjId, 
          'data-obj-type': dataObjType,
          style,
          ...restProps
      } = props;
      
      const Tag = tag;
      
      return (
      <Tag 
          ref={ref}
          className={className} 
          {...restProps}
          {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {renderChildren(schema.children)}
      </Tag>
    );
  });
  Component.displayName = `Semantic${tag.charAt(0).toUpperCase() + tag.slice(1)}`;

  ComponentRegistry.register(tag, Component, {
      namespace: 'ui',
      label: tag.charAt(0).toUpperCase() + tag.slice(1),
      category: 'layout',
      // Declared because the factory above RENDERS a child list
      // (`renderChildren(schema.children)`), which is the whole
      // question this flag answers -- `children` is a BASE property of every
      // node in the JSON protocol (`BASE_PROPS` in `sdui-parser/src/validate.ts`),
      // not a per-component authoring key, so declaring it widens no spec
      // surface (the objectui#3900 reasoning, spelled out at
      // `packages/layout/src/index.ts`). Leaving it off did not make children
      // illegal -- nothing on the render path reads the flag -- it made
      // `validateTree` LIE, warning `not-a-container` on seven sectioning tags
      // that render children correctly.
      //
      // Safe on the second consumer, and that was MEASURED rather than assumed
      // (objectui#6764): `renderers/layout/react-page.tsx` drops containers from
      // the `kind:'react'` JSX scope, but it iterates `getPublicConfigs()`, and
      // none of these seven tags is in the curated `PUBLIC_BLOCKS` contract --
      // so there is no injected `<Aside>`/`<Main>`/... identifier for this flag
      // to remove. `__tests__/container-declaration-census.test.tsx` pins that
      // premise, so promoting one of these into the public contract re-opens the
      // question here instead of silently deleting a tag from every react page.
      isContainer: true,
      inputs: [
        { name: 'className', type: 'string' },
        // The child slot this factory renders, declared as an input
        // (objectui#9910): `validateTree`'s `not-a-container` now reads this
        // entry and nothing else, so the flag above is layout containment
        // only and this line is what keeps the diagnostic true.
        { name: 'children', type: 'slot' }
      ]
  });
});
