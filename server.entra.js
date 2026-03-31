const express = require('express');
const http = require('http');
const session = require('express-session');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '::';

const tenantId = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
const clientSecret = process.env.ENTRA_CLIENT_SECRET;
const authorityHost = process.env.ENTRA_AUTHORITY_HOST || 'https://login.microsoftonline.com';
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const redirectUri = process.env.ENTRA_REDIRECT_URI || (publicBaseUrl ? `${publicBaseUrl}/auth/callback` : null);
const scopes = (process.env.ENTRA_SCOPES || 'openid profile email offline_access').split(/\s+/).filter(Boolean);
const postLogoutRedirectUri = process.env.ENTRA_POST_LOGOUT_REDIRECT_URI || (publicBaseUrl ? `${publicBaseUrl}/` : null);

const authConfigured = Boolean(tenantId && clientId && clientSecret && redirectUri);

if (!authConfigured) {
  console.warn('Entra auth is not fully configured. Missing one or more required environment variables: ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI (or PUBLIC_BASE_URL).');
}

const msalClient = authConfigured
  ? new ConfidentialClientApplication({
      auth: {
        clientId,
        authority: `${authorityHost}/${tenantId}`,
        clientSecret
      }
    })
  : null;

app.set('trust proxy', true);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE !== 'false',
      sameSite: 'lax'
    }
  })
);

function ensureAuthConfigured(req, res, next) {
  if (authConfigured) return next();
  res.status(500).json({
    error: 'Entra auth is not configured',
    requiredEnv: ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI (or PUBLIC_BASE_URL)']
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.account) return next();

  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    const returnTo = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?returnTo=${returnTo}`);
  }

  return res.status(401).json({ error: 'Authentication required' });
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true, authConfigured });
});

app.get('/login', ensureAuthConfigured, async (req, res) => {
  try {
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
    req.session.authState = {
      returnTo,
      csrf: Math.random().toString(36).slice(2)
    };

    const authCodeUrlParameters = {
      scopes,
      redirectUri,
      state: req.session.authState.csrf
    };

    const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParameters);
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).send(`Login initialization failed: ${err.message}`);
  }
});

app.get('/auth/callback', ensureAuthConfigured, async (req, res) => {
  try {
    if (!req.query.code) {
      return res.status(400).send('Missing authorization code');
    }

    const expectedState = req.session.authState && req.session.authState.csrf;
    if (!expectedState || req.query.state !== expectedState) {
      return res.status(400).send('Invalid auth state');
    }

    const tokenRequest = {
      code: req.query.code,
      scopes,
      redirectUri
    };

    const tokenResponse = await msalClient.acquireTokenByCode(tokenRequest);
    req.session.account = tokenResponse.account;
    req.session.idTokenClaims = tokenResponse.idTokenClaims;
    req.session.accessToken = tokenResponse.accessToken;

    const returnTo = req.session.authState.returnTo || '/';
    delete req.session.authState;

    res.redirect(returnTo);
  } catch (err) {
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

app.get('/logout', (req, res) => {
  const localSessionId = req.sessionID;
  req.session.destroy(() => {
    if (!authConfigured) {
      return res.redirect('/');
    }

    const url = new URL(`${authorityHost}/${tenantId}/oauth2/v2.0/logout`);
    if (postLogoutRedirectUri) {
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    }
    url.searchParams.set('sid', localSessionId || '');

    return res.redirect(url.toString());
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  const claims = req.session.idTokenClaims || {};
  res.json({
    authenticated: true,
    account: req.session.account,
    user: {
      name: claims.name || claims.preferred_username || null,
      email: claims.preferred_username || claims.email || null,
      oid: claims.oid || null,
      tid: claims.tid || null
    }
  });
});

async function fetchImdsMetadata(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const options = {
      host: '169.254.169.254',
      path: '/metadata/instance?api-version=2021-02-01',
      headers: {
        Metadata: 'true'
      },
      timeout: timeoutMs
    };
    const req = http.get(options, (response) => {
      let data = '';
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => {
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
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function detectRegionAndVmName() {
  const envCandidates = ['AZURE_REGION', 'REGION_NAME', 'WEBSITE_REGION', 'REGION', 'LOCATION'];
  for (const name of envCandidates) {
    if (process.env[name]) {
      return {
        region: process.env[name],
        vmName: null
      };
    }
  }

  const imds = await fetchImdsMetadata();
  if (imds && imds.region) {
    return {
      region: imds.region,
      vmName: imds.vmName
    };
  }

  return {
    region: 'local',
    vmName: null
  };
}

function isPrivateIP(ip) {
  if (!ip) return false;

  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  if (
    ip.match(/^10\./) ||
    ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
    ip.match(/^192\.168\./) ||
    ip.match(/^127\./) ||
    ip === 'localhost'
  ) {
    return true;
  }

  if (ip.match(/^fe80:/) || ip.match(/^fc00:/) || ip.match(/^fd00:/) || ip === '::1') {
    return true;
  }

  return false;
}

function getClientIp(req) {
  const headers = [
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
    'x-forwarded',
    'x-cluster-client-ip',
    'forwarded-for',
    'forwarded',
    'cf-connecting-ip',
    'true-client-ip',
    'x-azure-clientip'
  ];

  for (const header of headers) {
    const value = req.headers[header];
    if (value) {
      const ip = value.split(',')[0].trim();
      if (ip && ip !== 'unknown' && !isPrivateIP(ip)) {
        return ip;
      }
    }
  }

  const rawIp = req.connection?.remoteAddress || req.socket?.remoteAddress || req.connection?.socket?.remoteAddress || req.ip;
  if (rawIp && isPrivateIP(rawIp)) {
    return rawIp;
  }

  return rawIp || 'unknown';
}

app.get('/api/region', requireAuth, async (req, res) => {
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
    deploymentAdvice: isPrivate
      ? 'Private IP detected. For direct VM deployment, use host network mode: docker run --network=host'
      : 'Public IP detected successfully'
  });
});

app.use(requireAuth, express.static('public'));

app.listen(port, host, () => {
  console.log(`Listening on ${host}:${port} (Entra auth enabled)`);
  if (authConfigured) {
    console.log(`Entra callback URI: ${redirectUri}`);
  }
});
