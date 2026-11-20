/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:body_table_editor` — the record page's edit state draws each
 * master-detail body table as this node (`swapBodyTablesForEditors` in
 * `recordEditState.tsx`), which is `@object-ui/plugin-form`'s
 * `RecordBodyTableEditor`.
 *
 * A side-effect registration, imported from the app-shell barrel and listed in
 * the package's `sideEffects`, so a bundler keeps it; `recordEditState.tsx`
 * imports it too, so the type is registered wherever the edit state is.
 * Namespaced, so it stays outside the public component manifest
 * (`getPublicConfigs` takes no namespaced key): a host-written node only.
 */

import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { RecordBodyTableEditor } from '@object-ui/plugin-form';

const BodyTableEditorNode: React.FC<{ schema: any }> = ({ schema }) => (
  <RecordBodyTableEditor
    objectName={schema?.objectName}
    relationshipField={schema?.relationshipField}
    title={typeof schema?.title === 'string' ? schema.title : undefined}
  />
);

ComponentRegistry.register('body_table_editor', BodyTableEditorNode, {
  namespace: 'record',
  skipFallback: true,
  label: 'Body table editor',
  category: 'record',
  inputs: [
    { name: 'objectName', type: 'string', description: 'The body table\'s child object.' },
    { name: 'relationshipField', type: 'string', description: 'The child\'s master-detail field back to the record.' },
    { name: 'title', type: 'string', description: 'The table heading, as read mode drew it.' },
  ],
});
