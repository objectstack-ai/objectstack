---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): "New similar" on a read-only base's permission set in the Access pillar, opening the copy where the clone door landed it

Clause-②: no
Metadata-protocol: none

A customer's own permission set is a new set in the package that holds their changes (ADR-0146 D6). Since the clone door lands a copy of a read-only package X's set in X's paired `X.custom`, Studio can offer that gesture where the base is designed.

- **New similar in Studio.** In the Access pillar of a read-only package, the open permission set offers "New similar". It asks for a machine name and a label (the same dialog as Setup's catalog) and posts exactly `{ name, label }` to `POST /security/permission-sets/:name/clone`. The client sends no package and no facet: the server decides where the copy lands.
- **The copy opens where the answer says.** The door's answer names the package the copy was saved in. The pillar opens that package's Access pillar with the copy selected (`/studio/<package>/access?surface=permission:<copy>`), and shows the server's notice there as sent. An answer that names no package (absent or `null`) or no copy says so, and opens nothing.
- **Refusals and gates.** A refusal (400, 403, 404, 409) is shown in the server's words in the dialog. Under a walled posture, or for a caller without `manage_metadata`, the action is drawn disabled with the console's own sentence for why. The base's sets stay read-only, and no override gesture is drawn on a permission set.
- **One label.** The action reads "New similar" (zh: 新建类似) on Setup's catalog too, and the guidance strings that name it say the server saves the copy in the package that holds your changes. Setup's post-clone hop is unchanged.
- **Access pillar keyed by package.** Like its sibling pillars, it remounts when the package changes, so opening the copy in another package's pillar no longer keeps the base's open set.
