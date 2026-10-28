// Acceso a Google Drive compartido por los endpoints.
//
// El token de la cuenta de servicio dura una hora, pero antes se firmaba uno
// nuevo en cada busqueda: eso sumaba una ida y vuelta a Google (medio segundo
// aprox.) a cada consulta. Aca se guarda en memoria y se reusa mientras siga
// vigente. Vercel mantiene viva la funcion entre pedidos cercanos, asi que el
// token se firma una vez por hora en lugar de una vez por busqueda.
import crypto from 'crypto';

let tokenEnMemoria = null;   // { valor, vence }

function firmarJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(sa.private_key, 'base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * Devuelve un token de Drive, reusando el anterior si todavia sirve.
 */
export async function tokenDrive(sa) {
  // Un minuto de margen para no usar un token que caduca a mitad del pedido.
  if (tokenEnMemoria && tokenEnMemoria.vence > Date.now() + 60_000) {
    return tokenEnMemoria.valor;
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${firmarJWT(sa)}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('No se pudo obtener token: ' + JSON.stringify(data));

  const duraSegundos = Number(data.expires_in) || 3600;
  tokenEnMemoria = { valor: data.access_token, vence: Date.now() + duraSegundos * 1000 };
  return data.access_token;
}

// Nombres de carpeta, guardados en memoria. La busqueda devuelve el id de la
// carpeta de cada archivo, no su nombre, y pedirlo es una llamada mas por
// carpeta. Como el nombre casi nunca cambia, alcanza con preguntarlo una vez:
// una busqueda toca dos o tres carpetas distintas y suelen ser siempre las
// mismas, asi que a partir del segundo paciente ya no se pregunta nada.
const nombresCarpeta = new Map();   // id -> nombre

/**
 * Devuelve { id: nombre } para los ids pedidos. Una carpeta que no se pueda
 * leer queda afuera del resultado en vez de cortar la busqueda entera: saber
 * de donde sale un archivo es un dato de mas, no un requisito.
 */
export async function nombresDeCarpetas(token, ids) {
  const faltantes = [...new Set(ids)].filter(id => id && !nombresCarpeta.has(id));

  await Promise.all(faltantes.map(async id => {
    try {
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?fields=name&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.name) nombresCarpeta.set(id, data.name);
    } catch { /* sin nombre, el archivo se lista igual */ }
  }));

  const salida = {};
  for (const id of ids) if (nombresCarpeta.has(id)) salida[id] = nombresCarpeta.get(id);
  return salida;
}

/**
 * Cuenta de servicio leida de la variable de entorno de Vercel.
 */
export function cuentaDeServicio() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT no configurado en Vercel');
  return JSON.parse(saJson);
}
