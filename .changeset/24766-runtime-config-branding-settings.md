---
'@objectstack/cloud-connection': minor
---

feat(cloud-connection): `GET /api/v1/runtime/config` serves the Branding settings' name, logo and colour, falling back to `OS_PRODUCT_NAME`, `OS_LOGO_URL` and `OS_BRAND_COLOR`

Clause-②: no (the served `branding` block keeps its shape and no exported type changes; only where its values come from moves)

`RuntimeConfigPlugin` reads the `branding` settings namespace on every request, so Setup → Branding changes the console and the sign-in page on their next load:

- `branding.productName` ← `branding.workspace_name`
- `branding.logoUrl` ← `branding.logo_url`
- `branding.brandColor` ← `branding.accent_color`

A value somebody set wins (saved in Setup, or pinned by the settings layer's own `OS_BRANDING_*` variable). A key nobody set falls back exactly as before: the host's constructor option, then `OS_PRODUCT_NAME` / `OS_LOGO_URL` / `OS_BRAND_COLOR`, then the built-in default. `productShortName`, `pwaDescription` and `pwaThemeColor` follow the name and colour actually served, unless configured themselves. `brandColor` keeps its meaning: the console's browser and installed-app theme colour, beside each app's own `AppBranding` colours.

The door reads the settings only when the settings service lists the `branding` namespace. `@objectstack/service-settings` withholds it under the `group` and `isolated` tenancy postures, so on a walled deployment no tenant data reaches this anonymous door and the deployment's `OS_*` branding is served, as before. A settings read that fails serves the deployment's branding and logs one warning; the door never answers 500 for it.
