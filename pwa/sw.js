/* PWA Service Worker：缓存 App 壳（可安装/离线）；API（带 action=）不缓存、走网络 */
var CACHE='ecs-pwa-v1';
var SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(SHELL);}).catch(function(){}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}));});
self.addEventListener('fetch',function(e){
  var req=e.request; if(req.method!=='GET')return;
  var url=new URL(req.url); if(url.searchParams.get('action'))return; // API 不缓存
  e.respondWith(
    caches.match(req).then(function(hit){
      if(hit)return hit;
      return fetch(req).then(function(resp){
        var copy=resp.clone(); caches.open(CACHE).then(function(c){c.put(req,copy);}).catch(function(){});
        return resp;
      });
    }).catch(function(){ return caches.match('./index.html'); })
  );
});
