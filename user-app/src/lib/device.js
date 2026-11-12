const FP_KEY = 'ff_device_fp';

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function detectOs(ua) {
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown OS';
}

function detectBrowser(ua) {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Web';
}

function detectModel(ua) {
  const android = ua.match(/Android [\d.]+; ([^;)]+)/);
  if (android) return android[1].trim();
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  return '';
}

export function getDeviceInfo() {
  const ua = navigator.userAgent || '';
  const os = detectOs(ua);
  const browser = detectBrowser(ua);
  const model = detectModel(ua);
  const platform = /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';

  let fingerprint = null;
  try {
    fingerprint = localStorage.getItem(FP_KEY);
    if (!fingerprint) {
      fingerprint = `web-${hash(
        [ua, navigator.language, screen.width, screen.height, new Date().getTimezoneOffset()].join('|'),
      )}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(FP_KEY, fingerprint);
    }
  } catch {
    fingerprint = `web-${hash(ua)}-anon`;
  }

  let name = `${browser} on ${os}`;
  if (os === 'Android' || os === 'iOS') name = `${model || 'Mobile'} · ${os}`;
  if (os === 'Windows') name = 'Windows Computer';
  if (os === 'macOS') name = 'Mac Computer';
  if (os === 'Linux') name = 'Linux Computer';

  return { name, model, os, browser, platform, fingerprint };
}
