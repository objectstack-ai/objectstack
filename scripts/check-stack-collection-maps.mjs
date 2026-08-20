#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-stack-collection-maps -- every enumeration of the stack-collection set
// must be ANSWERABLE to `ObjectStackDefinitionSchema` (#6242).
//
//   node scripts/check-stack-collection-maps.mjs              # run the gate
//   node scripts/check-stack-collection-maps.mjs --list       # print every reconciliation
//   node scripts/check-stack-collection-maps.mjs --self-test  # verify the checker itself
//
// ## The hole this closes (#6242)
//
// `ObjectStackDefinitionSchema` (`packages/spec/src/stack.zod.ts`) decides which
// collections a stack may declare. SEVEN other places re-enumerate that same set
// by hand: the map-format field list, the plural->singular map, the artifact
// category enum, the ObjectQL registration seam, the artifact-ingest field map,
// the runtime's app-payload probe and the showcase coverage manifest -- and
// until this gate NOTHING compared any of them to the schema or to each other.
// They drifted independently and invisibly:
//
// (Eight, when this gate was written: ObjectQL declared its list TWICE, once per
// registration seam, and the two copies had drifted four collections apart --
// recorded here as a waiver row until #7049 hoisted the single
// `METADATA_ARRAY_KEYS` both seams now read. A divergence between two copies is
// the one deviation no reading of either copy alone produces, which is the
// argument for this gate in one line.)
//
//   - `PLURAL_TO_SINGULAR` carries `ragPipelines`, which the schema does not
//     declare.
//   - `metadataArrayKeys` still lists `workflows` / `approvals` / `roles` /
//     `profiles` / `policies` -- kinds retired across ADR-0019, ADR-0020,
//     ADR-0088 and ADR-0090.
//   - `ARTIFACT_FIELD_TO_TYPE` mapped the SEED collection (`data:`) onto the
//     ANALYTICS kind name (`dataset`) -- the exact collision the registry entry
//     warns about in prose -- and omits five live collections.
//   - `MetadataCategoryEnum` lists retired `triggers`/`workflows` and omits most
//     of the live set.
//
// Every row above looks like a one-line typo in isolation, and each HAS been
// fixed one line at a time before (`docs` in `ARTIFACT_FIELD_TO_TYPE`, `roles`
// -> `positions` in the same map, `capabilities` in `metadataArrayKeys`), each
// carrying a "this key was missing and it silently dropped X" comment today. The
// cause is structural: `KIND_COVERAGE` is answerable to the metadata-type
// registry and fails CI when a kind is added without an entry, and the liveness
// ledger is answerable to the same registry. The collection-key maps had no such
// gate, so the same defect kept being re-filed one instance at a time.
//
// ## What "answerable" means here
//
// DERIVING all seven from the schema is not possible today: they disagree on
// purpose as often as by accident (`views` has no `name`, `data` seeds key by
// `object`, `translations` is a record, an artifact category is a directory
// layout rather than a registration). So each site is PINNED instead -- the gate
// reconciles it against the schema in BOTH directions and every deviation must
// be a `WAIVERS` row carrying a reason. Same shape as the liveness ledger's
// undrilled baseline: a deviation that is deliberate is cheap to record, and one
// that is drift has nowhere to hide.
//
// The waiver list is a RATCHET. A waiver that no longer applies (the key came
// back, or the drift was fixed) FAILS, exactly like a stale ledger row -- an
// overstated debt misleads as much as an unrecorded one.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// ───────────────────────────────────────────────────────────────────────────
// Extraction -- pure, over source text
// ───────────────────────────────────────────────────────────────────────────
//
// These read SOURCE, not a build output, deliberately: this gate runs in the
// lint job, which does not build the workspace, and four of the seven sites live
// in packages `@objectstack/spec` must not import. Every extractor returns
// `null` when its anchor is gone, and the caller turns that into a FAILURE -- a
// rename that silently emptied a site would otherwise read as "no drift", which
// is the same silent-no-op shape this gate exists to catch.

/**
 * Slice the balanced `{...}` / `[...]` body that follows `anchor` in `source`
 * (the anchor's last character must be the opening bracket). Returns `null` when
 * the anchor is absent. `from` lets a caller walk repeated occurrences of one
 * anchor -- no SITE needs it since #7049 collapsed ObjectQL's two copies into
 * one, but the next site that re-declares an anchor will, and the self-test
 * keeps the behaviour pinned.
 */
export function sliceBody(source, anchor, from = 0) {
  const at = source.indexOf(anchor, from);
  if (at === -1) return null;
  const mask = maskLiterals(source);
  const openAt = at + anchor.length - 1;
  const open = source[openAt];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openAt; i < source.length; i++) {
    const ch = mask[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { body: source.slice(openAt + 1, i), end: i };
    }
  }
  return null;
}

/**
 * Blank out everything a bracket counter must not read: comment bodies, string
 * and template contents, and regex literals. Returns a string of the SAME LENGTH
 * as the input, so every index still addresses the original source — callers
 * count structure on the mask and slice text from the original.
 *
 * Length-preserving masking rather than a `strip`: the first draft of this gate
 * stripped comments and counted brackets over the rest, and one unbalanced paren
 * inside PROSE — `.describe('Screen Flows (ADR-0019)')` — closed the
 * `ObjectStackDefinitionSchema` literal 14 collections early. The gate then
 * reconciled all seven sites against a truncated source of truth and reported
 * 114 deviations, every one of them its own. A parser that fails toward "less
 * schema" makes every consumer look wrong, which is the loudest possible way to
 * be useless.
 *
 * String DELIMITERS survive (their contents do not), so a quoted object key and
 * an array of string literals are both still locatable by index.
 */
export function maskLiterals(source) {
  const out = source.split('');
  const blank = (from, to, keepDelimiters = false) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (keepDelimiters && (i === from || i === to - 1)) continue;
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  // A `/` opens a regex literal only where a value may start; anywhere else it
  // is division, and treating `a / b` as a regex would swallow the rest of the
  // file.
  const REGEX_PRECEDER = /[(,=:[!&|?{};+\-*%<>~^]$/;

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      const stop = nl === -1 ? source.length : nl;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === ch) break;
        j++;
      }
      blank(i, Math.min(j + 1, source.length), true);
      i = j + 1;
      continue;
    }
    if (ch === '/') {
      const before = source.slice(0, i).replace(/\s+$/, '');
      if (before === '' || REGEX_PRECEDER.test(before)) {
        let j = i + 1;
        let inClass = false;
        while (j < source.length && source[j] !== '\n') {
          if (source[j] === '\\') { j += 2; continue; }
          if (source[j] === '[') inClass = true;
          else if (source[j] === ']') inClass = false;
          else if (source[j] === '/' && !inClass) break;
          j++;
        }
        if (source[j] === '/') {
          blank(i, j + 1);
          i = j + 1;
          continue;
        }
      }
    }
    i++;
  }
  return out.join('');
}

/**
 * Top-level keys of an object-literal body, each with its value's source text.
 * Depth-aware: a nested literal never contributes its own keys.
 */
export function objectEntries(body) {
  const mask = maskLiterals(body);
  const out = [];
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = mask[i];
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; i++; continue; }
    if (depth === 0 && (i === 0 || /[\s,]/.test(mask[i - 1]))) {
      // Match the key on the MASK, never on the original: a comment body is
      // blanked there, and `/** ObjectQL: Data Layer */` reads as a perfectly
      // good `key:` in the original text. That mis-read cost the walk every
      // collection declared under a section banner — it consumed the fake entry
      // and skipped forward past the real one.
      const window = mask.slice(i, i + 80);
      const bare = /^([A-Za-z_$][\w$]*)\s*:/.exec(window);
      const quoted = /^(['"])\s*\1\s*:/.test(window)
        ? /^(['"])([A-Za-z_$][\w$]*)\1\s*:/.exec(body.slice(i, i + 80))
        : null;
      const m = bare ? { 0: bare[0], key: bare[1] } : quoted ? { 0: quoted[0], key: quoted[2] } : null;
      if (m) {
        const valueStart = i + m[0].length;
        let j = valueStart;
        let d = 0;
        while (j < body.length) {
          const c = mask[j];
          if (c === '{' || c === '[' || c === '(') d++;
          else if (c === '}' || c === ']' || c === ')') d--;
          else if (c === ',' && d === 0) break;
          j++;
        }
        out.push({ key: m.key, value: body.slice(valueStart, j).trim() });
        i = j;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** String literals at depth 0 of an array-literal body. */
export function stringArrayItems(body) {
  const mask = maskLiterals(body);
  const out = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = mask[i];
    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue; }
    if (depth === 0 && (ch === "'" || ch === '"')) {
      const end = mask.indexOf(ch, i + 1);
      if (end === -1) break;
      out.push(body.slice(i + 1, end));
      i = end;
    }
  }
  return out;
}

/**
 * The stack-collection set: top-level `ObjectStackDefinitionSchema` keys whose
 * value is `z.array(<Something>Schema)`.
 *
 * That shape is the discriminator, and it is what keeps this mechanical instead
 * of a second hand-maintained list: `plugins` (`z.array(z.unknown())`),
 * `requires` / `tiers` (`z.array(z.string())`) and `devPlugins` (a union) are
 * arrays but not metadata collections, and no site is expected to carry them.
 */
export function stackCollections(stackSource) {
  // #8687 closed the top level with the shared `strictObject` template
  // (`shared/strict-object.ts`): the FIRST argument is the authoring-surface
  // options object (surface / history / guidance) and the SECOND is the shape
  // this gate reads. Slice the options body to find where it ends, then slice
  // the shape body that opens right after it.
  const options = sliceBody(
    stackSource,
    'export const ObjectStackDefinitionSchema = lazySchema(() => strictObject({',
  );
  if (!options) return null;
  const shape = sliceBody(stackSource, '{', options.end + 1);
  if (!shape) return null;
  return objectEntries(shape.body)
    .filter(({ value }) => /^z\.array\(\s*[A-Za-z_$][\w$]*Schema\s*\)/.test(value))
    .map(({ key }) => key);
}

// ───────────────────────────────────────────────────────────────────────────
// Reconciliation -- pure
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reconcile one site against the schema set.
 * `extra`   = enumerated here, not declared by the schema (retired or invented).
 * `missing` = declared by the schema, not enumerated here.
 */
export function reconcileSite(schemaKeys, siteKeys) {
  const schema = new Set(schemaKeys);
  const site = new Set(siteKeys);
  return {
    extra: siteKeys.filter((k) => !schema.has(k)),
    missing: schemaKeys.filter((k) => !site.has(k)),
  };
}

/**
 * Apply a site's waiver rows to its reconciliation. Returns the deviations that
 * are NOT waived, plus the waivers that no longer apply (the ratchet -- a stale
 * waiver is drift in the opposite direction).
 */
export function applyWaivers(recon, waivers) {
  const waived = (direction) =>
    new Set(waivers.filter((w) => w.direction === direction).flatMap((w) => w.keys));
  const waivedExtra = waived('extra');
  const waivedMissing = waived('missing');
  const extraSet = new Set(recon.extra);
  const missingSet = new Set(recon.missing);
  return {
    extra: recon.extra.filter((k) => !waivedExtra.has(k)),
    missing: recon.missing.filter((k) => !waivedMissing.has(k)),
    staleWaivers: [
      ...[...waivedExtra]
        .filter((k) => !extraSet.has(k))
        .map((k) => `${k} — waived as an EXTRA key, but the site no longer enumerates it`),
      ...[...waivedMissing]
        .filter((k) => !missingSet.has(k))
        .map((k) => `${k} — waived as MISSING, but the site now enumerates it`),
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The seven sites, and the waiver each deviation must carry
// ───────────────────────────────────────────────────────────────────────────
//
// A waiver row is `{ direction, keys, reason }`. `direction: 'extra'` waives a
// key the site enumerates and the schema does not; `direction: 'missing'` waives
// a schema collection the site deliberately (or, for recorded drift, knowingly)
// omits. The reason is the whole value of the row -- "these are the deliberate
// omissions" as a bare list is exactly the unfalsifiable claim this gate
// replaces.
//
// ⛔ A waiver is NOT permission. Rows that record DRIFT rather than design name
// the issue that tracks removing them; when that issue lands, the row must go or
// the ratchet fails.

const SITES = [
  {
    id: 'MAP_SUPPORTED_FIELDS',
    file: 'packages/spec/src/shared/metadata-collection.zod.ts',
    what: 'collections whose map/record authoring form is normalized into an array',
    extract: (src) => {
      const b = sliceBody(src, 'export const MAP_SUPPORTED_FIELDS = [');
      return b && stringArrayItems(b.body);
    },
    waivers: [
      {
        direction: 'missing',
        keys: ['views', 'objectExtensions', 'data', 'translations'],
        reason:
          'the four SHAPE exclusions the declaration already documents, pinned here so the prose is checked: '
          + 'ViewSchema has no `name` (its identity is the target object), ObjectExtensionSchema keys by '
          + '`extend`, SeedSchema keys by `object`, and TranslationBundleSchema is itself a record.',
      },
      {
        direction: 'missing',
        keys: ['datasourceMapping', 'capabilities', 'docs', 'books', 'tools', 'skills'],
        reason:
          'no map form has ever been offered for these. `datasourceMapping` is a rule LIST whose precedence is '
          + 'positional, so a map would lose the ordering that decides which rule wins; the other five are '
          + 'array-only authoring surfaces. Offering a map form for any of them WIDENS what parses — an '
          + 'acceptance change, which belongs to its own reviewed diff rather than to this gate.',
      },
    ],
  },
  {
    id: 'PLURAL_TO_SINGULAR',
    file: 'packages/spec/src/shared/metadata-collection.zod.ts',
    what: 'plural stack key -> singular metadata type name',
    extract: (src) => {
      const b = sliceBody(src, 'export const PLURAL_TO_SINGULAR: Record<string, string> = {');
      return b && objectEntries(b.body).map((e) => e.key);
    },
    waivers: [
      {
        direction: 'extra',
        keys: ['ragPipelines'],
        reason:
          'DRIFT, recorded not blessed (#6242 row 2). `ragPipelines` is not declared by '
          + 'ObjectStackDefinitionSchema, so this mapping cannot be reached from a parsed stack: '
          + '`pluralToSingular` is called with keys that came OFF a stack. Inert, and removing it is a '
          + 'behavioural change to a published spec export — its own diff, tracked in #6242.',
      },
      {
        direction: 'missing',
        keys: ['datasourceMapping', 'translations', 'objectExtensions', 'data'],
        reason:
          'there is no singular metadata-type name to map to. `objectExtensions` merges into its target '
          + 'object rather than registering as a type, `datasourceMapping` is stack-level routing '
          + 'configuration, `translations` is a bundle record consumed by the i18n resolvers, and `data` '
          + 'seeds are applied by SeedLoaderService. `pluralToSingular` returns its input unchanged for all '
          + 'four, which is the correct answer rather than a gap.',
      },
    ],
  },
  {
    id: 'MetadataCategoryEnum',
    file: 'packages/spec/src/kernel/package-artifact.zod.ts',
    what: 'metadata categories an artifact may carry (one subdirectory each)',
    extract: (src) => {
      const b = sliceBody(src, 'export const MetadataCategoryEnum = z.enum([');
      return b && stringArrayItems(b.body);
    },
    waivers: [
      {
        direction: 'extra',
        keys: ['triggers', 'workflows'],
        reason:
          'DRIFT, and NOT removable from here: this enum is an ACCEPTANCE face — dropping a member changes '
          + 'what a published artifact may declare, a protocol-breaking change owing an ADR-0087 conversion. '
          + 'Recorded so the enum stops reading as an answerable enumeration (#6242 row 5).',
      },
      {
        direction: 'missing',
        keys: [
          'datasources', 'datasourceMapping', 'objectExtensions', 'apps', 'jobs', 'emailTemplates',
          'docs', 'books', 'positions', 'capabilities', 'sharingRules', 'webhooks', 'tools', 'skills',
          'hooks', 'mappings', 'analyticsCubes', 'connectors', 'data',
        ],
        reason:
          'DRIFT in the opposite direction, under the same acceptance constraint: ADDING a member widens '
          + 'what an artifact may declare and presumes a packaging layout (one subdirectory per category) '
          + 'that does not exist for these. The omissions are inert today because this enum is not the '
          + 'artifact ingest path — `ARTIFACT_FIELD_TO_TYPE` below is — but 19 of 32 collections absent is '
          + 'the measurement that says so out loud (#6242 row 5).',
      },
    ],
  },
  {
    // ONE site, not two, since #7049. `engine.ts` used to declare this list
    // twice -- once inside the manifest registration loop and once inside
    // `registerPlugin` -- and the two copies had drifted: `jobs`,
    // `emailTemplates`, `tools` and `skills` registered from a manifest and NOT
    // from a nested plugin, so a package shipping them from a nested plugin
    // registered nothing and stamped no ADR-0010 provenance. That divergence
    // was recorded here as a waiver row on the nested copy; #7049 closed it by
    // hoisting ONE `METADATA_ARRAY_KEYS` both seams read, so the row is gone
    // with the thing it recorded and the gate now pins the single enumeration
    // that remains. (Hand-adding the four names to the second copy was the
    // available alternative and is what #5870 did for `capabilities`; it is
    // what left the other four undiffed.)
    id: 'METADATA_ARRAY_KEYS',
    file: 'packages/objectql/src/engine.ts',
    what: 'collections the engine registers from a manifest AND from a nested plugin (the ADR-0010 provenance seam)',
    extract: (src) => {
      const b = sliceBody(src, 'const METADATA_ARRAY_KEYS = [');
      return b && stringArrayItems(b.body);
    },
    waivers: [
      {
        direction: 'extra',
        keys: ['workflows', 'approvals', 'roles', 'profiles', 'policies', 'ragPipelines'],
        reason:
          'DRIFT — six kinds retired across ADR-0019 / ADR-0020 / ADR-0088 / ADR-0090 that this loop still '
          + 'iterates. Inert: `(manifest as any)[key]` is `undefined` for every one, because the schema '
          + 'rejects the keys long before the loop runs. Removing them is an `engine-core` source change '
          + '(#6242 row 3) and rides that lane, not this gate.',
      },
      {
        direction: 'missing',
        keys: ['objects', 'objectExtensions', 'apps', 'translations', 'datasourceMapping', 'datasources', 'data'],
        reason:
          'registered by a DIFFERENT seam rather than dropped: objects and objectExtensions go through the '
          + 'object-merge path (an extension overlays its target before registration), `apps` is registered '
          + 'by AppPlugin, `translations` and `datasourceMapping` are stack configuration, `datasources` are '
          + 'consumed as CONNECTIONS (driver handles built at boot), and `data` seeds are applied by '
          + 'SeedLoaderService. This row is why the gate reconciles both directions with reasons instead of '
          + 'demanding equality.',
      },
      {
        direction: 'missing',
        keys: ['positions'],
        reason:
          'ADR-0090 D3 positions reach the registry through the security bootstrap, which reads them off the '
          + 'stack directly; the loop\'s sibling `permissions` entry is what makes the absence look like a gap.',
      },
    ],
  },
  {
    id: 'ARTIFACT_FIELD_TO_TYPE',
    file: 'packages/metadata/src/plugin.ts',
    what: 'compiled-artifact field -> metadata type registered into MetadataManager',
    extract: (src) => {
      const b = sliceBody(src, 'const ARTIFACT_FIELD_TO_TYPE: Record<string, string> = {');
      return b && objectEntries(b.body).map((e) => e.key);
    },
    waivers: [
      {
        direction: 'extra',
        keys: ['workflows', 'policies', 'ragPipelines'],
        reason:
          'DRIFT — retired kinds still mapped, inert for the same reason as the ObjectQL loops: a parsed '
          + 'artifact cannot carry the fields (#6242 row 4).',
      },
      {
        direction: 'missing',
        keys: ['data'],
        reason:
          'DELIBERATE, and the resolution of #6242 row 4(a). `data:` is the SEED collection, and this map '
          + 'used to send it to `dataset` — the ADR-0021 analytics kind, the exact collision '
          + '`metadata-plugin.zod.ts` warns about in prose. The entry was provably inert (SeedSchema declares '
          + 'no `name`; the ingest loop skips nameless items) so it registered nothing, but it was aimed at '
          + 'the wrong kind and would have begun mis-registering the day either side moved. REMOVED in the '
          + 'change that added this gate, rather than repointed at `seed`: seeds are applied by '
          + 'SeedLoaderService off the bundle, never registered as metadata items, so a `seed` mapping would '
          + 'be new behaviour needing its own verification.',
      },
      {
        direction: 'missing',
        keys: ['datasets', 'jobs', 'datasources', 'translations', 'capabilities'],
        reason:
          'DRIFT with a real, bounded consequence — #6242 row 4(b). Four of the five are consumed '
          + 'functionally by AppPlugin straight off the bundle, so boot is not broken; what they never do is '
          + 'register as METADATA ITEMS, so under `bootstrap: \'artifact-only\'` (edge / serverless / '
          + 'immutable image) `GET /meta/job`, `/meta/translation`, `/meta/datasource` and `/meta/dataset` '
          + 'answer empty for a package that ships them. Adding them changes what a sealed runtime serves '
          + 'and must be measured on a real artifact-only boot first — the filing card says so, and this '
          + 'gate does not smuggle it in.',
      },
      {
        direction: 'missing',
        keys: ['datasourceMapping'],
        reason: 'stack-level routing configuration, never a registry item.',
      },
    ],
  },
  {
    id: 'APP_CATEGORY_KEYS',
    file: 'packages/runtime/src/app-plugin.ts',
    what: 'keys whose presence means "this bundle was supposed to register an app"',
    extract: (src) => {
      const b = sliceBody(src, 'const APP_CATEGORY_KEYS = [');
      return b && stringArrayItems(b.body);
    },
    waivers: [
      {
        direction: 'extra',
        keys: ['workflows', 'triggers', 'ragPipelines'],
        reason:
          'DRIFT — three retired kinds in a probe that can never see them. This is the SEVENTH enumeration '
          + 'of the set, found by writing this gate rather than by hand: the card that catalogued the drift '
          + 'listed six sites and did not have this one.',
      },
      {
        direction: 'missing',
        keys: [
          'objectExtensions', 'datasourceMapping', 'datasources', 'themes', 'jobs', 'apis', 'webhooks',
          'hooks', 'mappings', 'analyticsCubes', 'connectors', 'capabilities', 'datasets',
        ],
        reason:
          'DELIBERATE, and load-bearing. This is a HEURISTIC, not a registration list: it answers "did the '
          + 'author mean to ship an app here?" for a bundle with no app id, and its failure directions are '
          + 'asymmetric — a false positive throws on a brand-new empty environment, a false negative only '
          + 'degrades to a no-op plugin. So it lists the user-visible app payload, not every legal '
          + 'collection. Pinned rather than completed, so a NEW collection has to be considered here once.',
      },
    ],
  },
  {
    id: 'STACK_COLLECTION_COVERAGE',
    file: 'examples/app-showcase/src/coverage.ts',
    what: 'stack collections the showcase demonstrates or waives (the non-registry-kind half)',
    extract: (src) => {
      const b = sliceBody(src, 'export const STACK_COLLECTION_COVERAGE: Record<string, KindCoverage> = {');
      return b && objectEntries(b.body).map((e) => e.key);
    },
    // The sibling `KIND_COVERAGE` manifest covers every collection that IS a
    // registry kind, and its own test ratchets it against
    // DEFAULT_METADATA_TYPE_REGISTRY. Reconciling this half against the whole
    // schema set would report those as missing, so the gate subtracts them
    // first — this manifest is answerable only for the remainder.
    kindCovered: true,
    waivers: [
      {
        direction: 'missing',
        keys: ['datasourceMapping', 'translations', 'themes', 'data', 'sharingRules', 'webhooks'],
        reason:
          'NOT DEMONSTRATED, and visible for the first time. This manifest tracked 3 of the non-kind '
          + 'collections and — unlike its ratcheted sibling `KIND_COVERAGE` — was answerable to nothing '
          + '(#6242 row 6). Demonstrating a collection is example-app work with its own review; this row is '
          + 'the ratchet that stops the list reading as complete in the meantime.',
      },
    ],
  },
];

/**
 * Collections already covered by the showcase's ratcheted `KIND_COVERAGE`
 * manifest, resolved through the spec's own plural->singular map so the two
 * halves are compared in one vocabulary.
 */
export function kindCoveredCollections(coverageSource, pluralToSingular, schemaKeys) {
  const b = sliceBody(coverageSource, 'export const KIND_COVERAGE: Record<MetadataType, KindCoverage> = {');
  if (!b) return null;
  const kinds = new Set(objectEntries(b.body).map((e) => e.key));
  return schemaKeys.filter((k) => kinds.has(pluralToSingular[k] ?? k));
}

// ───────────────────────────────────────────────────────────────────────────
// Runner
// ───────────────────────────────────────────────────────────────────────────

function readSource(rel) {
  const abs = join(repoRoot, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

function pluralToSingularMap(specSource) {
  const b = sliceBody(specSource, 'export const PLURAL_TO_SINGULAR: Record<string, string> = {');
  if (!b) return null;
  const out = {};
  for (const { key, value } of objectEntries(b.body)) {
    const m = /^['"]([\w-]+)['"]/.exec(value);
    if (m) out[key] = m[1];
  }
  return out;
}

function run({ list = false } = {}) {
  const failures = [];
  const stackSource = readSource('packages/spec/src/stack.zod.ts');
  if (!stackSource) {
    console.error('✗ packages/spec/src/stack.zod.ts not found — the source of truth is gone, not clean.');
    return 1;
  }
  const schemaKeys = stackCollections(stackSource);
  if (!schemaKeys || schemaKeys.length === 0) {
    console.error(
      '✗ could not extract the stack-collection set from ObjectStackDefinitionSchema.\n'
      + '  The declaration was renamed or reshaped. Fix the anchor in this script — an empty set would\n'
      + '  make every site below reconcile perfectly against nothing.',
    );
    return 1;
  }

  const collectionSource = readSource('packages/spec/src/shared/metadata-collection.zod.ts');
  const singular = collectionSource ? pluralToSingularMap(collectionSource) : null;

  console.log(
    `stack-collection set: ${schemaKeys.length} collections declared by ObjectStackDefinitionSchema\n`,
  );

  for (const site of SITES) {
    const src = readSource(site.file);
    if (!src) {
      failures.push(`${site.id} — ${site.file} does not exist`);
      continue;
    }
    const siteKeys = site.extract(src);
    if (!siteKeys || siteKeys.length === 0) {
      failures.push(
        `${site.id} — could not extract the enumeration from ${site.file}.\n`
        + `    The symbol was renamed, moved or reshaped. An unextractable site is a FAILURE, never a pass:\n`
        + `    an empty list reconciles against everything.`,
      );
      continue;
    }

    let expected = schemaKeys;
    if (site.kindCovered) {
      const covered = singular ? kindCoveredCollections(src, singular, schemaKeys) : null;
      if (!covered) {
        failures.push(`${site.id} — could not resolve the sibling KIND_COVERAGE manifest it splits with`);
        continue;
      }
      const coveredSet = new Set(covered);
      expected = schemaKeys.filter((k) => !coveredSet.has(k));
    }

    const recon = reconcileSite(expected, siteKeys);
    const result = applyWaivers(recon, site.waivers ?? []);

    if (list) {
      console.log(`── ${site.id} (${site.file})`);
      console.log(`   ${site.what}`);
      console.log(`   ${siteKeys.length} enumerated · ${recon.extra.length} extra · ${recon.missing.length} missing · ${(site.waivers ?? []).length} waiver row(s)`);
      if (recon.extra.length) console.log(`   extra:   ${recon.extra.join(', ')}`);
      if (recon.missing.length) console.log(`   missing: ${recon.missing.join(', ')}`);
      console.log('');
    }

    for (const k of result.extra) {
      failures.push(
        `${site.id} enumerates \`${k}\`, which ObjectStackDefinitionSchema does not declare (${site.file}).\n`
        + `    Either remove it, or add a WAIVERS row with the reason it stays.`,
      );
    }
    for (const k of result.missing) {
      failures.push(
        `${site.id} omits \`${k}\`, which ObjectStackDefinitionSchema declares (${site.file}).\n`
        + `    Either add it, or add a WAIVERS row with the reason it is deliberately absent.`,
      );
    }
    for (const stale of result.staleWaivers) {
      failures.push(
        `${site.id} carries a STALE waiver: ${stale}.\n`
        + `    Delete the row — an overstated debt misleads as much as an unrecorded one.`,
      );
    }
  }

  if (failures.length) {
    console.error(`✗ check-stack-collection-maps — ${failures.length} unreconciled deviation(s):\n`);
    for (const f of failures) console.error(`  • ${f}\n`);
    console.error(
      '  Every enumeration of the stack-collection set must be answerable to stack.zod.ts (#6242).\n'
      + '  A deviation is legal only as a WAIVERS row carrying the reason, in scripts/check-stack-collection-maps.mjs.',
    );
    return 1;
  }

  const waiverRows = SITES.reduce((n, s) => n + (s.waivers ?? []).length, 0);
  console.log(
    `✓ check-stack-collection-maps: ${SITES.length} enumerations reconciled against `
    + `${schemaKeys.length} declared collections (${waiverRows} waiver rows, each with a reason).`,
  );
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Self-test -- the extractors and the ratchet, over synthetic sources
// ───────────────────────────────────────────────────────────────────────────
//
// The gate is green on `main` by construction (the waiver table was written from
// its own output), so a green run proves nothing about whether it CAN fire. The
// assertions below drive both failure directions on synthetic input.

function selfTest() {
  const failures = [];
  const eq = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n      expected ${e}\n      actual   ${a}`);
  };

  const stack = `
export const ObjectStackDefinitionSchema = lazySchema(() => strictObject({
  surface: 'this stack definition',
  history: 'a history sentence with brackets { } that the options slice must survive',
  guidance: { storage: 'a prescription' },
}, {
  manifest: ManifestSchema.optional(),
  objects: z.array(ObjectSchema).optional().describe('Business Objects'),
  // a commented-out collection must NOT count:
  // ghosts: z.array(GhostSchema).optional(),
  plugins: z.array(z.unknown()).optional(),
  requires: z.array(z.string()).optional(),
  devPlugins: z.array(z.union([ManifestSchema, z.string()])).optional(),
  api: z.object({ nested: z.array(NestedSchema) }).optional(),
  data: z.array(SeedSchema).optional(),
}).superRefine(gates));
`;
  eq('stackCollections() takes z.array(<X>Schema) only', stackCollections(stack), ['objects', 'data']);
  eq('stackCollections() returns null when the anchor is gone', stackCollections('export const Other = 1;'), null);
  eq(
    'stackCollections() returns null when the shape argument is missing',
    stackCollections('export const ObjectStackDefinitionSchema = lazySchema(() => strictObject({ surface: \'x\' }));'),
    null,
  );

  eq(
    'stringArrayItems() ignores nested literals and comments',
    stringArrayItems(`'a', /* 'x' */ 'b', ['c'], // 'd'\n 'e',`),
    ['a', 'b', 'e'],
  );
  eq(
    'objectEntries() reads top-level keys only',
    objectEntries(`a: 'x', b: { c: 'y' }, 'd': 'z',`).map((e) => e.key),
    ['a', 'b', 'd'],
  );
  eq(
    'sliceBody() walks to the SECOND occurrence when asked',
    (() => {
      const src = `const k = ['a']; const k = ['b'];`;
      const first = sliceBody(src, 'const k = [');
      return stringArrayItems(sliceBody(src, 'const k = [', first.end).body);
    })(),
    ['b'],
  );

  const recon = reconcileSite(['objects', 'apps'], ['objects', 'workflows']);
  eq('reconcileSite() reports both directions', recon, { extra: ['workflows'], missing: ['apps'] });

  eq(
    'applyWaivers() silences a waived deviation',
    applyWaivers(recon, [
      { direction: 'extra', keys: ['workflows'], reason: 'retired' },
      { direction: 'missing', keys: ['apps'], reason: 'other seam' },
    ]),
    { extra: [], missing: [], staleWaivers: [] },
  );
  eq(
    'applyWaivers() leaves an unwaived deviation to fail',
    applyWaivers(recon, [{ direction: 'extra', keys: ['workflows'], reason: 'retired' }]).missing,
    ['apps'],
  );
  eq(
    'applyWaivers() fails a waiver that no longer applies (the ratchet)',
    applyWaivers({ extra: [], missing: [] }, [{ direction: 'extra', keys: ['gone'], reason: 'x' }]).staleWaivers,
    ['gone — waived as an EXTRA key, but the site no longer enumerates it'],
  );

  eq(
    'kindCoveredCollections() maps plural collections through the singular map',
    kindCoveredCollections(
      `export const KIND_COVERAGE: Record<MetadataType, KindCoverage> = { object: { status: 'demonstrated' }, api: { status: 'waived' } };`,
      { objects: 'object', apis: 'api', themes: 'theme' },
      ['objects', 'apis', 'themes'],
    ),
    ['objects', 'apis'],
  );

  if (failures.length) {
    console.error(`✗ check-stack-collection-maps --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}\n`);
    return 1;
  }
  console.log('✓ check-stack-collection-maps --self-test: 12 assertions over synthetic sources');
  return 0;
}

// Run only when executed directly: the pure halves above are imported by the
// self-test and by anything else that wants to ask what a site enumerates.
if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  process.exit(run({ list: argv.includes('--list') }));
}
