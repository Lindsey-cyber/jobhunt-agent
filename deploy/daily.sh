#!/usr/bin/env bash
# One coordinator pass, run by jobhunt-daily.service (noon, 6 pm, midnight New York).
# Each step's failure is logged and the remaining steps still run; results are
# committed and pushed after each stage, so a stopped run loses nothing.
set -uo pipefail
cd "$(dirname "$0")/.."
jh() { npm run -s jh -- "$@"; }
status=0

# What the agent writes; everything else in the repo is code or hand-kept.
OUTPUTS="docs/reports docs/applications data/evidence data/discovery/catalog.jsonl.gz data/discovery/latest.json data/review.jsonl data/trust.json data/labels data/answers.jsonl data/ledger.jsonl"

# The ledger, review list, labels and answer log are append-only; merge them line by line
# (also in .gitattributes, set here so it holds before the first pull that brings it).
# (Never answers.yaml: a line-by-line merge of YAML can corrupt it.)
printf 'data/*.jsonl merge=union\ndata/labels/*.jsonl merge=union\n' > .git/info/attributes

# Commit this machine's outputs, take GitHub's changes (on a conflict in a
# generated file this machine's copy wins), push. Never leaves a half-merge.
sync() {
  git add $OUTPUTS 2>/dev/null
  git diff --cached --quiet || git commit --quiet -m "$1 $(date -u +%Y-%m-%dT%H:%MZ) (VPS)"
  if ! git pull --no-rebase --no-edit --quiet -X ours; then
    git merge --abort 2>/dev/null
    echo "warning: git pull failed; continuing on the checked-out code"
    return 1
  fi
  git push --quiet || { echo "warning: git push failed; results stay committed locally"; return 1; }
}

# A run that was stopped leaves its outputs uncommitted; keep them, then update.
sync "Leftovers from an interrupted run" || true
if ! git diff --quiet HEAD@{1} HEAD -- package-lock.json 2>/dev/null; then npm ci --no-audit --no-fund --silent; fi

# The deciding code must pass its checks before it decides anything.
if ! npm run -s check > /tmp/jobhunt-check.log 2>&1; then
  echo "npm run check failed; not running discovery today:"; tail -30 /tmp/jobhunt-check.log
  exit 1
fi

jh daily || status=1
sync "Discovery" || status=1

# Apply manager: submit what the candidate approved (and, with triage on auto, every match), within the daily cap.
jh apply-approved || status=1
sync "Applications" || status=1
# Postings' own questions: draft from the resume, then retry what they held.
if [ -n "${OPENAI_API_KEY:-}" ]; then
  jh draft && jh apply-approved || status=1
  sync "Drafted answers and retries" || status=1
fi
if [ -n "${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  jh audit run || { echo "audit run failed; the sample stays for the next session to judge"; status=1; }
else
  echo "no auditor key set; audit sample left for an in-session auditor"
fi

# What the candidate reads: every application (docs/applications/README.md) and why the held ones are held.
jh applications || status=1
mkdir -p "docs/reports/$(date -u +%Y-%m-%d)" && jh holds > "docs/reports/$(date -u +%Y-%m-%d)/holds.txt" 2>&1 || true

# Disk: keep every run's JSON evidence, drop local screenshots after 60 days.
find data/runs -name '*.png' -mtime +60 -delete 2>/dev/null || true

sync "Daily run" || status=1
exit $status
