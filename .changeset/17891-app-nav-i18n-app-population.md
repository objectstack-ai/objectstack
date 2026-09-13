---
'@objectstack/cli': patch
---

`check:app-nav-i18n` now judges the PLATFORM APPS' navigation — Setup **and Account** — instead of narrowing to `setup` at every site.

The gate is named "every id labelled in every locale" and was structurally blind to one whole app: it printed a byte-identical `OK (10 contributor(s), 54 merged setup nav id(s), 4 locale(s), …)` line before and after the Account app's contributed `nav_connect_agent` label landed, so nothing it printed could tell you it had skipped an app.

Six sites narrowed it, only three of which were the obvious filters:

- the contribution filter, the app-shell filter and the merged-app lookup;
- the **locale-file lookup** (`data.apps.<app>.navigation`) — widening the first three without this one yields a gate that collects `account` ids and then hunts for their labels under `apps.setup.navigation`;
- the **build prerequisite**, a package path hard-coded to `@objectstack/setup`;
- the **contributor roster**, which booted no package that registers the Account shell — so `account` had no merged app to judge at all.

Behaviour now:

- the population is declared with its criterion (an app is judged iff the ADR-0048 platform-app loop registers its shell by default **and** at least one package contributes navigation into it at runtime), which is why `studio` and `crm_app` are out;
- the per-contributor "landed at least one nav id" invariant is applied **per app**, never over a union across apps — a union would let a contributor serving two apps keep passing on one of them after the other silently stopped;
- every verdict, the refusal advisory and the pass line name the app they are actually about, and the pass line carries a per-app id count;
- `--self-test` gains negative controls for the union softening, for a verdict that names the wrong app subtree, and for a pass line that cannot notice an app leaving the population.

The `setup` judgement is unchanged: the same 54 merged ids, the same verdict, and the same count in the pass line.
