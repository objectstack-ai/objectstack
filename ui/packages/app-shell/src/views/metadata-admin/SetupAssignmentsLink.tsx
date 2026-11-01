// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a catalog item's assignments are, drawn in Studio's "All metadata" area
 * in place of the assignment section itself (objectstack ADR-0146 D1 and D7,
 * #28561).
 *
 * Assigning people is Setup's work: D7 gives position holders and
 * permission-set assignment their own Setup pages (N-27), and D1 keeps Studio
 * the developer's surface. So the area does not draw `PositionHoldersSection`
 * or `AssignedUsersSection` under a definition, as Setup's catalog does; it
 * names the Setup page that does, opened on this item.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, UserCheck } from 'lucide-react';
import { Button } from '@object-ui/components';
import { permissionSetAssignmentPagePath, positionHoldersPagePath } from '../setup/peopleAssignments.js';
import { t, useMetadataLocale } from './i18n.js';

export type SetupAssignmentsKind = 'position' | 'permission';

export function SetupAssignmentsLink({
  kind,
  name,
}: {
  /** `position` names the Position holders page, `permission` the Permission set assignment page. */
  kind: SetupAssignmentsKind;
  /** The item the Setup page opens on. */
  name: string;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const href = kind === 'position' ? positionHoldersPagePath(name) : permissionSetAssignmentPagePath(name);
  return (
    <div
      className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
      data-testid={`setup-assignments-link-${kind}`}
    >
      <div className="flex items-center gap-2 text-sm">
        <UserCheck className="h-4 w-4 text-muted-foreground" />
        <span>{t(`engine.studio.area.assignments.${kind}`, locale)}</span>
      </div>
      <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
        <Link to={href}>
          {t('engine.studio.area.assignments.open', locale)}
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}

/** The position editor's environment section under the area: the link, not the holders list. */
export function PositionHoldersSetupLink({ name }: { name: string }): React.ReactElement {
  return <SetupAssignmentsLink kind="position" name={name} />;
}
