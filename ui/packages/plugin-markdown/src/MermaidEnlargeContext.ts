/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"

/**
 * The words of a diagram's enlarge control, in the host's language. A host
 * that wants every rendered diagram to open full size (the docs reader)
 * provides them; with no provider a diagram draws no control, as before.
 */
export interface MermaidEnlargeText {
  /** The control's text, e.g. "Enlarge". */
  enlarge: string
  /** The enlarged view's accessible title, e.g. "Diagram". */
  title: string
}

export const MermaidEnlargeContext = React.createContext<MermaidEnlargeText | null>(null)
