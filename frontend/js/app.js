/**
 * App — Main application controller.
 * Handles client-side routing, WebSocket connection, API calls,
 * modal management, and toast notifications.
 */
const App = {
    _currentPage: 'dashboard',
    _ws: null,
    _wsReconnectTimer: null,
    _wsReconnectDelay: 1000,

    // ─── Initialization ────────────────────────────────────
    init() {
        // Initialize Internationalization
        I18n.init();
        I18n.onLanguageChange(() => {
            App.navigate(App._currentPage);
        });

        // Set up navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                App.navigate(page);
            });
        });

        // Close modal on overlay click
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'modal-overlay') {
                App.closeModal();
            }
        });

        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                App.closeModal();
            }
        });

        // Connect WebSocket
        App.connectWebSocket();

        // Load initial page
        App.navigate('dashboard');
    },

    // ─── Client-Side Router ────────────────────────────────
    navigate(page) {
        App._currentPage = page;

        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });

        // Load page
        switch (page) {
            case 'dashboard':
                DashboardPage.load();
                break;
            case 'cameras':
                CamerasPage.load();
                break;
            case 'persons':
                PersonsPage.load();
                break;
            case 'zones':
                ZonesPage.load();
                break;
            default:
                DashboardPage.load();
        }
    },

    // ─── WebSocket Connection ──────────────────────────────
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/events`;

        try {
            App._ws = new WebSocket(wsUrl);

            App._ws.onopen = () => {
                console.log('WebSocket connected');
                App._wsReconnectDelay = 1000; // Reset backoff
                App.updateWSStatus(true);
            };

            App._ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'new_event') {
                        DashboardPage.addRealtimeEvent(data.event);
                        if (data.event && (data.event.alert_type === 'out_of_zone' || data.event.alert_type === 'unauthorized_entry' || data.event.alert_type === 'absence_timeout')) {
                            if (typeof ZonesPage !== 'undefined' && ZonesPage.addRealtimeLog) {
                                ZonesPage.addRealtimeLog({ event: data.event, ...data.event });
                            }
                        }
                    } else if (data.type === 'zone_alert') {
                        App.showZoneAlert(data);
                        if (typeof ZonesPage !== 'undefined' && ZonesPage.addRealtimeLog) {
                            ZonesPage.addRealtimeLog(data);
                        }
                    }
                } catch (err) {
                    console.error('Failed to parse WebSocket message:', err);
                }
            };

            App._ws.onclose = () => {
                console.log('WebSocket disconnected');
                App.updateWSStatus(false);
                App.scheduleWSReconnect();
            };

            App._ws.onerror = (err) => {
                console.error('WebSocket error:', err);
                App.updateWSStatus(false);
            };
        } catch (err) {
            console.error('Failed to create WebSocket:', err);
            App.updateWSStatus(false);
            App.scheduleWSReconnect();
        }
    },

    scheduleWSReconnect() {
        if (App._wsReconnectTimer) return;

        App._wsReconnectTimer = setTimeout(() => {
            App._wsReconnectTimer = null;
            App._wsReconnectDelay = Math.min(App._wsReconnectDelay * 2, 30000);
            App.connectWebSocket();
        }, App._wsReconnectDelay);
    },

    updateWSStatus(connected) {
        const dot = document.getElementById('ws-dot');
        const text = document.getElementById('ws-status-text');

        if (!dot || !text) return;

        if (connected) {
            dot.classList.remove('disconnected');
            text.textContent = I18n.t('ws_connected');
        } else {
            dot.classList.add('disconnected');
            text.textContent = I18n.t('ws_reconnecting');
        }
    },

    // ─── API Helper ────────────────────────────────────────
    async api(url, methodOrOptions = 'GET', body = null) {
        let method = 'GET';
        let headers = {};
        let reqBody = null;

        if (typeof methodOrOptions === 'object' && methodOrOptions !== null) {
            method = methodOrOptions.method || 'GET';
            headers = methodOrOptions.headers || {};
            reqBody = methodOrOptions.body || null;
        } else {
            method = (typeof methodOrOptions === 'string' ? methodOrOptions : 'GET').toUpperCase();
            reqBody = body;
        }

        const options = {
            method,
            headers: { ...headers },
        };

        if (reqBody && method !== 'GET') {
            if (typeof reqBody === 'object') {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(reqBody);
            } else {
                if (!options.headers['Content-Type']) {
                    options.headers['Content-Type'] = 'application/json';
                }
                options.body = reqBody;
            }
        }

        const response = await fetch(url, options);

        if (response.status === 204) {
            return null; // No content
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        return response.json();
    },

    // ─── Modal Management ──────────────────────────────────
    _modalCloseTimer: null,

    openModal(contentHtml, modalClass = '') {
        if (App._modalCloseTimer) {
            clearTimeout(App._modalCloseTimer);
            App._modalCloseTimer = null;
        }
        const modalEl = document.getElementById('modal-content');
        if (modalEl) {
            modalEl.className = 'modal' + (modalClass ? ' ' + modalClass : '');
            if (modalClass.includes('modal-analytics') || modalClass.includes('modal-xl') || modalClass.includes('modal-wide')) {
                modalEl.style.maxWidth = '1300px';
                modalEl.style.width = '96vw';
                modalEl.style.maxHeight = '92vh';
            } else if (modalClass.includes('modal-lg')) {
                modalEl.style.maxWidth = '840px';
                modalEl.style.width = '92vw';
                modalEl.style.maxHeight = '88vh';
            } else {
                modalEl.style.maxWidth = '';
                modalEl.style.width = '';
                modalEl.style.maxHeight = '';
            }
            modalEl.innerHTML = contentHtml;
        }
        document.getElementById('modal-overlay').classList.add('active');
    },

    closeModal() {
        document.getElementById('modal-overlay').classList.remove('active');
        if (App._modalCloseTimer) {
            clearTimeout(App._modalCloseTimer);
        }
        App._modalCloseTimer = setTimeout(() => {
            const modalEl = document.getElementById('modal-content');
            if (modalEl) {
                modalEl.className = 'modal';
                modalEl.style.maxWidth = '';
                modalEl.style.width = '';
                modalEl.style.maxHeight = '';
                modalEl.innerHTML = '';
            }
            App._modalCloseTimer = null;
        }, 300);
    },

    // ─── Toast Notifications ───────────────────────────────
    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const id = 'toast-' + Date.now();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.id = id;
        toast.innerHTML = `
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="App.dismissToast('${id}')">✕</button>
        `;

        container.appendChild(toast);

        // Auto-dismiss after 4 seconds
        setTimeout(() => App.dismissToast(id), 4000);
    },

    dismissToast(id) {
        const toast = document.getElementById(id);
        if (toast) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(30px)';
            toast.style.transition = 'all 300ms ease';
            setTimeout(() => toast.remove(), 300);
        }
    },

    showZoneAlert(data) {
        const localizedMsg = (typeof I18n !== 'undefined' && I18n.formatAlertNotification)
            ? I18n.formatAlertNotification(data)
            : (data.message || '⚠️ Zone Alert');
        App.toast(localizedMsg, 'error');
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) {
            // Audio context muted / blocked by browser policy
        }
    },
};

// ─── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
