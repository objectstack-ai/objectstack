// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the frontmatter `description` of generated reference pages (#12238).
 *
 * `check:docs` compares the regenerated tree with the committed one, so it
 * holds the OUTPUT still but says nothing about the rule: a regression that
 * wrote every page back to `<Title> protocol schemas` would regenerate, commit
 * and stay green. These cases pin the rule itself — the lead it reads, where
 * it cuts, and that every branch lands inside 70–160.
 */

import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  categoryIndexDescription,
  completeWithSchemas,
  describeFromDocBlock,
  describeFromSchemas,
  docBlockLead,
  fitSentences,
  flattenInline,
  inRange,
  modulePageDescription,
  yamlDescription,
} from './lib/page-description';

/** A `.zod.ts` source whose module header is `lines`. */
const moduleSource = (...lines: string[]) =>
  ['/**', ...lines.map(l => (l ? ` * ${l}` : ' *')), ' */', '', "import { z } from 'zod';", '', 'export const X = z.string();', ''].join('\n');

/** The inner text `findModuleDocBlock` hands over for `lines`. */
const inner = (...lines: string[]) => `\n${lines.map(l => (l ? ` * ${l}` : ' *')).join('\n')}\n `;

const page = { title: 'Object', categoryTitle: 'Data Protocol', schemaNames: ['Object', 'Index', 'TenancyConfig'] };

describe('flattenInline', () => {
  it('flattens Markdown and JSDoc links to the text a reader sees', () => {
    expect(flattenInline('The `view` type — see [the guide](/docs/x) and {@link ViewSchema}, **not** *this*.')).toBe(
      'The view type — see the guide and ViewSchema, not this.',
    );
  });

  it('drops citation-only parentheticals and brackets, and bare URLs', () => {
    expect(flattenInline('Error-Code Ledger (ADR-0112 D3).')).toBe('Error-Code Ledger.');
    expect(flattenInline('[#10235] The per-column projection (cloud#2172 ruling A).')).toBe('The per-column projection.');
    expect(flattenInline('Defined by Anthropic (https://modelcontextprotocol.io).')).toBe('Defined by Anthropic.');
    // A parenthetical that carries content stays.
    expect(flattenInline('Seed data (with relationship resolution).')).toBe('Seed data (with relationship resolution).');
  });
});

describe('docBlockLead', () => {
  it('takes the title line and the prose before the first structure', () => {
    const lead = docBlockLead(inner('AI Model Registry Protocol', '', 'Centralized registry for AI models.', 'Enables discovery.', '', '## Architecture', '', 'More.'));
    expect(lead).toEqual({ title: 'AI Model Registry Protocol', paragraphs: ['Centralized registry for AI models. Enables discovery.'] });
  });

  it('skips the @module marker instead of stopping at it', () => {
    const lead = docBlockLead(inner('@module studio/plugin', '', 'Studio Plugin Protocol', '', 'Defines the specification for Studio plugins.'));
    expect(lead.title).toBe('Studio Plugin Protocol');
    expect(lead.paragraphs).toEqual(['Defines the specification for Studio plugins.']);
  });

  it('keeps the clause before the comma when a sentence only introduced a list', () => {
    const lead = docBlockLead(inner('Defines the core schemas for the marketplace ecosystem, covering:', '- listings', '- reviews'));
    expect(lead.paragraphs).toEqual(['Defines the core schemas for the marketplace ecosystem.']);
  });

  it('drops planning boilerplate and one-word run-in labels', () => {
    const lead = docBlockLead(inner('Implements P0 requirement for ObjectStack kernel.', 'Provides consistent error codes. Background.'));
    expect(lead.paragraphs).toEqual(['Provides consistent error codes.']);
  });

  it('has no paragraphs when the block opens into a list', () => {
    expect(docBlockLead(inner('Logging Protocol', '', '- console', '- file')).paragraphs).toEqual([]);
  });
});

describe('fitSentences', () => {
  it('keeps whole sentences within the maximum', () => {
    const a = `Alpha ${'word '.repeat(15)}end.`;
    const b = `Beta ${'word '.repeat(15)}end.`;
    expect(fitSentences(`${a} ${b}`)).toBe(a);
  });

  it('cuts an over-long first sentence at a clause boundary that keeps the minimum', () => {
    const text = `Response payloads for the dispatcher-served lifecycle routes of every package — ${'the commit timeline and more '.repeat(6)}here.`;
    const out = fitSentences(text);
    expect(out).toBe('Response payloads for the dispatcher-served lifecycle routes of every package.');
    expect(inRange(out)).toBe(true);
  });

  it('never cuts a clause that leaves a bracket open', () => {
    const text = `A package (also called a Solution in one platform, an Unlocked Package in another, or an Application elsewhere) is the first-class unit of distribution for everything.`;
    const out = fitSentences(text, 120);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).not.toMatch(/\s…$/);
  });
});

describe('describeFromDocBlock', () => {
  it('prefixes a thin lead with the title line', () => {
    expect(describeFromDocBlock(inner('Storage Service Protocol', '', 'Defines the API contract for file operations.'))).toBe(
      'Storage Service Protocol — Defines the API contract for file operations.',
    );
  });

  it('answers the title alone when the block has no prose', () => {
    expect(describeFromDocBlock(inner('Object Storage Protocol', '', '- buckets'))).toBe('Object Storage Protocol.');
  });
});

describe('modulePageDescription', () => {
  it('uses the doc block when it yields a description in range', () => {
    const src = moduleSource('Defines the standard organization and workspace model, for teams that belong to several workspaces.');
    expect(modulePageDescription(src, page)).toEqual({
      text: 'Defines the standard organization and workspace model, for teams that belong to several workspaces.',
      from: 'docblock',
    });
  });

  it('completes a thin doc block with the schema names', () => {
    const got = modulePageDescription(moduleSource('Error-Code Ledger (ADR-0112 D3).'), page);
    expect(got).toEqual({
      text: 'Error-Code Ledger. Reference for Object, Index, TenancyConfig: every property with its type and default.',
      from: 'docblock+schemas',
    });
  });

  it('falls back to the schema names when the module has no doc block', () => {
    const got = modulePageDescription("import { z } from 'zod';\nexport const X = z.string();\n", page);
    expect(got.from).toBe('schemas');
    expect(got.text).toBe(
      'Object schemas of the ObjectStack Data Protocol: Object, Index, TenancyConfig — each property with its type, default and a TypeScript example.',
    );
    expect(modulePageDescription(null, page)).toEqual(got);
  });

  it('lands in range on every branch, however many names there are', () => {
    const many = { ...page, schemaNames: Array.from({ length: 40 }, (_, i) => `VeryLongSchemaNameNumber${i}`) };
    const none = { ...page, schemaNames: [] };
    for (const p of [page, many, none]) {
      expect(inRange(describeFromSchemas(p))).toBe(true);
      expect(inRange(completeWithSchemas('Error-Code Ledger.', p))).toBe(true);
    }
    expect(describeFromSchemas(many)).toMatch(/and \d+ more — /);
  });
});

describe('categoryIndexDescription', () => {
  it('is in range for every category title shape', () => {
    for (const title of ['AI Protocol', 'QA Protocol', 'Automation Protocol', 'Marketplace Protocol']) {
      for (const n of [1, 9, 42]) {
        const text = categoryIndexDescription(title, n);
        expect(text.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
        expect(text.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      }
    }
    expect(categoryIndexDescription('QA Protocol', 1)).toContain('in 1 reference page:');
  });
});

describe('yamlDescription', () => {
  it('double-quotes, so a colon or hash in the prose cannot change the YAML', () => {
    expect(yamlDescription('Routes: REST # and "OData"')).toBe('"Routes: REST # and \\"OData\\""');
  });
});
