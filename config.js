// Where the ClutchMetrics analysis server runs (the model on the owner's laptop, opened to the internet with ngrok).
// For testing on the laptop itself, run in the browser console:  localStorage.setItem('cm-server', 'http://localhost:8000')
// and remove it again with:  localStorage.removeItem('cm-server')
const DEFAULT_SERVER = 'https://lizard-makeshift-clock.ngrok-free.dev';

export const SERVER = (() => {
  try { return localStorage.getItem('cm-server') || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; }
})();

// ngrok's free plan shows a warning page to browsers unless this header is sent
export const SERVER_HEADERS = { 'ngrok-skip-browser-warning': '1' };

export function serverFetch(path, options = {}) {
  return fetch(`${SERVER}${path}`, { ...options, headers: { ...SERVER_HEADERS, ...(options.headers || {}) } });
}

// A video from the server, loaded with the header above and handed to a <video> element as a local file
export async function serverVideoUrl(path) {
  const res = await serverFetch(path);
  if (!res.ok) throw new Error(`video status ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
