/**
 * CATastro – RECOLECCIÓN
 * Conexión central: una sola hoja SABANA_RECOLECCION.
 *
 * Instalar:
 * 1) Crear un Google Sheets y abrir Extensiones > Apps Script.
 * 2) Reemplazar el contenido de Code.gs por este archivo.
 * 3) Ejecutar crearSabanaRecoleccion() una vez y autorizar permisos.
 * 4) Implementar como Aplicación web: ejecutar como tú; acceso según política del proyecto.
 * 5) Copiar la URL /exec para configurarla en el aplicativo.
 */

const CONFIG = {
  HOJA: 'SABANA_RECOLECCION',
  TOKEN: 'CAT-hUpk8PehG9j2j4xZMYsPZ-Fr1XMgsY4jufSUwnp4',
  VERSION: '1.3.0'
};

const ENCABEZADOS = [
  'ID_REGISTRO',
  'ID_RECORRIDO',
  'ID_ASIGNACION',
  'NIM',
  'MGN',
  'DEPARTAMENTO',
  'MUNICIPIO',
  'ZONA',
  'SEGMENTO',
  'SUPERVISOR',
  'ENCUESTADOR',
  'UNIVERSO',
  'VIVIENDA',
  'ALEATORIO',
  'ORDEN_SORTEO',
  'SELECCIONADA',
  'ORDEN_SELECCION',
  'METODO_SELECCION',
  'RESULTADO_VISITA',
  'LATITUD',
  'LONGITUD',
  'ALTITUD_M',
  'PRECISION_M',
  'FECHA_GPS',
  'IDENTIFICADOR_VIVIENDA',
  'URL_KOBO',
  'ESTADO_RECORRIDO',
  'ESTADO_REGISTRO',
  'FECHA_GENERACION',
  'FECHA_ACTUALIZACION'
];

/**
 * Ejecutar manualmente una sola vez desde Apps Script.
 * Crea y da formato a la única hoja de salida.
 */
function crearSabanaRecoleccion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Este proyecto debe estar vinculado a un Google Sheets.');

  let sh = ss.getSheetByName(CONFIG.HOJA);
  if (!sh) sh = ss.insertSheet(CONFIG.HOJA);
  asegurarColumnas_(sh);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS]);
  } else {
    const actuales = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), ENCABEZADOS.length))
      .getDisplayValues()[0];
    const faltantes = ENCABEZADOS.filter((h, i) => actuales[i] !== h);
    if (faltantes.length) {
      throw new Error(
        'La hoja ya contiene encabezados diferentes. No se modificó para proteger los datos. ' +
        'Crea una hoja nueva o revisa la fila 1.'
      );
    }
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, ENCABEZADOS.length)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#123b5d')
    .setWrap(true)
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  // Códigos e identificadores siempre como texto: evita pérdida de ceros.
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 18, 19, 25, 26, 27, 28]
    .forEach(col => sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@'));

  // Variables numéricas y fechas.
  [12, 14, 15, 17, 20, 21, 22, 23].forEach(col =>
    sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('0.000000')
  );
  [24, 29, 30].forEach(col =>
    sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy-mm-dd hh:mm:ss')
  );

  const widths = [
    280, 300, 260, 190, 210, 150, 160, 130, 100, 190,
    190, 100, 90, 120, 110, 110, 120, 240, 210, 130,
    130, 110, 110, 170, 300, 420, 150, 190, 170, 170
  ];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  if (!sh.getFilter()) {
    sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), ENCABEZADOS.length).createFilter();
  }

  return 'Hoja SABANA_RECOLECCION preparada.';
}

/** Endpoint de comprobación. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      servicio: 'CATastro – Recolección',
      version: CONFIG.VERSION,
      hoja: CONFIG.HOJA,
      estado: 'LISTO'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Recibe el POST del formulario oculto del aplicativo.
 * Se usa respuesta HTML + postMessage para confirmar el resultado sin CORS/fetch.
 */
function doPost(e) {
  const params=(e&&e.parameter)?e.parameter:{};
  const nonce=String(params.nonce||'');
  try {
    const token=String(params.token||'');
    if(token!==CONFIG.TOKEN)throw new Error('Token de conexión no válido.');
    const raw=params.payload||'';
    if(!raw)throw new Error('No se recibió el contenido del recorrido.');
    const payload=JSON.parse(raw),registro=payload.registro;
    if(!registro||!registro.idRecorrido)throw new Error('El recorrido recibido no tiene un identificador válido.');
    const resultado=guardarRecorrido_(registro);
    const respuesta={ok:true,mensaje:'Recorrido recibido y actualizado en la sábana.',filas:resultado.filas,actualizadas:resultado.actualizadas,insertadas:resultado.insertadas,idRecorrido:registro.idRecorrido};
    if(nonce)return respuestaIframe_(respuesta,nonce);
    return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    const error={ok:false,error:String(err&&err.message?err.message:err)};
    if(nonce)return respuestaIframe_(error,nonce);
    return ContentService.createTextOutput(JSON.stringify(error)).setMimeType(ContentService.MimeType.JSON);
  }
}
/** Convierte el universo auditado + la selección visitable en filas de la sábana. */
function guardarRecorrido_(r) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('No se encontró el Google Sheets vinculado.');
    const sh = ss.getSheetByName(CONFIG.HOJA) || crearHoja_();

    if (!Array.isArray(r.seleccion) || !r.seleccion.length) {
      throw new Error('El recorrido no contiene viviendas seleccionadas.');
    }
    if (!Array.isArray(r.universoAuditoria) || !r.universoAuditoria.length) {
      throw new Error('No se recibió el universo completo necesario para auditar la selección.');
    }

    // Se aceptan snapshots parciales: cada cambio actualiza la misma llave
    // ID_REGISTRO (idRecorrido::vivienda), sin duplicar filas.
    // La validación estricta de cierre se mantiene en el aplicativo.

    const seleccionPorVivienda = new Map(
      r.seleccion.map(v => [String(v.vivienda), v])
    );

    const universo = r.universoAuditoria.slice();
    const filas = universo.map((u, index) => {
      const vivienda = String(u.vivienda);
      const visita = seleccionPorVivienda.get(vivienda) || null;
      const aleatorio = (u.aleatorio === null || u.aleatorio === undefined || u.aleatorio === '')
        ? '' : Number(u.aleatorio);

      return [
        String(r.idRecorrido) + '::' + vivienda,                  // ID_REGISTRO
        String(r.idRecorrido),                                   // ID_RECORRIDO
        String(r.idAsignacion || (r.nim + '::' + r.mgn)),        // ID_ASIGNACION
        String(r.nim || ''),
        String(r.mgn || ''),
        String(r.departamento || ''),
        String(r.municipio || ''),
        String(r.zona || ''),
        String(r.idSegmento || ''),
        String(r.supervisor || ''),
        String(r.encuestador || ''),
        Number(r.conteo || universo.length),
        Number(u.vivienda),
        aleatorio,
        index + 1,                                                // Orden del universo ya ordenado
        visita ? 'SI' : 'NO',
        visita ? Number(visita.orden) : '',
        String(r.metodo || ''),
        visita ? String(visita.resultado || '') : '',
        visita && visita.gpsLatitud != null ? Number(visita.gpsLatitud) : '',
        visita && visita.gpsLongitud != null ? Number(visita.gpsLongitud) : '',
        visita && visita.gpsAltitud != null ? Number(visita.gpsAltitud) : '',
        visita && visita.gpsPrecision != null ? Number(visita.gpsPrecision) : '',
        visita && visita.gpsFecha ? fecha_(visita.gpsFecha) : '',
        visita ? String(visita.identificador || '') : String([r.nim, r.mgn, vivienda].join('|')),
        visita ? String(visita.koboUrl || '') : '',
        String(r.estado || 'EN_PROCESO'),
        String(r.estado_registro || 'ACTIVO'),
        fecha_(r.fechaGeneracion),
        fecha_(r.actualizado)
      ];
    });

    // Asegurar que no existan dos filas del mismo ID_REGISTRO.
    const idsEnPayload = new Set();
    filas.forEach(row => {
      if (idsEnPayload.has(row[0])) throw new Error('El universo contiene viviendas duplicadas.');
      idsEnPayload.add(row[0]);
    });

    const lastRow = sh.getLastRow();
    const existentes = new Map();
    if (lastRow > 1) {
      const ids = sh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      ids.forEach((row, i) => {
        if (row[0]) existentes.set(String(row[0]), i + 2);
      });
    }

    let actualizadas = 0;
    const nuevas = [];
    filas.forEach(row => {
      const rowNumber = existentes.get(row[0]);
      if (rowNumber) {
        sh.getRange(rowNumber, 1, 1, ENCABEZADOS.length).setValues([row]);
        actualizadas++;
      } else {
        nuevas.push(row);
      }
    });

    if (nuevas.length) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start, 1, nuevas.length, ENCABEZADOS.length).setValues(nuevas);
    }

    return {
      filas: filas.length,
      actualizadas: actualizadas,
      insertadas: nuevas.length
    };

  } finally {
    lock.releaseLock();
  }
}


/** Amplía la cuadrícula si la hoja nueva tiene menos columnas que el esquema. */
function asegurarColumnas_(sh) {
  const actuales = sh.getMaxColumns();
  if (actuales < ENCABEZADOS.length) {
    sh.insertColumnsAfter(actuales, ENCABEZADOS.length - actuales);
  }
}

/** Crea la hoja si se recibe una llamada antes de ejecutar la preparación manual. */
function crearHoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.insertSheet(CONFIG.HOJA);
  asegurarColumnas_(sh);
  sh.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, ENCABEZADOS.length)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#123b5d');
  return sh;
}

function fecha_(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  return isNaN(d.getTime()) ? '' : d;
}

/** Devuelve una página mínima que avisa al aplicativo del resultado del POST. */
function respuestaIframe_(resultado, nonce) {
  const paquete = JSON.stringify({
    channel: 'CATASTRO_SHEETS_SYNC',
    nonce: String(nonce || ''),
    resultado: resultado
  }).replace(/</g, '\\u003c');

  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>(function(){var p=' + paquete + ';try{window.top.postMessage(p,"*")}catch(e){}try{if(window.parent!==window.top)window.parent.postMessage(p,"*")}catch(e){}})();</script>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
