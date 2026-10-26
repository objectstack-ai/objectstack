---
'@objectstack/formula': patch
'@objectstack/service-automation': patch
'@object-ui/core': patch
'@object-ui/react': patch
---

fix(formula,core,react): a template's formatter locale comes from a reserved context channel, so a root named `locale` is just a value, and the console passes the viewer's display locale

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped. What changes is which input sets the template dialect's formatter locale: the evaluate context's own `locale` field instead of a root named `locale`. A template that names a root `locale` keeps compiling and rendering; its hole still prints that value, only the number and date formatting no longer follows it. There is nothing for `objectstack migrate meta` to rewrite. The other categories are closed on facts: every package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no runtime interface, type or export is removed or narrowed: `EvalContext` gains an optional member and `fillTemplateHoles` an optional trailing argument (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

The `template` dialect's formatters (`number`, `currency`, `percent`, `date`, `datetime`) used to take their locale from `extra.locale`, the same bag a caller passes the template's roots in. A template's roots are author-visible values, so a bulk action param or a flow variable named `locale` silently set the locale of every formatted value in the sentence, and no caller ever passed the viewer's locale.

- **`@objectstack/formula`**: `EvalContext` gains `locale?: string`, a reserved channel like `timezone`. It is not bound as a variable, and the template engine reads its formatter locale from it alone, defaulting to `en-US` when unset or empty. `extra.locale` is no longer read.
- **`@objectstack/service-automation`**: a flow text slot's formatters render in `en-US`, and a flow variable named `locale` is a value like any other. The renderer's doc said the variable was also the formatters' locale; that line is gone.
- **`@object-ui/core`**: `fillTemplateHoles(source, roots, locale?)` passes `locale` on the engine's reserved channel, apart from the roots. `ActionRunner.setDisplayLocale(read)` installs where the runner reads the viewer's display locale; `confirmText` and `successMessage` templates format in it, and a `callContext` dispatch keeps it.
- **`@object-ui/react`**: `<ActionProvider>` and `useActionRunner` install `useDisplayLocale()` on the runner they build, read when a template is filled, so a locale switch reaches a runner built before it.

**BREAKING** (a narrowing) for a caller that set the formatter locale through a root: a template evaluated with `extra: { locale }` (or a flow variable named `locale`) now formats in `en-US` and prints the value only where a hole names it. None was found in this repository: the one test that did so now passes `locale` on the context. What to do: pass the locale as the evaluate context's `locale` (`templateEngine.evaluate(expr, { extra: roots, locale })`), or as `fillTemplateHoles`'s third argument.
