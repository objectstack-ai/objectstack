// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `Seed.dependsOn`, end to end: a stack's seed datasets, booted through the
// real composition (AppPlugin's boot seed → SeedLoaderService → ObjectQL →
// the sandboxed `beforeInsert` hook → the driver), read back over REST.
//
// ## What was broken
//
// The seed loader orders datasets by the lookup / master_detail / user edges
// between their objects, and the authored `data` order only breaks ties. A
// dataset whose insert-time hook READS another seeded object had no way to say
// so. Here a rating looks up its rule only, while the bands it is scored from
// sit two master_detail hops below the rule, so the rating is ready a wave
// before the bands: its hook ran against an empty band table, and every
// seeded rating scored as if no band existed — though `data` lists the bands
// first.
//
// ## What these cases pin
//
// Two rating objects with the same hook and the same lookup, seeded by the
// same boot. The one whose dataset declares `dependsOn: ['dod_band']` is
// written after the bands, and its hook counts both; the one that declares
// nothing keeps the order the lookups give, before the bands, and counts none
// (an app that declares no `dependsOn` keeps today's order). The loader's
// refusals (a name the load does not seed, an edge that closes a cycle) are
// pinned in-process: `packages/metadata-protocol/src/seed-loader-depends-on-33812.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field, defineSeed } from '@objectstack/spec/data';

const SCORE_SOURCE =
  "const bands = await ctx.api.object('dod_band').find({}); ctx.input.bands_seen = bands.length;";

const DodRule = ObjectSchema.create({
  name: 'dod_rule',
  label: 'Rule',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});
const DodItem = ObjectSchema.create({
  name: 'dod_item',
  label: 'Item',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), rule: Field.masterDetail('dod_rule', { label: 'Rule' }) },
});
const DodBand = ObjectSchema.create({
  name: 'dod_band',
  label: 'Band',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), item: Field.masterDetail('dod_item', { label: 'Item' }) },
});
const rating = (name: string, label: string) => ObjectSchema.create({
  name,
  label,
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    rule: Field.lookup('dod_rule', { label: 'Rule' }),
    bands_seen: Field.number({ label: 'Bands seen' }),
  },
});
const DodRating = rating('dod_rating', 'Rating');
const DodRatingPlain = rating('dod_rating_plain', 'Rating (no dependsOn)');

const scoreHook = (name: string, object: string) => ({
  name,
  object,
  events: ['beforeInsert'],
  body: { language: 'js', source: SCORE_SOURCE, capabilities: ['api.read'] },
});

const dodStack = defineStack({
  manifest: {
    id: 'com.dogfood.seed-depends-on',
    namespace: 'dod',
    version: '0.0.0',
    type: 'app',
    name: 'Seed dependsOn Fixture',
    description: 'A seeded rating whose insert hook reads seeded bands that no lookup orders it after.',
  },
  objects: [DodRule, DodItem, DodBand, DodRating, DodRatingPlain],
  hooks: [scoreHook('dod_rating_score', 'dod_rating'), scoreHook('dod_rating_plain_score', 'dod_rating_plain')],
  // Authored bands-first, which on its own never ordered anything.
  data: [
    defineSeed(DodRule, { records: [{ name: 'R1' }] }),
    defineSeed(DodItem, { records: [{ name: 'I1', rule: 'R1' }] }),
    defineSeed(DodBand, { records: [{ name: 'B1', item: 'I1' }, { name: 'B2', item: 'I1' }] }),
    defineSeed(DodRating, { dependsOn: ['dod_band'], records: [{ name: 'C1', rule: 'R1' }] }),
    defineSeed(DodRatingPlain, { records: [{ name: 'P1', rule: 'R1' }] }),
  ],
} as any);

describe('dogfood: Seed.dependsOn orders a seeded dataset after the objects its hook reads', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(dodStack as never, {});
    token = await stack.signIn();
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  const rows = async (object: string): Promise<any[]> => {
    const res = await stack.apiAs(token, 'GET', `/data/${object}`);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    return body.records ?? body.data ?? [];
  };

  it('the bands were seeded', async () => {
    expect((await rows('dod_band')).map((r) => r.name).sort()).toEqual(['B1', 'B2']);
  });

  it('the card: the rating that declares dependsOn its bands is written after them, and its hook sees both', async () => {
    const [row] = await rows('dod_rating');
    expect(row?.name).toBe('C1');
    expect(row?.bands_seen).toBe(2);
  });

  it('control: the rating that declares nothing keeps the lookup order — written before the bands, it sees none', async () => {
    const [row] = await rows('dod_rating_plain');
    expect(row?.name).toBe('P1');
    expect(row?.bands_seen).toBe(0);
  });
});
