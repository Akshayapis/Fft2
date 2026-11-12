/*
 * Firebase web configuration for the service worker.
 *
 * Fill this in with the SAME web config used by the app (Firebase console →
 * Project settings → Your apps → Web app → SDK setup and configuration).
 * Never put a service-account private key here — the web config is public by
 * design, the private key belongs only in the backend environment.
 *
 * Example:
 * self.FIREBASE_WEB_CONFIG = {
 *   apiKey: "AIza...",
 *   authDomain: "your-project.firebaseapp.com",
 *   projectId: "your-project",
 *   storageBucket: "your-project.appspot.com",
 *   messagingSenderId: "1234567890",
 *   appId: "1:1234567890:web:abcdef",
 *   vapidKey: "BEl...public-vapid-key..."
 * };
 */
self.FIREBASE_WEB_CONFIG = null;
