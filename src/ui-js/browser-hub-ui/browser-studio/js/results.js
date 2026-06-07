/* Results page logic */

(function () {
    const params = new URLSearchParams(window.location.search);
    const scanId = params.get('id');

    if (!scanId) { window.location.href = '/browser-studio/index.html'; return; }

    let allFindings = [];
    let scanData = null;

    const STATUS_MAP = {
        complete: 'badge-complete', error: 'badge-error',
        cancelled: 'badge-cancelled', running: 'badge-running', queued: 'badge-queued'
    };

    async function loadScan() {
        try {
            const res = await fetch(`/api/scans/${scanId}`);
            if (!res.ok) throw new Error('Scan not found');
            scanData = await res.json();
            allFindings = scanData.findings || [];

            // Status
            document.getElementById('statusBadge').className = `badge ${STATUS_MAP[scanData.status] || 'badge-gray'}`;
            document.getElementById('statusBadge').textContent = scanData.status;

            // Meta
            const started = new Date(scanData.startedAt).toLocaleString();
            const completed = scanData.completedAt ? new Date(scanData.completedAt).toLocaleString() : 'In progress';
            document.getElementById('scanMeta').textContent = `ID: ${scanData.id.substring(0, 8)}… · Started: ${started} · Completed: ${completed}`;

            // Stats
            document.getElementById('statTotal').textContent = scanData.stats.total;
            document.getElementById('statScanned').textContent = scanData.stats.scanned;
            document.getElementById('statFindings').textContent = scanData.stats.findings;
            document.getElementById('statErrors').textContent = scanData.stats.errors;

            // Populate rule filter
            const ruleNames = [...new Set(allFindings.map(f => f.ruleName))];
            const ruleSelect = document.getElementById('ruleFilter');
            ruleNames.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name; opt.textContent = name;
                ruleSelect.appendChild(opt);
            });

            // Errors table
            if (scanData.errors && scanData.errors.length) {
                document.getElementById('errorsSection').classList.remove('hidden');
                document.getElementById('errorsCount').textContent = `${scanData.errors.length} errors`;
                const errBody = document.getElementById('errorsBody');
                scanData.errors.forEach(e => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td class="td-url td-mono text-xs" title="${e.url}">${e.url}</td><td style="color:var(--red);font-size:0.85rem;">${e.message}</td>`;
                    errBody.appendChild(tr);
                });
            }

            applyFilters();
        } catch (err) {
            document.getElementById('emptyState').innerHTML = `
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <h3>Could not load scan</h3>
              <p>${err.message}</p>`;
        }
    }

    // ─── Filtering ───────────────────────────────────────────────────────────
    let sortCol = null, sortDir = 1;

    function applyFilters() {
        const search = document.getElementById('searchInput').value.toLowerCase();
        const rule = document.getElementById('ruleFilter').value;
        const sev = document.getElementById('severityFilter').value;

        let filtered = allFindings.filter(f => {
            const matchSearch = !search || f.url.toLowerCase().includes(search) || f.selector.toLowerCase().includes(search);
            const matchRule = !rule || f.ruleName === rule;
            const matchSev = !sev || f.severity === sev;
            return matchSearch && matchRule && matchSev;
        });

        if (sortCol) {
            filtered.sort((a, b) => {
                const av = (a[sortCol] || '').toString().toLowerCase();
                const bv = (b[sortCol] || '').toString().toLowerCase();
                return av < bv ? -sortDir : av > bv ? sortDir : 0;
            });
        }

        document.getElementById('filterCount').textContent = `${filtered.length} of ${allFindings.length} findings`;
        renderTable(filtered);
    }

    function renderTable(findings) {
        const emptyState = document.getElementById('emptyState');
        const tableWrap = document.getElementById('resultsTable');
        const tbody = document.getElementById('resultsBody');

        if (!findings.length) {
            emptyState.innerHTML = allFindings.length
                ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><h3>No matching findings</h3><p>Try adjusting your filters.</p>`
                : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg><h3>No findings</h3><p>No visual issues were detected on this scan.</p>`;
            emptyState.style.display = '';
            tableWrap.classList.add('hidden');
            return;
        }

        emptyState.style.display = 'none';
        tableWrap.classList.remove('hidden');

        const SEV_BADGE = { high: 'badge-red', medium: 'badge-yellow', low: 'badge-blue' };

        tbody.innerHTML = findings.map(f => {
            const [rr, gg, bb] = [f.r, f.g, f.b];
            const textColor = rr !== undefined
                ? ((rr * 299 + gg * 587 + bb * 114) / 1000 < 128 ? '#fff' : '#111')
                : '#111';
            const swatchStyle = `background:${f.backgroundColor};color:${textColor};border:1px solid rgba(0,0,0,0.15);padding:2px 7px;border-radius:4px;font-family:var(--mono);font-size:0.72rem;`;
            const shortId = f.url.replace(/^https?:\/\/[^/]+/, '').substring(0, 60) || '/';
            return `
              <tr>
                <td>
                  <a href="${f.url}" target="_blank" rel="noopener" style="color:var(--text-accent);font-size:0.82rem;font-family:var(--mono)" title="${f.url}">${shortId}</a>
                  <div style="font-size:0.72rem;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;" title="${f.url}">${f.url}</div>
                </td>
                <td><span class="badge badge-gray" style="font-size:0.7rem;">${f.label || f.ruleName}</span></td>
                <td><span class="badge ${SEV_BADGE[f.severity] || 'badge-gray'}">${f.severity || '—'}</span></td>
                <td class="td-mono text-xs">${f.size}</td>
                <td>${f.detail
                    ? `<span style="font-family:var(--mono);font-size:0.72rem;color:var(--text-2)">${f.detail}</span>`
                    : `<span style="${swatchStyle}">${f.backgroundColor}</span>`
                }</td>
                <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text-2);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.selector}">${f.selector}</td>
              </tr>`;
        }).join('');
    }

    // ─── Sort ─────────────────────────────────────────────────────────────────
    document.querySelectorAll('thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortCol === col) { sortDir *= -1; }
            else { sortCol = col; sortDir = 1; }
            applyFilters();
        });
    });

    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('ruleFilter').addEventListener('change', applyFilters);
    document.getElementById('severityFilter').addEventListener('change', applyFilters);

    // ─── CSV Export ──────────────────────────────────────────────────────────
    document.getElementById('exportCsvBtn').addEventListener('click', () => {
        if (!allFindings.length) {
            toast('No findings to export', 'info');
            return;
        }

        const cols = ['url', 'ruleName', 'severity', 'label', 'size', 'backgroundColor', 'selector', 'width', 'height', 'area'];
        const header = cols.join(',');
        const rows = allFindings.map(f =>
            cols.map(c => {
                const v = (f[c] ?? '').toString().replace(/"/g, '""');
                return `"${v}"`;
            }).join(',')
        );

        const csv = [header, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `page-tester-${scanId.substring(0, 8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast('CSV exported', 'success');
    });

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
          <span class="toast-icon"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[type]||icons.info}</svg></span>
          <span class="toast-msg">${msg}</span>
          <button class="toast-close" onclick="this.parentElement.remove()">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;
        document.getElementById('toast-container').appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    loadScan();
})();
