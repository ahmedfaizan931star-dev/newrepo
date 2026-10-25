const safeGet = (key, fallback = null) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value; } catch { return fallback; } };
const safeSet = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
const HOME_TITLE = document.title;
const state = { articles: [], filtered: [], category: 'All', search: '', saved: new Set(JSON.parse(safeGet('offscript-saved', '[]') || '[]')) };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const slugText = (text = '') => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fallbackCovers = { Culture:'/images/cover-culture.svg', Spaces:'/images/cover-spaces.svg', 'At the Table':'/images/cover-table.svg', Style:'/images/cover-style.svg', Elsewhere:'/images/cover-elsewhere.svg', Practice:'/images/cover-practice.svg', People:'/images/cover-people.svg', Ideas:'/images/cover-ideas.svg', Plants:'/images/cover-plants.svg', Beauty:'/images/cover-beauty.svg' };
function fallbackFor(article) { return fallbackCovers[article?.category] || '/images/cover-culture.svg'; }
function responsivePhoto(source, width) { try { const url = new URL(source, location.origin); if (url.hostname === 'images.unsplash.com') { url.searchParams.set('w', String(width)); url.searchParams.set('auto', 'format'); url.searchParams.set('fit', 'crop'); url.searchParams.set('q', '82'); return url.href; } } catch {} return source; }
function photoSrcSet(source) { if (!/^https:\/\/images\.unsplash\.com\//i.test(source || '')) return ''; return `${responsivePhoto(source, 480)} 480w, ${responsivePhoto(source, 800)} 800w, ${responsivePhoto(source, 1400)} 1400w`; }
function bindImageFallbacks(root = document) { $$('img[data-fallback]', root).forEach((img) => { if (img.dataset.fallbackBound) return; img.dataset.fallbackBound = '1'; img.addEventListener('error', () => { const fallback = img.dataset.fallback; if (fallback && !img.src.endsWith(fallback)) { img.removeAttribute('srcset'); img.src = fallback; } }); }); }
function setPhoto(img, article) { if (!img || !article) return; img.dataset.fallback = fallbackFor(article); img.onerror = null; img.onerror = () => { img.onerror = null; img.src = fallbackFor(article); }; img.src = article.image || fallbackFor(article); }

let toastTimer;
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2600); }
function persistSaved() { safeSet('offscript-saved', JSON.stringify([...state.saved])); $('#savedCount').textContent = state.saved.size; }
function categoryChip(category) { return `<span class="category">${escapeHtml(category)}</span>`; }
function card(article, index) {
  const isSaved = state.saved.has(article.slug);
  return `<article class="story-card" style="animation-delay:${Math.min(index, 6) * 45}ms">
    <div class="story-image" data-read="${escapeHtml(article.slug)}" role="button" tabindex="0" aria-label="Read ${escapeHtml(article.title)}"><img loading="lazy" decoding="async" width="1200" height="900" src="${escapeHtml(article.image)}"${photoSrcSet(article.image) ? ` srcset="${escapeHtml(photoSrcSet(article.image))}" sizes="(max-width: 600px) 90vw, (max-width: 1100px) 44vw, 30vw"` : ''} data-fallback="${escapeHtml(fallbackFor(article))}" alt="${escapeHtml(article.title)}"><span class="image-mark">${escapeHtml(article.category)}</span><button class="save-story ${isSaved ? 'saved' : ''}" data-save="${escapeHtml(article.slug)}" aria-label="${isSaved ? 'Remove from' : 'Add to'} reading list">${isSaved ? '✓' : '＋'}</button></div>
    <div class="story-meta">${categoryChip(article.category)}<span>${Number(article.read_time) || 5} MIN READ</span></div>
    <h3><button data-read="${escapeHtml(article.slug)}">${escapeHtml(article.title)}</button></h3><p class="excerpt">${escapeHtml(article.excerpt)}</p>
    <a class="read-link" href="${storyUrl(article.slug)}" data-read="${escapeHtml(article.slug)}">READ THE STORY <span>↗</span></a>
  </article>`;
}
function renderStories() {
  const search = state.search.trim().toLowerCase();
  state.filtered = state.articles.filter((article) => (state.category === 'All' || article.category === state.category) && (!search || `${article.title} ${article.excerpt} ${article.category} ${article.author}`.toLowerCase().includes(search)));
  $('#storiesGrid').innerHTML = state.filtered.length ? state.filtered.map(card).join('') : `<div class="empty-state"><strong>Nothing on that page yet.</strong>Try another department or search for something else.</div>`;
  bindImageFallbacks($('#storiesGrid'));
  $('#resultCount').textContent = `${String(state.filtered.length).padStart(2, '0')} ${state.filtered.length === 1 ? 'STORY' : 'STORIES'}`;
  $$('.filter-chip').forEach((button) => button.classList.toggle('active', button.dataset.category === state.category));
  persistSaved();
}
function renderSearchResults(query) {
  const results = state.articles.filter((article) => `${article.title} ${article.excerpt} ${article.category}`.toLowerCase().includes(query.toLowerCase())).slice(0, 7);
  $('#searchResults').innerHTML = query.trim() ? (results.length ? results.map((article) => `<button class="search-result" data-read="${escapeHtml(article.slug)}"><img loading="lazy" decoding="async" src="${escapeHtml(article.image)}" data-fallback="${escapeHtml(fallbackFor(article))}" alt=""><span><small>${escapeHtml(article.category)} · ${article.read_time} MIN</small><strong>${escapeHtml(article.title)}</strong></span><span>↗</span></button>`).join('') : '<p>No stories found. Try a different word.</p>') : '<p>Start with a word, a feeling, or a place.</p>';
  bindImageFallbacks($('#searchResults'));
}
function openOverlay(id) { const el = document.getElementById(id); el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); document.body.classList.add('overlay-lock'); if (id === 'searchOverlay') setTimeout(() => $('#searchInput').focus(), 80); }
function closeOverlay(id) { const el = document.getElementById(id); el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); if (!$('.search-overlay.open') && !$('.reading-overlay.open') && !$('.article-overlay.open')) document.body.classList.remove('overlay-lock'); }
function getArticle(slug) { return state.articles.find((article) => article.slug === slug); }
function storyUrl(slug) { return `/story/${encodeURIComponent(slug)}`; }
function requestedStorySlug() {
  const match = location.pathname.match(/^\/story\/([^/]+)\/?$/i);
  if (match) { try { return decodeURIComponent(match[1]); } catch {} }
  return new URLSearchParams(location.search).get('story');
}
function renderMarkdown(source) {
  const inline = (line) => { let out=escapeHtml(line); out=out.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>'); out=out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'); return out; };
  const lines=String(source||'').replace(/\r/g,'').split('\n');const html=[];let para=[],list='';const flush=()=>{if(para.length){html.push('<p>'+para.map(inline).join('<br>')+'</p>');para=[];}if(list){html.push('</'+list+'>');list='';}};
  for(const raw of lines){const line=raw.trim();if(!line){flush();continue;}const h=line.match(/^(#{1,3})\s+(.+)$/),li=line.match(/^[-*]\s+(.+)$/),ol=line.match(/^\d+\.\s+(.+)$/),q=line.match(/^>\s?(.*)$/);if(h){flush();html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);}else if(li||ol){if(para.length)flush();const tag=li?'ul':'ol';if(list!==tag){if(list)html.push('</'+list+'>');list=tag;html.push('<'+tag+'>');}html.push('<li>'+inline((li||ol)[1])+'</li>');}else if(q){flush();html.push('<blockquote>'+inline(q[1])+'</blockquote>');}else if(/^---+$/.test(line)){flush();html.push('<hr>');}else{if(list){html.push('</'+list+'>');list='';}para.push(line);}}flush();return html.join('');
}

function renderArticle(article) {
  if (!article) return toast('This story could not be found.');
  const coverSrcset = photoSrcSet(article.image);
  const photoCredit = /^https:\/\/images\.unsplash\.com\//i.test(article.image) ? 'Editorial photography via <a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer">Unsplash</a>.' : /^https:\/\/images\.pexels\.com\//i.test(article.image) ? 'Editorial photography via <a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer">Pexels</a>.' : 'Original artwork created for OFFSCRIPT.';
  $('#articleContent').innerHTML = `<span class="article-kicker">${escapeHtml(article.category)} / A NOTE FROM OFFSCRIPT</span><h1>${escapeHtml(article.title)}</h1><p class="article-deck">${escapeHtml(article.excerpt)}</p><div class="article-byline"><span>WORDS BY ${escapeHtml(article.author.toUpperCase())}</span><span>${article.read_time} MIN READ</span><span>OFFSCRIPT JOURNAL</span></div><img class="article-cover" loading="eager" decoding="async" width="1400" height="900" src="${escapeHtml(article.image)}"${coverSrcset ? ` srcset="${escapeHtml(coverSrcset)}" sizes="(max-width: 700px) 100vw, 850px"` : ''} data-fallback="${escapeHtml(fallbackFor(article))}" alt="${escapeHtml(article.title)}"><div class="article-body">${renderMarkdown(article.body)}</div><div class="article-controls"><button data-save="${escapeHtml(article.slug)}">${state.saved.has(article.slug) ? '✓ SAVED TO YOUR STACK' : '＋ SAVE FOR LATER'}</button><button id="shareStory">SHARE THIS STORY ↗</button></div><p class="photo-credit">${photoCredit}</p>`;
  bindImageFallbacks($('#articleContent'));
  document.title = `${article.title} — OFFSCRIPT`;
  document.querySelectorAll('.article-overlay').forEach((el) => { el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); });
  document.body.classList.add('overlay-lock');
  if (location.protocol !== 'file:' && location.pathname !== storyUrl(article.slug)) history.replaceState({}, '', storyUrl(article.slug));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function closeArticle() { closeOverlay('articleOverlay'); document.title = HOME_TITLE; if (location.protocol !== 'file:') history.replaceState({}, '', '/'); }
function renderReadingList() {
  const items = state.articles.filter((article) => state.saved.has(article.slug));
  $('#readingList').innerHTML = items.length ? items.map((article) => `<div class="saved-item"><img loading="lazy" decoding="async" src="${escapeHtml(article.image)}" data-fallback="${escapeHtml(fallbackFor(article))}" alt=""><div><small>${escapeHtml(article.category)} · ${article.read_time} MIN</small><strong>${escapeHtml(article.title)}</strong><a href="${storyUrl(article.slug)}" data-read="${escapeHtml(article.slug)}">READ STORY ↗</a></div><button data-save="${escapeHtml(article.slug)}" aria-label="Remove saved story">×</button></div>`).join('') : '<p class="saved-empty">Your reading stack is empty. Save a story that catches your eye and it will be waiting here when you return.</p>';
}
function toggleSaved(slug) {
  if (!slug) return;
  state.saved.has(slug) ? state.saved.delete(slug) : state.saved.add(slug);
  persistSaved(); renderStories();
  if ($('#readingOverlay').classList.contains('open')) renderReadingList();
  const article = getArticle(slug); if ($('#articleOverlay').classList.contains('open') && article) renderArticle(article);
  toast(state.saved.has(slug) ? 'Saved to your reading stack.' : 'Removed from your reading stack.');
}
async function loadArticles() {
  try {
    const response = await fetch('/api/articles'); if (!response.ok) throw new Error('API unavailable');
    const data = await response.json(); state.articles = data.articles || [];
    const featured = state.articles.find((article) => article.featured) || state.articles[0];
    if (featured) { $('#heroImage').src = '/images/editorial-still-life.webp'; $('#heroImage').alt = 'An original sunlit editorial still life with books, ceramics and leafy branches'; bindImageFallbacks($('#heroImage').parentElement); $('#heroTitle').textContent = featured.title; $('#heroFeature').dataset.read = featured.slug; }
    renderStories();
    const requested = requestedStorySlug(); if (requested) renderArticle(getArticle(requested));
  } catch (error) {
    if (Array.isArray(window.OFFSCRIPT_LOCAL_ARTICLES) && window.OFFSCRIPT_LOCAL_ARTICLES.length) {
      state.articles = window.OFFSCRIPT_LOCAL_ARTICLES.filter((article) => article.published !== false);
      const featured = state.articles.find((article) => article.featured) || state.articles[0];
      if (featured) { $('#heroImage').src = '/images/editorial-still-life.webp'; $('#heroImage').alt = 'An original sunlit editorial still life with books, ceramics and leafy branches'; bindImageFallbacks($('#heroImage').parentElement); $('#heroTitle').textContent = featured.title; $('#heroFeature').dataset.read = featured.slug; }
      renderStories();
      const requested = requestedStorySlug(); if (requested) renderArticle(getArticle(requested));
    } else { $('#storiesGrid').innerHTML = '<div class="empty-state"><strong>We could not reach the journal.</strong>Check that the server is running and refresh this page.</div>'; }
  }
}
async function subscribe(event) {
  event.preventDefault(); const form = event.currentTarget; const button = $('button[type="submit"]', form); const message = $('#newsletterMessage');
  button.disabled = true; message.textContent = 'Adding you to the letter…';
  try {
    const response = await fetch('/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#email').value, company: $('#company')?.value || '' }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not subscribe.');
    message.textContent = data.message; form.reset(); toast(data.message);
  } catch (error) {
    if (window.OFFSCRIPT_OFFLINE_MODE) {
      const email = $('#email').value.trim().toLowerCase();
      const list = JSON.parse(safeGet('offscript-local-subscribers', '[]') || '[]');
      if (list.includes(email)) message.textContent = 'Already saved on this device. This local demo does not send email.';
      else { list.push(email); safeSet('offscript-local-subscribers', JSON.stringify(list)); message.textContent = 'Saved on this device only — no email was sent to a server.'; form.reset(); }
      toast('Saved locally on this device.');
    } else { message.textContent = 'Could not reach the server. Start the backend or check your connection.'; }
  }
  finally { button.disabled = false; }
}
document.addEventListener('click', async (event) => {
  const save = event.target.closest('[data-save]'); if (save) { event.preventDefault(); event.stopPropagation(); toggleSaved(save.dataset.save); return; }
  const read = event.target.closest('[data-read]');
  if (read) { event.preventDefault(); closeOverlay('searchOverlay'); closeOverlay('readingOverlay'); renderArticle(getArticle(read.dataset.read)); return; }
  const close = event.target.closest('[data-close]'); if (close) { closeOverlay(close.dataset.close); return; }
  const dept = event.target.closest('[data-department]'); if (dept) { state.category = dept.dataset.department; state.search = ''; renderStories(); }
  if (event.target.id === 'shareStory') {
    const url = location.href;
    try { if (navigator.share) await navigator.share({ title: document.title, url }); else { await navigator.clipboard.writeText(url); toast('Story link copied.'); } } catch (error) { if (error.name !== 'AbortError') toast('Could not share just now.'); }
  }
});
document.addEventListener('keydown', (event) => {
  const read = event.target.closest?.('[data-read]');
  if (read && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); renderArticle(getArticle(read.dataset.read)); }
  if (event.key === 'Escape') { ['searchOverlay', 'readingOverlay'].forEach(closeOverlay); if ($('#articleOverlay').classList.contains('open')) closeArticle(); }
});
$('#filters').addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (button) { state.category = button.dataset.category; state.search = ''; renderStories(); } });
$('#searchOpen').addEventListener('click', () => openOverlay('searchOverlay'));
$('#searchInline').addEventListener('click', () => openOverlay('searchOverlay'));
$('#menuOpen').addEventListener('click', () => { document.querySelector('.desktop-nav').style.display = document.querySelector('.desktop-nav').style.display === 'flex' ? '' : 'flex'; document.querySelector('.desktop-nav').style.position = 'absolute'; document.querySelector('.desktop-nav').style.top = '66px'; document.querySelector('.desktop-nav').style.right = '20px'; document.querySelector('.desktop-nav').style.padding = '18px'; document.querySelector('.desktop-nav').style.background = 'var(--paper)'; document.querySelector('.desktop-nav').style.border = '1px solid var(--line)'; document.querySelector('.desktop-nav').style.flexDirection = 'column'; });
$('#savedOpen').addEventListener('click', () => { renderReadingList(); openOverlay('readingOverlay'); });
$('#articleClose').addEventListener('click', closeArticle);
$('#searchInput').addEventListener('input', (event) => renderSearchResults(event.target.value));
$('#newsletterForm').addEventListener('submit', subscribe);
$('#resetStories').addEventListener('click', () => { state.category = 'All'; state.search = ''; renderStories(); $('#stories').scrollIntoView({ behavior: 'smooth' }); });
document.addEventListener('click', (event) => { ['searchOverlay', 'readingOverlay'].forEach((id) => { if (event.target.id === id) closeOverlay(id); }); });
persistSaved(); loadArticles();
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.OFFSCRIPT_OFFLINE_MODE) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
