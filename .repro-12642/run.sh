#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(git -C /home/user/objectstack-issue-12642 rev-parse --show-toplevel)"
SHARING_EN="$REPO_ROOT/packages/plugins/plugin-sharing/src/translations/en.objects.generated.ts"
PO_EN="$REPO_ROOT/packages/platform-objects/src/apps/translations/en.objects.generated.ts"

restore() {
  git -C "$REPO_ROOT" checkout HEAD -- "$SHARING_EN" "$PO_EN" 2>/dev/null || true
}
trap restore EXIT INT TERM

hash_head() { git -C "$REPO_ROOT" rev-parse "HEAD:${1#$REPO_ROOT/}"; }

for f in "$SHARING_EN" "$PO_EN"; do
  h="$(hash_head "$f")"
  if [ -z "$h" ]; then echo "FATAL: empty HEAD blob hash for $f" >&2; exit 1; fi
  echo "HEAD blob $f = $h"
done

echo
echo "##### ARM 0 — tree as committed (0 stale by construction) #####"
( cd "$REPO_ROOT" && npx tsx .repro-12642/probe.ts )

echo
echo "##### MUTATION — revise the SOURCE string behind each probed leaf #####"
# plugin-sharing: objects.sys_share_link.fields.token.label  "Token" -> "Share token"
before_old=$(grep -c 'label: "Token"' "$SHARING_EN")
perl -0pi -e 's/(token: \{\n        )label: "Token"/$1label: "Share token"/' "$SHARING_EN"
after_old=$(grep -c 'label: "Token"' "$SHARING_EN")
after_new=$(grep -c 'label: "Share token"' "$SHARING_EN")
echo "  plugin-sharing en: 'label: \"Token\"' ${before_old} -> ${after_old} ; 'label: \"Share token\"' -> ${after_new}"
if [ "$after_new" -lt 1 ] || [ "$after_old" -ge "$before_old" ]; then
  echo "  FATAL: mutation was a NO-OP on disk — reading aborted, nothing measured." >&2; exit 1
fi

# platform-objects control: ...provider.options.apple  "Apple" -> "Apple ID"
po_before=$(grep -c 'apple: "Apple"' "$PO_EN")
perl -0pi -e 's/apple: "Apple"/apple: "Apple ID"/' "$PO_EN"
po_after_old=$(grep -c 'apple: "Apple"' "$PO_EN")
po_after_new=$(grep -c 'apple: "Apple ID"' "$PO_EN")
echo "  platform-objects en: 'apple: \"Apple\"' ${po_before} -> ${po_after_old} ; 'apple: \"Apple ID\"' -> ${po_after_new}"
if [ "$po_after_new" -lt 1 ]; then
  echo "  FATAL: control mutation was a NO-OP on disk — nothing measured." >&2; exit 1
fi

echo
echo "##### ARM 1 — source revised underneath the recorded leaves #####"
( cd "$REPO_ROOT" && npx tsx .repro-12642/probe.ts )

echo
echo "##### RESTORE #####"
restore
trap - EXIT INT TERM
for f in "$SHARING_EN" "$PO_EN"; do
  cur="$(git -C "$REPO_ROOT" hash-object "$f")"
  head="$(hash_head "$f")"
  if [ -z "$cur" ] || [ -z "$head" ]; then echo "FATAL: empty hash on restore check for $f" >&2; exit 1; fi
  if [ "$cur" != "$head" ]; then echo "FATAL: restore did not return $f to HEAD ($cur != $head)" >&2; exit 1; fi
  echo "  restored OK, byte-identical to HEAD: $f"
done
git -C "$REPO_ROOT" diff HEAD --stat -- "$SHARING_EN" "$PO_EN" | sed 's/^/  git diff HEAD: /'
echo "  (empty diff above == restored)"
