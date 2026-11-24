---
'@object-ui/data-objectstack': patch
'@object-ui/plugin-designer': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell, plugin-designer, console): app writes send the app as its author stored it, not as the console's locale serves it

Clause-②: no
Metadata-protocol: none

The served app list is translated for the reader's locale, and the metadata save door stores a body verbatim. Four writers seeded a whole-app save from that served list: the Edit app wizard, App management's Disable / Enable / Set default and bulk toggles, the navigation sync that adds or removes an entry when a page, dashboard, report or object is created or deleted, and the Publish button on an unpublished app. In a zh-CN session each of them stored the app's label and every navigation label in Chinese, and readers in every other locale were then served Chinese. Each writer now reads the stored app from the untranslated layers through the new `ObjectStackAdapter.getAuthoredItem(type, name, { packageId })`, and changes only the keys its control owns. The served list is still used to find the app. When the stored app cannot be read, the writer refuses with an error and saves nothing; the Edit app page shows the read error instead of opening the wizard.
