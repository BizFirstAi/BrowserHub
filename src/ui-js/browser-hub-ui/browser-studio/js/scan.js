/* Live scan page logic */

(function () {
    const params = new URLSearchParams(window.location.search);
    const scanId = params.get('id');

    if (!scanId) {
        window.location.href = '/browser-studio/index.html';
        return;
    }

    document.getElementById('scanIdLabel').textContent = `Scan ID: ${scanId}`;
    document.getElementById('viewResultsBtn').href = `/browser-studio/results.html?id=${scanId}`;

    const els = {
        statusBadge:    document.getElementById('statusBadge'),
        scanBadge:      document.getElementById('scanBadge'),
        scanBadgeText:  document.getElementById('scanBadgeText'),
        statTotal:      document.getElementById('statTotal'),
        statScanned:    document.getElementById('statScanned'),
        statFindings:   document.getElementById('statFindings'),
        statErrors:     document.getElementById('statErrors'),
        progressLabel:  document.getElementById('progressLabel'),
        progressPct:    document.getElementById('progressPct'),
        progressFill:   document.getElementById('progressFill'),
        currentUrl:     document.getElementById('currentUrl'),
        feedContainer:  document.getElementById('findingsFeed'),
        feedEmpty:      document.getElementById('feedEmpty'),
        feedCount:      document.getElementById('feedCount'),
        cancelBtn:      document.getElementById('cancelBtn'),
        viewResultsBtn: document.getElementById('viewResultsBtn'),
        errorsSection:  document.getElementById('errorsSection'),
        errorsFeed:     document.getElementById('errorsFeed'),
        errorsCount:    document.getElementById('errorsCount'),
        navBadge:       document.getElementById('scanBadge'),
    };

    let findingsCount = 0;
    let errorsCount = 0;
    const feedFindings = [];

    // ─── Load existing scan state (for reload/reconnect) ─────────────────────
    async function loadScanState() {
        try {
            const res = await fetch(`/api/scans/${scanId}`);
            if (!res.ok) throw new Error('Scan not found');
            const scan = await res.json();

            els.statTotal.textContent = scan.stats.total || '—';
            els.statScanned.textContent = scan.stats.scanned;
            els.statFindings.textContent = scan.stats.findings;
            els.statErrors.textContent = scan.stats.errors;
            findingsCount = scan.stats.findings;
            errorsCount = scan.stats.errors;
            els.feedCount.textContent = `${findingsCount} issue${findingsCount !== 1 ? 's' : ''}`;

            if (scan.findings.length) {
                els.feedEmpty.remove();
                scan.findings.forEach(f => appendFinding(f, false));
            }

            if (scan.errors.length) {
                els.errorsSection.classList.remove('hidden');
                els.errorsCount.textContent = `${scan.errors.length} errors`;
                scan.errors.forEach(e => appendError(e));
            }

            if (scan.status === 'complete' || scan.status === 'cancelled' || scan.status === 'error') {
                setComplete(scan.status, scan.stats);
            }
        } catch {
            toast('Could not load scan state. Is the server running?', 'error');
        }
    }

    // ─── Socket.io ───────────────────────────────────────────────────────────
    let socket;
    try {
        socket = io();
        socket.emit('join:scan', scanId);

        socket.on('scan:status', ({ status }) => updateStatus(status));

        socket.on('scan:urls', ({ total }) => {
            els.statTotal.textContent = total;
            els.progressLabel.textContent = `0 of ${total} scanned`;
        });

        socket.on('scan:progress', ({ current, total, url, percent }) => {
            els.progressFill.style.width = `${percent}%`;
            els.progressPct.textContent = `${percent}%`;
            els.progressLabel.textContent = `${current} of ${total} scanned`;
            els.currentUrl.textContent = url;
            els.statScanned.textContent = current - 1;
        });

        socket.on('scan:finding', (finding) => {
            if (els.feedEmpty.parentElement) els.feedEmpty.remove();
            appendFinding(finding, true);
            findingsCount++;
            els.statFindings.textContent = findingsCount;
            els.feedCount.textContent = `${findingsCount} issue${findingsCount !== 1 ? 's' : ''}`;
        });

        socket.on('scan:page-error', (err) => {
            errorsCount++;
            els.statErrors.textContent = errorsCount;
            els.errorsSection.classList.remove('hidden');
            els.errorsCount.textContent = `${errorsCount} errors`;
            appendError(err);
        });

        socket.on('scan:complete', ({ status, stats }) => {
            setComplete(status, stats);
        });

        socket.on('scan:error', ({ message }) => {
            toast(`Scan error: ${message}`, 'error');
            setComplete('error', null);
        });
    } catch {
        // Socket.io not available, show static state
    }

    loadScanState();

    // ─── Cancel ───────────────────────────────────────────────────────────────
    els.cancelBtn.addEventListener('click', async () => {
        if (!confirm('Cancel this scan?')) return;
        els.cancelBtn.disabled = true;
        try {
            await fetch(`/api/scans/${scanId}/cancel`, { method: 'POST' });
            toast('Cancelling scan…', 'info');
        } catch {
            toast('Could not cancel scan', 'error');
            els.cancelBtn.disabled = false;
        }
    });

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function updateStatus(status) {
        const map = {
            queued: 'badge-queued', running: 'badge-running',
            complete: 'badge-complete', error: 'badge-error', cancelled: 'badge-cancelled'
        };
        els.statusBadge.className = `badge ${map[status] || 'badge-gray'}`;
        els.statusBadge.textContent = status;
    }

    function setComplete(status, stats) {
        updateStatus(status);
        els.cancelBtn.classList.add('hidden');
        els.viewResultsBtn.classList.remove('hidden');
        els.navBadge.style.display = 'none';

        if (stats) {
            els.statTotal.textContent = stats.total;
            els.statScanned.textContent = stats.scanned;
            els.statFindings.textContent = stats.findings;
            els.statErrors.textContent = stats.errors;
        }

        els.progressLabel.textContent = status === 'complete'
            ? 'Scan complete'
            : status === 'cancelled' ? 'Scan cancelled' : 'Scan stopped';
        els.currentUrl.textContent = '';

        if (status === 'complete') {
            toast('Scan complete! View your results.', 'success');
        } else if (status === 'cancelled') {
            toast('Scan was cancelled.', 'info');
        } else if (status === 'error') {
            toast('Scan encountered an error.', 'error');
        }
    }

    function findingText(f) {
        return `${f.url}\n${f.ruleName} · ${f.size} · ${f.backgroundColor}\n${f.selector}`;
    }

    function appendFinding(f, animate) {
        feedFindings.push(f);
        document.getElementById('copyAllBtn').classList.remove('hidden');

        const sev = f.severity || 'medium';
        const dotClass = sev === 'high' ? 'high' : sev === 'medium' ? 'medium' : 'low';
        const div = document.createElement('div');
        div.className = 'feed-item';
        div.style.cssText = 'position:relative;';
        div.innerHTML = `
          <div class="feed-dot ${dotClass}"></div>
          <div style="flex:1;min-width:0;">
            <a class="feed-url" href="${f.url}" target="_blank" rel="noopener" title="Open in new tab">${f.url}</a>
            <div class="feed-info">${f.ruleName} · ${f.size} · ${f.detail ? `<span style="font-family:var(--mono);font-size:0.72rem;color:var(--text-2)">${f.detail}</span>` : `<span style="font-family:var(--mono);font-size:0.72rem;padding:1px 5px;border-radius:3px;background:${f.backgroundColor};color:${isDark(f.r,f.g,f.b)?'#fff':'#000'}">${f.backgroundColor}</span>`}</div>
            <div style="font-size:0.72rem;color:var(--text-3);font-family:var(--mono);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.selector}">${f.selector}</div>
          </div>
          <button class="btn btn-ghost btn-icon btn-sm copy-btn" title="Copy finding" style="flex-shrink:0;opacity:0;transition:opacity 0.15s;">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>`;

        const btn = div.querySelector('.copy-btn');
        div.addEventListener('mouseenter', () => btn.style.opacity = '1');
        div.addEventListener('mouseleave', () => btn.style.opacity = '0');
        btn.addEventListener('click', () => copyText(findingText(f), btn));

        els.feedContainer.appendChild(div);
        els.feedContainer.scrollTop = els.feedContainer.scrollHeight;
    }

    document.getElementById('copyAllBtn').addEventListener('click', (e) => {
        const text = feedFindings.map(findingText).join('\n\n');
        copyText(text, e.currentTarget);
    });

    function copyText(text, btn) {
        navigator.clipboard.writeText(text).then(() => {
            const orig = btn.innerHTML;
            btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>`;
            btn.style.color = 'var(--green)';
            btn.style.opacity = '1';
            setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; btn.style.opacity = ''; }, 1500);
        }).catch(() => toast('Copy failed', 'error'));
    }

    function appendError(e) {
        const div = document.createElement('div');
        div.className = 'feed-item';
        div.innerHTML = `
          <div class="feed-dot" style="background:var(--red)"></div>
          <div>
            <div class="feed-url" style="color:var(--red)" title="${e.url}">${e.url}</div>
            <div class="feed-info">${e.message}</div>
          </div>`;
        els.errorsFeed.appendChild(div);
    }

    function isDark(r, g, b) { return (r * 299 + g * 587 + b * 114) / 1000 < 128; }

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
        setTimeout(() => el.remove(), 5000);
    }
})();
