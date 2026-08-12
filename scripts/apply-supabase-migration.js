const { Client } = require('pg');
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Z3hucGF6eGN1c2JqYmtwbnFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQwOTk5NCwiZXhwIjoyMDk3OTg1OTk0fQ.LtNq54RH8YKw_CQDOz3Q1V1YsVlWl1vTje7ToDHNgag';
const REF = 'dzgxnpazxcusbjbkpnqn';

async function tryConnect(host, port, user) {
  const client = new Client({
    host: host,
    port: port,
    user: user || ('postgres.' + REF),
    password: SERVICE_KEY,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const res = await client.query('SELECT version(), current_database(), current_user');
    console.log('CONNECTED to', host + ':' + port, 'as', res.rows[0].current_user);
    return client;
  } catch (e) {
    console.log(host + ':' + port, 'FAILED:', e.message.slice(0, 120));
    return null;
  }
}

(async () => {
  const attempts = [
    // Direct connections
    { host: 'db.' + REF + '.supabase.co', port: 5432, user: 'postgres' },
    // Pooler variations with different formats
    { host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543, user: 'postgres.' + REF },
    { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: 'postgres.' + REF },
    { host: 'us-east-1.pooler.supabase.com', port: 6543, user: 'postgres.' + REF },
    { host: REF + '.supabase.co', port: 5432, user: 'postgres' },
    // Try with user only
    { host: 'db.' + REF + '.supabase.co', port: 5432, user: 'postgres.' + REF },
  ];
  for (const a of attempts) {
    const c = await tryConnect(a.host, a.port, a.user);
    if (c) {
      await c.query("ALTER TABLE forecast_history ADD CONSTRAINT IF NOT EXISTS uq_forecast_history_slug_fecha UNIQUE (slug, fecha_objetivo)");
      console.log('CONSTRAINT applied');
      await c.query("CREATE INDEX IF NOT EXISTS idx_forecast_history_slug_fecha ON forecast_history(slug, fecha_objetivo DESC)");
      console.log('INDEX created');
      const r2 = await c.query("SELECT conname FROM pg_constraint WHERE conname = 'uq_forecast_history_slug_fecha'");
      console.log('Verification:', JSON.stringify(r2.rows));
      await c.end();
      return;
    }
  }
  console.log('FAILED: No connection method worked');
  process.exit(1);
})();
