// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `knowledge-source-id-to-name` (protocol 19, ADR-0161 K6) — the one class of
 * source the rename's "no index is rebuilt" does not cover.
 *
 * The fixture pair (conversions.test.ts) pins the rewrite, the underscore-led
 * id included. This file pins what that rewrite leaves: `renameKey` copies an
 * underscore-led id as it is, the parse then refuses the `name` with the
 * router-addressable prescription, and the three texts an upgrader reads — the
 * conversion's `summary`, the `id` tombstone and the D3 entry
 * `knowledge-source-registration-governed` that judges this conversion's edits
 * — name the same exception and the same remedy (#38217, after #38050).
 */

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../../registry.js';
import { applyMetaMigrations } from '../../../migrations/chain.js';
import { MIGRATIONS_BY_MAJOR } from '../../../migrations/registry.js';
import { KnowledgeSourceSchema } from '../../../ai/knowledge-source.zod.js';
import { ROUTER_ADDRESSABLE_NAME_MESSAGE } from '../../../kernel/address-grammar.js';

const ID = 'knowledge-source-id-to-name';
const D3 = 'knowledge-source-registration-governed';
const conversion = () => ALL_CONVERSIONS.find((c) => c.id === ID)!;
const d3 = () => MIGRATIONS_BY_MAJOR[19]!.semantic!.find((e) => e.id === D3)!;

const source = (key: 'id' | 'name', value: string) => ({
  [key]: value,
  label: 'FAQ',
  adapter: 'memory',
  source: { kind: 'object', object: 'faq', content: ['answer'] },
});

const chain = (stack: Record<string, unknown>) => applyMetaMigrations(structuredClone(stack), 18, 19);

/** The `id` tombstone's prescription, read off the live parse rather than copied. */
function tombstone(): string {
  const parsed = KnowledgeSourceSchema.safeParse({ ...source('name', 'faq'), id: 'faq' });
  expect(parsed.success).toBe(false);
  const issue = parsed.error!.issues.find((i) => i.path.join('.') === 'id');
  expect(issue, 'the `id` key is refused with its own prescription').toBeDefined();
  return issue!.message;
}

describe(`${ID}: an id that begins with an underscore`, () => {
  it('is copied as it is, to a `name` the parse then refuses with the router-addressable prescription', () => {
    const result = chain({ knowledgeSources: [source('id', '_legacy_faq'), source('id', 'support_faq')] });
    expect(result.applied.filter((a) => a.conversionId === ID).map((a) => a.path)).toEqual([
      'knowledgeSources[0].name',
      'knowledgeSources[1].name',
    ]);
    const [underscored, plain] = result.stack.knowledgeSources as Record<string, unknown>[];
    // No new name is invented: only the author knows which one the source takes.
    expect(underscored).toEqual(source('name', '_legacy_faq'));
    expect(plain).toEqual(source('name', 'support_faq'));

    const refused = KnowledgeSourceSchema.safeParse(underscored);
    expect(refused.success).toBe(false);
    expect(refused.error!.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['name', ROUTER_ADDRESSABLE_NAME_MESSAGE],
    ]);
    expect(KnowledgeSourceSchema.safeParse(plain).success).toBe(true);
  });

  it('is judged by the D3 entry, which the chain lists beside the edit', () => {
    expect(d3().conversionIds).toContain(ID);
    const result = chain({ knowledgeSources: [source('id', '_legacy_faq')] });
    const absent = new Set(result.absentTodos.map((t) => `${t.toMajor}:${t.id}`));
    const listed = result.todos.filter((t) => !absent.has(`${t.toMajor}:${t.id}`));
    expect(listed.map((t) => t.id)).toContain(D3);
  });

  it('the summary keeps "no index is rebuilt" for every other source, and names the exception and its remedy', () => {
    const { summary } = conversion();
    expect(summary).toContain('the value is unchanged, so no index is rebuilt, except for an id that begins with an underscore');
    expect(summary).toContain('takes a new name, is built again under it');
    expect(summary).toContain('dropped with `dropSource`, which the author runs');
    expect(summary).toContain(`\`${D3}\``);
  });

  it('the summary, the `id` tombstone and the D3 entry name the same exception and remedy', () => {
    const texts = {
      summary: conversion().summary,
      tombstone: tombstone(),
      replacement: d3().replacement,
    };
    for (const [where, text] of Object.entries(texts)) {
      expect(text, `${where} names the underscore`).toMatch(/\bunderscore\b/);
      expect(text, `${where} says the source takes a new name`).toContain('takes a new name');
      expect(text, `${where} names the remedy`).toContain('`dropSource`');
    }
    // The tombstone and the summary send the reader to the same D3 entry.
    expect(texts.tombstone).toContain(`\`${D3}\``);
    expect(texts.summary).toContain(`\`${D3}\``);
  });
});
