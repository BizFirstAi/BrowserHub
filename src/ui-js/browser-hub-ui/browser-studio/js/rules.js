/* Rules page logic */

(function () {
    let rules = [];
    let editingId = null;

    const SEV_BADGE = { high: 'badge-red', medium: 'badge-yellow', low: 'badge-blue' };

    // ─── Load rules ───────────────────────────────────────────────────────────
    async function loadRules() {
        try {
            const res = await fetch('/api/rules');
            rules = await res.json();
            renderRules();
        } catch {
            toast('Could not load rules. Is the server running?', 'error');
        }
    }

    function renderRules() {
        const container = document.getElementById('rulesList');
        if (!rules.length) {
            container.innerHTML = `<div class="empty-state" style="padding:32px;"><h3>No rules configured</h3><p>Add your first rule below.</p></div>`;
            return;
        }
        container.innerHTML = rules.map(r => `
          <div class="rule-card" id="rule-${r.id}">
            <div class="rule-card-info">
              <div class="rule-card-title">
                ${r.name}
                <span class="badge ${SEV_BADGE[r.severity] || 'badge-gray'}">${r.severity}</span>
                ${!r.enabled ? '<span class="badge badge-gray">Disabled</span>' : ''}
              </div>
              <div class="rule-card-desc">${r.description}</div>
              <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                ${r.type === 'custom-js' ? `
                  <span class="badge badge-purple" style="font-size:0.68rem;">custom-js</span>
                  <span class="tag">min area: ${(r.config.minArea||0).toLocaleString()} px²</span>
                  <span class="tag">${r.config.label || r.name}</span>
                ` : `
                  <span class="tag">min RGB: ${r.config.minR}, ${r.config.minG}, ${r.config.minB}</span>
                  ${r.config.maxR !== undefined ? `<span class="tag">max RGB: ${r.config.maxR}, ${r.config.maxG}, ${r.config.maxB}</span>` : ''}
                  <span class="tag">min area: ${(r.config.minArea||0).toLocaleString()} px²</span>
                  <span class="tag">${r.config.label || r.name}</span>
                `}
              </div>
              ${r.type === 'custom-js' ? `
                <pre style="margin-top:10px;background:var(--bg-input);border:1px solid var(--border-1);border-radius:var(--r-sm);padding:10px 12px;font-family:var(--mono);font-size:0.75rem;color:var(--text-2);line-height:1.55;white-space:pre-wrap;word-break:break-all;max-height:80px;overflow:hidden;">${esc((r.config.script||'').split('\n').slice(0,4).join('\n'))}${(r.config.script||'').split('\n').length > 4 ? '\n…' : ''}</pre>
              ` : ''}
            </div>
            <div class="rule-card-actions">
              <label class="toggle-wrap" title="${r.enabled ? 'Disable rule' : 'Enable rule'}">
                <div class="toggle">
                  <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleRule('${r.id}', this.checked)">
                  <div class="toggle-track"></div>
                </div>
              </label>
              <button class="btn btn-secondary btn-icon btn-sm" onclick="openEditModal('${r.id}')" title="Edit">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-danger btn-icon btn-sm" onclick="deleteRule('${r.id}')" title="Delete">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              </button>
            </div>
          </div>`).join('');
    }

    // ─── Toggle ───────────────────────────────────────────────────────────────
    window.toggleRule = async (id, enabled) => {
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        rule.enabled = enabled;
        await saveRules();
        renderRules();
        toast(`Rule "${rule.name}" ${enabled ? 'enabled' : 'disabled'}`, 'success');
    };

    // ─── Delete ───────────────────────────────────────────────────────────────
    window.deleteRule = async (id) => {
        const rule = rules.find(r => r.id === id);
        if (!rule || !confirm(`Delete rule "${rule.name}"?`)) return;
        rules = rules.filter(r => r.id !== id);
        await saveRules();
        renderRules();
        toast(`Rule deleted`, 'success');
    };

    // ─── Add Rule ─────────────────────────────────────────────────────────────
    document.getElementById('addRuleBtn').addEventListener('click', async () => {
        const errEl = document.getElementById('addError');
        errEl.classList.add('hidden');

        const name = document.getElementById('newName').value.trim();
        if (!name) { errEl.textContent = 'Name is required'; errEl.classList.remove('hidden'); return; }

        const type = document.getElementById('newType').value;
        let cfg;

        if (type === 'custom-js') {
            const script = document.getElementById('newScript').value.trim();
            if (!script) { errEl.textContent = 'Script is required for custom JS rules'; errEl.classList.remove('hidden'); return; }
            cfg = {
                script,
                minArea: parseInt(document.getElementById('newMinArea').value) || 0,
                label: document.getElementById('newLabel').value.trim() || name
            };
        } else {
            const useMax = document.getElementById('useMaxToggle').checked;
            cfg = {
                minR: parseInt(document.getElementById('newMinR').value) || 0,
                minG: parseInt(document.getElementById('newMinG').value) || 0,
                minB: parseInt(document.getElementById('newMinB').value) || 0,
                minArea: parseInt(document.getElementById('newMinArea').value) || 50000,
                label: document.getElementById('newLabel').value.trim() || name
            };
            if (useMax) {
                cfg.maxR = parseInt(document.getElementById('newMaxR').value) || 255;
                cfg.maxG = parseInt(document.getElementById('newMaxG').value) || 255;
                cfg.maxB = parseInt(document.getElementById('newMaxB').value) || 255;
            }
        }

        const rule = {
            id: `rule-${Date.now()}`,
            name,
            description: document.getElementById('newDesc').value.trim() || `Detects ${name}`,
            enabled: true,
            severity: document.getElementById('newSeverity').value,
            type,
            config: cfg
        };

        rules.push(rule);
        await saveRules();
        renderRules();
        resetForm();
        toast(`Rule "${name}" added`, 'success');
    });

    document.getElementById('resetFormBtn').addEventListener('click', resetForm);

    function resetForm() {
        ['newName','newLabel','newDesc'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('newSeverity').value = 'medium';
        document.getElementById('newType').value = 'background-color';
        document.getElementById('newScript').value = '';
        document.getElementById('bgColorSection').style.display = '';
        document.getElementById('customJsSection').style.display = 'none';
        document.getElementById('ruleTypeBadge').textContent = 'background-color';
        document.getElementById('ruleTypeBadge').className = 'badge badge-blue';
        document.getElementById('newMinR').value = 240;
        document.getElementById('newMinG').value = 240;
        document.getElementById('newMinB').value = 240;
        document.getElementById('newMaxR').value = 255;
        document.getElementById('newMaxG').value = 255;
        document.getElementById('newMaxB').value = 255;
        document.getElementById('newMinArea').value = 50000;
        document.getElementById('useMaxToggle').checked = false;
        document.getElementById('maxRgbFields').style.opacity = '0.4';
        document.getElementById('maxRgbFields').style.pointerEvents = 'none';
        document.getElementById('addError').classList.add('hidden');
        updatePreview();
    }

    // ─── Max RGB toggle ───────────────────────────────────────────────────────
    document.getElementById('useMaxToggle').addEventListener('change', function () {
        const fields = document.getElementById('maxRgbFields');
        fields.style.opacity = this.checked ? '1' : '0.4';
        fields.style.pointerEvents = this.checked ? 'auto' : 'none';
        updatePreview();
    });

    // ─── Rule Type Toggle ──────────────────────────────────────────────────────
    document.getElementById('newType').addEventListener('change', function () {
        const isCustomJs = this.value === 'custom-js';
        document.getElementById('bgColorSection').style.display = isCustomJs ? 'none' : '';
        document.getElementById('customJsSection').style.display = isCustomJs ? 'flex' : 'none';
        document.getElementById('ruleTypeBadge').textContent = this.value;
        document.getElementById('ruleTypeBadge').className = isCustomJs ? 'badge badge-purple' : 'badge badge-blue';
    });

    // ─── Color Preview ────────────────────────────────────────────────────────
    function updatePreview() {
        const minR = parseInt(document.getElementById('newMinR').value) || 0;
        const minG = parseInt(document.getElementById('newMinG').value) || 0;
        const minB = parseInt(document.getElementById('newMinB').value) || 0;
        const useMax = document.getElementById('useMaxToggle').checked;
        const maxR = useMax ? (parseInt(document.getElementById('newMaxR').value) || 255) : 255;
        const maxG = useMax ? (parseInt(document.getElementById('newMaxG').value) || 255) : 255;
        const maxB = useMax ? (parseInt(document.getElementById('newMaxB').value) || 255) : 255;
        const midR = Math.round((minR + maxR) / 2);
        const midG = Math.round((minG + maxG) / 2);
        const midB = Math.round((minB + maxB) / 2);

        document.getElementById('previewMin').style.background = `rgb(${minR},${minG},${minB})`;
        document.getElementById('previewMinLabel').textContent = `rgb(${minR},${minG},${minB})`;
        document.getElementById('previewMax').style.background = `rgb(${maxR},${maxG},${maxB})`;
        document.getElementById('previewMaxLabel').textContent = `rgb(${maxR},${maxG},${maxB})`;
        document.getElementById('previewRange').style.background =
            `linear-gradient(to right, rgb(${minR},${minG},${minB}), rgb(${midR},${midG},${midB}), rgb(${maxR},${maxG},${maxB}))`;
    }

    ['newMinR','newMinG','newMinB','newMaxR','newMaxG','newMaxB'].forEach(id => {
        document.getElementById(id).addEventListener('input', updatePreview);
    });
    updatePreview();

    // ─── Edit Modal ───────────────────────────────────────────────────────────
    window.openEditModal = (id) => {
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        editingId = id;

        const isCustomJs = rule.type === 'custom-js';
        const hasMax = rule.config.maxR !== undefined;
        document.getElementById('editModalBody').innerHTML = `
          <div class="grid-2" style="gap:14px;">
            <div class="form-group"><label class="form-label">Name</label>
              <input id="editName" class="form-control" value="${esc(rule.name)}"></div>
            <div class="form-group"><label class="form-label">Severity</label>
              <select id="editSeverity" class="form-control">
                ${['high','medium','low'].map(s => `<option value="${s}"${rule.severity===s?' selected':''}>${s}</option>`).join('')}
              </select></div>
          </div>
          <div class="form-group"><label class="form-label">Description</label>
            <input id="editDesc" class="form-control" value="${esc(rule.description)}"></div>
          <div class="form-group"><label class="form-label">Label</label>
            <input id="editLabel" class="form-control" value="${esc(rule.config.label)}"></div>
          <div class="grid-2" style="gap:14px;">
            <div class="form-group"><label class="form-label">Min Area (px²)</label>
              <input id="editMinArea" class="form-control" type="number" value="${rule.config.minArea}"></div>
          </div>
          ${isCustomJs ? `
            <div class="form-group">
              <label class="form-label" style="display:flex;align-items:center;justify-content:space-between;">
                Script
                <a href="/custom-rules-guide.html" target="_blank" style="font-size:0.78rem;font-weight:500;color:var(--blue-l);">View examples →</a>
              </label>
              <textarea id="editScript" class="form-control" rows="9" style="font-size:0.82rem;">${esc(rule.config.script || '')}</textarea>
              <span class="form-hint">Return a <strong>string</strong> or <code>{ detail: '…' }</code> to flag. Return <code>null</code> to skip.</span>
            </div>
          ` : `
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
              <div class="form-group"><label class="form-label">Min R</label><input id="editMinR" class="form-control" type="number" value="${rule.config.minR}" min="0" max="255"></div>
              <div class="form-group"><label class="form-label">Min G</label><input id="editMinG" class="form-control" type="number" value="${rule.config.minG}" min="0" max="255"></div>
              <div class="form-group"><label class="form-label">Min B</label><input id="editMinB" class="form-control" type="number" value="${rule.config.minB}" min="0" max="255"></div>
            </div>
            ${hasMax ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
              <div class="form-group"><label class="form-label">Max R</label><input id="editMaxR" class="form-control" type="number" value="${rule.config.maxR}" min="0" max="255"></div>
              <div class="form-group"><label class="form-label">Max G</label><input id="editMaxG" class="form-control" type="number" value="${rule.config.maxG}" min="0" max="255"></div>
              <div class="form-group"><label class="form-label">Max B</label><input id="editMaxB" class="form-control" type="number" value="${rule.config.maxB}" min="0" max="255"></div>
            </div>` : ''}
          `}`;

        document.getElementById('editModal').classList.remove('hidden');
        document.getElementById('editModal').style.display = 'flex';
    };

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelEditBtn').addEventListener('click', closeModal);
    document.getElementById('editModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('editModal')) closeModal();
    });

    function closeModal() {
        document.getElementById('editModal').classList.add('hidden');
        document.getElementById('editModal').style.display = '';
        editingId = null;
    }

    document.getElementById('saveEditBtn').addEventListener('click', async () => {
        const rule = rules.find(r => r.id === editingId);
        if (!rule) return;

        rule.name = document.getElementById('editName').value.trim() || rule.name;
        rule.severity = document.getElementById('editSeverity').value;
        rule.description = document.getElementById('editDesc').value.trim();
        rule.config.label = document.getElementById('editLabel').value.trim() || rule.config.label;
        rule.config.minArea = parseInt(document.getElementById('editMinArea').value) || rule.config.minArea;

        if (rule.type === 'custom-js') {
            rule.config.script = document.getElementById('editScript').value;
        } else {
            rule.config.minR = parseInt(document.getElementById('editMinR').value);
            rule.config.minG = parseInt(document.getElementById('editMinG').value);
            rule.config.minB = parseInt(document.getElementById('editMinB').value);
            if (document.getElementById('editMaxR')) {
                rule.config.maxR = parseInt(document.getElementById('editMaxR').value);
                rule.config.maxG = parseInt(document.getElementById('editMaxG').value);
                rule.config.maxB = parseInt(document.getElementById('editMaxB').value);
            }
        }

        await saveRules();
        renderRules();
        closeModal();
        toast(`Rule "${rule.name}" updated`, 'success');
    });

    // ─── Save ──────────────────────────────────────────────────────────────────
    async function saveRules() {
        await fetch('/api/rules', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rules)
        });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function esc(str) { return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

    function toast(msg, type = 'info') {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icon = type === 'success'
            ? '<polyline points="20,6 9,17 4,12"/>'
            : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
        el.innerHTML = `
          <span class="toast-icon"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
          <span class="toast-msg">${msg}</span>
          <button class="toast-close" onclick="this.parentElement.remove()">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;
        document.getElementById('toast-container').appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    loadRules();

    // ─── Settings ─────────────────────────────────────────────────────────────
    const SETTINGS_KEY = 'pageTester_settings';
    const headlessToggle = document.getElementById('headlessToggle');
    const pageDelayInput = document.getElementById('pageDelayInput');
    const syncBadge = document.getElementById('settingsSyncBadge');

    function applySettings(s) {
        headlessToggle.checked = s.headless === false;
        pageDelayInput.value = s.pageDelay ?? 0;
    }

    async function loadSettings() {
        const cached = localStorage.getItem(SETTINGS_KEY);
        if (cached) applySettings(JSON.parse(cached));
        try {
            const res = await fetch('/api/settings');
            const s = await res.json();
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
            applySettings(s);
        } catch {
            toast('Could not load settings from server', 'error');
        }
    }

    async function saveSettings(partial, successMsg) {
        const cached = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        const settings = { ...cached, ...partial };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

        syncBadge.style.display = '';
        syncBadge.textContent = 'Saving…';
        syncBadge.className = 'badge badge-gray';

        try {
            await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            syncBadge.textContent = 'Saved';
            syncBadge.className = 'badge badge-green';
            if (successMsg) toast(successMsg, 'success');
        } catch {
            syncBadge.textContent = 'Sync failed';
            syncBadge.className = 'badge badge-red';
            toast('Failed to save setting to server', 'error');
        }

        setTimeout(() => { syncBadge.style.display = 'none'; }, 2500);
    }

    headlessToggle.addEventListener('change', function () {
        const showBrowser = this.checked;
        saveSettings(
            { headless: !showBrowser },
            `Browser window ${showBrowser ? 'will show' : 'hidden (headless)'} on next scan`
        );
    });

    let delayTimer;
    pageDelayInput.addEventListener('input', function () {
        clearTimeout(delayTimer);
        delayTimer = setTimeout(() => {
            const ms = Math.max(0, parseInt(this.value) || 0);
            this.value = ms;
            saveSettings({ pageDelay: ms }, ms > 0 ? `Page delay set to ${ms}ms` : 'Page delay disabled');
        }, 600);
    });

    loadSettings();
})();
