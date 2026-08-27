// ============================================================
// mcp.cpghumanintheloop.ai — HITL transaction MCP  v1.0.0
// GreenCore Solutions Corp.
//
// Four tools. Every tool routes to a human. No tool decides.
//   submit_rfq        agent lodges a request       -> ticket ID
//   check_rfq_status  agent polls its own ticket   -> state + answer
//   request_terms     agent asks, human answers    -> ticket ID
//   escalate          ACM-451, hand to Navigator   -> ticket ID
//
// Data plane: hitl.* schema on Postgres (DATABASE_URL env only —
// DSN is never logged, echoed, or written to disk).
// ============================================================

import express from "express";
import crypto from "node:crypto";
import pg from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const VERSION = "1.0.0";
const NODE = "mcp.cpghumanintheloop.ai";

// ---------- Postgres ----------
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
});

// ---------- Ghost Headers Canon v3.2 — "The Ghost Eighteen" ----------
// Canon order verbatim. Timestamp + nonce concrete per request.
function ghostEighteen(res, signal = "ACM-200", state = "ALLOW") {
  res.set({
    "x-gsc-protocol": "ACM-68000",
    "x-gsc-classification": "ACM-SPARKS",
    "x-gsc-operator": "GreenCore Solutions Corp.",
    "x-gsc-microsoft-partner": "AI-Cloud-Partner-Program-Member",
    "x-gsc-duns": "24-336-6774",
    "x-gsc-inbound": "https://x-gsi.ai/ingest",
    "x-gsc-trust-anchor": "dpuone.ai",
    "x-gsc-registry": "io.github.greencore-solutions/cpg-knowledge-graph",
    "x-gsc-mcp-server": "mcp.cpgknowledgegraph.ai",
    "x-gsc-agent-access": "MCP+A2A",
    "x-gsc-timestamp": new Date().toISOString(),
    "x-gsc-nonce": crypto.randomUUID(),
    "x-gsc-signal": signal,
    "x-gsc-state": state,
    "x-gsc-node": NODE,
    "x-gsc-jurisdiction": "FR",
    "x-gsc-product": "AI-Agents-for-CPG+CPG-Knowledge-Graph",
    "x-gsc-fleet": "https://gsc-cpg.ai,https://gsc-a2a.ai,https://gsc-a2a.io",
  });
}

// ---------- ticket helpers ----------
function mintTicketId() {
  const d = new Date();
  const ymd =
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `HITL-${ymd}-${rand}`;
}

async function insertTicket({ type, subject, body, gtin, market, quantity, requester, related, signal }) {
  const ticketId = mintTicketId();
  await pool.query(
    `INSERT INTO hitl.tickets
       (ticket_id, ticket_type, subject, body, gtin, market, quantity, requester, related_ticket, acm_signal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [ticketId, type, subject, body, gtin ?? null, market ?? null, quantity ?? null,
     JSON.stringify(requester ?? {}), related ?? null, signal]
  );
  return ticketId;
}

function toolResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

// ---------- MCP server + tools ----------
function buildMcp() {
  const mcp = new McpServer({
    name: "cpg-human-in-the-loop",
    version: VERSION,
  });

  mcp.registerTool(
    "submit_rfq",
    {
      title: "Submit RFQ",
      description:
        "Lodge a request-for-quotation with GreenCore Solutions Corp. A human reviews and answers every ticket — no order is decided by this tool. Returns a ticket ID for polling via check_rfq_status. Optionally reference a GTIN resolved on mcp.cpgknowledgegraph.ai and an SM-ECO-10060 market code.",
      inputSchema: {
        subject: z.string().min(3).max(300).describe("One-line summary of the RFQ"),
        details: z.string().min(3).max(8000).describe("Full request: product, volumes, timing, destination"),
        gtin: z.string().max(14).optional().describe("Optional GTIN reference (as resolved on the CPG Knowledge Graph)"),
        market: z.string().max(8).optional().describe("Optional SM-ECO-10060 member code, e.g. FR, AU, MX"),
        quantity: z.string().max(200).optional().describe("Optional quantity / volume expression"),
        requester_name: z.string().max(200).describe("Requesting organization or agent operator"),
        requester_contact: z.string().max(300).describe("Reply channel: email or URL a human can answer to"),
      },
    },
    async ({ subject, details, gtin, market, quantity, requester_name, requester_contact }) => {
      const ticketId = await insertTicket({
        type: "rfq",
        subject,
        body: details,
        gtin,
        market,
        quantity,
        requester: { name: requester_name, contact: requester_contact },
        signal: "ACM-200",
      });
      return toolResult({
        ticket_id: ticketId,
        status: "OPEN",
        signal: "ACM-200",
        state: "ALLOW",
        meaning: "RFQ accepted into the human review queue. A human answers every ticket.",
        poll_with: "check_rfq_status",
        operator: "GreenCore Solutions Corp.",
      });
    }
  );

  mcp.registerTool(
    "check_rfq_status",
    {
      title: "Check ticket status",
      description:
        "Poll a ticket previously lodged on this MCP (RFQ, terms request, or escalation). Returns current status and, once a human has answered, the answer.",
      inputSchema: {
        ticket_id: z.string().regex(/^HITL-\d{8}-[A-F0-9]{6}$/).describe("Ticket ID returned at submission, e.g. HITL-20260719-A1B2C3"),
      },
    },
    async ({ ticket_id }) => {
      const { rows } = await pool.query(
        `SELECT ticket_id, ticket_type, status, subject, acm_signal, answer, answered_at, created_at
           FROM hitl.tickets WHERE ticket_id = $1`,
        [ticket_id]
      );
      if (rows.length === 0) {
        return toolResult({
          ticket_id,
          signal: "ACM-404",
          state: "NOT_FOUND",
          meaning: "No ticket registered under this ID.",
        });
      }
      const t = rows[0];
      return toolResult({
        ticket_id: t.ticket_id,
        type: t.ticket_type,
        status: t.status,
        subject: t.subject,
        signal: t.acm_signal,
        answer: t.answer ?? null,
        answered_at: t.answered_at ?? null,
        created_at: t.created_at,
        meaning:
          t.status === "ANSWERED" || t.status === "CLOSED"
            ? "A human has answered this ticket."
            : "In the human review queue. Poll again later.",
      });
    }
  );

  mcp.registerTool(
    "request_terms",
    {
      title: "Request terms",
      description:
        "Ask a commercial or procedural question — terms, conditions, eligibility context, process. The question is lodged as a ticket and a human answers it. Returns a ticket ID for polling via check_rfq_status.",
      inputSchema: {
        subject: z.string().min(3).max(300).describe("One-line summary of the question"),
        question: z.string().min(3).max(8000).describe("The question a human should answer"),
        related_ticket: z.string().regex(/^HITL-\d{8}-[A-F0-9]{6}$/).optional().describe("Optional earlier ticket this relates to"),
        requester_name: z.string().max(200).describe("Requesting organization or agent operator"),
        requester_contact: z.string().max(300).describe("Reply channel: email or URL a human can answer to"),
      },
    },
    async ({ subject, question, related_ticket, requester_name, requester_contact }) => {
      const ticketId = await insertTicket({
        type: "terms",
        subject,
        body: question,
        related: related_ticket,
        requester: { name: requester_name, contact: requester_contact },
        signal: "ACM-200",
      });
      return toolResult({
        ticket_id: ticketId,
        status: "OPEN",
        signal: "ACM-200",
        state: "ALLOW",
        meaning: "Question accepted into the human review queue.",
        poll_with: "check_rfq_status",
      });
    }
  );

  mcp.registerTool(
    "escalate",
    {
      title: "Escalate to a human (ACM-451)",
      description:
        "Hand a matter that cannot be resolved deterministically to GSC Navigator human review. Emits ACM-451 ESCALATE. Returns a ticket ID for polling via check_rfq_status.",
      inputSchema: {
        subject: z.string().min(3).max(300).describe("One-line summary of the matter"),
        context: z.string().min(3).max(8000).describe("What was attempted, what could not be resolved, and why"),
        related_ticket: z.string().regex(/^HITL-\d{8}-[A-F0-9]{6}$/).optional().describe("Optional earlier ticket this relates to"),
        requester_name: z.string().max(200).describe("Requesting organization or agent operator"),
        requester_contact: z.string().max(300).describe("Reply channel: email or URL a human can answer to"),
      },
    },
    async ({ subject, context, related_ticket, requester_name, requester_contact }) => {
      const ticketId = await insertTicket({
        type: "escalation",
        subject,
        body: context,
        related: related_ticket,
        requester: { name: requester_name, contact: requester_contact },
        signal: "ACM-451",
      });
      return toolResult({
        ticket_id: ticketId,
        status: "OPEN",
        signal: "ACM-451",
        state: "ESCALATE",
        meaning: "Cannot be resolved deterministically. Human review required — routed to GSC Navigator.",
        poll_with: "check_rfq_status",
      });
    }
  );

  return mcp;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: "1mb" }));

// MCP endpoint — stateless streamable HTTP, new transport per request
app.post("/mcp", async (req, res) => {
  ghostEighteen(res);
  try {
    const mcp = buildMcp();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err.message);
    if (!res.headersSent) {
      ghostEighteen(res, "ACM-500", "SYSTEM_ERROR");
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless server: no session streams / no session teardown
app.get("/mcp", (req, res) => {
  ghostEighteen(res);
  res.status(405).json({ error: "Method not allowed. POST JSON-RPC to /mcp." });
});
app.delete("/mcp", (req, res) => {
  ghostEighteen(res);
  res.status(405).json({ error: "Method not allowed." });
});

// Health
app.get("/health", async (req, res) => {
  let db = "unreachable";
  try {
    await pool.query("SELECT 1");
    db = "connected";
  } catch { /* db stays unreachable; never log DSN */ }
  const ok = db === "connected";
  ghostEighteen(res, ok ? "ACM-200" : "ACM-500", ok ? "ALLOW" : "SYSTEM_ERROR");
  res.status(ok ? 200 : 503).json({
    protocol: "ACM-68000",
    version: VERSION,
    status: ok ? "active" : "degraded",
    node: NODE,
    role: "hitl-transaction-mcp",
    operator: "GreenCore Solutions Corp.",
    operator_url: "https://gsc-em.com",
    database: db,
    tools: ["submit_rfq", "check_rfq_status", "request_terms", "escalate"],
    knowledge_graph: "https://mcp.cpgknowledgegraph.ai",
  });
});

// Root descriptor — the brochure surface. Humans find and read these.
app.get("/", (req, res) => {
  ghostEighteen(res);
  res.json({
    service: "CPGHumanInTheLoop.ai",
    what:
      "CPG HUMAN IN THE LOOP v1.0.0 — THE TRANSACTION SURFACE. Machines lodge; humans decide. AI Agents submit RFQs, request commercial terms, and escalate — a human reviews and answers every ticket. AI moves fast, a human holds the trigger: every purchase order and RFP reviewed, auditable, approved. Four MCP tools: submit_rfq · check_rfq_status · request_terms · escalate. ACM-451 ESCALATE is served here — the machine doorway to GSC Navigator human review. Paired with the CPG Knowledge Graph at mcp.cpgknowledgegraph.ai (data) and the GSC Carrier Fleet (discovery). ACM-68000 protocol. Human-in-the-Loop on every purchase order. Hyperscaler-native on Microsoft Azure (France Central). GSC is a Microsoft AI Cloud Partner.",
    operator: "GreenCore Solutions Corp.",
    operator_url: "https://gsc-em.com",
    operator_links: {
      gsc_em: "https://gsc-em.com",
      x_gsc: "https://x.com/GSC_Rail_ai",
      gsc_agentic_au: "https://gsc-agentic.ai",
      x_gsc_agentic: "https://x.com/gsc_agentic_ai",
    },
    microsoft_partner: "Microsoft AI Cloud Partner",
    endpoint: `https://${NODE}`,
    version: VERSION,
    protocol: "ACM-68000",
    protocol_home: "https://acm-68000.org",
    sovereign_manifest: "SM-ECO-10060",
    sovereign_manifest_home: "https://sm-eco-10060.org",
    governance: "https://standard-10060.org",
    trust_anchor: "https://dpuone.ai",
    duns: "24-336-6774",
    registry: "io.github.greencore-solutions/cpg-human-in-the-loop",
    role: "hitl-transaction-mcp",
    human_in_the_loop: {
      surface: "GSC Navigator",
      url: "https://gsc-navigator.com",
      contact: "mcp@gsc-em.com",
      purpose:
        "Every ticket lodged on this MCP routes to human review. No tool on this server decides — humans answer RFQs, terms questions, and escalations. Human-in-the-Loop routing on every purchase order.",
    },
    mcp: { transport: "streamable-http", url: `https://${NODE}/mcp` },
    tools: ["submit_rfq", "check_rfq_status", "request_terms", "escalate"],
    tool_notes: {
      submit_rfq: "Lodge a request-for-quotation — returns a ticket ID",
      check_rfq_status: "Poll any ticket — returns state and the human answer once given",
      request_terms: "Ask a commercial or procedural question — a human answers",
      escalate: "Hand a non-deterministic matter to Navigator — emits ACM-451 ESCALATE",
    },
    surfaces: {
      data: "https://mcp.cpgknowledgegraph.ai",
      discovery: ["https://gsc-cpg.ai", "https://gsc-a2a.ai", "https://gsc-a2a.io"],
      transaction: `https://${NODE}`,
    },
    machine_surfaces: {
      health: `https://${NODE}/health`,
      agent_card: `https://${NODE}/.well-known/agent-card.json`,
      agent_card_agent_json: `https://${NODE}/.well-known/agent.json`,
      ai_catalog: `https://${NODE}/.well-known/ai-catalog.json`,
      mcp: `https://${NODE}/mcp`,
    },
    knowledge_graph: "https://mcp.cpgknowledgegraph.ai",
  });
});

// Agent card
app.get("/.well-known/agent-card.json", (req, res) => {
  ghostEighteen(res);
  res.json({
    schema_version: "1.0",
    name: "CPG Human In The Loop",
    description:
      "HITL transaction MCP operated by GreenCore Solutions Corp. Machines lodge RFQs, terms questions, and escalations; a human reviews and answers every ticket. Data surface: mcp.cpgknowledgegraph.ai (CPG Knowledge Graph). Discovery: the GSC Carrier Fleet roots. ACM-68000 protocol; ACM-451 ESCALATE is served here.",
    url: `https://${NODE}`,
    version: VERSION,
    operator: "GreenCore Solutions Corp.",
    operator_url: "https://gsc-em.com",
    protocol: { name: "ACM-68000", registry: "io.github.greencore-solutions/cpg-knowledge-graph" },
    mcp: {
      endpoint: `https://${NODE}/mcp`,
      transport: "streamable-http",
      tools: ["submit_rfq", "check_rfq_status", "request_terms", "escalate"],
    },
    human_in_the_loop: true,
  });
});

// A2A Agent Card — Google A2A discovery convention
app.get("/.well-known/agent.json", (req, res) => {
  ghostEighteen(res);
  res.json({
    protocolVersion: "0.3.0",
    name: "CPG Human In The Loop",
    description:
      "HITL transaction surface by GreenCore Solutions Corp. AI Agents lodge RFQs, terms questions, and escalations; a human reviews and answers every ticket. ACM-68000 protocol; ACM-451 ESCALATE served here. Data surface: mcp.cpgknowledgegraph.ai.",
    url: `https://${NODE}`,
    version: VERSION,
    provider: { organization: "GreenCore Solutions Corp.", url: "https://gsc-em.com" },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      { id: "submit_rfq", name: "Submit RFQ", description: "Lodge a request-for-quotation; a human answers. Returns a ticket ID." },
      { id: "check_rfq_status", name: "Check ticket status", description: "Poll a lodged ticket; returns state and the human answer once given." },
      { id: "request_terms", name: "Request terms", description: "Ask a commercial or procedural question; a human answers." },
      { id: "escalate", name: "Escalate to a human", description: "Hand a non-deterministic matter to GSC Navigator — emits ACM-451 ESCALATE." },
    ],
    endpoints: { mcp: `https://${NODE}/mcp` },
    human_in_the_loop: true,
  });
});

// AI catalog — machine-readable service catalog
app.get("/.well-known/ai-catalog.json", (req, res) => {
  ghostEighteen(res);
  res.json({
    service: "CPGHumanInTheLoop.ai",
    operator: "GreenCore Solutions Corp.",
    operator_url: "https://gsc-em.com",
    version: VERSION,
    protocol: "ACM-68000",
    role: "hitl-transaction-mcp",
    catalog: [
      { type: "mcp", transport: "streamable-http", url: `https://${NODE}/mcp`, tools: ["submit_rfq", "check_rfq_status", "request_terms", "escalate"] },
      { type: "agent-card", url: `https://${NODE}/.well-known/agent-card.json` },
      { type: "a2a-agent-card", url: `https://${NODE}/.well-known/agent.json` },
      { type: "health", url: `https://${NODE}/health` },
    ],
    related: {
      knowledge_graph: "https://mcp.cpgknowledgegraph.ai",
      fleet: ["https://gsc-cpg.ai", "https://gsc-a2a.ai", "https://gsc-a2a.io"],
      navigator: "https://gsc-navigator.com",
    },
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`CPG Human In The Loop MCP v${VERSION} listening on :${PORT}`);
});
