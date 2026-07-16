// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0085 semantic roles — runtime proof over the SERVED pipeline.
//
// @proof: semantic-roles-served
// The object semantic roles (`highlightFields` / `stageField` /
// `fieldGroups.collapse`) are exhaustively unit-tested at parse time in
// `@objectstack/spec`, but a parse-level green says nothing about the pipeline
// a real renderer consumes: defineStack → artifact → registry → REST
// serialization. That pipeline is exactly where the pre-ADR-0085 dialects
// silently died (spec-authored `defaultExpanded` never reached the form;
// `views.form.sections` never existed at all), and where a serializer
// whitelist or a boot-cached merge can strip a key without any static check
// noticing. These assertions run against the real Hono app over HTTP.
//
// Fixtures: `showcase_semantic_zoo` (canonical spellings) and
// `showcase_semantic_zoo_legacy` (deprecated spellings) in
// `examples/app-showcase/src/objects/semantic-zoo.object.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';

let stack: VerifyStack;
let token: string;

async function servedObject(name: string): Promise<Record<string, any>> {
  const res = await stack.apiAs(token, 'GET', `/meta/objects/${name}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body as any).data ?? body;
}

beforeAll(async () => {
  stack = await bootStack(showcaseStack);
  token = await stack.signIn();
});

afterAll(async () => {
  await stack?.stop();
});

describe('ADR-0085 semantic roles survive the served pipeline', () => {
  it('canonical spellings are served verbatim, with the compactLayout transition mirror', async () => {
    const def = await servedObject('showcase_semantic_zoo');

    expect(def.highlightFields).toEqual(['name', 'status', 'amount']);
    // Alias retired (framework#2536): served meta carries the canonical key
    // ONLY. This flip happened in the same PR that removed the transition
    // mirror, per the plan the mirror assertion carried.
    expect(def.compactLayout).toBeUndefined();

    expect(def.stageField).toBe('status');

    expect(def.fieldGroups).toEqual([
      { key: 'basics', label: 'Basics', collapse: 'none' },
      {
        key: 'money',
        label: 'Money',
        icon: 'banknote',
        description: 'Financial fields — collapsed by default.',
        collapse: 'collapsed',
      },
    ]);
    expect(def.fields?.status?.group).toBe('basics');
    expect(def.fields?.amount?.group).toBe('money');
    // Non-highlighted group members (the detail body hides highlighted
    // fields, so these keep their groups visible on detail pages).
    expect(def.fields?.code?.group).toBe('basics');
    expect(def.fields?.budget?.group).toBe('money');
    // The spec channel for a per-field currency is currencyConfig (a bare
    // `currency` key is stripped at parse) — renderers resolve
    // field.currency → currencyConfig.defaultCurrency → tenant default.
    expect(def.fields?.budget?.currencyConfig?.defaultCurrency).toBe('USD');
  });

  it('the legacy fixture serves canonical highlightFields only (alias retired)', async () => {
    const def = await servedObject('showcase_semantic_zoo_legacy');

    expect(def.highlightFields).toEqual(['name', 'amount']);
    expect(def.compactLayout).toBeUndefined();
  });

  it('stageField:false survives serialization as a strict false', async () => {
    const def = await servedObject('showcase_semantic_zoo_legacy');

    // `false` is the only "this status-shaped field is NOT a lifecycle" signal.
    // It has to arrive as a STRICT false: a serializer that drops falsy values
    // (or a renderer falsy-check) silently turns the stepper back on — the
    // exact bug PR objectui#2168 fixed. The fixture's `status` field is named
    // to trip the heuristic if this suppression ever leaks.
    expect(def.stageField).toBe(false);
  });

  it('the served metadata composes with the shared fieldGroups derivation', async () => {
    const def = await servedObject('showcase_semantic_zoo');

    // Every renderer (form / modal / detail) is a thin adapter over this one
    // function (ADR-0085 §5), so served-def × derivation IS the layout
    // contract: declared order, collapse passthrough, trailing untitled
    // bucket for ungrouped fields.
    const sections = deriveFieldGroupLayout(def);
    expect(sections).not.toBeNull();
    expect(sections!.map((s) => s.key)).toEqual(['basics', 'money', undefined]);
    expect(sections![0].fields).toEqual(['status', 'code']);
    expect(sections![1]).toMatchObject({
      key: 'money',
      collapse: 'collapsed',
      // icon/description pass through the shared derivation (ADR-0085 §5) so
      // every section renderer gets the same header chrome.
      icon: 'banknote',
      description: 'Financial fields — collapsed by default.',
      fields: ['amount', 'budget'],
    });
    // Ungrouped trailing bucket keeps `notes` visible (never silently dropped).
    expect(sections![2].fields).toContain('notes');
  });

  it('the fixture objects are real, writable objects (not metadata ghosts)', async () => {
    const created = await stack.apiAs(token, 'POST', '/data/showcase_semantic_zoo', {
      name: 'roles-roundtrip',
      status: 'active',
      amount: 7,
    });
    expect(created.status, `create failed: ${created.status}`).toBeLessThan(300);
    const createdBody = (await created.json()) as any;
    const id = createdBody.id ?? createdBody.record?.id ?? createdBody.data?.id;
    expect(id, 'no id returned from create').toBeTruthy();

    const got = await stack.apiAs(token, 'GET', `/data/showcase_semantic_zoo/${id}`);
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as any;
    const rec = gotBody.record ?? gotBody.data ?? gotBody;
    expect(rec.status).toBe('active');
    expect(rec.amount).toBe(7);
  });
});
