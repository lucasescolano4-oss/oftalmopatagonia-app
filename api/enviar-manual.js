// Proxy serverless — evita CORS llamando a Railway desde servidor a servidor.
// La clave del bot vive solo aca: nunca viaja al navegador.
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://oftalmopatagonia-app.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

    try {
        const resp = await fetch(
            'https://botwhatsapp-production-0692.up.railway.app/enviar-manual',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': process.env.BOT_API_KEY || '',
                },
                body: JSON.stringify(req.body),
            }
        );
        const data = await resp.json();
        res.status(resp.status).json(data);
    } catch (err) {
        console.error('[PROXY] Error al llamar al bot:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
