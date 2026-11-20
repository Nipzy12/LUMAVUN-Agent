'use strict';
/* Independent LUMAVUN Desktop UI. No OpenAI branding or undocumented endpoints. */
(function () {
  const $ = id => document.getElementById(id);
  const q = selector => document.querySelector(selector);
  const qa = selector => Array.from(document.querySelectorAll(selector));
  const api = window.lumavun;
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const time = value => new Date(value || Date.now()).toLocaleString('id-ID', {dateStyle:'medium', timeStyle:'short'});
  const uid = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const first = value => (String(value || 'L').trim()[0] || 'L').toUpperCase();
  const title = text => String(text || 'Chat baru').replace(/\s+/g,' ').slice(0, 60) || 'Chat baru';
  const defaultProvider = kind => kind === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  let db, hasApiKey = false, page = 'chat', selectedSettings = 'general', catalogue = [];
  let popoverAnchor = null, pendingAttachment = null, isSending = false, activeRequestId = '';
  let thoughtMode = false, temporaryMode = false, temporaryMessages = [], voiceRecognizer = null;
  let sidebarOpen = true, toastTimer, saveChain = Promise.resolve();

  function toast(message) {
    $('toast').textContent = String(message);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {$('toast').hidden = true;}, 4500);
  }
  function save() {
    const snapshot = JSON.parse(JSON.stringify(db));
    saveChain = saveChain.then(() => api.save(snapshot)).catch(e => toast('Penyimpanan gagal: ' + e.message));
    return saveChain;
  }
  function theme() {
    const pref = db.preferences.theme || 'system';
    const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.dataset.theme = dark ? 'dark' : 'light';
    const color = /^#[0-9a-f]{6}$/i.test(db.preferences.accent || '') ? db.preferences.accent : '#7161cf';
    document.documentElement.style.setProperty('--accent', color);
  }
  function activeChat() {return db.chats.find(c => c.id === db.selectedChatId) || null;}
  function messages() {return temporaryMode ? temporaryMessages : (activeChat()?.messages || []);}
  function navigate(where) {
    page = where;
    closePopover();
    $('searchModal').hidden = true;
    if (window.innerWidth <= 850) closeSidebar();
    render();
  }
  function openChat(id) {
    const chat = db.chats.find(c => c.id === id);
    if (!chat) return;
    temporaryMode = false; temporaryMessages = [];
    db.selectedChatId = id;
    db.selectedProjectId = chat.projectId || null;
    page = chat.mode === 'work' ? 'work' : 'chat';
    save(); render();
    $('pageArea').scrollTop = $('pageArea').scrollHeight;
  }
  function newChat(mode) {
    if (isSending) {toast('Hentikan respons sebelum memulai chat lain');return;}
    temporaryMode = false;temporaryMessages = [];
    db.selectedChatId = null;
    db.selectedProjectId = null;
    pendingAttachment = null;
    $('promptInput').value = '';
    page = mode || 'chat';
    save();render();$('promptInput').focus();
  }
  function createProject(name) {
    const clean = String(name || '').trim().slice(0, 70);
    if (!clean) return toast('Nama proyek belum diisi');
    db.projects.unshift({id: uid('project'), name: clean, createdAt: Date.now()});
    save();render();toast('Proyek dibuat: ' + clean);
  }
  function projectPopup(anchor) {
    showPopover(anchor,
      '<div class="popover-title">PROYEK BARU</div>' +
      '<div style="padding:8px"><input id="newProjectName" class="page-input" placeholder="Nama proyek" maxlength="70" aria-label="Nama proyek">' +
      '<button class="primary-button" data-action="create-project" style="width:100%;margin-top:10px">Buat proyek</button></div>');
    setTimeout(() => $('newProjectName')?.focus(), 20);
  }
  function renderSidebar() {
    $('accountName').textContent = db.preferences.name || 'Pengguna';
    $('avatar').textContent = first(db.preferences.name);
    const projectList = $('projectList');
    projectList.innerHTML = db.projects.length ? db.projects.map(p =>
      '<button class="sidebar-item ' + (db.selectedProjectId === p.id ? 'active' : '') +
      '" data-project-id="' + escapeHtml(p.id) + '" title="' + escapeHtml(p.name) + '"><span>▢</span><span class="item-text">' +
      escapeHtml(p.name) + '</span><span class="more">›</span></button>').join('') :
      '<div class="empty-side">Buat proyek untuk mengelompokkan chat.</div>';
    const chats = db.chats.slice().sort((a,b) => (b.updatedAt || 0)-(a.updatedAt || 0)).slice(0, 45);
    $('chatList').innerHTML = chats.length ? chats.map(c =>
      '<button class="sidebar-item ' + (db.selectedChatId === c.id ? 'active' : '') +
      '" data-chat-id="' + escapeHtml(c.id) + '" title="' + escapeHtml(c.title) +
      '"><span class="item-text">' + escapeHtml(c.title) + '</span><span class="more">•••</span></button>').join('') :
      '<div class="empty-side">Percakapan tersimpan muncul di sini.</div>';
    qa('.sidebar-link[data-page]').forEach(el => el.classList.toggle('active',el.dataset.page === page));
  }
  function formatMessage(text) {
    const source = String(text || '');
    const pieces = source.split(/(\x60\x60\x60[\s\S]*?\x60\x60\x60)/g);
    return pieces.map(part => {
      if (part.startsWith('\x60\x60\x60')) {
        const code = part.replace(/^\x60\x60\x60[^\n]*\n?/, '').replace(/\x60\x60\x60$/, '');
        return '<pre>' + escapeHtml(code) + '</pre>';
      }
      return part.split(/\n\n+/).map(p => '<p>' + escapeHtml(p) + '</p>').join('');
    }).join('');
  }
  function renderMessages() {
    const all = messages();
    $('messages').innerHTML = all.map(m => {
      const user = m.role === 'user';
      const saved = !temporaryMode && !!activeChat();
      return '<article class="message ' + (user ? 'user' : 'assistant') + '">' +
        (!user ? '<div class="message-avatar">✦</div>' : '') +
        '<div class="message-body">' + (!user ? '<div class="message-label">LUMAVUN</div>' : '') +
        '<div class="message-content">' + formatMessage(m.text) +
        (m.attachment?.kind === 'image' ? '<img alt="Lampiran gambar" src="' + escapeHtml(m.attachment.content) + '">' : '') +
        (m.attachment?.kind === 'text' ? '<p style="color:var(--muted);font-size:11px">Lampiran: ' + escapeHtml(m.attachment.name) + '</p>' : '') +
        '</div><div class="message-actions">' +
        '<button data-action="copy-message" data-message-id="' + escapeHtml(m.id) + '">⧉ Salin</button>' +
        (!user && saved ? '<button data-action="save-artifact" data-message-id="' + escapeHtml(m.id) + '">▤ Simpan ke pustaka</button>' : '') +
        (!user && saved ? '<button data-action="regenerate" title="Ulangi respons terakhir">↻ Ulangi</button>' : '') +
        '<span class="message-time">' + time(m.createdAt) + '</span></div></div></article>';
    }).join('');
    if (isSending) $('messages').insertAdjacentHTML('beforeend', '<article class="message assistant"><div class="message-avatar">✦</div><div class="message-body"><div class="message-label">LUMAVUN</div><div class="pending-dots">•••</div></div></article>');
    requestAnimationFrame(() => {$('pageArea').scrollTop = $('pageArea').scrollHeight;});
  }
  function renderChatPage() {
    const all = messages();
    $('secondaryPage').hidden = true;
    $('composerRegion').hidden = false;
    const hasMessages = all.length > 0 || isSending;
    $('homePage').hidden = hasMessages;
    $('messagesPage').hidden = !hasMessages;
    if (hasMessages) renderMessages();
    $('promptInput').placeholder = page === 'work' ? 'Minta LUMAVUN menulis atau menjelaskan kode...' : 'Tanyakan apa saja ke LUMAVUN';
    $('homeGreeting').textContent = page === 'work' ? 'Apa yang ingin kamu bangun?' :
      'Apa yang ingin kamu buat hari ini?';
    $('suggestions').hidden = db.preferences.suggestions === false;
    const selected = db.projects.find(p => p.id === db.selectedProjectId);
    $('projectChip').hidden = !selected;
    if (selected) $('projectChip').querySelector('span').textContent = selected.name;
    $('sendButton').textContent = isSending ? '■' : '↑';
    $('sendButton').title = isSending ? 'Hentikan permintaan' : 'Kirim pesan';
    $('researchToggle').classList.toggle('selected', thoughtMode);
    $('attachmentPreview').hidden = !pendingAttachment;
    $('attachmentPreview').innerHTML = pendingAttachment ?
      '<div class="attachment-chip"><span>' + escapeHtml(pendingAttachment.name) +
      '</span><button data-action="remove-attachment" aria-label="Hapus lampiran">×</button></div>' : '';
  }
  function pageHeader(heading, subheading, button) {
    return '<header class="page-heading"><div><h1>' + escapeHtml(heading) +
      '</h1><p>' + escapeHtml(subheading) + '</p></div>' + (button || '') + '</header>';
  }
  function renderImages() {
    const gallery = db.images || [];
    $('secondaryPage').innerHTML = pageHeader('Gambar', 'Buat gambar dengan API gambar OpenAI dan simpan secara lokal.') +
      '<div class="image-prompt"><input class="page-input" id="imagePrompt" placeholder="Deskripsikan gambar yang ingin dibuat..." maxlength="4000">' +
      '<button class="primary-button" data-action="generate-image">Buat gambar</button></div>' +
      '<p class="muted" style="font-size:12px;margin:-12px 0 24px">Membutuhkan API key OpenAI dan model gpt-image-1. Provider lain belum mendukung generator ini.</p>' +
      (gallery.length ? '<div class="image-grid">' + gallery.map(img =>
        '<div class="image-card"><img alt="' + escapeHtml(img.prompt) +
        '" data-generated-id="' + escapeHtml(img.id) + '"><div class="image-meta"><strong style="font-size:12px">' +
        escapeHtml(title(img.prompt)) + '</strong><small>' + time(img.createdAt) + '</small></div></div>'
      ).join('') + '</div>' : emptyPage('▧','Belum ada gambar','Gambar yang dihasilkan akan muncul di sini.'));
    qa('img[data-generated-id]').forEach(async element => {
      try {element.src = await api.readImage(element.dataset.generatedId);}
      catch {element.alt = 'Gambar tidak dapat dibuka';}
    });
  }
  function emptyPage(glyph, heading, detail) {
    return '<div class="empty-state"><div class="empty-icon">' + glyph + '</div><h3>' +
      escapeHtml(heading) + '</h3><p>' + escapeHtml(detail) + '</p></div>';
  }
  function renderLibrary() {
    const entries = db.library || [];
    $('secondaryPage').innerHTML = pageHeader('Pustaka', 'Simpan respons atau kode yang penting dan buka kembali kapan saja.') +
      (entries.length ? entries.map(item =>
        '<div class="list-entry"><span>▤</span><div class="list-main"><strong>' + escapeHtml(item.title) +
        '</strong><small>' + time(item.createdAt) + ' · ' + escapeHtml(item.text.slice(0,95)) +
        '</small></div><button data-action="copy-library" data-item-id="' + escapeHtml(item.id) + '">Salin</button>' +
        '<button data-action="delete-library" data-item-id="' + escapeHtml(item.id) + '">Hapus</button></div>').join('')
        : emptyPage('▤','Pustaka masih kosong','Simpan hasil percakapan lewat tombol Simpan ke pustaka.'));
  }
  function renderProjects() {
    $('secondaryPage').innerHTML = pageHeader('Proyek', 'Ruang untuk mengelompokkan percakapan dan pekerjaan.',
      '<button class="primary-button" data-action="new-project">＋ Proyek baru</button>') +
      (db.projects.length ? '<div class="card-grid">' + db.projects.map(p => {
        const count = db.chats.filter(c => c.projectId === p.id).length;
        return '<div class="feature-card"><div class="feature-icon">▢</div><strong>' + escapeHtml(p.name) +
          '</strong><small>' + count + ' percakapan · Dibuat ' + time(p.createdAt) + '</small>' +
          '<div class="control-buttons"><button data-project-id="' + escapeHtml(p.id) +
          '">Buka proyek</button><button data-action="delete-project" data-project-id="' + escapeHtml(p.id) +
          '">Hapus</button></div></div>';
      }).join('') + '</div>' : emptyPage('▢','Buat proyek pertama','Pisahkan topik agar chat lebih rapi dan mudah dicari.'));
  }
  function renderChatsList() {
    $('secondaryPage').innerHTML = pageHeader('Riwayat chat', 'Seluruh percakapan tersimpan di perangkat.',
      '<button class="primary-button" data-action="new-chat">＋ Chat baru</button>') +
      (db.chats.length ? db.chats.slice().sort((a,b) => b.updatedAt - a.updatedAt).map(c =>
        '<div class="list-entry"><span>☷</span><div class="list-main"><strong>' + escapeHtml(c.title) +
        '</strong><small>' + time(c.updatedAt) + ' · ' + c.messages.length +
        ' pesan</small></div><button data-chat-id="' + escapeHtml(c.id) + '">Buka</button>' +
        '<button data-action="delete-chat" data-chat-id="' + escapeHtml(c.id) + '">Hapus</button></div>'
      ).join('') : emptyPage('☷','Belum ada percakapan','Mulai chat dan riwayat akan tersimpan di sini.'));
  }
  function renderIntegrations() {
    $('secondaryPage').innerHTML = pageHeader('Integrasi', 'Sambungkan LUMAVUN dengan model AI yang kamu pilih.') +
      '<div class="card-grid"><button class="feature-card" data-action="provider-settings"><div class="feature-icon">⚡</div>' +
      '<strong>Provider AI</strong><small>OpenAI, OpenRouter, atau endpoint HTTPS OpenAI-compatible. Status: ' +
      (hasApiKey ? 'API key tersimpan' : 'Belum terhubung') + '.</small></button>' +
      '<div class="feature-card"><div class="feature-icon">♧</div><strong>MCP dan plugin</strong>' +
      '<small>Belum tersedia pada build desktop 0.1.0. Gunakan fitur Android untuk konektor MCP yang didukung.</small></div>' +
      '<div class="feature-card"><div class="feature-icon">▤</div><strong>Penyimpanan lokal</strong>' +
      '<small>Riwayat, proyek, dan pengaturan disimpan di profil Windows pengguna.</small></div></div>';
  }
  function render() {
    theme(); renderSidebar();
    const current = db.provider.model ? db.provider.model.split('/').pop() : 'Pilih model';
    $('modelName').textContent = current;
    $('temporaryToggle').classList.toggle('selected',temporaryMode);
    const chatLike = page === 'chat' || page === 'work';
    if (chatLike) renderChatPage();
    else {
      $('homePage').hidden = true; $('messagesPage').hidden = true;
      $('composerRegion').hidden = true; $('secondaryPage').hidden = false;
      if (page === 'images') renderImages();
      else if (page === 'library') renderLibrary();
      else if (page === 'projects') renderProjects();
      else if (page === 'chats') renderChatsList();
      else renderIntegrations();
    }
  }
  function placePopover(anchor) {
    const rect = anchor.getBoundingClientRect();
    const menu = $('popover');
    const height = menu.offsetHeight, width = menu.offsetWidth;
    let left = Math.min(rect.left, innerWidth - width - 14);
    let top = rect.bottom + 5;
    if (top + height > innerHeight - 12) top = Math.max(10, rect.top - height - 6);
    menu.style.left = Math.max(10,left) + 'px';
    menu.style.top = Math.max(10,top) + 'px';
  }
  function showPopover(anchor, html) {
    const menu = $('popover');
    popoverAnchor = anchor;
    menu.innerHTML = html;menu.hidden = false;
    placePopover(anchor);
  }
  function closePopover() {$('popover').hidden = true; popoverAnchor = null;}
  function row(glyph, label, action, sub) {
    return '<button class="menu-row" data-action="' + escapeHtml(action) + '"><span class="menu-icon">' +
      glyph + '</span><span>' + escapeHtml(label) +
      (sub ? '<small>' + escapeHtml(sub) + '</small>' : '') + '</span></button>';
  }
  function accountMenu(anchor) {
    showPopover(anchor,
      '<div class="popover-title">' + escapeHtml(db.preferences.name || 'Pengguna') + ' · Workspace pribadi</div>' +
      '<div class="menu-divider"></div>' +
      row('✦','Personalisasi','account-personalization') +
      row('♙','Profil','account-profile') +
      row('⚙','Pengaturan','account-settings') +
      '<div class="menu-divider"></div>' +
      row('▤','Ekspor data','export-data') +
      row('ⓘ','Tentang LUMAVUN','account-about'));
  }
  function modelMenu(anchor) {
    const items = catalogue.length ? catalogue : (db.provider.model ? [{id:db.provider.model, name:db.provider.model}] : []);
    showPopover(anchor,
      '<div class="popover-title">MODEL AI · ' + escapeHtml(db.provider.kind) + '</div>' +
      (items.length ? items.slice(0,75).map(m =>
        '<button class="menu-row" data-model="' + escapeHtml(m.id) + '">' +
        '<span class="menu-icon">◇</span><span style="overflow:hidden;text-overflow:ellipsis">' +
        escapeHtml(m.name || m.id) + '</span>' + (db.provider.model === m.id ? '<span class="check">✓</span>' : '') +
        '</button>').join('') : '<div class="empty-side">Belum ada model. Sambungkan provider dan sinkronkan daftar model.</div>') +
      '<div class="menu-divider"></div>' + row('⚙','Kelola provider & model','provider-settings') +
      row('↻','Sinkronkan model','sync-models'));
  }
  function attachMenu(anchor) {
    showPopover(anchor, '<div class="popover-title">TAMBAHKAN KE PESAN</div>' +
      row('＋','Foto atau berkas teks','browse-files','PNG, JPG, TXT, JS, JSON, Markdown') +
      row('▢','Pilih proyek','project-menu','Simpan percakapan dalam proyek') +
      row('✧','Pikir mendalam','research-toggle','Menambah instruksi analisis ke model terpilih'));
  }
  function projectMenu(anchor) {
    showPopover(anchor,
      '<div class="popover-title">TAMBAHKAN KE PROYEK</div>' +
      '<button class="menu-row" data-select-project=""><span class="menu-icon">☷</span>Tanpa proyek</button>' +
      db.projects.map(p => '<button class="menu-row" data-select-project="' + escapeHtml(p.id) + '">' +
        '<span class="menu-icon">▢</span>' + escapeHtml(p.name) + '</button>').join('') +
      '<div class="menu-divider"></div>' + row('＋','Proyek baru','new-project'));
  }
  function chatMenu(anchor, id) {
    showPopover(anchor, '<div class="popover-title">KELOLA PERCAKAPAN</div>' +
      '<button class="menu-row" data-action="rename-chat" data-chat-id="' + escapeHtml(id) + '">✎ Ubah nama</button>' +
      '<button class="menu-row danger" data-action="delete-chat" data-chat-id="' + escapeHtml(id) + '">⌫ Hapus chat</button>');
  }
  function openSearch() {
    closePopover();
    $('searchModal').hidden = false; $('searchInput').value = '';renderSearch();
    setTimeout(() => $('searchInput').focus(), 30);
  }
  function renderSearch() {
    const query = $('searchInput').value.trim().toLowerCase();
    const chats = db.chats.filter(c => !query || c.title.toLowerCase().includes(query) ||
      c.messages.some(m => m.text?.toLowerCase().includes(query))).slice(0,30);
    const projects = db.projects.filter(p => !query || p.name.toLowerCase().includes(query)).slice(0,15);
    $('searchResults').innerHTML = '<div class="popover-title">PERCAKAPAN</div>' +
      (chats.length ? chats.map(c => '<button class="search-result" data-chat-id="' + escapeHtml(c.id) + '">' +
        escapeHtml(c.title) + '<small>' + time(c.updatedAt) + '</small></button>').join('') :
        '<div class="empty-side">Tidak ada percakapan ditemukan.</div>') +
      '<div class="popover-title">PROYEK</div>' +
      (projects.length ? projects.map(p => '<button class="search-result" data-project-id="' + escapeHtml(p.id) + '">' +
        escapeHtml(p.name) + '<small>Proyek</small></button>').join('') :
        '<div class="empty-side">Tidak ada proyek ditemukan.</div>');
  }
  function openSettings(tab) {
    closePopover();
    selectedSettings = tab || 'general';
    $('settingsModal').hidden = false;
    renderSettings();
  }
  function closeSettings() {$('settingsModal').hidden = true;}
  function settingRow(label, detail, control) {
    return '<div class="setting-row"><div><label>' + escapeHtml(label) + '</label>' +
      (detail ? '<small>' + escapeHtml(detail) + '</small>' : '') + '</div>' +
      '<div class="setting-value">' + control + '</div></div>';
  }
  function selector(key, options, value) {
    return '<select class="form-control" data-pref="' + escapeHtml(key) + '">' +
      options.map(o => '<option value="' + escapeHtml(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') +
      '>' + escapeHtml(o[1]) + '</option>').join('') + '</select>';
  }
  function switcher(key, value) {
    return '<label class="toggle" aria-label="' + escapeHtml(key) + '"><input type="checkbox" data-pref="' +
      escapeHtml(key) + '"' + (value ? ' checked' : '') + '></label>';
  }
  function form(label, id, value, placeholder, type) {
    return '<div class="form-stack"><label for="' + id + '">' + escapeHtml(label) + '</label><input id="' + id +
      '" type="' + (type || 'text') + '" class="form-control" placeholder="' +
      escapeHtml(placeholder || '') + '" value="' + escapeHtml(value || '') + '"></div>';
  }
  function settingsHeading(name, subtitle) {
    return '<h2>' + escapeHtml(name) + '</h2><p class="settings-description">' + escapeHtml(subtitle) + '</p>';
  }
  function renderSettings() {
    qa('#settingsNav .setting-nav-item').forEach(b => b.classList.toggle('active',b.dataset.settings === selectedSettings));
    const mobile = q('.settings-dialog');
    mobile?.classList.add('show-content');
    const panel = $('settingsBody');const p = db.preferences;
    if (selectedSettings === 'profile') {
      panel.innerHTML = settingsHeading('Profil', 'Identitas LUMAVUN di perangkat Windows ini.') +
        form('Nama tampilan','profileName',p.name,'Nama kamu') +
        '<div class="control-buttons"><button class="apply" data-action="save-profile">Simpan profil</button></div>';
    } else if (selectedSettings === 'account') {
      panel.innerHTML = settingsHeading('Akun', 'Aplikasi desktop ini tidak mengakses akun ChatGPT atau token login browser.') +
        '<div class="settings-section">' + settingRow('Jenis akun','Workspace lokal di Windows','<strong>Lokal</strong>') +
        settingRow('Kunci provider','Kunci terenkripsi via Windows DPAPI',hasApiKey ? 'Tersimpan' : 'Belum diatur') +
        settingRow('Sinkronisasi cloud','Tidak ada akun cloud LUMAVUN pada build ini','Tidak aktif') + '</div>';
    } else if (selectedSettings === 'general') {
      panel.innerHTML = settingsHeading('Umum', 'Atur bahasa dan perilaku dasar aplikasi.') +
        '<div class="settings-section">' +
        settingRow('Bahasa jawaban AI','Antarmuka versi ini masih menggunakan Bahasa Indonesia',
          selector('language',[['id','Bahasa Indonesia'],['en','English (AI responses)']],p.language)) +
        settingRow('Tombol untuk kirim','Enter mengirim, Shift+Enter membuat baris baru',
          selector('sendShortcut',[['enter','Enter'],['ctrl','Ctrl+Enter']],p.sendShortcut)) +
        settingRow('Saran prompt beranda','Tampilkan chip saran di beranda',switcher('suggestions',p.suggestions)) + '</div>';
    } else if (selectedSettings === 'appearance') {
      panel.innerHTML = settingsHeading('Tampilan', 'Personalisasi warna dan bentuk antarmuka desktop.') +
        '<div class="settings-section">' +
        settingRow('Mode warna','Ikuti sistem, terang, atau gelap',
          selector('theme',[['system','Sistem'],['light','Terang'],['dark','Gelap']],p.theme)) +
        settingRow('Warna aksen','Tema utama LUMAVUN',
          '<input type="color" data-pref="accent" class="form-control" style="height:43px;padding:4px" value="' +
          escapeHtml(p.accent || '#7161cf') + '">') + '</div>';
    } else if (selectedSettings === 'personalization') {
      const levels = [['low','Rendah'],['normal','Normal'],['high','Tinggi']];
      panel.innerHTML = settingsHeading('Personalisasi', 'Sesuaikan cara LUMAVUN berkomunikasi denganmu.') +
        '<div class="settings-section">' +
        settingRow('Gaya dasar','Instruksi umum ke model AI',
          selector('personality',[['Bawaan','Bawaan'],['Profesional','Profesional'],['Santai','Santai'],['Ringkas','Ringkas'],['Teknis','Teknis']],p.personality)) +
        settingRow('Kehangatan','Seberapa hangat jawaban AI',selector('warmth',levels,p.warmth)) +
        settingRow('Antusiasme','Energi gaya komunikasi',selector('enthusiasm',levels,p.enthusiasm)) +
        settingRow('Emoji','Frekuensi emoji',selector('emoji',levels,p.emoji)) +
        settingRow('Judul dan daftar','Jumlah struktur jawaban',selector('formatting',levels,p.formatting)) +
        settingRow('Aktifkan memori','Memori lokal dimasukkan ke prompt ketika aktif',switcher('memoryEnabled',p.memoryEnabled)) +
        '</div><div class="form-stack"><label>Instruksi khusus</label><textarea id="customInstructions" class="form-control" maxlength="5000" placeholder="Gaya bahasa, preferensi, atau konteks penting...">' +
        escapeHtml(p.customInstructions || '') + '</textarea></div>' +
        '<div class="control-buttons"><button class="apply" data-action="save-instructions">Simpan instruksi khusus</button></div>';
    } else if (selectedSettings === 'memory') {
      const entries = Array.isArray(p.memories) ? p.memories : [];
      panel.innerHTML = settingsHeading('Memori', 'Catatan yang kamu masukkan sendiri. Tersimpan lokal dan bisa dihapus.') +
        '<div class="form-stack"><label>Tambah memori</label><textarea id="memoryInput" class="form-control" placeholder="Contoh: Saya suka jawaban singkat dan teknis." maxlength="500"></textarea></div>' +
        '<div class="control-buttons"><button class="apply" data-action="add-memory">Simpan memori</button></div>' +
        '<div class="settings-section">' + (entries.length ? entries.map((m,i) =>
          settingRow(String(m),'Memori lokal #' + (i+1),'<button class="outline-button" data-action="delete-memory" data-memory-index="' + i + '">Hapus</button>')
        ).join('') : '<div class="empty-side">Belum ada memori tersimpan.</div>') + '</div>';
    } else if (selectedSettings === 'provider') {
      panel.innerHTML = settingsHeading('Provider AI', 'Pilih endpoint kompatibel OpenAI. API key disimpan terenkripsi di Windows, bukan di renderer.') +
        '<div class="form-stack"><label for="providerKind">Jenis provider</label>' +
        '<select class="form-control" id="providerKind"><option value="openai"' + (db.provider.kind === 'openai'?' selected':'') + '>OpenAI</option>' +
        '<option value="openrouter"' + (db.provider.kind === 'openrouter'?' selected':'') + '>OpenRouter</option>' +
        '<option value="custom"' + (db.provider.kind === 'custom'?' selected':'') + '>Custom HTTPS API</option></select></div>' +
        form('Base URL','providerBase',db.provider.baseUrl,'https://api.example.com/v1') +
        form('API key','providerKey','','Kosongkan untuk mempertahankan key sebelumnya','password') +
        form('Model ID','providerModel',db.provider.model,'Pilih dengan sinkronisasi model') +
        '<div class="control-buttons"><button class="apply" data-action="save-provider">Simpan provider</button>' +
        '<button data-action="sync-models">Sinkronkan model</button><button data-action="clear-api-key">Hapus API key</button></div>' +
        '<p class="form-help">Provider cloud dapat mengenakan biaya. Prompt dikirim langsung dari proses utama Electron ke server provider.</p>';
    } else if (selectedSettings === 'integrations') {
      panel.innerHTML = settingsHeading('Integrasi', 'Konektor yang tersedia di edisi desktop ini.') +
        '<div class="settings-section">' + settingRow('Provider AI','Koneksi API kompatibel OpenAI','<button class="outline-button" data-action="provider-settings">Atur provider</button>') +
        settingRow('MCP / Plugin','Belum dibawa dari aplikasi Android ke Windows','Belum tersedia') +
        settingRow('Akses browser eksternal','Belum ada automasi browser desktop','Belum tersedia') + '</div>';
    } else if (selectedSettings === 'data') {
      panel.innerHTML = settingsHeading('Data & Privasi', 'Kelola percakapan dan data yang tersimpan pada perangkat ini.') +
        '<div class="settings-section">' +
        settingRow('Ekspor seluruh data','Simpan chat, proyek, memori, dan metadata sebagai JSON',
          '<button class="outline-button" data-action="export-data">Ekspor JSON</button>') +
        settingRow('Impor data','Ganti data aplikasi menggunakan cadangan JSON',
          '<button class="outline-button" data-action="import-data">Impor JSON</button>') +
        settingRow('Hapus riwayat chat','Tidak memengaruhi proyek atau API key',
          '<button class="outline-button" data-action="clear-chats">Hapus chat</button>') + '</div>' +
        '<p class="form-help">API key tidak diekspor. Berkas gambar yang dibuat tersimpan terpisah dalam folder profil aplikasi.</p>';
    } else {
      panel.innerHTML = settingsHeading('Tentang LUMAVUN', 'Imagine Beyond the Mist.') +
        '<p>LUMAVUN Desktop adalah asisten AI independen yang terinspirasi pola navigasi aplikasi chat modern. Tidak berafiliasi dengan OpenAI.</p>' +
        '<div class="settings-section">' + settingRow('Versi aplikasi','','0.1.0') +
        settingRow('Platform','','Windows x64 · Electron') +
        settingRow('Identitas','', 'LUMAVUN') + '</div>';
    }
  }
  async function syncModels() {
    try {
      toast('Mengambil daftar model provider...');
      catalogue = await api.models();
      toast(catalogue.length + ' model ditemukan');
      if (!$('popover').hidden && popoverAnchor === $('modelTrigger')) modelMenu($('modelTrigger'));
    } catch(e) {toast('Gagal sinkronisasi: ' + e.message);}
  }
  function systemPrompt() {
    const p = db.preferences;
    const pieces = ['You are LUMAVUN, an independent AI assistant for a Windows desktop app. Be truthful, clear, and useful.',
      'Do not claim to be ChatGPT or to have tools that are not available.'];
    pieces.push(p.language === 'en' ? 'Reply in English.' : 'Jawab dalam Bahasa Indonesia sesuai bahasa pengguna.');
    if (p.personality === 'Ringkas') pieces.push('Keep answers very concise.');
    if (p.personality === 'Teknis') pieces.push('Favor clear technical explanations and code when appropriate.');
    if (p.personality === 'Santai') pieces.push('Use a natural, relaxed style.');
    if (p.personality === 'Profesional') pieces.push('Use a polished, professional style.');
    if (p.warmth === 'low') pieces.push('Be matter-of-fact.');
    if (p.warmth === 'high') pieces.push('Use a warmer tone.');
    if (p.enthusiasm === 'high') pieces.push('Be energetic when relevant.');
    if (p.emoji === 'low') pieces.push('Avoid emojis.');
    if (p.emoji === 'high') pieces.push('Emojis may be used sparingly.');
    if (p.formatting === 'high') pieces.push('Prefer descriptive headings and lists for complex answers.');
    if (thoughtMode) pieces.push('Analyze the question carefully, verify your assumptions, and give a reasoned response.');
    if (p.customInstructions?.trim()) pieces.push('User custom instructions:\n' + p.customInstructions.slice(0,4000));
    if (p.memoryEnabled && Array.isArray(p.memories) && p.memories.length)
      pieces.push('User-provided memory:\n' + p.memories.slice(-30).map(m => '- ' + String(m).slice(0,500)).join('\n'));
    return pieces.join('\n');
  }
  function providerMessages(all) {
    return [{role:'system',content:systemPrompt()}].concat(all.slice(-28).map(m => ({
      role:m.role,
      content:m.attachment?.kind === 'image' ?
        [{type:'text',text:m.text || 'Analisis gambar'}, {type:'image_url',image_url:{url:m.attachment.content}}] :
        m.attachment?.kind === 'text' ? m.text + '\n\nLampiran ' + m.attachment.name + ':\n' + m.attachment.content : m.text
    })));
  }
  async function sendMessage() {
    if (isSending) {await api.cancel(activeRequestId);toast('Permintaan dihentikan');return;}
    const text = $('promptInput').value.trim();
    if (!text && !pendingAttachment) return;
    if (!hasApiKey || !db.provider.model) {openSettings('provider');toast('Atur API key dan model sebelum mengirim pesan');return;}
    const msg = {id:uid('message'),role:'user',text:text || 'Analisis lampiran ini',createdAt:Date.now()};
    if (pendingAttachment) msg.attachment = pendingAttachment;
    if (temporaryMode) temporaryMessages.push(msg);
    else {
      let chat = activeChat();
      const wantedMode = page === 'work' ? 'work' : 'chat';
      if (!chat || chat.mode !== wantedMode) {
        chat = {id:uid('chat'),title:title(text || pendingAttachment.name),mode:wantedMode,
          projectId:db.selectedProjectId || null,messages:[],createdAt:Date.now(),updatedAt:Date.now()};
        db.chats.unshift(chat);db.selectedChatId = chat.id;
      }
      chat.messages.push(msg);
      chat.updatedAt = Date.now();
      save();
    }
    $('promptInput').value = '';pendingAttachment = null;
    isSending = true;activeRequestId = uid('request');
    render();
    try {
      const result = await api.chat({requestId:activeRequestId,model:db.provider.model,messages:providerMessages(messages())});
      const assistant = {id:uid('message'),role:'assistant',text:result.text,createdAt:Date.now()};
      if (temporaryMode) temporaryMessages.push(assistant);
      else {
        const chat = activeChat();
        if (chat) {chat.messages.push(assistant);chat.updatedAt=Date.now();save();}
      }
    } catch(e) {
      if (!/abort/i.test(String(e.message))) toast('Provider error: ' + e.message);
    } finally {isSending=false;activeRequestId='';render();}
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const box = document.createElement('textarea');box.value = text;document.body.appendChild(box);
        box.select();document.execCommand('copy');box.remove();
      }
      toast('Disalin ke clipboard');
    } catch {toast('Gagal menyalin. Gunakan Ctrl+C pada teks yang dipilih.');}
  }
  async function fileSelected(file) {
    if (!file) return;
    if (/^image\/(png|jpeg|webp)$/.test(file.type)) {
      if (file.size > 2_000_000) return toast('Gambar maksimal 2 MB agar riwayat lokal tidak terlalu besar');
      const content = await new Promise((resolve,reject) => {
        const reader = new FileReader();reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(Error('Gagal membaca gambar'));reader.readAsDataURL(file);
      });
      pendingAttachment = {kind:'image',name:file.name.slice(0,100),content};
    } else {
      if (file.size > 160_000) return toast('Berkas teks maksimal 160 KB');
      if (!/\.(txt|md|js|ts|tsx|json|py|html|css|csv|log)$/i.test(file.name)) return toast('Tipe berkas belum didukung');
      pendingAttachment = {kind:'text',name:file.name.slice(0,100),content:await file.text()};
    }
    if (page !== 'chat' && page !== 'work') page = 'chat';
    render();toast('Lampiran ditambahkan: ' + file.name);
  }
  async function generateImage() {
    const prompt = $('imagePrompt')?.value.trim();
    if (!prompt) return toast('Isi deskripsi gambar terlebih dahulu');
    if (!hasApiKey || db.provider.kind !== 'openai') {openSettings('provider');return toast('Gambar membutuhkan provider OpenAI');}
    const button = q('[data-action="generate-image"]');button.disabled=true;button.textContent='Membuat…';
    try {
      const result=await api.generateImage({prompt});
      db.images.unshift({id:result.id,prompt,createdAt:Date.now()});
      save();renderImages();toast('Gambar berhasil dibuat');
    } catch(e) {toast('Gagal membuat gambar: ' + e.message);}
    finally {if(button?.isConnected) {button.disabled=false;button.textContent='Buat gambar';}}
  }
  function handleDataAction(el) {
    const action = el.dataset.action;
    const id = el.dataset.chatId || '';
    if (action === 'new-chat') newChat('chat');
    else if (action === 'temporary-chat') {
      if(isSending) return toast('Hentikan respons sebelum mengubah mode chat');
      temporaryMode=!temporaryMode;
      temporaryMessages=[];db.selectedChatId=null;db.selectedProjectId=null;
      page='chat';save();render();
      toast(temporaryMode?'Chat sementara aktif: percakapan tidak disimpan':'Chat sementara dimatikan');
    }
    else if (action === 'home') newChat('chat');
    else if (action === 'toggle-sidebar') toggleSidebar();
    else if (action === 'account-menu') accountMenu(el);
    else if (action === 'account-settings') openSettings('general');
    else if (action === 'account-profile') openSettings('profile');
    else if (action === 'account-personalization') openSettings('personalization');
    else if (action === 'account-about') openSettings('about');
    else if (action === 'model-menu') modelMenu(el);
    else if (action === 'attach-menu') attachMenu(el);
    else if (action === 'project-menu') projectMenu(el);
    else if (action === 'new-project') projectPopup(el);
    else if (action === 'create-project') {createProject($('newProjectName')?.value);closePopover();}
    else if (action === 'search') openSearch();
    else if (action === 'close-search') $('searchModal').hidden=true;
    else if (action === 'research-toggle') {thoughtMode=!thoughtMode;closePopover();render();}
    else if (action === 'browse-files') {closePopover();$('filePicker').click();}
    else if (action === 'remove-attachment') {pendingAttachment=null;render();}
    else if (action === 'send') sendMessage();
    else if (action === 'dictate') dictate();
    else if (action === 'provider-settings') openSettings('provider');
    else if (action === 'sync-models') syncModels();
    else if (action === 'close-settings') closeSettings();
    else if (action === 'settings-back') q('.settings-dialog')?.classList.remove('show-content');
    else if (action === 'save-profile') {
      const v=$('profileName').value.trim();
      if (!v) return toast('Nama tidak boleh kosong');
      db.preferences.name=v.slice(0,60);save();render();renderSettings();toast('Profil disimpan');
    }
    else if (action === 'save-instructions') {
      db.preferences.customInstructions=$('customInstructions').value.slice(0,5000);save();toast('Instruksi khusus disimpan');
    }
    else if (action === 'add-memory') {
      const v=$('memoryInput').value.trim();
      if (!v)return toast('Memori masih kosong');
      db.preferences.memories.push(v.slice(0,500));save();renderSettings();toast('Memori ditambahkan');
    }
    else if (action === 'delete-memory') {
      db.preferences.memories.splice(Number(el.dataset.memoryIndex),1);save();renderSettings();
    }
    else if (action === 'save-provider') saveProvider();
    else if (action === 'clear-api-key') clearApiKey();
    else if (action === 'export-data') api.exportData().then(ok=>{if(ok)toast('Cadangan JSON disimpan');}).catch(e=>toast(e.message));
    else if (action === 'import-data') importData();
    else if (action === 'clear-chats') {
      if (!confirm('Hapus seluruh riwayat chat lokal?'))return;
      db.chats=[];db.selectedChatId=null;save();render();toast('Riwayat chat dihapus');
    }
    else if (action === 'delete-project') {
      if (!confirm('Hapus proyek ini? Chat tidak akan dihapus.'))return;
      db.projects=db.projects.filter(p=>p.id!==el.dataset.projectId);
      db.chats.forEach(c=>{if(c.projectId===el.dataset.projectId)c.projectId=null;});
      if(db.selectedProjectId===el.dataset.projectId)db.selectedProjectId=null;
      save();render();
    }
    else if (action === 'delete-chat') {
      if(!confirm('Hapus percakapan ini secara permanen?'))return;
      db.chats=db.chats.filter(c=>c.id!==id);
      if(db.selectedChatId===id)db.selectedChatId=null;
      closePopover();save();render();
    }
    else if (action === 'rename-chat') {
      showPopover(el,'<div class="popover-title">UBAH JUDUL CHAT</div><div style="padding:8px"><input id="renameInput" class="page-input" placeholder="Judul chat" maxlength="60"><button class="primary-button" data-action="apply-rename" data-chat-id="' + escapeHtml(id) + '" style="width:100%;margin-top:10px">Simpan</button></div>');
      const chat=db.chats.find(c=>c.id===id);$('renameInput').value=chat?.title||'';
    }
    else if (action === 'apply-rename') {
      const chat=db.chats.find(c=>c.id===id);if(chat && $('renameInput').value.trim())chat.title=title($('renameInput').value);
      closePopover();save();render();
    }
    else if (action === 'copy-message') {
      const m=messages().find(m=>m.id===el.dataset.messageId);if(m)copyText(m.text);
    }
    else if (action === 'save-artifact') {
      const m=messages().find(m=>m.id===el.dataset.messageId);
      if(m){db.library=db.library||[];db.library.unshift({id:uid('lib'),title:title(m.text),text:m.text,createdAt:Date.now()});save();toast('Tersimpan di pustaka');}
    }
    else if (action === 'copy-library') {
      const m=db.library?.find(m=>m.id===el.dataset.itemId);if(m)copyText(m.text);
    }
    else if (action === 'delete-library') {
      db.library=(db.library||[]).filter(m=>m.id!==el.dataset.itemId);save();render();
    }
    else if (action === 'regenerate') regenerate();
    else if (action === 'generate-image') generateImage();
    else if (action === 'export-chat') {
      const chat=activeChat();
      if(!chat)return toast('Buka percakapan untuk disalin');
      copyText(chat.messages.map(m=>(m.role==='user'?'Kamu':'LUMAVUN')+':\n'+m.text).join('\n\n'));
    }
  }
  function toggleSidebar() {
    sidebarOpen=!sidebarOpen;
    if(innerWidth <= 850) $('app').classList.toggle('mobile-sidebar-open',sidebarOpen);
    else $('app').classList.toggle('sidebar-closed',!sidebarOpen);
  }
  async function saveProvider() {
    try {
      const result=await api.saveProvider({
        kind:$('providerKind').value,baseUrl:$('providerBase').value,
        model:$('providerModel').value,apiKey:$('providerKey').value
      });
      db.provider=result.provider;hasApiKey=result.hasApiKey;await save();
      renderSettings();render();toast('Provider tersimpan. Sinkronkan model jika diperlukan.');
    }catch(e){toast('Gagal menyimpan provider: '+e.message);}
  }
  async function clearApiKey() {
    if (!confirm('Hapus API key tersimpan dari Windows?'))return;
    try {
      const result=await api.saveProvider({...db.provider,apiKey:null});
      db.provider=result.provider;hasApiKey=false;await save();renderSettings();toast('API key dihapus');
    }catch(e){toast(e.message);}
  }
  async function importData() {
    if (!confirm('Impor akan mengganti semua chat, proyek, dan pengaturan lokal. Lanjutkan?'))return;
    try{
      const result=await api.importData();
      if(!result)return;
      db=result;hasApiKey=!!db.hasApiKey;delete db.hasApiKey;
      temporaryMode=false;pendingAttachment=null;closeSettings();newChat();toast('Cadangan berhasil diimpor');
    }catch(e){toast('Impor gagal: '+e.message);}
  }
  async function regenerate() {
    if(isSending || temporaryMode)return;
    const chat=activeChat();
    if(!chat?.messages.length)return;
    if(chat.messages[chat.messages.length-1].role === 'assistant') {
      chat.messages.pop();save();render();
      $('promptInput').value='Lanjutkan dan perbaiki jawaban sebelumnya.';
      await sendMessage();
    }
  }
  function dictate() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) return toast('Dikte suara tidak tersedia di Chromium/Electron ini. Gunakan fitur Windows Voice Typing (Win + H).');
    if (voiceRecognizer) {voiceRecognizer.stop();voiceRecognizer=null;return;}
    try {
      voiceRecognizer=new Speech();
      voiceRecognizer.lang=db.preferences.language==='en'?'en-US':'id-ID';
      voiceRecognizer.onresult=event=>{$('promptInput').value+=event.results[0][0].transcript;};
      voiceRecognizer.onerror=()=>toast('Dikte gagal. Coba Windows Voice Typing (Win + H).');
      voiceRecognizer.onend=()=>{voiceRecognizer=null;};
      voiceRecognizer.start();
      toast('Mendengarkan…');
    } catch(e) {toast('Tidak dapat memulai mikrofon: '+e.message);}
  }
  function bind() {
    document.addEventListener('click', event => {
      const el = event.target.closest('[data-action],[data-chat-id],[data-project-id],[data-page],[data-settings],[data-model],[data-select-project],[data-suggestion]');
      if (!el) {
        if (!event.target.closest('#popover'))closePopover();
        if (event.target.id==='searchModal') $('searchModal').hidden=true;
        if (event.target.id==='settingsModal')closeSettings();
        return;
      }
      if (el.dataset.action) handleDataAction(el);
      else if (el.dataset.chatId) {closePopover();$('searchModal').hidden=true;openChat(el.dataset.chatId);}
      else if (el.dataset.projectId) {
        closePopover();$('searchModal').hidden=true;
        db.selectedProjectId=el.dataset.projectId;db.selectedChatId=null;
        const chat=db.chats.find(c=>c.projectId===db.selectedProjectId);
        if(chat)openChat(chat.id);else {page='chat';save();render();}
      }
      else if (el.dataset.page)navigate(el.dataset.page);
      else if (el.dataset.settings) {
        selectedSettings=el.dataset.settings;
        renderSettings();
      }
      else if (el.dataset.model) {
        db.provider.model=el.dataset.model;save();closePopover();render();
        toast('Model terpilih: '+db.provider.model);
      }
      else if (el.hasAttribute('data-select-project')) {
        db.selectedProjectId=el.dataset.selectProject||null;
        const chat=activeChat();if(chat)chat.projectId=db.selectedProjectId;
        save();closePopover();render();
      }
      else if (el.dataset.suggestion) {
        $('promptInput').value=el.dataset.suggestion;$('promptInput').focus();
      }
    });
    $('searchInput').addEventListener('input',renderSearch);
    $('settingsSearch').addEventListener('input',event=>{
      const term=event.target.value.toLowerCase().trim();
      qa('#settingsNav .setting-nav-item').forEach(x=>x.hidden=!!term&&!x.textContent.toLowerCase().includes(term));
      qa('.settings-nav-heading').forEach(x=>x.hidden=!!term);
    });
    document.addEventListener('change', e=>{
      const el=e.target;
      if(el.dataset.pref){
        const pref=el.dataset.pref;
        if (Object.prototype.hasOwnProperty.call(db.preferences,pref)) {
          db.preferences[pref]=el.type==='checkbox'?el.checked:el.value;
          save();if(pref==='theme'||pref==='accent')theme();
          if(pref==='suggestions')render();
        }
      }
      if(el.id==='providerKind')$('providerBase').value=defaultProvider(el.value);
    });
    $('filePicker').addEventListener('change',async e=>{
      try{await fileSelected(e.target.files[0]);}
      catch(err){toast('Gagal memproses file: '+err.message);}
      e.target.value='';
    });
    $('promptInput').addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing) {
        const mode=db.preferences.sendShortcut||'enter';
        if((mode==='enter'&&!e.ctrlKey)||(mode==='ctrl'&&e.ctrlKey)) {
          e.preventDefault();sendMessage();
        }
      }
    });
    $('newProjectName')?.addEventListener('keydown',e=>{if(e.key==='Enter')createProject(e.target.value);});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){
        closePopover();$('searchModal').hidden=true;closeSettings();
        if(innerWidth<=850) closeSidebar();
      }
      if(e.ctrlKey&&!e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();}
      if(e.ctrlKey&&!e.shiftKey&&e.key.toLowerCase()==='n'){e.preventDefault();newChat();}
    });
    const resize=$('sidebarResize');
    resize.addEventListener('pointerdown',e=>{
      if(innerWidth<=850)return;
      e.preventDefault();resize.setPointerCapture(e.pointerId);
      const move=ev=>{
        const width=Math.min(400,Math.max(210,ev.clientX));
        document.documentElement.style.setProperty('--sidebar-width',width+'px');
      };
      const stop=()=>{resize.removeEventListener('pointermove',move);resize.removeEventListener('pointerup',stop);};
      resize.addEventListener('pointermove',move);resize.addEventListener('pointerup',stop);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(db.preferences.theme==='system')theme();});
  }
  function closeSidebar() {sidebarOpen=false;$('app').classList.remove('mobile-sidebar-open');}
  async function initialize() {
    try {
      db=await api.load();
      hasApiKey=!!db.hasApiKey;delete db.hasApiKey;
      if (!Array.isArray(db.library))db.library=[];
      if (!Array.isArray(db.images))db.images=[];
      if (!Array.isArray(db.preferences.memories))db.preferences.memories=[];
      bind();render();
    }catch(e){
      document.body.innerHTML='<div style="padding:40px;font:16px Segoe UI">LUMAVUN gagal membuka penyimpanan lokal: '+
        escapeHtml(e.message)+'</div>';
    }
  }
  initialize();
})();
