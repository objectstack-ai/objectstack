/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectFormContainer — the drawer and modal containers an `object-form`
 * block asks for with `formType: 'drawer' | 'modal'`.
 *
 * ADR-0050 Decision 4 (Accepted by ruling 6464210455 on objectstack#27032):
 * `ObjectForm` lays a form out (`simple` / `tabbed` / `wizard`) and never
 * chooses where it opens; `DrawerForm` / `ModalForm` are containers the CALLER
 * supplies. A host that owns the container mounts `ModalForm` itself (the
 * console's New / Edit dialog, an action modal). A page author has no such
 * host: the `object-form` block (`<ObjectForm formType="drawer">` on a React
 * page) is the only door to a built-in overlay form, so the block renderer is
 * the caller, and this is the container it supplies. The form view's own
 * `type` never reaches here: `@objectstack/spec` refuses `drawer` / `modal`
 * there since #27155.
 *
 * Both maps prepare the schema through `usePreparedFormSchema`, the one
 * preparation `ObjectForm` uses, so the labels, field-level security and
 * `{ group }` sections a container draws are the ones the layouts draw.
 */

import React from 'react';
import type { ObjectFormSchema } from '@object-ui/types';
import { usePreparedFormSchema, ObjectForm, type ObjectFormComponentProps } from './ObjectForm';
import { DrawerForm } from './DrawerForm';
import { ModalForm } from './ModalForm';
import { RecordFieldAccessForForm } from './recordFieldAccess';

/** The `formType` values that name a container rather than a layout. */
export type ObjectFormContainerType = 'drawer' | 'modal';

/** True when an `object-form` block's `formType` names a container. */
export function isObjectFormContainerType(
  formType: ObjectFormSchema['formType'] | undefined,
): formType is ObjectFormContainerType {
  return formType === 'drawer' || formType === 'modal';
}

/**
 * The container route of the `object-form` block. Wrapped in the same record
 * field-lock scope as `ObjectForm` (objectstack#26594).
 */
export const ObjectFormContainer: React.FC<ObjectFormComponentProps> = ({ schema, ...rest }) => (
  <RecordFieldAccessForForm schema={schema} dataSource={rest.dataSource}>
    {/* `schema=` by name, so the handler-key census follows the document into the body. */}
    <ObjectFormContainerBody schema={schema} {...rest} />
  </RecordFieldAccessForForm>
);

const ObjectFormContainerBody: React.FC<ObjectFormComponentProps> = ({
  schema: rawSchema,
  dataSource,
}) => {
  const { schema, tSec } = usePreparedFormSchema(rawSchema, dataSource);

  if (schema.formType === 'drawer') {
    // `layout` passes through unfolded: it is `vertical | horizontal` on both
    // faces since objectui#11168 slice 3 (objectui#7759 group C), and the fold
    // that mapped `inline` / `grid` away here is retired with them.
    return (
      <DrawerForm
        schema={{
          ...schema,
          formType: 'drawer',
          sections: schema.sections?.map(s => ({
            name: s.name,
            label: tSec(s),
            description: s.description,
            columns: s.columns,
            // `?? []` — see `ObjectForm`'s tabbed arm (objectui#7051).
            fields: s.fields ?? [],
            collapsible: (s as any).collapsible,
            collapsed: (s as any).collapsed,
            // ADR-0089 section predicate (#6111) — key-by-key rebuild, so an
            // uncopied key is silently dropped before DrawerForm ever sees it.
            visibleWhen: (s as any).visibleWhen,
            visibleWhenFault: s.visibleWhenFault,
            // `className`: deliberately not copied — see `ObjectForm`'s tabbed arm
            // (objectstack#13626, ruled 2026-09-01). DrawerForm's own divider
            // site stops reading it in the same pass.
          })),
          open: schema.open,
          onOpenChange: schema.onOpenChange,
          drawerSide: schema.drawerSide,
          drawerWidth: schema.drawerWidth,
        }}
        dataSource={dataSource}
        className={schema.className}
      />
    );
  }

  if (schema.formType === 'modal') {
    // `layout` passes through unfolded — see the drawer branch above.
    return (
      <ModalForm
        schema={{
          ...schema,
          formType: 'modal',
          sections: schema.sections?.map(s => ({
            name: s.name,
            label: tSec(s),
            description: s.description,
            columns: s.columns,
            // `?? []` — see `ObjectForm`'s tabbed arm (objectui#7051).
            fields: s.fields ?? [],
            // The collapse pair (objectui#9849 step two — director ruling
            // letter E, item 1: group semantics attach 「on every arm」). The
            // spec declares both on `sections[]`; this map used to copy
            // neither, so the modal silently ignored a declared collapse.
            collapsible: s.collapsible,
            collapsed: s.collapsed,
            // ADR-0089 section predicate (#6111) — key-by-key rebuild, so an
            // uncopied key is silently dropped before ModalForm ever sees it.
            visibleWhen: (s as any).visibleWhen,
            visibleWhenFault: s.visibleWhenFault,
            // `className` / `gridClassName`: deliberately not copied — see
            // `ObjectForm`'s tabbed arm (objectstack#13626, ruled 2026-09-01).
          })),
          open: schema.open,
          onOpenChange: schema.onOpenChange,
          modalSize: schema.modalSize,
          modalCloseButton: schema.modalCloseButton,
        }}
        dataSource={dataSource}
        className={schema.className}
      />
    );
  }

  // Not a container: the layout is `ObjectForm`'s to draw.
  return <ObjectForm schema={rawSchema} dataSource={dataSource} />;
};
