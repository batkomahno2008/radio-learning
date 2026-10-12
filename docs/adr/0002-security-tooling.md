# ADR 0002: Security scan tools

- Status: Proposed. The Tech Lead must approve this ADR before #11 starts.
- Date: 2026-10-12
- Issue: #4 (SEC-2). Epic: #1.
- Policy: `docs/security/policy.md` (scan targets S1 to S11, gate, exceptions, reporting).
- Architecture: `docs/adr/0001-production-architecture.md`.

## Context

The security policy names eleven scan targets (S1 to S11) and a severity gate. It names no tool.
This ADR selects one primary tool for each target. It also sets the exception file and its format.

The selection rules of issue #4:

- Use a small number of tools. One tool that covers many targets is better.
- Prefer a tool with an official GitHub Action that you can pin to a commit SHA.
- Check the supply-chain history of each tool and of its Action.

Supply-chain attacks on scanners were frequent in 2025 and 2026 (see "Supply-chain history").
In March 2026, attackers changed the release tags of `aquasecurity/trivy-action` and published
a malicious Trivy binary and malicious Trivy images. In March and April 2026, the same group
changed the KICS Action and published malicious KICS images. A scanner runs with access to the
code and to the CI secrets. Thus the pin method is as important as the tool.

## Decision

### Primary tool for each scan target

| ID | Target | Primary tool | Version | How CI runs it | SARIF category |
|---|---|---|---|---|---|
| S1 | npm dependencies | Trivy (`fs`, vulnerability scanner) | 0.75.0 | Container by digest | `s1-npm` |
| S2 | OS packages of the images | Trivy (`image`, vulnerability scanner) | 0.75.0 | Container by digest | `s2-runtime`, `s2-proxy`, `s2-e2e` |
| S3 | Dockerfile | Trivy (`config`) and the project checks in `security/trivy/checks/` | 0.75.0 | Container by digest | `s3-dockerfile` |
| S4 | Compose files | Trivy (`config`) and the project checks (RL-DC-001 to RL-DC-010) | 0.75.0 | Container by digest | `s4-compose` |
| S5 | Kubernetes files | Trivy (`config`) on the output of `kustomize build`, and the project checks | 0.75.0 | Container by digest | `s5-k8s-staging`, `s5-k8s-prod` |
| S6 | NGINX config | gixy-ng | 0.2.55 | Container by digest | `s6-nginx` |
| S7 | Secrets | Gitleaks (`git` for the history, `dir` for the image file systems) | 8.30.1 | Container by digest | `s7-history`, `s7-image-runtime`, `s7-image-proxy`, `s7-image-e2e` |
| S8 | Source code (SAST) | CodeQL, `security-extended` suite | CLI 2.27.2 (Action 4.38.3) | Official Action by SHA | `s8-codeql` |
| S9 | GitHub Actions workflows | zizmor | 1.30.1 | Container by digest | `s9-actions` |
| S10 | HTTP headers of a running stack | `security/edge-check.sh` (Bash and curl) | In this repository | Script | Job summary (no SARIF) |
| S11 | Supply chain | `docker buildx imagetools inspect` for SBOM and provenance. The pin checks come from S3, S4, S5 and S9. | Docker Buildx on the runner | Command | Job summary (no SARIF) |

Five tools cover the eleven targets: Trivy (S1 to S5), gixy-ng (S6), Gitleaks (S7),
CodeQL (S8) and zizmor (S9). S10 and S11 use a script and a Docker command. All five tools are
free and open source. The repository is public, so code scanning and CodeQL are free.

The Trivy secret scanner also runs in the S2 image scans, at no cost. Its result is for
information only. Gitleaks is the gate tool for S7.

### How CI runs the tools

1. Run Trivy, gixy-ng, Gitleaks and zizmor as container images, pinned by digest
   (`image:tag@sha256:...`). Use `docker run` in a `run:` step.
2. Use only GitHub-owned Actions, pinned by commit SHA: `github/codeql-action/init`,
   `github/codeql-action/analyze` and `github/codeql-action/upload-sarif` (all at the same SHA).
3. Do not use the third-party scanner Actions (`trivy-action`, `setup-trivy`, `gitleaks-action`,
   `zizmor-action`). This ADR records their SHA for reference only.

Reasons:

- A digest pins every byte of the scanner and of its dependencies. A commit SHA pins only the
  Action code. `trivy-action` and `setup-trivy` download the Trivy binary by version tag at run time.
  In March 2026, the Trivy v0.69.4 binary was malicious, and the tags of the Actions were changed.
  Users who pinned the Trivy image by digest were not affected (GHSA-69fq-xp46-6x23).
- Fewer third-party Actions give a smaller attack surface. The only Actions are from GitHub,
  which also owns the runner and the code scanning service.
- One pattern for all scanners: pull by digest, run, write SARIF, upload with `upload-sarif`.
  It is easy to review, and it runs the same on a developer machine (see "Commands").
- The images are on GHCR and on Docker Hub with the same index digest (checked for Trivy and
  Gitleaks). Use the GHCR name in CI. Docker Hub limits anonymous pulls (this PoC got
  `429 Too Many Requests` from Docker Hub).

### Pinned versions

Scanner images. The digest is the multi-platform index digest.

| Tool | Image (use in CI) | Digest | Published |
|---|---|---|---|
| Trivy 0.75.0 | `ghcr.io/aquasecurity/trivy:0.75.0` (same as `aquasec/trivy:0.75.0`) | `sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa` | 2026-10-01 |
| Gitleaks 8.30.1 | `ghcr.io/gitleaks/gitleaks:v8.30.1` (same as `zricethezav/gitleaks:v8.30.1`) | `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` | 2026-03-21 |
| zizmor 1.30.1 | `ghcr.io/zizmorcore/zizmor:1.30.1` | `sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101` | 2026-09-09 |
| gixy-ng 0.2.55 | `getpagespeed/gixy:v0.2.55` (Docker Hub only) | `sha256:11170c9b4fc22d30a8d01a19d172382220900599facba4cac5ce01d5b0a77b86` | 2026-09-29 |

The Python packages (for a local run without Docker). Install with `pip install --require-hashes`.

| Package | Version | SHA-256 of the wheel |
|---|---|---|
| `zizmor` | 1.30.1 | `eee12266b793cb87ad4a7e3af2e72404f8a63e3de5eb099b80bf7b1cfd232a8e` (manylinux x86_64) |
| `gixy-ng` | 0.2.55 | `471c941d3251427ab79de2924210f52e46f5e4d9b45b522f27658e7d49bde60c` |

GitHub Actions. The SHA is the commit that the tag points to (an annotated tag is peeled).

| Action | Tag | Commit SHA | Use |
|---|---|---|---|
| `github/codeql-action` (`init`, `analyze`, `upload-sarif`) | v4.38.3 | `24c54180a607b1449ed407dd24f251e4e9147c8d` | Yes. S8 and the SARIF upload of all scans. |
| CodeQL bundle | `codeql-bundle-v2.27.2` | `d208ec71e39ae46397cbf6569bef8439b9aab974` | Set `tools:` in `init` to this bundle, so that the CLI version is fixed. |
| `aquasecurity/trivy-action` | v0.36.0 | `ed142fd0673e97e23eac54620cfb913e5ce36c25` | No (reference only). Its default Trivy is v0.70.0. |
| `aquasecurity/setup-trivy` | v0.2.6 | `3fb12ec12f41e471780db15c232d5dd185dcb514` | No (reference only). |
| `zizmorcore/zizmor-action` | v0.6.4 | `cc914d7f3750a2d13d75c7f184a1060aa0e9d482` | No (reference only). |
| `gitleaks/gitleaks-action` | v3.0.0 | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | No (reference only). It needs a license key for organization accounts. |
| `zaproxy/action-baseline` | v0.15.0 | `de8ad967d3548d44ef623df22cf95c3b0baf8b25` | No (alternative for S10). |

gixy-ng and the S10 script have no official Action.

The Trivy vulnerability database is not pinned. It changes each day. That is correct, because the
scan must find new vulnerabilities. The database comes from `mirror.gcr.io/aquasec/trivy-db:2`.
The check bundle comes from `mirror.gcr.io/aquasec/trivy-checks:2`. For a repeatable run, cache
the database once for each workflow run and use `--skip-db-update` in the later scans of that run.

### Update rules for the pins

- Do not use a new scanner release before it is 7 days old. Most malicious releases in 2025 and
  2026 were found and removed in less than one day.
- Before you change a pin, read the release notes and the security advisories of the project.
- Verify the signature of the Trivy image with cosign before you change the Trivy pin:
  `cosign verify ghcr.io/aquasecurity/trivy:<version>@<digest> --certificate-identity-regexp '^https://github\.com/aquasecurity/trivy/\.github/workflows/.+' --certificate-oidc-issuer https://token.actions.githubusercontent.com`.
  Compare the signature time with the dates of known incidents. (This PoC could not do this step,
  see "Limits of the proof of concept".)
- Change the digest and the version comment in the same commit. Review it as a security change.
- Do not use the trivy versions 0.69.4, 0.69.5 and 0.69.6. They were malicious (GHSA-69fq-xp46-6x23).

## Comparison of the candidates

False positives: low, medium or high, from the PoC runs and from the documentation.
Maintenance: the state on 2026-10-12.

| Target | Tool | License and cost | SARIF | Official GitHub Action | False positives | Maintenance | Result |
|---|---|---|---|---|---|---|---|
| S1, S2 | Trivy | Apache-2.0, free | Yes | Yes (`trivy-action`, compromised in March 2026) | Low | Active. 0.75.0 on 2026-10-01. Releases each 2 to 6 weeks. | **Selected** |
| S1, S2 | Grype (with Syft) | Apache-2.0, free | Yes | Yes (`anchore/scan-action`) | Low | Active (0.120.1) | Not selected. Second tool for the same work. No config scanning. |
| S1 | OSV-Scanner | Apache-2.0, free | Yes | Yes (`google/osv-scanner-action`) | Low | Active (2.7.0) | Not selected. S1 only. |
| S1 | `npm audit` | Part of npm, free | No | No | Low | Active | Not selected. No SARIF. Used as a cross-check in the PoC. |
| S2 | Docker Scout | Proprietary, needs a Docker account | Yes | Yes | Low | Active | Not selected. Needs an account and a token. |
| S3 | Hadolint | GPL-3.0, free | Yes | Yes | Low | Maintained (2.15.1) | Not selected. Trivy covers the Dockerfile rules of the policy. |
| S3, S4, S5 | Checkov | Apache-2.0, free | Yes | Yes | Medium | Active (3.3.28) | Not selected. No Compose scanner. Python with many dependencies. |
| S3, S4, S5 | KICS | Apache-2.0, free | Yes | Yes (`kics-github-action`) | Medium | Active | Not selected. Its Action (March 2026) and its Docker Hub images (April 2026) were malicious. |
| S4 | Trivy with project checks | Apache-2.0, free | Yes | See Trivy | Low | See Trivy | **Selected**. Trivy has no built-in Compose checks. The project checks RL-DC-001 to RL-DC-010 add them. |
| S5 | kube-linter | Apache-2.0, free | Yes | Yes | Medium | Active | Not selected. Trivy covers it. |
| S5 | kubeconform | Apache-2.0, free | No | No | Low | Active | Not a security scanner. It validates the schema. #9 can use it as a test. |
| S6 | gixy-ng (GetPageSpeed fork of gixy) | MPL-2.0, free | No (JSON, Checkstyle). `security/gixy-sarif.jq` converts JSON to SARIF. | No | Low | Active. 0.2.55 on 2026-09-29. | **Selected**. It has the TLS check (`weak_ssl_tls`), `hsts_header` and `version_disclosure`. |
| S6 | Gixy-Next (other fork of gixy) | MPL-2.0, free | Yes | No | Low | Active (0.8.0 on 2026-10-09) | Not selected. It has no TLS check and no HSTS check, which policy 9.5 and 9.1 need. |
| S6 | gixy (Yandex) | MPL-2.0, free | No | No | Low | Not maintained (last release 2024) | Not selected. |
| S7 | Gitleaks | MIT, free | Yes | Yes (needs a license key for organizations) | Low | Security fixes only. The author moved to Betterleaks in March 2026. | **Selected** |
| S7 | Betterleaks | MIT, free | v1: yes. v2 (release candidate): SARIF removed. | No | Low | Active (1.9.0, 2.0.0-rc.2) | Not selected now. Young project. Version 2 removes SARIF. Examine again in 2027. |
| S7 | TruffleHog | AGPL-3.0, free | No | Yes | Low (verified secrets) | Active (3.99.2) | Not selected. No SARIF. |
| S8 | CodeQL | Free for public repositories | Yes | Yes (GitHub) | Low | Active | **Selected** |
| S8 | Semgrep CE | LGPL-2.1 engine. The rules have a separate license with limits. | Yes | No official Action (container) | Medium | Active | Not selected. Rule license limits. CodeQL is free here. |
| S9 | zizmor | MIT, free | Yes | Yes (`zizmor-action`) | Low | Active (1.30.1 on 2026-09-09) | **Selected**. It checks SHA pins, permissions, template injection and dangerous triggers (policy 8.1). |
| S9 | actionlint | MIT, free | No (custom format) | No official | Low | Active | Not selected. It checks syntax, not security. #11 can add it as a lint step. |
| S10 | OWASP ZAP baseline | Apache-2.0, free | Yes (with an add-on) | Yes (`zaproxy/action-baseline`) | Medium | Active | Not selected. Large image. It does not check the exact values of policy 9.1 to 9.4. |
| S10 | `security/edge-check.sh` | Part of this repository | No (job summary) | Not applicable | Low | Owned by this project | **Selected**. It checks each rule of 9.1, 9.2, 9.3, 9.4 and 9.6. |
| S11 | `docker buildx imagetools inspect` | Apache-2.0 (Docker Buildx) | No (job summary) | Not applicable | Low | Active | **Selected**. It reads the SBOM and the provenance attestations that BuildKit attaches. |

## Supply-chain history

| Tool or Action | Events in 2025 and 2026 | Effect on this decision |
|---|---|---|
| Trivy, `trivy-action`, `setup-trivy` | Late February 2026: an attacker got credentials through a `pull_request_target` workflow. Rotation was not complete. 2026-03-19: 76 of 77 tags of `trivy-action` and all 7 tags of `setup-trivy` pointed to malicious code for up to 12 hours. Trivy v0.69.4 (binary, images, packages) was malicious for about 3 hours. 2026-03-22: Docker Hub images 0.69.5 and 0.69.6 were malicious for about 10 hours. Users who pinned by digest or by SHA were safe. CVE-2026-33634, GHSA-69fq-xp46-6x23. | Use the image by digest, not the Action. Pin 0.75.0 (after the incident, 11 days old). Never use 0.69.4 to 0.69.6. |
| KICS, `kics-github-action`, `ast-github-action` | 2026-03-23: the KICS Action was malicious for about 4 hours. 2026-04-22: malicious `checkmarx/kics` images on Docker Hub and a malicious `ast-github-action` tag. A downstream project pulled `kics:latest` and was compromised. | KICS is not selected. |
| `tj-actions/changed-files`, `reviewdog/action-setup` | March 2025: changed tags dumped CI secrets into logs (CVE-2025-30066, CVE-2025-30154). More than 23,000 repositories used the Action. | Not candidates. They show why policy 8.1 needs SHA pins. |
| `github/codeql-action` | January 2025: CVE-2025-24362. Debug artifacts of a failed run could hold secrets. Fixed in 3.28.3. No known exploitation. | Use 4.38.3. Do not turn on debug mode in public workflows. |
| Gitleaks, `gitleaks-action` | No compromise found. March 2026: the author lost full control of the Gitleaks project and started Betterleaks. Gitleaks gets security fixes only. The Action fails for organization repositories with no license key. | Selected with care. Use the image by digest. Examine the project status again in 2027. |
| zizmor, `zizmor-action` | No incident found. | Selected. |
| gixy-ng | No incident found. Two active forks (gixy-ng and Gixy-Next) exist. | Selected. Pin the image by digest. |
| npm ecosystem (S1 context) | September and November 2025: the Shai-Hulud worms published malicious versions of hundreds of npm packages. 2026: the TeamPCP campaign reached npm and PyPI packages. | `npm ci` from the lockfile (policy 8.2). S1 scans the lockfile. |

## Commands

These are the commands of the PoC. #11 uses the same commands. In CI, replace the Docker Hub
image names with the GHCR names (same digest). The variables are:

```bash
TRIVY=ghcr.io/aquasecurity/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa
GITLEAKS=ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
ZIZMOR=ghcr.io/zizmorcore/zizmor:1.30.1@sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101
GIXY=getpagespeed/gixy:v0.2.55@sha256:11170c9b4fc22d30a8d01a19d172382220900599facba4cac5ce01d5b0a77b86
# Common Trivy options: the repository at /src, a shared cache, the Docker socket for local images.
T="docker run --rm -v $PWD:/src -w /src -v trivy-cache:/root/.cache/trivy -v /var/run/docker.sock:/var/run/docker.sock $TRIVY"
```

| ID | Command |
|---|---|
| S1 | `$T fs --scanners vuln --format sarif --output s1-npm.sarif /src` |
| S2 | `$T image --scanners vuln,secret --format sarif --output s2-runtime.sarif ghcr.io/batkomahno2008/radio-learning:sha-<short>` (the same for `proxy` and `e2e`) |
| S3, S4, S5 | `$T config --misconfig-scanners dockerfile,kubernetes,yaml --config-check /src/security/trivy/checks --config-file-schemas /src/security/trivy/schemas/compose.json --check-namespaces user --format sarif --output s3-s4.sarif /src` |
| S5 | `kustomize build deploy/k8s/overlays/prod > rendered/prod.yaml`, then the S3 command on `/src/rendered` with `--output s5-k8s-prod.sarif` (the same for `staging`) |
| S6 | `docker run --rm -v <rendered-config-dir>:/etc/nginx:ro $GIXY --nginx-version <nginx version> -f json /etc/nginx/nginx.conf > s6.json`, then `jq --arg root /etc/nginx/ --arg prefix deploy/nginx/ -f security/gixy-sarif.jq s6.json > s6-nginx.sarif` |
| S7 history | `docker run --rm -v $PWD:/repo -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo $GITLEAKS git /repo --redact --no-banner --report-format sarif --report-path /repo/s7-history.sarif` (checkout with `fetch-depth: 0`. The image runs as root and the checkout has a different owner, so Git needs `safe.directory`.) |
| S7 image | `docker create --name x <image>`, `docker export x \| tar -C imgfs -xf -`, then `docker run --rm -v $PWD/imgfs:/src:ro -v $PWD:/out $GITLEAKS dir /src --redact --no-banner --report-format sarif --report-path /out/s7-image-runtime.sarif` |
| S8 | `github/codeql-action/init` with `languages: javascript-typescript`, `config-file: ./.github/codeql/codeql-config.yml`, `tools: <codeql-bundle-v2.27.2 URL>`; then `github/codeql-action/analyze` with `category: s8-codeql`. Local: `codeql database create db --language=javascript-typescript --codescanning-config=.github/codeql/codeql-config.yml` and `codeql database analyze db --format sarif-latest --output s8.sarif` |
| S9 | `docker run --rm -v $PWD:/src -w /src -e GH_TOKEN $ZIZMOR --format sarif . > s9-actions.sarif` (the config `.github/zizmor.yml` loads automatically) |
| S10 | `STATION_ORIGINS=https://station.test security/edge-check.sh http://<nginx>:8080/` (after the E2E suite) |
| S11 | `docker buildx imagetools inspect <image>@<digest> --format '{{json .SBOM}}'` and `--format '{{json .Provenance}}'`. Each must be present for each platform. |

Upload each SARIF file with `github/codeql-action/upload-sarif` and its own `category`.

## Proof of concept

All runs on 2026-10-12, on the repository at `main` (`e03bcbe`) plus the files of this ADR.
Trivy database: updated 2026-10-12 07:12 UTC. The raw results are not in the repository.

### Results on the repository

| ID | Tool | What was scanned | CRITICAL | HIGH | MEDIUM | LOW | Other |
|---|---|---|---|---|---|---|---|
| S1 | Trivy 0.75.0 | `package-lock.json` (156 packages) | 0 | 0 | 0 | 0 | SARIF 2.1.0 with 0 results. `npm audit` agrees: 0 findings. |
| S3, S4, S5 | Trivy 0.75.0 | The repository | – | – | – | – | No Dockerfile, Compose or Kubernetes file exists yet. 0 results. |
| S7 | Gitleaks 8.30.1 | Git history of `main` (20 commits with changes, about 199 KB). Also all local refs (25 commits). | – | – | – | – | 0 secrets. |
| S7 | Gitleaks 8.30.1 | Working tree (`dir` mode) | – | – | – | – | 0 secrets. |
| S8 | CodeQL 2.27.2 | 15 files (`server.js`, `db.js`, `cucumber.js`, 11 test files, the client script in `public/index.html`), 103 queries | 0 | 2 | 0 | 0 | `js/missing-rate-limiting` (security-severity 7.5) in `server.js` lines 17 and 76. |
| S9 | zizmor 1.30.1 | The repository | – | – | – | – | No workflow exists yet. zizmor stops with "no inputs collected" (exit 3). |

The two CodeQL findings are gate violations under policy 3.2 (S8). The design puts rate limits in
NGINX (policy 9.3, D12), so the app has none. This issue does not fix findings. #13 must triage
them: an exception with this reason, or a limiter in the app.

### Results on the base images (S2 and S7)

"With fix" is the count that the gate uses (policy 3.1). The S2 gate applies only to the
`runtime` and `proxy` images. These counts show the start point for #8.

| Image (tag, index digest) | All CRITICAL / HIGH / MEDIUM / LOW / UNKNOWN | With fix: CRITICAL / HIGH | Main source of HIGH with fix | Trivy secrets | Gitleaks `dir` |
|---|---|---|---|---|---|
| `node:24.21.0-trixie-slim` (`sha256:173f1258...fb66`, Debian 13.7) | 0 / 51 / 70 / 61 / 3 | 0 / 7 | npm bundled in the image (`brace-expansion`, `undici`) | 0 | 1 (false positive, see below) |
| `node:24.21.0-bookworm-slim` (`sha256:d6aa754f...7b20`, Debian 12.15) | 4 / 62 / 114 / 78 / 4 | 3 / 11 | `perl-base` (Debian), npm bundled in the image | 0 | not run |
| `nginxinc/nginx-unprivileged:stable-alpine` (`sha256:56b8272e...6f86`, NGINX 1.30.5, Alpine 3.24.2) | 0 / 0 / 1 / 0 / 0 | 0 / 0 | – (1 MEDIUM in `zlib`, with fix) | 0 | not run |
| `postgres:18-alpine` (`sha256:77f58511...1873`, PostgreSQL 18.6) | 1 / 24 / 29 / 3 / 5 | 1 / 24 | Go standard library in `/usr/local/bin/gosu` | 0 | not run |

The Gitleaks false positive: rule `generic-api-key` in `/usr/local/include/node/v8-internal.h`
line 187 (`kApiTaggedSize = ...`). It is a C++ constant, not a secret. The `runtime` image will
have the same file. Add an exception for it when #11 scans the image (target `S7 runtime image`).

### Detection proof with PoC samples

The repository has no Dockerfile, Compose file, Kubernetes manifest, NGINX config or workflow yet.
To prove that each tool finds faults, the PoC used small sample files outside the repository. Each
"bad" sample has known faults. Each "good" sample obeys the policy. The samples are not committed.
The NGINX samples are not the config of #16.

| ID | Tool | Bad sample: failed checks | Good sample: failed checks |
|---|---|---|---|
| S3 | Trivy, built-in and RL-DS-001 | Dockerfile: 3 (HIGH 2: DS-0002 root user, RL-DS-001 no digest. LOW 1: DS-0026 no HEALTHCHECK) | 0 |
| S4 | Trivy, RL-DC-001 to RL-DC-010 | `compose.yaml`: 26 HIGH. All ten rules found their fault. | 0 |
| S5 | Trivy, built-in and RL-KS-001, RL-KS-002 | `k8s.yaml` (Deployment and CronJob): 57 (HIGH 14, MEDIUM 11, LOW 32) | 1 MEDIUM (KSV-0125, trusted registries, report only) |
| S6 | gixy-ng | 8 (HIGH 4: `weak_ssl_tls` x2, `version_disclosure`, `alias_traversal`. MEDIUM 4) | 0 HIGH (MEDIUM 4, from stub locations of the sample) |
| S6 | gixy-ng | Default config of the `nginx-unprivileged` image: HIGH 1 (`version_disclosure`), MEDIUM 1 | – |
| S7 | Gitleaks | A file with a random fake GitHub token: 1 finding (`github-pat`) | – |
| S9 | zizmor | Workflow: 6 results (`unpinned-uses` x2, `template-injection`, `dangerous-triggers`, `excessive-permissions`, `artipacked`) | 0 |
| S10 | `security/edge-check.sh` | Default `nginx-unprivileged` container: 10 of 10 checks fail | Sample config with the 9.1 to 9.4 and 9.6 controls: 10 of 10 checks pass |
| S11 | `docker buildx imagetools inspect` | – | `node:24.21.0-trixie-slim`: provenance (BuildKit, SLSA) and SBOM (SPDX 2.3, 260 packages) on each platform. `nginx-unprivileged` and `postgres`: 8 attestation manifests each. |

### Limits of the proof of concept

- The network proxy of the agent machine blocks `pkg-containers.githubusercontent.com` (GHCR image
  layers) and `tuf-repo-cdn.sigstore.dev` (Sigstore). Thus the PoC pulled the scanner images from
  Docker Hub (same digest as GHCR), and could not run `cosign verify`. #11 must run the cosign
  check on the GitHub runner once, before it uses the pins.
- zizmor ran from PyPI (`zizmor==1.30.1`) because the GHCR image layers were blocked. The image
  digest comes from the GHCR manifest.
- Gitleaks gives a false pass when Git refuses the repository. With a container user that is not
  the owner of the repository, Gitleaks wrote "0 commits scanned" and "no leaks found", with exit
  code 0. With `safe.directory` set, the same run scanned 25 commits. #11 must set `safe.directory`
  and must fail the S7 step when the log shows "0 commits scanned".
- By default, `gitleaks git` scans all refs (`--all`). Use `--log-opts=HEAD` to scan only the
  checked-out branch. CI checks out with `fetch-depth: 0`, so the default scans all fetched branches.
- zizmor ran with `--offline`. In CI, give it the read-only `GITHUB_TOKEN` (`GH_TOKEN`), so that the
  online audits run (`impostor-commit`, `known-vulnerable-actions`, `ref-confusion`).
- gixy-ng must read the config at the path that the `include` directives expect. A run of the pip
  package on a copy in another directory did not read `conf.d/` and missed one HIGH finding. The
  container run with the config at `/etc/nginx` found it.
- The S10 rate-limit check found no 429 at first, because the sample config used `return` in the
  API locations. `return` runs before `limit_req`. A location that proxies to the app does not have
  this problem. The final sample proxies to a stub location.

## Gate mapping for #11

The gate counts a result as a violation when it agrees with the fail rule of policy 3.2 and has
no valid exception. Use the SARIF `security-severity` (7.0 or more is HIGH, 9.0 or more is
CRITICAL), or the scanner severity.

Some checks of policy sections 7, 8 and 9 have a LOW or MEDIUM severity in the scanner. The policy
fails the target on these checks at all severities. The gate must count these check IDs at all severities:

| Policy rule | S3 (Dockerfile) | S4 (Compose) | S5 (Kubernetes) |
|---|---|---|---|
| R1 non-root | DS-0002 | RL-DC-001 | KSV-0012, KSV-0105 |
| R2 read-only root | – | RL-DC-002 | KSV-0014 |
| R3 drop all capabilities | – | RL-DC-003 | KSV-0003, KSV-0106 |
| R4 no privilege escalation | – | RL-DC-004 | KSV-0001 |
| R5 default seccomp | – | RL-DC-005 | KSV-0030, KSV-0104 |
| R6 no service account token | – | – | RL-KS-002 |
| R7 CPU and memory limits | – | RL-DC-006 | KSV-0011, KSV-0018 |
| R8 only NGINX is reachable | – | RL-DC-007 | Not checked by Trivy. #9 must test the NetworkPolicy on kind. |
| R9 no secret in the file | – (S7) | RL-DC-008 and S7 | S7 |
| R10 no privileged, no host namespaces | – | RL-DC-009 | KSV-0017, KSV-0008, KSV-0009, KSV-0010, KSV-0023 |
| 8.2 digest pin | RL-DS-001 | RL-DC-010 | RL-KS-001 |

S9 (policy 8.1): count these zizmor rules at all severities: `unpinned-uses`, `excessive-permissions`,
`template-injection`, `dangerous-triggers`. Count the other zizmor rules by severity.

S6: gixy-ng gives HIGH, MEDIUM or LOW. `security/gixy-sarif.jq` writes security-severity 7.5 for
HIGH. The TLS rules of 9.5 come from `weak_ssl_tls` (HIGH). gixy-ng does not check the header
values, the CSP, the rate limits and the body size. S10 checks them on the running stack.

S11: the job fails when a published image has no SBOM or no provenance on a platform. The pin
checks of section 8 come from RL-DS-001, RL-DC-010, RL-KS-001 (S3, S4, S5) and from zizmor
`unpinned-uses` (S9). The S11 job summary repeats their counts.

## Exception file

- One file for all scanners: `security/exceptions.yaml`. It starts with `exceptions: []`.
- Each entry has the six fields of policy 5.2: `id`, `finding`, `target`, `reason`, `owner`,
  `expires`. Write `expires` as a YAML date (`2026-12-31`) or the string `never`.
- The scanners do not read the file. The gate step reads the SARIF results and the exception file.
  It removes the results with a valid exception, then counts the gate violations. Thus the same
  rules apply to all scanners. The Security tab still shows the result. Dismiss it there with the
  exception ID in the comment.
- The gate ignores an entry and writes a warning when: a field is missing or empty, `expires` is
  not a date or `never`, `never` is used for a finding that is not a secret, the date is more than
  the maximum time after the date of the commit that added the entry, `finding` or `target` has `*`
  or `?`, or the `id` is not unique.
- The gate treats an entry with a date in the past as not valid.

Values of `target`: `S1`, `S2 runtime image`, `S2 proxy image`, `S2 e2e image`, `S3`, `S4`,
`S5 staging`, `S5 prod`, `S6`, `S7 history`, `S7 runtime image`, `S7 proxy image`, `S7 e2e image`,
`S8`, `S9`, `S10`, `S11`.

Format of `finding` for each scanner:

| Scanner | `finding` | Example |
|---|---|---|
| Trivy vulnerability (S1, S2) | The vulnerability ID | `CVE-2026-12345`, `GHSA-xxxx-xxxx-xxxx` |
| Trivy config (S3, S4, S5) | `<check ID>@<file>` (repository path) | `KSV-0014@deploy/k8s/base/postgres.yaml` |
| gixy-ng (S6) | `<plugin>@<file>:<line>` | `add_header_redefinition@deploy/nginx/templates/default.conf.template:42` |
| Gitleaks history (S7) | The Gitleaks fingerprint `<commit>:<file>:<rule>:<line>` | `0a1b2c3...:server.js:generic-api-key:12` |
| Gitleaks image (S7) | `<file>:<rule>:<line>` (path in the image) | `/usr/local/include/node/v8-internal.h:generic-api-key:187` |
| CodeQL (S8) | `<rule ID>@<file>:<line>` | `js/missing-rate-limiting@server.js:17` |
| zizmor (S9) | `<rule>@<file>:<line>` | `excessive-permissions@.github/workflows/ci.yml:12` |
| S10, S11 checks | The check ID that the script or the job writes | `9.3-api` |

## Configuration files in this change

| File | Purpose |
|---|---|
| `security/exceptions.yaml` | The exception file (empty). |
| `security/trivy/checks/*.rego` | Project checks for Trivy: RL-DS-001 (Dockerfile digest pin), RL-DC-001 to RL-DC-010 (Compose, R1 to R10 and 8.2), RL-KS-001 (Kubernetes digest pin), RL-KS-002 (R6). |
| `security/trivy/schemas/compose.json` | Lets Trivy find Compose files (a YAML file with a `services` map). |
| `security/gixy-sarif.jq` | Changes the gixy-ng JSON report into SARIF. |
| `security/edge-check.sh` | The S10 check. |
| `.github/zizmor.yml` | zizmor config: all Actions must use a SHA pin (policy 8.1). zizmor finds it automatically. |
| `.github/codeql/codeql-config.yml` | CodeQL config: the `security-extended` suite on all JavaScript. |

Why a top-level `security/` folder: the epic contracts name no path for scanner configuration.
`docs/security/` holds documents, not files that tools run. The files of `.github/` are the files
that GitHub and zizmor read from fixed places. The other files go in one folder, so that the
security owner can find and review all of them in one place.

## Consequences

- #11 needs Docker on the runner (GitHub-hosted runners have it) and Buildx for S11.
- #10 must publish the images with BuildKit attestations (`sbom: true` and `provenance: mode=max` in
  `docker/build-push-action`), or S11 must change to `gh attestation verify`. Tell the Tech Lead if
  #10 uses a different method.
- #8 must name the NGINX service `proxy` in `compose.yaml`, or change `edge_services` in
  `security/trivy/checks/compose_r8_ports.rego`.
- S6 must scan the rendered NGINX config (after the template step), because `deploy/nginx/templates/`
  holds `envsubst` templates. Render them with the staging values, or copy `/etc/nginx` out of the
  running `proxy` container.
- S5 must scan the output of `kustomize build`, not the raw files, as the policy says.
- The project checks are code. A change to them needs a review by the Security Specialist.

## Decisions for the user

| ID | Decision | Default in this ADR |
|---|---|---|
| T1 | Run the scanners as pinned container images instead of their third-party Actions. | Containers by digest. Only GitHub-owned Actions. |
| T2 | Use Gitleaks, which gets security fixes only, for S7. | Gitleaks 8.30.1. Examine Betterleaks again when its version 2 is stable, because version 2 removes SARIF. |
| T3 | The S7 gate scans the file systems of the images with Gitleaks. Base images can give false positives (1 in the node image). | Gitleaks with one exception for each false positive. The Trivy secret result is for information only. |

## Sources

- Trivy advisory GHSA-69fq-xp46-6x23 (affected versions, safe versions, time windows): https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23
- Microsoft: guidance on the Trivy supply chain compromise (2026-03-24): https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/
- Socket: Trivy GitHub Actions tag compromise: https://socket.dev/blog/trivy-under-attack-again-github-actions-compromise
- Snyk: Trivy GitHub Actions supply chain compromise: https://snyk.io/articles/trivy-github-actions-supply-chain-compromise/
- Dark Reading: KICS supply chain attack: https://www.darkreading.com/application-security/checkmarx-kics-code-scanner-widening-supply-chain
- Trend Micro: analysis of the TeamPCP attacks (KICS): https://www.trendmicro.com/en_us/research/26/e/analyzing-teampcp-supply-chain-attacks.html
- Wiz: Checkmarx KICS and Bitwarden CLI incident: https://threats.wiz.io/all-incidents/checkmarx-kics-and-bitwarden-cli-compromised-in-fresh-supply-chain-attack
- TeamPCP timeline (community): https://teampcp.pluto.security/
- CISA: tj-actions/changed-files, CVE-2025-30066: https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-github-action-cve-2025-30066
- Wiz: reviewdog/action-setup, CVE-2025-30154: https://www.wiz.io/blog/new-github-action-supply-chain-attack-reviewdog-action-setup
- Praetorian: CodeQLEAKED, CVE-2025-24362: https://www.praetorian.com/advisories/codeqleaked-codeql-action-secret-exposure/
- CISA: npm ecosystem compromise (Shai-Hulud, 2025-09-23): https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem
- Gitleaks README (feature complete, security fixes only): https://github.com/gitleaks/gitleaks
- Betterleaks releases (v2 removes SARIF): https://github.com/betterleaks/betterleaks/releases
- gixy-ng: https://github.com/dvershinin/gixy and https://gixy.getpagespeed.com
- Gixy-Next: https://pypi.org/project/Gixy-Next
- zizmor: https://docs.zizmor.sh
- Version data: the PyPI JSON API (gixy-ng, Gixy-Next, gixy, zizmor, checkov, semgrep), the Docker Hub tag API (Trivy, Gitleaks, TruffleHog, gixy) and `git ls-remote --tags` on each GitHub repository, all read on 2026-10-12.
