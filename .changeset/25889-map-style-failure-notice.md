---
'@object-ui/plugin-map': patch
'@object-ui/i18n': patch
---

fix(plugin-map): a map whose style or tiles fail to load shows the record list with a translated notice, instead of a grey canvas under an English alert

Clause-②: no
Metadata-protocol: none

- **`@object-ui/plugin-map`:** when MapLibre reports a style or tile load failure (an intranet or proxied deployment that cannot reach the tile host, an unreachable style URL), the map view now removes the map and lists its records in its place, the same list a browser without WebGL2 already got: searchable, and each row opens the record the way its marker did. A "Try the map again" button brings the map back. The notice above the list keeps MapLibre's reason and names a remedy that exists: a view with its own map style is told to check that URL, and a view on the public default style is told to ask an administrator to set a map style for the view. It no longer says the markers are "listed in the search box" or asks for a "custom map style for production use" setting that does not exist. That notice, the WebGL2 notice, the list's label and empty text, and the "records excluded for missing or invalid coordinates" count now read the translation bundle, so a zh-CN console shows them in Chinese.
- **`@object-ui/i18n`:** eight new `element.map.*` keys in all ten packs.

What to do: nothing. A deployment-wide map style setting is not part of this change.
