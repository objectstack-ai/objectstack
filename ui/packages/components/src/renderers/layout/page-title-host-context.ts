/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * The host draws the page's title and description above the page
 * (objectstack#36111): the console's page route puts the page in its page
 * header (name left, the shell's button group right), as a dashboard's name
 * sits in the header and not in the dashboard.
 *
 * It is a host switch, never metadata: no page key says it. While a host sets
 * it, the page renderer draws neither its implicit title nor the page
 * description, and an authored `page:header` with a title draws that title as
 * an `h2` (the host's header holds the one `h1`, objectui#3434). What the
 * author wrote is drawn as written otherwise. `false` (the default) is the
 * page as it was.
 *
 * The page renderer reads it once and turns it off for everything inside the
 * page, so a page nested in this one (a record drawer opened from it) draws
 * its own title.
 */
export const PageTitleHostContext = React.createContext<boolean>(false);

/**
 * Inside a page whose host owns its title: whether an authored `page:header`
 * draws its title one level down. Provided by the page renderer from
 * {@link PageTitleHostContext}, read by `page:header`; not exported.
 */
export const PageTitleDemotedContext = React.createContext<boolean>(false);
