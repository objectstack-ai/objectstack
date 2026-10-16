---
"@objectstack/console": minor
---

Console (objectui) refreshed to `f96f771140f1`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 31 releasing of 31 changesets added across 31 non-merge commits.

- **minor** — The object list's chrome sits on fewer rows (objectui#12528). (objectui `646caea87`)
- **minor** — **A dashboard's "Refresh All" sits in the console page header** (objectui#12554). The console's dashboard page draws the button at the right of its page header's one row, among it… (objectui `96dea1b7a`)
- **minor** — Console pages: a dashboard and the Approvals Inbox draw the page header an object list draws, and the top bar draws no breadcrumb on a dashboard or page route (objectui#12526). (objectui `cd64d43f1`)
- **minor** — Studio Interfaces pillar: the rail is the app's navigation tree as the running sidebar draws it, the "+" offers every nav kind, and the header, tab row and nav-item inspector foll… (objectui `b5416943c`)
- **minor** — The flow canvas's node cards and the Studio's node configuration aside take the Automations redesign (objectui#12488, epic objectui#12446). (objectui `a27c1cfb8`)
- **patch** — A dataset-bound metric tile on `DashboardGridLayout` is two lines, not three (objectui#12573). (objectui `f96f77114`)
- **patch** — Record details: Enter on a link inside a read-only details row that offers copy now opens the link, instead of copying the row's value (objectui#12569). (objectui `6f5dc6b30`)
- **patch** — Studio's Data pillar Form tab now previews the draft (objectui#12515). (objectui `e089a25b9`)
- **patch** — List toolbar: the Filter, Export and Add record buttons keep an accessible name when they render icon-only below the `sm` breakpoint (objectui#12500). Each carries an `aria-label`… (objectui `3821a3ac5`)
- **patch** — The approval decision panel's declared amount also takes a roll-up total (objectui#12534): a field the target object declares `type: 'summary'` whose `summaryOperations` is a `sum… (objectui `cf0f40323`)
- **patch** — A dataset-bound metric tile on a dashboard is two lines, not four (objectui#12528). (objectui `d88e3517e`)
- **patch** — Opening a collapsed section in a record dialog no longer takes the whole console off screen (objectui#12559). (objectui `0081cdc9e`)
- **patch** — The Studio's Interfaces canvas no longer asks for the schema of an object that has only a draft (objectui#12508). (objectui `1b28dbf27`)
- **patch** — Console pages: Flow Runs, Integrations & APIs, Audit Log, AI Approvals, Applications, Profile, the Settings hub and each settings namespace page draw the console page header an ob… (objectui `0d2ac9055`)
- **patch** — A record pointer card now links to the record it shows, when the reader may read that record (objectui#12557). (objectui `7f535f86a`)
- **patch** — Hiding columns on your own saved view now sticks, even when the view declares no `columns` (objectui#12505). (objectui `572bbce00`)
- **patch** — A read-only package now says it is read-only in two places in the Studio, the same in every pillar (objectui#12453). (objectui `2a692851a`)
- **patch** — Studio Interfaces: editing the navigation keeps the 240 px rail, so the content column and the inspector no longer move when you press Edit or Done. Each row of the navigation edi… (objectui `73a3eb2b9`)
- **patch** — A console page's "Edit in studio" button opens the page in Studio, where every other Studio handle on the same screen goes (objectui#12540). (objectui `a90c13178`)
- **patch** — Studio no longer logs a red "Failed to load resource" line for things it already knows are absent (objectui#12508). (objectui `d17952c06`)
- **patch** — The object designer (Studio's Object Settings) and Setup's app navigation editor pick an icon from the catalog the console ships instead of taking a typed Lucide name, and the ico… (objectui `93ce81ac0`)
- **patch** — A sectioned create or edit form draws every section at its own `columns` count per row, whatever the other sections declare (objectui#12548). (objectui `5f8ecf678`)
- **patch** — Flow canvas: a branch edge's pill reads the edge's own label first, so two outcomes of one decision no longer show the same truncated condition (objectui#12507). (objectui `baab2d6ed`)
- **patch** — The record page's highlight strip no longer cuts a value without saying so, and at phone width it uses one layout (objectui#12523). (objectui `518a8e308`)
- **patch** — The console list page's saved-view tabs show as many tabs as the toolbar row has room for again, instead of folding to one tab and "N more" (objectui#12518). (objectui `92318202a`)
- **patch** — The console sidebar's ⋯ menu Design entry, and a favorite's Design entry, open the item's Studio surface: the same destination the app bar's Edit app opens for that item (objectui… (objectui `646307f37`)
- **patch** — Studio Data pillar: the object header shows the same controls on every tab (objectui#12511). (objectui `5249c2435`)
- **patch** — The Studio header no longer overlaps on a narrow window (objectui#12509). (objectui `a3d14e787`)
- **patch** — New package dialog: the display name is now the first field, and the Package ID, Object namespace and Version follow it in the same Basics card. Each of the three says it was fill… (objectui `eea0993c1`)
- **patch** — Record page History: an entry with no actor at all (neither a resolved name nor a user id — a seed backfill or a hook with no user in context) now reads "System" with a cog glyph… (objectui `165f8ff9f`)
- **patch** — Record page header `⋯` menu: the system entries (Edit, favorites, Share, Delete) now carry icons (pencil, star, share, trash) like the app's own actions; the menu lists authored a… (objectui `1ffd6a2fc`)

objectui range: `1f23d5b070fa...f96f771140f1`
