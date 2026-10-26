/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isConfigBag } from '@object-ui/react';

/**
 * The config bag `record:alert` reads: the node's own keys UNDERNEATH (the
 * legacy flat spelling `RecordAlertRendererProps` tolerates) and `properties`
 * on top. It is the sixth member of the `readProps()` family that
 * `packages/components/src/__tests__/alias-precedence-cross-channel.test.tsx`
 * names, spelled differently — `{ ...schema, ...schema.properties }`, no
 * `props` alias leg — and since objectui#6790 it asks the same question the
 * other five have asked since objectui#6783: is `properties` a real config
 * bag? `??` only replaces `null`/`undefined`, so the previous spelling
 * `(schema?.properties ?? {})` let a DEGENERATE `properties` (a string, an
 * array) into the object spread, where it came back out as its own indexed
 * keys — `{ '0': 'n', … '8': 'g' }` for `'not-a-bag'`, nine keys nobody
 * authored, sitting beside the named ones the renderer reads.
 *
 * What the guard buys is what objectui#6752 measured its own guard buys: the
 * authored value's shape is not reinterpreted. Not a rendered pixel, today —
 * every read in `record-alert.tsx` is a NAMED key (`title`, `body`,
 * `severity`, `action`, `dismissible`, …) and the bag is never spread onto a
 * DOM element, so the indices were computed and then dropped. It asks the
 * predicate `@object-ui/react` exports rather than retelling it
 * (objectui#6761's pin cannot see a spelling one package over), and it does
 * not reuse `@object-ui/components`' `readProps`: that reader is not exported,
 * and its expression is a different one (`props` alias underneath, not the
 * node).
 *
 * Its own module for the same reason `@object-ui/components` gave its reader
 * one: `record-alert.tsx` keeps exporting components only, and the pin
 * (`__tests__/record-alert.degenerateProperties.test.tsx`) imports the reader
 * directly. `index.tsx` imports `RecordAlertRenderer` by name, so this does
 * not reach the package entry.
 */
export function readProps(schema: any) {
  // A degenerate bag contributes NO keys. The node's own keys underneath are
  // untouched, so the legacy flat spelling still resolves and a nested key
  // still wins the contested one.
  const fromNested = isConfigBag(schema?.properties) ? schema.properties : {};
  return { ...schema, ...fromNested };
}
