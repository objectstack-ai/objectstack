// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → People & organization → Position holders (ADR-0146 D7): pick a
 * position, then list, add and remove its holders. The list is the registry's
 * `position` catalog; the holders are `PositionHoldersSection`, the section
 * the position's own item page renders, so the reads, the writes, the grant
 * gate on Add / Remove and every server refusal are that section's.
 */

import { UserCheck } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { PositionHoldersSection } from '../metadata-admin/PositionHoldersSection.js';
import { CatalogAssignmentPage } from './CatalogAssignmentPage.js';
import { POSITION_PARAM } from './peopleAssignments.js';

export function PositionHoldersPage() {
  const { t } = useObjectTranslation();
  const k = (key: string, defaultValue: string, vars?: Record<string, string>) =>
    t(`setupAssignments.${key}`, { defaultValue, ...vars });
  return (
    <CatalogAssignmentPage
      type="position"
      param={POSITION_PARAM}
      testId="setup-position-holders"
      icon={<UserCheck className="h-4 w-4" />}
      copy={{
        title: k('positionsTitle', 'Position holders'),
        subtitle: k(
          'positionsSubtitle',
          'Pick a position to see who holds it, and add or remove holders. What a position grants is defined on the position itself.',
        ),
        listLabel: k('positionsList', 'Positions'),
        filterPlaceholder: k('positionsFilter', 'Filter positions'),
        emptyTitle: k('positionsEmptyTitle', 'No positions'),
        emptyBody: k('positionsEmptyBody', 'No position is defined in this environment yet.'),
        pick: k('positionsPick', 'Pick a position to see its holders.'),
        loadFailed: k('positionsLoadFailed', 'Could not read the positions.'),
        noMatch: k('noMatch', 'Nothing matches the filter.'),
        notFound: (name) => k('notFound', '"{{name}}" is not in this list.', { name }),
        retry: k('retry', 'Try again'),
        refresh: k('refresh', 'Refresh'),
      }}
      renderSection={(name) => <PositionHoldersSection name={name} />}
    />
  );
}
