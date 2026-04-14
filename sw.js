// Service worker - cache-first para assets estaticos, network-first para API Supabase.
var CACHE='geoescuelas-v2-1';
var ASSETS=[
  './','./index.html','./app.js','./config.js','./manifest.json','./centros.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS)}).then(function(){return self.skipWaiting()}));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}));
  }).then(function(){return self.clients.claim()}));
});
self.addEventListener('fetch', function(e){
  var url=new URL(e.request.url);
  // Supabase API + tiles: network-first, no cachear POST de captures
  if(url.hostname.indexOf('supabase.co')>=0 || url.hostname.indexOf('arcgisonline.com')>=0 || url.hostname.indexOf('tile.openstreetmap.org')>=0){
    e.respondWith(fetch(e.request).catch(function(){return caches.match(e.request)}));
    return;
  }
  // Resto: cache-first
  e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request).then(function(resp){
    if(e.request.method==='GET' && resp.ok) { var copy=resp.clone(); caches.open(CACHE).then(function(c){c.put(e.request,copy)}) }
    return resp;
  })}));
});
