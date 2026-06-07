/* Dashboard page logic */

(function () {
    const SEVERITY_BADGE = { high: 'badge-red', medium: 'badge-yellow', low: 'badge-blue' };

    // ─── Tabs ────────────────────────────────────────────────────────────────
    let activeTab = 'sitemap';
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeTab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${activeTab}`).classList.add('active');
        });
    });

    // ─── Accordion ───────────────────────────────────────────────────────────
    const optToggle = document.getElementById('optionsToggle');
    const optBody = document.getElementById('optionsBody');
    optToggle.addEventListener('click', () => {
        const open = optBody.classList.toggle('open');
        optToggle.classList.toggle('open', open);
    });

    // ─── Mermaid init ────────────────────────────────────────────────────────
    mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
    mermaid.init(undefined, '.mermaid').then(() => {
        setTimeout(() => {
            document.querySelectorAll('.mermaid .edgePath path').forEach(p => {
                const len = p.getTotalLength ? p.getTotalLength() : 1200;
                p.style.strokeDasharray = len;
                p.style.strokeDashoffset = len;
                p.style.animation = 'drawEdge 1.6s cubic-bezier(0.4,0,0.2,1) forwards';
            });
        }, 300);
    });

    // ─── Start scan ──────────────────────────────────────────────────────────
    document.getElementById('startScanBtn').addEventListener('click', async () => {
        const errorEl = document.getElementById('scanError');
        errorEl.classList.add('hidden');

        let input = '';
        const type = activeTab;

        if (type === 'sitemap') {
            input = document.getElementById('sitemapInput').value.trim();
            if (!input) { showError('Please enter a sitemap URL.'); return; }
            if (!input.startsWith('http')) { showError('Sitemap URL must start with http or https.'); return; }
        } else {
            input = document.getElementById('urlsInput').value.trim();
            if (!input) { showError('Please enter at least one URL.'); return; }
        }

        const btn = document.getElementById('startScanBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Starting…';

        try {
            const res = await fetch('/api/scans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, input })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start scan');
            window.location.href = `/browser-studio/scan.html?id=${data.id}`;
        } catch (err) {
            showError(err.message);
            btn.disabled = false;
            btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 19,12 5,21 5,3"/></svg> Start Scan`;
        }

        function showError(msg) {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
        }
    });

    // ─── Recent Scans ─────────────────────────────────────────────────────────
    async function loadRecentScans() {
        try {
            const res = await fetch('/api/scans');
            const scans = await res.json();
            renderScans(scans);
        } catch {
            document.getElementById('recentScans').innerHTML =
                '<p class="text-muted text-sm" style="padding:16px;">Could not load scans. Is the server running?</p>';
        }
    }

    function renderScans(scans) {
        const container = document.getElementById('recentScans');
        if (!scans.length) {
            container.innerHTML = `
                <div class="empty-state">
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <h3>No scans yet</h3>
                  <p>Start your first scan to see results here.</p>
                </div>`;
            return;
        }

        const rows = scans.slice(0, 10).map(s => {
            const badgeClass = `badge-${s.status}`;
            const started = new Date(s.startedAt).toLocaleString();
            const findings = s.stats?.findings ?? '—';
            const scanned = s.stats?.scanned ?? 0;
            const total = s.stats?.total ?? '—';
            const preview = s.inputPreview.length > 50 ? s.inputPreview.substring(0, 50) + '…' : s.inputPreview;
            const canView = s.status === 'complete' || s.status === 'cancelled';
            const isRunning = s.status === 'running' || s.status === 'queued';
            return `
              <tr>
                <td><span class="tag">${s.type}</span></td>
                <td class="td-url" title="${s.inputPreview}">${preview}</td>
                <td><span class="badge ${badgeClass}">${s.status}</span></td>
                <td class="text-sm text-muted">${scanned}/${total}</td>
                <td class="text-sm">${findings}</td>
                <td class="td-mono text-xs text-muted">${started}</td>
                <td class="td-actions">
                  ${isRunning ? `<a href="/browser-studio/scan.html?id=${s.id}" class="btn btn-secondary btn-sm">Live</a>` : ''}
                  ${canView ? `<a href="/browser-studio/results.html?id=${s.id}" class="btn btn-secondary btn-sm">Results</a>` : ''}
                  <button class="btn btn-danger btn-icon btn-sm" onclick="deleteScan('${s.id}',this)" title="Delete">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                  </button>
                </td>
              </tr>`;
        }).join('');

        container.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Type</th><th>Input</th><th>Status</th>
                <th>Progress</th><th>Findings</th><th>Started</th><th>Actions</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
    }

    window.deleteScan = async (id, btn) => {
        if (!confirm('Delete this scan? This cannot be undone.')) return;
        btn.disabled = true;
        try {
            await fetch(`/api/scans/${id}`, { method: 'DELETE' });
            toast('Scan deleted', 'success');
            loadRecentScans();
        } catch {
            toast('Delete failed', 'error');
            btn.disabled = false;
        }
    };

    document.getElementById('refreshBtn').addEventListener('click', loadRecentScans);

    loadRecentScans();

    // ─── Toast ───────────────────────────────────────────────────────────────
    function toast(msg, type = 'info') {
        const icons = {
            success: '<polyline points="20,6 9,17 4,12"/>',
            error: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
            info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
        };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `
          <span class="toast-icon"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[type] || icons.info}</svg></span>
          <span class="toast-msg">${msg}</span>
          <button class="toast-close" onclick="this.parentElement.remove()">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;
        document.getElementById('toast-container').appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }
})();
