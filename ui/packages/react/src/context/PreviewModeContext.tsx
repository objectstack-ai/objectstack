/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { createContext, useContext } from 'react';

/**
 * PreviewModeContext — signals that the subtree is rendered inside a design /
 * metadata preview surface (the Studio canvas, a view/page preview pane) rather
 * than a live runtime route.
 *
 * Overlay form components (DrawerForm, ModalForm) consume this to render their
 * body inline instead of mounting a portalled modal Sheet/Dialog. A modal in a
 * preview escapes the canvas and locks the whole editor — Radix sets body
 * `pointer-events:none` and traps focus while open — which reads as a frozen UI.
 *
 * Defaults to `false`, so live runtime usage (record pages, action modals,
 * the field/object designers) is completely unaffected.
 */
const PreviewModeContext = createContext<boolean>(false);

export const PreviewModeProvider = ({
  value = true,
  children,
}: {
  value?: boolean;
  children: React.ReactNode;
}) => (
  <PreviewModeContext.Provider value={value}>
    {children}
  </PreviewModeContext.Provider>
);

/** True when rendering inside a design / preview surface. Safe outside a provider. */
export const usePreviewMode = (): boolean => useContext(PreviewModeContext);

export { PreviewModeContext };
