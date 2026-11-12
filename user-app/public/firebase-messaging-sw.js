/* eslint-disable no-undef */
/*
 * Fire Arena service worker.
 *
 * 1. FCM background messages when Firebase web config is present.
 * 2. A generic Web Push handler so server-sent pushes still display even when
 *    Firebase is not configured.
 * 3. Click handling that focuses an existing tab and opens the click action.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

let fcmActive = false;

try {
  importScripts('/firebase-config.js');
} catch (error) {
  self.FIREBASE_WEB_CONFIG = null;
}

if (self.FIREBASE_WEB_CONFIG && self.FIREBASE_WEB_CONFIG.apiKey) {
  try {
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    firebase.initializeApp(self.FIREBASE_WEB_CONFIG);
    const messaging = firebase.messaging();
    fcmActive = true;

    messaging.onBackgroundMessage((payload) => {
      const notification = payload.notification || {};
      const data = payload.data || {};
      self.registration.showNotification(notification.title || 'Fire Arena', {
        body: notification.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        image: notification.image || undefined,
        tag: data.notificationId || undefined,
        data: { url: data.clickAction || '/notifications' },
      });
    });
  } catch (error) {
    fcmActive = false;
  }
}

self.addEventListener('push', (event) => {
  if (fcmActive) return; // FCM compat SDK already rendered this message.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const notification = payload.notification || payload;
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(notification.title || 'Fire Arena', {
      body: notification.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      image: notification.image || undefined,
      tag: data.notificationId || undefined,
      data: { url: data.clickAction || payload.clickAction || '/notifications' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
