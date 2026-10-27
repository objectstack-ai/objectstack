/**
 * objectstack#26619 — a `record:quick_actions` action greyed out by its
 * declared `disabled` predicate says the reason its author DECLARED,
 * `disabledReason`. The bar localizes its actions through
 * `useActionTextLocalizer`, so the bundle's sentence at
 * `objects.<object>._actions.<action>.disabledReason` outranks the authored
 * text. "Not available for this record" stays the answer for an action that
 * declares none.
 *
 * The sibling suite (`record-quick-actions.disabledReason-11811.test.tsx`)
 * pins the mechanics; this one pins the text.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { RecordContextProvider } from '@object-ui/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

const DEFAULT_EN = 'Not available for this record';
const DECLARED_EN = 'Finish the checklist before archiving.';
const BUNDLE_ZH = '请先完成检查清单。';

const ARCHIVE = {
  name: 'showcase_archive_task',
  label: 'Archive',
  type: 'script',
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

function mount(action: Record<string, unknown>, record: Record<string, unknown>, zhBundle?: Record<string, unknown>) {
  const node = (
    <RecordContextProvider objectName="showcase_task" recordId="t-1" data={{ id: 't-1', ...record }}>
      <RecordQuickActionsRenderer schema={{ actions: [action], location: 'record_section' } as any} />
    </RecordContextProvider>
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

const archive = () => screen.getByRole('button', { name: 'Archive' });
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

describe('record:quick_actions — the declared reason is the one a greyed action gives (objectstack#26619)', () => {
  it('the declared string is the description and the tooltip', async () => {
    const user = userEvent.setup();
    mount(ARCHIVE, { done: false });
    expect(archive()).toBeDisabled();
    expect(describedBy(archive())).toHaveTextContent(DECLARED_EN);
    expect(archive()).toHaveAccessibleName('Archive');
    await user.hover(archive().parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(DECLARED_EN);
    expect(screen.queryByText(DEFAULT_EN)).toBeNull();
  });

  it("the bundle's sentence outranks the authored text — zh", async () => {
    mount(ARCHIVE, { done: false }, {
      showcase: { objects: { showcase_task: { _actions: { showcase_archive_task: { disabledReason: BUNDLE_ZH } } } } },
    });
    const reason = await screen.findByText(BUNDLE_ZH);
    expect(describedBy(archive())).toBe(reason);
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });

  it('no declared reason: the default stays', () => {
    mount(ARCHIVE_UNDECLARED, { done: false });
    expect(describedBy(archive())).toHaveTextContent(DEFAULT_EN);
  });

  it('control — the predicate does not hold: the declared reason is not shown', () => {
    mount(ARCHIVE, { done: true });
    expect(archive()).not.toBeDisabled();
    expect(archive()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });
});
