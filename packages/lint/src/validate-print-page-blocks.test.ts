// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The printable block subset gate (#22158, card ① of the ruling of record on
 * #8346, letter B′): inside a page that declares `print`, every block must be a
 * member of the spec's `PRINTABLE_PAGE_COMPONENT_TYPES`.
 *
 * Pinned in both directions, as the ruling asks ("with pins"):
 *  - EVERY refused vocabulary type is refused, one case per type, each at its
 *    own `type` path with its own reason — derived from the spec's map, so a
 *    type added there is pinned here the day it lands;
 *  - a print page built only from printable blocks, nested in every container
 *    position the walk reaches, passes with zero findings;
 *  - a page WITHOUT `print` is never judged, whatever it holds.
 */
import { describe, expect, it } from 'vitest';
import {
  PRINTABLE_PAGE_COMPONENT_TYPES,
  PRINT_REFUSED_PAGE_COMPONENT_TYPES,
  RETIRED_PAGE_COMPONENT_TYPES,
} from '@objectstack/spec/ui';
import {
  validatePrintPageBlocks as validatePrintPageBlocksUnrecorded,
  PRINT_PAGE_BLOCK_UNPRINTABLE,
} from './validate-print-page-blocks.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Slice 21: every finding this file fires is recorded, and the block at
// the foot of the file holds each recorded `fix:` line to one line of at most
// 200 characters.
const fired: Array<{ rule: string; hint: string }> = [];
const validatePrintPageBlocks: typeof validatePrintPageBlocksUnrecorded = (...args) => {
  const findings = validatePrintPageBlocksUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/** The one remedy line every refusal of this id prints (slice 21 of #22161). */
const PRINT_FIX =
  'Replace the block with a printable one (`os explain print-page-block-unprintable` lists them) or remove it; ' +
  'if the page is not a document, delete its `print` declaration.';

const printPage = (components: unknown[], extra: Record<string, unknown> = {}) => ({
  pages: [{ name: 'invoice_print', type: 'record', object: 'invoice', regions: [{ name: 'main', components }], print: {}, ...extra }],
});

describe('refuses every block outside the printable subset inside a print page', () => {
  it.each([...PRINT_REFUSED_PAGE_COMPONENT_TYPES])('refuses `%s` with its own reason', (type, reason) => {
    const findings = validatePrintPageBlocks(printPage([{ type: 'element:text' }, { type }]));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(PRINT_PAGE_BLOCK_UNPRINTABLE);
    expect(f.severity).toBe('error');
    expect(f.path).toBe('pages[0].regions[0].components[1].type');
    expect(f.where).toBe(`page "invoice_print" · ${type}`);
    expect(f.message).toContain(`\`${type}\` cannot be placed in a print page`);
    expect(f.message).toContain(`it ${reason}.`);
    // [#22161] Slice 21: one remedy line. The printable set no longer fits on
    // it; `os explain` lists it, held to the spec's own list at the foot of
    // this file.
    expect(f.hint).toBe(PRINT_FIX);
  });

  it('names the two refusal reasons the ruling gives, on the blocks that carry them', () => {
    const [grid] = validatePrintPageBlocks(printPage([{ type: 'object-grid' }]));
    expect(grid.message).toMatch(/pages its rows/);
    const [kanban] = validatePrintPageBlocks(printPage([{ type: 'object-kanban' }]));
    expect(kanban.message).toMatch(/runs sideways past the screen edge/);
  });

  it('refuses a type the vocabulary does not declare at all — a plugin widget, an SDUI layout block', () => {
    for (const type of ['flex', 'object-chart', 'acme:invoice-widget', 'custom.widget']) {
      const findings = validatePrintPageBlocks(printPage([{ type }]));
      expect(findings.map((f) => f.path), type).toEqual(['pages[0].regions[0].components[0].type']);
      expect(findings[0].message, type).toMatch(/nothing answers for how it prints/);
    }
  });

  it('reaches a refused block nested under printable containers, and every container position', () => {
    const findings = validatePrintPageBlocks(printPage([
      { type: 'page:section', properties: { children: [{ type: 'object-grid' }] } },
      { type: 'page:card', properties: { children: [{ type: 'element:text' }], footer: [{ type: 'element:button' }] } },
      { type: 'page:tabs', properties: { items: [{ label: 'Lines', children: [{ type: 'record:related_list' }] }] } },
    ]));
    expect(findings.map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.children[0].type',
      'pages[0].regions[0].components[1].properties.footer[0].type',
      'pages[0].regions[0].components[2].type',
      'pages[0].regions[0].components[2].properties.items[0].children[0].type',
    ]);
  });

  it('judges the running header and footer regions like any other region', () => {
    const stack = {
      pages: [{
        name: 'letter',
        type: 'home',
        regions: [
          { name: 'header', components: [{ type: 'page:header' }] },
          { name: 'main', components: [{ type: 'element:text' }] },
          { name: 'footer', components: [{ type: 'nav:breadcrumb' }] },
        ],
        print: { repeatHeader: true, repeatFooter: true },
      }],
    };
    expect(validatePrintPageBlocks(stack).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].type',
      'pages[0].regions[2].components[0].type',
    ]);
  });
});

describe('admits a print page built only from printable blocks', () => {
  it('passes every printable type, nested in every container position the walk reaches', () => {
    const leaves = [...PRINTABLE_PAGE_COMPONENT_TYPES]
      .filter((t) => !['page:section', 'page:card', 'page:footer'].includes(t))
      .map((type) => ({ type }));
    const stack = printPage([
      ...leaves,
      { type: 'page:section', properties: { children: leaves } },
      { type: 'page:card', properties: { children: leaves, footer: [{ type: 'element:text' }] } },
      { type: 'page:footer', properties: { children: [{ type: 'element:divider' }, { type: 'element:text' }] } },
    ]);
    expect(validatePrintPageBlocks(stack)).toEqual([]);
  });

  it('passes the invoice the ruling describes: letterhead, field blocks, the lines table, totals, a footer', () => {
    const stack = {
      pages: [{
        name: 'invoice_print',
        type: 'record',
        object: 'invoice',
        regions: [
          { name: 'header', components: [{ type: 'element:image', properties: { src: '/logo.png', alt: 'ACME' } }, { type: 'element:text', properties: { content: 'INVOICE' } }] },
          {
            name: 'main',
            components: [
              { type: 'record:highlights', properties: { fields: ['name', 'invoice_date', 'due_date'] } },
              { type: 'record:details', properties: { fields: ['customer', 'billing_address'] } },
              { type: 'record:line_items', properties: { childObject: 'invoice_line', relationshipField: 'invoice', columns: [{ name: 'description' }, { name: 'amount', type: 'currency' }], readonly: true } },
              { type: 'element:number', dataSource: { object: 'invoice_line' }, properties: { field: 'amount', aggregate: 'sum' } },
            ],
          },
          { name: 'footer', components: [{ type: 'element:divider' }, { type: 'element:text', properties: { content: 'Payment due within 30 days.' } }] },
        ],
        print: { paperSize: 'A4', margins: { top: 15, bottom: 15 }, repeatHeader: true, repeatFooter: true, pageNumbers: true },
      }],
    };
    expect(validatePrintPageBlocks(stack)).toEqual([]);
  });
});

describe('judges nothing outside a print page', () => {
  it('a page without `print` may hold any block', () => {
    const stack = {
      pages: [{
        name: 'account_record',
        regions: [{ name: 'main', components: [...PRINT_REFUSED_PAGE_COMPONENT_TYPES.keys()].map((type) => ({ type })) }],
      }],
    };
    expect(validatePrintPageBlocks(stack)).toEqual([]);
  });

  it('only the print page of two is judged', () => {
    const stack = {
      pages: [
        { name: 'screen', regions: [{ name: 'main', components: [{ type: 'object-grid' }] }] },
        { name: 'paper', regions: [{ name: 'main', components: [{ type: 'object-grid' }] }], print: {} },
      ],
    };
    expect(validatePrintPageBlocks(stack).map((f) => f.where)).toEqual(['page "paper" · object-grid']);
  });

  it('leaves a RETIRED type to the parse and `component-type-unknown` — no second finding at the same node', () => {
    for (const type of RETIRED_PAGE_COMPONENT_TYPES.keys()) {
      expect(validatePrintPageBlocks(printPage([{ type }])), type).toEqual([]);
    }
  });

  it('a malformed stack yields nothing rather than throwing', () => {
    expect(validatePrintPageBlocks({})).toEqual([]);
    expect(validatePrintPageBlocks({ pages: [null, 'x', { print: {} }] })).toEqual([]);
  });
});

// [#22161] Slice 21: the `fix:` line of `print-page-block-unprintable` is one
// remedy line, and the printable blocks it used to list are the id's
// `os explain` entry — written out there (that module imports nothing) and held
// equal to the spec's set here, so neither can drift from the other.
describe('[#22161] one-line fix — print-page-block-unprintable', () => {
  it('every `fix:` line the cases in this file fired is the one remedy line, at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === PRINT_PAGE_BLOCK_UNPRINTABLE);
    expect(converted.length).toBeGreaterThan(PRINT_REFUSED_PAGE_COMPONENT_TYPES.size);
    for (const f of converted) {
      expect(f.hint).toBe(PRINT_FIX);
      expect(f.hint.length).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain print-page-block-unprintable` lists exactly the spec\'s printable blocks', () => {
    const text = explainRule(PRINT_PAGE_BLOCK_UNPRINTABLE)!.paragraphs.join('\n');
    expect(text).toContain(
      `The printable blocks: ${[...PRINTABLE_PAGE_COMPONENT_TYPES].map((t) => `\`${t}\``).join(', ')}.`,
    );
    for (const fact of ['allow list', 'draws a window of its rows', 'delete the declaration']) {
      expect(text, fact).toContain(fact);
    }
  });
});
