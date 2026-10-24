/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13384 — a single-record action launched from a list toolbar is
 * refused for its row count BEFORE any dialog opens, and the refusal is
 * translatable.
 *
 * Measured on HotCRM's My Leads: "Add to Campaign", a single-record script
 * action with a param, placed in `list_toolbar`. With 0 or 2 rows ticked the
 * param dialog opened and ran to the end (the user picked a campaign, and
 * could even create one), and only after Confirm did the dispatch refuse,
 * in English under zh-CN. The runner ran the param dialog before the handler,
 * and the refusal strings had no pack key.
 *
 * What these pin, through the real runner and the real
 * `createServerActionHandler` with a stubbed transport:
 *  - 0 rows and 2 rows: the refusal toast shows, no param dialog and no
 *    confirmation open, and nothing is sent;
 *  - 1 row: the dialog opens as before and the request carries that row;
 *  - the refusal is asked of the runner's translator by its pack key, with
 *    the English source as its default (the zh-CN words themselves are pinned
 *    in `@object-ui/i18n`'s `recordSelectionRefusal-13384` suite);
 *  - an object-level toolbar action with 0 rows still opens its dialog, and a
 *    handler with its own record resolver (a record page) is not refused.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  ActionRunner,
  type ActionDef,
  type ParamCollectionHandler,
  type ToastHandler,
} from '../ActionRunner';
import { createServerActionHandler, type ServerActionFetch } from '../serverActionHandler';

const MULTI_ROW_REFUSAL = 'This action runs on a single record — select exactly one row.';
const ZERO_ROW_REFUSAL = 'This action runs on a single record — select a row first.';

/** HotCRM's shape: a script action with a param, mounted on rows and on the toolbar. */
const ADD_TO_CAMPAIGN: ActionDef = {
  type: 'script',
  name: 'add_to_campaign',
  objectName: 'crm_lead',
  locations: ['list_toolbar', 'list_item'],
  actionParams: [{ name: 'campaign', label: 'Campaign', type: 'text', required: true }],
};

function okFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { added: 1 } }),
  })) as unknown as ServerActionFetch & Mock;
}

/** A copy per launch: the runner rewrites `params` on the action it runs. */
const launch = (action: ActionDef): ActionDef => JSON.parse(JSON.stringify(action));

describe('objectui#13384 — the row-count refusal comes before the param dialog', () => {
  let toast: Mock<ToastHandler>;
  let dialog: Mock<ParamCollectionHandler>;
  let confirm: Mock<(message: string) => Promise<boolean>>;
  let fetch: ServerActionFetch & Mock;

  function runnerWithRows(rows: Record<string, unknown>[]): ActionRunner {
    const runner = new ActionRunner({ selectedRecords: rows });
    runner.setToastHandler(toast);
    runner.setParamCollectionHandler(dialog);
    runner.setConfirmHandler(confirm);
    runner.registerHandler('script', createServerActionHandler({ fetch }));
    return runner;
  }

  beforeEach(() => {
    toast = vi.fn();
    dialog = vi.fn(async () => ({ campaign: 'cmp_webinar' }));
    confirm = vi.fn(async () => true);
    fetch = okFetch();
  });

  it('0 rows: refuses with the toast, opens no dialog and sends nothing', async () => {
    const result = await runnerWithRows([]).execute(launch(ADD_TO_CAMPAIGN));

    expect(result).toEqual({ success: false, error: ZERO_ROW_REFUSAL });
    expect(dialog).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(ZERO_ROW_REFUSAL, expect.objectContaining({ type: 'error' }));
  });

  it('2 rows: refuses with the toast, opens no dialog and sends nothing', async () => {
    const result = await runnerWithRows([{ id: 'lead_1' }, { id: 'lead_2' }])
      .execute(launch(ADD_TO_CAMPAIGN));

    expect(result).toEqual({ success: false, error: MULTI_ROW_REFUSAL });
    expect(dialog).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(MULTI_ROW_REFUSAL, expect.objectContaining({ type: 'error' }));
  });

  it('a confirmation is not shown either before the refusal', async () => {
    await runnerWithRows([]).execute(launch({ ...ADD_TO_CAMPAIGN, confirmText: 'Add the lead?' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('1 row: the dialog opens, and the one request carries that row and the collected value', async () => {
    const result = await runnerWithRows([{ id: 'lead_1' }]).execute(launch(ADD_TO_CAMPAIGN));

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/actions/crm_lead/add_to_campaign');
    expect(JSON.parse(init.body)).toEqual({ recordId: 'lead_1', params: { campaign: 'cmp_webinar' } });
  });

  it('control — an object-level toolbar action with 0 rows still opens its dialog and dispatches', async () => {
    const result = await runnerWithRows([])
      .execute(launch({ ...ADD_TO_CAMPAIGN, locations: ['list_toolbar'] }));

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('control — a handler with its own record resolver (a record page) is not refused', async () => {
    const runner = new ActionRunner({ selectedRecords: [] });
    runner.setToastHandler(toast);
    runner.setParamCollectionHandler(dialog);
    runner.registerHandler('script', createServerActionHandler({
      fetch,
      resolveRecordId: () => ({ recordId: 'lead_page' }),
    }));

    const result = await runner.execute(launch(ADD_TO_CAMPAIGN));

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body).recordId).toBe('lead_page');
  });

  it('control — a dialog that collects `recordId` itself is not judged before it runs', async () => {
    dialog = vi.fn(async () => ({ recordId: 'lead_typed' }));
    const result = await runnerWithRows([]).execute(launch({
      ...ADD_TO_CAMPAIGN,
      actionParams: [{ name: 'recordId', label: 'Lead', type: 'text', required: true }],
    }));

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body).recordId).toBe('lead_typed');
  });
});

describe('objectui#13384 — the refusal goes through the runner\'s translator by its pack key', () => {
  const ZH: Record<string, string> = {
    'actions.selectRowFirst': 'ZH:selectRowFirst',
    'actions.selectExactlyOneRow': 'ZH:selectExactlyOneRow',
  };

  function translatedRunner(rows: Record<string, unknown>[], toast: Mock<ToastHandler>) {
    const runner = new ActionRunner({ selectedRecords: rows });
    runner.setToastHandler(toast);
    runner.setParamCollectionHandler(vi.fn(async () => ({ campaign: 'cmp_webinar' })));
    runner.registerHandler('script', createServerActionHandler({ fetch: okFetch() }));
    const translate = vi.fn((key: string, options: { defaultValue: string }) => ZH[key] ?? options.defaultValue);
    runner.setTranslator(translate);
    return { runner, translate };
  }

  it("0 rows: asks for 'actions.selectRowFirst' with the English default, and toasts the answer", async () => {
    const toast = vi.fn<ToastHandler>();
    const { runner, translate } = translatedRunner([], toast);

    const result = await runner.execute(launch(ADD_TO_CAMPAIGN));

    expect(translate).toHaveBeenCalledWith('actions.selectRowFirst', { defaultValue: ZERO_ROW_REFUSAL });
    expect(result.error).toBe('ZH:selectRowFirst');
    expect(toast).toHaveBeenCalledWith('ZH:selectRowFirst', expect.objectContaining({ type: 'error' }));
  });

  it("2 rows: asks for 'actions.selectExactlyOneRow' with the English default, and toasts the answer", async () => {
    const toast = vi.fn<ToastHandler>();
    const { runner, translate } = translatedRunner([{ id: 'a' }, { id: 'b' }], toast);

    const result = await runner.execute(launch(ADD_TO_CAMPAIGN));

    expect(translate).toHaveBeenCalledWith('actions.selectExactlyOneRow', { defaultValue: MULTI_ROW_REFUSAL });
    expect(result.error).toBe('ZH:selectExactlyOneRow');
    expect(toast).toHaveBeenCalledWith('ZH:selectExactlyOneRow', expect.objectContaining({ type: 'error' }));
  });

  it('an empty answer from the translator falls back to the English source', async () => {
    const toast = vi.fn<ToastHandler>();
    const { runner } = translatedRunner([], toast);
    runner.setTranslator(() => '');

    const result = await runner.execute(launch(ADD_TO_CAMPAIGN));

    expect(result.error).toBe(ZERO_ROW_REFUSAL);
  });
});
