// Único intermediario entre la página y el bot de WhatsApp.
//
// Antes había ocho archivos con el mismo código y una palabra cambiada, uno
// por acción. Vercel cuenta cada uno como una función y el plan gratuito
// admite doce: los ocho ocupaban la mayor parte del cupo y bloqueaban
// cualquier cosa nueva. Acá la acción viaja como parámetro.
//
// La clave del bot vive solo de este lado: nunca viaja al navegador.
import { rechazarSinSesion } from './_auth.js';

const BOT = 'https://botwhatsapp-production-0692.up.railway.app';

// Lista blanca. Sin esto, la acción la elegiría quien llama, y podría
// apuntar a cualquier ruta del bot.
const ACCIONES = new Set([
    'enviar-estudios',
    'enviar-informe',
    'enviar-libre',
    'enviar-manual',
    'enviar-cirugia',
    'enviar-documento',
    'enviar-desde-drive',
    'enviar-email',
]);

// Los adjuntos van en base64 dentro del cuerpo. Era el límite que tenía el
// intermediario de documentos; acá aplica a todos, que es un máximo y no
// obliga a nadie.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://oftalmopatagonia-app.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

    // Todo esto manda mensajes a pacientes o mueve sus estudios: exige sesión.
    if (await rechazarSinSesion(req, res)) return;

    const accion = String((req.query && req.query.accion) || '');
    if (!ACCIONES.has(accion)) {
        res.status(400).json({ ok: false, error: 'Acción no permitida' });
        return;
    }

    // Lo propio del envío desde Drive: con un identificador de archivo
    // cualquiera, este camino mandaría cualquier archivo de la clínica a
    // cualquier número.
    if (accion === 'enviar-desde-drive') {
        const { numero, fileId } = req.body || {};
        if (!numero || !fileId) {
            res.status(400).json({ ok: false, error: 'Faltan numero o fileId' });
            return;
        }
        if (!/^[A-Za-z0-9_-]{10,}$/.test(String(fileId))) {
            res.status(400).json({ ok: false, error: 'fileId invalido' });
            return;
        }
    }

    try {
        const resp = await fetch(`${BOT}/${accion}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.BOT_API_KEY || '',
            },
            body: JSON.stringify(req.body),
        });
        const data = await resp.json();
        res.status(resp.status).json(data);
    } catch (err) {
        console.error(`[PROXY ${accion}]`, err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
