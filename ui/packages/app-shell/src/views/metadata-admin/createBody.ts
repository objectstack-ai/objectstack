/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { getMetadataCreateSeed, listMetadataCreateSeedTypes } from '@objectstack/spec/kernel';
import type { MetadataResourceConfig } from './registry.js';

/**
 * The placeholder identity keys every spec create seed fills: the seed module's
 * header names them (`name` / `label` / object binding) and says "a create flow
 * overrides those from user input". The object binding is found by VALUE, see
 * {@link specSeedPlaceholderObjects}.
 */
const SEED_IDENTITY_KEYS: ReadonlySet<string> = new Set(['name', 'label']);

let placeholderObjects: ReadonlySet<string> | undefined;

/**
 * The object name(s) the spec's create seeds bind to: their placeholder object.
 *
 * Read from the seeds themselves (`getMetadataCreateSeed`), never restated
 * here. The spec keeps its `PLACEHOLDER_OBJECT` constant module-private, and
 * every seed that binds an object holds it at `object`, so the set of those
 * values IS that constant. A seed that binds it under another key
 * (`mapping.targetObject`) is then found by its value in
 * {@link seedPlaceholderKeys}.
 */
export function specSeedPlaceholderObjects(): ReadonlySet<string> {
  if (!placeholderObjects) {
    const values = new Set<string>();
    for (const type of listMetadataCreateSeedTypes()) {
      const seed = getMetadataCreateSeed(type);
      const bound = seed && typeof seed === 'object' ? (seed as Record<string, unknown>).object : undefined;
      if (typeof bound === 'string' && bound) values.add(bound);
    }
    placeholderObjects = values;
  }
  return placeholderObjects;
}

/**
 * The top-level keys of a create seed that hold placeholder identity: `name`,
 * `label`, and every key whose value is the spec's placeholder object (the
 * object binding). These are the values a create flow must take from the
 * author, never from the seed.
 */
export function seedPlaceholderKeys(seed: Record<string, unknown> | undefined): string[] {
  if (!seed) return [];
  const objects = specSeedPlaceholderObjects();
  return Object.keys(seed).filter((key) => {
    if (SEED_IDENTITY_KEYS.has(key)) return true;
    const value = seed[key];
    return typeof value === 'string' && objects.has(value);
  });
}

/**
 * The STRUCTURAL defaults a create seed carries: the seed without its
 * placeholder identity ({@link seedPlaceholderKeys}). A dataset's seed gives
 * `{ dimensions: [], measures: [{ name: 'count', aggregate: 'count' }] }`.
 *
 * One derivation, two readers: {@link buildCreateModeBody} spreads it under the
 * draft at save, and the create page puts the same keys into its initial draft
 * (objectui#12866), so the designer shows before the first save what the save
 * writes.
 */
export function seedStructuralDefaults(seed: Record<string, unknown> | undefined): Record<string, unknown> {
  const base = { ...(seed ?? {}) };
  for (const key of seedPlaceholderKeys(seed)) delete base[key];
  return base;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Build the create-mode save body for a new metadata item.
 *
 * Prefers the server's authoritative **create seed** (delivered per type on the
 * `/meta/types` registry entry — the single source of truth in
 * `@objectstack/spec`) over the locally hardcoded `createDefaults`. This is the
 * drift-stop for the recurring "the designer emits a minimal shape the spec
 * rejects, so create→save 422s" family (dashboard `layout`, action `body`):
 * the structural defaults now come from the same place the spec validates
 * against, so they cannot diverge. Falls back to `createDefaults` when the
 * server provides no seed (older server, or canvas-create types whose shape is
 * built interactively).
 *
 * Only the seed's STRUCTURAL defaults are carried (`measures`, `widgets`, the
 * required `type`/`body`, …). Its placeholder identity
 * ({@link seedPlaceholderKeys}) is not: those values come from the author's
 * draft or not at all, so a create never saves the seed's `label` or its
 * placeholder object binding (objectui#12810: a dataset with no base object
 * saved `object: <the placeholder>`, and every read of it was then refused).
 * A placeholder the author left unset and the type requires refuses the save
 * — see {@link unsetSeedPlaceholders}.
 *
 * `createBuildBody` (dynamic identity, e.g. a view's qualified name) still takes
 * precedence — it incorporates user input the static seed cannot.
 */
export function buildCreateModeBody(
  config: Pick<MetadataResourceConfig, 'createBuildBody' | 'createDefaults'>,
  draft: Record<string, unknown>,
  specCreateSeed: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (config.createBuildBody) {
    return config.createBuildBody(draft) as Record<string, unknown>;
  }
  const base = specCreateSeed ? seedStructuralDefaults(specCreateSeed) : { ...(config.createDefaults ?? {}) };
  return { ...base, ...draft };
}

/**
 * The seed placeholder keys a create body still lacks a value for, where the
 * type requires one — the save refuses these at the client, before any
 * request, and names them.
 *
 * `required` is the LIVE server schema's `required` list (the `/meta/types`
 * entry), so this gate is never stricter than the server that judges the body
 * (the skew `clientValidation.ts` guards against). The identity field is left
 * out: an empty name already has its own refusal in the save path.
 */
export function unsetSeedPlaceholders(
  config: Pick<MetadataResourceConfig, 'createBuildBody'>,
  body: Record<string, unknown>,
  specCreateSeed: Record<string, unknown> | undefined,
  required: unknown,
  identityField: string,
): string[] {
  if (config.createBuildBody || !Array.isArray(required)) return [];
  return seedPlaceholderKeys(specCreateSeed).filter(
    (key) => key !== identityField && required.includes(key) && isBlank(body[key]),
  );
}
