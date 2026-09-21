/* =========================================================================
 * Sorty — Estado y reglas de negocio (demo sin backend)
 *
 * Estado global STATE (en memoria). TODA mutación del dominio pasa por las
 * funciones de este archivo y termina llamando a render() (definida en
 * app.js). Sin import/export: funciones globales para protocolo file://.
 * ========================================================================= */

let STATE = null;

function clonarSemilla() {
  return JSON.parse(JSON.stringify(crearSemilla()));
}

/* Reinicio de la demo */
function reiniciarDemo() {
  if (!confirm('¿Reiniciar la demo? Se perderán los cambios hechos sobre los datos de prueba.')) return;
  STATE = clonarSemilla();
  resetUI();
  render();
}

function cambiarVista(vista) {
  STATE.vista = vista;
  render();
}

/* ------------------------- Búsquedas básicas ------------------------- */

function getTrabajador(id) {
  return STATE.trabajadores.filter(t => t.id === id)[0] || null;
}
function getConductor(id) {
  return STATE.conductores.filter(c => c.id === id)[0] || null;
}
function conductoresActivos() {
  return STATE.conductores.filter(c => c.activo);
}
function getBahia(id) {
  return STATE.bahias.filter(b => b.id === id)[0] || null;
}
function getPosicion(id) {
  return STATE.posiciones.filter(p => p.id === id)[0] || null;
}
function getPallet(id) {
  return STATE.pallets.filter(p => p.id === id)[0] || null;
}
function getJornada(id) {
  return STATE.jornadas.filter(j => j.id === id)[0] || null;
}
function getAsignacion(id) {
  return STATE.asignaciones.filter(a => a.id === id)[0] || null;
}
function posicionesDeBahia(bahiaId) {
  return STATE.posiciones.filter(p => p.bahiaId === bahiaId);
}
function bahiasDeZona(zonaId) {
  return STATE.bahias.filter(b => b.zonaId === zonaId);
}
function trabajadoresActivos() {
  return STATE.trabajadores.filter(t => t.activo);
}
/* Jornada = día laboral fichado, CON PAUSAS (PROYECTO.md §5): se compone de
 * segmentos activos [{inicioTs, finTs|null}]. Pausar cierra el segmento abierto;
 * reanudar abre otro; terminar cierra y marca terminada (reanudable el mismo
 * día). El tiempo activo solo cuenta segmentos (minutosActivos). */
function jornadaDelDiaDe(trabajadorId) {
  return STATE.jornadas.filter(j => j.trabajadorId === trabajadorId && j.fechaLabel === 'Hoy')[0] || null;
}
function jornadaEnCursoDe(trabajadorId) {
  const j = jornadaDelDiaDe(trabajadorId);
  return (j && !j.enPausa && !j.terminada) ? j : null;
}
function minutosActivos(jornada) {
  return jornada.segmentos.reduce((s, seg) =>
    s + ((seg.finTs === null ? Date.now() : seg.finTs) - seg.inicioTs) / 60000, 0);
}
function inicioJornada(jornada) { return jornada.segmentos[0].inicioTs; }
function finJornada(jornada) {
  for (let i = jornada.segmentos.length - 1; i >= 0; i--) {
    if (jornada.segmentos[i].finTs !== null) return jornada.segmentos[i].finTs;
  }
  return null;
}
function nombreTrabajador(id) {
  const t = getTrabajador(id);
  return t ? t.nombre : '—';
}

/* ------------------------- Fórmulas y selectores de negocio ------------------------- */

/* Fórmula confirmada (PROYECTO.md §7), por pallet individual:
 * MBFU% = botellas_MBFU_encontradas / botellas_revisadas × 100
 * donde botellas_revisadas = cajasTotales del pallet × botellas de SU tipo de
 * caja (catálogo TIPOS_CAJA). Completo cerveza/litro = 1,008; el parcial de
 * 10 cajas = 120. El sistema usa el total y el tipo que confirmó el clasificador. */
function tipoCajaDe(pallet) {
  const id = pallet.tipoCaja || TIPOS_CAJA[0].id;
  return TIPOS_CAJA.filter(t => t.id === id)[0] || TIPOS_CAJA[0];
}
function botellasRevisadas(pallet) {
  return pallet.cajasTotales * tipoCajaDe(pallet).botellas;
}
function pctMBFU(botellasMBFU, revisadas) {
  return botellasMBFU / revisadas * 100;
}
function hayAlertaMBFU(botellasMBFU, revisadas) {
  return pctMBFU(botellasMBFU, revisadas) >= REGLAS.UMBRAL_MBFU; // ≥ umbral → alerta, NO rechazo
}

/* Sanas por descarte (PROYECTO.md §6): no se cuentan; se calculan en
 * BOTELLAS = total de botellas del pallet (cajasTotales × botellas del tipo)
 * − defectos registrados (clamp a 0). */
function botellasSanas(pallet) {
  const defectos = CATEGORIAS.reduce((s, c) => s + (pallet.conteo[c.id] || 0), 0);
  return Math.max(0, botellasRevisadas(pallet) - defectos);
}

/* Avance de bahía: X de N. N = posiciones activas; X = pallets ya clasificados
 * o con recorrido posterior (CLASIFICADO / EN_MUESTREO / LISTO). Los
 * DESPACHADO ya liberaron su posición, así que no cuentan (físicamente no están). */
function avanceBahia(bahia) {
  const pos = posicionesDeBahia(bahia.id).filter(p => p.activa);
  const n = pos.length;
  const x = pos.filter(p => p.palletId && getPallet(p.palletId).estado !== 'EN_PROCESO').length;
  return { x: x, n: n };
}

function estadoBahia(bahia) {
  const av = avanceBahia(bahia);
  if (av.n === 0) return 'SIN_CONFIG';
  if (av.x >= av.n) return 'COMPLETADA';
  const tienePallets = posicionesDeBahia(bahia.id).some(p => p.palletId);
  if (av.x > 0 || tienePallets) return 'EN_PROCESO';
  return 'PENDIENTE';
}

/* Capacidad vs ocupadas por zona (formato del BI, §9 y QA.txt) */
function capacidadZona(zonaId) {
  return STATE.posiciones.filter(p => {
    const b = getBahia(p.bahiaId);
    return b && b.zonaId === zonaId && p.activa;
  }).length;
}
function ocupadasZona(zonaId) {
  return STATE.posiciones.filter(p => {
    const b = getBahia(p.bahiaId);
    return b && b.zonaId === zonaId && p.activa && p.palletId;
  }).length;
}
/* Bahías con al menos un pallet (para el listado "OCUPADAS → BAHÍAS ...") */
function bahiasOcupadasZona(zonaId) {
  return bahiasDeZona(zonaId).filter(b =>
    posicionesDeBahia(b.id).some(p => p.palletId)
  );
}

/* Productividad por clasificador: cajas/hora de las jornadas de hoy
 * (activas o cerradas) vs meta de 265. */
function productividadClasificadores() {
  const agg = {};
  STATE.jornadas.forEach(j => {
    if (j.fechaLabel !== 'Hoy') return;
    // cajas/hora sobre TIEMPO ACTIVO (segmentos), no sobre el reloj de pared:
    // las pausas (comida) no diluyen la productividad.
    const horas = minutosActivos(j) / 60;
    const cajas = STATE.pallets
      .filter(p => p.jornadaId === j.id && p.estado !== 'EN_PROCESO')
      .reduce((s, p) => s + p.cajasTotales, 0);
    if (!agg[j.trabajadorId]) agg[j.trabajadorId] = { cajas: 0, horas: 0 };
    agg[j.trabajadorId].cajas += cajas;
    agg[j.trabajadorId].horas += horas;
  });
  const lista = [];
  Object.keys(agg).forEach(tid => {
    const horas = Math.max(agg[tid].horas, 1 / 60); // evita división por cero al fichar
    lista.push({
      trabajadorId: tid,
      nombre: nombreTrabajador(tid),
      cajas: agg[tid].cajas,
      horas: horas,
      cajasHora: agg[tid].cajas / horas,
    });
  });
  lista.sort((a, b) => b.cajasHora - a.cajasHora);
  return lista;
}

/* Pallets de un clasificador disponibles para muestreo (estado CLASIFICADO) */
function palletsClasificadosDe(trabajadorId) {
  return STATE.pallets.filter(p => p.estado === 'CLASIFICADO' && p.clasificadoPor === trabajadorId);
}

/* Pallets con muestreo sobre el umbral, pendientes de decisión del Admin */
function alertasPendientes() {
  return STATE.pallets.filter(p =>
    p.estado === 'EN_MUESTREO' && p.muestreo && p.muestreo.alerta && !p.muestreo.decision
  );
}

/* Asignaciones visibles para un muestreador (las canceladas se ocultan) */
function asignacionesDeMuestreador(trabajadorId) {
  return STATE.asignaciones.filter(a => a.muestreadorId === trabajadorId && a.estado !== 'CANCELADA');
}

function siguienteId(prefijo, lista) {
  let max = 0;
  lista.forEach(item => {
    const num = parseInt(String(item.id).replace(prefijo + '-', ''), 10);
    if (!isNaN(num) && num > max) max = num;
  });
  return prefijo + '-' + (max + 101);
}

/* ------------------------- Mutaciones ------------------------- */

/* Sesión del trabajador (login mock, sin contraseña) */
function loginTrabajador(id) {
  const t = getTrabajador(id);
  if (!t || !t.activo) return;
  STATE.sesion.trabajadorId = id;
  render();
}
function logoutTrabajador() {
  STATE.sesion.trabajadorId = null;
  render();
}

/* Sesión del conductor (montacargas): tercer actor, usuario propio */
function loginConductor(id) {
  const c = getConductor(id);
  if (!c || !c.activo) return;
  STATE.sesion.conductorId = id;
  render();
}
function logoutConductor() {
  STATE.sesion.conductorId = null;
  render();
}

/* Jornada = día laboral fichado, con pausas (PROYECTO.md §5, Q3.1): el
 * trabajador inicia al llegar, pausa (p. ej. a comer) y reanuda para completar
 * horas; termina al irse. Todo lo clasificado en el día queda en ESTA jornada. */
function iniciarJornada() {
  const tid = STATE.sesion.trabajadorId;
  if (!tid || jornadaDelDiaDe(tid)) return; // ya existe: la tarjeta ofrece Reanudar
  STATE.jornadas.push({
    id: siguienteId('J', STATE.jornadas),
    trabajadorId: tid,
    fechaLabel: 'Hoy',
    segmentos: [{ inicioTs: Date.now(), finTs: null }],
    enPausa: false,
    terminada: false,
  });
  render();
}

function pausarJornada(trabajadorId) {
  const j = jornadaDelDiaDe(trabajadorId);
  if (!j) return { error: 'No tienes jornada iniciada.' };
  if (j.terminada) return { error: 'La jornada está terminada. Reanuda para seguir.' };
  if (j.enPausa) return { error: 'La jornada ya está en pausa.' };
  const abierto = j.segmentos.filter(s => s.finTs === null)[0];
  if (!abierto) return { error: 'No hay segmento abierto.' };
  abierto.finTs = Date.now();
  j.enPausa = true;
  render();
  return { ok: true };
}

function reanudarJornada(trabajadorId) {
  const j = jornadaDelDiaDe(trabajadorId);
  if (!j) return { error: 'No tienes jornada iniciada.' };
  if (!j.enPausa && !j.terminada) return { error: 'La jornada ya está en curso.' };
  j.segmentos.push({ inicioTs: Date.now(), finTs: null });
  j.enPausa = false;
  j.terminada = false;
  render();
  return { ok: true };
}

function terminarJornada(trabajadorId) {
  const j = jornadaDelDiaDe(trabajadorId);
  if (!j) return { error: 'No tienes jornada iniciada.' };
  if (j.terminada) return { error: 'La jornada ya está terminada.' };
  const abierto = j.segmentos.filter(s => s.finTs === null)[0];
  if (abierto) abierto.finTs = Date.now();
  j.enPausa = false;
  j.terminada = true;
  render();
  return { ok: true };
}

/* Modelo self-service: las bahías no se asignan. El clasificador toma pallets
 * libres desde su app (PROYECTO.md §3, §5). */

/* Pallet que el trabajador tiene tomado (EN_PROCESO a su nombre) */
function palletTomadoPor(trabajadorId) {
  return STATE.pallets.filter(p =>
    p.estado === 'EN_PROCESO' && p.clasificadoPor === trabajadorId)[0] || null;
}

/* Estado derivado de una posición para el mapa del trabajador (lectura pura):
 * DISPONIBLE (activa y vacía) · PARCIAL (EN_PROCESO liberado, retomable) ·
 * PROPIA (EN_PROCESO tomada por el trabajador) · OTRO (EN_PROCESO tomada por
 * otro, no tappable) · CLASIFICADA (ya clasificada o posterior) · INACTIVA. */
function estadoPosicionPara(trabajadorId, posicion) {
  if (!posicion.activa) return 'INACTIVA';
  const p = posicion.palletId ? getPallet(posicion.palletId) : null;
  if (!p) return 'DISPONIBLE';
  if (p.estado === 'EN_PROCESO') {
    if (p.clasificadoPor === trabajadorId) return 'PROPIA';
    if (!p.clasificadoPor) return 'PARCIAL';
    return 'OTRO';
  }
  return 'CLASIFICADA';
}

/* Tomar un pallet: requiere jornada EN CURSO (no pausada ni terminada),
 * posición activa, y que el trabajador no tenga otro pallet tomado. Si la
 * posición tiene un pallet EN_PROCESO liberado, lo retoma conservando su avance. */
function tomarPallet(trabajadorId, posicionId) {
  const t = getTrabajador(trabajadorId);
  if (!t || !t.activo) return { error: 'Trabajador no válido.' };
  const jornada = jornadaEnCursoDe(trabajadorId);
  if (!jornada) {
    const hoy = jornadaDelDiaDe(trabajadorId);
    if (hoy && hoy.enPausa) return { error: 'Estás en pausa — reanuda para tomar pallets.' };
    if (hoy && hoy.terminada) return { error: 'Jornada terminada — reanuda para seguir.' };
    return { error: 'Inicia tu jornada para tomar pallets.' };
  }
  if (palletTomadoPor(trabajadorId)) {
    return { error: 'Ya tienes un pallet en curso. Finalízalo o suéltalo para tomar otro.' };
  }
  const pos = getPosicion(posicionId);
  if (!pos || !pos.activa) return { error: 'La posición no está activa.' };
  let pallet = pos.palletId ? getPallet(pos.palletId) : null;
  if (pallet && pallet.estado !== 'EN_PROCESO') {
    return { error: 'Esa posición ya tiene un pallet clasificado.' };
  }
  if (!pallet) {
    pallet = {
      id: siguienteId('P', STATE.pallets),
      posicionId: posicionId,
      estado: 'EN_PROCESO',
      cajasTotales: REGLAS.CAJAS_POR_PALLET, // completo por defecto; se ajusta con valores rápidos
      tipoCaja: TIPOS_CAJA[0].id,            // 'cerveza'; se confirma al clasificar
      conteo: conteoVacio(),
      clasificadoPor: null,
      jornadaId: null,
      muestreo: null,
    };
    STATE.pallets.push(pallet);
    pos.palletId = pallet.id;
  }
  pallet.clasificadoPor = trabajadorId;
  pallet.jornadaId = jornada.id;
  render();
  return { ok: true, pallet: pallet };
}

/* Definir el tipo de caja del pallet (catálogo TIPOS_CAJA). Solo el dueño,
 * en curso, con un tipo existente. */
function definirTipoCaja(trabajadorId, palletId, tipoId) {
  const p = getPallet(palletId);
  if (!p || p.estado !== 'EN_PROCESO' || p.clasificadoPor !== trabajadorId) {
    return { error: 'Solo el dueño puede cambiar el tipo de un pallet en curso.' };
  }
  if (!TIPOS_CAJA.some(t => t.id === tipoId)) {
    return { error: 'Tipo de caja no válido.' };
  }
  p.tipoCaja = tipoId;
  render();
  return { ok: true };
}

/* Definir el total de cajas del pallet (lo confirma el clasificador con
 * valores rápidos: 84 completo, 64, 48, otro). Solo el dueño, en curso,
 * entre 1 y MAX_CAJAS_PALLET. Editable hasta terminar el pallet. */
function definirTotalCajas(trabajadorId, palletId, n) {
  const p = getPallet(palletId);
  if (!p || p.estado !== 'EN_PROCESO' || p.clasificadoPor !== trabajadorId) {
    return { error: 'Solo el dueño puede definir el total de un pallet en curso.' };
  }
  n = parseInt(n, 10);
  if (isNaN(n) || n < 1 || n > REGLAS.MAX_CAJAS_PALLET) {
    return { error: 'El total debe ser un número entre 1 y ' + REGLAS.MAX_CAJAS_PALLET + ' cajas.' };
  }
  p.cajasTotales = n;
  render();
  return { ok: true };
}

/* Soltar el pallet tomado: queda EN_PROCESO liberado (cualquiera puede
 * retomarlo) conservando el avance: total confirmado y conteos registrados. */
function soltarPallet(trabajadorId, palletId) {
  const p = getPallet(palletId);
  if (!p || p.estado !== 'EN_PROCESO' || p.clasificadoPor !== trabajadorId) {
    return { error: 'No tienes ese pallet en curso.' };
  }
  p.clasificadoPor = null;
  p.jornadaId = null;
  render();
  return { ok: true };
}

/* Activar / desactivar posición desde el mapa. No se permite apagar una
 * posición ocupada: primero debe clasificarse/liberarse el pallet. */
function togglePosicion(posicionId) {
  const pos = getPosicion(posicionId);
  if (!pos) return;
  if (pos.activa && pos.palletId) {
    alert('La posición ' + pos.codigo + ' tiene un pallet. Clasifícalo o reclasifícalo antes de desactivarla.');
    return;
  }
  pos.activa = !pos.activa;
  render();
}

/* Guardar hallazgos sin terminar (el pallet sigue EN_PROCESO) */
function guardarConteoParcial(palletId, conteo) {
  const p = getPallet(palletId);
  if (!p) return;
  p.conteo = conteo;
  render();
}

/* Terminar pallet: pasa a CLASIFICADO con el cajasTotales ya confirmado y
 * queda ligado al trabajador y a su jornada EN CURSO (la activa al tomarlo). */
function finalizarPallet(palletId, conteo) {
  const p = getPallet(palletId);
  const tid = STATE.sesion.trabajadorId;
  const jornada = tid ? jornadaEnCursoDe(tid) : null;
  if (!p || !tid || !jornada) return;
  p.conteo = conteo;
  p.estado = 'CLASIFICADO';
  p.clasificadoPor = tid;
  p.jornadaId = jornada.id;
  p.muestreo = null;
  render();
}

/* Crear asignación de muestreo: 2–3 pallets (la tanda) de un mismo
 * clasificador (Q2.1), elegidos desde el LOTE congelado de la asignación.
 * LOTE CONGELADO (PROYECTO.md §5/§7): al asignar, el sistema propone como
 * alcance todo lo clasificado-pendiente del clasificador (su jornada); el
 * Admin puede quitar pallets del alcance. Queda como snapshot de ids
 * (asignacion.loteIds): certificar y re-clasificar aplican a ESE conjunto;
 * lo clasificado DESPUÉS de la asignación no entra (espera otra tanda). */
function crearAsignacionMuestreo(muestreadorId, clasificadorId, cantidad, loteIds) {
  if (!getTrabajador(muestreadorId) || !getTrabajador(clasificadorId)) {
    return { error: 'Elige muestreador y clasificador.' };
  }
  cantidad = parseInt(cantidad, 10);
  if (isNaN(cantidad) || cantidad < REGLAS.MIN_PALLETS_MUESTREO || cantidad > REGLAS.MAX_PALLETS_MUESTREO) {
    return { error: 'La cantidad debe ser 2 o 3 (nunca fuera de ese rango).' };
  }
  // Alcance: el propuesto por el Admin, o por defecto todo lo CLASIFICADO del
  // clasificador en este momento. Solo cuentan ids válidos (suyos, clasificados).
  if (!loteIds || !loteIds.length) {
    loteIds = palletsClasificadosDe(clasificadorId).map(p => p.id);
  }
  const lote = loteIds.filter(pid => {
    const p = getPallet(pid);
    return p && p.clasificadoPor === clasificadorId && p.estado === 'CLASIFICADO';
  });
  if (lote.length < cantidad) {
    return { error: 'El alcance del lote tiene ' + lote.length +
      ' pallet(s) clasificado(s); se necesitan al menos ' + cantidad + '.' };
  }
  // La tanda (2–3) se elige AL AZAR desde el lote congelado
  const mezcla = lote.slice();
  for (let i = mezcla.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    const tmp = mezcla[i]; mezcla[i] = mezcla[k]; mezcla[k] = tmp;
  }
  const asignacion = {
    id: siguienteId('AS', STATE.asignaciones),
    muestreadorId: muestreadorId,
    clasificadorId: clasificadorId,
    cantidad: cantidad,
    palletIds: mezcla.slice(0, cantidad), // la tanda
    loteIds: lote.slice(),                 // snapshot congelado del alcance
    estado: 'PENDIENTE',
    creadaTs: Date.now(),
  };
  STATE.asignaciones.push(asignacion);
  render();
  return { ok: true, asignacion: asignacion };
}

/* Recalcular el estado de una asignación según el resultado de sus pallets */
function recalcAsignacion(asg) {
  const ps = asg.palletIds.map(getPallet).filter(Boolean);
  if (!ps.length) { asg.estado = 'CANCELADA'; return; }
  /* "Re-clasificado" = pallet que tuvo muestreo y volvió a EN_PROCESO
   * (decisión del Admin de re-clasificar el lote) */
  const reclasificados = ps.filter(p => p.estado === 'EN_PROCESO' && p.muestreo).length;
  const listos = ps.filter(p => p.estado === 'LISTO' || p.estado === 'DESPACHADO').length;
  if (reclasificados === ps.length) asg.estado = 'CANCELADA';
  else if (listos + reclasificados === ps.length) asg.estado = 'COMPLETADA';
  else if (ps.some(p => p.muestreo)) asg.estado = 'EN_PROCESO';
  else asg.estado = 'PENDIENTE';
}
function recalcTodasAsignaciones() {
  STATE.asignaciones.forEach(recalcAsignacion);
}

/* CERTIFICACIÓN POR LOTE (PROYECTO.md §7): el muestreo certifica el trabajo,
 * no pallet por pallet. Al completarse la tanda SIN alertas, todo el LOTE
 * CONGELADO de la asignación (aún en almacén: CLASIFICADO / EN_MUESTREO)
 * pasa a LISTO de una vez. Los DESPACHADO no aparecen pre-certificación, pero
 * se filtran por robustez. */
function certificarLote(asignacionId) {
  const asg = getAsignacion(asignacionId);
  if (!asg || !asg.loteIds) return 0;
  let n = 0;
  asg.loteIds.forEach(pid => {
    const p = getPallet(pid);
    if (p && (p.estado === 'CLASIFICADO' || p.estado === 'EN_MUESTREO')) {
      p.estado = 'LISTO';
      n++;
    }
  });
  return n;
}

/* Registrar resultado de muestreo de un pallet de la tanda:
 * CLASIFICADO → EN_MUESTREO con su MBFU%. Si la tanda se completa y NINGÚN
 * pallet supera el umbral → se certifica el LOTE congelado de la asignación;
 * si alguno ≥ 0.40% queda EN ALERTA a la espera de la decisión del Admin. */
function registrarMuestreo(palletId, botellasMBFU, asignacionId) {
  const p = getPallet(palletId);
  if (!p || p.estado !== 'CLASIFICADO') return { error: 'El pallet no está disponible para muestreo.' };
  const revisadas = botellasRevisadas(p); // = cajasTotales × botellas del tipo
  botellasMBFU = parseInt(botellasMBFU, 10);
  if (isNaN(botellasMBFU) || botellasMBFU < 0 || botellasMBFU > revisadas) {
    return { error: 'Ingresa un entero entre 0 y ' + revisadas + ' (botellas revisadas del pallet).' };
  }
  const alerta = hayAlertaMBFU(botellasMBFU, revisadas);
  p.estado = 'EN_MUESTREO';
  p.muestreo = {
    botellas: botellasMBFU,
    pct: pctMBFU(botellasMBFU, revisadas),
    revisadas: revisadas,
    alerta: alerta,
    muestreadorId: STATE.sesion.trabajadorId,
    asignacionId: asignacionId || null,
    decision: null,
    ts: Date.now(),
  };
  const asg = asignacionId ? getAsignacion(asignacionId) : null;
  if (asg) {
    const ps = asg.palletIds.map(getPallet).filter(Boolean);
    const tandaCompleta = ps.length > 0 && ps.every(q => q.muestreo);
    if (tandaCompleta && !ps.some(q => q.muestreo.alerta)) {
      asg.estado = 'COMPLETADA';
      certificarLote(asg.id); // tanda limpia → certifica el LOTE congelado
    } else {
      recalcAsignacion(asg);
    }
  }
  render();
  return { ok: true, alerta: alerta };
}

/* Decisión del Admin con tanda en alerta — "Dejar pasar": certifica el LOTE
 * congelado de la asignación: todos sus pallets aún en almacén (CLASIFICADO +
 * EN_MUESTREO, incluidos los de la tanda en alerta) pasan a LISTO. */
function dejarPasarLote(asignacionId) {
  const asg = getAsignacion(asignacionId);
  if (!asg || !asg.loteIds) return 0;
  let n = 0;
  asg.loteIds.forEach(pid => {
    const p = getPallet(pid);
    if (p && (p.estado === 'CLASIFICADO' || p.estado === 'EN_MUESTREO')) {
      p.estado = 'LISTO';
      if (p.muestreo && p.muestreo.alerta) {
        p.muestreo.decision = 'DEJADO_PASAR';
        p.muestreo.decisionTs = Date.now();
      }
      n++;
    }
  });
  recalcTodasAsignaciones();
  render();
  return n;
}

/* Decisión del Admin — "Re-clasificar lote": TODO el lote congelado de la
 * asignación vuelve a clasificación: sus pallets CLASIFICADO + EN_MUESTREO +
 * LISTO aún no despachados pasan a EN_PROCESO y quedan LIBERADOS (sin tomador,
 * conservando sus conteos como avance). Los DESPACHADO no se tocan. */
function reclasificarLote(asignacionId) {
  const asg = getAsignacion(asignacionId);
  if (!asg || !asg.loteIds) return 0;
  let n = 0;
  asg.loteIds.forEach(pid => {
    const p = getPallet(pid);
    if (p && (p.estado === 'CLASIFICADO' || p.estado === 'EN_MUESTREO' || p.estado === 'LISTO')) {
      p.estado = 'EN_PROCESO';
      p.clasificadoPor = null; // liberado: cualquiera puede retomarlo
      p.jornadaId = null;
      if (p.muestreo) {
        p.muestreo.decision = 'RECLASIFICADA_LOTE';
        p.muestreo.decisionTs = Date.now();
      }
      n++;
    }
  });
  recalcTodasAsignaciones();
  render();
  return n;
}

/* DESPACHO (Conductor/montacargas): solo desde LISTO. Marca DESPACHADO con
 * conductor y hora, y libera la posición AL INSTANTE (ya no hay pallet ahí:
 * el registro vive en historiales/reportes, no en el mapa). */
function despacharPallet(conductorId, palletId) {
  const res = despacharPallets(conductorId, [palletId]);
  if (res.error) return res;
  return { ok: true };
}

/* Despacho en LOTE (selección múltiple): valida TODOS antes de tocar nada —
 * si alguno ya no está LISTO, aborta completo indicando cuál. */
function despacharPallets(conductorId, palletIds) {
  const c = getConductor(conductorId);
  if (!c || !c.activo) return { error: 'Conductor no válido.' };
  if (!palletIds || !palletIds.length) return { error: 'Selecciona al menos un pallet.' };
  for (let i = 0; i < palletIds.length; i++) {
    const p = getPallet(palletIds[i]);
    if (!p) return { error: 'Pallet ' + palletIds[i] + ' no encontrado. Se aborta el cargue.' };
    if (p.estado !== 'LISTO') {
      return { error: palletIds[i] + ' ya no está LISTO (estado: ' + p.estado + '). Se aborta todo el cargue.' };
    }
  }
  const ahora = Date.now();
  palletIds.forEach(pid => {
    const p = getPallet(pid);
    p.estado = 'DESPACHADO';
    p.despachadoPor = conductorId;
    p.despachadoTs = ahora;
    const pos = getPosicion(p.posicionId);
    if (pos) pos.palletId = null; // posición libre al instante
  });
  render();
  return { ok: true, cantidad: palletIds.length };
}

/* ------------------------- Selectores de despacho ------------------------- */

/* Pallets LISTO para despacho, ordenados por zona → bahía → posición */
function palletsListos() {
  return STATE.pallets
    .filter(p => p.estado === 'LISTO')
    .sort((a, b) => a.posicionId < b.posicionId ? -1 : 1);
}
/* Historial de cargues de un conductor (más recientes primero) */
function carguesDe(conductorId) {
  return STATE.pallets
    .filter(p => p.estado === 'DESPACHADO' && p.despachadoPor === conductorId)
    .sort((a, b) => b.despachadoTs - a.despachadoTs);
}
/* Contadores del BI: listos para despacho y despachados hoy */
function contadoresDespacho() {
  const hoy = new Date().toDateString();
  return {
    listos: STATE.pallets.filter(p => p.estado === 'LISTO').length,
    despachadosHoy: STATE.pallets.filter(p =>
      p.estado === 'DESPACHADO' && p.despachadoTs && new Date(p.despachadoTs).toDateString() === hoy).length
  };
}

/* (La re-clasificación por jornada fue reemplazada por la decisión de LOTE:
 * reclasificarLote(clasificadorId) — ver más arriba.) */

/* ------------------------- Gestión de trabajadores ------------------------- */

function crearTrabajador(nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) return { error: 'Ingresa un nombre.' };
  if (STATE.trabajadores.some(t => t.nombre.toLowerCase() === nombre.toLowerCase())) {
    return { error: 'Ya existe un trabajador con ese nombre.' };
  }
  STATE.trabajadores.push({ id: siguienteId('T', STATE.trabajadores), nombre: nombre, activo: true });
  render();
  return { ok: true };
}
function renombrarTrabajador(id, nombre) {
  const t = getTrabajador(id);
  nombre = String(nombre || '').trim();
  if (!t || !nombre) return { error: 'Nombre inválido.' };
  t.nombre = nombre;
  render();
  return { ok: true };
}
function toggleActivoTrabajador(id) {
  const t = getTrabajador(id);
  if (!t) return;
  t.activo = !t.activo;
  if (!t.activo && STATE.sesion.trabajadorId === id) STATE.sesion.trabajadorId = null;
  render();
}
