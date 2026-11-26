---
'@objectstack/skills': patch
---

docs(skills): the data skill picks an object's colour by business family and teaches `showOnCreate`; the automation skill routes a stepped single-object form to a named wizard form an action opens

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data` told authors to give every object a colour and avoid repeats in one app. With nine palette names any app past nine objects must repeat one, and the platform's own objects are coloured by business family instead. The `color` row now says to group an app's objects into a few business families with one palette name each, gives the platform's families as the worked example (people `blue`, security `purple`, approvals and work `orange`, messaging `pink`, integrations `teal`, reference data and finance `green`, audit and settings `amber`), keeps `red` for an object that is an alert, and leaves an object nobody opens without one. The quick-start object example declares a `color`.

The data skill's field rules now teach `showOnCreate: false` (a field left off every create surface, refused beside `required: true`), and its Relationships rule no longer points at the `subforms` overrides the UI skill dropped. `skills/objectstack-automation` routes a stepped form over one object that never branches to a named form view (`type: 'wizard'`) that a `type: 'form'` action opens. New text is paid for by cuts in the same files. No metadata shape changes.
