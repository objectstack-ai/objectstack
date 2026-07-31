---
'@objectstack/spec': patch
---

The variant/doc gate's coverage matcher now recognises a YAML mapping line (`type: npm`), not only the quoted (`type: 'npm'`) and backticked (`` `npm` ``) forms.

Found by auditing the ledger's seven `generated-reference-only` exemptions — a class that does not say "this variant is un-authorable", only "nobody wrote a guide for it". One of the seven was not a doc gap at all: `protocol/objectui/widget-contract.mdx` has documented `inline` / `npm` / `remote` in a "Widget Source" section the whole time, in YAML examples the matcher could not see. That entry is now governed, so the page is under the ratchet. Two more (tenant isolation strategy, settings-manifest handler) were reclassified `not-authorable` — their own reasons already said `operator-set` and `consumed by Setup/Studio`. The remaining exemptions now state their gap plainly instead of pointing at the generated reference as if it settled the question; connector authentication is flagged as the one worth acting on, being tenant-authored (ADR-0097) with no hand-written connector guide anywhere in the repo.

The YAML form is anchored to a full line (trailing `# comment` allowed), so it stays as tight as the quoted form — a bare word in prose still does not count.
