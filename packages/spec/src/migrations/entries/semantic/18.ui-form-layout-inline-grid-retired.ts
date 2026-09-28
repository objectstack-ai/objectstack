// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The family's one D3 entry (the per-family house rule: a retirement family
// gets a semantic entry even when its D2 conversion is lossless). The D2 half
// is `form-layout-inline-grid-to-vertical`; this entry carries the one
// judgement the chain cannot make — whether a form that said `grid` wanted
// more than one column and never declared how many.
export const entry: SemanticMigration = {
  id: 'ui-form-layout-inline-grid-retired',
  surface:
    'form `layout` — the `object-form` page component (`ObjectFormPropsSchema.layout`) and the '
    + 'form view (`FormViewSchema.layout`: `view.form`, `view.formViews.*`, a form view item\'s '
    + '`config`, a flattened form overlay): the `inline` and `grid` arms (REMOVED)',
  replacement:
    "`layout: 'vertical' | 'horizontal'`, or no `layout` at all ('vertical' is the renderer "
    + 'default). A multi-column form is `columns` (e.g. `columns: 2`), which the renderer honours '
    + "under either layout — it was never a layout value. 'grid' → 'vertical' and 'inline' → "
    + "'vertical', with any `columns` beside them kept as authored.",
  reason:
    'Both surfaces declared `vertical | horizontal | inline | grid`, and no renderer ever gave '
    + '`inline` or `grid` a behaviour of its own. Measured at the objectui pin `f8a9d0fb0`: the '
    + 'simple `object-form` arm folds both to `vertical` under a comment saying exactly that, the '
    + 'drawer and modal arms pass only `vertical` / `horizontal` through, and the tabbed, split '
    + 'and wizard sub-forms hard-code `vertical` — so both values parsed green at the spec door '
    + 'and rendered as the default. The spec admitted them from two declarations (the designer '
    + 'palette and the registry inputs), never from a read. The maintainer\'s ADR-0049 family '
    + 'criterion asks whether mainstream platforms have the capability — if they do, build the '
    + 'consumer once, correctly; if they do not, retire the key — and not whether anything in this '
    + 'repository reads it. Multi-column, the capability `grid` names, is one they have, and this '
    + 'spec already carries it under another key, `columns`; `inline` is a toolbar / filter-row '
    + 'pattern, not a record-form layout. So the two arms are redundant vocabulary rather than a '
    + 'missing consumer, and are retired with no alias window. The mechanical '
    + 'rewrite is the ADR-0087 D2 conversion `form-layout-inline-grid-to-vertical` (retired from '
    + 'the load path — both enums refuse the two values at parse with a per-value prescription; '
    + 'stored rows and assembled artifacts replay clean). It is behaviour-preserving: the '
    + 'rewritten form renders exactly as before. What it cannot decide is whether an author who '
    + 'wrote `grid` without `columns` wanted a multi-column form they never got — that form '
    + 'always rendered single-column, and only the author knows whether that was the intent.',
  acceptanceCriteria:
    "No authored `object-form` component or form view carries `layout: 'inline' | 'grid'`; "
    + '`objectstack validate` passes. For every form that was rewritten from `grid`, decide '
    + 'whether it should be multi-column: if so, author `columns` with the count you meant (the '
    + 'rewrite never invents one); if not, the rewritten `vertical` — or deleting `layout` — is '
    + 'already what the form rendered.',
};
