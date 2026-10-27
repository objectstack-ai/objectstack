// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The third is a sharper shape: `layout` IS read, but only against
// `inline`/`compact` — values its `auto | custom` enum never permitted — so
// both legal values took the same branch. Declared on BOTH sides with the
// same enum, which is why the declaration-parity ratchet (two declarations,
// never a declaration vs an implementation) reported agreement over it.
export const entry = 'ui/RecordDetailsProps:layout';
