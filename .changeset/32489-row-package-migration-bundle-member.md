---
'@objectstack/metadata': patch
---

fix(metadata): `migrateDatabaseLoaderRowPackages` binds an unbound email template locale beside another locale's bound row

Clause-②: no
Metadata-protocol: none

The upgrade backfill that binds a `DatabaseLoader` row to the package its body names left a row unbound as `slot-taken` when its package already held a row of the same name. For `email_template`, whose one `(package, name)` slot holds a row per locale, that test ignored the locale: an unbound `fr-FR` row beside the package's bound `en-US` row of the same template was reported `slot-taken` and stayed unbound.

The test now keys a bundled type's slot by its member as well, read off the row's `bundle_member` column, else the locale its body declares (the canonical locale when it declares none), the way the store's unique key and `DatabaseLoader.save` read it. So the `fr-FR` row is bound. A row whose own locale's slot is already held is still left `slot-taken`, never bound beside it. Rows of every other type are tested as before. Run `migrateDatabaseLoaderRowPackages` again after upgrading to bind the rows an earlier run left.
