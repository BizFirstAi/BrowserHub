'use strict';
// ── Browser Hub Shell — auth guard + sidebar behaviour
// Loaded by every browser-studio page that has body.has-sidebar.
// Responsibilities:
//   1. Redirect to /login.html when token is absent
//   2. Mark the active sidebar link based on current path
//   3. Load and display the username in the sidebar footer
//   4. Expose signOut() globally

(function () {

    // ── Auth guard ─────────────────────────────────────────────────────────────
    const token = localStorage.getItem('studioToken');
    if (!token) { location.replace('/login.html'); return; }

    // ── Active nav ─────────────────────────────────────────────────────────────
    function setActive() {
        const current = location.pathname.replace(/\/$/, '');
        document.querySelectorAll('.sb-item[href]').forEach(a => {
            const href = a.getAttribute('href').replace(/\/$/, '');
            // Exact match or "index" as root
            const match = href === current ||
                (href === '/browser-studio/index.html' && current === '/browser-studio');
            a.classList.toggle('active', match);
        });
    }

    // ── Username display ───────────────────────────────────────────────────────
    async function loadUser() {
        try {
            const resp = await fetch('/api/auth/me', {
                headers: { Authorization: 'Bearer ' + token },
            });
            if (!resp.ok) { signOut(); return; }
            const { displayName, userId } = await resp.json();
            const el = document.getElementById('sbUserName');
            if (el) el.textContent = displayName || userId || 'User';
        } catch {
            // network error — leave placeholder visible
        }
    }

    // ── Sign out ───────────────────────────────────────────────────────────────
    function signOut() {
        localStorage.removeItem('studioToken');
        location.replace('/login.html');
    }
    window.signOut = signOut;

    // ── Init ───────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { setActive(); loadUser(); });
    } else {
        setActive();
        loadUser();
    }

}());
