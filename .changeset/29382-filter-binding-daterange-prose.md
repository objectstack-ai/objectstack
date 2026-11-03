---
'@objectstack/lint': patch
---

docs(lint): the `dashboard-filter-binding-unknown` explanation no longer says a `dateRange` binding is always reported on a dashboard without `dateRange`

Clause-②: no
Metadata-protocol: none

`os explain dashboard-filter-binding-unknown` said a widget's `filterBindings.dateRange` key "on a dashboard that declares no `dateRange` is reported the same way". The rule never did that when the dashboard declares a `globalFilters` entry named `dateRange`: every `globalFilters` entry's name is a declared filter, so the key binds it and the rule accepts it, as the explanation's first paragraph already says. The sentence now reads that a `dateRange` key is reported only when the dashboard declares neither `dateRange` nor a `globalFilters` entry named `dateRange`. The rule's behaviour is unchanged; a new test pins the accepted case.
