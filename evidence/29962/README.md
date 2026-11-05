# Evidence for objectstack#29962 (removed in the next commit, never merged)

- Stack: `examples/app-showcase` with `showcase-rig.patch` applied (the project object named by a formula
  `label(record.status) + ' · ' + record.name`), `os dev --seed-admin` on its own port, and the Console dev server
  (`ui/apps/console`, sources aliased) proxied to it.
- Writer: a project created (`planned`) and moved to `active` through REST with `Accept-Language: zh-CN`.
  `sys_activity` stored `record_label` `计划中 · Atlas Rollout` and `进行中 · Atlas Rollout`.
- Reader: the record page in an en-US browser (`shot.cjs`), heading `Active · Atlas Rollout`.
- `before-en-US.png`: this branch with the timeline wiring ablated (`scripts/ablation-replace.mjs --hold`), the
  behaviour of main: `Created Project "计划中 · Atlas Rollout"`, `Updated Project "进行中 · Atlas Rollout": Status`.
- `after-en-US.png`: this branch: `Created Project "Active · Atlas Rollout"`, `Updated Project "Active · Atlas Rollout": Status`.
