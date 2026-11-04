/* Luma Office: same-origin APIs, text-only rendering, tab-memory credentials. */
'use strict';
const $ = (id) => document.getElementById(id);
const state = {
  view: 'chat', token: '', authVersion: 0, refreshVersion: 0, selectionVersion: 0,
  selectedTask: null, conversationId: null, conversation: null, messages: [],
  conversations: [], pendingSend: null, restoreJob: true, busy: false, runningTasks: new Set(),
  agents: [], departments: [], tasks: [], approvals: [], audit: [],
};
function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function append(parent, ...nodes) { nodes.forEach((node) => parent.append(node)); return parent; }
function empty(node) { node.replaceChildren(); }
function showToast(message, error = false) {
  const toast = $('toast'); toast.textContent = message; toast.classList.toggle('error', error);
  toast.hidden = false; clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
}
function clearPrivateState() {
  state.authVersion++; state.refreshVersion++; state.selectionVersion++;
  state.selectedTask = null; state.conversationId = null; state.conversation = null;
  state.messages = []; state.conversations = []; state.pendingSend = null;
  state.busy = false; state.runningTasks.clear();
  for (const key of ['agents', 'departments', 'tasks', 'approvals', 'audit']) state[key] = [];
  $('promptInput').value = ''; $('ownerTokenInput').value = '';
}
function disconnect(clearLocation = true) {
  clearPrivateState(); state.token = '';
  if (clearLocation) history.replaceState(null, '', location.pathname);
  $('connectLabel').textContent = 'Owner token';
  document.querySelector('.connection-mark').classList.remove('connected'); renderAll();
}
function requireOwner() {
  if (state.token) return;
  $('tokenDialog').showModal(); throw new Error('Sambungkan owner token terlebih dahulu.');
}
function apiErrorBody(data) {
  if (typeof data?.detail === 'string') return data.detail;
  return 'Permintaan tidak berhasil. Periksa data dan status task.';
}
async function api(method, path, body) {
  const version = state.authVersion;
  if (method !== 'GET' || path.startsWith('/api/conversations')) requireOwner();
  const headers = { 'Accept': 'application/json' };
  if (state.token) headers['X-Luma-Owner-Token'] = state.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {method, headers, credentials: 'same-origin', cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body)});
  } catch (_) { throw new Error('Koneksi terputus. Segarkan untuk memeriksa apakah pesan sudah tersimpan.'); }
  let data; try { data = await response.json(); } catch (_) { data = {}; }
  if (version !== state.authVersion) throw new Error('Sesi owner berubah.');
  if (!response.ok) {
    if (response.status === 401) disconnect(false);
    const error = new Error(`${response.status}: ${apiErrorBody(data)}`);
    error.status = response.status; throw error;
  }
  return data;
}
async function withAction(action, successMessage = '', refresh = true) {
  if (state.busy) return;
  const version = state.authVersion; state.busy = true; renderAll();
  try { await action(); if (successMessage && version === state.authVersion) showToast(successMessage); }
  catch (error) { if (version === state.authVersion) showToast(error.message || 'Aksi gagal.', true); }
  finally {
    if (version === state.authVersion) {
      if (refresh) await refreshAll();
      state.busy = false; renderAll();
    }
  }
}
function switchView(view) {
  state.view = view;
  for (const name of ['chat', 'work']) {
    $(name + 'View').classList.toggle('active', name === view);
    const tab = $('tab' + name[0].toUpperCase() + name.slice(1));
    tab.classList.toggle('active', name === view); tab.setAttribute('aria-selected', String(name === view));
    $('side' + name[0].toUpperCase() + name.slice(1)).classList.toggle('active', name === view);
  }
  $('sidebar').classList.remove('open');
}
function statusChip(status) {
  const label = {assigned: 'Assigned', pending: 'Pending', in_progress: 'Running', completed: 'Completed',
    failed: 'Failed', cancelled: 'Cancelled', active: 'Active', idle: 'Idle'}[status] || status || 'Unknown';
  return element('span', 'chip ' + (status || ''), label);
}
function button(text, action, primary = false, negative = false) {
  const btn = element('button', 'mini-btn' + (primary ? ' primary' : '') + (negative ? ' negative' : ''), text);
  btn.type = 'button'; btn.disabled = state.busy; btn.addEventListener('click', action); return btn;
}
function newestApproval(taskId) {
  return [...state.approvals].filter((a) => a.action === 'execute_task' && a.target_type === 'task' && a.target_id === taskId)
    .sort((a, b) => b.id - a.id)[0];
}
function selectedTask() { return state.tasks.find((t) => t.id === state.selectedTask); }
function activeTask() { return state.conversationId && ['pending', 'assigned', 'in_progress'].includes(selectedTask()?.status); }
function renderHistory() {
  const list = $('historyList'); empty(list);
  if (!state.token) { append(list, element('div', 'muted-small', 'Sambungkan owner untuk melihat percakapan.')); return; }
  if (!state.conversations.length) { append(list, element('div', 'muted-small', 'Belum ada percakapan.')); return; }
  for (const conversation of state.conversations) {
    const item = element('button', 'history-item' + (state.conversationId === conversation.id ? ' selected' : ''));
    item.type = 'button'; item.disabled = state.busy; item.dataset.conversationId = conversation.id;
    append(item, element('span', '', conversation.title), element('span', 'history-status', new Date(conversation.updated_at).toLocaleString()));
    item.addEventListener('click', () => openConversation(conversation.id)); append(list, item);
  }
}
function taskActions(task, root) {
  const controls = element('div', 'task-actions'); const approval = newestApproval(task.id);
  if (state.runningTasks.has(task.id) || task.status === 'in_progress') {
    append(root, element('p', 'subdued', 'Eksekusi sedang berjalan. Hasil disimpan oleh server; membatalkan tidak selalu menghentikan biaya provider.'));
    append(controls, button('Segarkan status', () => refreshAll()));
  } else if (task.status === 'pending') {
    append(root, element('p', 'subdued', 'Belum ada worker yang cocok. Buat worker di Work, batalkan task ini, lalu kirim pesan baru.'));
  } else if (task.status === 'assigned') {
    if (!approval || ['denied', 'cancelled'].includes(approval.status)) {
      append(controls, button('1. Minta approval', () => requestApproval(task.id), true));
    } else if (approval.status === 'pending') {
      append(root, element('p', 'subdued', `Approval #${approval.id} menunggu keputusan owner.`));
      append(controls, button('2. Setujui', () => approveTask(approval.id), true), button('Tolak', () => denyTask(approval.id), false, true));
    } else if (approval.status === 'approved') {
      append(controls, button('3. Jalankan dengan AI', () => executeAssignedTask(task.id, approval.id), true));
    }
  } else if (task.status === 'failed') {
    append(root, element('div', 'result', task.error || 'Eksekusi gagal.'));
    append(root, element('p', 'subdued', 'Kirim pesan baru dengan approval baru untuk mencoba lagi.'));
  }
  if (['pending', 'assigned', 'in_progress'].includes(task.status)) {
    append(controls, button('Batalkan task', () => cancelTask(task.id), false, true));
  }
  if (controls.childNodes.length) append(root, controls);
}
function renderChat() {
  const welcome = $('chatWelcome'); const thread = $('chatThread');
  const task = selectedTask(); const hasThread = Boolean(state.conversationId || task);
  welcome.hidden = hasThread; thread.hidden = !hasThread;
  $('conversationBar').hidden = !state.conversationId;
  $('conversationTitle').textContent = state.conversation?.title || 'Percakapan baru';
  empty(thread);
  if (state.conversationId) {
    if (!state.messages.length) append(thread, element('p', 'subdued', 'Tulis pesan pertama untuk memulai percakapan ini.'));
    for (const message of state.messages) {
      const row = element('div', 'message ' + (message.role === 'user' ? 'user' : 'luma'));
      row.dataset.messageId = message.id; row.dataset.role = message.role;
      if (message.role === 'assistant') append(row, element('div', 'luma-avatar', 'L'));
      const bubble = element('div', message.role === 'user' ? 'user-bubble' : 'luma-bubble');
      append(bubble, element('div', 'result', message.content)); append(row, bubble); append(thread, row);
    }
  } else if (task) {
    // Legacy Work tasks remain readable, without inventing a conversation/history.
    append(thread, element('div', 'user-bubble', task.description || task.title));
    if (task.result) append(thread, element('div', 'result', task.result));
  }
  if (task) {
    const panel = element('div', 'task-panel'); const meta = element('div', 'task-meta');
    append(meta, element('span', 'chip', `Task #${task.id}`), statusChip(task.status));
    if (task.assignee_name) append(meta, element('span', 'chip', task.assignee_name));
    append(panel, meta); taskActions(task, panel); append(thread, panel);
  }
}
function renderWork() {
  $('statAgents').textContent = state.agents.length;
  $('statDepartments').textContent = state.departments.length;
  $('statTasks').textContent = state.tasks.filter((t) => ['pending', 'assigned', 'in_progress'].includes(t.status)).length;
  $('statApprovals').textContent = state.approvals.filter((a) => a.status === 'pending').length;
  const teams = $('teamGrid'); empty(teams);
  if (!state.departments.length) append(teams, element('div', 'empty-card', 'Belum ada departemen. Mulai dengan membuat worker.'));
  for (const dept of state.departments) {
    const card = element('div', 'team-card'); const head = element('div', 'team-header');
    const name = element('div'); append(name, element('h3', '', dept.name), element('span', 'caption', `Departemen #${dept.id}`));
    append(head, element('div', 'team-icon', '▣'), name);
    const people = element('div', 'team-people');
    const deptAgents = state.agents.filter((agent) => agent.department_id === dept.id);
    if (!deptAgents.length) append(people, element('span', 'caption', 'Belum ada agent.'));
    for (const agent of deptAgents) {
      const row = element('div', 'team-person');
      append(row, element('span', '', agent.name), element('span', '', agent.agent_type === 'manager' ? 'Manager' : agent.status));
      append(people, row);
    }
    append(card, head, people); append(teams, card);
  }
  const taskPanel = $('workTasks'); empty(taskPanel);
  if (!state.tasks.length) append(taskPanel, element('div', 'empty-card', 'Belum ada task. Buat dari Chat.'));
  for (const task of [...state.tasks].sort((a, b) => b.id - a.id).slice(0, 8)) {
    const row = element('div', 'work-item'); const content = element('div', 'work-item-content');
    append(content, element('div', 'work-item-title', task.title), element('div', 'work-item-subtitle', `#${task.id} · ${task.assignee_name || 'Belum assigned'} · ${task.status}`));
    append(row, content, button('Lihat', () => openTask(task.id))); append(taskPanel, row);
  }
  const approvals = $('workApprovals'); empty(approvals);
  const pending = state.approvals.filter((a) => a.status === 'pending').sort((a, b) => b.id - a.id);
  if (!pending.length) append(approvals, element('div', 'empty-card', 'Tidak ada approval yang menunggu.'));
  for (const approval of pending.slice(0, 8)) {
    const row = element('div', 'work-item'); const content = element('div', 'work-item-content');
    append(content, element('div', 'work-item-title', `#${approval.id} · ${approval.action}`), element('div', 'work-item-subtitle', `${approval.target_type || '—'} #${approval.target_id ?? '—'}`));
    append(row, content, button('Setujui', () => approveTask(approval.id), true), button('Tolak', () => denyTask(approval.id), false, true));
    append(approvals, row);
  }
  const audit = $('workAudit'); empty(audit);
  if (!state.audit.length) append(audit, element('div', 'empty-card', 'Belum ada aktivitas.'));
  for (const entry of state.audit.slice(0, 7)) {
    const row = element('div', 'work-item'); const content = element('div', 'work-item-content');
    append(content, element('div', 'work-item-title', entry.summary || entry.action),
      element('div', 'work-item-subtitle', `${entry.actor || 'system'} · ${entry.occurred_at || ''}`));
    append(row, content); append(audit, row);
  }
}
function renderAll() {
  const content = $('chatContent'), scrollTop = content.scrollTop;
  const atBottom = content.scrollHeight - scrollTop - content.clientHeight < 48;
  const selection = state.conversationId || state.selectedTask;
  renderHistory(); renderChat(); renderWork();
  content.scrollTop = atBottom || renderAll.selection !== selection ? content.scrollHeight : scrollTop;
  renderAll.selection = selection;
  $('sendBtn').disabled = state.busy || Boolean(activeTask());
  $('promptInput').disabled = state.busy;
  $('jobTypeSelect').disabled = state.busy;
  $('createAgentSubmit').disabled = state.busy;
  $('newTaskBtn').disabled = state.busy;
  $('renameConversationBtn').disabled = state.busy;
  $('composerStatus').textContent = activeTask() ? 'Selesaikan atau batalkan task aktif sebelum mengirim pesan berikutnya.' : 'Maksimal 512 karakter. Setiap pesan memerlukan approval baru.';
  $('connectBtn').setAttribute('aria-label', state.token ? 'Owner token tersambung' : 'Sambungkan owner token');
}
function locationConversation() {
  const id = new URLSearchParams(location.hash.slice(1)).get('conversation');
  return /^[a-f0-9-]{36}$/i.test(id || '') ? id : null;
}
function selectConversation(id) {
  state.selectionVersion++; state.conversationId = id; state.selectedTask = null;
  state.messages = []; state.conversation = null; state.pendingSend = null; state.restoreJob = true; $('promptInput').value = '';
  history.replaceState(null, '', `${location.pathname}#conversation=${encodeURIComponent(id)}`);
  switchView('chat');
}
async function fetchConversation(id) {
  let after = 0; let detail; const messages = new Map();
  do {
    detail = await api('GET', `/api/conversations/${encodeURIComponent(id)}?after_id=${after}&limit=200`);
    for (const message of detail.messages) messages.set(message.id, message);
    if (detail.has_more && detail.next_after_id <= after) throw new Error('Riwayat tidak dapat dilanjutkan.');
    after = detail.next_after_id;
  } while (detail.has_more);
  return {...detail, messages: [...messages.values()].sort((a, b) => a.id - b.id)};
}
async function loadSelectedConversation(refreshVersion) {
  if (!state.conversationId) return;
  const id = state.conversationId, selection = state.selectionVersion, auth = state.authVersion;
  const detail = await fetchConversation(id);
  if (auth !== state.authVersion || selection !== state.selectionVersion || refreshVersion !== state.refreshVersion) return;
  const lastUser = [...detail.messages].reverse().find((m) => m.role === 'user');
  let task = null;
  if (lastUser?.task_id) task = await api('GET', `/api/tasks/${lastUser.task_id}`);
  if (auth !== state.authVersion || selection !== state.selectionVersion || refreshVersion !== state.refreshVersion) return;
  state.conversation = detail; state.messages = detail.messages; state.selectedTask = task?.id || null;
  if (task) {
    state.tasks = [task, ...state.tasks.filter((t) => t.id !== task.id)];
    if (state.restoreJob && [...$('jobTypeSelect').options].some((option) => option.value === task.job_type)) {
      $('jobTypeSelect').value = task.job_type;
    }
    state.restoreJob = false;
  }
  if (state.pendingSend?.conversationId === id && detail.messages.some((m) => m.client_message_id === state.pendingSend.payload.client_message_id)) {
    // Reconcile a POST that reached the server even if its response was lost.
    if ($('promptInput').value.trim() === state.pendingSend.payload.content) $('promptInput').value = '';
    state.pendingSend = null;
  }
}
async function listConversations() {
  const rows = new Map(); let offset = 0; let page;
  do {
    page = await api('GET', `/api/conversations?limit=100&offset=${offset}`);
    for (const row of page.items) rows.set(row.id, row);
    offset += page.items.length;
  } while (page.items.length === 100);
  return [...rows.values()];
}
async function refreshAll() {
  if (!state.token) { renderAll(); return; }
  const auth = state.authVersion, version = ++state.refreshVersion;
  const keys = [['agents', '/api/agents?limit=500'], ['departments', '/api/departments?limit=500'],
    ['tasks', '/api/tasks?limit=500'], ['approvals', '/api/approval-requests?limit=500'], ['audit', '/api/audit-events?limit=30']];
  try {
    const values = await Promise.all([...keys.map(([, url]) => api('GET', url)), listConversations()]);
    if (auth !== state.authVersion || version !== state.refreshVersion) return;
    keys.forEach(([key], index) => { state[key] = values[index].items || []; });
    state.conversations = values[keys.length];
    if (!state.conversationId && !state.selectedTask && locationConversation()) selectConversation(locationConversation());
    await loadSelectedConversation(version);
  } catch (error) {
    if (auth !== state.authVersion || version !== state.refreshVersion) return;
    if (error.status === 404 && state.conversationId) {
      state.conversationId = null; state.conversation = null; state.messages = []; state.selectedTask = null;
      history.replaceState(null, '', location.pathname);
    }
    showToast(error.message || 'Data gagal dimuat.', true);
  }
  if (auth === state.authVersion && version === state.refreshVersion) renderAll();
}
async function openConversation(id) {
  await withAction(async () => { requireOwner(); selectConversation(id); });
}
async function openTask(taskId) {
  await withAction(async () => {
    requireOwner();
    const link = await api('GET', `/api/tasks/${taskId}/conversation`);
    if (link.conversation_id) selectConversation(link.conversation_id);
    else {
      state.selectionVersion++; state.conversationId = null; state.conversation = null; state.messages = [];
      state.selectedTask = taskId; history.replaceState(null, '', location.pathname); switchView('chat');
    }
  });
}
async function refreshHealth() {
  try { await api('GET', '/api/health'); $('healthDot').className = 'status-dot online'; $('healthLabel').textContent = 'Server lokal aktif'; }
  catch (_) { $('healthDot').className = 'status-dot offline'; $('healthLabel').textContent = 'Server tidak tersedia'; }
}
async function requestApproval(taskId) {
  await withAction(() => api('POST', '/api/approval-requests', {action: 'execute_task', target_type: 'task', target_id: taskId,
    reason: 'Persetujuan eksekusi melalui Luma Office UI'}), 'Permintaan approval dibuat.');
}
async function approveTask(approvalId) {
  const approval = state.approvals.find((a) => a.id === approvalId);
  if (!window.confirm(`Setujui ${approval?.action || 'aksi'} untuk task #${approval?.target_id ?? '—'}?`)) return;
  await withAction(() => api('POST', `/api/approval-requests/${approvalId}/approve`, {note: 'Disetujui melalui Luma Office UI'}), 'Approval disetujui.');
}
async function denyTask(approvalId) {
  if (!window.confirm(`Tolak approval #${approvalId}?`)) return;
  await withAction(() => api('POST', `/api/approval-requests/${approvalId}/deny`, {note: 'Ditolak melalui Luma Office UI'}), 'Approval ditolak.');
}
async function executeAssignedTask(taskId, approvalId) {
  if (state.busy || state.runningTasks.has(taskId)) return;
  if (!window.confirm(`Jalankan task #${taskId} dengan AI cloud? Tindakan ini dapat menimbulkan biaya API.`)) return;
  const auth = state.authVersion; state.runningTasks.add(taskId); renderAll();
  // Execution does not block cancellation or navigation. No automatic retries.
  const request = api('POST', `/api/tasks/${taskId}/execute`, {approval_id: approvalId});
  setTimeout(() => { if (auth === state.authVersion) refreshAll(); }, 200);
  try { await request; if (auth === state.authVersion) showToast('Eksekusi selesai. Periksa status dan hasil task.'); }
  catch (error) { if (auth === state.authVersion) showToast(error.message || 'Periksa status sebelum mencoba kembali.', true); }
  finally { if (auth === state.authVersion) { state.runningTasks.delete(taskId); await refreshAll(); } }
}
async function cancelTask(taskId) {
  if (!window.confirm(`Batalkan task #${taskId}? Pemanggilan AI yang sudah berjalan mungkin tetap dikenakan biaya.`)) return;
  await withAction(() => api('PATCH', `/api/tasks/${taskId}`, {status: 'cancelled'}), 'Task dibatalkan.');
}
async function createConversation(title = 'Percakapan baru') {
  const conversation = await api('POST', '/api/conversations', {title});
  selectConversation(conversation.id); return conversation;
}
async function resetChat() {
  await withAction(() => createConversation(), 'Percakapan baru dibuat.'); $('promptInput').focus();
}
function messageId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
$('composerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('promptInput').value.trim(), jobType = $('jobTypeSelect').value;
  if (!text || state.busy || activeTask()) return;
  if ([...text].length > 512) { showToast('Pesan maksimal 512 karakter. Tidak ada teks yang dipotong otomatis.', true); return; }
  await withAction(async () => {
    requireOwner();
    if (!state.conversationId) { await createConversation(text.slice(0, 80)); $('promptInput').value = text; }
    const old = state.pendingSend;
    if (!old || old.conversationId !== state.conversationId || old.payload.content !== text || old.payload.job_type !== jobType) {
      state.pendingSend = {conversationId: state.conversationId, payload: {client_message_id: messageId(), content: text, job_type: jobType}};
    }
    const pending = state.pendingSend;
    await api('POST', `/api/conversations/${pending.conversationId}/messages`, pending.payload);
    state.pendingSend = null; $('promptInput').value = '';
  }, 'Pesan tersimpan. Periksa penugasan dan approval.');
});
$('promptInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composerForm').requestSubmit(); }
});
document.querySelectorAll('[data-prompt]').forEach((btn) => btn.addEventListener('click', () => { $('promptInput').value = btn.dataset.prompt; $('promptInput').focus(); }));
document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => { switchView(btn.dataset.view); refreshAll(); }));
$('newTaskBtn').addEventListener('click', resetChat);
$('renameConversationBtn').addEventListener('click', () => {
  const title = window.prompt('Nama percakapan', state.conversation?.title || '');
  if (title?.trim()) withAction(() => api('PATCH', `/api/conversations/${state.conversationId}`, {title: title.trim()}));
});
$('refreshSide').addEventListener('click', refreshAll);
$('workRefresh').addEventListener('click', refreshAll);
$('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('connectBtn').addEventListener('click', () => { $('ownerTokenInput').value = ''; $('tokenDialog').showModal(); });
$('tokenDialog').addEventListener('close', () => { $('ownerTokenInput').value = ''; });
$('tokenForm').addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'connect') return;
  event.preventDefault(); const token = $('ownerTokenInput').value.trim();
  if (!token) { showToast('Masukkan owner token terlebih dahulu.', true); return; }
  clearPrivateState(); state.token = token; $('tokenDialog').close();
  $('connectLabel').textContent = 'Owner tersambung'; document.querySelector('.connection-mark').classList.add('connected');
  renderAll(); await refreshAll();
  if (state.token) showToast('Token hanya disimpan di memori tab. Sambungkan lagi setelah refresh.');
  else showToast('Owner token tidak valid.', true);
});
$('forgetTokenBtn').addEventListener('click', () => { disconnect(); $('tokenDialog').close(); showToast('Token dan tampilan privat dibersihkan. Eksekusi server yang sudah dimulai dapat tetap berjalan.'); });
$('createAgentBtn').addEventListener('click', () => $('agentDialog').showModal());
document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => $(btn.dataset.close).close()));
$('agentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await withAction(async () => {
    await api('POST', '/api/agents', {name: $('agentName').value.trim(), job_type: $('agentJob').value,
      skills: $('agentSkills').value.split(',').map((x) => x.trim()).filter(Boolean), autonomy_level: 'supervised'});
    $('agentDialog').close(); $('agentForm').reset();
  }, 'Worker dibuat. Department dan manager diperbarui.');
});
window.addEventListener('pagehide', () => disconnect(false));
setInterval(() => { if (state.token && !state.busy && !document.hidden) refreshAll(); }, 5000);
renderAll(); refreshHealth();
