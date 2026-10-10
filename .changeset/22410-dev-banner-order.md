---
'@objectstack/cli': patch
---

fix(cli): `os dev` prints the server's ready banner whole, then the MCP connect block whole, instead of interleaving the two (#22410)

Clause-②: no

- **What a terminal showed.** `os dev` is two processes writing one terminal. The parent prints the MCP connect block (`🤖 MCP server — connect a coding agent:` with its Endpoint, Skill, Connect and Disable rows) when the `serve` child sends `objectstack:listening`, and the child sent that message before it printed its ready banner. Measured under a pty on the Build-with-Claude-Code tutorial project, 6 of 7 boots printed the block above or inside the banner. In 2 of them, banner lines landed between the block's rows, in one case the `➜ Console:` and `➜ MCP:` rows. A setup boot before those seven printed the `🔑 Dev admin` credential lines and the whole plugin section between `Skill` and `Connect`.
- **What changed.** The child now sends `objectstack:listening` after its ready banner and boot diagnostics have printed. The parent prints the block on that message, so it always comes last, under the banner's `Press Ctrl+C to stop` row. The order follows from the sequence itself, with no timer: the banner is written to the terminal before the message is sent. After the change, every measured boot printed the banner whole and then the block whole.
- **What did not change.** The message is still `{ type: 'objectstack:listening', port, url }`, carrying the port actually bound. The runtime state file is still written before either announcement, and `objectstack:seed-settled` still follows `objectstack:listening`. A program that spawns `os serve` with an IPC channel receives `objectstack:listening` slightly later than before: after the banner has printed instead of before.
