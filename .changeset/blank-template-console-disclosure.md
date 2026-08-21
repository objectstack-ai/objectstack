---
"create-objectstack": patch
---

Tell a newcomer that the `blank` starter ships no app, so an empty Console
reads as the intended starting point rather than a broken install (#10317).

Measured on a real scaffold-and-boot (`create-objectstack my-app -t blank`,
published 17.1.0 packages, `objectstack dev --ui`): `GET /api/v1/meta/app`
returns the two platform apps (Setup, Account) and nothing of the project's
own, while `GET /api/v1/data/my_app_note` serves the scaffolded object the
whole time. The template ships `src/objects/` only — deliberately, as every
scaffolder template in this repo does — but nothing the newcomer could reach
said so, and `pnpm dev` advertises the Console URL on every boot.

Documentation only: a new "The Console" section in the generated `README.md`
naming the Console path, the consequence, and `src/apps/*.app.ts` as the
remedy. No change to what the scaffolder writes into `src/`.
