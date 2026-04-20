// Idempotent migration runner. Reads .credentials.local for SUPABASE_DB_PASSWORD
// + SUPABASE_PROJECT_REF + SUPABASE_REGION, opens a single pg connection to
// the pooler (with direct fallback), and runs each .sql file in order.
//
// Usage: node scripts/run-migrations.js
//        node scripts/run-migrations.js --dry-run
//
// Safe to re-run — every migration uses CREATE TABLE IF NOT EXISTS and
// DROP POLICY IF EXISTS patterns.

const fs = require('fs');
const path = require('path');
const {Client} = require('pg');

const ROOT = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// ---- Migrations in dependency order ----
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
  // supabase-rls-strict.sql is intentionally NOT run by default — opt-in
];

// ---- Load credentials ----
const credPath = path.join(ROOT, '.credentials.local');
if (!fs.existsSync(credPath)) {
  console.error('ERROR: .credentials.local not found at', credPath);
  process.exit(1);
}
const creds = parseEnv(fs.readFileSync(credPath, 'utf8'));
const ref = creds.SUPABASE_PROJECT_REF;
const password = creds.SUPABASE_DB_PASSWORD;
const region = creds.SUPABASE_REGION || 'us-east-1';
if (!ref || !password) {
  console.error('ERROR: SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD required in .credentials.local');
  process.exit(1);
}

// Try the transaction pooler first (port 6543), then session pooler (5432),
// then direct. Pooler hostnames vary by region.
const CANDIDATES = [
  // Transaction-mode pooler (works from anywhere, no IP allowlist):
  {host: `aws-0-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${ref}`, label: 'pooler-tx'},
  // Session-mode pooler:
  {host: `aws-0-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}`, label: 'pooler-session'},
  // Direct (might be blocked by IPv6-only on free tier):
  {host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres', label: 'direct'},
];

(async () => {
  console.log(`\n🔧 Supabase migration runner — project ${ref} (region ${region})`);
  console.log(`   ${MIGRATIONS.length} migrations queued${DRY_RUN ? ' (DRY RUN — won\'t execute)' : ''}\n`);

  const client = await connectFirstWorking(CANDIDATES);
  if (!client) process.exit(2);

  const results = [];
  for (const file of MIGRATIONS) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⏭️  ${file} — file missing, skipped`);
      results.push({file, status: 'skipped'});
      continue;
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    process.stdout.write(`  ▶  ${file.padEnd(40)} `);
    if (DRY_RUN) { console.log(`(dry-run, ${sql.length} chars)`); results.push({file, status: 'dry-run'}); continue; }
    try {
      const start = Date.now();
      await client.query(sql);
      const ms = Date.now() - start;
      console.log(`✓ ${ms}ms`);
      results.push({file, status: 'ok', ms});
    } catch (e) {
      console.log(`✗ ${e.message}`);
      results.push({file, status: 'error', error: e.message});
      // Hard stop — later migrations may depend on this one
      break;
    }
  }

  await client.end();

  // Summary
  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;
  console.log(`\n📊 Done: ${ok} ok, ${failed} failed, ${results.filter(r => r.status === 'skipped').length} skipped`);

  if (failed === 0 && !DRY_RUN) {
    console.log('\n✅ All migrations applied. Next: configure Auth providers in Supabase Dashboard');
    console.log('   (provide SUPABASE_EMAIL + SUPABASE_PASSWORD to launch the Playwright agent for that)');
  }

  process.exit(failed === 0 ? 0 : 1);
})();

// ============================================================
// Helpers
// ============================================================
async function connectFirstWorking(candidates) {
  for (const c of candidates) {
    process.stdout.write(`  ↳ trying ${c.label} (${c.host}:${c.port})... `);
    const client = new Client({
      host: c.host, port: c.port, user: c.user, password,
      database: 'postgres',
      ssl: {rejectUnauthorized: false},
      connectionTimeoutMillis: 8000,
      query_timeout: 120000,
      statement_timeout: 120000,
    });
    try {
      await client.connect();
      const ping = await client.query('SELECT now() AS t, current_database() AS db');
      console.log(`✓ connected (${ping.rows[0].t.toISOString()})`);
      return client;
    } catch (e) {
      console.log(`✗ ${e.code || ''} ${e.message.split('\n')[0]}`);
      try { await client.end(); } catch (_) {}
    }
  }
  console.error('\n❌ Could not connect to any candidate. Check SUPABASE_DB_PASSWORD + SUPABASE_REGION in .credentials.local.');
  return null;
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
