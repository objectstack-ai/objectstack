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
  return (
    <CatalogAssignmentPage
      type="position"
      param={POSITION_PARAM}
      testId="setup-position-holders"
      icon={<UserCheck className="h-4 w-4" />}
      copy={{
        title: t('setupAssignments.positionsTitle', { defaultValue: 'Position holders' }),
        subtitle: t('setupAssignments.positionsSubtitle', {
          defaultValue:
            'Pick a position to see who holds it, and add or remove holders. What a position grants is defined on the position itself.',
        }),
        listLabel: t('setupAssignments.positionsList', { defaultValue: 'Positions' }),
        filterPlaceholder: t('setupAssignments.positionsFilter', { defaultValue: 'Filter positions' }),
        emptyTitle: t('setupAssignments.positionsEmptyTitle', { defaultValue: 'No positions' }),
        emptyBody: t('setupAssignments.positionsEmptyBody', { defaultValue: 'No position is defined in this environment yet.' }),
        pick: t('setupAssignments.positionsPick', { defaultValue: 'Pick a position to see its holders.' }),
        loadFailed: t('setupAssignments.positionsLoadFailed', { defaultValue: 'Could not read the positions.' }),
        noMatch: t('setupAssignments.noMatch', { defaultValue: 'Nothing matches the filter.' }),
        notFound: (name) => t('setupAssignments.notFound', { defaultValue: '"{{name}}" is not in this list.', name }),
        retry: t('setupAssignments.retry', { defaultValue: 'Try again' }),
        refresh: t('setupAssignments.refresh', { defaultValue: 'Refresh' }),
      }}
      renderSection={(name) => <PositionHoldersSection name={name} />}
    />
  );
}
