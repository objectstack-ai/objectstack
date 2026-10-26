---
'@object-ui/app-shell': patch
---

refactor(app-shell)!: retire the 54 root-entry exports that nothing outside the package names

`@object-ui/app-shell`'s root entry published 261 names. 57 of them appear in no file of this repository outside `ui/packages/app-shell/` (the measure covers `ui/`, `packages/` and `apps/`); three of those are taken by the package's own README examples and stay (`SignUpOffer`, `RuntimeBranding`, `studioOrgScopePath`). The other 54 leave the entry. Every module that defines them stays, and code inside the package keeps importing them from there; only the package entry stops publishing them. The entry now publishes 208 names (207, plus `InvitationSignUpPrompt`, which main added meanwhile).

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/app-shell#useExpressionContext, @object-ui/app-shell#UseUrlOverlayOptions, @object-ui/app-shell#UrlOverlayControls, @object-ui/app-shell#SettleSignalState, @object-ui/app-shell#isIdle, @object-ui/app-shell#ObjectUiGlobal, @object-ui/app-shell#ExpressionContextValue, @object-ui/app-shell#RecentItemInput, @object-ui/app-shell#RecentTextItem, @object-ui/app-shell#RecentItemLabelResolver, @object-ui/app-shell#isOverrideOnlyViewer, @object-ui/app-shell#actionAdmittedByOverride, @object-ui/app-shell#bypassedApproverNames, @object-ui/app-shell#DeclaredHomeApp, @object-ui/app-shell#AiSurfaceState, @object-ui/app-shell#PreviewBadgeProps, @object-ui/app-shell#RedirectWithSplashProps, @object-ui/app-shell#toastWithUndo, @object-ui/app-shell#ToastWithUndoOptions, @object-ui/app-shell#getCloudBase, @object-ui/app-shell#getBrandColor, @object-ui/app-shell#isRuntimeConfigInitialised, @object-ui/app-shell#RuntimeFeatures, @object-ui/app-shell#RecordFormPageProps, @object-ui/app-shell#DeclaredActionsBarProps, @object-ui/app-shell#addNavigationItem, @object-ui/app-shell#removeNavigationItems, @object-ui/app-shell#renameNavigationItems, @object-ui/app-shell#navigationEqual, @object-ui/app-shell#generateNavId, @object-ui/app-shell#CommandPaletteContextValue, @object-ui/app-shell#SignUpOfferContext, @object-ui/app-shell#HydratedUIMessage, @object-ui/app-shell#listAppComponents, @object-ui/app-shell#urlSegmentsToComponentRef, @object-ui/app-shell#AppComponentRegistryEntry, @object-ui/app-shell#MetadataPageShell, @object-ui/app-shell#listMetadataResources, @object-ui/app-shell#useMetadataTypes, @object-ui/app-shell#useTypesIndex, @object-ui/app-shell#matchesQuery, @object-ui/app-shell#MetadataPreviewProps, @object-ui/app-shell#MetadataInspectorProps, @object-ui/app-shell#StudioDesignSurfaceProps, @object-ui/app-shell#getStudioCanvasPreview, @object-ui/app-shell#listStudioCanvasPreviewTypes, @object-ui/app-shell#StudioObjectRecordsCanvas, @object-ui/app-shell#StudioCanvasPreview, @object-ui/app-shell#StudioCanvasPreviewProps, @object-ui/app-shell#useAssistant, @object-ui/app-shell#useRegisterAssistantEditor, @object-ui/app-shell#requestAssistantOpen, @object-ui/app-shell#AssistantEditorContext, @object-ui/app-shell#AssistantEditorField) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What retires is 54 names of `@object-ui/app-shell`'s published entry that no file in this repository outside the package names. The affected party is a TypeScript importer, and the compiler at that import delivers the break. -->

**BREAKING** (an export retirement), shipped as `patch`: no metadata protocol kind moves. An importer of a retired name gets `TS2305` ("has no exported member") at its import line.

Migration. A retired type that describes a name the entry still exports is derived from that name; everything else has no replacement on the entry.

- FROM `UseUrlOverlayOptions` TO `Parameters<typeof useUrlOverlay>[1]`.
- FROM `UrlOverlayControls` TO `ReturnType<typeof useUrlOverlay>`.
- FROM `SettleSignalState` TO `ReturnType<typeof useSettleSignal>`.
- FROM `AiSurfaceState` TO `ReturnType<typeof useAiSurfaceEnabled>`.
- FROM `CommandPaletteContextValue` TO `ReturnType<typeof useCommandPalette>`.
- FROM `RecentItemInput` TO `Parameters<ReturnType<typeof useRecentItems>['addRecentItem']>[0]`.
- FROM `RecentTextItem` TO `Extract<RecentItem, { label: string }>`.
- FROM `RecentItemLabelResolver` TO `ReturnType<typeof useRecentItemLabel>`.
- FROM `DeclaredHomeApp` TO `NonNullable<Parameters<typeof resolveDeclaredHomePath>[0]>[number]`.
- FROM `RuntimeFeatures` TO `AppShellRuntimeConfig['features']`.
- FROM `SignUpOfferContext` TO `Parameters<typeof decideSignUpOffer>[1]`.
- FROM `HydratedUIMessage` TO `ReturnType<typeof toUIMessages>[number]`.
- FROM `AppComponentRegistryEntry` TO `Parameters<typeof registerAppComponent>[0]`.
- FROM `MetadataPreviewProps` TO `ComponentProps<MetadataPreview>` (`ComponentProps` from `react`).
- FROM `MetadataInspectorProps` TO `ComponentProps<MetadataInspector>`.
- FROM `StudioCanvasPreview` TO `Parameters<typeof registerStudioCanvasPreview>[1]`.
- FROM `StudioCanvasPreviewProps` TO `ComponentProps<Parameters<typeof registerStudioCanvasPreview>[1]>`.
- FROM `StudioDesignSurfaceProps` TO `ComponentProps<typeof StudioDesignSurface>`.
- FROM `PreviewBadgeProps` TO `ComponentProps<typeof PreviewBadge>`.
- FROM `RedirectWithSplashProps` TO `ComponentProps<typeof RedirectWithSplash>`.
- FROM `RecordFormPageProps` TO `ComponentProps<typeof RecordFormPage>`.
- FROM `DeclaredActionsBarProps` TO `ComponentProps<typeof DeclaredActionsBar>`.
- FROM `useExpressionContext`, `ExpressionContextValue`, `isIdle`, `ObjectUiGlobal`, `isOverrideOnlyViewer`, `actionAdmittedByOverride`, `bypassedApproverNames`, `toastWithUndo`, `ToastWithUndoOptions`, `getCloudBase`, `getBrandColor`, `isRuntimeConfigInitialised` TO nothing (no replacement on the entry).
- FROM `addNavigationItem`, `removeNavigationItems`, `renameNavigationItems`, `navigationEqual`, `generateNavId` TO nothing (no replacement on the entry).
- FROM `listAppComponents`, `urlSegmentsToComponentRef` TO nothing (no replacement on the entry): `getAppComponent` and `componentRefToUrlSegments` stay.
- FROM `MetadataPageShell`, `listMetadataResources`, `useMetadataTypes`, `useTypesIndex`, `matchesQuery` TO nothing (no replacement on the entry): `getMetadataResource`, `useMetadataClient` and `useGlobalDiagnostics` stay.
- FROM `getStudioCanvasPreview`, `listStudioCanvasPreviewTypes`, `StudioObjectRecordsCanvas` TO nothing (no replacement on the entry): `registerStudioCanvasPreview` stays.
- FROM `useAssistant`, `useRegisterAssistantEditor`, `requestAssistantOpen`, `AssistantEditorContext`, `AssistantEditorField` TO nothing (no replacement on the entry): `assistantBus` stays.

`ui/docs/app-shell-extraction-guide.md`, the package's architecture guide, is rewritten to describe the package that ships: what each directory holds, the groups of names the entry publishes, its load-time registrations, its dependencies, and its three consumers in this repository.
