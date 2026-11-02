#!/usr/bin/env bash
# The main checkout belongs to the coordinator, which never writes code (docs/program/ORG.md).
# Workers write code in their own git worktree (.claude/worktrees/...), which this guard lets through.
input=$(cat)
path=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.file_path??j.tool_input?.notebook_path??"")}catch{}})')
[ -z "$path" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
case "$path" in
  */.claude/worktrees/*) exit 0 ;;
  "$root"/src/*|"$root"/tests/*|"$root"/scripts/*|"$root"/config/*|src/*|tests/*|scripts/*|config/*)
    echo "Blocked: the coordinator does not write code in the main checkout (docs/program/ORG.md). Write a kickoff in docs/program/kickoffs/ and spawn a worker with isolation: worktree." >&2
    exit 2 ;;
esac
exit 0
