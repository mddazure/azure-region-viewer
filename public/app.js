async function loadRegion() {
  const el = document.getElementById('region');
  try {
    const resp = await fetch('/api/region');
    if (!resp.ok) throw new Error('network');
    const data = await resp.json();
    el.textContent = data.region || 'unknown';
  } catch (err) {
    el.textContent = 'error detecting region';
  }
}

document.addEventListener('DOMContentLoaded', loadRegion);
