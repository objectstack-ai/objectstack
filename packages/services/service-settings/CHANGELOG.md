# @objectstack/service-settings

## 18.1.0

### Minor Changes

- 3937697: fix(service-settings)!: the Branding settings drive the console's name, logo and colour on a single-organization deployment, retire `theme_mode` and `support_email`, and are not offered under a walled tenancy posture
  
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
- 3937697: fix(service-settings)!: a settings value that misses the format its `email`, `url`, `phone` or `color` type declares is refused, both when it is saved and when it arrives as an `OS_*` override (#24882)
  
  ADR-0007 declares a format for four specifier types: `email`, `url` and `phone` take "format validation", and `color` takes a hex string. Until now nothing enforced it. `PUT /api/settings/branding` stored a Logo URL of `not a url` and answered `200`, and an `OS_*` override was served whatever it held. Both doors now judge the format through one shared check, after every other declared constraint, and refuse a value that misses it.
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is which runtime values two settings doors accept: a value saved through `PUT /api/settings/:namespace` or `setMany`, and a deployment's `OS_*` environment override. Settings values are runtime state in `sys_setting` (ADR-0007) and environment values belong to the deployment, and no metadata conversion reaches either; a row already stored is not rewritten and is still served. The remedy is to supply a well-formed value, never a rewrite of a metadata source. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
  
  **BREAKING** (the settings doors' accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.
  
  The formats are the platform's existing grammars for the same words:
  
  - `email`: an address with a dotted domain, the grammar the mail transport sends with. `no-reply@localhost` misses it.
  - `url`: `scheme://…`, a root-relative `/path`, a `data:` URI or a `blob:` URL. A relative logo path that the branding reader serves is accepted.
  - `phone`: digits, spaces and `+ ( ) - .`, at least five characters.
  - `color`: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
  
  Empty values and non-string values are not judged. Surrounding whitespace is ignored, because the readers trim it before use.
  
  What changes:
  
  - **Saving, FROM:** a save naming a value that misses its key's format answered `200` and stored the value as written.
  - **Saving, TO:** the save answers `400` with `error.code: 'SETTINGS_VALIDATION'` and one entry per such key in `error.details.fields`, carrying `code` `invalid_email`, `invalid_url`, `invalid_phone` or `invalid_format` (for `color`), and `constraint.type`. Nothing in the save is stored. The answer names the expected format and never echoes the value.
  - **Environment override, FROM:** a malformed `OS_*` override was in force: reads served it with source `env`, and it locked the key against saves.
  - **Environment override, TO:** a malformed `OS_*` override is no longer in force. The server logs one `error` line per variable and value, naming the variable, the setting, the type and the expected format, never the value. Reads serve the next layer instead: the stored value when one exists, otherwise the manifest default, with that layer as the source. The key is no longer locked, so it can be saved through Setup.
  - **Unchanged:** a well-formed value saves, and a well-formed override is in force and locks the key. A value that breaks another declared constraint (a length bound, a pattern) is still refused for that constraint. A value stored before this release is still served by every read, and it does not block a save of the namespace's other keys; only a save that writes that key, or a key its `visible` condition reads, judges it. An all-null save (reset) still clears it.
  - **What to do:** fix the value. For an `OS_*` override, set the variable to a well-formed value or unset it and configure the setting in Setup. For a stored value, save a well-formed value for the key, or clear it.

### Patch Changes

- 3937697: fix(service-settings): Setup → Authentication saves "Enable Google login" ON when the Google credentials come from the server (#24844)
  
  Clause-②: no
  
  On a deployment that sets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and leaves the two credential fields empty, saving `auth.google_enabled: true` was refused with `SETTINGS_VALIDATION` (`google_client_id` / `google_client_secret`: `required`). An admin who switched Google off on the page could not switch it back on there, although the server held valid credentials. The settings service reads only `OS_*` names, so it cannot see that pair.
  
  `auth.google_client_id` and `auth.google_client_secret` are no longer `required`. Google sign-in needs the two credentials to resolve, saved on the page or set on the server; it never needed them stored. The `google_enabled` help already says so: Google is offered once both resolve, and the server's pair wins over saved values.
  
  Who may sign in, and which providers the login page offers, do not change for any deployment. Saving the toggle ON while neither pair resolves is now accepted; the login page then shows no Google button, as it does with the toggle left at its default.
- 3937697: fix(service-settings): Setup → Company → Legal name help no longer points to an organization name under Branding
  
  Clause-②: no
  
  Metadata-protocol: none
  
  The `legal_name` help in the Company settings page (the manifest description and the `en`, `zh-CN`, `ja-JP` and `es-ES` bundles) said the legal name "may differ from the organization name set under Branding". Branding's workspace name is the product name, not an organization name, and the Branding page is not offered at all under the `group` and `isolated` postures, where Company is. The help now reads "Registered legal name of the organization, as it appears on contracts and invoices." in every locale. Copy only; no key, value or behaviour changes.
- 3937697: fix(service-settings)!: a tenant- or user-scope setting stored with no organization no longer answers every organization's read, and a caller with no organization reads and writes as the one organization the deployment derives
  
  Clause-②: yes (narrowing)
  Metadata-protocol: none
  
  <!-- adr-0087: not-required (no-migration-prescription) Which stored `sys_setting` row answers a settings read changes. No key of any metadata schema is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite and no tombstone is needed. No export, type, error code or route is removed or renamed: `bindEngine` gains one optional input, and the plugin supplies it. The remedy for the rows this stops reading is the existing organization-ownership ceremony, stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this read (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
  
  **BREAKING** read narrowing (ADR-0131 D1 "nothing reads a NULL tenant value as an owner", and D8 "no layer has a NULL arm"). It changes which stored row a settings read takes, not what a metadata author can write, so it ships as `patch` with this banner.
  
  - FROM: a `tenant`- or `user`-scope `sys_setting` row written with no organization was every organization's fallback. A caller that named an organization read its own row, or failing that the organization-less one. A caller that named none read only organization-less rows behind a wall (`group` / `isolated`). Under `single` it read every row, an organization's first. Under `single` such a caller also wrote with no organization, so its write's identity probe missed the row the engine stamped with the Default Organization. The second save of a key then inserted a second row beside the first. On a SQL store the identity index refuses that insert and the save fails. On a store with no such index the save was lost: every reader kept answering the first value.
  - TO: a caller reads its organization's rows and no others. For a caller that names no organization, the deployment names one (ADR-0131 D9, the predicate the engine applies to a system write):
    - Under `single` with one organization, the caller reads and writes as that organization. This covers the process-wide readers: plugin-auth's email brand name and auth locale, and the anonymous `runtime/config` branding read.
    - Behind a wall, or under `single` with no organization or several, the caller has no tenant or user rung. Its read answers from the global rung or the default, and its tenant-scope write is refused (`SETTINGS_VALIDATION`, `constraint: { scope: 'tenant' }`).
    - A composition that registers no organization object (a lean embedding, kept by ruling) still stores and reads its rows with no organization.
  
  **Who is affected.** Only a store holding a tenant- or user-scope `sys_setting` row with a NULL `organization_id`. A fresh install holds none, nor does an 18.0.0-born store written through `os serve`: the measured 18.0.0 fixture holds two `sys_setting` rows, both owned. A v17 store holds none after `os migrate organization-ownership` under `single`, which gives such rows to the Default Organization. Under a walled posture the ceremony leaves such a row NULL and reports it, and from this release that row stops answering any organization.
  
  **The remedy.** Run `os migrate organization-ownership --out PLAN`, review the reported `sys_setting` rows, and save each value again from inside the organization it belongs to (Setup → the settings page, or `PUT /api/settings/:namespace` with that organization active). A value meant for every organization belongs on a key declared at scope `global`.
- 3937697: fix(service-settings)!: a host that binds its own engine and states no organization source reads and writes as the organization ADR-0131 D9 derives through that engine, not as no organization
  
  Clause-②: no (narrowing)
  Metadata-protocol: none
  
  <!-- adr-0087: not-required (no-migration-prescription) Which organization a self-binding host's settings reads and writes take changes. No key of any metadata schema is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite and no tombstone is needed. No export, type, option, error code or route is added, removed or renamed: `SettingsServiceOptions` and the `bindEngine` extras are unchanged, and `SettingsServicePlugin` already states its source. The remedy for a host this narrows is one line at its bind site, stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this read (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
  
  **BREAKING** read narrowing (ADR-0131 D8/D9, follow-up to the organization-less rung fix). It changes which organization a host's settings reads take, not what a metadata author can write, so it ships as `patch` with this banner.
  
  - FROM: a host that bound its own engine (`new SettingsService({ engine })` or `bindEngine(engine)`) and stated no `organization` source read and wrote, for a caller that names no organization, as a composition with no organization object: its rows with no organization answered, and its writes stored none.
  - TO: such a host's service asks D9 itself, through the engine it holds (`resolveGuestOrganization`, the call the plugin's source makes). Under `single` with one organization it reads and writes as that organization; at none or several it has no tenant or user rung. An engine that exposes no `registry` cannot say the organization object is absent, so D9 asks `sys_organization`. Over a store with no such object, a tenant-rung read or write by a caller naming none is then refused as organization-less (reads answer from the global rung or the default, tenant writes are refused with `SETTINGS_VALIDATION`), or raises `AuthzStoreUnavailableError` naming `sys_organization` where the engine does not know that object. No engine at all (the in-memory store), a stated source, an engine whose `registry.getObject` answers, and `SettingsServicePlugin` (`os serve`, `os dev`) are unchanged.
  
  **Who is affected.** Only a host that binds its own engine and states no source: a control-plane mock or an embedded runtime. On a composition with an organization object it now reads and writes the derived organization's rows, and its rows with no organization stop answering. On one without, it meets the refusal above. A deployment booted through `SettingsServicePlugin` is not affected.
  
  **The fix.** State the composition at the bind site: `service.bindEngine(engine, audit, { organization: async () => ({ kind: 'no-organization-object' }) })` (a host that hands its engine to the constructor binds it this way instead), or hand over an engine whose `registry.getObject` can answer.
- 3937697: refactor(core, plugin-auth, plugin-security, service-settings): one definition each for the `admin_full_access` anchor rule and the organization-reach rule, exported from core security
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  Two security rules were each spelled more than once. A change to one copy could leave the other behind. Each now has one definition in `@objectstack/core`'s security module, and every reader calls it. No behaviour change: every reader answers exactly as before.
  
  - **The anchor rule (ADR-0131 D5).** New export: `organizationAnchorsPlatformStanding(grantOrganizationId, { walled, defaultOrganizationId })`, with the type `PlatformStandingAnchorFacts`. It decides which `admin_full_access` grant anchors platform-admin standing:
    - behind a wall, no grant does;
    - under `single`, the grant owned by the Default Organization does;
    - an organization-less grant never does, and neither does any grant when no Default Organization can be named.
  
    Three readers call it:
    - the authorization resolver passes the memoised Default Organization;
    - the last-administrator guard in `@objectstack/plugin-auth` passes the Default Organization as the pending write would leave it;
    - the first-user promotion's holder scan in `@objectstack/plugin-security` passes the Default Organization it promotes into, and keeps its own system-user exclusion.
  
    Each reader keeps its own normalizer for a grant row's organization.
  - **The organization-reach rule (ADR-0131 D8/D9).** New exports:
    - `resolveOrganizationReach({ callerOrganizationId, wallStands, deriveOrganization })`;
    - `organizationReachAdmits(reach, rowOrganizationId)`;
    - `organizationReachRowOwner(reach)`;
    - `organizationIdOf(value)`;
    - `UNOWNED_ORGANIZATION_REACH`;
    - the types `OrganizationReach` and `OrganizationReachFacts`.
  
    The rule decides whose `sys_setting` rows a caller may draw on:
    - the caller's own organization;
    - for a caller naming none where no wall stands, the organization D9 derives;
    - nothing behind a wall;
    - rows with no organization, only in a composition that registers no organization object.
  
    `SettingsService` and the resolver's direct localization fallback both call it. Each still supplies its own facts:
    - the service: the posture in force (the `tenancy` service), with a failed read propagated to its caller;
    - the fallback: the requested posture (`OS_TENANCY_POSTURE`), with a failed read degraded to the built-in defaults.
  
    These two differences are kept by design: they make the fallback, which runs only when the service has failed, the stricter reader.
  
  No configuration, metadata or HTTP behaviour changes. Code that does not import the new exports needs no action.
- 3937697: feat: Setup → Email states which mail transport is live, and says so when no mail leaves this machine
  
  Clause-②: yes (widening: service-settings exports SettingsService.registerLiveStatus / liveStatusOf, SettingsLiveStatus, SettingsLiveStatusProvider and SETTINGS_LIVE_STATUS_BANNER_ID; nothing is refused)
  Metadata-protocol: none
  
  The Email page showed what is stored, not what is in use. Out of the box the `mail` namespace stores provider `smtp` with an empty host, so the form read as SMTP while every message went to the development log and was recorded in `sys_email` as sent.
  
  - **`@objectstack/service-settings`:** `SettingsService.registerLiveStatus(namespace, provider)` lets the package that owns a live object state it on that namespace's page. `GET /api/settings/:namespace` asks the provider on every read and puts its answer first in the manifest's specifiers, as an `info_banner` with the reserved id `live_status` (`SETTINGS_LIVE_STATUS_BANNER_ID`). The registered manifest and in-process `getNamespace()` are unchanged. If the provider throws, the page says the live status could not be read; the statement is never silently dropped. New exports: `SettingsLiveStatus`, `SettingsLiveStatusProvider`, `SETTINGS_LIVE_STATUS_BANNER_ID`.
  - **`@objectstack/plugin-email`:** registers the `mail` statement from `EmailService.isConfigured()`. When it answers `false` (the log transport), the banner reads "No mail leaves this machine". When it answers `true`, the banner names the live transport, for example "Mail is delivered through SMTP (smtp.example.com:587)". The statement waits for any settings re-apply still running, so a read made just after a save names the transport that save built.
- 3937697: fix(service-settings): Settings → Branding's name is labelled the product name, shows no default the console never uses, and Localization's timezone says it is the one in effect
  
  Clause-②: yes
  Metadata-protocol: none
  
  One organization showed three names: Branding's "Organization name" read `ObjectStack`, the organization record read `Default Organization`, and the console read `ObjectOS`. Branding's key names the PRODUCT the deployment shows, and the organization's own name lives on its record, so each now says which one it is.
  
  - **`branding.workspace_name`.** The label is "Product name" (in all four bundles), not "Organization name". Its help says an empty value uses the name the deployment was set up with, and that the organization's own name is the Name on the Organization record.
  - **No default.** The `'ObjectStack'` default is gone. Neither reader ever served it: the runtime config and the auth readers use only a value somebody saved, and otherwise the deployment's own name (`OS_PRODUCT_NAME`, `OS_APP_NAME`, or the host options). So an unsaved page showed a name nothing used. An unsaved page now shows the field empty, and `GET /api/settings/branding` answers `workspace_name` as `value: null`, `source: 'default'`.
  - **Not required.** A key with no default stays optional, as `accent_color` already is, so the console can save the page without one. This widens the write: an empty `workspace_name` is accepted (it was refused as required) and means "use the deployment's name", which is how both readers already treat an empty value. Nothing served changes.
  - **`localization.timezone`.** Its help adds that it is the timezone in effect for the organization, and that the Timezone field on the Organization record does not change it (in all four bundles).
- 3937697: fix: Setup → AI's "Reset to environment defaults" button is now translated in zh-CN, ja-JP and es-ES
  
  Clause-②: no
  Metadata-protocol: none
  
  The `ai` settings manifest declares an `action_button` with id `reset`, but no locale bundle carried `settings.ai.actions.reset.label`, so the button rendered in English beside its translated siblings. The bundles now carry it (en, zh-CN, ja-JP, es-ES).
  
  The settings translation coverage test now reads every manifest's `action_button` labels: each shipped non-English locale must carry `settings.<namespace>.actions.<id>.label` for every action button, and no bundle may carry action copy for a button no manifest declares.
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [4395cbc]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [3937697]
- Updated dependencies [9f39094]
- Updated dependencies [3937697]
  - @objectstack/spec@18.1.0
  - @objectstack/core@18.1.0
  - @objectstack/platform-objects@18.1.0
  - @objectstack/types@18.1.0

## 18.0.0

### Minor Changes

- b12e16a: feat(service-settings)!: the settings audit trail's global rung moves to the new deployment-level `sys_platform_setting_audit`
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone: sys_setting_audit.scope keeps its global option because 18.0 rows hold it. What narrows is where a NEW global-rung audit row is stored and who may read it; the remedy is a run-time one, stated below. -->
  
  **BREAKING** for a reader of the settings audit trail, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D7; ruling record 6257510973, Q4 A). This is the expand half of the change: it adds the new write shape, and the 18.0 rows stay where they are and readable. No row an 18.0 install wrote is moved, deleted or re-stamped.
  
  - **Before.** A write of a global-scope settings key appended its history row to `sys_setting_audit`, stamped with the Default Organization under `single`. Any principal the settings read door let read the namespace could list it there.
  - **Now.** That row goes to the new `sys_platform_setting_audit`. It has the same row shape, `scope` is always `global`, and there is no organization column (`systemFields: { tenant: false }`). Reading it through the generic data API requires the `manage_platform_settings` capability, as `sys_platform_setting` does, and each namespace's `readPermission` applies there too. Tenant and user rows stay in `sys_setting_audit`, stamped as before.
  - **18.0 rows.** Global-rung rows an 18.0 install wrote stay in `sys_setting_audit`, stamped, until the upgrade ceremony moves them. The global rung's history is both tables: the sibling, plus `sys_setting_audit` rows at `scope = global`.
  
  **The remedy.** If you list or filter the global rung's settings history (`sys_setting_audit` with `scope = global`), read `sys_platform_setting_audit` as well, with a principal that holds `manage_platform_settings`. Select the 18.0 rows by `scope`, never by a missing organization: they carry the Default Organization. Nothing changes for a reader of tenant or user rows.
- 12d1476: feat(cli,runtime)!: `os migrate organization-ownership` upgrades a database 17.x or an 18.0 pre-release created; a server serves only a database it created or one the ceremony certified
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The data migration this change prescribes is the operator's ceremony, `os migrate organization-ownership`, stated below; the boot refusal names it. Two `@objectstack/objectql` exports are removed, `WALLED_ORGANIZATION_LESS_BRIDGE` and `isWalledOrganizationLessBridgeObject`: they named the two tables whose organization-less inserts were let through under a wall while those tables still carried an organization column, and both tables now declare none. Neither is a metadata key and no stored row or stack names them, so a caller has nothing to migrate: drop the import, since a deployment-level table is recognised by `systemFields: { tenant: false }`. -->
  
  **BREAKING** for a database with no birth marker — one 17.x or an 18.0 pre-release (`18.0.0-next.*`) created — shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D10).
  
  - **The ceremony is open.** `os migrate organization-ownership` runs again (the 18.0 pre-releases refused it with `NOT_IMPLEMENTED`): a bare run writes the plan, and `--apply --plan-file PLAN --backup-taken` applies that reviewed plan. Its new steps carry what an 18.0 pre-release database still owes, each selected by the rows' shape, never by a NULL organization:
    - `sibling-moves`: the global settings-audit rows move to `sys_platform_setting_audit`, and identity mail (reset, verification, account invitation, change-email notice, magic link) to `sys_identity_email`, id for id. Their queued mail jobs and their activity rows follow them. The organization invitation stays in `sys_email`.
    - `declared-webhooks`: each `sys_webhook` copy a package's seeder wrote under a name a package still declares is settled. A pristine copy is deleted once its deliveries name the declaration (`declared:NAME`), with the cipher it referenced. A copy customized only in its switch becomes the declaration's activation row. Any other edit becomes the administrator's own webhook under a new name (`NAME_custom`), and the declaration is switched off.
    - `declared-rule-copies`: each stored sharing rule under a declared rule's name becomes a clone under a new name, its grants kept, and the declaration is switched off.
    - `not-null`: after the column drops, every table the post-step plan clears takes `organization_id` NOT NULL. The ceremony owns that nullability, so the schema differ no longer reports it as `relax_not_null` drift.
  - **The boot guard decides on a marker.** The first boot that creates a datastore from empty writes a birth marker (`sys_migration` row `adr-0131-organization-ownership`, `details.birth.shapeGeneration`). Every CLI data boot writes it too, so a fresh install whose first command is `os migrate apply` or `os seed` still boots. On the Turso remote face (`libsql://`), `getSchemaSyncStats` now answers what its schema doors created and found (it answered `{ created: 0, existing: 0 }` before), so a fresh remote database is observed as one and gets its marker. The ceremony's verified marker carries the same `shapeGeneration` (now `1`, `ORGANIZATION_OWNERSHIP_SHAPE_GENERATION` in `@objectstack/spec/system`). A server refuses a database with no marker (one 17.x or an 18.0 pre-release created), one certified at an older generation, or an uncertified one. The refusal names the command and no longer says to stay on 17.x. The v17-shape probe also reads `tenancy: { enabled: false }` and `systemFields: false`.
  - **`sys_secret` and `sys_flow_credential` are deployment-level** (`systemFields: { tenant: false }`). Their `organization_id` is dropped by the ceremony's column-drops step. The settings service no longer writes one, and `SettingsSecretStore.insert` no longer takes it. With no organization column, their organization-less system inserts land under a walled posture on the engine's own rule, so `@objectstack/objectql` no longer exports `WALLED_ORGANIZATION_LESS_BRIDGE` or `isWalledOrganizationLessBridgeObject`, and the system-write refusal's remedy names `systemFields: { tenant: false }`.
  
  **What an operator does.** Fresh installs are supported under every tenancy posture and need nothing. Before serving a database 17.x or an 18.0 pre-release created with this release: start this release against it once (the boot is refused, and its schema sync has already created the tables this release adds, which the ceremony moves rows into), take a backup, run `os migrate organization-ownership --out plan.json`, review the plan, then run `os migrate organization-ownership --apply --plan-file plan.json --backup-taken`, and start the server. `os dev` does this for a local SQLite development database. On a walled database, a customized copy of a declared webhook or sharing rule blocks its step, naming the row: rename it to a name no package declares, or delete it, then re-run.
- 6729e10: feat(plugin-audit,plugin-security)!: the compliance ledger `sys_audit_log` loses its injected organization column; the organization a row is about stays in `tenant_id`, and an organization reader is scoped on it by a platform row policy (ADR-0131 D7)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered sys-audit-log-organization-column-retired -->
  
  **BREAKING**, shipped as `minor` under the repo's convention for breaking changes on this line.
  
  Some ledger rows are about deployment-level actions no organization owns: a change of platform-administrator standing at boot, a change to a global setting, plugin-auth's administrative user writes. An injected organization column made the tenant wall the ledger's anchor, so under a walled posture those rows were hidden from every reader, platform administrators included. ADR-0131 D7 takes the column off: the ledger is governed by object permission, and the organization a row is about is the plain attribution field `tenant_id`, which the tenant-field resolver does not claim.
  
  - **`sys_audit_log`** (`@objectstack/plugin-audit`) declares `systemFields: { tenant: false }`, so the registry injects no `organization_id` and a new table is provisioned without it. `tenant_id` (a lookup to `sys_organization`) is unchanged and is the only organization column. The record mirror, the record-view writer and the sign-in writer stamp it as before and no longer stamp `organization_id`. A write that still names `organization_id` on the ledger is refused `INVALID_FIELD`, and a filter on it `INVALID_FILTER`.
  - **The read scope** (`@objectstack/plugin-security`, the shipped permission sets): a platform row policy, `sys_audit_log_org` (`tenant_id == current_user.organization_id`), in `organization_admin` (and its no-bypass variant), `member_default` and `viewer_readonly`. `organization_admin` also names `sys_audit_log` explicitly, read only and without `viewAllRecords` / `modifyAllRecords`: its wildcard's superuser bypass would otherwise skip the policy on an object with no tenant column. Under an organization wall an organization administrator or viewer reads the rows about its active organization; a platform administrator (`admin_full_access`) reads every row, the rows about no organization included. Under `single` the policy is stripped by provenance (ADR-0105 D3), as every platform tenant policy is.
  - **`config_change` rows** (`@objectstack/service-settings`): a GLOBAL-scope settings change is about no organization, so its ledger row carries no `tenant_id`, whatever organization the writing session had active. Tenant- and user-scope changes keep the writer's organization. The settings writer and plugin-security's platform-admin standing writer no longer probe for or stamp `organization_id`.
  - **Retention** (`@objectstack/objectql`): a tenant-scope `lifecycle.retention_overrides` window on `sys_audit_log` partitions the reaper's and the archiver's passes on `tenant_id`, and the global pass keeps the rows with no `tenant_id`.
  - **`view_all_audit_log`**: its description (`@objectstack/spec/security`) now names the row scope it does not lift; the capability still lifts only the parent-record read gate.
  
  **What moves for consumers.**
  
  - **Authored references.** A filter, list-view column, report grouping, formula or seed key that names `organization_id` on `sys_audit_log` names `tenant_id` instead; the two held the same value on every row a writer wrote.
  - **Who reads what, under a wall.** A platform administrator now also reads the rows about no organization, global settings changes included. An organization administrator reads exactly its active organization's rows. Under the `group` posture an organization reader is scoped to the ACTIVE organization's rows, not the union of its memberships. A permission set an application ships that grants `viewAllRecords` on the ledger (directly or through a wildcard) skips the row policy, as it skips Layer 1 on every object the wall does not cover.
  - **Who reads what, under `single`.** The row policy is stripped under `single` (ADR-0105 D3), as every platform tenant policy is. So a deployment that holds more than one organization under `single` serves every organization's ledger rows to every ledger reader. The remedy is a walled posture.
  - **Existing databases — nothing moves automatically** (ADR-0131 D14). Schema sync is additive: the physical `organization_id` column stays and the boot drift report names it orphaned. The v18 upgrade ceremony confirms its values equal `tenant_id` and drops it (`os migrate apply --allow-destructive`), reporting any row where they differ.
- c52bfb4: feat(service-settings,platform-objects)!: the settings cascade's global rung moves to the tenant-less `sys_platform_setting`, and `sys_setting.scope` no longer declares `global` (ADR-0131 D7)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered sys-setting-global-rung-moved -->
  
  **BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes (Changesets pre mode is not on yet).
  
  A settings value for a key declared at `global` scope is a deployment-wide value: the mail transport, the SMS, storage, AI and knowledge providers, auth policy, the lifecycle retention defaults. It used to be a `scope: 'global'` row of `sys_setting`, a tenant-scoped table, where the injected `organization_id` column only ever held NULL and a walled posture hid the row from every reader. ADR-0131 D7 moves the rung out: it is now stored in a new platform object, `sys_platform_setting`.
  
  - **`sys_platform_setting`** (registered by the settings service, beside `sys_setting`): one row per `(namespace, key)` for the deployment, with the `value`, `value_enc`, `encrypted`, `locked`, `locked_reason` and `updated_by` columns of a settings row, and no `scope`, `user_id` or `organization_id` (`systemFields: { tenant: false }`). It is governed by object permission: a generic data read needs `manage_platform_settings` (`requiredPermissions`), which platform administrators hold. Writes go only through the settings door.
  - **`SettingsService`** writes a global-scope key to `sys_platform_setting` and reads the cascade's global rung from there alone. Its `sys_setting` reads exclude `scope = 'global'`, so there is one source per rung. The cascade order, the lock semantics, `SpecifierScope` and the `source: 'global'` resolution value are unchanged. A global-scope change's `config_change` audit row names `sys_platform_setting` (`CONFIG_CHANGE_GLOBAL_OBJECT_NAME`); tenant- and user-scope changes still name `sys_setting`.
  - **`sys_setting.scope`** no longer declares the `global` option: no write produces such a row. `sys_setting_audit.scope` keeps it, because a global-scope change is still audited there.
  - **`os secret orphans` / `os secret rewrap`**: the settings family of the `sys_secret` reference union now reads both `sys_setting.value_enc` and `sys_platform_setting.value_enc`. Without that, every credential held at the global rung would read as unreferenced and be swept. An unreadable `sys_platform_setting` gaps the family, which refuses deletion.
  
  **What moves for consumers.**
  
  - **Existing databases — nothing moves automatically** (ADR-0131 D14). A `sys_setting` row at `scope = 'global'` is no longer read; until the v18 upgrade ceremony moves it, that key answers from its next rung or the manifest default. The ceremony moves each such row to `sys_platform_setting` by namespace and key, its `value_enc` handle included. An encrypted value needs no re-encryption: the ciphertext's associated data binds the settings scope, namespace and key, never the holding object or an organization.
  - **Authored references.** A filter, list-view column or seed that names `scope = 'global'` on `sys_setting` matches nothing: point it at `sys_platform_setting`, which has no `scope` column.
  - **Generic data reads of the global values.** Read `sys_platform_setting`; it needs `manage_platform_settings`. The settings door (`/api/settings/:namespace`) is unchanged and keeps applying each manifest's own read and write capability.
  - **Kernels that register the settings objects by hand.** Register `SysPlatformSetting` (`@objectstack/platform-objects/system`) beside `SysSetting`; `SettingsServicePlugin` already does. The service reads both on every resolution, so a kernel missing one fails the read loudly rather than answering a cascade with a rung missing.
- 7518ee3: fix(service-settings)!: the user rung answers only its owner, and a write of a user-scoped key must name its user
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing inside SettingsService, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is the service's accept set: `set` and `setMany` now refuse a key declared `scope: 'user'` when the caller's context names no user. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this service and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  A settings key declared `scope: 'user'` belongs to one user. `SettingsService` now holds that on both its read and its write side.
  
  - **Reads.** The user rung answers only a caller whose `SettingsContext.userId` is present and equals the row's owner. A resolve whose context names no user (no `userId`, or an empty one) has no user rung: it answers from the tenant rung, then global, then the manifest default. This holds on every read path that reaches the cascade: `get`, `getMany`, `getNamespace`, `createClient`, `runAction` and `resetNamespace`.
  - **Refused now.** `set` and `setMany` refuse a user-scoped key when the context names no user, a `null` reset of one included. The refusal is a `SettingsValidationError` (`code: 'SETTINGS_VALIDATION'`) with one `fields` entry per such key (`code: 'invalid_value'`, `constraint: { scope: 'user' }`). It refuses the whole batch, before anything is written.
  - **Unchanged.** A caller with a user id reads and writes only their own rows, as before. Keys declared at `scope: 'tenant'` or `'global'` resolve and write the same with or without a user id. The settings HTTP routes resolve a signed-in user before they read or write any row, so they behave as before.
  
  What changes for you: when your code calls the settings service for a user-scoped key, pass the user id of the person the value belongs to. A value meant for everyone belongs on a key declared at `scope: 'tenant'` or `'global'`. None of the settings namespaces this repository ships declares a user-scoped key.
- 79c35d4: fix(service-settings)!: tenant- and user-scope settings rows carry the caller's organization, and the data API read of the settings stores applies each namespace's readPermission
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing inside SettingsService and its plugin, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped (`organization_id` is the column `sys_setting` already declares in its row identity), so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is the service's accept set (a tenant-scope write naming no organization under a walled posture is refused) and the generic read door's row set (a namespace's rows are withheld from a principal lacking its readPermission). The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this service and this diff adds none (not registered / already-registered); and no published interface or type is removed or narrowed (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  `sys_setting` declares its row identity as `(organization_id, namespace, key, scope, user_id)`. `SettingsService` now carries the organization in that identity itself, on every read and write of a `tenant` or `user` row, because it reads and writes the store under its own system context, which no driver tenant scope or organization wall reaches.
  
  - **Writes.** A `tenant` or `user` row is written with the caller's organization (`SettingsContext.tenantId`) in its key and in its stored `organization_id`. A write by one organization updates only that organization's row.
  - **Reads.** The tenant and user rungs draw on the caller organization's rows and on rows stored with no organization, and take the caller organization's own row when it has one. A row stored with no organization stays the fallback for every organization until that organization writes its own. A caller that names no organization reads only the rows stored with no organization under a walled posture (`group`, `isolated`), and every row under `single`. The global rung (`sys_platform_setting`) is unchanged and read by every organization.
  - **Locks.** The lock check on a write reads the same upper rows the caller's cascade reads, so a lock on one organization's tenant row locks nothing for another organization.
  - **Refused now.** Under a walled posture, `set` and `setMany` refuse a key declared `scope: 'tenant'` when the context names no organization, a `null` reset of one included. The refusal is a `SettingsValidationError` (`code: 'SETTINGS_VALIDATION'`, HTTP 400 at the settings routes) with one `fields` entry per such key (`code: 'invalid_value'`, `constraint: { scope: 'tenant' }`). It refuses the whole batch, before anything is written. The posture is the one the `tenancy` service reports; `SettingsServicePlugin` supplies it through `bindEngine`.
  - **Generic read door.** `SettingsServicePlugin` registers an engine middleware on `sys_setting`, `sys_setting_audit` and `sys_platform_setting`: every non-system read (`find`, `findOne`, `count`, `aggregate`) is narrowed to the namespaces whose `readPermission` the principal holds, by the same rule `GET /api/settings/:namespace` applies. A namespace with no registered manifest reads at the default capability, `setup.access`.
  - **Unchanged.** Under `single`, a caller in the default organization reads every value it read before, and a process-wide reader that names no organization reads the organization's current value. Keys declared at `scope: 'global'` resolve and write the same for every caller.
  
  What changes for you: write a tenant-scope setting from inside the organization it belongs to (an active organization on the session, or `SettingsContext.tenantId` in process). Rows already stored with no organization are not rewritten.
- 20949e7: fix(service-settings)!: the settings REST family refuses an anonymous caller with the shared 401
  
  Clause-②: no — it narrows the anonymous accept set to the ADR-0056 D2 floor; no published schema or export moves.
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at the routes registerSettingsRoutes mounts, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and a signed-in caller receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers the family serves: a caller whose resolved context names no user is now refused with the shared anonymous-deny 401 before any settings logic runs. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  `registerSettingsRoutes` mounts the settings REST family. Until now it ran no anonymous floor: a caller with no session was answered by the family's own capability logic, with a status other than `401`. ADR-0056 D2 denies anonymous callers by default, and ADR-0138 D2 says a surface outside its door classes answers `401`.
  
  - **Refused now:** every route of the family answers a caller with no user `401` with code `UNAUTHENTICATED`, in the declared error envelope, before the settings service is consulted. The decision is the platform's shared one (`shouldDenyAnonymous`), mounted once for the whole family.
  - **Unchanged:** a signed-in caller is served exactly as before, and the per-namespace read and write capabilities still decide what it may see and change. An authorization-store outage still answers its `503`.
  
  What changes for you. Sign in before calling the settings routes. If you mount `registerSettingsRoutes` yourself with your own `contextFromRequest`, it must put the caller's `userId` on the context it returns: a context without one is anonymous now, whatever capabilities it carries.
- bae5841: fix(service-settings)!: the settings route family refuses a session the ADR-0069 authentication policy holds, and `SettingsContext` declares the posture as an optional `authGate`
  
  Clause-②: yes (narrowing) — an optional `authGate` on the exported `SettingsContext` widens the public surface; the family door's refusal of a held session narrows what it answers.
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at one family of routes mounted directly on the host server, plus one additive optional field on an exported runtime type; not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped. `SettingsContext` gains `authGate?`, typed by `@objectstack/core`'s existing `AuthGate`; every context that type-checked before type-checks unchanged, and a resolver that never sets the field gets the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which sessions the family serves: a session whose user carries the ADR-0069 posture (an expired password, or enforced MFA not yet enrolled) is now refused with the gate's 403 before any settings logic runs. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); the type change is a widening, not the removal or narrowing those categories describe (not runtime-interface-only / type-surface-only); and no runtime export is retired (not runtime-export-retired). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  ADR-0069 holds a signed-in user out of every protected resource while their password has expired or while enforced MFA is not yet enrolled, until they remediate. REST, the runtime dispatcher and the four sibling families already refuse such a session. The settings family (`registerSettingsRoutes`) resolves its own caller and never asked, so it served a held session as an ordinary signed-in caller.
  
  - **`SettingsContext.authGate`** (new, optional): the caller's posture, `{ code, message }`, the same shape and meaning as `ExecutionContext.authGate`. Present only while the session is held.
  - **The family door** asks the shared decision (`evaluateAuthGate`, `@objectstack/core`) about the context it resolved, on every route, before the anonymous floor and before any settings logic.
  - **`SettingsServicePlugin`'s resolver** puts the posture on the context through the shared reader (`normalizeAuthGate`), from the same session read that resolves the caller.
  
  - **Refused now:** a held session gets `403` with the gate's own `code` (`PASSWORD_EXPIRED` or `MFA_REQUIRED`) and `message`, in the family's declared error envelope. This is the answer REST gives the same session.
  - **Unchanged:** a session the policy does not hold is served exactly as before, an API-key caller is unaffected because it has no session to hold, an anonymous caller gets the same `401`, and a CORS preflight is answered as before.
  
  What changes for you. A user the policy holds must remediate (change the password, or enroll an authenticator) before the settings routes answer them, as on every other protected route. With `SettingsServicePlugin` nothing needs configuring. If you mount `registerSettingsRoutes` yourself with your own `contextFromRequest`, a resolver that sets no `authGate` behaves exactly as before; set `authGate` on the context it returns for a held session (`normalizeAuthGate(session.user)` from `@objectstack/core` reads it), and the door refuses on that field.
- 0f05907: feat(spec,core,plugin-auth)!: an API key answers as its owner's session does when the ADR-0069 policy holds the account, the forced reset gets its own code and an explicit revocation switch
  
  Clause-②: yes (narrowing) — the published contract widens (the posture codes become a closed vocabulary with a declared scope, a new `PASSWORD_RESET_REQUIRED` code, a per-user posture member on the auth service contract, new `@objectstack/core` exports) and the API-key door narrows (a key whose owner holds an account-scope posture is refused where it was served).
  
  <!-- adr-0087: not-required (no-migration-prescription) An authentication-policy change at the API-key admission seam plus one new error code, not a metadata change. No authorable spec key, stored shape or metadata surface is removed or renamed, so `objectstack migrate meta` has nothing to rewrite. `ExecutionContext.authGate.code` narrows from a bare string to the closed posture vocabulary, but that field is server-constructed only and never authored; its one producer already wrote only members of it. What narrows is which API keys are served (a key whose owner owes MFA enrolment is refused with 403 MFA_REQUIRED), and the administrator-forced password change answers its own code. The packages publish (not unpublished), no ADR-0087 id covers this and none is added (not registered or already-registered). -->
  
  **BREAKING** (an accept-set narrowing at the API-key door, and a changed code for the administrator-forced password change), shipped as `minor` under the launch-window convention for breaking changes.
  
  Ruling C′ on #23287: posture codes are a closed vocabulary, and each code declares what it holds.
  
  - **The vocabulary and its scope (`@objectstack/spec/kernel`).** `AuthGateCodeSchema` is the closed set of codes an `authGate` may carry: `PASSWORD_EXPIRED`, `PASSWORD_RESET_REQUIRED` and `MFA_REQUIRED`. `AUTH_GATE_SCOPES` declares each code's scope once: `MFA_REQUIRED` holds the **account** (every credential of the user); `PASSWORD_EXPIRED` and `PASSWORD_RESET_REQUIRED` hold the **credential** (password sign-in alone). `ExecutionContext.authGate.code` is typed against the vocabulary, and `PASSWORD_RESET_REQUIRED` is registered for `@objectstack/plugin-auth` in the error-code ledger.
  - **One per-user posture computation (`@objectstack/plugin-auth`, `IAuthService.resolveUserAuthGates`).** It answers every posture a user holds, most urgent first, keyed by user id and the organization the credential operates in. The session gate shows its first entry, as before.
  - **One judgment at the shared key-admission seam (`@objectstack/core`).** `resolveApiKeyAdmission` asks that computation for the key's owner and holds the key on an account-scope posture (a new `held` outcome). `resolveAuthzContext` resolves a held key as a held principal: the owner, `credential: 'api_key'`, and the posture on `authGate`. Both new inputs are optional (`userAuthGates`), and `userAuthGateSourceOf(authService)` binds one from an auth service.
  - **REST and the runtime dispatcher** judge a key-admitted request by the key's answer, and re-read the session cookie for the gate only when a session admitted the caller. The declared-endpoint fallback does the same.
  - **The raw-host families** take the same answer through the shared seam: datasource admin, share links, settings, and the storage family's door. The webhook-redeliver door admits no API key at all, and still does not.
  - **The forced reset (`POST /api/v1/auth/admin/set-user-password`, the `set_user_password` action).** `must_change_password` now answers `PASSWORD_RESET_REQUIRED` instead of reusing `PASSWORD_EXPIRED`. The act carries `revokeSessionsAndKeys`, **on by default**: it ends every live session of the user and revokes every API key they own, and the response reports what landed (`revoked: { sessions, apiKeys, failed, complete }`).
  
  What changes for you:
  
  - **Refused now:** an API key whose owner owes MFA enrolment past the grace window gets `403 MFA_REQUIRED`, with the message the session gets, on every face that admits keys. It works again the moment the owner enrols, with nothing reissued: the refusal is not a revocation.
  - **Unchanged:** a key whose owner's password expired, or whose administrator forced a password change, keeps working. A session sent beside an API key no longer answers for the key.
  - **A forced password change answers `PASSWORD_RESET_REQUIRED`.** A client that recognises `PASSWORD_EXPIRED` to show its change-password flow should recognise `PASSWORD_RESET_REQUIRED` the same way.
  - **An administrator's password reset now signs the user out everywhere and revokes their API keys by default.** For a routine reset, pass `revokeSessionsAndKeys: false` (or clear the switch in the Set Password dialog). Revoked keys stay revoked after the password change; an administrator can restore a key a routine reset revoked with the Restore API Key action, or the owner mints a replacement.
  - **Hosts calling `resolveAuthzContext` or `resolveApiKeyAdmission` directly** pass `userAuthGates: userAuthGateSourceOf(authService)` to have the key's owner asked. Code switching exhaustively over `ApiKeyAdmission['outcome']` handles the new `held` outcome.
- 1d79556: feat(spec,core,runtime,plugin-auth)!: API keys get a lifecycle: a 90-day default expiry, a one-year ceiling, a 90-day inactivity expiry, a one-year grace for keys created with none, and distinct refusal codes
  
  Clause-②: yes (narrowing) — the published contract widens (four `auth` settings keys, the `IAuthService.resolveApiKeyLifecyclePolicy` member and its `ApiKeyLifecyclePolicy` type, four registered error codes, new `@objectstack/core` exports) and the API-key doors narrow (a signing past the ceiling is refused; an inactive key, a key past its grace, and a revoked or expired key sent beside a session are refused where they were served).
  
  <!-- adr-0087: not-required (no-migration-prescription) An authentication-policy change at the API-key signing door and the shared key-admission seam, not a metadata change. No authorable spec key, stored shape or metadata surface is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite: the four new `auth` settings keys are additive and defaulted, `sys_api_key` gains no column (its existing `expires_at` and `last_used_at` are written by the platform), and `ResolveAuthzInput.apiKeyLifecycle` / the sixth parameter of `resolveApiKeyAdmission` and `resolveApiKeyPrincipal` are server-side wiring no author writes. What narrows is which API keys are served and which signings are accepted; the remedy is a new key or a nearer date, never a rewrite of a package source or a stored row. The packages publish (not unpublished), no ADR-0087 id covers this and none is added (not registered or already-registered). -->
  
  **BREAKING** (an accept-set narrowing at the API-key doors), shipped as `minor` under the launch-window convention for breaking changes.
  
  Ruling A on #23367: the key store stays `sys_api_key`, and the policy is auth configuration.
  
  - **The policy (`@objectstack/plugin-auth`, `IAuthService.resolveApiKeyLifecyclePolicy`).** Three `auth` settings keys, bound by `bindAuthSettings`: `api_key_default_expiry_days` (90), `api_key_max_expiry_days` (365) and `api_key_inactivity_days` (90; `0` turns it off). A fourth, `api_key_policy_started_at`, is recorded once — on the first boot that runs the policy, at `kernel:bootstrapped` — and anchors the two clocks below; it survives restarts and is never overwritten by the platform.
  - **The signing door (`POST /api/v1/keys`).** A signing that names no `expires_at` gets the default life and the response echoes it. An `expires_at` further away than the ceiling is refused `400 API_KEY_EXPIRY_TOO_LONG`, naming the latest date allowed; exactly the ceiling is accepted. A kernel with no auth service signs as before.
  - **The key-admission seam (`resolveApiKeyAdmission`, `@objectstack/core`).** A real key its own state refuses is a new outcome, `lifecycle`, with one of three distinct codes: `API_KEY_REVOKED`, `API_KEY_EXPIRED` (past `expires_at`, or past the grace of a key created with none) or `API_KEY_INACTIVE` (no recorded use for longer than the window). `resolveAuthzContext` raises it as the branded `ApiKeyLifecycleRefusalError` (`403`, a located message naming the key's prefix, the date and the remedy). An unknown key is still `none`.
  - **`last_used_at` is written.** Its description promised "Automatically updated on each API call", and nothing wrote it. The seam now stamps it on an admitted (or held) call, at most once an hour per key, and the inactivity judgment reads the value as it was BEFORE that call's stamp, so a key's own use cannot revive it. A stamp that fails never fails the request; it is said once, at `error`.
  - **Keys created before the policy.** A key with no expiry gets one year from `api_key_policy_started_at`; the date is stamped onto its `expires_at` the first time it is admitted, so the keys page shows it, and the refusal after it names it. A key with no recorded use counts its inactivity from the same anchor (or from its own creation, when later) — never from an earlier `created_at`, since no use was ever recorded before the policy.
  - **Every face that admits keys** passes the policy source (`apiKeyLifecyclePolicySourceOf(authService)`, a required input beside `userAuthGates`). Every one of them answers the refusal's `403` and code: the runtime dispatcher (the MCP HTTP endpoint among its routes), the REST data API, the settings routes, the storage download routes, the datasource admin routes, the share-link routes, the marketplace install-local routes and the MCP stdio transport. Each relays the refusal by its brand, so every other identity fault at those doors keeps its existing answer.
  - **`OS_CLOUD_API_KEY` is untouched.** It is the runtime's outbound credential to the control plane, never admitted by this seam.
  
  What changes for you:
  
  - **A key created without an expiry now expires.** It used to live until revoked; it now lives 90 days (or the configured default). Pass `expires_at` to choose, and create a new key before it ends.
  - **A signing asking for more than a year is refused** `400 API_KEY_EXPIRY_TOO_LONG`, where it used to be accepted. Ask for the date the message names, or an earlier one.
  - **A key unused for 90 days is refused** `403 API_KEY_INACTIVE`, where it used to be served. It is not revoked; the remedy is a new key.
  - **A key that already existed with no expiry keeps working for one year** from the date the policy took effect on your deployment (`auth.api_key_policy_started_at`), then answers `403 API_KEY_EXPIRED` naming that date. Replace such keys within the year.
  - **A revoked or expired key answers its own code** (`403 API_KEY_REVOKED` / `API_KEY_EXPIRED`) on every face that accepts a key, where it used to answer the generic `401`; and a session cookie sent beside such a key no longer answers for it.
  - **Hosts calling `resolveAuthzContext`, `resolveApiKeyAdmission` or `resolveApiKeyPrincipal` directly** pass `apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(authService)` (or the sixth argument), or an explicit `undefined` where no auth service exists. A caller of `resolveAuthzContext` that wants the located answer re-raises `ApiKeyLifecycleRefusalError` (`isApiKeyLifecycleRefusalError`) the way it re-raises the store outage. Code switching exhaustively over `ApiKeyAdmission['outcome']` handles the new `lifecycle` outcome.
- d65826f: fix: framework writes on tenant-column objects name the organization they can derive (ADR-0131 D9)
  
  Clause-②: yes (widening)
  
  A write on a tenant-column object with no organization is derived under `single` and refused under a wall (ADR-0131 D9). Before the engine stops letting such writes through, each of these producers now names the organization it can derive itself. Under `single` that is the Default Organization, which is the owner the engine would derive anyway, so no reader changes. Under a wall the row names an organization only where the producer has one. The rows it cannot attribute are written exactly as before.
  
  - **`@objectstack/plugin-auth`.** The self-registration grant (`sys_user_permission_set`) and the auth mails about a user (verification, password reset, account invitation, magic link, change-email notice → `sys_email`) read one derivable organization: the `tenancy` service's `defaultOrgId()`. Under `single` that is the Default Organization. Under a wall it is none, because the registrant belongs to no organization yet. The verification and reset mails used to persist with no organization even under `single`.
  - **`@objectstack/plugin-audit`.** An activity row (`sys_activity`) about a record with no organization of its own (a `sys_user`, a platform setting), written with no session organization (a sign-up), takes the Default Organization under `single`. The record's own organization and then the session's still win. The ledger's `tenant_id` attribution is unchanged. New optional `AuditWriterOptions.getDefaultOrganizationId()`; `AuditPlugin` wires it to the `tenancy` service.
  - **`@objectstack/service-settings`.** The `sys_secret` ciphertext and the `sys_setting_audit` history row of a `tenant` or `user` value carry that value's organization, which is the same owner as its `sys_setting` row. A `global` value's rows name none. New optional `organization_id` on `SettingsSecretStore.insert`'s row and `organizationId` on `SettingsAuditWriter.write`'s entry; the built-in writers persist them. A failed `sys_setting_audit` write is now reported at `error`, not `warn`: the settings write succeeds while its history row is lost. The first report names the consequence and the fix. `buildSettingAuditWriter`'s optional logger argument keeps every sink it accepted (none, `{}`, or one with an optional `warn`) and additionally takes a sink that carries `error`. It reports through `error` when the sink has it, else through `warn`.
  - **`@objectstack/verify`.** The RLS probe and position personas' grants (`sys_user_permission_set`, `sys_user_position`) belong to the organization the persona is a member of (the Default Organization under `single`). They used to be written with an explicit `organization_id: null`. A persona that belongs to no organization, or to several, names none.

### Patch Changes

- 25e16ab: fix(plugin-auth): the auth IP allow-list judges the client address the server established (#24739)
  
  Clause-②: no
  
  The `allowed_ip_ranges` auth setting (ADR-0069 D5) and the `last_login_ip` login audit (D7) now establish a request's client address by the same rule as the inbound rate limiter: `X-Forwarded-For` (its first entry), then `X-Real-IP`, count only when the stack declares `server.trustProxy`. Otherwise the address is the connection's peer address.
  
  **For operators who set `allowed_ip_ranges`:**
  
  - Behind a reverse proxy or load balancer, declare `server: { trustProxy: true }` in the stack before you upgrade. Without it, the allow-list judges the proxy's own address for every request.
  - A request whose client address cannot be established (the transport reports no peer address, and no forwarded header is trusted) is now refused with `403 IP_NOT_ALLOWED`. Before, it was admitted. The first such refusal logs a warning that names `allowed_ip_ranges` and `server.trustProxy`.
  - `CF-Connecting-IP` is no longer read. Behind Cloudflare, declare `server.trustProxy`, and the `X-Forwarded-For` it sets is used.
  - A dual-stack listener reports an IPv4 client in IPv4-mapped form (`::ffff:203.0.113.7`). That address is now matched as the IPv4 address it denotes.
  - With `allowed_ip_ranges` unset or empty, nothing changes.
  
  **`last_login_ip`** records the address the allow-list judged, or no address when none could be established. It is no longer read from a forwarded header the deployment does not trust.
  
  **By package:**
  
  - `@objectstack/plugin-auth`: the rule is published as the dependency-free `@objectstack/plugin-auth/client-address` entry (`resolveClientAddress`). `AuthPlugin` and `AuthManager` take a `trustProxy` option. `AuthManager.handleRequest` takes an optional second argument that carries the transport's `remoteAddress`.
  - `@objectstack/runtime`: the inbound rate limiter imports the rule from that entry instead of keeping its own copy. Its keys are unchanged.
  - `@objectstack/cli`: `objectstack serve` passes the stack's `server.trustProxy` to `AuthPlugin` as well as to the dispatcher. A host that composes `AuthPlugin` itself passes `trustProxy` the same way.
  - `@objectstack/service-settings`: the `allowed_ip_ranges` help text says which address is judged.
- 7697ddc: fix(service-settings): Setup's AI "Test embedder" and Knowledge "Test connection" buttons are answered, and their answers say they checked the form only
  
  Clause-②: no
  
  - **Before.** Both buttons answered `400 SETTINGS_ACTION_FAILED` with "No handler registered for action 'test_embedder' in 'ai'." and "No handler registered for action 'test' in 'knowledge'." The manifests declared both buttons and the package exported both handlers (`aiTestEmbedderActionHandler`, `knowledgeTestActionHandler`), but `SettingsServicePlugin`'s default `actionHandlers` map did not register them.
  - **Now.** The default map registers both, beside `mail.test`, `sms.test`, `storage.test` and `ai.test`. A host that passes its own `actionHandlers` still replaces the whole default map, and a plugin can still replace any one handler with `SettingsService.registerAction`.
  - **What each button checks.** Both are form checks and send nothing over the network. "Test embedder" checks that a provider is chosen, that an API key is set (Ollama excepted) and that `custom` / `azure` have a Base URL. "Test connection" checks that a managed `libsql://` Turso URL has an auth token and that RAGFlow has a Base URL and an API key. The in-memory adapter answers with a warning that there is no external service to probe.
  - **Answer text.** A passing "Test embedder" now ends "This checks the form only — no embedding request was sent." Every passing "Test connection" on Turso or RAGFlow now says "This checks the form only — no connection was attempted." The old "Mount @objectstack/embedder-openai + a knowledge adapter to exercise live calls" and "Mount @objectstack/knowledge-ragflow to exercise live calls" are gone: neither package registers these actions, so mounting it never made either check live.
- 4be7281: fix(service-settings): Setup → Authentication says what the sign-up and Google toggles do beside the audience and the credentials (#24776)
  
  Clause-②: no
  
  Two controls on the Authentication settings page read as contradicting the system on a fresh install. Their wording changes; no default, `visible` rule, `required` flag, option or stored key moves, and no deployment admits or signs in anyone it did not before.
  
  - **`auth.signup_enabled`** is now labelled *Allow email sign-up* (it was *Allow self-service registration*) and carries help text. It is the email-and-password sign-up form's own switch, and the *Self-registration audience* decides who the form admits: under `invite_only`, only an address holding a pending invitation; under `email_domain`, the allowlisted domains and invited addresses; under `open`, anyone. Off closes the form under every audience, invitations included. So ON beside *Invitation only* means the form is open to invited addresses.
  - **`auth.google_enabled`** help now says that Google sign-in is offered only once a client ID and a client secret both resolve, saved on the page or set as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server (which win over saved values). Until then the login page shows no Google button, even while the toggle is on. Off withdraws Google sign-in even when the server sets both.
  
  The English, Chinese, Japanese and Spanish bundles carry the new label and help.
- 66949b7: feat(plugin-security)!: the four security-catalog row objects are retired — `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability` (ADR-0131 D3)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered catalog-row-objects-retired -->
  
  **BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.
  
  Positions, permission sets and capabilities live in the security catalog — the environment registry, fed by package declarations and by environment metadata saved through `/api/v1/meta` (ADR-0131 D3). The four row objects that mirrored them are no longer registered, so their data and REST routes and their Setup object pages are gone. No table is dropped and no row is deleted.
  
  FROM → TO:
  
  - `GET|POST|PATCH|DELETE /api/v1/data/sys_permission_set` → `GET|PUT|DELETE /api/v1/meta/permission/:name`; to copy a set, `POST /api/v1/security/permission-sets/:name/clone` with `{ name, label }`.
  - `… /api/v1/data/sys_position` → `/api/v1/meta/position/:name`. A position's permission sets are its definition's `permissionSets`.
  - `… /api/v1/data/sys_position_permission_set` → the position definition's `permissionSets` (`PUT /api/v1/meta/position/:name`).
  - `… /api/v1/data/sys_capability` → read-only `GET /api/v1/meta/capability`; a package declares a capability with `defineCapability` (`stack.capabilities`).
  - Setup → Access Control → Positions / Capabilities / Permission Sets now open Setup's catalog lists (`/apps/setup/metadata/<type>?scope=environment`) instead of the object pages; the `sys_position` record page (`SysPositionDetailPage`) is removed.
  - An object permission on one of the four names in a permission set grants nothing and can be deleted.
  
  What else changes:
  
  - `sys_user_permission_set.permission_set_id` is a plain text column now, not a lookup: same column, same stored ids, same indexes. It is not written and grants nothing; a grant names its set by `permission_set`.
  - A permission set saved through the metadata door is written to no row: the `permission` mutation projector, the `sys_permission_set` and `sys_position` data-door write-throughs and the row-only position backfill are no longer registered.
  - On a fresh `single`-posture database the first human is promoted to platform administrator without reading any catalog row. An unscoped grant written before `sys_user_permission_set.permission_set` existed (it names no set) still withholds the promotion until the organization-ownership migration names it.
  - Uninstalling a package still revokes every grant naming a permission set the package declared, by the names the uninstalling door captures before the withdrawal (`declared`, `captureUninstallDeclared`), and now by those names alone: the cleanup reads and removes no `sys_permission_set` or `sys_position_permission_set` row, so the `sets` and `positionBindings` counts on its outcome are always 0. A grant written before `sys_user_permission_set.permission_set` existed names no set and is not reached; the organization-ownership migration names it.
  - On a `group` or `isolated` deployment the data-door half of the walled catalog refusal goes with the objects: a data-door insert, update or delete on `sys_position`, `sys_permission_set` or `sys_capability` answers `404 OBJECT_NOT_FOUND` for every caller instead of `403 PERMISSION_DENIED` below the platform operator. The refusal at the `/meta` write doors, the permission-set clone door and the `/packages` write doors is unchanged.
  - `capability-reference-unknown` no longer counts a `sys_capability` seed row as a declared capability — no runtime reader consults one. Declare the capability with `defineCapability`.
  - On an existing database `os migrate plan`'s unmanaged-table sweep now lists the `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability` tables: they keep their rows and no object declares them any more. The sweep only reports; nothing is dropped, and the tables stay for the organization-ownership migration.
  
  Removed exports, no replacement:
  
  - `@objectstack/plugin-security`: the object definitions `SysPosition`, `SysPermissionSet`, `SysPositionPermissionSet`, `SysCapability` (from `./objects`); `securityObjects` lists the remaining three.
  - `@objectstack/platform-objects/pages`: `SysPositionDetailPage`.
  - `@objectstack/spec`: `SystemObjectName.POSITION`, `SystemObjectName.PERMISSION_SET`; the four names leave `PLATFORM_OBJECTS_BY_PACKAGE['plugin-security']` and `PLATFORM_PROVIDED_OBJECT_NAMES`.
  - `@objectstack/core`: `isRowActive` and `ActivatableRow` — a catalog row's `active` column decides nothing; deactivation is the activation ledger's (`sys_metadata_activation`).
  - `@objectstack/objectql`: the published `PLATFORM_OBJECT_TENANCY` record loses its `sys_permission_set` key (the other three names were never in it). A removed key of an exported constant is a narrowing, so `@objectstack/objectql` takes `minor` under the launch-window convention for breaking changes.
- b88c356: The remaining platform producers in these four packages now pass the explicit system opt-in (`{ isSystem: true }`) on their data-engine calls. Until now they reached the engine with no principal and no opt-in, and the security middleware let that through only because of its principal-less hand-off.
  
  Clause-②: no
  
  - **service-messaging, the inbox read state.** `listInbox` (and its unread total), the receipt read behind it, and mark-read / mark-all-read take the opt-in inside the service. Their scope is unchanged: every read of a user's rows is keyed on the user id the door derived from the session, the receipt a mark-read inserts is stamped with it, and the receipt it updates is one a user-keyed read returned.
  - **service-messaging, `owner_of:` audiences.** The record read takes the opt-in, the same posture as the email lookup beside it. It reads only `id` and the owner fields, and only the owner id leaves the resolver. An `owner_of:` audience on an object whose sharing model is `private` now resolves its owner; before, it resolved to nobody.
  - **service-messaging, the rest of the fan-out and the outboxes.** The `role:` and `team:` membership reads, the email and SMS recipient reads, the notification template read, the dedup lookup in `emit()`, and both outboxes' enqueue, ack and list.
  - **service-storage.** `StorageMetadataStore.createFile` and `createSession` insert under the opt-in. The organization still reaches the driver beside it, so the stored organization is unchanged, and the file's `owner_id` is still the uploading user.
  - **service-settings.** The `sys_secret` store the plugin builds (insert, get, update), and the read that verifies a rotation before the old secret is reaped. A store `update` now writes the `ciphertext` it is given; without a context the engine's read-only strip dropped it. No caller in this repository uses `update`.
  - **metadata-protocol.** `SysMetadataRepository.getByHash`, `list`, `history` and the history replay of `watch()`.
  - None of the gates the middleware runs before its hand-off applies to these calls. ⛔ No new export on any package entry, and no new elevation API.
- 98998ca: fix(service-settings): the Default timezone help speaks to administrators, not in formula-function names
  
  Clause-②: no
  
  The help under Settings → Localization → Default timezone (also shown in the first-run "set the workspace timezone" prompt) read "IANA zone for today()/daysFromNow, analytics date buckets, and rendered datetimes." It now says what the setting does: "Decides what "today" means in formulas, how reports group dates, and how dates and times are shown. Accepts any IANA time zone name (e.g. Europe/Paris)." The same meaning ships in every built-in locale (en, zh-CN, ja-JP, es-ES) and in the manifest's own `description`, which `GET /api/settings/localization` serves and the console falls back to.
  
  Wording only: the `timezone` key, its default (`UTC`), its accepted values (any IANA zone) and what it drives are unchanged.
- 4f4c4ed: fix(auth,services): the remaining in-process session reads no longer renew a browser session behind its cookie (#22258)
  
  **What was wrong.** better-auth's `getSession` renews a session older than `session.updateAge`: it moves `sys_session.expires_at` to `now + expiresIn` and stages the renewed session cookie on that call's own response. Nine doors in these packages read the session in-process (`auth.api.getSession({ headers })`) and answer with their own response, so the renewal landed in the database and its cookie was discarded. The browser kept its old cookie, which then expired before the session: a dead cookie beside a live bearer, after which every cookie-only path saw a signed-out user. The doors: `POST /api/v1/auth/admin/oauth2/toggle-disabled`, every `/api/v1/auth/admin/*` mount behind the shared platform-admin gate, `POST /api/v1/auth/admin/unlock-user` and `POST /api/v1/auth/admin/has-permission` (`@objectstack/plugin-auth`); `POST /api/v1/webhooks/redeliver`; the storage upload and download doors (`/api/v1/storage/*`); the share-link management routes (`/api/v1/share-links`); the settings routes (`/api/settings`); and the datasource-admin routes (`/api/v1/datasources/*`).
  
  **The rule now** is the one the REST, dispatcher, current-user and cloud-connection doors already follow. Each of these reads goes through `inProcessSessionReadInput(headers)` from `@objectstack/types`:
  
  - **A request carrying a session cookie** (a browser, including a console that sends its cookie beside its bearer) reads with `query.disableRefresh`. The session renews only through `GET /api/v1/auth/get-session`, which re-issues the cookie with `Max-Age = expiresIn`, so cookie and session expire together.
  - **A bearer-only request** (`@objectstack/client` outside a browser, the `os` CLI) is unchanged: a read past `updateAge` still renews the session, and no cookie is set on a response to a request that sent none.
  
  **Upgrading.** Nothing to change. `@objectstack/plugin-webhooks` now depends on `@objectstack/types` directly; it already reached it through `@objectstack/core`.
- 3c1a046: fix: a route's catch-all `500` answers its own generic text, never the caught error's message, and `@objectstack/types` exports the writer that does it, `sendServerFault`
  
  Clause-②: yes (widening) — `@objectstack/types` gains one export, `sendServerFault`; nothing is removed, renamed or narrowed, and no response field changes shape.
  
  A declared 5xx does not carry the text of the error it caught: that text can name server internals, such as a path, a host or a table. The REST layer already withheld it. The storage, settings and i18n route families and the share-link routes answer in the nested `{ success: false, error: { code, message } }` envelope and did not: their catch-all `500` sent the caught error's message to the caller.
  
  - **What a caller now reads.** The same `status` and `code` as before, with the route's own generic text as `error.message`: `Internal error` on the storage and i18n routes, the route's message on the settings routes (`Failed to list manifests`, `Failed to read namespace`, `Failed to write namespace`, `Action failed`), and the route's `Failed to …` message on the share-link routes. On the storage routes this includes the metadata store's outage sentence, which an operator now reads in the server log.
  - **What the operator reads.** The original error, stack included, in one `[5xx]` server-fault line. The storage byte routes, which already withheld the text, logged two lines per fault and now log one. A line names the mounted route pattern when the route passes one, never the request URL.
  - **Unchanged.** Every `4xx` answer. The settings `SETTINGS_CRYPTO_UNAVAILABLE` refusal, which keeps its prescription. The authorization-store outage `503`, which keeps its declared code and message. The storage `501 NOT_IMPLEMENTED` answers. On the share-link routes, any error that declares its own `status` keeps the envelope it declares.
  - **`sendServerFault(res, status, code, message, thrown, request?)`** (new, `@objectstack/types`): writes `message` in the declared envelope, and hands `thrown` to the server-fault log with its stack, as the fault's one line. Use it for an arm that answers a caught fault. Keep `sendError` for a `4xx` and for a `5xx` whose text you wrote for the reader. `request` is the mounted route pattern, never the request URL.
- 0c3db0f: The settings routes' identity door resolves through `@objectstack/core`'s `resolveRequestExecutionContext`, the one request-to-`ExecutionContext` composition
  
  Clause-②: no
  
  - `SettingsServicePlugin` resolves the caller of every `/api/settings` route by calling `resolveRequestExecutionContext` with this door's differences as named parameters: `anonymous: 'fail-closed'`, `authGate: 'resolved'`, `credentials: 'api-key-and-session'`, `sessionApi: 'optional'`, `session: 'request'`, its own way to reach the `tenancy` service, `localization: 'withhold'`, no request locale, `accessToken: 'withhold'`, and no OAuth provenance or admission channel. The engine and auth-service lookups, the header normalisation, the tenancy wiring, the projection to `SettingsContext` and the fail-closed `catch` stay at the door.
  - The answers are the ones the door gave before: an anonymous caller, an unrecognised cookie, a failed session read and a refused API key get `401 UNAUTHENTICATED`; a session or an API key owner the authentication policy holds gets `403` with its code and message; an unreadable permission store or tenancy service gets `503 SERVICE_UNAVAILABLE`; and an API key its own lifecycle refuses gets its `403` and code. A one-off probe of 29 fault wirings through the listing route read the same answer on both sides of the change.
  - Nothing to do for a consumer: no export, route, configuration key or response shape changed.
- 747c8e9: Clause-②: no
  
  fix(service-settings): the File Storage, Knowledge and AI settings pages show their warnings as `info_banner` callouts with `bannerSeverity: 'warning'`, not as a sentence inside a subtitle or a field's help text
  
  Four warnings were written into ordinary strings with a hand-typed warning glyph, so the admin read them as one more sentence of the page subtitle or of a toggle's help. Each one is now an `info_banner` row in the section it concerns, directly under the field it warns about:
  
  - `storage` — `adapter_switch_warning`, under the Adapter select: switching adapter does not migrate existing files.
  - `knowledge` — `adapter_switch_warning`, under the Adapter select: switching adapter does not migrate existing indices.
  - `knowledge` — `enforce_rls_warning`, under the Enforce RLS on search toggle: disabling it skips the vector-store leakage safeguard.
  - `ai` — `log_prompts_warning`, under the Log full prompts toggle: full prompts may leak PII.
  
  The namespace description or field help of each keeps its non-warning text. The translations moved with them: in the `en`, `zh-CN`, `ja-JP` and `es-ES` bundles each warning sentence left the `description` / `help` copy and sits under `settings.NAMESPACE.banners.BANNER_ID.{title,text}`, with a translated title per banner. The existing Feature Flags `beta_notice` banner gained the same copies, so no shipped locale reads it in English any more.
  
  No setting key, value, default or save behaviour changes. A host that renders `info_banner` rows from the manifest literals draws the English title and text; translated copy is read through `resolveSettingsBannerTitle` / `resolveSettingsBannerText` from `@objectstack/spec/system`.
- 04fd88a: Clause-②: no
  
  fix(service-settings): the Setup settings pages name the organization or the environment where they said "workspace"
  
  - **What changed.** The built-in settings manifests and their en, zh-CN, ja-JP and es-ES bundles no longer say "workspace" (工作区, ワークスペース, espacio de trabajo). Each string now uses the noun for what the setting belongs to:
    - **Organization** (组织 / 組織 / organización): the Branding name field, now **Organization name**, and the Branding description; the Company legal-name help; the Feature Flags description. These settings are stored once per organization.
    - **Environment** (环境 / 環境 / entorno): the Provider section of Mail and of SMS. These settings are stored once for the running instance.
    - Authentication, New user membership: the help now names the explicit act as **creating an organization**.
  - **Unchanged:** every setting key, including `branding.workspace_name` and its `OS_BRANDING_WORKSPACE_NAME` override; stored values; the Settings hub `category` values; the keys and shape of the translation bundles; and the exports. Only the text a reader sees changed.
- 44a5011: Clause-②: no
  
  Refusals and Setup help text that a user reads inside the running system no longer call that system
  "this environment". They say "this system", or they drop the noun.
  
  - `@objectstack/plugin-auth`: the two self-registration refusals drop the noun ("Self-registration is
    closed (audience posture invite_only).", "Self-registration is limited to approved email domains, …").
    So do the OAuth self-service `503` ("OIDC provider is not enabled") and the SSO `400`
    `DOMAIN_VERIFICATION_DISABLED` ("Domain verification is not enabled (set
    OS_SSO_DOMAIN_VERIFICATION)."). The last-administrator guard's refusals and its two warning lines say
    "this system", including "nobody able to administer the system". The OIDC authorize-gate refusal
    (`403 ENV_ACCESS_DENIED`) keeps "this environment". Only the cloud control plane installs that gate,
    and there the noun names the environment a cloud user is signing in to.
  - `@objectstack/plugin-security`: the diagnostic `message` of the packaged-permission-set lock now reads
    "… is declared by package '…' and is locked — editing it here would …". The provenance-unknown
    refusal says "this system could not determine …". Both `userMessage` texts are unchanged.
  - `@objectstack/service-settings`: the Mail and SMS provider groups read "Choose how this system sends
    outbound email." and "… outbound SMS.". The Authentication audience group reads "Who may become a user
    of this system's apps.". The zh-CN, ja-JP and es-ES bundles change only the noun, to 本系统,
    このシステム and este sistema.
  
  Only the human-readable text moves. Every HTTP status, error code, settings key and response shape
  stays as it was.
- Updated dependencies [5a871e4]
- Updated dependencies [ffba02e]
- Updated dependencies [29d0ed3]
- Updated dependencies [29d0ed3]
- Updated dependencies [1b40780]
- Updated dependencies [d11fa8c]
- Updated dependencies [ca426cb]
- Updated dependencies [4ad3ce5]
- Updated dependencies [8016a9d]
- Updated dependencies [df9d07e]
- Updated dependencies [8eac321]
- Updated dependencies [a5a781b]
- Updated dependencies [9a7838e]
- Updated dependencies [191e043]
- Updated dependencies [b12e16a]
- Updated dependencies [fbafb85]
- Updated dependencies [35450f0]
- Updated dependencies [1e8b628]
- Updated dependencies [12d1476]
- Updated dependencies [bd6dab0]
- Updated dependencies [14ccb1d]
- Updated dependencies [c0803b0]
- Updated dependencies [d117382]
- Updated dependencies [4bc3bec]
- Updated dependencies [1f949da]
- Updated dependencies [ecb7b44]
- Updated dependencies [41edf73]
- Updated dependencies [1c1144f]
- Updated dependencies [014863d]
- Updated dependencies [3983965]
- Updated dependencies [3230d66]
- Updated dependencies [0c910d5]
- Updated dependencies [9d13b5f]
- Updated dependencies [317cddd]
- Updated dependencies [b2e7870]
- Updated dependencies [fec87e7]
- Updated dependencies [c28f317]
- Updated dependencies [2e10c9a]
- Updated dependencies [dac99c2]
- Updated dependencies [0d3ea29]
- Updated dependencies [67b669e]
- Updated dependencies [0253192]
- Updated dependencies [0253192]
- Updated dependencies [48cca4a]
- Updated dependencies [bfc15d2]
- Updated dependencies [2ff0825]
- Updated dependencies [7aa8d51]
- Updated dependencies [95a8435]
- Updated dependencies [60bcfe7]
- Updated dependencies [66949b7]
- Updated dependencies [d112087]
- Updated dependencies [4806b18]
- Updated dependencies [1802315]
- Updated dependencies [06cc45d]
- Updated dependencies [8c5aa50]
- Updated dependencies [7de0265]
- Updated dependencies [7895671]
- Updated dependencies [b389e43]
- Updated dependencies [c8b062f]
- Updated dependencies [117d34d]
- Updated dependencies [6729e10]
- Updated dependencies [1920cf3]
- Updated dependencies [41d0d40]
- Updated dependencies [c52bfb4]
- Updated dependencies [f9b4217]
- Updated dependencies [eebaf3b]
- Updated dependencies [c7d6037]
- Updated dependencies [72b26ed]
- Updated dependencies [2d21b9c]
- Updated dependencies [f66fdc7]
- Updated dependencies [9fdb127]
- Updated dependencies [615c696]
- Updated dependencies [968acc8]
- Updated dependencies [111ffff]
- Updated dependencies [12b9daf]
- Updated dependencies [7958bdf]
- Updated dependencies [d85615d]
- Updated dependencies [6a06e3b]
- Updated dependencies [0e9e7b7]
- Updated dependencies [0af4f66]
- Updated dependencies [9a0401f]
- Updated dependencies [9c93ce6]
- Updated dependencies [77a94d8]
- Updated dependencies [ac9f8bd]
- Updated dependencies [879bd38]
- Updated dependencies [04e776b]
- Updated dependencies [1c563af]
- Updated dependencies [a7df552]
- Updated dependencies [2f70c22]
- Updated dependencies [78f841b]
- Updated dependencies [c565813]
- Updated dependencies [d5a14dd]
- Updated dependencies [93125ae]
- Updated dependencies [56c8844]
- Updated dependencies [5cfd866]
- Updated dependencies [d4680d2]
- Updated dependencies [cdeabec]
- Updated dependencies [d7c5c33]
- Updated dependencies [a87d8be]
- Updated dependencies [15ec50e]
- Updated dependencies [db4c45b]
- Updated dependencies [51290bc]
- Updated dependencies [ad381fd]
- Updated dependencies [4e4111c]
- Updated dependencies [2b61f2d]
- Updated dependencies [8f2e808]
- Updated dependencies [3b49318]
- Updated dependencies [4e9fe9f]
- Updated dependencies [9ad3d24]
- Updated dependencies [326a90a]
- Updated dependencies [9fe7448]
- Updated dependencies [2e11d90]
- Updated dependencies [0b7ba4d]
- Updated dependencies [4578c56]
- Updated dependencies [c512c25]
- Updated dependencies [215e662]
- Updated dependencies [3d886ee]
- Updated dependencies [d8d0711]
- Updated dependencies [a45d5d8]
- Updated dependencies [b15f8a1]
- Updated dependencies [f6e1d49]
- Updated dependencies [e9a1f5c]
- Updated dependencies [40a6ee5]
- Updated dependencies [5910b5e]
- Updated dependencies [7098aca]
- Updated dependencies [97610a5]
- Updated dependencies [081e6a0]
- Updated dependencies [1884948]
- Updated dependencies [3089848]
- Updated dependencies [e23eccb]
- Updated dependencies [ac8f2c5]
- Updated dependencies [746637e]
- Updated dependencies [db9cf80]
- Updated dependencies [e75dced]
- Updated dependencies [9af0005]
- Updated dependencies [440bed6]
- Updated dependencies [b2549a8]
- Updated dependencies [ee8751d]
- Updated dependencies [96e4be4]
- Updated dependencies [194a42d]
- Updated dependencies [35ef501]
- Updated dependencies [faf6348]
- Updated dependencies [557ae7c]
- Updated dependencies [6a3fe25]
- Updated dependencies [7731d70]
- Updated dependencies [3073b72]
- Updated dependencies [c76edeb]
- Updated dependencies [5b12503]
- Updated dependencies [514bf3c]
- Updated dependencies [20e7d52]
- Updated dependencies [b3a3634]
- Updated dependencies [3e72f93]
- Updated dependencies [f89b5f5]
- Updated dependencies [d25b187]
- Updated dependencies [0e00d36]
- Updated dependencies [d748ae8]
- Updated dependencies [dab6bf4]
- Updated dependencies [ed1de8c]
- Updated dependencies [a00cf99]
- Updated dependencies [a00cf99]
- Updated dependencies [5fb1746]
- Updated dependencies [29a163f]
- Updated dependencies [e223152]
- Updated dependencies [9f5eca5]
- Updated dependencies [9963322]
- Updated dependencies [b27b894]
- Updated dependencies [874a38d]
- Updated dependencies [02d9f69]
- Updated dependencies [f53f14b]
- Updated dependencies [a800912]
- Updated dependencies [d973c34]
- Updated dependencies [156ddfa]
- Updated dependencies [5081090]
- Updated dependencies [b6eb25f]
- Updated dependencies [165587e]
- Updated dependencies [e04759d]
- Updated dependencies [ea9fd99]
- Updated dependencies [b32ee3e]
- Updated dependencies [91f46d0]
- Updated dependencies [e5899a6]
- Updated dependencies [d7b26df]
- Updated dependencies [490cb6d]
- Updated dependencies [e865300]
- Updated dependencies [ec7c7e0]
- Updated dependencies [ec7c7e0]
- Updated dependencies [c74d843]
- Updated dependencies [6d5191e]
- Updated dependencies [85edd61]
- Updated dependencies [e84aeb3]
- Updated dependencies [322ff1e]
- Updated dependencies [7b0a9c9]
- Updated dependencies [5fc57b3]
- Updated dependencies [fe58bbc]
- Updated dependencies [c4e7fa5]
- Updated dependencies [581ca7d]
- Updated dependencies [3f0b6f2]
- Updated dependencies [b7cd1af]
- Updated dependencies [9814035]
- Updated dependencies [55382dc]
- Updated dependencies [b1d701b]
- Updated dependencies [efcbac7]
- Updated dependencies [51f36e7]
- Updated dependencies [31b5a5f]
- Updated dependencies [20028df]
- Updated dependencies [69d4218]
- Updated dependencies [5ce6773]
- Updated dependencies [9432bac]
- Updated dependencies [3f69471]
- Updated dependencies [87e902d]
- Updated dependencies [8bc7836]
- Updated dependencies [e5687cb]
- Updated dependencies [1e62f71]
- Updated dependencies [777eed2]
- Updated dependencies [ec7f7f8]
- Updated dependencies [038d4c9]
- Updated dependencies [147a0d1]
- Updated dependencies [1959aac]
- Updated dependencies [ed03834]
- Updated dependencies [e1deaef]
- Updated dependencies [3071d3e]
- Updated dependencies [1badd31]
- Updated dependencies [55828c5]
- Updated dependencies [7856110]
- Updated dependencies [9b37edb]
- Updated dependencies [4216796]
- Updated dependencies [a22e67b]
- Updated dependencies [5f37d36]
- Updated dependencies [62ce45d]
- Updated dependencies [39e93ef]
- Updated dependencies [02bec6c]
- Updated dependencies [719183f]
- Updated dependencies [c40a0dd]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [8464380]
- Updated dependencies [252a582]
- Updated dependencies [f931e76]
- Updated dependencies [1912af4]
- Updated dependencies [e5f9f01]
- Updated dependencies [76815b9]
- Updated dependencies [4d1e4a8]
- Updated dependencies [4cc3ff9]
- Updated dependencies [c056979]
- Updated dependencies [4f68ba1]
- Updated dependencies [107853c]
- Updated dependencies [543b33d]
- Updated dependencies [b529a5c]
- Updated dependencies [1623faf]
- Updated dependencies [b4d573a]
- Updated dependencies [3c1a046]
- Updated dependencies [87d0619]
- Updated dependencies [4e0838d]
- Updated dependencies [60f9baf]
- Updated dependencies [f5ef054]
- Updated dependencies [584e737]
- Updated dependencies [37510aa]
- Updated dependencies [c857a93]
- Updated dependencies [345d1be]
- Updated dependencies [430e5f5]
- Updated dependencies [14a13bc]
- Updated dependencies [ca0bdbc]
- Updated dependencies [301eec6]
- Updated dependencies [572ecfb]
- Updated dependencies [5547ad4]
- Updated dependencies [707b3cd]
- Updated dependencies [6673c80]
- Updated dependencies [0f05907]
- Updated dependencies [5e725b8]
- Updated dependencies [086fa46]
- Updated dependencies [eeb95f7]
- Updated dependencies [d89f491]
- Updated dependencies [dc39326]
- Updated dependencies [775ed65]
- Updated dependencies [e4ec6ec]
- Updated dependencies [b1e9280]
- Updated dependencies [05ab9ef]
- Updated dependencies [1d79556]
- Updated dependencies [07b27b3]
- Updated dependencies [d0c09e4]
- Updated dependencies [3fed1eb]
- Updated dependencies [1692cd1]
- Updated dependencies [73c7dc4]
- Updated dependencies [8693110]
- Updated dependencies [ad5a7d7]
- Updated dependencies [dd29bbe]
- Updated dependencies [dd29bbe]
- Updated dependencies [6f21216]
- Updated dependencies [2372e0a]
- Updated dependencies [5afa1e0]
- Updated dependencies [56b2612]
- Updated dependencies [1418de4]
- Updated dependencies [7a96bf8]
- Updated dependencies [a35f7a6]
- Updated dependencies [daafae6]
- Updated dependencies [3f0a307]
- Updated dependencies [5fd2c76]
- Updated dependencies [be48c5e]
- Updated dependencies [57994c3]
- Updated dependencies [23e689d]
- Updated dependencies [bc0538a]
- Updated dependencies [f606ba2]
- Updated dependencies [d176b0a]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [c5dd7fc]
- Updated dependencies [ee0e115]
- Updated dependencies [4feb2d0]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [1ac24f2]
- Updated dependencies [0a052e6]
- Updated dependencies [462dff3]
- Updated dependencies [8044f4d]
- Updated dependencies [ae0ca66]
- Updated dependencies [c03077e]
- Updated dependencies [23d0bc7]
- Updated dependencies [069fd40]
- Updated dependencies [941c78a]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [30ce56e]
- Updated dependencies [2e0e451]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [77efc66]
- Updated dependencies [6422da5]
- Updated dependencies [8f4260f]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [f7af839]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [a237d7f]
- Updated dependencies [4ffdebe]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [e246f06]
- Updated dependencies [a65a59b]
- Updated dependencies [b0a1df0]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [45e6001]
- Updated dependencies [e46ce7b]
- Updated dependencies [a19b2a7]
- Updated dependencies [9f024d8]
- Updated dependencies [2ac0616]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [99e9d29]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [8baeda5]
- Updated dependencies [fa26308]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [62e2b6d]
- Updated dependencies [01fafde]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [26501ae]
- Updated dependencies [31e7d0b]
- Updated dependencies [94e60c0]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [cf540a7]
- Updated dependencies [adb7910]
- Updated dependencies [f573976]
- Updated dependencies [f573976]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [4d12b23]
- Updated dependencies [ff48407]
- Updated dependencies [b7a688e]
- Updated dependencies [ef1fcb2]
- Updated dependencies [ace0a53]
- Updated dependencies [8311650]
- Updated dependencies [de70e97]
- Updated dependencies [74c4b34]
- Updated dependencies [e040b8c]
- Updated dependencies [f451a59]
- Updated dependencies [ba95607]
- Updated dependencies [b53b949]
- Updated dependencies [ea9fd99]
- Updated dependencies [1e44436]
- Updated dependencies [2acff87]
- Updated dependencies [299a2c6]
- Updated dependencies [325a92e]
- Updated dependencies [e23eccb]
- Updated dependencies [bf492c8]
- Updated dependencies [c7a3234]
  - @objectstack/core@18.0.0
  - @objectstack/spec@18.0.0
  - @objectstack/platform-objects@18.0.0
  - @objectstack/types@18.0.0

## 18.0.0-next.5

### Patch Changes

- Updated dependencies [fa26308]
- Updated dependencies [01fafde]
- Updated dependencies [26501ae]
- Updated dependencies [94e60c0]
- Updated dependencies [adb7910]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [4d12b23]
- Updated dependencies [ff48407]
- Updated dependencies [b7a688e]
  - @objectstack/spec@18.0.0-next.5
  - @objectstack/platform-objects@18.0.0-next.5
  - @objectstack/core@18.0.0-next.5
  - @objectstack/types@18.0.0-next.5

## 18.0.0-next.4

### Minor Changes

- d65826f: fix: framework writes on tenant-column objects name the organization they can derive (ADR-0131 D9)
  
  Clause-②: yes (widening)
  
  A write on a tenant-column object with no organization is derived under `single` and refused under a wall (ADR-0131 D9). Before the engine stops letting such writes through, each of these producers now names the organization it can derive itself. Under `single` that is the Default Organization, which is the owner the engine would derive anyway, so no reader changes. Under a wall the row names an organization only where the producer has one. The rows it cannot attribute are written exactly as before.
  
  - **`@objectstack/plugin-auth`.** The self-registration grant (`sys_user_permission_set`) and the auth mails about a user (verification, password reset, account invitation, magic link, change-email notice → `sys_email`) read one derivable organization: the `tenancy` service's `defaultOrgId()`. Under `single` that is the Default Organization. Under a wall it is none, because the registrant belongs to no organization yet. The verification and reset mails used to persist with no organization even under `single`.
  - **`@objectstack/plugin-audit`.** An activity row (`sys_activity`) about a record with no organization of its own (a `sys_user`, a platform setting), written with no session organization (a sign-up), takes the Default Organization under `single`. The record's own organization and then the session's still win. The ledger's `tenant_id` attribution is unchanged. New optional `AuditWriterOptions.getDefaultOrganizationId()`; `AuditPlugin` wires it to the `tenancy` service.
  - **`@objectstack/service-settings`.** The `sys_secret` ciphertext and the `sys_setting_audit` history row of a `tenant` or `user` value carry that value's organization, which is the same owner as its `sys_setting` row. A `global` value's rows name none. New optional `organization_id` on `SettingsSecretStore.insert`'s row and `organizationId` on `SettingsAuditWriter.write`'s entry; the built-in writers persist them. A failed `sys_setting_audit` write is now reported at `error`, not `warn`: the settings write succeeds while its history row is lost. The first report names the consequence and the fix. `buildSettingAuditWriter`'s optional logger argument keeps every sink it accepted (none, `{}`, or one with an optional `warn`) and additionally takes a sink that carries `error`. It reports through `error` when the sink has it, else through `warn`.
  - **`@objectstack/verify`.** The RLS probe and position personas' grants (`sys_user_permission_set`, `sys_user_position`) belong to the organization the persona is a member of (the Default Organization under `single`). They used to be written with an explicit `organization_id: null`. A persona that belongs to no organization, or to several, names none.

### Patch Changes

- 0c3db0f: The settings routes' identity door resolves through `@objectstack/core`'s `resolveRequestExecutionContext`, the one request-to-`ExecutionContext` composition
  
  Clause-②: no
  
  - `SettingsServicePlugin` resolves the caller of every `/api/settings` route by calling `resolveRequestExecutionContext` with this door's differences as named parameters: `anonymous: 'fail-closed'`, `authGate: 'resolved'`, `credentials: 'api-key-and-session'`, `sessionApi: 'optional'`, `session: 'request'`, its own way to reach the `tenancy` service, `localization: 'withhold'`, no request locale, `accessToken: 'withhold'`, and no OAuth provenance or admission channel. The engine and auth-service lookups, the header normalisation, the tenancy wiring, the projection to `SettingsContext` and the fail-closed `catch` stay at the door.
  - The answers are the ones the door gave before: an anonymous caller, an unrecognised cookie, a failed session read and a refused API key get `401 UNAUTHENTICATED`; a session or an API key owner the authentication policy holds gets `403` with its code and message; an unreadable permission store or tenancy service gets `503 SERVICE_UNAVAILABLE`; and an API key its own lifecycle refuses gets its `403` and code. A one-off probe of 29 fault wirings through the listing route read the same answer on both sides of the change.
  - Nothing to do for a consumer: no export, route, configuration key or response shape changed.
- 04fd88a: Clause-②: no
  
  fix(service-settings): the Setup settings pages name the organization or the environment where they said "workspace"
  
  - **What changed.** The built-in settings manifests and their en, zh-CN, ja-JP and es-ES bundles no longer say "workspace" (工作区, ワークスペース, espacio de trabajo). Each string now uses the noun for what the setting belongs to:
    - **Organization** (组织 / 組織 / organización): the Branding name field, now **Organization name**, and the Branding description; the Company legal-name help; the Feature Flags description. These settings are stored once per organization.
    - **Environment** (环境 / 環境 / entorno): the Provider section of Mail and of SMS. These settings are stored once for the running instance.
    - Authentication, New user membership: the help now names the explicit act as **creating an organization**.
  - **Unchanged:** every setting key, including `branding.workspace_name` and its `OS_BRANDING_WORKSPACE_NAME` override; stored values; the Settings hub `category` values; the keys and shape of the translation bundles; and the exports. Only the text a reader sees changed.
- 44a5011: Clause-②: no
  
  Refusals and Setup help text that a user reads inside the running system no longer call that system
  "this environment". They say "this system", or they drop the noun.
  
  - `@objectstack/plugin-auth`: the two self-registration refusals drop the noun ("Self-registration is
    closed (audience posture invite_only).", "Self-registration is limited to approved email domains, …").
    So do the OAuth self-service `503` ("OIDC provider is not enabled") and the SSO `400`
    `DOMAIN_VERIFICATION_DISABLED` ("Domain verification is not enabled (set
    OS_SSO_DOMAIN_VERIFICATION)."). The last-administrator guard's refusals and its two warning lines say
    "this system", including "nobody able to administer the system". The OIDC authorize-gate refusal
    (`403 ENV_ACCESS_DENIED`) keeps "this environment". Only the cloud control plane installs that gate,
    and there the noun names the environment a cloud user is signing in to.
  - `@objectstack/plugin-security`: the diagnostic `message` of the packaged-permission-set lock now reads
    "… is declared by package '…' and is locked — editing it here would …". The provenance-unknown
    refusal says "this system could not determine …". Both `userMessage` texts are unchanged.
  - `@objectstack/service-settings`: the Mail and SMS provider groups read "Choose how this system sends
    outbound email." and "… outbound SMS.". The Authentication audience group reads "Who may become a user
    of this system's apps.". The zh-CN, ja-JP and es-ES bundles change only the noun, to 本系统,
    このシステム and este sistema.
  
  Only the human-readable text moves. Every HTTP status, error code, settings key and response shape
  stays as it was.
- Updated dependencies [b2e7870]
- Updated dependencies [eebaf3b]
- Updated dependencies [194a42d]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [f5ef054]
- Updated dependencies [f7af839]
- Updated dependencies [a237d7f]
- Updated dependencies [b0a1df0]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [e46ce7b]
- Updated dependencies [a19b2a7]
- Updated dependencies [2ac0616]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [99e9d29]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [8baeda5]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [62e2b6d]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [31e7d0b]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [cf540a7]
- Updated dependencies [f573976]
- Updated dependencies [f573976]
  - @objectstack/core@18.0.0-next.4
  - @objectstack/spec@18.0.0-next.4
  - @objectstack/platform-objects@18.0.0-next.4
  - @objectstack/types@18.0.0-next.4

## 18.0.0-next.3

### Patch Changes

- 747c8e9: Clause-②: no
  
  fix(service-settings): the File Storage, Knowledge and AI settings pages show their warnings as `info_banner` callouts with `bannerSeverity: 'warning'`, not as a sentence inside a subtitle or a field's help text
  
  Four warnings were written into ordinary strings with a hand-typed warning glyph, so the admin read them as one more sentence of the page subtitle or of a toggle's help. Each one is now an `info_banner` row in the section it concerns, directly under the field it warns about:
  
  - `storage` — `adapter_switch_warning`, under the Adapter select: switching adapter does not migrate existing files.
  - `knowledge` — `adapter_switch_warning`, under the Adapter select: switching adapter does not migrate existing indices.
  - `knowledge` — `enforce_rls_warning`, under the Enforce RLS on search toggle: disabling it skips the vector-store leakage safeguard.
  - `ai` — `log_prompts_warning`, under the Log full prompts toggle: full prompts may leak PII.
  
  The namespace description or field help of each keeps its non-warning text. The translations moved with them: in the `en`, `zh-CN`, `ja-JP` and `es-ES` bundles each warning sentence left the `description` / `help` copy and sits under `settings.NAMESPACE.banners.BANNER_ID.{title,text}`, with a translated title per banner. The existing Feature Flags `beta_notice` banner gained the same copies, so no shipped locale reads it in English any more.
  
  No setting key, value, default or save behaviour changes. A host that renders `info_banner` rows from the manifest literals draws the English title and text; translated copy is read through `resolveSettingsBannerTitle` / `resolveSettingsBannerText` from `@objectstack/spec/system`.
- Updated dependencies [b15f8a1]
- Updated dependencies [4216796]
- Updated dependencies [c40a0dd]
- Updated dependencies [60f9baf]
- Updated dependencies [3fed1eb]
- Updated dependencies [a35f7a6]
- Updated dependencies [f606ba2]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [ee0e115]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [0a052e6]
- Updated dependencies [ae0ca66]
- Updated dependencies [23d0bc7]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [30ce56e]
- Updated dependencies [2e0e451]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [77efc66]
- Updated dependencies [6422da5]
- Updated dependencies [8f4260f]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [4ffdebe]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [e246f06]
- Updated dependencies [a65a59b]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [45e6001]
- Updated dependencies [9f024d8]
  - @objectstack/spec@18.0.0-next.3
  - @objectstack/platform-objects@18.0.0-next.3
  - @objectstack/core@18.0.0-next.3
  - @objectstack/types@18.0.0-next.3

## 18.0.0-next.2

### Minor Changes

- 0f05907: feat(spec,core,plugin-auth)!: an API key answers as its owner's session does when the ADR-0069 policy holds the account, the forced reset gets its own code and an explicit revocation switch
  
  Clause-②: yes (narrowing) — the published contract widens (the posture codes become a closed vocabulary with a declared scope, a new `PASSWORD_RESET_REQUIRED` code, a per-user posture member on the auth service contract, new `@objectstack/core` exports) and the API-key door narrows (a key whose owner holds an account-scope posture is refused where it was served).
  
  <!-- adr-0087: not-required (no-migration-prescription) An authentication-policy change at the API-key admission seam plus one new error code, not a metadata change. No authorable spec key, stored shape or metadata surface is removed or renamed, so `objectstack migrate meta` has nothing to rewrite. `ExecutionContext.authGate.code` narrows from a bare string to the closed posture vocabulary, but that field is server-constructed only and never authored; its one producer already wrote only members of it. What narrows is which API keys are served (a key whose owner owes MFA enrolment is refused with 403 MFA_REQUIRED), and the administrator-forced password change answers its own code. The packages publish (not unpublished), no ADR-0087 id covers this and none is added (not registered or already-registered). -->
  
  **BREAKING** (an accept-set narrowing at the API-key door, and a changed code for the administrator-forced password change), shipped as `minor` under the launch-window convention for breaking changes.
  
  Ruling C′ on #23287: posture codes are a closed vocabulary, and each code declares what it holds.
  
  - **The vocabulary and its scope (`@objectstack/spec/kernel`).** `AuthGateCodeSchema` is the closed set of codes an `authGate` may carry: `PASSWORD_EXPIRED`, `PASSWORD_RESET_REQUIRED` and `MFA_REQUIRED`. `AUTH_GATE_SCOPES` declares each code's scope once: `MFA_REQUIRED` holds the **account** (every credential of the user); `PASSWORD_EXPIRED` and `PASSWORD_RESET_REQUIRED` hold the **credential** (password sign-in alone). `ExecutionContext.authGate.code` is typed against the vocabulary, and `PASSWORD_RESET_REQUIRED` is registered for `@objectstack/plugin-auth` in the error-code ledger.
  - **One per-user posture computation (`@objectstack/plugin-auth`, `IAuthService.resolveUserAuthGates`).** It answers every posture a user holds, most urgent first, keyed by user id and the organization the credential operates in. The session gate shows its first entry, as before.
  - **One judgment at the shared key-admission seam (`@objectstack/core`).** `resolveApiKeyAdmission` asks that computation for the key's owner and holds the key on an account-scope posture (a new `held` outcome). `resolveAuthzContext` resolves a held key as a held principal: the owner, `credential: 'api_key'`, and the posture on `authGate`. Both new inputs are optional (`userAuthGates`), and `userAuthGateSourceOf(authService)` binds one from an auth service.
  - **REST and the runtime dispatcher** judge a key-admitted request by the key's answer, and re-read the session cookie for the gate only when a session admitted the caller. The declared-endpoint fallback does the same.
  - **The raw-host families** take the same answer through the shared seam: datasource admin, share links, settings, and the storage family's door. The webhook-redeliver door admits no API key at all, and still does not.
  - **The forced reset (`POST /api/v1/auth/admin/set-user-password`, the `set_user_password` action).** `must_change_password` now answers `PASSWORD_RESET_REQUIRED` instead of reusing `PASSWORD_EXPIRED`. The act carries `revokeSessionsAndKeys`, **on by default**: it ends every live session of the user and revokes every API key they own, and the response reports what landed (`revoked: { sessions, apiKeys, failed, complete }`).
  
  What changes for you:
  
  - **Refused now:** an API key whose owner owes MFA enrolment past the grace window gets `403 MFA_REQUIRED`, with the message the session gets, on every face that admits keys. It works again the moment the owner enrols, with nothing reissued: the refusal is not a revocation.
  - **Unchanged:** a key whose owner's password expired, or whose administrator forced a password change, keeps working. A session sent beside an API key no longer answers for the key.
  - **A forced password change answers `PASSWORD_RESET_REQUIRED`.** A client that recognises `PASSWORD_EXPIRED` to show its change-password flow should recognise `PASSWORD_RESET_REQUIRED` the same way.
  - **An administrator's password reset now signs the user out everywhere and revokes their API keys by default.** For a routine reset, pass `revokeSessionsAndKeys: false` (or clear the switch in the Set Password dialog). Revoked keys stay revoked after the password change; an administrator can restore a key a routine reset revoked with the Restore API Key action, or the owner mints a replacement.
  - **Hosts calling `resolveAuthzContext` or `resolveApiKeyAdmission` directly** pass `userAuthGates: userAuthGateSourceOf(authService)` to have the key's owner asked. Code switching exhaustively over `ApiKeyAdmission['outcome']` handles the new `held` outcome.
- 1d79556: feat(spec,core,runtime,plugin-auth)!: API keys get a lifecycle: a 90-day default expiry, a one-year ceiling, a 90-day inactivity expiry, a one-year grace for keys created with none, and distinct refusal codes
  
  Clause-②: yes (narrowing) — the published contract widens (four `auth` settings keys, the `IAuthService.resolveApiKeyLifecyclePolicy` member and its `ApiKeyLifecyclePolicy` type, four registered error codes, new `@objectstack/core` exports) and the API-key doors narrow (a signing past the ceiling is refused; an inactive key, a key past its grace, and a revoked or expired key sent beside a session are refused where they were served).
  
  <!-- adr-0087: not-required (no-migration-prescription) An authentication-policy change at the API-key signing door and the shared key-admission seam, not a metadata change. No authorable spec key, stored shape or metadata surface is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite: the four new `auth` settings keys are additive and defaulted, `sys_api_key` gains no column (its existing `expires_at` and `last_used_at` are written by the platform), and `ResolveAuthzInput.apiKeyLifecycle` / the sixth parameter of `resolveApiKeyAdmission` and `resolveApiKeyPrincipal` are server-side wiring no author writes. What narrows is which API keys are served and which signings are accepted; the remedy is a new key or a nearer date, never a rewrite of a package source or a stored row. The packages publish (not unpublished), no ADR-0087 id covers this and none is added (not registered or already-registered). -->
  
  **BREAKING** (an accept-set narrowing at the API-key doors), shipped as `minor` under the launch-window convention for breaking changes.
  
  Ruling A on #23367: the key store stays `sys_api_key`, and the policy is auth configuration.
  
  - **The policy (`@objectstack/plugin-auth`, `IAuthService.resolveApiKeyLifecyclePolicy`).** Three `auth` settings keys, bound by `bindAuthSettings`: `api_key_default_expiry_days` (90), `api_key_max_expiry_days` (365) and `api_key_inactivity_days` (90; `0` turns it off). A fourth, `api_key_policy_started_at`, is recorded once — on the first boot that runs the policy, at `kernel:bootstrapped` — and anchors the two clocks below; it survives restarts and is never overwritten by the platform.
  - **The signing door (`POST /api/v1/keys`).** A signing that names no `expires_at` gets the default life and the response echoes it. An `expires_at` further away than the ceiling is refused `400 API_KEY_EXPIRY_TOO_LONG`, naming the latest date allowed; exactly the ceiling is accepted. A kernel with no auth service signs as before.
  - **The key-admission seam (`resolveApiKeyAdmission`, `@objectstack/core`).** A real key its own state refuses is a new outcome, `lifecycle`, with one of three distinct codes: `API_KEY_REVOKED`, `API_KEY_EXPIRED` (past `expires_at`, or past the grace of a key created with none) or `API_KEY_INACTIVE` (no recorded use for longer than the window). `resolveAuthzContext` raises it as the branded `ApiKeyLifecycleRefusalError` (`403`, a located message naming the key's prefix, the date and the remedy). An unknown key is still `none`.
  - **`last_used_at` is written.** Its description promised "Automatically updated on each API call", and nothing wrote it. The seam now stamps it on an admitted (or held) call, at most once an hour per key, and the inactivity judgment reads the value as it was BEFORE that call's stamp, so a key's own use cannot revive it. A stamp that fails never fails the request; it is said once, at `error`.
  - **Keys created before the policy.** A key with no expiry gets one year from `api_key_policy_started_at`; the date is stamped onto its `expires_at` the first time it is admitted, so the keys page shows it, and the refusal after it names it. A key with no recorded use counts its inactivity from the same anchor (or from its own creation, when later) — never from an earlier `created_at`, since no use was ever recorded before the policy.
  - **Every face that admits keys** passes the policy source (`apiKeyLifecyclePolicySourceOf(authService)`, a required input beside `userAuthGates`). Every one of them answers the refusal's `403` and code: the runtime dispatcher (the MCP HTTP endpoint among its routes), the REST data API, the settings routes, the storage download routes, the datasource admin routes, the share-link routes, the marketplace install-local routes and the MCP stdio transport. Each relays the refusal by its brand, so every other identity fault at those doors keeps its existing answer.
  - **`OS_CLOUD_API_KEY` is untouched.** It is the runtime's outbound credential to the control plane, never admitted by this seam.
  
  What changes for you:
  
  - **A key created without an expiry now expires.** It used to live until revoked; it now lives 90 days (or the configured default). Pass `expires_at` to choose, and create a new key before it ends.
  - **A signing asking for more than a year is refused** `400 API_KEY_EXPIRY_TOO_LONG`, where it used to be accepted. Ask for the date the message names, or an earlier one.
  - **A key unused for 90 days is refused** `403 API_KEY_INACTIVE`, where it used to be served. It is not revoked; the remedy is a new key.
  - **A key that already existed with no expiry keeps working for one year** from the date the policy took effect on your deployment (`auth.api_key_policy_started_at`), then answers `403 API_KEY_EXPIRED` naming that date. Replace such keys within the year.
  - **A revoked or expired key answers its own code** (`403 API_KEY_REVOKED` / `API_KEY_EXPIRED`) on every face that accepts a key, where it used to answer the generic `401`; and a session cookie sent beside such a key no longer answers for it.
  - **Hosts calling `resolveAuthzContext`, `resolveApiKeyAdmission` or `resolveApiKeyPrincipal` directly** pass `apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(authService)` (or the sixth argument), or an explicit `undefined` where no auth service exists. A caller of `resolveAuthzContext` that wants the located answer re-raises `ApiKeyLifecycleRefusalError` (`isApiKeyLifecycleRefusalError`) the way it re-raises the store outage. Code switching exhaustively over `ApiKeyAdmission['outcome']` handles the new `lifecycle` outcome.

### Patch Changes

- Updated dependencies [0d3ea29]
- Updated dependencies [f9b4217]
- Updated dependencies [87d0619]
- Updated dependencies [4e0838d]
- Updated dependencies [584e737]
- Updated dependencies [301eec6]
- Updated dependencies [5547ad4]
- Updated dependencies [0f05907]
- Updated dependencies [086fa46]
- Updated dependencies [b1e9280]
- Updated dependencies [05ab9ef]
- Updated dependencies [1d79556]
- Updated dependencies [07b27b3]
- Updated dependencies [d0c09e4]
- Updated dependencies [1692cd1]
- Updated dependencies [73c7dc4]
- Updated dependencies [8693110]
- Updated dependencies [ad5a7d7]
- Updated dependencies [dd29bbe]
- Updated dependencies [dd29bbe]
- Updated dependencies [6f21216]
- Updated dependencies [2372e0a]
- Updated dependencies [5afa1e0]
- Updated dependencies [56b2612]
- Updated dependencies [1418de4]
- Updated dependencies [7a96bf8]
- Updated dependencies [daafae6]
- Updated dependencies [3f0a307]
- Updated dependencies [5fd2c76]
- Updated dependencies [be48c5e]
- Updated dependencies [57994c3]
- Updated dependencies [23e689d]
- Updated dependencies [bc0538a]
- Updated dependencies [d176b0a]
- Updated dependencies [c5dd7fc]
- Updated dependencies [4feb2d0]
- Updated dependencies [1ac24f2]
- Updated dependencies [462dff3]
- Updated dependencies [8044f4d]
- Updated dependencies [c03077e]
- Updated dependencies [069fd40]
- Updated dependencies [941c78a]
  - @objectstack/platform-objects@18.0.0-next.2
  - @objectstack/spec@18.0.0-next.2
  - @objectstack/core@18.0.0-next.2
  - @objectstack/types@18.0.0-next.2

## 18.0.0-next.1

### Minor Changes

- bae5841: fix(service-settings)!: the settings route family refuses a session the ADR-0069 authentication policy holds, and `SettingsContext` declares the posture as an optional `authGate`
  
  Clause-②: yes (narrowing) — an optional `authGate` on the exported `SettingsContext` widens the public surface; the family door's refusal of a held session narrows what it answers.
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at one family of routes mounted directly on the host server, plus one additive optional field on an exported runtime type; not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped. `SettingsContext` gains `authGate?`, typed by `@objectstack/core`'s existing `AuthGate`; every context that type-checked before type-checks unchanged, and a resolver that never sets the field gets the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which sessions the family serves: a session whose user carries the ADR-0069 posture (an expired password, or enforced MFA not yet enrolled) is now refused with the gate's 403 before any settings logic runs. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); the type change is a widening, not the removal or narrowing those categories describe (not runtime-interface-only / type-surface-only); and no runtime export is retired (not runtime-export-retired). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  ADR-0069 holds a signed-in user out of every protected resource while their password has expired or while enforced MFA is not yet enrolled, until they remediate. REST, the runtime dispatcher and the four sibling families already refuse such a session. The settings family (`registerSettingsRoutes`) resolves its own caller and never asked, so it served a held session as an ordinary signed-in caller.
  
  - **`SettingsContext.authGate`** (new, optional): the caller's posture, `{ code, message }`, the same shape and meaning as `ExecutionContext.authGate`. Present only while the session is held.
  - **The family door** asks the shared decision (`evaluateAuthGate`, `@objectstack/core`) about the context it resolved, on every route, before the anonymous floor and before any settings logic.
  - **`SettingsServicePlugin`'s resolver** puts the posture on the context through the shared reader (`normalizeAuthGate`), from the same session read that resolves the caller.
  
  - **Refused now:** a held session gets `403` with the gate's own `code` (`PASSWORD_EXPIRED` or `MFA_REQUIRED`) and `message`, in the family's declared error envelope. This is the answer REST gives the same session.
  - **Unchanged:** a session the policy does not hold is served exactly as before, an API-key caller is unaffected because it has no session to hold, an anonymous caller gets the same `401`, and a CORS preflight is answered as before.
  
  What changes for you. A user the policy holds must remediate (change the password, or enroll an authenticator) before the settings routes answer them, as on every other protected route. With `SettingsServicePlugin` nothing needs configuring. If you mount `registerSettingsRoutes` yourself with your own `contextFromRequest`, a resolver that sets no `authGate` behaves exactly as before; set `authGate` on the context it returns for a held session (`normalizeAuthGate(session.user)` from `@objectstack/core` reads it), and the door refuses on that field.

### Patch Changes

- 66949b7: feat(plugin-security)!: the four security-catalog row objects are retired — `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability` (ADR-0131 D3)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered catalog-row-objects-retired -->
  
  **BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.
  
  Positions, permission sets and capabilities live in the security catalog — the environment registry, fed by package declarations and by environment metadata saved through `/api/v1/meta` (ADR-0131 D3). The four row objects that mirrored them are no longer registered, so their data and REST routes and their Setup object pages are gone. No table is dropped and no row is deleted.
  
  FROM → TO:
  
  - `GET|POST|PATCH|DELETE /api/v1/data/sys_permission_set` → `GET|PUT|DELETE /api/v1/meta/permission/:name`; to copy a set, `POST /api/v1/security/permission-sets/:name/clone` with `{ name, label }`.
  - `… /api/v1/data/sys_position` → `/api/v1/meta/position/:name`. A position's permission sets are its definition's `permissionSets`.
  - `… /api/v1/data/sys_position_permission_set` → the position definition's `permissionSets` (`PUT /api/v1/meta/position/:name`).
  - `… /api/v1/data/sys_capability` → read-only `GET /api/v1/meta/capability`; a package declares a capability with `defineCapability` (`stack.capabilities`).
  - Setup → Access Control → Positions / Capabilities / Permission Sets now open Setup's catalog lists (`/apps/setup/metadata/<type>?scope=environment`) instead of the object pages; the `sys_position` record page (`SysPositionDetailPage`) is removed.
  - An object permission on one of the four names in a permission set grants nothing and can be deleted.
  
  What else changes:
  
  - `sys_user_permission_set.permission_set_id` is a plain text column now, not a lookup: same column, same stored ids, same indexes. It is not written and grants nothing; a grant names its set by `permission_set`.
  - A permission set saved through the metadata door is written to no row: the `permission` mutation projector, the `sys_permission_set` and `sys_position` data-door write-throughs and the row-only position backfill are no longer registered.
  - On a fresh `single`-posture database the first human is promoted to platform administrator without reading any catalog row. An unscoped grant written before `sys_user_permission_set.permission_set` existed (it names no set) still withholds the promotion until the organization-ownership migration names it.
  - Uninstalling a package still revokes every grant naming a permission set the package declared, by the names the uninstalling door captures before the withdrawal (`declared`, `captureUninstallDeclared`), and now by those names alone: the cleanup reads and removes no `sys_permission_set` or `sys_position_permission_set` row, so the `sets` and `positionBindings` counts on its outcome are always 0. A grant written before `sys_user_permission_set.permission_set` existed names no set and is not reached; the organization-ownership migration names it.
  - On a `group` or `isolated` deployment the data-door half of the walled catalog refusal goes with the objects: a data-door insert, update or delete on `sys_position`, `sys_permission_set` or `sys_capability` answers `404 OBJECT_NOT_FOUND` for every caller instead of `403 PERMISSION_DENIED` below the platform operator. The refusal at the `/meta` write doors, the permission-set clone door and the `/packages` write doors is unchanged.
  - `capability-reference-unknown` no longer counts a `sys_capability` seed row as a declared capability — no runtime reader consults one. Declare the capability with `defineCapability`.
  - On an existing database `os migrate plan`'s unmanaged-table sweep now lists the `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability` tables: they keep their rows and no object declares them any more. The sweep only reports; nothing is dropped, and the tables stay for the organization-ownership migration.
  
  Removed exports, no replacement:
  
  - `@objectstack/plugin-security`: the object definitions `SysPosition`, `SysPermissionSet`, `SysPositionPermissionSet`, `SysCapability` (from `./objects`); `securityObjects` lists the remaining three.
  - `@objectstack/platform-objects/pages`: `SysPositionDetailPage`.
  - `@objectstack/spec`: `SystemObjectName.POSITION`, `SystemObjectName.PERMISSION_SET`; the four names leave `PLATFORM_OBJECTS_BY_PACKAGE['plugin-security']` and `PLATFORM_PROVIDED_OBJECT_NAMES`.
  - `@objectstack/core`: `isRowActive` and `ActivatableRow` — a catalog row's `active` column decides nothing; deactivation is the activation ledger's (`sys_metadata_activation`).
  - `@objectstack/objectql`: the published `PLATFORM_OBJECT_TENANCY` record loses its `sys_permission_set` key (the other three names were never in it). A removed key of an exported constant is a narrowing, so `@objectstack/objectql` takes `minor` under the launch-window convention for breaking changes.
- 3c1a046: fix: a route's catch-all `500` answers its own generic text, never the caught error's message, and `@objectstack/types` exports the writer that does it, `sendServerFault`
  
  Clause-②: yes (widening) — `@objectstack/types` gains one export, `sendServerFault`; nothing is removed, renamed or narrowed, and no response field changes shape.
  
  A declared 5xx does not carry the text of the error it caught: that text can name server internals, such as a path, a host or a table. The REST layer already withheld it. The storage, settings and i18n route families and the share-link routes answer in the nested `{ success: false, error: { code, message } }` envelope and did not: their catch-all `500` sent the caught error's message to the caller.
  
  - **What a caller now reads.** The same `status` and `code` as before, with the route's own generic text as `error.message`: `Internal error` on the storage and i18n routes, the route's message on the settings routes (`Failed to list manifests`, `Failed to read namespace`, `Failed to write namespace`, `Action failed`), and the route's `Failed to …` message on the share-link routes. On the storage routes this includes the metadata store's outage sentence, which an operator now reads in the server log.
  - **What the operator reads.** The original error, stack included, in one `[5xx]` server-fault line. The storage byte routes, which already withheld the text, logged two lines per fault and now log one. A line names the mounted route pattern when the route passes one, never the request URL.
  - **Unchanged.** Every `4xx` answer. The settings `SETTINGS_CRYPTO_UNAVAILABLE` refusal, which keeps its prescription. The authorization-store outage `503`, which keeps its declared code and message. The storage `501 NOT_IMPLEMENTED` answers. On the share-link routes, any error that declares its own `status` keeps the envelope it declares.
  - **`sendServerFault(res, status, code, message, thrown, request?)`** (new, `@objectstack/types`): writes `message` in the declared envelope, and hands `thrown` to the server-fault log with its stack, as the fault's one line. Use it for an arm that answers a caught fault. Keep `sendError` for a `4xx` and for a `5xx` whose text you wrote for the reader. `request` is the mounted route pattern, never the request URL.
- Updated dependencies [dac99c2]
- Updated dependencies [66949b7]
- Updated dependencies [7958bdf]
- Updated dependencies [87e902d]
- Updated dependencies [777eed2]
- Updated dependencies [ed03834]
- Updated dependencies [5f37d36]
- Updated dependencies [1912af4]
- Updated dependencies [76815b9]
- Updated dependencies [4d1e4a8]
- Updated dependencies [4cc3ff9]
- Updated dependencies [c056979]
- Updated dependencies [4f68ba1]
- Updated dependencies [107853c]
- Updated dependencies [543b33d]
- Updated dependencies [b529a5c]
- Updated dependencies [1623faf]
- Updated dependencies [b4d573a]
- Updated dependencies [3c1a046]
- Updated dependencies [37510aa]
- Updated dependencies [c857a93]
- Updated dependencies [345d1be]
- Updated dependencies [430e5f5]
- Updated dependencies [14a13bc]
- Updated dependencies [ca0bdbc]
- Updated dependencies [572ecfb]
- Updated dependencies [707b3cd]
- Updated dependencies [6673c80]
- Updated dependencies [5e725b8]
- Updated dependencies [eeb95f7]
- Updated dependencies [d89f491]
- Updated dependencies [dc39326]
- Updated dependencies [775ed65]
- Updated dependencies [e4ec6ec]
- Updated dependencies [325a92e]
  - @objectstack/spec@18.0.0-next.1
  - @objectstack/platform-objects@18.0.0-next.1
  - @objectstack/core@18.0.0-next.1
  - @objectstack/types@18.0.0-next.1

## 18.0.0-next.0

### Minor Changes

- 6729e10: feat(plugin-audit,plugin-security)!: the compliance ledger `sys_audit_log` loses its injected organization column; the organization a row is about stays in `tenant_id`, and an organization reader is scoped on it by a platform row policy (ADR-0131 D7)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered sys-audit-log-organization-column-retired -->
  
  **BREAKING**, shipped as `minor` under the repo's convention for breaking changes on this line.
  
  Some ledger rows are about deployment-level actions no organization owns: a change of platform-administrator standing at boot, a change to a global setting, plugin-auth's administrative user writes. An injected organization column made the tenant wall the ledger's anchor, so under a walled posture those rows were hidden from every reader, platform administrators included. ADR-0131 D7 takes the column off: the ledger is governed by object permission, and the organization a row is about is the plain attribution field `tenant_id`, which the tenant-field resolver does not claim.
  
  - **`sys_audit_log`** (`@objectstack/plugin-audit`) declares `systemFields: { tenant: false }`, so the registry injects no `organization_id` and a new table is provisioned without it. `tenant_id` (a lookup to `sys_organization`) is unchanged and is the only organization column. The record mirror, the record-view writer and the sign-in writer stamp it as before and no longer stamp `organization_id`. A write that still names `organization_id` on the ledger is refused `INVALID_FIELD`, and a filter on it `INVALID_FILTER`.
  - **The read scope** (`@objectstack/plugin-security`, the shipped permission sets): a platform row policy, `sys_audit_log_org` (`tenant_id == current_user.organization_id`), in `organization_admin` (and its no-bypass variant), `member_default` and `viewer_readonly`. `organization_admin` also names `sys_audit_log` explicitly, read only and without `viewAllRecords` / `modifyAllRecords`: its wildcard's superuser bypass would otherwise skip the policy on an object with no tenant column. Under an organization wall an organization administrator or viewer reads the rows about its active organization; a platform administrator (`admin_full_access`) reads every row, the rows about no organization included. Under `single` the policy is stripped by provenance (ADR-0105 D3), as every platform tenant policy is.
  - **`config_change` rows** (`@objectstack/service-settings`): a GLOBAL-scope settings change is about no organization, so its ledger row carries no `tenant_id`, whatever organization the writing session had active. Tenant- and user-scope changes keep the writer's organization. The settings writer and plugin-security's platform-admin standing writer no longer probe for or stamp `organization_id`.
  - **Retention** (`@objectstack/objectql`): a tenant-scope `lifecycle.retention_overrides` window on `sys_audit_log` partitions the reaper's and the archiver's passes on `tenant_id`, and the global pass keeps the rows with no `tenant_id`.
  - **`view_all_audit_log`**: its description (`@objectstack/spec/security`) now names the row scope it does not lift; the capability still lifts only the parent-record read gate.
  
  **What moves for consumers.**
  
  - **Authored references.** A filter, list-view column, report grouping, formula or seed key that names `organization_id` on `sys_audit_log` names `tenant_id` instead; the two held the same value on every row a writer wrote.
  - **Who reads what, under a wall.** A platform administrator now also reads the rows about no organization, global settings changes included. An organization administrator reads exactly its active organization's rows. Under the `group` posture an organization reader is scoped to the ACTIVE organization's rows, not the union of its memberships. A permission set an application ships that grants `viewAllRecords` on the ledger (directly or through a wildcard) skips the row policy, as it skips Layer 1 on every object the wall does not cover.
  - **Who reads what, under `single`.** The row policy is stripped under `single` (ADR-0105 D3), as every platform tenant policy is. So a deployment that holds more than one organization under `single` serves every organization's ledger rows to every ledger reader. The remedy is a walled posture.
  - **Existing databases — nothing moves automatically** (ADR-0131 D14). Schema sync is additive: the physical `organization_id` column stays and the boot drift report names it orphaned. The v18 upgrade ceremony confirms its values equal `tenant_id` and drops it (`os migrate apply --allow-destructive`), reporting any row where they differ.
- c52bfb4: feat(service-settings,platform-objects)!: the settings cascade's global rung moves to the tenant-less `sys_platform_setting`, and `sys_setting.scope` no longer declares `global` (ADR-0131 D7)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered sys-setting-global-rung-moved -->
  
  **BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes (Changesets pre mode is not on yet).
  
  A settings value for a key declared at `global` scope is a deployment-wide value: the mail transport, the SMS, storage, AI and knowledge providers, auth policy, the lifecycle retention defaults. It used to be a `scope: 'global'` row of `sys_setting`, a tenant-scoped table, where the injected `organization_id` column only ever held NULL and a walled posture hid the row from every reader. ADR-0131 D7 moves the rung out: it is now stored in a new platform object, `sys_platform_setting`.
  
  - **`sys_platform_setting`** (registered by the settings service, beside `sys_setting`): one row per `(namespace, key)` for the deployment, with the `value`, `value_enc`, `encrypted`, `locked`, `locked_reason` and `updated_by` columns of a settings row, and no `scope`, `user_id` or `organization_id` (`systemFields: { tenant: false }`). It is governed by object permission: a generic data read needs `manage_platform_settings` (`requiredPermissions`), which platform administrators hold. Writes go only through the settings door.
  - **`SettingsService`** writes a global-scope key to `sys_platform_setting` and reads the cascade's global rung from there alone. Its `sys_setting` reads exclude `scope = 'global'`, so there is one source per rung. The cascade order, the lock semantics, `SpecifierScope` and the `source: 'global'` resolution value are unchanged. A global-scope change's `config_change` audit row names `sys_platform_setting` (`CONFIG_CHANGE_GLOBAL_OBJECT_NAME`); tenant- and user-scope changes still name `sys_setting`.
  - **`sys_setting.scope`** no longer declares the `global` option: no write produces such a row. `sys_setting_audit.scope` keeps it, because a global-scope change is still audited there.
  - **`os secret orphans` / `os secret rewrap`**: the settings family of the `sys_secret` reference union now reads both `sys_setting.value_enc` and `sys_platform_setting.value_enc`. Without that, every credential held at the global rung would read as unreferenced and be swept. An unreadable `sys_platform_setting` gaps the family, which refuses deletion.
  
  **What moves for consumers.**
  
  - **Existing databases — nothing moves automatically** (ADR-0131 D14). A `sys_setting` row at `scope = 'global'` is no longer read; until the v18 upgrade ceremony moves it, that key answers from its next rung or the manifest default. The ceremony moves each such row to `sys_platform_setting` by namespace and key, its `value_enc` handle included. An encrypted value needs no re-encryption: the ciphertext's associated data binds the settings scope, namespace and key, never the holding object or an organization.
  - **Authored references.** A filter, list-view column or seed that names `scope = 'global'` on `sys_setting` matches nothing: point it at `sys_platform_setting`, which has no `scope` column.
  - **Generic data reads of the global values.** Read `sys_platform_setting`; it needs `manage_platform_settings`. The settings door (`/api/settings/:namespace`) is unchanged and keeps applying each manifest's own read and write capability.
  - **Kernels that register the settings objects by hand.** Register `SysPlatformSetting` (`@objectstack/platform-objects/system`) beside `SysSetting`; `SettingsServicePlugin` already does. The service reads both on every resolution, so a kernel missing one fails the read loudly rather than answering a cascade with a rung missing.
- 7518ee3: fix(service-settings)!: the user rung answers only its owner, and a write of a user-scoped key must name its user
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing inside SettingsService, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is the service's accept set: `set` and `setMany` now refuse a key declared `scope: 'user'` when the caller's context names no user. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this service and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  A settings key declared `scope: 'user'` belongs to one user. `SettingsService` now holds that on both its read and its write side.
  
  - **Reads.** The user rung answers only a caller whose `SettingsContext.userId` is present and equals the row's owner. A resolve whose context names no user (no `userId`, or an empty one) has no user rung: it answers from the tenant rung, then global, then the manifest default. This holds on every read path that reaches the cascade: `get`, `getMany`, `getNamespace`, `createClient`, `runAction` and `resetNamespace`.
  - **Refused now.** `set` and `setMany` refuse a user-scoped key when the context names no user, a `null` reset of one included. The refusal is a `SettingsValidationError` (`code: 'SETTINGS_VALIDATION'`) with one `fields` entry per such key (`code: 'invalid_value'`, `constraint: { scope: 'user' }`). It refuses the whole batch, before anything is written.
  - **Unchanged.** A caller with a user id reads and writes only their own rows, as before. Keys declared at `scope: 'tenant'` or `'global'` resolve and write the same with or without a user id. The settings HTTP routes resolve a signed-in user before they read or write any row, so they behave as before.
  
  What changes for you: when your code calls the settings service for a user-scoped key, pass the user id of the person the value belongs to. A value meant for everyone belongs on a key declared at `scope: 'tenant'` or `'global'`. None of the settings namespaces this repository ships declares a user-scoped key.
- 79c35d4: fix(service-settings)!: tenant- and user-scope settings rows carry the caller's organization, and the data API read of the settings stores applies each namespace's readPermission
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing inside SettingsService and its plugin, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped (`organization_id` is the column `sys_setting` already declares in its row identity), so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is the service's accept set (a tenant-scope write naming no organization under a walled posture is refused) and the generic read door's row set (a namespace's rows are withheld from a principal lacking its readPermission). The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this service and this diff adds none (not registered / already-registered); and no published interface or type is removed or narrowed (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  `sys_setting` declares its row identity as `(organization_id, namespace, key, scope, user_id)`. `SettingsService` now carries the organization in that identity itself, on every read and write of a `tenant` or `user` row, because it reads and writes the store under its own system context, which no driver tenant scope or organization wall reaches.
  
  - **Writes.** A `tenant` or `user` row is written with the caller's organization (`SettingsContext.tenantId`) in its key and in its stored `organization_id`. A write by one organization updates only that organization's row.
  - **Reads.** The tenant and user rungs draw on the caller organization's rows and on rows stored with no organization, and take the caller organization's own row when it has one. A row stored with no organization stays the fallback for every organization until that organization writes its own. A caller that names no organization reads only the rows stored with no organization under a walled posture (`group`, `isolated`), and every row under `single`. The global rung (`sys_platform_setting`) is unchanged and read by every organization.
  - **Locks.** The lock check on a write reads the same upper rows the caller's cascade reads, so a lock on one organization's tenant row locks nothing for another organization.
  - **Refused now.** Under a walled posture, `set` and `setMany` refuse a key declared `scope: 'tenant'` when the context names no organization, a `null` reset of one included. The refusal is a `SettingsValidationError` (`code: 'SETTINGS_VALIDATION'`, HTTP 400 at the settings routes) with one `fields` entry per such key (`code: 'invalid_value'`, `constraint: { scope: 'tenant' }`). It refuses the whole batch, before anything is written. The posture is the one the `tenancy` service reports; `SettingsServicePlugin` supplies it through `bindEngine`.
  - **Generic read door.** `SettingsServicePlugin` registers an engine middleware on `sys_setting`, `sys_setting_audit` and `sys_platform_setting`: every non-system read (`find`, `findOne`, `count`, `aggregate`) is narrowed to the namespaces whose `readPermission` the principal holds, by the same rule `GET /api/settings/:namespace` applies. A namespace with no registered manifest reads at the default capability, `setup.access`.
  - **Unchanged.** Under `single`, a caller in the default organization reads every value it read before, and a process-wide reader that names no organization reads the organization's current value. Keys declared at `scope: 'global'` resolve and write the same for every caller.
  
  What changes for you: write a tenant-scope setting from inside the organization it belongs to (an active organization on the session, or `SettingsContext.tenantId` in process). Rows already stored with no organization are not rewritten.
- 20949e7: fix(service-settings)!: the settings REST family refuses an anonymous caller with the shared 401
  
  Clause-②: no — it narrows the anonymous accept set to the ADR-0056 D2 floor; no published schema or export moves.
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at the routes registerSettingsRoutes mounts, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and a signed-in caller receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers the family serves: a caller whose resolved context names no user is now refused with the shared anonymous-deny 401 before any settings logic runs. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  `registerSettingsRoutes` mounts the settings REST family. Until now it ran no anonymous floor: a caller with no session was answered by the family's own capability logic, with a status other than `401`. ADR-0056 D2 denies anonymous callers by default, and ADR-0138 D2 says a surface outside its door classes answers `401`.
  
  - **Refused now:** every route of the family answers a caller with no user `401` with code `UNAUTHENTICATED`, in the declared error envelope, before the settings service is consulted. The decision is the platform's shared one (`shouldDenyAnonymous`), mounted once for the whole family.
  - **Unchanged:** a signed-in caller is served exactly as before, and the per-namespace read and write capabilities still decide what it may see and change. An authorization-store outage still answers its `503`.
  
  What changes for you. Sign in before calling the settings routes. If you mount `registerSettingsRoutes` yourself with your own `contextFromRequest`, it must put the caller's `userId` on the context it returns: a context without one is anonymous now, whatever capabilities it carries.

### Patch Changes

- b88c356: The remaining platform producers in these four packages now pass the explicit system opt-in (`{ isSystem: true }`) on their data-engine calls. Until now they reached the engine with no principal and no opt-in, and the security middleware let that through only because of its principal-less hand-off.
  
  Clause-②: no
  
  - **service-messaging, the inbox read state.** `listInbox` (and its unread total), the receipt read behind it, and mark-read / mark-all-read take the opt-in inside the service. Their scope is unchanged: every read of a user's rows is keyed on the user id the door derived from the session, the receipt a mark-read inserts is stamped with it, and the receipt it updates is one a user-keyed read returned.
  - **service-messaging, `owner_of:` audiences.** The record read takes the opt-in, the same posture as the email lookup beside it. It reads only `id` and the owner fields, and only the owner id leaves the resolver. An `owner_of:` audience on an object whose sharing model is `private` now resolves its owner; before, it resolved to nobody.
  - **service-messaging, the rest of the fan-out and the outboxes.** The `role:` and `team:` membership reads, the email and SMS recipient reads, the notification template read, the dedup lookup in `emit()`, and both outboxes' enqueue, ack and list.
  - **service-storage.** `StorageMetadataStore.createFile` and `createSession` insert under the opt-in. The organization still reaches the driver beside it, so the stored organization is unchanged, and the file's `owner_id` is still the uploading user.
  - **service-settings.** The `sys_secret` store the plugin builds (insert, get, update), and the read that verifies a rotation before the old secret is reaped. A store `update` now writes the `ciphertext` it is given; without a context the engine's read-only strip dropped it. No caller in this repository uses `update`.
  - **metadata-protocol.** `SysMetadataRepository.getByHash`, `list`, `history` and the history replay of `watch()`.
  - None of the gates the middleware runs before its hand-off applies to these calls. ⛔ No new export on any package entry, and no new elevation API.
- 98998ca: fix(service-settings): the Default timezone help speaks to administrators, not in formula-function names
  
  Clause-②: no
  
  The help under Settings → Localization → Default timezone (also shown in the first-run "set the workspace timezone" prompt) read "IANA zone for today()/daysFromNow, analytics date buckets, and rendered datetimes." It now says what the setting does: "Decides what "today" means in formulas, how reports group dates, and how dates and times are shown. Accepts any IANA time zone name (e.g. Europe/Paris)." The same meaning ships in every built-in locale (en, zh-CN, ja-JP, es-ES) and in the manifest's own `description`, which `GET /api/settings/localization` serves and the console falls back to.
  
  Wording only: the `timezone` key, its default (`UTC`), its accepted values (any IANA zone) and what it drives are unchanged.
- 4f4c4ed: fix(auth,services): the remaining in-process session reads no longer renew a browser session behind its cookie (#22258)
  
  **What was wrong.** better-auth's `getSession` renews a session older than `session.updateAge`: it moves `sys_session.expires_at` to `now + expiresIn` and stages the renewed session cookie on that call's own response. Nine doors in these packages read the session in-process (`auth.api.getSession({ headers })`) and answer with their own response, so the renewal landed in the database and its cookie was discarded. The browser kept its old cookie, which then expired before the session: a dead cookie beside a live bearer, after which every cookie-only path saw a signed-out user. The doors: `POST /api/v1/auth/admin/oauth2/toggle-disabled`, every `/api/v1/auth/admin/*` mount behind the shared platform-admin gate, `POST /api/v1/auth/admin/unlock-user` and `POST /api/v1/auth/admin/has-permission` (`@objectstack/plugin-auth`); `POST /api/v1/webhooks/redeliver`; the storage upload and download doors (`/api/v1/storage/*`); the share-link management routes (`/api/v1/share-links`); the settings routes (`/api/settings`); and the datasource-admin routes (`/api/v1/datasources/*`).
  
  **The rule now** is the one the REST, dispatcher, current-user and cloud-connection doors already follow. Each of these reads goes through `inProcessSessionReadInput(headers)` from `@objectstack/types`:
  
  - **A request carrying a session cookie** (a browser, including a console that sends its cookie beside its bearer) reads with `query.disableRefresh`. The session renews only through `GET /api/v1/auth/get-session`, which re-issues the cookie with `Max-Age = expiresIn`, so cookie and session expire together.
  - **A bearer-only request** (`@objectstack/client` outside a browser, the `os` CLI) is unchanged: a read past `updateAge` still renews the session, and no cookie is set on a response to a request that sent none.
  
  **Upgrading.** Nothing to change. `@objectstack/plugin-webhooks` now depends on `@objectstack/types` directly; it already reached it through `@objectstack/core`.
- Updated dependencies [317cddd]
- Updated dependencies [fec87e7]
- Updated dependencies [c28f317]
- Updated dependencies [2e10c9a]
- Updated dependencies [67b669e]
- Updated dependencies [0253192]
- Updated dependencies [0253192]
- Updated dependencies [48cca4a]
- Updated dependencies [bfc15d2]
- Updated dependencies [2ff0825]
- Updated dependencies [7aa8d51]
- Updated dependencies [95a8435]
- Updated dependencies [60bcfe7]
- Updated dependencies [d112087]
- Updated dependencies [4806b18]
- Updated dependencies [1802315]
- Updated dependencies [06cc45d]
- Updated dependencies [8c5aa50]
- Updated dependencies [7de0265]
- Updated dependencies [7895671]
- Updated dependencies [b389e43]
- Updated dependencies [c8b062f]
- Updated dependencies [117d34d]
- Updated dependencies [6729e10]
- Updated dependencies [1920cf3]
- Updated dependencies [41d0d40]
- Updated dependencies [c52bfb4]
- Updated dependencies [c7d6037]
- Updated dependencies [72b26ed]
- Updated dependencies [2d21b9c]
- Updated dependencies [f66fdc7]
- Updated dependencies [9fdb127]
- Updated dependencies [615c696]
- Updated dependencies [968acc8]
- Updated dependencies [111ffff]
- Updated dependencies [12b9daf]
- Updated dependencies [d85615d]
- Updated dependencies [6a06e3b]
- Updated dependencies [0e9e7b7]
- Updated dependencies [0af4f66]
- Updated dependencies [9a0401f]
- Updated dependencies [9c93ce6]
- Updated dependencies [77a94d8]
- Updated dependencies [ac9f8bd]
- Updated dependencies [879bd38]
- Updated dependencies [04e776b]
- Updated dependencies [1c563af]
- Updated dependencies [a7df552]
- Updated dependencies [2f70c22]
- Updated dependencies [78f841b]
- Updated dependencies [c565813]
- Updated dependencies [d5a14dd]
- Updated dependencies [93125ae]
- Updated dependencies [56c8844]
- Updated dependencies [5cfd866]
- Updated dependencies [d4680d2]
- Updated dependencies [cdeabec]
- Updated dependencies [d7c5c33]
- Updated dependencies [a87d8be]
- Updated dependencies [15ec50e]
- Updated dependencies [db4c45b]
- Updated dependencies [51290bc]
- Updated dependencies [ad381fd]
- Updated dependencies [4e4111c]
- Updated dependencies [2b61f2d]
- Updated dependencies [8f2e808]
- Updated dependencies [3b49318]
- Updated dependencies [4e9fe9f]
- Updated dependencies [9ad3d24]
- Updated dependencies [326a90a]
- Updated dependencies [9fe7448]
- Updated dependencies [2e11d90]
- Updated dependencies [0b7ba4d]
- Updated dependencies [4578c56]
- Updated dependencies [c512c25]
- Updated dependencies [215e662]
- Updated dependencies [3d886ee]
- Updated dependencies [d8d0711]
- Updated dependencies [a45d5d8]
- Updated dependencies [f6e1d49]
- Updated dependencies [e9a1f5c]
- Updated dependencies [40a6ee5]
- Updated dependencies [5910b5e]
- Updated dependencies [7098aca]
- Updated dependencies [97610a5]
- Updated dependencies [081e6a0]
- Updated dependencies [1884948]
- Updated dependencies [3089848]
- Updated dependencies [e23eccb]
- Updated dependencies [ac8f2c5]
- Updated dependencies [746637e]
- Updated dependencies [db9cf80]
- Updated dependencies [e75dced]
- Updated dependencies [9af0005]
- Updated dependencies [440bed6]
- Updated dependencies [b2549a8]
- Updated dependencies [ee8751d]
- Updated dependencies [96e4be4]
- Updated dependencies [35ef501]
- Updated dependencies [faf6348]
- Updated dependencies [557ae7c]
- Updated dependencies [6a3fe25]
- Updated dependencies [7731d70]
- Updated dependencies [3073b72]
- Updated dependencies [c76edeb]
- Updated dependencies [5b12503]
- Updated dependencies [514bf3c]
- Updated dependencies [20e7d52]
- Updated dependencies [b3a3634]
- Updated dependencies [3e72f93]
- Updated dependencies [f89b5f5]
- Updated dependencies [d25b187]
- Updated dependencies [0e00d36]
- Updated dependencies [d748ae8]
- Updated dependencies [dab6bf4]
- Updated dependencies [ed1de8c]
- Updated dependencies [a00cf99]
- Updated dependencies [a00cf99]
- Updated dependencies [5fb1746]
- Updated dependencies [29a163f]
- Updated dependencies [e223152]
- Updated dependencies [9f5eca5]
- Updated dependencies [9963322]
- Updated dependencies [b27b894]
- Updated dependencies [874a38d]
- Updated dependencies [02d9f69]
- Updated dependencies [f53f14b]
- Updated dependencies [a800912]
- Updated dependencies [d973c34]
- Updated dependencies [156ddfa]
- Updated dependencies [5081090]
- Updated dependencies [b6eb25f]
- Updated dependencies [165587e]
- Updated dependencies [e04759d]
- Updated dependencies [ea9fd99]
- Updated dependencies [b32ee3e]
- Updated dependencies [91f46d0]
- Updated dependencies [e5899a6]
- Updated dependencies [d7b26df]
- Updated dependencies [490cb6d]
- Updated dependencies [e865300]
- Updated dependencies [ec7c7e0]
- Updated dependencies [ec7c7e0]
- Updated dependencies [c74d843]
- Updated dependencies [6d5191e]
- Updated dependencies [85edd61]
- Updated dependencies [e84aeb3]
- Updated dependencies [322ff1e]
- Updated dependencies [7b0a9c9]
- Updated dependencies [5fc57b3]
- Updated dependencies [fe58bbc]
- Updated dependencies [c4e7fa5]
- Updated dependencies [581ca7d]
- Updated dependencies [3f0b6f2]
- Updated dependencies [b7cd1af]
- Updated dependencies [9814035]
- Updated dependencies [55382dc]
- Updated dependencies [b1d701b]
- Updated dependencies [efcbac7]
- Updated dependencies [51f36e7]
- Updated dependencies [31b5a5f]
- Updated dependencies [20028df]
- Updated dependencies [69d4218]
- Updated dependencies [5ce6773]
- Updated dependencies [9432bac]
- Updated dependencies [3f69471]
- Updated dependencies [8bc7836]
- Updated dependencies [e5687cb]
- Updated dependencies [1e62f71]
- Updated dependencies [ec7f7f8]
- Updated dependencies [038d4c9]
- Updated dependencies [147a0d1]
- Updated dependencies [1959aac]
- Updated dependencies [e1deaef]
- Updated dependencies [3071d3e]
- Updated dependencies [1badd31]
- Updated dependencies [55828c5]
- Updated dependencies [7856110]
- Updated dependencies [9b37edb]
- Updated dependencies [a22e67b]
- Updated dependencies [62ce45d]
- Updated dependencies [39e93ef]
- Updated dependencies [02bec6c]
- Updated dependencies [719183f]
- Updated dependencies [8464380]
- Updated dependencies [252a582]
- Updated dependencies [f931e76]
- Updated dependencies [e5f9f01]
- Updated dependencies [ef1fcb2]
- Updated dependencies [ace0a53]
- Updated dependencies [8311650]
- Updated dependencies [de70e97]
- Updated dependencies [74c4b34]
- Updated dependencies [e040b8c]
- Updated dependencies [f451a59]
- Updated dependencies [ba95607]
- Updated dependencies [b53b949]
- Updated dependencies [ea9fd99]
- Updated dependencies [1e44436]
- Updated dependencies [2acff87]
- Updated dependencies [299a2c6]
- Updated dependencies [e23eccb]
- Updated dependencies [bf492c8]
- Updated dependencies [c7a3234]
  - @objectstack/spec@18.0.0-next.0
  - @objectstack/core@18.0.0-next.0
  - @objectstack/platform-objects@18.0.0-next.0
  - @objectstack/types@18.0.0-next.0

## 17.7.0

### Minor Changes

- 222ecc2: feat(spec): `ICryptoProvider` gains a required `keyedDigest(plain): Promise<string>` member, and `LocalCryptoProvider` implements it (#21263)
  
  Clause-②: yes
  
  **BREAKING** for `ICryptoProvider` implementers: the new member is required, so a
  provider that does not declare it stops compiling (`TS2420` on a class, `TS2741`
  on an object literal), and the compiler names the missing member. Code that only
  calls a provider is unaffected.
  
  `keyedDigest` is a digest of `plain` under the provider's server-held key, for a
  value that is handed to a caller but must not let that caller check a guess about
  the input offline. The contract requires three things of every implementation:
  
  - **Keyed.** The output cannot be computed without the provider's key. A provider
    that holds no key material rejects; it never returns an unkeyed value.
  - **Stable per key.** Under one key, equal input gives equal output in every
    process and on every node that holds the key. Replacing the key changes every
    output.
  - **Not a substitute for `digest`.** `digest` keeps its contract and the stability
    the audit trail relies on.
  
  The output is `hmac-sha256:` followed by the 64 lowercase hex characters of an
  HMAC-SHA-256: 76 characters from `[0-9a-z:-]`, which travel unchanged in an HTTP
  header, a query string and JSON, and never collide with the `sha256:` spelling of
  an unkeyed content hash.
  
  `LocalCryptoProvider` computes it from the 32-byte data key it already resolves
  (`OS_SECRET_KEY`, `OS_DEV_CRYPTO_KEY`, the persisted key file, or the ephemeral
  test-mode key), through a MAC key derived from that data key, so the AES-GCM key
  is never used as a MAC key. There is no new secret or environment variable to
  configure. An instance constructed with an explicit key that is not 32 bytes holds
  no usable key material, and its `keyedDigest` rejects with
  `KeyedDigestKeyUnavailableError`.
  
  <!-- adr-0087: not-required (no-migration-prescription) `ICryptoProvider` is a TypeScript contract with no metadata surface: no Zod schema, no authorable key, no export renamed or removed and no stored row changes shape, so `objectstack migrate meta` has nothing to rewrite. The affected party is a provider implementer, and the compiler names the missing member at their declaration. -->
- 57cc695: feat(spec): `CryptoContext` gains a required `scope` discriminant, and `LocalCryptoProvider` binds it into a delimiter-safe, versioned AAD (ADR-0128 D1–D3, #21326 stage 1)
  
  Clause-②: yes
  
  **BREAKING** for `ICryptoProvider` implementers and for every direct caller of
  `encrypt`, `decrypt` or `rotateKey`: `CryptoContext.scope` is required, so a
  context literal without it stops compiling (`TS2741`), and the compiler names the
  missing member. `LocalCryptoProvider` also refuses such a context at runtime with
  `CryptoContextScopeError`, for a caller the compiler never saw. Code that only
  injects a provider is unaffected.
  
  `scope` is a member of the new closed set `CRYPTO_CONTEXT_SCOPES` (type
  `CryptoContextScope`), one member per producer of `CryptoContext`:
  `settings` (`SettingsService`), `object_secret_field` (the ObjectQL engine's
  secret-field path) and `datasource_credential` (the datasource secret binder).
  Each producer in this release passes its own member on every call. A new producer
  adds its own member; it never borrows an existing one.
  
  What the contract now requires of every provider that binds AAD:
  
  - **Producer-discriminated (D1).** The AAD binds `(scope, namespace, key)`, so a
    ciphertext sealed by one producer does not authenticate under another
    producer's context, whatever the two `(namespace, key)` pairs are.
  - **Delimiter-safe (D2).** Distinct triples produce distinct AAD bytes. An
    unescaped join is not permitted.
  - **Versioned.** A ciphertext records which AAD derivation sealed it, and is
    opened only with that derivation. An unknown derivation fails closed. No second
    derivation or scope is ever tried after a failure (D3).
  
  `LocalCryptoProvider` seals every new value under derivation version 2: a lead
  byte that never occurs in UTF-8, a versioned label, then the scope, namespace and
  key, each prefixed with its 4-byte length. The ciphertext carries a `v2:` marker.
  A ciphertext with no marker is version 1, the bare base64 every earlier release
  sealed, and it still opens with the older `(namespace, key)` binding. Existing
  secrets therefore keep working with no action, and carry the older binding until
  they are re-wrapped. Re-wrapping existing ciphertext at rest is stage 2 of
  #21326. `rotateKey` already re-seals a version-1 handle under version 2. Any other
  marker is refused with `UnknownCiphertextVersionError`.
  
  Operational note: a secret set or rotated by this release carries the `v2:`
  marker, and an earlier release cannot open it. A rollback past this release needs
  those values to be set again.
  
  `@objectstack/objectql` and `@objectstack/service-datasource` pass their own
  scope on every seal and open. Their public surface is unchanged.
  
  <!-- adr-0087: not-required (no-migration-prescription) `CryptoContext` and `ICryptoProvider` are TypeScript contracts with no metadata surface: no Zod schema, no authorable key, no export renamed or removed, and no stored row changes shape (`sys_secret.ciphertext` is provider-defined, and every existing ciphertext still opens), so `objectstack migrate meta` has nothing to rewrite. The affected party is a provider implementer or a direct caller, and the compiler names the missing member at their call site. -->
- 0557c2f: feat(cli): `os secret rewrap` re-wraps version-1 `sys_secret` ciphertext under the current AAD derivation, each row under its holder's producer scope (ADR-0128 §4.2, #21326 stage 2)
  
  Clause-②: yes (widening)
  
  A ciphertext sealed before ADR-0128 D1–D3 carries the older binding over
  `(namespace, key)` alone, and still opens in this release. `os secret rewrap` moves
  the stored values to the current binding through `rotateKey`, the seam ADR-0128 §4
  names. It is an operator command: a dry run by default, `--apply` to write, and
  nothing on any boot or upgrade path invokes it. It has no HTTP surface.
  
  - **The scope comes from the holder.** `sys_secret` records no producer, and a
    version-1 ciphertext binds no scope, so each row is re-sealed under the scope of
    the producer whose holder references it: `settings` for a `sys_setting.value_enc`
    handle, `object_secret_field` for a `secret:` ref on a business row,
    `datasource_credential` for a `sys_secret:` `credentialsRef`. The holders come from
    the same cross-producer reference union `os secret orphans` reads. A row nothing
    references, a row whose holders belong to different producers, and every row while
    a holder family could not be read are left as they are and counted, never re-sealed
    under a guessed scope. `--apply` refuses an incomplete union and names the family.
  - **Resumable.** A row already sealed under the current derivation is skipped as
    done, so a stopped run finishes the rest when re-run and a finished run writes
    nothing.
  - **Safe against a live deployment.** Each row is written by one conditional update,
    keyed on its id and the ciphertext the run read. A row a producer changed in
    between is not overwritten, and a re-run picks it up. A driver with no
    `updateMany` is refused before any row is opened.
  - **Fails closed.** A row that does not open, or whose re-seal does not open to the
    same plaintext under the same scope, is not written. The run finishes the rest and
    exits 1. The check happens before the write.
  - **Output is classes and counts only.** It never prints a plaintext, a ciphertext
    or a row id.
  
  The command resolves its data key from `OS_SECRET_KEY`, `OS_DEV_CRYPTO_KEY` or the
  persisted key file, in the strict posture: it never mints a key, and it hands the
  settings service it boots the same provider so that service does not mint one
  either. With no key it refuses before opening any row.
  
  `@objectstack/service-settings` publishes `ciphertextDerivationStatus` (and its
  `CiphertextDerivationStatus` type). It is `LocalCryptoProvider`'s own reading of
  which derivation sealed a stored ciphertext, read off its marker without opening it:
  `current`, `superseded` or `unknown`. The re-wrap classifies rows with it rather than
  restating the marker grammar.
- 76fec88: Platform plumbing in these four packages now passes the explicit system opt-in (`{ isSystem: true }`) on its data-engine calls. Until now it reached the engine with no principal and no opt-in, and the security middleware let that through only because of its principal-less hand-off.
  
  Clause-②: yes (widening)
  
  - **Why `yes (widening)`:** two exported option types gain an optional `context` that an adapter must forward as-is. They are `SettingsEngine.find` / `.insert` (`@objectstack/service-settings`) and `SecretStoreEngineLike.delete` (`@objectstack/service-datasource`), so both packages take a `minor`. An implementation written against the old types still type-checks, and nothing accepted or refused at any door changes.
  - **service-settings:** `SettingsService` reads and writes its own `sys_setting` rows under the opt-in: `loadRows`, plus the existence probe and insert in `upsertRow` (the update already used it). The `sys_setting_audit` writer does too.
  - **service-datasource:** the `sys_metadata` helpers behind runtime datasources use the opt-in. They cover boot restore, cluster convergence, and persist and delete behind the admin doors. So do the `sys_secret` binder's `bind`, `unbind` and `resolve`.
  - **plugin-webhooks:** the auto-enqueuer's subscription refresh and the redeliver guard's subscription lookup use the opt-in.
  - **service-messaging:** two paths use the opt-in. One is the dispatcher's claim path: `claim`, `claimDigest` and the visibility-timeout reap on both outboxes. The other is the emit fan-out: the `sys_notification` row, the recipient's address and locale reads, the preference reads, the inbox row and the delivered receipt.
  - **A user reference that names no user is still refused.** The engine skips its dangling-reference check for an `isSystem` write, so each producer that writes a user reference checks it first. The checked references are the `actor_id` of `sys_notification`, `sys_inbox_message` and `sys_setting_audit`, and the `user_id` of a user-scope `sys_setting` row. An unknown id is refused with the engine's own answer: `VALIDATION_FAILED`, one `reference_not_found` finding, and the same message. A write that names no user is unchanged.
  - What each call reads and writes is otherwise unchanged. None of the gates the middleware runs before its hand-off applies to these objects.
  - ⛔ No new export on any package entry, and no new elevation API.
- 0d8ea5e: fix(service-settings)!: the Localization settings no longer offer `date_format`, `time_format`, `number_format` or `first_day_of_week`: dates, times, numbers and the week start follow the locale (#21958)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) The four keys were settings values, not metadata: only the platform-shipped localizationSettingsManifest declared them (only platform code declares a settings manifest), SettingsManifestSchema and every other spec declaration are unchanged, and a value stored for one of them lives in sys_setting (runtime state, ADR-0007), not sys_metadata, and is kept as it is. Nothing read the keys in objectstack, objectui, cloud or hotcrm, so no consumer has anything to rewrite and objectstack migrate meta has nothing to reach. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a settings key (not already-registered); and the change is the value of an exported manifest constant, not an interface or a type alone (not runtime-interface-only or type-surface-only). -->
  
  **BREAKING**: the Localization settings namespace (`localizationSettingsManifest`) drops four specifiers that nothing ever read: `date_format`, `time_format`, `number_format` and `first_day_of_week`, together with the Formats group they made up and their copy in the `en`, `zh-CN`, `ja-JP` and `es-ES` settings bundles. Setup → Localization no longer shows them, and `GET /api/settings/localization` no longer serves them. The maintainer ruled that dates, times, numbers and the first day of the week follow the user's locale (language and region), as Salesforce derives them from a Locale, and that the four separate settings retire rather than being implemented. `timezone`, `locale`, `default_country`, `currency` and `fiscal_year_start` are unchanged. The manifest's `version` is now 2, as the `SettingsManifest.version` contract asks when keys are removed.
  
  **A value a workspace already stored for one of the four is kept.** Measured at the REST surface:
  
  - The `sys_setting` row stays exactly as it was. No read, save or reset rewrites or deletes it.
  - `GET /api/settings/localization` does not resolve it: the key is absent from both `manifest.specifiers` and `values`.
  - A `PUT /api/settings/localization` that names one of the four is refused with `400 UNKNOWN_KEY` (`details.key` names it), the answer every undeclared key gets. The refusal covers the whole batch, so a live key sent beside it does not land either.
  - A stored row never blocks saving the live keys, and the built-in `reset` action leaves it in place.
  - In process, `settings.get('localization', 'date_format')` (or any of the four) now rejects with `SETTINGS_UNKNOWN_KEY`.
  - An `OS_LOCALIZATION_DATE_FORMAT`, `OS_LOCALIZATION_TIME_FORMAT`, `OS_LOCALIZATION_NUMBER_FORMAT` or `OS_LOCALIZATION_FIRST_DAY_OF_WEEK` variable is no longer read. It set a value that nothing read before either.
  
  **What to do after upgrading.** Nothing has to be rewritten: the four keys never changed how anything rendered. There is no replacement key. `locale`, the workspace's language and region, is what decides how dates, times and numbers are written. The console's calendar and timeline do not yet take their first day of the week from it; that is objectui work, tracked and shipped separately.
  
  It ships as `minor` under the launch-window convention for narrowings.

### Patch Changes

- ba57588: The settings audit trail records a secret-valued setting (an encrypted key) with the crypto provider's keyed digest, never an unkeyed one (#21792).
  
  Clause-②: no
  
  - **Both ledgers.** The `sys_audit_log` `config_change` row (`valueDigest`, spelled `<encrypted:hmac-sha256:…>`) and the `sys_setting_audit` row (`new_hash`) now carry `ICryptoProvider.keyedDigest(value)` for a secret-valued setting. Before, they carried the unkeyed `digest` (`sha256:…`). This covers the `sys_secret` path and the legacy inline-adapter path.
  - **Change detection still works.** The keyed digest is stable for equal values under one key, so the trail still shows whether a secret changed and whether it went back to an earlier value. Rotating the data key changes every later fingerprint. Rows written before this release keep their old `sha256:` value.
  - **No keyed digest, no fingerprint.** When no crypto provider is wired (a host that builds `SettingsService` with only a `CryptoAdapter`), or the provider refuses a keyed digest, the audit rows record the write with no value fingerprint: `valueDigest` is `<encrypted>` and `new_hash` is null. The service logs this once per key at `warn`. The settings write itself is never refused for it. The adapter's own `digest` is no longer used for secrets.
  - **Non-secret settings are unchanged.** They keep the adapter's `digest` of the canonical JSON.
  - **Contract text (`@objectstack/spec`).** The `ICryptoProvider` docs for `digest` and `keyedDigest` now state the rule: a secret's audit fingerprint comes from `keyedDigest`, never from `digest`, and with no keyed digest the trail records none. No type, export or schema changes.
- Updated dependencies [ecb6ca0]
- Updated dependencies [135daaa]
- Updated dependencies [22c2d6f]
- Updated dependencies [909229e]
- Updated dependencies [0721848]
- Updated dependencies [bdd3654]
- Updated dependencies [aead296]
- Updated dependencies [c205b6c]
- Updated dependencies [48fa7a3]
- Updated dependencies [ad7c351]
- Updated dependencies [e901c27]
- Updated dependencies [a387354]
- Updated dependencies [f6b7520]
- Updated dependencies [36e4647]
- Updated dependencies [93a54b8]
- Updated dependencies [f623e2f]
- Updated dependencies [96a9719]
- Updated dependencies [41a3c8d]
- Updated dependencies [c52c49d]
- Updated dependencies [cfa4d74]
- Updated dependencies [99589f9]
- Updated dependencies [36ad321]
- Updated dependencies [dcc5ef4]
- Updated dependencies [748b240]
- Updated dependencies [9b7a0ef]
- Updated dependencies [50e1c65]
- Updated dependencies [5a9292e]
- Updated dependencies [30af17e]
- Updated dependencies [1878ef9]
- Updated dependencies [1c52a5e]
- Updated dependencies [99e1912]
- Updated dependencies [7ebb543]
- Updated dependencies [3911901]
- Updated dependencies [222ecc2]
- Updated dependencies [3937ad2]
- Updated dependencies [3a6d92f]
- Updated dependencies [7526058]
- Updated dependencies [53fd35e]
- Updated dependencies [23365ea]
- Updated dependencies [32d5769]
- Updated dependencies [16eefc6]
- Updated dependencies [6e33b67]
- Updated dependencies [57cc695]
- Updated dependencies [db3fee3]
- Updated dependencies [4c8363f]
- Updated dependencies [9f13c94]
- Updated dependencies [6d67ad5]
- Updated dependencies [ca0dfb6]
- Updated dependencies [45efcfa]
- Updated dependencies [6d728b8]
- Updated dependencies [c9c555a]
- Updated dependencies [68c5ab7]
- Updated dependencies [b793010]
- Updated dependencies [5555047]
- Updated dependencies [85e29b8]
- Updated dependencies [aa46322]
- Updated dependencies [100c394]
- Updated dependencies [72217cd]
- Updated dependencies [72af58c]
- Updated dependencies [1289925]
- Updated dependencies [958cfe2]
- Updated dependencies [ced3e1a]
- Updated dependencies [7d674df]
- Updated dependencies [3f1bc81]
- Updated dependencies [72f3c74]
- Updated dependencies [529d971]
- Updated dependencies [16d241a]
- Updated dependencies [4331a6b]
- Updated dependencies [6c5697d]
- Updated dependencies [9a4182a]
- Updated dependencies [41b1333]
- Updated dependencies [f1e4ae5]
- Updated dependencies [eb9ef79]
- Updated dependencies [eb9ef79]
- Updated dependencies [f83d066]
- Updated dependencies [1ac7308]
- Updated dependencies [10454b3]
- Updated dependencies [9e9d693]
- Updated dependencies [6ec54f0]
- Updated dependencies [98eb3b9]
- Updated dependencies [a2aadab]
- Updated dependencies [fe10172]
- Updated dependencies [ed15448]
- Updated dependencies [9d91f58]
- Updated dependencies [9059082]
- Updated dependencies [309224d]
- Updated dependencies [e83c9f6]
- Updated dependencies [045f764]
- Updated dependencies [2df3d13]
- Updated dependencies [07bf21f]
- Updated dependencies [6fb7115]
- Updated dependencies [53021e3]
- Updated dependencies [a0176ef]
- Updated dependencies [149153c]
- Updated dependencies [ba57588]
- Updated dependencies [a43d90a]
- Updated dependencies [607463d]
- Updated dependencies [607463d]
- Updated dependencies [cab6396]
- Updated dependencies [e864db5]
- Updated dependencies [7665c54]
- Updated dependencies [866683f]
- Updated dependencies [88a39c0]
- Updated dependencies [8e35895]
- Updated dependencies [1f04696]
- Updated dependencies [d16b9fb]
- Updated dependencies [bab7685]
- Updated dependencies [fb69825]
- Updated dependencies [f76c622]
- Updated dependencies [48eb9c1]
- Updated dependencies [8832655]
- Updated dependencies [100f68b]
- Updated dependencies [8963dbf]
- Updated dependencies [1354e7b]
- Updated dependencies [1cbe165]
- Updated dependencies [15fe567]
- Updated dependencies [0bddffd]
- Updated dependencies [7e0066a]
  - @objectstack/spec@17.7.0
  - @objectstack/platform-objects@17.7.0
  - @objectstack/core@17.7.0
  - @objectstack/types@17.7.0

## 17.6.0

### Patch Changes

- bbe03f4: Provenance comments in `service-settings` were re-anchored
  
  Comment and docblock lines under `src/` that cited tracker numbers which no
  longer resolve on GitHub now cite the commit in this repository's history that
  decided the matter, and say in their own words what was decided. Comments
  only: no type, schema, export, log or refusal text, or runtime behaviour changes.
- f3b16fc: Raise the published dependency floors to the 2026-10 production dependency group. No API changes. A consumer install resolves these ranges:
  
  Clause-②: no
  
  - `zod` `^4.6.1` → `^4.6.5`: `@objectstack/spec`, `@objectstack/core`, `@objectstack/objectql`, `@objectstack/rest`, `@objectstack/runtime`, `@objectstack/cli`, `@objectstack/mcp`, `@objectstack/metadata`, `@objectstack/metadata-core`, `@objectstack/metadata-protocol`, `@objectstack/driver-turso`.
  - `@libsql/client` `^0.17.3` → `^0.18.0`: `@objectstack/driver-turso`. Every behaviour the driver documents was re-measured on 0.18.0 and holds unchanged. That covers the URL scheme routing, the `URL_INVALID` and `URL_SCHEME_NOT_SUPPORTED` refusals, the WebSocket transport having no `fetch` or timeout seam, `syncUrl` being read only by the embedded-replica client, and the `?authToken=` precedence on `url` and `syncUrl`. The driver's refusal messages now name 0.18.0 as the measured version. 0.18.0 changes only the local `file:` client, which now pools connections. The driver creates that client only for an embedded replica, and calls only `sync()` on it.
  - `@modelcontextprotocol/sdk` `^1.30.0` → `^1.30.1`: `@objectstack/connector-mcp`, `@objectstack/mcp`.
  - `chalk` `^6.0.0` → `^6.0.1`: `@objectstack/cli`, `create-objectstack`. `yaml` `^2.9.0` → `^2.9.1` and `tsx` `^4.23.12` → `^4.23.15`: `@objectstack/cli`.
  - `mongodb` `^7.5.0` → `^7.6.0`: `@objectstack/driver-mongodb`.
  - `sql.js` `^1.14.1` → `^1.14.2`: `@objectstack/driver-sqlite-wasm`.
  - `@noble/hashes` `^2.3.0` → `^2.4.0` and `jose` `^6.2.8` → `^6.2.12`: `@objectstack/plugin-auth`. The better-auth family stays at exactly `1.7.3`.
  - `hono` `^4.13.5` → `^4.13.9`: `@objectstack/plugin-hono-server`.
  - `pinyin-pro` `^3.29.1` → `^3.29.4`: `@objectstack/plugin-pinyin-search`.
  - `@noble/ciphers` `^2.3.0` → `^2.4.0`: `@objectstack/service-settings`.
- Updated dependencies [e5c7d07]
- Updated dependencies [addbbf0]
- Updated dependencies [93d4e0e]
- Updated dependencies [88b484e]
- Updated dependencies [9905e61]
- Updated dependencies [fa0a4b6]
- Updated dependencies [f11b5f2]
- Updated dependencies [0cb72cf]
- Updated dependencies [c1d8051]
- Updated dependencies [a918fe7]
- Updated dependencies [41dcf11]
- Updated dependencies [c46279f]
- Updated dependencies [688ddef]
- Updated dependencies [b1aab1e]
- Updated dependencies [274e162]
- Updated dependencies [05a7547]
- Updated dependencies [0efbdc3]
- Updated dependencies [c8dd8dd]
- Updated dependencies [03cdb9a]
- Updated dependencies [15b586d]
- Updated dependencies [542670d]
- Updated dependencies [e73ee2d]
- Updated dependencies [92fe081]
- Updated dependencies [c4c68ca]
- Updated dependencies [d78a0bd]
- Updated dependencies [5363e2d]
- Updated dependencies [c876a74]
- Updated dependencies [f1e921a]
- Updated dependencies [7a1faf1]
- Updated dependencies [c9d234c]
- Updated dependencies [3fbf3ca]
- Updated dependencies [24d521e]
- Updated dependencies [f4ce10c]
- Updated dependencies [b785c3b]
- Updated dependencies [2473e26]
- Updated dependencies [3a89d45]
- Updated dependencies [f379f57]
- Updated dependencies [889139c]
- Updated dependencies [05cb2bc]
- Updated dependencies [7510663]
- Updated dependencies [a6866da]
- Updated dependencies [1a75e39]
- Updated dependencies [cd901d7]
- Updated dependencies [d7631d5]
- Updated dependencies [d830d71]
- Updated dependencies [89801cd]
- Updated dependencies [1ab9892]
- Updated dependencies [fbec216]
- Updated dependencies [35587f7]
- Updated dependencies [cd6d8a5]
- Updated dependencies [ace770d]
- Updated dependencies [ed54768]
- Updated dependencies [99786f9]
- Updated dependencies [5757463]
- Updated dependencies [63bfe69]
- Updated dependencies [1940afd]
- Updated dependencies [4f83db5]
- Updated dependencies [f5c7b2c]
- Updated dependencies [6afccda]
- Updated dependencies [671d4c1]
- Updated dependencies [bbcd20c]
- Updated dependencies [c8111a5]
- Updated dependencies [9ad6544]
- Updated dependencies [c9c182e]
- Updated dependencies [4b4ee88]
- Updated dependencies [b9087d7]
- Updated dependencies [f10d802]
- Updated dependencies [856321f]
- Updated dependencies [6b004c0]
- Updated dependencies [93e9e42]
- Updated dependencies [ca5408c]
- Updated dependencies [b280546]
- Updated dependencies [975b248]
- Updated dependencies [ebb66aa]
- Updated dependencies [ceee88f]
- Updated dependencies [e18fea6]
- Updated dependencies [f750119]
- Updated dependencies [660a9b2]
- Updated dependencies [dcd3309]
- Updated dependencies [f6ccca4]
- Updated dependencies [26437ae]
- Updated dependencies [d1633f3]
- Updated dependencies [32d3b3c]
- Updated dependencies [c6b3a01]
- Updated dependencies [bee75ce]
- Updated dependencies [2742e53]
- Updated dependencies [a75311d]
- Updated dependencies [d98bf24]
- Updated dependencies [8368f1c]
- Updated dependencies [8368f1c]
- Updated dependencies [8368f1c]
- Updated dependencies [31c3996]
- Updated dependencies [95555e7]
- Updated dependencies [a29a0ea]
- Updated dependencies [83480c6]
- Updated dependencies [013f97d]
- Updated dependencies [5d5e679]
- Updated dependencies [e07566b]
- Updated dependencies [11d28c1]
- Updated dependencies [399e3aa]
- Updated dependencies [ba03198]
- Updated dependencies [94608a7]
- Updated dependencies [58a77db]
- Updated dependencies [b3d7a70]
- Updated dependencies [b3917d9]
- Updated dependencies [c27404f]
- Updated dependencies [a11faee]
- Updated dependencies [2c1cef3]
- Updated dependencies [27c0cf3]
- Updated dependencies [097ef80]
- Updated dependencies [70dae53]
- Updated dependencies [665cab3]
- Updated dependencies [682873d]
- Updated dependencies [1bd14c9]
- Updated dependencies [62b90d7]
- Updated dependencies [cb45469]
- Updated dependencies [f3b16fc]
- Updated dependencies [d6d6e87]
- Updated dependencies [df1feae]
- Updated dependencies [336e191]
- Updated dependencies [9bdc6d3]
- Updated dependencies [24c554d]
- Updated dependencies [3dc33b2]
- Updated dependencies [9969228]
- Updated dependencies [95e24b0]
- Updated dependencies [1a4c7f8]
- Updated dependencies [c7396f1]
- Updated dependencies [434c6c7]
- Updated dependencies [4b59a38]
- Updated dependencies [d2bc644]
- Updated dependencies [cfa9315]
- Updated dependencies [0803a8b]
- Updated dependencies [0d42104]
- Updated dependencies [a3d7588]
- Updated dependencies [b8191f7]
- Updated dependencies [315888d]
- Updated dependencies [1741c5d]
- Updated dependencies [3711e0b]
- Updated dependencies [a8acee2]
- Updated dependencies [a51920f]
- Updated dependencies [0f6dcac]
- Updated dependencies [682873f]
- Updated dependencies [2123fcc]
- Updated dependencies [00f045d]
  - @objectstack/spec@17.6.0
  - @objectstack/platform-objects@17.6.0
  - @objectstack/core@17.6.0
  - @objectstack/types@17.6.0

## 17.5.0

### Minor Changes

- d0f1845: **BREAKING for per-app translation bundles** — the translation bundle type splits in two: `settings` is a PLATFORM group and a per-app bundle may no longer declare it (#15178)
  
  Clause-②: yes
  
  `TranslationDataSchema` served two different bundles at once — the per-app one an
  application authors (`stack.translations`, `defineTranslationBundle`) and the
  code-authored bundles the platform packages ship. It now names the **per-app**
  bundle entry and declares ten groups; the new `PlatformTranslationDataSchema` /
  `PlatformTranslationBundleSchema` (types `PlatformTranslationData` /
  `PlatformTranslationBundle`) carry the eleven-group platform face, `settings`
  included.
  
  ### Migration — FROM → TO
  
  | You wrote | Write instead |
  | --- | --- |
  | `defineTranslationBundle({ 'zh-CN': { settings: { mail: { title: '邮件投递' } } } })` | delete the `settings` group — there is no per-app replacement key |
  | `defineStack({ translations: [{ 'zh-CN': { settings: … } }] })` | delete the `settings` group from the bundle entry |
  | `const b: TranslationBundle = { en: { settings: … } }` — a PLATFORM package's own bundle | `const b: PlatformTranslationBundle = { en: { settings: … } }` |
  | `const d: TranslationData = { settings: … }` — a PLATFORM package's own locale entry | `const d: PlatformTranslationData = { settings: … }` |
  
  **The one-line fix for an application: delete the `settings` group.** Settings copy
  is not application-authorable at all — `settings` is keyed by
  `SettingsManifest.namespace` and only platform code declares a manifest, so the
  only namespaces a per-app entry could ever address were the platform's own.
  `settingsCommon` is **not** affected — the Settings UI shell strings (the source
  badges, under `settingsCommon.sourceLabels`) stay on the per-app face; only the
  per-namespace manifest copy under `settings` leaves.
  Run `os migrate meta --from 17` to list the mechanical edits for existing
  sources; apply them by hand.
  
  ### What the deletion changes, which is not nothing
  
  ⚠️ This is **not** a lossless delete, and the record says so rather than claiming
  the house phrase. Both bundles load into ONE served tree — `AppPlugin`'s
  `loadTranslations` and every platform plugin's `kernel:ready` contribution both
  call `II18nService.loadTranslations`, which deep-merges — and the
  `resolveSettings*` family and the console's settings labels read that merged
  tree. So an app-authored `settings` branch did resolve.
  
  **It was a gap filler, not an override.** The app's bundles are loaded in
  `AppPlugin`'s own `start()` (kernel Phase 2); the platform's settings
  translations arrive from `SettingsServicePlugin`'s `kernel:ready` hook (Phase
  3); `deepMerge` gives the **later** source the leaf. So the platform won every
  key both bundles defined, and a per-app entry rendered **only where the platform
  bundle carried no string for that key and locale** — the platform ships `en`,
  `zh-CN`, `ja-JP` and `es-ES`.
  
  **What to expect after upgrading.** Where the platform already carried the
  string, nothing changes on screen — that value was the one being served all
  along. Where your entry was filling a gap, that Settings screen now renders the
  **manifest's own literal, which is English** (the `?? fallback` every
  `resolveSettings*` helper ends in). Those are the screens to re-read. If a
  platform string is wrong or missing for your locale, correct it in the platform
  bundle (`@objectstack/service-settings`'s `settingsBuiltinTranslations`) — do
  not re-add the app-side copy, which the platform overwrites on every boot
  wherever it has its own value.
  
  No deprecation window: the per-app door refuses the key by name from this major,
  and the rejection carries the prescription above.
  
  ### Unchanged
  
  The registered `translation` metadata type (`TranslationItemSchema`) is not
  changed by THIS entry — this ruling covers the file-authored bundle. (Superseded
  in the same release: #19620 narrows the item door too; see its own changeset.) `GET
  /api/v1/i18n/translations/:locale` still declares it on its response, because the
  served document is the merged tree; `GetTranslationsResponseSchema` is typed
  against the platform face for exactly that reason.
  
  Ruling batch #132 item 2 letter ② (2026-09-13) — 「同意」. The card's original
  "removal" disposition is struck: `settings` is a live platform key.
  
  <!-- adr-0087: registered translation-per-app-settings-removed -->

### Patch Changes

- 24b7085: The auth settings console states the email-verification rule each audience posture enforces (#20413).
  
  Clause-②: no
  
  The Audience group description and the `audience_posture` help said every posture other than invitation-only forces email verification on. That stopped being true when posture `open` began honouring a deployment's opt-out. Both strings, in the manifest and in the `en`, `zh-CN`, `es-ES` and `ja-JP` bundles, now state the rule the auth plugin enforces:
  
  - `email_domain` always forces email verification on.
  - `open` forces it on unless the deployment turns it off, with `OS_AUTH_REQUIRE_EMAIL_VERIFICATION=false` or `emailAndPassword.requireEmailVerification: false` in the stack config.
  - A `false` saved in the settings console is refused under `open`.
  
  Text only: no key, option, default or accepted value changes.
- 71629a1: refactor(core): one `classifyAdmissionTenancyPosture`, so six admission seams cannot each get the classification wrong (#16013)
  
  Six admission doors each hand-wrote the same try/catch on the `tenancy` read that
  feeds `resolveAuthzContext`: the registry's branded "never registered" rejection
  (`isServiceNotRegisteredError`, #13905) resolves quietly to `undefined` — the
  supported no-tenancy composition, where no posture-conditional refusal runs at
  all — and every other rejection becomes `AuthzStoreUnavailableError('tenancy', err)`
  (ADR-0112 `SERVICE_UNAVAILABLE` / 503), because the posture is an authorization
  INPUT and admission was therefore never DECIDED. That is #13906 decision 1
  option A, and it is the part nobody may get wrong: a quiet `catch` at any one of
  the six re-opens the defect, where a failure reads as "this check does not apply"
  and an ex-member's org-stamped API key is admitted.
  
  Nothing is broken today — every copy was correct — so this removes a standing
  hazard rather than fixing a defect. **No admission verdict changes**, on any
  wiring: the classification is byte-for-byte the decision the six copies made,
  now made once.
  
  - **`@objectstack/core` gains `classifyAdmissionTenancyPosture`** (and the
    `TenancyServiceResolver` type), exported from the package index beside
    `effectiveTenancyPosture`. It takes a THUNK and owns the classification only.
    The thunk is not a style choice: the REJECTION is what gets classified, so the
    resolution has to happen inside the helper's `try` — a caller that awaited the
    service first would need a `catch` of its own, which is the thing being
    deleted.
  - **The RESOLUTION deliberately did not move.** `rest-server.ts` branches on
    kernel-vs-provider, and asking twice would let a provider bound to the local
    kernel answer for a request that resolved to another environment; four seams
    read `ctx.getKernel()`; `service-storage` reads an already-normalised gate
    registry; and each seam's reason why a MISSING async accessor must stay quiet
    is its own argument (the storage door's is its declared degrade-to-ungated
    contract, the others' is the `KernelBase`/`LiteKernel` host shape). A helper
    that also owned how the service is reached would be wrong for one of them or
    grow a flag per seam — the copies again, with an extra step. Every one of
    those reasons stays written at its seam.
  - **Folded**: `packages/rest/src/rest-server.ts` (both wirings),
    `packages/cloud-connection/src/marketplace-install-local-plugin.ts`,
    `packages/plugins/plugin-sharing/src/sharing-plugin.ts`,
    `packages/services/service-datasource/src/admin-routes.ts`,
    `packages/services/service-settings/src/settings-service-plugin.ts`,
    `packages/services/service-storage/src/storage-service-plugin.ts`.
  - **Pinned where the decision now lives**:
    `packages/core/src/security/admission-tenancy-posture.test.ts` drives both
    rejections at the production seam — a real `ObjectKernel` that never
    registered `tenancy`, and one whose `tenancy` factory throws — each beside the
    brand predicate's own answer on that same rejection, so "the outage throws" is
    distinguishable from a helper that throws at everything. It also holds the
    constraint mechanically: the helper's source may not name an accessor, a
    kernel or a plugin context, and it takes exactly one parameter.
- f6189a4: Stop reporting an unmounted `sys_audit_log` as a failed audit write.
  
  `buildConfigChangeAuditSink` wrote the `config_change` compliance row blind and reported
  the throw it got back. On a deployment that never mounted the OPTIONAL
  `@objectstack/plugin-audit` — `objectstack serve --preset minimal`, an EE host that mounts
  no `audit`, a hosted tenant kernel — there is no ledger to write to, so every tenant
  settings write produced a durability complaint about a deployment behaving exactly as
  composed, plus an `Insert operation failed` line per write from the engine one frame down.
  
  The sink now probes the engine registry for `sys_audit_log` before the write and skips at
  `debug` when it is absent, so no insert is attempted and neither channel says anything. The
  probe records nothing and is re-taken per write, so a ledger mounted later in the same boot
  starts recording. An engine that cannot answer the probe still gets the write attempted.
  
  No API change: the exported signature, the row shape, `CONFIG_CHANGE_ACTION` and
  `CONFIG_CHANGE_OBJECT_NAME` are all unchanged. The remaining fault arm — a ledger that IS
  mounted whose insert genuinely fails — now reports on the `error` channel rather than
  `warn`, which is AGENTS.md's durability-degradation level for a write that claims to be
  audited and is not.
  
  Clause-②: no
- Updated dependencies [863c7c4]
- Updated dependencies [0f95f43]
- Updated dependencies [825d70f]
- Updated dependencies [6057357]
- Updated dependencies [a60e04d]
- Updated dependencies [7f62536]
- Updated dependencies [abc4b83]
- Updated dependencies [7382c5d]
- Updated dependencies [ea2940d]
- Updated dependencies [7d0f911]
- Updated dependencies [48f5200]
- Updated dependencies [245f360]
- Updated dependencies [d0f1845]
- Updated dependencies [9dcdb77]
- Updated dependencies [6175da8]
- Updated dependencies [0283cb9]
- Updated dependencies [324968e]
- Updated dependencies [7843663]
- Updated dependencies [ce57857]
- Updated dependencies [744a0a3]
- Updated dependencies [c7d4825]
- Updated dependencies [4844840]
- Updated dependencies [fe71032]
- Updated dependencies [74eaab8]
- Updated dependencies [0b788da]
- Updated dependencies [f7a3495]
- Updated dependencies [97f4f8c]
- Updated dependencies [482d34d]
- Updated dependencies [7a25a3e]
- Updated dependencies [305e7fc]
- Updated dependencies [839d1b0]
- Updated dependencies [2fc092b]
- Updated dependencies [2dfe070]
- Updated dependencies [6059b29]
- Updated dependencies [88a072e]
- Updated dependencies [9c577c1]
- Updated dependencies [d4a1a28]
- Updated dependencies [baf9745]
- Updated dependencies [3d8779d]
- Updated dependencies [0bd7dae]
- Updated dependencies [d34f9b6]
- Updated dependencies [57343f7]
- Updated dependencies [271d6bb]
- Updated dependencies [1e20f81]
- Updated dependencies [38472ce]
- Updated dependencies [8b48903]
- Updated dependencies [2d235bc]
- Updated dependencies [aaacf1d]
- Updated dependencies [6548118]
- Updated dependencies [9dacf61]
- Updated dependencies [146c291]
- Updated dependencies [4db1bf1]
- Updated dependencies [e0e4a56]
- Updated dependencies [7aae005]
- Updated dependencies [bdb247d]
- Updated dependencies [d5c91dd]
- Updated dependencies [0e51278]
- Updated dependencies [48203ff]
- Updated dependencies [b6471ba]
- Updated dependencies [ada2869]
- Updated dependencies [d88a47d]
- Updated dependencies [2f1a6f6]
- Updated dependencies [23fc5d6]
- Updated dependencies [2d34f32]
- Updated dependencies [7b1e4a4]
- Updated dependencies [d7c0241]
- Updated dependencies [9e3c485]
- Updated dependencies [e1796ad]
- Updated dependencies [8271c81]
- Updated dependencies [c9eb773]
- Updated dependencies [fbc12be]
- Updated dependencies [ec2ede0]
- Updated dependencies [4342c99]
- Updated dependencies [132dd13]
- Updated dependencies [d285bf0]
- Updated dependencies [dfeba25]
- Updated dependencies [9059a94]
- Updated dependencies [0a88a80]
- Updated dependencies [2c1011b]
- Updated dependencies [12bb672]
- Updated dependencies [97233b9]
- Updated dependencies [c199772]
- Updated dependencies [f5a7250]
- Updated dependencies [1a2bb9e]
- Updated dependencies [eea7ccc]
- Updated dependencies [097d268]
- Updated dependencies [182bbde]
- Updated dependencies [5ce3705]
- Updated dependencies [24d622b]
- Updated dependencies [0252320]
- Updated dependencies [2eb4724]
- Updated dependencies [e04a0af]
- Updated dependencies [6b97a20]
- Updated dependencies [e7ff9c2]
- Updated dependencies [75237a9]
- Updated dependencies [920f887]
- Updated dependencies [8a017af]
- Updated dependencies [497655f]
- Updated dependencies [ada7012]
- Updated dependencies [3a9ad22]
- Updated dependencies [758ac40]
- Updated dependencies [6d2571f]
- Updated dependencies [a2c2852]
- Updated dependencies [2bf6ef1]
- Updated dependencies [c744c0a]
- Updated dependencies [092d460]
- Updated dependencies [09e16a5]
- Updated dependencies [98bd798]
- Updated dependencies [cbcae14]
- Updated dependencies [8261ff7]
- Updated dependencies [24489f1]
- Updated dependencies [fc28c1d]
- Updated dependencies [6d64785]
- Updated dependencies [00c332b]
- Updated dependencies [b3b43b6]
- Updated dependencies [d93400f]
- Updated dependencies [b1d3945]
- Updated dependencies [134b410]
- Updated dependencies [84e6b05]
- Updated dependencies [cb1f274]
- Updated dependencies [5c28cc7]
- Updated dependencies [b0eb9a5]
- Updated dependencies [e233db9]
- Updated dependencies [176b035]
- Updated dependencies [a83dbb6]
- Updated dependencies [d3a2331]
- Updated dependencies [51297e9]
- Updated dependencies [2d892dd]
- Updated dependencies [156792e]
- Updated dependencies [5ba2ec3]
- Updated dependencies [abb01f1]
- Updated dependencies [e64ae15]
- Updated dependencies [02bdeaa]
- Updated dependencies [66abef3]
- Updated dependencies [25c9a83]
- Updated dependencies [ee5812a]
- Updated dependencies [68fea8b]
- Updated dependencies [c049e74]
- Updated dependencies [bb9794a]
- Updated dependencies [d402e32]
- Updated dependencies [63a8eb4]
- Updated dependencies [9a910c4]
- Updated dependencies [adabccf]
- Updated dependencies [340b6dc]
- Updated dependencies [fe0ae5c]
- Updated dependencies [99fcb4a]
- Updated dependencies [55095cc]
- Updated dependencies [0f1cd83]
- Updated dependencies [a3d4c59]
- Updated dependencies [74832b6]
- Updated dependencies [1aa5026]
- Updated dependencies [2b80461]
- Updated dependencies [2bdb81f]
- Updated dependencies [cd5fdaa]
- Updated dependencies [b9d5422]
- Updated dependencies [c7448dc]
- Updated dependencies [627382b]
- Updated dependencies [0b31d90]
- Updated dependencies [4b58dcf]
- Updated dependencies [c23cfb3]
- Updated dependencies [559041d]
- Updated dependencies [e0d0553]
- Updated dependencies [5100c42]
- Updated dependencies [596090e]
- Updated dependencies [5380daa]
- Updated dependencies [00b38d7]
- Updated dependencies [47a9002]
- Updated dependencies [7056ca5]
- Updated dependencies [731f020]
- Updated dependencies [5eebc9e]
- Updated dependencies [72c1640]
- Updated dependencies [5e5ec9f]
- Updated dependencies [170fd83]
- Updated dependencies [922923b]
- Updated dependencies [2cac363]
- Updated dependencies [fc91239]
- Updated dependencies [e6c34f6]
- Updated dependencies [062f5cd]
- Updated dependencies [0318faf]
- Updated dependencies [5d8319f]
- Updated dependencies [43f4766]
- Updated dependencies [8e8ea99]
- Updated dependencies [a484966]
- Updated dependencies [021755a]
- Updated dependencies [b929e0a]
- Updated dependencies [dbd4744]
- Updated dependencies [14a762f]
- Updated dependencies [b146102]
- Updated dependencies [75c0dac]
- Updated dependencies [9bb059d]
- Updated dependencies [07c6f82]
- Updated dependencies [502f179]
- Updated dependencies [f20fe29]
- Updated dependencies [362035c]
- Updated dependencies [7e0bfce]
- Updated dependencies [c120dbd]
- Updated dependencies [32b5831]
- Updated dependencies [74554a3]
- Updated dependencies [e56112c]
- Updated dependencies [aeaaa44]
- Updated dependencies [43460b9]
- Updated dependencies [44a2332]
- Updated dependencies [f34dda6]
- Updated dependencies [488f4f5]
- Updated dependencies [15f9284]
- Updated dependencies [a4ca69a]
- Updated dependencies [1ff3a8f]
- Updated dependencies [61dd96f]
- Updated dependencies [74fb2f7]
- Updated dependencies [b971924]
- Updated dependencies [6afa59d]
- Updated dependencies [e37ea4d]
- Updated dependencies [8f6d831]
- Updated dependencies [fa29803]
- Updated dependencies [b01bdbc]
- Updated dependencies [adbdbc5]
- Updated dependencies [6cc8dcd]
- Updated dependencies [ba77509]
- Updated dependencies [408ca2e]
- Updated dependencies [ec292cf]
- Updated dependencies [dc0ab6a]
- Updated dependencies [19e58e2]
- Updated dependencies [7e1b048]
- Updated dependencies [342808c]
- Updated dependencies [b3615f1]
- Updated dependencies [0b4022b]
- Updated dependencies [a60c913]
- Updated dependencies [c736eaa]
- Updated dependencies [4d0bd23]
- Updated dependencies [4045781]
- Updated dependencies [ecf56e7]
- Updated dependencies [0e658fb]
- Updated dependencies [9529989]
- Updated dependencies [236cec1]
- Updated dependencies [5c5b67f]
- Updated dependencies [eec56c3]
- Updated dependencies [3f9e2ea]
- Updated dependencies [77f54bf]
- Updated dependencies [ccccdcc]
- Updated dependencies [48c91e9]
- Updated dependencies [2b52a5b]
- Updated dependencies [0f057b6]
- Updated dependencies [3875ae6]
- Updated dependencies [1c16889]
- Updated dependencies [1912237]
- Updated dependencies [fc29c74]
- Updated dependencies [95fb417]
- Updated dependencies [4ec3987]
- Updated dependencies [5b9402d]
- Updated dependencies [2cf9db7]
- Updated dependencies [dc1b986]
- Updated dependencies [655e8c0]
- Updated dependencies [041c8cf]
- Updated dependencies [e3277c3]
- Updated dependencies [cc6dfd9]
- Updated dependencies [7536721]
- Updated dependencies [9df3934]
- Updated dependencies [0b83e01]
- Updated dependencies [ebc6afe]
- Updated dependencies [6696056]
- Updated dependencies [0e06f3b]
- Updated dependencies [c1dfa52]
- Updated dependencies [2548ba5]
- Updated dependencies [9282578]
- Updated dependencies [ecf90b2]
- Updated dependencies [90ff10a]
- Updated dependencies [2bbebf5]
- Updated dependencies [369bcbe]
- Updated dependencies [3bd28e2]
- Updated dependencies [9347c1f]
- Updated dependencies [c164186]
- Updated dependencies [e7344f0]
- Updated dependencies [4d7e740]
- Updated dependencies [de091b5]
- Updated dependencies [6aa3188]
- Updated dependencies [a34c27c]
- Updated dependencies [ae7a35a]
- Updated dependencies [cf55914]
- Updated dependencies [17bd318]
- Updated dependencies [681868c]
- Updated dependencies [a9fb83e]
- Updated dependencies [2274894]
- Updated dependencies [e462186]
- Updated dependencies [b5853da]
- Updated dependencies [4ac9319]
- Updated dependencies [560b724]
- Updated dependencies [16c5473]
- Updated dependencies [b276d44]
- Updated dependencies [3f86dc5]
- Updated dependencies [172b4cf]
- Updated dependencies [67c98f6]
- Updated dependencies [b98fbc2]
- Updated dependencies [e7f69db]
- Updated dependencies [84156c7]
- Updated dependencies [e0f17a3]
- Updated dependencies [0bf85ea]
- Updated dependencies [1df29df]
- Updated dependencies [8a44ce7]
- Updated dependencies [ca753c0]
- Updated dependencies [8ecbe0f]
- Updated dependencies [6a4aec7]
- Updated dependencies [d624002]
- Updated dependencies [e4471e6]
- Updated dependencies [e8fcf55]
- Updated dependencies [fe677ae]
- Updated dependencies [8d1f7ab]
- Updated dependencies [cfc3bcf]
- Updated dependencies [dd1b803]
- Updated dependencies [03d6cb0]
- Updated dependencies [9e7824a]
- Updated dependencies [437bb0d]
- Updated dependencies [49144fc]
- Updated dependencies [e2c4e12]
- Updated dependencies [08c8484]
- Updated dependencies [93cfc3f]
- Updated dependencies [6ac33a5]
- Updated dependencies [443b2f4]
- Updated dependencies [7e7fab7]
- Updated dependencies [b09ce67]
- Updated dependencies [4df101c]
- Updated dependencies [6a6a17b]
- Updated dependencies [733822c]
- Updated dependencies [e5cf27d]
- Updated dependencies [a91d12a]
- Updated dependencies [bea6d2e]
- Updated dependencies [f415bcf]
- Updated dependencies [615c468]
- Updated dependencies [5f9d7d7]
- Updated dependencies [31d281d]
- Updated dependencies [569d4d2]
- Updated dependencies [9e9bb46]
- Updated dependencies [0d7ed5a]
- Updated dependencies [2aa25ef]
- Updated dependencies [0e1afe8]
- Updated dependencies [288611e]
- Updated dependencies [dfd8e39]
- Updated dependencies [89f87f2]
- Updated dependencies [28ad7e4]
- Updated dependencies [e6b7d8c]
- Updated dependencies [3062e50]
- Updated dependencies [40b315b]
- Updated dependencies [f2c7eef]
- Updated dependencies [7e36a3c]
- Updated dependencies [5a6267f]
- Updated dependencies [0bbe400]
- Updated dependencies [862b6ce]
- Updated dependencies [80153f5]
- Updated dependencies [26daf0b]
- Updated dependencies [826f327]
- Updated dependencies [7e5246d]
- Updated dependencies [b810ddb]
- Updated dependencies [7dc45eb]
- Updated dependencies [17e4f52]
- Updated dependencies [dcd3bce]
- Updated dependencies [2d91c9a]
- Updated dependencies [b285508]
- Updated dependencies [2c31070]
- Updated dependencies [7db1332]
- Updated dependencies [aeb0557]
- Updated dependencies [1c1b8c8]
- Updated dependencies [05077d4]
- Updated dependencies [ba5927f]
- Updated dependencies [75b2169]
- Updated dependencies [de8c973]
- Updated dependencies [65352b7]
- Updated dependencies [e956924]
- Updated dependencies [2304b16]
- Updated dependencies [c7ad16f]
- Updated dependencies [48efe91]
- Updated dependencies [fb38607]
- Updated dependencies [dc07593]
- Updated dependencies [e967cbd]
- Updated dependencies [9bf5e67]
- Updated dependencies [8255a51]
- Updated dependencies [d1c01ff]
- Updated dependencies [6427e2c]
- Updated dependencies [9e1689f]
- Updated dependencies [b057434]
- Updated dependencies [f6ceddc]
- Updated dependencies [4c42fd1]
- Updated dependencies [5f392f0]
- Updated dependencies [a362e0e]
- Updated dependencies [f26fb8e]
- Updated dependencies [bc2ec80]
- Updated dependencies [0da638c]
- Updated dependencies [041d9fd]
- Updated dependencies [f03f6c7]
- Updated dependencies [b8ec127]
- Updated dependencies [cf79182]
- Updated dependencies [e81c4e5]
- Updated dependencies [28f9277]
- Updated dependencies [929d9e3]
- Updated dependencies [8a5240a]
- Updated dependencies [c1d54db]
- Updated dependencies [c7af6bd]
- Updated dependencies [1f0b565]
- Updated dependencies [23aa83c]
- Updated dependencies [357f499]
- Updated dependencies [72eeabd]
- Updated dependencies [80aef80]
- Updated dependencies [c3ebe4a]
- Updated dependencies [65ad77d]
- Updated dependencies [a61ae59]
- Updated dependencies [fb59fb5]
- Updated dependencies [a54ecaa]
- Updated dependencies [854639b]
- Updated dependencies [44c917a]
- Updated dependencies [613d35a]
- Updated dependencies [e08c8b0]
- Updated dependencies [0ee32ed]
- Updated dependencies [58b36fa]
- Updated dependencies [4792049]
- Updated dependencies [53ec0b1]
- Updated dependencies [71629a1]
- Updated dependencies [0a56d3b]
- Updated dependencies [f8e5790]
- Updated dependencies [d2c1d19]
- Updated dependencies [681871e]
- Updated dependencies [54e8234]
- Updated dependencies [288fe9c]
- Updated dependencies [d127f9b]
- Updated dependencies [4bbf766]
- Updated dependencies [c17b494]
- Updated dependencies [d414e2b]
- Updated dependencies [af98a04]
- Updated dependencies [43cbe14]
- Updated dependencies [c86d351]
- Updated dependencies [9cc5010]
- Updated dependencies [6e3462d]
- Updated dependencies [6e3e546]
- Updated dependencies [c4d1759]
- Updated dependencies [f7a9740]
- Updated dependencies [6af2901]
- Updated dependencies [96451ec]
- Updated dependencies [9cdffbe]
- Updated dependencies [331a1a2]
- Updated dependencies [9788f1e]
- Updated dependencies [3cf6449]
- Updated dependencies [3cf6449]
- Updated dependencies [2bd53f1]
- Updated dependencies [576d5df]
- Updated dependencies [5f9f846]
- Updated dependencies [5a95b0e]
- Updated dependencies [5d527f7]
- Updated dependencies [5bf2330]
- Updated dependencies [9165d5c]
- Updated dependencies [d9e1587]
- Updated dependencies [07150b3]
- Updated dependencies [143c715]
- Updated dependencies [fb2bccf]
- Updated dependencies [d2badf7]
- Updated dependencies [d64bcb6]
- Updated dependencies [d4f5232]
- Updated dependencies [396eae3]
- Updated dependencies [ecdfc94]
- Updated dependencies [f04be62]
- Updated dependencies [de1a611]
- Updated dependencies [4fba503]
- Updated dependencies [db76982]
- Updated dependencies [5cf58eb]
- Updated dependencies [66e266c]
- Updated dependencies [3b1dab9]
- Updated dependencies [7607076]
- Updated dependencies [1555ed4]
- Updated dependencies [776d64c]
- Updated dependencies [03b19d9]
- Updated dependencies [6154165]
- Updated dependencies [199002b]
- Updated dependencies [ab450f4]
- Updated dependencies [21ab410]
- Updated dependencies [025588a]
- Updated dependencies [a49e8ae]
- Updated dependencies [f3e3d59]
- Updated dependencies [9bd4344]
- Updated dependencies [029d8a4]
- Updated dependencies [4215417]
- Updated dependencies [51efbf1]
- Updated dependencies [9c44eed]
- Updated dependencies [bbca441]
- Updated dependencies [7cd5874]
- Updated dependencies [3cb84d0]
- Updated dependencies [119a02b]
- Updated dependencies [eea8787]
- Updated dependencies [7887077]
- Updated dependencies [29dd1a6]
  - @objectstack/spec@17.5.0
  - @objectstack/platform-objects@17.5.0
  - @objectstack/core@17.5.0
  - @objectstack/types@17.5.0

## 17.4.0

### Minor Changes

- 6b8c677: fix(service-settings): the settings door answers from the ONE shared value-domain predicate, and refuses a non-member with `value_domain` (#15162)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, export, config field or stored metadata changes spelling or shape, no schema in `packages/spec` changes, and `objectstack migrate meta` has nothing to rewrite. What moves is the `code` value one `FieldError` carries for one condition — the settings save door's refusal of a value outside a declared `valueDomain` — which now spells the standard-catalog member `value_domain` that the field-level half of the same ruling added. The consumer note below is guidance for a client branching on that code; it prescribes no rewrite of any authored artifact. -->
  
  **BREAKING** for a client that branches on the refusal code. Landing inside
  the launch window, so it ships as `minor` (the lockstep convention forbids
  `major`); the banner is the carrier, not the bump.
  
  The services half of the maintainer's ruling of 2026-09-02: **one closed
  vocabulary and one membership predicate shared by settings specifiers and
  object fields**. The spec half declared them in `@objectstack/spec/shared`;
  this package had been carrying a second copy of all three definitions since
  `Specifier.valueDomain` shipped. The copies are deleted and the door now asks
  `isValueDomainMember` — the call the record write path will make when the
  engine half of the same ruling lands (PR #15316, still open).
  
  **The wire change**, measured on `PUT /api/settings/localization` with
  `{"timezone": "Mars/Olympus"}`, base `a56baa2bd` vs this branch:
  
  | | before | after |
  |:--|:--|:--|
  | `fields[0].code` | `invalid_value` | `value_domain` |
  | `fields[0].message` | `Default timezone must be a valid IANA time zone identifier (e.g. 'Europe/Zurich'). Received 'Mars/Olympus'.` | `Default timezone must be a valid IANA time zone identifier, e.g. Europe/Zurich (got "Mars/Olympus")` |
  
  Everything else is byte-identical: HTTP 400, the envelope code
  `SETTINGS_VALIDATION`, `field`, `label`, `constraint: { valueDomain: … }` and
  the echoed `value`. A client that reads `constraint.valueDomain` — the
  machine-readable half ADR-0114 asks it to read — is unaffected. A client that
  branches on `code === 'invalid_value'` for a domain breach must move to
  `value_domain`.
  
  Why the code moved: ADR-0114's rule is that the code is the **constraint's own
  name**, the way `max_length` names the bound it breached. This branch took
  `invalid_value` — the catalog's slot for "rejected for a reason no other
  member names" — only while no member named a standard-domain breach. The
  field-level card's spec half added one, so the slot no longer applies. The
  message now renders the published catalog template
  `value_domain_<domain>` in `en` — the catalog the record write path will render
  from once PR #15316 lands, so the two doors under one ruling will describe one
  domain in one set of words instead of each composing its own sentence. For an `encrypted` specifier the offending value is still never
  echoed: the template's value placeholder takes the same mask the REST boundary
  uses (`fields[0].value` stays absent, as before).
  
  **No value changes verdict.** The accept sets were measured, not assumed, on
  the repo's Node 22 baseline (v22.22.2):
  
  - `iso_3166_alpha2` — the two 249-code lists diffed mechanically before either
    was deleted: identical, including order; symmetric difference 0.
  - `iso_4217_currency` — this one changes DEFINITION: a run-time
    `Intl.supportedValuesOf('currency')` probe becomes the key set of the
    checked-in CLDR snapshot `CURRENCY_FRACTION_DIGITS`. 162 codes vs 162,
    symmetric difference 0 in both directions (`CHF` in both, `XYZ` in neither).
    The behaviour that changes is that the verdict no longer varies with the
    host's ICU build — the direction the shared module argues for. A door-level
    test now re-measures it: every code the run-time probe admits must still be
    admitted.
  - `iana_time_zone` — the identical `Intl.DateTimeFormat` probe on both sides,
    unmoved.
  
  A ratchet pin (`value-domains.shared-predicate.pin.test.ts`) reddens if any
  non-test source in this package re-acquires a membership table, an `Intl`
  enumeration probe, or a second caller of the predicate.

### Patch Changes

- ac9376a: An authorization-store OUTAGE now reaches the caller as the `503 SERVICE_UNAVAILABLE` it declares, on the storage download doors and on all four settings routes.
  
  `AuthzStoreUnavailableError` exists so an outage is distinguishable from a capability denial on the wire: it declares `status: 503` and `code: SERVICE_UNAVAILABLE`, and every producer in this family already re-raises it rather than laundering it into a verdict. Two consumers then flattened it back, each in its own way, so the declared envelope never arrived.
  
  **What changes on the wire.** Only on the path where the authorization store could not be READ — never when it legitimately returned no rows, and never for any other fault.
  
  | door | before | after |
  | --- | --- | --- |
  | `GET /api/v1/storage/files/:fileId/url` | `403 FILE_DOWNLOAD_DENIED` / `403 ATTACHMENT_DOWNLOAD_DENIED` | `503 SERVICE_UNAVAILABLE` |
  | `GET /api/v1/storage/files/:fileId` | same 403, and no redirect | `503 SERVICE_UNAVAILABLE`, still no `Location` |
  | `GET /api/settings` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |
  | `GET /api/settings/:namespace` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |
  | `PUT /api/settings/:namespace` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |
  | `POST /api/settings/:namespace/:actionId` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |
  
  The storage row is the one worth reading twice: an outage was answered as a **permission denial**, byte-indistinguishable from a genuine refusal, which is the precise confusion the loud-outage discipline exists to prevent. The message now names the object whose read failed and says in words that this is not a permission denial.
  
  **What does NOT change.** The security posture is identical — these doors were already fail-CLOSED and still are, and the storage gate still mints no capability on an outage. Every other refusal keeps its status and code: `deny` is still `403`, `unauthenticated` still `401`, an unknown namespace still `404`, a forbidden settings context still `403`, and any fault that is not this branded outage still lands on the same untyped `500 INTERNAL_ERROR` tail it did before. The repair is scoped to the brand, not to "anything carrying a status".
  
  **Why `patch` and not `minor`.** No API is added, removed or renamed; no exported signature moves; no authorable key changes. This is a released package delivering an envelope it already declared — a bug fix, which this repo bumps `patch`. The change *is* observable, which is why the FROM → TO table above is in the changeset body rather than encoded in the bump: a version number carries no mapping, and this text is what an upgrading consumer greps in `CHANGELOG.md`.
  
  **If you branch on these statuses.** A client that treated the storage `403` as "this user may not have this file" was, during an outage, retrying or re-authenticating against a fault that no credential could fix; it should now treat `503` as retryable and leave the caller's permissions alone. A client that treated the settings `500` as an unrecoverable server error can now distinguish a transient store outage from a genuine internal fault.
- 2024eca: Fix: the settings REST doors now supply the effective tenancy posture to the shared authorization resolver, so both posture-conditional API-key refusals apply here — and the tenant this seam hands onward is a vetted one.
  
  Under a wall-enforcing posture (`isolated`), an API key stamped with an organization its owner has left is refused, as is a key carrying no organization at all. Previously neither guard ran at this door, because both are conditional on a posture the caller supplies and this seam supplied none — the key's tenant was its own stored `active_organization_id`, never checked against current membership. This gate does not merely admit the principal: it returns that tenant onward as the resolved settings tenant, so an unvetted claim became the verdict the read/write path acted on. A browser session whose stored active organization is no longer backed by a membership now has that claim dropped here too, rather than passed through.
  
  The posture is read from the kernel's `tenancy` service, so it is the posture in force rather than the one requested through `OS_TENANCY_POSTURE`. A deployment that registers no `tenancy` service is unchanged: there is no wall there, and no posture-conditional refusal applies. A `tenancy` service that is registered and fails to build is an outage rather than a quiet admission.
- b398ad2: **BREAKING (behaviour):** a static `readonly` field is now stripped from a **non-system caller's INSERT payload inside `engine.insert`**, exactly as it already was on `engine.update`. A non-system create that used to write a read-only column now has that column dropped, reported through `onFieldsDropped` / `droppedFields`, logged at `warn`, and refused outright under `strictReadonlyWrites`. Seeding a read-only column at create time is a **system** act — use `context.isSystem`, a flow's `runAs: 'system'`, a system hook or a seed.
  
  Until now the create-side strip lived only at the DataProtocol ingress (`stripReadonlyForInsert` in `@objectstack/metadata-protocol`), so `readonly` meant one thing on insert and another on update: every external REST/GraphQL/MCP create was stripped, while a caller reaching `engine.insert` directly — the automation engine's `create_record` among them — wrote the column with no refusal, no `WARN` and no dropped-field event.
  
  - `stripReadonlyForInsert` and its five call sites in `@objectstack/metadata-protocol` are **deleted**, not kept as a second implementation; every create face — `createData`, `cloneData`, `createManyData`, `insertManyData`, and `batchData`'s `create` rows and both arms of `upsert` that create — now hands the caller's payload to the engine whole, and every face whose response carries `droppedFields` (`createData`, `createManyData`, `insertManyData`, every `batchData` row that created) reports the engine's own verdict there, so `droppedFields` says the same thing at each of those seams. `cloneData` forwards whole but reports nothing on the wire: its response contract (`CloneDataResponseSchema`, declared as produced) has no `droppedFields` member, so a clone that carried or overrode a read-only column is stripped and logged at `warn` but not reported in the 201 body — adding that key is a spec change, not part of this one.
  - `create_record` (`@objectstack/service-automation`) starts receiving readonly drops on the `onFieldsDropped` channel it has been wired for since #3407 — a flow without `runAs: 'system'` that seeds a read-only column now reports a node warning and `output.droppedFields` instead of a clean success. That package's own code changes only in prose; the traffic is new, the surface is not.
  - Unchanged, deliberately: `isSystem` is still the exemption; `preserveAudit` is still an UPDATE-path exemption and a create that asks for it is told so out loud; runtime-owned types (`autonumber`) keep their own pass and their own wider whitelist; platform objects (`managedBy`, the `sys_` namespace) are still left to their own field-write guards; `readonlyWhen` still has no create-side strip. A stripped key's `defaultValue` is re-derived, so a forged `approval_status` becomes `draft` rather than NULL.
  - `@objectstack/service-settings` is `patch`: prose only — the `upsertRow` docblock, which ships in the package's `.d.ts`, no longer states the superseded INSERT exemption; it names the platform-object carve-out that actually keeps a `sys_setting` insert outside the strip.
  - `@objectstack/lint` and `@objectstack/spec` are `patch`: both change prose only. All three lint rules — `validate-readonly-action-writes`, `validate-readonly-flow-writes`, `validate-readonly-hook-writes` — drop the superseded "INSERT is exempt" premise from their docblocks and from the justification of their green control cases; the two non-elevated rules now name their `insert`/`create` silence as a scan gap rather than an exemption (the action rule additionally records its now-reasoned refusal as a module-local constant that its `index` does not re-export, so no public surface widens). The spec change is prose only: one docblock sentence that named the deleted function, the `strictReadonlyWrites` contract docblock (which now states what strict refuses on insert), and the `readonly` liveness-ledger verdict, whose evidence pointer named the deleted ingress strip.
  
  <!-- adr-0087: not-required (no-migration-prescription) The BREAKING here is a WRITE-PATH BEHAVIOUR change, not a retirement of an authorable or published surface, so there is nothing for the ledger to carry to `objectstack migrate meta`, `spec-changes.json` or the upgrade guide: no spec property, metadata key, accepted value or exported symbol disappears, and this body prescribes no FROM/TO migration. The remedy for an affected caller is to declare the write trusted (`context.isSystem` / `runAs: 'system'`), which is application code, not a metadata migration. The obvious retirement candidate is a non-question in the same direction: `stripReadonlyForInsert` was a bare module-private `function` in `packages/metadata-protocol/src/protocol.ts`, absent from that package's `index.ts` (the only path its `exports` map offers), so no consumer could name it. -->
- Updated dependencies [fe0d9a4]
- Updated dependencies [ecd2158]
- Updated dependencies [f2b5e46]
- Updated dependencies [2ed6be6]
- Updated dependencies [ed7243d]
- Updated dependencies [6ba0db4]
- Updated dependencies [625b0c3]
- Updated dependencies [233222e]
- Updated dependencies [07f40e5]
- Updated dependencies [ceb4877]
- Updated dependencies [e9fcd6b]
- Updated dependencies [90e7e6d]
- Updated dependencies [2bdabe6]
- Updated dependencies [ca326b5]
- Updated dependencies [8f404a5]
- Updated dependencies [159dbad]
- Updated dependencies [68437d4]
- Updated dependencies [abb140c]
- Updated dependencies [8333a6c]
- Updated dependencies [3e3ecb0]
- Updated dependencies [3030369]
- Updated dependencies [d5d8d50]
- Updated dependencies [e08892d]
- Updated dependencies [ae05f2e]
- Updated dependencies [b548e43]
- Updated dependencies [c463d03]
- Updated dependencies [64bd6a3]
- Updated dependencies [13c48c2]
- Updated dependencies [b0529e1]
- Updated dependencies [66dc6ab]
- Updated dependencies [6f94458]
- Updated dependencies [6e67b86]
- Updated dependencies [132742f]
- Updated dependencies [85a2459]
- Updated dependencies [50dc214]
- Updated dependencies [e89fa92]
- Updated dependencies [e9fcd6b]
- Updated dependencies [8976ea1]
- Updated dependencies [56fe8c2]
- Updated dependencies [acabd24]
- Updated dependencies [ab50c8f]
- Updated dependencies [6491463]
- Updated dependencies [89cf4d6]
- Updated dependencies [21c5dcb]
- Updated dependencies [6d4d5d3]
- Updated dependencies [ed5d557]
- Updated dependencies [bca21f7]
- Updated dependencies [e9fcd6b]
- Updated dependencies [2025b1f]
- Updated dependencies [1a7a7c9]
- Updated dependencies [e9fcd6b]
- Updated dependencies [cbca47d]
- Updated dependencies [acf4d38]
- Updated dependencies [ef3a138]
- Updated dependencies [68d5dfd]
- Updated dependencies [3e21cf0]
- Updated dependencies [4cfc93b]
- Updated dependencies [efd6b43]
- Updated dependencies [859ded3]
- Updated dependencies [fa125f3]
- Updated dependencies [74628d9]
- Updated dependencies [a646120]
- Updated dependencies [6f1ce7d]
- Updated dependencies [7778115]
- Updated dependencies [2c753fe]
- Updated dependencies [52804cd]
- Updated dependencies [3f89967]
- Updated dependencies [53cf263]
- Updated dependencies [21aabbc]
- Updated dependencies [9c270bb]
- Updated dependencies [76c8c5a]
- Updated dependencies [088f761]
- Updated dependencies [a84e1ce]
- Updated dependencies [bf1054a]
- Updated dependencies [d8d2776]
- Updated dependencies [222dc0f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [32c917d]
- Updated dependencies [f9a3c32]
- Updated dependencies [f502898]
- Updated dependencies [51ae731]
- Updated dependencies [af7edfe]
- Updated dependencies [b60f48b]
- Updated dependencies [c78c918]
- Updated dependencies [4ca358d]
- Updated dependencies [cf9bda4]
- Updated dependencies [784cb92]
- Updated dependencies [7629f4d]
- Updated dependencies [51df9fd]
- Updated dependencies [a7da4de]
- Updated dependencies [de0bcdd]
- Updated dependencies [70f7d6d]
- Updated dependencies [c677cda]
- Updated dependencies [6acb37e]
- Updated dependencies [7797102]
- Updated dependencies [554a160]
- Updated dependencies [f7da71e]
- Updated dependencies [7f745c3]
- Updated dependencies [0a038cc]
- Updated dependencies [e9fcd6b]
- Updated dependencies [97adce2]
- Updated dependencies [a83482c]
- Updated dependencies [5eb24f8]
- Updated dependencies [2a3decc]
- Updated dependencies [cc00df2]
- Updated dependencies [cc00df2]
- Updated dependencies [f4e6adf]
- Updated dependencies [ee4a59b]
- Updated dependencies [4db3c61]
- Updated dependencies [5ca314a]
- Updated dependencies [e0af1a8]
- Updated dependencies [4771bd9]
- Updated dependencies [414c1fc]
- Updated dependencies [22c0279]
- Updated dependencies [c930f85]
- Updated dependencies [0db2947]
- Updated dependencies [92b5d7f]
- Updated dependencies [613bfbd]
- Updated dependencies [abae16a]
- Updated dependencies [094b8fd]
- Updated dependencies [c7aca0d]
- Updated dependencies [c1d8f98]
- Updated dependencies [8e0b297]
- Updated dependencies [d4f9b2a]
- Updated dependencies [5f7fa1d]
- Updated dependencies [87f0ccc]
- Updated dependencies [aedbaef]
- Updated dependencies [a727043]
- Updated dependencies [c5d6803]
- Updated dependencies [10d05bb]
- Updated dependencies [69602e5]
- Updated dependencies [c3ce76c]
- Updated dependencies [7936b29]
- Updated dependencies [46803fa]
- Updated dependencies [c2a336c]
- Updated dependencies [9f890d3]
- Updated dependencies [0bb2318]
- Updated dependencies [f7db8f4]
- Updated dependencies [1ecee3e]
- Updated dependencies [9408b7f]
- Updated dependencies [2bb0614]
- Updated dependencies [b3820c3]
- Updated dependencies [e9fcd6b]
- Updated dependencies [9bcd9be]
- Updated dependencies [b398ad2]
- Updated dependencies [99261a7]
- Updated dependencies [81b426f]
- Updated dependencies [001af1c]
- Updated dependencies [fb77aa5]
- Updated dependencies [3d3f60e]
- Updated dependencies [581d8f8]
- Updated dependencies [f81afe3]
- Updated dependencies [40a44b9]
- Updated dependencies [f89812e]
- Updated dependencies [7a7fb03]
- Updated dependencies [8fd246d]
- Updated dependencies [021a735]
- Updated dependencies [7bdb163]
  - @objectstack/spec@17.4.0
  - @objectstack/core@17.4.0
  - @objectstack/platform-objects@17.4.0
  - @objectstack/types@17.4.0

## 17.3.0

### Minor Changes

- 8e31083: feat(settings,auth): expose the audience posture in the `auth` settings namespace (#11768)
  
  The audience posture shipped by #11739 (`invite_only | email_domain | open`,
  default `invite_only`) was switchable only from stack config at boot; a
  self-host admin had no console channel. The `auth` settings namespace now
  carries an `audience` group — three new authorable keys, which is what a host
  sees and why this is `minor`:
  
  - `audience_posture` — a select over the closed vocabulary (the option table
    is enforced on `setMany` and on the `OS_AUTH_AUDIENCE_POSTURE` env-override
    door);
  - `audience_allowed_email_domains` — newline- or comma-separated bare domains
    (exact, case-insensitive matching; subdomains need their own entries);
  - `audience_self_registration_permission_set` — the `sys_permission_set` name
    each self-registrant receives.
  
  `bindAuthSettings` maps the three keys — one atomic declaration — to one
  `AuthManager.applyConfigPatch({ audience })`, which replaces the whole
  audience object and validates the MERGED result. Every #11739 invariant holds
  through the new channel: a self-registration posture with verification
  explicitly off, an empty domain list under `email_domain`, and a missing or
  `admin_full_access` permission set are all refused loudly (the standing
  config keeps ruling — fail closed), and off-vocabulary postures are refused,
  never coerced, per the `membership_policy` precedent (#5152). Only EXPLICIT
  settings values apply: the manifest defaults never mask a deployment's
  boot-config declaration. Switching back to `invite_only` always applies —
  leftover text in the posture-hidden sibling fields cannot make closing the
  wall refusable.
- a58eac3: **Security:** `LocalCryptoProvider` selects its crypto posture from the deployment signal only. A test-runner variable inherited by a spawned server can no longer disarm the production key refusal (#11352).
  
  `detectMode` read `env.VITEST` as a vote for `'test'` posture:
  
  ```ts
  if (env.VITEST || env.NODE_ENV === 'test') return 'test';
  ```
  
  `'test'` is not a softer flavour of `'production'`. It is the branch that takes an ephemeral key, never touches disk, and **never refuses to boot** — and that refusal is the reason the class exists: minting a key at boot makes every previously-written `sys_secret` value (encrypted settings, `secret` fields, datasource credentials) undecryptable after the next restart or on another node, invisibly at encrypt time. So one runner variable decided whether a security gate ran at all.
  
  Runner variables are **inherited**. Vitest sets `TEST`, `VITEST`, `VITEST_MODE`, `VITEST_WORKER_ID` and `VITEST_POOL_ID` on its worker, and every process that worker spawns with `{ ...process.env }` receives them. Measured on this repo: a real `os serve` spawned that way booted with production auth and **test** crypto. `packages/cli/test/serve-node-env-production-default.e2e.test.ts` — a pin whose entire subject is *"unset `NODE_ENV` means production"* — ran that way for its whole life, and nothing said a word, because a gate that does not run prints nothing. It surfaced only incidentally, while closing the sibling `TEST` leak into better-auth's origin check one layer down.
  
  **What changes for you.** A process that boots with `NODE_ENV=production`, no `OS_SECRET_KEY`/`OS_DEV_CRYPTO_KEY`, no persisted key file, no `OS_CRYPTO_AUTOKEY` — and a runner variable in its environment — now **refuses to start** instead of running on an ephemeral key. That is the documented fail-loud guarantee arriving where it was previously skipped, not a new restriction: supply the key the refusal names.
  
  ```
  OS_SECRET_KEY=$(openssl rand -hex 32)
  ```
  
  **What does not change.** In-process unit tests still get `test` posture — ephemeral key, disk never touched. The `VITEST` read is deleted rather than narrowed because vitest sets both variables on the same worker (`prepareVitest()`: `process.env.VITEST = "true"; process.env.NODE_ENV ??= "test";`, repeated as `NODE_ENV: process.env.NODE_ENV || "test"` in each worker's env). In-process the two spellings are indistinguishable; they differ only for an **inheriting child**, which is precisely the defect. `NODE_ENV` remains the one signal, and a deployment that declares itself a test deployment still gets test posture.
  
  The whole class is now gated: `pnpm check:runner-env-posture` refuses `TEST`, `VITEST`/`VITEST_*` and `JEST_WORKER_ID` anywhere in product source, so the next author is told at authoring time rather than by an operator whose secrets stopped decrypting. `NODE_ENV` is deliberately not banned — it describes the deployment, and a deployment may declare itself a test deployment; a runner may not declare it on the deployment's behalf.

### Patch Changes

- 99ccbb9: Tell the operator in Settings → AI that `@objectstack/service-ai` has no
  open-edition version to install, instead of three bare "Mount it" lines
  
  Configure any real LLM provider in **Settings → AI** and press *Test
  connection*, and the built-in fallback handler answered — on all three
  real-provider branches — "Mount `@objectstack/service-ai` to exercise live
  calls." This platform's own capability roster says that cannot be done:
  `PLATFORM_CAPABILITY_PROVIDERS.ai` in `@objectstack/spec/kernel` declares
  `edition: 'cloud'`, which `CapabilityEdition` defines as "realized only by a
  cloud runtime tier; there is **no installable version in the open edition**" —
  the un-followable "add it to your dependencies" that framework#3366 exists to
  make legible. The package is in no directory of this repo (0 path hits for
  `/service-ai/` on `main`; `/service-settings/` returns 64 and
  `/embedder-openai/` 8 under the identical command, so the zero is real).
  
  The instruction is **kept** — an operator may well have a cloud tier — and
  gains the boundary it was missing, so one who does not can see the path is
  closed to them.
  
  Worse than a 404, the install succeeds. Measured 2026-08-23 against the public
  npm registry (unauthenticated, `@objectstack/spec` + `@objectstack/cli` as
  positive controls, `@objectstack/service-ai-studio` — the sibling
  `edition: 'cloud'` entry — as a negative control returning 404):
  `@objectstack/service-ai` returns **200** with 57 versions, and the highest is
  **10.3.0** (2026-06-23) — entirely below the 11.3.0 cut the roster note names,
  i.e. the pre-cloud tail left behind on the registry. A determined operator
  following the old sentence installs a seven-major-old AI runtime that
  exact-pins `@objectstack/spec@10.3.0` against this repo's 17.2.0, resolving a
  second spec beside this one. The new message says so, so nobody discovers it
  from a dependency error.
  
  The boundary sentence is **read from the roster**, not hand-written a fourth
  time: `note` is documented as "surfaced verbatim inside the preflight / boot
  error so the message carries its own context", and `packages/cli`'s capability
  preflight already interpolates it the same way. The three provider prefixes
  stay distinct — only the shared trailing sentence converges.
  
  No behaviour change: `ok` and `severity` are untouched on every branch, and the
  embedder hint at the fourth site is deliberately left alone (its package
  **is** built here, so that instruction is followable as written) and pinned by
  a contrast test.
- 6a180e4: fix(core,rest,services)!: a permission-store read failure now fails LOUD instead of resolving as an authenticated caller holding zero capabilities (#13279)
  
  **BREAKING** runtime behaviour change on the shared authorization resolver,
  shipped as `minor` under the repo's launch-window convention.
  
  `resolveAuthzContext`'s per-read helper `tryFind` answered a THROWN read exactly
  the way it answered an EMPTY one: `[]`. So an outage of the permission store
  resolved as a well-formed context for an authenticated principal holding no
  capabilities, and the package-management door answered
  `403 FORBIDDEN` — "Reading packages requires the `studio.access` or
  `setup.access` capability." That answer was measured byte-identical
  (`JSON.stringify` equal, against a control that separates two answers which do
  differ) to what a caller who genuinely holds nothing receives. An administrator
  was told they lack a capability, during an outage of the store that holds the
  capability.
  
  Maintainer ruling 2026-08-30, verbatim 「第一批其余同意」: `tryFind` 区分「无行」
  与「读失败」,读失败 fail-loud —— 权限库不可达时不再解析为「已认证零能力」,而是
  响亮拒绝(与真实能力拒绝的 403 可区分)。
  
  Second maintainer ruling the same day (第 5 场总监席决裁批 #9, verbatim 「同意」),
  after implementing the first one showed that "the read failed" is two facts:
  采**选项 A** —— 把 `isMissingTableError` 从 `@objectstack/metadata` 迁至
  `@objectstack/types`(core 已依赖),metadata 保留 re-export 兼容;`tryFind` 仅对
  **未被判定为「表未 provision」**的读失败抛 `AuthzStoreUnavailableError`。
  
  **What changed.** A permission-store read that is issued and throws now raises
  `AuthzStoreUnavailableError`, which carries the EXISTING ADR-0112 wire code
  `SERVICE_UNAVAILABLE` and status `503`. No code is added to the closed wire
  vocabulary and no response envelope gains or loses a key — only which declared
  code an outage selects. Doors that map thrown errors through
  `resolveThrownHttpError` answer 503 with no per-door change.
  
  **What did NOT change**, and is pinned:
  
  - A reachable, genuinely EMPTY store (reads return no rows) still resolves to
    zero capabilities.
  - A genuine capability denial still answers `403 FORBIDDEN` with its message.
  - An ABSENT engine (`ql` unwired, so no read is ever issued) still resolves to
    an empty-but-valid envelope.
  - Anonymous requests never reach the store, so an outage cannot make them loud.
  - A REAL engine whose `sys_*` tables were never provisioned resolves to zero
    capabilities, quietly — pinned to be byte-identical to the empty-store
    envelope, in every dialect spelling and in the production wrapper shape where
    the driver's phrase is on `cause` rather than the outer message.
  
  **The boundary between the two kinds of read failure.** An earlier revision of
  this changeset claimed "embedders without a data plane are unaffected". That
  claim was too broad; it is retracted here, and the gap it named is now closed
  rather than merely disclosed. A read also throws when the table was never
  PROVISIONED — a real engine, wired and reachable, whose `sys_*` tables were
  never created — and that is a supported deployment shape, not an outage. There
  "zero capabilities" is the TRUE answer rather than a fabrication: nothing is
  provisioned, so nothing was withheld. Only an UNREACHABLE store — the ruling's
  own word 不可达 — leaves the capability set unknown, and only an unknown answer
  may not be reported as a denial.
  
  Treating the two alike was measured, not theorised: it turned four CI suites
  red, all from `no such table` on `sys_user` / `sys_member` /
  `sys_user_position` / `sys_user_permission_set`. Ordinary CRUD in
  `@objectstack/client` answered `503`; batch validation errors that owe `400`
  answered `503`, because authorization refused before validation ran; runtime
  notifications answered `401` where authenticated callers must be served `200`;
  and two `.integration.test.ts` noise guards reported that the driver and engine
  diagnostics for `sys_position` stopped being emitted — the eager throw aborted
  the resolution before that later read was ever issued, so a change made to stop
  a failed read being silent had made two other channels silent.
  
  `tryFind` therefore raises `AuthzStoreUnavailableError` only for a read failure
  that is NOT positively identified as an unprovisioned table.
  
  **`isMissingTableError` moved to `@objectstack/types`.** The classifier that
  draws that boundary already existed and was already right — driver-code based
  rather than prose-sniffing, documented so that "cannot say" never means "be
  loud". It lived in `@objectstack/metadata`, which DEPENDS ON `@objectstack/core`,
  so the resolver could not import it. Rather than keep a second copy of a
  security-relevant predicate, the ruling relocated the one classifier to
  `@objectstack/types` — the package core already depends on, and the repo's own
  stated Home rule for a cross-package error predicate ("every consumer of the
  question already depends on it, so adopting the predicate never adds an edge",
  `packages/types/src/unique-violation.ts`). `@objectstack/metadata/errors` still
  exports `isMissingTableError`, re-exported from the new home, so no consumer of
  that published subpath changes.
  
  Its sibling `isSchemaAlreadyExistsError` moved with it — the two are not two
  modules but two signatures over one matcher, and separating them would have
  meant re-rolling the matcher, which is the duplication the module exists to
  prevent. Both are now exported from `@objectstack/types`; the metadata subpath
  deliberately still publishes only `isMissingTableError`, which is the only one
  anything imports through it.
  
  ⚠️ **Signed-off risk, recorded because it is load-bearing.** Gating loudness on
  a driver-error predicate was approved with its false-positive direction stated:
  mis-reading a genuine outage as "table not provisioned" silently restores the
  quiet 403 this change removes, with no thrown error and no other failing test.
  That direction is accepted, not overlooked — the predicate keys on driver codes,
  SQLSTATEs and errnos first, excludes the known superstring traps up front, and
  returns `false` for anything it does not positively recognise, so an
  unrecognised outage stays loud by default. The risk is written beside the
  predicate in `resolve-authz-context.ts` and both directions are pinned by name
  in `authz-store-unavailable.test.ts`. ⛔ Do not widen `isMissingTableError` to
  make a first boot quieter: every widening moves outages into the quiet branch.
  
  **All-transport, not just REST.** Every transport authorizing through
  `resolveAuthzContext` inherits this. Six of the eight production transports
  wrapped the call in a fail-closed `catch` that would have re-silenced the
  outage — measured, not assumed: with the resolver loud but the nets untouched,
  the package door answered `401`, i.e. the outage merely changed disguises. Those
  `catch` blocks now re-raise via `isAuthzStoreUnavailableError` and keep their
  previous behaviour for every other fault. The transport set is rebuilt from
  source and audited for set equality on every test run, so a transport added
  later cannot inherit the old silence unnoticed.
  
  Callers that treat any throw from `resolveAuthzContext` as "anonymous" should
  re-raise `isAuthzStoreUnavailableError(err)` instead: degrading it restores the
  disguise this removes.
  
  <!-- adr-0087: not-required (runtime-interface-only packages/core/src/security/resolve-authz-context.ts#ResolvedAuthzContext, packages/core/src/security/authz-store-unavailable.ts#AuthzStoreUnavailableError) The breaking surface is runtime TypeScript in `@objectstack/core`'s security module and nothing else: `resolveAuthzContext` stops always-resolving and raises `AuthzStoreUnavailableError` when a permission-store read is issued and throws. NO metadata surface is touched in either direction. No Zod schema changes, no `packages/spec` declaration is added or removed, no authorable key moves, no stored row shape changes, and no object definition is edited — a customer's metadata app is byte-for-byte unaffected, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The wire vocabulary is likewise untouched: `SERVICE_UNAVAILABLE` is an EXISTING `StandardErrorCode` member that `HttpStatusErrorCodeMap` already maps to 503, so this change only selects a different DECLARED code for an outage rather than adding one. Both named symbols resolve at HEAD as exported declarations whose files are not `*.zod.ts`, are not under `packages/spec/src/contracts/`, are not object definitions and are not `z.input` projections; neither is referenced in code by any metadata surface (the `packages/spec` hits for `resolveAuthzContext` are comment prose describing the envelope, which this gate masks). The channel that reaches an affected consumer is therefore code review and this changeset, never the upgrade guide: a ledger entry could not express "your fail-closed catch should re-raise this error", because there is no metadata for a migration to rewrite. -->
- e7191ce: fix(build): give each `exports` condition its own `types` target in the 28 dual-build packages (#13112)
  
  **Published-surface change, zero runtime change.** No emitted byte moves; what
  moves is which declaration file a resolver READS. Maintainer ruling 2026-08-29
  (decision batch #3, verbatim 「同意」) chose declaring the files over deleting
  them.
  
  ## What was wrong
  
  These 28 packages are `"type": "module"` and dual-built, and each spelled one
  `types` condition as a **sibling** of `import`/`require`:
  
  ```json
  "exports": { ".": {
    "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs"
  } }
  ```
  
  A sibling `types` answers for **both** conditions, so a CommonJS consumer was
  handed `dist/index.d.ts` — an ES-module declaration, because the package is
  `"type": "module"` — for an entry point it reaches with `require`. Measured with
  `tsc --traceResolution` on a `"type": "commonjs"` fixture at `moduleResolution:
  node16`:
  
  ```
  error TS1479: The current file is a CommonJS module whose imports will produce
  'require' calls; however, the referenced file is an ECMAScript module and cannot
  be imported with 'require'.
  ```
  
  The JavaScript at `dist/index.cjs` loads perfectly (`check:dual-build-cjs-loads`
  has asserted that for months). It is the **types** that told the consumer the
  supported `require` entry point could not be required. The `dist/index.d.cts`
  twin tsup emits beside it — 36 files, 5,517,701 B on this build — was named by
  no condition at all and shipped in every tarball unreachable.
  
  ## What changed
  
  Each condition now names its own declaration, the shape TypeScript documents:
  
  ```json
  "exports": { ".": {
    "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  } }
  ```
  
  33 entry points across 27 packages, subpaths included. The root `types` field is
  untouched, so `node10` resolvers are unaffected; the `import` condition resolves
  exactly what it resolved before, measured as an unchanged control in the same
  run.
  
  ## `@objectstack/core` is deliberately NOT changed
  
  Splitting a declaration in two makes TypeScript compare it nominally, and
  `ObjectKernel` carries a `private plugins` member that reaches every plugin
  through `PluginContext.getKernel()`. With core split, whole-repo `pnpm build`
  fails in `@objectstack/verify` with 5 × TS2345 ("Types have separate
  declarations of a private property 'plugins'"); with core held back and the
  other 27 split, 71/71 tasks pass. So core keeps the sibling-`types` shape and
  its two `.d.cts` files (220,854 B) stay unreachable, declared as such in
  `check:dual-build-cjs-loads`. Splitting it needs a decision about core's public
  types, not about an exports map.
  
  ## For consumers
  
  - **ESM consumers: nothing changes.** Same declaration file, byte for byte.
  - **CJS consumers under `node16`/`nodenext`: TS1479 goes away** and the
    declarations they get are the ones built for CommonJS.
  - **`node10` / `moduleResolution: node` consumers: nothing changes** — they never
    read `exports`.
  - Nothing is removed: every path that resolved before still resolves.
  
  Packages that are CJS-first (`require` → `./dist/index.js`, no `"type": "module"`)
  were already correct and are untouched — their `dist/index.d.ts` really is the
  CommonJS declaration. Their ESM mirror (an unreachable `.d.mts` under the
  `import` condition) is a separate, larger population and is filed separately per
  the ruling, not fixed here.
  
  `check:dual-build-cjs-loads` grew a fourth invariant (TYPED) that reds on the old
  shape, so the drift cannot return silently.
- e7f56d6: Make the settings engine facade and the metadata database loader bind the row
  they resolved, not a row the payload names
  
  Two ingresses resolved an authoritative row id and then folded it into the
  write payload with the **losing** spread order — `{ id, ...data }` — so a
  caller-supplied `data.id` spread over the id the ingress had just resolved and
  silently retargeted the write:
  
  - `wrapEngineAsSettingsEngine`'s by-id `update` branch
    (`@objectstack/service-settings`), whose id comes from the caller's
    `where.id`.
  - `DatabaseLoader._update` (`@objectstack/metadata`), whose id arrives as a
    separate parameter every caller resolves first (`existing.id`, from the read
    immediately above).
  
  Both now spell it `{ ...data, id }` — the operation's id **after** the spread,
  so it wins. That is the convention the repo's other two ingresses already
  document: `rest-server.ts`'s batch update arm ("the operation's id AFTER the
  spread, so it wins") and `protocol.updateData`'s #6479 fix
  (`{ ...request.data, id: request.id }`).
  
  **No wrong write is known to have been reachable.** Both sites' current callers
  build fresh field literals and never put an `id` inside `data`, so this is
  hardening a fragile pattern rather than repairing a measured defect. What makes
  it worth the three characters is that neither site can be caught downstream:
  both pass **no `where`** to the engine, so the payload is the only id the engine
  ever sees, and the engine's conflicting-id refusal (`UPDATE_ID_MISMATCH`, 400)
  needs two disagreeing declarations before it can fire. The fold is the entire
  trust boundary at both sites, and it is one refactor — a caller handing back a
  row copy, and rows carry `id` — from the #6479 shape.
  
  Both are pinned with a payload whose `id` names a **different** row than the
  one the ingress resolved, asserting the resolved row is still the row bound. A
  pin exercising a payload without an `id` would have passed against both
  spellings. The doubles answer "which row does this bind?" with the producer's
  own `assertEngineUpdateDispatch`, so they cannot be kinder about it than a
  running server.
- 66bbb4c: Tell the operator where `@objectstack/knowledge-turso` comes from instead of
  naming a package this repo does not build
  
  An operator who selects the `turso` knowledge adapter in **Settings → AI &
  Embedder** and runs the connection test was told: "Mount
  `@objectstack/knowledge-turso` to exercise live calls." That package is in no
  directory of this repo (0 path hits on `main`; `knowledge-memory` and
  `knowledge-ragflow` return 8 each under the identical command, so the zero is
  real), and the message said nothing about where it does come from — leaving the
  instruction un-followable at exactly the moment it is read.
  
  The prior question the card turned on — *is it published anywhere?* — is now
  measured rather than assumed. Against the public npm registry on 2026-08-23,
  with `@objectstack/spec` and `@objectstack/cli` as positive controls and
  `@objectstack/security-enterprise` as a known-private negative control:
  `@objectstack/knowledge-turso` **is published**, `latest` 6.9.0 (2026-05-27),
  nine versions from 6.4.0. So the option stays — dropping it would have deleted a
  working adapter.
  
  What it is *not* is co-installable with this platform version: 6.9.0 exact-pins
  `@objectstack/spec@6.9.0` while this repo ships 17.2.0, so mounting it resolves a
  second spec rather than reusing this one. The runtime message now names the
  package, says this platform does not ship it, points at the ObjectStack Cloud
  monorepo where it is built, and tells the operator to check for a release
  matching their platform version — the framework#3366 discipline that an install
  hint must carry its own edition/version boundary.
  
  The manifest's adapter-list comment loses the undated "mirrors the plugin
  packages currently published" claim that stopped being true with nothing to
  catch it, and gains the measurement with its date and method so the next reader
  can re-run it. No behaviour change: `ok` and `severity` are untouched on every
  branch of the test action.
- fc8627e: docs(service-settings): state `getMany`'s all-or-nothing key validation on the declaration that owns it (#11680)
  
  Documentation and a pin. **No behaviour change** — the accept set and every
  resolved value are byte-identical.
  
  `SettingsService.getMany` validates **every** requested key against the
  namespace manifest before it reads a single env override and before it loads a
  single row, so one undeclared key rejects the whole call with
  `UnknownKeyError` (`code: 'SETTINGS_UNKNOWN_KEY'`) and the caller receives
  nothing — not the subset it was entitled to. N per-key `get()` calls behave
  differently on exactly that input: each declared key still answers, and only
  the undeclared one throws.
  
  The doc comment was otherwise detailed — it explained the grouped row load and
  the env-override ordering, and claimed row-for-row equivalence with per-key
  `get` "BY CONSTRUCTION" — but never drew this line. That equivalence claim
  holds for every key that *resolves* and not for the refusal, so a batched
  consumer had to rediscover the rule from a test. `resolveLocalizationContext`
  was the first to inherit it and had to record the consequence locally: a host
  registering a **partial** `localization` manifest loses all its keys at once
  and drops to a shorter cascade, where the per-key path would still have
  resolved the declared ones.
  
  `getMany`'s doc comment now states the rule, its blast radius, why validating
  ahead of the grouped walk makes the refusal independent of key order and scope
  grouping, and what a caller on a partial manifest should expect.
  
  The pre-existing pin asserted only `rejects.toThrow(/nope/)` — green whatever
  the blast radius is. A sibling pin now asserts the property instead: the error
  envelope (`code: 'SETTINGS_UNKNOWN_KEY'`), that **zero** rows were loaded
  (the refusal is up-front, with the undeclared key last in the request), and
  the contrast that per-key `get()` still answers each declared key.
- 050d8d8: `loadRows` user-keyed engine loads now include tenant/global rows (`$or` over `user_id`/upper scopes), mirroring the in-memory branch. Fixes the user→tenant→global read cascade dying at the user level and upper-scope locks never firing on user-scope writes, on engine-bound deployments (#11228).
- 47d9b77: The SMTP port range `1-65535` is now declared once and the refusal is generated from it (#12993). It had been hand-written three times across two packages: the enforcement in `SmtpTransport`, the `(expected 1-65535)` literal in the very next line's message, and `min: 1, max: 65535` on the mail settings form's `smtp_port` field — which `@objectstack/service-settings` really does enforce (`declaredBounds` / `validatePatch`), so it is a second door rather than decoration. The first two were adjacent lines, the cheapest possible drift: changing the check without changing the sentence yields a refusal that misstates its own rule, and nothing fails.
  
  `transports/smtp-port-contract.ts` now owns `SMTP_PORT_MIN` / `SMTP_PORT_MAX`, the predicate that applies them and the sentence that states them. The message text is **generated** rather than re-spelled, so the second spelling no longer exists to drift — the stronger of the two repairs the card named, since it deletes the drift instead of checking for it.
  
  Nothing is accepted or refused that was not before. The move is pinned as behaviour-preserving against the previous inline expression, kept verbatim as the oracle, over a table that includes both edges, the non-finite values and the non-integers.
  
  The settings manifest keeps its own numbers deliberately. `@objectstack/service-settings` does not depend on `@objectstack/plugin-email`, and the plugin depends on the service only as a test-only devDependency; making the manifest import the constant would add a runtime edge from a service to a plugin, invert the layering and pull `nodemailer` into the settings service's install closure. So the two are held equal by a cross-package assertion over that existing devDependency instead — the same mechanism that already holds the provider dropdown equal to `EMAIL_TRANSPORT_PROVIDERS` — and no new dependency edge is created in either direction.
  
  This range is **not** the CLI's listen range and must never be merged with it: `os serve` floors at `0` because port 0 asks the OS to choose one to listen on, while an SMTP port is a destination and floors at `1`. Collapsing them onto one constant would silently make `0` a legal SMTP port, so the floor is pinned explicitly.
- Updated dependencies [809d417]
- Updated dependencies [387e231]
- Updated dependencies [f794e4e]
- Updated dependencies [cae2169]
- Updated dependencies [b812a54]
- Updated dependencies [2d4fa75]
- Updated dependencies [0e4e51b]
- Updated dependencies [e84bbf6]
- Updated dependencies [effae80]
- Updated dependencies [efb3513]
- Updated dependencies [d62f990]
- Updated dependencies [c45d8e6]
- Updated dependencies [2e3e8c7]
- Updated dependencies [e621291]
- Updated dependencies [655b106]
- Updated dependencies [40a93b5]
- Updated dependencies [101ad2c]
- Updated dependencies [d5b330d]
- Updated dependencies [dda969c]
- Updated dependencies [1f45690]
- Updated dependencies [277948f]
- Updated dependencies [8bdd955]
- Updated dependencies [f3bbbef]
- Updated dependencies [4f24e9d]
- Updated dependencies [e27583e]
- Updated dependencies [4bd6faa]
- Updated dependencies [86cbe37]
- Updated dependencies [6a180e4]
- Updated dependencies [474242f]
- Updated dependencies [63cd487]
- Updated dependencies [bd4aa4e]
- Updated dependencies [803eaab]
- Updated dependencies [f8e8f03]
- Updated dependencies [983edf1]
- Updated dependencies [eae824e]
- Updated dependencies [f6fa22c]
- Updated dependencies [8a483b3]
- Updated dependencies [3bc2e38]
- Updated dependencies [97bcd99]
- Updated dependencies [df59de0]
- Updated dependencies [96e25a8]
- Updated dependencies [f75a38a]
- Updated dependencies [7a25e7d]
- Updated dependencies [1fa05a6]
- Updated dependencies [c85a265]
- Updated dependencies [dcb10a5]
- Updated dependencies [773a999]
- Updated dependencies [35dffea]
- Updated dependencies [d8024f0]
- Updated dependencies [8120808]
- Updated dependencies [776a098]
- Updated dependencies [5060877]
- Updated dependencies [4f6325d]
- Updated dependencies [52954c0]
- Updated dependencies [2aa8456]
- Updated dependencies [93809a3]
- Updated dependencies [7c0d0c3]
- Updated dependencies [daae7aa]
- Updated dependencies [8dc22d6]
- Updated dependencies [a392dbf]
- Updated dependencies [279431e]
- Updated dependencies [948dd6b]
- Updated dependencies [3b4c56c]
- Updated dependencies [ae8edd2]
- Updated dependencies [e25403c]
- Updated dependencies [a81aa9d]
- Updated dependencies [64baa68]
- Updated dependencies [9fa70d7]
- Updated dependencies [09db64a]
- Updated dependencies [92916e7]
- Updated dependencies [a84f3ea]
- Updated dependencies [f2eaae8]
- Updated dependencies [56c093c]
- Updated dependencies [c09451b]
- Updated dependencies [ba64877]
- Updated dependencies [7345308]
- Updated dependencies [79b6a22]
- Updated dependencies [30d96ab]
- Updated dependencies [f658793]
- Updated dependencies [c95ad19]
- Updated dependencies [e58ea8b]
- Updated dependencies [4a17645]
- Updated dependencies [3795c5f]
- Updated dependencies [8ab926b]
- Updated dependencies [7317cf2]
- Updated dependencies [e25e839]
- Updated dependencies [5997207]
- Updated dependencies [8b13cc8]
- Updated dependencies [4a4a35d]
- Updated dependencies [86e765a]
- Updated dependencies [1d7e76a]
- Updated dependencies [53dc739]
- Updated dependencies [fd289be]
- Updated dependencies [03bf7b1]
- Updated dependencies [f90e820]
- Updated dependencies [18d816a]
- Updated dependencies [e8bd715]
- Updated dependencies [b91c351]
- Updated dependencies [a28a3c0]
- Updated dependencies [daeaaf9]
- Updated dependencies [c459da6]
- Updated dependencies [e914733]
- Updated dependencies [f887e52]
- Updated dependencies [881f8d8]
- Updated dependencies [3bfa1e6]
- Updated dependencies [0a8ebf3]
- Updated dependencies [901355c]
- Updated dependencies [34ce8e7]
- Updated dependencies [33681ea]
- Updated dependencies [bfe13c8]
- Updated dependencies [0fb3044]
- Updated dependencies [4635f3e]
- Updated dependencies [fd289be]
- Updated dependencies [ee3595c]
- Updated dependencies [09b4f4e]
- Updated dependencies [b2eab95]
- Updated dependencies [93940d4]
- Updated dependencies [3a04b01]
- Updated dependencies [45b9051]
- Updated dependencies [3954fb7]
- Updated dependencies [4805b56]
- Updated dependencies [b9e9227]
- Updated dependencies [d395692]
- Updated dependencies [5894d30]
- Updated dependencies [a3765f6]
- Updated dependencies [2d5cee3]
- Updated dependencies [e22158f]
- Updated dependencies [7404925]
- Updated dependencies [0c2334f]
- Updated dependencies [778c59f]
- Updated dependencies [d2619fd]
- Updated dependencies [af56546]
- Updated dependencies [6acb11a]
- Updated dependencies [33c5fd3]
- Updated dependencies [20b0fdb]
- Updated dependencies [905019b]
- Updated dependencies [a286411]
- Updated dependencies [98c0d33]
- Updated dependencies [368a82e]
- Updated dependencies [a3d5724]
- Updated dependencies [93ea19b]
- Updated dependencies [9ee2dcf]
- Updated dependencies [8cb96ec]
- Updated dependencies [8f10a79]
- Updated dependencies [6269a55]
- Updated dependencies [a17da05]
- Updated dependencies [a8c00e2]
- Updated dependencies [22e5236]
- Updated dependencies [0fb8760]
- Updated dependencies [e5ce2ed]
- Updated dependencies [be21955]
- Updated dependencies [bc56e18]
- Updated dependencies [be21955]
- Updated dependencies [a9ee989]
- Updated dependencies [4d0d944]
- Updated dependencies [15d58db]
- Updated dependencies [d63b014]
- Updated dependencies [9abe4e4]
- Updated dependencies [2cc7122]
- Updated dependencies [50d6c92]
- Updated dependencies [9e0ba21]
- Updated dependencies [311433f]
- Updated dependencies [3e5ad08]
- Updated dependencies [9abe4e4]
- Updated dependencies [b7131f3]
- Updated dependencies [e5812fa]
- Updated dependencies [7085f90]
- Updated dependencies [dee4dd4]
- Updated dependencies [ce7e497]
- Updated dependencies [51ecb2f]
- Updated dependencies [9086761]
- Updated dependencies [f6344e7]
- Updated dependencies [42a117b]
- Updated dependencies [1401ae7]
- Updated dependencies [4297fe7]
- Updated dependencies [e398863]
- Updated dependencies [d16df74]
- Updated dependencies [d79c602]
- Updated dependencies [f11fc61]
- Updated dependencies [e808890]
- Updated dependencies [8f79379]
- Updated dependencies [e6ca40e]
- Updated dependencies [0c77ea4]
- Updated dependencies [52954c0]
- Updated dependencies [89eb997]
- Updated dependencies [7131f12]
- Updated dependencies [aa5994e]
- Updated dependencies [be93457]
- Updated dependencies [a65db76]
- Updated dependencies [2cf5a96]
- Updated dependencies [15eb2c9]
- Updated dependencies [5691b07]
- Updated dependencies [2a6122b]
- Updated dependencies [225e769]
- Updated dependencies [8af88dd]
- Updated dependencies [fb5fbb8]
- Updated dependencies [d7b3963]
- Updated dependencies [33184fd]
- Updated dependencies [7c41693]
- Updated dependencies [b72db01]
- Updated dependencies [dce5cd4]
- Updated dependencies [9688f58]
- Updated dependencies [556ebc1]
- Updated dependencies [177ebdc]
- Updated dependencies [8d237b4]
- Updated dependencies [2d2e6f0]
- Updated dependencies [2d8dd8d]
- Updated dependencies [22d573e]
- Updated dependencies [b5a2398]
- Updated dependencies [348860c]
- Updated dependencies [5383fa6]
- Updated dependencies [5b3ff63]
- Updated dependencies [1a6a19c]
- Updated dependencies [064d484]
- Updated dependencies [527e050]
- Updated dependencies [dd33bf9]
- Updated dependencies [4cb2a90]
- Updated dependencies [74a7804]
- Updated dependencies [53d3689]
- Updated dependencies [b3a63d3]
- Updated dependencies [49f0dcf]
- Updated dependencies [033a34c]
- Updated dependencies [4d25d22]
- Updated dependencies [1ffee51]
- Updated dependencies [5ae4303]
- Updated dependencies [ece4dad]
- Updated dependencies [e9b377e]
- Updated dependencies [146f448]
- Updated dependencies [735f5c7]
- Updated dependencies [a7e18de]
- Updated dependencies [366f895]
- Updated dependencies [dc75ba8]
- Updated dependencies [cce0aa9]
- Updated dependencies [e764507]
- Updated dependencies [cff17af]
- Updated dependencies [39404f3]
- Updated dependencies [ca1965f]
- Updated dependencies [8619f95]
- Updated dependencies [b706af9]
- Updated dependencies [db8c288]
- Updated dependencies [0e5fe7f]
- Updated dependencies [add4360]
- Updated dependencies [e0abc38]
- Updated dependencies [fc9ba76]
- Updated dependencies [0f94cc7]
- Updated dependencies [a11c1a5]
- Updated dependencies [71f9cd1]
- Updated dependencies [ee17d86]
- Updated dependencies [cdbd920]
- Updated dependencies [18c432e]
- Updated dependencies [3c418c4]
- Updated dependencies [fa8715a]
- Updated dependencies [a933ed7]
- Updated dependencies [b3ca463]
- Updated dependencies [a933ed7]
- Updated dependencies [0d4a6a8]
- Updated dependencies [518d5e5]
- Updated dependencies [6643ba1]
- Updated dependencies [eeba2ef]
- Updated dependencies [ec4c4d2]
- Updated dependencies [424f73c]
- Updated dependencies [cccbe51]
- Updated dependencies [a8d6b1d]
- Updated dependencies [e4a7695]
- Updated dependencies [87075b1]
- Updated dependencies [fc58a99]
- Updated dependencies [14cfc00]
- Updated dependencies [1c6f7b4]
- Updated dependencies [e854a53]
- Updated dependencies [dfebfc8]
- Updated dependencies [598b7ec]
- Updated dependencies [d028b37]
- Updated dependencies [f7b25c5]
- Updated dependencies [122ef38]
- Updated dependencies [4a37870]
- Updated dependencies [428f9b2]
- Updated dependencies [aa7ff56]
- Updated dependencies [811a3c2]
- Updated dependencies [1401ae7]
- Updated dependencies [2fd3f1c]
- Updated dependencies [c41b42e]
- Updated dependencies [c4db311]
- Updated dependencies [750fff5]
- Updated dependencies [c19035e]
- Updated dependencies [ececf7a]
- Updated dependencies [d173125]
- Updated dependencies [8eeca27]
- Updated dependencies [8425c17]
- Updated dependencies [a5ef1d8]
- Updated dependencies [87ad30c]
- Updated dependencies [772d5de]
- Updated dependencies [ce80ec2]
- Updated dependencies [b372318]
- Updated dependencies [97a2263]
- Updated dependencies [29d0676]
- Updated dependencies [0169d49]
- Updated dependencies [6bd3231]
- Updated dependencies [d2b5ba8]
- Updated dependencies [b799ac5]
- Updated dependencies [8f74307]
- Updated dependencies [d23dc08]
- Updated dependencies [644ad50]
- Updated dependencies [9735662]
- Updated dependencies [4d5b4f8]
- Updated dependencies [0da7cd2]
- Updated dependencies [28a5c3e]
- Updated dependencies [4bc18e5]
- Updated dependencies [9f57f1e]
  - @objectstack/spec@17.3.0
  - @objectstack/platform-objects@17.3.0
  - @objectstack/core@17.3.0
  - @objectstack/types@17.3.0

## 17.2.0

### Patch Changes

- ba6c9ed: `SettingsService.getMany(namespace, keys, ctx)` resolves several same-namespace keys with at most two row loads instead of one per key (#10826) — env-overridden keys still answer without touching the store, and every key's value/source/lock/cascade deep-equals the per-key `get()` answer by construction (the cascade is extracted, not copied). `getNamespace` resolves through the same grouped path.
- a24b7fa: Make the settings ordering contract **declared and enforced**, and make the
  residual pre-bind READ audible (#10250).
  
  `SettingsServicePlugin` binds its data engine from a `kernel:ready` hook
  registered in its `start()`. Three shipped plugins read a settings namespace
  from a `kernel:ready` hook registered in *their* `start()` — `plugin-email`
  (`mail`: SMTP/provider/from-address), `service-sms` (`sms`: provider
  credentials and the daily cost ceiling) and `service-storage` (`storage`:
  backend and credentials). Hooks fire in registration order, so a reader that
  started before the settings plugin read `SettingsService`'s in-memory fallback,
  which is empty at boot: the caller received the manifest **default** with
  `source: 'default'` and `locked: false`, no diagnostic anywhere, while the
  operator's saved row sat unread in `sys_setting`.
  
  Nothing constrained that order. None of the three declared any dependency on
  `com.objectstack.service.settings`, so their position was pure `kernel.use()`
  order. It was correct under `os serve` only because the always-on slate happens
  to list `settings` first — and `serve` *prepends* an app's declared `requires`,
  so an ordinary `requires: ['email']` produced email-before-settings and bypassed
  that; cloud's per-tenant runtime mounts the slate from its own wiring.
  
  Three changes, one contract:
  
  - **Declared order.** Each of the three plugins now declares
    `optionalDependencies: ['com.objectstack.service.settings']`. The kernel
    resolves both the init and the start phase from that graph
    (`resolvePluginOrder`, ADR-0116), so the bind is ordered ahead of the read
    wherever the plugin is composed, in any host. Soft, not hard: a kernel with
    no settings service still boots these plugins unchanged.
  - **The residual is audible.** A settings read issued while a bind is
    *declared but pending* now emits one operator-actionable `warn` per namespace
    naming the repair. Deliberately not a refusal — an in-window read of a
    setting with genuinely no persisted row must answer the manifest default, and
    refusing would turn a correct startup sequence into an error. It stays silent
    in every case that is not the window: after `bindEngine`, on a kernel with no
    `objectql` at all (`settleWithoutEngine`), for a directly constructed
    `SettingsService`, and for a read satisfied by an `OS_*` env override.
  - **The slate pin now derives its boundary.** The foundational-prefix
    assertion covered `slice(0, 6)` while `sms` — a settings reader — sits at
    index 6, one past the end. The new pin
    (`packages/cli/src/commands/serve-settings-ordering.pin.test.ts`) states the
    rule instead of the count: every always-on entry that is not one of the
    services others bind into at `kernel:ready` must be mounted after all of
    them. An entry added tomorrow is covered wherever it lands.
  
  No behaviour changes for a deployment whose order was already correct.
- 1ec36b7: **Behaviour change (tightening, boot-time only):** a settings write issued before `SettingsService`'s data engine is bound is now **refused loudly** instead of resolving successfully while nothing reaches `sys_setting` (#10159).
  
  `upsertRow` picks its store on `if (this.engine)`, and the engine is bound in exactly one place — `SettingsServicePlugin` registers a `kernel:ready` hook from its `start()` and calls `bindEngine` inside it. `kernel:ready` handlers run in registration order and every plugin's `init()` runs before any plugin's `start()`, so **every `kernel:ready` hook registered from an `init()` fires inside that window**. A `set()` from there landed in the in-process memory fallback, re-resolved off that same array, and handed the caller a fully resolved value; `sys_setting` received nothing, and neither audit ledger recorded anything (both sinks bind on the same `bindEngine` call). Nothing was logged at any level, because the write did not fail — it succeeded against the wrong store.
  
  **What an operator will now observe.** A write in that window throws `SettingsEngineNotBoundError` — code `SETTINGS_ENGINE_NOT_BOUND`, status **503** — whose message names the window, the reason, and the fix: move the write to `kernel:bootstrapped` (or later), which fires strictly after every `kernel:ready` handler has settled. Previously that same call returned a resolved value and the setting was silently absent after restart.
  
  **Nothing outside the window changes.** The refusal is armed only by the new opt-in `SettingsServiceOptions.engineBindPending`, which `SettingsServicePlugin` sets in `init()` and clears on both branches of its `kernel:ready` hook — by `bindEngine` when `objectql` is present, or by the new `SettingsService.settleWithoutEngine()` when it is not. So:
  
  - a `SettingsService` constructed directly (unit tests, bootstrap, control-plane mock) keeps the in-memory fallback exactly as before — it declares no pending bind, and the guard never arms;
  - a lean kernel with no `objectql` keeps the plugin's deliberate degradation: once its `kernel:ready` hook has established that no engine is coming, writes resolve into the memory fallback again (now with a `warn` saying those values are lost on restart);
  - reads are untouched in every state, so an ordinary boot-time read of a setting still resolves.
  
  No shipped caller wrote settings inside the window, so no existing startup sequence becomes an error.
  
  `SETTINGS_ENGINE_NOT_BOUND` is registered in `ERROR_CODE_LEDGER` per ADR-0112. The status is declared on the error class rather than at an HTTP door because no door can reach it: the window closes at `kernel:ready`, and HTTP servers open their socket at `kernel:listening`, strictly after.
- Updated dependencies [8f04d9a]
- Updated dependencies [6936d07]
- Updated dependencies [59eb04d]
- Updated dependencies [9f05b7d]
- Updated dependencies [3b2af5e]
- Updated dependencies [7d2d112]
- Updated dependencies [5fa0d72]
- Updated dependencies [02b3b07]
- Updated dependencies [46d34ab]
- Updated dependencies [914c413]
- Updated dependencies [55809a0]
- Updated dependencies [ee2ff45]
- Updated dependencies [47cd3ec]
- Updated dependencies [52db1d1]
- Updated dependencies [5649efb]
- Updated dependencies [9d7d2de]
- Updated dependencies [c815c50]
- Updated dependencies [795ea05]
- Updated dependencies [2306a76]
- Updated dependencies [e5ea701]
- Updated dependencies [a40dcc1]
- Updated dependencies [def0d3e]
- Updated dependencies [8d0bb79]
- Updated dependencies [5acb58d]
- Updated dependencies [2e3cf95]
- Updated dependencies [4c93387]
- Updated dependencies [504c8d5]
- Updated dependencies [a037f7c]
- Updated dependencies [3ee8ddf]
- Updated dependencies [16cef97]
- Updated dependencies [a79bd35]
- Updated dependencies [6ceaa4b]
- Updated dependencies [15ea214]
- Updated dependencies [de19489]
- Updated dependencies [c684d00]
- Updated dependencies [923c424]
- Updated dependencies [0ab81d1]
- Updated dependencies [1ec36b7]
- Updated dependencies [5f2e54c]
- Updated dependencies [189373b]
- Updated dependencies [35ad101]
- Updated dependencies [ceb33a9]
- Updated dependencies [dccbcec]
- Updated dependencies [73d9795]
- Updated dependencies [8012960]
- Updated dependencies [266654d]
- Updated dependencies [f34f56b]
- Updated dependencies [f399618]
- Updated dependencies [75e9301]
- Updated dependencies [2810695]
  - @objectstack/platform-objects@17.2.0
  - @objectstack/spec@17.2.0
  - @objectstack/core@17.2.0
  - @objectstack/types@17.2.0

## 17.1.0

### Patch Changes

- 7337f30: chore(deps): production-dependency patch bumps from the weekly Dependabot group (#9212)
  
  Routine dependency-range refresh, no behavior change: `@oclif/core` 4.13.2→4.13.3,
  `esbuild` 0.28.1→0.28.2 and `better-sqlite3` ^13.0.2→^13.0.3 (optional) on
  `@objectstack/cli`; `mingo` 7.2.2→7.2.4 on `@objectstack/driver-memory`; `nanoid`
  6.0.0→6.0.1 on `@objectstack/driver-mongodb`, `@objectstack/driver-sql`,
  `@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso`, plus
  `better-sqlite3` ^13.0.2→^13.0.3 (optional on `@objectstack/driver-sql`, peer on
  `@objectstack/driver-turso`); `js-yaml` 5.2.2→5.2.3 on `@objectstack/metadata`;
  `@noble/hashes` 2.2.0→2.3.0 and `jose` 6.2.5→6.2.8 on `@objectstack/plugin-auth`;
  `nodemailer` 9.0.3→9.0.5 on `@objectstack/plugin-email`; `@hono/node-server`
  2.0.12→2.1.1 and `hono` 4.12.34→4.13.2 on `@objectstack/plugin-hono-server`;
  `pinyin-pro` 3.28.2→3.29.1 on `@objectstack/plugin-pinyin-search`; and
  `@noble/ciphers` 2.2.0→2.3.0 on `@objectstack/service-settings`.
  
  Every entry above changed a `dependencies`, `optionalDependencies` or
  `peerDependencies` range in the published manifest — the only kind of change
  that reaches a consumer's install. The same Dependabot group also bumped
  `devDependencies` on `@objectstack/hono`, `@objectstack/client`,
  `@objectstack/core`, `@objectstack/plugin-sharing` and `@objectstack/spec`
  (none consumer-facing), and touched the private `apps/docs`,
  `examples/app-todo` and workspace-root manifests (none published) — none of
  those get an entry here.
- 501ed0e: fix(settings): the rotated-secret reaper verifies the repoint instead of inferring it (#8262)
  
  `SettingsService.reapRotatedSecret` deleted the `sys_secret` row that
  `upsertRow` reported as `previousEnc`, and inferred that the repoint it was
  cleaning up after had taken effect from `previousEnc !== nextEnc`. That
  inference holds for the shipped adapter, which forwards
  `context: { isSystem: true }`. It does not hold for an adapter that drops
  `context` — the reader `SettingsEngine`'s own doc comment contemplates, and a
  documented extension point rather than a mistake nobody makes.
  
  With `context` dropped, `sys_setting.value_enc` is `readonly: true` so the
  UPDATE has it stripped, the row keeps naming the OLD handle, and the reaper
  then deleted **the ciphertext still in force**: `materialiseRow` dereferenced a
  dangling handle, got nothing, and the setting silently read as empty. That is
  unrecoverable — the audit trail records digests, never handles or ciphertext,
  so nothing can even name what was destroyed. Measured on the real engine over
  the real `SysSetting` / `SysSecret` schemas, three writes gave `sys_secret`
  `1 → 1 → 2` with `value_enc` pinned to a row that no longer existed.
  
  The reaper now re-reads the row after the write and deletes `previousEnc` only
  once storage confirms the row no longer names it. The criterion is
  `current !== previousEnc` rather than the narrower `current === nextEnc`:
  under a concurrent rotation the row may already have moved on to a third
  handle, where `previousEnc` is genuinely unreferenced and the narrower test
  would leak the orphan the reaping exists to prevent. Both refuse the case that
  matters.
  
  Every refusal branch (unreadable row, failed read, row still naming the
  handle) leaves an orphan and logs — the recoverable direction, and the one an
  orphan sweep can clean up; there is no recoverable direction on the other
  side. The added read sits behind every cheap guard, so it is paid only where a
  destructive delete would otherwise follow, and it is inside the same
  best-effort guarantee as the delete: a rotation is never failed by it.
  
  Latent rather than live: no shipped path reaches this, because the shipped
  adapter forwards `context`. The population at risk is third-party and custom
  `SettingsEngine` adapter authors — who also had no discovery path, since the
  warning on `SettingsEngine.update` still described only the pre-#8063
  consequence ("the rotated-away credential stays in force"). That warning now
  states the real consequence, and a non-forwarding adapter announces itself in
  the log instead of failing silently.
- Updated dependencies [56656aa]
- Updated dependencies [c9f5950]
- Updated dependencies [d6e80b2]
- Updated dependencies [07e630e]
- Updated dependencies [66beee0]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [03520eb]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [04f8fdb]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [6158146]
- Updated dependencies [84cb121]
- Updated dependencies [ca19ee8]
- Updated dependencies [a675b4d]
- Updated dependencies [b887013]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [b3f9831]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/platform-objects@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0

## 17.0.0

### Minor Changes

- 586d6f7: feat(auth): `membership_policy` is a platform setting, and sign-up and backfill read one source (#5152)

  **What a new user joins is now configurable at runtime.** ADR-0093's
  `membershipPolicy` decides whether a freshly created user is auto-bound to the
  deployment's default organization (`auto`) or gets membership only from an
  explicit act — creating a workspace, accepting an invitation, an admin adding
  them, SSO just-in-time provisioning (`invite-only`). Until now it was settable
  **only** as an `AuthPlugin` constructor option, and the AuthPlugin a self-hosted
  stack gets is injected by the CLI, which passes no such option and has no env
  fallback. Every self-hosted deployment therefore ran `auto`, with no way to say
  otherwise. `invite-only` was, in practice, unreachable outside a custom host.

  It is now `auth.membership_policy` in the platform settings — a two-value select
  (`auto` / `invite-only`, default `auto`) alongside `signup_enabled`, which it
  pairs with: one says whether people may self-register, the other says what they
  join when they do. Set it in Setup → Authentication → Membership, or pin it
  per-deployment with `OS_AUTH_MEMBERSHIP_POLICY`. It applies **without a
  restart** — the existing `settings.subscribe('auth', …)` re-application seam
  carries it, the same one the password-policy keys ride.

  **No behaviour changes unless you set it.** Only an _explicit_ value applies;
  the manifest's `auto` default is a UI default and never masks a deployment that
  configured the policy in code. A stack that sets nothing keeps today's
  auto-binding exactly.

  **Bug fix — the two membership paths read one source.** Sign-up (the reconciler
  in better-auth's `user.create.after`) read the AuthManager's live config, while
  the ADR-0093 D6 backfill of pre-existing member-less users read the plugin's
  **constructor options**. Wiring a setting to the first and not the second would
  have produced "sign-up honours the new policy, backfill still runs the old one"
  — and the backfill binds in **bulk**, so it is the more dangerous half. Both now
  resolve the policy through the new `AuthManager.getMembershipPolicy()`, and the
  backfill waits for the settings namespace to bind before its first pass (the two
  `kernel:ready` hooks fire in registration order, which was the wrong order).

  **An invalid value is rejected, not coerced.** `PUT /api/settings/auth` refuses
  a policy outside the declared option table (`invalid_option`, naming the allowed
  set). A value arriving from `OS_AUTH_MEMBERSHIP_POLICY` — which bypasses that
  validation — is logged at `error` and **ignored**, leaving the deployment's
  current policy in force; it is never silently read as `auto`, because that would
  leave an operator believing a wall is up while every sign-up is auto-bound.

  New public API on `@objectstack/plugin-auth`: `AuthManager.getMembershipPolicy()`,
  plus `MEMBERSHIP_POLICIES` and `isMembershipPolicy()` from `reconcile-membership`.

- 9c4f174: feat(plugin-email): durable email delivery through `sys_job_queue`, opt-in (#5160)

  `IEmailService.send()` has always delivered **inline**: the SMTP session ran
  inside the caller's `await`, and `EmailService`'s retry loop lived in the same
  process — so a crash between the attempt and the retry dropped the message with
  no trace beyond a `sys_email` row stuck at `queued`. The pieces for a durable
  path all existed (`sys_job_queue`, the `DbQueueAdapter`, an `email.send.async`
  subscriber) but nothing in the repo ever published to that topic.

  **New: `queueDelivery`.** With it on, `send()` persists the `sys_email` row,
  publishes an `email.send.async` job **referencing that row**, and returns
  `{ status: 'queued' }` immediately. A worker delivers the row and finalizes it
  in place (`sent` + `message_id`, or `failed` + `error`); the queue retries with
  exponential backoff (1s → 5min cap) and dead-letters the job when the attempts
  run out, so a restart resumes delivery instead of losing it. The `'queued'`
  status was already in `EmailDeliveryStatus` — no spec change.

  Three ways to turn it on, all default-off:

  - `new EmailServicePlugin({ queueDelivery: true })`
  - `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) on `os serve`
  - Settings → Mail → **Durable queue delivery**, hot-applied without a restart

  **One retry budget, not two.** `retries` keeps its meaning — total attempts are
  `retries + 1` in both modes. Inline it drives the in-process loop; queued it
  becomes the queue's `maxAttempts` and the per-row loop is pinned to one attempt
  per delivery. Turning the toggle on changes _where_ a retry happens (durable,
  backed off) and never _how many_ happen, so the two layers cannot multiply.

  **Fixed in the same change: the `email.send.async` subscriber inserted a new
  `sys_email` row per delivery.** It called `send()` with the message, so a job
  the queue retried five times left five rows — four permanently `failed`, none
  carrying the real attempt count. It now delivers the referenced row via
  `deliverPersistedRow`, so one message is one row and `attempt_count`
  accumulates on it. Messages published in the old shape (a bare `SendEmailInput`)
  are still accepted and delivered inline for a migration window.

  Boundaries worth knowing before you switch it on:

  - **"Send test email" always sends inline**, in every mode — the button has to
    report the provider's own answer (`535 …`), and "queued" is exactly the
    non-answer #5087 removed from it.
  - **Messages with attachments or custom headers are delivered inline**, because
    `sys_email` has no columns for them and a queued copy would arrive stripped.
    Queueing them is tracked separately; this ships the loss-free behaviour.
  - **A declaration that cannot be honoured fails the boot.** `queueDelivery: true`
    from the constructor or `OS_EMAIL_QUEUE_ENABLED` with no durable queue
    registered (or with `persist: false`) throws on `kernel:ready`, naming the
    fix — the #5132 judgement, applied to durability. The **settings toggle** is
    the opposite trade: it logs at `error` and keeps sending inline, because one
    save must not stop the mail.
  - The kernel's built-in in-memory `queue` fallback does **not** count as a
    durable queue: it delivers synchronously with no retry or DLQ, so publishing
    to it would report `queued` for a message nothing could ever recover. Mount
    `@objectstack/service-queue` over an ObjectQL engine (the `queue` capability
    does this on `os serve`) to get the `sys_job_queue`-backed adapter.

  Leaving `queueDelivery` unset keeps today's behaviour byte for byte.

- 8597a7d: fix(service-settings,plugin-email): the mail provider dropdown lists only providers that actually deliver (#5094)

  **Settings → Mail → Provider** offered `SMTP | SendGrid | Amazon SES | Postmark`.
  `@objectstack/plugin-email` has never carried a SendGrid or an SES transport —
  `makeTransport` knows `log` / `resend` / `postmark` / `smtp` and nothing else. So
  selecting either of the two validated, saved, showed a success toast, and then
  delivered no mail at all: the same declared-but-not-delivered gap #5087 closed
  for SMTP, one field to the left.

  The same field broke the invariant in the other direction at the same time:
  **`resend` has shipped a working transport all along and was not on the list**,
  so nobody could pick the one HTTP provider that worked.

  **The dropdown is now `SMTP | Resend | Postmark | None (log only — no real
delivery)` — exactly the set `makeTransport` can build.** No email capability was
  removed with SendGrid and SES. Both publish SMTP endpoints, and #5087 shipped a
  real `SmtpTransport`, so both are configured today as `smtp`:

  | provider   | host                                | port | credentials                                                                        |
  | :--------- | :---------------------------------- | :--- | :--------------------------------------------------------------------------------- |
  | SendGrid   | `smtp.sendgrid.net`                 | 587  | username `apikey`, password = your API key                                         |
  | Amazon SES | `email-smtp.<region>.amazonaws.com` | 587  | SES **SMTP credentials** (generated in the SES console — not your AWS access keys) |

  The provider field's own description says this, so the migration is in front of
  whoever goes looking for the option that disappeared.

  `log` is listed rather than hidden. It is the one option that does not deliver —
  but it does not pretend to: the label says so, `LogTransport` still records every
  message to `sys_email`, and "Send test email" answers `ok: false` for it. That
  gives an operator the deliberate, visible opt-out AGENTS.md asks a degradation to
  be, instead of expressing "no outbound mail" as a half-filled SMTP form. It is
  also what makes _offered_ and _deliverable_ the same set rather than merely
  overlapping — which is the property a test can hold.

  **Already saved `sendgrid` or `ses`? Nothing breaks and nothing goes quiet.** The
  stored value outlives the dropdown, so `applyMailSettings` now recognises it
  explicitly: the previous transport is kept (a settings row written by an older
  release must never fail a boot), and the server logs at `error` with both halves
  AGENTS.md requires — the consequence (_no mail is delivered through it_) and the
  fix (the SMTP settings above), not a bare "unknown provider". It is checked
  _before_ the API-key check, because "set an API key" is the wrong instruction for
  a provider that has nothing to hand a key to. "Send test email" refuses the same
  way and sends nothing. Switching the provider to `smtp` and saving recovers the
  transport without a restart.

  Two smaller corrections in the same field:

  - `api_key` is now shown and required for exactly `resend` and `postmark`
    (`provider === 'resend' || provider === 'postmark'`). It was `provider !==
'smtp'`, which only worked because every non-SMTP option happened to be an
    HTTP API; `required` is enforced server-side wherever the field is visible, so
    that expression would have refused to save "None (log only)" until an API key
    it never reads had been typed in.
  - The built-in `mail/test` fallback (the one that runs when no email plugin is
    mounted) rejects any `provider` outside the manifest's own option list instead
    of answering "the form is well-formed".

  **Held by a test, in both directions.** `EMAIL_TRANSPORT_PROVIDERS` is now a
  runtime array (the `EmailTransportProvider` union is derived from it), and
  `plugin-email`'s `mail-manifest-providers.contract.test.ts` asserts set equality
  between it and the manifest's option values, then builds a real transport for
  each. Adding an option without a transport fails; adding a transport without an
  option fails. `RETIRED_EMAIL_PROVIDERS` / `isEmailTransportProvider` /
  `unsupportedProviderFix` are exported alongside it for hosts that surface the
  same guidance.

- 59ed2e9: Add a **report-only** classifier for `sys_secret` orphans (#8103), plus the reachability
  measurements a sweep would depend on.

  `classifySysSecretRows()` is a pure, read-only function over caller-supplied snapshots: it
  never writes, never deletes and never decrypts, and its `SecretRowSnapshot` type
  deliberately has no `ciphertext` member. It reports which `sys_secret` rows the settings
  subsystem still references (`in_force`), which are unreferenced and attributable to a
  declared encrypted specifier (`orphaned`), and which it cannot attribute at all
  (`unattributable`).

  That third verdict exists because re-measuring #8063's reachability argument **falsified**
  one of its three facts: `sys_setting.value_enc` is _not_ the only column that holds a
  `sys_secret` handle. The store has three producers — `SettingsService`, the engine's
  `secret`-field channel (which stores `secret:<id>` on any business row, including
  tenant-authored objects), and the datasource credential binder (`sys_secret:<id>` at
  `external.credentialsRef`). Two are invisible from this package and the engine's set of
  holders is not statically enumerable, so "unreferenced by `sys_setting`" is not
  "unreferenced". Rows that cannot be attributed are reported, never classified as orphans,
  and the report carries explicit caveats naming its own blind spots.

  The classifier also pins the two directional guards the card names: a row re-wrapped in
  place by `rotateKey()` keeps its handle and is reported `in_force` (rotation metadata never
  decides a verdict), and a legacy inline `value_enc` contributes no handle to the referenced
  set while flagging any `sys_secret` row sharing its `(namespace, key)`.

  No deletion ships with this change — the vehicle for removing orphans remains an open
  maintainer decision.

- e9cb9ab: feat(settings): `SETTINGS_CRYPTO_UNAVAILABLE` gets a wire spelling — the fail-closed settings refusal is now client-branchable (#8273)

  The #8026 fail-closed refusal (a declared-encrypted setting refused when
  nothing able to encrypt it is wired) used to answer over REST on the generic
  `500 INTERNAL_ERROR` arm every unmapped service error takes. The full
  actionable message was carried, so operators reading logs were fine — but a
  client (the Setup UI is the consumer) could not distinguish "the deployment
  cannot encrypt secrets, reconfigure it" from "the server crashed". Every other
  settings error class already had a registered wire code; this one was the odd
  one out.

  - `SETTINGS_CRYPTO_UNAVAILABLE` is registered in `ERROR_CODE_LEDGER` under
    `@objectstack/service-settings`, so `ApiErrorSchema.code` accepts it
    (ADR-0112: declared = enforced, no silent fourth state).
  - `settings-routes.ts`'s PUT handler maps `SettingsCryptoUnavailableError` to
    `500 SETTINGS_CRYPTO_UNAVAILABLE` with `details: { namespace, key }` (the
    located refusal — never the value). The status **stays 500**: this is a
    server-side misconfiguration, and deliberately not 503 — no retry succeeds
    until an operator wires a `cryptoProvider`, so inviting one would be
    dishonest. The registered code carries the meaning; the status stays honest.

  Clients branching on the previous generic `INTERNAL_ERROR` for this refusal
  (none could, meaningfully — that was the bug) now read the dedicated code;
  status and message are unchanged.

- f1f40b4: refactor!: settings error bodies stop hanging undeclared keys beside `code`/`message` (#4224)

  Four `/api/settings/*` error branches spread ad-hoc context as SIBLINGS of `code`
  and `message` inside `error`. `ApiErrorSchema` declares `code`, `message`,
  `category?`, `httpStatus?`, `details?`, `requestId?` — and none of `namespace`,
  `key`, `reason`, `fields`. The bodies passed every gate anyway: `ApiErrorSchema`
  is a plain `z.object`, so unknown keys were **stripped** rather than rejected,
  and `envelopeViolations` inspects only the body's top level. They were conformant
  _by stripping_, not by declaration. The same module already used the declared
  slot correctly one branch over (`SETTINGS_ACTION_FAILED` → `error.details`), so
  this is one file speaking two dialects, not a missing capability.

  **Wire change — FROM → TO.** In every case the values are unchanged; only their
  position moves, into the `details` slot the contract declares:

  | Code                  | HTTP | FROM                                           | TO                                                                     |
  | --------------------- | ---- | ---------------------------------------------- | ---------------------------------------------------------------------- |
  | `SETTINGS_FORBIDDEN`  | 403  | `error.namespace`                              | `error.details.namespace`                                              |
  | `UNKNOWN_KEY`         | 400  | `error.namespace`, `error.key`                 | `error.details.namespace`, `error.details.key`                         |
  | `SETTINGS_LOCKED`     | 409  | `error.namespace`, `error.key`, `error.reason` | `error.details.namespace`, `error.details.key`, `error.details.reason` |
  | `SETTINGS_VALIDATION` | 400  | `error.namespace`, `error.fields`              | `error.details.namespace`, `error.details.fields`                      |

  **One-line fix for a consumer:** read `error.details.<key>` where you read
  `error.<key>`, or `error.details?.<key> ?? error.<key>` if you support servers on
  both sides of the change. The console's own fix (objectui#3078) is the tolerant
  form.

  **`SETTINGS_VALIDATION.fields` also changes shape**, because `fields` is the name
  ADR-0114 (#3977) closed for `FieldError[]` and keeping a map under it would leave
  one spelling meaning two shapes:

  - **FROM** `{ [key]: message }` — a `Record<string, string>`, the constraint named
    only in the prose of the message.
  - **TO** `FieldError[]` — `{ field, code, message, label, constraint? }`, where
    `code` is a member of the closed field-level catalog: `required` for an empty
    required specifier, `invalid_format` for a value that misses its declared
    `pattern` (which travels as `constraint.pattern`).

  A consumer that rendered the map's values reads `f.message` per entry instead;
  one that wants to branch on _why_ a value was rejected can now read `f.code`
  rather than substring-matching English. objectui's `extractFieldErrors` already
  reads `details.fields`, so settings validation failures become renderable
  per-field there with no further change.

  **The exported `SettingsValidationError.fields` changes with it** — same
  `Record<string, string>` → `FieldError[]` mapping — since the route only relays
  what the service throws, and the constraint kind is knowable at the throw site
  and nowhere after it.

  `sendError`'s last parameter is tightened from `extra?: Record<string, unknown>`
  to `ApiError`'s own optional fields, and its `code` from `string` to the closed
  ADR-0112 `ErrorCode` union. That is what keeps this fixed: an undeclared sibling
  is now a compile error at the call site rather than a key that quietly evaporates
  at the schema boundary.

- 9c90ea0: feat(sms): 短信全局日发送配额 —— 成本总量闸 (#2814)

  #2780 给 OTP 端点落了**按号码**的防滥用（60s 冷却 + 每号码 5 条/小时）。那挡住的是「一个号码花多少钱」，挡不住「这套部署一天花多少钱」：攻击者轮换上万个不同号码时，每个号码都稳稳待在自己的预算里，而日累计账单没有任何上限——这正是 SMS pumping / toll fraud 的典型打法。更要紧的是，按号码那道闸住在 better-auth 的 `hooks.before` 里，只看得见 auth 端点：`notify(channels:['sms'])` 与邀请短信从旁边直接走过去，一条都不计数。

  本次新增一道**总量**闸，扣减点放在所有出站短信本来就必经的那一处 —— `SmsService.send()`。OTP、邀请、messaging `sms` channel 三条路无论从哪扇门进来，都记在同一本账上。

  ## 新增设置项

  `sms` 命名空间新增 `daily_quota`（Daily send limit，number，默认 `0` = 不限）：这套部署每个 **UTC 自然日**允许发出的短信总条数。超出后拒发，直到 00:00 UTC。env 覆盖沿用既有的每键机制，无需额外接线：`OS_SMS_DAILY_QUOTA=2500`。

  `0` 是出厂姿态，所以升级本身不改变任何现有部署的发送行为——闸门要由运营者显式配置才会闭合。

  ## Observable behaviour change

  **配置配额后，发送可能被拒**，两条路径的表现分别是：

  - OTP / 邀请路径 —— `SendSmsResult.status='failed'`，`error` 为 `TOO_MANY_REQUESTS: daily SMS quota exhausted`。刻意与按号码闸抛出的 `TOO_MANY_REQUESTS` 用同一个码，且**不带任何剩余额度细节**：从外面看，两道墙必须长得一样，攻击者不该能试探出自己撞的是哪一道。
    ⚠️ 但这个码**目前到不了 HTTP 调用方**：`AuthManager.deliverPhoneOtp` 把它重抛成普通 `Error`，而 better-call 对非 `APIError` 一律回 500（实测，见 #6039）。也就是说 OTP 端点上，按号码闸回 429、总量闸回 500。补齐要动 plugin-auth，已单独立案。
  - messaging `sms` channel —— `SendResult.ok=false`，且 `classifyError` 返回 `'rate_limited'`（此前一律 `'retryable'`）。投递落进 outbox 走退避重试 / 死信，不会被静默丢弃；`rate_limited` 与 `retryable` 走同一条重试阶梯，但把「额度用尽」与「网关抖动」在投递记录上区分开。

  ## 计数落在哪里

  复用仓内唯一那份定窗计数（`incrementFixedWindow`）与它的惰性存储解析（`createLazyCounterStore`，#4772/#4790），不写第三份：

  - 有 kernel `cache` 服务时计在共享 cache（集群共享与否取决于 cache 本身）；
  - 解析不到时降级为有界的进程内计数，并由解析器**点名**打一条 warn，说明降级的代价（N 节点部署最多可花 N× 配额）；
  - 解析在**计数被消费时**发生，而非插件 init —— 后注册的 cache 也能在下一次发送时被接上（#4772 的坑）。

  窗口是 UTC 自然日，且由两个机制同时保证：计数键带 UTC 日期（`sms-daily-sends:2026-08-06`），窗口开启时的 TTL 恰为距下一个 UTC 午夜的秒数。任一机制单独也能翻窗，合起来则不可能互相矛盾。

  ## 两条刻意的姿态

  - **fail-open**：计数存储读不到时，闸门**放行**并打一次 warn。短信成本闸不能把登录拖下水（#2814 诉求 4）。
  - **配额值的钳制在消费侧**：manifest 上的 `min: 0` 今天并不被 `validatePatch` 执行（#5932），所以负值 / `NaN` / `Infinity` / 非数字都会原样抵达读取方。这些一律降级为 `0`（不限）并**点名**打 warn，而不是拒发、也不是替运营者编一个别的默认值——一个设置表单里的手误不该变成手机登录的全站故障，而编一个没人声明过的上限只会把手误藏进看似合理的行为里。

  ## 不在本次范围

  诉求中的**每租户日配额**（`daily_quota_per_tenant`）未实现：`SendSmsInput`（`@objectstack/spec/contracts`）不携带任何租户标识，而在 service 侧另造一个只此一家的拼法就是 Prime Directive #12 明令禁止的影子契约。租户维度要么落在 spec 契约上，要么不落——详见 #2814 上的讨论。

### Patch Changes

- eb1b231: Remove `step: 0.1` from the `ai.temperature` specifier (#6550). Since #6199 a declared `step` binds as a value constraint on both doors, and temperature's true domain is continuous on [0, 2]: the 0.1 grid refused legal values — `PUT /api/settings/ai` with `temperature: 0.15` was rejected and `OS_AI_TEMPERATURE=0.15` was loudly ignored. Both now work; `min: 0` / `max: 2` stay and keep binding (out-of-window values are still refused in the min/max vocabulary). #6199's grid machinery is untouched and still enforces any key that declares `step`.
- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 0b63b56: `company.country` adopts the `iso_3166_alpha2` value domain (#6579), the fourth case of the hole #5712 closed on localization: `pattern: '^[A-Za-z]{2}$'` constrains shape only, so `ZZ` (assigned to nobody) and `UK` (a CLDR alias, not an ISO 3166-1 code) passed the write door while the description promised ISO 3166-1. Both doors now judge membership against the explicit 249-code list (`invalid_value` with `constraint: { valueDomain: 'iso_3166_alpha2' }` on save; loud ignore on `OS_COMPANY_COUNTRY`). The pattern stays — a shape breach still speaks first as `invalid_format`. Deliberate tightening, same as #5712: membership is exact uppercase, so lowercase spellings like `us` are now refused.
- 35e7417: fix(service-settings): settings writes reach `sys_audit_log` as `config_change` (#8145)

  `GET /api/v1/data/sys_audit_log?$filter={"action":"config_change"}` answered
  **total 0** after any settings write, for the whole life of that enum member. So
  did the shipped `config_changes` list view and the console filter that offers the
  value: three surfaces advertising a class of audit event the platform never
  recorded. A settings change was audited — into `sys_setting_audit`, with
  `action: 'set'` — and nowhere else, while the settings service's own type
  documentation promised `sys_audit_log` rows "for every successful write".

  The cause was one argument. `SettingsAuditSink` — the slot documented since
  Phase 3 as the one that writes the generic ledger — is the second parameter of
  `SettingsService.bindEngine`, and `SettingsServicePlugin` passed `undefined`
  there. Nothing else was missing: the service called the sink on every write, the
  enum declared the value, the view filtered on it.

  **Both ledgers are written now** (the dual-write half of the 2026-08-12 ruling on
  #7675, which left the choice to the implementation):

  - `sys_audit_log`, `action: 'config_change'` — the platform-wide compliance
    ledger. One row per changed key, attributed on `user_id` and `actor`, stamped
    with the caller's tenant (and `organization_id` where the deployment declares
    it, without which RLS would hide every row and leave the view as empty as
    before). `metadata` carries the namespace/key/scope and whether the key is
    encrypted; `new_value` carries a **digest**, never a value.
  - `sys_setting_audit`, `action: 'set' | 'reset'` — unchanged. It keeps its rows
    because it has live readers and because it records what the generic ledger has
    no columns for (`namespace`, `key`, `scope`, `old_hash`/`new_hash`, `source`,
    `reason`).

  The new write is **best-effort and can never fail a settings write**:
  `sys_audit_log` belongs to the optional `@objectstack/plugin-audit`, so on a
  deployment without that plugin the table does not exist, and the sink reports the
  gap once per process rather than raising. A write that is REFUSED — an
  unauthorised caller, an env-pinned key, the #8026 fail-closed crypto refusal —
  still emits no row on either ledger: a refused write is not a successful one, and
  a ledger listing configuration changes that never happened would be a worse lie
  than the empty view.

  `settings-service.types.ts`'s contract line now states what is built rather than
  what was intended, per the ruling's 以实现定契约.

- 861ee32: The settings env door now enforces declared `pattern` constraints (#6580). An
  `OS_*` override whose value the specifier's `pattern` rejects is loudly
  reported (`error` log, once per var+value) and ignored — the key resolves from
  the next cascade layer and is not locked — exactly the #5204 contract the
  option-table, value-window/step and valueDomain families already honor. The
  write gate's judgment is hoisted into shared helpers (`declaredPattern` /
  `firstPatternMiss`) called by both doors, so `PUT /api/settings/:ns` behavior
  is unchanged byte-for-byte (same `invalid_format` envelope, same tolerance for
  uncompilable pattern declarations) and the two doors can no longer drift.
  Family ordering agrees between doors: options → pattern → valueDomain → bounds.
- 4022b78: Settings: an `OS_*` env override is now checked against the specifier's declared `options` table (#5204)

  A manifest's `options` table has been enforced on the write path since #5131, but
  `SettingsService.get()` produced an effective value by a second route that never
  consulted it: an `OS_*` override was reshaped by the default's type and returned
  straight from the top of the cascade with `locked: true`. So the providers #5094 and
  #5133 retired from `mail.provider` could walk back in through the one door with no
  gate on it — `OS_MAIL_PROVIDER=sendgrid` reached the mail plugin unchallenged — and a
  plain typo such as `OS_BRANDING_THEME_MODE=drak` was served to every consumer as a
  normal value with normal-looking provenance, each consumer left to improvise.

  An override whose value the table does not declare is now **ignored** rather than
  repaired: the value falls through to the next layer of the cascade (a stored
  global/tenant/user value, else the manifest default), and the read API reports that
  layer honestly instead of claiming `source: 'env'` for a value not in force. The
  rejection is logged once at `error`, naming the variable, the rejected value, the legal
  value set and the consequence. The same audit runs at `registerManifest`, so a
  misconfigured deployment learns at boot rather than whenever somebody first opens the
  settings page.

  Registration **reports but never refuses**: option tables move, a pin that was legal
  the day it was written must not turn an upgrade into a crash-on-start.

  Two behaviour notes for anyone relying on the old shape:

  - Keys with no declared option table are untouched — text, boolean, number and
    password overrides behave exactly as before. The check applies only to
    `select`/`radio`/`multiselect` specifiers that declare a non-empty table.
  - A **rejected** override no longer pins its key against writes. `setMany` used to
    refuse on the mere presence of the variable; judged by presence, an ignored value
    would have left the key configurable by nothing at all — env value discarded, UI
    refused with `SETTINGS_LOCKED`, and `get()` reporting `locked: false` to a settings
    page whose save would then fail. An override that _is_ in force still locks the key,
    unchanged.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- babddf6: fix(service-settings): localization's declared standards are the enforcement boundary — `valueDomain` enforced on both doors (#5712)

  `localization.timezone` promised "IANA zone" and `localization.currency` promised
  "ISO 4217 code", but since #5131 the write path treated their curated 17/9-entry
  `options` tables as exhaustive, and since #5204 the env path agreed — so
  `PUT /api/settings/localization` with `timezone: 'Europe/Zurich'` (or
  `currency: 'CHF'`) was refused with `invalid_option`, and
  `OS_LOCALIZATION_TIMEZONE=Europe/Zurich` was ignored, despite both being values
  every `Intl`-based consumer downstream handles. Maintainer ruling (2026-08-06,
  reading 1): the curated tables are UI convenience lists; the boundary is the
  standard's membership.

  The manifest now declares the merged spec vocabulary (#5933 / `SpecifierValueDomainSchema`)
  on the three keys that promised a standard all along — `timezone: 'iana_time_zone'`,
  `currency: 'iso_4217_currency'`, and `default_country: 'iso_3166_alpha2'` (third
  case of the same hole: `^[A-Za-z]{2}$` admits `ZZ`) — and `SettingsService`
  enforces a declared domain at the one decision point per door:

  - **Write door** (`validatePatch`): a domain-bearing specifier skips the
    exhaustive-options check and judges the standard's membership instead, after
    `pattern` (shape and membership narrow independently; the shape breach is the
    coarser fact and speaks first). A breach is `invalid_value` with
    `constraint: { valueDomain }` — no `FieldErrorCode` member names a
    standard-domain breach, and `invalid_option` would misname the set that was
    consulted.
  - **Env door** (`effectiveEnvOverride`): the same membership judgment, so a
    garbage override is loudly reported and ignored (falls back down the cascade,
    pins nothing — #5204's contract, unchanged) while a legal one wins the cascade
    and locks the key.

  Membership definitions follow the spec's pinned TSDoc: `iana_time_zone` is the
  `Intl.DateTimeFormat` probe (NOT `Intl.supportedValuesOf('timeZone')`, whose
  CLDR subset omits `UTC`, `Asia/Kolkata` and `Europe/Kyiv`); `iso_4217_currency`
  is `Intl.supportedValuesOf('currency')`; `iso_3166_alpha2` is an explicit list
  of the 249 officially assigned codes (no standard-library oracle exists —
  `Intl.DisplayNames` names `ZZ` and `UK`).

  A specifier that declares no `valueDomain` is byte-for-byte unchanged: #5131's
  exhaustive-options semantics stay in force for registry-backed tables such as
  `mail.provider` / `sms.provider`, pinned by regression tests on both doors.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- 0931185: fix(rest,service-settings,service-datasource)!: four more route modules emit the declared envelope, and the guard is now shared (#3843)

  #3675 and #3689 moved `service-storage` and `service-i18n` onto the declared
  response envelope (`BaseResponseSchema` + `ApiErrorSchema`). Each scoped itself
  to one service, and neither asked whether the same drift existed elsewhere. It
  did — in four more modules, and in two of them it was the _older_ shape, the one
  #3675 had already declared wrong:

  | Module                                | before                                                         | now           |
  | ------------------------------------- | -------------------------------------------------------------- | ------------- |
  | `service-settings/settings-routes.ts` | nested `error`, no `success` on any of 5 bodies                | full envelope |
  | `service-datasource/admin-routes.ts`  | `{ error: '<string>' }`, `message` a **sibling**               | full envelope |
  | `rest/external-datasource-routes.ts`  | `{ error: '<string>' }` + a private `ok`                       | full envelope |
  | `rest/package-routes.ts`              | 3 of 16 bodies had `success`, 2 failures had no `error` at all | full envelope |

  ## Breaking: where to read things now

  **Success payloads move under `data`.** The keys are unchanged — only their
  depth. `unwrapResponse` in `ObjectStackClient` returns `body.data` when the flag
  is present, so every SDK method (`packages.list()`, `datasources.external.*`)
  resolves to exactly the object it always did. Raw `fetch` callers must add one
  hop:

  ```
  GET  /api/v1/datasources            body.datasources     → body.data.datasources
  GET  /api/v1/datasources/drivers    body.drivers         → body.data.drivers
  GET  /api/v1/datasources/:name      body.datasource      → body.data.datasource
  GET  /api/v1/packages               body.packages        → body.data.packages
  GET  /api/v1/packages/:id           body.package         → body.data.package
  GET  /api/settings                  body.manifests       → body.data.manifests
  GET  /api/settings/:ns              body.manifest/.values → body.data.manifest/.values
  POST /…/external/validate           body.ok, body.results → body.data.ok, body.data.results
  ```

  `SettingsNamespacePayloadSchema` and friends still describe those payloads
  exactly; they now describe the envelope's `data` rather than the whole body.

  **Error bodies stop being a string.** `{ error: 'datasource_admin_error',
message }` → `{ success: false, error: { code: 'datasource_admin_error',
message } }`. Read `body.error.message`, not `body.message`; read
  `body.error.code`, not `body.error`. This is the asymmetry #3675 opened on: a
  caller reading `body.error.message` previously got the real message from the
  dispatcher and `undefined` from these routes.

  **Two failures that never said why now do.** `DELETE /api/v1/packages/:id`
  answered a bare `{ success: false }` and a bare
  `{ success: false, failed, cleanups }`. They are now `PACKAGE_DELETE_FAILED` and
  `PACKAGE_DELETE_PARTIAL`, with the per-item `failed` / `cleanups` arrays under
  `error.details`.

  **Codes follow ADR-0112.** #3841 settled the vocabulary while this was in review:
  `error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is now the closed
  `ErrorCode` union, so an unregistered code fails schema parse. Generic conditions
  reuse the STANDARD catalog rather than becoming registered synonyms of it, per the
  ledger's own guidance:

  ```
  datasource_admin_unavailable  → SERVICE_UNAVAILABLE      (standard)
  external_service_unavailable  → SERVICE_UNAVAILABLE      (standard)
  not_found / PACKAGE_NOT_FOUND → RESOURCE_NOT_FOUND       (standard)
  PUBLISH_FIELDS_MISSING        → MISSING_REQUIRED_FIELD   (standard)
  INTERNAL                      → INTERNAL_ERROR           (standard)
  datasource_admin_error        → DATASOURCE_ADMIN_ERROR   (registered)
  external_import_error         → EXTERNAL_IMPORT_ERROR    (registered)
  PUBLISH_MANIFEST_INVALID      → PACKAGE_MANIFEST_INVALID (registered)
  PUBLISH_FAILED                → PACKAGE_PUBLISH_FAILED   (registered)
  PACKAGE_DELETE_PARTIAL / PACKAGE_DELETE_FAILED / SETTINGS_ACTION_FAILED (registered)
  ```

  Which service is unavailable is carried by `message`. The seven registered codes are
  added to `ERROR_CODE_LEDGER` under their owning packages — including a new
  `@objectstack/service-datasource` entry.

  **`POST /external/validate` keeps its `ok`.** Unlike the `{ ok: true, key }`
  #3689 retired from storage — a private second word for `success` — this `ok` is a
  computed verdict over the federated objects (`results.every(r => r.ok)`). The
  request can succeed while the verdict is false, so the two flags are not the same
  field; `ok` moves inside `data` rather than being dropped.

  Consumers were taught both shapes first, so the two repos are not coupled by
  merge order: objectui's `packages` readers were already tolerant
  (`payload?.data ?? payload`), and its datasource page plus the generic
  `type: 'api'` action runner now unwrap the envelope and read `error.message`
  (the latter previously toasted `[object Object]` for any nested error).

  ## The guard is shared now, not copied

  `scripts/check-route-envelope.mjs` + `pnpm check:route-envelope`, wired into
  `lint.yml` alongside the nine sibling `check:*` guards. Its load-bearing assertion
  is structural rather than per-route: **it counts the response write sites per
  module.** When every body goes through the `sendOk` / `sendError` pair that count
  is fixed at two and does not grow with the route list — so a _future_ route that
  hand-rolls a body fails the guard. That is the coverage a driven-body test can
  never give, since it can only drive the routes that existed the day it was
  written.

  This existed three times already as an open-coded regex block (storage error,
  storage success, i18n error). Lifting it did more than deduplicate: a per-package
  scan **structurally cannot notice a module nobody thought to convert**, and going
  repo-wide found two the moment it ran — neither is in #3843's hand-written survey:

  - `plugin-sharing/share-link-routes.ts` — the fifth drifting module. No body
    carries `success`, and one answers `{ ok: true }`, the private second word #3689
    retired from storage. Filed as #3983 and pinned by the guard; converting it is
    breaking for share-link consumers and needs its own sweep.
  - `metadata/routes/hmr-routes.ts` — declared **exempt** with a reason (dev-only
    SSE endpoint, not on the SDK surface), not skipped. Three states, deliberately —
    conformant / ratcheted / exempt — because that is the honest classification
    ADR-0049 asks for. A route module the scan finds but the table does not declare
    is an **error**, never a default: applying `2 / 1 / 1` to an unknown module would
    let a new one pass by coincidence.

  It also drops the regex for the TypeScript AST, fixing two real bugs the copies
  had. They stripped comments with `String.replace`, whose line-comment pattern also
  ate `//` inside string literals and truncated the rest of that line — response
  writes included. And `.json(` does not mean "write a response": `hmr-routes.ts`
  calls `c.req.json()` twice to READ a request body, which a textual count reports as
  two unenveloped responses. Comments and literals are not AST tokens, and
  request-vs-response is a property of the callee, so both disappear. The script
  carries a `--self-test` pinning each case — the nine sibling guards have none, but
  both of these bugs survived a review of the regex version.

  **The i18n ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is
  declared at `responses: 5, ok: 4, err: 1` with a ratchet pointing at #3973. Its
  error half _is_ consolidated (#3675), but each of its four read routes builds
  `{ success: true, data }` inline. Those bodies are correct — that is not envelope
  drift — but an unconsolidated builder is a weaker guard: a fifth read route could
  get the shape wrong and only a driven test would notice. The numbers pin today's
  structure exactly (a new inline body fails) and drop to the conformant `2 / 1 / 1`
  when #3973 lands.

- cc3555e: Mount five ledgered-but-dead routes, and gate the class that hid them (#7526)

  Three routes shipped in the ledgers, implemented in the dispatcher, and mounted
  by nobody. Two of them answered a plausible `200` rather than a 404, which is
  worse: `GET /meta/types` fell into the `/meta/:type` catch-all and returned
  `{"type":"types","items":[]}`, shape-identical to `/meta/zzz_not_a_type`, and
  `GET /meta/:type/:name/published` fell into the compound-name route and
  returned a stub identical before publish **and for a name that does not exist**
  — a route that structurally could not 404. `GET /meta/objects/:name/state/:field`
  was the honest one: REST's `/meta` registrations topped out at three path
  segments and it needs four, so it answered Hono's `notFound`. All three now
  mount, `published` 404s for a bogus name, and the compound-name arity the SDK
  documents (`getPublished('lead', 'views/all_leads')`) mounts with it.

  The routes were the symptom. The route ledgers are a DECLARATION and every
  guard built on them (#3563 / #3587 / #3636 / #3642) reads that union as an
  OBSERVATION of what is mounted, so the whole audit chain was green on this
  class by construction — `/meta/objects/:name/state/:field` counted as mounted
  because it was ledgered. This adds the missing observation: a route-ledger ↔
  live-mount parity gate that boots a real server, reads the mount table off it,
  and asserts both directions — every ledgered route reachably mounted, every
  mounted route ledgered. It never consults a second hand-written list of what is
  mounted, and it PROBES reachability through the live router rather than
  checking presence in a table, because a literal route registered after a
  catch-all sibling is mounted and unreachable.

  `IHttpServer` grows two optional, feature-detected members for it —
  `getMountedRoutes()` (the live mount table, in registration order) and
  `resolveMountedRoute(method, path)` (which registration answers a concrete
  request, per the router itself) — implemented by the Hono adapter.

  The gate found three more instances of the same class on its first run:
  `GET /automation/actions`, `/automation/connectors` and `/automation/_status`
  were ordered ahead of the `/:name` catch-all inside `dispatch()`, with a
  comment saying the order was load-bearing, while the bridge that actually
  mounts `/automation` registered `/:name` and never those three. They now mount.
  It also found the unledgered live mounts: the four `/api/settings` routes get a
  ledger of their own, and `GET /.well-known/objectstack` and the object-less
  `POST /actions//:action` get rows in the dispatcher ledger.

- 833ed84: fix(spec): declare the eight-bullet credential read mask once, in spec (#7572)

  The string a client sees in place of a credential it may not read back was
  declared **twice**, byte-identical by convention only:

  - `SECRET_MASK` in `@objectstack/objectql` — the encrypted-**field** read mask on
    the generic CRUD path (ADR-0100 §A/§B);
  - `SETTINGS_SECRET_MASK` in `@objectstack/service-settings` — the settings REST
    read boundary, added by #7522.

  Nothing bound them. An edit to either literal would desynchronise the two masked
  reads a console sees, and the break would be invisible from both sides: each
  package asserted against its own copy, so both suites stay green while the two
  surfaces disagree. That matters more than a cosmetic mismatch — the console
  renders "configured vs not configured" from this value and echoes it back
  unchanged on save, and both write paths read that echo as "unchanged"
  (ADR-0100 §B3). A drifted mask silently turns an unchanged form round-trip into a
  real write of the mask's literal text over a live credential.

  **What changed.** The mask is declared once, in `@objectstack/spec` — the
  contract face both sides already depend on — as `SECRET_MASK` in
  `spec/src/data/secret-mask.ts`, alongside the rest of the ADR-0100 surface
  (`data/field.zod.ts`, `data/object.zod.ts`). Both readers now import that one
  declaration:

  - `@objectstack/objectql` **re-exports** it, so its public API is byte-for-byte
    unchanged — `SECRET_MASK` is still exported from the package root and from
    `core`, with the same name, value and literal type. No consumer changes.
  - `@objectstack/service-settings` aliases it as `SETTINGS_SECRET_MASK`, keeping
    the name that package publishes and every existing import of it working.

  **The framework-agnostic property of the settings service is intact.** #7522
  declined to import the constant because reaching it meant depending on
  `@objectstack/objectql`, the whole data engine — that reasoning was right and
  still holds; no objectql import was added. It never applied to `@objectstack/spec`,
  which is already a dependency of the package and already in its runtime graph
  (`manifest.ts` → `@objectstack/platform-objects/system` → `@objectstack/spec/data`).

  **New public API:** `SECRET_MASK` on `@objectstack/spec/data`. Additive — nothing
  was removed or renamed on any package.

  The literal keeps its deliberate spelling (eight U+2022 BULLETs written out, not
  an escape or a `.repeat(8)`), so a grep for the mask a client actually received
  still lands on the declaration; a source-level pin holds that, next to a byte pin
  on the value. The far-side literal pins in `plugin-audit` and `driver-memory` are
  deliberately left restating the mask — a pin whose job is to catch the constant
  changing must not import the constant.

- 5d7eabc: test(service-settings): resolve the remaining three workspace deps from source, emptying this package's `check-test-source-alias` registry entry (#8104)

  #8063 gave this package its first `vitest.config.ts` and aliased two workspace
  deps to source (`@objectstack/objectql`, `@objectstack/core`) — the two that
  gate named when the package's first real-engine test landed. The other three,
  `@objectstack/spec`, `@objectstack/platform-objects` and `@objectstack/types`,
  stayed on their registered entry in `KNOWN_UNALIASED_TEST_IMPORTS` and kept
  resolving through `exports` to **`dist/`**. They are now aliased to source and
  the entry is deleted.

  **How much of the suite was actually reading the artifact: 17 of 20 files.**
  Measured, not inferred — with the three `dist/` trees removed from the checkout
  and the pre-#8104 config in place, 17 test files fail to load at all
  (`Cannot find package '@objectstack/spec/system'`) and only 58 of 413 cases run.
  With the aliases below, the same tree with no `spec`, `platform-objects` or
  `types` build output anywhere passes 413/413. The build artifact is off the
  resolution path rather than merely shadowed by a fresh copy of it.

  **The subpath entry points were the whole job, and the obvious shape does not
  do it.** This package imports **no bare** `@objectstack/spec` and **no bare**
  `@objectstack/platform-objects` at run time. Every specifier its tests can reach
  for those two is a subpath — `spec/api`, `spec/contracts`, `spec/data`,
  `spec/system`, `platform-objects/system` — joined by `spec/security`, reached
  transitively through `@objectstack/types` ([ADR-0105 D1] tenancy posture) once
  types itself resolves to source. So the two shapes that suggest themselves both
  fail, in opposite directions:

  - the **object** form matches by **prefix**, so a bare key whose replacement is
    a file swallows the subpaths into `…/index.ts/system` — `ENOTDIR` at run time
    in a config that reads as correct (#7778);
  - the **anchored bare** form (`/^@objectstack\/spec$/`, the shape #8063 left
    behind) does not swallow them but does not **cover** them either — all six
    specifiers stay on `dist` and the registry entry cannot come off.

  What covers them is a subpath rule. `spec` takes the one-rule-for-all-namespaces
  form `/^@objectstack\/spec\/([a-z-]+)$/` with the capture group inside the path,
  because its export map is uniform (`src/<ns>/index.ts` throughout) — so a new
  namespace import cannot make it stale. `platform-objects` gets an **explicit**
  `platform-objects/system` entry instead, because its map is _not_ uniform:
  `./plugin` is `src/plugin.ts`, a file, so a `([a-z-]+)` rule would send
  `platform-objects/plugin` to `src/plugin/index.ts`, a path nobody wrote, failing
  on whoever next adds that import. `plugin-audit` writes its
  `platform-objects/audit` entry the same way for the same reason.

  **The registry deletion is half the change, not its cleanup.**
  `KNOWN_UNALIASED_TEST_IMPORTS` is audited for set equality in both directions,
  so the two halves constrain each other and neither is green alone: with the
  aliases complete and the entry still present the gate fails _"registry entry is
  no longer needed … Delete the entry"_; with the entry deleted and any one alias
  missing it fails _"tests import 1 workspace package(s) that resolve to `dist/`
  with no source alias"_. The gate goes from 62 registered packages to 61.

  No test turned red and no assertion moved: 413 passed / 20 files before and
  after, and **no change under `src/`**. That is the expected reading for a
  checkout whose `dist` was built from the same commit — dist and source agree
  here, which is exactly the condition under which the old setup looked fine. What
  changes is that the suite no longer has an opinion about build state at all.

- c08b5b3: fix(service-settings): wire the `typecheck` script so turbo stops silently no-opping the gate, and clear the 14 type errors it was hiding (#7925)

  `packages/services/service-settings/package.json` declared only `build` and
  `test`. `turbo run typecheck --filter=@objectstack/service-settings` therefore
  exited **0 while never running a typecheck task at all** — turbo no-ops a
  package that has no such script, and reports success. "typecheck green" for
  this package was a claim nothing enforced.

  Adding the one-line script (mirroring its sibling `service-messaging`) makes
  the CI-equivalent command execute a real `service-settings:typecheck` task —
  7 tasks where there were 6 — and it immediately surfaced 14 pre-existing
  errors across five test files. Every one was a **stale test**, not a defect in
  the source; no `service-settings/src/*.ts` non-test file changed.

  - `sms.manifest.test.ts` (3), `storage.manifest.test.ts` (4), and
    `ai.manifest.test.ts` (5, previously behind `as any`) invoked their action
    handlers with a partial input. `SettingsActionHandler` takes
    `{ namespace, actionId, values, payload?, ctx }` and the service always
    passes all of it (`settings-service.ts:1809`); the tests had drifted to the
    older two-field shape. They now call handlers the way the service does — and
    the `as any` casts that were hiding the same drift in the `ai` tests are
    gone rather than extended to the other two files.
  - `settings-service.test.ts` passed `record: (e) => events.push(e)` for an
    audit sink declared `Promise<void> | void`; the expression-bodied arrow
    returned `Array.push`'s number.
  - `settings-translation-coverage.test.ts` filtered the manifests barrel
    through a hand-rolled structural `Manifest` type that had drifted from the
    real one (`label` is `string | Record<string, string>`, not `string`),
    making its type predicate unassignable to the exports it narrowed. It now
    narrows to the spec's own `SettingsManifest`.

  `aiTestEmbedderActionHandler` was imported by `ai.manifest.test.ts` and never
  used — the unused import the compiler flagged. Rather than delete the import,
  the two cases it was there for are now tested: the manifest declares a
  `test_embedder` action button whose handler had no coverage.

  No error was silenced: no `any` was added, no `@ts-expect-error`, and the
  package tsconfig's `include` is unchanged (its tests live under `src`, so they
  were always inside the program — only the script that reads them was missing).

  The package's entry in the `check:type-check-coverage` DEBT ledger is deleted,
  since it graduated: the gate goes from 63/77 workspace packages type-checked to
  64/77, and the frozen raw-error total from 455 to 442.

- 6ca0b49: fix(service-settings): refuse to persist a secret through the base64 `NoopCryptoAdapter` — the settings write path now fails closed like the engine's (#8026)

  `SettingsService` constructed without a `cryptoProvider` + `secretStore` fell
  back to `NoopCryptoAdapter`, whose `encrypt()` is `'b64:' + base64(plaintext)`.
  That is **encoding, not encryption**: trivially reversible, and it leaves
  `sys_setting.value_enc` populated — so the row reads as protected to the next
  author and to the next audit while being plaintext with extra steps.

  The engine's `Field.secret()` path has always taken the opposite posture: with
  no `CryptoProvider` registered it throws rather than store cleartext. The
  platform therefore had two credential-encryption paths with **opposite failure
  modes**. This aligns the settings side onto the engine's.

  **Not a live leak, and not written as one.** The shipped plugin path wires a
  real `LocalCryptoProvider` at `kernel:ready` once an `objectql` engine resolves,
  so a default deployment never took the base64 branch. What this closes is the
  fail-open _direction_ on a path an engine-less deployment can still reach.

  **What changed.** A write of a declared-encrypted key (`encrypted: true` or the
  manifest's `type: 'password'`, which means "encrypt this") is now refused with
  `SettingsCryptoUnavailableError` when the `sys_secret` path is not wired _and_
  the inline `CryptoAdapter` declares no confidentiality. The whole batch is
  rejected — a plain sibling key in the same patch is not half-written — and one
  operator-actionable line is reported through the deployment logger, deduped per
  key, so a caller that swallows the error still leaves a trace. Over REST the
  refusal answers `500` on the declared envelope, carrying the fix in the message.

  **What did not change.**

  - `NoopCryptoAdapter` remains exported (public API) and its `decrypt()` is
    untouched: existing `b64:` rows stay readable, reportable and migratable. The
    refusal is write-only — refusing the reads too would strand exactly the data
    worth surfacing.
  - Injected adapters (`SettingsServicePluginOptions.crypto`) are unaffected. An
    adapter declares itself fit to hold a secret with the new optional
    `CryptoAdapter.confidential`; **absent means yes**, so every adapter written
    before this flag keeps working, and only the base64 default declares `false`.
    The exported `providesConfidentiality(adapter)` is the predicate the write
    path uses.
  - Clearing an encrypted key (writing `null`) is still allowed: there is no
    plaintext to protect, and an operator must always be able to REMOVE a value on
    a deployment that cannot store one.
  - Validation still runs first, so a caller submitting a bad value on a namespace
    that happens to carry a secret still gets the field-level diagnostic they can
    act on rather than a deployment fault they cannot.

- 4afdd3e: fix(service-settings): 写入路径与 env 路径执行 settings 声明的 `step` 网格 (#6199)

  `step` 是 `SpecifierSchema` 五个值约束里的**第五个**,也是最后一个只声明不执行的。
  #5932(PR #6201)补齐 `min`/`max`/`minLength`/`maxLength` 之后,`step` 在
  `packages/services/service-settings/src/` 里仍是**零读取点**:superRefine 不校验它,
  写入路径不读它,env 路径不读它。

  **为什么判定为「值约束」而不是「纯 UI 提示」。** issue 提了两种读法,定论取自 schema
  自己的写法:`step` 与 `min`/`max` 声明在**同一段** `/** number / slider: numeric
bounds and step. */` 注释之下,即它是按「界」被作者写下的,而 #5932 的裁决(声明了
  的界就必须绑定)随之传递。另一种读法(它只是 `input[type=number]` 上下箭头的步进,
  从不表达「其他值非法」)经核查不成立:落地时 `step` 在本仓库与 `objectui` 中**没有
  任何消费者**——没有渲染器读它。按那种读法,这个键就是在为一个并不存在的渲染器表达
  「呈现」,那正是 ADR-0049 的洞,而不是 UI affordance。

  **修法与 #5932 同形,是同一族的第五个成员:**

  - `step` 挂进 `DeclaredBounds` 与 `firstRangeViolation`,因此它按构造同时到达两扇门
    ——写入路径(`validatePatch`)与 env 路径(`effectiveEnvOverride` 这**一个**判定点)
    ——不可能成为「只在一侧执行」的下一个键。
  - 越界发码表里现有的 `invalid_value`(ADR-0114:「rejected for a reason no other
    member names」)。码表里没有任何成员命名「网格」,而码表是刻意封闭的;
    `rest-server.ts` 早已把 Zod 的 `not_multiple_of` 映射到同一个成员,即同一条件从另一
    个方向到达时的同一裁决。⛔ `packages/spec` 未改动。
  - 沿用 #5131 / #5932 的 **TOUCH 闸门**:只校验本次 patch 触及的键。网格在产品生命
    周期里会被**放粗**(0.05 的滑杆改声明成 0.1),持有旧值的工作区必须仍能编辑无关设置。

  **锚点(anchor)约定:** 值须落在 `min + k * step` 上;未声明 `min` 时锚点取 `0`。
  这是 HTML step-base 约定,也是声明读起来的唯一自洽含义 —— `min: 1, step: 2` 指的是
  **奇数**,而不是偶数;一律锚 0 会把这个 specifier 整个反转。`constraint` 同时带
  `step` 与(声明了的话)`min`,客户端据此自行重建网格。

  **容差规则:** 网格判定为 `|value - nearest| <= max(|value|, |anchor|, |step|) * 1e-9`,
  其中 `nearest = anchor + round((value - anchor) / step) * step`。精确取模是错的 ——
  二进制浮点下 `0.7 / 0.1` 是 `6.999999999999999`、`1.2 / 0.1` 是 `11.999999999999998`,
  而这两个都是控制台滑杆自己会发出的值。容差取**相对**而非绝对:绝对量随操作数变化,
  `1e-9` 在 `step: 1e-6` 上会宽到三分之一步长,在 `max: 1048576` 上又比一个 ULP 还紧。
  `1e-9` 落在两类误差之间:double 的相对精度约 `2.2e-16`,几步算术累积约 `1e-15`,比这
  个界低六个数量级;而真正的越格差一小截步长(`0.15` 在 `0.1` 网格上差 `0.05`,相对
  `3e-1`),比它高八个数量级。比较在**值域**而非倍数域进行,以免容差的含义随网格粗细改变。
  剩余存疑的方向也是刻意的:本闸门是对「昨天什么都收」的收紧,所以在算术确实分辨不出时
  (量级大到网格比 double 自身间距还细)判**收**。

  **非正的 `step` 声明不构成网格。** `step: 0`(`anchor + k * 0` 是一个点)、负值、
  非有限值一律**不记录网格**,与「option-bearing specifier 没有 options 表」同一处置:
  无可执行者,行为不变,永不拒写。这与 #5204 的注册期姿态一致 —— 注册**报告**、从不
  拒绝 —— 而这里没有可报告的:声明了不可能网格的 manifest 既不拒写也不误配部署,它只是
  没有约束住,和其余没声明 `step` 的 specifier 处境完全相同。

  **已知后果,裁决时已接受:** 全仓库唯一的 `step` 声明是 `ai.manifest.ts` 的
  `temperature`(`min: 0, max: 2, step: 0.1`)。执行之后 `0.15` 被拒。这是该声明按其
  字面绑定,而不是本闸门的缺陷;这份声明本身是否该改(若 `0.15` 应当合法,则该 manifest
  应声明更细的 `step` 或不声明),属于 manifest 属主的问题。

- 9566c38: fix(service-settings): 写入路径与 env 路径执行 settings 声明的 min / max / minLength / maxLength (#5932)

  `SpecifierSchema` 从存在起就声明了五类值约束 —— `pattern` / `min` / `max` /
  `minLength` / `maxLength` —— 而 `SettingsService.validatePatch` 只读其中一类。
  另外四个在整个写入路径上**没有任何读取点**:已发布的 manifest 里 42 个
  specifier 声明了取值窗口,每一个都只是装饰。

  落点最重的是 `auth.password_min_length`。它声明 `min: 6`,控制台的数字框也按这个
  下限渲染,而 `PUT /api/settings/auth` 会接受 `1`(以及负数)并存下来,better-auth
  的口令策略随后照这个值执行。也就是说,声明是唯一一个宣称「存在下限」的东西,却没有
  任何一层在守它 —— 正是 Prime Directive #10 的正面形状。`ai.manifest.ts` 的六项
  (temperature / max_tokens / timeout 等)同理。

  **修法与 #5131(options 表)同形,是同一族的第三个成员:**

  - `validatePatch` 补一个取值窗口分支,发既有码表里的 `FieldError`(ADR-0114 D2):
    `min_value` / `max_value` / `min_length` / `max_length` —— 与
    `record-validator.ts` 对同一类越界发出的码一致。`constraint` 带**完整窗口**
    (`{ min, max }`,长度类再带 `actual`),客户端据此自行组织文案,不必解析我方
    英文句子。⛔ `packages/spec` 未改动:约束早已声明,码表现有即够用。
  - 沿用 #5131 的 **TOUCH 闸门**:只校验本次 patch 触及的键。取值窗口在产品生命周期里
    会被**收紧**(口令下限从 6 提到 8),窗口下方的老工作区必须仍能编辑它无关的设置,
    只在重写该键时才被告知。
  - env 侧走 `effectiveEnvOverride` 这**一个**判定点,与 options 表同处,复用同一组
    比较函数 —— #5204 的成因就是同一比较有两份实现并各自漂移。因此
    `OS_AUTH_PASSWORD_MIN_LENGTH=1` 与写入路径得到同一个裁决:该 override 不生效、
    不贡献 cascade 条目、不锁定该键,并在注册时打出一条(且仅一条)`error` 日志。

  **刻意不做的判断:** 取值窗口只裁决**可比较的值** —— `min`/`max` 只看数字(含经
  JSON / 表单往返变成字符串的数字),`minLength`/`maxLength` 只看字符串。布尔、数组、
  对象不做强制转换(`Number(true)` 是 1、`Number([])` 是 0):值的**形状**是
  `invalid_type`,属于另一个约束、另一个负责人,在这里发明裁决会拒掉本检查从未被要求
  过问的写入。空值仍归 `required` 管。

  约束的读取以**声明**为准,而不是以 specifier 的 `type` 为准 —— 与旁边按类型收口的
  options 检查不同,这个差异是 spec 定的:`SpecifierSchema` 的 superRefine 把 options
  表**绑定**到 `select`/`radio`/`multiselect` 三型,却没有把四个窗口键绑定到任何类型。
  在这里自拟一份类型清单,正是 options 注释警告的「第三份会漂移的清单」,并且会把本
  issue 原样复制到下一层:窗口键声明在清单外的类型上,照样解析、照样渲染、照样不执行。

- 23bc6e1: fix(service-settings): redact encrypted setting values at the REST read boundary (#7522)

  `GET /api/settings/:namespace` returned the **plaintext** of every encrypted
  setting in the namespace — in `values.<key>.value` and repeated once more in each
  `cascadeChain` entry. Both specifier flavours were affected: `type: 'password'`
  and an explicit `encrypted: true`. Storage was never the problem
  (`sys_setting.value` is null, `value_enc` holds a `sec_` handle, and `sys_secret`
  holds aes-256-gcm ciphertext); the leak was entirely on the way out.

  The endpoint requires `setup.access`, so this is defense-in-depth rather than
  privilege escalation — but every operator, integration, proxy, browser cache and
  HAR capture on that response path received the cleartext of every secret in the
  namespace, which is precisely what the `value_enc` + `sys_secret` split exists to
  prevent.

  **What changed.** The REST handlers now redact before the payload leaves the
  process, reusing the mask convention ADR-0100 already pins for encrypted
  _fields_ on the generic CRUD path rather than inventing a sentinel:

  - **Read** — a set secret is served as `SETTINGS_SECRET_MASK` (`••••••••`, the
    same eight bullets as objectql's `SECRET_MASK`); an unset one stays `null`. The
    redaction is presence-preserving, so "configured vs not configured" is still
    readable, and it covers `cascadeChain` entry by entry as well as the effective
    value. `source`, `locked`, `lockedReason` and the `409 SETTINGS_LOCKED`
    env-lock behaviour are untouched.
  - **Write** — a submitted value equal to the mask means "unchanged" and the key
    is dropped from the patch, so a form round-trip that echoes what it read does
    not overwrite the stored secret with the mask's literal text. The drop is
    scoped to secret keys: a plain setting whose value genuinely is eight bullets
    still writes verbatim. `PUT`'s own response is redacted the same way — it
    carries resolved values too, including cascade entries the caller never
    submitted.

  **What deliberately did not change.** `SettingsService` still decrypts.
  `materialiseRow()`, `get()`, `getNamespace()`, `snapshotOf()` and `createClient()`
  keep returning real plaintext, because the mail / sms / storage / auth plugins
  read their credentials through exactly that path. Redaction belongs to the REST
  boundary and nowhere else; a test pins the in-process round-trip so this cannot
  be "fixed" one layer down.

  New public API on `@objectstack/service-settings`: `SETTINGS_SECRET_MASK`,
  `redactSecretValues`, `dropEchoedSecretMasks`, and
  `SettingsService.secretKeysOf(namespace)` — published so a client can recognise a
  masked read instead of comparing against a hard-coded string.

- 8d01f0e: fix(service-settings): rotating an encrypted setting now actually rotates it — the secret handle is repointed, and the retired ciphertext is destroyed (#8030)

  A **second** `PUT` of a new value for an encrypted setting key answered **200**
  with a correctly redacted body, advanced `updated_at`, wrote an audit row and
  inserted a genuinely new `sys_secret` row holding the new plaintext — and left
  `sys_setting.value_enc` pointing at the **first** handle. The effective secret
  never changed.

  Nothing an administrator can see said so. Rotating a leaked SMTP password or
  provider API key looked exactly like a rotation that worked, while the leaked
  credential stayed the one in force. The **first** write of any secret was
  correct, so the defect was invisible until the second.

  **Cause.** `sys_setting.value_enc` (and `updated_by`) are declared
  `readonly: true`, and the engine strips author-declared read-only columns from a
  **non-system** caller's UPDATE payload. `SettingsService` persisted its rows
  through a plain, un-elevated `engine.update`, so the handle could never be
  repointed. The INSERT path is deliberately exempt from that strip — which is
  precisely why the first write landed and every later one did not.

  **Fix.** `SettingsService` performs its own row update as a **system** write.
  It is a privileged writer — the manifest capability gate, the env/upper-scope
  lock pre-flight and value validation have all already run by then, and these are
  columns it owns rather than ones a caller forged. The `IDataEngine` adapter
  forwards that execution context on both of its branches.

  ⚠️ `value_enc` **stays `readonly: true`**. The elevation is scoped to this one
  write, so an external caller reaching `sys_setting` through the data layer still
  cannot repoint a secret handle — that flag is a security control, and removing
  it would have been the wrong direction on this defect. There is a test that
  fails if someone removes it.

  **Orphans are reaped, not accepted.** A rotation used to leave the previous
  `sys_secret` row behind — one more decryptable copy of the credential the admin
  just retired, accumulating per rotation (7 → 8 → 9 across three writes). The
  row a rotated-away handle named is now deleted once the repoint has committed.
  The delete is best-effort and reported if it fails: the new secret is already in
  force at that point, and a failed cleanup must not turn a successful rotation
  into an error.

  Unaffected: the first-write path is byte-for-byte the same; the `••••••••`
  mask-echo no-op still leaves the stored ciphertext untouched; env-locked secrets
  still refuse writes with `409 SETTINGS_LOCKED`; and a secret store without the
  new optional `delete` keeps working, simply accepting the orphans.

- 82a06af: fix(service-settings): a settings `select` now rejects values outside its declared `options` (#5131)

  `SettingsService.validatePatch` enforced two of the constraints a settings
  manifest declares — `required` and `pattern` — and skipped the third. A
  specifier's `options` table never took part in save-time validation, so any
  string at all could be written into a dropdown field:

  ```ts
  await svc.setMany("mail", { provider: "sendgrid", from_email: "a@b.com" }); // stored
  ```

  Going through the console this was unreachable: the dropdown only ever emits a
  value from the table. But `PUT /api/settings/:ns` is an authorizable public
  surface, and scripts, migration tools and AI-authored bootstrap code write it
  directly — where the bad value was accepted, persisted and read back **in
  silence**, leaving every consumer to improvise its own answer for an
  enumeration member that does not exist. It was not `mail`-specific:
  `storage.adapter`, `sms.provider`, `ai.provider`, `localization.date_format` and
  every other `select` behaved the same way.

  This is the API-side gate that #5094 was missing. That change retired
  `sendgrid` / `ses` from the `mail` provider table because this server cannot
  deliver through them — with no write-side enforcement, the values it had just
  retired could be written straight back in the same afternoon.

  **Now:** a `select` / `radio` / `multiselect` value that is not a member of the
  declared table is rejected with a `FieldError` whose `code` is `invalid_option`
  and whose `constraint` carries the allowed set (`{ allowed: 'smtp, resend,
postmark, log' }`), so a client composes its own message instead of parsing
  ours. The enforced set is the spec's own: `SpecifierSchema` already _requires_ a
  non-empty `options` on exactly those three types, so declared and enforced name
  one list rather than two that can drift.

  Two deliberate limits keep this from breaking workspaces that already carry
  drift:

  - **The check is gated on TOUCH**, like `required` and `pattern` before it. A
    value that pre-dates the current option table only fails the patch that
    writes that key — editing `from_name` is not rejected because a stale
    `provider` sits in the store. The opposite rule would lock every workspace
    with historical drift out of its own settings page entirely, which is worse
    than the gap being closed. Resets (all-null patches) are never blocked.
  - **A specifier that declares no option table is left alone.** It cannot say
    what is legal, so it stays lenient rather than rejecting every write.

  Values are compared in string form, so an option declared `value: 30` still
  matches after a round trip through JSON or a form post. There is no opt-out: a
  manifest that needs to accept custom values would declare that explicitly in
  the spec, not rely on a tolerant consumer.

- d538647: fix(service-settings): refuse a save whose `visible` predicate cannot be evaluated, instead of silently skipping the field's `required` gate (#7169)

  **Before:** a settings specifier whose `visible` predicate the save-time
  evaluator could not parse was skipped entirely — `validatePatch` answered the
  parse failure with `catch { continue }`. Because `visible` is the gate every
  other check hangs off, that `continue` switched off `required`, `options`,
  `pattern`, `valueDomain` **and** the value window on that key at once, silently
  and permanently, with no diagnostic anywhere. A half-filled provider form saved
  clean.

  **After:** the write is refused. `setMany` throws `SettingsValidationError`
  (`SETTINGS_VALIDATION`, HTTP 400) carrying one `FieldError` per offending
  specifier — `code: 'invalid_value'`, the parse reason in `message`, and the
  predicate itself under `constraint.visible`, so a client can name which
  expression refused without parsing prose. Refusal is **unconditional**, not
  gated on the patch touching the key: the console posts only its dirty keys, so a
  touch gate would never fire on the incident this fixes. All-null patches
  (namespace reset) still return before the check, so a namespace whose manifest
  is broken can always be cleared.

  This is the interim stop-the-bleed half of the maintainer's 2026-08-10 ruling on
  #7169. The declaration/implementation gap it stems from is still open:
  `packages/spec` types both settings `visible` slots as `ExpressionInputSchema`,
  which labels their contents **CEL**, while this service evaluates a hand-rolled
  JS-ish subset. Measured over the 94 `visible` predicates in the bundled
  manifests, wiring CEL into evaluation would break 93 of them and narrowing the
  declared type would break 1 — see the PR for the numbers. Narrowing is
  recommended and lands separately in `packages/spec`.

  **Also fixed, and load-bearing for the above:** the evaluator now supports the
  relational operators `>`, `>=`, `<`, `<=`, with the same JS semantics the
  console's client-side evaluator applies to the same strings. The auth manifest
  already shipped `visible: '${data.lockout_threshold > 0}'`, which this grammar
  refused — so on the old fail-open path `auth.lockout_duration_minutes` accepted
  `-5` and `99999` against its declared `min: 1, max: 1440`. That window is
  enforced again.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- 41c3b48: feat(plugin-email): real SMTP delivery — `SmtpTransport`, settings hot-swap, and a `mail/test` that actually sends (#5087)

  The **Mail Delivery** settings page has always defaulted to SMTP and offered a
  full host / port / TLS / username / password form. Nothing behind it delivered:
  `applyMailSettings` treated `provider: 'smtp'` as a no-op ("transport
  unchanged"), `mail/test` answered `ok: true, "Configuration looks valid … Wire
@objectstack/plugin-mail for actual delivery"` — a success toast for a message
  nobody sent, naming a package that has never existed — and the code pointed
  operators at `@objectstack/plugin-mail-smtp`, which is not in this repo or on
  npm. A workspace that selected SMTP got a green form, a green test button, and
  mail that only ever reached the log and the `sys_email` table. For deployments
  in China this left **no** working channel at all: Resend and Postmark are
  overseas HTTPS SaaS with unreliable reach and deliverability to QQ / 163 /
  enterprise mailboxes, where SMTP is the normal path (Aliyun DirectMail, Tencent
  SES, corporate mail servers).

  **`SmtpTransport` now ships in `@objectstack/plugin-email`** (ADR-0012: SMTP in
  core, implemented with `nodemailer`). `nodemailer` is a real dependency but is
  imported **lazily on the first send**, so deployments that never select SMTP —
  and non-Node runtimes — never load `node:net` / `node:tls`.

  Three doors reach it, all sharing one options reader so they cannot drift:

  - **Settings → Mail** (`smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` /
    `smtp_password`) hot-swaps the live transport on save, no restart.
  - **`os serve`** via `OS_EMAIL_PROVIDER=smtp` plus the new `OS_EMAIL_SMTP_HOST` /
    `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` (or `config.email.options`).
  - **Constructor**: `new EmailServicePlugin({ provider: 'smtp', providerOptions:
{ host, port, secure, user, password } })`.

  TLS is one toggle with the wire behaviour derived from the port, as providers
  document it: on `465` implicit TLS (SMTPS); on any other port a **required**
  STARTTLS upgrade, so a server that refuses to upgrade fails the send instead of
  leaking credentials over a cleartext socket; `secure: false` connects in the
  clear and upgrades only when STARTTLS is offered.

  **Failure is loud everywhere, because a silent fallback is the bug this fixes.**
  On the construction path (CLI / plugin options) a `smtp` provider with no host
  **throws** and the boot fails — it no longer degrades into a LogTransport that
  reports every send as successful. On the settings hot-swap path a save can never
  kill a running server, so the previous transport is kept — but the failure is
  logged at `error` naming the consequence and the fix, and **`mail/test` now
  performs a real delivery** through the settings on screen and reports the SMTP
  server's own words (`535 … authentication failed`) instead of a green toast. The
  built-in fallback `mail/test` handler (used only when no email plugin is
  mounted) answers `ok: false` and says plainly that nothing was sent.

  Nothing to migrate: `log`, `resend` and `postmark` behave exactly as before, and
  a deployment that never selects `smtp` is unaffected.

- 64f8cbe: feat(platform-objects,service-settings,verify): `sys_secret` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the settings service (#4270)

  The environment's encrypted-secret store (`sys_secret`, ADR-0066 D2/④) was
  registered by `@objectstack/service-settings`, but it has three producer
  classes and only one of them is settings: the settings service's encrypted
  specifiers, the ObjectQL engine's own `secret`-field encryption
  (`encryptSecretFields`/`resolveSecret` — the generic write path of ANY
  business object carrying a `Field.secret()`), and the datasource credential
  binder. Unlike the `sys_migration` precedent (#4243), the failure posture is
  fail-CLOSED: on a kernel composed without settings, every insert/update of an
  object with a secret field threw — with an error message that told the
  operator to "Ensure the platform-objects (sys_secret) are registered", naming
  a package that did not register it.

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the store exists with the
  platform, independent of which optional services are composed, and the
  engine's fail-closed error message is true. Definition ownership is unchanged
  (`sys_secret` stays in `@objectstack/platform-objects` and in
  `PLATFORM_OBJECTS_BY_PACKAGE`); the settings service remains a producer and
  consumer through its `sys_secret`-backed secret store.

  Consequences:

  - `@objectstack/service-settings` no longer contributes `sys_secret` to the
    manifest (`settingsObjects` is now `[SysSetting, SysSettingAudit]`). An
    embedder composing `SettingsServicePlugin` on a hand-built kernel that
    relied on it for the `sys_secret` table must compose
    `PlatformObjectsPlugin` (the plugin every supported assembly path already
    includes). The move REPLACES the registration — nothing registers the
    object twice.
  - `@objectstack/verify`'s boot harness now composes `PlatformObjectsPlugin`,
    mirroring `os serve`'s auto-inject — which also means harness kernels now
    carry the `sys_migration` ledger + fresh-datastore attestation (#4243) the
    served assembly always had.

- a629074: fix(auth): the second factor now obeys the operator's lockout policy instead of better-auth's defaults (#3690)

  `auth-manager.ts` constructed `twoFactor()` with a schema and nothing else, so
  better-auth's built-in `accountLockout` defaults — on, 10 attempts, 15 minutes —
  governed two-factor verification no matter what the admin configured. An operator
  who tightened **Setup → Authentication → Account lockout threshold** to 3 got a
  password stage that locked at 3 and a second factor that still locked at 10: the
  stricter door was the looser one, with nothing in the UI saying so.

  `lockout_threshold` / `lockout_duration_minutes` are now projected onto
  better-auth's own `accountLockout` shape (`enabled` / `maxFailedAttempts` /
  `durationSeconds`, minutes converted to seconds) rather than growing a parallel
  `two_factor_lockout_*` pair — one policy, one mental model, and a future upstream
  field arrives as a new option instead of a conflict. The projection goes through
  `applyConfigPatch`, which resets the cached better-auth instance, so a settings
  change takes effect without a restart.

  Threshold `0` is deliberately **not** forwarded as `enabled: false`. It is the
  password stage's "off", and a deployment may leave that stage unlocked because
  rate limiting or an IdP covers it; the second factor is the last check before a
  session is issued, so it keeps better-auth's default rather than being switched
  off by a setting that never mentioned it.

  The threshold field is also no longer hidden behind `email_password_enabled` —
  two-factor verification exists in passwordless deployments, where the setting was
  previously unreachable.

  The admin **Unlock Account** action now clears both stages. It only ever reset
  `sys_user`, so a user locked at the second factor had no admin escape hatch and
  had to wait the duration out — survivable while that lock needed 10 failures,
  routine once an operator can set the threshold to 3. The second-factor clear is
  best-effort and runs after the primary write, so an account with no enrolment
  still unlocks normally.

  Note the plugin caps attempts at 5 per challenge (`beginAttempt(5)`), which no
  option reaches; a threshold above 5 forces a fresh challenge rather than raising
  that cap.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [c44dd5e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [52200b4]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [5fa04fb]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [4921a95]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [9aa5510]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/types@17.0.0

## 17.0.0-rc.6

### Patch Changes

- eb1b231: Remove `step: 0.1` from the `ai.temperature` specifier (#6550). Since #6199 a declared `step` binds as a value constraint on both doors, and temperature's true domain is continuous on [0, 2]: the 0.1 grid refused legal values — `PUT /api/settings/ai` with `temperature: 0.15` was rejected and `OS_AI_TEMPERATURE=0.15` was loudly ignored. Both now work; `min: 0` / `max: 2` stay and keep binding (out-of-window values are still refused in the min/max vocabulary). #6199's grid machinery is untouched and still enforces any key that declares `step`.
- 0b63b56: `company.country` adopts the `iso_3166_alpha2` value domain (#6579), the fourth case of the hole #5712 closed on localization: `pattern: '^[A-Za-z]{2}$'` constrains shape only, so `ZZ` (assigned to nobody) and `UK` (a CLDR alias, not an ISO 3166-1 code) passed the write door while the description promised ISO 3166-1. Both doors now judge membership against the explicit 249-code list (`invalid_value` with `constraint: { valueDomain: 'iso_3166_alpha2' }` on save; loud ignore on `OS_COMPANY_COUNTRY`). The pattern stays — a shape breach still speaks first as `invalid_format`. Deliberate tightening, same as #5712: membership is exact uppercase, so lowercase spellings like `us` are now refused.
- 861ee32: The settings env door now enforces declared `pattern` constraints (#6580). An
  `OS_*` override whose value the specifier's `pattern` rejects is loudly
  reported (`error` log, once per var+value) and ignored — the key resolves from
  the next cascade layer and is not locked — exactly the #5204 contract the
  option-table, value-window/step and valueDomain families already honor. The
  write gate's judgment is hoisted into shared helpers (`declaredPattern` /
  `firstPatternMiss`) called by both doors, so `PUT /api/settings/:ns` behavior
  is unchanged byte-for-byte (same `invalid_format` envelope, same tolerance for
  uncompilable pattern declarations) and the two doors can no longer drift.
  Family ordering agrees between doors: options → pattern → valueDomain → bounds.
- babddf6: fix(service-settings): localization's declared standards are the enforcement boundary — `valueDomain` enforced on both doors (#5712)

  `localization.timezone` promised "IANA zone" and `localization.currency` promised
  "ISO 4217 code", but since #5131 the write path treated their curated 17/9-entry
  `options` tables as exhaustive, and since #5204 the env path agreed — so
  `PUT /api/settings/localization` with `timezone: 'Europe/Zurich'` (or
  `currency: 'CHF'`) was refused with `invalid_option`, and
  `OS_LOCALIZATION_TIMEZONE=Europe/Zurich` was ignored, despite both being values
  every `Intl`-based consumer downstream handles. Maintainer ruling (2026-08-06,
  reading 1): the curated tables are UI convenience lists; the boundary is the
  standard's membership.

  The manifest now declares the merged spec vocabulary (#5933 / `SpecifierValueDomainSchema`)
  on the three keys that promised a standard all along — `timezone: 'iana_time_zone'`,
  `currency: 'iso_4217_currency'`, and `default_country: 'iso_3166_alpha2'` (third
  case of the same hole: `^[A-Za-z]{2}$` admits `ZZ`) — and `SettingsService`
  enforces a declared domain at the one decision point per door:

  - **Write door** (`validatePatch`): a domain-bearing specifier skips the
    exhaustive-options check and judges the standard's membership instead, after
    `pattern` (shape and membership narrow independently; the shape breach is the
    coarser fact and speaks first). A breach is `invalid_value` with
    `constraint: { valueDomain }` — no `FieldErrorCode` member names a
    standard-domain breach, and `invalid_option` would misname the set that was
    consulted.
  - **Env door** (`effectiveEnvOverride`): the same membership judgment, so a
    garbage override is loudly reported and ignored (falls back down the cascade,
    pins nothing — #5204's contract, unchanged) while a legal one wins the cascade
    and locks the key.

  Membership definitions follow the spec's pinned TSDoc: `iana_time_zone` is the
  `Intl.DateTimeFormat` probe (NOT `Intl.supportedValuesOf('timeZone')`, whose
  CLDR subset omits `UTC`, `Asia/Kolkata` and `Europe/Kyiv`); `iso_4217_currency`
  is `Intl.supportedValuesOf('currency')`; `iso_3166_alpha2` is an explicit list
  of the 249 officially assigned codes (no standard-library oracle exists —
  `Intl.DisplayNames` names `ZZ` and `UK`).

  A specifier that declares no `valueDomain` is byte-for-byte unchanged: #5131's
  exhaustive-options semantics stay in force for registry-backed tables such as
  `mail.provider` / `sms.provider`, pinned by regression tests on both doors.

- 4afdd3e: fix(service-settings): 写入路径与 env 路径执行 settings 声明的 `step` 网格 (#6199)

  `step` 是 `SpecifierSchema` 五个值约束里的**第五个**,也是最后一个只声明不执行的。
  #5932(PR #6201)补齐 `min`/`max`/`minLength`/`maxLength` 之后,`step` 在
  `packages/services/service-settings/src/` 里仍是**零读取点**:superRefine 不校验它,
  写入路径不读它,env 路径不读它。

  **为什么判定为「值约束」而不是「纯 UI 提示」。** issue 提了两种读法,定论取自 schema
  自己的写法:`step` 与 `min`/`max` 声明在**同一段** `/** number / slider: numeric
bounds and step. */` 注释之下,即它是按「界」被作者写下的,而 #5932 的裁决(声明了
  的界就必须绑定)随之传递。另一种读法(它只是 `input[type=number]` 上下箭头的步进,
  从不表达「其他值非法」)经核查不成立:落地时 `step` 在本仓库与 `objectui` 中**没有
  任何消费者**——没有渲染器读它。按那种读法,这个键就是在为一个并不存在的渲染器表达
  「呈现」,那正是 ADR-0049 的洞,而不是 UI affordance。

  **修法与 #5932 同形,是同一族的第五个成员:**

  - `step` 挂进 `DeclaredBounds` 与 `firstRangeViolation`,因此它按构造同时到达两扇门
    ——写入路径(`validatePatch`)与 env 路径(`effectiveEnvOverride` 这**一个**判定点)
    ——不可能成为「只在一侧执行」的下一个键。
  - 越界发码表里现有的 `invalid_value`(ADR-0114:「rejected for a reason no other
    member names」)。码表里没有任何成员命名「网格」,而码表是刻意封闭的;
    `rest-server.ts` 早已把 Zod 的 `not_multiple_of` 映射到同一个成员,即同一条件从另一
    个方向到达时的同一裁决。⛔ `packages/spec` 未改动。
  - 沿用 #5131 / #5932 的 **TOUCH 闸门**:只校验本次 patch 触及的键。网格在产品生命
    周期里会被**放粗**(0.05 的滑杆改声明成 0.1),持有旧值的工作区必须仍能编辑无关设置。

  **锚点(anchor)约定:** 值须落在 `min + k * step` 上;未声明 `min` 时锚点取 `0`。
  这是 HTML step-base 约定,也是声明读起来的唯一自洽含义 —— `min: 1, step: 2` 指的是
  **奇数**,而不是偶数;一律锚 0 会把这个 specifier 整个反转。`constraint` 同时带
  `step` 与(声明了的话)`min`,客户端据此自行重建网格。

  **容差规则:** 网格判定为 `|value - nearest| <= max(|value|, |anchor|, |step|) * 1e-9`,
  其中 `nearest = anchor + round((value - anchor) / step) * step`。精确取模是错的 ——
  二进制浮点下 `0.7 / 0.1` 是 `6.999999999999999`、`1.2 / 0.1` 是 `11.999999999999998`,
  而这两个都是控制台滑杆自己会发出的值。容差取**相对**而非绝对:绝对量随操作数变化,
  `1e-9` 在 `step: 1e-6` 上会宽到三分之一步长,在 `max: 1048576` 上又比一个 ULP 还紧。
  `1e-9` 落在两类误差之间:double 的相对精度约 `2.2e-16`,几步算术累积约 `1e-15`,比这
  个界低六个数量级;而真正的越格差一小截步长(`0.15` 在 `0.1` 网格上差 `0.05`,相对
  `3e-1`),比它高八个数量级。比较在**值域**而非倍数域进行,以免容差的含义随网格粗细改变。
  剩余存疑的方向也是刻意的:本闸门是对「昨天什么都收」的收紧,所以在算术确实分辨不出时
  (量级大到网格比 double 自身间距还细)判**收**。

  **非正的 `step` 声明不构成网格。** `step: 0`(`anchor + k * 0` 是一个点)、负值、
  非有限值一律**不记录网格**,与「option-bearing specifier 没有 options 表」同一处置:
  无可执行者,行为不变,永不拒写。这与 #5204 的注册期姿态一致 —— 注册**报告**、从不
  拒绝 —— 而这里没有可报告的:声明了不可能网格的 manifest 既不拒写也不误配部署,它只是
  没有约束住,和其余没声明 `step` 的 specifier 处境完全相同。

  **已知后果,裁决时已接受:** 全仓库唯一的 `step` 声明是 `ai.manifest.ts` 的
  `temperature`(`min: 0, max: 2, step: 0.1`)。执行之后 `0.15` 被拒。这是该声明按其
  字面绑定,而不是本闸门的缺陷;这份声明本身是否该改(若 `0.15` 应当合法,则该 manifest
  应声明更细的 `step` 或不声明),属于 manifest 属主的问题。

- 9566c38: fix(service-settings): 写入路径与 env 路径执行 settings 声明的 min / max / minLength / maxLength (#5932)

  `SpecifierSchema` 从存在起就声明了五类值约束 —— `pattern` / `min` / `max` /
  `minLength` / `maxLength` —— 而 `SettingsService.validatePatch` 只读其中一类。
  另外四个在整个写入路径上**没有任何读取点**:已发布的 manifest 里 42 个
  specifier 声明了取值窗口,每一个都只是装饰。

  落点最重的是 `auth.password_min_length`。它声明 `min: 6`,控制台的数字框也按这个
  下限渲染,而 `PUT /api/settings/auth` 会接受 `1`(以及负数)并存下来,better-auth
  的口令策略随后照这个值执行。也就是说,声明是唯一一个宣称「存在下限」的东西,却没有
  任何一层在守它 —— 正是 Prime Directive #10 的正面形状。`ai.manifest.ts` 的六项
  (temperature / max_tokens / timeout 等)同理。

  **修法与 #5131(options 表)同形,是同一族的第三个成员:**

  - `validatePatch` 补一个取值窗口分支,发既有码表里的 `FieldError`(ADR-0114 D2):
    `min_value` / `max_value` / `min_length` / `max_length` —— 与
    `record-validator.ts` 对同一类越界发出的码一致。`constraint` 带**完整窗口**
    (`{ min, max }`,长度类再带 `actual`),客户端据此自行组织文案,不必解析我方
    英文句子。⛔ `packages/spec` 未改动:约束早已声明,码表现有即够用。
  - 沿用 #5131 的 **TOUCH 闸门**:只校验本次 patch 触及的键。取值窗口在产品生命周期里
    会被**收紧**(口令下限从 6 提到 8),窗口下方的老工作区必须仍能编辑它无关的设置,
    只在重写该键时才被告知。
  - env 侧走 `effectiveEnvOverride` 这**一个**判定点,与 options 表同处,复用同一组
    比较函数 —— #5204 的成因就是同一比较有两份实现并各自漂移。因此
    `OS_AUTH_PASSWORD_MIN_LENGTH=1` 与写入路径得到同一个裁决:该 override 不生效、
    不贡献 cascade 条目、不锁定该键,并在注册时打出一条(且仅一条)`error` 日志。

  **刻意不做的判断:** 取值窗口只裁决**可比较的值** —— `min`/`max` 只看数字(含经
  JSON / 表单往返变成字符串的数字),`minLength`/`maxLength` 只看字符串。布尔、数组、
  对象不做强制转换(`Number(true)` 是 1、`Number([])` 是 0):值的**形状**是
  `invalid_type`,属于另一个约束、另一个负责人,在这里发明裁决会拒掉本检查从未被要求
  过问的写入。空值仍归 `required` 管。

  约束的读取以**声明**为准,而不是以 specifier 的 `type` 为准 —— 与旁边按类型收口的
  options 检查不同,这个差异是 spec 定的:`SpecifierSchema` 的 superRefine 把 options
  表**绑定**到 `select`/`radio`/`multiselect` 三型,却没有把四个窗口键绑定到任何类型。
  在这里自拟一份类型清单,正是 options 注释警告的「第三份会漂移的清单」,并且会把本
  issue 原样复制到下一层:窗口键声明在清单外的类型上,照样解析、照样渲染、照样不执行。

- d538647: fix(service-settings): refuse a save whose `visible` predicate cannot be evaluated, instead of silently skipping the field's `required` gate (#7169)

  **Before:** a settings specifier whose `visible` predicate the save-time
  evaluator could not parse was skipped entirely — `validatePatch` answered the
  parse failure with `catch { continue }`. Because `visible` is the gate every
  other check hangs off, that `continue` switched off `required`, `options`,
  `pattern`, `valueDomain` **and** the value window on that key at once, silently
  and permanently, with no diagnostic anywhere. A half-filled provider form saved
  clean.

  **After:** the write is refused. `setMany` throws `SettingsValidationError`
  (`SETTINGS_VALIDATION`, HTTP 400) carrying one `FieldError` per offending
  specifier — `code: 'invalid_value'`, the parse reason in `message`, and the
  predicate itself under `constraint.visible`, so a client can name which
  expression refused without parsing prose. Refusal is **unconditional**, not
  gated on the patch touching the key: the console posts only its dirty keys, so a
  touch gate would never fire on the incident this fixes. All-null patches
  (namespace reset) still return before the check, so a namespace whose manifest
  is broken can always be cleared.

  This is the interim stop-the-bleed half of the maintainer's 2026-08-10 ruling on
  #7169. The declaration/implementation gap it stems from is still open:
  `packages/spec` types both settings `visible` slots as `ExpressionInputSchema`,
  which labels their contents **CEL**, while this service evaluates a hand-rolled
  JS-ish subset. Measured over the 94 `visible` predicates in the bundled
  manifests, wiring CEL into evaluation would break 93 of them and narrowing the
  declared type would break 1 — see the PR for the numbers. Narrowing is
  recommended and lands separately in `packages/spec`.

  **Also fixed, and load-bearing for the above:** the evaluator now supports the
  relational operators `>`, `>=`, `<`, `<=`, with the same JS semantics the
  console's client-side evaluator applies to the same strings. The auth manifest
  already shipped `visible: '${data.lockout_threshold > 0}'`, which this grammar
  refused — so on the old fail-open path `auth.lockout_duration_minutes` accepted
  `-5` and `99999` against its declared `min: 1, max: 1440`. That window is
  enforced again.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [5fa04fb]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- 586d6f7: feat(auth): `membership_policy` is a platform setting, and sign-up and backfill read one source (#5152)

  **What a new user joins is now configurable at runtime.** ADR-0093's
  `membershipPolicy` decides whether a freshly created user is auto-bound to the
  deployment's default organization (`auto`) or gets membership only from an
  explicit act — creating a workspace, accepting an invitation, an admin adding
  them, SSO just-in-time provisioning (`invite-only`). Until now it was settable
  **only** as an `AuthPlugin` constructor option, and the AuthPlugin a self-hosted
  stack gets is injected by the CLI, which passes no such option and has no env
  fallback. Every self-hosted deployment therefore ran `auto`, with no way to say
  otherwise. `invite-only` was, in practice, unreachable outside a custom host.

  It is now `auth.membership_policy` in the platform settings — a two-value select
  (`auto` / `invite-only`, default `auto`) alongside `signup_enabled`, which it
  pairs with: one says whether people may self-register, the other says what they
  join when they do. Set it in Setup → Authentication → Membership, or pin it
  per-deployment with `OS_AUTH_MEMBERSHIP_POLICY`. It applies **without a
  restart** — the existing `settings.subscribe('auth', …)` re-application seam
  carries it, the same one the password-policy keys ride.

  **No behaviour changes unless you set it.** Only an _explicit_ value applies;
  the manifest's `auto` default is a UI default and never masks a deployment that
  configured the policy in code. A stack that sets nothing keeps today's
  auto-binding exactly.

  **Bug fix — the two membership paths read one source.** Sign-up (the reconciler
  in better-auth's `user.create.after`) read the AuthManager's live config, while
  the ADR-0093 D6 backfill of pre-existing member-less users read the plugin's
  **constructor options**. Wiring a setting to the first and not the second would
  have produced "sign-up honours the new policy, backfill still runs the old one"
  — and the backfill binds in **bulk**, so it is the more dangerous half. Both now
  resolve the policy through the new `AuthManager.getMembershipPolicy()`, and the
  backfill waits for the settings namespace to bind before its first pass (the two
  `kernel:ready` hooks fire in registration order, which was the wrong order).

  **An invalid value is rejected, not coerced.** `PUT /api/settings/auth` refuses
  a policy outside the declared option table (`invalid_option`, naming the allowed
  set). A value arriving from `OS_AUTH_MEMBERSHIP_POLICY` — which bypasses that
  validation — is logged at `error` and **ignored**, leaving the deployment's
  current policy in force; it is never silently read as `auto`, because that would
  leave an operator believing a wall is up while every sign-up is auto-bound.

  New public API on `@objectstack/plugin-auth`: `AuthManager.getMembershipPolicy()`,
  plus `MEMBERSHIP_POLICIES` and `isMembershipPolicy()` from `reconcile-membership`.

- 9c4f174: feat(plugin-email): durable email delivery through `sys_job_queue`, opt-in (#5160)

  `IEmailService.send()` has always delivered **inline**: the SMTP session ran
  inside the caller's `await`, and `EmailService`'s retry loop lived in the same
  process — so a crash between the attempt and the retry dropped the message with
  no trace beyond a `sys_email` row stuck at `queued`. The pieces for a durable
  path all existed (`sys_job_queue`, the `DbQueueAdapter`, an `email.send.async`
  subscriber) but nothing in the repo ever published to that topic.

  **New: `queueDelivery`.** With it on, `send()` persists the `sys_email` row,
  publishes an `email.send.async` job **referencing that row**, and returns
  `{ status: 'queued' }` immediately. A worker delivers the row and finalizes it
  in place (`sent` + `message_id`, or `failed` + `error`); the queue retries with
  exponential backoff (1s → 5min cap) and dead-letters the job when the attempts
  run out, so a restart resumes delivery instead of losing it. The `'queued'`
  status was already in `EmailDeliveryStatus` — no spec change.

  Three ways to turn it on, all default-off:

  - `new EmailServicePlugin({ queueDelivery: true })`
  - `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) on `os serve`
  - Settings → Mail → **Durable queue delivery**, hot-applied without a restart

  **One retry budget, not two.** `retries` keeps its meaning — total attempts are
  `retries + 1` in both modes. Inline it drives the in-process loop; queued it
  becomes the queue's `maxAttempts` and the per-row loop is pinned to one attempt
  per delivery. Turning the toggle on changes _where_ a retry happens (durable,
  backed off) and never _how many_ happen, so the two layers cannot multiply.

  **Fixed in the same change: the `email.send.async` subscriber inserted a new
  `sys_email` row per delivery.** It called `send()` with the message, so a job
  the queue retried five times left five rows — four permanently `failed`, none
  carrying the real attempt count. It now delivers the referenced row via
  `deliverPersistedRow`, so one message is one row and `attempt_count`
  accumulates on it. Messages published in the old shape (a bare `SendEmailInput`)
  are still accepted and delivered inline for a migration window.

  Boundaries worth knowing before you switch it on:

  - **"Send test email" always sends inline**, in every mode — the button has to
    report the provider's own answer (`535 …`), and "queued" is exactly the
    non-answer #5087 removed from it.
  - **Messages with attachments or custom headers are delivered inline**, because
    `sys_email` has no columns for them and a queued copy would arrive stripped.
    Queueing them is tracked separately; this ships the loss-free behaviour.
  - **A declaration that cannot be honoured fails the boot.** `queueDelivery: true`
    from the constructor or `OS_EMAIL_QUEUE_ENABLED` with no durable queue
    registered (or with `persist: false`) throws on `kernel:ready`, naming the
    fix — the #5132 judgement, applied to durability. The **settings toggle** is
    the opposite trade: it logs at `error` and keeps sending inline, because one
    save must not stop the mail.
  - The kernel's built-in in-memory `queue` fallback does **not** count as a
    durable queue: it delivers synchronously with no retry or DLQ, so publishing
    to it would report `queued` for a message nothing could ever recover. Mount
    `@objectstack/service-queue` over an ObjectQL engine (the `queue` capability
    does this on `os serve`) to get the `sys_job_queue`-backed adapter.

  Leaving `queueDelivery` unset keeps today's behaviour byte for byte.

- 8597a7d: fix(service-settings,plugin-email): the mail provider dropdown lists only providers that actually deliver (#5094)

  **Settings → Mail → Provider** offered `SMTP | SendGrid | Amazon SES | Postmark`.
  `@objectstack/plugin-email` has never carried a SendGrid or an SES transport —
  `makeTransport` knows `log` / `resend` / `postmark` / `smtp` and nothing else. So
  selecting either of the two validated, saved, showed a success toast, and then
  delivered no mail at all: the same declared-but-not-delivered gap #5087 closed
  for SMTP, one field to the left.

  The same field broke the invariant in the other direction at the same time:
  **`resend` has shipped a working transport all along and was not on the list**,
  so nobody could pick the one HTTP provider that worked.

  **The dropdown is now `SMTP | Resend | Postmark | None (log only — no real
delivery)` — exactly the set `makeTransport` can build.** No email capability was
  removed with SendGrid and SES. Both publish SMTP endpoints, and #5087 shipped a
  real `SmtpTransport`, so both are configured today as `smtp`:

  | provider   | host                                | port | credentials                                                                        |
  | :--------- | :---------------------------------- | :--- | :--------------------------------------------------------------------------------- |
  | SendGrid   | `smtp.sendgrid.net`                 | 587  | username `apikey`, password = your API key                                         |
  | Amazon SES | `email-smtp.<region>.amazonaws.com` | 587  | SES **SMTP credentials** (generated in the SES console — not your AWS access keys) |

  The provider field's own description says this, so the migration is in front of
  whoever goes looking for the option that disappeared.

  `log` is listed rather than hidden. It is the one option that does not deliver —
  but it does not pretend to: the label says so, `LogTransport` still records every
  message to `sys_email`, and "Send test email" answers `ok: false` for it. That
  gives an operator the deliberate, visible opt-out AGENTS.md asks a degradation to
  be, instead of expressing "no outbound mail" as a half-filled SMTP form. It is
  also what makes _offered_ and _deliverable_ the same set rather than merely
  overlapping — which is the property a test can hold.

  **Already saved `sendgrid` or `ses`? Nothing breaks and nothing goes quiet.** The
  stored value outlives the dropdown, so `applyMailSettings` now recognises it
  explicitly: the previous transport is kept (a settings row written by an older
  release must never fail a boot), and the server logs at `error` with both halves
  AGENTS.md requires — the consequence (_no mail is delivered through it_) and the
  fix (the SMTP settings above), not a bare "unknown provider". It is checked
  _before_ the API-key check, because "set an API key" is the wrong instruction for
  a provider that has nothing to hand a key to. "Send test email" refuses the same
  way and sends nothing. Switching the provider to `smtp` and saving recovers the
  transport without a restart.

  Two smaller corrections in the same field:

  - `api_key` is now shown and required for exactly `resend` and `postmark`
    (`provider === 'resend' || provider === 'postmark'`). It was `provider !==
'smtp'`, which only worked because every non-SMTP option happened to be an
    HTTP API; `required` is enforced server-side wherever the field is visible, so
    that expression would have refused to save "None (log only)" until an API key
    it never reads had been typed in.
  - The built-in `mail/test` fallback (the one that runs when no email plugin is
    mounted) rejects any `provider` outside the manifest's own option list instead
    of answering "the form is well-formed".

  **Held by a test, in both directions.** `EMAIL_TRANSPORT_PROVIDERS` is now a
  runtime array (the `EmailTransportProvider` union is derived from it), and
  `plugin-email`'s `mail-manifest-providers.contract.test.ts` asserts set equality
  between it and the manifest's option values, then builds a real transport for
  each. Adding an option without a transport fails; adding a transport without an
  option fails. `RETIRED_EMAIL_PROVIDERS` / `isEmailTransportProvider` /
  `unsupportedProviderFix` are exported alongside it for hosts that surface the
  same guidance.

- 9c90ea0: feat(sms): 短信全局日发送配额 —— 成本总量闸 (#2814)

  #2780 给 OTP 端点落了**按号码**的防滥用（60s 冷却 + 每号码 5 条/小时）。那挡住的是「一个号码花多少钱」，挡不住「这套部署一天花多少钱」：攻击者轮换上万个不同号码时，每个号码都稳稳待在自己的预算里，而日累计账单没有任何上限——这正是 SMS pumping / toll fraud 的典型打法。更要紧的是，按号码那道闸住在 better-auth 的 `hooks.before` 里，只看得见 auth 端点：`notify(channels:['sms'])` 与邀请短信从旁边直接走过去，一条都不计数。

  本次新增一道**总量**闸，扣减点放在所有出站短信本来就必经的那一处 —— `SmsService.send()`。OTP、邀请、messaging `sms` channel 三条路无论从哪扇门进来，都记在同一本账上。

  ## 新增设置项

  `sms` 命名空间新增 `daily_quota`（Daily send limit，number，默认 `0` = 不限）：这套部署每个 **UTC 自然日**允许发出的短信总条数。超出后拒发，直到 00:00 UTC。env 覆盖沿用既有的每键机制，无需额外接线：`OS_SMS_DAILY_QUOTA=2500`。

  `0` 是出厂姿态，所以升级本身不改变任何现有部署的发送行为——闸门要由运营者显式配置才会闭合。

  ## Observable behaviour change

  **配置配额后，发送可能被拒**，两条路径的表现分别是：

  - OTP / 邀请路径 —— `SendSmsResult.status='failed'`，`error` 为 `TOO_MANY_REQUESTS: daily SMS quota exhausted`。刻意与按号码闸抛出的 `TOO_MANY_REQUESTS` 用同一个码，且**不带任何剩余额度细节**：从外面看，两道墙必须长得一样，攻击者不该能试探出自己撞的是哪一道。
    ⚠️ 但这个码**目前到不了 HTTP 调用方**：`AuthManager.deliverPhoneOtp` 把它重抛成普通 `Error`，而 better-call 对非 `APIError` 一律回 500（实测，见 #6039）。也就是说 OTP 端点上，按号码闸回 429、总量闸回 500。补齐要动 plugin-auth，已单独立案。
  - messaging `sms` channel —— `SendResult.ok=false`，且 `classifyError` 返回 `'rate_limited'`（此前一律 `'retryable'`）。投递落进 outbox 走退避重试 / 死信，不会被静默丢弃；`rate_limited` 与 `retryable` 走同一条重试阶梯，但把「额度用尽」与「网关抖动」在投递记录上区分开。

  ## 计数落在哪里

  复用仓内唯一那份定窗计数（`incrementFixedWindow`）与它的惰性存储解析（`createLazyCounterStore`，#4772/#4790），不写第三份：

  - 有 kernel `cache` 服务时计在共享 cache（集群共享与否取决于 cache 本身）；
  - 解析不到时降级为有界的进程内计数，并由解析器**点名**打一条 warn，说明降级的代价（N 节点部署最多可花 N× 配额）；
  - 解析在**计数被消费时**发生，而非插件 init —— 后注册的 cache 也能在下一次发送时被接上（#4772 的坑）。

  窗口是 UTC 自然日，且由两个机制同时保证：计数键带 UTC 日期（`sms-daily-sends:2026-08-06`），窗口开启时的 TTL 恰为距下一个 UTC 午夜的秒数。任一机制单独也能翻窗，合起来则不可能互相矛盾。

  ## 两条刻意的姿态

  - **fail-open**：计数存储读不到时，闸门**放行**并打一次 warn。短信成本闸不能把登录拖下水（#2814 诉求 4）。
  - **配额值的钳制在消费侧**：manifest 上的 `min: 0` 今天并不被 `validatePatch` 执行（#5932），所以负值 / `NaN` / `Infinity` / 非数字都会原样抵达读取方。这些一律降级为 `0`（不限）并**点名**打 warn，而不是拒发、也不是替运营者编一个别的默认值——一个设置表单里的手误不该变成手机登录的全站故障，而编一个没人声明过的上限只会把手误藏进看似合理的行为里。

  ## 不在本次范围

  诉求中的**每租户日配额**（`daily_quota_per_tenant`）未实现：`SendSmsInput`（`@objectstack/spec/contracts`）不携带任何租户标识，而在 service 侧另造一个只此一家的拼法就是 Prime Directive #12 明令禁止的影子契约。租户维度要么落在 spec 契约上，要么不落——详见 #2814 上的讨论。

### Patch Changes

- 4022b78: Settings: an `OS_*` env override is now checked against the specifier's declared `options` table (#5204)

  A manifest's `options` table has been enforced on the write path since #5131, but
  `SettingsService.get()` produced an effective value by a second route that never
  consulted it: an `OS_*` override was reshaped by the default's type and returned
  straight from the top of the cascade with `locked: true`. So the providers #5094 and
  #5133 retired from `mail.provider` could walk back in through the one door with no
  gate on it — `OS_MAIL_PROVIDER=sendgrid` reached the mail plugin unchallenged — and a
  plain typo such as `OS_BRANDING_THEME_MODE=drak` was served to every consumer as a
  normal value with normal-looking provenance, each consumer left to improvise.

  An override whose value the table does not declare is now **ignored** rather than
  repaired: the value falls through to the next layer of the cascade (a stored
  global/tenant/user value, else the manifest default), and the read API reports that
  layer honestly instead of claiming `source: 'env'` for a value not in force. The
  rejection is logged once at `error`, naming the variable, the rejected value, the legal
  value set and the consequence. The same audit runs at `registerManifest`, so a
  misconfigured deployment learns at boot rather than whenever somebody first opens the
  settings page.

  Registration **reports but never refuses**: option tables move, a pin that was legal
  the day it was written must not turn an upgrade into a crash-on-start.

  Two behaviour notes for anyone relying on the old shape:

  - Keys with no declared option table are untouched — text, boolean, number and
    password overrides behave exactly as before. The check applies only to
    `select`/`radio`/`multiselect` specifiers that declare a non-empty table.
  - A **rejected** override no longer pins its key against writes. `setMany` used to
    refuse on the mere presence of the variable; judged by presence, an ignored value
    would have left the key configurable by nothing at all — env value discarded, UI
    refused with `SETTINGS_LOCKED`, and `get()` reporting `locked: false` to a settings
    page whose save would then fail. An override that _is_ in force still locks the key,
    unchanged.

- 82a06af: fix(service-settings): a settings `select` now rejects values outside its declared `options` (#5131)

  `SettingsService.validatePatch` enforced two of the constraints a settings
  manifest declares — `required` and `pattern` — and skipped the third. A
  specifier's `options` table never took part in save-time validation, so any
  string at all could be written into a dropdown field:

  ```ts
  await svc.setMany("mail", { provider: "sendgrid", from_email: "a@b.com" }); // stored
  ```

  Going through the console this was unreachable: the dropdown only ever emits a
  value from the table. But `PUT /api/settings/:ns` is an authorizable public
  surface, and scripts, migration tools and AI-authored bootstrap code write it
  directly — where the bad value was accepted, persisted and read back **in
  silence**, leaving every consumer to improvise its own answer for an
  enumeration member that does not exist. It was not `mail`-specific:
  `storage.adapter`, `sms.provider`, `ai.provider`, `localization.date_format` and
  every other `select` behaved the same way.

  This is the API-side gate that #5094 was missing. That change retired
  `sendgrid` / `ses` from the `mail` provider table because this server cannot
  deliver through them — with no write-side enforcement, the values it had just
  retired could be written straight back in the same afternoon.

  **Now:** a `select` / `radio` / `multiselect` value that is not a member of the
  declared table is rejected with a `FieldError` whose `code` is `invalid_option`
  and whose `constraint` carries the allowed set (`{ allowed: 'smtp, resend,
postmark, log' }`), so a client composes its own message instead of parsing
  ours. The enforced set is the spec's own: `SpecifierSchema` already _requires_ a
  non-empty `options` on exactly those three types, so declared and enforced name
  one list rather than two that can drift.

  Two deliberate limits keep this from breaking workspaces that already carry
  drift:

  - **The check is gated on TOUCH**, like `required` and `pattern` before it. A
    value that pre-dates the current option table only fails the patch that
    writes that key — editing `from_name` is not rejected because a stale
    `provider` sits in the store. The opposite rule would lock every workspace
    with historical drift out of its own settings page entirely, which is worse
    than the gap being closed. Resets (all-null patches) are never blocked.
  - **A specifier that declares no option table is left alone.** It cannot say
    what is legal, so it stays lenient rather than rejecting every write.

  Values are compared in string form, so an option declared `value: 30` still
  matches after a round trip through JSON or a form post. There is no opt-out: a
  manifest that needs to accept custom values would declare that explicitly in
  the spec, not rely on a tolerant consumer.

- 41c3b48: feat(plugin-email): real SMTP delivery — `SmtpTransport`, settings hot-swap, and a `mail/test` that actually sends (#5087)

  The **Mail Delivery** settings page has always defaulted to SMTP and offered a
  full host / port / TLS / username / password form. Nothing behind it delivered:
  `applyMailSettings` treated `provider: 'smtp'` as a no-op ("transport
  unchanged"), `mail/test` answered `ok: true, "Configuration looks valid … Wire
@objectstack/plugin-mail for actual delivery"` — a success toast for a message
  nobody sent, naming a package that has never existed — and the code pointed
  operators at `@objectstack/plugin-mail-smtp`, which is not in this repo or on
  npm. A workspace that selected SMTP got a green form, a green test button, and
  mail that only ever reached the log and the `sys_email` table. For deployments
  in China this left **no** working channel at all: Resend and Postmark are
  overseas HTTPS SaaS with unreliable reach and deliverability to QQ / 163 /
  enterprise mailboxes, where SMTP is the normal path (Aliyun DirectMail, Tencent
  SES, corporate mail servers).

  **`SmtpTransport` now ships in `@objectstack/plugin-email`** (ADR-0012: SMTP in
  core, implemented with `nodemailer`). `nodemailer` is a real dependency but is
  imported **lazily on the first send**, so deployments that never select SMTP —
  and non-Node runtimes — never load `node:net` / `node:tls`.

  Three doors reach it, all sharing one options reader so they cannot drift:

  - **Settings → Mail** (`smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` /
    `smtp_password`) hot-swaps the live transport on save, no restart.
  - **`os serve`** via `OS_EMAIL_PROVIDER=smtp` plus the new `OS_EMAIL_SMTP_HOST` /
    `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` (or `config.email.options`).
  - **Constructor**: `new EmailServicePlugin({ provider: 'smtp', providerOptions:
{ host, port, secure, user, password } })`.

  TLS is one toggle with the wire behaviour derived from the port, as providers
  document it: on `465` implicit TLS (SMTPS); on any other port a **required**
  STARTTLS upgrade, so a server that refuses to upgrade fails the send instead of
  leaking credentials over a cleartext socket; `secure: false` connects in the
  clear and upgrades only when STARTTLS is offered.

  **Failure is loud everywhere, because a silent fallback is the bug this fixes.**
  On the construction path (CLI / plugin options) a `smtp` provider with no host
  **throws** and the boot fails — it no longer degrades into a LogTransport that
  reports every send as successful. On the settings hot-swap path a save can never
  kill a running server, so the previous transport is kept — but the failure is
  logged at `error` naming the consequence and the fix, and **`mail/test` now
  performs a real delivery** through the settings on screen and reports the SMTP
  server's own words (`535 … authentication failed`) instead of a green toast. The
  built-in fallback `mail/test` handler (used only when no email plugin is
  mounted) answers `ok: false` and says plainly that nothing was sent.

  Nothing to migrate: `log`, `resend` and `postmark` behave exactly as before, and
  a deployment that never selects `smtp` is unaffected.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [f104bab]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- f1f40b4: refactor!: settings error bodies stop hanging undeclared keys beside `code`/`message` (#4224)

  Four `/api/settings/*` error branches spread ad-hoc context as SIBLINGS of `code`
  and `message` inside `error`. `ApiErrorSchema` declares `code`, `message`,
  `category?`, `httpStatus?`, `details?`, `requestId?` — and none of `namespace`,
  `key`, `reason`, `fields`. The bodies passed every gate anyway: `ApiErrorSchema`
  is a plain `z.object`, so unknown keys were **stripped** rather than rejected,
  and `envelopeViolations` inspects only the body's top level. They were conformant
  _by stripping_, not by declaration. The same module already used the declared
  slot correctly one branch over (`SETTINGS_ACTION_FAILED` → `error.details`), so
  this is one file speaking two dialects, not a missing capability.

  **Wire change — FROM → TO.** In every case the values are unchanged; only their
  position moves, into the `details` slot the contract declares:

  | Code                  | HTTP | FROM                                           | TO                                                                     |
  | --------------------- | ---- | ---------------------------------------------- | ---------------------------------------------------------------------- |
  | `SETTINGS_FORBIDDEN`  | 403  | `error.namespace`                              | `error.details.namespace`                                              |
  | `UNKNOWN_KEY`         | 400  | `error.namespace`, `error.key`                 | `error.details.namespace`, `error.details.key`                         |
  | `SETTINGS_LOCKED`     | 409  | `error.namespace`, `error.key`, `error.reason` | `error.details.namespace`, `error.details.key`, `error.details.reason` |
  | `SETTINGS_VALIDATION` | 400  | `error.namespace`, `error.fields`              | `error.details.namespace`, `error.details.fields`                      |

  **One-line fix for a consumer:** read `error.details.<key>` where you read
  `error.<key>`, or `error.details?.<key> ?? error.<key>` if you support servers on
  both sides of the change. The console's own fix (objectui#3078) is the tolerant
  form.

  **`SETTINGS_VALIDATION.fields` also changes shape**, because `fields` is the name
  ADR-0114 (#3977) closed for `FieldError[]` and keeping a map under it would leave
  one spelling meaning two shapes:

  - **FROM** `{ [key]: message }` — a `Record<string, string>`, the constraint named
    only in the prose of the message.
  - **TO** `FieldError[]` — `{ field, code, message, label, constraint? }`, where
    `code` is a member of the closed field-level catalog: `required` for an empty
    required specifier, `invalid_format` for a value that misses its declared
    `pattern` (which travels as `constraint.pattern`).

  A consumer that rendered the map's values reads `f.message` per entry instead;
  one that wants to branch on _why_ a value was rejected can now read `f.code`
  rather than substring-matching English. objectui's `extractFieldErrors` already
  reads `details.fields`, so settings validation failures become renderable
  per-field there with no further change.

  **The exported `SettingsValidationError.fields` changes with it** — same
  `Record<string, string>` → `FieldError[]` mapping — since the route only relays
  what the service throws, and the constraint kind is knowable at the throw site
  and nowhere after it.

  `sendError`'s last parameter is tightened from `extra?: Record<string, unknown>`
  to `ApiError`'s own optional fields, and its `code` from `string` to the closed
  ADR-0112 `ErrorCode` union. That is what keeps this fixed: an undeclared sibling
  is now a compile error at the call site rather than a key that quietly evaporates
  at the schema boundary.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- 0931185: fix(rest,service-settings,service-datasource)!: four more route modules emit the declared envelope, and the guard is now shared (#3843)

  #3675 and #3689 moved `service-storage` and `service-i18n` onto the declared
  response envelope (`BaseResponseSchema` + `ApiErrorSchema`). Each scoped itself
  to one service, and neither asked whether the same drift existed elsewhere. It
  did — in four more modules, and in two of them it was the _older_ shape, the one
  #3675 had already declared wrong:

  | Module                                | before                                                         | now           |
  | ------------------------------------- | -------------------------------------------------------------- | ------------- |
  | `service-settings/settings-routes.ts` | nested `error`, no `success` on any of 5 bodies                | full envelope |
  | `service-datasource/admin-routes.ts`  | `{ error: '<string>' }`, `message` a **sibling**               | full envelope |
  | `rest/external-datasource-routes.ts`  | `{ error: '<string>' }` + a private `ok`                       | full envelope |
  | `rest/package-routes.ts`              | 3 of 16 bodies had `success`, 2 failures had no `error` at all | full envelope |

  ## Breaking: where to read things now

  **Success payloads move under `data`.** The keys are unchanged — only their
  depth. `unwrapResponse` in `ObjectStackClient` returns `body.data` when the flag
  is present, so every SDK method (`packages.list()`, `datasources.external.*`)
  resolves to exactly the object it always did. Raw `fetch` callers must add one
  hop:

  ```
  GET  /api/v1/datasources            body.datasources     → body.data.datasources
  GET  /api/v1/datasources/drivers    body.drivers         → body.data.drivers
  GET  /api/v1/datasources/:name      body.datasource      → body.data.datasource
  GET  /api/v1/packages               body.packages        → body.data.packages
  GET  /api/v1/packages/:id           body.package         → body.data.package
  GET  /api/settings                  body.manifests       → body.data.manifests
  GET  /api/settings/:ns              body.manifest/.values → body.data.manifest/.values
  POST /…/external/validate           body.ok, body.results → body.data.ok, body.data.results
  ```

  `SettingsNamespacePayloadSchema` and friends still describe those payloads
  exactly; they now describe the envelope's `data` rather than the whole body.

  **Error bodies stop being a string.** `{ error: 'datasource_admin_error',
message }` → `{ success: false, error: { code: 'datasource_admin_error',
message } }`. Read `body.error.message`, not `body.message`; read
  `body.error.code`, not `body.error`. This is the asymmetry #3675 opened on: a
  caller reading `body.error.message` previously got the real message from the
  dispatcher and `undefined` from these routes.

  **Two failures that never said why now do.** `DELETE /api/v1/packages/:id`
  answered a bare `{ success: false }` and a bare
  `{ success: false, failed, cleanups }`. They are now `PACKAGE_DELETE_FAILED` and
  `PACKAGE_DELETE_PARTIAL`, with the per-item `failed` / `cleanups` arrays under
  `error.details`.

  **Codes follow ADR-0112.** #3841 settled the vocabulary while this was in review:
  `error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is now the closed
  `ErrorCode` union, so an unregistered code fails schema parse. Generic conditions
  reuse the STANDARD catalog rather than becoming registered synonyms of it, per the
  ledger's own guidance:

  ```
  datasource_admin_unavailable  → SERVICE_UNAVAILABLE      (standard)
  external_service_unavailable  → SERVICE_UNAVAILABLE      (standard)
  not_found / PACKAGE_NOT_FOUND → RESOURCE_NOT_FOUND       (standard)
  PUBLISH_FIELDS_MISSING        → MISSING_REQUIRED_FIELD   (standard)
  INTERNAL                      → INTERNAL_ERROR           (standard)
  datasource_admin_error        → DATASOURCE_ADMIN_ERROR   (registered)
  external_import_error         → EXTERNAL_IMPORT_ERROR    (registered)
  PUBLISH_MANIFEST_INVALID      → PACKAGE_MANIFEST_INVALID (registered)
  PUBLISH_FAILED                → PACKAGE_PUBLISH_FAILED   (registered)
  PACKAGE_DELETE_PARTIAL / PACKAGE_DELETE_FAILED / SETTINGS_ACTION_FAILED (registered)
  ```

  Which service is unavailable is carried by `message`. The seven registered codes are
  added to `ERROR_CODE_LEDGER` under their owning packages — including a new
  `@objectstack/service-datasource` entry.

  **`POST /external/validate` keeps its `ok`.** Unlike the `{ ok: true, key }`
  #3689 retired from storage — a private second word for `success` — this `ok` is a
  computed verdict over the federated objects (`results.every(r => r.ok)`). The
  request can succeed while the verdict is false, so the two flags are not the same
  field; `ok` moves inside `data` rather than being dropped.

  Consumers were taught both shapes first, so the two repos are not coupled by
  merge order: objectui's `packages` readers were already tolerant
  (`payload?.data ?? payload`), and its datasource page plus the generic
  `type: 'api'` action runner now unwrap the envelope and read `error.message`
  (the latter previously toasted `[object Object]` for any nested error).

  ## The guard is shared now, not copied

  `scripts/check-route-envelope.mjs` + `pnpm check:route-envelope`, wired into
  `lint.yml` alongside the nine sibling `check:*` guards. Its load-bearing assertion
  is structural rather than per-route: **it counts the response write sites per
  module.** When every body goes through the `sendOk` / `sendError` pair that count
  is fixed at two and does not grow with the route list — so a _future_ route that
  hand-rolls a body fails the guard. That is the coverage a driven-body test can
  never give, since it can only drive the routes that existed the day it was
  written.

  This existed three times already as an open-coded regex block (storage error,
  storage success, i18n error). Lifting it did more than deduplicate: a per-package
  scan **structurally cannot notice a module nobody thought to convert**, and going
  repo-wide found two the moment it ran — neither is in #3843's hand-written survey:

  - `plugin-sharing/share-link-routes.ts` — the fifth drifting module. No body
    carries `success`, and one answers `{ ok: true }`, the private second word #3689
    retired from storage. Filed as #3983 and pinned by the guard; converting it is
    breaking for share-link consumers and needs its own sweep.
  - `metadata/routes/hmr-routes.ts` — declared **exempt** with a reason (dev-only
    SSE endpoint, not on the SDK surface), not skipped. Three states, deliberately —
    conformant / ratcheted / exempt — because that is the honest classification
    ADR-0049 asks for. A route module the scan finds but the table does not declare
    is an **error**, never a default: applying `2 / 1 / 1` to an unknown module would
    let a new one pass by coincidence.

  It also drops the regex for the TypeScript AST, fixing two real bugs the copies
  had. They stripped comments with `String.replace`, whose line-comment pattern also
  ate `//` inside string literals and truncated the rest of that line — response
  writes included. And `.json(` does not mean "write a response": `hmr-routes.ts`
  calls `c.req.json()` twice to READ a request body, which a textual count reports as
  two unenveloped responses. Comments and literals are not AST tokens, and
  request-vs-response is a property of the callee, so both disappear. The script
  carries a `--self-test` pinning each case — the nine sibling guards have none, but
  both of these bugs survived a review of the regex version.

  **The i18n ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is
  declared at `responses: 5, ok: 4, err: 1` with a ratchet pointing at #3973. Its
  error half _is_ consolidated (#3675), but each of its four read routes builds
  `{ success: true, data }` inline. Those bodies are correct — that is not envelope
  drift — but an unconsolidated builder is a weaker guard: a fifth read route could
  get the shape wrong and only a driven test would notice. The numbers pin today's
  structure exactly (a new inline body fails) and drop to the conformant `2 / 1 / 1`
  when #3973 lands.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- 64f8cbe: feat(platform-objects,service-settings,verify): `sys_secret` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the settings service (#4270)

  The environment's encrypted-secret store (`sys_secret`, ADR-0066 D2/④) was
  registered by `@objectstack/service-settings`, but it has three producer
  classes and only one of them is settings: the settings service's encrypted
  specifiers, the ObjectQL engine's own `secret`-field encryption
  (`encryptSecretFields`/`resolveSecret` — the generic write path of ANY
  business object carrying a `Field.secret()`), and the datasource credential
  binder. Unlike the `sys_migration` precedent (#4243), the failure posture is
  fail-CLOSED: on a kernel composed without settings, every insert/update of an
  object with a secret field threw — with an error message that told the
  operator to "Ensure the platform-objects (sys_secret) are registered", naming
  a package that did not register it.

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the store exists with the
  platform, independent of which optional services are composed, and the
  engine's fail-closed error message is true. Definition ownership is unchanged
  (`sys_secret` stays in `@objectstack/platform-objects` and in
  `PLATFORM_OBJECTS_BY_PACKAGE`); the settings service remains a producer and
  consumer through its `sys_secret`-backed secret store.

  Consequences:

  - `@objectstack/service-settings` no longer contributes `sys_secret` to the
    manifest (`settingsObjects` is now `[SysSetting, SysSettingAudit]`). An
    embedder composing `SettingsServicePlugin` on a hand-built kernel that
    relied on it for the `sys_secret` table must compose
    `PlatformObjectsPlugin` (the plugin every supported assembly path already
    includes). The move REPLACES the registration — nothing registers the
    object twice.
  - `@objectstack/verify`'s boot harness now composes `PlatformObjectsPlugin`,
    mirroring `os serve`'s auto-inject — which also means harness kernels now
    carry the `sys_migration` ledger + fresh-datastore attestation (#4243) the
    served assembly always had.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- a629074: fix(auth): the second factor now obeys the operator's lockout policy instead of better-auth's defaults (#3690)

  `auth-manager.ts` constructed `twoFactor()` with a schema and nothing else, so
  better-auth's built-in `accountLockout` defaults — on, 10 attempts, 15 minutes —
  governed two-factor verification no matter what the admin configured. An operator
  who tightened **Setup → Authentication → Account lockout threshold** to 3 got a
  password stage that locked at 3 and a second factor that still locked at 10: the
  stricter door was the looser one, with nothing in the UI saying so.

  `lockout_threshold` / `lockout_duration_minutes` are now projected onto
  better-auth's own `accountLockout` shape (`enabled` / `maxFailedAttempts` /
  `durationSeconds`, minutes converted to seconds) rather than growing a parallel
  `two_factor_lockout_*` pair — one policy, one mental model, and a future upstream
  field arrives as a new option instead of a conflict. The projection goes through
  `applyConfigPatch`, which resets the cached better-auth instance, so a settings
  change takes effect without a restart.

  Threshold `0` is deliberately **not** forwarded as `enabled: false`. It is the
  password stage's "off", and a deployment may leave that stage unlocked because
  rate limiting or an IdP covers it; the second factor is the last check before a
  session is issued, so it keeps better-auth's default rather than being switched
  off by a setting that never mentioned it.

  The threshold field is also no longer hidden behind `email_password_enabled` —
  two-factor verification exists in passwordless deployments, where the setting was
  previously unreachable.

  The admin **Unlock Account** action now clears both stages. It only ever reset
  `sys_user`, so a user locked at the second factor had no admin escape hatch and
  had to wait the duration out — survivable while that lock needed 10 failures,
  routine once an operator can set the threshold to 3. The second-factor clear is
  best-effort and runs after the primary write, so an account with no enrolment
  still unlocks normally.

  Note the plugin caps attempts at 5 per challenge (`beginAttempt(5)`), which no
  option reaches; a threshold above 5 forces a fresh challenge rather than raising
  that cap.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [67452d1]
- Updated dependencies [4921a95]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Minor Changes

- c044f08: **Security fix (Critical): the settings HTTP routes no longer trust spoofable identity headers, and writes are now capability-gated.**

  Previously `GET/PUT/POST /api/settings/*` derived the caller's identity from `x-user-id` / `x-tenant-id` / `x-permissions` request headers (the route default), and `setMany` performed **no permission check** — so on a standard `os serve --server` deployment (settings + HTTP server composed by default, routes registered on the raw app with no auth middleware) an **unauthenticated** remote client could write tenant- or platform-scoped settings (including the auth security-policy, localization, and company manifests) and enumerate every namespace.

  Fixes:

  - **Verified identity.** `SettingsServicePlugin` now derives the caller's identity and capabilities from the platform's verified resolution (`resolveAuthzContext` — session cookie / API key / OAuth), never from request headers. The route default is now SECURE: it trusts no identity header and yields an anonymous, denied context.
  - **Capability gates.** Manifest `readPermission` / `writePermission` are enforced for HTTP callers: reads of a protected namespace, writes, and actions require the declared capability (writes default to at least the read capability, never ungated). Enforced via a new `enforced` flag set only at the HTTP boundary — **in-process/boot callers (`kernel.getService('settings')`, seed) are unchanged** and keep full trusted access.
  - Unauthenticated HTTP callers can no longer enumerate protected manifests or write; a `403 SETTINGS_FORBIDDEN` is returned when the capability is missing.

  **`setup.write` capability now real.** Enforcing the manifests' declared `writePermission` surfaced a modeling gap: `setup.write` (the write counterpart to `setup.access`, used by the branding / company / localization / feature-flag manifests) was referenced but never declared or granted — so under enforcement _nobody_, not even an admin, could write those namespaces. It is now a declared platform capability (`PLATFORM_CAPABILITIES`) held by `admin_full_access` and `organization_admin`, alongside `setup.access`.

  **Behaviour change:** a deployment that relied on the old header-trusted default must present a real verified session/API-key/OAuth credential (which the console already does). A custom integration may still inject its own `contextFromRequest`.

  Found by an adversarial security review of the request→ExecutionContext trust boundary.

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Minor Changes

- c1064f1: feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

  #2766 shipped phone+password sign-in but no OTP — the platform had no SMS
  delivery capability. This adds the missing infrastructure end to end:

  - **New `@objectstack/plugin-sms`** — `ISmsService`/`ISmsTransport` contracts
    (spec) with Aliyun SMS (ACS3-HMAC-SHA256, template-based) and Twilio
    transports plus a dev log fallback. Configured through the new `sms`
    settings namespace (live provider rebind, encrypted secrets, send-test
    action; `OS_SMS_*` env keys win at the resolver). Deliberately NO message
    persistence and NO body logging — SMS bodies carry OTP codes.
  - **Messaging `sms` channel** — registered at kernel:ready when an `sms`
    service is present; `notify(channels:['sms'])` resolves
    `sys_user.phone_number`, renders `(topic,'sms',locale)` templates, and
    inherits outbox retry/dead-letter.
  - **Phone OTP flows open** — the phoneNumber plugin's `sendOTP` /
    `sendPasswordResetOTP` now deliver via SMS, enabling
    `/phone-number/send-otp` + `/verify` (OTP sign-in/verification) and
    `/phone-number/request-password-reset` + `/reset-password` (self-service
    reset). Without a deliverable SMS service they keep failing loudly
    (NOT_SUPPORTED); `features.phoneNumberOtp` advertises real availability.
    Shipped with the abuse hardening: explicit `allowedAttempts: 3`, always-on
    per-number cooldown (60s) + rolling-hour cap (5, secondaryStorage-shared
    across nodes), `/phone-number/*` in the settings-bound per-IP rate-limit
    rules, and OTP codes never reach logs or error messages.
  - **Import SMS invites** — `/admin/import-users`'s `invite` policy now
    supports phone-only rows: a credential-free invitation SMS points the
    employee at phone-OTP first sign-in followed by self-set password; mixed
    files validate the reachable channel per row.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Minor Changes

- c4fd39f: Localization: drop the hard-coded `USD` platform default for the workspace **Default currency** setting.

  Previously the `localization.currency` setting defaulted to `'USD'`, and that value was applied to any `currency`-typed field that omits its own code — so every code-less amount surfaced a `$`/`US$` symbol even when nothing (field, measure, or workspace) actually named a currency. The setting now has **no platform default**: a code-less currency amount renders as a plain number unless the workspace explicitly picks a default currency (or the field declares its own).

  Migration: a workspace that relied on the implicit USD default and wants to keep showing `$` should set **Settings → Localization → Default currency** to `USD` explicitly. Fields/measures that declare their own currency code are unaffected.

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/platform-objects@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/platform-objects@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/platform-objects@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/platform-objects@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- ce0b4f6: Auth: password expiry — the session-validation gate (ADR-0069 D1, P1)

  Builds the **authentication-policy session gate** ADR-0069 needs and uses it for password expiry. When `password_expiry_days` (new `auth` setting, 0 = off) is exceeded, an authenticated user is blocked from protected REST resources with `403 PASSWORD_EXPIRED` until they change their password — while auth + remediation paths stay reachable.

  - **core**: new pure `evaluateAuthGate` / `isAuthGateAllowlisted` helper (`@objectstack/core/security`) — single source of truth for the allow-list (auth endpoints, change-password, health, UI-bootstrap reads).
  - **plugin-auth**: `customSession` computes the gate posture once and attaches `user.authGate`; `computeAuthGate` reads `sys_user.password_changed_at` vs the configured window; `password_changed_at` is stamped on sign-up / change / reset; `isAuthGateActive()` keeps the gate **zero-overhead** when off.
  - **platform-objects**: new `sys_user.password_changed_at` column.
  - **rest**: `resolveExecCtx` carries `authGate`; `enforceAuth` blocks gated sessions (independent of `requireAuth`) using the core allow-list.
  - **service-settings**: new `password_expiry_days` field.

  Default-off / additive (no upgrade behavior change); a null `password_changed_at` never expires (existing users). Per ADR-0049 the setting ships with its enforcement; timestamps written as `Date` (ADR-0074).

  This gate is the shared seam for **enforced MFA** (ADR-0069 D3), which lands next as a small addition (a second `authGate` branch). The dispatcher/MCP path is a follow-up (tracked in #2375); the REST surface the Console uses is fully gated here.

- 90bce88: Auth: enforced MFA (ADR-0069 D3, P1)

  Completes the session-validation gate: when `mfa_required` (new `auth` setting) is on, an authenticated user without TOTP enrolled is blocked from protected resources with `403 MFA_REQUIRED` once their `mfa_grace_period_days` (default 7) window elapses — while the two-factor enrollment endpoints stay reachable so they can comply. Reuses the `authGate` seam shipped in #2388 (a second posture branch in `computeAuthGate`).

  - New `auth` settings `mfa_required` (toggle) + `mfa_grace_period_days`; enabling `mfa_required` also force-enables the `twoFactor` plugin so `/two-factor/*` enrollment exists.
  - New `sys_user.mfa_required_at` column — the grace clock, stamped lazily the first time a user is seen required-but-unenrolled.
  - `isAuthGateActive()` now also trips on `mfa_required` (still zero-overhead when off).

  Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

  **Needs an objectui follow-up**: the Console should handle a `403 MFA_REQUIRED` by showing the TOTP-enrollment prompt. Per-org `sys_organization.require_mfa` and the dispatcher/MCP gate remain follow-ups (#2375).

- 3209ec6: Auth: session controls — idle timeout, absolute max lifetime, concurrent cap (ADR-0069 D4, P2)

  Adds three `auth` session-control settings (all 0 = off):

  - `session_idle_timeout_minutes` — sign a user out after inactivity. Enforced in `customSession`: touches `sys_session.last_activity_at` (throttled to once a minute) and, once the idle window is exceeded, revokes the session.
  - `session_absolute_max_hours` — cap total session lifetime regardless of refresh; revoked once `created_at` is older than the cap.
  - `max_concurrent_sessions_per_user` — on sign-in, keep the newest N live sessions and revoke the rest (oldest first).

  Revocation expires the session in place (`expires_at` set to the past + `revoked_at` / `revoke_reason` stamped on new `sys_session` columns), so better-auth returns no session on the next request → the Console's existing 401 → login redirect handles it (no client change). Note: better-auth garbage-collects expired sessions, so the `revoke_reason` audit row is best-effort; the enforcement (session killed) is not.

  Default-off / additive (no upgrade behavior change); per ADR-0049 each setting ships with its enforcement.

- 8c84c97: Auth: IP allow-list — network gating on the auth routes (ADR-0069 D5, P2)

  Adds an `allowed_ip_ranges` auth setting (CIDR ranges or exact IPs; empty = no restriction). A Hono middleware registered ahead of the better-auth handler in the auth-route registration rejects auth requests from a client IP outside the ranges with `403 IP_NOT_ALLOWED`, before they reach better-auth.

  - Client IP is read trust-proxy-aware from `x-forwarded-for` (first hop) / `cf-connecting-ip` / `x-real-ip`.
  - The public render helpers (`/config`, `/bootstrap-status`) are exempt so a blocked client still gets a clean login page + a clear error.
  - **Fails OPEN** when the client IP can't be determined (no proxy header), so a misconfigured proxy is a no-op rather than a lockout — an admin enabling this must ensure forwarded headers are trusted.
  - IPv4 CIDR (`a.b.c.d/n`) + exact IPv4/IPv6 matching.

  Default-off / additive; per ADR-0049 the setting ships with its enforcement.

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Minor Changes

- 21b3208: Auth: password complexity policy (ADR-0069 D1, P1)

  Adds `password_require_complexity` (toggle, default off) + `password_min_classes` (1–4, default 3) to the `auth` password-policy settings. A custom validator runs in the better-auth `before` hook on `/sign-up/email`, `/reset-password`, and `/change-password`, rejecting passwords that use fewer than `password_min_classes` of the four character classes (upper / lower / digit / symbol) with `PASSWORD_POLICY_VIOLATION` — better-auth natively enforces only min/max length.

  Default-off and additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement. No new identity fields. Continues the ADR-0069 P1 password-policy work alongside the HIBP breached-password reject (#2361).

- 9b5bf3d: Auth: password history / no-reuse (ADR-0069 D1, P1)

  Adds `password_history_count` (0–24, 0 = off) to the `auth` password-policy settings. On `/change-password` and `/reset-password`, a new password that matches the current password or any of the last N hashes is rejected with `PASSWORD_REUSE`. A new bounded `sys_account.previous_password_hashes` column (JSON ring, system-managed, hidden) backs the check; it is maintained by before/after hooks (capture the old hash, append on success).

  Reuses better-auth's native `password.verify` (no bespoke crypto) and resolves the reset-flow user via the same token lookup better-auth uses. Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

- cb5b393: Auth: account lockout + rate-limit tuning (ADR-0069 D2, P1)

  Second slice of ADR-0069 — per-identity brute-force protection, reusing the setting→enforcement pattern from the HIBP PR.

  - **Account lockout** `[custom][field]`: new `sys_user.failed_login_count` / `sys_user.locked_until` columns; `auth` settings `lockout_threshold` (0 = off) + `lockout_duration_minutes`. Enforced in the `/sign-in/email` before/after hooks — failures increment the counter, crossing the threshold stamps `locked_until`, and a locked account is rejected **even with the correct password** (survives IP rotation, unlike rate limiting). A successful sign-in resets both.
  - **Admin Unlock**: new admin-guarded `POST /api/v1/auth/admin/unlock-user` route + an `unlock_user` action on `sys_user`.
  - **Rate-limit tuning** `[native]`: `auth` settings `rate_limit_max` / `rate_limit_window_seconds` wire better-auth's core `rateLimit` with stricter `customRules` for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.

  All settings default off / to safe values; additive (no upgrade behavior change). Per ADR-0049 each setting ships with its enforcement. Timestamps are written as `Date` (never epoch-ms) per ADR-0074.

- ab5718a: Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

  First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

  - **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
  - **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
  - **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
  - **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

  Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).

### Patch Changes

- a619a3a: fix(setup): first-run admin polish — pin Company/Localization, gate dashboard widgets by `requiresService`, i18n + settings PUT envelope

  Dogfooding the Setup app as a brand-new system administrator surfaced a cluster of small first-run gaps, now fixed:

  - **platform-objects**: pin **Localization** and **Company** in the Setup sidebar's Configuration group — both are registered `service-settings` manifests (the two lowest-`order` Workspace settings) but were reachable only via the "All Settings" hub. Translate the previously-English nav labels Cloud Connection (云连接), Datasources (数据源) and Capabilities (能力). Tag the System Overview `widget_organizations` KPI with `requiresService: 'org-scoping'`.
  - **rest**: extend the ADR-0057 D10 server-side visibility gate to **dashboard widgets** — strip widgets whose `requiresService` names an unregistered kernel service (mirrors the existing app-nav gate; `resolveRegisteredServices` now also discovers gates declared on widgets). In a single-tenant runtime this removes the orphan "Organizations" KPI, matching the already-hidden org nav entries.
  - **service-settings**: add the missing zh `help` strings for the Localization manifest (number/currency/first-day-of-week/fiscal-year fields), and accept the `{ values: { … } }` envelope on `PUT /api/settings/:ns` symmetrically with what `GET` returns.

- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- c121d73: fix(cli): let single-node `os start` auto-mint a crypto key

  `os start` forces `NODE_ENV=production`, which made `LocalCryptoProvider` refuse
  to boot without `OS_SECRET_KEY` — breaking the documented zero-config quickstart
  (`npm i -g @objectstack/cli && os start`) on a clean machine.

  `LocalCryptoProvider` now honours an `OS_CRYPTO_AUTOKEY` opt-in in production: it
  mints AND persists a key to `~/.objectstack/dev-crypto-key`. The ephemeral
  fallback stays forbidden, so a non-writable / ephemeral filesystem still fails
  loud rather than running under a key that won't survive a restart. `os start`
  sets the flag only for single-node deployments (no `OS_CLUSTER_DRIVER`, no
  `OS_SECRET_KEY`); multi-node still fails loud until `OS_SECRET_KEY` is provided.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/platform-objects@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/platform-objects@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Minor Changes

- 0d4e3f3: feat(auth): password-policy & session settings — live, enforced (P0 security)

  Extends the existing `auth` settings manifest (global scope) with the security policy keys that are **genuinely enforced today**, rather than standing up a new `security` namespace full of non-functional toggles (which would be false surface):

  - **Password policy** — `password_min_length` (default 8), `password_max_length` (default 128). Enforced by better-auth on sign-up and password reset.
  - **Sessions** — `session_expiry_days` (default 7, absolute lifetime), `session_refresh_days` (default 1, refresh threshold).

  These ride the existing `AuthPlugin.bindAuthSettings` → `AuthManager.applyConfigPatch` path (read on `kernel:ready`, re-applied live via `settings.subscribe('auth')`, which invalidates the cached better-auth instance). Days are converted to seconds for better-auth's `session.{expiresIn,updateAge}`; unset (`source: 'default'`) and malformed/non-positive values are ignored so the provider default holds. Ships en + zh-CN translations.

  Deliberately **out of scope** (no enforcement exists, so they're not declared as settings): MFA-required, IP allowlist, SSO/SAML, SCIM, API rate limits, password complexity/rotation/history. These are real features to be built, not settings toggles.

- 8e5a3b5: feat(settings): `company` settings — legal organization identity

  Adds a `company` SettingsManifest for the workspace's **legal entity** identity, distinct from `branding` (public name/logo/theme). Organization-level (`tenant` scope), all keys optional for v1.

  Grouped Identity / Registered address / Contact: `legal_name`, `registration_number`, `tax_id`, `address_line1`/`address_line2`/`city`/`state`/`postal_code`/`country`, `phone`, `website`, `primary_contact_name`, `primary_contact_email`. Benchmarked against Salesforce "Company Information" and Stripe's business profile.

  These feed invoices/receipts, email footers (CAN-SPAM requires a physical postal address), contracts, and compliance exports. Ships with en + zh-CN translations and a manifest test.

- 9afeb2d: feat(settings): `localization` settings — platform default timezone, language & formats (ADR-0053 Phase 2)

  Adds a `localization` SettingsManifest, the missing keystone that makes the Phase 2 reference-timezone actually configurable end-to-end. One declaration gives the full settings stack for free: platform built-in default → `global` → `tenant` cascade, a permission-gated settings page, and i18n.

  **Keys** (organization-level; per-user overrides intentionally out of scope for v1): `timezone` (UTC), `locale` (en-US), `default_country`, `date_format`, `time_format`, `number_format`, `first_day_of_week`, `currency` (USD), `fiscal_year_start`. Benchmarked against Salesforce/Workday "Company Information + Locale".

  **Resolver 收编** — `resolveExecutionContext` now resolves `timezone` **and** `locale` from the `localization` settings via the `settings` service (canonical 4-tier cascade), falling back to a direct tenant-scoped `sys_setting` read, then `UTC` / `en-US`. This replaces the hand-rolled `sys_user_preference` + tenant-only `sys_setting` path from #1978 (which bypassed the settings abstraction and is dropped along with the per-user tier). New `ExecutionContext.locale`.

  **Consumer wiring** — analytics date bucketing now picks up the resolved org timezone: `DatasetExecutor` threads `ExecutionContext.timezone` into the query (precedence: explicit selection tz → request tz → UTC), so #1982's tz-aware buckets fire for a configured org without callers passing a zone. Formula `today()`/`datetime` were already wired (#1979/#1980).

  Email `datetime` rendering (`SendTemplateInput.timezone`, shipped in #1981) is intentionally **not** wired here: the only current `sendTemplate` callers are pre-session auth emails with no org context; business-notification callers can pass the zone when they appear.

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/platform-objects@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Minor Changes

- d100707: AI provider misconfiguration is now visible, rejected at save time, and recoverable from the UI. Background: a half-saved `ai` settings row (provider=cloudflare, empty key) silently overrode env auto-detection and the only symptom was a bare "Bad Request" in chat.

  - `GET /api/v1/ai/status` — active adapter provenance: `source` (explicit/env/settings/fallback), provider, model, plus `settingsError` explaining why saved settings were NOT applied. `AIServicePlugin` tracks this through boot detection, settings rebuilds, and resets.
  - Save-time validation in `SettingsService.setMany` (fulfilling the spec promise that `required` is enforced server-side): visible+required fields and `pattern` mismatches reject the whole batch with field-level errors (`400 SETTINGS_VALIDATION`). Visibility expressions (`${data.provider === '…'}`) are evaluated server-side by a restricted-grammar parser; unparseable expressions and all-null patches (resets) stay lenient. `gateway_model` / `cloudflare_model` gain `provider/model` patterns.
  - Built-in `reset` settings action for every namespace (`SettingsService.resetNamespace`), overridden for `ai` to also re-run env adapter detection immediately; the AI manifest ships a "Reset to environment defaults" button — no more hand-editing `sys_setting`.
  - Chat/agent/assistant stream errors are enriched with the active adapter description and actionable hints (400 → model-id format, 401/403 → credential, 404 → unknown model, 429 → rate limit) instead of a bare HTTP status.

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Major Changes

- f533f42: Settings namespace environment overrides now use the canonical ObjectStack
  `OS_<NAMESPACE>_<KEY>` form, with no unprefixed aliases. For example,
  `ai.openai_base_url` is now `OS_AI_OPENAI_BASE_URL`, and
  `feature_flags.ai_enabled` is now `OS_FEATURE_FLAGS_AI_ENABLED`.

  The AI service now treats a stored or env-locked `provider=memory` setting as
  an explicit override, while the manifest default still leaves boot-time
  provider auto-detection intact.

  The auth plugin now binds the `auth` settings namespace to better-auth runtime
  configuration, exposes an extension hook for provider packages, and includes a
  basic Google sign-in implementation configured either in Setup → Authentication
  or by deployment-level `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/platform-objects@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Minor Changes

- 55866f5: Fail loud instead of silently minting an ephemeral encryption key; ship a persistent env-master-key provider as the default (#1507).

  The default `ICryptoProvider` backs every secret-at-rest in the platform —
  encrypted settings (`sys_setting.value_enc`), ObjectQL `secret` fields, and
  runtime datasource credentials. Its key resolution previously fell back,
  **silently**, to a fresh per-process `randomBytes(32)` key (or auto-minted a
  new on-disk key on every boot) when no stable key was available. In an
  ephemeral-FS container or a multi-node cluster, each restart / each node then
  encrypts under a different key, and every previously-written `sys_secret` value
  becomes undecryptable. The failure was invisible at encrypt and boot time and
  only surfaced later as "all my saved passwords / API keys / DB credentials
  fail to decrypt".

  - **Renamed `InMemoryCryptoProvider` → `LocalCryptoProvider`.** The old name
    implied an ephemeral key when the provider in fact persists one.
    `InMemoryCryptoProvider` stays as a deprecated alias for backward
    compatibility.
  - **Added `OS_SECRET_KEY`** as the canonical production master key (32-byte
    hex or base64), the documented production default. `OS_DEV_CRYPTO_KEY`
    remains the dev convenience key.
  - **Fail-loud in production.** When `NODE_ENV=production` and no stable key
    source (env var or a pre-existing persisted file) is available, the provider
    now throws an actionable error at construction instead of generating a key —
    turning silent data-loss into a config error at boot. It never auto-mints a
    key in production. Development and test keep the ergonomic fallback
    (persisted dev key / ephemeral test key).
  - `serve` surfaces the production-key error verbatim and refuses to wire an
    unstable provider for `secret` fields.

  KMS / Vault providers (managed custody, per-tenant keys, automatic rotation)
  remain future/enterprise plug-ins behind the same `ICryptoProvider` seam;
  "your stored secret is still there after a reboot" stays open-source.

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Patch Changes

- 82eb6cf: Fix system-metadata translations: locale fallback, app/dashboard localization, and coverage gaps.

  Switching the UI language left many surfaces in English. Three root causes
  are addressed:

  - **Locale fallback (server).** The metadata translation resolver
    (`@objectstack/spec` `i18n-resolver`) now resolves a requested locale
    against the locales actually present in the bundle (exact →
    case-insensitive → base-language → variant), so a request for `zh`
    correctly hits the `zh-CN` bundle instead of falling back to English.
    This mirrors `resolveLocale` in `@objectstack/core` and benefits every
    resolver (objects, views, actions, settings, metadata forms).

  - **App & dashboard localization (server).** Added `translateApp` and
    `translateDashboard` resolvers and wired `app`/`dashboard` into the REST
    `/meta` translation path. App labels, sidebar/navigation group labels,
    and dashboard titles/widgets were previously never localized at the API
    boundary even though the translation data existed.

  - **Coverage & quality (data).** Added translations for the previously
    untranslated platform objects `sys_share_link`, `sys_view_definition`,
    and `sys_metadata_audit` (and registered them in the i18n-extract config
    so future extractions keep them). Replaced English placeholder strings
    left in the `zh-CN` / `ja-JP` / `es-ES` object and metadata-form bundles
    (notably action `confirmText` / `successMessage` prompts). Added the
    missing `es-ES` built-in Settings bundle in `@objectstack/service-settings`.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/types@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Minor Changes

- e9bacda: Auto-generate concise titles for AI conversations.

  `AIService` now exposes `summarizeConversation(id)` and fires it
  once per conversation after the first assistant turn lands. The
  generated title (≤ 16 chars by default) is PATCHed onto the
  `ai_conversations` row so the sidebar shows a meaningful label
  instead of "New conversation". Failures are silently swallowed —
  title generation is purely cosmetic and never blocks chat.

  Plumbing:

  - New AI settings (in the `ai` Settings namespace):
    - `title_generation_enabled` (toggle, default on for non-memory providers)
    - `title_max_length` (number, 8–80, default 16)
  - `AIService.setTitleGenerationConfig({ enabled, maxLength })` —
    called by `AIServicePlugin.bindSettings()` whenever the `ai`
    namespace changes, so admins can toggle the feature live from
    Setup without a restart.
  - `AIService` calls `summarizeConversation()` fire-and-forget at
    the natural end of `chatWithTools` and `streamChatWithTools`.
    Idempotent per service instance — a single titling attempt per
    conversation per process.

  Defaults are conservative: memory provider stays untouched
  (no LLM call is made), and any per-test `AIService` that doesn't
  explicitly call `setTitleGenerationConfig({ enabled: true })`
  behaves exactly as before.

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- 0a40bd1: Make the Settings UI survive crypto key changes and dev restarts.

  Two related fixes to stop a single bad encrypted row (e.g. an AI API key
  encrypted before a server restart) from 500-ing the entire
  `GET /api/settings/:namespace` endpoint with `Unsupported state or
unable to authenticate data`:

  - **`InMemoryCryptoProvider`** now honours the `OBJECTSTACK_DEV_CRYPTO_KEY`
    env var (32 bytes, hex or base64) as a stable AES-256-GCM data key.
    When the env var is unset, the provider still generates an ephemeral
    key but now logs the generated key once as base64 so dev operators
    can paste it into `.env` and survive subsequent `pnpm dev` restarts.
    Production behaviour (KMS-backed providers) is unchanged.

  - **`SettingsService.materialiseRow`** now catches decrypt failures,
    logs a single warning naming the offending `namespace.key`, and
    returns `null` instead of throwing. The field renders as empty and
    remains editable, so operators can re-enter the secret in place
    rather than being locked out of the settings page entirely.

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Minor Changes

- 4f9e9d4: Setup App: complete the Configuration settings pages.

  **Setup App navigation**

  The Configuration group now lists every built-in settings namespace
  (previously Storage was missing entirely, and Knowledge had no entry):

  - Branding · Email · **File Storage** · **AI & Embedder** · **Knowledge** · Feature Flags

  Order in the left-nav now matches `builtinSettingsManifests` so the
  "All Settings" index and the left-nav stay aligned.

  **AI manifest — embedder section**

  `ai.manifest.ts` now ships an Embedder section in addition to the
  existing chat-LLM section. Knobs:

  - `embedder_provider` — `none` (default) / `openai` / `azure` /
    `dashscope` (阿里通义) / `zhipu` (智谱) / `siliconflow` (硅基流动) /
    `doubao` (火山引擎) / `minimax` / `ollama` / `custom`. Preset list
    mirrors `@objectstack/embedder-openai`'s `OPENAI_COMPATIBLE_PRESETS`.
  - `embedder_api_key` — encrypted password.
  - `embedder_model` — free text with documented examples per provider.
  - `embedder_base_url` — visible for `custom` / `azure` only.
  - `embedder_dimensions` — optional Matryoshka override.
  - `embedder_batch_size` — `embed()` chunk batch size.
  - Test action wired to `POST /api/settings/ai/test_embedder` — fallback
    validates form completeness; real probe lives in `service-ai` /
    `service-knowledge`.

  **New `knowledge` settings manifest**

  `knowledge.manifest.ts` is the canonical surface for RAG infrastructure:

  - `adapter` — `memory` / `turso` / `ragflow`.
  - Turso group — `turso_url` (libsql://, file:, :memory:) + encrypted
    `turso_auth_token`. Leaving URL blank means "reuse the tenant's
    primary libSQL connection" — the recommended cloud setup.
  - RAGFlow group — base URL + encrypted API key + default dataset id.
  - Indexing defaults — `chunk_target`, `chunk_overlap`, `over_fetch`.
  - Permissions — `enforce_rls` defaults to `true` (security-critical;
    toggling off skips the platform's unique RLS re-check on every hit).
  - Test action wired to `POST /api/settings/knowledge/test`.

  **Translations**

  Full `ai` and `knowledge` translation blocks added to both `en.ts` and
  `zh-CN.ts`. Storage block had translations already.

  **Tests**

  - `ai.manifest.test.ts`: +5 cases covering embedder select, encryption,
    test action wiring, and embedder handler validation across 5 provider
    shapes (none / ollama / OpenAI-compatible cloud / custom / azure).
  - `knowledge.manifest.test.ts`: 20 new cases covering manifest shape,
    adapter selection, secret encryption, default `enforce_rls=true`,
    test handler validation across all 3 adapters and payload merging.

  78/78 tests pass in `@objectstack/service-settings`.

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Minor Changes

- 97efe3b: `InMemoryCryptoProvider` now auto-detects WebContainer (StackBlitz) and swaps `node:crypto`'s AES-256-GCM for a pure-JS implementation from `@noble/ciphers/aes.js`.

  **Why:** WebContainer's `node:crypto` ships `createCipheriv`/`createDecipheriv` stubs that throw `TypeError: y.run is not a function` when called with `'aes-256-gcm'`. Any code path that persists an encrypted setting through `sys_secret` would crash on StackBlitz.

  **How it works:**

  - Detection: `process.versions.webcontainer` / `SHELL=jsh` / `STACKBLITZ` env.
  - The ciphertext layout `iv(12) || tag(16) || cipher` is preserved, so handles written on one runtime decrypt cleanly on the other.
  - AAD binding (`namespace|key`) and `digest()` are unchanged.
  - In non-WebContainer runtimes the code path is identical to before.

  If `@noble/ciphers` cannot be loaded for any reason, the provider falls back to `node:crypto` and lets it throw, surfacing the misconfiguration clearly.

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0
