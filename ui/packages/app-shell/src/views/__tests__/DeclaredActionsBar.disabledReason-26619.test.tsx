/**
 * objectstack#26619 — a `DeclaredActionsBar` action greyed out by its declared
 * `disabled` predicate says the reason its author DECLARED, `disabledReason`,
 * resolved off the same localized copy as its label: the bundle's sentence at
 * `objects.<object>._actions.<action>.disabledReason` when there is one, the
 * authored text otherwise. "Not available for this record" stays the answer
 * for an action that declares none.
 *
 * Doubles as the sibling suite (`DeclaredActionsBar.disabledReason-11811.test.tsx`)
 * does: only the action dispatch and the console runtime shell.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

const executeSpy = vi.fn().mockResolvedValue({ success: true });

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAction: () => ({ execute: executeSpy }),
  };
});
vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({ actionProviderProps: {}, dialogs: null }),
}));
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { DeclaredActionsBar } from '../DeclaredActionsBar';

const DEFAULT_EN = 'Not available for this record';
const DECLARED_EN = 'Finish the checklist before archiving.';
const BUNDLE_ZH = '请先完成检查清单。';

const ARCHIVE = {
  name: 'showcase_archive_task',
  type: 'script',
  label: 'Archive',
  locations: ['record_section'],
  disabled: { dialect: 'cel', source: 'has(record.done) && record.done != true' },
  disabledReason: DECLARED_EN,
};
const { disabledReason: _none, ...ARCHIVE_UNDECLARED } = ARCHIVE;

/** Loads a translation bundle into the provider's instance before its children render. */
function WithBundle({ language, bundle, children }: { language: string; bundle: Record<string, unknown>; children: React.ReactNode }) {
  const { i18n } = useObjectTranslation();
  const loaded = React.useRef(false);
  if (!loaded.current) {
    i18n.addResourceBundle(language, 'translation', bundle, true, true);
    loaded.current = true;
  }
  return <>{children}</>;
}

function mount(record: Record<string, unknown>, action: Record<string, unknown> = ARCHIVE, zhBundle?: Record<string, unknown>) {
  const node = (
    <DeclaredActionsBar
      objectName="showcase_task"
      record={{ id: 't-1', ...record }}
      location="record_section"
      actions={[action] as any}
    />
  );
  return render(
    zhBundle ? (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <WithBundle language="zh" bundle={zhBundle}>{node}</WithBundle>
      </I18nProvider>
    ) : (
      node
    ),
  );
}

const archive = () => screen.getByTestId('declared-action-showcase_archive_task');
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

beforeEach(() => executeSpy.mockReset().mockResolvedValue({ success: true }));

describe('DeclaredActionsBar — the declared reason is the one a greyed action gives (objectstack#26619)', () => {
  it('the declared string is the description and the tooltip', async () => {
    const user = userEvent.setup();
    mount({ done: false });
    expect(archive()).toBeDisabled();
    expect(describedBy(archive())).toHaveTextContent(DECLARED_EN);
    expect(archive()).toHaveAccessibleName('Archive');
    await user.hover(archive().parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(DECLARED_EN);
    expect(screen.queryByText(DEFAULT_EN)).toBeNull();
  });

  it("the bundle's sentence outranks the authored text — zh", async () => {
    mount({ done: false }, ARCHIVE, {
      showcase: { objects: { showcase_task: { _actions: { showcase_archive_task: { disabledReason: BUNDLE_ZH } } } } },
    });
    const reason = await screen.findByText(BUNDLE_ZH);
    expect(describedBy(archive())).toBe(reason);
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });

  it('no declared reason: the default stays', () => {
    mount({ done: false }, ARCHIVE_UNDECLARED);
    expect(describedBy(archive())).toHaveTextContent(DEFAULT_EN);
  });

  it('control — the predicate does not hold: the declared reason is not shown', () => {
    mount({ done: true });
    expect(archive()).not.toBeDisabled();
    expect(archive()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });
});
