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
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { id } = req.query;
  if (!id) return res.status(400).send('id requerido');

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) return res.status(500).send('GOOGLE_SERVICE_ACCOUNT no configurado');

  try {
    const sa    = JSON.parse(saJson);
    const token = await getAccessToken(sa);

    // Obtener metadata del archivo (nombre y tipo)
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaResp.json();

    // Descargar el contenido del archivo
    const fileResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!fileResp.ok) {
      return res.status(fileResp.status).send('Error al obtener el archivo de Drive');
    }

    const buffer = await fileResp.arrayBuffer();
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name || 'archivo')}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('[ver-archivo]', err.message);
    res.status(500).send('Error: ' + err.message);
  }
}
