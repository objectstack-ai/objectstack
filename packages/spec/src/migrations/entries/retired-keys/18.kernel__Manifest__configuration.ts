// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11332 — ADR-0049 enforce-or-remove on the plugin manifest's three dead
// top-level containers; census and registration major recorded once in the
// sibling entry `kernel/Manifest:capabilities`, the why-no-D2-conversion
// reasoning in `kernel/Manifest:loading` (the precedent); the D3 semantic
// entry is `plugin-manifest-dead-containers-retired`.
//
// `configuration` declared a per-plugin settings surface (`{ title,
// properties }`, a simplified JSON-Schema map) that no settings UI rendered
// and no loader resolved. Its `properties.*.secret` flag is the
// false-compliance shape ADR-0049 exists for: the describe() promised "value
// is encrypted/masked (e.g. API Keys)" while nothing encrypted, masked or
// even parsed the flag — `secret: true` next to an API key got exactly the
// same handling as `secret: false`. The enforced channel is host
// composition: the options object passed to the plugin's constructor in
// `defineStack({ plugins: [new MyPlugin({ … })] })`.
export const entry = 'kernel/Manifest:configuration';
