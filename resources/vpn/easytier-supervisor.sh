#!/bin/sh
# The unprivileged launcher removes the private lease file to disconnect. The
# elevated supervisor owns its child and cleans up if the launcher exits/crashes.
set -eu
core=$1
config=$2
lease=$3
launcher_pid=$4
rpc_port=$5
[ -f "$lease" ] && kill -0 "$launcher_pid" 2>/dev/null || exit 0
child=''
cleanup() {
  if [ -n "$child" ]; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  rm -f "$config" "$lease"
}
trap cleanup EXIT
trap 'exit 0' INT TERM HUP
"$core" --disable-env-parsing --rpc-portal "127.0.0.1:$rpc_port" --rpc-portal-whitelist 127.0.0.1/32 --config-file "$config" >/dev/null 2>&1 &
child=$!
while [ -f "$lease" ] && kill -0 "$launcher_pid" 2>/dev/null && kill -0 "$child" 2>/dev/null; do
  sleep 1
done
