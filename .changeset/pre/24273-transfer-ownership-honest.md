---
'@objectstack/platform-objects': patch
---

fix(platform-objects): `sys_member`'s `transfer_ownership` row action says the selected member becomes an owner and the caller keeps their role

The action sends better-auth's `POST /organization/update-member-role` with `role: 'owner'`. That endpoint writes the selected member's role and nothing else, so the caller stays an owner and the organization ends with two. The action's confirm used to promise "You will be demoted to admin and lose owner-only privileges"; nobody was demoted.

The copy now says what happens, in all four locales:

- label: FROM "Transfer Ownership" TO "Make Owner";
- confirm: the selected member becomes an owner with every owner privilege, the caller stays an owner, and to step down the caller uses Change Role on their own membership;
- success message: FROM "Ownership transferred" TO "Member is now an owner".

To hand ownership over, run Make Owner on the new owner's row, then Change Role on your own row to `admin`. better-auth refuses that second step only while you are the organization's last owner (`YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER`).

The action's `name`, `target`, request body, parameters, `requiresMembershipReach` and `variant` are unchanged, so a page or test that names `transfer_ownership` keeps working. A test that expected the caller to be `admin` after the action expected a demotion the endpoint never performed: it now reads `owner`, and reads `admin` only after the caller's own Change Role.

Clause-②: no (provisional: copy only; if the measurement forces another shape, the dev reports before building it; owes the seat's review of record at `TIER_DEFAULT` before the queue)
