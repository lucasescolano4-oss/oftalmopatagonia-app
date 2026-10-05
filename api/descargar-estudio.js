// Entrega un archivo al paciente que validó su enlace.
//
// No alcanza con un token válido: se comprueba que el archivo pedido sea
// realmente de ese paciente. Sin eso, alguien con su propio enlace podría
// pedir el identificador del estudio de otra persona.
import crypto from 'crypto';

const SUPABASE_URL = 'https://jxhxitgyvssxhmfpzzlt.supabase.co';

async function supa(path) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada en Vercel');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}`);
    return r.json();
}

async function tokenDrive(sa) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600, iat: now,
    })).toString('base64url');
    const firma = crypto.createSign('RSA-SHA256');
    firma.update(`${header}.${payload}`);
    const sig = firma.sign(sa.private_key, 'base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${sig}`,
    });
    const d = await r.json();
    if (!d.access_token) throw new Error('No se pudo autenticar contra Drive');
    return d.access_token;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const { token, dni, id } = req.query || {};
    const dniLimpio = String(dni || '').replace(/\D/g, '');

    if (!/^[0-9a-f-]{36}$/i.test(String(token || '')) ||
        !/^\d{7,9}$/.test(dniLimpio) ||
        !/^[A-Za-z0-9_-]{10,}$/.test(String(id || ''))) {
        res.status(400).send('Solicitud inválida');
        return;
    }

    try {
        const filas = await supa(`accesos_estudios?token=eq.${token}&select=dni,vence_en,revocado`);
        const acceso = filas && filas[0];
        if (!acceso || acceso.revocado || acceso.dni !== dniLimpio || new Date(acceso.vence_en) < new Date()) {
            res.status(403).send('No autorizado');
            return;
        }

        const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        const tk = await tokenDrive(sa);

        const meta = await (await fetch(
            `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${tk}` } })).json();

        // El archivo tiene que ser de este paciente: sus nombres llevan el DNI.
        if (!meta.name || !meta.name.includes(acceso.dni)) {
            console.warn(`[descarga] ${id} no corresponde al DNI ${acceso.dni}`);
            res.status(403).send('No autorizado');
            return;
        }

        const archivo = await fetch(
            `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${tk}` } });
        if (!archivo.ok) { res.status(archivo.status).send('No se pudo obtener el archivo'); return; }

        const buffer = Buffer.from(await archivo.arrayBuffer());
        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition',
            `${req.query.descargar ? 'attachment' : 'inline'}; filename="${encodeURIComponent(meta.name)}"`);
        res.send(buffer);
    } catch (e) {
        console.error('[descargar-estudio]', e.message);
        res.status(500).send('Error al obtener el archivo');
    }
}
