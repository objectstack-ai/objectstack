/**
 * objectui#5064 — `dashboardComponents` map parity pin.
 *
 * The map is the package's "Standard Export Protocol - for manual
 * integration": iterating it feeds each key straight into
 * `ComponentRegistry.register(type, component)`. That contract is invisible
 * to every static gate — the export-name check is green because the export
 * exists, and a wrong key vocabulary compiles because the keys are runtime
 * strings into `register(type: string, …)`. Until objectui#5064 the map
 * carried 11 PascalCase component class names, so the documented loop
 * registered 11 types no schema author writes while the 8 real types went
 * unregistered by it. This file is the missing dynamic check: the map's keys
 * must be exactly the schema types the barrel's side-effect registration
 * claims, and each value must be the very component registered for that type
 * (for the two `object-*` types that is the internal data-source-gate
 * wrapper, not the exported widget).
 */
import { describe, expect, it } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// Side-effect import: the package barrel runs the seven live
// `ComponentRegistry.register(...)` calls, and is also where
// `dashboardComponents` is defined.
import { dashboardComponents } from '../index';

/**
 * The 7 schema types read off the `ComponentRegistry.register` call sites.
 *
 * objectui#10859 batch 8 (phase 2b): `metric` / `metric-card` register with
 * `skipFallback: true`, so the type each SERVES is its namespaced key, and
 * `dashboard-grid` is retired (unregistered; `DashboardGridLayout` stays a
 * named export).
 */
const REGISTERED_TYPES = [
  'dashboard',
  'plugin-dashboard:metric',
  'plugin-dashboard:metric-card',
  'object-metric',
  'pivot',
  'object-pivot',
  'object-data-table',
];

/** The keys phase 2b took out of the map, and out of the registry with them. */
const RETIRED_BARE_TYPES = ['metric', 'metric-card', 'dashboard-grid'];

describe('dashboardComponents map parity (objectui#5064)', () => {
  it('keys are exactly the 7 schema types the barrel registers', () => {
    expect(Object.keys(dashboardComponents).sort()).toEqual(
      [...REGISTERED_TYPES].sort(),
    );
  });

  it('each value is the exact component registered for its type', () => {
    for (const [type, component] of Object.entries(dashboardComponents)) {
      // Bare-type lookup resolves the back-compat fallback entry, which holds
      // the same component reference the barrel registered.
      expect(ComponentRegistry.get(type), `type "${type}"`).toBe(component);
    }
  });

  it('the retired bare keys stay out of the map AND the registry (objectui#10859 batch 8)', () => {
    // Lit control: a bare key this barrel still publishes resolves.
    expect(ComponentRegistry.get('pivot')).toBe(dashboardComponents.pivot);
    for (const type of RETIRED_BARE_TYPES) {
      expect(Object.keys(dashboardComponents), `map key "${type}"`).not.toContain(type);
    }
    // Spelled as literals, one per key: `scripts/__tests__/unit-registry-absence-collision.test.ts`
    // resolves a registry-absence key statically and pins the sites it cannot.
    expect(ComponentRegistry.get('metric')).toBeUndefined();
    expect(ComponentRegistry.get('metric-card')).toBeUndefined();
    expect(ComponentRegistry.get('dashboard-grid')).toBeUndefined();
    // `dashboard-grid` went under both spellings; the metric pair kept theirs.
    expect(ComponentRegistry.get('plugin-dashboard:dashboard-grid')).toBeUndefined();
  });

  it('the pre-#5064 vocabulary stays gone: no PascalCase class-name keys', () => {
    // Schema types in this repo are lower-kebab; a key starting with an
    // uppercase letter is a component class name leaking back in.
    const classNameKeys = Object.keys(dashboardComponents).filter((key) =>
      /^[A-Z]/.test(key),
    );
    expect(classNameKeys).toEqual([]);
  });
});
