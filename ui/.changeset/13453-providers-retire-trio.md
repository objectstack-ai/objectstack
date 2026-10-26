---
"@object-ui/providers": minor
---

Clause-②: no
Metadata-protocol: none

**Breaking:** removed `DataSourceProvider` / `useDataSource`, `MetadataProvider` / `useMetadata`, `ThemeProvider` / `useTheme` and the types `DataSourceProviderProps`, `MetadataProviderProps`, `ThemePreferenceProviderProps`, `ThemePreference` (objectui#13453). They duplicated names other ObjectUI packages publish with different implementations. Declared `minor` per the version-alignment policy (a changeset never declares `major`). `UploadProvider`, `useUpload` and the upload adapters are unchanged.

Migration: wrap the tree in `SchemaRendererProvider` from `@object-ui/react` (its `dataSource` prop) instead of `DataSourceProvider`, and pass the adapter to views as before; use `ThemeProvider` / `useTheme` from `@object-ui/react` (`defaultMode`, where the old `system` is `auto`; add `persist` to keep the choice in `localStorage`); use `MetadataProvider` / `useMetadata` from `@object-ui/app-shell`.
