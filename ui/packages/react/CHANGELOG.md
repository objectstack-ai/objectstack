# @object-ui/react

## 18.1.0

### Minor Changes

- b911ebb: A navigation entry's API `dataSource` and a page element bound to the same read now make one request per console open (objectui#13323). Before, `readElementApi` shared a request only while it was in flight, so when the sidebar's read for an entry's `visible` had settled before the page element mounted, the element sent a second `GET` for an answer the console already held.
  
  `@object-ui/react` exports `ElementApiOpenScope` (with `useElementApiOpen` and the `ElementApiOpen` type): inside it, a read that has already answered under the same `open` name is answered again with no request. A failed read is not kept, a read under another `open` asks again, and any `notifyDataChanged` drops what the open kept. `readElementApi` takes the open as an optional third argument; without one it behaves as before.
  
  `@object-ui/app-shell`'s `ConnectedShell` mounts the scope and names one open per visit of a history entry: following a link or a navigation entry, and Back or Forward, start a new open and read again, even on an entry visited before; a redirect that replaces the address (the app root's landing on its first entry) stays in the open. A language switch starts over. No read happens at a different time than before; only whether a second read in one open reaches the network changes.
- d9aff15: A record page inside the Setup app no longer draws the floating managed-by badge (the amber "Identity" chip at the top-right of an organization, team, business unit or user record) (objectui#13385). The header's object label ("Organization") carries the badge's note instead: hovering or focusing it shows "Organization · Managed by the identity provider", and the note is the label's accessible description. The note is the badge's own tooltip title, under the same gate: only a caller who can author metadata sees it, and a `platform` object shows none. Every record page outside Setup, a `sys_*` object opened in another app included, and every list header keep the badge unchanged.
  
  `RecordContextValue` (`@object-ui/react`) gains an optional, host-injected `objectLabelNote`, which `page:header` forwards to `RecordTitleChip`. `RecordTitleChip` (`@object-ui/components`) gains an optional `objectLabelNote` prop: with it the object label becomes a focusable tooltip trigger described by the note; without it the label draws exactly as before.

### Patch Changes

- 3aafc0d: A page node whose declared `visibleWhen` / `visible` / `visibleOn` predicate cannot be evaluated (over the CEL bounds, a type error, an unbound root, a missing function) is no longer rendered: page visibility gates now fail closed, as a `page:tabs` item already did. The fault is still reported once, and the console line says the node was withheld. A blank gate still means "no gate", and a predicate that evaluates decides as before. A `page:tabs` badge no longer counts a related list withheld this way. Form field rules keep their fail-open (objectui#13299).
- 601c406: The console line for a visibility predicate that cannot be evaluated, on a gate that withholds what it gates, no longer says "a navigation entry" was withheld. The same line is printed for a navigation entry, a `page:tabs` item and a page node, so it now says "an element whose visibility predicate cannot be evaluated is WITHHELD". The verdict, the line's opening, and when it is printed are unchanged (objectui#13303).
- 8e90779: An action's `confirmText`, `successMessage` and `errorMessage` read the `template` envelope and fill `{{ }}` holes (objectui#13367).
  
  `@objectstack/spec` is making these three keys `template` slots (objectstack#24814), so a parsed action serves `{ dialect: 'template', source }` where it served a string. Before this change the success toast skipped the envelope and showed the default text, and the error toast showed the generic failure. `ActionRunner` now reads a string or the envelope for all three, and fills `{{ path }}` / `{{ path | formatter }}` holes with `@objectstack/formula`'s `templateEngine`, the engine the flow notifications render with:
  
  - `confirmText`: `record` (the record the action runs against, the clicked row on a list) and `params` (the action's static params);
  - `successMessage`: `result` (the payload `${result.*}` reads) and `record`;
  - `errorMessage`: no hole is filled; the text shows as written.
  
  A sentence with no `{{ }}` hole keeps today's `${…}` reading, so the platform's own `${result.email}`-style success sentences still work until the spec converts them. A sentence is read in one dialect only: a value filled into a `{{ }}` hole is never read again as `${…}`. An envelope with no text never reaches the dialog or a toast as an object; a `confirmText` envelope with no text still asks for confirmation.
  
  `useActionTextLocalizer` keeps the envelope: it used to read it as a per-locale map and hand the runner the word `template`. A bundle entry replaces the envelope's `source`. On a flow action the console reads the envelope too, so the action's own success copy still outranks the flow's (`flowSuccessCopy`). `@object-ui/core` exports the reader it uses: `ActionCopyTemplate`, `isActionCopyEnvelope`, `actionCopySource`, `hasTemplateHoles` and `fillTemplateHoles`.
  
  Clause-②: yes
  Metadata-protocol: none
- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [5235d6d]
- Updated dependencies [0093b2c]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
- Updated dependencies [0f4adc3]
- Updated dependencies [fa31856]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [4eeb174]
- Updated dependencies [afcf654]
- Updated dependencies [2c3dc72]
- Updated dependencies [2958f17]
- Updated dependencies [1d178e0]
- Updated dependencies [a14737b]
- Updated dependencies [2c4e5f5]
- Updated dependencies [6fb31dc]
- Updated dependencies [ad74e98]
  - @object-ui/types@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/core@18.1.0
  - @object-ui/data-objectstack@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- fd060f0: `ElementDataSourceGate` takes a `requiresObject` prop: when a placement opts in
  and its node names its object in neither place, the gate renders a short "no
  object named" hint instead of the block (objectui#11605).
  
  The object-bound registrations stopped declaring their object key required,
  because the `dataSource` binding can supply it and the page compile has no "this
  key or that binding" form. So the page compile accepts a node that names no
  object at all, and the runtime's answer is the only signal left for it. Several
  blocks answered such a node with an empty list, board, form, chart, dash or pivot,
  which reads as an empty query.
  
  **Clause-②: yes (widening)** — `ElementDataSourceGateProps` gains the optional
  `requiresObject` boolean. With it set, the gate reads the mapping's object key
  (`objectName` unless the mapping names another) on the node after the binding
  lands, so a node bound by `dataSource.object` renders as before; a node that names
  no object gets the hint, "No object named: set objectName or dataSource.object."
  (`data-testid` `{testId}-no-object`), and the block is not mounted. Without the
  prop, or with a mapping whose `object` is `false`, nothing changes. The hint is
  drawn after the view states, so a binding that is still resolving or failed to
  resolve keeps its own panel.
- 2312bd9: A page that declares `print` now prints as a document, and a record page bound to such a page offers a Print action (objectui#11958, the objectui half of the print-page ruling on objectstack#8346, M1, zero server).
  
  - **The print stylesheet.** `PageRenderer` mounts a stylesheet built from the page's `print` declaration, only for a page that declares it. Every rule sits inside `@media print`, so the page on screen is drawn as before. `paperSize` and `orientation` set `@page { size }` (A4 and portrait when omitted). `margins` set one `@page` margin per declared side, in millimetres. `pageNumbers` prints "page / pages" in the bottom-right margin. `repeatHeader` and `repeatFooter` repeat the page's own `header` and `footer` regions on every sheet. `repeatTableHeaders` (on when omitted) repeats a table's column headings on every sheet it runs onto. `avoidBreakInside` keeps each block of a region whole on one sheet when it fits. Only the print page reaches paper: the console chrome and the record view's own panels around the page are hidden, and the page runs onto as many sheets as it needs.
  - **The printable blocks print whole.** On a print page, `record:line_items` no longer cuts lines off at its row cap in silence: when the child object has more lines than the cap (500 unless `limit` is set), the panel draws the cap's lines and the shared row-ceiling note under them, naming both numbers when the server reports a total. A collapsible `record:details` section draws open, because a closed section never reaches paper. Off a print page both blocks behave as before.
  - **The record page's Print action.** When the record page bound to a record declares `print`, the record view shows a Print button that opens the browser's print preview of that page.
  - **New exports from `@object-ui/react`:** `PrintPageProvider`, `usePrintPage` and `PrintPageContext`. `usePrintPage()` returns the enclosing page's `print` declaration, or `null` outside a print page.
  - The source comments that described PDF export as declined now say where a printable document lives: a page that declares `print`.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- c4dd707: feat(react): a page element's API data source is rendered — `dataSource: { provider: 'api', read: { url }, path? }` binds the selected answer as `data` (objectui#12197)
  
  Clause-②: yes
  
  `SchemaRenderer` now honours `@objectstack/spec`'s `ElementApiDataSourceSchema` on every node. It reads the same-origin `read.url` with `GET` through `SchemaRendererProvider`'s `apiFetch` (the global `fetch` when no host supplies one), selects `path` from the answer, and binds the value as `data` in the node's `${…}` holes and its `visibleWhen`, and in its subtree's. While the read is in flight the node draws a loading line; a failed read, or a `path` that selects nothing, draws an error panel naming why, titled in the page's language from two new keys, `element.component.apiRefused` and `element.component.apiUnreadable` (all ten packs). The binding is parsed with the spec's own schema first: a cross-origin or protocol-relative `url`, a credential key, or a non-`GET` method is refused with the spec's message and no request is sent. Elements binding the same URL at once share one request; nothing is cached.
  
  New exports: `useElementApiDataSource`, `judgeElementApiDataSource`, `isElementApiDataSourceShape`, `selectElementApiPath`, `readElementApi`, and the types `ElementApiDataSourceStatus` and `UseElementApiDataSourceResult`. A node without an API binding renders as before and issues no request.
- 5c2982a: A record whose `approval_status` reads `pending` no longer opens locked when the approvals read answered and found no request (objectui#12220).
  
  A composition without the approvals service answers `GET /api/v1/approvals/requests?object=…&recordId=…` with `200 { "data": [] }` and enforces no lock: a `PATCH` to the record succeeds. The record page still showed "Locked for approval", disabled Edit and offered Recall, which had nothing to recall, because the page and the detail body's approval band fell back to the literal `approval_status` column whenever no pending request was found. Records that an app stamped `pending` with no request behind them stayed locked in the console.
  
  - **The rule:** when the approvals read answers, the lock follows the open request. No pending request means no approval band, no lock and no Recall. The `approval_status` column stands in only while no read has answered: the route is absent (404 or 501), the read has not landed yet, or the first read failed. A record with an open request is unchanged, including a `lockRecord: false` node, which stays editable.
  - **`@object-ui/react` adds** `resolveApprovalLock`, the one function the record page and the band both call, with its `ApprovalLockInput` and `ApprovalLockState` types. It also adds an optional `approvalReadAnswered` prop on `InlineEditProvider`, read back on `InlineEditContextValue`. A host sets it when its `locked` and `approvalPending` come from an approvals read that answered. Omitted, the band keeps the column fallback exactly as before.
  - **`@object-ui/app-shell`:** the record page sets `approvalReadAnswered` from its approvals read.
  - **`@object-ui/plugin-detail`:** the band decides through `resolveApprovalLock`.
  
  Nothing is removed or renamed.
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
- 524136e: The view-level `provider: 'api'` data source is no longer read anywhere in objectui (objectui#12325). `@objectstack/spec` retires it (objectstack#23082, ADR-0049): a view binds its object (`provider: 'object'`) or static rows (`provider: 'value'`), and a metadata-declared API call is the page element's `dataSource` binding.
  
  Breaking, declared as `minor` per the version-alignment rule:
  
  - **`resolveDataSource`** (`@object-ui/core`) has no `api` arm. A block that still says `provider: 'api'` is an unknown provider and gets an unknown provider's answer (the fallback DataSource, else `null`); no `ApiDataSource` is built from its `read` / `write`. `ResolveDataSourceOptions` loses `fetch` and `defaultHeaders`, which only that arm read.
  - **`ViewDataProvider`** (`@object-ui/core`) has no `api` arm: such a config resolves with `Unknown data provider: api`. `ViewDataConfig` and `ResolvedData.provider` drop `'api'`, and `DataFetcher.fetchUrl`, which only that arm called, is removed.
  - **`useViewData`** (`@object-ui/react`) no longer keys on or threads anything for an `api` block.
  - **`ObjectGantt`** reads no `api` block: its `read` URL is never requested, and the chart answers it like any unknown provider. `ObjectCalendar` and `ObjectMap` drop their `api` branches, which only warned "not yet implemented".
  - **`ListView`** no longer stands down for a gantt view with an `api` block: it fetches the bound object like any other list.
  
  Unchanged: `ApiDataSource` stays a class for code that constructs it from an `ApiDataSourceConfig`, so the console's approvals inbox reads exactly as before.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- 611566b: `SchemaRenderer` no longer reads a page component's `visibility` key (objectui#12654). `@objectstack/spec` 18 retires it as a `retiredKey` tombstone naming `visibleWhen` (objectstack#23543 F4), so `visibleWhen` is the one conditional-visibility key the renderer reads for it.
  
  What a raw schema loses: a node handed straight to `SchemaRenderer`, without passing through the spec's parse, that carries only `visibility: 'PREDICATE'` is no longer hidden when the predicate is false; it now draws, and the `visibility` value is no longer stripped before the component's props. Write `visibleWhen` instead. The `SchemaRenderer` working-copy type no longer declares `visibility`.
  
  What is unaffected: metadata served by an ObjectStack runtime. A served page row already reaches the renderer with `visibleWhen`: the spec's parse folds the old key through the 18 pre-releases, and spec 18's stored-row rehydration rewrites a row stored with it. `BaseSchema`'s own deprecated `visibleOn` is a different key and is still read.
- 71243db: A navigation entry whose `visible` predicate cannot be evaluated is no longer drawn for everyone (objectui#12700).
  
  The shell's navigation surfaces (the sidebar, the app root's landing, the activity roster read from app navigation, the `nav:menu` block and the command palette's navigation list) answer a FAULTING `visible` predicate by withholding the entry, where they used to draw it. The case that made this matter is a `current_user.can("OBJECT", "read")` gate asked where no `/auth/me/permissions` payload is bound: the expression engine refuses it, and the shell used to read that refusal as "shown", so permission-gated navigation hid nothing there. Where the payload is bound, the gate answers from it as before: a member without the grant is not shown the entry and one with it is. The fault is still reported once per predicate, now with a consequence line saying the entry was withheld. A blank gate is still "no gate" and is drawn. This is UI gating, not a security boundary: the server enforces what a member may read.
  
  `@object-ui/react`: `PredicateGateKind` gains a `'withholding'` member, the consequence line for a visibility gate whose fault is answered by withholding the entry. `@object-ui/app-shell`'s published `evaluateVisibility` keeps its fail-open answer; the object-field gate uses it unchanged.
- 33ee9de: A `list-view` block drawn as a compact list in a narrow page region now shows a "View all" link under its rows (objectui#12703).
  
  - `@object-ui/react`: `RelatedRecordActionsValue` gains two optional members, `listHref(objectName, viewName?)` and `openList(objectName, viewName?)`. They address an object's list page, or one of its saved views, the way `recordHref` / `openRecord` address a record. A host that omits them is unchanged.
  - `@object-ui/app-shell`: a custom page supplies them. The routes are `/apps/APP/OBJECT/view/VIEW` for a block bound to a saved view (`dataSource.view`) and `/apps/APP/OBJECT` otherwise. The block's inline filter, columns and sort are never put in the URL.
  - `@object-ui/plugin-list`: the compact list draws the link only when the host answers a destination. It is a real anchor with in-app navigation on a plain click.
  - `@object-ui/i18n`: one new key, `list.viewAll`, in all ten packs.
- c7462e7: New export `isRecordPageOf(page, objectName)` (objectui#12715): true when `page` is a record page bound to `objectName` (`type: 'record'` and `object` names it). It is the one reading of "a record page of object O": `usePageAssignment`'s object-based lookup now filters its candidates with it, unchanged in behaviour, and the console's named record page route asks it before it renders a named page for a record.
  
  `usePageAssignment`'s `pageName` option is unchanged: it still returns the page with that name whatever its type or object, so a caller that renders a record on the page it gets back asks `isRecordPageOf` first.
- 8df2608: `RelatedRecordHandlers` gains an optional `onViewAll` (objectui#12741). A host returns it from `resolve` to open the child object's full list page, scoped to the parent on the relationship it was handed. `record:related_list` calls it from its "View all" link. A host that omits it draws no link, as for every other handler on this interface.
  
  Clause-② line, the same as the pull request's:
  Clause-②: yes
  One optional member is added to the exported `RelatedRecordHandlers` interface. Nothing else on the package entry changes.
- 5ff64ef: feat(react): `MetadataContextValue.readObjectScope`, the object definitions one app reads (objectui#12811)
  
  A new optional member of the metadata context. `readObjectScope({ packageId, names })` answers the
  objects of one package, read with `GET /api/v1/meta/object?package=ID`, plus each of `names` that the
  package does not hold, read by name. Each definition is shaped exactly as the same object in
  `objects`. The answer carries `objects`, `served` (the same definitions as the server served them,
  before views are merged, as `getItemsByType('object')` holds the whole list), `missing` (the names the
  server answered without a definition) and `settled` (the package list and every name have answered). With no `packageId` it is
  the whole registry, as `objects` is.
  
  `objects` is unchanged: it is the whole registry. A context value without the member (a hand-rolled
  one in a test, an older host) has nothing narrower to offer, and its readers read `objects`.
- a7ae252: A `${…}` hole inside an inline locale map is evaluated (objectui#12936). In a node's `properties` bag (or its legacy `props` alias, or a block member evaluated with `useConfigBagEvaluator`), each member of a map such as `title: { en: 'Published ${data.at}', 'zh-CN': '…${data.at}' }` is evaluated like a plain string on the same key: against `record`, `current_user` / `user`, `page`, the host's roots, and `data` on a node with an API binding. A block that picks the viewer's language with `pickLocalized` off its evaluated props, such as `hero`, now draws the bound value instead of the template text, with no change to the block. A member's result is always a string, so the map stays a map.
  
  A value counts as a locale map exactly when `@objectstack/spec`'s `InlineLocaleMapSchema` accepts it: every key a locale tag or `default`, every value a string. Any other object keeps the data-object rule and is handed over as authored, with nothing inside it evaluated. A map without a hole arrives as the same object. In development builds, a member whose expression throws keeps its source text and is now reported by the unevaluated-expression diagnostic by its locale (`properties.title.zh-CN`), as a plain string with the same hole is.
  
  **Clause-②: yes (widening)** — the renderer honours a shape it used to hand over raw: a hole inside an inline locale map's member. No export is added or removed and no type changes; the set of authored values `SchemaRenderer` evaluates widens by that one shape.
- 024b7b6: A page route reads the objects its page binds, not the whole object registry (objectui#12980, part 1).
  
  Opening a page (`/apps/APP/page/NAME`) used to load every object definition (`GET /api/v1/meta/object`, 751 KB on the control plane), because the route, the page view and three page blocks read `useMetadata().objects`. Now:
  
  - **`readObjectScope({ names })` with no `packageId` is a names-only scope** (`@object-ui/react`, `MetadataContextValue.readObjectScope`). Each name is read by name, with no package list. Only a scope with neither `packageId` nor `names` is the whole registry. This widens what the published contract accepts, which is why `@object-ui/react` is a minor bump.
  - **A page route reads the objects its page definition binds**: the page's `object`, its interface source, and every `objectName` and `dataSource.object` on its blocks. They are read by name, beside the app's package list when the app names a package, or through the names-only scope when it does not. A page that binds no object, such as one whose data sources are all `api`, reads none. The chrome around the page gets the same scope.
  - **An object a block asks about outside that set is read by name when it asks.** A link to it is drawn once the object arrives, and opening it navigates once the object is known.
  - **The page blocks:** the interface list page reads its source object by name, `nav:menu`'s capability gate reads the objects its app's entries require by name, and `global:search` reads the registry only once the user types. A record overlay still reads the whole registry, because a record's related lists come from every object that points at it.
  
  No export, prop or type member is added.
- 9e7e1a5: `@object-ui/react` now exports `buildNodeEvaluationScope(predicateScope, boundRecord, pageVariables)`, the one builder of the scope a page node's `visibleWhen` and other values are evaluated against (objectui#12992). It returns four roots: the ambient predicate scope, `current_user` aliased to `user`, the bound row as `record` (only when there is one), and page variables as `page`. `SchemaRenderer` and `evaluateConfigBagInScope` call it as before. `page:tabs` in `@object-ui/components` now calls it for its derived-badge gates and its item-level `visibleWhen` instead of spelling the scope again, so a root added to the builder reaches the tab strip too. No root changes for any caller.

### Patch Changes

- 92f4e2b: An action's translated copy is now read from ONE bundle node, chosen by the object the action belongs to, the same way `@objectstack/spec` 17.7.0 reads it on the server (objectui#11439). That object is the action's declared `objectName`, else the object whose `actions` embed it.
  
  - An action that belongs to an object reads `objects.OBJECT._actions.ACTION.*` only. Copy for it filed under `globalActions.ACTION` no longer applies: its label, confirm text, success message, outcome messages, description, parameters and result dialog show the authored text instead, as they already did everywhere the server translates. Move that copy to `objects.OBJECT._actions.ACTION`, which is where `os validate` asks for it.
  - An action with no object (no `objectName`, not embedded in an object) still reads `globalActions.ACTION.*`.
  - `useActionTextLocalizer` keys on the action's declared `objectName` before the object its caller passes, so an action declared on one object reads that object's copy wherever it is drawn.
  
  `useObjectLabel()` and `useActionTextLocalizer()` keep their signatures; no input, export or translation key is added.
- 92f979d: `usePageAssignment` opens an object's default record page: among the record pages served for the object, the one declared `isDefault: true` is returned, and declaration order decides only when none is (objectui#12195).
  
  The hook used to return the first matching record page in served order and never read `PageSchema.isDefault`, so the flag on a shipped page (the platform's `sys_user_detail`, `sys_organization_detail` and `sys_approval_request_detail`, and the showcase's record pages) did nothing. `@objectstack/spec` 18.0.0-next.1 states the rule this follows (maintainer ruling A on objectstack#23015): at most one default record page may exist for an object in a deployment, and a second is refused at `os validate`, at package registration and at metadata save, naming both pages. So the hook adds no tie-break of its own. It reads "the default record page of an object" through the spec's `defaultRecordPageObject`, the same reading those refusals use.
  
  **Who sees a different page.** An app or environment that authors its own record page for an object without `isDefault: true`, for an object that also has a served default record page, and whose page came first in the served list. That page used to open; the default opens now. Ruling A keeps two ways to replace a platform record page: an ADR-0005 overlay saved under that page's own name, and host composition (composing the stack without the platform's page). Shipping a second default is not one: the platform refuses it. With no default for an object, nothing changes: the first matching page still opens, and an explicit `pageName` still wins over the default.
  
  No type, option or export changes (`Clause-②: no`).
- 97e7d4e: Lookup links on a record page and on a custom page now carry the console's base path, so the same link works from a left click, a new tab, a middle-click and a copied link (objectui#12233).
  
  On a console mounted under a router basename, such as `/_console`, a lookup value rendered as an anchor whose href was the bare route `/apps/APP/OBJECT/record/ID`. On a record page this hit, for example, a lead's converted account or contact and its owner. The same held for a lookup, or a grid's link column, on a custom page. A plain left click worked, because the anchor hands it to the console router and the router adds the basename. Opening the link in a new tab, middle-clicking it or pasting a copied link sent the browser to the bare route on the server, which answered `ENDPOINT_NOT_FOUND`.
  
  - `@object-ui/app-shell`: both record-link builders, the record page's and the custom page's, now give lookups an href that includes the router's basename. They read the basename from the router, so a console mounted at the root keeps the bare href. A left click still navigates inside the app, to the same record the href names.
  - `@object-ui/react`: the documentation of `RelatedRecordActionsValue.recordHref` now says the value is a document href that carries the host router's basename, while `openRecord` navigates by the router path. The type is unchanged.
  
  Nothing is added to or removed from any package entry.
- d75f212: Published text no longer teaches the retired view-level `provider: 'api'` data source (objectui#12364). A view binds `provider: 'object'` or `provider: 'value'`; a metadata-declared API call is the page element's `dataSource` binding. Text only: no schema accepts or refuses anything new, and no renderer behaves differently.
  
  - **`@object-ui/types`:** the `object-tree` `data` description drops the `api` provider from the providers it names.
  - **`@object-ui/plugin-grid` / `@object-ui/plugin-map`:** the `data` input descriptions drop the `api` provider.
  - **`@object-ui/plugin-calendar` / `@object-ui/plugin-gantt` / `@object-ui/plugin-map`:** the error thrown when no `DataSource` is available now reads `DataSource required for the object provider` (was `DataSource required for object/api providers`). It fires in exactly the same conditions as before.
  - **`@object-ui/react` / `@object-ui/auth`:** the README and docblocks describe `SchemaRendererProvider`'s `apiFetch` as what it is now: the host's authenticated fetch the renderers use for their own reads of the host's API (chart metadata, dataset dimension labels, record-permission probes). It is not a channel for a view's data source.
  - **`@object-ui/app-shell`:** comment wording only in `ConsoleShell`, `useConsoleActionRuntime` and `ObjectView` (these comments ship in the built JS): no behaviour change.
  - **`@object-ui/core`:** docblock wording only on `normalizeListViewSchema` and `resolveRecordSourceObjectName` (these ship in `dist/*.d.ts` and the built JS): no behaviour change.
- 3eb3ec1: The console's list toolbar no longer has a write into the shared view, and the data-source method that write used is retired (objectui#12504).
  
  **BREAKING:** `DataSource.updateViewConfig` is removed from `@object-ui/types`, and `ObjectStackAdapter.updateViewConfig` is removed from `@object-ui/data-objectstack`. The capability gate that only that method read goes with it: `ObjectStackAdapter.setSystemCapabilities`, the `systemCapabilities` option of the adapter constructor and of `createObjectStackAdapter`, `VIEW_CONFIG_CAPABILITY`, `ViewConfigPermissionDeniedError` and `isViewConfigPermissionDeniedError`. A class that implements `DataSource` and keeps an `updateViewConfig` method still compiles, but nothing calls the method any more; an object literal annotated as `DataSource` that carries it is refused as an unknown property. Code that calls `updateViewConfig` through a `DataSource` or an `ObjectStackAdapter`, or imports one of the gate names, no longer compiles. To change a view for everyone, save the view: `createView` / `updateView` on the data source, or the console's view editor, which writes through the runtime metadata seam.
  
  Since objectui#12418 and objectui#12474, the toolbar's sort, column layout, density and Hide Fields are each user's own list state, so the toolbar write had no caller. The view editor's explicit save is now the one write path to the shared view, and it is unchanged.
  
  Personalization rows that earlier consoles wrote into `/meta/view` stay readable: the overlay marker, `narrowPersonalizationOverlay` and `listViews()` exclusion still apply to them. Nothing new writes such a row.
  
  `@object-ui/i18n` drops `console.objectView.viewConfigPermissionDenied` from all ten packs. It was the toast the retired write raised when the gate refused it. The other packages change only in comments and tests that named the retired path.
- 655e897: `useActionTextLocalizer` resolves every `I18nLabel` copy an action declares (objectui#12757). It used to collapse a per-locale map only for `label` and `successMessage`, and only when the action had a `name`. A `confirmText` or `errorMessage` map, or any map on a nameless action, such as an inline `element:button` action, reached the action runner as an object, so the confirm prompt received an object and the toasts fell back to the runner's generic copy.
  
  The localizer now collapses `label`, `confirmText`, `successMessage` and `errorMessage` to the active language on every action, named or not. A translation-bundle entry for a named action still wins over the collapsed copy. `errorMessage` has no bundle key, so the collapse is all it gets. An action whose copy is already plain text comes back unchanged.
  
  Clause-②: no. The hook's signature and the package entry are unchanged; no export, prop or i18n key is added or removed.
- 9753811: Page element blocks draw their loading, empty and error defaults in the page's language (objectui#12889).
  
  - **`element:repeater`.** While its query runs it shows the `common.loading` text ("Loading…", "加载中…") instead of an English literal. With no rows it shows `common.noData` ("No data"; it read "No records" before), and when the query fails with no message it shows `list.loadErrorTitle` ("Couldn’t load records"). An authored `emptyText` still wins, and a failure's own message is still shown as thrown.
  - **`element:number`.** While its aggregate runs it draws a skeleton bar the height of the number's line instead of a bare `…` glyph. The bar is a status region named by `common.loading`.
  - **The saved-view placeholder** (`ElementDataSourceLoadingPanel`, drawn by every block bound through a named `view` while it resolves) reads `common.loading` instead of an English "Loading view…".
  
  No language-pack key, prop or export is added: all four keys already exist in every pack.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
- 988aa9f: Charts and dataset widgets read their object's metadata through the data source, so the widgets of one dashboard ask for one object's metadata once (objectui#13039).
  
  The chart's category colours and dimension labels come from the bound object's field options. It read them with its own request to `/api/v1/meta/object/NAME`, outside the data source's metadata cache, so every chart over one object sent one more request for the same document. The chart now reads it through the data source's `getObjectSchema` when one is in scope: the read that its own group-by labels, the metric tile and the data table already use, and that the ObjectStack adapter joins while it is in flight. With no data source, or one that cannot answer `getObjectSchema`, the chart reads the document directly as before.
  
  The dataset label hook in `@object-ui/react` (`useDatasetDimensionMeta`, behind `useDatasetDimensionLabels`) made the same per-widget request, one for every non-metric dataset widget on a dashboard and for the dataset report block. It now reads through the `SchemaRendererProvider`'s data source in the same way when that source answers `getObjectSchema`, and reads the document directly otherwise.
  
  Colours, labels and dotted dimension paths resolve as they did. Nothing is added to the package entry.
- d11174a: A list's `addRecord` Add button opens the create form on a console page and on the console's object list (objectui#13089).
  
  - **Page `list-view` nodes.** The console's page host now serves the record-form create to a list that names no `relationshipField` and has no parent: a page `list-view` node. So `addRecord: { enabled: true }` draws its Add button, and a click opens the create form for the listed object. A related list whose parent did not resolve is still served nothing, so it draws no "+ New" that would open a child form linked to no parent. No Edit, Delete or row click is served to a list without a parent.
  - **`list-view.addRecord` is a published input** of the `list-view` and `list` registrations. `enabled` and `position` are read; `mode` and `formView` are not.
  - **The console's object list.** A saved view that declares `addRecord.enabled` used to draw an Add button whose click did nothing, also for a viewer who may not create. The button now opens the header New's create, and is withheld wherever that New is not offered or is greyed.
  - **`editMode: 'page'`.** A create linked to no parent, from the record-actions bridge, now opens an `editMode: 'page'` object's full-page create route, as the object list does, instead of the overlay.
  - **`ResolveRelatedRecordActionsInput`** (`@object-ui/react`) documents what an input without `relationshipField` asks for: an object-scoped list's handlers. No type or member changes.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [d92b2a1]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [e8c0b96]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [7b17705]
- Updated dependencies [fc3c2cc]
- Updated dependencies [f9f4a62]
- Updated dependencies [848ba0e]
- Updated dependencies [57d82cb]
- Updated dependencies [de96f3d]
- Updated dependencies [9ca3cac]
- Updated dependencies [c910630]
- Updated dependencies [ce464d9]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [da35453]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [4590363]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [b9814b3]
- Updated dependencies [4a9fe31]
- Updated dependencies [6d8bf0c]
- Updated dependencies [5dff027]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [7ebff39]
- Updated dependencies [054fd84]
- Updated dependencies [5275d1f]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [f1781be]
- Updated dependencies [fbad078]
- Updated dependencies [45d5853]
- Updated dependencies [2312bd9]
- Updated dependencies [6d5eb34]
- Updated dependencies [c5406c2]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2571a3e]
- Updated dependencies [2a48bd4]
- Updated dependencies [8a55f0c]
- Updated dependencies [c7b30bd]
- Updated dependencies [20c6d35]
- Updated dependencies [417e245]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [3c0f806]
- Updated dependencies [1071393]
- Updated dependencies [5f75cfa]
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [43e1505]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [54159d3]
- Updated dependencies [d48071e]
- Updated dependencies [fa778e6]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [7578323]
- Updated dependencies [38bb373]
- Updated dependencies [923504f]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [51c661e]
- Updated dependencies [7af0ab3]
- Updated dependencies [9f282ef]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [cea429b]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [40cb13b]
- Updated dependencies [8106db1]
- Updated dependencies [068a540]
- Updated dependencies [ca45c6d]
- Updated dependencies [093d55b]
- Updated dependencies [b64fda3]
- Updated dependencies [a8051d6]
- Updated dependencies [866763b]
- Updated dependencies [524136e]
- Updated dependencies [2b06a91]
- Updated dependencies [6f3299f]
- Updated dependencies [d12bc5f]
- Updated dependencies [065a1cf]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [dbc8c11]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [919d5cd]
- Updated dependencies [431cece]
- Updated dependencies [cfbca7f]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [a8e5b73]
- Updated dependencies [d9d9d98]
- Updated dependencies [21f9577]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [646caea]
- Updated dependencies [8ed7e5a]
- Updated dependencies [6c4d00d]
- Updated dependencies [db8ce2f]
- Updated dependencies [f0e760a]
- Updated dependencies [a5bb7ac]
- Updated dependencies [f78efdd]
- Updated dependencies [8a8bcf3]
- Updated dependencies [f74638c]
- Updated dependencies [8614705]
- Updated dependencies [619e3f7]
- Updated dependencies [ca7a4c3]
- Updated dependencies [f62b6ff]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [36e2f7b]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [3bcf314]
- Updated dependencies [c999d4c]
- Updated dependencies [260ef71]
- Updated dependencies [8d80845]
- Updated dependencies [35ef750]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [bb6c38c]
- Updated dependencies [26323c4]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [cb80001]
- Updated dependencies [2493e85]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [65fe4c2]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [cd4623d]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [cbac9d7]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
- Updated dependencies [58798ec]
- Updated dependencies [8803ca5]
- Updated dependencies [e70c21d]
- Updated dependencies [06be396]
- Updated dependencies [7c05f21]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [3c3115e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [1b2d016]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [f962cdc]
- Updated dependencies [b403bb3]
- Updated dependencies [8a25fee]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/i18n@18.0.0
  - @object-ui/data-objectstack@18.0.0

## 17.7.0

### Minor Changes

- 97abedc: A `dataSource` binding's own `limit` that the contract refuses is now treated as **not
  authored**: the row cap falls through to the named saved view's usable cap, and only when
  that is absent too to the consumer's own default (objectui#10016).
  
  **Behaviour change.** `composeElementDataSource` resolved the cap as
  `config.limit ?? savedViewLimit(view)`. objectui#9928 put a positivity check on the view's
  operand only, so a binding `limit` of `0`, `-10`, `25.5` or a non-number went through
  unchecked:
  
  - through `ViewDataProvider.resolveElementDataSource` it reached `DataFetcher.fetchRecords`
    verbatim, and nothing said so;
  - through `ElementDataSourceGate` it was written over everything, a usable component cap
    included, and the consuming block then dropped it and drew its own default, so the read
    went wider than either the view or the component asked for.
  
  Both operands now pass the same check, and a refused cap from either is not authored. The
  chain is: a usable binding cap, else a usable view cap, else none. This is the rule
  objectui#10009 set one layer up (a value the contract refuses is not authored, so the other
  source wins), applied to the two operands of one resolver. On the renderer path the view's
  cap that takes the binding's place is a baseline like any other view-sourced value, so a
  usable component cap still wins over it. A usable binding `limit` still beats both, exactly
  as before.
  
  **Diagnostics.** `elementDataSourceRefusedLimitMessage` takes two optional trailing
  parameters, the binding and the operand (`'view'`, the default, or `'binding'`). The binding
  operand has its own sentence, naming the binding, so a binding refusal and a view refusal
  are told apart when both fire. `ViewDataProvider` and `ElementDataSourceGate` report it once
  per declaration on the existing `console.warn` channel; the gate reports it only for a block
  that reads a row cap. Called with three arguments the builder answers exactly as before.
  
  **Fixed with it.** `ViewDataProvider` reported a saved view's refused cap even when the
  binding's own usable `limit` was the cap actually used, and that warning's claim that the
  fetch falls back to a default was false. The view's refusal is now reported only when the
  binding's `limit` is absent or refused. The builder applies that condition itself, so both
  callers share one copy of it.
- 2b5f509: fix(react): a data object in a node's `properties` / `props` bag reaches the renderer whole, even when it carries a `source` field
  
  `SchemaRenderer` evaluates each value of a node's config bag (`properties`, and its legacy alias `props`) one by one, and handed every value to `ExpressionEvaluator.evaluate`. That call unwraps ANY object with a string `source` to that bare string before it does anything else. So an authored data object that merely had a field called `source` was silently replaced by that one string: an `action:button` with `properties.bodyExtra: { source: 'web', campaign: 'spring' }` sent `"web"` to the action runner instead of the object, with no error and no warning. The same object written at node level, which no loop visits, always arrived intact.
  
  This was never one key's problem. Every object-valued input on those two bags took the same path, including values keyed by field name: form `defaultValues` / `initialValues`, a declarative `patch`, filter `values` and a detail view's `data`, where a field named `source` is ordinary.
  
  On a key outside the predicate chain, an object now reaches `evaluate` only when it is an Expression envelope in `@objectstack/spec`'s sense, meaning it carries a string `dialect` (the spec's `ExpressionSchema` requires one). Every other object is handed to the renderer exactly as authored.
  
  **Behaviour change, stated plainly.** The only value whose meaning changes is an object on a non-predicate config-bag key that has a string `source` and no string `dialect`. It used to collapse to its evaluated `source`; it now arrives as the object. Everything else evaluates as before:
  
  - strings are still interpolated;
  - a `{ dialect: 'template', source: '${…}' }` envelope still resolves to its value;
  - the predicate keys (`visible`, `visibleWhen`, `visibleOn`, `visibility`, `hidden`, `hiddenOn`, `disabled`, `disabledOn`, `enabled`) are unchanged: a CEL envelope is still preserved for the canonical engine (objectui#9100 / #9107), and a dialect-less `{ source }` on them is still evaluated, the form `ExpressionWire` declares for `visible` / `hidden` / `disabled`;
  - `params` is still walked leaf by leaf (objectui#7867).
  
  Declared as a minor (Clause-②): nothing in the published API is added or removed, but what an authored value evaluates to changes for one shape. `ExpressionEvaluator.evaluate`'s signature admits a dialect-less `{ source }`, and these loops handed it every value except a `params` bag and a CEL envelope on a predicate key. So `{ source: '${…}' }` on a config-bag key outside the predicate chain and `params` now arrives as the object, uninterpolated, and the unevaluated-expression diagnostic does not report the `${…}` inside it. To keep such a value evaluated, write the bare string `'${…}'` or `{ dialect: 'template', source: '${…}' }`; both still interpolate on that path. The spec's envelope always carries `dialect`, and `@object-ui/core`'s `isRuntimeDefault` already reads a dialect-less `{ source }` as a literal value.
- 6cf5999: fix(components): an action container's members evaluate `properties.params` the way a top-level `action:button` does
  
  A member of `action:bar`, `action:group` or `action:menu` never passes through
  `SchemaRenderer`, so the evaluation that resolves `"recordId": "${record.id}"`
  in a node's `properties.params` did not run for it. On a record page an
  `action:bar` member drawn inline handed its `navigate_edit` handler the raw
  `${record.id}` text, and a member that the bar placed in its overflow menu, or
  an `action:group` / `action:menu` item, did not forward its `properties.params`
  at all.
  
  Each container now evaluates its members' `properties` with the evaluator and
  scope `SchemaRenderer` uses: `action:bar` where it composes an inline member,
  and `action:group` / `action:menu` when they run an item. A container member's
  static values therefore reach the handler as a top-level `action:button`'s do,
  with one difference: the development-build unevaluated-expression diagnostic
  runs in the `SchemaRenderer` memo, so it does not report an unresolvable
  template on a container member. An item that carries an `ActionParam[]` input
  list forwards both, as `action:button` does. A node-level `params` object is
  still not read as values (objectui#10289). The one exception is unchanged from
  objectui#10462: an `action:group` / `action:menu` item of `type: 'api'` still
  forwards it as the request payload (objectstack#5777 window), unless the item
  also carries a `properties.params` bag, which now takes precedence.
  
  `@object-ui/react` exports `useConfigBagEvaluator()` for this. It returns a
  function that applies the `SchemaRenderer` memo's `properties` evaluation (the
  same per-key rule and the same `record` / `current_user` / `page` scope) to a
  config bag rendered without `SchemaRenderer`. It is not a second template
  engine. Its plain half, `evaluateConfigBagInScope()`, is exported beside
  `SchemaRenderer`. Both are built from the module-scope scope builder and
  per-key rule that the memo itself calls.
  
  Declared as a minor (Clause-②, widening): `@object-ui/react` gains two public
  exports, `useConfigBagEvaluator` and `evaluateConfigBagInScope`. Nothing is
  removed or renamed.
- f9c06ef: Every data node that sends its own authored `filter` into a query now resolves the spec's context tokens first (objectui#10666). With `filter: [['owner', '=', '{current_user_id}']]` these nodes used to send the literal token; they now send the signed-in user's id, and `{current_org_id}` resolves to the active organization:
  
  - `object-calendar`, `object-map` and `object-tree`, on both the object query and the inline (`provider: 'value'`) query;
  - `object-gantt`, `object-kanban` and `object-timeline`;
  - `record:related_list` and `record:line_items`, where the node's own filter is combined with the parent-record condition;
  - the `element:repeater`, `element:number` (both the `aggregate` filter and the `find` fallback) and `element:record_picker` page elements.
  
  `list-view`, `object-grid` and `object-gallery` already did this, and are unchanged.
  
  **New in `@object-ui/react`: `useResolvedFilter(filter, scope)`.** Pass it a node's authored filter and `useFilterScope()`. It resolves the filter through `@object-ui/core`'s shared `resolveFilterPlaceholders` and holds the result: re-rendering with an equal filter (even one rebuilt inline on every render) hands back the same value, so a fetch effect keyed on it does not run again, while a structurally different filter or a change of signed-in user or organization resolves again. A filter with no token to resolve is handed back as the value you passed in. The hold is the one `list-view` and `object-gallery` used privately; `plugin-list` now imports it from here, and no second copy remains in that package.
  
  What changes for an app:
  
  - A filter with no placeholders reaches the query as before, unchanged.
  - Nodes that re-queried whenever the host rebuilt an equal filter inline (`object-calendar`, `object-gantt`, `object-kanban`, `object-map`, `object-tree`) no longer issue those redundant queries.
  - Date macros such as `{today}` in these nodes' own filters are now resolved in the browser's local time, as they already are for `list-view`, `object-grid` and `object-view`. Before, they reached the server as literals, and the server resolved them in the tenant's time zone.
  
  `@object-ui/types`: the `filter` docblocks on `ObjectMapSchema`, `ObjectTreeSchema`, `ObjectGanttSchema`, `ObjectCalendarSchema`, `ObjectKanbanSchema`, `ObjectChartSchema` and `ObjectGallerySchema` (and the matching zod descriptions) no longer say the filter is forwarded verbatim; they say its context tokens are resolved first. No type changes.
- a4b017e: `element:text`, `element:button`, `element:image` and `element:number` now render the accessible name an author declares in their `aria` prop (objectui#11051).
  
  **What an author sees change.** These four elements declare the spec's `AriaPropsSchema` as their `aria` prop. The renderer used to put `aria-` in front of each key as written, so `aria: { ariaLabel: 'Order total' }` reached the DOM as `aria-arialabel="Order total"`. No assistive technology reads that attribute, so the element had no accessible name. A locale map (`{ en: 'Order total', 'zh-CN': '订单合计' }`) was written as `[object Object]`. Now:
  
  - `ariaLabel` renders `aria-label`. A locale map gives the entry for the display locale (`useDisplayLocale()`), resolved by the spec's own `resolveI18nLabel`.
  - `ariaDescribedBy` renders `aria-describedby` (it rendered `aria-ariadescribedby`).
  - `role` renders `role`, as before.
  
  **New export: `resolveInlineAriaProps(aria, locale)` from `@object-ui/react`.** A pure function, not a hook: it maps the spec's nested `aria` bag to those three attributes, and returns only the ones that have a value. It is exported so the renderers in `@object-ui/components` share one mapping. `SchemaRenderer`'s own reader for the FLAT node keys (`ariaLabel` in the keyed `{ key, defaultValue }` form) is unchanged: objectui#4580 Q2-B keeps the two vocabularies apart, and each resolver returns nothing useful for the other's shape.
  
  **What is no longer read.** The old helper also passed any raw `aria-*` key straight through, and turned any other key into `aria-KEY`. So an `aria: { label: 'x' }` rendered `aria-label="x"` by accident. The spec refuses both shapes when it parses the document (`unrecognized_keys`), and these four elements now ignore them. When this change was made, a `git grep` found no example app, doc or skill in this repository or in the ObjectStack framework that puts an `aria` bag on these four elements, so no shipped document depended on those shapes. If you wrote one, use `aria: { ariaLabel: 'x' }`.
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
- 8bab157: fix: an action gated on `current_user.can(object, verb)` stays hidden until the permissions payload has loaded on every action `visible` surface, a `page:header` action gated through `disabled` stays disabled, and `record:quick_actions` can answer `current_user` at all
  
  An action whose `visible` asks `current_user.can(...)` has no answer until the signed-in
  user's permissions have loaded. On `action:group` (both display modes, and the group's own
  `visible`), `action:icon` and a related list's toolbar, that unanswerable gate used to
  SHOW the action, so a button meant for permission holders flashed up for everyone while
  the page loaded, and stayed up where the permissions never load (the `/forms/:name` route,
  a standalone embed). These renderers now treat a `visible` predicate that cannot be
  evaluated the way `action:button` and `action:menu` already did: the action is hidden and
  the console names it once. This is the rule for the key, not a special case for `can`: a
  `visible` that faults for any other reason (a misspelled root such as `nope.x == 1`) is
  hidden too, where it used to be shown.
  
  On `page:header`, a `disabled` predicate that cannot be evaluated now renders the button
  DISABLED instead of enabled, so `disabled: "!current_user.can('account', 'delete')"`
  shows a greyed-out button until the answer arrives. This also applies to a `disabled`
  predicate that faults for another reason. A header action's `visible` and `hidden`
  predicates keep their fail directions.
  
  `record:quick_actions` filters its actions against the action runner's context, which
  held the host's `user` but never `current_user`, so `current_user.can(...)` and every
  other `current_user.*` gate there hid the action for everyone, the users who hold the
  permission included. `useActionEngine` (`@object-ui/react`) now binds the signed-in user
  from the surrounding `ExpressionProvider` as `current_user`, so a quick action is shown
  to users who hold the permission and hidden from those who don't, and while the
  permissions are loading.
- 18d1a0a: fix: a row-menu action gated through `disabled` stays disabled until the permissions payload has loaded, in a grid and in a related list's table, and an `<ActionProvider>` answers `current_user` in the runner's own gates
  
  A custom row action whose `disabled` asks `current_user.can(...)` has no answer until the
  signed-in user's permissions have loaded. In the row menu of a grid (`RowActionMenu`) and
  of a data table (the related list's rows), that unanswerable gate used to leave the item
  ENABLED, so `disabled: "!current_user.can('account', 'delete')"` offered the action to
  everyone while the page loaded, and kept offering it where the permissions never load (the
  `/forms/:name` route, a standalone embed). Both menus now render a `disabled` predicate that
  cannot be evaluated as DISABLED, the way `page:header` already does, and the console names
  it once. This is the rule for the key, not a special case for `can`: a `disabled` that
  faults for any other reason (a misspelled root such as `nope.x == 1`) is disabled too,
  where it used to be enabled. An absent, empty or blank `disabled` is still not disabled.
  The built-in Edit and Delete keep their fail-soft `disabledWhen`.
  
  `<ActionProvider>` (`@object-ui/react`) now binds the signed-in user from the surrounding
  `ExpressionProvider` as `current_user` on its runner. The runner checks an action's
  `disabled` again when the action runs, and that check used to fault on `current_user` unless
  the page also mounted `record:quick_actions`, `record:alert` or a dashboard, so a user who
  held the permission clicked an enabled header action and was told "Action is disabled".
  The check now answers `current_user.can(...)` under any provider mounted inside the
  predicate scope. On the runner's gates `user.can(...)`, `ctx.user.can(...)` and
  `os.user.can(...)` still fault, because there `user` is the host's own user object; write
  `current_user.can(...)`.
- 2124d04: `useNavigationOverlay` hands an authored `page` click with no `onNavigate` to the record navigator the host publishes (objectui#11293).
  
  `page` is the spec's default navigation `mode`, so `navigation: { mode: 'page' }` and every block written without `mode` (for example `{ size: 'lg' }`) resolve to it. The hook's `page` branch called `onNavigate` and nothing else, so a block a host rendered without wiring one — a standalone `object-kanban`, `object-calendar` or `object-grid` placed on a page — opened nothing on click. With no `onNavigate` supplied, the branch now calls `openRecord(objectName, recordId)` from `RelatedRecordActionsContext`, the seam the grid's link column and the lookup cells already read; the hook still builds no record URL for `page`.
  
  What does not change: an `onRowClick` still takes the click first, a supplied `onNavigate` still wins (the grid's explicit wiring and the console's list views behave as before), an absent `navigation` stays the host's call, and modifier clicks and `new_window` are untouched. Under a host that publishes no record navigator the click still opens nothing, because there is no record page to open.
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
- 304f611: The spec's page blocks, the `element:text_input` / `element:record_picker`
  rows and a stored page document under its page kind have a TypeScript
  authoring type, and `SchemaRenderer`'s `schema` prop accepts them
  (objectui#11364).
  
  `@object-ui/types` exports, each derived by reference and none restated:
  
  - `PublicBlockNode`: one member per arm of the zod face's
    `PublicBlockComponentSchema` (`element:text`, `page:tabs`, `action:button`
    and the rest), each the arm's own input. Its `properties` bag is the block's
    `ComponentPropsMap` row in `@objectstack/spec`. `PublicBlockNodeOf<'…'>`
    picks one member.
  - `ElementTextInputNode` and `ElementRecordPickerNode`: the spec rows of the
    two blocks the zod face does not arm yet, each built the way an arm is
    built: the zod `BaseSchema` shape extended with the `type` literal, the node
    envelope (`responsiveStyles`, the spec's `ResponsiveStylesSchema`),
    `properties` as the row, and the `body` / `children` refusals every arm
    carries. The record picker also declares the node-level `dataSource` its
    renderer reads.
  - `PageDocumentNode`: the spec's `PageSchema` input with `type` (the page
    kind) required, the shape `PageView` hands to `SchemaRenderer`.
  - `AuthoringNode`: the union of all of them.
  
  `@object-ui/react`'s `SchemaRendererProps.schema` is now
  `BaseSchema | AuthoringNode | string | null | undefined`, and
  `toRenderableSchema`, which returns `SchemaRendererProps['schema']` by
  reference, widens its return type with it. Every value the old union accepted
  is still accepted. Reading is a different matter: on a union, a key that one
  closed member does not declare is TS2339, whatever `BaseSchema`'s index
  signature allows. No caller in this repository reads a key off the prop's type
  or off the bridge's return (the `Type Check` job re-derives that); code that
  does needs to narrow first. Once objectui#8347 removes the index signature,
  a key misspelled inside one of these nodes' bags is refused, and the spec's
  spelling compiles. None of these types carries an index signature, and the
  prop gains none.
  
  ⚠️ **Dated note, 2026-10-02 — the prop takes the declared-node union — objectui#11466.** At this change `SchemaRendererProps.schema` was `BaseSchema | AuthoringNode | string | null | undefined`, and every value the old union accepted was still accepted; now, later in this same release, it is `DeclaredNode | string | null | undefined`. `DeclaredNode` (`@object-ui/types`) is the union, keyed by `type`, of the component schemas `AnySchema` declares (without its `BaseSchema` arm and without the app-level document `AppComponentSchema`), `AuthoringNode`, and the types an application declares in `CustomNodeRegistry`, so a value typed `BaseSchema` or a `type` nothing declares is refused. `PageDocumentNode` admits every page kind but the interface-mode `list`. The rest of this entry is kept as the reading of this change.
- 83e3f83: A node slot and `SchemaRenderer`'s `schema` prop take the union of the declared node types, `DeclaredNode` (objectui#11466).
  
  **BREAKING (TypeScript authoring face only), shipped as `minor` per this repository's version policy.** `SchemaNode` was `BaseSchema | string | number | boolean | null | undefined`, and the prop was `BaseSchema | AuthoringNode | string | null | undefined`. Both object members are now `DeclaredNode`, a new export of `@object-ui/types`: the discriminated union, keyed by the literal `type`, of
  
  - every component schema `AnySchema` declares, without its `BaseSchema` arm (whose `type` is `string`) and without `AppComponentSchema` (the app-level document, which `AppSchemaRenderer` reads structurally and `ComponentRegistry` never dispatches: as a node, `type: 'app'` is the stored page of that kind);
  - every spec-declared `AuthoringNode`;
  - every type an application declares in the new `CustomNodeRegistry` interface.
  
  There is no `type: string` arm and no index signature. What moves:
  
  - A node whose `type` no declaration names is refused, nested or at the prop: `{ type: 'card', children: [{ type: 'txt' }] }` no longer compiles. So is a value typed `BaseSchema`, which names no declared type.
  - An inline child is checked against its own type's arm wherever it is nested, so a misspelled key on a node type without an index signature (the `AuthoringNode`s, a closed `CustomNodeRegistry` entry) is refused at the slot. Node types that extend `BaseSchema` keep its index signature until objectui#8347 removes it.
  - A node's REQUIRED keys are required (a stored `home` page document needs its `label`, a `data-table` its `columns`), because no `BaseSchema` arm accepts the same literal structurally any more.
  - `app` and `list` are one arm each: `PageDocumentNode` admits every page kind but the interface-mode `list`, which `PageView` renders through `InterfaceListPage` and never hands to `SchemaRenderer`. Narrowing a `DeclaredNode` on `type === 'app'` gives `PageDocumentNode`, and on `'list'` gives `ListSchema`. `SchemaByType` reads `AnySchema` and does not move.
  - `@object-ui/core`'s schema builder takes `DeclaredNode` where it took `BaseSchema`: `.child()` / `.children()` on the grid and flex builders and the card builder's `.content()`.
  - `toRenderableSchema` (`@object-ui/react`) follows `SchemaNode` and the prop by reference.
  
  What does NOT move: every zod face (`AnyComponentSchema`, `SchemaNodeSchema`, the strict authoring face) and every runtime path. `zod/base.zod.ts` writes the node slot's zod type out through type aliases so the declared-node union can name the zod-derived `AuthoringNode`s without a circular reference; the schema objects are unchanged. `FlexBlockNode` is now an interface for the same reason, with the same members. `@object-ui/components`' `kind: 'html'` page crosses its runtime-parsed tree into `DeclaredNode` at one documented boundary, after `validateTree` reports no error; it renders exactly what it rendered.
  
  **Migration.** Annotate a node with its declared type, or with `DeclaredNode` where any node goes. Declare each type you register with `ComponentRegistry` in `CustomNodeRegistry`:
  
  ```ts
  import type { BaseSchema } from '@object-ui/types';
  
  interface MyWidgetSchema extends BaseSchema {
    type: 'my-widget';
    customProp?: string;
  }
  
  declare module '@object-ui/types' {
    interface CustomNodeRegistry {
      'my-widget': MyWidgetSchema;
    }
  }
  ```
  
  An entry joins the union under its KEY (the arm is the entry intersected with `{ type: KEY }`), so it never adds a `type: string` arm. A value built at runtime whose `type` the compiler cannot know is narrowed to a declared type, or crosses at one validated boundary, as the html-tier page does.
- 1b1d772: Expression-bindable text keys: `statistic.value`, `card.title`, `button.label`
  and their siblings now evaluate `${...}` on the node (objectui#4795 Direction 1,
  maintainer ruling 2026-08-25).
  
  **What changes for you.** Four text keys — `title`, `label`, `value`,
  `description` — can now carry an expression written directly on the component
  node, on the component types that declare them:
  
  | Component | Bindable node keys |
  |---|---|
  | `statistic` | `label`, `value`, `description` |
  | `card` | `title`, `description` |
  | `button` | `label` |
  
  ```json
  { "type": "statistic", "label": "Active users", "value": "${data.metrics.active}" }
  ```
  
  That node used to render the literal text `${data.metrics.active}`. A dashboard
  `statistic` previously had no way at all to bind a dynamic number — the
  documented workaround (moving the key under `props`) evaluated the value and
  then discarded it, painting a blank card instead. Both shapes are fixed by the
  same change: the value is evaluated once, at the single place that produces
  evaluated schema, and lands where the renderers already read.
  
  **No component behaviour changed.** `statistic.tsx`, `card.tsx` and `button.tsx`
  are untouched — they always read these keys off the node; nothing was writing an
  evaluated value there.
  
  **Scope, and how it grows.** The list is closed and lives in
  `@objectstack/spec` (`EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT`); the renderer
  reads that declaration rather than keeping a copy. On any other component type
  these four keys are still read raw, so an expression reaches the screen as
  literal text — notably `text`, whose `value` is read but has no declaration.
  Adding a type or a key is a change to the spec, never something the renderer
  infers.
  
  **Nothing is newly rejected.** This release only widens what evaluates; no
  metadata that used to render now fails to. The build-time rejection of `${...}`
  in undeclared keys — the second half of the same ruling — is not in this release
  and is still open.
  
  Published authoring guidance updated to match: `skills/objectui/rules/protocol.md`
  (new "Bindable Text Keys" rule), plus the `page-builder`, `schema-expressions`
  and `data-integration` guides, which taught the now-retired "never evaluated"
  statement and its host-pre-resolution workaround.
- 30c73cd: A `disabled` / `disabledOn` predicate that cannot be evaluated is now reported on the console, in development **and** in production — and the message says what this gate's fail-soft default actually did.
  
  `SchemaRenderer` routes six visibility legs (`visibleWhen`, `visible`, `visibleOn`, `visibility`, `hidden`, `hiddenOn`) through one reporter, and called `evaluateCondition` **bare** on the two enablement legs — the only uninstrumented predicate pair in the file. A faulting `disabled` predicate had therefore never been reported in any build, in any dialect that does not report on its own.
  
  It is also the pair whose fail-soft answer **bites**. `evaluateCondition` answers an unevaluable predicate with `true`; on the negated visibility legs that means SHOWN, here it means GREYED OUT. So the user got a control they could see and could not use, and the author got nothing to grep for.
  
  - **Wiring only, one engine call.** Both legs pass `EvaluationOptions.onFault` (objectui#6038's seam), which hands back the fault the evaluator has already caught. No `throwOnError`, no second evaluation, no `__DEV__` split — dev and production print identical bytes.
  - **No verdict moves.** The fail-soft `true` is preserved deliberately: a faulting `disabled` predicate still disables, exactly as before. Flipping that is a shipped-behaviour change and is not part of this.
  - **Its own copy, not the visibility reporter's.** The shipped line says the safe default meant the gate "did NOT bite", which is written about a gate that shows the node. This gate's line says the opposite, because the opposite is true: `[ObjectUI] An enablement predicate could not be evaluated`, then the node, the key, the source, the engine's reason, and that the node renders disabled — on screen, greyed out — with nothing else on screen to say a predicate failed. One reporter, one dedupe, one severity; a second message.
  - **Rate-limited exactly as the visibility gate is**, per `(node type, key, predicate source)`: two hundred rows of one broken predicate print one line, a second distinct source still prints, and the same source authored on `disabled` and on `visibleWhen` prints two — the gates cannot silence each other.
- 830ed58: The record page's approval band offers its **Recall** button to the approval's submitter
  only.
  
  Field report on `@objectstack/*@17.2.0`: user A submits a record into a 4-level approval;
  user B — not the submitter, read access, not an admin — opens the record and the band still
  lights a clickable recall button. The click cannot succeed. The recall endpoint authorizes
  on submitter identity and refuses everyone else, so the only outcome available to that
  button was a failure toast. Record state was never at risk; this was purely a
  writability-feedback mismatch, the same family as objectui#3794.
  
  The button's only gate was `dataSource.cancelPendingApproval` — "can this adapter recall at
  all" — which is a question about the DataSource, not about the viewer. Identity now joins
  it, threaded the way every other signal on that band already travels: the HOST resolves it
  and passes it through `InlineEditProvider`, so the renderer stays DataSource-agnostic and
  never re-derives who submitted what.
  
  - `@object-ui/react` — `InlineEditProvider` accepts `approvalIsSubmitter`, surfaced on
    `InlineEditContextValue`. Additive and optional; no existing prop changes.
  - `@object-ui/plugin-detail` — the band's recall button is withdrawn when that signal is a
    resolved `false`.
  - `@object-ui/app-shell` — `RecordDetailView` resolves the verdict from its existing
    approvals read and threads it.
  
  **The signal is tri-state, and the third state is the load-bearing one.** `true` offers
  recall, `false` withdraws it, and **`undefined` — a host that resolves no approval identity
  — renders exactly as it did before this release.** Omission preserving prior behaviour
  mirrors how `approvalPending` falls back to `locked`. Defaulting the unknown case to "hide"
  would have traded a cosmetic defect for a functional loss: every host whose band runs off
  the record's `approval_status` mirror alone would silently lose its submitter's only way to
  unlock their own record.
  
  **Withdrawn rather than disabled-with-reason.** The card offered either. For a
  non-submitter this control is never actionable on any pending record, so a permanently
  disabled button is standing clutter rather than a lesson; and the two sibling submitter
  levers already hide — the approvals panel's Remind button, and the declared
  `approval_recall` action's `visible` predicate. The band, its quorum tally and the
  approvals timeline still tell a non-submitter exactly what state the record is in. Only the
  lever they can never pull is gone.
  
  **This changes no permission.** Nothing about what the server allows moves, `canEdit` and
  the approval lock are untouched, and nothing downstream reads `approvalIsSubmitter` as an
  authorization verdict — the recall endpoint remains the sole authority, and it refused
  these callers before this change and refuses them after. There is deliberately **no admin
  carve-out** (the reporter ruled that case out, cf. objectstack#9464).
  
  The derivation itself is now one function, `isSubmitterOf` — server-resolved
  `viewer.is_submitter` first (framework#3310), an id comparison as the fallback for backends
  that predate it, joined with `??` so a server that resolved `false` is believed rather than
  re-litigated client-side. The approvals panel's Remind gate, which already carried that
  expression inline and whose behaviour is unchanged, now reads the same answer: two copies
  would have been two definitions of who submitted.
  
  The **untranslated refusal text** the reporter also saw ("No pending approval request found
  for this record", concatenated after a localized prefix) is a separate defect and is not
  addressed here; it is tracked on objectstack#11993.
- c71e14d: **The unresolvable-visibility-predicate report now names the roots of the tier the
  predicate was actually evaluated against** (objectui#6487). An app-shell author
  whose nav, area or field `visible` faulted was told to check `record` and
  `page.<var>` — two roots that tier does not bind at all.
  
  `formatUnresolvableVisibilityMessage` and `reportUnresolvableVisibilityPredicate`
  (both exported from `@object-ui/react`) take a new **optional sixth argument**, a
  `PredicateScopeTier` — also exported — selecting the closing advice paragraph.
  Everything above that paragraph is unchanged on every surface, and so is every
  verdict: this is diagnostics copy only.
  
  **The published signature grew; nothing existing breaks.** The argument defaults
  to `'page-component'`, so a five-argument call keeps printing the bytes it
  printed before. All three in-repo call sites pass their tier explicitly rather
  than lean on that default.
  
  ⚠️ **Dated note, 2026-09-29 — the call-site count above has since moved —
  objectui#6445.** "All three in-repo call sites" above held when this change landed
  (`c71e14d1c`), counting gates: `reportUnresolvableVisibilityPredicate` was called from
  `SchemaRenderer`'s node visibility gate (twice), the `page:tabs` item gate and
  `ExpressionProvider`'s chrome gate, four calls in three files. Later in this same release
  objectui#6445 (PR objectui#6510) added a fourth gate, `SchemaRenderer`'s `disabled` /
  `disabledOn` enablement gate. Re-measured for objectui#10979 on `main` at `2eaf5be27`,
  the reporter was called five times outside its own module, from four gates in the same
  three files, and all five calls passed their tier explicitly, so none leaned on the
  default. `.changeset/6445-disabled-gate-fault-diagnostic.md` (PR objectui#6510) states
  what ships; the text above is kept as the reading of this change.
  
  Each tier's root set was derived from the code that builds the bag, not from the
  prose that described it:
  
  - **`'page-component'`** — `SchemaRenderer`'s node gate and `page:tabs` item
    predicates. Both bind `record`, `current_user` and `page.<var>` (the roots
    `@objectstack/spec`'s `ui/page.zod.ts` declares for the tier). Its paragraph is
    byte-for-byte what it was.
  - **`'app-shell'`** — the chrome gate `ExpressionProvider.evaluateVisibility`
    runs, wired onto this reporter by objectui#6443. Its evaluator is built from
    `{ current_user, user, ctx: { user }, os: { user }, data, features }`, so
    the line now names `current_user` with its three ADR-0068 alias spellings and
    `features` — the deployment-flag root that provider documents for exactly
    this kind of predicate — and states outright that `record` and `page.<var>`
    do not exist there. (That bag and that paragraph also carried an `app` root
    when this entry was first written; objectui#8155 removed it from both before
    either shipped, so the released message names five roots, not six.)
  
  **Why not generalise the copy instead.** Dropping the concrete root names would
  have made one paragraph true everywhere at the cost of making it useful nowhere:
  an author who mistyped a root needs to know which roots exist *at their tier*,
  which is the whole reason the paragraph is read.
  
  `data` is bound at the app-shell tier but is deliberately not advertised there —
  every mount of `ExpressionProvider` in this repo passes `data={{}}` or omits it,
  so naming it would point an author at a root that answers nothing.
- 748494b: The unresolvable-predicate diagnostic tells `hidden` / `hiddenOn` authors what actually
  happened to their node (objectui#6503). Those two legs are the only ones in
  `SchemaRenderer`'s visibility chain whose verdict is NOT negated: `evaluateCondition`
  answers an unevaluable predicate with `true` on every path, the four negated legs turn that
  into SHOWN, and these two return it as-is, so the same `true` sets `_hidden` and the
  component returns `null`. Both were handed the consequence paragraph written for the negated
  legs — "the gate did NOT bite - a predicate that cannot be evaluated reads on screen exactly
  like one that said yes" — which is the opposite of what an author whose block VANISHED is
  looking at. That line exists to name their predicate, and instead it sent them to hunt a
  rendering bug that does not exist.
  
  The two legs now print their own paragraph: the safe default is the one that BITES here, the
  node was REMOVED and is not on the page at all, an absent node is indistinguishable from
  metadata that meant to hide it, and nothing is wrong with the renderer.
  
  Copy only — no verdict moved. The node still vanishes, which is the shipped fail-soft the
  neighbouring family (objectui#3862 / #3955 / #6443 / #6487 / #6445) preserved deliberately,
  and every case in the new suite pins the verdict beside the sentence.
  
  `PredicateGateKind` — re-exported from `@object-ui/react`'s entry — gains a third member,
  `'concealment'`, joining `'visibility'` and `'enablement'`. The opening line is deliberately
  UNCHANGED (`UNRESOLVABLE_VISIBILITY_PREFIX`): these are visibility predicates, and an app or
  a test filtering the console by that constant must go on catching them. Consumers that
  switch EXHAUSTIVELY over the union, or key a `Record` by it, gain a third case to answer;
  no runtime signature moved and every value accepted before still is.
- dc4365c: Retire the discovery-wire preview mode — the console no longer turns
  authentication off because a server said `mode: 'preview'` (objectui#6654).
  
  `@objectstack/spec` retired the `RuntimeMode` value `'preview'` and the whole
  `PreviewModeConfig` block (objectstack `0c2334f6c`). This console still read that
  surface back off the runtime discovery payload, which is a different layer from
  the retired compile-time type — so the consumption could not simply be assumed
  dead, and its removal was ruled deliberately (2026-08-29).
  
  - `ConditionalAuthWrapper` (`@object-ui/app-shell`) drops the branch gated on
    `discovery.mode === 'preview'`. That branch called `setAuthEnabled(false)` and
    simulated an identity out of `discovery.previewMode`, every field behind a
    default. Auth availability is now decided **only** by the ADR-0076 D12 service
    reading (`isServiceUsable(discovery.services.auth)`), exactly as for any other
    mode.
  - `DiscoveryInfo` (`@object-ui/react`) drops the `previewMode` block and stops
    documenting `'preview'` as a runtime mode; the package README's discovery
    section is updated to match.
  
  **Accepted failure direction:** a deployment that still emits `mode: 'preview'`
  or a `previewMode` block now falls back to the ordinary auth reading — it
  requires login. That is loud, diagnosable and more secure than keeping a dormant
  auth-off path keyed on a spelling the platform no longer produces.
  
  **Not affected:** `AuthProvider`'s `previewMode` prop, `useAuth().previewMode`
  and `PreviewBanner` in `@object-ui/auth` are a separate published capability
  with a different producer (a host passing the prop). Only the discovery-wire
  producer of that prop is retired; hosts that pass it explicitly are unchanged.
- e321d52: `useSchemaPersistence` refuses to save a schema carrying function-valued keys
  (objectui#6658).
  
  The designer save door handed the schema straight to `JSON.stringify`, which
  does not preserve a function value and says nothing about it: an object key is
  **dropped**, an array element is **coerced to `null`**. No throw, no warning.
  `save()`
  resolved with the id, `error` stayed null and `lastSavedAt` advanced, so every
  observable signal reported success while the stored schema had quietly lost the
  handler. The failure ordering was the bad one: loss at save, symptom at render
  or click, arbitrarily later, in a different component, with no link back.
  
  Per the 2026-08-29 maintainer ruling on objectui#6658, the door now refuses such
  a save instead of performing a lossy one:
  
  - `save()` walks the schema for function-valued keys **anywhere** in it —
    nested objects and array elements included — before serialization.
  - On a hit it sets `error`, returns `null`, leaves `lastSavedAt` and `isDirty`
    untouched, and never reaches the adapter. The message names the exact
    offending key paths (`columns[2].cell`, `toolbar.actions.onExport`) and both
    escapes: strip the callables before saving, or use the declarative form.
  - The guard sits at the **hook layer**, not inside the default localStorage
    adapter, so a host-injected or REST adapter is covered too — the documented
    REST adapter has the identical `JSON.stringify` shape, so a host following
    the docs inherited the behaviour rather than escaping it.
  
  True lowering (objectstack's server-side `lowerCallables`) is recorded as
  unavailable at a browser door: functions cannot round-trip storage without a
  code registry, so refusal is the honest shape.
  
  Behaviour change for hosts that previously saved callable-bearing schemas —
  those saves were already losing the callables and now fail loudly instead.
  Fully declarative schemas are unaffected and store byte-identically to before.
  No published type or signature changed.
- 3beef6d: The spec's `dataSource` element binding is now DECLARED by the blocks that read
  it, so the html tier stops reporting the one working saved-view spelling as
  `unknown-prop` (objectui#6678).
  
  `PageComponentSchema.dataSource` — `{ object, view, filter, sort, limit }` — is
  the one spelling that resolves a saved view for an object-bound block. It works,
  and it drew the identical `unknown-prop` warning as the two spellings that do
  nothing (`viewName`, `view`), because `validateTree` looks a prop up in the
  block's declared `inputs` and no registration declared this key. On the tier
  built to accept AI-authored pages, where the diagnostic IS the contract, the
  only signal pointed away from the key that works.
  
  Adopting the maintainer ruling of 2026-08-29 — option B **in the injection
  form**:
  
  - `ELEMENT_DATA_SOURCE_INPUT` is the single declaration, in `@object-ui/core`
    beside the binding's own semantics; `Registry.register` emits it for any
    registration whose renderer passed through the new `elementDataSourceBlock()`
    seam. One mechanism, one copy — not a hand-kept declaration per block, which is
    the shape that drifts and that a new block forgets. The seam lives in
    `@object-ui/core` and is re-exported by `@object-ui/react` beside
    `ElementDataSourceGate` for discoverability; call sites take the core import,
    because a registration runs at module scope and this repo's suites partially
    mock `@object-ui/react`.
  - Seventeen renderers, in thirteen files across twelve packages, reach the seam
    and now publish the key to the save gate, the parser whitelist, the generated
    JSX authoring types and the block list. The card named nine blocks; the tree
    also has `plugin-grid`, `plugin-timeline`, two further `plugin-form` blocks and
    `element:record_picker` — nothing was hand-listed, so the mechanism covered
    them. `element:record_picker` consumes the gate's HOOK and status panels rather
    than the wrapper tag (its object lives under `properties`), and was found by a
    render probe rather than by reading sources.
  - `dataSource` on a block that does NOT read it (`flex`, `card`) still reports
    `unknown-prop`. Adding the key to `sdui-parser`'s `BASE_PROPS` was refused for
    exactly this reason — that set mirrors `BaseSchema`, and silencing the key
    everywhere would make the diagnostic lie in the other direction.
  - New `check:element-data-source-declaration` fails any source that consumes the
    gate without reaching the seam, so a block added tomorrow cannot forget.
  
  Behaviour of the binding itself is unchanged — this is a declaration, not a
  resolution change. The saved view still resolves its columns, and an
  unresolvable `view` still fails loudly rather than widening to the object's full
  scope.
  
  The spec/registry parity gates (repo-wide and the `record:related_list` per-block
  pin) now derive their accepted set from the WHOLE node contract rather than from
  `ComponentPropsMap[type]` alone. `PageComponentSchema` accepts and keeps
  `dataSource` on a page-component node — it is a node-level key, a sibling of
  `type` and `className`, not a per-block prop — so the gates' previous complaint
  was measurably wrong. Derived from the spec, not exempted, and both still
  discriminate against an invented key.
- 26896c6: `element:*` renderers stop re-reading a degenerate config bag as its own character indices — the third and last channel of the objectui#6752 / objectui#6760 hazard (objectui#6783).
  
  Five modules under `packages/components/src/renderers/basic/` — `elements.tsx`, `data-list.tsx`, `text-input.tsx`, `record-picker.tsx`, `metadata-viewer.tsx` — each carried a copy of the same reader, `{ ...(schema?.props ?? {}), ...(schema?.properties ?? {}) }`. `??` only replaces `null`/`undefined`, so a non-object bag went into the object spread and came back out as indexed keys: for `properties: 'not-a-bag'`, the config bag a renderer received was `{ '0': 'n', '1': 'o', … '8': 'g' }` — nine keys nobody authored. The five copies are now one `readProps` (`renderers/basic/readProps.ts`) that asks `isConfigBag`, and a degenerate bag on either side contributes no keys.
  
  `@object-ui/react` exports `isConfigBag` from its package entry. That is the API addition here, and it is the reason the fix is not a sixth spelling of the predicate: objectui#6761 converged six occurrences of "is this a real config bag?" behind one definition in `packages/react/src/utils/configBag.ts` and pinned it, but the pin scans `packages/react/src` only — a copy written one package over would be invisible to it. `@object-ui/components` already depends on `@object-ui/react` (all five modules import from it today), so the reachable answer was to publish the definition rather than retell it. Same reason the node-gate predicate reporter is exported at that entry (objectui#6038): one definition, read by every package that asks.
  
  **What this does not change, measured rather than predicted.** No rendered output moves on today's tree. All five renderers read named keys off this bag, and the single onward spread — `metadata-viewer`'s `<StateMachineView {...props} />` — hands it to components that destructure named fields, so the indexed keys were computed and then dropped. The census behind objectui#6708 found zero authored nodes carrying a degenerate config bag, so this was a latent shape, not a live failure. What the guard buys is what objectui#6752 measured its own guard buys, one channel further down: the authored value's shape is not reinterpreted. objectui#5123's precedence is untouched — `properties` still wins a contested key, and a degenerate bag declares no key for either side to win.
- b87f15b: `useOffline` auto-syncs mutations queued while already online (objectui#6818).
  
  The auto-sync effect was keyed `[isOnline, enabled]` with
  `react-hooks/exhaustive-deps` suppressed, so its `queue.length === 0` guard was
  evaluated against the queue as it stood when `isOnline` or `enabled` last
  changed. `queueMutation` has never been conditional on being offline — it
  accepts entries whenever the hook is enabled — so anything queued while ALREADY
  online found the effect asleep, and nothing re-ran it. Only an explicit `sync()`
  drained those mutations; the hook whose job is auto-sync did nothing for them.
  
  The suppression's stated reason ("only trigger on `isOnline` changes, not on
  every queue change") was about TIMER RESTARTS, and it is kept: the effect is
  keyed on the **boolean** `queue.length > 0`, never on `queue` or `queue.length`,
  so queueing a second mutation while the 100ms stabilization timer is already
  armed still does not re-run the effect or restart the timer. What the
  suppression never justified — the early return against a stale snapshot — is
  what changed.
  
  `sync` also read `batchSize` through a ref (newest) while reading `queue` from
  its own closure (a snapshot), so the two halves of one call disagreed about how
  current they were, and the auto-sync effect retains such a closure by design.
  The queue now reaches `sync` through the same commit-phase mirror the sync
  config uses, so both halves are the newest committed values. That also takes
  `queue` out of `sync`'s dependency list: `sync` is keyed `[enabled]` and is
  stable across queued mutations, which is what lets the effect name every value
  it reads and drop the `eslint-disable` entirely rather than reword it.
  
  **Behaviour change, graded `minor` deliberately.** `useOffline` is published and
  its out-of-repo population is unmeasured; the single in-repo caller
  (`AppHeader`) destructures `isOnline` only and is unaffected. A consumer that
  called `queueMutation` while online and relied on nothing being sent until it
  called `sync()` itself will now see that mutation flushed ~100ms later.
  `sync`'s identity is also more stable than before — it no longer changes on
  every queued mutation — which is safe for effects keyed on it but is a visible
  difference.
  
  Not changed here: a `batchSize` smaller than the queue still drains one batch
  and leaves the remainder for the next transition, because whether one auto-sync
  should chain batches until the queue is empty is a separate question about what
  `batchSize` means, not about this guard. Filed as objectui#6857.
- 03380aa: Inline edit: a rejected save now says WHICH field the server refused, and why.
  
  Editing a record in place on a detail page and hitting Save used to surface the
  backend's own string when the write was refused — `VALIDATION_FAILED:
  Validation failed for crm_opportunity` — leaving the user to guess which of the
  fields they had just edited was the problem. The refusal has always been
  field-scoped (`@objectstack/objectql`'s validators throw `VALIDATION_FAILED`
  with `fields[]`, and both the REST layer and the runtime dispatcher pass those
  entries through intact); the inline surface was the last one still dropping
  them. `<InlineEditSaveBar>` now renders one reason per rejected field, named by
  that field's own label — the same treatment record forms have had since #3222.
  
  Attribution never guesses. It reads the envelope through
  `@object-ui/react`'s `extractFieldErrors`, the single in-repo normaliser the
  form surface already uses, and an entry with no usable `field` is dropped
  rather than pinned on whichever input is nearby. In the drawer's callback mode,
  where persistence loops `onFieldSave(field, value)` one key at a time, a
  rejection is attributed to the key that was in flight — a fact about the write,
  not an inference. Anything that is not field-scoped (a network failure, a
  permission denial) keeps the cleaned single-line message it had before.
  
  `@object-ui/react` gains one additive public API member to carry this, and it
  is the reason that package's entry is `minor` rather than `patch`:
  `InlineEditContextValue` now has **`fieldErrors`** — a nullable map of field
  machine name to the server's reason — alongside a **`setFieldErrors`** setter,
  the exact companions of the `error` / `setError` pair that interface already
  carried. Nothing is removed and nothing changes shape, so every existing host
  and consumer compiles and behaves as before; a host that never reads the new
  member sees no difference. It exists because the save bar and the field rows
  are SIBLINGS under `InlineEditProvider` in both persistence modes, so before
  this there was no channel between the component that receives a refusal and the
  components that render the fields it is about.
  
  Also recorded in code, per the maintainer's ruling on objectui#6868: **the
  server is the validation authority on the inline-edit surface.** That was
  previously an absence — `InlineFieldInput` runs no rules and takes no `error`
  prop — and it is now a decision, written into both modules' headers with a
  pointer to the ruling. No client-side rule evaluator was added, and none should
  be: the server is the only rule source, and this surface only presents it.
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
- cfc9b6d: A filter on a record page can now be scoped to the record the page shows (objectui#7297). Write `{record_id}` as a filter value, for example `{ "assignee": "{record_id}" }` on an `element:number` counting tasks, and on a `type: 'record'` page it resolves to the id of the record in view: on one person's page the number is that person's count, and on the next person's page it is theirs. It works in a component's own `filter` and in its component-level `dataSource.filter`, on every data component that resolves its filter through `@object-ui/react`'s `useFilterScope()`. The token is declared by `@objectstack/spec` 17.5.0 (`RECORD_CONTEXT_TOKENS`, objectstack-ai/objectstack#20003).
  
  The id comes from the record page's mounted record context, never from a URL parameter or a page variable. `@object-ui/react`'s `useFilterScope()` adds it to the scope it returns (as the new optional `recordId` member of `@object-ui/core`'s `FilterTokenScope`) whenever a `RecordContextProvider` is mounted above the component; `FilterScopeProvider` is unchanged and still carries only the session values. The held filters in `useResolvedFilter`, `object-grid` and `object-view` resolve again when the record changes, so moving to another record queries again without a remount.
  
  Anywhere with no record in context (a list view, a dashboard, a report, or a page that is not a record page) `{record_id}` is refused by name: `resolveContextTokens` reports it through `onUnresolved` (a console warning by default), the way an unresolved `{current_user_id}` is reported, and leaves it as written. It never becomes `null` and its condition is never dropped, so a number can never silently count every record; the ObjectStack server refuses the leftover token by name (`FILTER_TOKEN_UNRESOLVED`). Like the session tokens, `{record_id}` only scopes what a component shows. It is not access control: which rows a user may read is still decided by the server's row-level security.
  
  **Correction, 2026-09-30 (objectui#8945).** The example in the first paragraph, `{ "assignee": "{record_id}" }`, is the retired MongoDB-style record form. `@objectstack/spec` 17.5.0 refuses it at an `element:number` `filter`, because that key takes an array and a record is refused by kind. Write the same condition as a `ViewFilterRule` array, which the spec accepts: `[{ "field": "assignee", "operator": "equals", "value": "{record_id}" }]`. A component-level `dataSource.filter` takes the same array. The `{record_id}` token itself, and the rest of this entry, are unaffected.
- 71a4a53: **BREAKING: `useClientNotifications` is removed from `@object-ui/react`**
  
  What left: the `useClientNotifications` hook and its two types,
  `UseClientNotificationsOptions` and `UseClientNotificationsResult`. Code that
  imports any of the three from `@object-ui/react` no longer compiles.
  
  Migration: use the shell's shared inbox feed. `@object-ui/app-shell` reads the
  ADR-0030 inbox rows (`sys_inbox_message`, with read-state in
  `sys_notification_receipt`) through one shared feed, and each of its inbox
  surfaces reads that feed: the header bell in `AppHeader`, and a
  `global:notifications` node placed on a page. Mount one of those instead of
  polling `client.notifications.*` yourself. The "Server-side notifications"
  section of the notifications guide describes both.
  
  Why: the hook ran a poller of its own (a `setInterval` over
  `client.notifications.list`) and copied the rows into `NotificationProvider`,
  beside the shell's feed rather than through it. Mounted next to the console
  shell, it would have read the same rows on a second schedule and kept a second
  copy of their read-state: the duplicate-scheduler shape that objectui#4197,
  objectui#4225 and objectui#4316 removed. It had no consumers. Before the
  removal, a census found no call site in this repository (objectui `e6203d756`)
  beyond its own file, the package barrel, the notifications guide and CHANGELOG
  entries. It also found none in the sibling `objectstack` (`338feda6`) and
  `hotcrm` (`087b7c5`) repositories. Importers outside those repositories are
  NOT MEASURED. Under the ruling on objectui#7389, a published capability with
  zero consumers retires immediately, with no deprecation window.
  
  Unchanged: `NotificationProvider`, `useNotifications` and the rest of the
  notification system in `@object-ui/react`.
  
  Marked `minor`, not `major`, per the version-alignment convention in
  AGENTS.md; the break is real and is stated here.
- 1237ae4: The non-grid row ceiling's mechanism moves to `@object-ui/core`, its probe row
  lives in one query helper, and its footnote takes the result and nothing else
  (objectui#7508, maintainer ruling A′ — follow-up to objectui#7210).
  
  **`@object-ui/core` — new exports**, beside the `extractRecords` they wrap:
  
  - `NON_GRID_ROW_CEILING` (moved from `@object-ui/react`, value unchanged);
  - `applyNonGridRowCeiling` and the type `NonGridCeilingResult` (moved from
    `@object-ui/react`, behaviour unchanged);
  - `nonGridRowCeilingQuery()` (new) — returns `{ $top }`, the ceiling plus ONE
    probe row. It is the only place that `+ 1` is written; spread it into the
    `find()` query.
  
  **`@object-ui/react`**:
  
  - still exports `NON_GRID_ROW_CEILING`, `applyNonGridRowCeiling` and the type
    `NonGridCeilingResult`, now re-exported from `@object-ui/core` — the same
    bindings, so no import of these three changes;
  - **removed**: `NON_GRID_ROW_CEILING_TOP`. Replace `$top: NON_GRID_ROW_CEILING_TOP`
    with `...nonGridRowCeilingQuery()` from `@object-ui/core`. This supersedes the
    export list in objectui#7210's entry, which names it;
  - **breaking prop change**: `NonGridRowCeilingNote` takes `result`
    (a `NonGridCeilingResult`) and no other prop. `drawn`, `total`, `truncated`
    and `className` are gone, with no deprecated path. Pass the object
    `applyNonGridRowCeiling` returned: the note prints `result.rows.length` and
    `result.total`, so a footnote whose numbers disagree with the rows drawn can
    no longer be written. It now carries `shrink-0` itself, which the gantt used
    to pass in through `className`.
  
  `ObjectCalendar`, `ObjectGantt`, `ObjectMap` and `ObjectTree` take the helpers
  from `@object-ui/core` and hand the note their result; what they fetch, draw and
  print is unchanged.
- b041b9c: `@object-ui/core` publishes `resolveRecordSourceObjectName`, the ONE reader for "which
  object is this block bound to".
  
  Six view plugins each spelled that resolution locally — `ObjectCalendar` twice,
  `ObjectGantt`, `ObjectTree` twice, `ObjectMap`, `ObjectGrid` — and had drifted: three
  wrote `?? schema.objectName`, one `|| ''`, one `: undefined`, one an `'object' in
  dataConfig` test. They now delegate to one function that states the published
  record-source ladder `77cb489b4` declared (`data`, then `staticData`, then `objectName`) once.
  
  **No behaviour changes.** Each site's pre-collapse expression is transcribed verbatim
  into `record-source.behaviourNeutrality-7627.test.ts` and asserted equal to its
  post-collapse spelling across the whole contract-valid input matrix — both bindings
  present, data only, `objectName` only, empty `objectName`, empty `data.object`, the
  `api` / `value` / `staticData` / array-shorthand providers, and nothing bound.
  
  **Two questions stay two questions.** `normalizeListViewSchema`'s gap-fill (#7477,
  ruling B, landed as `00d2fa682`) is untouched and is NOT re-pointed at the new reader: it answers
  how `objectName` gets POPULATED when absent, where an already-present `objectName` wins.
  The new reader answers which object a block RESOLVES, where the `data` block wins — the
  order declared on both published faces in `@object-ui/types` and pinned by
  `objectql-record-source-refinement-6939.test.ts`. Merging them would silently override
  one standing ruling or the other.
  
  **`ObjectGantt`'s `persistLayoutKey` is deliberately excluded** and keeps its inverted
  order, with an in-place comment saying why: its receiver is a localStorage key
  (`gantt-layout:KEY:filters`), not a record source, so re-pointing it would orphan every
  saved layout and filter-chip set of a view carrying both bindings. Two more sites the
  finding listed are not object-name readers at all and were struck: `ObjectGantt`'s
  refresh-handler predicate (`object` OR `api`) and `plugin-dashboard`'s `isObjectProvider`
  type-guard over a widget's `data`.
  
  `useSettledSchema`'s doc comment stops prescribing the hand-written ladder at all four
  lines that taught it, so the copies cannot re-seed from the hook that replaced them.
- 95bf128: feat(react): an action's `params` values are templates, evaluated where `properties` are
  
  Every string leaf of a node's `params` bag - the node-level `params` and
  `properties.params` alike (and the legacy `props.params`, which follows its
  canonical bag), at any depth, inside nested objects and arrays - is now
  template-evaluated by `SchemaRenderer`, with the same evaluator and the same
  scope that already evaluates `properties`. A metadata-authored button on a
  record page can therefore name the record it sits on:
  
  ```json
  { "type": "action:button", "label": "Edit", "actionType": "navigate_edit",
    "params": { "objectName": "account", "recordId": "${record.id}" } }
  ```
  
  Before this, both spellings of `params.recordId` reached the action handler as
  the raw `${record.id}` text: the node-level bag was never evaluated, and
  `properties.params` was one value of a shallow loop, so the template inside it
  was never visited.
  
  Behaviour change, stated plainly: a `params` string containing `${...}` is now
  evaluated at render time instead of being passed through verbatim. It reaches
  only values whose templates never worked - no authored `params` bag in this
  repository carries one. A template that still cannot be evaluated (an unbound
  root such as `${nope.id}`) keeps its source text exactly as before, and the
  development-build unevaluated-expression diagnostic now reports it by its path
  (`params.recordId`, `properties.params.target.id`), so a wrong template stays
  loud.
  
  What is not walked: an ARRAY `params` (the `ActionParam[]` definition list the
  params dialog renders) is left as authored; keys are never evaluated, only
  values; non-plain objects (`Date`, `Map`, class instances) and functions pass
  through by identity; a cycle in a host-built bag ends the walk. Every other
  nested config value keeps the shallow reading it had.
  
  ⚠️ **Dated note, 2026-10-01 — props written flat on the node — objectui#10872 batch 10.** Later in this same release a flat `actionType` on an `action:button` node is refused by name, by `objectui validate` and the strict authoring face, with a message naming `properties.actionType`. The node-level `params` object the example above shows is refused the same way, toward `properties.params`, where objectui#10289's entry moved its values: the runtime no longer reads a node-level `params` object as values. So the example is kept as the reading of this change, and the node is written `{ "type": "action:button", "properties": { "label": "Edit", "actionType": "navigate_edit", "params": { "objectName": "account", "recordId": "${record.id}" } } }` in this release. The template evaluation this entry describes applies to `properties.params` unchanged. The rest of this entry is kept as the reading of this change.
- edea22a: **BREAKING** — `SchemaRendererProvider`'s `dataSource` prop, and the context
  type every `useSchemaContext()` consumer reads back, are the published
  `DataSource` contract instead of `any`.
  
  **FROM** `dataSource={anything}` **TO** `dataSource={adapter}` — a `DataSource`
  from `@object-ui/types`, or `null` / `undefined` when the host has no adapter
  bound.
  
  ```ts
  // before — compiled, and failed at runtime on the first find()
  <SchemaRendererProvider dataSource={'not-an-adapter'}>
  // before — compiled, and no reader can do anything with it
  <SchemaRendererProvider dataSource={{}}>
  // after
  <SchemaRendererProvider dataSource={adapter}>       // a DataSource
  <SchemaRendererProvider dataSource={undefined}>     // "I have no adapter"
  ```
  
  Both sites are typed `DataSource | null | undefined` — the spelling
  `useSettledSchema` in this same package already used. The two absences are part
  of the contract, not a weakening of it: a Studio preview, a `kind:'react'` page
  rendered before the host's adapter connects, and a widget probe driving
  `apiFetch` alone all render with nothing bound, and every reader in the tree
  already guards for it. What the union refuses is everything that is not an
  adapter: a string, an empty object, a plain data bag, a partial adapter missing
  a required member.
  
  The measured cost, both halves, because the two `any`s have different blast
  radii (measured separately on `origin/main`, whole-repo type-check over the 33
  packages that depend on `@object-ui/react`):
  
  - the **context type** — the `any` that reaches every `useSchemaContext()`
    reader — reds **7 diagnostics at 7 sites in 4 packages**, all of them
    production code or a mocked module factory.
  - the **provider prop** — the injection points — reds **52 diagnostics at 27
    sites in 11 packages**, all but one of them test doubles.
  
  That ordering is the reverse of the prediction on the card: the context `any`
  was expected to be the expensive one because it infects the whole tree, and it
  is the cheap one, because every reader in the tree already guarded and none of
  them ever reached past `find` / `getObjectSchema`. The prop is the expensive
  one, because the injection points are overwhelmingly test doubles that were
  never complete adapters. The full accounting is on objectui#7912.
  
  Two runtime behaviours change, both in the "no adapter" direction and both
  strictly closer to what the surrounding code already intended:
  
  - `@object-ui/components`' `kind:'react'` page passed an empty object as its
    "no adapter yet" stand-in. An empty object is TRUTHY, so it walked past every
    `if (!dataSource)` guard written to catch exactly that state and failed later,
    at the call. It now passes the absent adapter itself, so the guard fires where
    it was meant to. The module-constant identity that stand-in existed for is
    preserved: `null` is a primitive, so the provider's memo is unaffected.
  - `@object-ui/plugin-calendar`, `@object-ui/plugin-gantt` and
    `@object-ui/plugin-kanban` collapse a `null` adapter from the context to
    `undefined` before handing it to their widget, whose prop declares the single
    spelling `dataSource?: DataSource`.
  
  Nothing else moves at runtime: no value flowing through this key changes, and
  no data path is touched. A TypeScript consumer outside this repo that handed
  this prop something other than an adapter now gets a compile error naming the
  key (TS2322 / TS2739 / TS2740), which is why the FROM/TO is spelled out above.
  
  Five `as any` reads of this context in `@object-ui/fields` are gone — they were
  redundant the moment the seam became honest — and `LookupField`'s local
  re-declaration of the imported context as a `Context` of `any`, which laundered
  its `dataSource` read while looking typed, is gone with them. Both directions of
  the contract are pinned against the real compiler in
  `SchemaRendererContext.dataSourceType.pin.test.ts`, and the card's planted
  documentation probe (a bare string in `packages/react/README.md`'s provider
  example) now fails `pnpm check:doc-snippets`, where it used to exit 0 with zero
  diagnostics.
  
  objectui#7912.
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
- 4eaa835: `BaseSchema.testId` is now emitted as `data-testid` (objectui#8268, ADR-0049 enforce arm).
  
  The declaration promised "Rendered as data-testid attribute" and nothing rendered it. `testId`
  was absent from `SchemaRenderer`'s metadata destructure, so it fell through into the spread and
  reached the DOM under React's fallback spelling for an unrecognised prop — a non-standard
  lowercase `testid` that `screen.getByTestId(...)` and `[data-testid=...]` both miss. The
  validator accepted the key, so an author who followed the documented row got a failing test with
  no diagnostic near the cause.
  
  Measured on `93127bd6f` through the real `ui:scroll-area` renderer, node
  `{ id: 'my-scroll', testId: 'my-tid' }`:
  
  ```
  before  id="my-scroll" testid="my-tid" data-obj-id="my-scroll"
          [data-testid="my-tid"] false · [testid="my-tid"] true
  after   id="my-scroll" data-testid="my-tid" data-obj-id="my-scroll"
          [data-testid="my-tid"] true  · [testid="my-tid"] false
  ```
  
  `id` reaching the DOM as `id` + `data-obj-id` is the contrast leg, green on both runs — the
  strip list and the spread were working as designed; only this key had no mapping.
  
  The other direction — retiring the promise — was considered and declined. It is what
  `c1fe272ad` did for `BaseSchema.hidden`, but that key had a working behaviour to describe and
  zero named consumers, and the ruling's decline turned on exactly that. This promise already has
  carriers outside the type declaration: `content/docs/api/schema-reference.md` states it as a
  table row and authors `testId` in that page's own base-schema example, `@object-ui/cli`'s
  `OBJECTUI_STRUCTURAL_KEYS` identifies a file as an ObjectUI schema node by this key,
  at this change `ObjectGridSlotKey` / `ObjectFormSlotKey` pin it, `SchemaBuilder.testId()` writes
  it, and ADR-0054 C4 — shipped — reads "the renderer emits `data-testid` … derived from metadata".
  
  ⚠️ **Dated note, 2026-09-29 — `ObjectGridSlotKey` withholds `testId` — objectui#10976.** Later
  in this same release `ObjectGridSlotKey` stops carrying `testId`: `ObjectView` draws its grid as
  a component, not as a schema node, so nothing emits the attribute there, and `table.testId` is
  refused. `ObjectFormSlotKey` still carries it. The rest of this entry is kept as the reading of
  this change; the objectui#10976 entry states what ships.
  
  `minor`, not `patch`: nodes that author `testId` change what they emit in both directions, so a
  selector written against the accidental `[testid=…]` stops matching.
  
  Nodes that author no `testId` are byte-identical to before. The attribute is spread
  conditionally rather than passed as `'data-testid': undefined`, because the unconditional form
  puts the key in every node's props bag and a component that sets its own `data-testid` before
  spreading what it is handed loses its locator — measured, 9 tests red across 5 files, three of
  them the byte-for-byte props-bag pins (objectui#6708 / #6752 / #6760).
  
  `testId` is stripped from the spread but kept in objectui#4795's unevaluated-expression scan
  set: the strip list is that diagnostic's exclusion list because every other member holds raw
  predicate source, and this key holds a literal.
- 152f0a7: `toRenderableSchema` is behaviour-preserving for the falsy primitives too, so `empty`
  stops printing a stray `"0"` (objectui#8908).
  
  `toRenderableSchema` is the repo's permanent bridge from `@object-ui/types`' `SchemaNode`
  union onto `SchemaRendererProps['schema']`, which deliberately declares no `number` /
  `boolean` (objectui#4548 ruling Q2). Its docblock promised — and its callers were entitled
  to rely on — that "the value a caller forwards renders identically whether or not it
  passes through here". That was false for exactly two of the six `SchemaNode` members.
  
  The bridge mapped every `number` / `boolean` onto `String(node)`. `String(0)` and
  `String(false)` are the NON-EMPTY strings `'0'` and `'false'`, which are truthy, so they
  sailed past `SchemaRenderer`'s own `!evaluatedSchema` leg and rendered as their own text —
  while the same two values handed to `SchemaRenderer` directly render nothing, pinned since
  objectui#4548. The mapping is now two-legged and mirrors the renderer's own narrowing
  order: a truthy `number` / `boolean` still becomes its text form, and a falsy one
  (`0`, `-0`, `NaN`, `false`) becomes nothing.
  
  **Behaviour change on a published surface, deliberately.** The reachable, shipped instance
  is `empty`: its `action` slot gates on nullish rather than truthiness (objectui#7105, so a
  bare string node renders instead of being dropped), so `0` and `false` went through the
  bridge. `{ type: 'empty', title: 'T', action: 0 }` rendered `"T0"` and now renders `"T"`,
  which is what the same node handed straight to `SchemaRenderer` has always rendered.
  Every other slot routed through the bridge — page regions, header-bar actions, detail tabs
  and footers, report sections, view configs — gets the same correction for the same two
  values.
  
  **No type change, and that is not an accident.** The return type is unchanged:
  `BaseSchema | string | null | undefined`. Letting `0` / `false` through UNCHANGED would
  have widened it to admit `number` / `boolean`, which `SchemaRenderer`'s prop refuses by
  ruling — so it would have been a TS2322 at every call site that forwards the result
  straight into `<SchemaRenderer schema={…} />`, which is all nineteen of them. The falsy
  leg returns nothing instead, which keeps the guarantee and the type both. The exact
  equality of the two is pinned in
  `packages/react/src/__tests__/SchemaRenderer.propsResolution.test.ts`.
  
  **Migration.** Nothing has to change, and nothing needs a code edit. A slot that authored
  `0` or `false` was painting a literal `"0"` / `"false"` where the platform's answer for
  those values is nothing; it now renders nothing. If some surface was relying on that stray
  text — authoring `action: 0` to make the digit appear — author the string `'0'` instead,
  which is a `SchemaNode` and renders as its own text on both paths.
  
  **Supersedes one sentence in the objectui#8331 entry.** That note said the `data-table`
  `emptyAction` truthiness leg is kept "precisely so those two never reach the bridge, whose
  `String` mapping would otherwise turn them into the text `"0"` and `"false"`". The bridge
  no longer does that. The leg is kept anyway, and objectui#8908 kept it deliberately rather
  than removing it as newly redundant: it is what makes that slot's answer independent of
  the bridge, and it is why `emptyAction` was never affected by this defect in the first
  place.
  
  ⚠️ **Dated note, 2026-10-01 — the bridge's return type widens with the prop — objectui#11364.** Later in this same release `SchemaRendererProps.schema` becomes `BaseSchema | AuthoringNode | string | null | undefined`. `toRenderableSchema` returns `SchemaRendererProps['schema']` by reference, so its return type widens with it. So "The return type is unchanged: `BaseSchema | string | null | undefined`" no longer describes the release as a whole: the falsy leg still adds no `number` / `boolean`, and the pinned equality with the prop still holds. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — the prop takes the declared-node union — objectui#11466.** At this change, and at objectui#11364's note above, the bridge's return type spelled its object member `BaseSchema` (with `AuthoringNode` beside it after objectui#11364); now, later in this same release, `SchemaRendererProps.schema` is `DeclaredNode | string | null | undefined`, and the return follows it by reference. The falsy leg still adds no `number` / `boolean`, and the pinned equality with the prop still holds. The rest of this entry is kept as the reading of this change.
- 689953a: Keep the `{ dialect: 'cel', source }` predicate envelope intact through a node's
  config bag, so a CEL visibility gate authored the canonical way reaches the CEL
  engine instead of the legacy JS one (objectui#9100).
  
  **The defect.** `SchemaRenderer`'s per-value `properties` / `props` evaluation loops
  handed every bag value to `ExpressionEvaluator.evaluate`, whose first action is to
  unwrap any `{ source: string }` object down to its bare `source` — the unwrap that
  makes a `template` envelope interpolate. Applied to a `cel` predicate it was
  destructive: the envelope is the only thing that routes `evaluateCondition` to the
  canonical `@objectstack/formula` engine, and those loops run before the hoist, so
  both consumers — `SchemaRenderer`'s own visibility chain and the renderer's
  `toPredicateInput` → `useCondition` call one layer down — received a bare string and
  took the legacy JS path, where a CEL stdlib call such as `has()` is not a function.
  
  Both polarities then failed silently, in opposite directions. On the four SHOW legs
  (`visibleWhen` / `visible` / `visibleOn` / `visibility`) the fail-soft `true` is
  negated, so **a gate authored to hide something rendered it on every row** — measured
  in a real browser, where a duplicate-lead banner showed on 6 of 6 records whose field
  was `null`. On the two HIDE legs (`hidden` / `hiddenOn`) the same `true` is returned
  un-negated, so **the node vanished entirely**. Neither is distinguishable on screen
  from a predicate that said so on purpose.
  
  **Behaviour change, deliberately.** A `cel`-envelope predicate on any of those six
  keys, authored inside `properties` or `props`, now actually decides. Metadata that
  was relying — knowingly or not — on such a gate never biting will start seeing nodes
  hidden (SHOW legs) or shown (HIDE legs) as authored. Nothing else moves: a `template`
  or dialect-less envelope keeps the legacy `${…}` behaviour byte-for-byte, a
  non-predicate bag key keeps the flattening it has always had, and node-level
  predicate keys were never affected (they do not pass through these loops, which is
  why objectui#7530's pin stayed green throughout).
  
  **`record:alert` declaration.** Its `visible` input was registered as a bare
  `'string'` while `@objectstack/spec` 17.4.0 declares
  `boolean | string | { dialect, source }` for the same key and the renderer resolves
  all three. It is now declared `['boolean', 'string', 'object']`, in the same change
  that made the envelope arm actually reachable.
- 8d3dbb2: fix(react): keep the CEL predicate envelope intact on the ENABLEMENT keys too
  
  `SchemaRenderer`'s two per-value config-bag loops (`properties` — the spec
  spelling — and its legacy `props` alias) flattened a `{ dialect: 'cel', source }`
  predicate envelope on `disabled` / `disabledOn` / `enabled` down to its bare
  `source` string, exactly as objectui#9100 measured for the visibility chain. The
  envelope is the only thing that routes `evaluateCondition` to the canonical
  `@objectstack/formula` engine, so the flattened predicate took the legacy JS
  path, where a CEL stdlib call such as `has()` is not a function.
  
  objectui#9104 repaired this for the six visibility legs only. The enablement
  keys are not visibility legs — they route through the node's enablement gate and
  through the action renderers' own predicate call — so they were left flattened,
  and the resulting fail-soft `true` landed in OPPOSITE directions on the two
  halves of the chain:
  
  - `disabled` / `disabledOn` are not negated, so a CEL-authored gate greyed its
    control out on every row and no predicate the author could write re-enabled
    it — measured through `action:button` and `action:icon`;
  - the legacy `enabled` alias IS negated by those renderers, so the same `true`
    arrived as "not disabled" and a control the author had disabled stayed
    pressable.
  
  The guard now consults the union of the file's two closed predicate-chain
  declarations instead of the visibility one alone. `template` and dialect-less
  envelopes, non-predicate bag keys and predicates nested inside arrays keep their
  behaviour byte for byte.
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
- 8524372: Unbind the data-source adapter from the expression scope, and point `bind` at the scope
  channel (objectui#9308, maintainer ruling 2026-09-13, option B).
  
  **Breaking, deliberately — and `minor` only because this repo's `fixed` group of 40
  packages may not carry a `major` (AGENTS.md 版本号策略).** Read the migration note below
  before upgrading if any of your metadata reads `data.*` at the page/component tier.
  
  **What changed.**
  
  1. `SchemaRenderer` no longer writes `data: dataSource` into the evaluator scope. `data`
     is not a root this tier binds. The roots it supplies are `record` (the row, when a
     record surface bound one), `page` (page-local variables) and `current_user` — plus
     every name the host published through `PredicateScopeProvider`.
  2. `useDataScope(path)` — what a node's `bind` resolves through — reads the ambient
     predicate scope (`usePredicateScope()`) instead of walking the injected adapter.
  
  **Who this breaks, concretely.**
  
  * **A `${data.…}` expression on a page/component node.** It used to resolve against the
    host's injected `DataSource` adapter. An adapter answers no `data.*` path, so for every
    host that injected a real adapter the read was already `undefined` and the predicate was
    a silent constant — but the constant MOVES: `data` used to be a present key holding an
    object, so `data.status == 'draft'` evaluated cleanly to `false` and the node was hidden
    on every row. `data` is now ABSENT, the expression cannot be evaluated at all, and this
    surface is fail-soft, so the same gate now answers `true` and the node is SHOWN on every
    row. It is no longer silent: the objectui#5454 reporter names it in the console, in
    production as well as development. Re-root such a predicate on `record.*` — the row —
    or publish a `data` of your own through `PredicateScopeProvider`.
  * **A host that injected a plain data bag as `dataSource`.** That was meaning 2 of the
    key, and it stops working entirely: `${data.…}` no longer reads it and `bind` no longer
    walks it. It has been a compile error since objectui#7912 (`dataSource` is typed
    `DataSource | null | undefined`). Publish those values through `PredicateScopeProvider`
    instead — the provider, the hook and the app-shell wiring already exist, and this change
    adds no new published key.
  * **The nine `bind` readers** (`list`, `tree-view`, `ObjectChart`, `ObjectDataTable`,
    `ObjectPivotTable`, `ObjectGrid`, `ObjectKanban`, `ObjectGallery`, `ObjectTimeline`) now
    resolve `bind` against the scope. All nine already carry a fallback
    (`boundData || schema.items`, `|| schema.nodes || []`, or a fall-through to their own
    fetch chain), and against a conformant adapter `useDataScope` returned `undefined`
    before this change — so the fallback is what was running, and a `bind` that resolved
    nothing before still resolves nothing. What is new is that a `bind` CAN now resolve:
    a host that publishes rows on its scope will see them used where the fetch used to run.
  
  **Why.** `@object-ui/app-shell`'s `ExpressionProvider` states the rule this applies: every
  root bound at a tier must be one the engine accepts AND one that tier can actually answer.
  objectui#8155 unbound `app` under it and objectui#8166 unbound `data`; ADR-0089 D3 puts
  `data` at the metadata layer and `record` at the runtime layer, and the engine's
  per-surface `FIELD_RULE_BOUND_ROOTS` is `['record','previous','parent']`. The renderer tier
  was the last one still binding a root it could not answer.
  
  Two side effects worth naming. A host that legitimately published `data` through the
  documented scope channel used to be silently overwritten by the adapter (the adapter was
  spread last); it is not any more. And `reportAdapterOnlyDataPredicate` now resolves against
  the `data` the evaluator actually bound rather than against the adapter — left pointing at
  the adapter it would have gone silent for precisely the hosts this change breaks.
  
  The Data Context passages of `content/docs/guide/schema-rendering.md` and
  `packages/react/README.md` teach the scope channel accordingly.
- 72d6587: A record id is a `string` everywhere in the published types, as
  `@objectstack/spec` has always declared it. Three published declarations that
  admitted `number` no longer do.
  
  ⚠️ **BREAKING if your code hands a numeric primary key to any of these three:**
  
  - **`RecordContextValue.recordId`** (`@object-ui/react`) — the value
    `useRecordContext()` gives you is now a `string`, never a `number`.
  - **`DataSource.update`'s `id` parameter** (`@object-ui/types`) — a call that
    passes a `string | number` is now a type error. Adapters that *implement*
    `DataSource` are unaffected (see Migration).
  - **`TransactionOperation.id`** (`@object-ui/core`) — the operation record you
    hand to `TransactionManager.recordOperation()` must carry a `string` id. If
    you build that object from a numeric key, convert it where you build it. This
    type is exported from the package root, so this is a breaking change for
    `@object-ui/core` consumers in its own right, not just a knock-on.
  
  Ships as `minor` per the launch-window convention: objectui's
  `major` is a cross-repo pin to `@objectstack`'s so that "same major means
  compatible" holds across the two repos
  (`scripts/check-changeset-no-major.mjs`), and objectui's own breaking changes
  ship as `minor` with the break named where it lands — this entry is the channel
  that carries it.
  
  ## What changed
  
  - `RecordContextValue.recordId` (`@object-ui/react`) was
    `string | number | null | undefined`; it is now `string | null | undefined`.
  - `DataSource.update`'s `id` parameter (`@object-ui/types`) was
    `string | number`; it is now `string`.
  - `TransactionOperation.id` (`@object-ui/core`) was `string | number`; it is now
    `string`. Its sibling `BatchTransactionOperation.id` was already a `string`,
    so the two operation records finally agree.
  - `LineItemsPanel` (`@object-ui/plugin-form`) drops the type assertion
    objectui#9304 left on its parent id. That assertion was the only thing making
    the context declaration and `buildMasterDetailEditBatch(parentId: string)`
    meet; the declaration now does it, so the evidence is discharged.
  
  ## Why the protocol, and not a wider consumer type
  
  `@objectstack/spec` declares a record id as `z.string()` on every record door —
  get, update, delete and the batch operation. A consumer type may not be wider
  than the protocol: a declaration that admits `number` promises callers something
  the wire never carries, and the promise is kept only by an assertion at the far
  end, which is what this card was filed about.
  
  ## Internal consumers repaired at the same time (no public contract moves)
  
  Narrowing an interface **parameter** never reaches implementors — TypeScript
  compares method parameters bivariantly, so an adapter that still declares
  `id: string | number` keeps satisfying `DataSource`. It reaches **callers**. A
  full local type-check of every workspace type-check program found exactly six,
  in three packages, and each was red because a further declaration one layer in
  was itself wider than the protocol. All three are narrowed here, types only, with
  no runtime change and no coercion added at any call site:
  
  - `UserPreferenceRecord.id` and the `cachedRowId` it feeds
    (`@object-ui/data-objectstack`) are `string`. Module-local, not published —
    these rows are read back off the protocol, so the union was a claim the wire
    never makes.
  - `resolveRecordId`'s return type (`@object-ui/plugin-grid`) is
    `string | undefined`. Module-local, not published — it annotates `any`-typed
    row data, so the union was an assertion rather than a measurement.
  
  ## Migration — no `String(...)` at your call sites
  
  `RecordContextProvider` still **accepts** `string | number | null | undefined`
  and narrows it once, itself. A host that mounts a record with a numeric primary
  key therefore changes nothing: the conversion is paid at that injection
  boundary, typed, in one place. Consumers of `useRecordContext()` read a
  `string`.
  
  `DataSource` implementors are unaffected — TypeScript compares method parameters
  bivariantly, so an adapter that still declares `id: string | number` continues
  to satisfy the interface. What changes is the **caller** side: a call that passes
  a `string | number` to `dataSource.update` is now a type error. A backend whose
  primary keys are numeric maps them at its own adapter boundary rather than
  pushing the union through every caller.
  
  For `TransactionOperation`, the same rule applies one level up: build the
  operation record with a `string` id. If the id arrives from a numeric-keyed
  backend, convert it in your adapter — the one place that knows the backend's key
  type — rather than at each `recordOperation()` call. Nothing about this change
  alters what is sent over the wire; only the declarations moved.
- 0ce32d5: `UseNavigationOverlayOptions.onRowClick` now declares the modifier payload it
  has always been called with (objectui#9357).
  
  `useNavigationOverlay`'s `handleClick` invokes the caller-supplied `onRowClick`
  with two arguments — the record, and the optional `HandleClickModifiers`
  payload (`metaKey` / `ctrlKey` / `button`) a host needs to implement
  Cmd/Ctrl/middle-click. The option declared only the record, and `handleClick`
  carried a type assertion that widened the value at the call site so the code
  would compile. The second argument was therefore invisible on the one line a
  host reads, and a host that wanted it had to discover it from the
  implementation and then spell its own second parameter optional to stay
  assignable.
  
  The declaration now names both parameters and the assertion is gone.
  
  **Source-compatible in both directions, with one measured exception.** A
  one-parameter handler stays assignable to the widened signature (its extra
  parameter is optional), and a handler written against the widened signature was
  already assignable to the old one — measured on this change, both directions.
  
  **The exception, and the one class that has to change.** A handler passed
  *directly* to `useNavigationOverlay` whose second parameter is annotated
  *narrower* than `HandleClickModifiers` no longer type-checks. React's
  `MouseEvent` is the shape this hits in practice, because until now the payload
  was only discoverable from the implementation, so a host that wanted it wrote
  the annotation it saw arrive:
  
  ```ts
  useNavigationOverlay({
    objectName: 'account',
    // was accepted; now TS2322 — `HandleClickModifiers` is not assignable to
    // `React.MouseEvent`
    onRowClick: (record, ev?: React.MouseEvent) => { /* ... */ },
  });
  ```
  
  It compiled before only because the old declaration had no second parameter to
  check the annotation against. The parameter is checked contravariantly, so the
  annotation now has to *admit* `HandleClickModifiers`. **The fix is one line at
  the call site:** annotate the parameter `HandleClickModifiers` (exported from
  `@object-ui/react`), or drop the annotation and let it be inferred. Either way
  the handler keeps receiving exactly what it received before — this is a
  type-level change only, with no runtime behaviour attached.
  
  No caller *inside this repository* is in that class, and the repository's own
  type-check re-derives that on every run rather than this sentence asserting it;
  a host that reaches the hook through a view component's `onRowClick` prop is
  unaffected either way, because the prop's own declared type is what gets
  assigned to the option. The boundary is pinned as a `@ts-expect-error` row in
  this package's `useNavigationOverlay.onRowClickArity-9357` test, so it cannot
  move without a red check.
  
  What the widening buys everyone else: a caller who wants the modifier payload
  can now see, from the published type, that it is there.
  
  Scope note: this repairs the hook's own option. The pass-through props on the
  view components that feed it — `ObjectKanban`, `ObjectGallery`, the
  `plugin-kanban` renderer's `onCardClick`, and the `onRowClick` prop on the other
  view plugins — each still declare one parameter on their own published face;
  which spelling that family converges on is objectui#9357's open question and is
  not decided here.
- bbba098: **BREAKING if your code hands a numeric primary key to one of these four** — a
  record id at the `DataSource` boundary is a `string`, as `@objectstack/spec`
  declares every record door (objectui#9511, director batch #136 item 5 letter B).
  objectui#9333 narrowed `DataSource.update`; this entry closes three more doors,
  and narrows one consumer declaration — `UseViewDataResult.fetchOne` — that feeds
  `findOne`, the one door this entry leaves open.
  
  ## What changed
  
  - **`DataSource.delete`'s `id` parameter** (`@object-ui/types`) — was
    `string | number`, now `string`.
  - **`DataSource.bulkUpdate`'s `ids`** (`@object-ui/types`) — was
    `ReadonlyArray<string | number>`, now `ReadonlyArray<string>`.
  - **`DataSource.bulkDelete`'s `ids`** (`@object-ui/types`) — same narrowing.
  - **`UseViewDataResult.fetchOne`** (`@object-ui/react`) — was
    `(id: string | number) => Promise<T | null>`, now `(id: string) =>
    Promise<T | null>`. This hook hands its argument straight to
    `DataSource.findOne`, so the union it admitted was a claim the protocol never
    made. Exported from the package root, so it is a break for
    `@object-ui/react` consumers in its own right, not a knock-on.
  
  The `DataSource` docblock now states the rule once, for the whole interface,
  so a reader who meets one method does not have to re-derive it from another.
  
  ## Migration
  
  Convert where you build the id, not at each call:
  
  ```ts
  // before
  await dataSource.delete('accounts', row.id);            // row.id: number
  await dataSource.bulkDelete?.('accounts', selectedIds); // number[]
  
  // after
  await dataSource.delete('accounts', String(row.id));
  await dataSource.bulkDelete?.('accounts', selectedIds.map(String));
  ```
  
  Adapters that **implement** `DataSource` are unaffected: TypeScript compares
  method parameters bivariantly, so an adapter still declaring `string | number`
  continues to satisfy the interface. The narrowing binds callers.
  
  ## Disposition
  
  **Disposition: no ADR-0087 conversion — nothing authored moves.** The change is
  on the TypeScript call face only. No zod accept-set narrows, so every metadata
  document that validates today still validates, and there is no old shape for a
  conversion layer (ADR-0087 D2) to accept and rewrite, nor a metadata migration
  step (D3) to replay. What moves is what a numeric-primary-key host sends on the
  wire for these three methods: `'42'` where it sent `42`, consistently with
  `update`. The conversion lives in one typed place — the host's own adapter
  boundary — rather than in a union carried by every caller.
  
  Ships as `minor` per the launch-window convention: objectui's `major` is a
  cross-repo pin to `@objectstack`'s so that "same major means compatible" holds
  across the two repos (`scripts/check-changeset-no-major.mjs`), and objectui's
  own breaking changes ship as `minor` with the break named where it lands.
  
  ## One door is deliberately still open
  
  `DataSource.findOne` keeps `string | number` in this release. Narrowing it is
  ruled, but its remaining call sites split two ways. `ObjectForm` reads
  `ObjectFormSchema.recordId` and `DetailView` reads `DetailViewSchema.resourceId`
  — **authorable** metadata keys whose zod mirrors accept a number today, so
  narrowing either refuses author JSON that validates now. `DrawerForm`,
  `ModalForm`, `SplitForm`, `TabbedForm` and `WizardForm` read a `recordId`
  declared on their own exported schema face; those faces have no zod mirror and
  no registered node type, so they are TypeScript-only, like
  `UseViewDataResult.fetchOne` above — but they still cannot narrow first,
  because `ObjectForm` builds all five of them from its own authorable
  `ObjectFormSchema` and the refusal simply moves to those hand-off sites.
  
  So the choice is either an authoring-face narrowing or a reader-side
  conversion; neither is named by the ruling, and it is carried on objectui#9511.
  The reason is recorded in the `DataSource` docblock so it is not rediscovered.
- c3df43a: `ObjectGrid` takes `onNavigate` as a component prop, and the list channel's navigation callback takes one closed mode token, `'view' | 'new_window'`.
  
  `ObjectGridSchema.onNavigate`'s documentation told programmatic callers to pass it on `ObjectGridComponentProps`, where the grid's nine other callbacks live — but that interface did not declare it, so a host that followed the advice passed a function the grid never called, with no diagnostic. `ObjectGridComponentProps` now declares `onNavigate`, and the grid reads the prop first and `schema.onNavigate` only when no prop is supplied: when both are given, the prop wins. `onRowClick`, when supplied, still takes the row click before either.
  
  The callback's second argument is now `RecordNavigateAction`, a new type exported by `@object-ui/types`: the closed union `'view' | 'new_window'`, where `'view'` opens the record page and `'new_window'` opens it in a new browser tab. It is exactly what `useNavigationOverlay` emits, and the vocabulary `@objectstack/spec` 17.5.0 gives the react-tier `ListView` `onNavigate` callback. The same type now sits on all four faces of the channel — `ObjectGridComponentProps.onNavigate`, `ObjectGridSchema.onNavigate`, `ListViewSchema.onNavigate`, and `UseNavigationOverlayOptions.onNavigate` in `@object-ui/react` — where the three existing faces declared `action?: string` and two of them described it as `'view' | 'edit'`. No branch of the hook passes `'edit'`.
  
  **Clause-②: yes** — one prop added (`ObjectGridComponentProps.onNavigate`), one type exported (`RecordNavigateAction`), and three published callback types narrowed from `(recordId, action?: string) => void` to `(recordId, action: RecordNavigateAction) => void`. What a host has to change:
  
  - A handler you supply that is written `(id, action?: string) => …`, or with no second parameter at all, still compiles unchanged and receives exactly what it received before.
  - A handler whose second parameter is annotated with a union that leaves out `'new_window'` — the old documentation's `'view' | 'edit'` is the likely one — is now refused with TS2322. Annotate it `RecordNavigateAction` (or drop the annotation) and handle `'new_window'`, which a Cmd/Ctrl/middle-click and `navigation.mode: 'new_window'` already deliver.
  - Code that CALLS one of these callbacks itself must now pass the second argument, and it must be one of the two members.
- f0f4d6c: `SchemaRenderer` no longer spreads an authored `data` key as a React prop for blocks
  whose published `data` row is the `ViewData` OBJECT arm (objectui#9571, ruling
  objectui#8348 Q2-C, decision batch #136 item 3, maintainer 「同意」).
  
  **Behavioural, deliberately.** 「8348 以协议为准」 (batch #83) retired the bare-array
  `data` shorthand at the shared record-source ladder, but the key had a second carrier
  that the ruling did not reach and that outranked the first: `SchemaRenderer` spreads
  every non-metadata node key as a React prop, and `ObjectGrid` (`passedData`),
  `ObjectMap` (`dataProp`) and `ObjectGantt` each lift a `data` PROP with an
  unconditional `Array.isArray` ahead of the ladder. So an authored
  `data: [ …rows… ]` on `object-grid` / `object-map` / `object-gantt` still drew,
  end-to-end, after the ladder had refused it. AGENTS.md #0.1: one key, one honoured
  spelling — the tolerated second carrier is the defect.
  
  An authored `data` now reaches such a block only as `schema.data`, judged by the
  block's own row. In development the renderer says so, once per node: the ladder emits
  no runtime signal of its own, so without that warning the retirement would land as a
  page that quietly stopped drawing.
  
  **Unchanged, and refused on purpose.** The `data` PROP itself. Gating the prop on the
  arm (option B) was refused because that prop is how a host — `plugin-list`'s
  `ListView`, `ObjectView` — hands down rows it already fetched. A host rendering
  `<ObjectGrid data={rows} …/>` directly, or passing `data` through `SchemaRenderer`'s
  own props, still delivers those rows, and still outranks the authored key.
  
  Blocks on the ARRAY arm are untouched: `object-calendar`'s published row is
  `z.array(...)`, so its authored bare array is on-contract and keeps the prop seat.
  Every type the new reading does not list keeps today's behaviour verbatim.
  
  **Migration.** Author inline rows the declared way —
  `data: { provider: 'value', items: [...] }` — or keep using the deprecated
  `staticData: [...]` array, which is unchanged. Both were already the only spellings
  `os validate` and the save gate accepted.
  
  `@object-ui/core` gains one export, `recordSourceDataArmForType(type)`: which `data`
  arm a registered block type declares. It exists for the one consumer that cannot be
  handed the arm as a parameter — `SchemaRenderer`, which is generic over every
  registered type.
- 3939545: fix(react,app-shell): `usePageAssignment` picks a record page by `type` alone — `pageType` is a key `PageSchema` refuses
  
  `usePageAssignment` decided whether a page is a record page with
  `p.pageType ?? (p.type === 'record' ? 'record' : undefined)`. `PageSchema` is a
  `strictObject` that refuses `pageType` by name: it is one of the schema's
  declared aliases of `type`, so a page carrying it is a hard parse error that
  names `type` as the key to write. The first operand read a spelling no parsing
  page carries, and taught it onward as a live discriminator. The filter now reads
  `type` alone, and the comment beside it — which said the designer-side
  `record_detail` spelling was "still expressible in raw metadata" — is corrected:
  `PageSchema` refuses `pageType`, and `record_detail` left `PageTypeSchema`.
  
  **Behaviour change, for pages that do not parse.** The metadata cache the hook
  walks holds `/meta/page` bodies as served — the client runs no schema over
  them — so the hook can still be handed a page that carries `pageType`:
  
  - a page with `pageType: 'record'` and no `type: 'record'` is no longer picked;
    the object renders its synthesized default detail page instead;
  - a page with `type: 'record'` and some other `pageType` value is now picked.
  
  Every page that parses behaves as before, because none can carry `pageType`.
  
  The mirrors of the same discriminator move with it:
  
  - The navigation page picker (`isStaticPageOption`) reads `type` alone, as the
    hook does. A row carrying `pageType: 'record'` without `type: 'record'` is now
    offered as a static page, and a `type: 'record'` row is excluded whatever its
    `pageType` says.
  - `recordPageEnvelope` writes `type: 'record'` and no `pageType`. It used to
    write `type: 'page'` plus `pageType: 'record'`, a body `PageSchema` refuses on
    both keys. The helper has no caller in this repository.
  - The record-page preview in the page designer still reads `pageType` on an
    unsaved draft; its comment now says why, and that the runtime does not match
    on it.
- 7649f43: `SchemaRenderer` now applies the objectui#9571 authored-`data` strip to the legacy
  `props` alias bag as well, so all three authoring spellings of that key lose the React
  prop seat on the object arm (objectui#9758, decision batch #167 item 2, letter 剥,
  maintainer 「其他同意」).
  
  **The carrier this closes.** objectui#9571 removed an authored `data` from
  `componentProps` — the node's own non-metadata keys — for blocks whose published `data`
  row is the `ViewData` OBJECT arm. But `createElement` spreads the legacy `props` alias
  bag AFTER that strip, so an author who spelled the identical key
  `props: { data: [ …rows… ] }` kept the seat the ruling had just taken away, and
  `ObjectGrid` (`passedData`), `ObjectMap` (`dataProp`) and `ObjectGantt` still lifted it
  with an unconditional `Array.isArray` ahead of the shared ladder. The arm predicate was
  right; the corpus was one bag short. AGENTS.md #0.1: one key, one honoured spelling.
  
  Both bags now go through one helper with ONE arm reading, so the question is asked once
  instead of at two call sites that can drift apart.
  
  **Unchanged, and refused on purpose.** The `data` PROP itself — `SchemaRenderer`'s own
  React props are spread LAST and still win, which is how `plugin-list`'s `ListView` and
  `ObjectView` hand down rows they already fetched. Nothing else the alias carries moves:
  every other key under `props` is spread exactly as before, the objectui#5123 precedence
  between `props` and `properties` is untouched, a degenerate non-object `props` still
  contributes no keys, and blocks on the array arm or on no declared arm keep their
  authored `data` prop verbatim. There is no validator refusal here: whether the `props`
  alias exists at all is objectui#4795's pending question ②, which is the maintainer's.
  
  **Diagnostics.** The development warning objectui#9571 added now fires for the alias
  carrier too, once per node, naming the key, the arm and the spelling that works. Its
  objectui#6708 neighbour — the notice that a `props` bag was not read — stops naming
  `data` on this arm, because after this change both of its sentences are false for that
  key: it is no longer spread as a React prop, and the remedy it recommends
  (`properties: { data }`) loses the seat as well. It still names every other key the
  alias drops on the same node. The objectui#4795 unevaluated-expression scan is
  deliberately unchanged and still reports an authored `props: { data: '${…}' }`, because
  that value is still in front of a user.
  
  **Migration.** Author inline rows the declared way —
  `data: { provider: 'value', items: [...] }` — or keep the deprecated `staticData: [...]`
  array, which is unchanged. Both were already the only spellings `os validate` and the
  save gate accepted.
- 0c789a4: `useNavigationOverlay` stops reading the retired `navigation.view` key, and stops substituting an authored name for the navigation-MODE token
  
  `view.list.navigation.view` was removed in `@objectstack/spec` 17.5.0 under ADR-0049
  (enforce-or-remove). `useNavigationOverlay` was its one shipped consumer, and the spec's
  tombstone describes that hook by name: the authored value "was passed straight into the
  navigation-MODE argument of the console's `onNavigate`, where anything other than `edit`
  or `view` matched no branch, so the key selected nothing and could silently deaden the
  row click."
  
  The second argument of `onNavigate` is the navigation MODE token, not a view name. The
  hook read `const view = navigation?.view` and spent it at two call sites as
  `view ?? 'view'` — the no-config early return and the `page` branch — so an authored
  `{ mode: 'page', view: 'summary_view' }` dispatched `'summary_view'` into a slot hosts
  read against a closed `edit`/`view` vocabulary. An authored name did not SELECT a view,
  it SUBSTITUTED for the mode.
  
  Both call sites now pass the literal `'view'`, which is what every config WITHOUT the key
  already dispatched. No replacement route is wired into this hook, and no fallback belongs
  here: per the same tombstone, choosing what opens for a record is page assignment — assign
  a `record` page to the object and let `isDefault` pick the one that opens — while a list
  view's `navigation` block only decides HOW the detail is surfaced (`mode`, `size`).
  
  **Breaking for anyone who authored the key, and for anyone reading the hook's `view`
  member.** `NavigationOverlayState` no longer publishes `view`. It could only ever carry
  the retired key, so keeping it would publish a field that is permanently `undefined` —
  the same "declared, consumed, and wrong" state the retirement exists to end. Measured
  before removing it: zero readers of that member anywhere in this repository, against a
  lit control on its sibling members in the same command. Hosts outside this repository
  were not measured. Per this repo's version policy a breaking change ships as `minor`; the
  semantics are stated here rather than in the bump.
  
  Behaviour on the Console is unchanged, and that is the point rather than a caveat:
  `ObjectView`'s `onNavigate` already routed every non-`new_window` action to the same
  record-detail route, so the substitution was inaudible exactly where it was loudest in
  the metadata. Its comment claimed a custom name was "resolved by RecordDetailView from
  its own config"; no layer ever resolved a view by that name, and the comment is corrected
  with the read it described.
  
  Two existing pins asserted the substitution as intended behaviour and are INVERTED rather
  than deleted — `useNavigationOverlay.modeDefault` and `gridNavigationMembers-8071`, both
  keeping their authored `view` fixture because it is the one input the old and new
  implementations disagree about.
- ae61ad4: The console form now renders a refusal message the producer explicitly marked
  as user-facing, instead of always substituting a generic string
  (objectui#5210).
  
  An application's hook guards could not talk to their users. When a hook refused
  a write with 403, the form replaced the server's text with
  `form.noPermissionToSave` unconditionally — the recorded objectstack#3821 fix,
  which exists because a raw refusal body puts untranslated platform diagnostics
  (`FORBIDDEN: insufficient privileges to update showcase_private_note
  pi-TgoJ4_DM55Fqz`) in front of end users. The external report behind this change
  had 11 guards whose deliberate, localized guidance — which role owns the action,
  whom to ask — never reached anyone, and named the incentive that creates:
  returning 400 instead of 403 for permission failures, degrading the status
  semantics logs, monitoring and API consumers depend on.
  
  The maintainer ruling (2026-08-19) was a producer-side opt-in rather than a
  chattier 403 branch, and the platform half shipped as objectstack `79c46da90`: a hook
  marks its refusal text with `userMessage` at throw time. This is the consumer
  half.
  
  - `@object-ui/react` gains `declaredUserMessage(err)` — the one "is this
    marked?" read. It answers the marking verbatim, from the two places the
    adapter boundary parks the envelope (the error itself, where
    `@objectstack/client` lifts it, and `details`), and `null` for everything
    else.
  - The form prefers a marked message over both its generic strings, on ANY
    status — the marking is status-agnostic; 403 is where this was reported, not
    a fence the contract draws.
  
  **Unmarked refusals are unchanged**: a 403 with no marking still shows the
  generic `form.noPermissionToSave`, and the raw text still goes to the browser
  console only. objectstack#3821's protection is preserved by construction, not
  by re-guessing which 403 bodies are presentable — the mark and the marked text
  are one field, so no boundary that rewraps or substitutes `message` can promote
  platform prose into the user-facing channel, and platform code never sets it.
- ebce5a3: `object-grid` / `object-form` / `detail-view` resolve their data source the same way, and a block that resolves none says so
  
  The three object-bound blocks disagreed about how the data-source adapter reached
  them. `object-grid` and `object-form` were registered through wrappers that read
  it from `SchemaRendererProvider` context; `detail-view` was registered as the raw
  component, which reads a React `dataSource` prop. `SchemaRenderer` itself reads
  only context, so the two wirings were mutually exclusive: measured with correct
  keys in every cell, provider wiring gave the grid `find` 1 and the detail view
  `findOne` 0, and prop wiring gave exactly the reverse. Neither reported anything.
  
  All three now resolve the adapter through one rule — an explicit `dataSource`
  prop first, the provider context second. This is additive: `detail-view` keeps
  its prop form (and direct `<DetailView dataSource={…} />` callers are untouched),
  `object-form` gains a prop form it did not have, and `object-grid` no longer
  throws `useSchemaContext must be used within a SchemaRendererProvider` when a
  page has no provider.
  
  And the silence is over. A block in this family that resolves no adapter renders
  a **No data source resolved** panel naming the block, the object it was about to
  read, and the ancestor that injects the adapter — instead of a header-only grid,
  a field-less form card, or nothing at all. The check is opt-in per block, so a
  placement with inline rows, inline `customFields`, an inline record or an `api`
  endpoint is untouched.
  
  New from `@object-ui/react`: `useResolvedDataSource`, `NoDataSourcePanel`,
  `noDataSourceMessage`, and a `requiresDataSource` prop on `ElementDataSourceGate`.
- cac64b3: The spec-bridge's form-view input now accepts everything `@objectstack/spec`'s
  FormViewSchema accepts — three key types had drifted narrower, and one of them
  had inverted (objectui#5652).
  
  `bridges/form-view.ts` held a third hand-written description of the FormViewSchema
  contract, after the leaf (objectui#5542) and the two containers (objectui#5596)
  were converged elsewhere. A description nothing compares is one spec release from
  being a fork, and this one had already drifted on the keys that decide whether a
  legal document renders:
  
  - `FormSection.columns` refused the string spelling of a column count, which the
    contract admits and folds to a number in its own pipe. It is now the contract's
    type, and the bridge performs the fold — the `object-form` node's section
    declares `columns` as a number and its container indexes a grid-class map by
    it, so forwarding `'2'` handed every downstream renderer a value outside the
    type it declares.
  - `FormField.dependsOn` was declared `string[]`, which is the exact inverse of the
    contract: it admitted only the array arm the contract rejects, and refused the
    bare parent-field name that is the one configuration making `field-selector`
    and `dynamic-config` work (objectui#5040).
  - `visibleWhen`, on both fields and sections, was declared `string`, so the
    ADR-0089 expression object — the arm `evalFieldPredicate` reads — could not be
    described at all. Both arms now travel whole onto the node.
  
  A section's `fields` may also be a bare object-field name, the spec shorthand the
  list bridge already honours. The form bridge ran it through the object mapper
  instead, producing a field with no identity (`{ name: undefined }`) for the most
  ordinary section a form can declare; it is now forwarded verbatim, which is what
  the node's own `fields` slot admits.
  
  Each drift-prone key's type is now bound to the `@objectstack/spec` symbol that
  owns it rather than restated, so it cannot drift again, and the compile-time pins
  in `FormViewWidenedArms.test.ts` fail if a future edit restates any of them by
  hand. The documented subset itself is unchanged: the keys this bridge does not
  declare, including the retirement ledger it keeps, stay exactly as they were.
- bf28341: refactor(spec-bridge): retire the spec-bridge — `SpecBridge`, `bridgeListView`, `bridgeFormView` (#6366)
  
  Removed under the 2026-08-27 maintainer ruling on #6366 (Option A — remove, and
  for `SpecBridge` as a WHOLE, not just the form half), on the same criteria the
  17.0.0 entry used to remove `bridgePage` / `bridgeDashboard`: no runtime
  consumer, and a route that could not deliver a working result even in
  principle. The stage-1 measurement (2026-08-26, PM-verified) the ruling rests
  on:
  
  - **Zero consumers at every reachable endpoint** — no non-test caller in this
    repo, none in the sibling `objectstack` repo (which does not depend on
    `@object-ui/react` at all), and a GitHub-wide public code search returning
    hits only inside this repository. External npm-private hosts are
    unmeasurable from here; the ruling records fallback C (keep + document the
    boundary) should evidence of one ever surface.
  - **The bridged form route was structurally unable to work**: a bridged node
    carries neither `objectName` nor `customFields`, so `ObjectForm` takes the
    branch its own code labels "cannot proceed" and renders, in the registry
    wrapper's words, "a field-less card in silence". The only working host
    recipe (`{...node, objectName: '...'} as any`) existed solely inside the
    list bridge's integration tests and was documented nowhere.
  
  This knowingly reverses the 17.0.0 changelog line "The `list` and `form`
  bridges are unaffected and remain the live authoring path" — by maintainer
  ruling, on the same measurement criteria that entry itself applied.
  
  #5898's restored-key work on the form-view bridge (the
  `FormViewSpecConformance` suite and the spec keys it carried onto the bridged
  node) is **superseded by this removal, not fixed** — the route it repaired is
  gone. #6366's measured type-vocabulary asymmetry (a bridged field carrying
  `text` where the normalizer produces `field:text`) is likewise mooted rather
  than repaired.
  
  The suites pinning the removed route go with it — retirement of a route
  nothing travels, not quarantine: the seven suites under
  `react/src/spec-bridge/__tests__/`, and plugin-grid's
  `specBridgeColumnSpelling` / `specBridgeExportFormats` render-integration
  suites. `ObjectGrid`'s own column-spelling, export-gate and density behavior
  keep their non-bridge pins (`columnDeclaredSpellingOnly`, `exportGate`,
  `exportServer`, `rowHeightOffSpecBoundary`, and core's
  `normalize-list-view` suite).
  
  BREAKING CHANGE: the public exports `SpecBridge`, `bridgeListView`,
  `bridgeFormView` and the types `BridgeContext` / `BridgeFn` / `ObjectDefLite`
  are removed from `@object-ui/react`. There is no replacement translation
  layer — author `object-grid` / `object-form` nodes directly (the live path is
  `app-shell`'s `ObjectView`, which builds them from the object's own metadata),
  exactly as the 17.0.0 entry already directed for pages and dashboards.
- 83fe6e7: row predicates on runtime record surfaces resolve `record.*` only; the bare-field and `data.*` spellings are no longer bound
  
  Phase 2 of the row-predicate canon (objectui#5330, ruled 2026-08-20, option B;
  Phase 2 ruled 2026-09-02 and amended 2026-09-05). Until now a
  row predicate — `visible` / `disabled` / `enabled` on an action renderer, a row
  action, a `record:alert`, a `page:header` action, a conditional-formatting
  `condition` — bound the row three ways: canonical `record.status`, bare
  `status`, and `data.status`. The two non-canonical spellings are retired on
  every runtime record surface, in both evaluation tiers (`evalRowPredicate` /
  `partitionRowsByPredicate` in `@object-ui/core`; `usePredicateRecordContext` +
  `useCondition` in `@object-ui/react`) and for both dialects: a legacy
  `${data.x}` / `${x}` string on a row surface retires with the CEL spellings.
  
  **What a retired spelling does now: it faults, exactly as it already did on the
  server** (`buildScope({ record })` mounts exactly `['record']`, so `status` and
  `data` are unknown variables there), and each surface applies its EXISTING
  fault policy — no runtime detector, no "treat as absent" special case, no
  uniform override:
  
  - `evalRowPredicate` / `partitionRowsByPredicate` (row kebab, selection bar,
    `page:header` actions, conditional formatting): the caller's `fallback` —
    hidden / every row excluded / no style — reported once by the existing fault
    warning, which names the unknown variable (`Unknown variable: status`) and,
    on the fast route, carries the `record.` hint.
  - `useCondition` legs that opt into `throwOnError` (`action:button` and
    `action:menu` `visible`, `DeclaredActionsBar` `visible`): fail-closed —
    hidden on every row, reported once as `was hidden/disabled: its predicate
    threw — status is not defined`.
  - the non-throwing `useCondition` legs (`action:icon` / `action:group`
    `visible`, every `disabled` / `enabled`, `record:alert`): fail-soft — shown /
    greyed / enabled on every row, with the evaluator's own console line.
  - a host scope that carries its OWN `data` (app-shell's ambient `data: {}`) is
    left standing: `data.*` on a record surface then reads the host's object — a
    constant, silent `false` — which is what "no longer bound to the row" means.
  
  The Phase-1 deprecation warning is removed with the bindings:
  `warnNonCanonicalRowSpelling` and `resetRowPredicateCanonWarnings` are no
  longer exported from `@object-ui/core`. `detectNonCanonicalRowSpelling`,
  `ROW_PREDICATE_CANONICAL_ROOT` and the `NonCanonicalRowSpelling` type stay
  exported — the offline instrument for sweeping authored metadata.
  
  The layer rule is unchanged: `data` remains the canonical root on
  metadata-editing surfaces (ADR-0089 D3, `CANONICAL_ROOT_BY_LAYER`), and
  app-shell's metadata-admin `SchemaForm` / `predicate.ts` keep binding
  `{ data: row }` through their own evaluator.
  
  No stored-metadata survey, export or migration rewrite was run (the maintainer
  ruled the stored population out of scope, 「不考虑存量」); the Phase-1 warning
  period was the notice.
  
  Release note: Phase 1 (`d1ab06f0f` — the canon statement plus the warning) shipped
  in `@object-ui/core@17.6.0` (npm, 2026-08-24) although its changeset
  `.changeset/row-predicate-record-canon-5330.md` is still pending on `main`, so
  the next CHANGELOG section lists Phase 1 and this Phase 2 together: the warning
  it describes was live from 17.6.0 and is gone from this release on.
- d1ab06f: Row predicates declare a canon: `record.*`. The bare shorthand and `data.*` now
  warn once, and are unchanged otherwise.
  
  A row predicate (`visible` / `disabled` / `enabled` on an action renderer, a row
  scope, a `record:alert`) has bound the row three ways since objectui#4075 —
  `record.status`, bare `status`, and `data.status` — without any of them being
  declared the contract. The maintainer ruled that question on 2026-08-20
  (objectui#5330, option B), mirroring the objectstack#7917 option-② precedent for
  the identical renderer-tolerance shape: **the canon is `record.*`**, and the
  other two enter a deprecation window.
  
  The canon states the **server's** accept set, which was this card's first
  measurement and turns out to be strictly narrower than the renderer's. Measured
  against `@objectstack/formula@17.1.0`, the engine the server evaluates with:
  
  | spelling | server runtime | server authoring oracle |
  |---|---|---|
  | `record.status` | `{ ok: true, value: true }` | accepted |
  | bare `status` | `Unknown variable: status` | refused |
  | `data.status` | `Unknown variable: data` | **silently accepted** |
  
  `buildScope({ record })` mounts exactly `['record']` — `data` is never bound and
  the row's fields are never flattened to top level. The three-way binding is a
  client tolerance with no server counterpart, which is why the warning belongs on
  this side.
  
  `data.*` is the dangerous one, and the reason the warning exists. `data` is in
  `@objectstack/formula`'s `SCOPE_ROOTS`, so the server's bare-identifier oracle
  waves it through — that list is a deliberately generous "never faults" lint
  baseline, not the runtime accept set. A `data.*` row predicate therefore passes
  every authoring gate the platform has and then binds nothing at runtime: not an
  error, a constant `false`. A `visible` that is constantly false is a button that
  silently never appears — the objectui#4075 fail-closed signature.
  
  What ships:
  
  - `@object-ui/core` exports `detectNonCanonicalRowSpelling`,
    `warnNonCanonicalRowSpelling`, `resetRowPredicateCanonWarnings` and
    `ROW_PREDICATE_CANONICAL_ROOT` from a new `evaluator/rowPredicateCanon.ts`,
    which carries the canon statement and the measurement.
  - Both evaluation tiers report once, in dev: `evalRowPredicate` (core) and
    `useCondition` (react, for bags bound by `usePredicateRecordContext`).
  - Detection reuses the server's own oracles (`collectCelRootIdentifiers`,
    `firstUndeclaredReference`) rather than a regex, so no second dialect
    judgement is invented client-side.
  
  **No spelling is removed and no behaviour changes.** Every predicate that
  resolved before resolves now — the ruling defers removal behind a stored-metadata
  survey, and the warning is what makes that survey possible (ADR-0078: a
  tolerance nothing ever reports can never be retired).
  
  The deprecation is scoped to the **runtime record layer**. `data` remains the
  canonical root one layer over, in a metadata-editing form (ADR-0089 D3
  `CANONICAL_ROOT_BY_LAYER`), and the detector stands down there.
- dba7d84: New export: `useSettledSchema` — the settled-schema RESOLUTION half shared by
  `ObjectKanban` / `ObjectView` / `ObjectCalendar`'s fetch-gate hand copies
  (objectui#6482, maintainer ruling Option A). It tracks whether an object's
  definition has finished resolving FOR THE KEY THE CURRENT RENDER IS ASKING
  ABOUT, returning `{ ready, def }` from one piece of internal state so `ready`
  and `def` can never be observed inconsistently and a stale key can never read
  as ready — the structural fix for the `ObjectTree` defect (objectui#6481)
  where a definition and a separate, one-way-latched "settled" boolean could
  disagree for a render after the object changed.
  
  Gate PLACEMENT — which effect branch actually waits on `ready` — stays a
  per-component decision and is not part of this hook; see the hook's own doc
  comment. Existing hand copies are migrated on their own subsequent cards, not
  by this change.
- c86185e: Bind `record` into the node-level visibility evaluator, and stop a hoisted
  `properties.visible` swallowing a declared `visibleWhen`.
  
  `@objectstack/spec` has declared since ADR-0089 that a page component's
  `visibleWhen` binds the row — `ui/page.zod.ts`: *"Binds `record`,
  `current_user`, `page.<var>`"*. `SchemaRenderer` bound no `record` at all. Its
  evaluator was built from the ambient predicate scope, `data: dataSource` (the
  connector **adapter**, not the row) and `page: pageVariables`; the row lives in
  `RecordContext`, which that evaluator never read.
  
  Because the surface is fail-soft, a `record.*` predicate did not misfire — it
  resolved to **shown**. Both polarities of the same predicate returned the same
  verdict, so a visibility gate silently did not gate, on every block on every
  record page. Measured on `record:alert`, `record:path`, `page:card` and
  `element:text`.
  
  Three changes, all in `SchemaRenderer`'s evaluation memo:
  
  - **`record` is bound**, as the `record` root only — the three roots the
    describe promises and nothing more. Not as bare fields, and never over
    `data`, which is what `${data.*}` in a props bag resolves against. Bound
    conditionally, so "no row" binds nothing rather than shadowing a `record` a
    host supplied through the ambient scope.
  - **`visibleWhen` is tested before `visible`.** The memo hoists `properties.*`
    onto the node, so a node carrying `properties.visible` short-circuited the
    declared node predicate — the one key the spec tells authors to write was the
    one key that could be silently ignored. The two deprecated aliases
    (`visibleOn` / `visibility`) deliberately keep their rank: they normalize into
    `visibleWhen` at parse, so a spec-parsed page never reaches them.
  - **An unresolvable predicate is loud** (dev builds). Fail-soft answered "this
    predicate is broken" and "this predicate said yes" with the same word. The
    verdict is unchanged on every path — `evaluateCondition` already returned
    `true` for every unevaluable predicate, including the non-negated `hidden` /
    `hiddenOn` legs where that `true` means HIDE — so only the silence moved.
  
  **Behaviour change, stated plainly:** a shipped page whose node-level
  `record.*` predicate was previously inert now evaluates. A block that was
  permanently visible may begin to hide — which is the point, but it is a verdict
  change, not a no-op. `properties.visible` is unaffected in verdict: an
  in-tree census found **zero** node-level `record.*` predicates on page
  components, so nothing in this repository changes verdict.

### Patch Changes

- 7b10bef: `ElementDataSourceGate` now reports a saved view's refused row cap on the renderer path
  (objectui#10015).
  
  objectui#9928 made `@object-ui/core` drop a saved view's `pagination.pageSize` (or legacy flat
  `limit`) when the contract refuses it: `0`, a negative, or a fraction. The drop is correct, but on
  the renderer path it removed the author's only diagnostic. The node's cap went from `0` to absent,
  and the consuming renderer treats an absent key as "not a mistake". The gate had never reported a
  VIEW cap, so nothing reported it at all.
  
  The gate now emits `elementDataSourceRefusedLimitMessage`, the same sentence `ViewDataProvider`
  already uses on the path with no renderer. It is emitted once per declaration, from an effect and
  never from render, on the same `console.warn` channel. It fires only when the refusal changed what
  the block receives: the block reads a row cap, the binding declares no `limit` of its own, and the
  component's own cap is not a usable one. A view with no cap, a usable view cap, a usable component
  cap, a binding `limit`, or a block with no row cap stays silent. It never fires together with the
  gate's existing displaced-cap message (objectui#9899), because that message needs a usable cap to
  have been written and, with the view's cap refused, the only one left is a binding `limit`. No
  wire value changes.
- 0aacecc: `useRecordSearch` no longer keys its search effect on the identity of the
  caller-supplied `getDisplayName` option (objectui#10044).
  
  The resolver is read only inside a run, to label hits; it never decides whether a
  run happens. It was nevertheless the last entry of the search effect's dependency
  list, and that effect's cleanup clears the pending debounce timer. A caller passing
  the obvious spelling for an optional callback, an inline arrow, handed the hook a new
  function on every render, with two opposite results: a parent re-rendering faster
  than `debounceMs` (250 ms by default) never searched at all, and a parent re-rendering
  sparsely issued a second, identical request after the first had gone out. This is
  the dependency AGENTS.md §5 commandment #10 bans.
  
  Each run now reads the resolver of the latest render through a ref, so an inline
  resolver is safe. A swapped resolver labels the hits of the next run; results already
  shown keep their labels. The option's name, type and default are unchanged.
- 162621b: `useSettledSchema` no longer republishes an EQUAL definition as a new object,
  so swapping the adapter on a record-bound view costs ONE record query instead
  of two.
  
  The hook refetches `getObjectSchema` whenever the adapter identity changes, and
  every consumer its doc comment instructs — `ObjectGantt`, `ObjectCalendar`,
  `ObjectView`, `ObjectTimeline`, `ObjectGallery` — keys its record fetch on the
  returned `def`, which is what `AGENTS.md` §5 commandment #10 tells a consumer to
  do (key on the payload, never on a memo identity). The producer half of that
  same sentence is what this fixes: a byte-identical answer arriving as a fresh
  object re-fired every one of those fetches, and the duplicate query carried the
  same `$expand` set as the one before it. Measured first-hand on `ObjectGantt`
  with an instrumented adapter, with a control swap in the same command; the
  counts, and the control that makes them a discrimination rather than a counting
  artefact, are asserted by
  `packages/react/src/hooks/__tests__/useSettledSchema.equalPayload-10106.test.tsx`
  (objectui#10106).
  
  A definition that genuinely CHANGED across the swap still publishes a new
  object and still re-queries — that case is pinned in the same file, because
  "fetch less" would have been the wrong repair.
- 2ad3671: Correct the read rule in the `InlineEditContextValue.draft` doc comment (objectui#10466).
  
  It told hosts to read a field's live value as `draft[name] ?? data[name]`. That read
  falls back to the saved value when the draft value is `null` or `undefined`. A field the
  user emptied is an own draft key with an empty value, and so is a single select or radio
  emptied by a cascade clear, which stages `null` since objectui#10291. A host that followed
  the comment showed the value the user had just removed, and handed it back to an option
  widget that pruned it, which pruned it again on every render (the loop objectui#7190 fixed
  on the highlights strip).
  
  The comment now teaches the own-key read: take the value from the staged record
  `{ ...data, ...draft }`. An own draft key wins even when its value is empty
  (`null`, `undefined`, `''`), and the saved value is read only when the key is absent. The
  comment ships in `dist` typings and is what a host author sees on hover. No runtime
  behaviour changes. A source-text pin keeps the comment from teaching a fallback read again.
- 3d614ea: fix(react,app-shell): a search hit's label no longer prints a field the viewer may not read (objectui#10500)
  
  The ⌘K command palette, the full-page search results and the `global:search`
  block label each record hit with `getRecordDisplayName`, and `useRecordSearch`
  handed that resolver the record as served. On a backend that does not strip
  denied fields, a `titleFormat` token or a declared `nameField` that the loaded
  permission policy denies therefore printed as the hit's label.
  
  `useRecordSearch` takes a new optional `fieldReadPolicy` option: pass
  `usePermissions()` from `@object-ui/permissions`. Once that policy is loaded,
  each hit is labelled from its record with the denied fields removed, before any
  `getDisplayName` resolver reads it. The record id is always kept, so the
  `Record #` id floor still applies. A denied field is read exactly as an absent
  one, and the label falls through to its next source, the label ObjectStack's
  `FieldMasker` row already yields. When the policy finishes loading, a search
  that is already showing runs again, so hits labelled before the policy loaded
  are relabelled. The three app-shell search surfaces now pass the policy. The
  record title (objectui#10434) and the lookup option label (objectui#10411)
  follow the same rule.
  
  Without the option, before a policy loads, and with no permission provider
  mounted, nothing is removed and every label is unchanged. A title the server
  computed for a `searchAll` hit is still shown as the server sent it, and a
  hit's `raw` payload is still the record as served.
  
  This is defence in depth: ObjectStack's `FieldMasker` already removes the
  fields a user may not read from the rows it serves, so on that backend no
  label changes.
- 9a5f998: `@object-ui/core` exports `withoutDeniedFields(record, policy, objectName, extraKeep?)`, the field-read rule for one record: the record as the viewer may read it on `objectName` (objectui#10594).
  
  Every field the loaded `policy` denies is removed, which leaves the row ObjectStack's `FieldMasker` already serves. `id`, `_id` and any key in `extraKeep` (a declared id field) are never judged. Before a policy loads, with no policy, with no object name, or for a value that is not an object, the record comes back as it is; when nothing is withheld the SAME object comes back. `policy` is structural (`isLoaded` and `checkField`), so `usePermissions()` from `@object-ui/permissions` satisfies it and `@object-ui/core` gains no dependency.
  
  The renderer's display surfaces that each carried a module-private copy of this rule now call the export, with no change in what they draw:
  
  - `@object-ui/fields`: the lookup cell's name and the user cell's name and avatar (the package entry), and the lookup editor's option label and search chip avatar (`LookupField`).
  - `@object-ui/react`: `useRecordSearch`'s hit label under `fieldReadPolicy`.
  - `@object-ui/app-shell`: the record page's title and the row its blocks read (`RecordDetailView`).
  - `@object-ui/plugin-detail`: `DetailView`'s header title and `record:details`' title dedupe. The package-internal `withoutDeniedFields` module is removed; it was never a package export.
- 256b4c9: A filter refused as malformed (`INVALID_FILTER`) no longer throws out of render or out of a click
  handler at the sites that merge filters there. That holds whether this layer's filter converter
  refused it or, at the drill seam, the spec's own `parseFilterAST`. Each site now surfaces the
  refusal the way its siblings already do (objectui#10789). The filter stays **refused**: nothing
  that was refused is accepted, and no site falls back to "no filter".
  
  - **`ElementDataSourceGate` / `useElementDataSource`** (`@object-ui/react`): the gate's merge of
    the component's `filter` with the composed binding, and the merge of a saved view's filter
    with the binding's own, lowered through the throwing converter inside render. A refused
    filter from either now makes the binding `missing` with a new optional `filterRefusal` on the
    result (`error` carries its message). The gate then draws, in place of the block, the
    malformed-filter notice the wrapped blocks draw: `view.malformedFilter`, naming the refused
    operator or field. `element:record_picker`, which reads the same hook, shows its
    configuration-error panel with the refusal.
  - **`PeoplePicker` / `RecordPickerDialog`** (`@object-ui/fields`): the recents merge and the
    dialog's `mergedFilter` lower through `toFilterNodeSafely`; a refusal is shown in the picker's
    existing error state and no query runs without the filter.
  - **Drill-downs** (`ObjectChart`, `ObjectPivotTable`, `DatasetWidget`, `DatasetReportRenderer`):
    a widget or report filter refused at the drill seam made the drill click throw. The converter
    refuses some (a spec `$not`, say). The spec's `parseFilterAST` refuses others, such as a scalar
    on a list operator in either dialect: `[['stage', 'in', 'won']]` or `{ stage: { $in: 'won' } }`.
    The drill is now not opened or emitted (never with the scope dropped), and the refusal is logged
    with `console.warn`, naming the operator. `composeDrillFilter` (`@object-ui/core`) now throws
    one refusal type: the spec's `INVALID_FILTER` error is re-raised as a `FilterOperatorError` with
    its message and the same `INVALID_FILTER` / 400 envelope, and any other error passes through
    unchanged.
  - **`ListView` export** (`@object-ui/plugin-list`): the server export builds its filter inside
    its `try`, so a refusal is named in the export menu instead of escaping the click.
  - **`convertFiltersToAST`** (`@object-ui/core`): an `$or` member that is the TRUE identity no
    longer stops the members after it from being read. `{ $or: [{}, { a: {} }] }` is now refused
    like `{ $or: [{ a: {} }, {}] }` already was, instead of answering TRUE (every row); a TRUE
    disjunct beside members that lower still absorbs its `$or`.
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
- 0645133: fix(react): one Ctrl+Z undoes one record write, and Ctrl+Z inside a text field is the field's own undo (objectui#11081)
  
  What a user saw: with two or more undoable actions behind them, one Ctrl+Z in the
  console reverted SEVERAL saved record writes, one per mounted `useGlobalUndo`
  (every console route mounts at least two), with a toast for each. And pressing
  Ctrl+Z while typing in a field did not undo the typing: the keypress was
  `preventDefault`ed and the last saved record write was reverted instead.
  
  What changes: however many `useGlobalUndo` instances are mounted, one `window`
  `keydown` listener serves them, so one Ctrl+Z (or Ctrl+Shift+Z) pops at most one
  operation, and exactly one instance answers it: the longest-mounted live one,
  whose data source runs the write and whose toast shows. That is the instance that
  already answered whenever a single operation was stacked, so a single Ctrl+Z
  behaves as before. A keypress whose target is an `input`, `textarea`, `select` or
  contenteditable region is left alone: nothing is popped, the default is not
  prevented, and the browser's own undo runs in the field. The listener is removed
  when the last instance unmounts.
  
  Unchanged: the hook's signature and return shape, and a toast's Undo button, which
  still runs through the instance that raised the toast.
- a8b9889: A related list inside a record now places its child object's `record_related` actions on each row (objectui#11270; the renderer half of the enforce answer on objectstack-ai/objectstack#20937).
  
  The spec declares the action location `record_related` ("actions on a related list section inside a record"), and nothing in objectui read it, so an action placed only there rendered nowhere. Triage read the location as row placement, scoped to a parent record: `list_item` shows on the child's rows wherever the child is listed, and `record_related` shows on them only in a related list inside a parent record.
  
  - **The host bridge** (`RelatedRecordActionsBridge`, `@object-ui/app-shell`) puts the child object's `record_related` actions in each row's action menu beside its `list_item` actions, in the child's declared order, when a parent record is in scope. An action that declares both renders once. The child object's own list view still reads `list_item` only, so a `record_related`-only action does not appear there.
  - **The authored `actions` channel** on `record:related_list` (`@object-ui/plugin-detail`) accepts an id whose action declares `record_related` and places it in each row's menu. The refusal notice for an id that cannot be placed now names the three related-list locations: `list_toolbar`, `list_item` and `record_related`.
  - **The action designer's preview** (`@object-ui/app-shell`) draws a `record_related` action on the rows of a list, with the frame `list_item` uses. It used to draw it as a button in a section header, which is not where the console places it. `record_section` keeps its section-header frame.
  - `@object-ui/react`: the `RelatedRecordHandlers.rowActions` doc comment names both row locations. No code change.
  
  ⚠️ Behaviour change: a child action that declares `record_related` now shows on its related-list rows inside a record, where it used to show nowhere.
- b654d4e: `toRenderableSchema` declares its parameter as `SchemaNode` (objectui#11479).
  
  The parameter used to spell out `SchemaNode`'s members one by one. It now names the union itself, so it follows `SchemaNode` instead of keeping a hand-written copy of it. Nothing it accepts changes today: the two spellings are the same type, and the function's return type and behaviour are untouched.
  
  ⚠️ **Dated note, 2026-10-02 — the parameter narrows with `SchemaNode` — objectui#11466.** At this change the parameter's two spellings were the same type and nothing it accepted changed; now, later in this same release, `SchemaNode`'s object arm is `DeclaredNode`, the union of the declared node types, so the parameter follows it and no longer accepts a value typed `BaseSchema`. That is the point of naming the union instead of copying it. The rest of this entry is kept as the reading of this change.
- 546ddf7: A node-gate visibility predicate that FAULTS now says so in a production build, once per
  distinct predicate source (objectui#6038, maintainer ruling 2026-08-25, option B: "the
  silence is no longer an accepted property"). Observability only — no verdict moves.
  
  `SchemaRenderer`'s visibility chain is fail-open: a predicate that cannot be evaluated
  resolves to the same answer as one that said yes, so a gate that stops biting looks
  exactly like a gate the author got right. The diagnostic that names it (objectui#5454 /
  objectui#5687) sat behind a `__DEV__` short-circuit, because the only fault-detection
  channel available was `throwOnError`, and on the CEL branch `evaluateCelCondition`
  implements that by evaluating **twice** — too expensive to ship for every predicate of
  every node.
  
  **What production actually printed before, measured per dialect on the built evaluator**
  — the card's premise held for one dialect of three, and the other two failed in opposite
  directions:
  
  | dialect | production console, before |
  |---|---|
  | bare string | **nothing** |
  | `{ dialect: 'cel' }` envelope | one generic line, deduped per source |
  | `${…}` template | one generic line **per evaluation**, never deduped |
  
  So the dialect objectstack#11254 measured a live gate breaking on was the silent one,
  while the template dialect was the console flood the ruling's rate-limit clause exists to
  prevent.
  
  **The fix reports the fault the evaluator already detected, at the same number of engine
  calls.** `EvaluationOptions.onFault` is a new passback on `@object-ui/core`'s
  `ExpressionEvaluator`: every fault site is already inside a `catch`, or already holds the
  canonical engine's failure reason, so nothing is evaluated twice. It mirrors, one layer
  up, the seam `FieldPredicateDiagnostic` already documents (`warn: false` plus a reason
  passback), and supplying it transfers reporting to the caller so one fault stays one
  line. Pinned: the CEL branch performs the same number of record reads with the passback
  as without it, and strictly fewer than the `throwOnError` probe.
  
  `SchemaRenderer` passes it in production and reports through the **same** reporter the dev
  branch uses — same message, same severity, same dedupe `Set`, same key. Development and
  production now print the identical line for the identical fault; the `__DEV__` gate no
  longer decides *whether* a fault is reported, only *how* it is detected.
  
  `page:tabs` item-level `visibleWhen` (`@object-ui/components`) is covered by the same
  reporter and the same rate limit. It swallowed the identical fault under a different
  helper, and it was the worse of the two: the node gate at least reported in development,
  while a faulting item predicate was silent in *both* builds on a gate whose false verdict
  removes an entire tab, header and panel.
  
  **Rate limit:** deduped per (node type, gate key, predicate source) — never per render and
  never per node instance. A two-hundred-row list of one broken predicate is one line; a
  second distinct predicate source still gets its own line. Both halves are pinned, because
  a test that asserts only "a warning was emitted" is equally green on an implementation
  that emitted fifty, and one that asserts only "exactly one" is equally green on an
  implementation that suppresses everything.
  
  **Not changed by this card, deliberately:** the fail-open semantics themselves; the
  objectui#5687 adapter-only `data.*` report, which stays development-only under its own
  2026-08-22 ruling (that path is not a fault — the predicate evaluated perfectly, against
  the wrong object); and the `features` root on `/forms/:name`, which objectui#6262 settled
  by refusing it in form-view predicates rather than wiring it.
  
  `reportUnresolvableVisibilityPredicate`, `formatUnresolvableVisibilityMessage`,
  `UNRESOLVABLE_VISIBILITY_PREFIX` and `__resetVisibilityPredicateWarnings` are now exported
  from `@object-ui/react` so every surface that evaluates a node `visibleWhen` shares one
  reporter and one rate limit — a second copy would mean a second dedupe `Set`, and one
  authored predicate would be entitled to one line per package instead of one line.
- 22ba927: `SchemaRenderer` now hands a stable `schema` object identity to a node carrying
  `responsiveStyles` (objectui#6270).
  
  ADR-0065 scoped styles make a styled node take a branch that rebuilds the schema
  object to merge the generated scope class into `className`. That rebuild was not
  memoised, so it allocated a new object on **every** `SchemaRenderer` render — even
  when the `evaluatedSchema` memo directly above it held. Every downstream renderer
  that memoises on `[schema]` therefore saw a fresh identity and re-ran: concretely
  `ObjectMap`'s `dataConfig` and `mapConfig`, and the whole marker cascade below them
  (`markers` → `filteredMarkers` → `clusteredData` / `markerBounds` → `initialViewState`).
  Only nodes on that branch were affected — a plain node was already handed the
  memoised `evaluatedSchema` itself.
  
  The trigger is narrower than "has `responsiveStyles`" reads: it needs one of the four
  sized breakpoint keys (`large` / `medium` / `small` / `xsmall`). A `{ base: … }` shape
  never took the branch and was never affected.
  
  The scoped-style computation now lives in a `useMemo` keyed on
  `[evaluatedSchema, autoStyleId]`, hoisted above the renderer's early returns — its old
  use site sits after them, so a memo written there would have been a conditional hook.
  A genuinely changed `className`, interpolated value or breakpoint still produces a new
  identity, so nothing goes stale.
- 5967be0: Extends objectui#5687's adapter-only `data.*` constant-predicate diagnostic — a node-gate
  predicate that evaluates perfectly, against the wrong object, because at the node tier
  `data` is the data-source adapter, not the row — to the `disabled` / `disabledOn` gate
  (objectui#6504, maintainer ruling 2026-08-27 option A).
  
  A node written `{ "type": "button", "disabled": "data.status == 'locked'" }` evaluates
  cleanly (no fault, so objectui#6445's fault reporter correctly stays silent), and on the
  constant's other polarity (`data.locked == null`, `!data.assignee`, or an adapter that
  answers nothing) hands the gate a constant `true` that greys the control out on every row,
  in every build, with nothing on the console. This leg now names it, in development only —
  option C (always-on) was excluded, outside the #5687 precedent.
  
  The copy is new, not reused: the visibility leg's sentence ("a constant `false` hides the
  node on every row") is written about the opposite polarity and would be false on this gate.
  The enablement leg's own sentence names the constant-`true` direction — the control renders
  DISABLED, greyed out, indistinguishable from a gate the author meant to close.
  
  Both legs carry the same dissolution pointer: this diagnostic — visibility AND enablement
  together — dissolves when objectui#5330's `data.*` deprecation window closes.
  
  Dev-only, no verdict change, no interpolation change, no published type widened (the new
  `AdapterOnlyPredicateGateKind` type and the new prefix constant are module-internal, not
  re-exported from the package entry — matching objectui#5687's own symbols, which never were
  either).
- 12402a9: Drop the undeclared object-level `titleField` from the object page's five
  remaining view-config seams, and from the record-search memo key
  
  `ObjectView` resolves a title field for seven view kinds. Two of them —
  calendar and gantt — already read `viewDef.<kind>?.titleField || 'name'`. The
  other five (timeline, kanban, map, gallery, tree) carried a three-rung chain
  with `objectDef.titleField` in the middle, so one file answered the same
  question two different ways. This converges the five on the shape the two
  siblings already had; it is a convergence, not a removal.
  
  The middle rung could never fire for legal metadata. `@objectstack/spec`'s
  object schema is a `strictObject`, so
  `ObjectSchema.safeParse({ …, titleField: 'x' })` is rejected with
  `unrecognized_keys` — the same issue code a nonsense key gets — while
  `nameField`, `displayNameField` and `titleFormat` all parse (measured against
  `@objectstack/spec@17.2.0`, the dist this repo installs). objectui#6531
  established that measurement and dropped the twin read inside
  `getRecordDisplayName`. Reading a key no producer can ship is the
  consumer-side alias AGENTS.md Commandment #0.1 bans.
  
  Behaviour for every legal config is unchanged, and both directions are pinned:
  a view that declares its own `titleField` still wins on every kind, a view that
  declares none still floors at `'name'`, and an object carrying the
  contract-rejected key is now honoured by no kind. Re-pointing the middle rung
  at the declared `nameField` was considered and rejected: it would have added a
  rung calendar and gantt do not have — increasing the divergence — and, unlike
  this change, it would have altered behaviour for legal configs.
  
  `useRecordSearch`'s candidate signature — the memo key that decides when the
  cross-object fanout re-runs — appended `o?.titleField ?? ''` to every entry.
  Because no legal object definition can carry the key, that half was permanently
  `''`: a constant suffix in a cache signature, and the last thing in the repo
  that read as evidence some producer supplies it. The signature is now the object
  name alone, which is the only field of an object definition the effect actually
  consumes. Change detection is unaffected — a changed candidate name still
  re-runs the fanout, and a new array with identical content still does not.
- 46b9bc9: A `props` config bag on a component-renderer node is now named at render
  instead of dropped in silence (objectui#6708).
  
  `SchemaRenderer` HOISTS every `properties.*` value onto the node, so a key
  written under `properties` is a real value on `schema.<key>` by the time a
  renderer destructures it. `props` — the annotated legacy alias of the same bag
  — is NOT hoisted: it is evaluated and then spread as React props on the created
  element. A renderer declared as `({ schema })`, which is the normal shape for
  the component renderers, therefore never sees it. The `element:*` family is the
  exception: its `readProps()` merges `{ ...schema.props, ...schema.properties }`,
  so the same spelling is honoured there.
  
  Every gate accepts the `props` spelling — `BaseSchema` is `.passthrough()` with
  `[key: string]: any` — and the docs call it a supported alias, so nothing
  between the author and the screen said a word. Re-measured on `faac0d935`
  through the real `SchemaRenderer` with a probe that records both channels:
  
  | node | React prop `data` | `schema.data` |
  |---|---|---|
  | `props: { data: "${data.customers}" }` | the evaluated array | absent |
  | `properties: { data: "${data.customers}" }` | the evaluated array | the array |
  
  Same key, same value, one envelope apart. The expression is evaluated on both
  legs, so this is a dropped value rather than an unevaluated one. Read through a
  real `data-table` (objectui#6665's four-leg pin) the same pair renders
  `No results found` against the two rows.
  
  The diagnostic's level and dedupe were chosen from a census, which the ruling
  made a precondition. Every JSON document, every `json` fence in every
  `.md`/`.mdx`, and every TypeScript object literal in the repo was walked for
  nodes carrying both `type` and `props`: 39 such nodes, 22 of them on
  component-renderer types, and 19 of those 22 are test fixtures exercising this
  shape on purpose. The authored, non-test corpus holds 5 — three of which are
  deliberate counter-examples in the skills guides. Nothing floods, so the level
  is not softened for volume; the dedupe is keyed on the MESSAGE rather than on
  the schema object, so a metadata generator emitting one wrong envelope across
  many nodes still gets one line while two genuinely different nodes get two.
  
  `console.warn`, matching objectui#6575 and objectui#6665 — the two prior
  instances of this exact "you declared something and the renderer dropped it"
  shape — rather than the `console.error` its neighbour at this tier uses for a
  raw `${...}` placed verbatim in front of a user. Nothing is placed here; a
  value is dropped.
  
  No behaviour change, which is the entire reason this arm was chosen. Hoisting
  `props` to parity with `properties` was refused at ruling: it would weld the
  legacy alias in as a permanent second spelling, against this repo's
  alias-retirement direction. Refusing the key at parse stays blocked on the
  `.passthrough()` ceiling (objectui#5155 / objectui#6269). What every renderer
  receives is pinned byte-for-byte against a reading captured on the tree before
  the diagnostic existed. Nothing is added to the published surface either — the
  predicate, message builder, prefix constant and test-only reset are
  module-internal and are not re-exported from the package entry, matching
  objectui#6575's own symbols. The trap stops being silent; it does not stop
  being a trap.
- d47de51: `useSchemaPersistence` no longer writes its adapter ref during render
  (objectui#6745).
  
  The hook keeps the live adapter in a ref so `save`/`load`/`list`/`remove` can be
  created once and still reach the newest adapter at call time. That ref was
  written in the render body:
  
  ```
  const defaultAdapter = useRef(createLocalStorageAdapter());
  const adapterRef = useRef(adapter ?? defaultAdapter.current);
  adapterRef.current = adapter ?? defaultAdapter.current;   // during render
  ```
  
  which `react-hooks/refs` flags on three counts. A render React discards or
  replays — StrictMode, a Suspense retry, a concurrent interruption — still
  performed that write, so a save could be routed through an adapter belonging to
  a render that never committed.
  
  The write now happens in `useInsertionEffect`, and the default adapter comes
  from `useMemo` instead of a ref read during render.
  
  **Timing is preserved for every legal call site.** Insertion effects run in the
  mutation phase — before every layout effect in the tree, before paint, and
  before any event handler can fire — so a changed `adapter` prop is in place
  before anything that may legally invoke these methods can observe it. This is
  deliberately *not* `useEffect` (which lands after paint) or `useLayoutEffect`
  (a child's layout effects run before its parent's); either would route a call
  made earlier in the same commit to the previous adapter. The only window that
  changed is a read during the render phase itself, which no legal consumer has:
  `save`/`load`/`list`/`remove` are side effects and are never callable during
  render.
  
  Also fixed in passing, on the same lines: `useRef(createLocalStorageAdapter())`
  invoked the factory on **every** render and discarded all but the first result.
  The `useMemo` runs it once. The adapter is a stateless facade over
  `localStorage` and its identity is never exposed, so this is unobservable
  beyond the saved work.
  
  No API, signature or observable behaviour change for any supported call site.
- 3fe6463: `SchemaRenderer`: a non-object `props` bag is no longer object-spread into
  indexed React props (objectui#6752).
  
  A node written `{ type: 'card', props: 'not-a-bag' }` reached `createElement`
  carrying nine React props named `0` through `8`, one per character, because
  `{ ...'not-a-bag' }` enumerates a string's character indices. Nothing threw and
  nothing was logged, so the symptom — a component handed nine props it never
  declared — sat a long way from the `props` value that caused it. Measured
  through the real `SchemaRenderer`; the in-repo corpus has no such node today, so
  this is a latent shape rather than a live failure.
  
  The canonical `properties` branch already carried the wider guard. Its comment
  claimed the guard was hoist-specific, and that turned out not to survive
  measurement: ablating it leaves the indexed keys the hoist puts on the node
  completely unchanged, and moves only whether `schema.properties` still holds the
  value the author wrote. The reason is channel-independent — a degenerate value
  must not have its shape reinterpreted by an object spread — so `props` now
  carries the same guard, both bags share one `isConfigBag` predicate, and the
  `properties` comment states the measured reason instead of the old one.
  
  Both sites that spread the bag are covered: the evaluation memo (so
  `schema.props` keeps the authored value) and `propsWithoutCanonicalKeys` (so the
  `createElement` spread does not re-enumerate it). A degenerate bag now
  contributes no keys, and the authored value is passed through unmangled on the
  React prop named `props`.
  
  Unchanged: a normal object `props` (still evaluated, still spread per key),
  objectui#5123's two-bag precedence, the `properties` hoist, and objectui#6708's
  dropped-`props` diagnostic.
- 31ab372: A degenerate `properties` bag no longer reaches the element as indexed React
  props (objectui#6760).
  
  `properties` is the spec spelling of a node's config bag. The hoist that copies
  `properties.*` onto the node's top level walked it with `Object.entries`
  unconditionally, so a non-object value was enumerated rather than skipped:
  measured on `c6732825d`, `{ type, properties: 'not-a-bag' }` reached the element
  as nine React props named `0` … `8`, and `properties: ['x', 'y']` as `0`, `1`.
  Nobody authored those keys — they are the walk's reading of a string's character
  indices.
  
  The hoist now asks the same `isConfigBag` question the evaluation memo and the
  `props` bag already ask (objectui#6752, objectui#6761). Of the two arms the card
  left open, this is "guard the hoist" rather than "declare that the hoist may
  enumerate anything", because objectui#5123 ruled that a key gets one answer
  whichever channel reads it — and the alternative would have answered one
  authored mistake two ways, with the reinterpreting half falling on the canonical
  spelling while the quiet half fell on its legacy alias.
  
  Nothing else moves: a real object bag hoists exactly as before (including the
  `type`/`id` keys the hoist has always refused to copy), the authored
  `properties` value still reaches renderers on both channels unchanged, and
  `properties: 42` / `properties: true` were already contributing no keys.
- 67fc3b0: `useETagCache`, `useGlobalUndo` and `useOffline` stop writing their config refs
  during render (objectui#6797).
  
  Each of the three kept a "latest value" ref that was assigned in the render
  body, one `react-hooks/refs` warning apiece on this base
  (`useETagCache.ts:204`, `useGlobalUndo.ts:57`, `useOffline.ts:262` — all three
  `Cannot update ref during render`, all three the WRITE only; unlike
  `useSchemaPersistence` none of them also READ a ref during render). A ref
  written in the render body is also written by renders React discards or
  replays — StrictMode's double render, a Suspense retry, a concurrent
  interruption — so a tree that never committed could publish its config to
  callbacks that outlive it.
  
  The write moved to `useInsertionEffect` in all three, but that shape was chosen
  per hook rather than carried over, because what each ref protects differs:
  
  - **`useETagCache`** — five resolved config scalars read by five `useCallback`s
    with `[]` deps whose identity is part of the published result. Re-keying them
    on the config values would have changed `fetchWithETag`'s identity whenever a
    caller's `ttl` moved, re-firing consumer effects keyed on it, so the ref
    stays.
  - **`useGlobalUndo`** — the whole options bag. Every caller passes a fresh
    inline literal with inline `onUndo` / `onRedo` closures, and the keydown
    effect is keyed on `undo` / `redo`, so the ref is the only thing keeping
    those two stable while still reaching the newest callbacks.
  - **`useOffline`** — `config.sync`, read by one caller (`sync`) that is
    *already* unstable (deps `[enabled, queue]`). Here the ref protects RETAINED
    closures rather than an identity: the auto-sync effect deliberately captures
    a `sync` and fires it 100ms later, and that closure must still see the newest
    `batchSize`. Dropping the ref for a `syncConfig?.batchSize` dep would have
    changed what that retained closure reads, so it was rejected.
  
  `useInsertionEffect` runs in the mutation phase — ahead of every layout effect,
  ref attachment and paint — so the only window any of the three defers is the
  render phase itself, where none of the affected callbacks is legally callable.
  `useEffectEvent` would be the idiomatic answer but is React 19.2+, and this
  package's peer range starts at React 18.
  
  **No behavioural change is claimed for callers that exist today**: reverting any
  of the three implementations leaves the whole suite green, and the new pins pass
  against the old code and the new code alike. They guard the next edit — each
  file's discriminating pin fails under both `useEffect` and `useLayoutEffect`.
- 33a3b3c: `useETagCache` builds its config object once per hook instance instead of once
  per render (objectui#6817).
  
  `useRef({ enabled, storage, storagePrefix, maxEntries, ttl })` evaluated that
  literal on **every** render and kept only the first result, so every later
  render allocated a five-key object that was discarded. It now comes from a
  `useMemo` keyed on the five values, which is also what the ref's
  `useInsertionEffect` write publishes.
  
  `patch`, not `minor`: nothing a published consumer can observe changes. The
  public shape, the returned callbacks' identities and the values the stable
  `[]`-deps callbacks read off the ref are all unchanged — the object's identity
  is private to the hook, so the only difference is the allocation that no longer
  happens. Same pattern PR objectui#6796 repaired in `useSchemaPersistence`; this
  is the half of that class the `react-hooks/refs` rule structurally cannot see,
  which is why it needed a test rather than a lint fix.
- 3ed3eec: fix(plugin-form,plugin-list,plugin-view,react): read `SchemaRendererContext` as declared, not through a cast to `any` (objectui#7209)
  
  Six reads of the renderer context erased its type. Five cast at the read —
  `useContext(SchemaRendererContext as React.Context<any>)` in the
  `embeddable-form` and `object-master-detail-form` bridges, in `ListViewBlock`
  and in `useResolvedDataSource`, and the same cast spelled with a bare
  `Context<any>` in `useElementDataSource` — and the `object-view` renderer's
  module re-declared the imported context as a `React.Context<any>`. Through
  that cast a read of a member the context does not declare compiled clean,
  which is how the phantom `ctx.formValues ?? ctx.data` channel retired by
  objectui#7206 went unnoticed. Each of these reads now sees `SchemaRendererContextType` as
  `@object-ui/react` declares it, so such a read is a compile error on the day it
  is written.
  
  No runtime behaviour changes. Removing the casts surfaced no read of an
  undeclared member; it surfaced two places where the declared `null` ("no
  adapter bound") met a prop that does not admit it:
  
  - `embeddable-form` handed that `null` to `EmbeddableForm`'s optional
    `dataSource`. It now collapses it to `undefined`, as
    `object-master-detail-form` already did; `EmbeddableForm` only ever tests the
    adapter for truthiness, so the two absences behave the same.
  - `object-view` / `view` hand it to `ObjectViewProps.dataSource`, which is
    declared required and stays so (objectui#7842). That one value now carries a
    narrow, commented assertion instead of the whole context being erased; the
    value passed is the same as before.
  
  The published signatures of `useResolvedDataSource` and `useElementDataSource`
  do not move.
- 2ce2612: A record-page URL now names the object the clicked rows actually came from, in
  `ObjectTree` and `ObjectCalendar`.
  
  `useNavigationOverlay` builds `/{objectName}/record/{id}` out of whatever it is handed,
  and both components handed it the bare top-level `schema.objectName` while resolving
  their own rows through the ruled record-source ladder (`data`, then
  `staticData`, then `objectName`). `77cb489b4` published `objectName` as that ladder's
  THIRD RUNG and not as a parallel "page object" concept, so a block has exactly one
  record source — and a row fetched through `data.object` whose click built
  `/{schema.objectName}/record/{id}` named a record that the URL's own object does not
  contain.
  
  Two shapes change, both toward the object the rows came from:
  
  - a block carrying **both** bindings navigated to the top-level key and now navigates to
    `data.object`;
  - a **data-only** block had no name to build a URL from at all, so the hook took its
    `/{id}` leg — an unrouted path that paints a blank page — and now builds the routed
    record URL.
  
  `ObjectCalendar` is where the divergence was plainest: on one click it resolved the
  detail drawer through the ladder and the navigation URL through the top-level key. The
  URL now reuses the very `schemaObjectName` that already keys the calendar's record query
  and its `$expand` derivation, so query, drawer and URL agree by construction.
  
  **Nothing else moves.** Both converted sites keep a site-local `?? schema.objectName`
  tail for the off-contract `data: { provider: 'object' }` that carries no `object`
  (`ViewDataSchema` declares it required) — the same tail `ObjectTree`'s `headerObjectName`
  already carries, and the same conservatism `b041b9c0c` applied when it published the
  shared reader. `useNavigationOverlay`'s own signature is unchanged: it still takes an
  `objectName`, and only what callers hand it has changed.
  
  The hook's `@example` stops prescribing `objectName: schema.objectName`. That prose is
  why there were copies to convert at all — component authors copied the divergence out of
  the documentation, correctly, as written — so it now points at
  `resolveRecordSourceObjectName` and says explicitly that a caller with no data config
  has nothing above rung three and should keep passing `schema.objectName`.
  
  `ObjectKanban` is deliberately **not** converted: it has no data config, no
  `getDataConfig`, and its `data` is a raw row array rather than a `ViewData` binding, so
  `schema.objectName` already IS its record source and its board, drawer and URL already
  agree.
- d1bebb0: The unevaluated-expression diagnostic now lists `properties` among the channels
  that evaluate and read back, matching the sibling `props`-bag diagnostic that
  tells authors to write their keys there.
  
  Both messages are dev-build diagnostics in `SchemaRenderer`, and one node can
  trip both. They disagreed: `propsBagDiagnostic` said *"`props` is NOT hoisted
  onto the node — only `properties.*` is … Write them under `properties`
  instead"*, while `unevaluatedExpression` enumerated *"channels that do evaluate
  and read back today"* as `content` or host-side resolution — omitting
  `properties`. An author who hit both was told to use a channel the other message
  said did not work.
  
  The enumeration was the wrong half, established by measurement rather than by
  reading the `COMPAT` label on the hoist. `properties` has no retirement on
  record: `@objectstack/spec@17.2.0` calls the vocabulary carried there *"ALIVE —
  this is not dead surface to retire under ADR-0049"*, keeps
  `PageComponentSchema.properties` as the open carrier on purpose, gates it at the
  authoring door, and tombstones no part of it via `retiredKey()`. In this repo
  `props`, not `properties`, is the spelling annotated as the legacy alias.
  
  Diagnostic text only — no evaluation, hoist or schema behaviour changed.
- 7fb22a1: The published visibility diagnostic no longer tells an author that `app` is a bound
  expression-scope root (objectui#8155 follow-up).
  
  `@object-ui/react`'s `SCOPE_TIER_ADVICE['app-shell']` — the paragraph
  `reportUnresolvableVisibilityPredicate` prints in production when a predicate cannot be
  evaluated — read "App-shell predicates bind `current_user` … plus `app` and `features`".
  objectui#8155 removed `app` from `buildExpressionScope`, so that sentence was printed at
  exactly the moment a saved `app.*` predicate faulted, and it answered "why did my
  predicate not resolve?" by naming the root that is the reason. The line now names the
  five roots the provider really binds: `current_user`, its `user` / `ctx.user` / `os.user`
  aliases, and `features`.
  
  **Swept as a class, not as two coordinates.** Every other place in this tree that stated
  `app` was a bound expression-scope root is corrected in the same change — the diagnostic
  copy and its byte-pin, the ambient-scope docblocks in `@object-ui/react`
  (`SchemaRenderer`, `useExpression`), `@object-ui/core` (`ActionRunner.ParamDef.visible`,
  `RowPredicateOptions.scope`), `@object-ui/components` (`form.tsx`, `containers.tsx`),
  `@object-ui/plugin-detail`, `@object-ui/plugin-form` (docblock and README),
  `@object-ui/app-shell` and the console app, plus fourteen test fixtures that transcribed
  the old bag with an `app` key. The fixtures in `@object-ui/app-shell` now call
  `buildExpressionScope` instead of transcribing it, so that pair cannot drift again.
  
  Nothing that was true before objectui#8155 changed: the `app` prop on
  `ExpressionProvider` and the `app` field on its React context value are untouched (they
  were never CEL roots), and no root other than `app` was added to or removed from any
  message, bag or fixture.
  
  Two release-bound corrections travel with it. The producer-side card objectstack#16420
  was closed `not_planned` on 2026-09-07 by the same ruling that removed the root, not left
  open; and the consequence of a stale `app.*` predicate is **not** uniformly "fails open" —
  it is per surface, and the changeset that carries the removal now states the seven
  measured directions instead of one.
- ad66d79: Stop binding an ambient `data` root on record surfaces, so a `data.*` predicate faults
  loudly instead of resolving against the host's bag (objectui#8166, ruled 2026-09-10).
  
  **User-visible behaviour change, at RUNTIME and at DEBUG time — not at authoring time.**
  Nothing an author sees while writing a predicate moves: the authoring lint's accept set
  lives in `@objectstack/formula`'s `SCOPE_ROOTS`, which still contains `data`, and
  `data.status == 'x'` still lints clean at `scope: 'record'`. Splitting that list per
  scope is the producer-side half and is not this repo's to make. What changes is what
  the runtime does with such a predicate once it is saved.
  
  **What was wrong.** `83fe6e741` (Phase 2 of the objectui#5330 canon) retired `data.*`
  on runtime record surfaces — the row is bound as `record.*` and nothing else. But
  `@object-ui/app-shell`'s `buildExpressionScope` kept binding an ambient `data`, so a
  predicate the linter had waved through also *resolved* at runtime, against that bag
  rather than against the row. Measured on `main` before this change, one authored
  `visibleWhen: "data.status == 'x'"` meant three different things:
  
  - on every `ExpressionProvider` mount and on `RecordFormPage`'s own evaluator, the
    ambient `data` was `{}`, so the engine answered `[runtime] No such key: status` — a
    fault, warned once, and the field-rule fallback applied (fail-open for `visibleWhen`);
  - on `AppContent`'s field-list evaluator for the global record-form modal in EDIT mode
    the ambient `data` was **the record being edited**, so the predicate resolved, with no
    diagnostic at all, off the wrong layer's object — an author testing there would have
    seen it "work";
  - in CREATE mode on that same modal it fell back to the first case.
  
  **What changes.** `buildExpressionScope` no longer accepts or binds `data`, and the two
  imperative call sites (`AppContent`, `RecordFormPage`) stop passing one. A `data.*`
  predicate on any app-shell surface now produces the engine's own verdict — `[type]
  Unknown variable: data` — on both diagnostic channels (the one-time `console.warn` and
  the `onFault` passback), which is the same verdict the server gives the same string and
  the same shape `app` has produced since objectui#8155.
  
  **The fault is loud, not fatal.** The verdict a faulting predicate resolves to is
  unchanged: `visibleWhen` still fails OPEN, `readonlyWhen` / `requiredWhen` still fail
  permissive (`@object-ui/core`'s `fieldRules.ts`; the direction is objectui#8069's open
  question, not this change's). So a record form renders exactly as before except that the
  console now names the root. Nothing throws.
  
  **Migration.** Rewrite `data.foo` as `record.foo` on any runtime record surface — the
  canonical spelling since `83fe6e741`, and the only one that reaches the row. The
  metadata-admin designer is unaffected: its `data` is the DRAFT under edit (ADR-0089 D3,
  `CANONICAL_ROOT_BY_LAYER` = `{ runtime: 'record', metadata: 'data' }`), bound by
  `views/metadata-admin/predicate.ts` through its own builder, which takes only the
  identity roots from this bag and assigns its own `data` last.
  
  `@object-ui/react` carries a docblock correction only: the `app-shell` tier paragraph in
  `utils/visibilityDiagnostic.ts` described the bag this change edits. `@object-ui/components`
  carries no runtime change at all — three form/predicate tests hand-transcribe the app-shell
  bag (importing it would invert the package dependency) and each literal carried the removed
  `data: {}`; the transcriptions are corrected so they cannot go on describing a scope that no
  longer exists.
- e36acd4: `SchemaRenderer` no longer hands an authored `objectFields` to any component as
  a React prop (objectui#8818, completing maintainer decision batch #70,
  objectui#7742).
  
  `objectFields` is the object's field catalogue. The predicate layer reads it to
  decide how a conditional-formatting rule compares a relation field. Batch #70
  ruled it a runtime prop that a host injects, never authorable metadata, but the
  renderer's fixed metadata strip list did not name it. So a node that authored
  the key had it spread onto whatever component its type resolved to. It now
  joins that strip list, and all three authoring spellings are dropped: a
  top-level `objectFields`, `properties: { objectFields }`, and the legacy
  `props: { objectFields }` alias, which is spread separately and is stripped
  too.
  
  Runtime hosts are unaffected. Pass the catalogue as a React prop, either on
  the component directly (as `ObjectKanban` does for the board it mounts) or as
  an `objectFields` prop on `SchemaRenderer` itself. `SchemaRenderer` spreads its
  own props last, so a host prop still arrives. No schema face ever declared the
  key, so no published type or validator changes.
- b9d47ec: Resolve filter placeholders on the drill "escape hatch", so one drill has one scope
  whatever `drillDown.target` says (objectui#9022).
  
  Every widget composes its drill filter from the RAW authored filter, so
  `{current_user_id}`, `{current_org_id}` and the relative-date macros were still
  literals when they reached the host's `openRecordList`. The in-place drawer arm never
  had the defect — the `object-data-table` it renders resolves the filter in its own
  fetch — so only the navigate arm, and the "Open in list →" button in the drawer header,
  wrote the placeholder into the URL. `filter[close_date][gte]={current_quarter_start}`
  parses back on the read side as an ordinary string comparand, so the destination list
  matched nothing, silently, and in disagreement with the chart bar the user had just
  clicked (that chart scopes its own bars by the RESOLVED value).
  
  `useOpenRecordList` now expands both placeholder vocabularies against the session scope
  it already sits inside, immediately before serialization. It is the single host handler
  every escape hatch funnels through — the chart's navigate arm and its own header
  button, `DrillDownDrawer`'s navigate arm, and `OpenInListButton` — so both widget
  families are covered by one resolution rather than N widget seams. A drill carrying no
  placeholder produces a byte-identical URL: both vocabularies substitute whole-string
  `{token}` values only.
  
  The `DrillNavigationValue.openRecordList` contract now states that resolving is the
  host implementation's job, since an out-of-repo host wiring the same context would
  otherwise reproduce the split.
- efc1c9c: **A node-gate predicate parked under `props` is now REFUSED BY NAME on the console, instead of gating nothing in silence (objectui#9108).**
  
  A node may spell its config bag `properties` (the spec spelling) or `props` (the annotated legacy alias). `SchemaRenderer` hoists `properties.*` onto the node; nothing copies `props.*`, and both node gates read the post-hoist node — so a predicate that arrived under the alias was never one of the keys either gate could see. Measured at node level, four rows: `props: { visible: false }` and `props: { hidden: true }` both RENDERED, while `properties: { visible: false }` and `properties: { hidden: true }` each hid correctly. Fail-**open** and silent by construction: a gate that never bit renders exactly like a gate that said yes, so no user and no screenshot can find it.
  
  **No verdict moves, and that is the ruled outcome rather than a limitation.** The alias is refused, ⛔ not honoured: nothing is hoisted, `schema.<KEY>` stays undefined for a renderer declared as `({ schema })`, and every element receives the byte-identical props bag it received before. What changes is that the eight node-gate predicate keys (`visibleWhen` / `visible` / `visibleOn` / `visibility` / `hidden` / `hiddenOn` / `disabled` / `disabledOn`) are named on the console when they are parked there, with the migration that fixes them. The maintainer ruling of 2026-09-13 closed the honour arm (PR objectui#9144) on the ground that honouring the alias would have made *"8 predicate keys work while the rest stayed silently dropped — and partly working is harder to learn from than not working"*.
  
  The line is `console.error`, in development **and in production** — the same posture objectui#6038 gave the unresolvable-predicate report, because a node gate that has stopped biting in production is exactly the defect that must not be able to sit live and undiscovered. It is rate-limited to one line per distinct authoring bug for the lifetime of the page. One measured carve-out: `disabled` on a bag-reading `element:*` node is honoured by that renderer itself (`disabled={props.disabled || running}`), so it is not refused there.
- b234a84: `ElementDataSourceGate`: a row cap the contract refuses is no longer counted as
  "the component authored one" (objectui#9899).
  
  The shared gate decides, per key, whether a component's own value should suppress
  the one a bound saved view supplies. For `columns` it has always decided that by
  CONTENT — an authored-but-empty list yields, because "supplying the columns is the
  reason a view was named". For the row cap it decided by PRESENCE, so a value
  `@objectstack/spec` refuses — `pagination.pageSize: 0`, a negative, a fraction —
  counted as authorship and suppressed the view's legitimate cap.
  
  **What an author saw.** Measured end to end on `list-view` rather than inferred: a
  component carrying `pagination.pageSize: 0` under a view supplying `7` put
  `$top: 100` on the wire — the renderer's own default, because that renderer already
  refuses a non-positive page size. So the view's cap never reached the query and the
  read was WIDER than the view asked for, in the one direction a named view exists to
  prevent. The same branch feeds the flat `limit` key that `object-kanban`,
  `object-timeline`, `record:related_list` and the form panels read.
  
  After this change the view's cap is written, and the same fixture puts `$top: 7` on
  the wire.
  
  **The diagnostic moved with the decision.** Before this change the consuming
  renderer was the one telling the author their `0` had been dropped. Now that the
  gate substitutes a usable cap, that renderer correctly sees nothing to report — so
  the gate states it instead, once per declaration, on the same `console.warn` channel
  the renderers use. It names the refused value, the key it was written on, and the
  cap used in its place. Exactly one message is emitted before and after; this is not
  a silent substitution, and it is not a clamp — the author's number is refused, not
  repaired.
  
  **Unchanged:** a legitimate authored cap still wins over the view's, and an explicit
  cap on the `dataSource` binding still wins over both.
- befd40c: fix(react): the refused-`data` dev warning can be reset between tests
  
  The dedupe `Set` behind the objectui#9571 / objectui#9758 diagnostic — "the
  authored `data` key was NOT passed to the component as a React prop" — lived in
  `SchemaRenderer.tsx` with nothing able to clear it, while every other dev
  diagnostic in this package's `utils/` directory pairs its `Set` with an exported
  test-only reset. `propsBagDiagnostic.ts` states the consequence in its own
  reset's docblock: the second test to assert the same warning reads the first
  test's dedupe entry and sees silence, "a green run that checked nothing". The
  absence direction is the dangerous one — a test asserting this warning did NOT
  fire for a `type#id` an earlier test already warned for is green whatever the
  renderer does, and it reports that green as coverage.
  
  The `Set`, the emit and a new `__resetRefusedDataPropWarnings` now live in
  `utils/refusedDataPropDiagnostic.ts`, beside the siblings whose idiom they
  follow. `index.ts` re-exports `SchemaRenderer.js` with a star, so a reset
  exported from where the `Set` used to sit would have become a member of this
  package's published entry for the sake of a test affordance; the entry is
  unchanged by this change, and so are the warning's text, its dedupe key and both
  `__DEV__`-gated call sites.
  
  The pin renders one `type#id` across three `it()` blocks — the warning fires,
  fires again in the next block, then draws silence for host-supplied rows beside
  a control that proves the channel could still speak. Ablating the reset's body
  turns the last two red; the absence assertion alone stays green under it, which
  is the defect it exists to refuse.
- 98c3a74: Fix `createLazyPlugin`'s JSDoc example, which taught a call that does not compile.
  
  The `@example` block passed `() => import('@object-ui/plugin-grid')` as the
  `importFn`. ObjectUI plugin packages export their components by name and have no
  `default`, so that call supplies the module namespace object — rejected by the
  compiler (`Property 'default' is missing`) and, at runtime, handed to
  `React.lazy` as the component. The examples now unwrap the named export via the
  `async` spelling, which is the form that actually type-checks. This ships in the
  published `.d.ts`, so it is what editors show on hover.
- 9850c6e: `SchemaRenderer`'s node visibility gate now emits a dev-only warning when a
  predicate reads `data.*` and the data-source adapter cannot answer that read, so
  an author who wrote `properties: { visible: "data.status == 'draft'" }` sees the
  constant they authored instead of shipping it (objectui#5687).
  
  At the node tier `data` is the data-source **adapter** — the object `${data.total}`
  in a props bag resolves against — and it has never been the row. A predicate
  written with the deprecated `data.*` spelling therefore resolves `undefined ==
  'draft'`, which is a perfectly good `false`: the block is hidden on every row, and
  because it does not throw, the unresolvable-predicate reporter added for
  objectui#5454 never fired. Measured on this base, the same predicate written as a
  `{ dialect: 'cel' }` envelope *does* throw and *was* already reported — so whether
  an author heard about the identical mistake depended on which dialect they happened
  to write it in, which is the arbitrariness objectui#5454 existed to remove.
  
  **No verdict changes and no interpolation changes** (maintainer ruling,
  2026-08-22, option A). The node tier keeps its documented `data` = adapter
  semantics; objectui#5330's row binding does not extend here. The evaluator's answer
  is returned exactly as computed and `${data.*}` interpolation is untouched — only
  the silence moved.
  
  The report fires on a `data.*` read the bound adapter answers with `undefined`, not
  on the spelling. A genuine adapter read stays silent (`data.total > 0` against an
  adapter carrying `total`), a canonical `record.*` predicate stays silent, and a
  correctly-hiding gate stays silent. Dev builds only, `console.warn`, deduped per
  node type + key + predicate source — the same module, Set and lifecycle as the
  objectui#5454 reporter.
  
  This loudness is temporary by design: it dissolves when objectui#5330's deprecation
  window for the `data.*` row spelling closes.
- b2ea297: `ObjectSchemaMetadata` is now derived from `@objectstack/spec`'s `ServiceObject`
  instead of being a hand-written copy (objectui#5362; maintainer ruling
  2026-08-20: the object document type belongs to the spec).
  
  What changes on the published type surface:
  
  - **Gained:** the full spec object-document surface, including the three keys
    the runtime already reads but the old interface rejected as excess
    properties: `icon`, `titleFormat`, `listViews` (plus `pluralLabel`,
    `nameField`, `displayNameField`, `managedBy` as a spec key, and the rest of
    the spec document).
  - **Removed:** nine members the old interface declared that no objectui
    runtime code reads and the spec document does not know: `extends`,
    `triggers`, `primary_key`, `relationships`, `name_field` (the spec spelling
    is `nameField`), `soft_delete`, `audit_trail`, `version`, `cache`.
    `ObjectTrigger` and `ObjectRelationship` remain exported unchanged.
  - **Kept:** `editMode` — the one measured client-side member the runtime reads
    (`recordFormNavigation` / `AppContent`) — now declared on the new
    `ObjectSchemaClientExtensions` interface, which the derivation intersects.
    Note the spec's strict parse rejects `editMode` on published documents
    (`unrecognized_keys`); it is a client-type member only.
  
  Spelling settlement: `listViews` (camelCase) is canonical — `list_views`
  appears nowhere in `@objectstack/spec` 17.2.0. Runtime read sites in
  `@object-ui/app-shell` and `@object-ui/react` keep a documented snake-spelling
  READ fallback for stored pre-settlement documents (that stock has never been
  censused — objectstack#7917); the CRUD guide and its pinned transcription now
  author the canonical spelling.
- 4f14ad7: `SchemaRenderer`'s node visibility gate now also catches the `${…}`-templated
  spelling of the objectui#5454/#5687 diagnostics when it is written inside
  `properties`, e.g. `properties: { visible: "${data.status == 'draft'}" }`
  (objectui#5756).
  
  The `properties.*` evaluation loop runs, and interpolates every `${…}` template it
  finds, **before** the visibility gate ever sees the value — so by the time the
  existing diagnostics ran, a template-spelled predicate had already collapsed into a
  plain boolean and there was no predicate text left to inspect. The bare-string
  spelling of the exact same gate (`properties: { visible: "data.status == 'draft'"
  }`) was unaffected — nothing interpolates a string with no `${` in it — and was
  already reported; only the template spelling was structurally invisible.
  
  Reached by moving the diagnostic check to inside the `properties` evaluation loop,
  on the predicate's raw (pre-interpolation) text, gated on the key being one of the
  six visibility keys the render chain consults (`visibleWhen` / `visible` /
  `visibleOn` / `visibility` / `hidden` / `hiddenOn`) — a `properties.content`
  interpolation, or any other non-visibility key, is untouched and stays silent.
  
  Reports only the key that actually **decides** the node's visibility, mirroring
  objectui#5454's own leg semantics (its reporter is likewise only ever invoked on
  the leg the chain's early-return sequence actually reaches): a `properties.visible`
  template that a co-declared `visibleWhen` outranks is not reported for deciding
  nothing.
  
  **No verdict changes and no interpolation changes.** The diagnostic call's return
  value is discarded; the real verdict is still computed afterward, off the
  post-evaluation, post-hoist schema, by the same code path as before this change.
  Same two reporters as objectui#5454/#5687 (unresolvable-predicate / adapter-only-data
  predicate), same dedupe `Set`, same `console.warn` severity, same dev-only gate —
  only the silence moved, one render-step earlier.
- f90b8fb: `toRenderableSchema`'s header now says the bridge is permanent, instead of instructing
  callers to remove it (objectui#4622).
  
  No executable line changes — but the artifact is **not** unchanged, and that is worth
  stating plainly rather than rounding to "comment-only". This package builds with plain
  `tsc`, and nothing in its config chain sets `"removeComments"`, so the default `false` holds and the JSDoc
  is emitted into `dist/schema-input.js` as well as `dist/schema-input.d.ts` — it is both
  what an editor shows on hover at every call site and bytes that ship.
  
  Measured by building the package the way the repo builds it, at both revisions:
  `dist/schema-input.js` grows from 1,486 to 2,377 bytes (1.45 KB to 2.32 KB), and from 850
  to 1,266 bytes gzipped (0.83 KB to 1.24 KB) — **+891 bytes raw, +416 gzipped**. All 19
  differing lines in the emitted file are JSDoc continuations and the three executable lines
  are byte-identical, so the growth is the paragraph and nothing else. The trade is
  deliberate: roughly 0.4 KB gzipped, against the five-hour `Build Docs` outage the old
  paragraph's instruction produced once already.
  
  The old closing paragraph said the two competing repo-wide `SchemaNode` spellings "have
  not been reconciled" and that "when it lands, the call sites using this can go back to
  forwarding directly". Both halves went false when PR #4608 merged, and the second half is
  the harmful one: it is an instruction whose trigger condition has now fired, sitting
  directly above the function a future author is about to call.
  
  The reconciliation (objectui#4580 / PR #4608) resolved the collision in favour of
  `@object-ui/types`' union — `@object-ui/core` now re-exports it rather than hand-declaring
  an interface — while `SchemaRenderer`'s prop stays deliberately narrow per objectui#4548
  ruling Q2 (`schema: BaseSchema | string | null | undefined`, no `number` / `boolean`). So
  a `SchemaNode` became *less* assignable to that prop, not more, and the bridge is a
  permanent crossing between two intentionally different types rather than scaffolding
  awaiting a merge.
  
  Following the old instruction has a measured cost: five `apps/site` call sites were
  forwarding directly when PR #4608 landed, and `Build Docs` was red on `main` for roughly
  five hours until PR #4621 routed all five through this function (objectui#4617).
  
  ⚠️ **Dated note, 2026-10-01 — the prop's union widens — objectui#11364.** Later in this same release `SchemaRendererProps.schema` becomes `BaseSchema | AuthoringNode | string | null | undefined`, and `toRenderableSchema`'s return widens with it by reference. So the union spelled above (`schema: BaseSchema | string | null | undefined`) no longer describes the release as a whole. What it was quoted for still holds: the prop declares no `number` / `boolean`, so the bridge stays the crossing from `SchemaNode`. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — the prop takes the declared-node union — objectui#11466.** At this change the prop was `BaseSchema | string | null | undefined` (and `BaseSchema | AuthoringNode | string | null | undefined` after objectui#11364's note above); now, later in this same release, it is `DeclaredNode | string | null | undefined`, and `SchemaNode`'s object arm is `DeclaredNode` too. The prop still declares no `number` / `boolean`, so the bridge stays the crossing from `SchemaNode`. The rest of this entry is kept as the reading of this change.
- f53a8d0: fix(react): stop the form-view bridge silently dropping 18 spec keys
  
  `spec-bridge/bridges/form-view.ts` promised (#2545) that "every serializable
  spec key is either mapped onto the `object-form` node or listed here with an
  explicit reason for being ignored". Measured against `@objectstack/spec` 17.2.0
  the promise was false for 18 keys, because the conformance test enforcing it ran
  its completeness loop over its own hand-written fixture rather than the
  contract's key set.
  
  Seventeen of them now reach the node, at the destinations the receiving layer
  already reads:
  
  - `FormViewSchema.buttons` / `.defaults` — `ObjectFormSchema` declares both and
    `ObjectForm` folds them at render (action-button visibility/labels, and
    create-mode initial values).
  - `FormSection.pane` — explicit split-pane placement; without it a spec-authored
    split form fell back to the positional rule, so reordering sections moved them
    across the divider.
  - `FormSection.visibleOn` — the deprecated spelling now folds onto `visibleWhen`,
    matching the contract's own parse-time normalisation and the field path.
  - Thirteen `FormFieldSchema` keys — `maxLength`, `minLength`, `min`, `max`,
    `precision`, `scale`, `multiple`, `immutable`, `span`, `language`, `keyField`,
    `disclosure`, `fields` — so authored constraints, composite config and field
    width survive the bridge instead of ending there.
  
  `publicPicker` is deliberately not carried and now says so: it is a server-side
  public-lookup authorization opt-in with no client destination.
  
  The conformance test's key set is now derived from the contract's own shape at
  all three levels, so a spec key that is neither mapped nor explained fails the
  suite by construction.
- d91aed9: Name the case-only spelling when a component type misses the registry.
  
  Registry lookup is exactly case-sensitive, so a node typed `Page` misses a registered `page` and falls through to the OBJUI-001 "Unknown component type" panel. Because the mistake is usually uniform across a document, the symptom is not one broken widget — it is the whole page rendering as error panels, with nothing in the message pointing at the cause.
  
  Both surfaces that report the miss now name the spelling that would have resolved. `SchemaRenderer`'s panel reads `Unknown component type: Page — did you mean 'page'?`, and `objectui check` reports `Unknown schema type "Page" in <file> — did you mean "page"?`. When no known type differs by case alone, neither says anything extra — `zzz` gains no bogus suggestion, and this is case matching, not an edit distance, so `pge` suggests nothing either.
  
  **Lookup itself does not change.** `Page` still misses, still fails, and still renders the panel; only the message teaches. Normalising the lookup was considered and rejected (objectui#5247, maintainer ruling 2026-08-19): it would make two spellings valid everywhere, permanently, and legalise the typo class (`PAGE`, `pAge`) along with the PascalCase convention.
  
  Each surface reads its candidates from the set it can actually trust — the renderer from the live `ComponentRegistry` (including pending lazy stubs), the CLI from the registration-derived `KNOWN_SCHEMA_TYPES` snapshot — so neither can suggest a type nothing registers.
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3ac2de8]
- Updated dependencies [63f4f92]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [9ec8ceb]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [1dbb993]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [544aca2]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [86982ac]
- Updated dependencies [5e67837]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [8acc51b]
- Updated dependencies [ea9d17f]
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [4357a27]
- Updated dependencies [3261e64]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [ac2d6f1]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [4758b33]
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [baac95a]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [f812f37]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [30b11ad]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [3d6badf]
- Updated dependencies [25cb364]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
- Updated dependencies [eb97ce6]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [244d516]
- Updated dependencies [ac15833]
- Updated dependencies [ac15833]
- Updated dependencies [e2dffc9]
- Updated dependencies [328abeb]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [e327c89]
- Updated dependencies [2eaf5be]
- Updated dependencies [bf7ab35]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [51c2949]
- Updated dependencies [8732846]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [54997ff]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [1d6a23d]
- Updated dependencies [76e9df0]
- Updated dependencies [6158e4c]
- Updated dependencies [cff8641]
- Updated dependencies [c27b575]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [858eafb]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [9419df1]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [1563d3e]
- Updated dependencies [58da8ae]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [770cc5b]
- Updated dependencies [d893290]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
- Updated dependencies [d0fba91]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [063119f]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [f9c8c4e]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [d0097af]
- Updated dependencies [432882b]
- Updated dependencies [64dae8e]
- Updated dependencies [b06e374]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [594704f]
- Updated dependencies [d3995fe]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [993f312]
- Updated dependencies [636b236]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [41b7ce3]
- Updated dependencies [ae476b8]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [fda49e5]
- Updated dependencies [94e2fa7]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [95f8704]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [90665e0]
- Updated dependencies [8d3a529]
- Updated dependencies [5ac2e2c]
- Updated dependencies [7e19d03]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [5fa06c4]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [6f81384]
- Updated dependencies [5d3a2d1]
- Updated dependencies [8f1d995]
- Updated dependencies [b362c1b]
- Updated dependencies [5127378]
- Updated dependencies [dddb942]
- Updated dependencies [00c665e]
- Updated dependencies [29754cf]
- Updated dependencies [3c2b6f7]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [c8ea8af]
- Updated dependencies [9602dc8]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [fff9645]
- Updated dependencies [9c3b7ce]
- Updated dependencies [2c1c967]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [969ba84]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [dbd5194]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [2acd8e1]
- Updated dependencies [f07b976]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [adb2a86]
- Updated dependencies [503cd8b]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [ce986aa]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [512bc90]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [639114c]
- Updated dependencies [639114c]
- Updated dependencies [1490691]
- Updated dependencies [1f31d3a]
- Updated dependencies [d8ec8d6]
- Updated dependencies [351eb31]
- Updated dependencies [866cd1d]
- Updated dependencies [20c04b2]
- Updated dependencies [01c9023]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [8952395]
- Updated dependencies [e2b3826]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [7c3df8f]
- Updated dependencies [a4514e8]
- Updated dependencies [db3896c]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [669d71b]
- Updated dependencies [6a99bb2]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [3399704]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [20cb8db]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [77b2a18]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [c2f0f48]
- Updated dependencies [1237ae4]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [efbd566]
- Updated dependencies [2a5bf45]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [23b9958]
- Updated dependencies [5d0876c]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [c907a9c]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [91f9276]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [a915064]
- Updated dependencies [dcbf0b2]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
- Updated dependencies [53ded82]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [335abea]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [f57ca75]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [a695f50]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [6e9a3d4]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [7c9145f]
- Updated dependencies [f391ede]
- Updated dependencies [f5cfbbd]
- Updated dependencies [f5cfbbd]
- Updated dependencies [8b532cb]
- Updated dependencies [64c3cdd]
- Updated dependencies [4d65991]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [9662aca]
- Updated dependencies [55ba3ff]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [8693b85]
- Updated dependencies [58b7b3d]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [19a0b0e]
- Updated dependencies [526fc11]
- Updated dependencies [f8e3e9a]
- Updated dependencies [3b6bc69]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [0b8c638]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [30443fb]
- Updated dependencies [da45e6b]
- Updated dependencies [835f0f3]
- Updated dependencies [ed35b44]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [2bf34f7]
- Updated dependencies [15b33ae]
- Updated dependencies [7cbc724]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [269880a]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [44152c4]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [05a49f2]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [b2e85a9]
- Updated dependencies [60500cb]
- Updated dependencies [d5c1f52]
- Updated dependencies [c7cd2b6]
- Updated dependencies [b2065e7]
- Updated dependencies [2fcefb9]
- Updated dependencies [77f846a]
- Updated dependencies [bc5870c]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [f760064]
- Updated dependencies [6791717]
- Updated dependencies [8ea3bee]
- Updated dependencies [100547e]
- Updated dependencies [3a58149]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [6ce89da]
- Updated dependencies [0e05aac]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [b470e91]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [c40f3b8]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [6a576c9]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [fffa30d]
- Updated dependencies [fb336df]
- Updated dependencies [20e317c]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [8e00bfd]
- Updated dependencies [8d37efb]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9118a31]
- Updated dependencies [de570cc]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [19cbf10]
- Updated dependencies [a691c0b]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [7b43319]
- Updated dependencies [258d264]
- Updated dependencies [8033ad1]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [fd8dace]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [38a9568]
- Updated dependencies [91783c4]
- Updated dependencies [ca39427]
- Updated dependencies [2d36552]
- Updated dependencies [b2437a7]
- Updated dependencies [f157423]
- Updated dependencies [7a90afd]
- Updated dependencies [eddc1dd]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [968dc1e]
- Updated dependencies [3c73d99]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [fb96ecb]
- Updated dependencies [1170ed1]
- Updated dependencies [f75810e]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/data-objectstack@17.7.0

## 17.6.0

### Minor Changes

- f1d4748: Remove the retired `striped` / `bordered` / `virtualScroll` list-view surface
  
  objectstack#7176 retired `list.striped`, `list.bordered` and `list.virtualScroll`
  from the spec after measuring every objectui reader as pass-through: each one
  copied the key onward and no renderer ever applied it. objectui stops declaring,
  typing and forwarding them.
  
  Off the chain: the `@objectstack/spec` list-view bridge in `@object-ui/react`,
  `ListView`'s child-view props in `@object-ui/plugin-list`, both `ObjectView`
  relays (`@object-ui/plugin-view` and `@object-ui/app-shell`), the `ObjectGridSchema`
  and `NamedListView` declarations in `@object-ui/types` (interface and zod),
  `ObjectGrid.component.yml` in `@object-ui/components`, and the page-block
  inspector's `striped` / `bordered` toggles in the metadata-admin designer.
  
  Behaviour is unchanged: nothing read these keys, so nothing rendered differently
  for them. Stored view metadata that still carries one keeps validating — the keys
  are simply no longer relayed. `ListViewSchema` continues to take the spec's
  list-view fields by reference, so the protocol's own retirement tombstones
  arrive with the next `@objectstack/spec` bump and reject the keys at the
  authoring boundary. Restoring any of the three as live surface requires an
  implementation card filed first, per the ruling.
- 8c0d52e: A form's ruled `submitBehavior.url` redirect can now be performed by the HOST, so a destination stays inside a console mounted at a sub-path (objectui#4989 defect 4).
  
  `ObjectForm` and `WizardForm` accept a relative in-app path and used to travel to it with `window.location.assign`. A rooted path resolves against the ORIGIN there, so under a mounted host — `<BrowserRouter basename="/_console">`, which the framework CLI configures for every embedded deployment — an authored `/thanks` left the application. The destination was correct and the navigation was wrong, and a published renderer cannot fix that alone: only the host knows its mount.
  
  **New: `HostNavigationContext` (`@object-ui/react`).** A host offers its own navigate; a renderer uses it when it is there:
  
  ```tsx
  import { HostNavigationProvider } from '@object-ui/react';
  import { useNavigate } from 'react-router-dom';
  
  function Bridge({ children }) {
    const navigate = useNavigate();
    return (
      <HostNavigationProvider value={{ navigate: (to, o) => navigate(to, { replace: o?.replace ?? false }) }}>
        {children}
      </HostNavigationProvider>
    );
  }
  ```
  
  `@object-ui/app-shell`'s `ConsoleShell` now mounts that bridge above every console route, so the console's own routes, and its basename, are what a post-submit redirect resolves against — and the redirect becomes an SPA transition instead of a full page load.
  
  **Nothing changes for a host that wires nothing.** With no provider the behaviour is byte-for-byte what it was: one `window.location.assign` of the resolved path after the declared `delayMs`. A host with no router has no basename, so origin-rooted resolution is already right there — the seam changes what a MOUNTED host gets and nothing else. `useHostNavigation()` outside a provider answers `{ navigate: undefined }` and never throws.
  
  Two mechanisms were weighed and rejected by the ruling, recorded so they are not re-proposed. **Reading React Router's context when a router happens to be present** is implicit, and unavailable anyway: a React context is a module-instance object, so reading the host's means importing `react-router` into the renderer — which `@object-ui/plugin-form` declares in none of its dependency fields, whose published build externalises every bare specifier, and which two real consumers (`apps/site`, `packages/plugin-view`) do not install. **Requiring `react-router` as a peer** is the honest version of the same thing and costs the package its property of dropping into any React application.
  
  What the host takes on by supplying a navigate: the destination becomes a client-side transition, so an in-app path with no matching route renders the host's not-found instead of a full page load. That is the host's routing table to answer for, which is why the choice is the host's. The contract verdict is unchanged either way — a destination `@objectstack/spec` refuses is refused identically with or without a seam, so an injected navigate can never launder a value the authoring door rejects.
  
  `navigateOnSuccess` is a different declared key with its own open contract question (objectui#5034) and is deliberately untouched here.
- dbbd38a: fix(react): `bridgeListView` emits the column spelling the spec declares
  
  `mapColumn` took a spec-canonical `ListColumn` — whose columns are **already**
  spelled `field` / `label` — and down-translated every one of them to
  `{ accessorKey, header }` before emitting the `object-grid` node, which
  `ObjectGrid` then translated back. A round trip through a spelling
  `ListColumnSchema` refuses by name, on a value that arrived canonical. The
  bridge now forwards the declared shape, and the tolerance branch on the other
  side retires in the same release (see `@object-ui/plugin-grid`).
  
  **Output shape.** `bridgeListView` / `SpecBridge.transformListView` emit
  `columns: [{ field, label?, … }]`. Code reading `node.columns[i].accessorKey`
  off a bridged node reads `field` instead; `header` becomes `label`. The bare
  string shorthand `columns: ['name']` now maps to `{ field: 'name' }`.
  
  **No label is invented any more.** `header: col.label ?? col.field` turned "the
  author declared no label" into "the author declared the machine name", and that
  synthesized value pre-empted `ObjectGrid`'s own header chain — the column's
  label, then the **object field's** label, then the prettified machine name —
  whose middle step exists so a localized field label wins on a non-English app.
  A bridged view therefore rendered raw machine names where a directly authored
  `object-grid` rendered the field's real label. A bare `{ field }` column now
  reaches that chain intact.
  
  Speaking the declared spelling also routes bridged views through the renderer's
  full ListColumn path rather than its type-inference-only one: object-schema
  field enrichment, `hidden` filtering, primary-field auto-linking, and per-column
  `link` / `action` handling now apply to a bridged `ListView` exactly as they do
  to an authored grid.

### Patch Changes

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
- d374caf: SpecBridge's form-view bridge stops reading `defaultSort` and `aria`, two keys spec 17
  retired on the FormView carrier (`retiredKey()` tombstones — authoring either is a parse
  error). Both guards were unreachable for any FormView that passed validation, and both
  ends were measured dead before removal: no form renderer reads either off the node
  (`plugin-form` reads neither, and `SchemaRenderer`'s ARIA injection resolves flat
  `ariaLabel`/`ariaDescribedBy`/`role`, never a nested `aria` object). Behaviour for
  spec-valid metadata is unchanged; a host that fed the exported bridge a raw pre-17
  document no longer gets these two keys copied onto a node slot nothing consumed. The
  LIST view's `aria` pass-through is untouched — that carrier stayed live and is applied by
  `ListView`.
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
- 0046d8f: Evaluate expressions written under a node's `properties`, not just under `props`
  
  `properties` is the spec spelling of a node's config bag and `props` is the
  legacy alias, but `SchemaRenderer`'s evaluation memo only ran the expression
  evaluator over `props`. Renderers in the `element:*` namespace read
  `schema.properties` first, so a node written the canonical way handed the
  renderer the raw `${…}` source and rendered it verbatim, while the same node
  written with the alias evaluated correctly — writing the spec-compliant form
  was the way to lose your expressions.
  
  `schema.properties` values are now evaluated per value, exactly as `props`
  already was, and the evaluation runs before the existing
  `properties`-to-top-level hoist so a key means the same thing whether it is read
  as `schema.properties.x`, as `schema.x`, or as the spread `x` React prop.
  Evaluation stays shallow on both spellings (nested objects and arrays are passed
  through, not walked), and `properties` keeps its precedence over `props`.
- 70a774b: A node writing both `properties` and `props` now gets ONE answer per key, and it is the canonical `properties` one — on both read channels.
  
  `properties` is the spec spelling of a node's config bag and `props` is the
  annotated legacy alias, but which one actually reached the screen depended on
  how the receiving renderer happened to read it — and the two channels disagreed
  in opposite directions:
  
  - **config bag** (`schema.properties.x`) — the `element:*` family's
    `readProps()` merges `{ ...schema.props, ...schema.properties }`, so
    `properties` won.
  - **React prop** (`x` arriving as a prop) — `SchemaRenderer`'s `createElement`
    spread the hoisted `properties.*` values first and then
    `...(evaluatedSchema.props || {})` last, which overwrote them, so `props` won.
  
  Measured on one render of one such node: the bag read `FROM_PROPERTIES` while
  the same key read as a React prop gave `FROM_PROPS`. Which value rendered was
  decided by nothing an author can see — only by whether their chosen component
  belonged to the `readProps()` family.
  
  The React-prop channel now declines to let the legacy alias override a key the
  canonical bag also declares; the config-bag order was already correct and is
  unchanged. Scope is co-occurrence only: a key that only `props` declares still
  works exactly as before, and a node that writes one spelling is untouched. The
  `props` alias is not retired here — only its precedence against a co-present
  canonical spelling is settled.
- dfc6975: Related-list "+ New" now honours `userActions.create` predicates, and the grid
  toolbar's inline-edit affordance is gated on `update` permission (objectui#4646,
  objectui#4647).
  
  Two declared-but-unenforced gaps on the same toolbar surface.
  
  **#4646 — `createPredicates` had a producer and no consumer.**
  `@objectstack/spec@17.0.0` widened `userActions.create` to
  `z.union([z.boolean(), RowCrudActionOverrideSchema])`, so `resolveCrudAffordances`
  emits `createPredicates` — and nothing in objectui read them, against roughly
  fifteen consumption sites apiece for `editPredicates` / `deletePredicates`. The
  symptom: a parent record entering a frozen state correctly greyed its children's
  row Edit/Delete while the related list's "+ New" stayed fully live, so the user
  filled in the whole child form to earn a server 409. The related-list toolbar now
  evaluates `visibleWhen` / `disabledWhen` **once against the host parent record**,
  per the spec docblock's binding for this key, on top of the existing
  `o.create ∧ can(child, 'create')` check. `visibleWhen` hides "+ New" and fails
  CLOSED; `disabledWhen` greys it and fails SOFT — the same evaluator, fail
  directions and hidden-vs-disabled split the record header already uses for
  edit/delete (objectui#4419 / PR #4515). A bare-boolean `userActions.create` is
  untouched: with no predicates there is nothing to evaluate.
  
  **#4647 — the inline-edit toggle was the one ungated affordance on its toolbar.**
  It rendered on "grid view ∧ the host wired `onInlineEditChange` ∧ not the compact
  toolbar", and every host wires that callback unconditionally. New and Import are
  hidden for an account without the grant and the bulk-delete entry on the same
  toolbar ANDs `can(obj, 'delete')`, but a read-only principal could flip inline
  edit, modify cells and press "Save all" to earn a server 403. It is now gated on
  the object's resolved edit affordance ∧ `can(object, 'update')`, mirroring that
  bulk-delete gate. The gate is applied at all three sites that carry this
  affordance — the wide toolbar's toggle, the compact toolbar's settings-popover
  entry (which previously had no gate at all, not even the callback), and the
  `editable` mode handed to the grid, so a stored view carrying `inlineEdit: true`
  can no longer drop a read-only principal into editable cells with no toggle to
  press.
  
  `ListViewSchema.userActions.editInline` is also consumed now: an explicit `false`
  withholds the affordance wholesale, which authors previously could not do.
  
  **Behaviour change for read-only users, stated plainly.** Where the UI used to
  offer inline editing and let the server refuse it, it now declines to offer the
  entry point at all. No data access changes — the server gate was and remains the
  enforcement boundary; this only stops the UI walking users into round-trips
  guaranteed to fail. Accounts *with* the grant see no change, and hosts with no
  `PermissionProvider` mounted (standalone embeds, the Studio designer) keep
  today's behaviour, since `can()` answers `true` there by design.
  
  One deliberate non-change: the absent case of `userActions.editInline` defers to
  the host's existing `inlineEdit` channel rather than enforcing the spec's
  `.default(false)`. Enforcing that default would remove the toggle from every
  stored console list view in one release, since nothing folds a legacy key into
  `editInline` and no existing view declares it. This follows the rule the
  surrounding toolbar-flag block already states for itself — defaults chosen to
  match what the flags have always done. `InterfaceListPage`, the key's other
  consumer, reads the absent case as OFF, because the ADR-0047 interface page has
  no such host channel to defer to.
- 144ef9b: Dev builds now shout when an unevaluated `${…}` expression reaches the DOM.
  
  A value only reaches the user if `SchemaRenderer` EVALUATES it and the renderer
  READS IT BACK, and those two sets do not fully overlap. Where they miss, the
  failure was silent. Measured on a real render with `dataSource: { n: 99 }`:
  `{ type: 'ui:statistic', value: '${data.n}' }` puts the literal text `${data.n}`
  on screen, because the evaluation memo covers `content`, the `properties` /
  `props` bags and the predicate keys and passes every other top-level key through
  untouched. An author — increasingly, an AI authoring metadata — got no signal at
  all: a literal `${data.n}` in front of a user reads like a data problem rather
  than a contract violation.
  
  `SchemaRenderer` now reports such a value once per node via `console.error`,
  naming the node type and id, the key the raw source survived on (spelled the way
  it was authored — `properties.value`, not the hoisted top-level copy), the
  expression source verbatim, and the channels that do work today. It also catches
  the second, harder shape: an expression that WAS evaluated but THREW, which
  `ExpressionEvaluator` returns as its source text — indistinguishable on screen
  from a key that was never evaluated.
  
  Diagnostic only. No evaluation behaviour changes, no DOM attribute is added, and
  the whole module is behind the module-load `NODE_ENV` constant a bundler folds
  away, so production pays nothing.
  
  Two boundaries are deliberate. The scan is exactly as deep as evaluation is —
  shallow — because a nested `aria: { label: '${…}' }` keeps its raw source today
  by decision (objectui#4799 pinned that shallowness on both bags), and a deeper
  scan would report a shape the engine has not yet decided to change. And schema
  METADATA is never reported: `visible` / `visibleWhen` / `hidden` / `disabled` /
  … hold raw predicate source by design, and the diagnostic reads the set of
  values that actually leaves for the DOM, after those keys have been stripped.
  
  Part of objectui#4795 (Direction 3, per the maintainer's 2026-08-17 ruling).
  Widening the set of evaluated text keys is Direction 1 and stays deferred behind
  its named restart condition; this change deliberately does not pre-empt it.
- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [2533ec5]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [ef0d150]
- Updated dependencies [1ef236e]
- Updated dependencies [f34226e]
- Updated dependencies [564b605]
- Updated dependencies [e1d4251]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [a1609a6]
- Updated dependencies [37f6844]
- Updated dependencies [2b50261]
- Updated dependencies [ac600e5]
- Updated dependencies [c1ef923]
- Updated dependencies [af5e292]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [cf4f8a6]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
- Updated dependencies [3d053bb]
- Updated dependencies [598c89a]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [ad13d63]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [9c60144]
- Updated dependencies [d2ce342]
- Updated dependencies [a8411ad]
- Updated dependencies [9695da7]
- Updated dependencies [58b8346]
- Updated dependencies [a9e17b4]
- Updated dependencies [b8ce7dc]
- Updated dependencies [8871c14]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [d871f8e]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
- Updated dependencies [21e4585]
  - @object-ui/types@17.6.0
  - @object-ui/i18n@17.6.0
  - @object-ui/core@17.6.0
  - @object-ui/data-objectstack@17.6.0

## 17.5.0

### Minor Changes

- d9d3463: Retire four zero-consumer declared surfaces (dead-surface sweep batch 3, #4328). Each was
  measured as declared-but-never-read at the branch point, and each is removed rather than
  left as an authoring surface whose values nothing acts on.

  Breaking for anyone who typed against the removed declarations, marked `minor` per this
  repository's version-alignment convention (the major tracks `@objectstack`, never an
  API-break count):

  - `@object-ui/core` no longer exports `mergeViewsIntoObjects`. It was a second copy left
    behind by the move of that step to the provider layer, and it had drifted: it ignored a
    view container's default `list` and keyed views by the authored bare key instead of the
    composer's `<object>.<key>` identity. The live implementation — `MetadataProvider`'s, in
    `@object-ui/app-shell` — is unchanged and remains the only one. (#3775)
  - `@object-ui/types`' `RoleDefinition` no longer declares `permissions`. A role's grants
    live in `ObjectPermissionConfig.roles`, keyed by object; that is the only home any
    consumer reads (`resolveRoles` walks `inherits` and matches on `name`). The removed
    field was _required_, so five fixtures across three packages had been declaring an empty
    array for a value nothing would ever look at. Role-attached grants are now a compile
    error rather than silently ignored data. (#4288)
  - `@object-ui/react`'s `RecordContextValue` no longer declares `loading` / `error`. Both
    had zero producers and zero consumers — no host passed them, no `record:*` renderer read
    them — and only the provider's memo dependency list still named them. Record-level
    loading and error state stays where it is actually expressed: each renderer's own data
    source. (#3773)

  No behaviour change, no request-count change:

  - `@object-ui/data-objectstack` drops five `metadataCache.invalidate('views:<object>')`
    calls across `updateViewConfig` / `createView` / `updateView` / `deleteView`. No read
    path has ever populated that key — `listViews` fetches directly, uncached — so all five
    were permanent no-ops. The invalidations of the keys that do have readers
    (`view:<object>:<viewId>` for `getView`, `view-overrides:<object>` for
    `listViewOverrides`) are untouched and now pinned. (#3778)

- b953a97: fix(detail): lookup field values link to the referenced record

  A valued lookup on a record detail page rendered as plain text plus a copy
  button — the referenced document's name was visible but unreachable, so users
  copied the number and searched for it from the list page instead. Lookup cells
  inside a related list that pointed at a third object were dead the same way.

  `LookupCellRenderer` — the one cell renderer both surfaces resolve through —
  now renders the display value as a link to the referenced record. The display
  name resolution, the copy affordance and every non-lookup field are unchanged,
  and a lookup with no value still renders its placeholder rather than an empty
  link.

  The URL is not assembled in the renderer. `RelatedRecordActionsContext` gains
  an optional `recordHref` / `openRecord` pair, published by the console's
  `RelatedRecordActionsBridge` from the SAME builder its related-list row
  navigation already used, so there is one record-route shape rather than a
  second one. A host that does not provide it (Studio designer, embedded
  renderers, standalone grids) renders exactly what it rendered before.

- d7f3e30: `bridgeListView` maps the five row heights the spec admits, and only those — the four dead spellings are gone

  `mapDensity` carried a nine-key table: `compact`, `short`, `comfortable`,
  `spacious`, `small`, `medium`, `large`, `tall`, `extra_tall`. `RowHeightSchema`
  in `@objectstack/spec` admits five — `short | compact | medium | tall |
extra_tall` — so `comfortable`, `spacious`, `small` and `large` were unreachable
  from any spec-valid list view. The bridge's own parameter type said as much
  (`Partial< ListView >`), and `mapDensity` widened it back to `rowHeight?: string`
  to let them in. They survived because the fixture asserting three of them
  compiled against nothing: the package's build tsconfig excludes tests and no
  other `tsc` read them, so four branches of renderer-side dialect read as live
  capability (objectui#4352, surfaced by objectui#4040 / PR #4351).

  They are deleted. The parameter takes the spec type honestly, and the table is
  now `Record< RowHeight, … >`, so a row height added upstream fails the build here
  instead of arriving with no density. This is AGENTS.md #0.1: a lenient reading
  for off-spec metadata is a second de-facto contract, and one strict contract
  beats N dialects — a bad `rowHeight` gets fixed at the producer, where the schema
  already rejects it.

  **Breaking semantics, deliberately graded `minor`** (this repo never publishes
  `major` — its major tracks `@objectstack`). Nothing narrows in the published type
  surface: `mapDensity` is module-local and never appeared in the emitted `.d.ts`,
  and `bridgeListView`'s declaration is unchanged. What changes is runtime output,
  and only for input the spec already rejects: a host handing the bridge
  `rowHeight: 'comfortable'` (or `'spacious'` / `'small'` / `'large'`) used to get
  `density: 'comfortable'` / `'spacious'` / `'compact'` back, and now gets no
  `density` key at all, so the renderer's own default applies. A sweep of this repo,
  the `objectstack` example apps and the console's view metadata found zero authored
  uses of any of the four; the legacy `densityMode` alias cannot produce one either,
  since `DENSITY_MODE_TO_ROW_HEIGHT` is typed `Record< DensityMode, RowHeight >` and
  folds onto `compact` / `medium` / `tall`.

- a84385b: `NavigationConfig.mode` is optional — the type now says what the hook does

  `@object-ui/react` published a `NavigationConfig` that required `mode`, in front of a `useNavigationOverlay` that has always defaulted it. The declaration took the spec's authored config, `Omit`ted `mode`, and re-added it as `NonNullable< … >`; 140 lines below, the hook read `navigation?.mode ?? 'page'`. The type was strictly stricter than the implementation it fronted, and `'page'` is meaningful behaviour rather than a placeholder.

  The spec never asked for that. `NavigationConfigSchema` declares `mode: NavigationModeSchema.default('page')`, and a `.default()` lands on the authoring side as `| undefined` — so `navigation: { view: 'summary_view' }` is legal authored metadata that lets the mode default. `@object-ui/types` already re-exported the spec's own `NavigationConfig` unchanged, which meant one monorepo shipped two published types of the same name that disagreed about whether `mode` could be omitted.

  The alias is now the spec's authored config verbatim, with no divergence of its own:

  ```ts
  export type NavigationConfig = SpecAuthoredInput<
    typeof NavigationConfigSchema
  >;
  ```

  The cost of the old spelling was paid by callers. `ListView` carried `schema.navigation as NavigationConfig | undefined` for no reason except to get a valid spec-shaped value past the declaration; that assertion is deleted here, not replaced. A type in front of an implementation must not be stricter than the implementation — when it is, every caller pays in casts, and a cast is exactly the renderer-side workaround that belongs back at the producer.

  **Nothing changes at runtime.** `navigation?.mode ?? 'page'` is untouched, and the default is now pinned as observable behaviour (`useNavigationOverlay.modeDefault.test.tsx`) rather than only as a comment — the explicit modes, the `preventNavigation` and `none` short-circuits, the `onRowClick` priority, and the Cmd/Ctrl/middle-click and `new_window` branches are all pinned alongside it.

  **Why minor rather than patch**, from the measured `.d.ts`. Optional-izing a property is looser for writers and narrower for readers, so the grade turns on which role the published surface actually plays. In this package `NavigationConfig` occurs only in input positions — `useNavigationOverlay`'s `navigation?:` option and `resolveOverlayWidth`'s parameter — and never in a return type; the package consumes these values and never hands one back. For consumers the change is therefore purely permissive: every call that compiled before still compiles, and spec-shaped configs that previously needed an assertion now compile without one. That gained input shape is a real capability rather than an internal repair, which is more than a patch describes. The reader-side narrowing is real but secondary: code that imports the bare type, annotates its own value with it and reads `.mode` now sees `NavigationMode | undefined`. The in-repo census found exactly one such importer — `ListView` — and it imported the type only to write the assertion this change removes.

- c1d939f: One `SchemaNode`, and one label vocabulary — the union wins, and labels resolve where the locale lives

  Two packages published a type called `SchemaNode` and they were not the same type. `@object-ui/core` hand-declared `interface SchemaNode { type: string; … [key: string]: any }`; `@object-ui/types` exported `type SchemaNode = BaseSchema | string | number | boolean | null | undefined`, whose own doc comment names `'Plain string'` a valid node. Both were exported under one name from packages the same consumers import together, so which declaration a call site got depended on which package it happened to import from — #4548's canary measured 19 of 35 errors as exactly that collision. Core's declaration is now a re-export of types', so there is one declaration left to disagree with. Core's entry surface is unchanged: `dist/index.d.ts` is byte-identical across the change.

  Reconciling it exposed a real defect rather than a mechanical narrowing, which is why the first attempt was withdrawn instead of forced. The spec bridges write `spec.label` — the spec's `I18nLabel`, an INLINE locale map like `{ en: 'Owner', 'zh-CN': '负责人' }` — into `node.label`, and `BaseSchema.label` declared `string`. Under core's old index signature that assignment was invisibly `any`; under one honest `SchemaNode` it is a type error. `BaseSchema.label` and `.description` therefore now accept `string | I18nLabel`, and the two bridge assignments compile with their expressions untouched.

  Resolution happens at READ time, in the renderer, against the display locale — not at the bridge. Resolving at the bridge was measured unimplementable: it is a plain class method that cannot call a hook, `BridgeContext` declares no locale, and `updateContext()` has zero callers, so a bridge-resolved label would freeze one audience's language into the node tree with no re-translation channel. React's own invalidation re-translates for free at the read site.

  The widening turned every blind `schema.label`-as-string read into a named compiler error, and that inventory is the audit: it named four sites repo-wide, all one class — the label reaching a React child position, where a map does not render as `[object Object]` but THROWS `Objects are not valid as a React child`, failing the whole subtree. Three are `@object-ui/components` renderers (`filter-builder`, `sidebar-group`, `dropdown-menu`), which now resolve with the spec's own `resolveI18nLabel` against `useDisplayLocale()`. The fourth is `plugin-dashboard`'s `DashboardGridLayout` heading, which resolves with `pickLocalized` against the active UI language — matching the widget-title resolution already in that same component rather than putting two resolvers and two disagreeing locale channels in one render; the two resolvers are limb-for-limb twins with a parity test pinning them.

  One interface now carries both label vocabularies two properties apart — `label`/`description` are the spec's INLINE map, `ariaLabel` is the KEYED bundle reference — and each accepts the other's shape vacuously. That confusability is objectui#4167's known hazard, inherent to the spec's `I18nLabel` design; both shapes are named with cross-referenced doc comments stating which resolver owns which slot, and a pin asserts the two unions do not collapse into each other.

  Finally, the spec bridges declare their return type as `BaseSchema` instead of the union. Both bridges end in a single `return node` on an object literal, so the union described nothing real while forcing a narrowing at every read — 272 mechanical errors across five suites in the first round. That change is a type annotation only; the emitted JavaScript is byte-identical.

- 3f5f87c: `SchemaRenderer` states its real contract — a typed, required `schema` and a deliberate forwarding surface

  `SchemaRenderer` is the renderer loop: every registered SDUI component is rendered through it. It handed `forwardRef` a props type of `{ schema: SchemaNode } & Record<string, any>`, which puts `string` into `keyof Props`, so `'ref' extends keyof Props` was always true, React's `PropsWithoutRef` took its `Omit` branch, and `Omit` over a type carrying a string index signature keeps only the index signature. Every declared prop was erased. Measured on the pre-fix source: `keyof ComponentProps<typeof SchemaRenderer>` was `string` and `ComponentProps<typeof SchemaRenderer>['schema']` was `any`, while the type argument went on declaring `SchemaNode`. The other half is the same defect seen from the call site — `<SchemaRenderer />` with no schema at all, `<SchemaRenderer schema={12345} />`, and an arbitrary misspelled prop each type-checked in silence. This is objectui#4422 / PR #4438's trap in the most central component in the repo, spelled `Record<string, any>` rather than `[key: string]: any`, which is why every previous sweep's grep and both shipped guards' detector reported the site as clean.

  Graded **minor, not major**, on objectui#4528's reasoning: the type argument has always DECLARED `schema`; the index signature erased it from the resolved type, and restoring what the declaration documents is a fix to the published contract rather than a contract break.

  **The forwarding surface is kept, deliberately.** This component forwards every prop it does not read to the component the schema names, resolved at runtime from a plugin-extensible registry — `packages/react/README.md` documents exactly that, and `@object-ui/components`' form renderer consumes the `onSubmit` it shows being forwarded. Closing that surface would state a false contract and would force every leaf plugin's props into this package. So the two halves are separated: the `forwardRef` type argument is the honest `SchemaRendererProps`, with no index signature for `PropsWithoutRef` to collapse, and the open surface is stated once in an explicit export annotation, which nothing routes through `Omit`. The published `.d.ts` shows the erasure disappearing: `ForwardRefExoticComponent<Omit<{ schema: SchemaNode } & Record<string, any>, "ref"> & RefAttributes<any>>` becomes `ForwardRefExoticComponent<SchemaRendererProps & Record<string, any> & RefAttributes<any>>`.

  `SchemaRendererProps.schema` is declared as `BaseSchema | string | null | undefined` — what this component actually handles. It previously declared `@object-ui/core`'s `SchemaNode` interface, which requires `type: string` and so contradicted the component's own early returns for strings and nullish, while every caller held `@object-ui/types`' wider union. The erasure hid that mismatch completely.

  **One declared behaviour change.** A non-object, non-string primitive schema now renders as its own text. It previously fell through to the shallow copy `{ ...schema }`, which spreads a primitive to an empty object, lost the `type` the renderer then looked up, and surfaced the red "Unknown component type: undefined" box — an accident of the spread rather than a decision. The declared props type excludes `number` / `boolean` so no author is invited to pass them; the runtime handling is defence-in-depth for untyped callers and stored metadata. Strings, `null`, `undefined`, `0` and `false` render exactly as before, and an object naming an unregistered type still gets the error box; all four are pinned.

  Latent defects the erasure had been hiding, each surfaced by the repo-wide type-check and fixed at its call site: `DashboardRenderer` cast its widget schema to `Record<string, any>`, dropping the `type` every branch of `getComponentSchema` sets; `DashboardGridLayout`'s equivalent now states its return type instead of inferring a union that admitted a shape with no `type`; and `ReportViewer` handed a section's `content` array to the renderer whole, so a multi-node section rendered the unknown-component box instead of its content — arrays are mapped rather than widened into the renderer's declared input.

  A repo-wide structural guard replaces the two per-package siblings' blocked direction: it judges every `forwardRef` in `packages/*/src` (219 sites) and its detector resolves `Record<string, …>` and `string`-keyed mapped types in addition to literal index signatures — the spelling the previous detector went blind on. It judges the type argument only, where an index signature is an accidental eraser, and never an export annotation, where one is a stated contract.

- bb68488: Stop declaring 14 symbols under names `@objectstack/spec` owns at `17.0.0-rc.6`
  (objectui#4167, objectstack#4115).

  The rc.6 bump published nine names this repo already declared locally, on top of
  four that predate it — `check:spec-symbols` reported all thirteen at once, and a
  fourteenth (`GlobalFilterSchema`) appeared during the bump itself. Each was
  triaged on its own rather than blanket-renamed, because the right answer differs
  per symbol: five bind to the spec, three are renamed because the spec's
  same-named export means something else, five arrive by derivation, and one is a
  declared dialect with a written reason.

  **Breaking for importers of `@object-ui/react`, `@object-ui/app-shell` and
  `@object-ui/types`** — three exported names changed, because the spec exports the
  same name for a _different_ thing:

  | package               | was                | now                            | what the spec's same-named export actually is                                                                                                          |
  | :-------------------- | :----------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `react` / `app-shell` | `MetadataState`    | `MetadataCacheState`           | a metadata item's LIFECYCLE state — `'draft' \| 'active' \| 'deprecated' \| 'archived'` (`MetadataStateSchema`, `@objectstack/spec/system`)            |
  | `react` / `app-shell` | `resolveI18nLabel` | `resolveKeyedI18nLabel`        | a resolver for the INLINE per-locale map (`{ en: 'Owner', 'zh-CN': '负责人' }`) against a BCP-47 locale                                                |
  | `types`               | `DateRangePreset`  | `FilterBuilderDateRangePreset` | the thirteen HISTORICAL dashboard filter-bar presets; this one is the filter-builder set, which adds eight FUTURE windows the dashboard schema rejects |

  `resolveI18nLabel` is the one where the collision had already started costing
  something. rc.6 widened `I18nLabel` from `string` to
  `string | Record< string, string >`, so the same authored value now reaches
  either resolver — and each answers wrongly, silently, for the other's input: the
  keyed one returns `undefined` for `{ en: 'Owner' }` (no `key`, no
  `defaultValue`), and the spec's reads `key` / `defaultValue` / `params` as locale
  tags. The rc.6 bump PR met this and aliased the spec's import as
  `resolveInlineI18nLabel` in five files, with hand-written comments at two of
  them. That is a review convention, which is what objectstack#4115 exists to
  replace with a rule — so `Keyed` is now the counterpart of that `Inline`, and the
  name says which vocabulary it resolves at every call site.

  **Eleven keep their names and are now imported or derived from the spec** instead
  of re-declared: `DATE_RANGE_PRESETS`, `NavigationMode`, `AddressValue`,
  `BreakpointColumnMap`, `BreakpointOrderMap`, `KanbanConfig`, `CalendarConfig`,
  `GanttConfig`, plus the three renamed above at their new names.

  **Four of the copies were losing information, not just duplicating it.**

  - **`GanttConfig` declared six keys and called itself canonical; rc.6's
    `GanttConfigSchema` declares seventeen.** The eleven it never mentioned —
    `parentField`, `typeField`, `baselineStartField`, `baselineEndField`,
    `groupByField`, `resourceView`, `assigneeField`, `effortField`, `capacity`,
    `quickFilters`, `autoZoomToFilter` — are all read by
    `plugin-gantt/src/ObjectGantt.tsx`, through a local `GanttConfigEx`
    intersection that existed only because this type did not carry them. It now
    derives from the spec, with `timeSegments` (shift segmentation) as the one
    genuinely local extension; the schema is `$loose` upstream, so that key is
    legal metadata rather than a second dialect.
  - **`GanttConfig.tooltipFields` carried the comment "not part of the upstream
    GanttConfigSchema".** It is, as of rc.6, so the key now arrives from the spec.
  - **`AddressValue` declared five of the spec's seven parts** — `countryCode` and
    `formatted` were missing, under a comment already claiming to be "the part
    names of `AddressSchema`". The widget still renders five inputs; binding the
    type stops it from asserting the platform cannot store the other two, and makes
    the `{ ...address }` write-through say so.
  - **`DATE_RANGE_PRESETS` was `Object.keys(PRESET_RANGES)`,** a third copy of a
    vocabulary the spec extracted in objectstack#4614 precisely to collapse — its
    own doc comment names this module as one of the three. It is now the spec's
    array by reference, and the local date-macro bounds table is pinned complete
    against it with `satisfies`, so a preset the schema gains without bounds here
    is a compile error rather than a filter that validates clean and then selects
    nothing.

  `NavigationMode` was one hop from the spec already (`NavigationConfig['mode']`);
  it is bound directly, with a both-directions type pin that it stays the same type
  as the config's own `mode`. `KanbanConfig` / `CalendarConfig` /
  `BreakpointColumnMap` / `BreakpointOrderMap` were exact hand copies of `$strict`
  schemas and are now re-exports — "still exact" is the argument for binding them,
  since a copy with nothing to protect can only drift.

  `GlobalFilterSchema` is the one ALLOW entry. It is the same spread-composition
  dialect as `SelectOptionSchema` next to it, and it collided only because rc.6's
  new refinement forced `.extend()` to be respelled as a `.shape` spread — which
  moved a derivation the guard could see into an object literal it deliberately
  does not descend into. The dialect is unchanged and its three divergences are
  pinned; which side moves on the refinement itself is objectui#4165.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/layout`: its public type surface now references the spec.

### Patch Changes

- ceccdcf: Action confirm dialogs and success toasts now honour the bundle's translated
  `confirmText` / `successMessage`, not just `label` (objectui#4265).

  A TranslationBundle entry for an action carries three keys under one
  `_actions.<name>` node — `label`, `confirmText`, `successMessage` — and
  `useObjectLabel()` has always exposed a resolver for each. What had drifted was
  the call sites: `page:header` (authored record pages), `record:quick_actions`
  and the related-list row menu resolved the button `label` only and dispatched
  the authored `confirmText` / `successMessage` untouched. One bundle entry met
  two fates: the button rendered the translation, the confirm dialog rendered the
  authored English.

  All action-rendering surfaces now go through one resolver,
  `useActionTextLocalizer()` (new, exported from `@object-ui/react`), which
  applies the existing `actionLabel` / `actionConfirm` / `actionSuccess`
  resolvers over the three keys together. Fallback is unchanged: with no bundle
  entry — or an entry lacking a key — the authored text renders. A bundle cannot
  introduce a `confirmText` or `successMessage` the metadata never declared.

- ee26e65: Analytics: the dimension label net's fetch-and-memo glue is written once, not once per surface

  PR #4388 (objectui#4330) put the same React glue on two surfaces — the dashboard's `DatasetWidget` and plugin-report's dataset block. The resolution RULES were never duplicated (both call the same `@object-ui/core` helpers), but the wiring around them was: read the object schema through the host's authenticated `apiFetch`, keep the fetched metadata locale-free in state, derive the label maps in a render memo. Two copies meant two statements of the same two bug fixes, which is a drift surface rather than a defect — nothing a user could hit today, filed as objectui#4389 so it was retired deliberately.

  It is now split along the layer that can actually hold each half. `@object-ui/core` gains the React-free parts — `loadDimensionFieldMeta` (the base-object read composed with the dimension walk), `deriveDimensionLabelMaps` (the locale-applying derivation) and `dimensionOptionTranslator` (binding the bundle resolver to the object that OWNS a terminal field, which for a dotted path is the relationship target). `@object-ui/react` gains `useDatasetDimensionLabels` / `useDatasetDimensionMeta`, the React wiring that cannot live in core, beside the `useViewData` / `useElementDataSource` / `useDiscovery` hooks that already read `SchemaRendererContext` the same way. Both plugins consume it; the dashboard keeps its chart-only per-category colour and category-order derivation layered locally, since a table renders no palette.

  The card originally proposed `@object-ui/core` as the whole glue's home. That home was disproven by measurement and retired in the card's PM RULING #2: `SchemaRendererContext` is defined in `@object-ui/react`, which depends on core, so core importing it back is a cycle — and core is React-free by declaration, by content, and by the topology in AGENTS.md. objectui#3367 had already ruled this direction for the same family (core-canonical logic, react re-exports).

  Behaviour is unchanged by construction: same read count, same best-effort fallback, same memoization boundary. The two bug fixes are now stated once and pinned at the shared hook — the read rides the host's authenticated `apiFetch` (objectui#4121, pinned by asserting that a new channel re-issues the read, i.e. that it really is in the effect's deps), and the fetched metadata stays locale-free (objectui#4030 / PR #4324, pinned by switching language at runtime and asserting the labels flip with no second metadata read). All 39 assertions PR #4388 landed across both surfaces pass unchanged, and their files are byte-identical to before.

- f650253: `BaseSchema.ariaLabel` declares the keyed i18n vocabulary the renderer actually
  resolves, `.disabled` accepts the predicate string it actually evaluates, and the
  keyed shape finally has a name (objectui#4581)

  Three slots on one base type had drifted from what the renderer does with them.
  PR #4593 fixed `visible` and measured the rest; these are the rest.

  `ariaLabel` was `string`, but `SchemaRenderer.tsx:111` resolves it with
  `resolveKeyedI18nLabel`, whose input is the KEYED form
  `{ key, defaultValue?, params? }` — a reference into a translation bundle. It is
  now `string | KeyedI18nLabel`, and `KeyedI18nLabel` is a new exported type in
  `@object-ui/types` rather than a fourth inline copy of one object literal: the
  three that existed (`@object-ui/react`'s resolver, `@object-ui/layout`'s
  `resolveLabel`, `@object-ui/app-shell`'s `t`-taking twin) were verified identical
  in their object half first, and two of them now import the name.

  The vocabulary matters more than the widening. `#4581` originally asked for
  `string | I18nLabel`, and that spelling was withdrawn as measured-wrong: the
  spec's `I18nLabel` is the INLINE LOCALE MAP (`string | Record<string, string>`),
  a different vocabulary resolved against a BCP-47 locale by a different function
  of a confusingly similar name. Under it the shipped keyed fixture type-checked
  only vacuously — as a locale map whose "locales" are named `key` and
  `defaultValue` — the same label carrying `params` was rejected outright, and a
  genuine `{ en: 'Owner' }` compiled while rendering an EMPTY `aria-label`. Naming
  the keyed shape is the declaration half of the fix objectui#4167 started on the
  naming side; `@object-ui/app-shell`'s copy keeps its inline spelling for now
  because an open PR has a pending change to that file, and the comment there says
  so.

  `disabled` was `boolean` on a key the renderer never reads as one:
  `SchemaRenderer.tsx:466` evaluates it through the same `evaluateCondition` as
  `visible`, and a `disabledOn?: string` sibling exists for the same reason. It is
  now `boolean | string`. The asymmetry with `visible` was accidental rather than
  deliberate.

  Both are widenings on authored-input-dominant properties: authors gain a
  spelling, nothing that type-checked before stops doing so, and readers already
  coped with `any` through `BaseSchema`'s index signature. Three test fixtures that
  had been casting past these declarations with `as unknown as BaseSchema` state
  their values directly now, and the declared unions are pinned invariantly so
  neither a missing widening nor an overshoot to `any` can pass unnoticed.

  Declaring the vocabulary honestly also surfaced a real one: the `toggle`
  renderer writes `aria-label` itself instead of going through SchemaRenderer's
  resolver, and it forwarded the raw value. Invoked directly it emitted
  `aria-label="[object Object]"` for a keyed label — announced verbatim by a
  screen reader. It resolves now. Through `SchemaRenderer` the bug was invisible,
  because SchemaRenderer injects its own resolved `aria-label` afterwards; a
  downstream type-check sweep found it, not a test.

  `BaseSchema.label` and `.description` are deliberately unchanged and pinned that
  way. They receive the spec's inline `I18nLabel` from the view bridges, which is a
  real defect, but resolving it belongs at the spec-to-schema boundary rather than
  in this declaration — and that work is still blocked on a design question about
  where the display locale enters, so it is not in this release.

- 8f85f8b: The spec bridge abstains on prototype-member `rowHeight` spellings instead of leaking a
  function into `density`.

  `bridgeListView`'s `mapDensity` indexed a plain object literal with an unchecked key, so
  the lookup reached `Object.prototype`. The parameter is typed `RowHeight`, but the
  boundary a host's stored view definition actually crosses is `SpecBridge.transformListView`,
  whose parameter is `any` — so `rowHeight: 'toString'` came back as `Object.prototype.toString`,
  a **function**, out of a read whose return type is three strings or nothing. `bridgeListView`
  then writes the key under `if (density)`, and a function is truthy, so the bad value was not
  merely returned: it was stored on a `SchemaNode` whose renderer expects
  `'compact' | 'comfortable' | 'spacious'`. Same for `constructor`, `valueOf`,
  `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable` and `toLocaleString`.

  The lookup is now guarded with `Object.prototype.hasOwnProperty.call(...)` — the same guard
  `@object-ui/core`'s `rowHeightToDensityMode` grew in objectui#4440, and the repo's existing
  convention at eight other sites. Both `rowHeight` surfaces now abstain identically on every
  off-spec **string** spelling, and objectui#4440's agreement pin covers the prototype-member
  family instead of excluding it (objectui#4442).

  Runtime-only: no public type moved, and no spec-valid `rowHeight` changes its answer.

- d0c3b26: Every plain `<button>` now declares its `type`. HTML defaults an untyped button to
  `type="submit"`, so any of these buttons would submit the form it was composed into
  instead of running its own handler — a real risk for renderers (`drawer`, `tree-view`,
  `navigation-overlay`) whose placement inside a form is a JSON metadata decision. 114
  sites were converted to `type="button"`; no site was a genuine submit button, and the
  DOM is otherwise unchanged.

  The defect class is now closed mechanically by a new `object-ui/button-has-type` ESLint
  rule (error), so the next untyped button fails CI at write time rather than being found
  by a fourth audit round (objectui#4045, closing the objectui#3344 family).

- f148a64: SpecBridge lifts a legacy bare `exportOptions` array to the spec's object form, so a
  spec-authored view's declared export formats reach the grid (objectui#4585).

  A spec `ListView` may spell `exportOptions` either way, and `@objectstack/spec` lifts the
  legacy bare format array to `{ formats: [...] }` when it parses one (objectstack#8010).
  That lift never ran on the bridge path: the bridge's input is a TypeScript type, not a
  parsed value — there is no `parse`/`safeParse` anywhere under `spec-bridge/` — so a host
  forwarding raw stored metadata handed the array straight through, and the bridge copied it
  onto the `object-grid` node verbatim. ObjectGrid reads the object form and only that, and
  `.formats` on an array is `undefined`, so the renderer's `['csv', 'json']` default won.

  A view declaring `['csv', 'xlsx']` therefore rendered an export menu offering CSV and
  JSON: the declared xlsx never appeared, an undeclared json did, and nothing said so — the
  export button still showed, because a non-empty array is truthy. The bridge now applies
  the spec's own transform at the assignment site, so both spellings leave it as one shape.

  Deliberately narrow: this mirrors the spec's lift and nothing else. The object form passes
  through by reference, unread and unrewritten; a view with no `exportOptions` is untouched;
  and a `'pdf'` stored before its retirement is carried rather than filtered, because the
  spec refuses that value at parse with a migration prescription instead of silently
  dropping it — such a format still dies downstream in ObjectGrid's format-agnostic menu
  filter (objectui#4535). The fix is at the producer for the same reason: a tolerant
  `Array.isArray` fallback in the renderer would make a second de-facto contract out of one
  spec key.

  One behavior follows from reading the lift literally: `exportOptions: []` now lifts to
  `{ formats: [] }` and the export button is hidden, where before the unreadable `[]` was
  merely truthy and produced a menu built entirely from the `['csv', 'json']` default. A
  view that declares zero formats now offers zero.

- 47f551b: fix(react): the spec bridge abstains on a non-string `rowHeight` instead of coercing it to a density, matching core

  `mapDensity` opened with a truthiness guard, so any **truthy non-string** survived it and was
  then coerced into a lookup key — both `Object.prototype.hasOwnProperty.call` and the table index
  run `String(...)`. `rowHeight: ['compact']`, a boxed `String('compact')` or
  `{ toString: () => 'compact' }` therefore each selected a real density, while
  `@object-ui/core`'s `rowHeightToDensityMode` — which opens with `typeof rowHeight !== 'string'` —
  abstained for the same input. Two published surfaces, two answers for one input.

  The bridge now opens with core's type guard. An off-spec non-string `rowHeight` renders exactly
  like an absent one, and the producer is where it gets fixed (AGENTS.md #0.1). Behaviour for the
  five spec row heights and for off-spec **strings** is unchanged; `''` keeps its answer by a
  different route (a string now, refused one line later because it is not one of the five keys).

  Note the direction against the previous fix in this function: that leak returned a _function_,
  visibly wrong to everything downstream. This one returned a legitimate-looking `'compact'` that
  nothing downstream could tell apart from an authored density.

- Updated dependencies [0e67b53]
- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [537a0d1]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [1f9b905]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [5cc847c]
- Updated dependencies [fa21254]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [6d641c9]
- Updated dependencies [479cc7b]
- Updated dependencies [7e4f0e5]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [c0f9a4b]
- Updated dependencies [2459a3e]
- Updated dependencies [2776b11]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [d46f9b8]
- Updated dependencies [605b747]
- Updated dependencies [2fea4d2]
- Updated dependencies [7f1cb33]
- Updated dependencies [bb68488]
- Updated dependencies [2e3b0c0]
- Updated dependencies [9461dd3]
- Updated dependencies [78fa331]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [b42558a]
- Updated dependencies [d2f6e6b]
- Updated dependencies [ab04728]
- Updated dependencies [85a3082]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/data-objectstack@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Minor Changes

- 5bfaabd: `PageComponentSchema.dataSource` now reaches every object-bound block, not just
  `list-view` — and `element:record_picker` stops discarding `view`
  (objectstack#6953).

  objectstack#5576 wired the spec's per-element data binding
  (`dataSource: { object, view?, filter?, sort?, limit? }`) to `list-view` and left
  the same declaration inert on every other page component. Two gaps remained, and
  both were silent:

  - **`element:record_picker` read four of the five keys and dropped `view`.** So
    `dataSource: { object: 'account', view: 'hot' }` — the spec's own example —
    built a picker over EVERY account instead of the rows the saved view selects.
    Nothing threw and nothing rendered an error; the option list was simply wider
    than what was authored, which also means a user could select a record the page
    said was out of scope.
  - **`object-grid` / `object-form` / `object-kanban` / `object-calendar` /
    `object-chart` / `object-metric` / `record:related_list` read none of it.**
    Each gates its fetch on its own `objectName`, and nothing mapped
    `dataSource.object` onto it, so a page written the way the spec documents
    rendered an empty grid / a field-less form / a board with no cards / an empty
    month / an empty chart / a static metric number — with no request and no
    diagnostic anywhere. Spec-valid metadata rendering nothing is the
    objectstack#4413 shape.

  Composition follows objectstack#5576's landed semantics unchanged on every block:
  a named saved view supplies the baseline, a key written on the component itself
  overrides it, an explicit binding key overrides both, `filter` AND-combines
  ("additional filter criteria" — a binding can narrow a view, never widen it), and
  a `view` name that does not resolve renders a configuration error instead of
  degrading to the object's full scope.

  - `@object-ui/react` — new `useElementDataSourceSchema(schema, mapping, dataSource?)`
    and `ElementDataSourceGate` apply a resolved binding to the schema keys a given
    block reads, plus `ElementDataSourceErrorPanel` / `ElementDataSourceLoadingPanel`
    for the two non-final states. One precedence table for all blocks rather than
    one copy per block — that copy is how "additional filter criteria" would have
    become two dialects.
  - A mapping names **only** keys its block genuinely reads. A composed value
    written onto a key the block ignores would be accepted and dropped, which is
    the defect being removed, one layer deeper — so a kanban's swimlane `columns`
    never receive a view's field list, and a block with no row cap leaves `limit`
    unmapped. The per-block coverage table, including two residual gaps that are
    named rather than papered over, is in `content/docs/guide/data-source.md`.

  No behaviour changes for a block that carries no `dataSource`: the binding-free
  path returns the schema by reference, so nothing remounts and nothing refetches.

- 48132f7: Track the `@objectstack` family at `17.0.0-rc.5` (objectui#3560).

  The pin moves from `^17.0.0-rc.2` to `^17.0.0-rc.5` across all 37 declarations in
  30 `package.json` files, and the sibling `@objectstack/*` packages (`client` /
  `formula` / `lint`) move with it — they pin `@objectstack/spec` **exactly**, so
  leaving them behind would keep a second copy of the spec in the tree and have
  `@objectstack/lint` validating against schemas that still accept the keys rc.3–rc.5
  retire. `pnpm-lock.yaml` now resolves one copy of each of the six family packages
  (`spec` / `client` / `core` / `formula` / `lint` / `sdui-parser`), all at rc.5.

  Bumping the pin and repairing the fallout cannot be split: the pin alone reddens
  CI, and the code alone targets a shape that is not in effect yet.

  ## A live bug this upgrade fixes

  **`ObjectStackDataSource.delete()` never emitted its mutation event, and resolved
  `undefined` instead of a boolean.** `@objectstack/client`'s `DeleteDataResult`
  declared a key called `deleted` — a key no schema has ever declared and no server
  path has ever returned on `DELETE /data/:object/:id`. So `result.deleted`
  compiled and read `undefined` at runtime: the guard never fired, a successful
  delete notified no subscriber, and every consumer's cache stayed stale.
  objectstack#5638 corrected the interface to the schema's `success`; following the
  rename is what restores both behaviours. Nothing in this repo had to change shape
  for it — the code was already asking the right question of the wrong key.

  ## Breaking, in FROM → TO form

  - **The five `@objectstack/spec/ui` interaction-config modules are gone** —
    touch / dnd / keyboard / animation / offline, 32 defs and 64 exports
    (objectstack#4988, PR objectstack#5321). None of them had an authoring door: no
    metadata document could ever carry one of these blocks, so a stack that parsed
    before the retirement parses byte-for-byte the same after it. `@object-ui/types`
    drops the 32 `export type` re-exports. The vocabulary each one's only real
    consumer needs is now declared by that consumer, which is the remedy the spec's
    own retirement ledger prescribes ("declare that union locally — it is your
    client's policy, not the platform's"):

    - `@object-ui/react`'s `useOffline` owns `OfflineStrategy`, `ConflictResolution`,
      `PersistStorageType`, `EvictionPolicyType`, `OfflineConfig`,
      `OfflineCacheConfig`, `OfflineSyncConfig`;
    - `@object-ui/core`'s `DndProtocol` / `KeyboardProtocol` own `DndConfig`,
      `DragItem`, `DropZone`, `DragConstraint`, `DragHandle`, `DropEffect`,
      `KeyboardNavigationConfig`, `KeyboardShortcut`, `FocusManagement`,
      `FocusTrapConfig`;
    - `@object-ui/types`' `mobile` module owns `SpecGestureConfig`,
      `SwipeGestureConfig`, `PinchGestureConfig`, `LongPressGestureConfig`,
      `TouchTargetConfig`, `TouchInteraction` (plus a new `SPEC_GESTURE_TYPES`
      runtime tuple), so `@object-ui/mobile`'s import paths are unchanged.

    Every shape is moved verbatim — same keys, same members, same optionality — so
    no hook or bridge changes behaviour. Consumers importing these names from
    `@object-ui/types` must import them from the owning package instead. Note the
    spec's _surviving_ `ConnectorConflictResolution` (`/integration`, connector sync)
    and `ConflictResolutionStrategy` (`/api`, route merge policy) are **different
    concepts** — do not re-point at them.

  - **`@object-ui/types` no longer re-exports `NotificationAction` or `EmbedConfig`**
    (objectstack#5015, PR objectstack#5300). Both were published `ui` vocabulary with
    no authoring door; no notification action was ever parsed from metadata and no
    iframe route ever read an embed config. The presentation enums
    (`NotificationType` / `NotificationSeverity` / `NotificationPosition`) and
    `SharingConfig` **survive** and are untouched — public form sharing still gates
    the anonymous endpoints on `allowAnonymous` + `publicLink`.
    `@object-ui/core`'s `SharingProtocol` keeps `resolveEmbedConfig` /
    `generateEmbedCode` against a locally declared `EmbedConfig`, so its surface is
    unchanged.
  - **`ThemeEngine` stops emitting nine retired CSS variable groups**
    (objectstack#5021 option 2, PR objectstack#5289). `theme.animation`,
    `theme.zIndex` and five typography groups (`fontSize` / `fontWeight` /
    `lineHeight` / `letterSpacing`, plus `fontFamily.heading` / `fontFamily.mono`)
    are tombstones the schema now rejects by name, so `--duration-*`, `--timing-*`,
    `--z-*`, `--font-size-*`, `--font-weight-*`, `--line-height-*`,
    `--letter-spacing-*`, `--font-heading` and `--font-mono` had become structurally
    dead code — no author could produce the input that reached them.
    `generateAnimationVars` and `generateZIndexVars` are removed from
    `@object-ui/core`, and `@object-ui/types` drops `Animation` / `ZIndex` /
    `AnimationSchema` / `ZIndexSchema`. **`theme.customVars` is the declared — and
    since #5021 the only — door**: each entry is emitted verbatim as
    `--<key>: <value>`, so a `--z-modal` or a `--duration-fast` goes there now.
    LIVE emission is untouched byte for byte: `colors`, `borderRadius`, `shadows`,
    `typography.fontFamily.base` (→ `--font-sans`) and `customVars`.
  - **`@object-ui/types`' `HttpMethodSchema` now binds the spec's
    `HttpMethodSubsetSchema`, and `HttpMethod` binds `HttpMethodSubset`**
    (objectstack#5832, PR objectstack#5976 — objectui#3499). The spec renamed its
    5-value UI subset because `schemaNameFromExportKey` strips the `Schema` suffix,
    so the 5-value and 7-value enums both published as `shared/HttpMethod` and the
    later write won — the emitted JSON Schema and reference page described only one
    of them. **The runtime domain is unchanged and this repo's exported names are
    unchanged**; this follows the rename without touching cross-package semantics.
    Deliberately NOT re-pointed at the spec's bare `HttpMethod`: that is the 7-value
    enum, and widening to it would let `method: 'HEAD'` compile and then throw in
    `HttpRequestSchema.parse()`.
  - **`dashboard.widgets[].actionUrl` / `actionType` / `actionIcon` / `aria` are
    refused, not stripped** (objectstack#5010, ADR-0049 enforce-or-remove). A
    dashboard widget has no action button and never had one — every action the
    dashboard dispatches comes from `header.actions[]` — and no renderer ever applied
    the widget `aria`, so it promised accessibility compliance it did not deliver.
    A stale dashboard now gets a named error telling it where the affordance moved,
    instead of silently losing it. Run `os migrate meta --from 16` to rewrite.

### Patch Changes

- 8aad9fd: Action-face predicates written against the canonical `record.` root now evaluate

  `action:button`, `action:icon`, `action:menu` and `action:group` gated their
  actions on `useCondition(pred, context)`, which evaluates on
  `new ExpressionEvaluator({ ...scope, ...context })` — and the context each of
  them passed was the row spread flat, or nothing at all. Only the shorthand
  spelling resolved:

  | predicate                    | verdict, before                  |
  | ---------------------------- | -------------------------------- |
  | `status == "pending"`        | evaluates (`action:button` only) |
  | `record.status == "pending"` | throws `record is not defined`   |
  | `data.status == "pending"`   | throws `data is not defined`     |

  `record.` is not a mistaken spelling — it is the canonical one. It is what
  `ExpressionEvaluator`'s CEL path binds (`bag.record` as the record namespace),
  what `evalRowPredicate` binds on the record header, list rows, the row kebab
  and conditional formatting (`record.status` / bare `status` / `data.status`),
  and what the server enforces with. A `visible` that fails CLOSED turns the throw
  into "hidden", so a correctly-authored predicate deleted its own button —
  indistinguishable from the gate having said no. On the fail-soft legs the same
  throw lands the other way: `disabled` greyed a control out for everyone.

  Live rather than theoretical: every declared action on framework's
  `sys_approval_request` gates on `record.viewer.*`, so the whole server-declared
  approval decision set was invisible wherever the declared-action bar rendered
  until objectui#4077 fixed that bar. These four generic renderers carried the
  same binding.

  What changed:

  - all four bind the row the three canonical ways, through one named helper
    (`usePredicateRecordContext`, exported from `@object-ui/react` beside
    `useCondition`), so the action face and the row surfaces answer an author's
    `visible:` the same way;
  - `action:icon` reads the row at all. It evaluated against an empty bag, so not
    even the bare-field shorthand resolved — and its `data` prop was landing in
    the props spread onto the DOM button;
  - `action:menu`'s items and `action:group`'s two leaves receive the row from
    their host, which they previously never got;
  - `action:bar` forwards the row into the overflow menu it builds, not just to
    its inline members. An action's predicate had been answering a different
    question purely because it spilled past `maxVisible` — which on mobile
    defaults to 1, making the verdict a function of the viewport.

  Deliberately unchanged: the evaluation entry and each site's error policy. A
  predicate that genuinely faults still fails closed on `action:button` /
  `action:menu` `visible` and still fails soft on the other legs, exactly as
  before; `toPredicateInput`, `hasDeclaredVisibilityGate` and the empty-predicate
  rules keep their pinned semantics. Binding the row is a separate question from
  what to do when the predicate faults.

  A surface with no row of its own binds nothing rather than an empty record, so
  a host that supplies the row through the ambient predicate scope is not blanked
  out; a row passed explicitly still wins over the scope.

- e06810e: `PageComponentSchema.dataSource` is now consumed instead of discarded — a
  `list-view` page component can reference a **saved view by name** for the first
  time, and writing the binding no longer breaks the component
  (objectstack#5576).

  The spec declares a per-element data binding on every page component —
  `dataSource: { object, view?, filter?, sort?, limit? }` — and objectui read none
  of it. `ViewDataProvider.resolveElementDataSource` forwarded
  `filter`/`sort`/`limit` and dropped `view` entirely, and had no caller outside its
  own test; nothing mapped `object` onto the `objectName` a list actually reads. So
  "reference a saved view by name" was published, validated and inert, and every
  page that wanted a saved view's columns/filter/sort had to inline a second copy of
  them — the drift the binding exists to remove.

  Writing the binding also **broke** the block, for a reason unrelated to `view`:
  `SchemaRenderer` spread the schema's `dataSource` metadata onto the component as a
  React prop, and that is the prop name the host uses to inject the data-source
  ADAPTER. The plain `{ object, view }` object shadowed the adapter, so the first
  `dataSource.find(…)` threw `dataSource.find is not a function` and `list-view`
  rendered "Couldn't load records" — a spec-compliant component failing next to
  identical ones that omitted the binding.

  - `@object-ui/react` — `SchemaRenderer` no longer spreads `schema.dataSource` as a
    prop (it is metadata, like `visibleWhen`); renderers read it off `schema`. An
    explicit React `dataSource` prop is unaffected. New
    `useElementDataSource(schema, dataSource?)` hook resolves a binding, fetching
    the named saved view from the object definition's `listViews` and the metadata
    overlay's `listViews()`.
  - `@object-ui/core` — new `isElementDataSourceConfig` / `collectSavedViews` /
    `resolveSavedView` / `composeElementDataSource`, and `resolveElementDataSource`
    now honours `view` through an optional `DataFetcher.fetchViews`, reporting an
    unresolvable view as an error instead of silently returning every record.
    `resolveViewId` moved here from `@object-ui/app-shell` (re-exported there) so
    one matcher serves both the object page and a page component.
  - `@object-ui/plugin-list` — `list-view` maps the binding onto the props
    `ListView` reads. `dataSource.*` keys are authoritative, view-supplied values
    are a baseline the component's own keys override, and `filter` AND-combines at
    every level (the spec calls the binding's filter "additional criteria"), so a
    binding can narrow a saved view but never widen it. A `view` name that does not
    resolve renders a configuration error naming the object's actual views and
    issues no query — it never falls back to the object's default view, because that
    turns a typo into a silently wider answer.

- ab3ad4f: An empty predicate is no longer a declared gate anywhere (objectui#3850, objectui#3862)

  "Is a gate DECLARED on this key — is there a condition to reach a verdict on?" was
  answered three times in this repo, with three different scopes, and the widest
  answers sat on `disabled`, where the mistake is not benign:

  - `hasDeclaredVisibilityGate` (the action face) asked `!= null && !== ''`, so every
    OBJECT counted — including `{ dialect: 'cel', source: '' }`. That envelope is not
    a hand-written curiosity: `@objectstack/spec`'s `ExpressionInputSchema` normalizes
    every authored predicate into one, so "the author left the predicate empty"
    compiles to exactly it. The verdict path normalized the same value back to
    `undefined`, and `evaluateCondition(undefined)` answers `true` — "no condition, so
    visible/enabled". On `visible` that `true` means SHOW, so the two mistakes
    cancelled; on `disabled` it means GREY, so they compounded: a button disabled
    forever that no author asked to disable (objectui#3850, the residue objectui#3842
    left behind).
  - `SchemaRenderer` asked `disabled !== undefined` inline, one notch wider again, so
    `disabled: null` greyed out too — on the GENERIC rendering path, since that block
    runs for every node type, and not as an internal flag either: `_disabled` is
    forwarded to the component as a real `disabled` prop (objectui#3862).
  - `ActionRunner`'s execution gates asked "does this normalize to something
    evaluable?" — the scope that turned out to be right (objectui#3848 / objectui#3872).

  There is now ONE definition, `hasDeclaredPredicate`, exported from
  `@object-ui/core` (`evaluator/declaredPredicate.ts`, beside the `toPredicateInput`
  normalizer it is derived from): a gate is declared when normalization still leaves a
  condition to evaluate. `''`, a whitespace-only string, an empty-`source` envelope
  and any non-predicate value (`0`, `{}`) are NOT declared; `false` IS (a verdict is
  not a missing gate — objectui#3812). `hasDeclaredVisibilityGate` keeps its name as a
  re-export of it, so the five member-action renderer call sites, `DeclaredActionsBar`
  and `record-quick-actions` are unchanged and inherit the scope;
  `SchemaRenderer`'s `disabled` / `disabledOn` chain and `ActionRunner`'s two gates
  read the same function. No consumer got a local "and also check for empty" test —
  that fourth dialect is what objectui#3842 / objectui#3849 spent two PRs merging away.

  Measured behaviour change, `action:button` and the generic path, before → after:

  | value                                                     | `visible`      | `disabled` | `enabled` | `SchemaRenderer` `disabled` prop |
  | --------------------------------------------------------- | -------------- | ---------- | --------- | -------------------------------- |
  | `''`                                                      | shown → shown  | on → on    | on → on   | forwarded → absent               |
  | `null`                                                    | shown → shown  | on → on    | on → on   | forwarded → absent               |
  | `{ dialect: 'cel', source: '' }`                          | shown → shown  | GREY → on  | on → on   | forwarded → absent               |
  | `{ source: '' }`                                          | shown → shown  | GREY → on  | on → on   | forwarded → absent               |
  | `'   '` (whitespace)                                      | HIDDEN → shown | on → on    | GREY → on | forwarded → absent               |
  | `0` / `{}` (not predicates)                               | shown → shown  | GREY → on  | on → on   | forwarded → absent               |
  | `true` / `false` / bare CEL / `${…}` / non-empty envelope | unchanged      | unchanged  | unchanged | unchanged                        |

  Every row moves toward "there is no gate here", never away from it, and no value
  that HAS a verdict changes it — the verdict is still read from the raw value, only
  the gate in front of it narrowed. Two rows are behaviour changes rather than the
  equivalence the ruling expected, and are pinned as such: the whitespace string moves
  on `visible` / `enabled` (it used to normalize to `'${   }'`, which evaluates falsy,
  so a predicate that says nothing HID the action from everyone), and non-predicate
  junk stops greying controls out (fail-open, the posture `ActionRunner` already
  committed to).

  One blank spelling is knowingly still outside the scope: an envelope whose `source`
  is blank but not EMPTY (`{ dialect: 'cel', source: '   ' }`) — the normalizer folds a
  `source` of `''` and does not trim, so the string spelling of a blank predicate is
  trimmed and the envelope spelling is not, and `disabled` still greys out for that one
  value. The ruling enumerated three empty spellings; this is a fourth, measured and
  filed as objectui#3960 rather than widened in here.

  One chain is deliberately untouched: `SchemaRenderer`'s `visible` / `visibleWhen` /
  `visibleOn` / `visibility` / `hidden` / `hiddenOn` legs keep `!== undefined`, because
  narrowing them would change ALIAS PRECEDENCE, not just emptiness. The `hidden` legs
  are not negated and therefore carry this same defect with the polarity that makes the
  node vanish — measured, out of this ruling's scope, filed as objectui#3955.

- 0109f54: Blank predicates and non-predicate values are no longer gates, at the last three entries that still judged them (objectui#3955, objectui#3957, objectui#3960)

  objectui#3850 sank "is a predicate gate DECLARED here?" into one definition,
  `@object-ui/core`'s `hasDeclaredPredicate`. Three places were left out of that
  ruling's placement clause, each with the same shape of defect: the evaluator's
  single default for "there is nothing here to evaluate" is `true`, meaning
  _visible/enabled_, and wherever a too-wide "declared" test hands it an empty
  predicate on an INVERTED key, that `true` turns a control off for a value the
  metadata never used to say anything.

  **`SchemaRenderer`'s `hidden` / `hiddenOn` legs (objectui#3955)** asked
  `!== undefined` and did NOT negate the verdict, so an empty predicate meant HIDE
  and the node disappeared — on the generic rendering path, since that block runs
  for every schema type. Harder to diagnose than the `disabled` twin objectui#3862
  fixed: a greyed-out control is still on screen, while a node that never rendered
  is indistinguishable from metadata that meant to hide it. Both legs now read the
  shared definition.

  **The "blank" criterion now covers the envelope spelling (objectui#3960).** The
  definition trimmed a whitespace-only STRING and not an envelope's whitespace-only
  `source`, because `toPredicateInput` folds a `source` of `''` and does not trim.
  So `{ dialect: 'cel', source: '   ' }` was a declared gate whose verdict came from
  core's own CEL entry calling that exact value "no predicate" (`if (!source.trim())
return true`) — `disabled` greyed out forever and `ActionRunner.execute` answered
  `{ success: false, error: 'Action is disabled' }` with the handler never invoked.
  Blankness is now decided once for both spellings, at the definition. The
  NORMALIZER's contract is deliberately unchanged: "what shape does the evaluator
  accept" is not the same question as "is there a condition", and moving the trim
  there would have flipped verdicts for every
  `useCondition(toPredicateInput(…))` call site, including container-level `visible`
  reads that never asked this question at all.

  **`ActionEngine.getActionsForLocation`'s `visible` filter (objectui#3957)** was the
  last consumer answering the question with a range of its own — three empty
  spellings folded by hand, everything else coerced with `Boolean(raw)`. It now reads
  the shared definition and the coercion branch is gone, so one value no longer gets
  two answers depending on whether an action was surfaced by the engine or rendered
  standalone (the invariant objectui#3314 established). Its fail-CLOSED posture on a
  predicate that THROWS is untouched (`throwOnError: true` + `warnHiddenPredicate`):
  "the predicate faulted" and "there is no predicate" are different facts.

  Behaviour changes, before → after. Observation-class: each needs an author to write
  an empty/blank predicate or a non-predicate value, and there is no known user path
  today.

  | value                                                       | `ActionEngine` `visible` | `SchemaRenderer` `hidden` | `disabled` (action face + generic path) | `ActionRunner.execute` `disabled` |
  | ----------------------------------------------------------- | ------------------------ | ------------------------- | --------------------------------------- | --------------------------------- |
  | `''` / `null`                                               | shown → shown            | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `'   '` (blank text)                                        | HIDDEN → shown           | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `0` / `NaN`                                                 | HIDDEN → shown           | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `{}` / `[]`                                                 | shown → shown            | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `{ dialect: 'cel', source: '' }`                            | shown → shown            | HIDDEN → rendered         | unchanged                               | unchanged                         |
  | `{ dialect: 'cel', source: '   ' }`                         | shown → shown            | HIDDEN → rendered         | GREY → on                               | refused → runs                    |
  | `{ source: '   ' }` (no dialect)                            | HIDDEN → shown           | HIDDEN → rendered         | GREY → on                               | refused → runs                    |
  | `true` / `false` / bare CEL / `${…}` / a non-blank envelope | unchanged                | unchanged                 | unchanged                               | unchanged                         |

  Every row moves toward "there is no gate here", never away from it, and no value
  that HAS a verdict changes it — a declared `false` is still a verdict, not a
  missing gate (objectui#3812), and blankness is `trim()`, not "short": `{ dialect:
'cel', source: ' x ' }` is a predicate. One alias precedence changes with the
  `hidden` legs and is pinned rather than claimed as an equivalence: an undeclared
  `hidden` no longer short-circuits the chain, so a declared `hiddenOn` is finally
  consulted.

  `SchemaRenderer`'s four `visible*` legs keep `!== undefined` deliberately, as
  objectui#3850 ruled: their `true` is negated, so an empty predicate already lands
  on "shown", and narrowing them would change alias precedence rather than fix
  anything.

- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [7864f03]
- Updated dependencies [d229dfa]
- Updated dependencies [4bc6c23]
- Updated dependencies [c3b01a7]
- Updated dependencies [f5f8744]
- Updated dependencies [3765678]
- Updated dependencies [d83f6b3]
- Updated dependencies [5f08c05]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [b750823]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [8c60819]
- Updated dependencies [41d6022]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [f9faa7d]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/core@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0
  - @object-ui/data-objectstack@17.4.0

## 17.3.0

### Patch Changes

- d915c47: Relation fields (`lookup` / `master_detail` / `user` / `tree`) are now usable in action and conditional-formatting predicates: they bind as the stored foreign key on every surface, and the fields a predicate reads are included in the query projection (#3501).

  Before this, one predicate over one relation field had four different fates, decided by things its author does not control. `$expand` **replaces** the id in place with the whole related record, and a view expands exactly the relations it shows as COLUMNS — so `record.owner == "U1"` was **true** where the column was absent, **false** where it was displayed, and a **fault** where the field was neither displayed nor projected (a list's `$select` was built from its columns alone, and CEL treats an absent key as a fault, not as null). A fault is fail-CLOSED on the row kebab and the selection bar and fail-OPEN on the lenient paths, so the same authoring mistake hid the button from everyone on one surface and showed it to everyone on the next, with nothing on screen to point at either. The server, meanwhile, only ever sees the id — so client and server could not agree, which is the one thing ADR-0036 / ADR-0058 exist to guarantee.

  Two changes close it. `toPredicateRecord` (new, `@object-ui/core`) collapses expanded relation values back to their ids when a record is bound for evaluation — driven by the object's own field types, not by sniffing for an `id` key, so a `json` field that happens to carry one is untouched. It is threaded through `evalRowPredicate` / `resolveConditionalFormatting` (via a new `fields` option), `useRowPredicate`, `partitionBulkRows`, and both `page:header` evaluators, with the object schema supplied by `ObjectGrid` / `ListView` / `ObjectKanban` / the record context. Kanban card formatting is threaded the same way, so a rule cannot match on the grid view of a list and silently never match on its board. Display is unaffected — a detail-page title still renders the related record's name, and the schema-only `kanban-ui` entry point (which has no object schema to offer) keeps using the payload verbatim. `collectPredicateFieldRefs` / `listViewPredicates` (new) harvest the `record.x` / `data.x` references out of a view's conditional formatting, row-action defs, bulk-action defs, promoted object actions and `userActions` overrides, and add them to `$select` — intersected with the object's declared fields plus the platform columns every object carries (`isProjectableField`), because an unknown key is not ignored by every backend. No `$expand` is added: a predicate wants the foreign key, which is what an unexpanded relation already is.

- 175bd79: `toPredicateInput` is now re-exported from `@object-ui/core` instead of being reimplemented in `@object-ui/react`. Behaviour is byte-for-byte identical — the renderer-side copy in `packages/react/src/hooks/useExpression.ts` had item-for-item the same semantics as the canonical `packages/core/src/evaluator/predicateInput.ts` (booleans short-circuit, bare strings and non-`cel` dialects become `${…}`, a `{ dialect: 'cel', source }` envelope survives so `useCondition` routes it to the canonical `@objectstack/formula` engine, empty/absent predicates become `undefined`), and every existing import path (`import { toPredicateInput } from '@object-ui/react'`) keeps working with an unchanged signature. What changes is that there is now ONE implementation rather than two held in step by a parity table: #3314 is the record of what two normalizations do when left alone — they drift, and the same `visible:` predicate reaches different verdicts depending on whether the action was surfaced by `ActionEngine.getActionsForLocation` or rendered standalone. The 14-shape normalization parity table degenerated once both of its columns called the same function, so it is replaced by a single identity assertion (`react`'s export IS `core`'s function object); the engine-path-vs-renderer-path verdict parity suite is untouched and still proves the two call paths agree (#3367).
- Updated dependencies [18cd432]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [65516ba]
- Updated dependencies [94c5b7c]
- Updated dependencies [ca0fa8f]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [7e2406a]
- Updated dependencies [9e9e9a9]
- Updated dependencies [4eeb932]
- Updated dependencies [5c856ec]
- Updated dependencies [23018cc]
- Updated dependencies [68b6a28]
- Updated dependencies [0554e88]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [28b2e65]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [6195841]
- Updated dependencies [5dd0127]
- Updated dependencies [a415684]
- Updated dependencies [a4cff5b]
- Updated dependencies [5af2852]
- Updated dependencies [f833d3a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
  - @object-ui/core@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/data-objectstack@17.3.0

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

- 09d30a4: Stop declaring 18 `@object-ui/auth` / `@object-ui/components` / `@object-ui/react`
  symbols under names `@objectstack/spec` owns (objectui#3159, objectstack#4115
  batch 5).

  **Breaking for importers of all three packages** — six exported names changed,
  because the spec exports the same name for a _different_ thing:

  | package      | was                          | now                      | what the spec's same-named export actually is                                  |
  | :----------- | :--------------------------- | :----------------------- | :----------------------------------------------------------------------------- |
  | `auth`       | `AuthSession`                | `AuthClientSession`      | the SERVER's session record (`{ id, userId, expiresAt: ISO string, token? }`)  |
  | `auth`       | `AuthProviderConfig`         | `AuthProviderOptions`    | an OAuth/OIDC provider registration (`{ id, clientId, clientSecret, scope? }`) |
  | `components` | `FilterCondition`            | `FilterBuilderCondition` | the recursive ObjectQL predicate AST (`$and`/`$or`/`$not`)                     |
  | `components` | `Field`                      | `FieldContainer`         | an object FIELD's metadata and its builder namespace                           |
  | `react`      | `ConflictResolutionStrategy` | `ConflictResolution`     | the metadata-MERGE policy (`error \| priority \| first-wins \| last-wins`)     |

  The `react` rename is the odd one out: the new name is the **spec's own** name
  for the union that hook always used, so it is a re-export rather than a dialect.

  Eleven more keep their names and are now **imported or derived from the spec**
  instead of re-declared: `TenancyPosture`, `DelegableScope` (+`DelegableAdminScope`),
  `AuthUser`, `ShareLinkPermission`, `ShareLinkAudience`, `ShareLink`, `SortItem`,
  `OfflineStrategy`, `OfflineCacheConfig`, `OfflineSyncConfig`, `OfflineConfig`,
  `NavigationConfig`.

  **Three of the copies were losing information, not just duplicating it.**

  - `AuthUser` never declared the spec's `positions` or `tenantId` — the
    authorization inputs. Its `[key: string]: unknown` index signature meant the
    omission was invisible at every call site _and_ to any structural comparison
    (the objectstack#4075 mechanism). It now `extends` the spec principal, so the
    display-only fields (`image`, `role`, `roles`, `emailVerified`) are the delta
    and the spec's keys arrive on their own.
  - `useNavigationOverlay`'s copy carried the note _"inline … to avoid importing
    from `@object-ui/types` (which may not be a direct dependency of
    `@object-ui/react`)"_. The vocabulary belongs to `@objectstack/spec`, which
    **is** a direct dependency — the same expired "kept local to avoid a
    dependency" comment objectui#3169 found in `@object-ui/app-shell`.
  - `useOffline` and `usePerformance` both opened with _"Types aligned with
    `@objectstack/spec` v2.0.7"_. The installed spec is 17.0.0-rc.1.

  `ShareLink` derives from the spec row **minus `password_hash`** — omitted rather
  than optional, because it is the credential itself and typing it in a browser
  package is an invitation to render it. `password_protected` (the boolean the UI
  needs in its place) is the one local addition.

  The config types derive from each schema's **input** side, not `z.infer`.
  `useOffline(config: OfflineConfig = {})` defaults to the empty object, which the
  output type — every `.default()`ed key required — would reject outright.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/components`: its public type surface now references the spec.

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

### Patch Changes

- ea96284: `useMetadataItem` no longer spins forever outside a `<MetadataProvider>` — the "graceful fallback" was the thing that made those consumers impossible to mount.

  `useMetadata()` built its no-provider fallback **inline on every call**, so outside a provider
  every render produced a new `getItem`. `useMetadataItem` lists `getItem` in its effect deps and,
  on the no-name path, called `setState({ item: null, loading: false, error: null })` with a fresh
  object each run. New identity → effect re-runs → new state object → re-render → new identity:
  an unbreakable loop, synchronous enough to hang inside `render()` rather than fail.

  So the fallback documented as the graceful path for consumers mounted outside a provider —
  "common in unit tests that only need to assert on rendering" — was precisely what made them
  unmountable. `record:alert` and `record:quick_actions` both call `useMetadataItem`
  unconditionally; each pinned a core and grew unbounded (8.6 GB before the first kill) on a
  `render()` that never returned.

  Two changes, at the cause and one layer in:

  - The fallback is a frozen module-level singleton, so its identity is stable across renders.
  - The clear-state path bails out when the state is already cleared, instead of installing an
    equal-but-new object. That covers the same loop arriving by another route — any caller whose
    context value is rebuilt per render, which this interface explicitly invites ("hand-rolled
    context values in tests keep working").

  Found by `apps/console/src/__tests__/record-block-record-reach.test.tsx` (objectui#3149), which
  could not mount either block until this was fixed.

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [a889e31]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [c5ccbd5]
- Updated dependencies [d9668a7]
- Updated dependencies [4b470b9]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/i18n@17.2.0
  - @object-ui/data-objectstack@17.2.0

## 17.1.0

### Minor Changes

- c4db402: refactor(views): ListView's `aria` and `sharing` are the spec sub-shapes (#2890 scope A step 5)

  Last rename batch in the ListView vocabulary migration.

  **`aria`** is now the spec's `AriaPropsSchema`: `label` → `ariaLabel`,
  `describedBy` → `ariaDescribedBy`, folded at the ListView boundary like every
  other legacy key. Two things fall out of adopting the spec shape:

  - `role` becomes authorable. The list region hardcoded `role="region"`; it now
    reads `aria.role` and falls back to `region`.
  - `aria.live` stays as a documented local extension — it has no spec
    counterpart, and dropping it would silently disable a shipped capability.
    Promote it rather than growing that extension.

  **`sharing`** is now the spec's `ViewSharingSchema` (`{ type, lockedBy }`),
  imported by reference — the local four-key object is gone. The legacy pair folds
  in: `visibility` collapses onto the two ownership kinds the spec models (only
  `private` is `personal`; `team` / `organization` / `public` are all
  `collaborative`), and a bare `enabled: true` maps to `personal`, which is the
  badge the user already saw (the old title fell back to `'private'`).

  _Visible change_: the share badge's tooltip shows the spec ownership type, so a
  view authored with `visibility: 'team'` reads "Sharing: collaborative" instead
  of "Sharing: team". The four-value audience has no spec home and nothing but
  that tooltip consumed it; keeping a second audience enum alive would re-open the
  fork this issue closes.

  Also fixes the **spec bridge**, which was doing the opposite of its job: given a
  spec-shaped `sharing`, `transformListView` _downgraded_ it — inventing a legacy
  `visibility` audience and an `enabled` flag that the renderer then had to fold
  back. Both sides speak `ViewSharing` now, so it passes through.

  `conditionalFormatting` and `exportOptions` are deliberately **not** folded.
  Both objectui shapes are supersets carrying capability the spec cannot express —
  the `{ field, operator, value }` rule form, and `maxRecords` / `includeHeaders`
  / `fileNamePrefix`. Folding them onto the narrower spec shapes would delete
  working features; they want promotion upstream, not a rename.

- 07de839: fix(notifications): the config, `position` and action `variant` are read instead of forked or ignored (#3014 follow-up)

  The last of the notification contract. After `displayType` (#3071) and `icon`
  (#3076), four gaps of the same family were left:

  - **the config was 3/4 inert** — only `defaultDuration` was ever read.
    `maxVisible` and `stacking` were carried and ignored, while
    `NotificationBanners` capped at a hard-coded `3` of its own;
  - **its field names forked from `NotificationConfigSchema`** — `position` vs
    `defaultPosition`, a renderer-local `stacking` boolean with no spec
    counterpart, and no `pauseOnHover` at all;
  - **a notification could not declare a `position`.** The #3008 parity guard
    asserted the position _vocabulary_ matched the spec while nothing positioned
    anything by it — a guard passing over an unused value;
  - **`NotificationActionButton.variant` was the shadcn Button vocabulary**
    (`default | destructive | outline`) under a spec-shaped name, forking
    `NotificationActionSchema.variant` (`primary | secondary | link`).

  **How positioning resolves now** — `notification.position ?? config.defaultPosition
?? nothing`, and "nothing" is a real answer:

  - **declared** → the surface pins itself there, always. `presentNotificationToast`
    passes it per-toast so the contract wins over the container;
  - **undeclared** → the surface keeps its own anchor (a snackbar's bottom edge) or
    defers to the host's toast chrome.

  That asymmetry is the design decision. The host's sonner container also serves
  toasts that are _not_ spec notifications (the console action runtime's own
  `toast.*` calls), so it stays the fallback authority for placement — never a
  competing one. A declared position a component prop could silently override
  would be the same "validates, then does nothing" shape this whole area is about.
  Hence `defaultPosition` has no fabricated default: "the host didn't say" has to
  be representable.

  Also: `maxVisible` / `stackDirection` now drive every stacking surface through
  one shared `visibleNotificationStack` (cap keeps the NEWEST, stack grows in the
  declared direction); `pauseOnHover` holds a transient notification's timer and
  resumes it with the time it had left, which needed the provider to track live
  timers rather than fire-and-forget `setTimeout`s. Legacy spellings still resolve:
  `position` folds into `defaultPosition`, and `stacking: false` reads as
  `maxVisible: 1` rather than being ignored.

  `onToast` now receives the resolved config as a second argument, so the delegate
  can apply the parts of the contract only it can. Existing one-argument handlers
  are unaffected. The spec-parity guard gained the action-variant vocabulary, the
  one notification enum it did not cover.

- 2a40b5e: feat(notifications): each spec `displayType` gets its own presentation instead of a toast (#3014)

  #3008 closed the **contract** half of this: `NotificationContext`'s union matched
  `NotificationTypeSchema`, and `notify()` materialized the declared type so a
  consumer _could_ branch on it. Nothing did. `NotificationProvider` handed every
  item to the host's `onToast` delegate regardless of type, so an author picking
  `banner` or `inline` got a transient overlay — plausible output, wrong output.

  Each of the five spec types now has a presentation of its own:

  | `displayType` | Presentation                                           | Rendered by                        |
  | ------------- | ------------------------------------------------------ | ---------------------------------- |
  | `toast`       | transient overlay (unchanged)                          | the host's `onToast` delegate      |
  | `snackbar`    | bottom-anchored bar, one at a time, at most one action | `<NotificationSnackbar />`         |
  | `banner`      | page-width strip **in the content flow**               | `<NotificationBanners />`          |
  | `alert`       | blocking acknowledgement dialog, FIFO queue            | `<NotificationAlerts />`           |
  | `inline`      | in place, at the raising surface                       | `<NotificationInline scope="…" />` |

  The four surface components ship from `@object-ui/components` and subscribe via
  `useNotificationsByPresentation(type, scope?)`.

  **Answers to the three questions the issue left open:**

  1. **Banner/inline placement is the host's.** They are not overlays: a banner takes
     space at the top of the content area and an `inline` notification belongs next to
     the thing that raised it. So the context exposes the items and the surfaces
     subscribe, rather than one `onToast`-style delegate positioning everything. An
     `inline` notification carries a `scope` that pairs it with its outlet, so two
     forms on one page don't show each other's messages.
  2. **`alert` is modal-ish but NOT the action system's `ModalHandler`.** That handler
     resolves a page/object, renders it, and reports an `ActionResult` back to the
     `ActionRunner`; a notification alert has no schema, no target and no result.
     Routing it there would mean synthesizing a page just to say "OK". It renders
     through the `AlertDialog` primitive instead — no second action-modal path.
  3. **`snackbar` earns its own component.** It supersedes rather than stacks, anchors
     bottom regardless of the toast position config, and takes at most one action.
     Making it a sonner variant is what "presents as a toast" means.

  **Also fixed:** auto-dismiss now follows the presentation. `toast`/`snackbar` keep
  the transient timer; `banner`/`alert`/`inline` are persistent unless the raiser sets
  `duration` explicitly — a persistent banner used to evaporate on the shared 5s toast
  timer. `dismissible` is honored on the persistent surfaces (an `alert` always keeps
  its acknowledge button; `dismissible: false` only closes the Escape route).

  `onToast` now receives **only** `toast` items. A provider with no `onToast` remains
  the supported store-only mode (a bell reading `notifications`/`unreadCount`), but
  raising one of the other four types with its surface unmounted warns in dev, naming
  the component to mount — that failure used to be silent.

  `NOTIFICATION_PRESENTATIONS` is typed `Record<NotificationPresentation, …>`, so a new
  member in the spec enum fails type-check until its presentation is decided; a parity
  test additionally asserts the table covers `NotificationTypeSchema` exactly and that
  no two types share a surface.

- ce08d55: chore(deps): upgrade `@objectstack/*` to 17.0.0-rc.0, and let the spec take back what it now owns

  `spec` / `client` / `formula` / `lint` move from `^16.x` to `^17.0.0-rc.0`. Two
  groups of v17 changes reach this repo, and they pull in opposite directions —
  the spec pruned surface objectui re-exported, and adopted surface objectui had
  been carrying locally.

  **The spec pruned dead Theme config (objectstack#3494), so the re-exports went
  with it.** `ThemeSchema` dropped `spacing`, `breakpoints`, `logo`, `density`,
  `wcagContrast`, `rtl`, `touchTarget` and `keyboardNavigation` — authorable but
  never enforced, so authoring them was already a silent no-op. `@object-ui/types`
  re-exported those sub-schemas _by reference_ (issue #2231), so they could not
  survive the prune without becoming hand-written mirrors — exactly the second
  de-facto contract AGENTS.md #0.1 forbids. Removed from the public surface:

  - Types: `Spacing`, `Breakpoints`, `DensityMode`, `WcagContrastLevel`,
    `ThemeLogo`, and the deprecated `SpacingScale` alias
  - Schemas: `SpacingSchema`, `SpacingScaleSchema`, `BreakpointsSchema`,
    `ThemeLogoSchema`, and the `SpacingSchemaType` / `BreakpointsSchemaType` helpers
  - `Theme.spacing`, `Theme.breakpoints` and `Theme.logo`

  `mergeThemes` no longer merges the three dropped keys. `generateThemeVars` is
  unaffected — it never emitted them, which is why the liveness audit called them
  dead. The one real consumer was `ThemeProvider`, which set the favicon from
  `theme.logo.favicon`; that path is gone, because v17 strips the key at parse and
  it could never arrive again. The live favicon is unaffected: it comes from
  operator branding (`getFaviconUrl()`), applied in the console's `index.html`,
  `main.tsx`, and on route change.

  Nothing else read the pruned types. In particular the list-density feature is
  untouched — `useDensityMode` and `rowHeightToDensityMode` use `@object-ui/core`'s
  own local `DensityMode`, which never came from the spec.

  **The spec adopted objectui's ListColumn extensions (objectui#2231), so the
  extension collapsed.** `ListColumnSchema` used to `.extend()` the spec with two
  fields, each carrying a note to promote it upstream rather than grow the
  extension; v17 did exactly that. `summary` is now the spec's
  `union([ColumnSummarySchema, ColumnSummaryConfigSchema])` — the same enum ∪
  `{ type, field }` form `useColumnSummary` reads — and `prefix` is the spec's
  `ColumnPrefixSchema`. `ListColumnSchema` is now a plain by-reference re-export.
  One behavior change rides along: `prefix.type` defaults to `'text'` on parse
  instead of staying `undefined`, so the cell renderer always gets a value.

  **Node 22 is now the floor.** Every `@objectstack` package declares
  `engines.node: ">=22.0.0"` (objectstack#3825; Node 20 reached EOL 2026-04-30).
  This repo claimed `>=20` and ran CI on Node 20.x, so it promised — and validated
  — a runtime its own core dependency does not support. `engines.node` is now
  `>=22`, CI runs Node 22.x, and the CI/deployment docs say so.

  The major stays 17: per AGENTS.md the major tracks `@objectstack`'s major, which
  is also 17, and that convention deliberately outranks semver purity — so the
  removals above ship as a minor rather than desyncing the two.

- 0ded602: fix(form): a server rejection that names fields now marks those fields (objectstack#3896)

  The server has always said which field it rejected. `@objectstack/objectql`'s
  validators throw `VALIDATION_FAILED` with `fields[]` — one entry per offending
  field, each with a human `message` — and both the REST layer and the runtime
  dispatcher serve that as a 400 with the entries intact.

  Every form dropped them. The submit handler caught the rejection, ran the
  message through `extractWriteErrorMessage`, and showed **one undirected toast**:
  the user was told something was wrong but not _what_, on a surface that already
  knows how to mark an input — and already does exactly that for client-side
  validation. On a long form the offending field was often off-screen, so "创建"
  appeared to do nothing.

  **Now the two failures behave identically, because they share one
  implementation.** The per-field marking, the toast naming the fields, and the
  scroll-and-focus of the first offender (#2793) were extracted from the
  client-side invalid handler; the server path calls the same function. As far as
  the person filling in the form is concerned these are the same event — only the
  referee differs.

  Three layers, each of which was dropping the detail:

  - **`@object-ui/react`** — new `extractFieldErrors(err)` (exported alongside
    `extractWriteErrorMessage` / `isPermissionError`) normalises the three shapes
    the error can arrive in: a typed `ValidationError` from the ObjectStack
    adapter, the raw `@objectstack/client` error (whose `details` falls back to the
    whole response body, which is where `fields[]` lands), and a hand-rolled error
    carrying `fields` directly — the server duck-types that shape identically, so
    the client must not be pickier than the server. Entries with no usable `field`
    are **dropped rather than guessed at**: marking an innocent input is worse than
    the generic toast.
  - **`@object-ui/data-objectstack`** — `normaliseClientError` now maps a 400
    `VALIDATION_FAILED` onto the `ValidationError` class that has sat in
    `errors.ts` since the package was written, exported and **never once
    constructed**. Its `validationErrors: Array<{ field, message }>` shape was
    already exactly right. `create` also now normalises at all: only `update` did,
    so a rejected insert reached callers as the raw client error — and a create is
    the path that most often trips required-field validation.
  - **`@object-ui/components`** — the form renderer maps the entries onto
    `form.setError` and takes over the failure, **but only when every rejected
    field has a visible input to carry it**. If the server also rejected something
    the form does not render, it falls through to the banner, whose top-level
    message concatenates every field's reason — so the part the user cannot see
    inline is still said out loud instead of silently dropped.

  This also removes the need for the client-side predicate mirroring added in
  #2962: a form no longer has to guess what the server will reject in order to
  warn about it beforehand, and mirrored predicates drift.

  Non-field failures (403 / permission denials / anything without `fields[]`) take
  exactly the path they took before.

### Patch Changes

- fc0272a: fix(actions): apply the ADR-0066 D4 capability gate on every action surface (framework#3923)

  An action declaring `requiredPermissions` is supposed to be one declaration with
  two enforcement surfaces: 403 on the server, hidden button in the UI. The UI half
  only ever ran inside `ActionEngine.getActionsForLocation` — and the surfaces
  `record_header`, `record_more`, `list_item` and `list_toolbar` actually render on
  do not go through the engine. They filter their own action lists. So a button
  declaring a capability nobody holds rendered, live and clickable, on the record
  header, in every grid row menu, and on the list toolbar. For a `type: 'api'`
  action pointed at a self-authored endpoint, nothing else was checking either: the
  platform's action route (which is where the 403 comes from) never sees that
  request.

  `page:header`, `action:bar` (business _and_ `systemActions`) and the grid's
  `RowActionMenu` now apply the same gate, via a shared `useCapabilityGate()` so
  the surfaces cannot drift apart. The rule is the engine's, unchanged: hide unless
  the caller holds **all** declared capabilities; an empty held set is "holds
  nothing" and gates; **unknown** — no action runtime, no resolved capabilities —
  fails OPEN, because the server is the authority and hiding a permitted user's
  button on missing client data is the worse failure.

  The record surface was also feeding the gate nothing to work with.
  `RecordDetailView` mounts its own `<ActionProvider>`, which shadows the shell's
  for every action on that page, and seeded it with identity only — no
  `systemPermissions`. Since unknown fails open, that alone un-gated every
  `record_header` / `record_more` / `record_section` action on the one page those
  locations exist on. It now forwards the caller's resolved capabilities (and only
  once they have actually resolved, so a standalone embed without a
  `PermissionProvider` keeps failing open rather than hiding everything).

  `useRecordEditable`'s record-level explain probe went out on a bare
  `fetch(..., { credentials: 'include' })`. A bearer-token session carries its
  credential in the `Authorization` header, not a cookie, so the probe came back
  401 on a perfectly valid admin session and the verdict silently failed open —
  the hook was inert in exactly the deployments it was written for. It now rides
  the host's authenticated fetch (`SchemaRendererProvider`'s `apiFetch`), falling
  back to the global one for standalone embeds.

- 9eb932b: fix(console): three real-user console failures — 403 blamed on the network, ⌘K search capped at 8 objects, nav gating fields inert

  1. **List error panel classifies the failure** (`plugin-list`, `i18n`): a 403/401 from the data source used to render the same "check your connection" copy as a genuine outage, sending users to debug their network while the server was correctly denying access. The panel now classifies by `httpStatus`/`status`/`statusCode`, the `PERMISSION_DENIED`/`UNAUTHORIZED` error codes, or an `HTTP <status>` message prefix, and renders dedicated permission-denied / sign-in-required copy (all nine locales).

  2. **⌘K / full-page search scope is no longer truncated** (`react`): `maxObjectsQueried` caps the per-object fanout fallback, not the search scope — it used to slice the candidate pool itself, so the `objects` whitelist sent to the platform's `/api/v1/search` only ever named the first 8 nav objects. Which sidebar group came first decided which records were findable; everything later in the nav was unsearchable no matter what the user typed.

  3. **Nav gating fields finally gate** (`app-shell`): `evaluateVisibility` only evaluated `${…}` template strings, so the `{ dialect: 'cel', source }` envelopes the spec normalizes every authored `visible` predicate into fell through to a blanket "visible" — a constant-false predicate still rendered for everyone. It now delegates to `ExpressionEvaluator.evaluateCondition`, which routes CEL envelopes to the canonical `@objectstack/formula` engine. And the sidebars' `requiredPermissions` check treats a bare name as an ADR-0066 system capability (union of the user's permission-set `systemPermissions` from `/me/permissions`) — the same subset rule the server applies to `AppSchema.requiredPermissions` — instead of misreading it as `can(<name>, 'read')`, which had degraded `requiredPermissions` into a hide-from-everyone switch (admins included). The `object:action` form and the legacy object-read fallback keep working.

- 4952edf: fix(errors): error-code branches survive the framework's ADR-0112 rename — objectstack#3841

  Framework ADR-0112 renamed the whole `error.code` vocabulary from lowercase
  `snake_case` to `SCREAMING_SNAKE` (`destructive_change` → `DESTRUCTIVE_CHANGE`).
  Eleven places compared `err.code` against the old spelling with `===`, so against
  a swept server they simply stopped matching — and nothing threw. The affordance
  each branch guards just vanished and the user got the generic error toast instead:

  - the destructive-change confirm dialog (resource editor, permission matrix)
  - the "create a writable package first" hint
  - field-scoped validation issues on embedded item saves
  - the all-or-nothing publish summary naming the causal item
  - unknown-object tolerance in the app header and in record search
  - the marketplace's local-install messages for conflict / auth / unavailable
  - `isNotFoundError` in the data layer

  `RECORD_NOT_FOUND` had already been renamed a release earlier, so that branch was
  already dead before this fix.

  New `errorCodeIs` / `errorCodeIsAnyOf` in `@object-ui/types` compare
  case-insensitively, so the console keeps working against servers on either side
  of the rename — the console ships separately from the server it talks to. Every
  call site now passes the catalog (SCREAMING) spelling, and `error-code.ts` is the
  single file to delete once no supported server emits the old vocabulary.

- 2374a49: fix(sdui): a react page no longer loses its state to a memo that never held, and a source that exports nothing fails loudly

  Writing the regression guard for objectui#2954's "latent hazard" found it was
  already real.

  **`evaluatedSchema` was memoised on values rebuilt every render.**
  `SchemaRenderer` fell back to a fresh `{}` when no `SchemaRendererProvider` sat
  above it, and `usePageVariables()` returned a brand-new object literal outside a
  `PageVariablesProvider`. Both feed the `evaluatedSchema` memo's dependency list,
  so for any tree without those providers the memo never hit: the schema was
  re-cloned and the ExpressionEvaluator re-run on every render, and children got a
  new schema identity every time. A `kind:'react'` page memoises its compiled
  source on that identity, so the page was recompiled — a new page function, a new
  element type — and React remounted it, silently discarding the user's `useState`.
  Any registry notification (every lazy plugin's first load) triggered it. Both
  fallbacks are now module constants.

  **A source that exports nothing now throws instead of rendering blank.**
  `generateElement` inserts the implicit `export default` only when the source
  _starts with_ JSX, a `function` declaration, `()` or `class` — so the very
  common `const Page = () => …` exported nothing, and the page rendered blank with
  no error reported anywhere. It now throws with a message naming the fix, which
  `ReactRunner`'s error panel surfaces. `export default null` still means "render
  nothing"; a default export that is not a component throws too.

  **`PageSchema['kind']` matches `@objectstack/spec`.** It declared
  `'full' | 'slotted'` while the renderer had shipped `'react'` and
  `'html'`/`'jsx'` since ADR-0080 and read the field through a cast. The union now
  spells all five and the cast is gone.

  Docs: new `content/docs/guide/react-pages.md` (choosing between the executed and
  parsed tiers, the capability gate, the injected scope, flat props, `Block`,
  `useAdapter`, source shapes, error handling) and a `@object-ui/react-runtime`
  README — the package had neither, while being the tier AI-authored pages target.

- Updated dependencies [62311b6]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [9b773f9]
- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [d61efd1]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [3cb9646]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [7d35010]
- Updated dependencies [c4d7b20]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [d21794c]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [a17ef09]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [f8a95e5]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/data-objectstack@17.1.0
  - @object-ui/i18n@17.1.0

## 17.0.0

### Major Changes

- c77108c: refactor(spec-bridge): remove the dead page/dashboard bridges (#1892)

  `SpecBridge`'s `page` and `dashboard` bridges — `bridgePage`, `bridgeDashboard`,
  and the `SpecBridge#transformPage` / `#transformDashboard` methods — had no
  runtime consumer. Pages render through their own renderer and dashboards
  through `DashboardView → DashboardRenderer → DatasetWidget` (ADR-0021); neither
  path routes through `SpecBridge`. The dashboard bridge's input shape
  (`object` / `categoryField` / `valueField` / `aggregate`) is the pre-ADR-0021
  widget model, which the strict `DashboardWidgetSchema` now rejects — so the
  bridge could not receive a spec-valid dashboard even in principle.

  Flagged dead by the metadata-liveness audit (framework #1878 / #1892). The
  `list` and `form` bridges are unaffected and remain the live authoring path.

  BREAKING CHANGE: the public exports `bridgePage`, `bridgeDashboard`, and the
  `SpecBridge#transformPage` / `#transformDashboard` methods are removed. There
  is no replacement — render pages and dashboards through their renderers
  (`DashboardRenderer` / the page renderer) directly.

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

- 1767124: feat(grid): compute all eleven spec column summary aggregations (#2890)

  `ColumnSummarySchema` accepts eleven aggregation names; `useColumnSummary` computed
  five. The other six — `none`, `count_empty`, `count_filled`, `count_unique`,
  `percent_empty`, `percent_filled` — passed validation at authoring time and then
  rendered a blank footer cell, with no error raised on either side.

  The computation now splits into two families. Count and percent read _raw_ cell
  values, before the numeric parse, so they work on text, select and lookup columns and
  a value that does not parse as a number still counts as a filled row; a cell is empty
  when it is `null`, `undefined`, `""` or an empty array. `sum`/`avg`/`min`/`max` keep
  the existing numeric parse and column formatting.

  Two behavior changes follow from the enum carrying both `count` and `count_filled`,
  which cannot mean the same thing:

  - `count` is now every row; `count_filled` is the non-empty variant. Only a column
    whose values are all empty renders differently than before.
  - a zero count renders `Empty: 0` instead of collapsing to a blank cell.

  Column currency/percent formatting is gated to the numeric family, so `count_unique`
  on a currency column reads `Unique: 3` and not `$3.00`. `none` and unrecognized names
  skip the entry entirely, so a view whose columns all opt out renders no footer row.

  `ListColumnSchema`'s objectui-local `{ type, field }` arm now takes its vocabulary
  from `SpecColumnSummarySchema` by reference — it was stuck at the same five names,
  which left the per-column `field` override unavailable for the six new aggregations.

  A parity test asserts the renderer's supported set equals the spec enum in both
  directions: a spec name the renderer omits is the bug above, and a renderer name the
  spec omits would be local dialect (Commandment #0).

  **Removed:** `useColumnSummary` from `@object-ui/react`. It was a second, unrelated
  hook of the same name with no callers — a different API, a comment claiming it
  implemented spec v2.0.7, and a `distinct` aggregation that is not in the spec
  vocabulary at all (the spec calls it `count_unique`). Use `useColumnSummary` from
  `@object-ui/plugin-grid`, which implements the spec enum.

- c6cfdf1: feat(react)!: trim the dead device/preference delegates from
  `useClientNotifications` (objectstack#3612 companion)

  `registerDevice`, `getPreferences`, and `updatePreferences` delegated to
  `@objectstack/client` methods that were deleted in objectstack#3612 — the
  `/notifications/devices` and `/notifications/preferences` server routes they
  targeted were never built, so every call already surfaced an error at
  runtime. The hook keeps `fetchNotifications` and `markAsRead` (both
  dispatcher-served and route-ledgered). Breaking only for code destructuring
  the removed functions from the hook result; nothing in this repo did.

### Patch Changes

- 8ecf5a6: Command palette (⌘K) now surfaces record search hits from the platform's global
  search endpoint (`GET /api/v1/search`).

  Previously the palette only ran a per-object `find({ $search })` fanout (the
  metadata-driven ADR-0061 search), which misses records that only the global
  search index knows about — so typing a well-known record name returned no
  records even though `/api/v1/search` served them. `ObjectStackAdapter` now
  exposes a `searchAll(query, { limit, objects })` method that calls the unified
  endpoint, `useRecordSearch` prefers it when present (falling back to the fanout
  otherwise), and the palette renders the resulting record hits grouped by object.

- 7b35e4b: fix(dashboard,charts): resolve `{current_user_id}` in widget filters (framework #3574)

  A dashboard widget filtered on `{current_user_id}` rendered `0`. The token
  reached SQL as a literal, matched no row, and nothing was logged on the client
  or the server — a silent zero that reads as "you have no work" rather than
  "this filter did not resolve". The same token in a list-view filter resolved
  correctly, so a user-scoped list and a user-scoped widget over the same data
  disagreed.

  There was no shared resolver. Three ad-hoc implementations had grown up
  independently — `ObjectView` for list views, `ObjectDataPage` for URL filter
  triples, `NavigationRenderer` for hrefs — and each understood only the filter
  shape its own surface used. `ObjectView`'s opened with
  `if (!Array.isArray(filter)) return filter`, so it could not have been reused
  by dashboard widgets even in principle: widget filters are MongoDB-style
  objects. Widgets therefore got no resolution at all — `DatasetWidget` called
  `resolveDateMacros` and nothing else, which is why `{today}` worked in a widget
  and `{current_user_id}` silently did not.

  - **`@object-ui/core`** — new `utils/filter-tokens.ts` with
    `resolveContextTokens` and `resolveFilterPlaceholders`. The latter expands
    _every_ placeholder vocabulary in one call and is what surfaces should use;
    resolving only some of them is the whole defect. The walk handles arrays and
    plain objects uniformly, so one resolver covers both platform filter shapes.
  - **`@object-ui/react`** — new `FilterScopeProvider` / `useFilterScope`. The
    renderer packages deliberately do not depend on `@object-ui/auth`, so the
    shell supplies the session values. This is a separate context from
    `PredicateScopeContext`, which is the expression evaluation scope and carries
    no organization.
  - **`@object-ui/plugin-dashboard` / `@object-ui/plugin-charts`** — all six
    widgets that previously resolved date macros only now resolve both
    vocabularies: `DatasetWidget`, `ObjectMetricWidget`, `ObjectDataTable`,
    `ObjectPivotTable`, and `ObjectChart` (dataset-bound and inline paths). The
    chart's `compareTo` comparison filter gets the session pass too — otherwise
    the overlay series silently ignored the owner clause the primary series
    honoured.
  - **`@object-ui/app-shell`** — `ObjectView`'s local `substituteFilterTokens`
    and `ObjectDataPage`'s inline `=== '{current_user_id}'` ternary now delegate
    to the shared resolver, so both also gain `{current_org_id}` and date macros.
    Two of the three ad-hoc implementations are gone rather than joined by a
    fourth.

  An unresolvable token is left intact rather than dropped: leaving it yields an
  empty result, whereas dropping the clause would _widen_ the result set and show
  a signed-out viewer everyone's data. It is no longer silent — the resolver
  warns, naming the token, and suggests the intended spelling for known
  near-misses (`{current_user}`, `{user_id}`, `{organization_id}`). Authoring-time
  enforcement lands separately as `filter-token-unknown` in `@objectstack/lint`.

- Updated dependencies [0b3be01]
- Updated dependencies [3c4d935]
- Updated dependencies [4b60d2d]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1a03af6]
- Updated dependencies [3e886eb]
- Updated dependencies [cfc675e]
- Updated dependencies [20df08c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [af705b9]
- Updated dependencies [0502a7c]
- Updated dependencies [7b35e4b]
- Updated dependencies [e16ed2d]
- Updated dependencies [c6fd752]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [2735de6]
- Updated dependencies [6dee2cb]
- Updated dependencies [e05f052]
- Updated dependencies [0502a7c]
- Updated dependencies [faad45e]
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [ba73a02]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [9b4b952]
- Updated dependencies [7d46648]
- Updated dependencies [6e8fd3c]
- Updated dependencies [bb4aa25]
- Updated dependencies [75f1cdf]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [d62fb1f]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/i18n@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/data-objectstack@17.0.0
  - @object-ui/core@17.0.0

## 16.1.0

### Minor Changes

- 803558e: feat(data): thread the host's authenticated fetch into `provider: 'api'` data sources (#2725)

  `provider: 'api'` view data sources went through a bare `globalThis.fetch`, so
  custom endpoints (gantt composite trees, report aggregates) carried only
  same-origin cookies while every native `/api/v1/*` request carried
  `Authorization: Bearer` — the moment cookie HMAC verification failed (dev
  restart rotating the fallback auth secret, cookie expiry/rotation in prod)
  those views 401'd while the rest of the app kept working.

  - **`@object-ui/react`** — `SchemaRendererProvider` accepts an optional
    `apiFetch`; nested providers inherit it from their parent so re-wrapped
    subtrees (react pages, preview surfaces) keep the host's authentication.
    `useViewData` defaults the api-provider adapter's fetch to the context
    `apiFetch` (explicit `adapterOptions.fetch` still wins).
  - **`@object-ui/auth`** — `createAuthenticatedFetch` gains a
    `sameOriginOnly` option: cross-origin URLs pass through to the bare fetch
    with no `Authorization` / `X-Tenant-ID` / `Accept-Language`, so metadata-
    supplied third-party URLs never see the platform token.
  - **`@object-ui/app-shell`** — the console wires
    `createAuthenticatedFetch({ sameOriginOnly: true })` (settle-signal wrapped)
    as `apiFetch` on the root `SchemaRendererProvider`.
  - **`@object-ui/plugin-gantt`** — `ObjectGantt` resolves its api-provider
    DataSource with the context `apiFetch`, covering reads and write-backs.

  Behaviour is unchanged for hosts that don't provide `apiFetch` (bare fetch +
  cookies, as before).

- 2e7d7f0: feat(evaluator): route `{ dialect: 'cel' }` component/action predicates to the canonical CEL engine (#2661)

  Component and action `visible` / `disabled` / `hidden` predicates were evaluated
  by the home-grown JS `ExpressionEvaluator`, while field rules
  (`visibleWhen`/`readonlyWhen`/`requiredWhen`, via `fieldRules.ts`) and row/list
  conditionals (via `evalRowPredicate`) already delegate to the canonical
  `@objectstack/formula` engine. That split meant a `{ dialect: 'cel' }` predicate
  in a renderer/action surface was executed as **JavaScript** — CEL-only forms
  (`x in list`, `has()`, typed `==`, the `today()`/`daysFromNow()` catalog) behaved
  differently from, or faulted against, the server's enforcement.

  This converges the remaining tier onto the same engine:

  - **`@object-ui/core`** — `ExpressionEvaluator.evaluateCondition` now detects a
    `{ dialect: 'cel', source }` envelope and evaluates it on `@objectstack/formula`
    (via `evalFieldPredicate`), binding the `record` namespace plus the whole
    context bag as top-level scope (`record.*`, `features.*`, `user.*`, `app.*`).
    Fail-soft to visible/enabled to match the legacy default; `throwOnError`
    callers still fail closed on a _faulting_ predicate (a genuine `false` never
    throws). This fixes every `SchemaRenderer` visibility/disabled read at once.
  - **`@object-ui/react`** — `toPredicateInput` preserves a CEL envelope instead of
    collapsing it to a `${source}` string, and `useCondition` accepts and forwards
    the envelope (keyed on a stable `(dialect, source)` so it doesn't re-evaluate
    each render). Action buttons (`action-icon`/`group`/`bar`/`button`) therefore
    evaluate CEL `visible`/`enabled`/`disabled` on the canonical engine.

  **Back-compat:** bare strings and `${…}` templates stay on the legacy JS path
  (deprecation window); only an explicit `{ dialect: 'cel' }` envelope is rerouted.
  `{ dialect: 'template' }` is unaffected.

  Together with the `^15.1.1` alignment (#2662), a renderer CEL predicate now
  reaches the identical verdict as the server — including the framework's
  `dateField == today()` equality fix (objectstack-ai/objectstack#3205) once it
  lands in a published 15.x. The broader home-grown-vs-canonical divergence
  motivation is #2661.

### Patch Changes

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

- 549c67d: chore(lint): clear the mechanical baseline lint errors so these packages' lint gates protect them again

  Extends the fields/core cleanup from #2709 (objectui#2713). These eight package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations of the same class. Cleared every **error** (no behavior
  change; warnings are out of scope):

  - **`no-useless-catch`** (`data-objectstack`) — unwrapped five try/catch blocks
    whose `catch` only re-threw; errors still propagate identically.
  - **`preserve-caught-error`** (`cli`, `data-objectstack`, `react`) — the caught
    error's message is inlined into the thrown `Error`; a scoped disable with a
    justifying comment carries each one, because these packages target ES2020
    whose lib types the 1-arg `Error` constructor only (so `{ cause }` won't
    compile) — same reasoning as the core case in #2709.
  - **`prefer-const`** (`plugin-calendar`, `plugin-map`) — `let`→`const` for
    never-reassigned bindings.
  - **`no-empty-object-type`** (`plugin-designer`) — empty extend-only interfaces
    → equivalent `type` aliases.
  - **`no-useless-assignment`** (`react`) — dropped a dead initializer that both
    branches overwrite before it is read.
  - **`no-require-imports`** (`plugin-calendar`, `plugin-timeline` tests) —
    hoisted `vi.mock` factories now use an `async` factory with
    `await import('react')` instead of `require('react')`.
  - **stale `eslint-disable` directive** (`plugin-markdown`) — removed a
    `react/no-danger` disable whose plugin is not loaded in the flat config (an
    unknown-rule reference that ESLint v10 reports as an error); the rationale is
    kept as a plain comment.

- Updated dependencies [0318118]
- Updated dependencies [1c8935a]
- Updated dependencies [af1b0db]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [8c1e415]
- Updated dependencies [0ea5036]
- Updated dependencies [2e7d7f0]
- Updated dependencies [94d4876]
- Updated dependencies [1100a8b]
- Updated dependencies [7abe4cd]
- Updated dependencies [549c67d]
- Updated dependencies [ebe6494]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [f80aaf2]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
  - @object-ui/i18n@16.1.0
  - @object-ui/core@16.1.0
  - @object-ui/data-objectstack@16.1.0
  - @object-ui/types@16.1.0

## 16.0.0

### Minor Changes

- d3e19ed: Adapt to framework 15.1: (1) ADR-0067 D2 all-or-nothing publishes — `formatPublishFailures` renders a rolled-back batch as ONE banner anchored on the causal item (`batch_aborted` entries are summarized, not listed as parallel errors); PackagesPage says "rolled back because X" instead of "{n} failed"; the AI chat publish toast surfaces the real reason instead of a bare count. Pre-15.1 partial-publish responses keep their per-item rendering. (2) ADR-0076 D12 honest discovery — `DiscoveryServiceStatus` gains `handlerReady` + `degraded`/`stub` statuses, new backward-tolerant `isServiceUsable()` helper (absent fields keep the pre-15.1 default; `stub`/`handlerReady:false` gate off; `degraded` stays usable), consumed by `isAuthEnabled`/`isAiEnabled` and `ConditionalAuthWrapper`.

### Patch Changes

- 59d4fa9: fix(detail): show the "Locked for approval" band on request-tracked backends (objectui#2618)

  The DetailView approval-lock band keyed only off the record's own
  `approval_status` field, so it never rendered on backends that track the lock
  via an open approval request and never materialize that field — even though
  the lock was real (writes rejected with `RECORD_LOCKED`). The record-level
  `InlineEditContext` now carries the host's `locked`/`lockedReason` signal
  (the same dual-source `approvalLocked` that already gates `canEdit` in
  `RecordDetailView`), and the band renders from it while keeping `DetailView`
  DataSource-agnostic. Also backfills the approval-lock strings into the detail
  translation defaults so a bare DetailView shows the label, not the raw i18n key.

- 195a651: refactor(spec-bridge): retire the hand-written `ListViewSpec`/`ListColumn` mirrors in the list-view bridge (#2231 follow-up)

  The SpecBridge's list-view bridge kept a third hand-written copy of the ListView shape
  (after the zod schema and the TS interface unified in the previous #2231 PR). It now
  derives its input type from `@objectstack/spec/ui` (`Partial<ListView>`, spec `ListColumn`),
  so the bridge can no longer drift from the protocol.

  Behavior fix surfaced by the real types: spec `columns` is `string[] | ListColumn[]`, but
  the old local interface only admitted `ListColumn[]` — a bare field-name column would have
  produced a broken `{ accessorKey: undefined }` mapping. String columns now map to a default
  column (`{ accessorKey: field, header: field }`).

- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [ca0f5f0]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
  - @object-ui/types@16.0.0
  - @object-ui/i18n@16.0.0
  - @object-ui/core@16.0.0
  - @object-ui/data-objectstack@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/data-objectstack@15.0.0

## 14.1.0

### Minor Changes

- 5523fc4: Dashboard-level filters — the three #2578 item-5 enhancements (framework#2501):

  - **react**: nested `PageVariablesProvider`s now MERGE instead of shadowing
    wholesale. A filtered dashboard embedded in a Page with its own `variables`
    keeps the outer page variables readable inside widget subtrees (`page.*`);
    an inner definition shadows only the SAME name; writes route to the scope
    that defines the variable (writing an outer-defined name from inside the
    nested subtree updates the outer provider); `resetVariables` stays local.
    Names defined nowhere still write locally, exactly as before.
  - **core**: `buildWidgetScopedFilter` accepts an optional `knownFields` set —
    a DEFAULT binding whose target field is not on the widget's object is
    skipped with a console warning instead of emitting a query the backend
    empty-matches. Explicit `filterBindings` strings are always honoured (a
    typo surfaces as a visibly empty widget, never a silently dropped filter).
    Omitting `knownFields` preserves the previous unchecked behaviour.
  - **plugin-dashboard**: `DashboardRenderer` feeds `knownFields` from
    `dataSource.getObjectSchema` for inline `object` widgets (best-effort —
    unchecked while metadata loads or when the source can't describe objects).
    `optionsFrom` dynamic filter options now resolve DISTINCT values
    server-side via a dataset GROUP BY (`queryDataset` with an inline draft)
    when the data source supports it, falling back to the previous client-side
    top-200 dedupe otherwise.

- dea65f7: Unify the list-view conditional tier onto the canonical CEL engine (#1584).

  Conditional formatting (list / grid / kanban) and row-action `visible` /
  `disabled` predicates are now evaluated by `@objectstack/formula`'s
  `ExpressionEngine` — the same engine the server uses — instead of the legacy
  JS-dialect `ExpressionEvaluator`, matching how `@objectstack/spec` already types
  these surfaces (`ExpressionInputSchema` / CEL). The whole platform now speaks one
  expression dialect (framework ADR-0058).

  - `@object-ui/core`: new `evalRowPredicate` + `resolveConditionalFormatting`
    helpers (next to `evalFieldPredicate`). One implementation of all three
    formatting rule shapes; dialect routing (a `{ dialect: 'cel' }` envelope is
    always CEL; a bare string is CEL unless it carries legacy-only syntax
    (`${…}` / `===` / `?.` / `.includes()`), which routes to the old engine with a
    one-time deprecation warning); the native `{ field, operator, value }` form is
    translated to CEL.
  - `@object-ui/react`: new `useRowPredicate` hook (canonical CEL, ambient
    predicate scope merged).
  - Consumers converged: `ListView.evaluateConditionalFormatting` (thin wrapper,
    export kept), `ObjectGrid` row styling (inline copy removed), kanban card
    styles, and the grid / data-table row-action menus. `plugin-view`'s kanban
    branch now forwards top-level `conditionalFormatting` (previously dropped).
  - Row-action `visible` fails **closed** (broken predicate → hidden + warn);
    `disabled` fails soft. The CEL `in` operator (and list membership) now work in
    row predicates — the legacy engine could not parse them.
  - The legacy `FormField.condition: { field, equals/notEquals/in }` is retired to
    a CEL translation (back-compat preserved); `FieldDesigner` migrated to
    `visibleWhen`.

  Fully back-compat: existing conditional-formatting rules, row-action predicates,
  and form `condition` metadata keep working (translated / routed as needed).

- 5b52624: feat(detail): record-level inline edit — shared `InlineEditContext` + one atomic Save (objectui#2407 P1)

  Lift the inline-edit session out of `DetailView`'s private state into a
  record-level, shared context so a record page's surfaces can share ONE draft and
  commit it in ONE atomic, cross-field-validated write (replacing the per-field
  save loop).

  - **`InlineEditContext` / `InlineEditProvider` / `useInlineEdit`** (@object-ui/react)
    — pure UI state (`editing`, `canEdit`, `draft`, `autoFocusField`, `saving`,
    `error` + `enter` / `setField` / `cancel` / `reset`). A _separate_ context from
    `RecordContext` (mirrors `HighlightFieldsContext`) so per-keystroke draft churn
    doesn't re-render other `record:*` consumers.
  - **`<InlineEditSaveBar>`** (@object-ui/plugin-detail) — the record-level sticky
    Save/Cancel bar. Commits the whole draft in ONE
    `dataSource.update(obj, id, draft, { ifMatch: data.updated_at })` → `refresh()`;
    a `409 CONCURRENT_UPDATE` reuses `<ConcurrentUpdateDialog>` (reload / overwrite).
    A callback mode (`onFieldSave`) preserves the drawer's per-field persistence
    contract with plugin-gantt/calendar/kanban.
  - **`DetailView`** now consumes `useInlineEdit()` instead of owning inline-edit
    state; its header/inline Save-Cancel bars and per-field batch-save are removed
    (the approval-lock badge stays). Rendered without a provider it is simply
    read-only.
  - **`record:details`** and **`RecordDetailDrawer`** each wrap their `DetailView`
    in an `<InlineEditProvider>` + `<InlineEditSaveBar>`. The object-lifecycle /
    permission gate flows through `canEdit`; computed / readonly / system fields
    and the OCC path are unchanged.

  Guardrails preserved: computed (`formula`/`summary`/`rollup`/`auto_number`) +
  `readonly` + system fields expose no editor; `canEdit` gate; OCC (`ifMatch` +
  `ConcurrentUpdateDialog`); the atomic partial update carries only user-edited
  keys (never computed/read-only). Editable highlights ride on top of this in P2.

- f94905d: remove(react): drop the unused `FormRenderer` / `FieldFactory` duplicate render path (#2545)

  `FormRenderer` (and its captive `FieldFactory`) was an exported-but-dead second
  form render path: zero runtime consumers anywhere in the repo — the only import
  was its own test file. It duplicated `@object-ui/plugin-form`'s `ObjectForm`
  (the path every app actually uses via the component registry) but had drifted
  into a degraded variant: raw-HTML/Tailwind instead of the shared UI primitives,
  a hard-coded Submit button, and no support for `submitBehavior` / `aria` /
  `groups`.

  **Breaking (ships as minor per the pre-1.0 launch-window convention):** the
  public exports `FormRenderer`, `FormRendererProps`, `FieldFactory`,
  `FieldFactoryProps`, and `ExtendedFormField` are removed from
  `@object-ui/react`. Render forms through the `object-form` schema node
  (`@object-ui/plugin-form` `ObjectForm`, reachable from a `FormViewSchema` via
  `SchemaRenderer` / the spec bridge) instead. Closes Phase 4 of #2545.

### Patch Changes

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [23d65c3]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f0f10f5]
  - @object-ui/i18n@14.1.0
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/data-objectstack@14.1.0

## 14.0.0

### Minor Changes

- 86c69c3: ADR-0089: read the canonical `visibleWhen` conditional-visibility predicate in the form + page renderers.

  `@objectstack/spec` now unifies conditional visibility under a single canonical key, `visibleWhen`, and folds the deprecated `visibleOn` (view form) / `visibility` (page component) aliases into it at parse. This updates ObjectUI to read the canonical key:

  - **Page renderer** (`SchemaRenderer`) — evaluates `visibleWhen` first (show-when-truthy), then the deprecated `visibleOn` / `visibility` as a defensive read for raw / un-normalized metadata. `visibleWhen` is stripped from DOM props.
  - **Spec→node bridges** — the page bridge maps a component's `visibleWhen ?? visibility` onto the node's canonical `visibleWhen`; the form-view bridge maps a field's `visibleWhen ?? visibleOn` onto the ObjectForm view-level predicate slot.
  - **Form renderers** — the `@object-ui/react` `FormRenderer` prefers `visibleWhen` over the `visibleOn` alias. (`ObjectForm`/`form.tsx` already evaluated `visibleWhen`.)
  - **Types** — the component base schema (`BaseSchema` / `base.zod`) gains the canonical `visibleWhen`; `visibleOn` is marked `@deprecated`.

  Fully back-compat: existing `visibleOn` / `visibility` metadata keeps working through the alias reads.

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [c70bca7]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [5971cc4]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/i18n@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/data-objectstack@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
  - @object-ui/i18n@13.2.0
  - @object-ui/data-objectstack@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/data-objectstack@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/core@13.0.0
  - @object-ui/data-objectstack@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/core@12.1.0
  - @object-ui/data-objectstack@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/data-objectstack@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

### Minor Changes

- 6fffd3d: Client-side data-invalidation bus — refresh data, don't rebuild UI (objectui#2269 P1).

  - `@object-ui/react` gains the bus: `notifyDataChanged({objectName, recordId?})`, `useDataInvalidation(objectName, recordId?)` (reader nonce), `subscribeDataChanges`, and `useMutationInvalidationBridge(dataSource)` which fans every dataSource write (`MutationEvent`) onto the bus. The bus also dispatches the legacy `objectui:related-changed` window event, so pre-bus listeners keep working.
  - The `key={refreshKey}` remount of `RecordDetailView` (AppContent) and the `key={actionRefreshKey}` remount of `DetailView` (RecordDetailView) are GONE: record data now refetches in place via the bus — scroll, collapsed sections, tabs and in-progress inline edits survive every save/action/undo. All nine action-success bumps became precisely-scoped `notifyDataChanged` calls; undo/redo use the operation's own `objectName`/`recordId`.
  - `RelatedCountStore` is wired to the bus (tab count badges refetch after any change to their object) and its `useSyncExternalStore` snapshot is now a monotonic version — previously it returned the same `Map` reference, so `emit()` never re-rendered subscribers and invalidations left badges stale; `useRelatedCountVersion()` is exported and drives the probe effect's re-fetch.
  - app-shell also gains the reserved URL-param registry (`urlParams.ts` — `form`/`formObject`/`formLink`/`tab`/`recordId`/`palette`/`shortcuts` constants replace scattered string literals) and AGENTS.md Commandment #8 (UI-state classification: state that must survive a data refresh may never live only in an uncontrolled component).

### Patch Changes

- fae75e2: Fix two bugs verified still-present after #2254 claimed to resolve them (framework#2620 / framework#2616 Showcase UX pass, tracked in #2268):

  - **Wizard/form `submitBehavior: 'thank-you'` allowed duplicate resubmission.** #2254 fixed the spec-bridge dropping `submitBehavior` before it reached the renderer, so the configured toast message started appearing — but `WizardForm`'s last step and `ObjectForm`'s submit handler only ever called `toast.success(...)` for `thank-you`/`next-record`; the form stayed mounted and fully filled with its submit button re-enabled once the request settled, so a second click created a second record. Both components now track a terminal `submitted` state and, when set, replace the form with a confirmation panel (using the behavior's `title`/`message`, which were also never read before) — mirroring the pattern `apps/console/src/components/FormPage.tsx` already used for its own standalone forms.

  - **Command Center-style 3-up chart bands stayed collapsed to ~100-130px, and a dataset-bound chart's measure leaked its raw field name.**
    - `responsiveStyles` (and `style`) were declared on the page-spec `PageComponent` bridge input type but never copied onto the `SchemaNode` in `spec-bridge/bridges/page.ts::mapComponent()` — so a page author's ADR-0065 layout override (e.g. forcing `display: 'grid'` on a `type: 'flex'` band) never reached `SchemaRenderer`, and the node silently fell back to its default flex layout. Both fields are now mapped through.
    - `ObjectChart`'s dataset-bound fetch path (`schema.dataset` + `ds.queryDataset(...)`) discarded the response's `fields` array (which carries each measure's `label`, e.g. `{ name: 'task_count', label: 'Tasks' }`) before it ever reached `buildChartSeries()` — whose `fields` param already resolves this correctly (see `chart-series.test.ts`) — so the legend/tooltip always fell back to the raw field name. The fetched `fields` are now captured and threaded through.

- Updated dependencies [544d8eb]
- Updated dependencies [9255686]
- Updated dependencies [1072701]
  - @object-ui/i18n@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/data-objectstack@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [9cd9be1]
- Updated dependencies [c38d107]
- Updated dependencies [790558b]
- Updated dependencies [c0164ad]
  - @object-ui/types@11.4.0
  - @object-ui/i18n@11.4.0
  - @object-ui/data-objectstack@11.4.0
  - @object-ui/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [d23d6eb]
  - @object-ui/i18n@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/data-objectstack@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/core@11.2.0
  - @object-ui/data-objectstack@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/i18n@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0
  - @object-ui/types@11.1.0
  - @object-ui/core@11.1.0
  - @object-ui/data-objectstack@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/i18n@7.3.0
- @object-ui/data-objectstack@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [8e7c1da]
- Updated dependencies [d23db5c]
  - @object-ui/i18n@7.2.0
  - @object-ui/types@7.2.0
  - @object-ui/core@7.2.0
  - @object-ui/data-objectstack@7.2.0

## 7.1.0

### Minor Changes

- a71be60: chore: drop the unrendered `blank` / `record_review` page types and their config

  The `blank` and `record_review` page types have no renderer and were removed
  from `@objectstack/spec`'s `PageTypeSchema` (framework#2265, enforce-or-remove).
  This drops their now-dead references in objectui so the upstream spec can hard-
  remove `BlankPageLayoutSchema` / `RecordReviewConfigSchema`:

  - `PageType` union: removed `dashboard` / `form` / `record_detail` /
    `record_review` / `overview` / `blank` (grid/gallery/kanban/calendar/timeline
    remain — those are list _visualizations_, a separate cleanup).
  - Removed `blankLayout` from `PageLayout` and the `blankLayout` / `recordReview`
    handling in the spec→SDUI page bridge.
  - Removed the redundant `BlankPageLayout{,Schema,Item,ItemSchema}` re-import from
    `@objectstack/spec/ui` (it was never used).

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/data-objectstack@7.1.0
  - @object-ui/i18n@7.1.0

## 7.0.0

### Minor Changes

- c12986e: Add resultDialog + target interpolation for one-shot action reveals

  Some platform actions return values the user MUST copy now because the
  server will not surface them again — 2FA TOTP URI + backup codes, freshly
  minted OAuth client_secret, regenerated recovery codes. Previously these
  had to ship as bespoke pages in `apps/account` because actions only
  emitted a fire-and-forget toast.

  **`@object-ui/core` — ActionRunner**

  - New `ActionDef.resultDialog: ResultDialogSpec` field. When set on a
    successful action, the runner suppresses the `successMessage` toast and
    awaits the registered `ResultDialogHandler` instead. Missing handler is
    non-fatal (logs a warning); rejected handler is treated as acknowledged.
  - New `setResultDialogHandler(handler)` setter.
  - New types: `ResultDialogSpec`, `ResultDialogFieldSpec`,
    `ResultDialogHandler`.
  - `executeUrl` and `executeAPI` now run `${param.X}` and `${ctx.X}`
    interpolation against `target` before fetching / navigating. Values are
    `encodeURIComponent`'d, missing keys resolve to empty string. `ctx`
    exposes `origin`, `user`, `org`, `recordId` by default; consumers can
    inject more via `context.ctx`.

  **`@object-ui/react`**

  - `ActionProvider` and `useActionRunner` both gained an `onResultDialog`
    option that wires straight through to the runner.

  **`@object-ui/app-shell`**

  - New `ActionResultDialog` component — promise-based, blocks click-outside
    and Escape (the user MUST click acknowledge), renders five field
    formats: `qrcode` (client-side via the `qrcode` package — never sent
    off-device, so 2FA URIs stay secret), `code-list`, `secret`, `text`,
    `json`. Falls back to `json` when a value's shape doesn't match its
    declared format.
  - `ObjectView` and `RecordDetailView` install the handler and mount the
    dialog automatically, so any action with `resultDialog` declared in
    metadata now works without code changes.
  - New dependency: `qrcode@^1.5.x` for client-side QR rendering.

  Pairs with the framework-side `Action.resultDialog` schema added in
  `@objectstack/spec` and the `sys_two_factor` / `sys_oauth_application` /
  `sys_account` updates in `@objectstack/platform-objects`.

### Patch Changes

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

- e95cc25: Fix the NavigationSyncEffect baseline race: lazily-loaded `page`/`dashboard` metadata (and the empty cache during `invalidate()` refetch) could seed a partial diff baseline, making platform `sys_` pages look "user added" — the effect then wrote them into every app's navigation, 403ing on ADR-0010 locked apps (red "Failed to update navigation" toasts) and polluting writable apps. The effect now diffs only while both types are `status === 'ready'` (new optional `MetadataContextValue.getTypeStatus`), never treats `sys_`-prefixed artifacts as user creations, and skips apps whose `_lock`/`protection.lock` is `full`/`no-overlay`.
- abe8ebc: Repoint `useClientNotifications` to the ADR-0030 `@objectstack/client` surface

  The `useClientNotifications` bridge hook called `client.notifications.*` with
  signatures that no longer exist on `@objectstack/client@7.x`:

  - `registerDevice(token, platform)` → the SDK takes a single
    `RegisterDeviceRequest` object (`{ token, platform }`).
  - `markAsRead(id)` → there is no single-id method; the SDK exposes
    `markRead(ids: string[])`. The hook keeps its friendly single-id API and
    adapts to the batch call.

  These helpers are the stable transport contract for ADR-0030 (Notification
  Convergence): server-side they route to the L5 `sys_inbox_message`
  materialization and the `sys_notification_receipt` read-state spine — the
  re-modeled `sys_notification` L2 event no longer carries recipient/read
  columns. (The Console bell itself reads the inbox + receipts directly via the
  generic data API; see the `@object-ui/app-shell` bell cut-over.)

  ## Cut-over sequence (operational — run in this order)

  The Console UI repoint must land together with the framework pipeline **and**
  the data migration so the bell is never blank and read-state is never lost:

  1. Deploy the framework ADR-0030 change (objects + `emit()` + producers). New
     notifications now land in `sys_inbox_message` + `sys_notification_receipt`.
  2. Run the data migration **once** to carry existing notifications across —
     `migrateSysNotificationToEvent({ driver, data })` from
     `@objectstack/metadata/migrations`. It splits each legacy `sys_notification`
     inbox row into a `sys_inbox_message` + receipt, rewrites the row to the event
     shape, and clears the legacy columns. It is **idempotent** and reports
     `not_applicable` on fresh installs. This runs against the ObjectStack
     **server/data engine** — it is not a Console (frontend) step.
  3. Deploy the objectui repoint (this change + the `@object-ui/app-shell` bell
     cut-over).

- 2270239: feat: scoped style-object rendering (ADR-0065)

  A metadata node may carry `responsiveStyles` (per-breakpoint CSS-property maps);
  `SchemaRenderer` compiles it to **id-scoped CSS** injected as a `<style>` tag and
  appends a scope class to the node. Build-independent (arbitrary values + design
  tokens pass through verbatim — no Tailwind JIT), collision-free (per-node scope,
  unlayered so it beats base utilities), responsive-correct (model breakpoint maps
  → generated `@media`, never `md:` variant classes). Adds `compileScopedStyles`/
  `scopeClassFor`/`hasResponsiveStyles` to `@object-ui/core` and an SDUI design-token
  palette (`--space-*`, `--surface`, `--brand`, …) to the theme. Mirrors Builder.io.

- Updated dependencies [5976ba3]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [30ee761]
- Updated dependencies [053c948]
- Updated dependencies [b99d9bd]
- Updated dependencies [053c948]
- Updated dependencies [89e113c]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [77cc6bb]
- Updated dependencies [97c6831]
- Updated dependencies [cb2fdb1]
- Updated dependencies [a58c6b8]
- Updated dependencies [c3749eb]
- Updated dependencies [c09f44e]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [5332639]
- Updated dependencies [3870c20]
- Updated dependencies [b88c560]
- Updated dependencies [0ad72a6]
- Updated dependencies [3fa23a7]
- Updated dependencies [18d0339]
- Updated dependencies [59b6bbb]
- Updated dependencies [d16566f]
- Updated dependencies [1394e34]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [2f31406]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/data-objectstack@7.0.0
  - @object-ui/i18n@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/i18n@6.2.3
- @object-ui/data-objectstack@6.2.3

## 6.2.2

### Patch Changes

- a66f788: fix(react): preserve `data-obj-schema-invalid` flag across re-renders

  `SchemaRenderer` runs a post-mount `forceUpdate` to pick up lazy plugin
  registrations. The dev-mode validator was deduping via a `WeakSet` that
  always returned `valid: true` on the second call, which stripped the
  `data-obj-schema-invalid` attribute on the immediate re-render. The
  result and the "warn-once" tracking are now stored separately: a
  `WeakMap` caches the validation outcome (so the visual flag is stable),
  while a `WeakSet` continues to dedupe `console.warn` output.

  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/i18n@6.2.2
  - @object-ui/data-objectstack@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/i18n@6.2.1
- @object-ui/data-objectstack@6.2.1

## 6.2.0

### Patch Changes

- Updated dependencies [fe3c1d3]
- Updated dependencies [ec8dcde]
  - @object-ui/data-objectstack@6.2.0
  - @object-ui/types@6.2.0
  - @object-ui/core@6.2.0
  - @object-ui/i18n@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/data-objectstack@6.1.0
  - @object-ui/i18n@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/i18n@6.0.4
- @object-ui/data-objectstack@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/i18n@6.0.3
- @object-ui/data-objectstack@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/i18n@6.0.2
- @object-ui/data-objectstack@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/i18n@6.0.1
- @object-ui/data-objectstack@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/i18n@6.0.0
- @object-ui/data-objectstack@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/i18n@5.4.2
- @object-ui/data-objectstack@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/i18n@5.4.1
- @object-ui/data-objectstack@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/data-objectstack@5.4.0
  - @object-ui/i18n@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/i18n@5.3.2
- @object-ui/data-objectstack@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/i18n@5.3.1
- @object-ui/data-objectstack@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/i18n@5.3.0
- @object-ui/data-objectstack@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/i18n@5.2.1
- @object-ui/data-objectstack@5.2.1

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

- 3ebba63: Fix silent blank page on shorthand record deep-links.

  Three related fixes that all addressed the same UX: a user follows a URL
  shaped `/{object}/{recordId}` and sees a completely blank content area.

  1. **`useNavigationOverlay` produced the broken URL itself.** When
     middle-click / Cmd-click opened a gallery card in a new tab and no
     `onNavigate` was provided, the hook built `/{object}/{id}` — a URL
     shape that does not match any route in the console route table. The
     builder now emits the canonical `/{object}/record/{id}`.
  2. **Shorthand redirect for externally shared links.** Even with the
     producer fixed, links pasted from email / Slack / older builds
     still use the shorthand. The console now intercepts
     `/{:objectName}/:maybeRecordId` and, when the second segment looks
     like a record id (URL-safe slug ≥ 6 chars, not a reserved keyword),
     redirects to `/{objectName}/record/{recordId}` preserving query and
     hash.
  3. **Visible 404 fallback.** Routes that match nothing at all now
     render an explicit "Page not found" empty state with a "Go back"
     action instead of leaving the content area blank. Silent failures
     are now visible failures.

- aa063db: `useRecordSearch` now orders hits by relevance instead of object-fanout
  order. Tiers (higher wins):

  - 110: exact recordId paste
  - 100: display exactly equals the query
  - 80: display starts with the query
  - 60: any token in display starts with the query
  - 40: display contains the query as a substring

  This makes `⌘K → "Ada"` rank "Ada Lovelace" above "AdvancedTradingAccount"
  even though Account is queried before Contact in the fanout.

  `RecordSearchHit` gains a `score` field for callers that want to render
  hint chips, filter low-confidence rows, or further customize ordering.

- 7c7400a: feat(react): dev-mode schema validation in SchemaRenderer

  `SchemaRenderer` now runs the canonical `validateSchema` from
  `@object-ui/core` on every schema object it renders (deduped per-object
  via a WeakSet so re-renders don't re-log). Errors are surfaced via a
  single grouped `console.warn` that includes the offending JSON path,
  and the host element receives `data-obj-schema-invalid="true"` so apps
  can hook a visual cue (e.g. red outline) via CSS.

  The entire pass is gated on `process.env.NODE_ENV !== 'production'`
  and is a no-op in production builds — zero runtime cost shipped to
  users.

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [321294c]
- Updated dependencies [b2d1704]
- Updated dependencies [0a644f0]
- Updated dependencies [a3cb88f]
- Updated dependencies [5425608]
- Updated dependencies [e919433]
- Updated dependencies [70b5570]
- Updated dependencies [d9c3bae]
- Updated dependencies [d1442e3]
  - @object-ui/types@5.2.0
  - @object-ui/data-objectstack@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/i18n@5.2.0

## 5.1.1

### Patch Changes

- @object-ui/types@5.1.1
- @object-ui/core@5.1.1
- @object-ui/i18n@5.1.1
- @object-ui/data-objectstack@5.1.1

## 5.1.0

### Patch Changes

- bd8447d: Three platform-wide detail polish items.

  **Tighter page rhythm**

  - Outer `PageRenderer` padding `p-4 md:p-6 lg:p-8` → `p-3 md:p-4 lg:p-6`
    and outer body wrap `space-y-8` → `space-y-6` so list / detail / home
    pages share the same edge rhythm. Cuts ~16px of edge slack on lg.

  **Highlights KPI treatment**

  - `HeaderHighlight` now renders numeric / currency / percent / decimal
    values as KPI numbers (`text-xl md:text-2xl font-semibold tabular-nums`)
    instead of the uniform `text-sm font-semibold`, so amount / probability
    / count fields read as headline stats — Salesforce-style key facts.

  **Discussion footer upgrade**

  - `RecordActivityTimeline` now uses `RichTextCommentInput` (bold / italic /
    list / code, `@`-mention autocomplete, preview toggle, Send) instead of
    a bare `<textarea>`.
  - `DiscussionContext` gains an optional `mentionSuggestions` array that
    hosts can wire (e.g. team member directory). Falls back to free-text
    `@mention` when omitted.
  - `RecordChatterPanel` threads `mentionSuggestions` through both inline
    and sidebar positions.

- d51a577: feat(platform): Discussion attachments + @mention directory + Reference Rail aside

  - **Discussion attachments** — `RichTextCommentInput` now accepts an `extraSlot`
    and a `canSubmitEmpty` flag so hosts can mount the existing
    `CommentAttachment` composer beneath the editor without forking the toolbar.
    `RecordActivityTimeline` plumbs the attachments through
    `DiscussionContext.onUploadAttachments` and submits attachment-only comments.
  - **@mention directory** — `DiscussionContext` gains a `mentionSuggestions`
    field; `RecordDetailView` populates it from the host `sys_user` collection so
    `@` autocomplete in the composer now resolves against real users.
  - **Reference Rail** — New `record:reference_rail` renderer + a dedicated
    `aside` region emitted by `buildDefaultPageSchema` whenever a record has
    ≥ 2 related lists. The rail surfaces a Salesforce/HubSpot-style snapshot
    of related collections (count badge + top 3 records) on `xl+` viewports.
  - **Layout** — `PageRenderer`'s structured-layout `<aside>` wrappers now honor
    `aside.className`, letting schemas attach responsive utilities like
    `hidden xl:flex` to the rail region.

- Updated dependencies [1976691]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [49b1760]
- Updated dependencies [c0b236f]
  - @object-ui/i18n@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/data-objectstack@5.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [cab6a93]
  - @object-ui/i18n@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2
  - @object-ui/data-objectstack@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/i18n@5.0.1
- @object-ui/data-objectstack@5.0.1

## 5.0.0

### Minor Changes

- 927187a: Phase N.1 + N.2: visual polish for record detail pages.

  **N.1 — System actions on full Lightning pages.** `PageHeaderRenderer`
  now merges `headerSystemActions` from `RecordContext` with authored
  actions (authored wins on name/id collision), so full custom pages
  (lead, opportunity, ...) once again show 编辑 / 分享 / 删除 alongside
  their authored actions. `sys_share` and `sys_delete` now use the
  `outline` variant instead of `destructive` to read better in
  multi-button clusters.

  **N.2 — Hide empty fields by default in synth detail pages.**
  `record:details` defaults `section.hideEmpty` to `true` so synthesized
  pages don't render label graveyards on first load. The "显示 N 个空字段"
  reveal toggle is preserved as the user-facing escape hatch. Authors can
  opt back into showing every field by setting `hideEmpty: false` on the
  section schema.

- 8435860: Phase N.4b: highlight↔body dedup now works for hand-authored Lightning
  pages too.

  Adds a small `HighlightFieldsContext` registry. `record:highlights`
  registers the field names it currently surfaces; `record:details` unions
  that live set into its `hideFieldNames` filter so a field shown in the
  highlight strip is never duplicated in the section grid below.

  Previously the dedup only fired for synth-generated pages (via the
  `hideFields` prop passed by `buildDefaultPageSchema`). Custom Lightning
  pages (e.g. opportunity) showed `所属客户` both in the strip and in the
  body. The registry-based approach covers both code paths uniformly with
  no schema author work required.

  The registry uses `useSyncExternalStore` so adding/removing highlights
  notifies consumers without triggering the provider value identity to
  change — avoiding the update-loop that a naive context implementation
  would cause.

  `RecordDetailView` mounts `<HighlightFieldsProvider>` once per record
  page so the two renderers share state.

- 74962b0: feat(detail): record:discussion schema component + flush accordion variant

  - New `record:discussion` schema type lets authors place the record
    chatter feed anywhere in a custom Page schema. Wired through a
    shared `DiscussionContext` provider on the `assignedPage` branch
    of `RecordDetailView`; auto-append still applies when no explicit
    `record:discussion` / `record:chatter` node is present.
  - `page:accordion` gains a `variant` prop. Default `flush` strips the
    per-item border so accordion sections no longer double-wrap inner
    Card-bearing renderers (RelatedList, etc.). Authors who want the
    old visual pass `variant: 'card'`.
  - `translateLabel` now handles compound labels split by `&`, `and`,
    or `和` (e.g. `Notes & Attachments` → `备注与附件`).

- 7213027: feat(detail): slotted record pages (Track 3 Phase I)

  Introduce `kind: "slotted"` record pages that override one or more
  named slots while letting the default-page synthesizer fill in the
  rest. Authors no longer need to re-author the entire page just to
  customize the header or one tab.

  **Slot menu (v1):**

  - `header` — replaces `page:header`
  - `actions` — replaces the `record:quick_actions` action bar
  - `highlights` — replaces the chips + chevron path strip
  - `details` — replaces the Details tab body (other tabs stay synthesized)
  - `tabs` — replaces the entire `page:tabs` node (wins over `details`)
  - `discussion` — replaces the inline `record:discussion` footer

  Each slot is a full replacement at the slot boundary. To compose
  default + custom, call the corresponding `buildDefault*` sub-builder
  (now exported from `@object-ui/plugin-detail`):
  `buildDefaultHeader`, `buildDefaultActions`, `buildDefaultHighlights`,
  `buildDefaultDetails`, `buildDefaultTabs`, `buildDefaultDiscussion`.

  **Author shape:**

  ```ts
  {
    type: 'record',
    object: 'account',
    kind: 'slotted',
    slots: {
      header: { type: 'page:header', properties: { ... } },
    },
  }
  ```

  **API changes:**

  - `PageSchema` (in `@object-ui/types`): adds `kind?: 'full' | 'slotted'`
    (default `'full'`) and `slots?: PageSlotMap`.
  - `usePageAssignment` (in `@object-ui/react`): result now exposes a
    `slots` field populated when the matched page has `kind === 'slotted'`.
    Existing `page` field is unchanged for full pages.
  - `buildDefaultPageSchema` (in `@object-ui/plugin-detail`): accepts an
    `options.slots` map that overrides individual regions at synthesis time.

### Patch Changes

- Updated dependencies [8930b15]
- Updated dependencies [7213027]
- Updated dependencies [c7561a7]
  - @object-ui/i18n@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/data-objectstack@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/i18n@4.8.0
- @object-ui/data-objectstack@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/i18n@4.7.0
- @object-ui/data-objectstack@4.7.0

## 4.6.0

### Patch Changes

- @object-ui/types@4.6.0
- @object-ui/core@4.6.0
- @object-ui/i18n@4.6.0
- @object-ui/data-objectstack@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [22fa558]
  - @object-ui/types@4.5.0
  - @object-ui/i18n@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/data-objectstack@4.5.0

## 4.4.0

### Patch Changes

- @object-ui/types@4.4.0
- @object-ui/core@4.4.0
- @object-ui/i18n@4.4.0
- @object-ui/data-objectstack@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [5f4ac6e]
  - @object-ui/i18n@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1
  - @object-ui/data-objectstack@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [f196cf4]
- Updated dependencies [ee1cc96]
- Updated dependencies [0b032be]
- Updated dependencies [115d36a]
- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/i18n@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0
  - @object-ui/data-objectstack@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/i18n@4.2.1
- @object-ui/data-objectstack@4.2.1

## 4.2.0

### Patch Changes

- Updated dependencies [eb738bd]
- Updated dependencies [650392e]
- Updated dependencies [84b4bf1]
  - @object-ui/i18n@4.2.0
  - @object-ui/types@4.2.0
  - @object-ui/core@4.2.0
  - @object-ui/data-objectstack@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/i18n@4.1.0
- @object-ui/data-objectstack@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/i18n@4.0.12
- @object-ui/data-objectstack@4.0.12

## 4.0.11

### Patch Changes

- Updated dependencies [1909bc3]
  - @object-ui/i18n@4.0.11
  - @object-ui/types@4.0.11
  - @object-ui/core@4.0.11
  - @object-ui/data-objectstack@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/i18n@4.0.10
- @object-ui/data-objectstack@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/i18n@4.0.9
- @object-ui/data-objectstack@4.0.9

## 4.0.8

### Patch Changes

- Updated dependencies [3d58eaa]
  - @object-ui/i18n@4.0.8
  - @object-ui/types@4.0.8
  - @object-ui/core@4.0.8
  - @object-ui/data-objectstack@4.0.8

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

- Updated dependencies [7c9b85c]
- Updated dependencies [fd15918]
  - @object-ui/core@4.0.7
  - @object-ui/i18n@4.0.7
  - @object-ui/data-objectstack@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- @object-ui/types@4.0.6
- @object-ui/core@4.0.6
- @object-ui/i18n@4.0.6
- @object-ui/data-objectstack@4.0.6

## 4.0.5

### Patch Changes

- @object-ui/types@4.0.5
- @object-ui/core@4.0.5
- @object-ui/i18n@4.0.5
- @object-ui/data-objectstack@4.0.5

## 4.0.4

### Patch Changes

- @object-ui/types@4.0.4
- @object-ui/core@4.0.4
- @object-ui/i18n@4.0.4
- @object-ui/data-objectstack@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/i18n@4.0.3
  - @object-ui/data-objectstack@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/i18n@4.0.1
- @object-ui/data-objectstack@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/data-objectstack@4.0.0
  - @object-ui/i18n@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/data-objectstack@3.4.0
  - @object-ui/i18n@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/i18n@3.3.2
- @object-ui/data-objectstack@3.3.2

## 3.3.1

### Patch Changes

- @object-ui/types@3.3.1
- @object-ui/core@3.3.1
- @object-ui/i18n@3.3.1
- @object-ui/data-objectstack@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/i18n@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/i18n@3.2.0

## 3.1.5

### Patch Changes

- Updated dependencies [cfe0596]
  - @object-ui/i18n@3.1.5
  - @object-ui/types@3.1.5
  - @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/i18n@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/i18n@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/i18n@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/i18n@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/i18n@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/i18n@3.0.2

## 3.0.1

### Patch Changes

- adf2cc0: Patch release for bug fixes and improvements
  - @object-ui/types@3.0.1
  - @object-ui/core@3.0.1
  - @object-ui/i18n@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0
  - @object-ui/core@3.0.0
  - @object-ui/i18n@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/i18n@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/core@0.3.1

## 0.3.0

### Minor Changes

- Unified version across all packages to 0.3.0 for consistent versioning

## 0.2.2

### Patch Changes

- New plugin-object and ObjectQL SDK updates

  **Added:**

  - New Plugin: @object-ui/plugin-object - ObjectQL plugin for automatic table and form generation
    - ObjectTable: Auto-generates tables from ObjectQL object schemas
    - ObjectForm: Auto-generates forms from ObjectQL object schemas with create/edit/view modes
    - Full TypeScript support with comprehensive type definitions
  - Type Definitions: Added ObjectTableSchema and ObjectFormSchema to @object-ui/types
  - ObjectQL Integration: Enhanced ObjectQLDataSource with getObjectSchema() method using MetadataApiClient

  **Changed:**

  - Updated @objectql/sdk from ^1.8.3 to ^1.9.1
  - Updated @objectql/types from ^1.8.3 to ^1.9.1

- Updated dependencies
  - @object-ui/core@0.2.2

## 0.2.1

### Patch Changes

- Patch release: Add automated changeset workflow and CI/CD improvements

  This release includes infrastructure improvements:

  - Added changeset-based version management
  - Enhanced CI/CD workflows with GitHub Actions
  - Improved documentation for contributing and releasing

- Updated dependencies
  - @object-ui/core@0.2.1
