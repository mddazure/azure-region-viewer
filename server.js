const express = require('express');
const http = require('http');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));

async function fetchImdsRegion(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const options = {
      host: '169.254.169.254',
      path: '/metadata/instance?api-version=2021-02-01',
      headers: {
        'Metadata': 'true'
      },
      timeout: timeoutMs
    };
    const req = http.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve((json && json.compute && json.compute.location) ? json.compute.location : null);
        } catch (err) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function detectRegion() {
  const envCandidates = [
    'AZURE_REGION', 'REGION_NAME', 'WEBSITE_REGION', 'REGION', 'LOCATION'
  ];
  for (const name of envCandidates) {
    if (process.env[name]) return process.env[name];
  }

  // Try IMDS
  const imds = await fetchImdsRegion();
  if (imds) return imds;

  // Fallback
  return 'local';
}

app.get('/api/region', async (req, res) => {
  const region = await detectRegion();
  const xff = req.headers['x-forwarded-for'] || null;
  const remoteAddr = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
  // Prefer the first entry of X-Forwarded-For when present, otherwise use the remote socket address
  const clientIp = xff ? xff.split(',')[0].trim() : remoteAddr;
  res.json({ region, clientIp, xForwardedFor: xff, remoteAddress: remoteAddr });
});

app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
