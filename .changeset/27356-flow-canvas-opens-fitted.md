---
'@object-ui/app-shell': patch
---

fix(flow designer): a flow wider than the canvas opens zoomed out to fit its width

Clause-②: no
Metadata-protocol: none

The flow canvas opened every flow at 100%, centred. On a narrow canvas, such as Studio's Automations pillar at phone width, a branching flow's outer branches were cut off at both edges until the author pressed fit-to-view. Now a diagram wider than the canvas opens zoomed out until its width fits (never below the canvas's 40% floor), still centred. A diagram that already fits opens at 100% as before. The canvas never zooms in when it opens, and only width counts, so a tall linear flow still opens at 1:1. Zoom, fit-to-view and the re-fit on a canvas width change are unchanged.
