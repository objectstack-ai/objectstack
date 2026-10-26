/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isConfigBag } from '@object-ui/react';

/**
 * The config bag an `element:*` renderer reads — THE one definition of it in
 * `@object-ui/components` (objectui#6783).
 *
 * Per spec, element components carry their config in `schema.properties`;
 * `schema.props` is tolerated as the legacy alias so JSON written either way
 * works. `properties` wins a contested key — the 2026-08-18 cross-channel
 * ruling (objectui#5123), whose spread order is preserved here verbatim and
 * pinned by `packages/components/src/__tests__/alias-precedence-cross-channel.test.tsx`.
 *
 * ## The third channel (objectui#6783)
 *
 * This body used to be copied into five renderer modules — `elements.tsx`,
 * `data-list.tsx`, `text-input.tsx`, `record-picker.tsx`,
 * `metadata-viewer.tsx` — each spelling the two halves as
 * `(schema?.properties ?? {}) as T`. `??` only replaces `null`/`undefined`, so
 * a DEGENERATE bag (a string, a number, an array) went straight into the
 * object spread and was re-read as its own indexed keys: for
 * `properties: 'not-a-bag'` the bag a renderer received was
 * `{ '0': 'n', '1': 'o', … '8': 'g' }` — nine keys nobody authored.
 *
 * That is the same hazard objectui#6752 and objectui#6760 closed in
 * `packages/react/src/SchemaRenderer.tsx` on the two channels UPSTREAM of this
 * one (the `props` evaluation memo plus `propsWithoutCanonicalKeys`, and the
 * `properties` hoist). Those guards do not reach here, and are not meant to:
 * what they buy is that the AUTHORED value's shape survives into the node, so
 * a renderer downstream still receives `schema.properties === 'not-a-bag'` and
 * gets to answer the question for itself. The three channels are in SERIES.
 *
 * ## Why it asks `isConfigBag` rather than carrying its own predicate
 *
 * Because a copy that DRIFTS produces no error — each spelling is a boolean
 * expression, so two channels answering "is this a real config bag?"
 * differently is silent by construction. objectui#6761 ended that inside
 * `@object-ui/react` by converging six occurrences behind one exported
 * definition and pinning it (`utils/configBag.pin.test.ts` fails on a seventh
 * spelling); `@object-ui/components` depends on `@object-ui/react` — every one
 * of the five modules above already imports from it — so the reachable answer
 * here is to READ that definition, not to write the seventh spelling one
 * package over where its pin cannot see it.
 *
 * ## What the guard buys, measured
 *
 * Not a rendered pixel, on today's tree: all five renderers read NAMED keys
 * off this bag, and the one onward spread (`metadata-viewer`'s
 * `<StateMachineView {...props} />`) hands them to components that destructure
 * named fields, so the indexed keys were computed and then discarded. What it
 * buys is the same thing objectui#6752 measured its own guard buys — the
 * authored value's shape is not reinterpreted — one channel further down,
 * which is exactly the property that stops mattering only until the first of
 * these five spreads its bag onto a DOM element.
 */
export function readProps<T extends Record<string, any>>(schema: any): T {
  // A degenerate bag contributes NO keys, on either side. This does not move
  // objectui#5123's precedence: that rule decides which of two co-present
  // values a key carries, and a degenerate bag declares no key for either bag
  // to win — the indices were never authored, they are the object spread's
  // reading of a string.
  const fromProps = isConfigBag(schema?.props) ? schema.props : {};
  const fromProperties = isConfigBag(schema?.properties) ? schema.properties : {};
  // Cast once, on the merged result. The five copies this replaces cast each
  // HALF (`(schema?.properties ?? {}) as T`), which asserted `T` of a value
  // that could be a string.
  return { ...fromProps, ...fromProperties } as T;
}
