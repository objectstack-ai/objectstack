---
'@objectstack/cli': patch
---

fix(cli): `os package publish` sends the manifest's listing `tags`, says `publisher` and `isStarter` are decided by the platform, and uses a top-level `tagline` only as a missing description

Clause-②: no
Metadata-protocol: none

The hosted publish route validates and stores a package's listing tags, so `os package publish` now carries them:

- **`tags`.** When `objectstack.manifest.json` declares `tags`, publish sends them as written. The hosted route owns the shape and the bounds and refuses a bad list with a 400, which publish prints as the server wrote it; the CLI applies no limit of its own. A file with no `tags` leaves the stored tags alone, and `"tags": []` clears them. The warning no longer names `tags`.
- **`publisher` and `isStarter`.** The warning now says the platform decides them and an author's value has no effect. Publish still never sends either.
- **Top-level `tagline`.** The hosted catalog has no tagline column; `description` is the short listing text. When neither `--description` nor the manifest's `description` is given, publish sends the tagline as the description. Otherwise it no longer sends the tagline, and a warning says so. A per-locale `translations.<locale>.tagline` is sent as before.
- **`preview` and `visibility`.** Unchanged: `preview` is still named as not carried by the hosted catalog yet, and `visibility` is still set only by `--visibility`.
