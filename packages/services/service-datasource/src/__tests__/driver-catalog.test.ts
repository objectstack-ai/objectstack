// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connection form and the config gate must describe ONE shape (#4410).
 *
 * Before this, the catalog carried hand-written JSON-Schema literals while
 * `packages/spec` carried zod schemas for the same drivers — two descriptions,
 * neither checked against the other and neither validating anything, so the
 * drift was invisible. Now that the zod side is the gate `DatasourceSchema` and
 * `DatasourceAdminService` both parse `config` against, a divergence stops being
 * cosmetic: a form field the gate rejects is a Save that cannot succeed, and a
 * gate key the form omits is a setting only hand-written JSON can reach.
 *
 * The catalog is derived rather than reconciled, so these are proofs that the
 * derivation is real — the failure they exist to catch is someone "simplifying"
 * it back into literals.
 */

import { describe, it, expect } from 'vitest';
import {
  getDriverConfigJsonSchemaById,
  validateDriverConfig,
  type BuiltinDriverId,
} from '@objectstack/spec/data';

import { DRIVER_CATALOG } from '../driver-catalog.js';

describe('DRIVER_CATALOG', () => {
  it('serves the spec projection for every offered driver', () => {
    expect(DRIVER_CATALOG.length).toBeGreaterThan(0);
    for (const entry of DRIVER_CATALOG) {
      expect(entry.configSchema, entry.id)
        .toBe(getDriverConfigJsonSchemaById(entry.id as BuiltinDriverId));
    }
  });

  it('offers only drivers the platform can build and validate', () => {
    for (const entry of DRIVER_CATALOG) {
      expect(validateDriverConfig(entry.id, {}).known, entry.id).toBe(true);
    }
  });

  it('keeps its curation — label, description and icon per entry', () => {
    for (const entry of DRIVER_CATALOG) {
      expect(entry.label, entry.id).toBeTruthy();
      expect(entry.description, entry.id).toBeTruthy();
      expect(entry.icon, entry.id).toBeTruthy();
    }
    // `mongodb`, not `mongo`, since #6345 renamed the canonical driver id. This
    // list is the PUBLISHED contract Studio writes into `datasource.driver`, so
    // the assertion is the one that has to move with the rename — stored rows
    // carrying `mongo` are converged by the ADR-0087 conversion
    // `datasource-driver-mongo-to-mongodb`.
    expect(DRIVER_CATALOG.map((d) => d.id)).toEqual(['memory', 'sqlite', 'postgres', 'mysql', 'mongodb']);
  });

  /**
   * The form renders the AUTHOR-facing shape, so a field carrying a default
   * must not be marked required — an input-mode projection, not output-mode.
   * Getting this backwards would make the wizard demand a `host` the driver
   * already defaults.
   */
  it('projects the input shape, so defaulted fields stay optional', () => {
    const postgres = DRIVER_CATALOG.find((d) => d.id === 'postgres')!;
    const schema = postgres.configSchema as { required?: string[]; properties: Record<string, unknown> };

    expect(Object.keys(schema.properties)).toContain('host');
    expect(schema.required ?? []).not.toContain('host');
  });

  it('every field the form offers is a field the gate accepts', () => {
    for (const entry of DRIVER_CATALOG) {
      const schema = entry.configSchema as { properties: Record<string, unknown> };
      for (const key of Object.keys(schema.properties)) {
        const result = validateDriverConfig(entry.id, { [key]: undefined });
        expect(result.known, `${entry.id}.${key}`).toBe(true);
        const issues = (result as { issues: Array<{ message: string }> }).issues;
        const unknownKey = issues.some((i) => i.message.includes('Unrecognized key'));
        expect(unknownKey, `${entry.id}.${key} is offered by the form but rejected by the gate`)
          .toBe(false);
      }
    }
  });
});
