// ============================================================
// console.js — the human seat, v1
// Operator CLI against hitl.tickets. Runs locally with
// DATABASE_URL in the environment (never stored in this file).
//
//   node console.js queue                 open + in-review tickets
//   node console.js show   <ticket_id>    full ticket
//   node console.js claim  <ticket_id>    mark IN_REVIEW
//   node console.js answer <ticket_id> "<answer text>" [--by "Name"]
//   node console.js close  <ticket_id>
// ============================================================

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
});

const [, , cmd, arg1, arg2, ...rest] = process.argv;

function row(t) {
  return `${t.ticket_id}  ${t.ticket_type.padEnd(10)} ${t.status.padEnd(10)} ${t.acm_signal}  ${t.subject}`;
}

async function main() {
  switch (cmd) {
    case "queue": {
      const { rows } = await pool.query(
        `SELECT ticket_id, ticket_type, status, acm_signal, subject, created_at
           FROM hitl.tickets
          WHERE status IN ('OPEN','IN_REVIEW')
          ORDER BY (acm_signal = 'ACM-451') DESC, created_at ASC`
      );
      if (rows.length === 0) { console.log("Queue empty."); break; }
      rows.forEach((t) => console.log(row(t)));
      console.log(`\n${rows.length} ticket(s). ACM-451 escalations sort first.`);
      break;
    }
    case "show": {
      const { rows } = await pool.query(`SELECT * FROM hitl.tickets WHERE ticket_id = $1`, [arg1]);
      if (rows.length === 0) { console.log("Not found."); break; }
      console.log(JSON.stringify(rows[0], null, 2));
      break;
    }
    case "claim": {
      await pool.query(
        `UPDATE hitl.tickets SET status='IN_REVIEW', updated_at=now()
          WHERE ticket_id=$1 AND status='OPEN'`, [arg1]);
      console.log(`${arg1} -> IN_REVIEW`);
      break;
    }
    case "answer": {
      const byIdx = rest.indexOf("--by");
      const by = byIdx >= 0 ? rest[byIdx + 1] : "GSC Navigator";
      if (!arg2) { console.log('Usage: node console.js answer <ticket_id> "<answer>" [--by "Name"]'); break; }
      const r = await pool.query(
        `UPDATE hitl.tickets
            SET status='ANSWERED', answer=$2, answered_by=$3, answered_at=now(), updated_at=now()
          WHERE ticket_id=$1`, [arg1, arg2, by]);
      console.log(r.rowCount ? `${arg1} -> ANSWERED by ${by}` : "Not found.");
      break;
    }
    case "close": {
      await pool.query(
        `UPDATE hitl.tickets SET status='CLOSED', updated_at=now() WHERE ticket_id=$1`, [arg1]);
      console.log(`${arg1} -> CLOSED`);
      break;
    }
    default:
      console.log("Commands: queue | show <id> | claim <id> | answer <id> \"text\" [--by \"Name\"] | close <id>");
  }
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
