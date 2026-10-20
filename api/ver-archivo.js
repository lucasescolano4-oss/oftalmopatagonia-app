import { rechazarSinSesion } from './_auth.js';
import { tokenDrive, cuentaDeServicio } from './_drive.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://oftalmopatagonia-app.vercel.app');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Devuelve el PDF de un estudio: exige sesion iniciada.
  if (await rechazarSinSesion(req, res)) return;

  const { id } = req.query;
  if (!id) return res.status(400).send('id requerido');
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(id))) return res.status(400).send('id invalido');

  try {
    const token = await tokenDrive(cuentaDeServicio());

    // El nombre y el contenido se piden al mismo tiempo: son dos pedidos
    // independientes y encadenarlos duplicaba la espera al abrir un estudio.
    const [metaResp, fileResp] = await Promise.all([
      fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`,
            { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
            { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const meta = await metaResp.json();

    if (!fileResp.ok) {
      const errBody = await fileResp.text();
      return res.status(fileResp.status).send(`Error Drive ${fileResp.status}: ${errBody.substring(0, 300)}`);
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
