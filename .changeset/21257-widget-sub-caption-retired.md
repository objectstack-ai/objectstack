---
'@objectstack/spec': minor
'@objectstack/sdui-parser': minor
'@objectstack/lint': minor
---

The metric sub-caption is retired at both ends. A dashboard widget keeps one authored description, `widget.description`, which renders as the card-header subtitle and is translated by the widget's `description` translation key. The widget translation key `subCaption` is refused, and the server no longer writes a widget's `options.description`.

Clause-②: no (narrowing)

<!-- adr-0087: registered translation-widget-sub-caption-removed, translation-widget-sub-caption-retired -->

**What is retired.** `dashboards.DASHBOARD.widgets.WIDGET.subCaption` in a translation bundle (`defineTranslationBundle`, `stack.translations`, the platform bundle) and in a registered `translation` item. It overlaid a caption under a metric's value onto the widget's `options.description`. The dashboard schema never declared `options.description`, and no authored widget wrote it, so `translateDashboard`'s overlay was the key's only writer. That overlay is removed: `translateDashboard` now translates a widget's `title` and `description` and carries `options` through untouched.

**BREAKING** — an accept-set narrowing, shipped as `minor` under the launch-window convention.

### FROM → TO

| wrote | write instead |
| --- | --- |
| `dashboards.DASHBOARD.widgets.WIDGET.subCaption: 'TEXT'` | delete the entry. If the copy belongs on the card, put it in the widget's `description` and translate it under `dashboards.DASHBOARD.widgets.WIDGET.description`. |
| `dashboards.DASHBOARD.widgets.WIDGET.subtitle: 'TEXT'` | `subtitle` was only ever a rename suggestion for `subCaption`. Card-header copy goes under `description`; a caption under the value has nowhere to render, so delete it. |

**The one-line fix: delete every `subCaption:` entry under `dashboards.*.widgets.*` in your translation bundles.** `os migrate meta --from 17` lists the mechanical edits for existing sources; stored `translation` items are converted when they are read.

**What an author now sees.** Writing `subCaption` fails `tsc` (its input type is the retired-key mark) and fails the parse with a prescription naming the widget's `description`. Writing `subtitle` on a widget translation fails the parse with both readings named, instead of a rename suggestion onto a key that is refused next. `os validate`, `os build` and `os lint` now raise the `unconsumed-widget-option` warning on an authored widget `options.description`, like any other options key the dataset-bound render path does not read. It is a warning, so none of the three fails on it.

**Measured producers: none.** Zero `subCaption` entries and zero authored widget `options.description` in the four example apps (`app-crm`, `app-todo`, `app-showcase`, `app-multi-package`) and in the bundles `@objectstack/platform-objects` ships, so no shipped exit code changes.

### The retirement kit

- **Tombstone.** `subCaption` is a `retiredKey()` tombstone on the widget translation node, so the refusal carries the prescription on all three faces the node is spread into (per-app bundle entry, platform bundle entry, `translation` item). The node sits under two records (`dashboards`, `widgets`), below the authorable-surface walk, so it has no `RETIRED_KEYS_BY_MAJOR` row, the same as the `submitLabel` component-copy key before it.
- **The former alias.** The `subtitle` → `subCaption` rename suggestion moves to the node's `guidance` table. An alias whose target is a tombstone is the shape the alias-integrity audit refuses, and repointing it at `description` would silently change what the word is taken to mean.
- **Conversion.** `translation-widget-sub-caption-removed` (protocol 18) strips the key from bundle entries and bare translation items as a lossless delete. It is retired from the load path, so authors are refused at parse while stored rows and `os migrate meta` replay it. Its D3 record is the semantic entry `translation-widget-sub-caption-retired`.
- **`@objectstack/sdui-parser`.** `CONSUMED_WIDGET_OPTION_KEYS` drops `description`, its one undeclared member, which existed only because the overlay wrote it. `check:widget-option-census`'s `NON_DECLARED_MEMBERS` ledger is now empty, so the census asserts that nothing writes an undeclared key into `options`.
