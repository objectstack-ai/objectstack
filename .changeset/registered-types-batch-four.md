---
'@objectstack/spec': minor
---

Six more registered metadata types reject unknown keys — `report`, `dataset`, `email_template`, `skill`, `job`, `book` — and `skill`'s silently-stripped `permissions` key now says where the real gate lives.

Mechanical work on the registered-type line, using `strictObject`. Each conversion is one call plus the aliases that fit that surface's vocabulary (`sections`/`chapters`/`toc` → `groups` on a book, `cron`/`interval` → `schedule` on a job, `title`/`content`/`html` → `subject`/`body` on an email template).

**One of them was a silent permission gate, which is the class this campaign cares most about.** `skill` accepted a `permissions` key and dropped it — skill invocation was never permission-gated. An author who wrote it believed they had restricted who could invoke the skill, and had not. A test even pinned that strip as correct behaviour, with a comment explaining the right answer (gate at the AGENT via `access` / `permissions`, enforced since #1884) — but that comment was only visible to someone reading the test file, never to the author who got it wrong. The rejection now carries the prescription, and the test asserts the rejection.

Same shape as `visibleWhen` → `visible` in #3746: the most valuable entry in an alias table is rarely a typo, it is a key that reads as a security control and silently is not one.

Registered types closed at the top level: **16 of 25**, up from 9 when this line started. Still open: `action`, `agent`, `dashboard`, `field`, `mapping`, `page`, `translation`, `view`.

The unknown-key warning layer's covered population drops from 12 roots to 6 as a result, which is the campaign succeeding rather than coverage rotting — the parse takes over where the lint used to warn. Nested strip sites under a closed root still report, unchanged.
