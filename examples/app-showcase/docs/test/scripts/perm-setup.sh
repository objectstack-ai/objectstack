#!/bin/bash
# Permission-model test env setup for app-showcase (port 3777)
set -u
API=http://localhost:3777/api/v1
PASS='Passw0rd!234'

signup() { # email name
  curl -s -X POST $API/auth/sign-up/email -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASS\",\"name\":\"$2\"}" | jq -r '.user.id // .message // .error // "??"'
}

token() { # email pass
  curl -s -X POST $API/auth/sign-in/email -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r '.token // empty'
}

echo "== sign up users =="
for u in "ada@example.com Ada" "mia@example.com Mia" "max@example.com Max" "audrey@example.com Audrey" "oskar@example.com Oskar" "dana@example.com Dana" "wes@example.com Wes" "newbie@example.com Newbie"; do
  set -- $u
  echo "$1 -> $(signup $1 $2)"
done

ADMIN=$(token admin@objectos.ai admin123)
echo "admin token: ${ADMIN:0:8}..."
AH="Authorization: Bearer $ADMIN"

echo "== resolve user ids =="
USERS=$(curl -s "$API/data/sys_user?limit=50" -H "$AH")
uid() { echo "$USERS" | jq -r ".data[]? // .items[]? // .records[]? | select(.email==\"$1\") | .id" 2>/dev/null | head -1; }
echo "$USERS" | jq -r '(.data // .items // .records // [])[] | "\(.email) \(.id)"' 2>/dev/null

for e in ada mia max audrey oskar dana wes newbie; do
  eval "U_${e}=$(uid ${e}@example.com)"
done

assign() { # userid position [bu]
  local body="{\"user_id\":\"$1\",\"position\":\"$2\""
  [ -n "${3:-}" ] && body="$body,\"business_unit_id\":\"$3\""
  body="$body}"
  curl -s -X POST "$API/data/sys_user_position" -H "$AH" -H 'Content-Type: application/json' -d "$body" | jq -c '{id: (.id // .data.id // null), error: (.error // .message // null)}'
}
bu_member() { # userid bu
  curl -s -X POST "$API/data/sys_business_unit_member" -H "$AH" -H 'Content-Type: application/json' \
    -d "{\"user_id\":\"$1\",\"business_unit_id\":\"$2\"}" | jq -c '{id: (.id // .data.id // null), error: (.error // .message // null)}'
}

echo "== assign positions =="
echo "ada/contributor:    $(assign $U_ada contributor)"
echo "mia/manager:        $(assign $U_mia manager)"
echo "max/exec:           $(assign $U_max exec)"
echo "audrey/auditor:     $(assign $U_audrey auditor)"
echo "oskar/ops:          $(assign $U_oskar ops)"
echo "dana/fops_delegate: $(assign $U_dana field_ops_delegate)"

echo "== business unit memberships =="
echo "dana->bu_field_ops:  $(bu_member $U_dana bu_field_ops)"
echo "wes->bu_west_coast:  $(bu_member $U_wes bu_west_coast)"
