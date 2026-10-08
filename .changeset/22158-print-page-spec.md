---
'@objectstack/spec': major
'@objectstack/lint': minor
---

feat(spec)!: a `page` gains an optional `print` declaration and a linted printable block subset; the list-export `'pdf'` prescription points at the print page; the zero-reader document schemas retire whole (#22158)

Clause-②: yes (narrowing)

<!-- adr-0087: registered document-schemas-retired -->

**BREAKING** — the document family's exports leave `@objectstack/spec/data` (an export removal on a published entry), graded `major` on `@objectstack/spec`: Changesets is in pre mode on `main` (tag `next`), where the launch-window `major` guard stands aside for the line's breaking changes, so the level says what the change is. The v18 opening marker already takes the fixed group to `18.0.0-next.N`, so this grade moves no version on its own. `@objectstack/lint` is `minor`: its new rule refuses blocks only inside a page that declares `print`, which no page could carry before this release, and it adds exports. The `print` declaration itself is additive.

Card ① of the ruling on PDF and print documents (letter B′): **a document is a page with a print declaration; there is no separate template type.**

### The print page (additive)

`PageSchema` gains an optional, closed `print` block. Its presence makes the page a print page — a document (an invoice, a delivery order, a letter, a report) authored in the page's own blocks:

```ts
definePage({
  name: 'invoice_print',
  label: 'Invoice',
  type: 'record',
  object: 'invoice',
  regions: [
    { name: 'header', components: [{ type: 'element:image', properties: { src: '/logo.png', alt: 'ACME' } }] },
    { name: 'main', components: [
      { type: 'record:details', properties: { fields: ['customer', 'invoice_date'] } },
      { type: 'record:line_items', properties: { childObject: 'invoice_line', relationshipField: 'invoice', columns: [{ name: 'description' }, { name: 'amount' }] } },
    ] },
    { name: 'footer', components: [{ type: 'element:text', properties: { content: 'Payment due within 30 days.' } }] },
  ],
  print: { paperSize: 'A4', orientation: 'portrait', margins: { top: 15, bottom: 15 }, repeatHeader: true, repeatFooter: true, pageNumbers: true },
});
```

- **Keys** (`PagePrintSchema`): `paperSize` (`A4` | `A5` | `Letter` | `Legal`), `orientation` (`portrait` | `landscape`), `margins` (`{ top, right, bottom, left }` in millimetres), `repeatHeader` / `repeatFooter` (repeat the page's own `header` / `footer` region on every sheet), `pageNumbers`, and the page-break hints `repeatTableHeaders` and `avoidBreakInside`. Each maps to print CSS (`@page`, `thead { display: table-header-group }`, `break-inside`).
- **Not yet rendered.** Nothing applies these keys until the console's print rendering lands; the liveness ledger carries `print` as `planned` with an author warning, so `os validate` tells an author who writes it that the layout is validated but not yet applied.
- **Refused at the parse** (`checkPagePrintComposition`, exported for `.shape` mirrors): `print` on a `slotted` page, on an `html` / `jsx` / `react` page, on a `list` or `utility` page (a print page is a `record`, `home` or `app` page), on a `full` page with no `regions`, and `repeatHeader` / `repeatFooter` on a page with no region of that name.
- **The printable block subset** (`PRINTABLE_PAGE_COMPONENT_TYPES`, with the reason for every other vocabulary type in `PRINT_REFUSED_PAGE_COMPONENT_TYPES`): `page:section`, `page:card`, `page:footer`, `record:details`, `record:highlights`, `record:line_items`, `element:text`, `element:image`, `element:divider`, `element:definition-list`, `element:repeater`, `element:number` and `object-metric`. Inside a print page any other block — one that pages or windows its rows (`object-grid`, `record:related_list`), one that lays itself out to the screen (`page:sidebar`, `object-kanban`, `object-calendar`), or one with nothing printable (controls, inputs, shell chrome, `page:tabs`) — is refused by `@objectstack/lint`'s new gating rule `print-page-block-unprintable` (`validatePrintPageBlocks`), on `os validate`, `os build`, `os lint` and the page save door.

### The list-export prescription

`'pdf'` stays refused in `view.exportOptions` formats. The refusal no longer says "PDF export itself was declined as NOT PLANNED" — no longer true — and instead names the view's `allowPrinting` for printing a list and a page that declares `print` for a document.

### FROM → TO (the retirement)

`DocumentTemplateSchema`, `DocumentSchema`, `ESignatureConfigSchema` and the orphaned `DocumentVersionSchema` (`data/document.zod.ts`) are removed from `@objectstack/spec/data`, with their type aliases (`DocumentTemplate`, `DocumentTemplateParsed`, `Document`, `DocumentParsed`, `ESignatureConfig`, `ESignatureConfigParsed`, `DocumentVersion`, `DocumentVersionParsed`). No code in this repository, objectui or hotcrm read them.

| before | what to write instead |
| --- | --- |
| `DocumentTemplateSchema` (a docx template with placeholders) | a `page` that declares `print`, its body drawn from the printable block subset |
| `DocumentSchema` / `DocumentVersionSchema` | nothing — no document store ever kept them; a document record is ordinary object data, its files `sys_file` attachments |
| `ESignatureConfigSchema` | nothing — no e-signature integration exists |

**The one-line fix: delete the import; author a printable document as a page with a `print` block.** Every such import is TS2305 after upgrade. `data/DocumentSchemaValidation` (the NoSQL driver's block) is unaffected. `os migrate meta --from 17` lists the delegated step (D3 `document-schemas-retired`); there is no mechanical edit, since no stack collection ever carried these shapes.

### The retirement kit

- `RETIRED_DEFS_BY_MAJOR[18]`: `data/DocumentTemplate`, `data/Document`, `data/ESignatureConfig`, `data/DocumentVersion`; D3 semantic entry `document-schemas-retired`, with a step-18 rationale fragment. The `ESignatureConfig` deadline-key entries in `RETIRED_KEYS_BY_MAJOR[18]` stay as history.
- No tombstone and no D2 conversion: none of the schemas is a stack collection member or a metadata type, so a conversion would have no seam that runs.
- Generated: `json-schema.manifest/data.json` −4 defs, `authorable-surface/data.json` −30 rows, `authorable-defaults/data.json` −2, the api-surface / declaration-map / export-origins shards, the `data/document` reference page removed.
- Pin: `src/data/document-schemas-retirement.test.ts`, a tree-scoped absence walk over the declared radius.
