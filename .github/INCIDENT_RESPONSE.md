# n8n-mcp Incident Response Plan

This document is the playbook the n8n-mcp maintainer follows when a security incident is active. It is not a replacement for ordinary bug triage -- regular contributions and bug reports still flow through the process described in [`CONTRIBUTING.md`](../CONTRIBUTING.md). For instructions on how to *report* a security vulnerability, see [`SECURITY.md`](../SECURITY.md).

n8n-mcp is a TypeScript MCP server distributed via NPM (`npx n8n-mcp`) and Docker images on GHCR (`ghcr.io/czlonkowski/n8n-mcp`). The incidents this plan covers reflect that reality: a single maintainer, two distribution channels (NPM + GHCR), and a security boundary that is the n8n API itself, not n8n-mcp.

The hosted service at **n8n-mcp.com** has its own incident response procedures. Patched versions are deployed to the hosted service immediately after the NPM release.

## Values

Every decision during an incident balances three values:

- **Transparency** -- users and reporters deserve honest, timely information about what happened and what to do.
- **Protection** -- premature disclosure without a patch is a roadmap for attackers; users must be safe before details go public.
- **Stewardship** -- the response must respect the open source ecosystem, credit reporters, and strengthen trust in the project.

When these values conflict mid-incident, refer back to them explicitly. Having articulated them in advance saves grief when improvisation is needed.

## What counts as an incident

Four categories, with n8n-mcp-specific examples:

- **Security vulnerability / CVE** -- e.g. authentication bypass in the HTTP transport, credential leakage through MCP tool responses, injection in n8n-mcp's own code, or a dependency vulnerability with a viable exploit path through n8n-mcp's public API.
- **Supply-chain compromise** -- e.g. a malicious commit reaches `main`, NPM publish credentials or GHCR tokens are leaked, or a tampered package/image is published to the registry.
- **Critical regression** -- e.g. a released version exposes n8n API tokens in tool output, silently drops validation, or breaks all MCP connections with no workaround.
- **Infra / CI incident** -- e.g. GitHub Actions workflows are compromised, CodeQL flags a real finding, or the automated release pipeline publishes unintended content.

Ordinary bugs filed as issues are *not* incidents -- they follow the normal contribution flow.

## Severity levels

| Severity | Definition | n8n-mcp example |
|---|---|---|
| **Critical** | Active exploitation or supply-chain compromise; users must stop using a version immediately. | Compromised NPM package or Docker image; leaked publish credentials with evidence of misuse; authentication bypass allowing unauthenticated access to n8n API operations. |
| **High** | Released version contains an undisclosed security flaw with no workaround, or a confirmed CVE with CVSS >= 7. | Credential leakage in MCP tool responses; injection vulnerability reachable through standard MCP tool calls. |
| **Medium** | Security flaw with significant preconditions or limited scope; workaround exists; or the release pipeline is blocked. | Vulnerability requiring attacker to already have local access; dependency CVE with constrained reachability through n8n-mcp; CI pipeline compromised but no artifacts published. |
| **Low** | Defense-in-depth finding, hardening gap, or narrow denial-of-service with no data exposure. | Missing rate limiting on HTTP transport; CodeQL finding with no demonstrated exploit path; information disclosure requiring non-default configuration. |

Supply-chain incidents are always treated as **Critical** regardless of other factors.

## Response flow

Every incident follows four phases. The first step of every phase is the same: make yourself a cup of coffee, find your calm, and proceed deliberately.

### Phase 1: Triage

**Goal:** Confirm this is real, determine severity, and open the tracking artifact.

1. Acknowledge the report within **72 hours** via GitHub Private Vulnerability Reporting. Ask the reporter for their preferred credit (name, handle, or anonymous) and whether they plan to disclose independently.
2. Reproduce the issue against the latest release and `main`.
3. Classify: Is this a security vulnerability or a hardening/non-security finding? Use the [SECURITY.md scope](../SECURITY.md) to determine in-scope vs. out-of-scope.
4. Assess severity using the table above. Consider:
   - **Confidentiality, Integrity, or Availability** -- which are breached?
   - **Exploitability** -- what preconditions are needed? Is it reachable through n8n-mcp's public MCP tool surface?
   - **Impact** -- does this affect stdio users, HTTP users, or both?
5. Determine if the issue is upstream (in n8n packages, MCP SDK, or another dependency) or in n8n-mcp's own code. If upstream, coordinate with the upstream maintainer.
6. Open a **draft GitHub Security Advisory (GHSA)** -- this is the single source of truth for the incident. Do **not** open a public issue.

### Phase 2: Mitigation

**Goal:** Stop the bleeding, then fix the root cause.

**Immediate containment (stop the bleed):**
- If the vulnerability is in a specific MCP tool: disable or restrict that tool in a patch release.
- If credentials are at risk: rotate them immediately -- NPM token first (stops further publishes), then GHCR/GitHub PATs, then any other secrets.
- If a bad package was published to NPM: publish a superseding patch version immediately, then `npm deprecate` the bad version with a message directing users to upgrade.
- If a bad Docker image was published to GHCR: push a superseding image tag immediately and delete the compromised tag from GHCR if possible (`gh api -X DELETE` on the package version).

**Root cause fix:**
1. Develop the fix on the private fork created by the GitHub Security Advisory.
2. Write a regression test that fails before the fix and passes after.
3. Keep the PR description deliberately vague if the fix will be visible before disclosure ("Fix edge case in transport handling" rather than describing the vulnerability).
4. Self-review the fix. If another trusted contributor is available, request their review on the private fork.

**Distribution-specific considerations:**
- **NPM:** Most n8n-mcp users run via `npx`, which fetches the latest version on each invocation. Patches propagate quickly once published. NPM does not support deleting published versions -- use `npm deprecate` for bad versions and publish a clean superseding version.
- **Docker:** Docker users pin to specific tags (e.g. `ghcr.io/czlonkowski/n8n-mcp:v2.47.6`). Unlike NPM, GHCR allows deleting image tags. Push a patched image under a new version tag and update the `latest` tag. Consider deleting the compromised tag if it has not been widely pulled.
- Use telemetry (if available) to gauge adoption percentage before proceeding to disclosure.

### Phase 3: Disclosure

**Goal:** Inform users without giving attackers a head start.

1. **Before disclosure:** Merge the private-fork fix into `main` using the advisory's merge button. Confirm CI is green. Cut a patch release -- this triggers the automated pipeline that publishes the NPM package and builds Docker images. Verify both artifacts are published.
2. **Timing decision:**
   - For **Critical/High**: coordinate a disclosure date with the reporter, targeting within 90 days of the report. If telemetry is available, consider waiting until a meaningful adoption threshold (e.g. >50% of active users on the patched version) before publishing the advisory.
   - For **Medium/Low**: patch in the next regular release cycle and document in the changelog.
3. **Publish the advisory:**
   - Publish the GHSA (GitHub auto-publishes the CVE via its CNA service).
   - Include: CVE identifier, affected version range, fixed version, vulnerability class description (without full exploit details), CVSS score, reporter credit (with consent), and upgrade instructions (`npx n8n-mcp@latest` or `docker pull ghcr.io/czlonkowski/n8n-mcp:latest`).
4. **Update the changelog:** Add a `### Security` entry under the new version in `CHANGELOG.md` with the CVE identifier, a brief description, and reporter credit. This is the project's primary communication channel for releases -- there are no separate release notes.
5. **Credit the reporter** unless they decline. Mention them in the advisory and the `CHANGELOG.md` entry.

**CVE threshold policy:** n8n-mcp requests CVEs for confirmed vulnerabilities rated **Medium or above**. Low-severity hardening findings are documented in the changelog without a CVE. This threshold may be revised as the project matures.

### Phase 4: After-action

**Goal:** Learn from the incident and improve.

1. Write a brief post-incident summary (use the template below).
2. Identify **Post-Incident Repair Items (PIRs)** -- larger improvements that require follow-up work (e.g. "add input validation for X", "improve logging for Y").
3. Open GitHub issues for each PIR and track them to completion.
4. Update this IRP if the process revealed gaps.
5. Take a break. Incidents are stressful, even small ones.

## Playbooks

### A. Security vulnerability / CVE

1. Acknowledge receipt within 72 hours via Private Vulnerability Reporting.
2. Reproduce against latest release and `main`; assign severity.
3. Open a draft GHSA. Request a CVE via the GHSA for Medium+ severity.
4. Develop the fix on the advisory's private fork; add a regression test.
5. Merge the fix, cut a patch release, verify both NPM package and Docker image.
6. Coordinate disclosure timing with the reporter.
7. Publish the GHSA. Add a `### Security` entry to `CHANGELOG.md`. Credit the reporter.

### B. Supply-chain compromise

1. **Rotate credentials immediately:** NPM token first (stops further publishes), then GHCR/GitHub PATs, then any other secrets.
2. Assess blast radius: did a tampered package reach NPM? A tampered image reach GHCR? Were any commits pushed to `main`?
3. If a bad NPM package was published: publish a superseding version, `npm deprecate` the bad one with a clear message.
4. If a bad Docker image was published: push a superseding image, delete the compromised tag from GHCR if possible, update the `latest` tag.
5. Audit recent commits against known-good state (`git log --verify-signatures` if GPG signing is in use).
6. Open a Critical-severity tracking issue. Freeze further releases until the root cause is identified.
7. Publish a GHSA describing the scope and required user actions.

### C. Critical regression

1. Reproduce the regression. Use `git bisect` to find the introducing commit.
2. Open a pinned GitHub issue titled `[REGRESSION <version>] ...`.
3. Post a user-facing workaround within 24 hours (e.g. pin to a prior version: `npx n8n-mcp@<safe-version>` or `ghcr.io/czlonkowski/n8n-mcp:<safe-version>`).
4. Fix, add a regression test, cut a patch release.
5. Update `CHANGELOG.md` and close the pinned issue.

### D. Infra / CI incident

1. Check [githubstatus.com](https://www.githubstatus.com) -- if the cause is upstream, monitor and wait.
2. If it is our workflow: disable the affected action (`if: false`) to unblock contributors.
3. Root-cause. Common suspects: action version drift, dependency cache corruption, CodeQL rule updates.
4. Fix in a focused PR. Re-enable the workflow.
5. Escalate to a higher severity only if the incident allowed unauthorized code execution or artifact publication.

## Communication channels

| Incident type | Private tracking | Public acknowledgement | Resolution announcement |
|---|---|---|---|
| Security / CVE | GitHub Security Advisory | Only after fix is released | GHSA publish + `### Security` entry in `CHANGELOG.md` |
| Supply-chain | Direct maintainer action + GHSA | Pinned issue + NPM deprecation notice + GHCR tag deletion | GHSA publish + `CHANGELOG.md` entry |
| Critical regression | None (public) | Pinned GitHub issue within 24 hours | Issue closed + `CHANGELOG.md` entry |
| Infra / CI | None | Issue if contributor-blocking | Close the issue |

## Upstream and downstream awareness

**Upstream dependencies to monitor:**
- `@modelcontextprotocol/sdk` -- MCP protocol implementation
- `n8n-workflow`, `n8n-nodes-base` -- node definitions and metadata
- `better-sqlite3`, `sql.js` -- database layer
- `express` -- HTTP transport

**Downstream consumers:**
- **n8n-mcp.com hosted service** -- runs the OSS package as its core; a vulnerability here affects ~5,500 registered users directly
- Claude Desktop / Claude Code users (stdio transport via `npx`)
- Docker deployments (self-hosted HTTP via GHCR images, Railway-optimized image)
- Any AI assistant connecting via MCP

For Critical/High incidents affecting downstream users, consider proactive notification through `npm deprecate` warnings and GHCR tag management.

## Post-incident summary template

```markdown
## Incident Summary

**Date:** YYYY-MM-DD
**Severity:** Critical / High / Medium / Low
**CVE:** CVE-YYYY-NNNNN (if applicable)

### What happened
One paragraph: what was the vulnerability, how was it reported, what was the impact.

### Root cause
Specific condition or logic gap that allowed the vulnerability.

### Timeline
- YYYY-MM-DD: Report received
- YYYY-MM-DD: Acknowledged, triage started
- YYYY-MM-DD: Fix developed and tested
- YYYY-MM-DD: Patch release published
- YYYY-MM-DD: Advisory published

### What went well
Bullet points.

### What could be improved
Bullet points.

### Post-Incident Repair Items
- [ ] PIR-1: Description (link to issue)
- [ ] PIR-2: Description (link to issue)
```

## Secrets and rotation

This IRP does not store secrets. This section indexes which secrets drive releases and CI, so rotation during an incident hits everything in one pass.

| Secret | Purpose | Rotation path |
|---|---|---|
| NPM publish token | Publishes packages to NPM registry | Revoke on npmjs.com, generate new token, update GitHub repo secret |
| `GITHUB_TOKEN` (Actions) | CI workflows, GHCR image pushes, and release automation | Managed by GitHub Actions; rotate PATs if used |

**Rotation order during a suspected compromise:** NPM token first (stops further NPM publishes), then GitHub PATs (stops GHCR pushes and CI).

## Maintenance

This document is reviewed after every Critical or High incident, and at least once per year. Changes are made via normal PRs.
