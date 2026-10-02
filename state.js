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

/* Vacía (retira el pallet) solo de los DISPONIBLES de las posiciones dadas.
 * La posición vuelve a inactiva (✕): no existe posición activa sin pallet. */
function vaciarPosiciones(posicionIds) {
  let hechos = 0;
  posicionIds.forEach(id => {
    const pos = getPosicion(id);
    const p = pos && pos.palletId ? getPallet(pos.palletId) : null;
    if (!p || p.estado !== 'DISPONIBLE') return;
    STATE.pallets = STATE.pallets.filter(x => x.id !== p.id);
    pos.palletId = null;
    pos.activa = false; // sin pallet → ✕
    hechos++;
  });
  if (hechos === 0) return { error: 'No hay pallets DISPONIBLES seleccionados para vaciar.' };
  render();
  return { ok: true, cantidad: hechos };
}

/* Activa solo las posiciones dadas que están inactivas y sin pallet.
 * Nota: en el modelo nuevo (sin activa-vacía) esta función queda reservada
 * para abastecerPosiciones, que la llama en silencio al crear el pallet. */
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
  pos.forEach(p => {
    if (p.palletId && ids.indexOf(p.palletId) !== -1) {
      p.palletId = null;
      p.activa = false; // sin pallet → ✕ (no existe activa sin pallet)
    }
  });
  render();
  return { ok: true, cantidad: ids.length };
}

/* Cantidad de pallets de una bahía con trabajo vivo o ya certificado
 * (EN_PROCESO / CLASIFICADO / EN_MUESTREO / LISTO). Solo lectura: la UI la
 * usa para confirmar antes de que «Abastecer N» los reescriba. */
function trabajoQueSeReescribe(bahiaId) {
  return posicionesDeBahia(bahiaId).filter(pos => {
    const p = pos.palletId ? getPallet(pos.palletId) : null;
    return p && ['EN_PROCESO', 'CLASIFICADO', 'EN_MUESTREO', 'LISTO'].indexOf(p.estado) !== -1;
  }).length;
}

/* Control numérico «Abastecer N posiciones» (PROYECTO.md §11/§175): deja las
 * PRIMERAS N posiciones de la bahía (orden A1,B1,A2,B2…) DISPONIBLES con el
 * pallet completo del tipo (84/80) y las demás VACÍAS (activas). Amplía solo
 * si falta capacidad (filas completas A/B). Reescribe lo que haya en esas
 * primeras N posiciones: si el pallet existe se muta in-place (mismo id, para
 * no romper referencias); si no, se crea uno nuevo. */
/* Control numérico «Abastecer N filas» (PROYECTO.md §11/§175): deja las
 * PRIMERAS N filas de la bahía (orden A1,B1,A2,B2…, 2 posiciones por fila)
 * con pallets DISPONIBLES del tipo elegido (84/80) y las demás vacías (activas).
 * N es en FILAS; se convierte a posiciones (n*2) internamente.
 * Amplía sola si hace falta; reescribe in-place para no romper referencias. */
function abastecerNPosiciones(bahiaId, nFilas, tipoCaja) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  nFilas = parseInt(nFilas, 10);
  if (isNaN(nFilas) || nFilas < 0) return { error: 'El número de filas debe ser 0 o más.' };
  tipoCaja = parseInt(tipoCaja, 10);
  if (tipoCaja !== 12 && tipoCaja !== 24) return { error: 'Elegí el tipo de caja: 12 o 24.' };
  const total = completoCajasDe(tipoCaja);
  const n = nFilas * 2; // convertir filas a posiciones para el resto de la lógica

  // Amplía si falta: filas completas A/B hasta alcanzar nFilas filas.
  const filasNecesarias = nFilas;
  while ((posicionesDeBahia(bahiaId).length / 2) < filasNecesarias) {
    const fila = ultimaFilaBahia(bahiaId);
    const siguiente = (fila ? fila.pares : 0) + 1;
    ['A', 'B'].forEach(prefijo => {
      const cod = prefijo + siguiente;
      STATE.posiciones.push({
        id: bahiaId + '-' + cod,
        bahiaId: bahiaId,
        codigo: cod,
        activa: false,
        palletId: null,
      });
    });
  }

  // Ordena por fila y prefijo: A1,B1,A2,B2…
  const posiciones = posicionesDeBahia(bahiaId).sort((a, b) => {
    const na = parseInt(a.codigo.slice(1), 10);
    const nb = parseInt(b.codigo.slice(1), 10);
    if (na !== nb) return na - nb;
    return a.codigo[0] < b.codigo[0] ? -1 : 1;
  });

  const eliminados = [];
  posiciones.forEach((pos, idx) => {
    if (idx < n) {
      // Reescribir a DISPONIBLE con el pallet completo del tipo elegido.
      const pallet = pos.palletId ? getPallet(pos.palletId) : null;
      if (pallet) {
        pallet.estado = 'DISPONIBLE';
        pallet.cajasTotales = total;
        pallet.tipoCaja = tipoCaja;
        pallet.conteo = conteoVacio();
        pallet.conjuntoId = null;
        pallet.clasificadoPor = null;
        pallet.jornadaId = null;
        pallet.muestreo = null;
      } else {
        const nuevo = {
          id: siguienteId('P', STATE.pallets),
          posicionId: pos.id,
          estado: 'DISPONIBLE',
          cajasTotales: total,
          tipoCaja: tipoCaja,
          conjuntoId: null,
          conteo: conteoVacio(),
          clasificadoPor: null,
          jornadaId: null,
          muestreo: null,
        };
        STATE.pallets.push(nuevo);
        pos.palletId = nuevo.id;
      }
      pos.activa = true;
    } else {
      // Por encima de N: vuelve a inactiva (✕). No existe posición activa sin pallet.
      const pallet = pos.palletId ? getPallet(pos.palletId) : null;
      if (pallet) {
        eliminados.push(pallet.id);
        STATE.pallets = STATE.pallets.filter(x => x.id !== pallet.id);
        pos.palletId = null;
      }
      pos.activa = false;
    }
  });

  // Limpia referencias colgantes: quita los ids eliminados de las asignaciones.
  if (eliminados.length) {
    STATE.asignaciones.forEach(asg => {
      if (asg.loteIds) asg.loteIds = asg.loteIds.filter(id => eliminados.indexOf(id) === -1);
      if (asg.palletIds) asg.palletIds = asg.palletIds.filter(id => eliminados.indexOf(id) === -1);
    });
  }

  render();
  return { ok: true, filas: nFilas };
}

/* Desactiva las posiciones activas y vacías (sin pallet) de una bahía. */
/* ------------------------- Capacidad dinámica de bahía ------------------------- */

/* Última fila de una bahía (la de mayor índice): devuelve { pares, a, b } con
 * las posiciones A<pares> y B<pares>, o null si la bahía no tiene posiciones.
 * pares = cantidad de posiciones / 2 (siempre se organizan en filas A|B). */
function ultimaFilaBahia(bahiaId) {
  const posiciones = posicionesDeBahia(bahiaId);
  if (!posiciones.length) return null;
  const pares = posiciones.length / 2;
  return {
    pares: pares,
    a: getPosicion(bahiaId + '-A' + pares),
    b: getPosicion(bahiaId + '-B' + pares),
  };
}

/* Amplía la bahía con UNA fila (A<siguiente> y B<siguiente>) al final, ambas
 * INACTIVAS y sin pallet. Sigue la numeración existente, sin tope máximo. */
function ampliarBahia(bahiaId) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  const fila = ultimaFilaBahia(bahiaId);
  const siguiente = (fila ? fila.pares : 0) + 1;
  ['A', 'B'].forEach(prefijo => {
    const cod = prefijo + siguiente;
    STATE.posiciones.push({
      id: bahiaId + '-' + cod,
      bahiaId: bahiaId,
      codigo: cod,
      activa: false,
      palletId: null,
    });
  });
  render();
  return { ok: true, cantidad: 2, fila: siguiente };
}

/* Quita la ÚLTIMA fila de una bahía (A+B). Antes de mutar bloquea si alguna de
 * las dos celdas tiene pallet en EN_PROCESO/CLASIFICADO/EN_MUESTREO/LISTO
 * (trabajo vivo o ya certificado, no se pierde). Si pasa: descarta los pallets
 * DISPONIBLE de la fila y quita las dos posiciones. */
function quitarFilaBahia(bahiaId) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  const fila = ultimaFilaBahia(bahiaId);
  if (!fila) return { error: 'La bahía no tiene posiciones para quitar.' };
  const celdas = [fila.a, fila.b].filter(Boolean);
  // Validación ANTES de mutar: nada de trabajo vivo ni certificado se pierde.
  const bloqueadas = [];
  celdas.forEach(pos => {
    const p = pos.palletId ? getPallet(pos.palletId) : null;
    if (p && ['EN_PROCESO', 'CLASIFICADO', 'EN_MUESTREO', 'LISTO'].indexOf(p.estado) !== -1) {
      bloqueadas.push(pos.codigo + ' (' + ESTADO_PALLET[p.estado].label + ')');
    }
  });
  if (bloqueadas.length) {
    const codA = fila.a ? fila.a.codigo : 'A' + fila.pares;
    const codB = fila.b ? fila.b.codigo : 'B' + fila.pares;
    return { error: 'No se puede quitar la fila ' + codA + '/' + codB + ' de ' + bahia.codigo +
      ': ' + bloqueadas.join(' y ') + '. Liberá o despachá esos pallets primero.' };
  }
  // Descarta los pallets DISPONIBLES de la fila (igual que «vaciar»).
  celdas.forEach(pos => {
    const p = pos.palletId ? getPallet(pos.palletId) : null;
    if (p && p.estado === 'DISPONIBLE') {
      STATE.pallets = STATE.pallets.filter(x => x.id !== p.id);
    }
  });
  // Quita las dos posiciones de la fila.
  STATE.posiciones = STATE.posiciones.filter(p => p.id !== fila.a.id && p.id !== fila.b.id);
  render();
  return { ok: true, cantidad: 2 };
}

/* Configura la capacidad física (cantidad total de filas A|B) de una bahía.
 * Si aumenta: agrega filas inactivas (✕) al final.
 * Si disminuye: verifica que ninguna celda a recortar tenga trabajo en curso
 * o certificado (EN_PROCESO, CLASIFICADO, EN_MUESTREO, LISTO); si tienen
 * DISPONIBLE, los descarta; elimina las posiciones recortadas de STATE.posiciones. */
function setCapacidadFisicaBahia(bahiaId, nuevasFilas) {
  const bahia = getBahia(bahiaId);
  if (!bahia) return { error: 'Bahía no válida.' };
  nuevasFilas = parseInt(nuevasFilas, 10);
  if (isNaN(nuevasFilas) || nuevasFilas < 1) {
    return { error: 'La bahía debe tener al menos 1 fila física.' };
  }
  const posiciones = posicionesDeBahia(bahiaId);
  const filasActuales = posiciones.length / 2;
  if (nuevasFilas === filasActuales) {
    return { ok: true, filas: nuevasFilas, mensaje: 'La capacidad ya es de ' + nuevasFilas + ' filas.' };
  }

  if (nuevasFilas > filasActuales) {
    // Ampliar: agregar filas inactivas (✕) desde filasActuales + 1 hasta nuevasFilas
    for (let f = filasActuales + 1; f <= nuevasFilas; f++) {
      ['A', 'B'].forEach(prefijo => {
        const cod = prefijo + f;
        STATE.posiciones.push({
          id: bahiaId + '-' + cod,
          bahiaId: bahiaId,
          codigo: cod,
          activa: false,
          palletId: null,
        });
      });
    }
    render();
    return { ok: true, filas: nuevasFilas, agregadas: nuevasFilas - filasActuales };
  }

  // Reducir: validar filas a recortar (desde nuevasFilas + 1 hasta filasActuales)
  const celdasARecortar = [];
  for (let f = nuevasFilas + 1; f <= filasActuales; f++) {
    const posA = getPosicion(bahiaId + '-A' + f);
    const posB = getPosicion(bahiaId + '-B' + f);
    if (posA) celdasARecortar.push(posA);
    if (posB) celdasARecortar.push(posB);
  }

  const bloqueadas = [];
  celdasARecortar.forEach(pos => {
    const p = pos.palletId ? getPallet(pos.palletId) : null;
    if (p && ['EN_PROCESO', 'CLASIFICADO', 'EN_MUESTREO', 'LISTO'].indexOf(p.estado) !== -1) {
      bloqueadas.push(pos.codigo + ' (' + ESTADO_PALLET[p.estado].label + ')');
    }
  });

  if (bloqueadas.length) {
    return {
      error: 'No se puede reducir a ' + nuevasFilas + ' filas: las filas a recortar tienen pallets con trabajo: ' +
        bloqueadas.join(', ') + '. Liberá o despachá esos pallets primero.'
    };
  }

  // Descartar pallets DISPONIBLES de las celdas recortadas
  const idsEliminados = [];
  celdasARecortar.forEach(pos => {
    const p = pos.palletId ? getPallet(pos.palletId) : null;
    if (p && p.estado === 'DISPONIBLE') {
      idsEliminados.push(p.id);
      STATE.pallets = STATE.pallets.filter(x => x.id !== p.id);
    }
  });

  // Limpiar asignaciones
  if (idsEliminados.length) {
    STATE.asignaciones.forEach(asg => {
      if (asg.loteIds) asg.loteIds = asg.loteIds.filter(id => idsEliminados.indexOf(id) === -1);
      if (asg.palletIds) asg.palletIds = asg.palletIds.filter(id => idsEliminados.indexOf(id) === -1);
    });
  }

  // Quitar posiciones recortadas
  const recortarIds = celdasARecortar.map(p => p.id);
  STATE.posiciones = STATE.posiciones.filter(p => recortarIds.indexOf(p.id) === -1);

  render();
  return { ok: true, filas: nuevasFilas, reducidas: filasActuales - nuevasFilas };
}

/* Crea una nueva bahía en la zona indicada, con la cantidad inicial de filas.
 * Todas las posiciones nacen inactivas (✕). */
function crearBahia(zonaId, codigo, filasIniciales) {
  const z = STATE.zonas.filter(x => x.id === zonaId)[0];
  if (!z) return { error: 'Zona no válida.' };
  codigo = (codigo || '').trim();
  if (!codigo) return { error: 'Ingresá un código o nombre para la bahía (ej: Bahía 4).' };
  filasIniciales = parseInt(filasIniciales, 10);
  if (isNaN(filasIniciales) || filasIniciales < 1) {
    return { error: 'La bahía debe tener al menos 1 fila inicial.' };
  }

  // Generar ID único dentro de la zona
  const bahiasZona = bahiasDeZona(zonaId);
  let num = bahiasZona.length + 1;
  let bahiaId = zonaId + '-B' + num;
  while (getBahia(bahiaId)) {
    num++;
    bahiaId = zonaId + '-B' + num;
  }

  const nuevaBahia = {
    id: bahiaId,
    zonaId: zonaId,
    codigo: codigo,
  };
  STATE.bahias.push(nuevaBahia);

  for (let f = 1; f <= filasIniciales; f++) {
    ['A', 'B'].forEach(prefijo => {
      const cod = prefijo + f;
      STATE.posiciones.push({
        id: bahiaId + '-' + cod,
        bahiaId: bahiaId,
        codigo: cod,
        activa: false,
        palletId: null,
      });
    });
  }

  render();
  return { ok: true, bahia: nuevaBahia };
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
