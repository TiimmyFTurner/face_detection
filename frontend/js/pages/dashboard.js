/**
 * Dashboard Page — Real-time event stream with stats and filtering.
 */
const DashboardPage = {
    _filter: 'all', // 'all' | 'known' | 'unknown'
    _viewMode: 'stream', // 'stream' | 'grouped'
    _events: [],
    _groupedEvents: [],

    /**
     * Load and render the dashboard page.
     */
    async load() {
        document.getElementById('page-title').textContent = I18n.t('dashboard_title');
        document.getElementById('header-actions').innerHTML = `
            <div class="live-indicator">
                <span class="live-dot"></span>
                ${I18n.t('live')}
            </div>
        `;

        const body = document.getElementById('content-body');
        body.innerHTML = `
            <!-- Stats Grid -->
            <div class="stats-grid" id="stats-grid">
                <div class="stat-card blue">
                    <div class="stat-label">${I18n.t('stat_total_today')}</div>
                    <div class="stat-value" id="stat-total">—</div>
                </div>
                <div class="stat-card emerald">
                    <div class="stat-label">${I18n.t('stat_known_today')}</div>
                    <div class="stat-value" id="stat-known">—</div>
                </div>
                <div class="stat-card rose">
                    <div class="stat-label">${I18n.t('stat_unknown_today')}</div>
                    <div class="stat-value" id="stat-unknown">—</div>
                </div>
                <div class="stat-card violet">
                    <div class="stat-label">${I18n.t('stat_active_cameras')}</div>
                    <div class="stat-value" id="stat-cameras">—</div>
                </div>
            </div>

            <!-- Filter & View Controls -->
            <div class="filter-bar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                <div class="filter-bar" id="filter-bar" style="margin-bottom: 0;">
                    <button class="filter-btn active" data-filter="all" onclick="DashboardPage.setFilter('all')">
                        ${I18n.t('filter_all')}
                    </button>
                    <button class="filter-btn" data-filter="known" onclick="DashboardPage.setFilter('known')">
                        ${I18n.t('filter_known')}
                    </button>
                    <button class="filter-btn" data-filter="unknown" onclick="DashboardPage.setFilter('unknown')">
                        ${I18n.t('filter_unknown')}
                    </button>
                </div>

                <div class="view-mode-toggle" style="display: flex; background: var(--bg-surface-hover); padding: 3px; border-radius: var(--radius-full); border: 1px solid var(--border-medium);">
                    <button class="filter-btn ${DashboardPage._viewMode === 'stream' ? 'active' : ''}" id="btn-mode-stream" onclick="DashboardPage.setViewMode('stream')">
                        ${I18n.t('mode_stream')}
                    </button>
                    <button class="filter-btn ${DashboardPage._viewMode === 'grouped' ? 'active' : ''}" id="btn-mode-grouped" onclick="DashboardPage.setViewMode('grouped')">
                        ${I18n.t('mode_grouped')}
                    </button>
                </div>
            </div>

            <!-- Events Grid -->
            <div class="events-grid" id="events-grid">
                <div class="empty-state">
                    <div class="empty-state-icon">📡</div>
                    <div class="empty-state-title">${I18n.t('loading')}</div>
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
     * Load events list with current filter and view mode.
     */
    async loadEvents() {
        try {
            if (DashboardPage._viewMode === 'grouped') {
                let url = '/api/events/grouped?limit_per_group=15';
                if (DashboardPage._filter === 'known') url += '&is_known=true';
                if (DashboardPage._filter === 'unknown') url += '&is_known=false';

                DashboardPage._groupedEvents = await App.api(url);
                DashboardPage.renderGroupedEvents();
            } else {
                let url = '/api/events?limit=50';
                if (DashboardPage._filter === 'known') url += '&is_known=true';
                if (DashboardPage._filter === 'unknown') url += '&is_known=false';

                const data = await App.api(url);
                DashboardPage._events = data.events || [];
                DashboardPage.renderEvents();
            }
        } catch (err) {
            console.error('Failed to load events:', err);
            document.getElementById('events-grid').innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-title">${I18n.t('failed_load_events')}</div>
                    <div class="empty-state-text">${err.message}</div>
                </div>
            `;
        }
    },

    /**
     * Render chronological activity stream.
     */
    renderEvents() {
        const grid = document.getElementById('events-grid');
        if (!grid) return;
        grid.style.display = 'grid';

        if (DashboardPage._events.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-title">${I18n.t('no_events_title')}</div>
                    <div class="empty-state-text">
                        ${I18n.t('no_events_desc')}
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
     * Render categorized person groups.
     */
    renderGroupedEvents() {
        const grid = document.getElementById('events-grid');
        if (!grid) return;

        if (DashboardPage._groupedEvents.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-title">${I18n.t('no_grouped_title')}</div>
                    <div class="empty-state-text">
                        ${I18n.t('no_grouped_desc')}
                    </div>
                </div>
            `;
            return;
        }

        grid.style.display = 'flex';
        grid.style.flexDirection = 'column';
        grid.style.gap = '1.25rem';

        grid.innerHTML = DashboardPage._groupedEvents.map(group => {
            const isKnown = group.is_known;
            const statusClass = isKnown ? 'known' : 'unknown';
            const badgeText = isKnown ? I18n.t('known_identity') : I18n.t('unidentified');
            const latestTimeStr = I18n.formatTimestamp(group.latest_timestamp);
            const countStr = I18n.isRTL() ? I18n.toPersianDigits(group.total_detections) : group.total_detections;
            const personDisplayName = group.person_name || I18n.t('unknown');

            return `
                <div class="person-category-card" style="background: var(--bg-glass); backdrop-filter: blur(12px); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.25rem; border-left: 4px solid ${isKnown ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
                    <div class="category-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0;">${EventCard.escapeHtml(personDisplayName)}</h3>
                            <span class="event-badge ${statusClass}">${badgeText}</span>
                            <span style="background: var(--bg-surface-hover); padding: 0.2rem 0.6rem; border-radius: var(--radius-full); font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); border: 1px solid var(--border-subtle);">
                                📸 ${I18n.t('detections_count', { count: countStr })}
                            </span>
                        </div>
                        <span style="font-size: 0.8rem; color: var(--text-tertiary);">${I18n.t('latest_time', { time: latestTimeStr })}</span>
                    </div>

                    <!-- Photo Gallery Strip -->
                    <div class="person-photo-gallery" style="display: flex; gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 1rem; scrollbar-width: thin;">
                        ${group.events.map(ev => {
                            // Ensure cache populated for clicking
                            EventCard._cache[ev.id] = ev;
                            const timeLabel = I18n.formatTimestamp(ev.timestamp);
                            const camName = ev.camera_name || (I18n.t('event_camera') + ' ' + (I18n.isRTL() ? I18n.toPersianDigits(ev.camera_id) : ev.camera_id));
                            return `
                                <div class="gallery-item" onclick="EventCard.showDetailModal(${ev.id})" style="flex: 0 0 auto; width: 110px; cursor: pointer; text-align: center; background: var(--bg-surface-hover); border-radius: var(--radius-md); padding: 6px; border: 1px solid var(--border-subtle); transition: transform 150ms ease;" title="${EventCard.escapeAttr(I18n.t('click_to_view'))}">
                                    <img src="${ev.snapshot_url}" alt="${EventCard.escapeHtml(ev.person_name || I18n.t('unknown'))}" style="width: 100%; height: 90px; object-fit: cover; border-radius: var(--radius-sm); display: block; margin-bottom: 4px;" />
                                    <div style="font-size: 0.7rem; font-weight: 600; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${EventCard.escapeHtml(camName)}</div>
                                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">${timeLabel}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- History Timeline Summary -->
                    <div class="person-timeline-summary" style="display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.75rem; color: var(--text-tertiary);">
                        ${group.events.slice(0, 4).map(ev => {
                            const camName = ev.camera_name || (I18n.t('event_camera') + ' ' + (I18n.isRTL() ? I18n.toPersianDigits(ev.camera_id) : ev.camera_id));
                            const confScore = Math.round((ev.confidence_score || 0) * 100);
                            const confStr = I18n.isRTL() ? I18n.toPersianDigits(confScore) : confScore;
                            return `
                                <span style="background: rgba(255, 255, 255, 0.04); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                    📹 ${EventCard.escapeHtml(camName)} — ${I18n.formatTimestamp(ev.timestamp)} (${confStr}%)
                                </span>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Switch view mode ('stream' | 'grouped').
     */
    setViewMode(mode) {
        DashboardPage._viewMode = mode;
        document.getElementById('btn-mode-stream').classList.toggle('active', mode === 'stream');
        document.getElementById('btn-mode-grouped').classList.toggle('active', mode === 'grouped');
        DashboardPage.loadEvents();
    },

    /**
     * Set the active filter and reload events.
     */
    setFilter(filter) {
        DashboardPage._filter = filter;

        // Update filter button states
        document.querySelectorAll('#filter-bar .filter-btn').forEach(btn => {
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

            el.textContent = I18n.formatNumber(current);

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    },
};
