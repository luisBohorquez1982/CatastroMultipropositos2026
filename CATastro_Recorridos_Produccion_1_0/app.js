/* CATastro Producción 1.0 — almacenamiento local independiente.
 * Conserva la muestra precargada y la interfaz. No recupera recorridos de versiones anteriores.
 */
'use strict';
const STORE='CAT_PROD_1_0_RECORDS', QUEUE='CAT_PROD_1_0_QUEUE', ACTIVE='CAT_PROD_1_0_ACTIVE';
const SAMPLE_SIZE=12, ENDPOINT='https://script.google.com/macros/s/AKfycbwbP6C2SBx2R8pkrFqGhuaWqK-qL9JmZDnYlS8VymTdGODpS5EqOW0cSP5IUNdE8zGL/exec';
const TOKEN='CAT-hUpk8PehG9j2j4xZMYsPZ-Fr1XMgsY4jufSUwnp4';
const KOBO_URL='https://ee.kobotoolbox.org/x/AktLF1GO';
const RESULTS=['Pendiente','Efectiva','Rechazo','Ausente','Informante idóneo ausente','Vivienda desocupada','No existe','No necesaria: meta municipal cumplida','No participó en ninguna de las etapas del proceso catastral','Informante idóneo localizable (Residente/Inquilino desconoce el proceso y se niega a suministrar información del propietario)','Informante idóneo no localizable (Predio en construcción o lote baldío, se desconoce el propietario)','Evacuado con otro predio','No apto para encuesta (persona adulto mayor, persona con discapacidad, etc.)','Invasión','Otro cuál'];
const $=id=>document.getElementById(id); const clone=x=>JSON.parse(JSON.stringify(x));
let current=null, record=null, busy=false, syncRequested=false, retryTimer=null, toastTimer=null;
function read(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch(_){return d}}
function write(k,v){
 const raw=JSON.stringify(v);
 try{localStorage.setItem(k,raw);const check=localStorage.getItem(k);if(check!==raw)throw new Error('La verificación del almacenamiento no coincidió.');}
 catch(e){console.error('CATastro storage',k,e);throw new Error('No fue posible guardar los datos localmente. No cierre esta ventana; libere espacio o exporte un respaldo. Detalle: '+e.message);}
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function idFor(a){return String(a.idAsignacion||`${a.tipo}::${a.area}`)}
function assignmentLabel(a){return `${a.area} · ${a.municipio} · ${a.clase||a.tipo}`}
function randomPart(){return createSurveyId().slice(0,16)}
function surveyIdFor(a,item){const base=a.tipo==='RURAL_DISPERSO'?item.idPersona:`${String(a.idUpm||'').padStart(4,'0')}-${String(item.vivienda).padStart(4,'0')}`;return `${base}-${randomPart()}`}
function createSurveyId(){
 if(window.crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID().replace(/-/g,'').toUpperCase();
 const bytes=new Uint8Array(16);
 if(window.crypto&&crypto.getRandomValues)crypto.getRandomValues(bytes);
 else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
}
function ensureSurveyIds(r){if(r&&Array.isArray(r.seleccion))r.seleccion.forEach(h=>{if(!h.idEncuesta)h.idEncuesta=createSurveyId()})}
function allRecords(){return read(STORE,[])}
function allQueue(){return read(QUEUE,[])}
function toast(msg,type='info'){const h=$('toastHost');h.innerHTML=`<div class="toast ${type}"><span class="toast-mark">${type==='error'?'!':type==='success'?'✓':'i'}</span><span>${esc(msg)}</span></div>`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>h.innerHTML='',4200)}
function modal(title,msg,type='info',actions){const c=$('signatureCanvas');if(c)c.remove();$('modalTitle').textContent=title;$('modalMessage').textContent=msg;$('modalIcon').className='modal-icon '+(type==='warning'?'warn':type==='error'?'error':'');$('modalIcon').textContent=type==='error'?'!':type==='warning'?'!':'✓';const a=document.querySelector('#modalLayer .modal-actions');a.innerHTML=actions||'<button id="modalClose" class="btn btn-primary">Entendido</button>';if($('modalClose'))$('modalClose').onclick=closeModal;$('modalLayer').classList.remove('hidden')}
function closeModal(){$('modalLayer').classList.add('hidden')}
function saveRecordLocal(r){
 const rows=allRecords(),i=rows.findIndex(x=>x.idRecorrido===r.idRecorrido);
 if(i<0)rows.push(clone(r));else rows[i]=clone(r);
 write(STORE,rows);renderHistory();return true;
}
function queueRecord(r){
 const q=allQueue(),s=clone(r);s.estado_sincronizacion='PENDIENTE';
 const i=q.findIndex(x=>x.idRecorrido===s.idRecorrido);if(i<0)q.push(s);else q[i]=s;
 write(QUEUE,q);r.estado_sincronizacion='PENDIENTE';saveRecordLocal(r);updateNetwork();
}
function persistActive(){
 if(!record)return false;
 record.actualizado=new Date().toISOString();
 try{
  if(record.estado==='FINALIZADO'){
   saveRecordLocal(record);
   localStorage.removeItem(ACTIVE);
   return true;
  }
  record._formularioAbierto=true;
  saveRecordLocal(record);queueRecord(record);localStorage.setItem(ACTIVE,record.idRecorrido);return true;
 }catch(e){toast(e.message,'error');return false;}
}

function exportLocalBackup(){
 const payload={app:'CATastro Producción 1.0',schema:1,exportado:new Date().toISOString(),records:allRecords(),queue:allQueue(),active:localStorage.getItem(ACTIVE)||null};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`CATastro_respaldo_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 toast(`Respaldo generado: ${payload.records.length} recorrido(s) y ${payload.queue.length} pendiente(s).`,'success');
}
function importLocalBackup(event){
 const file=event.target.files&&event.target.files[0];if(!file)return;
 const reader=new FileReader();reader.onload=()=>{try{
  const data=JSON.parse(String(reader.result||''));
  if(data.app!=='CATastro Producción 1.0'||data.schema!==1||!Array.isArray(data.records)||!Array.isArray(data.queue))throw new Error('El archivo no corresponde a un respaldo válido de CATastro Producción 1.0.');
  modal('Restaurar respaldo local',`Se integrarán ${data.records.length} recorrido(s) al almacenamiento actual. Los registros con el mismo ID se actualizarán con la copia del respaldo. ¿Desea continuar?`,'info','<button id="restoreCancel" class="btn btn-secondary">Cancelar</button><button id="restoreConfirm" class="btn btn-primary">Restaurar respaldo</button>');
  $('restoreCancel').onclick=()=>{closeModal();event.target.value=''};
  $('restoreConfirm').onclick=()=>{
   try{
    const merge=(a,b)=>{const m=new Map(a.map(x=>[x.idRecorrido,x]));b.forEach(x=>{if(x&&x.idRecorrido)m.set(x.idRecorrido,x)});return [...m.values()]};
    write(STORE,merge(allRecords(),data.records));write(QUEUE,merge(allQueue(),data.queue));
    if(data.active&&allRecords().some(r=>r.idRecorrido===data.active&&r.estado!=='FINALIZADO'&&r.estado_registro!=='ELIMINADO'))localStorage.setItem(ACTIVE,data.active);
    closeModal();renderHistory();updateNetwork();filterAssignments();toast('Respaldo integrado. Verifique el historial antes de continuar.','success');
   }catch(err){closeModal();modal('No se pudo restaurar el respaldo',err.message,'error')}
   event.target.value='';
  };
 }catch(e){modal('No se pudo restaurar el respaldo',e.message,'error');event.target.value=''}};reader.onerror=()=>{event.target.value='';modal('Error de lectura','No fue posible leer el archivo seleccionado.','error')};reader.readAsText(file);
}
function init(){
 // Producción 1.0 inicia con almacenamiento propio y vacío; no importa datos locales anteriores.
 $('assignmentCount').textContent=CATASTRO_ASSIGNMENTS.length;
 setupAutocomplete();
 $('exportBackup').onclick=exportLocalBackup;$('importBackup').onchange=importLocalBackup;
 $('generate').onclick=generateSelection;$('savePartial').onclick=savePartial;$('syncButton').onclick=()=>{if(record&&record.estado==='FINALIZADO'){syncQueue(true);return;}finalizeAndSync();};$('modalClose').onclick=closeModal;
 ['online','offline'].forEach(ev=>window.addEventListener(ev,updateNetwork));window.addEventListener('online',()=>syncQueue(false));
 window.addEventListener('pagehide',()=>{if(record&&record.estado!=='FINALIZADO')persistActive()});
 $('housingCount').addEventListener('input',()=>{if(current)$('generate').disabled=!validCount()});
 filterAssignments();renderHistory();updateNetwork();recoverDraft();
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=1.0',{updateViaCache:'none'})
   .then(reg=>reg.update()).catch(e=>console.warn('CATastro: no se pudo actualizar Service Worker',e));
 if(navigator.onLine&&(allQueue().length||hasPendingSignatures()))setTimeout(()=>syncQueue(false),1200);
 setInterval(()=>{if(navigator.onLine&&(allQueue().length||hasPendingSignatures())&&!busy)syncQueue(false)},30000);
}
function nameKey(value){return String(value||'').trim().toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'');}
const CLASS_OPTIONS=['Cabecera','Centro Poblado','Rural disperso'];
const NAME_CANON=new Map();
CATASTRO_ASSIGNMENTS.flatMap(a=>[a.departamento,a.municipio]).forEach(v=>{
 const k=nameKey(v),old=NAME_CANON.get(k)||'';
 const accents=x=>(String(x).match(/\p{Diacritic}/gu)||[]).length;
 if(!old||accents(v)>accents(old))NAME_CANON.set(k,v);
});
function canonName(value){
 const raw=String(value||'').trim(),chosen=NAME_CANON.get(nameKey(raw))||raw;
 return chosen.toLocaleLowerCase('es').replace(/(^|\s)\p{L}/gu,m=>m.toLocaleUpperCase('es'));
}
function optionBox(id){return $(id+'Options')}
function showAutocomplete(id,values,onChoose){
 const input=$(id),box=optionBox(id);if(!input||!box)return;
 const q=nameKey(input.value);
 const filtered=[...new Set(values)].filter(v=>!q||nameKey(v).includes(q)).sort((a,b)=>a.localeCompare(b,'es'));
 box.innerHTML=filtered.length?filtered.map((v,i)=>`<button type="button" class="autocomplete-option" role="option" data-option-index="${i}">${esc(v)}</button>`).join(''):'<div class="autocomplete-empty">Sin coincidencias</div>';
 box.classList.remove('hidden');
 box.querySelectorAll('[data-option-index]').forEach((b,i)=>b.addEventListener('click',()=>{
  input.value=filtered[i];input.dataset.selected=filtered[i];box.classList.add('hidden');onChoose(filtered[i]);
 }));
}
function refreshFilterAvailability(){
 const hasClass=!!$('classFilter').dataset.selected,hasDepartment=!!$('department').dataset.selected,hasMunicipality=!!$('municipality').dataset.selected;
 $('department').disabled=!hasClass; $('municipality').disabled=!(hasClass&&hasDepartment); $('assignment').disabled=!(hasClass&&hasDepartment&&hasMunicipality);
 if(!hasClass){$('department').placeholder='Seleccione primero la clase…';}else{$('department').placeholder='Seleccione departamento…';}
 if(!(hasClass&&hasDepartment)){$('municipality').placeholder='Seleccione primero el departamento…';}else{$('municipality').placeholder='Seleccione municipio…';}
 if(!(hasClass&&hasDepartment&&hasMunicipality)){$('assignment').placeholder='Seleccione primero clase, departamento y municipio…';}else{$('assignment').placeholder='Busque por código MGN, vereda o segmento…';}
}
function setupAutocomplete(){
 const specs=[
  ['classFilter',()=>CLASS_OPTIONS,v=>{ $('department').value='';$('department').dataset.selected='';$('municipality').value='';$('municipality').dataset.selected='';$('assignment').value='';$('assignment').dataset.selected='';$('assignment').dataset.key='';current=null;refreshFilterAvailability();filterAssignments();}],
  ['department',()=>availableDepartments(),v=>{ $('municipality').value='';$('municipality').dataset.selected='';$('assignment').value='';$('assignment').dataset.selected='';$('assignment').dataset.key='';current=null;refreshFilterAvailability();filterAssignments();}],
  ['municipality',()=>availableMunicipalities(),v=>{ $('assignment').value='';$('assignment').dataset.selected='';$('assignment').dataset.key='';current=null;refreshFilterAvailability();filterAssignments();}],
  ['assignment',()=>availableAreas(),v=>{selectAssignmentByLabel(v);}]
 ];
 specs.forEach(([id,getValues,onChoose])=>{
  const input=$(id);input.autocomplete='off';
  input.addEventListener('focus',()=>{if(input.disabled)return;showAutocomplete(id,getValues(),onChoose)});
  input.addEventListener('input',()=>{input.dataset.selected='';if(id==='classFilter'){ $('department').value='';$('department').dataset.selected='';$('municipality').value='';$('municipality').dataset.selected='';$('assignment').value='';$('assignment').dataset.selected='';refreshFilterAvailability();}if(id==='department'){ $('municipality').value='';$('municipality').dataset.selected='';$('assignment').value='';$('assignment').dataset.selected='';refreshFilterAvailability();}if(id==='municipality'){$('assignment').value='';$('assignment').dataset.selected='';refreshFilterAvailability();}if(id==='assignment'){$('assignment').dataset.key='';current=null;$('generate').disabled=true;}showAutocomplete(id,getValues(),onChoose);});
  input.addEventListener('keydown',e=>{
   const box=optionBox(id),items=[...box.querySelectorAll('[data-option-index]')];
   if(e.key==='ArrowDown'&&items.length){e.preventDefault();items[0].focus();}
   if(e.key==='Escape')box.classList.add('hidden');
   if(e.key==='Enter'&&items.length){e.preventDefault();items[0].click();}
  });
 });
 document.addEventListener('click',e=>{
  ['classFilter','department','municipality','assignment'].forEach(id=>{if(!e.target.closest(`#${id}Options`)&&e.target!==$(id))optionBox(id)?.classList.add('hidden')});
 });
}
function availableDepartments(){
 const c=$('classFilter').dataset.selected||'';
 if(!c)return [];
 return CATASTRO_ASSIGNMENTS.filter(a=>a.clase===c).map(a=>canonName(a.departamento));
}
function availableMunicipalities(){
 const c=$('classFilter').dataset.selected||'',d=nameKey($('department').dataset.selected||'');
 if(!c||!d)return [];
 return CATASTRO_ASSIGNMENTS.filter(a=>a.clase===c&&nameKey(a.departamento)===d).map(a=>canonName(a.municipio));
}
function availableAreas(){
 const c=$('classFilter').dataset.selected||'',d=nameKey($('department').dataset.selected||''),m=nameKey($('municipality').dataset.selected||'');
 if(!c||!d||!m)return [];
 return CATASTRO_ASSIGNMENTS.filter(a=>a.clase===c&&nameKey(a.departamento)===d&&nameKey(a.municipio)===m).map(assignmentLabel);
}
function filterAssignments(){
 refreshFilterAvailability();
 const c=$('classFilter').dataset.selected||'',d=nameKey($('department').dataset.selected||''),m=nameKey($('municipality').dataset.selected||'');
 const areas=CATASTRO_ASSIGNMENTS.filter(a=>(!c||a.clase===c)&&(!d||nameKey(a.departamento)===d)&&(!m||nameKey(a.municipio)===m));
 $('assignmentCount').textContent=areas.length;
 $('generate').disabled=!current;
}
function selectAssignmentByLabel(label){
 const c=$('classFilter').dataset.selected||'',d=nameKey($('department').dataset.selected||''),m=nameKey($('municipality').dataset.selected||'');
 const a=CATASTRO_ASSIGNMENTS.find(x=>(!c||x.clase===c)&&(!d||nameKey(x.departamento)===d)&&(!m||nameKey(x.municipio)===m)&&assignmentLabel(x)===label);
 if(!a){current=null;$('generate').disabled=true;return;}
 current=a;$('assignment').dataset.key=idFor(a);selectAssignment();
}
function findAssignmentRecord(k){return allRecords().find(r=>r.idAsignacion===k&&String(r.estado_registro||'ACTIVO').toUpperCase()!=='ELIMINADO')||null}
function selectAssignment(){
 if(!current)return;
 const a=current,existing=findAssignmentRecord(idFor(a));
 const teamKey=`${nameKey(a.departamento)}|${nameKey(a.municipio)}`;
 const teams=(window.CATASTRO_TEAMS||{})[teamKey]||[];
 const supervisors=[...new Set(teams.map(t=>t.supervisor).filter(Boolean))];
 const selectedSupervisor=supervisors.includes(a.supervisor)?a.supervisor:(supervisors[0]||'');
 const selectedTeam=teams.find(t=>t.supervisor===selectedSupervisor);
 const enumerators=selectedTeam?.encuestadores||[];
 $('assignmentInfo').classList.remove('empty-state');
 $('assignmentInfo').innerHTML=`<strong>${esc(canonName(a.departamento))} · ${esc(canonName(a.municipio))}</strong><br>Clase: <strong>${esc(a.clase)}</strong> · Área: <strong>${esc(a.area)}</strong><br>${a.tipo==='RURAL_DISPERSO'?`Vereda ${esc(a.vereda||a.area)} · Segmento ${esc(a.segmento)} · ${a.personas.length} personas`:`MGN: ${esc(a.mgn)} · ID_UPM: ${esc(a.idUpm)}`}<div class="staff-selectors"><label>Supervisor<select id="staffSupervisor" ${existing?'disabled':''}>${supervisors.map(x=>`<option value="${esc(x)}" ${x===selectedSupervisor?'selected':''}>${esc(x)}</option>`).join('')||'<option value="">Sin supervisores registrados para el municipio</option>'}</select></label><label>Encuestador<select id="staffEnumerator" ${existing?'disabled':''}>${enumerators.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')||'<option value="">Sin encuestadores para este supervisor</option>'}</select></label></div><p>${existing?'Ya existe un recorrido para esta asignación. Ábralo desde el historial.':(supervisors.length?'Seleccione el equipo y continúe.':'No se encontró equipo en la hoja Equipo para este municipio.')}</p>${a.tipo==='RURAL_DISPERSO'&&!existing?'<button id="startAssignedRoute" class="btn btn-primary" '+(!supervisors.length?'disabled':'')+'>Iniciar barrido del segmento →</button>':''}`;
 $('countCard').classList.toggle('hidden',a.tipo==='RURAL_DISPERSO');
 $('housingCount').value='';
 $('generate').disabled=!!existing || (a.tipo!=='RURAL_DISPERSO'&&!validCount()) || !supervisors.length;
 $('generate').textContent='Generar recorrido →';
 const updateStaff=()=>{
  const supervisor=$('staffSupervisor')?.value||'';
  const team=teams.find(t=>t.supervisor===supervisor);
  const list=team?.encuestadores||[];
  const sel=$('staffEnumerator');
  if(sel){
   const previous=sel.value;
   sel.innerHTML=list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')||'<option value="">Sin encuestadores para este supervisor</option>';
   if(list.includes(previous))sel.value=previous;
  }
  current.supervisor=supervisor;
  current.encuestadores=[...(team?.encuestadores||[])];
  current.encuestador=$('staffEnumerator')?.value||'';
  current.encuestadoresSeleccionados=current.encuestador?[current.encuestador]:[];
  $('startAssignedRoute')?.toggleAttribute('disabled',!supervisor||!current.encuestador);
  if(a.tipo!=='RURAL_DISPERSO')$('generate').disabled=!!existing||!validCount()||!supervisor||!current.encuestador;
 };
 $('staffSupervisor')?.addEventListener('change',updateStaff);
 $('staffEnumerator')?.addEventListener('change',updateStaff);
 updateStaff();
 $('startAssignedRoute')?.addEventListener('click',()=>{updateStaff();if(!current.supervisor||!current.encuestador)return;generateSelection();});
 if(existing){
  const rid=existing.idRecorrido;
  modal('Recorrido ya existente','Esta área ya tiene un recorrido guardado. Puede abrirlo para continuar o consultarlo.','warning','<button id="existingDismiss" class="btn btn-secondary">Cerrar</button><button id="existingOpen" class="btn btn-primary">Abrir recorrido</button>');
  $('existingDismiss').onclick=closeModal;
  $('existingOpen').onclick=()=>{closeModal();openRecord(rid)};
 }
}

function validCount(){const n=Number($('housingCount').value);return Number.isInteger(n)&&n>0&&n<=10000}
function generateSelection(){if(!current)return modal('Asignación no válida','Seleccione un área asignada.','warning');if(findAssignmentRecord(idFor(current)))return modal('Asignación ya trabajada','Abra el recorrido existente desde el historial.','warning');let selected=[],universe=[],method='';if(current.tipo==='RURAL_DISPERSO'){selected=current.personas.map((p,i)=>({...clone(p),vivienda:p.idPersona,orden:i+1,resultado:'Pendiente',gpsEstado:'Pendiente',gpsLatitud:null,gpsLongitud:null,gpsAltitud:null,gpsPrecision:null,gpsFecha:null,idEncuesta:null}));universe=selected.map(x=>({vivienda:x.vivienda,aleatorio:null}));method='BARRIDO_PERSONAS_SEGMENTO';}else{if(!validCount())return modal('Dato no válido','Ingrese el total de viviendas del área.','warning');const n=Number($('housingCount').value);universe=Array.from({length:n},(_,i)=>({vivienda:String(i+1).padStart(2,'0'),aleatorio:null}));const uniqueUniverse=[...new Map(universe.map(x=>[String(x.vivienda),x])).values()];universe=uniqueUniverse.map(x=>({...x}));let pool=universe.map(x=>({...x}));if(n>SAMPLE_SIZE){for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}pool.forEach((u,i)=>u.aleatorio=i+1);}selected=pool.slice(0,Math.min(n,SAMPLE_SIZE));const seenViviendas=new Set();selected=selected.filter(x=>{const k=String(x.vivienda);if(seenViviendas.has(k))return false;seenViviendas.add(k);return true;}).map((x,i)=>({...x,orden:i+1,resultado:'Pendiente',gpsEstado:'Pendiente',gpsLatitud:null,gpsLongitud:null,gpsAltitud:null,gpsPrecision:null,gpsFecha:null,idEncuesta:null}));method=n<=SAMPLE_SIZE?'CENSO_DEL_UNIVERSO_ORDEN_NATURAL':'MUESTREO_ALEATORIO_SIMPLE_ASCENDENTE';}
const now=new Date().toISOString();selected.forEach(h=>{h.nim=current.tipo==='RURAL_DISPERSO'?h.idPersona:`${current.idUpm}-${String(h.vivienda).padStart(2,'0')}`;h.identificador=current.tipo==='RURAL_DISPERSO'?h.idPersona:`${current.mgn}-${h.vivienda}`;h.idEncuesta=surveyIdFor(current,h);});record={supervisorSeleccionado:current.supervisor||'',encuestadorSeleccionado:current.encuestador||'',idRecorrido:crypto.randomUUID?crypto.randomUUID():`CAT-${Date.now()}-${Math.random().toString(36).slice(2)}`,idAsignacion:idFor(current),...clone(current),conteo:universe.length,meta:selected.length,nim:selected[0]?.nim||'',metodo:method,fechaGeneracion:now,actualizado:now,estado:'EN_PROCESO',estado_registro:'ACTIVO',estado_sincronizacion:'PENDIENTE',_formularioAbierto:true,seleccion:selected,universoAuditoria:universe,adicionales:[]};if(!persistActive()){record=null;return;}$('workArea').classList.remove('hidden');$('generate').disabled=true;$('methodNote').textContent=current.tipo==='RURAL_DISPERSO'?'Se cargó el listado de personas del segmento. El consecutivo es único dentro de cada vereda y segmento.':'Recorrido generado con el universo reportado; selección congelada en el dispositivo.';renderRecord();toast('Recorrido generado y almacenado localmente.','success')}
function visibleSelection(){
 const all=record.seleccion||[];
 if(Number.isInteger(record.metaMunicipalCumplidaIndex))return all.slice(0,record.metaMunicipalCumplidaIndex+1);
 return all;
}
function counts(){
 const visible=visibleSelection();
 return {total:visible.length,done:visible.filter(x=>x.resultado!=='Pendiente').length,effective:visible.filter(x=>x.resultado==='Efectiva').length,gps:visible.filter(x=>x.gpsEstado==='CAPTURADO').length,pending:visible.filter(x=>x.resultado==='Pendiente').length};
}
function renderRecord(){
 if(!record)return;
 const locked=record.estado==='FINALIZADO';
 $('workArea').classList.remove('hidden');
 $('routeSubtitle').textContent=record.tipo==='RURAL_DISPERSO'?`${record.departamento} · ${record.municipio} · Vereda ${record.vereda} · Segmento ${record.segmento}`:`${record.departamento} · ${record.municipio} · MGN ${record.mgn} · ID_UPM ${record.idUpm}`;
 $('routeStatus').textContent=locked?'Finalizado · Solo lectura':'En proceso';
 $('readOnlyNotice').classList.toggle('hidden',!locked);
 const c=counts();
 $('metrics').innerHTML=[[record.tipo==='RURAL_DISPERSO'?'Personas del segmento':'Viviendas seleccionadas',c.total],['Con resultado',c.done],['Efectivas',c.effective],['GPS capturados',c.gps],['Pendientes',c.pending],['Sincronización',record.estado_sincronizacion==='ENVIADO'?'Confirmada':'Pendiente']].map((x,i)=>`<div class="metric ${i===4&&c.pending?'bad':''}"><strong>${x[1]}</strong><span>${x[0]}</span></div>`).join('');
 const visible=visibleSelection();
 const pct=Math.round(c.done/Math.max(c.total,1)*100);
 $('progressText').textContent=pct+'%';$('progressFill').style.width=pct+'%';
 const rows=visible.map(h=>{const i=record.seleccion.indexOf(h),missing=(record._validationPending||[]).includes(i),gpsMissing=(record._validationGps||[]).includes(i);return `<tr><td>${h.orden}</td><td>${record.tipo==='RURAL_DISPERSO'?`${esc(h.nombre||'Persona sin nombre')} <small>${esc(h.idPersona||'')}</small>`:`Vivienda ${esc(h.vivienda)}`}${h.adicional?' · ADICIONAL':''}${missing?'<div class="field-validation-error">Debe seleccionar un resultado de visita para continuar.</div>':''}${gpsMissing?'<div class="field-validation-error">Debe capturar la ubicación GPS para continuar.</div>':''}</td><td>${resultSelect(i,h,locked)}</td><td>${gpsCell(i,h,locked)}</td></tr>`}).join('');
 $('homesTable').innerHTML=rows;
 $('mobileHomes').innerHTML=visible.map(h=>{const i=record.seleccion.indexOf(h),missing=(record._validationPending||[]).includes(i),gpsMissing=(record._validationGps||[]).includes(i);return `<div class="mobile-card"><div class="mobile-card-head"><strong>${record.tipo==='RURAL_DISPERSO'?`${esc(h.nombre||'Persona sin nombre')} <small>${esc(h.idPersona||'')}</small>`:`Vivienda ${esc(h.vivienda)}`}${h.adicional?' · ADICIONAL':''}${missing?'<div class="field-validation-error">Debe seleccionar un resultado de visita para continuar.</div>':''}${gpsMissing?'<div class="field-validation-error">Debe capturar la ubicación GPS para continuar.</div>':''}</strong><span class="soft-tag">Orden ${h.orden}</span></div><label>Resultado de visita${resultSelect(i,h,locked)}</label><div class="gps-row">${gpsCell(i,h,locked)}</div></div>`}).join('');
 const signaturesPending=record.seleccion.filter(h=>h.resultado==='Efectiva'&&h.firmaDataUrl&&!h.firmaUrl).length;
 $('savePartial').disabled=locked;
 $('syncButton').disabled=locked;
 $('syncButton').textContent=locked?'Recorrido finalizado':'Finalizar y sincronizar';
 $('syncButton').title=locked?'El recorrido ya está confirmado. Las firmas pendientes se envían automáticamente.':'';
 const back=$('backToHistory');if(back)back.classList.toggle('hidden',!locked);
 $('assignmentCard')?.classList.toggle('hidden',locked);
 $('countCard')?.classList.toggle('hidden',locked);
 const note=$('readOnlyNotice');if(note&&locked)note.innerHTML='<strong>Modo de consulta</strong><span>Este recorrido está finalizado. La información no se puede modificar. Las firmas que falten se enviarán automáticamente cuando haya conexión, sin cambiar el estado del recorrido.</span>';
 const signMetric=$('signatureStatus');if(signMetric)signMetric.textContent=signaturesPending?`${signaturesPending} firma(s) en cola`:'Firmas actualizadas';
}
function resultSelect(i,h,locked){
 const signatureStatus=h.firmaUrl
  ? `<a class="soft-tag" href="${esc(h.firmaUrl)}" target="_blank" rel="noopener">Firma guardada</a>`
  : h.firmaDataUrl
    ? `<span class="soft-tag">Firma capturada · envío automático</span>`
    : `<span class="soft-tag">Sin firma registrada</span>`;
 const signatureAction=locked
  ? signatureStatus
  : h.firmaUrl
    ? `<a class="btn btn-small btn-outline" href="${esc(h.firmaUrl)}" target="_blank" rel="noopener">Ver firma</a>`
    : h.firmaDataUrl
      ? `<span class="soft-tag">Firma capturada</span>`
      : `<button class="btn btn-small btn-primary" data-sign="${i}">Firmar</button>`;
 return `<select data-result="${i}" ${locked?'disabled':''}>${RESULTS.map(v=>`<option ${h.resultado===v?'selected':''}>${v}</option>`).join('')}</select>${h.resultado==='Otro cuál'?`<label class="other-detail-label">¿Cuál? <input type="text" data-other-detail="${i}" value="${esc(h.detalleOtro||'')}" maxlength="500" placeholder="Describa el resultado..." ${locked?'disabled':''} required></label>`:''}${h.resultado==='Efectiva'?`<div class="id-actions"><code>${esc(h.idEncuesta||'ID pendiente')}</code><button class="btn btn-small btn-outline" data-copy-id="${i}" ${locked||h.idCopied?'disabled':''}>${h.idCopied?'ID copiado':'Copiar ID'}</button>${locked?'':`<button class="btn btn-small btn-primary" data-open-kobo>Abrir Kobo</button>`}${signatureAction}</div>`:''}`;
}

function openSignatureModal(index){
 const h=record&&record.seleccion[index];if(!h||h.resultado!=='Efectiva')return;
 const layer=$('modalLayer'),card=layer.querySelector('.modal-card');
 $('modalIcon').className='modal-icon';$('modalIcon').textContent='✍';
 $('modalTitle').textContent='Firma del informante';
 $('modalMessage').textContent='Solicite a la persona que firme dentro del recuadro. La firma quedará asociada a esta vivienda.';
 const actions=card.querySelector('.modal-actions');
 actions.innerHTML='<button id="signatureCancel" class="btn btn-secondary">Cancelar</button><button id="signatureClear" class="btn btn-outline">Limpiar</button><button id="signatureSave" class="btn btn-primary">Guardar firma</button>';
 const canvas=document.createElement('canvas');canvas.id='signatureCanvas';canvas.width=900;canvas.height=360;
 canvas.style.cssText='display:block;width:100%;height:180px;background:#fff;border:1px solid #b8cbd5;border-radius:12px;touch-action:none;cursor:crosshair;margin:12px 0 18px';
 $('modalMessage').insertAdjacentElement('afterend',canvas);
 let drawing=false,hasInk=false,last=null;const ctx=canvas.getContext('2d');ctx.strokeStyle='#123b5d';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}};
 canvas.onpointerdown=e=>{drawing=true;hasInk=true;last=point(e);canvas.setPointerCapture(e.pointerId)};
 canvas.onpointermove=e=>{if(!drawing)return;const q=point(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(q.x,q.y);ctx.stroke();last=q};
 const stop=()=>{drawing=false;last=null};canvas.onpointerup=stop;canvas.onpointercancel=stop;
 $('signatureCancel').onclick=()=>{canvas.remove();closeModal();renderRecord()};
 $('signatureClear').onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false};
 $('signatureSave').onclick=()=>{if(!hasInk)return modal('Firma vacía','Solicite la firma antes de guardar.','warning');try{const dataUrl=canvas.toDataURL('image/png');h.firmaDataUrl=dataUrl;h.firmaMime='image/png';h.firmaEstado='PENDIENTE';h.firmaCapturada=new Date().toISOString();if(record.estado==='FINALIZADO'){saveRecordLocal(record);}else if(!persistActive())return;canvas.remove();closeModal();renderRecord();toast('Firma guardada en este dispositivo. Se intentará enviar a Drive.','success');setTimeout(()=>syncQueue(true),150)}catch(err){toast('No se pudo guardar la firma: '+err.message,'error')}};
 layer.classList.remove('hidden');
}
function gpsCell(i,h,locked){return `<div class="gps-status ${h.gpsEstado==='CAPTURADO'?'ok':''}">${h.gpsEstado==='CAPTURADO'?`${Number(h.gpsLatitud).toFixed(6)}, ${Number(h.gpsLongitud).toFixed(6)}<br>±${Math.round(h.gpsPrecision)} m`:'GPS pendiente'}</div><button class="btn btn-small btn-outline gps-btn" data-gps="${i}" ${locked?'disabled':''}>${h.gpsEstado==='CAPTURADO'?'Actualizar GPS':'Capturar GPS'}</button>`}
document.addEventListener('input',e=>{if(e.target.matches('[data-other-detail]')&&record&&record.estado!=='FINALIZADO'){const i=Number(e.target.dataset.otherDetail);const h=record.seleccion[i];if(h){h.detalleOtro=e.target.value;persistActive();}}});
document.addEventListener('change',e=>{if(e.target.matches('[data-result]')){
 if(!record||record.estado==='FINALIZADO')return;
 const h=record.seleccion[Number(e.target.dataset.result)];h.resultado=e.target.value;
 const rowIndex=Number(e.target.dataset.result);
 record._validationPending=(record._validationPending||[]).filter(i=>i!==rowIndex);
 if(h.resultado==='No necesaria: meta municipal cumplida'){
  record.metaMunicipalCumplidaIndex=rowIndex;
  record.metaMunicipalCumplida=h.idPersona||h.vivienda||String(rowIndex);
 } else if(record.metaMunicipalCumplidaIndex===rowIndex){
  delete record.metaMunicipalCumplidaIndex;
  delete record.metaMunicipalCumplida;
 }
 if(!persistActive())return;renderRecord();
}});
document.addEventListener('click',e=>{
 const cp=e.target.closest('[data-copy-id]');
 if(cp&&record){const h=record.seleccion[Number(cp.dataset.copyId)];if(h&&h.idEncuesta){copySurveyId(h.idEncuesta).then(ok=>{if(ok){h.idCopied=true;persistActive();renderRecord();}});}}
 const sign=e.target.closest('[data-sign]');if(sign&&record)openSignatureModal(Number(sign.dataset.sign));
 const kobo=e.target.closest('[data-open-kobo]');
 if(kobo&&record&&record.estado!=='FINALIZADO')window.open(KOBO_URL,'_blank','noopener');
 const b=e.target.closest('[data-gps]');if(b&&record&&record.estado!=='FINALIZADO')captureGPS(Number(b.dataset.gps));
 const op=e.target.closest('[data-open]');if(op)openRecord(op.dataset.open);
 const del=e.target.closest('[data-delete]');if(del)logicalDelete(del.dataset.delete);
});
async function copySurveyId(value){
 try{await navigator.clipboard.writeText(String(value));toast('ID de encuesta copiado.','success');return true;}
 catch(_){const t=document.createElement('textarea');t.value=String(value);document.body.appendChild(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'ID de encuesta copiado.':'No fue posible copiar el ID.','error');return ok;}
}
function captureGPS(i){if(!navigator.geolocation)return toast('Este dispositivo no permite capturar GPS.','error');toast('Obteniendo ubicación…','info');navigator.geolocation.getCurrentPosition(pos=>{const c=pos.coords,h=record.seleccion[i];if(c.accuracy>100)return modal('Precisión insuficiente',`La precisión obtenida es ±${Math.round(c.accuracy)} m. Se requiere máximo 100 m.`,'warning');h.gpsLatitud=c.latitude;h.gpsLongitud=c.longitude;h.gpsAltitud=c.altitude;h.gpsPrecision=c.accuracy;h.gpsFecha=new Date().toISOString();h.gpsEstado='CAPTURADO';record._validationGps=(record._validationGps||[]).filter(x=>x!==i);if(!persistActive())return;renderRecord();toast('GPS guardado en el dispositivo.','success')},err=>modal('No fue posible capturar GPS',err.message,'error'),{enableHighAccuracy:true,timeout:45000,maximumAge:0})}
function additionalQuestionApplies(){
 if(!record||record.tipo!=='RURAL_DISPERSO'||record.adicionalesConsultados)return false;
 const originals=record.seleccion.filter(x=>!x.adicional);
 if(!originals.length)return false;
 const lastIndex=record.seleccion.indexOf(originals[originals.length-1]);
 const allCompleted=originals.every(x=>x.resultado&&x.resultado!=='Pendiente');
 const last=originals[originals.length-1];
 const cutoff=Number.isInteger(record.metaMunicipalCumplidaIndex)?record.metaMunicipalCumplidaIndex:-1;
 return allCompleted && (cutoff<0 || cutoff>=lastIndex) && last.resultado!=='No necesaria: meta municipal cumplida';
}
function askAdditionalCount(){
 modal('Viviendas adicionales','¿Cuántas viviendas adicionales encontró en este segmento?','info','<button id="additionalCountCancel" class="btn btn-secondary">Cancelar</button><button id="additionalCountNext" class="btn btn-primary">Continuar</button>');
 $('modalMessage').innerHTML='Indique la cantidad de viviendas adicionales que encontró.<label class="modal-input-label" for="additionalCountInput">Cantidad</label><input id="additionalCountInput" type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="Ej. 2">';
 $('additionalCountCancel').onclick=closeModal;
 $('additionalCountNext').onclick=()=>{
  const n=Number($('additionalCountInput').value);
  if(!Number.isInteger(n)||n<1||n>100){$('additionalCountInput').focus();toast('Ingrese un número entero entre 1 y 100.','error');return;}
  askAdditionalNames(n);
 };
}
function askAdditionalNames(n){
 const fields=Array.from({length:n},(_,i)=>`<label class="modal-input-label">Vivienda adicional ${i+1}<input class="additional-name" data-additional-name="${i}" type="text" maxlength="180" placeholder="Nombre del propietario o responsable"></label>`).join('');
 modal('Identificación de viviendas','Registre el propietario o responsable de cada vivienda adicional.','info','<button id="additionalNamesCancel" class="btn btn-secondary">Cancelar</button><button id="additionalNamesSave" class="btn btn-primary">Agregar viviendas</button>');
 $('modalMessage').innerHTML=`<div class="additional-names-list">${fields}</div>`;
 $('additionalNamesCancel').onclick=closeModal;
 $('additionalNamesSave').onclick=()=>{
  const names=[...document.querySelectorAll('[data-additional-name]')].map(x=>x.value.trim());
  if(names.some(x=>!x)){toast('Complete el nombre o responsable de todas las viviendas.','error');return;}
  closeModal();addAdditionalDwellings(names);
 };
}
function addAdditionalDwellings(names){
 if(!record)return;
 const nuevos=[];
 names.forEach((nombre,i)=>{
  const seq=String((record.adicionales||[]).length+i+1).padStart(3,'0');
  const idPersona=`${record.idVereda}-${String(record.segmento).padStart(2,'0')}-AD${seq}`;
  nuevos.push({idPersona,consecutivo:`AD${seq}`,nombre,vivienda:idPersona,orden:record.seleccion.length+nuevos.length+1,adicional:true,resultado:'Pendiente',gpsEstado:'Pendiente',gpsLatitud:null,gpsLongitud:null,gpsAltitud:null,gpsPrecision:null,gpsFecha:null,nim:idPersona,identificador:idPersona,idEncuesta:`${idPersona}-${randomPart()}`});
 });
 record.adicionalesConsultados=true;record.seleccion.push(...nuevos);record.adicionales=(record.adicionales||[]).concat(nuevos);record.meta=record.seleccion.length;
 if(!persistActive())return;
 renderRecord();
 modal('Viviendas adicionales agregadas',`Se incorporaron ${names.length} viviendas al recorrido. Se mantienen identificadas por separado del listado original de personas.`,'success');
}
function finalizeRouteNow(){
 if(!record||record.estado==='FINALIZADO')return;
 record.estado='FINALIZADO';record._formularioAbierto=false;record.actualizado=new Date().toISOString();
 if(!persistActive())return;
 localStorage.removeItem(ACTIVE);
 const finished=record;record=null;resetAssignmentForm();queueRecord(finished);renderHistory();
 if(!navigator.onLine){toast('Recorrido finalizado y guardado localmente. Sin conexión: queda pendiente de envío.','warning');return;}
 syncQueue(true);
}
function finalizeAndSync(){
 if(!record||record.estado==='FINALIZADO')return;
 const visible=visibleSelection();
 record._validationPending=visible.map(h=>record.seleccion.indexOf(h)).filter(i=>!record.seleccion[i].resultado||record.seleccion[i].resultado==='Pendiente');
 const missingOther=visible.map(h=>record.seleccion.indexOf(h)).filter(i=>record.seleccion[i].resultado==='Otro cuál'&&!String(record.seleccion[i].detalleOtro||'').trim());
 if(missingOther.length){persistActive();renderRecord();const target=document.querySelector(`[data-other-detail="${missingOther[0]}"]`);if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.focus();}return;}
 if(record._validationPending.length){
  record._validationGps=[];
  persistActive();renderRecord();
  const first=record._validationPending[0];
  const target=document.querySelector(`[data-result="${first}"]`);
  if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});}
  return;
 }
 record._validationPending=[];
 // En rural, preguntar por viviendas adicionales al terminar el listado original,
 // antes de validar GPS; de lo contrario el GPS pendiente impedía que apareciera la pregunta.
 if(additionalQuestionApplies()){
  modal('Viviendas adicionales','¿Encontró viviendas adicionales en este segmento?','info','<button id="additionalNo" class="btn btn-secondary">No</button><button id="additionalYes" class="btn btn-primary">Sí</button>');
  $('additionalNo').onclick=()=>{record.adicionalesConsultados=true;persistActive();closeModal();finalizeAndSync();};
  $('additionalYes').onclick=()=>{closeModal();askAdditionalCount();};
  return;
 }
 record._validationGps=visible.map(h=>record.seleccion.indexOf(h)).filter(i=>{const h=record.seleccion[i];return h.gpsEstado!=='CAPTURADO'||h.gpsLatitud==null||h.gpsLongitud==null;});
 if(record._validationGps.length){
  persistActive();renderRecord();
  const first=record._validationGps[0];
  const target=document.querySelector(`[data-gps="${first}"]`);
  if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});}
  return;
 }
 record._validationGps=[];
 finalizeRouteNow();
}
function resetAssignmentForm(){
 current=null;
 ['classFilter','department','municipality','assignment'].forEach(id=>{
  const el=$(id);if(!el)return;el.value='';delete el.dataset.selected;delete el.dataset.key;
  const box=$(id+'Options');if(box){box.innerHTML='';box.classList.add('hidden')}
 });
 $('housingCount').value='';
 $('assignmentInfo').classList.add('empty-state');
 $('assignmentInfo').textContent='Seleccione una asignación para consultar su información.';
 $('countCard').classList.remove('hidden');
 $('methodNote').innerHTML='<span class="note-symbol">i</span><span>La selección se generará una sola vez y quedará guardada para recuperar el recorrido.</span>';
 $('generate').disabled=true;
 $('generate').textContent='Generar recorrido →';
 $('workArea').classList.add('hidden');
 filterAssignments();
}
function savePartial(){if(!record)return;if(record.estado==='FINALIZADO')return;record.estado='EN_PROCESO';record._formularioAbierto=false;if(!persistActive())return;record._formularioAbierto=false;saveRecordLocal(record);queueRecord(record);localStorage.removeItem(ACTIVE);record=null;resetAssignmentForm();renderHistory();toast('Recorrido guardado en este dispositivo. Puede continuar desde el historial.','success')}

function openRecord(id){
 const r=allRecords().find(x=>x.idRecorrido===id);
 if(!r||r.estado_registro==='ELIMINADO')return modal('No disponible','Este recorrido está eliminado y se conserva únicamente como histórico.','warning');
 record=clone(r);if(record.estado!=='FINALIZADO')ensureSurveyIds(record);
 current=CATASTRO_ASSIGNMENTS.find(a=>idFor(a)===r.idAsignacion)||r;
 // Restaurar también la jerarquía del módulo 1 al abrir desde el historial.
 const cls=r.clase||current.clase||'';
 const dep=r.departamento||current.departamento||'';
 const mun=r.municipio||current.municipio||'';
 $('classFilter').value=cls;$('classFilter').dataset.selected=cls;
 $('department').value=dep;$('department').dataset.selected=dep;
 $('municipality').value=mun;$('municipality').dataset.selected=mun;
 $('assignment').value=current.idAsignacion?assignmentLabel(current):`${r.area||r.mgn||r.vereda||''} · ${mun} · ${cls}`;
 $('assignment').dataset.selected=$('assignment').value;$('assignment').dataset.key=r.idAsignacion||'';
 refreshFilterAvailability();
 $('housingCount').value=r.conteo??'';
 $('assignmentInfo').classList.remove('empty-state');
 const teamKey=`${nameKey(dep)}|${nameKey(mun)}`;
 const teams=(window.CATASTRO_TEAMS||{})[teamKey]||[];
 const supervisors=[...new Set(teams.map(t=>t.supervisor).filter(Boolean))];
 const supervisor=r.supervisor||current.supervisor||'';
 const team=teams.find(t=>t.supervisor===supervisor);
 const enumerators=team?.encuestadores||current.encuestadores||[];
 const enumerator=r.encuestador||current.encuestador||'';
 $('assignmentInfo').innerHTML=`<strong>${esc(dep)} · ${esc(mun)}</strong><br>Clase: <strong>${esc(cls)}</strong> · Área: <strong>${esc(current.area||r.area||r.vereda||'')}</strong><br>${r.tipo==='RURAL_DISPERSO'?`Vereda: ${esc(r.vereda)} · Segmento: ${esc(r.segmento)} · ${r.conteo} personas`:`MGN: ${esc(r.mgn)} · ID_UPM: ${esc(r.idUpm)}`}<div class="staff-selectors"><label>Supervisor<select id="staffSupervisor" disabled>${(supervisors.length?supervisors:[supervisor]).filter(Boolean).map(x=>`<option value="${esc(x)}" ${x===supervisor?'selected':''}>${esc(x)}</option>`).join('')||'<option value="">Sin supervisor registrado</option>'}</select></label><label>Encuestador<select id="staffEnumerator" disabled>${(enumerators.length?enumerators:[enumerator]).filter(Boolean).map(x=>`<option value="${esc(x)}" ${x===enumerator?'selected':''}>${esc(x)}</option>`).join('')||'<option value="">Sin encuestador registrado</option>'}</select></label></div><p>Recorrido ${r.estado==='FINALIZADO'?'finalizado (solo lectura)':'recuperado'}.</p>`;
 $('methodNote').textContent='Se conserva la selección original; no se puede generar un nuevo sorteo.';
 $('generate').disabled=true;$('generate').textContent='Recorrido recuperado';
 if(r.estado==='FINALIZADO'){localStorage.removeItem(ACTIVE);}else{localStorage.setItem(ACTIVE,id);}
 renderRecord();$('workArea').scrollIntoView({behavior:'smooth',block:'start'});
}
function recoverDraft(){const id=localStorage.getItem(ACTIVE);if(!id)return;const r=allRecords().find(x=>x.idRecorrido===id);if(!r){localStorage.removeItem(ACTIVE);return}modal('Recorrido sin cerrar',`Hay un recorrido ${r.tipo==='RURAL_DISPERSO'?`para la vereda ${r.vereda}, segmento ${r.segmento}`:`para MGN ${r.mgn}`} guardado en este dispositivo. ¿Desea recuperarlo y continuar?`,'warning','<button id="recoverNo" class="btn btn-secondary">Dejar para después</button><button id="recoverYes" class="btn btn-primary">Recuperar recorrido</button>');$('recoverYes').onclick=()=>{closeModal();openRecord(id)};$('recoverNo').onclick=()=>{closeModal();toast('El recorrido permanece guardado en el historial.','info')}}
function renderHistory(filter=''){
 const rows=allRecords().filter(r=>r.estado_registro!=='ELIMINADO').slice().sort((a,b)=>String(b.actualizado).localeCompare(String(a.actualizado))).filter(r=>[r.mgn,r.nim,r.area,r.vereda,r.segmento,r.municipio,r.idAsignacion].join(' ').toLowerCase().includes(filter.toLowerCase()));
 const history=$('history');
 history.innerHTML=`<div class="history-filter"><label>Buscar recorridos</label><input id="historyMgnSearch" placeholder="MGN, vereda, segmento, municipio o NIM…" value="${esc(filter)}"><small>${rows.length} recorrido(s)</small></div>${rows.length?`<div class="table-wrap"><table class="history-table"><thead><tr><th>Tipo / NIM</th><th>Área / segmento</th><th>Municipio</th><th>Universo</th><th>Seleccionadas</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.tipo==='RURAL_DISPERSO'?'RURAL':(r.tipo||'URBANA'))} · ${esc(r.nim||r.seleccion?.[0]?.nim||'—')}</td><td>${esc(r.tipo==='RURAL_DISPERSO'?`${r.vereda} / ${r.segmento}`:r.mgn)}</td><td>${esc(r.municipio)}</td><td>${r.conteo}</td><td>${r.seleccion.length}</td><td><span class="history-state ${r.estado==='FINALIZADO'?'finished':''}">${r.estado==='FINALIZADO'?'Finalizado':'En proceso'} · ${r.estado_sincronizacion==='ENVIADO'?'Confirmado':'Pendiente de envío'}</span></td><td><button class="btn btn-small btn-history" data-open="${esc(r.idRecorrido)}">${r.estado==='FINALIZADO'?'Consultar':'Abrir recorrido'}</button> <button class="btn btn-small btn-outline" data-delete="${esc(r.idRecorrido)}">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="history-empty">No hay recorridos guardados.</p>'}`;
 const input=$('historyMgnSearch');
 input.oninput=e=>{
  const val=e.target.value,rowsNow=allRecords().filter(r=>r.estado_registro!=='ELIMINADO').filter(r=>[r.mgn,r.nim,r.area,r.vereda,r.segmento,r.municipio,r.idAsignacion].join(' ').toLowerCase().includes(val.toLowerCase()));
  const body=history.querySelector('tbody');
  if(body)body.innerHTML=rowsNow.map(r=>`<tr><td>${esc(r.tipo==='RURAL_DISPERSO'?'RURAL':(r.tipo||'URBANA'))} · ${esc(r.nim||r.seleccion?.[0]?.nim||'—')}</td><td>${esc(r.tipo==='RURAL_DISPERSO'?`${r.vereda} / ${r.segmento}`:r.mgn)}</td><td>${esc(r.municipio)}</td><td>${r.conteo}</td><td>${r.seleccion.length}</td><td>${r.estado}</td><td><button class="btn btn-small btn-history" data-open="${esc(r.idRecorrido)}">Abrir</button> <button class="btn btn-small btn-outline" data-delete="${esc(r.idRecorrido)}">Eliminar</button></td></tr>`).join('');
  const small=history.querySelector('.history-filter small');if(small)small.textContent=rowsNow.length+' recorrido(s)';
 };
 
}
function logicalDelete(id){
 const r=allRecords().find(x=>x.idRecorrido===id);if(!r)return;
 modal('Eliminar recorrido','El recorrido no se borrará físicamente. Quedará marcado como eliminado en el historial central. ¿Desea continuar?','warning',`<button id="cancelDelete" class="btn btn-secondary">Cancelar</button><button id="confirmDelete" class="btn btn-primary">Sí, eliminar</button>`);
 $('cancelDelete').onclick=closeModal;
 $('confirmDelete').onclick=()=>{
  closeModal();
  const stamp=new Date().toISOString();
  // Si existen duplicados locales de la misma asignación, se liberan todos,
  // conservando cada recorrido como registro histórico lógico.
  const related=allRecords().filter(x=>x.idAsignacion===r.idAsignacion);
  const targets=related.length?related:[r];
  try{
   targets.forEach(x=>{x.estado_registro='ELIMINADO';x.fechaEliminacion=x.fechaEliminacion||stamp;x.actualizado=stamp;saveRecordLocal(x);queueRecord(x);});
   toast('Recorrido eliminado lógicamente. La asignación queda disponible nuevamente.','success');
   renderHistory();filterAssignments();
  }catch(e){toast(e.message,'error');}
 };
}
function updateNetwork(){const el=$('network'),n=allQueue().length;if(navigator.onLine){el.classList.remove('offline');el.innerHTML=`<i></i> Internet disponible · datos locales${n?` · ${n} pendiente(s)`:''}`}else{el.classList.add('offline');el.innerHTML=`<i></i> Sin internet · ${n} en cola`}}
function jsonpCheck(requestId,timeout=6000){return new Promise((resolve,reject)=>{const cb='catCb_'+requestId.replace(/[^a-zA-Z0-9_]/g,'');const script=document.createElement('script');let done=false;const timer=setTimeout(()=>finish(new Error('No llegó confirmación del servidor.')),timeout);function finish(err,data){if(done)return;done=true;clearTimeout(timer);delete window[cb];script.remove();err?reject(err):resolve(data)}window[cb]=data=>finish(null,data);script.onerror=()=>finish(new Error('No fue posible consultar la confirmación del servidor.'));script.src=`${ENDPOINT}?action=check&requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(TOKEN)}&callback=${cb}&_=${Date.now()}`;document.head.appendChild(script)})}
const waitMs=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForSyncConfirmation(requestId){
 const delays=[250,400,600,900,1200,1500,1800,1800];let lastError=null;
 for(const delay of delays){
  if(!navigator.onLine)throw new Error('Se perdió la conexión. El recorrido permanece guardado en el dispositivo y se enviará al recuperar internet.');
  try{const result=await jsonpCheck(requestId);if(result&&result.ok)return result;if(result&&!result.pending)throw new Error(result.error||'El servidor rechazó la sincronización.')}catch(e){lastError=e}
  await waitMs(delay);
 }
 throw lastError||new Error('El servidor aún no confirma la escritura. El recorrido sigue en la cola local.');
}

function hasPendingSignatures(){
 return allRecords().some(r=>(r.seleccion||[]).some(h=>!!h.firmaDataUrl&&!h.firmaUrl));
}
async function uploadPendingSignatures(){
 if(!navigator.onLine)return {ok:false,error:'No hay conexión. La firma permanece guardada en este dispositivo.'};
 const records=allRecords();let uploaded=0;
 for(const r of records){
  for(const h of (r.seleccion||[])){
   if(!h.firmaDataUrl||h.firmaUrl||!r.idRecorrido)continue;
   const itemId=String(h.idPersona||h.vivienda||'');if(!itemId)continue;
   const recordId=String(r.idRecorrido)+'::'+itemId;
   const requestId='SIG_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);
   const base64=h.firmaDataUrl.split(',')[1]||'';if(!base64)continue;
   const payload={token:TOKEN,action:'uploadSignature',requestId,recordId,identificador:String(h.identificador||''),fileName:'firma_'+recordId.replace(/[^A-Za-z0-9_-]/g,'_')+'.png',mimeType:'image/png',base64};
   try{
    await fetch(ENDPOINT,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const result=await waitForSyncConfirmation(requestId);
    if(!result||!result.ok||!result.url)throw new Error(result&&result.error||'El servidor no confirmó el archivo ni devolvió su enlace.');
    h.firmaUrl=result.url;h.firmaFileId=result.fileId||'';h.firmaEstado='ENVIADA';delete h.firmaDataUrl;
    const all=allRecords(),pos=all.findIndex(x=>x.idRecorrido===r.idRecorrido);if(pos>=0){all[pos]=r;write(STORE,all);}
    const queued=allQueue(),qpos=queued.findIndex(x=>x.idRecorrido===r.idRecorrido);if(qpos>=0){const qh=(queued[qpos].seleccion||[]).find(x=>String(x.idPersona||x.vivienda||'')===itemId);if(qh){qh.firmaUrl=h.firmaUrl;qh.firmaFileId=h.firmaFileId;qh.firmaEstado='ENVIADA';delete qh.firmaDataUrl;write(QUEUE,queued);}}
    if(record&&record.idRecorrido===r.idRecorrido){const rh=(record.seleccion||[]).find(x=>String(x.idPersona||x.vivienda||'')===itemId);if(rh){rh.firmaUrl=h.firmaUrl;rh.firmaFileId=h.firmaFileId;rh.firmaEstado='ENVIADA';delete rh.firmaDataUrl;}}
    uploaded++;
    renderHistory();if(record&&record.idRecorrido===r.idRecorrido)renderRecord();
   }catch(err){
    console.error('Error al subir firma',recordId,err);
    h.firmaEstado='PENDIENTE';
    const all=allRecords(),pos=all.findIndex(x=>x.idRecorrido===r.idRecorrido);if(pos>=0){all[pos]=r;write(STORE,all);}
    if(record&&record.idRecorrido===r.idRecorrido){const rh=(record.seleccion||[]).find(x=>String(x.idPersona||x.vivienda||'')===itemId);if(rh){rh.firmaEstado='PENDIENTE';rh.firmaDataUrl=h.firmaDataUrl;}}
    return {ok:false,error:`La firma de ${itemId} no se pudo guardar en Drive. ${err.message}`,uploaded};
   }
  }
 }
 return {ok:true,uploaded};
}
async function syncQueue(manual=false){
 if(busy){if(manual)syncRequested=true;return false}
 if(!navigator.onLine)return false;let q=allQueue();if(!q.length){const sig=await uploadPendingSignatures();updateNetwork();if(record)renderRecord();renderHistory();if(manual){if(sig.ok)modal('Recorrido confirmado',sig.uploaded?`La información ya está en el servidor y se guardaron ${sig.uploaded} firma(s) en Drive.`:'No hay recorridos ni firmas pendientes.','success');else modal('Recorrido confirmado',`La información del recorrido ya está en el servidor. La firma continúa guardada en este dispositivo y se reintentará automáticamente. ${sig.error}`,'warning')}return true}
 busy=true;updateNetwork();
 try{
  while(q.length){
   const batch=q.slice(0,10),requestId=`CAT_${Date.now()}_${Math.random().toString(36).slice(2,9)}`,snapshots=batch.map(x=>JSON.stringify(x));
   await fetch(ENDPOINT,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token:TOKEN,requestId,registros:batch.map(r=>{const x=clone(r);(x.seleccion||[]).forEach(h=>{delete h.firmaDataUrl;});return x;})})});
   const result=await waitForSyncConfirmation(requestId);if(!result?.ok)throw new Error(result?.error||'Sin confirmación de escritura');
   const currentQ=allQueue(),sent=new Set(snapshots);write(QUEUE,currentQ.filter(x=>!sent.has(JSON.stringify(x))));
   const all=allRecords(),pendingIds=new Set(allQueue().map(x=>x.idRecorrido));
   batch.forEach(sentRec=>{const x=all.find(r=>r.idRecorrido===sentRec.idRecorrido);if(x){x.estado_sincronizacion=pendingIds.has(x.idRecorrido)?'PENDIENTE':'ENVIADO';if(!pendingIds.has(x.idRecorrido))x.fechaEnvio=new Date().toISOString()}});
   write(STORE,all);q=allQueue();
  }
  const sig=await uploadPendingSignatures();renderHistory();updateNetwork();if(record)renderRecord();if(manual){if(sig.ok)modal('Recorrido confirmado',`La información quedó guardada en SABANA_RECOLECCION${sig.uploaded?` y se almacenaron ${sig.uploaded} firma(s) en Drive`:'.'}`,'success');else modal('Recorrido confirmado',`La información quedó guardada en SABANA_RECOLECCION. La firma permanece conservada en el dispositivo y se reintentará automáticamente. ${sig.error}`,'warning')}return true;
 }catch(e){console.error('CAT V2 sync:',e);updateNetwork();if(manual)modal('Sincronización pendiente',`${e.message} Los registros siguen conservados en el dispositivo y en la cola para reintentar cuando haya conexión.`,'warning');return false}
 finally{
  busy=false;renderHistory();updateNetwork();
  // Si el usuario pulsó Finalizar mientras corría un envío de fondo,
  // el siguiente ciclo conserva el carácter manual y muestra su resultado.
  if(syncRequested){
   syncRequested=false;
   if(navigator.onLine&&(allQueue().length||hasPendingSignatures()))setTimeout(()=>syncQueue(false),0);
  }
 }
}
window.addEventListener('load',init);
