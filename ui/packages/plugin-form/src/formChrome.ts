/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form family's own feedback chrome, resolved through the locale packs
 * (objectui#11039): the success toast a form raises when the author declared
 * no `successMessage`, the note that rides it when a declared
 * `navigateOnSuccess` was refused, the thank-you panel's heading, the loading
 * line, the load-failure heading, and the default submit and cancel labels.
 *
 * These were English literals in `ObjectForm`, `TabbedForm`, `SplitForm` and
 * `MasterDetailForm`, so a zh session saw `Created`, `Loading form...` and
 * `Error loading form` beside a Chinese UI. Every one of them is a DEFAULT: an
 * authored `successMessage`, `submitText`, `cancelText` or thank-you `title`
 * still wins, exactly as before.
 *
 * Since objectui#11071 the table also carries the master-detail form's own
 * chrome (the totals stack, the row editor's title and buttons, the collection
 * placeholder, the in-flight Save label) and `ObjectForm`'s locked-field hint.
 *
 * `WizardForm`, `DrawerForm` and `ModalForm` already had a
 * `createSafeTranslation` hook of their own and carry the rows they need in
 * it; the rows are the same keys, and `pnpm check:i18n-keys` holds every table
 * to the `en` pack, so the copies cannot drift apart.
 */

import { createSafeTranslation } from '@object-ui/i18n';

// Every row must stay byte-identical to the `en` pack value of the same key —
// `pnpm check:i18n-keys` compares this table against it. The table is what a
// provider-less host (a standalone embed, this package's own tests) renders.
const FORM_CHROME_DEFAULTS = {
  'form.create': 'Create',
  'form.update': 'Update',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'form.created': 'Created',
  'form.saved': 'Saved',
  'form.savedNamed': '{{title}} saved',
  'form.errorLoading': 'Error loading form',
  'form.navigateRefused':
    'The `navigateOnSuccess` destination declared for this form was refused, '
    + 'so the navigation did not happen.',
  'publicForm.thankYouTitle': 'Thank you!',
  'publicForm.loading': 'Loading form…',
  // The hint under a field the caller may read but not write (`ObjectForm`).
  'form.deniedDescription': 'You do not have edit access to this field.',
  // The master-detail form's own chrome (objectui#11071). The three verbs at
  // the end are the shared keys `MasterDetailForm` reads for its `Add` /
  // `Close` / in-flight Save labels, not keys of its own.
  'form.masterDetail.loadingColumns': 'Loading columns…',
  'form.masterDetail.subtotal': 'Subtotal',
  'form.masterDetail.tax': 'Tax ({{rate}}%)',
  'form.masterDetail.total': 'Total',
  'form.masterDetail.lineItem': 'Line item',
  'form.masterDetail.rowTitle': '{{title}} — row {{row}}',
  'form.masterDetail.applyRow': 'Apply',
  'detail.add': 'Add',
  'common.close': 'Close',
  'detail.saving': 'Saving…',
  // A collection's three configuration hints (objectui#11160): no
  // `childObject`, a child schema that failed to load, and no field on the
  // child that links it to the parent. Each hole is filled with a property or
  // an object name, rendered as code and never translated.
  'form.masterDetail.noChildObject':
    'This collection has no child object configured: set {{property}} to the object whose rows it lists.',
  'form.masterDetail.schemaUnavailable':
    'Could not load the schema of {{object}}, so this collection has no columns to show. '
    + 'Check that the object exists and is readable, then reload.',
  'form.masterDetail.noRelationshipField':
    'Could not work out how {{object}} links to {{parent}}: no lookup or master_detail field on it '
    + 'references the parent. Set {{property}} on this collection to the field that holds the parent record.',
  // A master-detail collection's heading when it authors no `title`
  // (objectui#11145): the key the record page's `record:line_items` panel
  // reads for its own default title, not a key of the form's own.
  'form.lineItems.title': 'Line Items',
};

/**
 * What the submitter is told when a DECLARED `navigateOnSuccess` produced no
 * destination — objectui#5034 point 2.
 *
 * The write succeeded, so this rides on the success toast as a note rather than
 * becoming an error or a blocking panel: turning a successful write into an
 * error state would be a worse lie than the silence it replaces. What was
 * missing is one fact, and only one: the navigation the author declared did not
 * happen. Before this, the toast was byte-identical to the toast a form with no
 * `navigateOnSuccess` at all produces, so an author who mistyped the destination
 * — or whose record carried no usable id — saw a form that looked entirely
 * healthy and had silently stopped honouring a key they wrote.
 *
 * Maintainer ruling, 2026-08-17: "A refused declared navigation is surfaced: the
 * success toast carries a note that the declared navigation was not performed —
 * never indistinguishable from the no-key case."
 *
 * The note names no REASON on purpose. `resolveSuccessNavigate` answers null for
 * two different causes (no usable id on the written record; a destination the
 * same-origin guard refused) and returns no discriminant, so a reason in this
 * copy could only be re-derived by reimplementing that helper's internals at the
 * call site — where it would drift from the helper, and would additionally bake
 * an acceptance rule into user-visible prose, which objectui#5034 has since
 * narrowed once already. The diagnosable detail — the template the author
 * actually wrote — goes to `console.warn` at each call site instead.
 *
 * The submitter sees it (it is the toast's description), so it is pack key
 * `form.navigateRefused` and each form renders `t('form.navigateRefused')`
 * (objectui#11039). This constant is that key's English default, read from the
 * table above so there is one spelling of it; `WizardForm` re-exports it,
 * because that is where it used to live and where its tests import it from.
 * Single-sourced so a wizard and a flat form cannot tell a submitter two
 * different things about one refusal; a test pins that they do not.
 */
export const NAVIGATE_ON_SUCCESS_REFUSED_NOTE = FORM_CHROME_DEFAULTS['form.navigateRefused'];

/**
 * The form family's feedback chrome. Falls back to the English table above
 * when no i18n provider is mounted, or when the mounted catalogue predates
 * these keys (`form.errorLoading` is the probe).
 */
export const useFormChromeTranslation = createSafeTranslation(
  FORM_CHROME_DEFAULTS,
  'form.errorLoading',
);
