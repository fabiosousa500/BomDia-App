const C = 'precos-inv-v22';
const FICHEIROS = ['./', 'index.html', 'pos.html', 'config.js','faturas.js', 'etiquetas.js', 'volta.jpg', 'pdf.min.mjs', 'pdf.worker.min.mjs', 'manifest.json', 'logo.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FICHEIROS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// rede primeiro (apanha atualizações), cache se estiver sem internet
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(C).then(c => c.put(e.request, cp));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
