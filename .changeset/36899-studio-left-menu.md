---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(studio): a collapsible left menu of six groups replaces the top pillar nav

Clause-②: no
Metadata-protocol: none

ADR-0084 (amended) · #36899, part of #36890.

- **Studio's one navigation is a left menu.** The top bar's Data / Automations / Access / All metadata switcher is gone. Every Studio page (a package's pillars and area, the package-less flows `~org`, and the cross-package leg `~all`) draws the same menu of six groups: Data, Interface, Automation, Platform, Access, AI. Each group lists the metadata types the package holds (the directory's own rule, `scopeDirectoryEntries`), with a type count per group and an item count per type, and a search box that narrows the entries. A type entry opens that type's list in the area; an item of an object, flow or permission set still opens its designer. Four entries are not a type: Organization flows (`~org`, under Automation), Default sharing (the Access pillar's OWD overview, under Access), Diagnostics (under Platform) and Positions and permissions (the environment catalog on `~all`, under Access).
- **It collapses like the app sidebar, under its own cookie.** It is the app sidebar's primitive: the header's toggle hides and shows it, the state survives a reload under `studio_menu_state` (never the app sidebar's `sidebar_state`), and below 768 px it is a drawer. `SidebarProvider` (`@object-ui/components`) takes a new optional `cookieName` prop for that; the default is unchanged.
- **The domain dictionary names `system` Platform / 平台 and `security` Access / 访问**, the amended ADR-0084's group names (`translateMetadataDomain`).
- **`~all` is drawn in the builder's shell.** `/studio/~all/metadata/*` is served by the same route as a package's area, so it has the left menu too; the landing's frame no longer draws it. A `~org` area URL (or `?package=~org`) now lands on the package-less flows instead of being read as a package.
- **「‹ Back to app」 names the current package's app** (decision 5), never a remembered app of another package; a package with no app names the package and goes to the apps home.
- Changes and Publish stay at the right end of the top bar, beside Cancel and Save.
