import crypto from 'crypto';

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg:'RS256', typ:'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud:  'https://oauth2.googleapis.com/token',
    exp:  now + 3600,
    iat:  now,
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(sa.private_key, 'base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${sig}`,
  });
  return resp.json();
}

export default async function handler(req, res) {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) return res.json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT no está configurado' });

  try {
    const sa = JSON.parse(saJson);
    const tokenData = await getAccessToken(sa);
    if (tokenData.access_token) {
      res.json({ ok: true, mensaje: '✅ Conexión con Drive OK', cuenta: sa.client_email });
    } else {
      res.json({ ok: false, error: 'No se obtuvo token', detalle: tokenData });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
}
