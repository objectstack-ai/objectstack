// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 enforce-or-remove on `objectstack.manifest.json`: the platform
// assigns a package's trust tier from the publisher's credentials and never
// read the file's `publisher`; the publish request's own `publisher` is
// untouched. `retiredKey()` carries the prescription and the `tsc` channel. No D2
// conversion: this file is not a stack collection member (the `category`
// precedent on the same schema). The D3 record is
// `marketplace-template-manifest-platform-decided-keys-retired`.
export const entry = 'marketplace/TemplateManifest:publisher';
