// Proxy serverless — manda por WhatsApp un archivo que ya está en Drive.
// Exige sesión: este endpoint puede enviar cualquier archivo del Drive de la
// clínica a cualquier número, así que no puede quedar abierto.
import { rechazarSinSesion } from './_auth.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://oftalmopatagonia-app.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

    if (await rechazarSinSesion(req, res)) return;

    const { numero, fileId } = req.body || {};
    if (!numero || !fileId) { res.status(400).json({ ok: false, error: 'Faltan numero o fileId' }); return; }
    if (!/^[A-Za-z0-9_-]{10,}$/.test(String(fileId))) {
        res.status(400).json({ ok: false, error: 'fileId invalido' });
        return;
    }

    try {
        const resp = await fetch(
            'https://botwhatsapp-production-0692.up.railway.app/enviar-desde-drive',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': process.env.BOT_API_KEY || '',
                },
                body: JSON.stringify({ numero, fileId }),
            }
        );
        const data = await resp.json();
        res.status(resp.status).json(data);
    } catch (err) {
        console.error('[PROXY] Error al enviar desde Drive:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
