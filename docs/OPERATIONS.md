# VPS operations

Use the existing Compose stack: one Python application plus PostgreSQL. No additional hosted service is required.

## Configure and start

```bash
python3 scripts/configure.py
# Edit .env, config/profile.json, config/policies.json.
# Put your real PDF at config/resume.pdf, readable by container uid 10001.
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose exec agent .venv/bin/python -m jobhunt check
```

The setup helper preserves existing files, creates random dashboard/database passwords without printing them, and makes the project directory private to its host owner. The configuration directory is readable inside its bind mount. Review permissions if running under a shared host account. Never commit .env, resumes, browser profiles, application evidence or database backups.

Use an SSH tunnel (`ssh -L 8000:127.0.0.1:8000 user@vps`) and open http://127.0.0.1:8000. Any username plus `DASHBOARD_TOKEN` authenticates. Do not expose Basic authentication over plain public HTTP.

The dashboard can save verified question/answer pairs to PostgreSQL. It never automatically approves newly inferred facts. A new bank entry overrides the same named key from the profile JSON. Repeated education/work-history fields require exact sections and ambiguous duplicates stop for review. Legal consent cannot be authorized by adding an answer to the bank.

Pause stops new application starts while allowing an already-running application to finish; discovery and heartbeats continue. Missing API key/resume/verified profile blocks application starts without draining every queued job into review. Site policy permission remains mandatory per employer/ATS hostname. `allowed_hosts` must explicitly include an embedded ATS host before forms in that iframe can be used.

## Long-running supervision

Discovery, applications and heartbeat run independently in the same process. Discovery has bounded parallelism, source backoff, read-request retries and a 10-minute cycle timeout. Applications have a 15-minute run timeout. A lost PostgreSQL lock cancels all loops; lock ownership is checked again immediately before a draft/final side effect. A worker task crash terminates Uvicorn for Compose's restart policy.

Health includes database connectivity, worker task state, and heartbeat freshness. A Docker health check by itself does not restart an unhealthy container. The provided systemd timer handles that case without exposing the Docker socket to the application:

```bash
# Assumes the checkout is /opt/jobhunt. Edit both unit paths if different.
sudo install -m 644 scripts/jobhunt-watchdog.service /etc/systemd/system/
sudo install -m 644 scripts/jobhunt-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now docker
sudo systemctl enable --now jobhunt-watchdog.timer
```

Watchdog only restarts the unhealthy agent container. It does not delete volumes, reset uncertain applications, or restart PostgreSQL. Host access is needed to install/enable these units; the current development environment has not deployed them to a VPS.

## Backups and changes

Back up PostgreSQL (`docker compose exec -T db pg_dump -U jobhunt jobhunt > /private-backup/jobhunt.sql`), config and the `browser_data` volume together. Treat all three as sensitive. Do not run workers against an old restored ledger concurrently with the live ledger.

This update uses the existing schema and the existing State JSON table; it does not require destructive schema changes. `step_intent` is an added application-state value. Old existing browser sessions under the single `data/browser` root are not automatically migrated; new sessions use `data/browser/<hostname>` so cookies are isolated by portal.

After changing code, run the test suite and secret scan, commit and push, then update the VPS checkout and rebuild. Do not deploy a changed bank/policy blindly; inspect verification and site permission entries.

## CI and real-world validation

The supplied GitHub Actions workflow defines SQLite tests, PostgreSQL advisory-lock tests, a real local Chromium fixture, and a Compose build/start smoke test. This workflow runs on pushes to the private GitHub repository. Inspect Actions for the result of the exact commit; its existence is not a claim that CI passed.

The local real-browser fixture never contacts an employer or OpenAI: it submits fake data to a loopback HTTP server. It is an integration check, not an ATS success-rate benchmark. Live search/OpenAI/portal testing still needs your configured credentials and a completed truthful profile. No actual employer applications were sent during this development task.
