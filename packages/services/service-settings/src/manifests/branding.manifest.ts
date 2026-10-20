// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * Branding — the name, logo and brand colour a single-organization deployment
 * shows (#24766, the maintainer's ruling B′ and its amendment).
 *
 * ## Who reads each key
 *
 * The console learns its brand from `GET /api/v1/runtime/config`
 * (`RuntimeConfigPlugin`, `@objectstack/cloud-connection`), which reads this
 * namespace on every request, so a save shows on the next page load:
 *
 *  - `workspace_name` → `branding.productName`: the product name in the
 *    console chrome, on the sign-in page and in the browser title. It also
 *    keeps its earlier reader, `plugin-auth`, which uses it as the product name
 *    in sign-in emails, the authenticator app entry and the MCP sign-in.
 *  - `logo_url` → `branding.logoUrl`: the sign-in page, the loading screen and
 *    the home header.
 *  - `accent_color` → `branding.brandColor`: the browser and installed-app
 *    (PWA) theme colour. It is not an app's colour: each app keeps the colours
 *    its own `AppBranding` declares, and no precedence between the two exists.
 *
 * A value nobody saved (`source: 'default'`) is not served: the deployment's
 * own branding applies (`OS_PRODUCT_NAME`, `OS_LOGO_URL`, `OS_BRAND_COLOR`, or
 * the host's `RuntimeConfigPlugin` options). That is why `accent_color`
 * declares no `default`: a default here would be shown on the settings page as
 * a colour the console never uses. `workspace_name` keeps its `'ObjectStack'`
 * default, which is also the name the auth emails fall back to.
 *
 * ## Single posture only
 *
 * Under a walled tenancy posture (`group` / `isolated`) the settings service
 * does not offer this namespace at all — it is absent from the settings
 * listing and a write to it is refused `404 UNKNOWN_NAMESPACE`
 * (`settings-service-plugin.ts`). The runtime-config door is anonymous and
 * resolves no organization before sign-in, so there the deployment's branding
 * is the operator's, through the `OS_*` variables above.
 *
 * ## Version 2
 *
 * `theme_mode` and `support_email` were offered here until #24766 and nothing
 * ever read them; the runtime config has no counterpart for either, so they
 * were retired rather than implemented. Removing them is why `version` is 2:
 * the spec's `SettingsManifest.version` contract is "increment when keys are
 * renamed/removed". A `sys_setting` row stored for one of them is kept, never
 * deleted: the service no longer resolves it, and a write naming the key is
 * refused `400 UNKNOWN_KEY`, the answer every undeclared key gets.
 */
export const brandingSettingsManifest: SettingsManifest = {
  namespace: 'branding',
  version: 2,
  label: 'Branding',
  icon: 'Palette',
  description:
    'The name, logo and colour the console and the sign-in page show. ' +
    'A value left unset falls back to the deployment\'s own branding.',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  category: 'Workspace',
  order: 5,
  specifiers: [
    { type: 'group', id: 'identity', label: 'Identity', required: false },
    { type: 'text', key: 'workspace_name', label: 'Organization name', required: true,
      default: 'ObjectStack', minLength: 1, maxLength: 60,
      description:
        'The product name in the console, on the sign-in page and in the browser title, ' +
        'and in sign-in emails, the authenticator app and MCP sign-in.' },

    { type: 'group', id: 'appearance', label: 'Appearance', required: false },
    { type: 'color', key: 'accent_color', label: 'Accent colour', required: false,
      description: 'The browser and installed-app theme colour. Each app keeps its own colours.' },
    { type: 'url', key: 'logo_url', label: 'Logo URL', required: false,
      description: 'Shown on the sign-in page, the loading screen and the home header. Example: https://…/logo.svg' },
  ],
};
