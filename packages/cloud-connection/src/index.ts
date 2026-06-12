// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/cloud-connection — the runtime-side client for an ObjectStack
 * cloud control plane (ADR-0008).
 *
 * Connects any ObjectStack runtime — vanilla `objectstack dev`, a self-hosted
 * single-environment deployment, or a multi-tenant fleet — to a control plane
 * for package distribution. Capability progresses with binding:
 *
 *   Unbound (anonymous)
 *     - public marketplace browse proxy   (MarketplaceProxyPlugin → /api/v1/marketplace/*)
 *     - install-local: install public packages into THIS runtime's kernel
 *       (MarketplaceInstallLocalPlugin → /api/v1/marketplace/install-local)
 *   Bound (device-code → sys_cloud_connection)
 *     - status / bind/start / bind/poll, org catalog ("Your organization"),
 *       installed views, control-plane installs
 *       (CloudConnectionPlugin → /api/v1/cloud-connection/*)
 *   SPA discovery
 *     - RuntimeConfigPlugin → /api/v1/runtime/config feature flags
 *
 * The mechanism is open; the *policy* (which plan unlocks what, entitlement
 * for paid packages, org catalog filtering) lives server-side in the control
 * plane and — for plan-derived flags — in the host via
 * `RuntimeConfigPluginConfig.resolvePlanFeatures`. `OS_CLOUD_URL=off`
 * disables every remote call (air-gapped installs keep working via inline
 * manifests).
 */

export { DEFAULT_CLOUD_URL, resolveCloudUrl } from './cloud-url.js';
export {
    resolveMarketplacePublicBaseUrl,
    publicMarketplaceKeyForApiPath,
} from './marketplace-public-url.js';
export { MarketplaceProxyPlugin } from './marketplace-proxy-plugin.js';
export type { MarketplaceProxyPluginConfig } from './marketplace-proxy-plugin.js';
export { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
export type { MarketplaceInstallLocalPluginConfig } from './marketplace-install-local-plugin.js';
// ADR-0007 step ⑤ — the local desired-state ledger, exported as a first-class
// seam so hosts/reconcilers can read the same ledger without going through HTTP.
export { LocalManifestSource, DEFAULT_INSTALLED_PACKAGES_DIR } from './local-manifest-source.js';
export type { InstalledManifestEntry } from './local-manifest-source.js';
export { CloudConnectionPlugin, createCloudConnectionPlugin } from './cloud-connection-plugin.js';
export type { CloudConnectionPluginConfig } from './cloud-connection-plugin.js';
export { RuntimeConfigPlugin } from './runtime-config-plugin.js';
export type { RuntimeConfigPluginConfig, RuntimeConfigPlanFeatures } from './runtime-config-plugin.js';
// ADR-0008 consumption side — the self-hosted credential ledger (bind
// persists the oscc_ bearer here; forwards present it to the control plane).
export { ConnectionCredentialStore, DEFAULT_CONNECTION_CREDENTIAL_PATH } from './connection-credential-store.js';
export type { StoredConnectionCredential } from './connection-credential-store.js';
export { CloudConnectionSettingsPage, CLOUD_CONNECTION_UI_BUNDLE } from './cloud-connection-ui.js';
export { MARKETPLACE_BROWSE_UI_BUNDLE, MARKETPLACE_INSTALLED_UI_BUNDLE } from './marketplace-ui.js';
