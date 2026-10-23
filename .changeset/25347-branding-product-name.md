---
'@objectstack/service-settings': patch
---

fix(service-settings): Settings → Branding's name is labelled the product name, shows no default the console never uses, and Localization's timezone says it is the one in effect

Clause-②: yes
Metadata-protocol: none

One organization showed three names: Branding's "Organization name" read `ObjectStack`, the organization record read `Default Organization`, and the console read `ObjectOS`. Branding's key names the PRODUCT the deployment shows, and the organization's own name lives on its record, so each now says which one it is.

- **`branding.workspace_name`.** The label is "Product name" (in all four bundles), not "Organization name". Its help says an empty value uses the name the deployment was set up with, and that the organization's own name is the Name on the Organization record.
- **No default.** The `'ObjectStack'` default is gone. Neither reader ever served it: the runtime config and the auth readers use only a value somebody saved, and otherwise the deployment's own name (`OS_PRODUCT_NAME`, `OS_APP_NAME`, or the host options). So an unsaved page showed a name nothing used. An unsaved page now shows the field empty, and `GET /api/settings/branding` answers `workspace_name` as `value: null`, `source: 'default'`.
- **Not required.** A key with no default stays optional, as `accent_color` already is, so the console can save the page without one. This widens the write: an empty `workspace_name` is accepted (it was refused as required) and means "use the deployment's name", which is how both readers already treat an empty value. Nothing served changes.
- **`localization.timezone`.** Its help adds that it is the timezone in effect for the organization, and that the Timezone field on the Organization record does not change it (in all four bundles).
