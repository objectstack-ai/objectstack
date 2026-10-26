/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Outlet } from 'react-router-dom';
import { BookDataContext, useBookDataFetch } from './use-book-data';

/**
 * Layout route for the docs portal (`/docs/*`). Fetches the book + doc
 * metadata ONCE and shares it with every child route (index, book landing,
 * reader) via context, so navigating within the section doesn't re-fetch and a
 * single page never issues the same request from several components.
 */
export default function DocsLayout() {
  const data = useBookDataFetch();
  return (
    <BookDataContext.Provider value={data}>
      <Outlet />
    </BookDataContext.Provider>
  );
}
