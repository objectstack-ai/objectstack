---
'@objectstack/objectql': patch
---

fix(objectql): a delete refused because its reference cleanup trips a traversing validation rule now says so, naming the delete, the cleared reference and the repair (#20006)

Clause-②: no

Deleting a record clears each `set_null` reference to it (the default for an optional `lookup`) with an UPDATE of every record that references it. That cleanup resolves no related record for a validation rule, so a `script` / `cross_field` rule on the referencing object that reads through a reference (`record.account.status`) cannot be evaluated there. It refuses the cleanup, and the delete with it. That refusal is unchanged: same `VALIDATION_FAILED` error, same `rule_violation` field error, same `constraint` (`reason: 'unevaluable'`, the fault, the missing key), and the same set of deletes refused.

What changes is the message. It used to be the generic one about the rule's own object: `The predicate reads 'status', which this object does not declare — fix the rule's condition, or declare the field.` Whoever deleted the record did not write that rule, and following the advice adds a bogus column to the wrong object. The message now names the blocked delete, the reference being cleared, the rule and its object, and the repairs:

```text
Cannot delete crm_account (acc_1): the delete clears `account` on the crm_deal records that reference it,
and validation rule 'closed_account_frozen' on crm_deal could not be evaluated on that write — it reads
'status' through `account`, and a rule is given no related record while a delete clears references.
Guard the rule on `account` being set: make it the `then` of a `conditional` rule whose `when` is
`record.account != null`. Or change `deleteBehavior` on crm_deal.account: 'cascade' deletes those records
with the crm_account, 'restrict' refuses the delete while they exist.
```

- **The guard** is offered only when the cleanup empties the reference, which is the only case where it skips the rule. It applies whether the rule reads through the cleared reference or through another one. The guarded rule is still judged on every write where the reference is set.
- **On a multi-value reference** the cleanup removes the deleted record and keeps the other members, so the guard would still run the rule. There, only `deleteBehavior` is offered.
- **Unchanged:** a rule whose fault is in its own columns, a rule that reads through no reference, and every write that is not a delete's reference cleanup keep today's text byte for byte.
