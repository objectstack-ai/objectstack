---
'@object-ui/components': patch
---

refactor(components)!: retire forty-seven more zero-consumer exports — the menubar, navigation-menu, input-otp and carousel heads, filter and notification helpers — and delete the item parts, `NativeSelect`, `ResizableHandleProps` and `useRelatedCount` nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/components#Menubar, @object-ui/components#MenubarMenu, @object-ui/components#MenubarItem, @object-ui/components#NavigationMenuItem, @object-ui/components#InputOTPGroup, @object-ui/components#InputOTPSeparator, @object-ui/components#Carousel, @object-ui/components#CarouselItem, @object-ui/components#CarouselApi, @object-ui/components#ItemMedia, @object-ui/components#ItemContent, @object-ui/components#ItemActions, @object-ui/components#ItemGroup, @object-ui/components#ItemSeparator, @object-ui/components#ItemTitle, @object-ui/components#ItemDescription, @object-ui/components#ItemHeader, @object-ui/components#ItemFooter, @object-ui/components#NativeSelect, @object-ui/components#NativeSelectProps, @object-ui/components#ResizableHandleProps, @object-ui/components#useRelatedCount, @object-ui/components#mountedOperatorValue, @object-ui/components#retypeFilterValue, @object-ui/components#narrowFilterValueToOptions, @object-ui/components#CURRENCY_COMPANION_SUFFIX, @object-ui/components#currencyCompanionId, @object-ui/components#currencyCompanionOf, @object-ui/components#pairedCurrencyField, @object-ui/components#KbdGroup, @object-ui/components#isInsidePopperLayer, @object-ui/components#usePopperAwareInteractOutside, @object-ui/components#SIDEBAR_WIDTH_FALLBACK, @object-ui/components#SIDEBAR_WIDTH_ICON_FALLBACK, @object-ui/components#useIsActiveListRecord, @object-ui/components#useScrollActiveListRecordIntoView, @object-ui/components#ActiveListRow, @object-ui/components#listRecordIdOf, @object-ui/components#DataLoadingState, @object-ui/components#DataLoadingStateProps, @object-ui/components#NOTIFICATION_ACTION_BUTTON_VARIANTS, @object-ui/components#NOTIFICATION_POSITION_CLASSES, @object-ui/components#NOTIFICATION_SEVERITY_STYLES, @object-ui/components#notificationActionVariant, @object-ui/components#notificationIcon, @object-ui/components#notificationSeverityStyle, @object-ui/components#NotificationSeverityStyle) the retired operands are React components, hooks, helpers, constants and their types on the components package entry; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them (the schema renderers, the filter builder and the notification surfaces keep reading them inside the package), so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these forty-seven names from `@object-ui/components`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected, and every schema node type (`menubar`, `navigation-menu`, `input-otp`, `carousel` and the rest), the filter builder and the five notification surfaces render exactly as before.

The nine shadcn family heads below were named as staying on the entry by the previous `@object-ui/components` retirement in this series; they leave now. Every reference to them outside the package was a same-named declaration of another package (the `@object-ui/types` interfaces `MenubarMenu`, `NavigationMenuItem`, `CarouselItem` and their schema text), an example title or test prose, never an import of these components.

Thirteen of them are **gone from the package, not only from the entry**, because nothing inside the package read them either:

- `src/custom/item.tsx` keeps only `Item`; `ItemMedia`, `ItemContent`, `ItemActions`, `ItemGroup`, `ItemSeparator`, `ItemTitle`, `ItemDescription`, `ItemHeader` and `ItemFooter` are deleted.
- `src/custom/native-select.tsx` is deleted with `NativeSelect` and `NativeSelectProps`.
- The type alias `ResizableHandleProps` is deleted.
- The hook `useRelatedCount` is deleted; `useRelatedCountVersion` and `RelatedCountStore` stay.

The other thirty-four stay in their modules, which this package's own renderers, components and tests read, and only leave the entry (the shadcn registry files under `src/ui/` are untouched, so `pnpm shadcn:update` stays a clean re-fetch):

- `menubar`: `Menubar`, `MenubarMenu`, `MenubarItem`
- `navigation-menu`: `NavigationMenuItem`
- `input-otp`: `InputOTPGroup`, `InputOTPSeparator`
- `carousel`: `Carousel`, `CarouselItem`, `CarouselApi`
- `filter-builder`: `mountedOperatorValue`, `retypeFilterValue`, `narrowFilterValueToOptions`
- `filterRecordCurrency`: `CURRENCY_COMPANION_SUFFIX`, `currencyCompanionId`, `currencyCompanionOf`, `pairedCurrencyField`
- `kbd`: `KbdGroup`
- `mobile-dialog-content`: `isInsidePopperLayer`, `usePopperAwareInteractOutside`
- `navigation-overlay`: `SIDEBAR_WIDTH_FALLBACK`, `SIDEBAR_WIDTH_ICON_FALLBACK`
- `record-list-face`: `useIsActiveListRecord`, `useScrollActiveListRecordIntoView`, `ActiveListRow`, `listRecordIdOf`
- `view-states`: `DataLoadingState`, `DataLoadingStateProps`
- `notifications/severity`: `NOTIFICATION_ACTION_BUTTON_VARIANTS`, `NOTIFICATION_POSITION_CLASSES`, `NOTIFICATION_SEVERITY_STYLES`, `notificationActionVariant`, `notificationIcon`, `notificationSeverityStyle`, `NotificationSeverityStyle`

Every other name the entry exported stays exported unchanged, among them `Item`, `Kbd`, `Pagination`, `FilterBuilder` with `filterValueArity`, `reshapeFilterValue`, `operatorsForFieldType` and the type `FilterValueArity`, `isCurrencyCompanion`, `syncRecordCurrencyRows` and the type `RecordCurrencyFilterField`, `MobileDialogContent`, `NavigationOverlay`, `ActiveListRecordProvider`, `DataEmptyState`, `EmptyState`, `DataErrorState`, the four notification surfaces with their props types, `ResizableHandle`, `ResizablePanel`, `ResizablePanelGroup`, and `GridSkeleton`, `KanbanSkeleton`, `FormSkeleton`, `ListSkeleton`, `ChartSkeleton` with their props types.

What leaves, and what to write instead:

- FROM `Menubar`, `MenubarMenu`, `MenubarItem` TO the same parts in the host's own tree (`npx shadcn@latest add menubar`), or a `menubar` schema node.
- FROM `NavigationMenuItem` TO the same part in the host's own tree (`npx shadcn@latest add navigation-menu`), or a `navigation-menu` schema node.
- FROM `InputOTPGroup`, `InputOTPSeparator` TO the same parts in the host's own tree (`npx shadcn@latest add input-otp`), or an `input-otp` schema node.
- FROM `Carousel`, `CarouselItem`, `CarouselApi` TO the same parts in the host's own tree (`npx shadcn@latest add carousel`), or a `carousel` schema node.
- FROM `ItemMedia`, `ItemContent`, `ItemActions`, `ItemGroup`, `ItemSeparator`, `ItemTitle`, `ItemDescription`, `ItemHeader`, `ItemFooter` TO plain `div` / `p` elements with the classes you want inside `Item`, or the same parts in the host's own tree (`npx shadcn@latest add item`).
- FROM `NativeSelect` TO a plain `select` element, or `Select`.
- FROM `NativeSelectProps` TO `React.SelectHTMLAttributes<HTMLSelectElement>`, which it extended without adding a key.
- FROM `ResizableHandleProps` TO `React.ComponentProps<typeof ResizableHandle>`, which it aliased.
- FROM `useRelatedCount` TO `RelatedCountStore.get` with the same four arguments (object, relationship field, parent id, filter), read in a component that calls `useRelatedCountVersion()`, which re-renders it when the store changes.
- FROM `mountedOperatorValue`, `retypeFilterValue`, `narrowFilterValueToOptions` TO `FilterBuilder`, which applies them to its rows, or `reshapeFilterValue` for the operator half.
- FROM `CURRENCY_COMPANION_SUFFIX`, `currencyCompanionId`, `currencyCompanionOf`, `pairedCurrencyField` TO `isCurrencyCompanion` and `syncRecordCurrencyRows`, which pair and keep the currency rows.
- FROM `KbdGroup` TO a `kbd` element with the classes `inline-flex items-center gap-1` around the `Kbd` elements.
- FROM `isInsidePopperLayer`, `usePopperAwareInteractOutside` TO `MobileDialogContent`, which already keeps a dialog open when a click lands in a popover, menu or select layer.
- FROM `SIDEBAR_WIDTH_FALLBACK`, `SIDEBAR_WIDTH_ICON_FALLBACK` TO the values they held, `16rem` and `3rem` (the fallbacks of the `--sidebar-width` and `--sidebar-width-icon` CSS variables).
- FROM `useIsActiveListRecord`, `useScrollActiveListRecordIntoView`, `ActiveListRow`, `listRecordIdOf` TO `ActiveListRecordProvider` around a list this package draws: its data table marks and scrolls the active row itself.
- FROM `DataLoadingState` TO `Spinner` or `Skeleton`, or `GridSkeleton` / `ListSkeleton` for a view.
- FROM `DataLoadingStateProps` TO `React.ComponentProps<"div">` plus your own `message` prop.
- FROM `NOTIFICATION_ACTION_BUTTON_VARIANTS`, `NOTIFICATION_POSITION_CLASSES`, `NOTIFICATION_SEVERITY_STYLES`, `notificationActionVariant`, `notificationIcon`, `notificationSeverityStyle`, `NotificationSeverityStyle` TO `NotificationBanners`, `NotificationSnackbar`, `NotificationAlerts` or `NotificationInline`, which style a notification by its severity and action variant themselves.
