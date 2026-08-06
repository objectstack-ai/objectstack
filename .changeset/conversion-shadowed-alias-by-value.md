---
"@objectstack/spec": patch
---

fix(spec): an ADR-0087 rename resolves a shadowed alias by VALUE, instead of always leaving it behind (#4923)

Every ADR-0087 D2 conversion that renames a key (`renameKey` /
`renameConfigKey`, so `object` → `objectName`, `filters` → `filter`,
`flow` → `flowName`, the four `notify` aliases, `description` → `subtitle`,
the datasource driver-config aliases, …) used to do **nothing at all** when the
canonical key was already present. The retired spelling then stayed in the
converted metadata forever — the conversion had not finished converting.

That was invisible while flow-node config contracts were `.strip`: the dead key
was silently dropped at the execute-time parse and the node ran. Once #4001 批 9
made those contracts strict it stopped being invisible — a stored `subflow`
carrying `{ flowName, flow }` loads today and would be refused at execute time
as a guard failure (not routable through a `fault` edge).

**What changes.** A rename that meets both spellings now splits on whether the
two values actually disagree:

- **Same value** (structural equality, so two separately-authored
  `{ status: 'stale' }` filters count as one declaration) → the alias carries
  nothing the canonical key does not, so it is **deleted** and the conversion
  emits its usual notice. Lossless hygiene, and it makes the transform
  idempotent in both shape and notices.
- **Different values** → **both keys are kept** and no notice is emitted. Two
  spellings holding two different values is genuine author ambiguity, and an
  upgrade tool that silently picked the canonical one would be editing a
  configuration the customer never agreed to. The surviving pair is what lets
  the strict node-config gates refuse with a prescription that **names both
  keys** and asks for a decision.

`notify`'s nested `source: { object, id }` lift follows the same rule: a part
that repeats its flat counterpart is redundant and `source` is dropped, while a
part that disagrees leaves the node **entirely** untouched so `source` reaches
the strict contract intact. (The `wait` node's loose-key lift is deliberately
NOT covered — it moves keys between two locations rather than resolving two
spellings of one slot.)

**What an author sees.** Metadata that named one slot twice with the same value
loses the retired spelling at load and gains one deprecation notice per removal
— the same notice a plain rename already emitted, so `objectstack validate`
output is unchanged in kind. Metadata that named one slot twice with *different*
values is unchanged by the conversion and is now refused by the strict
node-config contracts with a message naming both keys; the fix is to decide
which value is right, put it on the canonical key, and delete the alias. The
batch-9 prescriptions were reworded accordingly: they no longer say the
surviving twin is "dead" (true only under the old rule), because a key that now
reaches that parse holds a value the canonical key does not.
