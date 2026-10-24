# @object-ui/console

## 18.1.0

### Patch Changes

- a91f6bb: The Approvals Inbox opens a request on the page the platform serves for it, and its side sheet is gone (objectui#12484).
  
  A row, a mobile card, Enter on the focused row, and a notification's `?request=` deep link now open the request's record page: the `sys_approval_request_detail` page `@objectstack/plugin-approvals` serves, on the console's standard record route. That page shows the request's title (the flow's label), its decision panel (the declared amount and snapshot summary, the approvers, the step line and the decisions), its highlights, its target record, and its timeline. The deep link takes its own place in the browser history, so Back returns to where the reader came from; from a row, Back returns to the inbox.
  
  The inbox's own request sheet is deleted. Its quick paths stay: inline approve and reject, bulk decisions, filters, sorting and keyboard navigation.
- 0093b2c: Settings pages: a `url`, `email`, `phone` or `color` value that misses the format its type declares now blocks Save (objectui#13287). No request goes out, the row is marked inline with a message naming what the format expects, and focus moves to the first such row, on the same path as the `required` check. The grammars are the settings service's own (objectstack#24882), judged on the trimmed value; an empty value is left to `required`, and a hidden or env-locked row is not judged. Adds `console.settingsView.invalidPhone` and `console.settingsView.invalidColor` to every locale pack; `email` and `url` reuse `validation.email` and `validation.url`.
- 0d12e95: An approver who is not an administrator sees the whole approval request page again: its fields, its decision panel with the decisions they may take, and its Timeline (objectui#13324).
  
  The console reads a request, and its timeline, through the approvals routes, which serve a request to each party to it. The record page then gated what it drew on the permissions answer for the data API, which names neither approval object for a member, because the platform keeps that door closed to them. So the page folded the request down to its id, drew no decision, and dropped the Timeline. Opening a request from the Approvals inbox showed a blank page.
  
  `@object-ui/permissions` adds `ServerReadScope`. Below it, the read verdicts for the objects it names (`check(object, 'read')` and `checkField(object, field, 'read')`) answer "allowed": whatever the server serves is what the viewer may read. Every other action, the field write and create verdicts, and every other object keep the enclosing provider's answer. The console mounts it for the two approval objects over every app. No read grant on either object is added: the data API stays closed to members.
- 4824ad7: A form field entry whose `label`, `placeholder` or `helpText` is an inline locale map (`{ en, 'zh-CN' }`) now renders in the visitor's language, on the public form `/f/:slug` and on the signed-in `/forms/:name` route (objectui#13380).
  
  `@objectstack/spec` types all three keys as `I18nLabel`, so the map is valid metadata, but the form page passed it straight into text slots: a map on a label or help line blanked the page for every visitor (React error #31), and one on a placeholder read `[object Object]`. The map is now collapsed to the visitor's language when the form's rows are built, with the same resolver the console uses for an action's inline-map copy. A plain-string entry renders exactly as before.
- d17f670: A Setup settings page reads its namespace again after a successful save or action, and takes the whole answer, manifest included (objectui#13382). The server computes parts of a namespace's manifest on every read: objectstack#25448 puts a live-status banner first on the page, so Setup → Email says whether mail leaves the machine. The page used to merge only the saved values and keep the manifest from its first load, so after an administrator configured SMTP the banner still said no mail leaves the machine until the page was reloaded.
  
  The re-read does not show the loading placeholder. An action leaves the unsaved edits as they are. If the re-read fails, the page keeps the saved values and the success message, and does not turn into an error.
- 3a8a117: Integrations → Connect an AI agent no longer mints an API key in one click (objectui#13383). "Generate key" stays disabled while the name box is blank or whitespace-only, and the name is sent trimmed: a cleared box no longer mints a key under the default name `Agent key`. Clicking "Generate key" now opens an in-app confirm naming the key; Cancel creates nothing, and confirming creates the key and shows it once, as before. The name box still opens prefilled with `Agent key`, which is minted only once the administrator confirms it. This matches the Connect an Agent card (objectui#13355).
- 47138b7: The Console's first page load no longer downloads the chat UI (objectui#13410). The `plugin-chatbot` chunk (169.6 KB gzipped, the third-largest eager chunk) and most of `vendor-markdown` used to load on every page, including for users who never open a chat, because the console shell imported a handful of small helpers from the `@object-ui/plugin-chatbot` package root, and the root re-exports the renderer that registers the chat components when it is evaluated. Measured on the Console's production build, the eager closure drops by 254,055 gzipped bytes (3,326,111 to 3,072,056). The chat now loads when it is first shown: opening the dock, visiting `/ai…` or `/s/:token`, or rendering a `chatbot`, `chatbot-enhanced` or `chatbot-floating` node.
  
  `@object-ui/plugin-chatbot` adds a side-effect-free `@object-ui/plugin-chatbot/core` subpath: `useAgents`, `resolveDefaultAgentName`, `PLATFORM_DEFAULT_AGENT`, `agentHasCapability`, the agent alias helpers (`AGENT_ALIAS_GROUPS`, `agentAliasGroup`, `agentRouteName`, `resolveAgentParam`, `isBuiltinAgentName`, `isBuildAgent`, `isAskAgent`), `AI_USAGE_REFRESH_EVENT`, `emitAiUsageRefresh`, `publishHealthFromResponse` and `detectPendingApproval`, with their types. Importing it registers nothing and reaches no chat UI module. The package root still exports every one of these names, unchanged.
  
  `@object-ui/app-shell` takes those names from `/core`, and the ChatDock loads its default chat body on first render instead of importing it. `resolveApiBase` is still exported from the same places.
- 576fd25: A `type: 'form'` action fired inside an app opens its form inside that app, headed by a label, with a Cancel (objectui#13433).
  
  The form opened on the app-less `/forms/:name`, so the app's sidebar, switcher and branding disappeared. The page was headed by the raw view name (`showcase_task.form`) and had only Submit, so the browser's Back button was the only way out without saving.
  
  - The console now also serves the form at `/apps/:appName/forms/:name`, inside the app's own shell. The record page, object list and page action navigators open a form hop there when their own route is an app route. The console-wide runtime has no route of its own, so its form hops keep the app-less route. `/forms/:name` is unchanged and still serves every other link.
  - A form view with no label and no form `title` is headed by its object's label in the session's language. An authored view label or `title` still wins.
  - The internal form has a Cancel. It goes back to the page the form was opened from. With no such page (a cold link) it goes to the record being edited, else to the app's home, or to Home on the app-less route. The public `/f/:slug` form has no Cancel.
- 06ce712: Settings: a setting's `visible` predicate is evaluated with the renderer's expression interpreter, and a predicate that does not evaluate hides the setting.
  
  The settings page used to compile a manifest's `visible` string into a JavaScript function and show the setting whenever that failed. It now evaluates the string with `ExpressionEvaluator` from `@object-ui/core`, the CSP-safe interpreter every other `visible` predicate in the renderer uses, with the namespace's values bound as `data` (`${data.provider === 'cloudflare'}`). A predicate it cannot evaluate hides the setting, the same way the server refuses a save whose `visible` it cannot parse. Every predicate the shipped manifests declare (comparisons, `&&`, `||`, `!` over `data.<key>`) reads as before.
- @object-ui/sdui-parser@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- abd374b: The console's settings pages resolve icons through the shared `getLazyIcon` helper and no longer log `[lucide-react]: Name in Lucide DynamicIcon not found` (objectui#11679).
  
  - **Settings hub and namespace pages.** The settings hub, each settings namespace page and its action buttons used the console's own icon helper. That helper passed every name to lucide's `DynamicIcon` without checking that Lucide has it. Its tokeniser also turned `Building2`, the icon the framework's company settings declare, into `building2`, which is not a Lucide name. `DynamicIcon` then logged the error above on the settings hub and on the company page. It drew a bare fallback glyph that ignored the page's sizing classes. The pages now use `getLazyIcon` from `@object-ui/components`: `Building2` shows the building icon, and a name Lucide does not have shows the `Database` fallback at the page's size, with no console error. The console's own helper is removed.
  - **App shell icons.** App-shell's internal `getIcon` now re-exports `getLazyIcon` instead of keeping a copy. Its copy already checked the name before calling `DynamicIcon`, but used the same tokeniser, so a digit-suffixed Lucide name such as `Building2` showed the `Database` fallback in the sidebar, app switcher and other shell chrome. Those names now resolve to their own icons. A name that resolved before resolves to the same icon; `lazy-icon-digit-boundary-9414.test.ts` in `@object-ui/components` re-derives that against the installed Lucide on every run.
  
  No export is added to or removed from either package's entry.
- 9fc68aa: Screen readers can name and reach the controls of the view tab bar, the settings form, the sidebar menus, the table's selection column and the percent cell (objectui#11690). axe-core (wcag2a + wcag2aa) on an object list page and on a Setup settings page reported the faults below; each is fixed where it is produced and pinned by an axe run on that component.
  
  - **View tab bar (`ViewTabBar`).** The "+" add-view button is named, through the existing `view.addView` key, and its tooltip reads the same translated words instead of a hard-coded "Add View". Each view is now a `<button>`; the current one carries `aria-current="true"`. The views were `role="tab"` elements with no `tablist`, and the active view's actions button sat inside its tab, so it was a control inside a control. That button is now the view button's sibling, still named "View actions for …" and still one Tab stop away. Tab roles could not hold it: a tab's content is presentational and a tablist may contain only tabs. These views never had the tabs keyboard model (arrow keys, a tab panel) either. Every view stays its own Tab stop. When the bar is not reorderable, as the console renders it, Enter or Space switches to the focused view. With drag-to-reorder on, Enter or Space on a view starts a keyboard drag instead, as it did before this change, so a view is switched to by click. The rename box is now outside the view button and is named through `view.rename`. With drag-to-reorder on, the sortable attributes describe the view as a button. Breaking for anything that queried the bar by `role="tab"` or `aria-selected`: query `data-testid="view-tab-ID"` or `aria-current` instead.
  - **Settings form (`@object-ui/console`).** Each row's label is bound to its control, so text, number, password, textarea, JSON, colour, switch and select controls are named by it. Clicking a label now focuses or toggles its control. A radio group and a multiselect checkbox group are named by the row label too.
  - **Sidebar menus (`NavigationRenderer`).** With drag-to-reorder on (the desktop default), every row was wrapped in a `<div>` between the menu's `<ul>` and its `<li>`. The sortable node is now the row's own `<li>`. A separator and a nested group inside a menu are now list items too: the separator's item is hidden from assistive tech, and a top-level group is unchanged.
  - **Table selection column (`data-table`).** The select-all checkbox and each row's checkbox are named through the existing `table.selectAllRows` and `table.selectRow` keys.
  - **Percent cell (`PercentCellRenderer`).** The progress bar is named by the formatted value beside it (`aria-labelledby`), so the name is in the viewer's locale.
  
  No language-pack key, export or prop is added; every new name reads a key the packs already carried.
- daa7caf: The console's login and register pages offer a generic sign-up only where the server would accept one (objectui#11691). `/api/v1/auth/config` states the sign-up rule as two keys, `emailPassword.disableSignUp` and `features.audiencePosture`, and the server deliberately does not force the first from the second: under `invite_only` its sign-up route still admits a pending invitee. The pages read only `disableSignUp`, so under the default `invite_only` posture `/login` offered "Sign up" and `/register` refused the finished form with `SELF_REGISTRATION_CLOSED`.
  
  Both pages now read both keys:
  
  - `disableSignUp: true` still hides sign-up outright, invitation links included.
  - Under `open` or `email_domain`, nothing changes.
  - Under `invite_only`, `/login` shows no "Sign up" link. A visitor who arrived from an invitation (`?redirect=/accept-invitation/ID`, the signed-out bounce of the invitation page) still gets the link, and `/register` still renders the form for them. A deployment with no owner yet (`GET /api/v1/auth/bootstrap-status` answers `hasOwner: false`) keeps the link for its first owner, because the server admits the first account under every posture.
  - Otherwise `/register` says that self-registration is not open and points back to sign-in, before any field is filled in, instead of refusing the submitted form.
  - A server that sends no `audiencePosture` is answered as before, by `disableSignUp` alone. A posture value the console does not recognise reads as closed.
  
  **Clause-②: yes.** `@object-ui/auth`'s published `AuthPublicConfig.features` gains an optional `audiencePosture` member, typed as `@objectstack/spec`'s `AudiencePosture`. The package's `@objectstack/spec` range moves from `^17.0.0` to `^17.3.0`, the first release that declares that type. No export, prop or i18n key is added or removed: the register page's explanation reuses the existing `auth.register.errors.selfRegistrationClosed` sentence.
- d50f724: Dates and times render in the time zone the server answers for the signed-in workspace (objectui#11693).
  
  `GET /api/v1/auth/me/localization` answers `timezone` beside `currency` and `locale`, and the console kept only the other two. It now carries all three, and every date and datetime face built on the shared date-display functions of `@object-ui/core` (field cells, grid and card dates, gantt tooltips, dataset measures, data-table cells) renders an instant in that zone. A date-only value still names the day it stores, whatever the zone. With no zone, every face renders in the viewer's own zone, as before.
  
  The zone is whatever the endpoint answers. A server that answers a zone for a workspace that configured none (objectstack's localization cascade answers `UTC` in that case) moves that workspace's datetimes into that zone.
  
  - **`@object-ui/core`**: `setDisplayTimeZone(timeZone)`, `getDisplayTimeZone()` and `subscribeDisplayTimeZone(listener)` declare and read the zone the date faces render instants in. An IANA name the runtime's `Intl` does not know clears it, with a console warning, instead of making every face throw.
  - **`@object-ui/i18n`**: `LocalizationValue` gains `timezone`. `LocalizationProvider` hands it to the date faces, and `useLocalization().timezone` reads back the zone they render in.
  - Renderers that format dates with their own `Intl` options rather than through the shared functions do not take the zone yet.
- 3bf8894: The console asks an administrator once to set the workspace timezone while it is still the platform default, pre-filled with the browser's zone (objectui#11758, the gate the objectui#11693 ruling put on rendering instants in the workspace's zone).
  
  - **When it asks.** On opening an app, when `localization.timezone` resolves from the manifest default (no env, global or tenant value, and not locked), the session holds the localization manifest's `writePermission`, and the browser reports a zone the settings door admits: the manifest's declared `iana_time_zone` domain, judged by `isValueDomainMember` from `@objectstack/spec/shared`. A session that may not write settings is never asked, and reads nothing beyond the settings list.
  - **Once.** The prompt is recorded as shown, on this device, per administrator and per workspace, at the moment it opens. It does not ask again there, whatever the answer.
  - **Confirm** writes `localization.timezone` with the chosen zone through the Settings page's own save (`PUT /api/settings/localization`), so the same permission check and audit apply, and a refused zone shows in the field as it does on the Settings page. **Decline**, or closing the dialog, writes nothing.
  - The zone is edited in the Settings page's own timezone field: any IANA zone can be typed, with the curated zones as suggestions.
  
  New language-pack keys in `@object-ui/i18n`, in all ten packs: `console.workspaceTimezonePrompt.title`, `.description` (interpolates `{{current}}`), `.laterHint`, `.decline`, `.confirm` and `.saved` (interpolates `{{zone}}`). No export, prop or type member is added.
- c5406c2: The console and the runner bundles are built against `@objectstack/*` 18.0.0-next.0 (objectui#12030), and 18.0.0-next.1 since objectui#12370. In both, the `@objectstack/*` ranges are `devDependencies`, but each package is an app build whose published `dist` bundles them, together with the `@object-ui/*` packages it compiles from source. So the shipped console and runner now carry the 18 prerelease line and the `@object-ui/*` changes that follow it.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- 8ed7e5a: The console's login page follows the approved "refined centred" artboard (objectui#12600).
  
  - **One accent.** The brand tile above the card and the soft glow behind it take the theme's `--primary`, the token the form's button and links already used, so the page no longer shows an indigo mark beside the console's own hue. The glow is `--primary` at 10 % in both themes.
  - **The depth layer shows.** The dot grid and the glow were painted beneath the page's own background and never appeared; the auth shell is now its own stacking context, so they render behind the card.
  - **One 400 px column:** brand mark, card, footer, 20 px apart. The card (`rounded-xl`, 1 px border, 28 px padding, 20 px at the bottom) carries the page's own header, "Welcome back" and one line "Sign in to continue your work", in place of the form's lock tile and two-line header.
  - **The dev-admin banner retires.** On a development instance whose `/auth/config` reports `devSeedAdmin`, the card's last row reads "Local development instance" with a chip, "Sign in as dev admin", that signs in with the reported credentials through the same `signIn` the form uses. The password is never rendered. The row has no dismiss button and stores nothing in `localStorage`.
  - **A footer** under the card: the locale switch, and privacy and terms links when the server's auth config serves `features.privacyUrl` / `features.termsUrl`. A URL that is neither `http(s)` nor a same-origin path renders no link.
  
  `?redirect=`, the SSO hand-off, the server-unreachable panel, the server-driven product name and logo, and the sign-up rule are unchanged.
- c41ce3f: Setup draws one page header on every page: the `sys_*` record lists, the metadata-type pages, the settings pages and the component pages.
  
  - **One header, a Setup posture.** Inside the Setup app the console page header (`ConsolePageHeader`) puts the description on its own line under the title: a 32px icon tile, an 18px title with the page's kind chip after it, a 13px muted description, Refresh as an icon button and the primary action at the right. The title sits at the same place on every Setup page. Outside Setup the header keeps its one row. `ConsolePageHeader` takes three new optional props: `badge` (the kind chip after the title), `breadcrumb` (leading crumbs on the description line) and `refresh` (`{ onRefresh, label, busy? }`, drawn as one icon button before `actions`).
  - **Metadata-type pages under Setup** (Positions, Capabilities, Permission Sets and their siblings) drop the "All Metadata Types" breadcrumb and the Items / Filtered tiles. The count reads "18 items" in the description, the source select is a filter chip, the table takes the record list's row height and sentence-case headers, and the source column shows plain text with its explanation in a tooltip instead of a chip on every row. The same page outside Setup (the metadata directory, Studio's "Open in Setup" target) is unchanged.
  - **Record lists under Setup** open without the `#` row numbers. `ListView` takes a new host prop for this, `defaultRowNumbers` (default `true`); it is not a view key.
  - **Settings pages** keep their form and take the same header. "All settings" is now the first crumb of the header's description line instead of a button at the top of the form.
  - **Component pages** — Packages, Packaged automation, Approvals Inbox, Audit Log Browser and App Marketplace — draw their title row through the same header, with Refresh as its icon button.
- f78efdd: List grids show the record a pointer field names, and the Approvals Inbox says who else is waiting (objectui#12608).
  
  - **Record names in place of record ids.** A `text` field that declares `referenceVia` holds the id of a record whose object the sibling column names on the same row, as `record_id` does on Approval Requests (`referenceVia: 'object_name'`) or `source_id` on activities. In a list grid such a column now shows the target object's icon and the record's name, linking to the record. The record id moves to the tooltip. The grid reads the records of one page with one request per target object, not one per row.
  - **Unavailable records say so.** When the record cannot be read (deleted, or outside what the viewer may read), the cell shows the object's label followed by "record unavailable", with the id in the tooltip, instead of the bare id.
  - **The empty Approvals Inbox names who else is waiting.** When nothing is waiting on the viewer but other requests are pending, the empty state adds one muted line: "N requests are waiting on other approvers · Browse all requests". The number comes from one count request and counts only requests the viewer can see; when it cannot be read, the line is not shown.
  
  New language-pack keys, in every shipped language: `grid.recordUnavailable` and the `approvalsInbox.waitingOnOthers` plural family.
- f62b6ff: Resolve `@objectstack/*` `18.0.0-next.2` (objectui#12626).
  
  The console and the runner bundle `18.0.0-next.2`. `@object-ui/types` and `@object-ui/app-shell` now declare `@objectstack/spec` `^18.0.0-next.2`; the other packages keep `^18.0.0-next.1`, which already admits it.
  
  **The record dialog opens bounded on desktop for every object.** A create, edit or child record dialog on an object with many fields used to open as a 95vw task canvas. `@objectstack/spec` `18.0.0-next.2` derives a bounded modal for it on desktop and keeps the full-screen sheet on a phone, and the console now takes that answer directly.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates a page through the spec's own page checks, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.2` refuses. Each was accepted before:
  
  - On a `kind: 'full'` page, a region whose `name` the page's `template` does not place (with the default template: anything but `header`, `sidebar`, `main`, `aside` and `footer`), and a second region for a slot another region already fills. The renderer stacked such a region under `main` at full width. Rename it to a slot the template places, or choose the `dashboard` template, which lays every other region out as a grid cell.
  - `isDefault: true` on a page whose `type` is its page kind (`record`, `home` or `utility`) unless it is a `record` page bound to an `object`. Delete the key; an app's landing page is its first navigation item.
- dcd1041: The console top bar is 48 px (`h-12`) in every frame, the height both approved console artboards draw (objectui#12639). It was 56 px (`h-14`).
  
  - **One height everywhere.** `AppShell`'s header (inside every app), Home, the organization list and an organization's pages, the full-page assistant at `/ai` and the `/studio` landing all draw the same bar, so it no longer changes height on the way from Home into an app or onto an organization page. Studio's package builder keeps its own header, which was already 48 px from `sm` up.
  - **The app sidebar follows the bar.** On desktop its column starts 48 px down and is the viewport's height less 48 px, so no gap opens between the bar and the sidebar.
  - **The bar's contents are unchanged.** Its controls (the product mark, the app pill, the preview chip, the search field, the bell, help and the avatar) are 32 px or shorter, so each keeps its size.
  
  No export, prop or type is added, removed or renamed. A host that renders `@object-ui/layout`'s `AppShell` gets the 48 px header too.
- 611566b: The console's form page (`FormPage`, the `/forms/:name` and public `/f/:slug` routes) reads a form view field's and section's visibility predicate from `visibleWhen` only (objectui#12654). `@objectstack/spec` 18 retires both `visibleOn` keys as `retiredKey` tombstones naming `visibleWhen` (objectstack#23543 F4).
  
  What a raw schema loses: a form view handed to this page without passing through the spec's parse, whose field or section carries only `visibleOn`, no longer hides that field or section; write `visibleWhen`. What is unaffected: form views served by an ObjectStack runtime, which already arrive with `visibleWhen` (the spec's parse fold through the 18 pre-releases, and spec 18's stored-row rehydration).
- 8296c6c: The audit log browser (`audit:log`) offers `sys_audit_log`'s list views as presets and links to the object list (objectui#12667, the objectui half of objectstack#23890).
  
  - **Presets.** A "Presets" row above the filters offers one button per list view the platform serves on `sys_audit_log` (plugin-audit's Writes, Auth, Record Views, Config, …), by its served label and in served order. The page reads them from the console's object metadata, the same read the object list's view switcher uses, and names none of them itself. Choosing a preset sends that view's own `filter`, lowered by `@object-ui/core`'s `toFilterNodeSafely` exactly as the object list lowers it, beside the bar's action, object, actor and date filters under one `and`. Choosing it again, or "Clear filters", removes it. Columns, sort and page size stay the browser's own.
  - **A view the browser cannot express is never approximated.** A view whose filter the lowering refuses, or one bound to another data source, is shown disabled with its reason on hover and a link to that view in the list. It never sends a filter.
  - **"Open as list".** The page header links to the `sys_audit_log` object list, on the active preset's own view (`…/sys_audit_log/view/KEY`) when one is chosen.
  
  The copy is English literals, as the rest of the page's copy is. No language-pack key, export or prop is added.
  
  Clause-②: no
- a2f38dd: A settings page's `info_banner` row speaks the session locale, draws a warning in amber, and renders its body as Markdown (objectui#12671, the objectui half of objectstack#23855).
  
  - The banner's title and body read the platform's `settings.NAMESPACE.banners.BANNER_ID` slot (`@objectstack/spec`, objectstack#23886): `title` translates the specifier's `label` and `text` its `bannerText`, keyed by the specifier's `id`, the same way a group's title reads `groups.GROUP_ID.title`. When the bundle has no entry, the manifest's own words still render. No other spelling of the slot is read.
  - `bannerSeverity: 'warning'` draws an amber callout with a warning icon. `error` stays the destructive callout, and `info`, `success` and an unset severity keep the neutral one.
  - `bannerText` renders as the Markdown body the spec declares, through the docs portal's Markdown renderer and its sanitizer, so inline code, emphasis and links draw as such instead of as their source characters. The renderer loads on first use, so it adds nothing to the console's first page load.
- 26323c4: Resolve `@objectstack/*` `18.0.0-next.3` (objectui#12873).
  
  The console and the runner bundle `18.0.0-next.3`. Every package keeps its `@objectstack/*` range (`^18.0.0-next.1`, or `^18.0.0-next.2` for `@object-ui/types` and `@object-ui/components`), which already admits it, except `@object-ui/app-shell` (objectui#12943) and `@object-ui/plugin-detail` (objectui#12946), which declare `^18.0.0-next.3`.
  
  **An accept set that narrows with it.** `@object-ui/types` validates a `page:header` node's `properties` through the spec's own `page:header` row, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse `showStar`, which `18.0.0-next.3` retires: the follow star it switched on is not drawn by any renderer. It was accepted before. Delete the key.
  
  **A type that widens with it.** `SelectOptionBase`, and the field and form option types built on it, take the spec's select option by reference, so they now carry its optional `kind` (`'open' | 'won' | 'lost'`), the lifecycle category `18.0.0-next.3` adds. The spec takes it on a single-value `select` or `radio` field's options and requires it on every option of the field an object's `stageField` names.
- 8aa8e3e: Build `@objectstack/*` from objectstack `main` `f4755a68a7` (objectui#12971).
  
  `.objectstack-sha` moves from `2c9bf9430a`, the commit `@objectstack/spec` `18.0.0-next.3` was released from, to `f4755a68a7`, a commit on objectstack `main` after the `18.0.0-next.5` release, so its packages read `18.0.0-next.5`. The console and the runner bundle `@objectstack/*` built from it. No package's `@objectstack/*` range changes.
  
  Clause-②: yes (narrowing)
  
  The pin moves `@object-ui/types`' accept sets both ways: keys the spec added arrive by reference and widen them, and checks the spec added narrow them. Both are listed below.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates a page through the spec's own page checks, so `safeValidateSchema`, `StrictAnyComponentSchema` and `objectui validate` now refuse:
  
  - A region named `main` with `width: 'small'`, `'medium'` or `'large'`, on a `page` node and on a page-kind node (`type: 'record'`, `'home'` or `'utility'`). FROM accepted on both faces TO refused at the region's `width`, with the spec's message (`checkPageMainRegionWidth`), which opens: "Region `main` is refused with `width: 'large'` (since @objectstack/spec 18): a `main` region takes only `width: 'full'`." No layout reads those three values on `main`; the template decides its width. Delete `width` to keep the page as it renders, or write `width: 'full'` for a full-bleed page. Other regions keep all four values.
  - A `record` binding on a page-kind node. FROM kept unvalidated by `safeValidateSchema` and refused as an undeclared key by `StrictAnyComponentSchema` TO refused on both at `record`, with the spec's message (`checkPageRecordBindingPlacement`), for example on a `home` page: "`record` binds the row of an `app` page, and this page is `type: 'home'`, which has no row to bind. Delete `record`, or make the page `type: 'app'`." The check reads the page kind from `type`, so it does not judge a `page` node, whose kind is `pageType`.
  
  **A published input that leaves.** `action:button` and `action:icon` no longer publish a `patch` input. FROM published TO absent: the spec retired a page action row's own `patch`. A row's `operation: 'update'` runs the declared action its `name` names, and the platform action route writes that action's `patch`. The `operation` input's description now says so.
  
  **Accept sets that widen with it.** Three keys the spec added are taken by reference, so `StrictAnyComponentSchema` and `objectui validate` now accept them where they refused them as undeclared. Their renderer halves are separate work:
  
  - `emptyState` on `record:details`, `record:highlights` and `record:quick_actions`.
  - `record` on a `page` node.
  - `dataSource` on a navigation entry, every member but a separator. `NavigationItemSchema` and the `NavigationItem` type take the spec's `ElementApiDataSourceSchema` by reference; before, `NavigationItemSchema` stripped the key. The spec describes it as planned, and the console does not read it yet.
  
  **A palette exclusion that goes.** `record:json` is retired in the spec and is no longer a page component type, so the page designer's palette drops its exclusion entry. Nothing the palette offers changes.
- 8cc7158: A `position` decision output lists the position registry and commits position names (objectui#7611, objectstack ADR-0131 D3/D4).
  
  - **What the approver sees.** In the Approve and Reject dialogs (the Approval Center and the record page both decide through `DeclaredActionsBar`), a `position` output is a select over the `position` items the registry serves, read through the console's metadata store (`ensureType('position')`), the same reader the sharing-rule recipient picker lists positions through. Each option is labelled by the position's `label`, else its name, and the list is sorted by name. It used to be a `sys_position` lookup, which offered nothing on a database without `sys_position` rows.
  - **What the flow receives.** The decide body carries the picked positions' machine names (an array when the output is `multiple`). That is what the spec says the output collects (objectstack#22710), and what the engine's `resolveAs: 'position'` matches against `sys_user_position.position`. The lookup committed `sys_position` row ids instead.
  - **Without a metadata store.** A surface rendered outside a `<MetadataProvider>` has no registry reader, so a `position` output there is the free-text box an untyped output gets, the same fallback the recipient picker takes. An empty registry is not that case: it renders the select with no options.
  - `department` and `team` outputs are unchanged: they are still record lookups and commit record ids.
- 0df67f2: The Setup catalog for positions and permission sets reads the registry. It is built from the metadata-admin list and editors in their environment scope, not from new pages (objectui#7611, objectstack ADR-0131 D3/D7).
  
  - **The environment scope (`?scope=environment`).** `…/metadata/position` and `…/metadata/permission` with this parameter list every item the registry serves for the type, including the platform's own sets. Without it, the list shows one project package's items, as Studio does. Every link the pages emit keeps the scope: the item links, the create link and the editor's breadcrumb. `ENVIRONMENT_SCOPE_QUERY` is exported for hosts that route their own URLs onto it.
  - **Gated for Setup.** A caller without `manage_metadata` gets no create affordance on the list and a read-only editor, and the page says why. Under `single`, the reason is that the platform administrator defines these items and the caller's organization assigns them. Under a wall, it is that the operator defines them for every organization. The generic editor and the permission-set editor now apply this caller gate wherever they render. The metadata door refuses that caller's save anyway; this states the refusal before the click.
  - **The active switch.** The catalog list has an active column and an active/inactive filter. Both show the activation ledger's state (`sys_metadata_activation`), which is what the authorization resolver reads; an item with no ledger row is active. The switch writes through the ledger's door, `POST /api/v1/security/_activation/:type/:name` with `{ enabled }`, so switching a set or a position off takes it away from its holders, and switching it on gives it back. It reads and writes no catalog row, so the catalog row's own `active` column is neither shown nor changed. The door's refusals are shown in the server's own words. The audience anchors `everyone` and `guest`, which the door refuses to switch, show a disabled switch and the reason. The door is objectstack's ADR-0131 stage 2c.
  - **Holders.** In the environment scope, the permission-set editor shows who holds the set under its definition, and the position editor shows who holds the position. A set's holders are read by name: grants come from the `permission_set` column, and the positions that distribute the set come from the registry's position definitions (`permissionSets`). They are no longer read from `sys_position_permission_set` or `sys_position` rows, so on a framework from before objectstack's ADR-0131 stage 1, where positions declare no `permissionSets`, a set lists no holders through a position. A position is assigned by its name.
  - **The sharing-rule recipient picker lists the `position` registry** through the console's metadata store. It no longer reads `sys_position` rows. Without a metadata store mounted, the `position` kind falls back to the plain text input.
  - **The console's `system/roles`, `system/positions` and `system/permissions`** now go to the catalog list, not to the object pages.

### Patch Changes

- 39a3e91: The screen-flow runner names the flow by its label, in the user's language (objectui#11092, the objectui half of objectstack#20318).
  
  Since `@objectstack/spec` 17.6.0 every answer that evaluated a flow carries the flow's authored label as `AutomationResult.flowLabel` (objectstack#20633). `FlowRunner` now resolves the flow's display name in this order: the active language's `flows.FLOW.label` from the app's translation bundle, then the served `flowLabel`, then the flow's API name. The bundle is the one the runner already reads for screen headings and field copy, and the lookup is the spec's own `translateFlow`.
  
  Where it shows:
  
  - **The runner header.** A line above the screen's heading names the flow. The heading is still the step's own title (or the `flowRunner.title` fallback), and it is still the dialog's accessible name.
  - **The completion toast.** `Flow "{{flow}}" completed` names the flow by the resolved label instead of its API name. A flow's own `successMessage` still takes precedence. The message key and its translations are unchanged.
  
  All three places that open the runner pass the label through: a flow action on a list or toolbar, a flow action on a record page, and the developer Flow Runs page's Test Run panel. A resume answer that pauses on a further screen carries the label forward.
  
  Against a server older than objectstack#20633 no label is served, so the header line and the toast show the flow's API name, unless the app's bundle translates `flows.FLOW.label` for the active language.
  
  **Clause-②: yes (widening).** The exported `ScreenFlowState` type gains one optional member, `flowLabel`, typed by the contract as `Pick` of `AutomationResult`'s `flowLabel` (an optional string). `FlowRunnerProps.state` accepts it through that type. No prop, export or i18n key is added or removed, and no existing member changes type.
- 7c9a6b1: The docs portal's book sidebar now shows what the book resolver answers, with nothing narrowing the docs in front of it (objectui#11340, ADR-0046 §6.4). The resolver decides book membership. Since objectstack#20980 (`@objectstack/spec` 17.6.0), the framework's `resolveBookTree` keeps a doc in a book's synthetic Uncategorized group only when the doc belongs to one of the book's packages: the book's own, or a group's `package`. The console's port of that resolver now scopes its Uncategorized group the same way. The console's pre-filter, which dropped other packages' docs before resolving, is gone.
  
  What a reader sees:
  
  - **Unchanged: another package's ungrouped doc** stays out of a book's Uncategorized group, and the book's own ungrouped docs stay in it.
  - **Unchanged: a group's `package` (corner 1).** That package's unplaced docs are listed under the book's Uncategorized group, as the resolver answers. The portal already listed them, because the pre-filter kept every package the book draws from.
  - **Changed: a doc of another package pinned by a group's `pages` (corner 2)** is still listed where the pin places it, and now under its own label. Before, the pre-filter had dropped the doc, so the entry showed the doc's bare name.
  - **Changed: a book with no package of its own whose group names a `package`.** The groups that name no package now match docs from every package by `include`, as the resolver answers. Before, they matched only the docs of the packages the groups name.
  - **Changed: a doc of another package whose `group` names a `pages` group with no `...`.** It is no longer listed under the book's Uncategorized group. That group collects no doc by its key, and the resolver keeps another package's unplaced doc out of Uncategorized.
  
  The book cards' doc counts and the book a doc opens in follow the same answer. Nothing else changes: no export, prop, type member or i18n key is added or removed.
- 6a09fdd: The developer Public Forms page lists a form as published exactly when the server's anonymous form routes serve it (objectui#11545).
  
  The routes serve a form only when its `sharing` declares `enabled: true`, `allowAnonymous: true` and a `publicLink` slug. The page used to decide on `allowAnonymous` and a link alone, so a form withdrawn by clearing `enabled`, which the routes answer with a 404, still showed as published. It now asks `anonymousFormIntakeCandidates` from `@objectstack/spec/ui`, the same function `@objectstack/metadata-core` hands those routes, of each item `GET /meta/view` serves.
  
  - **The page reads the shape the server serves.** That list carries `ViewItem`s with the form under `config`. The page looked for the form at the item's top level, so on a real server it listed no public form, and offered nothing to publish. A fully opted-in form, such as the showcase app's contact form, is now listed under the slug the routes answer.
  - **Publish and Edit write the form's `config`.** Both dialogs wrote `sharing`, and Edit also wrote `submitBehavior`, at the item's top level. `ViewItemSchema` refuses both keys there, and `ViewMetadataSchema`, which the save path parses a `view` body with, drops them, so a publish could save without opening the form. Both keys are now written under `config`, and the Edit dialog reads the stored post-submit behaviour from there.
  - **What the page still cannot see.** The routes also refuse a form that another metadata layer withdraws, and one whose bound object cannot take an anonymous submission on this deployment's tenancy posture. The list read carries neither, so such a form is listed while the routes answer it 404.
  
  **Clause-②: no.** The page is internal to `@object-ui/console`. No export, prop or language-pack key is added or removed.
- 8057a8b: The console's `/verify-email?token=…` page verifies the address again (objectui#11633). It used to send the token as `POST /api/v1/auth/verify-email` with a JSON body. better-auth serves that route as GET only, so the server answered 404. Every valid token then showed "Verification failed: 404", and the account stayed unverified.
  
  The page now calls `GET /api/v1/auth/verify-email?token=…`, the route the server already serves and the one the mailed link targets. It sends no `callbackURL`, so the route answers JSON instead of redirecting. The page shows the success state only for that JSON receipt (`{ status: true }`), which the route also returns when the address is already verified. A garbage or expired token gets a 401 from the server, and the page shows the error state with the server's reason. A 2xx that is not the receipt, such as an HTML page, also shows the error state. The page's states, copy and links are unchanged.
  
  **Clause-②: no.** Nothing on any package entry changes. No export, prop, type member or i18n key is added or removed.
- 77c12b9: The console's share-link landing page (`/s/TOKEN`) sends a link's password in a request header, and a link that needs sign-in shows the sign-in path (objectui#11649).
  
  - **The password leaves the URL.** The page used to send the password as a `?password=` query parameter on `GET /api/v1/share-links/TOKEN/resolve`. It now sends it in the `X-Share-Password` request header, the name the server reads, and never in a request URL, so it no longer ends up in a server, proxy or CDN log that records request URLs. The conversation `/messages` request sends the same header. That route checks the password too, so a password-protected shared conversation used to show "This conversation has no messages yet." It now shows its messages.
  - **A sign-in-required link shows the sign-in path.** The server refuses with `401` for three different reasons, and the page used to show a password prompt for all of them. It now reads the response's `error.code`. `NEEDS_PASSWORD` shows the prompt and `WRONG_PASSWORD` shows it with "Wrong password.". `SIGN_IN_REQUIRED`, a link shared with signed-in users only, shows "Sign in required" and a "Sign in" button that opens `/login?redirect=` back to the link, with no password field. A `401` with any other code shows the server's message.
  - **A password a header cannot carry is not sent.** A header value cannot hold a character above U+00FF, such as a Chinese character or an emoji, and the browser refuses to send it. The page does not send such a password and does not fall back to the URL. The prompt says that the password cannot be sent and asks the visitor to get a different password from the link's owner. Until the server defines an encoding for this header, a link whose password has such a character cannot be opened from the console.
  
  **Clause-②: no.** No export, prop, type member or i18n key is added or removed. The page's labels stay English literals.
- 3409fe8: The approvals inbox's request drawer shows its record summary the way the record page shows the record (objectui#11677).
  
  The summary card now reads the field declarations of the request's object. It asks the same cached metadata read the drawer already makes for `hidden: true`, so no network request is added. With those declarations:
  
  - **Labels.** Each row takes its field's declared label, translated as the record page translates it, instead of the server's snapshot label or a title-cased key.
  - **Values.** Each value is drawn by the record page's own cell for its field type. An option shows its label (`Sent`, `EMEA` instead of `sent`, `emea`), a date shows as the date cell shows it, and a currency field shows in its currency. A lookup still shows the record title the server resolved. The lead amount at the top of the card follows the same rule. A `summary` roll-up shows as the record page shows it: the plain stored number, without digit grouping.
  - **Rows.** A snapshot key the object does not declare gets no row. Neither does a reference the server could not resolve to a title, because its value is an id.
  
  If the object's metadata cannot be read, the card renders the snapshot as before.
  
  Two rows never share a label. The card now drops the platform's injected ownership column `owner_id` (label "Owner") as bookkeeping, the same way the default list columns do, so an object that also declares its own `owner` field no longer shows two "Owner" rows. If two remaining fields still share a label, each of those rows adds its field key in parentheses. The rows are keyed by field key rather than by label, so React no longer warns about two children with the same key.
- a526249: The console's Audit Log page now names who made each change, and its actor filter picks a user instead of taking a typed id (objectui#11701).
  
  - **Actor column.** The page's `/api/v1/data/sys_audit_log` read now asks for `$expand=user_id`. `user_id` is the log's lookup to `sys_user`, so the server returns each actor's user record in place of the id, in the same request. The column shows the user's name, and hovering over it shows the user id. When the server cannot resolve the user, because the user was deleted or the viewer may not read them, it returns the bare id, and the column shows that id. A change with no user, where `user_id` is empty, reads "System". Hovering over it shows the recorded service principal (`svc:NAME`), if there is one.
  - **Detail drawer.** The Actor row shows the user's name with the full user id below it. A change with no user shows "System" and the principal.
  - **Actor filter.** The free-text "user id" box is now the `sys_user` lookup from `@object-ui/fields`, the same picker a lookup field to users gets. It lists users by name, and choosing one filters the log by that user's id. Removing the chosen user, or using "Clear filters", removes the filter.
  
  **Clause-②: no.** No export, prop, type member or i18n key is added or removed. The page's own labels stay English literals. The lookup uses its existing translated strings.
- 0cfe772: The Developer API console no longer lists the three retired ambient-assistant routes as try-it rows (objectui#11704). `GET /api/v1/ai/assistant`, `GET /api/v1/ai/assistant/skills` and `POST /api/v1/ai/assistant/chat` were retired on the server (objectstack-ai/cloud#2621), where they now answer 404 like a path that was never mounted, so each row was a try-it button that could only fail. The AI group keeps `POST /api/v1/ai/agents/:agentName/chat`, the named-agent route, as the one chat door.
  
  A console opened against a server that still carries the routes no longer offers them either. Nothing else on the page changes.
  
  **Clause-②: no.** Nothing on any package entry changes. No export, prop, type member or i18n key is added or removed.
- c0862c1: objectui now resolves `@objectstack/*` 17.7.0 (objectui#11717). Two declared `@objectstack/spec` floors move, each because the package's published code now imports something an older release does not export:
  
  - `@object-ui/types`: `^17.6.0` to `^17.7.0`. Its zod mirrors chain `checkDashboardWidgetChartMeasureArity` and `checkPageRequiresKind`, which the spec first exports in 17.7.0.
  - `@object-ui/plugin-dashboard`: `^17.5.0` to `^17.6.0`. `DatasetWidget` reads `DASHBOARD_WIDGET_MULTI_MEASURE_TYPES`, which the spec first exports in 17.6.0, instead of restating it. What the widget draws does not change.
  
  No other declared range moves.
  
  - `@object-ui/console`: the bundle inlines the 17.7.0 packages, so its client-side validation answers as a 17.7.0 server does, refusals included. The first screen is heavier: the eager closure grows by 183,008 gzipped bytes against a `main` build, nearly all of it in the `vendor-objectstack` chunk, and the bundle budget is re-pinned over the new reading on a maintainer ruling. It comes down again by whatever objectstack#22044 recovers.
- 9990f9e: The developer Public Forms page offers each public form's real anonymous URL (objectui#11769).
  
  The page built the link, the copied URL, the iframe snippet and the React snippet as `ORIGIN/console/f/SLUG`, and printed `/console/f/` beside both slug fields. No host serves the console at `/console/`: the framework CLI and cloud mount it at `/_console/`, and a framework-served console answers `/console/f/SLUG` with a 404. The page now asks the console router where its anonymous route `/f/:slug` is served, so it offers `ORIGIN/_console/f/SLUG` under a `/_console` mount and `ORIGIN/f/SLUG` on a root-mounted console. The link, the copied URL, both snippets and both slug-field prefixes show the same address.
  
  Nothing is added to the package entry: no export, prop, type member or language-pack key.
- 5d69133: The console's first page load no longer downloads the Studio builder or the chart engine (objectui#11798).
  
  - **Studio loads with its route.** `StudioDesignSurface` and `BuilderLanding`, and the modules only they use (the pillar panels and the form designer), were in the bundle every console page fetched before it rendered, for every user, including the many who can never enter Studio. They now load when a Studio screen is first opened: the `/studio` routes and the `studio:builder` app component both reach them through a console-local module that nothing imports statically. The Studio entry gate is unchanged and still decides first, so a principal without `studio.access` never downloads the builder. While the builder loads, the full-screen pillar builder shows the console's loading splash, and the `/studio` landing and the `studio:builder` entry show a loading line inside their frame, announced to assistive technology as a status.
  - **Charts load with the first chart.** Recharts and d3 were already imported only on demand, but the console's `vendor-charts` chunk group also claimed their dependencies, among them `use-sync-external-store`, a small React shim that the translation runtime imports on every page. That one shared module made the whole chart engine part of the first page load. The `vendor-react` group now owns the shim, so the chart chunk holds nothing the first page needs and loads when the first chart renders.
  
  The flow designer's canvas is unchanged here: `@object-ui/app-shell` registers its metadata designers, the flow canvas among them, when the package loads, so the console cannot defer it.
  
  Nothing is added to or removed from any package entry, and no route, registry key or translation key changes.
- d33270a: zh-CN Studio names a pillar by the label its tab shows, and the settings label lookups stop logging missing-translation warnings for text they fall back from by design (objectui#11801).
  
  - **Studio, zh-CN.** Two hints called a Studio pillar 支柱, a literal rendering of the code word "pillar" that no tab shows, and left the pillar's name in English: the navigation-item inspector's "no objects yet" line and the Interfaces pillar's hint under an object's runtime preview. Both now name the pillar by its tab label, 「数据」. The second hint took the word "Data" from a literal in the component rather than from the string table, so it read English in every language; it now reads the tab label, and en-US shows the same text as before.
  - **Console settings.** `useSettingsLabel` finds a setting's translated label, help line and option labels by probing a convention key in each top-level translation namespace that has a `settings` member, and shows the manifest's own text when the probe misses. Every miss went through `t()`, so a development build logged one "Missing translation" warning per probe, most visibly for the timezone field of the workspace-timezone prompt an administrator sees at an app's first open. The lookup now asks i18next whether the key exists before translating it, which logs nothing. What the prompt and the Settings page show is unchanged.
  
  Nothing is added to a package entry: no export, prop, type member or language-pack key.
- 09821b1: The login and register pages say when the server cannot be reached, and offer sign-up only once the server has said whether it accepts sign-ups (objectui#11806). This applies to the console's own `/login` and `/register`, and to `DefaultLoginPage` and `DefaultRegisterPage`.
  
  All four pages read `/api/v1/auth/config` to decide what a visitor is offered. They treated a failed read like a server that sends no config, and `decideSignUpOffer` answers that as "offer it". The login pages also held the config as `null` while the read was pending. So with the server down, `/login` drew a normal-looking form and offered "Sign up", `/register` drew the full registration form, and the visitor found out only when they submitted.
  
  **Behaviour change.**
  - While the config read is pending, the login pages show their form behind its own spinner, with no "Sign up" link. The register pages show no form, as before.
  - When the read fails, every page shows "Cannot connect to server", the hint to check the network or the backend, and a Retry button, in place of the form. The auth client has already retried the read itself by then. Nothing is offered.
  - Retry reads the config again. While that read is in flight the button reads "Retrying…" and the form stays hidden. When the server answers, the page shows what that answer decides, exactly as before: the form, the "Sign up" link, the by-invitation notice, or, on `/register`, the bounce to `/login`.
  - When the server answers the first read, nothing changes.
  
  `packages/app-shell/README.md` documents the two new states in its sign-up table. Its `useSignUpOffer` recipe for hosts now asks `decideSignUpOffer` only once the read has answered, and answers `unreachable` for a failed read.
  
  **Clause-②: no.** No export of the package entry, prop, type member or accepted value changes. `decideSignUpOffer` and its answers are unchanged: the pages consult it only once the read has answered. The text comes from existing `en` keys: `console.error.connectionFailed`, `console.error.checkServer`, `console.actions.retry` and `console.actions.retrying`.
- bf376c5: The approvals inbox's record summary honours a declared deadline's `settledWhen` (objectui#11815), judged against the submitted snapshot it shows: a done record's past due date reads neutral, an open one's reads overdue.
- 7afcea0: The console's first page load no longer downloads the documentation reader's markdown extras (objectui#11854).
  
  The console's `vendor-markdown` chunk is part of every first page load, because the chat message renderer uses most of the markdown pipeline. The chunk also held the parts only the `markdown` component and the package documentation reader use: code highlighting (`rehype-highlight` with `lowlight` and `highlight.js`), heading anchors (`rehype-slug`, `rehype-autolink-headings`, `github-slugger`), GitHub-style alerts (`remark-github-blockquote-alert`) and their helpers. Every first page load downloaded them, for every user. They now load with `@object-ui/plugin-markdown`, the first time a page renders a `markdown` component or a documentation page. `react-markdown` moves to a small chunk of its own, which the first load still fetches because a lazily rendered markdown field shares a chunk with eagerly loaded components.
  
  What renders is unchanged: chat replies, `markdown` components, markdown fields and documentation pages render as before. Nothing is added to or removed from any package entry, and no route, registry key or translation key changes.
- 7ebff39: The Studio landing (`/studio`) gets the console's own header (objectui#11863). Its old header held one control, the product wordmark linking back to Home. It now mounts `AppHeader` with `variant="studio"`: the brand logo, then a fixed "Studio" crumb, then the header's right-hand cluster as on Home and the Workspaces page (the inbox, help, and the account menu with profile, theme, language and sign-out). The brand links to the declared landing (`useHomePath()`), as the wordmark did, so the landing and the Studio builder's Home button still name one home. No command palette is mounted on `/studio`, so the header shows no search trigger there.
  
  **Note added 2026-10-09 (objectui#11863 Q2, PR objectui#12044):** the last sentence above no longer holds. From objectui#11863 Q2 the landing mounts the command palette in its `studio` scope, so the header draws the search trigger and `⌘K` opens the palette; see `.changeset/11863-studio-search.md`.
  
  **Clause-②: yes (widening; and one narrowing in `@object-ui/i18n`).** `AppHeader`'s `variant` prop accepts a fourth member, `'studio'`, beside `'app'`, `'home'` and `'orgs'`. It draws the brand and a fixed crumb, as `'orgs'` does. The union is not exported by name (the package entry exports `AppHeader` only), so a host meets it as the prop's type: a host that switches exhaustively over that type must handle `'studio'`. A call that passes no `variant` resolves it as before (`'app'` with an `appName`, `'home'` without). No export is added or removed.
  
  `@object-ui/i18n`: each of the ten packs gains `console.studio.title` ("Studio", a product name every pack writes as is), the crumb's label, and drops `console.studio.backToHome`, the retired wordmark's tooltip, which nothing reads any more.
  
  **Narrowed public surface (`@object-ui/i18n`).** The exported `en` pack and the `TranslationKeys` type derived from it lose one member, `console.studio.backToHome`. Code that reads `en.console.studio.backToHome`, or passes that key to `t()` expecting a translation, has to drop it. This is released as `minor` under objectui's version policy, which keeps the major aligned with `@objectstack`.
- 054fd84: The Studio landing (`/studio`) lists the packages the author was last in, above its package cards (objectui#11863). A visit to a package's pillar builder (`/studio/PKG/TAB`) is recorded as a recent `package` entry. Before this, a Studio visit recorded nothing: the route tracker reads `/apps/APP` routes only.
  
  The entry stores the package's identity and no display text, as objectui#11678 did for objects, dashboards, pages and reports: its `id` is `package:PKG`, its `name` the package id, and its `href` the bare `/studio/PKG` route, which opens the Data pillar. The landing labels each entry from the package list it loads, so a renamed package shows its new name, and a package the list no longer has shows its id, as a missing object does. Moving between pillars of one package leaves the list as it is, so nothing is written. The package-less scope (`/studio/~org`) is not a package and records nothing. A principal the Studio entry gate refuses never reaches the builder, so records nothing.
  
  The app sidebar's Recent group and the metadata-admin app's home leave package entries out: neither loads the full package list, so they could only draw a package as its id. Home's Recently Accessed and the command palette's recent group already list other kinds only.
  
  **Clause-②: yes (widening).** The exported `RecentItemType` union gains `'package'`, so `RecentNamedItem`'s `type` and `RecentItem` carry it too, and a host's exhaustive `switch` or `Record` over the union must handle it. `useRecentItemLabel` takes an optional argument, `{ packages }`: the package list (`id` and `name` per row) that labels a `package` entry. A call with no argument resolves every other kind as before and draws a package entry as its id. No export is added or removed. `@object-ui/i18n` gains one key in all ten packs, `home.recentApps.itemType.package`, the label of the new kind.
- 5275d1f: The Studio landing (`/studio`) gets search (objectui#11863). It mounts the command palette, so its header shows the "Search ⌘K" trigger and `Ctrl+K` / `⌘K` opens the palette. Until now only the frame inside an app mounted one, so the landing's header drew no trigger (objectui#11912's rule). The entry for the landing's new header says it shows no search trigger; with this change it does.
  
  On `/studio` no app is active, so the palette leaves out everything that belongs to an app: the app's objects, dashboards, pages and reports, record search, app switching, and the "Open Full Search Page" command, whose link starts with `/apps/APP` (mounted without an app it would have gone to `/apps/undefined/search`). It lists the Studio instead, in three groups:
  
  - **Packages**: the packages the Studio landing lists (kernel packages left out). Each opens its Data pillar, `/studio/PKG/data`.
  - **Objects**: the objects of those packages, each opened in its package's Data pillar on that object (`/studio/PKG/data?surface=object:NAME`).
  - **Flows**: the flows of those packages, each opened in its package's Automations pillar on that flow (`/studio/PKG/automations?surface=flow:NAME`), and the flows that belong to no package, opened in the package-less scope (`/studio/~org/automations?surface=flow:NAME`).
  
  An entry matches the query by its label or its machine name, as the palette's other entries do; an object or a packaged flow shows its package's name beside it. Nothing is read until the palette opens. Objects and flows are the published ones from the metadata cache, so an item that is still only a draft is not listed. The theme commands and the recently viewed records stay.
  
  **Clause-②: yes (widening).** `CommandPalette`'s props gain a second form, `scope="studio"`, which takes no other prop. The props a host passes inside an app (`apps`, `activeApp`, `objects`, `onAppChange`, `dataSource`) are unchanged and still required there; that form leaves `scope` out. The props type is not exported by name (the package entry exports `CommandPalette` only), so a host meets it as the component's props. No export is added or removed. `@object-ui/i18n` gains two keys in all ten packs, `console.commandPalette.packages` and `console.commandPalette.flows`, the headings of two of the new groups; the objects group reuses `console.commandPalette.objects`.
- 2855785: The console's Public Forms, Flow Runs and Profile pages pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the console pages' part of that card).
  
  Four pickers were browser-native selects, so they looked and behaved differently from the console's other dropdowns: on Public Forms, the FormView to publish and "After submit"; on Flow Runs, the flow to test; on Profile, the preferred language. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour.
  
  What they write is unchanged. Publishing saves the picked view as before, and "— Select a FormView —" still leaves nothing to publish. Each "After submit" option saves the same `submitBehavior` as before. The picked flow is still the one Run Flow executes and whose runs are listed. Each language saves the same `locale` as before, and "Use the deployment default" still saves `null`. Re-picking the current option writes nothing. Each picker keeps the accessible name it had: "FormView", "After submit" and "Preferred language" from their labels; the flow picker had no label and still has none. The language picker's read-only state is the shared control's disabled trigger.
  
  One display change: a value none of a picker's options carries now shows as itself. The native select showed its first option instead, which is not what the page holds: for example, a flow picked before a Refresh that no longer lists it.
  
  **Clause-②: no.** No published face moves: the console's package entry is unchanged, and no i18n key is added. What moves is these pages' own markup, described above.
- 869d0bf: The Create View dialog, the AI build panel's Excel import bar and the API console's method selector pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the shell and console single selects' part of that card).
  
  Three pickers were browser-native selects, so they looked and behaved differently from the console's other dropdowns: in the Create View dialog, each pick a view type asks for (kanban's group-by field, the date and title fields, the gallery cover, the map coordinates, the tree parent, and the chart's type, dataset, measure and dimension); in the Excel import bar, the object to import into; in the API console, the HTTP method. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour.
  
  What they write is unchanged. Every Create View pick hands the dialog's caller the same view config as before, and the "select a field" option still clears the pick and leaves Create disabled; choosing another dataset still clears the measure and dimension picked from the previous one. Each object in the import bar still imports into that object. Each method still sends the same request, with the body only for POST, PATCH and PUT. Re-picking the current option writes nothing. Each picker keeps the accessible name it had: the Create View picks from their labels, still marked required; the import bar's object picker and the API console's method selector had no label and still have none. A Create View pick with nothing to offer yet, and the import bar with no object to list, are the shared control's disabled trigger.
  
  One display change: a value none of a picker's options carries now shows as itself. The native select showed its first option, or nothing, instead, which is not what the page holds: a Create View pick of a field the object no longer has (Create still writes it), or an import bar opened on an object its list does not return (Import still loads into it).
  
  **Clause-②: no.** No published face moves: neither package's entry or exports change, and no i18n key is added. What moves is these components' own markup, described above.
- 0855fc6: The profile page states the access the console resolves, not the auth library's raw `user.role` (objectui#11866).
  
  The badge under the name and the read-only *Role* field used to show `user.role`, falling back to `member`. That field is better-auth's own scalar, which the server no longer overwrites: a platform administrator's standing travels on the session as `isPlatformAdmin`, and `role` keeps better-auth's default. So the seeded administrator read as "user", in an untranslated machine word.
  
  Both now show the verdict every console gate already acts on, `useWorkspaceAdminStatus` from `@object-ui/auth`: *Admin* for an administrator of the workspace (a platform administrator, an organization owner or admin), *Member* otherwise. The words are the existing membership-role labels (`organization.roles.admin` and `organization.roles.member`), so they are translated in every built-in language pack. Until the verdict settles, the page shows neither the badge nor the field rather than a guess.
  
  This changes no access decision. No language-pack key, export or prop is added.
- 230e4b2: The Approvals Inbox no longer links to a record when the approver has no read of its object at all (objectui#11878, ruling C on objectstack-ai/objectstack#7497). Such an approver is routed requests as usual, but the server refuses every read of the object with `403 PERMISSION_DENIED`. The inbox's readability probe read that refusal as "unknown" and kept the link, which landed on the record page's "Record not found — … may have been deleted".
  
  The probe now reads a refused read (the `forbidden` kind of `classifyLoadError`: a 403, or the permission-denied envelope that comes with it) as "cannot read", exactly as it already reads an answer that leaves the record out of the approver's row set (objectui#5211). The record link is not rendered, on the row and in the request drawer. The refusal is about the object, not the record, so the missing link says nothing about whether the record exists.
  
  Nothing else changes:
  
  - **The request stays fully usable.** The row, the drawer with its snapshot, and approve and reject are unchanged, and the row still shows the record's title from the request's snapshot.
  - **Every other failure still keeps the link.** A transport error, a 5xx, a 401, an object whose API is disabled, a probe that has not answered yet and a page with no data source all keep today's link, so a transient error never hides a link someone could use.
  - **The cause-free label stays where it was.** "This record cannot be opened" (objectui#8631) still appears only for a title-less record the approver's row set leaves out. A refused title-less row keeps the reference text it showed before, now without the link.
  
  **Clause-②: no.** No export, prop, type member, accepted input or i18n key of any package changes. The change is internal to the console's approvals page.
- 5ab2f19: The record picker (`RecordPickerDialog`) is laid out from the design system's own primitives (objectui#11903). It is the dialog behind a multi-select lookup's "Browse all records", a related list's Add and a role's Assign user.
  
  - **Spacing.** The dialog keeps the standard spacing between its title, search, table and footer. The title no longer sits on the search box.
  - **Search.** The search box is the standard input with a leading icon: one border at rest, one focus ring.
  - **Selection.** In multi-select mode every row starts with a checkbox that shows whether it is picked, and the header checkbox picks or clears every row on the page. A row click, the arrow keys and Enter / Space toggle a row as before.
  - **Width.** The dialog is as wide as its columns need: a three-column picker is no longer stretched to the full large-screen width, which stays the ceiling for wide pickers.
  - **Footer.** The record count, the page controls, the selected count and the Cancel / Confirm buttons sit on one footer bar.
  - **Confirm.** Confirm is disabled while nothing is picked.
  - **No links in rows.** Email, URL, phone, file and reference values show as text inside the picker, so a click on a row always picks it instead of opening a mail client or another record.
  
  The console's dev-only preview gallery shows the picker in multi-select mode over three columns (`?only=record_picker`). Nothing is added to the package entry: no export, prop, type member or language-pack key.
- dfa15c8: A new workspace now takes its creator's browser timezone when it is created, so its first administrator is no longer asked for a zone the browser already knows (objectui#11908).
  
  `createOrganization` accepts an optional `timezone`, an IANA zone such as `Asia/Shanghai`, on both `AuthClient` and the `useAuth()` context. The client sends it as the `timezone` query parameter of `POST /organization/create`; the request body stays `{ name, slug }` (plus `logo` when given). When the zone is absent or empty, no parameter is sent and the server keeps its default zone. A server that does not read the parameter ignores it.
  
  The console's create-workspace dialog and the first-run setup page's create branch both pass the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`. A browser that reports no zone sends none. Existing workspaces are unchanged, and the one-time timezone prompt still asks about a workspace whose zone is still the default.
- 4babf40: The built-in metadata designers leave the console's first load: `@object-ui/app-shell` registers them from a chunk it loads on its own, once the package entry has run (objectui#11939, step 2 of objectui#6795).
  
  Every built-in Preview, scoped Inspector and default Inspector used to be registered while the package entry was being evaluated, so their code sat on every page's first load although only metadata authors render them. The entry now starts loading them with a dynamic `import()` at its own module scope and registers them when that chunk arrives. Importing the package still registers every built-in designer with no action from the host; they are available a moment later than before instead of during the import. The entry for step 1 (the observable designer registries) says every built-in designer is still registered when the package loads: that held at step 1, and this step replaces it.
  
  What a reader sees in that moment: a surface that renders before the chunk arrives shows its existing "designer missing" state, then the designer, with no reload. That is the observable registries of step 1 at work, through the `useRegistered*` hooks. A read with `getMetadataPreview`, `getMetadataInspector`, `listMetadataPreviewTypes` or `listMetadataInspectorTypes` returns what is registered at the moment of the call, so code that reads right after importing the package can find no built-in designer yet. During render, read through the hooks.
  
  A host's own designer is kept, whichever arrives first. The built-ins are registered only for a type that has no designer yet: a host that calls `registerMetadataPreview` or `registerMetadataInspector` right after importing the package keeps its component when the built-ins land later, and a host that registers after they landed replaces the built-in, as before.
  
  The three registrations whose registries are not observable stay where they were, during the entry's evaluation: the Related tab's anchors, the generic form's fallback schemas and the datasource resource.
  
  `sideEffects` in `@object-ui/app-shell`'s `package.json` is unchanged. The module that registers the designers performs no registration at load time: the entry calls the function it exports.
  
  No export is added, removed or changed. The console's dev-only designer gallery waits for the built-in designers to arrive before it renders its list, so it never lists zero designers.
- a835c31: The metadata designer registries are observable, so a designer registered after a surface rendered now appears in it (objectui#11939, step 1 of objectui#6795).
  
  The preview, scoped-inspector and default-inspector registries were plain maps read during render with no change notification. A surface that rendered before its designer was registered kept its fallback for good, whatever registered later. objectui#6795 measured this: "still fallback after registration: true | late inspector rendered: false". Each registry now notifies on every registration that changes an entry, and every surface that reads one during render re-renders when its entry arrives:
  
  - the metadata editor (`MetadataResourceEditPage`): its canvas, its scoped and default inspectors, and the switch into design mode for a type with a canvas;
  - the embedded item editor's preview;
  - the Studio pillars: the Interfaces canvas and inspector rail, the Data pillar's field rail, the Automations canvas and rail, and the designer-missing notices of those pillars;
  - the object Settings, Actions and Hooks panels;
  - the console's dev-only designer gallery.
  
  Today every built-in designer is still registered when `@object-ui/app-shell` loads, so nothing an author sees changes. This step is what lets a later change load the designers lazily without leaving those surfaces empty.
  
  **Clause-②: yes (widening).** The package entry gains three hooks:
  
  - `useRegisteredMetadataPreview(type: string): MetadataPreview | undefined`
  - `useRegisteredMetadataPreviewTypes(): readonly string[]`
  - `useRegisteredMetadataInspector(type: string): MetadataInspector | undefined`
  
  Each one reads its registry through React's `useSyncExternalStore` and re-renders the calling component when what it read changes. `useRegisteredMetadataPreviewTypes` returns a frozen, sorted array that stays the same array until a new type is registered. Use these hooks for reads during render. `getMetadataPreview`, `listMetadataPreviewTypes`, `getMetadataInspector` and `listMetadataInspectorTypes` are unchanged: same signatures, same results, and each `list*` call still returns a new array. They read the registry as it is at the moment of the call, so they stay the right read in event handlers and other code that does not render. `registerMetadataPreview` and `registerMetadataInspector` keep their signatures and their overwrite behaviour; registering a type again with the component it already holds notifies no one. No export is removed, and no existing export changes type.
- d99b731: Approval requests can now be read by the standard list and record views, and `ApiDataSource.findOne` now rejects a refused or failed read instead of reporting the record as missing (objectui#12032, A1 of objectui#2763).
  
  - **`ApiDataSource.findOne` resolves `null` only on a 404.** Every other failure (a 403, a 5xx, a transport error) now rejects, the way `ObjectStackAdapter.findOne` does. Before, any failure resolved `null`, so a record page over a `provider: 'api'` source showed a refused or failed read as "Record not found". It now shows "no access", or "could not load" with Retry (the record page states from objectui#11902).
  - **A console data source for approval requests.** `apps/console/src/services/approvalRequestsDataSource.ts` routes reads of `sys_approval_request` to the approvals routes through `ApiDataSource`, and everything else to the console's own adapter. Each source serves one server-side scope: awaiting me, submitted by me, or all. Rows come back as the approvals service serves them, so `viewer` and (on a single read) `decision_progress` are fields a view can bind. On a list read, `$top`, `$skip` and `$search` become the route's `limit`, `offset` and `q`, and `$select` is dropped. Every other parameter, such as a filter, a sort or an expansion, is refused with an `UNSUPPORTED_QUERY_PARAM` error, so the list shows its error panel and never shows unfiltered rows. Nothing mounts the source yet; the approvals list and detail pages that will use it come later.
  
  Nothing is added to any package entry: no export, prop, type member or language-pack key.
  
  **Superseded in part (objectui#12045):** the console now mounts this source on the `sys_approval_request` record route, so the sentence above saying nothing mounts it no longer holds when both changes release together.
  
  **Superseded again (objectui#12045, the page-mount step):** the console no longer declares a record route of its own for `sys_approval_request`. On every surface that opens a request, the console-wide `ApprovalRecordReads` layer sends the request's single read to `GET /approvals/requests/:id` and one request's timeline to `GET /approvals/requests/:id/actions`; lists of requests, and every other read, stay on the console's adapter, the data API.
- 47b1f0b: The console's sign-in page no longer reads `/api/v1/i18n`, and the application's translations and locale list load with the session's credentials once signed in (objectui#12034).
  
  The two loaders the console hands to `I18nProvider` used to run as soon as the page loaded, before the session was known, with a bare `fetch`. So the sign-in page read `/api/v1/i18n/translations/:locale` and `/api/v1/i18n/locales` as an anonymous caller, and a signed-in page load sent no bearer with them. Where no session cookie rides along (a console built with an absolute `VITE_SERVER_URL`), a framework that refuses an anonymous `/i18n` read (objectstack-ai/objectstack#22432) answers both with 401, and a signed-in user's application labels stay in the language they were authored in.
  
  - **Signed out:** neither loader sends a request. The sign-in page renders from the built-in language packs.
  - **Signed in:** both loaders wait for the console's `AuthProvider` to answer for the page load, then read through `withSettleSignal(createAuthenticatedFetch())`, the request path the data adapter uses (bearer, `X-Tenant-ID`, `Accept-Language`, and the in-flight count `window.__objectui` reports). Every console sign-in ends in a full-page navigation, so the page load after sign-in is the one that reads them.
  
  Nothing published changes: no export, prop or language-pack key is added, and `I18nProvider` is used through its existing `loadLanguage` and `loadLocales` props.
- 2571a3e: A caller without Studio access who opens a Studio URL (`/studio`, a package's pillar builder, or the package-less scope) is told why (objectui#12035). The console's Studio entry gate used to send such a caller home with no word of why, so a missing capability read exactly like a broken link. It now stays at the URL that was opened and shows one sentence, "You need Studio access to open Studio.", with a "Back to home" link drawn as a button. This is the shape the console already uses for an app the caller may not open. The link leads to the same home the redirect used to land on: the declared landing, or the launcher where none is declared. A reload or a shared link shows the same answer for the same caller, and the caller can send the URL to an administrator and reload once access is granted.
  
  Who may enter Studio is unchanged: the gate still requires `studio.access`, decides before the Studio builder is downloaded, and keeps its loading splash and its retryable error screen. A caller with access enters Studio as before.
  
  **Clause-②: yes (widening).** `@object-ui/i18n` gains one key in all ten packs, `console.studio.accessRequired`, the sentence above, so the exported `en` pack and the `TranslationKeys` type derived from it gain one member. No key is removed or renamed. The link reuses `empty.appAccessDeniedHome` for its label.
- a368ccb: A pointer field draws the record it points at, the console reads an approval request's record page through the approvals routes, and the approval decision panel is built for the request page (objectui#12045, B1 of objectui#2763).
  
  - **The approval decision panel (`@object-ui/app-shell`, module-internal).** One panel that draws the request's decision progress (`DecisionProgressIndicator`) above the request's own declared decision actions (`DeclaredActionsBar` at `record_section`, decided through `ActionParamDialog`). It reads the bound request and takes no authorable props; outside a `sys_approval_request` record page it renders nothing. After a decision it invalidates the request record and its timeline instead of remounting. It is not registered as a component type yet: the type `record:approval_decision` is proposed to the spec on objectstack-ai/objectstack#22472, and its registration lands with the spec row.
  - **`referenceVia` pointer pairs (`@object-ui/fields`).** `resolveRecordPointer(field, row)` returns the record a `text` field declaring `referenceVia` points at on one row (`{ objectName, recordId }`, the new `RecordPointer` type), and `RECORD_POINTER_CARD_TYPE` is the registry key a resolved pair is drawn with. The package's default under that key draws the record id as text, as the field drew before.
  - **The record details grid draws the pair (`@object-ui/plugin-detail`).** A field declaring `referenceVia` is resolved from the row and drawn with the pointer face; with `@object-ui/app-shell` loaded that face is the record preview card, so `sys_approval_request.record_id` and the other pointer fields show the record they point at. A pair whose row leaves either half blank draws the stored text.
  - **The console's approval request page.** The console's record route for `sys_approval_request` mounts the record page over the routed approvals source, so the request carries the `viewer` block its declared actions gate on and the decision tally. The source now reads one request's `sys_approval_action` timeline from `GET /approvals/requests/:id/actions`, applying the read's `$orderby`, `$top` and `$skip` itself, dropping `$select` and `$expand`, and refusing any other parameter with `UNSUPPORTED_QUERY_PARAM`. On a request's own page the record view no longer asks for approvals opened on the request itself.
  
  No language-pack key is added, and `CellRendererProps` is unchanged.
  
  **Superseded in part (objectui#12072):** outside a `sys_approval_request` record page the panel now draws a short localized notice instead of nothing, so the sentence above saying it renders nothing there no longer holds when both changes release together.
  
  **Corrected and superseded in part (objectui#12045, the page-mount step):** the last sentence of the console bullet, that a request's own page no longer asks for approvals opened on the request itself, is an `@object-ui/app-shell` change (the record view's approvals read), not a console one. And the console no longer declares a record route of its own for `sys_approval_request`: every surface that opens a request reads it through the console's adapter with the request's record reads routed, so the console bullet's first sentence describes the route that change replaces, when both release together.
- bedf41c: An approval request reads the same way on every console surface that opens it, and the Timeline tab of its served page shows its count (objectui#12045, the page-mount step of B1 in objectui#2763).
  
  - **One layer for every surface.** The console's `AppContent` wraps the shell's content in `ApprovalRecordReads`, which hands every surface below it the console's adapter with two reads routed: a `findOne` of `sys_approval_request` reads `GET /approvals/requests/:id` (with the `viewer` block and the decision tally), and one request's `sys_approval_action` timeline reads `GET /approvals/requests/:id/actions`. That covers the record route, an `ObjectView` drawer or split overlay, and the record views embedded in the object data page and in an interface list page. A list of requests, and every other read, stay on the data API. The console's own `sys_approval_request` record route is retired: the generic record route reads through this layer.
  - **The timeline's count and its label read.** A timeline read now honours `$count`, so the Timeline tab of the page objectstack serves for a request shows how many actions it has. The timeline's label read of its `request_id` column now reaches the data API instead of being refused by the approvals list.
  
  No language-pack key is added, and no `@object-ui/*` export, prop or option changes.
- 023f00d: A create form asks its fields the create question, so a role that may create
  records but not edit them can fill and submit the form (objectui#12082). Every
  console affordance that offers a write now reads the grant it exercises from
  one map.
  
  **The defect.** A create form gated each field on `checkField(object, field,
  'write')`, whose fallback for a field the permission set does not mention is
  the object's `allowEdit`. Under a grant of `allowCreate: true, allowEdit: false`
  every field of the create form rendered disabled, the outbound filter stripped
  every field from the body, and the save posted an empty record that the server
  refused for its required fields — while the server accepts the same create.
  
  **The server's insert rule, which the create question follows.** The server's
  field-level write step refuses a write that names a field whose explicit
  field-level entry has `editable: false`; a field with no entry passes it, and
  object admission decides the operation (`allowCreate` for an insert,
  `allowEdit` for an update). So a create-form field now reads its explicit entry
  when there is one and the object's create grant when there is none. A field the
  permission set marks `editable: false` stays disabled and out of the body.
  
  **Clause-②: yes (widening)**
  
  - `@object-ui/core` exports the affordance-to-grant map: `AFFORDANCE_GRANTS`
    (one row per affordance: the CRUD-affordance bit it needs, the object grant it
    exercises and, for an affordance that offers fields, the field question it
    asks), `resolveAffordance` (managed-object policy ∧ the server's effective API
    operation set ∧ the caller's grant, with the row's `userActions` predicates
    surfaced only when all three allow it), `resolveFieldAffordance`,
    `formFieldsAffordance`, and their types (`ConsoleAffordance`,
    `FieldAffordance`, `AffordanceGrant`, `FieldAffordanceGrant`,
    `AffordanceGrantRow`, `AffordanceGrantPrincipal`, `FieldAffordancePrincipal`,
    `AffordanceSource`, `AffordanceVerdict`).
  - `@object-ui/permissions`: `checkField`'s action accepts `'create'` beside
    `'read'` and `'write'`. `MePermissionsProvider` answers it from the explicit
    field entry when there is one and from `allowCreate` otherwise; the
    role-based `PermissionProvider` answers it as it answers `'write'`.
  
  **Behaviour, by package.** With no permission provider mounted every grant
  still reads open, as before.
  
  - `@object-ui/plugin-form`: every `ObjectForm` layout's fields and outbound
    filter ask the question of the form's mode (create or edit). The form-wide
    lock, with its "You don't have permission to …" notice, also engages when the
    caller's object grant for the form's mode is denied, not only when the
    managed-object policy or the effective API operation set closes it. A
    create-mode `MasterDetailForm`'s line cells ask the create question of the
    child object, since every line there is a new record.
  - `@object-ui/app-shell`: the record page's Edit and Delete (and the record
    body's in-place editing) read the caller's update / delete grant; they read
    none before. The import wizard's write targets ask the create question, so a
    caller offered Import keeps every field the insert accepts. List New / Import,
    the related lists and the Attachments panel read the map with the verdicts
    they had.
  - `@object-ui/fields`: a lookup's "Create new" reads the create grant (and the
    managed-object policy and operation set) of the object the field references;
    it read no grant before.
  - `@object-ui/plugin-grid`: row Edit / Delete, in-place editing, the template
    download and the add-record row read the map; the add-record row now also
    honours the object's managed-object policy and effective `create` operation.
  - `@object-ui/plugin-detail`: `record:details` in-place editing reads the
    caller's update grant; the detail header's object gate adds the effective
    operation set.
  - `@object-ui/plugin-list` and `@object-ui/console`: bulk Delete, the
    inline-edit toggle and the profile page's language field read the map with
    the verdicts they had.
- 5330038: Console rendering fixes from the HotCRM browser pass (objectui#12110):
  
  - **Grid:** a view column's authored `label` is the header. It used to lose to the field's translated label whenever the app bundle translated the field.
  - **Form:** a field `widget` that names no registered component falls back to the field type's renderer, as the spec's `widget` description says. A `rating` field declaring `widget: 'star_rating'` now draws the star widget instead of a text box. A built-in control name (`input`, `textarea`, …) and the native password and email inputs still render as before.
  - **Cells:** a `rating` value draws stars out of the field's `max` (5 by default) in list, detail and related-list cells, instead of a bare number.
  - **Reference rail:** a related row is named by its object's declared `nameField`, and the rail refetches in place when the record, a related object or everything is invalidated. A record action with `refreshAfter: true` therefore refreshes the rail too.
  - **Gantt:** the task list, the tooltip and the drag previews show a date's year when it is not the current year.
  - **Approvals drawer:** a `position:` approver shows the position's label, from the console's position registry, instead of a truncated id. The headline figure prefers the object's declared `currency` field and never shows a zero from a field matched only by its name.
  - **Public form:** a form with no title of its own is headed by its object's label, not the object's API name.
- e723f58: Screen readers hear the names of more controls in the viewer's language (objectui#12145).
  
  These controls carried an English `aria-label`, so under a non-English locale a screen reader announced their names in English: the docs portal's loading spinner, the record form page's breadcrumb, the `Spinner` status region, a data table's row menu button, the `pagination` renderer's previous and next links, the image crop preview, the percent slider, the record picker's grid, the AI composer's send and stop button and an attachment's remove button, the designer's undo and redo buttons, minimap, version history and back button, a dismissible record alert's close button, the bulk-action bar, and the mobile view switcher. Each name now comes from the language packs. English names are unchanged, with two small exceptions: the spinner now reads "Loading…", and the pagination links read "Previous page" and "Next page", the same words the data table pager uses. Sighted use is unchanged.
  
  Added: eight language-pack keys in all ten packs: `help.loadingDocumentation`, `common.breadcrumb`, `table.rowActions`, `fields.image.cropPreview`, `fields.percent.slider`, `designer.canvasMinimap`, `designer.versionHistory` and `grid.bulkActions`. Every other name reuses a key that already holds the same words. The exported `en` pack, and so `TranslationKeys`, gains these eight members. `PromptInputAttachment` (exported through `AIElements`) takes an optional `removeLabel` prop that names its remove button; without it the button keeps its English name.
- 08b5d97: The console builds again on a case-insensitive filesystem, which is macOS's default (objectui#12184). Two modules in the console's settings pages, the workspace-timezone prompt dialog and the logic behind it, had paths that differed only in case once the extension was dropped. TypeScript tries `.ts` before `.tsx`, so on such a filesystem the dialog's import resolved to the logic module and `tsc` failed. The logic module is now `workspaceTimezonePromptLogic.ts`. What the prompt does, and every i18n key it reads, stays as it was.
- 6eca5b5: A console page route stops loading the Studio's designers, the interface list and one file per icon before its content (objectui#12187).
  
  - **The built-in designers load when something reads them.** The package entry used to start loading every built-in Preview and Inspector, with the icons they draw, as soon as it was imported, so every console page fetched them before its content, on routes that never show a designer. The entry now hands that loader to the three designer registries, and the first read of any of them runs it: a reader hook (`useRegisteredMetadataPreview` and the rest) or a `getMetadata*` / `listMetadata*` call. Importing the entry still registers every built-in designer with no call from the host; a reader that renders first shows its "designer missing" state and then the designer, as it did while the chunk was loading. A host that reads the registries imperatively sees the built-ins from the read after the one that started the load, once the chunk has arrived.
  - **`PageView` loads `InterfaceListPage` only for an interface page.** The list is drawn only for a page with `interfaceConfig.source`, and such a page now shows a spinner while it loads. Other pages no longer fetch it.
  - **The console writes the icons its first screen imports by name to one chunk, `vendor-icons-shell`.** Each of those icons had a chunk of its own, so a page load made one request per icon before its content. Every member of the new chunk is one a static import chain from the entry reaches, so no icon moves onto the first load; an icon used only lazily keeps its own chunk.
  
  No export, prop or type changes.
- c4dd707: feat(app-shell): five generic product-page blocks — `hero`, `stat`, `usage-bar`, `checklist`, `tile-grid` (objectui#12197)
  
  Clause-②: yes
  
  `@object-ui/app-shell` registers five product-neutral SDUI blocks for pages a product composes as metadata, each with declared `inputs` that state their defaults, and each accepting the spec's API binding as `dataSource`:
  
  - `hero` — `title`, `subtitle?`, `meta?` (drawn with a copy-to-clipboard button), `status?`, `statusTone?` (`neutral` when omitted), `primary?` / `secondary?` (`element:button` or `action:button` nodes).
  - `stat` — `label`, `value` (a number is formatted in the viewer's locale), `hint?`.
  - `usage-bar` — `label`, `used`, `limit?`, `unit?`; the bar's width is `used / limit` clamped to 0–100, and an absent or `0` limit is unlimited: the amount used and no bar.
  - `checklist` — `items: [{ label, done, action? }]`, `collapsedWhenDone?` (`false` when omitted; when set, the block draws nothing once every step is done).
  - `tile-grid` — `items: [{ label, href, icon?, caption? }]` or a `${…}` hole naming such a list, `addTile?: { label, href }`; the console home's launcher tile, now shared with the home's apps strip, which draws as before.
  
  `@object-ui/types` gains each block's strict arm in `AnyComponentSchema` (`HeroBlockSchema`, `StatBlockSchema`, `UsageBarBlockSchema`, `ChecklistBlockSchema`, `ChecklistBlockItemSchema`, `TileGridBlockSchema`, `TileGridBlockItemSchema`, `TileGridBlockAddTileSchema`, the union `ProductBlockComponentSchema`) and their TypeScript twins, so `objectui validate` accepts the five types. A value the bound answer may supply also accepts one whole-string `${…}` hole. The `dataSource` descriptions on the object-bound arms now name the object binding as one of `PageComponentSchema.dataSource`'s two shapes. `@object-ui/cli`'s known component types gain the five names. The console's preview gallery draws every block at `?only=product_blocks`.
- 068a540: The console's Setup › Apps page reports what the server did with a write (objectui#12300). Before, a Delete and a Disable could report success for a write that changed nothing.
  
  - **Delete.** When the reset door answers `reset: false` (there was no customization row to remove, so the app already is what its package ships), the page shows a neutral notice with the server's own sentence and never says "deleted". The row stays, because the server still serves it.
  - **Disable, Set as default and the bulk Enable / Disable.** A save of an app that a package owns now names that package (`?package=`, read off the served `_packageId`), so it lands on the row the server serves. A package-less app is saved with no scope, as before.
  - After every write, whatever it answered, the page re-reads the app list and shows the served state.
  
  `ObjectStackAdapter` forwards every argument of `getClient().meta.saveItem`. Its save-advisory wrapper used to pass on only `type`, `name` and `item`, so the SDK's options bag (`packageId`, `force`, `mode`, `ifMatch`) was dropped before it reached the wire, for every caller of the adapter's client.
  
  Two new `appManagement.toast` keys, `nothingToDelete` and `alreadyAtDefault`, ship in all ten language packs.
- ca45c6d: The OAuth consent page names the requesting application by its registered name again, and never shows the raw `client_id` in the name's place (objectui#12301).
  
  The page looked the client up at `/api/v1/auth/oauth2/applications/ID/public`, a route no server mounts. Every lookup answered 404, and the page then named the application by its raw `client_id`. It now asks the route the server serves, `GET /api/v1/auth/oauth2/public-client?client_id=…` — the same URL `@objectstack/client`'s `oauth.applications.getPublic` builds — once the user is signed in, because that route needs a session. It reads the name from the answer's `client_name` and the logo from `logo_uri`.
  
  When the lookup gives no name (an unknown or disabled client answers 404; any other non-2xx, a network failure, or an answer without `client_name` counts the same), the page says "This application could not be identified." and shows the raw id under a "Client ID" label, in a code face. While the lookup is in flight, the page names "an application" and shows no id.
  
  **Clause-②: yes (widening)** — `@object-ui/i18n`'s ten language packs gain two keys, `oauth.consent.unidentified` and `oauth.consent.clientId`. No key is removed or changed, and nothing else on either package's entry moves: no export, prop or type member.
- 524136e: The view-level `provider: 'api'` data source is no longer read anywhere in objectui (objectui#12325). `@objectstack/spec` retires it (objectstack#23082, ADR-0049): a view binds its object (`provider: 'object'`) or static rows (`provider: 'value'`), and a metadata-declared API call is the page element's `dataSource` binding.
  
  Breaking, declared as `minor` per the version-alignment rule:
  
  - **`resolveDataSource`** (`@object-ui/core`) has no `api` arm. A block that still says `provider: 'api'` is an unknown provider and gets an unknown provider's answer (the fallback DataSource, else `null`); no `ApiDataSource` is built from its `read` / `write`. `ResolveDataSourceOptions` loses `fetch` and `defaultHeaders`, which only that arm read.
  - **`ViewDataProvider`** (`@object-ui/core`) has no `api` arm: such a config resolves with `Unknown data provider: api`. `ViewDataConfig` and `ResolvedData.provider` drop `'api'`, and `DataFetcher.fetchUrl`, which only that arm called, is removed.
  - **`useViewData`** (`@object-ui/react`) no longer keys on or threads anything for an `api` block.
  - **`ObjectGantt`** reads no `api` block: its `read` URL is never requested, and the chart answers it like any unknown provider. `ObjectCalendar` and `ObjectMap` drop their `api` branches, which only warned "not yet implemented".
  - **`ListView`** no longer stands down for a gantt view with an `api` block: it fetches the bound object like any other list.
  
  Unchanged: `ApiDataSource` stays a class for code that constructs it from an `ApiDataSourceConfig`, so the console's approvals inbox reads exactly as before.
- 2b0ab94: The public form `/f/:slug` shows each section's description under its heading, as served (objectui#12333).
  
  Clause-②: no
  
  A signed-out visitor's console loads no app translation bundle (objectui#12034), so the public form is localized by the server: since objectstack-ai/objectstack#23497 (`@objectstack/*` 18.0.0-next.3), `GET /api/v1/forms/:slug` serves each section's `label` and `description` in the `Accept-Language` the browser sends. The heading already rendered the served label. The description was dropped before render, in every language, while `ObjectForm` draws the same key on the signed-in app path. It now renders under the heading, as served, with no client-side lookup.
  
  No prop, export or locale key changes.
- 23bf859: `element:repeater` reads its query from the node-level `dataSource` binding alone (objectui#12345). `@objectstack/spec` 18 retired the row's flat `object`, `filter`, `sort` and `limit` (objectstack#11509, ruled A-narrow), and `@object-ui/types` already refuses them by name. There is no grace window and no second spelling.
  
  - **Renderer (`@object-ui/components`), breaking for metadata that was never converted.** The repeater no longer reads `properties.object` / `filter` / `sort` / `limit`, or the same four keys in the legacy `props` bag, as the binding's fallback. A node that carries only the flat keys now issues no query and shows its empty state. Beside a binding, the flat keys no longer AND a filter in or supply a sort or a cap. A binding-bound repeater renders as before: the binding's own `sort` and usable `limit` win, a named saved view supplies the baseline, and the two filters are AND-combined. The spec's protocol-18 conversion (`element-flat-data-binding-to-data-source`) moves stored flat keys onto the binding.
  - **Console (`@object-ui/console`).** The `DevLists` dev route, the last in-repo producer of the flat keys, writes `dataSource: { object: 'showcase_category', limit: 10 }`. Its nodes are typed `DeclaredNode` literals instead of `as any` casts, so the authoring face checks them.
  - **Types (`@object-ui/types`).** A doc comment on `ElementRepeaterBlockSchema` no longer describes the removed fallback read. No type or schema changes.
- 5c94723: Setup › Apps: deleting an app names the package whose row it removes (objectui#12397, the consumer half of objectstack#23293).
  
  Since `@objectstack/rest` 18.0.0-next.1, a delete that names no package of an app two packages hold is refused `409 RESOURCE_CONFLICT`: nothing is deleted, and `?package=` is named as the remedy. The page already names the owning package on every save. Delete now sends it too, through `@objectstack/client`'s `meta.deleteItem` `packageId` option, read from the app's served `_packageId`. A package-less app, including one served with the `sys_metadata` sentinel, sends no package, and a refusal is still shown in the server's own words.
- 21f9577: The page kind `jsx` is retired from the page node, following `@objectstack/spec` 18 (objectstack-ai/objectstack#23638), which refuses it at parse and names `html` as its replacement (objectui#12464).
  
  **Breaking (levelled `minor`, per this repo's version policy): `PageNodeSchema.kind` narrows.** The exported `PageNodeSchema` type's `kind` is now `'full' | 'slotted' | 'html' | 'react'`; a page node literal typed with it no longer compiles with `kind: 'jsx'`. Author `kind: 'html'` instead: the page's `source` is compiled and rendered exactly as before. The zod face (`PageNodeSchema` from the package's zod entry) refuses `kind: 'jsx'` at `kind` the same way, so `objectui validate` and `objectui check` report it.
  
  The console's `sdui-jsx-preview` sample page now authors `kind: 'html'`, and the React Pages guide no longer presents `jsx` as an accepted alias.
- 9b82ced: The Approval Center's request drawer no longer has a "Raw data (JSON)" panel, for any viewer (objectui#12490).
  
  The drawer used to end with a collapsed panel that printed the submitted record's whole snapshot as JSON, with a copy button, shown only to holders of the platform-admin-only `studio.access` capability. There is no business need for it: the person handling an approval decides from the structured summary, the approval chain, the activity and the actions, and all of those are unchanged. The panel is now removed for everyone, platform operators included, and nothing replaces it. The served approval request page never had such a panel.
  
  Clause-②: no (narrowing) — the four keys `approvalsInbox.rawData`, `approvalsInbox.copy`, `approvalsInbox.copied` and `approvalsInbox.copyFailed` leave all ten locale packs, and nothing is added.
  
  `@object-ui/i18n` (BREAKING; `minor` under this repository's release model, where objectui's major follows the `@objectstack` major): the exported `en` pack and the `TranslationKeys` type derived from it lose those four members. Nothing in objectui reads them now. A host that calls `t()` with one of them gets the key back; supply the string from your own resources if you still need it. Keys with the same leaf name in other namespaces are not affected.
- 3eb3ec1: The console's list toolbar no longer has a write into the shared view, and the data-source method that write used is retired (objectui#12504).
  
  **BREAKING:** `DataSource.updateViewConfig` is removed from `@object-ui/types`, and `ObjectStackAdapter.updateViewConfig` is removed from `@object-ui/data-objectstack`. The capability gate that only that method read goes with it: `ObjectStackAdapter.setSystemCapabilities`, the `systemCapabilities` option of the adapter constructor and of `createObjectStackAdapter`, `VIEW_CONFIG_CAPABILITY`, `ViewConfigPermissionDeniedError` and `isViewConfigPermissionDeniedError`. A class that implements `DataSource` and keeps an `updateViewConfig` method still compiles, but nothing calls the method any more; an object literal annotated as `DataSource` that carries it is refused as an unknown property. Code that calls `updateViewConfig` through a `DataSource` or an `ObjectStackAdapter`, or imports one of the gate names, no longer compiles. To change a view for everyone, save the view: `createView` / `updateView` on the data source, or the console's view editor, which writes through the runtime metadata seam.
  
  Since objectui#12418 and objectui#12474, the toolbar's sort, column layout, density and Hide Fields are each user's own list state, so the toolbar write had no caller. The view editor's explicit save is now the one write path to the shared view, and it is unchanged.
  
  Personalization rows that earlier consoles wrote into `/meta/view` stay readable: the overlay marker, `narrowPersonalizationOverlay` and `listViews()` exclusion still apply to them. Nothing new writes such a row.
  
  `@object-ui/i18n` drops `console.objectView.viewConfigPermissionDenied` from all ten packs. It was the toast the retired write raised when the gate refused it. The other packages change only in comments and tests that named the retired path.
- cd64d43: Console pages: a dashboard and the Approvals Inbox draw the page header an object list draws, and the top bar draws no breadcrumb on a dashboard or page route (objectui#12526).
  
  - **One page header.** `DashboardView` and the Approvals Inbox render the console page header: an icon chip, the title, the secondary line beside the title from the `sm` breakpoint up, and the page's actions on the right, in one row. Before, a dashboard drew a large bold title with its description on a second line, and the inbox drew a large icon and title, a subtitle line and its Refresh button. The texts are unchanged: a dashboard's served `label` (else its `name`) and `description`; the inbox's title, subtitle and Refresh. A dashboard's chip draws the dashboard icon, since a dashboard document carries no icon of its own. Its "Refresh All" button stays where the dashboard renderer draws it.
  - **No breadcrumb on a dashboard or page route.** On `/apps/APP/dashboard/NAME` and `/apps/APP/page/NAME`, `AppHeader` draws nothing after the app pill and its PREVIEW chip from `sm` up, as on an object route since objectui#12461: the dashboard's page header and the page's own heading name the page once. This supersedes, for those two routes, the trails the objectui#12198, objectui#12273 and objectui#12461 entries in this release describe. A report or `system/*` route still draws its breadcrumb.
  - **Below `sm`.** The phone bar's compact title still names the dashboard or the page. The dashboard and the inbox keep their header on a phone: the icon, the title and the inbox's Refresh in one row. The page header hides its secondary line below `sm`, so a dashboard's description and the inbox's subtitle are no longer drawn there.
  
  `@object-ui/app-shell` adds one export: `ConsolePageHeader`, the console page header component, and its props type `ConsolePageHeaderProps` (`title`, `subtitle`, `icon`, `actions`, `accentColor`, `sticky`, `className`, `data-testid`). It is not named `PageHeader` because `@object-ui/layout` exports a different component by that name. No prop, option or pack key changes.
  
  **Clause-②: yes.** The package entry widens by that one component and its props type.
- 0d2ac90: Console pages: Flow Runs, Integrations & APIs, Audit Log, AI Approvals, Applications, Profile, the Settings hub and each settings namespace page draw the console page header an object list, a dashboard and the Approvals Inbox draw (objectui#12553).
  
  - **One page header.** Each page renders `ConsolePageHeader` from `@object-ui/app-shell` in place of its own large `h1`, icon and subtitle line: an icon chip, the title, the subtitle beside the title from the `sm` breakpoint up, and the page's header actions on the right, in one row across the page above its padded body. Audit Log keeps Refresh and Applications keeps New App in that row; New App is now the small button every header action is. A page that drew no icon (AI Approvals, Applications, Profile) draws no chip, and a settings namespace page draws its manifest's icon when the manifest names one. The texts and their keys are unchanged.
  - **One header height.** The console page header's title row is now at least as tall as its icon chip, so a header with no icon and no action (AI Approvals, Profile) is as tall as every other page's, an object list's included.
  - **Settings namespace pages.** The Beta badge sits beside the title inside the header, as an object list's badge does, and the manifest's description is the subtitle. Back to settings stays at the top of the page body.
  - **Below `sm`.** Each page keeps its header on a phone: the icon, the title and its actions in one row. The header hides the subtitle below `sm`, so these pages' subtitles are no longer drawn there; Applications' New App no longer stacks under the title.
  
  **Clause-②: no.** No export, prop, type member or i18n key is added or removed; the pages consume the existing `ConsolePageHeader` export.
- f74638c: **A settings action row draws its label once, on the button** (objectui#12610). The settings renderer's `action_button` row printed the manifest's `label` as the row label and again on the button, so Mail Delivery read "Send test email" twice and AI & Embedder repeated "Test connection", "Reset to environment defaults" and "Test embedder". The button now carries the label alone. The row's left side holds the specifier's `description` when the manifest declares one, as one line of muted text, and nothing otherwise. Settings keys, values and save behaviour do not change.
- 8cf9cf3: A link from one doc to another in the docs portal now carries the console's base path (objectui#12686). The portal rewrites a doc body's `[x](./other_doc.md)` cross-reference to the docs route. It used to write `href="/docs/other_doc"` with no router basename. A plain left click worked, because the page hands it to the router, but under the `/_console` mount a new tab, a middle-click or a copied link went to the server path `/docs/other_doc` and answered 404. The href is now react-router's own href for that route (`useHref('/docs')`, the same source objectui#12233 used for record links), so it reads `/_console/docs/other_doc`, or `/docs/other_doc` on a root mount. A plain left click still navigates inside the app, a modifier click is left to the browser, and fragment links, the table of contents and external links behave as before.
  
  Clause-②: no — an app-internal href gains the router basename. No prop, export or language-pack key changes.
- ff215d9: A settings row's source badge reads in the session's language, verb included (objectui#12694). The badge beside a setting's label said where its value comes from as an English verb beside a translated layer name, so a zh-CN admin who saved a workspace value read "Overrides 默认".
  
  - **`@object-ui/i18n`** adds `console.settingsView.sourceBadgeInherited` and `console.settingsView.sourceBadgeOverrides` to all ten bundles. Each is one sentence with the layer's name as `{{source}}`, so a language puts the layer where its grammar needs it. The English values are the old wording, so an English session reads exactly as before.
  - **The console's settings page** draws both badges from those keys. The layer's name is still the server's `settingsCommon.sourceLabels` label.
  
  No export, prop or type is added, removed or renamed.
- 2dbe5f5: Home answers a `current_user.can()` navigation gate from the caller's permissions (objectui#12700).
  
  The console now mounts its one `/auth/me/permissions` source above both `/home` and `/apps/:appName/*`, so moving between them keeps a single answer and asks for it once per session load. `/studio/*` stays outside it. Home waits for that answer the way an app already did, with the same loading screen and the same error screen with Retry.
  
  `HomeLayout` now mounts the predicate scope for Home's navigation gates (the bell's and the activity card's roster, and the command palette's list) and binds that answer for `current_user.can(OBJECT, VERB)`. A member without the grant does not get the gated entry, a member with it does, and Home no longer reports "this evaluation context carries no permission data" on every load. Without a permission provider above it, the gate is withheld and reported once, as before. This is UI gating, not a security boundary: the server enforces what a member may read.
- 4839f5c: Lists at narrow widths: a status chip is never cut to "Publish…", a table wider than its panel shows that it scrolls, and the Actions column is drawn only when a row offers an action.
  
  - **Chip columns.** A `data-table` column flagged `chips: true` (a new optional `TableColumn` member) is never narrower than its widest drawn chip among the rows on screen, measured once per data load. The floor applies over a declared width and a user's resize; text columns keep their width and truncate first. `ObjectGrid` sets the flag on `select`, `status`, `multiselect`, `radio`, `checkboxes` and `tags` columns.
  - **Wide tables show they scroll.** One shared affordance, exported from `@object-ui/components` as `HorizontalOverflowBox`, its props type `HorizontalOverflowBoxProps` and `PINNED_RIGHT_SEAM_SHADOW_CLASSES`: a right-edge shadow while columns remain to the right, and the scrollbar on hover. `data-table`'s own scroll box uses it, as do the grouped grid's scroller (where the shadow sits at the pinned Actions column's edge; it had none) and the Approvals Inbox table (it had none).
  - **Actions column.** `ObjectGrid` draws the Actions column only when at least one row on screen offers an inline button or a menu item, after the actions' capability gates, per-record predicates and record-level permission verdicts. A list whose rows offer nothing no longer shows an empty "Actions" header.
- 5483297: The flow designer, canvas, Debug simulator and read-only flow viewer treat `http` as the HTTP node type, and no longer recognise `http_request`, `http_call` or `webhook` as node types (objectui#12742).
  
  `@objectstack/spec` 18 reserves those three names inside the flow node namespace: the authoring doors refuse them with the rename to `http`, and a stored flow that still carries one loads as `http`.
  
  - **Inspector.** A node typed `http` shows the HTTP form (Method, URL, Headers, Body, Timeout) offline, and its zh-CN field labels. The form is keyed `http`; no designer alias resolves a reserved name onto any form.
  - **Canvas.** An `http` node draws the globe glyph on the integration tone. It used to fall back to the generic task glyph, because the icon switch named only `http_request` and `webhook`.
  - **Debug simulator.** An `http` node is mocked, and the panel offers it a mock-output field. It used to pass through unmocked.
  - **Flow viewer.** An `http` node is folded away as a technical step at business detail. It used to show as a business step.
  - **Preview samples.** The two HTTP nodes in the flow preview sample are typed `http`, and the loop-body one no longer writes `outputVariable`, a key the `http` contract does not declare.
  
  The zh-CN string `engine.flowNode.http_request.label` is removed; `engine.flowNode.http.label` already carries the same label. A wait node's `eventType: 'webhook'` is unchanged.
- 8d80845: An SSO sign-in reads in the session's language on both login pages (objectui#12762). The console's login page and app-shell's `DefaultLoginPage` passed `LoginForm` none of its four SSO labels, and no bundle had keys for them, so a non-English console showed `LoginForm`'s English defaults: "Sign in with your organization's single sign-on" and "Use a password instead" under SSO-only mode, and "Sign in with SSO" and "Back to single sign-on" once the password form was opened.
  
  - **`@object-ui/i18n`** adds `auth.login.ssoButton`, `auth.login.ssoOnlyDescription`, `auth.login.usePasswordText` and `auth.login.backToSsoText` to all ten bundles. The English values are `LoginForm`'s own defaults, so an English session reads exactly as before.
  - **Both login pages** pass those four labels. **`DefaultLoginPage`** also passes the ten phone and verification-code labels (`emailOrPhoneLabel` through `usePasswordSignInText`), from the `auth.login.*` keys the console's page already read, so its phone sign-in is translated too.
  
  Both pages now pass every `LoginFormLabels` member. No export, prop or type is added, removed or renamed.
- f3a7b87: The "N eligible approver(s)" figure beside an approval's decision progress counts people, not slots (objectui#12781). The record page's approvals panel and the approval request page's decision panel used to count the request's `pending_approvers` slots. The approvals service keeps one slot per resolved approver entry, so a person who holds two of the node's positions was counted twice. On the stock showcase, the committee quorum showed "3 eligible approvers" beside a single "Dev Admin ×3" chip. Both panels now count the distinct principals in the slate as the server serves it. Nothing is resolved in the console, and the server's tally (`got` of `need`) is drawn exactly as before.
  
  The Approval Center's request drawer applies the same count: its decision-progress line now reads the number of distinct approvers in the served slate, where it read the slot count.
- b524150: The developer Flow Runs page's flow picker names each labelled flow by its label again, on the list a real server serves (objectui#12783).
  
  objectstack's metadata list answers `meta.getItems('flow')` with flattened items: each flow's `name` and `label` sit on the item itself, with no `spec` member. The page read the name from either form, but the label from `spec.label` only, so against a server every flow was listed by its API name alone, for example `showcase_batch_reminders`. The label is now read the way the name is, `spec` first and then the item itself, so the picker shows `Batch Task Reminders (Loop) (showcase_batch_reminders)`, the `label (name)` form the page builds. A flow that declares no label still shows its bare name.
  
  Nothing else on the page changes: no export, prop, type member or i18n key is added or removed.
- 5d69b0e: The console's startup sends one `get-session` and one `runtime/config` request instead of two of each: the session check and the early-branding request now hand their answers to the app instead of having them fetched again before the first render.
- 4b3d6ed: Approvals Inbox: on a narrow screen the inline Approve / Reject column stays pinned to the table's right edge, with a shadow on its left edge while the table scrolls under it, instead of sitting past the card's edge. A long record title now truncates (its full text on hover) instead of widening the table.
- 64acb7e: A settings row's chips read in the session's language (objectui#12821). The env-lock chip said "Locked by env" in every language, and its title, shown when the server names no reason, was English too; the `Deprecated` chip (with its replacement key) and the row drawn for an unsupported specifier type were English literals as well.
  
  - **`@object-ui/i18n`** adds `console.settingsView.envLockBadge`, `envLockBadgeTitle`, `deprecatedBadge`, `deprecatedBadgeReplacedBy` (with `{{replacedBy}}`) and `unsupportedSpecifierType` (with `{{type}}`) to all ten bundles. The English values are the old wording, so an English session reads exactly as before.
  - **The console's settings page** draws those chips from these keys. A reason the server sends (`lockedReason`, such as "Set via env: NAME") is still shown as served.
  
  No export, prop or type is added, removed or renamed.
- 473e5a0: The sign-in page's tenant hint falls back to "You are signing in to this environment", matching the language packs (objectui#12851).
- b279016: The OAuth consent page names the three agent scopes in words. An MCP client that asks for `data:read`, `data:write` or `actions:execute` used to show those as raw strings in the "This app will be able to:" list. Each now reads as one sentence: reading records, creating, changing and deleting records, and running actions on the user's behalf, each within the user's own permissions. The three sentences are new keys under `oauth.consent.scope` (`dataRead`, `dataWrite`, `actionsExecute`) in all ten language packs. Any other scope still shows as its raw string.
- 285ddb2: The console's boot session check now keeps the renewed session cookie (objectui#12892). Before the app renders, the console checks the stored sign-in token with one `get-session` request. That request sent no cookie (`credentials: 'omit'`). Once a session was older than the server's renewal age, the request extended the session on the server and sent back a renewed cookie, but the browser dropped it. The session then outlived the cookie the browser kept, and every path that reads only the cookie saw a signed-out user. The request now sends `credentials: 'include'`, so the browser stores the renewed cookie. A stale stored token is still detected and cleared: the server judges a request that carries both by its Bearer token.
- 7f9cc37: Console copy names the system the user is already in, not the cloud noun "environment" (objectui#12956). Inside a running deployment, the Settings subtitle and its first category, the timezone prompt, the read-rate banner, the sign-in, sign-up and email-verification notices, the profile password descriptions, the home page loading, empty and build-refusal states, the system-settings quick action, the Connect-an-agent endpoint card and the AI model status error now say "this system" (zh 「本系统」), or drop the noun where the sentence reads without it. The Settings category that holds Company, Branding and Localization reads "General" (zh 「常规」). All ten language packs follow; no key is renamed, added or removed. Inline English fallbacks at the call sites follow the `en` values.
- ea34d9b: The help menu gains an About entry on every console bar (the tenant console and the control plane draw the same header). It opens a small dialog naming the build the console was compiled from: `VITE_APP_VERSION` from the build's environment, or, when that is unset, the short sha of `HEAD` that the console's Vite config reads from git at build time. A console built with neither says "Unknown build" in words instead of showing an empty field.
  
  The dialog and Sentry's release fallback read the same value through one reader, so the two can no longer name different builds. The text comes from new `help.about*` keys in all ten language packs.
- 6db875e: Opening the console no longer starts nine reads the page does not show in the same moment as the page's own reads (objectui#12980, part 3).
  
  - **The bell.** The inbox and the pending-approvals count are read once the boot splash is gone and a frame has painted. Until they land the badge draws nothing, as it does while any read is in flight, and never a `0`. The Activity tab's feed, which the badge does not use, is read when the bell is about to open: a pointer over it, focus, or a click. Until then it does not ask whether `sys_activity` exists either, which inside an app is its own `meta/object/sys_activity` read.
  - **The header's dashboard, page and report lists.** The header reads each only on the route type that names one, for the phone bar's title. Any other route reads none of them.
  - **The navigation sync.** It reads the page and dashboard lists after the first paint. It still waits for both to load before it compares them.
  - **The agent catalog.** `useAgents` sends `GET /api/v1/ai/agents` after the first frame has painted, not while the page mounts. The AI entry points stay hidden until the catalog answers, as before.
  - **The user's language row.** The `sys_user` read that applies the signed-in user's language runs after the first paint. It stays a separate read because `GET /auth/me/localization` does not say whether its `locale` came from the user's column or from a fallback.
  - **The console's locale list and the timezone prompt's settings read.** Both wait for the first paint. The locale list asks for the session at the moment it sends, so a sign-out while it waits sends nothing.
  
  Nothing is added to a package entry: no export, prop or type member.
- b9e1887: Publish `optionListDefault` (and its parameter type `OptionListFieldLike`) from the package entry: the reading of an option list's `default: true` that create forms seed from (objectui#11914). The console's public form page (`/f/:slug`) now seeds a field's option-list default through it, so a required select whose options mark a default opens on that option and submits it, instead of refusing the submit on the client (objectui#13049).
  
  Console: on a public form, a select whose options mark `default: true` (and that declares no `defaultValue`) now opens with that option selected, so an untouched submit sends it instead of failing with "Required: FIELD".
- fb85637: A field group whose `visibleWhen` cannot be evaluated is now hidden, header and members, on the form and on the record detail page (objectui#13055).
  
  `@objectstack/spec` declares `ObjectFieldGroupSchema.visibleWhen` fail-closed: "the whole group (header included) is shown only when TRUE, else hidden (fail-closed)". Until now both surfaces failed open. A group whose predicate had a parse error, named an unknown field or root, or failed to evaluate was drawn in full, with only a console warning.
  
  - **Form.** Every layout now hides the group: simple, tabbed, split, drawer, modal, and the console's form page. This holds whether the group comes from the object's `fieldGroups` fallback or from a `{ group }` section reference. Members of a group hidden this way behave as they do under a FALSE predicate: their values still submit and their client-side validation is skipped.
  - **Record detail page.** `record:details` hides the group's section.
  - **Diagnostic.** The one-time warning still fires, and now names the default taken: `safe default (false)` and "the group is hidden".
  - **What stays fail-open.** An authored form-view section's own `visibleWhen` still faults open, as `FormSectionSchema.visibleWhen` declares. So do a field's own `visibleWhen`, `readonlyWhen` and `requiredWhen` (ADR-0137 D3), and every other predicate slot. A well-formed predicate gates exactly as before.
  
  How the direction reaches the renderer: a form-view section's predicate and a field group's predicate arrive at the form renderer in the same slot, a `section-divider` row's (or a tab's) `visibleWhen`. So the direction travels with the predicate. `@object-ui/types` declares one runtime hand-off key, `visibleWhenFault?: 'hidden' | 'shown'`, on `ObjectFormSection`, `FormField` (`section-divider` rows only) and `FormFieldTab`, and mirrors it on the zod faces. `deriveFieldGroupSections` stamps `'hidden'` beside a group's predicate. Every layout carries it next to `visibleWhen`, and the form renderer reads it as the fault fallback. Absent means today's fail-open. It is not an authoring key: the spec's strict `FormSectionSchema` refuses it in authored metadata.
- 961b69f: A settings value can go back to unset, and an override back to the inherited value (objectui#13145).
  
  - **`@object-ui/console`**: emptying a text, email, URL, phone, password or textarea box on a settings page (and the free-text box of a `valueDomain` select) now saves the key as `null`, which the settings service reads as "clear this layer's value", instead of `""`. A cleared SMTP host is no longer refused as incomplete; a key the server requires with no default is still refused, as before. A row whose source badge reads "Overrides" gains a small "Reset to default" action beside the badge: it clears the key in the draft, Save sends it as `null`, and the badge then shows what the server answers for the row.
  - **`@object-ui/i18n`** adds `console.settingsView.resetToDefault` to all ten bundles.
- 52907d7: Settings pages: when the server refuses a save field by field, the toast now names the refused settings by the labels their rows show, for example "1 setting needs attention: Default timezone" (objectui#13146). It used to repeat the server's log sentence, which named the namespace and each machine key, called every refusal "incomplete" even for a malformed value, and repeated each row's whole message, help text included. Each row still shows its own reason. A refusal that names no setting on the page toasts "Save failed", and a refusal with no field errors still shows the server's message.
  
  The sentence is the new `console.settingsView.fieldErrorsToast` plural family, in all ten packs. The labels are joined with each pack's `validation.formInvalidJoiner`.
- 7a5f267: A settings page asks before it lets unsaved edits go (objectui#13163).
  
  Every `system/settings/:namespace` page keeps its edits in a draft and shows "N unsaved changes" at the bottom, but nothing stood between that draft and leaving the page: a click on another page in the sidebar navigated at once and the edits were gone. While the bar is shown, the page now asks "You have unsaved changes. Are you sure you want to leave?" (the existing `form.unsavedChanges` question, in all ten languages) before:
  
  - **a link to another page of the console**, including another settings namespace. Cancel keeps the page, its URL and the edits; OK leaves, and the edits go with the page.
  - **its own "All settings" crumb.**
  - **closing the tab or reloading**, through the browser's own "Leave site?" prompt.
  
  It does not ask for a link to the page already shown, a click that opens a new tab or window, a download, or a link to another site (that one is the browser's leave prompt). Nor does it ask once the page is clean again, after a save or a Discard. The prompt is the browser's `confirm`, as the Setup app's metadata editors already use.
  
  Not covered: browser Back and Forward, which the console's router gives a page no way to hold.
- c209c93: The Audit Log's Object filter is picked from the served objects instead of typed (objectui#13165).
  
  The filter was a free-text box under the placeholder "e.g. account", sent as an exact match on the stored object name. In an app whose objects carry a prefix the placeholder's own example matched nothing (`account` listed no row while `crm_account` held them), and finding any object meant knowing its API name.
  
  It is now a searchable picker of the objects the console's metadata serves, each shown as `Label (name)`, the spelling the object-ref picker uses. It sends the chosen object's API name, as the Actor filter sends the chosen user's id. "Any object" is the unfiltered state; choosing the chosen object again, or "Clear filters", removes the filter. The query is unchanged: still an exact `object_name` match. The visible "Object" label now names the control for assistive technology.
  
  An object the metadata no longer serves (a deleted one, say) is not offered, so this filter cannot narrow the ledger to its old rows.
- da307ef: The Audit Log's Action filter offers the actions the server declares for `sys_audit_log.action` (objectui#13175).
  
  The filter read a hand-kept list of seven actions that claimed to mirror the server's declaration and had fallen behind it. Actions the server declares and writes rows for, `read`, `platform_admin_standing_change`, `login_failed` and `account_locked` among them, could not be picked, so an admin could not narrow the log to refused sign-ins or account lockouts.
  
  The filter now offers the declared options of the `action` field in the `sys_audit_log` object metadata the console already loads, in declared order and labelled as declared, and the hand-kept list is removed. Declaring an action on the server is all it takes to offer it. The query is unchanged: the chosen value is still sent as an exact `action` match. An action with no local badge tone shows the neutral outline badge, as before.
  
  While that object metadata is not loaded, or when the console is not served the `sys_audit_log` object, the filter offers only "All actions".
- 039e0b9: The Audit Log's Action, Actor, From and To filters are named by their visible labels (objectui#13224).
  
  Four of the five filters drew a label that named nothing, so assistive technology announced an unnamed combobox, an unnamed lookup and two unnamed date fields, and voice control could not reach them by name. Each label now names its own control, as the Object filter's already did: the Action select, the Actor lookup's trigger, and the From and To date fields. The filters' options, the query they send and the layout are unchanged.
- e077b8a: The console's own menus ask before they drop a page's unsaved edits (objectui#13231).
  
  A settings page with unsaved edits already asked before a link, its own crumb or a tab close took them (objectui#13163). The shell's menus did not ask: they navigate from a button, which no link listener sees. Help › All documentation, the avatar's Profile, My Organizations and Create organization, the workspace switcher's Manage members and Create organization, and a sidebar entry's ⋯ › Design each left the page at once, and the edits were lost. Picking another organization in the workspace switcher was worse: the switch was sent first and the console then reloaded, so the organization had changed before anything could ask, and even the browser's leave prompt never appeared.
  
  These now ask the page's own question first, and so do the other header departures of the same kind: This app's docs, an app listed in the avatar menu, another app in the app switcher, Log out, and the go-home shortcut. An organization switch asks **before** it is sent. Cancel keeps the page, its URL, the organization and the edits; OK goes on, and the browser does not ask a second time. Nothing asks when no page holds unsaved edits.
  
  `@object-ui/app-shell` exports the seam behind it: a page calls `useRegisterUnsavedEdits(dirty, message)` while it holds edits, with the question to ask, and a departure that starts from a button goes through `confirmUnsavedLeave(go)`, which runs `go` at once when nothing is held and otherwise only after the user confirms. While anything is registered the seam also guards a tab close or reload and a click on an in-app link, so the settings pages and the metadata editor now register with it instead of each installing those listeners.
  
  Not covered: browser Back and Forward, which the console's router gives a page no way to hold, and departures that do not go through `confirmUnsavedLeave` yet, such as picking a page in the command palette.
- 1ca759a: Settings pages refuse to save while a visible required setting is empty (objectui#13239).
  
  The spec declares a settings specifier's `required` as checked by the renderer and the server. The server judges only the keys a save changes, so a required setting nobody edited was never checked: on Setup → Email, with Host and From email both empty, changing only From name saved. Before sending a save, the page now checks every required setting whose `visible` expression holds, against the value being saved (the edit, or the stored value). A setting that is empty (no value, or only spaces) blocks the save: no request is sent, each such setting shows "This field is required" in place of its help text, and focus moves to the first one. `false` and `0` are values. A setting hidden by its `visible` expression is not checked. A setting locked by the environment is not checked: its control cannot be edited, and an environment lock carries the environment's value. Toggle rows now show a field error the same way the other rows do.
  
  The server's rules are unchanged. No export, prop or language-pack key is added.
- 9a3bcfc: A settings page loads its namespace when the namespace changes, and no longer when the translation function does (objectui#13254). The load used to re-run on every new translation function, and i18next hands one out on a language switch and on every translation bundle written into its store. So a bundle landing after the page had loaded, for example the app's own translations on a slow connection, sent a second `GET /api/settings/NAMESPACE` and dropped the edits in place: the field went back to its stored value and the "N unsaved changes" bar disappeared. The draft now resets only on a namespace change, a save or a discard. A load failure without a server message shows the pack's "Failed to load settings", translated when it is drawn.
  
  A display-language switch in the console still drops a settings page's unsaved edits. The console shell remounts every page under it when the language changes, and this change does not touch the shell.
- d7e9e9a: feat(types)!: `object-grid` `operations` and the `object-grid` / `object-kanban` / `object-calendar` `filter` follow the `@objectstack/spec` 17.7.0 rows (objectui#6152, round 8)
  
  Clause-②: no
  
  **Narrowed (breaking).** `@objectstack/spec` 17.7.0 types `object-grid`'s `operations` as the
  strict `{ create?, update?, delete?, export? }` block, refusing `read` and `import` by name, and
  the `filter` of `object-grid`, `object-kanban` and `object-calendar` as the `ViewFilterRule` array
  `[{ field, operator, value }, ...]`, refusing the MongoDB-style record and the AST tuple array.
  `@object-ui/types` now says the same, with no alias window:
  
  - `ObjectGridSchema.operations` takes the row's block by reference. `read` and `import` are
    `?: never` on the interface and refused by name at their own path on the flat zod
    `ObjectGridSchema`: no `object-grid` code reads either. The flat mirror is the source of an
    `object-view`'s `table` slot, so `table.operations.read` / `.import` are refused there too, and
    the `read` refusal names the view-level spelling, `navigation: { mode: 'none' }` or the view's
    own `operations: { read: false }`.
  - `ObjectGridSchema.filter`, `ObjectKanbanSchema.filter` and `ObjectCalendarSchema.filter` take
    their row's own member by reference, on the interface and on the zod mirror. They were `any[]`
    and `z.array(z.any())`, so `filter: [['status', '=', 'open']]` type-checked and parsed. It is now
    refused, on an authored `object-kanban` / `object-calendar` node and in an `object-view`'s
    `table` slot; respell it `filter: [{ field: 'status', operator: 'equals', value: 'open' }]`.
  
  What did not move: an `object-view`'s own `operations.read` (the protocol has no `object-view`
  row, and `ObjectView` reads it as its row-click gate), and the renderers' reads. `ObjectGrid`
  still lowers an AST array, and the board and the calendar still hand whatever `filter` reaches
  the node to `$filter`, because hosts compose that form at runtime.
  
  - `@object-ui/plugin-view`: the grid node `ObjectView` composes no longer carries the view's
    `read` toggle in its `operations` block; the view keeps reading it.
  - `@object-ui/plugin-grid`, `@object-ui/plugin-kanban`, `@object-ui/plugin-calendar`: the
    registrations' `filter` inputs describe the `ViewFilterRule` array, and the grid's `operations`
    input names the four toggles.
  - `@object-ui/console`: the registry parity pins' prose stops calling these rows `z.unknown()`.
- Updated dependencies [c4c506b]
- Updated dependencies [d92b2a1]
- Updated dependencies [6f3299f]
- Updated dependencies [35a2b59]
  - @object-ui/sdui-parser@18.0.0

## 17.7.0

### Minor Changes

- 212c451: The form routes `/f/:slug` and `/forms/:name` render every field with the widget the shared field resolver names for it — the same widget the record form renders (objectui#10179, objectui#10177).
  
  Until now `FormPage` drew its controls with its own switch on the field type. The switch covered only some of the declared field types, and every other type rendered as a plain text box: `image`, `lookup`, `percent`, `richtext`, `signature` and more, with no error or warning. It also never read a field's `widget` key, so `object-ref`, `filter-condition` and `recipient-picker` could not be reached on these routes, and it ignored `multiple` on a `select`.
  
  Now each row goes through `resolveFormWidgetType` and `getLazyFieldWidget` from `@object-ui/fields`. An authored `widget` wins over `type`, and the form view's `widget` wins over the object field's. A `select` with `multiple: true` renders the multi-select widget. The row label reaches the widget according to the widget's own labelling declaration, so a required boolean is named by its label once, not twice. A required radio group is now reachable by its label and exposes its required state.
  
  Some behaviour changes with the widgets:
  
  - Required is announced with `aria-required` and not the native attribute, so the page checks required rows itself before submitting. It refuses a submit that leaves a visible, editable required row empty, and names the empty rows. `false` counts as a value. An untouched required boolean holds no value and is refused, as the record form refuses it.
  - Values are whatever the shared widgets emit. For example, a multi-value select submits an array, and a date-time field submits the value the shared date-time widget produces.
  - Field types that `@objectstack/spec` does not declare, such as `long_text`, `paragraph`, `integer`, `picklist` and `timestamp`, get the resolver's `text` fallback. Before, the old switch drew a dedicated control for them.
  - The page shell is unchanged: public and internal loading, the submit target, the post-submit behaviour, `?recordId=` prefill, `redirect` and `visibleWhen`.
- d6a1a80: feat(console): the docs portal refuses a doc or book the member may not read, and opens a doc in the book that claims it (objectui#10188)
  
  - **A refusal, not "not found".** A member outside a doc's or a book's audience who opens its
    direct URL — `/docs/DOC`, `/docs/BOOK` or `/docs/BOOK/DOC`, also under an app's
    `/apps/PACKAGE/docs` — now sees "You do not have access to this documentation" with the
    server's reason. Before, the flat routes said the doc "is not installed" and the reader said
    "Failed to load documentation". The server answers such a member 401 / 403 and an absent
    name 404; the portal now keeps the two apart. A segment the member's own lists do not answer
    is asked about once, by name (the doc, then the book). A name nothing carries still shows
    "Documentation not found".
  - **The claiming book.** In a package with several books, a flat doc permalink (what a
    `{ type: 'doc', doc }` menu entry links to) opens the page in the book that claims it,
    with that book's sidebar. Before, it opened in the package's first book by label, where the
    page is only an uncategorized orphan. A page no book of its package claims opens in the
    package's first book, as before.
- 50e41f7: Framework navigation can now reach the console pages that the retired System Hub card wall used to be the only link to (objectui#10520).
  
  Navigation reaches a console page only through a `type: 'component'` item whose `componentRef` is a component-registry key, never through a console path. The console registers three new keys:
  
  - `audit:log` renders the Audit Log page. It stays beside the `sys_audit_log` object view because its detail drawer pretty-prints the before and after JSON of a change, which the object's record page shows as raw text.
  - `ai:approvals` renders the AI Approvals page, which lists the whole AI pending-action queue.
  - `developer:integrations` renders the Integrations & APIs page, which shows the environment's REST base URL, the generated REST endpoints of each business object and a cURL sample that sends the `x-api-key` header.
  
  The keys are additive. `/apps/:app/system/audit-log`, `/apps/:app/system/ai-approvals` and `/apps/:app/developer/integrations` still render their pages, so bookmarks and deep links keep working. The navigation entries that name the new keys belong to the framework, not to this package.
  
  **Breaking:** the Developer Hub page and its route, `/apps/:app/developer`, are removed. The hub was a wall of four cards, and each card's destination is now a registry key: `developer:api-console`, `developer:flow-runs` and `developer:public-forms`, which the framework's Studio app already names in its Developer group, and `developer:integrations`. A bookmark to `/apps/:app/developer` no longer shows the hub. Inside an app it now reaches the generic object route, which answers that no object named `developer` exists. With no apps configured it lands where it did before this change. The four routes under `/apps/:app/developer/` are unchanged.
- 37140f4: chore(console)!: drop the lazy `scatter-chart` and `dashboard-grid` stubs, and stop the `metric` / `metric-card` stubs claiming the bare key (objectui#10859, batch 8 phase 2b)
  
  **BREAKING (authoring):** the console no longer registers lazy stubs for `scatter-chart` (`@object-ui/plugin-charts`) or `dashboard-grid` (`@object-ui/plugin-dashboard`), which those packages retired. The `metric` / `metric-card` stubs, in `register-plugins.ts` and in the dev-only preview gallery, now pass `skipFallback: true`, like the registrations they stand in for, so only `plugin-dashboard:metric` / `plugin-dashboard:metric-card` resolve before the chunk loads.
  
  Migration:
  
  - `scatter-chart` → `{ "type": "chart", "chartType": "scatter" }`;
  - `dashboard-grid` → `dashboard`;
  - a standalone `metric` / `metric-card` node → `plugin-dashboard:metric` / `plugin-dashboard:metric-card`.
  
  **Clause-②: yes**, released as `minor` with this banner.
- ad1785c: chore(console)!: drop the lazy `pie-chart`, `donut-chart` and `radar-chart` stubs (objectui#10859, batch 8 phase 2c)
  
  **BREAKING (authoring):** the console no longer registers lazy stubs for `pie-chart`, `donut-chart` or `radar-chart` in `register-plugins.ts`, nor for `pie-chart` in the dev-only preview gallery. `@object-ui/plugin-charts` retired those keys. `chart`, `object-chart`, `bar-chart` and `chart:bar` stay lazily registered.
  
  Migration:
  
  - `pie-chart` / `donut-chart` / `radar-chart` → `{ "type": "chart", "chartType": "pie" | "donut" | "radar" }`.
  
  **Clause-②: yes**, released as `minor` with this banner.
- 990a2d6: chore(console)!: drop the lazy `tree` registration stub (objectui#10859, batch 8)
  
  **BREAKING (authoring):** the console no longer registers a lazy `tree` stub for `@object-ui/plugin-tree`, which retired that key. `object-tree` stays lazily registered.
  
  Migration:
  
  - `{ "type": "tree", … }` → `{ "type": "object-tree", … }`.
  
  **Clause-②: yes**, released as `minor` with this banner.
- e6bc087: feat: a `doc` navigation entry (ADR-0046) validates and draws as a link into the docs portal
  
  `@objectstack/spec` 17.5.0 added a tenth navigation item type, `doc` — `{ type: 'doc', book }`
  opens a book, `{ type: 'doc', doc }` opens one page, both opens that page in that book's
  context. `objectui validate` refused it: `NavigationItemTypeSchema` was a hand-written list of
  the nine older types, while the TypeScript `NavigationItemType`, derived from the spec, already
  carried `doc`. And no renderer drew one — `resolveHref` had no `doc` branch, so the entry
  rendered as a dead `#` link.
  
  - **`@object-ui/types`** — `NavigationItemTypeSchema` is now read off the discriminator of the
    spec's navigation union instead of hand-listed, so it gains `doc`. A `doc` entry is judged by
    the spec's own `DocNavItemSchema`: it accepts exactly what the spec accepts — at least one of
    `book` / `doc`, a doc NAME (a filename or a path is refused), a snake_case `id`, and the closed
    key set of the spec's `doc` arm — and refuses an empty `label` as every sibling type does. The
    parsed entry is never rewritten. `NavigationEntryItem` gains the spec-derived `book` and `doc`
    members. An unknown `type` is now refused with `invalid_union` at `type` (was `invalid_value`),
    the code the spec's own union answers with.
  - **`@object-ui/layout`** — `resolveHref` sends a `doc` entry to the console docs portal under
    its `basePath`: `/docs/DOC`, `/docs/BOOK` or `/docs/BOOK/DOC`. An unlabelled `doc`
    entry shows the page it opens, else the book. It is gated by the same base keys as its
    siblings (`visible`, `requiredPermissions`, `requiresObject`, `requiresService`); the book
    audience gate stays the server's. The mobile tab bar links it the same way.
  - **`@object-ui/app-shell`** — the app designer's preview keys its navigation kinds by
    `NavigationItemType`, so a `doc` entry is drawn with its target and route instead of being
    dropped (label-less) or badged `untyped`.
  - **`@object-ui/plugin-designer`** — `NAV_TYPE_META` drops the `| 'doc'` key that bridged the
    spec pin lag; it is keyed by `NavigationItemType` alone.
  - **`@object-ui/console`** — the docs portal resolves a path segment that is a book's NAME
    rather than its `slug` — what a `{ type: 'doc', book }` entry links to — and redirects to
    the book's canonical slug URL: `/docs/NAME` opens the book, `/docs/NAME/DOC` reads that page
    with the book's sidebar. It is looked up after a book's slug and an installed doc's name, so
    every URL that resolved before answers as it did; only former "Documentation not found"
    answers change.
- f88a900: The console build now writes `dist/sdui.manifest.json`, the SDUI component manifest of the Console it built (objectui#11403).
  
  A host serving this Console registers that file under `@objectstack/metadata-protocol`'s `SDUI_MANIFEST_SERVICE`, and its metadata save door judges page sources against it (ADR-0080 §5). Until now the build wrote no such file, so a host serving `dist` as-is had no manifest of its own: it printed one boot line and judged no page save.
  
  `pnpm build` runs a new `build:sdui-manifest` step after `vite build`. It loads the console's full registry eagerly under Node (`dev/manifest-registry.ts`, the same module the `dev/manifest-dump.html` page loads) and calls the existing generator, `buildArtifacts` in `packages/sdui-parser/scripts/gen-manifest.ts`. The shipped file is that generator's `sdui.manifest.json`, byte for byte, for the console's own registry. The published `dist` gains this one file only: the generator's other two outputs (`sdui-intrinsics.d.ts`, `sdui-blocks.md`) are written to a scratch directory and discarded.
  
  The step reads the workspace packages' built `dist`, which the console's `tsc` step already needs and which turbo builds first. Callers that run `vite build` directly (CI's E2E builds, `vercel.json`) do not run it.
- 9d9ed54: chore(console)!: drop the lazy `spec-report` stub (objectui#11440)
  
  **BREAKING (authoring):** the console no longer registers a lazy stub for `spec-report` in `register-plugins.ts`. `@object-ui/plugin-report` retired that key. `report` and `report-viewer` stay lazily registered.
  
  Migration:
  
  - `{ "type": "spec-report", "report": { … } }` → `{ "type": "report", "report": { … } }`, with the same `report` member.
  
  **Clause-②: yes**, released as `minor` with this banner.
- 64dae8e: Six user-visible fixes across the maker surface, the assistant rail and the
  dataset captions.
  
  **The maker's start chips now promise only what ADR-0112 v1 builds
  (cloud#1984).** Two of the five asked for automation the first version has no
  flows or actions for — the ticket chip said 「状态流转」, the inventory chip said
  「低库存预警」 — and the measured behaviour was not a refusal but a silent
  degrade: a status kanban and a low-stock view. The chip promised an alert and
  delivered a page. All five are reworded in all ten packs (and in the call-site
  `defaultValue` fallbacks, which are a second copy of the same strings) to ask
  for objects, fields, views, pages, dashboards and sample data, keeping each a
  real business scenario — the ticket chip now asks for a status field and a board
  grouped by it, the inventory chip for a view that filters below the reorder
  point. A note beside the keys says to revert when v2 re-adds flows.
  
  **Five newer AI tools get their step labels (objectui#7481).** A zh conversation
  read `✓ Get authoring rules 已完成` between 「读取元数据结构」 and 「列出对象」:
  `get_authoring_rules` (cloud#1837), plus `load_tools`, `open_record`,
  `test_flow` and `toggle_flow`, are registered by the cloud AI runtime but are
  newer than the pinned spec's tool registry, so they had no `chatbot.tool.*`
  entry in any pack and fell through to the English title-caser.
  
  **The assistant rail follows the thread when you send (objectui#7480).** The
  rail and the full-page maker are the same component; what differs is width. A
  reply that still ends on screen in the wide column runs two or three times
  taller in a ~360px rail, so `StickToBottom`'s lock is escaped by the time the
  user types and the new bubble, the tool steps and the streaming answer all land
  below the fold. Every send path now re-arms the lock — including the plan-card
  "Build it" and 确认修改 approvals, whose own code comments already named this
  miss. Message APPENDS deliberately do not, so a user reading back through the
  thread mid-answer is never yanked to the bottom.
  
  **Console toasts move off the assistant composer (objectui#7482).** 「客户更新
  成功」 sat on the ChatDock composer's send button and stayed there. One defect,
  two symptoms: `apps/console` pinned the toaster to `bottom-right` — an override
  that predates ADR-0057 P3a — so a toast both covered the button and, because
  sonner pauses a toast's dismiss timer while the pointer is inside the toaster
  region, never got to run its 4s timer with a pointer resting on the composer
  underneath. The override is gone; the console takes `ConsoleToaster`'s own
  documented top-right anchor, and the 4s success duration is now pinned.
  
  **Built-in aggregate captions follow the locale everywhere (objectui#7534).**
  objectui#7258 taught `buildChartSeries()` to resolve a server-minted default
  measure through the locale map, so a chart legend read `计数` while the table
  beneath it, the KPI caption, the pivot header and the dataset preview still
  printed the server's hard-coded English `Count`. `buildDatasetFieldHelpers()`
  takes the same optional `builtinAggregateLabels`, resolving through the one
  `resolveMeasureLabel` order, and the five call sites pass it. Omitting the
  argument reproduces the previous output byte for byte, and an author-declared
  measure still keeps its own label verbatim (objectui#4106).
  
  **The activity feed stops asking for an object the environment does not have
  (objectui#7476).** A tenant environment has no `sys_activity`, so every page
  load issued a request that 404'd. Everything downstream was already correct —
  the adapter memoizes the missing collection, its logger demotes the failure, the
  feed retires as an ANSWER and the panel renders its earned empty state — so what
  is left is the request itself, and `data-objectstack` states the rule for it:
  the cure for a doomed request is not issuing it. New `useObjectPresence` reads
  the object registry the shell loads for the nav anyway; only a registry that has
  ANSWERED and lists other objects without this one skips the read. Every
  uncertainty — no provider, empty registry, still loading, errored — reads as
  before, because a wrong skip would cost a real deployment its feed.
- 26fbe09: Console telemetry can now be hard-disabled on an already-built artifact
  
  `/api/v1/runtime/config` gained `telemetry.allowClientErrorReporting`
  (objectstack#11382), and the Console now reads it. The Sentry decision becomes a
  conjunction of two independent grants — a DSN injected at **build** time AND a
  positive permission from the **runtime** — so the single pre-built SPA that both
  the hosted SaaS console and the on-premises / air-gapped EE images embed can be
  silenced by the deployment it lands in, with no rebuild and without editing files
  inside a published bundle. That was the half objectui#5522 could not close before:
  every other input to the gate is a Vite build-time variable frozen into the bundle
  as a literal, which is how an air-gapped EE Console came to send 14 Sentry
  envelopes per session to `sentry.io` carrying IP + User-Agent PII with no way for
  the customer to turn it off (objectstack-ai/cloud#1508).
  
  The permission fails **closed** in every direction: absent key, `telemetry` block
  absent, malformed payload, failed fetch, or a runtime predating the key all read as
  *do not send* — which is precisely the set of runtimes leaking today. It is a
  permission and never a source: the server supplies no DSN and cannot turn telemetry
  on for a build that carries none. Only a real boolean `true` grants; `'true'`, `1`
  and other truthy lookalikes do not.
  
  Behaviour change for deployments that already inject a DSN: reporting now also
  requires the runtime to grant permission, via
  `OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENABLED` (or `RuntimeConfigPlugin`'s
  `allowClientErrorReporting`). A build that opted in but whose runtime says nothing
  will go quiet — deliberately, since that is the same artifact an air-gapped
  customer runs.
  
  `@object-ui/app-shell` additionally exports `isClientErrorReportingAllowed()` and
  the `RuntimeTelemetry` type, so consumers read the permission through the one
  fail-closed accessor instead of writing their own optional-chain against the
  payload.
- 5173a5e: ⚠️ **Behaviour change: `current_user` predicates that have been doing nothing on
  the console form routes and in the wizard's submit gate now TAKE EFFECT.** Read
  this before upgrading if any of your form metadata gates on the session user.
  
  objectui#6010 bound the host predicate scope on the five authored-predicate call
  sites in the components form renderer, so `current_user` (plus the ADR-0068
  `user` / `ctx.user` / `os.user` aliases) resolves on `visibleWhen` / `visibleOn`
  there. Two other authored-predicate evaluators were still passing `undefined`
  for that argument, so the same authored text meant two different things
  depending on which surface opened the form (objectui#6110):
  
  - **`apps/console`'s form renderer**, on the authed internal route
    `/forms/:name`. The internal route is a runtime record surface by ADR-0089
    D1's own words (*"runtime record surfaces bind `record` + `current_user`"*),
    and its `visibleWhen` metadata is the same `*.view.ts` FormView the
    object-view chain renders — so a role gate authored once behaved differently
    depending on which route opened the form.
  - **`WizardForm`'s submit-time required re-check** (`missingRequiredByStep`),
    the gate that re-checks the whole declared field set at final submit because
    `allowSkip` can jump past a step. Its docstring promises *"the same verdict
    from all three rather than a second, divergent dialect"*, and since #6010 it
    was the divergent one.
  
  **Why nobody noticed, and why the fix is felt as a change.** `visibleWhen` fails
  OPEN: a field on screen is what you get when the predicate resolves TRUE, when
  the scope was never bound so the predicate faulted, *and* when the predicate is
  broken. Those worlds were indistinguishable, so an app that authored a
  `current_user` gate saw the field render and had no way to tell the rule was
  inert. After this change the predicate is evaluated for real, and fields and
  sections that have always been visible will disappear for the users the rule
  excludes. `requiredWhen` fails the other way (CLOSED), so a `current_user`
  requiredWhen that has been silently not applying will now start holding submits.
  
  In the wizard the change is a fix in the user's favour as well: a required field
  the wizard HID from this user was still counted as visible by the submit gate,
  so the submit was refused on a control the submitter could neither see nor fill
  in.
  
  **Before upgrading**, audit any `visibleWhen` / `visibleOn` / `requiredWhen` in
  your form-view and object metadata that names `current_user`, and confirm each
  predicate says what you actually want evaluated against `record` +
  `current_user`.
  
  **The public anonymous form `/f/:slug` is deliberately unchanged.** It is
  mounted outside `ProtectedRoute` so an anonymous visitor can submit it, there is
  no authenticated principal, and no provider is mounted above it — so its scope
  is empty and a `current_user` predicate authored on a public form still faults
  and still fails open, exactly as before. Nothing new is declared to say so: the
  two routes are told apart by which component mounts them.
  
  `@object-ui/app-shell` exports `buildExpressionUser`, the `ExpressionProvider`
  user normalisation, so every console surface that mounts the provider publishes
  the same `current_user` shape rather than re-deriving it.
- bd0376d: Read `count` / `value` answers as the contract declares them at six more seams
  (objectui#6917, following objectui#5945 / #6726 / #6840 / #6839).
  
  **One precedence inversion, repaired without deleting the arm.**
  `@object-ui/fields`' lookup chip resolved fetch-on-demand rows with
  `result?.value || result?.data || []` — `value` AHEAD of `data`, the one rows
  member `QueryResult` (`@object-ui/types`) declares. A producer emitting both was
  resolved to the undeclared key. It now reads through `@object-ui/core`'s
  `extractRecords`, whose accepted set is identical (bare array, `data`, `value`)
  and whose order is the contract's. The `value` arm is **kept**: its own producer
  census measured eight live `find()` doubles emitting `{ value: [...] }` at this
  seam (3 plugin-kanban, 3 plugin-calendar, 2 plugin-grid), so deleting it would
  break them. Only the RANK was wrong.
  
  **Five dead arms deleted, each on its own measured zero.** Every module got its
  own census with the control sitting on the producer→consumer join, because
  objectui#6840's zero is seam-local and is not transferable — the same sweep read
  0 producers for `value` at one seam and 5 at another in a single pass.
  
  - `count` at the `DataSource.find()` seam — `plugin-detail`'s reference rail and
    `plugin-list`'s ListView. 0 of 592 `find()` producers emit `count`; controls
    `data` (312) and `total` (150) lit on the same pass. Both adapters'
    `normalizeQueryResult` already fold `count` into `total` below every consumer.
  - `value` at the `client.meta.getItems()` seam — `app-shell`'s help menu and the
    console's Public Forms and Flow Runs pages. **These three do not sit on the
    `DataSource.find()` seam at all**, so they were measured on their own join: 0
    of 28 `meta.getItems` producers emit `value`; control `items` (18) lit. The
    canonical readers of that envelope (`MetadataProvider.extractItems`,
    `MetadataService.getItems`) have never had a `value` arm either.
  
  No producer changes behaviour, because at these five sites there is no producer;
  what changes is that a non-conforming one is refused rather than silently
  absorbed (AGENTS.md #0.1).
  
  `QueryResult` is **not** widened to bless `count` or `value` — a published-type
  change and the maintainer's call, the floor objectui#6726, #6840 and #6839 all
  held. A producer that really speaks either belongs behind an adapter that folds
  it, which is what both adapters already do.
  
  One refusal pin per module, each keeping the live arms green beside the deleted
  one, and — where an inversion actually existed — a case feeding both members with
  different contents, the only input that can tell the two orders apart.
  
  Also repaired: two `plugin-grid` test doubles answered `{ value: [],
  '@odata.count': 0 }` while `ObjectGrid` reads `result.data` / `result.total`.
  Inert only while the arrays were empty; the first row put in one would have been
  silently dropped. Test-only.
- 3fa3b3e: The console's error-recovery exits follow the declared landing (objectui#7373).
  
  `app.isDefault` declares where a deployment's home is, and objectui#7256 (PR #7372)
  made the console chrome's four Home affordances read it through `useHomePath()`.
  The "you cannot be here" exits kept naming the environment launcher literally, so a
  control-plane customer who hit one landed on a screen whose "Build an app" /
  "Start from a template" cards act on an environment their deployment does not have
  and whose "Your apps" tiles are the control plane's own internal management apps.
  
  Retargeted onto the existing policy — no new one was written:
  
  - `AppContent` — the access-denied screen's "Back to home", and the bounce for a
    viewer with no app to enter;
  - `RequireAiSurface` — a runtime that serves no AI agent (its `redirectTo` prop
    still wins when a host passes one; only the default moved);
  - `AiChatPage` — the no-agent screen's Home, and the collapse-to-dock landing on a
    cold deep link. `resolveCollapseToDockTarget` now takes the home path as a
    required argument instead of naming one;
  - `StudioDesignSurface` — eviction when the package under the editor is deleted,
    and the header's Home button;
  - `apps/console`'s `/studio` entry gate and the Studio front door's wordmark.
  
  Accepting an organization invitation follows the declaration too, by a different
  route and for a measured reason: it runs immediately after `switchOrganization`,
  so the app list in hand there still belongs to the organization being LEFT
  (`MetadataProvider` drops its cache on an org change and refetches after that line
  has run). Reading the declaration in place would name the previous organization's
  app. It now reloads onto the console ROOT — the shape `WorkspaceSwitcher` and
  `OrganizationsPage` already use for this same transition — so
  `RootLandingRedirect` resolves the landing for the organization the user has just
  joined.
  
  Every ordinary environment is unchanged: where nothing declares a landing, and
  wherever the app list is not (yet) an answer, the resolved path IS `/home`.
  
  Two sites deliberately keep the launcher: `HOME_LAUNCHER_PATH` itself (it is the
  launcher, and the fallback all of the above resolve through — ADR-0075), and
  `RootRedirect`, which is `/`'s landing rather than a recovery exit and has its own
  resolver.
- 77b2a18: Load locale catalogues on demand — the ten packs leave the eager closure (objectui#7479)
  
  `@object-ui/i18n`'s entry re-exported all ten catalogues and `builtInLocales`
  named every one of them in a single object literal, so every import of the
  package made all ten statically reachable and nothing could tree-shake them.
  The console fetched **456,196 gzipped bytes** of translation data before first
  paint, for a viewer who reads one catalogue — and every new translation key was
  paid for by every visitor in every language.
  
  **What changed at the contract.** `en` stays statically re-exported from the
  entry; the other nine are fetched per locale through the new
  `loadBuiltInLocale()`. `en` is not an exemption, it is what makes the split
  safe: it is `fallbackLng`, it is the source of the `TranslationKeys` type, and
  it is the synchronous dictionary `@object-ui/app-shell`'s splash renders from
  before i18n is usable and on the server-down path. Removing it would have meant
  raw keys on screen in nine languages, or English literals in the splash — the
  "delete or untranslate the copy" route this work was explicitly not allowed to
  take.
  
  New on the entry, all of them payload-free:
  
  - `loadBuiltInLocale(code)` — fetch one catalogue; `null` for a code this
    package does not ship. Memoised, and a failed fetch stays retryable.
  - `getLoadedBuiltInLocales()` / `isBuiltInLocaleLoaded(code)` — what is resident
    right now, synchronously.
  - `BUILT_IN_LANGUAGE_CODES` / `isBuiltInLanguage(code)` — enumerate all ten
    without fetching any of them.
  - `preloadBootstrapLocale(options)` / `resolveBootstrapLanguage(options)` —
    resolve the boot language and fetch its catalogue BEFORE the first render.
  - `pickInitialLanguage(config)` — the language `createI18n` will boot in.
  
  `I18nProvider` fetches the catalogue for whatever language it boots into, and
  `changeLanguage()` awaits the new catalogue before switching, so a switcher
  needs no new wiring.
  
  **BREAKING for an importer of a specific pack.** `zh`, `ja`, `ko`, `de`, `fr`,
  `es`, `pt`, `ru`, `ar` and `builtInLocales` are no longer exported from
  `@object-ui/i18n`. They are exported from the new `@object-ui/i18n/locales`
  subpath, which is the explicit all-ten door — a specifier whose cost is visible
  at the import site. ⚠️ Never reach for it on a page-load path. (Marked `minor`
  rather than `major` per this repository's version-alignment rule; the breaking
  semantics are stated here.)
  
  **What a page load costs now.** Two full console builds in one container, same
  instrument, `origin/main` `d8b4739d4` against this change:
  
  | reading                     |   control |     after |    delta |
  |-----------------------------|----------:|----------:|---------:|
  | eager closure, gzipped      | 3,575,370 | 3,164,817 | −410,553 |
  | eager chunks / total        |    50/518 |    51/528 |          |
  | catalogues in that closure  |        10 |         1 |       −9 |
  | `vendor-objectstack`        | 1,236,315 | 1,236,315 |        0 |
  | `ui-components`             |   394,726 |   394,718 |       −8 |
  | `framework`                 |    80,414 |    80,430 |      +16 |
  
  The last three rows are the control that makes the first one readable: the bytes
  did not move to a roomier chunk, they left the eager closure. The nine deferred
  catalogues weigh 405.5 KB gzipped and the browser fetches exactly one of them,
  only when the viewer's locale is not `en`.
  
  **Gates.** `PER_CHUNK_GZIP_CEILINGS['i18n-locales']` (465,000 over ten
  catalogues) is replaced by `['i18n-locale-en']` at 50,000 over 40,415, and
  `MAX_EAGER_CLOSURE_GZIP_BYTES` comes down from 3,597,000 to 3,210,000 — both
  LOWERINGS that follow the measured drop, and the aggregate one is required: left
  where it was, its headroom would have been 4.74x the regression this gate must
  catch and the sensitivity half would have called the gauge blind. The
  `i18n-locales` entry in `EXHAUSTED_HEADROOM_ALLOWANCES` is removed rather than
  lowered — its chunk no longer exists, and the catalogue that remains clears the
  floor on its own.
  
  A new gate, `pnpm check:eager-locale-catalogues`, weighs COMPOSITION rather than
  bytes: exactly one catalogue may be in the built eager closure, and it must be
  the resident one. A byte ceiling cannot catch the catalogues returning one at a
  time inside its headroom, and cannot tell "left the closure" from "moved to a
  chunk with more room".
  
  **Correction, 2026-10-01 (objectui#11326).** The list above says
  `loadBuiltInLocale(code)` resolves `null` for a code this package does not ship,
  and pairs `isBuiltInLanguage(code)` with the ten codes. That was true when this
  change was written, and it no longer is: objectui#11326 looks a code up exact
  tag first, then its base language, so `loadBuiltInLocale('zh-CN')` resolves the
  `zh` catalogue and `isBuiltInLanguage('zh-CN')` is `true`. A code with no
  catalogue for the tag or for its base still resolves `null`, and
  `BUILT_IN_LANGUAGE_CODES` still lists the ten.
- c2f0f48: feat(console): a "Language" item on the profile page, writing the signed-in user's own
  `sys_user.locale` (objectui#7501).
  
  The platform made that column user-writable on 2026-09-03 and nothing in the product let
  anyone set it — the profile page edited `name` and the avatar and carried no language
  control at all, which is the `{name, image}` whitelist the ruling widened. Two people in
  one deployment were already receiving their notifications in different languages with no
  way for either of them to choose.
  
  The new card reads and writes the user's own `sys_user` row through the data adapter, and
  it is deliberately a card of its own rather than another field in the Personal Information
  form: that form is written by `useAuth().updateUser`, which posts to better-auth's
  `/update-user`, and `locale` is not a better-auth `additionalFields` entry, so that
  endpoint cannot carry the column. Its feedback vocabulary is the form's — the same success
  and failure `Alert`s, the same disabled-while-saving submit.
  
  What it offers is the i18n provider's own `offerableLanguages` (the deployment's published
  locales intersected with what this renderer can resolve) — the same set `LocaleSwitcher`
  renders, so no second language list is introduced. Each entry is named in its own language.
  A stored tag the deployment no longer publishes is shown rather than dropped, so the
  control never displays a value that is not the account's.
  
  Clearing is a first-class option: "Use the deployment default" writes `null`, which is the
  documented meaning of an unset column and the only way back once a tag has been stored.
  
  A refused tag (`400 VALIDATION_FAILED` with a per-field `locale` entry) is rendered on the
  item, with `aria-invalid` and `aria-describedby` pointing at it, rather than as an
  undirected alert. When the deployment's write route is not this user's — the field/object
  permission answer for `sys_user.locale` — the control is read-only and says why instead of
  offering a button that would answer 403, and it does not render at all while the row is
  unread or if the read is refused.
  
  **This does not change the interface language.** The UI language is a per-device
  preference the i18n provider keeps in `localStorage` and the globe menu switches;
  `sys_user.locale` is a per-user server column read per recipient at delivery time. The two
  stayed separate here on purpose; whether they should be joined is a product decision that
  has not been made.
  
  `@object-ui/i18n` gains the seven `profile.language.*` keys, in all ten packs.
- 0ea7054: Remove 37 runtime dependencies that no file in the declaring package consumes, and gate
  the direction so the next one cannot land (objectui#8198).
  
  `check:phantom-deps` judges imports that are not declared; nothing judged the reverse,
  so a declaration could outlive its last consumer indefinitely. That is what happened to
  `recharts` in `@object-ui/components` after objectui#7397 deleted its only importer — it
  was removed by hand on objectui#7625, and nothing would have reported the next one. The
  new `pnpm check:unused-deps` asks the reverse question over `dependencies` and
  `optionalDependencies` of every released package.
  
  **Potentially breaking, for consumers relying on hoisting.** Nothing these packages ship
  changes: their Vite `external` predicates are path-based and never read `dependencies`,
  so no built artifact moves. What changes is the install graph — a project that imports
  one of the removed packages while depending only on the ObjectUI package that used to
  drag it in will no longer resolve it. Declare it directly; that is the correct
  dependency edge in either case. The removals, by package:
  
  - `@object-ui/plugin-designer`: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@object-ui/fields`
  - `@object-ui/plugin-chatbot`: `react-markdown`, `react-syntax-highlighter`, `remark-gfm` (and the orphaned `@types/react-syntax-highlighter`)
  - `@object-ui/plugin-report`: `@object-ui/plugin-grid`, `clsx`, `react-i18next`, `tailwind-merge`
  - `@object-ui/plugin-map`: `@objectstack/spec`, `lucide-react`, `zod`
  - `@object-ui/runner`: `class-variance-authority`, `clsx`, `tailwind-merge`
  - `@object-ui/core`: `lodash`, `zod`
  - `@object-ui/layout`: `clsx`, `tailwind-merge`, and `react-dom` — which it pinned at an exact version in `dependencies` while also declaring it as a peer range, i.e. a library hard-depending on the renderer it asks its host to supply
  - `@object-ui/plugin-dashboard`: `clsx`, `tailwind-merge`, and the same `react-dom` defect
  - `@object-ui/plugin-ai`: `@object-ui/react`, `clsx`, `tailwind-merge`
  - `@object-ui/fields`: `clsx`, `tailwind-merge`
  - `@object-ui/console`: `@object-ui/react-runtime`, `sucrase`
  - `@object-ui/auth`: `@object-ui/types`
  - `@object-ui/plugin-calendar`: `@object-ui/fields`
  - `@object-ui/plugin-editor`, `@object-ui/plugin-markdown`: `@object-ui/react`
  - `@object-ui/react`: `react-hook-form`
  
  Every one was verified by a whole-package grep before removal — the name appeared nowhere
  under the package but its own manifest and CHANGELOG — and the whole workspace builds,
  type-checks and tests green afterwards.
- 270f282: Six hand-rolled em-dash placeholders now draw the shared `EmptyValue` from
  `@object-ui/components` (objectui#8504), closing the *no accessible name* half
  of the class objectui#8491 / PR #8503 opened.
  
  **The accessibility defect.** Each site built its own `<span>` holding a bare em
  dash. `EmptyValue` carries three things none of them had: a `data-slot` of
  `empty-value`, an `aria-label` resolved through the i18n label hook, and
  `select-none` / `no-underline` / `pointer-events-none`. So a screen-reader user
  reaching one of these cells heard a naked punctuation mark, while a neighbouring
  cell drawn by a type-aware renderer was announced as "No value". Two of the
  sites make the inconsistency reachable inside one surface: the metadata list
  renders column 0's placeholder *inside the row's `<Link>`*, where the
  hand-rolled span inherited the link colour and stayed selectable, and the
  dashboard record drawer sits next to renderers that already returned the shared
  component.
  
  The six: the metadata list's `defaultCell` and the Audit tab's lock column
  (`@object-ui/app-shell`), the dashboard record drawer's empty `<dd>`
  (`@object-ui/plugin-dashboard`), the import wizard's saved-mapping transform
  cell (`@object-ui/plugin-grid`), the AI-approvals `JsonBlock`
  (`@object-ui/plugin-chatbot`), and the Public Forms object column
  (`@object-ui/console`).
  
  **A deliberate visual change, not a no-op.** Five sites drop
  `text-muted-foreground` (or `/60`) for the shared `text-muted-foreground/50`, so
  every placeholder in the workspace is now one colour. The glyph is unchanged
  everywhere. The sixth, `JsonBlock`, keeps its `text-xs` through `className`
  because it stands where a `text-xs <pre>` would and has no shared neighbour to
  match — its delta is the accessible name and the three affordances only.
  
  **Two adjacent lines in the same file, taken deliberately.** The AI-approvals
  drawer's `proposed_by` / `decided_by` fields fell back to a bare `'—'` text node
  inside a plain `<div>` — a different source spelling of the same rendered
  defect, individually verified on the card rather than swept up. They are
  converted too. `formatRelative`'s `if (!s) return '—'` is not: that helper is
  declared `: string`, so its fallback is not a node.
  
  Filled values are untouched in every path.
- 6a4680b: Retire `line-chart`, `area-chart` and `advanced-chart` — three chart component keys the
  console registered as lazy stubs that `@object-ui/plugin-charts` never fulfilled
  (objectui#8760).
  
  **The defect, and why it outlived the checks.** `apps/console` registered ten chart
  variants as `registerLazy` stubs pointing at `@object-ui/plugin-charts`. That package
  registers eight keys; three of the ten were not among them. An unfulfilled stub does not
  fail — it succeeds at being useless, in both of the places that decide whether a defect
  is ever seen:
  
  - **At render.** `SchemaRenderer`'s lazy branch re-checks `hasLazy(type)` on every pass
    and returns the `Loading <type>…` placeholder. `Registry.register()` deletes a lazy
    entry only for keys the loaded module actually registers, so for an unfulfilled key the
    entry SURVIVES the load and every later pass takes the same branch. Measured on
    `b775500af` through the real chain: `{ "type": "line-chart" }` painted
    `role="status"` / `data-lazy-loading="line-chart"` / `Loading line-chart…`,
    permanently. **Not** the `OBJUI-001` panel the card expected — no alert, no error, no
    console warning. A skeleton that never resolves reads to a user as a slow network.
  - **At authoring.** A stub is enough to put a key into `getKnownTypes()`, so
    `check:doc-types` and the CLI's generated `KNOWN_SCHEMA_TYPES` snapshot both blessed
    all three. `content/docs/plugins/plugin-dashboard.mdx` taught `"type": "line-chart"`
    inside a `card` body, and every gate was green on it.
  
  So the failure was strictly worse than an unknown key: an unknown key is refused loudly at
  authoring time, while these passed every check, were taught by the documentation, and
  failed only at render in front of a user.
  
  **Why removal rather than implementation.** Both repairs were available and they are not
  equivalent. Fulfilment would mint three new pieces of authorable surface: `line-chart` and
  `area-chart` duplicate, under a second spelling, families the plugin already draws as
  `{ "type": "chart", "chartType": "line" | "area" }`, and `advanced-chart` was never a
  family at all — it named `AdvancedChartImpl`, an internal module. Measured demand for all
  three is zero: a sweep of both repositories for authored nodes of these types returns
  exactly one hit, the doc snippet corrected here, against lit controls in the same
  commands (`"type": "bar-chart"` 5, `"type": "chart"` 12, `object-chart` 1 in the sibling
  repo). No example app, fixture, seed document or deployment authors any of them. Under
  声明即强制, a declaration with no delivery and no demand comes off rather than growing an
  implementation to match it.
  
  **Breaking, for anyone who authored a retired key.** A document with
  `{ "type": "line-chart" }` used to resolve in the registry and then draw nothing; it is
  now refused by name — `SchemaRenderer` paints the `OBJUI-001` panel instead of an endless
  skeleton. `objectui validate` refuses the document at `type` (`invalid_union`). That is a
  louder failure for the same broken document, not a new one: no document that previously
  DREW is affected. Migrate to `{ "type": "chart", "chartType": "line" | "area" }`, which
  `CHART_TYPE_KEYWORD_FAMILIES` resolves. Scored `minor`, not `major`, per
  AGENTS.md §版本号策略.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` warns only in a file it recognises —
  objectui#10606.** This entry first said `objectui check` reports `Unknown schema type
  "line-chart"` for that document. `check` checks the `type` of each file it recognises, and a
  file whose root carries an ObjectUI structural key (`children`, `className`, `body`, …) is
  recognised by that key alone. A file with none of those keys is parsed against the schema
  and recognised only if it validates; one that does not validate is listed by name when its
  root `type` is on the known-type list `check` reads, and is otherwise counted as skipped.
  `line-chart` is no longer on that list, so `{ "type": "line-chart" }` is counted as skipped
  ("no ObjectUI recogniser admitted") and gets no unknown-type line, while
  `{ "type": "line-chart", "className": "h-64" }` gets one. `check` exits non-zero on
  unreadable JSON only; the verdict is `objectui validate`'s.
  
  **What moved.** The stub lists in `apps/console/src/register-plugins.ts` and
  `apps/console/src/preview-gallery.tsx` (both loops, because the doc gate's key universe is
  their union — retiring one alone would have changed nothing observable); the dashboard doc
  snippet plus a note on how chart families are actually spelled; the regenerated
  `KNOWN_SCHEMA_TYPES` snapshot (six entries, three bare and three namespaced); and the
  `line-chart` leg of `node-slot-registered-arms-8499.test.ts`, whose premise this
  retirement changed and which reads the stub list rather than the file so the ⛔ comment
  left behind cannot satisfy it.
- 093af32: Take the `@objectstack/*` line to 17.4.0 and follow every contract it moved
  (objectui#8772, with #7783 · #7663 · #8172 · #7845 · #8785).
  
  **Breaking on one authored key, deliberately.** A dashboard node's
  `refreshInterval` is now `refreshIntervalSeconds` — the value is unchanged
  (seconds), and the spec refuses the old spelling by name with a message naming
  the new one, so an existing document fails loudly at parse rather than silently
  losing its auto-refresh. `os migrate meta --from 17` lists the mechanical edits.
  The report component's own `refreshInterval` is a different key and is NOT
  affected. (Scored `minor`, not `major`: this repo's fixed group tracks the
  `@objectstack` major — AGENTS.md §版本号策略.)
  
  Also authored-surface changes, all following a published spec move rather than a
  local decision:
  
  - `element:record_picker`'s `filter` input is now the `ViewFilterRule` array
    form `[{ field, operator, value }, …]`. The MongoDB-style record form is
    refused by the contract (objectstack#14406 converged the last record-form
    `filter` in the map), so a JSX page writing the array form no longer draws a
    false `type-mismatch` and one writing the record form is told.
  - `object-kanban` now publishes `limit`, the row cap its renderer has always
    lowered to `$top`. The spec declares it as of objectstack#16503, so the key
    the docs teach is finally one the save gate stores.
  - `object-gantt`'s ten extension keys (`timeSegments`, `interactions`,
    `lockField`, …) are derived from the spec's `GanttConfigSchema` instead of
    being re-declared locally. Same accept set on the flat face; the nested
    `gantt` block narrows to the spec's, which now refuses an undeclared sub-key
    by name where its `.passthrough()` window used to admit one.
  - The console's preview-gallery samples — the worked examples an author copies —
    move with two spec changes of their own: a job's `timeout` is now `timeoutMs`
    (same unit-in-the-key-name ruling as the dashboard key above), and a flow's
    end node writes `outcome: 'completed'`, the enum having narrowed to
    `completed | refused`.
- 345e24a: **BREAKING** — `RecordContextValue.dataSource` is the DataSource **adapter** it
  has always held, not a datasource id string.
  
  **FROM** `dataSource: 'ds_primary'` **TO** `dataSource: myAdapter` (any
  `DataSource` from `@object-ui/types`).
  
  ```ts
  // before — compiled, but no producer ever did this and no reader could use it
  const ctx: RecordContextValue = { objectName: 'account', recordId: 'r1', dataSource: 'ds_primary' };
  // after
  const ctx: RecordContextValue = { objectName: 'account', recordId: 'r1', dataSource: myAdapter };
  ```
  
  The member was declared `dataSource?: string` — "an optional datasource id;
  mirrors the page-level datasource override" — while the one production host
  that writes it (`@object-ui/app-shell`'s `RecordDetailView`) forwards an adapter
  OBJECT and every reader calls adapter methods on it. Measured on the base tree:
  of the provider sites in this repository that write the member, exactly one is
  non-test and it passes the adapter; the only in-repo writer of a string was a
  test fixture, which existed because the declaration invited it. So the id was
  never a contract anyone kept — it was a statement the code contradicted at every
  site, and the override it described has zero producers. Contract-first
  (Commandment #0.1): the declaration moves to what the code holds, and no second
  `dataSourceId` member is minted for a requirement nobody implements.
  
  What it bought: each reader paid for the wrong declaration with a cast at the
  point of use, and a cast deletes the compiler's answer to "does this adapter
  have the method I am about to call". All 11 record-context read sites are now
  cast-free, across `@object-ui/app-shell`, `@object-ui/components` and
  `@object-ui/plugin-detail`. The worked instance is objectui#8883's reference
  rail: it reaches `dataSource.getObjectSchema` — a REQUIRED member of
  `DataSource` — and now gets that guarantee from the compiler instead of from
  `(ctx as any)`.
  
  ⚠️ Nothing to migrate at runtime and no data change: every producer already
  passed the adapter, so no value moving through this member changes. A
  TypeScript consumer outside this repo that read the member as `string` is not
  observable from here and gets a compile error (TS2322) naming the key — which
  is why the FROM/TO is spelled out above. Re-widening to `string | DataSource`
  would not be a kindness: a union member without `getObjectSchema` cannot be read
  without narrowing, so it re-breaks every reader this change repaired. Both
  directions are pinned against the real compiler in
  `RecordContext.dataSourceType.pin.test.ts`.
  
  ⚠️ `SchemaRendererContextValue.dataSource` one context over is a **different**
  declaration (`any`) and is **not** touched here. Five `as any` reads in
  `@object-ui/fields` key off that context, not this one; they are unaffected by
  this change and are reported separately.
  
  objectui#9197.
- c8da8b3: Stop showing an access-denied screen to a real administrator while their
  adminship is still resolving.
  
  `useIsWorkspaceAdmin()` returned a bare `boolean`, so "the inputs have not
  arrived yet" and "resolved: not an admin" were the same answer. One of its three
  sources — the active organization member row — is fetched some round trips after
  the session (`listOrganizations` → `getActiveOrganization` → `getActiveMember`),
  so an administrator whose adminship lives only in that row rendered at least
  once as a non-admin, and every gate downstream acted on it: the two marketplace
  surfaces painted `MarketplaceAccessDenied`, the console chrome dropped and
  re-added its admin nav entry, and `AppContent` fired a `<Navigate to="/home"
  replace>` that the later flip could not undo.
  
  **Breaking (published API, hence `minor` per this repo's version policy):**
  `useIsWorkspaceAdmin(): boolean` is replaced by
  `useWorkspaceAdminStatus(): { isAdmin: boolean; isResolved: boolean }`. The old
  name is removed rather than kept alongside, so a call site that ignores the
  third state fails to compile instead of silently refusing an administrator.
  
      -const isAdmin = useIsWorkspaceAdmin();
      +const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  
  `AuthProvider` gains `isMembershipResolved` on its context — the organization /
  member pipeline has reached a terminal state — because `organizations`,
  `activeOrganization` and `activeMember` read `[]` / `null` / `null` both before
  the pipeline starts and after it finds nothing.
  
  No extra wait for administrators: `isResolved` is true the instant `isAdmin` is,
  so an admin the session already identifies through `positions[]` never waits on
  the member row.
- 14ef9f5: Console error reporting is now configured entirely by the **server**: the DSN and every
  knob that travels with it arrive on `GET /api/v1/runtime/config`, and the build-time
  `VITE_SENTRY_DSN` path is retired (objectui#5522, consumer half of objectstack#12681).
  
  ObjectStack's users consume a **prebuilt** Console. Under the previous two-key gate —
  a build-time DSN **and** a runtime permission — a build-time key was unreachable for
  them, so a self-hosting operator could not enable client error reporting at all: the
  permission was reachable and the source was not. The maintainer named it on 2026-08-27:
  
  > 「我是一个开发平台呀，我的用户并不会去构建我的前端，我理解这种应该在服务端传进去。」
  
  ```
  send  ⇔  the runtime served a DSN
  ```
  
  **The DSN's presence IS the grant.** There is no companion permission flag, and the one
  that briefly existed is removed rather than paralleled. Two knobs in two places produced
  two silent dead states — "permission on, no DSN" and "DSN in, permission off" — that look
  identical from the browser; one knob cannot disagree with itself. Turning reporting off is
  unsetting the server DSN, and there is deliberately no build-time force-off left, because
  nobody consuming a prebuilt console could reach one.
  
  The fail-closed posture is unchanged and structurally stronger. Absence of a *source* is
  not a value that can be misread, so a runtime predating the key, a third-party host, a
  404, a network failure, a malformed body and a config that has not arrived yet all read as
  off — where the boolean needed a strict `=== true` plus a written argument about why a
  negative `disabled` flag would have been vacuous on exactly the runtimes that were leaking.
  
  ### What moved, and the one thing that did not
  
  `sendDefaultPii`, `environment`, `tracesSampleRate` and the error-session replay rate move
  into the runtime payload. They were build-time variables, so a prebuilt-console consumer
  could set none of them — including the one deciding whether IP and User-Agent leave their
  network. This is not new surface; it is the same surface moved to the side that can
  operate it.
  
  `VITE_SENTRY_RELEASE` **stays build-time**, and is now the only `VITE_SENTRY_*` variable
  that exists. A release identifies which bundle produced a stack trace and must match the
  source maps that bundle's pipeline uploaded — a property of the build, which no server can
  know. `VITE_SENTRY_ENABLED`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_TRACES_SAMPLE_RATE`
  and `VITE_SENTRY_REPLAY` are retired along with `VITE_SENTRY_DSN`.
  
  ### Breaking
  
  | FROM | TO |
  |:--|:--|
  | `VITE_SENTRY_DSN=…` in the Console build environment | `OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN=…` on the ObjectStack runtime |
  | `VITE_SENTRY_SEND_DEFAULT_PII=true` | `OS_TELEMETRY_CLIENT_ERROR_REPORTING_SEND_DEFAULT_PII=true` |
  | `VITE_SENTRY_ENVIRONMENT=…` | `OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENVIRONMENT=…` |
  | `VITE_SENTRY_TRACES_SAMPLE_RATE=…` | `OS_TELEMETRY_CLIENT_ERROR_REPORTING_TRACES_SAMPLE_RATE=…` |
  | `VITE_SENTRY_REPLAY=true` | `OS_TELEMETRY_CLIENT_ERROR_REPORTING_REPLAY_SAMPLE_RATE=0.1` |
  | `VITE_SENTRY_ENABLED=false` | unset the runtime DSN |
  | `isClientErrorReportingAllowed(): boolean` | `getClientErrorReporting(): RuntimeClientErrorReporting \| null` |
  | `resolveSentryGate(env, runtimeAllows)` | `resolveSentryGate(runtimeErrorReporting)` |
  | `RuntimeTelemetry.allowClientErrorReporting: boolean` | `RuntimeTelemetry.errorReporting?: RuntimeClientErrorReporting` |
  
  One-line fix for a deployment: move your `VITE_SENTRY_*` values onto the ObjectStack
  server as the `OS_TELEMETRY_CLIENT_ERROR_REPORTING_*` variables above, and drop them from
  the Console build environment. One-line fix for a consumer of `@object-ui/app-shell`:
  `const sink = getClientErrorReporting(); if (sink) …` in place of
  `if (buildTimeDsn && isClientErrorReportingAllowed())` — the build-time conjunct is gone,
  because the server now supplies the source.
  
  **Landing order is safe in both directions.** A Console built before this change meets a
  new server, reads an absent `allowClientErrorReporting` and stays off; a Console built
  after it meets an old server, reads an absent DSN and stays off. Neither half can turn
  reporting on by itself, so the two repos' PRs can land in any order.
  
  The `committed-telemetry-endpoint.test.ts` ratchet is unchanged in rules and unchanged in
  job: nothing endpoint-shaped may be committed to this repo. Its rules key on the
  variable's suffix and on the value rather than on the `VITE_` prefix, so they already
  cover the runtime-side spelling — now pinned, so a later tidy-up cannot narrow them to the
  retired names and reopen the hole under a new one.

### Patch Changes

- 3ac2de8: Localize the Studio front door's wordmark tooltip (objectui#10043).
  
  The `/studio` landing's wordmark carried its `title` tooltip as a hard-coded literal
  in one language, outside i18n entirely — the only user-visible string on that surface
  that never reached a translation bundle, so every other locale read it in that one
  language. AGENTS.md commandment #-1 names titles in the categories it covers.
  
  It now resolves through `useObjectTranslation` and a new `console.studio.backToHome`
  key, which is the mechanism the rest of this app's chrome already uses (the same route
  objectui#4024 took for the settings screen, whose chrome was hard-coded beside a keyed
  sibling). The key ships in all ten locale packs, and each pack's value is that pack's
  own existing wording for this affordance rather than a new translation — the sibling
  Home button one route away inside the same frame says the same thing, and the two must
  not name the same home two different ways.
- 7725c10: fix(console): a `file` field on a FormView renders the shared upload control, not a text box
  
  `/f/:slug` and `/forms/:name` render through `FormPage`, whose hand-rolled input
  switch had no `file` arm — so a `file` field fell through to the default text
  input. Typing a filename into a text box uploads nothing, which made the
  capability absent on those two routes rather than merely degraded.
  
  The arm does not hand-roll a second file control. It asks ADR-0059's resolver
  (`resolveFormWidgetType` + `getLazyFieldWidget` in `@object-ui/fields`, the door
  `@object-ui/app-shell`'s `ActionParamDialog` is already on) for the same widget
  the record form renders, so the value this route submits is the one the other
  renderer submits: the `sys_file` id the upload adapter minted, or the legacy
  inline blob when the adapter surfaced none.
  
  Two supporting halves, both in the same file. The object field's declared
  `multiple`, `accept` and `maxSize` now reach the widget — this app's narrowed
  view of the object payload admitted none of the three, so the control would have
  been single-file, unfiltered and unbounded whatever the author wrote. And submit
  is blocked while an upload is in flight, which is what the widget contract's
  `onUploadingChange` exists for: a file's value only becomes an id once the
  adapter settles, so a submit that beats it stores nothing and still reports
  success.
  
  ⛔ The other field types this switch does not spell are untouched. Which ones
  those are is enumerated on objectui#10167, for the separate decision about
  whether this renderer should hold a switch at all.
  
  ⚠️ **Dated note, 2026-09-27 — a no-id pick is now refused in the widget, not submitted as an inline blob — objectui#7699.**
  
  The paragraph above describes this route's write at the time it was written. Since objectui#7699, a pick whose adapter surfaced no id is refused in the widget and never submitted as an inline blob; the value this route submits is only ever the `sys_file` id the upload adapter minted, never the legacy inline blob. The rest of this entry is kept as the reading of this change; objectui#7699's own changeset states what a no-id pick does now.
- 069ce12: fix(console): `FormPage`'s required `*` no longer lands in the control's accessible name
  
  `/f/:slug` and `/forms/:name` render through `FormPage`, which draws the required
  marker as a `*` inside the field's `label`. The label is the control's accessible
  name, so a screen reader announced "Title *" instead of "Title". The marker is
  now `aria-hidden`, the rule `ActionParamDialog` already follows (objectui#3299):
  the requirement is announced as a state on the control, and the `*` is for
  sighted users only.
  
  The text-like, number, date/time, select and textarea controls already carried
  native `required`, and the `file` control `aria-required`, so they still announce
  it. The checkbox control carried neither, so it now gets `aria-required`. It does not get native `required`: on a checkbox
  that means "must be checked", and the required rule counts `false` as a value.
- b57107d: fix(auth,app-shell,console): a browser that changes hands no longer keeps the previous account's UI language
  
  Both device language slots (`objectui-locale` and `objectui-locale-seed`) hold the
  language of whoever last signed in on the browser. A boot resolves its language from
  them before anyone is signed in. When the session then turns out to belong to someone
  else (an SSO redirect back into the console, or a sign-in in another window),
  `SessionUserScope.adopt` already purged both slots (objectui#5664). But the live
  language had already been derived from them, and nothing re-derived it. A new account
  with no `sys_user.locale` of its own therefore read the previous account's language
  for its whole first session.
  
  - `@object-ui/auth` (new exports, hence minor): `getSessionOwnerChangeCount()` and
    `subscribeSessionOwnerChange(listener)` report that the change-of-owner purge ran
    in this page-load. They are held in memory, with no new storage key.
    `SessionUserScope.adopt` now returns `true` when it purged a previous owner.
  - `@object-ui/app-shell`: `useSignedInUserLocale` resets the UI language on an owner
    change, the same way a boot of the swept storage would resolve it. It then
    re-reads the new owner's `sys_user.locale`, which applies after the reset.
  - `@object-ui/console`: `LocalizationFetchProvider` and the boot-time seed fetch no
    longer write an answer that was requested before an owner change. Such an answer
    describes the previous owner.
  - `@object-ui/i18n` (docs only): the seed was documented as the "tenant's" locale.
    It is the server's resolved locale for the signed-in caller: their own
    `sys_user.locale`, else `Accept-Language`, else the deployment default. The docs
    now say so, and declare what a visitor who has not signed in reads: the last
    owner's language, until someone else signs in.
- d3d134b: Two more dates now follow the display locale, not the UI language (objectui#10375).
  
  - `CommentThread` (`@object-ui/collaboration`): a comment seven or more days old shows an absolute
    date, and that date now takes its locale from `useDisplayLocale()`. It used to format with the UI
    language, so a regional display locale was ignored: an English UI with a `de-CH` display locale
    read `3/4/2020` where it now reads `4.3.2020`. With no display locale declared, and with no
    provider mounted at all, the date renders as before, because the display locale then falls back
    to the UI language. A malformed display locale still falls back to the runtime's own date format,
    never to the raw ISO string.
  - The approvals inbox (`@object-ui/console`): once a submitted, completed or history timestamp is
    30 days old (rounded to the nearest day), the inbox shows a date instead of "Nd ago", and that
    date now takes the page's display locale in the same way.
  - The relative wording ("just now", "5m ago", "3d ago") is unchanged on both faces and stays in the
    UI language.
- 747f334: An app's own favicon no longer turns into the operator favicon after an in-app
  navigation (objectui#10379). This is the favicon twin of the tab-title race that
  objectui#8637 fixed.
  
  Two effects wrote the icon link, keyed on different inputs. The console's
  `FaviconSync` was keyed on `useLocation()` and wrote the operator favicon (the
  runtime config's `branding.faviconUrl`) on **every route change**.
  `useAppShellBranding` writes the active app's `branding.favicon` from an effect
  keyed on that URL, so it fires when the app's branding changes and not on
  navigation. With an operator favicon configured, moving between two pages of the
  same app ran only the route-keyed writer, and the operator's icon replaced the
  app's until the user left the app.
  
  The repair is one writer, the same as for the title. `FaviconSync` no longer
  writes the favicon, and it now writes nothing at all. Nothing else needed to
  change: the operator favicon is on the icon link before React mounts, written by
  the pre-boot script in `index.html` and by `main.tsx` from a runtime config that
  `main.tsx` awaits before the first render. Since objectui#10040 the shell also
  captures the icon it finds and restores it when it unmounts. So inside an app
  with its own favicon the tab keeps that favicon, and leaving the app shows the
  operator favicon again. An app without its own favicon shows the operator
  favicon throughout, and a deployment with no operator favicon is unaffected.
- 64563a9: **BREAKING (node type key):** `@object-ui/plugin-map` no longer registers the bare
  `map` node type key, and its namespaced twin `view:map` goes with it. A node
  authored `"type": "map"` no longer resolves a renderer. Write
  `"type": "object-map"` — the one spelling the plugin serves (objectui#10393,
  executing the objectui#8008 family ruling of 2026-09-09 that retired the bare
  `gantt` and `kanban` keys).
  
  **Why.** The registry mounted a `map` node while the published declaration refused
  it: `ObjectMapSchema.type` is the literal `'object-map'` and `AnyComponentSchema`
  has no `map` arm, so `safeValidateSchema` answered a `map` node with
  `invalid_union` while the html tier accepted it. Two faces, opposite verdicts.
  No schema face ever declared `map` as a component node type, so there is no arm
  to turn into a named refusal: unregistering is the whole retirement, exactly as
  it was for `gantt`. After it, the html tier (`validateTree` over the live
  registry) reports a `map` node as `unknown-component`, matching the Zod face.
  
  **⛔ No stored document moves.** The string `map` names two different things at
  two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` / `defaultViewType` | `"map"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `map`, `view:map` | hand-authored JSON | **yes** |
  
  `ObjectView` and `ListView` map a stored `map` view onto the node type they
  render, and both already emit `object-map`, so every map view created through
  the console keeps rendering. Nothing in a tenant database changes, and ⛔ nothing
  should be migrated there.
  
  **What moved with it.**
  
  - `@object-ui/console` drops its lazy `map` / `view:map` registration stub; the
    lazy `object-map` stub is unchanged.
  - `@object-ui/core`: `recordSourceDataArmForType` no longer lists the `map` and
    `view:map` rows, since no block is registered under either key.
  - `@object-ui/cli`: the generated known-type list that `objectui check` reads no
    longer contains bare `map`, so the check now reports `map` as an unknown
    schema type in a file it recognises. ⚠️ `view:map` stays on
    that list, because the opt-in protocol placeholder (`registerPlaceholders()`
    in `@object-ui/components`) registers it — in the console a `view:map` node
    renders that placeholder panel, not a map, and `objectui check` does not report
    it as an unknown schema type in a file it recognises. A bare
    `{ "type": "view:map" }` with no structural key is listed in `check`'s advisory
    did-not-validate list instead, because `view:map` is on the known-type list and
    `AnyComponentSchema` has no arm for it; that line does not say the node renders
    a placeholder. Search documents for `view:map` directly.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` flags `map` only in a file it
  recognises — objectui#10606.** This entry first said, unscoped, that the check now
  flags bare `map`. `check` checks the `type` of each file it recognises, and a file
  whose root carries an ObjectUI structural key (`children`, `className`, `body`, …)
  is recognised by that key alone. A file with none of those keys is parsed against
  the schema and recognised only if it validates; one that does not validate is
  listed by name when its root `type` is on that known-type list, and is otherwise
  counted as skipped. `map` is no longer on it, so `{ "type": "map" }` is
  counted as skipped ("no ObjectUI recogniser admitted") and gets no unknown-type
  line, while `{ "type": "map", "className": "h-64" }` gets one. `check` exits
  non-zero on unreadable JSON only; the verdict is `objectui validate`'s: it refuses
  `{ "type": "map" }` at `type` (`invalid_union`) and exits non-zero.
  
  The `@object-ui/plugin-map` README now describes one registered type, and its
  sentence claiming a bare array under `data` reaches the in-memory adapter is
  corrected: a bare array under `data` is not a record source on the map
  (objectui#8348), so inline rows belong under `staticData`. The same false claim
  is corrected on the two docs pages that carried it, `plugins/plugin-map.mdx`
  and `fields/location.mdx`.
  
  **One pending entry in this same release is superseded in part.** The
  objectui#10392 / #10394 entry (`10392-registration-record-source-inputs.md`)
  says `object-map`, `map` and `object-gantt` gained `data` / `staticData`
  inputs. It now reads as of its own change and carries a dated note naming this
  card: `map` declares nothing after this retirement, while `object-map` and
  `object-gantt` keep both inputs.
- 4f74cd5: fix(console): a `FormPage` field whose `widget` names nothing registered renders its `type`, not a text box
  
  The spec's `FieldSchema.widget` declares that the override names a registered
  field component and "Degrades to the `type` renderer when unregistered".
  `FormPage` took an authored `widget` whenever one was present and handed it to
  `resolveFormWidgetType`, which answers a spelling nothing registers with the
  `text` widget. So a `select` field carrying a `widget` that no widget is
  registered under (on the object field or on the form view) rendered a
  free-text input, and the user could type a value the picklist never offered.
  
  The `widget` leg now asks the same shared resolver whether the spelling names
  anything, and falls through to the arity and `type` legs when it does not.
  The select renders its select. A registered widget still wins over the type, a retired spelling
  still reaches its tombstone, and an alias the resolver knows keeps resolving
  as before. No list of widgets was added: the answer is the resolver's own.
- eca2760: The tool preview's "Open in API Console" link now opens the API console inside the current app, with the tool's execute request pre-filled (objectui#10591).
  
  The link pointed at `/developer/api-console?path=…`, a URL with no app segment. The console declares no route for it, so its catch-all redirected the author to `/`, the post-login landing, instead of the API console. The API console also read no query string, so the `path` the link carried was dropped even at the right URL.
  
  - `@object-ui/app-shell`: `ToolPreview` builds the link from the `developer:api-console` registry key inside the app in the URL, `/apps/APP/component/developer/api-console`. That is the path Studio's Developer navigation reaches the API console at. The query carries the tool's execute path (`/api/v1/ai/tools/NAME/execute`) and `method=POST`. The link is rendered through the router, so a console mounted under a base path (such as `/_console`) keeps it inside that mount, and it still opens in a new tab. When the preview is rendered with no router above it, or on a route that names no app, it draws no link.
  - `@object-ui/console`: `ApiConsolePage` reads `path` and `method` from the query string once, when it mounts, and pre-fills the URL field and the method selector. It does not send the request. The preset works on both of the page's mounts: the `developer/api-console` route and the `developer:api-console` registry key. `path` is used only when it starts with `/api/`; an absolute URL such as `http://…`, a protocol-relative `//host` URL or any other value is ignored. `method` is read only together with an accepted `path`, in any letter case, and only when it is one of the verbs the method selector offers. Without an accepted `path` the page opens exactly as before.
- ff94a12: fix(app-shell, console): `ActionParamDialog` and `FormPage` hold their submit while an `avatar` upload is in flight
  
  `AvatarField` now uploads its pick through the ambient `UploadProvider` and hands the `sys_file` id to `onChange` only once the adapter settles, reporting the wait through `onUploadingChange` (objectui#10785). Both hosts handed that callback to `file` and `image` alone, so a Confirm or Submit pressed during an avatar upload went out without the avatar and reported success, the objectui#10167 class. `ActionParamDialog` (`@object-ui/app-shell`) and `FormPage` (`@object-ui/console`, `/f/:slug` and `/forms/:name`) now gate `avatar` too: the button is disabled and reads "Uploading…" until the upload settles.
- 7ea8118: fix(auth, console): a registration started from an invitation link comes back to the invitation after email verification
  
  better-auth builds the verification mail's link server-side from the
  `/sign-up/email` request's `callbackURL`, defaulting it to `/`. The console kept
  `?redirect=/accept-invitation/ID` from the login page through `/register` to the
  "check your inbox" screen, but `createAuthClient().signUp` never sent a
  `callbackURL`, so the mail read `callbackURL=/` and the invitee verified onto the
  workspace picker ("Create workspace") instead of the invitation.
  
  `@object-ui/auth` (additive):
  
  - `SignUpData.callbackURL` is forwarded verbatim to `/sign-up/email`. Absent, the
    key stays off the wire and the server default is untouched.
  - `useAuth().signUp(name, email, password, callbackURL?)` takes it as an optional
    fourth argument.
  - `RegisterForm` gains a `verificationCallbackURL` prop, forwarded to `signUp`.
  
  `@object-ui/console`:
  
  - `RegisterPage` passes a safe `?redirect=` as the verification callback, and the
    verify-email prompt's "Resend" sends the same value. Before, Resend sent the
    bare router path, which the server redirects to at the ORIGIN root, outside
    the `/_console` mount.
  - Both resolve the route through the new `withConsoleBaseRootRelative`. The server
    never sees `<base href>`, and better-auth refuses a document-relative `./…`
    callback — what `withConsoleBase` answers in the embedded build — with
    `403 INVALID_CALLBACK_URL`, failing the whole sign-up.
- 328abeb: Four Console surfaces that read English under a zh-CN session now read the session's
  language (objectui#10900). English stays the default.
  
  - **The generic action success toast.** When an action declares no `successMessage`, the
    runner falls back to "Action completed successfully".
    That fallback now goes through a translator: `ActionRunner.setTranslator(translate)` is
    new in `@object-ui/core`, and `<ActionProvider>` and `useActionRunner` in
    `@object-ui/react` install the session's `t` on the runner they build. The pack key is
    `actions.completedSuccessfully`. An author's `successMessage` still reaches the toast
    untranslated, and a runner with no translator installed still toasts the English sentence.
  - **The social sign-in buttons on the login and sign-up pages.** `SocialSignInButtons`
    takes a new `buttonText` prop, a template whose `{provider}` is replaced with the
    provider's display name; unset, the buttons keep "Continue with {provider}" and
    "Sign up with {provider}". `LoginForm` and `RegisterForm` take a new `socialButton`
    label and pass it, with their existing `orText` label, to the buttons. `orText` was
    documented as the divider label but rendered nowhere; it now sets the divider under the
    buttons, and its documented default is corrected from "or" to "or continue with email",
    the text that divider has always shown. The console's login and sign-up pages and
    `@object-ui/app-shell`'s `DefaultLoginPage` / `DefaultRegisterPage` pass the new
    `auth.login.*` and `auth.register.*` `socialButton` / `orText` keys. The provider's display
    name is inserted as-is: the component's own label for the branded providers it knows,
    otherwise the name the server reports.
  - **Build Doctor.** The build conversation's Build Doctor button (its accessible name and
    both tooltips) and the title of the drawer it opens read `console.ai.buildDoctor`,
    `console.ai.buildDoctorTitle` and `console.ai.buildDoctorDisabledTitle`.
  - **Setup → marketplace.** On `system/marketplace` and the pages under it, the breadcrumb
    segment after System reads `console.breadcrumb.marketplace` instead of the humanized URL
    slug; other `system/*` segments are unchanged. The zh marketplace search placeholder
    reads 「按名称或标识搜索应用…」 instead of 「按名称或 manifest ID 搜索应用…」. The search
    itself is unchanged: it matches the display name, the identifier and the description.
  
  All ten locale packs carry the nine new keys; no existing `en` value changes.
  
  **Clause-②: yes** — besides the nine pack keys, the public surface widens by four optional
  members: `ActionRunner.setTranslator`, `SocialSignInButtonsProps.buttonText`,
  `LoginFormLabels.socialButton` and `RegisterFormLabels.socialButton`. Nothing is removed,
  renamed or narrowed, no accept set changes, and `@object-ui/react` exports nothing new.
- e327c89: fix(console): a sign-up refused by the server's audience gate reads in the session's language (objectui#10998)
  
  When an environment admits new accounts by invitation only (the server's default)
  or only from allowlisted email domains, the server refuses `/sign-up/email` with
  `403 SELF_REGISTRATION_CLOSED` or `403 EMAIL_DOMAIN_NOT_ALLOWED`. The console's
  register page mapped only the user-exists codes to pack text, so either refusal
  showed the server's English message in every language, and the invitation-only
  refusal also named the internal setting behind it.
  
  - `@object-ui/console`: `RegisterPage` maps both codes to localized text. A code it
    does not map still shows the server's own message.
  - `@object-ui/i18n`: all ten locale packs carry the two new keys,
    `auth.register.errors.selfRegistrationClosed` and
    `auth.register.errors.emailDomainNotAllowed`. No existing value changes.
- 180a34a: fix(app-shell): the exported register page says why a sign-up is refused, in the reader's language (objectui#11030)
  
  `DefaultRegisterPage` (mounted at `/register` by `examples/console-starter`)
  passed no `errorMessages` to `RegisterForm`, so every refused sign-up showed the
  server's English message in every language. For `SELF_REGISTRATION_CLOSED` that
  message also names the internal setting behind the refusal.
  
  - `@object-ui/app-shell`: new export `signUpRefusalMessages(t)`, the one map from
    a sign-up refusal code to pack text (`auth.register.errors.userExists`,
    `.selfRegistrationClosed`, `.emailDomainNotAllowed`). `DefaultRegisterPage`
    passes it. A code the map does not name still shows the server's own message;
    `AUTH_CONFIG_ERROR` stays unmapped on purpose, because its message is written
    for the operator.
  - `@object-ui/console`: `RegisterPage` passes the same map instead of its own
    hand-written copy. What it shows does not change.
- 51c2949: The form family's own feedback chrome now reads the locale packs (objectui#11039). The default success toast, the thank-you heading, the loading line, the load-failure heading and the default submit and cancel labels were English literals, so a zh session saw `Created`, `Thanks!`, `Loading form...` and `Error loading form` beside a Chinese UI. They now resolve through the i18n catalogue, the way `WizardForm`'s footer has since objectui#10999.
  
  **What moved.**
  
  - `@object-ui/plugin-form`, across the presentations `object-form` routes to:
    - The success toast when no `successMessage` is authored: `form.created` after a create, `form.saved` after an edit (the default arm and `WizardForm`), and `MasterDetailForm`'s built-in save toast, whose "… saved" after an authored `title` is `form.savedNamed`.
    - The note that rides that toast when a declared `navigateOnSuccess` was refused: `form.navigateRefused`. The submitter reads it, as the toast's description.
    - The thank-you heading when a `thank-you` submit behaviour declares no `title` (the default arm and `WizardForm`): `publicForm.thankYouTitle`.
    - The loading line of the default arm, `TabbedForm`, `SplitForm`, `WizardForm` and `DrawerForm`: `publicForm.loading`.
    - The heading of the load-failure panel in those five and `ModalForm`: `form.errorLoading`.
    - The default submit label, `form.create` or `form.update`, in the default arm, `TabbedForm`, `SplitForm`, `DrawerForm` and `ModalForm`; the default Cancel of `DrawerForm` and `ModalForm`, `common.cancel`; and `MasterDetailForm`'s default Save, Create and Cancel, `common.save`, `form.create` and `common.cancel`.
  - `@object-ui/console`: the form page (`/f/:slug` and `/forms/:name`) reads its loading line from `common.loading`, its success toast from `form.submitted`, and its default thank-you heading and message from `publicForm.thankYouTitle` and `publicForm.thankYouMessage`, through the `I18nProvider` that `main.tsx` mounts above every console route.
  - `@object-ui/i18n`: six keys are new under `form.` in all ten packs: `created`, `saved`, `savedNamed` (`{{title}}`), `submitted`, `errorLoading` and `navigateRefused`. The three `publicForm.` keys were already in all ten packs with nothing reading them (`pnpm check:i18n-dead-keys` listed them as confirmed dead), and say the same thing. The zh value of `publicForm.thankYouTitle` ends with a full-width exclamation mark instead of an ASCII one.
  
  **Authored values still win.** An authored `successMessage`, `submitText` or `cancelText`, a plain string or a per-locale map, and a `thank-you` behaviour's own `title` and `message`, render as authored in every locale. Only the defaults are localized. No schema key is added, renamed or retyped.
  
  **Three English strings change their rendered text**, because each is now the value of a key whose English differs from the old literal:
  
  - the loading line, `Loading form...` with three ASCII full stops, is now `Loading form…` with the typographic ellipsis;
  - the thank-you heading, `Thanks!`, is now `Thank you!`, in the default arm, `WizardForm` and the form page;
  - the form page's default thank-you message, `Your submission has been received.`, is now `Your submission has been received successfully.`
  
  Every other English default renders the same text as before. With no i18n provider mounted, plugin-form's forms still render English from their defaults tables, which `pnpm check:i18n-keys` holds byte-identical to the `en` pack.
- 8275501: fix(app-shell): the exported sign-in page says why a sign-in is refused, in the reader's language (objectui#11058)
  
  `DefaultLoginPage` (mounted at `/login` by `examples/console-starter`) passed no
  `errorMessages` to `LoginForm`, so a wrong password or an unverified email showed
  the server's English message in every language.
  
  - `@object-ui/app-shell`: new export `signInRefusalMessages(t)`, the one map from
    a sign-in refusal code to pack text (`INVALID_EMAIL_OR_PASSWORD` to
    `auth.login.errors.invalidCredentials`, `EMAIL_NOT_VERIFIED` to
    `auth.login.errors.emailNotVerified`). `DefaultLoginPage` passes it. A code the
    map does not name still shows the server's own message.
  - `@object-ui/console`: `LoginPage` passes the same map instead of its own
    hand-written copy. What it shows does not change; its redirect to the
    verify-email prompt on `EMAIL_NOT_VERIFIED` stays as it was.
- 54997ff: fix(console,plugin-form,i18n): the public form page and the master-detail form chrome speak the user's language
  
  objectui#11039 moved the form family's feedback chrome onto the locale packs and
  left two halves behind, both still English inside a Chinese UI.
  
  The console form page (`/f/:slug`, `/forms/:name`) rendered its action chrome from
  literals: the submit button's `Submit`, its in-flight `Submitting…` and
  `Uploading…`, the `Redirecting…` line of a pending redirect, and the frame of the
  `Required: …` refusal. They now read `publicForm.submit`, `publicForm.submitting`,
  `fields.file.uploading` (the key every other form's in-flight Save label already
  reads), and two new keys, `publicForm.redirectPending` and
  `publicForm.requiredFields`. The refusal is one key with a `{{fields}}` hole and
  its labels are joined with the pack's own list separator, so the colon, its
  spacing and the word order belong to the locale.
  
  `plugin-form` had the same literals in the master-detail form: `Loading columns…`,
  the `Subtotal` / `Tax (N%)` / `Total` stack, the row editor's `Line item — row N`
  title with its `Apply` and `Close`, the in-form collection's `Add`, and the Save
  button's `Saving…`; in `ModalForm`, the sr-only description of a master-detail
  dialog; and in `ObjectForm`, the hint under a field the caller may read but not
  write. They now read the pack (new keys under `form.masterDetail` and
  `form.deniedDescription`, plus the existing `detail.add`, `detail.saving` and
  `common.close`), in all ten packs.
  
  Only defaults move. An authored value still wins everywhere it did: a collection
  `title` and `addLabel`, a dialog `description`, a field `description`, an authored
  field label inside the refusal. English output is byte-identical to the literals.
- 81f8498: objectui now resolves `@objectstack/*` 17.5.0 and `zod` 4.6.5, and follows every contract move that release makes (objectui#11073). `@objectstack/spec` 17.5.0 and `@objectstack/core` 17.5.0 require `zod ^4.6.1`, so objectui's own `zod` resolves to the same 4.6.5: two zod minors do not type-check against each other.
  
  ⚠️ Breaking in places, marked `minor` under this repo's version-alignment rule (a `major` in the fixed group would move all of it off the `@objectstack` major). Every narrowing below is the spec's own, and already reaches any consumer that resolves `@objectstack/spec ^17.5`.
  
  - `@object-ui/types`: declares `@objectstack/spec ^17.5.0` and `zod ^4.6.1`. A named list view's `pageName` and `tabs` are retired, as the spec retired them: typed `never` and refused by name at parse. `DashboardWidgetSchema` attaches the spec's two new checks (`checkDashboardWidgetStageOrder`, `checkDashboardWidgetMetricMeasureArity`), so a widget the spec refuses is refused here too. Where a strict object is an arm of a plain union, its unknown-key refusal is terminal again (the spec's own mechanism, needed under zod 4.6): the union answers with every arm instead of the one that failed only on unknown keys. That changes the error shape, never the verdict (measured on every objectui union). Two by-name named-view checks that can no longer run are retired; the spec's refusal answers those documents.
  - `@object-ui/core`: declares `@objectstack/spec ^17.5.0`. `page` leaves the list-view kinds the normalizer knows, as the spec removed `type: 'page'`. `isRefusedTextComparand` and `textComparandRefusalReason` are re-exported from `@objectstack/spec/data`, whose copies are byte-identical. `SPEC_ACTION_KEYS` lists `execution`, which `ActionSchema` now declares.
  - `@object-ui/data-objectstack`: declares `@objectstack/spec ^17.5.0`, up from `^17.4.0`. Its bundle carries `@object-ui/core`'s filter converter, which now takes `isRefusedTextComparand` and `textComparandRefusalReason` from `@objectstack/spec/data`. `@objectstack/spec` 17.4.0 exports neither, so the old range admitted a spec under which the shipped module names exports that are not there (objectui#5793's floor gate). Nothing moves at runtime in this repository, because the lockfile already resolves 17.5.0. `patch`, as the floor raise of objectui#10864 was.
  - `@object-ui/fields`: the percent and number `scale` clamp is gone, at the sunset its own test named. The spec now refuses a `scale` above 100 at the declaration, so the width a formatter cannot render no longer arrives, and every face passes the declared width through as it did before the clamp.
  - `@object-ui/components`: two module-local prop interfaces of the action renderers are renamed (`ActionButtonRendererProps`, `ActionIconRendererProps`), because the spec now exports the old names for its authored props. Neither is reachable through the package's exports map; only the shipped per-file declarations change.
  - `@object-ui/plugin-list`: the README's view-type example no longer lists the retired `page` kind.
  - `@object-ui/app-shell`: the flow designer follows 17.5.0 (maintainer ruling on objectui#11088, decision 2). A new `wait` node is seeded `waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' }`, because the spec now refuses a timer wait with no duration; the inspector shows the Duration at once and it can be changed. The decision form offers the spec's new `mode` (exclusive or inclusive), with no default declared because the spec applies none. The screen form's `mode` states `create` again, because the spec now applies that default. `minor` because the decision form gains a control.
  - `@object-ui/app-shell`: declares `@objectstack/spec ^17.5.0`, up from `^17.4.0`, and `zod ^4.6.1`, up from `^4.4.3`. The designer now states 17.5.0 behaviour. The screen form's declared `create` default equals a default the spec applies only since 17.5.0, and objectui#9109 requires the two to be equal, so a range that admitted 17.4.0 claimed more than the designer holds to. The resolved versions do not move.
  - `@object-ui/console`: the bundle inlines the 17.5.0 packages, so its client-side validation answers as the published 17.5.0 contract does. The flow preview sample's script nodes use the 17.5.0 script contract. The eager-closure budget is re-baselined for the release's growth, under the maintainer ruling on objectui#11088 (decision 1).
- 993f27e: perf(console): the first screen no longer downloads the spec entries only the metadata designers' validation uses
  
  The metadata designers' client validation loads each metadata type's spec schema through
  `import()`, so `@objectstack/spec`'s `/ai` and `/integration` entries were meant to arrive
  only when a designer validates an agent, tool, skill or connector draft. They arrived on
  every page load instead: the `vendor-objectstack` chunk group claimed them, and that chunk
  is a static import of the console entry. The group now claims only the entry's static
  closure (`tags: ['$initial']`), so those two entries — and `/contracts` and
  `@objectstack/sdui-parser`, which only lazy code reaches — load with the code that needs
  them. Nothing the first screen runs moved, and validation answers exactly as before once
  loaded. The console performance budget's ceiling comes down by the bytes recovered
  (objectui#11101).
- f16c01e: fix(console): the docs portal's book sidebar keeps a doc placed by its own `group` key from outside the book's package (objectui#11245)
  
  A doc names the book group it belongs to through its own `group` key. The framework's
  `resolveBookTree` places such a doc in that group with no package scope (only a group's
  `include` is scoped), and `GET /meta/book/:name/tree` answers that resolver. The portal
  dropped every doc outside the book's package BEFORE resolving, so a doc an admin placed
  from the doc editor was listed by the tree endpoint and missing from the book sidebar:
  its group rendered empty, the book card did not count it, and a book with nothing else
  to open showed "This book has no documents yet".
  
  `scopeDocsToBook` now keeps a doc whose `group` names one of the book's group keys,
  whatever its package. The package filter still narrows what `include` and the synthetic
  Uncategorized group can collect, so another package's ungrouped docs stay out of the
  book, and a group-level `package` override still scopes that group's `include`.
- 7fed09d: fix(app-shell,components,console): the three remaining select placeholders show the locale's own "Select…" word (objectui#11252)
  
  Three selects with no value fell back to a hard-coded English `Select…`, so they read English under every locale, beside otherwise localized copy:
  
  - Studio's datasource dialog (`DatasourceResourcePage`): an `enum` property in a driver's config form with no value, such as the Turso driver's optional `mode`. It now shows Studio's own `engine.form.selectEllipsis`, the word Studio's other enum selects already show, in the designer's language.
  - `ConfigFieldRenderer` in `@object-ui/components`: a `select` field with no `placeholder`. It now reads the shared `common.select` key. A host with no `I18nProvider` still sees `Select…`, never the raw key. An author-supplied `placeholder` still renders verbatim.
  - The console settings page (`SettingsField`): a closed `select` with no value. It now reads `common.select`, with `Select…` as the en default.
  
  The en text is unchanged at all three. No locale key was added.
- 6158e4c: objectui now resolves `@objectstack/*` 17.6.0 (objectui#11438). One declared range moves: `@object-ui/types` raises its `@objectstack/spec` floor to `^17.6.0` in objectui#11227's own changeset, because its published types read `EmptyState` / `EmptyStateSchema`, which 17.5.0 does not export. Every other `@objectstack/*` range already admits 17.6.0 and stays as it was, and `check:spec-floors` names no other floor that has to rise. Everything below is a contract move 17.6.0 made, and it already reaches any consumer that resolves `@objectstack/spec ^17.6`.
  
  - `@object-ui/components`: the `page:header` registration no longer publishes a `breadcrumb` input. 17.6.0 retires the key (objectstack#20758) and refuses it by name; the renderer has ignored it since objectui#11166.
  - `@object-ui/i18n`: a served translation document is recognised as a spec payload when it carries only the `picklists` group, which 17.6.0's `GetTranslationsResponseSchema` adds. Such a bundle used to be returned untransformed, so nothing read it. The group is now namespaced under `app` like every other group.
  - `@object-ui/console`: the bundle inlines the 17.6.0 packages, so its client-side validation answers as a 17.6.0 server does. The first screen is smaller: 17.6.0's spec root no longer carries the migration chain, so the eager closure is 250,096 gzipped bytes lighter (measured against a `main` build), and the bundle budget comes down by that amount.
- d93e53f: fix(approvals): the console names a position approver `position:manager`, the spelling the server stores — not `role:manager` (objectui#11455)
  
  The server stores an approval slot routed to a position as `position:manager`;
  `role:manager` is the framework ADR-0090 D3 deprecated spelling, kept on the
  server only for 15.x-era slots, and an approve that names it on a
  `position:manager` slot is refused. Two console sites sent the deprecated one
  for every position the session carries:
  
  - **`sharedUserFeeds.approverIdentities`** — the bell badge, the bell's
    Approvals tab and Home's To-do card. Its docblock also called `role:` the
    server's addressing scheme, which it is not; it now says what the server
    stores.
  - **`approvalsApi.buildApproverIdentities`** — the Approvals page's "My
    Pending" filter, its Approve / Reject enablement, and the `actor_id` a
    decision names.
  
  What a host sees: a request waiting on a position the user holds is listed and
  can be approved or rejected from the Approvals page, and the decision is
  recorded under `position:manager`. No `role:` spelling is sent beside it as a
  fallback, so a 15.x-era slot still stored as `role:manager` no longer enables
  Approve / Reject through the position alone. The better-auth `user.role`
  scalar is not a position and keeps its own `role:` identity.
- f624f27: Studio reaches the organization's own flows that belong to no package (objectui#11553).
  
  A clone of a packaged flow is, by ADR-0126 §7.1, an ordinary org-owned flow, and the clone door stores it with no package on purpose. Studio was routed and listed per package, so the clone matched no route and no rail: the Studio home said "No writable packages yet", the read-only package's Automations rail listed only the packaged flows, and a deep link naming the clone opened another flow.
  
  - **A package-less scope, `/studio/~org/automations`.** The same Studio design surface with no package under it. Its Automations rail lists every flow that belongs to no package (the unscoped flow list, narrowed by each item's owning-package field, plus package-less drafts), and opens each one editable. Edits save as drafts bound to no package; the header's count, the pending-changes sheet and Publish cover package-less flow drafts only, and Publish promotes each one by reference, since the package batch door cannot reach a draft bound to no package. The scope offers no other pillar, no "New" flow, no Create app and no package copilot. `~` is outside every package-id alphabet, so the segment can never name a package.
  - **Reachable from Studio's home and from the package switcher**, whether or not a writable package exists.
  - **A deep link names the flow it opens.** A `?surface=flow:` link naming a flow the rail does not hold no longer opens the rail's first flow in its place: from a package's pillar, a package-less flow is found and opened in the package-less scope; a flow found nowhere is reported on the canvas.
  - A read-only package's flows stay read-only, as before.
  - The console's `/studio` routes gain the scope's bare leg, `/studio/~org`, which lands on its one pillar.
- 5a2ca6b: The console and runner stylesheets compile only from their declared `@source`
  lines. Tailwind's automatic source detection is now off (`source(none)`), as it
  already was for `@object-ui/components`.
  
  With detection on, Tailwind also scanned prose in each package's directory, and
  `CHANGELOG.md` was part of it. A release writes every changeset body into that
  file, so the release itself added utilities to the published CSS that no
  component uses. On the 17.7.0 release head, that was 11 rules (about 9 kB) in the
  console sheet and 5 in the runner sheet. Both sheets now compile to the same
  rules wherever the build runs. The only rules dropped against the previous
  build came from prose: one from a docs proposal in the console and two from
  the runner's changelog.
- ff8587f: Setup's settings selects now follow the specifier's `valueDomain` declaration instead of
  treating the curated `options` table as the domain (objectui#3719).
  
  Since objectstack#5712 / PR objectstack#6581 a settings specifier may declare
  `valueDomain` (`iana_time_zone` | `iso_4217_currency` | `iso_3166_alpha2`), and when it
  does the **standard's membership is the enforcement boundary** — the server accepts
  `timezone: 'Europe/Zurich'` and `currency: 'CHF'`, neither of which is in the manifest's
  list. The console kept drawing those keys as closed dropdowns, so an admin could author
  only the 17 curated zones and 9 curated currencies while the contract took the whole
  domain; every other legal value was reachable by API or `OS_LOCALIZATION_*` env only. The
  keys' own descriptions had promised "IANA zone" / "ISO 4217 code" all along.
  
  `case 'select'` in `SettingsField` now keys the control off the declaration. Declared →
  an editable combobox: the curated options stay on as suggestions (native `<datalist>`, the
  same suggest-but-allow-anything affordance `FlowReferenceField` uses — no new dependency),
  free text is committed verbatim, and an out-of-domain value is refused by the server with
  `invalid_value` + `constraint: { valueDomain }` into the field-error slot that already
  exists.
  
  **Undeclared → the closed dropdown is untouched**, which is half the change rather than a
  caveat. Those `options` are still exhaustive under objectstack#5131 (the sms/mail provider
  selects), and `localization.locale` had its domain declaration deliberately **rejected** in
  objectstack `2fdb36eb9` because its options *are* the shipped catalogs. Widening those to free
  input would be a regression wearing this fix's clothes, so the two branches are pinned
  against each other from the specifier data rather than from a list of key names — a key
  that gains a domain server-side joins the right side of the pin with no edit here.
  
  Root cause, because it will recur: `Specifier` in `pages/settings/types.ts` is a
  hand-written **local mirror** of the server's shape, not an import, so nothing tells it when
  the schema grows — and TypeScript reports nothing, because a narrower mirror is a
  structurally valid reading of a wider object. `valueDomain` is added there and the file
  header now says to check the mirror first when a settings feature "doesn't render".
- 9eea12a: Retire the system hub card wall. `/apps/:app/system` now forwards onto the
  settings hub at `/apps/:app/system/settings` instead of rendering a
  hand-written page of cards (objectui#3743).
  
  The hub kept its own copy of the admin navigation: a card array, per-card count
  queries and badge text that each needed a manual update whenever the object or
  permission model changed. The page (`SystemHubPage`) and its two test suites
  are deleted.
  
  Every link that used to open the hub and still ships now lands on the settings
  hub: the sidebar's "System Settings" entry, the "System Settings" button on the
  "No Apps Configured" screen, the home Quick Action and the legacy `/system`
  bookmark. The Setup app's navigation ("All Settings") and the sidebar's
  "Configuration" entry already declare that page. It lists the settings
  manifests the server returns for the signed-in user. The landing works with no
  apps configured as well.
  
  The `/apps/:app/system/{users,organizations,roles,positions,permissions}`
  redirects are unchanged.
- 00715f5: API Console's endpoint catalog is keyed by the canonical `storage` service slot, and reads
  only that slot (objectui#5291, framework#9683).
  
  `useApiDiscovery`'s `SERVICE_ENDPOINT_CATALOG` looks its keys up directly in `/discovery`'s
  `services` map, and that lookup is deliberately fail-closed (ADR-0076 D12). `38ba3ddf3`
  had kept the Storage entry keyed by the deprecated `file-storage` spelling, with a small
  alias table that read `services.storage` first and fell back to `services['file-storage']`,
  because the installed `@objectstack/spec` did not list `storage` in `CoreServiceName` yet.
  It does now, so the entry is re-keyed to `storage`, and the alias table
  (`DEPRECATED_SERVICE_SLOT_ALIASES`) and the special case in the discovery lookup are removed.
  
  Against a backend that reports the slot under `storage` — every framework release that
  carries the framework#9683 mirror, which also copies the row under `file-storage` — the page
  renders the same Storage group as before. Two behaviours change:
  
  - A backend older than that mirror reports `file-storage` alone, and there the Storage group
    is now hidden, like any other slot missing from `/discovery`.
  - When the `storage` service row carries no `route`, the group now takes its route prefix
    from `routes.storage` in the discovery payload before falling back to `/api/v1/storage`.
    The old `file-storage` key never matched that route-map key.
- baac3f4: Fix four `find()` calls that passed a query option without its `$`, and gate the shape.
  
  `QueryParams` declares every query option `$`-prefixed and `convertQueryParams` copies
  exactly those keys, so an unprefixed spelling reaches no branch and is dropped — no throw,
  no warning, and it type-checks because the type carries `[key: string]: any` for
  adapter-specific params. For a dropped cap the result is an **unbounded** read rather than
  a truncated one: the platform's GET list route has no default page size, so the query
  returns the whole match set and stays invisible until the object is large.
  
  - `app-shell` `ObjectView` fetched the footer's record count with `{ limit: 0 }`. This one
    **inverted** rather than widened — `$top: 0` is honoured end to end as "no records", so
    the dropped key turned "count only, fetch nothing" into "fetch every row in the object",
    on every mount and every refresh of every list view. It now sends `$top: 0` and reads
    the count off `total` only; the row-counting fallbacks are gone rather than repointed,
    because once zero rows are requested an empty `data` means "you asked for none", not
    "the object is empty", and counting it would assert a confident `0`. With no total the
    footer line is omitted instead.
  - `app-shell` `AssignedUsersSection` looked a permission set up with `{ …, limit: 1 }`,
    one line from three correct `$top` calls.
  - `plugin-dashboard` `DashboardFilterBar` passed `fields` **and** `top` in one literal, so
    a filter's option list read every row and every column of its source object while its
    own comment described it as capped at 200. The same call read `records.items`, which is
    not a `QueryResult` member, so against a real adapter the fallback produced no options
    at all.
  - `console` `sdui-workbench-preview` passed `{ top: 200 }` and read `.records` off the
    result in its page-source metadata.
  
  A new `object-ui/no-unprefixed-query-params` ESLint rule rejects the shape at write time:
  a known query-option name missing its `$` in the second argument of a `find`/`findOne`
  call. It is narrow on purpose — a closed list of spellings, anchored to the call — because
  the index signature exists so adapters can take adapter-specific params, and a rule that
  flagged any unprefixed key would report the shape the type was written to allow. Its
  sibling `no-query-params-under-options` (the `{ options: { $top } }` half) is unchanged.
- 7a72422: Publish the create-payload rule from `@object-ui/plugin-form`'s entry, so a
  second form renderer can call it instead of composing it by hand
  (objectui#6059).
  
  Newly importable from `@object-ui/plugin-form` — two functions, nothing else:
  
  ```typescript
  import { omitServerResolvedDefaults, isRequiredInForm } from '@object-ui/plugin-form';
  ```
  
  - `omitServerResolvedDefaults(values, objectSchema)` — drop the keys a CREATE
    payload must leave to the producer: a field whose declared `defaultValue` is a
    runtime instruction (`NOW()` / `current_user`, or a CEL envelope) and whose
    submitted value is empty. `ObjectQL.applyFieldDefaults` resolves a declaration
    only for a field that arrives absent or null, so submitting a blank stores
    `''` and silently defeats it. **Create-only** — the caller keeps the mode gate.
  - `isRequiredInForm(field, isCreateForm)` — the `required` a form should
    enforce, given the mode. Published as the pair's other half on purpose:
    excusing a server-owned field from `required` and then submitting the key
    anyway is not half a fix, it is no fix.
  
  Both are pure functions over plain data (no React, no registry). The rest of
  `schemaDefaults.ts` — `seedCreateValues`, `schemaDefaultValues`,
  `isSeedableDefault`, `isCreateFormMode`, `SeedContext` — stays module-private,
  and `isRuntimeDefault` stays `@object-ui/core`'s to publish.
  
  No behaviour change. The console's `FormPage` now calls the published helper
  instead of composing `isRuntimeDefault` + `isMissingForRequired` locally; its
  create payload is decided identically before and after, pinned against the
  deleted implementation over the full matrix of default shapes, value spellings
  and both modes.
- 6630b37: The console boot no longer flashes a fully-white frame after the splash has painted
  (objectui#6378).
  
  Cause, established by measurement before any fix was written — the card named
  `LoadingScreen`'s unmount timing and `RouteFader` as suspects and both are exonerated.
  A CDP `Page.startScreencast` frame ledger (every frame classified with the card's own
  rule: white when no colour channel falls below 242) was correlated against a DOM-state
  ledger on the same clock (`performance.timeOrigin`), against the production
  `apps/console` bundle with the boot endpoints mocked. `RouteFader` never mounts on the
  boot path at all, and `LoadingScreen` unmounts exactly when its own gate says to. What
  is wrong is what REPLACES it: every readiness gate renders the splash while it waits and
  a bare `<Navigate>` the moment it decides. `<Navigate>` renders `null` and react-router
  runs the navigation as a transition, so the destination tree renders while the commit
  that already dropped the splash is what the compositor is showing — 41–147 ms during
  which `#root` holds no view and the viewport is the bare page background. The flash is
  intermittent only because it depends on a frame being swapped inside that window; the
  window itself was present on every measured boot.
  
  `RedirectWithSplash` (new, `@object-ui/app-shell`) pairs the same `<Navigate>` with the
  same `LoadingScreen` the gate one line above was already rendering, so the handoff
  changes no pixels and the transition runs underneath an unchanged screen. The console's
  three boot redirects use it: the auth gate's `/login` bounce, the `/` landing resolver,
  and the catch-all route. The nested organization `index` redirect deliberately does not —
  it fires under an already-painted layout, where covering the screen would be the
  regression.
  
  Acceptance campaign — same instrument on both sides, the two arms INTERLEAVED inside one
  process and one browser so drift in this shared container's load lands on both equally.
  102 paired boots per arm across five cells (signed-out `/`, signed-in `/`, an unmatched
  entry, and the card's two throttled network profiles). The empty-viewport window: 102/102
  pre-fix, 0/102 post-fix. The white frame itself, pooled over the three cells where the
  pre-fix build actually flashed: 67/87 (77%) pre-fix, 0/87 post-fix — 95% upper bound on
  the residual rate 3.4%, against a card-reported defect rate of ~1/3. The two throttled
  cells are reported but NOT pooled: the pre-fix build flashed 0 times there, so before and
  after agree and those cells prove nothing about the pixels (they still separate 15/15 vs
  0/15 on the DOM window).
  
  `e2e/console-boot-indicator.spec.ts` gains the deterministic half as a gate — after
  React's first commit the viewport centre must never stop being covered. That reading is
  what makes an intermittent defect gateable: the flash needs a frame to be swapped inside
  the window, but the window itself was present on every measured boot. Verified red-first,
  6/6 red on the pre-fix bundle and 6/6 green on this one.
- cf601ff: Stop the console's eager stylesheet scanning TEST files for Tailwind classes
  (objectui#6379).
  
  `apps/console/src/index.css` declares 27 `@source` path globs across `packages/**`
  plus its own tree, and carried no `@source not` line at all — while reaching further
  than any other entry in this repo that declares sources. Tailwind v4 scans source
  TEXT, not an import graph, so every test file under those globs was a source for the
  render-blocking `index-*.css` the console serves: 2373 test files in the packages it
  names, plus this app's own. `packages/components/src/index.css` (objectui#8446,
  objectui#9569) and `packages/runner/src/index.css` (objectui#8454) already carried the
  exclusion; this entry was the gap, and it is the one whose output is render-blocking.
  
  Two repository-root-anchored `@source not` lines close it. The anchor is the one base
  that covers BOTH trees this entry scans: the package globs, and Tailwind's automatic
  detection root, which is the process CWD — here `apps/console`, where the build runs.
  
  Measured, not assumed: 19 classes and 10,096 raw bytes leave the compiled sheet, and
  every one of the 19 was traced to a test file. The built, minified `index-*.css` goes
  from 365,214 to 357,216 raw bytes (47,482 to 46,527 gzipped) — -7,998 raw, -955
  gzipped. `prose-lg` and `prose-slate` are 10,302 of the unminified bytes on their own — the typography plugin emits a very large
  rule block per `prose-*` variant, and both were named by tests and by no shipped
  source. The sharpest reading is `mt-[3.7331px]`: the self-hosted sentinel of
  components' own `index-css-scan-excludes-tests.test.ts`, a token that exists only to
  prove that package's exclusion works, which this app was shipping to users.
  
  This is a correctness fix with a size side-effect, not a first-paint fix. It is 2.0%
  of the render-blocking gzipped CSS — about 955 bytes, under 2 ms of transfer on the
  4 Mbps profile objectui#6379 measured — and first contentful paint does not move out
  of run-to-run noise. The first-paint question in that card is unchanged and still
  turns on a product ruling.
- 1db5b76: Console: free the marketplace routes `AppContent` declares lazy, and pin the metadata-admin surface that cannot be freed
  
  `AppContent` declares four surfaces with `lazy()` that the emitted bundle loaded on
  every console page load anyway. Measured on `b98352a15` from
  `apps/console/dist/eager-closure.json` and the emitted chunks' own module lists —
  not from a source-level search, which cannot see the mechanism at all:
  
  | chunk | gz, eager before | after |
  |---|---|---|
  | `metadata-admin` | 172,651 B | unchanged — pinned, with the module list that proves it |
  | `MarketplacePackagePage` | 7,647 B | lazy |
  | `MarketplaceInstalledPage` | 1,836 B | lazy |
  | `MarketplacePage` | already lazy | lazy |
  
  Both marketplace chunks were held by CHUNK CO-TENANCY, not by any import of the page:
  rolldown had parked `components/SuggestedBindingsPanel.tsx` (statically imported by the
  eager `views/studio-design/StudioDesignSurface.tsx`) in the first, and
  `console/marketplace/InstalledListWidget.tsx` (bare-imported by the package barrel for
  its SDUI registration) in the second. An `app-shell-eager-leaves` group in
  `apps/console/vite.config.ts` isolates those co-tenants so the three declared-lazy pages
  chunk by their own dynamic-only reachability. The console eager closure moves
  3180.2 KB → 3171.5 KB gzipped (−8,888 bytes, 48 → 45 eager chunks) with the three
  per-chunk ceilings unmoved.
  
  `metadata-admin` is NOT freed and is now pinned in
  `DECLARED_LAZY_VIEWS_STILL_EAGER` with the reason: it is statically imported by the
  package barrel and by `services/builtinComponents.tsx`, which registers
  `MetadataDirectoryPage` and `MetadataResourceRouter` by value, and it performs five
  load-bearing top-level registrations. Freeing it would change what
  `registerAppComponent` accepts and what the barrel re-exports — a published-contract
  decision, not a bundling one.
- 1267508: Approvals inbox: a record that was deleted now renders a "record deleted"
  tombstone instead of degrading to the bare record id.
  
  When an approval's underlying record is deleted, the platform voids the
  still-pending requests and stamps the cause on the row (`status: 'cancelled'`
  plus `cancel_reason: 'record_deleted'`, objectstack#13568). The console did not
  read that cause: the row fell back to `formatIdentity(record_id)` and showed an
  opaque id where the business identifier used to be, still offering a link into a
  page that no longer exists. The desktop row, the mobile card and the request
  drawer now all render the tombstone, drop the link, and keep the snapshot's
  business identifier on the meta line so the audit row still says which record
  the approval was about. The `cancelled` status badge gained a label too — it was
  rendering the raw wire token.
  
  The copy is the platform's own: the localized `cancel_reason` option label when
  the server's translation bundle has loaded, falling back to the authored English
  in `@objectstack/spec`. No second string is authored here.
  
  Terminal (`approved` / `rejected`) rows are deliberately unchanged. They were
  never cancelled, so they carry no cause, and the read path fuses "deleted" with
  "hidden from this viewer" on purpose (existence non-disclosure) — so nothing on
  the wire tells them apart. Rendering a tombstone from a failed lookup would
  report a deletion to someone whose only problem is permissions
  (objectstack#7345), which is a worse claim than the id it replaces.
- 4704aa4: A form no longer ends on a screen asserting both a failure and a success (objectui#7252).
  
  A refused submit raised an error toast that nothing ever retired, so when the user
  fixed the input and submitted again the confirmation of that second attempt appeared
  *beside* the refusal of the first — a wizard's last step showing "Invalid project
  status transition." and "Your new project is ready…" at the same time.
  
  Every outcome toast a form raises now travels under one stable per-form id, so the
  later outcome supersedes the earlier one instead of stacking beside it:
  
  - `@object-ui/components`' form renderer publishes its three outcome toasts (the
    field-level rejection, an `onAction` error, and a rejected write) under that id, and
    retires the previous attempt's toast in the same place it already cleared the
    previous attempt's in-form banner. This is what fixes the reported wizard flow: the
    refusal comes from this renderer while the success toast is raised by the host
    (`WizardForm` / `ObjectForm`), so no single raiser could supersede the other before.
  - the console's own `FormPage` publishes its confirmation and its submit failure under
    one id, for the same reason.
  
  Toast durations are unchanged — this is about supersession, not lifetime. The
  objectui#4190 arm is deliberately excluded: a refused redirect *destination* still gets
  its own toast, because the write succeeded and that refusal has to stay readable beside
  the confirmation it qualifies.
- d4c6a86: The console chrome's Home affordances follow the product's declared landing (objectui#7256).
  
  `/` has honored `app.isDefault` since the hardcoded `PREFERRED_APPS = ['cloud_control']`
  redirect was retired; the chrome had not. The top-bar logo, the sidebar's Home row, the
  mobile sheet's Home row and the app-switcher's Home entry each named `/home` literally —
  the ENVIRONMENT layer's launcher (ADR-0075). So a deployment that declares a landing
  offered the customer two homes in two voices, and one click on the logo left the declared
  one.
  
  On cloud's control plane that second home is actively wrong: its "Build an app" / "Start
  from a template" cards are environment-side actions that cannot work from the control
  plane, and its "Your apps" tiles are the control plane's own internal management apps.
  
  - `@object-ui/app-shell` adds `resolveDeclaredHomePath()` — the one reader of the
    declaration — plus `useHomePath()`, which the four chrome sites now consume. The signal
    is the App metadata the server already sends: no hostname sniff, and no product name
    baked into the shared bundle.
  - `@object-ui/console`'s `/` resolver is unchanged, and a behavioural matrix now pins its
    answer equal to the chrome's for every declared app list, so the post-login landing and
    the logo cannot drift apart.
  
  Deployments that declare no landing are unaffected: every Home affordance still resolves
  to `/home`. The "this app is gone" recovery redirects in `AppContent` / `ConsoleShell` are
  deliberately untouched — they are error paths, not Home affordances.
- ef1ffc2: `MetadataHmrReloader` stops flooding a production-posture deployment with
  `GET /api/v1/dev/metadata-events` 404s (objectui#7257).
  
  The dev-only HMR component subscribes via `EventSource`, gated on
  `import.meta.env.DEV`. That gate is not airtight against every rig: a
  "prod-like" build/serve setup that forces `NODE_ENV=development` for the
  *build tooling* while running the server itself in production posture can
  bake `DEV === true` into the shipped bundle even though the server never
  mounts the dev route there — and the old reconnect loop treated every closed
  connection as transient, retrying on a fixed `reconnectDelayMs` (2s)
  forever. On an env host that is ~30 requests/minute of 404s per open
  record/list page, drowning out the legitimate `sys_inbox_message` /
  `sys_notification_receipt` polling in the same console.
  
  The first `connect()` attempt now doubles as the real capability probe: if
  the stream closes before it ever reaches `open`, the component gives up for
  good instead of retrying (and specifically not a longer interval either —
  that would still spam 404s, just slower). A stream that DID open at least
  once and later drops — a real dev-server restart or network blip — keeps
  reconnecting exactly as before.
  
  No production-side replacement is introduced here: this component's only
  job is turning "a metadata file changed on disk" into a full reload, and
  production deployments have no such file-system event to watch. The
  separate Studio-left-nav-doesn't-refresh caching issue does not go through
  this SSE stream and needs its own fix.
- caa0cd3: The `page` preview sample authors its "Quick links" section heading as `variant: 'h3'`, replacing the pre-convergence spelling `subheading` that the ruling retires (objectui#7450). It still renders an `<h3>`, now with the `h3` style `ui:text` uses, and the sample's prose names the converged vocabulary.
- a810bb2: Publish `readEnvelopeFailureText` from `@object-ui/app-shell`, and read the agent-key
  generator's failures through it (maintainer ruling relayed by the director
  seat, decision batch #91 — option B).
  
  **New export, no new behaviour.** `readEnvelopeFailureText(payload)` is the single read of
  the ADR-0112 failure envelope: a producer-marked `error.userMessage` outranks the
  diagnostic `error.message` at any status, `error.code` is appended to whichever prose won,
  and a body carrying no prose answers `null` so each caller keeps its own fallback. The
  function is unchanged — it has been in this package since `36fc74629` and is pinned by
  `utils/apiErrorEnvelope.test.ts`; this only publishes it. It returns `string | null`, so
  no type accompanies it, and its module imports nothing, so it adds no module side effect.
  
  The card behind `36fc74629` kept it off the public entry as **scope restraint** — that card's file
  surface was `packages/app-shell/**` — not as a ruling that it should stay private.
  
  **The console fix this unblocks.** The Integrations page's "Connect an AI agent" section
  read `json?.error?.message` and stopped, so a refused key mint dropped two declared
  things: the producer's marked `error.userMessage` (the objectstack `79c46da90` channel, whose presence *is*
  the marking) and `error.code`. The 5xx band is where that cost most — the producing door
  substitutes the generic `Internal server error` into `message` while the mark rides
  through untouched, so a marked 500/503 showed the developer the generic sentence and
  discarded the specific one written for them, and no code reached the surface at all. The
  section now reads the envelope through the shared rule and renders what the producer
  marked.
  
  Unmarked refusals — the overwhelmingly common case — render the same diagnostic prose as
  before, now with the declared `error.code` appended.
- af9e957: fix(types,components,plugin-form,console,core): a faulted `visibleWhen` refuses the submit, naming the field and the rule; a blank field rule is refused; blank gates are diagnosed (objectui#8069)
  
  ⚠️ **User-visible, and a narrowing.** A form whose field `visibleWhen` cannot be
  evaluated — a typo in a column name, a syntax error, an unbound root — used to
  render the field (fail-open) and submit as if the rule had said "show". It now
  still renders the field, and **refuses the submit** with a message that names
  the field and the rule (`form.visibleWhenFaulted`). This is ADR-0137 D2 as
  ruled for objectui#8069 (Q1 = B, one judge per rule): no server evaluates a
  field's `visibleWhen`, so its fail-open render direction (D3) was a silent grant
  — a field the working rule would have hidden, drawn, edited and written. The
  refusal applies on the record form renderer (`form.tsx`, every `ObjectForm`
  layout), the console's `/forms/:name` and `/f/:slug` page, and the wizard's
  cross-step gate at final submit.
  
  - `requiredWhen` / `readonlyWhen` are **unchanged on the client**: the server
    evaluates both and refuses a faulted one itself (ADR-0137 D2), and the form
    renderer shows that field-attributed refusal beside the input.
  - **Accepted residuals:** a `visibleWhen` reading `previous` cannot be
    evaluated on a CREATE form, so such a form is refused on every submit; and
    the wizard's cross-step gate binds no `previous` in either mode, so the same
    rule is refused at the final submit of an EDIT wizard too.
  - A **blank** field rule (`''`, whitespace, an envelope whose `source` is
    blank) is a fault, not "no rule" (ADR-0137 D2). A STORED blank `visibleWhen`
    is refused at submit on the same three paths; a stored blank `requiredWhen` /
    `readonlyWhen` is the server's to refuse.
  
  ⚠️ **Narrowing (`@object-ui/types`): `FormFieldSchema` refuses a blank field
  rule at parse.** `visibleWhen`, `readonlyWhen` and `requiredWhen` on a form
  field now refuse a predicate that is blank after trimming, with the spec's own
  sentence (`EVALUATED_EXPRESSION_SOURCE_REQUIRED`) — ADR-0137 D1, the same
  refusal `@objectstack/spec` makes on `FieldSchema`. The accepted SHAPE is
  unchanged (a string or `{ dialect?, source }`, `ExpressionWireSchema`'s own
  arms): only the blank value is taken out. A blank GATE — `BaseSchema`'s
  `visible` / `hidden` / `disabled`, a form field's view-level `visibleOn`, an
  option's `visibleWhen` — still parses and is still read as "no gate".
  
  **Added (`@object-ui/core`):** `resolveFieldRuleState` returns `faults` beside
  its three verdicts — the per-rule fault report the submit paths read, filled
  from the same evaluation — and its type, `FieldRuleFaults`, is exported.
  **Added (`@object-ui/i18n`):** the `form.visibleWhenFaulted` key in all ten
  packs.
  
  **Diagnosed, no verdict changed (ADR-0137 D4):** a blank CEL gate reaching
  `ExpressionEvaluator.evaluateCondition`, and a blank gate folded to "no gate" by
  `hasDeclaredPredicate`, now each report once through the same `[blank]` channel
  field-rule faults use. Both verdicts (objectui#3850 / #3960) are unchanged,
  `throwOnError` included.
- 8241a44: Public form `/f/:slug` renders its authored `title` and `description` instead of the
  object API name.
  
  The one Console surface an **unauthenticated** visitor sees greeted them with a
  database table name. `GET /api/v1/forms/:slug` serves the authored copy intact
  (`{"object":"ats_inquiry","form":{"title":"Apply","description":"…"}}`), and the page
  rendered `ats_inquiry` as its `<h1>` with nothing at all where the description belongs.
  Found taking release screenshots of a real app on this Console (ats#59), in a real
  browser, in both `en-US` and `zh-CN`.
  
  Two independent read-side defects, one payload, no server change:
  
  - **`loadPublicForm`'s fallback chain** was `payload.label ?? payload.form?.label ??
    payload.object`, and every arm missed but the last. The public resolver sends no
    envelope `label`, and `form.label` is a key `@objectstack/spec`'s `FormViewSchema`
    **rejects** (`unrecognized_keys`) — a form config carries `title`. So the one real,
    typed, populated key naming the form was the only one never read. `form.title` now
    sits ahead of the API-name arm, and ahead of the rejected `form.label` spelling so
    that key can never outrank it. `payload.label` keeps its precedence: the fallback
    ORDER changed, not which value wins where one already did.
  - **The subtitle slot** read `form.label` guarded by `form.label !== loaded.label`, a
    predicate that was **dead** on this route in both directions — with no `payload.label`
    the two operands are the same value, and with one `form.label` is undefined. It now
    renders the form's `description`, which arrives in the payload untouched and which the
    whole file previously never read once.
  
  Section labels on this route are still rendered raw; that is a separate seam, tracked
  on its own card.
- 676f677: Approvals inbox: a reference that cannot be resolved now renders a neutral
  "cannot be opened" affordance instead of degrading to the opaque record id
  (objectui#8631).
  
  `1267508ea` tombstoned the class the platform FLAGS — `status: 'cancelled'`
  plus `cancel_reason: 'record_deleted'`. A terminal (`approved` / `rejected`)
  approval carries no such flag and never will: the upstream cancel path names
  `status: 'pending'` in its `where`, deliberately, so history is preserved. Those
  rows kept falling through to `formatIdentity(record_id)` and showing a truncated,
  meaningless identifier where a business identifier belongs.
  
  The desktop row, the mobile card and the request drawer now all render the
  affordance for a reference that the viewer's own readability probe could not
  resolve AND that carries no snapshot title — the two conditions under which the
  opaque id was the only thing left on screen. A row whose snapshot kept a business
  identifier is unchanged: it still shows that identifier with its link suppressed,
  which is what objectui#5211 ruled. A row the server marked `record_deleted` still
  gets the tombstone `1267508ea` added, which says something stronger because the server
  asserted it.
  
  **The copy names no cause, and that is the point.** The platform's read path
  fuses "this id names nothing" with "your grants filter it out" on purpose
  (existence non-disclosure), so nothing on the wire separates them and the console
  may not invent the separation: telling a viewer a record was deleted would
  confirm to them that it existed. The affordance therefore states only what is
  true either way — there is nothing here to open — and is pinned by a test
  asserting the rendered text carries neither a deletion word nor a permissions
  word.
  
  This sentence is console-authored, through this repo's own catalogue in all ten
  locales, because it has no upstream original: `APPROVAL_CANCEL_REASON_LABELS`
  declares exactly one option (`record_deleted`) and there is no cause code for
  "unresolvable" — nor may one be requested, per the card's fence. That is why it
  does not contradict the neighbouring rule against authoring a second copy of the
  platform's tombstone sentence.
  
  Also removed: the full, untruncated `record_id` that the desktop row hung in a
  `title` tooltip on **every** row, readable ones included. The reference slot now
  tooltips the identifier it displays.
- 0febe1a: The console tab title no longer reverts to the bare product name after an in-app
  navigation (objectui#8637).
  
  Two effects wrote `document.title` on different keys. The console's `BrandingSync`
  was keyed on `useLocation()` and assigned the bare product name on **every route
  change**; `useAppShellBranding` assigns the composed `"App label — Product name"`
  from an effect keyed on that string, so it fires when the title changes and not on
  navigation. Both run on the commit that mounts the shell, and the composed title
  wins — which is why the tab looked right and the defect stayed hidden. Navigating
  between two pages of the same app moved `location` and not the composed title, so
  only the route-keyed writer ran and the tab fell back to the bare product name.
  Measured in a real browser, not inferred.
  
  The repair is one writer rather than two careful ones. `useAppShellBranding` now
  owns `document.title` for as long as a shell is mounted: it captures whatever the
  tab already said, writes `title` over it, and puts the captured string back when the
  shell unmounts or `title` changes. That is what let the console's route-keyed writer
  drop its title assignment entirely — it had doubled as the reset that took the app
  label back off the tab on the way out — and it became `FaviconSync`, which kept only
  the favicon write until objectui#10379 removed that too.
  
  For hosts of `@object-ui/layout`: the forward assignment is unchanged, and a shell
  with no `title` still leaves the tab untouched in both directions. What is new is the
  restore, so a shell mounted over part of a route tree hands the title back on exit
  instead of stranding it. The restore replays the captured string unconditionally, so
  a surface that writes the tab title from **inside** a mounted shell has its value
  overwritten on unmount; keep such surfaces outside the shell.
- 6fda1a9: Render a form section that REFERENCES a field group on the console's form page,
  and publish the resolver that does it (objectui#8641).
  
  `@objectstack/spec` 17.3.0 lets a `form.sections[]` entry declare its members
  either way — enumerate `fields`, or point `group` at one of the object's declared
  `fieldGroups` (objectstack#13855, ADR-0085 §5). `apps/console`'s `FormPage` has
  its own section builder, on none of `@object-ui/plugin-form`'s code path, and it
  read `sec.fields ?? []` and `sec.label` — neither of which a `{ group }` section
  carries. Measured in the DOM on both routes before the fix: the `<section>` was
  emitted with its border and padding and then stood **empty** — no heading, no
  inputs, no diagnostic — so a submitter saw a blank card where the group's fields
  belong. The same silent-drop class objectui#7051 closed on the `plugin-form`
  chain, at the third consumer.
  
  Newly importable from `@object-ui/plugin-form` — one function and the options
  type its signature requires, nothing else:
  
  ```typescript
  import {
    resolveSectionGroupReferences,
    type ResolveSectionGroupsOptions,
  } from '@object-ui/plugin-form';
  ```
  
  - `resolveSectionGroupReferences(sections, { objectName, formType, objectDef })`
    — replace every `{ group: 'x' }` section with the section that group declares
    (label, members, description, collapse state), leaving everything else
    untouched. With no reference in the list it returns its input **by identity**,
    so it cannot perturb an existing form and is safe inside a `useMemo`. An
    unresolvable reference yields an empty section, never a dropped one, and is
    reported once naming the object and the key.
  
  `hasSectionGroupReference`, `resetSectionGroupReports`, `GROUP_OWNED_SECTION_KEYS`
  and `SECTION_LAYOUT_KEYS` stay module-private, pinned as the withheld set.
  
  ⛔ No assembly rule is re-implemented on the console side: declared order, the
  empty-group drop, the ungrouped trailing bucket and the collapse / `visibleWhen`
  passthrough all reach it from `deriveFieldGroupLayout` through this package's one
  adapter — the same code path `ObjectForm` resolves through — which is why the
  resolver is exported rather than the derivation being read a second time.
  
  `ObjectSchemaPayload` in the console now carries `fieldGroups`, and its internal
  `/meta/object/:name` loader copies the key: that rebuild is key by key, so an
  uncopied key is gone before the builder can see it.
  
  No behaviour change for any form that does not author `group`.
- 793af39: Stop reporting a successful key-mint response that carried no key as
  `Request failed (200)` (objectui#8782).
  
  The Connect-an-agent panel guarded its key mint behind one disjunction, so both
  failure modes reached one `throw`:
  
  ```ts
  if (!res.ok || !data?.key) {
    throw new Error(json?.error?.message || `Request failed (${res.status})`);
  }
  ```
  
  The second arm fires on a response that WAS `ok`, and with no `error.message` in
  the body the template interpolated the real status — a `200` whose body simply
  carried no key was reported to the developer as `Request failed (200)`. Nothing
  about the transport went wrong; the sentence named the one layer known to have
  worked. That string lands in `setError(...)` and is the entire report the
  developer gets, so the wrong pointer is the whole report — and an agent or a
  developer reading "request failed" goes and investigates the transport, which is
  the wrong layer.
  
  The two arms are now separate and say different things. `!res.ok` is unchanged,
  including its `error.message` read. The keyless-success arm gets its own
  sentence, which quotes no status: *"The request succeeded but the response
  carried no API key. Nothing failed in transit — inspect the response body of
  POST /api/v1/keys."*
  
  The arm is reachable through this consumer, not through the route. The mint
  route's only success is `201` and it always carries `data.key`, so it cannot
  emit a keyless success; the arm is where `await res.json().catch(() => ({}))`
  lands every 2xx whose body is not that envelope — an SSO or proxy interstitial
  answering `200` with HTML, an empty body, a gateway page. Those are exactly the
  responses for which "request failed" misdirects hardest.
  
  Both arms are pinned, the keyless-success case with a control that fires on the
  same command shape so its absence assertions are a reading rather than a vacuous
  pass.
- adf5812: Four node type keys retire, and the kanban and gantt families converge on their
  `object-*` spellings: `kanban` (objectui#8802), `kanban-ui` and `kanban-enhanced`
  (objectui#8257), and `gantt` (objectui#8008). All four were ruled by the
  maintainer in one batch on 2026-09-09.
  
  **⛔ No stored document moves.** The strings `kanban` and `gantt` name two
  different things at two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` | `"kanban"`, `"gantt"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `kanban`, `gantt` | hand-authored JSON | **yes** |
  
  `ObjectView`'s `switch (viewType)` maps a stored view type onto the node type it
  renders, and it already emitted `object-kanban` and `object-gantt` — as it does
  for all twelve stored view types. So every kanban and gantt view any user ever
  created through the console already renders through the surviving spelling.
  Nothing in a tenant database changes, and ⛔ nothing should be migrated there.
  
  **What each retirement was, measured.** Three of the four were
  registration-only: no schema face in `@object-ui/types` ever declared
  `kanban-ui`, `kanban-enhanced` or `gantt` as a component node type, so
  unregistering is the whole retirement. The bare `kanban` key was the exception —
  it had a declared arm on both faces (`KanbanSchema` in `complex.ts` and its Zod
  mirror), and a plain deletion there would have been the objectui#7664 failure:
  `BaseSchema` is `.passthrough()`, so a document naming a dropped key validates
  green and renders nothing. It therefore retires as a **named refusal**: the Zod
  union keeps an arm claiming the literal and answers a `{ "type": "kanban" }`
  document with a message naming `object-kanban` as the remedy, while the
  TypeScript half is the absence of the arm from `ComplexSchema` and of the key
  from `SchemaRegistry`, so `tsc` refuses it at the authoring site.
  
  **⭐ This closes objectui#8818's `objectFields` hole — for that ENTRY, not for
  the class.** `SchemaRenderer` strips a fixed enumerated metadata list and
  spreads the rest as React props; `objectFields` is not on that list, and
  `KanbanRenderer` — the component the `kanban-ui` key resolved to — declares
  `objectFields` as a real prop, so an authored value reached the predicate layer
  with no schema face judging it. With the registration gone, no authored node
  reaches that component through the registry. ⚠️ The **class** is still open: the
  hole returns the moment another registered renderer declares an `objectFields`
  prop. objectui#8818's option (a) — stripping at the `SchemaRenderer` boundary —
  is what would close the class.
  
  Superseded in this release by objectui#8818: option (a) landed, so the class
  is closed as well. `objectFields` is now on `SchemaRenderer`'s stripped-metadata
  list, and the legacy `props` alias bag drops it too, so an authored
  `objectFields` reaches no component prop on any type key. The paragraph above
  describes the tree this entry was written against.
  
  **⚠️ What the `kanban` arm took with it, stated because it is the cost of this
  change.** That arm was the only schema face that ever declared `columns`,
  `cardTitle`, `swimlaneField`, `grouping` and `navigation`, the only one that
  refused `allowCollapse` / `cardTemplates` / `columnWidths` / `titleField` /
  `draggable` / `onColumnAdd` / `onCardAdd` by name, and — through
  `columns: KanbanColumn[]` — the only one that judged a lane's `cards`
  (`240b80f31`).
  
  ⭐ **The sentence that stood here — «The surviving `ObjectKanbanSchema` face
  declares none of them» — is retired, and the two reasons it failed are DIFFERENT
  defects (objectui#9713).** It is replaced by a dated reading rather than silently
  overwritten, because half of it was true when written and erasing that would be a
  false record of its own:
  
  | key named just above | on `ObjectKanbanSchema` when this entry was written (`adf581278`, 2026-09-10) | on `main`, 2026-09-17 | what moved |
  | --- | --- | --- | --- |
  | `columns` | not declared | **declared** | objectui#8913 (PR objectui#8989), six hours after this entry was written |
  | `cardTitle` | not declared | **declared** | objectui#9606 (PR objectui#9709) |
  | `titleField` | **declared** | **declared** | nothing — the sentence was never true of this key |
  | `allowCollapse` | **declared**, a live `z.boolean().optional()` | **declared**, as a `retirementTombstone()` | objectui#8801 retired it; it was declared on this face throughout |
  | `swimlaneField`, `grouping`, `navigation`, `cardTemplates`, `columnWidths`, `draggable`, `onColumnAdd`, `onCardAdd`, and a lane's `cards` | not declared | not declared | nothing |
  
  ⇒ For `columns` and `cardTitle` the claim **ROTTED**: it was true on 2026-09-10 and
  was falsified afterwards by cards that had no reason to read this file. For
  `titleField` and `allowCollapse` it was **BORN FALSE**: those two are named above as
  keys the `kanban` arm refused BY NAME — which the surviving face indeed does not do
  — but the surviving face declared both of them the whole time, and «declares none of
  them» said otherwise. ⛔ Do not restate any of this in the present tense: a pending
  entry publishes verbatim into the CHANGELOG, and an undated present-tense claim
  about another file is the construction that failed here.
  
  ⛔ Nothing about an `object-kanban` document changes: it was never judged by the
  `kanban` arm, so all of those keys have always ridden `BaseSchema`'s index
  signature there. What is gone is the `kanban` document that had them. Declaring
  them on `ObjectKanbanSchema` would WIDEN a published accept set, which is a
  maintainer ruling and not part of this one; every one of these readings is
  pinned where it can be seen rather than left to be rediscovered.
  
  **Migrating.** Replace `"type": "kanban"` with `"type": "object-kanban"` and
  `"type": "gantt"` with `"type": "object-gantt"` in hand-authored documents. The
  `object-kanban` face requires `groupBy` and one of `bind` / `data` /
  `objectName`; a purely static board (lanes carrying their own cards, no record
  source) adds `"groupBy"` and `"data": []`. `kanban-ui` and `kanban-enhanced`
  have no authored documents anywhere in this repository to migrate.
  
  **⚠️ The namespaced spellings retire with the registrations — `view:kanban` and
  `view:gantt` are the same two keys.** `ComponentRegistry.register(type, C,
  { namespace })` stores BOTH `namespace:type` and a bare-`type` fallback, so
  every one of these keys had a namespaced twin that goes with it:
  
  | retired spelling | namespaced twin | author instead |
  | --- | --- | --- |
  | `kanban` | `view:kanban` | `object-kanban` |
  | `gantt` | `view:gantt` | `object-gantt` |
  | `kanban-ui` | `plugin-kanban:kanban-ui` | `object-kanban` |
  | `kanban-enhanced` | `plugin-kanban:kanban-enhanced` | `object-kanban` |
  
  Both spellings are pinned as gone, each against a firing control on the
  surviving key, in `plugin-kanban/src/__tests__/kanban-family-registry-keys-retired-8257.test.ts`
  and `plugin-gantt/src/__tests__/bare-gantt-node-key-retired-8008.test.ts`.
  
  **What an unmigrated `view:kanban` / `view:gantt` node now renders depends on
  the host.** In `apps/console` it renders the protocol **placeholder** panel, not
  the OBJUI-001 "Unknown component type" error: the console calls the opt-in
  `registerPlaceholders()` (`@object-ui/components`, `renderers/placeholders.tsx`)
  *after* its plugin registrations, `view:kanban` and `view:gantt` are both in
  that file's `PROTOCOL_COMPONENTS` list, and the placeholder only claims a key
  nothing else has taken — which, until this change, `@object-ui/plugin-kanban`
  and `@object-ui/plugin-gantt` had. In every other host, which does not call that
  bootstrap, the same node renders OBJUI-001.
  
  **⚠️ `objectui check` will NOT flag either namespaced spelling.** The CLI's
  `known-schema-types.ts` is generated from the repository's real registration
  calls, and the placeholder registration is a real one — so `view:kanban` and
  `view:gantt` are still on that list and still validate green, while the node
  renders a placeholder rather than a board. The bare `kanban` / `gantt` entries
  DID leave the generated list; only the namespaced pair survives, and only
  because of the placeholder. Grep your documents for the namespaced spellings
  directly; do not rely on `objectui check` to find them.
  
  `KanbanRenderer` is still exported from this package's entry point
  (`@object-ui/plugin-kanban`); only its registry key is gone. ⚠️ `KanbanEnhanced`
  is a different case, and the earlier draft of this note stated it wrongly: this
  package's `exports` map has exactly two entries — `.` and `./style.css` — and
  the barrel never re-exported the component, so
  `@object-ui/plugin-kanban/KanbanEnhanced` has never been a resolvable specifier
  for a consumer. At this change, with `kanban-enhanced` unregistered,
  `KanbanEnhanced.tsx` had zero non-test importers, and the file was deliberately
  left in place: deleting published-but-unreachable source is a further narrowing
  and needed its own maintainer ruling, which this change did not have.
  
  ⚠️ **Dated note, 2026-09-25 — that ruling came, and the file has since been
  deleted — objectui#8932.** Later in this same release
  `packages/plugin-kanban/src/KanbanEnhanced.tsx` was deleted, and with it the
  `dist/KanbanEnhanced.d.ts` typings this package shipped for it. The rest of this
  entry is kept as the reading of this change; the objectui#8932 entry states what
  ships.
  
  **⚠️ `@object-ui/sdui-parser`: `QUICK_ADD_HOST_TYPES` loses `kanban` with the
  registration.** The `inert-quick-add` diagnostic (objectui#8285) named the two
  tags `ObjectKanbanRenderer` answered to; one of them retires here, so the set is
  now `{ 'object-kanban' }`. ⛔ Nothing is silently dropped by that narrowing, and
  this is measured rather than argued: `checkKanbanQuickAdd` has exactly one call
  site — `validate.ts`'s per-prop walk — and that walk runs only in the branch
  where the manifest RESOLVED the tag. A tag no registration produces is answered
  one level up by `unknown-component`, an **error**, and its props are never
  walked, so on a manifest built from the live registry a `<kanban quickAdd>` node
  draws `error/unknown-component` and nothing else, against a firing control on
  `<object-kanban quickAdd>` that still draws `warning/inert-quick-add`. Keeping
  `kanban` in the set would have been reachable only through a hand-built manifest
  declaring a component of that name — which, after this retirement, is somebody
  else's component, and the message asserts things about `ObjectKanban` that would
  be false of it. This supersedes the `kanban` half of the objectui#8285 entry.
  
  **The diagnostic's remedy text moves from a tag to a component.** It used to end
  "render `<kanban-ui>` from a React host that passes `onQuickAdd`". That sentence
  is falsified by this change: `kanban-ui` is no longer a node type key, so a page
  written to the old advice draws `unknown-component`. It now names
  `KanbanRenderer` from `@object-ui/plugin-kanban` — still exported, still
  forwarding both halves by identity — which is the surviving way to get the pair.
  `content/docs/plugins/plugin-kanban.mdx` says the same thing the same way.
- 0afc233: Public form `/f/:slug` now translates its section headings and field labels
  (objectui#8813, seam 2 of the card behind `8241a4400`).
  
  A visitor arriving in `zh-CN` was greeted by the strings the author typed while
  building the form — "Your application" — even when the app bundle carried
  `objects.<object>._sections.<section>.label`. The renderer never looked.
  
  The blocker was structural rather than a missing call: `buildSections` copied
  the authored `sec.label` onto its renderable row and **dropped `sec.name`**, and
  `RenderableSection` had no `name` member at all. The convention key is
  `{ns}.objects.{objectName}._sections.{sectionName}.label`, so with the section's
  stable name gone the key could not be CONSTRUCTED at the render site, whatever
  the render site did. Carrying `sec.name` is therefore the precondition; the two
  lookups are what it enables.
  
  - `RenderableSection` carries the section's `name`, and `buildSections` copies
    it. A group-REFERENCED section (`{ group: 'parties' }`) arrives already
    resolved and carries the group's key as its name, so it translates on the same
    convention.
  - The section heading resolves through
    `useSafeFieldLabel().sectionLabel(objectName, sec.name, sec.label)` — the same
    resolver `ObjectForm`, `ModalForm` and the record detail page use, so the two
    form renderers cannot drift apart on what the key IS.
  - The field label resolves through `fieldLabel(objectName, name, label)`. On this
    route the served label is usually already localized by the server payload; the
    client lookup is the overlay an app bundle can put on top of it, not a
    replacement for it.
  
  The authored string remains the fallback everywhere: a section the bundle says
  nothing about keeps its heading, and a section authored without a `name` has no
  key and keeps its heading too. Nothing starts rendering a heading that did not
  render before — the fix translates headings that already appear, it does not
  widen which sections have one.
  
  The page's own `<h1>` is deliberately unchanged and keeps the form's authored
  `title`. `useObjectLabel` resolves a view label as
  `objects.{object}._views.{view}.label`, and this route has no view name in hand:
  the public payload carries a publish `slug`, which is authored and edited
  separately from the view's name. Routing the heading there would be a no-op at
  best and would replace the author's own title with an unresolvable fallback at
  worst.
- a78cd37: Dates and numbers across the console and the plugins format in the session's
  display locale instead of the machine's (objectui#9909).
  
  Every one of these faces handed `Intl` — directly, or through a formatter called
  without one — either no locale tag or an explicit `undefined`, which is not "the
  user's locale": it is the locale of the machine the browser runs on, which is
  neither of this repository's two locale channels.
  A German or Spanish session therefore read, beside a translated label, a date or
  an amount grouped and decimal-marked the machine's way — and an amount with
  inverted separators does not read as unformatted, it reads as a different
  number. They now go through `useDisplayLocale()` (tenant regional default, then
  the active UI language, then `'en'`), and a plain helper takes that tag from its
  caller. The surfaces:
  
  - **`@object-ui/fields`** — `GridField`'s numeric and currency cells (list mode
    and computed columns) and both total cells. The same cell helper's date branch
    already used the display locale, so a single grid row read two conventions at
    once.
  - **`@object-ui/plugin-charts`** — ISO-date x-axis ticks, compact y-axis ticks,
    the single-value face, spec `format` strings and the tooltip value.
  - **`@object-ui/app-shell`** — the organization invitations, members and
    accept-invitation dates; marketplace version dates; the AI conversation row's
    older-than-a-week date and its tooltip; the build-debug token count; the
    record approvals timeline; and the metadata-admin audit, history, external
    datasource snapshot, schema-browser row estimate, flow-run start and job
    next-fire faces. The audit, history and flow-run panels format these in the
    DISPLAY locale, not in the `locale` prop they take for their UI strings
    (`AuditPanel` defaults that prop to `'en-US'`; `HistoryPanel` and
    `FlowRunsPanel` leave it optional).
  - **`@object-ui/console`** — the approvals inbox's timestamp tooltips, amounts
    and payload summary; the audit log's timestamp column; the flow runs table and
    its run detail.
  - **`@object-ui/components`** — the export dialog's record counts and the debug
    panel's event times.
  - **`@object-ui/plugin-form`** — the analytics submission count, the
    master-detail subtotal / tax / total stack and the edit-conflict dialog's
    "their save" time.
  - **`@object-ui/plugin-chatbot`** — the approvals inbox's past-30-days date and
    the times stamped on local-mode chat messages (the user's and the
    auto-response).
  - **`@object-ui/plugin-dashboard`** — the record-count badge, and the currency
    and date-format branches of `renderFieldValue`, which was handed the display
    locale and spent it only on its percent branch.
  - **`@object-ui/plugin-grid`** — the record-detail panel's inferred currency
    value and the mobile card's amount line, siblings of date cells already on the
    display locale.
  - **`@object-ui/plugin-designer`** — `VersionHistory`'s version times.
  
  A host that mounts one of the components that newly read the display locale with
  NO `I18nProvider` now gets react-i18next's once-per-module `NO_I18NEXT_INSTANCE`
  notice in the console on the first such mount; the faces still render, in the
  channel's `'en'` last resort, and mounting an `I18nProvider` (as the console
  does) avoids the notice.
  
  **Additive API** (nothing that compiled before stops compiling):
  
  - `@object-ui/types`: `ValidationContext` gains an optional `locale`. At this
    change, the `@object-ui/core` validation engine prints the `date_min` /
    `date_max` bound in it; omitted, `Intl` follows the runtime default, as
    `formatDisplayNumber` already declares for a caller with no locale in hand.
  
    ⚠️ **Dated note, 2026-09-25 — that engine (`ValidationEngine`) is removed from
    `@object-ui/core` by a later change; `ValidationContext.locale` stays declared in
    `@object-ui/types`, and at that change nothing in `@object-ui/core` reads it —
    objectui#7659.**
  
    ⚠️ **Dated note, 2026-09-27 — `ValidationContext` itself is removed from
    `@object-ui/types` by a later change, with the rest of the Phase 3.5
    validation types it belonged to, so the `locale` member this entry adds no
    longer exists — objectui#10719.**
  - `@object-ui/plugin-report`: `exportReport`, `exportAsHTML` and `exportAsPDF`
    take a trailing optional `locale` for the exported file's "Generated:" time,
    and `LiveExportOptions` gains an optional `locale` that `exportWithLiveData`
    forwards. Omitted, the time uses the display channel's own last resort
    (`'en'`), never the machine's locale. `ReportViewer` passes the session's
    display locale. The locale is deliberately NOT a `ReportExportConfig` member:
    that type is authored report metadata, and a display locale belongs to the
    session.
  
  **One census, repository-wide.** `plugin-detail`'s machine-locale census pin
  (objectui#9786) is now a single test, `machineLocaleCensus-9909.test.ts` in
  `@object-ui/i18n`, covering every workspace package whose manifest depends on
  `@object-ui/i18n`. It refuses any call site that passes nothing, `undefined`,
  the `'default'` pseudo-tag (a subtag no locale data answers, so `Intl` resolves
  it to the machine's locale) or a hard-coded tag, unless the site is declared
  with its reason — for example the `catch` fallback for a tag `Intl` itself
  rejected, or an ISO formatter feeding `<input type="date">`. Each declared site
  is counted exactly, so deleting one without its entry is refused too. The
  per-package pin it replaces is deleted. The runtime tripwire that observes the
  argument each locale-taking call (`Intl` constructors, `Date` and `Number`
  `toLocale*`) actually receives moved into the private `@object-ui/test-support`
  package, and every surface above is pinned with it: the same data under two
  declared locales must render differently, NO locale-taking call may receive the
  machine's locale (nothing, `undefined` or `'default'`), and the surface's own
  calls must receive the declared tag. A call carrying another declared tag, such
  as the `'en'` of the session's UI language, is tolerated by design: only the
  machine's locale is the defect.
- 9b9af8d: The Approvals Inbox stops remounting every row on every render.
  
  `ApprovalsInboxPage` declared `RequestCell`, `RecordCell` and `InlineActions`
  inside its own component body. React identifies a component by the identity of
  its function, so each render produced three brand-new component *types* and React
  unmounted and remounted every row's subtree instead of updating it — and the page
  holds its clock in state and ticks it every 60s, so this fired on a timer whether
  or not anyone was touching the page (objectui#5348).
  
  Two consequences were reproduced against `origin/main` before the fix, in
  `apps/console/src/pages/system/ApprovalsInboxPage.cellIdentity.test.tsx`:
  
  - **Transient subtree state is discarded.** Focus placed on a row's Approve
    button moved to `<body>` on the next clock tick.
  - **Input is silently swallowed.** A pointer sequence that spans a re-render —
    press, tick, release — left the confirmation dialog unopened: the captured node
    had been replaced, so React's delegated listener never saw the click. This is
    the failure objectui#5211 hit and worked around at its call site
    (`Unable to find role="alertdialog"`).
  
  The three cells are now at module scope beside `StatusBadge`, which was moved
  there for the same reason and already carries the explanation. Everything they
  closed over is passed in: `RequestCell` and `InlineActions` take the page's
  scoped translator, and `RecordCell` takes `href: string | null` — one prop rather
  than two, so the objectui#5211 readable/unreadable decision and the URL cannot be
  handed in disagreeing with each other.
  
  The verification asserts the consequence, not the placement. A test that checks
  the three functions now sit at module scope stays green for a refactor that moves
  them and introduces a fourth inline component beside them; these cases compare
  DOM-node identity for all three cells across a clock tick, which no remount can
  pass, and re-drive the swallowed click.
  
  That guard is load-bearing because lint cannot supply one here.
  `react-hooks/static-components` exists for exactly this class and is `error` in
  this repo via the plugin's recommended set, yet it reports nothing on this page:
  measured on `origin/main`, an arrow-form inner component injected into
  `ApprovalsInboxPage` and used in JSX produced **zero** reports, while the same
  shape in a ten-line file produced two. The rule's analysis bails out on this
  component, which is how three of them shipped.
- 9180fd1: Approvals inbox: the queue rows and the amount sort now honour each request
  object's own `hidden: true` field declaration (objectui#6020).
  
  The `hidden: true` trim added for the drawer summary card reached only the
  drawer — the desktop queue row, the mobile card and the amount comparator
  still read the field, so an amount an app author declared hidden rendered
  inline in the queue and ordered the list, which leaked its relative magnitude
  even to a viewer who never saw the figure.
  
  The queue spans many objects, so the trim is a per-object lookup and every row
  is answered about its own object; a row left with no renderable amount now
  sorts with the other amount-less rows. `hidden` stays a UI contract
  (objectstack#10749) and the filter still fails open: an unanswered or failed
  metadata read renders today's figure.
- 7c0e417: The Approvals Inbox no longer shows a business approver the submitted record's raw
  row JSON.
  
  The detail drawer's "Raw data (JSON)" panel rendered on `payload != null` alone — no
  principal check of any kind — so every approver could expand (and one-click copy) the
  complete raw snapshot: `id`, `created_by`, `updated_by`, `owner_id`,
  `organization_id`, bare lookup ids, and **the fields the object's metadata declares
  `hidden: true`**. Reported from a live EHR deployment on 17.1.0
  (objectstack-ai/objectstack#10734), where that declaration is a patient-data control.
  The app author had no legitimate lever to remove the panel — field `hidden`, view
  columns, app navigation, permission sets and env vars are all ineffective against it —
  so the remedies available in the field were patching the shipped bundle or injecting
  CSS.
  
  The panel is now gated on `holdsStudioAccess`, reused verbatim from the console's
  `studioEntry` module: `studio.access` is a declared platform-scope capability that a
  tenant org owner does not hold by design, and it already reaches the browser in
  `systemPermissions[]` from `/api/v1/auth/me/permissions`. Nothing new is served,
  computed or made authorable — no new config key, no new i18n copy, and the panel is
  byte-for-byte unchanged for the platform operator it was written for. A business
  approver keeps the structured record summary, the approval chain, the activity feed
  and the decision actions; only the raw snapshot is gone.
  
  The gate reads the RAW `systemPermissions` signal and fails **CLOSED**, inverted from
  `usePermissions().hasCapabilities`. That hook fails open on purpose — hiding a
  holder's button while the server still refuses the write is the worse outcome for an
  action. This panel has the opposite stake, since the measured defect is a non-holder
  seeing it, so every not-a-reported-grant answer denies: no provider mounted, a backend
  predating ADR-0066 that omits the field, the resolver's `catch` path that answers `200`
  with no `systemPermissions` at all, and a reported empty array. A deployment whose
  permission layer just failed must not be the one that leaks the snapshot.
  
  `ApprovalsInboxPage.rawPayloadGate.test.tsx` pins all four verdicts. Because the
  acceptance condition is that something does *not* render — which an empty render
  reproduces perfectly — every denial case also asserts the drawer it denies inside, and
  the `studio.access` case drives the same fixture through the same helper and finds the
  panel. `created_by` and `organization_id` are the witnesses: both are in the page's
  `PAYLOAD_SYSTEM_KEYS`, so the summary card already drops them and their values can
  reach the DOM only through the raw panel. Ablating the gate (restoring the bare
  `payload != null` condition) turns the three denial cases red on exactly that
  assertion and leaves the holder case green.
  
  Out of scope, tracked separately: trimming the summary by object metadata, and the
  server-side residual that sends the unfiltered snapshot to the client at all.
- ac73c24: The approval step progress bar is a vertical stepper, so long flows stop
  clipping their tail steps.
  
  Both occurrences were a single non-wrapping flex row whose steps were each
  `shrink-0`. A flex row's min-content width is the sum of its non-shrinkable
  items, so the bar's intrinsic width grew without bound with step count and
  label length. On a live 17.1.0 project a real 6-step flow with ordinary CJK
  step names measured **1070px inside a 527px container** (objectui#5554).
  
  The two hosts failed differently, and neither failure was recoverable by the
  reader:
  
  - **`ApprovalsInboxPage`** (the inbox detail drawer) — the bar itself was not
    scrollable, so the nearest scroller was the drawer *panel*. Reaching steps
    4-6 meant dragging the drawer's own horizontal scrollbar, which pushed the
    record card, the activity timeline and the action buttons off-screen and left
    a near-blank panel.
  - **`RecordApprovalsPanel`** (the record page's approvals panel) — this one
    carried `overflow-x-auto`, so it scrolled itself rather than its container.
    Better, but the tail steps still sat behind a scroll gesture with no visible
    affordance.
  
  In both, readers took the clipped bar for the end of the data; the reporting
  customer acceptance tester said so verbatim. Widening the window does not help:
  the drawer is fixed-width, and clipping was identical at 1440x900 and 1920x1000.
  
  Both now render as a column: one row per step, a badge-and-rail gutter, and a
  label that may wrap. Width is capped by the container at every step count and
  every label length, which also suits both hosts' tall-and-narrow aspect. The
  rail segment below each step keeps the tint rule the horizontal connector used
  — it is coloured by the step it leads *into*.
  
  **Always vertical, with no step-count or measured-width threshold**, because
  the overflow is driven by intrinsic content width (labels x count), not by
  count alone: three 16-character CJK labels already crowd a 527px drawer, so any
  count threshold picks a cutoff that is wrong for some real flow, and a measured
  one reintroduces a viewport-dependent branch. The card's requirement is a fix
  that cannot break at an untested viewport or flow length, and a layout with no
  breakpoint and no measurement is the form that satisfies it. Horizontal-with-
  scroll was ruled out for both occurrences: it leaves steps behind a gesture.
  
  Pinned in `ApprovalsInboxPage.stepProgressVertical.test.tsx` and
  `RecordApprovalsPanel.stepProgressVertical.test.tsx`. "The stepper renders" is
  green against the broken code too — every step was always in the DOM, and the
  clipping was layout — so the suites assert the property the defect names
  instead: no row is `shrink-0`, every label is `min-w-0` and none is
  `whitespace-nowrap`, nothing in the subtree is an `overflow-x` scroller, and no
  axis, overflow or width-pinning class carries a breakpoint prefix (so there is
  no viewport with untested behaviour). The reported failing regime is exercised
  directly with the reporter's own six CJK labels, and a 2/5/6/12-step sweep pins
  that the layout classes are byte-identical across all four, so no count
  threshold can put some other flow length back on the old path.
  
  The two steppers are kept identical by hand rather than extracted to a shared
  component: they live in different packages, and deduplicating them is a
  refactor with its own surface. Filed separately.
- 7e89836: fix(approvals): derive approver identities from `positions`, not the retired `user.roles` (objectui#5424)
  
  Framework ADR-0090 D3 renamed the session's `roles` key to `positions` with no
  deprecation window, and the protocol-17 session face emits no `roles` key at
  all. Three client sites still read it:
  
  - **`sharedUserFeeds.approverIdentities`** — the bell badge, the bell's
    Approvals tab and Home's To-do card. It read nothing else, so it sent **no
    `role:` identity at all**: an approval addressed to a position rather than to
    a person matched nothing and vanished from all three surfaces, silently.
  - **`approvalsApi.buildApproverIdentities`** — "My Pending" and the
    Approve/Reject enablement. It also splits the scalar `user.role`, so it
    degraded rather than dying: it still yielded `role:user` while dropping every
    business position name (`manager`, `finance_approver`, …).
  - **`AppContent`'s expression user** — forwarded a `roles` key that was always
    `undefined` into every CEL predicate context. Removed; `positions` and
    `isPlatformAdmin` were already forwarded correctly beside it.
  
  The retired spelling is **not** kept as a fallback — pairing the two is what
  ADR-0090 D3 forbids, and `packages/auth/src/types.ts` says so on the
  declaration.
  
  `AuthGuard`'s `requiredRoles` gate (the fourth surviving reader) is deliberately
  untouched: it is a semantics decision, not a rename, and is deferred to a
  maintainer ruling.
- 0e05aac: The console's cold load no longer asks `/api/v1/runtime/config` or
  `/auth/me/localization` twice (objectui#5544).
  
  Two pairs of boot callers were racing each other for the same URL, with no shared
  provider between them, so no guard inside either component could see the other:
  
  - `GET /api/v1/runtime/config` — the pre-React branding script inlined in
    `apps/console/index.html` (it runs during HTML parse so the tab title and
    favicon are the operator's before the bundle is fetched) and
    `initRuntimeConfig()`. Measured ×2 on prod and on staging. This is the
    expensive one: the console `await`s `initRuntimeConfig()` before
    `createRoot().render()`, so the duplicate sat on the critical path to first
    paint, and at the control plane's ~0.5–1.4 s for this endpoint it also pushed
    boot concurrency further past the server's pool knee.
  - `GET /api/v1/auth/me/localization` — `seedTenantLanguage()` on a device's true
    first visit and `LocalizationFetchProvider` on every boot. The seed keeps
    running past its 500 ms race by design and the provider mounts the moment that
    race resolves, so on a first visit the two overlap. Measured ×2 on staging.
  
  `@object-ui/types` gains `sharedGetJson()`: callers that ask for the same GET
  while one is already in flight join that request instead of starting another. It
  shares the in-flight promise and nothing else — the entry is deleted the instant
  the request settles, so there is no cache, no TTL and no stale window, and a
  caller arriving after settle fetches fresh exactly as before. Rejections fan out
  to every sharer with the status intact (`LocalizationFetchProvider`'s retry
  policy still sees its own 503), each caller receives its own copy of the parsed
  body, and only GETs are eligible — a non-GET is refused rather than quietly
  rewritten.
  
  Requests that differ in credentials mode or headers keep separate identities, so
  the console's two deliberate `auth/get-session` calls — one Bearer-only with the
  cookie omitted to detect a stale token, then one through the cookie — stay two
  requests. Collapsing those would have destroyed the signal the first one exists
  to read.
  
  No component receives anything different: same payloads, same errors, one fewer
  round trip.
- 631d81d: fix(console): paint a boot indicator during the pre-React white frame
  
  The console's `index.html` shipped an empty `<div id="root">`, so a hard
  navigation showed a pure-white page until the module graph had downloaded,
  evaluated and resolved the two round trips `main.tsx` awaits before
  `createRoot().render()`. Measured on this repository's production build with
  Playwright + CDP screencast (frames classified pixel-by-pixel, corroborated by
  the Paint Timing API): 1224-2016 ms of pure white on an unthrottled localhost,
  2289-2297 ms at 20 Mbps/80 ms RTT, and 5808-6167 ms on a Fast-4G profile.
  
  The document now carries the indicator itself — an inline style block and the
  same gradient tile `LoadingScreen` opens with — so it paints from the HTML
  parser, before the first chunk is requested. It is removed on React's first
  commit into `#root`, so it never doubles up with `LoadingScreen`, which
  continues to own the init screen and its ten-language copy.
- 71ee495: The two form CONTAINER contracts now have ONE declaration each, derived from
  `@objectstack/spec`, and the console reads them instead of its own copies.
  
  objectui#5542 converged the LEAF of this contract — the field spec — and left the
  two containers above it untouched, because converging them was a bigger call than a
  mechanical import. `FormSectionSpec` and `FormViewSpec` were each hand-declared
  twice under the same names, once in `packages/app-shell`'s `SchemaForm.tsx` and once
  in `apps/console`'s `FormPage.tsx`. Unlike the leaf — whose console copy was a clean
  subset — these two had **already drifted, in both directions**, so neither copy was a
  subset of the other and there were two live answers to "what may an author write":
  
  - `FormSectionSpec` — app-shell declared `description` / `visibleWhen` / `visibleOn`;
    the console declared none of them. The console's `columns` admitted the string arm
    (`'1' | '2' | '3' | '4'`); app-shell's took numbers only.
  - `FormViewSpec` — the console declared `label` / `groups` / `sharing` /
    `submitBehavior`; app-shell stopped at `type` plus `sections`.
  
  The drift is decided by asking the **contract**, not by picking a side. `columns`
  does admit the string arm (`FormSectionSchema.columns` unions `z.enum(['1','2','3','4'])`
  with the four numeric literals, folded to a number by its own transform), so
  app-shell's numbers-only declaration was rejecting metadata the platform accepts —
  objectui#5040's own symptom, not a deliberate narrowing. `label` on the form view is
  the opposite answer: `FormViewSchema` **rejects** it (`unrecognized_keys`, measured
  against the installed `@objectstack/spec` 17.0.0), because a form config is titled,
  not labelled. The value that read actually finds is the VIEW's identity label, which
  arrives on the `ExpandedViewItem` envelope or beside the config on a flattened
  runtime overlay — so it is declared on `FormPage.tsx`'s own `FormViewBody`, next to
  the body it unwraps, rather than smuggled onto the form contract.
  
  Both types are therefore **derived from the spec's own `FormSection` / `FormView`
  with named narrowings** — the repo's sanctioned form for a spec-shaped local type
  (`scripts/check-spec-symbol-derivation.mjs`) — rather than restated. Every key the
  two layers agree on comes from the spec and cannot fall behind it; the four positions
  where this layer is deliberately narrower are each named in an `Omit` list and
  restated once next to its reason: `fields` keeps the converged 26-key leaf (deriving
  it would silently re-open #5542), and `label` / `description` / `visibleWhen` /
  `visibleOn` keep the shapes this repo's renderers and evaluators actually consume
  rather than the spec's `I18nLabel` and `ExpressionInput`. `apps/console`'s
  `submitBehavior` union — previously hand-written under the comment "Mirrors the spec
  FormView.submitBehavior union" — is now read back off the shared type, making the
  mirror structural. `@object-ui/app-shell` re-exports both names from its package root
  (type-only, erased at build — nothing is added to the bundle), because a type that
  cannot be imported is a type that gets retyped.
  
  The pins are what make future drift loud, and each half is pinned on both sides.
  `form-spec.containers.test.tsx` and `FormPage.viewSpec.test.ts` compare the
  non-narrowed half of each type against the spec's own symbol, so re-hand-writing
  either declaration fails `type-check` the day the spec moves rather than years later
  when someone reads two files side by side — and the console's pins read both types
  back out of the **exported** `buildSections` signature rather than naming them, so a
  re-inlined local copy fails even if it agrees on every key on the day it is written.
  Their liveness controls are what stop them being phantom checks: the removed copies
  are pinned NOT equal to the shared types (proving the `Equal` helper still
  discriminates), the renderer's honoured `RenderableSection` is pinned not equal
  either (so the authored-document and honoured-row types cannot be collapsed again),
  and an undeclared key is still rejected (so the derivation smuggled in no index
  signature or `any`). Every narrowing carries a matching negative pin, so "derived"
  cannot quietly become "widened to whatever the spec says".
  
  Behaviour is unchanged — the runtime always accepted these keys. The vitest halves
  prove it: a section spelling its column count as the string `'3'` lays out identically
  to the numeric `3` on both sides, and a section carrying the keys only one side used
  to declare builds the same rows.
- cebdfe7: The form-field authoring contract now has ONE declaration, and the console reads it
  instead of its own copy.
  
  objectui#5040 was not a missing key. It was that **two hand-written descriptions of
  one contract drifted**, and nothing could notice, because each was only ever checked
  against itself. PR #5537 converged the two app-shell descriptions into
  `views/metadata-admin/form-spec.ts`. A **third** survived in `apps/console`:
  `FormPage.tsx` declared its own nine-key `interface FormFieldSpec`, under the same
  name, in a different package — so the same failure mode stayed fully available.
  
  Measured key by key before choosing a route, because the two honest outcomes are
  "same contract, import it" and "genuinely narrower layer, rename it and pin the
  subset". The console's copy was a strict subset — 9 of the shared type's 26 keys,
  every one identical in type, none console-only — and it sat in a position that
  describes an **authored document**: `FormSectionSpec.fields`, read straight off the
  `/meta/view/:name` payload, the same spec `FormView` metadata-admin renders (both
  files even spell the same six-member `type` union and call the element type
  `FormFieldSpec`). The narrow, renderer-honoured shape is a different type that
  already exists in that file, `RenderableField`. So this was one contract described
  twice, and the console's description was wrong about the document: legal metadata —
  `visibleWhen`, `dependsOn`, `type`, `options`, `immutable`, the recursive `fields`,
  and ten more keys — was undeclared there. That is #5040's own symptom, "the type
  rejects the configuration the runtime accepts", which no runtime test can see.
  
  `@object-ui/app-shell` therefore re-exports `FormFieldSpec` from its package root
  (type-only, erased at build — nothing is added to the bundle), and `FormPage.tsx`
  imports it and deletes the local declaration. Reachability is the load-bearing half:
  a type that cannot be imported is a type that gets retyped, and retyped copies drift.
  `form-spec.ts` itself is untouched.
  
  `FormPage.fieldSpec.test.ts` is the pin that makes future drift loud. It reads the
  field-spec type back out of the **exported** `buildSections` signature rather than
  naming it, so re-inlining a local `interface FormFieldSpec` fails `type-check` even
  if the copy agrees on every key on the day it is written — which is exactly what did
  not happen to the copy this change removes. Its liveness controls are what stop it
  being a phantom check: the removed nine-key shape is pinned NOT equal to the shared
  type (so the `Equal` helper is proven to still discriminate), `RenderableField` is
  pinned not equal to it either (so the honoured-row and authored-document types cannot
  be collapsed again), and an undeclared key is still rejected (so the import did not
  smuggle in an index signature). Behaviour is unchanged: the runtime always accepted
  these keys, and the vitest half proves the same rows are built.
- 07cd685: The console's form routes no longer seed a RUNTIME `defaultValue` into the
  control, so the server-side resolution the declaration asks for actually happens
  (objectui#5727).
  
  `readPrefill` in `apps/console/src/components/FormPage.tsx` seeded every declared
  default unconditionally. A `defaultValue` may be a literal, or an *instruction*
  the server resolves per insert — a `DEFAULT_VALUE_TOKENS` token (`NOW()`,
  `current_user`) or a CEL Expression envelope. Seeding one of those literally put
  the text `NOW()` into a datetime input on both `/forms/:name` and the public
  `/f/:slug` route, and submitting it sent that string as the field's value —
  which is neither absent nor null, so `ObjectQL.applyFieldDefaults` never resolved
  the declared default and the column stored the token text instead of a timestamp.
  
  The seed is now guarded by `isRuntimeDefault` from `@object-ui/core` — the same
  published classifier `@object-ui/plugin-form`'s `schemaDefaults.ts` guards its
  seeding with, and the one this renderer already reads once removed (through
  `isServerOwnedValue`) for the create-mode `required` carve-out. A runtime default
  leaves the key ABSENT rather than empty, because absent is precisely the case the
  engine resolves.
  
  Nothing else about the prefill precedence moves: a literal default still seeds, a
  stored record value still wins over a default, and an explicit `prefill_<field>=`
  param still wins over both — including for a field whose default is a runtime
  token, since a value a producer supplies is not a declaration awaiting
  resolution.
- b63a9a3: The console's standalone form renderer now evaluates conditional field visibility.
  
  `apps/console/src/components/FormPage.tsx` is a **second, independent form renderer**
  — its own `buildSections`, its own JSX — and it serves both the public
  `/f/:slug` route and the internal `/forms/:name` route. It read neither spelling of
  the FormView field visibility predicate: a repo-wide grep for a `visibleWhen` /
  `visibleOn` *read* inside that file returned zero. So a field an author conditioned on
  `record.priority == 'urgent'` — legal, spec-strict metadata that `@objectstack/spec`
  normalises to `visibleWhen` (ADR-0089), and that the metadata-admin designer both
  authors and honours — rendered unconditionally on both routes. Fail-open and silent:
  the author saw the field always, with no diagnostic.
  
  objectui#2212 recorded this exact symptom and PR #2214 fixed it — in a **different
  chain**: `ModalForm` → `resolveFormViewLayout` → `@object-ui/plugin-form`
  `sectionFields.ts` → `@object-ui/components` `renderers/form/form.tsx`. `FormPage.tsx`
  is on that chain at no point, and #2212's regression pin lives with the chain it fixed,
  so nothing in the suite could see this copy. One contract, two implementations, each
  only ever checked against itself.
  
  The wiring is **#2212's ruling applied verbatim** rather than a second predicate
  semantics invented for this renderer, because two form renderers disagreeing about what
  `visibleWhen` *means* would be a worse defect than one renderer ignoring it. The
  predicate goes through the canonical engine — `evalFieldPredicate` (`@object-ui/core`,
  `evaluator/fieldRules.ts`) — so the accepted wire shapes (bare CEL string and
  `{ dialect, source }`), the bound scope (`record.*` = the live input values, `previous.*`
  = the stored record an edit form started from), and the fail-open-but-loud behaviour on
  an unevaluable predicate are the shared ones by construction. Resolution is
  canonical-first, `visibleWhen ?? visibleOn`, matching both sibling readers:
  `sectionFields.ts` and app-shell's `readVisibility`.
  
  Two things deliberately did **not** change. A field hidden by its predicate still
  submits its value — conditional visibility is a rendering rule in both renderers, and
  making it a submit-payload rule would be a new contract decided once for both, not
  invented in the second one. And `FormPage` is **not** folded onto the plugin-form chain:
  the second-renderer question is real, but it belongs with the #5596 convergence track,
  not with a predicate that is dead today.
  
  `FormPage.visibleWhen.test.tsx` is the regression pin, and it lives next to *this*
  renderer on purpose — a pin that cannot see the second copy is how the first gap
  survived. With the fix reverted and the pin in place the suite reports
  `11 failed | 1 passed (12)`; the one green is the control that has to be green (a field
  with no predicate still renders), without which every "the field is absent" assertion
  would be equally satisfied by a renderer that draws nothing at all.
- fb934fb: The console's `/docs` portal is code-split for real: its four pages leave the eager closure instead of only pretending to.
  
  `AppContent.tsx` lazy-imports `DocsLayout` / `DocsSlug` / `DocPage` for the
  app-scoped `/apps/:packageId/docs` tree (ADR-0048). `App.tsx` imported the same
  three statically for the platform portal at `/docs` (ADR-0046 section 6), so all
  of them sat in the eager graph regardless and the `import()` moved nothing —
  three `INEFFECTIVE_DYNAMIC_IMPORT` warnings on every `vite build`
  (objectui#5467). A static import on either side silently defeats the split for
  both, and the only signal is a build warning that fails nothing.
  
  `App.tsx` now reaches all four docs pages through `lazy()` behind `Suspense`,
  matching the pattern `AppContent.tsx` already uses. `DocsIndex` joins them even
  though it carried no warning: `AppContent` renders `AppDocsIndex` at that slot,
  so nothing imported `DocsIndex` dynamically, but left static it alone would keep
  `DocShell`, `use-book-data` and `book-nav` eager and the portal would only
  half-leave the closure.
  
  Measured on this branch with the `dist/eager-closure.json` gauge added by
  objectui#5324, both builds exiting 0:
  
  | | before | after |
  |---|---|---|
  | `INEFFECTIVE_DYNAMIC_IMPORT` warnings | 46 | 44 |
  | eager closure, gzipped | 3,881,609 B | 3,870,058 B |
  | eager chunks | 58 | 52 |
  
  Six chunks leave the eager closure: `plugin-markdown` (4,212 B gz),
  `CreateViewDialog` (3,617 B), `use-book-data` (1,966 B), `DocShell` (476 B),
  `componentRegistry` (99 B), and `src` (129,555 B), the last of which rolldown
  folds into the entry chunk rather than dropping — which is why the entry chunk
  grows from 25,910 to 154,378 B gzipped while the closure as a whole shrinks by
  11,551 B. The entry stays far under that budget's 350 KB line, and the eager
  closure is the number a page load actually pays.
  
  What does NOT move is `vendor-markdown`, 164,708 B gzipped and the reason this
  looked like a bigger win than it is. Three eager chunks import it statically,
  and only one of them was this portal: `plugin-chatbot` reaches it directly, and
  `packages/fields`' `MarkdownContent` — lazy in source — is folded into the
  eagerly imported `ui-components` chunk by the `advancedChunks` group that claims
  every `packages/fields` module. That is objectui#5325's mechanism, not this
  card's, and it is why the saving here is 0.30% rather than 4%.
- 8549453: The console's pre-boot branding script now resolves its server origin from
  `VITE_SERVER_URL` — the same variable every module-side consumer reads — instead of
  `window.__CONSOLE_SERVER_URL`, a global nothing in this repository ever set
  (objectui#5660).
  
  The two callers of `GET /api/v1/runtime/config` share one in-flight request, and
  that sharing keys on the FULL URL. So the origin was half of the contract: the
  inline script in `index.html` read one spelling and `src/main.tsx` read another, and
  whenever they disagreed the two never found each other. A same-origin production
  build hid it completely — both spellings collapse to `''` — so the split surfaced
  only in a dev pointing the console at a separate server, where it cost two requests
  to two different servers and let pre-boot branding paint from the wrong one.
  
  The pre-boot fetch is kept, not deleted: it is the request the module side JOINS.
  `sharedGetJson()` can only hand an earlier request to a later caller, and this
  script is the earlier one by construction — it runs during HTML parse, before the
  bundle is fetched, while `initRuntimeConfig()` is awaited before
  `createRoot().render()`. Deleting it would not remove a request; it would move the
  single remaining one later, onto the critical path to first paint, and leave the
  page's empty `<title>` and favicon unbranded until React mounts.
  
  Vite substitutes its HTML env token only when the variable is set and leaves it
  verbatim otherwise, so the unset case is read as same-origin `''` rather than
  allowed to reach the URL as a path segment.
- 7493bff: `registerStudioComponents.tsx` no longer claims a code split it never had: `studio:builder` imports `BuilderLanding` directly instead of through a `lazy()` that deferred nothing.
  
  The registration wrapped `import('@object-ui/app-shell')` in `lazy()` behind a
  `Suspense` fallback — naming the same barrel the line above it imports
  statically for `registerAppComponent`, and the same barrel `App.tsx` pulls
  `BuilderLanding` from to render the standalone `/studio` landing full-screen.
  Either reason alone makes the `import()` unable to move a module into another
  chunk (objectui#5486).
  
  **This moves no modules and is not a bundle improvement.** `BuilderLanding` was
  already in the eager graph via `App.tsx` and still is. Measured on
  `dist/eager-closure.json`, both builds exiting 0: the eager closure holds the
  same 52 chunks with the same names, and the only difference is 130 B gzipped
  (413 B raw) off the entry chunk — the deleted `lazy()`, `Suspense` and fallback
  text themselves, 0.003% of a 3,875 KB closure. Nothing leaves the closure,
  because nothing could.
  
  What it does fix is honesty. The old code told every reader the builder was
  deferred, and it emitted an `INEFFECTIVE_DYNAMIC_IMPORT` warning on every
  console build — the console's count of those drops from 44 to 43, with the 43
  remaining ones all belonging to the `packages/fields` barrel (objectui#5325).
  A permanent warning that fails nothing is how a team learns to skim past build
  warnings, and a decorative `lazy()` is how the next reader learns something
  false about the chunk graph.
  
  The `lazy()` shape is not the mistake. The sibling `registerAccountComponents.tsx`
  lazy-imports `./pages/system/ProfilePage`, a specifier nothing else pulls in
  statically, and is genuinely deferred; it is untouched. Making the *builder*
  genuinely lazy would mean taking `App.tsx` off the static import too, changing
  how `/studio` mounts, and it only pays if app-shell's own graph cleaves behind
  the barrel — a separate measured card, not folded in here.
- d8afbe5: `FormPage` — the console's own form renderer, serving both the public `/f/:slug`
  route and the internal `/forms/:name` one — now honours the three conditional-rule
  surfaces it still dropped after objectui#5594: section-level `visibleWhen` /
  `visibleOn`, and the object-level field rules `visibleWhen` / `readonlyWhen` /
  `requiredWhen` (objectui#5627).
  
  This is the second form renderer in the repo, and it honoured exactly one of the
  four surfaces the sibling chain does. A section an author conditioned away rendered
  in full — heading and every control — on both routes including the anonymous one.
  The object-level half was worse than fail-open hiding: `readonly` was whatever the
  static flag said, so a field a `readonlyWhen` should have locked stayed editable and
  paired with the server's fail-closed unbound-scope behaviour into "the user edits,
  the save reports success, and the value never lands".
  
  Both halves evaluate through the SHARED machinery rather than a fourth consumer-side
  copy of the rule semantics: `@object-ui/core`'s `resolveFieldRuleState` for the three
  field rules — which brings the settled rulings with it, including the `serverOwnedValue`
  carve-out that keeps a create form from requiring a producer-owned control (#4069 /
  #4085) — and its `evalFieldPredicate` for the section predicate, with the canonical-first
  `visibleWhen ?? visibleOn` read every sibling reader spells.
  
  Visibility stays a RENDERING rule at both granularities: a hidden section's fields
  still submit their values, exactly as a hidden field's have since #5594.
- cdda37a: `buildSections` now honours a FormView field's `maxLength` override instead of always
  taking the object's ceiling (objectui#5595).
  
  The function merges a form's field overrides with the target object's field definitions,
  and its own docstring states the rule: *"Field-level FormField overrides take precedence
  over object defaults."* Every key in the loop is built that way — `override.label ??
  def.label`, `override.required ?? def.required`, `override.placeholder ?? def.placeholder`
  — except one, which read `def.maxLength` unconditionally. So an author who set a tighter
  per-form limit (a short public intake form over a column whose object-level ceiling is
  generous) got the generous one.
  
  The failure was silent in the worst direction: no diagnostic, no warning, and the form
  still submits, so the symptom is a value the author believed the input refused being
  accepted. It is load-bearing rather than cosmetic — the merged row reaches the DOM at two
  `maxLength={field.maxLength}` sites, the `textarea` arm and the default `input type="text"`
  arm.
  
  `override.maxLength ?? def.maxLength` — `??` rather than `||`, matching the sibling keys,
  so an explicitly declared `0` stays a value the author wrote rather than falling through
  to the column's ceiling. This narrows only what the input allows; the object's storage
  ceiling still decides at submit time, so nothing that was accepted before is now rejected
  anywhere but at the keyboard.
  
  Why it survived: the console's local `FormFieldSpec` did not declare `maxLength` at all
  until objectui#5542, so no one typing a spec in this app could write the override in the
  first place, and the inert merge branch was never exercised. #5542 converged that type
  onto the shared app-shell declaration, which does declare the key — making the gap
  expressible, and therefore findable.
  
  The pin `#5542` left behind — `expect(row.maxLength).toBeUndefined()` in
  `FormPage.fieldSpec.test.ts`, which recorded the old answer explicitly rather than
  assuming it — is **inverted** to `toBe(40)` rather than deleted. It was the pre-registered
  evidence for this fix, and it is what made the gap findable in the first place, so it
  keeps its place and names the honoured answer.
- fb336df: Move `lucide-react` from `^1.31.0` to `^1.43.0` in every package that declares it, and
  repair what the jump breaks, so icons resolved from a STRING keep drawing a glyph.
  
  Measured once against the installed 1.43.0 artifact when this change was made; nothing in
  the repository re-derives these readings. Across the jump lucide removes no runtime export,
  no public type name and no `lucide-react/dynamic.mjs` name, and every name this repository
  imports from `lucide-react` resolves. Exactly one key leaves the runtime `icons` record:
  `Trash2`, retired in favour of `trash`.
  
  What a user sees change:
  
  - Icons the lazy icon seam draws (`resolveIcon`, objectui#9251) get their path data again.
    lucide 1.43.0 icon modules export their path data inside `__iconData` and no longer
    export `__iconNode`; the seam now reads both. Reading only `__iconNode` against 1.43.0
    leaves every such glyph an empty box, with nothing thrown or logged.
  - `DetailView`'s delete action and three schema-catalog examples spell their icon
    `trash`, not `trash-2`, so they keep resolving. The glyph is unchanged: 1.43.0's `trash`
    path data is byte-identical to the `trash-2` path data of 1.31.0 and 1.35.0. Anything
    that already authored `trash` now draws that same artwork, because lucide moved it under
    the `trash` name; a few other glyphs were also redrawn upstream.
  - Icons imported as COMPONENTS carry lucide 1.43.0's own classes: one class per declared
    alias (a spinner renders `class="lucide lucide-loader-circle lucide-loader-2 ..."`), and
    no longer the class lucide used to derive from the PascalCase key where that differs
    (`ArrowDown01` no longer carries `lucide-arrow-down01`). The canonical
    `lucide-<icon name>` class is still there, so a `.lucide-loader-circle` selector still
    matches.
  - Icons resolved from a STRING through the seam keep the classes they had: `lucide`, the
    canonical `lucide-<icon name>` class and the key-derived class. They do not carry
    lucide's per-alias classes. That is a maintainer ruling (objectui#8941, option C): the
    alias list lives only inside each lazily loaded icon module, and it was not moved into
    the eager name list. A selector that targets an alias class matches a component-imported
    icon and not a string-resolved one. This also dates the example in the objectui#9251
    entry: `trash-2` no longer resolves as a string, so no seam-drawn glyph carries
    `lucide-trash2 lucide-trash-2`; a digit-bearing name that still resolves, such as
    `arrow-down-0-1`, carries `lucide-arrow-down01 lucide-arrow-down-0-1`.
- 60b2211: Console form pages no longer submit a cleared server-owned field as a blank.
  
  A field whose declared `defaultValue` is an instruction the server resolves per
  insert (a `NOW()` / `current_user` token, or a CEL expression envelope) opens
  with an empty control on a create form, and its key stays out of the payload
  while nothing touches it. But a submitter who typed into that control and then
  cleared it put the key back holding `''` — and `ObjectQL.applyFieldDefaults`
  resolves a declared default only for a field arriving absent or null, so the
  blank was stored and the declaration silently defeated.
  
  Such a key is now dropped from a CREATE submit on both the internal
  `/forms/:name` and the anonymous `/f/:slug` route. A blank cleared from a field
  with no runtime default — or with a static one — is still submitted, because
  that is the user removing a value; and an edit submit is untouched, where a
  cleared column is a deliberate removal.
- 98178b2: fix(console): mint a `sys_file` id for files picked in the global action dialogs
  
  `Clause-②: no` — no exported symbol is added, removed or renamed, no accept set
  moves, and no key on a published payload changes. This package's published barrel
  is `plugin.ts` (`ConsolePlugin`, `staticPath`), which this diff does not touch; the
  `App` and `AppContent` exports of the SPA source are unchanged in name and type.
  What moves is WHERE a provider is mounted inside the console's own React tree.
  
  The console's `UploadProvider` was mounted inside `AppContent`, the element of
  a single route (`/apps/:appName/*`). But `ConnectedShell`'s
  `GlobalActionRuntimeProvider` renders the action-param dialog and the
  `ModalForm` a modal action opens as SIBLINGS of the route element, so those
  dialogs rendered outside the provider — and `useUpload()` fails open, silently
  substituting `createObjectUrlAdapter()`, which mints a `blob:` URL locally and
  reports success.
  
  A file picked in one of those dialogs therefore produced no upload request at
  all; `fileValueForSubmit` stored the legacy inline blob instead of a `sys_file`
  reference, and the engine rejected the record with `expected string, received
  object` — an error that points at serialisation while what is missing is the
  upload.
  
  The provider now sits above `ConsoleShell`, so one upload destination serves
  every console surface, and it is built with `createAuthenticatedFetch` so the
  storage routes see the session (and the `X-Tenant-ID` the rest of the session
  carries) instead of a bare cookie-only `fetch`.
- 343c598: The active organization id is now stored per user, and a change of session user drops the
  previous user's client state wholesale (objectui#5664).
  
  `auth-active-organization-id` was a single un-namespaced `localStorage` key while its
  siblings were already user-scoped (`objectui-recent-items:u:`, `objectui-favorites:u:`,
  `flow-palette-recents:u:`). On a browser handed from one account to another — a shared
  machine, a kiosk, a handover, a support session — the arriving user's console read the
  PREVIOUS user's organization id. The header workspace chip rendered the previous user's
  workspace for a user whose `organization/list` was empty, and the consequence past the
  cosmetics is the one worth stating: the polluted org context suppressed
  `RequireOrganization`'s routing into the guided "Create your workspace" first-run flow, so
  a brand-new user on that browser silently never got the new-user flow at all.
  
  Nothing about row visibility rode on this. With the stale id the server answers
  `403 USER_IS_NOT_A_MEMBER` on `get-full-organization` and `set-active`, and lists zero
  environments; the damage was entirely in what the client believed about itself.
  
  Three changes, and the third is the one that closes the class rather than the instance:
  
  - The key is per-user (`auth-active-organization-id:u:$userId`), matching the convention
    its siblings already use.
  - It can no longer be written un-namespaced at all. Where no session user is known yet the
    value lives in memory for that page-load only — a namespacing that kept a bare-key
    fallback would re-open the defect the first time a write happened before the user id
    resolved.
  - **A change of session user drops the previous user's client state wholesale.** This is an
    allowlist sweep of both `localStorage` and `sessionStorage`, not a list of known keys, so
    the NEXT storage key someone adds without a `:u:` scope is covered before it is written.
    Only device-scoped entries survive: the arriving session's own bearer token, the pointer
    recording whose state the browser holds, and the UI theme.
  
  Both properties objectui#5703 established are preserved and still pinned: `get()` prefers a
  non-null `localStorage` read and falls back to the in-memory value, and the memory value is
  nulled BEFORE storage is touched — by `clear()` as before, and now by the user-change purge
  too, so the outgoing user's org id cannot outlive their persisted key on the sign-out-then-
  sign-in path that never reloads the page.
  
  Existing browsers are not migrated. A value sitting under the retired bare key is
  unattributable — nothing recorded whose org id it is — so migrating it is precisely the
  defect it would be migrating away from, and it is deleted instead. A signed-in user loses
  nothing durable: the active organization is a server-owned fact that
  `AuthProvider.refreshOrganizations` re-asks for whenever the list is non-empty and no
  active org is held, including the ADR-0081 single-membership repair. One boot re-supplies
  it; users with no organization land on the guided first-run flow, which is the outcome this
  card is about.
  
  `apps/console`'s pre-render auth preflight purges every spelling of the active-org key —
  the retired bare one and each `:u:` scope — when it finds a dead bearer token, and
  deliberately leaves the session-user pointer in place so the next sign-in can still tell
  that the browser changed hands.
- 9093de8: Approvals drawer: the business summary card no longer renders a field the object
  declares `hidden: true`.
  
  `payloadSummary` built the card from the request's `payload_json` snapshot behind
  five filters (system keys, the lead amount key, null/object/empty values,
  unresolved opaque ids, a six-field cut) and no field-visibility filter, so a
  hidden field that survived to the first six survivors rendered in the card,
  labelled. The drawer now reads the open request's object metadata and drops the
  declared-hidden keys before the six-field cut, so the next business field is
  promoted into the freed slot rather than the card silently shrinking. The lead
  amount figure at the top of the same card takes the same trim.
  
  Per the platform ruling, `hidden: true` is a UI-only contract and `internal: true`
  is the serialization primitive, so this is the UI enforcing the only contract
  `hidden` has — not a client-side compensation. Field-level security is unchanged
  and remains the server's answer. The metadata read is the same cached
  `GET /meta/object/:name` the record form already performs, once per object per
  page visit, and an unanswered read leaves the card exactly as it renders today.
- 0935a43: Console builds no longer carry a live Sentry DSN, and `sendDefaultPii` is now opt-in
  (objectui#5522).
  
  `@object-ui/console` publishes a pre-built SPA, so ONE artifact — built once from
  `apps/console/.env.production` — is what the hosted SaaS console and the on-premises /
  air-gapped EE images all embed. Vite inlines every `VITE_*` from that file into the
  bundle as a frozen object literal, so the DSN committed there was a live third-party
  telemetry endpoint compiled into artifacts that land inside customer networks. It could
  not be switched off afterwards either: the `VITE_SENTRY_ENABLED` kill switch is read off
  that same frozen literal, so on a shipped bundle it is `undefined` forever and editing
  env vars on the deployed host does nothing. An air-gapped deployment was measured
  sending 14 envelopes per session to sentry.io with IP + User-Agent PII, unstoppable by
  the customer.
  
  - `apps/console/.env.production` no longer defines `VITE_SENTRY_DSN`,
    `VITE_SENTRY_ENVIRONMENT` or `VITE_SENTRY_SEND_DEFAULT_PII`. A build with no DSN never
    imports `@sentry/react`, so the `vendor-sentry` chunk is not even fetched.
  - `sendDefaultPii` changed from opt-out (`!== 'false'`) to **opt-in** (`=== 'true'`), so
    IP address and User-Agent are never the inherited default of a build that did not ask
    for them.
  - The gate now fails **closed**: an absent, empty or whitespace-only DSN means do not
    send. The direction is deliberately inverted from the usual — an unreported error is
    recoverable, PII leaving an air-gapped deployment is not.
  
  **Action required for deployments that want error reporting** (the hosted SaaS/demo
  console): inject `VITE_SENTRY_DSN` from your build environment, the same way
  `VITE_SERVER_URL` is already injected, plus `VITE_SENTRY_SEND_DEFAULT_PII=true` if you
  still want IP/User-Agent on events. Nothing else changes for builds that opt in.
- e067173: Refreshes the lockfile so every `@objectstack/*` package resolves at `17.2.0` — `spec`, `client`, `core`, `formula`, `lint` and `sdui-parser` move in lockstep (a split resolution is what produced the dual-version spec graph that reddened `check:spec-symbols` in this repo's history), and no `17.1.0` resolution remains.
  
  **The docs-site and console builds stop pulling a Postgres connection-string parser toward the browser bundle.** `@objectstack/spec@17.1.0` imported `pg-connection-string` at the top level of `dist/index.mjs` with no `browser` export condition, so `apps/site`'s production build failed with `Module not found: Can't resolve 'fs'` on every route that reaches `@object-ui/components` from a client component — red on `main` since 2026-08-22 (objectui#5668). `17.2.0` ships the objectstack#11072 fix: `.`, `./data`, `./system`, `./kernel` and `./cloud` now carry `browser` conditions pointing at schema-free `dist/browser/**` bundles, and the site build is back to `Tasks: 29 successful, 29 total`.
  
  The refresh is lockfile-only — every manifest already declared `^17.0.0`, which admits `17.2.0`, so no dependency range changed. No shipped source moves: the two in-repo adaptations are a drift-guard test and a CI gate, both forced by `17.2.0` retiring the spec's theme module (objectstack `35ad101bc`) exactly as the objectui#5716 localization predicted — its `Theme`/`ThemeMode`/`ColorPalette` ALLOW entries in `check:spec-symbols` went stale and were deleted, and the parity test now pins the vacancy (the spec re-publishing a theme name is a loud collision) instead of a spec leg that no longer exists.
- 7d0143c: The Console now gates the `/studio/*` routes on the `studio.access` ENTRY
  capability, not just on the backend's refusal of the writes behind them
  (objectui#5519).
  
  `/_console/studio/` rendered the full Studio pillar builder — Data /
  Automations / Interfaces / Access, with Publish and Save draft — to any
  authenticated principal who typed the URL, on deployments where the Studio nav
  tile is deliberately absent and every metadata write is refused. A plain tenant
  user was walked through the entire "new package" form and only refused at
  submit (403). The lockdown criterion for that deployment shape is two-part — UI
  entry hidden AND API refused — and only the API half was met; what stood on
  this side was a write-level gate where an entry-level one belongs.
  
  The whole `/studio` subtree now hangs off one route element that reads
  `systemPermissions[]` from `GET /api/v1/auth/me/permissions` (the endpoint this
  app already consumes) and admits only a principal whose LOADED set carries
  `studio.access` — the capability declared as "Enter the Studio metadata-design
  surfaces", which a tenant org owner does not hold by design. Everyone else is
  sent to `/home` without the builder ever mounting.
  
  The fail direction is deliberately inverted from this app's other capability
  gates: those fail OPEN on an unknown answer because their bad outcome is a
  holder losing a button, whereas a route gate's bad outcome is a non-holder
  seeing the builder. So the loading window renders the console splash (never the
  builder), an outright fetch failure renders the retryable error splash, and a
  `200` that carries no `systemPermissions` at all is refused rather than waved
  through. The server-side refusals are untouched.
- Updated dependencies [baac95a]
- Updated dependencies [39b8d51]
- Updated dependencies [99878d8]
- Updated dependencies [c80236e]
- Updated dependencies [4d377ed]
- Updated dependencies [0db4fb3]
- Updated dependencies [4703651]
- Updated dependencies [2acd8e1]
- Updated dependencies [9e37d9b]
- Updated dependencies [492bbd8]
- Updated dependencies [faf5269]
- Updated dependencies [cf1d29e]
- Updated dependencies [80cb063]
- Updated dependencies [6f864cf]
- Updated dependencies [483b794]
- Updated dependencies [adf5812]
- Updated dependencies [5ea623e]
- Updated dependencies [8d58f46]
- Updated dependencies [0b1326d]
- Updated dependencies [305205a]
  - @object-ui/sdui-parser@17.7.0

## 17.6.0

### Minor Changes

- 86f633f: Remove the published optional key `logo` from `AppShellBranding` (`@object-ui/layout`).
  
  The key was declared but never read. `useAppShellBranding` applies only
  `primaryColor`, `accentColor`, `favicon` and `title`, and `AppShell` installs no
  context provider at all — so its doc comment, "Logo URL — passed to sidebar/navbar
  via context", described a mechanism that did not exist. Three call sites were
  feeding the key a real value that was silently discarded, and all three are removed
  with it: `AppSchemaRenderer`, `ConsoleLayout` and the console's `useBranding` hook.
  
  The real logo entry point is unchanged and is where it always was: the app schema's
  own `branding.logo`, read directly by `AppSidebar` in `@object-ui/app-shell`, plus
  the app schema's top-level `logo`, rendered directly by `AppSchemaRenderer`'s
  default sidebar header. Neither path went through `AppShellBranding`, so nothing
  rendering-visible changes.
  
  Migration: a consumer that passes `logo` inside an `AppShellBranding` object literal
  now gets a compile error. Delete the key — it never reached a renderer. To show a
  logo, set it on the app schema's `branding.logo` instead.

### Patch Changes

- 092e2ba: API Console's endpoint catalog drops the `workflow` and `feed` entries — 7 endpoint declarations that could never render on any host
  
  `SERVICE_ENDPOINT_CATALOG` keys are looked up directly in `/discovery`'s `services` map, which the framework keys by `CoreServiceName`. Neither `workflow` (5 endpoints under `/api/v1/workflow/*`) nor `feed` (2 endpoints under `/api/v1/feed/*`) names a `CoreServiceName` slot: the `workflow` slot was retired upstream (objectstack#4451) and `feed` never was one. Both were unconditionally hidden by the fail-closed lookup (ADR-0076 D12) — a miss is indistinguishable from "no such service" — so this changes no rendered output; it only removes two catalog entries that could never surface an endpoint.
  
  Counter-probed against current objectstack `origin/main` before removal: no `registerService('workflow')`, no mounted `/api/v1/workflow` route, and no `/api/v1/feed` route anywhere in source — both are confirmed dead, not merely unused. Per objectui#4303's ruling, this is dead-code removal, not a rename: neither key has a correctly-spelled slot to move to.
  
  #4240's tripwire test — which pins `SERVICE_ENDPOINT_CATALOG` keys against `CoreServiceName` and had carried `workflow`/`feed` as a documented exception set — is trimmed alongside the catalog: the exception set and its `#4303` reference are removed now that both keys are gone, so the assertion goes back to a plain "every catalog key is a canonical slot" with no carve-outs.
- 57e668f: An admin override of an approval now looks like one — before the click, and in the timeline afterwards.
  
  A platform/tenant admin who holds **no slot** in a request's pending-approver
  slate saw the exact same filled **Approve** / **Reject** / **Reassign** a
  designated approver sees: no distinct styling, no warning, nothing. One unmarked
  click takes framework#3424's privileged branch, which is *authoritative* — it
  finalises the node even under `per_group` / `unanimous` / `quorum`, silently
  bypassing every co-sign group that has not voted. The measured consequence in a
  real app project was a PM who clicked Approve *"to see if it was real"* and
  finalised a stage for an approver who never acted, then filed it as "countersign
  is broken". The backend was working as designed; the console gave the admin no
  way to see that.
  
  Two halves, both client-side:
  
  - **Affordance.** A viewer the server reports as `can_act: false` **and**
    `can_override: true` now gets a warning-styled action labelled as an override
    (`Override Approve`), and the dialog it opens **names the pending approvers
    being bypassed**. The wording is the fix, not decoration — a warning that does
    not say what is about to be bypassed would not have stopped that click.
  - **Timeline.** `sys_approval_action.via_override` has been written since
    framework#4466 and sent on the wire ever since, but **no console surface read
    it** — an override rendered byte-for-byte like an ordinary approval in both the
    record page's approvals panel and the Approval Center. Override rows are now
    marked with an `Admin override` chip and a distinct timeline dot. This is
    framework#4466's own *Expected* ("surfaced in the timeline"), which never
    landed.
  
  Nothing here relaxes anything. Who may act or override is unchanged, the request
  the console sends is byte-identical, and no audit record is altered — this only
  renders one that was already being written, and adds friction in front of a
  privileged path.
  
  Two details worth knowing, because both are load-bearing:
  
  - The warning rides the **param dialog's** title and description rather than a
    chained `confirmText`. These decision actions collect params, so the param
    dialog is already the confirm — nothing is POSTed until its own Confirm — and
    putting a second dialog in front of it produces a first prompt that reads as
    "the action ran" (framework#7278, maintainer ruling 2026-08-10). One condition,
    one wording, one dialog.
  - The notice travels as its own dispatch key, **not** folded into the action's
    `description`. The runtime resolves `description` through
    `_actions.<name>.description`, preferring a bundle hit over the passed literal,
    and `plugin-approvals` ships exactly such an entry for `approval_reject` — so a
    warning routed that way would have been silently replaced by the ordinary
    reject copy in every locale carrying the bundle. A safety notice a translation
    can delete is not a safety notice.
  
  Which actions get the treatment is read from each action's **own declared
  `visible` gate** (does it OR in `can_override`?), not from a hard-coded name
  list, so a future decision action still ships as metadata alone — and
  `approval_recall`, gated on `is_submitter`, is never relabelled. Every new string
  goes through the `approvalsInbox.*` i18n path in all ten locale packs.
- 7c297e3: Retire `permission_change`, `export`, and `restore` from the audit-log action filter (`AuditLogPage`'s `ACTION_OPTIONS`) and badge maps (`AuditLogPage` and `HistoryTimeline`'s `ACTION_VARIANT`). These three values never had a writer anywhere on the platform, so the filter always returned zero rows for them and the badges never rendered — a visible product defect (audit surface should be narrow-but-honest, not broad-but-lying). `import`, `login`, and `config_change` are kept: `import` has a real writer (`plugin-auth`'s `admin-import-users.ts`) and is still declared by the server enum and filtered by the `config_changes` list view; `login`/`config_change` gained real writers in objectstack#8144/#8145.
- a34c0b2: `FormPage`'s post-submit `redirect` behaviour now consumes the destination the way objectstack#7496 ruled it (objectui#4190): as a **relative in-app path**, navigated to with the router, with `{{record.field}}` interpolation URL-escaped when the redirect is built — and an out-of-contract destination refused on screen instead of followed.
  
  The url was previously handed to a browser-level, full-page navigation exactly as authored. Two consequences, both fixed here:
  
  - **A ruled in-app path left the app.** A full-page navigation does not see React Router's `basename`, so on a console served under a mount — which the framework CLI configures for every embedded deployment — an authored `/objects/lead` resolved against the origin root and dropped the submitter out of the SPA. Both mounts of this renderer (`/f/:slug` and `/forms/:name`) live inside the console's router, so the destination is now a router navigation and the mount is applied by the router itself. `withConsoleBase()` is deliberately not used: it prefixes anything not already targeting another absolute SPA mount, so it would have mangled an absolute destination rather than fixing it.
  - **`{{record.field}}` tokens were never substituted.** The ruled shape accepts them and assigns the substitution — and the URL-escaping of every interpolated value — to the moment the redirect is built, which is here. The scope is the record the submit just wrote (values as submitted, with whatever the server echoed back layered over them, and the id read by the same one rule the `created-record` behaviour uses).
  
  The shape verdict is not restated in this app: `resolveSubmitRedirect` asks `@objectstack/spec`'s own `FormViewSchema` at the moment of use, so an absolute URL, a protocol-relative `//host`, a backslash, a control-character smuggle, a malformed token or a document-relative path is refused with the spec's own author-facing prescription, and a later widening of the ruling is followed by the pin rather than by an edit here. A refusal confirms the submit — the write succeeded, only the destination was out of contract — and shows the reason, rather than leaving the submitter watching a redirect that must not happen.
  
  `delayMs` semantics are unchanged. The wait now lives in an effect tied to the component, so a submitter who navigates away during the delay is no longer yanked back by a timer that outlived the page.
- 8739c8e: Approvals Inbox: stop offering a record link that dead-ends for the viewer it is
  offered to. Approver routing goes by position while record visibility is a
  separate gate, so an approver can be routed a request about a record they cannot
  read — the row's record chip then landed on the record page's "Record not found".
  The row (and the drawer's record title) now suppress the link for exactly those
  targets, decided by one batched readability read per distinct object. Nothing
  else changes: the title still shows, the approval decision path is untouched, and
  the server's access semantics are neither read nor reported on.
- ab9c970: The Public Forms dialog now refuses an out-of-contract `submitBehavior.url` at the moment it is authored, with the contract's own prescription shown next to the field (objectui#4990).
  
  The redirect branch validated one thing — that the field was not empty — and wrote whatever else was typed into the view metadata. objectstack#7496 rules this key **relative-only** and refuses seven families of value; this door enforced the first. An admin could type `https://example.com/thanks`, or `javascript:alert(1)`, and be told nothing by the surface that had just taught them the value was acceptable — the field was `type="url"`, whose own notion of valid is an absolute URL, under a `https://example.com/thanks` placeholder.
  
  What changed:
  
  - **The save is refused, with the spec's sentence.** The verdict comes from `checkSubmitRedirectUrl`, the same `@objectstack/spec` `FormViewSchema` parse the renderer already asks at submit time — now exported from `submitRedirect` and called by the door. An absolute URL, a script or data scheme, a protocol-relative `//host`, a backslash, whitespace or a control character, a malformed `{{record.field_name}}` token, a document-relative path and an empty value each get their own author-facing prescription, naming the rule and what to write instead. The rule is not restated here: a second copy in the dialog would pass every value comparison right up to the release that moved the original, so a later widening of the ruling is followed by the pin rather than by an edit.
  - **`Redirect URL is required` is gone.** Empty is one of the seven families, so it routes through the contract too and the author reads a sentence that says what a destination looks like.
  - **The field no longer teaches the wrong value.** It is a plain text input with a `/thanks` placeholder, and a hint stating the rule — an in-app path, `{{record.field_name}}` interpolation, and the app navigation item that is declared for a deliberately external destination.
  
  The saved value is the one the schema accepted, read back off the parse, so the door and the renderer cannot hold different opinions about a destination. `thank-you`'s `title` and `message` stay unvalidated deliberately: the spec declares both as free-form strings, so there is no contract for a door to state about them.
  
  The server's own metadata gate already refused these bodies (`422 invalid_metadata` on `submitBehavior.url`, from the same schema), so this closes an error path rather than a silent-save hole: the correction now arrives in the field the admin can fix instead of as a failed round-trip.
- a9e17b4: `auth.forgotPassword.successDescription`'s address hole is now spelled with
  single braces (`{email}`) instead of i18next's double braces (`{{email}}`),
  in all ten locale packs.
  
  This is a spelling-only change — rendered output is byte-identical in every
  language, because the hole was never filled by i18next in the first place:
  `ForgotPasswordForm` substitutes the address itself once the user submits
  the form (the label renders before the address exists, so `t()` cannot do
  it). `{{email}}` and a genuinely unfilled i18next hole were indistinguishable
  at the call site, and passing `email` as an interpolation argument — the
  natural "fix" for what looks like a missing argument — would let i18next
  consume the hole and cause the address to be appended a second time
  (objectui#4135).
  
  Converging on `{x}` for every hole a component fills downstream of `t()`
  (the convention `resendOtpCountdownText`'s `{seconds}` already used) puts
  this hole outside i18next's `{{…}}` syntax entirely, so the ambiguity is
  gone by construction rather than fenced by an exemption. Accordingly,
  `scripts/check-i18n-call-site-keys.mjs`'s `EXTERNALLY_INTERPOLATED_HOLES`
  registry entry for this key is retired — the gate needs no exemption for a
  hole i18next was never going to touch.
  
  `ForgotPasswordForm.tsx`'s replacement marker and its own built-in default
  label move to the same spelling in the same change, as does the inline
  `defaultValue` at `apps/console/src/pages/auth/ForgotPasswordPage.tsx`'s
  call site.
- 38ba3dd: API Console's endpoint catalog reads the canonical `storage` service slot
  first, falling back to the deprecated `file-storage` slot while the
  framework's v17 alias lives (objectui#5286, framework#9683).
  
  `useApiDiscovery`'s `SERVICE_ENDPOINT_CATALOG` looks its service names up
  directly in `/discovery`'s `services` map, and that lookup is deliberately
  fail-closed (ADR-0076 D12) — a miss hides the whole endpoint group rather
  than erroring. The framework's #9683 ruling made `storage` the canonical
  `CoreServiceName` slot and kept `file-storage` mirrored, byte-equal,
  alongside it for `@objectstack/spec`'s v17 lifetime. Before this change the
  console only ever read the deprecated key; it now reads the canonical key
  first, so the Storage group correctly reflects the framework's own naming,
  and still renders unchanged against a backend that has not deployed the
  #9683 mirror row yet.
- Updated dependencies [279fb13]
- Updated dependencies [40d3a33]
  - @object-ui/sdui-parser@17.6.0
  - @object-ui/react-runtime@17.6.0

## 17.5.0

### Minor Changes

- 0e67b53: `/accept-invitation/:invitationId` is one route, one component, one namespace — the console now renders the invitation page that actually shows you the invitation

  Two components shipped for this single URL. The console routed its own thin page, which offered nothing but an Accept and a Decline button: it never told the user which organization they had been invited to, in what role, or when the link expires, and accepting left them in whatever organization they were already in. App-shell's page — exported as `DefaultAcceptInvitationPage`, routed by nobody — fetches the invitation, shows the organization, the role and the expiry date, and switches the user into that organization on accept. Console now routes that one. The thin page is deleted.

  Behind them sat two i18n namespaces for one screen: `acceptInvitation.*` (12 keys) for the thin page and `organization.accept.*` (14) for the richer one, both freshly translated into ten languages by different slices of objectui#3546, neither wrong when read on its own. That is 26 keys of duplicated copy with no gate to tell the next author which of the two to edit — the failure mode this repo already has an uncollected precedent for. `acceptInvitation.*` is removed from all ten packs, and its absence is pinned negatively so it cannot drift back: the slice-three test now asserts that no pack defines any of the 12 retired keys (nor an emptied namespace root left by a partial revert), and that neither consuming package asks `t()` for one.

  One behavior needed repairing before the swap was safe rather than after. `?redirect=` is a basename-stripped path by contract in this console — `LoginPage` re-prefixes it with the mount before navigating — and the thin page built it from the route param, correctly. App-shell's page built it from `window.location.pathname`, which already carries the mount, so a console served under a `<base href="/console/">` would have sent the user back to `/console/console/accept-invitation/…` after signing in. It now reads the router (`useLocation`), like every other producer of that parameter in this repo. Under the default `/` mount the two spellings are identical, which is why only a basename case can see the difference; that case is now a test.

  Nothing published was removed: `DefaultAcceptInvitationPage` keeps its export and simply becomes the routed implementation. Downstream apps mounting it get the redirect fix and are otherwise untouched.

- ae10a01: Console chrome reaches the bundle — the list switcher, the aggregate footer, the dialog a11y fallbacks and the whole Settings namespace screen stop being English on non-English consoles

  Six strings on the two screens a user looks at most were hardcoded English literals rather than bundle lookups, so they stayed English on every non-English console with nothing an app could author to change them. They are not object, field, view or action labels — no key in `TranslationData` reaches them — while the console's own bundle already ships zh-CN, ja-JP, es-ES, de, fr, pt, ru, ko and ar and translates hundreds of neighbouring strings. Omissions from an otherwise complete bundle, not a missing capability.

  **Two of the six needed no new keys at all, which is the more interesting half.** The list-view mode switcher named its nine visualizations from a private `VIEW_LABELS` table while `console.objectView.viewType*` — the same nine words — had been resolved through the bundle by the create-view picker for months; the switcher now reads those keys, so the picker's 「画廊」 and the switcher's 「画廊」 cannot drift apart in nine languages. The create/edit dialog's close button is the remainder of a fix that already landed: objectstack#5505 routed the `sr-only` close label through `common.close` for the two Shadcn-synced primitives, but `MobileDialogContent` is a hand-written wrapper outside that regeneration zone with its own close button, and it is exactly what `ModalForm` renders — so the dialog the report measured was the one place still announcing "Close" in English.

  The aggregate footer is the one the original report singled out: the **number** was already locale-formatted and the **prefix** was a hardcoded `Avg: ` / `Sum: `. All eleven aggregation kinds now take their prefix from `grid.summary.*`, and the label/value join is its own key rather than a `': '` baked into the renderer — the separator is translatable content, so zh sets a fullwidth colon and fr the French space-before-colon. The numbers are untouched. The form dialog's `sr-only` description fallback joins the packs too; it is clipped, not visible, so the only way an app could displace it was to author a `description` and thereby put a visible subtitle on every dialog.

  **The Settings namespace screen converts as one unit.** `SettingsView` routed zero framing copy through i18n — save/failure toasts, the env-lock and crypto refusals, the load-error card, the empty-route state, the navigation buttons, the unsaved-changes save bar — while its immediate sibling `SettingsHub`, in the same directory, resolved everything through `t('console.settingsHub.*')`. A zh-CN admin read correctly translated field labels sitting inside an English save bar, because `useSettingsLabel` translates a namespace's authored content but reaches none of the chrome around it. All of it now resolves through a `console.settingsView.*` namespace placed beside the hub's, including the crypto-refusal strings that objectui#4579 deliberately left in English rather than leave one translated string among a dozen literals.

  The save-bar counter was an English plural rule executing in every locale (`change` plus an `s` when the count exceeds one). It is now a real i18next plural family — base key plus `_one` and `_other` in all ten packs — not the `(s)` spelling translated nine ways. The base key is the load-bearing part: i18next asks `Intl.PluralRules` for the one suffix a language needs and, finding no such slot, falls back to English, so without it Russian would read English at counts 2-20 and Arabic at 2-99. Russian and Arabic take the "noun: {count}" form their packs already use for this exact reason, and the counter is verified rendering in-language at 1, 2 and 5.

  The Beta badge reuses the hub's existing key rather than minting a twin, and the refusal messages interpolate their subject through the bundle instead of concatenating a translated word onto an English prefix.

- 3b7d1cc: An unloadable app list no longer lands you on `/home` as though you had no default app — and the Applications page's Set-as-default / Disable / Delete now actually write

  Two defects on the same journey, reported together because the second is why the first had no workaround.

  **The landing.** `resolveLandingPath` reads a list of apps, and an empty list is a legitimate input with a legitimate answer: rule 3 sends you to `/home`, the multi-app launcher. What it could not see is _why_ the list was empty. A failed `GET /meta/app` produces exactly the same `[]` — `MetadataProvider.ensureType` catches and resolves an empty array, so nothing rejects and `loading` goes false — and the resolver then reported "this deployment has no default app" about a deployment it never managed to ask. The wrong answer did not stay soft, either: `Navigate … replace` rewrites `/` to `/home` in history, so a reload re-enters at `/home` and the `isDefault` branch never gets a second chance; if the session also turns out to be dead, the auth guard captures `/home` into `?redirect=%2Fhome` and honors it after sign-in. An error-state fallthrough should never be fossilized as user intent.

  `/` now resolves a landing only from an app list that is an _answer_. The distinguishing fact already existed on the metadata context and is used as-is — `getTypeStatus('app')`, the provider's own per-type load status — so no second dialect of loading or auth state is introduced, and the landing policy itself is untouched: every existing rule, including the empty-list fallthrough and the Setup-only case, still resolves exactly as before when the list genuinely loaded. While the list is unknown the console holds at `/` and re-asks the metadata layer once, so a transient failure heals on its own and a real outage settles on a screen that is at least not a claim about which apps exist.

  The originally reported chain had an earlier link that is already closed: before objectui#4042 the `/` route mounted the resolver with no guard above it, so an unauthenticated visitor ran the whole resolution against a list emptied by a 401. That entry is now guarded and the bare `/` is deliberately not captured as a redirect target, and both facts — plus the legitimate deep-link capture that must keep working — are pinned here for the first time.

  **The Applications page.** Set as default, Disable (and the bulk toggle) and Delete each showed a success toast having issued no request at all, then called `refresh()` — which re-rendered the unchanged server state underneath the confirmation, and is what made the stubs read as a working feature. Their `// TODO: Replace with real API call when backend supports app management` was measured against `@objectstack/client` 17.0.0-rc.6 and its premise is false: the write surface exists, is gated on `manage_metadata`, and is already how app schemas are persisted elsewhere in this console. All four handlers now await a real mutation and report success only afterwards; a refusal surfaces the server's own message. Set-as-default demotes the outgoing default before promoting the new one, so the landing cannot depend on the order the server lists apps in, and the bulk toggle counts the writes that actually landed rather than the size of your selection.

- e4d1c08: `resolveHostAppSegment` is published from `@object-ui/app-shell`'s package root, and the console's local copy of it is deleted

  Which app should host a framework-owned, app-INDEPENDENT page — the Approvals Inbox, the full inbox, an internal form's created record — is one hard-won definition, and `resolveHostAppSegment`'s docblock says so at length: prefer the app the user is in or last had open RE-CHECKED against the live active list, else their first active app, else the two last resorts. It lived in `app-shell/src/utils/appRoute.ts`, and `packages/app-shell` published only its package root, which re-exported `./utils` nowhere. So the definition was unreachable from every consumer outside the package.

  Something outside the package needed it anyway. objectui#4109 had to name a host app for the record an internal `/forms/:name` submit creates, could not import the resolver, and shipped a documented local subset instead: steps 1 and 2 only, returning `null` where upstream falls through further. That is the "two readers of one prose contract" shape this repo keeps paying for (#3367 / #3842) — the next edit to the resolution order lands on one copy — and the divergence was disclosed rather than smuggled precisely so it could be collected later. This is that collection.

  `resolveHostAppSegment` is now exported from the package root, alongside the two predicates it is defined in terms of (`appRouteSegment`, `filterActiveApps`), and the console's copy is gone: `createdRecordPath.ts` holds the URL shape and delegates the choice. The app record type it accepts is derived from the resolver's own signature rather than re-declared, so the call site cannot drift from it either.

  **Behaviour change on the created-record redirect.** Converging on the full resolver means the two cases the subset answered `null` for now name an app. An empty openable list with a preferred app keeps that preferred app unchecked — an empty list means "not loaded yet" at least as often as "this user has no apps", and demoting someone demonstrably rendering inside `/apps/{preferred}/…` would reintroduce the defect objectui#4074 removed. Anything else unresolvable — no apps and nothing preferred, or apps carrying neither `_packageId` nor `name` — lands on `setup`, the least-surprising last resort rather than a broken link. Concretely: an internal form submit that previously stopped on FormPage's in-place confirmation ("no record page to land on") now navigates to the record under the resolved app, which is the same answer every other record link in the console already gives. The write itself was never at stake, only where the user is put afterwards. The remaining `null` from `buildCreatedRecordPath` means what it always should have: there is no record to point at, because the caller has no object or no id.

- 90e792e: Internal `/forms/:name` renders inside the console shell, and an internal submit lands on the record it just created

  A `type: 'form'` action navigates to `/forms/:name` (`ActionRunner.executeForm`). That route was declared at the TOP level of the console route tree, a sibling of the app-shell routes, so clicking a button inside an app dropped the user onto a bare form — no header, no navigation, no way back — while the URL still said they were in the console. It now renders inside the console's layout for app-independent authed pages, the same chrome `/home` and `/organizations` use. The route itself is unchanged: deep links to it keep working, because the missing chrome was the defect, not the navigation.

  The second half is what happens after Submit. The post-submit default was `{ kind: 'thank-you' }` for both form modes, so a signed-in operator who had just created a record was shown the ANONYMOUS confirmation — "Your submission has been received" — with no link to the thing they had created. The default is now mode-aware: an internal submit navigates to the created record's page, while the public `/f/:slug` path keeps `thank-you`, which is the right answer for a visitor who has no console to be sent into. A form view that declares its own `submitBehavior` still wins in both modes, unchanged and untouched — the point of a default is that the corpus never has to opt out of a wrong one.

  Landing on the record needs the created record's id, and that comes from the spec-declared `CreateDataResponse = { object, id, record }` returned by `POST /api/v1/data/:object`. Only that one declared key is read: `record.id` carries the same value, but reading both would be a second de-facto contract for one fact. A response that names no id — or a workspace where no app can host the record's page — falls back to confirming the submit rather than navigating somewhere broken, since the record really was created and silence would be the worse answer.

  No authorable surface changed. The "land on the created record" behaviour is deliberately NOT a new `submitBehavior.kind`: the spec's union (`thank-you | redirect | continue | next-record`) is strict and stays exactly as it is, and nothing parses the new internal default out of metadata — it is only what the renderer does when an author declared nothing.

- 78fa331: console: seed the UI language from the tenant's server-side locale

  `GET /auth/me/localization` has always been fetched on every boot, but its
  `locale` only ever fed currency/date formatting — the UI language was decided
  entirely client-side, so a tenant configured `zh-CN` still handed every new
  device an English console until each user switched by hand.

  The tenant locale now sits in the language precedence chain, between the user's
  own choice and the browser's:

  1. the user's explicit choice (`objectui-locale`)
  2. the tenant's server locale, cached at `objectui-locale-seed`
  3. the browser language
  4. `en`

  The server value is cached in a slot of its own and is never written into the
  explicit-choice slot, so it can never masquerade as a preference the user
  expressed: only a manual switch promotes a language to an explicit choice. A
  cached seed applies synchronously at bootstrap, and the in-app fetch refreshes
  that cache from every successful answer, so a tenant that changes its locale
  reaches choice-less devices on their next boot without an old seed pinning
  them. On a device's true first visit the fetch is raced against a ~500ms
  timeout alongside the console's existing pre-mount round-trips and fails open
  to the browser language; a seed that arrives after the bound is cached for the
  next boot rather than re-languaging a live session. A tenant locale this build
  ships no pack for falls through to the next tier instead of half-rendering.

  No platform additions: no new endpoint, no client read/write API, and
  `sys_user_preference` is untouched.

### Patch Changes

- a00d23c: API Console renders the Storage group again — its catalog key now names the canonical `file-storage` slot instead of the route

  The API Console's service-gated groups are keyed by canonical service-slot name, because the key is looked up directly in `/discovery`'s `services` map — and the framework keys that map by `CoreServiceName`. The storage group was keyed `storage`, which is the _route_ (`/api/v1/storage`), not the slot (`file-storage`). So the lookup missed on every host, and because a miss is indistinguishable from "no such service" the deliberate fail-closed branch (ADR-0076 D12) hid all three storage endpoints — upload, download, delete — on every deployment, whether or not a storage service was registered and healthy.

  The fail-closed posture was never the defect and is unchanged; only the key moves. The group's user-facing name stays `Storage` — that is the route's name, and it was never derived from the catalog key, so no display string and no i18n resource changes.

  The mis-key survived because nothing tied the catalog's keys to the vocabulary they are spelled in: a wrong key produces silence, not an error, and an empty group is exactly what a legitimately absent service looks like. A tripwire now derives that vocabulary from `@objectstack/spec` itself and asserts every service-gated catalog key against it, so a rename on either side fails a test instead of quietly emptying a group. Deriving it also surfaced two further keys that name no slot and therefore can never render — `workflow` (slot retired upstream) and `feed` (never a slot) — recorded as a documented exception set pointing at objectui#4303 rather than fixed here, since neither has a correctly-spelled name to move to.

- 734d186: The console's Applications page is localized — its own chrome only, never the
  server's words (objectui#4307).

  `AppManagementPage` was raw English end to end: headings, the search field, the
  selection and bulk controls, the six per-row actions with their tooltip/ARIA
  pairs, the status badges, and every toast. It was the last un-i18n'd system page,
  and #4233 / PR #4300 had just given it four live mutations — so the gap became
  user-visible on every non-English console at the moment operators started using
  it. 45 keys land under `appManagement.*` in all ten packs, reached through
  `useObjectTranslation` with the call site's `defaultValue` inline, which is the
  convention the neighbouring system pages already follow.

  The split that shapes this change is between the strings the PAGE authors and
  the strings the SERVER authors. `PUT`/`DELETE /api/v1/meta/app/:name` is gated on
  `manage_metadata` (ADR-0066 D1), so a refusal like `forbidden: manage_metadata
required` is the server's diagnosis of one specific request; there is no fixed
  catalogue of those sentences to key against. Each failure toast is therefore a
  keyed template with a `{{reason}}` hole, and what fills the hole is passed
  through byte for byte, untranslated. The one part that IS the page's own — what
  it says when the server sent no message at all — is keyed as
  `appManagement.toast.unknownError`.

  Two smaller things follow from doing the conversion properly rather than
  mechanically. The per-failure entry of a bulk toast and the separator between
  entries are keys, not literals, because bracket style and list punctuation are
  locale properties (the same rule, and the same past defect, as
  `validation.formInvalidJoiner`). And the row's controls now name an app through
  the resolver the visible heading two lines away already used, with `t` passed:
  an app carrying objectui's keyed label form previously rendered `Select [object
Object]` into its checkbox's ARIA label.

- 3b4d78e: The Applications page's search box no longer takes the page out on the first keystroke when an app carries a non-string label

  `apps/console/src/pages/system/AppManagementPage.tsx` filtered on `(app.label || '').toLowerCase()`. `label` and `description` are `I18nLabel` in `AppSchema` — `string | Record< string, string >` in `@objectstack/spec` 17.0.0-rc.6 — so an authored non-string label is spec-legal metadata, and an object is **truthy**: the `|| ''` guard never fired for one, and `.toLowerCase()` received the object.

  ```
  TypeError: (l || "").toLowerCase is not a function
  ```

  That throw happened inside `filter` **during render**, so it took the whole page down rather than degrading search. It stayed invisible until someone typed, because `if (!searchQuery) return true` returns before either read — the page mounted perfectly with the very metadata that killed it one character later.

  Both reads now go through the resolver the rows already render with: `appTitle` (the single display-name helper objectui#4307 introduced in this file) for the label, and the identical `resolveKeyedI18nLabel(…, t)` call the description paragraph makes. This is a repair to one page's filter, not a new capability — but it does make search match what the operator can actually see: for objectui's keyed label form it now matches the pack's answer rather than the authoring `defaultValue`, and it matches `app.name` wherever the row heading itself falls back to it.

  Routing search through the render path also means it cannot drift out of step again. The inline locale map form (`{ en: 'Storefront', 'zh-CN': '店面' }`) is still resolved by neither path — the row heading falls back to the app name and search now matches on exactly that, instead of crashing on it — so when objectui#4163 widens the resolver, display and search gain the map form in the same commit.

  No first-party app ships a non-string app label today, so this was reachable through authored metadata rather than live in the shipped examples; the crash is real for anyone who authored one, and `AppSchema` accepts it with a green parse.

- d0c3b26: Every plain `<button>` now declares its `type`. HTML defaults an untyped button to
  `type="submit"`, so any of these buttons would submit the form it was composed into
  instead of running its own handler — a real risk for renderers (`drawer`, `tree-view`,
  `navigation-overlay`) whose placement inside a form is a JSON metadata decision. 114
  sites were converted to `type="button"`; no site was a genuine submit button, and the
  DOM is otherwise unchanged.

  The defect class is now closed mechanically by a new `object-ui/button-has-type` ESLint
  rule (error), so the next untyped button fails CI at write time rather than being found
  by a fourth audit round (objectui#4045, closing the objectui#3344 family).

- 25b9833: Console: restore `crypto.randomUUID` on insecure origins so list views stop crashing on LAN IPs

  `crypto.randomUUID` is exposed only in secure contexts (HTTPS or
  `http://localhost`). Reaching a dev box over plain HTTP from another machine —
  `http://192.168.x.x:4001/_console/`, the ordinary second-device flow — left the
  method undefined, and every unguarded caller threw
  `TypeError: crypto.randomUUID is not a function`, taking the console's list
  views into the ErrorBoundary.

  The console's HTML entry now installs an RFC 4122 v4 fallback built on
  `crypto.getRandomValues` (which is not secure-context-gated, so the entropy
  stays cryptographic). It runs as an inline classic script, synchronously during
  parse, so it precedes every bundled chunk. It is guarded on absence and never
  replaces a native implementation, so secure origins are unaffected; with no
  entropy source available it installs nothing rather than degrading to
  `Math.random`.

- 2a40f69: Retire two post-retirement dead surfaces (#4364, #4368). Both were measured at this
  branch point rather than taken from their cards, and one card's premise only half held.

  Breaking for anyone who typed against the removed declaration, marked `minor` per this
  repository's version-alignment convention (the major tracks `@objectstack`, never an
  API-break count):

  - `@object-ui/types` and `@object-ui/permissions` no longer export
    `ObjectLevelPermission`. It declared a second, parallel home for object-scoped grants
    (`{ object, actions, effect?, conditions? }`) that nothing constructed, accepted or
    read once `RoleDefinition.permissions` was retired (#4288) — its only remaining
    referents were its own definition and the two barrel lines. The wired home is
    `ObjectPermissionConfig.roles`, whose inner grant shape is declared inline; that is
    what the evaluator reads, and it is unchanged. `ObjectPermissionConfig`'s doc comment
    now records the retirement so the surface is not re-declared. (#4364)

  `PermissionCondition` was proposed for retirement on the same card and is **kept**: its
  premise ("only referent is `ObjectLevelPermission.conditions`") did not hold at this
  branch point. `evaluateCondition` in `@object-ui/permissions` takes it as a parameter
  type and implements all eleven of its operators under a 26-case suite. `PermissionEffect`
  is likewise untouched — `FieldLevelPermission.effect` still reads it.

  No behaviour change, no public surface change:

  - `@object-ui/console` drops `src/utils/metadataConverters.ts` and
    `src/services/MetadataService.ts`. Both were console-local duplicates of live
    `@object-ui/app-shell` modules and lost their last importer when the bespoke
    object-detail widgets were retired (#4365). Both had already drifted behind the live
    copies they duplicate — the console converter's `referenceTo` chain never read the
    server's `reference` key, and the console service predates the view cache-invalidation
    seam (#4373) — which is precisely the imitation trap the card recorded: an author
    grepping for "the converter" could land on the unexercised copy. The app-shell copies
    and their tests are untouched. (#4368)

- 6d8231c: A `type: 'form'` action fired from a record now EDITS that record instead of creating a duplicate

  `ActionRunner.executeForm` forwards the record an action was fired from as `/forms/:name?recordId=<id>`, but the console's internal form route never read that param. The only query params it consumed were the `prefill_` ones, so the route rendered EMPTY inputs, and its submit was an unconditional `POST /api/v1/data/:object` — an insert. An "edit this record" action therefore opened a blank form and, on Submit, created a second record while leaving the original untouched. In the showcase app: open any Task, click **Log Time**, fill it in, Submit — a NEW Task appeared. Until objectui#4109 the damage was hidden behind the anonymous "Your submission has been received" panel; once an internal submit started landing on the record it wrote, the duplicate became visible immediately.

  `?recordId=` now selects the whole read/write pair. The route loads the record with `GET /api/v1/data/:object/:id`, prefills the inputs with its stored values, and saves with `PATCH /api/v1/data/:object/:id` — the verb the data plugin declares (`plugin-rest-api.zod.ts`), the one `packages/rest` registers, and the one every other update client in this workspace already spells. After a successful save the user lands back on the record they edited.

  A `recordId` the route cannot honour now fails closed. A record that 404s or 403s, a payload whose object contradicts the form's target, and a present-but-blank `?recordId=` each render the form's error state; none of them falls back to create mode, because a blank form whose submit inserts a duplicate is this bug's exact harm and silently degrading into it would just re-arm it. A `recordId` naming a record of a different object is not found under the form's own object, so it takes the same refusal path.

  When a URL carries both a `recordId` and `prefill_` params, the explicit params win for the fields they name and the record's stored values fill the rest — a producer that forwards both is expressing intent, and the per-field instruction is the more specific one. Stored nulls and empty strings count as real values and beat a field's create-time `defaultValue`, so opening an edit form never silently proposes a change the user did not make.

  Two surfaces are deliberately untouched. Create mode — no `recordId` — behaves exactly as before, and the public `/f/:slug` path ignores `recordId` entirely: an anonymous visitor controls the URL, so honouring it there would turn a public form into an arbitrary-record reader and writer. In `@object-ui/app-shell` only the URL-param registry's documentation changed, recording that `recordId` now has a second reader on a route that can never match the same URL as the record drawer's.

- 3e19fe7: i18n copy: one ellipsis glyph across the ten packs, `usted` in the es draft-preview empty state, and a pt sentence that stops contracting `de` onto its own hole

  Three locale-copy defects that no gate could see, because all three are _value_ defects on keys whose names, placeholders and key sets were already correct.

  **One ellipsis (objectui#3878).** `en` ended 33 values with three ASCII full stops (`Loading...`, `Ask anything...`) and 110 with the typographic ellipsis `…`, and the nine translation packs had copied `en` value by value — so a user could read both glyphs on one screen: `common.loading` beside `dashboard.loading`, `console.ai.askAnything` beside its own panel's siblings. All ten packs now spell it `…` (U+2026), per the maintainer-authorized consistency pass registered on objectstack#6015. 312 pack values changed: 34 in `en` (the 33 trailing plus the one mid-sentence `collaboration.commentPlaceholder`) and 278 across the nine. Eleven inline `defaultValue` call sites were re-synchronised with the new `en` text, which `scripts/check-i18n-call-site-keys.mjs` requires byte-for-byte.

  The convention is now pinned so the split cannot regrow: `packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts` fails, by key name, on any value in any of the ten packs that holds three ASCII full stops. It is deliberately wider than "a trailing `...` in `en`", because the census showed the narrow rule would have shipped with two holes in it — `collaboration.commentPlaceholder` puts the ellipsis mid-sentence, and `list.loading` had the packs wrong while `en` was already right, which no `en`-only rule can see.

  Fifteen module-local **no-provider fallback** entries were moved with the packs, across `useCollaborationTranslation`, `useFieldTranslation`, `useDetailTranslation`, `ObjectGrid`, `KanbanImpl`, `data-table` and `ConnectionStatus`. Those maps exist to render when no `LocalizationProvider` is mounted, and each one's own docblock requires it to stay byte-identical to the `en` pack — a requirement objectui#3440 already enforces mechanically for the collaboration map. Leaving them behind would have made the provider-less path disagree with the provider path on ten keys.

  **es `usted` (objectui#3875).** `preview.empty.notReadyDescription` said `Revisa la conversación` — the tú imperative — in a namespace that is otherwise 23:1 usted, and it renders _underneath the usted draft-preview banner at the same moment_, not before or after it. `Revisa` → `Revise`; nothing else in the sentence carries a register. The neighbouring `approvalsInbox` namespace is legitimately tú and was left alone.

  **pt contraction (objectui#3877).** `ConcurrentUpdateDialog` splits `detail.concurrentUpdateDescription` on `{{field}}` and renders a bolded label in the gap, and pt left a bare `de` in front of that gap. When the multi-field conflict branch passes the record label (`este registro`), Portuguese users read `de este registro` — a contraction error every native speaker sees, and one that no spelling of the leaf value could fix (`deste registro` renders `de deste registro`). The pt sentence is rewritten so the hole is preceded by the verb `afeta` instead of any preposition, which closes the whole class rather than trading `de` for an `em` or `a` that contract just as hard. pt only; `en` is unchanged.

  No behavior, no keys added or removed, no placeholder changed.

- 297534b: Align 43 inline `defaultValue` strings with the `en` pack, and make the call-site gate enforce it (objectui#3810)

  `t(key, { defaultValue: 'English text' })` only renders that text when i18next
  **misses** the key. Where the key exists in `packages/i18n/src/locales/en.ts` the
  pack value always wins, so the inline string is dead code — and 43 of those dead
  strings said something different from the sentence users actually read.

  `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) now compares the two
  whenever a call site carries a literal `defaultValue` for a key `en` defines, and
  fails on any byte of difference. It is a hard rule with **no baseline**: the
  repo-wide census measured 43 sites in 19 files out of 851 literal inline defaults,
  and all 43 are aligned here, so there is no debt for a ratchet to hold. A
  `defaultValue` on a key that is _not_ yet in `en` stays legal — that transition
  runs for months (objectui#3546) and belongs to the existing `missing-key` rule,
  which keeps reporting it alone.

  Every fix moved the CALL SITE to the pack's wording. `en.ts` is untouched: its
  values are what users read today, and changing one would oblige the same change in
  the nine other packs (`scripts/check-i18n-en-drift.mjs`, objectui#3650). Six of the
  43 differed only in an ellipsis (`...` against U+2026) — invisible in review, which
  is how they survived three i18n gates that are each blind to this class by
  construction.

  The visible effect is confined to hosts that render these components with **no**
  `I18nProvider` and no initialised i18next instance. There, react-i18next's
  not-ready `t` returns the `defaultValue`, so the inline string was the rendered
  one; it now matches what a provider-backed app has always shown. Inside the
  console — provider mounted — nothing users see changes. The clearest converging
  examples: the workspaces screen was written as "Organizations" at nine call sites
  while every user has been reading "Workspaces"; the forgot-password success line
  was written as "If an account exists, a reset link has been sent." while the pack
  asserts "We've sent a password reset link to {{email}}."

- 66fb4fa: The console's language menu now asks the app which locales it actually ships, instead of always offering the same ten.

  `LocaleSwitcher` built its items from a module-level `LANGUAGES` constant — exactly the ten codes `@object-ui/i18n` ships packs for — and never consulted the app, even though `GET /api/v1/i18n/locales` has been serving that list all along. It failed in both directions at once. An app shipping a locale outside those ten (`th`, a regional `pt-BR`) had no way to be selected from the console: the bundle could be complete and lint clean, and the menu simply had no entry for it. An app shipping only `en` and `zh` still listed all ten, so picking 日本語 handed the user the console's own chrome in Japanese with everything app-authored in the fallback language — a half-translated UI its author never opted into.

  The menu is now the **intersection**: the app's own locale list ∩ what the renderer can actually resolve (built-in packs, `config.resources`, and — for an app that wires a dynamic `loadLanguage` loader, which is how the console gets its packs — the locales that loader can fetch). Both failure directions close in the same change: an app-shipped locale becomes offerable, and locales the app does not ship disappear. The endpoint is reached through a new `loadLocales` prop on `I18nProvider`, wired exactly like the existing `loadLanguage`: the app owns the transport, the provider owns what is done with the answer. An app that does not wire it keeps today's menu unchanged.

  **The restore validation widened in lockstep, because otherwise this fix would have minted the next bug.** A restored language was validated against "the locales this provider can produce" — built-in packs plus `config.resources` — a bound that was correct only for as long as the menu offered exactly the built-in ten. The moment the menu grows to the app's real list, a locale the user can now pick is a locale that bound rejects, so a user-picked app locale would have been purged on the next page load. It now also accepts a locale a wired dynamic loader may be able to fetch, and the bound stays honest rather than absent: only well-formed BCP-47 tags qualify (`constructor`, `__proto__`, `en_US` are still rejected, as is any stored locale in an app with no loader), and the app's own locale list adjudicates the choice for real once it arrives — a locale the app has since dropped is reverted and purged rather than left locking the UI to a language with no translations.

  Labels come from the built-in native names where they exist (`中文`, `日本語`, … are unchanged) and from `Intl.DisplayNames` for everything else, so an app locale is named in its own language rather than by its code. The endpoint's own `label` is deliberately not used for display: the server sets it to the code echoed back, which would have put `th` in the menu where `ไทย` belongs.

  While the app's list is in flight the switcher renders nothing, following the sibling menus in the same folder — the ten never flash past on an app that only ships two. When there is no backend, the endpoint fails, or the app answers with nothing this renderer can produce, the built-in ten remain as the offline fallback, so the menu is never empty and never unusable.

- 275d7df: Retire the dormant bespoke object-detail page factory and its seven widgets

  `buildObjectDetailPageSchema()` had zero callers. Its only consumer was the registry-driven `MetadataDetailPage`, deleted when the console moved onto the metadata-admin engine; the factory outlived it by months as code no route could reach. The seven widgets it fed — `object-detail-tabs`, `object-properties`, `object-field-designer`, `object-relationships`, `object-keys`, `object-data-experience`, `object-data-preview` — were still registered in `ComponentRegistry` at startup, so they were reachable in principle by any schema naming those types, and in practice by none: nothing in the repository produces one.

  That unreachability is also why 60 lines of hardcoded Chinese UI copy sat in `objectDetailWidgets.tsx` and `ObjectDetailTabsWidget.tsx` against the English-only rule without any gate seeing them — the strings were bare literals, never `t()` keys, and all three i18n gates judge keys. Translating copy that no user can reach, on a surface with no future, was the more expensive of the two exits; the maintainer ruled REMOVE (objectui#3731 / #3736) and both cards close together.

  Deleted: `schemas/objectDetailPageSchema.ts`, `components/schema/objectDetailWidgets.tsx`, `ObjectDetailTabsWidget.tsx`, `ObjectFieldDesignerWidget.tsx`, `registerObjectDetailWidgets.ts`, and the `main.tsx` registration import. No user-visible behaviour changes, because no route rendered any of it. The `skills/objectui/guides/console-development.md` chapter that positioned the factory as the bespoke-editor recipe now points at the live specimen (`PermissionMatrixEditPage`) instead, and the retired names are recorded in that guide's "Retired names" table.

- 36a4124: Settings save: render the fail-closed crypto refusal as its own state instead of a generic save failure

  A deployment with nothing able to encrypt a declared-secret setting refuses the write, and
  since objectstack#8396 it says so in its own wire envelope — `SETTINGS_CRYPTO_UNAVAILABLE`,
  with `error.details` locating the refused `{ namespace, key }` and `error.message` carrying
  the operator prescription. The console read none of it: the code fell through to the generic
  error path, where the field-error extractor finds no `details.fields` array and returns null,
  so nothing was marked and the whole refusal collapsed into one transient toast reading "save
  failed". The admin was told the save did not work; that the DEPLOYMENT cannot encrypt, and
  which key it refused, was on the wire and thrown away.

  `SettingsView` now branches on the code the way it already does for `SETTINGS_LOCKED`: it
  names the refused key as `namespace.key` from the declared `error.details` slot, and renders
  the server's prescription verbatim in a persistent panel — the server owns that copy, so the
  console frames the refusal but never restates how to fix it. The draft is kept, so the value
  is not lost while the deployment is reconfigured, and the refusal clears when its claim can
  actually have become false: a new save attempt, a save that succeeds, a discard, or a reload.

  The value itself is never rendered — the envelope locates the refusal and deliberately does
  not carry the secret, and the console does not re-introduce it from the draft it is holding.
  `SETTINGS_LOCKED` and `SETTINGS_VALIDATION` are untouched, and an unrecognized code still
  takes the generic path.

- b3f665b: `/setup` is a real address again — the console gets a stable deep link into platform administration instead of bouncing you back to home

  Opening `/_console/setup` landed on `/_console/home`. System settings had no direct URL at all: the only way in was clicking the 「系统设置」 card on the home launcher, which meant the entry point could not be bookmarked, could not be pasted into a support runbook, and was asymmetric with Studio, whose front door has been stable for a while.

  The route was never missing — it was occupied. `/setup` mounts the first-run owner-bootstrap wizard (ported here when the Account SPA was retired), and that page evicts everyone it is not meant for: a signed-in visitor via `window.location.assign('/')`, which the landing resolver then turns into `/home` on any multi-app deployment. So the bounce was the wizard doing its job at a URL that had quietly acquired a second, more common meaning.

  `/setup` now decides between the two, on the condition the wizard itself already probes — whether the deployment has an owner (`GET /api/v1/auth/bootstrap-status`). No owner yet: the wizard, unchanged. Otherwise: the platform-administration deep link. A live session short-circuits the probe entirely, because `hasOwner: false` cannot be true while somebody is signed in — which also keeps a failed probe from re-creating the bounce it is meant to remove. The verdict is latched for the lifetime of the mount, because `signUp()` flips the session to authenticated while the wizard is still renaming the bootstrap organization, and re-deciding on that flip would unmount the wizard mid-submission.

  The destination is read from metadata rather than spelled out. `SetupRedirect` (new, exported from `@object-ui/app-shell` alongside `SystemRedirect`, with its policy available as the pure `resolveSetupAppPath`) resolves the Setup app through the same `appRouteSegment()` helper the home launcher's app cards use, and forwards to the app ROOT — so the page you land on is whatever `AppContent` already resolves as that app's landing item, not a second copy of that policy that would drift the next time Setup's navigation is re-ordered. Search and hash carry across the hop, as they do for `SystemRedirect`.

  Two edges are handled rather than papered over. An unauthenticated deep link now goes to `/login?redirect=%2Fsetup` through the console's existing auth-redirect contract — router-derived, so it stays correct under a `<base href>` mount — and lands back on `/setup` after signing in; previously it reached a bare `/login` and the deep link was dropped. And a viewer whose metadata contains no Setup app (the common cause is not a broken build but a missing `setup.access` permission, which filters the app out server-side) gets the shell's ordinary "App not available" screen, with its retry and its one-shot metadata re-check — never a silent landing on home, and never the bare `/apps/setup` pseudo-route, which would have resolved to whichever app happens to be the default.

  `/_console/studio` was checked for the same asymmetry and needed no change: bare `/studio` is a declared front door rendering the builder landing, and `/studio/:packageId` already redirects to its Data pillar.

- 1f34b38: The first-run setup wizard no longer drops a brand-new owner outside the console

  On a console served under a mount — `/_console/`, which the framework CLI configures for every embedded deployment by injecting a `<base href>` — finishing the first-run owner bootstrap landed the new owner on the ORIGIN root instead of the console. Both of `SetupPage`'s exits navigated to a bare `/`: the success path after the account is created and the bootstrap organization renamed, and the bounce that sends an already-signed-in visitor away. `window.location.assign` does not go through React Router, so its `basename` never applied and a root-relative `/` left the SPA. It is the worst possible moment for a dead end — the first screen after creating the account, on a deployment that by definition has no other account to recover with.

  Under the default `/` mount the prefixed and unprefixed spellings are identical, which is why no standalone `os dev` run ever surfaced this.

  Both exits now go through the console-mount helper `LoginPage` already used for exactly this, so they land inside the SPA under every mount. They stay full-page navigations deliberately: the console shell mounts its metadata tree as soon as auth _resolves_ rather than when it authenticates, and re-keys it only on language, so the app list read while nobody was signed in would survive a router navigation and leave the new owner in an appless console. Tearing the document down is what guarantees the console rebuilds with the session.

  The helper itself was module-private to `LoginPage` and had already been copied verbatim into `RegisterPage`. It now lives in one place with all three auth surfaces importing it, so the next mount fix lands once rather than three times. `LoginPage` and `RegisterPage` behaviour is unchanged, and pinned as unchanged across all three mount configurations.

- 234238e: fix(console): a Setup-only environment lands on `/home`, not Setup's all-zero System Overview

  A new builder arriving on a just-created environment (platform SSO, no explicit
  target) landed on Setup's **System Overview** — a platform-health/audit
  dashboard reading all zeros, because a fresh environment has no audit history
  yet. The intended first screen is the environment's own home: build with AI,
  start from a template, Your apps.

  The path was `resolveLandingPath`'s rule 2. Measured end to end:

      /  →  RootLandingRedirect  →  resolveLandingPath([setup])
         →  rule 2 "single visible app"  →  /apps/setup
         →  AppContent.resolveLandingRoute() → the app's first nav item
         →  dashboard/system_overview

  Rule 2 itself is right — a one-app PRODUCT deployment should not have to click
  through a one-tile launcher. Setup is not that app: it is the platform
  administration console that `@objectstack/platform-objects` ships into every
  deployment, so "the only app this viewer can see is Setup" means _this
  environment has no product apps yet_, not _Setup is the product_. Under ADR-0075
  the environment layer's home is the environment's own responsibility, so that
  case now resolves `/home`.

  Deliberately narrow — everything else is byte-identical:

  - a declared landing still wins (rule 1, `isDefault`, untouched): an admin
    console that genuinely wants Setup first says so, and gets it;
  - a one-app product deployment still lands in its app;
  - `[product, setup]` still resolves `/home` exactly as before — Setup is
    excluded from the single-app _outcome_, never from the visible _count_;
  - the `/setup` deep link is unchanged: `/` is "an arrival with no target",
    `/setup` is an explicit one, and it still resolves into Setup.

- 9461dd3: Form actions no longer carry a record id across an object boundary (#4292).

  `ActionRunner.executeForm` forwarded `/forms/:name?recordId=<id>` unconditionally,
  and that URL says nothing about which object the id belongs to — so the form route
  resolved it against the FormView's own target object. When an action fired from a
  record of a DIFFERENT object and ids collide across objects (per-table integer
  keys), the form silently prefilled and, since the route learned to honour the param,
  `PATCH`ed a same-id record of the wrong object.

  - **Producer**: the id is forwarded only when the firing context record's object
    (`context.objectName`) matches the target view's object; on a mismatch no id is
    forwarded, preserving create semantics. When it IS forwarded, the object travels
    with it as `?recordObject=`.
  - **Consumer**: `/forms/:name` refuses — no record read, no write — when
    `recordObject` disagrees with the FormView's object. A URL without the param
    behaves exactly as before, so existing deep links are unaffected.
  - @object-ui/sdui-parser@17.5.0
  - @object-ui/react-runtime@17.5.0

## 17.4.0

### Patch Changes

- 28c3856: Register `approvals:inbox` as a component ref, and stop sending Home's "pending approvals" card into the setup app (objectstack#7231).

  The Approvals Inbox had no addressable identity: nothing in any app's navigation metadata pointed at it, and every entry to it was a hardcoded path. `HomePage`'s action-center card spelled `/apps/setup/system/approvals`. That path is not wrong about the page — `system/approvals` is mounted as both `extraRoutes` and `extraRoutesNoApp`, so `/apps/{any app}/system/approvals` has always resolved — it is wrong about the app. A business user with approvals waiting but no access to `setup` followed the only entry Home offers them into the shell's "App not available" guard.

  Two changes, one additive and one corrective:

  - `approvals:inbox` now resolves in the component registry to the Approvals Inbox page, so a `{ type: 'component', componentRef: 'approvals:inbox' }` nav item renders the full inbox at `/apps/{app}/component/approvals/inbox` — tabs, drawer, decision actions and record deep links all scoped to `{app}`. Both mount paths are relative routes under `/apps/:appName/*`, so the page reads the same `:appName` and the same `?request={id}` deep link either way. The standalone `system/approvals` route is untouched and stays the target of server notification and email links; the registry key is purely additive indirection, so the approval surface can be rebuilt later behind the same key without any navigation metadata changing.
  - The Home card now navigates within the app the user last had open, re-checked against their live active-app list so a remembered app that has since been deactivated is not resurrected as a dead link, falling back to their first available app. `setup` survives only as the last resort for an app carrying no addressable segment at all — the zero-app workspace never reaches this producer, because Home returns its welcome empty state before the action center exists.

- 7883c02: Send the console host's legacy URL redirects straight to the canonical metadata-admin routes instead of routing them through the deprecated `component/metadata/resource` alias (objectui#3639).

  `apps/console`'s `ObjectRedirect` and `MetadataRedirect` rewrote `system/objects[/:name]` and `system/metadata[/:type[/:name]]` onto `…/component/metadata/resource[/:name]?type=:type`. app-shell declares that spelling as a legacy _alias_, not a page: its route element is `LegacyMetadataRedirect`, which immediately navigates on to `…/metadata/:type[/:name]`. Every one of those URLs therefore took two `<Navigate>` hops (plus a re-render) to reach a destination the host could name directly — and it was this indirection that carried `sys-objects` into the zero-app blank screen fixed in objectui#3610, since the alias was the leg that branch did not recognise.

  Both redirects now construct `…/metadata/:type[/:name]` (and `…/metadata` for the typeless directory arm) themselves. The endpoints are unchanged, byte for byte, including the alias hop's own percent-encoding of `:type` and its verbatim pass-through of `:name`; only the intermediate hop is gone. The alias routes stay declared exactly as they were — bookmarks, external links and the setup left-nav still arrive on them and are still forwarded — this change only stops the console feeding its own traffic through them.

  Also corrects four docblocks that described the alias as "the engine route", in `apps/console`'s two redirects and in app-shell's `datasource` resource registration and page. That wording is not merely stale: the objectui#3610 dispatch read this chain and concluded `component/metadata/resource` was the canonical spelling, which is the exact opposite of what the route table says.

- d2fd044: Point the last four navigation producers at the canonical metadata-admin routes instead of the deprecated `component/metadata` alias, removing a redirect hop from each (objectui#3660).

  The System hub's "Metadata" and "Datasources" cards aimed at `…/component/metadata/directory` and `…/component/metadata/resource?type=datasource`, and the `sys-datasources` entry in both `AppSidebar.systemFallbackNavigation` and `UnifiedSidebar.homeNavigation` spelled the latter too. app-shell declares those spellings as legacy _aliases_, not pages: their route element is `LegacyMetadataRedirect`, which immediately navigates on to `…/metadata` and `…/metadata/datasource`. Every click on any of the four therefore paid a redundant hop plus a re-render to reach a destination the navigation could name directly. All four now name it.

  The landing pages are unchanged, byte for byte — the new URLs are exactly what the alias hop was already computing (`datasource` percent-encodes to itself, and neither producer carried a query or hash beyond the `?type=` the alias itself consumed). Only the intermediate hop is gone.

  The alias routes stay declared in both `AppContent` branches, untouched: bookmarks and external links still arrive on them and are still forwarded. This completes objectui#3639, which corrected the console host's two redirects and enumerated these four as the remainder.

- c1a18ed: System Hub: a card count that failed to load no longer renders as `0`

  Each count on the System Hub fetched one object and caught its own failure with
  an empty page, so a 500, a 401, a 403 or a dropped connection all produced the
  same confident `0` as a table that really is empty — no error, no retry, and no
  way to tell the two apart. The most reachable case was a permission denial on a
  single object: an administrator who may open the hub but cannot read
  `sys_audit_log` was shown "0 entries" rather than being told anything at all.

  A failed lookup now leaves that card's count unknown, and the badge — which
  already renders only for a known count — is omitted, so the card shows no
  number instead of a wrong one. The catch stays on each call rather than around
  the batch, so one object's failure blanks only its own card and the cards beside
  it keep the real numbers they received.

  Unchanged: an object the backend does not have still counts `0`. The adapter
  resolves an unregistered object as an empty page by design (callers read empty
  as "feature unavailable"), so that never was an error and is not treated as one
  here.

- 278f57c: Count System Hub's Organizations card through `sys_organization`, the object the framework actually registers — it asked for `sys_org`, which does not exist, so the card read `0` on every deployment (objectui#3670).

  The failure was silent by construction. A missing object answers `404 OBJECT_NOT_FOUND`, and `ObjectStackAdapter.find()` absorbs that on purpose — it caches the name in `missingResources` and resolves `{ data: [], total: 0 }` so callers can treat an uninstalled collection as "no rows". The hub renders `data.length`, so a name the framework never had produced a perfectly ordinary `0`, indistinguishable from a workspace that genuinely has no organizations — which no single-org deployment ever is, since `sys_organization` always holds at least one row. The `.catch` on each call never even saw the 404; it only ever covered non-404 rejections.

  The other three counted names were checked against the framework's object registry and are correct as spelled: `sys_user`, `sys_position`, `sys_audit_log`.

  The Permissions card is **not** fixed here and still reads `0`. Its query names `sys_permission`, which the framework also does not have — it splits that surface into `sys_capability` (lineage: its own docblock says "named `sys_capability`, not `sys_permission`") and `sys_permission_set` (function: the admin-managed grant container). Both would render, so choosing one would silently bind the card to a surface nobody picked; that decision is open on objectui#3655. Until it lands the gap is held visible by a MEASUREMENT case in the page's test rather than quietly re-aimed.

- cc95c2c: Point System Hub's Permissions card — both its link and its count — at `sys_permission_set`, closing the last of the five `system/*` navigation targets (objectui#3655).

  Four of those URLs became redirects in an earlier change; `system/permissions` was deliberately held back, and so was the count beside it, because the framework splits what this console calls "Permissions" into two Setup entries and picking one would have silently bound every click, bookmark and badge to a surface nobody chose:

  - `sys_capability` — ADR-0066 layer 1, the definition registry of "what can be done". Its own docblock notes it is what the ADR "loosely floats" as `sys_permission`, which is the name the retired page and the count query both used, so lineage pointed here.
  - `sys_permission_set` — ADR-0066 layer 2, the grant container the permissions docs call "the only capability container" (object CRUD, field security, access depth, system capabilities), so function pointed here.

  It is decided as `sys_permission_set`: the card reads "Manage permission rules and assignments", and rules-and-assignments is layer 2 — a capability is what a permission set references by name, not what an administrator is assigned. Two user-visible consequences:

  - `/apps/:app/system/permissions` now forwards in one hop to `/apps/:app/sys_permission_set` instead of being rewritten to `…/system/record/permissions` and rendering a record detail page for an object literally named `system` — a dead link that read as a backend fault.
  - The Permissions card's badge shows the real number of permission sets. It previously counted `sys_permission`, an object the framework does not register; the adapter absorbs that `404` into an empty page on purpose, so the card printed a confident `0` no administrator could tell apart from "there really are none".

  Recorded as a transitional alias. Retiring this hand-written card wall along with the hub (already `@deprecated` in favour of the metadata-driven navigation) remains open and does not conflict — a redirect keeps old bookmarks resolving either way.

- 9961df2: Declare the retired `system/{users,organizations,roles,positions}` console URLs as redirects onto the framework-owned system objects (objectui#3655).

  `SystemHubPage`'s cards and both sidebars' `sys-*` cluster emit five `/apps/setup/system/…` targets. Four of them were real routes until `apps/console` was slimmed for third-party customisation, which deleted the bespoke wrapper pages because "these objects are now contributed by framework plugins … and resolved via the generic `/apps/setup/<object_name>` route" — but the producers were never retargeted and nothing redeclared the URLs. All five fell through to app-shell's tail, where the failure they got depended on how long the word was, because `ShorthandRecordRedirect` treats any URL-safe segment of 6+ characters as a record id:

  - `users` (5) and `roles` (5) rendered "Page not found".
  - `organizations` (13) and `positions` (9) were rewritten to `…/system/record/<word>` and rendered a record detail page for an object literally named `system` — the worse of the two, because it reads as a backend/data problem rather than a dead link.

  Each now forwards in one hop to the object the framework's own Setup navigation names: `sys_user`, `sys_organization` (the list entry — the record-scoped one needs a runtime `{current_org_id}` a static redirect cannot resolve), and `sys_position` for both `roles` and `positions` (ADR-0090 D3 renamed `sys_role` to `sys_position`, so the sidebar's "Roles" and the hub's "Positions" are one surface in two vocabularies). Same shape as the `system/objects` and `system/metadata` redirects beside them: the URL is translated, the deleted page is not resurrected, and the navigation producers are untouched.

  `system/permissions` is deliberately left as it was. The framework splits what this console calls "Permissions" into two Setup entries — `sys_capability` and `sys_permission_set` — and picking one here would silently commit every click and bookmark to a surface nobody chose. Its unchanged landing is pinned in the tests so the gap stays visible.

- Updated dependencies [d11996e]
  - @object-ui/react-runtime@17.4.0
  - @object-ui/sdui-parser@17.4.0

## 17.3.0

### Minor Changes

- d22ae31: Track `@objectstack/spec` 17.0.0-rc.2 (objectui#3235, #3208, #3287, #3264).

  The pin moves from `^17.0.0-rc.1` to `^17.0.0-rc.2` across the workspace, and
  the sibling `@objectstack/*` packages (`client` / `core` / `formula` / `lint`)
  move with it — they pin `@objectstack/spec` **exactly**, so leaving them behind
  kept a second copy of the spec in the tree and would have had `@objectstack/lint`
  validating against rc.1 schemas that still accept keys rc.2 retires.

  Breaking semantics, in FROM → TO form:

  - **`app.homePageId` is retired — an app's landing page is now its first
    navigation item.** An app that pinned a landing page with `homePageId` will
    open on the first reachable navigation entry (by `order`) instead; the root
    landing still follows `isDefault`. To restore a specific landing page, reorder
    `navigation` so the intended entry comes first. Stored metadata is migrated by
    `os migrate meta --from 16`. The key is a hard error now, not a stripped one:
    the spec ships a tombstone that names the migration.
    Upstream retired it because of its SHAPE, not its usage — it was an ID
    cross-reference with no referential integrity, so a `homePageId` that pointed
    at nothing silently fell back to the first navigation item anyway
    (objectstack#4667, premise corrected in #4709). If the capability returns, it
    returns as a flag on the navigation item itself, which cannot dangle.
  - **`@object-ui/types`' `HttpMethod` now resolves to the spec's
    `HttpMethodType`.** Shape is verbatim identical — the same 5-value UI subset —
    and `@object-ui/types` still exports it as `HttpMethod`, so no consumer
    changes. The spec renamed its `./ui` export because `HttpMethod` named two
    different types depending on the import path (`./shared` / `./api` carry a
    7-value enum including `HEAD` / `OPTIONS`); objectui deliberately keeps the
    5-value one (objectstack#4691).
  - **`AppContextSelector.includeAll` / `placement` are gone.** Neither ever did
    anything in this renderer: context selectors are mandatory-scope, so no "All"
    row was ever rendered, and `placement: 'topbar'` put nothing in the topbar.
    Both carried schema defaults, which is why the liveness lint structurally
    could not flag them — removal was the only channel that reaches an author
    (framework#4509).
  - **`NavigationArea.visible` / `order` / `requiredPermissions` are gone.** An
    area is a layout grouping, not an access boundary. Gating moved down to the
    navigation ITEM, where `visible` and `requiredPermissions` are unchanged and
    still enforced. `AppSchemaRenderer`'s area switcher no longer hides an area, so
    an area whose items are all gated away renders as visible-but-empty rather
    than disappearing.
  - **`@object-ui/core` no longer exports `NotificationProtocol`**
    (`resolveNotificationConfig`, `specNotificationToToast`, `mapSeverityToVariant`,
    `mapPosition`, `ToastNotification`). It bridged `@objectstack/spec/ui`'s
    `Notification` / `NotificationConfig`, which objectstack#4610 deleted with no
    successor. Use `resolveNotificationConfig` from `@object-ui/react`
    (`NotificationContext`), which owns the live `NotificationSystemConfig` and is
    what every notification surface already read. Note that the spec's _other_
    `Notification` — `@objectstack/spec/api` — is the REST inbox row, a different
    contract, and is deliberately NOT aliased in as a replacement.
  - **The `email_template` client-side validator now uses
    `EmailTemplateDefinitionSchema`.** It was pointing at the removed
    `EmailTemplateSchema`, so authored templates were being checked against the
    wrong contract: the live one is keyed `name` + `locale` (not `id`) and splits
    the body into `bodyHtml` / `bodyText` (not `body` + `bodyType`)
    (objectstack#4616 / #4807).

  Fixes that are not breaking, but were only found because rc.2 stopped being
  lenient — each had been passing vacuously:

  - **`view` drafts are actually validated now.** The client validator named the
    aggregated container schema while this admin authors first-class `ViewItem`s,
    and the container used to strip `viewKind` / `config` in silence — so no view
    draft ever had one of its own keys checked. It now validates each shape
    against its own schema (objectui#3312).
  - **The console's worked examples were wrong**, and being stripped rather than
    refused: `view.list.object` (the container root already declares it),
    `job.concurrency` / `job.timeoutMs` (no such keys; the spelling is `timeout`,
    already in ms), `email_template.from` / `.to` (a template is not a send —
    the sender override is `fromOverride`, an object), and
    `datasource.capabilities` / `.healthCheck` (objectstack#4583 removed the
    former; the latter was never a datasource key). These are the drafts an
    author — or a model generating metadata — copies.
  - Action key inventory re-derived: `ActionSchema` gained the package-lock
    envelope (`_lock*` / `_package*` / `_provenance`), so a packaged action no
    longer reports them as unknown keys.
  - The schema-diff panel labels the new `default_mismatch` finding.
  - Test fixtures pinning the retired `managedBy: 'system'` bucket now use
    `engine-owned`. Protocol 17 split that value (objectstack#3355), so it
    resolved to the default-writable fallback and a batch of "stays locked"
    assertions had quietly stopped asserting anything.

### Patch Changes

- 7d0c6de: Settings pages read the declared `{ success, data }` response envelope, so the
  whole Setup → Configuration section works again against a framework#3843 server
  (objectui#3366).

  `service-settings` moved all five `/api/settings` responses into the platform
  envelope and its changelog named the cost for callers that do not go through
  `@objectstack/client`: "Raw `fetch` callers must add one hop: `body.data`." The
  console's settings client is one of those callers and never took the hop, so on
  17.0.0-rc.3 it handed the envelope to the views:

  - every namespace page (localization, company, branding, auth, mail, sms,
    storage, AI, knowledge base, feature flags, data lifecycle) hit
    `Object.entries(payload.values)` on an object with no `values`, threw
    `Cannot convert undefined or null to object`, and went to the error boundary;
  - the "All settings" hub read `manifests` off the envelope, got `undefined`,
    and rendered "no settings are registered" while the server was answering 11
    manifests — a soft failure that reads as a plugin bug;
  - a save's read-back merged nothing, leaving stale values under a success toast;
  - an action's verdict was not where the client looked, so its `message` and
    `severity` were dropped and the toast read the bare HTTP status text.

  ## What changed

  - `jsonOrThrow` unwraps the envelope with the exact predicate
    `ObjectStackClient.unwrapResponse` uses — `success` is a boolean **and**
    `data` is present. Requiring both is what keeps error envelopes
    (`{ success: false, error }`) intact, so `err.payload.error` still feeds the
    locked-key and per-field-rejection rendering from objectstack#4224. A body
    with no boolean `success` is a pre-#3843 server and passes through untouched.
  - The action endpoint reads its verdict from the success envelope's `data`, and
    on the reported-failure arm from `error.details`, where the route deliberately
    parks the whole result so `message` / `severity` / `details` survive the 400.
  - Each endpoint now asserts the shape it promises and throws a named
    `Malformed response from …` error instead of passing a wrong-shaped body on.
    Both symptoms above were an unreadable body travelling onward as if it were
    right; the views already have an error state, and a named error renders there.
  - @object-ui/sdui-parser@17.3.0
  - @object-ui/react-runtime@17.3.0

## 17.2.0

### Minor Changes

- d3584c6: Bring the whole `@objectstack` family to `17.0.0-rc.1`, so the dependency graph resolves a
  single copy of `@objectstack/spec`.

  #3178 bumped **only** `@objectstack/spec` to `17.0.0-rc.1`. The rest of the family —
  `client`, `core`, `formula`, `lint` (and `sdui-parser`, reached through `lint`) — stayed on
  `17.0.0-rc.0`, and each of them depends on spec at an **exact** version rather than a
  caret:

  ```
  @objectstack/client@17.0.0-rc.0  -> spec "17.0.0-rc.0"
  @objectstack/core@17.0.0-rc.0    -> spec "17.0.0-rc.0"
  @objectstack/formula@17.0.0-rc.0 -> spec "17.0.0-rc.0"
  @objectstack/lint@17.0.0-rc.0    -> spec "17.0.0-rc.0"
  ```

  So `main` carried **two** spec copies: objectui's own code read `17.0.0-rc.1` while every
  `@objectstack/*` package read `17.0.0-rc.0` from its own nested `node_modules`. That breaks
  the single-contract invariant this repo's guards are built on, and it breaks them
  _silently_ — the affected checks depend on identity, not on version strings:

  - `spec-subschema-parity.test.ts` distinguishes a genuine re-export from a fork by
    **reference identity** of the zod schema object. Two spec copies make every schema a
    distinct object, so a real re-export starts reading as a fork (or a fork slips through,
    depending on which copy each side resolved).
  - `scripts/check-spec-symbol-derivation.mjs` and `spec-symbol-parity.test.ts` use
    `createRequire` to resolve spec's `.d.ts` and run it through the TS checker. With two
    copies installed, _which_ declaration file the checker sees is a function of resolution
    order rather than of intent.

  The declared ranges were already `^17.0.0-rc.0`, which technically admits rc.1 — the pin
  lived in the lockfile. Raising the remaining ranges to `^17.0.0-rc.1` makes the floor
  explicit and forbids a future install from silently sliding back onto a family member that
  drags rc.0 along with it. The rc.1 family members pin spec at `17.0.0-rc.1` exactly, so the
  graph now converges on one copy by construction, not by luck.

  No product behaviour changes here. `check:spec-symbols` reconciliation was already
  completed by #3178 and stays green under the unified graph; this changeset is `minor`
  per the repo's fixed-group version policy.

### Patch Changes

- 1ce750b: The binding-reach probe was under-reporting its own coverage by six object blocks, silently (#3149).

  `public-block-binding-reach.test.tsx` selects what to probe by filtering `getPublicConfigs()`
  for a declared `objectName` input. The console registers most object blocks with
  `registerLazy`, and a pending stub carries no `inputs` — `Registry.getMeta` says in as many
  words that a consumer must read that as _"not yet known"_, not as _"declares no props"_. The
  filter read it as the latter, so `object-chart`, `object-kanban`, `object-calendar`,
  `object-gantt`, `object-timeline` and `object-map` — six Tier-A blocks, every one declaring
  `objectName` as **required** — dropped out of the candidate set while the suite reported eight
  green probes and no gap.

  That is objectui#2953's shape (a lazy registration falling out of the contract) recurring in a
  consumer, and objectstack#4472's shape recurring inside the suite written to answer it: a gate
  whose stated scope was wider than its reach. The coverage guard could not see it — `length > 0`
  and `toContain('object-form')` both stayed true at 8 of 14.

  - Pending public lazy loaders are resolved through the registry's own `loadLazy` before
    candidates are selected — driven off the recorded loaders, not a hand-written list of plugin
    imports that would drift out of step with `register-plugins.ts` and reintroduce the same
    shrinkage by another route.
  - The guard is now an **exact** candidate list, the lesson `public-contract.test.ts` already
    carries: the failure mode is a set getting smaller, and only an exact comparison makes both
    directions a deliberate edit. Verified by simulating the regression — with resolution
    disabled the assertion fails naming the missing blocks.

  All six were already wired correctly (`ObjectChart` reads the context itself; gantt/timeline/map
  and kanban/calendar have context→prop wrappers), so this found no new defect of the #3144 kind.
  It found two more probe artifacts, which is the same lesson a third and fourth time — a
  plausible value for every input is not a plausible _configuration_:

  - **`data` supersedes the binding.** `ObjectChart`'s fetch is guarded by
    `if ((schema.objectName || schema.dataset) && !boundData && !schema.data)`, and the spec
    glosses `data` as static data to chart _instead of_ binding via `objectName`. Filling it and
    then reporting "objectName never reached" would have been the probe manufacturing its own
    finding. Binding-superseding inputs are now excluded, narrowly and with the guard quoted.
  - **Teardown is not the subject.** `object-map` mounts maplibre-gl, whose `map.remove()` throws
    in jsdom for want of a WebGL context. Unmount is caught so the assertion speaks to data reach;
    an error thrown during _render_ still propagates.

  Coverage after this: 14 of 14 object-bound public blocks. The rest of #3149 — bindings other
  than `objectName`, the `record:*` family under a record context, and the display primitives —
  is untouched and still open.

- f6e8d78: Lookup search inside a create/edit modal is typeable again (objectui#3183).

  In every production console build, the search input of a lookup field's
  quick-select popover — and the nested Record Picker dialog — could not take
  focus while the form modal was open: every click/focus was synchronously
  yanked back to the field trigger, so a lookup could not be searched while
  creating a record.

  Root cause is a race in stock `@radix-ui/react-focus-scope@1.1.16`: the
  focus-scopes stack effect's cleanup schedules `focusScopesStack.remove(scope)`
  in a `setTimeout(0)`. When the effect re-runs for a still-mounted scope (a
  `container` ref flicker), the re-run re-`add`s the scope and the stale timeout
  then evicts it — the dialog's trap listeners stay active but its scope is no
  longer in the stack, so an opening popover pauses nothing and the trap yanks
  focus out of the popover forever.

  Fixed via `patches/@radix-ui__react-focus-scope.patch`: an effect re-run for a
  live scope cancels the pending eviction; a real unmount still runs the full
  delayed cleanup (autofocus-on-unmount + stack removal). Regression-tested in
  `packages/components` with a deterministic reproduction of the race.

- ea96284: The `record:*` family now has behavioural evidence — until now "it works under a record page" was an assumption (#3149 layer 3a).

  `public-block-binding-reach.test.tsx` (objectstack#4472) asks whether a declared `objectName`
  reaches the data layer when a block is mounted bare. Every `record:*` block is outside that
  question by construction: they take their subject from `<RecordContextProvider>`, so mounted
  bare they correctly do nothing, and "made no data call" says nothing about whether they work.

  That gap is the exact place objectstack#4413 lived — `record:details` / `record:highlights` /
  `record:path` / `record:related_list` published props no renderer read, four blocks rendered
  blank on a real record page, and every gate stayed green. The framework check compares two
  declarations; the binding-reach probe cannot see this family at all.

  `apps/console/src/__tests__/record-block-record-reach.test.tsx` mounts all **11** public
  `record:*` blocks under a record context twice, with two different records of the same object,
  and asks whether anything changes — in the DOM or in the data calls. Behavioural coverage across
  the two probes goes 14 → **24** of the 57 curated blocks (`record:related_list` is in both:
  binding-reach ledgers it as unable to fetch without a parent, and this probe is what finally
  shows it fetching once one is bound — turning that ledger entry's stated reason from a claim
  into a checked one).

  - **A differential, not "renders non-empty".** #3149 records the decision _not_ to cover the
    display primitives precisely because "renders something" is also true of a block that ignores
    every input it declares. Adding a gate that reports green without checking anything is what
    objectstack#4472 exists to eliminate. A block rendering the same fixed shell for two different
    records scores zero.
  - **Two records, not bound-vs-unbound.** An unbound control differs in tree shape, so `useId`
    values shift and everything "differs" for reasons unrelated to the record.
  - **The instrument is checked, not trusted.** Each block also renders record A a _second_ time;
    that mount must be byte-identical to the first. If it ever isn't, "A differs from B" stops
    meaning "the record reached the output", and the file says so instead of staying green.
  - **A crash fails as a crash.** SchemaRenderer paints an error card on a throw, and a crashed
    block renders the _same_ card for both records — which would land in the "no difference"
    bucket and read as a finding about its binding. Asserted separately.
  - **Hermetic.** Blocks in this family call bare `fetch` (`/api/v1/security/explain`); under
    happy-dom that resolves to `localhost:3000`, so the probe used to "work" only because the
    connection was refused — 24 ECONNREFUSED lines per run, and different behaviour for anyone
    with a dev server on that port. `fetch` now rejects immediately and its URL joins the same
    call log, so a block binding through bare fetch is credited rather than reported unbound.

  Eight blocks respond to the bound record. Three are ledgered with the reason and the host path
  NAMED, because "host-fed" is only a reason while a host actually feeds it:
  `record:discussion` (DiscussionContext, mounted by RecordDetailView) and `record:reference_rail`
  (`entries` injected by `buildDefaultPageSchema`) check out — **`record:activity` does not**, and
  that is #3165: it renders `items={[]}` hard-coded, nothing supplies items on any path, and its
  eleven declared inputs are filters over a feed that is always empty. Ledgered rather than fixed
  here because the fix is a feature, not the missing-bridge one-liner #3144 turned out to be; the
  ledger's both-directions assertion forces the entry out the day it starts working.

  **#3149 layer 2 lands with it, in the only form the codebase offers.** The slice the issue
  proposed — `recordId` on `object-form` / `object-master-detail-form` / `embeddable-form` — does
  not exist: no public block declares a `recordId` input at all (the only `recordId`/`resourceId`
  inputs in the repo are on `view:detail` and `detail-view`, neither of them public). Same result
  objectstack#4472's direction (d) hit — a slice proposed from the declarations, unavailable once
  you look at what is actually declared. What is available is stronger: `record:related_list` and
  `record:line_items` both bind a **required** `relationshipField` + `childObject` that must land
  in the child query, checkable only under a record context. Both do, scoped to the bound parent.
  The "same mechanism, different assertion" hypothesis #3149 wanted tested before anyone widens
  the sweep holds, and it cost one assertion on mounts that were already happening.

- Updated dependencies [4a51e77]
- Updated dependencies [cc70b8f]
  - @object-ui/sdui-parser@17.2.0
  - @object-ui/react-runtime@17.2.0

## 17.1.0

### Patch Changes

- 752e18f: fix(console,app-shell): readable reassign hand-off + "System" label for svc:\* audit actors — objectstack#4365 / objectstack#4366

  - **Approvals inbox** (`ApprovalsInboxPage`): a reassign timeline entry now
    renders "from A to B" from the structured
    `reassign_from`/`reassign_to` fields (and their server-resolved
    `*_name` companions) that objectstack#4365 added to
    `sys_approval_action`, instead of relying on the old default comment that
    baked two raw user ids into user-facing text. Legacy rows without the
    structured fields keep the comment fallback. New i18n key
    `approvalsInbox.reassignFromTo` across all ten locales.
  - **Record history** (`RecordDetailView`): an audit row attributed to a
    service principal (`svc:*` on the `actor` column — e.g. a
    `runAs:'system'` flow's `svc:flow:<name>` label from objectstack#4366) now
    renders the localized "System" label instead of the raw principal string;
    the raw value stays on the entry for tooling.

- 746dd00: feat(sdui): curate the page:\*, element:\* and action:\* families into the public contract

  The AI-authoring vocabulary and the Studio page designer disagreed by thirteen
  blocks: `PUBLIC_BLOCKS` carried one `page:` tag and one `element:` tag while
  the designer palette — and @objectstack/spec's page schema — offered the whole
  families. A block a human can drag in Studio was invisible to a model writing
  the same page, which is the objectui#3006 state at 10× the scale.

  Fifteen tags join the contract (36 → 42 → **57**), every one shipping a
  renderer with declared inputs (objectui#3065):

  - `page:` — tabs, card, accordion, section, footer, sidebar
  - `element:` — text, number, button, definition-list, repeater
  - `action:` — button, group, menu, icon

  Five stay out, each with its reason recorded and guarded: `action:bar`
  (`record:quick_actions` covers the record action strip; the spec blesses the
  other four), `element:image` (duplicates the curated `image` — one spelling
  per concept), and `element:record_picker` / `element:text_input` /
  `element:metadata_viewer` (mirroring the Studio palette's own exclusions, so
  the two vocabularies stay out for the same reasons rather than by
  coincidence).

  The console's reverse-coverage guard now sweeps all four semantic namespaces
  instead of `record:` alone — checking only the namespace you just fixed is
  exactly how the last 22 doubled keys went unnoticed (objectui#3037). A new
  prop-less allowlist (`element:divider`, `page:section`, `page:footer`,
  `page:sidebar`) keeps "declares no inputs" a pinned decision in both
  directions: those four must stay at zero, everything else curated must declare
  a surface.

- 49e5671: fix(console): `LocalizationFetchProvider` retries a transient `/me/localization` failure instead of degrading for the whole session

  `/auth/me/localization` is served by the environment kernel that owns the session
  on a multi-tenant host, and a cold one answers `503` + `Retry-After` while it
  warms (objectstack#4159). A transient failure is therefore a normal part of a
  cold start — not an exception.

  The provider made ONE attempt and `.catch()`-ed into silence. So a single 503
  during warm-up left currency and locale unset for the **whole session**, silently
  and permanently, long after the kernel was ready. Every money field rendered a
  plain number and nothing ever tried again.

  It now re-attempts a transient failure (`408`, `425`, `429`, `502`, `503`, `504`,
  or a thrown fetch), server-stated `Retry-After` first, exponential backoff
  otherwise. `401` / `403` / `404` / `500` are real answers about the caller and
  still fail on the first attempt.

  **It keeps its posture.** This provider is cosmetic, so it renders children
  throughout — including mid-retry — and fills the value in if and when an attempt
  succeeds. That is the opposite of `MePermissionsProvider`, which is fail-closed
  and holds its loading state across the waits. Both are pinned by tests.

  The retry PRIMITIVES ("is this transient", "how long to wait", `Retry-After`
  parsing) move from `@object-ui/permissions`'s internal module to
  `@object-ui/types` — the lowest package both callers can reach — and
  `PermissionsFetchError` becomes the generic `HttpFetchError`. One definition of
  transient, two policies, rather than a second copy free to drift from the first.
  No behaviour change for `MePermissionsProvider`.

- 2307b52: fix(permissions,console): `MePermissionsProvider` retries a transient `/me/permissions` failure instead of stranding the app on its loading state

  "Not now" is a real answer from this endpoint. On a multi-tenant host it is served
  by the environment kernel that owns the session, and a COLD one answers `503` +
  `Retry-After` while it warms (objectstack#4159 / cloud#927). The provider treated
  that like any other failure: it set `error` — and a consumer that passes no
  `errorFallback` renders `loadingFallback` for the error state too. The console
  does exactly that (`loadingFallback={<LoadingScreen />}`, no `errorFallback`), so
  the app sat on its spinner indefinitely, with a `retry` nobody could reach.

  The fetch now re-attempts a **transient** failure — `408`, `425`, `429`, `502`,
  `503`, `504`, or a thrown fetch (offline / DNS / aborted), which never got an
  answer at all. A server-stated `Retry-After` wins over the exponential backoff
  (both wire forms are read, and clamped to 30s so a hostile value cannot park the
  UI); otherwise the delay doubles from `retryBaseDelayMs`. `loading` stays true
  across the waits, so the fail-closed loading state holds and consumers never see
  a permissive flash mid-recovery.

  Unchanged for a real answer about the caller: `401`, `403`, `404` and `500` fail
  on the first attempt exactly as before. `500` is deliberately not retried — a
  genuine server fault neither benefits from hammering nor should be hidden behind
  a spinner.

  **New props**, both optional and defaulted so no call site needs to change:

  - `maxRetries` (default `3`) — `0` restores the previous single-attempt
    behaviour.
  - `retryBaseDelayMs` (default `500`) — base for the exponential backoff.

  Also fixes a latent race the retries made much wider: the in-flight fetch is now
  cancelled when the effect tears down, so a slow answer for a previous `endpoint`
  or `fetcher` can no longer overwrite a fast answer for the current one. The retry
  primitives (`parseRetryAfterMs`, `backoffMs`, `isTransientFailure`,
  `TRANSIENT_STATUS`, `PermissionsFetchError`) live in a new internal `./retry`
  module — not exported from the package root.

  **The console now passes an `errorFallback`.** Retrying narrows the window but
  cannot close it — a kernel build slower than the retry budget still lands in the
  error state, and rendering `loadingFallback` there is what produced the eternal
  spinner. It now renders `<LoadingScreen error={...} onRetry={retry} />`, using the
  error + retry affordance that component has carried all along, so a user is never
  left with a spinner and no way forward.

- 9a04d25: fix(registry): prefix every namespaced key exactly once, in every namespace

  objectui#3023 fixed eleven `record:*` blocks registered as
  `register('record:x', …, { namespace: 'record' })` — an already-prefixed name
  handed to a registry that prefixes it again, landing the block at
  `record:record:x` — and guarded that namespace alone. Twenty-two more were
  sitting in `action:` (5), `element:` (10) and `page:` (7), two of them
  (`page:header`, `element:divider`) curated public blocks.

  Checking one namespace is exactly what let them keep sitting there, so the
  guard now asks the whole registry rather than a prefix of it.

  Same fix as before: register the bare name and let `namespace` do the
  prefixing, with `skipFallback: true` so the fallback does not claim that bare
  name globally. It would otherwise take over `header`, `footer`, `sidebar`,
  `tabs`, `card`, `accordion`, `section`, `text`, `image`, `button`, `icon` —
  every one of which belongs to `ui:`. All 22 stay reachable exactly as
  `<namespace>:<name>`; the registry goes 522 keys to 500, and the contract is
  unchanged at 42/42.

  Found while probing why six curated Tier B primitives report no `inputs`. They
  do declare them — `vitest.setup.dom.tsx` registers simplified `text` / `image` /
  `html` / `grid` stubs that shadow the real registrations inside the test
  environment only. That shadowing is a separate question, left alone here; the
  doubled keys it turned up are not test-environment artifacts.

- 32462dd: feat(sdui): guard the public contract against silent drift — coverage test + manifest lazy-stub assertion

  Follow-up to objectui#2953. That bug — every lazily-registered public block
  missing from the contract, and so from every `kind:'react'` page's scope —
  survived because nothing compared `PUBLIC_BLOCKS` against what an app actually
  registers. Type-check, lint, build and the whole suite stayed green while seven
  curated blocks were unusable. Two guards close that class.

  **Console ↔ contract coverage.** `apps/console/src/register-plugins.ts` extracts
  the plugin registration out of `main.tsx` so it can be imported without booting
  the app. A new `apps/console/src/__tests__/public-contract.test.ts` reads that
  real list and pins, as exact lists, which curated tags the console exposes (35),
  which are still unimplemented (`line_items`), and which reach the contract
  through a pending lazy stub. Exact lists rather than `toContain`, because the
  failure mode is a _shrinking_ contract. Reverting the #2953 fix drops coverage
  from 35 to 28 and fails all four assertions.

  **Manifests must be generated from loaded registrations.** New exported
  `assertFullyLoaded(configs)` in `@object-ui/sdui-parser`, plus `lazy?: boolean`
  on `RegistryConfigLike`. A lazy stub carries metadata but no `inputs`, so it
  would be written into `sdui.manifest.json` as a block that takes no props —
  making every prop an author passes it an `unknown-prop` diagnostic in the save
  gate. Both generators now assert instead: `gen-manifest.ts` throws, and
  `dev/manifest-dump.tsx` also imports the console's real registration list, so a
  plugin the console lazy-registers but the dump forgets to import eagerly is
  caught rather than silently emitted propless. `scripts/dump-public-manifest.mjs`
  surfaces that failure instead of timing out for 120s with no message.

  Also documents `object-chart` as a seventh block affected by objectui#2953 —
  the issue listed six.

- 390c071: feat(record): declare inputs for the seven configurable record:\* blocks, and curate six

  Seven `record:*` blocks shipped with renderers that read props but declared no
  `inputs`. That combination is the worst of both: the renderer honours
  `limit`, `severity`, `location` …, while every authoring surface — the designer
  panel, the AI vocabulary, the generated manifest — reports the block takes no
  configuration. objectui#3013 recorded them as deliberately uncurated for
  exactly that reason.

  The declarations mirror what each renderer actually reads:

  | block                                  | inputs                                                                       |
  | -------------------------------------- | ---------------------------------------------------------------------------- |
  | `record:activity`                      | 11 — from `RecordActivityComponentProps`                                     |
  | `record:chatter` / `record:discussion` | 5 — from `RecordChatterComponentProps`                                       |
  | `record:alert`                         | 8 — severity, title, body, visible, icon, action, dismissible, dismissKey    |
  | `record:quick_actions`                 | 7 — actionNames, requiredPermissions, location, align, inline, variant, size |
  | `record:history`                       | 3 — limit, emptyText, unknownUserText                                        |
  | `record:reference_rail`                | 1 — hideEmpty                                                                |

  `inputs` describe what an AUTHOR writes, which is a subset of what the renderer
  reads. `entries`, `loading` and resolved `actions` are injected by the host
  shell off RecordContext; declaring them would invite a model to hand-write the
  data the page is supposed to fetch. `aria` is omitted for the reason it is
  omitted on `record:details` — an accessibility escape hatch, not a layout
  choice. `location` takes its enum from the spec's `ACTION_LOCATIONS` rather
  than restating it, per objectui#3019.

  Six of the seven are now in `PUBLIC_BLOCKS`: configurable and absent from the
  contract is the state objectui#3006 was about. The contract goes 36 → 42 tags,
  all resolving.

  `record:chatter` stays out — it is the same renderer as `record:discussion`
  under a Salesforce-familiar name, kept for schemas already in the wild. Two
  spellings of one block is ambiguity an authoring model cannot resolve, so the
  vocabulary carries the spec's name. A test compares the two input lists, so the
  day they diverge the exclusion stops being justified and fails.

  A companion assertion requires every curated `record:*` tag to declare inputs.
  A curated tag with none reads as "takes no configuration" when the renderer in
  fact reads props — the same gap objectui#3006 opened, pointed the other way.

- d10f526: fix(sdui): the curated contract lists `record:line_items`, the tag that actually resolves

  `PUBLIC_BLOCKS` carried `line_items` — the bare tag. `@object-ui/plugin-form`
  registers the block as `record:line_items` with `skipFallback: true`, which
  exists precisely so the bare name is _not_ claimed, so that key never existed
  and the curated entry could never resolve. Its four siblings in the list are all
  `record:`-prefixed, and plugin-form's own comment says "Register
  record:line_items"; the bare spelling was a slip.

  The effect was a block that has shipped all along — a full renderer, a label,
  five declared `inputs` — being absent from the public contract, from the JSX
  type surface, from the generated manifest, and from every `kind:'react'` page's
  scope. It read as an unimplemented aspirational entry, which is how it was
  recorded when objectui#2979 added the contract-coverage guard.

  With the tag corrected the contract has no gaps left: all 36 curated tags
  resolve in the console, `record:line_items` among them with its full `inputs`.
  The guard's known-unimplemented list is now empty and stays asserted, so the
  next entry that cannot resolve surfaces instead of being explained away.

- 2baa13f: fix(record): register the record:\* blocks under one key, prefixed once

  Eleven blocks in plugin-detail were registered as
  `register('record:x', …, { namespace: 'record' })` — an already-prefixed name
  handed to a registry that prefixes it again. Each landed at
  `record:record:x`, and the key authors actually resolved, `record:x`, was the
  un-namespaced _fallback_ rather than the intended registration. The registry
  carried 23 keys for 12 components.

  Nothing failed, which is why it survived: `getPublicConfigs()` rewrites `type`
  to the curated tag, so the doubled name never reached the contract, the
  manifest, or the JSX surface. It was visible only when enumerating the registry
  directly — which is what objectui#3013's reverse check does.

  Registering the bare name is what makes `namespace` correct, and
  `skipFallback: true` is what keeps the fallback from claiming that bare name
  globally. Without it these would take over `details`, `path`, `history`,
  `alert` … as top-level tags; `alert` is the live case, owned by `ui:`. Every
  block stays reachable exactly as `record:<name>`, and 23 keys become 12.

  `record:line_items` needed no change — it was the one already registered this
  way, which is what made objectui#3006's near-miss possible in the first place.

  Two console assertions hold the shape: no key carries a doubled prefix, and no
  `record:*` block owns the bare spelling of its own name.

- 9cdc992: test(sdui): check the contract in the direction that would have caught #3006

  The console contract guard only looked one way: every tag in `PUBLIC_BLOCKS`
  must resolve. That direction cannot tell "not built yet" from "built, but the
  contract spells it wrong" — so `record:line_items` was filed as a known gap for
  a release while its renderer shipped, fully configured, in plugin-form.

  Two checks close the other direction:

  - **Every shipped `record:*` block is curated, or listed with a reason.** Seven
    are deliberately out, each declaring zero `inputs` — nothing for an author or
    a model to configure. A new `record:*` registration now fails until someone
    decides which side it belongs on, so the vocabulary cannot quietly drift from
    what the platform can render. A companion assertion pins those seven at zero
    inputs, so one growing a configurable surface re-opens the decision instead of
    inheriting the exclusion.

  - **A curated tag that near-misses a registered block.** `line_items` vs
    `record:line_items` differ only by namespace; one of the two spellings is
    always a typo. The check reports the candidate ("also try
    `record:line_items`") rather than just "not covered".

  Both were verified against the real bug: reverting the tag to `line_items`
  fails them with exactly that diagnosis.

  Grouping the registry by canonical `type` surfaced a second, latent issue —
  eleven `record:*` blocks in plugin-detail are registered as
  `register('record:x', …, { namespace: 'record' })`, prefixing an already-
  prefixed name and yielding doubled `record:record:x` keys. It does not reach
  the contract (`getPublicConfigs()` rewrites `type` to the curated tag), so this
  changeset only documents it where the grouping happens; the registrations are
  left for a separate change.

- 0fcd4a9: fix(settings): read the locked key from `error.details`, tolerating both wire shapes — objectstack#4224

  `SettingsView.onSave` rendered the `SETTINGS_LOCKED` toast from
  `err.payload.error.key`. That key was a SIBLING of `code`/`message` inside
  `error`, a position `ApiErrorSchema` never declared — it reached the console only
  because the schema is a plain `z.object` and silently strips what it does not
  declare, so nothing ever failed to flag it. objectstack#4224 moves it into
  `error.details`, the slot the contract does declare.

  This is the console's half, and it ships **first**: the read is now
  `error.details?.key ?? error.key`, so the toast keeps naming the locked key
  against servers on either side of that change rather than degrading to
  `Locked by environment: undefined` during the window where the two repos are on
  different versions. The fallback can go once the oldest supported server carries
  the fix.

  Also stops interpolating a missing key: when neither position carries one the
  toast now reads `Locked by environment` rather than appending `undefined`.

  This was the only in-console reader of the four keys objectstack#4224 relocated
  (`namespace`, `key`, `reason`, `fields`) — a repo-wide grep for the other three
  finds no consumer.

- eddd4a1: feat(settings): a rejected save marks the fields that caused it — objectstack#4224 follow-up

  A `SETTINGS_VALIDATION` rejection names the offending keys, and the settings page
  threw all of it away. Every failure collapsed into one toast carrying the
  server's summary sentence, with nothing marked on the inputs — so on a namespace
  with a dozen keys the user was told a value was wrong and left to find which.

  **That was not the console's fault, which is the part worth recording.** The
  server sent `fields` as a `Record<key, message>` hung _beside_ `error.code`, a
  position `ApiErrorSchema` never declared — it survived only because the schema
  is a plain `z.object` and strips undeclared keys rather than rejecting them.
  `extractFieldErrors` reads arrays (`details.fields`, `fields`,
  `validationErrors`), so a map at an undeclared position matched nothing and
  returned `null`. objectstack#4224 moved it to `error.details.fields` as the
  declared `FieldError[]`, which is what makes this wiring a few lines rather than
  a parser.

  What changes for a user: the server's message now renders against the input that
  caused it, in the slot the help text occupies, and clears the moment that field
  is edited, on Discard, or on the next successful save. `SettingsField` gained an
  `error` prop; it sets `aria-invalid` and `aria-describedby` on the control and
  gives the message `role="alert"`, so the rejection is announced rather than being
  conveyed by colour alone.

  The toast still fires alongside the per-field marks. The offending field can be
  scrolled out of view or hidden behind a `visible` expression, and a save that
  appears to do nothing is the worse failure.

  Fields the server did not name are left unmarked — a wrong mark on an innocent
  input is worse than the generic toast that was already there — and a failure
  carrying no field array (a 500, an unknown namespace) behaves exactly as before.

- 96ee72e: **The shared-record page's redaction notice never rendered on the enveloped path.**

  `GET /api/v1/share-links/:token/resolve` has two producers — the framework's
  sharing plugin and the runtime dispatcher's `/share-links` domain, which is the
  designed primary surface for cloud's per-environment kernels. `SharedRecordPage`
  read both, but the wire spells the field `redactFields` while the render reads
  `redactedFields`, and only the BARE branch did that rename. The enveloped branch
  handed `body.data` straight through, so on the dispatcher path `redactedFields`
  was always `undefined` and "Some fields are hidden by the owner" never appeared —
  on exactly the pages where fields WERE being stripped. The record itself was
  correctly redacted throughout; what was missing is the visitor being told.

  The fold now lives in one place, `normalizeResolvedShare` in the new
  `pages/shared-record-shape.ts`, with both envelopes covered by tests. Extracting
  it out of the page module is also what lets those tests run without loading the
  chat renderer and the app-shell graph behind it.

  Prompted by objectstack#3983, which moves the plugin surface onto the same
  enveloped shape the dispatcher already used: without this fix that convergence
  would have spread the missing notice from the dispatcher path to every share
  page. No API change — the page reads a superset of what it read before, so it
  still works against a pre-#3983 framework.

- Updated dependencies [32462dd]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
  - @object-ui/sdui-parser@17.1.0
  - @object-ui/react-runtime@17.1.0

## 17.0.0

### Minor Changes

- 6720008: feat(approvals): dynamic decision-output fields + expression approver editing (framework#3447 P2)

  - The approve/reject dialogs now render one input per author-declared decision-output key (the row's `decision_outputs`, per-request so it can't be a static action param). DeclaredActionsBar synthesizes `outputs.<key>` params; the api handler folds them into the nested `outputs` body the decide route expects. Blank optional outputs are omitted.
  - The flow designer's approval-node approver list renders an `expression`-type approver's value as a CEL expression input (mono + syntax check) instead of a dead free-text reference box, with a placeholder teaching the three legal roots (`current.*` / `trigger.*` / `vars.*`). Flow-scope pickers are deliberately not wired in — approval expressions have their own closed root set, and offering flow-scope paths would teach exactly the spelling the runtime rejects.
  - Static fallback descriptor gains the `Expression (CEL)` approver type, the expression-only `resolveAs` column, and the node-level `onEmptyApprovers` policy select (the online form derives all of these from the engine's published configSchema).

- 7f153de: feat(approvals): typed decision-output pickers, quick-path guard, and approval-expression completion (framework#3447 follow-ups, #2829)

  - Decision dialogs render TYPED decision outputs as record pickers: `decision_output_defs` (`{ key, label?, type, multiple? }`) maps `user` to the sys_user people picker and `department`/`position`/`team` to the matching system-object lookup; `multiple` collects an id array. Bare keys keep the text input.
  - Quick decision paths (inline a/r keyboard, hover buttons, mobile card buttons, bulk apply) no longer decide a request whose node declares decision outputs (#2829) — only the drawer dialog collects those fields. Buttons render disabled with an explanation; bulk selection excludes such rows via the existing "N actionable" messaging.
  - The approval `expression` approver input now has a scope-aware data picker and inline root validation: three groups — `current.<field>` (live at node entry), `trigger.<field>` (submit snapshot), `vars.*` (flow variables) — built by `useFlowScope` from the same materials as the condition picker but with the approval root set. `nodeOutputRefs` now models approval nodes (`<nodeId>.decision` + declared `decisionOutputs` keys), so the previous stage's outputs are pickable, and `vars.previous` is always listed so a legitimate `vars.*` reference is never flagged as out of scope.

### Patch Changes

- 7cb199b: feat(approvals): label pending-approver chips with their group (objectui#2807)

  Follow-up to #2762 P1-2. The dedupe pass collapsed repeated "waiting on"
  chips to one with a `×N` count, but couldn't say _which_ group (finance /
  legal / …) each pending approver represented in a 会签 (per_group) request —
  the data wasn't there. With the framework now emitting
  `pending_approver_groups` (`@objectstack/plugin-approvals`), the drawer:

  - keys the chip collapse by **(name, group)** — the same person filling two
    different groups stays two labeled chips (`Dev Admin · finance`,
    `Dev Admin · legal`), while one group filled twice collapses to a single
    chip with a count;
  - renders the group as a muted `· <group>` sub-tag on the chip.

  Degrades cleanly: with no group data (non-`per_group`, or an older backend)
  the key is the name alone, keeping the plain dedupe + `×N` behavior.

- 4b60d2d: fix(console): make the approval timeline attachment chip show its name and open (#2820)

  A decision attachment in the approval inbox timeline (审批动态) rendered a
  nameless "附件" chip that did nothing when clicked. Three separate bugs:

  - **No filename.** The chip resolved its label by fetching `/data/sys_file/{id}`
    — a system object a regular approver cannot read — and silently fell back to a
    generic label when that was denied. The name now comes from the attachment
    descriptor the server returns (framework #3266), so no `sys_file` access is
    needed and the real filename shows for every approver.
  - **Dead click.** `openAttachment` called `window.open` _after_ an `await`, so
    it was no longer a user gesture and the browser blocked the popup. It now opens
    the tab synchronously up front, then points it at the signed URL once fetched.
  - **Wrong origin.** The signed URL from the local storage adapter is
    server-relative; `window.open` resolved it against the console origin. It is
    now resolved against the API origin.
  - Every open failure was swallowed silently. The user now gets a toast on
    failure — new `approvalsInbox.attachmentOpenFailed` string across all 10
    locales.

- 20bd014: fix(approvals): Approval Center density + amount emphasis (#2762 P2)

  - **Column rebalance** — the inbox table gave five auto columns equal width,
    leaving 审批事项 (Request) over-wide next to a cramped 状态 (Status). The
    Record column (the primary content) now gets the widest share, Request a
    moderate one, and Status/Submitted fixed widths so they never crowd.
  - **Lead with the amount** — the drawer summary card now surfaces the
    decision-critical amount as a filled figure at the top of the card instead
    of burying it in the generic field grid (and drops it from that grid so it
    shows once).

  Also verified two P2 items need no change: light mode already works —
  `ConsoleShell` mounts `ThemeProvider defaultTheme="system"` (follows the OS
  `prefers-color-scheme`) with a `ModeToggle`, and the page's own classes carry
  full light/dark variants; and the queue already has a bulk approve/reject
  toolbar for the select-all/per-row selection.

- 3e886eb: fix(i18n): localize FileField upload widget + approvals snapshot field labels

  - `FileField` (the shared upload widget) hard-coded every visible string
    ("Drag & drop files here", "or click to browse", "Take photo", "Uploading…",
    size/upload validation messages, …). They now route through
    `useObjectTranslation` with new `fields.file.*` keys, translated across all
    10 locale bundles. This is why the approvals Approve/Reject dialog's
    attachment dropzone was English in a Chinese console.
  - The approvals inbox record-snapshot summary title-cased raw machine keys
    instead of the target object's field labels. It now consumes the
    server-sent `payload_labels` in `payloadSummary`/`decisionAmountEntry`,
    falling back to the prettified key when absent; `approvalsApi`'s row type
    gains `payload_labels`.

- 072330d: fix(console): let a screen flow be completed from the developer Flow Runs page (framework#3528)

  Developer → Flow Runs triggers a flow and renders the result. For a **screen**
  flow that result is not a result — it is `{ status: 'paused', runId, screen }`,
  and the run sits suspended until something posts to its resume endpoint. The
  panel dumped that envelope as JSON and stopped: no screen, no Submit, no resume
  call. Every test run of a screen flow left an orphaned `paused` row in Recent
  Runs, and there was no way to drive one to completion from this surface.

  - **console** — a paused test run now opens the same `FlowRunner` the record and
    list surfaces use, so the screen renders for real (flat fields, multi-step
    wizards, and `object-form` steps with their master-detail grids) and Submit
    posts to `/automation/:flow/runs/:runId/resume`. Dismissing the runner no
    longer strands the run: the pause is durable, so the panel keeps a "Continue
    run" affordance to reopen the pending screen. `paused` also gets its own
    status badge instead of falling through to the unknown-status style.
  - **app-shell** — `FlowRunner` (and its `ScreenFlowState` / `ScreenSpec` types)
    is now exported from the package so surfaces outside `views/` can mount the
    one screen-flow runner rather than reimplementing it.
  - **app-shell** — `FlowRunner` now wraps the screen body in its own `<Suspense>`
    boundary. An `object-form` step mounts `ObjectForm`, whose field widgets are
    lazy; that suspension used to unwind to the _host's_ nearest boundary, and on
    a surface whose nearest boundary is the route-level one, React swapped the
    whole page for the fallback and remounted it — destroying the host's state
    along with this dialog. The screen vanished before it could be filled in and
    the run stayed paused with no resume call, which is exactly the "Submit does
    nothing" shape. Reproduced on the Flow Runs page and fixed at the source, so
    every host that mounts the runner is covered.
  - **app-shell** — a screen payload without `fields` no longer throws. `fields`
    is optional on the wire (a message-only screen, or an `object-form` step from
    a node executor that omits it), but `FlowRunner`/`ScreenView` read it
    unguarded and blew up as the dialog mounted. Reads now go through a
    `screenFields()` helper; the design-time builder keeps its exhaustive shape.

- b076050: fix(console,runner): the approvals inbox renders against one ticking clock, and both packages now run ESLint

  `apps/console` and `packages/runner` had no `lint` script, so `turbo run lint`
  skipped them silently and their 17 ESLint **errors** had never been seen
  (#2923 declared them as DEBT; this closes the gap). Both now carry
  `"lint": "eslint ."` and the `DEBT` list in `scripts/check-lint-coverage.mjs`
  is empty — every workspace package is linted.

  What the errors actually were, once read one by one:

  - **8x `react-hooks/purity` — real, and user-visible.** The approvals inbox
    read `Date.now()` mid-render for every age tint, "5m ago" label and SLA chip.
    Render must be pure: the output depended on when React happened to render, so
    it disagreed with itself under StrictMode's double render and then **froze** —
    an inbox left open kept saying "just now" and an SLA countdown never counted
    down. The page now renders against a single `now` held in state and advanced
    once a minute (the finest granularity anything here displays), so render is a
    pure function of props+state _and_ the figures actually tick.
  - Alongside that, `sla_due_at` is now parsed through a guard. A due date the
    backend sends in a shape `Date.parse` can't read used to render as
    "SLA NaNh left"; it now renders nothing.
  - **1x `react-hooks/static-components` — real.** `StatusBadge` was declared
    inside `ApprovalsInboxPage`, making it a brand-new component type on every
    render, so React unmounted and remounted every status chip in the table each
    time the page re-rendered. Hoisted to module scope, with the translated label
    passed as a prop.
  - **6x `react-hooks/static-components` — false positives** (3 in the console's
    settings pages, 3 in the runner's `LayoutRenderer`). All six render the result
    of `getIcon`/`getLazyIcon`, which memoises per name in a module-level cache —
    the component reference is stable across renders and nothing is created during
    render. The rule cannot see through the call, so these carry the same targeted
    `eslint-disable-next-line` + justification the repo already uses at a dozen
    icon-registry sites, and the resolvers themselves now say so in a comment.
    (Verified rather than assumed: typing into a settings field keeps focus and
    every character, so no state was ever being reset there.)
  - **2 minor.** A dead `token` initializer on the console's auth preflight path
    (`no-useless-assignment` — read, not blind-deleted: no intended write was
    missing, every path out of the try/catch either assigns or returns), and a
    `prefer-const` in the SDUI workbench preview.

- 9b4b952: fix(i18n): make `en` the complete source of truth for grid import and set-password (objectui#2872 b/c)

  The `en` and `zh` packs had drifted in both directions, silently, because
  `fallbackLng: 'en'` degrades a missing key into English rather than an error and
  the missing-key handler only fires in dev.

  - **74 keys existed only in `zh`.** `grid.import.*` and `auth.setPassword.*` had
    never been added to `en`, so no other locale could translate them: the English
    text came from call-site `defaultValue:` args and a private map inside
    `ImportWizard`. They now live in `en`, which is what translators and
    `os i18n extract` read.
  - **4 `en` keys were missing from `zh`** (`console.commandPalette.title`,
    two `console.ai.suggestions.metadataAssistant.*`, `help.keyboardShortcuts`),
    so Chinese users saw English.

  `grid.import` in particular had three disagreeing sources — the `en` pack (62
  keys), `zh` (130) and `ImportWizard`'s own fallback map (133), union 134, no two
  the same set. All three are now aligned on 134.

  The wizard's fallback map is kept, not deleted: it is what lets the wizard render
  with no `I18nProvider` mounted (standalone embedding, unit tests). It is instead
  pinned to the `en` pack by a new test, so the two can no longer drift.

  `SetPasswordPage` drops its now-redundant inline `defaultValue:` args; the text
  is byte-identical, it just comes from the pack now.

  Adds two guards, both mutation-verified:

  - `en` ↔ `zh` full key parity, asserted in both directions. The other eight
    packs are still ~357 keys behind and are tracked separately (objectui#2872
    part a), so they are deliberately not asserted yet.
  - `IMPORT_DEFAULT_TRANSLATIONS` ↔ `en.grid.import`, same keys and same text.

- 5b9cf96: fix(plugin-map): drop the `maplibre-gl@6` default import, and put type-check behind a CI gate that cannot be silently skipped (#2911)

  `maplibre-gl@6.0.0` removed its default export (arrived via #2848, dependabot),
  so `ObjectMap.tsx`'s `import maplibregl from 'maplibre-gl'` has been a TS1192
  error on `main` for a day. The binding was never used — the map instance comes
  from `react-map-gl/maplibre`, and the stylesheet from the side-effect import on
  the next line — so the import is simply deleted rather than rewritten to
  `import * as`.

  Removing it is runtime-neutral, which the issue had explicitly left unverified.
  `@vis.gl/react-maplibre` (what `react-map-gl/maplibre` re-exports) does
  `Promise.resolve(mapLib || import('maplibre-gl'))` in `components/map.js`, so it
  loads the library itself when no `mapLib` prop is passed. Verified in a browser
  against the `store-locator-map` catalog schema: `maplibre-gl` is fetched as its
  own lazy chunk, the WebGL canvas comes up 800x600, and all three markers mount —
  byte-identical probe output with and without the static import. That also matches
  what `apps/console/src/main.tsx` already intends, where the plugin is registered
  lazily specifically to keep `maplibre-gl` out of the initial bundle.

  **The reason it survived a day of green CI is the part worth fixing.** No
  workflow ran `type-check` at all, and `turbo build` only checks types for
  packages whose `build` script happens to invoke `tsc` — the 22 `vite build`
  packages transpile without checking. A sweep of all 45 packages found ten with
  broken types, `plugin-map` merely being the one that had a script to notice it.

  Adding a `pnpm type-check` job alone would not have been a gate: **turbo silently
  skips any package with no `type-check` script**, so 17 packages read as passing
  because nothing ran. With `plugin-map` fixed, `pnpm type-check` reports 63/63
  green while nine packages are still broken. So:

  - `plugin-ai` and `plugin-report` gain the `paths` override their type-checked
    peers already carry, which detaches workspace deps from sibling _source_ and
    resolves them through built `.d.ts` — the sole cause of the 104-error TS6059
    `rootDir` floods, and the same trick their own `vite.config.ts` already applies
    to the dts program.
  - Seven packages gain `"type-check": "tsc --noEmit"` (`plugin-ai`,
    `plugin-report`, `plugin-dashboard`, `create-plugin`, `console`, and the two
    console examples). Coverage goes 28 -> 35 of 45.
  - New `scripts/check-type-check-coverage.mjs` makes the invisibility impossible:
    a package with no `type-check` script must be declared, with a reason, and the
    lists only shrink — gaining a script without deleting the entry fails the
    guard. The nine known-broken packages are recorded there with error counts
    (`@object-ui/runner` has no `tsconfig.json` at all), tracked as follow-ups.
  - New `Type Check` CI job runs the coverage guard first (instant, no install),
    then `pnpm type-check`.

  Both halves were proven to fail before being trusted: the guard was exercised in
  all four of its failure modes, and re-introducing the `maplibre-gl` import turns
  the job red again, as does a fresh error injected into `plugin-ai` — a package
  that had no type checking whatsoever before this change.

  - @object-ui/react-runtime@17.0.0
  - @object-ui/sdui-parser@17.0.0

## 16.1.0

### Patch Changes

- 8b8b744: chore(deps): align `@objectstack/formula` / `lint` / `client` to `^15.1.1`

  These three were still pinned to `^14.6.0` while `@objectstack/spec` was already
  `^15.1.1` — a version skew from the v15 upgrade (formula/lint/client publish in
  lockstep with spec, and their own 15.0.0 entries are pure dependency bumps, so
  this is alignment, not a behavioral migration).

  Practical effect: the client-side field-rule evaluation
  (`visibleWhen`/`readonlyWhen`/`requiredWhen` via `fieldRules.ts`, which delegates
  to `@objectstack/formula`'s `ExpressionEngine`) now tracks the 15.x engine — and
  will pick up the framework's `dateField == today()` equality fix
  (objectstack-ai/objectstack#3205) automatically at the next 15.x release via the
  caret range. Renderer/action `visible`/`disabled` predicates are unaffected (they
  use the home-grown JS evaluator — tracked separately in #2661).

- 7cf4051: chore(deps): align every `@objectstack/*` dependency to `^16.0.0-rc.0`

  Bumps `@objectstack/spec` / `client` / `formula` / `lint` from `^15.1.1` to the
  `16.0.0-rc.0` pre-release across the workspace (root + `apps/console` +
  `apps/site` + all consuming packages). ObjectUI's own packages are already on
  major 16, so this closes the 15↔16 skew between ObjectUI and the `@objectstack`
  contract libraries (which publish in lockstep with `spec`).

  This is a dependency alignment, not a behavioral migration: the full workspace
  build (43/43) and the `@objectstack`-consuming package test suites
  (`core` / `app-shell` / `data-objectstack` / `plugin-form` / `types`) are green
  against `16.0.0-rc.0` with no source changes required.

  Practical effect: `@objectstack/client@16.0.0-rc.0` now ships
  `data.batchTransaction` (framework #3271), so `ObjectStackAdapter`'s feature
  detect (`typeof client.data.batchTransaction === 'function'`) routes
  master-detail cross-object saves through the typed SDK method instead of the
  raw `fetch('/api/v1/batch')` fallback — realizing the "verify SDK path" half of
  #2694. The raw-fetch branch stays as a defensive fallback (removal tracked in
  #2694).

- 6b114a1: fix(approvals-inbox): align participant gating with the server-computed `viewer` block

  Consume framework#3310's per-viewer capability: `ApprovalRequestRow` gains an
  optional `viewer: { can_act, is_submitter }`, and the approvals inbox's
  participant checks (the reply box + the "why disabled" hint) prefer it over the
  client-side identity heuristic when present. This keeps the hint from ever
  contradicting the declared decision buttons — whose `visible` CEL now gates on
  `record.viewer.*` — and correctly recognizes position/team-addressed approvers
  that the client heuristic couldn't resolve. The heuristic remains as a fallback
  for a backend that predates `viewer`.

  - @object-ui/react-runtime@16.1.0
  - @object-ui/sdui-parser@16.1.0

## 16.0.0

### Patch Changes

- ca0f5f0: Login page surfaces the dev-seeded admin credentials. The framework runtime seeds `admin@objectos.ai` on an empty development database, but nothing on the login page said so — new users clicked "Sign up" and landed in an empty non-admin workspace (15.1 third-party eval). When `GET /api/v1/auth/config` reports `devSeedAdmin` (dev-only; the server omits the field in production and once the default password is changed), the page renders a dismissible amber banner with the credentials. Dismissal persists per browser via localStorage.
  - @object-ui/react-runtime@16.0.0
  - @object-ui/sdui-parser@16.0.0

## 15.0.0

### Major Changes

- a46ce5e: align with objectstack

### Patch Changes

- @object-ui/react-runtime@15.0.0
- @object-ui/sdui-parser@15.0.0

## 14.1.0

### Patch Changes

- 6b2d74e: fix(auth): gate the device-approval page on `features.deviceAuthorization` (framework#2874 / #2513)

  `DeviceAuthPage` hit the RFC 8628 `/device*` endpoints unconditionally, even
  though the better-auth `deviceAuthorization` plugin is opt-in (off by default) —
  so on a deployment without it the page rendered an approve form that only failed
  on submit. It now reads `features.deviceAuthorization` from the public auth
  config and shows a plain "not enabled" notice when the capability is off,
  matching the "form follows plugin" honesty guard the framework side introduced
  in #2874. `AuthPublicConfig.features` gains the `deviceAuthorization` flag
  (previously absent from the client type). A config-fetch error fails open so a
  transient blip never hides a legitimately-enabled page.

- 2b30583: fix(permissions): close the console FLS fail-open for token-only sessions (framework#2926 ④). Two halves: `MePermissionsProvider` gains a `fetcher` prop and the console passes `createAuthenticatedFetch()` so `/me/permissions` carries the Bearer token like every other data call (the cookie-only default fetch resolved token-only sessions as anonymous); and the unknown-object default is now authentication-gated — authenticated sessions fail CLOSED when an object has no resolved perms (fields render read-only instead of inviting input the data layer strips), while anonymous sessions keep the permissive default so guest/public forms keep working. Pairing note: with an older framework whose `/me/permissions` returns sparse objects for authenticated users, unconfigured objects now render read-only.
  - @object-ui/react-runtime@14.1.0
  - @object-ui/sdui-parser@14.1.0

## 14.0.0

### Major Changes

- 2f3ab55: align with objectstack

### Patch Changes

- 94d00d4: feat(auth): phone number + password sign-in on the login page

  The login page's password mode now accepts an **email OR a phone number** as the
  identifier and routes by shape — email → `/sign-in/email`, phone →
  `/sign-in/phone-number` (better-auth phoneNumber plugin, framework#2780). It
  coexists with the existing phone-OTP mode.

  - Gated on `features.phoneNumber` (phoneNumber plugin enabled). Unlike phone-OTP
    it needs no SMS service, so it uses that coarser capability flag, not
    `features.phoneNumberOtp`. When the flag is off the field stays email-only.
  - New `AuthClient.signInWithPhonePassword(phoneNumber, password)` wired through
    `AuthContext` / `AuthProvider` / `useAuth`.
  - New `normalizePhoneIdentifier` / `looksLikePhoneIdentifier` helpers that mirror
    the backend's `normalizePhoneNumber` exactly (strip `[\s\-().]`, validate
    `^\+?[0-9]{6,15}$`, **no** forced E.164 / country code — the backend stores the
    light-stripped form, so anything heavier would break the lookup).
  - SSO stays email-only (a phone-shaped identifier no longer attempts domain
    routing).

  Only works for accounts that have both a phone number and a password set;
  phone-only accounts set a password on first OTP sign-in.

- 5971cc4: i18n: translate the Profile page, honor inline i18n label objects under bare
  base-language codes, and localize managed-by badges / record quick actions.

  - `pickLocalized` now upgrades a bare base language (`zh`) to any
    region-qualified key sharing the base (`zh-CN`) — runtime language is
    normalized to the base code while metadata authors write full BCP-47 tags,
    so inline `{ en, 'zh-CN', ... }` label objects previously fell back to
    English.
  - ProfilePage (`account:profile_card` / `/system/profile`): every hardcoded
    string — page title/subtitle, avatar Upload/Replace/Remove, Personal
    Information card, Change/Set Password card — now goes through
    `useObjectTranslation()` with `profile.*` keys (new namespace in all ten
    locale bundles); the lazy-load fallback reuses `common.loading`.
  - `ManagedByBadge` chips/tooltips (Config/System/Append-only/Identity) now
    resolve through new `managedByBadge.*` keys with `{{provider}}`
    interpolation.
  - `record:quick_actions` resolves action labels via the
    `objects.{object}._actions.{action}.label` convention plus `pickLocalized`,
    so object action buttons (Change Password, Enable 2FA, …) localize.
  - `record:details` / `record:related_list` / `record:alert` / `ObjectTree`
    pass inline label objects through `pickLocalized`.
  - Locale bundles: added `managedByBadge` namespace to all ten locales and
    backfilled `list.inlineEditShort` / `inlineEditLabel` /
    `recordEditingTitle` for ja/es/ko/de/fr/pt/ru/ar.
  - @object-ui/react-runtime@14.0.0
  - @object-ui/sdui-parser@14.0.0

## 13.2.0

### Patch Changes

- @object-ui/react-runtime@13.2.0
- @object-ui/sdui-parser@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/react-runtime@13.1.0
- @object-ui/sdui-parser@13.1.0

## 13.0.0

### Patch Changes

- 619097e: Adopt `@objectstack/spec` 13 (ADR-0090 Permission Model v2) across the workspace.

  Every workspace package now depends on `@objectstack/spec` ^13.0.0 — the v2 major that renames role → position (D3), removes the profile concept (D2), makes OWD default to `private` when unset (D1), and drops the legacy `read`/`read_write`/`full` sharing aliases (D4). UI fallout fixed in the same sweep:

  - **clientValidation**: the `role` draft-schema loader is now `position` → `PositionSchema` (fixes the `RoleSchema does not exist` build break, #2365); the dead `profile` loader is removed (D2).
  - **Studio previews**: `RolePreview` → `PositionPreview` (flat — positions carry no hierarchy; the old parent-chain breadcrumb and "assign to a Profile" copy are gone). Legacy `role`/`profile` preview keys stay registered for pre-v2 backends.
  - **OWD control** (`ObjectSettingsPanel`): removed the now-dead alias normalization (spec 13 rejects the aliases at authoring time) and the amber "fully public" warning — an unset sharing model now defaults to Private (D1), and the copy says so in both locales.
  - **Fallback schemas / anchors / samples**: `position` replaces the hierarchical `role` fallback schema; `isProfile` dropped from the permission create-anchor and previews samples; permission-set viewer no longer renders a profile badge; console System hub counts `sys_position` instead of the removed `sys_role`.
  - **Studio i18n**: type labels `Role/角色` → `Position/岗位`, `profile` label removed, Access-pillar heading and sharing copy rewritten to the v2 vocabulary.
  - `@object-ui/types` now exports `SubmitBehavior` (was defined but missing from the public surface, breaking `@object-ui/plugin-form`'s re-export under a clean build).
  - **External OWD dial (D11)**: the object Settings sharing card gains an `externalSharingModel` select (portal/partner baseline) with an inline wider-than-internal warning mirroring the publish-time lint.
  - **Permission matrix OWD badges**: every object row now shows its record-level baseline (`OWD Public read`, `Ext Private`, or `OWD Private (default)` for the D1 fail-closed unset case) so grant edits carry their record-reach context.

  The flow designer's approval assignee `role` kind is intentionally unchanged — spec 13 keeps it as the sole D3 exception (better-auth `sys_member.role` org-membership tier).

  - @object-ui/react-runtime@13.0.0
  - @object-ui/sdui-parser@13.0.0

## 12.1.0

### Patch Changes

- @object-ui/react-runtime@12.1.0
- @object-ui/sdui-parser@12.1.0

## 12.0.0

### Major Changes

- d985fe5: upgrade with objectstack 12

### Patch Changes

- @object-ui/react-runtime@12.0.0
- @object-ui/sdui-parser@12.0.0

## 11.5.0

### Patch Changes

- @object-ui/react-runtime@11.5.0
- @object-ui/sdui-parser@11.5.0

## 11.4.0

### Patch Changes

- a4ccd4d: FormPage: unwrap the ExpandedViewItem envelope from `/meta/view/:name` — the form
  spec lives under `config`, so internal forms rendered zero fields with a bare
  Submit that falsely succeeded. Non-form views reaching the forms route now throw
  an actionable error instead of the same empty-form false positive.
  - @object-ui/react-runtime@11.4.0
  - @object-ui/sdui-parser@11.4.0

## 11.3.0

### Patch Changes

- 96b1293: ADR-0080: ship a `manifest-dump.html` build entry + `scripts/dump-public-manifest.mjs` that serialize the registry's public tier (`getPublicConfigs()`) to `sdui.manifest.json` — the artifact the framework `os build` JSX gate consumes for full component/prop validation. Generated in a real browser (the registry pulls browser-only deps); wired into `build-console.sh` framework-side.
- d23d6eb: Three-tier AI page authoring: `kind:'html'` and a trusted `kind:'react'` tier.

  - **`@object-ui/react-runtime`** (new) — the trusted runtime-React tier for
    `kind:'react'` pages (vendored react-runner: Sucrase transpile + scope-eval,
    no sandbox). Renders real JSX/TSX (any HTML + JS + hooks/useState/map/onClick)
    in the main React tree with an injected scope (React, the public data blocks,
    page data) and a built-in error boundary.
  - **`@object-ui/core`** — new runtime capability gate (`enableCapability` /
    `disableCapability` / `isCapabilityEnabled`, `CAP_REACT_PAGES`). `react-pages`
    defaults **ON** (the platform trusts reviewed, draft-gated authors); a
    deployment turns it OFF server-side (the runtime injects the disable global
    when `OS_DISABLE_REACT_PAGES` is set). Never controlled from authored metadata.
  - **`@object-ui/components`** — PageRenderer now routes `kind:'react'`
    (capability-gated, lazy-loads the runtime) and renders `kind:'html'` (the
    former `kind:'jsx'`, still accepted as a deprecated alias). The `html` tier
    now resolves the full safe native HTML tag set (h1–h6, p, a, ul/ol/li, img,
    blockquote, pre, strong/em, …) so authored HTML lives up to its name.

- Updated dependencies [d23d6eb]
  - @object-ui/react-runtime@11.3.0
  - @object-ui/sdui-parser@11.3.0

## 11.2.0

## 11.1.0

## 7.3.0

### Minor Changes

- 02da91f: feat(console): resolve the post-login landing from app metadata, not a hardcode

  The root route (`/`) previously redirected via a hardcoded
  `PREFERRED_APPS = ['cloud_control']` in `CloudAwareRootRedirect` — baking one
  product's policy (cloud) into the shared Console, with no supported way for a
  deployment to opt out of the `/home` launcher or land somewhere custom without
  forking the SPA.

  `CloudAwareRootRedirect` is replaced by `RootLandingRedirect`, which resolves the
  landing purely from app metadata (`resolveLandingPath`, unit-tested):

  1. the app marked `isDefault: true` → `/apps/<it>` (its own `homePageId` then
     selects the landing page within it);
  2. else the single visible app (`active !== false && hidden !== true`) → that app;
  3. else `/home` — the multi-app workspace launcher (legacy default).

  This gives `isDefault` **routing semantics** (it was a display-only badge) — a
  back-compat-relevant contract change. Back-compat: a deployment with no
  `isDefault` app and ≥2 visible apps still lands on `/home`, exactly as before;
  cloud is unaffected (`cloud_control` is already `isDefault: true`) and the
  cloud-specific hardcode is removed. The landing is now a build-time product
  decision a developer declares in metadata, not a runtime Settings-UI preference.

## 7.2.0

## 7.1.0

### Patch Changes

- b1766d3: fix(console): object-detail page uses the valid `record` PageType

  `buildObjectDetailPageSchema` emitted `pageType: 'record_detail'`, which was
  dropped from `PageType` (`record | home | app | utility`) in framework#2265 /
  objectui#1949 — a `tsc` error (TS2322) that broke the console build (Bundle
  Analysis). An object detail page is a `record` page; use that.

## 7.0.0

### Minor Changes

- 893e530: Package documentation portal + nav entry (ADR-0046).

  The `/docs/:name` viewer already existed but had no way in: no index and no
  navigation entry, so a doc was reachable only by typing its exact URL. Adds a
  platform-level docs portal at `/docs` (`DocsIndex`) that lists every installed
  `doc` metadata item grouped by package namespace, each linking to the existing
  viewer. A "Documentation" entry now appears in the home/system navigation
  (`UnifiedSidebar`), visible to all users (not gated behind workspace-admin), so
  docs are discoverable. The viewer route stays app-independent and
  single-coordinate (`/docs/<name>`); per-app deep-links remain opt-in `url` nav
  items pointing at that same global URL. Doc grouping is a pure, unit-tested
  helper (`groupDocsByPackage`).

- 78d1a56: ADR-0046 P2: `/docs/:name` package-documentation route.

  One authenticated route renders any installed `doc` metadata item (flat Markdown docs compiled from a package's `src/docs/*.md`): fetches the item via the standard metadata API (`meta.getItem('doc', name)`), renders the sanitized body through `@object-ui/plugin-markdown`, and rewrites relative cross-references `[x](./other_doc.md#anchor)` → `/docs/other_doc#anchor` (fenced/inline code untouched, SPA navigation on click). Unknown names degrade to a "Documentation not found" notice per the ADR — never a hard failure.

- 89e113c: ADR-0044 send-back-for-revision in the approvals inbox (framework #1744/#1769). Approvers get a "Send back" action (violet, with its own dialog) that ends the round as `returned` and unlocks the record; the submitter sees a revision panel on the returned request — edit-record link, optional comment, Resubmit (opens round N+1) and Recall (abandons the revision). New `returned` status badge/filter, Round-N chips (list + drawer), timeline rendering for `revise`/`resubmit` actions, `approvalsApi.sendBack/resubmit`, and ten-locale `approvalsInbox` strings.
- c09f44e: Docs: mermaid diagrams + long-doc table of contents (ADR-0046).

  - **plugin-markdown** renders ```mermaid fenced blocks as diagrams (`<Mermaid>`: lazy-loaded mermaid, `securityLevel: 'strict'`, rendered post-`rehype-sanitize`by a trusted component, degrades to the raw source on error). Mermaid is text → SVG, so it stays within the v1 image/binary ban. Adds`extractToc(markdown)`— a TOC builder whose slugs are generated with the same`github-slugger` `rehype-slug`uses, so`#id` links resolve to the rendered heading anchors.
  - **console** `DocPage` shows a sticky right-rail table of contents (h2–h3) for docs with ≥3 headings, plus an app-independent `/apps/:packageId/docs` index already added earlier.
  - **i18n** adds `help.onThisPage` (en/zh; other locales fall back).

- 3fa23a7: feat(header): context-aware Help & Documentation menu + app-scoped docs index

  The top-right "?" was a bare external link to `docs.objectstack.ai`, duplicating
  the left sidebar's in-product `/docs` entry and ignoring the ADR-0046 docs hub.
  It is now an aggregated, context-aware menu:

  - **This app's docs** — shown only when the current app's package owns docs
    (matched by `_packageId`). A single-doc app deep-links straight to the
    viewer; a multi-doc app lands on the new app-scoped index.
  - **All documentation** — the in-product `/docs` portal.
  - **Online documentation** — `docs.objectstack.ai` (opens in a new tab).

  Docs are lazily fetched once on first menu open (names/labels only), so the menu
  adds no cost until used; a failed fetch soft-degrades to the static entries.

  Also adds the app-scoped docs index route **`/apps/:packageId/docs`**
  (`AppDocsIndex`) — the package-scoped sibling of `/docs`, listing just that
  app's docs — which the "This app's docs" entry targets when an app ships more
  than one. New `help.*` strings added to the `en` and `zh` bundles (other
  locales fall back to `en`).

- 4eb9cb6: feat(plugin-tree): add a `tree` / tree-grid object view type

  Renders a self-referencing object as an indented, expand/collapse tree-grid —
  the right view for arbitrary-depth hierarchies (business unit / org chart,
  category trees, BOMs, nested comments) that fixed-depth grouping can't express.
  New `@object-ui/plugin-tree` package (`object-tree`/`tree`), `tree` added to the
  `ViewType` union, and dispatch wired through plugin-list `ListView` +
  app-shell `ObjectView` (the console path).

### Patch Changes

- 8d37b31: fix(ADR-0046): enable Tailwind typography so Markdown docs render styled.

  `plugin-markdown`'s `MarkdownImpl` renders inside `prose prose-h1:text-3xl …`,
  but the console never registered `@tailwindcss/typography`, so every `prose`
  utility was a no-op — Markdown rendered with no heading sizes, list markers, or
  spacing (the `/docs/<name>` page showed its `# Title` at body size, looking
  unstyled). Register the plugin (`@plugin '@tailwindcss/typography'`) and add the
  dependency. Now doc headings, paragraphs, inline code, and links render with
  proper hierarchy.

- d82a580: fix(ADR-0046): docs portal shows summaries, not machine ids.

  The portal listed each doc as title + its raw machine name (`showcase_index`)
  — noise for the business readers docs are written for. Drop the machine id from
  the reader-facing list and render the doc's `description` (ADR-0046) as a
  one-line summary under the title instead. Falls back cleanly when a doc has no
  description.

- e164c92: feat(ADR-0046): lightweight chrome for the docs routes.

  The `/docs` portal and `/docs/:name` viewer are app-independent top-level
  routes, so they rendered as bare full-bleed pages with no header and no way
  back. Add a minimal sticky `DocShell` header — a "Documentation" home link
  (→ `/docs`) plus a breadcrumb of the current doc — shared by the portal and the
  viewer. Keeps ADR-0046's "no nav taxonomy in v1" intent (no app sidebar) while
  giving readers orientation and a way out. The portal's redundant in-body title
  is dropped in favour of the header.

- b8a5d41: ADR-0048: finish sweeping app-entry links onto the canonical package-id route
  segment (follow-up to the home-page fix).

  - `AppManagementPage` (System → Apps) "Open app" button now opens
    `/apps/<packageId>` (`app._packageId ?? app.name`) instead of `/apps/<name>`.
  - `AppContent` current-app sub-routes/redirects (the `metadata/package` →
    `component/developer/packages` redirect, and the record-form `baseUrl`) now
    build against the URL's own `appName` segment instead of `activeApp.name`, so a
    `/apps/<packageId>/…` URL keeps its package-id segment instead of flipping to
    the name form. `requestedAppMissing` (preview-drafts) now resolves the segment
    via `matchAppBySegment` so a package-id URL isn't treated as a missing app.

- 56571d6: ADR-0048: DocPage resolves docs package-scoped. The doc viewer at
  `/apps/:appName/docs/:name` now passes the route's package segment as
  `getItem('doc', name, { packageId })`, so the single-doc fetch is package-scoped
  (prefer-local) on the server. Two installed packages may ship a doc with the
  same bare name and each resolves within its own package — doc names no longer
  need a globally-unique namespace prefix (the prefix becomes a convention, like
  `page`/`dashboard`/`report`). The legacy top-level `/docs/:name` path (no
  `appName`) keeps its context-free behavior.
- 77cc6bb: Cloud Connection bind v2 UX (cloud ADR runtime-identity-binding §2.3): the binding flow becomes one click. `CloudConnectionPanel` drops the environment-id input entirely (registration happens cloud-side at approval), auto-opens the approval page in a popup on Connect (user-code display stays as the popup-blocked fallback), and shows the registered runtime name + runtime id once bound. `DeviceAuthPage` displays the requesting device's context (`runtime_name` / `runtime_version` from the verification URL) plus an "only approve if you started this" warning — the informed-consent surface for the RFC 8628 flow. Two new `auth.device.*` keys across all locales.
- 82bcc87: DeviceAuthPage claims the device code (GET /device?user_code=…) before approve/deny — better-auth's device-authorization plugin rejects both with 400 "not been claimed by a verifying session" otherwise, so approval silently failed.
- c97513f: DeviceAuthPage preserves the full query string (runtime_name / runtime_version device context) through the login redirect — previously only user_code survived, so a signed-out approver never saw what device they were authorizing.

## 6.2.3

## 6.2.2

## 6.2.1

## 6.2.0

## 6.1.0

## 6.0.4

## 6.0.3

## 6.0.2

### Patch Changes

- d0e63f1: Migrate AI chat history from localStorage to the server-backed
  `ai_conversations` / `ai_messages` REST API. The studio `AiChatPanel`,
  the console `ConsoleFloatingChatbot`, and any other consumer of the new
  `useChatConversation` hook (in `@object-ui/app-shell`) now resolve a
  durable conversation id per signed-in user, hydrate prior messages on
  mount, and rotate the conversation on reset. The previous
  `objectstack:ai-chat-messages` localStorage entries are no longer read
  or written.

## 6.0.1

## 6.0.0

## 5.4.2

## 5.4.1

## 5.4.0

## 5.3.2

## 5.3.1

### Patch Changes

- 9c95649: Make the published Console SPA path-portable. Build with relative Vite
  base (`./`) and derive the React Router basename from `document.baseURI`
  at runtime, so the same `dist/` works at any mount path (`/_console/`,
  `/console/`, `/foo/bar/`). Hosts should inject `<base href="/path/">`
  into the served HTML — the framework CLI does this automatically.
- c351c96: Fix self-host blank page: clear `VITE_SERVER_URL` in `.env.production`
  so the published SPA defaults to same-origin instead of baking in
  `https://demo.objectstack.ai`. CORS-blocked auth/i18n/discovery calls
  were preventing the SPA from rendering when embedded in any host other
  than the demo deployment. Demo-only deployments now inject
  `VITE_SERVER_URL` at deploy time.
  - @object-ui/types@5.3.1
  - @object-ui/core@5.3.1
  - @object-ui/i18n@5.3.1
  - @object-ui/react@5.3.1
  - @object-ui/components@5.3.1
  - @object-ui/fields@5.3.1
  - @object-ui/layout@5.3.1
  - @object-ui/data-objectstack@5.3.1
  - @object-ui/auth@5.3.1
  - @object-ui/permissions@5.3.1
  - @object-ui/mobile@5.3.1
  - @object-ui/plugin-calendar@5.3.1
  - @object-ui/plugin-charts@5.3.1
  - @object-ui/plugin-chatbot@5.3.1
  - @object-ui/plugin-dashboard@5.3.1
  - @object-ui/plugin-designer@5.3.1
  - @object-ui/plugin-detail@5.3.1
  - @object-ui/plugin-form@5.3.1
  - @object-ui/plugin-gantt@5.3.1
  - @object-ui/plugin-grid@5.3.1
  - @object-ui/plugin-kanban@5.3.1
  - @object-ui/plugin-list@5.3.1
  - @object-ui/plugin-map@5.3.1
  - @object-ui/plugin-markdown@5.3.1
  - @object-ui/plugin-report@5.3.1
  - @object-ui/plugin-timeline@5.3.1
  - @object-ui/plugin-view@5.3.1
  - @object-ui/collaboration@5.3.1
  - @object-ui/app-shell@5.3.1
  - @object-ui/providers@5.3.1

## 5.3.0

### Minor Changes

- efb4c00: feat(observability): Sentry integration + bundle splitting for production launch

  **Sentry (opt-in via `VITE_SENTRY_DSN`)**

  - New `initSentry()` / `captureError()` / `setSentryUser()` / `getSentry()`
    helpers exported from `@object-ui/app-shell`.
  - Dynamic-import design: when `VITE_SENTRY_DSN` is unset, `@sentry/react`
    is **never fetched** — zero bundle cost for self-hosted users.
  - `ErrorBoundary.componentDidCatch` now best-effort reports to Sentry.
  - Console app calls `initSentry()` before React mount; never blocks first
    paint.
  - Configurable via:
    - `VITE_SENTRY_DSN` — required to enable
    - `VITE_SENTRY_ENVIRONMENT` — defaults to `MODE`
    - `VITE_SENTRY_RELEASE` — defaults to `VITE_APP_VERSION`
    - `VITE_SENTRY_TRACES_SAMPLE_RATE` — defaults to `0.1`
    - `VITE_SENTRY_REPLAY=true` — opt-in to 10% on-error replay
  - Sensitive URL params (`token`, `access_token`, `apiKey`, etc.) are
    stripped from breadcrumb URLs before send.

  **Bundle splitting**

  - `plugin-dashboard` (8 component types) now lazy-registered via
    `ComponentRegistry.registerLazy()` — only loads on dashboard pages.
  - `plugin-dashboard` and `plugin-report` each get their own chunk
    (previously merged into `plugins-views`).
  - Net first-paint JS reduction: **~200 KB** when the user never visits a
    dashboard or report page.
  - New chunks: `plugin-dashboard` (119 K), `plugin-report` (92 K),
    `vendor-sentry` (346 K raw / 97 K brotli, lazy).
  - `plugins-views` shrinks 387 K → 180 K (now `plugin-list` + `plugin-detail` only).

## 5.2.1

## 5.2.0

## 5.1.1

## 5.1.0

### Patch Changes

- 32306e8: chore: bump `@objectstack/client` and `@objectstack/cli` to `^4.2.0`

  Brings in the published Optimistic Concurrency Control surface
  (`If-Match` header on `data.update`/`data.delete`, `409
CONCURRENT_UPDATE` response shape with `currentVersion` /
  `currentRecord`) so the inline-edit save path can actually push the
  `ifMatch` token through.

## 5.0.2

## 5.0.1

## 5.0.0

## 4.8.0

## 4.7.0

## 4.6.0

## 4.5.0

## 4.4.0

## 4.3.1

## 4.3.0

## 4.2.1

## 4.2.0

## 4.1.0

## 4.0.12

## 4.0.11

### Patch Changes

- 1909bc3: Add `transformSpecTranslations` / `isSpecTranslationData` helpers to
  `@object-ui/i18n` so apps no longer need to maintain their own copy of the
  `@objectstack/spec` `TranslationData` → flat namespace transform.

  The new transform preserves **every** `_`-prefixed object scope by
  convention (`_views`, `_actions`, `_sections`, `_notifications`, `_errors`,
  `_options`, plus anything added in future spec versions), which fixes a
  class of silent-failure regressions where new spec scopes were dropped
  during transformation — leaving e.g. list-view labels to fall back to the
  untranslated source string.

  `@object-ui/console`'s `loadLanguage.ts` is rewritten to delegate to the
  shared helper.

## 4.0.10

## 4.0.9

### Patch Changes

- 19c044f: i18n

## 4.0.8

## 4.0.7

### Patch Changes

- 7c9b85c: Fix compatibility with the framework's normalized Expression envelope format.

  `@objectstack/spec` now emits predicate (`visible` / `enabled`) and template
  (`titleFormat`) fields as `{ dialect, source }` envelopes instead of bare
  strings. The previous implementation assumed strings and crashed the record
  detail view (`TypeError: titleFormat.replace is not a function`) and printed
  `Failed to evaluate expression: ${[object Object]}` for every action visibility
  predicate.

  - `@object-ui/core`: `ExpressionEvaluator.evaluate` / `evaluateCondition` now
    unwrap Expression envelopes transparently.
  - `@object-ui/react`: new `toPredicateInput()` helper to safely normalize
    `boolean | string | Expression` predicate inputs into the `${expr}` form
    expected by `useCondition`.
  - `@object-ui/components`: `action-bar`, `action-button`, `action-group`,
    `action-icon`, `action-menu` renderers use `toPredicateInput()` instead of
    template-literal interpolation that produced `${[object Object]}`.
  - `@object-ui/plugin-detail`, `@object-ui/plugin-kanban`,
    `@object-ui/plugin-calendar`, `@object-ui/app-shell`,
    `@object-ui/console`: title-format helpers accept both legacy strings and
    the new `{ source }` envelope.

  All changes are backward-compatible — legacy bare strings continue to work.

## 4.0.6

## 4.0.5

## 4.0.4

## 4.0.3

## 4.0.1

### Patch Changes

- f3bc42e: fix console

## 4.0.0

## 3.4.0

## 3.3.2

### Patch Changes

- 89a7b21: fix i18n

## 3.3.1

### Patch Changes

- db7a418: fix(console): respect Vite `BASE_URL` when redirecting after a workspace
  switch. The post-switch redirect previously hardcoded `/console/home`,
  which broke deployments served from a different base path (e.g. Vercel,
  where the console is mounted at `/`). It now derives the target from
  `import.meta.env.BASE_URL`, so it works both behind `HonoServerPlugin`
  (`/console/home`) and on standalone deployments (`/home`).

## 3.3.0

## 3.2.0

### Minor Changes

- 91a9103: upgrade objectstack ai service

## 3.1.5

## 3.1.4

### Patch Changes

- 7129017: fix

## 3.1.3

## 3.1.2

## 3.1.1

## 3.0.3

### Patch Changes

- e1267d2: fix: re-attach listViews to object metadata stripped by defineStack() Zod parse

## 3.0.2

### Patch Changes

- f1c2fc1: fix build

## 3.0.1

## 3.0.0

### Major Changes

- Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer
