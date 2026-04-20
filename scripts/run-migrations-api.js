// Migration runner via Supabase Management API.
// Splits each .sql file into individual statements (handles dollar-quoted
// function bodies). Runs each via /v1/projects/<ref>/database/query and
// silently skips "already exists" errors so the runner is fully idempotent
// even on legacy migrations that don't use IF NOT EXISTS everywhere.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = [
  'supabase-schema.sql',
  'supabase-rls-demo.sql',
  'supabase-strategy-type.sql',
  'supabase-brain-score.sql',
  'supabase-workflows-blog.sql',
  'supabase-auth-referrals.sql',
  'supabase-social-campaigns.sql',
  'supabase-quotas-comments.sql',
  'supabase-storage.sql',
  'supabase-calendar-newsletter.sql',
];

// Postgres SQLSTATE codes that mean "already exists" / safe to skip.
// (See https://www.postgresql.org/docs/current/errcodes-appendix.html)
const BENIGN_CODES = new Set([
  '42710', // duplicate_object  — trigger / policy / extension exists
  '42P07', // duplicate_table   — table or index exists
  '42701', // duplicate_column
  '42P16', // invalid_table_definition (column already exists in ADD COLUMN)
  '42P06', // duplicate_schema
  '42723', // duplicate_function (with same signature)
  '42P11', // duplicate_cursor
]);

const env = parseEnv(fs.readFileSync(path.join(ROOT, '.credentials.local'), 'utf8'));
const ref = env.SUPABASE_PROJECT_REF;
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('Missing SUPABASE_ACCESS_TOKEN'); process.exit(2); }

(async () => {
  console.log(`\n🔧 Migration runner — project ${ref}\n`);
  let totalOk = 0, totalSkipped = 0, totalFailed = 0;

  for (const file of MIGRATIONS) {
    const fp = path.join(ROOT, file);
    if (!fs.existsSync(fp)) { console.log(`  ⏭️  ${file} (missing)`); continue; }
    const sql = fs.readFileSync(fp, 'utf8');
    const stmts = splitSql(sql);
    process.stdout.write(`  ▶  ${file.padEnd(40)} (${stmts.length} stmts) `);

    let ok = 0, skip = 0, fail = 0;
    let lastError = null;
    for (const stmt of stmts) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      const result = await runWithBackoff(ref, token, trimmed);
      if (result.ok) ok++;
      else if (result.skip) skip++;
      else { fail++; lastError = result.error; }
      // Light pacing — Supabase Management API rate-limits aggressively
      await sleep(250);
    }

    totalOk += ok; totalSkipped += skip; totalFailed += fail;
    if (fail === 0) console.log(`✓ ${ok} new, ${skip} skipped`);
    else console.log(`✗ ${ok} new, ${skip} skipped, ${fail} FAILED → ${lastError}`);
  }

  console.log(`\n📊 Total: ${totalOk} statements applied, ${totalSkipped} already-existed, ${totalFailed} failed`);
  if (totalFailed === 0) {
    console.log('\n✅ All migrations applied. Schema is current.');
  } else {
    console.log('\n⚠️  Some statements failed — review above and re-run.');
  }
  process.exit(totalFailed === 0 ? 0 : 1);
})();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Single-statement runner with retry on 429s. Returns {ok|skip|error}.
async function runWithBackoff(ref, token, stmt, attempt = 0) {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({query: stmt}),
    });
    if (r.ok) return {ok: true};
    const body = await r.text();
    if (r.status === 429 && attempt < 5) {
      const wait = Math.min(8000, 1500 * Math.pow(2, attempt));
      await sleep(wait);
      return runWithBackoff(ref, token, stmt, attempt + 1);
    }
    const code = (body.match(/ERROR:\s+(\d{2}[A-Z\d]{3})/) || [])[1];
    if (code && BENIGN_CODES.has(code)) return {skip: true};
    return {error: `${code || 'http' + r.status}: ${body.slice(0, 200)}`};
  } catch (e) {
    if (attempt < 3) { await sleep(1500); return runWithBackoff(ref, token, stmt, attempt + 1); }
    return {error: e.message};
  }
}

// ============================================================
// Statement splitter — handles dollar-quoted bodies ($$ ... $$)
// ============================================================
function splitSql(text) {
  const out = [];
  let buf = '';
  let inDollar = null;       // current $tag$ delimiter or null
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;       // single-quoted

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    // Comment / string state machine
    if (inLineComment) { buf += ch; if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { buf += ch; if (ch === '*' && next === '/') { buf += next; i++; inBlockComment = false; } continue; }
    if (inString && !inDollar) { buf += ch; if (ch === "'" && text[i-1] !== "\\") inString = false; continue; }

    // Open / close $tag$ dollar-quoted bodies
    if (!inLineComment && !inBlockComment && ch === '$') {
      const m = text.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) {
        const tag = m[0];
        if (inDollar === null) inDollar = tag;
        else if (inDollar === tag) inDollar = null;
        buf += tag;
        i += tag.length - 1;
        continue;
      }
    }

    // Open comments (only when not inside a string or dollar body)
    if (!inDollar && !inString) {
      if (ch === '-' && next === '-') { inLineComment = true; buf += ch; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; buf += ch; continue; }
      if (ch === "'") { inString = true; buf += ch; continue; }
    }

    // Statement terminator
    if (ch === ';' && !inDollar && !inString) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
