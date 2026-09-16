// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'platform-timezone-columns-iana-domain-refused',
  surface:
    'The two platform audit time-zone columns — `sys_job.timezone` and '
    + '`sys_report_schedule.timezone` — carrying a string that is not a member of the '
    + 'IANA time-zone database (`Asia/Shangai`, `Europe/Munich`, `UTC+8`, `PST`).',
  replacement:
    'The canonical IANA zone id the deployment meant, written in the spelling the tzdb '
    + 'uses: `Asia/Shanghai`, `Europe/Berlin`, `America/Los_Angeles`. `UTC` is a member '
    + 'and is admitted — membership is the shared `Intl.DateTimeFormat` probe, never the '
    + '`Intl.supportedValuesOf(\'timeZone\')` enumeration, which omits `UTC` and would '
    + 'refuse the one fallback this contract names. ⚠️ A non-member is RE-AUTHORED, never '
    + 'repaired on the deployment\'s behalf: the correct zone behind a typo is a fact only '
    + 'the deployment holds, which is what makes this entry semantic rather than a D2 '
    + 'conversion.',
  reason:
    '#16296 gave both columns `valueDomain: \'iana_time_zone\'`, which had been declared '
    + 'on `sys_business_unit.timezone` / `sys_organization.timezone` since #14238. It is a '
    + 'WRITE-TIME narrowing of the `min`/`max`/`maxLength` transition-gate class: a value '
    + 'already stored outside the domain is never re-read against it, no DDL is planned, '
    + 'and `objectstack migrate meta` has nothing to rewrite — the changeset that shipped '
    + 'it says so in those words, and this entry does not contradict it. What the '
    + 'changeset had no way to carry is that a deployment holding such a value now has '
    + 'WORK TO DO: the next write of that row is refused with the ADR-0114 field code '
    + '`value_domain`, and until then `sys_report_schedule.timezone` keeps doing the thing '
    + 'the narrowing exists to stop — `ReportService.nextRunAt` hands a non-member zone to '
    + 'croner, whose throw was caught and turned into a silent fall back to '
    + '`interval_minutes`, so "every weekday 09:00 Asia/Shanghai" became "every 1440 '
    + 'minutes, forever". Not a throw and not a fall back to UTC: the wrong instant, '
    + 'permanently. ⛔ It went out with NO `**BREAKING**` marker, so the repo\'s own '
    + 'breaking-change detector classified it non-breaking and asked for no ADR-0087 '
    + 'disposition at all — measured on the shipped changeset. #16421 closed that hole '
    + '(the declaration now carries a `(narrowing)` arm the gate reads instead of a prose '
    + 'banner) and this row is the other half of the same ruling: the narrowing that '
    + 'already shipped is RECORDED, ⛔ not re-released and ⛔ not ratified in silence. '
    + 'Maintainer ruling, director summon #17, decision batch #2 item 1, option B '
    + '(objectstack#16421 comment 5572145955, 2026-09-07), verbatim and untranslated: 「同意」. The direct precedents for registering a change '
    + 'no transform can apply are `schedule-flow-acting-organization-required` (protocol '
    + '18) and `rest-requireauth-default-flip` (protocol 12) — behaviour-only, a '
    + 'deployment judgement, registered anyway because the prescription is real.',
  acceptanceCriteria:
    'Every `sys_job.timezone` and `sys_report_schedule.timezone` value stored in the '
    + 'deployment is an IANA member. The one-line fix per offending row: write the '
    + 'canonical zone id (`UPDATE … SET timezone = \'Asia/Shanghai\'`), or clear the '
    + 'column — `sys_report_schedule` documents a `UTC` default and `sys_job` has no '
    + 'reader at all. Rows already holding a member parse and behave byte-identically to '
    + 'before; rows holding none are readable, are returned unchanged, and fail only on '
    + 'their next WRITE. A report schedule that was silently running on '
    + '`interval_minutes` resumes its cron cadence once its zone is a member — that '
    + 'resumption, not the absence of an error, is how the fix is verified. ⚠️ The two '
    + 'columns\' `maxLength` (100 vs 64) and defaults (none vs `UTC`) are deliberately '
    + 'still unconverged and are NOT part of this entry; no member is longer than 32 '
    + 'characters on the current Node baseline, so neither bound admits anything the '
    + 'domain does not.',
};
