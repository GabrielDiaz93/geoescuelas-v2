// GeoEscuelas Admin Dashboard
// Lee y modifica datos en Supabase usando la sesion del admin (auth.email() en tabla admins)

(function(){
'use strict';

var CFG = window.__GEO_CFG__ || {};
var sb = window.supabase.createClient(CFG.url, CFG.key, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage, storageKey: 'geoesc-admin-session' }
});

var schools = [];
var captures = [];
var capByCode = {};
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
var SUSPECT_KM = 80;
var HONDURAS_CENTER = [14.75,-86.5];

var map, cluster, selectedSchool=null;
var filters = { dept:'', muni:'', status:'all', surv:'', method:'all', search:'' };

function $(id){ return document.getElementById(id); }
function noAccent(s){ return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim(); }
function deptCenter(d){ return DEPT_CENTROIDS[noAccent(d)] || HONDURAS_CENTER; }
function distKm(a,b){
  var R=6371,dL=(b[0]-a[0])*Math.PI/180,dO=(b[1]-a[1])*Math.PI/180;
  var x=Math.sin(dL/2)*Math.sin(dL/2)+Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(dO/2)*Math.sin(dO/2);
  return 2*R*Math.asin(Math.sqrt(x));
}
function fmt(n){ return n==null?'-':n.toLocaleString('es-HN'); }
function fmtDate(s){ if(!s)return '-'; var d=new Date(s); return d.toLocaleDateString('es-HN',{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'}); }
function el(tag,attrs,children){
  var n=document.createElement(tag);
  if(attrs) for(var k in attrs){
    if(k==='class') n.className=attrs[k];
    else if(k==='text') n.textContent=attrs[k];
    else if(k==='onclick') n.onclick=attrs[k];
    else if(k==='style') n.setAttribute('style',attrs[k]);
    else n.setAttribute(k,attrs[k]);
  }
  if(children) children.forEach(function(c){ if(c) n.appendChild(typeof c==='string'?document.createTextNode(c):c); });
  return n;
}
function clear(node){ while(node.firstChild) node.removeChild(node.firstChild); }
function toast(m,ms){ var t=$('toast'); t.textContent=m; t.classList.add('show'); setTimeout(function(){t.classList.remove('show')}, ms||2500); }

// ===== AUTH =====
async function tryRestoreSession(){
  var s = await sb.auth.getSession();
  if(s.data.session && s.data.session.user) return s.data.session;
  return null;
}
function showLogin(err){
  $('login').style.display='flex';
  $('app').classList.remove('show');
  $('loginErr').textContent = err||'';
}
function showApp(session){
  $('login').style.display='none';
  $('app').classList.add('show');
  $('userEmail').textContent = session.user.email;
}
async function login(){
  var em=$('email').value.trim(), pw=$('password').value;
  if(!em||!pw){ $('loginErr').textContent='Ingrese email y contrasena'; return; }
  $('loginBtn').disabled=true; $('loginErr').textContent='Verificando...';
  var r = await sb.auth.signInWithPassword({email:em,password:pw});
  $('loginBtn').disabled=false;
  if(r.error){ $('loginErr').textContent = r.error.message; return; }
  var ad = await sb.rpc('is_admin');
  if(!ad.data){ await sb.auth.signOut(); $('loginErr').textContent='Esa cuenta no tiene permisos de admin.'; return; }
  showApp(r.data.session);
  await loadAll();
}
async function logout(){
  await sb.auth.signOut();
  schools=[]; captures=[]; capByCode={};
  showLogin();
}

// ===== DATA LOAD =====
async function loadAll(){
  toast('Cargando catalogo y capturas...');
  schools = await loadSchools();
  captures = await loadCaptures();
  capByCode = {};
  captures.forEach(function(c){
    if(!capByCode[c.sace_code]) capByCode[c.sace_code]=[];
    capByCode[c.sace_code].push(c);
  });
  Object.keys(capByCode).forEach(function(k){
    capByCode[k].sort(function(a,b){ return new Date(b.created_at)-new Date(a.created_at); });
  });
  schools.forEach(function(s){
    if(s.lat!=null && s.lon!=null){
      var d = distKm(deptCenter(s.department), [s.lat, s.lon]);
      s._suspect = d > SUSPECT_KM;
      s._distFromDept = d;
    }
  });
  populateFilters();
  renderStats();
  renderMap();
  toast(captures.length+' capturas, '+schools.filter(function(s){return s.geom!=null}).length+' ubicadas');
}

async function loadSchools(){
  var rows=[]; var from=0; var size=1000;
  while(true){
    var r = await sb.from('schools')
      .select('id,sace_code,name,department,municipio,localidad,zone,enrollment_2024,located_at,located_by,geom')
      .range(from, from+size-1);
    if(r.error){ console.error(r.error); break; }
    rows = rows.concat(r.data||[]);
    if(!r.data || r.data.length<size) break;
    from+=size;
  }
  rows.forEach(function(s){
    if(s.geom){
      var c = parseEWKBHexPoint(s.geom);
      if(c){ s.lon=c[0]; s.lat=c[1]; }
    }
  });
  return rows;
}

async function loadCaptures(){
  var rows=[]; var from=0; var size=1000;
  while(true){
    var r = await sb.from('captures')
      .select('id,school_id,sace_code,lat,lon,accuracy_m,altitude_m,method,status,observations,surveyor_name,surveyor_device,created_at')
      .order('created_at',{ascending:false})
      .range(from, from+size-1);
    if(r.error){ console.error(r.error); break; }
    rows = rows.concat(r.data||[]);
    if(!r.data || r.data.length<size) break;
    from+=size;
  }
  return rows;
}

// PostGIS EWKB hex parser para Point geography (SRID 4326)
function parseEWKBHexPoint(hex){
  if(!hex || hex.length<42) return null;
  try{
    var xHex = hex.substring(18, 18+16);
    var yHex = hex.substring(34, 34+16);
    function hexToDouble(h){
      var bytes = new Uint8Array(8);
      for(var i=0;i<8;i++) bytes[i]=parseInt(h.substr(i*2,2),16);
      var dv=new DataView(bytes.buffer);
      return dv.getFloat64(0, true);
    }
    return [hexToDouble(xHex), hexToDouble(yHex)];
  }catch(e){ return null; }
}

// ===== FILTERS =====
function populateFilters(){
  var depts={}, surveyors={};
  schools.forEach(function(s){ if(s.department) depts[s.department]=true; });
  captures.forEach(function(c){ if(c.surveyor_name) surveyors[c.surveyor_name]=true; });
  fillSelect('fDept', Object.keys(depts).sort());
  fillSelect('fSurv', Object.keys(surveyors).sort());
  refillMunis();
}
function fillSelect(id, values){
  var sel = $(id); clear(sel);
  sel.appendChild(el('option',{value:'',text:'Todos'}));
  values.forEach(function(v){ sel.appendChild(el('option',{value:v,text:v})); });
}
function refillMunis(){
  var munis={};
  schools.filter(function(s){ return !filters.dept || s.department===filters.dept; })
    .forEach(function(s){ if(s.municipio) munis[s.municipio]=true; });
  fillSelect('fMuni', Object.keys(munis).sort());
}

function filterSchools(){
  var q = noAccent(filters.search);
  return schools.filter(function(s){
    if(filters.dept && s.department!==filters.dept) return false;
    if(filters.muni && s.municipio!==filters.muni) return false;
    var loc = (s.geom!=null);
    if(filters.status==='located' && !loc) return false;
    if(filters.status==='pending' && loc) return false;
    if(filters.status==='suspect' && !s._suspect) return false;
    if(filters.surv){
      var caps = capByCode[s.sace_code]||[];
      if(!caps.some(function(c){ return c.surveyor_name===filters.surv; })) return false;
    }
    if(filters.method && filters.method!=='all'){
      var caps2 = capByCode[s.sace_code]||[];
      if(!caps2.some(function(c){ return c.method===filters.method; })) return false;
    }
    if(q){
      var hay = noAccent(s.sace_code+' '+s.name+' '+s.municipio+' '+(s.localidad||''));
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  });
}

// ===== STATS =====
function renderStats(){
  var f = filterSchools();
  var loc = f.filter(function(s){return s.geom!=null}).length;
  var pen = f.length-loc;
  var sus = f.filter(function(s){return s._suspect}).length;
  var caps = 0;
  f.forEach(function(s){ caps += (capByCode[s.sace_code]||[]).length; });
  var pct = f.length ? Math.round(loc/f.length*1000)/10 : 0;
  $('sTotal').textContent = fmt(f.length);
  $('sLoc').textContent = fmt(loc);
  $('sPen').textContent = fmt(pen);
  $('sSus').textContent = fmt(sus);
  $('sCap').textContent = fmt(caps);
  $('sPct').textContent = pct+'%';
  $('barFill').style.width = pct+'%';
}

// ===== MAP =====
function initMap(){
  if(map) return;
  map = L.map('map').setView(HONDURAS_CENTER, 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OSM'}).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,opacity:.5,attribution:'&copy; Esri'}).addTo(map);
  cluster = L.markerClusterGroup({maxClusterRadius:50, disableClusteringAtZoom:12});
  map.addLayer(cluster);
}
function colorIcon(color){
  var d = document.createElement('div');
  d.style.cssText = 'background:'+color+';width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)';
  return L.divIcon({className:'',html:d.outerHTML,iconSize:[14,14],iconAnchor:[7,7]});
}
function renderMap(){
  initMap();
  cluster.clearLayers();
  var f = filterSchools();
  f.forEach(function(s){
    if(s.lat==null||s.lon==null) return;
    var color = s._suspect ? '#dc3545' : '#28a745';
    var m = L.marker([s.lat,s.lon],{icon:colorIcon(color),title:s.name});
    m.on('click', function(){ showDetail(s); });
    cluster.addLayer(m);
  });
}

// ===== DETAIL =====
function showDetail(s){
  selectedSchool = s;
  var d = $('detail'); d.classList.remove('empty'); clear(d);
  var caps = capByCode[s.sace_code]||[];
  var loc = s.geom!=null;
  var statusBadge = el('span',{class:'badge '+(loc?(s._suspect?'b-sus':'b-ok'):'b-pe'),text: loc?(s._suspect?'Sospechosa':'Ubicada'):'Pendiente'});

  d.appendChild(el('h2',{text:s.name}));
  var meta=el('div',{class:'meta'},[
    el('strong',{text:s.sace_code}),
    document.createTextNode('  \u2022  '+s.municipio+', '+s.department),
    el('br'),
    document.createTextNode((s.localidad||'')+(s.zone?'  \u2022  '+s.zone:'')),
    el('br'),
    document.createTextNode('Matricula 2024: '+fmt(s.enrollment_2024||0)),
    el('br'), statusBadge
  ]);
  d.appendChild(meta);

  if(loc){
    var coordTxt = s.lat.toFixed(6)+', '+s.lon.toFixed(6);
    var aOsm = el('a',{class:'open-osm',target:'_blank',href:'https://www.openstreetmap.org/?mlat='+s.lat+'&mlon='+s.lon+'#map=18/'+s.lat+'/'+s.lon,text:'Abrir en OSM ('+coordTxt+')'});
    d.appendChild(aOsm);
    if(s._suspect){
      d.appendChild(el('div',{class:'meta',style:'color:#a00;margin-top:8px',text:'Pin a ~'+s._distFromDept.toFixed(0)+' km del centro de '+s.department+'. Revisar.'}));
    }
  }

  d.appendChild(el('h3',{style:'font-size:13px;color:var(--gray);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px',text:'Capturas ('+caps.length+')'}));
  if(!caps.length){
    d.appendChild(el('div',{class:'meta',text:'Sin capturas todavia. Esta escuela aparecera como pendiente hasta que un director la georreferencie.'}));
  } else {
    caps.forEach(function(c, i){
      var primary = (i===caps.length-1);  // mas antigua = la que consolido
      var dCenter = deptCenter(s.department);
      var dist = distKm(dCenter, [c.lat,c.lon]);
      var suspect = dist > SUSPECT_KM;
      var box = el('div',{class:'cap'+(primary?' primary':'')+(suspect?' suspect':'')});
      box.appendChild(el('div',{class:'head'},[
        el('div',{class:'who',text:c.surveyor_name||'(anonimo)'}),
        el('div',{class:'when',text:fmtDate(c.created_at)})
      ]));
      box.appendChild(el('div',{class:'coords',text:c.lat.toFixed(6)+', '+c.lon.toFixed(6)+'  ('+c.method+(c.accuracy_m?' '+c.accuracy_m.toFixed(0)+'m':'')+')'}));
      if(suspect) box.appendChild(el('div',{class:'meta',style:'color:#a00;font-size:11px;margin-top:4px',text:'~'+dist.toFixed(0)+' km del centro depto'}));
      if(c.observations) box.appendChild(el('div',{class:'obs',text:'"'+c.observations+'"'}));
      var actions=el('div',{class:'actions'});
      if(!primary){
        actions.appendChild(el('button',{class:'promote',text:'Hacer oficial',onclick:function(){ promoteCapture(s,c); }}));
      }
      actions.appendChild(el('button',{class:'delete',text:'Borrar',onclick:function(){ deleteCapture(s,c); }}));
      box.appendChild(actions);
      d.appendChild(box);
    });
  }

  if(loc){
    d.appendChild(el('button',{class:'reset-btn',text:'Resetear: marcar como pendiente',onclick:function(){ resetSchool(s); }}));
  }

  if(s.lat!=null) map.setView([s.lat,s.lon], Math.max(map.getZoom(), 16));
}

// ===== ACTIONS =====
async function deleteCapture(s, c){
  if(!confirm('Borrar esta captura de '+(c.surveyor_name||'?')+' ('+fmtDate(c.created_at)+')? No se puede deshacer.')) return;
  var r = await sb.from('captures').delete().eq('id', c.id);
  if(r.error){ toast('Error: '+r.error.message); return; }
  toast('Captura borrada');
  await loadAll();
  var fresh = schools.find(function(x){return x.sace_code===s.sace_code});
  if(fresh) showDetail(fresh);
}

async function promoteCapture(s, c){
  if(!confirm('Hacer oficial esta captura? Reemplaza la coordenada actual de la escuela.')) return;
  var r = await sb.from('schools').update({
    geom: 'SRID=4326;POINT('+c.lon+' '+c.lat+')',
    located_at: c.created_at,
    located_by: c.id,
    updated_at: new Date().toISOString()
  }).eq('id', s.id);
  if(r.error){ toast('Error: '+r.error.message); return; }
  toast('Captura promovida a oficial');
  await loadAll();
  var fresh = schools.find(function(x){return x.sace_code===s.sace_code});
  if(fresh) showDetail(fresh);
}

async function resetSchool(s){
  if(!confirm('Resetear esta escuela? Vuelve al pool de pendientes (las capturas se conservan, solo se quita la coordenada oficial).')) return;
  var r = await sb.from('schools').update({geom:null, located_at:null, located_by:null, updated_at:new Date().toISOString()}).eq('id', s.id);
  if(r.error){ toast('Error: '+r.error.message); return; }
  toast('Escuela reseteada');
  await loadAll();
  var fresh = schools.find(function(x){return x.sace_code===s.sace_code});
  if(fresh) showDetail(fresh);
}

// ===== EXPORT =====
function exportGeoJson(){
  var f = filterSchools().filter(function(s){return s.lat!=null&&s.lon!=null});
  var fc = {type:'FeatureCollection', features: f.map(function(s){
    return {
      type:'Feature',
      geometry:{type:'Point',coordinates:[s.lon,s.lat]},
      properties:{
        sace_code:s.sace_code, name:s.name,
        department:s.department, municipio:s.municipio, localidad:s.localidad,
        zone:s.zone, enrollment_2024:s.enrollment_2024,
        located_at:s.located_at,
        suspect: !!s._suspect
      }
    };
  })};
  var blob = new Blob([JSON.stringify(fc,null,2)],{type:'application/geo+json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='geoescuelas_'+new Date().toISOString().slice(0,10)+'.geojson'; a.click();
  toast(f.length+' escuelas exportadas');
}
function exportExcel(){
  var f = filterSchools();
  var data = f.map(function(s){
    var caps=capByCode[s.sace_code]||[];
    var primary = caps.length ? caps[caps.length-1] : null;
    return {
      'Codigo SACE':s.sace_code,'Nombre':s.name,
      'Departamento':s.department,'Municipio':s.municipio,'Localidad':s.localidad,
      'Zona':s.zone,'Matricula 2024':s.enrollment_2024,
      'Lat':s.lat||'','Lon':s.lon||'',
      'Estado': s.geom!=null ? (s._suspect?'Sospechosa':'Ubicada') : 'Pendiente',
      'Capturas':caps.length,
      'Encuestador (1ra)': primary?primary.surveyor_name:'',
      'Metodo (1ra)': primary?primary.method:'',
      'Fecha (1ra)': primary?primary.created_at:''
    };
  });
  var ws = XLSX.utils.json_to_sheet(data);
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Escuelas');
  XLSX.writeFile(wb, 'geoescuelas_admin_'+new Date().toISOString().slice(0,10)+'.xlsx');
  toast('Excel descargado');
}

// ===== EVENTS =====
function bindUI(){
  $('loginBtn').onclick = login;
  $('password').addEventListener('keydown', function(e){ if(e.key==='Enter') login(); });
  $('logout').onclick = logout;
  $('reload').onclick = loadAll;
  $('expGeoJson').onclick = exportGeoJson;
  $('expExcel').onclick = exportExcel;
  $('fDept').onchange = function(){ filters.dept=this.value; refillMunis(); filters.muni=''; $('fMuni').value=''; renderStats(); renderMap(); };
  $('fMuni').onchange = function(){ filters.muni=this.value; renderStats(); renderMap(); };
  $('fSurv').onchange = function(){ filters.surv=this.value; renderStats(); renderMap(); };
  document.querySelectorAll('#fStatus .chip').forEach(function(c){
    c.onclick=function(){
      document.querySelectorAll('#fStatus .chip').forEach(function(x){x.classList.remove('active')});
      c.classList.add('active'); filters.status=c.dataset.v; renderStats(); renderMap();
    };
  });
  document.querySelectorAll('#fMethod .chip').forEach(function(c){
    c.onclick=function(){
      document.querySelectorAll('#fMethod .chip').forEach(function(x){x.classList.remove('active')});
      c.classList.add('active'); filters.method=c.dataset.v; renderStats(); renderMap();
    };
  });
  var st;
  $('fSearch').addEventListener('input', function(){ clearTimeout(st); st=setTimeout(function(){ filters.search=$('fSearch').value; renderStats(); renderMap(); }, 300); });
  $('fReset').onclick = function(){
    filters={ dept:'', muni:'', status:'all', surv:'', method:'all', search:'' };
    $('fDept').value=''; $('fMuni').value=''; $('fSurv').value=''; $('fSearch').value='';
    document.querySelectorAll('#fStatus .chip').forEach(function(x){x.classList.remove('active'); if(x.dataset.v==='all')x.classList.add('active')});
    document.querySelectorAll('#fMethod .chip').forEach(function(x){x.classList.remove('active'); if(x.dataset.v==='all')x.classList.add('active')});
    refillMunis(); renderStats(); renderMap();
  };
}

// ===== BOOT =====
(async function boot(){
  bindUI();
  var session = await tryRestoreSession();
  if(session){
    var ad = await sb.rpc('is_admin');
    if(ad.data){ showApp(session); await loadAll(); return; }
    await sb.auth.signOut();
  }
  showLogin();
})();

})();
