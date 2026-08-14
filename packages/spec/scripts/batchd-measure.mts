// TEMP measurement instrument for #4001 Batch D — deleted before commit.
// Per-site door measurement: carrier BFS from all metadata-type roots +
// ObjectStackSchema, with positive AND negative controls in the same run,
// plus parse-site probes demonstrating the pre-change strip behaviour.
import { z } from 'zod';
import { zodChildSchemas } from './lib/zod-graph.js';
import {
  getMetadataTypeSchema,
  listMetadataTypeSchemaTypes,
} from '../src/kernel/metadata-type-schemas';
import { ObjectStackSchema } from '../src/stack.zod';
import { ObjectSchema } from '../src/data/object.zod';
import {
  MetricSchema, DimensionSchema, CubeJoinSchema, CubeSchema,
  AnalyticsQuerySchema, defineCube,
} from '../src/data/analytics.zod';
import { AnalyticsQueryRequestSchema } from '../src/api/analytics.zod';
import {
  ReferenceResolutionSchema, ObjectDependencyNodeSchema, ObjectDependencyGraphSchema,
  ReferenceResolutionErrorSchema, SeedIdentitySchema, SeedLoaderConfigSchema,
  SeedLoadResultSchema, SeedLoaderResultSchema, SeedLoaderRequestSchema,
} from '../src/data/seed-loader.zod';
import { LocationValueSchema, AddressSchema } from '../src/data/field-value.zod';

function bfs(roots: z.ZodType[]): Set<z.ZodType> {
  const seen = new Set<z.ZodType>();
  const queue = [...roots];
  while (queue.length) {
    const s = queue.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    for (const c of zodChildSchemas(s)) queue.push(c);
  }
  return seen;
}

const rootTypes = listMetadataTypeSchemaTypes();
const roots: z.ZodType[] = rootTypes
  .map((t) => getMetadataTypeSchema(t))
  .filter((s): s is z.ZodType => !!s);
roots.push(ObjectStackSchema as unknown as z.ZodType);

const reached = bfs(roots);
console.log(`roots: ${roots.length} (${rootTypes.length} metadata types + ObjectStackSchema); nodes reached: ${reached.size}`);

const targets: Array<[string, z.ZodType]> = [
  ['POSITIVE control ObjectSchema', ObjectSchema as unknown as z.ZodType],
  ['analytics CubeSchema', CubeSchema as unknown as z.ZodType],
  ['analytics MetricSchema', MetricSchema as unknown as z.ZodType],
  ['analytics DimensionSchema', DimensionSchema as unknown as z.ZodType],
  ['analytics CubeJoinSchema', CubeJoinSchema as unknown as z.ZodType],
  ['analytics AnalyticsQuerySchema', AnalyticsQuerySchema as unknown as z.ZodType],
  ['seed-loader ReferenceResolutionSchema', ReferenceResolutionSchema as unknown as z.ZodType],
  ['seed-loader ObjectDependencyNodeSchema', ObjectDependencyNodeSchema as unknown as z.ZodType],
  ['seed-loader ObjectDependencyGraphSchema', ObjectDependencyGraphSchema as unknown as z.ZodType],
  ['seed-loader ReferenceResolutionErrorSchema', ReferenceResolutionErrorSchema as unknown as z.ZodType],
  ['seed-loader SeedIdentitySchema', SeedIdentitySchema as unknown as z.ZodType],
  ['seed-loader SeedLoaderConfigSchema', SeedLoaderConfigSchema as unknown as z.ZodType],
  ['seed-loader SeedLoadResultSchema', SeedLoadResultSchema as unknown as z.ZodType],
  ['seed-loader SeedLoaderResultSchema', SeedLoaderResultSchema as unknown as z.ZodType],
  ['seed-loader SeedLoaderRequestSchema', SeedLoaderRequestSchema as unknown as z.ZodType],
  ['field-value LocationValueSchema', LocationValueSchema as unknown as z.ZodType],
  ['field-value AddressSchema', AddressSchema as unknown as z.ZodType],
];

// NEGATIVE control: a shape declared right here that nothing carries.
const NegativeControl = z.object({ neverCarried: z.string() });
targets.push(['NEGATIVE control (fresh z.object)', NegativeControl]);

for (const [name, schema] of targets) {
  console.log(`${reached.has(schema) ? 'REACHABLE  ' : 'UNREACHABLE'} ${name}`);
}

// Walker-sanity: inject a synthetic carrier for an unreachable seed-loader
// shape and confirm the SAME walker flips it (批 14 method).
const synthetic = z.object({ carrier: SeedLoaderConfigSchema });
const flipped = bfs([synthetic as unknown as z.ZodType]);
console.log(`synthetic-carrier flip: SeedLoaderConfigSchema ${flipped.has(SeedLoaderConfigSchema as unknown as z.ZodType) ? 'REACHED via injected carrier (walker sees carriers)' : 'STILL UNREACHED (walker broken!)'}`);

// ── Parse-site probes: the strip behaviour each verdict is about ──────────
console.log('\n— parse probes (pre-change posture) —');

// 1. defineCube silently strips an unknown cube key + nested metric key.
const cube = defineCube({
  name: 'probe_cube', sql: 'probe', public: false,
  measures: { m: { name: 'm', label: 'M', type: 'count', sql: '*', filter: [{ sql: 'x' }] } as never },
  dimensions: {},
  joins: { j: { name: 'other', sql: 'x', relationshipp: 'one_to_one' } as never },
  refreshKey: { every: '1 hour', sqll: 'SELECT 1' } as never,
  publik: true,
} as never);
console.log('defineCube with 4 planted unknown keys:',
  JSON.stringify({
    cubeKeys: Object.keys(cube),
    metricKeys: Object.keys((cube.measures as Record<string, object>).m),
    joinKeys: Object.keys((cube.joins as Record<string, object>).j),
    refreshKeyKeys: Object.keys(cube.refreshKey as object),
  }));

// 2. AnalyticsQueryRequestSchema (the REST door) — top level already strict?
const topLevel = AnalyticsQueryRequestSchema.safeParse({ measures: ['m'], granularity: 'day' });
console.log(`REST door top-level unknown key: ${topLevel.success ? 'ACCEPTED (silent)' : 'REJECTED (already gated)'}`);

// 3. …but the nested timeDimensions item rides THROUGH the strict door.
const nested = AnalyticsQueryRequestSchema.safeParse({
  measures: ['m'],
  timeDimensions: [{ dimension: 'created', granuarity: 'day' }],
});
console.log(`REST door nested timeDimensions typo'd granularity: ${nested.success ? 'ACCEPTED (silently stripped — the live door)' : 'REJECTED'}`);
if (!nested.success) console.log('  issues:', JSON.stringify(nested.error.issues));
if (nested.success) console.log('  parsed timeDimensions:', JSON.stringify((nested.data as { timeDimensions?: unknown }).timeDimensions));

// 4. Metric.filters[] entry unknown key through the metric.
const mf = MetricSchema.safeParse({ name: 'm', label: 'M', type: 'count', sql: '*', filters: [{ sql: 'x', field: 'y' }] });
console.log(`Metric.filters[] extra key: ${mf.success ? 'ACCEPTED (stripped)' : 'REJECTED'}`);

// 5. Value contract probes — validation-only consumers, record-data writers.
const loc = LocationValueSchema.safeParse({ lat: 1, lng: 2, heading: 90, speed: 3 });
console.log(`LocationValue with device-API extras (heading/speed): ${loc.success ? 'ACCEPTED (extras tolerated)' : 'REJECTED'}`);
const addr = AddressSchema.safeParse({ street: 'x', district: 'y' });
console.log(`AddressValue with geocoder extra (district): ${addr.success ? 'ACCEPTED (extras tolerated)' : 'REJECTED'}`);
