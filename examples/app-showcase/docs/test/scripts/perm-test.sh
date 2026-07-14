#!/bin/bash
# ADR-0090 permission-model live test against app-showcase (port 3777)
# v2: fixed expectations (201 accepted, C5 redesigned, jq null guards, J6 create-then-delete)
set -u
API=http://localhost:3777/api/v1
PASSWD='Passw0rd!234'
PASS=0; FAIL=0; RESULTS=""

token() { curl -s -X POST $API/auth/sign-in/email -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"${2:-$PASSWD}\"}" | jq -r '.token // empty'; }

# req METHOD path token [json] -> sets CODE, BODY
req() {
  local m=$1 p=$2 t=$3 d="${4:-}"
  local args=(-s -X "$m" "$API$p" -w '\n%{http_code}')
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && args+=(-H 'Content-Type: application/json' -d "$d")
  local out; out=$(curl "${args[@]}")
  CODE=$(echo "$out" | tail -1)
  BODY=$(echo "$out" | sed '$d')
}

check() { # id desc cond detail
  if [ "$3" = "1" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS
PASS  $1  $2"; else FAIL=$((FAIL+1)); RESULTS="$RESULTS
FAIL  $1  $2 -- $4"; fi
}

ok2xx() { if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then echo 1; else echo 0; fi; }
is403() { if [ "$CODE" = "403" ]; then echo 1; else echo 0; fi; }
is4xx() { case "$CODE" in 4*) echo 1;; *) echo 0;; esac; }

echo "== login all =="
ADMIN=$(token admin@objectos.ai admin123)
ADA=$(token ada@example.com); MIA=$(token mia@example.com); MAX=$(token max@example.com)
AUDREY=$(token audrey@example.com); OSKAR=$(token oskar@example.com)
DANA=$(token dana@example.com); WES=$(token wes@example.com); NEWBIE=$(token newbie@example.com)
for v in ADMIN ADA MIA MAX AUDREY OSKAR DANA WES NEWBIE; do
  eval "t=\$$v"; [ -z "$t" ] && echo "LOGIN FAIL: $v" && exit 1
done
echo "all tokens ok"

req GET "/data/sys_user?limit=50" "$ADMIN"
uid() { echo "$BODY" | jq -r ".records[] | select(.email==\"$1\") | .id" | head -1; }
U_ADA=$(uid ada@example.com); U_WES=$(uid wes@example.com); U_DANA=$(uid dana@example.com)
U_MIA=$(uid mia@example.com); U_MAX=$(uid max@example.com); U_ADMIN=$(uid admin@objectos.ai)

########## A. capability gate ##########
req POST /data/showcase_project "$ADA" '{"name":"perm-test-proj"}'
check A1 "ada create project denied (no allowCreate)" $(is403) "code=$CODE"

req GET "/data/showcase_project?limit=50" "$ADA"
PROJ_ID=$(echo "$BODY" | jq -r '(.records // [])[] | select(.name=="Website Relaunch") | .id' | head -1)
PROJ_AUDIT=$(echo "$BODY" | jq -r '(.records // [])[] | select(.name | test("Compliance")) | .id' | head -1)

req POST /data/showcase_task "$ADA" "{\"title\":\"perm-test-task-ada\",\"project\":\"$PROJ_ID\",\"status\":\"todo\",\"assignee\":\"ada@example.com\"}"
TASK_ADA=$(echo "$BODY" | jq -r '.id // empty')
check A2 "ada create task allowed (2xx)" $(ok2xx) "code=$CODE body=$(echo $BODY|head -c150)"

req GET "/data/showcase_product?limit=5" "$ADA"
check A3 "ada read product via everyone baseline (union)" $(ok2xx) "code=$CODE"

if [ -n "$TASK_ADA" ]; then
  req DELETE "/data/showcase_task/$TASK_ADA" "$ADA"
  check A4 "ada delete own task denied (no allowDelete anywhere)" $(is403) "code=$CODE"
else
  check A4 "ada delete own task denied" 0 "no task id from A2"
fi

req GET "/data/showcase_private_note?limit=5" "$ADMIN"
check A5 "admin wildcard reads private_note" $(ok2xx) "code=$CODE"

########## B. FLS ##########
# NOTE: budget writes use Compliance Audit (90k) — staying under the 100k
# showcase_budget_approval flow threshold so the record never gets approval-locked.
req GET "/data/showcase_project/$PROJ_AUDIT" "$ADA"
HASB=$(echo "$BODY" | jq '.record | has("budget") and has("spent")')
check B1 "ada sees readable budget/spent fields" $([ "$HASB" = "true" ] && echo 1 || echo 0) "body=$(echo $BODY|head -c150)"
B_BEFORE=$(echo "$BODY" | jq -r '.record.budget')

req PATCH "/data/showcase_project/$PROJ_AUDIT" "$ADA" '{"budget":95000}'
B2CODE=$CODE
req GET "/data/showcase_project/$PROJ_AUDIT" "$ADMIN"
B_AFTER=$(echo "$BODY" | jq -r '.record.budget')
check B2 "ada cannot change budget (FLS editable:false)" $([ "$B_AFTER" = "$B_BEFORE" ] && echo 1 || echo 0) "patch=$B2CODE before=$B_BEFORE after=$B_AFTER"

req PATCH "/data/showcase_project/$PROJ_AUDIT" "$ADMIN" '{"budget":95000}'
req GET "/data/showcase_project/$PROJ_AUDIT" "$ADMIN"
check B3 "admin can write budget (no FLS restriction)" $([ "$(echo "$BODY"|jq -r .record.budget)" = "95000" ] && echo 1 || echo 0) "after=$(echo "$BODY"|jq -r .record.budget)"
req PATCH "/data/showcase_project/$PROJ_AUDIT" "$ADMIN" "{\"budget\":$B_BEFORE}"  # restore

########## C. OWD ##########
req POST /data/showcase_private_note "$NEWBIE" '{"title":"perm-test-newbie-note"}'
NOTE_ID=$(echo "$BODY" | jq -r '.id // empty')
C1A=$(ok2xx)
req GET "/data/showcase_private_note?limit=100" "$ADA"
ADA_SEES=$(echo "$BODY" | jq '[(.records // [])[] | select(.title=="perm-test-newbie-note")] | length')
req GET "/data/showcase_private_note?limit=100" "$NEWBIE"
NB_SEES=$(echo "$BODY" | jq '[(.records // [])[] | select(.title=="perm-test-newbie-note")] | length')
check C1 "private OWD: owner sees own, ada blind to newbie note" $([ "$C1A" = "1" ] && [ "$ADA_SEES" = "0" ] && [ "$NB_SEES" = "1" ] && echo 1 || echo 0) "create=$C1A adaSees=$ADA_SEES nbSees=$NB_SEES"

req GET "/data/showcase_inquiry?limit=100" "$NEWBIE"
NB_SEED=$(echo "$BODY" | jq '[(.records // [])[] | select(.email|test("meridian|brightline|oldrequest"))] | length')
check C2 "private OWD: read grant != read others (newbie sees 0 seed inquiries)" $([ "$NB_SEED" = "0" ] && echo 1 || echo 0) "seedVisible=$NB_SEED"

req GET "/data/showcase_announcement?limit=50" "$NEWBIE"
ANN_N=$(echo "$BODY" | jq '(.records // []) | length')
ANN_ID=$(echo "$BODY" | jq -r '(.records // [])[0].id // empty')
check C3 "public_read: newbie reads announcements" $([ "$(ok2xx)" = "1" ] && [ "$ANN_N" -ge 1 ] && echo 1 || echo 0) "code=$CODE n=$ANN_N"

req PATCH "/data/showcase_announcement/$ANN_ID" "$NEWBIE" '{"title":"hacked"}'
check C4 "public_read: newbie cannot edit others announcement" $(is403) "code=$CODE"

# C5: public_read_write allows non-owner write WHEN capability granted:
# seed task created by system, ada has allowEdit -> 200
SEED_TASK=$(curl -s "$API/data/showcase_task?limit=200" -H "Authorization: Bearer $ADA" | jq -r '(.records // [])[] | select(.title=="Audit current IA") | .id' | head -1)
req GET "/data/showcase_task/$SEED_TASK" "$ADA"
ST_STATUS=$(echo "$BODY" | jq -r '.record.status')
req PATCH "/data/showcase_task/$SEED_TASK" "$ADA" "{\"status\":\"$ST_STATUS\"}"
check C5 "public_read_write: ada edits non-owned seed task (cap + OWD)" $(ok2xx) "code=$CODE task=$SEED_TASK"

req GET "/data/showcase_invoice?limit=100" "$ADA"
ADA_INV_IDS=$(echo "$BODY" | jq -r '[(.records // [])[].id] | join("|")')
req GET "/data/showcase_invoice_line?limit=200" "$ADA"
ADA_LINES=$(echo "$BODY" | jq '(.records // []) | length')
FOREIGN_LINES=$(echo "$BODY" | jq --arg ids "$ADA_INV_IDS" '[(.records // [])[] | select((.invoice|tostring) as $i | ($ids | split("|") | index($i)) == null)] | length')
req GET "/data/showcase_invoice_line?limit=200" "$ADMIN"
ALL_LINES=$(echo "$BODY" | jq '(.records // []) | length')
check C6 "controlled_by_parent: ada lines follow parent invoice RLS" $([ "$FOREIGN_LINES" = "0" ] && [ "$ADA_LINES" -gt 0 ] && [ "$ADA_LINES" -lt "$ALL_LINES" ] && echo 1 || echo 0) "adaLines=$ADA_LINES foreign=$FOREIGN_LINES all=$ALL_LINES"

########## D. depth scope ##########
req GET "/data/showcase_inquiry?limit=100" "$MIA"
MIA_SEED=$(echo "$BODY" | jq '[(.records // [])[] | select(.email|test("meridian|brightline|oldrequest"))] | length')
PRIYA_ID=$(echo "$BODY" | jq -r '(.records // [])[] | select(.email=="priya@meridian.example") | .id' | head -1)
check D1 "readScope:org — mia sees all 3 seed inquiries over private OWD" $([ "$MIA_SEED" = "3" ] && echo 1 || echo 0) "seedVisible=$MIA_SEED"

req PATCH "/data/showcase_inquiry/$PRIYA_ID" "$MIA" '{"status":"contacted"}'
D2A_DENIED=$([ "$(is4xx)" = "1" ] && echo "$BODY" | grep -q FORBIDDEN && echo 1 || echo 0)
check D2a "writeScope:own — mia cannot edit others inquiry (4xx FORBIDDEN)" "$D2A_DENIED" "code=$CODE body=$(echo $BODY|head -c120)"

req POST /data/showcase_inquiry "$MIA" '{"name":"Mia Own","email":"mia-own@example.com","message":"perm-test"}'
MIA_INQ=$(echo "$BODY" | jq -r '.id // empty')
req PATCH "/data/showcase_inquiry/$MIA_INQ" "$MIA" '{"status":"contacted"}'
check D2b "writeScope:own — mia edits her own inquiry" $(ok2xx) "code=$CODE id=$MIA_INQ"

req GET "/data/showcase_private_note?limit=100" "$MAX"
MAX_SEES=$(echo "$BODY" | jq '[(.records // [])[] | select(.title=="perm-test-newbie-note")] | length')
check D4 "exec org-read private_note (depth over private OWD)" $([ "$MAX_SEES" = "1" ] && echo 1 || echo 0) "maxSeesNewbieNote=$MAX_SEES"

########## E. sharing rules ##########
req GET "/data/sys_record_share?limit=200" "$ADMIN"
E1_N=$(echo "$BODY" | jq --arg p "$PROJ_AUDIT" '[(.records // [])[] | select(.record_id==$p)] | length')
E2_MIA=$(echo "$BODY" | jq --arg p "$PROJ_AUDIT" --arg u "$U_MIA" '[(.records // [])[] | select(.record_id==$p and .recipient_id==$u)] | length')
E1_MAX=$(echo "$BODY" | jq --arg p "$PROJ_AUDIT" --arg u "$U_MAX" '[(.records // [])[] | select(.record_id==$p and .recipient_id==$u)] | length')
check E1 "red project materialized share to exec user (max)" $([ "$E1_MAX" -ge 1 ] && echo 1 || echo 0) "rowsForAudit=$E1_N maxRows=$E1_MAX"
check E2 "compound rule (budget>100k) NOT matched for 90k project" $([ "$E2_MIA" = "0" ] && echo 1 || echo 0) "miaRows=$E2_MIA"

req GET "/data/showcase_inquiry?limit=100" "$WES"
WES_NEW=$(echo "$BODY" | jq '[(.records // [])[] | select(.email=="priya@meridian.example")] | length')
WES_OLD=$(echo "$BODY" | jq '[(.records // [])[] | select(.email|test("brightline|oldrequest"))] | length')
check E3 "BU-subtree sharing: wes sees status=new inquiry only" $([ "$WES_NEW" = "1" ] && [ "$WES_OLD" = "0" ] && echo 1 || echo 0) "new=$WES_NEW old=$WES_OLD"

req GET "/data/showcase_inquiry?limit=100" "$NEWBIE"
E4_N=$(echo "$BODY" | jq '[(.records // [])[] | select(.email|test("meridian|brightline|oldrequest"))] | length')
check E4 "no BU -> no sharing relaxation (newbie still 0)" $([ "$E4_N" = "0" ] && echo 1 || echo 0) "n=$E4_N"

########## F. VAMA ##########
req GET "/data/showcase_private_note?limit=100" "$AUDREY"
F1A=$(echo "$BODY" | jq '[(.records // [])[] | select(.title=="perm-test-newbie-note")] | length')
check F1a "viewAllRecords: audrey sees newbie private note" $([ "$F1A" = "1" ] && echo 1 || echo 0) "n=$F1A"

req GET "/data/showcase_inquiry?limit=100" "$AUDREY"
F1B=$(echo "$BODY" | jq '[(.records // [])[] | select(.email|test("meridian|brightline|oldrequest"))] | length')
check F1b "viewAllRecords: audrey sees all seed inquiries" $([ "$F1B" = "3" ] && echo 1 || echo 0) "n=$F1B"

req PATCH "/data/showcase_private_note/$NOTE_ID" "$AUDREY" '{"title":"audrey-was-here"}'
F2_DENIED=$([ "$(is4xx)" = "1" ] && echo 1 || echo 0)
check F2 "VAMA read-only: audrey cannot edit (no allowEdit)" "$F2_DENIED" "code=$CODE body=$(echo $BODY|head -c150)"

req PATCH "/data/showcase_announcement/$ANN_ID" "$OSKAR" '{"body":"perm-test oskar modifyAll edit"}'
check F3 "modifyAllRecords: oskar edits others announcement" $(ok2xx) "code=$CODE"

req GET "/data/showcase_invoice?limit=100" "$AUDREY"
AUD_INV=$(echo "$BODY" | jq '(.records // []) | length')
req GET "/data/showcase_invoice?limit=100" "$ADMIN"
ALL_INV=$(echo "$BODY" | jq '(.records // []) | length')
req GET "/data/showcase_invoice?limit=100" "$ADA"
ADA_INV=$(echo "$BODY" | jq '(.records // []) | length')
check F4 "VAMA vs RLS: audrey sees all invoices, ada only own" $([ "$AUD_INV" = "$ALL_INV" ] && [ "$ADA_INV" -lt "$ALL_INV" ] && echo 1 || echo 0) "audrey=$AUD_INV admin=$ALL_INV ada=$ADA_INV"

########## G. RLS ##########
req GET "/data/showcase_task?limit=200" "$ADA"
G1_TOT=$(echo "$BODY" | jq '(.records // []) | length')
G1_FOREIGN=$(echo "$BODY" | jq '[(.records // [])[] | select(.assignee != "ada@example.com")] | length')
check G1 "RLS narrows public_read_write: ada only assignee==self" $([ "$G1_FOREIGN" = "0" ] && [ "$G1_TOT" -ge 3 ] && echo 1 || echo 0) "total=$G1_TOT foreign=$G1_FOREIGN"

req GET "/data/showcase_task?limit=200" "$NEWBIE"
G2_TOT=$(echo "$BODY" | jq '(.records // []) | length')
check G2 "RLS only binds contributor position: newbie sees all tasks" $([ "$G2_TOT" -gt "$G1_TOT" ] && echo 1 || echo 0) "newbie=$G2_TOT ada=$G1_TOT"

req GET "/data/showcase_invoice?limit=100" "$ADA"
G3_NAMES=$(echo "$BODY" | jq -r '[(.records // [])[].name] | sort | join(",")')
INV1001=$(echo "$BODY" | jq -r '(.records // [])[] | select(.name=="INV-1001") | .id')
check G3 "invoice RLS: ada sees exactly INV-1001,INV-1002" $([ "$G3_NAMES" = "INV-1001,INV-1002" ] && echo 1 || echo 0) "names=$G3_NAMES"

req PATCH "/data/showcase_invoice/$INV1001" "$ADA" '{"owner":"linus@example.com"}'
check G4 "write-time check: ada cannot transfer owner away" $(is403) "code=$CODE"

req GET "/data/showcase_invoice/$INV1001" "$ADA"
INV_STATUS=$(echo "$BODY" | jq -r '.record.status')
req PATCH "/data/showcase_invoice/$INV1001" "$ADA" "{\"status\":\"$INV_STATUS\"}"
check G5 "check passes when owner unchanged" $(ok2xx) "code=$CODE"

########## H. everyone baseline ##########
req GET "/data/showcase_product?limit=5" "$NEWBIE"
H1A=$(ok2xx)
req GET "/data/showcase_announcement?limit=5" "$NEWBIE"
check H1 "isDefault set active for brand-new user" $([ "$H1A" = "1" ] && [ "$(ok2xx)" = "1" ] && echo 1 || echo 0) "code=$CODE"

req GET "/data/showcase_product?limit=5" "$ADA"
check H2 "baseline stacks (no fallback cliff) for ada" $(ok2xx) "code=$CODE"

# H3: anchor gate — bind VAMA set to everyone
req GET "/data/sys_position?limit=100" "$ADMIN"
POS_EVERYONE=$(echo "$BODY" | jq -r '(.records // [])[] | select(.name=="everyone") | .id' | head -1)
POS_GUEST=$(echo "$BODY" | jq -r '(.records // [])[] | select(.name=="guest") | .id' | head -1)
req GET "/data/sys_permission_set?limit=100" "$ADMIN"
PS_AUDITOR=$(echo "$BODY" | jq -r '(.records // [])[] | select(.name=="showcase_auditor") | .id' | head -1)
PS_OPS=$(echo "$BODY" | jq -r '(.records // [])[] | select(.name=="showcase_ops") | .id' | head -1)
req POST /data/sys_position_permission_set "$ADMIN" "{\"position_id\":\"$POS_EVERYONE\",\"permission_set_id\":\"$PS_AUDITOR\"}"
check H3 "anchor gate: VAMA set cannot bind to everyone" $(is4xx) "code=$CODE body=$(echo $BODY|head -c200)"

########## I. guest ##########
req GET "/data/showcase_announcement?limit=5" ""
check I1 "anonymous data API -> 401" $([ "$CODE" = "401" ] && echo 1 || echo 0) "code=$CODE"

req GET "/forms/contact-us" ""
check I2a "anonymous can fetch public form definition" $(ok2xx) "code=$CODE"

req POST /forms/contact-us/submit "" '{"name":"Guest Visitor","email":"guest-visitor@example.com","message":"perm-test guest submission"}'
check I2b "anonymous form submit creates inquiry (guest_portal)" $(ok2xx) "code=$CODE body=$(echo $BODY|head -c150)"

req GET "/data/showcase_inquiry?limit=100" "$ADMIN"
I2C=$(echo "$BODY" | jq '[(.records // [])[] | select(.email=="guest-visitor@example.com")] | length')
check I2c "guest submission persisted" $([ "$I2C" -ge 1 ] && echo 1 || echo 0) "n=$I2C"

req POST /data/sys_position_permission_set "$ADMIN" "{\"position_id\":\"$POS_GUEST\",\"permission_set_id\":\"$PS_OPS\"}"
check I3 "anchor gate: systemPermissions set cannot bind to guest" $(is4xx) "code=$CODE"

########## J. delegated admin ##########
req POST /data/sys_user_position "$DANA" "{\"user_id\":\"$U_WES\",\"position\":\"contributor\",\"business_unit_id\":\"bu_west_coast\"}"
J1_ROW=$(echo "$BODY" | jq -r '.id // empty')
J1_OK=$(ok2xx)
req GET "/data/sys_user_position/$J1_ROW" "$ADMIN"
J1_GB=$(echo "$BODY" | jq -r '.record.granted_by // empty')
check J1 "delegate assigns whitelisted set inside subtree" $([ "$J1_OK" = "1" ] && echo 1 || echo 0) "code=$CODE row=$J1_ROW"
check J1b "granted_by stamped to dana" $([ "$J1_GB" = "$U_DANA" ] && echo 1 || echo 0) "granted_by=$J1_GB dana=$U_DANA"
# cleanup immediately to avoid polluting sharing/RLS tests on rerun
[ -n "$J1_ROW" ] && req DELETE "/data/sys_user_position/$J1_ROW" "$ADMIN"

req POST /data/sys_user_position "$DANA" "{\"user_id\":\"$U_WES\",\"position\":\"auditor\",\"business_unit_id\":\"bu_west_coast\"}"
check J2 "delegate blocked: set outside allowlist (auditor)" $(is403) "code=$CODE"

req POST /data/sys_user_position "$DANA" "{\"user_id\":\"$U_WES\",\"position\":\"contributor\",\"business_unit_id\":\"bu_hq_finance\"}"
check J3 "delegate blocked: anchor outside subtree" $(is403) "code=$CODE"

req POST /data/sys_user_position "$DANA" "{\"user_id\":\"$U_WES\",\"position\":\"contributor\"}"
check J4 "delegate blocked: assignment without BU anchor" $(is403) "code=$CODE"

req POST /data/sys_user_position "$ADA" "{\"user_id\":\"$U_WES\",\"position\":\"contributor\",\"business_unit_id\":\"bu_west_coast\"}"
check J5 "no RBAC crud + no adminScope (ada) -> denied" $(is403) "code=$CODE"

req POST /data/sys_user_position "$ADMIN" "{\"user_id\":\"$U_WES\",\"position\":\"contributor\",\"business_unit_id\":\"bu_west_coast\"}"
J6_ROW=$(echo "$BODY" | jq -r '.id // empty')
check J6 "admin unrestricted (create-then-delete)" $(ok2xx) "code=$CODE"
[ -n "$J6_ROW" ] && req DELETE "/data/sys_user_position/$J6_ROW" "$ADMIN"

########## K. explain ##########
req GET "/security/explain?object=showcase_task&operation=read" "$ADA"
K1_OK=$([ "$CODE" = "200" ] && echo "$BODY" | jq -e 'tostring | test("permission|rls|owd|scope|set";"i")' >/dev/null && echo 1 || echo 0)
check K1 "explain returns layered decision for self" "$K1_OK" "code=$CODE body=$(echo $BODY|head -c200)"

req GET "/security/explain?object=showcase_task&operation=read&userId=$U_ADMIN" "$ADA"
K2A=$(is403)
req GET "/security/explain?object=showcase_task&operation=read&userId=$U_ADA" "$ADMIN"
check K2 "explain other-user: ada denied, admin allowed" $([ "$K2A" = "1" ] && [ "$CODE" = "200" ] && echo 1 || echo 0) "adaDenied=$K2A adminCode=$CODE"

########## cleanup test records ##########
echo "== cleanup =="
[ -n "$TASK_ADA" ] && req DELETE "/data/showcase_task/$TASK_ADA" "$ADMIN" && echo "task: $CODE"
[ -n "$NOTE_ID" ] && req DELETE "/data/showcase_private_note/$NOTE_ID" "$ADMIN" && echo "note: $CODE"
[ -n "$MIA_INQ" ] && req DELETE "/data/showcase_inquiry/$MIA_INQ" "$ADMIN" && echo "mia inquiry: $CODE"
req GET "/data/showcase_inquiry?limit=100" "$ADMIN"
for gid in $(echo "$BODY" | jq -r '(.records // [])[] | select(.email=="guest-visitor@example.com") | .id'); do
  req DELETE "/data/showcase_inquiry/$gid" "$ADMIN"; echo "guest inquiry $gid: $CODE (ownerless rows are expected to fail — known finding)"
done

echo ""
echo "==================== RESULT ===================="
echo "$RESULTS"
echo "================================================"
echo "PASS=$PASS FAIL=$FAIL"
