---
'@objectstack/scenarios': patch
---

fix(scenarios): the runner's card seed and restore load under the default seed mode, not the retired `insert`

The scenario runner wrote every card seed (and every restore of a removed seeded row) as a data-only package whose datasets declared `mode: 'insert'`. That mode is retired (#34613), and the managed install door refuses a dataset declaring it, every row of it, so no card seed loaded. The datasets now name no `mode`: the default, `ignore`, creates each row whose `id` the object does not hold and leaves one it holds as it is, which is what a fresh seed and a restore need. The test double's seed door now judges `mode` with `SeedMode`, as the real door does, and a pin holds that the seed and restore packages carry no retired mode.
