/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { CSSProperties } from 'react';
import type { EmptySchema } from '@object-ui/types';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { DataEmptyState } from '../../custom/view-states';

ComponentRegistry.register('empty', 
  ({ schema, ...props }: { schema: EmptySchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        // Strip schema-shaped props that would otherwise leak through and
        // be rendered as a React child (the SDUI runtime spreads every
        // non-metadata schema key onto the component, but `action` here is
        // a child schema, not a DOM attribute or React node).
        action: _ignoredAction,
        icon: _ignoredIcon,
        ...emptyProps
    } = props as Record<string, unknown>;

    // No cast: `action` is a declared `SchemaNode` member of `EmptySchema`
    // since objectui#7105. What stood here was an `as any` on `schema` to reach
    // the key, and that was the tell that the key was not on the type — it is
    // also why objectui#6150's census, which scanned for un-cast reads, could
    // not see this reader at all.
    //
    // No object-only guard either, ruled with the declaration (maintainer,
    // decision batch #69, 2026-09-07). The `typeof` test that stood here made
    // this slot NARROWER than the `SchemaNode` its siblings declare: a bare
    // string was silently DROPPED rather than rendered. Nothing had to be
    // invented to widen it — `SchemaRenderer` already renders a bare string as
    // its own text and renders nothing for nullish, pinned in
    // `packages/react/src/__tests__/SchemaRenderer.primitiveSchema.test.tsx`.
    //
    // ⚠️ Both retired spellings are asserted ABSENT from this file by
    // `packages/types/src/__tests__/overlay-node-slot-doc-types-7082.test.ts`,
    // and that pin reads the whole file — so ⛔ do not quote either of them
    // literally in a comment here, in prose or in a code span. This paragraph
    // describes them in words for exactly that reason.
    //
    // `toRenderableSchema` is the repo's permanent bridge from the `SchemaNode`
    // union onto `SchemaRendererProps['schema']`, which deliberately declares no
    // `number` / `boolean` (objectui#4548 ruling Q2). It is a total function
    // mapping each of those two members onto whatever `SchemaRenderer` renders
    // for it itself — the text form when truthy, nothing when falsy — so it
    // changes no behaviour. ⛔ Do not "tidy" it into a direct forward, and ⛔ do
    // not reach for a cast instead.
    //
    // ⚠️ The falsy half of that is only true since objectui#8908, and THIS slot
    // is where it was found. The bridge used to map every `number` / `boolean`
    // onto its `String` form; those strings are non-empty and therefore truthy,
    // so the nullish gate above let `action: 0` reach one and
    // `{ type: 'empty', title: 'T', action: 0 }` painted a stray "T0". The gate
    // is still nullish and still right — widening it to truthiness would drop a
    // bare string again, which is the defect objectui#7105 closed. Pinned in
    // `packages/components/src/__tests__/empty-action-falsy-primitive-8908.test.tsx`.
    const actionNode = schema.action == null
      ? undefined
      : <SchemaRenderer schema={toRenderableSchema(schema.action)} />;

    return (
      <DataEmptyState
        title={schema.title || 'No data'}
        description={schema.description}
        className={schema.className}
        action={actionNode}
        {...emptyProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style: style as CSSProperties | undefined }}
      />
    );
  },
  {
    namespace: 'ui',
    label: 'Empty',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      // The third advertised face of `action` (objectui#7105). Without this
      // entry the designer could not offer the key at all, so the capability was
      // unreachable from every authoring surface the platform provides.
      // `'slot'` is the arm for a child position rather than a prop value, which
      // is what a `SchemaNode` is; it is the arm the sibling overlay slots
      // (`trigger`, `content`) and `page:card`'s `footer` already use.
      { name: 'action', type: 'slot', description: 'Call-to-action node rendered below the description, e.g. a button' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      title: 'No data'
    }
  }
);
