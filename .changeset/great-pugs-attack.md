---
'@objectstack/plugin-security': minor
---

Re-run the seed-ownership claim when the seed settles, and report whether each pass was final.

`claimSeedOwnership` was reached exactly once per database lifetime, on the pass that promotes the first platform admin, while the platform's own seeder was still writing in the background — an app bundle that overruns `OS_INLINE_SEED_BUDGET_MS` (default 8 s) continues past kernel start rather than block it. Registry order and seed order are unrelated, so every object whose rows landed after that walk stayed `owner_id IS NULL` permanently: nothing re-ran the claim. Ownerless rows are invisible to every `readScope: 'own'` grant, and under `public_read` they read fine and answer 403 on every write at `modifyAllRecords: false` — a granted permission that can never be exercised.

The claim now also runs on `app:seeded`, the published settle signal for that background continuation, against the same admin and with the same predicates — so it moves ownership for exactly the rows the promotion-time pass missed, and never for a row a human already owns.

Two additive keys support it, both optional: `bootstrapPlatformAdmin` reports `adminUserId` on the promotion path and on the `already_have_admin` short-circuit (so the re-run reads the one existing holder scan instead of a second copy of it), and both `bootstrapPlatformAdmin` and `claimSeedOwnership` accept a `seedSettlement` snapshot read through the `seed-settlement` contract. No existing key, argument or return shape changed.

Every claim pass now logs one line whether or not it claimed anything, and says whether its reading was final: a pass taken while a seed source is still writing is reported at `warn` as PROVISIONAL. Previously a pass that matched nothing logged nothing at all, so a boot that permanently orphaned rows and a boot with nothing to do produced identical evidence.
