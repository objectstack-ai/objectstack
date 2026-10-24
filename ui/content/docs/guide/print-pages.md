---
title: Print Pages
description: A page that declares `print` is a printable document — an invoice, a delivery order, a letter — printed through the browser's print preview.
---

# Print Pages

A printable document is an ordinary page with one more key, `print`. There is
no separate template type: the page's own blocks are the document body, and its
own `header` and `footer` regions are the letterhead and the footer
(`@objectstack/spec`, ruling B′ on objectstack#8346).

```json
{
  "name": "invoice_document",
  "label": "Invoice",
  "type": "record",
  "object": "invoice",
  "print": {
    "paperSize": "A4",
    "orientation": "portrait",
    "margins": { "top": 18, "bottom": 18, "left": 15, "right": 15 },
    "repeatHeader": true,
    "pageNumbers": true,
    "avoidBreakInside": true
  },
  "regions": [
    { "name": "header", "components": [{ "type": "element:text", "properties": { "content": "ACME Ltd" } }] },
    {
      "name": "main",
      "components": [
        { "type": "record:details" },
        {
          "type": "record:line_items",
          "properties": { "childObject": "invoice_line", "relationshipField": "invoice", "columns": [{ "name": "qty" }], "readonly": true }
        }
      ]
    },
    { "name": "footer", "components": [{ "type": "element:text", "properties": { "content": "Thank you for your business" } }] }
  ]
}
```

`print` is accepted on a `kind: 'full'` page of `type: 'record'`, `'home'` or
`'app'` with its blocks in `regions`. Every block in it must come from the
spec's printable block subset (`PRINTABLE_PAGE_COMPONENT_TYPES` in
`@objectstack/spec/ui`); `os validate`, `os build` and the metadata save door
refuse any other block inside a print page.

## What each key does on paper

`PageRenderer` mounts a print stylesheet for a page that declares `print`, and
only for it. Every rule sits inside `@media print`, so the page on screen is
drawn exactly as before — the console's page is the preview.

| Key | Print CSS |
| --- | --- |
| `paperSize`, `orientation` | `@page { size }` — A4 and portrait when omitted |
| `margins` | `@page` margin, one side per key, in millimetres; a side left out keeps the console default |
| `pageNumbers` | "page / pages" in the bottom-right margin box |
| `repeatHeader`, `repeatFooter` | the page's `header` / `footer` region repeated on every sheet |
| `repeatTableHeaders` | a table's column headings repeated on every sheet it runs onto — on when omitted |
| `avoidBreakInside` | `break-inside: avoid` on each block of a region |

Only the print page reaches paper: the console chrome and the record view's own
panels around the page are hidden, and the page runs onto as many sheets as it
needs.

## Blocks print whole

- `record:line_items` loads at most its row cap (500 unless `limit` is set). On
  a print page, when the child object has more lines than that, the panel draws
  the cap's lines and a note under them naming the cap and, when the server
  reports one, the total — a printed copy never drops lines in silence.
- A collapsible `record:details` section draws open on a print page.

A block reads whether it is on a print page with `usePrintPage()` from
`@object-ui/react`, which returns the page's `print` declaration or `null`.

## The record page's Print action

When the record page bound to a record declares `print`, the record view shows
a **Print** button that opens the browser's print preview of that page. Saving
a PDF is the browser's own "Save as PDF" destination.

## Printing a page that is not the default

The record route, `/apps/APP/OBJECT/record/ID`, shows a record on its object's
default record page. Any other record page of the object renders for the same
record at:

```
/apps/APP/OBJECT/record/ID/page/PAGE
```

So an invoice keeps its record view as the default page, and its print page
(`invoice_document` above) opens at `…/invoice/record/ID/page/invoice_document`,
with the same print stylesheet, print root and Print action. PAGE must be a
record page bound to OBJECT (`type: 'record'`, `object: OBJECT`). Any other
name, a page that is not a record page or a page of another object, shows
"Page not found": the console never falls back to the default page, so a print
of that URL never puts a different document on paper.
