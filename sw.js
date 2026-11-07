// Guarda os arquivos do app no celular para abrir sem internet.
// Ao mudar qualquer arquivo do app, aumente a VERSAO para os celulares baixarem a nova.
const VERSAO = 'v2';
const ARQUIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primeiro tenta a rede (pega atualizações); sem internet, usa a cópia guardada.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
