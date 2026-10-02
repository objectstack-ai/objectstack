// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21445 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `object-grid-resizable-columns-removed` family (one D3 entry per retirement
// family, even when D2 is lossless). The conversion follows the renderer's own
// precedence exactly, so it preserves what every grid did — including where
// what the grid did was not what the author wrote.
export const entry: SemanticMigration = {
  id: 'object-grid-resizable-columns-retired',
  surface: 'page.component.object-grid.resizableColumns — the legacy second spelling of the grid '
    + 'column-resize switch',
  replacement: '`resizable: true | false` — the one spelling the grid reads; the value is the same '
    + 'boolean.',
  reason: 'The D2 conversion `object-grid-resizable-columns-removed` follows the renderer\'s own '
    + 'precedence, `resizable ?? resizableColumns`: where `resizable` was absent the legacy value WAS '
    + 'the grid\'s setting, so it moves to `resizable` unchanged; where `resizable` held a value the '
    + 'legacy key was never read, so it is deleted. Both are behaviour-preserving, and the second is '
    + 'where the judgment sits. A grid that authored both keys with DIFFERENT values has always '
    + 'behaved as `resizable` said, while its author may believe the other key governed it. The '
    + 'conversion keeps what users have been seeing and discards the value the author also wrote; '
    + 'only the author can say which one they meant. Code that builds object-grid props (a host, a '
    + 'generator) must also stop emitting the key, which no conversion reaches.',
  acceptanceCriteria: 'No `object-grid` component carries `resizableColumns`; the parse refuses it. '
    + 'Each grid that should let users drag column borders either omits `resizable` (the renderer '
    + 'default is on) or sets it to `true`, and each that should not sets `resizable: false`. For '
    + 'every grid that had authored both keys, the author has compared the discarded value with the '
    + 'kept `resizable` and confirmed the kept one.',
  conversionIds: ['object-grid-resizable-columns-removed'],
};
