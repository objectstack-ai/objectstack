---
'@objectstack/spec': minor
---

A translated flow screen heading (`flows.<flow_name>.screens.<node_id>.title`) is judged by the same text-slot rule as the body text and the refusal message beside it. A single-brace `{token}` in it is refused when the bundle is parsed, with the `{{ }}` spelling of the token. An empty string is still accepted.

Clause-②: no (narrowing)

<!-- adr-0087: registered translation-flow-screen-title-text-slot-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** The flow engine picks three translated templates in the run's locale and renders each through the one text-slot renderer, the `{{ }}` dialect: a screen's heading (`title`), its body text (`description`) and a refusing `end` node's `message`. The body text and the message refused a single-brace token. The heading accepted it and drew it as literal text, so `title: 'Welcome, {name}'` showed `Welcome, {name}`, and nothing was reported when the bundle was validated, saved or parsed. An earlier entry in this release says a translated screen `title` is not judged by the text-slot rule yet; that describes the face before this change.

**What is refused.** A translated screen heading that the text-slot judge (`textSlotTemplateRefusal`) refuses: a single-brace `{token}`, and a `{{ }}` hole over a `$` name the flow engine does not bind. `TranslationDataSchema` and the `translation` metadata item refuse it at the key's path, with the words the source heading gets from `ScreenConfigSchema`.

**Unchanged.** A heading that keeps the `{{ }}` holes of the text it translates (`'欢迎,{{ record.name }}'`), plain text, and the empty string `os i18n extract` writes into a skeleton, which the engine still reads as no translation. The heading's address does not change, and it still covers the node label a screen with no `config.title` shows.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `title: 'Welcome, {name}'` | `title: 'Welcome, {{ name }}'` where the heading should show the value; `title: 'Welcome'` where the braces were never meant as a hole |

**The one-line fix: write each single-brace token in a translated screen heading as the `{{ }}` hole the refusal names.**

**Who is affected, measured.** In this repository at `86da194919`, four bundles carry a `screens` group (`examples/app-crm`, `examples/app-showcase`, and `examples/app-todo`'s `ja-JP` and `zh-CN`). They hold 8 translated screen headings, and the judge refuses none of them. The same instrument finds the single-brace `{count}` in `examples/app-crm`'s `crm.activity.due_today` message, which is its control. Deployed bundles and other repositories were not measured.

**The ledger.** The D3 semantic entry `translation-flow-screen-title-text-slot-refused` (protocol 18). There is no D2 conversion: a single-brace token in a translated heading has always drawn as literal text, so only the translator can say whether it was meant as a hole.
