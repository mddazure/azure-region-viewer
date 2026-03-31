const express = require('express');
const http = require('http');

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy headers (important for load balancers and reverse proxies)
app.set('trust proxy', true);

app.use(express.static('public'));

async function fetchImdsMetadata(timeoutMs = 1000) {
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
          const compute = json && json.compute ? json.compute : null;
          if (!compute) {
            resolve(null);
            return;
          }

          resolve({
            region: compute.location || null,
            vmName: compute.vmName || null
          });
        } catch (err) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function detectRegionAndVmName() {
  const envCandidates = [
    'AZURE_REGION', 'REGION_NAME', 'WEBSITE_REGION', 'REGION', 'LOCATION'
  ];
  for (const name of envCandidates) {
    if (process.env[name]) {
      return {
        region: process.env[name],
        vmName: null
      };
    }
  }

  // Try IMDS
  const imds = await fetchImdsMetadata();
  if (imds && imds.region) {
    return {
      region: imds.region,
      vmName: imds.vmName
    };
  }

  // Fallback
  return {
    region: 'local',
    vmName: null
  };
}

function getClientIp(req) {
  // Check multiple headers in order of preference
  const headers = [
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
    'x-forwarded',
    'x-cluster-client-ip',
    'forwarded-for',
    'forwarded',
    'cf-connecting-ip', // Cloudflare
    'true-client-ip',   // Akamai
    'x-azure-clientip'  // Azure-specific
  ];
  
  for (const header of headers) {
    const value = req.headers[header];
    if (value) {
      // X-Forwarded-For can contain multiple IPs, take the first (original client)
      const ip = value.split(',')[0].trim();
      if (ip && ip !== 'unknown' && !isPrivateIP(ip)) {
        return ip;
      }
    }
  }
  
  // Get raw connection info
  const rawIp = req.connection?.remoteAddress || 
                req.socket?.remoteAddress || 
                req.connection?.socket?.remoteAddress ||
                req.ip;
  
  // If we got a private/bridge IP, it means we're in a container
  // In this case, we should try to get the real client IP from the host
  if (rawIp && isPrivateIP(rawIp)) {
    // Try to read from /proc/net/tcp6 or other methods if available
    // For now, return the detected IP but flag it as potentially incorrect
    return rawIp;
  }
  
  return rawIp || 'unknown';
}

function isPrivateIP(ip) {
  if (!ip) return false;
  
  // Remove IPv4-mapped IPv6 prefix
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  // Check for private IPv4 ranges
  if (ip.match(/^10\./) || 
      ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) || 
      ip.match(/^192\.168\./) ||
      ip.match(/^127\./) ||
      ip === 'localhost') {
    return true;
  }
  
  // Check for private IPv6 ranges
  if (ip.match(/^fe80:/) ||  // Link-local
      ip.match(/^fc00:/) ||  // Unique local
      ip.match(/^fd00:/) ||  // Unique local
      ip === '::1') {       // Loopback
    return true;
  }
  
  return false;
}

app.get('/api/region', async (req, res) => {
  const runtimeMetadata = await detectRegionAndVmName();
  const region = runtimeMetadata.region;
  const vmName = runtimeMetadata.vmName;
  const clientIp = getClientIp(req);
  const xff = req.headers['x-forwarded-for'] || null;
  const remoteAddr = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
  const isPrivate = isPrivateIP(clientIp);
  
  res.json({ 
    region, 
    vmName,
    clientIp, 
    xForwardedFor: xff, 
    remoteAddress: remoteAddr,
    isPrivateIP: isPrivate,
    // Debug info to help troubleshoot
    expressIp: req.ip,
    connectionInfo: {
      remoteAddress: req.connection?.remoteAddress,
      remoteFamily: req.connection?.remoteFamily,
      localAddress: req.connection?.localAddress,
      localPort: req.connection?.localPort
    },
    allHeaders: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'x-client-ip': req.headers['x-client-ip'],
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'true-client-ip': req.headers['true-client-ip'],
      'x-azure-clientip': req.headers['x-azure-clientip']
    },
    deploymentAdvice: isPrivate ? 
      "Private IP detected. For direct VM deployment, use host network mode: docker run --network=host" : 
      "Public IP detected successfully"
  });
});

// For dual-stack IPv4/IPv6 support, bind to all interfaces
// In host network mode, this allows the app to accept both IPv4 and IPv6 connections
const host = process.env.HOST || '::';  // '::' binds to all IPv6 and IPv4 addresses
app.listen(port, host, () => {
  console.log(`Listening on ${host}:${port} (dual-stack IPv4/IPv6)`);
});
