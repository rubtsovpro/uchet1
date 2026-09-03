/* Service worker · Фото авто приёмка · Web Push · v3 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Сфотографировать авто', body: '', url: '/reception-photo?v=rp7' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    try {
      data.body = event.data ? event.data.text() : '';
    } catch (_) {}
  }
  const title = data.title || 'Учёт №1';
  const options = {
    body: data.body || 'Нужно сфотографировать авто',
    tag: data.tag || 'car-photo',
    renotify: true,
    icon: '/logo-uchet1.svg',
    badge: '/logo-uchet1.svg',
    data: { url: data.url || '/reception-photo?v=rp7' },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/reception-photo?v=rp7';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
