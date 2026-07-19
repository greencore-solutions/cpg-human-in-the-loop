-- ============================================================
-- cpghumanintheloop.ai — hitl.* schema  v1.0.0
-- ADDITIVE ONLY. Runs on pg-aio-agents-fr.
-- Does not reference, alter, or depend on kg.* or gtins.*.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS hitl;

CREATE TABLE IF NOT EXISTS hitl.tickets (
    id              BIGSERIAL PRIMARY KEY,
    ticket_id       TEXT NOT NULL UNIQUE,          -- HITL-YYYYMMDD-XXXXXX
    ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('rfq', 'terms', 'escalation')),
    status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'IN_REVIEW', 'ANSWERED', 'CLOSED')),
    -- what the agent lodged
    subject         TEXT NOT NULL,
    body            TEXT NOT NULL,
    gtin            TEXT,                          -- optional; free reference, not FK
    market          TEXT,                          -- optional; SM-ECO-10060 member code
    quantity        TEXT,                          -- optional; free-text per RFQ practice
    requester       JSONB NOT NULL DEFAULT '{}',   -- agent-declared identity/contact
    related_ticket  TEXT,                          -- optional pointer to earlier ticket
    -- protocol state
    acm_signal      TEXT NOT NULL DEFAULT 'ACM-200'
                    CHECK (acm_signal IN ('ACM-000','ACM-200','ACM-300','ACM-403','ACM-404','ACM-451','ACM-500')),
    -- what the human answered
    answer          TEXT,
    answered_by     TEXT,
    answered_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hitl_tickets_status  ON hitl.tickets (status);
CREATE INDEX IF NOT EXISTS idx_hitl_tickets_type    ON hitl.tickets (ticket_type);
CREATE INDEX IF NOT EXISTS idx_hitl_tickets_created ON hitl.tickets (created_at);

-- Preservation rule: rows are never deleted. Status moves; history stays.
