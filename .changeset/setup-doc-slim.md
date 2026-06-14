---
"@objectstack/setup": patch
---

docs(setup): slim the Setup overview to the genuinely-invisible rules

Cut the textbook concept-restatement (permission-set vs role definitions) and
the repeated "see external docs" lines that duplicated what the Setup UI's own
Users/Roles/Permission-set screens already show. What remains is three short
bullets the screens *don't* reveal: a user is identity-not-access, permissions
are additive, and "can't see a record" is almost always sharing rather than
object permissions. EN + zh updated together. No behaviour change — content only.
