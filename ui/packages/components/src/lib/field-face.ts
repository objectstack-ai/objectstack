/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The field-face seam (objectui#13216): how a renderer in this package draws
 * a field's value through the READ face the field registry gives it, without
 * importing that registry.
 *
 * ## Why a seam and not an import
 *
 * The registry that answers "which component draws this field's value" is
 * `@object-ui/fields`' (`getCellRenderer(resolveCellRendererType(field))`, the
 * lookup the grid's cells and the lookup previews make). `@object-ui/fields`
 * depends on this package, so importing it here would close a package cycle;
 * `recordPictureUrl` in `renderers/layout/containers.tsx` is held back by the
 * same constraint. So this package owns the slot and the question, and
 * `@object-ui/fields` fills the slot from its entry module when it loads.
 *
 * ## The contract
 *
 * - {@link setFieldReadFaceResolver} installs the one resolver (the last call
 *   wins; `undefined` clears it).
 * - {@link resolveFieldReadFace} asks it for a field's face. `undefined` means
 *   "draw what you drew before": no resolver is installed, the field is
 *   absent, or the resolver has no face of the field's own to offer.
 *
 * A face is answered for the field's DECLARATION, never for a field name or an
 * object: the rule is the registry's, so a caller holds no list of widgets and
 * no name-to-label mapping of its own.
 *
 * The names say READ face on purpose: `@object-ui/app-shell`'s metadata form
 * already exports the bare name, for the union naming which edit control its
 * form draws, and one exported name may have one meaning in this repository.
 *
 * ⚠️ The value is read when a caller renders; installing a resolver does not
 * re-render anything already drawn. Every host measured loads
 * `@object-ui/fields` through a static import before its first render (the
 * console's entry imports `@object-ui/app-shell`, whose entry imports it), so
 * the resolver is in place before the first heading draws. A host that loads
 * `@object-ui/fields` only later draws the stored text until its next render.
 */

import type * as React from 'react';
import type { FieldMetadata } from '@object-ui/types';

/** The props a field face is drawn with: the read-cell shape of the registry. */
export interface FieldReadFaceProps {
  /** The field's stored value on the record. */
  value: unknown;
  /** The field's declaration, as the object's schema carries it. */
  field: FieldMetadata;
  /**
   * The whole record, for a face whose value only means something next to a
   * sibling field (a `dependsOn` declaration reads its siblings from here).
   */
  dependentValues?: Record<string, unknown>;
}

/** A component that draws one field's value. */
export type FieldReadFace = React.ComponentType<FieldReadFaceProps>;

/**
 * Answers the face a field's declaration draws its value with, or `undefined`
 * when the declaration names no face of its own.
 */
export type FieldReadFaceResolver = (field: FieldMetadata) => FieldReadFace | undefined;

let installedResolver: FieldReadFaceResolver | undefined;

/**
 * Install the resolver {@link resolveFieldReadFace} asks. `@object-ui/fields`
 * calls this when its entry module loads; a host has no call to make.
 * `undefined` removes the installed resolver.
 */
export function setFieldReadFaceResolver(resolver: FieldReadFaceResolver | undefined): void {
  installedResolver = resolver;
}

/**
 * The face `field`'s declaration draws its value with, or `undefined` when no
 * resolver is installed, `field` is absent, or the resolver answers none.
 */
export function resolveFieldReadFace(field: FieldMetadata | null | undefined): FieldReadFace | undefined {
  if (!field || !installedResolver) return undefined;
  return installedResolver(field);
}
