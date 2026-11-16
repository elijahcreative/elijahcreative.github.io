module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const rawLat = req.query?.lat, rawLon = req.query?.lon;
  const lat = Number(rawLat), lon = Number(rawLon);
  if (typeof rawLat !== 'string' || typeof rawLon !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'invalid_location' });
  const key = process.env.VISUAL_CROSSING_API_KEY;
  if (!key) return res.status(503).json({ error: 'unavailable' });
  const location = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const url = new URL(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${location}/today`);
  url.search = new URLSearchParams({ key, unitGroup: 'metric', lang: 'hu', include: 'days', elements: 'datetime,description' }).toString();
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return res.status(502).json({ error: 'upstream_error' });
    const data = await upstream.json();
    const text = data.days?.[0]?.description;
    if (typeof text !== 'string' || !text.trim()) return res.status(502).json({ error: 'missing_forecast' });
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
    return res.status(200).json({ text: text.trim().slice(0, 400) });
  } catch (_) { return res.status(502).json({ error: 'upstream_error' }); }
};
