/* Luma Office MVP frontend. No framework, no CDN, no browser-stored secrets. */
'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  view: 'chat', token: '', selectedTask: null, busy: false,
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
  const toast = $('toast');
  toast.textContent = message;
  toast.style.background = error ? '#934d55' : '#282931';
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
}
function apiErrorBody(data) {
  if (typeof data?.detail === 'string') return data.detail;
  if (Array.isArray(data?.detail)) return 'Data belum valid. Periksa kolom yang diisi.';
  return 'Permintaan tidak berhasil.';
}
async function api(method, path, body) {
  const headers = { 'Accept': 'application/json' };
  if (method !== 'GET') {
    if (!state.token) {
      $('tokenDialog').showModal();
      throw new Error('Sambungkan owner token terlebih dahulu.');
    }
    headers['X-Luma-Owner-Token'] = state.token;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method, headers, credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (_) {
    throw new Error('Tidak dapat menghubungi server. Pastikan Uvicorn berjalan.');
  }
  let data;
  try { data = await response.json(); } catch (_) { data = {}; }
  if (!response.ok) {
    if (response.status === 401) showToast('Owner token salah. Periksa konfigurasi .env.', true);
    throw new Error(`${response.status}: ${apiErrorBody(data)}`);
  }
  return data;
}
async function withAction(action, successMessage = '') {
  if (state.busy) return;
  state.busy = true;
  renderAll();
  try {
    await action();
    if (successMessage) showToast(successMessage);
    await refreshAll();
  } catch (error) {
    showToast(error.message || 'Aksi gagal.', true);
  } finally {
    state.busy = false;
    renderAll();
  }
}
function switchView(view) {
  state.view = view;
  for (const name of ['chat', 'work']) {
    $(name + 'View').classList.toggle('active', name === view);
    const tab = $('tab' + name[0].toUpperCase() + name.slice(1));
    tab.classList.toggle('active', name === view);
    tab.setAttribute('aria-selected', String(name === view));
    $('side' + name[0].toUpperCase() + name.slice(1)).classList.toggle('active', name === view);
  }
  $('sidebar').classList.remove('open');
  if (view === 'work') refreshAll();
}
function statusChip(status) {
  const label = { assigned: 'Assigned', pending: 'Pending', in_progress: 'Running',
    completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
    active: 'Active', idle: 'Idle' }[status] || status || 'Unknown';
  return element('span', 'chip ' + (status || ''), label);
}
function button(text, action, primary = false, negative = false) {
  const btn = element('button', 'mini-btn' + (primary ? ' primary' : '') + (negative ? ' negative' : ''), text);
  btn.type = 'button'; btn.disabled = state.busy;
  btn.addEventListener('click', action);
  return btn;
}
function newestApproval(taskId) {
  return [...state.approvals].filter((a) => a.action === 'execute_task' && a.target_type === 'task' && a.target_id === taskId)
    .sort((a, b) => b.id - a.id)[0];
}
function renderHistory() {
  const list = $('historyList'); empty(list);
  if (!state.tasks.length) { append(list, element('div', 'muted-small', 'Belum ada riwayat tugas.')); return; }
  const tasks = [...state.tasks].sort((a, b) => b.id - a.id).slice(0, 50);
  for (const task of tasks) {
    const item = element('button', 'history-item' + (state.selectedTask === task.id ? ' selected' : ''));
    append(item, element('span', '', task.title), element('span', 'history-status', `#${task.id} · ${task.status}`));
    item.title = task.title;
    item.addEventListener('click', () => { state.selectedTask = task.id; switchView('chat'); renderAll(); });
    append(list, item);
  }
}
function taskActions(task, root) {
  const approval = newestApproval(task.id);
  const controls = element('div', 'task-actions');
  if (task.status === 'pending') {
    append(root, element('p', 'subdued', 'Belum ada worker yang cocok. Buat worker dengan job_type yang sama di Work, lalu buat task baru.'));
  } else if (task.status === 'assigned') {
    if (!approval || approval.status === 'denied' || approval.status === 'cancelled') {
      append(controls, button('1. Minta approval', () => requestApproval(task.id), true));
    } else if (approval.status === 'pending') {
      append(root, element('p', 'subdued', `Approval #${approval.id} menunggu keputusan owner.`));
      append(controls,
        button('2. Setujui', () => approveTask(approval.id), true),
        button('Tolak', () => denyTask(approval.id), false, true));
    } else if (approval.status === 'approved') {
      append(controls, button('3. Jalankan dengan AI', () => executeAssignedTask(task.id, approval.id), true));
      append(root, element('p', 'subdued', 'Menjalankan akan memanggil provider AI dan dapat menimbulkan biaya.'));
    }
  } else if (task.status === 'in_progress') {
    append(root, element('p', 'subdued', 'AI sedang memproses task. Proses bisa memerlukan waktu sesuai provider.'));
    append(controls, button('Segarkan status', () => refreshAll()),
      button('Batalkan task', () => cancelTask(task.id), false, true));
  } else if (task.status === 'failed') {
    append(root, element('p', 'subdued', 'Task gagal. Untuk mencoba lagi, buat task baru dengan persetujuan baru.'));
  }
  if (controls.childNodes.length) append(root, controls);
}
function renderChat() {
  const task = state.tasks.find((t) => t.id === state.selectedTask);
  const welcome = $('chatWelcome'); const thread = $('chatThread');
  if (!task) { welcome.hidden = false; thread.hidden = true; return; }
  welcome.hidden = true; thread.hidden = false; empty(thread);
  const userMsg = element('div', 'message user');
  append(userMsg, element('div', 'user-bubble', task.description || task.title));
  const systemMsg = element('div', 'message luma');
  append(systemMsg, element('div', 'luma-avatar', 'L'));
  const bubble = element('div', 'luma-bubble');
  append(bubble, element('strong', '', 'Luma Office'));
  const meta = element('div', 'task-meta');
  append(meta, element('span', 'chip', `Task #${task.id}`), statusChip(task.status));
  if (task.assignee_name) append(meta, element('span', 'chip', `↗ ${task.assignee_name}`));
  append(bubble, meta);
  if (task.status === 'completed' && task.result) {
    append(bubble, element('p', '', 'Tugas selesai. Berikut hasil AI yang tersimpan:'), element('div', 'result', task.result));
  } else if (task.status === 'failed') {
    append(bubble, element('p', '', 'Eksekusi gagal.'), element('div', 'result', task.error || 'Provider gagal memproses task.'));
  } else {
    append(bubble, element('p', '', task.status === 'assigned' ? 'Task sudah diarahkan ke worker. Ikuti langkah approval di bawah sebelum AI berjalan.' : `Status terakhir: ${task.status}.`));
  }
  taskActions(task, bubble);
  append(systemMsg, bubble); append(thread, userMsg, systemMsg);
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
    append(row, content, button('Lihat', () => { state.selectedTask = task.id; switchView('chat'); renderAll(); })); append(taskPanel, row);
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
  renderHistory(); renderChat(); renderWork();
  $('sendBtn').disabled = state.busy;
  $('createAgentSubmit').disabled = state.busy;
  $('connectBtn')?.setAttribute('aria-label', state.token ? 'Owner token tersambung' : 'Sambungkan owner token');
}
async function refreshAll() {
  const keys = [
    ['agents', '/api/agents?limit=500'], ['departments', '/api/departments?limit=500'],
    ['tasks', '/api/tasks?limit=500'], ['approvals', '/api/approval-requests?limit=500'],
    ['audit', '/api/audit-events?limit=30'],
  ];
  const results = await Promise.allSettled(keys.map(([, url]) => api('GET', url)));
  results.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') state[keys[i][0]] = outcome.value.items || [];
  });
  renderAll();
  if (results.some((r) => r.status === 'rejected')) showToast('Sebagian data gagal dimuat. Periksa apakah server berjalan.', true);
}
async function refreshHealth() {
  const dot = $('healthDot');
  try {
    await api('GET', '/api/health'); dot.className = 'status-dot online';
    $('healthLabel').textContent = 'Server lokal aktif';
  } catch (_) {
    dot.className = 'status-dot offline'; $('healthLabel').textContent = 'Server tidak tersedia';
  }
}
async function requestApproval(taskId) {
  await withAction(async () => {
    await api('POST', '/api/approval-requests', { action: 'execute_task', target_type: 'task', target_id: taskId, reason: 'Persetujuan eksekusi melalui Luma Office UI' });
  }, 'Permintaan approval dibuat.');
}
async function approveTask(approvalId) {
  const approval = state.approvals.find((a) => a.id === approvalId);
  if (!window.confirm(`Setujui ${approval?.action || 'aksi'} untuk ${approval?.target_type || 'target'} #${approval?.target_id ?? '—'}?`)) return;
  await withAction(async () => { await api('POST', `/api/approval-requests/${approvalId}/approve`, { note: 'Disetujui melalui Luma Office UI' }); }, 'Approval disetujui.');
}
async function denyTask(approvalId) {
  if (!window.confirm(`Tolak approval #${approvalId}?`)) return;
  await withAction(async () => { await api('POST', `/api/approval-requests/${approvalId}/deny`, { note: 'Ditolak melalui Luma Office UI' }); }, 'Approval ditolak.');
}
async function executeAssignedTask(taskId, approvalId) {
  if (!window.confirm(`Jalankan task #${taskId} dengan AI cloud? Tindakan ini dapat menimbulkan biaya API.`)) return;
  await withAction(async () => {
    showToast('Memproses task menggunakan provider AI…');
    await api('POST', `/api/tasks/${taskId}/execute`, { approval_id: approvalId });
  }, 'Eksekusi selesai. Periksa status dan hasil task.');
}
async function cancelTask(taskId) {
  if (!window.confirm(`Batalkan task #${taskId}? Pemanggilan AI yang sudah berjalan mungkin tetap dikenakan biaya.`)) return;
  await withAction(async () => { await api('PATCH', `/api/tasks/${taskId}`, { status: 'cancelled' }); }, 'Task dibatalkan.');
}
function resetChat() { state.selectedTask = null; switchView('chat'); renderAll(); $('promptInput').focus(); }

$('composerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('promptInput').value.trim(); if (!text || state.busy) return;
  const jobType = $('jobTypeSelect').value;
  await withAction(async () => {
    const task = await api('POST', '/api/tasks', { title: text.slice(0, 180), description: text, job_type: jobType });
    state.selectedTask = task.id;
    $('promptInput').value = '';
    switchView('chat');
  }, 'Task dibuat. Periksa penugasan dan approval.');
});
$('promptInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); $('composerForm').requestSubmit();
  }
});
document.querySelectorAll('[data-prompt]').forEach((btn) => btn.addEventListener('click', () => {
  $('promptInput').value = btn.dataset.prompt; $('promptInput').focus();
}));
document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$('newTaskBtn').addEventListener('click', resetChat);
$('refreshSide').addEventListener('click', refreshAll);
$('workRefresh').addEventListener('click', refreshAll);
$('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('connectBtn').addEventListener('click', () => { $('ownerTokenInput').value = ''; $('tokenDialog').showModal(); });
$('tokenForm').addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'connect') return;
  event.preventDefault();
  const token = $('ownerTokenInput').value.trim();
  if (!token) { showToast('Masukkan owner token terlebih dahulu.', true); return; }
  state.token = token;
  $('ownerTokenInput').value = '';
  $('tokenDialog').close();
  $('connectLabel').textContent = 'Owner tersambung';
  document.querySelector('.connection-mark').classList.add('connected');
  showToast('Token disimpan sementara di tab ini.');
});
$('forgetTokenBtn').addEventListener('click', () => {
  state.token = ''; $('ownerTokenInput').value = '';
  $('connectLabel').textContent = 'Owner token';
  document.querySelector('.connection-mark').classList.remove('connected');
  $('tokenDialog').close(); showToast('Owner token dihapus dari tab.');
});
$('createAgentBtn').addEventListener('click', () => $('agentDialog').showModal());
document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => $(btn.dataset.close).close()));
$('agentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await withAction(async () => {
    const payload = {
      name: $('agentName').value.trim(), job_type: $('agentJob').value,
      skills: $('agentSkills').value.split(',').map((x) => x.trim()).filter(Boolean),
      autonomy_level: 'supervised',
    };
    await api('POST', '/api/agents', payload);
    $('agentDialog').close(); $('agentForm').reset();
  }, 'Worker dibuat. Department dan manager diperbarui.');
});

(async () => { await Promise.all([refreshHealth(), refreshAll()]); })();
