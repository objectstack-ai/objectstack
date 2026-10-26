// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Add a field the way the Data pillar offers it (objectui#12511).
 *
 * The object header holds no Add field: the action lives where fields are laid
 * out, and both entries open the popover that runs the pillar's one `addField`:
 *
 * - the Records grid's own "+" column, the `grid-add-column` button the grid
 *   draws from its authoring context (`GridFieldAuthoringProvider` hands it
 *   `onAddColumn` only on a writable package). A suite that stubs the grid
 *   draws the same test id from the same context, so its double stands in for
 *   that column;
 * - the Form tab's toolbar in Layout, `form-toolbar` in `ObjectFormDesigner`.
 *
 * Both open the Add field popover (objectui#12516), which asks for the label
 * and type before the field is created; the helpers below fill it.
 *
 * {@link ADD_FIELD_OFFERED} is the id a Records-tab suite reads to ask "is Add
 * field offered here?": the grid draws it exactly when the object is loaded
 * on a writable package.
 */

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '../../metadata-admin/i18n';

/** The Records grid's "+" column; present exactly when Add field is offered there. */
export const ADD_FIELD_OFFERED = 'grid-add-column';

/**
 * What the Add field popover is filled with (objectui#12516). The label is
 * typed into the popover's Label box; the field's api name is the one the
 * pillar derives from it (`New field` → `new_field`). `type`, when given, is
 * the visible name of the type to pick in the popover's Type control; Text is
 * preselected. `apiName`, when given, is typed into the API name box the
 * popover shows when the label derives no free name (objectui#13389).
 */
export interface AddFieldInput {
  label?: string;
  type?: RegExp;
  apiName?: string;
}

/** The label a suite's added field gets when it names none. */
export const ADDED_FIELD_LABEL = 'New field';

/**
 * Fill the open Add field popover and press Create (objectui#12516). Every
 * entry opens the same popover, so this is the step after any of them.
 */
export async function completeAddFieldPopover({ label = ADDED_FIELD_LABEL, type, apiName }: AddFieldInput = {}): Promise<void> {
  const popover = await screen.findByTestId('add-field-popover');
  await userEvent.type(within(popover).getByTestId('add-field-label-input'), label);
  if (apiName) await userEvent.type(within(popover).getByTestId('add-field-api-name-input'), apiName);
  if (type) {
    await userEvent.click(within(popover).getByRole('combobox', { name: t('designer.field.type', 'en') }));
    await userEvent.click(await screen.findByRole('option', { name: type }));
  }
  await userEvent.click(within(popover).getByTestId('add-field-create'));
}

/**
 * Pick the Records grid's "+" column and create the field from the popover it
 * opens. `scope` is the editor whose grid to use when a suite renders more
 * than one.
 */
export async function addFieldFromGrid(scope?: HTMLElement, input?: AddFieldInput): Promise<void> {
  const where = scope ? within(scope) : screen;
  await userEvent.click(await where.findByTestId(ADD_FIELD_OFFERED));
  await completeAddFieldPopover(input);
}

/**
 * Pick Add field on the Form tab's toolbar (Layout) and create the field from
 * the popover it opens. The suite has opened the Form tab already; the
 * toolbar's button carries no test id, so it is read by its English label, the
 * locale these suites render in.
 */
export async function addFieldFromFormToolbar(scope?: HTMLElement, input?: AddFieldInput): Promise<void> {
  const where = scope ? within(scope) : screen;
  const toolbar = await where.findByTestId('form-toolbar');
  await userEvent.click(within(toolbar).getByRole('button', { name: t('engine.studio.data.addField', 'en') }));
  await completeAddFieldPopover(input);
}
