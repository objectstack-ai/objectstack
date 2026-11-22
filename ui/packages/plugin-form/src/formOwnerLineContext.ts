/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The host's opt-in to the edit form's read-only owner line (objectstack#35403),
 * and the action it draws beside the owner. Side-effect free, so a console
 * shell provides it through `@object-ui/plugin-form/core` without loading the
 * form renderers; the line itself is `FormOwnerLine` in `./formOwnerLine`.
 */

import { createContext, type ReactNode } from 'react';

/** What the host's action is handed: the record the form read, and its object. */
export interface FormOwnerActionTarget {
  objectName: string;
  recordId: string;
  /** The record as the form read it (its `owner_id` included). */
  record: Record<string, unknown>;
  /** The object definition the form was laid out from. */
  objectSchema: Record<string, unknown>;
}

/** A host's opt-in to the owner line, and the action it draws beside the owner. */
export interface FormOwnerLineHost {
  renderAction: (target: FormOwnerActionTarget) => ReactNode;
}

/** Unprovided, no edit form draws the owner line. */
export const FormOwnerLineContext = createContext<FormOwnerLineHost | null>(null);
