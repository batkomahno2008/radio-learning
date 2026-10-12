# Security policy

This policy tells what the pipeline must scan and when a finding must stop a release.
Issue #4 selects the tools for this policy. Issue #16 applies the edge controls in NGINX.
This document names no tool. The words "the scanner" mean the tool that #4 selects for a target.

## 1. Terms

| Term | Meaning |
|---|---|
| Finding | One problem that a scan reports, with an ID (for example a CVE ID or a rule ID). |
| Severity | The severity that the scanner gives. If the scanner gives no severity, use the CVSS base score. CRITICAL: 9.0 to 10.0. HIGH: 7.0 to 8.9. MEDIUM: 4.0 to 6.9. LOW: 0.1 to 3.9. |
| Fix available | A newer version of the package or the base image removes the finding. |
| Gate violation | A finding that agrees with the fail rule of its target in section 3 and has no valid exception. |
| Published image | `ghcr.io/batkomahno2008/radio-learning` or `ghcr.io/batkomahno2008/radio-learning-proxy`. |

## 2. Scan scope

The pipeline must scan each target in this table. Each row has a fail rule in section 3.

| ID | Target | What the scan examines |
|---|---|---|
| S1 | npm dependencies | All packages in `package-lock.json`, direct and transitive. |
| S2 | OS packages of the images | The `runtime` image, the `proxy` image and the `e2e` image. |
| S3 | Dockerfile | All stages of the multi-stage `Dockerfile`. |
| S4 | Compose files | `compose.yaml` and all files in `deploy/compose/`. |
| S5 | Kubernetes files | The rendered output of each Kustomize overlay in `deploy/k8s/`. |
| S6 | NGINX config | `deploy/nginx/nginx.conf` and `deploy/nginx/templates/`. |
| S7 | Secrets | All commits in the Git history, and the file system of each image. |
| S8 | Source code (SAST) | All JavaScript in the repository, server code and client code. |
| S9 | GitHub Actions workflows | `.github/workflows/` and `.github/actions/`. |
| S10 | HTTP headers of a running stack | The responses of NGINX on the staging stack (Compose and kind). |
| S11 | Supply chain | Action pins, base image pins, SBOM and provenance (section 8). |

## 3. Severity gate

### 3.1 General rule

- Fail on a CRITICAL or HIGH finding when a fix is available.
- Report all other findings only. They do not stop a release.
- A finding with a valid exception (section 5) is not a gate violation.

### 3.2 Pass or fail rule for each target

| ID | The scan fails when | The scan passes when |
|---|---|---|
| S1 | One or more CRITICAL or HIGH findings have a fix available. | The count of such findings is 0. |
| S2 | One or more CRITICAL or HIGH findings in the `runtime` or `proxy` image have a fix available. | The count of such findings is 0. The scan reports findings in the `e2e` image only. The pipeline does not publish that image. |
| S3 | One or more CRITICAL or HIGH misconfiguration findings occur, or a check of section 7 or 8.2 fails. | The count of such findings is 0. |
| S4 | One or more CRITICAL or HIGH misconfiguration findings occur, or a check of section 7 fails. | The count of such findings is 0. |
| S5 | One or more CRITICAL or HIGH misconfiguration findings occur, or a check of section 7 fails. | The count of such findings is 0. |
| S6 | One or more CRITICAL or HIGH misconfiguration findings occur, or a check of section 9 fails in the config. The TLS checks of 9.5 are part of S6. | The count of such findings is 0. |
| S7 | The scan finds one or more secrets. All severities count. | The count of secrets is 0. |
| S8 | One or more CRITICAL or HIGH findings occur. If the scanner gives a SARIF `security-severity`, a value of 7.0 or more is HIGH. | The count of such findings is 0. |
| S9 | One or more CRITICAL or HIGH findings occur, or a check of section 8.1 fails. | The count of such findings is 0. |
| S10 | One or more checks of 9.1, 9.2, 9.3, 9.4 or 9.6 fail on the running stack. | All these checks pass. |
| S11 | One or more checks of section 8 fail. | All checks of section 8 pass. |

For S3 to S9, "fix available" does not apply. A change to the file or the code is always possible.

The staging stacks use plain HTTP (D14). S10 runs the checks of 9.1 to 9.4 and 9.6 on them. S10 does not run the TLS checks of 9.5. S6 examines the TLS config.

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
| `report` | All scans run and upload their results (section 6). The job ends with success. The job summary shows the count of gate violations for each target. |
| `enforce` | All scans run and upload their results. The job fails when one or more gate violations occur. The job is a required status check on `main`. |

- The gate starts in `report` mode.
- Issue #13 changes the gate to `enforce` mode after the remediation.
- A required status check on `main` needs admin access to the repository. Issue #13 must ask the user to set it.
- Keep the mode in one setting in the repository, so that one change switches all scans.
- Do not publish a release tag (`vX.Y.Z`) while the gate is in `report` mode.

## 5. Exceptions

An exception lets a known finding stay open. Most exceptions have a limited time. Only a revoked secret has no expiry (5.1).

### 5.1 Rules

- Keep the exceptions for each tool in one file in the repository. Issue #4 sets the file name and the format.
- Each exception must have all fields of the table in 5.2. The scan must ignore an exception that has a missing field.
- An exception applies to one finding ID in one target. Do not use wildcards.
- Use these maximum times to expiry:
  - CRITICAL finding: 30 days.
  - HIGH finding: 90 days.
  - Finding with no severity, or a failed check of section 7, 8 or 9: 90 days.
  - Secret that you revoked or rotated (3.3): no expiry. Write `never` in `expires`. Write the revocation date in `reason`.
- After the expiry date, the finding is a gate violation again. Extend an exception only with a new review.
- The Security Specialist (`role:security`) approves each new exception in the pull request review.

### 5.2 Fields

| Field | Example | Rule |
|---|---|---|
| `id` | `EXC-001` | Unique in the repository. Do not use an ID again. |
| `finding` | `CVE-2026-12345` | The ID that the scanner reports. |
| `target` | `S2 runtime image` | One target from section 2. |
| `reason` | No fix is available upstream. The vulnerable function is not used. | Tell why the risk is acceptable. |
| `owner` | `@batkomahno2008` | A person or a role label. The owner removes the exception when a fix is available. |
| `expires` | `2026-12-31` | ISO 8601 date, or `never` for a revoked secret only. Section 5.1 gives the maximum. |

## 6. Reporting

- Upload the results of each scan as SARIF to the GitHub Security tab (code scanning).
- Give each scan its own SARIF category. Then the results of one target do not replace the results of a different target.
- Upload the results also in `report` mode and also when the scan fails.
- Some targets make no SARIF (for example S10 and S11). Write the result of each of their checks in the job summary.
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
- The S11 check fails when a published image has no SBOM or no provenance attestation.

## 9. Edge controls (NGINX)

NGINX owns these controls (D12). The S6 scan examines the config. The S10 scan examines the responses of the running stack.

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

NGINX sends `Strict-Transport-Security` on each response, also on plain HTTP. Browsers ignore this header over HTTP, so it causes no problem. Thus #16 owns HSTS in Compose and in Kubernetes. In Kubernetes, the cluster edge must not remove the header. The deployment guide (#12) must tell this.

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

The check fails when one of these conditions occurs:

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

The S10 check sends more requests than the limit and expects at least one `429`. Run this check after the E2E suite is complete. Then a `429` cannot fail an E2E scenario through the clean-console rule.

### 9.4 Body size

- The maximum request body is 16 KiB. A larger body gets `413`.
- The S10 check sends a body of 32 KiB to `POST /api/ratings` and expects `413`.

### 9.5 TLS

These rules apply where NGINX stops TLS (Compose, D14).

- Accept TLS 1.2 and TLS 1.3 only. A TLS 1.0 or TLS 1.1 handshake must fail.
- For TLS 1.2, use only ECDHE key exchange with AEAD ciphers (AES-GCM or ChaCha20-Poly1305).
- Keep the private key out of Git and out of images. Give the key file mode `0600` or `0640`, and only the NGINX user can read it.
- Certificate tools usually write the private key with owner `root` and mode `0600`. The unprivileged NGINX user cannot read such a file. The deployment guide (#12) must tell the operator to give the key file to the NGINX user or group.
- Send HTTP on port 8080 to HTTPS with a `301` redirect, except `/healthz`.

In Kubernetes, the cluster edge stops TLS (D11). The operator must apply the same TLS minimum at the edge. The deployment guide (#12) must tell this.

### 9.6 Version disclosure

- The `Server` header must not show a version. Use `server_tokens off`.
- Error pages must not show a version.

## 10. Schedule

| Event | Targets | Gate |
|---|---|---|
| Each pull request into `main` | S1 to S11 | Mode of section 4. |
| Each push to `main` | S1 to S11 | Mode of section 4. |
| Each night | S1, S2, S7 and S11 against the latest published images (`main` and `latest` tags) | Report only. A new gate violation opens an issue with the label `security`. The issue holds only the finding ID, the target and the severity. |

New vulnerabilities appear after a release, so the night scan must use the published images and not a new build.

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
