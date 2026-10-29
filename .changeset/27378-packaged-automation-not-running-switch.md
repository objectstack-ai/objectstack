---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(setup): a packaged flow the deployment does not run no longer shows a green switch, and a scheduled-work policy row says so in plain words

Clause-②: no
Metadata-protocol: none

- **Before.** On Setup › Packaged automation, a flow whose activation flag is on but which the engine has not armed showed the switch's green "on" track beside an outlined "Not running here" badge. An administrator read the green track as "running". When the cause was the deployment's scheduled-work policy, the only explanation was the platform's sentence behind Details, which names an environment variable the administrator cannot set from the browser.
- **Now.** A not-running row's switch draws a muted on-track. A row whose engine cause is `deployment_policy` reads "On, but this deployment does not run scheduled work" in place of the badge, localized in all ten packs (new key `packagedAutomation.notRunningDeploymentPolicy`). The platform's sentence stays verbatim behind Details.
- **Unchanged.** The switch stays enabled, stays checked while the flag is on, and still writes the flag. Rows with the other causes (`disabled_subflow`, `missing_trigger`, `binding_failure`) keep "Not running here". Running rows keep the primary track and "On"; off rows keep "Off".
