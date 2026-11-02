---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a landed Studio draft autosave names what it saved

Clause-②: no
Metadata-protocol: none

A Studio draft autosave used to land with no feedback but the top bar's "Saved HH:MM", which names nothing. Now, once the save lands, Studio shows a toast that names the item: "Draft saved: Task" for an object (or for its customization, in a package that customizes a base), for an Interfaces page, dashboard or report, for an app's navigation, and for a flow. The toast uses one id per item, so the saves that follow each editing pause update the toast already on screen instead of stacking more toasts; another item saved meanwhile gets its own. The top bar's saved hint stays. A refused save keeps its refusal strip and shows no "saved" toast.

- **`@object-ui/app-shell`**: the Data, Interfaces and Automations pillars announce each landed draft autosave by the item's label.
- **`@object-ui/i18n`**: one new studio-namespace string, `engine.studio.draftSaved` ("Draft saved: {item}"), in English and Chinese.
