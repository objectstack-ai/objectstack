/**
 * objectstack#26619 — a `page:header` action greyed out by its declared
 * `disabled` predicate says the reason its author DECLARED, `disabledReason`,
 * inline and in the ⋯ overflow. The header runs its authored actions through
 * `useActionTextLocalizer`, so the reason is the bundle's sentence at
 * `objects.<object>._actions.<action>.disabledReason` when there is one, and
 * the authored text otherwise. "Not available for this record" stays the
 * answer for an action that declares none.
 *
 * The sibling suite (`page-header-disabledReason-11811.test.tsx`) pins the
 * mechanics and the host-chrome controls; this one pins the text.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
// Registers `page:header` at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../renderers';

const DEFAULT_EN = 'Not available for this record';
const DECLARED_EN = 'Finish the checklist before archiving.';
const BUNDLE_ZH = '请先完成检查清单。';
const DONE_GATE = { dialect: 'cel', source: 'has(record.done) && record.done != true' };

const ARCHIVE = {
  name: 'showcase_archive_task',
  label: 'Archive',
  type: 'script',
  locations: ['record_header'],
  disabled: DONE_GATE,
  disabledReason: DECLARED_EN,
};
const ARCHIVE_MORE = { ...ARCHIVE, name: 'showcase_archive_more', label: 'Archive later', locations: ['record_more'] };
const { disabledReason: _none, ...ARCHIVE_UNDECLARED } = ARCHIVE;

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

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

function mount(actions: Record<string, unknown>[], record: Record<string, unknown>, zhBundle?: Record<string, unknown>) {
  const node = (
    <ActionProvider>
      <RecordContextProvider
        objectName="showcase_task"
        recordId="t-1"
        data={{ id: 't-1', ...record }}
        objectSchema={{ name: 'showcase_task', label: 'Task' }}
      >
        <PageHeader schema={{ type: 'page:header', title: 'Task', actions }} />
      </RecordContextProvider>
    </ActionProvider>
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

const describedBy = (el: Element) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

describe('page:header — the declared reason is the one a greyed action gives (objectstack#26619)', () => {
  it('inline: the declared string is the description and the tooltip', async () => {
    const user = userEvent.setup();
    mount([ARCHIVE], { done: false });
    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button).toBeDisabled();
    expect(describedBy(button)).toHaveTextContent(DECLARED_EN);
    await user.hover(button.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(DECLARED_EN);
    expect(screen.queryByText(DEFAULT_EN)).toBeNull();
  });

  it('overflow: the declared string is the item\'s second line and description', async () => {
    const user = userEvent.setup();
    mount([ARCHIVE_MORE], { done: false });
    await user.click(screen.getByRole('button', { name: /More actions/i }));
    const item = await screen.findByRole('menuitem', { name: 'Archive later' });
    expect(describedBy(item)).toHaveTextContent(DECLARED_EN);
    expect(describedBy(item)).toBeVisible();
  });

  it("the bundle's sentence at `_actions.<action>.disabledReason` outranks the authored text — zh", async () => {
    mount([ARCHIVE], { done: false }, {
      showcase: { objects: { showcase_task: { _actions: { showcase_archive_task: { disabledReason: BUNDLE_ZH } } } } },
    });
    const reason = await screen.findByText(BUNDLE_ZH);
    expect(describedBy(screen.getByRole('button', { name: 'Archive' }))).toBe(reason);
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });

  it('no declared reason: the default stays', () => {
    mount([ARCHIVE_UNDECLARED], { done: false });
    expect(describedBy(screen.getByRole('button', { name: 'Archive' }))).toHaveTextContent(DEFAULT_EN);
  });

  it('control — the predicate does not hold: the declared reason is not shown', () => {
    mount([ARCHIVE], { done: true });
    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });
});
