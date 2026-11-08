// Block-owned data endpoints can be remote. Keep that allowance in connect-src;
// executable code must come from the Studio renderer's own origin.
export const DESKTOP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Vite's React refresh preamble is inline. This allowance is for development
// responses only; the installed app uses the policy above.
export const DESKTOP_DEV_CONTENT_SECURITY_POLICY = DESKTOP_CONTENT_SECURITY_POLICY.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
);
