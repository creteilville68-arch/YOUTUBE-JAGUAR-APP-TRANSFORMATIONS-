#!/bin/sh
# Dev/preview bootstrap: starts the local Convex backend and the Vite dev server.
# The Convex backend listens on 127.0.0.1:3210; Vite proxies /convx to it so the
# app also works from outside the sandbox (phones, other devices).
set -e

bunx convex dev &
CONVEX_PID=$!

# Wait until the backend answers (max ~20s).
i=0
while [ "$i" -lt 40 ]; do
  if curl -s -o /dev/null --max-time 1 http://127.0.0.1:3210/; then
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

# Run Vite in the foreground (the platform kills the script if it exits).
exec bun run dev
