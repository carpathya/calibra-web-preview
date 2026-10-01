/* =========================================================================
 * Calibra — Render de pantallas y eventos de la demo (sin backend)
 *
 * Estado de presentación en UI (pantalla activa, tab admin, conteo en
 * curso...). Las mutaciones del dominio viven en state.js; este archivo
 * solo dibuja y delega. Sin import/export: funciones globales para file://.
 * ========================================================================= */

let UI = {};

function resetUI() {
  if (UI.timerHandle) clearInterval(UI.timerHandle);
  UI = {
    pantalla: 'login',      // login | home | tomarSeleccion | conteo | muestrear | muestreo-detalle | historial
    pantallaOperador: 'login', // login | home | cargues
    tab: 'bi',              // bi | mapa | despacho | muestreo | decisiones | trabajadores
    mapaSel: null,          // { tipo: 'bahia'|'zona', id } selección del mapa admin
    mapaSelCeldas: {},      // posicionId → true (selección múltiple de celdas del mapa admin)
    conteo: null,           // { palletId, cajas, cats, inicioTs }
    asignacionVer: null,    // asignación de muestreo abierta
    editingWorker: null,    // trabajador en edición (tabla admin)
    editingOperador: null,  // operador en edición (tabla admin)
    msg: null,              // { tipo, texto } feedback del form de muestreo
    modoMuestreo: 'aleatorio', // aleatorio | manual (selector de tanda en muestreo)
    tandaSel: {},           // pallets CLASIFICADOS marcados para la tanda manual
    despSel: {},            // selección de pallets del operador (despacho en lote)
    despSelAdmin: {},       // selección de pallets del admin (despacho en lote)
    zonaDespOper: null,     // filtro de zona del despacho del operador (null = todas)
    rangoDespOper: null,    // punto A del rango de despacho (operador)
    zonaDespAdmin: null,    // filtro de zona del despacho del admin (null = todas)
    rangoDespAdmin: null,   // punto A del rango de despacho (admin)
    selConjunto: {},        // posiciones marcadas en el mapa para "Tomar selección (N)"
    rangoA: null,           // primer cuadrante del rango en curso (posicionId)
    zonaSel: (STATE && STATE.zonas && STATE.zonas.length) ? STATE.zonas[0].id : null, // zona activa del carrusel
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
  return partes.length ? partes.join(', ') : 'sin defectos registrados';
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
  document.getElementById('vista-operador').classList.toggle('activa', STATE.vista === 'operador');
  document.getElementById('vista-admin').classList.toggle('activa', STATE.vista === 'admin');
  document.getElementById('btn-vista-trabajador').classList.toggle('activo', STATE.vista === 'trabajador');
  document.getElementById('btn-vista-operador').classList.toggle('activo', STATE.vista === 'operador');
  document.getElementById('btn-vista-admin').classList.toggle('activo', STATE.vista === 'admin');
  // Al cambiar de vista se destruye el pan/zoom de las otras (sus listeners de
  // document no deben quedar vivos): cada vista lo reinicializa al volver.
  if (STATE.vista !== 'admin') destruirMapaPanzoom();
  if (STATE.vista !== 'trabajador') destruirMapaMovilPanzoom();
  if (STATE.vista !== 'operador') destruirMapaOperPanzoom();
  if (STATE.vista === 'trabajador') renderTrabajador();
  else if (STATE.vista === 'operador') renderOperador();
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
    case 'tomarSeleccion': cont.innerHTML = pTomarSeleccion(); inicializarCarrusel(); actualizarBarraToma(); break;
    case 'conteo': cont.innerHTML = pConteo(); activarTimer(); break;
    case 'muestrear': cont.innerHTML = pMuestrear(); break;
    case 'muestreo-detalle': cont.innerHTML = pMuestreoDetalle(); break;
    case 'historial': cont.innerHTML = pHistorial(); break;
    default: cont.innerHTML = pLogin();
  }
}

/* --- Pantalla 1: Login (selector de trabajador, sin contraseña) --- */
function pLogin() {
  let h = '<div class="appbar"><span class="appbar-titulo">Calibra · Trabajador</span></div>';
  h += '<div class="login-marca"><div class="login-nombre">Calibra</div>' +
    '<div class="login-firma">by Carpathya</div></div>';
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
  const conjunto = conjuntoDe(t.id);
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

  // Tu CONJUNTO actual (clasificación por conjunto: normalmente = bahía)
  h += '<div class="tarjeta-movil"><h3>Tu conjunto actual</h3>';
  if (conjunto) {
    const bahia = (function () {
      const pos0 = getPosicion(conjunto[0].posicionId);
      return pos0 ? getBahia(pos0.bahiaId) : null;
    })();
    h += '<p class="mini" style="margin-bottom:4px"><strong>' + conjunto[0].conjuntoId + '</strong> · ' +
      (bahia ? etiquetaBahia(bahia) : 'conjunto propio') + '</p>' +
      '<p class="mini muted">' + conjunto.length + ' pallets en curso — se clasifican de una vez</p>' +
      '<button class="btn btn-primario" style="width:100%;margin-top:6px" onclick="continuarConjuntoUI()">Continuar clasificando</button>' +
      '<button class="btn" style="width:100%;margin-top:6px" onclick="soltarConjuntoUI()">Soltar conjunto</button>';
  } else {
    h += '<p class="muted mini">No tienes conjunto. Toca una bahía o usa «Tomar por selección» más abajo para armar tu conjunto.</p>';
  }
  h += '</div>';

  // Seleccionar ubicación: mapa visual estilo dibujado (toma por conjunto)
  h += mapaUbicacion(t, enCurso, conjunto);

  // Accesos
  h += '<div class="menu-grid">' +
    '<div class="menu-item" onclick="irA(\'muestrear\')"><span class="menu-num">✓</span>Muestrear' +
    (misAsignaciones.length ? '<span class="insignia">' + misAsignaciones.length + '</span>' : '') + '</div>' +
    '<div class="menu-item" onclick="irA(\'historial\')"><span class="menu-num">≡</span>Historial</div>' +
    '</div>';
  return h;
}

/* --- Pantalla: Tomar por selección (carrusel de bahías de una zona) ---
 * Reemplaza el carrusel que antes vivía en el home: el mapa redirige aquí al
 * tocar cualquier punto de una zona (solo con jornada en curso y sin conjunto). */
function pTomarSeleccion() {
  const t = yo();
  const zona = zonaActiva();
  let h = '<div class="appbar">' +
    '<button class="appbar-atras" onclick="irA(\'home\')">‹</button>' +
    '<span class="appbar-titulo">Tomar por selección</span></div>';
  h += '<div class="tarjeta-movil">' +
    (zona ? '<p class="mini muted">' + esc(zona.nombre) + '</p>' : '') +
    '<p class="mini muted sel-instruccion" id="sel-instruccion">' + selInstruccionHTML() + '</p>' +
    '<div class="carrusel-wrap">' +
    '<div class="carrusel-bahias" id="carrusel-bahias">' + carruselBahiasHTML(t) + '</div>' +
    '</div>' +
    '<div class="carrusel-indicador" id="carrusel-indicador">' + carruselIndicadorHTML() + '</div>' +
    '</div>';
  h += '<div class="barra-toma" id="barra-toma" style="display:none">' +
    '<span class="mini barra-toma-n"><strong id="toma-n">0</strong> seleccionados</span>' +
    '<button class="btn btn-primario" id="btn-toma-sel" onclick="tomarSeleccion()">Tomar 0</button>' +
    '<button class="btn" onclick="limpiarSeleccion()">✕</button></div>';
  return h;
}

/* Entrada a la pantalla "Tomar por selección": fija la zona y resetea la
 * selección en curso antes de navegar. */
function irATomarSeleccion(zonaId) {
  UI.zonaSel = zonaId;
  UI.rangoA = null;
  UI.selConjunto = {};
  irA('tomarSeleccion');
}

/* Grilla común del mapa dibujado: zonas → bahías (barras segmentadas A|B).
 * renderSeg(pos) dibuja cada segmento según la vista (trabajador/operador/admin).
 * opts (opcional): zonaClick(z) hace TODA la zona clickeable, zonaInfo(z) añade
 * info junto a la etiqueta de zona y bahiaCab(b) inserta una cabecera tappable
 * sobre cada barra de bahía. */
function mapaAlmacenSketch(renderSeg, opts) {
  opts = opts || {};
  let h = '';
  const zonas = opts.zonaId ? STATE.zonas.filter(z => z.id === opts.zonaId) : STATE.zonas;
  zonas.forEach(z => {
    const extraCls = (opts.zonaClick ? ' mapa-zona--clickeable' : '') + (opts.zonaSel ? opts.zonaSel(z) : '');
    h += '<div class="mapa-zona' + extraCls + '"' +
      (opts.zonaClick ? ' onclick="' + opts.zonaClick(z) + '"' : '') + '>' +
      '<span class="mapa-zona-etiqueta">' + z.nombre.toUpperCase() + '</span>';
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

/* Segmento del mapa del ADMIN: el clic SOLO SELECCIONA la celda; las acciones
 * viven en el panel lateral (modelo "seleccionar → actuar", sin gestos ocultos).
 * Los DISPONIBLES se diferencian por TIPO DE CAJA: caja 12 cyan, caja 24 violeta;
 * el puchito (total ≠ pallet completo del tipo) suma borde punteado y sufijo `p`.
 * La INACTIVA se dibuja (✕ punteado): el admin necesita verla para reactivarla
 * desde el panel. */
function segPosicionAdmin(pos) {
  if (!pos) return '';
  const p = pos.palletId ? getPallet(pos.palletId) : null;
  const sel = !!(UI.mapaSelCeldas && UI.mapaSelCeldas[pos.id]);
  const selCls = sel ? ' mapa-seg--sel' : '';
  const onClick = ' onclick="event.stopPropagation(); seleccionarCeldaMapa(\'' + pos.id + '\')"';
  if (!pos.activa) {
    return '<div class="mapa-seg mapa-seg--inactiva-admin' + selCls + '" title="' + pos.codigo +
      ' · inactiva (clic para ver acciones)"' + onClick + '>✕</div>';
  }
  if (!p) {
    return '<div class="mapa-seg mapa-seg--libre-admin' + selCls + '" title="' + pos.codigo +
      ' · vacía (clic para ver acciones)"' + onClick + '></div>';
  }
  if (p.estado === 'DISPONIBLE') {
    return segDisponibleAdmin(p, pos, selCls);
  }
  const alerta = p.muestreo && p.muestreo.alerta && p.estado === 'EN_MUESTREO';
  const color = alerta ? 'var(--alerta)' : ESTADO_PALLET[p.estado].color;
  const titulo = pos.codigo + ' · ' + p.id + ' · ' + ESTADO_PALLET[p.estado].label +
    (alerta ? ' · ALERTA' : '') + ' (ocupada: solo lectura)';
  return '<div class="mapa-seg mapa-seg--hecha' + selCls + '" style="background:' + color + ';border-color:' + color +
    '" title="' + esc(titulo) + '"' + onClick + '>' + esc(pos.codigo) + '</div>';
}

/* Celda DISPONIBLE del admin: color por TIPO DE CAJA (caja 12 cyan, caja 24
 * violeta) + modificador de borde punteado cuando es puchito (total ≠ completo
 * del tipo), con el número dentro (y sufijo `p` en puchitos). El clic solo
 * selecciona (acciones en el panel lateral). */
function segDisponibleAdmin(p, pos, selCls) {
  const tipo = p.tipoCaja === 24 ? 24 : (p.tipoCaja === 12 ? 12 : inferirBotellasPorCaja(p.cajasTotales));
  const cls = 'mapa-seg ' + (tipo === 12 ? 'mapa-seg--c12' : 'mapa-seg--c24');
  const puchito = p.cajasTotales !== completoCajasDe(tipo);
  const etiqueta = pos.codigo + ' · ' + p.id + ' · caja ' + tipo + ' · ' + p.cajasTotales + ' cajas' +
    (puchito ? ' (puchito)' : '') + ' · clic para ver acciones';
  const contenido = puchito ? String(p.cajasTotales) + 'p' : String(p.cajasTotales);
  return '<div class="' + cls + (puchito ? ' mapa-seg--puchito' : '') + (selCls || '') + '" title="' + esc(etiqueta) +
    '" onclick="event.stopPropagation(); seleccionarCeldaMapa(\'' + pos.id + '\')">' + esc(contenido) + '</div>';
}

/* --- Mapa visual "Seleccionar ubicación" del TRABAJADOR (estilo dibujado) ---
 * La toma es por CONJUNTO (normalmente = bahía): tap en la cabecera de la
 * bahía toma todo lo DISPONIBLE de ella; o marca segmentos sueltos (cyan)
 * y usa "Tomar selección (N)" para un subconjunto. El propio conjunto (azul)
 * se toca para continuar el pallet en curso. */
function mapaUbicacion(t, enCurso, conjunto) {
  let disponibles = 0;
  STATE.posiciones.forEach(pos => {
    const e = estadoPosicionPara(t.id, pos);
    if (e === 'DISPONIBLE') disponibles++;
  });
  const delDia = jornadaDelDiaDe(t.id);
  // Contador, leyenda y avisos FUERA del viewport: siempre visibles
  let h = '<div class="tarjeta-movil mapa-ubicacion"><h3>Seleccionar ubicación</h3>' +
    '<p class="mini mapa-contador"><strong>' + disponibles + '</strong> pallets disponibles</p>' +
    '<div class="mini mapa-leyenda">' +
    '<span><i class="punto" style="background:' + ESTADO_PALLET.DISPONIBLE.color + '"></i>disponible</span>' +
    '<span><i class="punto" style="background:#2563eb"></i>tuyo</span>' +
    '<span><i class="punto" style="background:#e2e8f0;border:2px dashed #94a3b8"></i>ocupada</span>' +
    '</div>';
  if (!enCurso) {
    if (!delDia) {
      h += '<p class="mini mapa-aviso">Inicia tu jornada para tomar un conjunto.</p>';
    } else if (delDia.enPausa) {
      h += '<p class="mini mapa-aviso">Estás en pausa — reanuda para tomar un conjunto.</p>';
    } else {
      h += '<p class="mini mapa-aviso">Jornada terminada — reanuda para seguir.</p>';
    }
  } else if (conjunto) {
    h += '<p class="mini mapa-aviso">Tienes un conjunto en curso: tócalo en azul para seguir, o suéltalo arriba para tomar otro.</p>';
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
    mapaAlmacenSketch(
      function (pos) { return segPosicionMapa(t, pos); },
      enCurso && !conjunto ? { zonaClick: function (z) { return "irATomarSeleccion('" + z.id + "')"; } } : undefined
    ) +
    '</div></div>';

  h += '</div>';
  return h;
}

/* Segmento de una posición dentro de la barra de la bahía (vista trabajador) */
function segPosicionMapa(t, pos) {
  if (!pos) return '';
  const est = estadoPosicionPara(t.id, pos);
  if (est === 'INACTIVA') return '<div class="mapa-seg mapa-seg--hueco"></div>';
  let cls = '', estilo = '', titulo = pos.codigo, contenido = pos.codigo;
  if (est === 'VACIA') {
    cls = 'mapa-seg--vacia-marcable';
    titulo = pos.codigo + ' · vacía (sin pallet — el admin debe abastecerla)';
  } else if (est === 'DISPONIBLE') {
    cls = 'mapa-seg--disponible';
    titulo = pos.codigo + ' · disponible';
  } else if (est === 'PROPIA') {
    const p = getPallet(pos.palletId);
    cls = 'mapa-seg--propia';
    titulo = pos.codigo + ' · ' + p.id + ' · tu conjunto (' + p.cajasTotales + ' cajas · ' + resumenConteo(p) + ')';
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
  return '<div class="mapa-seg ' + cls + '" id="seg-' + pos.id + '" style="' + estilo + '" title="' + esc(titulo) + '">' +
    esc(contenido) + '</div>';
}

/* Instrucción dinámica del modo rango, según el punto A.
 * Cuando el punto A ya está fijado se ofrece un botón "Cancelar" para resetearlo. */
function selInstruccionHTML() {
  if (!UI.rangoA) return 'Tocá el primer cuadrante y después el último para seleccionar el rango.';
  return 'Ahora tocá el último cuadrante (o el mismo para cancelar). ' +
    '<button type="button" class="btn-cancelar-rango" onclick="cancelarRango()">Cancelar</button>';
}

/* Descarta solo el punto A. */
function cancelarRango() {
  UI.rangoA = null;
  actualizarSeleccionUI();
}

/* Rectángulo de códigos de posición (MISMA bahía) entre dos esquinas.
 * col = letra A|B, idx = número. Ejemplos: A5→B7 = A5,A6,A7,B5,B6,B7;
 * A2→A3 = A2,A3; B7→B5 (inverso) = B5,B6,B7. */
function calcularRango(codA, codB) {
  const colA = codA[0], colB = codB[0];
  const idxA = parseInt(codA.slice(1), 10);
  const idxB = parseInt(codB.slice(1), 10);
  const minCol = colA < colB ? colA : colB;
  const maxCol = colA < colB ? colB : colA;
  const minIdx = Math.min(idxA, idxB);
  const maxIdx = Math.max(idxA, idxB);
  const cods = [];
  for (let c = minCol.charCodeAt(0); c <= maxCol.charCodeAt(0); c++) {
    for (let i = minIdx; i <= maxIdx; i++) cods.push(String.fromCharCode(c) + i);
  }
  return cods;
}

/* Zona activa del carrusel (UI.zonaSel, con fallback a la primera zona). */
function zonaActiva() {
  if (!STATE || !STATE.zonas || !STATE.zonas.length) return null;
  const z = STATE.zonas.filter(zz => zz.id === UI.zonaSel)[0];
  return z || STATE.zonas[0];
}

/* Posiciones tomables (DISPONIBLE) de una bahía. Las VACÍAS no tienen
 * pallet, así que no se pueden tomar/clasificar. */
function tomablesBahia(t, bahia) {
  return posicionesDeBahia(bahia.id).filter(pos => {
    const e = estadoPosicionPara(t.id, pos);
    return e === 'DISPONIBLE';
  }).length;
}

/* Celdas de la grilla de UNA bahía (2 columnas A|B intercaladas A1,B1,A2,B2…
 * como en el mapa). Las no tomables quedan inertes o como hueco; las tomables
 * son clickeables y reflejan UI.selConjunto (check) y UI.rangoA (punto A). */
function bahiaSeleccionHTML(t, bahia) {
  const porCodigo = {};
  posicionesDeBahia(bahia.id).forEach(p => { porCodigo[p.codigo] = p; });
  let h = '';
  const pares = posicionesDeBahia(bahia.id).length / 2;
  for (let i = 1; i <= pares; i++) {
    ['A', 'B'].forEach(prefijo => {
      const pos = porCodigo[prefijo + i];
      if (!pos) { h += '<div class="grilla-icono grilla-icono--hueco"></div>'; return; }
      const e = estadoPosicionPara(t.id, pos);
      if (e === 'INACTIVA') {
        h += '<div class="grilla-icono grilla-icono--hueco"></div>';
        return;
      }
      if (e === 'OTRO' || e === 'CLASIFICADA' || e === 'PROPIA') {
        h += '<div class="grilla-icono grilla-icono--inerte" title="' + esc(pos.codigo) + '">' +
          '<span class="grilla-icono-codigo">' + esc(pos.codigo) + '</span></div>';
        return;
      }
      if (e === 'VACIA') {
        // Sin pallet: no hay nada para clasificar (no seleccionable).
        h += '<div class="grilla-icono grilla-icono--vacia grilla-icono--vacia-sin" title="' + esc(pos.codigo) +
          ' · vacía (sin pallet)"><span class="grilla-icono-codigo">' + esc(pos.codigo) + '</span></div>';
        return;
      }
      const marcada = !!UI.selConjunto[pos.id];
      const puntoA = UI.rangoA === pos.id;
      let cls = 'grilla-icono grilla-icono--disponible';
      if (marcada) cls += ' grilla-icono--marcado';
      if (puntoA) cls += ' grilla-icono--punto-a';
      const titulo = pos.codigo + ' · disponible';
      h += '<button type="button" class="' + cls + '" title="' + esc(titulo) + '" onclick="tocarCuadrante(\'' + pos.id + '\')">' +
        '<span class="grilla-icono-codigo">' + esc(pos.codigo) + '</span>' +
        (marcada ? '<span class="grilla-icono-check">✓</span>' : '') +
        '</button>';
    });
  }
  return h;
}

/* Tarjeta de una bahía dentro del carrusel: cabecera + tomar toda + grilla. */
function bahiaTarjetaHTML(t, bahia, zona) {
  const tomables = tomablesBahia(t, bahia);
  return '<div class="bahia-tarjeta" id="bahia-' + bahia.id + '">' +
    '<div class="grupo-bahia-cab">' +
    '<span class="grupo-bahia-titulo">' + esc(bahia.codigo) + ' · ' + esc(zona ? zona.nombre : '') + '</span>' +
    '<span class="mini muted">' + tomables + ' disponibles</span>' +
    '</div>' +
    '<button type="button" class="btn btn-primario" style="width:100%;margin-bottom:8px" onclick="tomarBahiaUI(\'' + bahia.id + '\')">Tomar bahía (' + tomables + ')</button>' +
    '<div class="grilla-iconos">' + bahiaSeleccionHTML(t, bahia) + '</div>' +
    '</div>';
}

/* Contenido del carrusel: una tarjeta por bahía de la zona activa. */
function carruselBahiasHTML(t) {
  const zona = zonaActiva();
  if (!zona) return '';
  return bahiasDeZona(zona.id).map(b => bahiaTarjetaHTML(t, b, zona)).join('');
}

/* --- Carrusel horizontal SWEEP (scroll-snap, SIN botones) reutilizable ---
 * Se desliza con el dedo/rueda. Devuelve el wrap + las tarjetas + el indicador
 * (contador + dots). Usado por el clasificador y por el apartado de despacho. */
function carruselSweepHTML(carruselId, cardsHTML, n) {
  let dots = '';
  for (let i = 0; i < n; i++) dots += '<i class="carrusel-dot' + (i === 0 ? ' activo' : '') + '"></i>';
  return '<div class="carrusel-wrap">' +
    '<div class="carrusel-bahias" id="' + carruselId + '">' + cardsHTML + '</div>' +
    '</div>' +
    '<div class="carrusel-indicador">' +
    '<span class="carrusel-contador" id="' + carruselId + '-contador">1 de ' + n + '</span>' +
    '<span class="carrusel-dots" id="' + carruselId + '-dots">' + dots + '</span>' +
    '</div>';
}
function inicializarCarruselSweep(carruselId) {
  const carrusel = document.getElementById(carruselId);
  if (!carrusel) return;
  const actualizar = function () {
    const n = carrusel.children.length;
    if (!n) return;
    const paso = carrusel.clientWidth + 10; // 10 = gap entre tarjetas (ver CSS)
    const idx = Math.max(0, Math.min(n - 1, Math.round(carrusel.scrollLeft / (paso || 1))));
    const cont = document.getElementById(carruselId + '-contador');
    if (cont) cont.textContent = (idx + 1) + ' de ' + n;
    const dots = document.querySelectorAll('#' + carruselId + '-dots .carrusel-dot');
    if (dots && dots.forEach) dots.forEach((d, i) => d.classList.toggle('activo', i === idx));
  };
  actualizar();
  carrusel.addEventListener('scroll', actualizar, { passive: true });
}

/* Indicador "Bahía X de N" + dots (actualizado por scroll). */
function carruselIndicadorHTML() {
  const zona = zonaActiva();
  const n = zona ? bahiasDeZona(zona.id).length : 0;
  if (!n) return '';
  let dots = '';
  for (let i = 0; i < n; i++) dots += '<i class="carrusel-dot' + (i === 0 ? ' activo' : '') + '"></i>';
  return '<span class="carrusel-contador" id="carrusel-contador">Bahía 1 de ' + n + '</span>' +
    '<span class="carrusel-dots" id="carrusel-dots">' + dots + '</span>';
}

/* Actualiza el contador y los dots según la posición de scroll del carrusel. */
function actualizarIndicadorCarrusel() {
  const carrusel = document.getElementById('carrusel-bahias');
  const zona = zonaActiva();
  if (!carrusel || !zona) return;
  const n = bahiasDeZona(zona.id).length;
  if (!n) return;
  const paso = carrusel.clientWidth + 10; // 10 = gap entre tarjetas (ver CSS)
  const idx = Math.max(0, Math.min(n - 1, Math.round(carrusel.scrollLeft / (paso || 1))));
  const cont = document.getElementById('carrusel-contador');
  if (cont) cont.textContent = 'Bahía ' + (idx + 1) + ' de ' + n;
  const dots = document.querySelectorAll('#carrusel-dots .carrusel-dot');
  dots.forEach((d, i) => { d.classList.toggle('activo', i === idx); });
}

/* Instala la actualización del indicador por scroll (el elemento se recrea en
 * cada render del home; el listener vive en él y se descarta con él). */
function inicializarCarrusel() {
  const carrusel = document.getElementById('carrusel-bahias');
  if (!carrusel) return;
  actualizarIndicadorCarrusel();
  carrusel.addEventListener('scroll', actualizarIndicadorCarrusel, { passive: true });
}

/* Flechas ‹ › del carrusel: avanzan/retroceden una tarjeta (clientWidth + gap).
 * El indicador "Bahía X de N" se actualiza solo con el evento scroll. */
function navegarCarrusel(dir) {
  const carrusel = document.getElementById('carrusel-bahias');
  if (!carrusel) return;
  const paso = carrusel.clientWidth + 10; // 10 = gap entre tarjetas (ver CSS)
  const max = carrusel.scrollWidth - carrusel.clientWidth;
  const target = Math.max(0, Math.min(max, carrusel.scrollLeft + dir * paso));
  carrusel.scrollTo({ left: target, behavior: 'smooth' });
}

/* Re-renderiza SOLO el carrusel (conservando su scroll horizontal) +
 * instrucción + barra. El pan/zoom del mapa queda intacto. */
function actualizarSeleccionUI() {
  const t = yo();
  const inst = document.getElementById('sel-instruccion');
  if (inst) inst.innerHTML = selInstruccionHTML();
  const carrusel = document.getElementById('carrusel-bahias');
  if (carrusel) {
    const x = carrusel.scrollLeft;
    carrusel.innerHTML = t ? carruselBahiasHTML(t) : '';
    carrusel.scrollLeft = x;
    actualizarIndicadorCarrusel();
  }
  actualizarBarraToma();
}

/* Tap en un cuadrante de la grilla (selección por rango en 2 toques, SIEMPRE
 * activo, sin toggle).
 * - No tomable: se ignora.
 * - Primer toque: guarda el punto A y lo resalta.
 * - Tocar el MISMO cuadrante: cancela el punto A.
 * - Segundo toque en OTRO cuadrante de la MISMA bahía: cierra el rectángulo y
 *   añade sus posiciones tomables.
 * - Segundo toque en OTRA bahía: reinicia como nuevo punto A. */
function tocarCuadrante(posicionId) {
  const t = yo();
  if (!t) return;
  const pos = getPosicion(posicionId);
  if (!pos) return;
  const est = estadoPosicionPara(t.id, pos);
  if (est !== 'DISPONIBLE') return;
  UI.selConjunto = UI.selConjunto || {};
  if (!UI.rangoA) {
    UI.rangoA = posicionId;
  } else if (UI.rangoA === posicionId) {
    UI.rangoA = null;
  } else {
    const posA = getPosicion(UI.rangoA);
    if (!posA || posA.bahiaId !== pos.bahiaId) {
      // punto B en otra bahía: ese tap inicia un nuevo rango
      UI.rangoA = posicionId;
    } else {
      const porCodigo = {};
      posicionesDeBahia(posA.bahiaId).forEach(p => { porCodigo[p.codigo] = p; });
      calcularRango(posA.codigo, pos.codigo).forEach(cod => {
        const p = porCodigo[cod];
        if (!p) return;
        const ee = estadoPosicionPara(t.id, p);
        if (ee === 'DISPONIBLE') UI.selConjunto[p.id] = true;
      });
      UI.rangoA = null;
    }
  }
  actualizarSeleccionUI();
}

function actualizarBarraToma() {
  const n = Object.keys(UI.selConjunto || {}).filter(k => UI.selConjunto[k]).length;
  const barra = document.getElementById('barra-toma');
  if (barra) barra.style.display = n > 0 ? 'flex' : 'none';
  const elN = document.getElementById('toma-n');
  if (elN) elN.textContent = n;
  const btn = document.getElementById('btn-toma-sel');
  if (btn) btn.textContent = 'Tomar ' + n;
}
function limpiarSeleccion() {
  UI.selConjunto = {};
  UI.rangoA = null;
  actualizarSeleccionUI();
}
/* Tomar la selección marcada como conjunto */
function tomarSeleccion() {
  const t = yo();
  if (!t) return;
  const ids = Object.keys(UI.selConjunto || {}).filter(k => UI.selConjunto[k]);
  if (!ids.length) return;
  const res = tomarConjunto(t.id, ids);
  if (res.error) { alert(res.error); return; }
  UI.selConjunto = {};
  UI.rangoA = null;
  abrirPrimeroDelConjunto(res.pallets);
}
/* Tomar TODA la bahía como conjunto */
function tomarBahiaUI(bahiaId) {
  const t = yo();
  if (!t) return;
  const res = tomarConjunto(t.id, bahiaId);
  if (res.error) { alert(res.error); return; }
  UI.selConjunto = {};
  UI.rangoA = null;
  abrirPrimeroDelConjunto(res.pallets);
}
function abrirPrimeroDelConjunto() {
  iniciarConteoConjunto();
}
/* "Continuar clasificando": re-deriva el conjunto en curso y abre el primer
 * pallet EN_PROCESO (botón global, sin depender de variables locales). */
function continuarConjuntoUI() {
  const t = yo();
  if (!t) return;
  const conjunto = conjuntoDe(t.id);
  if (conjunto) abrirPrimeroDelConjunto(conjunto);
}
function soltarConjuntoUI() {
  const t = yo();
  if (!t) return;
  const ps = conjuntoDe(t.id);
  if (!ps) return;
  if (!confirm('¿Soltar tu conjunto (' + ps.length + ' pallets)? Los pallets no tocados vuelven DISPONIBLE (llenos).')) return;
  soltarConjunto(t.id);
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

/* Abre la pantalla de conteo del conjunto (un solo conteo de defectos). En el
 * modelo self-service el pallet ya existe y es del trabajador (lo garantiza
 * tomarPallet / Continuar clasificación). */
function iniciarConteoConjunto() {
  const t = yo();
  if (!t) { irA('home'); return; }
  const ps = conjuntoDe(t.id);
  if (!ps.length) { irA('home'); return; }
  UI.conteo = {
    conjuntoId: ps[0].conjuntoId,
    cats: Object.assign(conteoVacio(), ps[0].conteo), // parcial agregado del conjunto
    inicioTs: Date.now(),
  };
  irA('conteo');
}

/* --- Pantalla 4: Conteo del CONJUNTO (temporizador + 6 contadores agregados).
 * Ya no es pallet por pallet: un solo conteo de defectos para toda la bahía.
 * Sin total de cajas ni tipo: eso lo declara el muestreador al auditar. */
function pConteo() {
  const c = UI.conteo;
  if (!c) { irA('home'); return ''; }
  const t = yo();
  const ps = t ? conjuntoDe(t.id) : [];
  if (!ps.length) { irA('home'); return ''; }
  const bahia = (function () {
    const pos0 = getPosicion(ps[0].posicionId);
    return pos0 ? getBahia(pos0.bahiaId) : null;
  })();

  let h = '<div class="appbar"><button class="appbar-atras" onclick="salirConteo()">‹ Guardar</button>' +
    '<span class="appbar-titulo">Conjunto ' + esc(c.conjuntoId) + '</span></div>';
  h += '<p class="mini muted" style="margin:0 0 8px">' +
    (bahia ? etiquetaBahia(bahia) : 'conjunto propio') + ' · ' + ps.length + ' pallets</p>';
  h += '<div class="timer-caja">Tiempo <span id="t-contador">00:00</span></div>';

  h += '<div class="tarjeta-movil"><h3>Defectos encontrados (todo el conjunto)</h3>' +
    '<p class="mini muted" style="margin:0 0 6px">Cuenta las botellas defectuosas que vas sacando; es el total de la bahía, no por pallet.</p>';
  CATEGORIAS.forEach(cat => {
    const v = c.cats[cat.id] || 0;
    h += '<div class="fila-categoria">' +
      '<div class="cat-nombre">' + cat.nombre +
      '<span class="cat-detalle">' + cat.detalle + '</span></div>' +
      '<div class="cat-contador">' +
      '<button class="btn-salto" id="cat-s-menos10-' + cat.id + '" ' + (v < 10 ? 'disabled' : '') +
      ' onclick="ajustarCat(\'' + cat.id + '\',-10)">−10</button>' +
      '<button class="btn-salto" id="cat-s-menos5-' + cat.id + '" ' + (v < 5 ? 'disabled' : '') +
      ' onclick="ajustarCat(\'' + cat.id + '\',-5)">−5</button>' +
      '<button class="btn-contador" id="cat-menos-' + cat.id + '" ' + (v <= 0 ? 'disabled' : '') +
      ' onclick="ajustarCat(\'' + cat.id + '\',-1)">−</button>' +
      '<input type="text" inputmode="numeric" pattern="[0-9]*" class="cat-input" id="cat-' + cat.id + '" value="' + v + '" onchange="fijarCat(\'' + cat.id + '\', this.value)">' +
      '<button class="btn-contador" id="cat-mas-' + cat.id + '" onclick="ajustarCat(\'' + cat.id + '\',1)">+</button>' +
      '<button class="btn-salto" id="cat-s-mas5-' + cat.id + '" onclick="ajustarCat(\'' + cat.id + '\',5)">+5</button>' +
      '<button class="btn-salto" id="cat-s-mas10-' + cat.id + '" onclick="ajustarCat(\'' + cat.id + '\',10)">+10</button>' +
      '</div></div>';
  });
  h += '</div>';

  h += '<div class="tarjeta-movil">' +
    '<button class="btn btn-ok" style="width:100%" onclick="finalizarConteo()">Terminar conjunto</button>' +
    '<p class="mini muted" style="text-align:center;margin-top:6px">' + ps.length +
    ' pallets quedan CLASIFICADOS de una vez.</p>' +
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

/* Contadores agregados del CONJUNTO: enteros libres (sin tope por pallet).
 * Solo se deshabilita el "menos" al llegar a 0. */
function ajustarCat(catId, delta) {
  const c = UI.conteo;
  if (!c) return;
  c.cats[catId] = Math.max(0, (c.cats[catId] || 0) + delta);
  actualizarCatUI(catId);
}
function fijarCat(catId, valor) {
  const c = UI.conteo;
  if (!c) return;
  let n = parseInt(valor, 10);
  if (isNaN(n) || n < 0) n = 0;
  c.cats[catId] = n;
  actualizarCatUI(catId);
}
function actualizarCatUI(catId) {
  const c = UI.conteo;
  if (!c) return;
  const v = c.cats[catId] || 0;
  const input = document.getElementById('cat-' + catId);
  if (input) input.value = v;
  const btnMenos = document.getElementById('cat-menos-' + catId);
  if (btnMenos) btnMenos.disabled = v <= 0;
  const btnSMenos5 = document.getElementById('cat-s-menos5-' + catId);
  if (btnSMenos5) btnSMenos5.disabled = v < 5;
  const btnSMenos10 = document.getElementById('cat-s-menos10-' + catId);
  if (btnSMenos10) btnSMenos10.disabled = v < 10;
}

function salirConteo() {
  const c = UI.conteo;
  const tid = STATE.sesion.trabajadorId;
  if (c && tid) guardarConteoParcialConjunto(tid, c.cats); // guarda el parcial del conjunto
  UI.conteo = null;
  irA('home');
}
function finalizarConteo() {
  const c = UI.conteo;
  if (!c) return;
  const tid = STATE.sesion.trabajadorId;
  const ps = tid ? conjuntoDe(tid) : [];
  if (!tid || !ps.length) { UI.conteo = null; irA('home'); return; }
  if (!confirm('¿Terminar el conjunto ' + c.conjuntoId + ' (' + ps.length + ' pallets)?\n' +
    'Todos quedan CLASIFICADOS y listos para muestrear o despachar.')) { return; }
  UI.conteo = null;
  const res = finalizarConjunto(tid, c.cats);
  if (res.error) { alert(res.error); irA('home'); return; }
  alert(res.cantidad + ' pallets clasificados. ¡Buen trabajo!');
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

/* Detalle de asignación: por pallet el MUESTREADOR declara el tipo de caja
 * (12/24) y el total de cajas (prefill 84/80 según tipo; editable si el pallet
 * es puchito o el tipo no cuadra con su total). botellas_revisadas = total ×
 * tipo; input limitado; % en vivo; alerta ≥ 0.40%. */
function pMuestreoDetalle() {
  const a = getAsignacion(UI.asignacionVer);
  if (!a) { irA('muestrear'); return ''; }
  let h = '<div class="appbar"><button class="appbar-atras" onclick="irA(\'muestrear\')">‹</button>' +
    '<span class="appbar-titulo">' + a.id + '</span></div>';
  h += '<p class="mini muted" style="margin:0 0 10px">Declara el <strong>tipo de caja</strong> de cada pallet y revisa ' +
    'completo. Si es <strong>puchito</strong>, corrige el total de cajas con el valor real. ' +
    'botellas revisadas = total de cajas × botellas del tipo. Registra también <strong>en cuántas cajas</strong> ' +
    'aparecieron esas botellas malas (dato para reportes). MBFU% ≥ ' +
    REGLAS.UMBRAL_MBFU.toFixed(2) + '% → <strong>alerta</strong> para decisión del admin.</p>';

  a.palletIds.forEach(pid => {
    const p = getPallet(pid);
    if (!p) return;
    h += '<div class="tarjeta-movil"><h3>' + pid + '</h3>' +
      '<p class="mini muted">' + ubicacionPallet(p) + ' · clasificado por ' + esc(nombreTrabajador(p.clasificadoPor)) +
      ' · declaró ' + p.cajasTotales + ' cajas</p>';
    if (p.estado === 'CLASIFICADO') {
      const tipoIni = muestreoTipoInicial(p);
      const totalIni = muestreoTotalInicial(p, tipoIni);
      h += '<div class="campo" style="margin-top:6px"><label>Tipo de caja</label>' +
        '<div class="chips-total">' +
        '<button class="chip-total' + (tipoIni === 12 ? ' activo' : '') + '" id="chip-t12-' + pid +
        '" onclick="cambiarTipoMuestreo(\'' + pid + '\',12)">Caja 12</button>' +
        '<button class="chip-total' + (tipoIni === 24 ? ' activo' : '') + '" id="chip-t24-' + pid +
        '" onclick="cambiarTipoMuestreo(\'' + pid + '\',24)">Caja 24</button>' +
        '</div></div>' +
        '<div class="campo"><label>Total de cajas del pallet</label>' +
        '<input type="number" id="mtotal-' + pid + '" min="1" max="' + REGLAS.MAX_CAJAS_PALLET +
        '" value="' + totalIni + '" onchange="actualizarPct(\'' + pid + '\')"></div>' +
        '<div class="campo"><label>Botellas MBFU encontradas</label>' +
        '<input type="number" id="mbfu-' + pid + '" min="0" value="0" oninput="actualizarPct(\'' + pid + '\')"></div>' +
        '<div class="campo"><label>Cajas donde se encontraron esas botellas</label>' +
        '<input type="number" id="mcajas-' + pid + '" min="0" value="0" oninput="actualizarPct(\'' + pid + '\')">' +
        '<p class="mini muted" style="margin:4px 0 0">Cuántas cajas distintas traían botellas malas (ej.: 8 botellas en 3 cajas). Es el dato para concientizar en reportes.</p></div>' +
        '<p class="mini">Revisadas: <strong id="rev-' + pid + '">' + fmtMiles(totalIni * tipoIni) + '</strong> botellas · ' +
        'MBFU%: <strong id="pct-' + pid + '" class="cifra-ok">0.00%</strong> ' +
        '· cajas: <strong id="cajas-aviso-' + pid + '">0</strong> ' +
        '<span id="alerta-' + pid + '" style="display:none">' + chipAlerta() + '</span></p>' +
        '<button class="btn btn-primario" style="width:100%" onclick="enviarResultado(\'' + a.id + '\',\'' + pid + '\')">Enviar resultado</button>';
    } else {
      h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">Resultado: <strong class="' +
        (p.muestreo && p.muestreo.alerta ? 'cifra-alerta' : 'cifra-ok') + '">' +
        fmtPct(p.muestreo ? p.muestreo.pct : 0) + '</strong> ' + chipEstadoPallet(p.estado) +
        (p.muestreo && p.muestreo.alerta ? ' ' + chipAlerta() : '') +
        (p.muestreo ? ' <span class="muted">· ' + p.muestreo.botellas + ' botellas en ' + (p.muestreo.cajasMBFU || 0) + ' caja(s)</span>' : '') + '</p>';
    }
    h += '</div>';
  });
  return h;
}

/* Tipo/total inicial del muestreo: prefill por el tipo declarado del pallet
 * (12/24) y, si falta, por el total declarado al clasificar */
function muestreoTipoInicial(pallet) {
  if (pallet.tipoCaja === 12 || pallet.tipoCaja === 24) return pallet.tipoCaja;
  return inferirBotellasPorCaja(pallet.cajasTotales); // ≤80 → 24 (incluye puchito), >80 → 12
}
function muestreoTotalInicial(pallet, tipo) {
  // Si el total declarado "cuadra" con el tipo elegido, va prellenado (readonly);
  // si es puchito (≠84/80) o no cuadra con el tipo, el muestreador ingresa el real.
  if (pallet.cajasTotales === REGLAS.CAJAS_PALLET_CAJA12 && tipo === 12) return REGLAS.CAJAS_PALLET_CAJA12;
  if (pallet.cajasTotales === REGLAS.CAJAS_PALLET_CAJA24 && tipo === 24) return REGLAS.CAJAS_PALLET_CAJA24;
  return pallet.cajasTotales;
}
function muestreoEsEditable(pallet, tipo) {
  return muestreoTotalInicial(pallet, tipo) !== (tipo === 12 ? REGLAS.CAJAS_PALLET_CAJA12 : REGLAS.CAJAS_PALLET_CAJA24);
}
function muestreoRevisadasDe(pid) {
  const totalEl = document.getElementById('mtotal-' + pid);
  const t12 = document.getElementById('chip-t12-' + pid);
  const tipo = (t12 && (t12.className || '').indexOf('activo') !== -1) ? 12 : 24;
  const total = Math.max(1, parseInt(totalEl && totalEl.value, 10) || 0);
  return { tipo: tipo, total: total, revisadas: total * tipo };
}

/* Cambio de tipo de caja: actualiza prefill/readonly del total y el % en vivo */
function cambiarTipoMuestreo(pid, tipo) {
  const p = getPallet(pid);
  if (!p) return;
  const el12 = document.getElementById('chip-t12-' + pid);
  const el24 = document.getElementById('chip-t24-' + pid);
  if (el12 && el12.classList) el12.classList.toggle('activo', tipo === 12);
  if (el24 && el24.classList) el24.classList.toggle('activo', tipo === 24);
  const totalEl = document.getElementById('mtotal-' + pid);
  if (totalEl) {
    totalEl.value = muestreoTotalInicial(p, tipo);
  }
  actualizarPct(pid);
}

/* % calculado en vivo mientras se teclea (sin re-render) */
function actualizarPct(pid) {
  const cfg = muestreoRevisadasDe(pid);
  const elRev = document.getElementById('rev-' + pid);
  if (elRev) elRev.textContent = fmtMiles(cfg.revisadas);
  const input = document.getElementById('mbfu-' + pid);
  const n = Math.max(0, Math.min(cfg.revisadas, parseInt(input && input.value, 10) || 0));
  if (input && String(n) !== input.value) input.value = n;
  const cajasEl = document.getElementById('mcajas-' + pid);
  const cajas = Math.max(0, parseInt(cajasEl && cajasEl.value, 10) || 0);
  const cajasAviso = document.getElementById('cajas-aviso-' + pid);
  if (cajasAviso) {
    cajasAviso.textContent = cajas;
    cajasAviso.className = (cajas > n || cajas > cfg.total) ? 'cifra-alerta' : '';
  }
  const pct = pctMBFU(n, cfg.revisadas);
  const elPct = document.getElementById('pct-' + pid);
  const elAlerta = document.getElementById('alerta-' + pid);
  if (!elPct || !elAlerta) return;
  elPct.textContent = fmtPct(pct);
  const alerta = pct >= REGLAS.UMBRAL_MBFU;
  elPct.className = alerta ? 'cifra-alerta' : 'cifra-ok';
  elAlerta.style.display = alerta ? 'inline' : 'none';
}

function enviarResultado(asignacionId, pid) {
  const cfg = muestreoRevisadasDe(pid);
  const input = document.getElementById('mbfu-' + pid);
  const cajasEl = document.getElementById('mcajas-' + pid);
  const res = registrarMuestreo(pid, input.value, asignacionId, cfg.tipo, cfg.total, cajasEl ? cajasEl.value : 0);
  if (res.error) { alert(res.error); return; }
  if (res.alerta) {
    alert('Pallet ' + pid + ': ' + fmtPct(pctMBFU(parseInt(input.value, 10) || 0, cfg.revisadas)) +
      ' — queda EN ALERTA. El administrador decidirá si deja pasar o re-clasifica el conjunto.');
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
  h += '<div class="tarjeta-movil"><h3>Mis jornadas y conjuntos</h3>';
  if (!misJornadas.length) h += '<p class="muted mini">Aún no tienes jornadas.</p>';
  misJornadas.forEach(j => {
    const pallets = STATE.pallets.filter(p => p.jornadaId === j.id);
    const cajas = pallets.reduce((s, p) => s + p.cajasTotales, 0);
    h += '<div style="border-top:1px solid var(--borde);padding:8px 0">' +
      '<strong>' + j.fechaLabel + '</strong> · ' + textoSegmentos(j) +
      (j.terminada ? ' · terminada' : j.enPausa ? ' · en pausa' : '') +
      ' · <span class="mini muted">' + fmtDur(minutosActivos(j) * 60000) + ' activas · ' +
      cajas + ' cajas · ' + pallets.length + ' pallet(s)</span>';
    // agrupar por CONJUNTO: los conjuntos tomados en la jornada y sus pallets
    const porConjunto = {};
    const sinConjunto = [];
    pallets.forEach(p => {
      if (p.conjuntoId) (porConjunto[p.conjuntoId] = porConjunto[p.conjuntoId] || []).push(p);
      else sinConjunto.push(p);
    });
    Object.keys(porConjunto).forEach(cid => {
      const cj = porConjunto[cid];
      const hechos = cj.filter(p => p.estado !== 'EN_PROCESO' && p.estado !== 'DISPONIBLE').length;
      const totalDef = cj[0].conteo || {};
      const resumen = CATEGORIAS.filter(c => (totalDef[c.id] || 0) > 0)
        .map(c => totalDef[c.id] + ' ' + c.nombre.toLowerCase()).join(', ');
      h += '<p class="mini" style="margin:6px 0 0 8px"><span class="chip-contorno">' + cid + '</span> · ' +
        hechos + '/' + cj.length + ' clasificados</p>';
      if (resumen) h += '<p class="mini muted" style="margin:2px 0 0 18px">Defectos: ' + resumen + '</p>';
      cj.forEach(p => {
        h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 0 18px">' +
          p.id + ' · ' + ubicacionPallet(p) + ' · ' + p.cajasTotales + ' cajas · ' +
          chipEstadoPallet(p.estado) + '</p>';
      });
    });
    sinConjunto.forEach(p => {
      h += '<p class="mini" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 0 8px">' +
        p.id + ' · ' + ubicacionPallet(p) + ' · ' + p.cajasTotales + ' cajas · ' +
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
        fmtPct(p.muestreo.pct) + '</strong> (' + p.muestreo.botellas + ' botellas en ' + (p.muestreo.cajasMBFU || 0) + ' caja(s)) ' +
        chipEstadoPallet(p.estado) + (p.muestreo.alerta ? ' ' + chipAlerta() : '') + '</p>';
    });
    h += '</div>';
  });
  h += '</div>';
  return h;
}

/* ============================ VISTA OPERADOR ============================ */
function yoOperador() {
  const c = STATE.sesion.operadorId ? getOperador(STATE.sesion.operadorId) : null;
  if (!c || !c.activo) { STATE.sesion.operadorId = null; return null; }
  return c;
}
function irOperador(pantalla) {
  UI.pantallaOperador = pantalla;
  render();
}

function renderOperador() {
  const cont = document.getElementById('pantalla-operador');
  if (UI.pantallaOperador !== 'login' && !yoOperador()) UI.pantallaOperador = 'login';
  // El pan/zoom del mapa solo vive en el home; al salir se destruye.
  if (UI.pantallaOperador !== 'home') destruirMapaOperPanzoom();
  switch (UI.pantallaOperador) {
    case 'home': cont.innerHTML = oHome(); inicializarMapaOperPanzoom(); break;
    case 'cargues': cont.innerHTML = oCargues(); break;
    default: cont.innerHTML = oLogin();
  }
  if (UI.pantallaOperador === 'home' && UI.zonaDespOper) inicializarCarruselSweep('despCarruselOper');
}

function oLogin() {
  let h = '<div class="appbar"><span class="appbar-titulo">Calibra · Operador</span></div>';
  h += '<div class="tarjeta-movil"><h3>¿Quién opera?</h3>' +
    '<p class="muted mini">Selecciona tu nombre para entrar. Demo sin contraseña.</p></div>';
  h += '<div class="lista-opciones">';
  operadoresActivos().forEach(c => {
    h += '<button class="opcion-trabajador" onclick="loginOperador(\'' + c.id + '\');irOperador(\'home\')">' + esc(c.nombre) + '</button>';
  });
  h += '</div>';
  return h;
}

/* Home del operador = MAPA del almacén (misma estética dibujada que el
 * clasificador, con pan & zoom): los segmentos LISTO son tappables para
 * seleccionar los que va el trailer; lo demás es inerte. Pensado para decenas
 * de pallets LISTO: sobre el mapa se tocan los justos. Solo ve QUÉ retirar
 * (posición, cajas, clasificador) — nada de conteos ni MBFU (Q4.2). */
function oHome() {
  const c = yoOperador();
  const despachables = palletsDespachables();
  const sel = UI.despSel || {};
  let h = '<div class="appbar"><span class="appbar-titulo">Hola, ' + esc(c.nombre.split(' ')[0]) + '</span>' +
    '<button class="appbar-atras" onclick="logoutOperador()">Salir</button></div>';
  h += '<div class="tarjeta-movil"><h3>Pallets para despacho</h3>' +
    '<p class="mini muted"><strong>' + despachables.length + '</strong> despachable(s) — clasificados (verde) y certificados (teal). ' +
    'Toca « Seleccionar bahía (N) » para agarrar una bahía entera, o los segmentos sueltos. Al despachar, las posiciones quedan libres.</p></div>';
  if (!despachables.length) {
    h += '<div class="tarjeta-movil"><p class="muted mini">Nada por despachar por ahora. Aparecerán pallets clasificados (aunque no estén muestreados) y certificados.</p></div>';
  }
  h += '<div class="mini mapa-leyenda" style="margin-bottom:8px">' +
    '<span><i class="punto" style="background:' + ESTADO_PALLET.CLASIFICADO.color + '"></i>clasificado — sin muestrear</span>' +
    '<span><i class="punto" style="background:' + ESTADO_PALLET.LISTO.color + '"></i>listo (certificado)</span>' +
    '</div>';

  // Chips de seleccionados (removibles)
  const idsSel0 = Object.keys(sel).filter(pid => sel[pid]);
  h += '<div class="chips-sel" id="chips-sel">' + idsSel0.map(chipSelHtml).join('') + '</div>';

  // "Seleccionar todo" siempre disponible (pedido explícito)
  h += '<div class="fila-botones" style="margin-bottom:8px">' +
    '<button class="btn" onclick="seleccionarTodoOper()">Seleccionar todo</button>' +
    '<button class="btn" onclick="limpiarSeleccionOper()">Limpiar</button>' +
    '</div>';

  if (UI.zonaDespOper) {
    // APARTADO (como el clasificador): CARRUSEL SWEEP de bahías + grilla de cuadrados
    const z = zonaPorId(UI.zonaDespOper);
    const nB = z ? bahiasDeZona(z.id).length : 0;
    h += '<p class="mini muted" style="margin:0 0 8px">' + (z ? esc(z.nombre) : '') +
      ' — desliza entre bahías · clic y clic de nuevo para el rango, o «Seleccionar bahía».</p>';
    h += carruselSweepHTML('despCarruselOper', apartadoDespachoHTML(UI.zonaDespOper, UI.despSel, 'rangoDespOper', 'tocarCuadranteDespOper', 'seleccionarBahiaDespOperGrid'), nB);
    h += '<button class="btn" style="margin-top:8px" onclick="seleccionarZonaDespOper(null)">‹ Volver al mapa</button>';
  } else {
    // Mapa: clic en la zona abre su apartado de bahías
    h += '<p class="mini muted" style="margin:0 0 8px">Toca una zona para ver sus bahías y elegir los pallets.</p>';
    h += '<div class="mapamovil-viewport" id="opermapa-viewport">' +
      '<div class="mapa-herramientas mapa-herramientas-movil">' +
      '<button class="btn" title="Acercar" onclick="mapaOperZoomIn()">＋</button>' +
      '<button class="btn" title="Alejar" onclick="mapaOperZoomOut()">−</button>' +
      '<button class="btn btn-restablecer" title="Restablecer vista" onclick="mapaOperReset()">Restablecer</button>' +
      '</div>' +
      '<div class="mapamovil-ayuda">Arrastra para mover · pellizca para acercar</div>' +
      '<div class="mapamovil-lienzo" id="opermapa-lienzo">' +
      mapaAlmacenSketch(segOperador, { zonaClick: function (z) { return "seleccionarZonaDespOper('" + z.id + "')"; } }) +
      '</div></div>';
  }

  // Barra inferior fija: resumen de selección + despacho en lote
  const cajasSel = idsSel0.reduce((s, pid) => { const p = getPallet(pid); return s + (p ? p.cajasTotales : 0); }, 0);
  h += '<div class="barra-despacho" id="barra-despacho">' +
    '<span class="mini" id="desp-resumen">' + idsSel0.length + ' seleccionados · ' + fmtMiles(cajasSel) + ' cajas</span>' +
    '<button class="btn btn-ok btn-despachar" id="btn-despachar" ' + (idsSel0.length ? '' : 'disabled') +
    ' onclick="despacharSeleccionados()">Despachar ' + idsSel0.length + '</button></div>';
  h += '<div class="menu-grid">' +
    '<div class="menu-item" onclick="irOperador(\'cargues\')"><span class="menu-num">≡</span>Mis cargues</div>' +
    '</div>';
  return h;
}

/* Segmento del mapa del operador: CLASIFICADO (verde) y LISTO (teal) son
 * despachables; lo demás inerte. */
function segOperador(pos) {
  if (!pos) return '';
  if (!pos.activa) return '<div class="mapa-seg mapa-seg--hueco"></div>';
  const p = pos.palletId ? getPallet(pos.palletId) : null;
  if (!p) return '<div class="mapa-seg mapa-seg--libre-cond" title="' + pos.codigo + ' · vacía"></div>';
  if (!esDespachable(p)) {
    return '<div class="mapa-seg mapa-seg--inerte" title="' + pos.codigo + ' · ' +
      ESTADO_PALLET[p.estado].label + ' (no despachable)"></div>';
  }
  const esListo = p.estado === 'LISTO';
  const sel = UI.despSel && UI.despSel[p.id];
  const titulo = pos.codigo + ' · ' + p.id + ' · ' + p.cajasTotales + ' cajas · ' +
    (esListo ? 'certificado (LISTO)' : 'clasificado — sin muestrear') + ' · clasif. ' +
    nombreTrabajador(p.clasificadoPor) + ' · tocá la zona para seleccionar en la bahía';
  return '<div class="mapa-seg ' + (esListo ? 'mapa-seg--listo' : 'mapa-seg--clasificado-desp') +
    (sel ? ' mapa-seg--seleccionado' : '') + '" id="oper-seg-' + pos.id + '" title="' + esc(titulo) + '">' +
    esc(pos.codigo + (sel ? ' ✓' : '')) + '</div>';
}

/* --- Selección por RANGO de despacho (misma dinámica que el clasificador) ---
 * 1er toque: marca el punto A (resaltado). 2do toque:
 *  - la MISMA celda → alterna esa celda sola y limpia A.
 *  - otra celda de la MISMA bahía → selecciona el tramo A↔B y limpia A.
 *  - otra bahía → mueve A a la nueva celda.
 * Todo por DOM: conserva pan/zoom. Compartido por operador y admin. */
function tapSegDespachoRango(posicionId, selMap, segPrefix, rangoKey, refrescar) {
  const pos = getPosicion(posicionId);
  if (!pos || !pos.palletId) return;
  const p = getPallet(pos.palletId);
  if (!p || !esDespachable(p)) return;
  const A = UI[rangoKey];
  if (!A) {
    UI[rangoKey] = posicionId;
    marcarPuntoADespacho(segPrefix, posicionId);
    refrescar();
    return;
  }
  if (A === posicionId) {
    if (selMap[p.id]) delete selMap[p.id]; else selMap[p.id] = true;
    UI[rangoKey] = null;
    marcarPuntoADespacho(segPrefix, null);
    pintarSegmentosDespacho(selMap, segPrefix, pos.bahiaId);
    refrescar();
    return;
  }
  const posA = getPosicion(A);
  if (!posA || posA.bahiaId !== pos.bahiaId) {
    UI[rangoKey] = posicionId;
    marcarPuntoADespacho(segPrefix, posicionId);
    refrescar();
    return;
  }
  const porCodigo = {};
  posicionesDeBahia(posA.bahiaId).forEach(pp => { porCodigo[pp.codigo] = pp; });
  calcularRango(posA.codigo, pos.codigo).forEach(cod => {
    const pp = porCodigo[cod];
    if (!pp || !pp.palletId) return;
    const ppal = getPallet(pp.palletId);
    if (ppal && esDespachable(ppal)) selMap[ppal.id] = true;
  });
  UI[rangoKey] = null;
  marcarPuntoADespacho(segPrefix, null);
  pintarSegmentosDespacho(selMap, segPrefix, posA.bahiaId);
  refrescar();
}
/* Resalta el punto A (uno solo por vista). */
function marcarPuntoADespacho(segPrefix, posicionId) {
  if (typeof document.querySelectorAll === 'function') {
    const previos = document.querySelectorAll('.mapa-seg--punto-a');
    if (previos && previos.forEach) previos.forEach(el => el.classList.remove('mapa-seg--punto-a'));
  }
  if (!posicionId) return;
  const seg = document.getElementById(segPrefix + posicionId);
  if (seg) seg.classList.add('mapa-seg--punto-a');
}

function tapSegOperador(posicionId) {
  tapSegDespachoRango(posicionId, UI.despSel, 'oper-seg-', 'rangoDespOper', function () { actualizarBarraDespacho(); actualizarChipsSel(); });
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
    const seg = document.getElementById('oper-seg-' + p.posicionId);
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
  const res = despacharPallets(STATE.sesion.operadorId, ids);
  if (res.error) { alert(res.error); return; }
  alert(res.cantidad + ' pallets despachados. ¡A por el siguiente!');
}

/* --- Selección rápida de despacho (por bahía, como "Tomar bahía") ---
 * Compartido por operador (UI.despSel / prefijo 'oper-seg-') y admin
 * (UI.despSelAdmin / prefijo 'despadmin-seg-'). Actualiza las clases de los
 * segmentos por DOM: conserva el pan/zoom y no re-renderiza el mapa. */
function despachablesDeBahia(bahiaId) {
  return posicionesDeBahia(bahiaId)
    .map(pos => (pos.palletId ? getPallet(pos.palletId) : null))
    .filter(p => p && esDespachable(p));
}
function botonBahiaDespacho(b, handler) {
  const n = despachablesDeBahia(b.id).length;
  if (!n) return '';
  return '<button type="button" class="btn btn-tomar-bahia" onclick="' + handler + '(\'' + b.id + '\')">' +
    'Seleccionar bahía (' + n + ')</button>';
}
function pintarSegmentosDespacho(selMap, segPrefix, bahiaId) {
  const posiciones = bahiaId ? posicionesDeBahia(bahiaId) : STATE.posiciones;
  posiciones.forEach(pos => {
    if (!pos.palletId) return;
    const p = getPallet(pos.palletId);
    if (!p || !esDespachable(p)) return;
    const seg = document.getElementById(segPrefix + pos.id);
    if (!seg) return;
    const marcado = !!selMap[p.id];
    seg.classList.toggle('mapa-seg--seleccionado', marcado);
    seg.innerHTML = esc(pos.codigo + (marcado ? ' ✓' : ''));
  });
}
function agregarDespachoPorBahia(bahiaId, selMap, segPrefix, refrescar) {
  despachablesDeBahia(bahiaId).forEach(p => { selMap[p.id] = true; });
  pintarSegmentosDespacho(selMap, segPrefix, bahiaId);
  refrescar();
}
function agregarTodoDespacho(selMap, segPrefix, refrescar) {
  STATE.pallets.filter(esDespachable).forEach(p => { selMap[p.id] = true; });
  pintarSegmentosDespacho(selMap, segPrefix, null);
  refrescar();
}
function limpiarDespacho(selMap, segPrefix, refrescar) {
  Object.keys(selMap).forEach(k => delete selMap[k]);
  pintarSegmentosDespacho(selMap, segPrefix, null);
  refrescar();
}
/* Wrappers operador */
function seleccionarBahiaOper(bahiaId) {
  agregarDespachoPorBahia(bahiaId, UI.despSel, 'oper-seg-', function () { actualizarBarraDespacho(); actualizarChipsSel(); });
}
function seleccionarTodoOper() {
  agregarTodoDespacho(UI.despSel, 'oper-seg-', function () { actualizarBarraDespacho(); actualizarChipsSel(); });
}
function limpiarSeleccionOper() {
  limpiarDespacho(UI.despSel, 'oper-seg-', function () { actualizarBarraDespacho(); actualizarChipsSel(); });
}
/* Wrappers admin */
function seleccionarBahiaAdmin(bahiaId) {
  agregarDespachoPorBahia(bahiaId, UI.despSelAdmin, 'despadmin-seg-', function () { actualizarBarraDespachoAdmin(); actualizarChipsSelAdmin(); });
}
function seleccionarTodoAdmin() {
  agregarTodoDespacho(UI.despSelAdmin, 'despadmin-seg-', function () { actualizarBarraDespachoAdmin(); actualizarChipsSelAdmin(); });
}
function limpiarSeleccionAdmin() {
  limpiarDespacho(UI.despSelAdmin, 'despadmin-seg-', function () { actualizarBarraDespachoAdmin(); actualizarChipsSelAdmin(); });
}

/* Filtro de ZONA por botones (Todas / Zona 1 / Zona 2) para el despacho. */
function botonesZonaDespacho(zonaSel, handler) {
  let h = '<div class="fila-botones" style="margin-bottom:8px">' +
    '<button class="btn ' + (!zonaSel ? 'btn-primario' : '') + '" onclick="' + handler + '(null)">Todas las zonas</button>';
  STATE.zonas.forEach(z => {
    h += '<button class="btn ' + (zonaSel === z.id ? 'btn-primario' : '') + '" onclick="' + handler + '(\'' + z.id + '\')">' + esc(z.nombre) + '</button>';
  });
  h += '</div>';
  return h;
}
function seleccionarZonaDespOper(zonaId) { UI.zonaDespOper = zonaId; UI.rangoDespOper = null; render(); }
function seleccionarZonaDespAdmin(zonaId) { UI.zonaDespAdmin = zonaId; UI.rangoDespAdmin = null; render(); }
function zonaPorId(zonaId) { return STATE.zonas.filter(z => z.id === zonaId)[0] || null; }

/* --- APARTADO de seleccion de DESPACHO: grilla de CUADRADOS por bahia ----
 * Igual que el clasificador: clic en un cuadrado marca el punto A, y un
 * segundo clic en la MISMA bahia selecciona el rango. Se muestra al hacer clic
 * en una zona (como el carrusel de bahias del trabajador). */
function bahiaDespachoGridHTML(bahia, selMap, rangoKey, tapHandler) {
  const porCodigo = {};
  posicionesDeBahia(bahia.id).forEach(p => { porCodigo[p.codigo] = p; });
  let h = '';
  const pares = posicionesDeBahia(bahia.id).length / 2;
  for (let i = 1; i <= pares; i++) {
    ['A', 'B'].forEach(pref => {
      const pos = porCodigo[pref + i];
      if (!pos || !pos.activa) { h += '<div class="grilla-icono grilla-icono--hueco"></div>'; return; }
      const p = pos.palletId ? getPallet(pos.palletId) : null;
      if (!p || !esDespachable(p)) {
        h += '<div class="grilla-icono grilla-icono--inerte" title="' + esc(pos.codigo) + '">' +
          '<span class="grilla-icono-codigo">' + esc(pos.codigo) + '</span></div>';
        return;
      }
      const marcada = !!selMap[p.id];
      const puntoA = UI[rangoKey] === pos.id;
      let cls = 'grilla-icono ' + (p.estado === 'LISTO' ? 'grilla-icono--listo' : 'grilla-icono--clasificado');
      if (marcada) cls += ' grilla-icono--marcado';
      if (puntoA) cls += ' grilla-icono--punto-a';
      const titulo = pos.codigo + ' · ' + p.id + ' · ' + p.cajasTotales + ' cajas · ' + ESTADO_PALLET[p.estado].label +
        ' · clic para ' + (puntoA ? 'elegir el otro extremo' : 'marcar');
      h += '<button type="button" class="' + cls + '" title="' + esc(titulo) + '" onclick="' + tapHandler + '(\'' + pos.id + '\')">' +
        '<span class="grilla-icono-codigo">' + esc(pos.codigo) + '</span>' +
        (marcada ? '<span class="grilla-icono-check">✓</span>' : '') +
        '</button>';
    });
  }
  return h;
}
function bahiaDespachoTarjetaHTML(bahia, zona, selMap, rangoKey, tapHandler, bahiaHandler) {
  const n = despachablesDeBahia(bahia.id).length;
  return '<div class="bahia-tarjeta">' +
    '<div class="grupo-bahia-cab">' +
    '<span class="grupo-bahia-titulo">' + esc(bahia.codigo) + ' · ' + esc(zona ? zona.nombre : '') + '</span>' +
    '<span class="mini muted">' + n + ' despachable(s)</span>' +
    '</div>' +
    (n ? '<button type="button" class="btn btn-primario" style="width:100%;margin-bottom:8px" onclick="' + bahiaHandler + '(\'' + bahia.id + '\')">Seleccionar bahía (' + n + ')</button>' : '') +
    '<div class="grilla-iconos">' + bahiaDespachoGridHTML(bahia, selMap, rangoKey, tapHandler) + '</div>' +
    '</div>';
}
function apartadoDespachoHTML(zonaId, selMap, rangoKey, tapHandler, bahiaHandler) {
  const zona = zonaPorId(zonaId);
  if (!zona) return '';
  let h = '';
  bahiasDeZona(zona.id).forEach(b => { h += bahiaDespachoTarjetaHTML(b, zona, selMap, rangoKey, tapHandler, bahiaHandler); });
  return h;
}
/* Rango de 2 toques sobre la cuadricula (misma logica que tocarCuadrante). */
function tocarCuadranteDespacho(posicionId, selMap, rangoKey, refrescar) {
  const pos = getPosicion(posicionId);
  if (!pos || !pos.palletId) return;
  const p = getPallet(pos.palletId);
  if (!p || !esDespachable(p)) return;
  const A = UI[rangoKey];
  if (!A) {
    UI[rangoKey] = posicionId;
  } else if (A === posicionId) {
    if (selMap[p.id]) delete selMap[p.id]; else selMap[p.id] = true;
    UI[rangoKey] = null;
  } else {
    const posA = getPosicion(A);
    if (!posA || posA.bahiaId !== pos.bahiaId) {
      UI[rangoKey] = posicionId;
    } else {
      const porCodigo = {};
      posicionesDeBahia(posA.bahiaId).forEach(pp => { porCodigo[pp.codigo] = pp; });
      calcularRango(posA.codigo, pos.codigo).forEach(cod => {
        const pp = porCodigo[cod];
        if (!pp || !pp.palletId) return;
        const ppal = getPallet(pp.palletId);
        if (ppal && esDespachable(ppal)) selMap[ppal.id] = true;
      });
      UI[rangoKey] = null;
    }
  }
  refrescar();
}
function tocarCuadranteDespOper(posicionId) { tocarCuadranteDespacho(posicionId, UI.despSel, 'rangoDespOper', function () { render(); }); }
function tocarCuadranteDespAdmin(posicionId) { tocarCuadranteDespacho(posicionId, UI.despSelAdmin, 'rangoDespAdmin', function () { render(); }); }
function seleccionarBahiaDespOperGrid(bahiaId) { agregarDespachoPorBahia(bahiaId, UI.despSel, 'oper-seg-', function () { render(); }); }
function seleccionarBahiaDespAdminGrid(bahiaId) { agregarDespachoPorBahia(bahiaId, UI.despSelAdmin, 'despadmin-seg-', function () { render(); }); }

/* Mis cargues: historial de lo que este operador despachó (hora, pallet, ubicación) */
function oCargues() {
  const c = yoOperador();
  const cargues = carguesDe(c.id);
  let h = '<div class="appbar"><button class="appbar-atras" onclick="irOperador(\'home\')">‹</button>' +
    '<span class="appbar-titulo">Mis cargues</span></div>';
  h += '<div class="tarjeta-movil"><h3>Historial de despachos</h3>';
  if (!cargues.length) {
    h += '<p class="muted mini">Aún no has despachado pallets. Los que retires aparecerán aquí con su hora.</p>';
  }
  cargues.forEach(p => {
    h += '<div class="fila-disponible">' +
      '<div class="mini"><strong>' + p.id + '</strong> · ' + ubicacionPallet(p) + '<br>' +
      '<span class="muted">' + p.cajasTotales + ' cajas' +
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
    ['despacho', 'Despacho'],
    ['muestreo', 'Asignar muestreo'],
    ['decisiones', 'Decisiones de muestreo' + (nAlertas ? ' (' + nAlertas + ')' : '')],
    ['trabajadores', 'Personal'],
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
    case 'despacho': cont.innerHTML = aDespacho(); break;
    case 'muestreo': cont.innerHTML = aAsignarMuestreo(); break;
    case 'decisiones': cont.innerHTML = aDecisiones(); break;
    case 'trabajadores': cont.innerHTML = aTrabajadores(); break;
    default: cont.innerHTML = aBI();
  }
  // El pan/zoom del mapa se (re)inicializa tras cada render de ese tab y se
  // destruye al salir de él (el zoom se resetea al cambiar de tab: aceptable).
  // En el tab de muestreo el modo manual monta su propio mapa y su pan/zoom.
  if (UI.tab === 'mapa' || UI.tab === 'despacho') inicializarMapaPanzoom();
  else if (UI.tab === 'muestreo' && UI.modoMuestreo === 'manual') mostrarTandaManual();
  else destruirMapaPanzoom();
  if (UI.tab === 'despacho' && UI.zonaDespAdmin) inicializarCarruselSweep('despCarruselAdmin');
}

/* --- Tab 1: BI en vivo --- */
function aBI() {
  // Meta del día: referencia del almacén (no cuota personal)
  const clasifHoy = palletsClasificadosHoy();
  let h = '<div class="seccion"><h2>Avance vs meta del día</h2><div class="reticula reticula-2">' +
    '<div class="tarjeta"><h3>Meta del día</h3>' +
    '<p><span class="cifra-grande">' + STATE.metaDelDia + '</span>' +
    ' <span class="mini muted">pallets esperados (la fija el admin en la apertura)</span></p></div>' +
    '<div class="tarjeta"><h3>Clasificados hoy</h3>' +
    '<p><span class="cifra-grande" style="color:var(--ok)">' + clasifHoy + '</span>' +
    ' <span class="mini muted">pallets clasificados hoy (todos los trabajadores)</span></p>' +
    barra(STATE.metaDelDia ? clasifHoy / STATE.metaDelDia * 100 : 0, 'var(--ok)') +
    '</div></div></div>';

  // Contadores de despacho en vivo
  const desp = contadoresDespacho();
  h += '<div class="seccion"><h2>Despacho en vivo</h2><div class="reticula reticula-3">' +
    '<div class="tarjeta"><h3>Para despachar</h3>' +
    '<p><span class="cifra-grande" style="color:' + ESTADO_PALLET.LISTO.color + '">' + desp.despachables + '</span>' +
    ' <span class="mini muted">' + desp.clasificados + ' clasificado(s) sin muestrear · ' + desp.listos + ' listo(s)</span></p></div>' +
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

  // Actividad por clasificador EN CONJUNTOS (la unidad de medición del trabajo)
  h += '<div class="seccion"><h2>Actividad por clasificador (en conjuntos)</h2><div class="reticula reticula-2">';
  const actividad = actividadPorClasificador();
  if (!actividad.length) h += '<div class="tarjeta"><p class="muted">Sin actividad registrada todavía.</p></div>';
  actividad.forEach(item => {
    h += '<div class="tarjeta"><h3>' + esc(item.nombre) + '</h3>' +
      '<p><span class="cifra-grande">' + item.conjuntos + '</span> <span class="muted">conjunto(s) tomado(s)</span> · ' +
      '<span class="cifra-grande" style="color:var(--ok)">' + item.completados + '</span> <span class="muted">completado(s)</span></p>' +
      '<p class="mini muted">' + item.pallets + ' pallets trabajados en total</p></div>';
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
        ' <span class="mini muted">(' + p.muestreo.botellas + ' de ' + botellasRevisadas(p) + ' botellas revisadas · en ' + (p.muestreo.cajasMBFU || 0) + ' caja(s))</span></p>' +
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
function panelLateralAdmin() {
  const sel = UI.mapaSel;
  const celdasSel = celdasSeleccionadas();

  let h = '<h2>Acciones</h2>';

  // Selección actual → acciones del seleccionado (modelo "seleccionar → actuar")
  if (celdasSel.length) {
    let pendientes = 0, inactivas = 0, vaciasActivas = 0, disponibles = 0;
    celdasSel.forEach(id => {
      const pos = getPosicion(id);
      if (!pos) return;
      const pallet = pos.palletId ? getPallet(pos.palletId) : null;
      if (!pallet) {
        pendientes++;
        if (!pos.activa) inactivas++;
        else vaciasActivas++;
      } else if (pallet.estado === 'DISPONIBLE') {
        disponibles++;
      }
    });
    h += '<div class="campo"><label>Celdas seleccionadas</label>' +
      '<p class="mini" style="margin:0 0 6px">' + celdasSel.length + (celdasSel.length === 1 ? ' celda' : ' celdas') + ' · ' +
      pendientes + (pendientes === 1 ? ' pendiente' : ' pendientes') + ' · ' +
      disponibles + (disponibles === 1 ? ' disponible' : ' disponibles') + '</p>' +
      '<label class="mini muted">Tipo de caja</label><div class="chips-total">' +
      '<button class="chip-total activo" id="chip-celda-12" onclick="setTipoCelda(12)">Caja 12</button>' +
      '<button class="chip-total" id="chip-celda-24" onclick="setTipoCelda(24)">Caja 24</button>' +
      '</div>' +
      '<div class="fila-form" style="grid-template-columns:1fr auto;gap:8px;margin-bottom:8px">' +
      '<label class="mini muted" style="align-self:center">Total de cajas</label>' +
      '<input type="number" id="form-celda-total" min="1" max="' + REGLAS.CAJAS_PALLET_CAJA12 + '" value="' + REGLAS.CAJAS_PALLET_CAJA12 + '">' +
      '</div>' +
      '<div class="fila-botones" style="flex-direction:column">';
    if (pendientes > 0) {
      h += '<button class="btn btn-primario" onclick="abastecerCeldasUI()">Abastecer (' + pendientes + ')</button>';
    }
    if (disponibles > 0) {
      h += '<button class="btn" onclick="cambiarTotalCeldasUI()">Cambiar total (' + disponibles + ')</button>' +
        '<button class="btn btn-peligro" onclick="vaciarCeldasUI()">Vaciar (' + disponibles + ')</button>';
    }
    if (inactivas > 0) {
      h += '<button class="btn" onclick="activarCeldasUI()">Activar (' + inactivas + ')</button>';
    }
    if (vaciasActivas > 0) {
      h += '<button class="btn" onclick="desactivarCeldasUI()">Desactivar (' + vaciasActivas + ')</button>';
    }
    h += '</div>' +
      '<button class="btn" style="margin-top:10px" onclick="limpiarSeleccionMapa()">Limpiar selección</button>' +
      '</div>';
  } else if (!sel) {
    h += '<p class="mini muted">Seleccioná una celda, bahía o zona para ver sus acciones.</p>';
  } else if (sel.tipo === 'bahia') {
    const b = getBahia(sel.id);
    if (b) {
      const av = avanceBahia(b);
      const est = estadoBahia(b);
      const posiciones = posicionesDeBahia(b.id);
      const nPendientes = posiciones.filter(p => !p.palletId).length;
      const nInactivas = posiciones.filter(p => !p.palletId && !p.activa).length;
      const nVaciasActivas = posiciones.filter(p => !p.palletId && p.activa).length;
      const nDisponibles = posiciones.filter(p => p.palletId && getPallet(p.palletId) && getPallet(p.palletId).estado === 'DISPONIBLE').length;
      h += '<div class="campo"><label>Bahía seleccionada</label>' +
        '<p class="mini" style="margin:0 0 6px">' + etiquetaBahia(b) + ' · ' + nPendientes + ' pendientes</p>' +
        '<div class="panel-bahia" style="margin:0 0 10px"><h3 style="margin:0 0 6px">' + chipEstadoBahia(est) + '</h3>' +
        '<p class="mini">Avance: ' + av.x + '/' + av.n + ' clasificadas</p>' +
        barra(av.n ? av.x / av.n * 100 : 0, est === 'COMPLETADA' ? 'var(--ok)' : 'var(--proceso)') +
        '</div>';
      h += '<div class="fila-botones" style="flex-direction:column">';
      if (nPendientes > 0) {
        h += '<div class="campo" style="margin-bottom:8px"><label>Tipo de caja</label>' +
          '<div class="chips-total">' +
          '<button class="chip-total activo" id="chip-bahia-12" onclick="setTipoBahia(12)">Caja 12</button>' +
          '<button class="chip-total" id="chip-bahia-24" onclick="setTipoBahia(24)">Caja 24</button>' +
          '</div></div>' +
          '<button class="btn btn-primario" onclick="abastecerBahiaUI(\'' + b.id + '\')">Abastecer bahía</button>';
      }
      if (nInactivas > 0) {
        h += '<button class="btn" onclick="activarPendientesBahiaUI(\'' + b.id + '\')">Activar pendientes (' + nInactivas + ')</button>';
      }
      if (nVaciasActivas > 0) {
        h += '<button class="btn" onclick="desactivarVaciasBahiaUI(\'' + b.id + '\')">Desactivar vacías (' + nVaciasActivas + ')</button>';
      }
      if (nDisponibles > 0) {
        h += '<button class="btn btn-peligro" onclick="vaciarBahiaUI(\'' + b.id + '\')">Vaciar bahía (deshacer)</button>';
      }
      if (nPendientes === 0 && nInactivas === 0 && nVaciasActivas === 0 && nDisponibles === 0) {
        h += '<p class="mini muted">No hay acciones pendientes para esta bahía.</p>';
      }
      h += '</div>' +
        '<button class="btn" style="margin-top:10px" onclick="limpiarSeleccionMapa()">Limpiar selección</button>' +
        '</div>';
    } else {
      h += '<p class="mini muted">Bahía no encontrada.</p>';
    }
  } else if (sel.tipo === 'zona') {
    const z = STATE.zonas.filter(x => x.id === sel.id)[0];
    if (z) {
      const cap = capacidadZona(z.id);
      const ocup = ocupadasZona(z.id);
      h += '<div class="campo"><label>Zona seleccionada</label>' +
        '<p class="mini" style="margin:0 0 6px"><strong>' + z.nombre + '</strong></p>' +
        '<p class="mini">Capacidad: <strong>' + cap + '</strong> · Ocupadas: <strong>' + ocup + '</strong></p>' +
        '<p class="mini">Avance: ' + ocup + '/' + cap + ' ocupadas</p>' +
        barra(cap ? ocup / cap * 100 : 0, 'var(--proceso)') +
        '<button class="btn" style="margin-top:10px" onclick="limpiarSeleccionMapa()">Limpiar selección</button>' +
        '</div>';
    } else {
      h += '<p class="mini muted">Zona no encontrada.</p>';
    }
  }

  h += '<p class="mini muted" style="margin-top:10px">Clic en una celda/bahía/zona para ver y ejecutar sus acciones acá.</p>';
  return h;
}

/* Sección "Almacén" del panel lateral del mapa admin: meta del día + resumen +
 * leyenda. Vive separada de "Acciones" para no mezclar el alcance global del
 * almacén con las acciones del elemento seleccionado. */
function panelAlmacenAdmin() {
  const totalCap = STATE.posiciones.filter(p => p.activa).length;
  const totalOcup = STATE.posiciones.filter(p => p.activa && p.palletId).length;
  const disponibles = STATE.pallets.filter(p => p.estado === 'DISPONIBLE').length;
  const totalCajasDisp = STATE.pallets.filter(p => p.estado === 'DISPONIBLE').reduce((s, p) => s + p.cajasTotales, 0);
  const vacias = STATE.posiciones.filter(p => p.activa && !p.palletId).length;

  let h = '<h2 style="margin-top:20px;padding-top:16px;border-top:1px solid var(--borde)">Almacén</h2>';

  // Meta del día
  h += '<div class="campo"><label>Meta del día (pallets)</label>' +
    '<div class="fila-form" style="grid-template-columns:1fr auto;gap:8px">' +
    '<input type="number" id="form-meta-dia" min="1" value="' + STATE.metaDelDia + '">' +
    '<button class="btn btn-primario" onclick="fijarMetaDelDiaUI()">Fijar</button>' +
    '</div></div>';

  // Resumen general
  h += '<div class="tarjeta" style="margin-top:12px"><h3>Resumen</h3>' +
    '<p class="mini">Disponibles: <strong>' + disponibles + '</strong></p>' +
    '<p class="mini">Posiciones vacías: <strong>' + vacias + '</strong></p>' +
    '<p class="mini">Total abastecido: <strong>' + totalCajasDisp + ' cajas</strong></p>' +
    '<p class="mini">Capacidad: <strong>' + totalCap + '</strong> activas · <strong>' + totalOcup + '</strong> ocupadas</p>' +
    '</div>';

  // Leyenda de abastecimiento (siempre visible)
  h += '<div class="tarjeta" style="margin-top:12px"><h3>Leyenda</h3>' +
    '<div class="mini" style="display:flex;flex-direction:column;gap:4px">' +
    '<span><i class="punto" style="background:#0ea5e9"></i>caja 12</span>' +
    '<span><i class="punto" style="background:#7c3aed"></i>caja 24</span>' +
    '<span><i class="punto" style="background:#fff;border:2px dashed #64748b"></i>puchito</span>' +
    '<span><i class="punto" style="background:#f0fdf4;border:2px solid #bbf7d0"></i>vacía</span>' +
    '<span><i class="punto" style="background:#e5e7eb;border:2px dashed #cbd5e1"></i>inactiva</span>' +
    '</div></div>';

  return h;
}

function aMapa() {
  let h = '<div class="mapa-layout">' +
    '<div class="mapa-col">' +
    '<h2>Mapa del almacén</h2>' +
    '<div class="mapa-viewport" id="mapa-viewport">' +
    '<div class="mapa-herramientas">' +
    '<button class="btn" title="Acercar" onclick="mapaZoomIn()">＋</button>' +
    '<button class="btn" title="Alejar" onclick="mapaZoomOut()">−</button>' +
    '<button class="btn btn-restablecer" title="Restablecer vista" onclick="mapaReset()">Restablecer</button>' +
    '</div>' +
    '<div class="mapa-ayuda">Arrastra para mover · rueda para acercar</div>' +
    '<div class="mapa-lienzo" id="mapa-lienzo">' +
    mapaAlmacenSketch(segPosicionAdmin, {
      zonaClick: function (z) { return "seleccionarZonaMapa('" + z.id + "')"; },
      zonaSel: function (z) {
        return (UI.mapaSel && UI.mapaSel.tipo === 'zona' && UI.mapaSel.id === z.id) ? ' mapa-zona--sel' : '';
      },
      zonaInfo: function (z) {
        return 'capacidad ' + capacidadZona(z.id) + ' · ocupadas ' + ocupadasZona(z.id);
      },
      bahiaCab: function (b) {
        const av = avanceBahia(b);
        const est = estadoBahia(b);
        const sel = UI.mapaSel && UI.mapaSel.tipo === 'bahia' && UI.mapaSel.id === b.id;
        return '<div class="mapa-bahia-cab-sketch' + (sel ? ' mapa-bahia-cab-sketch--sel' : '') +
          '" title="' + b.codigo + ' · clic para ver acciones" onclick="event.stopPropagation(); seleccionarBahiaMapa(\'' + b.id + '\')">' +
          chipEstadoBahia(est) + '<span class="mini muted">' + av.x + '/' + av.n + '</span></div>';
      }
    }) +
    '</div></div>' +
    '</div>' +
    '<div class="mapa-panel-lateral">' + panelLateralAdmin() + panelAlmacenAdmin() + '</div>' +
    '</div>';
  return h;
}

/* Selección del mapa admin (modelo "seleccionar → actuar"): el clic en una
 * CELDA marca/desmarca (selección múltiple); bahía y zona siguen siendo
 * selección simple y limpian la selección de celdas (y viceversa). */
function seleccionarCeldaMapa(id) {
  UI.mapaSelCeldas = UI.mapaSelCeldas || {};
  if (UI.mapaSelCeldas[id]) delete UI.mapaSelCeldas[id];
  else UI.mapaSelCeldas[id] = true;
  UI.mapaSel = null;
  render();
}
function seleccionarBahiaMapa(id) {
  UI.mapaSel = { tipo: 'bahia', id: id };
  UI.mapaSelCeldas = {};
  render();
}
function seleccionarZonaMapa(id) {
  UI.mapaSel = { tipo: 'zona', id: id };
  UI.mapaSelCeldas = {};
  render();
}
function limpiarSeleccionMapa() {
  UI.mapaSel = null;
  UI.mapaSelCeldas = {};
  render();
}
/* Chip "Tipo de caja" del panel de la celda seleccionada: activa 12 o 24. */
function setTipoCelda(tipo) {
  const el12 = document.getElementById('chip-celda-12');
  const el24 = document.getElementById('chip-celda-24');
  if (el12) el12.classList.toggle('activo', tipo === 12);
  if (el24) el24.classList.toggle('activo', tipo === 24);
  // El tipo manda: el total arranca en el pallet completo de ese tipo y no lo
  // puede superar (caja 12 ≤ 84, caja 24 ≤ 80).
  const total = document.getElementById('form-celda-total');
  if (total) {
    const completo = completoCajasDe(tipo);
    total.max = completo;
    total.value = completo;
  }
}
/* Lee el tipo de caja marcado en los chips (default 12 si ninguno está activo). */
function tipoCeldaActual() {
  const el24 = document.getElementById('chip-celda-24');
  return (el24 && el24.classList.contains('activo')) ? 24 : 12;
}
/* Ids de las celdas actualmente marcadas en el mapa admin. */
function celdasSeleccionadas() {
  return Object.keys(UI.mapaSelCeldas || {}).filter(id => UI.mapaSelCeldas[id]);
}
/* Lee total + tipo y abastece las celdas seleccionadas en bloque. */
function abastecerCeldasUI() {
  const el = document.getElementById('form-celda-total');
  const res = abastecerPosiciones(celdasSeleccionadas(), el ? el.value : REGLAS.CAJAS_PALLET_CAJA12, tipoCeldaActual());
  if (res.error) { alert(res.error); return; }
  UI.mapaSelCeldas = {};
  render();
  alert(res.cantidad + ' pallets abastecidos.');
}
/* Lee total + tipo y cambia el total de los DISPONIBLES seleccionados. */
function cambiarTotalCeldasUI() {
  const el = document.getElementById('form-celda-total');
  if (!el) return;
  const res = cambiarTotalPosiciones(celdasSeleccionadas(), el.value, tipoCeldaActual());
  if (res.error) { alert(res.error); return; }
  UI.mapaSelCeldas = {};
  render();
  alert(res.cantidad + ' pallets actualizados.');
}

/* Vacía los pallets DISPONIBLES de las celdas seleccionadas (confirm por ser
 * destructivo). */
function vaciarCeldasUI() {
  if (!confirm('Vaciar los pallets DISPONIBLES de las celdas seleccionadas? Las posiciones quedan vacías.')) return;
  const res = vaciarPosiciones(celdasSeleccionadas());
  if (res.error) { alert(res.error); return; }
  UI.mapaSelCeldas = {};
  render();
}

/* Activa las celdas seleccionadas que están inactivas y sin pallet. */
function activarCeldasUI() {
  const res = activarPosiciones(celdasSeleccionadas());
  if (res.error) { alert(res.error); return; }
  UI.mapaSelCeldas = {};
  render();
}

/* Desactiva las celdas seleccionadas que están activas y sin pallet. */
function desactivarCeldasUI() {
  const res = desactivarPosiciones(celdasSeleccionadas());
  if (res.error) { alert(res.error); return; }
  UI.mapaSelCeldas = {};
  render();
}
/* Deshacer el "abastecer bahía" completo (solo pallets DISPONIBLES). */
function vaciarBahiaUI(bahiaId) {
  const b = getBahia(bahiaId);
  const n = posicionesDeBahia(bahiaId).filter(p => p.palletId && getPallet(p.palletId) && getPallet(p.palletId).estado === 'DISPONIBLE').length;
  if (!n) { alert('La bahía no tiene pallets DISPONIBLES para vaciar.'); return; }
  if (!confirm('Vaciar ' + (b ? etiquetaBahia(b) : bahiaId) + ': se retiran ' + n +
    ' pallet(s) DISPONIBLE(s). Las posiciones quedan vacías. ¿Continuar?')) return;
  const res = vaciarBahia(bahiaId);
  if (res.error) alert(res.error);
}

/* Chips "Tipo de caja" del panel de bahía: el total es el pallet completo del tipo. */
function setTipoBahia(tipo) {
  const el12 = document.getElementById('chip-bahia-12');
  const el24 = document.getElementById('chip-bahia-24');
  if (el12) el12.classList.toggle('activo', tipo === 12);
  if (el24) el24.classList.toggle('activo', tipo === 24);
}
function tipoBahiaActual() {
  const el24 = document.getElementById('chip-bahia-24');
  return (el24 && el24.classList.contains('activo')) ? 24 : 12;
}
/* Abastece la bahía con el pallet completo del tipo elegido (caja 12 → 84 · caja 24 → 80). */
function abastecerBahiaUI(bahiaId) {
  const tipo = tipoBahiaActual();
  abastecerPendientesBahiaUI(bahiaId, completoCajasDe(tipo), tipo);
}

/* Abastece TODAS las posiciones pendientes (sin pallet) de una bahía con el
 * total elegido; las inactivas se activan en silencio. Confirm corto: N + total. */
function abastecerPendientesBahiaUI(bahiaId, cajasTotales, tipoCaja) {
  const b = getBahia(bahiaId);
  const n = posicionesDeBahia(bahiaId).filter(p => !p.palletId).length;
  const total = parseInt(cajasTotales, 10);
  const rotulo = total === 84 ? '84 (caja 12)' : (total === 80 ? '80 (caja 24)' : total + ' (puchito)');
  if (!confirm('Abastecer las ' + n + ' posiciones pendientes de ' + (b ? etiquetaBahia(b) : bahiaId) + ' con ' + rotulo + '?\nNo se tocan las posiciones que ya tienen pallet.')) return;
  const res = abastecerPendientesBahia(bahiaId, cajasTotales, tipoCaja);
  if (res.error) alert(res.error);
  else alert(res.cantidad + ' pallets abastecidos (' + rotulo + ').');
}

/* Activa las posiciones inactivas pendientes (sin pallet). Sin confirm. */
function activarPendientesBahiaUI(bahiaId) {
  const res = activarPendientesBahia(bahiaId);
  if (res.error) alert(res.error);
}

/* Desactiva las posiciones vacías activas (sin pallet). Sin confirm. */
function desactivarVaciasBahiaUI(bahiaId) {
  const res = desactivarVaciasBahia(bahiaId);
  if (res.error) alert(res.error);
}

function fijarMetaDelDiaUI() {
  const el = document.getElementById('form-meta-dia');
  if (!el) return;
  const res = fijarMetaDelDia(el.value);
  if (res.error) alert(res.error);
}

/* --- Tab 3: Despacho (Admin) — misma función que el Operador --- */
function aDespacho() {
  const desp = contadoresDespacho();
  const sel = UI.despSelAdmin || {};
  const idsSel = Object.keys(sel).filter(pid => sel[pid]);
  let h = '<div class="seccion"><h2>Despacho (administrador)</h2>' +
    '<p class="mini muted">Despachables: <strong>' + desp.clasificados + '</strong> clasificado(s) sin muestrear y <strong>' +
    desp.listos + '</strong> certificado(s) (LISTO). Tocá una zona para ver sus bahías y elegir por rango (clic + clic), o «Seleccionar bahía» / «Seleccionar todo». Bloqueados: en proceso y en muestreo.</p>' +
    '<div class="mini mapa-leyenda">' +
    '<span><i class="punto" style="background:' + ESTADO_PALLET.CLASIFICADO.color + '"></i>clasificado — sin muestrear</span>' +
    '<span><i class="punto" style="background:' + ESTADO_PALLET.LISTO.color + '"></i>listo (certificado)</span>' +
    '<span><i class="punto" style="background:#e2e8f0"></i>no despachable</span>' +
    '</div>';

  h += '<div class="chips-sel" id="chips-sel-admin">' + idsSel.map(chipSelDespAdminHtml).join('') + '</div>';

  h += '<div class="fila-botones" style="margin-bottom:8px">' +
    '<button class="btn" onclick="seleccionarTodoAdmin()">Seleccionar todo</button>' +
    '<button class="btn" onclick="limpiarSeleccionAdmin()">Limpiar</button>' +
    '</div>';

  if (UI.zonaDespAdmin) {
    // APARTADO (como el clasificador): CARRUSEL SWEEP de bahías + grilla de cuadrados
    const z = zonaPorId(UI.zonaDespAdmin);
    const nB = z ? bahiasDeZona(z.id).length : 0;
    h += '<p class="mini muted" style="margin:0 0 8px">' + (z ? esc(z.nombre) : '') +
      ' — desliza entre bahías · clic y clic de nuevo para el rango, o «Seleccionar bahía».</p>';
    h += carruselSweepHTML('despCarruselAdmin', apartadoDespachoHTML(UI.zonaDespAdmin, UI.despSelAdmin, 'rangoDespAdmin', 'tocarCuadranteDespAdmin', 'seleccionarBahiaDespAdminGrid'), nB);
    h += '<button class="btn" style="margin-top:8px" onclick="seleccionarZonaDespAdmin(null)">‹ Volver al mapa</button>';
  } else {
    h += '<p class="mini muted" style="margin:0 0 8px">Tocá una zona para ver sus bahías y elegir los pallets.</p>';
    h += '<div class="mapa-viewport" id="mapa-viewport">' +
      '<div class="mapa-herramientas">' +
      '<button class="btn" title="Acercar" onclick="mapaZoomIn()">＋</button>' +
      '<button class="btn" title="Alejar" onclick="mapaZoomOut()">−</button>' +
      '<button class="btn btn-restablecer" title="Restablecer vista" onclick="mapaReset()">Restablecer</button>' +
      '</div>' +
      '<div class="mapa-ayuda">Arrastra para mover · rueda para acercar</div>' +
      '<div class="mapa-lienzo" id="mapa-lienzo">' +
      mapaAlmacenSketch(segPosicionDespachoAdmin, { zonaClick: function (z) { return "seleccionarZonaDespAdmin('" + z.id + "')"; } }) +
      '</div></div>';
  }

  const cajasSel = idsSel.reduce((s, pid) => { const p = getPallet(pid); return s + (p ? p.cajasTotales : 0); }, 0);
  h += '<div class="barra-despacho" id="barra-despacho-admin">' +
    '<span class="mini" id="desp-resumen-admin">' + idsSel.length + ' seleccionados · ' + fmtMiles(cajasSel) + ' cajas</span>' +
    '<button class="btn btn-ok btn-despachar" id="btn-despachar-admin" ' + (idsSel.length ? '' : 'disabled') +
    ' onclick="despacharSeleccionadosAdmin()">Despachar ' + idsSel.length + '</button></div>';
  h += '</div>';
  return h;
}

function segPosicionDespachoAdmin(pos) {
  if (!pos) return '';
  if (!pos.activa) return '<div class="mapa-seg mapa-seg--hueco"></div>';
  const p = pos.palletId ? getPallet(pos.palletId) : null;
  if (!p) return '<div class="mapa-seg mapa-seg--libre-cond" title="' + pos.codigo + ' · vacía"></div>';
  if (!esDespachable(p)) {
    return '<div class="mapa-seg mapa-seg--inerte" title="' + pos.codigo + ' · ' + ESTADO_PALLET[p.estado].label + ' (no despachable)"></div>';
  }
  const esListo = p.estado === 'LISTO';
  const sel = UI.despSelAdmin && UI.despSelAdmin[p.id];
  const titulo = pos.codigo + ' · ' + p.id + ' · ' + p.cajasTotales + ' cajas · ' +
    (esListo ? 'certificado (LISTO)' : 'clasificado — sin muestrear') + ' · tocá la zona para seleccionar en la bahía';
  return '<div class="mapa-seg ' + (esListo ? 'mapa-seg--listo' : 'mapa-seg--clasificado-desp') +
    (sel ? ' mapa-seg--seleccionado' : '') + '" id="despadmin-seg-' + pos.id + '" title="' + esc(titulo) + '">' +
    esc(pos.codigo + (sel ? ' ✓' : '')) + '</div>';
}

function tapSegDespachoAdmin(posicionId) {
  tapSegDespachoRango(posicionId, UI.despSelAdmin, 'despadmin-seg-', 'rangoDespAdmin', function () { actualizarBarraDespachoAdmin(); actualizarChipsSelAdmin(); });
}

function chipSelDespAdminHtml(pid) {
  const p = getPallet(pid);
  const pos = p ? getPosicion(p.posicionId) : null;
  return '<button class="chip-sel" onclick="quitarSelDespAdmin(\'' + pid + '\')">' +
    (pos ? pos.codigo : '?') + ' · ' + pid + ' ✕</button>';
}
function actualizarChipsSelAdmin() {
  const cont = document.getElementById('chips-sel-admin');
  if (!cont) return;
  const sel = UI.despSelAdmin || {};
  const ids = Object.keys(sel).filter(pid => sel[pid]);
  cont.innerHTML = ids.map(chipSelDespAdminHtml).join('');
}
function quitarSelDespAdmin(pid) {
  UI.despSelAdmin = UI.despSelAdmin || {};
  delete UI.despSelAdmin[pid];
  const p = getPallet(pid);
  if (p) {
    const seg = document.getElementById('despadmin-seg-' + p.posicionId);
    if (seg) {
      seg.classList.remove('mapa-seg--seleccionado');
      const pos = getPosicion(p.posicionId);
      seg.innerHTML = esc(pos.codigo);
    }
  }
  actualizarBarraDespachoAdmin();
  actualizarChipsSelAdmin();
}
function actualizarBarraDespachoAdmin() {
  const sel = UI.despSelAdmin || {};
  const idsSel = Object.keys(sel).filter(pid => sel[pid]);
  const cajasSel = idsSel.reduce((s, pid) => { const p = getPallet(pid); return s + (p ? p.cajasTotales : 0); }, 0);
  const resumen = document.getElementById('desp-resumen-admin');
  if (resumen) resumen.textContent = idsSel.length + ' seleccionados · ' + fmtMiles(cajasSel) + ' cajas';
  const btn = document.getElementById('btn-despachar-admin');
  if (btn) {
    btn.disabled = idsSel.length === 0;
    btn.textContent = 'Despachar ' + idsSel.length;
  }
}
function despacharSeleccionadosAdmin() {
  const sel = UI.despSelAdmin || {};
  const idsSel = Object.keys(sel).filter(pid => sel[pid]);
  if (!idsSel.length) return;
  const cajasSel = idsSel.reduce((s, pid) => { const p = getPallet(pid); return s + (p ? p.cajasTotales : 0); }, 0);
  if (!confirm('¿Despachar ' + idsSel.length + ' pallets (' + fmtMiles(cajasSel) + ' cajas)?\n' +
    idsSel.join(', ') + '\nLas posiciones quedan libres al instante (reabastécelas desde el mapa).')) return;
  const ids = idsSel.slice();
  UI.despSelAdmin = {};
  const res = despacharPallets('admin', ids);
  if (res.error) { alert(res.error); return; }
  alert(res.cantidad + ' pallets despachados. Reabastece las posiciones liberadas desde el mapa.');
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

/* Núcleo común de los mapas móviles (trabajador y operador): monta Panzoom
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

/* === Mapa móvil del OPERADOR (mismo núcleo, otros ids) === */
let mapaOperPanzoom = null;
let mapaOperMontaje = null;

function inicializarMapaOperPanzoom() {
  destruirMapaOperPanzoom();
  mapaOperMontaje = crearMapaMovilPanzoom('opermapa-viewport', 'opermapa-lienzo');
  if (!mapaOperMontaje) return;
  mapaOperPanzoom = mapaOperMontaje.instancia;
  ajustarVistaInicialEn(mapaOperMontaje);
}
function destruirMapaOperPanzoom() {
  if (mapaOperMontaje) { mapaOperMontaje.destruir(); mapaOperMontaje = null; }
  mapaOperPanzoom = null;
}
function mapaOperZoomIn() { if (mapaOperPanzoom) mapaOperPanzoom.zoomIn(); }
function mapaOperZoomOut() { if (mapaOperPanzoom) mapaOperPanzoom.zoomOut(); }
function mapaOperReset() {
  if (!mapaOperPanzoom) return;
  mapaOperPanzoom.reset();
  ajustarVistaInicialEn(mapaOperMontaje);
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
  const manual = UI.modoMuestreo === 'manual';
  let h = '<div class="seccion form-ancho"><h2>Asignar muestreo (tanda aleatoria 2–3 o manual de cantidad libre)</h2>' +
    '<div class="tarjeta">' +
    '<div class="campo"><label>Modo de tanda</label>' +
    '<div class="modo-tanda">' +
    '<label><input type="radio" name="form-modo" value="aleatorio" ' + (manual ? '' : 'checked') + ' onchange="cambiarModoMuestreo(\'aleatorio\')"> Aleatorio (2–3)</label>' +
    '<label><input type="radio" name="form-modo" value="manual" ' + (manual ? 'checked' : '') + ' onchange="cambiarModoMuestreo(\'manual\')"> Manual (cantidad libre)</label>' +
    '</div></div>' +
    '<div class="fila-form">' +
    '<div class="campo"><label>Muestreador</label><select id="form-muestreador">' +
    '<option value="">Elegir…</option>' +
    trabajadoresActivos().map(t => '<option value="' + t.id + '">' + esc(t.nombre) + '</option>').join('') +
    '</select></div>' +
    '<div class="campo"><label>Clasificador a auditar</label><select id="form-clasificador" onchange="actualizarDisponibles();mostrarTandaManual()">' +
    '<option value="">Elegir…</option>' +
    trabajadoresActivos().map(t => '<option value="' + t.id + '">' + esc(t.nombre) + '</option>').join('') +
    '</select></div>' +
    '<div class="campo" id="campo-cantidad"' + (manual ? ' style="display:none"' : '') + '><label>Cantidad de pallets (2–3)</label>' +
    '<input type="number" id="form-cantidad" min="' + REGLAS.MIN_PALLETS_MUESTREO + '" max="' + REGLAS.MAX_PALLETS_MUESTREO + '" value="2">' +
    '<button class="btn" style="margin-top:6px" onclick="sortearCantidad()">Al azar</button></div>' +
    '<button class="btn btn-primario" onclick="crearAsignacionDesdeForm()">Crear asignación</button>' +
    '</div>' +
    '<div class="campo" id="campo-tanda"' + (manual ? '' : ' style="display:none"') + '><label>Tanda manual (marca los pallets CLASIFICADOS en el mapa)</label>' +
    '<div id="form-tanda"><p class="mini muted">Elige un clasificador para elegir la tanda manual en el mapa.</p></div></div>' +
    '<p class="mini muted">El lote es siempre el último conjunto del clasificador (automático, no se ajusta). La tanda sale del lote: ' +
    'aleatoria (2–3) o manual (en el mapa, mín. 1); la asignación aparece de inmediato en la app del muestreador.</p>';
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

/* Selector de modo de tanda: alterna la visibilidad cantidad (aleatorio) vs
 * mapa manual (manual) sin re-render (conserva el resto del form). */
function cambiarModoMuestreo(modo) {
  UI.modoMuestreo = modo;
  const cCant = document.getElementById('campo-cantidad');
  const cTanda = document.getElementById('campo-tanda');
  if (cCant) cCant.style.display = modo === 'manual' ? 'none' : '';
  if (cTanda) cTanda.style.display = modo === 'manual' ? '' : 'none';
  if (modo === 'manual') mostrarTandaManual();
  else destruirMapaPanzoom();
}

/* Estado cache del mapa de tanda manual (por render, para no releer el DOM en
 * cada segmento): el LOTE = último conjunto del clasificador no despachado;
 * elegibles = sus CLASIFICADOS (los tocables). */
let tandaPoolCache = {};      // palletId → true (pallets del lote, no DESPACHADO)
let tandaElegiblesCache = []; // pallets CLASIFICADOS del lote
let tandaMaxCache = 0;        // nº de CLASIFICADOS del lote (máximo del contador)

/* Tanda manual: el admin marca los pallets CLASIFICADOS del lote SOBRE EL MAPA
 * del almacén (el lote resaltado y tocable; el resto atenuado e inerte).
 * Mantiene las selecciones previas que sigan siendo elegibles. */
function mostrarTandaManual() {
  if (UI.modoMuestreo !== 'manual') return;
  const cont = document.getElementById('form-tanda');
  if (!cont) return;
  const cid = document.getElementById('form-clasificador').value;
  tandaPoolCache = {};
  tandaElegiblesCache = [];
  tandaMaxCache = 0;
  if (!cid) {
    UI.tandaSel = {};
    destruirMapaPanzoom();
    cont.innerHTML = '<p class="mini muted">Elige un clasificador para elegir la tanda manual en el mapa.</p>';
    return;
  }
  // Lote = último conjunto completo del clasificador (automático, no se ajusta)
  const conjuntoId = ultimoConjuntoDe(cid);
  const pool = conjuntoId ? palletsDelConjunto(conjuntoId).filter(p => p.estado !== 'DESPACHADO') : [];
  if (!pool.length) {
    UI.tandaSel = {};
    destruirMapaPanzoom();
    cont.innerHTML = '<p class="mini">Sin conjunto disponible: el clasificador no tiene un último conjunto con pallets en almacén.</p>';
    return;
  }
  pool.forEach(p => { tandaPoolCache[p.id] = true; });
  tandaElegiblesCache = pool.filter(p => p.estado === 'CLASIFICADO');
  tandaMaxCache = tandaElegiblesCache.length;
  // Conservar solo selecciones previas que sigan siendo elegibles
  const elegiblesSet = new Set(tandaElegiblesCache.map(p => p.id));
  const prev = UI.tandaSel || {};
  UI.tandaSel = {};
  Object.keys(prev).forEach(k => { if (prev[k] && elegiblesSet.has(k)) UI.tandaSel[k] = true; });
  if (!tandaElegiblesCache.length) {
    destruirMapaPanzoom();
    cont.innerHTML = '<p class="mini">Sin pallets CLASIFICADOS en el lote actual: no hay tanda manual posible.</p>';
    return;
  }
  const n = Object.keys(UI.tandaSel).filter(k => UI.tandaSel[k]).length;
  cont.innerHTML =
    '<p class="mini" id="tanda-n"><strong>' + n + '</strong> pallets seleccionados (mínimo 1, máximo ' + tandaMaxCache + ')</p>' +
    '<div class="fila-botones">' +
    '<button class="btn" onclick="seleccionarBahiaTanda()">Seleccionar bahía</button>' +
    '<button class="btn" onclick="seleccionarTodoLoteTanda()">Seleccionar todo el lote</button>' +
    '<button class="btn" onclick="limpiarTanda()">Limpiar</button>' +
    '</div>' +
    '<div class="mapa-viewport" id="mapa-viewport">' +
    '<div class="mapa-herramientas">' +
    '<button class="btn" title="Acercar" onclick="mapaZoomIn()">＋</button>' +
    '<button class="btn" title="Alejar" onclick="mapaZoomOut()">−</button>' +
    '<button class="btn btn-restablecer" title="Restablecer vista" onclick="mapaReset()">Restablecer</button>' +
    '</div>' +
    '<div class="mapa-ayuda">Arrastra para mover · rueda para acercar</div>' +
    '<div class="mapa-lienzo" id="mapa-lienzo">' +
    mapaAlmacenSketch(segPosicionTandaMuestreo) +
    '</div></div>';
  inicializarMapaPanzoom();
}

/* Pool del lote cacheado para el renderer de segmentos (evita releer el DOM). */
function tandaPoolActual() { return tandaPoolCache; }

/* Segmento del mapa de la tanda manual: el LOTE resalta sus CLASIFICADOS
 * (tocables); el resto del almacén queda atenuado e inerte. */
function segPosicionTandaMuestreo(pos) {
  if (!pos) return '';
  const p = pos.palletId ? getPallet(pos.palletId) : null;
  if (!pos.activa) {
    return '<div class="mapa-seg mapa-seg--inactiva-admin" title="' + pos.codigo + ' · inactiva">✕</div>';
  }
  if (!p) {
    return '<div class="mapa-seg mapa-seg--inerte" title="' + pos.codigo + ' · vacía"></div>';
  }
  if (!tandaPoolActual()[p.id]) {
    return '<div class="mapa-seg mapa-seg--fuera-lote" title="' + pos.codigo + ' · fuera del lote (' + p.id + ')"></div>';
  }
  if (p.estado === 'CLASIFICADO') {
    const sel = !!(UI.tandaSel && UI.tandaSel[p.id]);
    return '<div class="mapa-seg mapa-seg--clasificado-desp' + (sel ? ' mapa-seg--seleccionado' : '') +
      '" id="tanda-seg-' + pos.id + '" title="' + pos.codigo + ' · ' + p.id + ' · CLASIFICADO (clic para marcar/desmarcar)"' +
      ' onclick="toggleTandaMapa(\'' + pos.id + '\')">' + esc(pos.codigo) + '</div>';
  }
  return '<div class="mapa-seg mapa-seg--inerte" title="' + pos.codigo + ' · ' + p.id + ' · ' + ESTADO_PALLET[p.estado].label + '"></div>';
}

/* Toca un pallet CLASIFICADO del lote en el mapa: alterna la marca en el DOM
 * (sin re-render, para conservar el pan/zoom) y refresca el contador. */
function toggleTandaMapa(posicionId) {
  const pos = getPosicion(posicionId);
  if (!pos || !pos.palletId) return;
  const p = getPallet(pos.palletId);
  if (!p || !tandaPoolActual()[p.id] || p.estado !== 'CLASIFICADO') return;
  UI.tandaSel = UI.tandaSel || {};
  if (UI.tandaSel[p.id]) delete UI.tandaSel[p.id];
  else UI.tandaSel[p.id] = true;
  const el = document.getElementById('tanda-seg-' + pos.id);
  if (el) el.classList.toggle('mapa-seg--seleccionado', !!UI.tandaSel[p.id]);
  refrescarTandaN();
}

/* Refresca el contador #tanda-n (N seleccionados / máximo = CLASIFICADOS). */
function refrescarTandaN() {
  const el = document.getElementById('tanda-n');
  if (!el) return;
  UI.tandaSel = UI.tandaSel || {};
  const n = Object.keys(UI.tandaSel).filter(k => UI.tandaSel[k]).length;
  el.innerHTML = '<strong>' + n + '</strong> pallets seleccionados (mínimo 1, máximo ' + tandaMaxCache + ')';
}

/* Refresca las marcas de todos los segmentos tocables + el contador, sin
 * re-render (conserva el pan/zoom). */
function refrescarTandaMapa() {
  tandaElegiblesCache.forEach(p => {
    const pos = getPosicion(p.posicionId);
    if (!pos) return;
    const el = document.getElementById('tanda-seg-' + pos.id);
    if (el) el.classList.toggle('mapa-seg--seleccionado', !!UI.tandaSel[p.id]);
  });
  refrescarTandaN();
}

/* Atajo: selecciona los CLASIFICADOS del lote en la bahía del lote (la que más
 * CLASIFICADOS del lote tiene; un conjunto se toma de una bahía). */
function seleccionarBahiaTanda() {
  const porBahia = {};
  tandaElegiblesCache.forEach(p => {
    const pos = getPosicion(p.posicionId);
    if (!pos) return;
    porBahia[pos.bahiaId] = (porBahia[pos.bahiaId] || 0) + 1;
  });
  let bahia = null, mejor = 0;
  Object.keys(porBahia).forEach(b => { if (porBahia[b] > mejor) { mejor = porBahia[b]; bahia = b; } });
  UI.tandaSel = {};
  tandaElegiblesCache.forEach(p => {
    const pos = getPosicion(p.posicionId);
    if (pos && pos.bahiaId === bahia) UI.tandaSel[p.id] = true;
  });
  refrescarTandaMapa();
}

/* Atajo: selecciona TODOS los CLASIFICADOS del lote. */
function seleccionarTodoLoteTanda() {
  UI.tandaSel = {};
  tandaElegiblesCache.forEach(p => { UI.tandaSel[p.id] = true; });
  refrescarTandaMapa();
}

/* Atajo: limpia la tanda manual. */
function limpiarTanda() {
  UI.tandaSel = {};
  refrescarTandaMapa();
}

function crearAsignacionDesdeForm() {
  const m = document.getElementById('form-muestreador').value;
  const c = document.getElementById('form-clasificador').value;
  const n = document.getElementById('form-cantidad').value;
  // Lote congelado: SIEMPRE el último conjunto del clasificador (null = por defecto)
  const loteIds = null;
  const manual = UI.modoMuestreo === 'manual';
  let tandaManual = null;
  if (manual) {
    tandaManual = Object.keys(UI.tandaSel || {}).filter(k => UI.tandaSel[k]);
    if (!tandaManual.length) {
      UI.msg = { tipo: 'error', texto: 'Modo manual: marca al menos un pallet CLASIFICADO para la tanda.' };
      render();
      return;
    }
  }
  const res = crearAsignacionMuestreo(m, c, n, loteIds, tandaManual);
  if (res.ok) {
    UI.tandaSel = {};
    UI.msg = { tipo: 'ok', texto: res.asignacion.id + ' creada: tanda ' + (manual ? 'manual' : 'aleatoria') + ' de ' +
      res.asignacion.cantidad + ' pallets (' +
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
        ' <span class="muted">(' + p.muestreo.botellas + '/' + botellasRevisadas(p) + ' botellas · ' + (p.muestreo.cajasMBFU || 0) + ' caja(s))</span> ' +
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
    'El Operador ya podrá despacharlos. ¿Continuar?')) return;
  const n = dejarPasarLote(asignacionId);
  alert(n + ' pallet(s) del lote certificados → LISTO. El Operador ya puede despacharlos.');
}

function reclasificarLoteUI(asignacionId) {
  const afectados = loteReclasificablesDe(asignacionId);
  if (!afectados.length) { alert('El lote de la tanda ' + asignacionId + ' ya está resuelto.'); return; }
  if (!confirm('Re-clasificar TODO el lote congelado de la tanda ' + asignacionId + ':\n' +
    afectados.length + ' pallet(s) volverán a EN_PROCESO y quedarán LIBRES (' + afectados.map(q => q.id).join(', ') + ').\n' +
    'Los ya DESPACHADO no se tocan. El avance del mapa y el BI se actualizan al instante. ¿Continuar?')) return;
  const n = reclasificarLote(asignacionId);
  alert(n + ' pallet(s) del lote volvieron a EN_PROCESO (libres, con su conteo reseteado a 0). Revisa el mapa y el BI.');
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

  // Operadores (montacargas): tercer actor, usuarios propios
  h += '<div class="seccion form-ancho" style="margin-top:20px"><h2>Gestión de operadores (montacargas)</h2>' +
    '<div class="tarjeta"><div class="fila-form" style="grid-template-columns:2fr auto">' +
    '<div class="campo" style="margin:0"><label>Nuevo operador</label>' +
    '<input type="text" id="form-nuevo-operador" placeholder="Nombre y apellido"></div>' +
    '<button class="btn btn-primario" onclick="crearOperadorDesdeForm()">Crear</button>' +
    '</div></div>' +
    '<table class="tabla"><tr><th>Nombre</th><th>Estado</th><th>Acciones</th></tr>';
  STATE.operadores.forEach(o => {
    h += '<tr><td>';
    if (UI.editingOperador === o.id) {
      h += '<input type="text" id="form-edit-op-' + o.id + '" value="' + esc(o.nombre) + '">';
    } else {
      h += '<strong>' + esc(o.nombre) + '</strong>';
    }
    h += '</td><td>' + (o.activo
      ? '<span class="chip" style="background:var(--ok)">Activo</span>'
      : '<span class="chip" style="background:var(--pendiente)">Inactivo</span>') + '</td><td>';
    if (UI.editingOperador === o.id) {
      h += '<button class="btn btn-ok" onclick="guardarEdicionOperador(\'' + o.id + '\')">Guardar</button> ' +
        '<button class="btn" onclick="cancelarEdicionOperador()">Cancelar</button>';
    } else {
      h += '<button class="btn" onclick="editarOperador(\'' + o.id + '\')">Editar nombre</button> ' +
        '<button class="btn ' + (o.activo ? 'btn-peligro' : 'btn-primario') + '" onclick="toggleActivoOperador(\'' + o.id + '\')">' +
        (o.activo ? 'Desactivar' : 'Activar') + '</button>';
    }
    h += '</td></tr>';
  });
  h += '</table>' +
    '<p class="mini muted">Los operadores inactivos no aparecen en el login de su app móvil.</p></div>';
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

function crearOperadorDesdeForm() {
  const res = crearOperador(document.getElementById('form-nuevo-operador').value);
  if (res.error) alert(res.error);
}
function editarOperador(id) {
  UI.editingOperador = id;
  render();
}
function cancelarEdicionOperador() {
  UI.editingOperador = null;
  render();
}
function guardarEdicionOperador(id) {
  const res = renombrarOperador(id, document.getElementById('form-edit-op-' + id).value);
  if (res.ok) UI.editingOperador = null;
  else alert(res.error);
}

/* ============================ ARRANQUE ============================ */

document.addEventListener('DOMContentLoaded', function () {
  STATE = clonarSemilla();
  resetUI();
  render();
});
