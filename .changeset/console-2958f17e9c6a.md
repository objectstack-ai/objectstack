---
"@objectstack/console": patch
---

Console (objectui) refreshed to `2958f17e9c6a`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 32 releasing of 33 changesets added across 34 non-merge commits; omitted: 1 release-nothing changeset, 1 commit carrying no changeset (they ship no package code).

- **minor** — The console knows the `external` organization role that objectstack#25515 added to `@objectstack/spec`'s membership vocabulary (objectui#13427). Without it `ORG_ROLE_LABELS` no lo… (objectui `2958f17e9`)
- **minor** — A record page inside the Setup app no longer draws the floating managed-by badge (the amber "Identity" chip at the top-right of an organization, team, business unit or user record… (objectui `d9aff15b3`)
- **minor** — An action's `confirmText`, `successMessage` and `errorMessage` read the `template` envelope and fill `{{ }}` holes (objectui#13367). (objectui `8e90779dc`)
- **minor** — Grids: hovering a `lookup` or `master_detail` cell no longer shows the referenced record's raw id (objectui#13377). (objectui `f1a4b0895`)
- **minor** — On a cloud-managed environment (`features.cloudManaged: true` from `/auth/config`), the console says what the server already enforces. Setup → Users shows one line saying where pe… (objectui `ff77cfc22`)
- **patch** — A record-scoped flow action launched from a list toolbar with 0 or several rows selected is refused before its param dialog opens, and its refusal is translated (objectui#13397). (objectui `4eeb1740e`)
- **patch** — A page-level `object-chart` bound to a `dataset` now draws a select dimension in the order its field declares its options, the order the dashboard's dataset widget already uses fo… (objectui `b317942cf`)
- **patch** — charts: a sankey now names every node and colours its flows, and a funnel labels every stage. Sankey nodes were bare bars with no text and every link was one grey, so the chart co… (objectui `2c3dc7281`)
- **patch** — A single-record action launched with 0 or several rows selected is refused before any dialog opens, and the refusal is translated (objectui#13384). (objectui `7f60e9d05`)
- **patch** — fix(plugin-list): the synthetic "All records" tab of a tabs-mode user-filter bar (`showAllRecords`) now reads its label from the new `list.userFilters.allRecords` i18n key, filled… (objectui `ad74e9821`)
- **patch** — Setup → Permission Sets → Assigned Users: Remove asks first, and the add picker offers organization members only (objectui#13408), the same shape as the positions page (objectui#1… (objectui `130c77d59`)
- **patch** — charts: a line or area chart no longer cuts its first or last x-axis label at the chart's edge. recharts draws their categorical x axis as a point scale, which puts the edge categ… (objectui `eadceabb1`)
- **patch** — A boolean renders the same whatever its name (objectui#13412). `BooleanCellRenderer` drew a red destructive "LABEL — Off" badge for `false` when the field was named `active`, `is_… (objectui `cee3bc5cf`)
- **patch** — Integrations → Connect an AI agent no longer mints an API key in one click (objectui#13383). "Generate key" stays disabled while the name box is blank or whitespace-only, and the… (objectui `3a8a11758`)
- **patch** — zh-CN: the admin-override approval copy no longer calls the override 越权 ("exceeding one's authority", the word for a violation). The override levers now read 管理员代为通过 / 管理员代为拒绝 / 管… (objectui `afcf6544d`)
- **patch** — A Setup settings page reads its namespace again after a successful save or action, and takes the whole answer, manifest included (objectui#13382). The server computes parts of a n… (objectui `d17f67081`)
- **patch** — An action run from a record page's action bar with an `onSuccess.navigate` to a path with no app segment opens that page in the record page's app (objectui#13396). (objectui `4b1ddf3e0`)
- **patch** — Studio says when a display name yields no identifier, and Add field no longer names a field `field_<N>` behind the author's back (objectui#13389). (objectui `78e00db7f`)
- **patch** — Changing the ⌘K query no longer blanks the console (objectui#13387). (objectui `01b85d8f8`)
- **patch** — After a save, delete or action, the record page and the list ask the platform's explain engine each record's edit and delete question once (objectui#13341). (objectui `b93c9f695`)
- **patch** — Setup → Positions: a new position is created together with its permission sets, Save is labelled, Remove holder asks first, and the holder picker offers organization members only… (objectui `3ec84bee5`)
- **patch** — An action's `onSuccess.navigate` to a path with no app segment opens that page in the current app (objectui#13379). (objectui `6183aa90f`)
- **patch** — A form field entry whose `label`, `placeholder` or `helpText` is an inline locale map (`{ en, 'zh-CN' }`) now renders in the visitor's language, on the public form `/f/:slug` and… (objectui `4824ad743`)
- **patch** — Setup → Packages: in a package's sheet, *Adopt loose items* asks in the in-app confirmation, reports how many items it adopted, and each action clears the previous action's messag… (objectui `8d305ab56`)
- **patch** — Setup → Installed Apps is titled "Installed Apps" and says when no app is installed from the marketplace yet (objectui#13356). (objectui `3a73c07b3`)
- **patch** — A metadata form row now shows the field's label only (objectui#13352). `SchemaForm`'s default row used to draw the field's machine key in a code chip beside the label whenever the… (objectui `5b40cea5c`)
- **patch** — Connect an Agent no longer mints an unnamed API key in one click (objectui#13355). "Create key" stays disabled until the administrator types a name, and the name is sent as typed:… (objectui `fa31856db`)
- **patch** — A lookup / master-detail / tree value whose referenced record the viewer's own read answers "not found" for (a 404, which is what the server answers for a record this viewer may n… (objectui `ec627aba1`)
- **patch** — A screen flow that ends refused shows its message and Close alone (objectui#13342). (objectui `05049f87c`)
- **patch** — Setup refusals lead with one plain sentence. The Packages sheet, the metadata editor's error banner (Positions and every other metadata type) and the action parameter dialog (OAut… (objectui `241cb78bd`)
- **patch** — Setup › Packaged automation: the Clone dialog now opens with a name and label filled in (objectui#13344). (objectui `0f4adc38b`)
- **patch** — The record header's highlights write the year on every date (objectui#13331). (objectui `49a536dd0`)

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ chore(deps): lock vite 8.3.5 and pin next 16.3.8, with no manifest range moved (takes over #13288, #11845) (#13399) (objectui `889d02894`)

Metadata-protocol: none (the console refresh changes no key, value or type a metadata author writes)

objectui range: `6fb31dcc9954...2958f17e9c6a`
