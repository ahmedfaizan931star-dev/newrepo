const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = { articles: [], filtered: [], deleteId: null };
const coverFallbacks = { Culture:'/images/cover-culture.svg', Spaces:'/images/cover-spaces.svg', 'At the Table':'/images/cover-table.svg', Style:'/images/cover-style.svg', Elsewhere:'/images/cover-elsewhere.svg', Practice:'/images/cover-practice.svg', People:'/images/cover-people.svg', Ideas:'/images/cover-ideas.svg', Plants:'/images/cover-plants.svg', Beauty:'/images/cover-beauty.svg' };
function coverFallback(article) { return coverFallbacks[article?.category] || '/images/cover-culture.svg'; }

let toastTimer;

function renderMarkdown(source) {
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const inline = (line) => {
    let out = esc(line);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
    return out;
  };
  const lines = String(source || '').replace(/\r/g,'').split('\n'); const html=[]; let para=[]; let list='';
  const flush=()=>{ if(para.length){html.push('<p>'+para.map(inline).join('<br>')+'</p>');para=[];} if(list){html.push('</'+list+'>');list='';} };
  for(const raw of lines){ const line=raw.trim(); if(!line){flush();continue;} const h=line.match(/^(#{1,3})\s+(.+)$/); const li=line.match(/^[-*]\s+(.+)$/); const ol=line.match(/^\d+\.\s+(.+)$/); const quote=line.match(/^>\s?(.*)$/);
    if(h){flush();const n=h[1].length;html.push(`<h${n}>${inline(h[2])}</h${n}>`);} else if(li||ol){if(para.length)flush();const tag=li?'ul':'ol';if(list!==tag){if(list)html.push('</'+list+'>');list=tag;html.push('<'+tag+'>');}html.push('<li>'+inline((li||ol)[1])+'</li>');} else if(quote){flush();html.push('<blockquote>'+inline(quote[1])+'</blockquote>');} else if(/^---+$/.test(line)){flush();html.push('<hr>');} else {if(list){html.push('</'+list+'>');list='';}para.push(line);}
  } flush(); return html.join('') || '<p>Your formatted story preview appears here as you write.</p>';
}
function updateMarkdownPreview(){ const preview=$('#markdownPreview'); if(preview) preview.innerHTML=renderMarkdown($('#articleBody').value); }
function importMarkdown(file){ if(!file)return; if(file.size > 30000){ message($('#formMessage'),'Markdown files must be 30 KB or smaller.',true); return; } const reader=new FileReader(); reader.onload=()=>{const text=String(reader.result||'');$('#articleBody').value=text;const heading=text.match(/^#\s+(.+)$/m);if(heading&&!$('#articleTitle').value.trim())$('#articleTitle').value=heading[1].trim();updateMarkdownPreview();message($('#formMessage'),'Markdown imported. Check the preview before publishing.');};reader.readAsText(file); }

function message(node, text, isError = false) { node.textContent = text; node.classList.toggle('error', isError); }
function toast(text) { const node = $('#globalMessage'); node.textContent = text; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2700); }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 && url !== '/api/admin/login') showLogin(); throw new Error(data.error || 'The request could not be completed.'); }
  return data;
}
function showLogin() { $('#loginView').hidden = false; $('#studioView').hidden = true; }
function showStudio() { $('#loginView').hidden = true; $('#studioView').hidden = false; }
async function checkSession() { try { await api('/api/admin/me'); showStudio(); await refreshAll(); } catch { showLogin(); } }
async function login(event) {
  event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); const status = $('#loginMessage'); button.disabled = true; message(status, 'Checking your key…');
  try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) }); $('#password').value = ''; showStudio(); await refreshAll(); }
  catch (error) { message(status, error.message, true); }
  finally { button.disabled = false; }
}
async function logout() { try { await api('/api/admin/logout', { method: 'POST' }); } catch {} showLogin(); toast('You are signed out.'); }
async function refreshAll() {
  try { const [stats, articles] = await Promise.all([api('/api/admin/stats'), api('/api/admin/articles')]);
    $('#statArticles').textContent = stats.articles; $('#statPublished').textContent = stats.published; $('#statDrafts').textContent = stats.drafts; $('#statSubscribers').textContent = stats.subscribers;
    state.articles = articles.articles || []; renderList();
  } catch (error) { toast(error.message); }
}
function renderList() {
  const query = $('#folioSearch').value.trim().toLowerCase(); const status = $('#folioStatus').value;
  state.filtered = state.articles.filter((article) => (!query || `${article.title} ${article.category} ${article.author}`.toLowerCase().includes(query)) && (status === 'all' || (status === 'published' ? article.published : !article.published)));
  $('#folioCount').textContent = String(state.filtered.length).padStart(2, '0');
  $('#articleList').querySelectorAll('img[data-fallback]').forEach((img) => { img.onerror = () => { img.onerror = null; img.src = img.dataset.fallback; }; });
  $('#articleList').innerHTML = state.filtered.length ? state.filtered.map((article) => `<article class="folio-item"><img src="${escapeHtml(article.image)}" alt="" loading="lazy" data-fallback="${escapeHtml(coverFallback(article))}"><div class="folio-info"><span class="folio-status ${article.published ? '' : 'draft'}">${article.published ? '● LIVE' : '◌ DRAFT'}${article.featured ? ' · COVER' : ''}</span><strong>${escapeHtml(article.title)}</strong><small>${escapeHtml(article.category)} · ${article.read_time} MIN</small></div><div class="folio-actions"><button data-edit="${article.id}">EDIT ↗</button><button class="delete-story" data-delete="${article.id}">DELETE ×</button></div></article>`).join('') : '<p class="list-loading">No stories match this view.</p>';
}
function resetForm() { $('#articleForm').reset(); $('#articleId').value = ''; $('#articleAuthor').value = 'Offscript Editors'; $('#articleReadTime').value = 5; $('#articlePublished').checked = true; $('#articleFeatured').checked = false; $('#editorTitle').textContent = 'Start a new story.'; $('#saveArticleButton').innerHTML = 'PUBLISH STORY <span>↗</span>'; $('#imagePreview').innerHTML = '<span>Cover preview appears here</span>'; $('#formMessage').textContent = ''; }
function editArticle(id) {
  const article = state.articles.find((item) => Number(item.id) === Number(id)); if (!article) return;
  $('#articleId').value = article.id; $('#articleTitle').value = article.title; $('#articleExcerpt').value = article.excerpt; $('#articleCategory').value = article.category; $('#articleAuthor').value = article.author; $('#articleReadTime').value = article.read_time; $('#articleSlug').value = article.slug; $('#articleImage').value = article.image; $('#articleBody').value = article.body; updateMarkdownPreview(); $('#articleFeatured').checked = Boolean(article.featured); $('#articlePublished').checked = Boolean(article.published); $('#editorTitle').textContent = 'Refine this story.'; $('#saveArticleButton').innerHTML = 'SAVE CHANGES <span>↗</span>'; previewImage(); $('#formMessage').textContent = '';
  if (window.matchMedia('(max-width: 900px)').matches) $('.editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function previewImage() { const src = $('#articleImage').value.trim(); const preview = $('#imagePreview'); preview.innerHTML = ''; if (!src) { preview.innerHTML = '<span>Cover preview appears here</span>'; return; } const local = /^\/images\/[a-z0-9._/-]+\.(svg|png|jpe?g|webp)$/i.test(src) && !src.includes('..'); let remote = null; try { remote = new URL(src, location.origin); } catch {} if (!local && !(remote && remote.protocol === 'https:' && ['images.unsplash.com','images.pexels.com'].includes(remote.hostname))) { preview.textContent = 'Use a bundled image or a secure Unsplash/Pexels image URL.'; return; } const image = new Image(); image.alt = 'Story cover preview'; image.onload = () => { preview.innerHTML = ''; preview.append(image); }; image.onerror = () => { preview.textContent = 'Image could not be loaded. Check the URL.'; }; image.src = src; }
async function saveArticle(event) {
  event.preventDefault(); const button = $('#saveArticleButton'); const id = $('#articleId').value; const data = { title: $('#articleTitle').value, excerpt: $('#articleExcerpt').value, category: $('#articleCategory').value, author: $('#articleAuthor').value, read_time: $('#articleReadTime').value, slug: $('#articleSlug').value, image: $('#articleImage').value, body: $('#articleBody').value, featured: $('#articleFeatured').checked, published: $('#articlePublished').checked };
  button.disabled = true; message($('#formMessage'), 'Saving to the folio…');
  try { await api(id ? `/api/admin/articles/${id}` : '/api/admin/articles', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }); resetForm(); await refreshAll(); toast(id ? 'Story updated.' : 'Story saved to the folio.'); }
  catch (error) { message($('#formMessage'), error.message, true); }
  finally { button.disabled = false; }
}
function requestDelete(id) { state.deleteId = Number(id); const dialog = $('#deleteDialog'); if (typeof dialog.showModal === 'function') dialog.showModal(); else if (confirm('Permanently delete this story?')) deleteArticle(); }
async function deleteArticle() { if (!state.deleteId) return; try { await api(`/api/admin/articles/${state.deleteId}`, { method: 'DELETE' }); if ($('#articleId').value === String(state.deleteId)) resetForm(); $('#deleteDialog').close?.(); state.deleteId = null; await refreshAll(); toast('Story removed from the folio.'); } catch (error) { toast(error.message); } }
async function exportSubscribers() {
  const button = $('#exportSubscribers'); button.disabled = true; message($('#exportMessage'), 'Preparing your reader list…');
  try { const data = await api('/api/admin/subscribers'); const rows = [['email', 'subscribed_at'], ...(data.subscribers || []).map((item) => [item.email, item.created_at])]; const csv = rows.map((row) => row.map((cell) => { let value = String(cell ?? ''); if (/^[\t\r =+\-@]/.test(value)) value = `'${value}`; return `"${value.replace(/"/g, '""')}"`; }).join(',')).join('\r\n'); const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `offscript-readers-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url); message($('#exportMessage'), `${data.subscribers.length} subscriber(s) exported.`); }
  catch (error) { message($('#exportMessage'), error.message, true); }
  finally { button.disabled = false; }
}
$('#loginForm').addEventListener('submit', login); $('#logoutButton').addEventListener('click', logout); $('#articleForm').addEventListener('submit', saveArticle); $('#newStoryButton').addEventListener('click', () => { resetForm(); $('#articleTitle').focus(); }); $('#resetFormButton').addEventListener('click', resetForm); $('#folioSearch').addEventListener('input', renderList); $('#folioStatus').addEventListener('change', renderList); $('#articleBody').addEventListener('input', updateMarkdownPreview); $('#markdownFile').addEventListener('change', (event) => { importMarkdown(event.target.files?.[0]); event.target.value=''; }); $('#articleImage').addEventListener('change', previewImage); $('#articleImage').addEventListener('blur', previewImage); $('#coverPreset').addEventListener('change', () => { if ($('#coverPreset').value) $('#articleImage').value = $('#coverPreset').value; previewImage(); }); $('#exportSubscribers').addEventListener('click', exportSubscribers); $('#cancelDelete').addEventListener('click', () => { state.deleteId = null; $('#deleteDialog').close(); }); $('#confirmDelete').addEventListener('click', deleteArticle);
$('#articleList').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit]'); if (edit) editArticle(edit.dataset.edit); const del = event.target.closest('[data-delete]'); if (del) requestDelete(del.dataset.delete); });
updateMarkdownPreview(); checkSession();
