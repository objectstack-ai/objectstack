// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Invoice Document — the invoice's record page, and a PRINT page: it declares
 * `print`, so the console's Print action prints it through the browser, and
 * `@objectstack/service-print` renders the same page in headless Chromium, as
 * the requesting user, and archives the PDF as a file attached to the invoice
 * (`showcase_invoice` declares `enable: { files: true }` for that).
 *
 * It is the invoice's DEFAULT record page (`isDefault: true`) because the
 * console renders a record on its default record page, so that is the page a
 * record prints on. Every block is from the printable subset
 * (`PRINTABLE_PAGE_COMPONENT_TYPES`): the header and footer regions are the
 * letterhead and the footer, repeated on every sheet, and `record:line_items`
 * prints every line up to its cap.
 */
export const InvoiceDocumentPage = definePage({
  name: 'showcase_invoice_document',
  label: 'Invoice',
  type: 'record',
  object: 'showcase_invoice',
  kind: 'full',
  isDefault: true,
  print: {
    paperSize: 'A4',
    orientation: 'portrait',
    margins: { top: 18, bottom: 18, left: 15, right: 15 },
    repeatHeader: true,
    repeatFooter: true,
    pageNumbers: true,
    avoidBreakInside: true,
  },
  regions: [
    {
      name: 'header',
      components: [
        { type: 'element:text', properties: { content: 'ObjectStack Showcase Ltd · 示例有限公司' } },
        { type: 'element:divider' },
      ],
    },
    {
      name: 'main',
      components: [
        { type: 'record:details' },
        {
          type: 'record:line_items',
          properties: {
            childObject: 'showcase_invoice_line',
            relationshipField: 'invoice',
            columns: [{ name: 'description' }, { name: 'quantity' }, { name: 'unit_price' }, { name: 'amount' }],
            readonly: true,
          },
        },
      ],
    },
    {
      name: 'footer',
      components: [{ type: 'element:text', properties: { content: 'Thank you for your business · 感谢惠顾' } }],
    },
  ],
});
