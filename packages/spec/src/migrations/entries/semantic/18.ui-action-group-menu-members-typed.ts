// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — each member of the `action:group` / `action:menu` page blocks'
// `actions` was an open record: the container draws and runs the member itself,
// and the spec declared none of its keys. The maintainer ruled on #21704 (fork
// 5, letter A): the measured read set, `action:button`'s keys keyed by `type`,
// with the rows' prescriptions; `outcomeMessages`, a member `className` and
// `properties.params` refused; `outcomeMessages` undeclared on all four action
// blocks. D3 only: page-component `properties` is not parsed on the metadata
// save or load path, so a stored page is never refused; and the authored census
// found no working member to respell — the refused values are objectui's probes
// of the very reads the ruling refuses (a member `className`, `outcomeMessages`,
// `properties.params`) and of the host's `autoTrigger` flag.
export const entry: SemanticMigration = {
  id: 'ui-action-group-menu-members-typed',
  surface: 'page `action:group` and `action:menu` components — each member of `properties.actions` (whose keys '
    + 'used to pass unjudged)',
  replacement: 'an inline action with `action:button`\'s keys, its executor spelled `type`: `{ name?, label?, '
    + 'icon?, type?, variant?, visible?, disabled?, tags?, params?, description?, target?, openIn?, method?, '
    + 'bodyExtra?, bodyShape?, operation?, patch?, confirmText?, successMessage?, errorMessage?, refreshAfter?, '
    + 'locations?, toast?, resultDialog?, onSuccess?, objectName? }`, plus `size?` on an `action:group` member. '
    + 'Write `actionType` as `type`, `endpoint` (and `url` / `path` / `href`) as `target`, `enabled` as `disabled` '
    + 'with the condition inverted, and `outcomeMessages` as one `successMessage`; drop a member `className`, '
    + '`properties`, `autoTrigger`, `undoable`, `recordIdField` and an `action:menu` member\'s `size`.',
  reason: 'An `action:group` or `action:menu` draws and runs each member itself: it draws `label` (or `name`), '
    + '`icon`, `variant`, `tags` and, on a group\'s inline buttons, `size`; gates the member on `visible` and '
    + '`disabled`; places it by `locations`; and forwards its `type` and the rest of `action:button`\'s keys to the '
    + 'action runner. The page-component rows declared each member an open record, so a misspelled key, a '
    + 'node-style `actionType` or an `endpoint` no `api` handler reads passed the component-props gate, and the '
    + 'container drew and ran the member without it. The rows now take a closed member: `action:button`\'s keys '
    + 'by `type`, with the rows\' prescriptions; the keys the rows leave undecided — `outcomeMessages`, a member '
    + '`className`, a member `properties.params` — are refused, and `outcomeMessages` stays undeclared on all four '
    + 'action blocks as one decision. It is read where every page component\'s props are: the component-props '
    + 'gate reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` '
    + 'finding on `objectstack validate`, `objectstack build` and `objectstack lint`, and a stored page still saves '
    + 'and loads, because a page component\'s `properties` is not parsed on the metadata save or load path. No '
    + 'conversion is registered: nothing on the load path refuses the shape, and the authored census found no '
    + 'working member to respell. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `action:group` and `action:menu` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.actions`. Each member '
    + 'is drawn with its label, icon and variant, and runs the executor its `type` names.',
};
