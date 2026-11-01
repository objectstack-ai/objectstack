/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * What a host on a phone hands a record's `page:header` (objectstack#27058).
 *
 * On a phone the header draws no action row: the record's business actions
 * sit in a bar at the bottom of the page, which the host owns. The header
 * still resolves them, through the one resolver it always uses
 * (`PageHeaderActions`), and draws them into the host's bar element in their
 * bar face (`face: 'bar'`). Until the host's element exists, nothing is
 * drawn.
 */
export interface PageHeaderPhoneFace {
  /** The host's bottom bar, the element the header draws its actions into. */
  actionBar: HTMLElement | null;
  /**
   * The line under the record's name when the header declares no `subtitle`
   * of its own: on the console's record page, the record's first two declared
   * text highlights.
   */
  subtitle?: React.ReactNode;
}

/**
 * A host slot, never metadata: no `page:header` key says it, and an authored
 * page cannot put anything here. The console's record page provides it on a
 * phone. `null` (the default) is every other surface, where the header draws
 * its action row exactly as before.
 */
export const PageHeaderPhoneContext = React.createContext<PageHeaderPhoneFace | null>(null);
