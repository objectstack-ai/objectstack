---
'@objectstack/plugin-security': patch
---

Security refusals, explain details, field help and log lines no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings the security plugin shows to administrators, authors and operators pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- The curated capability-name refusal says a curated name is refused at authoring so that no admin-authored row can collide with the row the platform seeds for it.
- The two delegation anchor refusals say the business-unit anchor roots the delegate's business-unit visibility, so a delegation may only narrow it.
- The `managed_by` field help on `sys_permission_set` and `sys_position`, in every shipped locale, says capabilities, permission sets and positions all share one platform / package / admin vocabulary.
- The explain details for an unresolvable security posture and for the View/Modify All Data bypass drop their citations; those sentences already said that access fails closed and that the write path consults the same bypass.
- The derived-capability boot warning says the derivation refreshes a row's label and description only when it can prove the row is the platform's own, and that the seeder neither adopts a row it cannot prove is its own nor backfills provenance on the operator's behalf.
- The fail-closed log lines say what each denial protects: a `controlled_by_parent` child is readable and writable only where its master is, and a chain the derivation cannot resolve admits no child; only a resolved sharing allow (Modify All Data or an edit-level share) may replace the platform ownership floor; an authored-policy verdict that cannot be resolved never lifts the sharing refusal; a path that bypasses the engine middleware never runs without the owner and share scope a direct read applies; a delegated read is never scoped wider than its delegator's own; an unreadable posture never defaults to public or uncontracted.
- The public-form line says an anonymous submission cannot set ownership, tenancy or audit columns; the uninstall line says a package's permission rows are removed by `package_id`, so no grant outlives the package; the platform-owner wall-bypass line says only the declared platform owner's reads cross the wall and writes stay walled for everyone. The org-scoping entitlement, masking-rule, permission-set resolution, vocabulary-normalization and service-registration lines drop their citations, and the log lines that carried a tracker number in their `[security/…]` prefix now open with `[security]`.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix or prefix) needs the new spelling.
