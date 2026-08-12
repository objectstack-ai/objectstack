---
"@objectstack/platform-objects": patch
---

fix(platform-objects): one decision, one dialog — carry identity confirm questions on `description` (#7309)

The shared console action runner chains confirmation **then** param collection,
both awaited (objectui `packages/core/src/actions/ActionRunner.ts`). An action
declaring `confirmText` **and** `params` therefore opened **two** sequential
dialogs for one click, with nothing sent until the second — while the first
already read as "the action ran".

The maintainer's 2026-08-10 ruling on #7278 (shipped in PR #7592) is to carry the
confirm question in the action's top-level `description` (#7367), which the param
dialog renders under its title, and to drop `confirmText`. #7278 applied it to the
two `plugin-approvals` actions; this change sweeps the **14** remaining in-repo
action sites, all in `identity/`:

| object | actions |
|---|---|
| `sys_user` | `ban_user`, `delete_my_account`, `disable_two_factor`, `generate_backup_codes` |
| `sys_oauth_application` | `enable_oauth_application`, `disable_oauth_application`, `rotate_client_secret`, `delete_oauth_application` |
| `sys_two_factor` | `disable_two_factor`, `regenerate_backup_codes` |
| `sys_account` | `unlink_account` |
| `sys_organization` | `change_slug` |
| `sys_sso_provider` | `delete_sso_provider` |
| `sys_team_member` | `remove_team_member` |

**No warning was reworded and none was dropped** — each question moves verbatim
from `confirmText` to `description`, so the user still reads it before committing,
now in the one dialog that collects the params. `sys_oauth_application.rotate_client_secret`
went from three dialogs to two: one param dialog (question + `client_id`), then the
existing post-run `resultDialog` that reveals the new secret. That reveal is output
shown once *after* the rotation, not a second pre-run decision, so it stays.

**`confirmText` is untouched where it is still correct.** A param-LESS action has
no param dialog to fold the question into, so the confirm *is* its only dialog —
`delete_organization`, `leave_organization` and `impersonate_user` keep theirs.

The `en` / `zh-CN` / `ja-JP` / `es-ES` bundles move the same 14 leaves by hand.
`os i18n extract` treats a renamed key as a new gap and this repo extracts with
`--fill=default`, which would have seeded English over the curated translations
in three of the four shipped locales — invisible to `check:i18n`, whose fresh
extract would agree with the English it just wrote. A carryover test pins each
locale as translated rather than echoing the English source.

Tests pin the user-visible consequence in both directions: that an action
carrying params opens one dialog, **and** that its question is still shown.
Deleting a warning instead of moving it goes red on `ban_user`,
`delete_my_account` and `rotate_client_secret` — the failure a "no `confirmText`
anywhere" grep cannot see.
