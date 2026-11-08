---
'@objectstack/cli': patch
---

fix(cli): `os deploy` to a self-hosted runtime takes `--confirm-global-uniques`, the retry its installation-wide uniques stop prints

Clause-②: yes (widening) — `os deploy` gains an accepted flag, `--confirm-global-uniques`, widening a published CLI command's accept set
Metadata-protocol: none

- **What was wrong.** With a self-hosted runtime as the deploy target (`os environments use-runtime`), `os deploy` installs through `os package install` run in the same process. When an `isolated`-posture runtime stops the install on the app's installation-wide (`unique: 'global'`) constraints (`UNIQUE_SCOPE_CONFIRMATION_REQUIRED`), the retry it prints is `os deploy --confirm-global-uniques`, but `os deploy` did not declare that flag: following the printed advice was refused as an unknown flag, and the deploy had no way to pass the confirmation.
- **What changes.** `os deploy` declares `--confirm-global-uniques` and passes it through to the install, as it already does `--confirm-access-upgrade` and `--confirm-upgrade`: all three go through one seam, to the install only (the dry run sends none, as before). Named while the target is ObjectOS Cloud, it is refused before anything is built or sent, like the two upgrade confirmations.
- **What does not change.** `os package install --confirm-global-uniques` and the two upgrade confirmations behave as before.
