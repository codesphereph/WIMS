/* CPU WIMS — API client. Talks to the Apps Script Web App, or the demo backend when no URL is set. */
(function () {
  'use strict';
  const CFG = window.WMS_CONFIG || {};
  let override = '';
  try { override = localStorage.getItem('sp_api_url') || ''; } catch (e) { /* ignore */ }
  const url = (override || CFG.API_URL || '').trim();
  const isDemo = !url;
  const Err = window.WmsError;

  async function remote(action, payload, token) {
    let res;
    try {
      // text/plain avoids a CORS preflight, which Apps Script does not answer.
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload: payload || {}, token: token || '' }),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Err('Cannot reach the server — check your connection.', 'NETWORK');
    }
    let j;
    try { j = await res.json(); } catch (e) {
      throw new Err('Unexpected server response. Check the Apps Script URL and that access is set to "Anyone".', 'BAD_RESPONSE');
    }
    if (!j.ok) throw new Err(j.error || 'Request failed', j.code);
    return j.data;
  }

  async function demo(action, payload, token) {
    await new Promise((r) => setTimeout(r, 90 + Math.random() * 120)); // feel like a network call
    return window.DemoBackend.call(action, payload, token);
  }

  window.API = {
    isDemo,
    url,
    call: (action, payload, token) => (isDemo ? demo(action, payload, token) : remote(action, payload, token)),
    setUrl(u) { try { if (u) localStorage.setItem('sp_api_url', u.trim()); else localStorage.removeItem('sp_api_url'); } catch (e) { /* ignore */ } },
    async test(u) {
      const res = await fetch(u.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'ping' }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Ping failed');
      return j.data;
    }
  };
})();
