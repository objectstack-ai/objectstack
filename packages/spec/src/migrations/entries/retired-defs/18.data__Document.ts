// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #22158 — `data/Document` — a stored document with versioning, a template,
// an e-signature block and access control, which no document store ever kept —
// leaves whole with the document family under ADR-0049 enforce-or-remove, by
// the ruling of record on #8346 (letter B′, maintainer 「8346 B′」 2026-10-08):
// "The zero-reader `DocumentTemplateSchema`, `DocumentSchema` and
// `ESignatureConfigSchema` retire in v18 under ADR-0049 with ADR-0087 entries,
// so that 'template' means one thing" — a printable document is a page that
// declares `print`. It was exported from `@objectstack/spec/data`
// (`data/document.zod.ts`), mounted by no `stack.zod.ts` key, registered as no
// metadata type, absent from every liveness ledger, and read by NOTHING: on
// objectstack `fec87e7e0` every hit for the family's exported names outside
// `packages/spec` was generated reference docs, release notes or a changelog;
// objectui (the `.objectui-sha` pin `a58626c88` and main `cef0eee`) and hotcrm
// (`1e88edc`) returned zero, against lit controls on the same pattern. No carrier
// key, so no `retiredKey()` tombstone and no D2 conversion (none of these
// schemas is a stack collection member — the
// `kernel/MetadataPluginConfig:additionalTypes` reasoning): RETIRED_DEFS_BY_MAJOR
// plus the D3 semantic entry `document-schemas-retired` ARE the declaration.
export const entry = 'data/Document';
