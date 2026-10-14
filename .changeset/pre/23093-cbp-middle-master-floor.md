---
'@objectstack/plugin-security': patch
---

A `controlled_by_parent` master that is itself a detail decides who may write its details the way its own record update is decided: whoever can edit a quote can edit its lines

Clause-②: no

In a two-level master-detail chain (a quote line under a quote under an account, every level below the account `controlled_by_parent`), one person got two answers about the same quote. An organization member who could edit a quote they had not created was allowed to update the quote itself, but every insert, update and delete of its lines was refused `403 PERMISSION_DENIED` ("requires edit access to its master record … not editable by this user (row-level security)"). Only the quote's creator could change its lines. The quote's own update hands the platform's creator-only floor (`owner_only_writes`, positions `['org_member']`) to the master-detail write check, by the 2026-08-15 ruling; the check that a line write runs on the quote kept that floor.

Now the line write asks the same question the quote's own update asks. By the maintainer's ruling (letter A), a line write under a middle master is admitted exactly when the same person may update that middle master directly:

- **Admitted now:** an organization member who can update the quote (and the account above it) may insert, update and delete its lines, whoever created the quote.
- **Still refused:** the account above is not editable or not readable; the quote is not editable through its object permission; or an app-authored update rule on the quote refuses the person.
- **Also refused now:** the quote's creator, writing the lines of a quote that an app-authored update rule refuses them. The quote's own update already refused them. The line write had admitted them, because the floor and the app's rule each admitted a row on its own.
- **Unchanged:** a write made on behalf of another user keeps both principals' floors at every level. A master that governs its own rows, a single-level detail, the cycle guard and the depth bound are untouched.

`security/explain` and the parent gates of `sys_attachment` and `sys_comment` ask the same check, so they give the same answers.
