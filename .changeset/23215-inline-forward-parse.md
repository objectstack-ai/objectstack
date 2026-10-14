---
'@objectstack/service-mailbox': minor
---

Inbound mail reads a forward quoted inline in the body: a message an organization user forwards inline from Gmail, Outlook or Apple Mail now associates with the records its original participants match

Clause-②: no

- **What is read.** The "Forwarded message" block each of the three clients writes into the text/plain body, with its English labels: Gmail's `---------- Forwarded message ---------` block (From, Date, Subject, To, Cc), the block Outlook on the web and Microsoft 365 write under a line of 32 underscores (From, Sent, To, Cc, Subject), and Apple Mail's `Begin forwarded message:` block (From, Subject, Date, To, Cc, Reply-To). Its From, Reply-To, To and Cc addresses join the participant set in `match_addresses` under the source `inline`, after the outer and attachment entries. `rematch` replays them with the rest of the stored set and never reads the body again.
- **Only an organization user's forward is read.** The block is read only when the message's From names one address and that address is the email of a user (`sys_user`, ASCII case-insensitive) who is a member (`sys_member`) of the mailbox's organization. A forward from anyone else, a member of another organization included, is matched on its own headers only. Where the identity objects are not registered (no auth plugin is composed), no inline forward is read, and the first message that carries one says so in the log.
- **An unrecognised block pools.** A block the parser does not recognise is not guessed at: labels of another client or locale (Gmail in German writes `Von:`), a header line wrapped onto two lines, a block with no date line, a forward quoted by a reply, or a message with an HTML body only. The message is matched on its other participants, so a forward whose only match was in the block waits in the pool. Only the first block in the body is read; a forward quoted inside that forward is not.
