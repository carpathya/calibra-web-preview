/* =========================================================================
 * Calibra — Datos semilla (demo sin backend)
 * Backus · Clasificación de envases retornables (CD Huancayo)
 *
 * Este archivo define las reglas fijas del negocio y una función que
 * construye el estado inicial de la demo. No hay import/export: todo
 * cuelga de globals para funcionar con file:// (doble clic en index.html).
 * ========================================================================= */

/* Reglas fijas del negocio (SOP + decisiones del cliente) */
const REGLAS = {
  CAJAS_PALLET_CAJA12: 84,       // caja 12 → pallet completo de 84
  CAJAS_PALLET_CAJA24: 80,       // caja 24 → pallet completo de 80
  BOTELLAS_CAJA_12: 12,
  BOTELLAS_CAJA_24: 24,
  MAX_CAJAS_PALLET: 500,         // tope editable del total confirmado
  UMBRAL_MBFU: 0.40,             // % — ALERTA referencial, nunca rechazo automático
  META_CAJAS_HORA: 265,          // Meta de productividad por clasificador
  META_DEL_DIA: 32,              // referencia del almacén (no cuota personal)
  MIN_PALLETS_MUESTREO: 2,
  MAX_PALLETS_MUESTREO: 3,
};

/* Las 6 categorías CONTABLES de clasificación (PROYECTO.md §6).
 * "Sanas" ya NO se cuenta: se calcula por descarte en BOTELLAS (botellasSanas
 * en state.js, sobre las botellas inferidas del total). */
const CATEGORIAS = [
  { id: 'rotas',           nombre: 'Rotas',                        detalle: 'Incluye pico roto' },
  { id: 'competencia',     nombre: 'Competencia',                  detalle: 'Envases de otra marca' },
  { id: 'faltantes',       nombre: 'Faltantes',                    detalle: 'Cavidades sin botella' },
  { id: 'extrano',         nombre: 'Extraño',                      detalle: 'Otros formatos' },
  { id: 'sucio_lavable',   nombre: 'Sucio lavable',                detalle: 'Se recupera con lavado' },
  { id: 'sucio_inlavable', nombre: 'Sucio imposible / Inlavables', detalle: 'Cemento, grasa, esmalte, pintura' },
];

/* Ciclo de vida del pallet (colores consistentes en toda la demo):
 * DISPONIBLE → EN_PROCESO → CLASIFICADO → EN_MUESTREO → LISTO → DESPACHADO
 * (cyan = abastecido/esperando toma; azul = en proceso; verde = clasificado;
 * violeta = en muestreo; teal = listo/certificado. DESPACHADO no se dibuja:
 * al despachar, la posición queda vacía.) */
const ESTADO_PALLET = {
  DISPONIBLE:  { label: 'Disponible',  color: '#0ea5e9' },
  EN_PROCESO:  { label: 'En proceso',  color: '#2563eb' },
  CLASIFICADO: { label: 'Clasificado', color: '#16a34a' },
  EN_MUESTREO: { label: 'En muestreo', color: '#7c3aed' },
  LISTO:       { label: 'Listo',       color: '#0d9488' },
  DESPACHADO:  { label: 'Despachado',  color: '#64748b' },
};

/* Ciclo de vida de la bahía: PENDIENTE → EN_PROCESO (X de N) → COMPLETADA */
const ESTADO_BAHIA = {
  PENDIENTE:  { label: 'Pendiente',      color: '#9ca3af' },
  EN_PROCESO: { label: 'En proceso',     color: '#2563eb' },
  COMPLETADA: { label: 'Completada',     color: '#16a34a' },
  SIN_CONFIG: { label: 'Sin configurar', color: '#cbd5e1' },
};

function conteoVacio() {
  const c = {};
  CATEGORIAS.forEach(cat => { c[cat.id] = 0; });
  return c;
}

/* Construye el estado inicial de la demo. Se invoca de nuevo en cada
 * "Reiniciar demo". Arranca como PRIMER USO: almacén vacío, sin posiciones
 * activas ni pallets — el administrador abre el día activando posiciones
 * (Configurar) y abasteciendo pallets (Abastecer), que quedan DISPONIBLES. */
function crearSemilla() {
  const zonas = [
    { id: 'Z1', nombre: 'Zona 1' },
    { id: 'Z2', nombre: 'Zona 2' },
  ];

  /* Las bahías NO se asignan a nadie: son solo la organización física del
   * almacén. El clasificador toma un CONJUNTO (normalmente = bahía).
   * Posiciones variables por bahía (pares de filas A/B), como el almacén real
   * (~20–30 por bahía; SOP: 20–28). Al inicio NINGUNA está activa: el admin
   * las activa en la apertura según lo que espera recibir. */
  const configBahias = [
    { id: 'Z1-B1', zonaId: 'Z1', codigo: 'Bahía 1', pares: 15 },   // 30 posiciones
    { id: 'Z1-B2', zonaId: 'Z1', codigo: 'Bahía 2', pares: 12 },   // 24 posiciones
    { id: 'Z1-B3', zonaId: 'Z1', codigo: 'Bahía 3', pares: 10 },   // 20 posiciones
    { id: 'Z2-B1', zonaId: 'Z2', codigo: 'Bahía 1', pares: 14 },   // 28 posiciones
    { id: 'Z2-B2', zonaId: 'Z2', codigo: 'Bahía 2', pares: 8 },    // 16 posiciones
  ];
  const bahias = [];
  const posiciones = [];
  configBahias.forEach(b => {
    bahias.push({ id: b.id, zonaId: b.zonaId, codigo: b.codigo });
    for (let i = 1; i <= b.pares; i++) {
      ['A', 'B'].forEach(prefijo => {
        const cod = prefijo + i;
        posiciones.push({
          id: b.id + '-' + cod,
          bahiaId: b.id,
          codigo: cod,
          activa: false, // primera vez: el admin las activa en la apertura
          palletId: null,
        });
      });
    }
  });

  const trabajadores = [
    { id: 'T1', nombre: 'Edinson Quispe', activo: true },
    { id: 'T2', nombre: 'Bruner Salazar', activo: true },
    { id: 'T3', nombre: 'Rosa Huamán',    activo: true },
    { id: 'T4', nombre: 'Carlos Paredes', activo: true },
    { id: 'T5', nombre: 'María Tello',    activo: true },
  ];

  /* Operadores (montacargas): tercer actor, usuarios propios. Retiran los
   * pallets CLASIFICADO/LISTO desde cualquier lugar del almacén. */
  const operadores = [
    { id: 'O1', nombre: 'Mario Ramos',  activo: true },
    { id: 'O2', nombre: 'José Pintado', activo: true },
  ];

  /* Primer uso: SIN pallets, SIN jornadas ni tandas. Todo se crea desde la
   * app: el admin abastece (DISPONIBLE), el clasificador toma conjuntos y
   * clasifica, el muestreador audita y el operador/admin despachan. */
  const pallets = [];
  const jornadas = [];
  const asignaciones = [];

  return {
    vista: 'admin',
    sesion: { trabajadorId: null, operadorId: null },
    metaDelDia: REGLAS.META_DEL_DIA,
    zonas: zonas,
    bahias: bahias,
    posiciones: posiciones,
    trabajadores: trabajadores,
    operadores: operadores,
    pallets: pallets,
    jornadas: jornadas,
    asignaciones: asignaciones,
  };
}
