# DEPLOY — mcp.cpghumanintheloop.ai v1.0.0

**Sub:** AIO Agents (`9e406344-81a4-4624-98de-a9c642a75d69`) · **RG:** `rg-aio-agents-fr` · **Region:** France Central
**ACR:** `gscemregistry` · **Env:** `aio-agents-env-fr` · **DB:** `pg-aio-agents-fr` (new `hitl.*` schema — additive; `kg.*` / `gtins.*` untouched)

## What this is

The HITL transaction MCP. Four tools — `submit_rfq`, `check_rfq_status`, `request_terms`, `escalate` — every one routes to a human. Machines lodge; humans decide. Ghost Eighteen v3.2 on every response, node self-announce, ACM-451 emitted on escalation. Third surface of the set: KG = data · fleet roots = discovery · this = transaction.

Smoke-tested end to end before packaging: initialize, tools/list, all four tools over JSON-RPC, console claim/answer roundtrip, ACM-404 on unknown ticket.

## Phase 0 — Schema (data plane)

Apply `schema.sql` to pg-aio-agents-fr — CC-direct per the July 16 load-execution ruling (DSN env-var only, never echoed), or operator-executes as fallback:

```powershell
# DSN via env only
psql $env:DATABASE_URL -f schema.sql
```

Creates schema `hitl` + table `hitl.tickets` + 3 indexes. Idempotent (IF NOT EXISTS throughout). No other schema touched.

## Phase 1 — Build & push

```powershell
cd C:\GREENCORE\BUNDLES\hitl-mcp\
az acr login --name gscemregistry
docker build -t gscemregistry.azurecr.io/cpghitl-mcp:1.0.0 .
docker push gscemregistry.azurecr.io/cpghitl-mcp:1.0.0
```

## Phase 2 — Container App

```powershell
az containerapp create `
  --name cpghitl-mcp `
  --resource-group rg-aio-agents-fr `
  --environment aio-agents-env-fr `
  --image gscemregistry.azurecr.io/cpghitl-mcp:1.0.0 `
  --target-port 8080 `
  --ingress external `
  --min-replicas 1 `
  --max-replicas 3 `
  --cpu 0.25 `
  --memory 0.5Gi `
  --secrets database-url=<DSN — paste at prompt, never into a file> `
  --env-vars DATABASE_URL=secretref:database-url
```

DSN hygiene: the connection string lives ONLY as the Container App secret. Never committed, never in DEPLOY files, never echoed.

## Phase 3 — Custom domain

1. Get default FQDN: `cpghitl-mcp.<env>.francecentral.azurecontainerapps.io`
2. Cloudflare DNS for cpghumanintheloop.ai — **grey cloud / DNS only** (canon: agentic surfaces stay unproxied):
   - CNAME `mcp` → default FQDN
   - TXT `asuid.mcp` → verification ID from Portal → Custom domains
3. Portal → Custom domains → add `mcp.cpghumanintheloop.ai` → managed TLS

Apex `cpghumanintheloop.ai` (human landing surface) is a separate later cut — not in this bundle.

## Verify

```powershell
# Health + DB
Invoke-RestMethod "https://mcp.cpghumanintheloop.ai/health"   # status: active, database: connected

# Ghost Eighteen (spot-check the three that identify this node)
$h = (Invoke-WebRequest "https://mcp.cpghumanintheloop.ai/").Headers
$h['x-gsc-node']           # mcp.cpghumanintheloop.ai
$h['x-gsc-jurisdiction']   # FR
$h['x-gsc-fleet']          # https://gsc-cpg.ai,https://gsc-a2a.ai,https://gsc-a2a.io

# MCP tools/list
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
Invoke-WebRequest "https://mcp.cpghumanintheloop.ai/mcp" -Method POST -Body $body `
  -Headers @{ "Content-Type"="application/json"; "Accept"="application/json, text/event-stream" }
# expect: submit_rfq, check_rfq_status, request_terms, escalate
```

## The human seat (console v1)

Queue lives in `hitl.tickets`; `console.js` is the operator console until a web console ships:

```powershell
# DATABASE_URL in env first
node console.js queue                       # open tickets, ACM-451 first
node console.js show  HITL-20260719-XXXXXX
node console.js claim HITL-20260719-XXXXXX
node console.js answer HITL-20260719-XXXXXX "answer text" --by "Matthew Keddy"
node console.js close HITL-20260719-XXXXXX
```

Rows are never deleted (preservation rule) — status moves, history stays.

## Rollback

```powershell
az containerapp revision list --name cpghitl-mcp --resource-group rg-aio-agents-fr -o table
az containerapp revision activate --name cpghitl-mcp --resource-group rg-aio-agents-fr --revision <previous>
```

## Files

```
hitl-mcp/
├── server.js       # MCP server — 4 tools, Ghost Eighteen, streamable HTTP
├── console.js      # operator console CLI (the human seat, v1)
├── schema.sql      # additive hitl.* schema for pg-aio-agents-fr
├── package.json
├── Dockerfile      # node:22-alpine
└── DEPLOY.md
```
