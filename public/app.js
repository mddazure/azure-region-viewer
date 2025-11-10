async function loadRegion() {
  const el = document.getElementById('region');
  try {
    const resp = await fetch('/api/region');
    if (!resp.ok) throw new Error('network');
    const data = await resp.json();
    el.textContent = data.region || 'unknown';
    const ipEl = document.getElementById('client-ip');
    if (ipEl) {
      let ip = data.clientIp || data.xForwardedFor || data.remoteAddress || 'unknown';
      
      // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1 -> 192.168.1.1)
      if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
      }
      
      // Remove port number if present, but preserve IPv6 addresses
      if (ip.startsWith('[') && ip.includes(']:')) {
        // IPv6 with port in brackets: [2001:1c04:3404:9500::1]:3000 -> 2001:1c04:3404:9500::1
        ip = ip.substring(1, ip.lastIndexOf(']:'));
      } else if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length === 2 && /^\d+$/.test(parts[1])) {
          // IPv4 with port: 192.168.1.1:3000 -> 192.168.1.1
          ip = parts[0];
        } else if (parts.length > 2) {
          // Potential IPv6 address - check if last part is a port number
          const lastPart = parts[parts.length - 1];
          if (/^\d+$/.test(lastPart) && parseInt(lastPart) > 1023 && parseInt(lastPart) <= 65535) {
            // Last part looks like a port number (1024-65535), remove it
            // IPv6 with port: 2001:1c04:3404:9500:15ab:79c1:c9ab:d350:49666 -> 2001:1c04:3404:9500:15ab:79c1:c9ab:d350
            ip = parts.slice(0, -1).join(':');
          }
        }
      }
      ipEl.textContent = ip;
    }
  } catch (err) {
    el.textContent = 'error detecting region';
    const ipEl = document.getElementById('client-ip');
    if (ipEl) ipEl.textContent = 'error';
  }
}

document.addEventListener('DOMContentLoaded', loadRegion);
