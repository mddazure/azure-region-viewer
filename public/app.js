async function loadRegion() {
  const el = document.getElementById('region');
  try {
    const resp = await fetch('/api/region');
    if (!resp.ok) throw new Error('network');
    const data = await resp.json();
    el.textContent = data.region || 'unknown';
    const ipEl = document.getElementById('client-ip');
    if (ipEl) {
      const ip = data.clientIp || data.xForwardedFor || data.remoteAddress || 'unknown';
      ipEl.textContent = `IP: ${ip}`;
    }
  } catch (err) {
    el.textContent = 'error detecting region';
    const ipEl = document.getElementById('client-ip');
    if (ipEl) ipEl.textContent = 'IP: error';
  }
}

document.addEventListener('DOMContentLoaded', loadRegion);
