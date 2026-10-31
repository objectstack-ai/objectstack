// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → People & organization → Permission set assignment (ADR-0146 D7):
 * pick a permission set, then list, assign and unassign its users. The list
 * is the registry's `permission` catalog; the users are `AssignedUsersSection`,
 * the section the permission set's own editor renders under its matrix, so
 * the reads (direct grants and holders via a position), the writes, the grant
 * gate on Add / Remove and every server refusal are that section's.
 */

import { Users } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { AssignedUsersSection } from '../metadata-admin/AssignedUsersSection.js';
import { CatalogAssignmentPage } from './CatalogAssignmentPage.js';
import { PERMISSION_SET_PARAM } from './peopleAssignments.js';

export function PermissionSetAssignmentPage() {
  const { t } = useObjectTranslation();
  const k = (key: string, defaultValue: string, vars?: Record<string, string>) =>
    t(`setupAssignments.${key}`, { defaultValue, ...vars });
  return (
    <CatalogAssignmentPage
      type="permission"
      param={PERMISSION_SET_PARAM}
      testId="setup-permission-set-assignment"
      icon={<Users className="h-4 w-4" />}
      copy={{
        title: k('setsTitle', 'Permission set assignment'),
        subtitle: k(
          'setsSubtitle',
          'Pick a permission set to see who holds it, directly or through a position, and assign or unassign users. What a set grants is defined on the set itself.',
        ),
        listLabel: k('setsList', 'Permission sets'),
        filterPlaceholder: k('setsFilter', 'Filter permission sets'),
        emptyTitle: k('setsEmptyTitle', 'No permission sets'),
        emptyBody: k('setsEmptyBody', 'No permission set is defined in this environment yet.'),
        pick: k('setsPick', 'Pick a permission set to see its users.'),
        loadFailed: k('setsLoadFailed', 'Could not read the permission sets.'),
        noMatch: k('noMatch', 'Nothing matches the filter.'),
        notFound: (name) => k('notFound', '"{{name}}" is not in this list.', { name }),
        retry: k('retry', 'Try again'),
        refresh: k('refresh', 'Refresh'),
      }}
      renderSection={(name) => (
        // The bordered box the permission set's editor draws around the same section.
        <div className="mt-6 rounded-md border">
          <AssignedUsersSection permissionSetName={name} />
        </div>
      )}
    />
  );
}
