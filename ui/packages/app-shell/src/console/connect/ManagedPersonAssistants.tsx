// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An administrator's view of the AI assistants one person authorized, with a
 * confirm-first Revoke on each — the SDUI widget `mcp:authorized-assistants`,
 * for a `sys_user` record page.
 *
 * It reads one thing from the page: the bound record (`useRecordContext()`),
 * which must be a `sys_user` record with an id. It takes no props. Outside such
 * a record (the Studio palette, another object's page) it renders nothing.
 *
 * The rows, the Revoke and its confirm are `AuthorizedAssistantsSection`'s,
 * pointed at the person: `oauth.authorizedClients.listForUser(userId)` and
 * `withdrawForUser(userId, id)`. Those are the platform-admin doors; anyone
 * else is refused 403 by the server, and the section shows that as a failed
 * read rather than an empty list.
 */

import { Card, CardContent } from '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';
import { useRecordContext } from '@object-ui/react';
import { AuthorizedAssistantsSection } from './AuthorizedAccessList.js';

/** The object whose record pages this widget belongs on. */
export const MANAGED_PERSON_OBJECT = 'sys_user';

export function ManagedPersonAssistants() {
  const { t } = useObjectTranslation();
  const record = useRecordContext();
  const userId = record?.objectName === MANAGED_PERSON_OBJECT && record.recordId ? record.recordId : null;
  if (!userId) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <p className="text-sm text-muted-foreground">{t('connectAgent.access.managedBody')}</p>
        <AuthorizedAssistantsSection forUserId={userId} />
      </CardContent>
    </Card>
  );
}

// SDUI registration: a `sys_user` record page names this widget by type.
ComponentRegistry.register('mcp:authorized-assistants', () => <ManagedPersonAssistants />, {
  namespace: 'app-shell',
  label: 'Authorized AI Assistants',
  category: 'plugin',
  inputs: [],
});
