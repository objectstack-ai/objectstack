---
'@object-ui/plugin-grid': patch
'@object-ui/core': patch
'@object-ui/types': patch
'@object-ui/i18n': patch
---

fix(plugin-grid): a rejected aggregate bulk action reports one outcome for the selection and refreshes the list

Clause-②: no — the dialog reports an aggregate outcome truthfully; no surface added
Metadata-protocol: none

An aggregate bulk action (`bulkActionDefs` entry with `execution: 'aggregate'`) is one call for the whole selection. When that call rejected, the result dialog printed the rejection's platform `message` against every selected record, read "Succeeded 0 / N" even when the handler had already changed some of them, and the list kept showing the old values until a manual reload.

A rejected aggregate run is now one outcome for the selection. The dialog says the action did not complete for the selected records and shows the rejection's message once: its `userMessage` when the handler threw one (the text it wrote for the user, already in the request's locale), else its `message`. It shows no per-record count and no per-record failure list, because one call cannot say which records it changed before it stopped. The list re-reads its rows when the dialog closes, whether the action resolved or rejected, and the selection stays after a rejection for a re-run. The per-record dispatch (`bulkActions: ['NAME']`) reports exactly as before.

To carry the text, a failed script/server action dispatch now relays the refusal's `error.userMessage` on `ActionResult.userMessage` (`@object-ui/types`), read by `createServerActionHandler` (`@object-ui/core`); `error` stays the whole text. The new dialog sentence is translated in every locale pack.
