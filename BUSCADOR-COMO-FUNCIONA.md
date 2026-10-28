# El buscador de estudios — cómo funciona

Documento técnico del buscador por DNI de OftalmoPatagonia. Sirve para leerlo
y también para pegarlo como contexto en otra inteligencia artificial: describe
el estado real del código, no el ideal.

Última revisión: 24 de octubre de 2026.

---

## 1. Qué hace

Busca los estudios e informes de un paciente **por su número de DNI**, en las
carpetas de Google Drive que estén compartidas con el sistema, y los muestra
agrupados por consulta.

Hay dos pantallas que lo usan:

| Pantalla | Quién entra | Qué ve |
|---|---|---|
| `consulta.html` | Médicos, con usuario y contraseña | Todo lo que haya de ese DNI |
| `index.html` → Buscar pacientes | Los dos médicos del consultorio | Lo mismo, dentro del sistema |

Hay una tercera pantalla, `estudios.html`, que es para el paciente y funciona
distinto: entra por código QR y no busca por DNI libre.

---

## 2. El recorrido de una búsqueda, paso a paso

```
Navegador                  Vercel                      Google Drive
─────────                  ──────                      ────────────
escribe el DNI
     │
     ├─ GET /api/buscar-archivos?dni=12345678
     │  con cabecera Authorization: Bearer <token de sesión>
     │                             │
     │                   valida la sesión contra Supabase
     │                   valida que el DNI sean 7 a 9 dígitos
     │                   obtiene el token de Drive (reusa el de memoria)
     │                             │
     │                             ├─ busca estudios ──────────────▶
     │                             ├─ busca informes ──────────────▶   (en paralelo)
     │                             │                                    ◀── archivos
     │                   quita de estudios los que ya son informes
     │◀────────── { ok, estudios[], informes[] } ──┘
     │
  agrupa por consulta y dibuja
     │
     └─ anota la búsqueda en consultas_log
```

### Las dos consultas a Drive

```javascript
// Estudios: cualquier archivo con el DNI en el nombre, esté donde esté
`name contains '${dni}' and trashed = false`

// Informes: lo mismo, pero solo dentro de la carpeta de informes
`name contains '${dni}' and '${CARPETA_INFORMES}' in parents and trashed = false`
```

Ambas con `corpora=allDrives`, o sea **sobre todo lo que la cuenta de servicio
pueda ver**, sin limitarse a ninguna carpeta en particular.

Van con `Promise.all` porque no dependen una de la otra. Antes se esperaba a
que terminara la primera para empezar la segunda y el usuario pagaba las dos
esperas sumadas.

### De dónde viene cada archivo

Drive devuelve, además del archivo, **la carpeta que lo contiene y la cuenta de
Google que lo subió**. El buscador los pide y los muestra debajo del nombre:

```
92523954_BELLA_ALMENDRA_92523954.pdf
14 de marzo de 2026 · 3.9 MB
📁 RFG   oftalmopatagonia@gmail.com
```

Es lo que permite distinguir un estudio propio de uno que llegó compartido por
otro consultorio. La carpeta además suele decir de qué estudio se trata, porque
están organizadas por tipo.

La búsqueda trae el **identificador** de la carpeta, no su nombre; pedir el
nombre es una llamada más por carpeta. Como casi nunca cambia, se guarda en
memoria: la primera búsqueda pregunta por dos o tres carpetas y las siguientes
no preguntan nada.

En una unidad compartida Drive no informa dueño. En ese caso la cuenta queda
vacía y solo se muestra la carpeta.

### Ver un archivo

Los endpoints exigen la cabecera de sesión y un `<iframe>` no puede mandarla.
Por eso el archivo se baja con `fetch` autenticado y se muestra desde un blob
local, no apuntando el iframe a la dirección.

---

## 3. La pieza clave: el DNI en el nombre del archivo

**El único vínculo entre un paciente y sus archivos es el nombre del archivo.**
No hay base de datos que los relacione. Si el nombre no tiene el DNI, el
archivo no existe para el buscador.

Formatos que conviven hoy y que el sistema entiende:

```
6665642_BASILIO SABINA_08_10_2026.pdf
6665642_BASILIO SABINA_19/09/2025.pdf
6665642_SABINA_BASILIO_20261008.pdf
6665642_BASILIO_SABINA_20261008_IOLCALC.pdf
```

Dos detalles que importan:

**Drive no busca subcadenas libres**, hace coincidencia por palabra. Separa por
guiones, barras, puntos y guiones bajos, así que un DNI al final del nombre se
encuentra igual que al principio. Verificado contra archivos reales.

**La fecha se lee del nombre, no de Drive.** La fecha de creación en Drive es
la de la subida: un estudio de septiembre de 2025 escaneado en marzo de 2026
figuraba como de marzo. La función que la resuelve acepta `20261008` y
`08_10_2026`, descarta fechas imposibles (mes 13) y quita el DNI del nombre
antes de buscar, porque un DNI como `20051203` se lee como fecha válida.

---

## 4. Agrupación por consulta

Los resultados no se muestran como "todos los informes arriba y todos los
estudios abajo". Se agrupan por consulta: el informe con los estudios que
comenta.

No agrupa por fecha exacta. Abre un grupo nuevo recién cuando hay **más de
siete días** de separación entre un archivo y el anterior. El motivo: un
estudio subido al día siguiente, o un informe fechado con dos días de
diferencia, son la misma consulta. Siete días es mucho más que cualquier
demora de carga y mucho menos que el intervalo entre controles, que son meses.

---

## 5. Estructura del código

No hay framework, no hay compilación. HTML, CSS y JavaScript escritos a mano.

### Lo que corre en Vercel (`api/`)

Los archivos que empiezan con guion bajo **no cuentan** como funciones de
Vercel: son ayudantes que los otros importan.

| Archivo | Qué hace |
|---|---|
| `_auth.js` | Valida la sesión contra Supabase. `rechazarSinSesion` corta con 401 |
| `_drive.js` | Token de Google, guardado en memoria mientras dure su hora |
| `buscar-archivos.js` | **El buscador.** Recibe un DNI, devuelve estudios e informes |
| `ver-archivo.js` | Entrega un archivo por su identificador de Drive |
| `bot.js` | Único intermediario con el bot de WhatsApp. La acción va por parámetro |
| `acceso-estudios.js` | El camino del paciente por QR: valida el enlace y lista sus archivos |
| `descargar-estudio.js` | Entrega un archivo al paciente, verificando que sea suyo |

**Cinco funciones de doce** en el plan gratuito. Antes eran doce de doce: ocho
intermediarios del bot con el mismo código y una palabra cambiada se
unificaron en `bot.js`.

### Las páginas

| Archivo | Para quién |
|---|---|
| `index.html` | El sistema de los médicos. Un solo archivo de unas 6.500 líneas |
| `consulta.html` | Búsqueda entre profesionales. Solo lectura |
| `estudios.html` | El paciente, llegando por QR. Pensada para teléfono |

### El bot (otro repositorio)

`whatsapp_drive_bot`, en TypeScript, desplegado en Railway. No participa del
buscador: se ocupa de WhatsApp.

---

## 6. Cómo sumar la carpeta de otra persona

**Hoy es un solo paso y no requiere tocar código.**

La otra persona entra a su Google Drive, hace clic derecho sobre la carpeta →
**Compartir**, y la comparte con este correo, con permiso de **Lector**:

```
drive-integracion@makeoftalmo.iam.gserviceaccount.com
```

Desde ese momento sus archivos aparecen en las búsquedas. No hay que
registrar ningún identificador de carpeta: la búsqueda recorre todo lo que la
cuenta de servicio alcance a ver.

### Las dos condiciones

**Los archivos tienen que llevar el DNI en el nombre.** Sin eso la carpeta
queda compartida y no se encuentra nada. Es el error más común al sumar a
alguien.

**Conviene compartir una carpeta dedicada a estudios.** No porque compartir
otra rompa algo, sino porque todo lo compartido entra en la búsqueda: un
presupuesto llamado `31372055_presupuesto.pdf` aparecería listado como si
fuera un estudio de ese paciente.

### Sobre el espacio en Drive

El espacio lo paga **el dueño del archivo, no el dueño de la carpeta**. Subir
un archivo desde la cuenta A a una carpeta de la cuenta B descuenta de A. Para
repartir el almacenamiento entre varias cuentas gratuitas, cada una tiene que
subir sus propios archivos.

---

## 7. Lo que conviene saber antes de modificarlo

Tres cosas que un desarrollador nuevo descubriría tarde:

**La búsqueda no está acotada a carpetas.** Mientras todo lo compartido sea del
mismo consultorio no se nota. En cuanto haya una segunda institución, toda
búsqueda devuelve las dos mezcladas. Acotarla exige registrar las carpetas y
resolver sus subcarpetas, porque Drive solo sabe buscar hijos directos y los
estudios están organizados por año.

**La autorización vive en la página, no en el endpoint.** `buscar-archivos`
solo comprueba que haya una sesión válida de Supabase; quién puede ver qué lo
decide `consulta.html` contra la tabla `allowed_emails`. Cualquier cuenta con
sesión puede llamar al endpoint directamente. Con cuatro cuentas propias es
aceptable; con instituciones distintas, no.

**La cuenta de servicio es una llave única.** Una sola credencial abre todo lo
que esté compartido con ella. El umbral razonable para cambiarlo —una
credencial por institución, o que cada cuenta autorice su propio Drive— es
cuando entre la tercera institución.

---

## 8. Registro

Cada búsqueda queda asentada en `consultas_log`: quién, qué DNI, cuántos
resultados y cuándo. La tabla se puede escribir pero no leer desde el
navegador, así que nadie ve lo que buscaron los demás ni puede borrar su
propio rastro. Se consulta desde el panel de Supabase.

Es lo que distingue una herramienta de consulta profesional de un acceso
abierto a historias clínicas ajenas.
