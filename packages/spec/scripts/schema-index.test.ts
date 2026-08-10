// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the docs index's KEY STRUCTURE (#4696).
 *
 * `build-docs.ts` is a top-level script with side effects, so the only way to
 * assert on its page placement used to be to run the whole generator and read
 * the emitted `.mdx` — which is exactly how a bare-name global index survived
 * long enough to write 26 schemas onto pages named after files that do not
 * contain them. The index is extracted here for the same reason `format-type`
 * (#4912) and `schema-name` (#4592) were.
 *
 * Three facts carry the fix, and each is a separate test below:
 *
 *  1. the same name in two categories is two schemas, each on its own page;
 *  2. a name that reaches a category by RE-EXPORT belongs to the re-exporting
 *     file's page, not to the declaring file's slug borrowed into a category
 *     where no such file exists;
 *  3. an undecidable name inside one category is an ERROR, never an overwrite.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSchemaIndex,
  exportedValueNames,
  formatConflicts,
  resolveSchemaPage,
  type ZodFileInput,
} from './lib/schema-index';
import { schemaNameFromExportKey } from './lib/schema-name';

const file = (category: string, rel: string, source: string): ZodFileInput => ({
  category,
  rel,
  slug: rel.replace(/\.zod\.ts$/, '').replace(/\//g, '-'),
  source,
});

const index = (...files: ZodFileInput[]) => buildSchemaIndex(files, schemaNameFromExportKey);

describe('exportedValueNames', () => {
  it('reads a declaration, in both `=` and `: T =` spellings', () => {
    expect(exportedValueNames([
      'export const WidgetSchema = z.object({});',
      'export const GadgetSchema: z.ZodType<Gadget> = lazySchema(() => z.object({}));',
    ].join('\n'))).toEqual([
      { raw: 'WidgetSchema', kind: 'declaration' },
      { raw: 'GadgetSchema', kind: 'declaration' },
    ]);
  });

  it('reads a re-export, with and without a `from` clause', () => {
    expect(exportedValueNames([
      "export { RetryPolicySchema } from '../shared/retry-policy.zod';",
      'export { HttpMethodSchema, HttpRequestSchema };',
    ].join('\n'))).toEqual([
      { raw: 'RetryPolicySchema', kind: 're-export' },
      { raw: 'HttpMethodSchema', kind: 're-export' },
      { raw: 'HttpRequestSchema', kind: 're-export' },
    ]);
  });

  it('takes the ALIAS of a renamed re-export — that is the published name', () => {
    expect(exportedValueNames("export { InnerSchema as PublicSchema } from './inner.zod';"))
      .toEqual([{ raw: 'PublicSchema', kind: 're-export' }]);
  });

  it('skips type-only exports in both spellings — they publish no z.ZodType', () => {
    // `build-schemas.ts` emits a JSON Schema only for a runtime ZodType value,
    // so a type-only export must not claim a page. `system/job.zod.ts` mixes
    // both in one clause, which is why the inline modifier is handled too.
    expect(exportedValueNames([
      "export type { RetryPolicy } from '../shared/retry-policy.zod';",
      "export { RetryPolicySchema, type RetryPolicy, type RetryPolicyParsed } from '../shared/retry-policy.zod';",
    ].join('\n'))).toEqual([{ raw: 'RetryPolicySchema', kind: 're-export' }]);
  });

  it('ignores exports that only appear inside a TSDoc code sample', () => {
    // The old scan was unanchored and indexed four of these (`leadSeed`,
    // `SETUP_APP`, `nightlySync`, `reportForm`) as real exports.
    expect(exportedValueNames([
      '/**',
      ' * ```ts',
      ' * export const leadSeed = defineSeed({});',
      " * export { GhostSchema } from './ghost.zod';",
      ' * ```',
      ' */',
      'export const SeedSchema = z.object({});',
    ].join('\n'))).toEqual([{ raw: 'SeedSchema', kind: 'declaration' }]);
  });

  it('throws rather than dropping an export clause it cannot read', () => {
    // Under-reporting here silently hands the page back to the cross-category
    // fallback — the #4696 failure mode itself.
    expect(() => exportedValueNames('export { A B } from "./x";')).toThrow(/cannot parse export specifier/);
  });
});

describe('buildSchemaIndex — cross-category same name', () => {
  // Drawn from the live specimen this behaviour was found on: `ServiceStatus`
  // was an enum declared in `api/discovery.zod.ts` AND an object declared in
  // `system/core-services.zod.ts`. The bare-name index let `system` (walked
  // later) win, and then placed the API schema on `api/core-services.mdx` —
  // a page with no `api/core-services.zod.ts` behind it.
  //
  // That specimen is no longer live: #6604 renamed the system side to
  // `KernelServiceStatusSchema`, so the two categories no longer publish the
  // name. The fixture stays SYNTHETIC and unchanged on purpose — what it pins
  // is that cross-category same-name resolution is correct whenever it occurs,
  // and a rename of one specimen retires the specimen, not the property. Wiring
  // the fixture to whatever names happen to collide on `main` today would make
  // this coverage evaporate the next time someone tidies those names up.
  const idx = index(
    file('api', 'discovery.zod.ts', 'export const ServiceStatus = z.enum([]);'),
    file('system', 'core-services.zod.ts', 'export const ServiceStatusSchema = z.object({});'),
  );

  it('gives each declaration its own page, in its own category', () => {
    expect(idx.pageFor('api', 'ServiceStatus')).toBe('discovery');
    expect(idx.pageFor('system', 'ServiceStatus')).toBe('core-services');
  });

  it('is not a conflict — separate categories are separate published schemas', () => {
    expect(idx.conflicts).toEqual([]);
  });

  it('never borrows the other category\'s slug', () => {
    // The regression this whole issue is about: `api` has no `core-services`
    // page, so nothing may resolve to one.
    expect(idx.pageFor('api', 'ServiceStatus')).not.toBe('core-services');
  });
});

describe('buildSchemaIndex — re-exports', () => {
  it('places a re-exported name on the RE-EXPORTING file\'s page', () => {
    // `automation/control-flow.zod.ts` re-exports `RetryPolicySchema` from
    // `shared/`. The old index had no `automation/RetryPolicy` entry at all and
    // fell back to the declaring file's slug, inventing
    // `automation/retry-policy.mdx`.
    const idx = index(
      file('shared', 'retry-policy.zod.ts', 'export const RetryPolicySchema = z.object({});'),
      file('automation', 'control-flow.zod.ts', "export { RetryPolicySchema } from '../shared/retry-policy.zod';"),
    );
    expect(idx.pageFor('shared', 'RetryPolicy')).toBe('retry-policy');
    expect(idx.pageFor('automation', 'RetryPolicy')).toBe('control-flow');
  });

  it('lets the DECLARATION win over any number of same-category re-exports', () => {
    // Live shape: `api/realtime-shared.zod.ts` declares `PresenceStatus`, and
    // both `realtime.zod.ts` and `websocket.zod.ts` re-export it. One owner,
    // no ambiguity, no error.
    const idx = index(
      file('api', 'realtime-shared.zod.ts', 'export const PresenceStatusSchema = z.enum([]);'),
      file('api', 'realtime.zod.ts', "export { PresenceStatusSchema } from './realtime-shared.zod';"),
      file('api', 'websocket.zod.ts', "export { PresenceStatusSchema } from './realtime-shared.zod';"),
    );
    expect(idx.pageFor('api', 'PresenceStatus')).toBe('realtime-shared');
    expect(idx.conflicts).toEqual([]);
  });

  it('reports nothing for a name no file in the category exports', () => {
    // The caller then uses the `misc` catch-all, whose page prints no "Source:".
    const idx = index(file('data', 'object.zod.ts', 'export const ObjectSchema = z.object({});'));
    expect(idx.pageFor('security', 'TenancyPosture')).toBeUndefined();
  });
});

describe('buildSchemaIndex — conflicts are errors, never overwrites', () => {
  it('fails when two files in one category DECLARE the same name', () => {
    const idx = index(
      file('integration', 'connector.zod.ts', 'export const RateLimitConfigSchema = z.object({});'),
      file('integration', 'http.zod.ts', 'export const RateLimitConfigSchema = z.object({});'),
    );
    expect(idx.conflicts).toEqual([
      {
        category: 'integration',
        name: 'RateLimitConfig',
        sites: [
          { rel: 'connector.zod.ts', kind: 'declaration' },
          { rel: 'http.zod.ts', kind: 'declaration' },
        ],
      },
    ]);
    // And no owner is invented for it.
    expect(idx.pageFor('integration', 'RateLimitConfig')).toBeUndefined();
  });

  it('fails when two files re-export the same name and none declares it', () => {
    // Nothing breaks the tie, so the generator must not pick one.
    const idx = index(
      file('shared', 'http.zod.ts', 'export const HttpMethodSchema = z.enum([]);'),
      file('ui', 'view.zod.ts', 'export { HttpMethodSchema };'),
      file('ui', 'page.zod.ts', "export { HttpMethodSchema } from '../shared/http.zod';"),
    );
    expect(idx.conflicts.map((c) => `${c.category}/${c.name}`)).toEqual(['ui/HttpMethod']);
    expect(idx.pageFor('ui', 'HttpMethod')).toBeUndefined();
    // The unrelated declaring category is untouched.
    expect(idx.pageFor('shared', 'HttpMethod')).toBe('http');
  });

  it('names both files and the fix in the error message', () => {
    const idx = index(
      file('integration', 'connector.zod.ts', 'export const RateLimitConfigSchema = z.object({});'),
      file('integration', 'http.zod.ts', 'export const RateLimitConfigSchema = z.object({});'),
    );
    const message = formatConflicts(idx.conflicts);
    expect(message).toContain('integration/RateLimitConfig');
    expect(message).toContain('integration/connector.zod.ts (declaration)');
    expect(message).toContain('integration/http.zod.ts (declaration)');
    expect(message).toContain('#4696');
  });
});

describe('resolveSchemaPage', () => {
  const idx = index(
    file('shared', 'http.zod.ts', 'export const HttpMethodSchema = z.enum([]);'),
    file('api', 'router.zod.ts', 'export { HttpMethodSchema };'),
    file('api', 'discovery.zod.ts', 'export const ServiceStatus = z.enum([]);'),
    file('system', 'core-services.zod.ts', 'export const ServiceStatusSchema = z.object({});'),
    file('data', 'object.zod.ts', 'export const ObjectSchema = z.object({});'),
  );

  it('links within the reader\'s own category when it exports the name', () => {
    // `api/router.mdx` documents `HttpMethod` with an
    // `import … from '@objectstack/spec/api'` example; sending an api reader to
    // `shared/` would hand them a different import path than the page they are
    // on, and would leave api's own section for the name unreachable.
    expect(resolveSchemaPage(idx, 'api', 'HttpMethod')).toEqual({ category: 'api', slug: 'router' });
  });

  it('falls back to the single DECLARING category otherwise', () => {
    expect(resolveSchemaPage(idx, 'data', 'HttpMethod')).toEqual({ category: 'shared', slug: 'http' });
  });

  it('emits NO link when the bare name does not identify one schema', () => {
    // Two declarations, two different schemas. The old global lookup answered
    // with whichever the directory walk reached last — a confident link to the
    // wrong schema is worse than plain text.
    expect(resolveSchemaPage(idx, 'data', 'ServiceStatus')).toBeNull();
    // …but each category that owns one still links to its own.
    expect(resolveSchemaPage(idx, 'api', 'ServiceStatus')).toEqual({ category: 'api', slug: 'discovery' });
    expect(resolveSchemaPage(idx, 'system', 'ServiceStatus')).toEqual({ category: 'system', slug: 'core-services' });
  });

  it('emits no link for a name nothing exports', () => {
    expect(resolveSchemaPage(idx, 'data', 'NoSuchSchema')).toBeNull();
  });
});
