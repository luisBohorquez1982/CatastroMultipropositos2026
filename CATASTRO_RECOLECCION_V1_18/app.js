/* CATastro Recolección V1.18 | Muestra precargada de prueba.
 * La selección es local, queda congelada y conserva universo completo para auditoría.
 * Sin configuración técnica visible al encuestador.
 */
'use strict';
const STORE='CATASTRO_V11_RECORDS';
const QUEUE='CATASTRO_V11_QUEUE';
const SAMPLE_SIZE=12;
const ENKETO_BASE='https://ee.kobotoolbox.org/x/eIVMgc7N';
const SYNC_ENDPOINT='https://script.google.com/macros/s/AKfycbwS2T1jtwxe97Av3RovnWh4nz3j_-LI2HWNPw-goxA_zIzFq2UdxRvOOZPABWM1M1seig/exec';
const SYNC_TOKEN='CAT-hUpk8PehG9j2j4xZMYsPZ-Fr1XMgsY4jufSUwnp4';
const KOBO_FIELDS={nim:'nim',mgn:'mgn',home:'predio',department:'p3a',municipality:'p3b',supervisor:'p7a',enumerator:'p8a',zone:'p4'};
const RESULTS=['Pendiente','Efectiva','Rechazo','Ausente','Informante idóneo ausente','Vivienda desocupada','No existe','Otro'];
const $=id=>document.getElementById(id);
let current=null,currentRecord=null,toastTimer=null,modalCancelAction=null,syncInProgress=false,syncTimer=null,manualSyncRequested=false;
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function write(key,value){localStorage.setItem(key,JSON.stringify(value))}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function idFor(a){return `${a.nim}::${a.mgn}`}
function showToast(message,type='info'){const host=$('toastHost');host.innerHTML=`<div class="toast ${type}"><span class="toast-mark">${type==='error'?'!':type==='success'?'✓':'i'}</span><span>${esc(message)}</span></div>`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>host.innerHTML='',3600)}
function showModal(title,message,type='success'){const layer=$('modalLayer');$('modalTitle').textContent=title;$('modalMessage').textContent=message;$('modalIcon').className='modal-icon '+(type==='warning'?'warn':type==='error'?'error':'');$('modalIcon').textContent=type==='error'?'!':type==='warning'?'!':'✓';layer.classList.remove('hidden')}
function closeModal(){$('modalLayer').classList.add('hidden')}

const SEARCH_SELECTS = {
  department: 'Buscar departamento…',
  municipality: 'Buscar municipio…',
  assignment: 'Buscar NIM, MGN o área…'
};
function enhanceSearchableSelect(id, placeholder){
  const select=$(id);
  if(!select || select.dataset.searchEnhanced==='1')return;
  const wrap=document.createElement('div');
  wrap.className='search-select';
  wrap.dataset.for=id;
  const input=document.createElement('input');
  input.type='search';
  input.className='search-select-input';
  input.placeholder=placeholder;
  input.autocomplete='off';
  input.setAttribute('role','combobox');
  input.setAttribute('aria-expanded','false');
  input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-label',placeholder.replace('…',''));
  const menu=document.createElement('div');
  menu.className='search-select-menu hidden';
  menu.setAttribute('role','listbox');
  wrap.append(input,menu);
  select.insertAdjacentElement('afterend',wrap);
  select.classList.add('native-select-hidden');
  select.dataset.searchEnhanced='1';
  const close=()=>{menu.classList.add('hidden');input.setAttribute('aria-expanded','false')};
  const render=()=>{
    const q=input.value.trim().toLocaleLowerCase('es');
    const opts=[...select.options];
    const matches=opts.filter(o=>(o.textContent||'').toLocaleLowerCase('es').includes(q));
    menu.innerHTML='';
    if(!matches.length){
      const empty=document.createElement('div');empty.className='search-select-empty';empty.textContent='No se encontraron coincidencias';menu.append(empty);
    }else{
      matches.slice(0,150).forEach(opt=>{
        const item=document.createElement('button');
        item.type='button';item.className='search-select-option'+(opt.value===select.value?' selected':'');
        item.setAttribute('role','option');item.setAttribute('aria-selected',opt.value===select.value?'true':'false');
        item.textContent=opt.textContent||'';
        item.disabled=opt.disabled;
        item.addEventListener('mousedown',e=>e.preventDefault());
        item.addEventListener('click',()=>{
          select.value=opt.value;
          select.dispatchEvent(new Event('change',{bubbles:true}));
          input.value=opt.value===''?'':opt.textContent;
          close();
        });
        menu.append(item);
      });
      if(matches.length>150){const more=document.createElement('div');more.className='search-select-empty';more.textContent=`Mostrando 150 de ${matches.length}. Escriba para afinar la búsqueda.`;menu.append(more)}
    }
    menu.classList.remove('hidden');input.setAttribute('aria-expanded','true');
  };
  input.addEventListener('focus',()=>{input.value='';render()});
  input.addEventListener('input',render);
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){close();input.value=select.selectedOptions[0]?.textContent||'';input.blur()}
    if(e.key==='Enter'){e.preventDefault();const first=menu.querySelector('.search-select-option:not(:disabled)');if(first)first.click()}
    if(e.key==='ArrowDown'){e.preventDefault();menu.querySelector('.search-select-option')?.focus()}
  });
  select.addEventListener('change',()=>{
    if(document.activeElement!==input)input.value=select.value===''?'':(select.selectedOptions[0]?.textContent||'');
  });
  wrap._refresh=()=>{
    input.value=select.value===''?'':(select.selectedOptions[0]?.textContent||'');
    if(!menu.classList.contains('hidden'))render();
  };
  document.addEventListener('click',e=>{if(!wrap.contains(e.target))close()});
  return wrap;
}
function refreshSearchableSelect(id){
  const wrap=document.querySelector(`.search-select[data-for="${id}"]`);
  if(wrap?._refresh)wrap._refresh();
}

function init(){
  document.addEventListener('click',e=>{
    const btn=e.target.closest('.gpsBtn');if(!btn)return;
    e.preventDefault();e.stopPropagation();if(btn.disabled)return;
    const index=Number(btn.dataset.i);if(!Number.isInteger(index))return;captureGps(index)
  });
  renderAssignmentOptions();
  Object.entries(SEARCH_SELECTS).forEach(([id,ph])=>enhanceSearchableSelect(id,ph));
  $('assignment').onchange=selectAssignment;
  $('department').onchange=()=>{renderMunicipalities();renderAssignmentList()};
  $('municipality').onchange=renderAssignmentList;
  $('housingCount').oninput=validateCount;
  $('generate').onclick=generateSelection;
  $('savePartial').onclick=()=>saveRecord('EN_PROCESO');
  $('syncButton').onclick=syncRecord;
  $('modalClose').onclick=closeModal;
  $('modalLayer').onclick=e=>{if(e.target===$('modalLayer')){if(modalCancelAction)modalCancelAction();else closeModal()}};
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modalLayer').classList.contains('hidden')){if(modalCancelAction)modalCancelAction();else closeModal()}});
  const reconnect=()=>{updateNetwork();if(navigator.onLine)flushSyncQueue()};
  window.addEventListener('online',reconnect);
  window.addEventListener('pageshow',reconnect);
  window.addEventListener('focus',reconnect);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)reconnect()});
  window.addEventListener('offline',updateNetwork);
  updateNetwork();renderHistory();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  if(navigator.onLine&&read(QUEUE,[]).length)flushSyncQueue();
  setInterval(()=>{if(navigator.onLine&&read(QUEUE,[]).length&&!syncInProgress)flushSyncQueue()},15000);
}
function renderAssignmentOptions(){const deps=[...new Set(CATASTRO_ASSIGNMENTS.map(a=>a.departamento))].sort();$('department').innerHTML='<option value="">Todos</option>'+deps.map(x=>`<option>${esc(x)}</option>`).join('');renderMunicipalities();renderAssignmentList();$('assignmentCount').textContent=CATASTRO_ASSIGNMENTS.length;refreshSearchableSelect('department')}
function renderMunicipalities(){const d=$('department').value;const muns=[...new Set(CATASTRO_ASSIGNMENTS.filter(a=>!d||a.departamento===d).map(a=>a.municipio))].sort();$('municipality').innerHTML='<option value="">Todos</option>'+muns.map(x=>`<option>${esc(x)}</option>`).join('');refreshSearchableSelect('municipality')}
function renderAssignmentList(){const d=$('department').value,m=$('municipality').value;const list=CATASTRO_ASSIGNMENTS.filter(a=>(!d||a.departamento===d)&&(!m||a.municipio===m));$('assignment').innerHTML='<option value="">Seleccione un área…</option>'+list.map(a=>`<option value="${esc(idFor(a))}">${esc(a.nim)} · ${esc(a.mgn)} · ${esc(a.zona)} · ${esc(a.municipio)} · Orden ${esc(a.ordenAbordaje)}</option>`).join('');$('assignment').disabled=!list.length;refreshSearchableSelect('assignment')}
function normalizeKeyPart(value){return String(value??'').trim().toUpperCase().replace(/\\s+/g,'')}
function recordBelongsToAssignment(record,key,assignment){
  if(!record||record.estado_registro==='PENDIENTE_ELIMINACION')return false;
  const wantedNim=normalizeKeyPart(assignment?.nim);
  const wantedMgn=normalizeKeyPart(assignment?.mgn);
  const recordNim=normalizeKeyPart(record.nim);
  const recordMgn=normalizeKeyPart(record.mgn);
  // Current schema, legacy schema with NIM/MGN fields, and the original
  // idRecorrido=idFor(assignment) format are all recognized.
  if(record.idAsignacion===key)return true;
  if(recordNim&&recordMgn&&wantedNim&&wantedMgn)
    return recordNim===wantedNim&&recordMgn===wantedMgn;
  return record.idRecorrido===key;
}
function findExistingAssignmentRecord(key,assignment){
  const records=read(STORE,[]);
  return records.filter(r=>recordBelongsToAssignment(r,key,assignment))
    .sort((a,b)=>String(b.actualizado||b.fechaGeneracion||'').localeCompare(String(a.actualizado||a.fechaGeneracion||'')))[0]||null;
}
function assignmentHasWorkingRecord(key,assignment){
  return read(STORE,[]).some(r=>recordBelongsToAssignment(r,key,assignment));
}
function selectAssignment(){
  const key=$('assignment').value;
  current=CATASTRO_ASSIGNMENTS.find(a=>idFor(a)===key)||null;
  currentRecord=null;
  $('housingCount').value='';
  $('generate').disabled=true;
  $('workArea').classList.add('hidden');

  if(!current){
    $('assignmentInfo').textContent='Seleccione una asignación para consultar su información.';
    $('assignmentInfo').classList.add('empty-state');
    $('methodNote').innerHTML='<span class="note-symbol">i</span><span>Seleccione un área, registre el total de viviendas y genere el recorrido. Los recorridos guardados se pueden abrir desde el histórico.</span>';
    return;
  }

  const rural=/vereda|rural/i.test(current.zona||'');
  const zonaLabel=rural?'RURAL':(/cabecera|centro poblado/i.test(current.zona||'')?'URBANO':String(current.zona||'SIN CLASIFICAR').toUpperCase());
  $('assignmentInfo').classList.remove('empty-state');
  $('assignmentInfo').innerHTML=`<strong>${esc(current.departamento)} · ${esc(current.municipio)}</strong><span class="zone-pill ${rural?'rural':''}">${zonaLabel}</span><br>MGN: <strong>${esc(current.mgn)}</strong> &nbsp;·&nbsp; NIM: <strong>${esc(current.nim)}</strong><br>Segmento: ${esc(current.idSegmento)} &nbsp;·&nbsp; Orden de abordaje: ${esc(current.ordenAbordaje)}${current.vereda?`<br>Vereda: ${esc(current.vereda)}`:''}<br>Supervisor: ${esc(current.supervisor)}<br>Encuestador: ${esc(current.encuestador)}${current.latitudReferencia?`<br>Coordenada de referencia: ${esc(current.latitudReferencia)}, ${esc(current.longitudReferencia)}`:''}`;

  const existing=findExistingAssignmentRecord(key,current);
  if(existing){
    $('methodNote').innerHTML='<span class="note-symbol">i</span><span>Esta asignación ya cuenta con un recorrido registrado. Consulte el histórico para abrirlo o visualizarlo.</span>';
    showWorkedAssignmentModal(existing);
    return;
  }

  $('methodNote').innerHTML='<span class="note-symbol">i</span><span>El sorteo se ejecutará una sola vez. Si el universo es de 12 viviendas o menos, se recorrerán en orden natural sin sorteo.</span>';
  $('generate').disabled=!validCount();
}
function showWorkedAssignmentModal(record){
  const finalized=record.estado==='FINALIZADO';
  $('modalTitle').textContent='MGN ya trabajada';
  $('modalMessage').textContent=finalized
    ? 'Esta MGN ya cuenta con un recorrido finalizado. No es posible iniciar otro desde Asignaciones. Para consultar el recorrido, ingrese desde la tabla del histórico.'
    : 'Esta MGN ya tiene un recorrido guardado o en proceso. No es posible generar una nueva selección desde Asignaciones. Para continuar, ingrese al recorrido desde la tabla del histórico.';
  $('modalIcon').className='modal-icon warn';
  $('modalIcon').textContent='!';
  const actions=document.querySelector('#modalLayer .modal-actions');
  actions.innerHTML='<button id="workedClose" class="btn btn-primary">Cerrar</button>';
  modalCancelAction=()=>{
    modalCancelAction=null;
    closeModal();
    restoreModalActions();
    resetWorkspace();
  };
  $('workedClose').onclick=()=>modalCancelAction?.();
  $('modalLayer').classList.remove('hidden');
}
function validCount(){const n=Number($('housingCount').value);return Number.isInteger(n)&&n>0}
function validateCount(){const ok=!!current&&validCount()&&!assignmentHasWorkingRecord(idFor(current),current);$('generate').disabled=!ok}
function generateSelection(){if(!current||!validCount())return showModal('Dato no válido','Ingrese un total entero de viviendas mayor que cero.','warning');const key=idFor(current);if(assignmentHasWorkingRecord(key,current))return showModal('MGN ya trabajada','Esta asignación ya tiene un recorrido registrado. Para habilitarla nuevamente, marque el recorrido correspondiente para eliminación desde el histórico.','warning');const n=Number($('housingCount').value);let universe=[],chosen=[],method;if(n<=SAMPLE_SIZE){universe=Array.from({length:n},(_,i)=>({vivienda:i+1,aleatorio:null,ordenNatural:i+1}));chosen=universe.map((x,i)=>({...x,orden:i+1}));method='CENSO_DEL_UNIVERSO_ORDEN_NATURAL'}else{universe=Array.from({length:n},(_,i)=>({vivienda:i+1,aleatorio:Math.random()}));universe.sort((a,b)=>a.aleatorio-b.aleatorio||a.vivienda-b.vivienda);chosen=universe.slice(0,SAMPLE_SIZE).map((x,i)=>({...x,orden:i+1}));method='MUESTREO_ALEATORIO_SIMPLE_ASCENDENTE'}const now=new Date().toISOString();currentRecord={idRecorrido:`${key}::${Date.now()}`,idAsignacion:key,estado:'EN_PROCESO',estado_registro:'ACTIVO',estado_sincronizacion:'PENDIENTE',fechaGeneracion:now,actualizado:now,...current,conteo:n,meta:chosen.length,metodo:method,seleccion:chosen.map(x=>({...x,identificador:[current.nim,current.mgn,x.vivienda].join('|'),resultado:'Pendiente',gpsEstado:'Pendiente',gpsLatitud:null,gpsLongitud:null,gpsAltitud:null,gpsPrecision:null,gpsFecha:null,koboUrl:''})),universoAuditoria:universe};writeRecord();$('workArea').classList.remove('hidden');$('generate').disabled=true;$('methodNote').innerHTML=`<span class="note-symbol">✓</span><span>${n<=12?`Universo de ${n}: no se realizó sorteo. Se conservó el orden natural 1 a ${n}.`:`Sorteo realizado sobre ${n} viviendas. Se seleccionaron las primeras 12 tras ordenar los aleatorios ascendentemente.`} La selección quedó congelada.</span>`;renderRecord();showModal('Recorrido generado',`${chosen.length} viviendas quedaron asignadas al recorrido. La selección se guardó en este dispositivo.`,'success')}
function resultCounts(r){const s=r.seleccion;return {total:s.length,efectivas:s.filter(x=>x.resultado==='Efectiva').length,rechazos:s.filter(x=>x.resultado==='Rechazo').length,ausentes:s.filter(x=>x.resultado==='Ausente'||x.resultado==='Informante idóneo ausente').length,desocupadas:s.filter(x=>x.resultado==='Vivienda desocupada').length,otros:s.filter(x=>x.resultado==='No existe'||x.resultado==='Otro').length,pendientes:s.filter(x=>x.resultado==='Pendiente').length}}
function renderRecord(){
  const r=currentRecord;if(!r)return;
  const locked=r.estado==='FINALIZADO';
  const notice=$('readOnlyNotice');if(notice)notice.classList.toggle('hidden',!locked);
  const c=resultCounts(r),done=c.total-c.pendientes,progress=c.total?Math.round(done/c.total*100):0;
  $('routeStatus').textContent=locked?'Consulta':'En proceso';
  $('routeSubtitle').textContent=`${r.municipio} · ${r.zona} · ${r.mgn}`;
  $('metrics').innerHTML=[['Seleccionadas',c.total,''],['Efectivas',c.efectivas,'good'],['Rechazos',c.rechazos,'bad'],['Ausentes',c.ausentes,''],['Desocupadas',c.desocupadas,''],['Pendientes',c.pendientes,'']].map(([l,v,cl])=>`<div class="metric ${cl}"><strong>${v}</strong><span>${l}</span></div>`).join('');
  $('progressText').textContent=`${progress}% · ${done} de ${c.total}`;$('progressFill').style.width=progress+'%';
  $('homesTable').innerHTML=r.seleccion.map((h,i)=>`<tr><td><strong>${h.orden}</strong></td><td>V-${String(h.vivienda).padStart(3,'0')}</td><td>${resultSelect(i,h,locked)}</td><td>${gpsControl(i,h,locked)}</td><td>${koboControl(h,locked)}</td></tr>`).join('');
  $('mobileHomes').innerHTML=r.seleccion.map((h,i)=>`<div class="mobile-card"><div class="mobile-card-head"><strong>Vivienda ${String(h.vivienda).padStart(3,'0')}</strong><span class="soft-tag">Orden ${h.orden}</span></div><label>Resultado de visita${resultSelect(i,h,locked)}</label><div class="gps-row">${gpsControl(i,h,locked)}${koboControl(h,locked)}</div></div>`).join('');
  document.querySelectorAll('.resultSelect').forEach(el=>el.onchange=()=>setResult(Number(el.dataset.i),el.value));
  $('savePartial').disabled=locked;
  $('syncButton').disabled=syncInProgress;
  $('syncButton').textContent=syncInProgress?'Enviando…':'Sincronizar';
  $('syncButton').title='Guardar el estado actual, enviarlo si hay conexión y limpiar el formulario';
}
function resultSelect(i,h,locked){return `<select class="resultSelect" data-i="${i}" ${locked?'disabled':''}>${RESULTS.map(v=>`<option value="${esc(v)}" ${v===h.resultado?'selected':''}>${esc(v)}</option>`).join('')}</select>`}
function gpsControl(i,h,locked){return `<div><button type="button" class="btn btn-secondary gps-btn gpsBtn" data-i="${i}" ${locked?'disabled':''}>${h.gpsEstado==='CAPTURADO'?'Actualizar GPS':'Capturar GPS'}</button><div class="gps-status ${h.gpsEstado==='CAPTURADO'?'ok':''}">${h.gpsEstado==='CAPTURADO'?`${Number(h.gpsLatitud).toFixed(6)}, ${Number(h.gpsLongitud).toFixed(6)}<br>Precisión ±${h.gpsPrecision} m`:'GPS pendiente'}</div></div>`}
function koboControl(h,locked=false){
  if(h.resultado!=='Efectiva')return '<span class="pending-kobo">—</span>';
  if(!h.koboUrl)return '<span class="pending-kobo">Enlace no disponible</span>';
  return locked
    ? '<span class="kobo-link-disabled" aria-disabled="true" title="El recorrido finalizado está en modo de consulta">Encuesta registrada · Solo consulta</span>'
    : `<a class="kobo-link" href="${esc(h.koboUrl)}" target="_blank" rel="noopener">Abrir encuesta ↗</a>`;
}
function setResult(i,value){if(!currentRecord||currentRecord.estado==='FINALIZADO')return showToast('El recorrido finalizado está en modo de consulta.','warning');const h=currentRecord.seleccion[i];h.resultado=value;h.koboUrl=value==='Efectiva'?buildKoboUrl(currentRecord,h):'';touch();renderRecord();showToast('Resultado actualizado.','success')}
function buildKoboUrl(r,h){const u=new URL(ENKETO_BASE);const values={[KOBO_FIELDS.nim]:r.nim,[KOBO_FIELDS.mgn]:r.mgn,[KOBO_FIELDS.home]:h.vivienda,[KOBO_FIELDS.department]:r.codigoDepartamento,[KOBO_FIELDS.municipality]:r.codigoMunicipio,[KOBO_FIELDS.supervisor]:r.supervisor,[KOBO_FIELDS.enumerator]:r.encuestador,[KOBO_FIELDS.zone]:zoneCode(r.zona)};Object.entries(values).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(`d[${k}]`,String(v))});return u.toString()}
function zoneCode(z){if(/^cabecera$/i.test(z))return'1';if(/centro poblado/i.test(z))return'2';return'3'}
function captureGps(i){
  if(!currentRecord||currentRecord.estado==='FINALIZADO')return showToast('El recorrido finalizado está en modo de consulta.','warning');
  const h=currentRecord?.seleccion?.[i];
  if(!h)return;
  if(!window.isSecureContext||!navigator.geolocation)return showModal('GPS no disponible','El navegador solo permite capturar ubicación en una conexión segura. Abre el aplicativo mediante HTTPS o desde http://localhost con Live Server y autoriza la ubicación para este sitio.','error');
  h.gpsEstado='Buscando señal GPS…';
  renderRecord();
  showToast('Buscando ubicación GPS… mantén abierta esta pantalla.','info');
  let watchId=null, settled=false, best=null, lastGpsError=null;
  const startedAt=Date.now();
  const finish=(ok,message)=>{
    if(settled)return;
    settled=true;
    if(watchId!==null)navigator.geolocation.clearWatch(watchId);
    if(ok&&best){
      h.gpsLatitud=Number(best.coords.latitude.toFixed(7));
      h.gpsLongitud=Number(best.coords.longitude.toFixed(7));
      h.gpsPrecision=Number(best.coords.accuracy.toFixed(1));
      h.gpsAltitud=best.coords.altitude===null?null:Number(best.coords.altitude.toFixed(2));
      h.gpsFecha=new Date(best.timestamp||Date.now()).toISOString();
      h.gpsEstado='CAPTURADO';
      touch();renderRecord();
      const duplicate=currentRecord.seleccion.some((other,j)=>j!==i&&other.gpsEstado==='CAPTURADO'&&Math.abs(Number(other.gpsLatitud)-h.gpsLatitud)<0.000015&&Math.abs(Number(other.gpsLongitud)-h.gpsLongitud)<0.000015);
      if(duplicate)showModal('Ubicación coincidente','El punto capturado es muy cercano al de otra vivienda. Si estás registrando predios contiguos, verifica que el GPS haya actualizado su posición y vuelve a capturar si es necesario.','warning');
      else showToast(`GPS actualizado. Precisión: ±${h.gpsPrecision} m.`,'success');
    }else{
      h.gpsEstado='Pendiente';renderRecord();
      showModal('No se obtuvo una ubicación confiable',message||'No se recibió una lectura GPS suficientemente precisa. Activa la ubicación del dispositivo, espera unos segundos y vuelve a intentarlo.','warning');
    }
  };
  try{
    watchId=navigator.geolocation.watchPosition(pos=>{
      if(settled)return;
      // Exigir una lectura nueva, pero dar tiempo al receptor para estabilizarse.
      if(!pos.timestamp||pos.timestamp<startedAt-1000)return;
      if(!Number.isFinite(pos.coords.accuracy)||pos.coords.accuracy<=0)return;
      if(!best||pos.coords.accuracy<best.coords.accuracy)best=pos;
      // Aceptar rápidamente una lectura buena; si no llega, seguir buscando.
      if(pos.coords.accuracy<=35&&Date.now()-startedAt>=3500)finish(true);
    },err=>{
      if(err.code===1){
        finish(false,'El navegador o el dispositivo denegó el permiso de ubicación. Autoriza la ubicación precisa para este sitio y vuelve a intentarlo.');
      }else if(err.code===2){
        lastGpsError='El dispositivo todavía no logra determinar la ubicación. Comprueba que la ubicación/GPS esté activada.';
      }else if(err.code===3){
        // Un timeout de una lectura individual no debe cancelar toda la búsqueda.
        lastGpsError='El GPS está tardando en responder. Se seguirá intentando hasta completar el tiempo de captura.';
      }
    },{enableHighAccuracy:true,maximumAge:0,timeout:60000});
    // El teléfono puede tardar bastante más de 12 segundos en obtener una lectura nueva,
    // especialmente al aire libre tras activar GPS o en equipos con ahorro de batería.
    setTimeout(()=>{
      if(settled)return;
      if(best&&best.coords.accuracy<=100){
        finish(true);
      }else{
        const detail=best
          ? `La mejor lectura obtenida fue de ±${Math.round(best.coords.accuracy)} m, superior al máximo admitido de ±100 m.`
          : (lastGpsError||'El dispositivo no entregó coordenadas nuevas durante el tiempo de espera.');
        finish(false,`${detail} Mantén activada la ubicación precisa, desactiva el ahorro de batería si está activo y prueba en un espacio abierto.`);
      }
    },45000);
  }catch(e){finish(false,'No fue posible iniciar la lectura GPS. Verifica los permisos del navegador y que la página esté abierta mediante HTTPS o localhost.')}
}
function persistRecord(record){const all=read(STORE,[]),idx=all.findIndex(x=>x.idRecorrido===record.idRecorrido);if(idx>=0)all[idx]=JSON.parse(JSON.stringify(record));else all.push(JSON.parse(JSON.stringify(record)));write(STORE,all);renderHistory()}
function queueSnapshot(record){if(!record||!record.idRecorrido)return;const queue=read(QUEUE,[]);const snapshot=JSON.parse(JSON.stringify(record));snapshot.estado_sincronizacion='PENDIENTE';const idx=queue.findIndex(x=>x.idRecorrido===snapshot.idRecorrido);if(idx>=0)queue[idx]=snapshot;else queue.push(snapshot);write(QUEUE,queue);record.estado_sincronizacion='PENDIENTE';persistRecord(record);updateNetwork();if(syncTimer)clearTimeout(syncTimer);if(navigator.onLine)syncTimer=setTimeout(()=>flushSyncQueue(),1800)}
function touch(){if(!currentRecord)return;currentRecord.actualizado=new Date().toISOString();queueSnapshot(currentRecord)}
function writeRecord(){if(!currentRecord)return;queueSnapshot(currentRecord)}
function canSync(r){return !!r&&Array.isArray(r.seleccion)&&r.seleccion.length>0&&Array.isArray(r.universoAuditoria)&&r.universoAuditoria.length>0}
function resetWorkspace(){
  current=null;currentRecord=null;
  $('assignment').value='';
  refreshSearchableSelect('assignment');
  $('housingCount').value='';
  $('generate').disabled=true;
  $('workArea').classList.add('hidden');
  $('homesTable').innerHTML='';$('mobileHomes').innerHTML='';$('metrics').innerHTML='';$('progressText').textContent='0%';$('progressFill').style.width='0%';$('routeSubtitle').textContent='Registro de resultados y puntos GPS.';$('routeStatus').textContent='En proceso';
  $('assignmentInfo').classList.add('empty-state');
  $('assignmentInfo').textContent='Seleccione una asignación para consultar su información.';
  $('methodNote').innerHTML='<span class="note-symbol">i</span><span>Seleccione un área, registre el total de viviendas y genere el recorrido. Los recorridos guardados se pueden abrir desde el historial.</span>';
}
function saveRecord(state='EN_PROCESO'){
  if(!currentRecord)return showToast('No hay un recorrido abierto para guardar.','warning');
  currentRecord.estado='EN_PROCESO';
  currentRecord.actualizado=new Date().toISOString();
  queueSnapshot(currentRecord);
  persistRecord(currentRecord);
  resetWorkspace();
  showToast(navigator.onLine
    ? 'Recorrido guardado en este dispositivo. El respaldo central se actualizará automáticamente.'
    : 'Recorrido guardado en este dispositivo. Quedó pendiente para sincronizar al recuperar internet.','success');
  if(navigator.onLine)flushSyncQueue();
}
function syncRecord(){
  if(currentRecord){
    currentRecord.estado='EN_PROCESO';
    currentRecord.actualizado=new Date().toISOString();
    queueSnapshot(currentRecord);
    persistRecord(currentRecord);
    resetWorkspace();
  }
  if(!read(QUEUE,[]).length){
    updateNetwork();
    return showToast('No hay cambios pendientes de sincronización.','info');
  }
  if(!navigator.onLine){
    updateNetwork();
    return showToast('Formulario limpio. Los cambios quedaron en cola y se enviarán al recuperar internet.','warning');
  }
  flushSyncQueue(true);
}
function scheduleQueueRetry(){
  if(syncTimer)clearTimeout(syncTimer);
  if(navigator.onLine&&read(QUEUE,[]).length)syncTimer=setTimeout(()=>{if(!syncInProgress)flushSyncQueue()},12000);
}
async function flushSyncQueue(manual=false){
  if(syncInProgress||!navigator.onLine)return;
  const queue=read(QUEUE,[]);
  if(!queue.length){updateNetwork();return}
  const record=queue[0];
  const snapshotTime=record.actualizado||record.fechaGeneracion||'';
  syncInProgress=true;
  const button=$('syncButton');
  if(button){button.disabled=true;button.textContent='Enviando…'}
  updateNetwork();
  if(manual)showToast('Enviando los cambios pendientes a la sábana central…','info');
  try{
    const response=await fetch(SYNC_ENDPOINT,{
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({token:SYNC_TOKEN,registro:record})
    });
    const latest=read(QUEUE,[]);
    const ix=latest.findIndex(x=>x.idRecorrido===record.idRecorrido);
    const stillSame=ix>=0&&(latest[ix].actualizado||latest[ix].fechaGeneracion||'')===snapshotTime;
    if(stillSame){
      latest.splice(ix,1);write(QUEUE,latest);
      const all=read(STORE,[]);
      const ri=all.findIndex(x=>x.idRecorrido===record.idRecorrido);
      if(ri>=0){
        all[ri].estado_sincronizacion='SINCRONIZADO';
        all[ri].fechaSincronizacion=new Date().toISOString();
        all[ri].filasSincronizadas=record.universoAuditoria?.length||0;
        write(STORE,all);
      }
    }
    updateNetwork();renderHistory();
    if(manual)showToast('Envío realizado. La sábana central se actualizará con este recorrido.','success');
    if(read(QUEUE,[]).length&&navigator.onLine)setTimeout(()=>flushSyncQueue(),700);
  }catch(error){
    console.warn('Sincronización pendiente:',error);
    updateNetwork();
    if(manual)showToast('No fue posible enviar ahora. Los datos siguen guardados y en cola.','warning');
    scheduleQueueRetry();
  }finally{
    syncInProgress=false;
    if(button){button.disabled=false;button.textContent='Sincronizar'}
    updateNetwork();
  }
}
function openHistoryRecord(key){
  modalCancelAction=null;
  const all=read(STORE,[]);
  const rec=all.find(r=>r.idRecorrido===key);
  if(!rec)return showModal('Recorrido no encontrado','No fue posible recuperar el recorrido guardado.','error');
  currentRecord=rec;
  current=CATASTRO_ASSIGNMENTS.find(a=>idFor(a)===(rec.idAsignacion||key))||rec;
  const opt=[...$('assignment').options].find(o=>o.value===(rec.idAsignacion||key));
  if(opt){$('assignment').value=rec.idAsignacion||key;refreshSearchableSelect('assignment');}
  $('housingCount').value=rec.conteo;
  $('assignmentInfo').classList.remove('empty-state');
  const rural=/vereda|rural/i.test(rec.zona||'');
  const zonaLabel=rural?'RURAL':(/cabecera|centro poblado/i.test(rec.zona||'')?'URBANO':String(rec.zona||'SIN CLASIFICAR').toUpperCase());
  $('assignmentInfo').innerHTML=`<strong>${esc(rec.departamento)} · ${esc(rec.municipio)}</strong><span class="zone-pill ${rural?'rural':''}">${zonaLabel}</span><br>MGN: <strong>${esc(rec.mgn)}</strong> &nbsp;·&nbsp; NIM: <strong>${esc(rec.nim)}</strong><br>Supervisor: ${esc(rec.supervisor)}<br>Encuestador: ${esc(rec.encuestador)}<br><strong>Recorrido ${rec.estado==='FINALIZADO'?'finalizado':'en proceso'} recuperado.</strong>`;
  $('workArea').classList.remove('hidden');
  $('methodNote').innerHTML='<span class="note-symbol">i</span><span>La selección original se conserva. No se permite generar un nuevo sorteo para esta asignación.</span>';
  renderRecord();
  $('workArea').scrollIntoView({behavior:'smooth',block:'start'});
}
function requestLogicalDeletion(key){
  const rec=read(STORE,[]).find(r=>r.idRecorrido===key);
  if(!rec)return showModal('Recorrido no encontrado','No fue posible localizar el registro que desea marcar.','error');
  if(rec.estado_registro==='PENDIENTE_ELIMINACION')return showToast('Este recorrido ya está marcado para eliminación.','info');
  $('modalTitle').textContent='Marcar recorrido para eliminación';
  $('modalMessage').textContent='El recorrido no se borrará del dispositivo. Se conservarán selección, resultados y GPS. Se marcarán para eliminación los registros duplicados que correspondan a la misma asignación NIM + MGN, para liberar la manzana completa y permitir un nuevo recorrido. La depuración física se realizará posteriormente desde la base central.';
  $('modalIcon').className='modal-icon warn';
  $('modalIcon').textContent='!';
  const actions=document.querySelector('#modalLayer .modal-actions');
  actions.innerHTML='<button id="modalCancelDelete" class="btn btn-secondary">Cancelar</button><button id="confirmLogicalDelete" class="btn btn-danger">Marcar para eliminación</button>';
  $('modalLayer').classList.remove('hidden');
  $('modalCancelDelete').onclick=()=>{closeModal();restoreModalActions()};
  $('confirmLogicalDelete').onclick=()=>{ 
    const all=read(STORE,[]);
    const target=all.find(r=>r.idRecorrido===key);
    if(!target){closeModal();restoreModalActions();return}
    // Liberar la asignación completa: versiones anteriores pudieron dejar
    // más de una fila local para el mismo NIM+MGN. Marcar solo una fila
    // mantendría la MGN bloqueada por la fila duplicada restante.
    const targetNim=normalizeKeyPart(target.nim);
    const targetMgn=normalizeKeyPart(target.mgn);
    const targetAssignment=target.idAsignacion||'';
    const related=all.filter(r=>{
      if(!r)return false;
      if(targetAssignment&&r.idAsignacion===targetAssignment)return true;
      const sameNim=targetNim&&normalizeKeyPart(r.nim)===targetNim;
      const sameMgn=targetMgn&&normalizeKeyPart(r.mgn)===targetMgn;
      if(sameNim&&sameMgn)return true;
      // Legacy records may not carry explicit NIM/MGN fields; retain exact
      // record fallback without touching unrelated assignments.
      return r.idRecorrido===key;
    });
    const markedAt=new Date().toISOString();
    related.forEach(r=>{
      r.estado_registro='PENDIENTE_ELIMINACION';
      r.fecha_solicitud_eliminacion=markedAt;
      r.usuario_solicita_eliminacion=target.encuestador||'NO_IDENTIFICADO';
      r.motivo_eliminacion='Solicitud desde el aplicativo de recorridos';
      r.estado_sincronizacion='PENDIENTE';
      r.actualizado=markedAt;
      const q=read(QUEUE,[]);const snap=JSON.parse(JSON.stringify(r));const qi=q.findIndex(x=>x.idRecorrido===snap.idRecorrido);if(qi>=0)q[qi]=snap;else q.push(snap);write(QUEUE,q);
    });
    write(STORE,all);updateNetwork();if(navigator.onLine)setTimeout(()=>flushSyncQueue(),500);
    if(currentRecord?.idRecorrido===key)resetWorkspace();
    closeModal();
    restoreModalActions();
    renderHistory();
    showToast('Recorrido marcado para eliminación. La asignación está disponible nuevamente.','success');
  };
}
function restoreModalActions(){
  const actions=document.querySelector('#modalLayer .modal-actions');
  actions.innerHTML='<button id="modalClose" class="btn btn-primary">Entendido</button>';
  $('modalClose').onclick=closeModal;
}
function renderHistory(){
  const all=read(STORE,[]);
  if(!all.length){$('history').innerHTML='Todavía no hay recorridos guardados en este dispositivo.';return}
  $('history').innerHTML=`<div class="table-wrap"><table class="history-table"><thead><tr><th>NIM</th><th>MGN</th><th>Municipio</th><th>Universo</th><th>Seleccionadas</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${all.map(r=>{
    const deleted=r.estado_registro==='PENDIENTE_ELIMINACION';
    const syncLabel=r.estado_sincronizacion==='SINCRONIZADO'?' · En Sheets':' · Pendiente de envío';const status=deleted?'Pendiente de eliminación':((r.estado==='FINALIZADO'?'Finalizado':'En proceso')+syncLabel);
    const cls=deleted?'deletion-pending':(r.estado==='FINALIZADO'?'finished':'');
    const action=deleted?'<span class="history-deletion-note">Marcado</span>':`<button class="btn btn-small btn-history" data-key="${esc(r.idRecorrido)}">${r.estado==='FINALIZADO'?'Ver recorrido':'Abrir recorrido'}</button><button class="btn btn-small btn-mark-delete" data-key="${esc(r.idRecorrido)}" title="Marcar para eliminación" aria-label="Marcar recorrido para eliminación">Marcar eliminación</button>`;
    return `<tr class="${deleted?'row-pending-deletion':''}"><td>${esc(r.nim)}</td><td>${esc(r.mgn)}</td><td>${esc(r.municipio)}</td><td>${r.conteo??''}</td><td>${(r.seleccion||[]).length}</td><td><span class="history-state ${cls}">${status}</span></td><td class="history-actions">${action}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  document.querySelectorAll('.btn-history').forEach(btn=>btn.onclick=()=>openHistoryRecord(btn.dataset.key));
  document.querySelectorAll('.btn-mark-delete').forEach(btn=>btn.onclick=()=>requestLogicalDeletion(btn.dataset.key));
}
function updateNetwork(){const el=$('network');const pending=read(QUEUE,[]).length;if(navigator.onLine){el.classList.remove('offline');el.innerHTML=`<i></i> Con conexión${pending?` · ${pending} pendiente(s)`:''}`}else{el.classList.add('offline');el.innerHTML=`<i></i> Sin conexión · ${pending} en cola`}}
document.addEventListener('DOMContentLoaded',init);
