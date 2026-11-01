/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28472 — the console list's row Delete (and the selection's)
 * names the objects the delete cascades into, from the served
 * `cascadeDeleteObjects`, by label.
 *
 * The list's `objectDef` comes from the list read, which never serves the key,
 * so the hook reads the by-name schema the adapter carries it on
 * (`dataSource.getObjectSchema`). The data source here hands back exactly what
 * the adapter would: a schema with the served list attached under its symbol.
 * Strings are read from the packs by KEY under a real `I18nProvider`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { attachCascadeDeleteObjects, type ConfirmationHandler } from '@object-ui/core';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { useObjectActions } from '../useObjectActions';

type Pack = {
  objectActions: { deleteConfirm: string; deleteCascade: string };
  console: { objectView: { bulkDeleteConfirm_other: string } };
};
const EN = builtInLocales.en as unknown as Pack;
const ZH = builtInLocales.zh as unknown as Pack;
const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k]));

const LEAD = { name: 'crm_lead', label: 'Lead', fields: { name: { type: 'text' } } };
const LABELS: Record<string, string> = { crm_campaign_member: 'Campaign Member' };
const objectLabelOf = (name: string) => LABELS[name] ?? name;

function Harness({ dataSource, onConfirm }: { dataSource: any; onConfirm: ConfirmationHandler }) {
  const actions = useObjectActions({
    objectName: LEAD.name,
    objectLabel: LEAD.label,
    objectDef: LEAD,
    dataSource,
    onConfirm,
    objectLabelOf,
  });
  return (
    <>
      <button onClick={() => void actions.deleteRecord('l1', { id: 'l1', name: 'Ada' })}>row-delete</button>
      <button onClick={() => void actions.deleteRecords([{ id: 'a' }, { id: 'b' }])}>bulk-delete</button>
    </>
  );
}

/** Mount with a data source whose by-name schema read answers `served`. */
function mount(served: unknown, language: 'en' | 'zh' = 'en') {
  const getObjectSchema = vi.fn(async () =>
    served === 'throw'
      ? Promise.reject(new Error('offline'))
      : attachCascadeDeleteObjects(structuredClone(LEAD), served),
  );
  const dataSource = { delete: vi.fn(async () => ({})), getObjectSchema };
  const onConfirm = vi.fn<ConfirmationHandler>(async () => false);
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/crm/crm_lead']}>
        <Harness dataSource={dataSource} onConfirm={onConfirm} />
      </MemoryRouter>
    </I18nProvider>,
  );
  return { onConfirm, getObjectSchema, dataSource };
}

async function askedMessage(onConfirm: ReturnType<typeof vi.fn>, button: string): Promise<string> {
  fireEvent.click(screen.getByText(button));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  return onConfirm.mock.calls[0][0] as string;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('console row Delete names the cascade objects (objectstack#28472)', () => {
  it('a served list of one object adds one line naming its label', async () => {
    const { onConfirm, getObjectSchema } = mount(['crm_campaign_member']);
    const message = await askedMessage(onConfirm, 'row-delete');
    expect(getObjectSchema).toHaveBeenCalledWith('crm_lead');
    expect(message).toBe(
      `${EN.objectActions.deleteConfirm} ${fill(EN.objectActions.deleteCascade, { objects: 'Campaign Member' })}`,
    );
    expect(message).not.toContain('crm_campaign_member');
  });

  it('the same line in zh', async () => {
    const { onConfirm } = mount(['crm_campaign_member'], 'zh');
    const message = await askedMessage(onConfirm, 'row-delete');
    expect(ZH.objectActions.deleteCascade).not.toBe(EN.objectActions.deleteCascade);
    expect(message).toBe(
      `${ZH.objectActions.deleteConfirm} ${fill(ZH.objectActions.deleteCascade, { objects: 'Campaign Member' })}`,
    );
  });

  it('a served empty list adds nothing', async () => {
    const { onConfirm } = mount([]);
    expect(await askedMessage(onConfirm, 'row-delete')).toBe(EN.objectActions.deleteConfirm);
  });

  it('no served list adds nothing and keeps today\'s text', async () => {
    const { onConfirm } = mount(undefined);
    expect(await askedMessage(onConfirm, 'row-delete')).toBe(EN.objectActions.deleteConfirm);
  });

  it('a failed schema read adds nothing and still asks', async () => {
    const { onConfirm, dataSource } = mount('throw');
    expect(await askedMessage(onConfirm, 'row-delete')).toBe(EN.objectActions.deleteConfirm);
    expect(dataSource.delete).not.toHaveBeenCalled();
  });

  it('a selection gains the same line after the batch question', async () => {
    const { onConfirm } = mount(['crm_campaign_member']);
    const message = await askedMessage(onConfirm, 'bulk-delete');
    expect(message).toBe(
      `${fill(EN.console.objectView.bulkDeleteConfirm_other, { count: 2 })} ${fill(EN.objectActions.deleteCascade, { objects: 'Campaign Member' })}`,
    );
  });
});
