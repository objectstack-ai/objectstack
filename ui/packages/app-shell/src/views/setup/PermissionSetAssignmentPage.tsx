// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → People & organization → Permission set assignment (ADR-0146 D7):
 * pick a permission set, then list, assign and unassign its users. The list
 * is the registry's `permission` catalog; the users are `AssignedUsersSection`,
 * the section the permission set's own editor renders under its matrix, so
 * the reads (direct grants and holders via a position), the writes, the grant
 * gate on Add / Remove and every server refusal are that section's.
 *
 * objectstack#32537 — a name more than one package holds is listed once per
 * holder, and the picked holder's package rides in the link (`?package=`) and
 * is handed to the section, which reads and grants that holder's set.
 */

import { Users } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { AssignedUsersSection } from '../metadata-admin/AssignedUsersSection.js';
import { CatalogAssignmentPage } from './CatalogAssignmentPage.js';
import { PERMISSION_SET_PACKAGE_PARAM, PERMISSION_SET_PARAM } from './peopleAssignments.js';

export function PermissionSetAssignmentPage() {
  const { t } = useObjectTranslation();
  return (
    <CatalogAssignmentPage
      type="permission"
      param={PERMISSION_SET_PARAM}
      holderParam={PERMISSION_SET_PACKAGE_PARAM}
      testId="setup-permission-set-assignment"
      icon={<Users className="h-4 w-4" />}
      copy={{
        title: t('setupAssignments.setsTitle', { defaultValue: 'Permission set assignment' }),
        subtitle: t('setupAssignments.setsSubtitle', {
          defaultValue:
            'Pick a permission set to see who holds it, directly or through a position, and assign or unassign users. What a set grants is defined on the set itself.',
        }),
        listLabel: t('setupAssignments.setsList', { defaultValue: 'Permission sets' }),
        filterPlaceholder: t('setupAssignments.setsFilter', { defaultValue: 'Filter permission sets' }),
        emptyTitle: t('setupAssignments.setsEmptyTitle', { defaultValue: 'No permission sets' }),
        emptyBody: t('setupAssignments.setsEmptyBody', { defaultValue: 'No permission set is defined in this environment yet.' }),
        pick: t('setupAssignments.setsPick', { defaultValue: 'Pick a permission set to see its users.' }),
        loadFailed: t('setupAssignments.setsLoadFailed', { defaultValue: 'Could not read the permission sets.' }),
        noMatch: t('setupAssignments.noMatch', { defaultValue: 'Nothing matches the filter.' }),
        notFound: (name) => t('setupAssignments.notFound', { defaultValue: '"{{name}}" is not in this list.', name }),
        retry: t('setupAssignments.retry', { defaultValue: 'Try again' }),
        refresh: t('setupAssignments.refresh', { defaultValue: 'Refresh' }),
        holder: (packageId) =>
          packageId === null
            ? t('setupAssignments.setsHolderEnvironment', { defaultValue: 'This environment’s own set' })
            : t('setupAssignments.setsHolderPackage', { defaultValue: 'Package {{package}}', package: packageId }),
      }}
      renderSection={(name, entry) => (
        // The bordered box the permission set's editor draws around the same section.
        <div className="mt-6 rounded-md border">
          <AssignedUsersSection permissionSetName={name} holding={entry.holding} />
        </div>
      )}
    />
  );
}
