---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
---

feat: a record-page tab title an object's `relatedLists` entry declares can be translated

Clause-②: yes (widening)
Metadata-protocol: added

An object-form `relatedLists` entry (`{ list, label, columns }`) titles its tab and table on the parent's record page, and its `label` wins over the child lookup field's `relatedListTitle`. The field's title had a translation key; the entry's did not, so a declared tab title showed its authored text in every locale.

A translation bundle now carries it on the parent object, keyed by the entry's literal `list` (a dotted `object.field` is one key):

```ts
objects: {
  account: {
    _relatedLists: {
      contact: { label: '联系人' },
      'event.related_to': { label: '会议' },
    },
  },
}
```

- `@objectstack/spec`: `ObjectTranslationDataSchema._relatedLists` (a closed leaf with one key, `label`; the un-prefixed `relatedLists` is named as a rename onto `_relatedLists`). `translateObject` overlays it onto the served parent object's entries, so `GET /meta/object` serves the translated title and the console's record page shows it with no change of its own. Only an entry that authors a `label` is translated: an entry without one, a bare name and a built-in tab keep their current title (the child field's `relatedListTitle`, else the child object's plural label). A title a tenant changed keeps its text, as every other translated slot does.
- `@objectstack/lint`: `os i18n extract` scaffolds the key for every labelled entry and the coverage gate counts it; `os validate` reports a `_relatedLists` key that names no labelled entry of that object as `translation-target-unknown`. A labelled entry an object extension brings (a list placement in `place`, or a shown entry of the paired `.custom` package's `relatedLists`) is a labelled entry of the object it extends, so its key resolves; the record page shows a placed tab only where that object declares `relatedLists`. A key over a built-in tab, or over an entry the `.custom` arrangement hides, is reported with its own reason.
- `@objectstack/metadata-protocol`: a save that sends back a translated entry title (a Studio edit of the object read in another language) stores the source title instead, with an `info` advisory, as it already does for field labels.
- `@objectstack/objectql`: the packaged base `getPackagedObjectBase` hands the `/meta` read (the text a served slot is compared with) carries the tabs a code package's `place` adds to the owner's `relatedLists`, as the fold splices them (so only where the owner declares `relatedLists`). A placed title is therefore translated from the deployment's catalog, which carries the placing package's translations, the way a field such a package adds already is; a tenant's rename of that title keeps its text. A `.custom` arrangement's title is the customization layer and reads the pair's own translations.
