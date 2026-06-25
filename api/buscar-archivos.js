import crypto from 'crypto';

const CARPETA_INFORMES = '1aVuHtL48zQi1QdQj0jONyjBrn8fTqIT3';

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
  if (!data.access_token) throw new Error('No se pudo obtener token: ' + JSON.stringify(data));
  return data.access_token;
}

async function buscarEnDrive(token, query, extra = '') {
  const q = encodeURIComponent(query);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink,createdTime,size)&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&orderBy=createdTime+desc${extra}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await resp.json();
  return data.files || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://oftalmopatagonia-app.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const { dni } = req.query;
  if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) return res.status(500).json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT no configurado en Vercel' });

  try {
    const sa    = JSON.parse(saJson);
    const token = await getAccessToken(sa);

    // Estudios: cualquier archivo con el DNI en el nombre
    const estudios = await buscarEnDrive(token,
      `name contains '${dni}' and trashed = false`
    );

    // Informes: solo en la carpeta de informes
    const informes = await buscarEnDrive(token,
      `name contains '${dni}' and '${CARPETA_INFORMES}' in parents and trashed = false`
    );

    // Filtrar de estudios los que ya están en informes (para no duplicar)
    const informeIds = new Set(informes.map(f => f.id));
    const soloEstudios = estudios.filter(f => !informeIds.has(f.id));

    res.json({ ok: true, estudios: soloEstudios, informes });
  } catch (err) {
    console.error('[buscar-archivos]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
