---
"@objectstack/platform-objects": patch
---

fix(platform-objects): translate the Setup app's runtime-contributed navigation, and gate it on the merged app instead of a static walk (#5750)

Under `zh-CN`, four of the Setup app's ~50 sidebar entries rendered in English —
`Packages`, `Delegations (OOO)`, `Webhooks`, `HTTP Deliveries` — and it was not a
client-side fallback: the server's own merged `app` metadata carried the English
literals. Sitting in a screen of Chinese menu items, they read like words that
were simply never meant to be translated.

Two different causes, both now fixed:

- **`nav_packages` was translated in the wrong app's namespace.** A
  `nav_packages: { label: '软件包' }` existed under `apps.studio.navigation`.
  Setup contributes an entry with the same id (package administration is an
  operator concern, ADR-0084) and looks it up under
  `apps.setup.navigation.nav_packages` — a different subtree, so the lookup
  missed and the author's `'Packages'` literal won. Both entries are legitimate;
  the Setup one has been added and the Studio one left alone.
- **The other three had no translation anywhere.** `nav_approval_delegations`
  (`@objectstack/plugin-approvals`), `nav_webhooks` and `nav_http_deliveries`
  (`@objectstack/plugin-webhooks`) are contributed at runtime by the capability
  plugins that own the objects, and no locale file carried a label for them.

Four more were found by the new gate below, invisible to the one-locale browser
session that reported this: `nav_capabilities`, `nav_settings_localization`,
`nav_settings_company` and `nav_datasources` were translated in `zh-CN` **only**,
so `ja-JP` and `es-ES` menus showed English there too. All eight ids are now
labelled in all four locales (`en`, `zh-CN`, `ja-JP`, `es-ES`).

**Why nothing caught it, which is the part worth keeping.** The Setup app is a
shell of empty group anchors whose entries arrive at runtime (ADR-0029 D7), so a
static walk sees none of them. Both existing gates knew this and each named the
*other* as the owner: `app-nav-translation-parity.test.ts` excluded Setup and
deferred to "the coverage ratchet", while `platform-objects`' extract config
deferred the same labels to that ratchet "baselined at 0 for this package". The
ratchet runs `os lint` over **static** stack configs, so its 0 meant "not looked
at here", not "checked, clean" — and it reported OK the whole time.

A new gate closes the handoff — `pnpm check:app-nav-i18n`
(`packages/cli/scripts/check-app-nav-i18n.mjs`, wired into `lint.yml`). It boots
the real composition, merges the navigation contributions through the same
`applyNavContributions` path the `/api/v1/meta/app` read uses, and asserts every
merged nav id carries a label in every locale the platform bundle declares — so
the next plugin-contributed entry cannot leak the same way. It also fails when a
declared contributor lands no nav id at all, because fewer merged ids means
fewer ids checked: a contributor that silently stops contributing would
otherwise make the gate greener rather than redder. The two comments that
delegated to the ratchet now say what actually owns these labels.

No authoring change: plugin nav `label` values stay plain English literals, and
translations continue to live in `apps.setup.navigation` in this package.
