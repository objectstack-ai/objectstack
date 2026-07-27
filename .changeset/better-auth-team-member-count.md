---
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
---

fix(auth): provision the better-auth 1.7 columns `sys_team` / `sys_team_member` / `sys_two_factor` were missing (#3624)

better-auth 1.7.0-rc.1 added fields to three models that the platform objects
never provisioned and `auth-schema-config.ts` never mapped. Because an unmapped
field keeps its camelCase name, the adapter emitted columns no table had:

| model | field | column now provisioned |
|:---|:---|:---|
| `team` | `memberCount` | `sys_team.member_count` |
| `teamMember` | `membershipKey` | `sys_team_member.membership_key` |
| `twoFactor` | `failedVerificationCount` / `lockedUntil` | `sys_two_factor.failed_verification_count` / `locked_until` |

The team pair broke org creation outright. The organization plugin's team
sub-feature is on by default, so `POST /api/v1/auth/organization/create`
auto-creates a default team — and that insert died with `table sys_team has no
column named memberCount` *after* the organization row had already committed.
Callers got an HTTP 500 on top of a half-created org: a real org row with no
default team behind it. Every multi-org deployment's create-org flow hit this.

The two-factor pair broke the 2FA lockout path the same way: better-auth
guard-increments `failedVerificationCount` on each wrong code and stamps
`lockedUntil` past the threshold, so a wrong code 500'd instead of being
counted. All four columns are better-auth's own state — provisioned, readable,
and never written from the ObjectStack side.

Existing environments pick the columns up through the driver's additive schema
sync; no data migration is needed. `member_count` backfills to 0 and
better-auth's own `syncTeamMemberCount` reconciles it on the next membership
change, and `membership_key` stays null on pre-upgrade rows, which better-auth
tolerates by falling back to the `(team_id, user_id)` pair.

A new drift gate (`better-auth-schema-parity.test.ts`) now asserts that every
column the installed better-auth version can write exists on the platform
object backing it, across the auth manager's whole model surface. The ADR-0092
D7 guard only ever caught *collisions* between our extension fields and
better-auth's, so a bump that adds a brand-new field passed the build and failed
at runtime — twice now, counting the 1.7 `oauthAccessToken.authorizationCodeId`
regression. The next one fails the build instead.
