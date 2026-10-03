// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — four members of the `object-form` page block were `z.unknown()`
// although the form reads each with a fixed shape, so an off-shape value passed
// the component-props gate and the form fell back or ignored it in silence. The
// row now takes the form view's own `submitBehavior` by reference and the
// measured shape for `contentLayout`, `navigateOnSuccess` and `mobile`. The
// form's `fields` and `sections` and the master-detail form's two are held at
// `z.unknown()` (the form draws a `{ name }` field entry and an inline runtime
// field inside a section, which the typed shapes would refuse), and
// `customFields` waits for the spec to declare objectui's runtime form field.
// D3 only: page-component `properties` is not parsed on the metadata save or
// load path, so a stored page is never refused; an off-shape value has no
// rewrite that says what the author meant; and the authored census found no
// authored value to respell — the refused values are fixtures probing that the
// form refuses them.
export const entry: SemanticMigration = {
  id: 'ui-object-form-members-typed',
  surface: 'page `object-form` components — `properties.contentLayout`, `.submitBehavior`, '
    + '`.navigateOnSuccess` and `.mobile` (which used to accept any value)',
  replacement: 'the shape the form reads: `contentLayout` `\'simple\'` or `\'tabbed\'`; `submitBehavior` the '
    + 'form view\'s own block — `{ kind: \'thank-you\', title?, message? }`, `{ kind: \'redirect\', url, '
    + 'delayMs? }` with a relative `url`, `{ kind: \'continue\' }` or `{ kind: \'next-record\' }`; '
    + '`navigateOnSuccess` a relative path string; `mobile` `{ stickyActions?, stepper?, stepperMinFields?, '
    + 'stepperFieldsPerStep?, fullscreenLongText? }`, with `stepper` `true`, `false` or `\'auto\'` and the two '
    + 'counts positive integers. Write a `submitBehavior` `kind` as one of the four; move a `redirect` '
    + 'destination to a relative path; write `heading` as `title`.',
  reason: 'The form reads these members with one shape, and the page-component row declared them '
    + '`z.unknown()`, so any value passed the component-props gate and the form answered an off-shape one '
    + 'with a silent default: a `submitBehavior` `kind` it does not know fell through to the thank-you panel; '
    + 'a misspelled `contentLayout` such as `\'tabs\'` stacked the sections; a `navigateOnSuccess` that is not a '
    + 'string threw after the record was written, so the submit reported a failure; and a `mobile` member it '
    + 'does not read, or a `stepper` outside `true` / `false` / `\'auto\'`, was ignored. The row now takes '
    + 'the form view\'s own `submitBehavior` by reference — the block the renderers already judge a redirect '
    + '`url` through — so one value is judged the same way on the form view and the block, and the measured '
    + 'shape for the other three. The form\'s `fields` and `sections` and the master-detail form\'s two stay '
    + 'open, because the form draws a `{ name }` field entry and an inline runtime field inside a section, '
    + 'which the typed shapes would refuse; and `customFields` stays open until the spec declares the '
    + 'runtime form field its entries are. It is read where every page component\'s props are: the '
    + 'component-props gate reports a refused value as an advisory `component-props-invalid` / '
    + '`component-props-unknown-key` finding on `objectstack validate`, `objectstack build` and '
    + '`objectstack lint`, and a stored page still saves and loads, because a page component\'s '
    + '`properties` is not parsed on the metadata save or load path. No conversion is registered: nothing '
    + 'on the load path refuses the shape, and an off-shape value has no rewrite that both keeps what the '
    + 'form shows today and honours what the author wrote — which is the judgment this entry leaves to the '
    + 'upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-form` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under the four members\' paths. '
    + 'Each form that set one of them now shows it: the post-submit behaviour it names, the modal\'s tabbed '
    + 'sections, the navigation after a save, and the phone presentation.',
};
