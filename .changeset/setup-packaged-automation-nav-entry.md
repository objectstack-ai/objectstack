---
"@objectstack/platform-objects": patch
---

fix(platform-objects): add the Setup nav entry for the packaged-automation page (#12457, ADR-0126 §7.4)

The packaged-automation page (on/off per packaged flow/action, clone for
flows) shipped complete in the console (objectui app-shell, registered under
the component ref `automation:packaged`), but no framework
`NavigationContribution` ever named that ref — so on every stock boot the
page was reachable only by a hand-typed URL
(`/apps/setup/component/automation/packaged`), and Setup's sidebar carried no
entry. Epic #12150's L5/L6-UI cards closed with the objectui half pinned and
the framework half missing; `content/docs/build-without-code.mdx` promises
the page publicly.

`SETUP_NAV_CONTRIBUTIONS` now contributes `nav_packaged_automation`
(`type: 'component'`, `componentRef: 'automation:packaged'`) in `group_apps`
beside Packages — package administration is Operate (ADR-0084), and ADR-0126
§7.4 rules "Studio keeps the editing; Setup gets the operational state". The
entry deliberately carries no `requiresService: 'automation'` (the action
switches ride the `sys_metadata_activation` ledger this package registers and
work on compositions with no automation service, #12419) and no
`requiredPermissions` (matches `nav_packages`: the app's `setup.access` gates
entry, the activation write doors enforce `manage_metadata` / the §5 operator
gate server-side). Labels land in all four locales with recorded source
hashes; `setup-packaged-automation-nav.test.ts` pins the framework half of
the cross-repo contract the objectui nav test pins from its side.
