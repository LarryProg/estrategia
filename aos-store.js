/* ════════════════════════════════════════════════════════════════════
   AOS · base común de las apps de Artist OS (Moodboard, Logo, Estética, Portfolio)
   - Identifica al artista con el ?t=<código> que pasa el portal (o el guardado en larryos:t).
   - Guarda los datos de cada app en la planilla (Apps Script) y en el navegador como respaldo.
   - Sube imágenes (comprimidas) a una carpeta de Drive del artista y devuelve un link para <img>.
   - Sin código (o ?demo=1) funciona igual, guardando solo en el navegador.

   API (todo devuelve Promises):
     AOS.ready                  → {token, demo, artista:{nombre, pack}}
     AOS.load(app)              → objeto guardado o null
     AOS.save(app, data)        → guarda (JSON chico: NO meter imágenes en base64, usar AOS.upload)
     AOS.upload(fileOrBlob, nombre?) → url pública de la imagen
     AOS.compress(file, maxLado=1600, calidad=.84) → Blob JPEG/PNG
     AOS.publish(app, data, slug) → {url} link público (portfolio)
     AOS.getPublic(slug)        → data publicada (para la vista pública)
     AOS.manual()               → respuestas del Manual de Marca si están en este navegador (o null)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz2cB4X2HBLzrGztUKyjp5yrcAblvN2K0I8_36XjRLgE4F60WCrgR9cX3k_IuN22N72UA/exec';
  const q = new URLSearchParams(location.search);
  let token = (q.get('t') || '').trim();
  try { if (!token) token = localStorage.getItem('larryos:t') || ''; } catch (e) {}
  const demo = q.get('demo') === '1' || !token || token === 'demo';
  const LK = app => 'aos:' + (demo ? 'demo' : token) + ':' + app;

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // POST como text/plain: Apps Script no acepta preflight CORS
  async function post(body) {
    const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(Object.assign({ t: token }, body)) });
    const j = await r.json();
    if (!j || j.ok === false) throw new Error((j && j.error) || 'No se pudo guardar');
    return j;
  }

  const ready = (async () => {
    if (demo) return { token: '', demo: true, artista: { nombre: 'Artista Demo', pack: 'ERA' } };
    try {
      const j = await post({ action: 'whoami' });
      return { token, demo: false, artista: { nombre: j.cliente || '', pack: j.pack || '' } };
    } catch (e) { return { token, demo: false, artista: { nombre: '', pack: '' }, offline: true }; }
  })();

  async function load(app) {
    const local = lsGet(LK(app));
    if (demo) return local ? local.data : null;
    try {
      const j = await post({ action: 'load', app });
      const remote = j.data ? { at: j.at || 0, data: j.data } : null;
      // gana lo más nuevo (por si guardó sin conexión)
      if (local && (!remote || (local.at || 0) > (remote.at || 0))) { save(app, local.data); return local.data; }
      if (remote) lsSet(LK(app), remote);
      return remote ? remote.data : null;
    } catch (e) { return local ? local.data : null; }
  }

  const timers = {};
  function save(app, data) {
    const rec = { at: Date.now(), data };
    lsSet(LK(app), rec);
    if (demo) return Promise.resolve({ ok: true, local: true });
    clearTimeout(timers[app]);
    return new Promise(res => {
      timers[app] = setTimeout(() => {
        post({ action: 'save', app, data, at: rec.at }).then(res).catch(err => res({ ok: false, error: err.message }));
      }, 700);
    });
  }

  function compress(file, maxSide = 1600, quality = 0.84) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const png = /png|svg/.test(file.type);
        c.toBlob(b => { URL.revokeObjectURL(url); b ? res(b) : rej(new Error('No se pudo comprimir')); }, png ? 'image/png' : 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Imagen no válida')); };
      img.src = url;
    });
  }

  function blobToBase64(b) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
  }

  async function upload(fileOrBlob, nombre) {
    const blob = /^image\/(gif|svg)/.test(fileOrBlob.type) ? fileOrBlob : await compress(fileOrBlob);
    if (demo) { // sin cuenta: queda como data URL en el navegador
      return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    }
    const b64 = await blobToBase64(blob);
    const j = await post({ action: 'upload', nombre: nombre || (fileOrBlob.name || 'imagen'), mime: blob.type, b64 });
    return j.url;
  }

  async function publish(app, data, slug) {
    if (demo) return { url: location.origin + location.pathname.replace(/[^/]*$/, '') + '?p=demo', demo: true };
    const j = await post({ action: 'publish', app, data, slug });
    return { url: j.url, slug: j.slug };
  }

  async function getPublic(slug) {
    if (slug === 'demo') { const l = lsGet('aos:demo:portfolio'); return l ? l.data : null; }
    const r = await fetch(SCRIPT_URL + '?publico=' + encodeURIComponent(slug));
    const j = await r.json();
    return j && j.ok ? j.data : null;
  }

  function manual() { try { return JSON.parse(localStorage.getItem('mm3_state')); } catch (e) { return null; } }

  window.AOS = { ready, load, save, upload, compress, publish, getPublic, manual, get token() { return token; }, get demo() { return demo; } };
})();
