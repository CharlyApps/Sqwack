#!/bin/sh
# Send a hand-rolled canonical event to a running sqwackd — the generic/manual
# adapter path. Usage: ./send-event.sh [needs_input|working|finished|failed]
set -e

TYPE="agent.${1:-working}"
TOKEN="$(cat "$HOME/.sqwack/admin-token")"
MACHINE_ID="$(python3 -c "import json;print(json.load(open('$HOME/.sqwack/config.json'))['machineId'])")"
PORT="$(python3 -c "import json;print(json.load(open('$HOME/.sqwack/config.json'))['network']['port'])")"

curl -s -X POST "http://127.0.0.1:$PORT/v1/events" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$(uuidgen | tr 'A-Z' 'a-z')\",
    \"schemaVersion\": 1,
    \"machineId\": \"$MACHINE_ID\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"source\": { \"provider\": \"generic\", \"integration\": \"send-event.sh\", \"surface\": \"manual\" },
    \"type\": \"$TYPE\",
    \"sessionId\": \"manual-1\",
    \"project\": { \"name\": \"Manual Test\", \"cwd\": \"$PWD\" },
    \"message\": \"Sent from examples/send-event.sh\"
  }"
echo
