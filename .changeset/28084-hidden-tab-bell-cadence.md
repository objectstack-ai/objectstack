---
'@object-ui/app-shell': patch
---

perf(console): a background tab checks the bell and the approvals badge every three minutes instead of every minute

Clause-②: no
Metadata-protocol: none

Since the bell's foreground poll moved to once a minute, a hidden console tab polled just as often as a visible one for its first ten minutes. A hidden tab now polls every three minutes (the foreground tick already armed when the tab hides still fires once), still stops polling altogether after ten hidden minutes, and reads each feed once, at once, when the user comes back. A desktop notification for a new inbox message in a background tab can now arrive up to about three minutes late instead of one.
