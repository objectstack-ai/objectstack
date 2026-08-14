// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7894 — the URL-spelling map, pinned as the two INVARIANTS it exists to hold
 * rather than as a snapshot of its contents.
 *
 * A snapshot test here would be worse than nothing: the whole point of deriving
 * the map from `DEFAULT_METADATA_TYPE_REGISTRY` is that it CHANGES when a type
 * is declared, so a test that froze its contents would have to be edited on
 * every legitimate change and would teach the next author to re-bless it
 * without reading. These assertions are quantified over the registry instead —
 * declare a new type and they cover it automatically.
 *
 * #8424 — everything here goes through the module's PUBLIC surface
 * (`META_URL_TO_SINGULAR` · `canonicalMetaUrlType` · `metaUrlSpellingRefusal`).
 * The helpers behind it are module-internal by ruling, so the tests pin the
 * behaviour a consumer can actually reach, and the quantified cases derive
 * expected spellings from an independent mirror (see `expectedRestPlural`).
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '../kernel/metadata-plugin.zod';
import { PLURAL_TO_SINGULAR } from './metadata-collection.zod';
import {
  META_URL_TO_SINGULAR,
  canonicalMetaUrlType,
  metaUrlSpellingRefusal,
} from './metadata-url-spelling';

/**
 * Independent mirror of the module-internal pluralization rule (#8424). The
 * real rule is deliberately no longer exported, so the registry-quantified
 * invariants below derive the expected spelling themselves. The duplication is
 * the point: if the module's rule ever drifts from this mirror, the map stops
 * containing the mirror's spelling (or a verdict's `hint` stops matching) and
 * these assertions go red — drift becomes visible instead of silent.
 */
function expectedRestPlural(type: string): string {
  if (/[^aeiou]y$/.test(type)) return `${type.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(type)) return `${type}es`;
  return `${type}s`;
}

describe('#7894 INVARIANT 1 — no spelling that worked before may stop working', () => {
  it('folds every manifest spelling to exactly the singular it folded to before', () => {
    // The manifest map is the complete population of spellings that resolved at
    // the `/meta` boundary before this change, so quantifying over it IS the
    // non-breaking proof. It includes six that name PLUGIN kinds with no static
    // registry entry (`themes`, `webhooks`, `connectors`, `sharingRules`,
    // `ragPipelines`, `analyticsCubes`) — a purely registry-derived map would
    // have dropped those, which is why the derived limb is unioned rather than
    // substituted.
    for (const [plural, singular] of Object.entries(PLURAL_TO_SINGULAR)) {
      expect(canonicalMetaUrlType(plural), `${plural} must still fold to ${singular}`).toBe(singular);
    }
  });

  it('refuses none of them', () => {
    for (const plural of Object.keys(PLURAL_TO_SINGULAR)) {
      expect(metaUrlSpellingRefusal(plural), `${plural} works today and must not be refused`).toBeNull();
    }
  });

  it('carries the six plugin-kind spellings that no registry derivation could produce', () => {
    // Named explicitly because losing them is the specific regression the
    // union-vs-pure-derivation choice was made to avoid, and a reader needs to
    // see the population rather than infer it.
    const registryTypes = new Set<string>(DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type));
    const pluginOnly = Object.entries(PLURAL_TO_SINGULAR).filter(([, s]) => !registryTypes.has(s));
    expect(pluginOnly.map(([p]) => p).sort()).toEqual(
      ['analyticsCubes', 'connectors', 'ragPipelines', 'sharingRules', 'themes', 'webhooks'],
    );
    for (const [plural, singular] of pluginOnly) {
      expect(canonicalMetaUrlType(plural)).toBe(singular);
    }
  });
});

describe('#7894 INVARIANT 2 — no unmapped spelling of a DECLARED type may answer 200', () => {
  it('maps the REST plural of every declared registry type', () => {
    // This is the limb that makes the defect non-recurring: it is quantified
    // over the registry, so a newly declared type arrives already mapped and
    // can never fall through to the permissive plugin path. The expected
    // plural comes from the independent mirror, so this also cross-checks the
    // module-internal pluralizer against a second spelling of the same rule.
    for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
      const plural = expectedRestPlural(entry.type);
      expect(canonicalMetaUrlType(plural), `${plural} must fold to ${entry.type}`).toBe(entry.type);
      expect(metaUrlSpellingRefusal(plural)).toBeNull();
    }
  });

  it('leaves every declared singular as its own canonical form', () => {
    for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
      expect(canonicalMetaUrlType(entry.type)).toBe(entry.type);
      expect(metaUrlSpellingRefusal(entry.type)).toBeNull();
    }
  });

  it('closes the four types the card measured as unmapped', () => {
    // The regression coordinates themselves. Each of these folded to ITSELF
    // before the fix — i.e. was treated as a plugin type — and `field` was the
    // live authorization hole.
    for (const type of ['field', 'seed', 'external_catalog', 'translation']) {
      const plural = expectedRestPlural(type);
      expect(PLURAL_TO_SINGULAR[plural], `${plural} must stay OUT of the manifest map`).toBeUndefined();
      expect(canonicalMetaUrlType(plural)).toBe(type);
    }
  });

  it('handles the consonant-y irregular so `capability` is not spelled `capabilitys`', () => {
    // The y→ies limb, pinned twice through the public surface: the map was
    // BUILT with the real rule (so `capabilities` resolving proves the limb),
    // and the verdict's `hint` is DERIVED with it at call time.
    expect(canonicalMetaUrlType('capabilities')).toBe('capability');
    expect(metaUrlSpellingRefusal('capabilitys')).toEqual({ declared: 'capability', hint: 'capabilities' });
  });

  it('addresses snake_case types in both snake and camel plural', () => {
    expect(canonicalMetaUrlType('external_catalogs')).toBe('external_catalog');
    expect(canonicalMetaUrlType('externalCatalogs')).toBe('external_catalog');
    expect(canonicalMetaUrlType('email_templates')).toBe('email_template');
    expect(canonicalMetaUrlType('emailTemplates')).toBe('email_template');
  });

  it('never lets one spelling name two types', () => {
    // The module asserts this at load; assert it here too so the failure is
    // attributable to a test rather than to an import side effect.
    for (const [plural, singular] of Object.entries(PLURAL_TO_SINGULAR)) {
      expect(META_URL_TO_SINGULAR[plural]).toBe(singular);
    }
  });
});

describe('#7894 — the refusal limb is narrow by construction', () => {
  it('refuses an unrecognised plural of a declared type, naming that type and its spelling', () => {
    expect(metaUrlSpellingRefusal('capabilitys')).toEqual({ declared: 'capability', hint: 'capabilities' });
    expect(metaUrlSpellingRefusal('objectes')).toEqual({ declared: 'object', hint: 'objects' });
    expect(metaUrlSpellingRefusal('fieldes')).toEqual({ declared: 'field', hint: 'fields' });
  });

  it('POSITIVE CONTROL — cannot refuse a plugin kind, whatever it is named', () => {
    // The safety property that lets this rule be STATIC instead of consulting
    // the live registered-type set. A live lookup would refuse a plugin kind
    // whenever registration had not happened yet — turning an authorization fix
    // into a plugin-registration outage, a worse defect than the bypass.
    //
    // The `s`-final names are the sharp cases: a naive "looks plural" heuristic
    // would refuse all four, and they are ordinary English words a plugin might
    // well use for a kind.
    for (const kind of [
      'theme', 'sharing_rule', 'webhook', 'rag_pipeline', 'analytics_cube', 'connector',
      'my_plugin_kind', 'address', 'status', 'kudos', 'analysis', 'series',
    ]) {
      expect(metaUrlSpellingRefusal(kind), `${kind} must not be refused`).toBeNull();
      expect(canonicalMetaUrlType(kind)).toBe(kind);
    }
  });

  it('documents its residue rather than pretending to be total', () => {
    // A spelling that is not a plural of anything is indistinguishable from a
    // plugin kind by static means, so it still takes the plugin path. Pinned so
    // the limitation is a stated fact rather than an unnoticed gap; closing it
    // needs the live registered-type set at the boundary.
    expect(metaUrlSpellingRefusal('fieldz')).toBeNull();
  });

  it('refuses a wrong plural of EVERY declared type, naming that type (#8424)', () => {
    // Registry-quantified successor to the retired `DECLARED_META_TYPES`
    // membership pin: a type is refusable-when-misspelled iff it is in the
    // declared set, so quantifying the refusal over the registry pins the
    // set's whole population through the public verdict. `<type>es` is a
    // recognisable-but-wrong plural for every declared type except one whose
    // REAL plural is the `es` form — for those the spelling is in the map and
    // there is nothing wrong to spell, so they are skipped (their correct
    // plural is covered by INVARIANT 2's first case).
    for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
      const wrong = `${entry.type}es`;
      if (wrong in META_URL_TO_SINGULAR) continue;
      expect(metaUrlSpellingRefusal(wrong), `${wrong} must be refused as a misspelling of ${entry.type}`)
        .toEqual({ declared: entry.type, hint: expectedRestPlural(entry.type) });
    }
    // And the plugin-kind half of the retired pin: no plugin kind is declared,
    // which the POSITIVE CONTROL above already quantifies by behaviour.
  });
});

describe('#7894 — the manifest map keeps its own job', () => {
  it('gains no `fields` collection, so the authoring lint advertises none', () => {
    // `kernel/metadata-authoring-lint.ts` iterates `PLURAL_TO_SINGULAR` to
    // decide which stack-level collections exist and which "did you mean" hints
    // it may emit. A `fields` key here would advertise a top-level
    // `fields: [...]` collection that does not exist and collides conceptually
    // with `ObjectSchema.fields` — which is exactly why the four missing keys
    // were NOT simply added to this map.
    for (const key of ['fields', 'seeds', 'translations', 'external_catalogs', 'externalCatalogs']) {
      expect(PLURAL_TO_SINGULAR[key], `${key} must not enter the manifest map`).toBeUndefined();
    }
  });
});
