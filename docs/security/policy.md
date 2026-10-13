# Security policy

This policy tells what the pipeline must scan and when a finding must stop a release.
Issue #11 puts the scans in CI. Issue #16 applies the edge controls in NGINX.

Decision of the user (epic #1, 2026-10-13): the project writes no custom scanner, rule, script
or exception tool. The pipeline uses existing tools and their official GitHub Actions only.
Section 2 names the tool for each target. The words "the scanner" mean that tool.

## 1. Terms

| Term | Meaning |
|---|---|
| Finding | One problem that a scan reports, with an ID (for example a CVE ID or a rule ID). |
| Severity | The severity that the scanner gives. If the scanner gives no severity, use the CVSS base score. CRITICAL: 9.0 to 10.0. HIGH: 7.0 to 8.9. MEDIUM: 4.0 to 6.9. LOW: 0.1 to 3.9. |
| Fix available | A newer version of the package or the base image removes the finding. |
| Gate violation | A finding that agrees with the fail rule of its target in section 3 and has no valid exception. |
| Published image | `ghcr.io/batkomahno2008/radio-learning` or `ghcr.io/batkomahno2008/radio-learning-proxy`. |

## 2. Scan scope and tools

The pipeline must scan each target in this table. Each row has a fail rule in section 3.
The workflow `.github/workflows/security.yml` runs all scans. Section 2.1 gives the versions.

| ID | Target | What the scan examines | Tool |
|---|---|---|---|
| S1 | npm dependencies | All packages in `package-lock.json`: direct, transitive and dev. | Trivy (`fs` scan) |
| S2 | OS packages of the images | The `runtime` image and the `proxy` image. The `e2e` image is a report only. | Trivy (`image` scan) |
| S3 | Dockerfile | All stages of the multi-stage `Dockerfile`. | Trivy (`config` scan) |
| S4 | Compose files | `compose.yaml` and all files in `deploy/compose/`. | KICS |
| S5 | Kubernetes files | All files in `deploy/k8s/`. | Trivy (`config` scan) |
| S6 | NGINX config | The config that the `proxy` image renders at start (`nginx -T`). | Gixy-Next |
| S7 | Secrets | All commits in the Git history, and the files of the `runtime` and `proxy` images. | gitleaks (history), Trivy (images) |
| S8 | Source code (SAST) | All JavaScript in the repository, server code and client code. | CodeQL |
| S9 | GitHub Actions workflows | `.github/workflows/` and `.github/actions/`. | zizmor, CodeQL |
| S10 | HTTP headers of a running stack | No scan. See 2.2. | – |
| S11 | Supply chain | Action pins are part of S9. No scan checks the other parts. See 2.2. | zizmor (pins) |

### 2.1 Tools and pinned versions

Each tool is an existing tool. Each Action is pinned to a full commit SHA. Each tool image is pinned to a digest.
The tag or version is for the reader.

| Tool | Version | How it runs | Pin |
|---|---|---|---|
| Trivy | v0.75.0 | `aquasecurity/trivy-action` v0.36.0 | `ed142fd0673e97e23eac54620cfb913e5ce36c25` |
| KICS | v2.1.20 | The image `checkmarx/kics` | `sha256:3e5a268eb8adda2e5a483c9359ddfc4cd520ab856a7076dc0b1d8784a37e2602` |
| Gixy-Next | 0.8.0 | The image `megamansec/gixy-next` | `sha256:e25808a033b553c1d4189f98c9d96ebd5bd1cf89b3e9f482842bbf6f8023db09` |
| gitleaks | v8.30.1 | The image `ghcr.io/gitleaks/gitleaks` | `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |
| CodeQL | The bundle that the Action selects | `github/codeql-action` v4.38.0: `init`, `analyze` and `upload-sarif` | `b96794f015dfd88f77b49b1c93e0fa7110f94c63` |
| zizmor | 1.30.1 | `zizmorcore/zizmor-action` v0.6.4. The Action runs the zizmor image by digest. | `cc914d7f3750a2d13d75c7f184a1060aa0e9d482` |

- The KICS Action builds a new image at each run from an unpinned base image. So the workflow runs the official KICS image.
- The gitleaks Action needs a license for an organization, and it scans only the commits of a pull request. So the workflow runs the official gitleaks image.
- Gixy-Next has no Action. The workflow runs its official image.
- The Trivy Action installs the Trivy binary by version number. So the Trivy binary has a version pin, and the Action has a SHA pin.
- Change a version and its pin together. The `env` block of `security.yml` holds the tool versions and the image digests.
- CodeQL uses the default query suite for `javascript-typescript` and for `actions`.

### 2.2 What the scans do not cover

The user decided that the project writes no custom checks. So some rules of this policy have no automatic check.
A reviewer checks them in each pull request that changes the related files.

- **S10 (headers of a running stack).** The values of 9.1, 9.3, 9.4 and 9.6 need requests to a running stack. No existing tool in section 2 does this. The E2E suite fails on a CSP violation (9.2). It does not check the other values.
- **S11 (supply chain).** The `publish` job creates the SBOM and the provenance (8.3). No scan checks them. No scan checks the digest pins of base images (8.2).
- **TLS (9.5).** Gixy-Next does not check protocols and ciphers. The render step has no TLS file.
- **Run-time baseline (section 7).** The built-in checks of Trivy and KICS apply. No scan proves R8 (only NGINX is reachable) or R9 (no secret in a manifest) completely.
- **Postgres image.** The pipeline does not build it, so the scans do not examine it.

## 3. Severity gate

### 3.1 General rule

- Fail on a CRITICAL or HIGH finding when a fix is available.
- Report all other findings only. They do not stop a release.
- A finding with a valid exception (section 5) is not a gate violation.

### 3.2 Pass or fail rule for each target

Each gate is a setting of the tool itself. The workflow has no gate logic of its own, except for CodeQL (see S8).

| ID | The scan fails when | The scan passes when |
|---|---|---|
| S1 | Trivy finds one or more CRITICAL or HIGH vulnerabilities that have a fix available (`--severity CRITICAL,HIGH --ignore-unfixed`). | The count of such findings is 0. |
| S2 | Trivy finds one or more CRITICAL or HIGH vulnerabilities that have a fix available, in the `runtime` or `proxy` image. | The count of such findings is 0. The scan reports findings in the `e2e` image only. The pipeline does not publish that image. |
| S3 | Trivy finds one or more CRITICAL or HIGH misconfigurations. | The count of such findings is 0. |
| S4 | KICS finds one or more CRITICAL or HIGH results (`--fail-on high,critical`). | The count of such results is 0. |
| S5 | Trivy finds one or more CRITICAL or HIGH misconfigurations. | The count of such findings is 0. |
| S6 | Gixy-Next finds one or more problems, of any level. Gixy-Next gives the level LOW to its weakest checks, for example version disclosure (9.6). | The count of problems is 0. |
| S7 | gitleaks finds one or more secrets in the history, or Trivy finds one or more secrets in an image. All severities count. | The count of secrets is 0. |
| S8 | CodeQL gives one or more results with a `security-severity` of 7.0 or more. The summary step of the workflow counts them. | The count of such results is 0. |
| S9 | zizmor finds one or more problems of level MEDIUM or higher, or CodeQL gives one or more results with a `security-severity` of 7.0 or more. MEDIUM covers the checks of 8.1. | The count of such findings is 0. |
| S10 | – (no scan) | – |
| S11 | – (no scan). The pins of S9 follow the S9 rule. | – |

For S3 to S9, "fix available" does not apply. A change to the file or the code is always possible.

The staging stacks use plain HTTP (D14). No scan examines the TLS config of 9.5 (see 2.2).

### 3.3 Special rule for secrets

An attacker can use a secret that gets into the Git history, also after you remove the commit.
If S7 finds a real secret, do these steps in the same day:

1. Revoke or rotate the secret.
2. Record the incident in a private security advisory of the repository. The repository is public, so do not use a public issue.
3. Add an exception for the old commit only after step 1 is complete (see 5.1).

A public issue or a public comment must not hold a secret value or the details of an exploit.

## 4. Rollout mode

The gate has two modes.

| Mode | Behavior |
|---|---|
| `report` | All scans run and upload their results (section 6). The job ends with success. The job summary shows the count of results for each severity, and the gate result of each scan. |
| `enforce` | All scans run and upload their results. The job fails when one or more gate violations occur. The job is a required status check on `main`. |

- The gate starts in `report` mode.
- Issue #13 changes the gate to `enforce` mode after the remediation.
- A required status check on `main` needs admin access to the repository. Issue #13 must ask the user to set it.
- The input `mode` of `.github/workflows/security.yml` sets the mode. The `security` job in `ci.yml` gives the value. Change that one line to switch all scans.
- The night scan always runs in `report` mode.
- The `publish` job waits for the `security` job.
- Do not publish a release tag (`vX.Y.Z`) while the gate is in `report` mode.

## 5. Exceptions

An exception lets a known finding stay open. Most exceptions have a limited time. Only a revoked secret has no expiry (5.1).

### 5.1 Rules

- Accept a risk only in the own ignore file of the tool, or by a dismissal in the Security tab. Section 5.3 lists the places.
- Do not write an exception tool, an exception file format or a check of the exceptions.
- Each exception must have all fields of the table in 5.2. The ignore files of the tools have no such fields. So write the fields in comment lines above the entry.
- An exception applies to one finding ID in one target. Do not use wildcards.
- Use these maximum times to expiry:
  - CRITICAL finding: 30 days.
  - HIGH finding: 90 days.
  - Finding with no severity, or a failed check of section 7, 8 or 9: 90 days.
  - Secret that you revoked or rotated (3.3): no expiry. Write `never` in `expires`. Write the revocation date in `reason`.
- After the expiry date, the finding is a gate violation again. Remove the entry. Extend an exception only with a new review.
- The Security Specialist (`role:security`) approves each new exception in the pull request review. The reviewer rejects an exception that has a missing field.

### 5.2 Fields

| Field | Example | Rule |
|---|---|---|
| `finding` | `CVE-2026-12345` | The ID that the scanner reports. |
| `target` | `S2 runtime image` | One target from section 2. |
| `reason` | No fix is available upstream. The vulnerable function is not used. | Tell why the risk is acceptable. |
| `owner` | `@batkomahno2008` | A person or a role label. The owner removes the exception when a fix is available. |
| `expires` | `2026-12-31` | ISO 8601 date, or `never` for a revoked secret only. Section 5.1 gives the maximum. |

### 5.3 Where to write an exception

| Tool | Place | Note |
|---|---|---|
| Trivy | `.trivyignore` in the repository root | One finding ID on each line. Add `exp:YYYY-MM-DD` to the line. Trivy reads the file by itself and stops to honor an entry after its date. |
| gitleaks | `.gitleaksignore` in the repository root | One fingerprint on each line. A line that starts with `#` is a comment. The workflow gives the file to gitleaks. |
| KICS | A comment in the scanned file: `# kics-scan ignore-line` or `# kics-scan ignore-block` | Write the fields in the comment lines above. |
| Gixy-Next | The `--skips` flag in the Gixy-Next step of `security.yml` | Name the check. Write the fields in the comment lines above the step. |
| zizmor | `.github/zizmor.yml`, key `rules.<rule>.ignore` | zizmor reads the file by itself. Write the fields in YAML comments. |
| CodeQL | A dismissal of the alert in the Security tab | Write the fields in the comment of the dismissal. |

Example of a Trivy entry:

```text
# Finding: CVE-2026-12345, target S2 runtime image.
# Reason: No fix is available upstream. The vulnerable function is not used.
# Owner: @batkomahno2008
CVE-2026-12345 exp:2026-12-31
```

## 6. Reporting

- Upload the results of each scan as SARIF to the GitHub Security tab (code scanning).
- Give each scan its own SARIF category. Then the results of one target do not replace the results of a different target.
  The categories are `trivy-npm`, `trivy-dockerfile`, `trivy-kubernetes`, `kics-compose`, `gitleaks`, `zizmor`,
  `trivy-image-runtime`, `trivy-image-proxy`, `trivy-image-e2e`, `gixy-nginx`, and the two CodeQL categories `/language:javascript-typescript` and `/language:actions`.
- Upload the results also in `report` mode and also when the scan fails.
- Write a summary table in the job summary: the count of results for each tool and severity, and the gate result of each scan.
- The workflow also keeps the SARIF files as the artifacts `security-sarif-*` for 7 days.
- Keep the SBOM of each published image as an attestation in the registry (section 8.3).

## 7. Run-time baseline

These rules apply to each container in Compose and in Kubernetes. The S3, S4 and S5 scans examine them.

| ID | Rule | Kubernetes | Compose |
|---|---|---|---|
| R1 | Run as a non-root user with a numeric UID that is not 0. | `runAsNonRoot: true`, `runAsUser` not 0 | `user:` with a numeric UID that is not 0 |
| R2 | Use a read-only root file system. Mount writable `emptyDir` or `tmpfs` volumes only where the process must write. | `readOnlyRootFilesystem: true` | `read_only: true` |
| R3 | Drop all Linux capabilities. Do not add capabilities. | `capabilities: { drop: [ALL] }` | `cap_drop: [ALL]` |
| R4 | Prevent privilege escalation. | `allowPrivilegeEscalation: false` | `security_opt: [no-new-privileges:true]` |
| R5 | Use the default seccomp profile. | `seccompProfile: { type: RuntimeDefault }` | Do not set `seccomp:unconfined`. |
| R6 | Do not mount a service account token. | `automountServiceAccountToken: false` | – |
| R7 | Set CPU and memory limits. | `resources.limits` | `deploy.resources.limits` or `mem_limit` |
| R8 | Make only NGINX reachable from outside. | Only the NGINX Service goes to the cluster edge. A NetworkPolicy lets only NGINX connect to the app, and only the app and the backup job connect to Postgres. | Only the NGINX service has `ports:`. The app and Postgres have no `ports:`. |
| R9 | Do not put a secret in an image, in a manifest or in a Compose file. | Use a `Secret`. | Use an env file or a secret file that is not in Git. |
| R10 | Do not run privileged containers or use host namespaces. | No `privileged`, `hostNetwork`, `hostPID`, `hostIPC` or `hostPath` | No `privileged`, `network_mode: host` or `pid: host` |

For R2, mount writable volumes only for these paths:

- Postgres: the data directory (a persistent volume), `/var/run/postgresql` and `/tmp`.
- NGINX: `/tmp` and `/etc/nginx/conf.d`. The template step writes the config to `/etc/nginx/conf.d` at start.
- App: `/tmp`, if the app must write.

If a container cannot obey a rule, add an exception with the reason (section 5).

## 8. Supply chain

### 8.1 GitHub Actions

- Pin each action to a full 40-character commit SHA. Put the version tag in a comment on the same line.
- Set `permissions: contents: read` at the top of each workflow. Give more permissions only to the job that needs them.
- Do not put untrusted input directly in a `run:` script. A pull request title and a branch name are untrusted input. Pass such input through an environment variable.
- Do not use the `pull_request_target` trigger with a checkout of the pull request code.

### 8.2 Base images and dependencies

- Pin each `FROM` image by digest (`image:tag@sha256:...`). Keep the tag for the reader.
- Pin each image in Compose files and Kubernetes manifests by digest, except the two published images. The published images use the tags of the shared contracts.
- Install npm packages with `npm ci` from `package-lock.json`.
- Keep dev dependencies out of the `runtime` image.

### 8.3 SBOM and provenance

- Make an SBOM (SPDX or CycloneDX) for each published image and each published tag.
- Make a provenance attestation for each published image.
- Attach both to the image in the registry.
- The `publish` job does this with BuildKit (`sbom: true`, `provenance: mode=max`) and with `actions/attest-build-provenance`. No scan checks the result (see 2.2).

## 9. Edge controls (NGINX)

NGINX owns these controls (D12). The S6 scan examines the rendered config with Gixy-Next. It does not compare the values in this section.
No scan examines the responses of a running stack (see 2.2). A reviewer checks the values in each pull request that changes `deploy/nginx/`.

### 9.1 Security headers

Each response from NGINX must have these headers, also error responses (use `always`).

| Header | Value |
|---|---|
| `Content-Security-Policy` | See 9.2. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` or stricter |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` as a minimum |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000` or more, on each response (HTTP and HTTPS) |

The responses must not have the `X-Powered-By` header. NGINX must remove it from the app responses.

NGINX sends `Strict-Transport-Security` on each response, also on plain HTTP. Browsers ignore this header over HTTP, so it causes no problem. So #16 owns HSTS in Compose and in Kubernetes. In Kubernetes, the cluster edge must not remove the header. The deployment guide (#12) must tell this.

### 9.2 Content Security Policy

The CSP must have these directives as a minimum. `STATION_ORIGINS` is the NGINX environment variable of the shared contracts.

| Directive | Value |
|---|---|
| `default-src` | `'self'` |
| `script-src` | `'self'` |
| `style-src` | `'self'` and `https://fonts.googleapis.com` (see decision U1 in section 11) |
| `font-src` | `'self'` and `https://fonts.gstatic.com` (see decision U1) |
| `img-src` | `'self'`, `data:` and `STATION_ORIGINS` |
| `media-src` | `'self'`, `blob:` and `STATION_ORIGINS` |
| `connect-src` | `'self'` and `STATION_ORIGINS` |
| `worker-src` | `'self'` and `blob:` |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |
| `form-action` | `'self'` |
| `frame-ancestors` | `'none'` |

The CSP is not acceptable when one of these conditions occurs. Only the third condition has an automatic check.

- `script-src` (or `default-src` when `script-src` is missing) has `'unsafe-inline'`, `'unsafe-eval'`, `data:`, `blob:`, `*` or `http:`.
- A directive in the table is missing.
- A browser logs a CSP violation during the staging E2E run, in a scenario that is not `@live` (the clean-console rule).

Add `upgrade-insecure-requests` only when the site uses HTTPS. On plain HTTP staging, it stops same-origin requests.

### 9.3 Rate limits

Use the client IP as the key. Set the real client IP from `X-Forwarded-For` only when the request comes from `REAL_IP_FROM`.

| Location | Limit for each client IP | Response above the limit |
|---|---|---|
| `POST /api/ratings` | 5 requests each second, burst 10 | `429` |
| Other `/api/*` | 20 requests each second, burst 40 | `429` |
| All locations | 20 open connections | `429` |

Keep the values in one place in the NGINX config template. Do not add an NGINX environment variable for them. A new variable changes the shared contracts (epic rule 10).

No scan checks these limits (see 2.2). The limits must not cause a `429` in the E2E suite, because the clean-console rule then fails a scenario.

### 9.4 Body size

- The maximum request body is 16 KiB. A larger body gets `413`.
- No scan checks this limit (see 2.2).

### 9.5 TLS

These rules apply where NGINX stops TLS (Compose, D14).

- Accept TLS 1.2 and TLS 1.3 only. A TLS 1.0 or TLS 1.1 handshake must fail.
- For TLS 1.2, use only ECDHE key exchange with AEAD ciphers (AES-GCM or ChaCha20-Poly1305).
- Keep the private key out of Git and out of images. Give the key file mode `0600` or `0640`, and only the NGINX user can read it.
- Certificate tools usually write the private key with owner `root` and mode `0600`. The unprivileged NGINX user cannot read such a file. The deployment guide (#12) must tell the operator to give the key file to the NGINX user or group.
- Send HTTP on port 8080 to HTTPS with a `301` redirect, except `/healthz`.

No scan checks these rules (see 2.2). A reviewer checks `deploy/nginx/tls/tls.conf` in each pull request that changes it.

In Kubernetes, the cluster edge stops TLS (D11). The operator must apply the same TLS minimum at the edge. The deployment guide (#12) must tell this.

### 9.6 Version disclosure

- The `Server` header must not show a version. Use `server_tokens off`.
- Error pages must not show a version.
- Gixy-Next checks `server_tokens` (the check `version_disclosure`) in the S6 scan.

## 10. Schedule

| Event | Targets | Gate |
|---|---|---|
| Each pull request into `main` | S1 to S9. The image scans use the images from the build artifact. | Mode of section 4. |
| Each push to `main` | S1 to S9. The image scans use the images from the build artifact. | Mode of section 4. |
| Each night | S1 to S9. The image scans (S2, S6 and S7) use the published images with tag `main`. The `e2e` image is not part of the night scan. | Report only. The results go to the Security tab. |

New vulnerabilities appear after a release, so the night scan must use the published images and not a new build.
The workflow does not open an issue for a new finding, because that needs custom code. The Security Specialist reads the Security tab.

## 11. Decisions for the user

These decisions have a default in this policy. The user can change them.

| ID | Decision | Default in this policy |
|---|---|---|
| U1 | The page loads web fonts from a third-party host today. | The CSP allows `https://fonts.googleapis.com` and `https://fonts.gstatic.com` for v1.0.0. This is an accepted risk (threat T12). Self-hosting the fonts removes the risk and the two origins. |
| U2 | Severity threshold of the gate. | CRITICAL and HIGH with a fix available (the recommendation of #3). |
| U3 | Maximum time to expiry of an exception. | 30 days for CRITICAL. 90 days for HIGH, for findings with no severity and for failed checks of sections 7, 8 and 9. `never` for a revoked secret, with the revocation date in `reason` (5.1). |
| U4 | Rate limit values. | The values of section 9.3, in one place in the NGINX config template. |

## 12. Threat list

| ID | Threat | Impact | Control | Owner issue |
|---|---|---|---|---|
| T1 | An attacker uses a known vulnerability in an npm package or an OS package. | Remote code execution in a container. | S1 and S2 scans with the gate. The run-time baseline (section 7) limits the damage. | #4, #11, #13 |
| T2 | The station host sends track metadata that contains HTML or script. | Script runs in the browser of the listener (XSS). | The client writes metadata as text, not as HTML. CSP `script-src 'self'` with no inline script. S8 scan. | #6, #16 |
| T3 | An attacker sends SQL in a track name or a client ID. | The attacker reads or changes the database. | Parameterized queries only. Input length checks in the API. S8 scan. | #6, #7 |
| T4 | A user makes many client IDs and votes many times for one track. | The rating counts are wrong. | Accepted risk. Ratings are anonymous by design and have no security value. The rate limit on `POST /api/ratings` makes the attack slow. | #16 |
| T5 | An attacker sends too many requests or very large bodies. | The app or Postgres stops. Listeners cannot use the page. | Rate limits, connection limits and the body size limit (section 9). CPU and memory limits (R7). A limit on database connections. | #6, #16, #9 |
| T6 | An attacker sends a false `X-Forwarded-For` header. | The attacker gets around the rate limits. Logs show wrong IPs. | NGINX uses `X-Forwarded-For` only from `REAL_IP_FROM`. The app trusts one proxy hop only (`TRUST_PROXY=1`). | #6, #16, #13 |
| T7 | An attacker connects to the app or to Postgres directly. | The attacker gets around the edge controls or reads the database. | Only NGINX is reachable from outside. NetworkPolicy in Kubernetes. No `ports:` for the app and Postgres in Compose (R8). | #8, #9 |
| T8 | An attacker gets code execution in a container and tries to get control of the host. | Control of the node or the Compose host. | Run-time baseline R1 to R6 and R10. | #8, #9 |
| T9 | A secret (Postgres password, TLS private key, registry token) gets into Git, an image or a log. | An attacker gets access to the database, the domain or the registry. | S7 scan of the history and the images. Secrets only in a `Secret` or a mounted file (R9). Key file mode (9.5). Secret incident steps (3.3). | #8, #9, #11, #12 |
| T10 | An attacker replaces a third-party action, a base image or an npm package with malicious code. | Malicious code runs in CI or in production. The attacker changes the published images. | SHA pins, digest pins, `npm ci`, minimal workflow permissions, SBOM and provenance (section 8). S9 scan. | #8, #10, #11 |
| T11 | A network attacker reads or changes the traffic, or a different site shows the page in a frame. | The attacker changes the page or tricks the listener into clicks. | TLS 1.2 or higher (9.5). HSTS from NGINX on each response, and the cluster edge keeps the header (9.1). `frame-ancestors 'none'` and `X-Frame-Options: DENY`. | #16, #12 |
| T12 | The third-party font host receives the IP address of each listener and can change the font style sheet. | Loss of privacy. A changed style sheet can change the look of the page, but it cannot run script. | Accepted risk for v1.0.0 (decision U1). The CSP allows only the two font origins for styles and fonts, and no third-party script. | #16 |
