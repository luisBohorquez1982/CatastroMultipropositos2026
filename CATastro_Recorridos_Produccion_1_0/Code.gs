/** CATastro Producción 1.0 — sincronización idempotente, barrido rural y eliminación lógica.
 * Conserva la lógica y los encabezados de CATastro V2.1.21.
 */
const CONFIG = { SPREADSHEET_ID: '1MwrQIACQeB1HC6dePzS5iua0S11mC9vVYyfd6YOSBBU', HOJA: 'SABANA_RECOLECCION', TOKEN: 'CAT-hUpk8PehG9j2j4xZMYsPZ-Fr1XMgsY4jufSUwnp4', VERSION: '1.0' };
const HEADERS = ['ID_REGISTRO', 'ID_RECORRIDO', 'ID_ASIGNACION', 'TIPO_AREA', 'DEPARTAMENTO', 'MUNICIPIO', 'CODIGO_MUNICIPIO', 'CLASE', 'AREA_ASIGNADA', 'MGN', 'ID_UPM', 'ID_VEREDA', 'CODIGO_VEREDA', 'VEREDA', 'SEGMENTO', 'ID_PERSONA', 'CONSECUTIVO_PERSONA', 'NOMBRE_PERSONA', 'SUPERVISOR', 'ENCUESTADOR', 'UNIVERSO', 'VIVIENDA', 'ALEATORIO', 'ORDEN_SORTEO', 'SELECCIONADA', 'ORDEN_SELECCION', 'METODO_SELECCION', 'NIM', 'RESULTADO_VISITA', 'LATITUD', 'LONGITUD', 'ALTITUD_M', 'PRECISION_M', 'FECHA_GPS', 'IDENTIFICADOR_VIVIENDA', 'ID_ENCUESTA', 'URL_KOBO', 'ESTADO_RECORRIDO', 'ESTADO_REGISTRO', 'FECHA_GENERACION', 'FECHA_ACTUALIZACION', 'FECHA_ELIMINACION', 'ESTADO_SINCRONIZACION', 'REQUEST_ID'];
function doGet(e) {
    const p = e && e.parameter || {};
    if (p.action === 'check')
        return checkRequest_(p);
    if (p.action === 'progress') {
        const data = getProgress_();
        const cb = String(p.callback || '');
        if (cb) {
            if (!/^[A-Za-z_$][0-9A-Za-z_$]{0,100}$/.test(cb))
                return json_({ ok: false, error: 'callback no válido.' });
            return jsonp_(cb, data);
        }
        return json_(data);
    }
    const sh = getSheet_();
    return json_({ ok: true, servicio: 'CATastro – Recolección', version: CONFIG.VERSION, hoja: CONFIG.HOJA, hojaEncontrada: !!sh, estado: 'LISTO' });
}
function doPost(e) {
    let requestId = '';
    try {
        const raw = e && e.postData && e.postData.contents || '';
        const payload = raw ? JSON.parse(raw) : {};
        if (payload.token !== CONFIG.TOKEN)
            throw new Error('Token no válido.');
        requestId = String(payload.requestId || '');
        if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))
            throw new Error('Falta requestId válido.');
        const prior = PropertiesService.getScriptProperties().getProperty('SYNC_' + requestId);
        if (prior) {
            const priorResult = JSON.parse(prior);
            if (priorResult && priorResult.ok) return json_(priorResult);
        }
        const registros = Array.isArray(payload.registros) ? payload.registros : [];
        if (!registros.length)
            throw new Error('No se recibieron registros.');
        if (registros.length > 10)
            throw new Error('El lote supera el máximo permitido de 10 recorridos.');
        registros.forEach(r => {
            if (!r || !r.idRecorrido || !Array.isArray(r.seleccion) || !Array.isArray(r.universoAuditoria))
                throw new Error('Se recibió un recorrido incompleto o sin identificador.');
        });
        const lock = LockService.getScriptLock();
        lock.waitLock(25000);
        let totals = { filas: 0, insertadas: 0, actualizadas: 0 };
        try {
            // Revalidar idempotencia dentro del lock para evitar dos POST simultáneos
            // con el mismo requestId que inserten/actualicen en paralelo.
            const lockedPrior = PropertiesService.getScriptProperties().getProperty('SYNC_' + requestId);
            if (lockedPrior) {
                const lockedResult = JSON.parse(lockedPrior);
                if (lockedResult && lockedResult.ok) return json_(lockedResult);
            }
            const sh = getSheet_();
            totals = upsertRecords_(sh, registros, requestId);
            SpreadsheetApp.flush();
        }
        finally {
            lock.releaseLock();
        }
        const result = { ok: true, requestId, recorridos: registros.length, ...totals, version: CONFIG.VERSION, hoja: CONFIG.HOJA, completedAt: new Date().toISOString() };
        PropertiesService.getScriptProperties().setProperty('SYNC_' + requestId, JSON.stringify(result));
        return json_(result);
    }
    catch (err) {
        const result = { ok: false, requestId, error: String(err && err.message || err), version: CONFIG.VERSION };
        if (requestId)
            PropertiesService.getScriptProperties().setProperty('SYNC_' + requestId, JSON.stringify(result));
        console.error(err);
        return json_(result);
    }
}
function checkRequest_(p) {
    const cb = String(p.callback || '');
    if (!/^[A-Za-z_$][0-9A-Za-z_$]{0,100}$/.test(cb))
        return ContentService.createTextOutput('/* invalid callback */').setMimeType(ContentService.MimeType.JAVASCRIPT);
    if (p.token !== CONFIG.TOKEN)
        return jsonp_(cb, { ok: false, error: 'Token no válido.' });
    const id = String(p.requestId || '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(id))
        return jsonp_(cb, { ok: false, error: 'requestId no válido.' });
    const raw = PropertiesService.getScriptProperties().getProperty('SYNC_' + id);
    return jsonp_(cb, raw ? JSON.parse(raw) : { ok: false, pending: true, requestId: id });
}
function getSheet_() {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sh = ss.getSheetByName(CONFIG.HOJA);
    if (!sh) {
        sh = ss.insertSheet(CONFIG.HOJA);
    }
    // Garantiza que toda hoja nueva o vacía quede inicializada.
    // Si ya existen encabezados distintos, ensureHeaders_ detiene el proceso
    // para evitar sobrescribir una sábana incompatible.
    ensureHeaders_(sh);
    return sh;
}
function ensureHeaders_(sh) {
    if (sh.getLastRow() === 0) {
        sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setFontColor('#fff').setBackground('#123b5d');
        sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), HEADERS.length).setNumberFormat('@');
    } else {
        const got = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
        if (got.length !== HEADERS.length || HEADERS.some((h, i) => got[i] !== h))
            throw new Error('La hoja ' + CONFIG.HOJA + ' tiene encabezados incompatibles. No se modificó.');
    }
}
function upsertRecords_(sh, registros, requestId) {
    // Construye todas las filas del lote en memoria y consulta la columna ID_REGISTRO una sola vez.
    // Esto evita releer toda la sábana por cada recorrido cuando hay varios equipos sincronizando.
    const byId = new Map();
    registros.forEach(r => {
        if (!r || !r.idRecorrido) throw new Error('Registro sin idRecorrido.');
        const selected = Array.isArray(r.seleccion) ? r.seleccion : [];
        const audit = Array.isArray(r.universoAuditoria) ? r.universoAuditoria : [];
        if (!selected.length) throw new Error('El recorrido ' + r.idRecorrido + ' no tiene elementos seleccionados.');
        const selectedKeys = selected.map(v => String((v && (v.idPersona || v.vivienda)) || ''));
        if (selectedKeys.some(k => !k) || new Set(selectedKeys).size !== selectedKeys.length)
            throw new Error('El recorrido ' + r.idRecorrido + ' contiene viviendas/personas duplicadas o sin identificador. No se escribió el lote.');
        const auditMap = new Map(audit.map((a, i) => [String(a.vivienda), { ...a, ordenSorteo: i + 1 }]));
        const items = selected.map(v => {
            const a = auditMap.get(String(v.vivienda)) || {};
            return { v, a, selected: true };
        });
        if (r.tipo !== 'RURAL_DISPERSO') {
            audit.forEach(a => {
                if (!selected.some(v => String(v.vivienda) === String(a.vivienda)))
                    items.push({ v: null, a, selected: false });
            });
        }
        items.forEach(({ v, a, selected: sel }) => {
            const idItem = String((v && (v.idPersona || v.vivienda)) || a.vivienda || 'SIN_ITEM');
            const id = String(r.idRecorrido) + '::' + idItem;
            const nim = v ? (v.nim || '') : '';
            const row = [
                id, String(r.idRecorrido), String(r.idAsignacion || ''), String(r.tipo || ''),
                String(r.departamento || ''), String(r.municipio || ''), String(r.codigoMunicipio || ''),
                String(r.clase || ''), String(r.area || ''), String(r.mgn || ''), String(r.idUpm || ''),
                String(r.idVereda || ''), String(r.codigoVereda || ''), String(r.vereda || ''),
                String(r.segmento || ''), String(v && v.idPersona || ''), String(v && v.consecutivo || ''),
                String(v && v.nombre || ''), String(r.supervisor || ''),
                String((r.encuestadores || []).join('; ')), String(r.conteo || audit.length || selected.length),
                String(v && v.vivienda || a.vivienda || ''), a.aleatorio == null ? '' : String(a.aleatorio),
                String(a.ordenSorteo || ''), sel ? 'SI' : 'NO', v ? String(v.orden || '') : '',
                String(r.metodo || ''), nim, String(v && v.resultado || ''),
                v && v.gpsLatitud != null ? String(v.gpsLatitud) : '',
                v && v.gpsLongitud != null ? String(v.gpsLongitud) : '',
                v && v.gpsAltitud != null ? String(v.gpsAltitud) : '',
                v && v.gpsPrecision != null ? String(v.gpsPrecision) : '',
                v && v.gpsFecha ? String(v.gpsFecha) : '', String(v && v.identificador || ''),
                String(v && v.idEncuesta || ''), String(v && v.koboUrl || ''),
                String(r.estado || 'EN_PROCESO'), String(r.estado_registro || 'ACTIVO'),
                String(r.fechaGeneracion || ''), String(r.actualizado || ''),
                String(r.fechaEliminacion || ''), 'CONFIRMADO',
                requestId
            ];
            byId.set(id, row); // Si el lote contiene el mismo ID más de una vez, prevalece la última versión.
        });
    });

    const rows = Array.from(byId.values());
    const last = sh.getLastRow();
    const index = new Map();
    if (last > 1) {
        sh.getRange(2, 1, last - 1, 1).getDisplayValues().forEach((x, i) => {
            if (x[0]) index.set(String(x[0]), i + 2);
        });
    }
    let insertadas = 0, actualizadas = 0;
    const updates = [], additions = [];
    rows.forEach(row => {
        const found = index.get(row[0]);
        if (found) { updates.push({ rowNumber: found, values: row }); actualizadas++; }
        else { additions.push(row); insertadas++; }
    });
    updates.sort((a, b) => a.rowNumber - b.rowNumber);
    for (let i = 0; i < updates.length;) {
        let j = i + 1;
        while (j < updates.length && updates[j].rowNumber === updates[j - 1].rowNumber + 1) j++;
        const group = updates.slice(i, j);
        sh.getRange(group[0].rowNumber, 1, group.length, HEADERS.length)
          .setNumberFormat('@').setValues(group.map(x => x.values));
        i = j;
    }
    if (additions.length) {
        const firstNewRow = sh.getLastRow() + 1;
        sh.getRange(firstNewRow, 1, additions.length, HEADERS.length)
          .setNumberFormat('@').setValues(additions);
    }
    return { filas: rows.length, insertadas, actualizadas };
}
function getProgress_() {
    const sh = getSheet_();
    if (sh.getLastRow() < 2)
        return { ok: true, version: CONFIG.VERSION, municipios: [] };
    const values = sh.getDataRange().getDisplayValues(), h = values.shift(), ix = {};
    h.forEach((v, i) => ix[v] = i);
    const map = {};
    values.forEach(r => {
        if (r[ix.ESTADO_REGISTRO] === 'ELIMINADO' || r[ix.SELECCIONADA] !== 'SI' || String(r[ix.CONSECUTIVO_PERSONA] || '').startsWith('AD'))
            return;
        const k = r[ix.CODIGO_MUNICIPIO] + '|' + r[ix.MUNICIPIO] + '|' + r[ix.TIPO_AREA];
        if (!map[k])
            map[k] = { codigoMunicipio: r[ix.CODIGO_MUNICIPIO], municipio: r[ix.MUNICIPIO], tipo: r[ix.TIPO_AREA], seleccionadas: 0, conResultado: 0, efectivas: 0 };
        map[k].seleccionadas++;
        if (r[ix.RESULTADO_VISITA] && r[ix.RESULTADO_VISITA] !== 'Pendiente')
            map[k].conResultado++;
        if (r[ix.RESULTADO_VISITA] === 'Efectiva')
            map[k].efectivas++;
    });
    return { ok: true, version: CONFIG.VERSION, municipios: Object.values(map) };
}
function crearSabanaRecoleccion() { const sh = getSheet_(); ensureHeaders_(sh); return CONFIG.HOJA + ' lista.'; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function jsonp_(cb, o) { return ContentService.createTextOutput(cb + '(' + JSON.stringify(o) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT); }
