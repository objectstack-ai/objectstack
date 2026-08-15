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
  unrecognisedMetaTypeRefusal,
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
    //
    // [#8421] Untouched — every assertion below is the one #7894 wrote, and it
    // still passes for the reason it always did: THIS verdict is about
    // misspellings of DECLARED types and none of these is one. Read it as a
    // statement about `metaUrlSpellingRefusal`, not about the whole boundary:
    // `saveMetaItem` now also consults `unrecognisedMetaTypeRefusal`, under
    // which the six mapped kinds below stay writable and the six unmapped
    // names no longer are. That narrowing is pinned, deliberately visible, in
    // the `#8421` block at the bottom of this file.
    for (const kind of [
      'theme', 'sharing_rule', 'webhook', 'rag_pipeline', 'analytics_cube', 'connector',
      'my_plugin_kind', 'address', 'status', 'kudos', 'analysis', 'series',
    ]) {
      expect(metaUrlSpellingRefusal(kind), `${kind} must not be refused`).toBeNull();
      expect(canonicalMetaUrlType(kind)).toBe(kind);
    }
  });

  it('hands its residue to the OTHER verdict rather than widening (#8421 flipped this)', () => {
    // FLIPPED, not deleted (#8421 closed what #7894 left open, the way #7894
    // flipped what #7743 left behind).
    //
    // This case used to assert the gap itself: `fieldz` is not a plural of
    // anything, so nothing refused it and `PUT /meta/fieldz/x` answered 200
    // and minted a namespace. The FIRST half still holds and must keep
    // holding — `fieldz` reaches for no declared type, so this predicate has
    // nothing to say about it, which is exactly what keeps the POSITIVE
    // CONTROL above true by construction. What flipped is the second half:
    // the residue is now closed next door, so the predicate's silence is no
    // longer the whole story at the boundary.
    expect(metaUrlSpellingRefusal('fieldz')).toBeNull();
    expect(unrecognisedMetaTypeRefusal('fieldz')).toEqual({ type: 'fieldz' });
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

describe('#8421 — the second verdict: not a metadata type AT ALL', () => {
  it('accepts every declared type, canonical and REST-plural alike', () => {
    for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
      expect(unrecognisedMetaTypeRefusal(entry.type), `${entry.type} is declared`).toBeNull();
      expect(unrecognisedMetaTypeRefusal(expectedRestPlural(entry.type))).toBeNull();
    }
  });

  it('accepts every manifest spelling AND the singular each one folds to', () => {
    // The direction that matters most, and the one a registry-quantified
    // refusal would get wrong: six of these singulars — `theme`, `webhook`,
    // `connector`, `sharing_rule`, `analytics_cube`, `rag_pipeline` — are
    // PLUGIN kinds with no static registry entry at all. Refusing them would
    // break `PUT /meta/theme/dark`, the exact operation the plugin path exists
    // to serve, which is the failure #8421's measurement disqualified option C
    // for. Accepting the singular is not decoration: `themes` folds to `theme`,
    // and a boundary that refused the fold's own output would be incoherent.
    for (const [plural, singular] of Object.entries(PLURAL_TO_SINGULAR)) {
      expect(unrecognisedMetaTypeRefusal(plural), `${plural} works today`).toBeNull();
      expect(
        unrecognisedMetaTypeRefusal(singular),
        `${singular} is what ${plural} folds to`,
      ).toBeNull();
    }
  });

  it('carries the six plugin kinds by NAME, since quantification hides them', () => {
    const declared = new Set<string>(DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type));
    for (const kind of [
      'analytics_cube', 'connector', 'rag_pipeline', 'sharing_rule', 'theme', 'webhook',
    ]) {
      expect(declared.has(kind), `${kind} must NOT be in the static registry`).toBe(false);
      expect(unrecognisedMetaTypeRefusal(kind), `${kind} must stay accepted anyway`).toBeNull();
    }
  });

  it('refuses the card coordinates — a name the contract does not carry', () => {
    for (const type of ['fieldz', 'objectt', 'viewz', 'nonsense_type']) {
      expect(unrecognisedMetaTypeRefusal(type)).toEqual({ type });
    }
  });

  it('CHANGED BEHAVIOUR — an unmapped plugin-kind NAME is no longer mintable', () => {
    // Its own case rather than folded into the one above, because this is the
    // accept-set narrowing the ruling bought and a reviewer must see it.
    //
    // The POSITIVE CONTROL further up is untouched and still green: none of
    // these is a misspelling of a declared type, so `metaUrlSpellingRefusal`
    // cannot refuse any of them, exactly as #7894 built it. What changed is
    // that `saveMetaItem` consults BOTH verdicts, so a kind whose name is in
    // neither half of the static contract can no longer be CREATED through
    // `PUT /meta/:type/:name`.
    //
    // Safe by construction only because #8586 retired `additionalTypes`: with
    // no declared-kind channel left, an unrecognised name cannot be a
    // declaration this predicate never heard about. If a declared-kind channel
    // is ever reintroduced, this case is the one that must be revisited FIRST.
    for (const kind of ['my_plugin_kind', 'address', 'status', 'kudos', 'analysis', 'series']) {
      expect(metaUrlSpellingRefusal(kind), `${kind} is still not a misspelling`).toBeNull();
      expect(
        unrecognisedMetaTypeRefusal(kind),
        `${kind} is outside the static contract`,
      ).toEqual({ type: kind });
    }
  });

  it('never refuses a spelling the fold is prepared to canonicalize', () => {
    // Composition guard over the whole map: refusing an input the boundary
    // would happily fold, or refusing the fold's own output, is incoherent in
    // a way no single fixture would catch.
    for (const spelling of Object.keys(META_URL_TO_SINGULAR)) {
      expect(unrecognisedMetaTypeRefusal(spelling), `${spelling} is mapped`).toBeNull();
      expect(
        unrecognisedMetaTypeRefusal(canonicalMetaUrlType(spelling)),
        `${spelling} folds to a type the verdict must also accept`,
      ).toBeNull();
    }
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
