// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Cube } from '@objectstack/spec/data';

/**
 * CubeRegistry — Central registry for analytics cube definitions.
 *
 * The registry is the single source of truth for cube metadata discovery:
 * `getMeta()` maps every registered cube's measure/dimension `label` onto the
 * `CubeMeta` titles served by `GET /api/v1/analytics/meta`, and the strategy
 * chain resolves a query's cube through it.
 *
 * Three sources write to it, all of them from `AnalyticsService`:
 * 1. **Manifest definitions** — `AnalyticsServiceConfig.cubes` (`registerAll`),
 *    i.e. explicit cube definitions authored in `objectstack.config.ts`.
 * 2. **Compiled datasets** (ADR-0021) — `compileDataset()`'s Cube, registered
 *    under the dataset's name by `queryDataset`.
 * 3. **Ad-hoc query inference** — `ensureCube` / `inferCubeFromQuery` mints a
 *    minimal Cube from the members an `AnalyticsQuery` references, once
 *    `assertInferableCube` (#3867) has confirmed the name is a registered
 *    object. It infers from the QUERY, never from the object's field schema.
 *
 * This list used to read "two sources: manifest definitions, and object schema
 * inference". Neither half was right: sources 2 and 3 were missing, and object
 * schema inference is `inferFromObject` below, which no path in this repository
 * calls (#15019). It is described at the method rather than advertised here,
 * because listing it would promise a source the platform does not deliver.
 */
export class CubeRegistry {
  private cubes = new Map<string, Cube>();

  /** Register a single cube definition. Overwrites if name already exists. */
  register(cube: Cube): void {
    this.cubes.set(cube.name, cube);
  }

  /** Register multiple cube definitions at once. */
  registerAll(cubes: Cube[]): void {
    for (const cube of cubes) {
      this.register(cube);
    }
  }

  /** Get a cube definition by name. */
  get(name: string): Cube | undefined {
    return this.cubes.get(name);
  }

  /** Check if a cube is registered. */
  has(name: string): boolean {
    return this.cubes.has(name);
  }

  /** Return all registered cubes. */
  getAll(): Cube[] {
    return Array.from(this.cubes.values());
  }

  /** Return all cube names. */
  names(): string[] {
    return Array.from(this.cubes.keys());
  }

  /** Number of registered cubes. */
  get size(): number {
    return this.cubes.size;
  }

  /** Remove all cubes. */
  clear(): void {
    this.cubes.clear();
  }

  /**
   * Auto-generate a cube definition from an object's FIELD SCHEMA, and register
   * it under `objectName`.
   *
   * ⚠️ Nothing in this repository calls this — the only in-tree caller is a unit
   * test, and every cube the platform registers itself comes from one of the
   * three sources named on the class above (#15019). That is not the same thing
   * as unreachable: `CubeRegistry` is exported from the package entry and
   * `AnalyticsService.cubeRegistry` is public, so a consumer of
   * `@objectstack/service-analytics` can call it, and what it mints does reach
   * the wire — `getMeta()` serves the labels below as `CubeMeta` titles. Whether
   * this published method is removed or wired up as a real cube source is #15019.
   *
   * Heuristic rules, measured by driving the built package (the list this
   * replaces claimed three behaviours the code does not have — `min`/`max`
   * measures, a `count` measure for booleans, and a computed-field exclusion):
   * - `number` / `currency` / `percent` fields → one `sum` and one `avg` measure
   *   each, labelled with the field's label plus ` (Sum)` / ` (Avg)`. No `min`
   *   or `max` measure is minted.
   * - EVERY field becomes a dimension; there is no computed-field exclusion (the
   *   `fields` parameter carries no flag one could exclude on).
   * - `boolean` fields become a `boolean` DIMENSION and nothing else — no count
   *   measure is minted for them.
   * - `date` / `datetime` fields → `time` dimensions granulated
   *   day/week/month/quarter/year.
   * - A default `count` measure labelled `Count` is always added.
   *
   * Those three defaults (`Count`, and the two composites) are English literals
   * with no i18n hook; #14492's ruling listed the `Count` one as a site to carry
   * the `builtinAggregate` discriminator, and it was left alone because no
   * in-repo path reaches it.
   *
   * @param objectName - The snake_case object name (used as table/cube name)
   * @param fields - Array of field descriptors `{ name, type, label? }`
   */
  inferFromObject(
    objectName: string,
    fields: Array<{ name: string; type: string; label?: string }>,
  ): Cube {
    const measures: Record<string, any> = {
      count: {
        name: 'count',
        label: 'Count',
        type: 'count',
        sql: '*',
      },
    };
    const dimensions: Record<string, any> = {};

    for (const field of fields) {
      const label = field.label || field.name;

      // All fields become dimensions
      const dimType = this.fieldTypeToDimensionType(field.type);
      dimensions[field.name] = {
        name: field.name,
        label,
        type: dimType,
        sql: field.name,
        ...(dimType === 'time'
          ? { granularities: ['day', 'week', 'month', 'quarter', 'year'] }
          : {}),
      };

      // Numeric fields also become aggregation measures
      if (field.type === 'number' || field.type === 'currency' || field.type === 'percent') {
        measures[`${field.name}_sum`] = {
          name: `${field.name}_sum`,
          label: `${label} (Sum)`,
          type: 'sum',
          sql: field.name,
        };
        measures[`${field.name}_avg`] = {
          name: `${field.name}_avg`,
          label: `${label} (Avg)`,
          type: 'avg',
          sql: field.name,
        };
      }
    }

    const cube: Cube = {
      name: objectName,
      title: objectName,
      sql: objectName,
      measures,
      dimensions,
      public: false,
    };

    this.register(cube);
    return cube;
  }

  private fieldTypeToDimensionType(fieldType: string): string {
    switch (fieldType) {
      case 'number':
      case 'currency':
      case 'percent':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'date':
      case 'datetime':
        return 'time';
      default:
        return 'string';
    }
  }
}
