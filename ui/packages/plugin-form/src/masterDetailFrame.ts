/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * masterDetailFrame — the package-internal channel through which a host that
 * gives `MasterDetailForm` a frame of fixed height tells it so
 * (objectstack#34819).
 *
 * `MasterDetailForm` owns its Save bar (ADR-0035 Decision §6), and by default
 * pins it with `position: sticky` to whatever scroll frame hosts it: the
 * drawer, the record page. A sticky box stops at its scroller's content edge
 * and leaves its containing block with it, so in a frame that is a box of its
 * own — the record dialog — the bar floated above the dialog's bottom by the
 * scroller's padding, and rose further with any content that ran past the
 * form's root.
 *
 * A host that has such a frame provides a {@link MasterDetailFrame}: the form
 * then fills it as a flex column, scrolls its body in a box of its own, and
 * draws its bar below that box, outside the scrolled content, so the bar sits
 * at the frame's bottom at every scroll position. The host names the classes
 * of both boxes, so its gutters stay its own. With no provider the form keeps
 * the sticky bar.
 *
 * Not re-exported from the package index: no prop or schema key is added to
 * any exported type.
 */

import React from 'react';

export interface MasterDetailFrame {
  /** Classes of the box that scrolls the form's body (padding, container query). */
  bodyClassName: string;
  /** Classes of the action bar below it (padding). */
  actionsClassName: string;
}

export const MasterDetailFrameContext = React.createContext<MasterDetailFrame | null>(null);
