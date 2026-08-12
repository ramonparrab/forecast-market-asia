const https = require('https');

const sql = "SELECT conname, contype FROM pg_constraint WHERE conname LIKE '%forecast%' OR conname LIKE '%slug_fecha%' ORDER BY conname";

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
    console.log('Status:', res.statusCode);
    try { console.log(JSON.stringify(JSON.parse(body), null, 2)); }
    catch { console.log(body); }
  });
});
req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
