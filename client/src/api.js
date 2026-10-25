// HTTP client + access-token lifecycle.
// The access token lives only in this module's memory (never localStorage), so an
// XSS payload can't lift a long-lived credential. The session survives reloads via
// the httpOnly refresh cookie, which JS cannot read at all.

let accessToken = null;
let refreshTimer = null;
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const getAccessToken = () => accessToken;

/** Subscribe to token changes (null = signed out). Returns an unsubscribe function. */
export function onTokenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function setAccessToken(token) {
  accessToken = token;
  clearTimeout(refreshTimer);
  const exp = token && tokenExpiry(token);
  if (exp) {
    // Refresh a minute early so sockets and requests never see an expired token.
    const delay = Math.max(exp - Date.now() - 60_000, 5_000);
    refreshTimer = setTimeout(() => refreshSession().catch(() => {}), delay);
  }
  listeners.forEach((fn) => fn(token));
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.code);
  return data;
}

let inflightRefresh = null;

/**
 * Exchanges the refresh cookie for a new access token. De-duplicated within a tab,
 * and serialised across tabs with the Web Locks API so concurrent tabs don't race
 * each other's token rotation.
 */
export function refreshSession() {
  if (!inflightRefresh) {
    const run = () => request('/api/auth/refresh', { method: 'POST', auth: false });
    const attempt = navigator.locks ? navigator.locks.request('relay-auth-refresh', run) : run();
    inflightRefresh = attempt
      .then((data) => {
        setAccessToken(data.accessToken);
        return data;
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAccessToken(null);
        throw err;
      })
      .finally(() => {
        inflightRefresh = null;
      });
  }
  return inflightRefresh;
}

/** Authenticated request that transparently refreshes once on a 401. */
export async function api(path, options) {
  try {
    return await request(path, options);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    await refreshSession();
    return request(path, options);
  }
}

/**
 * Uploads one file to a room. Uses XHR rather than fetch so we get upload progress.
 * Resolves with the server's attachment record; retries once after a token refresh.
 */
export function uploadFile(roomId, file, { onProgress, signal } = {}) {
  const attempt = () =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/rooms/${encodeURIComponent(roomId)}/attachments`);
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON error page */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.attachment);
        else reject(new ApiError(xhr.status, data?.error ?? 'Upload failed', data?.code));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
      xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled', 'ABORTED'));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(file);
    });

  return attempt().catch(async (err) => {
    if (err.status !== 401) throw err;
    await refreshSession();
    return attempt();
  });
}

export async function login(username, password) {
  const data = await request('/api/auth/login', { method: 'POST', body: { username, password }, auth: false });
  setAccessToken(data.accessToken);
  return data;
}

export async function register(username, password, displayName) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: { username, password, displayName },
    auth: false,
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST', auth: false });
  } finally {
    setAccessToken(null);
  }
}
