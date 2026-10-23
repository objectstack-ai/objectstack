---
'@objectstack/service-settings': patch
---

fix(service-settings)!: a host that binds its own engine and states no organization source reads and writes as the organization ADR-0131 D9 derives through that engine, not as no organization

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) Which organization a self-binding host's settings reads and writes take changes. No key of any metadata schema is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite and no tombstone is needed. No export, type, option, error code or route is added, removed or renamed: `SettingsServiceOptions` and the `bindEngine` extras are unchanged, and `SettingsServicePlugin` already states its source. The remedy for a host this narrows is one line at its bind site, stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this read (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** read narrowing (ADR-0131 D8/D9, follow-up to the organization-less rung fix). It changes which organization a host's settings reads take, not what a metadata author can write, so it ships as `patch` with this banner.

- FROM: a host that bound its own engine (`new SettingsService({ engine })` or `bindEngine(engine)`) and stated no `organization` source read and wrote, for a caller that names no organization, as a composition with no organization object: its rows with no organization answered, and its writes stored none.
- TO: such a host's service asks D9 itself, through the engine it holds (`resolveGuestOrganization`, the call the plugin's source makes). Under `single` with one organization it reads and writes as that organization; at none or several it has no tenant or user rung. An engine that exposes no `registry` cannot say the organization object is absent, so D9 asks `sys_organization`. Over a store with no such object, a tenant-rung read or write by a caller naming none is then refused as organization-less (reads answer from the global rung or the default, tenant writes are refused with `SETTINGS_VALIDATION`), or raises `AuthzStoreUnavailableError` naming `sys_organization` where the engine does not know that object. No engine at all (the in-memory store), a stated source, an engine whose `registry.getObject` answers, and `SettingsServicePlugin` (`os serve`, `os dev`) are unchanged.

**Who is affected.** Only a host that binds its own engine and states no source: a control-plane mock or an embedded runtime. On a composition with an organization object it now reads and writes the derived organization's rows, and its rows with no organization stop answering. On one without, it meets the refusal above. A deployment booted through `SettingsServicePlugin` is not affected.

**The fix.** State the composition at the bind site: `service.bindEngine(engine, audit, { organization: async () => ({ kind: 'no-organization-object' }) })` (a host that hands its engine to the constructor binds it this way instead), or hand over an engine whose `registry.getObject` can answer.
