---
'@object-ui/app-shell': patch
---

fix(console): a refused metadata save draws its causes under the rows of the view, object and other curated designers

Clause-②: no
Metadata-protocol: none

After a refused save, a metadata type edited in a curated designer panel (view, object, dataset, action, hook, dashboard, page, report) drew the cause under no field: the panel was never handed the save's issues, so only the Save button's reason (and, where the editor runs a live check, the summary banner) named them. A view refused at `label.not_a_locale` or at `config.columns.0` lit no row in the view designer.

The panels now draw each cause under the row that edits its path, with the same placement the generic form uses:

- the view designer draws `label.*` under Label, `config.columns.*` under Columns, and a cause in the view body under the body form's row (`config.description` under Description);
- the object designer draws a cause under Name, Label, Plural label, Icon, Description, Access or Required permissions; the dataset designer under Name, Label, Description, Base object, Included relationships, Scope filter, Dimensions or Measures;
- the action, hook, dashboard, page and report panels draw a cause under the row of their "More fields" form, nested causes included.

One mistake is still one message: the summary banner and the refusal line leave out exactly the causes a row draws. A cause under a key no row renders (`config.zz_unknown`, an object's `fields.*`) stays in the banner. The register a panel reports now names path prefixes, so a form over the view body counts as drawing `config.description`, never every `config.*` cause.

`MetadataDefaultInspectorProps` gains three optional props (`issues`, `revealIssues`, `onInlineIssueFieldsChange`); a host that passes none gets the panel it got before. No locale keys change.
