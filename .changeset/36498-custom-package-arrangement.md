---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
'@objectstack/cloud-connection': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
'@object-ui/plugin-detail': minor
---

feat(spec): a base's paired `.custom` package declares an installed object's whole field-group and tab arrangement (`fieldGroups`, `relatedLists` on its object extension)

Clause-②: yes (widening)
Metadata-protocol: added

The record page is arranged in three layers. The package that owns an object declares its `fieldGroups` and `relatedLists`; a package that extends it places what it brings with `place`; and now the environment, in the base's paired `.custom` package, may declare the whole arrangement over both:

```ts
objectExtensions: [{
  extend: 'crm_lead',
  fields: { region__c: { type: 'text', label: 'Region' } },
  // The whole field arrangement: the two groups swapped, `status` moved.
  fieldGroups: [
    { key: 'contact', label: 'Contact', fields: ['email', 'phone', 'status'] },
    { key: 'basic', label: 'Basics', fields: ['name', 'company', 'region__c'] },
  ],
  // The whole tab list: events before tasks, the notes tab hidden.
  relatedLists: ['crm_event', 'crm_task', { list: 'crm_note', hidden: true }],
}],
```

- **Two new keys on an object extension, written only by a `.custom` package.** `fieldGroups` takes the shape an object's `fieldGroups` takes and may list any field the object has, whoever declares it; a group's `relatedList` may place any body table. `relatedLists` takes an object's entry shape (a bare name, the three built-in tab names, or `{ list, label?, columns? }`) plus `hidden`.
- **Each key replaces, whole.** The registry applies it last: the owner's arrangement, then every extension's `place`, then the `.custom` key in place of the result. Nothing is merged entry by entry. A key the extension does not write keeps the owner's arrangement with the placements, so writing only `relatedLists` leaves the field groups as they were.
- **A field the arrangement does not list is not dropped.** It shows after the last group, whichever group its owner or another extension had put it in. A group that lists `fields` shows exactly its list.
- **A tab the arrangement does not name still shows, after the listed ones.** This is the reverse of an object's own `relatedLists`, where leaving a list out hides it. Hiding is written: `{ list: 'crm_note', hidden: true }` hides that list's tab, whichever package brings it. `hidden` is accepted only here; an object's own `relatedLists` refuses it and says where it belongs. A list the owner hides by leaving it out of its own `relatedLists` stays hidden until the arrangement names it. The built-in tabs keep their own rules and are not hidden here.
- **A package that is not a `.custom` package writing either key is refused**, once at each door: saving or publishing the extension, `os validate` and `os build`, and installing the package (`VALIDATION_ERROR`; 400 at save and publish, 422 at install). Each refusal names the key, the object and the package and prescribes `place`. An extension that reaches the registry past those doors is not applied, and the boot log says so. Within one extension, a `place` entry beside the arrangement key that would replace it is refused at parse.
- **Only the object's own pair is served.** The pair is the `.custom` package of the App the object belongs to: for an object a module of an App owns, the App's pair. A `.custom` package an earlier version created for the module itself is still read while it is installed; where both write a key, the App's pair is served. The choice is by role, never by load order. What any other `.custom` package writes under these keys is not refused at the doors; the registry does not apply it, alone or beside the pair, and the boot log names the package and the object.
- **One merge, every reader.** The record page, the forms, the preview and Studio read the served object, so they show one arrangement. Removing a key, or uninstalling or disabling the `.custom` package, serves the owner's arrangement with the placements again.
- **Served reads say what the reader cannot derive.** Where a `.custom` package writes `relatedLists`, the served object carries the read decoration `_relatedListsArrangement` (`{ packageId, hidden, unlisted }`): the lists the environment hides, and whether an unlisted list shows. The record page's tab reader and the default page synthesis read it; with no decoration served they answer exactly as before. A reader's own tab order (kept per user) is still laid over this list, and a tab the environment hides is not offered to them.
- **A group the arrangement brings is a translation anchor.** `os validate`'s translation-reference rule reads an extension's `fieldGroups` too, so a bundle's `_sections` key for a group the `.custom` arrangement declares is not reported as naming nothing.
- **`hidden` on a field is not a display property a `fieldPatches` entry may set.** A hidden field is also left out of the search index and out of a form's required check, so the display whitelist is not widened. To keep a vendor field off the record page and the forms, list it in a group whose `visibleWhen` is false. That is presentation only, not access control: the field stays readable and writable through the API. Do not use it for a `required` field that has no default: the create form no longer shows the field while the save still requires it, so the form cannot be submitted.

What to check in an app: nothing changes until a `.custom` package writes one of the two keys. A package other than a `.custom` one that wrote `fieldGroups` or `relatedLists` on an extension was refused at parse. It is now refused by the save, publish, install, `os validate` and `os build` doors, with the same prescription. Where none of those doors judges it (for example a code-defined stack that boots without `os validate` or `os build`, or a stack that names no package id), the key is not applied and the boot log names it, where the parse refused it before.
