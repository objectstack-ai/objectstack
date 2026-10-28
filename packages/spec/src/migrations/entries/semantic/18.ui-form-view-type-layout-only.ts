// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #27155 (ADR-0050 Accepted by ruling 6464210455 on #27032, letter A′) — the
// D3 entry of the `form-view-presentation-types-removed` family: one entry for
// the three retired `FormViewSchema.type` members and the three split-only keys
// tombstoned with them, because they leave for one reason — `type` is the
// form's layout, and where a form opens belongs to whoever opens it. The keys
// (`ui/FormSection:pane`, `ui/FormView:splitSize`, `ui/FormView:splitResizable`)
// are registered in RETIRED_KEYS_BY_MAJOR; the members are values, so they are
// not. #27159 (same ruling, the renderer half) widened it before 18.3.0 shipped:
// `ui/FormView:splitDirection` and the `object-form` page block's `split` value,
// `splitDirection`, `splitSize`, `splitResizable` and section `pane` left too,
// while the block keeps `drawer` and `modal` — the block renderer is the caller
// that opens its form in a drawer or dialog.
export const entry: SemanticMigration = {
  id: 'ui-form-view-type-layout-only',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code span.
  surface:
    "view.form.type and view.formViews.<key>.type — the values 'split', 'drawer' and 'modal' left "
    + "FormViewSchema.type ('simple', 'tabbed' and 'wizard' are unchanged, 'simple' stays the default); "
    + 'view.form.sections[].pane, view.form.splitDirection, view.form.splitSize and view.form.splitResizable '
    + 'were removed with them; on an object-form page block the value \'split\' and the props '
    + 'splitDirection, splitSize, splitResizable and sections[].pane left too (its \'drawer\' and '
    + '\'modal\' stay)',
  replacement:
    'the form\'s layout: delete the retired value for the `simple` default, or write `tabbed` (one tab '
    + 'per section) or `wizard`. Where the form opens is the caller\'s: a list opens a clicked record in '
    + 'the drawer by default (`navigation.mode`), the console\'s New and Edit dialogs open the record form '
    + 'themselves (sized by `modalSize`), and an action `type: \'modal\'` opens the page it targets. A '
    + 'record beside its list is a reader\'s own preference in the list\'s Display menu; child records '
    + 'edited beside the parent are `subforms`, and on a page that is an `object-master-detail-form` '
    + 'block. An `object-form` block that opened in a drawer or dialog keeps its `drawer` or `modal` '
    + '`formType` — the block is the caller that opens it',
  reason:
    'ADR-0050: `type` held two orthogonal dimensions — the form\'s internal layout and the container it '
    + 'opens in — plus a view mode, so a dialog holding a tabbed form was inexpressible and the three '
    + 'presentation values duplicated the open modes the callers already declare. The D2 conversion '
    + '`form-view-presentation-types-removed` makes each stored or existing source parse: it DELETES a '
    + 'retired member, which lands the form on the `simple` default, and strips `pane`, `splitDirection`, '
    + '`splitSize` and `splitResizable` (on an `object-form` page block it deletes `formType: \'split\'` '
    + 'and strips the same keys). What it cannot decide is the layout a former `split` form should take (`tabbed` '
    + 'keeps its sections apart, `simple` stacks them), and how the caller of a former `drawer` or `modal` '
    + 'form should now open it',
  acceptanceCriteria:
    'No form view declares `type` `split`, `drawer` or `modal`, and no form view section declares `pane`, '
    + 'nor a form view `splitDirection`, `splitSize` or `splitResizable`; no `object-form` page block '
    + 'declares `formType` `split`, `splitDirection`, `splitSize`, `splitResizable` or a section `pane`; each is refused at parse with its prescription, and '
    + 'TypeScript rejects each at a `FormView` position. Every form the conversion changed renders in the '
    + 'layout its author chose, and every entry point that opened it as a drawer or dialog still opens it '
    + 'that way through its own open mode.',
  conversionIds: ['form-view-presentation-types-removed'],
};
