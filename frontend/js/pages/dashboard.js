/**
 * Dashboard Page — Real-time event stream with stats and filtering.
 */
const DashboardPage = {
    _filter: 'all', // 'all' | 'known' | 'unknown'
    _events: [],

    /**
     * Load and render the dashboard page.
     */
    async load() {
        document.getElementById('page-title').textContent = 'Dashboard';
        document.getElementById('header-actions').innerHTML = `
            <div class="live-indicator">
                <span class="live-dot"></span>
                LIVE
            </div>
        `;

        const body = document.getElementById('content-body');
        body.innerHTML = `
            <!-- Stats Grid -->
            <div class="stats-grid" id="stats-grid">
                <div class="stat-card blue">
                    <div class="stat-label">Total Events Today</div>
                    <div class="stat-value" id="stat-total">—</div>
                </div>
                <div class="stat-card emerald">
                    <div class="stat-label">Known Faces</div>
                    <div class="stat-value" id="stat-known">—</div>
                </div>
                <div class="stat-card rose">
                    <div class="stat-label">Unknown Faces</div>
                    <div class="stat-value" id="stat-unknown">—</div>
                </div>
                <div class="stat-card violet">
                    <div class="stat-label">Active Cameras</div>
                    <div class="stat-value" id="stat-cameras">—</div>
                </div>
            </div>

            <!-- Filter Bar -->
            <div class="filter-bar" id="filter-bar">
                <button class="filter-btn active" data-filter="all" onclick="DashboardPage.setFilter('all')">
                    All Events
                </button>
                <button class="filter-btn" data-filter="known" onclick="DashboardPage.setFilter('known')">
                    ✅ Known
                </button>
                <button class="filter-btn" data-filter="unknown" onclick="DashboardPage.setFilter('unknown')">
                    ❓ Unknown
                </button>
            </div>

            <!-- Events Grid -->
            <div class="events-grid" id="events-grid">
                <div class="empty-state">
                    <div class="empty-state-icon">📡</div>
                    <div class="empty-state-title">Loading events...</div>
                </div>
            </div>
        `;

        // Load data
        await Promise.all([
            DashboardPage.loadStats(),
            DashboardPage.loadEvents(),
        ]);
    },

    /**
     * Load summary statistics.
     */
    async loadStats() {
        try {
            const stats = await App.api('/api/events/stats');
            DashboardPage.animateCounter('stat-total', stats.total_today);
            DashboardPage.animateCounter('stat-known', stats.known_today);
            DashboardPage.animateCounter('stat-unknown', stats.unknown_today);
            DashboardPage.animateCounter('stat-cameras', stats.active_cameras);
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    },

    /**
     * Load events list with current filter.
     */
    async loadEvents() {
        try {
            let url = '/api/events?limit=50';
            if (DashboardPage._filter === 'known') url += '&is_known=true';
            if (DashboardPage._filter === 'unknown') url += '&is_known=false';

            const data = await App.api(url);
            DashboardPage._events = data.events || [];
            DashboardPage.renderEvents();
        } catch (err) {
            console.error('Failed to load events:', err);
            document.getElementById('events-grid').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-title">Failed to load events</div>
                    <div class="empty-state-text">${err.message}</div>
                </div>
            `;
        }
    },

    /**
     * Render the events grid.
     */
    renderEvents() {
        const grid = document.getElementById('events-grid');
        if (!grid) return;

        if (DashboardPage._events.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-title">No events yet</div>
                    <div class="empty-state-text">
                        Detection events will appear here in real-time once cameras are active
                        and face detection is running.
                    </div>
                </div>
            `;
            return;
        }

        grid.innerHTML = DashboardPage._events
            .map(event => EventCard.render(event))
            .join('');
    },

    /**
     * Set the active filter and reload events.
     */
    setFilter(filter) {
        DashboardPage._filter = filter;

        // Update filter button states
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });

        DashboardPage.loadEvents();
    },

    /**
     * Add a new real-time event (called from WebSocket).
     */
    addRealtimeEvent(eventData) {
        // Only update if we're on the dashboard
        if (App._currentPage !== 'dashboard') return;

        // Check filter
        if (DashboardPage._filter === 'known' && !eventData.is_known) return;
        if (DashboardPage._filter === 'unknown' && eventData.is_known) return;

        // Prepend to events list
        DashboardPage._events.unshift(eventData);

        // Keep max 50
        if (DashboardPage._events.length > 50) {
            DashboardPage._events = DashboardPage._events.slice(0, 50);
        }

        // Re-render
        DashboardPage.renderEvents();

        // Update stats
        DashboardPage.loadStats();
    },

    /**
     * Animate a counter from 0 to target value.
     */
    animateCounter(elementId, target) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const duration = 600;
        const start = parseInt(el.textContent) || 0;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + (target - start) * eased);

            el.textContent = current.toLocaleString();

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    },
};
