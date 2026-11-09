// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 enforce-or-remove on `objectstack.manifest.json`: nothing read the
// file's `name`. `retiredKey()` carries the prescription and the `tsc` channel.
// No D2 conversion: this file is not a stack collection member (the
// `category` precedent on the same schema). The D3 record is
// `marketplace-template-manifest-inert-keys-retired`.
export const entry = 'marketplace/TemplateManifest:name';
