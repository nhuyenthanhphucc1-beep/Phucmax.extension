// == phucmaxreg v3.0 - Background Service Worker ==

chrome.runtime.onInstalled.addListener(() => {
  console.log('phucmaxreg v3.0 - background ready');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FETCH_JSON') {
    const options = {
      method: msg.method || 'GET',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }
    };
    if (msg.token) options.headers['Authorization'] = `Bearer ${msg.token}`;
    if (msg.body) options.body = JSON.stringify(msg.body);

    fetch(msg.url, options)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
