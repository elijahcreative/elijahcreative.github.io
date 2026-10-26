const { createWebBotAuthDirectoryResponse } = require('../lib/web-bot-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const host = req.headers?.host || '';
  const allowedHosts = ['fluxreader.vercel.app', process.env.VERCEL_URL].filter(Boolean);
  if (!allowedHosts.includes(host)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  try {
    const result = await createWebBotAuthDirectoryResponse({
      requestUrl: `https://${host}/.well-known/http-message-signatures-directory`
    });
    if (!result) {
      res.status(404).json({ error: 'not_enabled' });
      return;
    }
    for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    res.status(result.statusCode).send(result.body);
  } catch {
    // Do not expose key material, environment values, or validation details.
    console.error(JSON.stringify({ reason: 'bot_directory_unavailable' }));
    res.status(503).json({ error: 'identity_unavailable' });
  }
};
