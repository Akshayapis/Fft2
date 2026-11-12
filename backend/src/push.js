import fs from 'node:fs';

/**
 * Push transport abstraction.
 *
 * - When Firebase Cloud Messaging service-account credentials are configured
 *   (FIREBASE_SERVICE_ACCOUNT as JSON, or GOOGLE_APPLICATION_CREDENTIALS pointing to a file),
 *   real FCM push notifications are sent through firebase-admin.
 * - When credentials are missing, the transport reports `not_configured` instead of pretending
 *   a push was delivered. The in-app notification record is always created regardless, so the
 *   notification centre keeps working without push permissions.
 */

let messagingPromise = null;
let initError = null;

function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      initError = `FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${error.message}`;
    }
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      initError = `Cannot read GOOGLE_APPLICATION_CREDENTIALS: ${error.message}`;
    }
  }
  return null;
}

export async function getMessaging() {
  if (messagingPromise) return messagingPromise;
  const credentials = readServiceAccount();
  if (!credentials) {
    messagingPromise = Promise.resolve(null);
    return messagingPromise;
  }
  messagingPromise = (async () => {
    try {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getMessaging: getFcm } = await import('firebase-admin/messaging');
      const app = getApps().length
        ? getApps()[0]
        : initializeApp({
            credential: cert({
              projectId: credentials.project_id,
              clientEmail: credentials.client_email,
              privateKey: (credentials.private_key || '').replace(/\\n/g, '\n'),
            }),
          });
      return getFcm(app);
    } catch (error) {
      initError = `firebase-admin unavailable: ${error.message}`;
      return null;
    }
  })();
  return messagingPromise;
}

export async function getPushStatus() {
  const credentials = readServiceAccount();
  if (!credentials) {
    return {
      configured: false,
      provider: 'none',
      reason:
        'Firebase Cloud Messaging service-account credentials are not configured. In-app notifications are delivered; real push is disabled.',
    };
  }
  const messaging = await getMessaging();
  return {
    configured: !!messaging,
    provider: messaging ? 'fcm' : 'none',
    reason: messaging ? null : initError || 'FCM initialisation failed.',
  };
}

/**
 * Send a push to many device tokens.
 * Always resolves with a delivery report; never throws for provider errors.
 */
export async function sendPush({ tokens = [], title, body, data = {}, image = null }) {
  const messaging = await getMessaging();
  const cleanTokens = [...new Set(tokens.filter(Boolean))];
  if (!messaging) {
    return {
      status: 'not_configured',
      provider: 'none',
      targetCount: cleanTokens.length,
      successCount: 0,
      failureCount: cleanTokens.length,
      errors: [],
      invalidTokens: [],
    };
  }
  if (!cleanTokens.length) {
    return {
      status: 'no_devices',
      provider: 'fcm',
      targetCount: 0,
      successCount: 0,
      failureCount: 0,
      errors: [],
      invalidTokens: [],
    };
  }
  try {
    const response = await messaging.sendEachForMulticast({
      tokens: cleanTokens,
      notification: { title, body, ...(image ? { imageUrl: image } : {}) },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')])),
      webpush: {
        notification: { title, body, icon: '/icon-192.png', ...(image ? { image } : {}) },
        fcmOptions: data.clickAction ? { link: data.clickAction } : undefined,
      },
    });
    const invalidTokens = [];
    const errors = [];
    response.responses.forEach((res, i) => {
      if (!res.success) {
        errors.push(res.error?.message || 'unknown error');
        const code = res.error?.code || '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          invalidTokens.push(cleanTokens[i]);
        }
      }
    });
    return {
      status: response.successCount > 0 ? 'sent' : 'failed',
      provider: 'fcm',
      targetCount: cleanTokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors: errors.slice(0, 10),
      invalidTokens,
    };
  } catch (error) {
    return {
      status: 'failed',
      provider: 'fcm',
      targetCount: cleanTokens.length,
      successCount: 0,
      failureCount: cleanTokens.length,
      errors: [error.message],
      invalidTokens: [],
    };
  }
}
