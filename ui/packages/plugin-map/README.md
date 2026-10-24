# @object-ui/plugin-map

Map view plugin for Object UI.

Renders the records of an **ObjectQL query** as markers on a MapLibre map: every
marker comes from a record's own coordinate fields, and the first paint frames the
records that were fetched. It is a *view over data* — there is no authored marker
list, and no pin you place by hand.

Importing the package registers one component type on the `ComponentRegistry`:
`object-map`, the object-bound renderer. Inside an `ObjectView`, a stored `map`
view is compiled to an `object-map` node, so a saved map view ends at the same
component.

> **The bare `map` node type key is retired** (objectui#10393, following the
> objectui#8008 ruling that retired `gantt`). The registry used to accept a node
> authored `"type": "map"` (and its namespaced twin `view:map`) while the
> published declaration refused it — `ObjectMapSchema.type` is the literal
> `'object-map'` and no schema arm names `map` — so a validated document could not
> use the key the registry took. Write `"type": "object-map"`.
>
> ⚠️ The **stored view type** `"map"` — what a saved `listViews[].type` or
> `defaultViewType` holds — is a **different layer and is unchanged**. Do not
> rewrite it: `ObjectView` maps a stored `map` view onto the `object-map` node
> type, so no saved view moves.

## Installation

```bash
pnpm add @object-ui/plugin-map
```

## Requires a bundler — plain Node cannot import this package

`ObjectMap` imports MapLibre's stylesheet at module scope
(`import 'maplibre-gl/dist/maplibre-gl.css'`), and Node has no loader for `.css` at all.
Importing the published entry from plain Node ESM — no bundler, no loader hooks — therefore
resolves and then fails during evaluation:

```text
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css"
  for .../maplibre-gl/dist/maplibre-gl.css
```

**This is a supported-configuration statement, not a bug to report.** Unbundled Node
consumption is not supported for style-carrying plugin packages. It was ruled that way on
[objectui#5384](https://github.com/objectstack-ai/objectui/issues/5384) — deliberately, over
the alternative of moving the stylesheet out of module scope — because a MapLibre canvas
without its stylesheet is not a map, and no unbundled-Node consumer exists to serve.

Consume it through a host that handles CSS imports, which every supported host does: Vite,
webpack, or Next with the package listed in `transpilePackages`. If you have a real need to
import it under plain Node — SSR with no bundler, a Node-side script — please open an issue.
That reopens the question as a design decision rather than a defect, and the shape of your
consumer is the missing input.

## Usage

Registration is a side effect of the import. There is no manual-registration
export to iterate over — the import *is* the registration.

An authored `object-map` node takes its props in its `properties` bag, whose
members are `@objectstack/spec`'s `ComponentPropsMap['object-map']` row.
`objectui validate` refuses a prop written flat on the node by name, naming its
bag member, as the spec's own page component does (objectui#10859).
`SchemaRenderer` hoists the bag onto the node before `ObjectMap` runs, so
`ObjectMapSchema` (`@object-ui/types`) is the node as the component reads it.

```ts
import '@object-ui/plugin-map';
import type { ObjectMapBlockNode } from '@object-ui/types';

// Object-bound: the markers are the records the query returns.
const schema: ObjectMapBlockNode = {
  type: 'object-map',
  properties: {
    objectName: 'stores',
    map: {
      latitudeField: 'lat',
      longitudeField: 'lng',
      titleField: 'name',
      descriptionField: 'address',
    },
  },
};
```

A literal record array instead of a query, with the same `map` block:

```ts
import type { ObjectMapBlockNode } from '@object-ui/types';

const schema: ObjectMapBlockNode = {
  type: 'object-map',
  properties: {
    staticData: [
      { id: 1, name: 'San Francisco HQ', lat: 37.7749, lng: -122.4194 },
      { id: 2, name: 'Oakland Office', lat: 37.8044, lng: -122.2711 },
    ],
    map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' },
  },
};
```

`filter` and `sort` are the **query's** filter and order — they reach the data
source as `$filter` / `$orderby`, and the spec's per-element `dataSource` binding
is honoured as well.

**The provider does not change which query keys apply** (objectui#9061, the port
of objectui#8769). An authored `filter` and `sort` narrow and order the rows on
**every** provider, inline ones included — `staticData` and
`data: { provider: 'value', items }` both reach the same in-memory adapter the
other providers go through, so `filter` is evaluated with the same matcher. A
bare array under `data` is not a record source on this map (objectui#8348): the
ladder falls through to `staticData`, then `objectName`, so inline rows belong
under `staticData`. Before objectui#9061 the inline provider skipped that query
and plotted every authored row with an authored `filter` silently dropped. The
platform row ceiling (2,000 drawn rows, with a footnote naming both numbers — objectui#7210,
ruling a′) applies to inline rows too, and it is applied to the **filtered** set,
never to the raw one: a large inline array that a `filter` cuts below the ceiling
plots every matching row and shows no footnote.

⚠️ Two consequences of routing inline rows through the adapter. They reach the
map as that adapter's own deep copy rather than as the authored array's object
identities, so code comparing a record handed to `onMarkerClick` against the
authored array with `===` needs `id` equality instead; and the copy is a JSON
round-trip, so inline rows must be JSON-serializable.

## The `map` block

The declared configuration input. Every key is optional, and the block is
**closed** (objectui#5157): a key outside this table — a typo such as
`latitudeFieId` — is refused by `objectui validate` with an `unrecognized_keys`
issue at `properties.map` that names it (on a root node; a nested node reports under
`invalid_union` at `children`, with the key in the arm detail). At runtime
`ObjectMap` does not throw: it renders from the declared keys and warns
`[ObjectMap] Invalid map configuration` in the console, naming the same key; the
undeclared key is never read. A typo that leaves the block with no coordinate
binding, as `latitudeFieId` does, therefore draws the "Map configuration
required" refusal below rather than a map.

| Key | Description |
| --- | --- |
| `latitudeField` | Record field holding the latitude. Needs `longitudeField` alongside it; both values must be numbers. |
| `longitudeField` | Record field holding the longitude. |
| `locationField` | Single field holding both coordinates — see the formats below. Used when the lat/lng pair yields nothing. |
| `titleField` | Field shown as the marker title. Omitted, the title is resolved by the object's own record-title precedence (`@object-ui/core`'s `getRecordDisplayName`, ADR-0079): the declared `nameField`, its deprecated `displayNameField` alias, the legacy `titleFormat` template, a type-aware pick from the object's fields, then name-ish keys read straight off the record — the rung that answers when no object definition reached the view, as `staticData` and an inline `data: { provider: 'value', items }` configuration never fetch one. `Record #<id>` is the floor; `Marker` is reached only by a record carrying no id at all. |
| `descriptionField` | Field shown under the title in the marker popup. |
| `zoom` | Zoom level. Declaring it opts this view out of the auto-fit (see below). |
| `center` | `[latitude, longitude]` — a two-number **tuple**, latitude first. Declaring it opts this view out of the auto-fit. |
| `style` | MapLibre style URL/spec, replacing the default public demo style. The node-level `mapStyle` is read before it, so it applies when `mapStyle` is absent. |

**Nothing is guessed — an unbound map REFUSES.** A map with no coordinate binding
renders

> Map configuration required — declare `map.locationField` or `map.latitudeField` + `map.longitudeField`

in place of the map, rather than painting an empty one (objectui#8169, ruled
2026-09-07). *Unbound* is a property of the resolved config, not of the spelling
that produced it — an absent `map` block, a block naming only `titleField`, and a
`latitudeField` with no `longitudeField` beside it all refuse alike.

The four field-name defaults this component used to fall back to — `latitude` /
`longitude` / `location` / `description` — are gone, and so are the
`locationField: … || 'location'` floors that `plugin-list` and `plugin-view` used
to add on the way in. ⚠️ **Behaviour change for existing metadata**: a record set
that happens to carry `latitude` / `longitude` columns no longer plots on a view
that declared no binding — it refuses, and the fix is to declare the binding.
A title field is still never guessed (objectui#5953): an unconfigured marker
takes its title from the record-title precedence above.

## Node-level keys beside the block

| Key | Description |
| --- | --- |
| `mapStyle` | MapLibre style URL or spec, replacing the demo tiles. Read before `map.style`, so it wins when both are written. Not the node's base `style`, which is an inline CSS record. |
| `enableClustering` | `true` groups nearby markers into numbered clusters. Absent, the map clusters only above 100 markers; `false` turns clustering off at any count. |
| `navigation` | What a marker click opens — the spec's `NavigationConfig`. `drawer`, `modal` and `popover` open the marker's record; `new_window` (or `openNewTab: true`, which outranks every mode except `none`) opens the record page in a new tab; `preventNavigation: true` opens nothing. An absent key, `none` and `split` open nothing (the map hands the split shell no main panel). `page`, and a block without `mode` (the spec's `page` default), open the record page of the map's `objectName` through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views); under a host that publishes none, or on a map that names no `objectName`, the click opens nothing. A parent view's click handler outranks the whole key. |

## Initial camera

There is no default zoom and no default centre. With records to show and no
camera declared, the map **fits the records**: their bounding box, measured along
the shortest arc that contains them (so a set straddling the antimeridian is
framed across the line, not around the far side of the planet), with 48px of
padding and a city-scale zoom ceiling of 12 — a single record does not become a
rooftop view.

Two cases sit outside the fit:

- **Nothing placeable** (empty result, or no record yielding coordinates): the
  whole world, centred on `0, 0`.
- **A declared camera**: `zoom` or `center` in the `map` block wins and the fit is
  skipped. Declaring one half keeps the other derived — `zoom` alone is applied at
  the centre of the records, `center` alone at a continental zoom.

A `center` that is not a two-number tuple (the `{ lat, lng }` object form, say) is
rejected by the config schema, warned about in the console, and **not** adapted —
and it does not cost the view its fit.

## Coordinate formats

`locationField` names one record field, and the value in it is read at RUNTIME:
`extractCoordinates()` in `packages/plugin-map/src/ObjectMap.tsx` tests the value's
shape per record and takes the first of these three that answers. So this is a
reference read of what that parser accepts, not a value you author — which is why
it is a table rather than a snippet:

| Shape of `record[locationField]` | Example value | What the parser accepts |
| --- | --- | --- |
| Object | `{ lat: 37.7749, lng: -122.4194 }` | `lat` or `latitude` for the latitude; `lng`, `lon` or `longitude` for the longitude. Both must already be numbers — an object form is not string-parsed. |
| String | `'37.7749,-122.4194'` | `"lat,lng"`: split on the comma, each half trimmed and `parseFloat`-ed. |
| Array | `[37.7749, -122.4194]` | `[lat, lng]`, exactly two elements, each `parseFloat`-ed. |

The lat/lng PAIR (`latitudeField` + `longitudeField`) is tried first and is
stricter: both values must already be numbers, with no parsing step at all.

A record whose coordinates are missing, unparseable, or out of range (latitude
beyond ±90, longitude beyond ±180) is left off the map and counted in a notice
above it, rather than being silently dropped or rescued. The range test and the
notice live in that same file, alongside the parser.

## What this component does not read

Keys that look plausible on a map schema but have no read site here: `markers`
(markers are records), `layers`, `height` (the container is a fixed responsive
height, 300px through 600px), `useGeolocation` (the map carries a
user-initiated "show my location" button instead), and per-marker `icon` /
`color` / `popup` styling. A `map` configuration stashed under `filter.map` — a
shape predating the `map` input — is no longer read either, and says so in the
console.

## Using `ObjectMap` directly

`ObjectMap` (the component), `ObjectMapRenderer` (the registered wrapper, for a
host that registers types itself) and the `ObjectMapProps` type are the package's
exports. A component mounted directly is not behind `SchemaRenderer`, so nothing
hoists a `properties` bag: its `schema` prop takes the node as the component
reads it, with the keys flat:

```tsx
import { ObjectMap, type ObjectMapProps } from '@object-ui/plugin-map';

declare const dataSource: ObjectMapProps['dataSource'];

<ObjectMap
  schema={{ type: 'object-map', objectName: 'stores', map: { latitudeField: 'lat', longitudeField: 'lng' } }}
  dataSource={dataSource}
  onMarkerClick={(record) => console.log(record)}
/>;
```

| Prop | Description |
| --- | --- |
| `schema` | The map schema — the keys above. |
| `dataSource` | Resolves the `object` provider. Not needed for `staticData` or an inline `data: { provider: 'value', items }` configuration. |
| `className` | Classes for the wrapper around the map. |
| `data` | Records to render directly, bypassing the component's own fetch — the shape `ListView` passes when it already holds the rows. Tracked live: passing a new array after mount (e.g. once a host's own in-flight query resolves) updates the map. |
| `onMarkerClick` | Called with the clicked record. |
| `onRowClick` | Record click handler; takes priority over the `navigation` overlay. |
| `onEdit` / `onDelete` | Passing either adds that button to the marker popup (and to the mobile record sheet). |
| `enableClustering` | Forces clustering on; without it, clustering starts above 100 visible markers. |
| `clusterRadius` | Clustering granularity (default `50`): the grid cell is `clusterRadius / 2 ** zoom`, so a larger value groups more aggressively. |

In a schema-driven page these handlers may equally be authored on the node
itself: `SchemaRenderer` spreads a node's non-metadata properties onto the
component.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-map) — the full
  authoring reference for the schema and the `map` block
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-map)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
