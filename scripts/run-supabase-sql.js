const https = require('https');

const sql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_forecast_history_slug_fecha') THEN
    ALTER TABLE forecast_history ADD CONSTRAINT uq_forecast_history_slug_fecha UNIQUE (slug, fecha_objetivo);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_forecast_history_slug_fecha ON forecast_history(slug, fecha_objetivo DESC);
`.trim();

const data = JSON.stringify({ query: sql });
const options = {
  hostname: 'api.supabase.com',
  path: '/v1/projects/dzgxnpazxcusbjbkpnqn/database/query',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try { console.log(JSON.stringify(JSON.parse(body), null, 2)); }
    catch { console.log(body); }
  });
});
req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
