#!/usr/bin/env bash
# One coordinator pass, run by jobhunt-daily.service. Each step's failure is
# logged and the remaining steps still run; the report records what failed.
set -uo pipefail
cd "$(dirname "$0")/.."
jh() { npm run -s jh -- "$@"; }
status=0

git pull --ff-only --quiet || echo "warning: git pull failed; running the checked-out code"
if ! git diff --quiet HEAD@{1} HEAD -- package-lock.json 2>/dev/null; then npm ci --no-audit --no-fund --silent; fi

# The deciding code must pass its checks before it decides anything.
if ! npm run -s check > /tmp/jobhunt-check.log 2>&1; then
  echo "npm run check failed; not running discovery today:"; tail -30 /tmp/jobhunt-check.log
  exit 1
fi

jh daily || status=1
# Apply manager: submit what the candidate approved, within the daily cap.
jh apply-approved || status=1
# Postings' own questions: draft from the resume, then retry what they held.
if [ -n "${OPENAI_API_KEY:-}" ]; then
  jh draft && jh apply-approved || status=1
fi
if [ -n "${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  jh audit run || { echo "audit run failed; the sample stays for the next session to judge"; status=1; }
else
  echo "no auditor key set; audit sample left for an in-session auditor"
fi

# Disk: keep every run's JSON evidence, drop screenshots after 60 days.
find data/runs -name '*.png' -mtime +60 -delete 2>/dev/null || true

git add docs/reports data/discovery/catalog.jsonl.gz data/discovery/latest.json data/review.jsonl data/trust.json data/labels data/answers.yaml 2>/dev/null
if ! git diff --cached --quiet; then
  git commit --quiet -m "Daily discovery $(date -u +%Y-%m-%d) (VPS)"
  git push --quiet || { echo "git push failed; results stay committed locally"; status=1; }
fi
exit $status
