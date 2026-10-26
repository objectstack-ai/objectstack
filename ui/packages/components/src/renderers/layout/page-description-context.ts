/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * The page `description` a titled `page:header` draws under its title
 * (objectui#12624).
 *
 * When an authored `page:header` owns the page's `h1`, the page renderer no
 * longer draws the description in its own heading block, which sat ABOVE the
 * regions and so above the title. It hands the description down here instead,
 * and the header draws it after the title, the order the console page header
 * uses. Every page renderer provides a value (null when it draws the
 * description itself), so a page nested in another never reads the outer
 * page's description.
 */
export const PageDescriptionContext = React.createContext<React.ReactNode>(null);
