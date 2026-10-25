/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Registers the console's faces for `@object-ui/fields`' two widget-hinted
 * reference keys, `object-ref` and `recipient-picker` (objectui#12613), the
 * way `record-pointer-card-renderer.tsx` registers the pointer card:
 * `@object-ui/fields` owns the rule and the keys and keeps the stored text as
 * their default face, and this package, imported for its side effect from the
 * package entry (`src/index.ts`), registers the faces that name the value.
 *
 * The faces and their label directory load LAZILY, on the first cell that
 * draws one: a list that shows no such column pays nothing on page load, which
 * is the point of keeping them out of `@object-ui/fields` (see
 * `./refLabelDirectory.ts`). Until the module arrives a cell draws the stored
 * text — exactly what it draws while its label is being read.
 */

import * as React from 'react';
import { TextCellRenderer, registerFieldRenderer, type CellRendererProps } from '@object-ui/fields';

const loadFaces = () => import('./WidgetRefCellFaces.js');
const LazyObjectRefFace = React.lazy(() => loadFaces().then((m) => ({ default: m.ObjectRefCellFace })));
const LazyRecipientFace = React.lazy(() => loadFaces().then((m) => ({ default: m.RecipientCellFace })));

/** The `object-ref` key's face: the lazily loaded label face, text until it lands. */
export function ObjectRefCell(props: CellRendererProps) {
  return (
    <React.Suspense fallback={<TextCellRenderer {...props} />}>
      <LazyObjectRefFace {...props} />
    </React.Suspense>
  );
}

/** The `recipient-picker` key's face: the lazily loaded label face, text until it lands. */
export function RecipientCell(props: CellRendererProps) {
  return (
    <React.Suspense fallback={<TextCellRenderer {...props} />}>
      <LazyRecipientFace {...props} />
    </React.Suspense>
  );
}

registerFieldRenderer('object-ref', ObjectRefCell);
registerFieldRenderer('recipient-picker', RecipientCell);
