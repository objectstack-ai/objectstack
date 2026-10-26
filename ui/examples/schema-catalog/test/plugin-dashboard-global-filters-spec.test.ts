/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4356 — the `plugin-dashboard` catalog entries' `globalFilters` are
 * validated against the REAL `@objectstack/spec` schema, not merely rendered.
 *
 * ## Why this guardrail exists
 *
 * This catalog is not a test fixture directory. Its own `package.json` calls it
 * the "single source of truth for example schemas consumed by the docs site,
 * smoke tests, and **AI few-shot retrieval**", and `test/fields-form-hosted.
 * test.tsx` already records the objectui#3910 lesson in those words: *"these
 * examples are the docs site's field demos and a few-shot retrieval source for
 * AI authors, so what they show is what gets copied."*
 *
 * Until this file, the catalog's only assertions were structural (`smoke.test.
 * tsx`: every entry is an object with a non-empty `type`) and render-without-
 * throw. Both are satisfied by a schema the platform REFUSES at publish — which
 * is exactly how three entries came to ship the bare-string `options` shorthand
 * (`["EMEA", "APAC", "AMER"]`) that `GlobalFilterSchema` rejects. The stored-
 * dashboard survey on objectstack#7917 found them and named this guardrail as
 * the fix: an AI author retrieving from this corpus was being taught a form the
 * platform's own door refuses.
 *
 * ## Why this asserts `GlobalFilterSchema` and not `DashboardSchema`
 *
 * The survey suggested parsing each entry with `DashboardSchema` and requiring
 * `safeParse` to succeed. **Measured, that is not implementable, and the reason
 * is not the shorthand.** All 9 `plugin-dashboard` entries are refused by
 * `DashboardSchema` today, and they stay refused after the shorthand is fixed:
 *
 *   - these are objectui **SDUI component** schemas (`{ "type": "dashboard",
 *     "title": …, "columns": … }`), not stored platform metadata documents, so
 *     they carry no `name` / `label` metadata identity keys — 2 issues per entry
 *     before any widget is read;
 *   - most of their widgets use the pre-ADR-0021 inline analytics shape
 *     (`object` + `categoryField` + `aggregate`), which `@objectstack/spec` 17
 *     removed in favour of `dataset` + `dimensions` + `values`.
 *
 * A `DashboardSchema.safeParse` assertion would therefore be permanently red,
 * and making it green would mean rewriting all 9 examples into platform-metadata
 * shape — a far larger change than this card, and one that would silently drop
 * the inline-analytics form the docs still teach elsewhere. That divergence is
 * real and is filed separately; it is deliberately NOT smuggled in here.
 *
 * So the guardrail is pinned at the exact sub-schema that owns the surface this
 * card governs: `GlobalFilterSchema`, the spec's own definition of a
 * `globalFilters[]` entry, applied to every such entry in every
 * `plugin-dashboard` example. That is a real spec validation — the same schema
 * the platform runs — over the property that actually regressed.
 */

import { describe, it, expect } from 'vitest';
import { GlobalFilterSchema } from '@objectstack/spec/ui';
import { examplesByCategory } from '../src/index.js';

const entries = examplesByCategory('plugin-dashboard');

/** Every `globalFilters[]` entry in the category, tagged with its origin. */
const filters = entries.flatMap((example) => {
  const globalFilters = (example.schema as { globalFilters?: unknown }).globalFilters;
  if (!Array.isArray(globalFilters)) return [];
  return globalFilters.map((filter, index) => ({ id: example.id, index, filter }));
});

describe('schema-catalog plugin-dashboard — globalFilters validate against @objectstack/spec', () => {
  it('the category is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  /**
   * NON-VACUITY CONTROL — the assertion below is `it.each` over `filters`, and
   * `it.each([])` reports NOTHING rather than failing. Without this pin, a
   * refactor that broke the collection (a renamed category, a changed registry
   * shape) would turn the guardrail silently green while validating zero
   * filters. The survey applied exactly this discipline to its own sweep, for
   * exactly this reason.
   */
  it('the sweep actually reaches filters', () => {
    expect(filters.length).toBeGreaterThan(0);
    expect(new Set(filters.map((f) => f.id)).size).toBeGreaterThan(1);
  });

  it.each(filters.map((f) => [`${f.id} globalFilters[${f.index}]`, f.filter]))(
    '%s is accepted by GlobalFilterSchema',
    (_label, filter) => {
      const result = GlobalFilterSchema.safeParse(filter);
      // Surface the spec's own message — a bare `.success` boolean tells the
      // next reader that something is wrong and nothing about what.
      const issues = result.success
        ? []
        : result.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`);
      expect(issues).toEqual([]);
      expect(result.success).toBe(true);
    },
  );
});
