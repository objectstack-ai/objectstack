/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { PaginationSchema } from '@object-ui/types';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '../../ui/pagination';
import { createSafeTranslation } from '@object-ui/i18n';
import React from 'react';

/**
 * objectui#12145 — the previous / next links' accessible names. The Shadcn
 * primitives hard-code English ones (`ui/pagination.tsx` is a No-Touch zone,
 * AGENTS.md commandment #7), and spread `props` after them, so this call site
 * names them instead. The keys are the data table pager's (objectui#12124), the
 * same two names; the rows are the `en` pack's values, served when no
 * `I18nProvider` is mounted.
 */
const usePaginationTranslation = createSafeTranslation(
  {
    'table.previousPage': 'Previous page',
    'table.nextPage': 'Next page',
  },
  'table.previousPage',
);

ComponentRegistry.register('pagination', 
  ({ schema, ...props }: { schema: PaginationSchema; [key: string]: any }) => {
    const { t } = usePaginationTranslation();
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        onPageChange,
        ...paginationProps
    } = props;
    
    // `currentPage` is the one spelling (objectui#6152): the `page` fallback this
    // read used to carry is retired on both faces of `@object-ui/types`.
    const currentPage = schema.currentPage || 1;
    const totalPages = schema.totalPages || 1;
    
    const handlePageChange = (page: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (page === currentPage) return;
      if (page < 1 || page > totalPages) return;
      
      if (onPageChange) {
        onPageChange(page);
      }
    };

    const getPageNumbers = () => {
      if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
      }
      
      if (currentPage <= 3) {
        return [1, 2, 3, 4, 5, -1, totalPages];
      }
      
      if (currentPage >= totalPages - 2) {
        return [1, -1, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
      }
      
      return [1, -1, currentPage - 1, currentPage, currentPage + 1, -1, totalPages];
    };
    
    return (
      <Pagination 
        className={schema.className} 
        {...paginationProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious 
              href="#" 
              aria-label={t('table.previousPage')}
              onClick={(e) => handlePageChange(currentPage - 1, e)}
              className={currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              aria-disabled={currentPage <= 1}
            />
          </PaginationItem>
          {getPageNumbers().map((page, idx) => (
            <PaginationItem key={idx}>
              {page === -1 ? (
                <PaginationEllipsis />
              ) : (
                <PaginationLink 
                  href="#" 
                  isActive={page === currentPage}
                  onClick={(e) => handlePageChange(page, e)}
                  className="cursor-pointer"
                >
                  {page}
                </PaginationLink>
              )}
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext 
              href="#" 
              aria-label={t('table.nextPage')}
              onClick={(e) => handlePageChange(currentPage + 1, e)}
              className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              aria-disabled={currentPage >= totalPages}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  },
  {
    namespace: 'ui',
    label: 'Pagination',
    inputs: [
      { name: 'currentPage', type: 'number' },
      { name: 'totalPages', type: 'number' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      currentPage: 1,
      totalPages: 10
    }
  }
);
