---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): edit an email template or a translation in the All metadata area, and customize a read-only package's one into its pair

Clause-②: no
Metadata-protocol: none

Until now an admin changed an email template or a translation in Setup, which writes a row bound to no package. Studio's All metadata area now opens both in a simplified form editor, and a change to an installed package's item is a declared override in the package's paired customization package (`<base>.custom`, ADR-0146 D2).

- **The editor.** In a package's All metadata area (`/studio/<package>/metadata/<type>/<name>`), an `email_template` or a `translation` opens the fields Setup's form offers, beside the type's preview (the sandboxed email preview, the translation coverage). Both are Setup's components, mounted, not copied: the form is the served schema, else the built-in fallback, as on the generic item page. The cross-package leg, the environment scope and `?review=1` keep opening the generic item page. Setup's pages are unchanged.
- **A writable package.** An edit saves that package's draft through the shared Studio autosave, with the same version pin as the pillars. The header's Publish puts it live.
- **A read-only package.** The editor offers Customize, the same control as a view, dashboard or report (the Interfaces pillar). The first saved edit calls the ensure door once and saves the draft into the pair it answers, declaring `overrides: { package, basedOn }`. The badge reads the served declaration. "Restore package original" in the ⋯ menu deletes the pair's draft, then its row. A walled caller sees Customize disabled, with the reason.
- **One email template locale at a time.** An email template is one item per `(name, locale)`. The editor opens the locale the list row names (`?member=`). It reads, saves, declares, badges and restores that locale alone, and keeps the locale out of the form, so an edit never lands in another locale. The other locales of the template are untouched. Before the first save on a read-only package, the editor says only that locale is customized.
- **A translation is replaced whole.** A translation's override is its whole locale bundle (ADR-0146 D2). Before the first save on a read-only package, the editor says so.
- **New strings.** `@object-ui/i18n`'s studio namespace gains three `engine.studio.area.formEditor.*` keys in `en` and `zh`. The other languages fall back to `en`, as the whole namespace does.
