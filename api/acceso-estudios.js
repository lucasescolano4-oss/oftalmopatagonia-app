// Entrega los estudios de un paciente a quien escanea el QR de su informe.
//
// Es el único endpoint del sistema al que se llega SIN sesión, así que la
// validación es la única barrera: hacen falta las dos cosas juntas, el token
// del QR (imposible de adivinar) y el DNI del paciente. Ni el token suelto
// —si el informe se pierde o lo fotografían— ni el DNI suelto abren nada.
import crypto from 'crypto';

const SUPABASE_URL = 'https://jxhxitgyvssxhmfpzzlt.supabase.co';
const CARPETA_INFORMES = '1aVuHtL48zQi1QdQj0jONyjBrn8fTqIT3';

/** Consulta a Supabase con la clave de servicio, que vive solo en el servidor. */
async function supa(path, opciones = {}) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada en Vercel');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...opciones,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(opciones.headers || {}),
        },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 180)}`);
    return r.status === 204 ? null : r.json();
}

async function registrar(token, dni, exito, motivo, ip) {
    try {
        await supa('accesos_estudios_log', {
            method: 'POST',
            body: JSON.stringify({ token, dni_probado: dni, exito, motivo, ip }),
        });
    } catch (e) {
        console.error('[acceso] no se pudo registrar:', e.message);
    }
}

// ── Google Drive ────────────────────────────────────────────────────────────
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

/**
 * Fecha del estudio leída del nombre del archivo.
 *
 * La que trae Drive es la de la subida, y no siempre coinciden: un estudio de
 * septiembre de 2025 escaneado meses después figuraba como de marzo de 2026.
 * El nombre, en cambio, lleva la fecha real.
 *
 * Se aceptan las dos formas que conviven en la carpeta: 20261008 y 08_10_2026
 * (con guiones, barras, puntos o guiones bajos). Si no hay ninguna, se usa la
 * de Drive.
 */
function fechaDelNombre(nombre, dni) {
    if (!nombre) return null;
    // El DNI va al principio del nombre y puede confundirse con una fecha.
    const limpio = dni ? nombre.split(dni).join(' ') : nombre;

    const candidatas = [];
    for (const m of limpio.matchAll(/(20\d{2})(\d{2})(\d{2})/g)) {
        candidatas.push(armarFecha(m[1], m[2], m[3]));
    }
    for (const m of limpio.matchAll(/(\d{1,2})[_\-/.](\d{1,2})[_\-/.](20\d{2})/g)) {
        candidatas.push(armarFecha(m[3], m[2], m[1]));
    }

    // La última válida: la fecha suele ir al final, los números sueltos antes.
    const validas = candidatas.filter(Boolean);
    return validas.length ? validas[validas.length - 1] : null;
}

function armarFecha(anio, mes, dia) {
    const a = Number(anio), me = Number(mes), d = Number(dia);
    const f = new Date(Date.UTC(a, me - 1, d, 12));
    if (isNaN(f)) return null;
    // Date corrige solo los desbordes (32 de enero pasa a febrero); si los
    // componentes no vuelven iguales, no era una fecha.
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== me - 1 || f.getUTCDate() !== d) return null;
    return f.toISOString();
}

// Días alrededor de la fecha de la visita en los que se aceptan archivos.
// Los estudios se suben el mismo día o en los días siguientes; el informe
// puede demorar algo más. Fuera de esta ventana ya es otra consulta.
const DIAS_ANTES  = 5;
const DIAS_DESPUES = 45;

function ventanaDeLaVisita(fechaVisita) {
    const base = new Date(fechaVisita + 'T12:00:00Z');
    if (isNaN(base)) return null;
    const desde = new Date(base); desde.setUTCDate(desde.getUTCDate() - DIAS_ANTES);
    const hasta = new Date(base); hasta.setUTCDate(hasta.getUTCDate() + DIAS_DESPUES);
    return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/**
 * Archivos que corresponden a UNA visita, no a toda la historia clínica.
 *
 * El enlace del QR no vence, así que lo que lo mantiene acotado es esto: el
 * informe impreso da acceso a los estudios que ese informe comenta, y nada
 * más. El historial completo se consulta desde el sistema, con sesión.
 */
async function archivosDelPaciente(dni, fechaVisita) {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT no configurada');
    const token = await tokenDrive(JSON.parse(saJson));

    // Los accesos creados antes de que existiera la fecha no la tienen: para
    // esos se mantiene el comportamiento anterior y se devuelve todo.
    const ventana = fechaVisita ? ventanaDeLaVisita(fechaVisita) : null;
    const porFecha = ventana
        ? ` and createdTime >= '${ventana.desde}' and createdTime <= '${ventana.hasta}'`
        : '';

    const buscar = async (q) => {
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`
                  + `&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime desc`
                  + `&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=60`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        return (await r.json()).files || [];
    };

    const informes = await buscar(`name contains '${dni}' and '${CARPETA_INFORMES}' in parents and trashed = false${porFecha}`);
    const todos    = await buscar(`name contains '${dni}' and trashed = false${porFecha}`);
    const idsInf   = new Set(informes.map(f => f.id));

    return [
        ...informes.map(f => ({ ...f, esInforme: true })),
        ...todos.filter(f => !idsInf.has(f.id)),
    ].map(f => ({
        id: f.id, nombre: f.name, tipo: f.mimeType,
        fecha: fechaDelNombre(f.name, dni) || f.createdTime,
        peso: f.size ? Number(f.size) : null,
        esInforme: !!f.esInforme,
    }));
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Método no permitido' }); return; }

    const { token, dni } = req.body || {};
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

    if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) {
        res.status(400).json({ ok: false, error: 'El enlace no es válido.' });
        return;
    }
    const dniLimpio = String(dni || '').replace(/\D/g, '');
    if (!/^\d{7,9}$/.test(dniLimpio)) {
        res.status(400).json({ ok: false, error: 'Ingresá tu DNI sin puntos.' });
        return;
    }

    // Mensaje único para token inexistente, vencido o DNI que no coincide: así
    // nadie puede usar el formulario para averiguar si un enlace existe.
    const rechazo = { ok: false, error: 'No pudimos validar los datos. Revisá el DNI o comunicate con la clínica.' };

    try {
        const filas = await supa(`accesos_estudios?token=eq.${token}&select=*`);
        const acceso = filas && filas[0];

        if (!acceso)         { await registrar(token, dniLimpio, false, 'token inexistente', ip); res.status(404).json(rechazo); return; }
        if (acceso.revocado) { await registrar(token, dniLimpio, false, 'revocado', ip);          res.status(403).json(rechazo); return; }

        // vence_en nulo = sin vencimiento. Los enlaces viejos siguen teniendo
        // fecha y se respeta.
        if (acceso.vence_en && new Date(acceso.vence_en) < new Date()) {
            await registrar(token, dniLimpio, false, 'vencido', ip);
            res.status(403).json({ ok: false, error: 'Este enlace venció. Comunicate con la clínica para que te envíen uno nuevo.' });
            return;
        }
        if (acceso.dni !== dniLimpio) { await registrar(token, dniLimpio, false, 'dni no coincide', ip); res.status(403).json(rechazo); return; }

        const archivos = await archivosDelPaciente(acceso.dni, acceso.fecha_estudios);

        await supa(`accesos_estudios?token=eq.${token}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ visitas: (acceso.visitas || 0) + 1, ultima_visita: new Date().toISOString() }),
        });
        await registrar(token, dniLimpio, true, 'ok', ip);

        res.status(200).json({
            ok: true,
            nombre: acceso.nombre || '',
            vence: acceso.vence_en,
            fechaVisita: acceso.fecha_estudios || null,
            archivos,
        });
    } catch (e) {
        console.error('[acceso-estudios]', e.message);
        res.status(500).json({ ok: false, error: 'No pudimos acceder a los estudios en este momento.' });
    }
}
