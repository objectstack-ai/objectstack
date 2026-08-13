---
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
---

fix(i18n): the object catalog no longer overwrites an explicitly-set `label` / `pluralLabel` / `description`

`translateObject` resolved an object's three scalars as `catalog ?? document`. The
i18n catalog is keyed by object name and is the packaged translation of the
**packaged** declaration, so consulting it first discarded every value authored on
top of that declaration: a code-shipped `objectExtensions` scalar, and — the severe
half — a tenant's own Studio rename, which answered `200` and then appeared on
neither `GET /meta/object` nor `GET /meta/object/:name`, i.e. neither read a
writable form derives from.

The catalog now applies only while the document's scalar still equals the packaged
base value; a scalar that differs was authored by somebody, and the catalog yields
to it. Comparison-based, per scalar, with no provenance flag carried through the
fold: `@objectstack/metadata-protocol` exposes the packaged owner declaration
(`getPackagedObjectBase`) and `@objectstack/rest` hands it to the translator at the
three sites that localize an object document. A host whose protocol does not
answer keeps the previous behaviour exactly, so nothing loses a translation it has
today. `?layers=true` stays untranslated and diagnostic, unchanged.
