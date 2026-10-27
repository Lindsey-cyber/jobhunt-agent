# Oracle A1 ARM64 deployment

## Actual verification

On 2026-10-27 the exact application Dockerfile was built natively on GitHub's `ubuntu-24.04-arm` runner. Playwright launched Chromium successfully inside the non-root container:

```json
{"architecture":"aarch64","chromium":"141.0.7390.37","browser_smoke":"passed","application_flows_opened":0}
```

[Verified run](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40594404305). This verifies ARM64 image/browser compatibility, not an OCI deployment. The application uses Debian 12/glibc, Python 3.12 and pinned Playwright 1.56.0. Do not force `linux/amd64`, use Alpine/musl, or install an x86-only Chromium package on A1.

No usable OCI CLI/API credentials, SSH identity or instance address were available in this workspace. The Oracle console returned Site Unavailable during the connection attempt; no tenancy or instance was inspected or modified. No resources were purchased or resized.

## Shortest route for an existing A1 instance

1. Use an Ubuntu 24.04 ARM64 instance image and confirm `uname -m` reports `aarch64`. In OCI, obtain the instance public IP and the SSH private key corresponding to its configured public key. API keys are unnecessary for direct SSH deployment. Do not paste private keys into chat or Git.
2. SSH as `ubuntu`. Install Docker Engine and Compose v2 using Docker's official Ubuntu instructions: <https://docs.docker.com/engine/install/ubuntu/>. Log in to GitHub with a credential helper or a read-only deploy key for this private repository, then clone it.
3. Run the following in the checkout; edit `.env` locally to add search credentials. Discovery preview does not require OpenAI, applicant profile or resume.

```bash
python3 scripts/configure.py
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 agent
docker compose run --rm --no-deps --volume "$PWD/scripts:/app/scripts:ro" agent .venv/bin/python /app/scripts/arm_smoke.py
docker compose exec agent .venv/bin/python -m jobhunt check
```

4. From your computer run `ssh -L 8000:127.0.0.1:8000 ubuntu@INSTANCE_IP`. Open <http://127.0.0.1:8000>, use any username and the private `.env` `DASHBOARD_TOKEN` as password. Trigger one discovery preview. Port 8000 stays bound to localhost; OCI needs no public dashboard port. Restrict inbound SSH to your own IP in the OCI security list/NSG and host firewall.
5. Verify outbound HTTPS/DNS to search and ATS APIs, container health and free disk space. Compose persists PostgreSQL/browser data and rotates logs. Back up database and preview artifacts; a container restart policy does not survive instance deletion or free-tier reclamation.

For account-level OCI automation, configure an OCI API signing key under the user's **API keys** section and install its generated config/key on a secured operator host. Supply actual tenancy/user/region/key fingerprint and a least-privilege policy; those permissions cannot be inferred from general account authorization.

Free-tier allocations and idle reclamation depend on current Oracle policy and the actual tenancy. Check the console's Always Free eligibility and estimates before changing resources; do not assume a historic A1 quota or that upgrading guarantees free resources. Official references: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Playwright supported systems](https://playwright.dev/python/docs/intro), [Playwright Docker](https://playwright.dev/python/docs/docker).
