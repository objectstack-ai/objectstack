# @object-ui/layout

## 18.1.0

### Patch Changes

- 8cf3a86: `AppShell` now draws one `main` landmark. `SidebarInset` already renders a `<main>`, and the content element inside it was a second `<main>`, so every console page (Setup record pages included) announced two main regions to screen readers. The content element is now a `<div>`; `className` still lands on it, and the skip link still targets the console's route slot.
- fb25620: A sidebar navigation group now opens on first view unless it declares `expanded: false` (or the legacy `defaultOpen: false`), however many entries it holds (objectui#13336).
  
  `NavigationRenderer` used to collapse any group that declared neither field once it had eight or more children. On Setup that closed Configuration (13 entries) although only Advanced declares `expanded: false`, hiding entries such as Localization, Email and Authentication on first view. The count rule is gone: a group holding the current route opens; otherwise its declared `expanded` / `defaultOpen` decides; otherwise it opens. Studio's navigation preview follows the same rule, so it still matches the running sidebar.
  
  An app that relied on a long, undeclared group starting closed should now declare `expanded: false` on it.
- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [7c405b7]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [49a536d]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [c8f8b10]
  - @object-ui/types@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- 9fc68aa: Screen readers can name and reach the controls of the view tab bar, the settings form, the sidebar menus, the table's selection column and the percent cell (objectui#11690). axe-core (wcag2a + wcag2aa) on an object list page and on a Setup settings page reported the faults below; each is fixed where it is produced and pinned by an axe run on that component.
  
  - **View tab bar (`ViewTabBar`).** The "+" add-view button is named, through the existing `view.addView` key, and its tooltip reads the same translated words instead of a hard-coded "Add View". Each view is now a `<button>`; the current one carries `aria-current="true"`. The views were `role="tab"` elements with no `tablist`, and the active view's actions button sat inside its tab, so it was a control inside a control. That button is now the view button's sibling, still named "View actions for …" and still one Tab stop away. Tab roles could not hold it: a tab's content is presentational and a tablist may contain only tabs. These views never had the tabs keyboard model (arrow keys, a tab panel) either. Every view stays its own Tab stop. When the bar is not reorderable, as the console renders it, Enter or Space switches to the focused view. With drag-to-reorder on, Enter or Space on a view starts a keyboard drag instead, as it did before this change, so a view is switched to by click. The rename box is now outside the view button and is named through `view.rename`. With drag-to-reorder on, the sortable attributes describe the view as a button. Breaking for anything that queried the bar by `role="tab"` or `aria-selected`: query `data-testid="view-tab-ID"` or `aria-current` instead.
  - **Settings form (`@object-ui/console`).** Each row's label is bound to its control, so text, number, password, textarea, JSON, colour, switch and select controls are named by it. Clicking a label now focuses or toggles its control. A radio group and a multiselect checkbox group are named by the row label too.
  - **Sidebar menus (`NavigationRenderer`).** With drag-to-reorder on (the desktop default), every row was wrapped in a `<div>` between the menu's `<ul>` and its `<li>`. The sortable node is now the row's own `<li>`. A separator and a nested group inside a menu are now list items too: the separator's item is hidden from assistive tech, and a top-level group is unchanged.
  - **Table selection column (`data-table`).** The select-all checkbox and each row's checkbox are named through the existing `table.selectAllRows` and `table.selectRow` keys.
  - **Percent cell (`PercentCellRenderer`).** The progress bar is named by the formatted value beside it (`aria-labelledby`), so the name is in the viewer's locale.
  
  No language-pack key, export or prop is added; every new name reads a key the packs already carried.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- 8a55f0c: The console sidebar no longer lets a user drag the app's menu into a private order; the Pinned section is now the one place a user orders entries (objectui#12059). Arranging an app's navigation is Studio's job: the menu is drawn in the order authored for the app, and every user sees that order. This reverses objectui#11626, which had extended menu drag-to-reorder to grouped menus.
  
  **`@object-ui/layout` (breaking, declared `minor` per the version policy).** `NavigationRenderer` retires `enableReorder` and `onReorder`, and with them every sortable path through the menu: no menu row draws a grip or carries a sortable role. `AppSchemaRenderer` retires the same two props, which only handed them through. Two props are added for the pinned section: `pinnedOrder` (the pinned entry ids in the user's order; the section draws in that order, an unnamed pinned entry following in menu order) and `onPinnedReorder` (makes the pinned rows sortable and receives the drawn ids in their new order). A pinned row is dragged by the row itself: no grip at rest, a grab cursor, and a line marking where the row will land. From the keyboard, with the row's link focused, Space picks it up, the arrow keys move it, Space drops it and Escape cancels; Enter still follows the link. The row's link stays a link and the row's one focus stop. The click a pointer drag ends with is not followed.
  
  **`@object-ui/app-shell`.** The sidebar no longer reads or writes the per-user menu order it kept in localStorage (`objectui-nav-order-APP`); a key left from before is ignored. The pinned order is stored with the pins, in the `UserDataAdapter`-backed favorites, so it syncs across devices the way the pins do: it is the order of the `type: 'nav'` entries in the stored list. A new pin now joins the end of that order (a content favorite still goes first), and an unpin leaves the others in order. `useFavorites()` gains `reorderNavPins(navIds)`, which puts the named pins in a new order in the places they already hold, so a pin another app's sidebar draws and every content favorite stay put; `useNavPins()` gains `reorderPins(orderedIds)` over it, and its `pinnedIds` lists the pins in the user's order. At the nav-pin cap a new pin still joins the end and the earliest-pinned one rolls off. Pins made before this change are now drawn in their stored order, which is newest first (a pin used to be put at the front of the list), rather than in menu order, until the user drags them.
  
  **`@object-ui/i18n` (breaking, declared `minor`).** `console.nav.dragToReorder`, the label of the retired menu grip, is removed from all ten packs. `view.dragToReorder` is a different key and stays.
  
  **Clause-②: yes.** Published surface changes: `NavigationRendererProps` loses `enableReorder` / `onReorder` and gains `pinnedOrder` / `onPinnedReorder`; `AppSchemaRendererProps` loses `enableReorder` / `onReorder`; the return of `useFavorites()` gains `reorderNavPins`; the return of `useNavPins()` gains `reorderPins`; the `console.nav.dragToReorder` pack key leaves.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
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
- dcd1041: The console top bar is 48 px (`h-12`) in every frame, the height both approved console artboards draw (objectui#12639). It was 56 px (`h-14`).
  
  - **One height everywhere.** `AppShell`'s header (inside every app), Home, the organization list and an organization's pages, the full-page assistant at `/ai` and the `/studio` landing all draw the same bar, so it no longer changes height on the way from Home into an app or onto an organization page. Studio's package builder keeps its own header, which was already 48 px from `sm` up.
  - **The app sidebar follows the bar.** On desktop its column starts 48 px down and is the viewport's height less 48 px, so no gap opens between the bar and the sidebar.
  - **The bar's contents are unchanged.** Its controls (the product mark, the app pill, the preview chip, the search field, the bell, help and the avatar) are 32 px or shorter, so each keeps its size.
  
  No export, prop or type is added, removed or renamed. A host that renders `@object-ui/layout`'s `AppShell` gets the 48 px header too.
- 1b94d50: A navigation entry's API `dataSource` is read, and its `visible` sees the selected value as `data` (objectui#13029).
  
  The spec lets a navigation entry declare `dataSource: { provider: 'api', read: { url }, path? }` (`BaseNavItemSchema.dataSource`). Only the entry's `visible` reads the value, as `data` (for example `data.total == 1`). The label, the target and `children` do not.
  
  - `@object-ui/layout`: `VisibilityEvaluator` takes an optional second argument, the entry whose `visible` it judges. The item guard passes it on every path it serves: the rows, the derived area visibility and the Favorites section. The default evaluator reads no binding, so it hides an entry that declares one. An entry without the key renders as before.
  - `@object-ui/app-shell`: the sidebar, the `nav:menu` block and the command palette share one `visible` evaluator. It reads each binding the app's navigation declares through the page element's reader (`readElementApi`, with the host's signed-in `apiFetch`). The entry is hidden while the read is pending, after it fails, when `path` selects nothing, or when the spec refuses the binding. An entry without the key is evaluated as before, with no request and no wait.
  - `@object-ui/types`: the `dataSource` describe and doc on the navigation item now state what the console does with it. The accept set is unchanged.
- df71568: A navigation item's `visible` now takes `@objectstack/spec`'s `EvaluatedExpressionInputSchema` by reference, beside the boolean it already took (objectui#13075).
  
  The spec types every navigation entry's `visible` as an evaluated expression input: a non-blank CEL string, or the `{ dialect, source }` envelope the spec's own parse produces. objectui's `NavigationItemSchema` typed it as `boolean | string`, so the two disagreed both ways. This changes what `NavigationItemSchema` (and so `objectui validate`) accepts:
  
  - **Widened: the envelope is accepted.** `visible: { dialect: 'cel', source: "'org_admin' in current_user.positions" }` used to be refused. It parses now and is kept as written. The TypeScript type `NavigationItem['visible']` is `boolean | EvaluatedExpressionInput` (the spec's input type), so a typed literal can carry the envelope too.
  - **Narrowed (breaking): a blank string is refused.** `visible: ''` and a whitespace-only string used to pass. They are refused now with the spec's own code (`invalid_union` at `visible`) and sentence. A blank `source` inside an envelope is refused at `visible.source`, as the spec refuses it. To show an entry to everyone, omit `visible`.
  
  Unchanged: a non-blank string is still accepted and kept as a string (the validator does not rewrite it into an envelope), and `visible: true` / `false` are still accepted. The boolean is the one stated divergence from the spec on this key.
  
  Code that reads `NavigationItem['visible']` and passes it on as `string | boolean` no longer compiles: widen that parameter to `NavigationItem['visible']`.
  
  `@object-ui/layout` (minor): the exported `VisibilityEvaluator` type now takes `NavigationItem['visible']` instead of `string | boolean | undefined`, so an evaluator receives the envelope as authored. An evaluator a host passes in whose parameter is the old, narrower type no longer type-checks; widen it the same way. The runtime is unchanged: `NavigationRenderer` already handed the value through.
  
  `@object-ui/app-shell` (patch): the shell's navigation gates (`useNavMemberGates` and the `nav:menu` block) take the widened type internally. No exported type changes, and the runtime is unchanged: `evaluateNavigationVisibility` already evaluated the envelope.

### Patch Changes

- b88937b: Drag-to-reorder of a grouped sidebar menu, within each level (objectui#11626), was retired before it was released. objectui#12059 removed every drag-to-reorder of the sidebar menu: an app's menu order is authored in Studio, and every user sees that order. Nothing of objectui#11626 ships, because objectui#12059 retires the menu reorder whole: `NavigationRenderer`'s `enableReorder` / `onReorder`, the menu drag grip, and the sidebar's per-user menu order in localStorage (`objectui-nav-order-APP`), each of which predates objectui#11626, are gone. The objectui#12059 changeset describes what replaced them: the pinned section is the one place a user orders entries.
- f114263: In the collapsed (icon-mode) sidebar, a click on an icon reaches its row again. Before, a hidden group label could take the click instead (objectui#12744).
  
  The `SidebarGroupLabel` primitive hides a label in icon mode with `opacity-0` and `-mt-8` only. The invisible label stayed hit-testable and lay over the lower half of the row just above its group. A centre click on that row's icon landed on the label. A collapsible group's label toggled its group, the Recent label toggled Recent, and the row did not navigate.
  
  The labels that sit below a row now take no pointer events while the primitive hides them. The condition is the primitive's own `group-data-[state=collapsed]:group-data-[collapsible=icon]:` variant:
  
  - `@object-ui/layout`: `NavigationRenderer`'s collapsible group label, and its Favorites label (it sits below the Area switcher in a multi-area app);
  - `@object-ui/app-shell`: `UnifiedSidebar`'s Recent label.
  
  In the expanded sidebar nothing changes. A group's label still toggles its group by mouse and keyboard, and the Recent label still opens and closes Recent. The primitive itself is a Shadcn-synced file and is not edited: the class rides on the `className` each call site passes. Nothing is added to either package entry: no export, prop or type member.
- e43a162: In the collapsed (icon-mode) sidebar, a hidden group label is no longer a keyboard focus stop, and screen readers no longer announce it (objectui#12795). Before, Tab from the row above a collapsible group landed on the group's invisible label button, and Enter toggled a group the user could not see.
  
  The `SidebarGroupLabel` primitive hides a label there by fading it to `opacity-0`, which left it in the tab order and the accessibility tree. `NavigationRenderer`'s collapsible group and Favorites labels, `AppSchemaRenderer`'s Area label and `SidebarNav`'s group labels now also take `visibility: hidden` under the primitive's own icon-mode condition. The label still fades out before it is hidden. Tab now moves from a group's last row straight to the next group's first row.
  
  In the expanded sidebar and the mobile sheet nothing changes: every group label that took focus still does, and Enter still opens and closes its group. The primitive itself is a Shadcn-synced file and is not edited, and no export, prop or type member is added.
- d758f2f: Doc comment only. The `PageHeaderComponentProps` comment no longer says `@object-ui/app-shell` shares the name: the console's header props are now `ConsolePageHeaderProps`, so this package is the one authority for `PageHeaderComponentProps` (objectui#6349, batch 8). The type and its members are unchanged.
  
  No runtime behaviour changes.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [c096f03]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [e06365c]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [cef0eee]
- Updated dependencies [7241a81]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2a48bd4]
- Updated dependencies [c7b30bd]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [ce991bd]
- Updated dependencies [5f75cfa]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [e723f58]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [093d55b]
- Updated dependencies [a8051d6]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [3eb3ec1]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [726d8c9]
- Updated dependencies [ef71a09]
- Updated dependencies [619e3f7]
- Updated dependencies [c9e6742]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [611566b]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [c7462e7]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [69a408f]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [025130c]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [988aa9f]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [616df65]
- Updated dependencies [4b92c5a]
- Updated dependencies [3650d94]
- Updated dependencies [8cd4db4]
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
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [b403bb3]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/react@18.0.0

## 17.7.0

### Minor Changes

- d6a1a80: feat(layout): a host can hide a `doc` navigation entry the member may not read (objectui#10188)
  
  `NavigationRenderer`, `AppSchemaRenderer` and `hasVisibleNavigationItems` take an optional
  `checkDocTarget` — a `DocTargetChecker`, asked `{ book, doc }` for each `type: 'doc'` entry.
  An entry it answers `false` for is not drawn, is not collected into Favorites, and does not
  make its area count as visible: it joins the one guard statement the other item guards
  already share. Without it, `doc` entries draw as before.
  
  It is defence in depth. The server is the enforcer (ADR-0046 §6.7): its app read already
  leaves out a `doc` entry the member may not read. This layer holds no audience rules, so the
  host answers from the member's own doc / book reads. `DocNavTarget` and `DocTargetChecker` are
  exported. `CapabilityChecker` is unchanged: it asks whether the runtime has a target, and this
  checker asks whether the member may read it.
- ad1785c: refactor(layout)!: retire the `page-header` node type key; the header node is `page:header` (objectui#10859, batch 8 phase 2c)
  
  **BREAKING (authoring):** `registerLayout()` no longer registers `PageHeader` under `page-header` (and with it `layout:page-header`). `objectui validate` already refused a `page-header` node at `type`, and nothing in this repository authored or emitted it. objectstack's `page-header-subtitle-alias` conversion renames the key `description` → `subtitle` on both header spellings and leaves the type to objectui. A `page-header` node now renders the "Unknown component type" panel. `PageHeader` stays a named export for JSX composition.
  
  Migration, measured against `objectui validate` (`page:header` carries its props in `properties`):
  
  - `{ "type": "page-header", "title": T, "subtitle": S }` → `{ "type": "page:header", "properties": { "title": T, "subtitle": S } }`;
  - `actions` (action ids) → `properties.actions`, the same id array;
  - `icon` has no `page:header` spelling: the contract refuses `properties.icon` by name (an ADR-0087 D2 tombstone). Drop it, or compose `PageHeader` in JSX, which still takes `icon`;
  - `children` (the right-hand slot) has no `page:header` spelling: the contract refuses a node-level `children` by name, and `properties.children` as an unrecognized key. Put the buttons in `properties.actions` as action ids, or compose `PageHeader` in JSX, which still renders its `children`.
  
  `registerLayout()` now registers four keys: `layout:page:card`, `responsive-grid`, `navigation-renderer` and `app-schema-renderer`.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
  
  ⚠️ **Dated note, 2026-10-02 — `responsive-grid` and `navigation-renderer` are retired too — objectui#11441.**
  Later in this same release objectui#11441 (the maintainer's ruling, letters B / B) unregistered both, with their
  `layout:` twins, so `registerLayout()` registers two keys: `layout:page:card` and `app-schema-renderer`. The rest of
  this entry is kept as the reading of this change.
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
- 770cc5b: feat(layout): a navigation label written as an inline locale map renders in the viewer's locale; three inert resolver props retire (objectui#11299)
  
  **Breaking for a consumer that passes the retired props or calls `resolveNavItemLabel` with six arguments** — a compile error, never a silent change of what renders.
  
  - **New: `NavigationRenderer`'s optional `locale` prop**, and a trailing `locale`
    argument on `resolveNavItemLabel`. A present entry label written as an inline locale
    map (`{ en: 'Accounts', 'zh-CN': '客户' }`) renders the entry for that locale, through
    the spec's own `resolveI18nLabel`; when the map has no entry for it, that resolver's
    fallback order applies. objectui#11201 rendered such a map's `en` entry for every
    viewer; pass the viewer's language as `locale` to show theirs. Without `locale` the
    map still reads its `en` entry. A plain-string label and an absent label are
    unaffected.
  - **Retired: `NavigationRenderer`'s `resolveObjectLabel`, `resolveDashboardLabel` and
    `resolveViewLabel` props.** objectui#11201 stopped reading them and kept them as
    no-ops; they are removed now. Delete them from your `NavigationRenderer` call. An
    unlabelled entry's localized text comes from `resolveTargetLabel`, as before.
  - **Changed signature: `resolveNavItemLabel(item, t?, targetLabel?, locale?)`.** The
    2nd, 4th and 5th arguments (the same three resolvers) are gone. A call written
    `resolveNavItemLabel(item, undefined, t, undefined, undefined, targetLabel)` becomes
    `resolveNavItemLabel(item, t, targetLabel, locale)`.
  
  Marked `minor`, not `major`: this repository's fixed release group follows the
  `@objectstack` major, so a breaking change of its own is declared `minor` with the
  break spelled out here.
- 9d1c0bf: refactor(layout)!: retire the `navigation-renderer` and `responsive-grid` node type keys; navigation is application metadata, and the breakpoint grid is `grid` (objectui#11441)
  
  **BREAKING (authoring):** `registerLayout()` no longer registers `NavigationRenderer` under `navigation-renderer` or `ResponsiveGrid` under `responsive-grid` (and with them `layout:navigation-renderer` and `layout:responsive-grid`). This executes the maintainer's ruling on objectui#11441 (letters B / B) as one more batch of objectui#10859. `objectui validate` already refused both keys at `type`, and nothing in this repository or in objectstack authored or emitted either node. A node of either type now renders the "Unknown component type" panel. `registerLayout()` now registers two keys: `layout:page:card` and `app-schema-renderer`.
  
  `NavigationRenderer` and `ResponsiveGrid` stay named exports for JSX composition. `NavigationRenderer` is what the console's sidebar and `AppSchemaRenderer` mount. `ResponsiveGrid` had no in-repo consumer other than the retired registration, and it stays because the same ruling keeps objectui#7580's vocabulary half: `BreakpointColumnMap` stays declared in this package as the type of its `columns` prop.
  
  Migration, measured against `objectui validate` on both of its faces:
  
  - `{ "type": "responsive-grid", "columns": C, "gap": G }` → `{ "type": "grid", "columns": C, "gap": G }`. `grid` accepts the same breakpoint `columns` object (`xs` … `2xl`) and a `gap` number, and refuses an unknown breakpoint key as an unrecognized key (`unrecognized_keys` on `columns`). Unlike `responsive-grid`, which drew `not-a-container` and rendered no authored child list, `grid` draws its `children`;
  - `{ "type": "navigation-renderer", "items": I }` has no page-node replacement: navigation is application metadata. Put `I` in the app document's `navigation` (`{ "type": "app", "name": N, "navigation": I }` validates on both faces), and the shell draws it: the console's sidebar, or `AppSchemaRenderer` in JSX;
  - `basePath` has no app-document spelling: the strict face refuses it as an unrecognized key. It belongs to the shell, as `AppSchemaRenderer`'s `basePath` prop.
  
  **Clause-②: yes** — two registrations leave the runtime (narrowing), released as `minor` with this banner.
  
  ⚠️ **Dated note, 2026-10-02 — `grid` takes one of ten `gap` steps, not any number — objectui#11474.** At this change `grid` accepted any `gap` number; now it accepts one of 0, 1, 2, 3, 4, 5, 6, 8, 10 and 12, the steps the `grid` renderer maps, and `objectui validate` refuses any other `G` at `gap` on both faces with that set named: 7, 9, 11, a number above 12, a negative number or a fraction. For such a number `grid` drew no gap anyway, because the class it built at runtime is in no compiled stylesheet. So in the migration above `G` must be one of those ten steps; each step `ResponsiveGrid`'s own class map drew (0 to 6 and 8) is one of them. `.changeset/11474-layout-spacing-sets.md` states what ships. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — `grid` takes column counts 1 to 12, not any number — objectui#11491.** At this change `grid` accepted any count in the breakpoint `columns` object; now each count is one of 1 to 12, the counts the `grid` renderer maps, and `objectui validate` refuses any other count in `C` at `columns` on both faces with that set named. For such a count `grid` drew no column class at that breakpoint anyway. So in the migration above every count in `C` must be one of 1 to 12; each count `ResponsiveGrid`'s own class map drew (1, 2, 3, 4, 6 and 12) is one of them. `.changeset/11491-grid-columns-set.md` states what ships. The rest of this entry is kept as the reading of this change.
- fcdc8ec: An `app-schema-renderer` node draws the app document it carries under `schema` (objectui#11494, triage ruling A).
  
  **Breaking for a node that writes the app document's keys flat on itself** (shipped as `minor`, per this repository's version policy). `SchemaRenderer` hands every registered component the node itself as its `schema` prop, and `registerLayout()` registered `AppSchemaRenderer` directly, so the component took the node for its app document: a document nested under the node's `schema` key drew an empty shell, and only app keys written flat on the node (`navigation`, `title`, …), which no schema declares, drew. `registerLayout()` now registers the key against an adapter that hands `node.schema` to `AppSchemaRenderer`:
  
  - `{ "type": "app-schema-renderer", "schema": { "type": "app", "name": "crm", "navigation": [ … ] } }` draws the document's branding and navigation.
  - The same keys written flat on the node are no longer read. Move them under `schema`, with `"type": "app"`. No producer in objectui or objectstack authors them flat.
  - A node without `schema` draws the shell with no branding and no navigation, as it did before.
  
  Unchanged: `basePath` and `mobileNavMode` are read off the node, the registration's three declared `inputs`, and `AppSchemaRenderer` itself, whose JSX hosts pass `schema={appDocument}` directly. A node's `children` are still not rendered.
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
- e62c44e: Re-home the breakpoint layout vocabulary and delete the two dead responsive
  implementations (objectui#7580, maintainer ruling 2026-09-04, option A).
  
  **Breaking, deliberately, in one direction only.** `@objectstack/spec` retired its whole
  `ui/responsive` vocabulary in objectstack#11027 — `ResponsiveConfigSchema`,
  `BreakpointName`, `BreakpointColumnMapSchema` and `BreakpointOrderMapSchema` — on the
  stated ground that the four types "had no other authorable carrier". That ground is
  measurably false on the renderer side: `responsive-grid` is a REGISTERED SDUI component
  whose authorable `columns` input is typed by `BreakpointColumnMap` and applied by
  `resolveColumnClasses` on the render path, and `BreakpointName` types four live readers in
  `@object-ui/mobile`. The tombstone's own return condition — the vocabulary "returns if and
  when a renderer implements it" — is already met here, so the two types a renderer reads
  are re-homed rather than retired.
  
  What survives, under the same names and the same members:
  
  - `BreakpointName` (`xs`…`2xl`) is now declared in `@object-ui/types` (`mobile.ts`) instead
    of re-exported from the spec. **No consumer change**: same name, same six members, same
    export sites on `@object-ui/types` and `@object-ui/mobile`. Only its provenance moved.
  - `BreakpointColumnMap` is now declared in `@object-ui/layout` (`ResponsiveGrid.tsx`),
    verbatim from the retired `$strict` schema: six optional column counts, no index
    signature. `responsive-grid`'s `columns` input and its resolver are unchanged.
  
  What is removed:
  
  - `BreakpointOrderMap` (`@object-ui/layout`) — retired with the key, not re-homed. It had
    no read point in the package; it was published only because the retired
    `ResponsiveConfigSchema` paired it with the column map, so an author configuring `order`
    needed the type. With the schema gone there is no order vocabulary for it to be the type
    of, and re-declaring it would be the declare-without-enforce shape ADR-0049 removes.
  - `useResponsiveConfig` (`@object-ui/mobile`), with its `SpecResponsiveConfig` and
    `ResolvedResponsiveState` exports, and `ResponsiveProtocol` (`@object-ui/core`), with
    `resolveResponsiveConfig` / `getVisibilityClasses` / `getColumnClasses` /
    `getOrderClasses` / `shouldHideAtBreakpoint`. Both read the retired
    `ResponsiveConfigSchema` and both were measured at zero callers (objectui#4773).
  - `SpecResponsiveConfig` / `SpecBreakpointName` (`@object-ui/types`) — dead re-exports once
    the two implementations above went, dropped rather than re-declared locally, the same
    disposition the retired i18n names in that file already carry.
  
  No behaviour is retired. The live per-breakpoint readers — `useBreakpoint`,
  `ResponsiveContainer`, `BREAKPOINTS` / `BREAKPOINT_ORDER` / `getCurrentBreakpoint`, and
  `responsive-grid` itself — are untouched.
  
  **Sequencing.** objectui's next `@objectstack/spec` pin bump must carry `Blocked-by:`
  objectui#7580: the retirement is merged upstream and unreleased, so this must land first.
  
  ⚠️ **Dated note, 2026-10-02 — the `responsive-grid` registration is retired — objectui#11441.**
  Later in this same release the maintainer's ruling on objectui#11441 (letter B) unregistered `responsive-grid` (and
  `layout:responsive-grid`). That ruling updates item 2 of this change's ruling: the vocabulary half stands, so
  `BreakpointName` and `BreakpointColumnMap` stay declared here, and `ResponsiveGrid` stays a React export whose
  `columns` prop `BreakpointColumnMap` types. The authorable breakpoint grid is the `grid` node with a breakpoint
  `columns` object, which `BreakpointName` keys. The rest of this entry is kept as the reading of this change.
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
- a8198de: feat(types,layout,app-shell): a navigation entry with no `label` shows its target's current label, resolved at render time (objectui#9868)
  
  `@objectstack/spec` 17.5.0 made a navigation entry's `label` optional on every
  entry arm of its `NavigationItemSchema` (the separator still carries none), with
  a declared semantic (the cloud#2021 letter-A ruling): absent ⇒ the entry
  shows the CURRENT label of what it opens — the view's label when it names a
  labelled view, else the object's / dashboard's label; present ⇒ rendered
  verbatim. Nothing is stored for the absent case, so a renamed target shows its
  new name on the next render.
  
  - `@object-ui/types` (widening): `NavigationEntryItem.label` is optional, and
    `NavigationItemSchema` accepts a label-less entry of every type the spec does,
    filling nothing in at parse time. `id` is still required. An EMPTY label is
    still refused — `''` is a present label that would render empty text — and the
    message says to omit the key instead. `menuItemToNavigationItem` no longer
    turns a missing legacy label into `''`.
  - `@object-ui/layout` (additive public surface): `resolveNavItemLabel`
    resolves an absent label through a new `resolveTargetLabel` resolver
    (`NavigationRenderer` prop, types
    `NavLabelTarget` / `NavTargetLabelResolver`), walking view → object /
    dashboard, and falls back to the target's machine name (`viewName`,
    `objectName`, `dashboardName`, `pageName`, `reportName`, `url`,
    `componentRef`, the action name; a group shows its `id`). An authored label is
    never replaced by the target's label, including one spelled like the machine
    name. Action entries, the search filter and `AppSchemaRenderer`'s mobile tab
    bar read the label through the same function, so an unlabelled entry no longer
    throws there.
  - `@object-ui/app-shell`: the sidebar, the `nav:menu` block, the ⌘K command
    palette and the full-page search all name a nav entry through
    `resolveNavItemLabel` with one hook over the metadata cache the shell already
    holds (object schema, merged list views, dashboards) — no request per nav
    entry. Read raw, a label-less entry drew a blank palette row searched as
    `undefined`, and the search page listed it by its machine name.
    Navigation sync stops writing `label: pageName` / `label: dashboardName` for an
    unnamed page or dashboard; an author label is still written, and stored labels
    are kept.
- 5ea623e: fix(sdui-parser,components,layout,types): containment is the declared `children` slot, not `isContainer` (objectui#9910)
  
  `validateTree`'s `not-a-container` diagnostic now reads exactly one declaration:
  an input named `children` in the component's registration `inputs`. Ten
  registrations already carried such an input — `slot`-typed on `tooltip` and the
  four `page:*` containers, `array`-typed on the five page kinds — and the
  predicate reads the NAME, so both count. `isContainer` is no longer
  consulted and is not a fallback — new exports `acceptsChildren` and
  `CHILD_LIST_KEY` in `@object-ui/sdui-parser` spell the predicate, and the
  retired `body` dialect follows the same reading.
  
  Why: the flag was hand-kept and drifted from the renderers four times; after
  objectui#6771 converged a dozen `schema.body` readers onto `children`, and with
  objectui#6804 ruling the flag OFF for that population (it means layout
  containment, and declaring it deletes a public tag from every react page's JSX
  scope), the diagnostic landed FALSE on the one key `button`, `badge`, `alert`
  and the `sidebar-*` parts render. The maintainer ruled declare-and-pin
  (2026-09-24).
  
  What is declared: every renderer under `@object-ui/components` and
  `@object-ui/layout` that puts `schema.children` on the page — 65 registrations
  measured bare plus `sidebar` and `sidebar-menu-button` in their provider
  context — now declares the `children` slot; the 34 flow/inline HTML tags, the
  seven sectioning tags, the layout primitives, `button` / `badge` / `alert` /
  `toggle` (label and description fallbacks), `span` (read ahead of `value`),
  `div`, `form`, `scroll-area`, the ten `sidebar-*` parts and `page-header`. Nine public blocks
  gain the slot in `sdui.manifest.json`; a `slot` input emits no JSX attribute, so
  the generated `.d.ts` is unchanged. `isContainer` is kept everywhere it was
  declared and re-described on every published face (`ComponentMeta`,
  `RuntimeWidgetManifest`, `ComponentMetaSchema`, the manifest types) as LAYOUT
  containment — the react-page scope builder keeps reading it unchanged.
  
  The runtime containment census is re-pointed from the flag to the input in both
  directions (declared ⇔ actually renders, with named context probes for the
  provider-scoped and portal renderers), `scripts/container-declaration-baseline.json`
  is at zero, and a registration that is a layout container but renders no
  authored list (`page:tabs`, `page:accordion`, `responsive-grid`) now draws the
  TRUE `not-a-container` the flag used to silence.
  
  ⚠️ **Dated note, 2026-10-02 — `page-header` is retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2c) unregistered `@object-ui/layout`'s
  `page-header` (and `layout:page-header`), so its `children` slot declaration left with it; authors write
  `page:header`. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — `responsive-grid` is retired — objectui#11441.**
  Later in this same release objectui#11441 unregistered `@object-ui/layout`'s `responsive-grid` (and
  `layout:responsive-grid`), so it no longer draws `not-a-container`: a node written with it renders the "Unknown
  component type" panel. Authors write `grid` with a breakpoint `columns` object. The rest of this entry is kept as the
  reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — the ten `sidebar-*` parts are retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2d) unregistered the ten `sidebar-*` parts, so their
  `children` slot declarations left with them. `sidebar` keeps its declaration, and it now mounts its own provider
  when none is above it, so the containment census measures it bare and its provider-scoped context probe is
  gone, as is `sidebar-menu-button`'s. The rest of this entry is kept as the reading of this change.
- 73a3c89: Nav `visible`: an ancestor's predicate now reaches the whole subtree, and a group no longer outlives its children
  
  The card reported that an app navigation item's `visible` CEL predicate was served to the
  browser and then ignored, so the entry rendered for every user. That headline no longer
  reproduces: measured on today's `main`, a leaf and a group whose predicate is `false` for the
  session are both absent, and the same predicate evaluating `true` renders both — one run,
  two sessions, asserted as a difference rather than as an absence. `evaluateVisibility`
  routes the served `{ dialect, source }` envelope to the CEL engine, and `NavigationRenderer`
  applies it per item.
  
  Two paths into the same subtree did NOT apply it, and both are fixed here.
  
  - **A pinned descendant escaped its hidden ancestor.** The Favorites section collects pinned
    items by walking `children`, and that walk asked nothing about the node it was descending
    through. So an author could gate a group with `visible`, watch the group disappear from the
    tree, and still find a pinned entry from inside it rendered under Favorites — the predicate
    evaluated, answered `false`, and changed nothing the excluded user could see. `visible`,
    `requiredPermissions` and the `requiresObject` / `requiresService` capability gates all
    leaked the same way, because the collection applied none of them. It now stops at a
    gated-away node. A Favorites section whose every entry is gated away is no longer rendered
    as a heading over an empty list.
  
  - **A group whose children were all hidden rendered as an empty disclosure.** A labelled
    collapsible that opens onto nothing is a dead affordance, and it contradicted
    `hasVisibleNavigationItems` — the predicate the area switcher elects areas by, which already
    scores such a group as contributing nothing and documents that it "can never disagree with
    the rendered navigation". The renderer now asks that same predicate, so the sidebar and the
    area list agree about what a user can reach. A group authored with no children at all
    derives the same way, as it already did for area election.
  
  The per-item guard sequence was written out twice and omitted once; it is now a single
  `passesNavItemGuards` statement that `NavigationItemRenderer`, `hasVisibleNavigationItems`
  and the Favorites collection share, so the three cannot drift again.
  
  **Presentation, not authorization.** Hiding a nav entry is a UI affordance; the server still
  enforces object and record permissions on every route an entry would have led to, and no
  server-side check is touched. A user who types the URL directly gets the same answer as
  before.
  
  **Failure direction: fail-open, unchanged and now pinned.** A predicate that cannot be
  evaluated still renders the entry, which is this tier's shipped policy. Hiding on error would
  silently delete a user's navigation with no way to notice; showing on error leaves an entry
  the server still refuses, and the unresolvable-predicate diagnostic still names the source.

### Patch Changes

- cd7b728: `useAppShellBranding` now puts the previous favicon back when the shell unmounts
  (objectui#10040), the same way it already puts the previous tab title back
  (objectui#8637).
  
  The hook's effect makes two branded writes to the document: `document.title` and the
  `href` of the page's icon link. The title write was scoped to the mount; the favicon
  write was not, so a branded `favicon` stayed on the icon link after the shell went
  away unless something else happened to re-apply an icon. In the console that something was
  `FaviconSync`, which wrote the icon only when an operator favicon was configured (until
  objectui#10379 removed that write) — so on a deployment without one, the icon link kept
  a branded app's URL after the user left the app.
  
  When `branding.favicon` is set and the page has an icon link (`#favicon`, otherwise
  `link[rel="icon"]`), the hook now records that link and its `href` attribute before
  writing the branded URL, and restores the recorded attribute in the same cleanup that
  restores the title — so switching from one branded app to another and then leaving
  puts back the icon from before the first one. The attribute is captured rather than
  the `href` property, because the property resolves an empty `href=""` (the console's
  icon link before an operator favicon exists) to the page's own URL; an icon link that
  had no `href` attribute is left without one. A shell with no `favicon`, or a page with
  no icon link, is untouched in both directions, and the hook still never creates an
  icon link.
  
  As with the title, the restore replays the captured value unconditionally: an icon
  written by something else while the shell is mounted is overwritten when it unmounts.
- c58b8e4: `ResponsiveGrid`'s component docblock no longer attributes its column map to the
  spec's retired `BreakpointColumnMapSchema` (objectstack#11027 retired it; objectui#7580
  re-homed the six-key shape as this package's own `BreakpointColumnMap`). The docblock
  now names that local type. Text only: no member is added and no behaviour changes.
- f976774: An app's `branding.logo` now shows in the console, and it is the only logo spelling
  (objectui#10827).
  
  **The console renders it.** The designer (`AppCreationWizard`, `BrandingEditor`) writes an
  app's `branding.logo` and previews it, but nothing mounted in the console drew it. Its only
  reader was `AppSidebar`, which was never mounted and has since been removed. `UnifiedSidebar`,
  the console's sidebar, now reads the active app's `branding.logo` and shows it as an image in a
  header at the top of the sidebar. The image's alt text is the app's label. An app without a
  logo gets no header, so its sidebar looks the same as before. The header appears only inside
  an app. On Home the sidebar's fallback app is not the screen's app, so no logo is shown there.
  `AppShellBranding` is unchanged: objectui#4818 removed its `logo` key, and this change does not
  add it back.
  
  **One spelling — breaking for a top-level `logo`.** `@objectstack/spec` declares the app logo
  only as `branding.logo` (a URL). Its app schema refuses a top-level `logo` and suggests
  `branding`. objectui had a second spelling of its own: `AppComponentSchema.logo`, described as
  "Logo URL or icon name". This change retires it:
  
  - `@object-ui/types`: `AppComponentSchema.logo` is now `never` on the TypeScript face, and the
    zod mirror refuses a top-level `logo` by name, answering "Did you mean `logo` → `branding`?".
    It is a named refusal rather than a deletion because the node is `.passthrough()`, and a
    deleted key would be kept without any error. `wizardDraftToAppSchema` no longer copies the
    draft's logo to the top level. The logo goes into `branding` only.
  - `@object-ui/layout`: `AppSchemaRenderer`'s default sidebar header draws `branding.logo` as
    an image. This includes site-relative paths and `data:` URIs, which the old read skipped
    because it drew an image only for values starting with `http`. The header's icon now comes
    from the app's `icon`.
  - `@object-ui/runner`: `LayoutRenderer`'s sidebar brand mark does the same. It draws
    `branding.logo` as an image and takes an icon name from `icon`. It no longer guesses the kind
    of value from a `/` or `.`.
  
  Migration: move a top-level `logo` URL to `branding: { logo: '…' }`. An icon name that was
  written as `logo` belongs in `icon`. The published 17.6.0 changelog entry that removed
  `AppShellBranding.logo` says the top-level `logo` is "rendered directly by
  `AppSchemaRenderer`'s default sidebar header". That is no longer true: the header reads
  `branding.logo`.
- 25cb364: The Studio's app wizard saves an app the platform accepts, and the app favicon has one
  spelling, `branding.favicon` (objectui#10842).
  
  **Creating an app is no longer refused.** The console's "create app" and "edit app" pages save through
  `client.meta.saveItem('app', …)`, and the platform judges that document with
  `@objectstack/spec`'s strict `AppSchema`. `wizardDraftToAppSchema` wrote four top-level keys the
  spec does not declare (`type`, `title`, `favicon` and `layout`), so the save was refused with
  `422 INVALID_METADATA` (`unrecognized_keys`). It now writes only declared keys: the draft's
  title as `label`, the logo and favicon inside `branding`, and no `type` or `layout`. The spec
  has no app layout, so the wizard's layout choice is not saved.
  
  - `@object-ui/types` — **breaking:** `wizardDraftToAppSchema` now returns the app document
    (the spec's `App` shape, with objectui's `NavigationItem[]` as `navigation`) instead of an
    `AppComponentSchema` renderer node. It has no `type`, `title`, top-level `favicon` or `layout`.
    Code that read `result.title` reads `result.label`. Code that fed the result to
    `AppSchemaRenderer` builds the renderer node itself (`type: 'app'`, `title`).
  - `@object-ui/types` — **breaking:** `AppComponentSchema.favicon` is now `never` on the
    TypeScript face, and the zod mirror refuses a top-level `favicon` by name, answering "Did you
    mean `favicon` → `branding`?". This is the objectui#10827 rule that retired the top-level
    `logo`: the spec refuses the key, and the console reads only `branding.favicon`.
  - `@object-ui/layout`: `AppSchemaRenderer` puts `branding.favicon` on the tab. It read the
    top-level `favicon` before, and never `branding.favicon`.
  - `@object-ui/plugin-designer`: `EditAppPage` keeps the keys the wizard does not maintain, but
    only keys the spec's `AppSchema` declares, read from that schema. A row stored before the
    schema closed is served with the old wizard's top-level keys, and echoing them made every
    edit of such an app fail the same way. Its pre-fill no longer falls back onto a top-level
    `logo`, `favicon` or `title`; it reads `branding.logo`, `branding.favicon` and `label`.
  
  Migration: move a top-level `favicon` URL to `branding: { favicon: '…' }`.
  
  ⚠️ **Dated note, 2026-09-28 — the wizard has no layout choice — objectui#10867.**
  Later in this same release the wizard's Layout control was removed, with `AppWizardDraft.layout`, so there is no
  layout choice left to not save. The rest of this entry still holds.
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
- 1ccb5ba: fix(layout): a present navigation label renders as written, with no exception, and an inline locale-map label renders its text (objectui#11201)
  
  A navigation entry's text now follows one rule. A present label is shown as written. An absent label
  shows the current, localized label of what the entry opens.
  
  - **Visible change.** An entry whose stored label is its target's machine name (for example
    `account`, `sales_overview`) used to be translated, because the sidebar looked that text up as
    the object's, view's or dashboard's name. It now shows the name as written, in every locale.
    **To fix such an entry:** clear its label so it inherits the target's localized label, or set the
    text you want shown. Stored navigation is not converted, and no notice is sent.
  - An entry label written as an inline locale map (`{ en: 'Accounts', 'zh-CN': '客户' }`) used to
    render as empty text. It now renders the map's text. objectui#11201 did not tell the sidebar the
    viewer's locale, so it read the `en` entry, then `default`, then any entry; objectui#11299, in the
    same release, gives the sidebar the viewer's locale (`.changeset/11299-layout-nav-label-locale.md`).
  - `NavigationRenderer`'s `resolveObjectLabel`, `resolveDashboardLabel` and `resolveViewLabel` props,
    and the matching arguments of `resolveNavItemLabel`, are no longer read. objectui#11201 still
    accepted them, so no caller broke; objectui#11299, in the same release, removes them
    (`.changeset/11299-layout-nav-label-locale.md`). An unlabelled entry's localized text comes from
    `resolveTargetLabel`.
- c18a075: fix(layout): the mobile tab bar opens the same page as the sidebar (objectui#11211)
  
  With `mobileNavMode: 'bottom_nav'`, `AppSchemaRenderer`'s bottom tab bar used to
  build each tab's link itself, so some navigation entries opened a different page
  there than in the sidebar:
  
  - a record deep link (`recordId`) opened the object's list instead of the record;
  - an entry with `filters` opened the list without its filter;
  - an entry with `runAction` opened the list without running its action;
  - a `metadata:*` component entry opened the generic component route instead of
    the metadata page;
  - a `page` entry dropped its `params`, and `recordMode: 'edit'` was ignored.
  
  Every tab now links to exactly the page its sidebar row links to. Two related
  behaviours follow the sidebar too: the highlighted tab is the one whose sidebar
  row is highlighted (at most one tab lights, and a filtered or quick-action tab
  lights on its own page), and a `url` entry with `target: '_blank'` opens in a
  new browser tab.
- 5ad9f5d: fix(layout): the mobile tab bar draws only the entries its sidebar draws
  
  `AppSchemaRenderer` with `mobileNavMode: 'bottom_nav'` drew its tab bar from the
  navigation tree with no entry guard. An entry the author hid with `visible: false`,
  or gated with `requiredPermissions` the viewer lacks, was hidden in the sidebar and
  still drawn as a tab, and an `action` entry became a tab linking to the root. The
  five-tab cap was applied before any guard, so a hidden entry also took the place of
  one that should have shown.
  
  The bar now asks the sidebar's own guard about every node, through
  `hasVisibleNavigationItems` (the predicate the area list already uses, built on
  `passesNavItemGuards`), with the same evaluator, permission checker, capability
  checker and doc-target checker the sidebar gets. The guard runs before the cap, and a
  group the viewer may not see takes its entries with it, as in the sidebar. An
  `action` entry is drawn the sidebar's way, as a button that hands the whole item to
  `onAction`, and is left off the bar when no `onAction` is wired, which is when the
  sidebar hides it too.
  
  These are UI visibility gates, not data access: a route behind a wrongly drawn tab
  still answered with its own server-side checks.
- 7728c67: fix(layout): the mobile tab bar draws its tabs in the sidebar's order, and shows an entry's badge
  
  `AppSchemaRenderer` with `mobileNavMode: 'bottom_nav'` drew its tab bar in authored
  position and never read `order`. Two entries written `Zeta` (`order: 2`) then
  `Ypsilon` (`order: 1`) came out `Ypsilon, Zeta` in the sidebar and `Zeta, Ypsilon` on
  the bar. With more than five entries, the five-tab cap kept the first five by authored
  position rather than the five the sidebar lists first.
  
  The bar now sorts each level with the sidebar's own comparator before it flattens:
  first the top level, then each group's children. The guard and the five-tab cap run
  after the sort, so the five tabs are the first five entries the sidebar draws. The
  comparator lives in one internal module, and the sidebar's two sort sites use it too.
  It is not exported, so the package's public API does not change. An entry with no
  `order` still sorts as `0`, and entries with equal `order` keep their authored order,
  as in the sidebar before.
  
  The bar also dropped an entry's `badge` and `badgeVariant`. It now draws them on the
  tab with the same `Badge` component and the same variant the sidebar row uses.
- d9a0490: Correct the `AppShellBranding.title` doc comment. It read "Page title
  suffix (sets document.title)" while `useAppShellBranding` assigns `document.title = title`
  wholesale — nothing is appended; the caller composes the whole string (the console passes
  `"App label — Product name"`). That comment ships in `dist/index.d.ts` and is the only
  description a consumer sees on editor hover, so a reader who followed it passed a
  suffix-only fragment and got a truncated title with no error. The comment now carries the
  same wording as `content/docs/layout/app-shell.mdx`, and agrees with the `AppShellProps`
  tables in the package README and `content/docs/guide/layout.md`. No runtime behaviour
  changes; the wholesale assignment and the four-surface agreement are now pinned by tests.
- 63a8828: Record headers: give the title column a width floor so a wide action tail can no
  longer starve it.
  
  Two headers repeated the title/action width arbitration objectui#7244 fixed on
  `page:header`. Both were measured in Chromium at a 799px viewport with three
  labelled `record_header` actions, before and after:
  
  | header | before | after |
  | --- | --- | --- |
  | `DetailView` (`type: 'detail'`, the header that renders when the host supplies no `page:header`) | h1 6.17px of a 218px title | 218.39px, tail wrapped to its own line |
  | `PageHeader` (`@object-ui/layout`) | h1 170.59px of a 265px title | 751.00px, tail wrapped to its own line |
  
  `DetailView` gets the precedent's two utilities, both `sm:`-scoped so the
  sub-640px column layout is untouched: `sm:flex-wrap` on the row and
  `sm:min-w-64` on the title column. The floor is one step above the precedent's
  `sm:min-w-48` because this title column carries the 40px back button and a 12px
  gap inside it, so 256px is what leaves the h1 the same ~192px readable floor.
  
  `PageHeader`'s row already wrapped, so it needed only the floor — and that floor
  is unconditional rather than `sm:`-scoped, because this row has no
  breakpoint-scoped direction change and the squeeze measures worse just below
  `sm` (639px: h1 10.59px of a 212px title). `min-w-48` replaces `min-w-0` rather
  than joining it: an explicit min-width overrides a flex item's automatic
  min-content minimum exactly as `min-w-0` did, so long titles still ellipsise
  (measured at 799px: 751px rendered of a 1682px title, no horizontal overflow).
  
  Wide viewports are unchanged: at 1440px both headers keep the tail on the
  title's line with the title unclipped, before and after alike.
- c6198c2: **Breaking for authored metadata:** `ComponentInput.label`, `ComponentInput.defaultValue` and
  `ComponentInput.advanced` are RETIRED on both faces (objectui#7493 item ① and objectui#7781;
  maintainer ruling A of 2026-09-06, immediate, no deprecation window; ADR-0049 enforce-or-remove).
  They are the three keys the manifest serializer does not forward, and nothing read them on any
  publication or consumption path.
  
  No manifest ever published them, so no consumer could ever have read them. `sdui-parser`'s
  serializer (`packages/sdui-parser/src/index.ts`) forwards exactly seven keys per input — `name`,
  `type`, `of`, `required`, `enum`, `binding`, `description` — so a value authored under any of the three
  never reached `sdui.manifest.json`, the generated JSX `.d.ts`, or a diagnostic; its boundary type
  has no slot for them; the registry's data-source seam reads `name` only; and neither the designer
  nor the app-shell inspectors consult registry `inputs` at all. A structural census over every
  `inputs:` array in the repository (re-measured on this change's merge-base, `name` 951 and `type`
  951 as the controls) counted the writes: `label` 908, `defaultValue` 245, `advanced` 9 — written on
  nearly every registration, read by nothing.
  
  FROM → TO, per key — all three **TOMBSTONED, not removed**, because the route was measured on
  the built face before it was chosen: `ComponentInputSchema` is a non-strict `z.object`, and an
  undeclared key parses GREEN and is silently STRIPPED, so a deletion would have swallowed 1,162
  authored values in silence. The tombstone is what makes the refusal loud and by name.
  
  - `label?: string` → `label?: never` on the interface, `retirementTombstone()` on the Zod mirror.
    Migration: delete the key. An input is identified by its `name` on every path that reaches it;
    nothing ever rendered a label for it.
  - `defaultValue?: any` → `defaultValue?: never` / `retirementTombstone()`. Migration: delete the
    key. The renderer's own fallback read IS the default; tell the author about it in `description`,
    which IS published. (Tightening the type to `unknown` was ruled out: it closes no error class,
    since nothing reads the value.)
  - `advanced?: boolean` → `advanced?: never` / `retirementTombstone()`. Migration: delete the key.
    No designer surface ever hid an "advanced" input; there is nothing to write instead.
  
  The retirement kit: `?: never` on `ComponentInput` (`packages/types/src/base.ts`), so authoring one
  is a `tsc` error at the registration site; `retirementTombstone()` on `ComponentInputSchema`
  (`packages/types/src/zod/base.zod.ts`), so an authored value is REFUSED at parse time with
  `code: 'invalid_type'`, the key named in the issue `path`, and the migration note as the message
  (one string, both channels). Pinned in
  `packages/types/src/__tests__/component-input-retired-keys-7493.test.ts`, which also holds a
  tree-scoped absence census over every `inputs:` array under `packages/**` and `apps/**`.
  
  Accept-set change, stated plainly for reviewers: a document that sets any of the three keys on a
  `ComponentInput` used to parse GREEN (the value was then dropped by the serializer) and now parses
  RED. Every in-repo authoring site — 1,199 keys across 110 registration files, the three standalone
  `ComponentInput[]` arrays and the two named input arrays `tsc` found included — is deleted in the same change, as the ruling's split rule
  requires; the `WidgetRegistry` seam no longer copies the widget-manifest values onto the synthesized
  `ComponentInput` (they fed nothing), and the data-source declaration `ELEMENT_DATA_SOURCE_INPUT`
  drops its `label`. The patch entries on the other packages record exactly that: their registrations
  stop authoring inert keys, with no runtime or published-manifest change.
  
  The nine test files that read `defaultValue` off a registration were re-pinned against the
  renderer's ACTUAL default (its own fallback read, or the `defaultProps` it ships) instead of the
  declaration that went away; two assertions that only restated the shadow default were dropped with
  the reason on the line.
  
  The in-repo zero is what was measured. Whether anything OUTSIDE this repository writes these keys
  is not measurable from here (the objectui#5674 limit); converting such a write from a silent drop
  into a named refusal is exactly what the tombstones buy. `WidgetInput`'s own `label` /
  `defaultValue` / `advanced` (the widget-manifest face) stay declared and writable — nothing has
  ruled on that face; that it now has no reader either is recorded as objectui#7911.
- f4abff4: `@object-ui/layout` and `@object-ui/plugin-dashboard` no longer install a React of their
  own. `react` moves from `dependencies` to `devDependencies` at the same pin (`19.2.8`);
  `peerDependencies` is untouched, so both packages still ask their host for
  `^18.0.0 || ^19.0.0` (objectui#8303).
  
  Both manifests were making two contradictory statements at once: asking the host for React
  as a peer, and pinning an exact React 19 of their own. The peer range is the one a consumer
  reads; the pin is the one their installer acts on. A consumer on React 18 therefore
  satisfied the peer range and **still** got a second, pinned React 19 pulled into their
  graph on these two packages' account. Two React copies in one tree is the classic cause of
  `Invalid hook call`, and the failure is not at install time — it is at first render, in the
  consumer's own component, with nothing pointing back at these manifests.
  
  Re-measured on `origin/main` at `348725a7c` across all four `pnpm-workspace.yaml` globs
  (46 packages), rather than inherited from the card:
  
      declares a react peer AND pins react in dependencies    2   layout, plugin-dashboard
      declares a react-dom peer AND pins it in dependencies    0   (objectui#8198 took that half)
      pins react in dependencies with NO react peer            5   runner, site, 3 examples
  
  The last row is the control that keeps the fix narrow. Those five are applications that
  supply React rather than libraries that ask for it: one statement, not two, and correctly
  untouched. Against the 20+ sibling libraries the two packages fixed here were the only
  outliers, so this converges on the existing house shape — `app-shell`, `auth`,
  `collaboration`, `i18n`, `mobile` and `permissions` already carry `react` in
  `devDependencies` at exactly this pin.
  
  `scripts/__tests__/react-peer-range-norm-3741.test.ts` gains the invariant so a regression
  goes red rather than being re-found by a consumer. That file already owns React manifest
  norms across the fixed version group, already walks the workspace globs, and already
  governs `react` + `react-dom`, so this is a second assertion on an existing guard rather
  than a new one. It asserts the CONTRADICTION, not "React in `dependencies`" — widening it
  further would go red on the five applications above for doing the right thing.
  
  Two gates are green on this shape by construction and neither green was a reading of it.
  `check:unused-deps` asks whether a declared runtime dependency has a consumer, and `react`
  is imported by both packages — which is exactly why objectui#8198 could see and remove the
  `react-dom` half here and could not see this one. `check-changeset-presence.mjs` reads an
  eight-field allowlist that includes `peerDependencies` and deliberately excludes
  `dependencies`; its own docblock states the trade ("a runtime dependency bump can be just
  as user-visible as any of the eight, and this gate still does not see it"). This changeset
  is therefore owed by the house rule, not demanded by the gate.
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
- fe76ece: The typings both packages publish now carry an explicit extension on every relative specifier, so a consumer on `moduleResolution: nodenext` can follow them.
  
  `vite-plugin-dts` emits one declaration file per source file, and TypeScript
  copies a module specifier into the declaration verbatim. `export * from './ui'`
  therefore shipped extensionless in `dist/index.d.ts` — 21 such re-exports in
  `@object-ui/components`, 7 in `@object-ui/layout`, 128 across the two emitted
  trees. Node16/NodeNext resolution does not extension-search a relative
  specifier, so the compiler could follow none of the hops and every symbol they
  carried read as absent from the package:
  
  ```
  error TS2305: Module '"@object-ui/components"' has no exported member 'Badge'.
  ```
  
  Measured on `@object-ui/app-shell`, the largest consumer and the one that pulls
  in both packages: 880 TS2305 across 162 files (864 from `components`, 16 from
  `layout`), plus 215 TS7006 as fallout from the imports that stopped resolving.
  On `@object-ui/fields`, 178 TS2305 and 57 TS7006. Both are zero now.
  
  The emitted `.js` never had the defect — rolldown resolves the same specifier
  away — which is why `pnpm check:esm-specifiers`, whose verdict is about
  specifier-preserving `.js` builds, correctly never scanned either package. The
  fix is therefore in the declaration EMIT (`scripts/vite-dts-explicit-extensions.ts`,
  shared by both `vite.config.ts` files), not in the sources: the same source line
  produces a clean `.js` and a broken `.d.ts`, so no source edit can express the
  difference. The rewriter resolves each specifier against the source tree the
  output mirrors — a file hop becomes `./x.js`, a directory hop `./x/index.js` —
  throws on anything it cannot resolve, and after the build re-parses the emitted
  declarations to assert every relative specifier both carries an extension and
  names a file the build really emitted.
  
  `packages/fields` takes the `nodenext` pin as a result — the same two lines
  `packages/react` has carried since objectui#4538 — so the property is enforced by
  the compiler on the consumer side rather than by review. `packages/app-shell`
  does not: it type-checks clean without the pin and still shows 23 errors with it,
  none of them from these two packages. That residue is filed separately.
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
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [0aacecc]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [4ab4f1b]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [2b5f509]
- Updated dependencies [808f339]
- Updated dependencies [6cf5999]
- Updated dependencies [274e14a]
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
- Updated dependencies [cdefa2a]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [93a689d]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
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
- Updated dependencies [a60539b]
- Updated dependencies [de1b879]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [ad1785c]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
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
- Updated dependencies [deca847]
- Updated dependencies [328abeb]
- Updated dependencies [dd0d78f]
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
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [a4b017e]
- Updated dependencies [559a2e2]
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
- Updated dependencies [c021b35]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [0645133]
- Updated dependencies [76e9df0]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [6158e4c]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [858eafb]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [2e3da72]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [7fed09d]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
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
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [b654d4e]
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
- Updated dependencies [64dae8e]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [5ccc500]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [778138e]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d796c8d]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [ae476b8]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [90665e0]
- Updated dependencies [194fae1]
- Updated dependencies [7e19d03]
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
- Updated dependencies [6fd2cf7]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [8f1d995]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [d7de534]
- Updated dependencies [3c2b6f7]
- Updated dependencies [6e88630]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [30c73cd]
- Updated dependencies [830ed58]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [c71e14d]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [748494b]
- Updated dependencies [5967be0]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [12402a9]
- Updated dependencies [aff3d7a]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [b97790a]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
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
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [00d3f09]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [3cab570]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [351eb31]
- Updated dependencies [20c04b2]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [c15d7ec]
- Updated dependencies [5d0876c]
- Updated dependencies [f7ace0a]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [2ce2612]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [c14d3a0]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [dcbf0b2]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
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
- Updated dependencies [d1bebb0]
- Updated dependencies [95bf128]
- Updated dependencies [335abea]
- Updated dependencies [edea22a]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [4a292d2]
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
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
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
- Updated dependencies [c300267]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [1570eac]
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
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
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
- Updated dependencies [b9d47ec]
- Updated dependencies [3b6bc69]
- Updated dependencies [6214db6]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [7cbc724]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
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
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [dd19463]
- Updated dependencies [6791717]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [2c8474c]
- Updated dependencies [0e05aac]
- Updated dependencies [ae61ad4]
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
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [b655a9d]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [9d9040d]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [72ffc34]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [bf28341]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [42887e0]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [968dc1e]
- Updated dependencies [57f9b07]
- Updated dependencies [3c73d99]
- Updated dependencies [d91aed9]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [c86185e]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/components@17.7.0

## 17.6.0

### Minor Changes

- 88085e3: Consume the declared nav `runAction` slot; retire the private `?runAction=` string convention
  
  An `object` navigation item can now declare `runAction: '<actionName>'` and the shell will run that action once on arrival at the object's list surface, through the ordinary execute path — so param dialogs, confirms and entitlement gates all still apply. The slot is `@objectstack/spec`'s `ObjectNavItemSchema.runAction`; objectui now reads it instead of a private convention.
  
  - `NavigationItem` declares `runAction` (derived from the spec's object-nav variant), and objectui's own nav schema stops stripping it — `objectui validate` previously discarded the key, so an entry carrying a deep link validated clean with the deep link thrown away.
  - `resolveHref` encodes it onto the list href as the reserved `?runAction=` param, on the list landings only. A `recordId` entry resolves to a record page, which has no list toolbar to answer it, so the slot is not encoded there.
  - The deep link is honoured on **every** object list, not just the environments list. The action is armed only when it is actually present at `list_toolbar`; a name no action answers to runs nothing and deliberately leaves the URL untouched, so a later mount with fresher metadata can still honour it. Undefined references are rejected upstream at authoring time by `defineStack`.
  - The param name now has exactly one definition (`NAV_RUN_ACTION_PARAM`, exported from `@object-ui/layout`) and is registered in the console's reserved-param collision check. It was previously a bare literal hand-written at both the producing and consuming ends, declared by no schema and listed in no registry.
  - `CloudOnboardingNext` takes an optional `properties.createAction` (defaulting to `create_environment`) instead of hand-concatenating its deep link.
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
- 29167d5: **Breaking (shipped as `minor`, following the `page-header` `description` retirement):**
  `app-shell` is no longer a component key. `registerLayout()` registered `AppShell` under
  that key with no `inputs`; the registration is gone (objectui#4841, ADR-0049
  enforce-or-remove, remove side, maintainer ruling 2026-08-16).
  
  **What it could never do.** Four of `AppShellProps`' seven keys are `React.ReactNode`
  slots — `sidebar`, `navbar`, `children`, `rightRail` — and a JSON document can fill none
  of them, so `{ "type": "app-shell" }` resolved to a component that had exactly two
  outcomes, neither of them a shell. `children` was dropped in silence: `SchemaRenderer`
  strips `children` (and `body`) before spreading a node's keys as props, and `AppShell`
  reads its `children` prop, never `schema.children`, so the `<main>` element rendered
  empty with nothing logged. A schema written into `sidebar` / `navbar` / `rightRail`
  arrived as a plain object React refuses to render, replacing the node with an error box.
  Only `className`, `defaultOpen` and `branding` ever survived the JSON path, i.e. the best
  result JSON could reach was a shell with no navigation, no top bar and an empty content
  area. With no `inputs` declared, `sdui-parser` had no declaration face to compare a node
  against either, so neither outcome was diagnosed.
  
  **What changes for an author.** The middle state — parses, resolves, renders nothing — is
  replaced by a named refusal. `SchemaRenderer` now shows its `Unknown component type:
  app-shell` panel (`OBJUI-001`) and `sdui-parser` reports an `error`-severity
  `unknown-component` diagnostic before render.
  
  **FROM → TO.** There is no in-place rewrite, because the node never produced a shell.
  Schema authors who want the whole shell from metadata use `app-schema-renderer`
  (`AppSchemaRenderer`), which declares its `inputs` and builds branding and sidebar
  navigation from an `AppSchema` document: `{ "type": "app-shell", … }` →
  `{ "type": "app-schema-renderer", "schema": { … } }`. Everyone else composes in React —
  `AppShell` is **unchanged and still exported** from `@object-ui/layout`, and remains the
  way to build a shell and render JSON pages inside it.
  
  Repo-wide scan before removal found no `"type": "app-shell"` node anywhere in
  `objectstack-ai/objectui` or `objectstack-ai/objectstack` at `origin/main` — no example,
  catalog schema, fixture or template authored one. `content/docs/guide/layout.md` is
  updated to state the new fact, and
  `packages/layout/src/__tests__/app-shell-not-a-component-key.test.tsx` pins it on both
  faces (source and live registry) plus the rendered diagnostic.
- 45f7dcc: **Breaking (shipped as `minor`, following the `app-shell` component-key deregistration):**
  `app-schema-renderer`'s `mobileNavMode` is now declared as the vocabulary the renderer
  implements — `enum: ['drawer', 'bottom_nav']` — instead of free-text `string`, and the
  third member of `MobileNavMode` is retired (objectui#3985, ADR-0049 enforce-or-remove,
  maintainer ruling 2026-08-10).
  
  **What used to happen.** The registration declared `{ name: 'mobileNavMode', type:
  'string' }`, so `sdui-parser`'s `checkType` asked only whether the value was a string.
  `mobileNavMode="bottom-nav"` — the hyphenated spelling of the underscored value, and the
  likeliest typo on this key — passed the manifest gate, passed the parser, reached the
  renderer, missed its one equality test, and rendered the drawer. Nothing reported
  anything, at any layer. The declaration was WIDER than the implementation, which is why
  the `invalid-enum` that should have fired never could.
  
  **What happens now.** A value outside the vocabulary is an **error**-level `invalid-enum`
  from `validateTree` / `compile`, so a schema-driven author — very often an AI author — is
  stopped at the typo instead of debugging a mode that silently did nothing. The generated
  `sdui-intrinsics.d.ts` narrows from `mobileNavMode?: string` to the two-value union for
  the same reason.
  
  **Retirement.** `MobileNavMode` had a third member documented as "collapsed sidebar" with
  **zero read points** in `AppSchemaRenderer`: the only two reads are the `drawer` default
  and the `=== 'bottom_nav'` comparison that gates the bottom bar, so the value was
  behaviourally identical to the default while the union, the JSDoc and `ROADMAP.md`
  presented it as a capability. It is gone from the union and from the published
  vocabulary. Making it real behaviour is an implementation card first — the value comes
  back together with a renderer read point, never as a declaration on its own.
  
  **Migration.** Both implemented modes are unchanged; no runtime behaviour moves. A
  TypeScript caller passing the retired literal now fails to compile (it previously
  compiled and rendered the drawer), and a JSON/JSX author writing it — or any other
  out-of-vocabulary value — now gets a validation error where they previously got silence.
  In both cases the value that reproduces the old behaviour exactly is `drawer`.
- f923b7c: **Breaking (shipped as `minor`, see below):** `@object-ui/layout`'s `<PageHeader>` retires the legacy `description` prop. `subtitle` is now the only spelling for the secondary line.
  
  `PageHeader` read `subtitle ?? description`. The alias was not tolerance for a sloppy author — it was the only thing standing between an externally authored `description` and a page that renders its title and silently drops its second line, which is why objectui#3226 refused to delete it: "no in-repo author writes `description`" (true, verified) says nothing about the stored metadata of out-of-repo consumers.
  
  **FROM → TO.** JSX call sites: `<PageHeader title="X" description="Y" />` → `<PageHeader title="X" subtitle="Y" />`. Schema authors: `{ "type": "page-header", "description": "Y" }` → `{ "type": "page-header", "subtitle": "Y" }`. Stored stack metadata needs no hand edit — `os migrate meta` rewrites it, and a protocol 17 loader rewrites it on the way in.
  
  **Why the read could go now.** The normalization moved upstream, where a contract belongs: protocol 17's ADR-0087 D2 conversion `page-header-subtitle-alias` rewrites a header node's `properties.description` to `properties.subtitle` as the stack loads. The gate on this side was a measurement, not a date — every position a `page-header` node can occupy had to be shown to pass through that rewrite. It did not, at first: measured 2026-08-08 against `@objectstack/spec@17.0.0-rc.5`, the conversion walk reached `pages[].regions[].components[]` and stopped, leaving seven spec-valid header positions unconverted — including `slots.header` on a `kind: 'slotted'` record page, the shape this repo's own slotted-pages guide prescribes (objectstack#6775). With the walk widened by objectstack#6776 (slots) and objectstack PR #7034 (containers nested to any depth: `properties.children`, `items[].children`, `body`, `footer`), all seven convert. Re-measured against `@objectstack/spec@17.0.0-rc.6`, which this package depends on, before the read was deleted.
  
  The measurement is now a standing pin rather than a one-off: `packages/layout/src/__tests__/page-header-subtitle-conversion-coverage.test.ts` re-runs all seven positions against the resolved spec build on every test run. If a future spec narrows that reach — or a dependency is pinned back below `17.0.0-rc.6` — it fails there, at the seam, instead of turning into a second line that quietly stops rendering in a consumer's app. The two tests in `page-header-authorable-keys.test.tsx` that pinned the fallback's continued existence were deleted in this same change, as their own SEQUENCING note instructed, and replaced with the opposite assertion: a lone `description` now renders no secondary line.
  
  **Not affected, despite the shared word:** the `page` renderer's own `description` prop (the page's prose under the page title) is a live declared key of a different node, untouched here. `@object-ui/app-shell`'s separate `<PageHeader>` uses `description` as its only secondary-line prop and is likewise unchanged.
  
  `minor` rather than `major` is deliberate and follows the repo's retirement precedent (PR #3793): all 39 publishable packages sit in one `fixed` group, so a `major` here would carry the whole family to 18.0.0 against an `@objectstack` still on 17 and break the "same major ⇒ compatible" pin between the two repos (AGENTS.md §版本号策略, enforced by `scripts/check-changeset-no-major.mjs`). objectui's own breaking changes ship as `minor` with the break spelled out in the body — which is what the FROM → TO above is.
- 9c60144: **Breaking (published API):** `NavigationRenderer` no longer accepts `resolveGroupLabel` or `resolveItemLabel`. If your build just broke on one of these props, delete the prop — it never did anything.
  
  Both were id-keyed label resolvers on `NavigationRendererProps` (`@object-ui/layout`), typically wired to `useObjectLabel().navGroupLabel` from `@object-ui/i18n` to translate sidebar group and leaf labels from a client translation pack keyed `{ns}.apps.{appName}.navigation.{nodeId}.label`.
  
  **They could never fire.** The renderer guards convention-based resolution with `isCustomized` — a case-insensitive "the authored label differs from this branch's comparison target" test. On the `object` / `dashboard` branches the target is the object or dashboard name, and the test is meaningful: it protects an author's custom label (`Projects`) from being overwritten by an `objects.project.label` translation. On the two id-keyed branches the target was the nav node's own **`id`** — `grp_workspace`, `group_sales` — while the label was its text — `Workspace`, `Sales`. Those never compare equal, so the guard was true for every real navigation entry and the resolver beneath it was unreachable. The only node that could have reached it is one whose label is literally its own id.
  
  Nothing regresses when they go, because nothing was using them to begin with: **app-navigation localization is owned solely by the server-side `/meta` boundary.** `translateApp` (`@objectstack/spec`, `src/system/i18n-resolver.ts`) rewrites every navigation node's `label` by id, and `@objectstack/rest` applies it before the metadata reaches the client — so nav labels arrive already localized and the client-side path was never the one answering. One owner, not two.
  
  **If you wired these hooks to localize navigation, your labels were never being localized by them.** Move the translation to the server side: add it to the app's i18n bundle that `translateApp` reads, keyed by navigation node id. A client-side pack keyed `apps.*.navigation.*.label` changes nothing in the sidebar.
  
  Also in this change:
  
  - `useObjectLabel().navGroupLabel` (`@object-ui/i18n`) is **kept**, but its docstring no longer promises `"Sales" → "销售"` for sidebar groups — that promise was false, and a live docstring describing an unreachable path is how an agent or a developer ends up wiring a translation pack and receiving silent non-localization. It is now documented for what it is: a plain reader for `{ns}.apps.{appName}.navigation.{groupId}.label` with no first-party caller, pointing at the server boundary for anything nav-related.
  - `UnifiedSidebar` (`@object-ui/app-shell`) drops the two prop wirings, including a `studio` carve-out that existed only to stop `resolveItemLabel` from re-translating an already-translated "Package management" label.
  - The `object` / `dashboard` / `viewName` branches — `resolveObjectLabel`, `resolveDashboardLabel`, `resolveViewLabel` — are untouched and keep both their resolvers and the `isCustomized` guard.

### Patch Changes

- d442795: AppShell: drop the unused `Sidebar` import. `AppShell` renders the node the caller passes
  in the `sidebar` prop and never constructs a `Sidebar` itself, so the import was dead
  (tree-shaken out of every bundle) and only suggested otherwise to readers. No runtime
  behaviour changes.
- 8a9dece: `SidebarNav`'s README example teaches the shape the component actually reads.
  
  `packages/layout/README.md` — the package's npm landing page, shipped in `files` —
  spelled every nav item `{ label, path, icon: 'home' }`. `NavItem` declares none of
  those three keys: the label is `title`, the target is `href`, and `icon` is a
  `React.ComponentType` rendered as `<item.icon />`, not an icon name. Copied
  verbatim the example produced a sidebar whose every row was unlabelled
  (`<span>{item.title}</span>` reading `undefined`), a `NavLink` with
  `to={undefined}`, and the string `'home'` handed to React as an unknown lowercase
  tag. Both README examples now use `title` / `href` / imported Lucide components,
  and annotate the array as `NavItem[]` so the same class of typo becomes a compile
  error where it is written instead of a blank sidebar at runtime.
  
  Adds the props tables the README never carried — `SidebarNavProps`, `NavItem`
  (`badge`, `badgeVariant` and `children` included) and `NavGroup`, plus a grouped
  and nested example — and pins all of it rather than leaving a second surface free
  to rot the same way: the examples are real, type-checked code in
  `readme-sidebar-nav-example.test.ts` asserted to appear verbatim in the README, and
  the tables are compared against the interface keys read out of `SidebarNav.tsx` on
  every run. Also corrects a comment in `side-effects-manifest.test.ts` that named
  `SidebarNav` as the component behind the `navigation-renderer` registration; that
  key belongs to a different component, and `SidebarNav` is registered under no key
  at all.
  
  No runtime change — `SidebarNav.tsx` is untouched. This is `patch` rather than a
  no-release declaration because the corrected landing page only reaches npm through
  a publish.
- 183d09b: Studio 页面设计器不再为 canonical `page:header` 提供 `icon` 编辑框(objectui#3829)
  
  `PageHeaderProps.icon` 已在 `@objectstack/spec` 17.0.0 随 ADR-0087 D2 退役
  (objectstack#6946 / PR objectstack#7115):canonical `page:header` 渲染器从未读过它,
  表头的身份由 record chrome(`recordChrome`)与每个 action 自带的 `icon` 承担。退役前
  作者填入的值被静默丢弃,退役后平台按名拒绝整个节点 —— 而设计器仍在提供那个输入框,
  等于教作者写出解析失败的元数据。本次移除该字段与它此时已成孤儿的两条 i18n 键
  (en / zh 同一次改动,两张表的键集保持一致),并把「不得回潮」钉在
  `previews/__tests__/block-config.test.ts`。
  
  `@object-ui/layout` 的 `page-header` / `layout:page-header` 别名**保留** `icon` 输入,
  行为不变:那是另一个渲染器,它真读真画(`PageHeader.tsx`),文档与本仓唯一的活 demo
  都写它。变的只是这条声明的**依据** —— 从 spec parity 改述为 renderer-read 事实,并让
  `page-header-authorable-keys` 守卫在派生 spec 键集时跳过墓碑成员,不再因为
  `Object.keys(shape)` 仍列着已退役的 `icon` 而假绿。
- Updated dependencies [88085e3]
- Updated dependencies [516663d]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [2533ec5]
- Updated dependencies [78c0f9a]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [e1d4251]
- Updated dependencies [40d3a33]
- Updated dependencies [8b9dc62]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [a1609a6]
- Updated dependencies [53f23bc]
- Updated dependencies [c4533dc]
- Updated dependencies [be60815]
- Updated dependencies [37f6844]
- Updated dependencies [93de4f6]
- Updated dependencies [2b50261]
- Updated dependencies [384f30d]
- Updated dependencies [ac600e5]
- Updated dependencies [97fba31]
- Updated dependencies [232f61a]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [c1ef923]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [8c0d52e]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [7458a41]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Minor Changes

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

- bb68488: An inline per-locale label now renders its locale's string at the thirteen read sites the `@objectstack/spec` 17.0.0-rc.6 bump exposed

  rc.6 widened `I18nLabel` from `string` to `string | Record<string, string>`, so an author may write `label: { en: 'Owner', 'zh-CN': '负责人' }` anywhere the spec accepts a display label. PR #4169 repaired eight such sites; these thirteen were invisible to it because the five packages involved build through vite/rolldown, so `turbo run build` never type-checks their sources — only `turbo run type-check` does. All thirteen are now resolved through a shared resolver against a real locale, and `turbo run type-check` is 78/78 with zero errors.

  | package                       | what an author can now write and see                                                    |
  | ----------------------------- | --------------------------------------------------------------------------------------- |
  | `@object-ui/layout`           | `NavigationArea.label` — the sidebar area switcher's button and its tooltip             |
  | `@object-ui/plugin-list`      | `ViewTab.label` — the inline pill row, and the mobile dropdown's trigger and menu items |
  | `@object-ui/plugin-dashboard` | `DashboardWidget.title` — the widget card heading and its `title` attribute             |
  | `@object-ui/plugin-designer`  | `DashboardWidget.title` — the widget card and the preview tile                          |
  | `@object-ui/app-shell`        | `ActionParam.label` **and** each `ActionParam.options[].label`                          |

  **Patch, not minor, in every case: no public surface changes meaning.** Every entry above is a read site that previously could only be reached with a value the type system rejected, so no caller's working code changes behaviour. `@object-ui/app-shell` is the only package with an exported-type change and it is purely additive on the authoring side — `RawActionParam.label` and `RawActionParam.options[].label` widen to `I18nLabel` (they accept strictly more), `ResolveActionParamsContext` gains an optional `locale`, and the new `RawActionParamOption` names the authoring shape that was previously spelled with the resolved one. What `resolveActionParams` **emits** is unchanged: `ActionParamDef.label` and its options' labels are still plain `string`s.

  Two consequences worth knowing:

  - **The dashboard designer's title input is deliberately read-only for a map-valued title.** Resolving a per-locale map into a single-line input and writing `e.target.value` back would collapse every other locale on the first keystroke, so the write is guarded and an inline map survives an unrelated edit-and-save round trip untouched — the same conservative branch #4169 took for `DashboardWidgetInspector`. What Studio should actually offer for authoring a per-locale label is objectui#4163 part 2, which is unclaimed and pending design.
  - **`@object-ui/layout` resolves at the spec's `en` default, not the viewer's language.** That package carries no i18n dependency by design (its whole i18n story is injection), and `AppSchemaRendererProps` exposes no locale to thread. The choice and what would change it are documented at the call site.

- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [cb13400]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [3e19fe7]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [3f5f87c]
- Updated dependencies [f5e1143]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [9461dd3]
- Updated dependencies [47f551b]
- Updated dependencies [ab04728]
- Updated dependencies [5bf09fd]
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Patch Changes

- 6bd6a4d: `registerLayout()` 的 `inputs` 声明面与渲染器实现对齐 —— 校验器不再对正确写法报假诊断

  `inputs` 是**作者面**:`sdui-parser/src/validate.ts` 拿一个节点的顶层属性逐个比对
  `comp.inputs`,不在其中的报 `unknown-prop`,类型不符的报 `type-mismatch`;设计器面板、
  `sdui.manifest.json`、生成的 JSX 类型也都由它派生。所以声明面写错的代价不是"文档不全",
  而是**校验器对着能正常渲染的 schema 说谎**(objectui#3972,与 objectui#3900 同族、换到属性面)。

  两处修正,都是按渲染器**实际读点**审计出来的:

  - **`page-header` 补声明 `icon` 与 `actions`。** 两个键三面齐全:渲染器真读
    (`PageHeader.tsx:117` 取参 `:224-226` 渲染 icon;`:119` 取参 `:192-196` 把 actions
    委派给 `record:quick_actions`)、`@objectstack/spec/ui` 的 `PageHeaderProps` 声明、
    `ManifestInputType` 表达得了(`string` / `array`)。`content/docs/layout/page-header.mdx`
    的 Component Props 段落也把两者写成公开契约,而该文档页**唯一**的 live demo
    (`layout-page-header/pageheader-with-actions`)就写着 `"icon": "users"` —— 于是仓内
    自己的文档示例每次过 manifest 门都收到一条 `unknown-prop: page-header has no prop "icon"`。
    `actions` 的类型与 canonical 的 `page:header` 逐字一致(`type: 'array'`),一个概念一个键
    一种类型。
  - **`navigation-renderer` 的 `items` 由 `type: 'object'` 改为 `'array'`。**
    `NavigationRendererProps.items` 是 `NavigationItem[]`(`NavigationRenderer.tsx:108`),
    而 `checkType` 对 `'object'` 判 `typeof value === 'object' && !Array.isArray(value)`、
    对 `'array'` 判 `Array.isArray`(`validate.ts:124-129`)—— 两者互斥。所以旧声明对这个
    渲染器**唯一能渲染的形状**报 `type-mismatch ... expected an object`,而对真会让它崩的
    对象形状一言不发。这不是 objectui#3832 的表达力问题:`ManifestInputType` 本来就有
    `'array'`,只是声明写错了一个表达得了的类型。

  **刻意不声明**的键同样被钉住,因为"照抄 spec 的 shape"是这条修复最容易滑进去的反向缺陷:
  `breadcrumb`(spec 有、这个渲染器零读点 —— 声明它就是 objectui#3829 的缺陷方向)、
  `showBack` / `action` / `description`(渲染器读、spec 无此键 —— 声明任一个就是在开第二套
  方言,正是 objectui#3226 收窄要防的事)、`aria`(每个 block 都因同一理由省略的可访问性逃逸口)。

  渲染输出逐字节不变:渲染路径从不读 `inputs`。变化只在校验/设计器/清单这一侧,且两个方向
  都钉了 —— 正确写法放行的同时,`description` 这类刻意不声明的键仍报 `unknown-prop`、
  `items` 写成对象仍报 `type-mismatch`(诊断没有被弄哑)。

- 876e3f7: `@object-ui/layout` no longer tells bundlers it has no side effects while registering components at load time (objectui#3899)

  The published manifest declared `"sideEffects": false` — a promise that no module
  in the package does anything on evaluation, so any module whose exports go unused
  may be dropped whole. But `src/index.ts` ends with a bare
  `try { registerLayout(); } catch {}`, and that call is the only thing that puts
  `page-header`, `page:card`, `app-shell`, `responsive-grid`,
  `navigation-renderer` and `app-schema-renderer` into the `ComponentRegistry`.

  Both statements cannot be true, and a bundler that believes the manifest is
  right to delete the registration. Measured with the repo's own bundler by
  building `import '@object-ui/layout';` — the side-effect-only import, i.e. the
  documented "import it to register" pattern:

  - `sideEffects: false` — the bundle is **0 bytes**. Zero registrations, exit
    code 0, no warning.
  - after this change — the bundle keeps all six `ComponentRegistry.register`
    calls.

  A dropped registration does not fail where it happened. It surfaces later as a
  red `Unknown component type` panel (OBJUI-001) on a fully green build, with
  nothing in the build log to connect the two. Nobody had been bitten yet only
  because every consumer today ALSO imports a named export, which forces the module
  to be evaluated regardless — coincidence, not design. objectui#3787 met the
  hazard and routed around it by calling `registerLayout()` explicitly.

  `sideEffects` is now the narrowest honest answer: an array naming the modules
  that actually register, rather than `true`, which would be honest but would hand
  the whole package to every bundler as unshakeable.

  ```json
  "sideEffects": ["./dist/index.js", "./dist/index.umd.cjs", "./src/index.ts"]
  ```

  All three are load-bearing, and the set is derived from the manifest rather than
  guessed:

  - `./dist/index.js` and `./dist/index.umd.cjs` are every JS file the manifest's
    own entry fields point at (`module` / `main` / `exports` import+require). The
    library build inlines everything into those two files, so there is no third
    chunk to name.
  - `./src/index.ts` is not published (`files` ships `dist` only) but is bundled
    for real: `apps/console` and `examples/console-starter` both alias the
    specifier straight at `packages/layout/src`, and a bundler reads this same
    manifest for those files. With only the published paths declared, the console's
    alias shape still produced a 0-byte bundle.

  What deliberately did NOT change: the load-time `registerLayout()` itself.
  Replacing it with an explicit registration API is the opposite direction — it
  eliminates the side effect instead of declaring it, and it is breaking for any
  consumer relying on automatic registration. objectui#3899 leaves that call to the
  maintainer, and the two steps do not conflict: once the manifest tells the truth,
  the migration to explicit registration can happen whenever it is wanted.

  A new pin (`packages/layout/src/__tests__/side-effects-manifest.test.ts`) runs a
  real bundler build per entry form and asserts the registrations survive a
  side-effect-only import, with a `sideEffects: false` control per form asserting
  they are dropped — so the pin cannot pass because the bundler stopped shaking
  anything. The required set is derived from the manifest's own entry fields, so a
  renamed build output or a new `exports` subpath fails as a missing declaration
  instead of drifting silently.

- f3b2874: `navigation-renderer` 的 `items` 声明为 `required: true` —— 校验器不再放过必崩的节点

  `items` 在组件侧是**非可选**的 `NavigationItem[]`(`NavigationRendererProps.items`,无 `?`),
  渲染器也不给默认值,而注册声明一直没写 `required`。`sdui-parser` 只在 `input.required` 为真时
  报 `missing-required-prop`(`validate.ts:55-64`),于是 `{ "type": "navigation-renderer" }`
  这个节点**校验零诊断、渲染直接抛**:第一处无守卫的读点是 `pinnedItems` memo 里的
  `collectPinnedItems(filteredItems)`(`NavigationRenderer.tsx:1242` → `:1410` 的
  `for (const item of items)`),实测 `TypeError: items is not iterable`。
  (`resolveActiveNavItem` memo 挡得住 —— 它的 `visit` 首行是 `if (!nodes) return`;
  `:1247` 的 `filteredItems.slice()` 同样会抛,但根本走不到。)

  这是 objectui#3972(键的**存在**与**类型**三面对齐)的第四面:**可选性**。#3972 与
  objectui#3900 都是删除假诊断,这一条相反——它是**收紧**。

  **blast radius:** 今天省略 `items` 写 `navigation-renderer` 的 schema,会新增一条
  **error** 级 `missing-required-prop`。受影响面是仓外按 `inputs` / `packages/layout/README.md`
  做 schema 驱动的消费者(仓内没有任何 JSON 元数据把它当 schema 节点写,React 调用侧的必填由
  TS 兜住;`examples/schema-catalog` 的 `not-a-container` 对照节点补了 `items: []`,使它只剩
  那一处故意植入的缺陷)。而这条诊断新拦下的形状,**恰好等于渲染必然崩溃的形状** —— 让作者
  (尤其是 AI 作者)在发布期就听到运行期注定要发生的失败,正是 `missing-required-prop` 存在
  的理由。若某个消费者确实想要"缺 items 就渲染空导航",那是给组件加 `= []` 默认值的另一条路
  (objectui#3987 里记了,与本改动不互斥),而不是让校验器继续沉默。

  `basePath` **保持可选**并被钉成对照:渲染器真的给了它默认值(`basePath = ''`)。`required`
  是逐个属性从组件读出的事实,不是一刀切——否则这道门会开始拒绝完全能渲染的 schema,作者就会
  学着无视 `missing-required-prop`,正如 #3972 里他们被教着无视 `type-mismatch`。

- 82f8dff: `page-header` 注册补 `isContainer: true` —— 校验器不再对文档承诺的 children 写法报 `not-a-container`

  `PageHeader` 一直**有意**把 `schema.children` 渲染进右侧动作槽(`PageHeader.tsx:182`,
  `record:quick_actions` 嵌在 `page:header.children` 下就是靠它),
  `content/docs/layout/page-header.mdx` 把该槽的优先级(`action` → React `children` →
  `actions` → schema children)写成公开契约,该文档页唯一的 live demo
  (`layout-page-header/pageheader-with-actions`)正是这个形状且实测正常渲染。但
  `packages/layout/src/index.ts` 的注册漏了 `isContainer: true`。

  漏这个 flag 从来没有挡住任何渲染 —— 渲染路径根本不读它(`SchemaRenderer` 把
  `children` 从 React props 里剥掉当元数据,而始终把整个节点作为 `schema` 传下去,
  `PageHeader` 自己再把 `schema.children` 放回槽里)。它的消费者在别处:`sdui-parser`
  的 `not-a-container` 诊断、Studio 调色板元数据、react-page 标签表。所以真正的后果是
  **校验器在说谎**:作者照文档写出能正常渲染的 schema,却拿到一条
  "`page-header` does not accept children" 的 warning;信了这条 warning 去掉 children,
  右槽就空掉。而会说谎的 warning 比缺一条 warning 更贵 —— 它训练作者(尤其 AI 作者)
  连真实的 `not-a-container`(那些确实不收子节点的组件)一起无视。

  这不是在 spec 之外新开作者面:`children` 是 objectui JSON 协议里**每个节点**的基础属性
  (`sdui-parser/src/validate.ts` 的 `BASE_PROPS` 把它和 `type`/`id`/`className` 并列),
  不是 `PageHeaderProps` 的键。所以这个 flag 回答的是协议层面的"该节点是否接受子节点列表",
  而对这个组件,答案一直是"是"。维护者 2026-08-09 就 objectui#3900 的 A/B 分叉裁定 A 案,
  理由同上。

  行为面变化极窄:注册元数据一个布尔位。渲染输出逐字节不变(渲染路径不读该 flag);
  `sdui-parser` 对带 children 的 `page-header` 少报一条 warning;设计器把它当容器对待
  (即它本来的样子)。canonical 的 `page:header`(`@object-ui/components`)不在此列且刻意不动
  —— 那个渲染器完全不读 `schema.children`,所以它没有 `isContainer` 是正确的。

  两个方向都已钉住:文档 demo 走应用真实构建的 manifest 后不再产生 `not-a-container`,
  而一个真正不收子节点的组件(`navigation-renderer`)带 children 时诊断照旧触发 ——
  后者是前者的对照,保证这条修复不是把诊断弄哑了。

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [7ed3360]
- Updated dependencies [0fa5e4d]
- Updated dependencies [5bfaabd]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [e24d767]
- Updated dependencies [aca561a]
- Updated dependencies [48132f7]
- Updated dependencies [0ef9dfd]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [97b63d7]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Minor Changes

- 608669e: `AppSchemaRenderer` now derives area visibility from the items inside the
  area, closing the visible-but-empty regression the spec 17.0.0 area-key
  retirement left behind (objectui#3311, option C of the recorded ruling).

  Spec 17.0.0 retired the authorable area-level `visible` /
  `requiredPermissions` (`AREA_VISIBLE_RETIRED` /
  `AREA_REQUIRED_PERMISSIONS_RETIRED`) — an area is a layout grouping, not an
  access boundary — and objectui followed in #3315 by deleting the area
  switcher's filter. Correct on the contract, but it changed the navigation
  surface: an area whose items are **all** gated away used to disappear from
  the switcher and instead rendered as a selectable, empty area.

  ## What changed

  - **Area visibility is now derived, not authored.** An area appears in the
    switcher iff at least one of its navigation items survives the exact
    item-level guards `NavigationRenderer` applies: the `visible` expression,
    `requiredPermissions`, the `requiresObject` / `requiresService` runtime
    capability gates, and — for `action` items — the presence of an `onAction`
    dispatcher (framework#4509: without one they are not rendered, so they
    cannot carry an area either). Separators never count; a `group` counts only
    through its children.
  - **The active area is elected among visible areas only.** A fully gated
    first area is no longer auto-activated, and when a gating change hides the
    currently active area the shell re-elects the first visible one. A gating
    change that merely _reveals_ an area never yanks the user away from where
    they are.
  - **An area with no items at all derives the same way**: no visible item →
    hidden. (Boundary recorded in objectui#3311.)
  - New export `hasVisibleNavigationItems(items, options)` from
    `@object-ui/layout` — the predicate behind the derivation, usable by other
    shells that render their own area switchers.

  No authorable key is involved anywhere: the platform's `.strict()` area
  object still rejects the retired keys, and the derivation — computed from the
  same guards that decide what renders — cannot disagree with the rendered
  navigation, so there is nothing for a metadata author to get wrong.

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

- d2363e7: The legacy `page-header` alias stops advertising `description` as an authorable
  key (objectui#3226).

  FROM: `registerLayout()` declared `inputs: [title, description]`. TO:
  `inputs: [title, subtitle]` — the key `@objectstack/spec/ui`'s `PageHeaderProps`
  declares, and the one the canonical `page:header` renderer in
  `@object-ui/components` already declares.

  `inputs` is a DECLARATION surface, not documentation: the designer builds its
  property palette from it, and the framework's `check:react-declaration-parity`
  diffs it against the spec schemas. Declaring `description` therefore did not
  merely tolerate a legacy spelling — it published a second dialect for the one
  concept the protocol calls `subtitle`, and told authors (an AI author most
  readily, since the registry is what it reads to learn the shape) that the
  non-spec key was legal. Metadata that took the offer renders a subtitle under
  `page-header` and silently loses it under `page:header`: same JSON, two results,
  which is the outcome a single contract exists to prevent.

  No runtime behaviour changes. `PageHeader` still reads `subtitle ?? description`,
  deliberately: this alias exists for out-of-repo consumer schemas, so "no in-repo
  author writes `description`" (verified — zero hits) is not evidence that nobody
  does, and dropping the read today would delete an external page's second line
  while its title kept rendering, the least reportable failure mode there is. That
  read is retired together with an ADR-0087 D2 conversion entry
  (`page-header-subtitle-alias`, `description` → `subtitle` rewritten at load
  time), which lives in the framework repo and is tracked separately. Narrowing the
  declaration did not need to wait on it and breaks no consumer; leaving the
  declaration wrong in the meantime keeps minting the metadata the conversion would
  then have to absorb.

  New tests pin both halves so neither can drift back: the registration may not
  declare `description`, must declare `subtitle`, and — checked against the spec's
  own shape rather than a hand-written allowlist — may declare nothing
  `@objectstack/spec` does not; while the runtime fallback is pinned as a sequencing
  guard, to be deleted in the same change that lands the conversion entry.

- Updated dependencies [18cd432]
- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [9e9e9a9]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [f833d3a]
- Updated dependencies [2a9513d]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/react@17.3.0

## 17.2.0

### Minor Changes

- 4a51e77: Stop declaring 14 symbols across ten packages under names `@objectstack/spec`
  owns (objectui#3161, objectstack#4115 batch 7 — the long tail, one or two
  entries per package). All ten packages leave the ledger, which drops from 17
  collisions across 11 packages to 3 across 1.

  **Renamed exports** — in every case the spec exports the same name for a
  _different_ thing, so the old name was a mis-description rather than a dialect:

  | package                    | was                                | now                                                  | what the spec's same-named export is                                                                                                       |
  | :------------------------- | :--------------------------------- | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
  | `@object-ui/fields`        | `FieldWidgetProps`                 | `FieldWidgetComponentProps`                          | the DECLARED field-widget plugin props contract (a zod object; `field.type` is the `FieldType` enum, `readonly`/`required` carry defaults) |
  | `@object-ui/layout`        | `PageHeaderProps`                  | `PageHeaderComponentProps`                           | the authored `page:header` node — a zod schema of `title`, `subtitle`, an icon NAME, `breadcrumb`, `actions: string[]`                     |
  | `@object-ui/layout`        | `Page`                             | `PageNodeRenderer`                                   | the authored page metadata DOCUMENT (`name`, `label`, `type`, `regions`)                                                                   |
  | `@object-ui/plugin-detail` | `ObjectFieldLike`                  | `ObjectDefFieldLike`                                 | the i18n duck type `translateObject` walks (`help`/`description`, plus `[key: string]: any`)                                               |
  | `@object-ui/plugin-grid`   | `ColumnSummaryConfig`              | `ColumnSummarySetting`                               | the OBJECT form of `ListColumn.summary` **only** — the local one was the whole union, shorthand included                                   |
  | `@object-ui/plugin-grid`   | `isMultiValueField`                | `hasMultiValueShape`                                 | the spec's classifier, which requires a def with a `type`; the local one is called with `undefined`                                        |
  | `@object-ui/collaboration` | `RealtimeConfig`                   | `RealtimeSubscriptionConfig`                         | the app's realtime DECLARATION (`enabled`, `transport`, `subscriptions[]`)                                                                 |
  | `@object-ui/plugin-charts` | `ChartConfig`                      | `ChartContainerConfig`                               | the authored chart document (`type`, `xAxis`, `series`, `showLegend`, …)                                                                   |
  | `@object-ui/plugin-form`   | `FormSection` / `FormSectionProps` | `FormSectionContainer` / `FormSectionContainerProps` | the authored form-section metadata (`name`, `pane`, `visibleWhen`, `fields`)                                                               |
  | `@object-ui/providers`     | `Theme`                            | `ThemePreference`                                    | a whole theme DOCUMENT (`name`, `label`, `colors`, `typography`)                                                                           |
  | `@object-ui/runner`        | `App` (default export)             | `RunnerApp`                                          | the authored application metadata type **and** the `App.create()` builder                                                                  |
  | `@object-ui/sdui-parser`   | `ValidationResult`                 | `ManifestValidationResult`                           | plugin-manifest validation (`{ valid, errors?, warnings? }`), exported from both `kernel` and `contracts`                                  |

  `ManifestValidationResult` follows the `<what was validated>Validation<Error|Result>`
  convention registered on objectstack#4115 (`@object-ui/core` took
  `SchemaNodeValidationResult` in batch 4). `PageHeaderComponentProps` deliberately
  reuses the name `@object-ui/app-shell` already chose for its own header props in
  batch 3, so one concept does not acquire two dialect names one package apart.

  **Now derived from the spec instead of hand-written:**

  - `@object-ui/fields` — `isFileIdToken` is re-exported from
    `@objectstack/spec/data`. The local copy was character-for-character identical
    to the spec's function while its comment said it "mirrors" it, so every
    behaviour test passed and only reference identity could tell the two apart.
    The regex is a wire decision: widening it server-side while a copy here kept
    the old bound would make every new id read as "not a reference", and the
    widget would submit the legacy inline blob to a backend expecting a reference.
  - `@object-ui/plugin-detail` — `FeedFilterMode` is re-exported from
    `@objectstack/spec/data`, in a file that already imported the sibling
    `FeedItemType` from the spec.
  - `@object-ui/plugin-grid` — the eleven-member aggregation union is now the
    spec's `ColumnSummary` enum, so the total `Record<ColumnSummaryType, string>`
    label map turns a member the spec adds into a compile error instead of a
    blank footer cell. `ColumnSummarySetting` is `NonNullable<ListColumn['summary']>`,
    i.e. whatever forms the spec itself accepts. `hasMultiValueShape` delegates to
    the spec's `isMultiValueField` rather than re-deriving it from
    `MULTI_OPTION_TYPES` / `MULTI_CAPABLE_TYPES`.
  - `@object-ui/providers` — `ThemePreference` is the spec's `ThemeMode` union
    plus the one legacy `'system'` spelling this provider still honours for stored
    preferences, read off the schema's own `_zod` carrier so the package takes no
    zod dependency.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/fields` (it re-exports a runtime function) and `@object-ui/providers`
  (its public `.d.ts` now references the spec).

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

- 07de7be: Navigation `action` items actually run now (framework#4509).

  A `type: 'action'` nav item rendered, gated like any other item, and did
  **nothing** when clicked. `NavigationRenderer` dispatches such a click to an
  `onAction` prop it expects the host shell to supply — it deliberately never
  reads `item.actionDef` itself — and no shipped sidebar supplied that prop. So
  `actionDef.actionName` reached no dispatcher: an author could put an action in
  the menu, watch it render with its icon and label, and never find out that
  clicking it was a no-op. The framework's liveness ledger recorded this as the
  single gap in the AppSchema navigation surface.

  **New `useNavActionDispatch`** (`@object-ui/app-shell`) resolves the nav item's
  `actionName` against `action` metadata at click time — the same source
  `DeclaredActionsBar` reads for a record toolbar — and dispatches the resolved
  definition through `useAction()`. `UnifiedSidebar` now passes it. No new
  provider is involved: the sidebar already renders inside `ConsoleShell`'s
  `GlobalActionRuntimeProvider`, so nav actions get the fully-wired console runner
  including the confirm, param-collection, result and navigate dialogs. A declared
  `params` array becomes the runner's param-dialog input, and the nav item's own
  `actionDef.params` is passed as the value bag, so a menu entry can pre-fill the
  action it launches.

  Nav actions are inherently **global**: `ActionNavItemSchema` is strict with
  exactly `{ actionName, params? }` and carries no `objectName`, so resolution is
  by name alone and no record context rides along.

  **Behaviour change:** a shell that passes no `onAction` no longer renders
  `action` items at all, instead of rendering them dead. This mirrors the existing
  capability guards — an item the host cannot serve is hidden — and it makes the
  omission diagnosable: a missing prop now shows up as "my action item is gone",
  which leads to the prop, rather than "clicking does nothing", which for three
  releases led nowhere. Every failure at dispatch time (an unnamed item, an
  unresolvable action, a throwing action) warns and toasts instead of returning
  silently.

- 6d868e1: Remove `PageNodeRenderer`, the dead page-node renderer (objectui#3223, ADR-0049
  enforce-or-remove).

  **Removed:** the `PageNodeRenderer` export and its `./Page` module. It was
  registered under no component key and imported by nothing — a whole-repo grep
  found zero call sites — so it reached consumers only through
  `export * from './Page'` in the package barrel. `registerLayout()` was already
  saying so in a note that told the next reader _not_ to register it. Its props
  were also `{ schema: PageNodeSchema; … } & any`, and an intersection with `any`
  absorbs the whole type, so the signature asserted nothing beyond "there is a
  schema".

  **Migration:** there is nothing to re-point in a working app — an unregistered
  renderer had no call site to migrate. If you imported the symbol directly:

  ```diff
  -import { PageNodeRenderer } from '@object-ui/layout';
  +import { PageRenderer } from '@object-ui/components';
  ```

  `PageRenderer` in `@object-ui/components` is, and remains, the renderer for the
  `page` component key. It is the one that supports page types
  (record/home/app/utility), named regions and `PageVariablesProvider` — the
  deleted one rendered a header plus children and nothing else. Schema-driven
  consumers are unaffected: a `{ type: 'page' }` node has always resolved through
  the registry to `PageRenderer`, never to this export.

  Also note: this supersedes the `Page` → `PageNodeRenderer` rename shipped for
  this package in the batch 7 symbol burn-down — the renamed symbol is gone rather
  than renamed again. `PageHeaderProps` → `PageHeaderComponentProps` from that same
  batch is unaffected.

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/react@17.2.0

## 17.1.0

### Patch Changes

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

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [68ef584]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c4d7b20]
- Updated dependencies [c769d3d]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c735bf7]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [9a04d25]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [07de839]
- Updated dependencies [2a40b5e]
- Updated dependencies [df613fa]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [eb4b740]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [379728f]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [80edbd4]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/components@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0

## 17.0.0

### Patch Changes

- Updated dependencies [7b21891]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [e16ed2d]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [2735de6]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [c7cff19]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [9b53d72]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [c6cfdf1]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0

## 16.1.0

### Patch Changes

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

- Updated dependencies [1c8935a]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [f0f10f5]
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

### Minor Changes

- 06e92ac: feat(console-ai): ChatDock — right-docked AI rail behind a default-off flag (ADR-0057 P3a)

  Stands up the ADR-0057 P3 docked rail as an ADDITIVE, DEFAULT-OFF shell: until an
  operator sets `features.chatDock`, nothing changes and the FAB stays the
  canonical entry.

  - `@object-ui/layout`: `AppShell` gains an optional `rightRail` prop, rendered as
    a flex sibling of the main content so the rail REFLOWS the content beside it
    (VS Code / Cursor idiom), not overlaying it. Absent → unchanged single-pane.
  - `@object-ui/app-shell`: new `ChatDock` — a collapsible, resizable right rail
    that reuses the shared `ChatPane` engine over the P1 `(user, app, product=ask)`
    conversation (the same ambient thread the FAB/`/ai` shows; it's a VIEW, not a
    new conversation). Default COLLAPSED (a fixed edge launcher → zero layout cost
    until invoked); ⌘/Ctrl+Shift+I toggles it. Gated on `useAiSurfaceEnabled` AND
    the flag, so OSS / no-seat runtimes render nothing.
  - `runtime-config`: `chatDock?` rollout flag, parsed default-OFF (opt-in only).

  Live-verified with the flag forced on: the launcher expands to a rail rendering
  the ask chat, the dashboard content reflows narrower beside it, and collapse
  restores the launcher. Unit-tested: width clamp, the composer-safe shortcut
  matcher (⌘⇧I, no collision with the ⌘⇧O/S page shortcuts), and the flag's
  default-off/opt-in parse. FAB retirement (P3b) and `/ai`-as-maximized-dock +
  Studio reflow (P3c) follow.

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/react@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/components@11.1.0
- @object-ui/react@11.1.0
- @object-ui/types@11.1.0
- @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [6c0c92c]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/react@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1

## 5.2.0

### Minor Changes

- e7b6eae: `NavigationRenderer` now resolves a group's initial open state with two
  platform-aware defaults:
  1. **`expanded` field honored.** `@objectstack/spec` `AppNavigation`
     uses `expanded: true | false` on group items; objectui historically
     only read `defaultOpen`. App authors who wrote `expanded: false`
     would see no effect because the renderer silently fell back to the
     "open unless `defaultOpen === false`" rule. Both field names now
     resolve to the same explicit override.
  2. **Auto-collapse long groups.** When the author has set neither
     `expanded` nor `defaultOpen`, groups with **8 or more direct
     children** default to collapsed. Long sidebar sections (e.g. 10+
     reports) doubled the sidebar height and pushed siblings below the
     fold — Slack, Linear, and Notion all default-collapse oversized
     sections for the same reason. Short groups (typical 3–6 items) still
     open by default.
  3. **Active-route override.** Both heuristics are bypassed when the
     current route lives inside the group, so users never lose visual
     orientation to a hidden active item.

### Patch Changes

- b703480: feat(layout): smoother sidebar transitions

  `SidebarNav` now animates the previously-instant state changes:

  - Active-state colour swap on `SidebarMenuButton` /
    `SidebarMenuSubButton` is wrapped in `transition-colors duration-150`
    so navigating between rows glides rather than snaps.
  - `CollapsibleContent` (group children) fades + slides in / out when
    the parent group is expanded/collapsed (chevron already rotated;
    the children now match).

  All animations are gated on `motion-safe:` so users with
  `prefers-reduced-motion` see the original instant UI.

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/components@5.0.2
- @object-ui/react@5.0.2
- @object-ui/types@5.0.2
- @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1

## 5.0.0

### Patch Changes

- 95b6b21: feat(page:header): record-aware chip + dedupe registrations (Phase D)

  The `page:header` schema renderer is the visual anchor of every custom
  record detail page (lead, opportunity, future account/contact/case).
  Before this change it had two problems that bled into every custom
  page across the product:

  1. **Quadruple registration**: `@object-ui/layout` registered both
     `page-header` and `page:header`, and `@object-ui/components`
     independently registered `page:header` (and `page:section`).
     Whichever package loaded last won the unqualified `page:header`
     lookup — visually unstable.
  2. **Bare `<h1>`** with no record affordances (no icon, ★ favourite,
     copy-id, edit, ⋯ menu) — every custom page shipped a thinner header
     than the default detail view it was meant to supersede.

  This commit:

  - Removes the `@object-ui/layout` `page:header` registration. The
    layout package keeps the legacy kebab-cased `page-header` alias only.
    The canonical renderer now lives in `@object-ui/components` and is
    always the one resolved.
  - Upgrades `PageHeaderRenderer` to render a `<RecordTitleChip>` when
    wrapped in a `RecordContext`. The chip mirrors the default detail
    header: title (resolved from `data.name` / `data.title` /
    `data.display_name`, or an interpolated `schema.title`), a favourite
    star, the object label, and a copy-record-id button. Authors opt out
    via `recordChrome: false` or hide individual affordances with
    `showStar: false` / `showCopyId: false`.
  - Extracts the chip into a new shared `RecordTitleChip` component in
    `@object-ui/components/custom`. It carries an inline zh-CN/zh-TW
    dictionary for star/copy tooltips so it stays i18n-correct without
    pulling in a translation dependency.
  - Fixes `interpolate()` so a `{account}`-style token that resolves to
    a related-record object renders as empty instead of
    `"[object Object]"`. Authors who want a field of the related record
    should use a deeper path (`{account.name}`).

  Verified at 1440×900 on `lead_detail` and `opportunity_detail`:
  both pages now show the same chip with star + copy-id and the
  opportunity highlights strip looks coherent with the chip above it.

- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bb2ea48]
- Updated dependencies [b14fe09]
- Updated dependencies [a7bef6e]
- Updated dependencies [74962b0]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
  - @object-ui/components@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- d714e85: Lookup display-name resolution now falls back through a Salesforce-style chain
  when an `$expand`'d reference object lacks a top-level `name`/`label`/
  `display_name`/`title` field:

  1. Standard display fields (existing behaviour)
  2. `salutation first_name last_name` composite — handles person records that
     only carry first/last name parts
  3. `email` — last-resort identifier, beats the opaque id

  Applies to `LookupCellRenderer`, `PageHeader.subtitle` interpolation,
  `DetailView` page-mode `titleFormat`, and the shared `formatRecordTitle`
  utility. Concretely: a Contact reference with `first_name: Bob`, `last_name:
Lin` and no `name` field now renders as `Bob Lin` everywhere — instead of
  the email or [object Object] fallback.

- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Minor Changes

- 67dabe1: feat(page-header): first-class `actions` property on page:header

  PageHeader now accepts an `actions: ActionDef[]` (or string[]) property
  and renders the toolbar inline in the header's right-aligned action slot.
  Removes the need for authors to declare a sibling `record:quick_actions`
  node and the `-mt-12` visual offset hack to pair the toolbar with the
  title. The hack still applies for legacy schemas using the sibling form
  (via location:'record_header'); the new in-header rendering opts out via
  an `inline: true` flag automatically set by PageHeader.

### Patch Changes

- 63eb66d: fix(detail): expand lookup fields so subtitle + lookup cells show display names

  The record-page fetch in `RecordDetailView` (the page-mode path) now
  requests `$expand` for every lookup/master_detail field on the object,
  mirroring the behaviour the legacy `DetailView` already had. Combined
  with two small downstream fixes — `PageHeader` subtitle interpolation
  now extracts `name/label` from expanded reference objects instead of
  rendering `[object Object]`, and `LookupCellRenderer` now short-circuits
  to `pickRecordDisplayName` when the value is already a nested record —
  all `record:*` renderers and the page header subtitle (`Owned by
{account}`) now display the related record's name rather than the raw
  foreign-key id.

- ef0e30d: feat(page-header): back-to-list arrow on record pages

  `page:header` now renders a ← back arrow at the left when a record
  context with an id is present. Clicking it strips the trailing
  `/record/{id}` segment from the URL so users return to the object list,
  falling back to `history.back()` for deep-linked entry. The legacy app
  pages without a record context are unaffected.

- 2bd45af: feat(shell): main becomes the scroll container; record tabs are sticky

  - `AppShell`'s SidebarProvider wrapper is now constrained to viewport
    height (`h-svh overflow-hidden`) instead of expanding with content via
    the default `min-h-svh`. This makes the inner `<main>` (which is
    `overflow-auto`) the actual scroll container instead of the window.
  - `RecordDetailView` page-mode container drops the redundant
    `h-full overflow-auto` (avoids nested scrollers; main owns scroll now).
  - `page:tabs` (horizontal) gets `sticky top-0 z-20` with a translucent
    backdrop so the tab strip stays visible while users scroll through
    long record pages — the Salesforce Lightning behaviour our schemas
    were already implying.

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- 6b683c8: fix(detail): clean up record page rendering

  - Drop `ai:chat_window` from the protocol-component placeholder list. The
    floating chat overlay (plugin-chatbot) is the canonical AI entry point;
    inline page schemas that still reference `ai:chat_window` now surface
    as an explicit "Unknown component type" so the misconfiguration is
    fixed at the source instead of silently leaking a placeholder card.
  - `page:header` now resolves `{field.path}` tokens in `title` / `description`
    against the current record context (matching the behaviour of the
    alternative `containers.tsx` renderer). Without this, schemas like
    `title: "{first_name} {last_name}"` rendered the literal template.
  - `containers.tsx` `PageHeaderRenderer`: also read from `schema.properties.*`
    as a fallback so both inlined and raw-bag schema shapes are supported.

- 0d8eb98: feat(detail): Salesforce-style record header + section field grid

  - `page:header` now renders an icon chip (resolves Lucide names via
    `LazyIcon`) plus subtitle, so detail pages can show
    "Name / Company" without an extra component.
  - `record:details` normalises string field entries (`fields: ['email']`)
    into the `{name, label?}` shape expected by `DetailSection`, and maps
    section `label` → `title`. Schemas authored against `@objectstack/spec`
    now produce a real grouped field grid instead of an empty card.

- Updated dependencies [6b683c8]
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/react@4.2.0
- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/react@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/react@4.0.8
- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
  - @object-ui/react@4.0.6

## 4.0.5

### Patch Changes

- 1dc6061: fix(build): inline dynamic imports in library outputs

  Library `vite build --lib` outputs were emitting separate code-split chunks
  (`rolldown-runtime-*.js`, `LookupField-*.js`, etc.) when source files used
  `React.lazy()` / dynamic `import()`. When consumer apps re-bundled these
  multi-file dists, the library's per-chunk rolldown-runtime collided with the
  consumer's own runtime, causing "TypeError: i is not a function" at runtime
  when lazy components tried to register themselves (e.g. TextField in
  `@object-ui/fields` after 4.0.4).

  Adding `output.inlineDynamicImports: true` to all `@object-ui/*` library vite
  configs forces a single `dist/index.js` per package, which lets consumer
  bundlers handle the library as an opaque ESM module without identifier
  mismatches across chunks.

  Affected packages: components, fields, layout, plugin-aggrid, plugin-ai,
  plugin-calendar, plugin-charts, plugin-chatbot, plugin-dashboard,
  plugin-designer, plugin-detail, plugin-editor, plugin-form, plugin-gantt,
  plugin-grid, plugin-kanban, plugin-list, plugin-map, plugin-markdown,
  plugin-report, plugin-timeline, plugin-view, plugin-workflow.

- Updated dependencies [1dc6061]
  - @object-ui/components@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
  - @object-ui/react@4.0.5

## 4.0.4

### Patch Changes

- d2b6ece: fix: externalize all bare imports in library builds

  Library builds (vite lib mode) now externalize every non-relative import instead of bundling third-party CJS dependencies into the published dist. This avoids inlined `require("react")` / `require("react-dom")` calls that cause `Calling \`require\` for "react" in an environment that doesn't expose the \`require\` function` runtime errors when consumer apps re-bundle the published dist.

  Specifically fixes:

  - `@object-ui/plugin-dashboard` no longer inlines `react-grid-layout` (and its transitive `react-draggable` / `react-resizable` CJS bundles). `react-grid-layout` is now declared as a peer dependency so consumers install a single ESM-friendly copy.
  - `@object-ui/components`, `@object-ui/plugin-calendar`, `@object-ui/plugin-charts`, `@object-ui/plugin-designer` no longer inline `react-i18next` / `i18next` / `use-sync-external-store` CJS shims.
  - All plugin packages now use a unified `external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)` rule, ensuring future additions of CJS deps are automatically externalized.

- Updated dependencies [d2b6ece]
  - @object-ui/components@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
  - @object-ui/react@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/react@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/types@3.0.1
  - @object-ui/core@3.0.1

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
  - @object-ui/react@3.0.0
  - @object-ui/components@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0

## 0.1.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1
