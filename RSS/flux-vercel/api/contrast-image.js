const sharp = require('sharp');
const { fetchImage } = require('../lib/remote-image');

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).end();
  const value = req.query?.image;
  let url;
  try { url = new URL(typeof value === 'string' ? value : ''); } catch { return res.status(400).end(); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return res.status(400).end();
  try {
    const source = await fetchImage(url.href, false);
    const image = await sharp(source, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate().resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    return res.status(200).send(image);
  } catch {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(502).end();
  }
};
