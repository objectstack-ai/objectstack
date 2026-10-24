/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectMap Component
 * 
 * A specialized map visualization component that works with ObjectQL data sources.
 * Displays records as markers/pins on a map based on location data.
 * Implements the map view type from @objectstack/spec view.zod ListView schema.
 * 
 * Features:
 * - Interactive map with markers
 * - Location-based data visualization
 * - Popup/tooltip on marker click
 * - Works with object/value data providers
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { ObjectMapSchema, ObjectMapConfig, DataSource, ViewData } from '@object-ui/types';
import { ObjectMapConfigSchema } from '@object-ui/types/zod';
import {
  useNavigationOverlay,
  NonGridRowCeilingNote,
  useDataInvalidation,
  useSettledSchema,
  useFilterScope,
  useResolvedFilter,
} from '@object-ui/react';
import { NavigationOverlay, cn, useIsMobile } from '@object-ui/components';
import { usePermissions } from '@object-ui/permissions';
import {
  buildExpandFields,
  convertSortToQueryParams,
  getRecordDisplayName,
  recordDisplayValueAt,
  resolveRecordSourceConfig,
  resolveRecordSourceObjectName,
  ValueDataSource,
  applyNonGridRowCeiling,
  nonGridRowCeilingQuery,
  type NonGridCeilingResult,
} from '@object-ui/core';
import MapGL, { NavigationControl, Marker, Popup } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  computeMarkerBounds,
  boundsCenter,
  EMPTY_VIEW_ZOOM,
  FIT_MAX_ZOOM,
  FIT_PADDING_PX,
  UNFITTED_CENTER_ZOOM,
} from './camera';

/**
 * Public MapLibre demo style — free, unauthenticated, but not intended for
 * production traffic (rate-limited, no uptime guarantee). Used only when no
 * `style` is configured; a load failure surfaces the banner below rather
 * than failing silently.
 */
const DEFAULT_MAP_STYLE = 'https://demotiles.maplibre.org/style.json';

/**
 * Can this browser start a MapLibre map at all (objectui#11819)?
 *
 * MapLibre draws through WebGL2 and nothing else. Without it the `Map`
 * constructor does not throw: `_setupPainter` emits a `GPUInitializationError`
 * and the constructor returns a map with no painter. That event fires INSIDE
 * the constructor, before react-map-gl attaches its listeners, so `onError`
 * never hears it (MapLibre prints it to the console instead). react-map-gl then
 * hands the painter-less map to the `Marker` children, whose `map.project`
 * throws, and the error boundary's unmount runs `map.remove()`, which throws
 * again on the missing painter — `Cannot read properties of undefined (reading
 * 'destroy')`, the crash card the page used to show.
 *
 * So the question is asked here, before `MapGL` mounts, with the call MapLibre
 * itself makes. A map that is never constructed has nothing to clean up. The
 * probe's own context is released at once rather than left to the collector:
 * browsers cap the live WebGL contexts a page may hold.
 *
 * With no DOM (a server render) there is nothing to probe and nothing would be
 * constructed either — react-map-gl builds the map in an effect — so the
 * answer is yes, and the browser's own render asks again.
 */
function canStartMap(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export interface ObjectMapProps {
  schema: ObjectMapSchema;
  dataSource?: DataSource;
  className?: string;
  /**
   * Records to render directly, bypassing this component's own fetch — the
   * shape `ListView` passes when it already holds the rows. Declared as its
   * own prop (not read off the `rest` spread) so the fetch effect can depend
   * on this one value: naming the whole `rest` object in that effect's deps
   * instead would refetch on every render, since `rest` is a fresh object
   * each render (objectui#5003).
   */
  data?: any[];
  onMarkerClick?: (record: any) => void;
  /**
   * TWO parameters since objectui#9357, and the second is not decoration: this
   * prop reaches `useNavigationOverlay` as its `onRowClick`, and `handleClick`
   * invokes it as `onRowClick(record, event)` — the modifier payload a host
   * needs to implement Cmd/Ctrl/middle-click for itself. Declaring one
   * parameter hid the second on the ONE line a host reads. Spelled `any` and
   * not `HandleClickModifiers` for the reason objectui#9341 measured on
   * `ObjectKanbanSchema.onCardClick`: that interface lives in
   * `@object-ui/react`, the published twins in `@object-ui/types` may not name
   * it, and a host that discovered the payload from the implementation
   * annotated it `React.MouseEvent` — which a narrower declaration refuses
   * contravariantly. `BaseSchema`'s own `onClick` / `onChange` / `onSubmit`
   * already use this spelling for exactly this situation.
   */
  onRowClick?: (record: any, event?: any) => void;
  onEdit?: (record: any) => void;
  onDelete?: (record: any) => void;
  /** Enable marker clustering for dense data */
  enableClustering?: boolean;
  /**
   * Clustering grid granularity (default: 50). NOT screen pixels — the grid
   * cell edge is `clusterRadius / 2 ** zoom`, in coordinate DEGREES (the
   * marker's `[lng, lat]`), so a larger value groups more aggressively and
   * the effective granularity shrinks exponentially as zoom increases. See
   * `clusterMarkers` below.
   */
  clusterRadius?: number;
}

/**
 * The FLAT spelling of `ObjectMapConfig`'s keys, as ObjectView / ListView emit it.
 *
 * Both flatteners build an `object-map` schema by spreading `options.map`'s
 * CONTENTS at the top level (`plugin-view/src/ObjectView.tsx` `case 'map'`,
 * `plugin-list/src/ListView.tsx` `case 'map'`) — the product carries these keys
 * and NO `map` key at all. That is an internal transport form, not an authoring
 * surface, so it is declared here in the consumer rather than in
 * `ObjectMapSchema` (maintainer ruling on objectui#5018, 2026-08-17).
 *
 * `locationField` / `titleField` are the two that `ObjectMapSchema` still
 * publishes as well, from before the ruling; the rest exist only here.
 */
type FlatMapConfigKeys = Omit< ObjectMapConfig, 'style' >;

/** What `getMapConfig` may read: the declared schema plus the internal flat form. */
type MapConfigSource = ObjectMapSchema & FlatMapConfigKeys;

/**
 * The flat keys, DERIVED from `ObjectMapConfigSchema` — the same zod object
 * `getMapConfig` validates the `map` block against — rather than hand-listed,
 * so a key added to (or removed from) the declaration reaches the shadow
 * diagnostic below without a second edit (objectui#5177). `style` is excluded
 * because the FLAT form is where its namespace collides with `BaseSchema.style`
 * (see `FlatMapConfigKeys` above and `warnOnTopLevelStyleUrl`) — not because
 * the declaration omits it; `ObjectMapConfigSchema` carries `style` too.
 *
 * `ObjectView` / `ListView` derive their own flatten whitelist from this exact
 * schema (imported from `@object-ui/types/zod`, already a dependency of both —
 * no new coupling to this package's heavier `react-map-gl` / `maplibre-gl`
 * dependencies), so all three sites read one canonical set of keys.
 */
const FLAT_MAP_CONFIG_KEYS = (Object.keys(ObjectMapConfigSchema.shape) as (keyof ObjectMapConfig)[]).filter(
  (key): key is keyof FlatMapConfigKeys => key !== 'style',
);

/**
 * Helper to get data configuration from schema.
 *
 * The ruled three-rung ladder itself (`data`, then `staticData`, then
 * `objectName`) is `resolveRecordSourceConfig` in `@object-ui/core` — ONE
 * implementation of a contract published on both faces (`77cb489b4`), which
 * this file used to hand-copy (`ce2aaefe1`).
 *
 * What used to stay here was the head above it: the array shorthand, which
 * lifted `data: [...]` to `{ provider: 'value', items }`.
 * ⛔ IT IS GONE (objectui#8348, decision batch #83, maintainer verbatim
 * 「8348 以协议为准」 — the contract decides). Its old justification was that the
 * shorthand is "a deliberate, commented convention across this block family",
 * i.e. that the other blocks accept it too. The ruling replaces that argument
 * with the row: a renderer honours the `data` spelling its block's PUBLISHED row
 * declares and no other.
 *
 * The row is `ComponentPropsMap['object-map'].data` in the INSTALLED
 * `@objectstack/spec` — the `ViewData` union over OBJECT variants — which
 * ruling batch #136 item 3 (Q1-C) had the protocol gain; until it was
 * installable this block was judged through this repo's own
 * `ObjectMapSchema.data`, spelled the same. ⛔ Not restated here as a fact
 * about a version: `ObjectMap.dataArmSpecRow-8348.test.tsx` derives the arm
 * from the installed row and turns red if a release moves it. A bare array is
 * off that row, and this block's registration declares `data` on the same
 * OBJECT arm (`type: 'object'`, objectui#10394), so it says the same.
 *
 * ⛔ WHAT THIS REACHES, per CARRIER. The authored key used to have a second
 * carrier: `SchemaRenderer` spread every non-metadata node key as a React prop,
 * so an authored `data` array also arrived as the `data` prop, which outranks
 * the schema (objectui#5003 order). objectui#9571 stopped that spread for
 * object-arm blocks, so through `SchemaRenderer` the array no longer draws
 * either; a HOST's own `data` prop is untouched. Both halves are pinned in
 * `ObjectMap.schemaDataShorthand.test.tsx`.
 *
 * The declared spellings for inline rows are
 * `data: { provider: 'value', items: [...] }` and `staticData: [...]`, both
 * unchanged.
 */
function getDataConfig(schema: ObjectMapSchema): ViewData | null {
  return resolveRecordSourceConfig(schema, 'view-data');
}

const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.NODE_ENV !== 'production';

/**
 * Warn once per distinct legacy stash, not once per evaluation: `getMapConfig`
 * runs on every render of the map (hover, zoom, search all re-render it), and a
 * warning that floods the console is a warning that gets muted. Mirrors the
 * warn-once discipline of the visibility-predicate diagnostics in
 * `app-shell/src/views/metadata-admin/predicate.ts` (objectui#4049).
 */
const warnedLegacyFilterMapConfigs = new Set<string>();

/**
 * `filter` is the query filter, not a configuration slot — objectui#4034
 * (source thread objectstack#7138).
 *
 * `getMapConfig` used to ALSO read the map's configuration out of
 * `schema.filter.map` (and its `style` half), a shape predating the declared
 * `{ name: 'map', type: 'object' }` input. That read is gone: the block
 * consumes only what it declares. Authoring the config under `filter.map`
 * therefore has no effect, so say so in dev rather than dropping the author's
 * markers without a trace. Since objectui#8169 there are no default field names
 * left to fall back on, so such a map renders the refusal state below — which
 * names the declaration that is missing, but cannot know about the stash this
 * author actually wrote. This warning is the only thing that can.
 *
 * Deliberately narrow, to stay off legitimate query filters:
 * - OWN property only. `'map' in someArray` is TRUE via `Array.prototype.map`,
 *   which is precisely how the deleted probe misfired on every array-shaped
 *   filter — including the `and` node a dataSource binding merges
 *   (objectstack#7121). An inherited method is not an authoring mistake.
 * - object-valued only. `filter: { map: 'x' }` reads as a filter on a field
 *   named `map`, not as a stashed MapConfig.
 */
function warnOnLegacyFilterMapConfig(schema: MapConfigSource): void {
  if (!isDev()) return;

  // `filter` is declared as a JSON-Rules array; the legacy stash this probe
  // exists for is an OBJECT, which is why the shape is re-tested at runtime
  // rather than trusted from the declaration.
  const filter: unknown = schema.filter;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return;
  if (!Object.prototype.hasOwnProperty.call(filter, 'map')) return;

  const legacy = (filter as Record<string, unknown>).map;
  if (!legacy || typeof legacy !== 'object') return;

  let memo: string;
  try {
    memo = `${schema.type ?? 'map'}::${schema.objectName ?? ''}::${JSON.stringify(legacy)}`;
  } catch {
    // Circular author data — still worth one warning, just not a keyed one.
    memo = `${schema.type ?? 'map'}::${schema.objectName ?? ''}::<unserializable>`;
  }
  if (warnedLegacyFilterMapConfigs.has(memo)) return;
  warnedLegacyFilterMapConfigs.add(memo);

  console.warn(
    '[ObjectMap] `filter.map` is no longer read as map configuration, so this map has NO ' +
      'coordinate binding and renders the "Map configuration required" refusal ' +
      '(objectui#8169 — the `latitude` / `longitude` / `location` defaults are gone). `filter` is ' +
      'the query filter; the map config belongs under the declared `map` input — move it to ' +
      '`schema.map` (`{ type: \'object-map\', map: { latitudeField, longitudeField, titleField } }`). ' +
      'The old spelling was never documented and could not survive a `dataSource` binding, whose ' +
      'merged filter is an `and` node with no `map` key at all (objectstack#7121). If `map` is ' +
      'genuinely a field you are filtering on, ignore this — the filter itself is passed through ' +
      'untouched. objectui#4034.',
  );
}

/**
 * Warn once per distinct dropped URL, for the same reason the diagnostics
 * around it warn once: this runs on every render of the map.
 */
const warnedTopLevelStyleUrls = new Set<string>();

/**
 * Top-level `style` is `BaseSchema.style` — inline CSS — and is NOT a map style
 * (objectui#5017).
 *
 * `getMapConfig` used to read it FIRST, ahead of both declared spellings, so a
 * map node carrying the base face's own `style: { height: '400px' }` handed that
 * object to MapGL's `mapStyle` prop: no validation, no diagnostic, and a
 * collision `@object-ui/types` had already gone out of its way to avoid — it
 * named the key `mapStyle` (not `style`) for exactly this reason
 * (`objectql.ts`, `ObjectMapSchema.mapStyle`). The consumer contradicted the
 * declaration it was named after; that read is gone.
 *
 * The OBJECT form needs no diagnostic: it is legal base-face authoring, and
 * dropping it is the fix. The STRING form does, because it is the one shape
 * that used to work:
 * - It is the shape a view author's `map: { style: '<url>' }` USED to arrive
 *   as: both flatteners spread the CONTENTS of `options.map` at the top level,
 *   so `style` crossed into this key's namespace. ⛔ NOT ANY MORE — since
 *   objectui#9950 each declared key has a flat SPELLING and `style` is carried
 *   out as `mapStyle`, so the declared block now arrives and is read, and
 *   neither producer of an `object-map` node (`ObjectView` / `ListView`, the
 *   only two) emits a top-level `style` at all. What still reaches here is a
 *   node authored — or host-composed — with a STRING `style` written directly
 *   on it: not spec-authorable (`@objectstack/spec`'s list-view schemas are
 *   strict and declare no `map` block at all), but runtime-reachable, so say
 *   what happened instead of silently painting the demo tiles.
 * - A string is not valid `BaseSchema.style` either (that is a record), so a
 *   string here is unambiguously "the author meant a map style" — there is no
 *   legitimate CSS reading to mistake it for.
 *
 * ⇒ THE REMEDY BELOW MUST NAME A SPELLING THE RUNTIME READS (objectui#10002,
 * the rule objectui#9031 set for a sibling sink): this text is read at the
 * moment the author is already being corrected. It used to end "spell it
 * `map: { mapStyle }` there" — a key `ObjectMapConfigSchema` does not
 * declare, so no flatten whitelist carries it and `getMapConfig` never reads
 * it; obeying the correction produced a SECOND silent discard. The remedy is
 * not defended by a string assertion (that is how it rotted). Every key it
 * prescribes inside a `map` block is parsed out of the warning this function
 * really emits and then measured end to end — through the declared block and
 * through the real `ListView` flatten — in
 * `ObjectMap.styleRemedyText-10002.test.tsx`.
 */
function warnOnTopLevelStyleUrl(schema: MapConfigSource): void {
  if (!isDev()) return;

  // Re-tested at runtime rather than trusted from the declaration: the
  // declaration says this key is a CSS record, and the shape this probe exists
  // for is precisely the one that violates it.
  const raw: unknown = schema.style;
  if (typeof raw !== 'string' || raw === '') return;

  const memo = `${schema.type ?? 'map'}::${schema.objectName ?? ''}::${raw}`;
  if (warnedTopLevelStyleUrls.has(memo)) return;
  warnedTopLevelStyleUrls.add(memo);

  console.warn(
    '[ObjectMap] A top-level `style` is NOT read as a map style, so this map is rendering with ' +
      `the DEFAULT public demo tiles and \`${raw}\` was dropped. \`style\` is the base schema's ` +
      'INLINE CSS key (a record of CSS properties), which every node may carry; the map style is ' +
      '`mapStyle` — named that way precisely to avoid this collision. Write `mapStyle: ' +
      `'${raw}'\` at the top level, or \`map: { style: '${raw}' }\` in the declared config block. ` +
      'On a view, write that same declared `map: { style: ... }`: ObjectView / ListView flatten ' +
      '`options.map` through a whitelist of the keys `ObjectMapConfigSchema` declares, and that ' +
      'whitelist carries `style` out under the flat spelling `mapStyle` (objectui#9950), so the ' +
      'declared block arrives and is read. `mapStyle` is the TOP-LEVEL spelling only — inside ' +
      'the `map` block it is undeclared, and the flatten drops it. objectui#5017.',
  );
}

/**
 * Warn once per distinct shadowing, for the same reason `getMapConfig` warns
 * once per legacy stash: this runs on every render of the map.
 */
const warnedShadowedFlatKeys = new Set<string>();

/**
 * The `map` block won and the internal flat keys alongside it were ignored —
 * say which ones, in dev.
 *
 * Silence here is what the precedence rule costs if it is not diagnosed: two
 * spellings of the same configuration in one schema, one of them inert. The
 * ruling picks the author's block over the flatten product deliberately
 * (maintainer, objectui#5018, 2026-08-17), so the diagnostic names what was
 * dropped rather than leaving the author to discover it from the markers.
 *
 * It cannot fire on the ordinary ObjectView / ListView path: both flatteners
 * emit the flat keys and NO `map` key, so this branch is not even reached for
 * their output. Reaching it means one schema carries both spellings.
 */
function warnOnShadowedFlatMapKeys(schema: MapConfigSource): void {
  if (!isDev()) return;

  // `key` is a `FlatMapConfigKeys` key and `MapConfigSource` carries those, so
  // the read is typed as it stands; no conversion is needed (objectui#11355).
  const shadowed = FLAT_MAP_CONFIG_KEYS.filter((key) => schema[key] !== undefined);
  if (shadowed.length === 0) return;

  const memo = `${schema.type ?? 'map'}::${schema.objectName ?? ''}::${shadowed.join(',')}`;
  if (warnedShadowedFlatKeys.has(memo)) return;
  warnedShadowedFlatKeys.add(memo);

  console.warn(
    `[ObjectMap] The \`map\` block configures this map, so these top-level keys are ` +
      `IGNORED: ${shadowed.map((k) => `\`${k}\``).join(', ')}. The \`map\` block is the ` +
      'authoring shape; the flat top-level spelling is the internal form ObjectView/ListView ' +
      'produce when they flatten `options.map`, and what the author wrote outranks it. Move ' +
      'anything you still need into `map`, or drop the `map` block. objectui#5018.',
  );
}

/**
 * Helper to get map configuration from schema
 *
 * PRECEDENCE (maintainer ruling on objectui#5018, 2026-08-17): the declared
 * `map` block is checked FIRST and wins outright; the flat top-level spelling
 * is consulted only when no `map` block is present. This is the reverse of the
 * pre-#5018 order, which let the internal flatten product silently shadow an
 * authored block. Safe for the producer path because neither flattener emits a
 * `map` key at all — see `FlatMapConfigKeys`.
 */
function getMapConfig(schema: MapConfigSource): ObjectMapConfig {
  warnOnLegacyFilterMapConfig(schema);
  warnOnTopLevelStyleUrl(schema);

  // A custom style may be set alongside any of the shapes below — read it
  // once so every return path can carry it through.
  //
  // The two DECLARED spellings, and only those: `mapStyle` on the schema
  // (`ObjectMapSchema.mapStyle`) and `style` inside the declared config block
  // (`ObjectMapConfig.style`). The top-level `style` this used to read first is
  // `BaseSchema.style` — inline CSS, a different key with a different meaning —
  // and is no longer consumed here at all (objectui#5017; see
  // `warnOnTopLevelStyleUrl`).
  //
  // PRECEDENCE: `mapStyle` first, then `map.style` — on EVERY return path,
  // including the declared block's below (objectui#11168 slice 3, the seat's
  // ruling A). The installed `@objectstack/spec` row says so in `mapStyle`'s own
  // describe ("Read before `map.style`"), and this lane follows the spec. The
  // block path used to hand `config.style` back first, so a map writing both
  // drew `map.style`; no authored producer writes both.
  const style: string | undefined = schema.mapStyle || schema.map?.style;

  // 1. The declared configuration input: `{ name: 'map', type: 'object' }` at
  // the `object-map` / `map` registrations. The author face, and the winner
  // whenever it is present.
  const config: ObjectMapConfig | null = schema.map ?? null;

  if (config) {
    const result = ObjectMapConfigSchema.safeParse(config);
    if (!result.success) {
      console.warn(`[ObjectMap] Invalid map configuration:`, result.error.format());
    }
    warnOnShadowedFlatMapKeys(schema);
    return { ...config, style };
  }

  // 2. The internal flat form — the ObjectView / ListView flatten product.
  if (schema.locationField || schema.latitudeField) {
    return {
      locationField: schema.locationField,
      latitudeField: schema.latitudeField,
      longitudeField: schema.longitudeField,
      // No `|| 'name'` (objectui#5953). An ABSENT binding must stay absent so
      // the read site can hand the decision to `getRecordDisplayName`; the
      // literal used to forge a binding the author never wrote, and a forged
      // `'name'` outranks the object's own declared `nameField` at step 0 of
      // that resolver. A binding the flatten product really carries survives
      // here and still wins.
      titleField: schema.titleField,
      descriptionField: schema.descriptionField,
      zoom: schema.zoom,
      center: schema.center,
      style,
    };
  }

  // 3. NOTHING IS GUESSED (objectui#8169 — maintainer ruling 2026-09-07
  //    「同意」, decision batch #67, option B).
  //
  // This branch used to return four field-name guesses — `latitude`,
  // `longitude`, `location`, `description` — carried over from before the
  // declared `map` input existed. objectui#5953 deleted the `titleField` guess
  // from this very branch and deliberately KEPT the coordinate ones, on the
  // reasoning that "nothing else can read a location out of an unconfigured
  // record". The premise held; the ruling reverses its conclusion — that is
  // exactly why the answer is a REFUSAL rather than a guess. Bindings are
  // never fabricated; an unbound surface refuses. The same principle as
  // 「日期轴永不虚构」 behind the 2026-09-01 ruling (date axes, 总监批 #28) and
  // objectui#8168 (the chart category axis), generalised one field over.
  //
  // What the guesses actually shipped was the silent-credible-wrong shape
  // objectstack#13748 ruled against: a record set that happens to spell its
  // columns `latitude` / `longitude` plotted on a view that declared no map
  // binding at all, while the same view over any other spelling rendered an
  // empty map. Neither outcome says what is missing. `hasCoordinateBinding`
  // below now sends both to the refusal state, which does.
  //
  // No camera is synthesized here either, and never was (objectui#4941): a
  // fabricated `zoom` / `center` is indistinguishable from a declared one at
  // the read site, and the old defaults (zoom 10 at the origin) SUPPRESSED the
  // fit for exactly the views that need it most. `style` still travels,
  // because it is read from a DECLARED spelling above (`mapStyle` or
  // `map.style`) and forges nothing.
  return { style };
}

/**
 * Is this configuration BOUND to coordinates at all?
 *
 * The refusal gate for objectui#8169. Deliberately the same two reads
 * `extractCoordinates` performs, in the same order, so the question "will any
 * record ever place a marker" is answered once rather than per record:
 * a `locationField`, or a COMPLETE `latitudeField` + `longitudeField` pair.
 * A half pair is not a binding — `extractCoordinates` skips its lat/lng arm
 * unless both are present — so it refuses, which is also what the refusal
 * message tells the author to write.
 *
 * ⚠️ Keep this in lockstep with `extractCoordinates`: a key that becomes
 * placeable there and is not named here renders a refusal over records that
 * would have plotted.
 *
 * Applies to EVERY branch above, not only the unconfigured one. A declared
 * `map` block that names no coordinate field (`map: { titleField: 'name' }`)
 * is just as unbound as an absent one, and used to render an empty map under
 * the excluded-records notice.
 */
function hasCoordinateBinding(config: ObjectMapConfig): boolean {
  return Boolean(config.locationField) || Boolean(config.latitudeField && config.longitudeField);
}

/**
 * Extract coordinates from a record based on configuration
 */
function extractCoordinates(record: any, config: ObjectMapConfig): [number, number] | null {
  // Try latitude/longitude fields
  if (config.latitudeField && config.longitudeField) {
    const lat = record[config.latitudeField];
    const lng = record[config.longitudeField];
    if (typeof lat === 'number' && typeof lng === 'number') {
      return [lat, lng];
    }
  }

  // Try location field
  if (config.locationField) {
    const location = record[config.locationField];
    
    // Handle object format: { lat: number, lng: number }
    if (typeof location === 'object' && location !== null) {
      const lat = location.lat || location.latitude;
      const lng = location.lng || location.lon || location.longitude;
      if (typeof lat === 'number' && typeof lng === 'number') {
        return [lat, lng];
      }
    }
    
    // Handle string format: "lat,lng"
    if (typeof location === 'string') {
      const parts = location.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return [parts[0], parts[1]];
      }
    }
    
    // Handle array format: [lat, lng]
    if (Array.isArray(location) && location.length === 2) {
      const lat = parseFloat(location[0]);
      const lng = parseFloat(location[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return [lat, lng];
      }
    }
  }

  return null;
}

interface MarkerData {
  id: string;
  title: string;
  description?: string;
  coordinates: [number, number];
  data: any;
}

interface ClusterData {
  id: string;
  coordinates: [number, number];
  markers: MarkerData[];
  isCluster: boolean;
}

/**
 * Simple grid-based marker clustering.
 * Groups markers that are close to each other at a given zoom level.
 */
function clusterMarkers(markers: MarkerData[], zoom: number, radius: number = 50): ClusterData[] {
  if (markers.length <= 1 || zoom >= 15) {
    return markers.map(m => ({
      id: m.id,
      coordinates: m.coordinates,
      markers: [m],
      isCluster: false,
    }));
  }

  // Grid cell size based on zoom (larger cells at lower zoom)
  const cellSize = radius / Math.pow(2, zoom);
  const grid = new Map<string, MarkerData[]>();

  markers.forEach(marker => {
    const cellX = Math.floor(marker.coordinates[0] / cellSize);
    const cellY = Math.floor(marker.coordinates[1] / cellSize);
    const key = `${cellX}:${cellY}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(marker);
  });

  const clusters: ClusterData[] = [];
  grid.forEach((group, key) => {
    if (group.length === 1) {
      clusters.push({
        id: group[0].id,
        coordinates: group[0].coordinates,
        markers: group,
        isCluster: false,
      });
    } else {
      // Compute centroid
      const avgLng = group.reduce((sum, m) => sum + m.coordinates[0], 0) / group.length;
      const avgLat = group.reduce((sum, m) => sum + m.coordinates[1], 0) / group.length;
      clusters.push({
        id: `cluster-${key}`,
        coordinates: [avgLng, avgLat],
        markers: group,
        isCluster: true,
      });
    }
  });

  return clusters;
}

export const ObjectMap: React.FC<ObjectMapProps> = ({
  schema,
  dataSource,
  className,
  data: dataProp,
  onMarkerClick,
  onRowClick,
  onEdit,
  onDelete,
  enableClustering,
  clusterRadius = 50,
}) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  /**
   * Did the platform row ceiling bite, and how large was the whole filtered
   * result set (objectui#7210)? Carried from the response that knew it —
   * `data.length === NON_GRID_ROW_CEILING` cannot tell a capped result set
   * apart from one that is exactly that size.
   *
   * ⚠️ The exempt path is the HOST `data` prop and only it — rows a host
   * component handed down are not ours to cap, and we issued no query whose
   * total a footnote could name. An inline `value` set IS capped
   * (objectui#9061, porting objectui#8769): it goes through the same adapter
   * query as every other provider, so the ceiling arrives with the same `$top`
   * and the same footnote. This docblock used to say both paths were exempt.
   */
  const [rowCeiling, setRowCeiling] = useState<NonGridCeilingResult | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Mobile UX (round 3)
  const isMobile = useIsMobile();
  const mapRef = useRef<MapRef | null>(null);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  // Style/tile load failures (bad network, unreachable style server) don't
  // throw from react-map-gl — they emit an `error` event. Without this, a
  // failed load renders a blank map with no indication anything went wrong.
  const [mapStyleError, setMapStyleError] = useState<string | null>(null);
  const handleMapError = useCallback((e: { error?: Error & { status?: number } }) => {
    setMapStyleError(e?.error?.message || 'Failed to load the map style/tiles.');
  }, []);
  // Asked once per mount, before `MapGL` is ever mounted: a browser without
  // WebGL2 gets the record list instead of a map (see `canStartMap`). Not a
  // style/tile failure — that one keeps the map and its markers, above.
  const [mapCanStart] = useState(canStartMap);
  const requestUserLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Geolocation is not available in this browser.');
      return;
    }
    setGeoBusy(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        setUserLocation({ lng: longitude, lat: latitude });
        setGeoBusy(false);
        try {
          mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 12, duration: 800 });
        } catch {
          /* mapRef may be null in some test envs */
        }
      },
      (err) => {
        setGeoBusy(false);
        setGeoError(err.message || 'Unable to retrieve location.');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  /**
   * Memoized on the ONE value `getDataConfig` reads, and nothing else
   * (objectui#6018) — the same shape `mapConfig` below landed for
   * objectui#5976, now that the two lines agree.
   *
   * `dataConfig` is a dependency of the fetch effect, and that effect calls
   * `setData`, so a fresh identity here is a refetch loop rather than mere
   * waste. That hazard is real and is what the previous form's "prevent
   * infinite loops" comment recorded. What has changed is the PRICE of the
   * guard, not the guard: identity was bought by calling `getDataConfig` bare
   * in the render body and re-serializing the result with `JSON.stringify` on
   * EVERY render, only to hand back the object the memo already held.
   *
   * `[schema]` is the whole dependency, not a shorthand for one: `getDataConfig`
   * is a pure function of `schema` and reads exactly three keys off it
   * (`data`, `staticData`, `objectName`), nothing ambient. So no deep-compare
   * key is needed to make the identity hold — the identity that reaches this
   * component is already stable across the renders that matter. Every
   * re-render `ObjectMap` causes ITSELF (data landing, the object definition
   * landing, search typing, zoom, selection, geolocation) leaves the prop
   * untouched by construction, which is precisely the loop path; and the three
   * callers upstream each hand over a memoized node: `SchemaRenderer`'s
   * `evaluatedSchema`, the gate's `mapped` in `useElementDataSourceSchema`,
   * and `ListView`'s `viewComponentSchema`.
   *
   * Dropping the serialize is also a correctness move, not only a cost one.
   * `JSON.stringify` is not a total function — it THROWS on a value it cannot
   * serialize — and the passthrough branch of `getDataConfig` returns the
   * author's own `schema.data` object verbatim, inline `value` rows included.
   * So a record graph carrying a back-reference (an `$expand`-ed lookup handed
   * to the block as inline data) or a `BigInt` id took the whole map subtree
   * down from the render body. Comparing identities never serializes, so the
   * config no longer has to be serializable at all.
   * `ObjectMap.dataConfigMemo.test.tsx` pins both halves.
   */
  const dataConfig = useMemo(() => getDataConfig(schema), [schema]);
  
  /**
   * Memoized on the ONE value `getMapConfig` reads, and nothing else
   * (objectui#5976). This call used to sit bare in the render body, so
   * `mapConfig` carried a fresh object identity on every render — and the
   * marker transform below names it in its dependency array, so that `useMemo`
   * recomputed on every single render while declaring that it does not. The
   * invalidation cascaded from there: `filteredMarkers` → `clusteredData` /
   * `markerBounds` → `initialViewState` all key on the array it produces.
   *
   * `[schema]` is the whole dependency, not a shorthand for one: `getMapConfig`
   * is a pure function of `schema` and reads nothing else. No deep-compare key
   * is needed to make that identity hold, because the identity that reaches
   * this component is ALREADY stable across the renders that matter — every
   * re-render `ObjectMap` causes itself (data landing, the object definition
   * landing, search typing, zoom, selection, geolocation) leaves the prop
   * untouched by construction, and the three callers upstream each hand over a
   * memoized node: `SchemaRenderer`'s `evaluatedSchema`, the gate's `mapped`
   * in `useElementDataSourceSchema`, and `ListView`'s `viewComponentSchema`.
   *
   * This deliberately did NOT copy the `JSON.stringify` dep key the
   * `dataConfig` line above used to carry, and as of objectui#6018 that line
   * no longer carries it either — both are keyed on `[schema]` now. The
   * serialize idiom bought stability by paying a full serialize on every
   * render; it is also key-order sensitive and drops `undefined` values — an
   * equality THIS config in particular cannot afford, since an ABSENT
   * `titleField` is load-bearing here (objectui#5953) and must never compare
   * equal to a present one. Identity is enough; nothing here needs value
   * equality.
   */
  const mapConfig = useMemo(() => getMapConfig(schema), [schema]);
  const hasInlineData = dataConfig?.provider === 'value';

  /**
   * The two fetch effects below used to key on `dataConfig` itself — the
   * whole memoised object identity. `useMemo` carries no semantic
   * guarantee: React is permitted to discard its cache and recompute, and
   * `getDataConfig(schema)` builds a fresh `{ provider, object }` /
   * `{ provider, items }` wrapper object on every call even when `schema`
   * itself hasn't changed. So a discard (not just a `schema` change) was
   * enough to re-run both effects and refetch. These three are every
   * primitive field either effect actually reads off `dataConfig`; keying
   * on them instead of the container object makes a cache discard a no-op
   * for both effects, and returns `useMemo` here to being a pure
   * optimisation rather than a correctness dependency (objectui#6592).
   */
  const dataProvider = dataConfig?.provider;
  // NOT a delegation site for `resolveRecordSourceObjectName` (`b041b9c0c`):
  // this is the data config's OWN object, deliberately `undefined` for every
  // other provider so a `value` map's `objectName` changing cannot move
  // this dependency. The shared reader's second rung would put `objectName`
  // here and re-run both effects on a value they do not read.
  const dataObjectName = dataConfig?.provider === 'object' ? dataConfig.object : undefined;
  const dataItems = dataConfig?.provider === 'value' ? dataConfig.items : undefined;
  /**
   * The object this map is BOUND to — the resolved record source's object when
   * it names one, else the schema's own `objectName` (`b041b9c0c`, the
   * ladder `77cb489b4` declared). Hoisted to render scope so the definition read below
   * keys on one named value instead of re-deriving the ladder inline.
   */
  const recordSourceObjectName = resolveRecordSourceObjectName(schema, dataConfig);

  /**
   * The object definition, and whether the read for THIS object has SETTLED:
   * one piece of state, through the shared hook (objectui#10664).
   *
   * The map held the definition in a local `useState` fed by its own metadata
   * effect, and listed it in the fetch effect's dependencies below. The
   * definition lands after the first query, so every mount read twice: once
   * with `buildExpandFields` seeing no fields (no `$expand`), once after. It is
   * the shape `ObjectTimeline` (objectui#7895) and `ObjectGallery`
   * (objectui#7903) left, and the gate below is theirs.
   *
   * The key is `recordSourceObjectName`, the object the replaced effect read. On
   * the branch the gate holds (`dataProvider === 'object'`) it names the same
   * object the query does, `dataObjectName`.
   *
   * An inline `value` set passes no source, as `ObjectCalendar` does: it has no
   * definition to read, and the hook settles with none at once. Every other
   * path keeps the read, host rows included, because the marker titles resolve
   * from it (ADR-0079).
   *
   * ⚠️ The gate is only safe because the hook SETTLES ON EVERY EXIT
   * (objectui#7232): no source, no `getObjectSchema`, no key, and a read that
   * threw. The replaced effect returned without settling on all four.
   */
  const { ready: objectSchemaReady, def: objectSchema } = useSettledSchema<any>(
    recordSourceObjectName ?? '',
    hasInlineData ? undefined : dataSource,
  );

  // Permissions context, read here rather than inside the fetch effect below:
  // an effect's DEPENDENCY ARRAY is evaluated during render, so `perms` has to
  // be a binding that already exists by the time this component's render
  // reaches that effect (objectui#7429, same structural note PR #7229 /
  // PR #7428 recorded for `ListView`'s memo and `ObjectCalendar`'s effect).
  const perms = usePermissions();

  /**
   * objectui#10623 — the data-invalidation bus (`notifyDataChanged` from
   * `@object-ui/react`), read the objectui#10494 way: the nonce moves when a
   * write to the object this map QUERIES is declared, and the fetch effect
   * below names it, so the markers are re-read. Subscribed only on the
   * `object` provider without host rows: a host `data` array is the host's to
   * refresh, and an inline `value` set queries its own array, not an object.
   *
   * ⭐ A re-read of the SAME query is SILENT, in `ObjectGantt`'s sense
   * (objectui#7237 / objectui#10035): it does not flip `loading`, and a failure
   * keeps the last good rows instead of reporting. The `loading` gate further
   * down unmounts `MapGL` for the duration of a fetch. That is the right answer
   * when the QUERY changed (the one-shot camera then re-fits the new record
   * set) and the wrong one for a write to the same query, because it would throw
   * away the camera the user has panned and zoomed: the loss a remount causes,
   * one level down (AGENTS.md #8's corollary: refresh data, don't rebuild UI).
   * The same goes for a failure: the error screen is also an early return
   * above `MapGL`.
   *
   * A run is silent only when BOTH hold:
   *   - the nonce moved since the effect's last run (the bus asked), and
   *   - its query inputs are, value for value, the ones whose rows were last
   *     COMMITTED, so the rows on screen already answer this query.
   * A query change that lands in the same commit as a bus event therefore
   * still goes through the gate and re-fits. So does a bus event that lands
   * before the first rows, or after a changed query failed: nothing on screen
   * answers that query yet, so its failure must be reported.
   */
  const fetchesForItself = !Array.isArray(dataProp) && dataProvider === 'object';
  const invalidationNonce = useDataInvalidation(fetchesForItself ? dataObjectName : undefined);
  const answeredInvalidationRef = useRef(invalidationNonce);
  /** The query inputs of the run whose rows were last committed. */
  const committedQueryRef = useRef<readonly unknown[] | null>(null);
  /**
   * Only the NEWEST run may commit rows, an error or the loading flag
   * (`ObjectGantt`'s `reloadSeqRef`). The cleanup below advances it too, so a
   * run superseded by a re-run, or outliving an unmount, commits nothing.
   */
  const fetchSeqRef = useRef(0);

  // objectui#10666 — the node's own `filter`, with every context token
  // (`{current_user_id}`, `{current_org_id}`, the date macros) resolved ONCE
  // through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the
  // session scope the host provides, and HELD by structure (`useResolvedFilter`
  // in `@object-ui/react`). A directly authored map sent the literal token on
  // `$filter` before. Both query paths below (the `object` fetch and the inline
  // `ValueDataSource`), the committed-query key and the effect's dependency
  // list read THIS, never the raw `schema.filter`, so a re-render that
  // rebuilds an equal filter does not re-query.
  const filterScope = useFilterScope();
  const queryFilter = useResolvedFilter(schema.filter, filterScope);

  // Fetch data based on provider
  useEffect(() => {
    // ⭐ objectui#10664: the object definition GATES the object query; it does
    // not refine it afterwards. `objectSchema` stays in the dependency list and
    // the two are one mechanism: the dependency re-runs this effect when the
    // definition lands, and this line stops the first run from spending a query
    // before it has. Removing either half restores the double read.
    //
    // Scoped to the branch that issues that query. Host rows and an inline
    // `value` set build no expansion, so there is nothing for them to wait on.
    //
    // The gate closes only when the key moves, and on this branch the key is
    // the queried object, so a closed gate always means a CHANGED query. The
    // placeholder is held for the window: the rows in state answer the previous
    // object, and the query this run would have issued goes through the loading
    // gate anyway.
    if (fetchesForItself && !objectSchemaReady) {
      setLoading(true);
      return;
    }
    // Every input of the query below: this effect's dependency list, less the
    // nonce, the readiness flag and `fetchesForItself` (a function of two
    // members already in it). Compared value for value (`Object.is`), the way
    // React compares the list itself.
    const query = [dataProp, dataProvider, dataObjectName, dataItems, dataSource, hasInlineData, queryFilter, schema.sort, objectSchema, perms] as const;
    const committed = committedQueryRef.current;
    const answersShownQuery = committed !== null && committed.length === query.length && query.every((v, i) => Object.is(v, committed[i]));
    const nonceMoved = invalidationNonce !== answeredInvalidationRef.current;
    answeredInvalidationRef.current = invalidationNonce;
    const silent = nonceMoved && answersShownQuery;
    const seq = ++fetchSeqRef.current;
    const isCurrent = () => fetchSeqRef.current === seq;
    // The one place a run commits rows. Committed rows answer this run's query,
    // so no earlier failure describes the screen any more: the error is cleared
    // HERE (objectui#10578's rule on `ObjectGantt`), never when a run starts.
    const commit = (rows: unknown[], ceiling: NonGridCeilingResult | null) => {
      if (!isCurrent()) return;
      setData(rows);
      setRowCeiling(ceiling);
      setError(null);
      committedQueryRef.current = query;
    };
    const fetchData = async () => {
      try {
        if (!silent) setLoading(true);

        // Prioritize data passed via props (from ListView). `dataProp` is a
        // declared prop (not the `rest` spread), so it can sit in this
        // effect's dependency array below without turning into a
        // refetch-every-render trap (objectui#5003).
        if (Array.isArray(dataProp)) {
          commit(dataProp, null);
          return;
        }

        if (hasInlineData && dataProvider === 'value') {
          // THE INLINE PROVIDER NO LONGER EXITS BEFORE THE QUERY
          // (objectui#9061, porting objectui#8769's repair off `ObjectGantt`).
          //
          // This branch used to be `setData(dataItems); return;` — taken
          // BEFORE the `find` below, which is the ONE site in this file that
          // lowers `schema.filter` onto `$filter`, `schema.sort` onto
          // `$orderby` (via `convertSortToQueryParams`) and the objectui#7210
          // ceiling onto `$top`. So an authored `filter` reached nothing and
          // every authored row was plotted: the fail-OPEN direction, because
          // the key that was dropped is the key that NARROWS. Accepting a
          // declared key one cannot honour is the defect, and `ValueDataSource`
          // honours all three over its own array, so they are honoured here.
          //
          // ⚠️ NOT a literal transplant of the gantt's diff, and the difference
          // is structural rather than cosmetic. `ObjectGantt` resolves ONE
          // `effectiveDataSource` for every provider, so its repair was to
          // delete the branch and let the inline case fall through to the
          // shared query. This effect's `find` sits INSIDE the
          // `dataProvider === 'object'` arm, behind an `$expand` projection an
          // inline set has no metadata to build. Falling through here would
          // therefore throw `DataSource required for the object provider` on a
          // map that needs no DataSource at all. So the adapter is resolved for
          // the inline provider ONLY, and the same three keys are lowered onto the same query shape.
          //
          // Built here rather than memoised at render scope so this effect goes
          // on reading only the primitive fields objectui#6592 named
          // (`dataProvider`, `dataObjectName`, `dataItems`): no dependency is
          // added or removed, so nothing about WHEN this effect re-runs changes
          // with this repair.
          //
          // `ValueDataSource` ignores the resource name — it queries its own
          // array — so this branch needs none of the object-name ladder the
          // `object` arm below resolves.
          const inlineSource = new ValueDataSource<any>({ items: (dataItems as any[]) ?? [] });
          const result = await inlineSource.find('', {
            $filter: queryFilter,
            $orderby: convertSortToQueryParams(schema.sort),
            // The same platform ceiling the `object` arm sends, on the same
            // probe-row convention (objectui#7210, ruling a′). The ruling's
            // budget is measured in DOM elements PER RECORD and its own
            // measurement table was taken over the inline `value` provider, so
            // an inline marker costs the browser exactly what a fetched one
            // costs and the ruling text carves out no provider.
            // ⛔ Still not authorable: no view key reaches this `$top`.
            ...nonGridRowCeilingQuery(),
          });
          // Filter first, ceiling second — `ValueDataSource` applies `$filter`
          // before `$top`, which is what the fetching path gets for free from
          // every backend. A large inline array that an authored `filter` cuts
          // below the ceiling therefore plots every matching row and stays
          // quiet.
          const capped = applyNonGridRowCeiling(result);
          commit(capped.rows, capped);
          return;
        }

        if (!dataSource || typeof dataSource.find !== 'function') {
          throw new Error('DataSource required for the object provider');
        }

        if (dataProvider === 'object') {
          // `dataObjectName` is only unset here if the schema is off-contract
          // (an 'object' provider with no `object` name) — the discriminated
          // union declares it required, same as the pre-refactor narrowing
          // this replaces.
          const objectName = dataObjectName as string;
          // Auto-inject $expand for lookup/master_detail fields.
          //
          // [objectui#7429] FIELD-LEVEL SECURITY ON `$expand` — the same gate
          // objectui#7215 / PR #7229 put on the two projection sites in its
          // scope, and objectui#7230 / PR #7428 applied unchanged at four more.
          // `$select` on a denied lookup asks the server for a bare foreign
          // key; `$expand` asks it to RESOLVE the relation and return the
          // related record, the larger of the two requests.
          //
          // THIS SITE PASSES NO COLUMN LIST, which makes it the sharp one:
          // `buildExpandFields` reads an absent column list as "no column
          // restriction" and falls back to EVERY declared relation on the
          // object, denied ones included. A standalone map therefore asks for
          // the maximum possible set by default, not by configuration.
          //
          // Graded as objectui#7215 graded it, by measurement rather than
          // assumption: against ObjectStack this is defence-in-depth, because
          // `plugin-security`'s `FieldMasker.maskRecord` does
          // `delete result[field]` on every unreadable key and objectql's
          // expand path writes the resolved record back under THAT SAME KEY, so
          // one statement removes the expanded object and the bare id alike;
          // the expansion sub-read itself takes the referenced object's full
          // CRUD + RLS + FLS treatment (objectstack#7626). It is load-bearing
          // for a backend that does not strip.
          //
          // THE GATE IS ON THE HELPER'S OUTPUT, and on this site the
          // alternative is not merely unsound but unreachable: the call passes
          // `undefined`, so there is no input to gate. Gating the output also
          // gives the required ordering structurally: `buildExpandFields`
          // returns a subset of the object's DECLARED reference-bearing fields,
          // so every name judged here is declared by construction and the
          // "`checkField` answers false for an undeclared key" trap cannot be
          // reached. Pinned in `ObjectMap.expandFls-7429.test.tsx`.
          //
          // Deferral matches every other gate on this path: an unanswered
          // policy filters nothing, and `perms` is in this effect's dependency
          // list, so the expansion is rebuilt the moment the answer arrives.
          //
          // `objectName` (checkField's target) and `objectSchema` (read keyed
          // by `recordSourceObjectName`, through `useSettledSchema` above) agree
          // only because this line sits inside the `dataProvider === 'object'`
          // branch, where the two resolvers coincide — not by construction;
          // hoisting this gate out of that branch would let them diverge silently.
          const expandable = buildExpandFields(objectSchema?.fields);
          const expand = !perms?.isLoaded
            ? expandable
            : expandable.filter((f) => perms.checkField(objectName, f, 'read'));
          const result = await dataSource.find(objectName, {
            $filter: queryFilter,
            $orderby: convertSortToQueryParams(schema.sort),
            // The platform ceiling (objectui#7210, ruling a′). A map still
            // fetches the whole FILTERED set — the camera fit is computed from
            // every marker, so a page would frame the wrong box — but it now
            // stops at a number rather than at whatever the table holds. One
            // probe row past the ceiling makes the cut detectable;
            // `applyNonGridRowCeiling` slices it off.
            // ⛔ Not authorable: no view key reaches this `$top`.
            ...nonGridRowCeilingQuery(),
            ...(expand.length > 0 ? { $expand: expand } : {}),
          });

          const capped = applyNonGridRowCeiling(result);
          commit(capped.rows, capped);
        }
        // No `api` arm: the view-level `api` data source is retired in
        // `@objectstack/spec` (objectstack#23082) and read by nothing here
        // (objectui#12325).
      } catch (err) {
        if (silent) {
          // A failed re-read of the query on screen keeps the last good rows
          // and the mounted map, exactly as `ObjectGantt`'s silent reload does:
          // it logs, it does not report. Those rows still answer the query.
          console.error('[ObjectMap] Failed to refresh data:', err);
        } else if (isCurrent()) {
          // A failed CHANGED query is reported: the rows in state answer the
          // previous query, so drawing them would misstate the screen.
          setError(err as Error);
        }
      } finally {
        // Only the newest run owns the flag. It clears it whatever its own
        // mode, because a silent run can overtake a loud one that set it.
        if (isCurrent()) setLoading(false);
      }
    };

    fetchData();
    return () => {
      fetchSeqRef.current += 1;
    };
  }, [dataProp, dataProvider, dataObjectName, dataItems, dataSource, hasInlineData, queryFilter, schema.sort, objectSchemaReady, objectSchema, perms, invalidationNonce, fetchesForItself]);

  // Transform data to map markers
  const { markers, invalidCount } = useMemo(() => {
    let invalid = 0;
    const validMarkers = data
      .map((record, index) => {
        const coordinates = extractCoordinates(record, mapConfig);
        if (!coordinates) {
          invalid++;
          return null;
        }

        // ADR-0079's unified record display-name resolver — the same one
        // `ObjectKanban`, `ObjectCalendar` and `ObjectGantt` already title
        // their items through. `ObjectMap` was the fourth
        // renderer and the only one still doing a bare property read against a
        // hard-coded `'name'` key, so every object whose display field is not
        // literally `name` titled EVERY marker popup `undefined` (objectui#5953).
        //
        // The declared binding is passed through as the explicit option rather
        // than dropped: `getRecordDisplayName` checks `options.titleField`
        // first, so an authored `map.titleField` still wins outright. What it
        // adds underneath are the steps a static field-name binding
        // structurally cannot carry — the object's `nameField`, its deprecated
        // `displayNameField` alias, the legacy `titleFormat` TEMPLATE, and the
        // record-key probe that runs when no object definition reached us
        // (inline `value` data never fetches one; see the schema effect above).
        //
        // `fallback: 'Marker'` keeps this component's own placeholder, but only
        // in the one position where the resolver has nothing left: an id-LESS
        // record. A record WITH an id now reads `Record #<id>`, which beats
        // `'Marker'` for the reason `'Marker'` was always weak on a map — every
        // marker is a marker, so the word separates none of them, while the id
        // names exactly one record. `fallback` is a declared option of the
        // resolver, so choosing between the two placeholders needs no change to
        // `@object-ui/core`.
        const title = getRecordDisplayName(objectSchema, record, {
          titleField: mapConfig.titleField,
          fallback: 'Marker',
        });
        // The description is derived as a display STRING, once, here
        // (objectui#10456). The popup, the mobile record sheet and the search
        // filter all read this one value, and all three treat it as text: the
        // two faces put it in JSX, and the search calls `.toLowerCase()` on it.
        // The raw field value is not text whenever `descriptionField` names a
        // lookup: this component's own object fetch expands every declared
        // relation, so the row carries `{ id, name }`, and React throws
        // `Objects are not valid as a React child` on the first marker click.
        // A number or a boolean made the search throw the same way.
        //
        // `recordDisplayValueAt` is the resolver the title above already uses
        // for an authored `titleField` (step 0 of `getRecordDisplayName`), so
        // the two text slots of one marker share one rule: an expanded lookup
        // reads as its display name, a bare id as itself, a number or a boolean
        // as its string, and an empty value as no description line.
        const description = recordDisplayValueAt(record, mapConfig.descriptionField);

        // Ensure lat/lng are within valid ranges
        const [lat, lng] = coordinates;
        if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            invalid++;
            return null;
        }

        return {
          id: record.id || record._id || `marker-${index}`,
          title,
          description,
          coordinates: [lng, lat] as [number, number], // maplibre uses [lng, lat]
          data: record,
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null);

    return { markers: validMarkers, invalidCount: invalid };
    // `objectSchema` is a dependency now, not incidentally: it lands from an
    // async fetch AFTER the first paint, and the titles above are resolved
    // from it. Omitting it would leave the first-painted markers titled from
    // a null object definition for the rest of the component's life.
  }, [data, mapConfig, objectSchema]);

  const selectedMarker = useMemo(() => 
    markers.find(m => m.id === selectedMarkerId),
  [markers, selectedMarkerId]);

  const [currentZoom, setCurrentZoom] = useState(mapConfig.zoom || 3);

  /**
   * Seed `currentZoom` from the camera MapLibre actually applies at mount,
   * instead of leaving it at the nominal `mapConfig.zoom || 3` above until
   * the user's first zoom. `initialViewState` (computed below) — including a
   * `bounds` fit — is resolved by the constructor before react-map-gl attaches
   * its React event handlers, so no `onZoom` fires for that first camera.
   * `onLoad` fires once the style has loaded and the initial camera has
   * settled (fit-bounds included), so reading the zoom off that event
   * captures the real applied value without waiting on user interaction
   * (objectui#5003).
   */
  const handleMapLoad = useCallback((e: { target?: { getZoom?: () => number } }) => {
    try {
      const zoom = e?.target?.getZoom?.();
      if (typeof zoom === 'number' && Number.isFinite(zoom)) {
        setCurrentZoom(Math.round(zoom));
      }
    } catch {
      /* ignore — falls back to the nominal seed / next onZoom */
    }
  }, []);

  const navigation = useNavigationOverlay({
    navigation: schema.navigation,
    objectName: schema.objectName,
    onRowClick,
  });

  // What choosing one record does: a marker click on the map, or a row of the
  // list shown instead of the map when it cannot start. One path, so they agree.
  const selectMarker = (marker: MarkerData) => {
    setSelectedMarkerId(marker.id);
    navigation.handleClick(marker.data);
    onMarkerClick?.(marker.data);
  };

  const filteredMarkers = useMemo(() => {
    if (!searchQuery.trim()) return markers;
    const q = searchQuery.toLowerCase();
    return markers.filter(m =>
      m.title?.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q)
    );
  }, [markers, searchQuery]);

  // Cluster markers when clustering is enabled
  const clusteredData = useMemo(() => {
    const shouldCluster = enableClustering ?? (schema.enableClustering || filteredMarkers.length > 100);
    if (!shouldCluster) {
      return filteredMarkers.map(m => ({
        id: m.id,
        coordinates: m.coordinates,
        markers: [m],
        isCluster: false,
      }));
    }
    return clusterMarkers(filteredMarkers, currentZoom, clusterRadius);
  }, [filteredMarkers, currentZoom, enableClustering, clusterRadius, schema]);

  /**
   * The box the records occupy, along the shortest arc containing them
   * (see `./camera`). `null` when there is nothing to fit.
   */
  const markerBounds = useMemo(
    () => computeMarkerBounds(filteredMarkers.map(m => m.coordinates)),
    [filteredMarkers],
  );

  /**
   * A camera the author declared, read from the documented `map` block. Only a
   * READABLE declaration counts: `MapConfigSchema` already warns about a
   * malformed one, and a shape whose numbers cannot be read is not a camera —
   * letting it suppress the fit would first-paint an empty viewport, which is
   * the defect this whole path exists to prevent (objectui#4941). Nothing is
   * coerced: an unreadable declaration is diagnosed and ignored, never adapted.
   */
  const declaredLatitude = typeof mapConfig.center?.[0] === 'number' ? mapConfig.center[0] : undefined;
  const declaredLongitude = typeof mapConfig.center?.[1] === 'number' ? mapConfig.center[1] : undefined;
  const declaredZoom = typeof mapConfig.zoom === 'number' ? mapConfig.zoom : undefined;
  const hasDeclaredCamera =
    declaredLatitude !== undefined || declaredLongitude !== undefined || declaredZoom !== undefined;

  /**
   * Initial camera. Read once, when `MapGL` mounts — which is also every time
   * the query changes, because the `loading` gate below unmounts the map for
   * the duration of each fetch the query's inputs cause. So the one-shot
   * camera always reflects the records that query returned, and nothing here
   * ever yanks a camera the user has since panned. A re-read of the query
   * already on screen, caused by the data-invalidation bus (objectui#10623), is
   * silent and keeps the map mounted, whether it succeeds or fails: the markers
   * move and the camera stays where the user left it.
   */
  const initialViewState = useMemo(() => {
    // Records, no declared camera: hand MapLibre the box and let it fit at the
    // real container size. `bounds` overrides center/zoom on the constructor.
    if (markerBounds && !hasDeclaredCamera) {
      return {
        bounds: markerBounds,
        fitBoundsOptions: { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM },
      };
    }

    // Otherwise the declared halves win and the rest falls back: to the box's
    // centre when there are records, to the world when there are none.
    const fallback = markerBounds ? boundsCenter(markerBounds) : { longitude: 0, latitude: 0 };
    return {
      longitude: declaredLongitude ?? fallback.longitude,
      latitude: declaredLatitude ?? fallback.latitude,
      zoom: declaredZoom ?? (markerBounds ? UNFITTED_CENTER_ZOOM : EMPTY_VIEW_ZOOM),
    };
  }, [markerBounds, hasDeclaredCamera, declaredLongitude, declaredLatitude, declaredZoom]);

  /**
   * REFUSAL — nothing declared where the coordinates live (objectui#8169).
   *
   * Placed ABOVE `loading` and `error`, for the reason objectui#8168 placed the
   * chart's category-axis refusal above its own: this is a static AUTHORING
   * fact that no fetch outcome can change. A skeleton that resolves into a
   * refusal, or a network error shown first, both send the author to debug the
   * wrong layer. The fetch above is left alone deliberately — gating it on the
   * binding would move which values the query effects read, and this card
   * changes what is RENDERED, not when data is fetched.
   *
   * The copy is the ruling's, verbatim. It names both accepted spellings
   * because they are alternatives, not a sequence, and it names them under
   * `map.` because the declared block is the authoring surface — the flat
   * top-level spelling this component also reads is the internal transport form
   * ObjectView / ListView produce (see `FlatMapConfigKeys`), which no author
   * writes. ⛔ Not translated: `@object-ui/plugin-map` carries no i18n
   * dependency and every user-facing string in this file is a literal, the same
   * shape as the "Calendar/Gantt configuration required" refusals in the
   * sibling plugins.
   */
  if (!hasCoordinateBinding(mapConfig)) {
    return (
      <div className={cn("min-w-0 overflow-hidden", className)}>
        <div
          className="flex items-center justify-center h-96 bg-muted rounded-lg border p-4 text-center"
          data-testid="map-missing-location-binding"
          role="alert"
        >
          <div className="text-destructive">
            Map configuration required — declare <code className="font-mono">map.locationField</code>{' '}
            or <code className="font-mono">map.latitudeField</code> +{' '}
            <code className="font-mono">map.longitudeField</code>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("min-w-0 overflow-hidden", className)}>
        <div className="flex items-center justify-center h-96 bg-muted rounded-lg border">
          <div className="text-muted-foreground">Loading map...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("min-w-0 overflow-hidden", className)}>
        <div className="flex items-center justify-center h-96 bg-muted rounded-lg border">
          <div className="text-destructive">Error: {error.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 overflow-hidden", className)}>
      {invalidCount > 0 && (
        <div className="mb-2 p-2 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded">
          {`${invalidCount} record${invalidCount !== 1 ? 's' : ''} with missing or invalid coordinates excluded from the map.`}
        </div>
      )}
      {markers.length > 0 && (
        <div className="mb-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search locations…"
            className="w-full px-3 py-2 text-sm border rounded-md bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}
      <div className="relative border rounded-lg overflow-hidden bg-muted h-[300px] sm:h-[400px] md:h-[500px] lg:h-[600px] w-full">
         {!mapCanStart ? (
           // No WebGL2: `MapGL` is never mounted (see `canStartMap`), so the
           // records the markers would draw are listed here instead — the same
           // `filteredMarkers` the search box above narrows, each row taking
           // the marker's own click path.
           <div className="flex h-full flex-col" data-testid="map-webgl2-fallback">
             <div
               role="alert"
               className="p-2 text-sm text-center text-amber-900 bg-amber-50 border-b border-amber-200"
             >
               Map failed to load (this browser does not provide WebGL2, which the map needs). The records are
               listed below; turn on hardware acceleration or use a browser with WebGL2 to see the map.
             </div>
             <ul className="min-h-0 flex-1 overflow-y-auto divide-y bg-background" aria-label="Locations">
               {filteredMarkers.length === 0 && (
                 <li className="px-3 py-2 text-sm text-muted-foreground">No locations to list.</li>
               )}
               {filteredMarkers.map((marker) => (
                 <li key={marker.id}>
                   <button
                     type="button"
                     onClick={() => selectMarker(marker)}
                     className={cn(
                       'block w-full px-3 py-2 text-left hover:bg-accent focus:outline-none focus-visible:bg-accent',
                       marker.id === selectedMarkerId && 'bg-accent',
                     )}
                   >
                     <span className="block truncate text-sm font-medium">{marker.title}</span>
                     {marker.description && (
                       <span className="block truncate text-xs text-muted-foreground">{marker.description}</span>
                     )}
                   </button>
                 </li>
               ))}
             </ul>
           </div>
         ) : (
         <MapGL
            ref={(r) => { mapRef.current = r as any; }}
            initialViewState={initialViewState}
            style={{ width: '100%', height: '100%' }}
            mapStyle={mapConfig.style || DEFAULT_MAP_STYLE}
            touchZoomRotate={true}
            dragRotate={true}
            touchPitch={true}
            onLoad={handleMapLoad}
            onZoom={(e) => setCurrentZoom(Math.round(e.viewState.zoom))}
            onError={handleMapError}
         >
            {mapStyleError && (
              <div
                role="alert"
                className="absolute inset-x-0 top-0 z-20 p-2 text-sm text-center text-amber-900 bg-amber-50 border-b border-amber-200"
              >
                Map failed to load ({mapStyleError}). Markers below are still listed in the search box;{' '}
                {mapConfig.style ? 'check the configured map style URL.' : 'configure a custom map style for production use.'}
              </div>
            )}
            <NavigationControl position="top-right" showCompass={true} showZoom={true} />

            {/* Geolocation button — explicit user-initiated location request */}
            <button
              type="button"
              onClick={requestUserLocation}
              disabled={geoBusy}
              className="absolute top-2 left-2 z-10 inline-flex items-center justify-center size-9 rounded-md bg-background/95 border shadow-sm hover:bg-background disabled:opacity-50"
              aria-label="Show my location"
              data-testid="map-geolocate"
            >
              <span aria-hidden="true">{geoBusy ? '⏳' : '🧭'}</span>
            </button>

            {userLocation && (
              <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="center">
                <div
                  className="size-3 rounded-full bg-blue-500 ring-4 ring-blue-500/30 shadow"
                  aria-label="Your location"
                  data-testid="map-user-location"
                />
              </Marker>
            )}

            {clusteredData.map(cluster => (
              cluster.isCluster ? (
                <Marker
                  key={cluster.id}
                  longitude={cluster.coordinates[0]}
                  latitude={cluster.coordinates[1]}
                  anchor="center"
                  onClick={(e) => {
                    e.originalEvent.stopPropagation();
                    // Cluster tap-through: zoom in toward the cluster center.
                    try {
                      const next = Math.min(20, Math.max(currentZoom + 2, 8));
                      mapRef.current?.flyTo({
                        center: [cluster.coordinates[0], cluster.coordinates[1]],
                        zoom: next,
                        duration: 600,
                      });
                    } catch { /* ignore */ }
                  }}
                >
                  <div
                    className="flex items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-xs cursor-pointer hover:scale-110 transition-transform shadow-md"
                    style={{
                      width: Math.min(48, 24 + cluster.markers.length * 2),
                      height: Math.min(48, 24 + cluster.markers.length * 2),
                    }}
                    title={`${cluster.markers.length} markers`}
                    data-testid="map-cluster"
                  >
                    {cluster.markers.length}
                  </div>
                </Marker>
              ) : (
                <Marker
                    key={cluster.id}
                    longitude={cluster.coordinates[0]}
                    latitude={cluster.coordinates[1]}
                    anchor="bottom"
                    onClick={(e) => {
                        e.originalEvent.stopPropagation();
                        selectMarker(cluster.markers[0]);
                    }}
                >
                    <div className="text-2xl cursor-pointer hover:scale-110 transition-transform">
                        📍
                    </div>
                </Marker>
              )
            ))}

            {selectedMarker && !isMobile && (
                <Popup
                    longitude={selectedMarker.coordinates[0]}
                    latitude={selectedMarker.coordinates[1]}
                    anchor="top"
                    onClose={() => setSelectedMarkerId(null)}
                    closeOnClick={false}
                >
                    <div className="p-2 min-w-[150px] sm:min-w-[200px]">
                        <h3 className="font-bold text-sm mb-1">{selectedMarker.title}</h3>
                        {selectedMarker.description && (
                            <p className="text-xs text-muted-foreground">{selectedMarker.description}</p>
                        )}
                        <div className="mt-2 text-xs flex gap-2">
                             {onEdit && (
                                <button type="button" className="text-blue-500 hover:underline" onClick={() => onEdit(selectedMarker.data)}>Edit</button>
                             )}
                             {onDelete && (
                                <button type="button" className="text-red-500 hover:underline" onClick={() => onDelete(selectedMarker.data)}>Delete</button>
                             )}
                        </div>
                    </div>
                </Popup>
            )}
         </MapGL>
         )}
         {/* Mobile UX (round 3) — bottom-sheet record card replaces the
             Popup on small viewports for a native-feeling mobile pattern. */}
         {selectedMarker && isMobile && (
           <div
             className="absolute inset-x-0 bottom-0 z-30 bg-background border-t shadow-lg rounded-t-2xl p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
             role="dialog"
             aria-label="Location details"
             data-testid="map-mobile-record-sheet"
           >
             <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
             <div className="flex items-start justify-between gap-3">
               <div className="min-w-0 flex-1">
                 <h3 className="text-sm font-semibold truncate">{selectedMarker.title}</h3>
                 {selectedMarker.description && (
                   <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{selectedMarker.description}</p>
                 )}
               </div>
               <button
                 type="button"
                 onClick={() => setSelectedMarkerId(null)}
                 className="text-muted-foreground hover:text-foreground text-lg leading-none px-2"
                 aria-label="Close details"
                 data-testid="map-mobile-record-close"
               >
                 ×
               </button>
             </div>
             <div className="mt-3 flex flex-wrap gap-2 text-xs">
               {onEdit && (
                 <button type="button"
                   className="px-3 py-1.5 rounded-md border bg-card hover:bg-accent"
                   onClick={() => onEdit(selectedMarker.data)}
                 >Edit</button>
               )}
               {onDelete && (
                 <button type="button"
                   className="px-3 py-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10"
                   onClick={() => onDelete(selectedMarker.data)}
                 >Delete</button>
               )}
             </div>
           </div>
         )}
         {geoError && (
           <div className="absolute top-2 left-14 right-2 z-10 text-xs px-3 py-1.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30">
             {geoError}
           </div>
         )}
      </div>
      {/* objectui#7210 — a map drawn from the first N of a larger result set
          still looks like a complete map, and its camera is fitted to a box
          that is not the data's. Placement follows objectui#7148's chart
          footnote: a muted note directly under the surface it describes. */}
      {rowCeiling && <NonGridRowCeilingNote result={rowCeiling} />}
      {navigation.isOverlay && (
        <NavigationOverlay {...navigation} title="Location Details">
          {(record) => (
            <div className="space-y-3">
              {Object.entries(record).map(([key, value]) => (
                <div key={key} className="flex flex-col">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {key.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm">{String(value ?? '—')}</span>
                </div>
              ))}
            </div>
          )}
        </NavigationOverlay>
      )}
    </div>
  );
};

export default ObjectMap;
