---
'@objectstack/plugin-security': patch
---

Remove seven dead `{ records }` union-normalizer limbs on engine `find()` results, and repair the one that was silently dropping instead of gapping.

Six seams in this plugin normalized an engine read as `Array.isArray(x) ? x : x.records`. The envelope limb was unreachable: `ObjectQL.find` resolves a bare array of row objects, measured by booting a real engine over a real `SqlDriver` and driving each seam through the shipped function that owns it, rather than inferred from `IDataEngine.find`'s declared `Promise<any[]>` (a declared type is not proof — this repo also has a `find()` that resolves an envelope). Each seam keeps its existing disposition for a non-array; only the dead limb is gone.

The seventh is repaired in the opposite direction. `SecurityPlugin`'s `sys_permission_set` loader mapped three different facts onto one value: a read that succeeded on an empty catalog, a read that threw, and a read that resolved something it could not read all left as `[]`. On the enforcement plane that silently withdraws grants that exist while every request still looks normal, and it made `PermissionEvaluator`'s existing "db lookup failed" warning unreachable — so a transient database error and an empty catalog produced identical, undiagnosable 403s. The loader now lets the read fault propagate and refuses an unreadable result with `DATABASE_ERROR`. Enforcement is unchanged in both directions: an unanswered read still grants nothing. What changes is that it is now reported instead of silent.
