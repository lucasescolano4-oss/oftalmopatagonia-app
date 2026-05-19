// Proxy serverless — reenvía recordatorios de cirugía al bot de Railway
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

    try {
        const resp = await fetch(
            'https://botwhatsapp-production-d770.up.railway.app/enviar-cirugia',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
            }
        );
        const data = await resp.json();
        res.status(resp.status).json(data);
    } catch (err) {
        console.error('[PROXY cirugia]', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
