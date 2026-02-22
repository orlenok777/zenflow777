const CACHE_NAME = 'zenflow-v4-cache';
const ASSETS_TO_CACHE = [
  './index.html',
  './styles.css',
  './app.js',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap',
  './icons/favicon.svg',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

const API_ENDPOINTS = ['/api/', 'https://'];
const STATIC_ASSETS = ['.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf'];

// Install Event - Cache essential assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching essential assets');
      return cache.addAll(ASSETS_TO_CACHE).catch((error) => {
        console.warn('[Service Worker] Failed to cache some assets:', error);
        // Continue even if some assets fail to cache
      });
    }).then(() => {
      self.skipWaiting();
    })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

// Fetch Event - Implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and chrome extensions
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') {
    return;
  }

  // Network-first strategy for API calls
  if (API_ENDPOINTS.some((endpoint) => url.href.includes(endpoint))) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response && response.status === 200) {
            const cacheName = `${CACHE_NAME}-api`;
            caches.open(cacheName).then((cache) => {
              cache.put(request, response.clone());
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cached response if network fails
          return caches.match(request).then((response) => {
            if (response) {
              return response;
            }
            // Return offline fallback
            if (request.destination === 'document') {
              return caches.match('./index.html');
            }
            return new Response('Offline - Resource not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
        })
    );
    return;
  }

  // Cache-first strategy for static assets
  if (STATIC_ASSETS.some((ext) => url.pathname.includes(ext))) {
    event.respondWith(
      caches.match(request).then((response) => {
        if (response) {
          return response;
        }
        return fetch(request)
          .then((response) => {
            // Cache new static assets
            if (response && response.status === 200) {
              const cache = caches.open(CACHE_NAME);
              cache.then((c) => {
                c.put(request, response.clone());
              });
            }
            return response;
          })
          .catch(() => {
            // Return offline fallback for static assets
            return new Response('Offline - Resource not available', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
    );
    return;
  }

  // Stale-while-revalidate for documents
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((response) => {
        // Cache the response for next time
        if (response && response.status === 200) {
          const cache = caches.open(CACHE_NAME);
          cache.then((c) => {
            c.put(request, response.clone());
          });
        }
        return response;
      });

      return cachedResponse || fetchPromise;
    }).catch(() => {
      // Return cached version or offline fallback
      if (request.destination === 'document') {
        return caches.match('./index.html');
      }
      return new Response('Offline - Resource not available', {
        status: 503,
        statusText: 'Service Unavailable'
      });
    })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
