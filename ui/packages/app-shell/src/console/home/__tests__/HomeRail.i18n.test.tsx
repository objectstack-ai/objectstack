// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Home rail must not leak English into a localized console: the My-work
 * heading comes from `home.myWork.*` (objectui#12602; the action centre it
 * replaced read `home.actionCenter.*`, which once had no entry in any locale
 * file, so every language fell back to the inline English default) and
 * notification timestamps go through Intl.RelativeTimeFormat instead of the
 * old hand-rolled `${n}d` suffix.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';

import { HomeActionCenter } from '../HomeRail';

const zh = (key: string, opts?: any) =>
  ({
    'home.myWork.title': '我的工作',
    'home.myWork.notifications': '通知',
  })[key] ?? opts?.defaultValue ?? key;

function threeDaysAgo() {
  return new Date(Date.now() - 3 * 86400 * 1000).toISOString();
}

function renderRail() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <HomeActionCenter
        pendingApprovals={[]}
        pendingApprovalsCount={0}
        pendingApprovalsStatus="ready"
        pendingApprovalsReadable
        notificationsReadable
        notifications={[
          { id: 'n1', title: '系统文件已分配给你', createdAt: threeDaysAgo() } as any,
        ]}
        unreadTopicCount={1}
        notificationsStatus="ready"
        onOpenApprovals={() => {}}
        onOpenApproval={() => {}}
        onOpenInbox={() => {}}
        onOpenNotification={() => {}}
        t={zh}
      />
    </I18nProvider>,
  );
}

describe('HomeActionCenter localization', () => {
  it('renders the translated heading rather than the English default', () => {
    renderRail();
    expect(screen.getByText('我的工作')).toBeTruthy();
    expect(screen.queryByText('My work')).toBeNull();
  });

  it('formats the notification timestamp for the active locale', () => {
    renderRail();
    expect(screen.getByText('3天前')).toBeTruthy();
    expect(screen.queryByText('3d')).toBeNull();
  });
});
