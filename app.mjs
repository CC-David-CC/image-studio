const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
const maxReferenceBytes = 4 * 1024 * 1024;

function blobOf(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not encode PNG.')), 'image/png'));
}
function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(Error('Could not read PNG.'));
    reader.readAsDataURL(blob);
  });
}

export function mount(host = {}) {
  const doc = host.document ?? document;
  const element = doc.createElement('section');
  element.className = 'window-content image-studio';
  const view = element.attachShadow({mode:'open'});
  view.innerHTML = `
    <link rel="stylesheet" href="${new URL('./style.css', import.meta.url).href}">
    <div class="layout"><aside>
      <h2>Image Studio</h2>
      <label>Prompt<textarea name="prompt" rows="4" maxlength="2000" placeholder="Describe an image or a change to your reference"></textarea></label>
      <fieldset><legend>Reference image</legend>
        <label class="upload">From device<input type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button type="button" data-action="open">From Files</button>
        <button type="button" data-action="clear" disabled>Remove</button>
      </fieldset>
      <div class="pair"><label>Output size<select name="size"><option>512</option><option selected>768</option><option>1024</option></select></label>
      <label>Seed<input name="seed" type="number" min="0" max="2147483647" step="1" placeholder="Random"></label></div>
      <button class="generate" data-action="generate">Generate image</button>
      <p role="status" aria-live="polite"></p>
    </aside><main>
      <div class="preview"><canvas width="768" height="768" hidden aria-label="Image preview"></canvas><span>Image preview</span></div>
      <div class="actions"><select name="layer" aria-label="Preview layer" disabled><option value="result">Generated image</option><option value="source">Reference image</option></select>
      <button data-action="save" disabled>Save PNG to Files</button><button data-action="download" disabled>Download PNG</button></div>
    </main></div>`;
  const find = selector => view.querySelector(selector);
  const action = name => find('[data-action="'+name+'"]');
  const canvas = find('canvas'), chooser = find('[type=file]'), layer = find('[name=layer]');
  const status = find('[role=status]'), storage = host.storage, initialOwner = storage?.signedInSubject?.();
  const session = host.session?.(), events = new AbortController();
  const {signal} = events;
  let source, result, busy = false;
  const online = Boolean(initialOwner && storage?.accountFileContext);
  function live() {
    if (signal.aborted) throw new DOMException('Window closed', 'AbortError');
    if (online && (storage.signedInSubject() !== initialOwner || host.session?.() !== session)) throw Error('Account changed. Reopen Image Studio.');
  }
  async function context() {
    live();
    const ctx = await storage.accountFileContext();
    live();
    if (ctx.owner !== initialOwner || !ctx.valid()) throw Error('Your account session has ended.');
    return ctx;
  }
  function refresh() {
    const shown = layer.value === 'source' ? source : result;
    canvas.hidden = !shown;
    find('.preview span').hidden = Boolean(shown);
    if (shown) {
      canvas.width = shown.width; canvas.height = shown.height;
      canvas.getContext('2d').drawImage(shown, 0, 0);
    }
    action('generate').disabled = busy || !online;
    action('save').disabled = busy || !shown || !online;
    action('download').disabled = busy || !shown;
    action('open').disabled = busy || !online;
    action('clear').disabled = busy || !source;
    chooser.disabled = busy;
    layer.disabled = busy || !(result && source);
  }
  function run(operation) {
    return async () => {
      if (busy) return;
      busy = true; refresh();
      try { live(); await operation(); }
      catch (error) { if (!signal.aborted) status.textContent = error.message; }
      finally { busy = false; if (!signal.aborted) refresh(); }
    };
  }
  async function reference(blob) {
    if (blob.size > 16*1024*1024) throw Error('Choose a reference under 16 MiB.');
    const bitmap = await createImageBitmap(blob);
    try {
      live();
      if (bitmap.width*bitmap.height > 32000000) throw Error('Reference exceeds 32 megapixels.');
      const ratio = Math.min(1, 1024 / Math.max(bitmap.width,bitmap.height));
      const normalized = doc.createElement('canvas');
      normalized.width = Math.max(1,Math.round(bitmap.width*ratio));
      normalized.height = Math.max(1,Math.round(bitmap.height*ratio));
      normalized.getContext('2d').drawImage(bitmap,0,0,normalized.width,normalized.height);
      source = normalized; layer.value = 'source'; status.textContent = 'Reference ready.';
    } finally { bitmap.close(); }
  }
  chooser.addEventListener('change',run(async () => {
    const file = chooser.files[0]; chooser.value = '';
    if (!file) return;
    if (!imageTypes.includes(file.type)) throw Error('Choose a PNG, JPEG or WebP image.');
    await reference(file);
  }),{signal});
  action('open').addEventListener('click', run(async () => {
    const path = await storage.pickAccountFile({extensions:['.png','.jpg','.jpeg','.webp'], signal});
    if (!path) return;
    const ctx = await context(), reply = await ctx.files.read(path.replace(/^\//,''),{signal});
    live(); await reference(reply.data instanceof Blob ? reply.data : new Blob([reply.data]));
  }), {signal});
  action('clear').addEventListener('click',() => { source = null; layer.value = 'result'; refresh(); },{signal});
  layer.addEventListener('change',refresh,{signal});
  action('generate').addEventListener('click',run(async () => {
    const prompt = find('textarea').value.trim();
    if (!prompt) throw Error('Enter a prompt first.');
    const seedInput = find('[name=seed]');
    if (!seedInput.validity.valid) throw Error('Use a whole-number seed between 0 and 2147483647.');
    const seed = seedInput.value === '' ? crypto.getRandomValues(new Uint32Array(1))[0] >>> 1 : Number(seedInput.value);
    let encoded = null;
    if (source) {
      const png = await blobOf(source);
      if (png.size > maxReferenceBytes) throw Error('Reference is too large for editing.');
      encoded = await asBase64(png);
    }
    const ctx = await context();
    status.textContent = 'Rendering…';
    const reply = await ctx.files.request('image-render',{resource:'image-studio',prompt,seed,size:Number(find('[name=size]').value),reference:encoded});
    live();
    if (!ctx.valid() || reply.seed !== seed || typeof reply.png !== 'string' || reply.png.length > 7*1024*1024) throw Error('Invalid render response.');
    const bytes = Uint8Array.from(atob(reply.png),c=>c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    try { live(); } catch (error) { bitmap.close(); throw error; }
    result?.close(); result = bitmap; layer.value = 'result'; status.textContent = 'Rendered with seed '+seed+'.';
  }),{signal});
  action('download').addEventListener('click',run(async()=>{
    const png = await blobOf(canvas); live();
    const a = doc.createElement('a'), url = URL.createObjectURL(png);
    a.href = url; a.download = 'image-studio.png'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }),{signal});
  action('save').addEventListener('click',run(async()=>{
    const folder = await storage.pickAccountFile({foldersOnly:true,signal});
    if (folder == null) return;
    const name = await host.ui.prompt('Name the PNG file',{title:'Save PNG',value:'Image Studio.png',signal});
    if (name == null) return;
    if (!name.trim() || name.startsWith('.') || /[\/\\\x00-\x1f]/.test(name)) throw Error('Choose a valid filename.');
    const path = [folder.replace(/^\/|\/$/g,''),name.trim().replace(/\.png$/i,'')+'.png'].filter(Boolean).join('/');
    const blob = await blobOf(canvas), ctx = await context();
    const saved = await ctx.files.write(path,blob,null,{signal});
    live(); if (!ctx.valid() || !/^[a-f0-9]{64}$/.test(saved?.sha256)) throw Error('Could not confirm the account save.');
    status.textContent = 'Saved '+path+'.';
  }),{signal});
  if (!online) status.textContent = 'Open in a signed-in WebOS window to render or use account Files.';
  refresh();
  function dispose() {events.abort(); result?.close(); source = result = null; canvas.width = canvas.height = 1; element.remove();}
  return {element,dispose};
}
