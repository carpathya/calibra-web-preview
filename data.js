/* =========================================================================
 * Sorty — Datos semilla (demo sin backend)
 * Backus · Clasificación de envases retornables (CD Huancayo)
 *
 * Este archivo define las reglas fijas del negocio y una función que
 * construye el estado inicial de la demo. No hay import/export: todo
 * cuelga de globals para funcionar con file:// (doble clic en index.html).
 * ========================================================================= */

/* Reglas fijas del negocio (SOP + decisiones del cliente) */
const REGLAS = {
  CAJAS_POR_PALLET: 84,          // Formato 620: 7 de alto × 12 por cama
  BOTELLAS_POR_CAJA: 12,
  BOTELLAS_POR_PALLET: 1008,     // 84 × 12
  MAX_CAJAS_PALLET: 500,         // tope editable del total confirmado
  UMBRAL_MBFU: 0.40,             // % — ALERTA referencial, nunca rechazo automático
  META_CAJAS_HORA: 265,          // Meta de productividad por clasificador
  MIN_PALLETS_MUESTREO: 2,
  MAX_PALLETS_MUESTREO: 3,
};

/* Las 6 categorías CONTABLES de clasificación (PROYECTO.md §6).
 * "Sanas" ya NO se cuenta: se calcula por descarte en la vista (state.js
 * botellasSanas). Los contadores de la pantalla de conteo usan estas claves. */
const CATEGORIAS = [
  { id: 'rotas',           nombre: 'Rotas',                        detalle: 'Incluye pico roto' },
  { id: 'competencia',     nombre: 'Competencia',                  detalle: 'Envases de otra marca' },
  { id: 'faltantes',       nombre: 'Faltantes',                    detalle: 'Cavidades sin botella' },
  { id: 'extrano',         nombre: 'Extraño',                      detalle: 'Otros formatos' },
  { id: 'sucio_lavable',   nombre: 'Sucio lavable',                detalle: 'Se recupera con lavado' },
  { id: 'sucio_inlavable', nombre: 'Sucio imposible / Inlavables', detalle: 'Cemento, grasa, esmalte, pintura' },
];

/* Catálogo de tipos de caja (semilla configurable; PROYECTO.md §4).
 * Cada tipo define sus botellas por caja; botellasRevisadas lo usa.
 * Listo para agregar tipos (p. ej. chata = 24) sin tocar la lógica. */
const TIPOS_CAJA = [
  { id: 'cerveza', nombre: 'Cerveza', botellas: 12 },
  { id: 'litro',   nombre: 'Litro',   botellas: 12 },
];

/* Ciclo de vida del pallet (colores consistentes en toda la demo):
 * EN_PROCESO → CLASIFICADO → EN_MUESTREO → LISTO → DESPACHADO
 * (violeta = "en muestreo"; teal = LISTO/certificado. No hay estado rojo
 * permanente: una tanda grave devuelve el lote a EN_PROCESO. DESPACHADO no se
 * dibuja en el mapa: al despachar, la posición queda libre al instante.) */
const ESTADO_PALLET = {
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
 * "Reiniciar demo", así que las horas se calculan respecto al momento
 * actual y la narrativa "hoy / ayer" siempre cuadra. */
function crearSemilla() {
  const AHORA = Date.now();
  const haceMin = m => AHORA - m * 60000; // timestamp de "hace m minutos"

  const zonas = [
    { id: 'Z1', nombre: 'Zona 1' },
    { id: 'Z2', nombre: 'Zona 2' },
  ];

  /* Las bahías NO se asignan a nadie: son solo la organización física del
   * almacén. Los clasificadores toman pallets libres desde su app.
   * Posiciones variables por bahía (pares de filas A/B), como el almacén real
   * (~20–30 por bahía; SOP: 20–28). El admin no activa todo: cada bahía tiene
   * posiciones inactivas. */
  const configBahias = [
    { id: 'Z1-B1', zonaId: 'Z1', codigo: 'Bahía 1', pares: 15, inactivas: ['A7', 'B12', 'B15'] },        // 30 pos / 27 activas
    { id: 'Z1-B2', zonaId: 'Z1', codigo: 'Bahía 2', pares: 12, inactivas: ['A5', 'B9'] },                // 24 pos / 22 activas
    { id: 'Z1-B3', zonaId: 'Z1', codigo: 'Bahía 3', pares: 10, inactivas: ['A4', 'A9', 'B2', 'B7'] },   // 20 pos / 16 activas
    { id: 'Z2-B1', zonaId: 'Z2', codigo: 'Bahía 1', pares: 14, inactivas: ['A11', 'B5', 'B14'] },        // 28 pos / 25 activas
    { id: 'Z2-B2', zonaId: 'Z2', codigo: 'Bahía 2', pares: 8,  inactivas: ['A3', 'B8'] },                // 16 pos / 14 activas
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
          activa: b.inactivas.indexOf(cod) === -1,
          palletId: null,
        });
      });
    }
  });
  const posPorId = {};
  posiciones.forEach(p => { posPorId[p.id] = p; });

  const trabajadores = [
    { id: 'T1', nombre: 'Edinson Quispe', activo: true },
    { id: 'T2', nombre: 'Bruner Salazar', activo: true },
    { id: 'T3', nombre: 'Rosa Huamán',    activo: true },
    { id: 'T4', nombre: 'Carlos Paredes', activo: true },
    { id: 'T5', nombre: 'María Tello',    activo: true },
  ];

  /* Conductores (montacargas): tercer actor, usuarios propios. Retiran los
   * pallets LISTO desde cualquier lugar del almacén, en cualquier momento. */
  const conductores = [
    { id: 'C1', nombre: 'Mario Ramos',  activo: true },
    { id: 'C2', nombre: 'José Pintado', activo: true },
  ];

  /* Conteo por categoría (lo que va encontrando el clasificador; unidad = caja).
   * Solo DEFECTOS: las sanas se calculan por descarte, en BOTELLAS (botellasSanas en state.js).
   * El total del pallet se confirma con valores rápidos (84 completo, 64, 48, otro)
   * y el tipo de caja con el catálogo TIPOS_CAJA. */
  const mkConteo = (rotas, competencia, faltantes, extrano, lavable, inlavable) => ({
    rotas: rotas, competencia: competencia, faltantes: faltantes,
    extrano: extrano, sucio_lavable: lavable, sucio_inlavable: inlavable,
  });

  /* Pallets sembrados. `cajasTotales` = total confirmado por el clasificador;
   * `tipoCaja` = tipo del catálogo. Certificación por LOTE: el muestreo
   * certifica todo el trabajo pendiente del clasificador, no pallet por pallet.
   * Crítico: P-201 con muestreo 6/1008 = 0.60% (≥ 0.40%) → tanda AS-02 EN
   * ALERTA pendiente de decisión del Admin. P-204/P-205 ya certificados LISTO
   * (tanda previa OK) para que el Conductor tenga trabajo al entrar. */
  const pallets = [
    // — Bahía Z1-B1: P-101/P-102 certificados ayer (LISTO, aún sin despachar)
    //   + P-103 liberado (en curso, con hallazgos)
    { id: 'P-101', posicionId: 'Z1-B1-A1', estado: 'LISTO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(2, 1, 1, 0, 1, 0), clasificadoPor: 'T1', jornadaId: 'J-01',
      muestreo: { botellas: 3, pct: 0.2976, alerta: false, muestreadorId: 'T5', asignacionId: 'AS-01', decision: null, ts: haceMin(1500) } },
    { id: 'P-102', posicionId: 'Z1-B1-A2', estado: 'LISTO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(1, 1, 0, 1, 1, 0), clasificadoPor: 'T1', jornadaId: 'J-01',
      muestreo: { botellas: 1, pct: 0.0992, alerta: false, muestreadorId: 'T5', asignacionId: 'AS-01', decision: null, ts: haceMin(1480) } },
    { id: 'P-103', posicionId: 'Z1-B1-A3', estado: 'EN_PROCESO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(1, 0, 0, 0, 1, 0), clasificadoPor: null, jornadaId: null, muestreo: null },

    // — Bahía Z1-B2: 1 clasificado + 2 pallet nuevos sin empezar
    { id: 'P-301', posicionId: 'Z1-B2-A1', estado: 'CLASIFICADO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(1, 0, 1, 0, 1, 0), clasificadoPor: 'T3', jornadaId: 'J-04', muestreo: null },
    { id: 'P-302', posicionId: 'Z1-B2-A2', estado: 'EN_PROCESO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: conteoVacio(), clasificadoPor: null, jornadaId: null, muestreo: null },
    { id: 'P-303', posicionId: 'Z1-B2-A3', estado: 'EN_PROCESO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: conteoVacio(), clasificadoPor: null, jornadaId: null, muestreo: null },

    // — Bahía Z2-B1 (jornada J-03 de Bruner): 8 pallets.
    //   Tanda AS-02: P-201 en ALERTA (0.60%) → decisión del Admin pendiente;
    //   P-202/P-203 muestreados sin alerta (quedaron EN_MUESTREO esperando la
    //   decisión del lote). P-204/P-205 ya LISTO (tanda previa OK).
    //   Pool para nuevas tandas: P-206, P-207, P-208 (P-208 parcial de 10, litro).
    { id: 'P-201', posicionId: 'Z2-B1-A1', estado: 'EN_MUESTREO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(3, 1, 1, 0, 1, 0), clasificadoPor: 'T2', jornadaId: 'J-03',
      muestreo: { botellas: 6, pct: 0.5952, alerta: true, muestreadorId: 'T4', asignacionId: 'AS-02', decision: null, ts: haceMin(90) } },
    { id: 'P-202', posicionId: 'Z2-B1-A2', estado: 'EN_MUESTREO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(2, 0, 1, 0, 1, 0), clasificadoPor: 'T2', jornadaId: 'J-03',
      muestreo: { botellas: 2, pct: 0.1984, alerta: false, muestreadorId: 'T4', asignacionId: 'AS-02', decision: null, ts: haceMin(88) } },
    { id: 'P-203', posicionId: 'Z2-B1-A3', estado: 'EN_MUESTREO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(1, 0, 0, 0, 1, 0), clasificadoPor: 'T2', jornadaId: 'J-03',
      muestreo: { botellas: 0, pct: 0, alerta: false, muestreadorId: 'T4', asignacionId: 'AS-02', decision: null, ts: haceMin(86) } },
    { id: 'P-204', posicionId: 'Z2-B1-A4', estado: 'LISTO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(2, 1, 0, 1, 1, 0), clasificadoPor: 'T2', jornadaId: 'J-03', muestreo: null },
    { id: 'P-205', posicionId: 'Z2-B1-A5', estado: 'LISTO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(2, 0, 1, 0, 0, 1), clasificadoPor: 'T2', jornadaId: 'J-03', muestreo: null },
    { id: 'P-206', posicionId: 'Z2-B1-B1', estado: 'CLASIFICADO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(1, 1, 1, 0, 0, 0), clasificadoPor: 'T2', jornadaId: 'J-03', muestreo: null },
    { id: 'P-207', posicionId: 'Z2-B1-B2', estado: 'CLASIFICADO', cajasTotales: 84, tipoCaja: 'cerveza',
      conteo: mkConteo(1, 0, 1, 1, 1, 0), clasificadoPor: 'T2', jornadaId: 'J-03', muestreo: null },
    { id: 'P-208', posicionId: 'Z2-B1-B3', estado: 'CLASIFICADO', cajasTotales: 10, tipoCaja: 'litro',
      conteo: mkConteo(1, 0, 0, 0, 0, 0), clasificadoPor: 'T2', jornadaId: 'J-03', muestreo: null },
  ];
  pallets.forEach(p => { posPorId[p.posicionId].palletId = p.id; });

  /* Jornadas = día laboral fichado, con pausas (segmentos activos).
   * J-03 (Bruner) tiene DOS segmentos con una pausa corta: 100 min activos
   * con los que mantiene ~359 cajas/h de productividad de semilla. */
  const jornadas = [
    { id: 'J-01', trabajadorId: 'T1', fechaLabel: 'Ayer (13/09)',
      segmentos: [{ inicioTs: haceMin(1575), finTs: haceMin(1055) }], enPausa: false, terminada: true },
    { id: 'J-02', trabajadorId: 'T1', fechaLabel: 'Hoy',
      segmentos: [{ inicioTs: haceMin(155), finTs: null }], enPausa: false, terminada: false },
    { id: 'J-03', trabajadorId: 'T2', fechaLabel: 'Hoy',
      segmentos: [{ inicioTs: haceMin(235), finTs: haceMin(190) }, { inicioTs: haceMin(180), finTs: haceMin(125) }],
      enPausa: false, terminada: true },
    { id: 'J-04', trabajadorId: 'T3', fechaLabel: 'Hoy',
      segmentos: [{ inicioTs: haceMin(128), finTs: null }], enPausa: false, terminada: false },
  ];

  /* Asignaciones de muestreo: siempre 2–3 pallets del MISMO clasificador
   * (supuesto Q2.1); el sistema elige los pallets al azar (Q2.2). */
  const asignaciones = [
    { id: 'AS-01', muestreadorId: 'T5', clasificadorId: 'T1', cantidad: 2,
      palletIds: ['P-101', 'P-102'], loteIds: ['P-101', 'P-102'],
      estado: 'COMPLETADA', creadaTs: haceMin(1560) },
    { id: 'AS-02', muestreadorId: 'T4', clasificadorId: 'T2', cantidad: 3,
      palletIds: ['P-201', 'P-202', 'P-203'], loteIds: ['P-201', 'P-202', 'P-203'],
      estado: 'EN_PROCESO', creadaTs: haceMin(95) },
  ];

  return {
    vista: 'admin',
    sesion: { trabajadorId: null, conductorId: null },
    zonas: zonas,
    bahias: bahias,
    posiciones: posiciones,
    trabajadores: trabajadores,
    conductores: conductores,
    pallets: pallets,
    jornadas: jornadas,
    asignaciones: asignaciones,
  };
}
