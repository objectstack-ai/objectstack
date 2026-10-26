/**
 * objectui#5115 — `objectui check`'s known-type list must equal the set of
 * component types this repository actually registers.
 *
 * The list it replaced was seventeen entries typed by hand into
 * `packages/cli/src/commands/check.ts`, with nothing holding it against the
 * registry. Measured on `origin/main` @ `8378e9954`, it had drifted in BOTH
 * directions at the same time:
 *
 *   `crud`, `gallery`  in the list, registered by nothing. `objectui check`
 *                      passed `{ "type": "crud" }` in silence while
 *                      `SchemaRenderer` painted the OBJUI-001 "Unknown
 *                      component type" panel for it.
 *   221 bare keys      registered, absent from the list — `object-grid`,
 *   + all namespaced   `object-form`, `card`, `div`, `view:grid` … all
 *                      reported as unknown.
 *
 * Both directions are pinned here, and BOTH matter:
 *
 *   list ⊄ derived  a phantom type gets a green light from the gate and a red
 *                   panel from the runtime. This is the direction objectui#5115
 *                   was filed for.
 *   derived ⊄ list  a real type is reported as unknown. Cheap-looking and
 *                   corrosive: at 221 false warnings nobody reads the output,
 *                   which silently costs the first direction its only reader.
 *
 * The comparison is EXTRACTIVE — the expected set is re-derived from source on
 * every run by the same `deriveRegistryKeys` that judges documentation
 * snippets (objectui#4823). No key list is written down here; a fossil copy in
 * the test would be the third hand-maintained copy of the thing whose
 * hand-maintenance is the defect.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helpers; types are inferred from the `.mjs` sources by
// `tsconfig.scripts.json` (`allowJs`). See objectui#3494.
import { deriveRegistryKeys } from '../check-doc-component-types.mjs';
import { TARGET, deriveKnownSchemaTypes, renderModule } from '../regenerate-known-schema-types.mjs';

import { KNOWN_SCHEMA_TYPES, isKnownSchemaType } from '../../packages/cli/src/utils/known-schema-types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const derived = deriveRegistryKeys(repoRoot);
const derivedKeys = [...derived.keys.keys()].sort();

describe('the derivation this pin trusts', () => {
  it('resolves every registration site — an unresolved one would shrink the universe silently', () => {
    expect(derived.findings).toEqual([]);
  });

  it('is not vacuous: it finds registrations across many files', () => {
    // Guards the failure mode where a moved directory makes the walk empty and
    // every set comparison below passes by comparing nothing to nothing.
    expect(derived.counters.resolved).toBeGreaterThan(100);
    expect(derivedKeys.length).toBeGreaterThan(300);
  });
});

describe('KNOWN_SCHEMA_TYPES equals the registered universe', () => {
  it('ships no type that nothing registers (no green light for an OBJUI-001 panel)', () => {
    const phantoms = KNOWN_SCHEMA_TYPES.filter((t) => !derived.keys.has(t));
    expect(phantoms).toEqual([]);
  });

  it('omits no registered type (no false "Unknown schema type" warning)', () => {
    const shipped = new Set(KNOWN_SCHEMA_TYPES);
    const missing = derivedKeys.filter((k) => !shipped.has(k));
    expect(missing).toEqual([]);
  });

  it('is sorted and de-duplicated, so regeneration produces a stable diff', () => {
    expect([...KNOWN_SCHEMA_TYPES]).toEqual([...new Set(KNOWN_SCHEMA_TYPES)].sort());
  });
});

describe('the two drifted types objectui#5115 was filed for', () => {
  it('rejects `crud` — retired under ADR-0049, and never registered before that', () => {
    // `CRUDSchema` had an interface, a zod mirror, a validator branch and a
    // builder when objectui#5115 was filed. What it never had is a
    // registration, so the CLI must not claim the type exists. objectui#5373
    // resolved the open question this comment used to defer — the maintainer
    // ruled retirement, and all four declaration faces are gone.
    expect(derived.keys.has('crud')).toBe(false);
    expect(isKnownSchemaType('crud')).toBe(false);
  });

  it('rejects `gallery` — the registered spelling is `object-gallery`', () => {
    expect(derived.keys.has('gallery')).toBe(false);
    expect(isKnownSchemaType('gallery')).toBe(false);
    expect(isKnownSchemaType('object-gallery')).toBe(true);
  });

  it('accepts the real keys the old list reported as unknown, bare and namespaced alike', () => {
    for (const type of ['object-grid', 'object-form', 'card', 'div', 'view:grid', 'field:text']) {
      expect(isKnownSchemaType(type)).toBe(true);
    }
  });

  it('still rejects a type nothing registers', () => {
    expect(isKnownSchemaType('totally-made-up-xyz')).toBe(false);
  });
});

describe('registrations whose options arrive by reference (objectui#9641)', () => {
  /**
   * `page.tsx` declares one options object and registers five page kinds from
   * it — one taking it whole, four spreading it to vary the label. All five are
   * namespaced (`ui`) at runtime, so the registry stores ten keys; the
   * derivation resolved only the five bare ones and said nothing, and the list
   * shipped to `objectui check` was short by exactly the namespaced half.
   *
   * ⚠️ What made that expensive is not the size. Three instruments on
   * objectui#9263 — that card's census, the dev's independent re-take, and this
   * repository's own `deriveRegistryKeys` — agreed that a page registration was
   * unused. They agreed because two of them were reading through this blind
   * spot, not because they were independent.
   *
   * The MECHANISM is pinned over fixture trees in
   * `check-doc-component-types.test.ts` — `resolves a namespace passed by
   * SPREAD` and its neighbours for what the derivation READS, and the
   * `reports options it cannot read` and `refuses a name` families for what it
   * refuses — which is where a pin can fail on the old derivation and pass on
   * the new one.
   * What belongs HERE is the live-tree consequence: these keys reach the
   * shipped list. The two halves are
   * deliberately separate — an assertion about key strings alone would also be
   * satisfied by a hand-edited generated file, and it is only the
   * byte-for-byte regenerability pin below that rules that out.
   */
  it('⭐ ships the namespaced half of every page kind, not just the bare fallback', () => {
    for (const type of ['ui:page', 'ui:app', 'ui:utility', 'ui:home', 'ui:record']) {
      expect(derived.keys.has(type), `${type} is a real runtime registry key`).toBe(true);
      expect(isKnownSchemaType(type), `${type} must not be reported as an unknown schema type`).toBe(true);
    }
  });

  it('keeps the bare fallbacks it always had — this repair adds a half, it does not move one', () => {
    // ⚠️ A REGRESSION GUARD, not a mechanism pin: it passes on both sides of
    // the objectui#9641 change, because these five bare keys were derived
    // before it too. What it excludes is a repair that traded the bare half for
    // the namespaced one, which no ablation of the repair can show.
    for (const type of ['page', 'app', 'utility', 'home', 'record']) {
      expect(isKnownSchemaType(type)).toBe(true);
    }
  });

  it('is not vacuous: the tree still contains registrations read through a reference', () => {
    // The counter the derivation prints, never a number copied here (AGENTS #9):
    // if `page.tsx` is rewritten to spell its options out at each call, this
    // drops to zero and the pin above starts passing for a reason that has
    // nothing to do with the repair. That is the day to re-read this block, not
    // to delete it — some other registration will reach for the same shape.
    expect(derived.counters.metaViaReference).toBeGreaterThan(0);
  });
});

describe('the generated module is regenerable', () => {
  it('matches what the regeneration script would write, byte for byte', () => {
    // Keeps `node scripts/regenerate-known-schema-types.mjs` honest: if the
    // committed file were edited by hand, the next regeneration would produce
    // a surprise diff instead of a no-op.
    const committed = readFileSync(path.join(repoRoot, TARGET), 'utf8');
    expect(committed).toBe(renderModule(deriveKnownSchemaTypes(repoRoot)));
  });
});
