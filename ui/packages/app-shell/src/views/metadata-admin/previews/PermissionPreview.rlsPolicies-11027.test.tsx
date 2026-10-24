// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11027: the Studio permission preview lists each row-level security
 * policy with its `label` and `description`.
 *
 * Before this card `PermissionPreview` read `rowLevelSecurity` for one thing,
 * the count on its header pill, so a policy's authored `label` and
 * `description` reached no human anywhere in Studio.
 *
 * Both keys are plain `string` in the spec's RLS policy schema (not
 * `I18nLabel`), so there is no locale-map case to pin here.
 *
 * The cases:
 *   - authored: each policy's label and description render in its own row;
 *   - absent: a policy with neither renders its `name` and nothing else, and a
 *     set with no policies renders no policy list;
 *   - a set whose only grants are policies still lists them, instead of the
 *     "grant at least one permission" empty state;
 *   - the list's heading is designer chrome, read in the designer `locale`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '../i18n';
import { PermissionPreview } from './PermissionPreview';

afterEach(cleanup);

function renderSet(draft: Record<string, unknown>, locale = 'en-US') {
  return render(
    <PermissionPreview type="permission" name="sales_rep" draft={{ name: 'sales_rep', ...draft }} locale={locale} />,
  );
}

/** The policy list item that shows `text`. */
function policyItem(text: string): HTMLElement {
  const item = screen.getByText(text).closest('li');
  expect(item, `no policy list item shows ${JSON.stringify(text)}`).not.toBeNull();
  return item as HTMLElement;
}

const OBJECTS = { account: { allowRead: true } };

describe('PermissionPreview lists each RLS policy with its label and description (objectui#11027)', () => {
  it('shows an authored label and description, and nothing for a policy without them', () => {
    renderSet({
      objects: OBJECTS,
      rowLevelSecurity: [
        {
          name: 'own_accounts',
          label: 'Reps see their own accounts',
          description: 'Owner-scoped read access for the sales team',
          object: 'account',
          operation: 'select',
          using: 'owner_id == current_user.id',
        },
        { name: 'tenant_wall', object: '*', operation: 'all', using: 'tenant_id == current_user.tenant_id' },
      ],
    });

    const authored = policyItem('Reps see their own accounts');
    expect(authored.textContent).toContain('own_accounts');
    expect(authored.textContent).toContain('Owner-scoped read access for the sales team');
    // Absent: the policy's name is all its row carries, with no stand-in text.
    expect(policyItem('tenant_wall').textContent).toBe('tenant_wall');
  });

  it('renders no policy list for a set with no policies', () => {
    renderSet({ objects: OBJECTS });
    expect(screen.queryByText(t('perm.rls.title', 'en-US'))).toBeNull();
    expect(document.querySelector('li')).toBeNull();
  });

  it('lists the policies of a set whose only grants are policies', () => {
    renderSet({
      objects: {},
      rowLevelSecurity: [
        { name: 'published_only', label: 'Published rows only', object: 'article', operation: 'select', using: 'published == true' },
      ],
    });
    expect(screen.queryByText(t('engine.permissionPreview.empty', 'en-US'))).toBeNull();
    expect(policyItem('Published rows only').textContent).toContain('published_only');
  });

  it('reads the list heading in the designer locale', () => {
    const zh = t('perm.rls.title', 'zh-CN');
    expect(zh, 'a missing zh row echoes the key back').not.toBe('perm.rls.title');
    expect(zh).not.toBe(t('perm.rls.title', 'en-US'));

    renderSet(
      { objects: OBJECTS, rowLevelSecurity: [{ name: 'own_accounts', object: 'account', operation: 'select', using: 'true' }] },
      'zh-CN',
    );
    expect(screen.getByText(zh)).toBeTruthy();
  });
});
