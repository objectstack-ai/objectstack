/**
 * objectstack#27521 row 5 — a Setup header tag (Admin config, Platform
 * schema, System-managed, Identity) explains itself in a tooltip, and that
 * explanation is reachable from the keyboard: the tag takes focus, and focus
 * opens the tooltip as hover does.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@object-ui/i18n';
import { ManagedByBadge } from '../ManagedByBadge';

describe('ManagedByBadge — the explanation is reachable from the keyboard (objectstack#27521)', () => {
  it('Tab focuses the tag and opens its explanation', async () => {
    render(<ManagedByBadge managedBy="config" />);
    const badge = screen.getByTestId('managed-by-badge');
    expect(screen.queryByRole('tooltip')).toBeNull();

    await userEvent.tab();
    expect(badge).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Administrator configuration');
  });

  it('CONTROL: a platform object draws no tag, so there is nothing to focus', async () => {
    render(<ManagedByBadge managedBy="platform" />);
    expect(screen.queryByTestId('managed-by-badge')).toBeNull();
  });
});

/**
 * objectstack#30337 item 1 — a team an admin made in Setup carries the
 * `better-auth` tag, and its note read 「由身份提供方管理」 / "Managed by the
 * identity provider": to its maker that says the row came from somewhere else
 * and is not theirs to change. The bucket is right (the identity service owns
 * the table and every write goes through it); the words were not. The note
 * now says what holds for every such object, a hand-made team included: the
 * built-in identity service writes the rows, and this page's actions are how
 * to change them.
 */
describe('ManagedByBadge — the identity note is true of a team made here (objectstack#30337)', () => {
  const openNote = async () => {
    await userEvent.tab();
    return (await screen.findByRole('tooltip')).textContent ?? '';
  };

  it('English: names the built-in identity service and the page\'s actions, not an outside provider', async () => {
    render(<ManagedByBadge managedBy="better-auth" />);
    const note = await openNote();
    expect(note).toContain('Written through the built-in identity service');
    expect(note).toContain('the actions on this page');
    expect(note).not.toContain('identity provider');
  });

  it('Chinese: the same note, from the zh pack', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ManagedByBadge managedBy="better-auth" />
      </I18nProvider>,
    );
    const note = await openNote();
    expect(note).toContain('经内置身份服务写入');
    expect(note).toContain('本页上的操作');
    expect(note).not.toContain('身份提供方');
  });
});

/**
 * objectstack#30208 row 9 — the Setup list header tags read 「管理配置」,
 * 「平台架构」 and 「身份」: the engine's names for how an object is built, which
 * tell an administrator nothing until they open the tooltip. Each tag now says
 * what it means for them: configure it here, built in but editable, written
 * through the identity service.
 */
describe('ManagedByBadge — the tag word speaks to an administrator (objectstack#30208)', () => {
  const tagText = (managedBy: string, language?: string) => {
    const tag = language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <ManagedByBadge managedBy={managedBy} />
      </I18nProvider>
    ) : (
      <ManagedByBadge managedBy={managedBy} />
    );
    const { unmount } = render(tag);
    const text = screen.getByTestId('managed-by-badge').textContent;
    unmount();
    return text;
  };

  it('Chinese: config, system-data and better-auth read what the administrator can do', () => {
    expect(tagText('config', 'zh')).toBe('在此配置');
    expect(tagText('system-data', 'zh')).toBe('平台预置 · 可编辑');
    expect(tagText('better-auth', 'zh')).toBe('经身份服务写入');
  });

  it('English: the same three tags', () => {
    expect(tagText('config')).toBe('Configured here');
    expect(tagText('system-data')).toBe('Built in · editable');
    expect(tagText('better-auth')).toBe('Via identity service');
  });

  it('CONTROL: the tags the walkthrough did not name keep their words', () => {
    expect(tagText('engine-owned', 'zh')).toBe('系统管理');
    expect(tagText('append-only', 'zh')).toBe('只读 · 审计日志');
  });
});
