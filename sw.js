// sw.js — Service Worker
// Arquivos do PRÓPRIO app (html/js/json): network-first — sempre busca a
// versão mais nova quando há internet, e só usa o cache salvo se estiver
// offline. Bibliotecas externas (CDN) e ícones: cache-first, pois raramente mudam.
const CACHE_NAME = "lex-revisao-v3";
const ARQUIVOS_PROPRIOS = ["/", "/index.html", "/app.js", "/manifest.json"];
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/dexie/dist/dexie.js",
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.13.0/firebase-app-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.13.0/firebase-auth-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.13.0/firebase-firestore-compat.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map((url) => cache.add(url).catch((err) => console.warn("Falha ao cachear:", url, err)))
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function ehArquivoProprio(url) {
  const caminho = new URL(url).pathname;
  return ARQUIVOS_PROPRIOS.some((a) => caminho === a || caminho.endsWith(a.replace("./", "/")));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Arquivos do próprio app: tenta a rede primeiro (pega sempre a versão mais nova)
  if (ehArquivoProprio(event.request.url) || event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Bibliotecas externas e ícones: cache primeiro (raramente mudam)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => undefined);
    })
  );
});
