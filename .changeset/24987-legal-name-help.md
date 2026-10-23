---
'@objectstack/service-settings': patch
---

fix(service-settings): Setup → Company → Legal name help no longer points to an organization name under Branding

Clause-②: no

Metadata-protocol: none

The `legal_name` help in the Company settings page (the manifest description and the `en`, `zh-CN`, `ja-JP` and `es-ES` bundles) said the legal name "may differ from the organization name set under Branding". Branding's workspace name is the product name, not an organization name, and the Branding page is not offered at all under the `group` and `isolated` postures, where Company is. The help now reads "Registered legal name of the organization, as it appears on contracts and invoices." in every locale. Copy only; no key, value or behaviour changes.
