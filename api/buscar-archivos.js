import { rechazarSinSesion } from './_auth.js';
import { tokenDrive, cuentaDeServicio } from './_drive.js';

const CARPETA_INFORMES = '1aVuHtL48zQi1QdQj0jONyjBrn8fTqIT3';

async function buscarEnDrive(token, query, extra = '') {
  const q = encodeURIComponent(query);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink,createdTime,size)&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&orderBy=createdTime+desc&pageSize=100${extra}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await resp.json();
  return data.files || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://oftalmopatagonia-app.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Listar estudios por DNI equivale a leer una historia clinica: exige sesion.
  if (await rechazarSinSesion(req, res)) return;

  const { dni } = req.query;
  if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });

  // Solo digitos: el DNI se interpola en la query de Drive y una comilla
  // simple permitiria alterar la busqueda para listar archivos ajenos.
  if (!/^\d{7,9}$/.test(String(dni))) {
    return res.status(400).json({ ok: false, error: 'dni invalido' });
  }

  try {
    const sa = cuentaDeServicio();
    const token = await tokenDrive(sa);

    // Las dos busquedas no dependen una de la otra, asi que van juntas:
    // antes se esperaba a que terminara la de estudios para recien empezar
    // la de informes, y el usuario pagaba las dos esperas sumadas.
    const [estudios, informes] = await Promise.all([
      // Estudios: cualquier archivo con el DNI en el nombre
      buscarEnDrive(token, `name contains '${dni}' and trashed = false`),
      // Informes: solo en la carpeta de informes
      buscarEnDrive(token, `name contains '${dni}' and '${CARPETA_INFORMES}' in parents and trashed = false`),
    ]);

    // Filtrar de estudios los que ya están en informes (para no duplicar)
    const informeIds = new Set(informes.map(f => f.id));
    const soloEstudios = estudios.filter(f => !informeIds.has(f.id));

    res.json({ ok: true, estudios: soloEstudios, informes });
  } catch (err) {
    console.error('[buscar-archivos]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
