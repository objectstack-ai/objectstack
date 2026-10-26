# @object-ui/i18n

## 18.1.0

### Patch Changes

- 5235d6d: Setup › Packaged automation: the clone result now offers the next steps (objectui#13270).
  
  A clone of a packaged flow is created `draft`, which does not switch it off, so a cloned record-change or schedule flow runs beside the flow it was copied from. The result used to show the server's notice and nothing to click. It now keeps that notice and adds:
  
  - **Switch "SOURCE" off** — calls the same packaged-flow toggle as the row's own switch, for the flow that was cloned. On success the row reads off and the result says the source is switched off. A refusal shows the server's message beside the button, and the button stays. When the source is already off, no switch-off is offered.
  - **Open the clone in Studio** — links the package-less Studio scope (`/studio/~org/automations`) opened on the clone.
  
  The clone itself is unchanged. Three new language-pack keys, `packagedAutomation.cloneSwitchSourceOff`, `.cloneSourceOff` and `.cloneOpen`, in all ten packs.
- 0093b2c: Settings pages: a `url`, `email`, `phone` or `color` value that misses the format its type declares now blocks Save (objectui#13287). No request goes out, the row is marked inline with a message naming what the format expects, and focus moves to the first such row, on the same path as the `required` check. The grammars are the settings service's own (objectstack#24882), judged on the trimmed value; an empty value is left to `required`, and a hidden or env-locked row is not judged. Adds `console.settingsView.invalidPhone` and `console.settingsView.invalidColor` to every locale pack; `email` and `url` reuse `validation.email` and `validation.url`.
- ff77cfc: On a cloud-managed environment (`features.cloudManaged: true` from `/auth/config`), the console says what the server already enforces. Setup → Users shows one line saying where people are invited (the organization, in the cloud) and marks a user who holds no permission set beyond the baseline as "Not authorized", read from their `sys_user_permission_set` and `sys_user_position` rows. The identity import entry is not offered, the organization members page shows a note instead of Invite member, and the recovery-password reminder does not show. With the flag absent or `false`, nothing changes.
  
  `AuthPublicConfig['features']` gains `cloudManaged`. `ObjectGrid` gains the `rowAdornment` host prop, a node drawn beside one row's title (the declared name field's cell, else the first shown column, and the card title in the card view), and `ListView` forwards its own `rowAdornment` to the grid.
  
  Clause-②: yes
  Metadata-protocol: none
- 241cb78: Setup refusals lead with one plain sentence. The Packages sheet, the metadata editor's error banner (Positions and every other metadata type) and the action parameter dialog (OAuth application registration among them) now show the first sentence of the server's message, without a leading bracketed code or field path and without the trailing declared code. The whole message, byte for byte, sits behind a "More" toggle with a copy button. A one-sentence message renders as before. New `refusalDetails.*` strings in all ten locale packs (objectui#13332).
- 404ccae: Setup's metadata deletes and the related list's row delete now ask in the console's in-app confirm dialog and name what goes (objectui#13333).
  
  - The metadata editor's Reset overlay / Delete and Discard draft, the history timeline's Rollback, the Datasources page's Delete and a metadata type's `confirmText` action no longer use the browser's native `confirm()`. Each opens an in-app AlertDialog whose title names the item: by its type label and its own label for Reset / Delete (for example `Delete Object "Account"?`), with the machine `type/name` in the body; by label and name for a datasource; by action and item for a type action.
  - The related list's row Delete no longer asks "Are you sure you want to delete this record?". The sentence names the row by its record title, the same resolver the record header uses, so a grant row reads by its declared title (the grant and the user it belongs to). The `detail.deleteRowConfirmation` string now takes a `{{name}}` value in all ten locales.
- ec627ab: A lookup / master-detail / tree value whose referenced record the viewer's own read answers "not found" for (a 404, which is what the server answers for a record this viewer may not read) now reads "Restricted record", translated, with a lock icon, no record id and no link, in grids and on the record page (objectui#13335). It used to print the raw id beside a question mark. No additional read is made: the label comes from the same lookup read the cell already performed, so it reveals nothing the id did not. A reference that is still loading, whose read failed, or that is empty renders as before, and a readable reference still shows its name as a link. New key: `detail.restrictedLookupReference` in all ten locale packs.
- 0f4adc3: Setup › Packaged automation: the Clone dialog now opens with a name and label filled in (objectui#13344).
  
  It used to open with both fields empty. It now proposes `<source>_copy` as the machine name and "<source label> (copy)" as the label, using the flow's machine name when it has no label. Both fields stay editable, and the dialog can be submitted as it opens: the proposed name keeps the lowercase snake_case shape a flow name must have, and it is the same name the server suggests when a name is taken. A name that is already taken is still refused by the server with its 409 message, shown as sent.
  
  One new language-pack key, `packagedAutomation.cloneCopyLabel`, in all ten packs.
- fa31856: Connect an Agent no longer mints an unnamed API key in one click (objectui#13355). "Create key" stays disabled until the administrator types a name, and the name is sent as typed: the key is no longer created as `agent-key` when the name box is empty. Clicking "Create key" now opens an in-app confirm naming the key; Cancel creates nothing, and confirming creates the key and shows it once to copy, as before. This matches Setup → API Keys → Create Key, which also requires a name.
  
  New string: `connectAgent.apiKey.confirmTitle`, in all ten locale packs.
- 7f60e9d: A single-record action launched with 0 or several rows selected is refused before any dialog opens, and the refusal is translated (objectui#13384).
  
  `ActionRunner` now asks the handler it will dispatch to for an early refusal (`ActionRunnerHandler`'s optional `refuseBeforeInput`) before the confirmation and the param dialog. The handlers `createServerActionHandler` builds answer it with the row-count check the dispatch already runs, so "select a row first" and "select exactly one row" are shown before the user fills anything in, and nothing is sent. With exactly one row the dialog behaves as before. A host that wraps the built handler in its own function keeps the early refusal only by forwarding `refuseBeforeInput`; the console's `createConsoleServerActionHandler` now forwards it, so on a list page (HotCRM's "Add to Campaign" on My Leads) the refusal toast shows and no dialog opens.
  
  Both refusals now carry a pack key (`actions.selectRowFirst`, `actions.selectExactlyOneRow`, defined in every shipped pack). `resolveServerActionRecordId` returns it as `errorKey` beside the English `error`, and the runner's early refusal goes through its translator by that key.
- 4eeb174: A record-scoped flow action launched from a list toolbar with 0 or several rows selected is refused before its param dialog opens, and its refusal is translated (objectui#13397).
  
  The console's `flowHandler` now carries `refuseBeforeInput`, the early refusal objectui#13384 gave the `script` handler, answered by the same resolver its dispatch runs. The runner asks it before the confirmation and the param dialog, so "select a row first" and "select exactly one row" show in the session's language before the user fills anything in, and nothing is sent. With exactly one row the flow behaves as before. A direct call that is refused at dispatch time is shown through the refusal's pack key too.
  
  The console server-action wrapper's `newTabUrl` refusal ("no record id available") now has a pack key, `console.serverAction.noRecordId`, defined in every shipped pack, and the wrapper's fast path shows the resolver's own refusal through its pack key.
- afcf654: zh-CN: the admin-override approval copy no longer calls the override 越权 ("exceeding one's authority", the word for a violation). The override levers now read 管理员代为通过 / 管理员代为拒绝 / 管理员代为转签 / 管理员代为撤回 (`approvalsInbox.overrideActionLabel` is `管理员代为{{action}}`), the history chip reads 管理员代办 (`viaOverrideChip`) and its hint names the 管理员代办 path (`viaOverrideHint`), and the confirmation notices say 以管理员身份代为处理 and 记录为管理员代办 (`overrideNotice*`, `overrideReassignNotice*`, `overrideRecallNotice*`). Only the zh pack changes; the rest of each sentence and every placeholder are unchanged (objectui#13402).
- 2c3dc72: charts: a sankey now names every node and colours its flows, and a funnel labels every stage. Sankey nodes were bare bars with no text and every link was one grey, so the chart could not be read without hovering. Each node now carries its name (to its right, or to its left in the last column so it stays on the chart), and each link is stroked in the palette colour of the category it flows into. Every link leaves the same root node, so colouring by source would paint them all one colour again. A funnel labelled each stage to the right of its segment, past the plot's edge, so only the narrowest stage's label showed. Labels now sit centred inside their segments, in foreground text with a background halo so a name wider than the narrowest segment stays legible. The sankey's "Showing N of M rows" footnote now comes from the locale packs under the new count family `chart.sankeyOmittedRows`, translated in all ten packs. The English text is unchanged (objectui#13404).
- 2958f17: The console knows the `external` organization role that objectstack#25515 added to `@objectstack/spec`'s membership vocabulary (objectui#13427). Without it `ORG_ROLE_LABELS` no longer type-checked against an `@objectstack/spec` that lists the role.
  
  `@object-ui/auth` exports `ORG_ROLE_EXTERNAL` and labels it (`organization.roles.external`, "External"). Every pack in `@object-ui/i18n` carries the key; zh reads 外部成员, as the server's own `sys_member.role` option does. Wherever the installed spec lists the role, the invite dialog offers it to every issuer who can invite, a delegated admin included, because objectstack's invitation cap admits it from any issuer: it confers less than a member. Owners and admins can also set it from the members page. On the grade ladder it sits with `member`, as it does in objectstack's cap, so it never unlocks an administrative affordance.
- 2c4e5f5: A member who may read none of the objects an app names now lands on one page that says they need access and whom to ask, instead of the app's dashboard drawn as a grid of "You don't have access" tiles (objectstack-ai/objectstack#25338).
  
  The app root's landing asks the object-read prune's own verdict (`useNavMemberGates().can`) over every `type: 'object'` entry the app names, at every depth and in every area. When the app names at least one object and the member may read none of them, it renders `AppNoAccessEmptyState` with the new `reason="no-readable-object"`: "Your account cannot read any of the records in this app yet. Ask an administrator to assign you a permission set.", plus the Setup link for a member who may grant access. One readable object, or an app that names no object at all, lands exactly as before.
  
  Clause-②: yes
  Metadata-protocol: none
- ad74e98: fix(plugin-list): the synthetic "All records" tab of a tabs-mode user-filter bar (`showAllRecords`) now reads its label from the new `list.userFilters.allRecords` i18n key, filled in every shipped locale (zh: 全部记录), instead of a hard-coded English string (objectui#13405). The tab's `__all__` id and behaviour are unchanged.
- Updated dependencies [49a536d]
- Updated dependencies [8e90779]
- Updated dependencies [7f60e9d]
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- d92b2a1: The metric sub-caption is retired on the reader side (objectui#11389, ruling C, the objectui half after `@objectstack/spec` 17.7.0). **BREAKING** for any dashboard that drew a caption under a metric's value.
  
  A metric tile used to draw a sub-caption under its value from the widget's `options.description`, translated by a client bundle entry at `dashboards.NAME.widgets.ID.subCaption`. The spec never declared that options key, and its only writer was the server's `translateDashboard` overlay. `@objectstack/spec` 17.7.0 removed the overlay and refuses a `subCaption` translation entry by name. objectui now stops reading both:
  
  - **`@object-ui/plugin-dashboard`.** No metric tile draws a sub-caption, on either dashboard surface (`DashboardRenderer`, `DashboardGridLayout`), whether the tile is dataset-bound or a stored inline metric. An authored `options.description` (a string or a per-locale map) draws nothing, and neither does a bundle `subCaption` entry. A widget's one authored description, `widget.description`, still draws as the card-header subtitle on `DashboardRenderer`, translated through the widget's `description` bundle key. Nothing on the package entry is removed: the sub-caption resolver module and `DatasetWidget`'s `subCaption` prop were internal.
  - **`@object-ui/i18n`.** `useObjectLabel()` no longer returns `widgetSubCaption`. This removes a member of a published hook's return value: a caller that destructured it no longer compiles, and has nothing to call instead, because the key it read is refused by the spec.
  - **`@object-ui/sdui-parser`.** `CONSUMED_WIDGET_OPTION_KEYS` drops `'description'` and is now exactly the five keys the spec declares (`dateGranularity`, `limit`, `sortBy`, `sortOrder`, `stageOrder`). So `validateTree` reports an authored `options.description` on a dataset-bound dashboard widget as an `unconsumed-widget-option` **warning**, where it used to report nothing. It is a warning, not an error, and the widget's `suppressWarnings` escape hatch still applies.
  
  **Clause-②: no (narrowing).** One export member is removed (`useObjectLabel().widgetSubCaption`) and one exported constant loses a member (`CONSUMED_WIDGET_OPTION_KEYS`). Nothing is added and no accepted input widens.
  
  If a caption under a metric's value is wanted again, it returns as a declared widget-level key outside `options`, not as `options.description` (ruling C).
- fd060f0: All ten locale packs gain `view.noObject`, the hint an object-bound block shows
  when its node names its object in neither place (objectui#11605).
  
  **Clause-②: yes (widening)** — a new key, `view.noObject`, in every pack. English
  reads "No object named: set {{property}} or dataSource.object.", the wording of
  `element.number.noObject` with the property as a hole; each translation is that
  key's own translation with the same hole. `{{property}}` is the block's object
  key, interpolated and never translated. No existing key changes.
- 7b17705: Installed Apps now reads a package the runtime refused to load at startup as "Not loaded", says why, and keeps its Uninstall (objectui#11645).
  
  After a restart whose startup check refused a package built for another platform protocol, the install-local listing still lists the package, so it can be uninstalled or replaced. Since `@objectstack/*` 17.7.0 the listing marks such an entry with `notLoaded: { code, requiredRange }` in place of `withSampleData`. Installed Apps drew every listed entry as installed. Now:
  
  - the row carries a "Not loaded" badge beside its version, and one sentence naming the reason: for `OS_PROTOCOL_INCOMPATIBLE`, that the package targets protocol `requiredRange`, which this runtime does not support. A refusal code the console has no sentence for still reads "Not loaded" and names the code;
  - Uninstall stays on the row. Its confirm and its result no longer say that the package stays loaded until the next restart;
  - the package's Details page no longer offers re-seed or purge of sample data for such an entry, since both act on objects the runtime never registered. Uninstall and Reinstall stay.
  
  A loaded entry renders as before.
  
  The language packs gain `marketplace.notLoaded.badge`, `marketplace.notLoaded.protocolIncompatible`, `marketplace.notLoaded.otherReason`, `marketplace.uninstall.confirmNotLoaded` and `marketplace.uninstall.successNotLoaded`, in all ten languages.
- fc3c2cc: Five fixes on the AI build surface, from the 2026-10-05 cloud acceptance run (objectui#11658).
  
  - **The first AI build lands on the running app.** The built-moment transition still moves the conversation into the Studio workbench at `/studio/PKG/interfaces`. The Interfaces canvas now opens in **Run** mode with the properties panel collapsed, where it used to open in Design with the panel open. One click on **Design** brings back the design overlays and the properties panel. Every other way into Studio, the "Design in Studio" button included, still opens in Design. The transition asks for this with router state, which the pillar reads once at mount; it is not a URL param, so a reload or a shared link opens the designer.
  - **The in-app composer names the task.** Inside an app, the composer placeholder reads "Ask about your data, or ask me to change this app…". This covers the console dock in a running app, the Studio dock and `/ai/build?package=`. It used to read "Ask {agent}…", which showed as「向 构建 提问…」in Chinese. The cold-start build surface and the ask agent keep the placeholders they had. New key: `console.ai.askOrChangeApp`.
  - **The AI usage popover shows one figure.** The popover shows the share of the single AI pool used so far (`console.ai.usage.poolUsed`, for example "19% used"). It no longer shows the build / data-Q&A split, because that split cannot honestly say which part a single-composer turn used. The keys `console.ai.usage.meterBuild`, `meterAsk` and `breakdownTitle` are retired from all ten packs. `useAiUsage` still reads `breakdown` from the wire and validates it strictly, but nothing renders it.
  - **The usage gauge no longer looks like a loading spinner.** The header glyph is now a closed outline in the tone colour with a pie wedge inside it. It used to be a stroked arc over a faint track, which at low usage had the outline of a spinner.
  - **The plan card's scope chip is localized.** The extend-mode chip on the proposed-plan card and on the live design panel reads the pack's `chatbot.plan.extendTarget` sentence, where it used to show the English literal "Adding to existing app". It names the target app by its label, and the internal name moves to the chip's tooltip. `ChatbotEnhanced` gains an optional `resolveAppLabel(appName)` prop, and the console passes one over its metadata apps. A host `planExtendLabel` still takes precedence, but the prop no longer defaults to an English string.
- 848ba0e: The chat launchers show a marker while a proposed plan awaits the user's approval (objectui#11666, item 6 of objectui#2458). A user who closed the chat with a blueprint still waiting on them used to get no sign of it from the launcher they return to.
  
  What a user sees: while the newest proposed plan of a conversation still offers "Build it", the console's assistant button (the floating launcher on app pages and Home) and the ChatDock edge launcher Studio uses carry a small amber dot. Assistive tech reads it as the button's description, from the new `console.ai.dock.planAwaitingApproval` key in the active language. With no plan awaiting, neither launcher shows anything. The dot goes away when the plan stops awaiting: the user approves it, its build runs, or a newer proposal takes its place and is itself approved or built. Opening the chat clears nothing by itself, and neither does opening another conversation. Deleting the conversation from the `/ai` sidebar drops it.
  
  Where the reading comes from: the chat's own plan card. `ChatbotEnhanced` derives "awaiting approval" from the same producer its card header and body read (`resolveProposalCardState` reads `pending`), and reports it to its host. The console's chat pane publishes that reading on the assistant bus, per conversation and per signed-in user, and the launchers read the bus. They import no chat code. The reading is exact for everything that happens in the tab. It does not see a decision made in another tab or on another device, and a page reload starts it empty until a chat on that conversation is opened again. The durable copy is the server conversation, which the launchers do not read.
  
  **Clause-②: yes (widening).** Two published surfaces widen:
  
  - `@object-ui/plugin-chatbot`: the exported `ChatbotEnhancedProps` type gains one optional member, `onPlanApprovalPendingChange`, a callback that takes one boolean and returns nothing. `ChatbotEnhanced` calls it once on mount and again whenever the boolean changes. Without it nothing changes.
  - `@object-ui/i18n`: every built-in locale pack gains one key, `console.ai.dock.planAwaitingApproval`. The `en` pack is exported from the package entry, so the key also joins the translation-key type derived from it.
  
  `@object-ui/app-shell` adds no export: the bus functions the pane and the launchers use (`publishPlanApprovalPending`, `usePlanApprovalPending`) ship inside `dist/` but are not on the package entry, and the exported `assistantBus` object and `AssistantSnapshot` type are unchanged. No prop, export or key is removed, and no existing member changes type.
- 57d82cb: The AI chat's tool-approval card and its "Open in Builder" handoff card are translated in every language (objectui#11667).
  
  The console's AI chat passed three English literals to the inline approval card: "Approve & run", "Reject", and the deny reason "Operator rejected from chat". It also left the handoff card on its English defaults: "Build this in the Builder", "Open in Builder →", and the superseded card's tooltip "A newer request is available". A zh-CN reader met all six in English, among labels that were already translated.
  
  All six now come from the language packs:
  
  - The approve and reject buttons reuse the AI Approvals inbox's keys `aiApprovals.approveAndExecute` and `aiApprovals.reject`. They make the same decision on the same pending action, through the same endpoint. English readers now see "Approve & Execute" in place of "Approve & run", the inbox's wording.
  - The deny reason, sent as `reason` on the reject request and stored as the pending action's `rejection_reason`, follows the UI language. People read it in the AI Approvals inbox, and the model reads it as prose on its next turn. No code parses it.
  - The handoff card's three strings are new keys.
  
  **Widened public surface (`@object-ui/i18n`).** Four new keys in all ten language packs, so the exported `en` pack and the `TranslationKeys` type derived from it gain four members:
  
  - `console.ai.toolDenyReason`
  - `console.ai.builderHandoffTitle`
  - `console.ai.builderHandoffOpen`
  - `console.ai.builderHandoffSuperseded`
  
  No component prop or exported type changes. `ChatbotEnhanced` already took all six strings as props.
- de96f3d: The keyboard-shortcuts dialog (`?`) lists only shortcuts that do something (objectui#11674).
  
  **Clause-②: no (narrowing)**: no accept set changes; the dialog shows fewer rows, and seven unused `console.shortcuts.*` keys leave all ten locale packs.
  
  The dialog was a static list, separate from every key handler, and six of its rows did nothing. `N` (create record), `R` (refresh data), `⌘/Ctrl+E` (edit record), `⌘/Ctrl+/` (focus search) and `⌘/Ctrl+D` (dark mode) had no handler anywhere, and the sidebar row said `B` while the sidebar toggles on `⌘/Ctrl+B`. The AI-assistant rows (`⌘/Ctrl+Shift+O`, `⌘/Ctrl+Shift+S`) were listed inside apps, where their only handler, on the AI chat page, is not mounted.
  
  `@object-ui/app-shell`: each shortcut is now advertised beside its handler, for as long as that handler is mounted, and `KeyboardShortcutsDialog` lists what is advertised. Inside an app it lists `⌘K` (command palette), `?` (this dialog), `Esc` (close a dialog or panel) and `⌘B` (toggle the sidebar). The AI chat page advertises its own two shortcuts, so they are listed only where that page is mounted. Rows are grouped as before and sorted by their text. A host that mounts `KeyboardShortcutsDialog` outside the console layout now sees the shortcuts whose handlers it mounts, not a fixed list.
  
  `@object-ui/i18n` (BREAKING; `minor` under this repository's release model, where objectui's major follows the `@objectstack` major): `console.shortcuts.focusSearch`, `createRecord`, `refreshData`, `editRecord`, `toggleDarkMode`, `groups.dataViews` and `groups.preferences` are removed from all ten packs. Nothing reads them now. A host that calls `t()` with one of them gets the key back; supply the string from your own resources if you still need it.
- 9ca3cac: The calendar and the timeline start the week on the first day of the week of the user's locale (objectui#11675), instead of a fixed Sunday (calendar) and a fixed Monday (timeline). Under `en-US` both start on Sunday; under `en-GB` or `zh-CN` both start on Monday; under `ar-EG` both start on Saturday. There is no separate week-start setting: the first day comes from the locale the dates are already formatted with.
  
  - **`@object-ui/i18n` exports `firstDayOfWeek(locale)` and its `WeekdayIndex` type.** It returns the first day of the week for a BCP-47 tag, numbered as `Date.prototype.getDay` numbers weekdays (0 is Sunday), which is also what react-day-picker's `weekStartsOn` takes. It reads the engine's `Intl.Locale` week info (`getWeekInfo()`, else the `weekInfo` accessor), including a `-u-fw-` keyword on the tag. Where the engine has neither, it reads CLDR's first-day table by the tag's region, or the region CLDR's likely subtags give it (`en` reads `US`, `zh` reads `CN`), and a region the table does not list reads Monday, CLDR's world default. A malformed tag throws the same `RangeError` that formatting a date with it would.
  - **The calendar's weeks start on the locale's first day.** `CalendarView` (and `object-calendar` through it) reads the first day from its `locale` prop, else the display locale, and the month grid's rows, its weekday heads, the week view's columns, the header's week range, the day a span that wraps into a new row shows its title on, and the header's date popover all start there. The popover used to take date-fns's own week start for the tag, which is not CLDR's for every tag (date-fns reads `es-MX` as `es`, a Monday start, where CLDR starts Mexico's week on Sunday) and which read Sunday until the date-fns locale had loaded.
  - **The object timeline's "This week" and "Next week" start on the display locale's first day.** The bucket bounds are also stepped on the local calendar now, so across a DST change the day after it is "Tomorrow" again, and the first day of next week no longer falls into "This week".
  
  A host that relied on the calendar always starting on Sunday, or on the timeline's week always starting on Monday, now sees the locale's first day. The gantt variant's `week` axis is unchanged: it still counts plan weeks from the axis's first day.
- c910630: The timeline's unused "Overdue" bucket label is removed: `timeline.bucket.overdue` is gone from all ten language packs and from the timeline's built-in English defaults (objectui#11676).
  
  Nothing has read the key since a past date on a timeline went under "Earlier". No timeline heads a group "Overdue": a date is overdue only when it is a due date and the record is still open, and a timeline declares neither fact. Overdue records are still marked where record state lives: the date cell's due treatment, the gantt's alert colour and conditional formatting.
  
  **Narrowed public surface (`@object-ui/i18n`).** The exported `en` pack and the `TranslationKeys` type derived from it lose one member, `timeline.bucket.overdue`. Code that reads `en.timeline.bucket.overdue`, or passes that key to `t()` expecting a translation, has to drop it. This is released as `minor` under objectui's version policy, which keeps the major aligned with `@objectstack`. The date cell's "Overdue 3d" phrase is a different key, `fields.relativeDate.overdue`, and stays in every pack.
- ce464d9: An object-bound timeline no longer heads every past date "Overdue": a day before today goes under a neutral "Earlier" bucket, translated in every language (objectui#11676).
  
  Without a `groupByField`, `ObjectTimeline` groups its entries into date buckets, and every day before today went under "Overdue", whatever the date meant. The showcase's Activity Timeline, bound to `created_at`, put all ten tasks under "Overdue", the two Done ones included. A creation date cannot be overdue, and a closed record cannot be either.
  
  "Overdue" needs two facts: that the date is a due date, and that the record is still open. Nothing the timeline reads declares either one. The timeline configuration (`startDateField`, `endDateField`, `titleField`, `groupByField`, `colorField`, `scale`) names no due-date role, and no field option marks a closed state. So a past day is now "Earlier", and the timeline does not guess either fact from a field name or a status value. Today, Tomorrow, This week, Next week, Later and No date are unchanged.
  
  **Widened public surface (`@object-ui/i18n`).** One new key in all ten language packs, `timeline.bucket.earlier`, so the exported `en` pack and the `TranslationKeys` type derived from it gain one member. The timeline no longer reads `timeline.bucket.overdue`, and this release also removes that key from every pack (the "Overdue" bucket label retirement entry). No component prop or exported type changes.
- 834c559: An empty list's copy no longer contradicts the page it sits on (objectui#11687).
  
  An identity list (an object managed by the authentication provider) said its records are "not added by hand here", even beside an "Invite User" or "Register OAuth Application" button on the same page. The console now asks whether the page offers a way to add a row: its New button, or a toolbar action the page draws, judged by the same placement, capability and `visible` gates the toolbar applies. When it does, the identity copy is not used and the list shows its own empty state instead. When the toolbar action is hidden (for example a multi-organization-only Invite User in a single-organization deployment), the identity copy stays. The Teams list keeps its own copy, which already names its Create Team button.
  
  A list view emptied by its own declared filter said "No records match your current filters or search." when no filter or search had been applied. That message is now said only when the user applied a filter or a search. A view emptied by its own filter alone keeps the "No matching records" title and reads "No records match this view’s filter.", through a new `list.viewFilterNoMatchesMessage` key in all ten language packs and in `LIST_DEFAULT_TRANSLATIONS`. A list with no filter at all still gets the first-run copy.
- 22b503c: Read-only boolean values, the boolean list face and the Home greeting's punctuation follow the language (objectui#11689).
  
  Under zh-CN a record showed its boolean values as "Yes" / "No", and the Home greeting joined a Chinese greeting to the person's name with an ASCII comma and closed it with an ASCII period.
  
  - **Booleans.** The read-only surfaces that draw a boolean as a word now read the existing `common.yes` / `common.no` keys: `BooleanField`'s readonly display, a `FormulaField` whose `returnType` is `boolean`, the lookup column's plain-text fallback, and the record-detail highlights chip. zh-CN shows the Chinese words; English is unchanged. Without an `I18nProvider` the words stay "Yes" / "No".
  - **The boolean list face.** `BooleanCellRenderer`, which every list surface draws, spelled its status badge ("Active — Off") and its completion indicator's accessible names ("Completed" / "Not completed") in English. All three now come from the language packs. The grid also handed that face the authored field label while its header printed the translated one, so the badge named the column in the authored language under a translated header. The face now receives the label the header prints.
  - **Greeting.** The comma before the name and the closing mark are two new keys, so zh-CN reads the full-width comma and full stop, Japanese its own marks and Arabic its own comma. English is unchanged, and the name keeps its own colour.
  
  **Widened public surface.**
  
  - `@object-ui/i18n`: five new keys in all ten language packs, so the exported `en` pack and the `TranslationKeys` type derived from it gain `home.greetingSeparator`, `home.greetingEnd`, `fields.boolean.offBadge`, `fields.boolean.completed` and `fields.boolean.notCompleted`.
  - `@object-ui/fields`: a new export, `useBooleanValueLabel()`, with its type `BooleanValueLabel`. It returns the current language's word for a boolean value, and `@object-ui/plugin-detail`'s highlights chip reads it.
- d50f724: Dates and times render in the time zone the server answers for the signed-in workspace (objectui#11693).
  
  `GET /api/v1/auth/me/localization` answers `timezone` beside `currency` and `locale`, and the console kept only the other two. It now carries all three, and every date and datetime face built on the shared date-display functions of `@object-ui/core` (field cells, grid and card dates, gantt tooltips, dataset measures, data-table cells) renders an instant in that zone. A date-only value still names the day it stores, whatever the zone. With no zone, every face renders in the viewer's own zone, as before.
  
  The zone is whatever the endpoint answers. A server that answers a zone for a workspace that configured none (objectstack's localization cascade answers `UTC` in that case) moves that workspace's datetimes into that zone.
  
  - **`@object-ui/core`**: `setDisplayTimeZone(timeZone)`, `getDisplayTimeZone()` and `subscribeDisplayTimeZone(listener)` declare and read the zone the date faces render instants in. An IANA name the runtime's `Intl` does not know clears it, with a console warning, instead of making every face throw.
  - **`@object-ui/i18n`**: `LocalizationValue` gains `timezone`. `LocalizationProvider` hands it to the date faces, and `useLocalization().timezone` reads back the zone they render in.
  - Renderers that format dates with their own `Intl` options rather than through the shared functions do not take the zone yet.
- 17acfbb: A record delete confirmation now names what it deletes and confirms with a destructive "Delete" button (objectui#11695).
  
  Deleting a row from an object list, a selection of rows, or a record from its own page opened a dialog titled "Confirm Action" with a "Continue" button in the primary style, and nothing in it said which record was about to go. The dialog now:
  
  - titles one record by the object label and the record's display name, for example `Delete Product "QA Widget 0"?`. The name comes from the same resolver the record header and lookups use, so an object's declared `nameField` is honoured;
  - titles a selection by its size and the object label, for example `Delete 3 Product records?`;
  - labels its confirm button "Delete" and paints it in the destructive button style.
  
  The body is unchanged: the plain delete question, the batch question, or, for a package-owned permission set, the reset question from ADR-0094. The record page's Delete now asks that same question, so a package-owned permission set deleted from its own page also gets the reset question instead of the plain one.
  
  The three dialogs (the console list's row and bulk Delete, the record page's Delete, and the registered `object-view`'s grid Delete) take this copy from one place:
  
  - `@object-ui/core`: `recordDelete.confirmCopy(deps, target)` returns `{ title, message, confirmText }` for one record (`{ record }`) or a batch (`{ count }`). The `ConfirmationHandler` options gain `destructive?: boolean`.
  - `@object-ui/app-shell`: `ActionConfirmDialog` paints the confirm button destructive when `options.destructive` is set. `useObjectActions` accepts `objectDef` and returns `deleteRecords(records)` for a confirmed batch delete. `deleteRecord` now asks through `onConfirm` with the full copy before the delete runs, rather than through the action runner's one-argument confirm. The console list passes its translated object label, so the delete toasts read the same label the page header shows.
  - `@object-ui/i18n`: new keys in all ten packs: `objectActions.deleteConfirmTitle`, the `objectActions.bulkDeleteConfirmTitle` count family, and `objectActions.deleteConfirmButton`.
  
  Other confirmations are unchanged. They keep the `actionConfirm.*` title and "Continue" button and the primary style.
- 6be0f7a: Object list pages are titled with the object's plural label (objectui#11696).
  
  A list page read "Project" while the nav entry that opens it read "Projects", and the breadcrumb read "Project ▾". The object's `pluralLabel` was declared by the spec, served on every object document and carried into the client translation bundle, but no console surface resolved it.
  
  - **`useObjectLabel().objectPluralLabel(objectDef)`** (`@object-ui/i18n`) — new member beside `objectLabel`. It returns the translated plural (`{ns}.objects.{objectName}.pluralLabel`), else the declared `objectDef.pluralLabel`, else the singular as `objectLabel` resolves it, so an object that declares no plural keeps its label. The first two steps match how `translateObject` in `@objectstack/spec` serves `pluralLabel` from `/meta`: a bundle that translates `label` but not `pluralLabel` shows the declared plural, here as on every other consumer.
  - **The list page titles** read the plural: the object list (`ObjectView`'s page header) and the object's `/data` page (`ObjectDataPage`'s page header, the URL-defined data slice badged "Data").
  - **The object breadcrumb** reads the plural: the object segment, its "Switch Object" entries, and the object crumbs of a record's ancestor trail. Each links to an object list, so the segment stays plural when the trail continues into a record ("Projects › Apollo").
  
  The record page, the record drawer (including the one the `/data` page opens), and "New" actions keep the singular.
- ded4494: The organization Settings page no longer offers a slug edit the framework will refuse (objectui#11720). From framework 17.7.0, better-auth's organization update refuses a new slug with `403` while the organization has an environment that is neither archived nor failed, and every cloud organization is born with its production environment, so every owner's slug edit on this page failed as a toast. The page now asks the data API for the organization's `sys_environment` rows, counted the way that guard counts them. While one counts, the slug renders read-only with a note that says why: a rename also moves the environments' subdomains.
  
  **Behaviour change.** A save sends `slug` only when it changed. A name-only save therefore carries no slug, so it answers `200` on every host, and a stale form can no longer write back a slug that was renamed elsewhere. A single-environment runtime (one whose runtime config serves `singleEnvironment: true`, as the CLI's `os serve` does) has no `sys_environment` object, so the page does not ask there at all. On any other host without that object the read is refused. Either way the field stays editable, and a changed slug goes out in the same single update call as before. The refused read is one extra request per owner visit to the page.
  
  **Clause-②: yes (widening)** — the `en` pack of `@object-ui/i18n`, and with it `TranslationKeys`, gains `organization.settings.slugLockedNote`, translated in all ten packs. No export, prop or schema key is added; the environment read stays module-private.
- 3bf8894: The console asks an administrator once to set the workspace timezone while it is still the platform default, pre-filled with the browser's zone (objectui#11758, the gate the objectui#11693 ruling put on rendering instants in the workspace's zone).
  
  - **When it asks.** On opening an app, when `localization.timezone` resolves from the manifest default (no env, global or tenant value, and not locked), the session holds the localization manifest's `writePermission`, and the browser reports a zone the settings door admits: the manifest's declared `iana_time_zone` domain, judged by `isValueDomainMember` from `@objectstack/spec/shared`. A session that may not write settings is never asked, and reads nothing beyond the settings list.
  - **Once.** The prompt is recorded as shown, on this device, per administrator and per workspace, at the moment it opens. It does not ask again there, whatever the answer.
  - **Confirm** writes `localization.timezone` with the chosen zone through the Settings page's own save (`PUT /api/settings/localization`), so the same permission check and audit apply, and a refused zone shows in the field as it does on the Settings page. **Decline**, or closing the dialog, writes nothing.
  - The zone is edited in the Settings page's own timezone field: any IANA zone can be typed, with the curated zones as suggestions.
  
  New language-pack keys in `@object-ui/i18n`, in all ten packs: `console.workspaceTimezonePrompt.title`, `.description` (interpolates `{{current}}`), `.laterHint`, `.decline`, `.confirm` and `.saved` (interpolates `{{zone}}`). No export, prop or type member is added.
- 1e1f09e: The list filter builder starts on the view's first column, hides hidden fields, and offers one empty check where "empty" and "null" mean the same records (objectui#11810).
  
  - **Field list.** The list view's Filter panel no longer offers a field the object definition marks `hidden: true` (Organization, Owning Business Unit, the search index). Its fields follow the view's columns in the order the grid shows them, then the other business fields, then the system fields (created / modified / owner). A hidden field stays listed only when the view names it in `filterableFields`, or when a condition the panel already holds filters on it, so a restored filter still shows its field.
  - **"Add filter".** A new condition starts on the view's first visible column instead of the hidden Organization field.
  - **Empty checks.** On a column whose type cannot hold an empty value other than null (select, lookup, number, date and the other "null only" types of `@objectstack/spec`'s `expandEmptyOperator`), the operator list offers "Is empty" / "Is not empty" and no longer "Is null" / "Is not null": there they match the same records. Text columns and list-valued columns keep both pairs, and the operator list says how they differ ("Is empty" also matches blank text, or an empty list). A stored "Is null" condition on such a column still loads and shows as "Is null". Every `FilterBuilder` consumer gets this offer; what a row can hold (`operatorsForFieldType`) is unchanged.
  
  `@object-ui/i18n` gains two language-pack keys in all ten packs, `filterBuilder.emptyCheckHint.text` and `filterBuilder.emptyCheckHint.list`, which carry that hint. No export, prop or type member is added.
  
  `@object-ui/components` raises its `@objectstack/spec` floor from `^17.0.0` to `^17.5.0`, because its published entry now imports `expandEmptyOperator`, which the spec first exports in 17.5.0.
- 455c646: A record action greyed out by its declared `disabled` predicate now says why (objectui#11811). It shows the reason "Not available for this record", and the same text is its accessible description (`aria-describedby`), so a screen reader announces it too. Before, the action carried no tooltip, no `title` and no description, so a user could not learn why it was off.
  
  Where it shows:
  
  - **The record page header** (`page:header`, `@object-ui/components`). On an inline action button, hovering it or focusing it from the keyboard opens a tooltip with the reason. On an action in the ⋯ overflow menu, the reason is a second line under the label. A tooltip there could not be reached from the keyboard, because the menu skips a disabled item and traps Tab.
  - **The `record:quick_actions` bar** (`@object-ui/plugin-detail`), for example a record page's section bar. Hovering or focusing the button opens the tooltip.
  - **The `DeclaredActionsBar`** (`@object-ui/app-shell`), which renders server-declared actions on the approvals surfaces. Hovering or focusing the button opens the tooltip.
  
  A natively disabled button receives no pointer or focus events, so the tooltip's trigger is a focusable wrapper around the button, the pattern Radix documents for a disabled trigger.
  
  What stays unchanged: a button greyed out only while its own action runs shows no reason. So do the header's Edit and Delete that the console injects, whose `disabled` the host computes (for example while the record is locked for approval), and a header action greyed out by a live inline-edit session.
  
  The reason is the same generic sentence for every action. An author-written reason beside the predicate would be a new key on the action spec, which is objectstack's to declare. It is not part of this change.
  
  **Clause-②: yes (widening).** `@object-ui/i18n` gains one language-pack key, `actions.notAvailableForRecord`, translated in all ten packs. No export, prop or type member is added, removed or changed.
- 7ebff39: The Studio landing (`/studio`) gets the console's own header (objectui#11863). Its old header held one control, the product wordmark linking back to Home. It now mounts `AppHeader` with `variant="studio"`: the brand logo, then a fixed "Studio" crumb, then the header's right-hand cluster as on Home and the Workspaces page (the inbox, help, and the account menu with profile, theme, language and sign-out). The brand links to the declared landing (`useHomePath()`), as the wordmark did, so the landing and the Studio builder's Home button still name one home. No command palette is mounted on `/studio`, so the header shows no search trigger there.
  
  **Note added 2026-10-09 (objectui#11863 Q2, PR objectui#12044):** the last sentence above no longer holds. From objectui#11863 Q2 the landing mounts the command palette in its `studio` scope, so the header draws the search trigger and `⌘K` opens the palette; see `.changeset/11863-studio-search.md`.
  
  **Clause-②: yes (widening; and one narrowing in `@object-ui/i18n`).** `AppHeader`'s `variant` prop accepts a fourth member, `'studio'`, beside `'app'`, `'home'` and `'orgs'`. It draws the brand and a fixed crumb, as `'orgs'` does. The union is not exported by name (the package entry exports `AppHeader` only), so a host meets it as the prop's type: a host that switches exhaustively over that type must handle `'studio'`. A call that passes no `variant` resolves it as before (`'app'` with an `appName`, `'home'` without). No export is added or removed.
  
  `@object-ui/i18n`: each of the ten packs gains `console.studio.title` ("Studio", a product name every pack writes as is), the crumb's label, and drops `console.studio.backToHome`, the retired wordmark's tooltip, which nothing reads any more.
  
  **Narrowed public surface (`@object-ui/i18n`).** The exported `en` pack and the `TranslationKeys` type derived from it lose one member, `console.studio.backToHome`. Code that reads `en.console.studio.backToHome`, or passes that key to `t()` expecting a translation, has to drop it. This is released as `minor` under objectui's version policy, which keeps the major aligned with `@objectstack`.
- fbad078: The Import Wizard's preview checks a `time` column, and the user import's email column, the way the server's import judges them, so the import button no longer counts rows the server then refuses (objectui#11913).
  
  - **A `time` column is checked.** A cell is marked where the server's `parseDateCell` reads no time of day from it and the import refuses it with `invalid_time`. The server takes a wall clock (`10:00`, `09:30:15`), an ISO 8601 day or date-time (stored as its UTC time of day) and a year-first date. It refuses `25:00`, `abc`, `10:00Z` and `9am`, and the preview now marks them with the sentence `"{{value}}" is not a valid time` (in English). An `invalid_time` row error from the server's dry run (Validate data) is shown with the same sentence.
  - **The user import's email column is checked by the user import endpoint's rule.** That endpoint refuses an address that is not printable ASCII, is longer than 254 characters, or sits on the placeholder domain, with `INVALID_EMAIL`. The column used to reach the wizard typed as text, so the preview checked nothing there. It is now typed `email` and checked by that rule instead of the record validator's. The two rules differ both ways: the record rule takes a non-ASCII domain such as `735431496@柴仟.com`, and the endpoint's rule takes `a@b..c`.
  
  Additions to the published surface:
  
  - `@object-ui/plugin-grid`: `ImportWizardProps['fields'][number]` gains an optional `emailRule?: 'identity'`. Left out, an `email` column is checked by the record validator's rule, as before. Set to `'identity'`, it is checked by the user import endpoint's rule.
  - `@object-ui/i18n`: every language pack gains `grid.import.invalidTime`, with a `{{value}}` placeholder.
- 45d5853: New SDUI widget `cloud:workspace-timezone-notice`: one line on the Cloud welcome page naming the timezone a workspace was seeded with at creation (objectui#11930, the objectui half of objectstack-ai/cloud#2676).
  
  **Clause-②: yes** — four published surfaces widen, and nothing that parsed or rendered before changes:
  
  - the accept set of `AnyComponentSchema`, and so of `safeValidateSchema` and `objectui validate`, widens by one `type` literal, `cloud:workspace-timezone-notice`. `@object-ui/types/zod` exports one new schema, `CloudWorkspaceTimezoneNoticeSchema`, and `@object-ui/types` exports its TypeScript twin of the same name, a member of `AnySchema`;
  - `@object-ui/i18n` adds one key, `cloudWorkspaceTimezoneNotice.seeded`, to all ten locale packs;
  - `@object-ui/cli`: `objectui check` knows `cloud:workspace-timezone-notice` as a registered type;
  - `@object-ui/app-shell` registers the widget, and its `sideEffects` array names the new module in its source and published spellings.
  
  **Why.** The welcome page is static metadata, and nothing in a page's expression scope carries a per-organization value, so the page could not say which timezone the workspace was created with. The seed is available only from the org-scoped `GET /cloud/environment-entitlements` summary, as the additive `workspaceTimezoneSeed` string.
  
  **What changed, in observable terms.**
  
  - A page places the node with no props: `{ "type": "cloud:workspace-timezone-notice" }`. The widget reads the summary through the hook the environment list already uses, and when the summary carries `workspaceTimezoneSeed` it renders one muted line naming that zone, verbatim. In English: "The environment timezone was set to Asia/Shanghai from your browser when the environment was created. You can change it in Settings → Localization."
  - It renders nothing when the summary carries no seed (workspaces created before the seed existed, and control planes that do not send it yet), while the summary loads, when the request fails or rejects, and when the body is not the `{ success, data }` envelope. A failed request does not throw.
  - The line is text only: no link and no dismissal state.
  - The node's `className` and `responsiveStyles` reach the line.
  - The widget is registered under one key, `cloud:workspace-timezone-notice`. There is no bare `workspace-timezone-notice` fallback and no `app-shell:`-prefixed twin.
  - `CloudWorkspaceTimezoneNoticeSchema` takes no prop: `properties` is optional and may only be `{}`, so any key in the bag, the zone included, is refused at `properties`. `body` and `children` are refused by name, because the widget reads neither.
- 6d5eb34: The chat build panel reads cloud's post-apply verification loop, and an unknown build phase no longer reads as "Building" (objectui#11988, the receiver objectstack-ai/cloud#2172's ruling A orders).
  
  After `apply_blueprint` finishes, cloud's agent loop reports its verification hops on a second `data-build-progress` part with the id `build-verify`, beside the build tree. A hop is `{ phase: 'verify', hop, tool }` and the exit is `{ phase: 'done' }`. The receiver used to take the last `data-build-progress` part whatever its id, and turned every phase other than `data` and `done` into `structure`. So the first verification hop replaced the finished tree with "Building your app…".
  
  - **The tree and the verification part are read apart, by part id.** The `build-verify` part never displaces the tree, whichever order the two parts arrive in. A message that carries only the tree maps and renders exactly as before.
  - **The build panel shows a verification line under the tree.** It reads "Checking the change… step N" while a hop runs, with the hop's tool name as its tooltip, and "Checked the change" once the `done` frame arrives. A `build-verify` part on a message that has no build tree is not drawn as a tree.
  - **Phases are read against the spec's vocabulary.** The receiver's phase table and frame type are typed by `@objectstack/spec/ai`'s own `BuildProgressPhase` and `BUILD_PROGRESS_FRAME_TYPE`, so a phase the spec adds or drops fails the type check here instead of drifting. The spec's runtime module is not imported, because it would put its whole AI schema module on the console's first load. A phase outside the vocabulary, or a frame without one, is now `unknown` and shows as a warning line ("Unknown build phase") on the tree header or on the verification line. It is no longer coerced to `structure`.
  - **Type change.** `ChatBuildProgress.phase`, reached through `ChatMessage['buildProgress']`, widens from `'structure' | 'data' | 'done'` to `'structure' | 'data' | 'verify' | 'done' | 'unknown'`: the spec's phase vocabulary plus `'unknown'`, held equal to the spec's union by a compile-time test. `ChatBuildProgress` also gains an optional `verify` member, `{ phase, hop?, tool? }`. The published typings name no new `@objectstack/spec` symbol, so the package's spec range is unchanged.
  - **New language-pack keys, in all ten packs:** `chatbot.build.verifying`, `chatbot.build.verifyStep`, `chatbot.build.verified` and `chatbot.build.unknownPhase`.
- c5406c2: The ten locale packs follow `@objectstack/spec` 18's platform capability set (objectui#12030): the key `capability.label.manage_org_presentation` is replaced by `capability.label.manage_mailboxes`, as spec 18 retires `manage_org_presentation` from `PLATFORM_CAPABILITIES` and adds `manage_mailboxes`.
  
  **For consumers:** a reader of `capability.label.manage_org_presentation` now gets no translation, and the exported `TranslationKeys` type loses that key and gains the new one. Scored `minor`, not `patch`, because a key a consumer could read is replaced; objectui's own breaking changes ship as `minor` (AGENTS.md §版本号策略).
- 2571a3e: A caller without Studio access who opens a Studio URL (`/studio`, a package's pillar builder, or the package-less scope) is told why (objectui#12035). The console's Studio entry gate used to send such a caller home with no word of why, so a missing capability read exactly like a broken link. It now stays at the URL that was opened and shows one sentence, "You need Studio access to open Studio.", with a "Back to home" link drawn as a button. This is the shape the console already uses for an app the caller may not open. The link leads to the same home the redirect used to land on: the declared landing, or the launcher where none is declared. A reload or a shared link shows the same answer for the same caller, and the caller can send the URL to an administrator and reload once access is granted.
  
  Who may enter Studio is unchanged: the gate still requires `studio.access`, decides before the Studio builder is downloaded, and keeps its loading splash and its retryable error screen. A caller with access enters Studio as before.
  
  **Clause-②: yes (widening).** `@object-ui/i18n` gains one key in all ten packs, `console.studio.accessRequired`, the sentence above, so the exported `en` pack and the `TranslationKeys` type derived from it gain one member. No key is removed or renamed. The link reuses `empty.appAccessDeniedHome` for its label.
- 8a55f0c: The console sidebar no longer lets a user drag the app's menu into a private order; the Pinned section is now the one place a user orders entries (objectui#12059). Arranging an app's navigation is Studio's job: the menu is drawn in the order authored for the app, and every user sees that order. This reverses objectui#11626, which had extended menu drag-to-reorder to grouped menus.
  
  **`@object-ui/layout` (breaking, declared `minor` per the version policy).** `NavigationRenderer` retires `enableReorder` and `onReorder`, and with them every sortable path through the menu: no menu row draws a grip or carries a sortable role. `AppSchemaRenderer` retires the same two props, which only handed them through. Two props are added for the pinned section: `pinnedOrder` (the pinned entry ids in the user's order; the section draws in that order, an unnamed pinned entry following in menu order) and `onPinnedReorder` (makes the pinned rows sortable and receives the drawn ids in their new order). A pinned row is dragged by the row itself: no grip at rest, a grab cursor, and a line marking where the row will land. From the keyboard, with the row's link focused, Space picks it up, the arrow keys move it, Space drops it and Escape cancels; Enter still follows the link. The row's link stays a link and the row's one focus stop. The click a pointer drag ends with is not followed.
  
  **`@object-ui/app-shell`.** The sidebar no longer reads or writes the per-user menu order it kept in localStorage (`objectui-nav-order-APP`); a key left from before is ignored. The pinned order is stored with the pins, in the `UserDataAdapter`-backed favorites, so it syncs across devices the way the pins do: it is the order of the `type: 'nav'` entries in the stored list. A new pin now joins the end of that order (a content favorite still goes first), and an unpin leaves the others in order. `useFavorites()` gains `reorderNavPins(navIds)`, which puts the named pins in a new order in the places they already hold, so a pin another app's sidebar draws and every content favorite stay put; `useNavPins()` gains `reorderPins(orderedIds)` over it, and its `pinnedIds` lists the pins in the user's order. At the nav-pin cap a new pin still joins the end and the earliest-pinned one rolls off. Pins made before this change are now drawn in their stored order, which is newest first (a pin used to be put at the front of the list), rather than in menu order, until the user drags them.
  
  **`@object-ui/i18n` (breaking, declared `minor`).** `console.nav.dragToReorder`, the label of the retired menu grip, is removed from all ten packs. `view.dragToReorder` is a different key and stays.
  
  **Clause-②: yes.** Published surface changes: `NavigationRendererProps` loses `enableReorder` / `onReorder` and gains `pinnedOrder` / `onPinnedReorder`; `AppSchemaRendererProps` loses `enableReorder` / `onReorder`; the return of `useFavorites()` gains `reorderNavPins`; the return of `useNavPins()` gains `reorderPins`; the `console.nav.dragToReorder` pack key leaves.
- 20c6d35: The approval decision panel draws a short notice instead of nothing when it is placed anywhere other than an approval request's record page (objectui#12072).
  
  - **`@object-ui/app-shell`.** Off a `sys_approval_request` record page, that is on another object's record page or on a page with no record at all, the decision panel (the renderer proposed as `record:approval_decision`, still module-internal) now draws a muted notice saying it works only on approval request pages. A misplaced block is therefore visible to its author instead of silently empty. On a request page whose record has not loaded yet it still draws nothing, and on a request page with its record it draws the panel as before. This replaces the clause of objectui#12045's entry that says the panel renders nothing outside a request page.
  - **`@object-ui/i18n`.** One new language-pack key for that notice, `approvalsInbox.decisionPanelOffRequestPage`, in all ten packs.
  
  **Clause-②: yes (widening).** The published language packs gain one key, `approvalsInbox.decisionPanelOffRequestPage`, so the exported `en` pack and the `TranslationKeys` type read off it gain that one member. No export or prop is added or removed, and no existing key changes.
- 69bca0a: A paged grid's column footer reads the whole matched set, or says it reads the page (objectui#12081 item 3).
  
  Under server paging a grid holds one page of the matched set, and the footer summed that page and drew the figure beside the count of the whole set: "Planned Amount: Sum: 3,685,900.00 · 300 records", where the 300 rows sum to 40,607,000. Every footer aggregate had the same fault (`count`, `avg`, `min`, `max`, the filled, empty and unique counts, and the two percents).
  
  - **The whole set's figures, from the server.** When the rows are one page of more, the grid asks for the figures in ONE aggregate query through the data source's `queryGroupHeaders`, with no `groupBy`. The query is the one behind the rows: its filter, search and search fields, without its page, sort or projection. Turning the page or sorting asks nothing. A refresh or a write to the object asks again. These figures are the server's, so "empty" means a stored `null`. This holds both when the grid fetches its own rows and when a host such as `ListView` hands it one page with `manualPagination`, `rowCount` and `findParams`.
  - **Otherwise, the page's figure, labelled as the page's.** The grid uses the answer only when its row count equals the count the grid shows. Otherwise the footer shows the page's figure as `Sum (this page): 32,500`. That happens when the data source has no `queryGroupHeaders`, refuses the query or answers without one row, when the query carries a key this read cannot repeat, and when the count shown is an estimate. The platform's paged count under a search is one.
  - **Unchanged:** rows handed in whole, and a grid whose one page holds every match, keep the footer they had and ask the server nothing. A grid whose columns declare no summary that maps to an aggregate (none at all, only `none`, or only unknown members) asks nothing either: it has no footer. `useColumnSummary` keeps its signature and still summarises the rows it is handed.
  
  Added: one language-pack key, `grid.summary.pagePattern`, in all ten packs. The `DataSource.queryGroupHeaders` doc comment now says what the same query with no `groupBy` answers. No export, prop or type member is added.
- 3c0f806: After a marketplace install into the environment the console is rendering, the package page waits until that environment serves the installed package's app, and only then refreshes and persists the app list (objectui#12087).
  
  A cloud install answers once the control plane has written the installation. The environment's runtime then rebuilds its kernel and keeps serving the kernel from before the install until the rebuild lands (about 60 s, measured on staging). The page used to refresh the metadata cache the moment the install answered. That refresh read the pre-install app list, and the cache kept it, in memory and in the tab's session seed. The page said "Installed successfully", and the app never appeared in that tab.
  
  - **Wait.** The page reads `GET /meta/app` past the cache, at once and then every 5 s for up to 5 minutes, until an app's `_packageId` is the package's manifest id. Only then does it drop the session seed, refresh the cache and send the metadata-changed signal. No app list read during the wait is persisted. The 5 minutes bound the wait; they do not estimate the rebuild.
  - **Say what is happening.** Until the app is served, the dialog, and the page once the dialog is closed, show "Deploying the app…" (「正在部署应用…」). When it is served, they show that the app is ready and offer "Open {name}" (「打开 {name}」).
  - **Say what is not known.** When the wait expires, the page says the install was recorded but the app has not appeared yet, names the possible reasons, and offers "Check again". It does not claim success, and it refreshes nothing.
  - The install-time suggested audience bindings mount once the app is served, so their one read reaches the rebuilt runtime.
  - An install into another environment shows the same success message as before. It no longer refreshes this console's own metadata, which that install did not change.
  
  Five language-pack keys are added under `marketplace.install` (`deploying`, `deployed`, `openApp`, `deployTimeout`, `checkAgain`), in all ten packs. The exported `en` pack, and the `TranslationKeys` type derived from it (`typeof en`, exported from the `@object-ui/i18n` entry), gain these five members under `marketplace.install`, which is why `@object-ui/i18n` is a minor bump. No export, prop or type on the `@object-ui/app-shell` entry changes.
- 1071393: The Marketplace's install answers now say what the runtime served (objectui#12098).
  
  - **An install-local answered `hotLoaded: false`.** The runtime installed the package, but its running kernel could not register it (objectstack#22695, the lenient path for a cloud-fetched manifest). The package loads at the runtime's next restart. The package page used to say the app "should now appear in the app switcher" and refresh the app list. The catalog's "Your organization" strip said "Installed {name}" and sent the metadata-refresh signal. Both now say: installed, loads when the runtime next restarts, not in the app switcher until then. Neither refreshes the app list. `hotLoaded: true` is unchanged.
  - **An upgrade waits for the new version's app.** After a cloud install into this environment, the console waits until the runtime serves the package's app (objectui#12087). On an upgrade, the stale kernel still serves the OLD version's app under the same `_packageId`, so the wait ended on its first read and the console kept the pre-upgrade list. The runtime now stamps each app it registers with `_packageVersion` (objectstack#22689). The wait now also matches the version that the install answer names (`installation.version`). An app served without `_packageVersion` (a runtime from before that change) is accepted on its id, as before. An answer that names no version waits on the id alone. The catalog strip's wait matches the version the same way.
  
  **Locale key.** `marketplace.install.localLoadsAtRestart`, in all ten packs. `TranslationKeys` gains it.
  
  **Clause-②: yes (widening)**: one locale key added to `@object-ui/i18n`'s published packs, which widens `TranslationKeys`. No export, prop or schema key is added, and no spec type is imported.
- b7cd5c8: A create form says when the server will fill a field: "Set automatically when saved." under a field whose `defaultValue` the server resolves at insert, while the field is empty (objectui#12108).
  
  A `defaultValue` that is a CEL expression (`{ dialect: 'cel', source: 'today()' }`) or a runtime token (`NOW()`, `current_user`) is an instruction, not a value. The client cannot evaluate it, so a create form leaves the field empty and leaves it out of the submit, and the server fills it at insert. Until now the field opened empty, or on "Select an option", with nothing saying a value was coming.
  
  - **Where it shows.** In the field's description slot, after any `description` the field declares, in every object-form layout (`ObjectForm`, `ModalForm`, `DrawerForm`, `TabbedForm`, `SplitForm`, `WizardForm`), under any field widget: the form draws it, not the widget. The control's `aria-describedby` already names that element, so a screen reader reads the hint with the field.
  - **When it shows.** Exactly while the submit would leave the key out: the field is server-owned (`isServerOwnedValue`, the classifier that already lowers `required` on such a field) and its value is empty. A value the user types removes the hint and is saved instead.
  - **When it does not.** On an edit form; on a control that takes no input (disabled or read-only), which also keeps it off a `mode: 'view'` form; and on a boolean, which the form starts at `false`, so it is never empty.
  - **Required fields.** Measured unchanged: a `required` field with a CEL default does not block Save on a create form, shows no required marker, and is left out of the submit so the server fills it.
  - **Locale key.** `form.serverDefaultHint`, in all ten packs. `TranslationKeys` gains it.
  
  **Clause-②: yes (widening)**: one locale key added to `@object-ui/i18n`'s published packs, which widens `TranslationKeys`. No export, prop or schema key is added.
- dc6d28e: A paged table's first, previous, next and last page buttons have accessible names (objectui#12124).
  
  The `data-table` pager, which an ungrouped paged `ObjectGrid` draws, showed four icon buttons whose only content was a chevron, so a screen reader announced four unnamed buttons and could not tell them apart. Each button is now named in the viewer's language: "First page", "Previous page", "Next page" and "Last page" in English. Sighted use is unchanged. A grouped grid with more than one page of groups draws `ObjectGrid`'s own group pager instead, which this change does not name (objectui#12143).
  
  Added: four language-pack keys, `table.firstPage`, `table.previousPage`, `table.nextPage` and `table.lastPage`, in all ten packs, and the same four rows in the renderer's English defaults for a host with no `I18nProvider`. The exported `en` pack, and so `TranslationKeys`, gains the four `table` members; no export or prop is added.
- e723f58: Screen readers hear the names of more controls in the viewer's language (objectui#12145).
  
  These controls carried an English `aria-label`, so under a non-English locale a screen reader announced their names in English: the docs portal's loading spinner, the record form page's breadcrumb, the `Spinner` status region, a data table's row menu button, the `pagination` renderer's previous and next links, the image crop preview, the percent slider, the record picker's grid, the AI composer's send and stop button and an attachment's remove button, the designer's undo and redo buttons, minimap, version history and back button, a dismissible record alert's close button, the bulk-action bar, and the mobile view switcher. Each name now comes from the language packs. English names are unchanged, with two small exceptions: the spinner now reads "Loading…", and the pagination links read "Previous page" and "Next page", the same words the data table pager uses. Sighted use is unchanged.
  
  Added: eight language-pack keys in all ten packs: `help.loadingDocumentation`, `common.breadcrumb`, `table.rowActions`, `fields.image.cropPreview`, `fields.percent.slider`, `designer.canvasMinimap`, `designer.versionHistory` and `grid.bulkActions`. Every other name reuses a key that already holds the same words. The exported `en` pack, and so `TranslationKeys`, gains these eight members. `PromptInputAttachment` (exported through `AIElements`) takes an optional `removeLabel` prop that names its remove button; without it the button keeps its English name.
- 82bb1d5: The marketplace package page's **Update** button opens an update dialog, and a package README's raw HTML is no longer printed as text (objectui#12146).
  
  **The update dialog.** When this environment holds an older version of a package, the page's primary button reads "Update"; it used to open the install dialog unchanged, so an admin updating a package read "Install", saw no versions, got no word about a major-version jump, and was offered "Include sample data" with no explanation. The same dialog now opens as an update:
  
  - the title, description and primary button say update ("Update HotCRM", "Update the copy installed in this environment", "Update" / "Updating…");
  - it names the installed version and the version it moves to (`v3.1.0 → v4.0.1`), both the ones the page already shows;
  - a major-version jump adds one line saying so, with a link to the target version's release notes in the page's Versions panel (only when that version carries notes); following it closes the dialog and moves focus to those notes;
  - there is no "Include sample data" checkbox, and the update requests no sample data (`seedSampleData: false`). Sample data for an installed package stays with the page's own "Add sample data" action;
  - the result reads "Updated to v4.0.1", and a wait that expires says the update was recorded but the new version is not served yet.
  
  Installing a package this environment does not hold opens the dialog exactly as before.
  
  **README raw HTML.** The About card's markdown renderer printed a README's raw-HTML block (a centred logo paragraph, say) as literal text. It now recognises raw HTML by CommonMark's own grammar, the HTML-block start conditions and the inline raw-HTML forms, and skips it: neither rendered, since a README is third-party content, nor printed. HTML inside a code span or a fenced code block is code and still prints, and text that only looks like a tag (`a < b`, an angle-bracketed URL) stays text.
  
  **Locale keys.** `marketplace.update.dialogTitle`, `dialogDescCurrent`, `dialogDescPicker`, `majorNotice`, `releaseNotes`, `success` and `deployTimeout`, and `marketplace.action.updating`, in all ten packs.
  
  **Clause-②: yes (widening)**: eight locale keys added to `@object-ui/i18n`'s published packs, which widens `TranslationKeys`. No export, prop or accept set moves.
- b231607: Every built-in locale pack gains one key, `form.maxFileSize` (objectui#12156). It is the size-limit hint the flat `ObjectForm` appends to the description of a `file` or `image` field that declares `maxSize`. Its value takes the formatted limit through `{{size}}`; in `en` it is "Max size: {{size}}". No other key is added, renamed or removed.
- 54159d3: The console boot screen says one honest line, and shows no English before the user's locale (objectui#12187, the first of its three fixes).
  
  `LoadingScreen` now draws the product name, one line ("Opening your console…", translated in all ten built-in packs) and a spinner. The three staged steps it walked on a 1200 ms timer, which tracked no real work, are gone, and so is the line about "setting up a new environment", which was never one. The error and retry block is unchanged.
  
  The screen takes its language from the `I18nProvider` (`useObjectTranslation().language`) instead of `document.documentElement.lang`. The provider writes that attribute after its children's first render, so a `zh-CN` browser saw the English copy on the first paint and kept seeing it until the step timer's first tick re-rendered the screen. The line is read off the active language's resident built-in catalogue. While that catalogue is not resident the line is left out rather than shown in English, and it appears when the catalogue lands.
  
  The splash's root element carries a `data-boot-splash` attribute in every state (loading, `message` and error), which is its language-independent hook for a readiness wait or smoke test that needs to know whether the splash is still up, since the line depends on the locale and can be absent.
  
  **Breaking: four keys are retired from all ten `@object-ui/i18n` built-in packs**, and `TranslationKeys` narrows with them:
  
  - `console.loadingSteps.connecting`: no replacement, the boot screen shows no steps.
  - `console.loadingSteps.loadingConfig`: no replacement, the boot screen shows no steps.
  - `console.loadingSteps.preparingWorkspace`: no replacement, the boot screen shows no steps.
  - `console.loadingHint`: no replacement, the boot screen shows no hint line.
  
  `console.initializing` keeps its key and carries the new line in every pack ("Initializing application…" becomes "Opening your console…"). An app that supplies its own values for the four retired keys can drop them: nothing reads them any more.
- fa778e6: A free-plan organization's environment list no longer offers a primary button that opens a paywall dialog (objectui#12190). The maintainer's rule is that no primary button opens a paywall (objectstack-ai/cloud#2775).
  
  **What changed, in observable terms.**
  
  - When the organization owns its production environment and its plan does not allow development environments (the entitlement summary's `development.canCreate` is `false`), the toolbar used to show a primary "Add environment" button whose click opened the "Development environments are a paid feature" dialog. It now shows an outline mark with a lock icon, "Development environments · Team plan and up" (zh 「开发环境 · 团队版起」), in place of the create action. The mark is a plain link to the entitlement summary's `upgradeUrl`, resolved the way the entitlement dialog resolves its upgrade link: a control-plane-relative path is prefixed with the control-plane origin, and an absolute URL opens in a new tab. It opens no dialog.
  - When the summary carries no `upgradeUrl`, no mark is drawn (objectui#12983: the control plane sends `upgradeUrl` only to a viewer who can upgrade). No URL is composed in the console (objectui#10437).
  - A `?runAction=create_environment` deep link in that state is still consumed (stripped from the URL), and now opens nothing: it used to open the same dialog.
  - The mark appears only where the create action would have rendered, so a create action filtered out by placement or by the capability gate still leaves no mark, as before.
  - Unchanged: the "Set up your production environment" and "Add development environment" states, the loading skeleton, and the dialog shown when the server refuses a create (`DEV_ENV_PLAN_LOCKED`, `DEV_ENV_LIMIT`, `PRODUCTION_ENV_LIMIT`).
  - The element's test id changes from `environment-add-upgrade` to `environment-development-locked`.
  
  **Locale packs (all ten).**
  
  - Added `planTier.teamAndUp`, the tier label, keyed by the tier so that every surface marking a plan-locked feature reuses it. zh: 「团队版起」, following the cloud control plane's zh plan label.
  - Added `environment.developmentLocked`, the mark's text, with a `{{tier}}` placeholder that the toolbar fills from `planTier.teamAndUp`.
  - Removed `environment.addEnvironment`: its one reader was the retired button.
  
  **Exports.** No export of `@object-ui/app-shell` changes. Two internal pieces the toolbar no longer uses are removed: the `upgradeDialogSpec` builder in `environment/entitlements.ts`, and the `onUpgrade` prop of the internal `EnvironmentListToolbar`, which `ObjectView` no longer passes. Neither was ever re-exported from the package entry.
  
  **Breaking for `@object-ui/i18n` consumers: `environment.addEnvironment` is removed.** The key is gone from all ten locale packs and from the published `TranslationKeys` type (`typeof en`). A consumer that calls `t('environment.addEnvironment')` now gets the key echoed back, and code that reads the key off a published pack object or off `TranslationKeys` no longer compiles. There is no replacement key: the "Add environment" button it labelled is retired. The plan-locked state's text is now `environment.developmentLocked`, and its `{{tier}}` placeholder is filled from `planTier.teamAndUp`. Both of those keys are added (listed above). Under this repository's version policy a breaking change is declared `minor` with the break described here, never `major`, so `@object-ui/i18n` is `minor`. `@object-ui/app-shell` stays `patch`: none of its exports changes.
- 7578323: A page route's breadcrumb no longer carries a 「Pages」 crumb (objectui#12198, executing the maintainer's ruling on objectstack-ai/cloud#2768). **BREAKING** for `@object-ui/i18n`: the pack key `console.breadcrumb.pages` is retired from all ten language packs, with no replacement.
  
  - **`@object-ui/app-shell`.** On `/apps/APP/page/NAME`, the top bar's trail used to read app › Pages › page (on the cloud home: Cloud › Pages › Home). 「Pages」 named a metadata type, not a place the user went, and its link only reopened the app's base, which the app pill already does. The trail now goes from the app pill straight to the page. Dashboard, report, system and object routes draw their trails as before.
  - **`@object-ui/i18n`.** `console.breadcrumb.pages` had one reader, the crumb above, and is removed from the `en`, `zh`, `ja`, `ko`, `de`, `fr`, `es`, `pt`, `ru` and `ar` packs. A host that looked the key up through the published packs now gets the key string back, and has nothing to read instead: no screen draws a type crumb ahead of a page any more. The other `console.breadcrumb.*` keys are unchanged.
  
  The Studio entries a page route offers — the page's pencil, the top bar's 「Edit app」 button and the app pill's Studio row — still need both the workspace-admin flag and the server-reported `manage_metadata` capability. That gate is unchanged; this release adds pins that a workspace admin without `manage_metadata` (an organization owner) and a plain member see none of the three.
  
  **Clause-②: no (narrowing).** One published pack key is removed; nothing is added and no accepted input widens.
- 38bb373: Console: the app's identity moves into the top bar (objectui#12201, the maintainer's ruling of 2026-10-12).
  
  - **One asset, drawn where the app is named.** `branding.logo` is the app's square icon. The top bar's app pill now draws it at 22 px left of the app's name, and every row of the app switcher draws its own app's logo at the same size. An app without `branding.logo` gets its `icon` (a lucide name) on a 22 px tile instead, so every row has a glyph. The tile takes the app's own `branding.primaryColor` when that is a hex (passed as CSS custom properties, with a dark-theme variant), and the neutral muted tile otherwise. A logo URL that fails to load falls back to the same tile.
  - **The sidebar logo header is gone.** `UnifiedSidebar` no longer draws `branding.logo` above the navigation (the header objectui#10827 added). On a phone, where the top bar hides the app pill, the drawer header shows the app's glyph (26 px) and name in place of the old Home row; its 「All apps」 button is still the way back to Home (`data-testid="mobile-sidebar-home"` is kept on it).
  - **Inside an app the top bar starts with the app.** The platform mark is no longer drawn in the `app` variant of `AppHeader`, and no path separator precedes the app pill. Home, the organizations pages and the Studio front door keep the mark. The way back to Home from an app is the switcher's new 「All apps」 row, which goes to the declared home (`useHomePath`).
  - **The PREVIEW stage chip** sits on the right, beside the search box, inside an app. On platform surfaces it stays beside the mark.
  - **The Studio entry has a label.** The icon-only hammer becomes an outline button 「Edit app」 with a pencil, at the left edge of the right-hand utility cluster. From the `lg` breakpoint up it shows the text; below that it is the pencil alone, named by its `aria-label` and `title`. Same gate (workspace admin and the server-reported metadata-authoring capability), same deep link, same `data-testid="app-design-in-studio-button"`. The switcher dropdown ends with an 「Edit APP in Studio」 row to the same target, shown to the same viewers.
  
  Public surface:
  
  - `@object-ui/app-shell`: `AppSwitcher` takes a new optional prop, `designInStudioPath?: string | null`. When set, the dropdown ends with the Studio row to that path. No export is added or removed.
  - `@object-ui/i18n`: three keys are added to all ten language packs: `topbar.editApp`, `layout.appSwitcher.allApps` and `layout.appSwitcher.editAppInStudio` (interpolates `app`). No key is removed. `topbar.designInStudio` stays, because the AI Live Canvas still reads it.
- 51c661e: The console's assistant button no longer covers the record page's inline-edit Save or an attachment's Download and Delete, and deleting an attachment asks first (objectui#12248).
  
  - **The assistant button steps aside.** It sits in the bottom-right corner of every page, and at common desktop widths the inline-edit bar's Save and, when the attachments panel is the page's last content, the last row's Delete land under it. A click there opened the assistant instead, and an inline save could be lost that way. The button is now hidden while one of those controls is under it, and it comes back as soon as the corner is free. The assistant stays reachable from the top bar and with Cmd/Ctrl+Shift+I. On a phone, where the button sits higher, nothing changes.
  - **`InlineEditSaveBar` marks its bar** with a `data-fab-yield` attribute, which a host's floating launcher can read. No prop or export is added.
  - **Attachment delete asks for confirmation** through the console's usual destructive confirm dialog, the one the record page's own Delete uses. The dialog names the file. Cancel deletes nothing.
  - **`@object-ui/i18n`:** one new key, `detail.deleteAttachmentConfirm`, in all ten language packs.
- 7af0ab3: The author of a comment on a record page can now edit and delete it from the record feed (objectui#12268).
  
  `sys_comment` declares the generic Edit and Delete affordances (`managedBy: 'platform'`), and the platform lets an author update and delete their own comment, but the record feed only offered reactions and replies. Now the author's own comment and reply show Edit and Delete. Nobody else sees either control on it.
  
  - **Edit** opens the comment's text in place. Save stores the new text and marks the comment edited; the row then shows the new text with the usual "(edited)" mark. If the server refuses, an error appears, the editor keeps the draft, and the comment keeps its previous text. A comment stored as edited reads as edited.
  - **Delete** asks first, through the console's usual destructive confirm dialog. Cancel deletes nothing. If the server refuses, an error appears and the comment stays.
  - **Replies outlive their comment on screen.** A reply whose comment the feed does not hold, because that comment was deleted or lies before the loaded page, now shows as a row of its own instead of disappearing, so deleting a comment no longer hides anyone's replies to it.
  - Each control appears only with the matching permission on `sys_comment` (update for Edit, delete for Delete). The server's own rule still decides every write.
  
  Published surface, all additive:
  
  - `@object-ui/collaboration`: new export `isCommentAuthor(authorId, viewerId)`, the owner rule `CommentThread` gates Edit and Delete on. Two missing or empty ids no longer count as a match.
  - `@object-ui/types`: `FeedItem.authoredByViewer?: boolean`, set by the host that read the row.
  - `@object-ui/react`: `DiscussionContextValue.onEditComment` and `onDeleteComment`.
  - `@object-ui/plugin-detail`: `onEditComment` and `onDeleteComment` on `RecordActivityTimelineProps`, `RecordChatterPanelProps` and `ThreadedRepliesProps`. A reply now shows the "(edited)" mark too.
  - `@object-ui/core`: two rows in the affordance-to-grant map, `feedCommentEdit` and `feedCommentDelete`.
  - `@object-ui/i18n`: five new `detail.*` keys in all ten language packs (`editComment`, `deleteComment`, `deleteCommentConfirm`, `commentEditFailed`, `commentDeleteFailed`).
- 9f282ef: A dashboard or report route's breadcrumb no longer carries a 「Dashboards」 or 「Reports」 crumb (objectui#12273, applying the maintainer's ruling on objectstack-ai/cloud#2768, as objectui#12198 did for pages). **BREAKING** for `@object-ui/i18n`: the pack keys `console.breadcrumb.dashboards` and `console.breadcrumb.reports` are retired from all ten language packs, with no replacement.
  
  - **`@object-ui/app-shell`.** On `/apps/APP/dashboard/NAME` the top bar's trail used to read app › Dashboards › dashboard, and on `/apps/APP/report/NAME` app › Reports › report. Each type crumb named a metadata type, not a place the user went, and its link only reopened the app's base, which the app pill already does. The trail now goes from the app pill straight to the dashboard or report, as it does for a page. System and object routes draw their trails as before.
  - **`@object-ui/i18n`.** `console.breadcrumb.dashboards` and `console.breadcrumb.reports` each had one reader, the crumb above, and are removed from the `en`, `zh`, `ja`, `ko`, `de`, `fr`, `es`, `pt`, `ru` and `ar` packs. A host that looked either key up through the published packs now gets the key string back, and has nothing to read instead: no screen draws a type crumb ahead of a dashboard or report any more. The other `console.breadcrumb.*` keys are unchanged.
  
  **Clause-②: no (narrowing).** Two published pack keys are removed; nothing is added and no accepted input widens.
- cea429b: The marketplace package page offers the install modes a package permits, managed or an unmanaged copy, and reads what the install door answers (objectui#12288, the objectui stage of objectstack-ai/objectstack#15213, ADR-0131 D6).
  
  A package declares how it may be installed with its manifest's `installModes` (`managed` and/or `unmanaged`). `POST /api/v1/marketplace/install-local` takes `installMode`, and absent means managed. The page now:
  
  - **Reads the package's `installModes` from the manifest the install door judges.** That is `GET /api/v1/marketplace/packages/:id/versions/latest/manifest`, the same path and the same version install-local fetches when it is given no version. The key is read where the door reads it: on a compiled artifact's nested `manifest:`, or at the top of a flat package body. The read is made only where install-local is the page's install door (`features.installLocal`), because the cloud install routes take no mode.
  - **Offers the choice only where the manifest permits more than one mode.** The choice starts unpicked, since the spec ranks no permitted mode above another, and the install waits for a pick. While it waits, the disabled Install says why: its reason opens on hover and on keyboard focus of the button's wrapper, and is the button's accessible description, the convention the console's other disabled controls follow. A mode named twice counts once. A manifest that declares no `installModes`, or that cannot be read, draws no choice and sends no `installMode`: the door's own default stands. A manifest that permits one mode draws no choice and sends that mode. A package that permits only `unmanaged` says before the click that its install is a copy.
  - **Reads the unmanaged answer.** The success sentence names the base the package was copied into. Each lock the copy dropped (`strippedLocks`) is listed with its item, its lock and the package's reason verbatim. No install-time suggested bindings are shown, since nothing is registered under the package's id. Before this, an unmanaged answer would have read as "loads when the runtime next restarts", because it carries no `hotLoaded`.
  - **Shows each refusal's own message.** `INSTALL_MODE_NOT_PERMITTED` (422), `UNMANAGED_INSTALL_WALLED_POSTURE` (409) and `RESOURCE_CONFLICT` (409) are shown as the envelope's `message`, with no console sentence in its place.
  - **Says when a runtime ignored a requested copy.** A runtime that predates the install mode reads no `installMode` and installs the package managed. When a copy was asked for and the answer does not say `installMode: 'unmanaged'`, the page says the package was installed managed, and how to get the copy.
  
  **Clause-②: yes (widening)**: `@object-ui/i18n`'s ten locale packs gain nine keys under `marketplace.install` (`mode.label`, `mode.managed`, `mode.managedHint`, `mode.unmanaged`, `mode.unmanagedHint`, `mode.required`, `unmanagedSuccess`, `unmanagedStrippedLocks`, `unmanagedIgnored`). Nothing else on either package entry changes. `installLocal`'s new optional `installMode` input, `getDeclaredInstallModes` and the `LocalInstallMode` / `LocalInstallResult` types live in `marketplaceApi.ts`, which ships inside `dist/` but is not exported from the `@object-ui/app-shell` entry. `MarketplacePackagePage`, which is exported, keeps its props.
- ca45c6d: The OAuth consent page names the requesting application by its registered name again, and never shows the raw `client_id` in the name's place (objectui#12301).
  
  The page looked the client up at `/api/v1/auth/oauth2/applications/ID/public`, a route no server mounts. Every lookup answered 404, and the page then named the application by its raw `client_id`. It now asks the route the server serves, `GET /api/v1/auth/oauth2/public-client?client_id=…` — the same URL `@objectstack/client`'s `oauth.applications.getPublic` builds — once the user is signed in, because that route needs a session. It reads the name from the answer's `client_name` and the logo from `logo_uri`.
  
  When the lookup gives no name (an unknown or disabled client answers 404; any other non-2xx, a network failure, or an answer without `client_name` counts the same), the page says "This application could not be identified." and shows the raw id under a "Client ID" label, in a code face. While the lookup is in flight, the page names "an application" and shows no id.
  
  **Clause-②: yes (widening)** — `@object-ui/i18n`'s ten language packs gain two keys, `oauth.consent.unidentified` and `oauth.consent.clientId`. No key is removed or changed, and nothing else on either package's entry moves: no export, prop or type member.
- b64fda3: Console writes that landed in silence now say so, and controls disabled on a read-only package say why to every user, not only to a mouse (objectui#12303).
  
  - **The grid's inline-edit saves raise a success toast.** "Save All" and the per-row save of a grid with no host save handler now show the console's shared toast, naming how many rows were saved ("1 row saved", "2 rows saved"). Only rows the server accepted are counted: a row that is refused stays pending and flagged as before, and a save where nothing landed shows no success toast.
  - **"Discard draft" on the metadata edit page raises a success toast** naming what was discarded ("Draft discarded: object/NAME"). A refused discard keeps showing its error instead.
  - **Studio on a read-only package:** the header's Publish, the automation enable switch and the Data pillar's Field properties rail now carry the read-only reason the way the record page's disabled actions do. A focusable wrapper is the tooltip trigger and a tab stop, and the reason is the control's accessible description. Before, the reason was a `title` on a disabled control (Publish, the switch) or absent (the rail), so Tab skipped it and assistive tech never heard it.
  - **The import wizard's disabled "Next"** is described by the visible "Can't continue" text that says which required fields are not mapped, and a focusable wrapper puts it in the tab order.
  - **Studio's lookup rail reads label first.** The field pickers (Display field and the other searchable pickers in the inspectors) list each option by its label, with the machine name after it, smaller and in monospace, and show a chosen option the same way. The object picker (Related object) shows a chosen object's label while it is not being edited, with the machine name beneath it.
  
  **Clause-②: yes (widening)** — every locale pack gains the `table.saved` count family (`table.saved`, plus each pack's plural forms), the grid's save toast. Nothing is renamed or removed.
- 2b06a91: A report the viewer may not read shows the no-access state, not the server's refusal (objectui#12330).
  
  When the dataset query behind a report was refused because the viewer may not read its object (403 `PERMISSION_DENIED`), the report page drew a red error box with the adapter's message: "Analytics query refused: … (server said: [Analytics] Access denied: reading "…" is not permitted for this user.)". That text quotes the server and names the object. A dashboard widget refused the same way already showed a localized "You don't have access" state.
  
  - **The refusal is classified once, in the report's dataset read**, by the shared `classifyLoadError` from `@object-ui/react`, the branch `DatasetWidget` takes for the same refusal. It judges the refusal by status and code, as `DatasetWidget` does; this renderer never matches the adapter's refusal text.
  - **A refused report shows "You don't have access"** (the widget's title, `dashboard.widgetForbiddenTitle`) and "You don't have permission to view the data behind this report." (the new `report.forbiddenMessage`, in all ten language packs). The table, the summary and the cross-tab show it, and so does each joined block. No server text and no object name is drawn.
  - **A report with a chart shows it once.** The chart already hides itself when its own query fails, and the table beside it shows the state.
  - **Any other failure keeps its error box and message**, so a real error (a 500, a rejected query) is not hidden behind "no access".
  
  **Clause-②: yes (widening)**: one locale key, `report.forbiddenMessage`, added to `@object-ui/i18n`'s published packs, which widens `TranslationKeys`. No export, prop or schema key is added, and nothing is renamed or removed.
- 065a1cf: A file the reader may not open now renders a restricted state instead of a generic file chip (objectui#12339).
  
  When a reader may read a record but not a file's `sys_file` metadata, the platform sends the file field's value as `{ id, metadataRefused: true }` (`FileRefusedValueSchema` in `@objectstack/spec/data`, spec `18.0.0-next.0`). `readFileValue` used to read it as an ordinary file named `File`. It now recognises the marker by the spec's closed schema and flags the view.
  
  - **Public type widening:** `FileValueView` gains an optional `metadataRefused?: true`. It is set only for the refused marker, so existing consumers are unaffected.
  - **What users see:** the `file` grid cell, the read-only `FileField` list and its edit rows, `FileCell`, `ImageField`, the `image` / `avatar` grid cell and `AvatarField` show a lock and a translated "Restricted file" label. They never attempt a thumbnail, because no MIME type was served. Where the renderer offers an open link, it still points to the id-derived download endpoint, which decides access on its own and may answer `403 FILE_DOWNLOAD_DENIED`. Normal file values render as before.
  - **Submitting:** when an editable `FileField`, `FileCell` or `ImageField` re-submits the field's other values (append, remove, crop), it sends the marker back as its bare id, never as the marker object.
  - **i18n:** two new keys, `fields.file.restricted` and `fields.file.restrictedHint`, in all ten locales.
- 37db09f: A user whose administrator forced a password change gets the change-password overlay instead of raw `403` responses (objectui#12365).
  
  The ObjectStack backend answers an administrator-forced password change with `403 PASSWORD_RESET_REQUIRED`, its own code distinct from natural expiry `PASSWORD_EXPIRED` (objectstack#23287 ruling C′, carried by objectstack#23440).
  
  - **`@object-ui/auth`:** the authenticated fetch wrapper now treats `PASSWORD_RESET_REQUIRED` as an auth-policy gate, like `MFA_REQUIRED` and `PASSWORD_EXPIRED`, so `AuthProvider` sets `remediationRequired` for it. Before the backend emits the code this changes nothing.
  - **`@object-ui/app-shell`:** `RemediationOverlay` routes `PASSWORD_RESET_REQUIRED` to the change-password form. It shows the title "You must change your password" for it, because "Your password has expired" is false for a forced reset. `PASSWORD_EXPIRED` keeps its title.
  - **`@object-ui/i18n`:** adds `auth.remediation.password.resetTitle` to all ten built-in language packs.
  
  No export is added or removed, and the type of `remediationRequired` (`{ code: string; message: string }`) is unchanged.
- a2225f9: The console list page spends less of the screen on chrome (objectui#12423).
  
  - **Four controls on the list toolbar.** The bar now shows Filter, Sort, Display and Search. Display is the former "View settings" panel, opened by default on every list: a Layout row (the visualization switcher, when the list offers more than one), Group, Row color, Hide fields, Density, a Row numbers switch and an Edit inline switch, with Reset to view default, Refresh and Export in its footer. The Display button shows how many of these differ from the view's own settings, and Reset hands them all back. Each control still saves exactly what it saved before; Row numbers lasts for the session only and starts on. A view that sets `compactToolbar: false` keeps the old toolbar, one button per control.
  - **View tabs fit the width.** The view tab strip shows as many saved views as fit and folds the rest into the "N more" menu; `maxVisibleTabs` is now an optional cap on top of the width. A table view's tab is its name alone, other view types keep their icon, and the small filter, sort and default-view marks on tabs are gone. The current tab's menu still offers every action, and "Set as default" now shows which view is the default.
  - **Grid rows.** With selection on, the first cell of a row shows the row number and swaps to the checkbox on hover, on keyboard focus, on touch screens and on every row while any row is selected; the header keeps its select-all box. With row numbers off the cell is empty until hover. The row actions button appears on hover, on focus and on a selected row, and stays reachable by keyboard.
  - **One-row page header.** On desktop the list page header is a single row: icon, title, then the description, with the actions on the right. The favorite star is no longer in this header. Phones are unchanged.
  
  For integrators: `ObjectGrid` takes a `showRowNumbers` prop (on unless set to `false`); the `ViewTabBar` config's `showIndicators` is deprecated and draws nothing; the language packs gain `list.display`, `list.layout`, `list.rowNumbers` and `list.resetToViewDefault`, and drop `list.viewSettings`, `list.viewSettingsHint` and `list.recordEditingTitle`.
- a8e5b73: Console sidebar: one Favorites section at the top, and one ⋯ menu on every entry (objectui#12427).
  
  - **The ⋯ menu replaces the pin icon.** When you hover a navigation entry it shows one ⋯ trigger, and a right-click on the row opens the same menu. There is no pin icon any more. The menu's entries depend on what the entry is:
    - Add to favorites / Remove from favorites always comes first. It writes the same pin as before, so the entry lands in the Favorites section at the top.
    - Open in new tab and Copy link appear for an entry that goes somewhere. They use the address the row's own link renders, so a console served under a basename opens and copies a working link, and a URL off the console is used as it is.
    - Design appears for an `object`, `dashboard` or `page` entry. It opens that target's designer on the metadata-admin route (`/apps/APP/metadata/TYPE/NAME`, which is where a page's Edit in studio button already goes). Only a workspace admin whose session may author metadata sees it.
    - On a phone, navigation entries show no trigger, as they showed no pin icon before.
  - **One Favorites section, at the top.** Favorites that are not navigation entries, such as an object or a record you starred, used to be a group after Recent, below the fold on a long menu. They are now rows of the Favorites section at the top, after the pinned entries. Each row shows its stored label and type icon and carries the same ⋯ menu, whose favorites entry removes it. Design shows for object, dashboard and page favorites, never for a record. Existing favorites appear there as stored: nothing in the favorites store changes and nothing is migrated. The console-home Starred group and the Home page are unchanged.
  - **The page header's favorites entry is in its overflow menu.**
    - The object list header no longer has a star. Its last control is now an icon-only ⋯ button ("More actions") whose menu holds Add to favorites / Remove from favorites. When the current app's navigation has an entry that opens this list, the entry pins that navigation entry, the same action as the sidebar's own menu. It writes one `nav:` favorite that lands in the Favorites section, and no second `object:` favorite. For an object the app does not list, it keeps an `object:` favorite.
    - On a record page the same entry leads the header's ⋯ overflow, ahead of Share, and toggles the record favorite.
  - **`NavigationRenderer` (`@object-ui/layout`) gets two additive props.**
    - `renderItemAction(item, context)` is a host control drawn on every leaf and action row, in place of the pin action. `context` carries the row's `href`, `external`, `label` and `basePath` (type `NavItemActionContext`).
    - `extraFavorites` takes host rows that are appended to the Favorites section after the pinned entries. The section renders when either kind of row is there.
    - A host that passes neither keeps the pin action and a section of pinned entries only, with the pinned drag order unchanged.
  - **Language packs.** Six new `console.nav` keys in all ten packs: `itemMenu`, `openInNewTab`, `copyLink`, `linkCopied`, `linkCopyFailed` and `design`. The list header's ⋯ button is named by `detail.moreActions`, the name the record header's ⋯ already has. The favorites entry reuses `common.addToFavorites` / `common.removeFromFavorites`. `sidebar.favorites`, the title of the removed group, is no longer read and leaves all ten packs.
- d9d9d98: Console top bar inside an app: the app pill and its PREVIEW chip are the left group, an object route draws no breadcrumb, and 「Edit app」 is an icon button at every width (objectui#12461).
  
  - **No object breadcrumb.** On an object's list, one of its views or one of its records, `AppHeader` draws nothing after the app pill from the `sm` breakpoint up. The page header names the page, the sidebar's active entry names the object and the saved-view strip names the view, so the crumb said the same name a third time. Its 「Switch Object」 menu goes with it: the sidebar switches objects and the view strip switches views. On a record opened from a related list, the way back is the record page's own back link to its parent; the top bar no longer draws the related-record trail. A dashboard, page, report or `system/*` route still draws its crumb.
  - **The PREVIEW chip sits beside the app's name**, right after the app pill, ahead of any crumb. It had sat on the right, beside the search box. Platform surfaces keep it beside the mark.
  - **「Edit app」 is an icon button at every width.** The pencil alone, a ghost icon button like the bell beside it, named 「Edit app」 by its `aria-label` and `title`. Same gate, same deep link, same `data-testid="app-design-in-studio-button"`. The text label it showed from the `lg` breakpoint up is gone, and with it `data-testid="app-design-in-studio-label"`.
  - **Below `sm` nothing changes.** The phone bar's compact title still names the list, the view or the record.
  
  BREAKING (`@object-ui/i18n`): the `topbar.switchObject` key is removed from all ten language packs, with no replacement. Its one reader was the 「Switch Object」 menu. A host that looked it up through the published packs now gets the key string back. No key is added or renamed.
  
  `@object-ui/app-shell` adds, removes or renames no export, prop or option.
- 9b82ced: The Approval Center's request drawer no longer has a "Raw data (JSON)" panel, for any viewer (objectui#12490).
  
  The drawer used to end with a collapsed panel that printed the submitted record's whole snapshot as JSON, with a copy button, shown only to holders of the platform-admin-only `studio.access` capability. There is no business need for it: the person handling an approval decides from the structured summary, the approval chain, the activity and the actions, and all of those are unchanged. The panel is now removed for everyone, platform operators included, and nothing replaces it. The served approval request page never had such a panel.
  
  Clause-②: no (narrowing) — the four keys `approvalsInbox.rawData`, `approvalsInbox.copy`, `approvalsInbox.copied` and `approvalsInbox.copyFailed` leave all ten locale packs, and nothing is added.
  
  `@object-ui/i18n` (BREAKING; `minor` under this repository's release model, where objectui's major follows the `@objectstack` major): the exported `en` pack and the `TranslationKeys` type derived from it lose those four members. Nothing in objectui reads them now. A host that calls `t()` with one of them gets the key back; supply the string from your own resources if you still need it. Keys with the same leaf name in other namespaces are not affected.
- 92c2a69: The Studio's Publish and Changes buttons no longer open the pending-changes sheet the same way.
  
  - **Publish opens it to confirm.** Every pending item is expanded, so the fields and keys each one adds, changes or removes are on screen. A summary line above the list counts what the publish carries, by type (for example "3 items · 1 object · 1 app · 1 page"). Focus lands on Publish all. The header button still publishes nothing by itself; only Publish all in the sheet does.
  - **Changes opens it to review.** Items stay collapsed and focus lands on the list. Publish all is still in the footer, unfocused.
  
  Every other place that opens the sheet (the Home page, the draft preview bar and the history timeline) keeps the review behaviour. With nothing pending, Publish stays disabled and says why, as before.
  
  New language-pack keys under `preview.changes`: `summaryItems` (with its plural forms) and `summaryType`, in every shipped locale.
- 8ed7e5a: New `auth.login` strings for the console login page, in all ten language packs (objectui#12600): `welcomeTitle`, `welcomeDescription`, `showPasswordText`, `hidePasswordText`, `footer.privacy`, `footer.terms` and `devAdminHint.signIn`. `auth.login.devAdminHint.title` now reads "Local development instance" (was "Development instance").
  
  Removed from all ten packs: `auth.login.devAdminHint.body` and `auth.login.devAdminHint.dismiss`. They named the retired dev-admin banner's credentials line and its dismiss button, and nothing reads them any more. A host that called either key now gets the key back instead of text.
- 6c4d00d: The console home's top half follows the approved home artboard (objectui#12601): a search field in the top bar, a greeting with a one-line work summary, two compact builder chips, and 56 px app tiles with Setup moved off the tile row.
  
  - **Search on `/home`.** `HomeLayout` now mounts the console's command palette, the same one `⌘K` opens inside an app. It is scoped to Home's host app: the app the user was last in, else their first openable app. The top bar draws its search field in the middle zone from `lg` up, 420 px wide from `xl`, labelled "Search apps, records, pages…". `⌘K` works on the page too. When there is no app to host the palette, none is mounted and no field is drawn. The internal-form route, which uses the same layout, gets the same field.
  - **Greeting.** The greeting is 24 px / 600. The tagline is replaced by a 13 px summary line that counts the approval requests waiting on the user: "You have N approval(s) waiting today", or "Nothing is waiting for you today" at zero. The count comes from the shared pending-approvals read, the same read the bell uses for the approvals part of its badge; the badge adds the unread notification topics to it, so the two numbers can differ. The line speaks only once that read has answered: while it is loading, after it fails, or before it is asked, the line is empty rather than reporting nothing waiting. On a runtime without the approvals plugin the read answers with none waiting.
  - **Builder entries.** The two full-width cover cards "Build an app" and "Start with a template" become two 32 px chips at the greeting's right, for admins only. A withheld chip keeps its disabled state and explains itself through a tooltip wrapper (a focusable wrapper, and an `aria-describedby` on the button pointing at a visually hidden reason). The reason is no longer a visible paragraph under the cards. The `home-build-app`, `home-start-template`, `home-authoring-gate-reason` and `home-marketplace-disabled-reason` test ids are unchanged.
  - **Apps.** The "Your apps" heading is 15 px with a count pill. Tiles are 112 px wide, with a 56 px icon and a 13 px name on one line. Under the name, an 11 px line says when the user last had the app open, in the locale's compact relative time ("2 hr. ago", zh "2小时前打开"), read from the recent-items store: the newest entry the user opened inside that app. The line is never cut: a language adds a verb to the time only where both fit the tile, so the English line is the time alone. An app with no entry left in the store shows no line. Setup is no longer a tile: it is a muted "System Settings" link at the heading's right, shown when the user can open Setup. An admin who may install apps gets a trailing dashed "Add app" tile, which opens the marketplace route the "Browse App Marketplace" link opens and has the same gate.
  - **Content column.** The page's content column is 1120 px wide, with 28 px above the first section and between sections.
  
  New locale keys, in all ten packs: `home.search`, `home.summary.approvals` (a count family), `home.summary.none`, `home.addApp` and `home.appOpened`. Three keys whose only reader was the retired hero tagline and cover cards are removed from all ten packs: `home.heroTagline`, `home.build.subtitle` and `home.template.subtitle`. After this change nothing in this repository reads them.
  
  **Clause-②: yes.** On the `@object-ui/app-shell` entry no export, prop or type is added, removed or renamed: `HomeLayout`, `HomePage` and `AppHeader` keep their props, and what changes is what they draw. On the `@object-ui/i18n` entry, the exported `en` pack is typed by its literal content, so its type gains the keys above and loses those three, and `formatRelativeTime` takes an optional third argument, `{ style, numeric }`, passed to `Intl.RelativeTimeFormat` as they are; without it the output is unchanged.
- db8ce2f: Locale keys for the console home's "My work" section (objectui#12602), in all ten packs.
  
  - **Added:** `home.myWork.title`, `home.myWork.openInbox`, `home.myWork.viewAll`, `home.myWork.approvals`, `home.myWork.approvalsEmpty`, `home.myWork.notifications` and `home.myWork.notificationsEmpty`. For the pending-drafts row: `home.pendingDrafts.title` (a count family), `home.pendingDrafts.inPackage`, `home.pendingDrafts.waiting` and `home.pendingDrafts.nameSeparator`.
  - **Removed:** `home.actionCenter.title`, `home.actionCenter.empty` and the `home.pendingDrafts.message` count family. Their only readers were the retired action-centre card and the retired drafts banner, and nothing in this repository reads them now.
  
  **Clause-②: yes.** The exported `en` pack is typed by its literal content, so its type gains the keys above and loses the removed ones.
- f0e760a: Home: "Recently accessed" brings you back to the records and list views you opened, beside the activity feed (objectui#12604).
  
  - **List views are remembered.** Opening a named list view (`/apps/APP/OBJECT/view/VIEW`) records that view, so it comes back as its own entry, labelled with the view's name in your language. The recent-items store keeps the last 20 entries instead of 8, one per record and one per list view. Home shows the newest six, and the sidebar's Recent group shows five, as before. Opening a record, or its create or edit form, no longer also adds the object's list to the store. The record page already records the record itself.
  - **Each row says where it came from.** A row shows a kind icon (a record shows its object's icon), the title, and a trail such as "Account · HotCRM · 10 minutes ago": the record's object, or the kind of entry, then the app it was opened in and when. The time uses your display locale.
  - **New layout.** "Recently accessed" and "Activity feed" each have a heading above a bordered card, with 40 px rows in the recent list. Each activity row shows the actor, the change, and a line with the time and the object. The activity column still appears only when you may read `sys_activity`. Without it, the recent list spans the full width.
  
  `RecentItemType`, exported from `@object-ui/app-shell`, gains the `'view'` member. A `view` entry carries `object` and `name` (the view's name) rather than a `label`. Code that switches over every kind must handle it. Each language pack gains `home.recentApps.itemType.view`.
- f78efdd: List grids show the record a pointer field names, and the Approvals Inbox says who else is waiting (objectui#12608).
  
  - **Record names in place of record ids.** A `text` field that declares `referenceVia` holds the id of a record whose object the sibling column names on the same row, as `record_id` does on Approval Requests (`referenceVia: 'object_name'`) or `source_id` on activities. In a list grid such a column now shows the target object's icon and the record's name, linking to the record. The record id moves to the tooltip. The grid reads the records of one page with one request per target object, not one per row.
  - **Unavailable records say so.** When the record cannot be read (deleted, or outside what the viewer may read), the cell shows the object's label followed by "record unavailable", with the id in the tooltip, instead of the bare id.
  - **The empty Approvals Inbox names who else is waiting.** When nothing is waiting on the viewer but other requests are pending, the empty state adds one muted line: "N requests are waiting on other approvers · Browse all requests". The number comes from one count request and counts only requests the viewer can see; when it cannot be read, the line is not shown.
  
  New language-pack keys, in every shipped language: `grid.recordUnavailable` and the `approvalsInbox.waitingOnOthers` plural family.
- 9d857c9: Seven `marketplace.*` keys are removed from all ten language packs: `installedTitle`, `installedSubtitle`, `installedEmpty`, `installedAt`, `installedBy`, `installedPackageId` and `cachedAs` (objectui#12675). Only the Installed Apps list read them. That list's body is retired: Setup → Packages is the one list of what is installed, and its rows do not show an install date, an installer or the cached-manifest path. A host that read one of these keys gets the key back instead of a sentence.
  
  Fix for a host that still reads one of them: carry the sentence in the host's own bundle, or drop the read.
  
  Clause-②: yes (narrowing)
- 33ee9de: A `list-view` block drawn as a compact list in a narrow page region now shows a "View all" link under its rows (objectui#12703).
  
  - `@object-ui/react`: `RelatedRecordActionsValue` gains two optional members, `listHref(objectName, viewName?)` and `openList(objectName, viewName?)`. They address an object's list page, or one of its saved views, the way `recordHref` / `openRecord` address a record. A host that omits them is unchanged.
  - `@object-ui/app-shell`: a custom page supplies them. The routes are `/apps/APP/OBJECT/view/VIEW` for a block bound to a saved view (`dataSource.view`) and `/apps/APP/OBJECT` otherwise. The block's inline filter, columns and sort are never put in the URL.
  - `@object-ui/plugin-list`: the compact list draws the link only when the host answers a destination. It is a real anchor with in-app navigation on a plain click.
  - `@object-ui/i18n`: one new key, `list.viewAll`, in all ten packs.
- ac59073: **The AI build conversation stays on the conversation and reads more compactly** (objectui#12724).
  
  - **No automatic navigation after a build.** When a build finishes, the page no longer moves you into Studio. The finished build card offers two buttons: 打开应用 / Open app (primary), which opens the app on its first navigation item, and 在 Studio 中查看 / View in Studio. Both are in-app navigations. The conversation is still bound to the built app, so Studio's copilot resumes the same thread.
  - **One collapsed line per phase.** A turn's tool activity reads as one line, for example "设计方案 · 4 步 · 0:48 · 读取编写规范 · 列出对象 ×3 …". Repeated calls of a tool fold into one step with a count, and a chevron expands the per-tool rows. The rows open on their own while a step is running. The elapsed time shows only for a turn this page watched; a reopened conversation shows no time.
  - **The finished build card.** Its header reads 「已搭建并上线 · APP」 / "Built and live · APP" once the build is published, and "Built APP" otherwise. Below the buttons, a line lists the build's next steps as things you can say, followed by the sentence 「之后的修改先存草稿，由你在 Studio 发布」. The progress bar is gone once the build is done. A whole-app build no longer repeats its next steps as a list on the draft card.
  - **The plan card.** The header names the app the plan builds and shows 等待确认 / Awaiting confirmation until you decide. Each object gets a row with one chip per field from the plan's `blueprint.objects[].fields`. The plan's views get their own rows, and the reply hint sits beside 开始搭建 / 调整方案. A plan without field rows (for example one restored from the local cache) shows the object chips with field counts, as before.
  - **The composer.** Outside an app, the build agent's placeholder reads 「描述你想搭建的应用，或要改的地方…」 / "Describe the app you want to build, or what to change…" and no longer names the agent. Inside an app it still reads "Ask about your data, or ask me to change this app…". The key hint reads 「↵ 发送 · Shift+↵ 换行」.
  
  `@object-ui/plugin-chatbot`: `ProposedPlan` gains optional `appLabel`, `views` and `objects[].fields`, and `ChatbotLabels` gains an optional `newlineHint`. `@object-ui/i18n`: new `console.ai.describeAppToBuild`, `console.ai.newlineHint`, `console.ai.viewBuiltAppInStudio`, `chatbot.phase.*`, `chatbot.plan.awaitingConfirm` / `objectsAndFields` / `views` and `chatbot.build.builtAndLive` / `nextStepsLead` / `nextStepQuote` / `draftPosture` in every pack. `console.ai.designBuiltApp` is retired.
- 44cb469: **The AI build cards draw the plan and result details the build agent now sends** (objectui#12724).
  
  - **The plan card.** Each object's fields are chips. A field whose sample data is held to a format shows it in mono type (「ISBN 13 位数字」, 「邮箱 邮箱格式」). A field the agent added on its own (you did not name it) has a dashed chip marked 「补充」 / "suggested". An object that declares its name field gets a 「名称：书名」 / "Name: Title" line. Each view shows one line saying what it does, for example 「列表 · 筛选 状态 = 逾期 且 归还日期 为空 · 按应还日期升序」. The assumptions are a bulleted list, and the count line ends with the sample data the build will stage (「示例数据 12 条/对象」).
  - **The result card.** A finished build shows a 「核对通过 7/7」 / "Checks passed 7/7" chip and the lines the agent verified on the built app, objects in one column and views and sample data in the other. Those lines replace the list of staged artifacts. When the agent re-checks the build later in the same turn, the card shows that newer check. 打开应用 opens the app the build landed in, and 在 Studio 中查看 opens its package.
  - **Step names.** The steps in the progress line read as short sentences in your language, for example 「记下后续检查项」 for the agent's to-do step and "List the existing objects" in English. Before, the English names were the tool names with their underscores removed.
  
  Each of these reads a field of the build agent's plan or result. When an older agent does not send that field, the card looks as it did before.
  
  `@object-ui/plugin-chatbot`: `ProposedPlan` gains optional `planCard` and `viewIntents`. `@object-ui/i18n`: new `chatbot.plan.suggestedField`, `chatbot.plan.nameField` and `chatbot.build.checksPassed` in every pack, and every pack's `chatbot.tool.*` values are reworded.
- 3da39ae: **The copilot's change card says when a change will be saved as a draft, and the applied card offers review and undo** (objectui#12894).
  
  - **The change card.** When the copilot proposes a change, the card is headed 「修改方案 · 2 项」 / "Change plan · 2 changes" and lists one row per change: a ＋ / ✎ / － symbol, the kind (字段 / 视图 …), the object and field it touches, and its type and parameters in small type (「number · 续借次数 · 默认 0 · 不必填」). For an app that is already live and holds records, the change is saved as a Studio draft: the card says so in an amber note, and its main button reads 「存为草稿」 / "Save as draft".
  - **The applied card.** After you confirm, the card shows what happened, for example 「已存为草稿 · 2 项未发布」 with 「已有 12 条记录的续借次数为空」 and 「核对：结构 ✓」. It offers 「查看变更并发布」 / "Review changes and publish" and 「撤销」 / "Undo" when the host provides them. Undo discards every unpublished draft of the app package, so when other drafts are pending the button says how many, and the card asks before it runs.
  
  Each of these reads a field the copilot's tools now send. When an older version does not send it, the card looks as it did before.
  
  `@object-ui/plugin-chatbot`: `ProposedChanges` gains optional `posture` and `primaryAction`; `ReplayOutcome` gains optional `draftState`, `existingRows` and `appliedCard`; `ChatbotEnhancedToolInvocation` now references both types instead of repeating them; `ChatbotEnhancedProps` gains optional `onReviewDrafts` and `onDiscardDrafts`. `@object-ui/i18n`: new `chatbot.changes.*` keys in every pack.
- 6058bf8: Studio's Changes drawer can now fill a new field's default into the records an object already holds, when you publish (objectui#12929).
  
  - **The choice.** In the drawer, under a field that a pending draft adds to an already-published object, an unchecked "Backfill default (N existing records)" choice appears when the field declares a literal `defaultValue`. N is the object's record count, read as you. If the count read gives no total, the choice shows no number. A field whose default is a runtime token (`NOW()`, `current_user`) or an expression, a field with no default, and the fields of an object that has never been published get no choice. The publish door refuses those with a 400, and there are no existing records to fill.
  - **The publish.** Publish all sends the checked fields as the protocol's opt-in `backfill` (objectstack#24253). The server writes each field's default into the existing records that have no value, as you, with permissions and record hooks applied. The publish toast then shows the rows the server says it wrote for each field. If a field stopped short, the toast is a warning that gives the server's reason, and the publish still stands. If nothing is checked, the publish request is `{}`, the same as before, and no existing record is written.
  - **`MetadataClient.publishPackageDrafts(packageId, options?)`** (`@object-ui/data-objectstack`) takes `options.backfill`, an array of `{ object, field }`. Its type is picked from `@objectstack/client`'s `packages.publishDrafts`. The method sends `backfill` only when it is given. The receipt is `backfillApplied` on the result. A call without options sends the `{}` body it always sent.
  - **New strings:** `preview.changes.backfillOption` (a count family) and `preview.changes.backfillOptionNoCount` in all ten `@object-ui/i18n` packs. The Studio table gains `engine.studio.backfillWritten` and `engine.studio.backfillStopped` (en and zh).
- 30083da: Two Cloud SDUI widgets are retired: `cloud:onboarding-next`, the Welcome page's next-step block, and `cloud:plan-status`, the pricing page's current-plan marker (objectui#12954). The Cloud control plane was their one consumer, and objectstack-ai/cloud#3010 replaced both: the home's next step is declared `element:button` nodes over `GET /api/v1/cloud/home`, and the pricing page marks the current plan with a `visibleWhen` on the same summary. At retirement, hotcrm `main` (`3b05ae7`) and objectstack `main` (`0b44840dfd`) registered and authored neither type. They are retired at once, with no deprecation alias. This is breaking for a page or host that still names one of them; it is marked `minor` under this repository's version policy.
  
  - **SDUI widget `cloud:onboarding-next`**, also registered as `app-shell:cloud:onboarding-next`. FROM: `@object-ui/app-shell` registered both keys. TO: neither is registered. A page that still names one draws the unknown-component panel, and `objectui check` no longer counts either key among the known component types.
  - **SDUI widget `cloud:plan-status`**. FROM: `@object-ui/app-shell` registered it. TO: not registered, with the same two consequences.
  - **Schema `CloudPlanStatusSchema`** in `@object-ui/types`: the TypeScript interface from the package entry, and the zod arm from `@object-ui/types/zod`, which was also a member of `AnyComponentSchema`. FROM: exported, and a `cloud:plan-status` node validated against the arm. TO: there is no such export, so importing it fails to compile. `AnyComponentSchema` keeps a refusal arm for the literal, which is not exported, so `objectui validate` refuses a `cloud:plan-status` node BY NAME at `type`, and the message names the remedy: a `visibleWhen` on the page's summary. `CloudWorkspaceTimezoneNoticeSchema` stays.
  - **Locale keys `cloudOnboarding.*`** (`hintCreate`, `hintReady`, `createEnvironment`, `openWorkspace`, `manageEnvironments`) **and `cloudPlanStatus.current`** leave all ten built-in packs of `@object-ui/i18n`.
  
  The two widget modules also leave the `sideEffects` array of `@object-ui/app-shell`. `useEnvironmentEntitlements` stays: the environment list and `cloud:workspace-timezone-notice` still read it.
  
  Fix for a page that still names either widget: compose it from generic blocks, as objectstack-ai/cloud#3010 did — declared `element:button` nodes over the home summary in place of `cloud:onboarding-next`, and a `visibleWhen` on the same summary in place of `cloud:plan-status`.
  
  Clause-②: no (narrowing)
- a928aaa: An import undo that leaves rows unreverted now says so in the Import Wizard (objectui#13015).
  
  The undo route runs its reversal writes under the object's declared controls, so a hook or rule can refuse a row. The server then answers with `success: false` and one `failures` entry per row it did not revert. Each entry carries the app's own refusal sentence. The job stays undoable for exactly those rows. The wizard used to ignore the answer and only reported a thrown error, so a partial undo showed nothing.
  
  - **Both lists that run Undo show it.** In the History list and on the cancelled-result screen, a partial answer reports how many rows were not undone and that undoing again retries only those rows. It lists each refusal sentence the answer carries. Rows refused with the same sentence share one line, and after ten distinct sentences the rest are counted. Undo stays offered, because the re-read job is still undoable. The object's open lists still refetch, because the undo reverted the other rows. A full undo is unchanged.
  - **A thrown undo in the History list shows its message again.** The list's reload cleared the error slot the undo had just written to, in the same tick, so that message never appeared. The undo outcome now has a slot of its own.
  - **`@object-ui/types`: `ImportJobUndoResult` is the spec's `UndoImportJobResponse`, bound by reference.** It was a hand-written copy that lacked `failures`. It now carries the required `failures` array of `{ id, action: 'delete' | 'restore', code, error }`. `@object-ui/types` now requires `@objectstack/spec` `^18.0.0-next.5`, the first published release that declares `failures`.
  - **`@object-ui/i18n`:** the ten packs gain the `grid.import.undoPartial` count family.
  
  BREAKING (`@object-ui/types`), for a custom `DataSource` whose `undoImportJob` resolves to the old shape: it must now return `failures` (an empty array for a full undo). `@object-ui/data-objectstack` already returns the server's answer unchanged. The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.
  
  Clause-②: yes (narrowing): `ImportJobUndoResult`, exported from `@object-ui/types`, gains `failures`, and the new pack keys widen `@object-ui/i18n`'s `TranslationKeys` (the widening). `failures` is now required of a custom `DataSource`'s `undoImportJob` answer (the narrowing; see BREAKING above).
- 47508f3: Every app now has a report index at `/apps/APP/reports` (objectui#13020). It lists the reports the app's package ships, by their localized labels, each linking to its `report/NAME` page, and leaves out a report whose dataset reads an object the viewer may not read. The sidebar links it from every app as "All reports", with nothing for the app to author, and it shows an empty state when there are none.
  
  The command palette (⌘K) now also finds those reports, by label and machine name, under the same read rule. A report the app's navigation names is still offered through its navigation entry, once.
  
  New strings in every shipped locale: `sidebar.allReports` and `console.reportIndex.*`.
- 088e0f7: A record-form field can name one item of a metadata registry by its machine name: a `text` field that declares `widget: 'position-ref'` lists the position registry, and one that declares `widget: 'permission-ref'` lists the permission-set registry. It stores the name only (objectui#7611, ruling B2 on objectstack#22865). This is the mechanism the metadata forms' `ref-multi:permission` picker brought in (objectui#12126), now reachable from an ObjectQL object field. A grant table's name field (`sys_user_position`'s position, `sys_user_permission_set.permission_set`) can now offer the declared items instead of a box for a typed name.
  
  - **The widget (`@object-ui/fields`).** `field:position-ref` and `field:permission-ref`, one key per registry type, with the type in the key, as `object-ref` carries `object`. Like every `widget` value, the name is looked up as `field:<widget>`. Each item reads as its label beside its name, and a pick writes the name: no label, no id. A stored name the loaded registry does not list stays on screen as its own option, flagged *not found*. The four catalog arms follow the metadata forms' `ref:dataset` / `ref-multi:<type>` pickers. With no data source that can list a registry, the field is a text box for the typed name. While the list loads, the stored name sits in a disabled box. When the load fails, a notice names the failure and its cause, and the text box stays enabled. A loaded but empty registry gives the same text box. Neither key is a declarable field type: both are widget hints, like `object-ref`.
  - **The catalog (`@object-ui/types`, `@object-ui/data-objectstack`).** `DataSource` gains an optional `listMetadataItems(type)`, answering `{ name, label }` headers for one registry type. An empty array is authoritative ("this registry has no item of this type"), so a failed load must reject, never resolve `[]`. `ObjectStackAdapter` implements it over `GET /api/v1/meta/:type` (the client's `meta.getItems`). It rejects with the transport's error, and refuses an answer that carries no `items` list. It is uncached, so an item authored in Studio shows on the next form.
  - **Locale keys (`@object-ui/i18n`).** `fields.registryRef.loadFailed` and `fields.registryRef.notFound`, in all ten packs.
  - **Wiring.** The form renderer threads `dataSource` to both keys, as it does for the other widget-hint pickers (`@object-ui/components`). The inline-grid exclusion set and the action-param value-shape table list both keys as widget-hint-only (`@object-ui/fields`, `@object-ui/app-shell`). The CLI's generated `KNOWN_SCHEMA_TYPES` gains `field:position-ref` and `field:permission-ref` (`@object-ui/cli`). A comment in `@object-ui/core` stops counting the picker names.
  
  **Clause-②: yes (widening)**: one optional `DataSource` member, two registered `field:` keys (the `RegisteredFieldWidgetType` union and `FORM_FIELD_TYPES` gain two members), and two locale keys. Nothing narrows: a field without the hint renders exactly as before.
- 78b07f4: The object-page special cases for the retired permission-set catalog object are removed (objectui#7611, after objectstack's ADR-0131 stage 8 retired `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability`). A permission set is edited on its Setup metadata page, which reads the registry; none of the removed code ran anywhere else.
  
  **Breaking (narrowing; scored `minor` per the fixed group's version policy).** Each removal below shrinks a published face:
  
  - **`@object-ui/core`: `recordDelete.confirmText`.** FROM `recordDelete.confirmText({ objectName, t }, record)` TO `recordDelete.confirmText({ t })`. A package-owned `sys_permission_set` row no longer gets the reset question or the "reset" toast: every record gets the delete question and the delete toast. Fix: drop `objectName` and the second argument.
  - **`@object-ui/i18n`: pack keys.** FROM `perm.facet.*` (`none`, `more`, `objects`, `fields`, `rls`, `tabs` with their plural slots, `adminScope`, `designInStudio`, `designInStudioHint`) and `objectActions.resetPackageSetConfirm` / `objectActions.resetPackageSetSuccess` in all ten packs TO absent. Fix: a consumer that still asks for one keeps its own copy (inline `defaultValue` or its own bundle).
  - **`@object-ui/plugin-detail`: the `field:permission-facet-link` registry key.** FROM a registered field widget (the read-only facet summary with a "Design in Studio" link, also special-cased in the detail section and inline edit) TO unregistered. A field still carrying `widget: 'permission-facet-link'` renders with its declared type, like any unregistered widget. Fix: drop the `widget` hint, or register an own widget under that key.
  - **`@object-ui/cli`: `objectui check`'s known schema types.** FROM `field:permission-facet-link` known TO unknown, so `objectui check` reports a node of that type. Fix: as above.
  
  **Behaviour changes, not narrowings:**
  
  - **`@object-ui/data-objectstack`:** `getObjectSchema` no longer stamps `widget: 'permission-facet-link'` onto the six `sys_permission_set` facet fields (that object is no longer served).
  - **`@object-ui/app-shell`:** the `sys_permission_set` record page no longer appends the assigned-users panel. The panel itself, `AssignedUsersSection`, stays on the permission-set metadata page.
  - **`@object-ui/app-shell`: a permission set created from the Setup catalog is created live.** "New" on the permission-set page used to save a draft, while the set's editor edits the live set and reads no draft: the editor opened an empty set without the label, its Save wrote the grants live, and the draft stayed pending, so publishing it from Home replaced the grants with the empty create body. Outside a package binding the create now writes live (with the same first-write pin); under `?package=` it stays a package draft.
  
  **Widenings:**
  
  - **`@object-ui/core`:** the data source `recordDelete.run` is injected with needs only `delete` (it no longer calls `findOne`).
  - **`@object-ui/app-shell`:** the metadata-resource registry entry gains an optional `createLive`, which a type sets when its edit page writes the live item.
  
  Internal, not reachable from a published entry: the `PermissionFacetLink` component (never exported from `@object-ui/plugin-detail`), `RecordPermissionAssignmentsRenderer` (never exported from `@object-ui/app-shell`), and `ObjectStackAdapter`'s private `applyFieldWidgetOverrides`.
- f962cdc: The suggested-bindings panel shows each suggestion's real state and can revoke an acceptance (objectui#7611, after objectstack#22854).
  
  On a framework where a `manage_metadata` holder's accept takes effect for the whole deployment (objectstack#22801 → A), the panel on the marketplace package page and in the Studio Access pillar listed pending suggestions only, and an accept was reported as granted whatever the server answered. It now lists every suggestion of the package and draws each one in the state the server records:
  
  - **Pending.** Accept and Dismiss, as before.
  - **Pending on the `guest` anchor.** No Accept: the server refuses it with `409`, because the Guest position takes no sets from accepted suggestions. The reason is shown in its place, and Dismiss stays.
  - **Accepted.** A Revoke action, which is the existing dismiss call on an accepted row: the server re-derives Everyone without the set. The line says the set was accepted; it does not claim the set is in force, because the list does not say so.
  - **Accepted, not yet in force.** An accept answered `200` with `bindingCreated: false` was recorded, but the Everyone position did not change on that request. The panel says so, with a warning toast in place of the success toast, and keeps Revoke. The list does not carry this, so after a reload the row reads as accepted.
  - **Dismissed or revoked.** The server records both as `dismissed`. The row says the set is not granted, and offers no action.
  
  A suggestion the deployment's baseline already names (`confirmed` without a deployment decision) is not drawn: this surface does not decide the baseline. A `403` or `409` on Accept, Dismiss or Revoke shows the server's own message, and the panel then reads the list again so it shows what the server holds. A caller without `manage_metadata` is refused the list with `403`, and the panel still renders nothing for them.
  
  **Locale keys.** `marketplace.suggestedBindings.guestUnsupported`, `acceptedState`, `notInForceState`, `dismissedState`, `revoke`, `revoking` and `revokedToast`, in all ten packs. The Studio Access pillar's own table gains the matching `engine.studio.access.suggest…` keys in English and Chinese.
  
  **Clause-②: yes (widening)**: seven locale keys added to `@object-ui/i18n`'s published packs, which widens `TranslationKeys`. No export, prop or accept set moves.

### Patch Changes

- 92f4e2b: An action's translated copy is now read from ONE bundle node, chosen by the object the action belongs to, the same way `@objectstack/spec` 17.7.0 reads it on the server (objectui#11439). That object is the action's declared `objectName`, else the object whose `actions` embed it.
  
  - An action that belongs to an object reads `objects.OBJECT._actions.ACTION.*` only. Copy for it filed under `globalActions.ACTION` no longer applies: its label, confirm text, success message, outcome messages, description, parameters and result dialog show the authored text instead, as they already did everywhere the server translates. Move that copy to `objects.OBJECT._actions.ACTION`, which is where `os validate` asks for it.
  - An action with no object (no `objectName`, not embedded in an object) still reads `globalActions.ACTION.*`.
  - `useActionTextLocalizer` keys on the action's declared `objectName` before the object its caller passes, so an action declared on one object reads that object's copy wherever it is drawn.
  
  `useObjectLabel()` and `useActionTextLocalizer()` keep their signatures; no input, export or translation key is added.
- e8c0b96: A refused save, pin, reorder, view setting, report save, publish or discard in the console is now said to the user, and the view-config panel no longer reports a refused save as saved (objectui#11583).
  
  objectui#11578 made the two Create View doors say a refused save. The console's other metadata
  writes on the object page, the report page and the draft bar still caught a refusal with a
  console line and nothing else, so a permission refusal or a spec refusal looked like a saved
  change:
  
  - the view-config panel's Save on an existing view;
  - pinning or unpinning a view, and reordering views in "Manage views";
  - a toolbar setting on a list view (density, sort, columns, hidden fields), when the server
    refuses it (the console's own permission check already said its refusal, and still does);
  - the report editor's Save;
  - Publish and Discard draft on the draft bar of those two editors.
  
  Each now raises the refusal through the console's error toast, with the save door's own
  message: the field-anchored issues of a validation refusal, one per line, or the refusal's text.
  The draft bar's toasts lead with "Publish failed" or "Discard failed", two new strings in all
  ten language packs; the others lead with "Failed to save". Set as default, which already raised
  an untranslated "Failed to set default view" with no reason, now does the same.
  
  The report editor waits for its save. It closes once the report is saved; a refused save leaves
  it open with the edit in place, so Save can be pressed again (it used to close at once, and
  reopening it showed the stored report). Save is disabled, and the editor read-only, while the
  save is in flight.
  
  The view-config panel waits for the save before it reports the edit as saved. A refused save
  leaves the panel dirty, so Save stays enabled for a retry, and the "unpublished changes"
  indicator is not raised for a draft that was never written. Save is disabled while the save is
  in flight. `ViewConfigPanel`'s `onSave` accepts any return, as it did when it was typed `void`:
  the panel awaits it, and `false` (returned, or resolved by a promise) or a rejection means the
  save was refused; anything else, nothing included, is read as saved.
- b92329c: Studio's "Organization flows" page no longer says its drafts publish atomically, and a deep link to a flow that is not on the page no longer says no metadata designers are registered (objectui#11591).
  
  On the package-less page (`/studio/~org/automations`), the pending-changes sheet read "Publishing releases the 1 pending draft of this package atomically." That page has no package, and its Publish promotes each draft by itself: a draft that fails stays pending while the others go live. The sheet now says so there, through a new `preview.changes.confirmNoteSeparate` plural family in all ten language packs. A package's sheet keeps its sentence unchanged. `DraftChangesPanel` picks the sentence from its `packageId` prop: with a package, the atomic sentence; without one, the per-draft sentence.
  
  On the Automations pillar, the canvas chip read the designer registry for the open flow's type. With no flow open (a deep link naming a flow the list does not hold, or an empty list), it found none and showed "No metadata designers are registered in this session…" beside the right message, on a page whose flow designer is registered. The chip now reads the registry for the pillar's own type, `flow`, as the configuration panel beside it already did. The notice still shows when no designer is registered, whether or not a flow is open.
- f9f4a62: Console, record page and Studio copy from the 2026-10-05 cloud acceptance run (objectui#11659).
  
  **The cloud home's primary button reads "Open workspace" (zh 「进入工作区」), not "Open Production".** A new customer has exactly one environment, and "production" is control-plane vocabulary. The `cloud:onboarding-next` widget's ready-state button now resolves `cloudOnboarding.openWorkspace`, which replaces `cloudOnboarding.openProduction` in all ten language packs, and the hint under it (`cloudOnboarding.hintReady`) says "workspace" instead of "production environment". The button still navigates to the page's `openProductionUrl`; the page-metadata contract is unchanged. The same release then retires the `cloud:onboarding-next` widget and every `cloudOnboarding.*` key (objectui#12954), so neither the button nor those keys ship.
  
  **The create-workspace dialog asks for the name only.** `CreateWorkspaceDialog` no longer shows the "URL slug" field: the customer never sees the slug take effect at this step. The slug is still generated from the name, by the same rule as before, and sent with the create call; the owner can change it later in organization settings. Because the slug is no longer the user's to fix in the dialog, a slug collision (`ORGANIZATION_ALREADY_EXISTS` or `ORGANIZATION_SLUG_ALREADY_TAKEN`) is retried with a short random suffix, up to three attempts in all; any other refusal is shown as before. The `workspace.slugLabel` and `workspace.slugHint` pack keys are left in place, now unread.
  
  **The backup-password reminder no longer appears in the user's first session.** 「建议设置一个备用密码」 showed on the environment home right after a new user built their first app: the reminder was gated on a home-visit count (quiet on the first home mount, shown on the second), and coming back to home after building is the second mount inside the first sitting. It now stays quiet for 12 hours after the first home visit on the device, so it first shows on a later day's visit. The first-visit record (`os:recovery-pw-first-seen`) now holds a timestamp; a device that holds the old `'1'` flag starts the 12 hours over rather than reading it as long ago. When storage is unavailable it stays quiet. `RecoveryPasswordReminder` moves out of `HomePage.tsx` into its own module; it is not exported from the package entry, and its other conditions (dismissed, SSO-enforced, has a local password) are unchanged.
  
  **The record header's highlight row no longer cuts a phone number.** A drawer's highlight row read 「0574-876」 for the stored `0574-8765-4321`, with no ellipsis. The phone cell draws a dial icon, the number and a copy button in one `inline-flex` box, and the chip's single-line clip cannot put an ellipsis on such a box, so a 9rem chip cut the number mid-way. `HeaderHighlight` now gives a `phone` chip the wide basis that `email` and `url` already take, so a whole number shows; the full value stays in the chip's hover title. Other field types keep their chip width.
  
  **Studio's dashboard widgets list names each widget's kind in the designer's language.** The list read 「按客户状态统计数量 · bar」: beside each title, `DashboardDefaultInspector` printed the stored `type` id. It now prints the name the add-widget picker shows for that kind (`engine.widgetPicker.type.*`, zh 「柱状图」, en "Bar chart"), with the id on hover. A type the catalogue does not know still prints its id. The stored `type` is unchanged.
  
  **Studio's automation pillar copy is plain language in zh.** The list heading read 「自动化 · flow」 and the top bar 「默认 OFF · 审阅后再启用」: an internal metadata type and an English switch state inside Chinese copy. They now read 「自动化」 and 「默认停用 · 审阅后再启用」, matching the pillar's own 已启用 / 已停用, and the canvas hint 「可视化编排 · 点选节点配置」 reads 「点选画布上的节点即可配置」. The en heading drops the type too ("Automations"). Whether the pillar is offered on a given plan is not decided here.
- c0862c1: The capability picker labels `view_all_audit_log`, the platform capability `@objectstack/spec` 17.7.0 adds to `PLATFORM_CAPABILITIES` (objectui#11717). Without the label it showed the registry's English text in every locale. All ten locale packs carry the label.
- d172f63: The marketplace load-error hint no longer tells a runtime that proxies a control plane that it serves the catalog itself (objectui#11726).
  
  When the runtime config reports `cloudUrl: ''` and a catalog load fails for a reachability reason, Browse Marketplace showed "This runtime serves the marketplace catalog itself. Check that the runtime is online." `''` says only that requests stay on this origin, and the CLI's cloud-connected `os serve` reports it while its marketplace proxy forwards to a control plane, so on that runtime the sentence was false. `marketplace.load.failedHintSameOrigin` now reads, in `en`, "The marketplace catalog is reached through this runtime. Check that the runtime is online and can reach the catalog.", and the nine other packs say the same. It names no host, because no failure the proxy returns carries the upstream host in a field or a header.
  
  A runtime that reports its control plane keeps the hint that names it, `marketplace.load.failedHintConfigured`, unchanged. No key is added or removed.
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
- 74add0c: `element:record_picker` and `element:number` bind data through the node-level `dataSource` only (objectui#11880, part of the objectui half of objectstack#11509, ruled A-narrow).
  
  - Neither element reads the flat `properties.object` / `filter` / `sort` / `limit` beside the binding any more: the `composed?.x ?? props.x` fallbacks are gone, and `element:number`'s filter is the binding's alone (the AND with `properties.filter` is gone). An element whose node names no `dataSource.object` issues no query. The flat keys stayed published, each input's description saying it is not read and naming the binding member that is, until `@objectstack/spec` retired them in 18: the record picker's four inputs left with that retirement (objectui#12030), and `element:number`'s two with objectui#12085.
  - The Studio page designer writes `element:number`'s object to `dataSource.object` at node level, and its measure picker reads the object from there. A stored `properties.object` stays visible in the inspector's Advanced section.
  - `element.number.noObject` now names only `dataSource.object`, in all ten language packs.
  
  Breaking for an author who wrote the flat keys on these two elements: move them into `dataSource`. `element:repeater` is unchanged.
- f1781be: The console's record page now says what its record read actually answered: no access, not found, or could not load (objectui#11902). It used to answer every failed read with "Record not found — The record you are looking for does not exist or may have been deleted."
  
  - **A refused read** (the `forbidden` kind of `classifyLoadError`, the shared read classifier the list view's error panel, the activity feed and the attachments panel already use: a 403, or the `PERMISSION_DENIED` envelope that comes with it) renders "You don't have access to OBJECT records", naming the object by its label. The refusal is about the object, so the page says nothing about whether the record exists, and it offers no Retry, because retrying a permission decision cannot change it. A viewer sent a link to a record they cannot read is no longer told it may have been deleted, so they can ask for access instead of reporting a lost record.
  - **A failed read** (a 5xx, a transport error, any other rejection) renders "Couldn't load this record" with a Retry button. Retry re-runs the page's own record read; when it succeeds, the record renders.
  - **Not found is unchanged.** A read that answers with no record, which is how the data adapter answers a 404, still renders today's not-found copy. A found record renders as before.
  
  The four new strings live beside the not-found rows in the `empty` namespace of every built-in locale pack (`empty.recordAccessDenied`, `empty.recordAccessDeniedDescription`, `empty.recordLoadFailed`, `empty.recordLoadFailedDescription`); the Retry button reads the existing `common.retry`.
  
  **Clause-②: no.** No export, prop, type member or accepted input changes; the new locale rows are additive.
- 417e245: An app that serves the signed-in user no navigation now opens on an app-level empty state, not on the Studio home (objectui#12079).
  
  The server filters an app's navigation per user. When every group is gated on a capability the user does not hold, the app arrives with `navigation: []`. The console's app index route found no landing page and rendered `StudioHomePage`, Studio's metadata overview, inside an app that had nothing to do with Studio. This was measured on HotCLM for its dev admin (objectstack-ai/hotclm#87).
  
  The app root now shows "Nothing in APP is available to you yet", with the app's own label. A user the console treats as a workspace administrator (`useWorkspaceAdminStatus`, the same check the console's no-app screen and Home's administration links use) gets an "Open Setup" link, at the URL the `/setup` deep link resolves. Everyone else is asked to contact an administrator.
  
  Unchanged:
  
  - An app with a landing page still opens on it.
  - The Studio app, whose navigation is full, does not get the empty state. Where its root opens instead is objectui#12113: the app's first navigation entry.
  
  New `@object-ui/i18n` keys, in all ten language packs: `empty.appNothingAvailable`, `empty.appNothingAvailableDescription`, `empty.appNothingAvailableGrantDescription` and `empty.openSetup`.
- 6757a93: Show a write answer's advisory `warnings` to the user after save (objectui#12107).
  
  - `@object-ui/data-objectstack`: `WriteWarningEvent` gains an optional `warnings` member, typed by the spec's `ValidateDataIssue` (the element of `CreateDataResponseSchema` / `UpdateDataResponseSchema`'s `warnings`). A single-record `create` / `update` parses the answer's `warnings` through `ValidateDataIssueSchema` and emits the write-warning event when either `droppedFields` or `warnings` is non-empty; `droppedFields` stays required and is `[]` when the event exists only for warnings. An answer without the key emits nothing new, including from a runtime that predates it.
  - `@object-ui/app-shell`: the write-warning toast shows each distinct warning message as the server wrote it, in its own toast titled by the new `detail.writeWarningsTitle` key. The stripped-fields toast is unchanged.
  - `@object-ui/i18n`: adds `detail.writeWarningsTitle` to all ten packs.
- c4dd707: feat(react): a page element's API data source is rendered — `dataSource: { provider: 'api', read: { url }, path? }` binds the selected answer as `data` (objectui#12197)
  
  Clause-②: yes
  
  `SchemaRenderer` now honours `@objectstack/spec`'s `ElementApiDataSourceSchema` on every node. It reads the same-origin `read.url` with `GET` through `SchemaRendererProvider`'s `apiFetch` (the global `fetch` when no host supplies one), selects `path` from the answer, and binds the value as `data` in the node's `${…}` holes and its `visibleWhen`, and in its subtree's. While the read is in flight the node draws a loading line; a failed read, or a `path` that selects nothing, draws an error panel naming why, titled in the page's language from two new keys, `element.component.apiRefused` and `element.component.apiUnreadable` (all ten packs). The binding is parsed with the spec's own schema first: a cross-origin or protocol-relative `url`, a credential key, or a non-`GET` method is refused with the spec's message and no request is sent. Elements binding the same URL at once share one request; nothing is cached.
  
  New exports: `useElementApiDataSource`, `judgeElementApiDataSource`, `isElementApiDataSourceShape`, `selectElementApiPath`, `readElementApi`, and the types `ElementApiDataSourceStatus` and `UseElementApiDataSourceResult`. A node without an API binding renders as before and issues no request.
- 068a540: The console's Setup › Apps page reports what the server did with a write (objectui#12300). Before, a Delete and a Disable could report success for a write that changed nothing.
  
  - **Delete.** When the reset door answers `reset: false` (there was no customization row to remove, so the app already is what its package ships), the page shows a neutral notice with the server's own sentence and never says "deleted". The row stays, because the server still serves it.
  - **Disable, Set as default and the bulk Enable / Disable.** A save of an app that a package owns now names that package (`?package=`, read off the served `_packageId`), so it lands on the row the server serves. A package-less app is saved with no scope, as before.
  - After every write, whatever it answered, the page re-reads the app list and shows the served state.
  
  `ObjectStackAdapter` forwards every argument of `getClient().meta.saveItem`. Its save-advisory wrapper used to pass on only `type`, `name` and `item`, so the SDK's options bag (`packageId`, `force`, `mode`, `ifMatch`) was dropped before it reached the wire, for every caller of the adapter's client.
  
  Two new `appManagement.toast` keys, `nothingToDelete` and `alreadyAtDefault`, ship in all ten language packs.
- caac3b2: A list's sort, column layout, Filter panel and tab order are now each user's own, and follow them to another browser (objectui#12418).
  
  **What changes for users.** Sorting a list, resizing or moving its columns, and dragging the tabs in Manage Views is now personal: it no longer changes the view for everyone. Before this change, a header sort or a column drag was saved into the shared view, and a Manage Views drag saved a new order onto every saved view, so one user's click re-sorted or reordered the list for every other user. Under a walled tenancy posture (`group` or `isolated`), where only the platform operator may write environment metadata, the same click ended in an error. The view's own sort, columns, filter and tab order stay the default for every user who has not changed them, and the view editor (the view settings panel and Studio) is still how an author changes them for everyone. Density and hidden fields are not part of this change: they are still saved to the view.
  
  - **Where it is kept.** One `sys_user_preference` row per user and object, key `ui.list.<object>`, holding `{ viewOrder, perView: { <view id>: { sort, filters, columnState } } }`. The console reads every such row in its one preference read at load (objectui#12187), so this adds no request. localStorage (`list-state:<user>:<object>`) is the write-through cache, and the only store when no preference backend is attached. The first read of an object with nothing cached takes that browser's older tab order (`viewOrder:<object>`) and Filter panel conditions (`list-filters:…`). The search term stays where it was.
  - **Opening a list.** A list now opens on the user's stored sort and Filter panel conditions, and the page waits until the preference read has answered (2.5 s at most) before drawing it. A link that carries list state still wins over the stored state, as before (objectui#11860).
  - **Resetting.** The Filter panel's "Clear all" clears the user's stored filters for the view. A new "Reset view" entry in the page header's ⋯ menu, beside the favorites entry, appears when the user has stored anything for the active view. It drops that view's sort, filters and column layout and opens the list as the view declares it. An administrator can delete a user's row under Setup → User Preferences.
  
  `@object-ui/data-objectstack` adds `createObjectStackUserPreferenceFamily` (with the `UserPreferenceFamily` and `ObjectStackUserPreferenceFamilyOptions` types and the `PREFERENCE_FAMILY_ROW_LIMIT` constant). It loads every row whose key starts with a prefix, through the same shared read as the per-key adapters. A read that includes a prefix asks for its keys or that prefix, with a `$top` of the key count plus 200 rows per prefix. When an answer fills that `$top`, a key whose row is missing from it reads its own row. `createObjectStackUserStateAdapter` keeps its signature and its behaviour.
  
  `@object-ui/i18n` adds `console.objectView.resetView` and `console.objectView.resetViewTitle` in all ten packs.
- 3821a3a: List toolbar: the Filter, Export and Add record buttons keep an accessible name when they render icon-only below the `sm` breakpoint (objectui#12500). Each carries an `aria-label` from the same i18n key as its visible label. With filters active, the Filter button's name carries the count through the new `list.filterActive` key ("Filter, {{count}} active"), added to all ten locale packs.
- 3eb3ec1: The console's list toolbar no longer has a write into the shared view, and the data-source method that write used is retired (objectui#12504).
  
  **BREAKING:** `DataSource.updateViewConfig` is removed from `@object-ui/types`, and `ObjectStackAdapter.updateViewConfig` is removed from `@object-ui/data-objectstack`. The capability gate that only that method read goes with it: `ObjectStackAdapter.setSystemCapabilities`, the `systemCapabilities` option of the adapter constructor and of `createObjectStackAdapter`, `VIEW_CONFIG_CAPABILITY`, `ViewConfigPermissionDeniedError` and `isViewConfigPermissionDeniedError`. A class that implements `DataSource` and keeps an `updateViewConfig` method still compiles, but nothing calls the method any more; an object literal annotated as `DataSource` that carries it is refused as an unknown property. Code that calls `updateViewConfig` through a `DataSource` or an `ObjectStackAdapter`, or imports one of the gate names, no longer compiles. To change a view for everyone, save the view: `createView` / `updateView` on the data source, or the console's view editor, which writes through the runtime metadata seam.
  
  Since objectui#12418 and objectui#12474, the toolbar's sort, column layout, density and Hide Fields are each user's own list state, so the toolbar write had no caller. The view editor's explicit save is now the one write path to the shared view, and it is unchanged.
  
  Personalization rows that earlier consoles wrote into `/meta/view` stay readable: the overlay marker, `narrowPersonalizationOverlay` and `listViews()` exclusion still apply to them. Nothing new writes such a row.
  
  `@object-ui/i18n` drops `console.objectView.viewConfigPermissionDenied` from all ten packs. It was the toast the retired write raised when the gate refused it. The other packages change only in comments and tests that named the retired path.
- 646caea: The object list's chrome sits on fewer rows (objectui#12528).
  
  - **The view description no longer takes a row above the toolbar**, so the toolbar sits at one height with or without one. The console's view tab strip draws it on the active tab: as the tab's tooltip and as the header of its ▾ menu. `ViewTabItem` gains an optional `description` (already resolved, already gated on `appearance.showDescription`; `false` still shows it nowhere). A `ListView` with no host tab strip (the console below `sm`, any other host) draws it as an info control at the start of its toolbar row.
  - **The sort popover's standing note about linked columns is an info control** beside the popover's title, the note as its tooltip, instead of a paragraph that took about half the popover on every open. One line (`list.sortRelationalPicked`, in every locale pack) says that a linked column sorts by the stored ID, only while the current sort names one.
  - **One footer row on an aggregated list.** `ObjectGrid` gains an `onColumnSummaryChange` host prop: when it is passed the grid draws no summary row of its own and reports, in column order, what that row would draw. `ListView` passes it and draws the summaries at the right of its record-count row, truncated with the full text as their tooltip.
  
  **Clause-②: yes (widening).** Two optional members widen published types: `ViewTabItem.description` in `@object-ui/plugin-view` and `ObjectGridComponentProps.onColumnSummaryChange` in `@object-ui/plugin-grid`. Both are host props on React components, never authored metadata.
- a5bb7ac: Inside an app, the product mark stays in the top bar as the way home, and the app menu gains Back to home, All apps and Settings (objectui#12605).
  
  - **The product mark is back in the app bar.** The bar's left group reads: the sidebar trigger, the product mark, a `/` rule, the app pill and the preview chip. The mark is the one the home page draws: a 32 px button holding a 24 px tile on `--primary` with the stack glyph, or the deployment's logo. It is named "PRODUCT home" from the configured product name and links to home. It sits at the same x on every surface: off an app, where there is no sidebar trigger, the trigger's slot is held empty before it.
  - **`⌘⇧H` / `Ctrl+Shift+H` goes home** from any app page. It pushes a history entry, so the browser's Back returns to the page. A key press in a text field, a select or a content-editable region is left to that field. The keyboard-shortcuts dialog lists the shortcut inside apps.
  - **The app menu.** The "Switch Application" group lists the installed apps with the current one checked. The Setup app is no longer in this group. After a divider come "Back to home" with its `⌘⇧H` keycaps, "All apps" and "Settings", which opens the Setup app. "Settings" is shown only when the viewer's app list includes the Setup app. "Edit APP in Studio" keeps its existing gate and now follows a second divider.
  - **Below 640 px** the app pill shows the app's glyph only. The app's name is in the pill's tooltip and accessible name. The pill was previously hidden at this width.
  
  Language packs: `layout.appSwitcher.backToHome`, `layout.appSwitcher.settings`, `layout.appSwitcher.productHome` and `console.shortcuts.goHome` are added in all ten locales. No package export is added.
- 8a8bcf3: Setup › Packaged automation keeps a flow row to the table's height when the platform says why the flow is not armed (objectui#12609).
  
  The runtime's `reason` sentence for an enabled flow that is not armed used to render as a paragraph under the flow's name, so every such row grew to several lines and the table stopped scanning as a table. The sentence now opens from a small "Details" chip on the name's line, in a popover that shows it whole and unedited, in muted text. A row without a reason shows no chip and renders as before.
  
  The chip does not say what the reason is. Its label is the same on every row that carries a reason, whatever the sentence says, because the contract says the field is rendered and never parsed, and a deployment-policy row and a binding failure arrive in the same shape. The activation switch still shows the flow's `enabled` field, as before.
  
  **Clause-②: yes (widening)**: `@object-ui/i18n`'s ten locale packs gain one key, `packagedAutomation.reasonDetails`. No export, prop or other key changes on either package.
- f74638c: **`marketplace.installedAdditiveNote` is plain text in all ten packs** (objectui#12610). Each value dropped its leading `<strong>Note:</strong>` markup (in that pack's language); the sentence after it is unchanged. The console draws the key as the tooltip of Installed Apps' Uninstall, which renders text, not HTML. The key's name does not change.
  
  **Clause-②: yes.** The value is part of the published `en` pack and its nine siblings. A consumer that rendered this key as HTML now renders the same sentence without the bold "Note:" prefix; one that rendered it as text no longer shows literal tags.
- 8614705: A kanban under a list view puts every record of the view in its column, not the list's first page, and its cards carry the view's first columns (objectui#12619).
  
  Measured on HotCRM's 45 opportunities at Display › Layout › Kanban: the board drew 25 cards (the grid's Rows per page), the closed columns read 0, the footer read "Showing first 25 records. More data may be available.", and each card showed only the record's name.
  
  - **Each lane is its own query.** `ListView` no longer hands its board the rows it fetched for the grid. It hands it the view's query, and the board asks each lane for its first 50 records: the view's filter (toolbar filters and chips included) AND the lane value, in the view's sort, with the toolbar search. The lane's count in its header is the server's count from the same answer. A lane holding more shows **Load more** at its foot. One more query finds the records in no lane (a lane value that is none of the lanes, or empty) for the trailing Uncategorized lane. A refresh asks each lane again at the depth it was loaded to. Dragging a card between columns writes the lane value and asks for the required fields as before, and both lane counts follow the card.
  - **The list footer counts the view.** It shows the view's record count from the list's own query, with no "Showing first N records" line and no Rows per page picker on such a board.
  - **Which boards page their lanes.** A board whose lanes are known before the query (the lane field's options) and that draws no swimlanes. Any other board under a list view is handed the list's rows, as before. A standalone `object-kanban` keeps its one query, capped by `limit`.
  - **Cards carry the view's first columns.** With no `kanban.columns` of its own, a list view hands the board the view's next two columns past the card title, the lane field and the owner field, by field name. Before, a card drew no field lines from the view's columns. Below its name it showed at most a subtitle the board derives from the record where the record yields one (an amount and an account, say). On HotCRM's measured board it showed the name alone: that view's columns are `{ field }` entries, handed over whole, which the card read as field names and matched none. The kanban block's `columns` is the author's card list and is used whole.
  - **A card field is a line with its label.** Each card field now shows its label, muted, before its value. The label used to be a tooltip only. The card's reduced padding between its title and its first field line now holds at every breakpoint; from the `sm` breakpoint up it had widened back to the full padding.
  - **The owner's avatar.** When the object gives its records an owner (the spec's `ownership` model and `SystemFieldName.OWNER_ID`, read through `resolveInjectedSystemColumns`), each card shows the owner's avatar from the expanded owner record, as the viewer may read it.
  
  Public surface: `ObjectKanbanComponentProps` gains two optional host props, `lanePaging` (`{ search?, searchFields?, reloadKey? }`) and `ownerField`. Neither is an authoring key on the `object-kanban` node. `@object-ui/i18n` gains `kanban.loadMore` in every language pack.
- ca7a4c3: Record forms draw `date` and `datetime` fields with the platform date picker instead of the browser's native date input (objectui#12622).
  
  The picker is a text box in the display locale's format (`10/16/2026` in English, `2026/10/16` in Chinese), with a calendar popover, keyboard entry, a clear button, and Today / Tomorrow shortcuts. The native input took its placeholder and digit order from the machine, so an English console could show a Chinese machine's placeholder.
  
  - **The value written is unchanged.** A `date` field writes `YYYY-MM-DD` and a `datetime` field writes an ISO instant, as the native inputs did. Clearing writes an empty value, as before. Typed text that names no date is not written: the box is marked invalid and a notice names the expected format.
  - **Where it applies.** The form registration of `field:date` / `field:datetime` (what `registerField` / `registerAllFields` register) takes the picker, and so does `getLazyFieldWidget` (the action-param and bulk-action dialogs, objectui#12642). The inline editors draw it too (objectui#12664, objectui#12759). A form without `@object-ui/fields` registered keeps the native input. The read-only face is unchanged.
  - **New language-pack keys** in all ten packs: `fields.datePicker.today`, `tomorrow`, `clear`, `openCalendar` and `invalid`.
- efa9cb4: The cloud-connection panel's "Not connected" card no longer repeats the page subtitle (objectui#12655).
  
  The card's body (`cloudConnection.unbound.body`) opened with the same sentence as the page header subtitle above it, so an admin read it twice. It now says the state and what the Connect button does: the runtime is not connected to a control plane, and Connect opens the cloud account in a new window, where one click approves the link, with no ids or credentials typed into the page. It names no control plane, because nothing the panel is served says which one Connect binds to. All ten language packs carry the new text in their own language. The key name is unchanged.
- 670ea10: **`marketplace.installedAdditiveNote` says what uninstall does now, in all ten packs** (objectui#12684). The note on a loaded marketplace row's Uninstall (its tooltip and accessible description on Setup › Packages) said the running kernel keeps the app registered until the runtime restarts. objectstack's `DELETE /api/v1/marketplace/install-local/ID` now withdraws the package from the running kernel at once (objectstack#21576). The note now says that the app leaves the running kernel at once, with its permission sets and their grants, that the cached manifest is deleted so the package does not load at the next start, and that the records stored in its objects stay in the database. Each pack carries its own translation. The key's name and its plain-text shape do not change.
  
  **The Uninstall confirm and result lines say the same thing.** `marketplace.uninstall.confirm` (the question on both the Packages row and the package page), `marketplace.uninstall.successInList` and `marketplace.uninstall.successInDetail` no longer say the app stays loaded until the next restart, and no longer tell the operator to restart the runtime. They say that the app leaves the running kernel at once with its permission sets and their grants, that the cached manifest is removed, and that the records stored in its objects stay in the database. Every interpolation token each value used is kept. The not-loaded texts (`confirmNotLoaded`, `successNotLoaded`) do not change.
  
  **Clause-②: no.** No export, prop or type changes; existing values change in each pack.
- ff215d9: A settings row's source badge reads in the session's language, verb included (objectui#12694). The badge beside a setting's label said where its value comes from as an English verb beside a translated layer name, so a zh-CN admin who saved a workspace value read "Overrides 默认".
  
  - **`@object-ui/i18n`** adds `console.settingsView.sourceBadgeInherited` and `console.settingsView.sourceBadgeOverrides` to all ten bundles. Each is one sentence with the layer's name as `{{source}}`, so a language puts the layer where its grammar needs it. The English values are the old wording, so an English session reads exactly as before.
  - **The console's settings page** draws both badges from those keys. The layer's name is still the server's `settingsCommon.sourceLabels` label.
  
  No export, prop or type is added, removed or renamed.
- a23e804: Browse Marketplace says what it is loading, and a failed catalog read names its class and offers Retry (objectui#12710).
  
  The catalog is a remote read. The page drew six skeleton cards for as long as it took, and a network that drops the request left them there forever, with nothing saying what was loading. Now:
  
  - the skeleton stands for at most two seconds of a read; after that one line under the search box reads "Loading the marketplace catalog…", and after ten seconds "Still loading — the marketplace catalog is slow to answer." with a Retry button. A read that answers within two seconds never shows the line;
  - a failed read is drawn in the catalog's place: "Failed to load marketplace", then whether the catalog could not be reached (no server answered) or answered with an error (with its HTTP status), the server's own text and, when being online is the cause, the existing hint, with a Retry button;
  - Retry issues the same read as the header's Refresh, and a read that answers after a newer one was issued no longer changes the page. The Installed button and the "Your organization" packages stay usable while the catalog has failed.
  
  New `marketplace.load.*` strings (`loading`, `slow`, `retry`, `unreachable`, `answeredError`) are in all ten language packs.
- 36e2f7b: The kanban board's drag-and-drop tells a screen reader the card's title and the column's label, in the console's language, instead of the record id and the option value (objectui#12716).
  
  The board's `DndContext` passed no `accessibility` announcements, so dnd-kit read its default English sentences, which name the dragged card and its target by their ids: "Draggable item gZguOoFVfxm_pSPG was moved over droppable area 4iDmJaZr0O0St1fb". The board now hands it announcements built from what is on screen, after the form designer's (objectui#11802):
  
  - **Pick-up:** "Picked up Content backlog in To Do."
  - **Over a card:** "Moving Content backlog over SEO migration plan in In Progress." **Over a column's empty area:** "Moving Content backlog over Done." **Over nothing:** "Moving Content backlog. It is not over a column."
  - **Drop:** "Moved Content backlog to In Progress." when the board moves the card to another column, and "Dropped Content backlog. It stays in To Do." when the drop moves nothing (its own column, itself, or nothing).
  - **Cancel:** "Cancelled moving Content backlog. It stays in To Do."
  
  Each id is resolved the way the board's drop resolves it, so the column a sentence names is the column a drop there lands in. A card or column with a blank title, or one the board no longer holds, is named "an untitled card" or "an unnamed column", never by its id.
  
  `@object-ui/i18n` gains nine keys under `kanban.dnd` in all ten language packs (`start`, `overCard`, `overColumn`, `overNone`, `moved`, `dropped`, `cancelled`, `untitledCard`, `unnamedColumn`). Each sentence is one key with the names interpolated, so a language orders them as it needs. A board with no translation provider reads the same English sentences.
  
  Nothing else on the board changes: drag behaviour, sensors, collision detection, the screen-reader instructions and the existing strings are as they were. Nothing is added to `@object-ui/plugin-kanban`'s entry: no export, prop or type.
- 8d80845: An SSO sign-in reads in the session's language on both login pages (objectui#12762). The console's login page and app-shell's `DefaultLoginPage` passed `LoginForm` none of its four SSO labels, and no bundle had keys for them, so a non-English console showed `LoginForm`'s English defaults: "Sign in with your organization's single sign-on" and "Use a password instead" under SSO-only mode, and "Sign in with SSO" and "Back to single sign-on" once the password form was opened.
  
  - **`@object-ui/i18n`** adds `auth.login.ssoButton`, `auth.login.ssoOnlyDescription`, `auth.login.usePasswordText` and `auth.login.backToSsoText` to all ten bundles. The English values are `LoginForm`'s own defaults, so an English session reads exactly as before.
  - **Both login pages** pass those four labels. **`DefaultLoginPage`** also passes the ten phone and verification-code labels (`emailOrPhoneLabel` through `usePasswordSignInText`), from the `auth.login.*` keys the console's page already read, so its phone sign-in is translated too.
  
  Both pages now pass every `LoginFormLabels` member. No export, prop or type is added, removed or renamed.
- 64acb7e: A settings row's chips read in the session's language (objectui#12821). The env-lock chip said "Locked by env" in every language, and its title, shown when the server names no reason, was English too; the `Deprecated` chip (with its replacement key) and the row drawn for an unsupported specifier type were English literals as well.
  
  - **`@object-ui/i18n`** adds `console.settingsView.envLockBadge`, `envLockBadgeTitle`, `deprecatedBadge`, `deprecatedBadgeReplacedBy` (with `{{replacedBy}}`) and `unsupportedSpecifierType` (with `{{type}}`) to all ten bundles. The English values are the old wording, so an English session reads exactly as before.
  - **The console's settings page** draws those chips from these keys. A reason the server sends (`lockedReason`, such as "Set via env: NAME") is still shown as served.
  
  No export, prop or type is added, removed or renamed.
- 4ff5b6b: The kanban board's card lists and drag overlay are now named in the viewer's language. A lane's card list, a swimlane cell's card list and the drag overlay used English templates around the label ("To do cards", "To do - ann cards", "Dragging Content backlog"), so under zh a screen reader heard "待规划 cards". Each name is now one pack sentence with the label interpolated (`kanban.columnCards`, `kanban.laneCards`, `kanban.dnd.dragging`), in all ten language packs. English reads as before.
- 473e5a0: The console no longer calls two different things "workspace" (objectui#12851).
  
  - **The organisation is "Organization"** in every pack (zh 组织, ja 組織, es Organización, de Organisation, fr organisation, ko 조직, pt organização, ru организация, ar مؤسسة): the `workspace.*` switcher and create-dialog strings and the `organizations.*` picker, such as "My Organizations", "Create organization", "Your Organizations".
  - **The running instance is "Environment"** (zh 环境, ja 環境, es entorno, …) wherever a string is read inside one: the Setup subtitle and its settings category, the environment-timezone prompt and the cloud home's timezone line, the tenant sign-in hint, the "Build an app" refusal, the home loading and empty states, and the "System settings" quick action.
  - **The cloud home's open button reads "Open"** (zh 打开), and the hint under it says in one line what an environment is: an independent instance that runs your apps, with its own URL, database and plan.
  - The marketplace install refusal now asks you to contact your organization admin, in every pack.
  
  Keys are unchanged; only values moved. "AI Workspace" (the assistant's full-page work area) keeps its name, because it names neither the organisation nor an environment.
- b279016: The OAuth consent page names the three agent scopes in words. An MCP client that asks for `data:read`, `data:write` or `actions:execute` used to show those as raw strings in the "This app will be able to:" list. Each now reads as one sentence: reading records, creating, changing and deleting records, and running actions on the user's behalf, each within the user's own permissions. The three sentences are new keys under `oauth.consent.scope` (`dataRead`, `dataWrite`, `actionsExecute`) in all ten language packs. Any other scope still shows as its raw string.
- bb6c38c: A refused activity read now shows one neutral sentence, "You don't have permission to view activity.", on Home's activity card and in the header bell's Activity tab. Home used to say "…activity on this record", where there is no record, and the bell showed "An unexpected error occurred.". The new key `layout.activityFeed.accessDenied` is in all ten language packs. The record activity panel keeps its own sentence. Any other failure still shows the generic error.
- 2727527: The Console top bar no longer flashes a green "Connected" chip for two seconds after load (objectui#12891).
  
  A successful connect draws nothing from the first frame: the 2000 ms timer is gone. The connecting, reconnecting, disconnected and error chips are unchanged. The `topbar.connection.connected` language-pack key had no reader left and is removed from all ten packs.
- 2cfdc99: All ten language packs gain the keys the `element:*` blocks in `@object-ui/components` now read for their defaults (objectui#12910): `element.number.sourceUnresolved`, `element.image.noSource`, `element.recordPicker.sourceUnresolved`, and the `element.metadataViewer.*` block for `element:metadata_viewer`. No existing key or value changes.
  
  Clause-②: yes
  
  The new keys widen the exported `TranslationKeys`. Nothing narrows.
- 1e6d83b: All ten language packs gain the panel titles the data-bound blocks now read for an unresolvable `dataSource.view` (objectui#12920): `element.KIND.sourceUnresolved` for `calendar`, `chart`, `pivotTable`, `detailView`, `relatedList`, `form`, `lineItems`, `gantt`, `grid`, `board`, `listView`, `map`, `timeline` and `component`, plus `element.component.noDataSource` for the no-adapter panel and `element.relatedList.parentUnreadable` for `record:related_list`'s failed parent read. No existing key or value changes.
  
  Clause-②: yes
  
  The new keys widen the exported `TranslationKeys`. Nothing narrows.
- 7f9cc37: Console copy names the system the user is already in, not the cloud noun "environment" (objectui#12956). Inside a running deployment, the Settings subtitle and its first category, the timezone prompt, the read-rate banner, the sign-in, sign-up and email-verification notices, the profile password descriptions, the home page loading, empty and build-refusal states, the system-settings quick action, the Connect-an-agent endpoint card and the AI model status error now say "this system" (zh 「本系统」), or drop the noun where the sentence reads without it. The Settings category that holds Company, Branding and Localization reads "General" (zh 「常规」). All ten language packs follow; no key is renamed, added or removed. Inline English fallbacks at the call sites follow the `en` values.
- 76f91f8: feat(plugin-chatbot): a drafted result's Preview button appears for any draft kind, and the draft preview bar names what is pending on the surface it shows (objectui#12968)
  
  Clause-②: yes — `ChatbotEnhancedProps` gains the optional `onPreviewDraft`.
  
  **`@object-ui/plugin-chatbot`.** A drafted tool result whose items include no app now draws a
  Preview button beside Publish and Review when the host passes `onPreviewDraft(items, { appSegment })`.
  The click hands the host the drafted `{ type, name }` items and the owning package id, the app's route
  segment. A draft set that includes an app keeps `onPreviewDraftApp`, unchanged, and a host that passes
  no `onPreviewDraft` draws what it drew before. Preview publishes nothing. The confirm path previews
  too: `detectReplayOutcome` lifts a drafted replay's `drafted[]` items into the exported `ReplayOutcome`
  as the optional `items`, and the applied card (or, from an older cloud, the drafted badge) draws the
  same Preview over them through the same `onPreviewDraft` / `onPreviewDraftApp` rule.
  
  **`@object-ui/app-shell`.** In draft preview (`?preview=draft`), the DraftPreviewBar's message names
  how many pending drafts belong to the surface it shows: an object's list, view or record, a page, a
  dashboard or a report. The count is read from the same pending-drafts list as before. The preview's
  deep-link table (`preview/draftSurface.ts`, `draftPreviewPath`) maps drafted items to the route that
  shows them: a page to that page, a view to the object's list on that view, a field or object to the
  object's default list, anything else to the app. The console wires it: `ChatPane` passes
  `onPreviewDraft`, and a field, view or page draft's Preview opens the Live Canvas at that path, in
  draft preview; `LiveCanvas` takes the full preview path beside the app segment (`path`). An app
  draft's Preview opens the app as before.
  
  **`@object-ui/i18n`.** `preview.draftBar.pendingHere`, a plural family, in all ten packs.
- ea34d9b: The help menu gains an About entry on every console bar (the tenant console and the control plane draw the same header). It opens a small dialog naming the build the console was compiled from: `VITE_APP_VERSION` from the build's environment, or, when that is unset, the short sha of `HEAD` that the console's Vite config reads from git at build time. A console built with neither says "Unknown build" in words instead of showing an empty field.
  
  The dialog and Sentry's release fallback read the same value through one reader, so the two can no longer name different builds. The text comes from new `help.about*` keys in all ten language packs.
- cb80001: The Import Wizard no longer offers "Run automations & triggers" or "Import as historical data" (objectui#12985). Both import doors (`POST /api/v1/data/:object/import` and `/import/jobs`) honour `runAutomations: false` and `treatAsHistorical: true` for the system principal only and refuse every signed-in caller `403 PERMISSION_DENIED` (objectstack-ai/objectstack#24348). A user who unticked the first box or ticked the second had the whole import refused.
  
  - **The two options are gone** from the wizard's options panel, with their state. The wizard's import, dry-run and background-job requests carry neither `runAutomations` nor `treatAsHistorical`. Leaving both keys out is the server's declared default, so the default import is unchanged: automations run and the state machine is walked.
  - **Language packs.** The three keys only those options read, `grid.import.optRunAutomations`, `grid.import.optTreatHistorical` and `grid.import.optTreatHistoricalHint`, are removed from all ten packs and from the wizard's English fallback map. The locale objects exported under `@object-ui/i18n/locales/*` lose those three members.
  
  Nothing else on either package entry changes: `ImportWizardProps` and `ImportResult` are unchanged, and `ImportRequestOptions` in `@object-ui/types` still declares both fields, because the server still accepts them from the system principal.
- 6f877f1: An assistant answer reads well in the narrow assistant panel (objectui#13032). Headings inside a chat answer render at chat size (15–16px, bold, set apart by weight and spacing instead of the article-page 20–30px scale). Tables use 13px text and keep their first column frozen while the other columns scroll, and when the columns overflow the panel the table's expand control becomes a labelled, clearly visible "Expand" button. A finished answer taller than two heights of the conversation viewport is folded, with "Show full answer" and "Collapse" controls; an answer is never folded while it is still streaming. The scroll-to-bottom button now sits in its own row below the message list instead of floating over it, so it never covers text, a table or a heading. The four new strings ship in all ten locale packs.
- 1ce0711: A deep link to an object read by name always leaves the "Opening your console…" splash (objectui#13052).
  
  Opening an app route for an object outside the app's package (`/apps/APP/OBJECT`) reads that object by name. When the server refused it, the console waited on the boot splash for good:
  
  - **A disabled package is an answer.** `404 OBJECT_PACKAGE_DISABLED` (the object exists, its package is disabled) now settles the route like a plain absence. The route draws the "Object Not Found" view inside the app shell with a sentence that names the disabled package. `404 RESOURCE_NOT_FOUND` draws "Object Not Found" as before.
  - **A failed read has an exit.** A 5xx, a network drop, or a 4xx carrying a code this build does not know no longer holds the splash. The route draws a "Couldn't load records" state inside the shell with a Retry, which asks for the object once more. A failed read is not asked again on every render: Retry, a metadata refresh or an invalidation asks it again.
  
  `isMetaItemAbsentError` (`@object-ui/data-objectstack`) still answers "absent" for `RESOURCE_NOT_FOUND` only; the console classifies the refusal at its own read site. One language-pack key is added, `console.objectView.objectPackageDisabled`, in all ten packs. Nothing is added to the package entry: no export, prop or type member.
- 9eb1479: Keyboard access to the console: a "Skip to content" link, and record dialogs that open on their first field (objectui#13130).
  
  - **Skip to content.** The console shell's first Tab stop is now a "Skip to content" link. It stays out of sight until it is focused. Activating it moves focus to the element that holds the page, so the next Tab reaches the page's first control without walking the app bar and every sidebar entry. It moves focus without writing a hash into the URL. Its text is the new `console.skipToContent` key in all ten language packs.
  - **Create/Edit dialogs open on their first editable field.** `ModalForm`'s dialog opened with focus on its Close button (the master-detail dialog on one of its buttons), never on a field. Its body (the object schema, the record on edit, and the field widgets) loads after the dialog opens, so when the dialog took focus no field was there yet. While the body loads, the dialog now keeps focus on itself. When the fields arrive, focus moves to the first field that can be edited, skipping disabled and read-only ones. If the user has already moved focus to another control, focus stays there. This covers both of `ModalForm`'s dialogs: the flat form and the master-detail form.
  
  No export, prop or schema key is added.
- 74e37aa: The inbox header's breakdown line agrees in number: "1 notification" and "1 pending approval", no longer "1 notifications" and "1 pending approvals" (objectui#13133).
  
  `notifications.badgeNotifications` and `notifications.badgeApprovals` were interpolated with named placeholders (`{{unread}}`, `{{approvals}}`), so i18next never chose a plural form and every language pack had one string for every count. The inbox popover now passes `count`, and each of the ten packs carries the plural family its language needs (`_one` / `_other`, plus `_many` in es, fr and pt, `_few` / `_many` in ru, and all six categories in ar), worded as each pack already words `notifications.approvalsPending`. The ja, ko and zh slots repeat one string.
  
  A host that overrides these two keys in its own resources must spell `{{count}}` instead of `{{unread}}` / `{{approvals}}`. No export, prop or type changes.
- 961b69f: A settings value can go back to unset, and an override back to the inherited value (objectui#13145).
  
  - **`@object-ui/console`**: emptying a text, email, URL, phone, password or textarea box on a settings page (and the free-text box of a `valueDomain` select) now saves the key as `null`, which the settings service reads as "clear this layer's value", instead of `""`. A cleared SMTP host is no longer refused as incomplete; a key the server requires with no default is still refused, as before. A row whose source badge reads "Overrides" gains a small "Reset to default" action beside the badge: it clears the key in the draft, Save sends it as `null`, and the badge then shows what the server answers for the row.
  - **`@object-ui/i18n`** adds `console.settingsView.resetToDefault` to all ten bundles.
- 52907d7: Settings pages: when the server refuses a save field by field, the toast now names the refused settings by the labels their rows show, for example "1 setting needs attention: Default timezone" (objectui#13146). It used to repeat the server's log sentence, which named the namespace and each machine key, called every refusal "incomplete" even for a malformed value, and repeated each row's whole message, help text included. Each row still shows its own reason. A refusal that names no setting on the page toasts "Save failed", and a refusal with no field errors still shows the server's message.
  
  The sentence is the new `console.settingsView.fieldErrorsToast` plural family, in all ten packs. The labels are joined with each pack's `validation.formInvalidJoiner`.
- f466b0a: The Studio's Pending changes summary agrees each type with its count: "2 items · 2 flows", "4 items · 1 flow · 3 views". Known metadata types read through a new `preview.changes.typeCount.*` count family in every pack, each in that language's own word order; a type with no row keeps its raw name.
- 673a71c: Setup › Packaged automation no longer shows "On" for a packaged flow that does not run (objectui#13159). When the engine reports a flow as enabled but not armed — the automation status row carries an `unboundCause`, as every packaged schedule flow does while the deployment keeps package-authored scheduled work off — the Activation badge reads "Not running here" instead of "On". The switch beside it still shows and writes the activation flag, and the platform's sentence for why stays behind the row's Details chip. Bound flows, flows with no trigger and switched-off flows read as before. After a toggle the page reads the automation status again, because the toggle's answer carries the flag alone and the flip can change what the engine armed.
  
  `@object-ui/i18n` adds `packagedAutomation.notRunning` to all ten language packs.
- 58798ec: An admin overriding an approval REASSIGN is now told what a reassign does (objectui#13164). The approvals action bar gave every override lever the decision sentence — "it finalises the step immediately and bypasses the approvers who have not acted" — so the Override Reassign dialog promised a finalised step while the server leaves the request pending on the new approver. A reassign override now reads that the step moves to the new approver you pick, replacing the approvers who have not acted (named when known), that the request stays pending and waits on the new approver, and that the reassignment is recorded as an admin override. The lever is read off the declared action's `target` route, the same reading the bar already makes for decision outputs. Approve and reject overrides keep their sentence unchanged.
  
  All ten language packs gain `approvalsInbox.overrideReassignNotice` and `approvalsInbox.overrideReassignNoticeWho`. No existing key or value changes.
  
  Clause-②: yes
  
  The new keys widen the exported `TranslationKeys`. Nothing narrows.
- 8803ca5: fix(app-shell): the save warning has a sentence of its own for a value a stored expression replaced
  
  objectstack-ai/objectstack#24778 gives the write path a fifth strip reason,
  `stored_expression`: a stored field whose declared expression the engine computes
  on every write keeps the computed value, not the one the caller sent. The save
  warning words that reason as what it is — "Computed from the record, so the
  computed value was saved instead of the one sent: …" — through a new
  `detail.writeStrippedStoredExpression` key in all ten locale packs, and never as
  a read-only lock.
  
  The reason table stays exhaustive over the spec's union, widened ahead by the one
  literal so it compiles both against the published `@objectstack/spec` (which does
  not name the arm yet) and against objectstack's own spec, which the objectstack
  Console Pin Gate builds this package with.
  
  When the sentence reaches a user: the adapter judges a reported reason against
  the spec release this bundle is built with, so until that release declares
  `stored_expression` such a report is still shown as "Not applied by the server: …"
  — truthful, but without the cause. The new sentence is used from the spec release
  that declares the arm on.
- e70c21d: The console's remediation overlay offers "Stop impersonating" on an impersonation session (objectui#13208). The overlay covers the whole console, the impersonation banner included, so an administrator who impersonated a user held by `PASSWORD_RESET_REQUIRED`, `PASSWORD_EXPIRED` or `MFA_REQUIRED` was shown that user's own change-password or authenticator-enrolment form, and could only leave by signing out. When the session carries `impersonatedBy`, the overlay now says the user must do it themselves, offers neither form, and offers "Stop impersonating" beside "Sign out instead". The stop is the banner's own exit, shared rather than copied. Once the administrator's session is restored, the overlay clears the gate and reloads. A stop that fails, or that restores nobody, keeps the overlay up and says so. On an ordinary session the overlay is unchanged, and it still appears for whatever posture the server reports.
  
  The impersonation banner no longer reports a later impersonation as a failed stop. After a stop that worked, impersonating someone else without a reload showed "The server accepted the request but did not restore your administrator session" on the new session, which nobody had tried to stop. The outcome of a stop now answers only for the session it was made from.
  
  `@object-ui/i18n` adds three strings under `auth.remediation.impersonation` (`passwordTitle`, `mfaTitle`, `body`) in all ten locale packs.
- 06be396: The approvals Recall button no longer calls a submitter's own recall an override, and an admin recalling someone else's request is told what a recall does (objectui#13225). `approval_recall` ORs in the admin-override arm alongside its submitter arm, so the action bar labelled it "Override Recall" for every override-capable viewer, the submitter included, and gave it the decision sentence: "it finalises the step immediately … The decision is recorded as an admin override." The server does neither on a recall: it withdraws the request, clears its pending approvers, and writes a `recall` action row with no override marker.
  
  - A submitter, admin or not, now sees the plain Recall. `isOverrideDecision` no longer counts a lever as an override when the viewer holds it through its submitter arm (the served `is_submitter` flag, read for any lever whose declared gate names it).
  - An admin who did not submit the request still sees "Override Recall", and its notice now says the request is withdrawn, the record is unlocked, and the approvers who have not acted can no longer act on it (named when known). It says nothing about finalising the step or an override record.
  - Approve, reject and reassign overrides read exactly as before, and the request the bar sends is unchanged.
  
  All ten language packs gain `approvalsInbox.overrideRecallNotice` and `approvalsInbox.overrideRecallNoticeWho`. No existing key or value changes.
  
  Clause-②: yes
  
  The new keys widen the exported `TranslationKeys`. Nothing narrows.
- 7c05f21: Import wizard: the result screen now says what happened. An import that imported every row still shows the green check and "Import Complete"; one that imported some rows but skipped or rejected others reads "Import finished with errors" with a neutral icon; one that imported nothing — every row rejected, the request refused (405) or failed, or the background job ended `failed` — reads "Import failed" with an error icon, and its "0 imported" count is no longer drawn as the primary badge. The counts and row errors are unchanged. New `grid.import.importPartial` and `grid.import.importFailed` strings in every locale.
- 8a25fee: Kanban cards no longer tell screen-reader users to press the space bar. Each card's accessible description is now a sentence from the `kanban.dnd.instructions` bundle key, in the viewer's language, saying that a card moves to another column by dragging it with a pointer or by touch. The board has no keyboard drag, so the description names no key. The package README's "Accessible" line now says the same.
- Updated dependencies [c4c506b]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [c0862c1]
- Updated dependencies [f34e877]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [5f75cfa]
- Updated dependencies [334f0cf]
- Updated dependencies [7af0ab3]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [f62b6ff]
- Updated dependencies [260ef71]
- Updated dependencies [26323c4]
- Updated dependencies [fb501bc]
- Updated dependencies [025130c]
- Updated dependencies [2493e85]
- Updated dependencies [61ed5ad]
- Updated dependencies [9f1dd79]
- Updated dependencies [616df65]
- Updated dependencies [3c3115e]
- Updated dependencies [b13ea3c]
- Updated dependencies [3fd8625]
- Updated dependencies [d328698]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [12dc7b4]
  - @object-ui/core@18.0.0

## 17.7.0

### Minor Changes

- 6cc910b: A field-backed action param reaches its record picker, and a param whose backing
  field cannot be read is refused instead of rendered as an empty text box.
  
  An action declaring a `params` entry backed by a `lookup` field rendered as a bare
  text input: no options, no typeahead, and no request for the referenced object on
  the wire at all, because no picker was ever built. With the param `required`, the
  action could not be launched from the UI — while the same field rendered a working
  picker on a record form in the same build, off the same metadata.
  
  `resolveActionParams()` resolves a field-backed param against the `objects` list
  its caller holds, and two of the console's own callers cannot hold the right one:
  `ConsoleShell`'s root action runtime — the provider that exists so a `type: 'flow'`
  `action:button` works outside the four object views — passes no objects at all, and
  `DeclaredActionsBar` passes exactly one (none when driven by an `actions` prop).
  With the owner object absent the param took the resolver's last-resort shape, and
  for a field-backed param that shape is `text`: it declares no inline `type`, so
  there is nothing else to fall back to. The object binding was never missing from
  the client — this seam never asked the metadata store for it.
  
  - `useConsoleActionRuntime` now resolves field-backed params against the caller's
    objects UNIONED with the console metadata store's, caller first (`withKnownObjects`),
    after awaiting the object type so "this field does not exist" is an answer rather
    than a boot race. A draft/preview overlay the caller carries still wins.
  - The degradation is no longer anonymous. `resolveActionParams()` stamps
    `unresolvedField: '<object>.<field>'` on a param whose backing field it could not
    find and says so in dev. This is the half that made the defect invisible for a
    whole version: by the time `paramToField()` sees such a param it IS a `text`
    param, so `paramDegradesWithoutTarget()` answered false, no "no reference target"
    warning fired, and even the "paste a record id" placeholder and help text did not
    apply.
  - `ActionParamDialog` refuses such a param: it renders an alert naming the
    `<object>.<field>` pair in place of the control, logs one line per dialog opening
    in every build, and disables Confirm so the action cannot be launched with a value
    the dialog had no contract to collect.
  
  New localized string `actionDialog.unresolvedParam` in all ten locale bundles. The
  `<object>.<field>` locator renders as its own node rather than an interpolation, so
  an identifier is never re-ordered by a translation.
- e686f4d: A record form can no longer be saved while an upload is still in flight (objectui#10166).
  
  A `file` / `image` value only becomes its fileId once the presigned upload settles. Until
  now a record form had no notion of upload state at all, so a Save pressed during that
  window wrote the record WITHOUT the attachment — and reported success. The user picked the
  file, saw it listed and saved; there was no error, no warning, and the record looked saved.
  Whoever noticed did so later, looking at a record that should have a file and does not.
  
  `onUploadingChange` (ADR-0059) already carried the signal, and had exactly one consumer,
  `ActionParamDialog`. It could not have a second: that prop is per-widget, and a record form
  hands a `fields` array to the `form` node renderer and never touches a widget, so there is
  no point in the chain where it can attach a callback — and its upload controls can sit
  inside a section, a tab or a line-items subform.
  
  `@object-ui/fields` therefore publishes the AGGREGATION beside the prop: `useUploadingScope`
  (the host's "is anything below me uploading") and `UploadingScopeProvider`.
  `useUploadingSignal` — also exported now, for widgets authored outside this repo — feeds
  both sinks from the one call it already made, so the per-widget prop and the scope cannot
  disagree, and a host that mounts no provider is unaffected. A widget that unmounts
  mid-upload releases its slot, so a collapsing section cannot wedge Save shut.
  
  Nesting CHAINS rather than shadows: an inner scope gates its own Save AND reports itself to
  the scope above. The direction is forced by `MasterDetailForm`, whose Save persists parent
  and children in one batch while its rows are edited by nested `ObjectForm`s — a gate that
  saw only the parent's uploads would refuse nothing while a child's attachment was in flight
  and would still read as coverage.
  
  Every submit owner in `@object-ui/plugin-form` is gated: `ObjectForm`, `ModalForm`,
  `DrawerForm`, `SplitForm`, `TabbedForm`, `WizardForm`, `MasterDetailForm`, and
  `EmbeddableForm` through the `ObjectForm` it hosts. While an upload is in flight each
  refuses the submit (which is also the keyboard-submit guard), labels Save "Uploading…", and
  renders the reason as a sentence — `form.uploadInFlight`, new in all ten locale packs. The
  hosts that own their Save button — `ModalForm`, `DrawerForm`, `MasterDetailForm`, and
  `WizardForm`'s final step — disable it as well; the flat `ObjectForm`, `SplitForm` and
  `TabbedForm` paths submit through the `form` node renderer in `@object-ui/components`, which
  exposes no per-button disable, so there the refusal plus the label and the notice are what
  the user meets.
  
  `WizardForm` is gated on its FINAL commit only. Moving between steps writes nothing, so
  `Next` is deliberately untouched — but note that leaving a step unmounts its widgets, so an
  upload in flight is released by the unmount and its value never reaches the record. That
  loss predates this change and is not addressed by it.
- 5e67837: Translations that `I18nProvider` loads after mount now reach the readers already
  on screen (objectui#10382).
  
  **The defect.** Both of the provider's asynchronous loads end in
  `addResourceBundle`: the app bundle from `loadLanguage`, and the built-in
  catalogue for the language the instance booted in. Each was followed by a "force
  re-render" that set the provider's `language` state to the value it already held.
  React bails out of a same-value update, so nothing re-rendered. A reader that drew
  the fallback before the bundle arrived (an object label read through
  `useObjectLabel`, for example) kept drawing the English source label until
  something unrelated re-rendered it, with no error. The console wires
  `loadLanguage` exactly this way, so whether authored translations appeared on
  first load depended on timing.
  
  **What changed.**
  
  - `useObjectTranslation`, and every hook built on it (`useObjectLabel`,
    `useSafeTranslation`, `useDisplayLocale`), now subscribes each reader to the
    i18next store's `added` event through react-i18next's `bindI18nStore` option,
    passed per call. Every store write hands readers a new `t`, so a reader that
    memoises on `t`, or on a resolver built from it, recomputes too.
  - The two same-value `setLanguage` calls are gone. The one after the app bundle
    also set the context's `language` back to the boot language when the user had
    switched while the bundle was in flight. The context now stays on the language
    i18next is on.
  - The built-in catalogue is written only when the merge adds a key. That effect
    re-runs on every language change, and an unconditional write would re-render
    every reader for nothing.
  - A switch through the context's `changeLanguage` writes its bundles silently,
    because the `languageChanged` that follows re-renders every reader once, in
    the new language.
  
  **Behaviour you may notice.**
  
  - On first load, a reader re-renders once when the app bundle lands, and once
    more if the built-in catalogue was not resident yet. Work keyed on `t` or on a
    label resolver runs again at that moment. For example, a chart that resolves
    group labels while it fetches will fetch again, so that its labels come from
    the new bundle.
  - A language switch still re-renders each reader once.
  - Host code that calls react-i18next's own `useTranslation` directly, rather
    than `useObjectTranslation`, is not subscribed. It keeps react-i18next's
    default, which re-renders on `languageChanged` only.
  
  No export is added or removed. Marked `minor` rather than `patch` because the
  first-load behaviour is observable.
- ea9d17f: A currency field in `dynamic` mode shows the tenant's currency, not its
  `currencyConfig.defaultCurrency` (objectui#10422).
  
  `@objectstack/spec` declares two currency modes: `fixed` (a single currency) and
  `dynamic` (user selectable). Its field guidance says a field without a fixed
  currency uses the tenant default at runtime. `resolveFieldCurrency` read
  `currencyConfig.defaultCurrency` in either mode, so in a USD tenant a field
  declaring `currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' }`
  showed `€3,456` where it should show `$3,456`. An empty `currencyConfig`, which
  the spec parses to a dynamic config with `defaultCurrency: 'CNY'`, showed
  `CN¥`.
  
  The resolver now reads `currencyConfig.defaultCurrency` only when
  `currencyMode` is `'fixed'`. Its precedence is: the explicit `currency`, then a
  fixed `currencyConfig.defaultCurrency`, then the legacy top-level
  `defaultCurrency`, then the tenant default. With none of these, it returns
  `undefined` and the amount shows as a plain number.
  
  **Behaviour change.** Every face that resolves a currency through
  `resolveFieldCurrency` changes together: the list cell, the field widget, the
  metric tile, the detail summary chip, the gantt tooltip, and the grid's
  configured cells and summary footer. On each of them, a field in `dynamic` mode
  now shows the tenant currency. So does a `currencyConfig` that names no
  `currencyMode`, because the spec's default mode is `dynamic`. To keep a field on
  one currency, declare `currencyMode: 'fixed'`. A fixed field renders as before.
  
  The parameter type of `resolveFieldCurrency` gains an optional
  `currencyConfig.currencyMode` member (`'dynamic' | 'fixed'`), which is the
  spec's enum.
- 4357a27: Show the environment admin a storage-capacity banner from the tenant runtime's own
  storage verdict (objectui#10439, the objectui half of cloud#2135).
  
  `GET /api/v1/usage/storage` already served the verdict the upload and bulk-import
  guardrail refuses with (`warn` from 80%, `blocked` at 100%) and the two figures
  `usedMb` / `limitMb`. Nothing in the console rendered them, so an environment could
  fill up with no warning and learn it was full only when an upload failed.
  
  - **`warn`**: a banner with the used and limit figures, for example "850 MB of
    1,024 MB used".
  - **`blocked`**: the banner says storage is full and uploads and imports are paused,
    that existing data is untouched, and links to the control plane to upgrade. The link
    is left out on a runtime that names no upstream cloud.
  - **Anything else** (`ok`, `unknown`, `unlimited`, an endpoint that cannot be read or
    answers off-contract) renders nothing.
  
  The banner reads the served verdict. It never compares the figures with each other or
  with a threshold, so it shows what the guardrail enforces. It is mounted in
  `ConsoleShell` beside the read-rate report and has the same audience: only a workspace
  admin sees it, and only a workspace admin's session issues the request. The two
  banners share one request to the endpoint. Neither banner is exported from the package
  entry.
  
  `@object-ui/i18n` gains the five `console.storageUsage.*` keys in all ten locale packs.
- 7343376: fix(types,plugin-designer)!: the Studio app wizard saves a document the platform accepts, and an edit keeps the stored `accentColor` (objectui#10867)
  
  ⚠️ **BREAKING (authoring)**, marked `minor` under this repository's version-alignment rule (a `major` in the fixed group would move all of it off the `@objectstack` major). Two published `@object-ui/types` members narrow: a navigation separator no longer takes a `label`, and `AppWizardDraft.layout` is removed. A TypeScript literal that writes either no longer compiles. `NavigationItem` is now a union type alias, not an interface. So code that reads `label` off an unnarrowed `NavigationItem` into a `string` slot (its type is now `string | undefined`; objectui#11299, in the same release, widens it to the spec's `I18nLabel` or `undefined`, see `.changeset/11299-types-nav-label-locale-map.md`) also stops compiling, as does code that spreads an entry-only key onto one, and an `interface` that `extends NavigationItem` or augments it (extend `NavigationEntryItem` instead). `objectui validate` now refuses a separator `label` too: the zod mirror's `NavigationItemSchema` refuses every key on a separator that the spec's separator does not declare. The four `appDesigner` layout keys also leave the published `@object-ui/i18n` packs and `DESIGNER_DEFAULT_TRANSLATIONS`, so an application that calls `t()` with one of them now renders the raw key (unless the call passes a `defaultValue`).
  
  **Clause-②: yes (narrowing)** — the separator arm of `NavigationItem` loses `label`, and `AppWizardDraft` loses `layout`.
  
  - **A separator carries only `type`, `id` and `order`.** `@objectstack/spec`'s separator branch declares exactly those keys, and its `AppSchema` refuses anything else. `NavigationItem` required a `label` on every item, so the wizard's "Add separator" wrote `{ id, type: 'separator', label: '' }`, and the console's create-app and edit-app saves were refused with `422 INVALID_METADATA` (`unrecognized_keys` `['label']` at `navigation.N`). `NavigationItem` is now a union of two arms, discriminated by `type`. `NavigationEntryItem` holds every other nav type and keeps its required `label`. `NavigationSeparatorItem` admits `type`, `id` and `order`, and every other entry key is `?: never` on it. Both arms are exported. Reading an entry-only key off an unnarrowed item still compiles, but its type now includes `undefined` (a `label` is `string | undefined`; objectui#11299, in the same release, makes it the spec's `I18nLabel` or `undefined`, see `.changeset/11299-types-nav-label-locale-map.md`), so passing it where a `string` is required does not. Narrow on `item.type === 'separator'` before relying on `label`. `menuItemToNavigationItem` maps a legacy separator to `{ id, type: 'separator' }` and drops its label. `spec-derived-unions.test.ts` no longer pins the separator `label` as a blocker. It asserts, at both spec tiers, that the separator arm admits the spec separator's keys and no others.
  - **`@object-ui/plugin-designer`: the wizard and `NavigationDesigner` write a separator as `{ id, type }`.** `NavigationDesigner` no longer writes a `label` onto a new separator, and its label, icon and visibility patchers skip one.
  - **`@object-ui/layout` narrows on the separator arm; nothing it renders changes.** `resolveNavItemLabel` answers `''` for every separator. A stored separator carrying a non-empty `label`, which `menuItemToNavigationItem` produced before this change, used to resolve to that label. No renderer asks it for a separator's label. The mobile bottom nav's leaf list, which already skipped separators, is now typed as entries.
  - **`@object-ui/app-shell` narrows the same way; nothing it renders changes.** `useNavPins` registers a favorite only for an entry and leaves a separator as it is, and the Studio sidebar's navigation walk passes a separator through unchanged.
  - **`@object-ui/plugin-designer`: `EditAppPage` keeps the stored branding.** The wizard maintains the logo, primary colour and favicon, and its `branding` replaced the stored block, so a stored `accentColor` was dropped on every edit. The console reads that key. The save now keeps every stored `branding` key the spec's `AppBrandingSchema` declares, read from that schema. The wizard's values win for the keys it maintains. A stored key the spec does not declare is still left out.
  - **The wizard's Layout control is removed, with `AppWizardDraft.layout`.** The spec declares no app `layout`, no console surface reads one, and since objectui#10842 the save wrote none. The control persisted nothing. `EditAppPage` no longer reads a stored `layout` into the draft. The Basic Info step's description now reads "Name, title, and icon".
  - **`@object-ui/i18n`:** the four `appDesigner` layout keys (`layout`, `layoutSidebar`, `layoutHeader` and `layoutEmpty`) are removed from all ten packs, and `appDesigner.stepBasicDesc` no longer names a layout.
  
  **Migration:** write a separator as `{ id, type: 'separator' }`, with an optional `order`. Remove `layout` from any `AppWizardDraft` you build. Code that spreads an entry-only key (`label`, `visible`, `requiredPermissions` and the rest) onto a value typed `NavigationItem` narrows it first (`item.type !== 'separator'`) or types it `NavigationEntryItem`: the separator arm refuses those keys. `AppComponentSchema.layout`, the renderer node's own layout strategy, is a different member and is unchanged.
  
  Pinned in `packages/types/src/__tests__/app-wizard-separator-layout-10867.test.ts` and `packages/plugin-designer/src/__tests__/AppWizard.specDocument-10867.test.tsx`.
- 244d516: A grouped grid over a data source that declares no `queryGroupHeaders` now
  **refuses grouping** instead of grouping a page of rows (objectui#10881,
  maintainer ruling F). Grouping is a property of the query (ruling A on
  objectui#7189): a data source that cannot answer the group header query cannot
  group, so the grid names the member it is missing rather than drawing counts it
  cannot know.
  
  - **`@object-ui/plugin-grid`** — a grouped `object-grid` that fetches its own
    rows over such a source renders an error panel naming `queryGroupHeaders`
    and issues no row query. It used to fetch one window and group it in the
    browser, so every group count was a page slice and a group whose rows all
    fell past the window was missing. Rows handed in WHOLE — a
    `data: { provider: 'value', items }` block, or a `data` prop from a parent
    view that declares no larger `rowCount` — are still grouped in the browser,
    exactly. A host that hands rows in while declaring them one page of more
    (the external-pagination props: `manualPagination`, `onPageChange` and a
    `rowCount` above the rows it handed) is now refused as well, with a sentence
    of its own: grouping needs every record. It used to have that page grouped as
    if it were whole.
  - **`@object-ui/plugin-list`** — `ListView` makes the same refusal, with the
    same sentence, in place of a grouped grid over such a source, and fetches no
    window for it. It used to fetch one window and hand it to the grid as
    `data`, which the grid grouped as if the rows were whole. Rows handed to
    `ListView` in whole are still handed to the grid.
  - **`@object-ui/i18n`** — two new keys, `grid.grouping.needsHeaderQuery` and
    `grid.grouping.needsWholeRows`, in all ten locale packs.
  
  The `Partial` marker described by the pending
  `7189-grouped-grid-partial-disclosure` entry is retired everywhere before any
  release carried it: its three `grid.grouping.partial*` strings, `GroupRow`'s
  `partialLabel` / `partialTitle` props and the notice above the group list are
  gone.
  
  **Breaking semantics (declared `minor` per this repo's version policy):** a
  grouped grid that fetches its own rows over a data source without
  `queryGroupHeaders` — `ApiDataSource`, `ValueDataSource`, or a host adapter —
  grouped the page it fetched in the last release, and now renders an error panel
  instead. So does a grouped grid view in `ListView` over such a source. So does
  a grouped grid handed rows by a host that declares them one page of more
  (`manualPagination`, `onPageChange` and a `rowCount` above the rows handed),
  whatever its data source. To keep grouping, either:
  
  - implement `queryGroupHeaders` on the data source (the ObjectStack adapter
    does), and let the grid fetch its own rows, or
  - hand the rows in whole (`data: { provider: 'value', items }`, or a `data`
    prop with no `rowCount` above it).
  
  Not changed here: while a toolbar search is active, `ListView` over a data
  source that answers the header query still hands a grouped grid its window,
  whose group counts are the window's, because the header query carries no
  search (objectstack#20358).
- d0fba91: A region-tagged language code reaches the built-in catalogue of its base language (objectui#11326)
  
  The built-in catalogues are keyed by base language (`zh`), while the platform
  answers, the Console's language menu offers, and the provider stores full
  BCP-47 tags (`zh-CN`). `isBuiltInLanguage` and `loadBuiltInLocale` looked a code
  up exactly, so `loadBuiltInLocale('zh-CN')` resolved `null`. A user who picked
  中文（中国） got every built-in string in English on each full page load, with
  only the `en` catalogue fetched, while server-translated labels stayed Chinese.
  
  **What changed at the contract.** Three exported registry functions now accept a
  region-tagged code they used to refuse. A code is looked up exact tag first,
  then its base language, through one normaliser. That is the order the cached
  locale seed already used, and the seed now reuses the same function.
  
  - `loadBuiltInLocale('zh-CN')` resolves the `zh` catalogue. It is fetched and
    memoised under `zh`, so `zh` and `zh-CN` share one fetch, and
    `getLoadedBuiltInLocales()` stays keyed by catalogue code.
  - `isBuiltInLanguage('zh-CN')` is `true`, and `isBuiltInLocaleLoaded('zh-CN')`
    answers for the `zh` catalogue.
  - A code with no catalogue for the tag or for its base (`xx-YY`, `tlh`) is
    refused exactly as before.
  - A catalogue keyed by a full tag would win over its base language. None ships
    today.
  
  **What a host observes.**
  
  - A stored `zh-CN` is kept, and kept as written. `I18nProvider` boots in
    `zh-CN` and renders from the `zh` catalogue, and its `language`, the
    document's `lang` attribute and the stored value all stay `zh-CN`. A host with no
    `loadLanguage` loader used to purge a stored `zh-CN` on boot. It no longer
    does.
  - `preloadBootstrapLocale()` fetches the `zh` catalogue for a stored `zh-CN`, so
    the first paint is already Chinese.
  - `changeLanguage('zh-CN')` fetches the `zh` catalogue before it switches.
  - A cached locale seed of `zh-CN` now boots in `zh-CN` instead of being
    rewritten to `zh`, because the `zh` catalogue serves the exact tag. The
    strings are the same. The provider's `language` and the document's `lang`
    attribute read `zh-CN`, the tag the signed-in user's `sys_user.locale` applies a moment
    later.
- c476be0: The action success toast is composed from the action's `outcomeMessages`, then its `successMessage`, then the runner's default text. A `message` in the server's answer is no longer shown (objectui#11344).
  
  `@objectstack/spec` 17.6.0 declares `ActionSchema.outcomeMessages`, the success copy for each handler outcome. Its keys are the snake_case `outcome` values that a `type: 'api'` or `type: 'script'` handler returns in its success payload. This follows ruling A on objectstack-ai/cloud#2315: the server returns facts, and the console writes the sentence in the user's locale.
  
  - `@object-ui/core`: the `ActionRunner` success toast now picks its text in this order:
    1. the `outcomeMessages` entry named by the top-level `outcome` of the handler's answer;
    2. `successMessage`;
    3. the runner's default text, in the language of the translator set with `setTranslator`.
  
    Rungs 1 and 2 fill in `${result.*}` tokens from the handler's answer. That is the same scope `onSuccess.navigate` reads, and the values go in as text, not percent-encoded. **Behaviour change:** `result.data.message` used to take precedence over both. The runner no longer reads it at all. To show the server's sentence, write `${result.message}` as the copy. `ActionDef` now declares `outcomeMessages`.
  - `@object-ui/react`: `useActionTextLocalizer` resolves each `outcomeMessages` entry that a named action declares. It looks in `_actions.NAME.outcomeMessages.OUTCOME`, then `globalActions.NAME.outcomeMessages.OUTCOME`, then falls back to the authored text. On a named action, an inline `I18nLabel` map on an entry, or on `successMessage`, is collapsed to the active language first. `${result.*}` tokens pass through unchanged, and the runner fills them in after the action runs.
  - `@object-ui/i18n`: `useObjectLabel()` adds `actionOutcome(objectName, actionName, outcome, fallback)`, the resolver for that address.
  - `@object-ui/components`: `action:button`, `action:icon`, `action:group` and `action:menu` now forward `outcomeMessages` to the runner. Before, a registered action rendered through `action:bar` lost the map one hop before the toast. The `action:button` and `action:icon` registrations do not publish it as an input, because their own spec rows do not declare it at 17.6.0.
  - `@object-ui/types`: `UIActionSchema` declares `outcomeMessages`, derived from the spec.
  
  `@object-ui/core` and `@object-ui/types` raise their `@objectstack/spec` floor from `^17.5.0` to `^17.6.0`, because their published types now read `ActionSchema.outcomeMessages`, a member the spec first declares in 17.6.0.
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
- d3995fe: Retire 25 confirmed-dead locale keys from all ten packs — 250 translated strings
  with no reader anywhere in the repo (objectui#4730's key-level trim round;
  `calendar.agenda` included).
  
  Every key was confirmed individually, not swept from a tool's output. The
  inventory comes from `scripts/check-i18n-dead-keys.mjs`, which stays report-only
  by design, and each candidate then had to clear the objectui#4658 evidence
  standard on its own: zero `t()` call sites, zero textual footprint anywhere
  outside the packs, and a read of its plausible consumer confirming no i18n
  wiring reaches it. Five namespaces held nothing but retired leaves and went with
  them — `map`, `cellRender`, `rowAction`, `recordDetail`, and `home.stats`.
  
  The retirements fall into three shapes:
  
  - **Superseded twin vocabularies.** `cellRender.*` and `rowAction.*` duplicated
    a `grid.*` vocabulary that won. `RowActionMenu.tsx` is fully i18n-wired and
    reads `grid.openMenu` / `grid.edit` / `grid.delete`; `ObjectGrid.tsx` reads
    `grid.empty` / `grid.yes` / `grid.no` / `grid.systemFields`. The twins had no
    reader on either side.
  - **Labels that outlived their control.** `calendar.agenda` labelled a view mode
    `b55a34647` retired from `CalendarViewMode` (now `'month' | 'week' | 'day'`).
    `home.quickActions.createApp*`, `layout.systemNav.createApp`,
    `actionDialog.defaultActionTitle` / `.ok` and `grid.bulk.selectPlaceholder`
    sit in namespaces whose consumers are live and wired but demonstrably read
    other siblings.
  - **Surfaces that left the product.** `map.*` is the strongest form:
    `@object-ui/plugin-map` declares no `@object-ui/i18n` dependency and contains
    no `t()` call at all, so it cannot consume a locale string. `home.stats.*` and
    `recordDetail.viewersTooltip` name surfaces nothing renders.
  
  `packages/i18n/src/__tests__/dead-key-batch-retired-4730.test.ts` pins the
  retirement, following the convention of the five retirement pins already in that
  directory. It is load-bearing rather than decorative: every i18n gate in this
  repo runs call site to key, so a dead key coming **back** into the packs is
  invisible to all of them, and this pin is the only thing watching that direction.
  
  **Deliberately NOT deleted, and pinned as live.** Seven `console.*` bootstrap
  strings that this same sweep reported CONFIRMED-dead are in fact **live**, and
  were pulled back out of the batch. `LoadingScreen.tsx` is bootstrap-critical UI
  that must render before i18n loads — precisely when the server is unreachable —
  so it deliberately does not call `t()`. It imports the packs directly and reads
  them as plain object properties (`strings.loadingSteps.connecting`). That
  consumer is invisible to both legs of the sweep: there is no call for the AST
  pass to classify, and the full dotted key is never spelled in source because the
  namespace segment is bound to a local variable. The new pin asserts those keys
  stay, so the next sweep round cannot repeat the mistake.
- 06b82b8: An action param that declares the spec's `carryOver` is shown read-only and submitted verbatim (objectui#6246)
  
  `@objectstack/spec`'s `ActionParamSchema.carryOver` says a param's value is
  carried through the action dialog rather than collected: seeded from the row
  (`defaultFromRow: true` is required beside it), shown as a non-editable summary,
  and submitted unchanged. The console dropped the key: `resolveActionParam()`
  builds its output key by key and never copied it, so the dialog rendered every
  such param as an ordinary editable field. The permission-set Clone action
  declares it on its five JSON permission facets, so each of them — row-level
  security among them — was a prefilled JSON textarea, and a hand edit that was
  still valid JSON produced a clone granting more than its base.
  
  - `@object-ui/core`: `ActionParamDef` gains `carryOver?: boolean`.
  - `@object-ui/app-shell`: the resolver copies `carryOver` on all three of its
    branches; `ActionParamDialog` renders a declared carry-over as a collapsed
    read-only summary and builds no field widget for it at all; and
    `serializeParamValues` leaves a carry-over value untouched, even on an upload
    field. The action designer's dialog preview draws a carry-over param as the
    same read-only line instead of its field's input.
  - `@object-ui/i18n`: one new key, `actionDialog.carryOverHint`, in all ten packs.
  
  Params that do not declare the key render and submit exactly as before.
- b362c1b: Setup gains a **Packaged automation** page — the operational surface for the flows an
  installed package ships (ADR-0126 §7.4, objectui#6301). Reached the way every other
  framework-contributed Setup surface is: the page registers the component-registry ref
  `automation:packaged`, so app navigation names the ref and `ComponentNavView` resolves it
  at `/apps/<app>/component/automation/packaged`. No bespoke route is added — a second way
  in would be a URL the app metadata does not know about.
  
  Per packaged flow the page does exactly two things:
  
  - **on/off for this scope** — reads the activation state the engine reports
    (`GET /api/v1/automation/_status`, backed by the ADR-0126 §7.2 `sys_metadata_activation`
    ledger) and flips it through `POST /api/v1/automation/<name>/toggle`;
  - **clone** — `POST /api/v1/automation/<name>/clone` with a mandatory new machine name and
    label (§7.1). The carried-over definition is never offered as editable form fields; the
    copy is edited in Studio like any other flow.
  
  Authoring stays in Studio. The list is scoped to packaged flows by the server's own
  three-clause provenance test (`isCodeArtifactBody`, ADR-0029 D9.6) rather than the
  `_packageId`-only shortcut, which classifies a tenant overlay bound to a package as
  packaged — the cloud#970 misread, and here it would put a tenant's own flow behind an
  install-wide switch.
  
  **Server refusals reach the operator verbatim** — no client-side softening or rewording.
  Three shapes are relayed as sent: the §5 posture gate (403 `PERMISSION_DENIED`, whose
  message names the tenancy posture *and* the sanctioned clone path), the §7.3 subflow guard
  (409 `DELETE_RESTRICTED`, which names the packaged callers that would break mid-run — a
  list nothing on the client could reconstruct), and the §7.1 clone name conflict (409).
  
  ⛔ **No drift or ancestry surface** (§9): no diff-vs-base, no "customized" badge, no
  base-moved notice, no link from a clone back to its source. Cloned-without-disabled and
  disabled-without-clone are ordinary states, shown plainly. Tests pin the absence, including
  the case where a response carries a `clonedFrom` key anyway — the platform does not track
  that lineage, so a page that displayed it would be displaying something it invented.
  
  `@object-ui/i18n` gains the `packagedAutomation` key group — 24 keys in `en` and real
  translations in all nine other packs, matching each pack's existing vocabulary for "flow"
  and "package" (zh 流程/软件包, ja フロー/パッケージ, ko 플로우/패키지, de Flow/Paket,
  fr Flux/Package, es Flujo/Paquete, pt Fluxo/Pacote, ru Поток/Пакет, ar التدفق/الحزمة) and
  each one's quotation convention. The group deliberately carries no drift or ancestry
  wording, and no server refusal text: those arrive as server-authored prose and are
  rendered verbatim.
- 9602dc8: Setup › **Packaged automation** gains a packaged **actions** section beside its flows one —
  the surface half of ADR-0126 §8 item 2 (objectui#6412; the engine, ledger and both dispatch
  doors landed in objectstack#12348). The maintainer's pull, verbatim and untranslated:
  「动作 可能是需要开关的，因为有的 action 我不想启用。」
  
  Per packaged action the section does exactly **one** thing: **on/off for this scope**. That
  is all the `sys_metadata_activation` ledger knows about an action, and the section claims
  nothing more.
  
  - **State** comes from the ledger's `metadata_type: 'action'` rows, read through the generic
    data API list the object itself sanctions for exactly this
    (`apiMethods: ['get', 'list']` — *"Reads stay open so operability surfaces can answer
    'what is disabled here?'"*). **Absence of a row means active**, so a stock boot shows
    everything armed.
  - **Discovery** mirrors the runtime's own `collectActionDeclarations`: object-embedded
    `actions[]` from `GET /meta/object` **plus** standalone items from `GET /meta/action`, with
    the object-embedded declaration winning a `<object>:<action>` key clash. Listing only the
    first source would leave an administrator with no off-switch for a packaged standalone
    action.
  - **Flips** invoke the L6 write door `POST /actions/_activation/:object/:action` with exactly
    the one key its body declares (`{ enabled }`); `global` is the object segment for an
    object-less action, the same spelling both dispatch doors take.
  
  **⛔ No clone for actions.** The flows section keeps its own (§7.1); amendment ruling 3
  charters the *switch* for actions and nothing else, and §8 keeps the clone half pre-chartered
  until real pull appears. A clone control here would advertise machinery that does not exist —
  which is also why the server's §5 refusal for actions recommends the platform operator and an
  ordinary sibling action where the flow refusal recommends a clone.
  
  **⛔ No drift or ancestry surface** (§9): no "customized" badge, no diff-vs-base, no
  base-moved notice. The platform tracks no such lineage, so a surface showing it would be
  showing something it had to invent. The absence is pinned against a response that smuggles
  `clonedFrom` / `baseVersion` in, so it is enforced at the renderer and not merely by the wire.
  
  Server refusals reach the operator **verbatim** — no client-side softening, no retry loop.
  Three shapes are reachable in tests, each transcribed character-for-character from the
  runtime's own message builders: the §5 posture gate (403 `PERMISSION_DENIED`, naming the
  posture *and* the sanctioned path), the ambiguous-name refusal (409 `RESOURCE_CONFLICT`,
  naming the objects a machine name collides across — a list nothing on the client could
  reconstruct) and the no-ledger outage (503 `SERVICE_UNAVAILABLE`).
  
  One further refusal is the section's own and it points the same way: a `hasMore` on the
  ledger read is treated as a **load failure** rather than rendered. A dropped row reads as
  "active", so a partial ledger would show a switched-off action as armed — the one direction
  this section must not fail in.
  
  The flows section is unchanged in behaviour. It gains a heading beside the new one, and the
  page subtitle now says "Flows and actions" — that string moved in all ten packs together.
  Nine new `packagedAutomation.*` keys land in `en` **and in all nine other packs** as real
  translations; the two toggle-failure keys are artifact-neutral by wording and are reused
  rather than duplicated.
- 969ba84: Renderers for the `app:launcher` and `nav:menu` page blocks.
  Phase 1 of the 2026-08-26 maintainer ruling on objectstack#12183 — the two
  `PageComponentType` members that are purely metadata-driven, so nothing had to
  ship before their renderers could. Phase 2 (`global:search` /
  `global:notifications`) landed in `f99932a42` and set the pattern this
  follows.
  
  A page that declared either member drew a dashed box. The two symptoms were not
  the same, which is worth recording because it decides what "fixed" looks like
  for each:
  
  - `nav:menu` is in `PALETTE_PLACEHOLDER_BLOCKS`, registered eagerly, so it drew
    the literal "Component Placeholder" scaffold in every host.
  - `app:launcher` is only in `PROTOCOL_COMPONENTS`, registered when a host opts
    in via `registerPlaceholders()` — which just `apps/console` does. So it drew
    the scaffold in the console and `SchemaRenderer`'s red OBJUI-001 "Unknown
    component type" panel everywhere else.
  
  Neither block adds a data layer — each mounts plumbing that was already live,
  and neither issues a request or touches an adapter:
  
  - `app:launcher` reads the metadata app registry (`useMetadata().apps`, which
    `MetadataProvider` fetches eagerly) through the shared `filterActiveApps`
    predicate, and draws it with `HomeAppsStrip` — the console's own launcher
    grid — so an authored launcher and the Home launcher cannot drift into two
    looks for one thing.
  - `nav:menu` reads the active app's navigation tree from that same registry and
    renders it as page content, taking every derived fact from `@object-ui/layout`:
    hrefs from `resolveHref`, labels from `resolveNavItemLabel`, the active row
    from `resolveActiveNavItem`, and the item-level guards (`visible`,
    `requiredPermissions`, `requiresObject` / `requiresService`) in the order
    `NavigationItemRenderer` applies them, wired to the same console providers
    `UnifiedSidebar` wires them to. `action` items dispatch through
    `useNavActionDispatch`, so framework#4509's "renders but dead-clicks" shape is
    not reintroduced.
  
  `nav:menu` does not mount `NavigationRenderer` itself: that renders through
  `SidebarMenuButton`, whose `useSidebar()` throws outside the shell's
  `SidebarProvider`, and a page block has to render standalone. `@object-ui/layout`
  therefore exports `resolveNavItemLabel`, which was module-private — an additive
  export with no behaviour change, so the sidebar and an authored menu cannot show
  one nav entry under two names.
  
  Both registrations publish **no** `inputs`: `ComponentPropsMap` declares an empty
  shape for each, and both use `skipFallback: true` so neither claims the bare
  `launcher` / `menu` keys. This does not change the Studio page palette —
  `app:launcher` remains recorded there as a shell singleton, which is a palette
  decision independent of whether a declared type renders.
  
  Three new strings — the launcher's and the menu's accessible names, and the
  menu's empty state — are declared under `console.nav` in `en.ts` and its nine
  sibling packs. An inline `defaultValue` alone is not a fix: it renders English
  at one call site and leaves the string untranslatable everywhere
  (objectui#3517).
- 220c18d: Dashboard/analytics widgets get a self-explaining DEFAULT empty state, stated
  once for the surface (objectui#7063).
  
  Maintainer ruling 2026-08-31 (hotcrm#1212, following hotcrm#1203): a widget that
  renders a bare row-placeholder on an empty result is the PLATFORM's defect and
  must be fixed uniformly — apps must not compensate widget by widget
  (objectstack#13848). The measured scenario is a fresh flagship-demo install:
  eleven populated tiles and one reading exactly `暂无数据行` mid-page, which reads
  as "the dashboard failed to load" even though the widget, its declaration and
  its (not yet produced) data are all legitimate.
  
  - New `WidgetEmptyState` is the seam the three dashboard surfaces now share.
    There was no shared placeholder to fix: `DatasetWidget` wrote
    `dashboard.noRows`, while `ObjectDataTable` and `PivotTable` wrote
    `dashboard.noDataAvailable` — three renders, two strings, no common code.
  - The default now reads as a STATE, not a failure: `role="status"` (the empty
    branches previously carried no role at all, while the failure branches beside
    them are `role="alert"`), muted treatment with an inbox glyph rather than a
    warning triangle, and a title plus an explanation where the placeholder was a
    single terse fragment.
  - It names WHAT is empty with zero authored copy — the widget's data source,
    which is the half the reader cannot already see (the tile's title is rendered
    by the card header directly above). That is `widget.dataset` on the dataset
    path and `schema.objectName` on the object-bound table/pivot; `PivotTable`
    takes it as a new optional `sourceLabel` prop, which `ObjectPivotTable`
    forwards.
  - Copy is platform i18n: `dashboard.empty.title` / `.message` / `.sourceLabel`
    added to `en` and all nine sibling packs. No inline `defaultValue` and no
    interpolation — the source renders as a labelled value, so no separator is
    concatenated in code and every pack spells its own punctuation.
  
  No new authoring obligation and no new spec key. Note that the `emptyState`
  override the card assumes for this surface does not exist: `emptyState` is a
  LIST-view contract, and `@objectstack/spec`'s `DashboardWidgetSchema` declares no
  such key — so there is nothing here for an author to override, and adding one
  would be a contract question rather than a rider.
- 8952395: A grouped grid now says, where the group counts are, that it grouped a **page**
  (objectui#7189).
  
  `useGroupedData` buckets the rows the browser already holds and computes every
  per-group aggregate from that same array, so both the set of groups and every
  number in a group header are properties of the fetched page, not of the query.
  That is a correct implementation of client-side grouping and is **unchanged**
  here — what was missing is any statement that client-side grouping is what you
  are looking at. Measured on a 186-record store distributed 86 / 61 / 31 / 7 / 1
  across five business units with a 100-row page: with contiguous rows the grid
  rendered **two** group headers (`86`, `14`) and three units were absent from
  the screen entirely; with interleaved rows all five resolved but every count
  was a page slice (31 / 31 / 30 / 1 / 7). Nothing on screen said either.
  
  The paging footer is not a statement about what was grouped, and it
  demonstrably did not prevent the wrong reading — a wrong number invites a
  second look, an absent row invites none. So the disclosure goes where the
  authoritative-looking number is:
  
  - a short `Partial` marker beside **every** group count, at every nesting
    depth, carrying the full sentence as its `title` and its accessible name;
  - one line directly above the group list, inside the grouped region rather
    than in the footer: *"Grouped over the first 100 of 186 records. Group counts
    are page-scoped, and a group whose records all fall beyond the loaded rows is
    missing here."*
  
  The trigger is the strongest thing the component can actually know, and the
  wording never outruns it. With a real match total to compare against
  (`resolvedTotalMatching` — the one derived value the pager and both bulk-bar
  sites already read, reached either from the grid's own fetch or from a host's
  `rowCount`) it states the fact with both numbers. With no total but a window
  that came back full it may only say *"more may match"* — the same inference
  `plugin-list`'s own footer draws when no total is known. Rows handed in inline
  are not a page and are never marked, and **a grouped grid whose result set fits
  in one page shows nothing at all**: the marker is conditional, which is what
  makes it worth reading.
  
  Server-side grouping — the durable fix — is deliberately NOT part of this. It
  is an API-surface decision still open on objectui#5560, and nothing here builds
  toward it or changes the fetch.
  
  `@object-ui/i18n` carries the three new `grid.grouping.*` strings across all
  ten locale packs; `GroupRow` gains two optional props (`partialLabel`,
  `partialTitle`) and is otherwise unchanged. No metadata schema key was added:
  the condition is derived from data the grid already has.
  
  ⚠️ **Dated note, 2026-09-28 — grid grouping is now server-side where the data
  source can answer the group header query — objectui#7189, PR objectui#10878.**
  The paragraphs above describe this change as it was written. Later in this same
  release three of their sentences stopped describing the grid: that
  `useGroupedData` buckets the rows the browser already holds, so the set of
  groups and every header number are properties of the fetched page; that
  client-side grouping is **unchanged** here; and that server-side grouping is not
  part of this, is still open on objectui#5560, and that nothing here builds
  toward it or changes the fetch. Maintainer ruling A on objectui#7189 settled that
  question. On a data source that declares `queryGroupHeaders`, a grouped grid
  that fetches its own rows now takes its groups, every group count and every
  per-group aggregation from the query, and pages each group's rows on the
  server; its counts are the query's own, so the `Partial` marker and the notice
  described above never render there. On a data source without
  `queryGroupHeaders`, the grid still groups the page it fetched in the browser,
  as described above, and the marker and the notice are kept there. The rest of
  this entry is kept as the reading of this change; the
  `7189-server-side-grid-grouping` entry states what a grouped grid does now.
  
  ⚠️ **Dated note, 2026-09-28 — the `Partial` marker is retired before release —
  objectui#10881.** Later in this same release the marker and the notice described
  above were retired, with the three `grid.grouping.partial*` strings and
  `GroupRow`'s `partialLabel` / `partialTitle` props that carried them (maintainer
  ruling F). A grouped grid that fetches its own rows over a data source that
  declares no `queryGroupHeaders` no longer groups the page it fetched: it
  refuses grouping with an error naming that member. So the last sentences of the
  note above — that on such a source the grid still groups the page it fetched,
  and that the marker and the notice are kept there — no longer describe the
  grid. The rest of this entry is kept as the reading of this change; the
  `10881-grouping-needs-header-query` entry states what ships.
- 0348bc9: **BREAKING:** `@object-ui/plugin-detail` no longer exports seven components that
  nothing registered and nothing mounted (objectui#7192, objectui#7175). This
  narrows the package's published surface. It is declared `minor`, not `major`,
  because this fixed release group follows the `@objectstack` major (AGENTS.md
  §9); the breaking change is stated here instead.
  
  Removed, with every type exported beside them:
  
  - `CommentInput`, with `CommentInputProps`
  - `DiffView`, with `DiffViewProps`, `DiffFieldType`, `DiffMode` and `DiffLine`
  - `InlineCreateRelated`, with `InlineCreateRelatedProps`,
    `RelatedFieldDefinition` and `RelatedRecordOption`
  - `MentionAutocomplete` and the helper `createMentionFromSuggestion`, with
    `MentionAutocompleteProps` and `MentionSuggestionItem`
  - `PointInTimeRestore`, with `PointInTimeRestoreProps` and `RevisionEntry`
  - `RecordNavigationEnhanced`, with `RecordNavigationEnhancedProps`
  - `RelationshipGraph`, with `RelationshipGraphProps` and `GraphNode`
  
  Why they went: none of the seven was passed to `ComponentRegistry.register`, so
  metadata had no type string to name any of them, and none was mounted anywhere
  in this repository. The downstream readings agree: `cloud` references none of
  the seven names (objectstack#14187), and `hotcrm` depends on no `@object-ui/*`
  package at all. The maintainer ruled to delete them; the ruling is relayed on
  objectui#7192.
  
  Not affected: `RichTextCommentInput` and its `MentionSuggestion` type (the
  composer `RecordActivityTimeline` mounts), `RecordComments` (`DetailView`
  mounts it) and `extractMentions` all stay exported.
  
  `@object-ui/i18n`: the `detail.*` keys that only these components read are
  removed from all ten locale packs, and the matching rows from
  `DETAIL_DEFAULT_TRANSLATIONS`:
  
  - `PointInTimeRestore`'s ten, added by objectui#7163: `revisionHistory`,
    `noRevisions`, `revisionFieldsChanged`, `revisionFieldsChangedOne`,
    `revisionPreview`, `revisionSnapshot`, `restoreConfirm`, `restoring`,
    `confirmRestore`, `restoreToPoint`
  - `emptyValue`, an older key whose last reader was `PointInTimeRestore`
  - `DiffView`'s five: `unifiedDiff`, `sideBySideDiff`, `noChanges`,
    `previousVersion`, `currentVersion`
  - `RecordNavigationEnhanced`'s six: `firstRecord`, `previousRecordKey`,
    `nextRecordKey`, `lastRecord`, `searchWhileNavigating`, `searchRecords`
  
  Keys these components shared with surfaces that stay (`detail.recordOf`,
  `detail.noRecords`, `detail.cancel`, `detail.activityEmptyValue`, the
  relative-time keys) are kept. A host that read one of the removed keys itself
  now gets the raw key back.
  
  Other entries in this same release describe work on `PointInTimeRestore` and
  `DiffView` (their translation and display-locale fixes). That work shipped in
  components this entry removes.
  
  **Migration:** there is no replacement. If you import one of these components,
  copy its source file (`packages/plugin-detail/src/`, the file named after the
  component) from a release tag that still ships it, for example
  `@object-ui/plugin-detail@17.5.0`, into your own code. If you need one of them
  back in the package, open an issue that says who uses it and where.
- a4514e8: Retire `useObjectLabel().viewDescription()` and the `_views.<view>.description`
  catalog convention it resolved (objectui#7219, maintainer ruling 2026-09-02,
  option B — enforce-or-remove).
  
  **Breaking for translation bundles, deliberately — and this text is the notice.**
  Out-of-repo translation bundles that authored
  `<ns>.objects.<objectName>._views.<viewName>.description` cannot be seen from
  this repo, so there is no census to point at and no migration script to run:
  that key now resolves nowhere, and an entry left under it is simply ignored.
  Nothing throws, and nothing else on that node changes.
  
  **What replaces it.** A list view's description has exactly ONE channel: the
  `I18nLabel` value authored on the view entry itself — a string, or an inline
  locale map:
  
  ```ts
  listViews: {
    by_unit: {
      label: 'By business unit',
      description: { en: 'Open work only.', 'zh-CN': '仅未完成的工作。' },
    },
  }
  ```
  
  `ObjectView` relays that value to the renderer and `plugin-list`'s `ListView`
  resolves it against the display locale (objectui#7199, shipped before this
  change), so the authored channel already works end to end. **Migration:** move
  the sentence out of the translation bundle and onto the view entry as a locale
  map.
  
  **Why removed rather than wired in.** The member was declared and resolved but
  had zero callers and zero in-repo bundle usage — an entry authored under the
  catalog key reached no screen. Wiring it in would have put two vocabularies on
  one concept (`I18nLabel` on the entry, and the catalog key) and required a
  precedence rule between them, which is the ambiguity rather than the fix.
  
  The two sibling members on the same node are **unaffected**: `viewLabel` and
  `viewEmptyState` still resolve `_views.<view>.label` and
  `_views.<view>.emptyState.{title,message}`, and the shared `viewSuffixes` key
  builder they use is unchanged — only the `'description'` tail is gone. Pin tests
  in `@object-ui/i18n` and `@object-ui/app-shell` were retargeted onto those two
  survivors plus a case that authors the catalog `description` and asserts the
  authored value is what a consumer resolves.
- 47547d0: Localize the server's built-in aggregate measure titles on dataset charts
  (objectui#7258 — consumer half of the objectstack#14492 contract; maintainer
  ruling B, 2026-09-02).
  
  A dataset-bound chart's aggregate axis / legend title read the analytics
  service's hard-coded English `Count` on a zh console whose category labels were
  already Chinese. The renderer was passing `fields[].label` through verbatim —
  correctly, for an author-declared measure (objectui#4106) — and had no way to
  tell the server's built-in default apart from an author's label.
  
  The wire now can: `AnalyticsResult.fields[]` gains an OPTIONAL structural
  discriminator, `builtinAggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' |
  'count_distinct'`, populated only on the server-side built-in defaults
  (objectstack#14492). This change is the consumer side of that contract:
  
  - `@object-ui/core`: `buildChartSeries` now accepts `ChartMeasureField[]` —
    `ChartResultField` plus the optional `builtinAggregate` carrier
    (`BuiltinAggregateCarrier`), declared beside the renderer shape rather than
    on it because the spec this release is built against does not carry the key
    yet; new `BUILTIN_AGGREGATES` / `BuiltinAggregate` / `isBuiltinAggregate` /
    `resolveMeasureLabel`; `ChartSeriesOptions.builtinAggregateLabels` carries
    the locale strings in (core stays React-free and i18n-free — the same
    division as `nullCategoryLabel`). A field carrying a recognised
    discriminator resolves through that map; every other field keeps its wire
    `label` verbatim — never by matching the label's text or the field's name
    (the rejected option A).
  - `@object-ui/i18n`: `builtinAggregateLabels(tt)` resolves the six strings
    through the existing `report.aggregate.*` keys (zh already carried 计数 /
    求和 / 平均 / …; all ten packs are pinned to cover the vocabulary).
  - `plugin-charts` (`ObjectChart`), `plugin-dashboard` (`DatasetWidget`),
    `plugin-report` (`DatasetReportRenderer`): pass the resolved map to
    `buildChartSeries`.
  
  Before: 合作中 / 已流失 / 潜在 under an axis titled `Count`. After: the same
  chart titled `计数`; an `en` session still reads `Count`; an author-labelled
  measure (`Tasks`) and a measure literally named `count` without the
  discriminator are byte-for-byte unchanged. Until the upstream field is
  populated the wire carries no discriminator and every chart renders exactly as
  before.
- 20cb8db: `ObjectTimeline` refuses an undeclared date axis instead of inventing one
  (objectui#7459).
  
  Steps ① and ② of the three-step sequence the maintainer ruled on 2026-09-01
  (总监批 #28). House posture, on record with that ruling:
  日期轴永不虚构 — a date axis is never fabricated.
  
  `ObjectTimeline` resolved its date axis through five declared bindings and then
  closed the chain with a sixth rung that was a bare literal field name nobody
  has ever declared. A name therefore ALWAYS resolved: for a view that declared
  no axis, every record read a key its object does not carry, every event landed
  in the "No date" bucket, and the screen read as a timeline that had been built
  and simply had nothing in it.
  
  Two changes, shipped together because neither is observable alone:
  
  - **The renderer now refuses.** An object-bound timeline with no declared date
    axis renders a diagnostic naming every binding it accepts —
    `timeline.startDateField`, `timeline.dateField`, `mapping.date`, and the two
    deprecated flat spellings — instead of a chart. The twin of `ObjectGantt`'s
    "Gantt configuration required" screen, in the shape `5f4514f7b` settled.
  - **The invented sixth rung is gone**, which is the only thing that makes the
    refusal reachable. Added while the floor stood, it would have been dead code;
    retired without the refusal, it would have produced exactly the silent
    "No date" outcome the ruling rejects.
  
  **What changes for an author.** A view that declares a date axis is completely
  unaffected — all five declared spellings resolve exactly as before, and a
  timeline authored from literal `items` is never refused, since its items carry
  their own dates and no field name is read for them. A view that declared no
  axis anywhere, and was rendering an empty-looking timeline, now says so.
  
  ⚠️ Both premises were RE-MEASURED on the current tree before anything was
  edited, rather than taken from the card: the renderer had no absent-axis
  refusal (against a live control term that fires in the same file), and the
  floor was still present and still spelled as reported. The pairing itself is
  pinned — the refusal cases go red the moment the floor returns, including one
  whose records carry a column that happens to be named `date`, where a returned
  floor renders a convincing timeline rather than an empty one.
  
  Refusal is distinguished from "renders an empty timeline" by asserting the
  canvas is ABSENT, not merely event-free. The component's success surface is now
  named (`data-testid="timeline-canvas"`) so that distinction can be measured;
  every other terminal state of the component already named itself.
  
  Step ③ of the ruling — the `'created_at'` floors on the two plugin faces —
  stays for a later change (it landed as `04a67b9dc`) and is deliberately NOT in this change.
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
- 23b9958: `RecipientPickerField` gains a picker mode for the `field` sharing recipient
  (objectui#7613; maintainer ruling objectstack#14103, executor objectstack#15072).
  
  `sys_sharing_rule.recipient_type` carries a sixth value, `field` — the
  record-relative recipient. The recipients are whoever a user-valued column of the
  SHARED object names on each matched record, so `recipient_id` stores a field
  NAME (`assignees`, `owner_manager`) and not a record id. The widget's
  `TYPE_TO_OBJECT` table had no entry for that kind, so it fell through to the
  plain text input documented for unknown types: functional (the stored value was
  already the right one), but the admin had to know and type the machine name of
  the column by hand, with no list to choose from and nothing saying whether the
  name existed.
  
  When `recipient_type` is `field`, the widget now reads the shared object from
  the sibling `object_name` field — the same dependency the `filter-condition`
  widget already reads — loads that object's schema through
  `dataSource.getObjectSchema`, and offers its **user-valued** columns, storing the
  column's name.
  
  **The offered set is exactly the set the evaluator honours**, and that agreement
  is the point of the change rather than a detail of it. The sharing evaluator
  reads a column as users when it is the `user` type, or a `lookup` /
  `master_detail` whose `reference` is `sys_user`; anything else it treats as
  "grants nobody" and warns about once per rule. A picker offering a wider set
  would let an admin save a rule that looks configured and authorises nobody —
  worse than a hand-typed name, because it has a credible appearance. `hidden` is
  deliberately not filtered (the evaluator honours a hidden user column), and
  `reference_to` is deliberately not read (the protocol refuses that spelling by
  name, and so does the evaluator).
  
  Three things the mode says out loud rather than leaving to be inferred: it asks
  for the shared object before offering anything when `object_name` is still
  unset; an object with no user columns says so instead of rendering a
  search-flavoured "No matches"; and a stored name that is not on the offered list
  — a column deleted or retyped since the rule was saved — stays visible and is
  marked, because the evaluator grants nobody for it and a control that merely
  looked empty would hide a rule that still names it.
  
  Unknown recipient types keep degrading to the plain text input, and so does
  `field` itself when the data source cannot enumerate an object's columns: a
  hand-typed name is worse than a list, and better than a list that can never
  fill.
  
  Three copy keys are added across all ten locale packs
  (`fields.recipient.selectField`, `noUserFields`, `fieldNotUserTyped`). The
  "select an object first" gate deliberately reuses the criteria builder's
  existing sentence rather than adding a twin: it is the same sentence in the same
  role on the same form, gating on the same sibling field.
- 91f9276: **The maker's edit-mode starter offers sample data, not an automation v1 cannot
  build (objectui#7709).** Bound to an existing app (`?package=`), the maker's
  empty state offered four starters: add a field, add an object, add a dashboard,
  and 「加一个自动化 —— 审批、状态流转或通知」. Approval, status flow and
  notification are all refused by ADR-0112 v1 (cloud#1956 / PR #1970), and the
  measured behaviour on the sibling chips was not a refusal but a silent degrade
  into a view — so the product recommended an automation and would have handed
  back a page.
  
  Rewording it was not available: asking for a field, a view or a dashboard
  duplicates one of the three chips beside it. The fourth chip is now
  `addSampleData` —「给现有对象补一批贴近真实的示例数据，好拿去演示。」 — in all
  ten packs and in the call-site `defaultValue` fallback, which is a second copy
  of the same string. The three surviving chips all add STRUCTURE; what an app
  that already has objects most often lacks is DATA, and `seed` is on v1's
  authoring whitelist. A note beside the keys in every pack and at the call site
  says this chip's automation wording comes back when ADR-0112 v2 re-adds flows
  and actions, and the retired sentence for each pack is kept in the guard suite
  so v2 has it verbatim.
- a915064: `listImportMappings` no longer renders a refused door as "no mapping is registered"
  (objectui#7741).
  
  `ObjectStackAdapter.listImportMappings` degrades every failure to an empty list, and the
  import wizard hides its saved-mapping selector on an empty list. So "the server served
  zero mappings" and "the server refused, or broke" produced the identical UI on every
  deployment — the feature simply absent — with a `console.warn` as the only
  discriminator, in the browser console, with nothing pointing at it. That silence did not
  merely hide a fault: it produced a confident WRONG diagnosis in a careful reporter
  (objectstack#14026 was filed, routed and worked by two seats against a wizard that had
  been correct since `@object-ui/data-objectstack@17.1.0`).
  
  **The empty-list return is unchanged.** `listImportMappings` still answers
  `Promise<any[]>` and still never throws, on every arm including the loud ones — this is
  a channel added ALONGSIDE that contract, not a change to it.
  
  - **New: `ObjectStackAdapter.onMetadataReadWarning(cb)`** — a subscribe/unsubscribe
    channel, sibling in shape to `onWriteWarning` and `onSaveAdvisory`. It fires when a
    metadata read failed in a way that is NOT the supported "this deployment does not
    serve that kind" shape, carrying `MetadataReadWarningEvent`: which read it was, the
    object, whether the server `refused` this caller or the answer was `unreadable`, and
    the server's own ADR-0112 code, HTTP status and message.
  - **New: `classifyImportMappingsFailure(err)`** and `ImportMappingsFailureKind`, exported
    so a consumer can apply the same verdict. It reads the ERROR — the ADR-0112 `code`
    first, the status only where no code was declared — and never "is the result an empty
    array", which is what both conditions produce and so can never tell them apart.
  - **The older-server case stays quiet.** A deployment that does not serve the `mapping`
    kind (404/501 with no route, `ROUTE_NOT_FOUND`, `NOT_IMPLEMENTED`, or the metadata list
    door's 400 `INVALID_REQUEST`) still degrades to an empty list with no selector and no
    event. That is a real, supported deployment shape and it must not become a visible
    fault.
  - **The console now says so.** `AdapterProvider` subscribes to the new channel and
    renders a warning toast naming the object, the remedy and the server's own words, so a
    user without devtools open can tell "there are none" from "we could not find out".
    Three new `console.importMappings*` keys ship in all ten locale packs.
  
  This applies framework objectstack#13906 decision 1 option A — *a thing that could not be READ is
  not a thing that is ABSENT* — at this seam. It is an already-adopted discrimination, not
  a new principle.
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
- 0758bd8: `ObjectChart` refuses an object-bound chart that declares no category axis (objectui#8168).
  
  An object-bound chart that named no field to group by used to be composed anyway.
  `runAggregate` passed `schema.aggregate` to `ds.aggregate(objectName, { field,
  function, groupBy, filter })` with no guard on `groupBy`, and the `ds.find` leg
  handed the same bag to `aggregateRecords`, which buckets every record on
  `record[groupBy] ?? 'Unknown'`. So one path asked a driver to group by `undefined`
  and the other collapsed the whole object into a single `'Unknown'` bar — and which
  of those a reader saw was decided by the data source, not by the renderer. The only
  loud states this component had were a fetch `error` (`chart-error`) and a generic
  "No data yet"; neither is a statement about an absent binding.
  
  `ObjectCalendar`, `ObjectGantt` and `ObjectTimeline` each already refuse a view that
  declares no axis. This is the fourth, following `ObjectTimeline`'s shape
  (objectui#7459): a `role="alert"` box, `data-testid="chart-missing-category-axis"`,
  naming the bindings the author can declare — `aggregate.groupBy`, `xAxisKey`,
  `xAxis.field` — rendered from the resolver's own vocabulary so the message cannot
  drift from what the resolver reads.
  
  **Breaking, deliberately — and this repo ships breaking as `minor`.** A chart that
  previously rendered an `'Unknown'`-bucketed bar (or whatever the driver did with
  `groupBy: undefined`) now renders the refusal instead. That is the intent: the
  picture it drew was not a picture of the data.
  
  It keys on the CATEGORY alone. A measure may legitimately be absent — `count` takes
  no field — so refusing on an absent measure would refuse `count` grouped by a
  declared category, a chart that renders correctly. Four shapes are deliberately
  untouched: an ADR-0021 `dataset` chart (which may declare no dimension), a chart
  carrying authored `data` or a `bind` scope (no field name is read to fetch those
  rows), a spec-shape `xAxis: { field }` with no `xAxisKey` (resolved through
  `normalizeChartSchema`, this package's one translation of the author-facing shape),
  and every schema the five in-repo producers compose today — all five floor their own
  category, so none of them can reach the refusal.
  
  This does **not** retire the six `'name'` / `'value'` floors at the three relay faces;
  that is the remainder of objectui#7547 and is mechanical only once this screen exists.
  
  New key `chart.unconfigured.noCategoryAxis` in all ten locale packs.
- a695f50: `@object-ui/i18n` now publishes `TranslateFn` — i18next's `t` narrowed to
  `(key: string, options?: Record<string, unknown>) => string` — as the one
  authority for that name (objectui#8261, on the maintainer's ruling on
  objectui#8165, option A):
  
  ```ts
  import type { TranslateFn } from '@object-ui/i18n';
  ```
  
  `@object-ui/app-shell` (`writeWarningToast`, which its sibling toast modules
  re-export) and
  `@object-ui/fields` (`file-size-guard`) each declared their own copy of this
  type. Both copies were byte-identical to the new declaration, and both modules
  now re-export it from `@object-ui/i18n` instead of declaring it, so every
  existing import of `TranslateFn` from those modules resolves to the same type
  it did before — no call site's contract moves. Neither package publishes the
  name from its own entry; `@object-ui/i18n` is the one place to import it from.
  
  The `TranslateFn` entry in the one-authority gate's `KNOWN_COLLISIONS` baseline
  (`scripts/__tests__/one-authority-per-exported-name-6273.test.ts`) is removed:
  the name now has one declaration.
- 55ba3ff: A `lookup` reference that resolved to nothing now gets **one** answer instead of
  two opposite ones (objectui#8695), carrying objectui#8434's ruling to the second
  renderer that had the same defect.
  
  `LookupCellRenderer` split a single epistemic state — *a reference this screen
  did not resolve* — by the **shape of the string**. `isLikelyOpaqueId` sent
  opaque-looking ids to a muted `—` and sent everything else to confident bare
  text. Measured with `reference_to: 'sys_user'`, `'Ada Lovelace'` rendered
  `<span class="block max-w-full truncate" title="Ada Lovelace">Ada Lovelace</span>`
  — **byte-identical** to what a `text` cell prints for the same string — while
  `'01HQZX9K2M4N6P8R'` rendered a muted `—`. So the name-shaped case stated a
  confident fact the screen did not have (a dirty row read exactly like a clean
  one), and the opaque case destroyed the raw id, which objectui#8434's triage
  named as "the only clue for diagnosing existing dirty rows". Two opposite
  failures, one state.
  
  Both now render the affordance objectui#8434 settled on: the raw value kept
  **visible**, beside a muted marker glyph and a stated sentence, keyed as
  `detail.unresolvedLookupReference` in all ten locale packs. `master_detail` and
  `tree` route through the same renderer and get the same answer, as does the
  multi-value chip shape — including the `+N` overflow chip's `title`, which now
  lists the values it hides instead of a row of dashes.
  
  **The sentence is epistemic, not ontological, and it is a sibling of the `user`
  one rather than the same key.** At least six causes reach this arm and the
  renderer distinguishes none of them: never fetched, in flight, the resolver
  threw, the resolver answered with no record, it answered with a record no
  display field could name, and — for array entries after the first — never asked.
  `useLookupName` returns `string | undefined`, dropping the `pending`/`err`/`ok`
  discriminator its own cache holds. Several of those also cover a record the
  viewer may simply not be allowed to read, and "cannot read" versus "does not
  exist" is a boundary this renderer cannot see across. So it states only what is
  true of all of them: this screen did not resolve it. The `user` pack value ends
  "was not resolved to a user", which is false on a lookup pointing at any other
  object, hence a separate key.
  
  **Why `minor` and not `patch`.** The test this lane applies is whether EXISTING
  STORED DATA renders differently, and here some of it is not broken data.
  `LookupCellRenderer` auto-resolves only the FIRST primitive of an array
  (`primaryPrimitiveId`, and `resolveLabel` returns a name only when
  `val === primaryPrimitiveId`) — a documented cheapness policy, not a defect. So
  on a multi-value `lookup` holding perfectly clean ids, entries 2..n were never
  asked and now wear the unresolved marker where they previously printed a bare
  id or a dash. That is a visible change to a working screen over correct data,
  which is the line between the two levels; the name-shaped and opaque-shaped
  single-value cases would each have been `patch` on their own, since both were
  already wrong. `@object-ui/i18n` is `minor` for the ordinary reason: a key is
  ADDED — `detail.unresolvedLookupReference`, across all ten packs (the `user`
  sentence `detail.unresolvedReference` already shipped with objectui#8434).
  
  **Nothing else moves.** A reference resolved by an expanded record, by the
  author's `options`, or by the fetch-on-demand resolver renders exactly as before,
  unmarked; an empty cell keeps `EmptyValue`; the affordance sits inside
  `ReferencedRecordLink`, so an unresolved reference is still navigable
  (objectui#4336). Display only — no query, sort, export or save path reads a cell
  renderer's output. `isLikelyOpaqueId` stays exported (removing it would be a
  breaking change) but no longer decides how anything is drawn.
- ef52001: Retire 23 measured-dead locale keys from all ten packs — two whole families and
  eleven individual leaves (objectui#8754; director seat summon #22, 2026-09-12,
  maintainer verbatim 「其他同意」).
  
  **Breaking, deliberately.** These keys no longer exist in any of the ten built-in
  packs. This repository has no reader for any of them, but `@object-ui/i18n` is a
  published package: an application outside this repository that calls `t()` with
  one of the keys below now renders the raw key name instead of a sentence, with no
  error thrown (i18next's missing-key fallback). That risk is accepted rather than
  overlooked — the standing maintainer ruling is immediate retirement with no staged
  window and no double-spelling grace, on the grounds that 「已发布零消费的能力不因
  沉没成本获得豁免」.
  
  Marked `minor` rather than `major` because this repository's fixed release group
  tracks `@objectstack`'s major line; the breaking semantics are stated here instead.
  
  **Migration.** If you call one of these keys, supply the string yourself — pass
  `defaultValue` to your `t()` call, or add the key to your own application's
  resource bundle. For the two families there is a better answer than re-adding the
  key, because a live surface already exists and the retired family was never wired
  to it:
  
  - `approvals.*` — the shipping approvals UI renders through **`approvalsInbox.*`**,
    a different namespace that is fully populated in all ten packs. Point at that.
  - `marketplace.pricing.*` — nothing renders pricing labels in this repo at all.
    There is no replacement key; author your own.
  
  **The two families, retired whole** (the unit of this retirement is the family:
  retiring half a dead family leaves the other half looking live by contrast, and
  the namespace roots are removed, not merely emptied):
  
  - `approvals.approve`, `approvals.approveSuccess`, `approvals.comment`,
    `approvals.reject`, `approvals.rejectConfirm`, `approvals.rejectSuccess`
  - `marketplace.pricing.contact-sales`, `marketplace.pricing.free`,
    `marketplace.pricing.freemium`, `marketplace.pricing.paid`,
    `marketplace.pricing.subscription`, `marketplace.pricing.usage-based`
  
  **The eleven individual leaves.** Each was held out of an earlier sweep by a
  LONGER live sibling that merely contained it, until PR objectui#8753 put a
  key-boundary requirement on the text probe. The sibling that actually renders is
  named beside each, and every one of them is unaffected by this change:
  
  - `appDesigner.noNavItems` — renders as `appDesigner.noNavItemsHint`
  - `appDesigner.separator` — renders as `appDesigner.separatorLabel`
  - `console.objectView.groupBy` — renders as `console.objectView.groupByField`
  - `console.objectView.toolbar` — the live sibling is `…toolbarEnabledCount`
  - `dashboard.removeWidget` — the live string is the designer table's own
    `engine.inspector.dashboard.removeWidget`, a different corpus
  - `form.addItem` — likewise the designer table's `engine.form.addItem`
  - `home.recent` — renders as `home.recentApps.title`
  - `home.starred` — renders as `home.starredApps.title`
  - `home.subtitle` — the live sibling is `home.build.subtitle`
  - `sidebar.help` — renders as `sidebar.helpTooltip`
  - `workspace.create` — renders as `workspace.createTitle` / `…createButton`
  
  **How the set was admitted.** Not from the card's body: `pnpm check:i18n-dead-keys`
  was re-run on this change's own base after the objectui#9222 instrument repair,
  and every key above is CONFIRMED by that run, or is NEEDS-REVIEW whose only hit is
  non-liveness (a changelog line; a pin test). The retirement is pinned negatively by
  `packages/i18n/src/__tests__/dead-pack-keys-retired-8754.test.ts`, because every
  other i18n gate in this repo runs call site → key and none of them can see a key
  coming back.
- 804831c: A render-time filter refusal now renders a named "this view's filter is malformed" state instead of throwing out of render (objectui#9050).
  
  `convertFiltersToAST` refuses eleven authored shapes with a `FilterOperatorError`, and
  `toFilterNode` delegates to it from four call sites that are not on the wire path:
  `RelatedList`, `LineItemsPanel` and `ObjectGrid` read it from a render-time `useMemo`
  (where a throw is a render error, with no `classifyLoadError` to turn it into "the
  filter is malformed"), and `ObjectGrid`'s deprecated `defaultFilters` leg reads it
  inside the load effect, which caught the refusal but reported it under "Error loading
  grid" over the converter's English paragraph.
  
  What changes:
  
  - `@object-ui/core` gains `toFilterNodeSafely`, whose result is a UNION — `{ ok: true,
    node }` or `{ ok: false, refusal }`. The refusal is deliberately NOT representable as
    `undefined`: `undefined` means "no filter", i.e. every row, which is the silently
    unconstrained query objectui#9001 closed. A caller must narrow before it can build a
    query.
  - `FilterOperatorError` now carries `operator` and `field` as data, and
    `filterRefusalSubject` picks the token a diagnostic names. The eleven messages
    deliberately share no idiom, so recovering that token by pattern would be a twelfth
    dialect. `operator` is the spelling the AUTHOR wrote, never a canonical form
    substituted for it; it is absent on exactly the two arms that judge a comparand
    written with no operator in it, where `field` is the only handle.
  - The three render-time readers keep the refusal as a value, send nothing, and render a
    state that names the operator. The subtree around them is unaffected — on the
    schema-rendered path a `SchemaErrorBoundary` already contained the throw, so what is
    new there is the DIAGNOSIS in place of a generic "Component failed to render"; mounted
    directly, which every one of these components supports through its package entry,
    there was no boundary at all and the throw reached the host.
  - `view.malformedFilter` is added to all ten locale packs and to the three affected
    `createSafeTranslation` tables.
  
  ⛔ Not changed: which shapes convert. The converter's accept set is byte-identical —
  this is a delivery change, not an acceptance one. Where the protocol's own parse accepts
  an input this layer refuses, that gap is the protocol's to close and is filed against
  `@objectstack/spec` rather than papered over here.
  
  ⚠️ **Dated note, 2026-09-27 — one more refusal carries no operator — objectui#9164.**
  Later in this same release `convertFiltersToAST` also refuses an empty operator map that
  is all a filter says (`{ a: {} }`). Its `FilterOperatorError` carries `field` and no
  `operator`, like the two comparand arms, so `filterRefusalSubject` names the field and
  the three render-time readers show the malformed-filter state for it. The counts above
  (eleven shapes, two arms without an operator) are this change's reading. The rest of this
  entry is kept as the reading of this change; the objectui#9164 entry states the new
  refusal.
- 2bf34f7: The console's "app not available" screen now says what it measured, and the by-name app
  probe stopped folding four answers into one (objectui#9262).
  
  **BREAKING for consumers of the published `AppAccessVerdict` type.** `probeAppAccess`
  widens by two members ruled by the maintainer: `granted | denied | unknown` becomes
  `granted | denied | not_found | unreachable | unknown`. A consumer that exhaustively
  switches on the verdict gains two cases. The meaning of `unknown` also narrows — it no
  longer means "an absent app, an unreachable server, or an adapter that cannot ask", it
  means only that nothing was asked (a host DataSource without this probe). Code that read
  `unknown` as a positive absence must move to `not_found`.
  
  **What users see.** The sentence `This app is not available yet — it may still be
  publishing. Try again in a moment.` is retired from all ten locale packs. It was asserted
  for seven distinct causes, only one of which is a publish, and it is the screen an author
  lands on after any of them — the same defect objectui#4252 split `denied` off this screen
  for. In its place: `This app can't be opened` for a measured absence, `Couldn't reach the
  server` for a probe that got no answer, the unchanged denial screen for a permission
  refusal, and a neutral `App not available` when nothing was measured. All but the denial
  keep the Retry button, because all but the denial can change on their own. A genuine
  post-publish lag reads as an absence, and the one forced metadata refresh that gives that
  lag its chance to resolve is unchanged.
  
  **Measured before the branches were written.** On a real server the by-name route answers
  `200` with the declared envelope MINUS its `item` for a name that does not exist — not the
  `404` this code assumed — so `probeAppAccess` returned `granted` for every typo, every
  never-created app and every unpublished draft. `granted` fell through to the same screen as
  `unknown`, which is why nothing showed. Absence is therefore read from the envelope as well
  as from the `404` code; a `not_found` branch keyed on the status alone would have been dead
  for the commonest case.
- 15b33ae: Build history rows now state their item count in each language's own grammar
  (objectui#9266).
  
  The commit timeline composed the count by concatenation — the row rendered the
  number itself and then asked the locale pack for a bare unit word to sit beside
  it. A pack that never sees the number cannot agree with it, so, measured through
  a real render at one item, six of the ten packs read `1 Elemente`,
  `1 éléments`, `1 elementos`, `1 itens`, `1 элементов` and `1 عناصر`.
  
  `preview.history.items` now carries the count itself, one interpolated value per
  pack, and the call site passes `count` instead of printing the digit beside the
  translation. Each pack states the quantity in an idiom whose grammar does not
  bend on the number: `de` / `fr` / `es` / `pt` / `ru` / `ar` take the label-colon
  form (`Elemente: 3`, `Элементов: 3`), which is what
  `fields.textarea.charactersRemaining` already uses for this same reason.
  
  `en`, `zh`, `ja` and `ko` render exactly what they rendered before, at every
  count — the three CJK packs because their grammar marks no plural, and `en`
  because its value already carried the count-invariant `(s)` marker. No copy that
  was correct has been changed.
  
  A real `_one` / `_other` plural family was measured and not adopted: identical
  key sets across the ten packs leave `ru` without `_few` and `ar` without
  `_two` / `_many`, so those categories fall through to the base key and `ru` would
  still read `2 элементов` — wrong at the counts a build history shows most often.
  
  The count is kept. Dropping the number (the route taken for `kanban.columns`,
  where the lanes are visible anyway) would delete information here rather than
  de-duplicate it.
- 641fb55: The `FilterBuilder` dropdown speaks the protocol's operator ids (objectui#9306).
  
  `defaultOperators` now emits the twenty members of `@objectstack/spec`'s
  `VIEW_FILTER_OPERATORS`, spelled as the spec spells them (`not_equals`,
  `greater_than_or_equal`, `is_null`, `icontains`, …), plus the two opt-in
  existence ids `exists` / `notExists`, which the protocol has no member for and
  which stay unfolded (objectui#9559 ruling B). The camelCase ids the dropdown used
  to emit (`notEquals`, `greaterOrEqual`, `isNull`, …) are the spec's deprecated
  alias form (objectui#7993); `containsCaseInsensitive` is the one former id the
  spec's alias table has no row for, and the builder reads it itself (below).
  
  **Stored filters keep loading.** The builder folds a stored spelling at its read
  boundary, through the spec's `normalizeFilterOperator` plus one local row the
  spec's alias table lacks (`containsCaseInsensitive` → `icontains`,
  objectstack-ai/objectstack#20092), and the author's next edit writes the
  canonical id back. Opening a stored filter writes nothing. No row changes the
  predicate it stores: the sharing-rule criteria, the dataset filter, the saved-view
  fold, the live grid and the override recovery pass were each measured over all
  22 former ids against the ids they became, and store the same predicate. The only
  cells that differ are `icontains` on the three consumers that never offered the
  case-insensitive contains (dataset filter, saved-view fold, live grid), where
  the old id produced no storable filter at all and the new one does.
  
  **Breaking, stated here because the group never takes a `major`:**
  
  - `@object-ui/components`: the published `FilterBuilderOperator` type NARROWS
    from the camelCase union to the spec's `ViewFilterOperator` plus `'exists' |
    'notExists'` — a `'greaterOrEqual'` literal typed against it no longer
    compiles. `FILTER_BUILDER_OPERATORS` and `VALUELESS_FILTER_BUILDER_OPERATORS`
    hold the canonical ids, and a host's `onChange` receives them. New export:
    `normalizeFilterBuilderOperator`, the builder's read-side fold.
  - `@object-ui/components`: `icontains` ("Contains (ignore case)") is no longer
    opt-in. Its old reason — only the Mongo criteria dialect could carry a
    case-insensitive contains — stopped being true when `VIEW_FILTER_OPERATORS`
    gained `icontains` (spec 17.1.0), and `OPT_IN_OPERATORS`' own docblock recorded
    deleting the entry as the planned outcome. It is offered on the text bucket to
    every consumer; `contains` and `icontains` stay two operators (objectui#7379).
  - `@object-ui/i18n`: the `filterBuilder.operators.*` keys are re-keyed to the
    canonical ids in all ten packs (`filterBuilder.operators.is_null`, …); every
    translated value is unchanged. A host that overrides one of these keys must
    re-key its override.
  - `@object-ui/fields`: `FILTER_CONDITION_EXTRA_OPERATORS` is `['exists',
    'notExists']` — the case-insensitive contains needs no grant any more.
    `FilterConditionField` still writes `$icontains` for it, and its builder rows
    (`kvToCondition`) carry the canonical ids.
  - `@object-ui/plugin-view`: `toFilterGroup` emits the canonical ids.
  
  Also in `@object-ui/app-shell`: the dataset inspector's bridge maps `icontains`
  to `$icontains`; the drill-down "is null" chip reads the re-keyed label; and the
  view-override recovery pass folds a row's operator before its value-less check,
  so a stored `{ operator: 'isEmpty', value: '' }` row is kept rather than dropped
  as unfinished.
- c698a81: Render the environment admin's read-rate report from the usage endpoint's `readRate`
  reading (objectui#9954; maintainer ruling on cloud#2333, batch #164 item 3).
  
  The tenant runtime's `GET /api/v1/usage/storage` gained one optional nested key,
  `readRate`, carrying the control plane's verdict (`state`), the ratio it measured
  (`readsPerWrite`) and the line that verdict was taken against (`ratioThreshold`). The
  data half landed on the cloud side; nothing in this repo consumed it, so a measured
  anomaly reached nobody. This is the rendering half.
  
  **New:** `useReadRateReading` (a hook beside `useAiUsage`) and `ReadRateBanner` (a
  layout surface beside `ImpersonationBanner`, mounted in `ConsoleShell` so every console
  route including `/home` carries it). Neither is exported from the package entry; a host
  reaches the banner only through `ConsoleShell`, which mounts it.
  
  Three properties of the contract shape the implementation, and each is pinned by a test:
  
  - **An absent `readRate` is not "fine".** It means the control plane reported NO
    reading. The hook reports it as `unmeasured`, which is a different value from a
    measured `ok` and from an unreadable endpoint. All three render nothing, and the code
    keeps all three apart — "why does my environment show no banner" has more than one
    answer and one of them is *nobody has measured it*.
  - **An absent `readsPerWrite` is the worst case, not a missing number.** It means the
    environment made no writes at all, so the ratio has no upper bound. It gets its own
    title, its own sentence and the heavier tone — never a dash, and never a hidden
    banner.
  - **The threshold is data.** It is rendered from `ratioThreshold` on the wire; this repo
    holds no copy of the line, and the verdict is never re-derived from the ratio.
  
  It is a **report**: no gate, no throttle, no upgrade call to action, and the copy says in
  as many words that nothing is limited or blocked. It is shown only to a workspace admin,
  who is also the only session that issues the request.
  
  `@object-ui/i18n` gains the four `console.readRate.*` keys in all ten locale packs.
- 77f846a: The approval panel identifies the pending approver by name, not by a truncated raw id.
  
  A record waiting on a position rendered its approver as `positi…ager` — the
  engine reference `position:sales_manager`, 22 characters, past the identity
  formatter's 14-character truncation arm and middle-truncated to fit its chip. The
  step names beside it were human prose; the one line answering *who is holding
  this record* was an internal identifier, and not even a complete one. The same
  reference reached the admin-override confirm dialog un-truncated, so a paragraph
  of plain governance prose ended `— position:sales_manager`.
  
  Both surfaces now resolve the reference before rendering, in three tiers, most
  authoritative first. The server's own `pending_approver_names` wins whenever it
  answers, and a backend that resolves its own slate costs the record page no extra
  request. Otherwise the console reads the directory row the spec's approver
  binding names — `sys_position.label` gives `Sales Manager` / `销售经理` — and,
  for a position, who fills the seat (`Sales Manager · Zhang Wei, Li Na`). With no
  adapter and no row, the machine name still prettifies into prose rather than
  truncating. The raw reference stays on hover, which is where an internal
  identifier belongs.
  
  An unstaffed position is surfaced rather than hidden: `销售经理（暂无在岗人员）`
  is actionable where `positi…ager` is not, and it is the motivating rescue case
  for the admin-override path. Staffing is deliberately tri-state — a
  `sys_user_position` read the viewer is not permitted to make leaves the seat's
  staffing UNKNOWN and says nothing, because "I could not look" is a different
  claim from "nobody holds it" and only one of them is safe to print on a
  governance surface.
  
  Two locale keys are added across all ten packs: `approvalsInbox.approverUnstaffed`
  and `approvalsInbox.approverNameSeparator`. The separator is a translated
  punctuation key rather than `Intl.ListFormat`, which was measured on this tree
  joining `['张伟','李娜']` into `张伟李娜` for `zh` — two names run together with
  no separator, reading as one person's name.
  
  The directory-backed kinds and their value columns are read from
  `@objectstack/spec`'s `APPROVER_VALUE_SOURCES` rather than restated, so a new
  approver type is covered the day the spec publishes it. Id-valued kinds
  (`user` / `team` / `department`) keep the existing middle-truncation: a row id
  has no prose to recover, and that arm is objectui#3461's answer, not this card's
  defect.
- c40f3b8: A screen flow's resume result reaches the user — on both outcomes.
  
  A dogfood walkthrough reported that a refused `resume` and a successful one
  "render identically: the dialog closes and the page is unchanged", leaving no
  gesture that distinguishes "created" from "rejected". Re-measured against `main`
  before any change, one half of that was already fixed — `interpretFlowResponse`
  reads the ADR-0112 envelope, and `FlowRunner`'s `toast.error` has carried its
  prose since the `400 FLOW_FAILED` classification landed in `17.6.0`, five minors
  after the version the report was measured on. There was no interpreter bug and
  no un-consolidated fourth call site. Three gaps in the RUNNER's disposition were
  real, and they are what changed:
  
  - **A terminal failure no longer closes the dialog.** The reason it closed is
    unchanged and is not reversed: on a `FLOW_FAILED` the engine has already
    consumed the suspension, so a resubmit can only reach "No suspended run" and
    must not be offered. Closing was one way to withhold that dead retry and the
    expensive one — the user had just typed a form they could no longer see, and
    the engine's sentence names a value that left the screen with it. The dialog
    now stays open with the submit affordance withdrawn: the flat footer swaps
    Submit for Close, and an `object-form` step drops its Save (which also stops a
    second click from duplicating the record it had already persisted).
  - **The refusal has a second, non-expiring carrier.** The toast stays — it is
    viewport-fixed, so it still reaches a user scrolled past a tall step's header
    — and an inline destructive `Alert` (`role="alert"`) now holds the same
    sentence inside the dialog, beside the values that produced it. A retryable
    refusal (`INVALID_SCREEN_INPUT`, transport, 5xx) keeps Submit live as before,
    and its banner clears as soon as the user starts editing.
  - **A successful run invalidates what the flow WROTE, not just what the user is
    looking at.** Both hosts answered `onComplete` with
    `notifyDataChanged({ objectName: <this page's object> })`, so a flow that
    created a quote from an Opportunity page never told the related list that
    would now contain it — the record did not appear until a manual reload. The
    runner cannot know which objects a flow touched, so it emits
    `{ objectName: '*' }`: the same scope, for the same stated reason, that the
    record page's manual ⟳ already uses. Everything mounted refetches in place
    over the invalidation bus, with no remount.
  
  The runner's copy now goes through `@object-ui/i18n` instead of being hardcoded
  English: a new `flowRunner` namespace (`title`, `submitting`, `saveAndContinue`,
  `nextStep`, `completed`) in all ten packs, plus reuse of
  `common.{loading,cancel,close,submit}` and `wizard.missingRequired`. The
  server's own refusal sentence is still passed through untranslated — it is prose
  the automation engine composed for a human, not copy with a key.
- 6a576c9: Announce inbox messages when they arrive — an in-app toast while the tab is visible, a
  desktop notification while it is hidden (objectui#7011).
  
  The inbox was completely silent about arrivals. `sharedUserFeeds` polls
  `sys_inbox_message` every 10s, the rows landed in the store, the bell badge counted
  them — and a user not staring at the bell learned nothing, so approvals and @-mentions
  were routinely missed. Three candidate popup paths existed and none was connected to the
  inbox: the feed had no diff logic, the console's sonner bridge only serves notifications
  that explicitly declare `displayType: 'toast'`, and there was no `new Notification(` call
  anywhere in `packages/` or `apps/`.
  
  **Presentation layer only.** The transport is untouched: the same two reads, the same
  10s / 60s cadence, the same backoff, and no push channel. The accepted consequence is
  that a backgrounded tab can be up to a minute late — speeding the poll up to shave that
  would trade a server-wide cost for one surface's latency.
  
  What arrives:
  
  - **`useInboxArrivalNotifier`**, mounted from `useInboxBell` — the one wiring of the
    shared feed onto a bell — so the header bell and the `global:notifications` page block
    announce by the same rules and through the same `markRead`.
  - **`inboxArrivals`**, the pure diff: a session-scoped seen set, `(topic, title)`
    collapse reused from the inbox's own `groupNotifications`, and a bounded memory.
  - **`desktopNotifications`**, the single door to the browser Notification API.
  - **Two switches** in the account menu's Preferences section, stored per user in
    localStorage: in-app alerts (on by default) and desktop notifications (off).
  
  Four rules decide when nothing happens, and they matter more than the positive case — an
  announcer that pops for everything is worse than the silence it replaces, because users
  switch it off and then miss the approvals too:
  
  - the FIRST answered read primes the seen set and announces nothing, so historical unread
    at login or after a refresh updates the badge only;
  - several rows in one cycle announce once, collapsed by `(topic, title)`;
  - a row that already carries a read receipt never announces;
  - a hidden tab gets the desktop notification and no toast; a visible tab gets the toast
    and no desktop notification.
  
  **`Notification.requestPermission()` is called from the settings toggle's change handler
  and from nowhere else** — never on mount, on a feed refresh, or on a first message. A
  browser answers that prompt once and `denied` is permanent for the origin, so a
  load-time request spends the channel for every user who reflexively blocks, and no later
  release can undo it. A browser that has not granted permission behaves exactly as it did
  before this change: completely silent.
  
  Seven `notifications.*` keys are added to all ten locale packs.
- fffa30d: `listViews` no longer renders a refused metadata read as "this object has no saved views"
  (objectui#8151).
  
  `ObjectStackAdapter.listViews` degrades every failure to an empty list, and every consumer
  reads only the return. So "the server served zero saved views" and "the server refused, or
  broke" produced the identical UI — with a `console.warn` as the only discriminator, in the
  browser console, with nothing pointing at it. It is the same defect objectui#7741 removed
  from `listImportMappings` one method over, and the user-visible cost is the higher one: an
  empty `listViews` is an object's **view switcher**, so a user whose token lapsed
  mid-session could be shown an object that appears to have no saved views at all —
  including views they created themselves.
  
  **The empty-list return is unchanged.** `listViews` still answers `Promise<any[]>` and
  still never throws, on every arm including the loud ones — this is a channel added
  ALONGSIDE that contract, not a change to it. `listImportMappings` is likewise unchanged,
  down to its wording.
  
  - **`ObjectStackAdapter.listViews` now emits on `onMetadataReadWarning`** — the channel
    objectui#7741 added — when the read failed in a way that is not the supported "this host
    mounted no metadata door" shape. The event carries the object, whether the server
    `refused` this caller or the answer was `unreadable`, and the server's own ADR-0112
    code, HTTP status and message.
  - **New: `classifyViewsFailure(err)`.** A SEPARATE reading, deliberately not a second
    caller of `classifyImportMappingsFailure`: `view`'s quiet set is strictly smaller. The
    arm the mapping classifier is built around — 400 `INVALID_REQUEST`, the metadata list
    door's "this deployment carries no such kind" — is unreachable for `view`, which is in
    the platform's static spelling contract, so reading it as kind-absence would swallow a
    real refusal. On `view`, only a host with no `/meta` door at all stays quiet.
  - **`MetadataReadWarningEvent`'s `operation` and `kind` gain their second members**
    (`'listViews'` / `'view'`). This is the additive, reviewed widening the single-member
    unions were designed for, and it worked as designed: the consumer that renders these
    events had a `switch` naming one operation, so the widening turned "a views failure is
    toasted as an import-mapping failure" into a compile error rather than a runtime lie.
  - **New: `MetadataReadFailureKind`**, the neutral spelling of the three verdicts.
    `ImportMappingsFailureKind` is now an alias of it — identical members, so existing
    consumers are unaffected in both directions.
  - **The console says which list it was.** `metadataReadWarningToast` picks its title and
    its remedy by `operation`, so a failed view read reads *"Saved views for {{object}}
    could not be loaded … not because this object has no saved views"*. Three new
    `console.savedViews*` keys ship in all ten locale packs; the `console.importMappings*`
    copy is untouched.
  
  This applies framework objectstack#13906 decision 1 option A — *a thing that could not be READ is not
  a thing that is ABSENT* — at the second seam that needed it.
- 20e317c: Marketplace-less runtimes now say so instead of erroring: `OS_CLOUD_URL=off` is a
  first-class disabled state, and the load-failure hint describes the control plane
  the runtime was actually pointed at (objectui#5504).
  
  `apps/objectos-ee/deploy/.env.example` ships `OS_CLOUD_URL=off` as its factory
  default, so a stock self-hosted stack has no marketplace at all. The Console still
  recommended one: Home led with "Start with a template" and "Browse App
  Marketplace", and the click landed on a red **Failed to load marketplace / Not
  found** card whose hint claimed this runtime "points at the public ObjectStack
  cloud by default" and advised setting `OS_CLOUD_URL`. Both claims were false for
  exactly the deployment reading them — the operator had not left the default, and
  the advice pointed back at the template that told them to set `off`. "Marketplace
  disabled by configuration" is a configuration conclusion, not a load failure.
  
  - `isMarketplaceEnabled()` (`runtime-config`) reads the server's own
    `features.marketplace`, which `RuntimeConfigPlugin` derives per request from the
    serving app's route table (objectstack#8356). It is never inferred from the shape
    of a failed request: a control plane that is merely DOWN leaves the flag `true`,
    so an outage still renders as an outage. Unknown fails OPEN.
  - The marketplace page renders an informational "App Marketplace is turned off"
    state — muted, not `destructive` — and issues no request it knows will 404.
  - Home's "Start with a template" cover greys out with a visible localized reason,
    and the "Browse App Marketplace" shortcut is withheld, exactly as they already
    are for the `manage_metadata` capability gate.
  - `marketplace.load.failedHint` is replaced by `failedHintConfigured` (naming the
    configured control plane) and `failedHintSameOrigin`. The "points at the public
    cloud by default" sentence is gone: it was rendered unconditionally, including on
    every runtime whose operator had overridden `OS_CLOUD_URL`.
  
  All ten locale packs carry the new keys.
- 19cbf10: fix(app-shell): the report inspector no longer destroys a localized title or label
  
  `ReportChartSchema.title` and `ReportSchema.label` are `I18nLabel` — a plain
  string **or** an inline per-locale map. The report inspector narrowed both to
  the string arm when reading and wrote the typed string back over the whole
  value, so against a stored map the two halves failed in opposite directions:
  Studio painted an empty box over a report that has a title, and the retype that
  empty box invited replaced the map with a bare string, losing every other
  locale. Committing the empty box untouched deleted the stored map outright.
  
  Reads now go through `pickLocalized` and writes through `setLocalized`, so an
  edit lands in the active locale's entry and every other locale survives. An
  author shown a display fallback from another locale can neither overwrite nor
  delete the locale it was borrowed from.
  
  **Clearing is ruled, not inherited.** Clearing the box removes only the active
  locale's entry; when that was the last entry the key is dropped entirely, which
  is byte-for-byte what clearing a plain-string value already did.
  
  **What an author who does nothing differently now gets:** a report whose title
  or label is a plain string behaves exactly as before — same box, same committed
  value, including on clear. A report whose title or label is a locale map now
  shows their own locale's string instead of a blank box, and editing it keeps
  every other language instead of deleting it.
  
  `@object-ui/i18n` gains `clearLocalized`, the clear arm of the same
  single-locale editor `setLocalized` serves. Additive: no existing export
  changed shape.
- 8033ad1: The built-in record-detail tab labels and the last two English landmark names now speak the session locale (objectui#4645).
  
  `buildDefaultPageSchema` synthesizes the record-detail tab strip with plain
  English tokens on the nodes (`Details`, `Related`, `Attachments`, `Activity`,
  `History`, `Approvals`), and three of its own comments said those tokens
  "localize through the tab strip's `KNOWN_LABEL_DICT`". That dict shipped
  exactly two arms — `zh-CN` and `zh-TW` — so the claim held for Chinese and
  silently failed for the eight other shipped packs: a ja-JP or es-ES record
  detail rendered `Details / Related / Attachments` inside otherwise fully
  localized chrome, measured in a real browser on `@objectstack/console` 17.0.0
  GA and re-measured red on current `main`.
  
  Every one of those strings was already in all ten packs (`detail.details`,
  `detail.related`, `detail.activity`, `detail.history`, `detail.attachments`,
  `detail.approvalsPanelTitle`); the strip simply never asked. It asks now,
  BEHIND the exact-locale dict, which stays first because `zh-TW` has no pack of
  its own — i18next resolves it to the Simplified `zh` resource, so the dict is
  the only source of the Traditional forms — and because it carries tokens
  (`Notes`, `Files`, `Tasks`, `Events`, object names) that no pack does. `en` and
  `zh` render byte-identically to before; the other eight locales change from the
  English token to their pack value. `page:accordion` reads the same lookup, so
  the two renderers cannot answer differently for one token.
  
  Alongside it, the two `aria-label`s that were English in *every* locale —
  `HeaderHighlight`'s `Record highlights` and `RecordActivityTimeline`'s
  `Discussion` — no longer read English. `HeaderHighlight`'s now routes through
  the bundle. Its section carries no visible label, so the `aria-label` is the
  landmark as far as assistive tech is concerned (the argument objectui#4024 made
  for the dialog `Close` label, and objectui#5956 made for `record:path`'s own
  container name). `RecordActivityTimeline`'s section always had a visible
  heading, so it no longer has a fixed `Discussion` name. Its landmark is named by
  that heading's title: `detail.activity`, or an authored `titleLabel` such as
  `record:chatter`'s `detail.discussion` (objectui#9998). `detail.activity`
  already existed in all ten packs; `detail.highlightsLabel` is the single new
  key, added to all ten and mirrored byte-identically into
  `DETAIL_DEFAULT_TRANSLATIONS`.
- f157423: Studio workbench and AI tool cards speak the author's language (objectui#7254)
  
  - The Interfaces breadcrumb, canvas caption and navigation rail show the
    metadata label plus a translated kind; the internal `type · name` pair moves
    to the tooltip. An unlabelled nav leaf now falls back to its object name
    instead of rendering an empty row.
  - The Studio top-bar package switcher reads the package's human name from
    either position the packages endpoint serves it in, instead of degrading a
    registry-shaped entry to its reverse-domain id.
  - The dashboard property panel is localized: the spec's authoring form is
    overlaid through the platform's own `metadataForms.<type>` convention, so
    section headings, field labels, hints and the `header` composite's sub-fields
    render in Chinese (developer vocabulary such as "Tailwind units" is replaced
    with something an author can act on, not transliterated).
  - AI tool cards: tool titles resolve through `chatbot.tool.<name>` (all thirty
    platform-provided tools, ten locale packs), the header status badge is
    localized, and the plan count strip is a real plural family instead of an
    English `+ "s"` concatenation.
  - The tool card's header badge and its body badge now come from one producer:
    a proposal that has been confirmed, built or published no longer keeps a
    header reading "Awaiting Approval".
- 7a90afd: Studio's `新建对象` asks for the record-sharing baseline, and an unauthored one is reported before Publish rather than by it.
  
  Creating an object through Studio collected exactly two things — display name and
  identifier — and saved a draft that declared no `sharingModel`. The draft saved
  happily, the form designer worked, and the object was then refused at 发布 →
  全部发布 by `security-owd-unset`: a required decision the surface never asked
  for, delivered by failing, as English ADR prose in a toast that then vanished on
  a timer. The one actionable word in it named a control three clicks away that
  nothing routed to.
  
  The publish gate is correct and is unchanged — an org-wide default has to be an
  authored decision, not an accident. What changes is when the console asks and
  when it answers:
  
  - **The create dialog asks.** A third field collects the baseline, pre-selected
    to `private` and glossed with the Settings tab's own strings, so a new object
    is publishable by construction. `buildObjectSkeleton` now takes the value as a
    required parameter — a future create path cannot omit the baseline without
    failing to type-check. `controlled_by_parent` is deliberately not offered at
    creation: it derives access from a master relation a brand-new object does not
    have yet, so offering it would trade one publish refusal for another.
  - **The review sheet reports it.** The pending-changes panel now runs the
    framework's own `validateSecurityPosture` over the pending object drafts and
    names any blocking finding, with its fix-it hint, next to the Publish button.
    It mirrors the producer's rule rather than re-deriving it, and it reports
    without blocking — the server door stays the authority.
  - **The Settings tab stops calling an unset baseline safe.** It described unset
    as "defaults to Private", which answers what the runtime does and not whether
    the object can ship. It now reads as the publish-blocking problem it is,
    styled like the external-wider warning beside it.
- fb96ecb: `WidgetConfigPanel` reads an inline-locale-map title, and a save no longer destroys the other locales.
  
  The dashboard widget config panel carried a private `resolveLabel` documented as
  resolving an `I18nLabel` while reading `defaultValue || key` — the key-reference
  form `@objectstack/spec` retired at 17.0.0-rc.6 (objectstack#5055). The inline
  per-locale map `I18nLabelSchema` actually admits has neither limb, so
  `{ en: 'Revenue', zh: '收入' }` resolved to `''`. It was the fourth private copy
  of that resolver; objectui#4032 swept the other three out of `DashboardRenderer`,
  `MetricWidget` and `MetricCard`.
  
  This was not a display bug. The resolved value seeds the panel's editable draft,
  so a widget whose stored title was a map opened with an **empty** Title field and
  the next save wrote `''` over the author's map — on the ordinary path, not an
  exotic one: open the widget, change anything, save.
  
  Both halves are fixed, per the maintainer's 2026-08-20 ruling on objectui#5301:
  
  - **Reading** goes through `pickLocalized(value, language)`, so the panel shows
    the active locale like every sibling surface post-objectui#4032.
  - **Writing** replaces only the active locale's entry and carries every other
    locale across. A title the author never touched round-trips the stored object
    itself through an unrelated config edit; an edited one merges into the entry
    that was displayed. The live-update callback (`onFieldChange`) forwards the
    merged map for the same reason — hosts feed it back into the widget the panel
    re-opens from, so a bare string there dropped the map before a save ever ran.
  
  `@object-ui/i18n` gains `setLocalized(value, language, next)`, the write-side
  inverse of `pickLocalized`, so the rule is stated once instead of re-derived per
  panel. It follows `pickLocalized`'s first three limbs — exact tag, base language,
  region-qualified sibling — and deliberately stops there: the `default` / `en` /
  first-value limbs are display fallbacks that hand back *another* locale's string,
  and writing to one would let an author editing in `fr` overwrite English. With no
  entry for the active locale the edit adds one. The pairing
  `pickLocalized(setLocalized(map, lang, s), lang) === s` is pinned, because a
  write that lands where the read does not look is how a "saved" string disappears.
  
  A full multi-locale editing UI remains out of scope (objectui#4163).

### Patch Changes

- a507334: Full-page search results now read correctly in Russian and Arabic at every
  count (objectui#10024).
  
  The results line picks `search.resultsCount` at exactly one result and
  `search.resultsCountPlural` at every other count. Two slots cover English; they do
  not cover Russian, which needs three noun forms for whole numbers, or Arabic, which
  needs more. Russian's second slot held the form for 5 to 20, so two results read
  `2 результатов` (the language needs `2 результата`) and twenty-one read
  `21 результатов` (it needs `21 результат`). Arabic's two slots were the same string
  byte for byte, so the switch gave Arabic nothing at 2 or at 3 to 10.
  
  In both packs the count-not-one half is now a count label that reads correctly at
  any number: `Результатов по запросу "…": N` and `عدد نتائج البحث عن "…": N`. That is
  the device both packs already use where two slots are all there are — Russian's
  `collaboration.commentCount` (`Комментариев: N`) is the same shape on the same
  two-key convention. The singular half, the call site, the key set and the other
  eight packs are unchanged; `zh`, `ja` and `ko` keep one string in both halves
  because their languages have a single plural category.
  
  ⚠️ **Dated note, 2026-10-02 — superseded in this release — objectui#11445.**
  Later in this same release the `search.resultsCount` / `search.resultsCountPlural`
  switch gave way to a `search.resultsCount` count family in all ten packs:
  `ru` and `ar` now write a noun form for each CLDR category instead of the count
  label above (`2 результата`, `21 результат`), and `search.resultsCountPlural` left
  every pack. The rest of this entry is kept as the reading of this change.
- afb2284: `ObjectCalendar`'s user-visible copy now reaches the locale packs. The component
  was already i18n-aware — it imports and calls both translation hooks — and a set
  of English sentences sat beside those calls as literals, so a non-English session
  read a half-translated calendar: the unscheduled label and the two write-failure
  toasts in its own language, and the loading screen, the error screen, the refusal
  screen, the pull-to-refresh affordance, the whole quick-create dialog and the
  record overlay's fallback title in English (objectui#10031).
  
  Every one of those now reads a key. Two of them reuse keys the packs already
  carried (`common.cancel`, `common.create`), one reuses `calendar.newEvent`, and
  twelve are new under `calendar.`.
  
  **The hook is chosen per site by one criterion, which the file already stated for
  its existing call:** `useSafeTranslate`'s `tt(key, fallback)` passes no options to
  i18next and therefore cannot fill a hole, so the two sentences that carry one —
  the error prefix and the quick-create date line — read their key through
  `useObjectTranslation`'s `t()` with an inline default, and every hole-free string
  uses `tt()`.
  
  **⚠️ A key added to `en` is not an `en`-only change in this repo**, and that is
  worth stating because the cheap route looks available: the English fallback does
  carry the English text at the call site, but the key-set invariant is a
  pack-vs-pack one — every pack defines every `en` key — so it is answered by the
  locale packs, not by the call site. All ten packs therefore carry the twelve new
  keys, with real translations rather than the English value. The instrument that
  says so is `all-locales-key-parity.test.ts`; `pnpm check:i18n-drift` prints which
  of the two owns an addition.
  
  **One rendered English string moved**: the loading placeholder's three ASCII full
  stops became the typographic ellipsis, because its sentence is now a pack value
  and `ellipsis-glyph-3878.test.ts` holds every pack value to U+2026. The refusal
  screen's copy is byte-identical to what it rendered before, which is what keeps
  the five suites that pin it green.
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
- 63f4f92: A signed-in user's language has one source of truth: `sys_user.locale`.
  
  One word 「语言」 named two settings. The profile page's language card wrote the
  server column `sys_user.locale`; the console's globe menu switched a
  device-local UI language in `localStorage`. Neither writer could see the other,
  so a user who chose 日本語 on their profile went on reading an English console,
  with no refusal and no notice — and the profile card's own description said the
  two were separate, which was true and is what this change ends.
  
  For a signed-in user the column now decides, and the wiring is what makes that
  hold rather than anyone's discipline:
  
  - the globe writes `sys_user.locale` through the same adapter the profile card
    already used, so there is one writer path rather than two settings;
  - `@object-ui/app-shell` reads the column back once per shell, on mount and on
    every `sys_user` mutation the invalidation bus reports — which includes the
    profile card's save, so changing the language in either place changes it in
    both, in the same session and with no reload;
  - the device-local value is kept and demoted to a CACHE: it still decides before
    sign-in and for the first paint of a boot (the column cannot be read
    synchronously), and it is overwritten by the column as soon as the row is
    read. A stale device value can no longer outlive one round trip.
  
  A failed write is reported to the user and the local switch stands until the
  next successful read, which then takes the UI back to what the column says —
  never a silent no-op. A signed-out visitor is unaffected: with no `sys_user`
  row nothing is read and nothing is written, and the globe is the device-local
  switch it has always been.
  
  `@object-ui/i18n` is prose only here. Its precedence chain still adjudicates
  what it can see (device choice → tenant seed → browser → `en`), and its
  docblocks now say that a signed-in user's language is not one of those tiers:
  reading a `sys_user` row needs an authenticated data adapter, which a renderer
  package does not take as a dependency, so the host applies the column through
  the ordinary `changeLanguage`.
- 8cedb0d: The two declared display-locale contracts now each name the caller they govern,
  and each points at the other (objectui#10098). This is documentation only: no
  module's behaviour moves.
  
  - `DisplayNumberFormatOptions.locale` (`@object-ui/core`): leaving the tag
    `undefined` means the runtime default, and that rule is written for a non-React
    display caller with no tag in hand. For that caller the viewer's own environment
    is the honest locale for a user-facing display. A malformed tag lands in the
    same place through `formatDisplayNumber`'s retry.
  - `useDisplayLocale` (`@object-ui/i18n`): its concrete `'en'` last resort, kept for
    determinism, is the rule for a React renderer whose provider chain yields no tag
    at all, not a rule for every caller without a tag.
  - `formatNumberInDisplayLocale` (`@object-ui/plugin-report`): the note on its
    malformed-tag retry no longer calls the dropped-tag retry behind
    `formatDisplayNumber` a wrong answer. Each retry follows its own package's
    declared contract.
  
  Read alone, either docblock used to look like a rule for every caller, and each
  contradicted the other. The new wording reaches each package's published type
  declarations, which is why this is declared as a patch rather than left
  undeclared.
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
- bb5d4ee: Two display-locale faces now follow the session's display locale (objectui#10232).
  
  - `@object-ui/plugin-ai` is wired to `@object-ui/i18n` as a whole. The `nl-query`,
    `ai-form-assist` and `ai-recommendations` components read their strings from a new
    `ai.*` namespace, translated in all ten locale packs, instead of hard-coded English.
    The `nl-query` history date, which was formatted in the machine's locale, and the
    confidence and score percentages now format in the display locale
    (`useDisplayLocale()`). The package's manifest now names `@object-ui/i18n`, which also
    puts it inside the repo-wide machine-locale census.
  - `@object-ui/app-shell`: the Studio home page's "recently viewed" times and the Data
    pillar's last-saved time format in the display locale. They used to be handed
    `useMetadataLocale()`, which picks the designer's string table and is `en-US` for every
    language other than zh, so a de-DE session read US English. That hook's doc comment
    now says it must never be used as an `Intl` locale.
- dc666f7: fix(i18n): a translation bundle with no field label is recognised as a spec payload (objectui#10235)
  
  The console's `loadLanguage` asks `isSpecTranslationData` whether the payload it fetched is a
  `@objectstack/spec` `TranslationData`. On `true` it transforms the payload and namespaces it under
  `app`, where `useObjectLabel` and the screen-flow runner read it; on `false` it returns the payload
  untouched, for a mock or local-dev server that already speaks i18next namespaces. The predicate
  answered `true` only when some `objects` entry carried `fields`, so a genuine bundle that translated
  object labels, apps, pages, dashboards or flows — and no field label — took the untouched branch, sat
  at the root of the i18next resource tree, and was read by nothing: every screen drew the authored
  copy in every locale, with nothing reported.
  
  `isSpecTranslationData` now answers `true` for a payload carrying any top-level group of the served
  translation document — `objects`, `apps`, `messages`, `globalActions`, `dashboards`, `datasets`,
  `pages`, `flows`, `settings`, `metadataForms` or `settingsCommon` — whose value is an object. The
  console's own tests walk that group list off `@objectstack/spec`'s `GetTranslationsResponseSchema`,
  so a group the spec adds and the predicate does not know fails a test instead of being dropped.
  
  An already-namespaced i18next tree still takes the untouched branch: its top-level keys are namespace
  names (`common`, an app namespace such as `crm`, or the `app` the transform itself emits), none of
  which is a spec group, and no built-in locale pack namespace is spelled like one. A group-named key
  holding a string or an array is not treated as a group.
  
  What a user sees change: in the console, an app whose translation bundle carries no field label now
  shows its translated object names, app and navigation labels, dashboard and page titles, and
  screen-flow wizard copy, where it used to show the authored copy.
- 3335767: Russian now reads correctly at every count on the tab-count badge's accessible
  name and the activity-feed reaction chip, and Arabic on the badge and the comment
  thread's count and reaction tooltip (objectui#10242).
  
  Each of these surfaces picks its `…One` key at exactly one and the plain key at
  every other count. Two slots cover English. They do not cover Russian, which needs
  three noun forms for whole numbers, or Arabic, which needs more. Where the plain key
  held a single noun form, it was wrong at some of the counts it serves. A Russian tab
  badge read `2 элементов` at two (the language needs `2 элемента`) and
  `21 элементов` at twenty-one (it needs `21 элемент`), and a Russian reaction chip
  read `2 реакций` at two. The Arabic badge, comment count and reaction tooltip used
  the plural form for three to ten, which is wrong at two and from eleven up.
  
  The count-not-one half of these five values is now a count label that reads
  correctly at any number:
  
  - `ru` `common.itemCount`: `Элементов: N`
  - `ru` `detail.reactionCount`: the emoji, then `Реакций: N`
  - `ar` `common.itemCount`: `عدد العناصر: N`
  - `ar` `collaboration.commentCount`: `عدد التعليقات: N`
  - `ar` `collaboration.reactionCount`: `عدد التفاعلات: N`
  
  That is the device objectui#10024 used for `search.resultsCountPlural`, and the one
  Russian's `collaboration.commentCount` and `collaboration.reactionCount` already
  use. The singular halves, the key set, the call sites and the other eight packs are
  unchanged.
  
  ⚠️ **Dated note, 2026-10-02 — superseded in this release — objectui#11445.**
  Later in this same release the `…One` / plain-key switch on `common.itemCount`,
  `detail.reactionCount`, `collaboration.commentCount` and
  `collaboration.reactionCount` gave way to one count family per key in all ten
  packs: a numeric count picks the noun form its CLDR category needs (`ru`
  `2 элемента`, `21 элемент`), the `…One` siblings left every pack, and the count
  labels above remain only on the base key, which answers a call made without a
  count. The rest of this entry is kept as the reading of this change.
- 1dbb993: fix(plugin-designer): the Navigation Designer has an entry for the spec's `doc` navigation item type
  
  objectstack#19789 added a `doc` member to the spec's navigation item union (an
  item that targets a book and/or a doc). `NAV_TYPE_META` in `NavigationDesigner`
  is keyed by that spec-derived union, so objectui stopped compiling against
  `@objectstack/spec` built from objectstack `main`, and every row reads its badge,
  colour and icon from that map. The map now has a `doc` entry (a `BookOpen` icon,
  its own colour and the `appDesigner.navTypeDoc` label key). The key has an
  English fallback in the designer's defaults and a translation in all ten locale
  packs.
  
  The map is typed `Record<NavigationItemType | 'doc', ...>` so it compiles both
  against the pinned `@objectstack/spec`, which predates `doc`, and against
  objectstack `main`. The `| 'doc'` goes away at the pin bump that ships `doc`.
  `doc` is not added to the quick-add buttons: an empty `doc` item fails the spec's
  book-or-doc requirement, and authoring one is objectui#10188.
- 45362a3: Russian now reads correctly at every count on the list view's record-count bar,
  and Arabic on that bar, the record picker's count, the activity-feed reaction chip,
  the presence avatars' accessible name and overflow tooltip, and the full-page
  search count while browsing (objectui#10425).
  
  Each of these surfaces picks its `…One` key at exactly one and the plain key at
  every other count. Where the plain key held a single noun form, it was wrong at
  some of the counts it serves. The Russian record-count bar read `2 записей` at two
  (the language needs `2 записи`) and `21 записей` at twenty-one (it needs
  `21 запись`). The Arabic values each held one noun form (the plural for three to
  ten, or in `lookup.recordCount` the singular), while Arabic needs different forms
  at two, at three to ten and from eleven up.
  
  The count-not-one half of these seven values is now a count label that reads
  correctly at any number:
  
  - `ru` `list.recordCount`: `Записей: N`
  - `ar` `list.recordCount`: `عدد السجلات: N`
  - `ar` `lookup.recordCount`: `عدد السجلات: N`
  - `ar` `detail.reactionCount`: the emoji, then `عدد التفاعلات: N`
  - `ar` `collaboration.presentUserCount`: `عدد المستخدمين المتواجدين: N`
  - `ar` `collaboration.moreUserCount`: `عدد المستخدمين الآخرين: N`
  - `ar` `search.itemsAvailable`: `عدد العناصر المتاحة: N`
  
  That is the device objectui#10024 and objectui#10242 used, and the one Russian's
  `lookup.recordCount` already uses. The singular halves, the key set, the call sites
  and the other eight packs are unchanged.
  
  ⚠️ **Dated note, 2026-10-02 — superseded in this release — objectui#11445.**
  Later in this same release the `…One` / plain-key switch on `list.recordCount`,
  `lookup.recordCount`, `detail.reactionCount`, `collaboration.presentUserCount`,
  `collaboration.moreUserCount` and `search.itemsAvailable` gave way to one count
  family per key in all ten packs: a numeric count picks the noun form its CLDR
  category needs (`ru` `2 записи`, `ar` `3 سجلات`), the `…One` siblings left every
  pack, and the count labels above remain only on the base key, which answers a
  call made without a count. The rest of this entry is kept as the reading of this change.
- 2a943bf: fix(app-shell): a cloud Re-seed / Purge refused with `ENVIRONMENT_KERNEL_UNAVAILABLE` now says why and stops offering the retry
  
  `reseedSampleData` and `purgeSampleData` kept only the text of a refusal and
  dropped its error code. On a 500 that text is the control plane's withheld
  generic sentence, so the package page showed the same message for every server
  fault. That included a control plane with no environment kernel, where the two
  actions can never succeed (cloud#2072).
  
  Both calls now return the code beside the text. When the code is
  `ENVIRONMENT_KERNEL_UNAVAILABLE`, the package page says that this control plane
  has no environment kernel and that the action must be run from the
  environment's own runtime, and it disables both cloud sample-data actions for
  the rest of the visit. Every other code, `INTERNAL_ERROR` included, keeps
  today's message and leaves the actions enabled. The HTTP status handling is
  unchanged.
  
  `@object-ui/i18n` carries the new sentence as `marketplace.detail.sampleDataKernelUnavailable`
  in all ten locale packs.
- 8740e86: fix(fields): the editable date-time faces no longer roll a stored impossible day into a real one
  
  `toDateTimeInputValue` let a `Z`, offset or date-only spelling fall through to
  `new Date(...)`, which accepts a day of 01-31 for every month and rolls the
  surplus forward: a stored `2026-02-30T10:00:00Z` reached the `datetime-local`
  control as `2026-03-02T10:00`, and an edit could save that day back. The read
  faces already refuse such a value (objectui#10026, objectui#10301).
  
  The adapter now asks the same judgement (`isRealCalendarDate`) of the day AS
  WRITTEN, before any conversion, in every spelling, and `fromDateTimeInputValue`
  never re-emits a nonexistent day as a rolled one. A `datetime-local` control can
  paint a nonexistent day only blank (measured in Chromium), so the editable
  `DateTimeField` and the sub-grid's editable `datetime` cell leave the control
  empty, mark it `aria-invalid`, and name the stored string beside it with the new
  `fields.dateTime.impossibleDay` sentence (all ten packs). Nothing is written until
  the user picks a new value; a real date-time and a zone-less value behave as before.
- ac2d6f1: fix(fields): the editable date-only faces no longer blank a stored impossible day silently
  
  `toDateInputValue` keeps a stored `2026-02-30` as written and never rolls it,
  but an `<input type="date">` sanitises a day that does not exist to an empty
  value (measured in Chromium). So `DateField` and the sub-grid's editable `date`
  cell showed an empty control with no marker for a value that was stored. That
  is a silent blank, which the direction of objectui#10026 rules out, and it is
  the date-only half of objectui#10474.
  
  Both faces now judge the day as written with `isImpossibleStoredDay` (the check
  objectui#10474 added). For such a day they hand the control an empty value,
  mark it `aria-invalid`, and name the stored string beside it with the new
  date-only sentence `fields.date.impossibleDay`, in all ten packs. The control's
  `aria-describedby` points at that sentence. Nothing is written until the user
  picks a new day, and picking a real day clears the marker. Real days and empty
  values render as before.
- 9fbbb17: BREAKING (`@object-ui/components`): `RefreshIndicator`'s `ariaLabel` prop is now required and has no default. It used to default to the English literal "Refreshing", so the progress bar on every view that passed no name was announced in English to screen-reader users in every locale (objectui#10580). A `RefreshIndicator` rendered without `ariaLabel` now fails to type-check.
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  Migration: pass the bar's accessible name from your own translation layer, for example `ariaLabel={t('grid.refreshing')}`. The component renders the string you pass as the bar's `aria-label` and does not translate it.
  
  `ObjectGrid`, `ListView`, `ObjectChart` and `ObjectDataTable` now name their refresh bar in the active locale. The grid and the list read the `grid.refreshing` and `list.refreshing` keys their pull-to-refresh text already uses. The chart reads `chart.refreshing` and the dashboard data table reads `dashboard.refreshing`, both with no English literal behind them, so a host that renders either one with no i18next instance at all gets the key itself as the bar's name.
  
  `@object-ui/i18n`: new keys `chart.refreshing` and `dashboard.refreshing` in every built-in locale pack.
- f905090: The console's record-count footer, drawn under the list when a record is open
  beside it in split navigation, now reads `1 record` at one record instead of
  `1 records` (objectui#10636).
  
  The footer rendered one key, `console.objectView.recordCount`, at every count.
  It now picks the new `console.objectView.recordCountOne` at exactly one record
  and `console.objectView.recordCount` at every other count, the same switch the
  list view's record-count bar uses. Every built-in pack words the pair the way it
  words the list bar's `list.recordCount` / `list.recordCountOne`, so the footer
  and the bar count the same records in the same words. In Japanese, Korean and
  Chinese, which have no separate singular, the two values are the same string.
  
  Russian and Arabic also read correctly at other counts now. The count-not-one
  value held one noun form: Russian read `2 записей` at two and `21 записей` at
  twenty-one, and Arabic used the singular noun at every count. Both now use the
  count label their list bar already uses, `Записей: N` and `عدد السجلات: N`,
  which is right at any number. At one record they read `1 запись` and `1 سجل`.
  
  ⚠️ **Dated note, 2026-10-02 — superseded in this release — objectui#11445.**
  Later in this same release the `console.objectView.recordCountOne` /
  `console.objectView.recordCount` switch gave way to a
  `console.objectView.recordCount` count family in all ten packs, worded like
  `list.recordCount`'s: the footer calls the family key with `{ count }`,
  `console.objectView.recordCountOne` left every pack, and `ru` and `ar` read a
  noun form at each count (`2 записи`, `3 سجلات`) where the count label stood. The rest of this entry is kept as the reading of this change.
- eb97ce6: fix(plugin-timeline,plugin-charts,i18n): a stored date-only day reads as that day in every viewer zone on the timeline, on a chart's date axis and in the published date helpers (objectui#10866, slice 2)
  
  These readers parsed a `YYYY-MM-DD` value with the engine's own `Date` parse, which reads it as UTC midnight, so every viewer west of UTC saw the day before. Each now reads the value through `toDisplayDate` from `@object-ui/core`, which rebuilds a date-only value at local midnight of the day it names. A value with a time part keeps its instant.
  
  - **Timeline.** The object timeline's date bucket, its sort and the item date the renderer prints read the value that way. West of UTC an item due today no longer sits under "Overdue", one due tomorrow no longer sits under "Today", and the `short` and `long` item faces print the stored day. The `iso` face prints a date-only value's day from local getters, and an instant's UTC day as before. A day its month does not have, such as `2026-02-30`, is no longer rolled into March: the item sits under "No date", sorts with the dateless items, and its `short` and `long` faces are the ones an unparsable value already had. An unparsable value now sorts with the dateless items too, and the `iso` face prints such a value as written where it used to throw. The gantt variant's axis headers, extent and bar positions are not changed here, so west of UTC its bar tooltip, which prints through the same item-date function, now names the stored day while the axis above it still reads the day before, until a later slice of objectui#10866.
  - **Charts.** A date-only category on the x axis reads `Sep 1` for `2026-09-01`, and `Sep 2026` on a month-grained axis, in every zone. When the display locale is a tag `Intl` refuses, the tick still prints the stored day: it reads the local-midnight value with local getters, because its `toISOString()` would name the day before east of UTC. An instant's fallback keeps its UTC day. A date-only category naming a day its month does not have falls back to the raw category, the face any other non-date category gets, instead of the rolled day.
  - **i18n helpers.** `formatDate`, `formatDateTime`, `formatRelativeTime` and `formatDateSpec` read a date-only string as the day it names: `formatDateTime` shows midnight of that day, and `formatRelativeTime` counts to the start of it. `formatDateSpec` applies its `timeZone` to an instant only, and formats a date-only value in the local zone, where the shared step's local midnight reads back as its day; a `timeZone` west of UTC no longer turns `2026-09-01` into August 31st for every viewer. All four return a day its month does not have as the raw string. `formatRelativeTime` now returns an unparsable value as its string, the face the other three already gave one, where it used to throw a `RangeError`.
- ac15833: fix(data-objectstack, plugin-dashboard): a dataset tile the viewer may not read shows a localized "no access" state (objectui#10899)
  
  When the analytics read admission refused a dashboard dataset query — `403`
  with ADR-0112 `PERMISSION_DENIED` — `queryDataset` had no branch for that code,
  so it threw the generic `Dataset query failed: 403 Forbidden — [Analytics]
  Access denied: …` string, and `DatasetWidget` printed it verbatim in a red
  alert. The list view over the same object already says 「无权访问」.
  
  - `queryDataset` now throws a typed `AnalyticsForbiddenError` for that code,
    carrying `httpStatus: 403` and `code: 'PERMISSION_DENIED'` (plus the server's
    code and message for diagnostics). A code-less 403 — no ObjectStack route
    wrote it — keeps the generic error.
  - `DatasetWidget` classifies a failed query with the shared `classifyLoadError`
    and, for `forbidden`, renders a localized no-access state
    (`dashboard.widgetForbiddenTitle` / `dashboard.widgetForbiddenMessage`, new in
    all ten packs) instead of the exception text. Every other failure keeps the
    detailed alert.
- ac15833: fix(app-shell, plugin-detail): a record comment whose write fails is never shown as sent (objectui#10899)
  
  The record page's discussion writers appended the new comment (or reply) to the
  panel first and then fired the `sys_comment` create, swallowing its rejection.
  On a tenant with no `sys_comment` the write answered 404 while the panel showed
  the comment and a bumped count, with no error — and the comment was gone after a
  reload.
  
  `RecordDetailView` now appends a comment or reply only after its write resolves.
  A failed write raises a localized error toast (`detail.commentFailed`, new in all
  ten packs) and rejects back to the composer. The composers — the activity
  timeline's comment box, the threaded reply input, and `RecordComments` — now
  treat a rejected `onAddComment` / `onAddReply` explicitly as "not written": they
  keep the draft for a retry instead of letting the rejection escape unhandled.
- e2dffc9: fix(app-shell): a failed reaction write takes the reaction back and says so, instead of staying shown as applied (objectui#10899)
  
  A reaction click on the record page's discussion shows at once and is stored in
  the background with a `sys_comment` update. That update was issued from inside
  the React state updater and its rejection was discarded, so a refused write
  left the reaction on screen as applied, with no message, until a reload. In a
  StrictMode development build the updater also ran twice, so one click sent two
  updates.
  
  `RecordDetailView` now computes the toggle and issues the write from the click
  handler, one write per click. When a write is refused, the row shows the newest
  reaction set a write stored or can still store, and a localized error toast
  (`detail.reactionFailed`, new in all ten packs) says the reaction was not
  saved. A refused click that a later click's write also carries is kept, because
  each write stores the row's whole reaction set. The stored
  `{ emoji: userIds[] }` shape is unchanged.
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
- 24d3e65: New SDUI widget `cloud:plan-status`: a "Current plan" badge for one plan card on the Cloud pricing page, shown when that card's plan is the organization's plan (objectui#10919).
  
  **Clause-②: yes** — the accept set of `AnyComponentSchema`, and so of `safeValidateSchema` and `objectui validate`, widens by one `type` literal, `cloud:plan-status`, and `@object-ui/types/zod` exports one new schema, `CloudPlanStatusSchema`. Nothing that parsed before is refused now.
  
  **Why.** The pricing page is static metadata, and nothing in a page's expression scope carries the organization's plan, so the page could not tell which of its cards the organization is already on. The plan is available only from the org-scoped `GET /cloud/environment-entitlements` summary.
  
  **What changed, in observable terms.**
  
  - `@object-ui/app-shell` registers `cloud:plan-status`. A page places one node on each plan card and names that card's plan code in `properties.plan`: `{ "type": "cloud:plan-status", "properties": { "plan": "free" } }`. The widget reads the summary through the hook the environment list already uses, and renders the badge when the summary's `plan` equals `properties.plan`. The comparison is exact, so `Free` does not match `free`.
  - The widget renders nothing on every other card, while the summary loads, when the request fails, and when the body is not the `{ success, data }` envelope. It never guesses a plan.
  - The node's `className` and `responsiveStyles` reach the badge. Each node reads the summary itself, so a page with three cards makes three requests.
  - The widget is registered under one key, `cloud:plan-status`. There is no bare `plan-status` fallback and no `app-shell:`-prefixed twin.
  - `@object-ui/types/zod` exports `CloudPlanStatusSchema`, a member of `AnyComponentSchema`. `properties` is required and must be exactly `{ plan }`, with `plan` a non-empty string. A missing bag, a missing or empty `plan`, and any other key in the bag are each refused at that path.
  - `body` and `children` are refused by name on this node, because the widget reads neither.
  - `plan` is not an enum: the plan catalog belongs to the control plane, and ObjectUI does not list its codes.
  - `@object-ui/i18n` adds `cloudPlanStatus.current` ("Current plan") to all ten locale packs.
  - `@object-ui/cli`: `objectui check` knows `cloud:plan-status` as a registered type.
- 4b742f4: fix(components): an `element:number` that asks for an aggregate and names no object says so instead of painting a silent dash
  
  Since `element:number` accepts its object from the node-level `dataSource`
  binding (objectui#10909), `object` is no longer a required input, and the
  manifest has no way to say "one of `object` and `dataSource.object`". A node
  that authors an `aggregate` with neither therefore passes the html tier with no
  diagnostic, and the renderer used to paint "—", which reads like a real empty
  value.
  
  The renderer now draws a short muted notice in that case: "No object named: set
  object or dataSource.object." It is renderer chrome, so it reads the locale
  packs (`element.number.noObject`, added to all ten packs) and speaks the session
  language. It does not throw and it queries nothing.
  
  Only authored absence draws it. A binding that names an object keeps its own
  panels while its `view` is resolving or after it failed to resolve, and a node
  with no `aggregate` still paints the dash exactly as before.
- 6cd8f66: The console strings objectui#10900 left English under zh-CN now read the session's language (objectui#10969).
  
  - **The action runner's other own text.** `ActionRunner` asks the translator installed through `setTranslator` (objectui#10900) for three more strings it writes itself: the error toast when the error that reached it carries no readable message (`actions.failed`), a parallel chain's error when no failed action reported one (`actions.parallelFailed`), and the label of an undoable success toast's Undo button (`actions.undo`). An author's `errorMessage` / `successMessage` and an action's own error stay untranslated. With no translator the text stays English.
  - **The Undo label now arrives from the runner.** For an undoable result the runner hands the toast handler `undo: { label }` where it used to hand `undo: {}`; `ToastHandler`'s type is unchanged (`label` was already optional). A handler that renders `options.undo.label` shows the translated label; one that ignores it keeps its own.
  - **The console app's `system/*` breadcrumbs.** In `AppHeader`, the segment after `System` for `settings`, `apps`, `profile`, `approvals`, `ai-approvals` and `audit-log` reads `console.breadcrumb.*` (as `marketplace` has since objectui#10900). In English, `ai-approvals` now reads `AI Approvals` instead of the humanized slug `Ai Approvals`; the other five read as before. A segment the header does not know keeps its humanized slug.
  - **The Build Doctor drawer's body.** Its description, loading and not-found states, summary line, verdict, and each section's title and hint read `console.ai.buildDoctorDrawer.*`. The report's own data (tool, artifact and status names, timeline text) stays verbatim.
  - **"manifest ID" leaves the marketplace search placeholder in every pack.** `en` now reads `Search apps by name or app ID…`, and the eight packs that translated the jargon literally follow. zh already read 「按名称或标识搜索应用…」 and is unchanged.
  
  The new keys are in all ten packs.
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
- 2eaf5be: `WizardForm`'s own chrome now reads the locale packs (objectui#10999). The
  default Cancel, Back, Next, Submitting, Create and Update labels, the
  "Step x of y" counter, the step indicator's label for a step that declares no
  `label`, the indicator's accessible name, and the notice on a step with no
  fields were English literals, so a wizard in a zh session showed `Cancel`,
  `Step 1 of 3` and `Next` beside a Chinese UI. They now resolve through the
  wizard's existing `createSafeTranslation` hook, the way the rest of
  plugin-form's chrome does.
  
  An authored `cancelText`, `prevText`, `nextText` or `submitText` still renders
  exactly as authored, in every locale: only the defaults are localized, and the
  four keys stay plain strings.
  
  Five of the strings reuse keys the packs already carried: `common.cancel`,
  `common.next`, `form.create`, `form.update`, and `form.stepOf`, a key that
  `pnpm check:i18n-dead-keys` listed as read by nothing until now. Five are new
  under `wizard.` in all ten packs: `back`, `submitting`, `stepFallback`,
  `progressLabel` and `emptyStep`. The wizard gets its own `back` rather than
  `common.back` because zh words a wizard's step back ("previous step", the term
  `grid.import.back` and `grid.bulk.back` already use) differently from a page's
  back ("return").
  
  The zh value of `form.stepOf` gains the spaces around its numbers that the zh
  pack's other position counters, such as `table.pageInfo` and
  `detail.recordOf`, already carry.
  
  **One rendered English string changes**: the final button's in-flight label was
  typed with three ASCII full stops and is now `Submitting…` with the typographic
  ellipsis, because it is a pack value now and `ellipsis-glyph-3878.test.ts`
  holds every pack value to U+2026. Every other English default renders the same
  text as before.
- bf7ab35: A record form whose fields are all locked because the user may not create (or
  edit) records of its object now says so (objectui#11000). The ADR-0092 D4 lock
  disables every field when the object's affordance for the form's mode is
  closed: the object's `managedBy` bucket keeps it closed, or the server's
  effective API operation set for the user lacks `create` (or `update` on an edit
  form). Until now nothing on the form said why, and a wizard's Next stayed
  enabled.
  
  - Every form layout that draws the lock (the default form, `drawer`, `modal`,
    `tabbed`, `split` and `wizard`) renders one notice above the fields, such as
    "You don't have permission to create Project records. The fields are
    read-only." It names the object by its label, translated when the app's
    locale bundle translates it, and names `create` on a create form or `edit` on
    an edit form. It is announced as a status (`role="status"`).
  - The notice reads the same verdict the lock does, so it appears exactly when
    every field is locked for that reason. A field locked on its own (one the
    user may read but not edit, or one declared `readonly`) shows no notice.
  - A wizard does not walk a user who cannot submit through its steps: while the
    lock holds, Next and the final submit button are disabled, and the step
    indicator does not jump forward even with `allowSkip`. Cancel and Back stay
    usable, and every step is still shown. A user whose affordance is open sees
    no change.
  - Two keys are new in the `form` namespace of all ten packs:
    `noPermissionToCreate` and `noPermissionToEdit`, each with an `{{object}}`
    placeholder.
  
  The lock itself is unchanged, and so is the Save button of the non-wizard
  layouts.
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
- 8732846: The console's undo confirmation toast reads the session's language (objectui#11056).
  
  - **The toast after Undo.** Pressing the Undo button on an undoable success toast used to raise a hard-coded English "Change undone", even where the button itself was already translated (objectui#10969). Both console undo handlers, in `useConsoleActionRuntime` and in `RecordDetailView`, now read the new `actions.undone` key through the translator each already holds. Under zh-CN the toast reads 「已撤销更改」.
  - **English is unchanged.** The `en` value is `Change undone`, the same text as before.
  - **The new key is in all ten packs.** de, es, fr, ja, ko, pt and ru word it as their own `navigationSync.undone` without the word for navigation; ar does the same and gives the noun its article. zh reads 「已撤销更改」, with the 撤销 of `actions.undo` and the 更改 of the pack's 「保存更改」.
  
  `AppContent`'s own Ctrl+Z handler, which toasts `Undo: ` or `Redo: ` followed by the operation's description, is not changed here.
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
- 1d6a23d: The console's global Undo and Redo toasts read the session's language (objectui#11080).
  
  - **The Ctrl+Z / Ctrl+Shift+Z toasts.** `AppContent`'s `useGlobalUndo` handlers used to raise `Undo: ` or `Redo: ` in English before the operation's description, under every language. They now read two new keys, `actions.undoneOperation` and `actions.redoneOperation`, through the translator `AppContent` already holds. The operation's description is interpolated unchanged, so the pack owns the words and their order. Under zh-CN the toasts read 「撤销：…」 and 「重做：…」.
  - **English is unchanged.** The `en` values are `Undo: {{description}}` and `Redo: {{description}}`, the same text as before.
  - **The new keys are in all ten packs.** Each pack words them with its own `actions.undo` and its own word for Redo, followed by its usual colon: full-width in zh, and a space before the colon in fr.
  
  The description of an operation whose action declared no `label` is still built in English by its producer. That half of objectui#11080 is not changed here.
- cff8641: The dashboard's refresh button now speaks the session language (objectui#11097). `DashboardRenderer` and `DashboardGridLayout` hard-coded "Refresh All", "Refreshing…" and the accessible name "Refresh dashboard", so a zh-CN session read English on the button that every console dashboard shows since the console began wiring `onRefresh`. Both components now read the pack keys `dashboard.refreshAll`, `dashboard.refreshDashboard` and the existing `dashboard.refreshing`. The English wording is unchanged.
  
  `@object-ui/i18n`: new keys `dashboard.refreshAll` and `dashboard.refreshDashboard` in every built-in locale pack.
- 385ebc5: fix(plugin-form,fields,i18n): the record page's line-items panel and the line-items grid speak the user's language
  
  Under a Chinese session the record page's `record:line_items` panel still
  rendered some of its chrome in English. Its default title read `Line Items` and
  its button read `Save` / `Saving…`. The line-items grid (`GridField`) read
  `Add line` on its Add button, `No items yet — click “Add” to begin.` in list
  mode, and `No items` when read-only.
  
  They now read the locale packs. The button reuses `common.save` and
  `detail.saving`, and the empty text names `detail.add`. Four new keys are added
  to all ten packs: `form.lineItems.title`, `fields.grid.addLine`,
  `fields.grid.noItems` and `fields.grid.noItemsAddHint`.
  
  Only the defaults move. An authored `title` or `add_label` still wins, and an
  authored `add_label` is also the label the empty text names. English output is
  byte-identical to the literals these replace, with or without an i18n provider.
- a8c5509: fix(plugin-form,fields,i18n): the line-items panel, the grid field and the master-detail heading finish speaking the user's language
  
  Under a Chinese session the rest of the line-items chrome still rendered in
  English. The record page's `record:line_items` panel read `Loading…`, `Save the
  record first to add line items.`, `This record’s line items have not been
  loaded.`, the `Failed to load line items` / `Failed to save line items`
  fallbacks and its no-`childObject` hint. The line-items grid (`GridField`) read
  its footer `Total`, its column chooser's `Columns` / `Optional columns`, the
  computed cell's `Computed` tooltip and its row actions. A master-detail
  collection with no `title` was headed `Line Items`.
  
  They now read the locale packs. Reused keys: `common.loading`, `table.columns`,
  `form.masterDetail.total` (the footer), `view.dragToReorder` (the drag handle)
  and `form.lineItems.title` (the master-detail heading). New keys, in all ten
  packs: `form.lineItems.saveRecordFirst`, `form.lineItems.notLoaded`,
  `form.lineItems.loadFailed`, `form.lineItems.saveFailed`,
  `form.lineItems.noChildObject`, `fields.grid.optionalColumns`,
  `fields.grid.computed`, `fields.grid.openRow`, `fields.grid.duplicateRow` and
  `fields.grid.removeRow`.
  
  Each row action now has one key, read by both its `aria-label` and its `title`.
  The English kept for each is the accessible name it already had:
  
  - open the row in the full form: `Open row` (the tooltip was `Open full form`);
  - duplicate the row: `Duplicate row` (the tooltip was `Duplicate line`);
  - remove the row: `Remove row` (no tooltip, as before);
  - the drag handle: `Drag to reorder`.
  
  Only the defaults move. An authored collection `title` still wins, and so does
  a failure message the server sent. Apart from the two tooltips above, English
  output is byte-identical to the literals these replace, with or without an i18n
  provider.
- c2a8d23: fix(fields,plugin-form,i18n): the line-items grid's required-cell text and the master-detail form's config hints read the locale packs
  
  Under a Chinese session two parts of the line-items family still rendered in
  English. The line-items grid (`GridField`) named a required, empty cell as the
  column label followed by ` is required`. That text is the plain cell's tooltip
  and the `error` the lookup and file cells take. A master-detail collection that
  could not be resolved showed one of three English configuration hints: no
  `childObject`, a child schema that failed to load, or no lookup or
  master_detail field linking the child to the parent.
  
  They now read the locale packs. The grid cells reuse `validation.required`
  (`{{field}} is required`), with the column label in `{{field}}`: the sentence
  the form renderer already shows for a required field. The three hints read
  new keys in all ten packs: `form.masterDetail.noChildObject`,
  `form.masterDetail.schemaUnavailable` and
  `form.masterDetail.noRelationshipField`. Property names (`childObject`,
  `relationshipField`) and object names stay code elements and are never
  translated.
  
  English output is byte-identical to the literals these replace, with or
  without an i18n provider.
- 1263e40: fix(app-shell,plugin-detail): the record feed says "no permission" when its read is refused, instead of showing an empty list
  
  This widens two published surfaces: `@object-ui/plugin-detail` gains the export `isRefusedFeedRead`, and `@object-ui/react`'s `DiscussionContextValue` gains the optional members `activityDenied` and `commentsDenied` (as do `RecordActivityTimelineProps` and `RecordChatterPanelProps`).
  
  When the server refused a record's activity read (401, 403, or a permission
  envelope), the record page's discussion panel and the `record:activity` block
  rendered the empty state: "No comments yet" or "No activity recorded". A member
  who was not allowed to see the activity could not tell that apart from a record
  with no history. Every failed feed read ended in a catch that treated it as an
  empty answer.
  
  Each feed read now keeps its verdict. A refused read shows a localized
  no-permission state in place of the empty state: a lock and "You don't have
  permission to view activity on this record." When the other read did answer, its
  rows stay on screen and the notice above them names the half that was withheld.
  A refused `sys_comment` read shows "You don't have permission to view comments on
  this record." in the same way.
  
  - **What counts as refused** is one verdict, `isRefusedFeedRead`, exported from
    `@object-ui/plugin-detail`. Both surfaces use it. It is the `forbidden` and
    `unauthorized` kinds of the existing `classifyLoadError` read classifier, and
    it reads no status of its own.
  - **Unchanged:** a read that answers with zero rows, a 404 (`sys_activity` on a
    deployment without the audit plugin), and any other failure such as a 500 keep
    the empty state. The panel has no error state of its own.
  - **Not retried:** a refusal is recorded and shown; the read is not re-issued.
  - `DiscussionContext` (`@object-ui/react`) gains two optional members,
    `activityDenied` and `commentsDenied`, which the host that owns the fetch
    sets. `RecordActivityTimeline` and `RecordChatterPanel` take the same two
    optional props.
  - Two new `detail.*` strings, `activityAccessDenied` and `commentsAccessDenied`,
    are translated in all ten locale packs.
- 9419df1: fix(app-shell): the save warning has a sentence of its own for a formula field the server ignored
  
  objectstack `b2805465` gave the write path a fourth strip reason, `computed`: a
  value the caller sends for a `formula` field is stripped on every write path,
  because the server computes that field and has nowhere to store it. The save
  warning now words that reason as what it is — "Calculated by the server from a
  formula, so the value sent did not take effect: …" — through a new
  `detail.writeStrippedComputed` key in all ten locale packs, and never as a
  read-only lock, which would send the user after a permission problem that does
  not exist.
  
  The reason table stays exhaustive over the spec's union, and one spelling now
  compiles against both the published `@objectstack/spec` 17.5.0 (which does not
  name the arm) and objectstack `main` (which does), which is what the
  `Spec Main Shape Gate` needs to go green again.
  
  When the sentence reaches a user: the adapter judges a reported reason against
  the spec release this bundle is built with, and 17.5.0 does not declare
  `computed`, so until that release carries it a formula strip from a newer server
  is still reported as "Not applied by the server: …" — truthful, but without the
  cause. The new sentence is used from the spec release that declares the arm on.
- 55d18c6: fix(i18n): every count plural family carries every plural form its language uses (objectui#11432)
  
  The 14 i18next count plural families (`console.ai.usage.resetsWeeklyHours`,
  `detail.fileCount`, `perm.facet.objects` and the rest) held `_one`, sometimes
  `_other`, and a base key. i18next asks `Intl.PluralRules` for the one suffix a number
  needs, and where a pack lacked that slot the base key answered with its single
  string. So `ru` read "Сброс через 3 часов" on the AI usage indicator where Russian
  needs "часа", and `ar` served 0, 2, 3-10 and 11-99 from one "singular(plural)"
  marker.
  
  Every pack now spells out every CLDR category its language selects: `_other` where
  the base stood in for it, `ru` `_few`/`_many`, `ar` `_zero`/`_two`/`_few`/`_many`,
  and `fr`/`es`/`pt` `_many` (exact millions, "1000000 de fichiers"). Existing slots
  whose form was wrong for their own category are corrected: `ar` `_other` (100-102…)
  now holds the singular, `ru` `_other` (fractions) the genitive singular, and the four
  `ru` `perm.facet.*` `_one` forms agree with the numeral like the new slots. English
  and the `de`/`zh`/`ja`/`ko` strings a user sees do not change.
  
  `all-locales-key-parity.test.ts` now computes each family's required slots from
  `Intl.PluralRules` per pack, so a new family or a new pack that misses a category
  fails at PR time, and the parity rule admits a key `en` lacks only when it is such a
  slot.
- c4ab6d0: The ten locale packs drop `appDesigner.fieldDesigner.validationRules` ("Validation Rules") and `appDesigner.fieldDesigner.addRule` ("Add Rule") (objectui#11434).
  
  Both labelled an editor for `DesignerFieldDefinition.validationRules` that was never built: no component asked for either key, and `@object-ui/types` retires that member on both faces in this release. A host that looked either key up itself now gets the key back instead of a label; author its own label if it needs one.
- 6158e4c: objectui now resolves `@objectstack/*` 17.6.0 (objectui#11438). One declared range moves: `@object-ui/types` raises its `@objectstack/spec` floor to `^17.6.0` in objectui#11227's own changeset, because its published types read `EmptyState` / `EmptyStateSchema`, which 17.5.0 does not export. Every other `@objectstack/*` range already admits 17.6.0 and stays as it was, and `check:spec-floors` names no other floor that has to rise. Everything below is a contract move 17.6.0 made, and it already reaches any consumer that resolves `@objectstack/spec ^17.6`.
  
  - `@object-ui/components`: the `page:header` registration no longer publishes a `breadcrumb` input. 17.6.0 retires the key (objectstack#20758) and refuses it by name; the renderer has ignored it since objectui#11166.
  - `@object-ui/i18n`: a served translation document is recognised as a spec payload when it carries only the `picklists` group, which 17.6.0's `GetTranslationsResponseSchema` adds. Such a bundle used to be returned untransformed, so nothing read it. The group is now namespaced under `app` like every other group.
  - `@object-ui/console`: the bundle inlines the 17.6.0 packages, so its client-side validation answers as a 17.6.0 server does. The first screen is smaller: 17.6.0's spec root no longer carries the migration chain, so the eager closure is 250,096 gzipped bytes lighter (measured against a `main` build), and the bundle budget comes down by that amount.
- 4a1adb7: Count labels read the right noun form in every language at every count: each label a word must agree with is now an i18next count family in all ten packs (objectui#11445).
  
  **What was wrong.** objectui#11432 gave every count family every CLDR category its language selects. Two other spellings of the same defect sat outside that rule. Fifteen labels were code-selected pairs (`detail.attachmentCount` / `detail.attachmentCountPlural`, `common.itemCount` / `common.itemCountOne`, and thirteen more): the component chose between two keys on `=== 1`, which gives a language two forms, so Russian read `3 вложений` and Arabic `2 مرفقات`. Fifty-three labels were one string at every count, so Russian read `Согласовать 3 запросов?`, Arabic `منذ 5 دقيقة`, Spanish `1 seleccionados` and English `3 row modified`.
  
  **What changes.** Each of those 68 keys is a family: `en` `_one` / `_other`, `ru` `_one` / `_few` / `_many` / `_other`, `ar` all six categories, and each other pack the categories its language selects. The base key keeps its value and answers a call made without a count.
  
  **Removed keys.** The fifteen code-selected siblings leave all ten packs: `lookup.recordCountOne`, `common.itemCountOne`, `list.recordCountOne`, `detail.reactionCountOne`, `detail.attachmentCountPlural`, `detail.replyCountPlural`, `console.objectView.recordCountOne`, `search.resultsCountPlural`, `search.itemsAvailableOne`, `ai.formAssist.suggestionCountOne`, `ai.formAssist.appliedCountOne`, `collaboration.commentCountOne`, `collaboration.reactionCountOne`, `collaboration.presentUserCountOne` and `collaboration.moreUserCountOne`. A host that looked one up itself now gets the key back instead of a label: call the family key with `{ count }` instead (`t('detail.replyCount', { count: n })`), and i18next picks the form.
  
  **Provider-less fallback.** `createSafeTranslation` now reads a count family's `_one` / `_other` row for a numeric `count` before the base row, in the order i18next reads the `en` pack, so a host with no `I18nProvider` keeps rendering "1 reply" / "3 replies". A string `count` still reads the base row, as it does in i18next.
  
  **Supersedes, in this release.** The notes for objectui#9664, objectui#10024, objectui#10242, objectui#10425 and objectui#10636 describe the `…One` / `…Plural` switch these families replace; each now carries a dated note saying so. Their `ru` / `ar` count labels (`Записей: N`, `عدد السجلات: N`) stay only on the base key, which answers a call made without a count.
  
  **Pinned.** `count-families-11445.test.ts` fails on any `…Plural` key in a pack and on any `{{count}}` value outside a family unless its count-neutral list names the key with the reason no word agrees with the number.
- d0097af: The console's Create View dialog now creates chart views the platform accepts (objectui#11576).
  
  The dialog wrote a chart view as `chart: { chartType, xAxisField, yAxisFields }`, the inline
  axes `@objectstack/spec` retired under ADR-0021. The spec's list chart block refuses those two
  keys by name and requires `dataset` and `values`, so the platform's view write door refused
  every chart view created from the console, from both "Save as view" and the view tab bar's
  add button. The dialog had already closed, so the user saw nothing happen.
  
  The chart type now binds a semantic-layer dataset instead:
  
  - the dialog offers the ADR-0021 datasets whose base `object` is the view's own object, and
    only those;
  - it then offers the chosen dataset's measures (`values`) and, when the dataset declares any,
    its dimensions (`dimensions`, optional);
  - an object that exposes no dataset shows the chart type as unavailable, with its own reason.
  
  The payload is `chart: { chartType, dataset, values, dimensions? }`, with no second spelling.
  The dataset catalog reader the dashboard and report editors use now also carries each dataset's
  base `object`.
  
  In `@object-ui/i18n`, the four `console.objectView` axis labels (`xAxisField`, `xAxisFieldHelp`,
  `yAxisField`, `yAxisFieldHelp`) leave all ten packs, and eight keys label the dataset, measure
  and dimension picks (`dataset`, `datasetHelp`, `chartMeasure`, `chartMeasureHelp`,
  `chartDimension`, `chartDimensionHelp`, `viewTypeUnavailableDataset`, `noDatasetMeasure`).
- 432882b: The marketplace consent panel no longer promises confinement the runtime does not provide.
  
  `PluginDisclosure` introduced a code-bearing package's structured permission set with "On install, this package will be granted:". A list of grants on a security panel is read as a confinement promise — the complement assumed denied — and on this platform it is not. The consented set is persisted (`sys_package_installation.granted_permissions`), re-confirmed on a widening upgrade, and registered on the runtime's `PluginPermissionEnforcer` at load; it is queried by nothing, because `SecurePluginContext` has zero production construction sites and the fs/network gates have no caller at all (measured on objectstack `9bd4344e4`; recorded upstream in objectstack `aaacf1d5c`).
  
  `marketplace.disclosure.grantsIntro` now states a REQUEST — "This package requests:" — and a new `marketplace.disclosure.notEnforced` line beside the list says the set is recorded at install, re-confirmed if a later version asks for more, and not yet a runtime restriction. Both land in all ten locale packs; the `ja` value stays predicate-final so that pack's halfwidth-colon rule still decides it.
  
  The trust-tier badge is deliberately untouched: it is the trust-tier half of the same panel, which objectstack `a9ee98992` settled separately.
- b06e374: The Spanish pack renders `Done` as `Listo` at every one of the four sites that say it
  (objectui#3880, triage adjudication 2026-08-09). `grid.bulk.done` — the footer button that
  dismisses the bulk-action result dialog — read `Hecho` while `common.done`, `view.done` and
  `form.fullscreen.done` all read `Listo`, so the same English word rendered two ways in
  Spanish across dialogs a user meets in one session.
  
  Adjudicated a typo rather than a deliberate contextual split, on three checks. All four
  keys hold the byte-identical `en` value `Done`, and all four call sites are the same
  control: a dialog-footer button whose click finishes or dismisses the surface
  (`BulkActionDialog` `onClose(result)`, `ManageViewsDialog` `onOpenChange(false)`,
  `fullscreen-editor` `commitFullscreen`, `InviteMemberDialog`'s invitation-created footer).
  The nine other packs each render all four identically (de `Fertig`, fr `Terminé`, pt
  `Concluído`, ru `Готово`, ja `完了`, ko `완료`, zh `完成`, ar `تم`), so no other translation
  pass had found a context worth splitting on. And the neighbouring `Hecho`/`Deshecho`
  pairing that could have justified it does not hold: `grid.bulk.undo` is the verb `Deshacer`,
  and `Deshecho: ` is `undonePrefix`, a result-line status rather than a button.
  
  `Hecho` moved to the 3:1 majority `Listo`, which is the value objectui#3546 slice seven had
  already chosen for `common.done`. `packages/i18n/src/__tests__/residue-namespaces-3546.test.tsx`
  pinned the old outlier as a recorded example of deliberate divergence; that pin now asserts
  the four as one value instead, and its note keeps the history plus the `Pending`/zh row,
  which remains a genuine deliberate split.
  
  No `en` value changes, so no other pack is asked to follow. This is the value half of
  objectui#3880 only — the card's 281/164 shared-string census stays on the card as
  documentation, and is explicitly not a gate: 164 of those groups diverge legitimately.
- 978507b: **Behaviour change:** an action whose own declared `visible` gate hides it is no
  longer run by `autoTrigger`, and the refusal is reported instead of swallowed
  (objectui#4191).
  
  Before, `action:button` registered its auto-trigger effect above its `visible`
  early return, so an action carrying both `autoTrigger: true` and a `visible`
  that evaluated false rendered nothing and executed anyway; `action:menu` did the
  same for overflow actions, deliberately, to stay in step. The declared nav deep
  link made that reachable from a URL: `ObjectView` armed the requested action
  after checking only its placement, so any list-page link naming an action its
  author had hidden there ran it.
  
  The author's verdict now outranks the transport flag:
  
  - `action:button` and `action:menu` refuse the auto-trigger of an action their
    own `visible` gate hides. Both go through the one shared hook, so which
    renderer received the action (decided by `action:bar`'s `maxVisible`, and so by
    the viewport) cannot change the outcome. The refusal shows a warning toast
    naming the action, from the new `actions.notAvailableHere` key (all ten locale
    packs), and writes a console diagnostic in development builds. An action whose
    predicate becomes true later in the same mount still runs, once.
  - The deep-link preparation step on the object list evaluates the same
    predicate before it marks the action `autoTrigger`. A hidden action is not
    armed and the deep-link parameter stays in the URL, so the one-shot intent is
    not spent on nothing, and the same notice is shown.
  
  This was never an authorization boundary: confirm dialogs, parameter
  collection, entitlement checks and server-side permissions apply on every
  execute path, before and after this change. What the gate now protects is the
  author's rule about where an action may be offered.
- 594704f: The `console.objectView.*` config-panel vocabulary is retired — 116 keys removed from each
  of the ten packs, 1160 translated strings that nothing read (objectui#4730, maintainer
  ruling 2026-08-19).
  
  The namespace held 209 keys per pack. 116 of them labelled a view-configuration settings
  panel that does not exist: appearance and density toggles, accessibility attributes,
  conditional-formatting rules, row-action and inline-edit switches, quick-filter builders,
  an advanced-settings tier. `packages/app-shell/src/views/ViewConfigPanel.tsx` — the panel
  they were written for — was migrated off the legacy `buildViewConfigSchema` engine onto
  `ViewVariantInspector`, a spec-driven inspector whose field labels come from
  `@objectstack/spec` metadata rather than from this namespace. The panel was replaced; the
  keys were not cleaned up with it.
  
  Removed under objectui#4658's three-legged evidence standard, re-measured on this branch's
  merge base rather than inherited from the card: zero `t()`/`tt()` call sites, zero textual
  occurrence of the dotted key anywhere in the repo outside the packs that define it, and a
  consumer spot-check confirming no i18n wiring. The 93 live keys stay — the create-view
  dialog fields, the view-type catalogue, `new`/`save`/`cancel`, the object-not-found copy,
  plus the 38 keys whose spelling still appears somewhere the AST pass cannot see, which are
  out of scope here.
  
  Four of the retired keys name `ListViewSchema` properties that are still active —
  `rowActions`, `inlineEdit`, `hiddenFields`, `filterableFields`. They are retired anyway, by
  the ruling's own words: a live schema property is not a consumer of a locale string; only a
  labelled UI control is. If such a panel is ever specified, its keys are re-authored
  alongside it.
  
  `packages/i18n/src/__tests__/objectView-config-keys-retired-4730.test.ts` pins the removal
  by name. Every i18n gate in this repo runs call site → key, so none of them can see a dead
  key come back: the parity gate is fully satisfied by 116 dead keys present in all ten packs,
  and the reverse sweep that found them (`scripts/check-i18n-dead-keys.mjs`) is report-only by
  design. The pin is the only thing that would notice.
- 41b7ce3: **View configuration is explicitly org-wide, and its write path is now gated (objectstack#7494's
  ruling, maintainer 2026-08-12).** The `sort` / `hiddenFields` / `columnState` / `rowHeight` that a
  list toolbar persists were never per-user: they are one shared row on the view, so an ordinary user
  dragging a column or cycling density was re-styling that view for the entire organization. Nothing
  in the console said so, and nothing stopped it. A per-user scope stays parked (objectstack#7611,
  v18) and is deliberately not built here — which is precisely why the write has to be gated rather
  than narrowed: there is no second, private store for it to fall back to.
  
  `ObjectStackAdapter.updateViewConfig` now refuses when the session's **reported** ADR-0066 capability
  set does not contain `manage_metadata`, throwing the new `ViewConfigPermissionDeniedError`
  (`VIEW_CONFIG_PERMISSION_DENIED`, with `isViewConfigPermissionDeniedError` and the
  `VIEW_CONFIG_CAPABILITY` constant alongside it). The gate is the **first** statement in the method —
  before `connect()`, before the payload is assembled — so a refused call puts nothing on the wire.
  It is on the write rather than on the toolbar button on purpose: withholding the affordance would
  leave the method still accepting the call from anything else holding the adapter, whereas a gate on
  the write is inherited by every caller, present and future.
  
  `manage_metadata` is not a newly minted name. It is the capability this repo already treats as
  metadata-authoring authority — `HomePage`'s `AUTHORING_CAPABILITY`, the one the server itself
  refuses metadata writes without — and the gated write goes through `client.meta.saveItem`, the very
  same ADR-0005 metadata door, so this applies the authority the server is already applying instead of
  inventing a parallel one.
  
  **Unknown fails open, by doctrine.** A capability set that was never reported (a backend predating
  ADR-0066, or no permission provider mounted) is not a denial: the server enforces regardless, so a
  client-side refusal on missing data cannot protect anything and can only break a permitted user. A
  *reported* empty grant gates strictly. Hosts push the session's capabilities in with the new
  `setSystemCapabilities`; `ObjectView` wires it from `usePermissions()`.
  
  The refusal is also **said out loud**. `ObjectView`'s persist path previously swallowed every failure
  into `console.error`, which for a debounced toggle whose UI has already moved would have left the
  operator looking at a density they did not get; a denied write now raises a toast. And the "View
  settings" popover — where density and field visibility are actually changed — now states the scope
  before the operator acts: *"Grouping, color, density, and visible fields. Applies to everyone who
  uses this view."*, translated in all ten packs.
- 95f8704: `record:path` now announces each stage's state, not just its label (WCAG 2.2 SC 1.4.1)
  
  The lifecycle path distinguished travelled, upcoming and lost-terminal stages with
  colour plus a `✓`/`✗` glyph, and both glyphs are `aria-hidden` decoration.
  `aria-current="step"` marked the current stage and nothing else, so a screen-reader
  user heard a run of identically-announced items — and a rejected stage announced
  exactly like an ordinary stage the record had not reached yet.
  
  Each stage now carries an accessible name composing its (already picklist-localized)
  label with its state, from five new `detail.pathStage*` keys translated in all ten
  locale packs. The glyphs stay decorative and the readout's `role="listitem"` /
  `aria-current` semantics are unchanged.
  
  The name is composed into `aria-label` rather than visually-hidden text because
  `listitem` takes its name from the author only: text placed inside a stage computes
  to an empty accessible name, so the visually-hidden shape would have looked right in
  the markup and delivered nothing to the accessibility tree.
- 8d3a529: `record:path` finishes localizing and de-colouring its accessible names — the two residues
  objectui#5916 named and deliberately left behind (objectui#5956, objectui#5957).
  
  **The list's own label was English on a localized surface, and the other one named nothing.**
  Both the desktop and the mobile `role="list"` row did
  `aria-label={schema.aria?.label || 'Record path'}`, so a zh/ja/ar session heard `Record path`
  for the list while every stage inside it announced in the session locale — one control
  speaking two languages at once. The fallback is now `detail.pathLabel`, translated in all ten
  packs; the `schema.aria.label` author override still wins ahead of it.
  
  The lost-terminal alt group was a different defect wearing the same clothes: its
  `aria-label="Alternative terminal stages"` sat on a bare `div`, which has the `generic` role,
  and browsers expose no accessible name on a generic element. That string reached nobody —
  inert, not merely untranslated — so translating it would have shipped copy to ten packs that
  no user can hear. It is removed rather than given a role that takes a name, on three
  measurements: nothing is lost (it was never announced), it would be redundant (every stage
  inside already announces `closed lost` in the session locale after objectui#5916, in the one
  place `role="list"` can carry it), and it would fork the two rows (the mobile row renders one
  flat list with no alt group, so a named group would make one control expose two structures by
  viewport).
  
  **An unreached goal terminus was distinguished by hue alone.** `railClass` paints it
  `bg-emerald-500/30` where a plain upcoming stage gets `bg-muted` — the renderer's own note
  calls this "a faint emerald so the goal is legible" — while both announced the identical
  `{{stage}}, upcoming`. Two stages ahead of the record painted differently and read the same:
  the WCAG 2.2 SC 1.4.1 class objectui#5916 closed, on the one distinction it left behind, and
  reachable without authors opting in because `classify()` finds `won` through the `WON_TOKENS`
  heuristic as well as an explicit `terminal: 'won'`. New key `detail.pathStageWonUpcoming`
  (`{{stage}}, goal stage, not reached`), translated in all ten packs.
  
  Scoped to the UNREACHED goal, which is a measurement of the stylesheet rather than a
  preference: a reached goal terminus paints `bg-primary` when current and `bg-emerald-500` when
  completed, byte-identical to any other current or completed stage. Naming it apart would hand
  a screen reader a distinction the screen does not make — the mirror image of the defect — so
  it is one new key, not a pair, and a test pins that decision so it cannot drift into a fourth
  state unnoticed.
  
  Both new keys also land in `DETAIL_DEFAULT_TRANSLATIONS`, which
  `defaults-maps-mirror-en-pack` compares against the `en` pack key by key, so neither can fork
  between a provider-mounted console and a provider-less embed. No existing `en` value changes,
  so no pack is asked to follow an edit.
- 5ac2e2c: The merged `Loading…` group now reads one way per language (objectui#5972).
  
  objectui#3878 converged every pack on the typographic ellipsis, and in doing so **merged**
  the ASCII `Loading...` group into the U+2026 `Loading…` group. Nobody re-measured the
  wording afterwards. Re-derived on today's tree by flattening all ten packs and comparing
  exact values, the group is 10 keys — `lookup.loading`, `common.loading`,
  `fields.recipient.loading`, `grid.import.historyLoading`, `grid.bulk.loading`,
  `detail.loading`, `report.loading`, `dashboard.loading`, `auth.device.loading`,
  `approvalsInbox.loadingMore` — and `de` rendered them four ways, `ko` two and `ar` two,
  while en/zh/ja/fr/es/pt/ru were already unanimous.
  
  Three packs move, translation copy only — no key is added or removed, no `en` value
  changes, and every value keeps its U+2026:
  
  - **de** → `Wird geladen…` on `detail.loading`, `report.loading` (were `Laden…`) and
    `approvalsInbox.loadingMore` (was `Lädt…`). The passive is both the group majority and
    the pack's dominant register for in-flight states generally.
  - **ko** → `로딩 중…` on `fields.recipient.loading`, `grid.bulk.loading`,
    `grid.import.historyLoading` and `approvalsInbox.loadingMore` (were `불러오는 중…`).
    Majority, and it matches the pack's own pattern: `불러오는 중` is what `ko` uses when the
    string names the thing being loaded, the bare form is `로딩 중`.
  - **ar** → `جارٍ التحميل…` on `common.loading` and `detail.loading` (were `جاري التحميل…`).
    This one is an orthography normalization rather than a wording choice: `جارٍ` is the
    indefinite منقوص participle with tanwīn on the rāʾ, `جاري` the yāʾ-retaining form.
  
  `de` `auth.device.loading` deliberately stays `Lade…`. It is the one member whose outlier
  spelling is coherent with its own screen: `DeviceAuthPage` renders that namespace's three
  in-flight states together and `de` writes all three in the same first-person voice
  (`Genehmige…`, `Ablehne…`, `Lade…`), the other two being outside this group. Converging it
  alone would manufacture a fresh same-screen inconsistency, so it is reported as a fork and
  pinned as a named exemption instead.
  
  `packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts` gains the per-language
  uniformity pin beside the glyph rule that created the group. The pin derives the group
  from `en` and asserts its membership and per-language value counts **before** asserting
  uniformity, so it cannot pass by matching nothing.
- b08b7eb: All ten locale packs now define `home.recentApps.itemType.report` and
  `home.recentApps.itemType.metadata` (objectui#6023). `RecentItem['type']` is a six-member
  union and `useTrackRouteAsRecent` writes both of these at runtime — `metadata` on any
  `/metadata/<type>/<name>` route visit, `report` on any `/report/<name>` visit — but the
  packs defined only four of the six, so the Recently Accessed and Starred cards labelled
  those two items from the call sites' inline `defaultValue` instead of from the pack.
  
  Ten packs missing the same member is full parity, so no pack-vs-pack gate could see it,
  and the prefix rule only ever asked whether `home.recentApps.itemType` resolved, which it
  did. What made it quiet rather than loud is the `defaultValue`: English readers saw a
  plausible `Report` / `Metadata` (lowercase in the rail) rather than a raw key, and the
  other nine locales saw those English words — objectui#3517's mechanism for hiding a
  missing key for months.
  
  The nine translations were taken from each pack's own existing rendering of the same word
  rather than composed: the singular `Report` that `appDesigner.navReport`,
  `appDesigner.navTypeReport` and `search.badgeReport` already carry (ar `تقرير`, de
  `Bericht`, es `Informe`, fr `Rapport`, ja `レポート`, ko `보고서`, pt `Relatório`, ru
  `Отчёт`, zh `报表`), and the `Metadata` that `layout.metadata.label` already carries (ar
  `البيانات الوصفية`, de `Metadaten`, es `Metadatos`, fr `Métadonnées`, ja `メタデータ`, ko
  `메타데이터`, pt `Metadados`, ru `Метаданные`, zh `元数据`). No new vocabulary was invented
  for any locale.
  
  The two matching entries in `scripts/i18n-call-site-key-baseline.json`'s `missingMembers`
  are cleared, since that list is a ratchet: a baselined entry whose defect is gone fails the
  build too. The union itself is untouched — narrowing `RecentItem['type']` is the other
  resolution the gate accepts, and it would have been a lie about data both call sites
  demonstrably write.
- 5fa06c4: The zh pack's `console.breadcrumb.reports` renders 报表, the noun the rest of the pack
  already uses for the report feature (objectui#6166).
  
  **The authority for this edit is the maintainer ruling of 2026-08-25, not an occurrence
  count.** The card was filed explicitly as a native-speaker call and explicitly forbade
  resolving it by normalising to the majority: 报表 (a tabular/data report) and 报告 (a
  written/narrative report) are not interchangeable, so a pack that spells one key
  differently from its siblings is evidence of a majority and never, on its own, evidence of
  a mistake. The maintainer ruled that no deliberate narrative-report distinction was
  intended here and that the breadcrumb names the same report feature the rest of the pack
  calls 报表.
  
  The render context corroborates the ruling and closes the confidence gap triage recorded
  when it declined to decide this itself. `console.breadcrumb.reports` labels the
  `routeType === 'report'` **list** route in app-shell's `AppHeader` — a structural sibling
  of the `dashboards`, `pages` and `system` segments beside it — and drilling through it
  appends a metadata report definition, the same feature named by
  `console.commandPalette.reports`, `console.nav.navReport`, `search.typeReports`,
  `search.badgeReport` and `search.reportNotFound`. Nothing narrative renders beneath it.
  
  A comment at the key records that this was **ruled** rather than counted, and states the
  报表/报告 distinction it was ruled against, so the next reader measuring pack consistency
  neither re-files it nor quietly restores 报告 after reading the render context and
  disagreeing. That comment is half of the deliverable; the value change alone would leave
  the decision unrecorded, which is the failure mode the card was most concerned about.
  
  **Scope: one key, one pack.** This is not a licence to normalise vocabulary across the ten
  packs — the card names that hazard explicitly and says it would need its own ruling, and
  this ruling grants nothing beyond the single key it names. No `en` value changes, so no
  other pack is asked to follow, and no other pack was touched.
- 5d3a2d1: The capability picker localizes `manage_sharing` (objectui#6285). Before this, "Manage
  Sharing" was the one platform capability in `sys_permission_set`'s picker that rendered in
  English in every locale, beside seven siblings that translated — a user-visible missing
  translation, in all ten packs at once.
  
  The cause was an unchecked copy. `CURATED_CAPABILITY_LABELS` in
  `CapabilityMultiSelectField.tsx` listed seven capability names under a doc comment claiming
  it mirrored `@objectstack/spec/security`'s `PLATFORM_CAPABILITIES`; the spec grew an eighth
  member and the list did not follow, so `manage_sharing` fell through to the English label
  the `sys_capability` registry serves. Nothing could catch it: the i18n gate reads that list
  as this key family's vocabulary and checks the members it names — all seven had keys — and
  no instrument compared the vocabulary to the array it was named after.
  
  `capability.label.manage_sharing` is now authored in all ten packs and in the field widgets'
  provider-less defaults map, the list carries the member, and the prose claim is replaced by
  a check: `CapabilityMultiSelectField.specParity-6285.test.tsx` imports `PLATFORM_CAPABILITIES`
  and fails on any difference in either direction, reading the declaration through the i18n
  gate's own source reader so what it pins is exactly what that gate consumes. `labelFor` also
  gains a `defaultValue`, so a capability that arrives in a future spec bump before its
  translation is authored degrades to the registry's English label rather than rendering a raw
  i18n key at the user.
- 00c665e: `appDesigner.fieldDesigner.formula` is retired — one row removed from each of the ten
  locale packs plus the designer defaults map, 11 lines, zero readers (objectui#6310).
  
  objectui#6043 retired the Field Designer's formula-expression textarea, which was the
  key's only call site (`FieldDesigner.tsx`, the `{ name: 'formula', label:
  t('appDesigner.fieldDesigner.formula') }` field descriptor). The value outlived it in
  eleven places: `DESIGNER_DEFAULT_TRANSLATIONS` in
  `packages/plugin-designer/src/hooks/useDesignerTranslation.ts`, and the `appDesigner >
  fieldDesigner > formula` leaf of `packages/i18n/src/locales/{en,de,es,fr,pt,ru,ja,ko,zh,ar}.ts`.
  
  Removed under objectui#4658's evidence standard, re-measured on this branch rather than
  inherited from the card: zero `t()`/`tt()` call sites, no dynamic template head that could
  reach it (`appDesigner.fieldDesigner.typeCategory.` is the namespace's only one), and its
  sole textual occurrence anywhere in the repo was the defaults-map row this change removes
  with it — so the key goes from NEEDS-REVIEW to no footprint at all.
  
  The map and all ten packs move in one commit, which is what keeps
  `defaults-maps-mirror-en-pack` green: that gate fails a map row whose key the `en` pack
  lacks, and `all-locales-key-parity` fails a pack left behind.
  
  Not touched: `designer.field.formula` (`'Formula (CEL)'`) in
  `packages/app-shell/src/views/metadata-admin/i18n.ts`, a different and live key belonging
  to metadata-admin's `ObjectFieldInspector` — the surface that still authors formula
  expressions.
  
  `packages/i18n/src/__tests__/appDesigner-fieldDesigner-formula-retired-6310.test.ts` pins the
  removal by name, following the four prior retirements (objectui#4145, objectui#4392,
  objectui#4730, objectui#5504). Every i18n gate here runs call site → key, so none of them can
  see a dead key come BACK into the packs: the reverse sweep that found this one is report-only
  by design, `all-locales-key-parity` is fully satisfied by ten packs agreeing on a dead key, and
  `check:i18n-drift` only fires when a value changes. Reverse-verified rather than asserted —
  reviving the row in all ten packs turns exactly that one case red, naming each pack, while the
  parity gate and the defaults-map mirror stay green.
- fff9645: `ar` spells the منقوص participle one way — `جارٍ`, pack-wide (objectui#6610).
  
  The pack wrote the active participle of جرى two ways at once: `جارٍ` on 92
  values and `جاري` on 8. One word, two spellings, differing by a single code
  point — U+064D (tanwīn kasr, the yāʾ dropped) against U+064A (the yāʾ kept) —
  and same-screen visible: `LoadingScreen` renders `console.initializing` as the
  heading over the three `console.loadingSteps.*` and `console.actions.retrying`
  on the retry button, four values that all said `جاري`, inside a console that had
  already said `جارٍ` on `dashboard.loading`, `list.loading`,
  `detail.loadingAttachments` and `console.ai.*`.
  
  The 92:8 majority is not why the 8 moved. An اسم منقوص declines three ways, so
  "the 8 are right in their own context" was a live reading and was falsified
  rather than out-voted: all eight opened their string as a fronted indefinite
  predicate over a delayed subject — nominative, indefinite, not annexed — and
  five had a word-for-word twin already spelled `جارٍ`, `grid.refreshing`
  (`جاري التحديث…`) against `list.refreshing` (`جارٍ التحديث…`) being the exact
  minimal pair. Meanwhile the three values where the yāʾ is grammatically required
  (accusative `جاريًا` after لا يزال / ما زال, definite `الجارية`) are correct and
  are left alone.
  
  Eight values converged; no key added or removed and no `en` value touched.
  `ar-participle-orthography-6610.test.ts` makes it a pack-wide invariant rather
  than an eight-key edit — a ninth value arriving with the yāʾ now fails by key
  name — and pins the three legitimate yāʾ occurrences so a later sweep cannot
  flatten a correct distinction into a real grammatical error.
- 9c3b7ce: The German pack's `auth.device.*` in-flight states move to the passive register
  (objectui#6611, triage ruling 2026-08-27, option 2): `approving` `Genehmige…` →
  `Wird genehmigt…`, `denying` `Ablehne…` → `Wird abgelehnt…`, `loading` `Lade…` →
  `Wird geladen…`.
  
  Graded a bug, not a taste call: `Ablehne…` was not a grammatical German form.
  `ablehnen` is a separable-prefix verb, so the first-person singular is *ich lehne
  ab* — the pack shipped broken German on `DeviceAuthPage.tsx` to users today.
  Re-derived the ruling's premise against the tree before touching anything: the
  `de` pack's dominant in-flight register is measurably the passive — 40 of 61
  `en`-bare-gerund keys render `Wird …`, against 21 that don't (a Unicode-aware,
  position-aware scan, positive-controlled on `common.loading` → `Wird geladen…`),
  close to triage's "roughly 37" and the same conclusion either way. `loading` was
  the sole member of objectui#5972's merged `Loading…` group carved out by name in
  `LOADING_GROUP_FORKS` (`packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts`),
  because converging it alone while `approving`/`denying` stayed first-person would
  have manufactured a new same-screen inconsistency. Moving the whole namespace to
  the passive removes that fork rather than maintaining it, so the exemption row is
  deleted and the pin now asserts zero forks.
  
  No key added or removed, no `en` value moves, no other locale touched.
- dbd5194: The shell's `sys_activity.type` reading stops calling every unrecognised type an
  update (objectui#6730).
  
  `mapActivityRows` in `hooks/sharedUserFeeds.ts` — the feed behind the AppHeader
  bell's Activity tab, Home's activity card and the exported `ActivityFeed` panel
  — carried the third hand-written reading of that column in this repo, and it
  bucketed every value outside `created` / `deleted` / `commented` / `mentioned`
  as `update`. That is not a missing decision; it is a wrong one stated out loud:
  a `scheduled` meeting, a `login`, a nightly `system` rollup and an author's
  `contract_countersigned` all rendered as "somebody updated this record".
  
  - New `layout/activityItemType.ts` holds the whole reading — the table, the
    generic bucket, the `"NOW()"` timestamp fallback and the row constructor that
    applies all three — DOM-free, so what a row becomes is assertable directly.
  - `ActivityItem['type']` gains a fifth kind, `system`: the generic bucket, with
    its own icon, label and notification toggle. Following
    `UNMAPPED_ACTIVITY_FEED_TYPE`'s precedent, an unrecognised value renders
    through it and is named once on `console.warn` rather than being dropped —
    `sys_activity.type` is author-extensible (objectstack `88b9d749a`, direction 4), so
    an unmapped value is real activity nobody has ruled on, not a mistake.
  - The built-ins that had no honest presentation among the four existing kinds —
    `system`, `completed`, `scheduled`, `login`, `logout` — now land in that
    bucket instead of claiming `update`. `assigned` and `shared` stay `update`:
    both write to the record.
  
  ⛔ The two readings of this column are deliberately NOT converged.
  `activityRowToFeedItem` builds a `FeedItem`, and the vocabularies cross:
  `FeedItem` collapses create/update/delete into one `field_change` and drops
  `commented` / `mentioned` outright, so routing this surface through it would
  cost the bell every comment row and every create/delete distinction. What is
  shared is a pin, not an import — the new suite reads plugin-detail's real table
  (a devDependency; no runtime edge) and fails when the declared vocabulary grows
  an entry this side has not read, or when the two readings stop disagreeing in
  the three measured ways.
- b392674: Field widgets say WHY they refused an edit in the reader's language
  (objectui#6755, maintainer ruling 2026-08-29).
  
  Three sentences a person has to read to recover from a refusal were string
  literals in the widgets, inside a package whose locale channel 11 of its 55
  widgets already use: `ObjectField`'s `Invalid JSON`, and `LocationField`'s
  format and range refusals (objectui#6716 / #6714). So a zh / ja / ar user who
  mistyped a coordinate or a JSON blob was told why in English, in a form whose
  labels, gate hints and validation copy were all translated.
  
  - All three now read from `useFieldTranslation` / `FIELD_DEFAULTS` under
    `fields.object.invalidJson`, `fields.location.refusedFormat` and
    `fields.location.refusedRange`, with entries in all ten locale packs — bound
    from now on by `check:i18n-drift`.
  - The `en` values are byte-identical to the literals they replace, so English
    and provider-less rendering are unchanged, and the refusal pins of
    objectui#6716 / #6715 and `plugin-form`'s two refusal suites are untouched.
  - `fields.location.refusedRange` keys the FRAME only: the interpolated
    `{{detail}}` is `LocationValueSchema`'s own complaint, because the widget must
    not restate the spec's bounds (a hand-copied range is a second contract).
  - Not in scope, and recorded rather than folded in: `LocationField`'s third
    refusal sentence — the residue arm objectui#6715 added after the ruling was
    written — is still a literal. The card behind `320374d2a` carries it.
- 4f3a1e2: fix(plugin-timeline): refuse an unusable gantt date range with a diagnostic that names the offending value
  
  A gantt whose date range cannot be used now renders a `role="alert"` diagnostic
  naming the value that made it unusable, instead of crashing or drawing a chart
  that is confidently wrong. Two input classes, which failed in opposite
  directions:
  
  - A date that does not parse threw `RangeError: Invalid time value` mid-render —
    the same crash site objectui#6750 guarded for the empty list, on a different
    input. This covers a malformed value (`startDate: 'not-a-date'`), an absent
    one, and an unparseable `minDate` / `maxDate` pinned on the schema.
  - An inverted pinned range (`minDate` after `maxDate`) drew a bar at
    `left: 157.9%; width: -4.3%` under a header row with zero cells, with no
    error and no diagnostic.
  
  Valid gantts, the empty-list sentinel from objectui#6750 and the degenerate
  `minDate === maxDate` axis are unchanged.
- 320374d: Key `LocationField`'s THIRD refusal sentence — the residue arm — into the locale
  packs.
  
  Typing a half that is only PARTLY a number (`12abc, 34`) is refused by
  `LocationField` with its own sentence, added by objectui#6715. objectui#6755 had
  ruled two weeks earlier that a widget's own refusal sentence goes through
  `useFieldTranslation` + `FIELD_DEFAULTS`, and named three sentences — but it was
  written on 2026-08-29 14:53 and this arm landed after, so it stayed a hard-coded
  English literal while its two siblings were keyed.
  
  **The consequence was worse than one more English string.** All three refusal arms
  render through the SAME `<p>` and the same `refusalError` state, so after #6755
  landed that one line spoke the reader's language when the format or range arm fired
  and English when the residue arm did — objectui#4028's shape ("four Chinese labels
  around one English one") compressed into a single sentence position, which reads to
  a user as a bug rather than as a missing translation.
  
  **Arity is answered explicitly, not defaulted.** Unlike the other two sentences, this
  one had grammatical number: `verb` was `is not a number` / `are not numbers`, chosen
  in TypeScript. Handing a pack an English verb form through a `{{hole}}` gives it a
  fragment it cannot inflect around — Arabic has a DUAL, and two halves is exactly that
  case. So the verb is not a hole. It lives inside two SIBLING keys picked at the call
  site, `fields.location.refusedResidue` and `fields.location.refusedResidueOne`,
  following this repo's own plural convention rather than i18next's `_one`/`_other`
  suffixes — the same shape `RecordPickerDialog` already uses in this very defaults map
  (`lookup.recordCount` / `lookup.recordCountOne`), and for the reason `ReactionPicker`
  states in source: zh/ja/ko have no separate singular form, would legitimately omit a
  `_one` half, and `all-locales-key-parity` reads that as a missing key. The `ar` pack
  now uses its dual (`ليسا رقمين`), which the old implementation could not have produced.
  
  The English conjunction `' and '` and the coordinate NOUNS go the same way: each pack
  writes its own conjunction inside the two-half value, and `latitude` / `longitude`
  become `fields.location.latitude` / `fields.location.longitude`, keyed once each and
  interpolated into both arities so no locale holds two spellings of the same word. The
  only holes carrying untranslated data are `{{text}}` / `{{otherText}}` — the
  characters the person actually typed.
  
  **No behaviour moves.** The English values are byte-identical to the literal they
  replace in both arities, verified by `check:i18n-drift` (0 en values changed, 4 added)
  and by objectui#6715's own `LocationField.strictNumeric.test.tsx` and `plugin-form`'s
  `ObjectForm.locationResidue.test.tsx` passing untouched. Provider-less rendering is
  unchanged, the refusal itself is unchanged, and the four new keys are bound from here
  on by `check:i18n-keys` and `all-locales-key-parity` like their three siblings.
- 639114c: Carry `manage_org_presentation`, the ninth platform capability (objectui#7122).
  
  `@objectstack/spec` 17.3.0 declares a ninth member of `PLATFORM_CAPABILITIES`
  and the capability picker's curated set carried eight, so
  `CapabilityMultiSelectField` fell back to the `sys_capability` registry's
  English label for it in every locale — the exact defect objectui#6285 filed
  when `manage_sharing` did the same thing.
  
  The label is the spec artifact's own (`Manage Organization Presentation`), read
  off the installed build rather than invented, and it is authored everywhere the
  widget's docblock requires of any edit to that list: `useFieldTranslation.ts`
  and all ten locale packs. Each non-English string is composed from that pack's
  own established sibling vocabulary (`manage_org_users`,
  `manage_platform_settings`) rather than machine-translated; a native review pass
  is welcome on the nine, and nothing about the capability's behaviour depends on
  the wording.
  
  The parity pin is unchanged and still fails on ANY difference in either
  direction, which is what made this visible before it reached a screen.
- 1490691: `dashboard.noRows` and `dashboard.noDataAvailable` are retired — two rows removed from
  each of the ten locale packs, 20 entries, zero readers (objectui#7125).
  
  objectui#7063 routed the three dashboard empty-state renders (`DatasetWidget`,
  `ObjectDataTable`, `PivotTable`) through one shared `WidgetEmptyState`, which resolves its
  own copy from the `dashboard.empty.*` family. The two keys the old per-widget placeholders
  used outlived their call sites in `packages/i18n/src/locales/{en,de,es,fr,pt,ru,ja,ko,zh,ar}.ts`.
  
  Removed under objectui#4658's evidence standard, re-measured on this branch rather than
  inherited from the card: zero `t()`/`tt()` call sites for either fully qualified key, no
  dynamic `dashboard.` head a substitution could resolve onto them, and every surviving
  textual occurrence in `packages/` is a comment recording the consolidation. `pnpm
  check:i18n-keys` stays green across the deletion with the `en` pack at 2,962 keys (2,964
  before) and every in-scope call-site key still resolving.
  
  Not touched: `table.noRows` (`'No rows to display'`) and `engine.form.noRows`
  (`packages/app-shell/src/views/metadata-admin/i18n.ts`, read at `widgets.tsx`) — two
  different, same-named keys in different namespaces. Nor the comments in
  `WidgetEmptyState.tsx`, `DatasetWidget.tsx`, `ObjectDataTable.tsx` and `PivotTable.tsx`
  that record WHY three widgets with three strings became one shared empty state; the packs'
  own comment keeps that rationale and now names the retirement instead of a row that is
  gone.
  
  `packages/i18n/src/__tests__/dashboard-emptyState-keys-retired-7125.test.ts` pins the removal
  by name, following the five prior retirements (objectui#4145, objectui#4392, objectui#4730,
  objectui#5504, objectui#6310). Every i18n gate here runs call site → key, so none of them can
  see a dead key come BACK into the packs: the reverse sweep that found these is report-only by
  design, `all-locales-key-parity` is fully satisfied by ten packs agreeing on a dead key, and
  `check:i18n-drift` reported the deletion as `2 removed — those are all-locales-key-parity's`.
- d8ec8d6: `ActivityTimeline` speaks the session locale — the other 18 literals
  (objectui#7149).
  
  objectui#7142 gave this component its first `t()` call (the empty-state title)
  and filed the sweep that found the rest. Until now a zh activity tab read
  `"Activity(0)暂无活动记录"`: one translated string in a component that was
  otherwise entirely English.
  
  All 18 now resolve from the ten packs, in three groups:
  
  - **Relative timestamps and the card title** (`just now`, `{{count}}m/h/d ago`,
    `Activity`) — these render on *every* activity tab. All five were a pure
    lookup swap: the `en` pack value was already byte-identical to the literal,
    and the sibling `RecordActivityTimeline` already used the same keys.
  - **The `formatFieldChange` sentences** — assembled in code, so they needed new
    keys *with* interpolation holes rather than a lookup. Same reachability as the
    timestamps: they render for any entry whose optional `description` is absent.
    The quotes live inside each pack's value, so every locale punctuates its own
    way (de `„…“`, zh `“…”`, ja `「…」`, fr/ru `«…»`).
  - **The six filter chips and the chip group's accessible name** — reachable only
    through the published export, since no host in this repo passes `filterable`.
  
  Ten new `detail.*` keys across all ten packs (no inline `defaultValue` —
  objectui#3517), mirrored byte-for-byte into `DETAIL_DEFAULT_TRANSLATIONS` so a
  provider-less host still reads English rather than a raw key.
  
  One deliberate English copy change: the chip group's `aria-label` was
  `"Activity type filter"` and now resolves `detail.filterActivity`
  (`"Filter activity"`) — the key `RecordActivityTimeline` already uses for the
  accessible name of its own activity filter, so one control does not carry two
  names across two components.
  
  Also drops the unused `Filter` import (a pre-existing eslint warning).
- 866cd1d: `RecordComments` and `PointInTimeRestore` resolve their copy from the locale
  packs instead of hardcoded English (objectui#7163).
  
  Both files carried their own `formatTimestamp` whose relative-time branches
  returned English literals, so a zh/ja/ar session read `5m ago` next to
  otherwise translated chrome — the defect objectui#7142/#7149 fixed one file
  over in `ActivityTimeline`.
  
  - **`RecordComments`** was already wired to the packs (11 `t('detail.…')`
    references), so this is a pure lookup swap onto `detail.justNow` /
    `minutesAgo` / `hoursAgo` / `daysAgo` — keys already present in all ten packs,
    each `en` value byte-identical to the literal it replaces. **No new key, no
    copy change.**
  - **`PointInTimeRestore`** used no translation hook at all, so it is swept
    WHOLE rather than having only its timestamps converted: card title, empty
    state, field-count line, preview panel, snapshot heading, restore
    confirmation and all three buttons. Wiring one string into an otherwise
    untranslated component is what shipped objectui#7142's visibly half-done zh
    card; that is not repeated here.
  
  Ten new `detail.*` keys land in all ten packs and in
  `DETAIL_DEFAULT_TRANSLATIONS`: `revisionHistory`, `noRevisions`,
  `revisionFieldsChanged`, `revisionFieldsChangedOne`, `revisionPreview`,
  `revisionSnapshot`, `restoreConfirm`, `restoring`, `confirmRestore`,
  `restoreToPoint`. `detail.cancel`, `detail.activityEmptyValue` and
  `detail.emptyValue` are **reused**, not forked.
  
  The restore confirmation becomes one key with a `{{when}}` hole rather than a
  sentence assembled around a JSX expression, and the field-count line uses the
  repo's two-key plural convention selected by a static ternary over two literal
  keys — never `t(KEYS[n])`, which objectui#7149 measured as invisible to the
  i18n scanners.
  
  One deliberate copy change: the snapshot panel's null placeholder was an EN
  DASH (`–`, U+2013) written inline and now resolves `detail.emptyValue`, which
  is an EM DASH (`—`, U+2014) in all ten packs — the glyph the rest of the detail
  package already uses for an empty value.
- 20c04b2: A gantt timeline whose rows are malformed now refuses to draw, naming the row,
  instead of crashing the render (objectui#7164, maintainer ruling A+).
  
  `TimelineRenderer`'s gantt branch used to read the authored rows twice — once
  defensively in `findUnusableGanttDate`, once bare in `calculateDateRange` — and
  every input in the gap threw a `TypeError` mid-render from ordinary JSON:
  `items: [null]`, a row whose `items` is `5` / `true` / `{}` / an array-like
  object, or `items` itself not an array. The three readers (the date scan, the
  range computation and the render loop) now consume ONE verdict from
  `classifyGanttRows`, and a malformed shape renders the existing `role="alert"`
  refusal through a new diagnostic key,
  `timeline.gantt.unusableRange.malformedRow` — "items[0] is null, which is not
  a row shape" — never the `malformedDate` copy, which named the wrong fault.
  The key lands in `en` and the nine sibling locale packs.
  
  `@object-ui/types` (minor — the accept set narrows): `TimelineSchema.items` no
  longer declares `z.array(z.any())`. Every element must be an object, and a
  gantt row's own `items`, when present, must be an array, so `validate` refuses
  `items: [null]` and `items: [{ items: 5 }]` at authoring time — before they
  reach a renderer. Feed items (`vertical` / `horizontal`) carry no `items` key
  and parse exactly as before; every in-repo `type: 'timeline'` fixture parses
  green on both sides of the change. Rows with no bars (`items: []`, a row
  without `items`) stay the ordinary empty state and still draw.
- 01c9023: `AiPendingActionsInbox` speaks the session locale — every string in it, not only its timestamps (objectui#7173).
  
  The AI HITL approval inbox held its own relative-time helper returning hardcoded
  English (`'just now'`, `` `${min}m ago` ``), so a zh / ja / ar session read English
  relative times on every row. It is the fifth spelling of that helper in the repo,
  and the file had **no translation wiring at all** — the unwired-component shape,
  not the lookup-swap shape.
  
  It is therefore swept whole. objectui#7142 wired one string into an otherwise
  untranslated component and shipped something visibly half-done, and objectui#7149
  is what finishing that afterwards cost; the triage ruling on this card (2026-09-01)
  carried that forward as *sweep the file whole or leave it*. Everything the user can
  read now resolves from the locale packs: the card heading and description, the three
  tabs, the refresh button, all five status badges, the six column headings, the empty
  state, the row and drawer buttons, all nine drawer field labels, the outcome banner
  and the whole reject-reason dialog.
  
  **No new rows for the four relative-time branches.** `detail.justNow`,
  `detail.minutesAgo`, `detail.hoursAgo` and `detail.daysAgo` already existed,
  translated, in all ten packs, and cross-package key borrowing is this repo's settled
  convention rather than an open question — `ObjectGrid`, `ObjectKanban`, `ObjectTree`,
  `ListView`, `ObjectView`, `NavigationOverlay`, `RecordAttachmentsPanel`,
  `RecordDetailView` and `apps/console` all resolve `detail.*` from outside
  `plugin-detail`. One phrase on one kind of control should not get a second
  translation that can drift from the first.
  
  The rest of the sweep needed copy no pack had, so `@object-ui/i18n` gains an
  `aiApprovals` namespace: 38 keys, translated in all ten packs. It is deliberately
  separate from `approvalsInbox`, which is the human approval-**process** inbox — a
  different surface and a different feature, so no rows are shared with it. Four
  generic verbs are reused rather than forked (`common.refresh`, `common.cancel`,
  `common.loading`, `common.ok`).
  
  **⛔ The five relative-time helpers are not unified.** They differ in real behaviour
  — `Math.round` here against `Math.floor` in `plugin-detail`, thresholds 45s/30d
  against 60s/7d, different tails — so normalising them is a behaviour change wearing
  a refactor's clothes and needs its own card. This inbox's arithmetic is untouched,
  and three rows in the new suite exist only to pin it: 50s renders `1m ago` (a 60s
  threshold would still say "just now"), 90s renders `2m ago` (`Math.floor` gives
  `1m ago`), and 20d renders `20d ago` (a 7d threshold would already show a date).
  
  Two assembled English sentences became single interpolated keys — the outcome banner
  (`Approve for {{id}}: {{message}}`) and the drawer subtitle
  (`Tool {{tool}} on {{object}}`). Their word order differs per locale, which fragments
  around a `<code>` element cannot express, so the two identifiers lose their monospace
  styling. That is the deliberate cost of making those sentences translatable.
  
  Evidence: an `en`-only assertion cannot discriminate here, because each key's `en`
  value is byte-identical to the literal it replaced. The suite asserts in **zh and
  ar**, and the provider-less path separately, in its own file (`createI18n` installs
  itself as react-i18next's module-level global, so a provider-less render in a file
  that has already mounted a provider silently reads that pack instead of the defaults
  map). No inline `defaultValue` anywhere (objectui#3517).
  
  Two consequences of the sweep, both landed here rather than left for CI to find:
  
  `packages/app-shell/src/console/ai/__tests__/ConversationsSidebar.test.tsx` froze its
  `vi.mock('@object-ui/i18n', ...)` factory to a hand-written object. Its import graph
  reaches `plugin-chatbot`, which now resolves `createSafeTranslation` at module scope, so
  the frozen surface made that read `undefined` and the file died during COLLECTION — the
  objectui#6849 shape, which does not look like a test failure. It now spreads
  `importOriginal()` and overrides only `useObjectTranslation`. Measured, not guessed: of
  the 41 frozen `@object-ui/i18n` factories in the repo, running every one of them showed
  this to be the only file whose graph reaches the package.
  
  The ten pack blocks are locale DATA, and locale data lands in the console's eager
  `framework` chunk, so `scripts/check-eager-closure-budget.mjs` raises that chunk's
  ceiling from 512,000 to 524,000 gzipped bytes and re-pins its baseline onto a fresh
  measurement (502,405 to 514,863). Attributed by three console builds: the merge parent
  reads 510,192, this branch with the ten `aiApprovals` blocks cut reads 510,192 again, and
  this branch reads 514,863 — so the whole 4,671-byte delta is the pack data and nothing
  else. Headroom is kept at the line's own convention (9,137 bytes, 0.10x the regression
  the gate must catch) rather than widened; most of the overage was pre-existing drift, with
  the merge parent already at 510,192 of the 512,000 allowed.
- e8c553b: A scatter handed more than one series now refuses instead of drawing a false picture.
  
  Scatter binds one measure: `series[0].dataKey` is the y axis, and every series was
  handed the same rows through that one axis. A second series therefore added a
  colour and a legend entry and nothing else — measured, two series over two rows
  painted four symbols at two positions, each drawn twice, and the second measure's
  values appeared nowhere on the plot. The data was valid and the picture was
  confidently wrong, which no existing refusal could see.
  
  A `chartType: 'scatter'` with two or more `series` now renders the renderer's
  refusal shell under `data-chart-error="scatter-multi-series"`, stating that a
  scatter plots one measure, naming the fix (keep exactly one series) and listing
  the series keys it was handed. A single-series scatter is unchanged.
  
  This refusal counts authored `series` only. `compareTo` on scatter is out of
  its scope: objectui#7402 ruled (b) that scatter joins pie / donut / funnel in
  excluding `compareTo` — `supportsCompareTo` and the dashboard widget path stop
  synthesising a comparison series for it, so no `…__comparison` overlay is ever
  built for a scatter and this guard is never reached by a compare-to document.
  That exclusion ships as a separate change; until it lands, a `compareTo`
  document still reaches the renderer as two series and refuses here today.
  
  No multi-measure projection is built (maintainer ruling, 2026-09-02): nothing
  in-repo authors a two-series scatter, so that capability waits for a real caller.
  The refusal copy is `chart.scatterOneMeasure` in all ten locale packs.
- 7c3df8f: A non-grid view's fetch now carries a platform row ceiling, and crossing it is
  never silent (objectui#7210, maintainer ruling a′, 2026-09-02).
  
  Before this, `ObjectGantt`, `ObjectCalendar`, `ObjectMap` and `ObjectTree` each
  issued a `find` with **no `$top` at all**, so the request returned the entire
  filtered result set. At the 186 rows the card was filed from that is invisible;
  on an object with 100k scheduled rows it is the whole table into the browser,
  and nothing an author could write — `pagination.pageSize` included — could
  bound a request that never carried a cap to begin with.
  
  **What changed.** Those four fetches now ask for `NON_GRID_ROW_CEILING_TOP`
  rows, draw at most `NON_GRID_ROW_CEILING` of them, and when the result set was
  larger they render a footnote naming both numbers, verbatim as it renders:
  *"Showing the first 2000 of 41234 records. Narrow the filter."* Below the
  ceiling nothing changes: the full set draws and no footnote appears.
  
  The four view packages take a **minor**, not a patch: a result set above the
  ceiling is no longer drawn in full, which is a behaviour break whatever the
  fixed group does to the released version number.
  
  **The ceiling is a platform constant, not an authorable key** — `2000`, exported
  from `@object-ui/react` as `NON_GRID_ROW_CEILING`. An authored `limit` or
  `dataSource: { limit }` still does not reach these queries, by the same ruling;
  three alternatives were rejected with it (a documentation note only — still the
  whole table; truncating at `pageSize` — silent, and a complete schedule capped
  at one page; an authorable `maxRows` — a new permanent key every author sets).
  
  **Why 2,000.** One constant for all four, so the binding view sets it. Measured
  in this repo's jsdom lane: gantt, calendar and map hold their DOM flat as rows
  grow (virtualised task list; four events per day cell; auto-clustering above
  100 markers), while `ObjectTree` flattens every expanded node into the document
  at a linear **5.2 DOM elements per record** with no virtualisation. 2,000 rows
  is where the worst of the four lands at ~10,400 elements — an order of
  magnitude above Lighthouse's "excessive DOM size" warning, and still ~10x the
  real application result set this card came from.
  
  New exports on `@object-ui/react`: `NON_GRID_ROW_CEILING`,
  `NON_GRID_ROW_CEILING_TOP`, `applyNonGridRowCeiling`, `NonGridRowCeilingNote`
  and the type `NonGridCeilingResult`. Two new `common.*` i18n keys carry the
  footnote copy in all ten packs.
- db3896c: `ObjectGantt` refreshes in place when its query really changes, instead of tearing the chart down to the loading placeholder (objectui#7237).
  
  Once the chart has painted, a change to its sort, filter, permissions, search or bound source re-runs the query with the chart still mounted, so it keeps its scroll position, its collapsed groups and any inline edit in progress. While the query runs, a thin indeterminate bar over the chart marks the rows on screen as the previous answer, and the rows are replaced when the new answer lands. It is the same `RefreshIndicator` that `ObjectGrid`, `ListView` and `ObjectChart` draw over their rows. The initial load still shows the loading placeholder.
  
  The bar also shows during the chart's other in-place re-reads: the toolbar refresh, the re-read after a drag, a dependency link, a delete or a field edit, and a re-read triggered by the data-invalidation bus. Those already kept the chart mounted, but the only sign of them was a disabled refresh button.
  
  A changed query that fails is still reported as an error, as it was before. Only a re-read of the same query keeps its last good rows when it fails.
  
  `@object-ui/i18n`: new key `gantt.aria.refreshing`, the bar's accessible name, in all ten locale packs.
- 3399704: Fix `AiUsageIndicator` to recognize the free plan's new `resetKind: 'weekly'` and its
  `resetsAt` (objectui#7371, consumer of cloud PR #1852's rolling 7-day AI quota window).
  
  Before this change a `weekly` meter fell through to the component's unrecognized-kind
  path and rendered no reset line at all — not a crash, but silently wrong information
  next to a live progress ring. The indicator now shows "Resets in N days" (or "Resets in
  N hours" once inside the final day, e.g. `console.ai.usage.resetsWeeklyHours`), computed
  from the endpoint's `resetsAt`, in both languages via `@object-ui/i18n`
  (`console.ai.usage.resetsWeeklyDays` / `resetsWeeklyHours`, real i18next plural families
  with a base key so every locale pack resolves correctly, all ten packs translated). D5 is
  preserved — no token count is ever rendered, only the days/hours until reset.
  
  Contract-first: `resetsAt` is read verbatim from the endpoint, never re-derived or
  guessed client-side. A `weekly` meter with `resetsAt: null` (nothing counted yet in the
  window) and any `resetKind` this build does not recognize both render no reset line —
  fail-soft, not a crash or stale copy.
  
  `AiUsageResetKind` (`packages/app-shell/src/hooks/useAiUsage.ts`) gains the `'weekly'`
  member; `resetsAt` was already `string | null` and needed no shape change.
- 2a5bf45: fix(i18n): `createI18n`'s `resources` deep-merges, so overriding one key of a namespace keeps the rest
  
  A language pack's top-level keys ARE the namespace groups (`common`, `calendar`,
  `list`, ...), each a nested object, but `createI18n` merged `resources` over the
  built-in packs one level deep. Supplying a partial group therefore **replaced**
  it rather than merging into it:
  
  ```ts
  createI18n({ defaultLanguage: 'en', resources: { en: { calendar: { today: 'Heute' } } } });
  ```
  
  left `calendar.today` set and dropped `month`, `week`, `day`, `allDay`,
  `newEvent`, `moreEvents` and `unscheduled` from the instance. `t('calendar.allDay')`
  then returned the bare key, and `calendar.allDay` reached the DOM as literal
  text — silently, with no error and no warning.
  
  The merge now recurses, so a partial group override touches only the keys it
  names. Packs nest up to four levels below the group
  (`console.ai.empty.build.title`), so it recurses rather than adding one fixed
  extra level. Two in-repo call sites were affected by this and are repaired by
  the change: `packages/plugin-gantt/demo` supplied 53 of the 80 `zh.gantt.*` keys
  and silently lost the other 27 (its own comment says the demo "is never
  half-translated" — it was), and the `skills/objectui/guides/i18n.md` setup
  example, the documented way to use this API, dropped 46 of the 48 `common.*`
  keys in both `en` and `zh`.
  
  **Arrays are replaced, not concatenated** — stated because it is a decision, not
  a library default. No built-in pack carries an array value today (every leaf in
  all ten packs is a string), so nothing observable rides on it; the rule decides
  what a future array means. An author who writes an array is naming the whole
  list, so replacement is the only rule that lets them shorten or reorder one and
  the only one that stays idempotent when the merge runs again. This is
  deliberately narrower than i18next's own `deepExtend`, which the provider's
  async `addResourceBundle` path uses: that recurses into arrays index-wise and
  would leave a longer base array's tail behind, which is the same silent-hybrid
  shape this fix removes.
  
  No caller depended on the old replacement semantics: a census of every
  `resources` literal in the repo (47 parsed sites, plus the dynamic ones resolved
  by hand) found no site that supplied a partial group in order to clear the rest.
- c907a9c: fix(fields): a file or image upload that surfaces no `sys_file` id is refused by name, never submitted as an inline blob
  
  **BREAKING (`@object-ui/fields`), graded `minor` by this repo's release model** (AGENTS.md: objectui's major follows the `@objectstack` family major, so its own breaking changes ship as `minor` with the breaking semantics stated here, never `major`):
  
  - **Who breaks.** Two kinds of host. The first calls `fileValueForSubmit` itself. The second mounts an upload adapter whose result carries no id-shaped `meta.fileId`. That includes the object-URL default: `useUpload()` falls back to it when no `UploadProvider` is mounted, and `UploadProvider` uses it when given no `adapter`. It also includes any S3- or Azure-style adapter, `createS3Adapter` and `createAzureBlobAdapter` among them, because neither mints a `sys_file` row. This includes every host on a non-ObjectStack backend (the README's any-backend `DataSource` path) that stored the inline `UploadedFileMetadata` object: no adapter there mints a `sys_file` id.
  - **What they see now.** `fileValueForSubmit` throws `UploadIncompleteError` (`code` `UPLOAD_INCOMPLETE`, `fileName` naming the pick) where it used to return the inline object, and its return type is `string`. In `FileField`, `FileCell` and `ImageField` the pick is refused with the translated "did not complete" row, and the field is not changed.
  - **What to do.** Mount an `UploadProvider` whose adapter returns the `sys_file` id in `meta.fileId`. `createObjectStackUploadAdapter`, the ObjectStack presigned flow, does. A custom adapter has to register the file with the platform and return that id. A host that calls `fileValueForSubmit` directly catches `UploadIncompleteError` (or checks `code === 'UPLOAD_INCOMPLETE'`) where it used to accept an object. Such a host returns its own file id in `meta.fileId` (word characters and `-`, 1 to 64 long, as `isFileIdToken` requires) and has its read path return `{ id, name, url }`, because a bare id otherwise renders from ObjectStack's `/api/v1/storage/files/:id`.
  
  `Clause-②: yes (narrowing)` — `fileValueForSubmit`, a public export of `@object-ui/fields`, narrows its return type to `string` and throws where it used to return an object; `UploadIncompleteError` is a new public export. No field-value accept set widens.
  
  `fileValueForSubmit` used to fall back to the legacy inline `{ name, original_name, size, mime_type, url }` object when the upload adapter surfaced no `meta.fileId`. That was the file and image widgets' one path to the pre-D3 inline file object: the backend's stored contract has been the bare `sys_file` id since spec `17.0.0`, so the fallback turned a successful-looking upload into a save the engine refused (`invalid_type`) on every deployment that has verified its file-as-reference migration, and into a warned-about legacy value on the rest. ADR-0104's 2026-09-05 addendum fixes the physical column to the bare id as well.
  
  The fallback is retired. `FileField`, `FileCell` and both upload paths of `ImageField` now submit the id the adapter minted, or refuse the pick with the translated `fields.file.uploadIncomplete` message ("did not complete") in the same error row a transport failure lands in — the field is not changed and no new blob reaches `onChange`. This includes the object-URL default `useUpload()` falls open to when no `UploadProvider` is mounted, and any S3/Azure-style adapter that mints no `sys_file` row. Reading is unchanged: a legacy blob already on a record still renders, and on a `multiple` field it is passed through untouched beside a new id.
  
  `@object-ui/i18n` gains the `fields.file.uploadIncomplete` key in every locale pack.
  
  `@object-ui/providers`'s `UploadProvider.tsx` JSDoc for the object-URL default now states it persists nothing and returns no id.
- e1c27e4: The README states **ten** built-in locales, derived from the package rather than restated
  (objectui#7989).
  
  `README.md` ships in this package's `files`, so the two lines a reader meets first went out
  in every tarball claiming **11** built-in locales. The package has ten —
  `BUILT_IN_LANGUAGE_CODES` and the `@object-ui/i18n/locales` map agree on
  `en zh ja ko de fr es pt ru ar` — and the same document already reasoned on ten six times
  further down ("the other nine are separate chunks", "all ten codes", "of the ten packs").
  The "and more" hedge goes with the number: that bullet enumerates all ten languages, so
  there is no more.
  
  The correction is the smaller half. A **restated** number is the construct that permitted
  the error, and correcting one in isolation has already failed to stop the next instance —
  objectui#3351 fixed the same off-by-one in a changeset file and nobody swept the README.
  So the count is now read off the document and compared against what the package exports,
  on two doors that must agree: the payload-free `BUILT_IN_LANGUAGE_CODES` a consumer of the
  entry gets, and the `builtInLocales` map behind the published `./locales` subpath.
  
  ⛔ No runtime behaviour changes, and the two sites that were already correct —
  `src/index.ts`'s `@packageDocumentation` and this manifest's `description` — are untouched.
- b1030c7: The record form now tells the user when a `visibleWhen` transition clears a field
  (objectui#8070, ruling letter A).
  
  Since `6a449fc49` a field whose own `visibleWhen` / `visibleOn` turns it
  invisible while it holds a value has that value cleared, so the server does not
  refuse the row over a column that is no longer on screen. That clear was silent:
  the field disappeared and nothing said a stored value went with it. The ruling
  on objectui#8070 ports the naming half of the objectui#6499 ruling to this
  surface, and the clear itself is unchanged.
  
  - When a transition clears one or more fields, the form raises one notice that
    names them by the labels the form draws, joined by the locale's
    `validation.formInvalidJoiner`, and says they no longer apply given the
    current values. A field that was already empty is not named (an unchecked
    two-state control counts as empty), and neither is the first render of a
    record, which only records the baseline.
  - The notice is published under the form's outcome-toast id. A later submit
    refusal replaces it, and the next attempt that passes client validation
    dismisses it, like the form's other outcome messages.
  - When a clear hides a second field whose `visibleWhen` reads the field just
    cleared, the notice names both. Any edit in between starts a new list.
  - `@object-ui/i18n` adds one key, `form.clearedOnHide`, to all ten packs. The
    form's built-in fallback table carries its `en` text for a form rendered
    without an `I18nProvider`.
- 6778809: Key the `type="number"` bad-input refusal — the FIFTH sentence of this class,
  and the only shared one — into the locale packs (objectui#8148).
  
  objectui#6755 ruled that a widget's OWN refusal sentence goes through
  `useFieldTranslation` + `FIELD_DEFAULTS`, and `320374d2a` applied that to
  `LocationField`'s residue arm as the fourth. The four already keyed are each one
  widget's. This one is not: a single literal in `widgets/numberBadInput.tsx`
  produced the sentence for `NumberField`, `CurrencyField`, `PercentField` and
  BOTH of `GeolocationField`'s boxes, through one hook, with five different
  example values.
  
  **The measured consequence is on the geolocation surface.**
  `GeolocationField` sits beside `LocationField`, whose three refusal sentences
  are all keyed, so on the same form two adjacent coordinate widgets refused bad
  input in two different languages — a language switch mid-screen, which reads to
  a user as a bug rather than as a missing translation.
  
  **The example stays a HOLE, and that is the authoring decision this card had to
  make.** Five different values reach the one sentence — `1234`, `1234.56`,
  `12.5`, `30.2741` and `120.1551` — so keying the example per widget would have
  meant five keys across ten packs, and each pack would then hold a decimal
  numeral it could legitimately re-punctuate. A pack writing `1234,56` reads as
  the `latitude, longitude` PAIR the adjacent widget's `fields.location.refusedFormat`
  asks for. With `{{example}}` filled by the widget in ASCII, no pack spells a
  digit at all, and all five values still reach the rendered sentence in every
  language. That property is pinned by name.
  
  **No behaviour moves.** The English value is byte-identical to the literal it
  replaces, so English and provider-less rendering are unchanged — verified
  through the rendered widget for all five boxes, under an `en` provider and with
  no provider at all. objectui#6780's own announce suite keeps every verdict it
  had; it now spells its expected English sentence locally, because the helper
  that composes it takes the widget's `t` and reads
  `fields.number.badInput` rather than building an English string on its own. The
  guard still announces without refusing, and the new key is bound from here on by
  `check:i18n-keys`, `check:i18n-drift` and `all-locales-key-parity` like its four
  siblings.
- 6e9a3d4: AI 搭建入口的空状态不再承诺 v1 拒绝的东西（objectui#8329）。
  
  `console.ai.empty.build.description` 和 `console.ai.empty.editApp.description`
  原本告诉用户「描述一个应用或流程 —— 我会起草对象、界面和自动化」。cloud 的 v1
  创作边界（ADR-0112）不含流程、动作、定时，模型会明确拒绝这类请求，所以这是入口
  处对用户做的一个会被打回的承诺。它是这个家族里最后一处 —— 起始 chip 的措辞
  （cloud#1984）和模型收尾的「后续你可以」（cloud#2022）已经修过。
  
  ⚠️ **十个语言包每一个都有自己翻译好的违规版本**，全部一并修正；组件里两处硬编码
  `defaultValue` 兜底也同步更新，否则任一语言包丢 key 时旧承诺会静默回归。
  
  未改动的是**手工**路径的文案（`home.build.subtitle`、Studio 落地页、导入时运行
  已有自动化、打包自动化运维、marketplace 分类）—— Studio 确实能建流程，那些承诺
  是真的。判据是「v1 的 AI 创作边界」，不是「automation 这个词」。
  
  回滚：ADR-0112 v2 加回流程/动作时，这两句与 chip 文案同一行回滚；测试里的
  `RETIRED` 映射存了十个语言包的原句。
- 309728c: A `user` reference that resolved to nothing is no longer rendered as a person
  (objectui#8434, routed from cloud#2074).
  
  `UserCellRenderer`'s first branch printed any primitive as plain truncated text
  under the comment *"Primitive value: just display the ID/username as text"*. On a
  `user` field the premise of that comment is wrong: `user` is a lookup specialised
  to `sys_user`, so a primitive arriving there means precisely that nothing turned
  the reference into a person. Printing it as displayable text rendered
  **"resolution failed" as "resolution succeeded"** — and, measured, the cell was
  **byte-identical** to what a `text` cell prints for the same string. The only
  difference from a resolved person was the *absence* of the avatar, which is a
  subtractive signal; a user who has never seen the avatar has no reason to read
  absence as failure.
  
  Such a cell now keeps the raw value **visible** and adds a stated affordance
  beside it: a muted marker glyph plus a sentence ("Unresolved reference: … was
  not resolved to a user", keyed as `detail.unresolvedReference` in all ten locale
  packs). The multi-value shape gets the same treatment, so a `user` field is not
  honest on one input shape and silent on the other.
  
  **The sentence is deliberately epistemic, not ontological.** This branch has two
  populations and the renderer cannot tell them apart — it has no resolver at all,
  unlike `LookupCellRenderer`: an unexpanded `sys_user` id is the *legitimate*
  stored form (`packages/core/src/utils/expand-fields.ts`: "a `user` column that is
  NOT requested for expansion comes back as a raw user id", objectui#2032), and a
  name written into the column is dirty data. A "not found" claim would be false
  for the first, so the affordance states only what is true of both: this screen
  did not resolve it.
  
  **Nothing else moves.** An expanded reference still renders avatar + name; a
  reference object carrying only an id still draws its avatar; `{}` still prints
  the coerced text (objectui#8596's boundary); the save-side `reference_not_found`
  refusal and the edit form are untouched — this change is display-only.
- aa08d7e: Route the `repeater` and `file` cell COUNT labels through i18n (objectui#8441).
  
  The `repeater` cell in the standard renderer table counted its rows with a hardcoded
  Chinese unit word. Two rules broke on that one literal: AGENTS.md #-1 (all user-facing
  text MUST be English) and, the half a translation to English would not have fixed, it
  bypassed i18n entirely — every reader on every locale read it, English ones included,
  beside the English siblings `[Vector]`, `[Grid]` and `FileCellRenderer` on the same
  detail page. It now reads `detail.repeaterItemCount` through `useFieldTranslate`, the
  channel this file already imported and four of its other cells already use.
  
  `FileCellRenderer` moves with it, to `detail.fileCount`. Its `count === 1 ? 'file' :
  'files'` was not a rule violation — it is English — but it was equally unlocalized and
  plural-safe for English only: `ru` has four plural categories and `ar` six, and a
  two-branch ternary can spell neither. Two adjacent cells answering one concept two ways
  is what the single channel closes. **English output is byte-identical**: `2 files`
  stays `2 files`, and the provider-less fallback is pinned byte-equal to the `en` pack.
  
  Both keys are REAL i18next plural families — base + `_one` + `_other` in all ten packs,
  not the two-sibling-key `xxxCountOne` shape. The base key is load-bearing (objectui#3863):
  i18next asks `Intl.PluralRules` for the one suffix a number needs and, finding no slot,
  walks `fallbackLng` to `en`, so without it a Russian reader gets English at counts 2-20.
  
  The `repeater` entry also stops being an inline arrow in `getCellRenderer`'s table and
  becomes a module-level component. That table is rebuilt on every call and both call
  sites resolve inside render, so an inline entry is a fresh component type per render:
  React would remount the cell and tear down react-i18next's language subscription with
  it. No export was added — the published surface is unchanged.
- 7c9145f: Fix the ChatDock AI usage indicator going blank against the single-pool AI usage
  endpoint (objectui#8524).
  
  The cloud `GET /api/v1/ai/usage` endpoint now answers `{ pool, breakdown }`: one quota
  pool, plus `breakdown`, a read-only split of that same pool into app-building (`build`)
  and data Q&A (`dataChat`). `useAiUsage` only read the retired per-meter
  `{ meters: { build, dataChat } }` answer, so it returned `null` and `AiUsageIndicator`
  rendered nothing, with no error.
  
  - `useAiUsage` reads `{ pool, breakdown? }` and only that shape. A missing `breakdown`,
    or one whose members are `null`, is a normal reading. Any other answer — the retired
    `{ meters }` one included — leaves `usage` `null` and now also sets `error`.
  - The hook's `AiUsageResponse` type is now `{ pool, breakdown? }`, with the new
    `AiUsageBreakdown` type for the split; `AiMeterUsage` keeps its fields and describes
    the pool.
  - `AiUsageIndicator` draws one ring from `pool`. When a `breakdown` member is a number,
    the popover lists it under the pool's row as a percentage of the pool, as text and
    never as a second ring. The upgrade / top-up button's test id is now `ai-usage-cta`
    (it was `ai-usage-cta-build` / `ai-usage-cta-dataChat`).
  - New locale key `console.ai.usage.breakdownTitle` ("Used so far") in every locale pack.
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
- b253c4e: The import wizard's "Download template" button now downloads the server's import template, an Excel workbook, instead of building a CSV of every field (objectui#9600).
  
  The old CSV listed every field the wizard was handed, including the system and read-only columns every object carries (created by, owner, and so on). The server strips those columns on import without an error, so a user who filled them in lost that data silently. The server's template (`GET /api/v1/data/:object/export?template=true`, objectstack 17.6.0) lists only the columns this caller can import. It marks required ones with `*`, adds dropdowns for select and boolean columns, and includes an instructions sheet.
  
  - **`@object-ui/types`: new optional `DataSource.downloadImportTemplate(resource)`**, resolving to the template file as a `Blob`. Additive. When a data source lacks it, no template is offered: there is no client-side fallback.
  - **`@object-ui/data-objectstack`: `ObjectStackAdapter.downloadImportTemplate(resource)`** sends `template=true` on the export route, on the same request path as `exportDownload`. When the client has a locale set (`getClient().setLocale`), the request carries it as `Accept-Language`, the way the import request does. The template's labels are written in the request's locale, and the import accepts a translated label only in its own request's locale, so the two requests must match.
  - **`@object-ui/plugin-grid`: `ImportWizard` offers the template** when its data source has `downloadImportTemplate` and the user can create records of the object (`usePermissions().can(object, 'create')`, the server's own gate). A 405 (object not open for import), a 403 (no create permission) and any other failure each show a message on the upload step, and no file is saved. The client-built CSV is deleted, with its helpers (`buildImportTemplateCsv`, `exampleForField`, `firstOptionValue`, `downloadTextFile`). The column mapping step is unchanged.
  - **`@object-ui/app-shell`**: the identity-import data source (`sys_user`) withholds `downloadImportTemplate`, because the server's template describes the generic import door, not the identity pipeline.
  - **`@object-ui/i18n`**: `grid.import.downloadTemplateHint` describes the Excel template in all ten packs, and `grid.import.templateDownloadFailed` and `grid.import.templateNotPermitted` are new.
- 44152c4: Full-page search now agrees with its own number while browsing: at exactly one
  searchable item the header reads `1 item available`, not `1 items available`
  (objectui#9664).
  
  The header is one ternary with two branches. The query branch already chose its
  key on `totalCount === 1` — `search.resultsCount` against
  `search.resultsCountPlural`. The browse branch beside it asked for
  `search.itemsAvailable` at every count, and that key had neither a plural family
  nor a sibling to fall to, so `en` shipped the disagreement in the default
  language; `de`, `es`, `fr` and `pt` read the same way (`1 Elemente verfügbar`,
  `1 elementos disponibles`, `1 éléments disponibles`, `1 itens disponíveis`).
  
  `search.itemsAvailableOne` is the singular half, added to all ten packs, and the
  browse branch now picks between the two on `allItems.length === 1`. That is this
  repo's two-key plural convention — the one `common.itemCount`/`itemCountOne` and
  `detail.reactionCount`/`reactionCountOne` already use — and deliberately not an
  i18next `_one`/`_other` family: full key parity across ten packs caps a family at
  base plus `_one` plus `_other`, so every CLDR category a pack does not spell out
  falls through to the base key, which on this key is the plural. Russian meets
  that at 2 to 4 and Arabic at 2, 3 to 10 and 11 to 99. Choosing the key in the
  component keeps `Intl.PluralRules` and `fallbackLng` out of the path: both halves
  exist in every pack, so no count in any language can reach English.
  
  `zh`, `ja` and `ko` carry the same string in both halves because the counter word
  holds the number and there is no separate singular form; `ru` does too, because
  its phrasing states no noun to agree with.
  
  One translation changed rather than being added: `ar` wrote both numbers into one
  string as a parenthesised marker. Its key can no longer be reached at one item, so
  the singular half of that marker was dead weight while the parentheses still
  rendered at every count the key does serve. It now reads as a singular noun at one
  item and as a count label at every other count, the shape `ar`'s
  `common.itemCount`/`itemCountOne` uses (objectui#10425).
  
  ⚠️ **Dated note, 2026-10-02 — superseded in this release — objectui#11445.**
  Later in this same release the `search.itemsAvailable` / `search.itemsAvailableOne`
  switch gave way to a `search.itemsAvailable` count family in all ten packs: the
  browse branch calls the family key with `{ count }`, each pack spells every CLDR
  category its language selects (so the base-key fall-through described above no
  longer arises), and `search.itemsAvailableOne` left every pack. The rest of this entry is kept as the reading of this change.
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
- bc5870c: fix(plugin-calendar): a record with no date is no longer placed on today
  
  `ObjectCalendar` mapped a record whose declared `startDateField` carried no
  value to `new Date()` — the current moment — so it rendered on today's cell as
  an ordinary event, indistinguishable from a real one. The `isNaN` guard six
  lines below could not catch it by construction: a no-argument `new Date()` is
  always valid, so the absent-value case became a well-formed lie *before* the
  check that would have caught it.
  
  The fabricating arm is deleted. Such records now leave the grid entirely and
  appear in a collapsed "Unscheduled (N)" area below the calendar — a visible
  count and an expandable list, with no invented date and no scheduling UI. The
  `isNaN` filter keeps its original job for values that are present but
  unparseable: absent and malformed stay two distinguishable outcomes.
  `allDay: !endDate` now applies only to records that have a start, so a record
  with no dates at all is unscheduled rather than silently all-day; a record with
  a start and no end still renders all-day exactly as before.
  
  Adds `calendar.unscheduled` to all ten locale packs.
- f760064: Localize every accessible name `CalendarView` authors itself.
  
  The component hard-coded the accessible names of its own landmarks and controls
  in English, so no locale pack could reach them. A screen-reader user on a
  translated console heard "Calendar" and "Calendar grid" — the only names those
  two landmarks have — plus the toolbar buttons and both resize grips, in English,
  while every sighted string beside them was translated.
  
  All of them now resolve through the `createSafeTranslation` hook the component
  already used for its visible copy, and the keys land in all ten locale packs
  under `calendar.a11y`. Two of the repaired strings were English frames wrapped
  around already-localized data (the current-date button and the day gridcell's
  event count); those are now pack-owned sentences whose translations can put the
  date and the count where each language's grammar wants them, and the gridcell's
  count is a plural family with a base key so the categories a pack does not
  enumerate resolve in its own language rather than falling through to English.
- 8ea3bee: fix(plugin-chatbot): localize the build-progress panel, which was an English island (objectui#7388)
  
  Every label the build panel is HANDED was already localized — the host passes
  `openBuiltAppLabel`, `designBuiltAppLabel`, `previewDraftLabel` and the three
  connection cues through its own `t()`. Every string the panel OWNED was a
  literal in the component, so a fully Chinese conversation watched its app get
  built under `Building your app…`, over `Objects` / `Views` / `Dashboards` /
  `App` / `Sample data` row headings — one per row, on every build — and a
  `+N more` overflow counter.
  
  All of them now resolve through the console's pack as `chatbot.build.*`, added
  to all ten locales. Behaviour for a known phase is unchanged in English, and
  the unknown-artifact-type fallback still renders the raw type rather than a
  raw i18n key.
- 3a58149: A cloud-connection bind failure now reads in the user's language whichever clock
  noticed it (objectui#5054).
  
  One abandoned device approval could be noticed by either of two clocks, and the
  Cloud Connection panel had a different answer for each. When the panel's own
  `expires_in` deadline fired first it rendered `cloudConnection.errors.expired` —
  translated in all ten packs. When the SERVER noticed first, `/bind/poll` answered
  HTTP 400 with `message: 'Device authorization failed: expired_token'`; `getJson`
  threw a bare `Error` carrying only that sentence, and the catch rendered it
  verbatim. Same user, same failure, two languages, decided by which clock got
  there first — visible on a zh console as the same abandoned approval reading
  Chinese or English depending on whether the tab sat open past `expires_in`.
  
  `getJson` now carries the envelope's `declaredCode` and `code` across its throw,
  and a single closed map turns the two RFC 8628 outcomes a user can actually cause
  into console copy: `expired_token` → the existing `cloudConnection.errors.expired`,
  `access_denied` → a new `cloudConnection.errors.accessDenied` added to all ten
  locale packs. `declaredCode` is read first, because ADR-0112 keeps the upstream
  spelling there — `code` is `DEVICE_CODE_FAILED` for both.
  
  Every other code is unchanged: `invalid_grant`, and anything upstream invents
  next, still render the wire `message`, which stays the single source of truth for
  failures this console has no copy for. No API, export or resolver was widened.
- 6ce89da: The 确认修改 (confirm changes) card now carries a UI-owned terminal state after approval (#5695): `detectReplayOutcome` lifts the confirm-replay envelope (`replay_*` tool results) into 应用中 / 已生效 / 已暂存为草稿（含内联发布）/ 未生效（含 publishError 首行）, rendered on the original card across the live, hydration/share, and localStorage-cache converters. A failed in-turn publish no longer rehydrates as an ordinary draft card with a live Publish button — the UI-rendered refusal is the layer a model cannot narrate over. New `console.ai.changesApplying/Applied/Drafted/Failed` keys in all ten locale packs.
- de570cc: fix(i18n): `useObjectTranslation`'s provider-less `t` now interpolates its inline `defaultValue`
  
  With no `I18nProvider` mounted, react-i18next hands back its not-ready `t`, which
  returns `options.defaultValue` **verbatim** — so an inline default written
  `'Deleted {{count}} rows'` reached the user with the braces intact. 68 inline
  defaults across 24 files rendered through that path on any host that embeds an
  ObjectUI component without a provider, which is the configuration
  `createSafeTranslation` exists for.
  
  `useObjectTranslation` now runs its not-ready result through the same one
  interpolator `createSafeTranslation`'s `fallbackT` uses, so both provider-less
  renderers fill exactly the `{{name}}` spelling the copy is already gated to. The
  ready path is untouched: with a provider, i18next's own `t` is returned by
  reference and nothing is interpolated twice. Pre-interpolated template-literal
  defaults (`` `Deleted ${n} rows` ``) stay correct — they have no holes left to
  fill — so no call site changes.
- 1e66879: `console.ai.pendingDrafts` — the standing unpublished-changes bar's five strings —
  now exists in all ten locale packs. It previously existed only in `en` and `zh`, so
  `ar`, `ru`, `pt`, `es`, `fr`, `de`, `ko` and `ja` rendered the English defaults and
  `all-locales-key-parity` failed on `main` (objectui#5705).
  
  The feature landed `en`-only in objectui#5696; the follow-up in objectui#5697 was
  titled for the locale packs but reached only `zh`, so eight packs × five keys stayed
  missing and the parity assertion — which carries no allowlist — was red on `main` and
  on every PR whose diff touched source. Source-free diffs skip the shard that runs it,
  which is why the breakage survived several merges.
  
  Each pack keeps its own conventions rather than `en`'s: the eight all quote with `"`,
  `ru` puts the number last (`…: {{count}}`) as it already does for the sibling
  `home.pendingDrafts` counts, and `ja` uses the full-width `：` before `{{detail}}`
  because that value is a runtime message rather than a single token — both choices
  carry an in-pack note. Terminology is taken from each pack's existing publish-bar
  vocabulary (`home.pendingDrafts`, `console.ai.seedWarn`) so the two banners read
  alike.
  
  Both interpolations survive verbatim in every pack — `{{count}}` in `count` and
  `{{detail}}` in `publishedWithFindings` — asserted mechanically against the evaluated
  packs, not by eye. The unrelated `home.pendingDrafts` block (`message` / `cta`) is a
  different node and is untouched.
- c5200f0: Follow-up to #5696: the pending-drafts bar's strings live at `console.ai.pendingDrafts.*` with en+zh locale entries — the i18n call-site key gate and ratchet flagged the original root-level keys that existed nowhere.
- fd8dace: Studio surfaces the runtime authoring gate's advisory findings after a **publish**, not only after a save
  
  objectui#4133 / PR #4236 wired the gate's advisories to the save door and recorded, honestly, what that left unsurfaced: Studio's designer stages every edit as a `mode: 'draft'` save, drafts are never gated (the framework returns at its D1 early-return before a single rule runs), and the publish step that *is* gated returned no `advisories` field at all. So on the flow most tenants actually use, the author was told nothing at either door — for two different reasons, only one of which was objectui's.
  
  The second reason has expired. `PublishMetaItemResponseSchema` now declares the same optional, omitted-when-empty `advisories` key that `SaveMetaItemResponseSchema` has carried since #4717, and `publishMetaItem` populates it. Measured against the installed `@objectstack/spec` (17.2.0) rather than inferred from the version number: the key survives a `safeParse`, a half-shaped finding is rejected, and a clean publish omits the key entirely. That reading is now a test rather than a note, so a spec drift fails CI instead of silently re-muting the door.
  
  ⚠️ **Dated note, 2026-09-29 — the save response's advisories key came from an objectstack card — objectui#11016.** The
  paragraph above dates the save response's `advisories` key by a bare number,
  which in this repository resolves to an unrelated objectui item. It is
  objectstack-ai/objectstack#4717, the card that put the runtime authoring gate's
  advisory findings on the response. The text above is kept as the reading of this change.
  
  `MetadataClient.publish` and `MetadataClient.publishDraft` — the two methods over the single-item publish route `POST /meta/:type/:name/publish` — now report through the **same** sink, the same event and the same renderer the save door already used. No new UI shape: same warning tier, same 10s duration, same per-finding `rule` + `message` + `hint` formatting, findings still rendered verbatim as server prose. The wiring lands in the data layer rather than at the call sites, so `ResourceEditPage`'s Publish button and the runtime `RuntimeDraftBar` promotion (ObjectView / ReportView / DashboardView) are covered by one change, as are future ones.
  
  One thing had to differ, and it is the frame's verb. Save and Publish are two different buttons in this product, so a toast that says "Saved" after a Publish tells the author their change is still a draft — the opposite of what happened. `MetadataSaveAdvisoryEvent` therefore gains a required `door: 'save' | 'publish'` and the renderer picks `console.publishAdvisoryTitle` (added to all ten locale packs) accordingly. `door` exists because `mode` cannot answer this: a direct active save and a draft promotion both report `mode: 'publish'`, since both land the body in the active overlay. It is required rather than optional so a future third door cannot be wired without saying which one it is, and the renderer branches on it through an exhaustive switch with a `never` check, so adding a third member is a compile error rather than a silently wrong verb.
  
  **BREAKING for event constructors — `MetadataSaveAdvisoryEvent.door` is required.** Reading the event is unaffected: a listener that ignores `door` behaves exactly as before, and every other member is unchanged. Constructing one is a compile break — a door-less event literal that type-checked before now fails with TS2741, `Property 'door' is missing`. Measured on the emitted `dist/index.d.ts` of `@object-ui/data-objectstack` on both sides: that single required member is the entire non-comment delta of the package's published surface. **Migration:** add `door: 'save'` or `door: 'publish'` to the literal, whichever write it models — `'save'` for `PUT /meta/:type/:name`, `'publish'` for `POST /meta/:type/:name/publish`. Scored `minor` rather than `major` per the repo's version policy: objectui's major is pinned to `@objectstack`'s so that "same major means compatible" holds across the two repos, so objectui's own breaking changes ship as `minor` with the break named here (`scripts/check-changeset-no-major.mjs`). Every publishable package sits in one `fixed` group, so this entry carries the group.
  
  Unchanged, deliberately: the **batch** door. "Publish whole app" (`POST /packages/:id/publish-drafts`) discarded per-draft advisories server-side when this change was written — objectstack#9343, open and unruled at the time — and nothing here compensated for that from the client side. A test pinned the absence, so a later traversal of a batch-shaped `published[]` could not be added without turning it red.
  
  *Corrected before release (`ce986aafc`): both present-tense claims in the paragraph above went false after it was written — objectstack#9343 landed, the batch response now carries per-draft advisories, and `ce986aafc` routes that door through the same seam and flips the absence pin to a presence pin. The paragraph is kept in the past tense as the record of what this change did and did not do; this note is what the CHANGELOG publishes instead of a sentence that was true only while it sat here.*
- 38a9568: `useObjectLabel` now keeps a stable identity when no i18next instance is bound,
  so the memoization it advertises holds on the no-provider path too
  (objectui#5564).
  
  react-i18next's `useTranslation` builds its return value out of a fresh `{}` on
  every render when it has nothing to bind to (`const finalI18n = i18n || {}`,
  which then feeds that hook's own `useMemo` deps), so the `i18n` object arrived
  with a new identity each render. `useObjectLabel` keyed its memo on `[t, i18n]`,
  so the memo never held: measured 4 distinct returned objects across 4 renders
  with no instance, against 1 with one. That is the wrong way round — the memo
  exists to stop downstream `useMemo`/`useCallback` deps from being re-keyed in
  heavy consumers, and `useSafeFieldLabel`'s docstring names the no-provider case
  as the one it exists to serve.
  
  Both memo dependencies are now pinned to module-level constants while no
  instance is bound. The substitution is unobservable rather than merely
  convenient: every `t()` call in the module sits inside a
  `for (… of getAppNamespaces())` loop, and `getAppNamespaces()` returns `[]`
  under exactly the same "is there a usable instance" predicate — so while the
  substitution is in effect, the closures cannot read either value. When an
  instance appears the dependencies become the live values again, so a provider
  mounting after first render recomputes the object exactly once and resolves
  real translations from then on.
  
  No API change: no new exports, no signature changes, and the returned surface is
  identical on both paths. Direct `useObjectLabel()` consumers are fixed alongside
  `useSafeFieldLabel()` ones, including `ListView.filterFields` — the consumer the
  memo's own docstring names.
- b2437a7: `setLocalized`'s published docblock states the single-locale write rule that is
  actually in force, instead of deferring the multi-locale-authoring question to a
  closed card (objectui#5591).
  
  The docblock read "is not a multi-locale authoring UI (objectui#4163)". objectui#4163
  closed as completed on 2026-08-15 with that product question still unanswered, so the
  parenthetical pointed at nothing — and it read as though the question had been settled
  somewhere a reader could go and check. This is the failure mode objectui#5428
  demonstrated is not harmless: there, a dangling deferral of exactly this shape let an
  expired justification sit unread for a release cycle at two surfaces.
  
  The remedy is objectui#5428's, not a re-pointing at a successor card: state the rule in
  force (`setLocalized` reaches only the entry for the locale the author is in), keep the
  open product question open **in place**, and record why there is deliberately no tracker
  reference — so the next reader cannot restore one. Re-pointing is how the class
  regenerates, because the next card closes too. The same wording form already landed in
  `plugin-designer`'s `writeWidgetTitle` and `DashboardWidgetInspector`.
  
  Prose only. No behaviour, no signature, no test changes — `setLocalized`'s pairing with
  `pickLocalized` is unchanged and still pinned by `src/__tests__/setLocalized.test.ts`.
  
  Declared as a `patch` for `@object-ui/i18n` alone because the emit was measured per
  package rather than assumed, and the two packages this change touches differ:
  
  - `@object-ui/i18n` — the docblock sits on the **exported** `setLocalized`, so it reaches
    the published artifacts. Rebuilt with `tsconfig.tsbuildinfo` cleared first (the build is
    `composite`, which otherwise skips emit), and compared by SHA-256 rather than byte count:
    `dist/pickLocalized.d.ts` `1e2170ad…` -> `124a1c07…` and `dist/pickLocalized.js`
    `06eb88bd…` -> `568cb703…`. A consumer reads this text on hover and in the API docs, so
    it publishes something.
  - `@object-ui/plugin-dashboard` — the two comments changed there are a `//` banner between
    declarations and a test docblock, neither attached to an exported declaration.
    `dist/WidgetConfigPanel.d.ts` is **byte-identical** across the rebuild
    (`93252e8cdf5a6faa…` both sides). The only artifact that moved is
    `dist/WidgetConfigPanel.d.ts.map`, whose mappings shift because lines were added above
    the declarations; no declaration text changed. Nothing user-visible publishes from that
    package, so it is not named here.
- eddc1dd: The Studio copilot tells the agent WHAT the user is discussing (cloud#1610 send half): `ChatPane` accepts a `surfaceContext` and sends it as `context.surface` on every turn (the transport reads the body per send, so it stays fresh); the Studio copilot derives it from the URL alone — the `:tab` pillar segment plus the `?surface=type:name` deep-link the pillars already mirror, so the artifact carries its type discriminator (page/object/dashboard/report). A display chip above the composer (「正在讨论：…」, new `console.ai.discussing` key in all ten packs) makes the sent context visible instead of invisible grounding.
- Updated dependencies [97abedc]
- Updated dependencies [ad694ac]
- Updated dependencies [c131d9e]
- Updated dependencies [7b395d8]
- Updated dependencies [8cedb0d]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [4ab4f1b]
- Updated dependencies [961ceaa]
- Updated dependencies [544aca2]
- Updated dependencies [86982ac]
- Updated dependencies [ff14e29]
- Updated dependencies [64563a9]
- Updated dependencies [8acc51b]
- Updated dependencies [3261e64]
- Updated dependencies [6c2f3c5]
- Updated dependencies [9a5f998]
- Updated dependencies [4758b33]
- Updated dependencies [baac95a]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [30b11ad]
- Updated dependencies [3d6badf]
- Updated dependencies [990a2d6]
- Updated dependencies [6650259]
- Updated dependencies [9e6619f]
- Updated dependencies [b2683a2]
- Updated dependencies [328abeb]
- Updated dependencies [e227156]
- Updated dependencies [6cd8f66]
- Updated dependencies [63ab761]
- Updated dependencies [ae582b7]
- Updated dependencies [f61dab1]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [76e9df0]
- Updated dependencies [6158e4c]
- Updated dependencies [bf43afa]
- Updated dependencies [858eafb]
- Updated dependencies [58da8ae]
- Updated dependencies [138ad45]
- Updated dependencies [5638529]
- Updated dependencies [c476be0]
- Updated dependencies [063119f]
- Updated dependencies [f9c8c4e]
- Updated dependencies [83e3f83]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [aea682a]
- Updated dependencies [64dae8e]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [053fdc8]
- Updated dependencies [ae476b8]
- Updated dependencies [490d9a9]
- Updated dependencies [2c3cd1b]
- Updated dependencies [546ddf7]
- Updated dependencies [44d075b]
- Updated dependencies [a26b9e4]
- Updated dependencies [06b82b8]
- Updated dependencies [8f1d995]
- Updated dependencies [3c2b6f7]
- Updated dependencies [5961030]
- Updated dependencies [299102e]
- Updated dependencies [831be72]
- Updated dependencies [d0889e2]
- Updated dependencies [4d5f9b4]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [2acd8e1]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [3619792]
- Updated dependencies [9e37d9b]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [47547d0]
- Updated dependencies [cfc9b6d]
- Updated dependencies [81a2eb1]
- Updated dependencies [00d2fa6]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [1237ae4]
- Updated dependencies [feac439]
- Updated dependencies [e62c44e]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [aef97e5]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
- Updated dependencies [335abea]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [fc32921]
- Updated dependencies [8f9d87a]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [317dbce]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [abc1b18]
- Updated dependencies [fb3a101]
- Updated dependencies [f391ede]
- Updated dependencies [f5cfbbd]
- Updated dependencies [f5cfbbd]
- Updated dependencies [64c3cdd]
- Updated dependencies [4d65991]
- Updated dependencies [0a174f3]
- Updated dependencies [d1865d2]
- Updated dependencies [561abef]
- Updated dependencies [abf710d]
- Updated dependencies [c372b29]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [19a0b0e]
- Updated dependencies [f8e3e9a]
- Updated dependencies [3b6bc69]
- Updated dependencies [804831c]
- Updated dependencies [da45e6b]
- Updated dependencies [835f0f3]
- Updated dependencies [ed35b44]
- Updated dependencies [729e851]
- Updated dependencies [20b507a]
- Updated dependencies [72d6587]
- Updated dependencies [ba0b61a]
- Updated dependencies [ab856ed]
- Updated dependencies [43c0d17]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4a7ef0d]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [05a49f2]
- Updated dependencies [a78cd37]
- Updated dependencies [5eabe86]
- Updated dependencies [ff5ef1c]
- Updated dependencies [81c0bc4]
- Updated dependencies [60500cb]
- Updated dependencies [6791717]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [fa429cf]
- Updated dependencies [8e74b27]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [105f3c5]
- Updated dependencies [42df928]
- Updated dependencies [af3861f]
- Updated dependencies [1f4e029]
- Updated dependencies [c00bf28]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [a51fa0c]
- Updated dependencies [6c6cee7]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [91783c4]
- Updated dependencies [ca39427]
- Updated dependencies [2d36552]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [92814db]
  - @object-ui/core@17.7.0

## 17.6.0

### Minor Changes

- deb157a: Retire the field designer's `Indexed` toggle — the ObjectStack spec has no
  field-level index flag
  
  `indexed` was never a `FieldSchema` key. The field-level flag built no index
  (objectstack#2377 removed it) and, since objectstack#4001 replaced silent
  drops with loud rejection, `FieldSchema.safeParse` refuses it by name. Ticking
  `Indexed` in Studio therefore made `PUT /api/v1/meta/object/:name` fail with
  `422 INVALID_METADATA`, and — because the key was stored — every later save of
  that object stayed blocked until the author found and cleared the toggle.
  
  Both field designers stop offering the control and stop authoring the key
  (`ObjectFieldInspector`'s Advanced section; `FieldDesigner`'s advanced
  section, `MetadataFieldsPage`, `MetadataService`, `metadataConverters`), the
  `designer.field.indexed` / `appDesigner.fieldDesigner.indexed` labels retire
  with it across all ten locale packs, and `DesignerFieldDefinition.indexed` is
  removed from `@object-ui/types`.
  
  Drafts and objects that already carry the key are un-poisoned on load rather
  than migrated, so an edit-and-save round-trip of previously blocked metadata
  now succeeds. The strip is keyed to the retired key alone — every other
  unknown key on a field definition still survives the round-trip.
  
  Declare indexes on the object instead: `indexes: [{ name, fields, unique }]`.
- 9c60144: **Breaking (published API):** `NavigationRenderer` no longer accepts `resolveGroupLabel` or `resolveItemLabel`. If your build just broke on one of these props, delete the prop — it never did anything.
  
  Both were id-keyed label resolvers on `NavigationRendererProps` (`@object-ui/layout`), typically wired to `useObjectLabel().navGroupLabel` from `@object-ui/i18n` to translate sidebar group and leaf labels from a client translation pack keyed `{ns}.apps.{appName}.navigation.{nodeId}.label`.
  
  **They could never fire.** The renderer guards convention-based resolution with `isCustomized` — a case-insensitive "the authored label differs from this branch's comparison target" test. On the `object` / `dashboard` branches the target is the object or dashboard name, and the test is meaningful: it protects an author's custom label (`Projects`) from being overwritten by an `objects.project.label` translation. On the two id-keyed branches the target was the nav node's own **`id`** — `grp_workspace`, `group_sales` — while the label was its text — `Workspace`, `Sales`. Those never compare equal, so the guard was true for every real navigation entry and the resolver beneath it was unreachable. The only node that could have reached it is one whose label is literally its own id.
  
  Nothing regresses when they go, because nothing was using them to begin with: **app-navigation localization is owned solely by the server-side `/meta` boundary.** `translateApp` (`@objectstack/spec`, `src/system/i18n-resolver.ts`) rewrites every navigation node's `label` by id, and `@objectstack/rest` applies it before the metadata reaches the client — so nav labels arrive already localized and the client-side path was never the one answering. One owner, not two.
  
  **If you wired these hooks to localize navigation, your labels were never being localized by them.** Move the translation to the server side: add it to the app's i18n bundle that `translateApp` reads, keyed by navigation node id. A client-side pack keyed `apps.*.navigation.*.label` changes nothing in the sidebar.
  
  Also in this change:
  
  - `useObjectLabel().navGroupLabel` (`@object-ui/i18n`) is **kept**, but its docstring no longer promises `"Sales" → "销售"` for sidebar groups — that promise was false, and a live docstring describing an unreachable path is how an agent or a developer ends up wiring a translation pack and receiving silent non-localization. It is now documented for what it is: a plain reader for `{ns}.apps.{appName}.navigation.{groupId}.label` with no first-party caller, pointing at the server boundary for anything nav-related.
  - `UnifiedSidebar` (`@object-ui/app-shell`) drops the two prop wirings, including a `studio` carve-out that existed only to stop `resolveItemLabel` from re-translating an already-translated "Package management" label.
  - The `object` / `dashboard` / `viewName` branches — `resolveObjectLabel`, `resolveDashboardLabel`, `resolveViewLabel` — are untouched and keep both their resolvers and the `isCustomized` guard.
- b8ce7dc: Show the current organization in the console top bar for users with exactly one
  membership.
  
  `WorkspaceSwitcher` is a multi-membership affordance — with one organization
  there is nothing to switch to, so it renders nothing — and it was also the only
  place the console ever displayed the organization name. On a deployment whose
  tenancy posture puts an organization wall in force (`isolated` or `group`), that
  left a single-membership business user with no indication anywhere of which
  organization they were looking at, while every list on the page was silently
  scoped to it. Found in a downstream multi-tenant acceptance run.
  
  The new `CurrentOrganizationIndicator` renders the active organization name
  read-only — no trigger, no menu, no click target — in exactly the case the
  switcher declines. The switcher's own visibility rule is unchanged, and
  deployments without an organization wall (`single` posture, or a server that
  reports no posture at all) render nothing new: the top bar stays
  organization-silent where organizations are not a scope the user is inside.
  
  Adds one translated string, `organization.current.label`, in all ten packs.

### Patch Changes

- 69251bf: `AddressField` is translatable, shows no US example placeholders, and formats its readonly line in the reader's address order.
  
  The five sub-labels ("Street Address", "City", "State / Province", "ZIP /
  Postal Code", "Country") were English string literals with no i18n key. On a
  non-English console every address field showed five English words in the middle
  of an otherwise fully translated form, and an app had no way to reach them: the
  parts are not fields on the object (`billing_address` is a single `address`
  column), so a translation bundle had nothing to key on, there is no `subLabels`
  property to declare, and the widget cannot be replaced from metadata. They now
  resolve through `fields.address.street` / `.city` / `.state` / `.postalCode` /
  `.country`, added to all ten locale packs. The `en` values are byte-identical to
  the literals they replace, and `FIELD_DEFAULTS` carries the same five, so
  English and provider-less rendering are unchanged.
  
  The five input placeholders (`123 Main St`, `San Francisco`, `CA`, `94102`,
  `United States`) are **removed** rather than keyed. They were untranslated and
  US-specific — a zh/ja/ar user was shown an American address as the example of
  what to type — and the right example is a function of the address's country,
  not the reader's language, which no channel in the stored value can supply
  today. Each box keeps the visible label that names it.
  
  The readonly line's part order now follows the reader's display locale
  (`useDisplayLocale()`): `zh`, `ja` and `ko` read largest-first (`Country, ZIP
  State, City, Street`), every other locale keeps the unchanged small-to-large
  order (`Street, City, State ZIP, Country`). The display cell renderer takes the
  same locale through the same shared `formatAddress`, so a stored address reads
  identically in a readonly form and in a grid cell.
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
- 516663d: RecordAttachmentsPanel no longer offers a Retry for an api-disabled `sys_attachment` read.
  
  `OBJECT_API_DISABLED` (404, `enable.apiEnabled: false`) and its sibling
  `OBJECT_API_METHOD_NOT_ALLOWED` (405, the operation is absent from
  `enable.apiMethods`) are pure functions of the object's metadata — no user, no
  session, no request body — so every retry of every persona re-fetches the
  identical refusal. Before this change both landed in `RecordAttachmentsPanel`'s
  `unavailable` state and offered a Retry that was guaranteed to change nothing,
  the same wrong advice `ListView`'s error panel already stops giving for list
  reads.
  
  The panel gains a fifth status, `api-unavailable`: no Retry button, and honest
  copy ("The attachments list is not available on this object.", new
  `detail.attachmentsApiUnavailable` key in all ten locale packs) instead of
  "We couldn't load the attachments for this record." The pre-existing `denied`
  (authorization) and `unavailable` (network/5xx/expired-session) states and
  their affordances are unchanged.
  
  `ListView.classifyLoadError` — the classifier that already separated this case
  into its own `api-disabled` kind for list views — is lifted out of
  `packages/plugin-list/src/ListView.tsx`'s module scope into
  `@object-ui/react` (`classifyLoadError`, `LoadErrorKind`), so both surfaces
  consume one classification instead of `RecordAttachmentsPanel` re-deriving it.
  `ListView`'s own behavior is unchanged — it now imports the function it
  previously defined locally. The classifier delegates its api-disabled check to
  `isApiAccessDeniedError` (`@object-ui/data-objectstack`), removing a second,
  independently-maintained copy of the same code list.
- 41ac1b7: RecordAttachmentsPanel distinguishes a DENIED attachment list from an empty one.
  
  A `sys_attachment` list read refused for authorization reasons (HTTP 403 /
  `PERMISSION_DENIED` / `FORBIDDEN` / a row-level-security denial) was swallowed
  into the panel's empty state, so a member denied the parent record was told
  "No attachments yet. Upload a file to get started." about a record holding
  2095+ attachments — and was offered an Upload the server would refuse.
  
  The panel now classifies that refusal with the same `isPermissionError`
  predicate the kanban, calendar and form surfaces branch on, renders a distinct
  denied state ("You don't have access to these attachments.", new
  `detail.attachmentsAccessDenied` key in all ten locale packs), and withdraws
  the Upload affordance. The denied state renders the translated sentence and
  nothing sourced from the error — no status code, no server text, no row count.
  The empty state is now reserved for a genuine 200-with-zero-rows; non-authz
  failures keep their pre-existing handling.
- 1eaf0a1: RecordAttachmentsPanel distinguishes an UNLOADED attachment list from an empty one.
  
  A `sys_attachment` list read that failed for any non-authorization reason — a
  network failure (server unreachable, DNS, aborted request), a 5xx, or a 401 /
  `AUTH_REQUIRED` (an expired session is authentication, not authorization, so the
  denied predicate deliberately does not claim it) — was swallowed into the
  panel's empty state. All three rendered "No attachments yet. Upload a file to
  get started.": an affirmative claim about the record's contents, made by a panel
  that never got an answer, over a record that may hold thousands of files.
  
  The panel now carries the same four-way status vocabulary its siblings use —
  `loading` / `loaded` / `denied` / `unavailable` — and every state that means
  "the panel does not know" is answered before `rows.length === 0` is allowed to
  mean "the record holds nothing". A failed read renders a distinct unavailable
  state ("We couldn't load the attachments for this record.", new
  `detail.attachmentsLoadFailed` and `detail.retryLoadAttachments` keys in all ten
  locale packs) with a **retry** — unlike the denied state, an outage and a lapsed
  session are both things a second attempt can fix — and withdraws the Upload
  affordance, because offering an upload against a list the panel could not reach
  is the same over-assertion as the empty state it replaces. Like the denied
  state, it renders the translated sentence and nothing sourced from the error: no
  status code, no server message, no host.
  
  The empty state is now reserved for a genuine 200-with-zero-rows, and the
  denied state (403 / `PERMISSION_DENIED` / `FORBIDDEN` / a row-level-security
  denial) is unchanged. The "table not provisioned on an older stack" case is
  unaffected: the ObjectStack adapter degrades a bare 404 to `{ data: [], total: 0 }`,
  so it resolves through the success path and still renders the empty state.
  
  This restores a house rule that had already landed twice as a bug fix —
  `HomeActionCenter` may only say "You're all caught up" once the inbox has
  answered, and an unloadable app list is UNKNOWN rather than "no default app".
- 2e82ab2: The config panel footer translates: `ConfigPanelRenderer`'s Save / Discard labels come from the locale pack.
  
  `saveLabel` and `discardLabel` carried the English literals `'Save'` and
  `'Discard'` as parameter defaults, and no caller in the repo passes either prop,
  so the sticky footer that appears the moment a config draft is dirty stayed
  English in every locale — inside panels whose every other string had already
  been routed through `t()`. The fix is in the renderer rather than per-caller:
  the footer is the renderer's own chrome, so a caller-side fix would translate
  one panel's footer and leave the next host's English.
  
  Both labels now resolve through `createSafeTranslation` — the mechanism this
  package already uses for its built-in copy in `form.tsx`,
  `fullscreen-editor.tsx`, `data-table.tsx` and friends. An explicitly passed
  `saveLabel` / `discardLabel` still wins, unchanged and untranslated.
  
  `common.save` is reused rather than twinned: it already ships `Save` in all ten
  packs and is what the console's other save buttons read. `common.discard` is
  new, because the packs carried no shared spelling of the word — the three that
  existed are each scoped to one surface (`form.discard`,
  `console.settingsView.discard`, `console.objectView.discard`) and the last of
  them diverges from the other two in zh/ko/fr. Its ten values are the majority
  spelling, byte-identical to `form.discard` and `console.settingsView.discard`.
  
  Both English defaults are byte-identical to the literals they replace, so a
  host that mounts no `I18nProvider` renders exactly what it did before.
- ef0d150: The dashboard config sidebar translates: `WidgetConfigPanel` and `DashboardConfigPanel` are wired through `t()`.
  
  Both panels build a `ConfigPanelSchema` — breadcrumb, section titles, field
  labels, placeholders, help text and option labels — and neither imported a
  translation hook at all, so all 61 of their user-visible strings were English
  literals. Both are exported from the package barrel and mounted by
  `DashboardWithConfig` as the dashboard editing sidebar, so a user on any
  non-English console opened a panel that stayed English inside chrome that had
  translated around it.
  
  They now resolve through a new `dashboard.config.*` namespace — 75 keys, added
  to all ten locale packs. The namespace sits beside `dashboard.trend.*` and
  `dashboard.filters.*`, which is where this package's other translated surfaces
  already read from, and the panels reach it through
  `useConfigPanelTranslation`, a `createSafeTranslation` hook whose
  `CONFIG_PANEL_DEFAULT_TRANSLATIONS` map carries the English defaults for hosts
  that mount no `I18nProvider`.
  
  The keys are authored fresh against the wording the panels actually ship rather
  than restored from the retired `configPanel.*` block: that vocabulary had no
  reader, was never validated against a shipped label, and covered 16 of the 61
  strings. Where the two name the same word the translations are reused.
  
  Every `en` pack value and every built-in default is byte-identical to the
  literal it replaces, so English rendering and provider-less rendering are
  unchanged — asserted row by row, in both directions, against a frozen table of
  the pre-change literals.
- f34226e: Delete two dead i18n namespaces — `configPanel.*` (16 keys) and `renderer.*` (13 keys) — from all ten locale packs.
  
  290 translated strings (29 keys x 10 packs) with **no reader anywhere in the
  repo**. Measured with `node scripts/check-i18n-dead-keys.mjs`, the reverse sweep
  from objectui#4658: it subtracts the referenced key set (the AST walk that
  `check-i18n-call-site-keys.mjs` already uses, plus plural suffixes, plus
  `returnObjects` branches, plus every dynamic template head) from the pack key
  set, then re-checks each survivor with a fixed-string grep over the whole repo.
  Both namespaces scored a clean sweep — `configPanel.*` 16/16 CONFIRMED and
  `renderer.*` 13/13 CONFIRMED, zero NEEDS-REVIEW, and a fixed-string grep for all
  29 keys returns nothing at all outside `packages/i18n/src/locales/`.
  
  `configPanel.*` is a dashboard-widget config-panel vocabulary (`layout`,
  `columns`, `gap`, `rowHeight`, `refreshInterval`, `appearance`, `theme`,
  `general`/`advanced`, …). The two components that surface exactly that
  vocabulary — `packages/plugin-dashboard/src/WidgetConfigPanel.tsx` and
  `DashboardConfigPanel.tsx` — import no translation hook at all and hardcode the
  same words in English (`title: 'Layout'`, `label: 'Columns'`, `label: 'Gap'`,
  `label: 'Show description'`, `label: 'Theme'`). The two config panels that do
  use i18n read other namespaces: `ViewConfigPanel.tsx` reads
  `console.objectView.*`, `ReportConfigPanel.tsx` reads `common.*` and
  `report.editor.*`. No component reads `configPanel.*`.
  
  `renderer.*` is SchemaRenderer placeholder/status vocabulary (`noPageSchema`,
  `noFormSchema`, `noDashboardSchema`, `pageRendering`, `dashboardRendering`,
  `formRenderingMode`, …). It is dead in the stronger sense: the English strings
  have no hardcoded twin either — `No page schema provided`, `No form schema
  provided`, `No dashboard schema provided`, `Page rendering`, `Dashboard
  rendering` and `Form rendering in` each return zero hits repo-wide outside the
  packs, and `packages/react/src/SchemaRenderer.tsx` imports no translation hook.
  The messages themselves are gone from the product, not merely un-translated.
  
  No behaviour change is possible: a key with no reader cannot be read. No test
  fixture pinned any of the 29 keys, and neither i18n baseline JSON names one, so
  nothing else had to move.
  
  Part of #4730.
- 564b605: Delete two dead i18n namespaces — `workflow.*` (58 keys) and `publicForm.demo.*` (36 keys) — from all ten locale packs.
  
  940 translated strings (94 keys x 10 packs) with **no reader anywhere in the
  repo**. Measured with `node scripts/check-i18n-dead-keys.mjs`, the reverse sweep
  from objectui#4658: it subtracts the referenced key set (the AST walk that
  `check-i18n-call-site-keys.mjs` already uses, plus plural suffixes, plus
  `returnObjects` branches, plus every dynamic template head) from the pack key
  set, then re-checks each survivor with a fixed-string grep over the whole repo.
  `workflow.*` scored 54/58 CONFIRMED with the other 4 appearing only in two i18n
  test fixtures — mentions, not consumers; `publicForm.demo.*` scored 36/36 with
  zero textual footprint anywhere outside the packs.
  
  `workflow.*` is a complete BPMN/workflow-designer vocabulary (`userTask`,
  `serviceTask`, `parallelGateway`, `boundaryEvent`, `importBpmn`/`exportBpmn`,
  `undo`/`redo`, …). Its one plausible consumer,
  `packages/plugin-designer/src/ProcessDesigner.tsx`, hardcodes English
  (`{ label: 'User Task', value: 'user-task' }`) and imports no translation hook
  at all, while six sibling components in the same package do use one — the
  vocabulary was never wired up. `publicForm.demo.*` is demo content (contact and
  support form titles, field labels, industry/issue-type/priority options) for a
  public-form showcase page that does not exist in this repo.
  
  No behaviour changes: a key with no reader cannot be read. The `publicForm.*`
  parent namespace and every other namespace are untouched.
- a1609a6: Console list filters: a `between` range is submitted only when both bounds are filled, and six operator labels stop rendering as raw i18n keys.
  
  Two defects in the list-view filter panel (objectstack#8815), both in the Console
  render layer, with no workaround available downstream.
  
  **A half-filled range no longer refuses the whole view.** Picking a date column
  and 「介于」 draws two inputs — that part landed in objectui#3958 — but typing
  only one bound produced `["2024-01-01", ""]`, and both write paths read "is this
  row filled in?" with one shape-blind predicate (`null` / `''` / empty array).
  An array of length 2 passed it, so the empty bound went to the server, which
  refuses the query outright (`400 INVALID_FILTER`): the list showed
  「该视图的查询被拒绝」 and the filters the user had already applied stopped
  applying too. The saved-view fold persisted the same half-range, so the refusal
  came back on every later read of that view, for every user of it.
  
  The spec cannot intercept this — `ViewFilterRuleSchema` accepts
  `["2024-01-01", ""]` because it counts the two slots rather than what is in
  them, while refusing a scalar or a one-element array. Authoring validation is
  therefore green on exactly the shape that fails at query time, which makes not
  emitting it the producer's job. `@object-ui/components` now exports
  `isFilterValueComplete(operator, value)` — arity-aware, so a `pair` row needs
  both bounds — and the two consumers that had each kept a copy of the old
  predicate (`plugin-list`'s `convertFilterGroupToAST`, `app-shell`'s
  `foldFilterGroupToSpecRules`) read it instead. A half-filled range is now
  dropped exactly as a half-typed `equals` row already was: no filter, rather than
  a filter the server will reject. Bounds of `0` and `false` stay real bounds.
  
  **Six operator labels are translated in all ten locale packs.**
  `startsWith`, `endsWith`, `isNull`, `isNotNull`, `exists` and `notExists` were
  missing from every pack, so i18next resolved them to the raw key and the dropdown
  showed `filterBuilder.operators.isNull` beside translated entries. The
  component's own defaults table could not cover it: that table serves only the
  no-provider path, and the Console mounts a provider. The report named four —
  a `date` column's bucket offers the four nullness operators; a `text` column
  showed all six.
  
  Because the label key is built dynamically (`t(\`filterBuilder.operators.${op}\`)`),
  no existing gate could see the gap: the call-site checker classifies a template
  key as `missing-prefix` and only asks whether the prefix resolves, and
  cross-pack parity is satisfied when all ten packs are missing a key together.
  A new parity test pins the packs against `FILTER_BUILDER_OPERATORS` in both
  directions, so an operator added to the dropdown now fails loudly until every
  pack labels it.
- 37f6844: FilterConditionField can author the spec's `$icontains` — case-insensitive contains is reachable from the filter UI.
  
  `@objectstack/spec`'s `FieldOperatorsSchema` gained `$icontains` between
  `17.0.0-rc.2` and `rc.5`, and every driver and evaluation face the platform
  ships now executes it. `FilterConditionField` had no builder operator that could
  author it, so the capability was unreachable from the sharing-rule criteria
  builder and sat in that widget's parity test as an explicit `KNOWN_UNREACHABLE`
  entry.
  
  The FilterBuilder gains a `containsCaseInsensitive` operator ("Contains (ignore
  case)", translated in all ten locale packs). `condToMongo` emits
  `{ field: { $icontains: value } }` and `kvToCondition` reads it back, so a saved
  criteria reopens in the visual builder instead of falling into the raw-JSON
  editor. Today's `contains` is unchanged and still emits the case-SENSITIVE
  `$contains`; whether it should have been case-insensitive all along is a product
  question that stays open, and stored filter views keep meaning what they meant.
  
  The fold is ASCII-only by contract — `café` does not match `CAFÉ`.
  
  The new operator is **opt-in per consumer**: `FilterBuilder` takes an
  `extraOperators` prop, and only `FilterConditionField` passes it. The one
  dropdown feeds three at-rest dialects and only the MongoDB-style criteria this
  widget writes can carry the operator — the spec's `VIEW_FILTER_OPERATORS` (saved
  views) and `VALID_AST_OPERATORS` (the live grid's filter AST) have no
  case-insensitive contains, so offering it there would author a filter those
  paths cannot execute. Every other FilterBuilder is unchanged.
- 2b50261: `FilterBuilder` gives the set and range operators an input that matches the value shape the spec accepts, and stops minting the shape it refuses.
  
  Three independent paths let one filter row end up with `operator: 'in'` and a
  SCALAR `value` — the shape `ViewFilterRuleSchema` refuses at save time since
  objectstack#6227, and the shape the query path answered `400 INVALID_FILTER` on
  before that (objectstack#5869):
  
  - Changing the operator dropdown wrote `{ operator }` alone, so the seed `''`
    (or whatever the previous family had produced) survived the switch into
    `in` / `not_in` / `between`. The operator and the shape of its value are one
    edit, so they are now made together: switching families re-shapes the value —
    a typed scalar becomes a one-element list, an empty one becomes `[]`, a range
    keeps its first bound and leaves the second open, and a list collapsing to a
    scalar keeps its first entry.
  - A plain text or number column has no static `options`, so `in` fell through to
    the single-value input and the user could only ever type a scalar into it.
    Those columns now get a token input (type, Enter or comma commits, `×` or
    Backspace removes) that always emits an array; `between` gets its two bounds
    instead of one box. The lookup picker's no-DataSource fallback, which also
    handed back a scalar while `multiple`, emits a list too.
  - The multi-value families were decided from a local `["in", "notIn"]` literal,
    already one spelling adrift: `notIn` is an alias and the canonical member is
    `not_in`, so a stored view read back in canonical form got the single-value
    input for a set operator. The families are now read from `@objectstack/spec`'s
    exported `VIEW_FILTER_LIST_VALUE_OPERATORS` / `VIEW_FILTER_PAIR_VALUE_OPERATORS`
    and folded through `normalizeFilterOperator`, so both spellings of one operator
    get one answer and a family the spec widens is picked up without an edit here.
  
  `foldFilterGroupToSpecRules` is unchanged and needed no change: it normalizes the
  operator and carries `value` through verbatim, so the shape that reaches storage
  is the producer's to get right. An untouched `in` row arrives as `[]`, which the
  fold's existing incomplete-row rule already drops.
  
  Four locale keys are added to all ten packs for the new inputs
  (`filterBuilder.addValue` / `.removeValue` / `.rangeStart` / `.rangeEnd`).
- af5e292: Emit explicit file extensions on relative import specifiers, so the published
  entries can be imported by Node's own ESM resolver.
  
  `@object-ui/react`'s built entry re-exported through extensionless relative
  specifiers (`export * from './SchemaRenderer'`). Node does not extension-search
  relative specifiers, so `import('@object-ui/react')` under plain Node — an SSR
  host, or any consumer without a bundler — failed with `ERR_MODULE_NOT_FOUND`.
  Bundled consumers were never affected and are unchanged by this.
  
  `@object-ui/types`, `@object-ui/core` and `@object-ui/i18n` carried the same
  emission; `@object-ui/react`'s entry stayed unloadable until they were fixed
  too, because evaluation crosses into them. No exported API changed.
- bea374e: A KPI card's sub-caption now translates from its own convention key
  
  objectui#4032 item 4. The metric card renders two authored strings, and they
  are two different authored fields:
  
  | authored field        | rendered as             | bundle key                                |
  |-----------------------|-------------------------|-------------------------------------------|
  | `widget.description`  | the shared card header  | `dashboards.<d>.widgets.<id>.description` |
  | `options.description` | the KPI sub-caption     | `dashboards.<d>.widgets.<id>.subCaption`  |
  
  Only the first resolved. The metric dispatch spread `...options` straight
  through, so the sub-caption reached `MetricWidget` as the raw authored English
  and a `zh` dashboard showed a translated header above an untranslated caption.
  
  They get two keys, not one — the objectstack#5428 item-4 ruling (2026-08-06):
  "两个作者字段两个 key". That is why PR #4358 landed items 1-3 and deliberately
  stopped here: at the time `@objectstack/spec` accepted no segment for the
  sub-caption and the only key it would take was `description`, the shared key the
  ruling forbids. objectstack#8056 added `subCaption` to the widget translation
  node, and it ships in `@objectstack/spec@17.0.0` — the version this repo pins.
  
  The server half already existed: `translateDashboard` overlays `subCaption` onto
  `options.description` on the `/meta` path, so a served document was already
  correct. This is the client half — the same key path, for the app bundles
  objectui loads into `I18nProvider` itself.
  
  - `@object-ui/i18n` gains `widgetSubCaption(dashboardName, widgetId, fallback?)`,
    mirroring `widgetDescription` limb for limb rather than re-implementing
    namespace discovery inside the plugin.
  - `DashboardRenderer`'s `tWidgetSubCaption` composes the two channels in the
    order `tWidgetTitle` already fixed — the authored value is collapsed to the
    active language first (an inline per-locale map, the `pickLocalized` seam),
    and the plain string that falls out is offered to the bundle as its fallback —
    so a bundle entry always wins over an inline map, and neither channel is
    replaced by the other. The resolved value is assigned after the `...options`
    spread in both the `object-metric` and static-value branches.
  
  The separation is pinned in both directions, because a shared key is exactly
  what a later tidy-up would reach for: the `description` key never reaches
  `options.description`, and `subCaption` never reaches `widget.description`. On a
  `kpi` / `gauge` / `bullet` widget both are on screen at once, so one shared key
  would make a single translation entry overwrite the other field's text.
  
  Untranslated dashboards are unchanged: with no bundle entry the resolver hands
  back exactly what the spread would have, and with nothing authored and nothing
  translated it answers `undefined` rather than `''`, so a card that has no
  sub-caption grows no caption row.
- d109a4d: The `organizations.*` picker locale family (avatar menu / console picker —
  `mine`, `title`, `heading`, `subtitle`, `searchPlaceholder`, `new`, `current`,
  `emptyTitle`, `emptyDescription`, `noMatches`) is now internally consistent in
  all eight non-en/zh packs (`ar`, `de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`).
  
  `en` and `zh` were renamed from "organization" to "workspace" terminology in
  full; the other eight packs only had `create` follow, leaving each pack mixing
  both nouns in one dropdown (e.g. `de.ts` read `create: "Workspace erstellen"`
  directly beside `mine: "Meine Organisationen"`). Since PR #4638 restored the
  avatar menu's "My Workspaces" entry, both lines render two apart in the same
  menu. Each pack now uses the workspace term its own `create` key already
  committed to (`Arbeitsbereich`-style German phrasing → `Workspace`, French
  `espace de travail`, Japanese `ワークスペース`, Korean `워크스페이스`, Spanish/
  Portuguese `espacio de trabajo` / `workspace`, Russian `рабочее пространство`,
  Arabic `مساحة عمل`), with grammatical agreement (gender, definiteness,
  particles) adjusted per key.
  
  The sibling `organization.*` (singular) namespace — organization
  **management**, a deliberately distinct surface per the comment separating the
  two blocks in `en.ts` — is untouched in every pack.
- ad13d63: Removed five locale keys that had no call site in any package, app, example,
  or e2e test: `console.objectView.striped`, `console.objectView.bordered`,
  `console.objectView.virtualScroll`, `appDesigner.stripedRows`, and
  `appDesigner.bordered`. Deleted from all ten packs (`en` plus the nine
  translations) to keep `all-locales-key-parity.test.ts` green.
  
  The `console.objectView.*` three describe grid options ObjectStack retired
  upstream (objectstack#7176, 2026-08-10) and objectui stopped forwarding
  (objectui#4649); the `appDesigner.*` pair is textually identical in name only
  and was independently dead — no `AppCreationWizard.tsx` control, no fallback
  entry in `useDesignerTranslation.ts`'s `DESIGNER_DEFAULT_TRANSLATIONS`, and no
  mention anywhere in the repo outside the locale packs themselves.
  
  No runtime behavior changes: nothing rendered these labels before this patch.
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
- 8871c14: Gate Home's metadata-authoring CTAs on the `manage_metadata` capability the
  server reports, with a visible localized reason.
  
  "Build an app" and "Start with a template" were gated on `useIsWorkspaceAdmin()`
  — a ROLE check. On a multi-tenant deployment that deliberately withholds
  metadata authoring from tenants, a workspace owner is an admin by role yet holds
  no `manage_metadata`, so the most prominent CTA on their home page led into
  `/studio`, a filled-in new-package dialog, and a capability refusal at submit.
  
  Both cover cards are now disabled, with the reason shown on screen and in the
  tooltip, whenever the session lacks the capability. The marketplace shortcut in
  the apps strip is withheld with them (it targets the same route, so leaving it
  live would have made the gate cosmetic), as is the "Build with AI" hero CTA
  (its output is draft metadata that cannot be published without the capability).
  On a workspace with no apps yet, the admin empty state explains the posture
  instead of directing the owner to build their first application.
  
  The gate consumes the answer `GET /api/v1/auth/me/permissions` already returns,
  surfaced through the permissions provider — no permission logic is re-derived in
  the client. Unknown capabilities fail OPEN: a backend that reports no
  `systemPermissions` at all is indistinguishable from one reporting an empty set,
  and the server enforces regardless, so nothing is withheld on missing client
  data. New key `home.build.noCapability` in all ten locale packs.
- 21e4585: A write-warning toast now words each strip reason on its own instead of calling everything that is not `readonly_when` "read-only".
  
  `emitWriteWarning` picked its sentence with a two-way conditional on
  `reason === 'readonly_when'`. The other arm was never "readonly" — it was
  "everything that is not `readonly_when`", so any reason the server-side write
  path gained afterwards was announced to the user as a read-only lock, pointing
  them at a permission problem that does not exist. That is the same defect
  objectui#3484 / framework#3794 fixed for `readonly_when` itself, one reason
  later.
  
  The reason is now resolved through a table declared
  `Record<DroppedFieldsEvent['reason'], …>`, mirroring the framework side of the
  same seam (`service-automation`'s `DROPPED_REASON_LABEL`) and the shape the
  spec's own `DroppedFieldsEventSchema` comment asks consumers for. The next reason
  added upstream is a `type-check` failure here, unworded, where the conditional
  compiled forever — which is what re-exporting THE spec type rather than a
  hand-widened `string` was for all along.
  
  Not a latent fix: the pinned spec (`@objectstack/spec` 17.0.0-rc.6) already
  carries `primary_key` (objectstack#6437), the strip that keeps a payload `id` the
  update dispatch ruled is not an identifier out of the targeted rows' primary key.
  Until now a user who triggered it was told the field was read-only. It gets its
  own wording in all ten locale packs: "The record's identifier cannot be changed
  by a save, so it did not take effect".
  
  One more line was added for a reason ahead of this bundle's pin — the adapter
  reads `reason` structurally off the wire without checking it against the enum, so
  a server newer than the bundle can deliver a value no table can have an arm for.
  It names the fields and claims nothing about the cause, rather than throwing
  inside a listener invoked as `void emitWriteWarning(...)` (which would cost the
  user the whole toast, including the reasons that did resolve) or reusing a
  wording that would state a cause we do not know.
- Updated dependencies [2533ec5]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [e1d4251]
- Updated dependencies [ac600e5]
- Updated dependencies [c1ef923]
- Updated dependencies [af5e292]
- Updated dependencies [167ec42]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [af025ee]
- Updated dependencies [31676be]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [d2ce342]
- Updated dependencies [dfc6975]
  - @object-ui/core@17.6.0

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

- 66fb4fa: The console's language menu now asks the app which locales it actually ships, instead of always offering the same ten.

  `LocaleSwitcher` built its items from a module-level `LANGUAGES` constant — exactly the ten codes `@object-ui/i18n` ships packs for — and never consulted the app, even though `GET /api/v1/i18n/locales` has been serving that list all along. It failed in both directions at once. An app shipping a locale outside those ten (`th`, a regional `pt-BR`) had no way to be selected from the console: the bundle could be complete and lint clean, and the menu simply had no entry for it. An app shipping only `en` and `zh` still listed all ten, so picking 日本語 handed the user the console's own chrome in Japanese with everything app-authored in the fallback language — a half-translated UI its author never opted into.

  The menu is now the **intersection**: the app's own locale list ∩ what the renderer can actually resolve (built-in packs, `config.resources`, and — for an app that wires a dynamic `loadLanguage` loader, which is how the console gets its packs — the locales that loader can fetch). Both failure directions close in the same change: an app-shipped locale becomes offerable, and locales the app does not ship disappear. The endpoint is reached through a new `loadLocales` prop on `I18nProvider`, wired exactly like the existing `loadLanguage`: the app owns the transport, the provider owns what is done with the answer. An app that does not wire it keeps today's menu unchanged.

  **The restore validation widened in lockstep, because otherwise this fix would have minted the next bug.** A restored language was validated against "the locales this provider can produce" — built-in packs plus `config.resources` — a bound that was correct only for as long as the menu offered exactly the built-in ten. The moment the menu grows to the app's real list, a locale the user can now pick is a locale that bound rejects, so a user-picked app locale would have been purged on the next page load. It now also accepts a locale a wired dynamic loader may be able to fetch, and the bound stays honest rather than absent: only well-formed BCP-47 tags qualify (`constructor`, `__proto__`, `en_US` are still rejected, as is any stored locale in an app with no loader), and the app's own locale list adjudicates the choice for real once it arrives — a locale the app has since dropped is reverted and purged rather than left locking the UI to a language with no translations.

  Labels come from the built-in native names where they exist (`中文`, `日本語`, … are unchanged) and from `Intl.DisplayNames` for everything else, so an app locale is named in its own language rather than by its code. The endpoint's own `label` is deliberately not used for display: the server sets it to the code echoed back, which would have put `th` in the menu where `ไทย` belongs.

  While the app's list is in flight the switcher renders nothing, following the sibling menus in the same folder — the ten never flash past on an app that only ships two. When there is no backend, the endpoint fails, or the app answers with nothing this renderer can produce, the built-in ten remain as the offline fallback, so the menu is never empty and never unusable.

- 92250d6: One home for the number-display policy — and a percent stops meaning two different things between a list cell and a dashboard measure

  `formatDisplayNumber`, `shouldGroupDisplayNumber` and `DisplayNumberFormatOptions` move from `@object-ui/i18n` into `@object-ui/core`. `@object-ui/i18n` re-exports all three under the same names, so every existing import path keeps working unchanged and both spellings resolve to the same function object; nothing published was removed.

  The move is what fixes the bug. `@object-ui/core`'s `formatMeasure` needed exactly this policy and could not import it — `core` is the React-free engine and is a runtime dependency of React-free consumers (the `object-ui` VS Code extension, `@object-ui/data-objectstack`), while `i18n` depends on `i18next`/`react-i18next` and peer-depends on React. So `formatMeasure` carried a parallel `Intl` implementation, recorded at both ends as deliberate duplication, and the two drifted in the one place a hand-built string and `Intl` disagree. A German session read `1.234,5 %` from a list cell and `1.234,5%` from a dashboard measure showing the same number. The function is pure, so the boundary was never a property of the code — only of where the code sat; moving it down removes the obstacle instead of working around it. `core` imports nothing from `i18n`, so the new edge adds no cycle.

  **Behaviour change — a measure's percent sign now follows the locale.** `formatMeasure` appended a literal `%` in every locale; it now renders the locale's own percent convention, the same one the list-cell `formatPercent` has used since the fix to its own machine-locale defect. Measured to change output in de, fr, es, ru, sv, cs, fi (a no-break space appears before the sign), tr (the sign moves to the FRONT: `%1.234,5`) and ar (its own percent sign plus U+061C). English, Japanese and Chinese are byte-identical — their convention is a bare trailing sign — which is why this was invisible in an English session.

  **No numeral moves, in any locale, at any magnitude.** The obvious route to the locale's convention is `Intl`'s `style: 'percent'`, but that style expects a fraction, so a value already in percentage points would have to be divided by 100 for `Intl` to multiply it straight back — and that round trip is lossy. Measured, it moves 27,581 of 1,200,013 ordinary-magnitude en-US forms at rounding ties (`0.175` at two decimals becomes `0.17%` instead of `0.18%`), plus `MAX_SAFE_INTEGER` and everything from 1e23 up, where `100,000,000,000,000,000,000,000%` becomes `99,999,999,999,999,990,000,000%`. The percentage points are formatted directly instead, through a new `style: 'percentPoints'` on `DisplayNumberFormatOptions`; that route was measured to produce a byte-identical percent affix to `style: 'percent'` across all 171 locale tags tested while moving none of those 1,200,013 forms. Callers holding a fraction keep using `style: 'percent'`, whose behaviour is unchanged — naming the two cases apart is what stops the next caller from reaching for the lossy one.

  `@object-ui/i18n`'s entry declaration is byte-identical, but the declaration it points at now lives in `@object-ui/core` and the package gains that dependency, so it takes the same minor bump rather than a patch.

- ac853ce: i18n: retire the reader-less `common.search` key from all ten locale packs

  `common.search` (`Search`, no ellipsis) had exactly one consumer: `LookupField`
  built its dialog placeholder by concatenating the key with three ASCII full
  stops. objectui#4375 / PR #4391 retired that concatenation — the placeholder is
  the reused `table.search` pack value (`Search…`, one U+2026 glyph), which is what
  brought it under objectui#3878's glyph pin. That left `common.search` with zero
  readers repo-wide while it still existed in all ten packs.

  Re-verified before deleting, repo-wide: no `t()` call site in any package or app,
  no MDX or JSON reference, and the one dynamic template-literal reader of the
  `common` namespace takes a two-member union parameter (`'openChat' |
'closeChat'`) that cannot resolve to it. No user-visible string changes — this key never rendered.

  The dormant copy in `@object-ui/fields`' no-provider fallback table
  (`useFieldTranslation.ts`'s `FIELD_DEFAULTS`) goes with it. That table is a
  module-local `Record<string, string>` read only when no `LocalizationProvider`
  is mounted; it is not exported, so removing an entry no reader asks for changes
  no rendered output and narrows no public type. Hence patch for that package,
  while the pack change is a minor: deleting a key from `en` narrows the exported
  `TranslationKeys` type (`typeof en`), so code indexing `TranslationKeys` at
  `common.search` stops type-checking. Same grading, for the same reason, as
  objectui#4145's `report.editor.*` retirement. No runtime consumer existed to
  break.

  Retiring a key from `common` was the ruled decision on objectui#4392 rather than
  keeping it as vocabulary: nothing pins a dormant key's meaning, so its next
  reader inherits an unreviewed contract, and a dormant key beside a live
  `table.search` is where a second dialect gets started. The objectui#4328
  dead-surface family has consistently chosen removal for zero-consumer surfaces.

  The neighbouring `common.select` (minted one commit earlier by objectui#4386 /
  PR #4397) is a different key and is untouched.

  A negative pin (`packages/i18n/src/__tests__/common-search-retired-4392.test.ts`)
  fails if the key returns to any pack, if any package reads or re-declares it, or
  if a dynamic `common.*` reader grows a `search` member — every existing i18n gate
  runs call site to key, and none of them can see a key with no call site.

- fa51109: i18n: retire the orphaned `report.editor.*` namespace — 105 of its 106 keys, in all ten locale packs (~1050 translated strings)

  The namespace labelled the hand-rolled report editor form. That form no longer
  exists: `ReportConfigPanel`'s body is `ReportDefaultInspector`, a spec-driven
  inspector whose labels come from the report spec's own metadata rather than from
  a pack namespace. Until objectui#4137 the namespace had exactly one live reader,
  and it was the objectui#4118 defect itself — the panel borrowing
  `report.editor.title` (the label of the report's Title _field_) to name itself.
  Moving that slot onto a purpose-built `report.editor.panelTitle` left the other
  105 keys with no reader anywhere.

  Re-verified before deleting, repo-wide and per key: no `t()` call site, no
  dynamic `t()` template form, and no JSON or MDX reference reads any of the 105.
  No user-visible string changes — these keys never rendered.

  `report.editor.panelTitle` survives in all ten packs and is untouched; the
  deletion sweeps around it. `report.editor` therefore remains a live namespace
  holding exactly that one key.

  This narrows the exported `TranslationKeys` type (`typeof en`), which is why it
  is a minor rather than a patch: code indexing `TranslationKeys` at a retired key
  stops type-checking. No runtime consumer existed to break.

  A negative pin (`packages/i18n/src/__tests__/report-editor-retired-4145.test.ts`)
  names all 105 retired keys and fails if any returns to any pack, since every
  existing i18n gate runs call site to key and none of them can see a key with no
  call site.

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

- 0082db8: The timeline's gantt bucket labels and its row-label default speak the session language

  objectui#4513 routed every `Intl` call in the timeline renderer through `useDisplayLocale()`, so a Chinese session renders `2026年8月` on the month axis and `2026年8月11日` on item dates. Three sibling strings in the same renderer never went through `Intl` at all and stayed English on that same Chinese axis: the `week` header (`Week 1`), the `quarter` header (`Q3 2026`), and the gantt row-label column default (`Items`). The half-fixed state was the visible one — a Chinese date axis with English bucket labels beside it.

  They are a translation concern rather than a locale-resolver one, and that distinction is the fix: a locale TAG formats a date, only a TRANSLATION spells a word. All three now resolve through the package's existing channel — `useTimelineTranslation` / `TIMELINE_DEFAULT_TRANSLATIONS`, the `createSafeTranslation` factory `ObjectTimeline` already uses for `timeline.bucket.*` — under three new keys carried by all ten locale packs: `timeline.scale.week`, `timeline.scale.quarter`, `timeline.gantt.rowLabel`.

  The week number and the quarter/year ride the channel's own `{{hole}}` parameters rather than being concatenated, because the word order belongs to the translation: Chinese puts the year first (`2026年第3季度`), which no `Q${q} ${year}` template can produce at all. Only the row-label DEFAULT moved — an author who writes `rowLabel` still supplies their own string, and the `year` scale stays a bare `String(getFullYear())` with no vocabulary in it to translate.

  English output is byte-identical to the retired literals: the `en` pack values are the same two templates the code used to interpolate by hand. `generateTimeScaleHeaders` is a pure exported function and cannot host a hook, so the translate fn is threaded in as an optional fifth parameter on the seam #4513 opened for `locale`, defaulting to the package's own defaults table — the same lookup the channel serves with no `I18nProvider` mounted. Existing three- and four-argument call sites are unaffected.

  One consequence is worth stating because it looks like a bug and is not: dates and vocabulary resolve through different channels on purpose. `useDisplayLocale()` puts the tenant's regional default first (how this organization writes dates), while `t` follows the UI language (what this user reads). A tenant configured `en` whose user reads Chinese chrome therefore sees `Aug 2026` beside `第 1 周` — the same split `timeline.bucket.*` has always had.

### Patch Changes

- 932cbcd: An app you are not allowed to open now says so, instead of reporting that it may still be publishing

  `GET /api/v1/meta/apps` is filtered per session server-side (`filterAppForUser`), so an app withheld by its `requiredPermissions` and an app that does not exist were byte-identical to the console: both simply absent from the list. With one fact and two conditions, `AppContent` rendered its only copy for an absent app — "This app is not available yet — it may still be publishing. Try again in a moment." — over a permanent authorization decision, under a Retry button that could never succeed.

  That is not a cosmetic complaint. On a downstream acceptance round one role hit this screen while another opened the same app fine, and because the copy names a transient deployment state the finding was filed as a suspected platform defect and carried through two test batches before a clean-baseline investigation found the account was missing a permission-set binding. The gate had been working exactly as designed; the message is what sent everyone to the wrong place.

  The maintainer ruling (2026-08-12) took the contract half first. objectstack#8013 made the BY-NAME route answer an explicit denial — `403` with the ADR-0112 catalog code `PERMISSION_DENIED` in the declared `{ success: false, error: { code, message } }` envelope — for an app that exists and whose `requiredPermissions` the session lacks, while the LIST route stays filtered exactly as before, with no `authorized: false` flag, so the enumeration surface is not widened past what a direct by-name probe already implies. Absence keeps answering `404 RESOURCE_NOT_FOUND`, and so do the two neighbouring refusals the same ruling deliberately left alone: an unpublished app (ADR-0045 §3 keeps it externally unobservable) and an app gated by an absent optional service (ADR-0057 D10 — nothing was denied to the caller).

  This is the console half. When a requested app is missing from the list and the existing post-publish readiness re-check still cannot find it, the console asks the by-name route which of the two it is, through a new `ObjectStackAdapter.probeAppAccess(name)`. On the measured code it renders a plain authorization message with a way back to the launcher; on anything else — an absent app, an unreachable server, a host that injected a DataSource without the probe — today's publishing copy renders byte for byte, retry button included.

  Two properties of that seam are load-bearing rather than incidental. It branches on the ADR-0112 **code**, never the status (objectui#4408): the two answers under test are both errors one status apart, and a status-reading implementation passes the happy path while going blind exactly where the defect lives. And only `denied` moves the copy: this bug exists because the console asserted a state it had not measured, so a probe that fails, times out or cannot be issued must leave the screen alone rather than guess in the other direction.

  `probeAppAccess` is deliberately separate from `getApp` rather than a flag on it: `getApp` degrades every failure to `null` — the very conflation being undone — and memoises in the adapter's metadata cache, where a verdict about the CALLER would outlive the session it described. New public API on the adapter (`probeAppAccess`, `isAppPermissionDeniedError`, `APP_PERMISSION_DENIED_CODE`, `AppAccessVerdict`), purely additive; nothing existing changed shape. Three new `empty.*` keys ship in all ten locale packs.

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

- 3fc2971: A null-keyed group renders as an explicit bucket instead of silently vanishing from a chart (objectui#4466)

  `buildChartSeries`' single-dimension branch passed rows through verbatim, so a row whose category VALUE is `null` reached recharts with a null category and drew no mark. The visible outcome was not an empty chart but a quietly wrong one: rows `[{user_id: null, event_count: 51}, {user_id: 'Dev Admin', event_count: 2}]` drew exactly ONE bar — the dominant group, 51 of 53 events, dropped while the y-axis scale still accommodated it, so the chart understated its own data and the axis proved the data had been there. With every group null it drew axes, gridlines and an axis title with zero marks and no empty state, which is the shipped first-boot state of the built-in System Overview board's "Events by User" (every seeded `sys_audit_log` row is written with `user_id = NULL`).

  The mapping lives in the shared series layer, so dashboard widgets and standalone `ObjectChart` get one answer rather than a per-chart patch in the recharts wrapper. It resolves the two-answers disagreement the card names as well: an empty result set keeps the designed empty state, a non-empty result always draws bars — the null bucket included.

  `@object-ui/core` gains `NULL_CATEGORY_LABEL` and `ChartSeriesOptions`; `buildChartSeries` and `findChartSeriesRow` each take an optional trailing `options`. Both additive — every existing call site compiles and behaves identically, and a result with no null category is still returned by array identity. The two helpers are a pair on purpose: the caller matches a clicked segment against rows that still carry the raw `null`, so `findChartSeriesRow` reads the bucket label back to that row and the newly-visible bar keeps its drill-through instead of resolving to `-1`.

  The label goes through the i18n channel (`chart.nullCategory`, en `(None)` / zh `(未指定)`, all ten packs), passed down by the renderer: `@object-ui/core` is React-free and cannot read the locale bundle, so it takes the resolved string the same way `dimensionOptionTranslator` takes a resolver. Its English constant is the floor for a provider-less host, not the mechanism.

  `hasNoCategoryKey` (framework#4033) is untouched and now documented against this: a row that does not carry the category key AT ALL is a different defect — a dimension grouped by but never projected — and keeps its explanatory placeholder. The bucket deliberately never ADDS the key to such a row, which is what keeps that guard's signal alive. Key absent → the placeholder; key present with a null value → the bucket.

- f7c6430: The build-history panel tells an operator a 503 means "the commit store could not be reached — retry", instead of `commits HTTP 503`

  `packages/app-shell/src/preview/commitHistory.ts` flattened every non-OK response to a bare status code (`commits HTTP {status}` for the read, `HTTP {status}` for the revert). Nothing was ever swallowed and no fictional "no history" was ever rendered — those fail-loud properties held, and still hold, which is why objectstack#5980's 503-ification (ADR-0110 D3) needed no follow-up here. What was lost is the meaning the backend already sends, on the one screen where it matters most: this is the rollback surface, read by an operator who is usually mid-incident. A 503 says the read/write did not happen and is worth retrying; a 404 says the store answered "no". They now read differently, and 404, 500 and 503 stay tellable apart.

  Failures now throw a `CommitStoreError` carrying `status`, the ADR-0112 `code`, and a `retryable` flag, and the panel renders a sentence rather than a number. The revert half gets a deliberately different sentence: a write that could not reach the store may still have landed, and re-issuing it appends a _second_ revert commit to an append-only log, so the copy asks the operator to re-read the timeline before retrying rather than simply saying "try again".

  Two details of the report this fixes were checked against the producer and came back different, and both are the reason the copy is authored client-side. The semantic code arrives at **`error.code`**, not `details.code` — `HttpDispatcher.errorFromThrown` parks it in `details` and `buildApiError`/`splitSemanticCode` lift it out and drop `details` (objectstack#3842) — so a consumer reading `details.code` would run a check that can only pass vacuously. And the envelope's own `message` for this class is _withheld_: `declaresServerFault` (objectstack#5811) is true for a 5xx carrying a string code, so the prose on the wire is the generic `Internal server error`. Rendering it would have been strictly worse than the bare status code it replaced. Classification therefore keys on the HTTP status first and treats the code as a second signal, which also means a 503 shed by a proxy with an HTML body still produces the retryable reading.

  Adds `preview.history.loadFailedUnavailable` and `preview.history.revertUnavailable` to all ten locale packs.

- 92876f0: Doc comments no longer cite `@objectstack/spec` symbols the pinned spec has retired

  Eight exported declarations carried a doc comment claiming alignment with a
  `@objectstack/spec` symbol that `17.0.0-rc.6` does not export — four locale
  formatting shapes in `@object-ui/i18n` (`SpecPluralRule`, `SpecDateFormat`,
  `SpecNumberFormat`, `SpecLocaleConfig`) and four activity-feed shapes in
  `@object-ui/types` (`FieldChangeEntry`, `Mention`, `Reaction`,
  `RecordSubscription`). A citation that points at nothing is worse than a stale
  one: the next reader cannot tell whether the protocol retired the symbol,
  renamed it, or never had it.

  Measuring all eight against the published registry answered that question, and
  the answer was not "these names never existed". Every one was a real export the
  protocol retired on purpose, and every local key set was faithful to the schema
  it named. The feed four left `@objectstack/spec/data` in the `16.0.0` major,
  when the feed surface was replaced by the data API over `sys_comment` /
  `sys_activity`. The i18n four left `@objectstack/spec/ui` in `17.0.0-rc.6`
  itself — they were still present in `rc.5` — retired under ADR-0049
  enforce-or-remove because no authorable shape carried them and nothing ever
  parsed them.

  Each comment now records that provenance, including the version the symbol left
  and what (if anything) replaced it, so the shapes read as declarations these
  packages own rather than as a view onto a protocol type. Type shapes, runtime
  behaviour and exports are unchanged — the published `.d.ts` files differ only in
  comment text, which is why this is graded `patch`.

- 828549a: The gantt's conflict dialog shows the number of affected tasks again, not a literal `{2}`

  `gantt.conflict.body` was resolved at the render site with a literal string replace on **single** braces — `t('gantt.conflict.body').replace('{count}', String(n))` — while all ten locale packs spell the placeholder the i18next way, `{{count}}`. `"…{{count}}…".replace("{count}", "2")` consumes the inner seven characters and leaves the outer pair behind, so every user on every loaded pack read "自动重新排程 **{2}** 个受影响的任务？". The dialog now interpolates through i18next (`t('gantt.conflict.body', { count })`), the idiom `gantt.delete.body` already used.

  The two sibling keys three lines away in the same file, `gantt.autoScheduleDlg.body` and `.skipped`, were **not** broken — pack and call site both used single braces, and they rendered correctly. They are converted anyway, because that split is the whole mechanism: two write-confirmation dialogs in one component carried two different interpolation idioms, so `conflict.body` drifting to the i18next spelling in the packs (which is the correct spelling, and matches every other placeholder in the bundle) silently broke the render. Leaving the auto-schedule keys on the literal-replace idiom leaves the same trap armed for the next translator. All ten packs and the plugin's bundled English fallback table now agree on `{{count}}` for all three; only the braces moved, no translation was reworded.

  `gantt.quickFilter.resultSummary` stays deliberately single-brace — its `ObjectGantt` call site really does resolve `{shown}`/`{total}` with a literal replace, and that convention is pinned by its own parity test. It is now the only key in the gantt namespace on that idiom, and the comments at both spellings say so.

  Nothing caught this, and each gate was silent for its own reason: the cross-pack parity check compares en against each pack, and all eleven spellings agreed; the en-drift check compares a pack against its own history, and the packs were born matching. Both are **relative** comparisons, and the defect lived in the **absolute** relationship between a pack's spelling and the syntax the call site resolves. The existing render test asserted the dialog body contains `'1'` — which `{1}` satisfies. The new pin asserts the absolute form directly, under a real loaded pack, for every way a placeholder can survive to the screen.

- e1ade8f: An illegal gantt dependency link now says why it was refused, instead of doing nothing

  Dragging a dependency onto a target the gantt refuses — itself, a locked row, a group row, or one that would close a dependency cycle — produced no feedback of any kind: no toast, no dialog, no cursor change, no target outline, not even a console warning. The guard was right and completely invisible, so a user drawing a legitimate-looking dependency got a dead interaction and no way to learn the constraint. The rejection was silent in both places it could have shown: a refused bar never became the drop target, so it got no hover treatment at all, and the release handler only ran its body when a target _had_ been registered, so the drop itself was a no-op.

  Both halves are now wired, and both read the **same** verdict. `canReceiveLink`'s four-branch boolean became `classifyLinkTarget`, which returns which branch refused (or `null`), with the boolean derived from it. The hover affordance and the drop toast are two consumers of that one classification, so the reason a user is shown cannot drift from the reason the link was actually refused — there is no second classifier to disagree. The branch names are the leaves of the new `gantt.link.rejected.*` keys, so a branch added later without a message surfaces as a missing key rather than as a plausible-but-wrong sentence.

  During the drag, a refused bar under the pointer gets `cursor: not-allowed` and a destructive outline; on release it raises a toast naming the reason. Four messages, one per branch, in all ten packs. Both the cursor and the outline are driven from inline `style` rather than utility classes, matching the bar's existing read-only cursor three lines away and for the same reason recorded there: `cursor-not-allowed` and the ring alpha utilities are not emitted in the prebuilt components CSS, so a class would look correct in a DOM test and render nothing in a browser.

  Deliberately unchanged: a host veto through `onBeforeDependencyCreate` stays silent. That rejection carries a reason only the host knows, and the gantt has none to show — surfacing it means exposing a rejection-reason output on the public component, which is a separate contract rather than a rider on this one. The four built-in reasons are the gantt's own policy and are the only ones it can explain.

  One of the four, `group`, has no end-to-end path today: a `type: 'group'` row renders no bar, so the drag can never target it. The message is kept anyway — without it the branch would render a raw key on screen if it ever did fire — and the test pins the reachability fact, so it goes red the day group rows gain a bar. Filed as objectui#4209.

- 3e19fe7: i18n copy: one ellipsis glyph across the ten packs, `usted` in the es draft-preview empty state, and a pt sentence that stops contracting `de` onto its own hole

  Three locale-copy defects that no gate could see, because all three are _value_ defects on keys whose names, placeholders and key sets were already correct.

  **One ellipsis (objectui#3878).** `en` ended 33 values with three ASCII full stops (`Loading...`, `Ask anything...`) and 110 with the typographic ellipsis `…`, and the nine translation packs had copied `en` value by value — so a user could read both glyphs on one screen: `common.loading` beside `dashboard.loading`, `console.ai.askAnything` beside its own panel's siblings. All ten packs now spell it `…` (U+2026), per the maintainer-authorized consistency pass registered on objectstack#6015. 312 pack values changed: 34 in `en` (the 33 trailing plus the one mid-sentence `collaboration.commentPlaceholder`) and 278 across the nine. Eleven inline `defaultValue` call sites were re-synchronised with the new `en` text, which `scripts/check-i18n-call-site-keys.mjs` requires byte-for-byte.

  The convention is now pinned so the split cannot regrow: `packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts` fails, by key name, on any value in any of the ten packs that holds three ASCII full stops. It is deliberately wider than "a trailing `...` in `en`", because the census showed the narrow rule would have shipped with two holes in it — `collaboration.commentPlaceholder` puts the ellipsis mid-sentence, and `list.loading` had the packs wrong while `en` was already right, which no `en`-only rule can see.

  Fifteen module-local **no-provider fallback** entries were moved with the packs, across `useCollaborationTranslation`, `useFieldTranslation`, `useDetailTranslation`, `ObjectGrid`, `KanbanImpl`, `data-table` and `ConnectionStatus`. Those maps exist to render when no `LocalizationProvider` is mounted, and each one's own docblock requires it to stay byte-identical to the `en` pack — a requirement objectui#3440 already enforces mechanically for the collaboration map. Leaving them behind would have made the provider-less path disagree with the provider path on ten keys.

  **es `usted` (objectui#3875).** `preview.empty.notReadyDescription` said `Revisa la conversación` — the tú imperative — in a namespace that is otherwise 23:1 usted, and it renders _underneath the usted draft-preview banner at the same moment_, not before or after it. `Revisa` → `Revise`; nothing else in the sentence carries a register. The neighbouring `approvalsInbox` namespace is legitimately tú and was left alone.

  **pt contraction (objectui#3877).** `ConcurrentUpdateDialog` splits `detail.concurrentUpdateDescription` on `{{field}}` and renders a bolded label in the gap, and pt left a bare `de` in front of that gap. When the multi-field conflict branch passes the record label (`este registro`), Portuguese users read `de este registro` — a contraction error every native speaker sees, and one that no spelling of the leaf value could fix (`deste registro` renders `de deste registro`). The pt sentence is rewritten so the hole is preceded by the verb `afeta` instead of any preposition, which closes the whole class rather than trading `de` for an `em` or `a` that contract just as hard. pt only; `en` is unchanged.

  No behavior, no keys added or removed, no placeholder changed.

- bb58d1d: i18n: the two search placeholders become pack values, and four values the packs served in English get translated

  **objectui#4375** — `ListView` and `LookupField` built their search placeholder as
  `t(key) + '...'`, so the ellipsis was a literal concatenated in code: it stayed ASCII
  in all ten locales on screens where objectui#3878 had converged everything else on
  U+2026, and no pack could opt out of it (sharpest in `ar`, where a left-to-right run
  was appended to right-to-left text). Both now read `table.search`, which is already
  the repo's search-input placeholder key — `data-table`, `RecordPickerDialog` and
  `PeoplePicker` render it too — and is translated with the right ellipsis in all ten
  packs. No new keys.

  **objectui#4376** — `list.loading` served the English `Loading records…` in eight of
  the nine translation packs (`zh` alone had translated it); `designer.undo` and
  `designer.redo` were English in all nine; `appDesigner.snakeCaseHint` in `ko`, `pt`,
  `ru` and `ar`. All translated, reusing each pack's own established vocabulary. A new
  pin (`untranslated-identity-4376.test.ts`) fails on any value byte-identical to `en`
  inside a non-Latin pack unless the key is on an explicit 22-entry allowlist.

- 5cc847c: The console shows a standing impersonation banner, with an exit that fails loudly (#4467).

  While `session.impersonatedBy` is present, `ConsoleShell` renders a banner naming BOTH
  parties — the impersonated user, whose name every write is recorded under, and the
  administrator who started it — plus a stop affordance. It derives from the session rather
  than from client memory of the click, so it survives a full SPA reboot, a new tab and a
  browser restart, and it cannot disagree with who the server thinks is acting. An ordinary
  session renders `null` and its chrome is unchanged.

  The exit calls `POST /auth/admin/stop-impersonating` over the same data lane and then
  awaits a session refresh. The server restores the administrator from the `admin_session`
  COOKIE, so a deployment that blocks cookies cannot exit this way — the banner says so and
  stays up instead of appearing to succeed, which would leave the operator doing ordinary
  work under someone else's identity.

  Ten locale packs carry the banner's copy.

- fa21254: Kanban: a drop that makes fields required now collects them instead of dead-ending

  Dragging a card into a column whose value flips a field's `requiredWhen` predicate to TRUE used to PATCH the column value alone. The engine refused the whole update — correctly, that is what the predicate declares — and the board had no way to finish the move: the only path to closing a won deal was to abandon the board and open the record form. HotCRM's opportunity pipeline is the reported case (`win_reason` is required when `stage == "closed_won"`), but the dead end belonged to every board whose target column carries a conditional requirement.

  The board now evaluates the target column's predicates BEFORE writing anything. If the move would make fields required while they are still empty, it opens a small dialog collecting exactly those fields, then submits the column value and everything collected as ONE PATCH — never two writes, which would leave the record in the refused state if the second one failed. A drop that triggers no predicate is untouched, down to the PATCH body.

  The verdict comes from `@object-ui/core`'s `resolveFieldRuleState` — the same evaluator the record form, the wizard and the line-item grid already resolve `visibleWhen`/`readonlyWhen`/`requiredWhen` with, delegating to `@objectstack/formula`'s CEL engine. The board's prompt and the server's enforcement therefore reach the identical verdict rather than drifting through a second hand-rolled predicate evaluator. Emptiness is core's `isMissingForRequired`, the presence contract the form and the server share, so a `false` boolean and a `0` count as answers and are not re-asked.

  Every control in the dialog is `@object-ui/fields`' `FieldEditWidget`, the same widget the record form renders for that field type — a select edits as a select, a date as a date picker — so this adds no second set of field-rendering decisions.

  Four kinds of field are deliberately NOT collected, and each falls through to the unchanged PATCH where the server's refusal (legible since objectstack#7525) speaks for itself: one that already has a value, one `visibleWhen` hides, one that is readonly, and one whose type has no edit widget at all. A dialog row with no control would be a worse dead end than the one being fixed.

  Cancelling writes nothing and leaves the card in its original column; a combined PATCH that is still refused for some other reason surfaces the refusal and rolls back exactly as a plain rejected move does, rather than looping the dialog on an arbitrary server error.

  `@object-ui/i18n` carries two new `kanban.*` strings for the dialog, translated across all ten packs. Its public type surface is unchanged — the `.d.ts` was measured identical before and after — hence the patch bump.

- 33c32bf: List sort: the picker stops borrowing the filter whitelist, and a header click is no longer a one-way door out of the view's declared sort

  `filterableFields` was applied to the single field set both toolbar builders read, so a whitelist authored for _filtering_ silently became the _sort_ whitelist too. A view could declare a two-level default sort — `plan_start_date` then `name` — and get a sort panel that offered neither field and rendered both of its rows blank: the declared sort worked on load and could then be neither reproduced nor modified, and there was no way to express "sortable but not offered as a filter condition" short of widening the filter builder as collateral. The whitelist now narrows the filter builder alone, which is the contract it was written for; the sort picker starts from every field the view can name and applies its own sortability rules.

  Those rules are about what the sort can honestly reach, so a second one joins the existing relational exclusion: a `formula` field is withheld. It has no materialised column, so ordering by one is refused by the server outright (objectstack `UNMATERIALIZED_SORT_TYPES`) — and it matters here precisely because the base set widened, since a formula field previously reached the picker only if someone had whitelisted it. The exclusion is `formula` alone and deliberately not the spec's `COMPUTED_VALUE_TYPES`: `summary` and `autonumber` are computed too, each gets a real maintained column, and both order correctly. Either rule keeps its existing escape hatch — a field the current sort already uses stays listed, which for a formula field is the only way to remove the offending row.

  One consequence worth naming: the hint explaining the relational omission used to be gated by the same whitelist. A view whitelisting only `status` showed a near-empty sort picker and no word about why; the withheld relational field now reaches the rule that withholds it, so the explanation appears with it.

  The second half is the way back. One column-header click replaces the whole sort array, so a view shipping a multi-level default lost it for the rest of the session — the declared `sort` behaved as an initial value only, recoverable just by reloading the page. The sort panel gains a **Reset to view default** control that restores the declared array whole: multi-level, in declared order, not merely cleared. It reads the view's declared sort through the same resolver the initial render already uses, so there is one answer to "what did this view declare". It is disabled while the active sort already matches that default, and absent entirely for a view that declares no sort — there is no default to return to, and clearing the sort under that label would be a second, differently-named way to do what removing the rows already does. The header click's own semantics are unchanged: it still replaces the array, it just no longer does so irreversibly.

- 6d641c9: Members & invitations tabs gate their affordances by org role instead of letting the server's 403 be the UI (#4475)

  A user whose organization role is `member` opened the workspace members page and
  was shown an enabled **Invite member** button plus a per-row **Member actions**
  menu carrying **Remove member** — on every row, the workspace Owner's included.
  Nothing was hidden or disabled; the action only failed after the user had
  committed to it. The Settings tab of the same page already gated correctly; the
  members and invitations tabs never got the same treatment.

  The affordances are now narrowed to the roles that can actually use them, keyed
  on the active member's role — the same source the role-change menu on this page
  already reads. Which roles those are is **measured against the routes that
  enforce them**, not assumed to be "owner":

  | affordance        | route                             | permission              | roles                         |
  | ----------------- | --------------------------------- | ----------------------- | ----------------------------- |
  | Invite member     | `/organization/invite-member`     | `invitation:["create"]` | owner, admin, delegated_admin |
  | Remove member     | `/organization/remove-member`     | `member:["delete"]`     | owner, admin                  |
  | Cancel invitation | `/organization/cancel-invitation` | `invitation:["cancel"]` | owner, admin                  |

  Three different gates, because `delegated_admin` holds `invitation:["create"]`
  without `member:["delete"]` and deliberately without `cancel` — so it keeps the
  invite button and the copy-link action while losing remove and cancel. A single
  owner check could not express that.

  An actor left with no row action at all gets no menu rather than a trigger that
  opens onto nothing, and the members page explains the absence where the Invite
  button used to sit, in the Settings tab's own voice. An unresolved role is
  treated as the least privileged, so nothing privileged is offered to a viewer
  whose membership could not be read.

  Reading the pages is unaffected: the member list and the invitation ledger still
  render in full. Whether `org_member` should be able to read the invitation
  ledger at all is a separate, server-side question.

- 45e1949: Numbers render in the user's locale, and a `Field.number` year is no longer `2,026`

  Every numeric field the console rendered went through an `Intl.NumberFormat` built with the locale hardcoded to `en-US` and `useGrouping` never set. Two defects rode in that one construction: a `zh-CN` or `de-DE` console still grouped and pointed decimals the US way, and a four-digit **year** stored as `Field.number({ scale: 0 })` rendered as `2,026` — in every locale, with no field property able to turn it off. Apps had been converting year columns to `Field.text` to escape it, permanently trading numeric comparison, range filters and dataset dimension types for a display detail.

  The construction had been copied into five places — the number cell renderer, the currency cell renderer, the `CurrencyField` widget, the compact `formatNumber` helper, and the dashboard `MetricWidget` — so fixing any one surface never changed the answer. They now share one formatter, `formatDisplayNumber` in `@object-ui/i18n`, which owns the locale and the grouping policy together, plus one locale resolver, `useDisplayLocale`.

  `useDisplayLocale` composes the two locale channels this repo already had rather than adding a third: the tenant's regional default (`useLocalization().locale`, ADR-0053) when an org has configured one, otherwise the active UI language (`useObjectTranslation().language`) so grouping and decimal marks follow a language switch. That second step is what covers the case the report was measured in — a fresh database, where the tenant localization endpoint has no locale to give.

  Grouping is now suppressed when a field declares `scale: 0` and carries no currency, which is what makes years, fiscal periods and other ordinals render plainly. This is an **interim default** with an accepted cost: a large scale-0 _count_ loses its separators too. It holds only until the spec gains an authorable presentation hint, which is being specified separately, contract-first; when that lands it overrides this heuristic.

  Three surfaces deliberately keep their separators, because a zero-decimal display there does not come from a field declaration: the dashboard `MetricWidget` (its decimals are parsed from a numeral.js format pattern, and its own contract calls the separators load-bearing — "`1,930,000` not `1930000`"), the `element:number` aggregate renderer, and every currency path including amounts whose currency code could not be resolved. An **undeclared** `scale` also keeps grouping — absent means "decimals unknown", not "integer".

  `formatCurrency`, `formatCompactCurrency` and `formatNumber` each take a new optional trailing `locale` argument. Existing calls are unaffected; omitting it now follows the runtime default rather than forcing US conventions.

- 58bebf6: Organization & invitation console: translate the English holdouts a zh session was left reading (#4474)

  Three families of string, one sweep over `console/organizations/`:

  - **Role names** now come from the single shared `ORG_ROLE_LABELS` map at every
    site. The role badges on the members and invitations pages were rendering the
    raw server identifier (`owner`) under a CSS `capitalize` that made it look like
    a label in English and left it untranslated everywhere else; the accept page
    did the same in its role row and inside its otherwise-translated sentence. The
    map's four `organization.roles.*` keys existed in no locale pack, so even the
    dropdown that did consult it fell through to English — all ten packs now carry
    them. An unrecognized role renders verbatim rather than blank.
  - **Server-echoed errors** are mapped by better-auth's stable `code`, never by
    matching its English text. `createAuthClient` was dropping that code for every
    `organization.*` call while preserving it for sign-in/sign-up, so the console
    had nothing to key on; all sixteen organization methods now go through the same
    `toAuthError` helper. Messages are unchanged — the code simply stops being
    thrown away. An unmapped code still shows the server's own sentence.
  - **Icon-only `aria-label`s** (member actions, copy invitation link, cancel
    invitation, and a fourth on the share-link copy button) are translated — for an
    icon-only control this is the only name a screen reader gets.

- 405e808: `pickLocalized` reads own properties only, and takes only string values, on every limb

  The resolver read four of its six limbs — the exact tag, the base language, `default` and `en` — with a bare bracket access. Bare access walks the prototype chain, so a locale that happened to name an `Object.prototype` member resolved to that member and the function stringified it into the label: `pickLocalized({ en: 'Pricing' }, 'constructor')` returned `function Object() { [native code] }`, and the same held for `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable` and `toLocaleString`. Those same four limbs also skipped the `typeof === 'string'` filter the regional and last-resort limbs already applied, so a non-string value short-circuited the chain and rendered as `[object Object]`.

  Both guards now apply uniformly. A guarded limb **misses** rather than aborting the resolution, so an unusable entry falls through to the next limb exactly as an absent one does — `pickLocalized({ en: 'Pricing' }, 'constructor')` is now `'Pricing'` (the `en` limb), and only a map with no usable entry at all resolves to `''`. An empty-string value is still a hit, because `''` is a label the author wrote.

  No real language tag can observe this: no BCP-47 tag is an `Object.prototype` member, and the inline locale map is declared `z.record(<tag>, z.string())`, so every in-contract input resolves byte-identically to before. What it changes is agreement with the backend twin `resolveI18nLabel` (objectstack#6765), which shipped with exactly these two narrowings recorded as deliberate departures from this function because on a server the locale can arrive in an `Accept-Language` header. That recorded rule divergence is now zero; the only remaining difference is how each side spells a miss (`''` here for a text node, `undefined` there for a producer's fallback chain), which is pinned as an identity in the cross-resolver parity table.

- c0f9a4b: Studio surfaces the runtime authoring gate's advisory findings instead of discarding them client-side

  The framework's runtime authoring gate produces two kinds of verdict on a metadata write. Errors become a 422 and the author sees them. Advisories ride a **200** — the save succeeded, the row persisted, the version bumped — and until objectstack#7435 the server dropped them into a deduped `console.warn` behind a process-level set. That landing put them on the wire as an optional `advisories[]` on the save response, emitted only when non-empty, and objectui was still throwing them away one layer further out: `MetadataClient.save` parsed the body, returned it as an opaque `T`, and every call site awaited it for its side effect and discarded the value.

  The measured case the fix is built on: a `nightly_purge` flow whose only defect is a `delete_record` node with `multi: true` and no filter yields `errors = 0 / advisories = 1`. The save returns 200, the flow goes live, and nothing anywhere tells the author it deletes every row. That matters most for exactly the authors Studio serves — a Studio tenant or an MCP/AI author has no `os lint` and no CLI config for `sys_metadata` overlay rows, so this gate is not the weakest of four doors, it is the only one.

  `MetadataClient` now carries an `onSaveAdvisory` sink, invoked after a save whose response carried a non-empty `advisories[]`, and the console wires it in `useMetadataClient` — the one hook every app-shell write path takes its client from, so a single wiring covers `ResourceEditPage`, `StudioDesignSurface`, `EmbeddedItemEditor`, `DatasourceResourcePage`, `ObjectHooksPanel` and any future call site rather than a toast copied into twenty of them. The finding shape is re-exported from `@objectstack/spec` (`RuntimeAuthoringIssue`) rather than restated, so it cannot fork from the 422 `issues[]` it deliberately shares a declaration with.

  The affordance is the warning tier and says "Saved" first. A successful save that reads as a failure is the specific defect this surface must not ship, so the toast acknowledges the write, lists `rule` + `message` + `hint` per finding with `where` as secondary context, and renders that text **verbatim** — `message` and `hint` are server prose composed by the gate's rules, not i18n keys. Only the frame around them is translated (`console.saveAdvisoryTitle`, ten packs). The sink is best-effort in both directions: a malformed finding is dropped rather than printed as blanks, and a throwing renderer cannot turn a save the server already committed into an error.

  **What this does not surface yet, and why.** Studio's designer saves as a **draft** on every edit, and drafts are never gated — the framework returns at its D1 early-return (`if (args.state !== 'active') return null`) before running a single rule, so a draft save produces no findings at all rather than producing some that get withheld. The publish step that promotes a draft to active _does_ run the gate, but the publish route returns no `advisories` field until objectstack#7294 lands. So a draft-then-publish flow renders nothing today, at both of its doors, for two different reasons; the active-mode save door renders findings now. That gap is pinned as a test rather than left for a reader to rediscover.

- d46f9b8: i18n: `createSafeTranslation`'s provider-less fallback now honours a call site's inline `defaultValue`

  `fallbackT` looked its key up in the hook's hand-written `defaults` map and, on a miss, rendered the
  **raw key** to the user — then ran every option, `defaultValue` included, through the interpolation
  loop as if it were a `{{defaultValue}}` variable. So `t('perm.facet.none', { defaultValue: 'None' })`
  showed `perm.facet.none` on a host with no `I18nProvider`, which is a supported scenario (standalone
  embedding and tests are the whole reason this factory exists).

  The lookup order is now `defaults[key]` -> a string `defaultValue` -> the key, matching i18next,
  which serves the provider path: the defaults map is the pack value's stand-in here, so it keeps the
  pack's winning position. `defaultValue` is also excluded from the interpolation loop as a reserved
  name — it selects the string, it does not fill holes in one. Non-string `defaultValue` is ignored.
  The provider path is untouched.

  Measured over all 26 `createSafeTranslation` hooks in the repo: 27 keys reach a hook whose defaults
  map lacks them, 21 of those carrying an inline `defaultValue` that used to be dropped (16 keys in
  `plugin-detail` alone). Those 21 now render their English instead of a raw key on provider-less
  hosts; the other 6 pass no inline default and still need a map or pack entry.

- 2fea4d2: `detail.showEmptyRelated` renders Russian and Arabic again — the "+N empty" button no longer falls through to English at the counts it takes most often

  This was the repo's only pre-existing i18next plural family, and all ten packs defined exactly two slots: `_one` and `_other`. i18next asks `Intl.PluralRules` for the one suffix a language needs for that number, and when the pack has no such slot it walks `fallbackLng` to `en`. Russian has four plural categories and Arabic six, so `ru` at counts 2-4 (`few`) and 5-20, 25-30, … (`many`), and `ar` at 0, 2, 3-10 and 11-99, resolved nothing locally and rendered the English string. The call site is the collapsed-empties button in the record detail's reference rail, whose count is the number of empty related lists — 2 to 4 are the most common values it ever takes, so a Russian user essentially always read English.

  The fix is a base key (no suffix) beside the two existing slots, in all ten packs. The base key is always in i18next's lookup chain, so every category a pack did not enumerate resolves to it, in that pack's own language — and, unlike adding `_few`/`_many` to `ru` alone, it keeps the ten packs' key sets identical, which full key parity requires. Same shape objectui#3546 slice six established for `perm.facet.*`. Where the base key is genuinely reachable it carries a count-invariant phrasing: `ru` uses the «Существительное: {{count}}» form the pack already writes 22 times, `ar` the «{{count}} مفرد(جمع)» marker it uses throughout. For `en`/`de`/`zh`/`ja`/`ko` the base key cannot be reached at all (their categories are covered by the two existing slots) and repeats `_other` for parity; `fr`/`es`/`pt` reach it only from a million up, where the plural form is already correct. No English copy moves.

  The provider-less path needed the same row for a different reason: `createSafeTranslation`'s fallback resolves `defaults[key]` literally and never appends a plural suffix, so the two suffixed rows in plugin-detail's defaults table were unreachable through it and that path answered with the raw key. It now carries the base key too.

  Parity across packs turned out to be necessary and not sufficient — ten identical key sets were green throughout, because the defect is one level below key names: the slot the language needs is not in the set. So the invariant "a plural family must carry a base key" is now asserted over all ten packs in `all-locales-key-parity.test.ts`, where it is pack-intrinsic and fails at PR time without needing a call site to exist. It went red on all ten packs before this change and names the family that is missing its base.

- 7f1cb33: List sort: the relational hint stops recommending a formula field, the one type the server refuses to sort by

  The Sort panel withholds columns that link to another record and explains why, and the last sentence of that explanation named the remedy: _add a formula field holding it_. A formula field is exactly what the platform will not order by. The server keeps `UNMATERIALIZED_SORT_TYPES = new Set(['formula'])` and, since objectstack#6994, a sort naming one is a hard `400 INVALID_SORT` — before that it degraded silently, returning every row with `asc` and `desc` byte-identical. So an author who read the hint, followed it, and built a formula field arrived at a refusal; and since #4243 withheld formula fields from this very picker, at a field the panel does not offer either. Two doors, opposite advice, for one problem.

  The remedy sentence now names a **stored, denormalised field — written when the source changes** — and rules the formula field out in as many words: it is virtual, no column is stored for it, and the server refuses to sort by one. That is deliberately the server's own vocabulary rather than a third phrasing of the same fact: objectstack#6924 and objectstack#6994 settled on one wording across the refusal doors so an author refused twice is not sent two different ways, and this is the UI door of that same set. The first half of the hint — why relation columns are withheld at all — is unchanged.

  All ten locale packs move together, as `check:i18n-drift` requires of any `en` edit. The same sentence also lives in `plugin-list`'s provider-less fallback table, which is what renders when the component is used outside an `I18nProvider`; it is updated to match `en` byte for byte, because a pack-only reword would have left the retired advice on exactly the surface this fixes.

- 2e3b0c0: fix(list): an `OBJECT_API_DISABLED` list request renders an honest cannot-work state instead of the empty state

  A list pointed at an object whose `enable` block withholds the API rendered its ordinary
  empty state, so _"this page cannot work, and never could"_ reached the user as _"you have no
  records"_ (objectui#4408). The reported instance — `Setup › Advanced › Signing Keys`, whose
  `sys_jwks` declares `enable.apiEnabled: false` — could not load for any persona and said so
  to nobody. That is also why the upstream defect objectstack#7544 survived review for its
  whole life: a merely unpopulated page invites nobody to click through.

  The masking had two halves, in two packages, and neither package could see the other:

  - **`@object-ui/data-objectstack`** (minor — see the grading note below) — `find()` degraded
    **every** 404 into `{ data: [], total: 0 }` and memoised the resource, so the denial arrived
    at the surface as a successful empty result, indistinguishable from a genuinely empty
    object. The two `enable`-block denials are now let through instead: `OBJECT_API_DISABLED`
    (404) and `OBJECT_API_METHOD_NOT_ALLOWED` (405). The memo skips them too — absorbing one
    would have pinned the object to "empty" for the rest of the session.
  - **`@object-ui/plugin-list`** — the load-error panel gained an `api-disabled` kind. The 405
    half was never swallowed, so it already reached this panel, but classified as `network`:
    _"check your connection and try again"_ for a condition no retry can change. It now says
    the object is not exposed through the API, that this is a setting on the object rather than
    a permission, and it offers **no Retry** button, because every retry re-fetches the
    identical refusal.

  Both denials are pure functions of the object's metadata — no user, no permission, no
  context — so neither is transient or per-user, which is exactly the case where a silent empty
  state is most misleading. Discrimination is on the ADR-0112 `code`, never the status: a
  missing collection, a missing record and a disabled object are all 404.

  **A genuinely empty object still renders the ordinary empty state**, and a backend without an
  optional collection still degrades to empty — pinned in both directions, at the adapter, at
  the view, and once end-to-end over a real adapter and a real `ListView`.

  Also closes a code-propagation gap on the same path: `find()`'s raw `$expand`/`$search`
  branch bypasses `@objectstack/client` and hand-rolled its own error, stamping only `status`.
  It now carries the ADR-0112 envelope (`code` + `httpStatus`), so a denial arriving on the
  branch a list takes whenever it expands a lookup or runs a search is no longer anonymous.

  New strings: `list.loadErrorApiDisabledTitle` / `list.loadErrorApiDisabledMessage`, in the
  `en` pack and mirrored in the list defaults map.

  ## Grading note — why `@object-ui/data-objectstack` is **minor** and not patch

  Two independent reasons, either of which is sufficient under this repo's precedent
  (objectui#4403 / #4177, and #4485's grading of `@object-ui/core`'s `toDomProps` lift):

  1. **The emitted `.d.ts` grows two NEW exports.** `isApiAccessDeniedError(error: unknown):
boolean` and `API_ACCESS_DENIED_CODES` (the readonly tuple
     `['OBJECT_API_DISABLED', 'OBJECT_API_METHOD_NOT_ALLOWED']`) are added to the package's
     public surface. Additive surface growth is minor.
  2. **Observable behaviour on a published API moves.** `ObjectStackDataSource.find()` now
     **REJECTS** for the two `enable`-block denial codes where it previously **RESOLVED** with
     `{ data: [], total: 0 }`. No signature changed and nothing was removed, but a caller that
     relied on those two codes arriving as a successful empty result now receives a rejected
     promise carrying `code` + `httpStatus`, and must handle it.

  Deliberately unchanged, and still resolving to an empty result exactly as before: a bare 404
  with no code, `OBJECT_NOT_FOUND` (still memoised) and `RECORD_NOT_FOUND`. The behaviour move
  is scoped to the two denial codes named above and to nothing else.

  Not major: this follows AGENTS.md's version-alignment rule — objectui's major tracks
  `@objectstack`'s, so this repo's own breaking semantics are declared as minor with the change
  described in the body, which is what this note is.

- 31ab1ac: fix(print): `window.print()` produces a usable page, and the Print buttons say what they do

  The list, report and dashboard Print controls were bare `window.print()` calls with no
  print stylesheet, so the browser printed the whole console — sidebar, top bar, chat rail,
  toasts — with the data table clipped to a single viewport. With no label to the contrary
  they were being accepted against "export to PDF" requirements, which they have never been.

  - `@object-ui/app-shell/styles.css` gains a shared `@media print` block: it hides the shell
    chrome, prints the active content area full-width, releases the viewport-height flex chain
    so long tables paginate instead of clipping, repeats table headers on every sheet, and
    neutralises dark mode (which otherwise prints white-on-white). One sheet serves list,
    report and dashboard.
  - The list and report Print buttons carry a tooltip and accessible name stating that they
    open the browser's own print dialog and are not a PDF export (new `common.printDialogHint`,
    translated in all ten locale packs).
  - The dashboard's `export_dashboard_pdf` action no longer toasts "Preparing PDF export…" —
    it names the print dialog it actually opens (`dashboardActions.pdfPreparing` is replaced by
    `dashboardActions.printDialogOpening`).

  No control was removed and no headless detection was added. A real print/PDF primitive
  remains out of scope (`objectstack-ai/objectstack#1301`, closed NOT_PLANNED).

- 06915b0: fix(i18n): every date branch threads the active locale, so a `zh` session no longer renders half its dates in English

  Date rendering had two locale channels and only one followed the user's
  language, so the same row could read `逾期 6 天` in one column and `In 3 days`
  in the next, with a datetime column showing `8/11/2026 12:00 am`
  (objectui#4468).

  The overdue phrase resolves through the translate fn (the active UI language),
  while every `Intl` branch took its tag from the raw tenant locale
  (`useLocalization().locale`) — which is `undefined` on any workspace that never
  configured one, and `undefined` makes `Intl` use the _machine's_ locale.
  `DateTimeCellRenderer` passed no tag at all.

  Every date-formatting site in `@object-ui/fields` now resolves through the one
  existing channel, `useDisplayLocale()` (tenant regional default → active UI
  language → `en`): `DateCellRenderer` (relative past, relative future, near-today
  and the beyond-±7-days absolute fallback), `DateTimeCellRenderer`, the read-only
  `DateField` / `DateTimeField` / `FormulaField` faces, and the sub-grid's
  temporal cells. English output is unchanged, and the already-localized overdue
  wording is untouched.

  No public signature changed. `@object-ui/i18n` carries a documentation
  correction only: `useDisplayLocale`'s docstring claimed `DateCellRenderer`
  already formatted from this channel, which was the very thing that was not true.

- ff84b05: Stop the report config panel being titled "Title", and the view-settings colour section "Color"

  Two call sites asked for a key whose value was written for a different slot, so the rendered copy was wrong (objectui#4118, surfaced by objectui#3810's census).

  `ReportConfigPanel` used `report.editor.title` for both its heading and the accessible name of its `role="complementary"` landmark. That key is the label of the report's Title _field_ — `report.editor.titlePlaceholder` ('e.g. Pipeline by Quarter') sits directly under it in the pack. So the panel was headed "Title", and a screen reader announced a complementary region named "Title", which says nothing about what the region is. A new `report.editor.panelTitle` ('Edit report' — what the call site's own dead fallback said before objectui#3810 aligned it to the pack) now names the panel, in all ten locale packs.

  `ViewSettingsPopover`'s colour section used `list.color`. On the wide toolbar `ListView` already uses both keys correctly for the two slots of this one feature: the compact `Paintbrush` button is `list.color` ('Color') and the panel it opens is headed `list.rowColor` ('Row Color'). This popover is that same panel on the collapsed/`compactToolbar` surface, so it now takes `list.rowColor` — an existing key, no pack change.

  No `en` value of an existing key changed; `scripts/check-i18n-en-drift.mjs` reports 0 en values changed, 1 key added.

- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f279deb]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [613b167]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [7e4f0e5]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [49ae9f4]
- Updated dependencies [2459a3e]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [bb68488]
- Updated dependencies [9461dd3]
  - @object-ui/core@17.5.0

## 17.4.0

### Patch Changes

- 7864f03: Backfill the auth family's 54 missing locale keys — `auth` 26 + `oauth` 16 + `acceptInvitation` 12 (objectui#3546, slice three)

  `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) measured 54 keys that a
  `t()` call site asks for and that **no locale pack defined** — 54 distinct keys at
  54 call sites across the console's six auth pages. All 54 carried an inline
  `t(key, { defaultValue: 'English' })`, which is exactly the objectui#3517 class:
  English rendered correctly, and **all ten languages were stuck on it** for
  months. Nothing here rendered a raw key — slice one (PR #3583) held those sites.

  What that meant on the page: a `zh` user reaching `/login` and switching to the
  phone/SMS branch got "Email or phone number", "Get code", "Resend in {seconds}s"
  and "Sign in with password instead" in English; the whole `/oauth/consent` screen
  — including the four scope sentences describing what a third-party client is
  about to be granted — was English-only; so was the `/accept-invitation` page and
  the device-authorization dead end.

  - **`packages/i18n/src/locales/en.ts`** gains the 54 keys. `oauth.consent.*` and
    `acceptInvitation.*` are new top-level namespaces; the other 26 extend
    `auth.login`, `auth.forgotPassword`, `auth.device` and `auth.verifyEmail`.
    Every one of the 52 keys whose call site carries a **string** `defaultValue`
    gets that exact string, byte for byte (52/52, script-compared), so the pack
    path and the inline-default path cannot diverge. The two remaining keys —
    `oauth.consent.title` / `oauth.consent.request` — have **template**
    defaultValues, where byte identity is structurally impossible (JS `${…}` vs
    i18next `{{…}}`); both take the interpolation contract the call site actually
    declares in its options.
  - **The nine other packs** get real translations, each evidenced against a
    neighbour key in the same pack (fr's space before `?`/`:`, de's en dash, ru's
    ё, ar's verb-first placement so an RTL sentence does not open on a Latin
    client name, zh's full-width punctuation). The one string all ten packs share
    is `phonePlaceholder` — the E.164 example number, treated like the
    `name@example.com` the packs already keep untranslated.
  - **`scripts/i18n-call-site-key-baseline.json`** loses exactly those 54 entries
    (163 → 109). The file is a ratchet: an unfixed key missing from it fails the
    build, and a fixed key still listed fails it too.
  - **No component changed.** An AST sweep of all 122 call sites in these three
    namespaces found zero dead `t(key) || 'English'` fallbacks (the construct
    slice one had to delete from `ObjectView.tsx`, where i18next's key-as-value
    return made `||` unreachable).

  Two holes here are **not** i18next's and must survive translation intact:
  `resendOtpCountdownText` carries `{seconds}` in single braces because
  `packages/auth/src/LoginForm.tsx` and `ForgotPasswordForm.tsx` substitute it with
  a literal `.replace()`, and `oauth.consent.request`'s `{{suffix}}` arrives
  pre-formatted from the page. Both are pinned in
  `packages/i18n/src/__tests__/auth-namespace-3546.test.tsx`, in both directions.

- f5f8744: Backfill the `console` namespace's 41 missing locale keys plus the `console.ai.group.` template family (objectui#3546, slice four)

  `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) measured **41 distinct
  keys at 47 call sites** under `console.*` that a `t()` call site asks for and
  that **no locale pack defined** — five of those keys have more than one site
  (`console.ai.dock.maximize` has three), which is why the denominator is measured
  and never counted by hand. All 47 carried an inline
  `t(key, { defaultValue: 'English' })`, so this is the objectui#3517 class:
  English rendered correctly, and **all ten languages were stuck on it**. Nothing
  here rendered a raw key — slice one (PR #3583) held those sites.

  What that meant on the page: a `zh` user opening `/ai` got "Waiting for
  server…", "Still working…" and "Connection lost — reconnecting…" in the
  connection banner, all ten "Designing your app…" progress hints in English, and
  "Built" / "Not yet built" / "Published" / "Publish failed" on the plan card; the
  ChatDock's whole chrome (title, resize handle, collapse, "Open full page") was
  English including two `aria-label`s; the conversation sidebar's date headers read
  "Today" / "Yesterday" / "Previous 7 days"; a mistyped URL produced an English
  "Page not found"; and the `?` shortcuts dialog's AI group was English inside an
  otherwise translated table. Two of these strings ("Not yet built", "TODAY") are
  named in objectui#2458's mixed-language list.

  - **`packages/i18n/src/locales/en.ts`** gains 46 keys: the 41 measured ones plus
    the five members of the `console.ai.group.` family. `console.notFound` is a new
    sub-namespace; the rest extend `console.shortcuts` and `console.ai` (with new
    `console.ai.dock`, `console.ai.designingPlanHint` and `console.ai.group`
    objects). Every one of the 41 measured keys takes its call site's inline
    `defaultValue` **byte for byte** (46/47 sites, script-compared), so the pack
    path and the inline-default path cannot diverge.

    - The one site that cannot match is `ChatDock.tsx:563`, where a single key
      (`console.ai.dock.open`) carries two different English strings: the
      `aria-label` says `Open assistant` and the `title` says
      `Open assistant (⌘⇧I)`. A key can hold one value, so `en` takes the
      `aria-label` spelling — an accessible name must not carry a glyph run that
      screen readers announce as symbols, and `⌘` is a mac-only glyph that a
      _language_ pack cannot vary per platform. The tooltip therefore stops
      advertising the shortcut; recorded on objectui#3810 (whose class this
      divergence joins) rather than papered over.

  - **`console.ai.group.` leaves the ratchet's `missingPrefixes` (4 → 3).** It is a
    template key — `` t(`console.ai.group.${group.key}`) `` in
    `ConversationsSidebar.tsx:277` — whose static head matched no `en` key, so every
    expansion missed. Its value surface is the **closed** `ConversationGroupKey`
    union, so the repair is an enumeration of all five members, not a wildcard; a
    test reads the component's own union and label map and fails if a sixth bucket
    is ever added without a key.

  - **The nine other packs** get real translations, each evidenced against its own
    `console` neighbours: `zh` full-width punctuation and the pack's single-em-dash
    status-line style, `ja`/`ko` the pack's `AI ` spacing, `de` formal _Sie_ and
    its `Wird …` progressive, `fr` straight apostrophes, `es` _usted_ (as the
    `console.ai` neighbourhood already uses), `pt` the pack's `off-line` spelling,
    `ru` ё orthography, `ar` verb-first phrasing that never opens an RTL sentence
    with a Latin token. Where `en` repeats a string the packs already translate
    (`Go back`, `Publish failed`, `Try again`, `Back to home`, `Assistant`,
    `Today`, `Yesterday`), the existing neighbour's wording is reused rather than
    re-invented.

  - **`scripts/i18n-call-site-key-baseline.json`** shrinks by exactly 42 entries
    (41 keys + 1 prefix family): 109 → 68 keys, 4 → 3 prefixes.

  No component changed: an AST sweep of all 308 `console.*` call sites in the repo
  found zero dead `t(key) || 'English'` fallbacks among this slice's keys.

- 69becd2: `de` approvals inbox no longer shows two quote typographies on one screen

  Three `approvalsInbox` values quoted the record title with ASCII straight quotes
  on **both** sides while their own sibling `approvalsInbox.approveOneTitle` used
  the correct German pair (U+201E low-9 opener, U+201C closer):

  | key                             | before                  | after                   |
  | ------------------------------- | ----------------------- | ----------------------- |
  | `approvalsInbox.rejectOneTitle` | `"{{title}}" ablehnen?` | `„{{title}}“ ablehnen?` |
  | `approvalsInbox.inlineApproved` | `"{{title}}" genehmigt` | `„{{title}}“ genehmigt` |
  | `approvalsInbox.inlineRejected` | `"{{title}}" abgelehnt` | `„{{title}}“ abgelehnt` |

  A German approver therefore met both typographies in a single screen and inside a
  single operation pair — German quotes on the approve confirmation, typewriter
  quotes on the reject confirmation and on both inline toasts. `„…“` is the pack's
  own majority (50 paired spans) and DUDEN R11, so the three values were the
  outlier. Keys and the `{{title}}` placeholder are unchanged; this is a
  value-domain typography fix, and `en` (ASCII on both sides by design) is
  untouched.

  This is a **different defect shape** from objectui#3876, which paired a German
  opener with an ASCII closer. Because these three were ASCII on both sides they
  were self-consistent, so the pairing invariant objectui#3876 left behind could
  not see them — it scans forward from each `„`, and there was no `„` in them to
  scan from. The pack's straight-quote census being empty now lets that pin become
  strictly stronger: `de-quote-pairing-3876.test.ts` asserted an explicit
  three-key allowlist and now asserts that **no `de` value holds a U+0022 at all**,
  which covers both defect shapes and needs no per-key maintenance as new values
  land. The pack census moves from `„` 47 / `“` 47 / `”` 0 / `"` 6 to
  `„` 50 / `“` 50 / `”` 0 / `"` 0.

  None of the three i18n gates could have caught this: `all-locales-key-parity`
  compares key sets and placeholder shapes, `check-i18n-call-site-keys.mjs` only
  asks whether a key resolves, and `check-i18n-en-drift.mjs` fires on `en` value
  changes — these values were wrong from the day they landed, so no drift event
  ever existed. All three are value-blind by design, which is why the invariant
  lives in a test.

- 5e52495: German pack: the 20 values that closed the German opening quote with an ASCII straight quote now close it with `“`

  `packages/i18n/src/locales/de.ts` opened a quoted span with the German low-9
  quote `„` (U+201E) and closed it with the ASCII typewriter quote `"` (U+0022) in
  20 keys, so a German user read `Registerkarte „Alle Datensätze" anzeigen` — a
  mismatched pair. `search.resultsCount` showed it most plainly: the value ended
  `„{{query}}""`, the mismatched closer immediately followed by the TS string
  terminator.

  This was never a pack convention. Measured on `main@2937bcf7d` before the fix,
  the same file already spelled 23 spans the correct German way, `„…“` — the two
  styles sat side by side, in sibling keys of the same namespace. Every mismatched
  closer is now `“` (U+201C), which is what German orthography (DUDEN R11) and the
  majority of the file already used. Affected surfaces: the four empty states
  (object / page / dashboard / report not found), the search results header, the
  lookup "create named" action, four `console.objectView` strings, the home
  getting-started hint, the six `navigationSync` toasts, the local marketplace
  install toast, and the preview not-ready title.

  No other language pack and no `en` value changed — the counts are unchanged for
  every other locale, and the mismatch was measured only in `de`.

  ### Counted at landing, in two units

  The card reported "20 values" and the triage re-scan reported "22 mismatched
  pairs"; both are correct about different units, and the difference is now
  recorded rather than left to the next reader. 20 keys carried a mismatch;
  22 mismatch occurrences lived in them, because `navigationSync.renamedPage` and
  `navigationSync.renamedDashboard` each quote two names in one sentence
  ("Seite „alt“ in „neu“ umbenannt") and so contribute two each. Full-file counts
  before → after: `„` 45 → 45, `“` 25 → 47, `”` 2 → 2, `"` 28 → 6.

  ### The durable half, and why it is not the count equality the card proposed

  Three i18n gates run over these packs and none can see a wrong quote:
  `all-locales-key-parity` compares key sets and placeholder shapes,
  `check-i18n-call-site-keys.mjs` only asks whether a key resolves, and
  `check-i18n-en-drift.mjs` fires on `en` **value changes** — these values were
  wrong from the day they landed, so no drift event ever existed. Without a
  value-domain assertion the next backfill copies the mismatch from a neighbour
  again, which is exactly how these 20 accumulated.

  The card proposed asserting `count(„) === count(“)`. That is **false on the
  correctly fixed file** (45 vs 47) and would have sent the next reader hunting a
  bug that is not there: two values in this pack, `grid.import.savedMappingHint`
  and `grid.import.savedMappingPreviewNote`, are still untranslated English prose
  and quote in the English style `“…”`, so their two `“` are legitimate _openers_.
  The invariant that is pinned instead is the pairing itself — for every `„`, the
  first quote character that follows must be `“` — backed by the arithmetic
  identity `count(“) === count(„) + count(”)`, which stays true if those two values
  are later translated (47 === 47 + 0) and breaks the moment a mismatch returns.
  Both carry a presence guard so a broken import cannot make them pass by scanning
  nothing.

- b750823: `preview.draftBar` speaks one second person in `es` — the draft-preview banner no
  longer switches from tú to usted when a Spanish user publishes (#3844)

  `DraftPreviewBar` renders two mutually exclusive sentences in the same strip of
  the same banner: `message` while there are unpublished changes, `messageClean`
  once there are none. In `es` the two disagreed on register — `message` was tú
  (`estás viendo`, `publiques`) while `messageClean` (`ve`) and `sampleDataBody`
  (`Está`, `su`, `Publíquela`) were usted. So a Spanish user who pressed Publish
  watched the banner change person: same component, same position, same session.

  This is a third defect class in the value-domain blind spot behind #3582 and
  #3625, and no gate in the repo can see it. Both `es` values are correct
  translations of their `en` sentences — nothing is missing, nothing is stale, and
  nothing holds English. The inconsistency is _internal to one pack, on one UI
  surface_: `scripts/check-i18n-call-site-keys.mjs` only asks whether a key exists
  in `en`, `all-locales-key-parity` compares key sets and placeholder shapes and
  never reads values, and `scripts/check-i18n-en-drift.mjs` only fires when an `en`
  value moves — these two `en` values never moved.

  `message` is the value that changes, because usted is what the pack already says
  everywhere around it: the `es` pack censuses 102 usted markers to 30 tú (tú being
  the marked exception, concentrated in the auth, report-editor and organizations
  neighbourhoods that #3546 slice two deliberately ruled informal); the other three
  strings of this same object were already usted; and #3546 slice five gave the 19
  new `preview.unpublishedBar.*` / `preview.history.*` keys usted on the strength
  of `home.pendingDrafts.published` ("¡Publicado! Sus cambios están activos."). Two
  smaller divergences inside the same sentence are closed with it, so the banner's
  two halves stop disagreeing about wording as well as person:

  - **`—` instead of `:`** in `messageClean`, matching `en`, where both sentences
    open `Draft preview — `. That is the whole of `messageClean`'s diff.
  - **`activo` instead of `en producción`** for "live". The pack spells this concept
    `activo` in four neighbouring places including `publishCta` in this very object
    ("Publicar para verlo activo"), and it reserves _producción_ for the actual
    production environment (`environment.entitlement.planLockedBody`), so the
    outlier was ambiguous as well as inconsistent.
  - **`Vista previa del borrador`** as the shared opening, `del` being the form
    `messageClean` already used.

  No `en` value changes (the en-drift gate reports 0), no key is added or removed
  (so `all-locales-key-parity` is untouched by construction), and the nine other
  packs are not touched. The diff is two values in one file.

  Re-voicing the whole `preview` namespace to tú was considered and rejected — a
  much larger change that would collide with the adjacent `marketplace.*` (9:0
  usted) and `console.ai.*`. `preview.empty.notReadyDescription` therefore stays tú
  here, since #3844's ruling is this banner only; it is filed as #3875 rather than
  waved through, because `PreviewDraftEmptyState` renders _underneath_
  `DraftPreviewBar` and so those two show usted and tú on screen at the same time.
  After this change the `preview` namespace is 23 usted to that 1 tú.

  A gate that checks "one register per namespace" is deliberately **not** here:
  recognising usted vs tú needs real morphology, and token matching demonstrably
  cannot — in this pack the token `revisa` is usted in `console.ai.empty.build`
  (es.ts:1365, "…y usted revisa y publica.") and tú in
  `auth.forgotPassword.successTitle` (es.ts:1918, "Revisa tu correo electrónico"),
  the same eight letters in opposite registers. The neighbourhood boundary such a
  gate would police is human judgement anyway — #3546 slice two's "same rule,
  different answer". A new `draftBar-es-register-3844.test.ts` pins the four `es`
  values byte for byte instead, plus the `en` literals, so a future reword of
  either `en` sentence fails in the same PR that reworded it.

- ac2139c: `grid.import` saved-mapping copy is now translated in ko / de / fr / es / pt / ru / ar instead of served as English

  Five keys — `grid.import.savedMapping`, `chooseSavedMapping`, `manualMapping`,
  `savedMappingHint` and `savedMappingPreviewNote` — were **byte-identical to `en`**
  in seven of the nine non-`en` packs, 35 values in all. Only zh and ja had been
  translated, and two of the five are multi-clause explanatory sentences rather
  than placeholders or proper nouns, so this was not a deliberately untranslated
  term: a German, French, Spanish, Portuguese, Russian, Korean or Arabic user
  picking a saved mapping in the import wizard read English.

  None of the three i18n gates could see it. `all-locales-key-parity` compares key
  sets and placeholder shapes, so English passed perfectly; the call-site gate only
  asks whether a key resolves; `check-i18n-en-drift.mjs` fires on an `en` **value
  change** and these keys arrived in the packs already English, so no drift event
  ever existed. objectui#3920 also proposed a general "no non-`en` value may be
  byte-equal to `en`" gate; that is deliberately not part of this change, because
  values like `auth.*.emailPlaceholder` (`name@example.com`),
  `fields.image.counter` (`{{current}} / {{total}}`) and
  `grid.import.templateFileName` are byte-equal across packs correctly, and
  objectui#3880 records the other face of the family. The five keys are pinned by
  name instead.

  Each translation reuses vocabulary its own pack already ships rather than
  inventing a second word for the same concept: `stepMapping` for "mapping"
  (Zuordnung / Correspondance / Asignación / Mapeamento / Сопоставление / تعيين /
  매핑), `legacyFallbackNotice` for "type coercion" (Typkonvertierung / conversion
  de type / conversión de tipos / conversão de tipos / приведение типов / تحويل
  الأنواع / 형 변환), `view.readonlyTooltip` for "read-only", and `validateHint`
  for "on the server". `es` follows the usted ruling objectui#3844 measured for
  this pack; `pt` is the pack's own pt-BR (mapeamento / salvo / no servidor);
  `ru` keeps its ё; `fr` keeps the straight apostrophe and the space before colon
  and semicolon; `ar` punctuates with U+060C and U+061B; `ko` uses the 은(는) /
  이(가) spelling its `fields.file.exceedsMaxSize` already uses for a placeholder
  whose particle cannot be resolved at authoring time.

  The quote around `{{name}}` follows each pack's measured majority for wrapping a
  placeholder — de `„…“` (38 spans against 3 ASCII), fr `« … »` with an ASCII
  space (25 against 18), ru `«…»` (23 against 18), and ASCII `"…"` for ko (38:0),
  pt (39:0), es (22:19) and ar (27:15). The card cited
  `residue-namespaces-3546.test.tsx` as pinning "the rest ASCII", but that line
  pins the `empty.*` family only and its own comment scopes the rule to "the
  sibling value in the SAME pack"; `grid.import` has no other quoted span, so the
  census one ring out decides.

  Germanising the two `de` sentences also closes the 45/47 gap
  `de-quote-pairing-3876.test.ts` documented: that pack's census moves from
  `„` 45 / `“` 47 / `”` 2 to `„` 47 / `“` 47 / `”` 0, exactly as that file's header
  predicted, and its `count(“) === count(„) + count(”)` identity still holds. The
  three literal counts in it were updated and the two keys are now pinned by name
  there, so `rdqKeys === []` cannot become an assertion that passes because nothing
  is produced.

  `en`, `zh` and `ja` are untouched, and `grid.import.transform` — the sixth key in
  the same block, English in the same seven packs, and the third column header of
  the very table this hint sits above — is deliberately left alone, filed as
  objectui#3938 and pinned as still-English so the number cannot drift while that
  issue waits its turn.

- b14ab3a: `grid.import.transform` is now translated in ko / de / fr / es / pt / ru / ar instead of served as English

  The third column header of the import wizard's saved-mapping summary was
  **byte-identical to `en`** — the literal string `Transform` — in seven of the
  nine non-`en` packs. zh (`转换`) and ja (`変換`) had translated it, which is what
  rules out the "deliberately untranslated term" reading; this is the sixth key of
  the same six-line block objectui#3920 / PR #3936 fixed the other five of, and it
  was left out of that card only to keep its 5-keys / 35-values census verifiable.

  | pack | before      | after            | the pack's own anchor                                                                    |
  | ---- | ----------- | ---------------- | ---------------------------------------------------------------------------------------- |
  | ko   | `Transform` | `변환`           | `savedMappingHint` "이름 변경 + 변환 + 형 변환"                                          |
  | de   | `Transform` | `Transformation` | `savedMappingHint` "Umbenennung + Transformationen + Typkonvertierung"                   |
  | fr   | `Transform` | `Transformation` | `savedMappingHint` "le renommage + les transformations + la conversion de type"          |
  | es   | `Transform` | `Transformación` | `savedMappingHint` "el cambio de nombre + las transformaciones + la conversión de tipos" |
  | pt   | `Transform` | `Transformação`  | `savedMappingHint` "renomeação + transformações + conversão de tipos"                    |
  | ru   | `Transform` | `Преобразование` | `savedMappingHint` "переименование + преобразования + приведение типов"                  |
  | ar   | `Transform` | `التحويل`        | `savedMappingHint` "إعادة التسمية + التحويلات + تحويل الأنواع"                           |

  Each value is the **singular of the word the pack already uses** for `en`'s
  plural "transforms" in `grid.import.savedMappingHint` — the sentence
  `SavedMappingSummary` renders directly above this header. That is the anchor
  rather than `legacyFallbackNotice`'s term, because `en`'s own sentence lists
  "transforms" and "type coercion" as two different server-side operations and
  `legacyFallbackNotice` is about the second: reusing de "Typkonvertierung", ko
  "형 변환" or ar "تحويل الأنواع" for this header would name the wrong operation.

  Why it was worth a card of its own rather than waiting for a general gate: this
  value is not a hidden string. It is the third `TableHead` of
  `SavedMappingSummary`, sitting in one row with `csvColumn` and `mapsTo`, which
  were always translated — so a German user read `Spalte` / `Zugeordnet zu` /
  `Transform`, two languages in a single header row, directly under the German
  hint PR #3936 had just landed. Before that PR the whole panel was English and
  therefore at least self-consistent.

  The three i18n gates are value-blind here exactly as they were for
  objectui#3920: `all-locales-key-parity` compares key sets and placeholder shapes
  (the key was present with no placeholder, so English passed perfectly), the
  call-site gate only asks whether a key resolves, and `check-i18n-en-drift.mjs`
  fires on an `en` **value change** — this value entered the seven packs already
  English, so no drift event ever existed. `en`, zh and ja are untouched, and the
  pin PR #3936 left in `gridImportSavedMapping-i18n-3920.test.ts` asserting these
  seven were "still English" has been replaced by the translated pin it asked for.

- 8c60819: The inbox popover now spells out what the bell badge is made of

  The bell badge is `unread notification topics + pending approvals`, clamped to
  "9+" above nine. As one number it is unexplainable: objectstack#7213 measured
  Home's "pending approvals" card saying 8 while the bell said "9+", and read that
  as the two counts disagreeing — they never did, the bell was simply carrying a
  second addend the user could not see.

  The popover already tabs the two streams and puts a count pill on each tab, so
  the split was partly visible — but those pills clamp at "9+" too. A loaded
  console therefore showed three "9+"s that reconcile to nothing, which is why
  sectioning alone did not close this.

  A breakdown line under the popover header now states the exact, unclamped
  addends beside the exact total — `15 total · 12 notifications + 3 pending
approvals`. The approvals half is the same `pendingApprovalsCount` the Home card
  and the Approvals Inbox tab read, so the number a user reconciles against is
  literally the one they see elsewhere.

  The badge formula, the counting APIs and the "9+" clamp on the badge itself are
  unchanged — this is a display fix. Three new keys
  (`notifications.badgeTotal` / `badgeNotifications` / `badgeApprovals`) land in
  all ten locale packs. They interpolate named placeholders (`{{total}}`,
  `{{unread}}`, `{{approvals}}`) rather than i18next's `{{count}}`, which would
  additionally drive plural-key resolution these packs carry no forms for.

- e64a52e: 回填 `perm` + `home` 两命名空间 14 个缺失语言 key,十个语言包补齐(#3546 切片六)

  `scripts/check-i18n-call-site-keys.mjs` 实测:14 个不重复 key / 14 个调用点(1:1),分布在权限集
  记录的授权面摘要(`PermissionFacetLink`,ADR-0056 P1)与"一键发布全部草稿"的其余几条 toast
  (`usePublishAllDrafts`:ADR-0038 L3 探针健康、示例数据健康、ADR-0066 ⑨ 能力引用巡检)。

  这 14 处都带内联 `defaultValue`,所以英文一直正常渲染,**十种语言都翻不了** —— 修的是这一半。
  英文字串一字未改:9 处静态 `defaultValue` 与 en 逐字节相同;另外 4 个计数标签(对象 / 字段规则 /
  RLS 策略 / 标签页规则)的 `defaultValue` 是带英文单复数分支的模板串,改用 i18next 复数族
  (`key` + `key_one`)后逐个计数渲染结果与模板串一致。

  复数族刻意带**基础 key** 而不是只写 `_one`/`_other`:i18next 只按语言的 CLDR 类别取一个后缀,
  取不到就沿 fallback 链落到 `en`。ru(few 2-4、many 5-20)与 ar(two、few 3-10、many 11-99)
  恰好在用户最先遇到的计数上会因此显示英文;基础 key 让这些类别落回**本语言**。

- 844d17f: Backfill the `marketplace` and `preview` namespaces' 37 missing locale keys plus the `marketplace.disclosure.runtime.` template-key family (objectui#3546, slice five)

  `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) measured 37 keys that a
  `t()` call site asks for and that **no locale pack defined** — 37 distinct keys at
  37 call sites across five console components — plus one `missing-prefix` family
  whose static head matched no `en` key at all, so every expansion missed. All 37
  carried an inline `t(key, { defaultValue: 'English' })`, which is exactly the
  objectui#3517 class: English rendered correctly, and **all ten languages were
  stuck on it** for months. Nothing here rendered a raw key — slice one (PR #3583)
  held those sites.

  What that meant on the page for a `zh` (or `ja`, `de`, `ar`, …) user: the
  marketplace's "Your organization" strip, its Install / Installing… / Installed
  buttons and the version-update affordances were English; the whole ADR-0025 PD4
  **pre-install permission disclosure** was English — "This package contains code",
  the trust-tier badge, "Reviewed & approved" / "Not yet reviewed" / "Signed", the
  four permission group labels (platform services, lifecycle hooks, network,
  filesystem) and the consent checkbox the user ticks to accept them; the ADR-0045
  unpublished-app banner and its publish toasts were English; and the entire
  ADR-0067 build-history sheet — title, description, the per-commit labels, the
  Revert button and both of its result toasts — was English.

  `marketplace.disclosure.runtime.` is repaired as an **enumeration, not a
  wildcard**: its value surface is the closed trust-tier enum
  (`PluginRuntimeSchema` = `z.enum(['node', 'sandbox', 'worker'])`, ADR-0025 §3.6),
  so all three members are backfilled and the family leaves the ratchet's
  `missingPrefixes` (3 → 2). A test reads the component's own fallback map and
  fails if a fourth tier is ever added without a key — the job the prefix entry
  used to do.

  Each `en` value is byte-identical to the inline `defaultValue` it replaces (36 of
  36 literal sites; the 37th's `defaultValue` is a template literal whose
  `${pkg.display_name}` becomes the `{{name}}` hole its call site already passes),
  so no English string a user sees today changes. The nine translations follow each
  pack's own neighbourhood — including two namespaces that legitimately take
  **different** second persons in `zh` (`marketplace` 你, `preview` 您) — and reuse
  an existing neighbour's translation wherever the `en` string already existed
  verbatim, so one English string never renders as two different sentences in the
  same language.

  No component changed: an AST sweep of the whole `marketplace.*`/`preview.*`
  call-site surface found the slice's own dead-`||`-fallback count to be zero.

- 4dcd52a: `console.objectView.systemViewReadonly` and `console.objectView.expandToPage`
  are translated in the eight packs that stored English for them, so a Japanese,
  Korean, German, French, Spanish, Portuguese, Russian or Arabic session reads
  the system-view hint and the expand affordance in its own language (#3582).

  This is a different defect class from #3546's ledger, and no gate in the repo
  could see it. There the key was _missing_ from a pack and `fallbackLng: 'en'`
  rendered English; here the key was **present in all ten** and eight of them
  stored English as the value. `all-locales-key-parity` compares key _sets_ and
  placeholder _shape_ — identical before and after this change, and neither key
  interpolates anything. `scripts/check-i18n-call-site-keys.mjs` and its baseline
  ratchet ask whether a `t()` key exists in `en`; it did, so these two were never
  in the 258.

  `systemViewReadonly` carried the sharper half: the eight packs did not hold
  `en`'s sentence, they held one `en` had already abandoned. `en` says the view
  is read-only; the eight said `System view defined in code - duplicate to
customize.` — pointing eight locales at a duplicate-to-customize path the
  product no longer presents. They are translated against `en`'s **current**
  read-only meaning, not against the stale English they replaced.

  Each value is built from terminology the same pack already uses rather than
  invented: `view.readonlyTooltip` supplies "system view" and
  `console.objectView.cannotEditMetaView` (landed in #3583) supplies "defined in
  code", so the new hint agrees with the copy beside it in every pack. For
  `expandToPage`, `detail.openAsFullPage` is the identical English sentence one
  namespace over and was already translated everywhere — `en` and `zh` hold their
  two byte-identical to each other, so the eight now do too, and one locale
  cannot end up with two different words for one action.

  `en` and `zh` are unchanged, byte for byte. No key is added or removed —
  the diff is 16 values in 8 files. A new
  `objectView-value-language-3582.test.ts` pins the `en` literal (so the next
  rewording of `en` fails loudly instead of silently orphaning nine
  translations), asserts that no pack but `en` serves either English spelling,
  and requires the zh/ja/ko/ru/ar values to contain characters of their own
  script. The repo-wide "no ASCII English sentence in a non-Latin pack" gate that
  #3582 also sketched is deliberately **not** here; it is a separate, lands-green
  change.

- 42ae5c6: The organization-management console is translatable. The 90 keys under
  `organization.*` — the org layout and its tabs, the members list, the whole
  invitation flow, organization settings including the leave and delete
  confirmations, the accept-invitation page, and the workspace switcher — are now
  defined in all ten locale packs, so a non-English session reads the org admin
  surface in its own language instead of English (part of #3546).

  `scripts/check-i18n-call-site-keys.mjs` measured 258 keys that a `t()` call site
  asks for and no pack defines. `organization.*` was the largest namespace in that
  tally at 90 keys across 93 call sites in seven components. Every one of them
  carried an inline `t(key, { defaultValue: 'English' })`, which is why nothing
  looked broken: English rendered correctly at each site and all ten languages
  were pinned to it. That is the #3517 class, not the raw-key class slice one
  (#3583) held — no organization site rendered an identifier, and none had a dead
  `||` fallback to remove, which was measured before deciding not to touch the
  components.

  Adding a `defaultValue` is deliberately not the fix; it is the mechanism that
  kept these invisible for months. The existing defaults stay where they are, and
  each `en` value is byte-identical to the default at its call site so the two
  paths cannot render different text.

  `organization` is a new top-level namespace, sitting next to — and distinct
  from — `organizations`: the singular one is the management surface, the plural
  one the org picker. The ratchet in `scripts/i18n-call-site-key-baseline.json`
  shrinks by exactly these 90 entries, from 253 to 163. The
  `organization.invitations.status.*` template-key family is untouched and still
  baselined: enumerating an invitation status set is a different repair from
  backfilling literal keys.

- 6d762da: The five locale keys behind #3546's eight no-fallback `t()` call sites are now defined in all ten packs, so the built-in-view toasts, the activity-timeline source link, the wizard's required-field toast and the Gantt refresh button's accessible name are translated instead of falling back to English — or, on two surfaces, to the key itself (part of #3546).

  `scripts/check-i18n-call-site-keys.mjs` measured 258 keys that a `t()` call site asks for and no pack defines. These five were the subset with no working inline default: `console.objectView.cannotEditMetaView`, `console.objectView.cannotDeleteMetaView`, `detail.viewSource`, `gantt.toolbar.refresh` and `wizard.missingRequired`. Adding a `defaultValue` is deliberately not the fix — that mechanism is what kept all 258 invisible for months.

  **Two of the eight sites really did render the raw key**, and both go through a binding with nothing in front of i18next. `ObjectView.tsx` calls `useObjectTranslation()` directly, so five toasts read `console.objectView.cannotEditMetaView` / `cannotDeleteMetaView` on screen; the `|| 'Built-in views cannot be renamed.'` guards next to them were dead on every path, because i18next answers a miss with the key itself and a non-empty string never falls through `||`. Those four unreachable English strings are removed rather than repaired: one key served four call sites (rename / pin / set-as-default / configure), so the pack copy covers any change to a built-in view instead of naming one operation. `RecordActivityTimeline.tsx` fails the same way for a subtler reason — `useDetailTranslation` is `createSafeTranslation(..., 'detail.back')`, and because `detail.back` does resolve, the probe hands back i18next's `t` for every key and bypasses the defaults map wholesale, so `detail.viewSource` reached the user verbatim.

  **The other two sites were not rendering a raw key**, contrary to the issue's description, and are fixed here as the milder "English in all ten languages" class. `wizard.missingRequired` is its own hook's probe key, so the probe failed and `createSafeTranslation` correctly served its English default. `gantt.toolbar.refresh` goes through `useGanttTranslation`, which deliberately does not use `createSafeTranslation` and falls back per key — so the refresh button's `aria-label` was "Refresh", in English, never the key. Screen-reader users heard an English word rather than an identifier; a `zh` session now hears 刷新.

  Regression cover is provider-mounted on purpose: with no `I18nProvider` the defaults maps answer every one of these keys and the assertions pass while the console is broken, which is precisely the false-green the issue documents. For the two sites whose English output was already correct, `en` cannot discriminate before from after — the `zh` assertions are the ones that pin the fix.

- f9faa7d: Backfill the last 17 missing locale keys and both remaining template-key families, emptying the call-site key ratchet (objectui#3546, slice seven — final)

  `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) opened this backlog with
  **258 keys and 4 template-key families** that a `t()` call site asks for and that
  **no locale pack defined**. Seven slices later the last of it is paid: this change
  takes the ratchet from 17 keys to **zero** and from 2 prefix families to **zero**,
  and the gate now reports every one of the **2320** literal call-site keys
  resolving against `en`.

  The residue was the long tail — nine namespaces across `app-shell`,
  `plugin-detail`, `plugin-dashboard`, `plugin-kanban` and `plugin-gantt`, none of
  them big enough to have been its own slice. 17 distinct keys at **23** call sites
  (five keys are used at more than one site) plus **3** call sites behind the two
  families.

  What that meant on the page for a `zh` (or `ja`, `de`, `ar`, …) user: the "App not
  available" empty state a user lands on when an app is still publishing, including
  its whole explanation and its Retry button; the interface page's "source is not
  available" message; the system navigation's **Administration** group header,
  **Datasources** and **Documentation** entries; the "creating new organizations is
  disabled on this instance" guard in the workspace dialog; the invitation list's
  five status labels (All / Pending / Accepted / Rejected / Canceled) on both the
  filter tabs and every invitation badge; the Gantt dependency-drag hint that names
  which endpoint the drop will link (`start` / `end`); the record detail's Add,
  "Record deleted", "No history yet" and the concurrent-update dialog's "this
  record"; the kanban empty board's column count; the dashboard widget's screen
  reader "Loading…"; and the page editor's "Edit in studio" tooltip and accessible
  name. All of it rendered English, in every one of the ten languages.

  Nothing here rendered a raw key — slice one (PR #3583) held those sites, and the
  three keys the issue body named as unprotected (`detail.viewSource`,
  `wizard.missingRequired`, `gantt.toolbar.refresh`) have resolved in `en` since.

  Both families are repaired as **enumerations, not wildcards**, and the assertion
  that used to live in the ratchet's `missingPrefixes` moves into a test that fails
  if either union grows a member without a key:

  - `gantt.linkEnd.` — the closed union `'start' | 'end'`, declared by GanttView's
    own `linkDrag` state.
  - `organization.invitations.status.` — `StatusFilter`
    (`all | pending | accepted | rejected | canceled`), declared by InvitationsPage.

  Every `en` value is byte-identical to the English the call site rendered before,
  so no string a user sees today changes: 16 keys match an inline
  `t(key, { defaultValue: … })`; `dashboard.loading` matches `useSafeTranslate`'s
  positional fallback `tt(key, 'Loading…')`; `gantt.linkEnd.*` match
  `useGanttTranslation`'s per-key fallback map; and the five status labels match the
  CSS-capitalised wire value each badge and tab showed. The nine translations follow
  each pack's own neighbourhood and reuse an existing neighbour's row wherever the
  `en` string already existed verbatim **and** that row is grammatical here — the
  four invitation adjectives are deliberately not reused from the approvals family,
  because those agree with each pack's word for "request" (`ru` masculine `Отклонён`)
  while an invitation needs its own agreement (`ru` neuter `Отклонено`).

  `scripts/i18n-call-site-key-baseline.json` is kept rather than deleted: empty is
  its terminal, load-bearing state — against an empty baseline any NEW unresolved
  call-site key is unexpected and fails the build.

  No component changed.

- 33526fd: `view.readonlyTooltip` — the tooltip on a view tab's read-only lock — is
  retranslated in the eight packs (ja/ko/de/fr/es/pt/ru/ar) that still described
  the retired "duplicate to customize" workflow, so a Japanese, Korean, German,
  French, Spanish, Portuguese, Russian or Arabic session is told the view is
  defined in code and read-only, which is what `en` says and what the product
  does (#3625).

  This is the same stale sentence #3582 fixed one namespace over, but it hid
  behind a much better disguise. In #3582 the eight packs stored the **English**
  string, so two cheap criteria could see it: "value equals `en`" and "a
  non-Latin pack holds pure ASCII". Neither can see this key. Its eight values
  were **idiomatic translations** — real Japanese, real Cyrillic, real Arabic —
  of a sentence `en` itself had already abandoned. Nothing about their form was
  wrong; only their meaning was. Key sets were complete, so
  `all-locales-key-parity` was green; the key exists in `en`, so the call-site
  guard and its ratchet were green; the values are distinct and in their own
  scripts, so every heuristic #3582 sketched would have been green too. Eight
  locales spent those releases pointing users at a path the product no longer
  offers, with every gate reporting success.

  Each value is translated against `en`'s **current** meaning and built from
  words the same pack already uses — "read-only" from its own `view.readOnly` /
  `view.readonlyAriaLabel`, "defined in code" from
  `console.objectView.systemViewReadonly` / `cannotEditMetaView` — so the tooltip
  agrees with the copy beside it instead of introducing a ninth way to say
  read-only. Nothing is rewritten from the stale text.

  `en` and `zh` are unchanged, byte for byte, and no key is added or removed —
  the diff is eight values in eight files. A new
  `viewReadonlyTooltip-semantics-3625.test.ts` tests **meaning** rather than
  form, in both directions: no pack may name the duplicate/copy workflow in its
  own language, and every pack must positively carry all three pieces of the
  sentence ("system view", "defined in code", "read-only") so the negative check
  cannot pass on a gutted string. It also pins the `en` literal, so the next
  rewording of `en` fails in the PR that does the rewording rather than orphaning
  nine translations for another release — which is the invariant this family of
  defects has actually been missing.

- 32413ec: Resolve `_views` translation keys by the bare view name only — the prefixed full name is no longer a second candidate

  `useObjectLabel().viewLabel` / `viewDescription` / `viewEmptyState` build their key by stripping the object prefix off the runtime view id (`crm_opportunity.pipeline_kanban` → `objects.crm_opportunity._views.pipeline_kanban.<tail>`). Until now, if that bare key missed, the resolver **also** tried the prefixed full name — `objects.crm_opportunity._views.crm_opportunity.pipeline_kanban.<tail>` — so a bundle authored against the prefixed spelling resolved too.

  **Behavior change:** it no longer does. A `_views` entry keyed by the prefixed full name is not read at all; the label falls back to the metadata default, exactly as it would if no translation had been written. Bundles keyed by the bare view name — the only spelling the extractor emits and `os lint` accepts — are unaffected.

  This closes an asymmetry, not a feature. The server-side resolver reads the one bare key (objectstack#5165), so a prefixed-key bundle produced a **translated label in the Console and English everywhere else**: the REST boundary, mobile, plain HTTP and SDUI consumers do not run this second resolution pass. The half-success was harder to notice than a clean miss, and it fossilized a second de-facto spelling of a key the platform has now converged on: per the objectstack#5164 ruling (2026-08-06, option A), the canonical `_views` key is the runtime view identity's bare name, with the i18n extractor deriving it from the view composer (objectstack#6124) and `packages/lint` enforcing that single spelling (objectstack#6038). This is the third and last leg of that convergence.

  The object-name axis is untouched: a bundle written against the short object name (`objects.opportunity._views.…`) still resolves when the runtime presents the namespaced name (`crm__opportunity`).

  **If a label stopped translating after this upgrade,** its `_views` key is written with the object prefix. Drop the prefix — `_views.crm_opportunity.pipeline_kanban.label` becomes `_views.pipeline_kanban.label`. `os lint` names these for you: a prefixed key is reported as `translation-target-unknown`, because no view of the object declares it.

## 17.3.0

### Minor Changes

- 0554e88: The console language choice now survives a reload. `I18nProvider` writes every language change to `localStorage` (`objectui-locale`, exported as `LOCALE_STORAGE_KEY`) and boots the next session in that language, so switching to 中文/日本語/… is no longer reverted to `en` by the next F5 or new tab (objectstack#5406).

  Bootstrap precedence is **stored choice → browser language → `defaultLanguage`**: an explicit choice outranks browser detection, and a stored value the app no longer offers is ignored and purged rather than locking the UI to a locale with no translations. The restore lands in the instance's bootstrap language, so `<html lang>` — and therefore the `Accept-Language` header on the first wave of API calls — is already correct on the first render.

  New public surface on `@object-ui/i18n`: `persistLanguage` (default `true`; set `false` for fixed-language previews/demos), `LOCALE_STORAGE_KEY`, and `readStoredLanguage()` for apps that bootstrap their own i18next instance.

- 5af2852: The record detail page now shows a read-gated approval panel (#3461). A record in approval used to expose NOTHING about the running approval to anyone but the current pending approver — `useRecordApprovals` was consumed solely to inject the header Approve/Reject buttons, while the pending-approver list, decision progress, and the `sys_approval_action` timeline existed only in the Approval Center's drawer, a `setup`-app surface that business roles can't navigate to (and whose backing object is tenant-wide, so granting read there is over-broad). The submitter couldn't tell whom to nudge; the record's own audit history was no help either, since the engine mirrors business fields as `runAs:'system'` and decisions never enter record history. The new surface is an **Approvals tab** on the record page — a peer of Details/Related (same promotion Attachments got in objectstack#4358), emitted by `buildDefaultTabs` only when the record actually has requests, with a request-count badge and the label localizing through the tab strip's KNOWN_LABEL_DICT (审批). The tab wraps the new `record:approvals` node (`RecordApprovalsPanel`), visible to EVERY viewer who can read the record: current flow/step with the enriched flow-steps strip, server-computed decision progress (quorum tally, per-group 会签 ticks), the waiting-on chips with server-resolved names and group labels (never raw ids), one chronological action timeline merged across all of the record's requests (a multi-level flow opens one request per node), decision comments and attachments, and an inline remind button for the submitter (`viewer.is_submitter`, with an id-match fallback for older backends) that POSTs the existing `/approvals/requests/:id/remind`. The host threads its live `useRecordApprovals` read through the node so the tab and the header decision buttons never disagree; on authored pages the `record:approvals` renderer self-fetches, and an authored page that omits the node gets a bottom-of-page fallback append so the approval story is never lost to a custom layout. Copy reuses the Approval Center's `approvalsInbox.*` keys so the two surfaces can't drift; `useRecordApprovals` now exposes the full `requests` array plus `listApprovalActions` / `remindApprovalRequest`, and its `ApprovalRequestLite` carries the display enrichment (`process_label`, `step_label`, `flow_steps`, `viewer`, `round`) the single-read endpoint already sent.

### Patch Changes

- b71fc92: Localize the last untranslated console-chrome accessible names (objectstack#5430)

  Four icon-only controls still carried hardcoded English accessible names, so
  under a non-English session they were the only English left in the record
  chrome — and because the controls have no visible label, that literal _is_ the
  control to a screen reader and to the hover tooltip.

  - `page:header`'s `role="toolbar"` — now `detail.pageHeaderActions` (its `⋯`
    overflow trigger eight lines below was fixed in #5407; the toolbar was missed)
  - `ReactionPicker`'s `role="listbox"` popup — now `detail.emojiPicker`
  - `ReactionPicker`'s per-reaction chip, which built its name by concatenation
    with English pluralization baked in (`reaction${count !== 1 ? 's' : ''}`) —
    now `detail.reactionCount` / `detail.reactionCountOne`
  - `NavigationOverlay`'s drawer close and split-panel close — now `common.close`
    (the key the rest of the console already uses) and `common.closePanel`

  The pluralized label follows this repo's **two-key** convention
  (`detail.relatedRecords`/`relatedRecordOne`, `lookup.recordCount`/`recordCountOne`)
  rather than an i18next `_one`/`_other` pair: zh/ja/ko have no separate singular
  form, so those packs would legitimately omit the `_one` half and
  `all-locales-key-parity` would read that as a lost key.

  All five new keys are added to all ten locale packs.

- 65516ba: Name `CommentThread`'s three emoji-only buttons, and follow the session language past the 7-day mark (objectui#3441)

  Two leftovers from objectstack#5506 / objectui#3424, in the same component. It
  is an exported, published component with no in-repo consumer, so both only ever
  bite an external host.

  **One — three controls with no authored accessible name.** Each comment's two
  quick-reaction buttons (`'👍'` and `'❤️'`) and the reply banner's dismiss button
  (`'✕'`) carried no `aria-label` and no `title`. The `+` reaction picker right
  beside them has had one since #3424 (`collaboration.addThumbsUp`), which is what
  makes these three an omission rather than a design choice.

  `aria-label`, not the `title` the `+` uses: a `button`'s accessible name is
  computed from its CONTENT (accname §2F) before the `title` tooltip is ever
  consulted (§2I), so on a button whose only child is a glyph a `title` decorates
  the mouse and leaves the name alone. What a screen reader read out was the
  codepoint — "thumbs up", "red heart", in English whatever the session language,
  and for U+2715 MULTIPLICATION X very often nothing at all.

  Three new keys in all ten packs: `collaboration.reactThumbsUp`,
  `collaboration.reactHeart`, `collaboration.cancelReply`.

  `reactThumbsUp` is deliberately NOT a reuse of `addThumbsUp`, even though both
  dispatch the same `onReaction(id, '👍')` today. `addThumbsUp` names the reaction
  bar's picker entry point, whose copy follows the picker if it ever picks; and on
  any comment that already has reactions the two controls are on screen together,
  so one shared key would put two visibly different buttons under one name.
  `cancelReply` rather than the generic `common.cancel` for the same reason — an
  accessible name has to say what is being cancelled (only the reply target is
  dropped; anything typed into the composer survives).

  **Two — the >= 7 day timestamp ignored the session language.** `formatTimestamp`
  ended in a bare `date.toLocaleDateString()`, i.e. the RUNTIME's locale, so a
  `zh` session read "6 天前" for a six-day-old comment and `8/1/2026` for an
  eight-day-old one.

  The fix passes the session `language`, but not straight through — that is the
  trap #3424 flagged and declined to walk into. `toLocaleDateString(tag)`
  canonicalizes its argument and throws `RangeError` on anything not well-formed
  per BCP 47, and the session language reaches the component verbatim: a host that
  configures `defaultLanguage: 'en_US'` (the POSIX spelling — well-formed-looking,
  and rejected) hands `Intl` a tag it refuses. That `RangeError` would land in
  `formatTimestamp`'s outer `catch`, whose fallback is `return iso`, replacing the
  date with a raw `2026-08-01T09:30:00.000Z` — worse than the un-localized date it
  set out to fix.

  So the absolute-date branch gets its own local `try`/`catch` that falls back to
  the no-argument call. A malformed tag degrades to exactly the previous
  behaviour (the runtime's own locale); the worst case of following the session
  language is the status quo, never a regression. A well-formed but unknown tag
  such as `xx-YY` does not throw at all — `Intl` resolves it to the default — so
  only genuinely malformed tags reach the guard. No date library, and no month or
  weekday copy in the locale packs: `Intl` already owns the per-locale ordering
  and separators.

  Tests assert the computed accessible name via `getByRole('button', { name })`
  rather than the presence of an attribute, which is the distinction the fix turns
  on, and pin that no button is left answering to a bare emoji. The malformed-tag
  case is recorded honestly as green on both sides of this change — `origin/main`
  never passed a tag anywhere, so it could not trip over a bad one; its
  counterfactual is the naive fix, and dropping the inner `catch` is what turns it
  red with the raw ISO string in the DOM.

- 94c5b7c: Localize `@object-ui/collaboration` — `CommentThread` no longer hardcodes English (objectstack#5506)

  `@object-ui/collaboration` depended only on `@object-ui/types` and carried every
  user-visible string as an English literal, so a `zh` console rendered a Chinese
  shell around an English comment thread: "3 comments", "Reply", "Resolve",
  "just now", "Add a comment... (use @ to mention)".

  The package now takes `@object-ui/i18n` as a dependency and exposes one
  translation seam, `useCollaborationTranslation` /
  `COLLAB_DEFAULT_TRANSLATIONS`, built on `createSafeTranslation` — the same
  factory `data-table`, `form` and `filter-builder` use. Under an `I18nProvider`
  it resolves the session locale; with no provider it resolves the English
  defaults map, which is what keeps `CommentThread` usable standalone. There is
  deliberately no `formatter`/label prop escape hatch: a host that wants
  different copy overrides the locale keys, so one thread can never end up half
  translated by the bundle and half by props.

  The issue listed 13 sites. A site-by-site sweep of the file found **20** — the
  seven the original sweep missed are `{n}h ago`, `{n}d ago`, `(edited)`, the
  thread's own comment count, the `Oldest`/`Newest` sort options,
  `Replying to {name}...`, and the composer's `Send` button. All 20 are keyed
  here; leaving any behind would have shipped a thread that is 90% translated.

  Two of them carry a second defect on top of being untranslated: the plural
  **rule** was compiled into the component, not just the words.

  - the header read `` `${n} comment${n !== 1 ? 's' : ''}` ``;
  - the reaction chip tooltip read `` n === 1 ? '1 reaction' : `${n} reactions` ``.

  Both produced correct _English_ — this is not the "1 items" bug objectui#3423
  fixed on the tab badge — but the choice between the two forms was English
  grammar hardwired into the render path. No locale could apply its own: ru needs
  three forms and ja needs none, and neither could ever be expressed no matter
  what the packs said.

  Both now use the repo's **two-key** plural convention
  (`collaboration.commentCount`/`commentCountOne`,
  `collaboration.reactionCount`/`reactionCountOne`) rather than an i18next
  `_one`/`_other` pair: zh/ja/ko have no separate singular form, so those packs
  would legitimately omit the `_one` half and `all-locales-key-parity` reads a
  legitimately-absent half as a lost key. Counts are interpolated as strings, so
  i18next skips its own plural resolution and the two-key scheme stays in charge.

  The reaction tooltip gets a **dedicated** key pair rather than reusing
  `detail.reactionCount`: that one interpolates `{{emoji}}`, and at this call
  site the emoji is the chip's visible label with nothing to hand the
  placeholder — reuse would have left a literal `{{emoji}}` in the accessible
  name under every locale.

  Relative timestamps stayed word-level: the existing minute/hour/day buckets are
  untouched and no date library was introduced. The `>= 7d` branch still uses the
  runtime's own `toLocaleDateString()` — that is not a hardcoded English literal,
  and pinning it to the session language has its own failure mode (an
  unrecognised tag throws into the surrounding `catch`, which would render a raw
  ISO string), so it is tracked separately.

  `Save` / `Cancel` / `Edit` / `Delete` read from the shared `common` namespace
  instead of being re-spelled under `collaboration` — they are the generic action
  words, already translated in all ten packs, and a second spelling would only be
  a second thing to keep in sync. The 21 genuinely new keys are added to all ten
  locale packs with real translations.

- ca0fa8f: Localize `PresenceAvatars` — the avatar stack's accessible name and tooltips follow the session language (objectui#3440)

  objectui#3424 wired `@object-ui/collaboration` up to `@object-ui/i18n` but only
  converted `CommentThread`. `PresenceAvatars` in the same package kept three
  English literals, and it is not a dormant export — the console renders it in
  two places: `app-shell/src/layout/AppHeader.tsx` (tenant presence beside the
  lifecycle badge) and `app-shell/src/views/RecordDetailView.tsx` (who else is on
  this record). A `zh` session got them in English.

  The three sites:

  - the group's `aria-label`, `` `${n} user${n !== 1 ? 's' : ''} present` ``;
  - the overflow badge's tooltip, `` `${n} more user${n !== 1 ? 's' : ''}` ``;
  - each avatar's tooltip, `` `${name} (${status})` ``.

  The first one is the whole control as far as a screen reader is concerned: the
  stack renders images and initials and nothing else, so there was no other
  accessible name to fall back on.

  As with the comment count in #3424, the first two carried a second defect on
  top of being untranslated — the plural **rule** was compiled into the component.
  Both produced correct _English_ (each has a real singular branch, so this is
  not the "1 items" defect objectui#3423 fixed on the tab badge), but
  `n !== 1 ? 's' : ''` is English grammar in a render path and no locale could
  apply its own. Both now use the repo's **two-key** plural convention
  (`collaboration.presentUserCount`/`presentUserCountOne`,
  `collaboration.moreUserCount`/`moreUserCountOne`) rather than an i18next
  `_one`/`_other` pair, with the count interpolated as a string so i18next skips
  its own plural resolution. German is what witnesses the move: "1 anwesender
  Benutzer" vs "2 anwesende Benutzer" inflects the adjective, which the deleted
  ternary could not have produced for any pack.

  The avatar tooltip becomes a single `collaboration.userStatusTitle` key
  (`{{name}} ({{status}})`) so the parentheses and their spacing belong to the
  translation — the CJK packs drop the space English puts before `(`, matching
  their existing `edited: '(已编辑)'`.

  Its `status` is a **display-layer** translation
  (`collaboration.statusActive` / `statusIdle` / `statusAway`): the
  `PresenceUser['status']` enum value stays raw data everywhere it is stored,
  compared or passed around — including the `statusColors` lookup — and is
  translated only at this render exit. A status outside the declared union
  renders as itself, the raw string: presence users arrive from a host-supplied
  `PresenceSource` transport, so an unmapped value is reachable at runtime
  whatever the type says, and the fallback invents nothing rather than leaving an
  empty bracket pair.

  Eight new keys, added to all ten locale packs with real translations.

- 3889ffb: Console chrome i18n gaps (objectstack#5407).

  - A dependency-gated lookup now names its controlling field by its **label**
    instead of its raw API name. The sentence was localized but the interpolated
    name was not, so every locale — English included — read `Select crm_account
first`. The form renderer passes a new `dependsOnLabels` widget prop (the
    lookup-side counterpart of `emptyHint`, which it already resolves to labels
    for the fixed-option widgets); a name the host does not cover still falls
    back to itself.
  - The page-header overflow trigger's `More actions` accessible name now reads
    `detail.moreActions`, the same key `action:menu`'s own overflow trigger uses,
    so the two cannot diverge per locale.
  - The activity-feed reaction button's `Add reaction` accessible name is now a
    bundle key (`detail.addReaction`, added to all ten packs).
  - The "check the highlighted fields" toast joins field names with a per-locale
    separator (`validation.formInvalidJoiner`) instead of a hardcoded `、`
    (U+3001) — right for zh/ja by accident, wrong in English and every Latin
    locale. Latin packs use `, `, CJK `、`, Arabic `، `.
  - The Spanish `validation.required` / `validation.unique` templates gained
    their own masculine head noun (`El campo {{field}} es obligatorio`) so the
    adjective agrees for feminine field labels too — `Cuenta es obligatorio` was
    ungrammatical.

- 7e2406a: The group-tenancy write-target badge is now translated in all ten locales (objectui#3517)

  `form.createTargetOrg` — the ADR-0105 badge `RecordFormPage` shows in create mode
  to name the organization a new record will land in — was defined in **no** locale
  pack, not even `en`. i18next therefore genuinely missed the key and rendered the
  call site's inline `defaultValue`, so the badge read English `Creates in <org>` in
  all ten languages: a Chinese console creating a record on an org-walled object
  showed `Creates in 某某组织`.

  `all-locales-key-parity.test.ts` could not see this. It asserts that every pack
  defines every **`en`** key, so a key `en` itself lacks is outside the comparison —
  ten packs missing it identically kept parity fully green.

  ## What changed

  - `createTargetOrg` is backfilled into `en` as `Creates in {{org}}`, which makes
    the parity gate demand it from the other nine; each is translated to its pack's
    existing `form`-section tone rather than copied or machine-filled.
  - The inline `defaultValue` in `RecordFormPage.tsx` is deleted, finishing what
    objectui#3469 started — that key was the file's last remaining exception, and
    every `t()` on the page now passes bare. Declared = enforced: the packs are the
    single source of this copy, and a missing key must surface (raw key + dev
    missing-key warning) instead of being papered over at the call site.
  - The two exception-pinning tests objectui#3516 left behind invert. `form.createTargetOrg`
    joins the `BARE_KEYS` list (pinned present in all ten packs), and the render
    assertion now checks the badge against the **pack** copy in both `en` and `zh` —
    the deleted English default could not satisfy the Chinese assertion, so the
    badge fails loudly if the packs ever stop driving it.

- 4eeb932: The form renderer's last user-visible English literals now go through i18n (#3272). The fullscreen long-text editor (`mobile_fullscreen`) was an entire untranslated dialog — title, screen-reader description, `Cancel` / `Done` footer buttons, and the expand trigger's accessible name — rendering English inside an otherwise translated zh/ja/ar form; it now reads the new `form.fullscreen.*` keys, shipped in all ten locale packs.

  **Behaviour change worth reading if you author forms:** `submitLabel` and `cancelLabel` no longer default to the literals `'Submit'` and `'Cancel'` in the renderer. They default to _unset_, and the action bar falls back at render time to `common.submit` / `common.cancel`, so a form that declares no button copy now follows the session language instead of being silently frozen to English. A label you DO declare still wins verbatim in every locale — including an English one under a zh session, and including an explicit empty string (the fallback uses `??`, so `submitLabel: ''` renders a blank button rather than being overwritten). The only forms whose rendered text changes are those that never declared the labels and are viewed in a non-English session — which is the bug. `FormSchema.submitLabel` / `cancelLabel` stay optional strings; no spec or type change.

  Also removed the built-in `select` branch's second `|| 'Select an option'` fallback. The single call site already supplies `t('common.selectOption')`, so the literal was reachable only through an authored `placeholder: ''` — where it replaced the author's deliberate blank with an untranslated English word.

- 5c856ec: `ObjectGantt`'s quick-filter bar is now localized instead of pinned to Chinese. The four `QuickFilterBar` labels (`all`, `clear`, `empty`, `resultSummary`) were hardcoded as Chinese string literals at the `ObjectGantt` call site, so the bar read 全部 / 清除筛选 / 无可选项 / 显示 N / M 项任务 under an `en`, `ja`, `es` or `ar` session while the rest of the gantt toolbar localized correctly — a conspicuous mismatch, and a violation of the English-only-codebase rule. `QuickFilterBar` itself was never at fault: it is presentational and already falls back to English, so the host was the only thing pinning the copy.

  The four strings moved into a new `gantt.quickFilter` namespace, added to all ten built-in locale packs, and the call site now resolves them through the gantt package's existing `useGanttTranslation` — the same per-key hook every other gantt string already uses, so a host dictionary that lags on these keys still renders the bundled English default rather than a raw key. `gantt.quickFilter.resultSummary` deliberately keeps SINGLE-brace placeholders (`{shown}` / `{total}`): the call site substitutes them with a literal `.replace`, not i18next interpolation, matching `gantt.autoScheduleDlg.body` and the placeholder convention `all-locales-key-parity` already recognises. Anyone retranslating these packs must keep that spelling — a respell to `{{shown}}` would render the raw placeholder to the user.

- 68b6a28: The list toolbar's "Filter" now saves. Saving a filter from the runtime toolbar PUT the FilterBuilder's whole group object (`{ id, logic, conditions }`) into the view's `filter`, where `@objectstack/spec`'s `ListViewSchema.filter` declares `ViewFilterRule[]` — so every save came back `422 invalid_metadata` and the filter was silently never persisted (objectstack#5159).

  The producer now folds the builder's group to the spec's flat `{ field, operator, value }` rule list before persisting, sharing one transform with the Studio view inspector (which had the only copy). Operators normalize through the spec's own `normalizeFilterOperator`, so the four builder operators the Studio's local table had drifted behind — `startsWith`, `endsWith`, `isNull`, `isNotNull` — now persist correctly too. The builder's per-row `id` is no longer written: it is a React list key that the read path regenerates, so stored view bodies keep the declared vocabulary only.

  A filter whose shape cannot be represented losslessly as a flat rule list — `OR` across several conditions, or nested condition groups — is now refused with a translated message instead of being quietly saved as `AND`, which would have returned a different set of records than the one on screen. Such a filter still applies to the current list; it just does not become part of the saved view.

- 28b2e65: Localize the create / edit / view form title `ObjectView` builds itself
  (objectui#3462)

  The same family as #3426 / PR #3457 and #3459 / PR #3464, one call site further
  in. `ObjectView.getFormTitle()` string-built its three verbs in TypeScript:

      case 'create': return `Create ${objectLabel}`;
      case 'edit':   return `Edit ${objectLabel}`;
      case 'view':   return `View ${objectLabel}`;

  so a Chinese session whose object is labelled 联系人 read a drawer headed
  **"View 联系人"** — an English verb glued onto a localized label. All three
  consumers are visible chrome: `renderDrawerForm`'s `DrawerTitle`,
  `renderModalForm`'s `DialogTitle`, and the `title` prop handed to
  `NavigationOverlay` in the `popover` branch (a host-supplied `title` displaces
  the overlay's own `resolvedTitle` default, so it is what the user sees).

  The bar to reach it is lower than #3459's split panel: `ObjectViewSchema.layout`
  already defaults to `'drawer'`, and `navigation` is a declared authorable input
  on the registered `object-view` block whose `mode` union carries `drawer`,
  `modal` and `popover`. A row click under any of them sets `formMode: 'view'` and
  opens the container. `app-shell`'s wrapper pinning `layout: 'page'` is one host
  overriding a registered block, not proof the branch is dead.

  ## What changed

  The three verb branches resolve `form.createTitle` / `form.editTitle` /
  `form.viewTitle`.

  **No new key family was minted.** `form.createTitle` (`'Create {{object}}'`) and
  `form.editTitle` (`'Edit {{object}}'`) already ship in all ten packs and are
  already how `app-shell` heads the PAGE-mode record form
  (`RecordFormPage.tsx`, `AppContent.tsx`). The drawer / modal / popover titles are
  the same heading on a different surface, so they resolve the same keys — a
  parallel per-plugin family would have guaranteed the two spellings drift, which
  is what the sibling issues were about. Only the third verb had no sibling:
  `form.viewTitle` is added to all ten packs, following each pack's existing
  arrangement for its create/edit twins rather than a translated-verb-plus-label
  concatenation (de puts the verb last, ja/zh use particles and no space).

  `VIEW_DEFAULT_TRANSLATIONS` in `ObjectView.tsx` gains the three English entries,
  which is what `createSafeTranslation` falls back to with no `I18nProvider`
  mounted.

  Two branches stay literal on purpose and are pinned by tests: `schema.form.title`
  (the author wrote a title, so the author's title wins, in every locale) and the
  `default` branch (bare object label, no verb to translate).

  ## Visible English change

  None. Every branch is byte-identical in English — `Create Contacts`,
  `Edit Contacts`, `View Contacts` — with and without a provider, so e2e specs and
  host tests that address this chrome by its English name keep addressing it. The
  provider-less path has its own test file, kept separate because
  `initReactI18next` registers its instance as a module global that outlives
  `cleanup()`.

  The toolbar's create BUTTON keeps resolving `console.objectView.new`
  ("New" / 新建) and was deliberately not reused for the heading: a button verb and
  a title are different contexts, and folding them together is how the next drift
  of this shape would start.

- 825bbe3: The option widgets' "this list cannot be filled" message now has one source, and
  it is translated (objectui#3231).

  FROM: `SelectField`, `MultiSelectField`, `RadioField` and `CheckboxesField` each
  carried their own copy of the empty/gated state, each destructured the declared
  `emptyHint` prop into `_emptyHint` and dropped it, and each rendered a hardcoded
  English literal (`'No options available'`, `` `Select ${…} first` ``) even in a
  Chinese or Japanese session. TO: one shared `OptionsEmptyState` — the host's
  `emptyHint` when it supplied one, otherwise a translated fallback
  (`fields.options.empty` / `fields.options.selectFirst`, added to all ten locale
  packs).

  `emptyHint` was declared, produced by the form renderer and transported, then
  lost three times over — so no registered widget could ever render it. All three
  breaks are fixed, because closing only the last one delivers nothing:

  - `isOptionField` compared the raw resolved type against `'select'` /`'radio'` /
    `'multiselect'` / `'checkboxes'`. Object-derived forms emit
    `mapFieldTypeToFormType`'s prefixed ids (`field:select`), which matched none of
    them, so for every option field coming from an object schema — the normal case
    in the console — the whole cascade block was skipped and no hint was computed
    at all. It now normalizes the `field:` prefix, the same normalization
    `stripRegisteredFieldProps` already applied a few lines below.
  - `stripRegisteredFieldProps` then removed the `emptyHint` key from what was
    left. It is now forwarded to the four cascade option types, alongside
    `dependentValues`. This stays an allow-list rather than a blanket
    pass-through: every other registered widget spreads its leftover props onto a
    DOM node, where an unknown `emptyHint` attribute is a React warning.
  - the widgets themselves discarded it. Keeping it out of the `...props` spread
    was correct; not using it afterwards was not.

  User-visible effect: a dependency-gated option list now prompts with the
  controlling field's **label** ("Select Country first") instead of its raw
  metadata name, in the session's language; an unconfigured list says so in the
  session's language too. The gate sentence is one i18n key shared by the renderer
  and the widget fallback, so the two sides cannot word it differently.

  Untouched: the built-in (unregistered) `select` branch of the form renderer,
  which already consumed `emptyHint`. That is a separate live path.

- 6195841: Localize the record-detail overlay heading that `ListView` and `ObjectGrid`
  build themselves (objectui#3426)

  #3423 gave `NavigationOverlay`'s `resolvedTitle` an i18n default
  (`detail.recordDetail`), but two hosts never let that default run: they
  string-built an English heading in TypeScript and passed it as the `title`
  prop, so a zh/ja/de session got a fully localized drawer with one English
  heading on it.

  - `packages/plugin-list/src/ListView.tsx` — `` `${schema.label} Detail` ``
  - `packages/plugin-grid/src/ObjectGrid.tsx` — the same template, plus a bare
    `'Record Detail'` literal for the no-label case

  Both are user-reachable, not dead defaults. `list-view` / `object-grid` are
  public page blocks and `navigation` is an authorable key on their schema, so a
  page that authors `navigation: { mode: 'drawer' }` opens exactly this overlay
  on row click. (`app-shell`'s `ObjectView` does suppress it — it passes its own
  `onRowClick`, which takes priority inside `useNavigationOverlay`, and renders
  its own overlay — but that is one host overriding a public block, not proof the
  branch is unreachable.)

  ## What changed

  Both call sites now key their heading instead of concatenating it:

  - a new `detail.recordDetailWithLabel` (`'{{label}} Detail'`) carries the
    object label through interpolation, so a pack whose qualifier trails the noun
    (`de`) or that needs a possessive particle (`ja`/`zh`) can write its own
    arrangement rather than inherit English word order;
  - the no-label branch reuses `detail.recordDetail` — the very key the overlay
    itself defaults to — so one heading on one control cannot drift into two
    translations.

  The new key is added to all ten locale packs and to each plugin's English
  defaults map (`LIST_DEFAULT_TRANSLATIONS` / `GRID_DEFAULT_TRANSLATIONS`), which
  is what `createSafeTranslation` falls back to with no `I18nProvider` mounted.

  English output is byte-identical in every branch (`Contacts Detail` /
  `Contacts Detail` / `Record Detail`), with and without a provider — pinned by a
  provider-less test file per plugin, kept separate because `initReactI18next`
  registers its instance as a module global that outlives `cleanup()`.

- 5dd0127: Localize the record-overlay and tab-badge chrome that #5430's sweep left behind (objectstack#5506)

  Four more console-chrome strings were still hardcoded English literals. Unlike
  #5430's set they are not all accessible names — one is visible copy, and one was
  a component **default** that only the console happened to override.

  - `page:tabs`' count badge built its `aria-label` by template literal,
    `` `${formatTabCount(count)} items` ``. The badge renders digits only, so that
    label _is_ the badge to a screen reader — and the English plural was baked in
    with no singular branch at all, so a related list with one row announced
    "1 items". Now `common.itemCount` / `common.itemCountOne`.
  - `NavigationOverlay`'s drag-resize handle (`role="separator"`, no visible label)
    — now `common.resizeDrawer`.
  - `NavigationOverlay`'s `expandLabel` **default**. Hosts may override it and the
    console does, but the default is what every other host ships — and it feeds
    both `aria-label` and `title` of an icon-only button. Now
    `detail.openAsFullPage`, still overridable by the prop.
  - `NavigationOverlay`'s `resolvedTitle` fallback, `'Record Detail'` — **visible**
    overlay heading, not just an a11y name. Now `detail.recordDetail`.
  - The sr-only `SheetDescription`/`DialogDescription` prose
    `Record detail overlay for {title}.`, which existed in three copies
    (drawer / modal / popover) — now one `detail.recordDetailOverlay` key with a
    `{{title}}` placeholder.

  The count badge follows this repo's **two-key** plural convention
  (`detail.reactionCount`/`reactionCountOne`, `detail.relatedRecords`/`relatedRecordOne`)
  rather than an i18next `_one`/`_other` pair: zh/ja/ko have no separate singular
  form, so those packs would legitimately omit the `_one` half and
  `all-locales-key-parity` would read that as a lost key. The formatted count
  (`1.2k`, not `1200`) is interpolated so the accessible name and the visible
  digits never disagree — and because i18next skips its own plural resolution when
  `count` is a string, the two-key scheme stays in charge of the choice.

  Both touched components moved from `useSafeTranslate` to `createSafeTranslation`,
  which carries an options bag (two of the new keys interpolate) and an English
  defaults map. That map is what keeps the provider-less path English, which
  consumers outside this package depend on — `plugin-view`'s `ObjectView.test.tsx`
  and `e2e/live/inline-edit-polish-2572.spec.ts` address this chrome by English
  accessible name with no `I18nProvider` mounted.

  All six new keys are added to all ten locale packs.

- a415684: The console server-action wrapper's `opensInNewTab` choreography no longer
  ships hard-coded bilingual Chinese/English copy (objectui#3321, AGENTS.md
  Commandment #-1): the pre-opened SSO spinner tab (title + body) and the
  popup-blocked toast (title, description, action label) are now localized
  through new `console.serverAction.*` keys in `@object-ui/i18n`, added at full
  parity across all ten locale packs.

  `createConsoleServerActionHandler` gains an optional i18next-style `t` option
  (`t(key, englishDefault)`) — the wrapper is a plain function, so the translate
  function is injected from the two hook-context call sites
  (`useConsoleActionRuntime`, `RecordDetailView`) via `useObjectTranslation`.
  When omitted (tests / standalone), every string falls back to its English
  default; no non-English copy remains in code. Locale strings are HTML-escaped
  before being written into the spinner document.

- a6ec93d: `createSafeTranslation`'s no-provider fallback interpolation now replaces **all**
  occurrences of each placeholder, matching i18next semantics on the provider path.

  The fallback used `value.replace('{{k}}', String(v))`, and `String.prototype.replace`
  with a string needle substitutes only the _first_ match. A default string repeating a
  placeholder — `'Selected {{count}} of {{count}} items'`, natural in many locales and
  sometimes required by RTL / agglutinative word order — therefore leaked literal braces
  to users on hosts with no `I18nProvider` mounted (standalone / embedded renderers),
  while the same string interpolated correctly once a provider was present. A silent
  semantic fork, in exactly the environments we observe least.

  The replacement is `value.split(needle).join(String(v))` rather than `replaceAll`:
  both `replace` and `replaceAll` interpret `$&`, `` $` ``, `$'` and `$$` in the
  _replacement_ string, which i18next does not. Values here are runtime data (record
  labels, search terms), so that second divergence was reachable today — a label
  containing `$&` was mangled on the fallback path. split/join is literal on both sides
  and needs no regex escaping of the placeholder name.

  Key resolution (`defaults[key] || key`), the `String(v)` coercion, and the
  leave-it-literal behaviour for a placeholder with no matching option are unchanged.
  Fixes objectui#3418.

- c7ed4c3: `TagsField` no longer ships a hardcoded Chinese input placeholder
  (objectui#3342, AGENTS.md Commandment #-1). The placeholder now resolves
  through the pinned chain: the author-declared `field.placeholder` wins
  (previously ignored by this widget); otherwise the widget's own copy arrives
  via `useFieldTranslation()` under the new `fields.tags.placeholder` key, added
  at full parity across all locale packs (Chinese lives in the zh pack, not in
  code); with no `I18nProvider` mounted the English default from FIELD_DEFAULTS
  renders — never a raw key.
- 2409e1d: `TextAreaField`'s character counter now announces itself in the session locale. The counter block — rendered only when the field declares `maxLength` — carried the accessible name `Character count: {n} of {max}` as an English literal, and the element is an `aria-live="polite"` region, so a zh/ja/ar session had that English sentence read out on every keystroke while sighted users saw only the language-independent `{n}/{max}` digits. Nothing was wrong on screen, which is why it survived: only screen reader users could perceive it (#3406).

  Unlike #3404, no key existed to consume — none of the ten locale packs had any character-count string. `fields.textarea.characterCount` is new in all ten, interpolating `{{count}}` and `{{max}}` as one sentence rather than parts assembled in code, because `ja` and `ko` put the cap before the count ("of {{max}} characters, {{count}}"), an order no concatenation can produce. The English pack value and the `FIELD_DEFAULTS` fallback are byte-identical to the literal they replace, so an `en` session and a provider-less embed both render exactly what they did before.

  Behaviour is unchanged: `aria-live="polite"` and the per-keystroke recompute are deliberately untouched here and tracked separately (#3408).

- 789fe3e: `TextAreaField`'s character counter no longer re-announces itself on every keystroke. Measured on `main` in a zh session with `maxLength: 500`, typing a 52-character sentence one character at a time produced 52 distinct screen-reader announcements totalling 979 spoken characters — roughly 19x the text being written, each one cutting off the reader's echo of the letter just typed. The counter element was simultaneously the visible `{n}/{max}` digits, the carrier of the translated sentence and the `aria-live` region itself, so "re-render" and "announce" were the same event; the field also had no `aria-describedby`, so focusing it said nothing about the cap at all (#3408).

  It is now the three-node shape the GOV.UK Design System character-count component uses: the visible digits are `aria-hidden` and purely decorative; the counter sentence (`fields.textarea.characterCount`, unchanged in all ten packs) has moved onto the textarea's `aria-describedby`, so focus reads "Character count: 12 of 500" once and then stays quiet; and a separate visually-hidden `aria-live="polite"` region carries a new near-limit warning, `fields.textarea.charactersRemaining` (new in all ten packs), which stays silent until the value is inside the last 10% or last 20 characters of the cap — whichever the typist reaches first — and updates only after typing pauses for a second. The same 52-keystroke probe now produces zero announcements; a run that types all the way onto a 500-character cap produces five. Any `aria-describedby` the host already supplied (the form renderer's description and error-message ids) is appended to, never replaced.

  No metadata change: the counter still renders exactly when the field declares `maxLength` (or the legacy `max_length`), and a widget rendered with no `I18nProvider` still shows the same English sentences.

## 17.2.0

### Minor Changes

- a889e31: A record's approval band now shows the quorum / per-group tally the server already computes.

  The showcase's `showcase_committee_quorum` node declares `behavior: 'quorum'` with
  `minApprovals: 2` over three approvers, and even ships a pre-rendered
  `"Committee Sign-off (2 of 3)"` label; `showcase_expense_signoff` declares
  `per_group` (会签) with named manager / finance groups. On the business record
  the approval band rendered none of it — the lock badge, the recall button and
  the approve/reject actions were all correct, but a two-of-three committee step
  looked exactly like a one-approver step. An approver could not see whether their
  own click finalized the node or was one of three, which is the single fact a
  quorum node exists to express (objectstack#4478).

  Nothing was wrong on the wire, and nothing here papers over the server. The
  framework computes `decision_progress` — `{ behavior, got, need, groups? }`,
  derived from the node's own `node_config_json` snapshot, so the count a client
  shows is the count the engine will enforce. **It attaches that block in
  `getRequest` only**: `listRequests` deliberately skips it, because the
  `sys_approval_action` tally it costs is per row and a list read may return
  hundreds. The record header's `useRecordApprovals` reads
  `GET /approvals/requests?object=…&recordId=…` — the list route — so the
  enrichment was never in the payload it had. The hook now follows up with one
  single read for the ONE pending row and folds the result onto it; a failed or
  mismatched follow-up leaves the row exactly as the list sent it, so a display-only
  enrichment can never take the approval panel down and no tally is ever invented.

  `InlineEditProvider` carries the block through as `approvalProgress`, and the
  DetailView approval band renders it beside the existing badge: a labelled
  `role="progressbar"` with one tick per required approval for `quorum` /
  `unanimous`, and for `per_group` a chip per group marking which have signed
  (`finance 1/1` ✓, `manager 0/1`). Group names come from the flow author's own
  config, so they need no locale strings; the three new label keys are added to all
  ten packs. `first_response` nodes carry no `decision_progress` and are unchanged —
  one decision is the whole step there, and a "1 of 1" bar would be noise.

  Scored `minor` rather than `patch`: this is new observable rendering plus a new
  public `approvalProgress` prop / `ApprovalProgress` type on `@object-ui/react`,
  not a behavior correction inside an existing surface.

### Patch Changes

- 4b470b9: Localize the environment entitlement dialog and read cloud's nested error envelope.

  The free-plan "Development environments are a paid feature" prompt was built from
  English string literals in `entitlements.ts` — including the lowercase `your free
plan` sentence users reported (cloud#959). Both spec builders now take a translator
  and resolve `environment.entitlement.*`; all ten locale packs carry the strings.
  `entitlements.ts` stays dependency-free: `t` is passed in, not imported, and
  defaults to the English copy with local `{{token}}` interpolation.

  The dialog now renders the Console's own copy rather than the server's prose — a
  control plane upgrades independently and only localizes these messages from
  cloud#959 on, so preferring the server string left the reactive path English
  against every older deployment.

  Also fixes the reactive dialog not firing at all: cloud#948 moved coded errors into
  a nested envelope (`{ success, error: { code, … } }`), and
  `entitlementDialogFromError` read `code` off the top level — returning `null` for
  every entitlement 403, so the upgrade dialog degraded to a generic red error toast.
  Both shapes are read now.

## 17.1.0

### Minor Changes

- 1cf0de7: fix(detail): finish the approval-lock story, and warn on silently stripped fields (framework#3794)

  The Console reported record writability wrong in both directions during an
  approval, so a user had nothing to go on: what they _could_ edit said "locked",
  and what they _couldn't_ said "updated successfully".

  **The lock band told the truth; the Edit button did not.** objectui#2902 split
  the band into "in approval · editable" vs locked, but the header **Edit** CTA
  still keyed off nothing at all — on a genuinely locked record it stayed live, so
  the user opened the form, filled a screen, and got `RECORD_LOCKED` back on Save.
  It is now `disabled` on a locked record: visible-but-off, with the band beside it
  saying why. This is the LOCK, not the mere presence of an approval — a
  `lockRecord: false` node keeps Edit live, which is the point of that setting.

  **And the band could still re-lock itself.** `DetailView` OR-ed the record's own
  `approval_status` mirror into `isLocked` unconditionally. That mirror is written
  on submit by any flow configuring an `approvalStatusField`, _regardless of_
  `lockRecord` — so on a `lockRecord: false` node the host correctly resolved "not
  locked" from the request's `lock_record` while the mirror dragged the band back
  to "Locked for approval", with the pencils live and saves landing underneath it.
  The host is now authoritative whenever it threads `approvalPending`; the mirror
  is consulted only for bare/legacy `DetailView` hosts that thread nothing, where
  it still reads as locked (no node granularity — the safe direction).

  Recall's tooltip no longer promises to unlock a record the node never locked
  (`detail.cancelApprovalTooltipUnlocked`).

  **Silently stripped fields now surface on the record form's save path.** The
  adapter emitted a write-warning for `create`/`update` responses carrying
  `droppedFields`, but not for `batchTransaction` — which is how the record form
  saves a master-detail record, i.e. the one surface where a user actually edits a
  `readonlyWhen`-locked field. `batchTransaction` now emits one warning per event,
  resolving each back to its operation via the response's `index`.

  The toast itself was hardcoded English and called every strip "read-only". It is
  now localized (`detail.writeStripped*`, ten locales) and worded by reason:
  `readonly_when` says the field is not editable _in this record's current state_,
  which is what actually happened — the field is editable in other states and the
  form rendered it as an ordinary input, so "read-only" sent the user hunting for a
  permission problem that does not exist.

  **And it stopped crying wolf.** `createObjectStackUserStateAdapter` hand-stamped
  the server-managed `updated_at` on every recents/favorites write, which the
  server strips and reports — so the console popped "Some fields were not saved"
  about a field no user ever touched, on page loads, drowning the signal the toast
  exists for. It no longer sends the column; the server stamps it anyway.

- d21794c: fix(list,i18n): a 400 from the server no longer reads as "check your connection"

  `classifyLoadError` was written because a 403 rendered the same
  "check your connection and try again" panel as a genuine outage — its own doc
  comment says users "were told to debug their network when the server had
  (correctly) denied them access." It made that distinction for 401 and 403 and
  then sent **everything else**, including 4xx, to the network branch.

  A **400** is the server saying it understood the request and will never accept
  it. Retrying resends the identical bad request, so "check your connection and
  try again" is advice that cannot work — the same mistake the function exists to
  prevent, one status code over.

  This became reachable from ordinary stored metadata with
  objectstack-ai/objectstack#4121: a `$filter` array that is not a filter AST is
  now rejected at the protocol with `400 INVALID_FILTER`, where it previously
  reached a driver (and, for a lone `['and']`, silently returned every row). A
  view saved with such a filter now answers 400 on every load.

  Adds a fourth classification, `rejected`, for `status === 400` and for the
  server's 400-class codes (`INVALID_FILTER`, `UNSUPPORTED_QUERY_PARAM`,
  `INVALID_QUERY`). Its copy points at the filter rather than the network, and
  says who can fix it when the view is saved that way. 403/401 keep priority, so a
  permission denial can never read as a bad request — pinned by a test.

  The two new strings are added to **all ten locale packs**, not just `en`: the
  neighbouring panels are translated, and `fallbackLng: 'en'` would have rendered
  this one in English beside them. The full-parity gate
  (`all-locales-key-parity.test.ts`) caught the pack I missed.

  Verified: 5 new tests — numeric status, error code without a status, a status
  embedded in the message text, and the 403/401 ordering guard. Reverting the
  branch fails four of them. `plugin-list` + `i18n`: **403 tests across 29 files**,
  green.

- f8a95e5: fix(fields): the sharing-criteria builder stops calling an empty criteria "All records" (objectstack#3896)

  `FilterConditionField` renders `sys_sharing_rule.criteria_json`. With no
  criteria it displayed **"All records"**, and `filterGroupToMongo` carried a
  matching `// empty = match all` comment. That was describing a bug as a
  feature: a sharing rule with no predicate was stored as `criteria_json: null`
  and evaluated as `find(object, { filter: {} })` under the system context —
  every record of the object, granted to the recipient. `SharingRuleSchema` had
  always forbidden the shape ("never seeded as a permissive match-all",
  ADR-0049); the REST and data-API entries just never checked.

  objectstack#3896 closes those entries: the server now refuses to save a rule
  whose criteria would match everything, and one already stored shares nothing.
  This is the renderer catching up.

  - **The empty read-only state now says the rule shares nothing**, in
    `destructive` styling — key renamed `fields.filterCondition.allRecords` →
    `fields.filterCondition.noCriteria`, retranslated across all ten locales.
    Nothing else read the old key.
  - **A new `fields.filterCondition.criteriaRequired` hint** renders under the
    builder (and the JSON editor) while the criteria is empty. The server's
    rejection is precise but only arrives as a toast _after_ Save; this says it
    while the admin is still looking at the empty builder.
  - **`isMatchAllCriteria` is exported** — a client-side mirror of the server
    predicate covering `{}`, `[]`, and the vacuous combinators (`{ $and: [] }`,
    `{ $or: [{}] }`), conservative in the same direction. The server stays
    authoritative; this only decides whether to show the hint.

  Unparsable JSON keeps its own `invalidJson` message and does **not** also
  collect the empty-criteria hint.

  Note for anyone wiring this end-to-end: the Criteria field is not marked
  `required` in the object metadata, deliberately — `sys_sharing_rule.criteria_json`
  is nullable in deployed tenants, so `required: true` would only produce a
  destructive `NOT NULL` migration that those nulls block. The invariant lives in
  the server's write guards; this change makes the UI stop contradicting it.

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

- c785740: fix(detail): record Attachments become their own tab (with count badge) and their copy is translated — objectstack#4358

  Two defects on `enable.files: true` record detail pages:

  1. **Buried placement.** `RecordDetailView` appended `RecordAttachmentsPanel`
     AFTER the schema-rendered page tree, whose synthesized default embeds
     `record:discussion` as the last main component — so the panel always
     landed below an ever-growing feed timeline, undiscoverable without
     scrolling to the very bottom, with no metadata knob to move it.

     `buildDefaultTabs` now emits a peer **Attachments** tab (a new
     `record:attachments` node rendered by an app-shell registration wrapping
     the existing panel via RecordContext) between Related and
     Activity/History. `PageTabsRenderer` derives the tab's count badge from a
     `sys_attachment` probe scoped to `(parent_object, parent_id)`, riding the
     same RelatedCountStore cache/invalidation bus as related-list badges — so
     uploads and deletes update the badge live. A `hideAttachments` synthesizer
     option suppresses the tab; RecordDetailView keeps its legacy bottom append
     only as the fallback for authored pages without the node
     (`hasExplicitAttachments`).

  2. **Untranslated copy.** The panel's eleven `detail.*` keys (`attachments`,
     `uploadAttachment`, `loadingAttachments`, `noAttachments`,
     `downloadAttachment`, `deleteAttachment`, and the five
     `attachment*Denied/Required` friendly errors) existed only as inline
     English `defaultValue`s — no locale bundle carried them, so non-English
     consoles always showed English. All ten locales now define them; the tab
     label rides the existing well-known-label dictionary (→ 附件 etc.).

- d61efd1: fix(grid): a bulk action's `visible` is evaluated per selected record — objectui#3067

  The selection bar evaluated a def's `visible` against the ambient scope with no
  record bound. That does not fail open, it answers wrongly: with no `record` in
  scope the lenient evaluator returned `true` for **every** row-scoped predicate,
  including the ones that should be false — `${record.done}` and
  `${record.owner == user.id}` both came back `true`. An authored gate was not
  weakened, it was inverted for half its inputs, and nothing distinguished that
  from a real verdict.

  `visible` is now evaluated **once per selected record, with that record in
  scope**, fail-closed per record and warning once on a fault — the same contract
  the row kebab uses. One evaluation answers both questions:

  - **Is the button offered?** When at least one selected record passes. A
    record-free predicate (`features.x`, `current_user.y`) returns the same
    verdict for every row, so it still behaves as a plain button-level gate — no
    syntactic sniffing for `record` references is involved.
  - **Which records does it run on?** The ones that passed. The confirm step
    states how many were skipped, so a run over fewer records than the user
    ticked says so instead of quietly shrinking the selection.

  Eligibility is re-applied to the EXPANDED set after "select all N matching",
  not just the page selection the button could see.

  The mechanism predates objectui#3002, but only inline-authored
  `bulkActionDefs[].visible` used to reach it — written by authors who knew there
  was no record. #3031 began promoting object actions into the bar, and their
  `visible` is typically written for a row/record surface, which is what put
  row-scoped predicates in front of a record-free evaluation.

- 9eb932b: fix(console): three real-user console failures — 403 blamed on the network, ⌘K search capped at 8 objects, nav gating fields inert

  1. **List error panel classifies the failure** (`plugin-list`, `i18n`): a 403/401 from the data source used to render the same "check your connection" copy as a genuine outage, sending users to debug their network while the server was correctly denying access. The panel now classifies by `httpStatus`/`status`/`statusCode`, the `PERMISSION_DENIED`/`UNAUTHORIZED` error codes, or an `HTTP <status>` message prefix, and renders dedicated permission-denied / sign-in-required copy (all nine locales).

  2. **⌘K / full-page search scope is no longer truncated** (`react`): `maxObjectsQueried` caps the per-object fanout fallback, not the search scope — it used to slice the candidate pool itself, so the `objects` whitelist sent to the platform's `/api/v1/search` only ever named the first 8 nav objects. Which sidebar group came first decided which records were findable; everything later in the nav was unsearchable no matter what the user typed.

  3. **Nav gating fields finally gate** (`app-shell`): `evaluateVisibility` only evaluated `${…}` template strings, so the `{ dialect: 'cel', source }` envelopes the spec normalizes every authored `visible` predicate into fell through to a blanket "visible" — a constant-false predicate still rendered for everyone. It now delegates to `ExpressionEvaluator.evaluateCondition`, which routes CEL envelopes to the canonical `@objectstack/formula` engine. And the sidebars' `requiredPermissions` check treats a bare name as an ADR-0066 system capability (union of the user's permission-set `systemPermissions` from `/me/permissions`) — the same subset rule the server applies to `AppSchema.requiredPermissions` — instead of misreading it as `can(<name>, 'read')`, which had degraded `requiredPermissions` into a hide-from-everyone switch (admins included). The `object:action` form and the legacy object-read fallback keep working.

- 3cb9646: fix(app-shell,i18n): record forms no longer render the developer-voiced default subtitle

  Every create/edit record form (both the console dialog in `AppContent` and the
  full-page `RecordFormPage`) hardcoded a platform default description under the
  title: "Add a new {{object}} to your database." / "Update details for
  {{object}}" (zh: 「向数据库添加新的{{object}}。」/「更新{{object}}的详情」).

  The copy is developer-tooling voice leaking into end-user business apps — a
  scheduling clerk filling in a 排班计划 has no business being told about "the
  database", and the phrasing came straight from admin-panel boilerplate. The
  line carried no information the form title didn't already have, and neither
  call site let a form view override it.

  The default subtitle is now gone: both call sites stop passing `description`,
  and the unused `form.createDescription` / `form.editDescription` keys are
  removed from all ten locale bundles (the `workspace.createDescription` key is
  unrelated and stays).

- b5b97e2: fix(types,layout): nav item type `component` joins `NavigationItemType` and its zod enum — objectui#2918

  The renderers have carried a full `type: 'component'` implementation (Phase 3b:
  `componentRef` colon-split to `/component/<ns>/<name>`, `params` serialised as
  querystring, `metadata:*` special-cases) — but the vocabulary never gained the
  member, and `@objectstack/spec` has had `ComponentNavItem` all along. The zod
  enum was the part that bit: `NavigationItemTypeSchema` rejected
  `type: 'component'` at validation time, so authors could not declare one and
  the renderer half was unreachable — dead on arrival rather than dead code.

  - `NavigationItemType` and `NavigationItemTypeSchema` gain `'component'`;
    `NavigationItem` gains the fields the renderer consumes, `componentRef` and
    `params` (also used by `type: 'page'`), mirroring spec's `ComponentNavItem` —
    declared in zod too, so parse no longer strips them.
  - The `(item as any).componentRef` / `params` casts in `NavigationRenderer`
    and `AppSchemaRenderer` become typed access.
  - `NavigationDesigner`'s exhaustive type-meta map gains a `component` badge
    (new `appDesigner.navTypeComponent` key in all 10 locales).
  - `@object-ui/layout` gains `type-check` (src + tests) with the #2915 `paths`
    override; its DEBT entry in `check-type-check-coverage.mjs` is deleted.

- 2d5d594: fix(list,detail): sorting a lookup column no longer orders by an invisible key — #3096

  A relational column (`lookup` / `master_detail` / `user` / `tree`) never holds
  the string its cell shows: it holds the `$expand`-ed record, or a raw foreign-key
  id whose label was resolved separately. Every sort path took that raw value as
  its key, so the column of names came back in an order with no relation to the
  names — sorting looked broken, with nothing saying the key was something else.

  The two halves are fixed differently, because they can order by different things:

  - **Client-side sorts** (grid column headers, any `data-table`, a non-windowed
    related list) now key off the label the cell renders, via the new
    `getSortValue` / `compareSortValues` in `@object-ui/core` — which resolves an
    expanded record through `getRecordDisplayName` (ADR-0079), so the sort key and
    the lookup cell agree on which field names a record. This replaces two broken
    comparators: `a[col] < b[col]` is always false between two objects (the
    comparator collapsed to a constant and permuted the rows), and
    `String(a[col])` is `"[object Object]"` (every row compared equal, so the sort
    silently did nothing).
  - **Server `$orderby` sorts** cannot be fixed here — the key is the stored id by
    construction, and `objectstack#4256` settled that no relation join is coming.
    So those entry points stop offering the illusion: the ListView toolbar sort
    picker withholds relational fields and explains why (pointing at a formula
    field as the supported way to sort by a related name), and a windowed related
    list renders no sort button for them.

  A relational field the view's CURRENT sort already uses stays listed, labelled
  `(by ID)`, so view metadata authored or saved with such a sort round-trips
  instead of rendering a blank row and losing the sort on the next edit.

## 17.0.0

### Minor Changes

- 952b978: fix(detail): the approval band honors the node's `lockRecord` instead of assuming every approval locks (#2902)

  A record detail page treated "a pending approval request exists" as "this
  record is locked". An approval node declares `lockRecord` (default `true`), and
  on `lockRecord: false` the server keeps accepting writes for the whole time
  that node waits — so the console was asserting a lock the backend did not
  enforce.

  The label was the smaller half of it. The same conflated signal fed `canEdit`,
  so the record-level inline-edit session was suppressed too: no pencils,
  `enter()` a no-op. On a single-approver step — a department head or plant
  manager, exactly the case `lockRecord: false` exists for, where the approver is
  meant to fill in the missing detail before deciding — the capability was
  unreachable from the UI. And a flow chaining nodes with different policies drew
  one identical band for "edit freely" and "the server will reject your save with
  `RECORD_LOCKED`", so the two states were indistinguishable until Save failed.

  Approval state is now two signals:

  - **`approvalPending`** — an approval is running. Drives the band and the recall
    button, both meaningful whether or not the record is editable.
  - **`locked`** — that approval also forbids edits, from the pending node's
    `lock_record` (framework#3814, read off the same `node_config_json` snapshot
    the server's record-lock hook reads).

  The band renders two states: amber lock + "Locked for approval", or sky clock +
  "In approval · editable", each with its own tooltip. Recall moved out of the
  locked branch — an editable pending approval is just as recallable. Inline
  editing stays live in the editable state.

  `InlineEditProvider` takes a new optional `approvalPending` prop, defaulting to
  `locked`, so a host that threads only `locked` renders exactly as before. The
  record's `approval_status` field remains the fallback for backends with no
  approvals API; it carries no node granularity, so it still reads as locked — as
  does a pending request from a backend too old to report the policy.

  New `detail.approvalPendingEditable` / `detail.approvalPendingTooltip` keys are
  translated in all ten locales.

- 2735de6: feat: render the server's effective API operation set (#3391 PR-4)

  The frontend now consumes the per-object **effective API operation set** the
  server resolves (from `/me/permissions` `apiOperations`, framework #3391) —
  never the raw `apiMethods` — so Import/Export/New/Edit/Delete buttons match what
  the server will actually admit, and a 405 import refusal shows a dedicated
  message instead of silently falling back.

  - **core** `resolveCrudAffordances(obj, effectiveApiOperations?)` — new optional
    second argument intersects each affordance bit with its API operation
    (create/import→create/import, edit→update, delete→delete, exportCsv→export).
    Omitting it (old backend / no effective set) leaves affordances unchanged.
  - **permissions** — `/me/permissions` response carries per-object
    `apiOperations`; `PermissionContextValue.getObjectApiOperations(object)`
    exposes it (undefined when absent → callers keep current behavior); `check()`
    maps `import→allowCreate`, `export→allowRead`.
  - **app-shell** `ObjectView` intersects its toolbar affordances with the object's
    effective operations (Import); the platform-admin identity-import bypass is
    unaffected.
  - **plugin-list** `ListView` / **plugin-grid** `ObjectGrid` gate the Export
    button (and export handler) on effective `export`; `plugin-grid` gains the
    `@object-ui/permissions` workspace dependency.
  - **plugin-grid** `ImportWizard` — a 405 / `OBJECT_API_METHOD_NOT_ALLOWED`
    import refusal is detected by a new `isImportNotAllowed` predicate at every
    catch site (async, sync, dry-run) and STOPS with a dedicated
    `grid.import.notAllowed` message (10 locales + fallback dict) — it never falls
    back to the sync/legacy path (which 405s too), distinct from the 404
    route-absent fallback.

  Backward-compatible: a missing effective set (unrestricted object, older
  backend, or no permission provider) preserves the current default-allow
  behavior everywhere.

### Patch Changes

- 0b3be01: fix(app-shell): give inline `lookup` action params a real record picker (#3405)

  An action parameter declared inline as `{ name: 'inspector', type: 'lookup',
reference: 'sys_user' }` always rendered as a plain text input asking the user
  to paste a record id (UUID) — a supervisor assigning an inspector had to go
  find that person's UUID by hand, while the same reference field picks records
  by name in the create/edit dialog.

  `paramToField()` degrades a picker param to text when it has no `referenceTo`
  target, and `referenceTo` was only ever populated on the field-backed branch of
  `resolveActionParams()`. The inline branch dropped the authored `reference`
  key entirely (as did the spec schema, which stripped it as unknown), so an
  inline picker could never reach `<LookupField>` no matter how it was authored.

  - `resolveActionParam()` now maps an inline `reference` onto `referenceTo` — on
    the inline branch, on the missing-field fallback branch, and as an override
    on the field-backed branch (matching how every other inline value overrides
    the resolved field).
  - The text degradation now warns in dev naming the offending param, since with
    `@objectstack/spec` rejecting a targetless inline picker at parse time it
    means the metadata is broken, not merely partial.
  - The fallback's placeholder and help text no longer claim "a picker is coming
    soon" — the picker has shipped, and the message now says the parameter has no
    reference object configured. Updated across all 10 locales.

- 3c4d935: fix(i18n): compose the AI-model diagnostics summary client-side instead of rendering the server's English string (objectui#2886)

  `CloudAiModelStatus` rendered `report.summary` verbatim — the most prominent
  line on the panel, in English for every locale.

  Reading `objectstack-ai/cloud` settled how to fix it. The server **cannot**
  localize that string as currently built:

  - `service-ai/src/effective-model.ts:117` assembles it as a hard-coded English
    template literal, with no locale parameter;
  - `service-ai/src/routes/ai-routes.ts:395` declares `handler: async () => …` —
    it takes **no request argument**, so it cannot read `Accept-Language` even
    though `createAuthenticatedFetch` has been sending it since objectui#1319.

  But no server change is needed, because every ingredient of the sentence is
  already in the structured payload: `conversational.model`,
  `conversational.source`, `structured.model`, `structured.pinned`, and
  `routing.{free,paid}`. The issue proposed "return structured data instead of a
  sentence" as the better fix — the server was already doing that; the client
  just wasn't using it.

  The panel now composes the line from those fields. `sourceLabel()` already
  produced exactly the two clauses the server hand-rolls — "pinned by X" /
  "code default (no env override)", and "same as build/ask" for an unpinned
  structured model — so no new source vocabulary was required.

  **A dropped diagnostic, not just untranslated text.** The client's
  `EffectiveModelReport` never declared `routing`, which the server has always
  sent conditionally. Its only appearance anywhere was inside the English summary,
  so non-English admins could not see the plan→model routing policy **at all**.
  It is now declared and surfaced.

  Also fixed: `attributeSource` emits the bare token `'unknown'` when the adapter
  cannot report a model, and `sourceLabel` fell through to rendering it raw.

  Four keys added to all ten packs (`summary`, `summaryRouting`, `modelUnknown`,
  `sourceUnknown`), so the full-parity guard from objectui#2909 stays green.

  The panel had **no test coverage at all**; it now has five, mutation-tested by
  restoring `<p>{report.summary}</p>` — which fails four of them.

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

- de5e40c: fix(approvals): Approval Center UX pass — badge nowrap, approve confirm, decision progress bar, localized declared actions (#2762)

  - **Badge no longer stacks CJK text vertically (P0-1)** — `Badge` gains
    `whitespace-nowrap` in its base variants (a badge is a single-line pill by
    definition), and the inbox 状态 column gets a minimum width, so 待审批 can
    never render as 待/审/批.
  - **Quick Approve now confirms (P0-2)** — the row's right-edge ✓, the mobile
    card button and the `a` keyboard shortcut all route through a confirmation
    dialog before executing, mirroring the Reject flow; an irreversible decision
    can no longer fire on a stray click.
  - **Decision progress is visualized (P1-1)** — the drawer renders a segmented
    progress bar (ARIA `progressbar`) for `decision_progress`, per-group chips
    get an explicit unsatisfied ○ state next to the satisfied ✓, the eligible
    approver count is spelled out, and the drawer pager now reads
    "Request N of M" so it can't be misread as approval progress.
  - **Declared action labels localize (P0-3)** — `DeclaredActionsBar` resolves
    label / confirmText / successMessage through the `_actions.<name>.*`
    translation convention (metadata literals as fallback), matching
    ObjectView/RecordDetailView; with the `@objectstack/plugin-approvals`
    bundle, the drawer shows 通过 / 拒绝 / 转签 instead of English in a zh-CN
    workspace. New `approvalsInbox` keys shipped in all ten locales.

- 1a03af6: fix(approvals): Approval Center triage + drawer readability pass (#2762 P1-2/P1-3/P1-4/P1-5/P2)

  - **Decision-relevant data in the queue (P1-3)** — list rows and mobile cards
    now surface the request's amount/total inline (detected from the snapshot,
    preferring the server-formatted `payload_display` value), so a reviewer can
    triage without opening each request. A sort control adds "Oldest first" and
    "Amount (high→low)" alongside the default newest-first.
  - **Empty applicant column (P1-4)** — flow-/system-initiated requests (no human
    submitter) now read "Flow-initiated" with a workflow icon instead of a bare
    person icon + "—", in the desktop table, mobile card, and drawer.
  - **Approver chips deduped (P1-2)** — a person filling more than one approver
    slot rendered as N identical "Waiting on" chips; they collapse to one chip
    with a ×N count, the tooltip keeping every underlying id.
  - **Action hierarchy (P1-5)** — `DeclaredActionsBar` maps the spec action
    `variant` enum onto the Button variants (`primary` → filled default,
    `danger` → destructive), so the drawer's Approve stands out and Reject reads
    as destructive once `@objectstack/plugin-approvals` declares them.
  - **Label polish (P2)** — `owner_id`-style resolved lookup keys render as
    "Owner", not the awkward "Owner Id", in the drawer summary.

  New `approvalsInbox` keys (`flowOrigin`, `sortBy`/`sortRecent`/`sortOldest`/
  `sortAmount`) added to all ten locales.

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

- cfc675e: fix(i18n): unconditional Chinese in the chatbot confirm card and the field inspector (objectui#2884, objectui#2885)

  Two issues split out of the objectui#2871 survey because neither is a language
  _branch_ — both are copy that renders in Chinese for every user regardless of
  locale.

  **objectui#2884 — the confirm-before-change card.** Heading, buttons, hint and
  the verb column of each change row were Chinese literals, so an English user
  read the whole confirm gate in Chinese. They now follow the same
  prop-with-English-default convention the plan card already uses
  (`changesTitleLabel`, `changesConfirmLabel`, `changeVerbLabels`, …), with the
  console passing translated values from `console.ai.*`.

  The serious half was the outbound message. Clicking Confirm sent
  `'确认修改，应用你刚才提议的改动。'` unconditionally — an English user's click
  told the agent, in Chinese, to apply the changes, and the agent answered in
  Chinese for the rest of the thread. That message now routes through the same
  `convZh` (conversation-language) switch as `planApproveMessage`, so it matches
  the language actually being spoken rather than the UI or a hard-coded literal.

  Note this is deliberately _not_ "always send English": the repo already decided
  outbound agent text follows the CONVERSATION, and the cloud confirm gate
  (`service-ai-studio` `confirm-gate.ts` `APPROVAL_RE`) matches on approval
  keywords. The Chinese string is unchanged, so that path is byte-for-byte what
  the gate already accepted; `i18n.test.ts` now pins it against the mirrored gate
  regex alongside the two plan messages.

  Also in this component: the error banner's `Response failed` / `Details` /
  `Retry` were hard-coded English, and both it and the quota banner used a bare
  `t(key)` that renders the raw key when the chat is mounted without an
  `I18nProvider`. Both now use `useSafeTranslate`, so they degrade to English
  instead of to `chatbotError.title`. The `「…」` corner brackets around the
  target-app name are now neutral quotes.

  **objectui#2885 — the draft-field suffix.** `ObjectFieldInspector` appended a
  bare `(草稿)` to draft objects in the lookup picker — the only Chinese literal
  in a 1500-line file where the other 101 strings all go through `t(key, locale)`.
  It now reads `engine.inspector.draftSuffix` from the Studio catalog.

  The 18 new keys were added to all ten locale packs, so the objectui#2872 part
  (a) gap held at 469/471 rather than widening.

- 20df08c: fix(cloud-connection): localize the Cloud Connection panel (objectstack#3589 follow-up)

  `CloudConnectionPanel` — the `cloud-connection:panel` SDUI widget that is the
  entire body of the Cloud Connection Setup page — had no i18n at all: no
  `@object-ui/i18n` import, and no `cloudConnection` namespace in any of the ten
  built-in locale packs. Its siblings on neighbouring pages
  (`marketplace:installed-list`, `mcp:connect-agent`) were already fully
  localized, so this one page rendered a translated header above an English body
  once the framework-side `page:header` resolution landed.

  - New `cloudConnection` namespace in all ten packs (en, zh, ja, ko, de, fr, es,
    pt, ru, ar), matching the coverage its sibling namespaces already had. Covers
    every phase of the device-code flow: checking, error + retry, waiting
    (approval prompt, user code, copy), bound (connection detail labels), and
    unbound (call to action).
  - The three hard-coded failure messages (expired request, bind failure, device
    code request failure) are translated where they are raised, not where they
    are rendered, since they are stored in component state.
  - The "code is pre-filled…" line was one sentence stitched together across JSX
    with a conditional tail and a bare `'.'`. It is now two self-contained
    strings, so a translator never receives a dangling clause whose word order
    they cannot change.
  - The `bound_at` timestamp now formats with the active UI language rather than
    the browser default, matching the surrounding copy.

  Also adds a locale-parity test asserting the `cloudConnection` key set is
  identical across all ten packs — partial coverage degrades quietly, because
  i18next falls back to `en` and the result merely looks half-translated.

- af705b9: feat(i18n): complete the locale backfill — all ten packs reach full key parity (objectui#2872)

  Translates the remaining **275 keys × 8 packs = 2,200 strings**, closing
  objectui#2872. The largest namespaces are `grid` (101, mostly the import
  wizard), `gantt` (58) and `dashboard` (25), plus a long tail across `list`,
  `auth`, `fields`, `marketplace`, `capability` and nine others.

  Every pack is now at parity with `en`: **2,495 of 2,499 keys**, zero keys that
  `en` lacks. The four-key remainder is the outbound-message set, absent by
  design so `t()` falls through to English and the cloud confirm gate keeps
  recognising it — `outbound-agent-messages.test.ts` owns that invariant.

  **P3 is now enforceable.** `high-frequency-namespace-parity.test.ts` was scoped
  to four namespaces because full parity would have been a permanently red build.
  That restriction is obsolete, so it is replaced by
  `all-locales-key-parity.test.ts`, which asserts:

  - every pack defines every `en` key;
  - no pack defines a key `en` lacks (objectui#2872 part b was 74 keys of exactly
    this, hidden behind a component-private fallback);
  - **placeholders match `en` per string** — both `{{count}}` and the single-brace
    `{count}` form, which two `gantt.autoScheduleDlg.*` keys use on purpose
    because their call site does a literal `.replace('{count}', …)` rather than
    i18next interpolation. A translation that drops a placeholder renders a
    sentence with a hole in it and no error, so this is checked mechanically
    rather than by eye.

  All three assertions were mutation-tested, including the single-brace form.

  ### A bug the test suite could not have caught

  The first merge pass produced **duplicate keys** in four packs: the key list is
  the union of what is missing across all eight, but the insert ran
  unconditionally, so packs that already had `detail.created` / `detail.updated`
  got a second copy. Every test still passed — at runtime the later property
  simply wins, so the parity check saw a perfectly consistent object.

  `tsc` caught it as TS1117 during `turbo build`. ESLint does not flag it, and a
  runtime test _cannot_ — the duplicate is already collapsed before JS sees the
  object. The compiler is the only possible guard here, and CI runs it. The merge
  script now filters per pack against what that pack actually defines.

  ### Translation quality

  Model-generated, and dense domain terminology (Gantt dependency types, the
  import wizard's upsert/match-field vocabulary) is exactly where that is
  weakest. This was raised before starting and the work was requested anyway, so
  it ships as a **reviewable first draft, not a finished localization** — native
  review is still worthwhile. What _is_ verified mechanically: key parity in both
  directions, placeholder shape per string, and that no outbound agent message
  was translated.

- 0502a7c: fix(i18n): the change card's Confirm button sent text the cloud gate does not accept

  The English `console.ai.changesConfirmMessage` was
  `"Confirm the changes — apply what you just proposed."`. The cloud confirm gate
  (`service-ai-studio` `confirm-gate.ts` `APPROVAL_RE`) recognises
  `apply (this|the) change` — **not** "apply what". So the message failed the
  gate, and failing the gate is silent: the agent re-proposes instead of applying,
  and the Confirm button on the change card simply looks inert.

  This affected English conversations **and all eight locales that fall back to
  English** for that key. It is now
  `"Confirm — apply the change you just proposed."` — singular "the change", so it
  still matches if the gate ever tightens to a word boundary. The Chinese string
  was always fine (`确认修改` hits the 确认-anchored clause) and is unchanged.

  The same literal lives in four places — the locale pack, the
  `ChatbotEnhanced` prop default, its doc comment, and the `AiChatPage`
  `defaultValue` — and all four are updated together.

  **Why the existing guard missed it.** `i18n.test.ts` mirrored only the _Chinese_
  clause of `APPROVAL_RE`; the English half was reduced to "starts with Confirm,
  contains apply" because nothing in this repo could see the real pattern. That
  weaker assertion passed against a string the gate rejected — the guard was
  green and the feature was broken.

  The mirror is now **verbatim, both clauses**, and drives an `it.each` over every
  outbound approval message in both `zh` and `en`. Two supporting tests keep it
  honest: one asserting the gate stays narrow (a plain build request like
  "帮我搭建一个 CRM" must NOT read as approval), and one asserting
  `planAnswerMessage` does _not_ match — it answers a structure question and must
  never read as blanket approval.

  The mirror is duplicated across a repo boundary by necessity (objectui cannot
  import from cloud); the comment says so, so the next person changing
  `APPROVAL_RE` knows to update it here too.

- c6fd752: fix(app-shell): localize the two `DeclaredActionsBar` strings that bypassed i18n (objectui#2762 P0-3)

  The declared action _labels_ resolve through `useObjectLabel`, so a zh-CN
  workspace got 通过 / 拒绝 buttons — sitting inside a toolbar whose accessible
  name was the English literal `'Actions'`, above decision-output fields whose
  help text read `Handed to the flow as a decision output.` Both strings are
  authored by the bar itself rather than by metadata, and both skipped the locale
  bundle entirely.

  - `aria-label` now uses the existing `common.actions` key (a host-supplied
    `label` still wins).
  - The decision-output help text moves to new `actions.decisionOutput.help` /
    `.helpMultiValue` keys, added across all ten shipped locales.

  Worth being precise about why the help text needed fixing at all, since the
  runtime _does_ localize action params: `useConsoleActionRuntime` runs every
  param through `actionParamText`, but these params are synthesized here from the
  record's `decision_output_defs`, so their key path (`outputs.<key>`) is dynamic
  and no `_actions.<action>.params.*` bundle entry can ever match it. The
  fallback is not a rare path — it is the only path, which is why the English
  survived.

  Not fixed, and deliberately: a decision output that arrives without a `label`
  still renders a title-cased version of its machine key. That derived text
  mirrors the framework's `humanizeFieldPath` convention, and the real fix is the
  backend declaring the label — a client-side bundle cannot key off a dynamic
  output name.

- e05f052: feat(i18n): translate the four highest-traffic namespaces into the eight trailing locales (objectui#2872 part a)

  Backfills `console`, `home`, `topbar` and `layout` — 193 keys × 8 packs, 1,544
  strings — so a ja/ko/de/fr/es/pt/ru/ar admin sees the AI console, the home
  screen, the top bar and the system navigation in their own language instead of
  silently falling back to English.

  The gap in those eight packs drops from **469–471 keys to 277–279**. `en` and
  `zh` remain at exact parity (2499 : 2499, zero difference in both directions).

  This is the "high-frequency namespaces only" strategy from the objectui#2872
  discussion, not a full backfill: `grid` (101), `gantt` (58), `dashboard` (25)
  and the long tail stay on English fallback and remain tracked there.

  **Four keys are deliberately left untranslated**, and that is the load-bearing
  part of this change:

  ```
  console.ai.planApproveMessage
  console.ai.planApproveDefaultsMessage
  console.ai.planAnswerMessage
  console.ai.changesConfirmMessage
  ```

  These are not labels. They are the text a button _transmits to the agent_, and
  the cloud confirm gate (`service-ai-studio` `confirm-gate.ts` `APPROVAL_RE`)
  decides whether that text reads as approval. It recognises Chinese and English
  — nothing else. `AiChatPage` therefore selects them by the language of the
  CONVERSATION rather than of the UI, and the `t()` call is _expected_ to miss in
  every non-Chinese pack and fall through to its English `defaultValue`.

  Translating them would be an outright regression: a German user's "Build it"
  would start sending German, the gate would stop matching, and the agent would
  re-propose instead of building — the button looks inert while nothing visibly
  errors.

  objectui#2900 shipped precisely that bug for `changesConfirmMessage`, which had
  been added to all ten packs. **This change removes it from the eight**,
  restoring the English fallback. A new guard,
  `packages/i18n/src/__tests__/outbound-agent-messages.test.ts`, pins the
  invariant in both directions: the four keys must be absent from the eight packs
  AND present in `en`/`zh`, while every _other_ `console.ai` label must be
  translated — so the narrow fix can't be over-applied into an excuse for leaving
  surrounding labels in English.

  Translations are model-generated and would benefit from native review; the
  placeholder set of every string was verified programmatically against the
  English source.

- 0502a7c: test(i18n): ratchet the four backfilled namespaces so they cannot silently erode

  objectui#2903 translated `console`, `home`, `topbar` and `layout` into all ten
  packs. Nothing stopped that from decaying: `fallbackLng: 'en'` means dropping a
  key from `de` renders English, which reads as "not translated yet" rather than
  "we lost this", and the missing-key handler is dev-only so CI never sees it.

  This is objectui#2872's P3 (full parity test) applied **only to the namespaces
  that are actually complete**. Full parity would fail today by ~277 keys per
  pack with no action attached to it, which is a broken build rather than a
  guard. Widen `RATCHETED_NAMESPACES` as each remaining namespace is translated —
  not before.

  Asserts both directions, because the packs have drifted both ways before:

  - every ratcheted `en` key exists in all nine other packs;
  - no pack defines a ratcheted key that `en` lacks — objectui#2872 part (b) was
    exactly this failure, 74 keys deep, hidden behind a component-private
    fallback so English "happened to" render.

  The four outbound agent messages are excluded, since they are deliberately
  absent from the eight non-gate packs; `outbound-agent-messages.test.ts` owns
  that invariant and the two guards would otherwise contradict each other.

  A non-vacuity assertion pins the ratchet at >300 keys and requires every named
  namespace to contribute, so a rename can't quietly reduce the whole file to a
  no-op.

- faad45e: fix(fields): render `image` fields consistently and add click-to-zoom (#2836)

  An `image` field rendered differently — and wrongly — on three surfaces:

  - **Edit form showed broken thumbnails.** A record read back its `image` value
    as a bare `sys_file` id (the reference form), but `readFileValue` returned an
    id with no URL — the comment assumed the read path expands it, which the
    edit-form data path does not. The result was `<img src="">`. `file-value` now
    derives the stable download URL (`/api/v1/storage/files/:id`, which
    302-redirects to a signed URL and works directly as `<img src>`) for a bare
    id or an id-only object, so every widget and cell renderer resolves one.
  - **Inline edit leaked the raw storage URL.** `InlineFieldInput` had no branch
    for file-backed types and fell through to a plain text input showing
    `/api/v1/storage/files/…`. It now renders the same upload widgets the form
    uses (`image`/`avatar`/`signature`/`file`/`video`/`audio`).
  - **Hard-coded English.** `ImageField`'s upload/crop/remove/alt strings now go
    through `t('fields.image.*')` (en + zh added).

  Also adds an `ImageLightbox` — click a read-only thumbnail (detail or list cell)
  to open a full-screen preview; multiple images get prev/next navigation, a
  position counter and arrow-key support, a single image just the image. In a
  grid cell the click is `stopPropagation`-guarded so enlarging doesn't also open
  the row.

- 09c6a17: fix(grid): localize import result errors (objectstack#3566)

  The import completion screen rendered the raw English server message verbatim —
  e.g. `Row 6 (position): position: "装配工" matches more than one
os_tianshun_ehr_position — use a unique value or the record id` — with the field
  name twice, an internal object api-name, all in English, while the dry-run panel
  already localized the same errors.

  - The result list now runs through the same `formatDryRunError` path (driving
    off the structured error `code`, resolving the api-name to its field label,
    dropping the duplicated `<api-name>:` prefix). Threaded the error `code`
    through `ImportResult.errors` to make this possible.
  - Added code-driven translations for the remaining structured import errors —
    `invalid_boolean` / `invalid_number` / `invalid_date` / `invalid_option` /
    `required` / `AMBIGUOUS_MATCH` — with Chinese (`zh`) copy in `@object-ui/i18n`
    alongside the existing reference errors.

- ba73a02: fix(kanban): surface off-column records in an "Uncategorized" lane instead of dropping them (#2792)

  Records whose `groupBy` value matched no declared column were bucketed and then silently discarded — the board rendered empty while the list footer still counted the rows, so it read as data loss (a status the board doesn't render, an edited/removed picklist option, imported legacy data, or an empty value all triggered it). They now land in a trailing "Uncategorized" lane so no record is invisible and the visible card total reconciles with the record count. Dragging a card out of that lane into a real column repairs its status; the drag handler refuses to persist a move _into_ the lane (its sentinel id is not a real option). Adds `kanban.uncategorized` to the en/zh bundles.

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

- 7d46648: fix(hooks): stop calling translation hooks inside try/catch (objectui#2879)

  Eleven call sites wrapped a React hook in `try`/`catch` to make it
  "provider-safe". `useObjectTranslation` and `useObjectLabel` already are — they
  read context optionally and fall back to react-i18next's global instance, and
  never throw. The `catch` bought nothing and cost correctness: a throw _after_
  the hook ran desyncs hook order on the next render, because React matches hooks
  positionally. objectui#2595/#2596 fixed exactly this in `@object-ui/i18n`'s
  `createSafeTranslation`; nine plugin-local re-implementations kept their own
  copy of the bug, and two more (`ObjectTimeline`, `ObjectView`) were found by the
  new lint rule below — `ObjectView` had even suppressed
  `react-hooks/rules-of-hooks` inline to keep it.

  - Six exact re-implementations now delegate to `createSafeTranslation`:
    `plugin-detail`, `plugin-timeline`, `plugin-list`, `plugin-calendar`,
    `plugin-grid`'s `ObjectGrid`, `plugin-designer`.
  - `components`' `data-table` also delegates; `createSafeTranslation` now
    returns `language` alongside `t` so consumers that localize dates don't need
    a second hook call. Purely additive.
  - `plugin-gantt` and `plugin-grid`'s `ImportWizard` keep their local hooks —
    they fall back _per key_, which a single-probe factory cannot express and
    which their comments justify (a host dictionary that covers common keys but
    lags on newer ones). Only the `try`/`catch` is removed.
  - `ObjectTimeline` and `ObjectView` call the hook directly and probe the
    returned value, mirroring `useSafeFieldLabel`.

  Adds `object-ui/no-try-catch-around-hook` (error) so a twelfth copy fails CI.
  It only matches `use*` names, accepts member calls solely on `React` (so
  `vi.useRealTimers()` is not a hook), and resets its try-depth inside nested
  functions (so `renderHook(() => useThing())` inside a `try` is fine) — both
  false positives were real code in this repo and are pinned in the rule's tests.

  `eslint-rules/**/*.test.js` matched no vitest project glob, so the local
  plugin's specs had never run in CI. They are now included; all three pass.

  `ObjectTimeline`'s test mock of `@object-ui/react` omitted `useObjectLabel` —
  the removed `try`/`catch` had been silently absorbing that gap. The mock is now
  complete.

- bb4aa25: fix(i18n): apply globalActions label overlays to actions surfaced on a record-detail action bar (objectui#3372)

  On a record-detail action bar the caller passes `objectDef.name` for **every**
  action, so a `globalAction` surfaced there (e.g. `log_call`) looked up
  `objects.<obj>._actions.<action>.label`, missed, and leaked the English
  metadata literal ("Log a Call") instead of its `globalActions.<action>.label`
  overlay ("记录通话"). Object-owned actions on the same bar translated fine,
  which is what made the gap visible.

  `useObjectLabel()`'s action resolvers now mirror the canonical
  `@objectstack/spec` resolver (`system/i18n-resolver.lookupActionField`): when an
  action is object-scoped, the object key still wins, but `globalActions.<action>.*`
  is consulted as a fallback before returning the literal. This applies uniformly
  to `actionLabel`, `actionConfirm`, `actionSuccess`, `actionDescription`,
  `actionResultDialog`, `actionParamText`, and `actionParamOptionLabel`, so a
  globalAction resolves the same on a record-detail action bar as it does
  everywhere else. App-namespace discovery also recognises a `globalActions`-only
  bundle (one with no object/field entries).

- 75f1cdf: fix(auth): localize the ADR-0069 remediation gate and the auth split-panel (#2870)

  `RemediationOverlay` had no i18n at all. It is the full-screen gate mounted
  unconditionally at `ConsoleShell` (`fixed inset-0 z-[200]`) that a user hits
  when the backend returns `PASSWORD_EXPIRED` or `MFA_REQUIRED` — there is no
  route around it, so a user who could not read English could not get back into
  the product. That makes it a usability block rather than a cosmetic gap.

  - New `auth.remediation.*` namespace in all ten locale packs, covering both
    branches of the gate: expired-password (title, three field labels, submit /
    submitting, mismatch and failure messages) and MFA enrolment (password step,
    QR scan copy, backup-code disclosure, code entry, verify / verifying, and the
    enrolment and invalid-code failures), plus the shared "sign out instead" exit.
  - Validation and failure messages are translated where they are raised, since
    they are held in component state and rendered later.
  - The server-provided `remediationRequired.message` is left untouched; only the
    empty-message fallback is localized.
  - `AuthPageLayout`'s two marketing strings move to `auth.layout.*`. The forms it
    wraps were already localized, so the split-panel had been rendering half in
    the user's language and half in English.

  Adds a locale-parity test over both namespaces, asserting an identical key set
  across all ten packs, a non-empty string at every leaf, and that prose differs
  from English (short labels like "Continue" legitimately collide). i18next falls
  back to `en` silently and its missing-key handler is dev-only, so a key added to
  one pack and forgotten elsewhere is invisible in whichever locales get tested by
  hand.

- 53642d4: fix(core,fields): a string `$orderby` is a clause, not a character array — and localize the sharing-rule widgets (objectstack#3821)

  **The recipient picker listed nothing, ever.** `QueryParams['$orderby']` was
  typed as `Record | string[] | SortObject[]`, so `queryParamsToRecord` sent any
  non-array value through `Object.entries`. Handed the clause string `'name asc'`
  — which callers do build by hand — it walked the string index by index and
  emitted `$orderby=0 n,1 a,2 m,3 e,4 ,5 a,6 s,7 c`. The server sorted by columns
  that don't exist and every row was filtered out, so
  `sys_sharing_rule.recipient_id` rendered "No matches" for every recipient type
  and no sharing rule could be created from the Console. `ObjectGrid` builds the
  same shape from a schema-level `sort` in three places, so grids with a string
  sort silently showed an empty table.

  A string `$orderby` is now passed through verbatim (the server's OData
  normalizer has always parsed `'name asc'`), and the type admits `string`.
  `RecipientPickerField` additionally switched to the structured
  `{ name: 'asc' }` form so it can't regress this way against any data source.

  **The three sharing-rule authoring widgets never had translations.**
  `ObjectRefField`, `RecipientPickerField` and `FilterConditionField` hardcoded
  their English copy — a Chinese Console showed "Select an object", "Select a
  user", "Search…", "No matches", "Edit as JSON". They now go through
  `useFieldTranslation` like every other widget, with keys added under `fields.*`
  in all ten locales.

  The recipient placeholder was the interesting one: it read
  `` `Select a ${recipientType.replace(/_/g,' ')}` ``, interpolating the enum
  value into an English sentence — a shape no locale can translate. It is now a
  per-type key (`fields.recipient.selectUser`, `…selectBusinessUnit`, …), so
  "选择业务单元" and "Select a business unit" no longer have to share a structure.

  **Editing a rule silently dropped its recipient.** The picker resets the stored
  id when `recipient_type` changes, because an id valid for a user is meaningless
  for a team. It treated the edit form's `'' → 'user'` hydration as such a change:
  opening any saved rule blanked the recipient, and saving persisted the blank.
  Only a non-empty predecessor now counts as a type switch.

  **Building a filter submitted the surrounding form.** None of `FilterBuilder`'s
  controls declared `type="button"`, and a bare `<button>` inside a `<form>`
  defaults to `type="submit"`. Adding, removing or clearing a condition therefore
  submitted the sharing-rule dialog — firing validation mid-edit, and on an
  already-valid form saving the record before the admin was done.

  **A rejected write showed the user raw server diagnostics.** The form rendered
  `error.message` verbatim, so a sharing / RLS denial reached the dialog and the
  toast as `FORBIDDEN: insufficient privileges to update showcase_private_note
pi-TgoJ4_DM55Fqz` — untranslated, and leaking the object's machine name and the
  record id to whoever hit it. Permission failures now render localized copy
  (`form.noPermissionToSave`, added in all ten locales), with the server text kept
  on the console for debugging; other failures still show the server's message,
  which is the useful part, and fall back to `form.submitFailed` when there is
  none — replacing the previously hardcoded English "An error occurred during
  submission".

  **The detail header offered "Edit" on records the user may only read.** Object
  permissions can't express "this one record is read-only" — a read-only sharing
  grant sits inside an object the user may otherwise edit — so the header showed
  the primary Edit CTA, opened the form, and let the user retype a field before
  the server rejected the save. `DetailView` now gates Edit / Delete on the
  object-level check AND on the explain engine's record-grained verdict
  (`POST /api/v1/security/explain` with a `recordId`, ADR-0090 D6 / ADR-0095 C2 —
  the same pipeline the enforcement middleware runs, so button and server cannot
  disagree). Explaining oneself needs no special permission. The probe is one
  cached request per record, skipped entirely when the object-level check already
  says no, and **fails open** on every uncertainty — an unanswered hint must never
  be the reason a permitted user cannot act; the server stays the authority
  (ADR-0057 D10).

  **A long option rendered straight past the combobox border.** `Combobox`'s
  trigger pinned itself to the component's `w-[200px]` default while the fields
  around it ran the full form column, and the selected label was a bare text child
  of a flex button — flex items need `truncate` AND `min-w-0` to clip, and it had
  neither. So "成员 (showcase_project_membership)" in the object picker overflowed
  the control and collided with the field beside it. The label now truncates, the
  trigger can shrink, the dropdown matches the trigger's width instead of a
  hardcoded 200px (a widened combobox used to clip its own options), and the two
  sharing-rule pickers ask for `w-full` so they line up with every other input.

  Hardens `evaluatePermission` while there: a role config carrying only
  `fieldPermissions` (no `actions`) made `check()` throw a TypeError that
  propagated out of the render. A permission check must not be able to crash a
  view.

  Browser-verified against the framework showcase Console in Chinese: object /
  criteria / recipient copy is fully localized, the recipient dropdown lists real
  users, business units and positions, a saved rule reopens with its recipient and
  criteria intact, editing the filter no longer submits, and a rule created
  end-to-end stores a real record id rather than free text. The criteria authored
  in the builder is honored by the evaluator: `{"pinned":true}` on an owner-private
  object granted the recipient exactly the matching records and nothing else.

- c6aaed8: fix(i18n): retire four hand-rolled zh/en branches (objectui#2871, part 1)

  Four surfaces decided their language with a hand-written `startsWith('zh')`
  check instead of the locale packs, so the other eight shipped languages
  silently rendered English and the strings could never be translated without a
  code change.

  - **`RecordTitleChip`** carried a private zh-CN/zh-TW dictionary behind a
    comment claiming "components is i18n-free". That is not true —
    `@object-ui/components` declares `@object-ui/i18n` and its sibling
    `containers.tsx` already uses it. All four of its keys (`detail.copied`,
    `detail.copyRecordId`, `detail.addToFavorites`, `detail.removeFromFavorites`)
    already existed in **all ten packs**, so this deletes ~35 lines and fixes ten
    locales with zero new translations. It renders on every record detail page.
  - **`EnvironmentListToolbar`**'s three state-aware CTA labels move to a new
    `environment.*` namespace. This surface had already regressed once for the
    same reason (#844) and was fixed then with inline `{en,zh}` pairs.
  - **`StudioAiCopilot`**'s dock title moves to the Studio catalog as
    `engine.studio.aiCopilot`.
  - **`StudioHomePage.relativeTime`** now uses `Intl.RelativeTimeFormat` with
    `numeric: 'auto'` instead of five `zh ? … : …` ternaries. This is strictly
    better than adding ten catalog keys: it covers every locale, applies the
    correct plural rules, and yields "yesterday" / 「昨天」 rather than "1d ago".
    Arabic gets its dual form («أسبوعين») — something a ternary cannot express.

  The new `environment.*` keys are added to all ten packs, so this does not widen
  the gap tracked by objectui#2872 part (a).

  `EnvironmentListToolbar`'s tests now render inside a real `I18nProvider` pinned
  to `en`. Without one, `t()` returns the raw key, so the previous assertions on
  literal English would have been asserting nothing.

- 263f885: fix(i18n): delete the four `pick({en,zh})` clones (objectui#2871, part 2)

  Four files each carried an identical private resolver:

  ```ts
  function pick(label: I18n): string {
    const lang = document.documentElement.getAttribute("lang") || "en";
    return lang.toLowerCase().startsWith("zh") ? label.zh : label.en;
  }
  ```

  Only Chinese was ever handled, so ja/ko/de/fr/es/pt/ru/ar silently rendered
  English — and because the copy was baked into the components as inline
  `{en, zh}` pairs, no translator could reach it. All four copies are deleted
  along with their `I18n` type alias.

  Migrated to the locale packs, **all ten languages**:

  - `excelImport.*` (8 keys) — `ExcelImportBar`. The completion toast becomes a
    proper `{{count}}` / `{{object}}` interpolation instead of a template literal
    baked into both language variants.
  - `cloudOnboarding.*` (5 keys) — `CloudOnboardingNext`, the Cloud welcome page.
  - `aiModelStatus.*` (11 keys) — `CloudAiModelStatus`, including the
    `sourceLabel()` enum→prose helper (now `t`-driven with a `{{source}}`
    placeholder) and the three `ModelRow` labels. The conditional
    `(HTTP nnn)` fragment becomes two whole sentences rather than a string
    spliced mid-clause, which is not translatable into every word order.
  - `chatbotQuota.*` (4 keys) — the AI quota banner in `ChatbotEnhanced`.

  The chatbot banner keeps choosing between the server's `quota.message` (zh) and
  `quota.messageEn` — that pair is server-owned — but now decides using the
  console's active language instead of `navigator.language`, which had ignored
  the in-app locale switcher entirely.

  `CloudOnboardingNext`'s tests now render inside a real `I18nProvider`; without
  one `t()` returns the raw key, so the previous assertions on literal English
  were asserting nothing.

  This completes the `pick()` cluster from #2871. The remaining
  `startsWith('zh')` sites are the ones that classification marked KEEP —
  `LoadingScreen` (bootstrap, selects real locale packs before i18next is up),
  `conversationLanguage` (detects the chat's language for the agent, not UI
  copy), `containers.tsx` (normalises author-supplied schema data; its `'与'`
  separator is a CJK typography rule), and the Studio catalog / `field-types.ts`
  data catalog.

- dc334da: fix(i18n): close the last three zh-branch gaps (objectui#2871, part 3)

  The three items the #2871 classification marked as real but _not_ a
  migrate-the-copy fix. Each needed a different remedy.

  **`LoadingScreen` — ten languages collapsed to two.** The boot splash already
  selected real locale packs (not inline copy), but through
  `lang.startsWith('zh') ? zh : en`, so a ja/ko/de user watched the whole startup
  in English. It now indexes `builtInLocales` by the two-letter prefix.

  Each field falls back to `en` **individually**, which matters: `console.*` is
  one of the namespaces that trails in the non-`zh` packs (objectui#2872 part a),
  so a whole-object swap would have rendered `undefined` on the splash rather
  than English. `console.loadingHint` was in fact missing from all eight — added
  here, since a blank line under the progress list is worse than an English one.

  **`containers.tsx` — two language sources that could disagree.** The tab-label
  call sites resolved `language` from `useObjectTranslation()`, then handed the
  string to `translateLabel`, which called `detectLocale()` and read
  `document.documentElement.lang` on its own. Those update independently, so an
  in-app language switch could leave a tab label and its surrounding chrome in
  different languages until the next reload. `language` is now threaded in, and
  `detectLocale` is deleted so nothing reaches for the DOM again.

  **`field-types.ts` — a two-language data catalog.** `FieldTypeMeta` carried a
  `labelZh` column beside `label`, which capped the field-type picker at English
  or Chinese by construction. The 46 type names and 9 category names move into
  the Studio catalog as `engine.fieldType.<id>` / `engine.fieldCategory.<cat>`,
  generated from the existing values so no wording changes. This removes the
  `isZh` helper from **both** `ObjectFieldInspector` and `ObjectFormCanvas` — the
  two files the classification listed as "keep the component, fix the catalog".

  The picker's search filter previously matched `id`, the English label, and
  `labelZh` — so searching in Japanese or German matched nothing. It now matches
  the label as the user actually sees it.

## 16.1.0

### Minor Changes

- af1b0db: feat(i18n): localize action result dialogs via the `_actions.<action>.resultDialog` convention

  The post-success secret-reveal dialog (create-user temporary password, 2FA
  backup codes, OAuth client secrets) always rendered the hardcoded English
  metadata literals — the spec bundles now carry `resultDialog` translations
  (objectstack `_actions.<action>.resultDialog.*`), but nothing resolved them
  client-side.

  - **@object-ui/i18n.** `useObjectLabel()` gains `actionResultDialog(objectName,
actionName, spec)`: overlays translated `title` / `description` /
    `acknowledge` and per-field labels onto the metadata spec, falling back to
    the literals. The `fields` node is keyed by the LITERAL result-field path
    (may contain dots, e.g. `"user.email"`), so it is fetched whole with
    `returnObjects` and indexed directly — never resolved through a dotted
    i18next key. Built-in locale packs also translate the dialog's fallback
    `defaultTitle` / `acknowledge` (previously English in all ten locales) and
    add the new `actions.resultDialog.copyAll` key.
  - **@object-ui/app-shell.** The result-dialog handlers in
    `useConsoleActionRuntime` and `RecordDetailView` accept the action context
    (already passed by `ActionRunner`) and localize the spec before opening the
    dialog; `ActionResultDialog`'s hardcoded "Copy all" button now goes through
    `actions.resultDialog.copyAll`.

### Patch Changes

- 0318118: fix(app-shell): block ActionParamDialog submit while a file/image param is uploading; map spec `autonumber` (ADR-0059 follow-ups)

  Two follow-ups to the shared-field-widget param rendering (ADR-0059):

  - **Upload-in-progress guard.** A `file`/`image` param's value only becomes its
    fileId once the presigned upload settles, so confirming mid-upload sent an
    empty/stale value. `FileField`/`ImageField` now surface their upload state via
    an optional `onUploadingChange` prop (shared `useUploadingSignal` hook,
    ignored by other widgets); `ActionParamDialog` wires it for `file`/`image`
    params and disables Confirm (label → "Uploading…", new `actionDialog.uploading`
    i18n key across all locales) plus blocks submit while any upload is in flight.
  - **`autonumber` spelling.** `mapFieldTypeToFormType` now maps the spec
    `FieldType` spelling `autonumber` (in addition to the widget-map key
    `auto_number`) to the AutoNumber widget, so a spec-typed `autonumber`
    field/param no longer falls through to the plain text input — fixes the object
    form path as well as action params.

- 1100a8b: feat(plugin-gantt)!: remove the 移动端二维码 (mobile QR share) context-menu item

  The QR-share feature is removed outright: the context-menu item, the QR dialog,
  the `taskUrl` prop on `GanttView`, the URL wiring in `ObjectGantt`, the
  `gantt.menu.qrcode` / `gantt.qr.*` i18n keys (en/zh) and the `qrcode`
  dependency are all deleted. It baked one consumer's app-specific requirement
  (scan-to-open on mobile) into the generic gantt renderer, and what it encoded —
  the desktop console record URL — was not even the right target for that
  requirement. Apps that need scan-to-mobile flows should implement them
  app-side against their own mobile surface.

- 7abe4cd: **Console user-import wizard defaults to the `auto` password policy (tracks framework#3236).** The "Sign-in setup for imported users" selector gains an **Automatic (recommended)** option and it is now the default (was "No password"). `auto` decides per row on the server: reachable users get an invitation (email / SMS), anyone who can't be reached gets a one-time password shown once on the result screen — so it works with or without an email/SMS service, and the one-time-password reveal now surfaces only the rows that actually fell back (instead of the whole batch under `temporary`).

  The other three policies are unchanged and still selectable: `invite` (force invitations, unreachable rows fail), `temporary` (force one-time passwords for every row), `none` (identity only). New `console.identityImport.policy.auto` / `policyHint.auto` strings added for `en` and `zh`; the `none` label drops its "(recommended)" marker.

- ebe6494: chore(lint): clear the baseline lint errors in nine more packages (objectui#2713 Wave 2)

  Second wave of the #2713 lint-gate restoration (after #2730). These nine package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations. Cleared every **error** (no behavior change; warnings out
  of scope):

  - **`react-hooks/rules-of-hooks`** (`i18n`, `plugin-grid`, `plugin-view`,
    `plugin-list`) — translation helpers (`useSafeFieldLabel`,
    `useRowActionTranslation`, `useViewLabel`, `useViewTabLabel`, `useMoreLabel`)
    wrapped a provider-safe hook (`useObjectTranslation`/`useObjectLabel`, which
    never throw) in try/catch; removed the wrapper (the same fix #2709 applied in
    fields). `plugin-kanban` `ObjectKanban` moved its `if (error)` early return
    below the `useCallback` so hooks run unconditionally. `collaboration`
    `__unsafe_usePresenceContext` keeps its deliberate danger-prefix name via a
    justified scoped disable.
  - **`react-hooks/static-components`** (`layout`, `plugin-list`, `plugin-report`)
    — dynamic-icon / registry lookups (`resolveIcon`, `useRegistryComponent`) are
    stable component references, not components created during render → scoped
    disable with justification. `plugin-charts` `TreemapCell` was a _genuine_
    inline component and is hoisted to module scope (it is purely props-driven).
  - **`no-irregular-whitespace`** (`plugin-grid` `ImportWizard`) — the literal
    U+FEFF BOM prepended to exported CSV/text blobs (so Excel detects UTF-8) is
    now written as the `﻿` escape: byte-identical at runtime, no literal
    irregular-whitespace character in source.
  - **`no-useless-assignment`** (`plugin-grid` `BulkActionDialog`) — dropped a
    dead `= null` initializer that the exhaustive `switch` (incl. `default`)
    overwrites before it is read.
  - **`no-unsafe-function-type`** (`plugin-view` `ViewTabBar`) — the dnd-kit
    render-prop `listeners` map is typed `Record<string, (...args: any[]) => void>`
    instead of bare `Function`.
  - **`no-require-imports`** (`plugin-kanban`, `plugin-view` tests) — hoisted
    `vi.mock` factories use an `async` factory with `await import('react')`.

- f80aaf2: **Distinguish writable `system` objects from engine-owned ones in the Console (framework ADR-0103 / #3220).** The framework split the overloaded `managedBy: 'system'` bucket: engine-owned rows stay read-only, but several `system` objects are admin/user-writable _data_ (Notification Preferences/Subscriptions/Templates, delegated RBAC assignments, user preferences) and declare `userActions` opening their writes.

  The Console already surfaced the New/Edit/Delete buttons correctly for these (all affordance mirrors honour `userActions`), but the badge and empty-state _copy_ still called every `system` object a "read-only monitoring surface". Now:

  - **`ManagedByBadge`** takes the object's `userActions` and, when a `system` object opens any write, renders the "Platform schema — admin-writable" variant instead of the engine-owned copy.
  - **`resolveManagedByEmptyState`** returns `undefined` for a `system` object whose `userActions.create` is set, so the generic empty state (with the New button) shows instead of "entries appear automatically".
  - New `managedByBadge.systemWritable.*` strings (en + zh; other locales fall back to the English default).

  Copy/UX only — no behavioural change to what a user can do.

- 29c6040: fix(app-shell): redo the record-list "Add View" create flow — empty-name 405, invisible drafts, canonical naming

  Rebuilds the record-list "Add View" / "Save as view" create path so a
  runtime-created view has one canonical identity and is actually verifiable
  before publish (supersedes #2754; fixes #2767).

  - **Unified identity (P1).** New `viewEnvelope(objectName, spec, { name, label })`
    seam in `runtime-metadata-persistence.ts` emits the canonical ViewItem
    (`{ name: '<object>.<key>', object, viewKind: 'list', label, config }` with
    `config.data = { provider: 'object', object }`), mirroring the Studio
    `anchors.ts:createBuildBody`. The **qualified** name is passed as BOTH the
    `PUT /meta/view/:name` URL segment and `body.name`, so the `sys_metadata`
    row key, the ViewTabBar tab id, and the body identity all agree and the
    draft → read → publish loop resolves. `ObjectView` and `ObjectDataPage` both
    call the single helper — the duplicated envelope block is gone (P6).
  - **Empty-name guards (405).** `MetadataClient.save()` and
    `createRuntimeMetadata()` throw a clear contextual error instead of emitting
    `PUT /meta/view/` (empty `:name`, server 405).
  - **Draft visibility (P2/P3/P4).** `DataSource.listViews(objectName, { previewDrafts })`:
    in draft-preview mode the `ObjectStackAdapter` makes a **single**
    `MetadataClient.withPreviewDrafts(true).list('view')` request and uses the
    server's already-overlaid list (draft wins by name, `_draft` tagged) —
    replacing, not appending, so a draft that edits a published view can't
    double-tab. No hand-rolled `fetch` of metadata routes at the adapter layer.
    After a create in normal mode the console navigates to the new view with
    `?preview=draft`, so the DraftPreviewBar is visible and Publish is one click.
  - **CJK-aware naming (P5).** `CreateViewDialog` gains an editable machine-name
    field, prefilled via `slugify(label)` for Latin labels and required (submit
    disabled) when slugify yields empty for non-Latin labels — no more silent
    random `task_grid_mrsyt56j` names. New `console.objectView.viewName*` keys
    (en/zh).

## 16.0.0

### Patch Changes

- ca0f5f0: Login page surfaces the dev-seeded admin credentials. The framework runtime seeds `admin@objectos.ai` on an empty development database, but nothing on the login page said so — new users clicked "Sign up" and landed in an empty non-admin workspace (15.1 third-party eval). When `GET /api/v1/auth/config` reports `devSeedAdmin` (dev-only; the server omits the field in production and once the default password is changed), the page renders a dismissible amber banner with the credentials. Dismissal persists per browser via localStorage.

## 15.0.0

## 14.1.0

### Patch Changes

- 82441e4: feat(console-ai): proactive AI usage indicator in the ChatDock (ADR-0057 #8)

  Surfaces remaining AI headroom **before** a send hits the 429 wall, instead of
  only learning the limit reactively.

  - **AiUsageIndicator** — two meters (build + dataChat) as small progress rings in
    the ChatDock header (desktop rail + mobile sheet). Near-full → an amber
    "running low" hint and a popover with "resets tonight / next cycle" plus the
    upgrade / top-up CTA (reusing the 429 deep-link). D5-safe: fractions and
    qualitative words only, never a token number. Hides itself when the usage
    endpoint is absent (older backend / OSS / no seat).
  - **useAiUsage** — fetches the D5-safe per-meter fractions; refetches on the chat
    engine's post-turn / 429 nudge and on tab re-focus; fails soft to nothing.
  - **useObjectChat** emits `AI_USAGE_REFRESH_EVENT` on a rejected send (429) and on
    the turn-finish edge so the ring updates right after the user's action.
  - i18n: `console.ai.usage.*` in en + zh-CN.

  Consumes the cloud `GET /api/v1/ai/usage` endpoint (objectstack-ai/cloud#824).

- 2efa9fd: Detail-page UX follow-ups from the ADR-0085 PR4 real-backend browser pass (framework#2548):

  - **Highlight strip no longer repeats the record title.** A declared
    `highlightFields` list containing the title field rendered it as the first
    chip — truncated — directly under the identical page H1. `deriveHighlightFields`
    now resolves the title (`primaryField` / `nameField` / deprecated
    `displayNameField`, else the conventional display-field names) via the new
    exported `resolveTitleField` and filters it from declared lists before the
    4-chip cap, matching what the heuristic branch always did. app-shell's
    `RecordDetailView` synthParts (which pre-computes the list and bypasses the
    derivation) applies the same filter.
  - **Per-field currency reaches the renderers.** The spec channel
    (`currencyConfig.defaultCurrency`) was dropped by the highlight-strip and
    detail-section field enrichment, so a spec-authored currency field could
    never show its symbol ("25,000,000" instead of "$25,000,000");
    `resolveFieldCurrency` reads it second after the designer-only bare
    `currency` key.
  - **app-shell approvals fetches send the Bearer token.** The header badge
    poll, home-inbox count, and record-page approvals panel were cookie-only
    (new shared `bearerAuthHeaders()` util) — same split-origin failure mode as
    the console `approvalsApi` fix below.
  - **`fieldGroups[].icon` / `description` reach detail pages.** The shared
    derivation (ADR-0085 §5) already passed them through; the detail synth
    dropped them. Sections now carry both, and `DetailSection` renders a real
    Lucide icon for identifier-shaped names (emoji/text values keep the
    historical text rendering).
  - **Record meta footer stops dangling without an actor.** Seeded/system rows
    with `created_by: null` rendered "Created by · 10m ago"; the footer now
    falls back to actor-less labels ("Created / Updated"), with new i18n keys in
    all six locales (and the zh `createdBy`/`updatedBy` mistranslation fixed:
    创建人/更新人, not 创建于/更新于).
  - **Select badges ellipsize instead of clipping mid-glyph.** In bounded
    containers (highlight-strip columns, grid cells) an overlong option label
    used to be cut at the container edge ("Technolog…"); badges now shrink with
    an inner truncate and expose the full label as a hover title. The highlight
    strip's hover title also prefers the option label over the raw stored value.

  Console app (unversioned): `approvalsApi` now sends the stored Bearer token
  like every other console call — cookie-only auth silently lost the approvals
  surface on split-origin deployments where the SameSite cookie doesn't flow.

- e628d1f: Dashboard-level filters follow-ups (#2578, framework#2501):

  - **i18n**: the `DashboardFilterBar` strings now ship as real locale entries —
    `dashboard.filters.*` (bar label, "All time", "Custom…", "All", "Reset",
    and the 13 date-range preset labels) added to `en` and `zh`. Previously the
    bar always rendered the `useSafeTranslate` English fallbacks.
  - **types**: `GlobalFilterSchema.name` and `DashboardWidgetSchema.filterBindings`
    landed in `@objectstack/spec` (framework#2501), so the local type
    annotations flip from "Pending alignment" to "Aligned" — no shape changes.

  Also adds five schema-catalog examples (`plugin-dashboard/filtered-dashboard-*`:
  dynamic `optionsFrom` options, text/number/lookup filter types, dataset +
  inline widget mix, `targetWidgets` allow-list, date presets + custom range)
  and a new "Dashboard-Level Filters" guide page covering the full tutorial,
  `page.*` expression usage, and known limitations with workarounds.

- 23d65c3: fix(i18n): `createSafeTranslation` / `useSafeTranslate` no longer wrap the
  translation hook in try/catch — the last known rules-of-hooks violation of
  the class fixed in objectui#2595/#2596 (a throw after the hook ran would
  desync hook order on the next render; the factory closure just escaped the
  static lint). `useObjectTranslation` is provider-safe, and the actual
  fallback behavior is unchanged: the testKey probe (createSafeTranslation)
  and per-key `t(key) === key` detection (useSafeTranslate) still return the
  English defaults when translations aren't configured. The fallback `t` is
  now a stable per-factory reference, so downstream memo deps stop
  invalidating every render in the no-translations case.

## 14.0.0

### Patch Changes

- c70bca7: fix(console-ai): Live Canvas is a full-screen, opt-in preview on mobile — not a broken split (#2481)

  On a phone the beside-chat Live Canvas split overflowed the viewport (the chat
  column's fixed min-width plus the preview exceeded the screen, and the resize
  handle is desktop-only, so it was stuck clipped). Under `md` the canvas is now:

  - **Full-width chat, no split** — the build streams in the chat as before.
  - **Opt-in + full-screen** — when the preview is available a floating "Preview
    app" pill appears; tapping it (or a Preview button on a draft card) takes the
    canvas full-screen over the chat. Closing returns to the chat with the
    preview one tap away. The auto-drafted canvas never covers the streaming
    chat unprompted.

  Desktop is unchanged (the resizable beside-chat split). Adds the
  `console.ai.previewApp` string (en/zh).

- 05e56ca: 导出/导入模板的下载文件名与内容本地化。

  **导出文件名**:CSV/Excel/JSON 导出下载不再是 `<对象名>.<扩展名>`(如 `contracts.csv`),改为「对象显示名-视图名-时间戳.扩展名」(如 `任务-In Progress-20260714-153045.xlsx`);`exportOptions.fileNamePrefix` 配置仍优先(且作为完整前缀,不再追加视图名)。视图名与对象名重复时自动省略;`@object-ui/core` 新增 `buildExportFileName(ext, { prefix, label, objectName, viewLabel }, now?)` 与 `sanitizeFileNameBase(raw)`,ObjectGrid 与 ListView 的所有导出路径(服务端流式与前端兜底)统一走它。app-shell/plugin-view 的 ObjectView 现将当前视图的显示标签写进传给 ListView 的 schema(`label`),使导出文件名能区分同一对象的不同保存视图。

  **导入模板**:「下载模板」修复两处英文漏出——示例行的 select/多选取值改为优先取选项**显示标签**(如 `准备中`)而非 ASCII slug(`prepare`,服务端导入两者都接受);模板文件名本地化为 `{{object}}-导入模板.csv`(新增 i18n key `grid.import.templateFileName`,英文回退 `{{object}}-import-template.csv`)。

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

## 13.2.0

### Patch Changes

- 53c40c2: feat: identity import — the stock ImportWizard now drives sys_user bulk import (framework#2782)

  The Users list gets an Import entry for platform admins (gated on
  `features.admin` from `/api/v1/auth/config` plus workspace-admin), wired to
  the dedicated `POST /api/v1/auth/admin/import-users` pipeline instead of the
  generic data import (which would bypass better-auth hashing and produce
  accounts that can never sign in).

  - **plugin-grid**: two generic, backend-agnostic ImportWizard slots —
    `extraOptionsContent` (host-injected options on the preview step) and
    `renderResultExtra` (host-rendered content on the result step).
  - **app-shell**: identity import dataSource adapter — splits files into the
    endpoint's ≤500-row batches (idempotent upsert makes re-runs safe), injects
    the selected password policy, renumbers per-batch results onto the whole
    file, and enriches rows with their sign-in identity. Password policy panel
    (`none` default / `invite` / `temporary`) and a one-shot temporary-password
    reveal with CSV download (client memory only — nothing is persisted).
    Async-job/undo surfaces are hidden for identity import by design.
  - **auth**: `AuthPublicConfig.features.admin` typing.
  - **i18n**: en/zh strings for the identity import panels.

## 13.1.0

## 13.0.0

### Minor Changes

- 9e38270: feat(setup): "Connect an agent" page widget (`mcp:connect-agent`) — framework#2714 Phase 1, #2363

  The interactive body for the plugin-carried Setup page shipped by
  `@objectstack/mcp`: the environment's MCP URL (from `/discovery`), per-client
  connect cards (claude.ai/Desktop, Claude Code incl. the official plugin,
  Cursor one-click deeplink, VS Code, Codex CLI), the SKILL.md download
  (`GET /api/v1/mcp/skill`), and show-once API-key minting for headless
  callers via the existing `POST /api/v1/keys`. Renders a disabled empty state
  when discovery doesn't advertise `routes.mcp` (deployment opted out).
  Translations for all nine locales.

## 12.1.0

### Minor Changes

- e1840bf: Signal the platform's preview stage in the UI.

  The console top bar (`AppHeader`) now shows a small **Preview** chip next to the
  product wordmark on every surface (home / app / orgs), so users always know the
  whole platform is pre-GA. It's a new `PreviewBadge` component driven by a
  `branding.stage` field in runtime-config (`'preview' | 'beta' | 'ga'`, exposed
  via `getPlatformStage()`), which defaults to `'preview'` so the badge shows out
  of the box. Operators flip the stage to `'ga'` at launch (`OS_PRODUCT_STAGE` /
  `RuntimeConfigPlugin`) and the badge disappears with no code change; `'beta'`
  renders a "Beta" chip instead. Labels are localized under `topbar.stage.*`.

### Patch Changes

- 6cbccf3: Localize form validation messages, toast client-side validation failures, and make native date/time picker icons legible in dark mode.

  Record-form validation messages (required, min/max length, min/max value, pattern, email, URL) were hard-coded English even when the field label was localized — e.g. a Chinese "计划开始日期" field showed "计划开始日期 is required". `buildValidationRules` baked English strings, so the form renderer's `t(...)` fallback never applied. It now emits `required: true` and, for the other rules, a `messageKey` + `undefined` message (a field-authored `*_message` still wins and passes through verbatim); the form renderer fills the blanks via i18n (`validation.*` keys already exist in every locale), so messages track the label's language.

  When client-side validation blocks a submit, the offending field's inline error can sit below the fold in a long modal/drawer form — the user clicks 创建 and sees nothing happen. The form renderer now also fires a `toast.error` naming the fields (`validation.formInvalid`, added to all 10 locales), mirroring the existing server-error toast so the feedback is visible regardless of scroll position.

  Separately, native controls now declare `color-scheme` (`light` on `:root`, `dark` on `.dark`), so the webkit calendar-picker-indicator and other built-in glyphs render light-on-dark instead of vanishing against the dark input background.

## 12.0.0

## 11.5.0

### Minor Changes

- 544d8eb: Add the app → Studio reverse bridge (ADR-0080): workspace admins see a "Design in Studio" entry in the app top bar that deep-links to the running app's owning package on the Studio design surface (`/studio/:packageId/data`). Hidden for non-admins and for apps with no owning package; package writability stays server-side (read-only packages open as browse-only).
- 1072701: Import wizard: use registered server-side import mappings (framework #2611). When an object has `mapping` metadata artifacts targeting it, the wizard shows a "Saved mapping" selector; picking one hands rename + transforms + write semantics to the server (the artifact is authoritative), replaces the manual column table with a read-only summary of the mapping, and submits `mappingName` over source-header rows (mutually exclusive with the inline column rename). `ImportRequestOptions` gains `mappingName`; the objectstack adapter gains `listImportMappings(objectName)` (feature-detected — the selector simply doesn't appear when unsupported). New `grid.import.*` strings added across all locales.

## 11.4.0

### Patch Changes

- 9cd9be1: fix(plugin-grid): make the import wizard's preview step readable — wider columns + friendlier validation errors

  Two problems on the import wizard's 预览 (preview) step:

  - **Cramped preview table.** With many mapped columns crammed into the fixed
    dialog width, each header collapsed to one character per line (`关联排班计划`
    stacked vertically) and became unreadable. Columns now get a `min-width` and
    headers no longer wrap, so the preview area scrolls horizontally instead of
    crushing every column.

  - **Unreadable dry-run error messages.** A reference cell that couldn't resolve
    rendered as `第 1 行: product: product: no os_tianshun_ehr_product matches "导管架"`
    — the field named twice, an internal object api-name leaking through, all in
    English. The server already tags each failure with a structured `code`, so we
    now drive the message off that code (localized, with the offending value),
    resolve the field's api-name to its label, and only fall back to the raw
    server text — minus the duplicated prefix — for unrecognized codes. The same
    row now reads `第 1 行: 产品：找不到匹配 "导管架" 的记录`.

- 790558b: fix(studio): make the Automations and Interfaces pillars authorable in a fresh package

  Dogfooding a brand-new package end-to-end (design objects → automations →
  interfaces → publish → use) surfaced two blocking dead-ends in the pillar
  Studio, both now fixed:

  - **Automations pillar had no way to create a flow.** For a package with zero
    flows the rail rendered an endless "加载中…" (loading conflated with empty)
    and offered no create affordance, so automations could never be authored.
    It now tracks the list-loaded state (real empty state "还没有自动化 — 点「新建」开始")
    and has a "+ 新建" inline creator that saves a minimal, valid `start → end`
    autolaunched flow skeleton as a draft and opens it in the flow designer.

  - **Interfaces nav items could not be bound to a target — and silently failed
    to save.** Selecting a nav item showed no inspector, and the item shape the
    editor produced (`{ label, object }`, no `id`/`type`) failed the app spec's
    navigation union ("navigation.N: Invalid input"), so the draft never
    persisted and the published app navigation stayed empty. The right panel now
    renders a `StudioNavItemInspector` with a business-friendly object picker
    (populated from the package's published ∪ draft objects) that emits a
    spec-valid `ObjectNavItem` (`{ id, type:'object', objectName, label }`), and
    the nav save drops still-unbound placeholders + backfills a snake_case id so
    one blank item can't fail the whole save.

  Also fills in the Home builder-cover i18n keys (`home.build.*`,
  `home.template.*`) in `en`/`zh` so the "Build an app" / "Start with a template"
  cards resolve real strings instead of falling back to defaults.

## 11.3.0

### Patch Changes

- d88c8ec: fix(data-table): surface inline-edit save failures instead of swallowing them

  A rejected inline-edit save (e.g. a 400 validation failure like an invalid
  status transition) was caught with only `console.error` — the toolbar stayed
  stuck, the cell kept the unsaved value, and the author got no feedback. Now the
  data-table shows the server's reason in the toolbar (with an alert icon) and
  tints the affected row(s) destructive so it's clear which rows didn't persist.
  The pending edit is kept for retry; the error clears on a successful save or on
  cancel. Adds the `table.saveFailed` string across all locales.

## 11.2.0

## 11.1.0

### Patch Changes

- 6726a2b: First-run UX polish (objectstack-ai/objectui#2038) — copy improvements found via the ObjectOS Cloud signup walkthrough:

  - **"Organization" → "Workspace"** across the org picker (`organizations.*` strings, en + zh). The create flow + WorkspaceSwitcher already say "workspace"; the picker ("Your Organizations / No organizations yet") was the lone holdout. Now consistent.
  - **Non-admin empty state** — "There are no applications available to you yet. Please contact your workspace administrator." → "Your workspace is being set up — apps your admin shares with you will show up here." (less dead-end, en + zh).
  - **Cold-start reassurance** — new `console.loadingHint` line under the LoadingScreen steps: "Setting up a new environment can take a few moments." (en + zh).
  - **Signup value-prop** — register subtitle "Enter your information to get started" → "Create your account to start building." (en + zh).

## 7.3.0

## 7.2.0

### Patch Changes

- 8e7c1da: fix(preview): draft-preview bar no longer demands a redundant Publish when nothing is pending

  Under the auto-publish posture an AI build leaves zero pending drafts, yet opening a
  draft preview still showed "Draft preview — Nothing here is live until you publish."
  alongside "Changes (0)" and a Publish button — a self-contradicting, no-op call to
  action. `DraftPreviewBar` now reflects the real pending-draft count: when it is
  known to be zero the bar softens to a neutral preview indicator and drops the
  Publish/Changes affordances; an unknown count (still loading / fetch failed) keeps
  the publish path. `HomePage` (count-gated) and `RuntimeDraftBar` (draft-gated)
  already behaved this way — this aligns the third surface.

## 7.1.0

## 7.0.0

### Minor Changes

- 89e113c: ADR-0044 send-back-for-revision in the approvals inbox (framework #1744/#1769). Approvers get a "Send back" action (violet, with its own dialog) that ends the round as `returned` and unlocks the record; the submitter sees a revision panel on the returned request — edit-record link, optional comment, Resubmit (opens round N+1) and Recall (abandons the revision). New `returned` status badge/filter, Round-N chips (list + drawer), timeline rendering for `revise`/`resubmit` actions, `approvalsApi.sendBack/resubmit`, and ten-locale `approvalsInbox` strings.
- 18d0339: Relabel metadata-driven UI on a language switch without a page refresh (#1319)

  Switching the UI language left server-resolved metadata labels (object/field/
  view labels, action-dialog text) in the old language until a hard refresh,
  because renderers cache those labels by object name and never refetch on a
  language change.

  **`@object-ui/auth`** — `createAuthenticatedFetch` now folds the active
  `<html lang>` into `Accept-Language` on API calls (never clobbering an explicit
  header), so a switch carries the new locale on every subsequent request.

  **`@object-ui/app-shell`** — `ConnectedShellInner` drops the adapter's
  locale-blind metadata cache in the render phase and remounts the metadata
  subtree via `key={language}`, so every renderer refetches in the new locale.
  The adapter and its connection sit above the key and are preserved — an in-app
  relabel, not a reconnect.

  **`@object-ui/i18n`** — dev-mode missing-key warnings: `createI18n` gains
  `warnMissingKeys` (default on outside production) wiring a deduped i18next
  `missingKeyHandler`. `useObjectLabel`'s convention-key probes are flagged so
  their intentional misses (which fall back to server metadata) stay silent.

  Pairs with the framework-side locale-aware metadata changes in
  `@objectstack/client` / `@objectstack/objectql` / `@objectstack/rest`.

### Patch Changes

- 77cc6bb: Cloud Connection bind v2 UX (cloud ADR runtime-identity-binding §2.3): the binding flow becomes one click. `CloudConnectionPanel` drops the environment-id input entirely (registration happens cloud-side at approval), auto-opens the approval page in a popup on Connect (user-code display stays as the popup-blocked fallback), and shows the registered runtime name + runtime id once bound. `DeviceAuthPage` displays the requesting device's context (`runtime_name` / `runtime_version` from the verification URL) plus an "only approve if you started this" warning — the informed-consent surface for the RFC 8628 flow. Two new `auth.device.*` keys across all locales.
- 97c6831: Localize AI workspace, shell navigation, startup, connection, toast, and chatbot affordance text across core console screens.
- c09f44e: Docs: mermaid diagrams + long-doc table of contents (ADR-0046).

  - **plugin-markdown** renders ```mermaid fenced blocks as diagrams (`<Mermaid>`: lazy-loaded mermaid, `securityLevel: 'strict'`, rendered post-`rehype-sanitize`by a trusted component, degrades to the raw source on error). Mermaid is text → SVG, so it stays within the v1 image/binary ban. Adds`extractToc(markdown)`— a TOC builder whose slugs are generated with the same`github-slugger` `rehype-slug`uses, so`#id` links resolve to the rendered heading anchors.
  - **console** `DocPage` shows a sticky right-rail table of contents (h2–h3) for docs with ≥3 headings, plus an app-independent `/apps/:packageId/docs` index already added earlier.
  - **i18n** adds `help.onThisPage` (en/zh; other locales fall back).

- 6cfa330: feat(dashboard): drill "Open in list" escape hatch + unify report drill

  Adopts the mainstream BI peek-then-escalate drill model. Drill-through opens an
  in-place drawer (keep context) and offers an "Open in list →" affordance to
  escalate to the object's full list page (sort / bulk-select / export / shareable
  URL) — the Looker / Power BI "see records → open in page" pattern.

  - New `DrillNavigationContext` (`@object-ui/react`): the app shell provides
    `openRecordList`; the renderer stays decoupled from console routing.
  - The drill drawers (pivot / dataset / chart / KPI) render the escape hatch when
    a host navigation handler is present, and hide it otherwise (self-contained
    peek). `DashboardView` provides the handler via `useOpenRecordList`.
  - `DrillDownConfig.target` gains `'navigate'` — skip the drawer and open the
    list directly; degrades to `'drawer'` when no host handler is available.
  - `ReportView` drill-through now opens the same in-place drawer (peek records →
    click a row to open a record) instead of navigating away; the escape hatch
    preserves the previous navigate-to-list behavior. Dashboard and report drill
    are now unified.
  - i18n: `dashboard.openInList` (en / zh).

- 0ad72a6: fix: pass full gantt config to renderer, render multi-value lookups in gantt tooltips, persist `bodyExtra` on dataSource actions, and complete zh/en gantt labels

  Four platform gaps that the EHR app previously worked around with `node_modules` patches:

  - **app-shell / ObjectView** — the `config.gantt → renderer props` adapter was a hardcoded 6-field whitelist, so `parentField`/`typeField` (and `baseline*`, `groupByField`, `resourceView`, `tooltipFields`, `quickFilters`, …) never reached the renderer and the chart degraded to a flat list. It now spreads the full `viewDef.gantt` first, then applies the three required defaults last (mirroring the gallery branch).
  - **plugin-gantt / ObjectGantt** — the tooltip value formatter only handled single-object lookups, so a multi-value lookup (a populated `[{name},{name}]` array) fell through to `'—'`. It now maps each array element to its display value and joins them.
  - **app-shell / useConsoleActionRuntime** — `bodyExtra` was merged only on the absolute-HTTP path; the generic `dataSource.update` path ignored it, so a pure-confirmation action (no params array) left an empty payload and persisted nothing. `bodyExtra` is now merged last on that path too, matching the documented semantics.
  - **i18n** — added the gantt labels the 9.x renderer references but the bundles lacked: `toolbar.thisWeek/thisMonth/exportPdf/saveLayout`, `viewMode.year`, `menu.add*/removeDependency/noCandidates`, the `linkType.*` and `conflict.*` blocks, and `readOnly*` — in both `en` (canonical key source) and `zh`.

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

- 59b6bbb: i18n the managed-by empty states for system / append-only / better-auth object lists.

  `resolveManagedByEmptyState` previously hardcoded English titles and messages (e.g. "No identity records", "No events recorded"), so list views for managed objects (identity, audit logs, system-generated records) rendered English regardless of locale. It now takes the `t` translator and resolves `list.managedBy.{system,appendOnly,betterAuth}.{title,message}` (English kept as `defaultValue` fallbacks); `ObjectView` passes its `t` through. Added the keys to the `en` and `zh` locale packs.

- bd8b054: fix(currency): resolve the tenant default currency across the long-tail renderers

  Phase 2b of the currency-resolution work (ADR-0053). The cell/field renderers
  already funnelled through `resolveFieldCurrency` + `useLocalization` (#1856),
  but the rest of the renderers still hard-coded `USD` or read only one of
  `currency`/`defaultCurrency`. They now share the same resolution chain — explicit
  field currency -> `currencyConfig.defaultCurrency` -> legacy `defaultCurrency` ->
  tenant `localization.currency` -> plain number:

  - `plugin-dashboard` `ObjectMetricWidget` (inferred currency), `ObjectDataTable`
    (symbol-format fallback).
  - `plugin-grid` `useColumnSummary` (footer agrees with the cells) and
    `ObjectGrid` (compact amount + name-inferred currency cells).
  - `plugin-detail` `DetailView` summary metrics.
  - `plugin-gantt` `ObjectGantt` currency tooltips.
  - `components` `element:number` (`format: 'currency'`) — tenant default instead
    of a baked-in `USD`, and renders with the tenant locale.

  `resolveFieldCurrency` now lives in `@object-ui/i18n` (co-located with
  `useLocalization`, which supplies the tenant default); `@object-ui/fields`
  re-exports it, so the existing import path is unchanged. No behavior change when
  no tenant currency is configured — a field that declares its own currency, or a
  deployment with no `localization.currency`, renders exactly as before.

- 2f31406: Refine Studio package-scoped navigation and home overview.

  Studio now treats the selected package as the home overview scope, flattens the root Overview sidebar group, hides the duplicate all-metadata sidebar entry, redirects the invalid package metadata route to package management, preserves the selected package across package-management navigation, and adds a localized package-management sidebar label.

## 6.2.3

## 6.2.2

## 6.2.1

## 6.2.0

## 6.1.0

## 6.0.4

## 6.0.3

## 6.0.2

## 6.0.1

## 6.0.0

## 5.4.2

## 5.4.1

## 5.4.0

## 5.3.2

## 5.3.1

## 5.3.0

## 5.2.1

## 5.2.0

### Minor Changes

- b2d1704: feat(cmdk): record search across objects in the Command Palette
  - New `useRecordSearch` hook in `@object-ui/react` debounces a query, fans out
    to `dataSource.find(name, { $search, $top })` across candidate objects, and
    aggregates hits. Race-safe via a monotonic runId; per-object 404s are
    silently dropped via `Promise.allSettled`.
  - `CommandPalette` (`@object-ui/app-shell`) now accepts a `dataSource` prop;
    when supplied, the palette renders a `Records` group at the top with hits
    scoped to the active app's nav objects. Item `value` embeds the live query
    so cmdk's client-side filter doesn't hide async results.
  - Added `console.commandPalette.records` i18n key (`Records` / `记录`).

### Patch Changes

- 321294c: Cmd-K now shows recently viewed records in its empty state, sourced
  from the existing cloud-synced `sys_user_preference` adapter (already
  wired by `RecentItemsProvider` + `useTrackRouteAsRecent` +
  `RecordDetailView`). Multi-device by construction: open a record on
  laptop, see it in `⌘K → Recently viewed` on phone.

  - Group renders only when input is empty (no competition with search).
  - Limited to the 5 most recent record-type entries.
  - New i18n key `console.commandPalette.recentRecords` (en + zh seeded;
    other locales fall back to `defaultValue: "Recently viewed"`).

- 0a644f0: feat(app-shell): CommandPalette searching indicator

  When `useRecordSearch` is mid-flight (debounced fetch across objects
  hasn't returned yet), the palette now surfaces a subtle visual:

  - A small pulsing primary-coloured dot next to the **Records** group
    heading, so the user sees that more results may still appear.
  - A `Searching…` placeholder inside the empty state when the user has
    typed something but no hits exist yet — replaces the static
    "No results found." message until the request settles.

  New i18n key `console.commandPalette.searching` (en + zh).

- a3cb88f: CRM UX polish batch:
  - Kanban columns: drop the per-column rainbow top stripe. Lane border + header divider are sufficient; cards are now the loudest thing on screen (Linear / HubSpot pattern).
  - Stage chevron (`record:path`): bump completed-stage contrast (emerald-800 text on emerald-500/15, was 700 on /10) and future-stage text from `foreground/70` to `foreground/85` for legibility.
  - i18n: add `notifications.emptyUnread`, `notifications.filterUnread`, `notifications.filterAll` (en + zh) so the InboxPopover Unread/All sub-filter renders in the active locale.
- 5425608: CRM UX polish pass — calmer enterprise look across detail + kanban.

  - **plugin-kanban**: column headers now use a 2px muted accent stripe with
    neutral foreground titles + a quiet grey count pill instead of full
    rainbow gradient + colored title + colored count. Pipeline boards
    (Opportunity, Case, Task, Lead) look like Salesforce/Linear instead of
    a toy. WIP-limit overflow remains destructive-red so urgency stays loud.
  - **plugin-detail (`record:reference_rail`)**: new `hideEmpty` prop
    (default true) collapses entries whose total === 0 into a single
    `+ N empty (Quotes · Products …)` chip at the bottom of the rail.
    Removes the 4–7 "No records" stack that dominated the aside.
  - **plugin-detail (`record:path`)**: completed stages now render with an
    emerald-tinted background + bold green check instead of low-contrast
    `bg-muted text-muted-foreground` (which read as "light grey on white"
    and was borderline unreadable).
  - **app-shell (`RecordDetailView`)**: record-not-found short-circuit.
    Previously a stale/missing recordId still rendered the page chrome
    (rail, discussion, breadcrumb with the raw id), making invalid links
    look like a partially broken page. Now renders a clean centered
    `Empty` state with database icon + i18n'd "Record not found" copy.
  - **i18n**: added `detail.showEmptyRelated_{one,other}` and
    `empty.recordNotFound{,Description}` keys (en + zh).

- e919433: Stop silently assuming USD when a currency field has no `currency`
  configured. For non-USD orgs (e.g. a CNY-based CRM seeded without an
  explicit currency) the cells now render as plain locale-formatted
  numbers (`150,000.00`) instead of `$150,000.00` — which was the #1
  "why is my RMB showing as dollars?" bug.

  Behavior change is opt-in via omission: when `currency` /
  `defaultCurrency` is set on the field/column, formatting is unchanged.

  Fixed call sites:

  - `@object-ui/fields`: `formatCurrency`, `formatCompactCurrency`, and
    `CurrencyCellRenderer` no longer default-param `'USD'`.
  - `@object-ui/i18n`: `formatCurrency()` falls back to `formatNumber`
    semantics when `currency` is omitted.
  - `@object-ui/plugin-grid`: column-summary formatter (`Sum: 5,000,000`
    instead of `Sum: $5,000,000.00`).
  - `@object-ui/plugin-detail`: header-highlight currency formatter.
  - `@object-ui/plugin-dashboard`: `ObjectMetricWidget` inferred
    currency now resolves to `undefined` (not `'USD'`) for un-tagged
    fields, so `MetricWidget`'s `isCurrency` heuristic falls through
    to plain number formatting.

- d9c3bae: `RichTextField` now translates its inline hints (`Format: markdown`,
  `Rich text editor (basic)`, `Enter text...`) instead of hardcoding
  English. Adds `fields.richText.*` keys to the en / zh locale packs.

## 5.1.1

## 5.1.0

### Minor Changes

- 49b1760: Polish the ConcurrentUpdateDialog and add i18n.

  - Internationalise all dialog strings (title, body, button labels, "your edit" / "current value" headings, audit-trail line) through `useDetailTranslation`. Locale strings added to `@object-ui/i18n` for English and Chinese.
  - Replace the plain dialog header with an amber warning badge + `AlertTriangle` icon to communicate that this is a conflict, not a routine confirmation.
  - Visually differentiate the two value blocks: amber tint for the user's pending edit, sky tint for the server's current value. Both wrap long values cleanly.
  - Surface audit provenance for the racer's write (`updated_at`, plus `updated_by_name`/`updated_by_label` when supplied). Opaque ID-looking `updated_by` tokens are suppressed.
  - Re-prioritise the action buttons: **Reload latest** is now the primary/recommended action (autofocused), **Overwrite anyway** is rendered as a destructive-outline button so the dangerous path requires deliberate intent, and **Cancel** falls back to a ghost variant.

- c0b236f: Platform detail/form polish:
  - **Auto-section grouping**: When an object has no authored `views.form.sections`, the detail page now splits fields into a primary section and a collapsible "More details" section based on a field-type/name heuristic (textarea / markdown / description / notes / remarks). Eliminates the wall-of-fields layout on objects without explicit detail metadata.
  - **FormSection card chrome**: `FormSection` now accepts `showBorder`. Defaults to `true` for titled sections (Card wrapper) and `false` for untitled sections (flat). Same auto-default already applied to `DetailSection`.
  - **Origin breadcrumb**: Navigating from a list/kanban into a record now records the source view; the detail page shows a `← <view label>` back-link above the page header.
  - New i18n key `detail.sectionMoreDetails` (en + zh-CN).

### Patch Changes

- 1976691: Fix the drawer "Open as full page" (maximize) button on the record drawer
  which threw `TypeError: name.indexOf is not a function` and prevented
  navigation to the dedicated detail page.
  - `@object-ui/app-shell` `ObjectView`: pass `objectDef.name` (string) — not
    the whole `objectDef` — into `viewLabel(...)` when computing the
    `originState.from.label` for both drawer-navigate and list-navigate
    flows. Two call sites fixed.
  - `@object-ui/i18n` `useObjectLabel`: harden `stripNamespace` so it
    tolerates non-string inputs and returns an empty string instead of
    throwing, providing a safety net for similar future regressions.

## 5.0.2

### Patch Changes

- cab6a93: **plugin-grid:** column summary footer now formats values using the
  column's type metadata. Currency columns render `Sum: $1,760,000.00`
  instead of bare `Sum: 1,760,000`; percent columns honor `0–1` vs
  `0–100` value ranges; avg uses two fraction digits. `useColumnSummary`
  accepts an optional `fieldMetadata` map (typically `objectSchema.fields`)
  so per-field `type`, `currency`, `defaultCurrency`, `precision` are
  respected.

  **plugin-gantt:** added safe-fallback `useGanttTranslation` hook. All
  hardcoded toolbar `aria-label`s and the `Task Name` / `Start` / `End` /
  `Today` column-header strings now flow through `t('gantt.*')`. A new
  `gantt.*` section is exported from the en/zh/ja/ko/de/fr/es/pt/ru/ar
  locales.

  **app-shell:** `ReportView` no longer hardcodes the `Edit` button label
  or the `Loading report…` fallback — they now use `common.edit` and
  `common.loading`.

  **i18n:** added top-level `gantt` section (with English fallbacks in
  non-en/zh locales) and the `common.addToFavorites` /
  `common.removeFromFavorites` keys across all ten built-in locales so
  the `builtInLocales` parity tests pass.

## 5.0.1

## 5.0.0

### Patch Changes

- 8930b15: feat(detail): close the gap between Page-assigned and default record detail pages (Track 1)

  Custom Lightning-style record detail pages (assigned via `assignedPage` /
  `Page` schemas) used to feel meaningfully poorer than the auto-generated
  default detail view. They were missing cross-cutting affordances and
  shipped with English-only tab labels and heavy bordered section cards
  even when the host locale was Chinese. Track 1 closes the visible gap:

  - **app-shell `RecordDetailView`**: the `assignedPage` branch now wears
    the same chrome as the default branch — lifecycle managed-by badge
    and presence avatars in the top-right, `MetadataPanel` debug panel,
    `ActionConfirmDialog` / `ActionParamDialog`, and an auto-appended
    `RecordChatterPanel` at the bottom of the page. Authors opt out of
    the auto-discussion with `assignedPage.disableDiscussion = true`.
  - **plugin-detail `record:details`**: defaults to `inlineEdit: true` so
    fields are click-to-edit just like the default page, and synthesises
    sections with `showBorder: false` by default so a Lightning page
    doesn't double-wrap every block in a heavy Card.
  - **components `page:tabs` / `page:accordion`**: well-known English
    labels (Details / Related / Activity / History / Notes / Files /
    Tasks / Events / Attachments / Chatter / Discussion / Comments /
    Overview / Summary) auto-translate to Chinese (`zh-CN` / `zh-TW`)
    via a built-in dictionary keyed off `document.documentElement.lang`.
    Authors supplying explicit localised labels (string or
    `{ default, zh-CN, ... }`) are not affected.
  - **i18n provider**: applies the initial language to
    `document.documentElement.lang` on mount (i18next does not fire
    `languageChanged` for the bootstrap language), so locale-aware
    renderers downstream see the right value from the first render.

## 4.8.0

## 4.7.0

## 4.6.0

## 4.5.0

### Patch Changes

- 22fa558: Clean up pre-existing TypeScript errors in `plugin-list` and tighten i18n:
  - Switch grouping-editor labels to `t(key, { defaultValue })` option form so i18next's strict types accept the literal fallback.
  - Add the missing `list.addGroup` / `list.collapsedByDefault` / `list.removeGroup` keys to en + zh locale bundles.
  - Drop the dead `currentView === 'list'` branch in `ListView` (local `ViewType` union has `'grid'`, never `'list'`).
  - Widen `UserFilters.resolveFields` `translateOptions` parameter from a generic `<T>` to the concrete option shape so it matches the `useObjectLabel` hook's signature.

## 4.4.0

## 4.3.1

### Patch Changes

- 5f4ac6e: fix(i18n): add notifications + organizations namespaces to all 8 non-en/zh locales (ar/de/es/fr/ja/ko/pt/ru) to restore top-level key parity. Resolves the long-standing i18n.test.ts locale-parity failure.

## 4.3.0

### Patch Changes

- f196cf4: feat(plugin-report): popup picker for groupings + section-aware test ids

  The matrix/summary "Group by" (rows) and "Columns axis" (cols) sections now
  share the same searchable popup picker as the columns section, with a
  commit-on-select single-pick mode wired through `FieldPickerDialog`.

  - Per-row field buttons display the human-readable field label and open a
    dialog scoped to swap that single field (already-used fields filtered out)
  - "Add grouping" trigger uses the same dialog
  - `GroupingsBuilder` accepts a `testIdPrefix` prop; ReportConfigPanel passes
    `rows-grouping` and `cols-grouping` so both instances no longer share the
    ambiguous `grouping-field-0` testid
  - Bigger row spacing (h-7 / text-xs) — the old `text-[10px]` was unreadable

  `FieldPickerDialog` gains:

  - `commitOnSelect`: hides the Confirm/Cancel footer; clicking a row commits
    - closes immediately (intended for `singleSelect` flows)
  - `trigger`: custom trigger element override (used by the per-row field button)

- ee1cc96: feat(plugin-report): joined-report block editor

  `type: 'joined'` reports were a black hole in the editor — the type
  selector exposed them but no UI knew how to edit the `blocks` array,
  so users could neither create nor modify joined reports without
  hand-editing JSON.

  This change adds a `Blocks` section to the report editor, visible only
  when `type === 'joined'`. Each block renders as a collapsible card with
  its own name (required + unique-validated), label, description, block
  type, object override, and reuses the existing `ColumnsEditor`,
  `GroupingsBuilder`, `SpecFilterAdapter`, and `ChartConfig` builders so
  every block behaves like a mini standalone report — matching the
  runtime contract of `JoinedReportRenderer`.

  Block-level validation is surfaced in the main `ValidationBanner`:
  empty blocks array, missing or duplicate block names, and blocks
  without columns all become editor-time errors so saves stay safe.

  The non-joined sections (Columns / Rows / Columns axis / Filters /
  Chart) are hidden when `type === 'joined'` since they live per-block
  in the spec.

  New exports from `@object-ui/plugin-report`:

  - `JoinedBlocksEditor` — standalone component for embedding the
    block editor anywhere.
  - `validateJoinedBlocks` — pure helper returning translated
    problem strings, suitable for custom validation banners.
  - `ColumnsEditor`, `GroupingsBuilder`, `ChartConfig`,
    `SpecFilterAdapter`, `normalizeColumns` are now exported so
    downstream consumers can build their own report-editor surfaces.

  i18n: added `report.editor.blocks*` / `report.editor.addBlock` /
  `report.editor.removeBlock` / `report.editor.blockName*` /
  `report.editor.blockLabel*` / `report.editor.blockDescription*` /
  `report.editor.validationJoinedNeedsBlocks` /
  `report.editor.validationBlockNameRequired` /
  `report.editor.validationBlockNameDuplicate` /
  `report.editor.validationBlockNeedsColumns` to en + zh.

- 0b032be: feat(plugin-report): replace inline column picker with a popup field picker

  The columns section now opens a Dialog-based multi-select picker (`FieldPickerDialog`)
  instead of rendering the unselected field list inline. The popup supports search,
  batched multi-selection (commit several fields in one click), per-field type badges,
  cancel-discards-pending semantics, and is fully i18n'd. Also fixes a latent
  `ReferenceError: normalizeColumns is not defined` that crashed the editor whenever
  the chart section was expanded.

- 115d36a: i18n: native translations for the report editor (`report.editor.*`) in 8 locales — ar, de, es, fr, ja, ko, pt, ru. Previously these locales had the English placeholder strings copy-pasted from `en.ts` and the newer `blocks*`, `addCondition`, `opContains`, `formatCurrency` etc. keys were missing entirely (so the report editor surfaced raw key names in those languages). All locales now carry the full key set with locale-appropriate copy.
- 4e7bc1b: **Report editor panel overhaul**

  The report configuration panel is now safe to open on any spec-shape `Report` and only exposes fields that are actually persisted by `@objectstack/spec`.

  `@object-ui/plugin-report`:

  - Add a bidirectional `SpecFilterAdapter` so `ReportConfigPanel` can edit
    spec `FilterCondition` filters (`{field: value}`, `{field: {$op: value}}`,
    top-level `$and`/`$or`). Complex / nested filters fall back to a
    read-only banner and are preserved verbatim on save.
  - Drop sections that never round-tripped through the spec
    (`conditionalFormatting`, `sections`, `export`, `schedule`, `appearance`)
    and their helper components.
  - Add type-driven section visibility: `tabular` shows Columns/Filters,
    `summary` adds Rows + Chart, `matrix` adds Rows + Columns axis + Chart.
  - New `GroupingsBuilder` covers `groupingsDown`/`groupingsAcross` with
    `sortOrder` and date-aware `dateGranularity` controls.
  - New `ColumnsEditor` lets users reorder picked columns, override labels,
    set aggregates and choose a display format.
  - Chart subset now mirrors the spec: chart `title`, `showLegend`,
    `showDataLabels`, plus `funnel` (scatter removed).
  - Validation banner highlights missing `objectName` and missing
    rows/columns for `matrix`/`summary` reports.
  - All editor labels and hints are i18n-driven (`report.editor.*`).
  - 18 new unit tests cover the filter adapter round-trip.

  `@object-ui/components`:

  - `FilterBuilder` now guards against malformed external `value` props.
    Previously a spec-shape filter (`{is_active: true}`) would crash the
    component on first render; the builder now falls back to an empty
    AND group whenever `value` is not a valid `FilterGroup`.

  `@object-ui/i18n`:

  - Add `report.editor.*` strings to `en` and `zh`.

- 8442c05: Improve report editor panel usability based on real-user browser testing:
  - **Wider config panel** — the report editor now defaults to a `--config-panel-width`
    of 440px (up from 280px), driven by a new optional `style` prop on
    `ConfigPanelRenderer`. Long field labels, report titles, type labels, and filter
    rows no longer truncate to "Account Na" / "kup" / "ct" / 1-character widths.
  - **Disambiguated "Columns" sections** — for `summary` and `matrix` reports the
    measure list is now labelled **"Values / 度量"** (pivot-style vocabulary) instead
    of "Columns", which previously clashed with the matrix's pivot column axis
    (also called "Columns / 列"). The two sections used to be indistinguishable.
    New i18n key `report.editor.values` / `valuesHint` is shipped for all 10
    locales (en, zh, ar, de, es, fr, ja, ko, pt, ru).
  - **Reordered sections for matrix/summary** — the editor now surfaces _Rows_
    and _Columns_ (the pivot axes) **before** _Values_, mirroring how a business
    user thinks about a pivot table.
  - **Per-row aggregate/format headers** — each column row in `ColumnsEditor` now
    shows small "Aggregate" / "Format" labels above the respective selects, and
    the row uses a 2-line layout so the label input has its own line. The cramped
    3-dropdowns-side-by-side layout at 10px font is gone.
  - **Searchable field picker** — the "Add columns" list now has a search box,
    a `filtered / total` counter, an empty-state message, and a scrollable bordered
    container. New i18n keys: `report.editor.searchFields`,
    `report.editor.noMatchingFields`.

## 4.2.1

## 4.2.0

### Patch Changes

- eb738bd: fix(i18n): add missing top-level `report` key to ar/de/es/fr/ja/ko/pt/ru locales

  The i18n parity test (`all locales have the same top-level keys`) was failing
  because the `report` key existed only in `en` and `zh`. The other built-in
  locales now include the same `report` block (English fallback strings) so the
  CI parity check passes again.

- 650392e: MatrixRenderer now displays i18n-translated labels for picklist (`select` / `status`) groupings instead of raw values (e.g. `Best Case` / `Commit` / `Pipeline` instead of `best_case` / `commit` / `pipeline`). Field labels in the corner cell, row/column total labels, and the `(Empty)` / `(All)` placeholders are also fully translated. Adds `report.*` keys to `en` and `zh` locale bundles.
- 84b4bf1: Summary reports now render i18n-translated labels in the chart axis, chart series legend, and totals strip. `buildChartData` accepts a new `labels` parameter so callers (currently `SpecReportGrid`) can supply field/column/aggregate/value resolvers. Replaces raw column keys (e.g. `Count of case_number`) and raw picklist values (e.g. `closed`, `in_progress`) with their translated display labels (e.g. `案例编号 · 计数`, `已关闭`, `处理中`). Adds `report.totals` locale key.

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

## 4.0.8

### Patch Changes

- 3d58eaa: fix(auth,app-shell): hide Log out menu item when auth is disabled (guest/preview mode)

  When the console runs against a server with `discovery.services.auth.enabled === false`
  (or in preview mode), `AuthProvider` hardcodes `isAuthenticated: true` and the mock
  `signOut()` has no real backend. Previously, clicking "Log out" in the user menu had
  no visible effect — the user/session were nulled but the UI stayed authenticated.

  Changes:

  - **`@object-ui/auth`** — added `isAuthEnabled: boolean` to `AuthContextValue`
    (`true` only when real auth is in use, `false` for guest/preview modes).
  - **`@object-ui/app-shell`** — `AppHeader` and `AppSidebar` now hide the "Log out"
    menu item entirely when `!isAuthEnabled`, so users aren't presented with an action
    that can't actually do anything. Also fixed two missed i18n strings in
    `AppSidebar` ("Settings", "Log out").
  - **`@object-ui/i18n`** — added `user.{profile,settings,logout}` namespace to all
    10 built-in locales (en/zh translated; ja/ko/de/fr/es/pt/ru/ar fall back to
    English pending native translation).

## 4.0.7

### Patch Changes

- fd15918: Comprehensive i18n refactor + CI test fix.

  **i18n (`@object-ui/i18n`)**

  - Added ~130 new keys under 12 new top-level namespaces: `layout`, `search`,
    `empty`, `renderer`, `actionDialog`, `rowAction`, `navigationSync`,
    `objectActions`, `objectViewActions`, `dashboardActions`, `recordDetail`,
    `cellRender`, plus `grid.{empty,yes,no,systemFields,openMenu}`.
  - Mirrored all new top-level namespaces to all 10 built-in locales
    (en, zh, ja, ko, de, fr, es, pt, ru, ar) to maintain key parity required
    by the locale-structure test. Non-en/zh locales seed with English values
    and rely on `fallbackLng: 'en'` until human translation lands.

  **App shell (`@object-ui/app-shell`)** — replaced hardcoded English in 14
  files with `useObjectTranslation`:

  - Layout: `AppSidebar`, `ActivityFeed` (locale-aware relative time),
    `MetadataInspector`.
  - Views: `SearchResultsPage`, `ActionParamDialog`, `RecordFormPage`,
    `RecordDetailView`, `PageView`, `DashboardView` (PDF / forecast toasts),
    `ReportView`, `ObjectView` (rename / delete view toasts).
  - Console: `AppContent` (no-apps empty state).
  - Components: `PageRenderer`, `FormRenderer`, `DashboardRenderer`.
  - Hooks: `useNavigationSync` (16 toasts incl. Undo label),
    `useObjectActions` (delete confirm + success / failure toasts).

  **Plugin grid (`@object-ui/plugin-grid`)**

  - `ObjectGrid` record-detail panel now translates Empty / Yes / No / System
    via the existing `useGridTranslation` safe-fallback wrapper.
  - `RowActionMenu` adopts a local safe-fallback i18n wrapper for
    `Open menu` / `Edit` / `Delete`, preserving standalone-usage guarantees.

  **CLI test fix (`@object-ui/cli`)**

  - `cli-bin.test.ts` auto-builds the package on first run when `dist/cli.js`
    is missing, instead of throwing. This unbreaks `pnpm test:coverage` in CI
    (root vitest run does not honor turbo's `^build` deps) and removes the
    manual `pnpm --filter @object-ui/cli build` requirement for local dev.

## 4.0.6

## 4.0.5

## 4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

## 4.0.1

## 4.0.0

## 3.4.0

## 3.3.2

## 3.3.1

## 3.3.0

## 3.2.0

## 3.1.5

### Patch Changes

- cfe0596: fix i18n

## 3.1.4

## 3.1.3

## 3.1.2

## 3.1.1

## 3.0.3

## 3.0.2

## 3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0
