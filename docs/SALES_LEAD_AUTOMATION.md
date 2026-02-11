# n8n Sales Lead Automation — HubSpot → Airtable Migration Plan

## Purpose

Migrate the CRM target in the existing n8n sales lead automation workflow from HubSpot to Airtable.

- Airtable serves as both the data store (lead repository) and CRM pipeline (kanban/view/filters).
- Migration applies as minimal patches to the existing workflow — no redesign.
- Lead sourcing via Apify runs as a **separate workflow**.
- Outbound & warm-up email handled by **Instantly.ai**.
- SendGrid remains **optional**, limited to transactional/system email only.

> **This document is NOT a from-scratch design.**
> It describes incremental PATCH operations applied on top of the existing workflow.

---

## Current Workflow Core (UNCHANGED)

The following structure is preserved exactly as-is:

```
Trigger: New Lead Webhook (POST /new-lead)
    │
    ▼
Format Lead Data
    ├── fullName
    ├── email
    ├── company
    ├── leadSource
    ├── leadScore
    └── createdAt
    │
    ▼
Check Lead Score (IF)
    ├── IF leadScore >= 50 → High Priority branch
    └── ELSE             → Low Priority / Nurture branch
```

> **Note:** The Clearbit enrichment node is optional and may remain disabled.

---

## Target Architecture

| Role | Service |
|---|---|
| CRM / Operational DB | **Airtable** |
| Orchestration & Decision Logic | **n8n** |
| Outbound Sales & Warm-up | **Instantly.ai** |
| Transactional / System Email | **SendGrid** (optional) |
| Lead Harvesting | **Apify** (separate workflow) |

---

## Airtable Base Design

### Table: Leads

| Field | Type | Notes |
|---|---|---|
| Lead ID | formula / autonumber | |
| Full Name | text | |
| Email | email | **unique** |
| Company Name | text | |
| Company | link to Companies | |
| Phone | text | optional |
| Source | single select | `Landing Page`, `Apify`, `Referral`, `Ads`, `Cold Outreach`, `Other` |
| Lead Score | number | |
| Status | single select | `New`, `Qualified`, `Nurture`, `Contacted`, `Meeting`, `Won`, `Lost` |
| Owner | text | single user |
| Last Touch At | date | |
| Created At | date | |
| Notes | long text | |

### Table: Companies

| Field | Type |
|---|---|
| Company Name | text (primary) |
| Domain | text |
| Industry | single select |
| Size | single select |
| Location | text |
| LinkedIn URL | url |
| Website | url |

### Table: Activities

| Field | Type | Notes |
|---|---|---|
| Lead | link to Leads | |
| Type | single select | `Email Sent`, `Call`, `Meeting`, `Note`, `Automation`, `Instantly Event` |
| Detail | long text | |
| Timestamp | date | |

---

## Patch Protocol

### PATCH-1: Replace HubSpot Nodes with Airtable

**Before:** HTTP Request nodes targeting `https://api.hubapi.com/crm/v3/objects/contacts`

**After:** Airtable upsert logic:

```
Airtable → Search Records (Leads)
  filterByFormula: {Email} = "{{ $json.email }}"
      │
      ▼
  IF → Record found?
      ├── TRUE  → Airtable Update Record (Leads)
      └── FALSE → Airtable Create Record (Leads)
```

**Field mapping:**

| Airtable Field | Expression |
|---|---|
| Full Name | `{{$json.fullName}}` |
| Email | `{{$json.email}}` |
| Company Name | `{{$json.company}}` |
| Source | `{{$json.leadSource}}` |
| Lead Score | `{{$json.leadScore}}` |
| Created At | `{{$json.createdAt}}` |

**Status logic:**

- Low Priority branch → `Status = Nurture`
- High Priority branch → `Status = Qualified`

---

### PATCH-2: Instantly.ai Integration (Outbound Sales)

SendGrid is **NOT** used for nurture/outbound sequences.

**High Priority branch additions:**

1. Call Instantly.ai API / Webhook to:
   - Add lead to contact list
   - Start campaign / sequence
2. Instantly events (reply, opened, bounced, etc.) received via n8n webhook
3. Events logged to Airtable **Activities** table:
   - `Type`: `Instantly Event`
   - `Detail`: event payload summary

---

### PATCH-3: SendGrid Role (Reduced Scope)

SendGrid is retained **only** for:

- System notifications (e.g. "Your submission has been received")
- Internal team alerts

If a SendGrid node already exists in the workflow:

- **Do not remove it**
- Remove it from sales/nurture logic paths

---

### PATCH-4: Apify Integration (SEPARATE WORKFLOW)

Apify is **not** added to the main webhook workflow. It runs as an independent workflow.

**Workflow: Apify Lead Harvester**

```
Trigger: Cron (scheduled)
    │
    ▼
HTTP Request → Run Apify Actor
    │
    ▼
Wait / Check Run Status
    │
    ▼
Fetch Dataset Items
    │
    ▼
Split in Batches
    │
    ▼
Normalize fields (match Format Lead Data schema)
    │
    ▼
Airtable Upsert (Leads)
    │
    ▼
Log to Activities:
    Type: Automation
    Detail: "Lead harvested via Apify"
```

---

## Credential / Secret Management

| Service | Credential Type |
|---|---|
| Airtable | Personal Access Token (PAT) |
| Instantly.ai | API Key / Webhook Secret |
| Apify | API Token |
| SendGrid | API Key (optional) |
| n8n | env vars (`N8N_ENCRYPTION_KEY` active) |

---

## Acceptance Criteria

1. **Webhook lead ingestion:**
   - Airtable Leads table receives an upsert on every incoming lead
2. **Low-score leads (leadScore < 50):**
   - Status set to `Nurture`
   - Lead is **NOT** sent to Instantly
3. **High-score leads (leadScore >= 50):**
   - Status set to `Qualified`
   - Instantly campaign triggered
4. **Apify workflow:**
   - Runs on cron schedule
   - Writes to Airtable without creating duplicates
5. **No regressions:**
   - No patch may break the existing core flow
