/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, useContext } from 'react';
import type { PagePrint } from '@objectstack/spec/ui';

/**
 * PrintPageContext — the `print` declaration of the page this subtree renders
 * in, or `null` outside a print page (objectui#11958, card ② of the ruling of
 * record on objectstack#8346).
 *
 * A page that declares `print` is a document: its blocks come from the spec's
 * printable block subset (`PRINTABLE_PAGE_COMPONENT_TYPES` in
 * `@objectstack/spec/ui`), and each of those blocks has to reach paper WHOLE.
 * Most of them already do. The ones that draw a window of their data on screen
 * read this context to stop doing so silently: `record:line_items` names its
 * row cap when the cap cut lines off, and a collapsible `record:details`
 * section draws open, because a closed section never reaches paper.
 *
 * Published by `PageRenderer` (`@object-ui/components`) for a page whose
 * `print` is an object. The value is the declaration itself, so a block that
 * ever needs one of its keys reads it from here rather than from a second
 * channel. Defaults to `null`, so every page that does not declare `print` is
 * untouched.
 */
const PrintPageContext = createContext<PagePrint | null>(null);

export const PrintPageProvider = PrintPageContext.Provider;

/** The enclosing page's `print` declaration, or `null` outside a print page. Safe outside a provider. */
export const usePrintPage = (): PagePrint | null => useContext(PrintPageContext);

export { PrintPageContext };
