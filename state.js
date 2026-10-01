/* =========================================================================
 * Calibra — Estado y reglas de negocio (demo sin backend)
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
function getOperador(id) {
  return STATE.operadores.filter(o => o.id === id)[0] || null;
}
function operadoresActivos() {
  return STATE.operadores.filter(o => o.activo);
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

/* Botellas por caja INFERIDAS del total de cajas (PROYECTO.md §4/§5). El total
 * lo define el ADMIN al abastecer: 84 → caja 12 completo; 80 → caja 24 completo;
 * ≤ 80 → caja 24 (puchito 79/78/…); > 80 → caja 12 (84 o puchito 83/82/81). */
function inferirBotellasPorCaja(cajasTotales) {
  return cajasTotales <= REGLAS.CAJAS_PALLET_CAJA24 ? REGLAS.BOTELLAS_CAJA_24 : REGLAS.BOTELLAS_CAJA_12;
}
/* Cajas de un pallet completo según su tipo de caja (PROYECTO.md §4). */
function completoCajasDe(tipo) {
  return tipo === 12 ? REGLAS.CAJAS_PALLET_CAJA12 : REGLAS.CAJAS_PALLET_CAJA24;
}
/* Resuelve el tipo de caja declarado (12/24) o lo deriva de 84/80; valida que
 * el total no supere el pallet completo del tipo. Devuelve { tipo } o { error }. */
function resolverTipoCaja(total, tipoCaja) {
  if (!(total >= 1)) {
    return { error: 'El total de cajas debe ser al menos 1.' };
  }
  let tipo = parseInt(tipoCaja, 10);
  if (tipo !== 12 && tipo !== 24) {
    if (total === REGLAS.CAJAS_PALLET_CAJA12) tipo = 12;
    else if (total === REGLAS.CAJAS_PALLET_CAJA24) tipo = 24;
    else return { error: 'Declara el tipo de caja (12 o 24) para un puchito.' };
  }
  if (total > completoCajasDe(tipo)) {
    return { error: 'Un pallet de caja ' + tipo + ' no puede tener más de ' + completoCajasDe(tipo) + ' cajas.' };
  }
  return { tipo: tipo };
}
/* Botellas totales del pallet según su tipo declarado (o inferido si falta).
 * Informativo para el descarte — el muestreo usa su propio denominador. */
function botellasRevisadas(pallet) {
  const tipo = (pallet.tipoCaja === 12 || pallet.tipoCaja === 24)
    ? pallet.tipoCaja : inferirBotellasPorCaja(pallet.cajasTotales);
  return pallet.cajasTotales * tipo;
}
function pctMBFU(botellasMBFU, revisadas) {
  return botellasMBFU / revisadas * 100;
}
function hayAlertaMBFU(botellasMBFU, revisadas) {
  return pctMBFU(botellasMBFU, revisadas) >= REGLAS.UMBRAL_MBFU; // ≥ umbral → alerta, NO rechazo
}

/* Sanas por descarte (PROYECTO.md §6): no se cuentan; se calculan en
 * BOTELLAS = total de botellas inferido del pallet − defectos (clamp a 0). */
function botellasSanas(pallet) {
  const defectos = CATEGORIAS.reduce((s, c) => s + (pallet.conteo[c.id] || 0), 0);
  return Math.max(0, botellasRevisadas(pallet) - defectos);
}

/* Avance de bahía: X de N. N = posiciones activas; X = pallets YA CLASIFICADOS
 * o con recorrido posterior (CLASIFICADO / EN_MUESTREO / LISTO). Los
 * DISPONIBLE (abastecidos sin tomar) y EN_PROCESO no cuentan como "hechos";
 * los DESPACHADO ya liberaron su posición (físicamente no están). */
function avanceBahia(bahia) {
  const pos = posicionesDeBahia(bahia.id).filter(p => p.activa);
  const n = pos.length;
  const x = pos.filter(p => {
    if (!p.palletId) return false;
    const est = getPallet(p.palletId).estado;
    return est === 'CLASIFICADO' || est === 'EN_MUESTREO' || est === 'LISTO';
  }).length;
  return { x: x, n: n };
}

function estadoBahia(bahia) {
  const av = avanceBahia(bahia);
  if (av.n === 0) return 'SIN_CONFIG';
  if (av.x >= av.n) return 'COMPLETADA';
  if (av.x > 0) return 'EN_PROCESO';
  return 'PENDIENTE'; // nada clasificado aún (aunque haya DISPONIBLES abastecidos)
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

/* Pallets clasificados HOY (todos los trabajadores): lo que ya dejó de estar
 * EN_PROCESO dentro de una jornada de hoy. Sirve para "Avance vs meta del día". */
function palletsClasificadosHoy() {
  const idsJornadasHoy = STATE.jornadas.filter(j => j.fechaLabel === 'Hoy').map(j => j.id);
  return STATE.pallets.filter(p =>
    idsJornadasHoy.indexOf(p.jornadaId) !== -1 &&
    p.estado !== 'EN_PROCESO' && p.estado !== 'DISPONIBLE'
  ).length;
}
/* Actividad por clasificador EN CONJUNTOS (PROYECTO.md §7/§12): la unidad de
 * medición del trabajo es el conjunto (tomado/completado) y sus pallets. */
function actividadPorClasificador() {
  const agg = {};
  STATE.pallets.forEach(p => {
    if (!p.clasificadoPor) return;
    if (!agg[p.clasificadoPor]) agg[p.clasificadoPor] = { conjuntos: {}, pallets: 0 };
    agg[p.clasificadoPor].pallets++;
    if (p.conjuntoId) agg[p.clasificadoPor].conjuntos[p.conjuntoId] = true;
  });
  const lista = [];
  Object.keys(agg).forEach(tid => {
    const cids = Object.keys(agg[tid].conjuntos);
    const completados = cids.filter(cid => {
      const ps = palletsDelConjunto(cid).filter(q => q.estado !== 'DESPACHADO');
      return ps.length > 0 && ps.every(q =>
        q.estado === 'CLASIFICADO' || q.estado === 'EN_MUESTREO' || q.estado === 'LISTO');
    }).length;
    lista.push({
      trabajadorId: tid,
      nombre: nombreTrabajador(tid),
      conjuntos: cids.length,
      completados: completados,
      pallets: agg[tid].pallets,
    });
  });
  lista.sort((a, b) => b.pallets - a.pallets);
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

/* Sesión del operador (montacargas): tercer actor, usuario propio */
function loginOperador(id) {
  const o = getOperador(id);
  if (!o || !o.activo) return;
  STATE.sesion.operadorId = id;
  render();
}
function logoutOperador() {
  STATE.sesion.operadorId = null;
  render();
}

/* Meta del día (PROYECTO.md §7): referencia general del almacén (default 32),
 * la fija el admin en la apertura según lo que haya. NO es cuota personal. */
function fijarMetaDelDia(n) {
  n = parseInt(n, 10);
  if (isNaN(n) || n < 1) return { error: 'La meta del día debe ser un entero mayor que 0.' };
  STATE.metaDelDia = n;
  render();
  return { ok: true };
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

/* ------------------------- CONJUNTOS (unidad de trabajo) ------------------------- */
/* Clasificación por conjunto (PROYECTO.md §5): el clasificador toma UNA BAHÍA
 * (o un conjunto de ella si es grande). El conjunto es la unidad de toma/suelta
 * y el lote que certifica una tanda. El conteo es único para todo el conjunto. */

/* El conjunto en curso del trabajador = sus pallets EN_PROCESO a su nombre */
function conjuntoDe(trabajadorId) {
  const ps = STATE.pallets.filter(p =>
    p.estado === 'EN_PROCESO' && p.clasificadoPor === trabajadorId);
  return ps.length ? ps : null;
}
/* Pallets de un conjunto dado (por id de conjunto) */
function palletsDelConjunto(conjuntoId) {
  return STATE.pallets.filter(p => p.conjuntoId === conjuntoId);
}
/* ÚLTIMO conjunto tomado por el clasificador: el de mayor id entre sus
 * pallets con conjunto aún en almacén (no DESPACHADO). Referencia del lote. */
function ultimoConjuntoDe(trabajadorId) {
  let ultimo = null;
  STATE.pallets.forEach(p => {
    if (p.clasificadoPor !== trabajadorId || !p.conjuntoId || p.estado === 'DESPACHADO') return;
    if (!ultimo || p.conjuntoId > ultimo) ultimo = p.conjuntoId;
  });
  return ultimo;
}

/* Estado derivado de una posición para el mapa del trabajador (lectura pura):
 * VACIA (activa, sin pallet — NO tomable) · DISPONIBLE (pallet DISPONIBLE) ·
 * PROPIA (EN_PROCESO del trabajador) · OTRO (EN_PROCESO de otro) ·
 * CLASIFICADA (CLASIFICADO/EN_MUESTREO/LISTO) · INACTIVA. */
function estadoPosicionPara(trabajadorId, posicion) {
  if (!posicion.activa) return 'INACTIVA';
  const p = posicion.palletId ? getPallet(posicion.palletId) : null;
  if (!p) return 'VACIA';
  if (p.estado === 'DISPONIBLE') return 'DISPONIBLE';
  if (p.estado === 'EN_PROCESO') {
    if (p.clasificadoPor === trabajadorId) return 'PROPIA';
    return 'OTRO';
  }
  return 'CLASIFICADA';
}

/* Tomar un CONJUNTO: todos los pallets DISPONIBLE (y las posiciones vacías
 * activas, que se materializan) de la bahía o de la lista de posiciones dadas.
 * Exige jornada EN CURSO y no tener otro conjunto en curso. */
function tomarConjunto(trabajadorId, bahiaOPosiciones) {
  const t = getTrabajador(trabajadorId);
  if (!t || !t.activo) return { error: 'Trabajador no válido.' };
  const jornada = jornadaEnCursoDe(trabajadorId);
  if (!jornada) {
    const hoy = jornadaDelDiaDe(trabajadorId);
    if (hoy && hoy.enPausa) return { error: 'Estás en pausa — reanuda para tomar un conjunto.' };
    if (hoy && hoy.terminada) return { error: 'Jornada terminada — reanuda para seguir.' };
    return { error: 'Inicia tu jornada para tomar un conjunto.' };
  }
  if (conjuntoDe(trabajadorId)) {
    return { error: 'Ya tienes un conjunto en curso. Suéltalo o termínalo para tomar otro.' };
  }
  // Conjunto de posiciones: toda la bahía, o las posiciones marcadas
  let posiciones = [];
  if (Array.isArray(bahiaOPosiciones)) {
    posiciones = bahiaOPosiciones.map(getPosicion).filter(Boolean);
  } else {
    posiciones = posicionesDeBahia(bahiaOPosiciones).filter(p => p.activa);
  }
  const conjuntoId = siguienteId('CN', STATE.pallets.filter(p => p.conjuntoId).map(p => ({ id: p.conjuntoId })));
  const tomados = [];
  posiciones.forEach(pos => {
    if (!pos.activa) return;
    const pallet = pos.palletId ? getPallet(pos.palletId) : null;
    if (!pallet) return; // posición vacía: no hay pallet para clasificar
    if (pallet.estado !== 'DISPONIBLE') return; // lo ocupado/no disponible no entra
    pallet.estado = 'EN_PROCESO';
    pallet.conjuntoId = conjuntoId;
    pallet.clasificadoPor = trabajadorId;
    pallet.jornadaId = jornada.id;
    tomados.push(pallet);
  });
  if (!tomados.length) {
    return { error: 'No hay pallets DISPONIBLES en ese conjunto (puede estar vacío, todo ocupado o ya tomado).' };
  }
  render();
  return { ok: true, conjuntoId: conjuntoId, pallets: tomados };
}

/* Soltar el conjunto en curso: sus pallets EN_PROCESO no tocados vuelven a
 * DISPONIBLE (llenos, sin conteo conservado) y quedan SIN DUEÑO (cualquiera
 * puede tomarlos). */
function soltarConjunto(trabajadorId) {
  const ps = conjuntoDe(trabajadorId);
  if (!ps) return { error: 'No tienes un conjunto en curso.' };
  ps.forEach(p => {
    p.estado = 'DISPONIBLE';
    p.conteo = conteoVacio();
    p.clasificadoPor = null;
    p.jornadaId = null;
    p.conjuntoId = null;
  });
  render();
  return { ok: true, cantidad: ps.length };
}

/* Definir el total de cajas del pallet (lo confirma el clasificador con
 * valores rápidos: 84 / 80 / Otro para puchitos). Solo el dueño, en curso,
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

/* Acciones en bloque por LISTA DE POSICIONES (selección múltiple de celdas del
 * mapa admin). Mismo contrato que las acciones por bahía: el tipo se resuelve
 * UNA vez, se salta lo que no corresponde y nunca se tocan pallets tomados. */

/* Abastece las posiciones dadas que no tienen pallet: activa en silencio las
 * inactivas y crea un pallet DISPONIBLE con el mismo (tipo, total) para cada
 * una. No toca las posiciones que ya tienen pallet. */
function abastecerPosiciones(posicionIds, cajasTotales, tipoCaja) {
  let n = parseInt(cajasTotales, 10);
  if (isNaN(n)) n = REGLAS.CAJAS_PALLET_CAJA12; // por defecto pallet completo caja 12
  if (n > REGLAS.MAX_CAJAS_PALLET) {
    return { error: 'El total debe ser un número entre 1 y ' + REGLAS.MAX_CAJAS_PALLET + ' cajas.' };
  }
  const res = resolverTipoCaja(n, tipoCaja); // resuelto UNA vez para todas
  if (res.error) return { error: res.error };
  let hechos = 0;
  posicionIds.forEach(id => {
    const pos = getPosicion(id);
    if (!pos || pos.palletId) return; // no existe o ya definida: no se toca
    if (!pos.activa) pos.activa = true; // auto-activa silenciosa
    const pallet = {
      id: siguienteId('P', STATE.pallets),
      posicionId: pos.id,
      estado: 'DISPONIBLE',
      cajasTotales: n,
      tipoCaja: res.tipo,
      conjuntoId: null,
      conteo: conteoVacio(),
      clasificadoPor: null,
      jornadaId: null,
      muestreo: null,
    };
    STATE.pallets.push(pallet);
    pos.palletId = pallet.id;
    hechos++;
  });
  if (hechos === 0) return { error: 'No hay posiciones pendientes por abastecer en la selección.' };
  render();
  return { ok: true, cantidad: hechos };
}

/* Cambia (tipo, total) solo de los pallets DISPONIBLES de las posiciones
 * dadas. Los tomados/clasificados no se tocan. */
function cambiarTotalPosiciones(posicionIds, cajasTotales, tipoCaja) {
  const n = parseInt(cajasTotales, 10);
  if (isNaN(n) || n > REGLAS.MAX_CAJAS_PALLET) {
    return { error: 'El total debe ser un número entre 1 y ' + REGLAS.MAX_CAJAS_PALLET + '.' };
  }
  const res = resolverTipoCaja(n, tipoCaja); // resuelto UNA vez para todos
  if (res.error) return { error: res.error };
  let hechos = 0;
  posicionIds.forEach(id => {
    const pos = getPosicion(id);
    const p = pos && pos.palletId ? getPallet(pos.palletId) : null;
    if (!p || p.estado !== 'DISPONIBLE') return;
    p.cajasTotales = n;
    p.tipoCaja = res.tipo;
    hechos++;
  });
  if (hechos === 0) return { error: 'No hay pallets DISPONIBLES seleccionados para cambiar.' };
  render();
  return { ok: true, cantidad: hechos };
}

/* Vacía (retira el pallet) solo de los DISPONIBLES de las posiciones dadas. */
function vaciarPosiciones(posicionIds) {
  let hechos = 0;
  posicionIds.forEach(id => {
    const pos = getPosicion(id);
    const p = pos && pos.palletId ? getPallet(pos.palletId) : null;
    if (!p || p.estado !== 'DISPONIBLE') return;
    STATE.pallets = STATE.pallets.filter(x => x.id !== p.id);
    pos.palletId = null;
    hechos++;
  });
  if (hechos === 0) return { error: 'No hay pallets DISPONIBLES seleccionados para vaciar.' };
  render();
  return { ok: true, cantidad: hechos };
}

/* Activa solo las posiciones dadas que están inactivas y sin pallet. */
function activarPosiciones(posicionIds) {
  let hechos = 0;
  posicionIds.forEach(id => {
    const pos = getPosicion(id);
    if (!pos || pos.activa || pos.palletId) return;
    pos.activa = true;
    hechos++;
  });
  if (hechos === 0) return { error: 'No hay posiciones inactivas sin pallet seleccionadas para activar.' };
  render();
  return { ok: true, cantidad: hechos };
}

/* Desactiva solo las posiciones dadas que están activas y sin pallet. */
function desactivarPosiciones(posicionIds) {
  let hechos = 0;
  posicionIds.forEach(id => {
    const pos = getPosicion(id);
    if (!pos || !pos.activa || pos.palletId) return;
    pos.activa = false;
    hechos++;
  });
  if (hechos === 0) return { error: 'No hay posiciones vacías activas seleccionadas para desactivar.' };
  render();
  return { ok: true, cantidad: hechos };
}

/* Deshacer el abastecimiento: vaciar TODOS los pallets DISPONIBLES de una bahía
 * (rollback del "abastecer bahía"). Los ya tomados/clasificados no se tocan. */
function vaciarBahia(bahiaId) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  const pos = posicionesDeBahia(bahiaId);
  const ids = [];
  pos.forEach(p => {
    if (!p.palletId) return;
    const pal = getPallet(p.palletId);
    if (pal && pal.estado === 'DISPONIBLE') ids.push(pal.id);
  });
  if (!ids.length) return { error: 'La bahía no tiene pallets DISPONIBLES para vaciar.' };
  STATE.pallets = STATE.pallets.filter(x => ids.indexOf(x.id) === -1);
  pos.forEach(p => { if (p.palletId && ids.indexOf(p.palletId) !== -1) p.palletId = null; });
  render();
  return { ok: true, cantidad: ids.length };
}

/* Acciones en bloque sobre lo PENDIENTE de una bahía (posiciones sin pallet,
 * inactivas o activas-vacías). Nunca tocan posiciones definidas (con pallet),
 * salvo el reset total explícito «Vaciar bahía». */

/* Activa las posiciones inactivas y sin pallet de una bahía. */
function activarPendientesBahia(bahiaId) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  let n = 0;
  posicionesDeBahia(bahiaId).forEach(p => {
    if (!p.activa && !p.palletId) { p.activa = true; n++; }
  });
  if (n === 0) return { error: 'La bahía no tiene posiciones inactivas pendientes por activar.' };
  render();
  return { ok: true, cantidad: n };
}

/* Abastece TODAS las posiciones sin pallet de una bahía de una vez: activa en
 * silencio las inactivas y crea un pallet DISPONIBLE con el mismo total para
 * cada una. No toca las posiciones que ya tienen pallet. */
function abastecerPendientesBahia(bahiaId, cajasTotales, tipoCaja) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  let n = parseInt(cajasTotales, 10);
  if (isNaN(n)) n = REGLAS.CAJAS_PALLET_CAJA12;
  if (n > REGLAS.MAX_CAJAS_PALLET) {
    return { error: 'El total debe ser un número entre 1 y ' + REGLAS.MAX_CAJAS_PALLET + ' cajas.' };
  }
  const res = resolverTipoCaja(n, tipoCaja); // resuelto UNA vez para todas
  if (res.error) return { error: res.error };
  let hechos = 0;
  posicionesDeBahia(bahiaId).forEach(pos => {
    if (pos.palletId) return; // definida: no se toca
    if (!pos.activa) pos.activa = true; // auto-activa silenciosa
    const pallet = {
      id: siguienteId('P', STATE.pallets),
      posicionId: pos.id,
      estado: 'DISPONIBLE',
      cajasTotales: n,
      tipoCaja: res.tipo,
      conjuntoId: null,
      conteo: conteoVacio(),
      clasificadoPor: null,
      jornadaId: null,
      muestreo: null,
    };
    STATE.pallets.push(pallet);
    pos.palletId = pallet.id;
    hechos++;
  });
  if (hechos === 0) return { error: 'La bahía no tiene posiciones pendientes por abastecer.' };
  render();
  return { ok: true, cantidad: hechos };
}

/* Desactiva las posiciones activas y vacías (sin pallet) de una bahía. */
function desactivarVaciasBahia(bahiaId) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  let n = 0;
  posicionesDeBahia(bahiaId).forEach(p => {
    if (p.activa && !p.palletId) { p.activa = false; n++; }
  });
  if (n === 0) return { error: 'La bahía no tiene posiciones vacías activas por desactivar.' };
  render();
  return { ok: true, cantidad: n };
}

/* Guardar el conteo parcial del conjunto en curso (los hallazgos de defectos
 * hasta ahora). La clasificación ya NO es pallet por pallet: el conteo es
 * AGREGADO del conjunto completo, y todos sus pallets guardan el mismo total. */
function guardarConteoParcialConjunto(trabajadorId, conteo) {
  const ps = conjuntoDe(trabajadorId);
  if (!ps) return { error: 'No tienes un conjunto en curso.' };
  ps.forEach(p => { p.conteo = conteo; });
  render();
  return { ok: true };
}

/* Terminar conjunto: TODOS los pallets pasan a CLASIFICADO de una vez, con el
 * conteo agregado de defectos (6 categorías) del conjunto completo. Sin total
 * de cajas ni tipo por pallet: eso lo declara el muestreador al auditar. */
function finalizarConjunto(trabajadorId, conteo) {
  const tid = trabajadorId || STATE.sesion.trabajadorId;
  const ps = conjuntoDe(tid);
  if (!ps) return { error: 'No tienes un conjunto en curso.' };
  const jornada = jornadaEnCursoDe(tid);
  const conjuntoId = ps[0].conjuntoId;
  ps.forEach(p => {
    p.conteo = conteo;
    p.estado = 'CLASIFICADO';
    p.clasificadoPor = tid;
    if (jornada) p.jornadaId = jornada.id;
  });
  render();
  return { ok: true, cantidad: ps.length, conjuntoId: conjuntoId };
}

/* Crear asignación de muestreo: la tanda de un mismo clasificador (Q2.1),
 * elegida desde el LOTE congelado de la asignación, en modo aleatorio (2–3
 * pallets al azar) o manual (tandaManual = ids marcados por el Admin, cantidad
 * libre ≥1 sin tope 2–3). LOTE = el ÚLTIMO CONJUNTO del clasificador
 * (PROYECTO.md §5/§7): el sistema lo propone como alcance; el Admin puede
 * quitar pallets. Queda como snapshot (asignacion.loteIds): certificar y
 * re-clasificar aplican a ESE conjunto. */
function crearAsignacionMuestreo(muestreadorId, clasificadorId, cantidad, loteIds, tandaManual) {
  if (!getTrabajador(muestreadorId) || !getTrabajador(clasificadorId)) {
    return { error: 'Elige muestreador y clasificador.' };
  }
  // Alcance propuesto: el último conjunto del clasificador (si no se pasó uno ajustado)
  if (!loteIds || !loteIds.length) {
    const cid = ultimoConjuntoDe(clasificadorId);
    loteIds = cid ? palletsDelConjunto(cid).filter(p => p.estado !== 'DESPACHADO').map(p => p.id) : [];
  }
  // El lote válido = ids del clasificador aún en almacén; la TANDA sale de sus CLASIFICADOS
  const lote = loteIds.filter(pid => {
    const p = getPallet(pid);
    return p && p.clasificadoPor === clasificadorId && p.estado !== 'DESPACHADO';
  });
  const elegibles = lote.filter(pid => getPallet(pid).estado === 'CLASIFICADO');

  let tanda;
  if (Array.isArray(tandaManual) && tandaManual.length > 0) {
    // MODO MANUAL: la tanda = los pallets marcados por el Admin (cantidad libre ≥1,
    // sin el tope 2–3). Cada id debe ser un CLASIFICADO dentro del lote.
    const elegiblesSet = new Set(elegibles);
    const invalidos = tandaManual.filter(pid => !elegiblesSet.has(pid));
    if (invalidos.length) {
      return { error: 'Tanda manual inválida: ' + invalidos.join(', ') +
        ' no está en estado CLASIFICADO dentro del lote. Solo admite pallets CLASIFICADOS del lote.' };
    }
    tanda = tandaManual.slice();
  } else {
    // MODO ALEATORIO: cantidad 2–3, elegida al azar entre los CLASIFICADOS del lote
    cantidad = parseInt(cantidad, 10);
    if (isNaN(cantidad) || cantidad < REGLAS.MIN_PALLETS_MUESTREO || cantidad > REGLAS.MAX_PALLETS_MUESTREO) {
      return { error: 'La cantidad debe ser 2 o 3 (nunca fuera de ese rango).' };
    }
    if (elegibles.length < cantidad) {
      return { error: 'El último conjunto del clasificador tiene ' + elegibles.length +
        ' pallet(s) clasificado(s); se necesitan al menos ' + cantidad + '.' };
    }
    const mezcla = elegibles.slice();
    for (let i = mezcla.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      const tmp = mezcla[i]; mezcla[i] = mezcla[k]; mezcla[k] = tmp;
    }
    tanda = mezcla.slice(0, cantidad);
  }

  const asignacion = {
    id: siguienteId('AS', STATE.asignaciones),
    muestreadorId: muestreadorId,
    clasificadorId: clasificadorId,
    cantidad: tanda.length,     // manual = ids marcados; aleatorio = 2–3
    palletIds: tanda.slice(),   // la tanda
    loteIds: lote.slice(),      // snapshot congelado (el conjunto)
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

/* CERTIFICACIÓN POR LOTE (PROYECTO.md §7): el muestreo certifica el CONJUNTO,
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

/* Registrar resultado de muestreo de un pallet de la tanda. El MUESTREADOR
 * declara el tipo de caja (12/24) y el total de cajas del pallet (el real si
 * es puchito) para calcular el denominador: botellas_revisadas = total × tipo.
 * Además registra en CUÁNTAS CAJAS se encontraron esas botellas (cajasMBFU):
 * dato de concientización para reportes ("8 botellas en 3 cajas").
 * CLASIFICADO → EN_MUESTREO con su MBFU%. Si la tanda se completa y NINGÚN
 * pallet supera el umbral → se certifica el LOTE congelado de la asignación;
 * si alguno ≥ 0.40% queda EN ALERTA a la espera de la decisión del Admin. */
function registrarMuestreo(palletId, botellasMBFU, asignacionId, tipoCaja, totalCajas, cajasMBFU) {
  const p = getPallet(palletId);
  if (!p || p.estado !== 'CLASIFICADO') return { error: 'El pallet no está disponible para muestreo.' };
  tipoCaja = parseInt(tipoCaja, 10);
  if (tipoCaja !== 12 && tipoCaja !== 24) {
    return { error: 'Declara el tipo de caja: 12 o 24 botellas.' };
  }
  totalCajas = parseInt(totalCajas, 10);
  if (isNaN(totalCajas) || totalCajas < 1 || totalCajas > REGLAS.MAX_CAJAS_PALLET) {
    return { error: 'El total de cajas debe ser un número entre 1 y ' + REGLAS.MAX_CAJAS_PALLET + '.' };
  }
  const revisadas = totalCajas * tipoCaja; // denominador declarado por el muestreador
  botellasMBFU = parseInt(botellasMBFU, 10);
  if (isNaN(botellasMBFU) || botellasMBFU < 0 || botellasMBFU > revisadas) {
    return { error: 'Ingresa un entero entre 0 y ' + revisadas + ' (botellas revisadas del pallet).' };
  }
  cajasMBFU = parseInt(cajasMBFU, 10);
  if (isNaN(cajasMBFU) || cajasMBFU < 0) cajasMBFU = 0;
  if (cajasMBFU > totalCajas) {
    return { error: 'Las cajas con botellas malas no pueden ser más que el total de cajas (' + totalCajas + ').' };
  }
  if (cajasMBFU > botellasMBFU) {
    return { error: 'Las cajas con botellas malas no pueden ser más que las botellas encontradas (' + botellasMBFU + ').' };
  }
  const alerta = hayAlertaMBFU(botellasMBFU, revisadas);
  p.estado = 'EN_MUESTREO';
  p.muestreo = {
    botellas: botellasMBFU,
    cajasMBFU: cajasMBFU,
    pct: pctMBFU(botellasMBFU, revisadas),
    revisadas: revisadas,
    tipoCajaDeclarado: tipoCaja,
    totalCajasMuestreado: totalCajas,
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

/* Decisión del Admin — "Re-clasificar lote": TODO el lote congelado (el
 * conjunto) vuelve a clasificación: sus pallets CLASIFICADO + EN_MUESTREO +
 * LISTO aún no despachados pasan a EN_PROCESO con su conteo reseteado a 0 y
 * quedan LIBERADOS (sin dueño). Los DESPACHADO no se tocan. */
function reclasificarLote(asignacionId) {
  const asg = getAsignacion(asignacionId);
  if (!asg || !asg.loteIds) return 0;
  let n = 0;
  asg.loteIds.forEach(pid => {
    const p = getPallet(pid);
    if (p && (p.estado === 'CLASIFICADO' || p.estado === 'EN_MUESTREO' || p.estado === 'LISTO')) {
      p.estado = 'EN_PROCESO';
      p.conteo = conteoVacio();
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

/* DESPACHO dual (Operador Y Administrador, PROYECTO.md §10): despachables son
 * CLASIFICADO (con o sin muestrear) y LISTO (certificado). BLOQUEADOS:
 * EN_PROCESO (alguien lo trabaja) y EN_MUESTREO (tanda en curso o en alerta:
 * primero se decide). Marca DESPACHADO y libera la posición AL INSTANTE (ya
 * no hay pallet ahí: el registro vive en historiales/reportes, no en el mapa). */
function esDespachable(p) {
  return p && (p.estado === 'CLASIFICADO' || p.estado === 'LISTO');
}

function despacharPallet(actorId, palletId) {
  const res = despacharPallets(actorId, [palletId]);
  if (res.error) return res;
  return { ok: true };
}

/* Despacho en LOTE (selección múltiple). `actorId` puede ser un id de operador
 * o la cadena 'admin' (el administrador tiene la MISMA función de despacho).
 * Valida TODOS antes de tocar nada: si alguno dejó de ser despachable, aborta. */
function despacharPallets(actorId, palletIds) {
  const esAdmin = actorId === 'admin';
  const o = esAdmin ? null : getOperador(actorId);
  if (!esAdmin && (!o || !o.activo)) return { error: 'Operador no válido.' };
  if (!palletIds || !palletIds.length) return { error: 'Selecciona al menos un pallet.' };
  for (let i = 0; i < palletIds.length; i++) {
    const p = getPallet(palletIds[i]);
    if (!p) return { error: 'Pallet ' + palletIds[i] + ' no encontrado. Se aborta el despacho.' };
    if (!esDespachable(p)) {
      return { error: palletIds[i] + ' no se puede despachar (estado: ' +
        ESTADO_PALLET[p.estado].label + '). Se aborta todo el despacho.' };
    }
  }
  const ahora = Date.now();
  palletIds.forEach(pid => {
    const p = getPallet(pid);
    p.estado = 'DESPACHADO';
    p.despachadoPor = actorId;
    p.despachadoTs = ahora;
    const pos = getPosicion(p.posicionId);
    if (pos) pos.palletId = null; // posición libre al instante
  });
  render();
  return { ok: true, cantidad: palletIds.length };
}

/* ------------------------- Selectores de despacho ------------------------- */

/* Pallets DESPACHABLES (CLASIFICADO o LISTO), ordenados por zona → bahía → posición */
function palletsDespachables() {
  return STATE.pallets
    .filter(esDespachable)
    .sort((a, b) => a.posicionId < b.posicionId ? -1 : 1);
}
/* Historial de cargues de un operador (más recientes primero) */
function carguesDe(operadorId) {
  return STATE.pallets
    .filter(p => p.estado === 'DESPACHADO' && p.despachadoPor === operadorId)
    .sort((a, b) => b.despachadoTs - a.despachadoTs);
}
/* Contadores del BI: despachables (clasificados + listos) y despachados hoy */
function contadoresDespacho() {
  const hoy = new Date().toDateString();
  return {
    clasificados: STATE.pallets.filter(p => p.estado === 'CLASIFICADO').length,
    listos: STATE.pallets.filter(p => p.estado === 'LISTO').length,
    despachables: STATE.pallets.filter(esDespachable).length,
    despachadosHoy: STATE.pallets.filter(p =>
      p.estado === 'DESPACHADO' && p.despachadoTs && new Date(p.despachadoTs).toDateString() === hoy).length
  };
}

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

/* ------------------------- Gestión de operadores ------------------------- */

function crearOperador(nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) return { error: 'Ingresa un nombre.' };
  if (STATE.operadores.some(o => o.nombre.toLowerCase() === nombre.toLowerCase())) {
    return { error: 'Ya existe un operador con ese nombre.' };
  }
  STATE.operadores.push({ id: siguienteId('O', STATE.operadores), nombre: nombre, activo: true });
  render();
  return { ok: true };
}
function renombrarOperador(id, nombre) {
  const o = getOperador(id);
  nombre = String(nombre || '').trim();
  if (!o || !nombre) return { error: 'Nombre inválido.' };
  o.nombre = nombre;
  render();
  return { ok: true };
}
function toggleActivoOperador(id) {
  const o = getOperador(id);
  if (!o) return;
  o.activo = !o.activo;
  if (!o.activo && STATE.sesion.operadorId === id) STATE.sesion.operadorId = null;
  render();
}
