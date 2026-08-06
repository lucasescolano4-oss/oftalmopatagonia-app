// Verificacion de sesion para los endpoints que exponen historias clinicas.
// Estos datos son sensibles (Ley 25.326): ningun endpoint que devuelva
// estudios de pacientes puede quedar accesible sin sesion iniciada.
//
// La URL y la clave publishable son publicas por diseno de Supabase
// (ya viajan al navegador); sirven solo para preguntarle a Supabase si el
// token que manda el cliente corresponde a un usuario real.
const SUPABASE_URL = 'https://jxhxitgyvssxhmfpzzlt.supabase.co';
const SUPABASE_ANON = 'sb_publishable_GR173HjCr2rpSxiQbOLzEA_KXKfFMnA';

/**
 * Devuelve el usuario si el pedido trae una sesion valida, o null si no.
 */
export async function usuarioDelPedido(req) {
    const cabecera = req.headers.authorization || '';
    if (!cabecera.startsWith('Bearer ')) return null;

    const token = cabecera.slice(7).trim();
    if (!token) return null;

    try {
        const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
        });
        if (!resp.ok) return null;
        const user = await resp.json();
        return user && user.id ? user : null;
    } catch {
        return null;
    }
}

/**
 * Corta el pedido con 401 si no hay sesion. Devuelve true si ya respondio.
 */
export async function rechazarSinSesion(req, res) {
    const user = await usuarioDelPedido(req);
    if (user) return false;
    console.warn(`[SEGURIDAD] ${req.url} sin sesion valida`);
    res.status(401).json({ ok: false, error: 'No autorizado' });
    return true;
}
