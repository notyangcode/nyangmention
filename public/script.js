const API_URL = '/api';
const socket = io();

// Elements
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const streamerForm = document.getElementById('streamer-form');
const keywordForm = document.getElementById('keyword-form');
const streamerList = document.getElementById('streamer-list');
const keywordList = document.getElementById('keyword-list');
const messageList = document.getElementById('message-list');
const btnRefresh = document.getElementById('btn-refresh');
const btnClearAll = document.getElementById('btn-clear-all');
const paginationContainer = document.getElementById('pagination');
const matchCountBadge = document.getElementById('match-count');
const liveIndicator = document.getElementById('live-indicator');
const toggleSoundBtn = document.getElementById('toggle-sound');
const soundIcon = document.getElementById('sound-icon');
const notifSound = document.getElementById('notif-sound');
const toastContainer = document.getElementById('toast-container');
const settingsForm = document.getElementById('settings-form');
const discordWebhookInput = document.getElementById('discord-webhook');
const btnExport = document.getElementById('btn-export');
const filterStartDate = document.getElementById('filter-start-date');
const filterEndDate = document.getElementById('filter-end-date');
const filterPlatform = document.getElementById('filter-platform');
const filterStreamer = document.getElementById('filter-streamer');
const btnApplyFilters = document.getElementById('btn-apply-filters');
const btnResetFilters = document.getElementById('btn-reset-filters');

// State
let currentPage = 1;
const messageLimit = 15;
let soundEnabled = localStorage.getItem('soundEnabled') === 'true';
let totalMatches = 0;

// Initialize
async function init() {
    updateSoundUI();
    await loadSettings();
    await loadStreamers();
    await loadKeywords();
    await loadMessages();

    // Socket Events
    socket.on('monitor_status', (active) => {
        updateStatusUI(active);
    });

    socket.on('new_match', (data) => {
        handleNewMatch(data);
    });

    socket.on('update_match', (data) => {
        handleUpdateMatch(data);
    });

    socket.on('connect', () => {
        console.log('[Socket] Conectado ao servidor');
    });
}

// Settings
async function loadSettings() {
    try {
        const res = await fetch(`${API_URL}/settings`);
        const data = await res.json();
        if (data.discord_webhook) {
            discordWebhookInput.value = data.discord_webhook;
        }
    } catch (err) {
        console.error('Erro ao carregar configurações:', err);
    }
}

settingsForm.onsubmit = async (e) => {
    e.preventDefault();
    const webhook = discordWebhookInput.value;
    try {
        const res = await fetch(`${API_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord_webhook: webhook })
        });
        if (res.ok) {
            showToast('Configurações salvas!', 'success');
        } else {
            const err = await res.json();
            showToast('Erro: ' + (err.error || 'Falha ao salvar'), 'danger');
        }
    } catch (err) {
        showToast('Erro de conexão!', 'danger');
    }
};

// Export
btnExport.onclick = () => {
    const params = new URLSearchParams();
    if (filterStartDate.value) params.append('startDate', new Date(filterStartDate.value).toISOString());
    if (filterEndDate.value) {
        const end = new Date(filterEndDate.value);
        end.setHours(23, 59, 59, 999);
        params.append('endDate', end.toISOString());
    }
    if (filterPlatform.value) params.append('platform', filterPlatform.value);
    if (filterStreamer.value) params.append('streamer', filterStreamer.value);

    window.location.href = `${API_URL}/export?${params.toString()}`;
};

// UI Updates
function updateStatusUI(active) {
    if (active) {
        statusText.textContent = 'Status: Coletando...';
        statusDot.classList.add('active');
        liveIndicator.style.display = 'block';
        btnStart.disabled = true;
        btnStop.disabled = false;
    } else {
        statusText.textContent = 'Status: Parado';
        statusDot.classList.remove('active');
        liveIndicator.style.display = 'none';
        btnStart.disabled = false;
        btnStop.disabled = true;
    }
}

function updateSoundUI() {
    soundIcon.textContent = soundEnabled ? '🔔' : '🔕';
    localStorage.setItem('soundEnabled', soundEnabled);
}

toggleSoundBtn.onclick = () => {
    soundEnabled = !soundEnabled;
    updateSoundUI();
    showToast('Som ' + (soundEnabled ? 'Ativado' : 'Desativado'), 'info');
};

// Control
btnStart.onclick = async () => {
    try {
        const res = await fetch(`${API_URL}/start`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json();
            showToast('Erro ao iniciar: ' + err.error, 'danger');
        }
    } catch (err) {
        showToast('Erro de conexão ao iniciar!', 'danger');
    }
};

btnStop.onclick = async () => {
    try {
        await fetch(`${API_URL}/stop`, { method: 'POST' });
    } catch (err) { }
};

// Match Handling
function handleNewMatch(data) {
    if (currentPage === 1) {
        const row = createMessageRow(data);
        row.classList.add('new-row');
        messageList.insertBefore(row, messageList.firstChild);

        if (messageList.children.length > messageLimit) {
            messageList.removeChild(messageList.lastChild);
        }
    }

    totalMatches++;
    matchCountBadge.textContent = totalMatches;

    if (soundEnabled) {
        notifSound.currentTime = 0;
        notifSound.play().catch(() => { });
    }

    showToast(`Novo Match: ${data.streamer_name}`, 'success');
}

function handleUpdateMatch(data) {
    const row = document.querySelector(`tr[data-id="${data.id}"]`);
    if (row) {
        // Encontra ou cria o badge de repetição
        const messageCell = row.cells[3]; // Coluna da Mensagem
        let badge = row.querySelector('.repeat-badge');

        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'repeat-badge';
            messageCell.appendChild(badge);
        }
        badge.innerHTML = `🔄 Repetida ${data.repeat_count}x`;

        // Efeito visual de atualização
        row.classList.add('new-row');
        setTimeout(() => row.classList.remove('new-row'), 2000);
    }
}

function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatOffset(seconds) {
    if (seconds === null || seconds === undefined) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function createMessageRow(m) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', m.id);

    const repeatBadge = m.repeat_count > 1
        ? `<div class="repeat-badge">🔄 Repetida ${m.repeat_count}x</div>`
        : '';

    tr.innerHTML = `
        <td>
            <strong>${m.streamer_name}</strong><br>
            <small style="color: var(--text-muted); font-size: 0.7rem;">${m.channel_id || ''}</small>
        </td>
        <td><span class="platform-tag platform-${m.platform.toLowerCase()}">${m.platform}</span></td>
        <td>${m.user_name}</td>
        <td>
            ${m.message}
            ${repeatBadge}
        </td>
        <td style="font-size: 0.8rem; color: #94a3b8">${new Date(m.timestamp).toLocaleString('pt-BR')}</td>
        <td style="font-family: monospace; font-size: 0.85rem;">${formatOffset(m.stream_offset)}</td>
        <td><button class="delete-msg-btn" onclick="deleteChatMessage(${m.id})">🗑️ Remover</button></td>
    `;
    return tr;
}

// Streamers & Keywords
streamerForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('streamer-name').value;
    const platform = document.getElementById('platform').value;
    const channel_id = document.getElementById('channel-id').value;

    try {
        const res = await fetch(`${API_URL}/streamers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, platform, channel_id })
        });

        if (res.ok) {
            streamerForm.reset();
            showToast('Streamer adicionado', 'success');
            loadStreamers();
        } else {
            const err = await res.json();
            showToast('Erro ao adicionar: ' + (err.error || 'Falha no servidor'), 'danger');
        }
    } catch (err) {
        showToast('Erro de conexão ao adicionar streamer', 'danger');
    }
};

async function loadStreamers() {
    try {
        const res = await fetch(`${API_URL}/streamers`);
        const data = await res.json();

        // Lista principal
        streamerList.innerHTML = data.map(s => `
            <div class="list-item">
                <span><strong>${s.name}</strong> (${s.platform})</span>
                <button class="delete-btn" onclick="deleteStreamer(${s.id})">Remover</button>
            </div>
        `).join('');

        // Dropdown de filtro
        const currentFilterValue = filterStreamer.value;
        filterStreamer.innerHTML = '<option value="">Todos</option>' +
            data.map(s => `<option value="${s.name}" ${s.name === currentFilterValue ? 'selected' : ''}>${s.name}</option>`).join('');

    } catch (err) {
        console.error('Erro ao carregar streamers:', err);
    }
}

window.deleteStreamer = async (id) => {
    try {
        const res = await fetch(`${API_URL}/streamers/${id}`, { method: 'DELETE' });
        if (res.ok) loadStreamers();
    } catch (err) { }
};

keywordForm.onsubmit = async (e) => {
    e.preventDefault();
    const keyword = document.getElementById('keyword').value;

    try {
        const res = await fetch(`${API_URL}/keywords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword })
        });

        if (res.ok) {
            keywordForm.reset();
            showToast('Palavra-chave salva', 'success');
            loadKeywords();
        } else {
            const err = await res.json();
            showToast('Erro ao salvar palavra: ' + (err.error || 'Falha'), 'danger');
        }
    } catch (err) {
        showToast('Erro de conexão ao salvar palavra', 'danger');
    }
};

async function loadKeywords() {
    try {
        const res = await fetch(`${API_URL}/keywords`);
        const data = await res.json();
        keywordList.innerHTML = data.map(k => `
            <div class="list-item">
                <span>${k.keyword}</span>
                <button class="delete-btn" onclick="deleteKeyword(${k.id})">Remover</button>
            </div>
        `).join('');
    } catch (err) {
        console.error('Erro ao carregar palavras-chave:', err);
    }
}

window.deleteKeyword = async (id) => {
    try {
        const res = await fetch(`${API_URL}/keywords/${id}`, { method: 'DELETE' });
        if (res.ok) loadKeywords();
    } catch (err) { }
};

// Messages
async function loadMessages(page = 1) {
    if (typeof page !== 'number') page = 1;
    currentPage = page;

    // Construir query string de filtros
    const params = new URLSearchParams({
        page: page,
        limit: messageLimit
    });

    if (filterStartDate.value) params.append('startDate', new Date(filterStartDate.value).toISOString());
    if (filterEndDate.value) {
        const end = new Date(filterEndDate.value);
        end.setHours(23, 59, 59, 999);
        params.append('endDate', end.toISOString());
    }
    if (filterPlatform.value) params.append('platform', filterPlatform.value);
    if (filterStreamer.value) params.append('streamer', filterStreamer.value);

    try {
        const res = await fetch(`${API_URL}/messages?${params.toString()}`);
        if (!res.ok) return;

        const data = await res.json();
        totalMatches = data.pagination.total;
        matchCountBadge.textContent = totalMatches;

        messageList.innerHTML = '';
        data.messages.forEach(m => {
            messageList.appendChild(createMessageRow(m));
        });

        renderPagination(data.pagination.total, data.pagination.page, data.pagination.limit);
    } catch (err) {
        console.error('Erro ao carregar mensagens:', err);
    }
}

btnApplyFilters.onclick = () => loadMessages(1);

btnResetFilters.onclick = () => {
    filterStartDate.value = '';
    filterEndDate.value = '';
    filterPlatform.value = '';
    filterStreamer.value = '';
    loadMessages(1);
};

function renderPagination(total, page, limit) {
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    let html = `
        <button class="page-btn" ${page === 1 ? 'disabled' : ''} onclick="loadMessages(${page - 1})">← Anterior</button>
        <span class="page-info">${page} / ${totalPages}</span>
        <button class="page-btn" ${page === totalPages ? 'disabled' : ''} onclick="loadMessages(${page + 1})">Próxima →</button>
    `;
    paginationContainer.innerHTML = html;
}

window.deleteChatMessage = async (id) => {
    if (!confirm('Excluir esta mensagem?')) return;
    try {
        const res = await fetch(`${API_URL}/messages/${id}`, { method: 'DELETE' });
        if (res.ok) loadMessages(currentPage);
    } catch (err) { }
};

btnClearAll.onclick = async () => {
    if (!confirm('Deseja REALMENTE excluir TODAS as mensagens salvas?')) return;
    try {
        const res = await fetch(`${API_URL}/messages`, { method: 'DELETE' });
        if (res.ok) {
            loadMessages(1);
            showToast('Histórico limpo', 'info');
        }
    } catch (err) { }
};

btnRefresh.onclick = () => loadMessages(currentPage);

init();
