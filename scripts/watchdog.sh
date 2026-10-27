#!/bin/sh
# Run from this project's directory (e.g. via the supplied systemd timer).
set -eu
agent_container=$(docker compose ps -q agent)
[ -n "$agent_container" ] || exit 0
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$agent_container")
if [ "$health" = unhealthy ]; then
  docker compose restart agent
fi
