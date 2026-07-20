# MCP CPG Human in the Loop (HITL)

**Surface role: TRANSACTION** — one of the four GSC surfaces (data · discovery · **transaction** · standards).

Lodge an RFQ, request terms, or escalate — a human answers every ticket.
ACM-451 ESCALATE is served here.

| | |
|---|---|
| **Canonical endpoint** | `https://mcp.cpghumanintheloop.ai/mcp` (streamable-http) |
| **Website** | `https://cpghumanintheloop.ai` |
| **Registry listing** | `io.github.greencore-solutions/cpg-human-in-the-loop` v1.0.0 |
| **Operator** | GreenCore Solutions Corp. — Microsoft AI Cloud Partner |
| **Protocol** | ACM-68000 · sovereign manifest SM-ECO-10060 |

## Registry tile text (verbatim)

> **Title:** MCP CPG Human in the Loop (HITL)
> **Description:** Navigator for BPC Agentic Procurement

## What it serves

Four MCP tools — `submit_rfq`, `check_rfq_status`, `request_terms`, `escalate`.
**Every ticket routes to a human.** Human-in-the-Loop on every purchase order:
machine discovery, human confirmation.

## Releases

| tag | source | deployed image digest |
|---|---|---|
| `v1.0.0` | `6004ce5` | `sha256:40893539be16` |

## Data plane and secret hygiene

Additive `hitl.*` schema on the shared Postgres (`hitl.tickets`); `kg.*` and
`gtins.*` are untouched by this service.

**The connection string lives ONLY as a Container App secret.** It is never
committed, never written into deploy files, never echoed, and never logged.
Application code reads `process.env.DATABASE_URL` and nothing else — see
`server.js` and `console.js`. Deploy docs reference the DSN as a placeholder
only. Verified by a full-history credential scan: zero literal secret values.

## The four surfaces

| surface | endpoint |
|---|---|
| data | `https://mcp.cpgknowledgegraph.ai` |
| discovery | `https://mcp.gsc-fleet.ai` |
| **transaction** | `https://mcp.cpghumanintheloop.ai` |
| standards | `https://mcp.cpgagentprotocols.ai` |

## Licensing

No license file is committed. GSC MCP server code is under a hybrid
MIT + Commercial Enterprise arrangement; the counsel-drafted terms are pending.
Until they land, absence of a LICENSE file is deliberate — not an oversight.
