// GeoEscuelas Honduras v2 - App logic
// Usa Supabase como backend. Offline-first con localStorage queue.

(function(){
'use strict';

// ===== CONFIG =====
var CFG = window.__GEO_CFG__ || {};
var SUPABASE_URL = CFG.url || '';
var SUPABASE_ANON_KEY = CFG.key || '';
var sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

var DB='geoescuelas_v2_reg', CK='geoescuelas_v2_cfg', SCHOOL_CACHE='geoescuelas_v2_schoolmap';
var centros=[], schoolIdByCode={}, selCentro=null;
var gps=null, pin=null, mode='gps';
var mapGps=null, markerGps=null, mapPin=null, markerPin=null, watchId=null, installEvt=null;

var DEPT_CENTROIDS = {
  'ATLANTIDA':[15.76,-86.79],'COLON':[15.92,-85.95],'COMAYAGUA':[14.46,-87.64],
  'COPAN':[14.77,-88.78],'CORTES':[15.50,-88.03],'CHOLUTECA':[13.30,-87.20],
  'EL PARAISO':[13.94,-86.84],'FRANCISCO MORAZAN':[14.07,-87.19],
  'GRACIAS A DIOS':[15.26,-83.77],'INTIBUCA':[14.31,-88.17],
  'ISLAS DE LA BAHIA':[16.32,-86.54],'LA PAZ':[14.31,-87.68],
  'LEMPIRA':[14.58,-88.59],'OCOTEPEQUE':[14.43,-89.18],
  'OLANCHO':[14.67,-86.22],'SANTA BARBARA':[14.92,-88.23],
  'VALLE':[13.53,-87.49],'YORO':[15.13,-87.13]
};
var HONDURAS_CENTER=[14.75,-86.5];

function noAccent(s){return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim()}
function deptCenter(d){return DEPT_CENTROIDS[noAccent(d)]||HONDURAS_CENTER}
function inHonduras(lat,lon){return lat>=12&&lat<=17&&lon>=-89.5&&lon<=-83}
function distKm(a,b){var R=6371,dL=(b[0]-a[0])*Math.PI/180,dO=(b[1]-a[1])*Math.PI/180;
  var x=Math.sin(dL/2)*Math.sin(dL/2)+Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(dO/2)*Math.sin(dO/2);
  return 2*R*Math.asin(Math.sqrt(x))}
function $(id){return document.getElementById(id)}
function toast(m){var t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},3000)}

// Construye nodos DOM de forma segura (sin innerHTML con interpolacion)
function el(tag, attrs, children){
  var n=document.createElement(tag);
  if(attrs) for(var k in attrs){
    if(k==='class') n.className=attrs[k];
    else if(k==='text') n.textContent=attrs[k];
    else if(k==='onclick') n.onclick=attrs[k];
    else n.setAttribute(k,attrs[k]);
  }
  if(children) children.forEach(function(c){ if(c) n.appendChild(typeof c==='string'?document.createTextNode(c):c) });
  return n;
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', init);
window.startApp=startApp; window.installPWA=installPWA;
window.pickCentro=pickCentro; window.clearSelection=clearSelection;
window.setMode=setMode; window.setManualGPS=setManualGPS;
window.guardar=guardar; window.syncAll=syncAll; window.exportExcel=exportExcel;
window.borrarTodo=borrarTodo; window.goPage=goPage;

async function init(){
  if(!sb){
    var l=$('loader');
    l.textContent=''; l.appendChild(el('h2',{text:'Falta configurar Supabase',style:'color:#ff6'}));
    l.appendChild(el('p',{text:'Edite config.js con URL y anon key'}));
    return;
  }
  var cfg=getCfg();
  if(!cfg.name) $('welcome').style.display='flex';
  updConn();
  window.addEventListener('online',function(){updConn();toast('Conexion recuperada');syncAll()});
  window.addEventListener('offline',updConn);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function(){});
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();installEvt=e;$('installBar').style.display='block'});

  try{
    var r=await fetch('centros.json');
    centros=await r.json();
    schoolIdByCode = await loadSchoolIdMap();
  }catch(e){ console.error(e); toast('Error cargando catalogo') }

  initSearch();
  startGPS();
  $('loader').style.display='none';
  updHist();
}

async function loadSchoolIdMap(){
  var cached = localStorage.getItem(SCHOOL_CACHE);
  if(cached){ try{ return JSON.parse(cached) }catch(e){} }
  toast('Sincronizando catalogo (1 sola vez)...');
  var map={}; var from=0; var size=1000;
  while(true){
    var res = await sb.from('schools').select('id,sace_code').range(from, from+size-1);
    if(res.error){ console.error(res.error); break; }
    var data=res.data||[];
    if(!data.length) break;
    data.forEach(function(r){ map[r.sace_code]=r.id });
    if(data.length<size) break;
    from+=size;
  }
  localStorage.setItem(SCHOOL_CACHE,JSON.stringify(map));
  return map;
}

function startApp(){
  var name=$('welcomeName').value.trim(); if(!name)return;
  var cfg=getCfg(); cfg.name=name; saveCfg(cfg);
  $('welcome').style.display='none';
}
function installPWA(){ if(installEvt){installEvt.prompt();installEvt.userChoice.then(function(){$('installBar').style.display='none';installEvt=null}) } }

function updConn(){
  var c=$('conn');
  if(navigator.onLine){c.className='conn on';c.textContent='En linea'}
  else{c.className='conn off';c.textContent='Sin internet (los datos se guardan en el celular)'}
}

// ===== SEARCH =====
function initSearch(){
  var inp=$('searchInput'),res=$('searchResults'); var tm=null;
  inp.addEventListener('input',function(){
    clearTimeout(tm);
    tm=setTimeout(function(){
      var q=noAccent(inp.value.trim());
      if(q.length<2){res.classList.remove('show');return}
      var found=[]; var terms=q.split(/\s+/);
      for(var i=0;i<centros.length&&found.length<25;i++){
        var c=centros[i];
        var t=noAccent(c.c+' '+c.n+' '+c.m+' '+c.d+' '+c.a);
        if(terms.every(function(w){return t.indexOf(w)>=0}))found.push(c);
      }
      res.textContent='';
      if(!found.length){
        res.appendChild(el('div',{class:'sr-item',style:'color:var(--gray)',text:'No se encontro. Revise el nombre.'}));
      } else {
        found.forEach(function(c,i){
          var item=el('div',{class:'sr-item',onclick:function(){ pickCentro(i) }}, [
            el('div',{class:'sr-code',text:c.c}),
            el('div',{class:'sr-name',text:c.n}),
            el('div',{class:'sr-loc',text:c.m+', '+c.d+'  \u2022  '+c.z+'  \u2022  Matricula: '+c.mt.toLocaleString()})
          ]);
          res.appendChild(item);
        });
      }
      res.classList.add('show'); res._d=found;
    },200);
  });
  inp.addEventListener('focus',function(){if(inp.value.trim().length>=2)res.classList.add('show')});
  document.addEventListener('click',function(e){if(!e.target.closest('.search-box'))res.classList.remove('show')});
}

function pickCentro(i){
  var res=$('searchResults');
  selCentro=res._d[i];
  res.classList.remove('show');
  $('searchInput').style.display='none';
  $('selectedCard').style.display='block';
  $('selName').textContent=selCentro.n;
  var det=$('selDetail'); det.textContent='';
  det.appendChild(el('strong',{text:selCentro.c}));
  det.appendChild(document.createTextNode('  \u2022  '+selCentro.m+', '+selCentro.d));
  det.appendChild(el('br'));
  det.appendChild(document.createTextNode(selCentro.a+'  \u2022  '+selCentro.z+'  \u2022  '+selCentro.t));
  det.appendChild(el('br'));
  det.appendChild(document.createTextNode(selCentro.ad+'  \u2022  Matricula: '+selCentro.mt.toLocaleString()));
  $('step1').className='step done';
  $('step2').className='step active';
  $('step3').className='step active';
  if(mode==='pin') centerPinOnSchool();
  updBtn(); checkDistWarn();
}

function clearSelection(){
  selCentro=null;
  $('searchInput').style.display=''; $('searchInput').value='';
  $('selectedCard').style.display='none';
  $('step1').className='step active';
  $('step2').className='step';
  $('step3').className='step';
  $('warnOutMun').classList.remove('show');
  updBtn();
}

// ===== MODE =====
function setMode(m){
  mode=m;
  $('tabGps').classList.toggle('active',m==='gps');
  $('tabPin').classList.toggle('active',m==='pin');
  $('panelGps').classList.toggle('show',m==='gps');
  $('panelPin').classList.toggle('show',m==='pin');
  if(m==='pin'){ initPinMap(); centerPinOnSchool(); setTimeout(function(){mapPin&&mapPin.invalidateSize()},150) }
  else{ setTimeout(function(){mapGps&&mapGps.invalidateSize()},150) }
  updBtn(); checkDistWarn();
}

// ===== GPS =====
function startGPS(){
  if(!navigator.geolocation){setGPS('err','GPS no disponible','');return}
  setGPS('seek','Buscando senal GPS...','Asegurese de estar al aire libre');
  watchId=navigator.geolocation.watchPosition(
    function(p){
      gps={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy,alt:p.coords.altitude};
      var q=gps.acc<10?'Excelente':gps.acc<30?'Buena':'Baja';
      setGPS('ok','Ubicacion fijada ('+q+')','Precision: '+gps.acc.toFixed(0)+' metros');
      $('dLat').textContent=gps.lat.toFixed(6);
      $('dLon').textContent=gps.lon.toFixed(6);
      updMapGps(); updBtn(); checkDistWarn();
      if(selCentro&&mode==='gps')$('step2').className='step done';
    },
    function(e){
      var m={1:'Permiso denegado. Abra Ajustes y permita GPS.',2:'GPS no disponible',3:'Muy lento. Intente al aire libre.'};
      setGPS('err',m[e.code]||'Error GPS','Use el modo Pin satelital o escriba coords a mano');
    },
    {enableHighAccuracy:true,timeout:30000,maximumAge:5000}
  );
}
function setGPS(s,msg,detail){
  var icon=$('gpsIcon'), m=$('gpsMsg'), d=$('gpsDetail');
  m.textContent=msg; d.textContent=detail||'';
  if(s==='seek'){icon.textContent='\ud83d\udce1';icon.className='gps-icon gps-seeking'}
  else if(s==='ok'){icon.textContent='\u2705';icon.className='gps-icon'}
  else{icon.textContent='\u274c';icon.className='gps-icon'}
}
function setManualGPS(){
  var la=parseFloat($('mLat').value), lo=parseFloat($('mLon').value);
  if(isNaN(la)||isNaN(lo)||!inHonduras(la,lo)){toast('Coordenadas fuera de Honduras');return}
  gps={lat:la,lon:lo,acc:null,alt:null,manual:true};
  setGPS('ok','Coordenadas manuales','');
  $('dLat').textContent=la.toFixed(6); $('dLon').textContent=lo.toFixed(6);
  updMapGps(); updBtn(); checkDistWarn();
  if(selCentro)$('step2').className='step done';
}

// ===== MAPS =====
function ensureEsriLayer(map){
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
    maxZoom:19, attribution:'&copy; Esri'
  }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,opacity:.3}).addTo(map);
}
function updMapGps(){
  if(!gps||!window.L)return;
  if(!mapGps){
    mapGps=L.map('minimap',{zoomControl:false,attributionControl:false}).setView([gps.lat,gps.lon],17);
    ensureEsriLayer(mapGps);
    markerGps=L.marker([gps.lat,gps.lon]).addTo(mapGps);
    setTimeout(function(){mapGps.invalidateSize()},300);
  }else{
    markerGps.setLatLng([gps.lat,gps.lon]);mapGps.setView([gps.lat,gps.lon]);
  }
}
function initPinMap(){
  if(mapPin)return;
  mapPin=L.map('pinmap').setView(HONDURAS_CENTER,7);
  ensureEsriLayer(mapPin);
  markerPin=L.marker(HONDURAS_CENTER,{draggable:true}).addTo(mapPin);
  markerPin.on('dragend',function(){var p=markerPin.getLatLng();setPin(p.lat,p.lng)});
  mapPin.on('click',function(e){markerPin.setLatLng(e.latlng);setPin(e.latlng.lat,e.latlng.lng)});
}
function setPin(lat,lon){
  pin={lat:lat,lon:lon};
  $('pLat').textContent=lat.toFixed(6);
  $('pLon').textContent=lon.toFixed(6);
  if(selCentro&&mode==='pin')$('step2').className='step done';
  updBtn(); checkDistWarn();
}
function centerPinOnSchool(){
  if(!selCentro||!mapPin)return;
  var c=deptCenter(selCentro.d);
  mapPin.setView(c,12); markerPin.setLatLng(c);
  setPin(c[0],c[1]);
  toast('Mapa centrado en '+selCentro.d+'. Acerquese y toque la escuela.');
}

// ===== VALIDATION =====
function currentCoord(){
  if(mode==='gps'&&gps) return [gps.lat,gps.lon,gps.acc,gps.alt,gps.manual?'manual':'gps'];
  if(mode==='pin'&&pin) return [pin.lat,pin.lon,null,null,'pin'];
  return null;
}
function checkDistWarn(){
  var cc=currentCoord(); var w=$('warnOutMun');
  if(!cc||!selCentro){w.classList.remove('show');return}
  var lat=cc[0], lon=cc[1];
  if(!inHonduras(lat,lon)){w.textContent='Las coordenadas estan fuera de Honduras.';w.classList.add('show');return}
  var c=deptCenter(selCentro.d); var d=distKm(c,[lat,lon]);
  if(d>80){w.textContent='El punto esta ~'+d.toFixed(0)+' km del centro del departamento ('+selCentro.d+'). Revise antes de guardar.';w.classList.add('show')}
  else w.classList.remove('show');
}

// ===== SAVE =====
function updBtn(){
  var btn=$('btnSave'), hint=$('btnHint'); var cc=currentCoord();
  if(selCentro&&cc){
    btn.className='btn-save ready'; hint.textContent='Todo listo. Presione GUARDAR.';
  }else{
    btn.className='btn-save not-ready';
    if(!selCentro&&!cc)hint.textContent='Busque una escuela y marque la ubicacion';
    else if(!selCentro)hint.textContent='Busque y seleccione una escuela';
    else hint.textContent= mode==='gps' ? 'Esperando senal GPS...' : 'Toque sobre el mapa para marcar la escuela';
  }
}

function guardar(){
  if(!selCentro)return;
  var cc=currentCoord(); if(!cc)return;
  var lat=cc[0],lon=cc[1],acc=cc[2],alt=cc[3],method=cc[4];
  if(!inHonduras(lat,lon)){toast('Coordenadas fuera de Honduras');return}
  var cfg=getCfg();
  var schoolId = schoolIdByCode[selCentro.c] || null;
  if(!schoolId){ toast('Catalogo desincronizado. Recargue con internet.'); return; }
  var rec={
    client_id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    school_id:schoolId, sace_code:selCentro.c,
    lat:lat, lon:lon, accuracy_m:acc, altitude_m:alt, method:method,
    status:$('estado').value,
    observations:$('obs').value.trim()||null,
    surveyor_name:cfg.name||'',
    surveyor_device:(navigator.userAgent||'').slice(0,120),
    created_at:new Date().toISOString(),
    _centro:{n:selCentro.n,d:selCentro.d,m:selCentro.m,a:selCentro.a,z:selCentro.z,t:selCentro.t,ad:selCentro.ad,mt:selCentro.mt},
    _synced:false
  };
  var regs=getReg(); regs.push(rec); saveReg(regs);
  var ov=$('successOverlay'); $('successSub').textContent=selCentro.n;
  ov.classList.add('show'); setTimeout(function(){ov.classList.remove('show')},1800);
  clearSelection();
  $('estado').value='activo'; $('obs').value='';
  pin=null; $('pLat').textContent='--'; $('pLon').textContent='--';
  updHist();
  syncRecord(rec);
}

// ===== STORAGE =====
function getReg(){try{return JSON.parse(localStorage.getItem(DB)||'[]')}catch(e){return[]}}
function saveReg(r){localStorage.setItem(DB,JSON.stringify(r))}
function getCfg(){try{return JSON.parse(localStorage.getItem(CK)||'{}')}catch(e){return{}}}
function saveCfg(c){localStorage.setItem(CK,JSON.stringify(c))}

// ===== SYNC =====
async function syncRecord(rec){
  if(!sb||!navigator.onLine)return false;
  var payload={
    school_id:rec.school_id, sace_code:rec.sace_code,
    lat:rec.lat, lon:rec.lon,
    accuracy_m:rec.accuracy_m, altitude_m:rec.altitude_m,
    method:rec.method, status:rec.status, observations:rec.observations,
    surveyor_name:rec.surveyor_name, surveyor_device:rec.surveyor_device,
    client_id:rec.client_id, created_at:rec.created_at
  };
  var res = await sb.from('captures').insert(payload);
  if(!res.error){
    var regs=getReg(); var idx=regs.findIndex(function(x){return x.client_id===rec.client_id});
    if(idx>=0){regs[idx]._synced=true;saveReg(regs)} updHist(); return true;
  }
  if(res.error.code==='23505'){
    var regs2=getReg(); var idx2=regs2.findIndex(function(x){return x.client_id===rec.client_id});
    if(idx2>=0){regs2[idx2]._synced=true;saveReg(regs2)} updHist(); return true;
  }
  console.warn('sync err',res.error); return false;
}

async function syncAll(){
  if(!navigator.onLine){toast('Sin internet. Se enviaran al recuperar senal.');return}
  var pend=getReg().filter(function(r){return !r._synced});
  if(!pend.length){toast('Todo al dia. No hay pendientes.');return}
  toast('Enviando '+pend.length+' registro(s)...');
  var ok=0;
  for(var i=0;i<pend.length;i++){ if(await syncRecord(pend[i]))ok++ }
  toast(ok===pend.length? (ok+' enviados correctamente') : (ok+' de '+pend.length+' enviados'));
  updHist();
}

// ===== EXPORT =====
function exportExcel(){
  var regs=getReg();
  if(!regs.length){toast('No hay registros');return}
  var data=regs.map(function(r){
    var c=r._centro||{};
    return {
      Fecha:r.created_at,'Codigo SACE':r.sace_code,'Nombre':c.n,
      Departamento:c.d,Municipio:c.m,Aldea:c.a,Zona:c.z,Tipo:c.t,Administracion:c.ad,
      'Matricula 2024':c.mt,
      Latitud:r.lat,Longitud:r.lon,'Precision (m)':r.accuracy_m,Altitud:r.altitude_m,
      Metodo:r.method, Estado:r.status, Observaciones:r.observations,
      Encuestador:r.surveyor_name, Enviado:r._synced?'Si':'No'
    };
  });
  var ws=XLSX.utils.json_to_sheet(data);
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Datos');
  XLSX.writeFile(wb,'GeoEscuelas_'+new Date().toISOString().slice(0,10)+'.xlsx');
  toast('Excel descargado');
}

// ===== HISTORY =====
function updHist(){
  var regs=getReg(); var sy=regs.filter(function(r){return r._synced}).length; var pe=regs.length-sy;
  $('hTotal').textContent=regs.length;
  $('hSync').textContent=sy;
  $('hPend').textContent=pe;
  var list=$('histList'); list.textContent='';
  if(!regs.length){
    list.appendChild(el('div',{style:'padding:30px;text-align:center;color:var(--gray)',text:'Sin registros todavia'}));
    return;
  }
  regs.slice().reverse().forEach(function(r){
    var c=r._centro||{};
    var d=new Date(r.created_at);
    var ds=d.toLocaleDateString('es-HN',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'});
    var nameWrap=el('div',{class:'hi-name'},[
      document.createTextNode((c.n||r.sace_code)+' '),
      el('span',{class:'hi-badge '+(r._synced?'hi-badge-ok':'hi-badge-pend'),text:r._synced?'Enviado':'Pendiente'})
    ]);
    var info=el('div',{class:'hi-info',text:r.sace_code+'  \u2022  '+(c.m||'')+'  \u2022  '+r.method+'  \u2022  '+ds});
    list.appendChild(el('div',{class:'hist-item'},[nameWrap,info]));
  });
}

function borrarTodo(){
  var regs=getReg(); if(!regs.length)return;
  var pe=regs.filter(function(r){return !r._synced}).length;
  var msg=pe>0
    ? 'HAY '+pe+' REGISTROS SIN ENVIAR.\n\nSi los borra se pierden localmente (los enviados ya estan seguros en Supabase).\n\nBorrar '+regs.length+' registros?'
    : 'Borrar '+regs.length+' registros locales?';
  if(!confirm(msg))return;
  localStorage.removeItem(DB); updHist(); toast('Registros locales borrados');
}

// ===== NAV =====
function goPage(p){
  document.querySelectorAll('.page').forEach(function(x){x.classList.remove('show')});
  document.querySelectorAll('.bnav-btn').forEach(function(x){x.classList.remove('active')});
  $('page'+p).classList.add('show');
  $('nav'+p).classList.add('active');
  if(p==='Hist')updHist();
  if(p==='Reg'){ setTimeout(function(){mapGps&&mapGps.invalidateSize(); mapPin&&mapPin.invalidateSize()},100) }
}

})();
