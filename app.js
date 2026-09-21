/* =========================================================================
 * Sorty — Render de pantallas y eventos de la demo (sin backend)
 *
 * Estado de presentación en UI (pantalla activa, tab admin, conteo en
 * curso...). Las mutaciones del dominio viven en state.js; este archivo
 * solo dibuja y delega. Sin import/export: funciones globales para file://.
 * ========================================================================= */

let UI = {};

function resetUI() {
  if (UI.timerHandle) clearInterval(UI.timerHandle);
  UI = {
    pantalla: 'login',      // login | home | conteo | muestrear | muestreo-detalle | historial
    pantallaConductor: 'login', // login | home | cargues
    tab: 'bi',              // bi | mapa | muestreo | decisiones | trabajadores
    mapaBahia: null,        // bahía seleccionada en el mapa
    conteo: null,           // { palletId, cajas, cats, inicioTs }
    asignacionVer: null,    // asignación de muestreo abierta
    editingWorker: null,    // trabajador en edición (tabla admin)
    msg: null,              // { tipo, texto } feedback del form de muestreo
    despSel: {},            // selección de pallets del conductor (despacho en lote)
    timerHandle: null,
  };
}

/* ------------------------- Utilidades de formato ------------------------- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtHora(ts) {
  const d = new Date(ts);
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function fmtDur(ms) {
  const seg = Math.floor(ms / 1000);
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const mm = ('0' + m).slice(-2), ss = ('0' + s).slice(-2);
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}
function fmtHace(ts) {
  const min = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (min < 60) return 'hace ' + min + ' min';
  return 'hace ' + (min / 60).toFixed(1).replace('.0', '') + ' h';
}
function fmtPct(pct) { return pct.toFixed(2) + '%'; }
/* Separador de miles estilo es-PE: 1008 -> "1.008" */
function fmtMiles(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function chipEstadoPallet(estado) {
  const e = ESTADO_PALLET[estado] || { label: estado, color: '#6b7280' };
  return '<span class="chip" style="background:' + e.color + '">' + e.label + '</span>';
}
function chipEstadoBahia(estado) {
  const e = ESTADO_BAHIA[estado] || { label: estado, color: '#6b7280' };
  return '<span class="chip" style="background:' + e.color + '">' + e.label + '</span>';
}
function chipAlerta() {
  return '<span class="chip chip-alerta">Alerta MBFU</span>';
}
/* Resumen textual de un pallet: defectos registrados (BOTELLAS) + sanas por
 * descarte, p. ej. "2 rotas, 997 sanas por descarte". */
function resumenConteo(pallet) {
  const partes = CATEGORIAS
    .filter(c => (pallet.conteo[c.id] || 0) > 0)
    .map(c => pallet.conteo[c.id] + ' ' + c.nombre.toLowerCase());
  partes.push(fmtMiles(botellasSanas(pallet)) + ' sanas por descarte');
  return partes.join(', ');
}
function barra(pctReal, color, max) {
  const maximo = max || 100;
  const pct = Math.min(100, pctReal / maximo * 100);
  return '<div class="barra-progreso"><div style="width:' + pct + '%;background:' + (color || 'var(--proceso)') + '"></div></div>';
}
function leyendaEstadosPallet() {
  let h = '<div class="leyenda">';
  Object.keys(ESTADO_PALLET).forEach(k => {
    h += '<span class="item"><span class="punto" style="background:' + ESTADO_PALLET[k].color + '"></span>' + ESTADO_PALLET[k].label + '</span>';
  });
  h += '<span class="item"><span class="punto" style="background:#eff6ff;border:2px solid #93c5fd"></span>Posición libre</span>';
  h += '<span class="item"><span class="punto" style="background:#e5e7eb;border:2px dashed #cbd5e1"></span>Posición inactiva</span>';
  return h + '</div>';
}

/* Ubicación legible de un pallet: Zona 1 · Bahía 2 · A3 */
function ubicacionPallet(pallet) {
  const pos = getPosicion(pallet.posicionId);
  const bahia = pos ? getBahia(pos.bahiaId) : null;
  const zona = bahia ? STATE.zonas.filter(z => z.id === bahia.zonaId)[0] : null;
  return (zona ? zona.nombre + ' · ' : '') + (bahia ? bahia.codigo + ' · posición ' : '') + (pos ? pos.codigo : '?');
}
function etiquetaBahia(bahia) {
  const zona = STATE.zonas.filter(z => z.id === bahia.zonaId)[0];
  return zona.nombre + ' · ' + bahia.codigo;
}

/* ============================ RENDER GENERAL ============================ */

function render() {
  if (UI.timerHandle) { clearInterval(UI.timerHandle); UI.timerHandle = null; }
  document.getElementById('vista-trabajador').classList.toggle('activa', STATE.vista === 'trabajador');
  document.getElementById('vista-conductor').classList.toggle('activa', STATE.vista === 'conductor');
  document.getElementById('vista-admin').classList.toggle('activa', STATE.vista === 'admin');
  document.getElementById('btn-vista-trabajador').classList.toggle('activo', STATE.vista === 'trabajador');
  document.getElementById('btn-vista-conductor').classList.toggle('activo', STATE.vista === 'conductor');
  document.getElementById('btn-vista-admin').classList.toggle('activo', STATE.vista === 'admin');
  // Al cambiar de vista se destruye el pan/zoom de las otras (sus listeners de
  // document no deben quedar vivos): cada vista lo reinicializa al volver.
  if (STATE.vista !== 'admin') destruirMapaPanzoom();
  if (STATE.vista !== 'trabajador') destruirMapaMovilPanzoom();
  if (STATE.vista !== 'conductor') destruirMapaCondPanzoom();
  if (STATE.vista === 'trabajador') renderTrabajador();
  else if (STATE.vista === 'conductor') renderConductor();
  else renderAdmin();
}

/* ============================ VISTA TRABAJADOR ============================ */

function irA(pantalla) {
  UI.pantalla = pantalla;
  render();
}
function yo() {
  const t = STATE.sesion.trabajadorId ? getTrabajador(STATE.sesion.trabajadorId) : null;
  if (!t || !t.activo) { STATE.sesion.trabajadorId = null; return null; }
  return t;
}

function renderTrabajador() {
  const cont = document.getElementById('pantalla-trabajador');
  if (UI.pantalla !== 'login' && !yo()) UI.pantalla = 'login';
  // El pan/zoom del mapa solo vive en el home; al salir se destruye.
  if (UI.pantalla !== 'home') destruirMapaMovilPanzoom();
  switch (UI.pantalla) {
    case 'login': cont.innerHTML = pLogin(); break;
    case 'home': cont.innerHTML = pHome(); inicializarMapaMovilPanzoom(); activarTimerJornada(); break;
    case 'conteo': cont.innerHTML = pConteo(); activarTimer(); break;
    case 'muestrear': cont.innerHTML = pMuestrear(); break;
    case 'muestreo-detalle': cont.innerHTML = pMuestreoDetalle(); break;
    case 'historial': cont.innerHTML = pHistorial(); break;
    default: cont.innerHTML = pLogin();
  }
}

/* --- Pantalla 1: Login (selector de trabajador, sin contraseña) --- */
function pLogin() {
  let h = '<div class="appbar"><span class="appbar-titulo">Sorty · Trabajador</span></div>';
  h += '<div class="tarjeta-movil"><h3>¿Quién eres?</h3>' +
    '<p class="muted mini">Selecciona tu nombre para entrar. Demo sin contraseña.</p></div>';
  h += '<div class="lista-opciones">';
  trabajadoresActivos().forEach(t => {
    h += '<button class="opcion-trabajador" onclick="loginTrabajador(\'' + t.id + '\');irA(\'home\')">' + esc(t.nombre) + '</button>';
  });
  h += '</div>';
  return h;
}

/* --- Pantalla 2: Home (jornada + pallet actual + pallets disponibles) ---
 * Jornada = día laboral fichado con pausas: el temporizador solo corre en
 * segmentos activos; pausar/reanudar/terminar controlan el estado. */
function pHome() {
  const t = yo();
  const delDia = jornadaDelDiaDe(t.id);
  const enCurso = jornadaEnCursoDe(t.id);
  const tomado = palletTomadoPor(t.id);
  const misAsignaciones = asignacionesDeMuestreador(t.id)
    .filter(a => a.palletIds.some(pid => { const p = getPallet(pid); return p && p.estado === 'CLASIFICADO'; }));

  let h = '<div class="appbar"><span class="appbar-titulo">Hola, ' + esc(t.nombre.split(' ')[0]) + '</span>' +
    '<button class="appbar-atras" onclick="logoutTrabajador()">Salir</button></div>';

  // Tarjeta de jornada según estado: sin jornada / en curso / pausa / terminada
  h += '<div class="tarjeta-movil">';
  if (!delDia) {
    h += '<h3>Jornada</h3>' +
      '<p class="muted mini">Inicia al llegar; puedes pausar y terminar cuando te vayas. Todo lo que clasifiques queda en tu jornada de hoy.</p>' +
      '<button class="btn btn-primario" style="width:100%" onclick="iniciarJornada()">Iniciar jornada</button>';
  } else if (enCurso) {
    h += '<h3>Jornada en curso · iniciaste ' + fmtHora(inicioJornada(delDia)) + '</h3>' +
      '<p class="mini">Tiempo activo: <strong class="timer-jornada" id="t-jornada">' +
      fmtDur(minutosActivos(delDia) * 60000) + '</strong></p>' +
      '<div class="fila-botones">' +
      '<button class="btn" onclick="pausarJornadaUI()">Pausar</button>' +
      '<button class="btn btn-peligro" onclick="terminarJornadaUI()">Terminar</button>' +
      '</div>';
  } else if (delDia.enPausa) {
    h += '<h3>Jornada en pausa</h3>' +
      '<p class="mini muted">En pausa desde las ' + fmtHora(finJornada(delDia)) + ' · acumuladas: ' +
      fmtDur(minutosActivos(delDia) * 60000) + ' activas</p>' +
      '<div class="fila-botones">' +
      '<button class="btn btn-primario" onclick="reanudarJornadaUI()">Reanudar</button>' +
      '<button class="btn btn-peligro" onclick="terminarJornadaUI()">Terminar</button>' +
      '</div>';
  } else { // terminada (reanudable el mismo día)
    h += '<h3>Jornada terminada · ' + fmtHora(finJornada(delDia)) + '</h3>' +
      '<p class="mini muted">' + fmtDur(minutosActivos(delDia) * 60000) +
      ' activas · ¿seguiste trabajando? Reanuda y sigue contando.</p>' +
      '<button class="btn btn-primario" style="width:100%" onclick="reanudarJornadaUI()">Reanudar</button>';
  }
  h += '</div>';

  // Tu pallet actual (self-service: un pallet a la vez por trabajador)
  h += '<div class="tarjeta-movil"><h3>Tu pallet actual</h3>';
  if (tomado) {
    h += '<p class="mini" style="margin-bottom:4px">' + ubicacionPallet(tomado) + ' · <strong>' + tomado.id + '</strong></p>' +
      '<p class="mini muted">' + tomado.cajasTotales + ' cajas · ' + fmtMiles(botellasRevisadas(tomado)) +
      ' botellas · ' + tipoCajaDe(tomado).nombre + '</p>' +
      '<p class="mini muted">' + resumenConteo(tomado) + '</p>' +
      '<button class="btn btn-primario" style="width:100%;margin-top:6px" onclick="continuarClasificacion()">Continuar clasificación</button>' +
      '<button class="btn" style="width:100%;margin-top:6px" onclick="soltarPalletActual()">Soltar pallet</button>';
  } else {
    h += '<p class="muted mini">No has tomado pallets. Toma uno de los disponibles más abajo para empezar a clasificar.</p>';
  }
  h += '</div>';

  // Seleccionar ubicación: mapa visual estilo dibujado (self-service)
  h += mapaUbicacion(t, enCurso, tomado);

  // Accesos
  h += '<div class="menu-grid">' +
    '<div class="menu-item" onclick="irA(\'muestrear\')"><span class="menu-num">✓</span>Muestrear' +
    (misAsignaciones.length ? '<span class="insignia">' + misAsignaciones.length + '</span>' : '') + '</div>' +
    '<div class="menu-item" onclick="irA(\'historial\')"><span class="menu-num">≡</span>Historial</div>' +
    '</div>';
  return h;
}

/* Grilla común del mapa dibujado: zonas → bahías (barras segmentadas A|B).
 * renderSeg(pos) dibuja cada segmento según la vista (trabajador/conductor/admin).
 * opts (opcional): zonaInfo(z) añade info junto a la etiqueta de zona y
 * bahiaCab(b) inserta una cabecera tappable sobre cada barra de bahía. */
function mapaAlmacenSketch(renderSeg, opts) {
  opts = opts || {};
  let h = '';
  STATE.zonas.forEach(z => {
    h += '<div class="mapa-zona"><span class="mapa-zona-etiqueta">' + z.nombre.toUpperCase() + '</span>';
    if (opts.zonaInfo) h += '<span class="mapa-zona-info mini">' + opts.zonaInfo(z) + '</span>';
    h += '<div class="mapa-bahias-fila">';
    bahiasDeZona(z.id).forEach(b => {
      h += '<div class="mapa-bahia-sketch">';
      if (opts.bahiaCab) h += opts.bahiaCab(b);
      h += '<div class="mapa-segmentos">';
      const porCodigo = {};
      posicionesDeBahia(b.id).forEach(p => { porCodigo[p.codigo] = p; });
      // Orden intercalado A1,B1,A2,B2,... para que la grilla 2 col quede A | B.
      // Las bahías tienen pares variables (8–15 pares = 16–30 posiciones).
      const pares = posicionesDeBahia(b.id).length / 2;
      for (let i = 1; i <= pares; i++) {
        h += renderSeg(porCodigo['A' + i]);
        h += renderSeg(porCodigo['B' + i]);
      }
      h += '</div><span class="mapa-bahia-nombre">b' + b.codigo.replace('Bahía ', '') + '</span></div>';
    });
    h += '</div></div>';
  });
  return h;
}

/* Segmento del mapa del ADMIN (configuración): cada posición es tappable para
 * activar/desactivar (la regla bloquea desactivar una posición ocupada).
 * A diferencia del trabajador, la INACTIVA se dibuja (✕ punteado): el admin
 * necesita verla para reactivarla. */
function segPosicionAdmin(pos) {
  if (!pos) return '';
  const p = pos.palletId ? getPallet(pos.palletId) : null;
  if (!pos.activa) {
    return '<div class="mapa-seg mapa-seg--inactiva-admin" title="' + pos.codigo +
      ' · inactiva (toca para activar)" onclick="togglePosicion(\'' + pos.id + '\')">✕</div>';
  }
  if (!p) {
    return '<div class="mapa-seg mapa-seg--libre-admin" title="' + pos.codigo +
      ' · libre (toca para desactivar)" onclick="togglePosicion(\'' + pos.id + '\')"></div>';
  }
  const alerta = p.muestreo && p.muestreo.alerta && p.estado === 'EN_MUESTREO';
  const color = alerta ? 'var(--alerta)' : ESTADO_PALLET[p.estado].color;
  const titulo = pos.codigo + ' · ' + p.id + ' · ' + ESTADO_PALLET[p.estado].label +
    (alerta ? ' · ALERTA' : '') + ' (ocupada: no se puede desactivar)';
  return '<div class="mapa-seg mapa-seg--hecha" style="background:' + color + ';border-color:' + color +
    '" title="' + esc(titulo) + '" onclick="togglePosicion(\'' + pos.id + '\')">' + esc(pos.codigo) + '</div>';
}

/* --- Mapa visual "Seleccionar ubicación" del TRABAJADOR (estilo dibujado) ---
 * Zonas apiladas como cajas redondeadas; cada bahía es una barra vertical
 * redondeada segmentada por posición (columna A | columna B), tappable
 * según estadoPosicionPara. Referencia: wireframe del board Excalidraw. */
function mapaUbicacion(t, enCurso, tomado) {
  let disponibles = 0;
  STATE.posiciones.forEach(pos => {
    const e = estadoPosicionPara(t.id, pos);
    if (e === 'DISPONIBLE' || e === 'PARCIAL') disponibles++;
  });
  const delDia = jornadaDelDiaDe(t.id);
  // Contador, leyenda y avisos FUERA del viewport: siempre visibles
  let h = '<div class="tarjeta-movil mapa-ubicacion"><h3>Seleccionar ubicación</h3>' +
    '<p class="mini mapa-contador"><strong>' + disponibles + '</strong> pallets disponibles</p>' +
    '<div class="mini mapa-leyenda">' +
    '<span><i class="punto" style="background:#16a34a"></i>libre</span>' +
    '<span><i class="punto" style="background:#f97316"></i>parcial</span>' +
    '<span><i class="punto" style="background:#2563eb"></i>tuyo</span>' +
    '<span><i class="punto" style="background:#e2e8f0;border:2px dashed #94a3b8"></i>ocupada</span>' +
    '</div>';
  if (!enCurso) {
    if (!delDia) {
      h += '<p class="mini mapa-aviso">Inicia tu jornada para tomar pallets.</p>';
    } else if (delDia.enPausa) {
      h += '<p class="mini mapa-aviso">Estás en pausa — reanuda para tomar pallets.</p>';
    } else {
      h += '<p class="mini mapa-aviso">Jornada terminada — reanuda para seguir.</p>';
    }
  } else if (tomado) {
    h += '<p class="mini mapa-aviso">Finaliza o suelta tu pallet actual para tomar otro.</p>';
  }

  // Viewport con pan & zoom (Panzoom) para recorrer el almacén grande
  h += '<div class="mapamovil-viewport" id="mapamovil-viewport">' +
    '<div class="mapa-herramientas mapa-herramientas-movil">' +
    '<button class="btn" title="Acercar" onclick="mapaMovilZoomIn()">＋</button>' +
    '<button class="btn" title="Alejar" onclick="mapaMovilZoomOut()">−</button>' +
    '<button class="btn btn-restablecer" title="Restablecer vista" onclick="mapaMovilReset()">Restablecer</button>' +
    '</div>' +
    '<div class="mapamovil-ayuda">Arrastra para mover · pellizca para acercar</div>' +
    '<div class="mapamovil-lienzo" id="mapamovil-lienzo">' +
    mapaAlmacenSketch(function (pos) { return segPosicionMapa(t, pos); }) +
    '</div></div></div>';
  return h;
}

/* Segmento de una posición dentro de la barra de la bahía */
function segPosicionMapa(t, pos) {
  if (!pos) return '';
  const est = estadoPosicionPara(t.id, pos);
  if (est === 'INACTIVA') return '<div class="mapa-seg mapa-seg--hueco"></div>';
  let cls = '', estilo = '', titulo = pos.codigo, contenido = pos.codigo, tap = '';
  if (est === 'DISPONIBLE') {
    cls = 'mapa-seg--libre';
    titulo = pos.codigo + ' · disponible · toca para tomar';
    tap = 'tapPosicion(\'' + pos.id + '\')';
  } else if (est === 'PARCIAL') {
    const p = getPallet(pos.palletId);
    cls = 'mapa-seg--parcial mapa-seg--encurso';
    contenido = 'en curso';
    titulo = pos.codigo + ' · ' + p.id + ' en curso (' + p.cajasTotales + ' cajas · ' + resumenConteo(p) + ') · toca para retomar';
    tap = 'tapPosicion(\'' + pos.id + '\')';
  } else if (est === 'PROPIA') {
    const p = getPallet(pos.palletId);
    cls = 'mapa-seg--propia mapa-seg--encurso';
    contenido = 'en curso';
    titulo = pos.codigo + ' · tu pallet actual (' + p.cajasTotales + ' cajas · ' + resumenConteo(p) + ') · toca para continuar';
    tap = 'tapPosicion(\'' + pos.id + '\')';
  } else if (est === 'OTRO') {
    const p = getPallet(pos.palletId);
    cls = 'mapa-seg--otro';
    titulo = pos.codigo + ' · en curso por ' + nombreTrabajador(p.clasificadoPor);
  } else { // CLASIFICADA: se dibuja con el color de su estado, sin tap
    const p = getPallet(pos.palletId);
    cls = 'mapa-seg--hecha';
    estilo = 'background:' + ESTADO_PALLET[p.estado].color + ';border-color:' + ESTADO_PALLET[p.estado].color;
    titulo = pos.codigo + ' · ' + p.id + ' · ' + ESTADO_PALLET[p.estado].label +
      (p.estado === 'LISTO' ? ' · certificado (esperando despacho)' : '');
  }
  const onclick = tap ? ' onclick="' + tap + '"' : '';
  return '<div class="mapa-seg ' + cls + '" style="' + estilo + '" title="' + esc(titulo) + '"' + onclick + '>' + esc(contenido) + '</div>';
}

/* Tap sobre un segmento del mapa: continuar el propio, tomar disponible/parcial
 * (las reglas de jornada y de un-pallet-a-la-za las valida tomarPallet), o
 * ignorar si no es tappable. */
function tapPosicion(posicionId) {
  const t = yo();
  if (!t) return;
  const pos = getPosicion(posicionId);
  if (!pos) return;
  const est = estadoPosicionPara(t.id, pos);
  if (est === 'PROPIA') { continuarClasificacion(); return; }
  if (est !== 'DISPONIBLE' && est !== 'PARCIAL') return;
  const res = tomarPallet(t.id, posicionId);
  if (res.error) { alert(res.error); return; }
  iniciarConteo(posicionId);
}
function continuarClasificacion() {
  const tomado = palletTomadoPor(STATE.sesion.trabajadorId);
  if (tomado) iniciarConteo(tomado.posicionId);
}
function soltarPalletActual() {
  const tomado = palletTomadoPor(STATE.sesion.trabajadorId);
  if (!tomado) return;
  if (!confirm('¿Soltar el pallet ' + tomado.id + '? Otro clasificador podrá tomarlo; tu avance parcial se conserva.')) return;
  soltarPallet(STATE.sesion.trabajadorId, tomado.id);
}

/* Jornada con pausas: los botones de la tarjeta delegan en las reglas. */
function pausarJornadaUI() {
  const res = pausarJornada(STATE.sesion.trabajadorId);
  if (res.error) alert(res.error);
}
function reanudarJornadaUI() {
  const res = reanudarJornada(STATE.sesion.trabajadorId);
  if (res.error) alert(res.error);
}
function terminarJornadaUI() {
  if (!confirm('¿Terminar tu jornada de hoy? El cierre queda registrado con hora; puedes reanudar si sigues trabajando.')) return;
  const res = terminarJornada(STATE.sesion.trabajadorId);
  if (res.error) alert(res.error);
}

/* Temporizador de la tarjeta de jornada: solo corre mientras la jornada
 * está en curso (segmento abierto); se detiene solo al pausar/terminar. */
function activarTimerJornada() {
  const t = yo();
  if (!t || !jornadaEnCursoDe(t.id)) return;
  const handle = setInterval(() => {
    const el = document.getElementById('t-jornada');
    const tt = yo();
    if (!el || !tt || !jornadaEnCursoDe(tt.id)) {
      clearInterval(handle); return;
    }
    el.textContent = fmtDur(minutosActivos(jornadaEnCursoDe(tt.id)) * 60000);
  }, 1000);
  if (handle && handle.unref) handle.unref(); // no mantener vivo el proceso en Node
}

/* Abre la pantalla de conteo del pallet EN_PROCESO de la posición. En el
 * modelo self-service el pallet ya existe y es del trabajador (lo garantiza
 * tomarPallet / Continuar clasificación). */
function iniciarConteo(posicionId) {
  const pos = getPosicion(posicionId);
  if (!pos || !pos.palletId) { irA('home'); return; }
  const pallet = getPallet(pos.palletId);
  if (!pallet || pallet.estado !== 'EN_PROCESO') { irA('home'); return; }
  UI.conteo = {
    palletId: pallet.id,
    cajasTotales: pallet.cajasTotales || REGLAS.CAJAS_POR_PALLET,
    editandoOtro: false,
    cats: Object.assign(conteoVacio(), pallet.conteo),
    inicioTs: Date.now(),
  };
  irA('conteo');
}

/* --- Pantalla 4: Conteo (temporizador + total rápido + tipo de caja +
 * 6 contadores de defectos). El clasificador NO cuenta caja por caja:
 * confirma el total con valores rápidos, indica el tipo de caja y solo
 * registra lo que encuentra; las sanas salen por descarte. */
function pConteo() {
  const c = UI.conteo;
  if (!c) { irA('home'); return ''; }
  const pallet = getPallet(c.palletId);
  if (!pallet) { irA('home'); return ''; }

  let h = '<div class="appbar"><button class="appbar-atras" onclick="salirConteo()">‹ Guardar</button>' +
    '<span class="appbar-titulo">' + pallet.id + '</span></div>';
  h += '<p class="mini muted" style="margin:0 0 8px">' + ubicacionPallet(pallet) + '</p>';
  h += '<div class="timer-caja">Tiempo <span id="t-contador">00:00</span></div>';

  // Total de cajas del pallet: valores rápidos (default 84 completo)
  const presets = [REGLAS.CAJAS_POR_PALLET, 64, 48];
  const esPreset = presets.indexOf(c.cajasTotales) !== -1;
  const otroVisible = c.editandoOtro || !esPreset;
  h += '<div class="tarjeta-movil"><h3>Total de cajas del pallet</h3>' +
    '<div class="chips-total">';
  presets.forEach(n => {
    h += '<button class="chip-total' + (c.cajasTotales === n && !c.editandoOtro ? ' activo' : '') +
      '" onclick="elegirTotalCajas(' + n + ')">' + (n === REGLAS.CAJAS_POR_PALLET ? n + ' · completo' : n) + '</button>';
  });
  h += '<button class="chip-total' + (otroVisible ? ' activo' : '') + '" onclick="elegirTotalOtro()">Otro</button>';
  h += '</div>';
  if (otroVisible) {
    h += '<input type="number" id="input-total-otro" class="input-total-otro" min="1" max="' +
      REGLAS.MAX_CAJAS_PALLET + '" value="' + c.cajasTotales + '" onchange="fijarTotalOtro(this.value)">';
  }
  h += '<p class="mini muted" style="margin:8px 0 0">' + c.cajasTotales + ' cajas · ' +
    fmtMiles(botellasRevisadas(pallet)) + ' botellas (' + tipoCajaDe(pallet).nombre + ')</p>';
  h += '</div>';

  // Tipo de caja (catálogo): define las botellas por caja del pallet
  h += '<div class="tarjeta-movil"><h3>Tipo de caja</h3><div class="chips-total">';
  TIPOS_CAJA.forEach(t => {
    h += '<button class="chip-total' + (pallet.tipoCaja === t.id ? ' activo' : '') +
      '" onclick="elegirTipoCaja(\'' + t.id + '\')">' + t.nombre + '</button>';
  });
  h += '</div></div>';

  // 6 contadores de defectos en BOTELLAS + sanas por descarte (solo lectura)
  const totalBot = botellasRevisadas(pallet);
  const defectos = CATEGORIAS.reduce((s, cat) => s + (c.cats[cat.id] || 0), 0);
  const sanas = Math.max(0, totalBot - defectos);
  const avisoCompleto = sanas <= 0 && defectos > 0;
  h += '<div class="tarjeta-movil"><h3>Lo que encuentras (botellas)</h3>' +
    '<p class="mini muted" style="margin:0 0 6px">Registra lo que encuentras, botella por botella; el total del pallet ya está definido arriba.</p>' +
    '<p class="mini san-descarte' + (avisoCompleto ? ' san-descarte--alerta' : '') + '" id="san-linea">' +
    'Sanas por descarte: <strong id="san-descarte">' + fmtMiles(sanas) + '</strong> botellas' +
    '<span id="san-nota">' + (avisoCompleto ? ' — todas las registradas son defectuosas, ¿revisar?' : '') + '</span></p>';
  CATEGORIAS.forEach(cat => {
    h += '<div class="fila-categoria"><div class="cat-nombre">' + cat.nombre +
      '<span class="cat-detalle">' + cat.detalle + '</span></div>' +
      '<button class="btn-contador" id="cat-menos-' + cat.id + '" ' + (c.cats[cat.id] <= 0 ? 'disabled' : '') +
      ' onclick="ajustarCat(\'' + cat.id + '\',-1)">−</button>' +
      '<span class="cat-valor" id="cat-' + cat.id + '">' + c.cats[cat.id] + '</span>' +
      '<button class="btn-contador" id="cat-mas-' + cat.id + '" ' + (c.cats[cat.id] >= totalBot ? 'disabled' : '') +
      ' onclick="ajustarCat(\'' + cat.id + '\',1)">+</button></div>';
  });
  h += '</div>';

  h += '<div class="tarjeta-movil">' +
    '<button class="btn btn-ok" style="width:100%" onclick="finalizarConteo()">Terminar pallet</button>' +
    '<p class="mini muted" style="text-align:center;margin-top:6px">Queda CLASIFICADO con ' + c.cajasTotales +
    ' cajas · ' + fmtMiles(botellasRevisadas(pallet)) + ' botellas y tu jornada queda registrada.</p>' +
    '</div>';
  return h;
}

function activarTimer() {
  if (!UI.conteo) return;
  const handle = setInterval(() => {
    const el = document.getElementById('t-contador');
    if (!el || !UI.conteo) { clearInterval(handle); return; }
    el.textContent = fmtDur(Date.now() - UI.conteo.inicioTs);
  }, 500);
  if (handle && handle.unref) handle.unref(); // no mantener vivo el proceso en Node
}

/* Contadores en BOTELLAS. Tope por contador: ninguno supera el total de
 * botellas del pallet (el + se deshabilita al llegar). La línea de sanas por
 * descarte se recalcula en vivo; si la suma agota el total, queda en aviso
 * naranja (no bloquea terminar). */
function ajustarCat(catId, delta) {
  const c = UI.conteo;
  if (!c) return;
  const pallet = getPallet(c.palletId);
  const totalBot = pallet ? botellasRevisadas(pallet) : REGLAS.BOTELLAS_POR_PALLET;
  const nuevo = (c.cats[catId] || 0) + delta;
  if (delta > 0 && nuevo > totalBot) return; // tope: el + ya viene deshabilitado
  c.cats[catId] = Math.max(0, nuevo);
  const elCat = document.getElementById('cat-' + catId);
  if (elCat) elCat.textContent = c.cats[catId];
  const btnMas = document.getElementById('cat-mas-' + catId);
  if (btnMas) btnMas.disabled = c.cats[catId] >= totalBot;
  const btnMenos = document.getElementById('cat-menos-' + catId);
  if (btnMenos) btnMenos.disabled = c.cats[catId] <= 0;
  actualizarSanDescarte();
}
function actualizarSanDescarte() {
  const c = UI.conteo;
  if (!c) return;
  const pallet = getPallet(c.palletId);
  const totalBot = pallet ? botellasRevisadas(pallet) : REGLAS.BOTELLAS_POR_PALLET;
  const defectos = CATEGORIAS.reduce((s, cat) => s + (c.cats[cat.id] || 0), 0);
  const sanas = Math.max(0, totalBot - defectos);
  const el = document.getElementById('san-descarte');
  if (el) el.textContent = fmtMiles(sanas);
  const linea = document.getElementById('san-linea');
  if (linea) linea.classList.toggle('san-descarte--alerta', sanas <= 0 && defectos > 0);
  const nota = document.getElementById('san-nota');
  if (nota) nota.textContent = (sanas <= 0 && defectos > 0) ? ' — todas las registradas son defectuosas, ¿revisar?' : '';
}

/* Total de cajas con valores rápidos: chips 84/64/48 y "Otro" con input.
 * El total queda en el pallet (definirTotalCajas valida dueño/estado/rango). */
function elegirTotalCajas(n) {
  const c = UI.conteo;
  if (!c) return;
  const previo = c.cajasTotales;
  c.cajasTotales = parseInt(n, 10) || previo;
  c.editandoOtro = false;
  const res = definirTotalCajas(STATE.sesion.trabajadorId, c.palletId, c.cajasTotales);
  if (res.error) { c.cajasTotales = previo; alert(res.error); render(); }
}
function elegirTotalOtro() {
  const c = UI.conteo;
  if (!c) return;
  c.editandoOtro = true;
  render();
}
/* Tipo de caja: chips Cerveza / Litro (catálogo TIPOS_CAJA). La regla
 * valida dueño y estado; al cambiar, botellasRevisadas usa el catálogo. */
function elegirTipoCaja(tipoId) {
  const c = UI.conteo;
  if (!c) return;
  const res = definirTipoCaja(STATE.sesion.trabajadorId, c.palletId, tipoId);
  if (res.error) alert(res.error);
}
function fijarTotalOtro(valor) {
  const c = UI.conteo;
  if (!c) return;
  const previo = c.cajasTotales;
  c.cajasTotales = parseInt(valor, 10);
  c.editandoOtro = true;
  const res = definirTotalCajas(STATE.sesion.trabajadorId, c.palletId, c.cajasTotales);
  if (res.error) { c.cajasTotales = previo; alert(res.error); render(); }
}

function salirConteo() {
  const c = UI.conteo;
  if (c) guardarConteoParcial(c.palletId, c.cats); // guarda hallazgos y vuelve al home
  UI.conteo = null;
  irA('home');
}
function finalizarConteo() {
  const c = UI.conteo;
  if (!c) return;
  const palletId = c.palletId;
  const total = c.cajasTotales;
  UI.conteo = null;
  finalizarPallet(palletId, c.cats); // CLASIFICADO + clasificadoPor + jornada
  alert('Pallet ' + palletId + ' clasificado (' + total + ' cajas). ¡Buen trabajo!');
  irA('home');
}

/* --- Pantalla 5: Muestrear (mis asignaciones de 2–3 pallets) --- */
function pMuestrear() {
  const t = yo();
  let h = '<div class="appbar"><button class="appbar-atras" onclick="irA(\'home\')">‹</button>' +
    '<span class="appbar-titulo">Muestrear</span></div>';

  const asgs = asignacionesDeMuestreador(t.id).filter(a => a.estado !== 'COMPLETADA');
  if (!asgs.length) {
    h += '<div class="tarjeta-movil"><h3>Sin asignaciones pendientes</h3>' +
      '<p class="muted mini">El administrador te asignará un muestreo de 2 a 3 pallets clasificados.</p></div>';
    return h;
  }
  asgs.forEach(a => {
    const pendientes = a.palletIds.filter(pid => { const p = getPallet(pid); return p && p.estado === 'CLASIFICADO'; }).length;
    h += '<div class="tarjeta-movil"><h3>' + a.id + ' · ' + a.cantidad + ' pallets</h3>' +
      '<p class="mini muted">Clasificador auditado: <strong>' + esc(nombreTrabajador(a.clasificadorId)) + '</strong> · asignada ' + fmtHace(a.creadaTs) + '</p>';
    a.palletIds.forEach(pid => {
      const p = getPallet(pid);
      if (!p) return;
      h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0">' +
        pid + ' · ' + ubicacionPallet(p) + ' ' +
        (p.estado === 'CLASIFICADO' ? '<span class="chip" style="background:#16a34a">Por revisar</span>' : chipEstadoPallet(p.estado)) + '</p>';
    });
    h += '<button class="btn btn-primario" style="width:100%;margin-top:8px" ' +
      (pendientes ? '' : 'disabled') + ' onclick="abrirAsignacion(\'' + a.id + '\')">' +
      (pendientes ? 'Realizar muestreo (' + pendientes + ' pendiente' + (pendientes > 1 ? 's' : '') + ')' : 'Sin pallets pendientes') + '</button>';
    h += '</div>';
  });
  return h;
}

function abrirAsignacion(id) {
  UI.asignacionVer = id;
  irA('muestreo-detalle');
}

/* Detalle de asignación: registrar botellas MBFU por pallet, % en vivo */
function pMuestreoDetalle() {
  const a = getAsignacion(UI.asignacionVer);
  if (!a) { irA('muestrear'); return ''; }
  let h = '<div class="appbar"><button class="appbar-atras" onclick="irA(\'muestrear\')">‹</button>' +
    '<span class="appbar-titulo">' + a.id + '</span></div>';
  h += '<p class="mini muted" style="margin:0 0 10px">Revisa cada pallet completo. Las botellas revisadas son las ' +
    '<strong>reales del pallet</strong> (total de cajas × 12). Si el MBFU% llega a ' +
    REGLAS.UMBRAL_MBFU.toFixed(2) + '% o más, el pallet queda <strong>en alerta</strong> para decisión del administrador.</p>';

  a.palletIds.forEach(pid => {
    const p = getPallet(pid);
    if (!p) return;
    const revisadas = botellasRevisadas(p); // = cajasTotales del pallet × 12
    h += '<div class="tarjeta-movil"><h3>' + pid + '</h3>' +
      '<p class="mini muted">' + ubicacionPallet(p) + ' · clasificado por ' + esc(nombreTrabajador(p.clasificadoPor)) +
      ' · ' + p.cajasTotales + ' cajas</p>';
    if (p.estado === 'CLASIFICADO') {
      h += '<div class="campo" style="margin-top:6px"><label>Botellas MBFU encontradas (de ' + revisadas + ' revisadas)</label>' +
        '<input type="number" id="mbfu-' + pid + '" min="0" max="' + revisadas +
        '" value="0" oninput="actualizarPct(\'' + pid + '\', this.value)"></div>' +
        '<p class="mini">MBFU%: <strong id="pct-' + pid + '" class="cifra-ok">0.00%</strong> ' +
        '<span id="alerta-' + pid + '" style="display:none">' + chipAlerta() + '</span></p>' +
        '<button class="btn btn-primario" style="width:100%" onclick="enviarResultado(\'' + a.id + '\',\'' + pid + '\')">Enviar resultado</button>';
    } else {
      h += '<p class="mini" style="display:flex;gap:6px;align-items:center">Resultado: <strong class="' +
        (p.muestreo && p.muestreo.alerta ? 'cifra-alerta' : 'cifra-ok') + '">' +
        fmtPct(p.muestreo ? p.muestreo.pct : 0) + '</strong> ' + chipEstadoPallet(p.estado) +
        (p.muestreo && p.muestreo.alerta ? ' ' + chipAlerta() : '') + '</p>';
    }
    h += '</div>';
  });
  return h;
}

/* % calculado en vivo mientras se teclea (sin re-render) */
function actualizarPct(pid, valor) {
  const p = getPallet(pid);
  const revisadas = p ? botellasRevisadas(p) : REGLAS.BOTELLAS_POR_PALLET;
  const n = Math.max(0, Math.min(revisadas, parseInt(valor, 10) || 0));
  const pct = pctMBFU(n, revisadas);
  const elPct = document.getElementById('pct-' + pid);
  const elAlerta = document.getElementById('alerta-' + pid);
  if (!elPct || !elAlerta) return;
  elPct.textContent = fmtPct(pct);
  const alerta = pct >= REGLAS.UMBRAL_MBFU;
  elPct.className = alerta ? 'cifra-alerta' : 'cifra-ok';
  elAlerta.style.display = alerta ? 'inline' : 'none';
}

function enviarResultado(asignacionId, pid) {
  const input = document.getElementById('mbfu-' + pid);
  const res = registrarMuestreo(pid, input.value, asignacionId);
  if (res.error) { alert(res.error); return; }
  if (res.alerta) {
    const p = getPallet(pid);
    const revisadas = p ? botellasRevisadas(p) : REGLAS.BOTELLAS_POR_PALLET;
    alert('Pallet ' + pid + ': ' + fmtPct(pctMBFU(parseInt(input.value, 10) || 0, revisadas)) +
      ' — queda EN ALERTA. El administrador decidirá si deja pasar o re-clasifica la jornada.');
  }
}

/* Texto de los segmentos de una jornada: "08:02–12:10 · 13:05–en curso" */
function textoSegmentos(jornada) {
  return jornada.segmentos.map(s =>
    fmtHora(s.inicioTs) + '–' + (s.finTs === null ? 'en curso' : fmtHora(s.finTs))).join(' · ');
}

/* --- Pantalla 6: Historial (jornadas + muestreos del trabajador) --- */
function pHistorial() {
  const t = yo();
  let h = '<div class="appbar"><button class="appbar-atras" onclick="irA(\'home\')">‹</button>' +
    '<span class="appbar-titulo">Historial</span></div>';

  const misJornadas = STATE.jornadas.filter(j => j.trabajadorId === t.id)
    .sort((a, b) => inicioJornada(b) - inicioJornada(a));
  h += '<div class="tarjeta-movil"><h3>Mis jornadas y clasificaciones</h3>';
  if (!misJornadas.length) h += '<p class="muted mini">Aún no tienes jornadas.</p>';
  misJornadas.forEach(j => {
    const pallets = STATE.pallets.filter(p => p.jornadaId === j.id);
    const cajas = pallets.reduce((s, p) => s + p.cajasTotales, 0);
    h += '<div style="border-top:1px solid var(--borde);padding:8px 0">' +
      '<strong>' + j.fechaLabel + '</strong> · ' + textoSegmentos(j) +
      (j.terminada ? ' · terminada' : j.enPausa ? ' · en pausa' : '') +
      ' · <span class="mini muted">' + fmtDur(minutosActivos(j) * 60000) + ' activas · ' +
      cajas + ' cajas · ' + pallets.length + ' pallet(s)</span>';
    pallets.forEach(p => {
      h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 0 8px">' +
        p.id + ' · ' + ubicacionPallet(p) + ' · ' + p.cajasTotales + ' cajas · ' +
        fmtMiles(botellasRevisadas(p)) + ' botellas · ' + resumenConteo(p) + ' ' +
        chipEstadoPallet(p.estado) + '</p>';
    });
    h += '</div>';
  });
  h += '</div>';

  const misMuestreos = asignacionesDeMuestreador(t.id);
  h += '<div class="tarjeta-movil"><h3>Mis muestreos</h3>';
  if (!misMuestreos.length) {
    h += '<p class="muted mini">No tienes muestreos registrados.</p>';
  }
  misMuestreos.forEach(a => {
    h += '<div style="border-top:1px solid var(--borde);padding:8px 0">' +
      '<strong>' + a.id + '</strong> · ' + a.fechaLabel || '';
    h += '<span class="mini muted"> · auditando a ' + esc(nombreTrabajador(a.clasificadorId)) + '</span>';
    a.palletIds.forEach(pid => {
      const p = getPallet(pid);
      if (!p || !p.muestreo) return;
      h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 0 8px">' +
        pid + ' · <strong class="' + (p.muestreo.alerta ? 'cifra-alerta' : 'cifra-ok') + '">' +
        fmtPct(p.muestreo.pct) + '</strong> (' + p.muestreo.botellas + ' botellas) ' +
        chipEstadoPallet(p.estado) + (p.muestreo.alerta ? ' ' + chipAlerta() : '') + '</p>';
    });
    h += '</div>';
  });
  h += '</div>';
  return h;
}

/* ============================ VISTA CONDUCTOR ============================ */
function yoConductor() {
  const c = STATE.sesion.conductorId ? getConductor(STATE.sesion.conductorId) : null;
  if (!c || !c.activo) { STATE.sesion.conductorId = null; return null; }
  return c;
}
function irConductor(pantalla) {
  UI.pantallaConductor = pantalla;
  render();
}

function renderConductor() {
  const cont = document.getElementById('pantalla-conductor');
  if (UI.pantallaConductor !== 'login' && !yoConductor()) UI.pantallaConductor = 'login';
  // El pan/zoom del mapa solo vive en el home; al salir se destruye.
  if (UI.pantallaConductor !== 'home') destruirMapaCondPanzoom();
  switch (UI.pantallaConductor) {
    case 'home': cont.innerHTML = cHome(); inicializarMapaCondPanzoom(); break;
    case 'cargues': cont.innerHTML = cCargues(); break;
    default: cont.innerHTML = cLogin();
  }
}

function cLogin() {
  let h = '<div class="appbar"><span class="appbar-titulo">Sorty · Conductor</span></div>';
  h += '<div class="tarjeta-movil"><h3>¿Quién conduce?</h3>' +
    '<p class="muted mini">Selecciona tu nombre para entrar. Demo sin contraseña.</p></div>';
  h += '<div class="lista-opciones">';
  conductoresActivos().forEach(c => {
    h += '<button class="opcion-trabajador" onclick="loginConductor(\'' + c.id + '\');irConductor(\'home\')">' + esc(c.nombre) + '</button>';
  });
  h += '</div>';
  return h;
}

/* Home del conductor = MAPA del almacén (misma estética dibujada que el
 * clasificador, con pan & zoom): los segmentos LISTO son tappables para
 * seleccionar los que va el trailer; lo demás es inerte. Pensado para decenas
 * de pallets LISTO: sobre el mapa se tocan los justos. Solo ve QUÉ retirar
 * (posición, cajas, clasificador) — nada de conteos ni MBFU (Q4.2). */
function cHome() {
  const c = yoConductor();
  const listos = palletsListos();
  const sel = UI.despSel || {};
  let h = '<div class="appbar"><span class="appbar-titulo">Hola, ' + esc(c.nombre.split(' ')[0]) + '</span>' +
    '<button class="appbar-atras" onclick="logoutConductor()">Salir</button></div>';
  h += '<div class="tarjeta-movil"><h3>Pallets LISTO para despacho</h3>' +
    '<p class="mini muted"><strong>' + listos.length + '</strong> listo(s) para despacho · toca los segmentos teal sobre el mapa. ' +
    'Al despachar, las posiciones quedan libres al instante.</p></div>';
  if (!listos.length) {
    h += '<div class="tarjeta-movil"><p class="muted mini">Nada por despachar por ahora. Los pallets aparecen aquí cuando una tanda certifica el lote (LISTO).</p></div>';
  }
  h += '<div class="mini mapa-leyenda" style="margin-bottom:8px">' +
    '<span><i class="punto" style="background:' + ESTADO_PALLET.LISTO.color + '"></i>listo para despacho · toca para seleccionar</span>' +
    '</div>';

  // Chips de seleccionados (removibles)
  const idsSel0 = Object.keys(sel).filter(pid => sel[pid]);
  h += '<div class="chips-sel" id="chips-sel">' + idsSel0.map(chipSelHtml).join('') + '</div>';

  // Mapa con pan & zoom (mismo núcleo que el trabajador)
  h += '<div class="mapamovil-viewport" id="condmapa-viewport">' +
    '<div class="mapa-herramientas mapa-herramientas-movil">' +
    '<button class="btn" title="Acercar" onclick="mapaCondZoomIn()">＋</button>' +
    '<button class="btn" title="Alejar" onclick="mapaCondZoomOut()">−</button>' +
    '<button class="btn btn-restablecer" title="Restablecer vista" onclick="mapaCondReset()">Restablecer</button>' +
    '</div>' +
    '<div class="mapamovil-ayuda">Arrastra para mover · pellizca para acercar</div>' +
    '<div class="mapamovil-lienzo" id="condmapa-lienzo">' +
    mapaAlmacenSketch(segConductor) +
    '</div></div>';

  // Barra inferior fija: resumen de selección + despacho en lote
  const cajasSel = idsSel0.reduce((s, pid) => { const p = getPallet(pid); return s + (p ? p.cajasTotales : 0); }, 0);
  h += '<div class="barra-despacho" id="barra-despacho">' +
    '<span class="mini" id="desp-resumen">' + idsSel0.length + ' seleccionados · ' + fmtMiles(cajasSel) + ' cajas</span>' +
    '<button class="btn btn-ok btn-despachar" id="btn-despachar" ' + (idsSel0.length ? '' : 'disabled') +
    ' onclick="despacharSeleccionados()">Despachar ' + idsSel0.length + '</button></div>';
  h += '<div class="menu-grid">' +
    '<div class="menu-item" onclick="irConductor(\'cargues\')"><span class="menu-num">≡</span>Mis cargues</div>' +
    '</div>';
  return h;
}

/* Segmento del mapa del conductor: LISTO = teal tappable; lo demás inerte. */
function segConductor(pos) {
  if (!pos) return '';
  if (!pos.activa) return '<div class="mapa-seg mapa-seg--hueco"></div>';
  const p = pos.palletId ? getPallet(pos.palletId) : null;
  if (!p) return '<div class="mapa-seg mapa-seg--libre-cond" title="' + pos.codigo + ' · libre"></div>';
  if (p.estado !== 'LISTO') {
    return '<div class="mapa-seg mapa-seg--inerte" title="' + pos.codigo + ' · ocupado (aún no listo)"></div>';
  }
  const sel = UI.despSel && UI.despSel[p.id];
  const titulo = pos.codigo + ' · ' + p.id + ' · ' + p.cajasTotales + ' cajas · clasif. ' +
    nombreTrabajador(p.clasificadoPor) + ' · toca para ' + (sel ? 'quitar' : 'seleccionar');
  return '<div class="mapa-seg mapa-seg--listo' + (sel ? ' mapa-seg--seleccionado' : '') + '" ' +
    'id="cond-seg-' + pos.id + '" title="' + esc(titulo) + '" ' +
    'onclick="tapSegConductor(\'' + pos.id + '\')">' + esc(pos.codigo + (sel ? ' ✓' : '')) + '</div>';
}

/* Tap en un segmento LISTO: alterna la selección actualizando SOLO las clases
 * del segmento y la barra (sin re-render del mapa: se conserva pan/zoom/scroll).
 * El tap en cualquier otra cosa se ignora. */
function tapSegConductor(posicionId) {
  const pos = getPosicion(posicionId);
  if (!pos || !pos.palletId) return;
  const p = getPallet(pos.palletId);
  if (!p || p.estado !== 'LISTO') return;
  UI.despSel = UI.despSel || {};
  if (UI.despSel[p.id]) delete UI.despSel[p.id];
  else UI.despSel[p.id] = true;
  const marcado = !!UI.despSel[p.id];
  const seg = document.getElementById('cond-seg-' + posicionId);
  if (seg) {
    seg.classList.toggle('mapa-seg--seleccionado', marcado);
    seg.innerHTML = esc(pos.codigo + (marcado ? ' ✓' : ''));
  }
  actualizarBarraDespacho();
  actualizarChipsSel();
}

/* Chips de seleccionados (removibles) encima de la barra */
function chipSelHtml(pid) {
  const p = getPallet(pid);
  const pos = p ? getPosicion(p.posicionId) : null;
  return '<button class="chip-sel" onclick="quitarSelDesp(\'' + pid + '\')">' +
    (pos ? pos.codigo : '?') + ' · ' + pid + ' ✕</button>';
}
function actualizarChipsSel() {
  const cont = document.getElementById('chips-sel');
  if (!cont) return;
  const sel = UI.despSel || {};
  const ids = Object.keys(sel).filter(pid => sel[pid]);
  cont.innerHTML = ids.map(chipSelHtml).join('');
}
function quitarSelDesp(pid) {
  UI.despSel = UI.despSel || {};
  delete UI.despSel[pid];
  const p = getPallet(pid);
  if (p) {
    const seg = document.getElementById('cond-seg-' + p.posicionId);
    if (seg) {
      seg.classList.remove('mapa-seg--seleccionado');
      const pos = getPosicion(p.posicionId);
      seg.innerHTML = esc(pos.codigo);
    }
  }
  actualizarBarraDespacho();
  actualizarChipsSel();
}

function actualizarBarraDespacho() {
  const sel = UI.despSel || {};
  const idsSel = Object.keys(sel).filter(pid => sel[pid]);
  const cajasSel = idsSel.reduce((s, pid) => { const p = getPallet(pid); return s + (p ? p.cajasTotales : 0); }, 0);
  const resumen = document.getElementById('desp-resumen');
  if (resumen) resumen.textContent = idsSel.length + ' seleccionados · ' + fmtMiles(cajasSel) + ' cajas';
  const btn = document.getElementById('btn-despachar');
  if (btn) {
    btn.disabled = idsSel.length === 0;
    btn.textContent = 'Despachar ' + idsSel.length;
  }
}
function despacharSeleccionados() {
  const sel = UI.despSel || {};
  const idsSel = Object.keys(sel).filter(pid => sel[pid]);
  if (!idsSel.length) return;
  const cajasSel = idsSel.reduce((s, pid) => { const p = getPallet(pid); return s + (p ? p.cajasTotales : 0); }, 0);
  if (!confirm('¿Despachar ' + idsSel.length + ' pallets (' + fmtMiles(cajasSel) + ' cajas)?\n' +
    idsSel.join(', ') + '\nLas posiciones quedan libres al instante.')) return;
  const ids = idsSel.slice();
  UI.despSel = {}; // limpiar antes: el render de despacharPallets ya dibuja la barra vacía
  const res = despacharPallets(STATE.sesion.conductorId, ids);
  if (res.error) { alert(res.error); return; }
  alert(res.cantidad + ' pallets despachados. ¡A por el siguiente!');
}

/* Mis cargues: historial de lo que este conductor despachó (hora, pallet, ubicación) */
function cCargues() {
  const c = yoConductor();
  const cargues = carguesDe(c.id);
  let h = '<div class="appbar"><button class="appbar-atras" onclick="irConductor(\'home\')">‹</button>' +
    '<span class="appbar-titulo">Mis cargues</span></div>';
  h += '<div class="tarjeta-movil"><h3>Historial de despachos</h3>';
  if (!cargues.length) {
    h += '<p class="muted mini">Aún no has despachado pallets. Los que retires aparecerán aquí con su hora.</p>';
  }
  cargues.forEach(p => {
    h += '<div class="fila-disponible">' +
      '<div class="mini"><strong>' + p.id + '</strong> · ' + ubicacionPallet(p) + '<br>' +
      '<span class="muted">' + p.cajasTotales + ' cajas · ' + tipoCajaDe(p).nombre +
      ' · a las ' + fmtHora(p.despachadoTs) + ' · clasif. ' + esc(nombreTrabajador(p.clasificadoPor)) + '</span></div>' +
      '<span class="chip" style="background:' + ESTADO_PALLET.DESPACHADO.color + '">' + ESTADO_PALLET.DESPACHADO.label + '</span></div>';
  });
  h += '</div>';
  return h;
}

/* ============================ VISTA ADMINISTRADOR ============================ */

function cambiarTab(tab) {
  UI.tab = tab;
  render();
}

function renderAdmin() {
  const nAlertas = alertasPendientes().length;
  const tabs = [
    ['bi', 'BI en vivo'],
    ['mapa', 'Mapa interactivo'],
    ['muestreo', 'Asignar muestreo'],
    ['decisiones', 'Decisiones de muestreo' + (nAlertas ? ' (' + nAlertas + ')' : '')],
    ['trabajadores', 'Trabajadores'],
  ];
  let nav = '';
  tabs.forEach(pair => {
    nav += '<button class="' + (UI.tab === pair[0] ? 'activa' : '') + '" onclick="cambiarTab(\'' + pair[0] + '\')">' + pair[1] + '</button>';
  });
  document.getElementById('pestanas-admin').innerHTML = nav;

  const cont = document.getElementById('contenido-admin');
  switch (UI.tab) {
    case 'bi': cont.innerHTML = aBI(); break;
    case 'mapa': cont.innerHTML = aMapa(); break;
    case 'muestreo': cont.innerHTML = aAsignarMuestreo(); break;
    case 'decisiones': cont.innerHTML = aDecisiones(); break;
    case 'trabajadores': cont.innerHTML = aTrabajadores(); break;
    default: cont.innerHTML = aBI();
  }
  // El pan/zoom del mapa se (re)inicializa tras cada render de ese tab y se
  // destruye al salir de él (el zoom se resetea al cambiar de tab: aceptable).
  if (UI.tab === 'mapa') inicializarMapaPanzoom(); else destruirMapaPanzoom();
}

/* --- Tab 1: BI en vivo --- */
function aBI() {
  // Contadores de despacho en vivo
  const desp = contadoresDespacho();
  let h = '<div class="seccion"><h2>Despacho en vivo</h2><div class="reticula reticula-3">' +
    '<div class="tarjeta"><h3>Listos para despacho</h3>' +
    '<p><span class="cifra-grande" style="color:' + ESTADO_PALLET.LISTO.color + '">' + desp.listos + '</span>' +
    ' <span class="mini muted">pallets certificados (LISTO) esperando al Conductor</span></p></div>' +
    '<div class="tarjeta"><h3>Despachados hoy</h3>' +
    '<p><span class="cifra-grande">' + desp.despachadosHoy + '</span>' +
    ' <span class="mini muted">pallets que salieron del almacén (posiciones liberadas)</span></p></div>' +
    '<div class="tarjeta"><h3>Resultados de muestreo (tandas)</h3>' +
    '<p class="mini">' + STATE.asignaciones.length + ' tanda(s): ' +
    STATE.asignaciones.filter(a => a.estado === 'COMPLETADA').length + ' certificadas · ' +
    STATE.asignaciones.filter(a => a.estado === 'EN_PROCESO').length + ' en curso/en alerta · ' +
    STATE.asignaciones.filter(a => a.estado === 'CANCELADA').length + ' re-clasificadas</p></div>' +
    '</div></div>';

  h += '<div class="seccion"><h2>Capacidad vs ocupación por zona</h2><div class="reticula reticula-2">';
  STATE.zonas.forEach(z => {
    const cap = capacidadZona(z.id);
    const oc = ocupadasZona(z.id);
    const ocupadasBahias = bahiasOcupadasZona(z.id).map(b => b.codigo.replace('Bahía ', ''));
    const capBahias = bahiasDeZona(z.id).map(b => b.codigo.replace('Bahía ', ''));
    h += '<div class="tarjeta"><h3>' + z.nombre + '</h3>' +
      '<p class="mini muted">CAPACIDAD MÁXIMA → BAHÍAS ' + capBahias.join(', ') + '</p>' +
      '<p class="mini muted">OCUPADAS → BAHÍAS ' + (ocupadasBahias.length ? ocupadasBahias.join(', ') : '—') + '</p>' +
      '<p style="margin-top:8px"><span class="cifra-grande">' + oc + '</span> / ' + cap + ' posiciones ocupadas</p>' +
      barra(cap ? oc / cap * 100 : 0, oc / cap >= 0.9 ? 'var(--alerta)' : 'var(--proceso)') +
      '</div>';
  });
  h += '</div></div>';

  // Productividad
  h += '<div class="seccion"><h2>Productividad por clasificador (cajas/hora vs meta ' + REGLAS.META_CAJAS_HORA + ')</h2><div class="reticula reticula-2">';
  const prod = productividadClasificadores();
  if (!prod.length) h += '<div class="tarjeta"><p class="muted">Sin jornadas hoy.</p></div>';
  prod.forEach(item => {
    const color = item.cajasHora >= REGLAS.META_CAJAS_HORA ? 'var(--ok)' : (item.cajasHora >= REGLAS.META_CAJAS_HORA * 0.75 ? 'var(--alerta)' : 'var(--rechazado)');
    h += '<div class="tarjeta"><h3>' + esc(item.nombre) + '</h3>' +
      '<p><span class="cifra-grande" style="color:' + color + '">' + item.cajasHora.toFixed(1) + '</span>' +
      ' <span class="muted">cajas/h · ' + item.cajas + ' cajas · ' + item.horas.toFixed(1) + ' h</span></p>' +
      barra(item.cajasHora, color, REGLAS.META_CAJAS_HORA * 1.3) +
      '<p class="mini muted">Meta: ' + REGLAS.META_CAJAS_HORA + ' cajas/hora</p></div>';
  });
  h += '</div></div>';

  // Bahías (avance informativo — no se asignan a nadie)
  h += '<div class="seccion"><h2>Bahías (avance informativo — la clasificación es libre)</h2><div class="reticula reticula-bahias">';
  STATE.bahias.forEach(b => {
    const av = avanceBahia(b);
    const est = estadoBahia(b);
    h += '<div class="tarjeta"><h3>' + etiquetaBahia(b) + ' ' + chipEstadoBahia(est) + '</h3>' +
      '<p class="mini">Avance: ' + av.x + ' de ' + av.n + ' posiciones clasificadas</p>' +
      barra(av.n ? av.x / av.n * 100 : 0, est === 'COMPLETADA' ? 'var(--ok)' : 'var(--proceso)') +
      '</div>';
  });
  h += '</div></div>';

  // Alertas de calidad
  const alertas = alertasPendientes();
  h += '<div class="seccion"><h2>Alertas de calidad (MBFU ≥ ' + REGLAS.UMBRAL_MBFU.toFixed(2) + '%)</h2>';
  if (!alertas.length) {
    h += '<div class="tarjeta"><p class="cifra-ok">Sin alertas pendientes. La calidad va bien.</p></div>';
  } else {
    h += '<div class="reticula reticula-2">';
    alertas.forEach(p => {
      h += '<div class="tarjeta" style="border-left:4px solid var(--alerta)"><h3>' + p.id + ' ' + chipAlerta() + '</h3>' +
        '<p class="mini muted">' + ubicacionPallet(p) + '</p>' +
        '<p>MBFU%: <span class="cifra-grande cifra-alerta">' + fmtPct(p.muestreo.pct) + '</span>' +
        ' <span class="mini muted">(' + p.muestreo.botellas + ' de ' + botellasRevisadas(p) + ' botellas revisadas)</span></p>' +
        '<p class="mini">Clasificador: <strong>' + esc(nombreTrabajador(p.clasificadoPor)) + '</strong> · ' +
        'Jornada ' + p.jornadaId + ' · Muestreado por ' + esc(nombreTrabajador(p.muestreo.muestreadorId)) + ' ' + fmtHace(p.muestreo.ts) + '</p>' +
        '<p class="mini muted">Decide en la pestaña "Decisiones de muestreo".</p></div>';
    });
    h += '</div>';
  }
  h += '</div>';
  return h;
}

/* --- Tab 2: Mapa interactivo (con pan & zoom vía Panzoom, si está disponible) --- */
function aMapa() {
  const totalCap = STATE.posiciones.filter(p => p.activa).length;
  const totalOcup = STATE.posiciones.filter(p => p.activa && p.palletId).length;
  let h = '<div class="seccion"><h2>Mapa del almacén — clic en posición: activar/desactivar · clic en bahía: ver detalle</h2>' +
    leyendaEstadosPallet() +
    '<p class="mini muted">Capacidad configurada: <strong>' + totalCap + '</strong> posiciones activas · Ocupadas: <strong>' + totalOcup + '</strong> ' +
    '(el BI se recalcula al instante con cada cambio). La clasificación es libre: los clasificadores toman pallets desde su app.</p>';

  // Viewport con pan & zoom; el lienzo usa el MISMO boceto dibujado del
  // trabajador/conductor (zonas caja → bahías barras → rejilla A|B)
  h += '<div class="mapa-viewport" id="mapa-viewport">' +
    '<div class="mapa-herramientas">' +
    '<button class="btn" title="Acercar" onclick="mapaZoomIn()">＋</button>' +
    '<button class="btn" title="Alejar" onclick="mapaZoomOut()">−</button>' +
    '<button class="btn btn-restablecer" title="Restablecer vista" onclick="mapaReset()">Restablecer</button>' +
    '</div>' +
    '<div class="mapa-ayuda">Arrastra para mover · rueda para acercar</div>' +
    '<div class="mapa-lienzo" id="mapa-lienzo">' +
    mapaAlmacenSketch(segPosicionAdmin, {
      zonaInfo: function (z) {
        return 'capacidad ' + capacidadZona(z.id) + ' · ocupadas ' + ocupadasZona(z.id);
      },
      bahiaCab: function (b) {
        const av = avanceBahia(b);
        const est = estadoBahia(b);
        const sel = UI.mapaBahia === b.id;
        return '<div class="mapa-bahia-cab-sketch' + (sel ? ' mapa-bahia-cab-sketch--sel' : '') +
          '" title="' + b.codigo + ' · toca para ver detalle" onclick="seleccionarBahia(\'' + b.id + '\')">' +
          chipEstadoBahia(est) + '<span class="mini muted">' + av.x + '/' + av.n + '</span></div>';
      }
    }) +
    '</div></div>'; // cierra mapa-lienzo y mapa-viewport

  // Panel de la bahía seleccionada (informativo: las bahías no se asignan)
  const b = UI.mapaBahia ? getBahia(UI.mapaBahia) : null;
  if (b) {
    const av = avanceBahia(b);
    const est = estadoBahia(b);
    const pallets = posicionesDeBahia(b.id)
      .filter(pos => pos.palletId)
      .map(pos => ({ pos: pos, pallet: getPallet(pos.palletId) }));
    h += '<div class="panel-bahia"><h3 style="margin:0 0 8px">' + etiquetaBahia(b) + ' ' + chipEstadoBahia(est) + '</h3>' +
      '<p class="mini">Avance: <strong>' + av.x + ' de ' + av.n + '</strong> posiciones clasificadas (informativo — la clasificación es libre)</p>' +
      barra(av.n ? av.x / av.n * 100 : 0, est === 'COMPLETADA' ? 'var(--ok)' : 'var(--proceso)');
    if (pallets.length) {
      h += '<p class="mini" style="margin:8px 0 4px">Pallets en esta bahía:</p>';
      pallets.forEach(item => {
        const p = item.pallet;
        h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0">' +
          item.pos.codigo + ' · ' + p.id + ' · ' + p.cajasTotales + ' cajas · ' +
          fmtMiles(botellasRevisadas(p)) + ' botellas · ' + resumenConteo(p) + ' ' +
          chipEstadoPallet(p.estado) +
          (p.muestreo && p.muestreo.alerta && p.estado === 'EN_MUESTREO' ? ' ' + chipAlerta() : '') +
          (p.clasificadoPor ? ' <span class="muted">· ' + esc(nombreTrabajador(p.clasificadoPor)) + '</span>' : '') + '</p>';
      });
    } else {
      h += '<p class="mini muted">Sin pallets en esta bahía.</p>';
    }
    if (est === 'EN_PROCESO' && av.x > 0) {
      h += '<p class="mini muted">Avance persistente: un pallet sin terminar sigue EN_PROCESO y puede tomarlo cualquier clasificador.</p>';
    }
    h += '</div>';
  } else {
    h += '<p class="mini muted">Haz clic en el nombre de una bahía para ver su detalle.</p>';
  }
  h += '</div>';
  return h;
}

function seleccionarBahia(id) {
  UI.mapaBahia = UI.mapaBahia === id ? null : id;
  render();
}

/* --- Pan & zoom (Panzoom 4.x) ---
 * Panzoom no enlaza la rueda: se ata a mano zoomWithWheel sobre el viewport
 * (zoom centrado en el cursor). Con canvas:true el pointerdown se enlaza al
 * padre, así el arrastre funciona también sobre el espacio vacío. Todo queda
 * protegido por typeof Panzoom para que los smoke tests en Node (sin DOM ni
 * librería) sigan pasando. */

/* Núcleo común: crea la instancia sobre el lienzo, enlaza wheel, instala el
 * guardián de clicks y devuelve {instancia, destruir}. */
function montarPanzoom(viewportId, lienzoId, opciones) {
  if (typeof Panzoom === 'undefined') return null;
  const viewport = document.getElementById(viewportId);
  const lienzo = document.getElementById(lienzoId);
  if (!viewport || !lienzo) return null;
  const instancia = Panzoom(lienzo, opciones);
  const enWheel = function (e) { instancia.zoomWithWheel(e); };
  viewport.addEventListener('wheel', enWheel);
  const offGuardian = instalarGuardianClicks(viewport);
  return {
    instancia: instancia,
    viewport: viewport,
    lienzo: lienzo,
    destruir: function () {
      instancia.destroy();
      viewport.removeEventListener('wheel', enWheel);
      offGuardian();
    },
  };
}

/* === Mapa del ADMIN (desktop) === */
let mapaPanzoom = null;
let mapaMontaje = null;

function inicializarMapaPanzoom() {
  destruirMapaPanzoom(); // por si había una instancia sobre el elemento anterior
  mapaMontaje = montarPanzoom('mapa-viewport', 'mapa-lienzo', {
    canvas: true,
    maxScale: 2.5,
    minScale: 0.4,
    excludeClass: 'mapa-herramientas' // los botones flotantes no inician pan
  });
  if (!mapaMontaje) return;
  mapaPanzoom = mapaMontaje.instancia;
  // Centrar el lienzo si es más pequeño que el viewport
  const vw = mapaMontaje.viewport.clientWidth, vh = mapaMontaje.viewport.clientHeight;
  const lw = mapaMontaje.lienzo.scrollWidth, lh = mapaMontaje.lienzo.scrollHeight;
  if (vw && vh && lw && lh) {
    const x = Math.max(0, (vw - lw) / 2);
    const y = Math.max(0, (vh - lh) / 2);
    if (x > 0 || y > 0) mapaPanzoom.pan(x, y);
  }
}

function destruirMapaPanzoom() {
  if (mapaMontaje) { mapaMontaje.destruir(); mapaMontaje = null; }
  mapaPanzoom = null;
}

function mapaZoomIn() { if (mapaPanzoom) mapaPanzoom.zoomIn(); }
function mapaZoomOut() { if (mapaPanzoom) mapaPanzoom.zoomOut(); }
function mapaReset() { if (mapaPanzoom) mapaPanzoom.reset(); }

/* === Mapa del TRABAJADOR (viewport fijo dentro del celular) === */
let mapaMovilPanzoom = null;
let mapaMovilMontaje = null;

/* Oculta los textos de los segmentos por debajo de scale 0.8 (legibilidad).
 * Devuelve función de limpieza. */
function instalarLegibilidad(lienzo, instancia) {
  const enCambio = function (e) {
    const s = (e && e.detail && typeof e.detail.scale === 'number') ? e.detail.scale : instancia.getScale();
    lienzo.classList.toggle('mapa-movil-sin-texto', s < 0.8);
  };
  lienzo.addEventListener('panzoomchange', enCambio);
  return function () { lienzo.removeEventListener('panzoomchange', enCambio); };
}

/* Núcleo común de los mapas móviles (trabajador y conductor): monta Panzoom
 * con canvas + wheel + guardián de clicks, instala la legibilidad por zoom y
 * devuelve el montaje listo (con destruir completo). */
function crearMapaMovilPanzoom(viewportId, lienzoId) {
  const montaje = montarPanzoom(viewportId, lienzoId, {
    canvas: true,
    maxScale: 3,
    minScale: 0.3,
    excludeClass: 'mapa-herramientas'
  });
  if (!montaje) return null;
  const offLegible = instalarLegibilidad(montaje.lienzo, montaje.instancia);
  const destruirBase = montaje.destruir;
  montaje.destruir = function () { offLegible(); destruirBase(); };
  return montaje;
}

/* Vista inicial de un mapa móvil: que quepa toda la Zona 1 (alto de la
 * primera zona) y el ancho completo del lienzo, centrado horizontalmente. */
function ajustarVistaInicialEn(montaje) {
  if (!montaje || !montaje.instancia) return;
  const viewport = montaje.viewport, lienzo = montaje.lienzo;
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  const lw = lienzo.scrollWidth, lh = lienzo.scrollHeight;
  if (!vw || !vh || !lw || !lh) return;
  const zona1 = lienzo.querySelector ? lienzo.querySelector('.mapa-zona') : null;
  const altoZona1 = (zona1 && zona1.offsetHeight) ? zona1.offsetHeight : lh;
  const escala = Math.min(vw / lw, vh / altoZona1, 1);
  const s = Math.max(0.3, escala);
  montaje.instancia.zoom(s);
  const panX = Math.max(0, (vw - lw * s) / (2 * s));
  montaje.instancia.pan(panX, 0);
}

function inicializarMapaMovilPanzoom() {
  destruirMapaMovilPanzoom();
  mapaMovilMontaje = crearMapaMovilPanzoom('mapamovil-viewport', 'mapamovil-lienzo');
  if (!mapaMovilMontaje) return;
  mapaMovilPanzoom = mapaMovilMontaje.instancia;
  ajustarVistaInicialEn(mapaMovilMontaje);
}

function destruirMapaMovilPanzoom() {
  if (mapaMovilMontaje) { mapaMovilMontaje.destruir(); mapaMovilMontaje = null; }
  mapaMovilPanzoom = null;
}

function mapaMovilZoomIn() { if (mapaMovilPanzoom) mapaMovilPanzoom.zoomIn(); }
function mapaMovilZoomOut() { if (mapaMovilPanzoom) mapaMovilPanzoom.zoomOut(); }
function mapaMovilReset() {
  if (!mapaMovilPanzoom) return;
  mapaMovilPanzoom.reset();
  ajustarVistaInicialEn(mapaMovilMontaje);
}

/* === Mapa móvil del CONDUCTOR (mismo núcleo, otros ids) === */
let mapaCondPanzoom = null;
let mapaCondMontaje = null;

function inicializarMapaCondPanzoom() {
  destruirMapaCondPanzoom();
  mapaCondMontaje = crearMapaMovilPanzoom('condmapa-viewport', 'condmapa-lienzo');
  if (!mapaCondMontaje) return;
  mapaCondPanzoom = mapaCondMontaje.instancia;
  ajustarVistaInicialEn(mapaCondMontaje);
}
function destruirMapaCondPanzoom() {
  if (mapaCondMontaje) { mapaCondMontaje.destruir(); mapaCondMontaje = null; }
  mapaCondPanzoom = null;
}
function mapaCondZoomIn() { if (mapaCondPanzoom) mapaCondPanzoom.zoomIn(); }
function mapaCondZoomOut() { if (mapaCondPanzoom) mapaCondPanzoom.zoomOut(); }
function mapaCondReset() {
  if (!mapaCondPanzoom) return;
  mapaCondPanzoom.reset();
  ajustarVistaInicialEn(mapaCondMontaje);
}

/* Distingue click de drag: si entre pointerdown y click el puntero se movió
 * más de 5 px, el click se consume en fase de captura (preventDefault +
 * stopPropagation) y los handlers inline de posiciones/bahías no se ejecutan.
 * Así el click nunca "falla" tras arrastrar. Devuelve función de limpieza. */
function instalarGuardianClicks(viewport) {
  const est = { x0: 0, y0: 0, movido: false, presionando: false };
  const enDown = function (e) {
    est.presionando = true; est.movido = false; est.x0 = e.clientX; est.y0 = e.clientY;
  };
  const enMove = function (e) {
    if (!est.presionando) return;
    if (Math.max(Math.abs(e.clientX - est.x0), Math.abs(e.clientY - est.y0)) > 5) est.movido = true;
  };
  const enClick = function (e) {
    if (est.movido) { e.preventDefault(); e.stopPropagation(); }
    est.presionando = false; est.movido = false;
  };
  window.addEventListener('pointerdown', enDown, true);
  window.addEventListener('pointermove', enMove, true);
  viewport.addEventListener('click', enClick, true);
  return function () {
    window.removeEventListener('pointerdown', enDown, true);
    window.removeEventListener('pointermove', enMove, true);
    viewport.removeEventListener('click', enClick, true);
  };
}

/* --- Tab 3: Asignar muestreo --- */
function aAsignarMuestreo() {
  let h = '<div class="seccion form-ancho"><h2>Asignar muestreo (2 a 3 pallets de un mismo clasificador)</h2>' +
    '<div class="tarjeta"><div class="fila-form">' +
    '<div class="campo"><label>Muestreador</label><select id="form-muestreador">' +
    '<option value="">Elegir…</option>' +
    trabajadoresActivos().map(t => '<option value="' + t.id + '">' + esc(t.nombre) + '</option>').join('') +
    '</select></div>' +
    '<div class="campo"><label>Clasificador a auditar</label><select id="form-clasificador" onchange="actualizarDisponibles();mostrarAlcance()">' +
    '<option value="">Elegir…</option>' +
    trabajadoresActivos().map(t => '<option value="' + t.id + '">' + esc(t.nombre) + '</option>').join('') +
    '</select></div>' +
    '<div class="campo"><label>Cantidad de pallets (2–3)</label>' +
    '<input type="number" id="form-cantidad" min="' + REGLAS.MIN_PALLETS_MUESTREO + '" max="' + REGLAS.MAX_PALLETS_MUESTREO + '" value="2">' +
    '<button class="btn" style="margin-top:6px" onclick="sortearCantidad()">Al azar</button></div>' +
    '<button class="btn btn-primario" onclick="crearAsignacionDesdeForm()">Crear asignación</button>' +
    '</div>' +
    // LOTE CONGELADO: alcance propuesto (todo lo clasificado pendiente), ajustable
    '<div class="campo" style="margin-top:10px"><label>Alcance propuesto del lote (se congela al crear)</label>' +
    '<div id="form-alcance"><p class="mini muted">Elige un clasificador para ver su alcance propuesto.</p></div></div>' +
    '<p class="mini muted">El sistema PROPONE como alcance todo lo clasificado-pendiente del clasificador (su jornada); ' +
    'puedes quitar pallets del alcance. La tanda (2–3) se elige al azar dentro del lote y la asignación aparece de inmediato en la app del muestreador.</p>';
  if (UI.msg) {
    h += '<div class="mensaje ' + (UI.msg.tipo === 'ok' ? 'mensaje-ok' : 'mensaje-error') + '">' + esc(UI.msg.texto) + '</div>';
  }
  h += '</div></div>';

  const activas = STATE.asignaciones.filter(a => a.estado === 'PENDIENTE' || a.estado === 'EN_PROCESO');
  h += '<div class="seccion"><h2>Asignaciones activas</h2>';
  if (!activas.length) {
    h += '<div class="tarjeta"><p class="muted">No hay asignaciones activas.</p></div>';
  } else {
    h += '<table class="tabla"><tr><th>ID</th><th>Muestreador</th><th>Clasificador auditado</th><th>Tanda</th><th>Lote (congelado)</th><th>Progreso</th><th>Estado</th></tr>';
    activas.forEach(a => {
      const revisados = a.palletIds.filter(pid => { const p = getPallet(pid); return p && p.muestreo; }).length;
      h += '<tr><td>' + a.id + '</td><td>' + esc(nombreTrabajador(a.muestreadorId)) + '</td>' +
        '<td>' + esc(nombreTrabajador(a.clasificadorId)) + '</td><td>' + a.cantidad + '</td>' +
        '<td>' + (a.loteIds ? a.loteIds.length : '—') + '</td>' +
        '<td>' + revisados + '/' + a.cantidad + '</td><td>' + a.estado + '</td></tr>';
    });
    h += '</table>';
  }
  h += '</div>';
  return h;
}

function sortearCantidad() {
  const el = document.getElementById('form-cantidad');
  el.value = REGLAS.MIN_PALLETS_MUESTREO + Math.floor(Math.random() * (REGLAS.MAX_PALLETS_MUESTREO - REGLAS.MIN_PALLETS_MUESTREO + 1));
}
function actualizarDisponibles() {
  const tid = document.getElementById('form-clasificador').value;
  const el = document.getElementById('form-disponibles');
  if (el) el.textContent = tid ? palletsClasificadosDe(tid).length : '—';
}

/* Alcance propuesto del lote: lista lo clasificado-pendiente del clasificador
 * con la opción de quitar pallets (ajuste). Actualiza el contador por DOM. */
function mostrarAlcance() {
  const cid = document.getElementById('form-clasificador').value;
  const cont = document.getElementById('form-alcance');
  UI.alcanceSel = {};
  if (!cid) {
    cont.innerHTML = '<p class="mini muted">Elige un clasificador para ver su alcance propuesto.</p>';
    return;
  }
  const pool = palletsClasificadosDe(cid);
  if (!pool.length) {
    cont.innerHTML = '<p class="mini">Sin pallets clasificados pendientes para este clasificador.</p>';
    return;
  }
  let filas = '';
  pool.forEach(p => {
    UI.alcanceSel[p.id] = true;
    filas += '<label class="fila-alcance"><input type="checkbox" checked onchange="toggleAlcance(\'' + p.id + '\', this.checked)">' +
      '<span class="mini"><strong>' + p.id + '</strong> · ' + ubicacionPallet(p) + ' · ' +
      p.cajasTotales + ' cajas · ' + tipoCajaDe(p).nombre + '</span></label>';
  });
  cont.innerHTML = '<p class="mini" id="alcance-n"><strong>' + pool.length + '</strong> pallets en el alcance ' +
    '(propuesto: todo lo clasificado pendiente)</p>' + filas;
}
function toggleAlcance(pid, checked) {
  UI.alcanceSel = UI.alcanceSel || {};
  UI.alcanceSel[pid] = !!checked;
  const n = Object.keys(UI.alcanceSel).filter(k => UI.alcanceSel[k]).length;
  const el = document.getElementById('alcance-n');
  if (el) el.innerHTML = '<strong>' + n + '</strong> pallets en el alcance (propuesto: todo lo clasificado pendiente)';
}

function crearAsignacionDesdeForm() {
  const m = document.getElementById('form-muestreador').value;
  const c = document.getElementById('form-clasificador').value;
  const n = document.getElementById('form-cantidad').value;
  // Lote congelado: el alcance ajustado por el Admin (o null = propuesto por defecto)
  let loteIds = null;
  if (UI.alcanceSel) {
    loteIds = Object.keys(UI.alcanceSel).filter(k => UI.alcanceSel[k]);
    if (!loteIds.length) {
      UI.msg = { tipo: 'error', texto: 'El alcance no puede quedar vacío: deja al menos un pallet en el lote.' };
      render();
      return;
    }
  }
  const res = crearAsignacionMuestreo(m, c, n, loteIds);
  if (res.ok) {
    UI.alcanceSel = null;
    UI.msg = { tipo: 'ok', texto: res.asignacion.id + ' creada: tanda de ' + res.asignacion.cantidad + ' pallets (' +
      res.asignacion.palletIds.join(', ') + ') sobre un lote congelado de ' + res.asignacion.loteIds.length + ' (' +
      res.asignacion.loteIds.join(', ') + ') de ' + nombreTrabajador(res.asignacion.clasificadorId) + ' para ' +
      nombreTrabajador(res.asignacion.muestreadorId) + '. Ya visible en la app del muestreador.' };
  } else {
    UI.msg = { tipo: 'error', texto: res.error };
  }
  render();
}

/* --- Tab 4: Decisiones de muestreo — se decide el LOTE de cada TANDA ---
 * Tanda con algún pallet ≥ 0.40%: el Admin deja pasar (certifica el lote
 * congelado → LISTO) o re-clasifica (el lote vuelve a EN_PROCESO). */
function aDecisiones() {
  const alertas = alertasPendientes();
  let h = '<div class="seccion"><h2>Tandas en alerta — decides el LOTE congelado de cada tanda (umbral 0.40% referencial)</h2>';
  if (!alertas.length) {
    h += '<div class="tarjeta"><p class="cifra-ok">Sin tandas en alerta.</p>' +
      '<p class="mini muted">Si algún pallet de una tanda registra MBFU% ≥ 0.40%, la tanda aparecerá aquí con su lote congelado: ' +
      'dejar pasar certifica el lote (→ LISTO); re-clasificar devuelve el lote a clasificación. Lo clasificado después de la asignación no entra: espera otra tanda.</p></div></div>';
    return h;
  }
  // una tarjeta de decisión por TANDA (asignación), con su alcance congelado
  const porTanda = {};
  alertas.forEach(p => {
    const aid = (p.muestreo && p.muestreo.asignacionId) || '—';
    (porTanda[aid] = porTanda[aid] || []).push(p);
  });
  h += '<div class="reticula reticula-2">';
  Object.keys(porTanda).forEach(aid => {
    const asg = getAsignacion(aid);
    const ps = porTanda[aid];
    const cid = asg ? asg.clasificadorId : (ps[0].clasificadoPor || '—');
    const loteN = asg && asg.loteIds ? asg.loteIds.length : ps.length;
    h += '<div class="tarjeta" style="border-left:4px solid var(--alerta)">' +
      '<h3>Tanda ' + aid + ' · lote de ' + loteN + ' pallets (congelado al asignar) ' + chipAlerta() + '</h3>' +
      '<p class="mini">Clasificador: <strong>' + esc(nombreTrabajador(cid)) + '</strong> · ' +
      ps.length + ' pallet(s) de la tanda sobre el umbral</p>';
    ps.forEach(p => {
      h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0">' +
        p.id + ' · ' + ubicacionPallet(p) + ' · <strong class="cifra-alerta">' + fmtPct(p.muestreo.pct) + '</strong>' +
        ' <span class="muted">(' + p.muestreo.botellas + '/' + botellasRevisadas(p) + ' botellas)</span> ' +
        chipEstadoPallet(p.estado) + '</p>';
    });
    h += '<div class="fila-botones">' +
      '<button class="btn btn-ok" onclick="dejarPasarLoteUI(\'' + aid + '\')">Dejar pasar (certifica el lote de ' + loteN + ' pallets → LISTO)</button>' +
      '<button class="btn btn-peligro" onclick="reclasificarLoteUI(\'' + aid + '\')">Re-clasificar lote (el lote vuelve a clasificación)</button>' +
      '</div></div>';
  });
  h += '</div></div>';
  return h;
}

/* Afectados del lote congelado de la tanda según la decisión */
function lotePendientesDe(aid) {
  const asg = getAsignacion(aid);
  if (!asg || !asg.loteIds) return [];
  return asg.loteIds.map(getPallet).filter(p => p && (p.estado === 'CLASIFICADO' || p.estado === 'EN_MUESTREO'));
}
function loteReclasificablesDe(aid) {
  const asg = getAsignacion(aid);
  if (!asg || !asg.loteIds) return [];
  return asg.loteIds.map(getPallet).filter(p => p &&
    (p.estado === 'CLASIFICADO' || p.estado === 'EN_MUESTREO' || p.estado === 'LISTO'));
}

function dejarPasarLoteUI(asignacionId) {
  const pendientes = lotePendientesDe(asignacionId);
  if (!pendientes.length) { alert('El lote de la tanda ' + asignacionId + ' ya no tiene pallets pendientes.'); return; }
  if (!confirm('Dejar pasar la tanda ' + asignacionId + ':\n' +
    pendientes.length + ' pallet(s) del lote congelado pasarán a LISTO (' + pendientes.map(q => q.id).join(', ') + ').\n' +
    'El Conductor ya podrá despacharlos. ¿Continuar?')) return;
  const n = dejarPasarLote(asignacionId);
  alert(n + ' pallet(s) del lote certificados → LISTO. El Conductor ya puede despacharlos.');
}

function reclasificarLoteUI(asignacionId) {
  const afectados = loteReclasificablesDe(asignacionId);
  if (!afectados.length) { alert('El lote de la tanda ' + asignacionId + ' ya está resuelto.'); return; }
  if (!confirm('Re-clasificar TODO el lote congelado de la tanda ' + asignacionId + ':\n' +
    afectados.length + ' pallet(s) volverán a EN_PROCESO y quedarán LIBRES (' + afectados.map(q => q.id).join(', ') + ').\n' +
    'Los ya DESPACHADO no se tocan. El avance del mapa y el BI se actualizan al instante. ¿Continuar?')) return;
  const n = reclasificarLote(asignacionId);
  alert(n + ' pallet(s) del lote volvieron a EN_PROCESO (libres, con su avance conservado). Revisa el mapa y el BI.');
}

/* --- Tab 5: Trabajadores --- */
function aTrabajadores() {
  let h = '<div class="seccion form-ancho"><h2>Gestión de trabajadores</h2>' +
    '<div class="tarjeta"><div class="fila-form" style="grid-template-columns:2fr auto">' +
    '<div class="campo" style="margin:0"><label>Nuevo trabajador</label>' +
    '<input type="text" id="form-nuevo-trabajador" placeholder="Nombre y apellido"></div>' +
    '<button class="btn btn-primario" onclick="crearTrabajadorDesdeForm()">Crear</button>' +
    '</div></div>' +
    '<table class="tabla"><tr><th>Nombre</th><th>Estado</th><th>Acciones</th></tr>';
  STATE.trabajadores.forEach(t => {
    h += '<tr><td>';
    if (UI.editingWorker === t.id) {
      h += '<input type="text" id="form-edit-' + t.id + '" value="' + esc(t.nombre) + '">';
    } else {
      h += '<strong>' + esc(t.nombre) + '</strong>';
    }
    h += '</td><td>' + (t.activo
      ? '<span class="chip" style="background:var(--ok)">Activo</span>'
      : '<span class="chip" style="background:var(--pendiente)">Inactivo</span>') + '</td><td>';
    if (UI.editingWorker === t.id) {
      h += '<button class="btn btn-ok" onclick="guardarEdicionTrabajador(\'' + t.id + '\')">Guardar</button> ' +
        '<button class="btn" onclick="cancelarEdicionTrabajador()">Cancelar</button>';
    } else {
      h += '<button class="btn" onclick="editarTrabajador(\'' + t.id + '\')">Editar nombre</button> ' +
        '<button class="btn ' + (t.activo ? 'btn-peligro' : 'btn-primario') + '" onclick="toggleActivoTrabajador(\'' + t.id + '\')">' +
        (t.activo ? 'Desactivar' : 'Activar') + '</button>';
    }
    h += '</td></tr>';
  });
  h += '</table>' +
    '<p class="mini muted">Los trabajadores inactivos no aparecen en el login de la app móvil ni en los selectores de asignación.</p></div>';
  return h;
}

function crearTrabajadorDesdeForm() {
  const res = crearTrabajador(document.getElementById('form-nuevo-trabajador').value);
  if (res.error) alert(res.error);
}
function editarTrabajador(id) {
  UI.editingWorker = id;
  render();
}
function cancelarEdicionTrabajador() {
  UI.editingWorker = null;
  render();
}
function guardarEdicionTrabajador(id) {
  const res = renombrarTrabajador(id, document.getElementById('form-edit-' + id).value);
  if (res.ok) UI.editingWorker = null;
  else alert(res.error);
}

/* ============================ ARRANQUE ============================ */

document.addEventListener('DOMContentLoaded', function () {
  STATE = clonarSemilla();
  resetUI();
  render();
});
