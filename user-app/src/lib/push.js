import { api, getToken } from './api.js';

let messaging = null;
let currentToken = null;

/**
 * Real FCM push registration.
 *
 * The backend only reports push as configured when Firebase service-account
 * credentials exist. When they do not, this returns { status: 'unavailable' }
 * and the app keeps working through the in-app notification centre — it never
 * pretends a push was delivered.
 */
export async function enablePush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return { status: 'unsupported', reason: 'Push notifications are not supported in this browser.' };
  }

  const config = await api('/api/config', { token: getToken() });
  if (!config.firebase) {
    return {
      status: 'unavailable',
      reason:
        'Push is not configured on the server yet (FCM web config missing). Notifications still appear in the in-app notification centre.',
    };
  }
  if (!config.push?.configured) {
    return { status: 'unavailable', reason: config.push?.reason || 'Push provider is not configured.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { status: 'denied', reason: 'Notification permission was not granted.' };
  }

  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, getToken: getFcmToken, onMessage } = await import('firebase/messaging');

    const app = getApps().length ? getApps()[0] : initializeApp(config.firebase);
    messaging = getMessaging(app);

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;

    currentToken = await getFcmToken(messaging, {
      vapidKey: config.firebase.vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!currentToken) {
      return { status: 'error', reason: 'Could not obtain an FCM device token.' };
    }

    await api('/api/devices/token', {
      method: 'POST',
      body: { token: currentToken, platform: 'web' },
    });

    onMessage(messaging, (payload) => {
      window.dispatchEvent(
        new CustomEvent('ff:push', {
          detail: {
            title: payload.notification?.title || 'Fire Arena',
            body: payload.notification?.body || '',
            data: payload.data || {},
          },
        }),
      );
    });

    return { status: 'granted', token: currentToken };
  } catch (error) {
    return { status: 'error', reason: error.message };
  }
}

export async function disablePush() {
  try {
    if (currentToken) {
      await api('/api/devices/token', { method: 'POST', body: { token: null, platform: 'web' } });
    }
  } catch {
    /* ignore */
  }
  currentToken = null;
  messaging = null;
  return { status: 'disabled' };
}

export const pushState = () => ({
  permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  token: currentToken,
});
