// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasourcePreview vs `DatasourceSchema` (objectui#3275, objectui#4131).
 *
 * `DatasourceSchema` is `.strict()`. Three reads in this preview were for keys
 * it rejects outright, and each one made an unsaveable draft look correct:
 *
 *  • `capabilities` — the preview tested `Array.isArray(d.capabilities)`, which
 *    was exactly backwards: it lit the CAPABILITIES block up only for the pre-17
 *    token array the schema refuses, and left it dark for the object form the
 *    schema then required. objectui#3266 watched the block vanish the moment the
 *    sample was corrected. objectstack#4583 has since removed the key outright,
 *    so the block is gone with it (objectui#4131) — there is no longer a shape
 *    of `capabilities` a datasource can carry.
 *  • `driver ?? d.type` — `type` is rejected with an explicit `type` → `driver`
 *    alias hint, so the fallback taught the wrong spelling.
 *  • `isDefault` / `default` — not datasource keys at all; routing is declared
 *    at stack level via `datasourceMapping`.
 *
 * objectui#4131 deleted a second wave on the same grounds: `retryPolicy` and
 * `healthCheck` joined `capabilities` in objectstack#4583's removal, so their
 * SideBlocks were painting draft state the schema refuses by name.
 *
 * A preview that renders a rejected key is not being helpful; it is making the
 * author's mistake invisible until publish (AGENTS.md #0.1).
 *
 * These are RENDER pins — what a reader sees for a given draft. The companion
 * `DatasourcePreview.spec-keys.test.ts` pins the READ set against the schema's
 * own key list, so a fourth wave fails here by its rendering and there by its
 * mere existence.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DatasourceSchema } from '@objectstack/spec/data';

// The federation panel makes REST calls against a saved datasource; this test
// is about which keys the preview reads, so stub it out.
vi.mock('../external/ExternalDatasourcePanel', () => ({
  ExternalDatasourcePanel: () => <div data-testid="mock-external-panel" />,
}));

import { DatasourcePreview } from './DatasourcePreview';

afterEach(cleanup);

/**
 * Declared keys only — and asserted to parse clean below rather than merely
 * claimed to, so this fixture cannot drift into the very state it is here to
 * rule out. Mirrors the console gallery's sample.
 */
const VALID_DRAFT = {
  name: 'warehouse',
  label: 'Analytics Warehouse',
  description: 'Read-only Postgres replica for reporting.',
  driver: 'postgres',
  active: true,
  ssl: { enabled: true, rejectUnauthorized: true },
  config: { host: 'db.internal', port: 5432, database: 'analytics' },
  pool: { min: 2, max: 10 },
} satisfies Record<string, unknown>;

/** Pre-17 shape: array capabilities, `type` instead of `driver`, `isDefault`. */
const STALE_DRAFT = {
  name: 'warehouse',
  label: 'Analytics Warehouse',
  type: 'postgres',
  isDefault: true,
  config: { host: 'db.internal' },
  capabilities: ['read', 'aggregate'],
} satisfies Record<string, unknown>;

/** A draft carrying the three key groups objectstack#4583 removed. */
const REMOVED_KEYS_DRAFT = {
  ...VALID_DRAFT,
  retryPolicy: { maxAttempts: 3, backoffMs: 250 },
  healthCheck: { enabled: true, intervalMs: 60000 },
  capabilities: { readOnly: true, queryAggregations: true },
} satisfies Record<string, unknown>;

function renderPreview(draft: Record<string, unknown>) {
  return render(
    <DatasourcePreview type="datasource" name="warehouse" draft={draft} />,
  );
}

describe('the fixtures mean what they say', () => {
  it('VALID_DRAFT carries declared keys only', () => {
    const parsed = DatasourceSchema.safeParse(VALID_DRAFT);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('REMOVED_KEYS_DRAFT is rejected, by all three names', () => {
    const parsed = DatasourceSchema.safeParse(REMOVED_KEYS_DRAFT);
    expect(parsed.success).toBe(false);
    const rejected = parsed.success
      ? []
      : parsed.error.issues.flatMap((i) =>
          i.code === 'unrecognized_keys' ? ((i as { keys: string[] }).keys ?? []) : [],
        );
    expect(rejected.sort()).toEqual(['capabilities', 'healthCheck', 'retryPolicy']);
  });
});

describe('DatasourcePreview renders nothing from keys the spec rejects', () => {
  it('paints no Retry Policy / Health Check / Capabilities block (objectui#4131)', () => {
    // The whole defect: an author types these, the preview confirms them, and
    // the save fails. Nothing they wrote may appear — not the block titles, not
    // the values inside them.
    renderPreview(REMOVED_KEYS_DRAFT);
    expect(screen.queryByText('Retry Policy')).toBeNull();
    expect(screen.queryByText('Health Check')).toBeNull();
    expect(screen.queryByText('Capabilities')).toBeNull();
    expect(screen.queryByText('readOnly')).toBeNull();
    expect(screen.queryByText('queryAggregations')).toBeNull();
    expect(screen.queryByText(/maxAttempts/)).toBeNull();
    expect(screen.queryByText(/intervalMs/)).toBeNull();
  });

  it('renders no capabilities block for the array form either', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText('Capabilities')).toBeNull();
    expect(screen.queryByText('read')).toBeNull();
    expect(screen.queryByText('aggregate')).toBeNull();
  });

  it('does not fall back to `type` for the driver pill', () => {
    renderPreview(STALE_DRAFT);
    // `postgres` was never written to `driver`, so the preview must not claim
    // one — the alias hint belongs at save time, not as a silent rescue here.
    expect(screen.queryByText('postgres')).toBeNull();
    expect(screen.getByText('unknown')).toBeTruthy();
  });

  it('paints no `default` pill for `isDefault` / `default`', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText('default')).toBeNull();
    cleanup();
    renderPreview({ ...STALE_DRAFT, isDefault: undefined, default: true });
    expect(screen.queryByText('default')).toBeNull();
  });
});

describe('DatasourcePreview still renders everything the spec accepts', () => {
  it('keeps label, name, driver, description and the redacted connection table', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('Analytics Warehouse')).toBeTruthy();
    expect(screen.getByText('warehouse')).toBeTruthy();
    expect(screen.getByText('postgres')).toBeTruthy();
    expect(screen.getByText('Read-only Postgres replica for reporting.')).toBeTruthy();
    expect(screen.getByText('db.internal')).toBeTruthy();
  });

  it('keeps the pool / ssl rail blocks — the two key groups still declared', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('Pool')).toBeTruthy();
    expect(screen.getByText('SSL')).toBeTruthy();
    // …and renders their contents, so "present" is not just a title.
    expect(screen.getByText('min:')).toBeTruthy();
    expect(screen.getByText('rejectUnauthorized:')).toBeTruthy();
  });

  it('renders the surviving rail and nothing beside it', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.queryByText('Retry Policy')).toBeNull();
    expect(screen.queryByText('Health Check')).toBeNull();
    expect(screen.queryByText('Capabilities')).toBeNull();
  });
});
