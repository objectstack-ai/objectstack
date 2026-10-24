---
'@objectstack/service-settings': minor
---

fix(service-settings)!: the Branding settings drive the console's name, logo and colour on a single-organization deployment, retire `theme_mode` and `support_email`, and are not offered under a walled tenancy posture

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) The two retired keys were settings values, not metadata: only the platform-shipped brandingSettingsManifest declared them (only platform code declares a settings manifest), SettingsManifestSchema and every other spec declaration are unchanged, and a value stored for one of them lives in sys_setting (runtime state, ADR-0007), not sys_metadata, and is kept as it is. Nothing read either key in objectstack or in objectui at the console pin, so no consumer has anything to rewrite and objectstack migrate meta has nothing to reach. Withholding the branding namespace under a walled posture moves no stored row either. The one operator-facing consequence there, that OS_BRANDING_WORKSPACE_NAME stops naming sign-in mail and the OS_APP_NAME variable takes its place, is a deployment environment setting: no consumer code and no metadata is rewritten, so the ledger has nothing to carry and objectstack migrate meta nothing to reach. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a settings key (not already-registered); and the change is the value of an exported manifest constant and the plugin's registration behaviour, not an interface or a type alone (not runtime-interface-only or type-surface-only). -->

Setup → Branding saved values that nothing in the console ever read. Under the maintainer's ruling, its three keys now drive the console's own branding through the runtime config (`@objectstack/cloud-connection`, same release), the two keys with no counterpart retire, and the page is offered only where no organization wall stands.

**What the three keys do now** (a single-organization deployment, the `single` posture):

- `workspace_name` is the product name in the console, on the sign-in page and in the browser title, and it stays the product name in sign-in emails, the authenticator app and MCP sign-in.
- `logo_url` is the logo on the sign-in page, the loading screen and the home header.
- `accent_color` is the browser and installed-app theme colour. Each app keeps the colours its own `AppBranding` declares.
- A key nobody set falls back to the deployment's own branding (`OS_PRODUCT_NAME`, `OS_LOGO_URL`, `OS_BRAND_COLOR`, or the host's `RuntimeConfigPlugin` options). A value pinned with the settings layer's `OS_BRANDING_WORKSPACE_NAME`, `OS_BRANDING_LOGO_URL` or `OS_BRANDING_ACCENT_COLOR` counts as set. A save shows on the next page load, with no restart. `accent_color` no longer declares the `#6366f1` default, which the page showed as a colour the console never used.

**BREAKING: `theme_mode` and `support_email` are retired.** The Branding manifest (`brandingSettingsManifest`) drops both specifiers and their copy in the `en`, `zh-CN`, `ja-JP` and `es-ES` settings bundles, and its `version` is now 2, as the `SettingsManifest.version` contract asks when keys are removed. Nothing ever read either key. A value a workspace already stored is kept:

- The `sys_setting` row stays exactly as it was. No read or save rewrites or deletes it, and it never blocks saving the live keys.
- `GET /api/settings/branding` does not resolve it: the key is absent from both `manifest.specifiers` and `values`.
- A `PUT /api/settings/branding` that names `theme_mode` or `support_email` is refused with `400 UNKNOWN_KEY` (`details.key` names it). The refusal covers the whole batch, so a live key sent beside it does not land either.
- `OS_BRANDING_THEME_MODE` and `OS_BRANDING_SUPPORT_EMAIL` are no longer read on any deployment.

**BREAKING: under the `group` and `isolated` postures the Branding namespace is not offered.** It is absent from `GET /api/settings`, `GET` or `PUT /api/settings/branding` is refused with `404 UNKNOWN_NAMESPACE`, the answer every unknown namespace gets, and Setup lists no Branding entry: `SettingsServicePlugin` now contributes the `nav_settings_branding` Setup entry itself, with the namespace, so the entry exists exactly where the page does. The runtime config is an anonymous door that resolves no organization before sign-in, so on a walled deployment the branding is the operator's: the console's through `OS_PRODUCT_NAME`, `OS_LOGO_URL` and `OS_BRAND_COLOR`, and the auth product name through `OS_APP_NAME`.

**On a walled deployment the `OS_BRANDING_*` variables are no longer read.** With the namespace withheld, none of `OS_BRANDING_WORKSPACE_NAME`, `OS_BRANDING_LOGO_URL` and `OS_BRANDING_ACCENT_COLOR` reaches a reader there. One of them had an effect before this release: `OS_BRANDING_WORKSPACE_NAME` named sign-in emails, the authenticator issuer and the MCP sign-in (`@objectstack/plugin-auth` applied it as an `env` value whatever the posture). So did a `branding.workspace_name` row stored with no organization. Both now give way to the `OS_APP_NAME` chain. The fix is in the deployment's environment, not in any code or metadata: a walled deployment that set `OS_BRANDING_WORKSPACE_NAME=Acme` sets `OS_APP_NAME=Acme` instead. The other two variables had no reader before and have none on a walled deployment now. A value already stored is kept and is offered again if the deployment returns to `single`. A host that passes its own `branding` manifest through `SettingsServicePlugin({ manifests })` gets the same rule.

**What to do after upgrading.**

- On a single-organization deployment nothing has to be rewritten.
- There is no replacement for `theme_mode` (the console follows the user's own theme choice) or for `support_email`.
- On a walled deployment, set the console's branding with `OS_PRODUCT_NAME`, `OS_LOGO_URL` and `OS_BRAND_COLOR`. If you set `OS_BRANDING_WORKSPACE_NAME` there, move its value to `OS_APP_NAME`.

It ships as `minor` under the launch-window convention for narrowings.
