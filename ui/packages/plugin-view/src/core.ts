/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `@object-ui/plugin-view/core` — the side-effect-free half of this package.
 *
 * The package root registers the view renderers with `ComponentRegistry` when
 * it is evaluated and statically reaches `ObjectView`, which reaches the grid
 * and the form, so a host that imports one pure helper from the root keeps all
 * of them in its own chunk. The console shell imports the helpers below from
 * this subpath instead, and the view renderers load (and register) only when a
 * view is drawn.
 *
 * ⛔ Nothing exported here may import a view component, `./index` or a module
 * that registers, directly or through a neighbour: the subpath is only worth
 * having while its closure stays these pure functions and constants. The same
 * names are still exported from the package root, unchanged. A module added to
 * this file's closure also joins the console's `plugin-view-core` chunk group
 * (`apps/console/vite.config.ts`).
 */

export { deriveRecordSurface, deriveRecordFlowSurface, overlayWidthFor } from './recordSurface';
export type { RecordSurface, RecordFlowSurface } from './recordSurface';
export {
  deriveFieldOptions,
  toFilterGroup,
  isImageLikeField,
  isGeoLikeField,
  pickPreferredField,
  KANBAN_GROUP_PREFERRED,
  PRIMARY_DATE_PREFERRED,
  END_DATE_PREFERRED,
} from './config/view-config-utils';
export type { FieldOption } from './config/view-config-utils';
