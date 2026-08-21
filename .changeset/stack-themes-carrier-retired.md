---
"@objectstack/spec": minor
---

feat(spec): retire the `themes` carrier key and `ThemeSchema` — the authoring surface nothing ever applied (#10485, ADR-0049)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).
Maintainer ruling 2026-08-21, recorded verbatim on #10485: 「B：退役授权面 —
收掉 `themes` 载体键与 schema，`app.branding` 留作唯一颜色面；objectui 引擎代码
与单测保留。」

`defineStack({ themes })` was a real authoring surface — parsed strictly at the
authoring gate, ingested and stored by artifact ingest
(`ARTIFACT_FIELD_TO_TYPE`) — with ZERO consumers past that point, measured:
no non-test read of `.themes` or of stored `theme` items anywhere in
core/runtime/rest/services/plugins; `theme` never in `MetadataTypeSchema`,
`DEFAULT_METADATA_TYPE_REGISTRY` or `BUILTIN_METADATA_TYPE_SCHEMAS`; the only
mounted `ThemeProvider` is the app-shell chrome light/dark toggle (unrelated to
`ThemeSchema`); and no stack- or app-level key ever selected an active theme.
An author who wrote a theme shipped it through every green gate and the console
looked exactly the same.

**What is refused:** the top-level `themes:` key. `ObjectStackDefinitionSchema`
is a `strictObject`, so the key is deleted from the shape and the unknown-key
rejection carries the retirement prescription via the schema's `guidance` entry
(removal citation, why it was inert, and the `app.branding` replacement).
`ThemeSchema`, `ColorPaletteSchema`, `TypographySchema`, `BorderRadiusSchema`,
`ShadowSchema`, `ThemeModeSchema`, `defineTheme` and the `Theme` /
`ThemeParsed` / `ColorPalette` / `Typography` / `BorderRadius` / `Shadow` /
`ThemeMode` types are removed from `@objectstack/spec` / `@objectstack/spec/ui`
(orphaned value schemas leave with their one consumer, #3950). `PUT
/api/v1/meta/theme/:name` now gets the #8421 unrecognised-type refusal — the
`themes: 'theme'` fold left `PLURAL_TO_SINGULAR` and with it the generated
URL-spelling contract — instead of the pre-#10194 store-anything branch.

**What stays:** `app.branding.primaryColor` / `accentColor` — the one live
colour surface (objectui's `AppShell` reads it and derives `--primary`,
`--accent` and friends) — plus objectui's `ThemeEngine` / `ThemeContext` engine
code and their unit tests, explicitly retained by the ruling. Legacy stored
`theme` rows are untouched: reads still answer, DELETE still works, and
`applyConversionsToStoredItem` passes them through unchanged.

The retirement kit:

- strict deletion + `guidance` prescription at the stack schema
  (`packages/spec/src/stack.zod.ts`); `packages/spec/src/ui/theme.zod.ts`
  deleted whole
- ADR-0087 registration: retired-def entries `ui/Theme`, `ui/ThemeMode`,
  `ui/ColorPalette`, `ui/Typography`, `ui/BorderRadius`, `ui/Shadow` and the
  D3 **semantic** entry `stack-themes-carrier-retired` (protocol 18). Semantic
  rather than a D2 conversion on the lossless-only scope guard: a stack may
  declare N themes and M apps, so which palette entry becomes which app's
  `branding.primaryColor` is a judgment the transform cannot make — the entry
  prescribes the hand move instead of auto-deleting authored content
- ingest mapping removed (`packages/metadata/src/plugin.ts`), CLI stats row
  removed, showcase example re-based on app branding
- pin tests: `stack-top-level-strict.test.ts` (refusal carries `#10485` +
  `app.branding` + no rename suggestion; replacement parses green; no theme
  export survives on `./ui`) and `protocol.unrecognised-meta-type.test.ts`
  (`/meta/theme` refused with the ADR-0112 envelope, nothing stored)
- generated baselines/docs follow the schema (`authorable-surface/`,
  `json-schema.manifest/`, api-surface, export-origins, meta-url-spelling,
  spec-changes, upgrade guide, reference docs, skill references)

## FROM → TO

```ts
// before — parsed green, stored by artifact ingest, applied by NOTHING:
defineStack({
  themes: [{ name: 'corporate', label: 'Corporate', mode: 'light',
             colors: { primary: '#7C3AED' } }],
});

// after — delete the key; colour the console where something reads it:
defineApp({
  name: 'my_app',
  label: 'My App',
  branding: { primaryColor: '#7C3AED', accentColor: '#06B6D4' },
});
// a custom CSS variable your own stylesheet consumed has no spec slot any
// more — move it into your own CSS.
```

<!-- adr-0087: registered stack-themes-carrier-retired -->
