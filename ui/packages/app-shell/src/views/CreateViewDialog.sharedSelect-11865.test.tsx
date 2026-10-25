// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Create View dialog's config picks are the shared `Select`
 * (objectui#11865).
 *
 * Each pick a view type asks for (kanban's group-by field, the date and title
 * fields, gallery's cover, map's coordinates, tree's parent, and the chart's
 * type, dataset, measure and dimension) was a browser-native select, beside
 * the shared Radix `Select` the rest of the console picks with. The card asks
 * for one control for one kind of choice, surface by surface.
 *
 * What is pinned:
 *   - each pick IS the primitive (a Radix combobox trigger); no native select
 *     is left in the dialog;
 *   - each trigger keeps the name its row's `<label htmlFor>` gave the native
 *     control, and still announces `aria-required`;
 *   - each picker lists the options the native control listed, in its order,
 *     and shows the same pick when the dialog opens;
 *   - every option of every picker leads to the `onCreate` payload the native
 *     control led to, compared as JSON text, the "select a field" placeholder
 *     (value `''`, which leaves Create disabled) included;
 *   - a held field the object no longer has is what the trigger shows;
 *   - a picker with nothing to offer yet is the primitive's disabled trigger
 *     (objectui#11781) and does not open;
 *   - the keyboard alone opens a picker and selects.
 *
 * DIRECTION, observed against the native control: every pin here but the name
 * pin is red there, because each one reads the pick as the primitive's
 * trigger. What makes the write rows guards of "the conversion changed nothing
 * the dialog writes" is the literal each compares against: a `change` event on
 * the pre-conversion dialog's native control, then Create, led to that same
 * payload, read once on that dialog with these fixtures. The names, the
 * option lists and the held-field reading were taken there the same way.
 *
 * One reading differs by construction and is pinned on its own: re-picking
 * the dataset already held. The read forced a `change` for it, which clears
 * the measure; a browser fires no `change` for the option already selected,
 * and the primitive calls no `onValueChange` for it, so nothing is cleared.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within, act } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

/** Two served datasets over THIS object (so none is picked for the user) and one over another. */
const DEAL_METRICS = {
  name: 'deal_metrics',
  label: 'Deal metrics',
  object: 'crm_deal',
  dimensions: [{ name: 'stage', label: 'Stage', field: 'stage' }],
  measures: [
    { name: 'total_amount', label: 'Total amount', aggregate: 'sum', field: 'amount' },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
  ],
};
const DEAL_TOTALS = {
  name: 'deal_totals',
  object: 'crm_deal',
  dimensions: [],
  measures: [{ name: 'pipeline_value', aggregate: 'sum', field: 'amount' }],
};
const ACCOUNT_METRICS = {
  name: 'account_metrics',
  label: 'Account metrics',
  object: 'crm_account',
  dimensions: [{ name: 'industry', field: 'industry' }],
  measures: [{ name: 'account_count', aggregate: 'count' }],
};
const SERVED = [DEAL_METRICS, DEAL_TOTALS, ACCOUNT_METRICS];

/** The metadata wire: `GET …/meta/dataset` lists the served documents, `GET …/meta/dataset/NAME` answers one. */
function wire() {
  return vi.fn(async (input: string) => {
    const path = new URL(input, 'http://localhost').pathname;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/meta/dataset')) return json(SERVED);
    const one = path.match(/\/meta\/dataset\/([^/]+)$/);
    if (one) {
      const doc = SERVED.find((d) => d.name === decodeURIComponent(one[1]));
      return json(doc ?? null, doc ? 200 : 404);
    }
    return json({ data: [] });
  });
}
/** One client per test, as `useMetadataClient` memoises one per mount. */
let client: MetadataClient;

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { CreateViewDialog } from './CreateViewDialog';

/** An object with at least two eligible fields for every field pick. */
const DEAL = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    subject: { type: 'text', label: 'Subject' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
    priority: { type: 'select', label: 'Priority', options: [{ value: 'high', label: 'High' }] },
    is_won: { type: 'boolean', label: 'Won' },
    start_date: { type: 'date', label: 'Start date' },
    end_date: { type: 'date', label: 'End date' },
    cover_image: { type: 'image', label: 'Cover image' },
    website: { type: 'url', label: 'Website' },
    latitude: { type: 'number', label: 'Latitude' },
    office_lat: { type: 'number', label: 'Office lat' },
    longitude: { type: 'number', label: 'Longitude' },
    office_lng: { type: 'number', label: 'Office lng' },
    parent: { type: 'lookup', label: 'Parent deal', reference: 'crm_deal' },
    account: { type: 'master_detail', label: 'Account', reference: 'crm_account' },
    amount: { type: 'number', label: 'Amount' },
  },
};

/** What `t()` answers with no i18n provider: the key itself. */
const SELECT_FIELD = 'console.objectView.selectField';
const SELECT_OPTION = 'console.objectView.selectOption';

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
const picker = (key: string) => screen.getByTestId(`create-view-required-${key}`);
const submit = () => screen.getByTestId('create-view-submit') as HTMLButtonElement;

/** Open the dialog on DEAL and pick the view type `type`, once its card is offered. */
async function openType(type: string, onCreate = vi.fn((_config: unknown) => true), objectDef: typeof DEAL = DEAL) {
  const utils = render(<CreateViewDialog open onOpenChange={() => {}} onCreate={onCreate} objectDef={objectDef} />);
  await waitFor(() => expect((screen.getByTestId(`create-view-type-${type}`) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId(`create-view-type-${type}`));
  await settle();
  return { ...utils, onCreate };
}

/** Open `key`'s picker from the keyboard and return the options it lists, in order. */
async function openPicker(key: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(picker(key), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

/** The labels `key`'s picker lists, in order; the picker is closed again after. */
async function optionLabels(key: string): Promise<string[]> {
  const labels = (await openPicker(key)).map((o) => o.textContent ?? '');
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  return labels;
}

/** Pick the option labelled `label` in `key`'s picker, once that picker is enabled. */
async function pick(key: string, label: string): Promise<void> {
  await waitFor(() => expect(picker(key)).toBeEnabled());
  const options = await openPicker(key);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`no "${label}" in ${key}: ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  await settle();
}

/** Press Create and return the payload as JSON text, or `null` when Create is disabled. */
async function create(onCreate: ReturnType<typeof vi.fn>): Promise<string | null> {
  if (submit().disabled) return null;
  fireEvent.click(submit());
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  return JSON.stringify(onCreate.mock.calls[0][0]);
}

beforeEach(() => {
  cleanup();
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: wire() as unknown as typeof fetch });
});

describe('the config picks are the shared Select (objectui#11865)', () => {
  it('renders each pick as the Radix combobox trigger; no native select is left in the dialog', async () => {
    await openType('gantt');
    for (const key of ['startDateField', 'endDateField', 'titleField']) {
      expect(picker(key).tagName).toBe('BUTTON');
      expect(picker(key)).toHaveAttribute('role', 'combobox');
    }
    expect(screen.getByTestId('create-view-dialog').querySelectorAll('select')).toHaveLength(0);
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it.each([
    ['kanban', 'groupByField', 'console.objectView.groupByField'],
    ['map', 'latitudeField', 'console.objectView.latitudeField'],
    ['chart', 'dataset', 'console.objectView.dataset'],
  ])('%s %s keeps the name its label gave the native control, and aria-required', async (type, key, name) => {
    await openType(type);
    expect(screen.getByRole('combobox', { name })).toBe(picker(key));
    expect(picker(key)).toHaveAttribute('id', `create-view-required-${key}`);
    expect(picker(key)).toHaveAttribute('aria-required', 'true');
  });
});

/**
 * [type, key, the option shown, disabled, the options listed in order], as the
 * native control showed and listed them when the type was picked.
 */
const INITIAL: ReadonlyArray<readonly [string, string, string, boolean, readonly string[]]> = [
  ['kanban', 'groupByField', 'Stage', false, ['console.objectView.selectField', 'Stage', 'Priority', 'Won', 'Parent deal', 'Account']],
  ['calendar', 'startDateField', 'Start date', false, ['console.objectView.selectField', 'Start date', 'End date']],
  ['calendar', 'titleField', 'Name', false, ['console.objectView.selectField', 'Name', 'Subject', 'Cover image', 'Website']],
  ['timeline', 'startDateField', 'Start date', false, ['console.objectView.selectField', 'Start date', 'End date']],
  ['timeline', 'titleField', 'Name', false, ['console.objectView.selectField', 'Name', 'Subject', 'Cover image', 'Website']],
  ['gantt', 'startDateField', 'Start date', false, ['console.objectView.selectField', 'Start date', 'End date']],
  ['gantt', 'endDateField', 'End date', false, ['console.objectView.selectField', 'Start date', 'End date']],
  ['gantt', 'titleField', 'Name', false, ['console.objectView.selectField', 'Name', 'Subject', 'Cover image', 'Website']],
  ['gallery', 'coverField', 'Cover image', false, ['console.objectView.selectField', 'Cover image', 'Website']],
  ['map', 'latitudeField', 'Latitude', false, ['console.objectView.selectField', 'Latitude', 'Office lat']],
  ['map', 'longitudeField', 'Longitude', false, ['console.objectView.selectField', 'Longitude', 'Office lng']],
  ['chart', 'chartType', 'console.objectView.chartTypeBar', false, ['console.objectView.selectOption', 'console.objectView.chartTypeBar', 'console.objectView.chartTypeLine', 'console.objectView.chartTypePie', 'console.objectView.chartTypeArea', 'console.objectView.chartTypeScatter']],
  ['chart', 'dataset', 'console.objectView.selectOption', false, ['console.objectView.selectOption', 'Deal metrics (deal_metrics)', 'deal_totals']],
  ['chart', 'values', 'console.objectView.selectOption', true, ['console.objectView.selectOption']],
  ['tree', 'parentField', 'Parent deal', false, ['console.objectView.selectField', 'Parent deal', 'Account']],
];

describe('each picker lists what the native control listed, and shows the same pick', () => {
  it.each(INITIAL)('%s %s', async (type, key, shown, disabled, labels) => {
    await openType(type);
    // A chart's dataset picker waits, disabled, for the catalog it lists.
    await waitFor(() => {
      expect(picker(key)).toHaveTextContent(shown);
      if (!disabled) expect(picker(key)).toBeEnabled();
    });
    if (disabled) {
      // The primitive's disabled trigger: Radix marks it `data-disabled`.
      expect(picker(key)).toBeDisabled();
      expect(picker(key)).toHaveAttribute('data-disabled');
      return;
    }
    expect(await optionLabels(key)).toEqual(labels);
  });
});

/**
 * [type, the picks made first, key, the option picked, the JSON text of the
 * `onCreate` payload]. `null`: Create stays disabled. The picks made first are
 * the chart's binding a member pick needs (a dataset, then a measure).
 */
const WRITES: ReadonlyArray<
  readonly [type: string, pre: ReadonlyArray<readonly [string, string]>, key: string, option: string, json: string | null]
> = [
  ['kanban', [], 'groupByField', 'console.objectView.selectField', null],
  ['kanban', [], 'groupByField', 'Stage', '{"type":"kanban","label":"console.objectView.viewTypeKanban 1","name":"console_objectview_viewtypekanban_1","kanban":{"groupByField":"stage"}}'],
  ['kanban', [], 'groupByField', 'Priority', '{"type":"kanban","label":"console.objectView.viewTypeKanban 1","name":"console_objectview_viewtypekanban_1","kanban":{"groupByField":"priority"}}'],
  ['kanban', [], 'groupByField', 'Won', '{"type":"kanban","label":"console.objectView.viewTypeKanban 1","name":"console_objectview_viewtypekanban_1","kanban":{"groupByField":"is_won"}}'],
  ['kanban', [], 'groupByField', 'Parent deal', '{"type":"kanban","label":"console.objectView.viewTypeKanban 1","name":"console_objectview_viewtypekanban_1","kanban":{"groupByField":"parent"}}'],
  ['kanban', [], 'groupByField', 'Account', '{"type":"kanban","label":"console.objectView.viewTypeKanban 1","name":"console_objectview_viewtypekanban_1","kanban":{"groupByField":"account"}}'],
  ['calendar', [], 'startDateField', 'console.objectView.selectField', null],
  ['calendar', [], 'startDateField', 'Start date', '{"type":"calendar","label":"console.objectView.viewTypeCalendar 1","name":"console_objectview_viewtypecalendar_1","calendar":{"startDateField":"start_date","titleField":"name"}}'],
  ['calendar', [], 'startDateField', 'End date', '{"type":"calendar","label":"console.objectView.viewTypeCalendar 1","name":"console_objectview_viewtypecalendar_1","calendar":{"startDateField":"end_date","titleField":"name"}}'],
  ['calendar', [], 'titleField', 'console.objectView.selectField', null],
  ['calendar', [], 'titleField', 'Name', '{"type":"calendar","label":"console.objectView.viewTypeCalendar 1","name":"console_objectview_viewtypecalendar_1","calendar":{"startDateField":"start_date","titleField":"name"}}'],
  ['calendar', [], 'titleField', 'Subject', '{"type":"calendar","label":"console.objectView.viewTypeCalendar 1","name":"console_objectview_viewtypecalendar_1","calendar":{"startDateField":"start_date","titleField":"subject"}}'],
  ['calendar', [], 'titleField', 'Cover image', '{"type":"calendar","label":"console.objectView.viewTypeCalendar 1","name":"console_objectview_viewtypecalendar_1","calendar":{"startDateField":"start_date","titleField":"cover_image"}}'],
  ['calendar', [], 'titleField', 'Website', '{"type":"calendar","label":"console.objectView.viewTypeCalendar 1","name":"console_objectview_viewtypecalendar_1","calendar":{"startDateField":"start_date","titleField":"website"}}'],
  ['timeline', [], 'startDateField', 'console.objectView.selectField', null],
  ['timeline', [], 'startDateField', 'Start date', '{"type":"timeline","label":"console.objectView.viewTypeTimeline 1","name":"console_objectview_viewtypetimeline_1","timeline":{"startDateField":"start_date","titleField":"name"}}'],
  ['timeline', [], 'startDateField', 'End date', '{"type":"timeline","label":"console.objectView.viewTypeTimeline 1","name":"console_objectview_viewtypetimeline_1","timeline":{"startDateField":"end_date","titleField":"name"}}'],
  ['timeline', [], 'titleField', 'console.objectView.selectField', null],
  ['timeline', [], 'titleField', 'Name', '{"type":"timeline","label":"console.objectView.viewTypeTimeline 1","name":"console_objectview_viewtypetimeline_1","timeline":{"startDateField":"start_date","titleField":"name"}}'],
  ['timeline', [], 'titleField', 'Subject', '{"type":"timeline","label":"console.objectView.viewTypeTimeline 1","name":"console_objectview_viewtypetimeline_1","timeline":{"startDateField":"start_date","titleField":"subject"}}'],
  ['timeline', [], 'titleField', 'Cover image', '{"type":"timeline","label":"console.objectView.viewTypeTimeline 1","name":"console_objectview_viewtypetimeline_1","timeline":{"startDateField":"start_date","titleField":"cover_image"}}'],
  ['timeline', [], 'titleField', 'Website', '{"type":"timeline","label":"console.objectView.viewTypeTimeline 1","name":"console_objectview_viewtypetimeline_1","timeline":{"startDateField":"start_date","titleField":"website"}}'],
  ['gantt', [], 'startDateField', 'console.objectView.selectField', null],
  ['gantt', [], 'startDateField', 'Start date', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"start_date","endDateField":"end_date","titleField":"name"}}'],
  ['gantt', [], 'startDateField', 'End date', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"end_date","endDateField":"end_date","titleField":"name"}}'],
  ['gantt', [], 'endDateField', 'console.objectView.selectField', null],
  ['gantt', [], 'endDateField', 'Start date', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"start_date","endDateField":"start_date","titleField":"name"}}'],
  ['gantt', [], 'endDateField', 'End date', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"start_date","endDateField":"end_date","titleField":"name"}}'],
  ['gantt', [], 'titleField', 'console.objectView.selectField', null],
  ['gantt', [], 'titleField', 'Name', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"start_date","endDateField":"end_date","titleField":"name"}}'],
  ['gantt', [], 'titleField', 'Subject', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"start_date","endDateField":"end_date","titleField":"subject"}}'],
  ['gantt', [], 'titleField', 'Cover image', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"start_date","endDateField":"end_date","titleField":"cover_image"}}'],
  ['gantt', [], 'titleField', 'Website', '{"type":"gantt","label":"console.objectView.viewTypeGantt 1","name":"console_objectview_viewtypegantt_1","gantt":{"startDateField":"start_date","endDateField":"end_date","titleField":"website"}}'],
  ['gallery', [], 'coverField', 'console.objectView.selectField', null],
  ['gallery', [], 'coverField', 'Cover image', '{"type":"gallery","label":"console.objectView.viewTypeGallery 1","name":"console_objectview_viewtypegallery_1","gallery":{"coverField":"cover_image"}}'],
  ['gallery', [], 'coverField', 'Website', '{"type":"gallery","label":"console.objectView.viewTypeGallery 1","name":"console_objectview_viewtypegallery_1","gallery":{"coverField":"website"}}'],
  ['map', [], 'latitudeField', 'console.objectView.selectField', null],
  ['map', [], 'latitudeField', 'Latitude', '{"type":"map","label":"console.objectView.viewTypeMap 1","name":"console_objectview_viewtypemap_1","map":{"latitudeField":"latitude","longitudeField":"longitude"}}'],
  ['map', [], 'latitudeField', 'Office lat', '{"type":"map","label":"console.objectView.viewTypeMap 1","name":"console_objectview_viewtypemap_1","map":{"latitudeField":"office_lat","longitudeField":"longitude"}}'],
  ['map', [], 'longitudeField', 'console.objectView.selectField', null],
  ['map', [], 'longitudeField', 'Longitude', '{"type":"map","label":"console.objectView.viewTypeMap 1","name":"console_objectview_viewtypemap_1","map":{"latitudeField":"latitude","longitudeField":"longitude"}}'],
  ['map', [], 'longitudeField', 'Office lng', '{"type":"map","label":"console.objectView.viewTypeMap 1","name":"console_objectview_viewtypemap_1","map":{"latitudeField":"latitude","longitudeField":"office_lng"}}'],
  ['tree', [], 'parentField', 'console.objectView.selectField', null],
  ['tree', [], 'parentField', 'Parent deal', '{"type":"tree","label":"console.objectView.viewTypeTree 1","name":"console_objectview_viewtypetree_1","tree":{"parentField":"parent"}}'],
  ['tree', [], 'parentField', 'Account', '{"type":"tree","label":"console.objectView.viewTypeTree 1","name":"console_objectview_viewtypetree_1","tree":{"parentField":"account"}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'chartType', 'console.objectView.selectOption', null],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'chartType', 'console.objectView.chartTypeBar', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_metrics","values":["total_amount"],"dimensions":["stage"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'chartType', 'console.objectView.chartTypeLine', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"line","dataset":"deal_metrics","values":["total_amount"],"dimensions":["stage"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'chartType', 'console.objectView.chartTypePie', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"pie","dataset":"deal_metrics","values":["total_amount"],"dimensions":["stage"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'chartType', 'console.objectView.chartTypeArea', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"area","dataset":"deal_metrics","values":["total_amount"],"dimensions":["stage"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'chartType', 'console.objectView.chartTypeScatter', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"scatter","dataset":"deal_metrics","values":["total_amount"],"dimensions":["stage"]}}'],
  ['chart', [], 'dataset', 'console.objectView.selectOption', null],
  ['chart', [], 'dataset', 'Deal metrics (deal_metrics)', null],
  ['chart', [], 'dataset', 'deal_totals', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_totals","values":["pipeline_value"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Deals']], 'dataset', 'console.objectView.selectOption', null],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Deals']], 'dataset', 'deal_totals', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_totals","values":["pipeline_value"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)']], 'values', 'console.objectView.selectOption', null],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)']], 'values', 'Total amount', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_metrics","values":["total_amount"],"dimensions":["stage"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)']], 'values', 'Deals', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_metrics","values":["deal_count"],"dimensions":["stage"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'dimensions', 'console.objectView.selectOption', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_metrics","values":["total_amount"]}}'],
  ['chart', [['dataset', 'Deal metrics (deal_metrics)'], ['values', 'Total amount']], 'dimensions', 'Stage', '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_metrics","values":["total_amount"],"dimensions":["stage"]}}'],
];

describe('every option writes what the native control wrote', () => {
  it.each(WRITES.map((row) => [`${row[0]} ${row[1].map(([k, l]) => `${k}=${l}, `).join('')}${row[2]} → ${row[3]}`, ...row] as const))(
    '%s',
    async (_name, type, pre, key, option, json) => {
      const { onCreate } = await openType(type);
      for (const [k, label] of pre) await pick(k, label);
      await pick(key, option);
      expect(picker(key)).toHaveTextContent(option);
      expect(await create(onCreate)).toBe(json);
    },
  );

  it('re-picking the dataset already held writes nothing: the measure picked from it stays', async () => {
    const { onCreate } = await openType('chart');
    await pick('dataset', 'Deal metrics (deal_metrics)');
    await pick('values', 'Deals');
    await pick('dataset', 'Deal metrics (deal_metrics)');
    expect(picker('values')).toHaveTextContent('Deals');
    expect(await create(onCreate)).toBe(
      '{"type":"chart","label":"console.objectView.viewTypeChart 1","name":"console_objectview_viewtypechart_1","chart":{"chartType":"bar","dataset":"deal_metrics","values":["deal_count"],"dimensions":["stage"]}}',
    );
  });
});

describe('a held value no option carries is what the trigger shows', () => {
  it('a group-by field the object no longer has: shown, and written by Create as held', async () => {
    const { onCreate, rerender } = await openType('kanban');
    await waitFor(() => expect(picker('groupByField')).toHaveTextContent('Stage'));
    const { stage: _dropped, ...rest } = DEAL.fields;
    rerender(<CreateViewDialog open onOpenChange={() => {}} onCreate={onCreate} objectDef={{ ...DEAL, fields: rest as typeof DEAL.fields }} />);
    await settle();
    // The native control showed the placeholder here while Create wrote `stage`.
    expect(picker('groupByField')).toHaveTextContent('stage');
    expect(await optionLabels('groupByField')).toEqual(['stage', SELECT_FIELD, 'Priority', 'Won', 'Parent deal', 'Account']);
    expect(await create(onCreate)).toBe(
      '{"type":"kanban","label":"console.objectView.viewTypeKanban 1","name":"console_objectview_viewtypekanban_1","kanban":{"groupByField":"stage"}}',
    );
  });
});

describe('a picker with nothing to offer yet is disabled through the primitive (objectui#11781)', () => {
  it('the chart measure, before a dataset is picked: disabled, and the keyboard does not open it', async () => {
    await openType('chart');
    expect(picker('values')).toBeDisabled();
    expect(picker('values')).toHaveAttribute('data-disabled');
    expect(picker('values').textContent).toBe(SELECT_OPTION);
    fireEvent.keyDown(picker('values'), { key: 'ArrowDown' });
    fireEvent.keyDown(picker('values'), { key: 'Enter' });
    await settle();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('a group-by pick on an object with no field to group by: disabled, with the refusal beside it', async () => {
    render(
      <CreateViewDialog
        open
        onOpenChange={() => {}}
        onCreate={vi.fn()}
        objectDef={{ name: 'crm_note', fields: { body: { type: 'text', label: 'Body' } } } as unknown as typeof DEAL}
        availableTypes={['kanban']}
      />,
    );
    await settle();
    expect(picker('groupByField')).toBeDisabled();
    expect(picker('groupByField')).toHaveAttribute('data-disabled');
    expect(picker('groupByField').textContent).toBe(SELECT_FIELD);
    expect(screen.getByTestId('create-view-error-no-field-groupByField')).toHaveTextContent('console.objectView.noEligibleFieldForType');
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens a picker and Enter on an option selects it', async () => {
    const { onCreate } = await openType('kanban');
    fireEvent.keyDown(picker('groupByField'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Priority' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(picker('groupByField')).toHaveTextContent('Priority');
    expect(await create(onCreate)).toBe(
      '{"type":"kanban","label":"console.objectView.viewTypeKanban 1","name":"console_objectview_viewtypekanban_1","kanban":{"groupByField":"priority"}}',
    );
  });
});
