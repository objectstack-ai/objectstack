// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'document-schemas-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the document family, retired whole: the four defs data/DocumentTemplate, data/Document, '
    + 'data/ESignatureConfig and data/DocumentVersion, and every name data/document.zod.ts '
    + 'exported from @objectstack/spec/data (DocumentTemplateSchema, DocumentSchema, '
    + 'ESignatureConfigSchema, DocumentVersionSchema, their z.input aliases and their Parsed '
    + 'aliases)',
  replacement:
    'a printable document is a PAGE that declares `print` — no separate template type. Author '
    + 'the document (an invoice, a delivery order, a letter, a report) as an ordinary `page` '
    + 'with `kind: \'full\'`, its blocks in `regions` drawn from the printable block subset '
    + '(`record:details`, `record:highlights`, `record:line_items`, `element:text`, '
    + '`element:image` and the rest of PRINTABLE_PAGE_COMPONENT_TYPES), and a `print` block for '
    + 'the paper, margins, running header and footer, page numbers and page-break hints. A '
    + 'docx-with-placeholders template, a stored document with versions, and an e-signature '
    + 'workflow have no replacement, because nothing on the platform ever merged, stored or '
    + 'sent any of them; a document record the organisation keeps is ordinary object data, and '
    + 'its files are `sys_file` attachments',
  reason:
    'ADR-0049 enforce-or-remove, by the ruling of record on the PDF / print document card '
    + '(letter B′, 2026-10-08): "A document is a page with a print declaration; no new template '
    + 'type", and "The zero-reader DocumentTemplateSchema, DocumentSchema and '
    + 'ESignatureConfigSchema retire in v18 under ADR-0049 with ADR-0087 entries, so that '
    + '\'template\' means one thing." Four defs sat on the exported surface and in the generated '
    + 'reference docs — a docx template with typed placeholders, a document with versioning, '
    + 'access control and an e-signature block, and the signer workflow — and were read by '
    + 'NOTHING: they were exported from `@objectstack/spec/data`, mounted by no `stack.zod.ts` '
    + 'key, registered as no metadata type and absent from every liveness ledger, and the '
    + 'reader census over every package, app and example outside `packages/spec` (generated '
    + 'reference docs, release notes and changelogs aside), over objectui at its pin and its '
    + 'main, and over hotcrm returned zero hits for every exported name, against lit controls. '
    + 'Keeping them would have given an author two meanings of "template" — the dead docx one '
    + 'and the print page — and an AI that imports DocumentTemplateSchema a schema no runtime '
    + 'reads. DocumentVersionSchema had one carrier, DocumentSchema.versioning, and leaves with '
    + 'it. The ESignatureConfig deadline-key tombstones (RETIRED_KEYS_BY_MAJOR[18], D3 '
    + '`esignature-config-deadline-keys-retired`) leave with their def\'s source; their registry '
    + 'entries stay as history. Why D3 semantic and not a D2 conversion: the chain walks a '
    + 'normalized STACK and `applyConversionsToStoredItem` maps a metadata type onto one of its '
    + 'collections; none of these schemas is either, so a conversion would be a transform with no '
    + 'seam that ever runs (the `kernel/MetadataPluginConfig:additionalTypes` precedent), and '
    + 'with no carrier key there is no shape on which a tombstone could sit. `cloud` and real '
    + 'customer code are UNMEASURED.',
  acceptanceCriteria:
    'No code imports DocumentTemplateSchema, DocumentSchema, ESignatureConfigSchema or '
    + 'DocumentVersionSchema — or any of their type aliases — from @objectstack/spec or '
    + '@objectstack/spec/data: every such import is TS2305 after upgrade. A printable document '
    + 'is authored as a page with a `print` block, which `os validate` checks: the parse refuses '
    + '`print` on a page that does not print its own authored blocks, and the printable block '
    + 'subset refuses any other block inside it. `data/DocumentSchemaValidation` (the NoSQL '
    + 'driver\'s schema-validation block, a different declaration) is unaffected. The four defs '
    + 'are absent from `json-schema.manifest/data.json`, the api-surface / declaration-map / '
    + 'export-origins shards and the generated reference docs. ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED and must be verified as such: nothing ever parsed or read these '
    + 'shapes, so removing them removes no behaviour.',
};
