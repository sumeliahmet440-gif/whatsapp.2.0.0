self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'Sohbet';
  const options = {
    body: data.body || 'Yeni bildirimin var',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'sohbet-notification',
    renotify: !!data.call,
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || '/' },
    vibrate: data.call ? [300, 150, 300, 150, 500] : [120, 60, 120],
  };
  event.waitUntil((async () => {
    // Açık ve görünür sekme kendi arayüz bildirimini gösterir; arka plan/kapalı sekmede OS bildirimi göster.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = windows.some((client) => client.visibilityState === 'visible' && client.focused);
    if (visible) return;
    await self.registration.showNotification(title, options);
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if ('focus' in client) { await client.navigate(url); return client.focus(); }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
