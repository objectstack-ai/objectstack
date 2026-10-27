/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { CSSProperties } from 'react';

/**
 * The host keys a renderer in this package reads BY NAME off its props and
 * hands to its root element (#25918).
 *
 * A renderer's props carry an index signature to `unknown`, not `any`: a key
 * the host forwards is still admitted, but the renderer has to narrow it
 * before it can use it. These three are the exception that is declared rather
 * than narrowed at every site, because they are not authoring keys a renderer
 * interprets — `SchemaRenderer` (`@object-ui/react`) writes `data-obj-id` from
 * the node's `id` and `data-obj-type` from its `type`, and forwards the node's
 * `style` (`BaseSchema.style`) — and every renderer that reads them passes
 * them straight to the DOM.
 *
 * Intersect it into a renderer's props annotation; ⛔ never widen the index
 * signature back to `any` to make a by-name read compile.
 */
export interface RendererHostProps {
  'data-obj-id'?: string;
  'data-obj-type'?: string;
  style?: CSSProperties;
}
