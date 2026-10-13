/**
 * Dashboard Page — Real-time event stream with stats, search and filtering.
 */
const DashboardPage = {
    _filter: 'all', // 'all' | 'known' | 'unknown'
    _viewMode: 'stream', // 'stream' | 'grouped'
    _displayMode: localStorage.getItem('facetrack_view_dashboard') || 'grid', // 'grid' | 'list'
    _searchQuery: '',
    _selectedCameraId: '',
    _timeWindow: 'all', // 'all' | '15m' | '1h' | 'today' | '24h' | '7d' | 'custom'
    _customStartTime: '',
    _customEndTime: '',
    _cameras: [],
    _searchTimeout: null,
    _events: [],
    _groupedEvents: [],
    _eventPage: 1,
    _eventLimit: 30,
    _eventTotal: 0,
    _eventLoading: false,

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    escapeAttr(str) {
        if (!str) return '';
        return String(str).replace(/"/g, '&quot;');
    },

    formatDatetimeLocal(date) {
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },

    /**
     * Compute ISO start and end strings based on current _timeWindow.
     */
    getTimeWindowRange() {
        let startIso = null;
        let endIso = null;
        const now = new Date();

        switch (DashboardPage._timeWindow) {
            case '15m':
                startIso = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
                break;
            case '1h':
                startIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
                break;
            case 'today': {
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                startIso = startOfToday.toISOString();
                break;
            }
            case '24h':
                startIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
                break;
            case '7d':
                startIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
                break;
            case 'custom':
                startIso = DashboardPage._customStartTime || null;
                endIso = DashboardPage._customEndTime || null;
                break;
            case 'all':
            default:
                break;
        }
        return { startIso, endIso };
    },

    /**
     * Switch display layout ('grid' | 'list').
     */
    setDisplayMode(mode) {
        DashboardPage._displayMode = mode;
        try {
            localStorage.setItem('facetrack_view_dashboard', mode);
        } catch (e) {}

        const gridBtn = document.getElementById('dashboard-view-grid');
        const listBtn = document.getElementById('dashboard-view-list');
        if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
        if (listBtn) listBtn.classList.toggle('active', mode === 'list');

        if (DashboardPage._viewMode === 'stream') {
            DashboardPage.renderEvents();
        } else {
            DashboardPage.renderGroupedEvents();
        }
    },

    /**
     * Load and render the dashboard page.
     */
    async load() {
        document.getElementById('page-title').textContent = I18n.t('dashboard_title');
        document.getElementById('header-actions').innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button class="btn btn-secondary btn-sm" onclick="SettingsModal.show()" title="${I18n.t('nav_settings')}" style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>⚙️</span>
                    <span>${I18n.t('nav_settings')}</span>
                </button>
                <div class="live-indicator">
                    <span class="live-dot"></span>
                    ${I18n.t('live')}
                </div>
            </div>
        `;

        const isRtl = I18n.isRTL();
        const body = document.getElementById('content-body');
        body.innerHTML = `
            <!-- Stats Grid -->
            <div class="stats-grid" id="stats-grid">
                <div class="stat-card blue">
                    <div class="stat-card-header">
                        <span class="stat-card-title">${I18n.t('stat_total_today')}</span>
                        <div class="stat-card-icon">📊</div>
                    </div>
                    <div class="stat-card-body">
                        <span class="stat-card-value stat-value" id="stat-total">—</span>
                    </div>
                    <div class="stat-card-footer">
                        <span class="stat-card-badge blue">
                            ⚡ ${isRtl ? 'ثبت‌های امروز' : 'Today Detections'}
                        </span>
                    </div>
                </div>
                <div class="stat-card emerald">
                    <div class="stat-card-header">
                        <span class="stat-card-title">${I18n.t('stat_known_today')}</span>
                        <div class="stat-card-icon">👤</div>
                    </div>
                    <div class="stat-card-body">
                        <span class="stat-card-value stat-value" id="stat-known">—</span>
                    </div>
                    <div class="stat-card-footer">
                        <span class="stat-card-badge emerald">
                            <span class="status-indicator active" style="width: 7px; height: 7px; margin-inline-end: 2px;"></span>
                            ${isRtl ? 'پرسنل شناسایی‌شده' : 'Verified Staff'}
                        </span>
                    </div>
                </div>
                <div class="stat-card rose">
                    <div class="stat-card-header">
                        <span class="stat-card-title">${I18n.t('stat_unknown_today')}</span>
                        <div class="stat-card-icon">❓</div>
                    </div>
                    <div class="stat-card-body">
                        <span class="stat-card-value stat-value" id="stat-unknown">—</span>
                    </div>
                    <div class="stat-card-footer">
                        <span class="stat-card-badge rose">
                            🛡️ ${isRtl ? 'افراد ناشناس' : 'Unregistered'}
                        </span>
                    </div>
                </div>
                <div class="stat-card violet" id="stat-card-cameras">
                    <div class="stat-card-header">
                        <span class="stat-card-title">${I18n.t('stat_active_cameras')}</span>
                        <div class="stat-card-icon">📹</div>
                    </div>
                    <div class="stat-card-body">
                        <span class="stat-card-value stat-value" id="stat-cameras">—</span>
                    </div>
                    <div class="stat-card-footer">
                        <span class="stat-card-badge violet" id="stat-cameras-badge">
                            ${isRtl ? 'در حال بررسی...' : 'Checking...'}
                        </span>
                    </div>
                </div>
            </div>

            <!-- Enhanced Filter & Search Toolbar Card -->
            <div class="dashboard-filter-card" id="dashboard-filter-card">
                <div class="dashboard-filter-primary-row">
                    <!-- Search by Person or Camera -->
                    <div class="dashboard-search-box">
                        <span class="dashboard-search-icon">🔍</span>
                        <input 
                            type="text" 
                            id="dashboard-search-input" 
                            placeholder="${DashboardPage.escapeAttr(I18n.t('search_dashboard_placeholder'))}" 
                            value="${DashboardPage.escapeAttr(DashboardPage._searchQuery)}"
                            oninput="DashboardPage.handleSearchInput(this.value)"
                            onkeydown="if(event.key === 'Enter'){ DashboardPage.handleSearchInput(this.value); }"
                        />
                        <button 
                            type="button" 
                            id="dashboard-search-clear" 
                            class="dashboard-search-clear" 
                            onclick="DashboardPage.clearSearch()" 
                            title="${I18n.t('cancel')}"
                            style="display: ${DashboardPage._searchQuery ? 'flex' : 'none'};"
                        >✕</button>
                    </div>

                    <!-- Camera Selector Dropdown -->
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <select 
                            id="dashboard-camera-select" 
                            class="dashboard-filter-select ${DashboardPage._selectedCameraId ? 'active-filter' : ''}" 
                            onchange="DashboardPage.handleCameraChange(this.value)"
                            title="${I18n.t('filter_camera_label')}"
                        >
                            <option value="">📹 ${I18n.t('filter_all_cameras')}</option>
                        </select>
                    </div>

                    <!-- Time Window Preset Dropdown -->
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <select 
                            id="dashboard-time-window-select" 
                            class="dashboard-filter-select ${DashboardPage._timeWindow !== 'all' ? 'active-filter' : ''}" 
                            onchange="DashboardPage.handleTimeWindowChange(this.value)"
                            title="${I18n.t('filter_time_window')}"
                        >
                            <option value="all" ${DashboardPage._timeWindow === 'all' ? 'selected' : ''}>⏱️ ${I18n.t('time_window_all')}</option>
                            <option value="15m" ${DashboardPage._timeWindow === '15m' ? 'selected' : ''}>⚡ ${I18n.t('time_window_15m')}</option>
                            <option value="1h" ${DashboardPage._timeWindow === '1h' ? 'selected' : ''}>🕐 ${I18n.t('time_window_1h')}</option>
                            <option value="today" ${DashboardPage._timeWindow === 'today' ? 'selected' : ''}>📅 ${I18n.t('time_window_today')}</option>
                            <option value="24h" ${DashboardPage._timeWindow === '24h' ? 'selected' : ''}>⏳ ${I18n.t('time_window_24h')}</option>
                            <option value="7d" ${DashboardPage._timeWindow === '7d' ? 'selected' : ''}>🗓️ ${I18n.t('time_window_7d')}</option>
                            <option value="custom" ${DashboardPage._timeWindow === 'custom' ? 'selected' : ''}>⚙️ ${I18n.t('time_window_custom')}</option>
                        </select>
                    </div>

                    <!-- Known / Unknown Status Buttons -->
                    <div class="filter-bar" id="filter-bar" style="margin-bottom: 0;">
                        <button class="filter-btn ${DashboardPage._filter === 'all' ? 'active' : ''}" data-filter="all" onclick="DashboardPage.setFilter('all')">
                            ${I18n.t('filter_all')}
                        </button>
                        <button class="filter-btn ${DashboardPage._filter === 'known' ? 'active' : ''}" data-filter="known" onclick="DashboardPage.setFilter('known')">
                            ${I18n.t('filter_known')}
                        </button>
                        <button class="filter-btn ${DashboardPage._filter === 'unknown' ? 'active' : ''}" data-filter="unknown" onclick="DashboardPage.setFilter('unknown')">
                            ${I18n.t('filter_unknown')}
                        </button>
                    </div>

                    <!-- View Mode & Layout Toggles -->
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <div class="view-mode-toggle" style="display: flex; background: var(--bg-surface-hover); padding: 3px; border-radius: var(--radius-full); border: 1px solid var(--border-medium);">
                            <button class="filter-btn ${DashboardPage._viewMode === 'stream' ? 'active' : ''}" id="btn-mode-stream" onclick="DashboardPage.setViewMode('stream')">
                                ${I18n.t('mode_stream')}
                            </button>
                            <button class="filter-btn ${DashboardPage._viewMode === 'grouped' ? 'active' : ''}" id="btn-mode-grouped" onclick="DashboardPage.setViewMode('grouped')">
                                ${I18n.t('mode_grouped')}
                            </button>
                        </div>

                        <div class="view-toggle-group" role="group" aria-label="View mode">
                            <button class="view-toggle-btn ${DashboardPage._displayMode === 'grid' ? 'active' : ''}" 
                                    id="dashboard-view-grid" 
                                    onclick="DashboardPage.setDisplayMode('grid')" 
                                    title="${I18n.t('view_grid')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>
                                <span>${I18n.t('view_grid')}</span>
                            </button>
                            <button class="view-toggle-btn ${DashboardPage._displayMode === 'list' ? 'active' : ''}" 
                                    id="dashboard-view-list" 
                                    onclick="DashboardPage.setDisplayMode('list')" 
                                    title="${I18n.t('view_list')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                <span>${I18n.t('view_list')}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Custom Time Range Bar (Expandable) -->
                <div class="custom-time-range-bar" id="custom-time-range-bar" style="display: ${DashboardPage._timeWindow === 'custom' ? 'flex' : 'none'};">
                    <div class="custom-time-input-group">
                        <span>📅 ${I18n.t('custom_start_time')}</span>
                        <input type="datetime-local" id="filter-start-time" onchange="DashboardPage.applyCustomTimeRange()" />
                    </div>
                    <div class="custom-time-input-group">
                        <span>📅 ${I18n.t('custom_end_time')}</span>
                        <input type="datetime-local" id="filter-end-time" onchange="DashboardPage.applyCustomTimeRange()" />
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="DashboardPage.applyCustomTimeRange()">
                        ${I18n.t('btn_apply_filter')}
                    </button>
                </div>

                <!-- Active Filters & Summary Strip -->
                <div class="active-filters-strip" id="active-filters-strip" style="display: none;">
                    <div class="filter-chips-list" id="filter-chips-list"></div>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span id="matching-events-counter" style="color: var(--text-secondary); font-size: 0.75rem; font-weight: 600;"></span>
                        <button class="clear-all-filters-btn" onclick="DashboardPage.clearAllFilters()">
                            ✕ ${I18n.t('btn_clear_filters')}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Events Grid & Pagination Container -->
            <div id="events-container" style="display: flex; flex-direction: column; gap: 1.25rem;">
                <div class="events-grid ${DashboardPage._displayMode === 'list' ? 'list-view' : ''}" id="events-grid">
                    <div class="empty-state">
                        <div class="spinner"></div>
                        <div class="empty-state-title">${I18n.t('loading')}</div>
                    </div>
                </div>
                <div id="events-pagination"></div>
            </div>
        `;

        // Load data in parallel
        await Promise.all([
            DashboardPage.loadStats(),
            DashboardPage.loadCameras(),
            DashboardPage.loadEvents(1),
        ]);
    },

    /**
     * Load cameras to populate the camera filter dropdown.
     */
    async loadCameras() {
        try {
            DashboardPage._cameras = await App.api('/api/cameras');
            DashboardPage.renderCameraSelect();
        } catch (err) {
            console.warn('Could not load camera list for filter:', err);
            DashboardPage._cameras = [];
        }
    },

    /**
     * Populate camera select options.
     */
    renderCameraSelect() {
        const sel = document.getElementById('dashboard-camera-select');
        if (!sel) return;
        const isRtl = I18n.isRTL();
        const currVal = String(DashboardPage._selectedCameraId || '');
        let html = `<option value="">📹 ${I18n.t('filter_all_cameras')}</option>`;
        for (const cam of (DashboardPage._cameras || [])) {
            const loc = cam.location ? ` (${cam.location})` : '';
            const isSelected = String(cam.id) === currVal ? 'selected' : '';
            html += `<option value="${cam.id}" ${isSelected}>📹 ${DashboardPage.escapeHtml(cam.name)}${DashboardPage.escapeHtml(loc)}</option>`;
        }
        sel.innerHTML = html;
        sel.classList.toggle('active-filter', !!currVal);
    },

    /**
     * Handle search input typing with debouncing.
     */
    handleSearchInput(val) {
        if (DashboardPage._searchTimeout) {
            clearTimeout(DashboardPage._searchTimeout);
        }
        const trimmed = (val || '').trim();
        const clearBtn = document.getElementById('dashboard-search-clear');
        if (clearBtn) {
            clearBtn.style.display = trimmed ? 'flex' : 'none';
        }
        DashboardPage._searchTimeout = setTimeout(() => {
            DashboardPage._searchQuery = trimmed;
            DashboardPage._eventPage = 1;
            DashboardPage.loadEvents(1);
        }, 300);
    },

    /**
     * Clear search input and reload events.
     */
    clearSearch() {
        const inp = document.getElementById('dashboard-search-input');
        if (inp) inp.value = '';
        const clearBtn = document.getElementById('dashboard-search-clear');
        if (clearBtn) clearBtn.style.display = 'none';
        DashboardPage._searchQuery = '';
        DashboardPage._eventPage = 1;
        DashboardPage.loadEvents(1);
    },

    /**
     * Handle camera dropdown selection change.
     */
    handleCameraChange(val) {
        DashboardPage._selectedCameraId = val || '';
        const sel = document.getElementById('dashboard-camera-select');
        if (sel) {
            sel.classList.toggle('active-filter', !!DashboardPage._selectedCameraId);
        }
        DashboardPage._eventPage = 1;
        DashboardPage.loadEvents(1);
    },

    /**
     * Handle time window preset selection change.
     */
    handleTimeWindowChange(val) {
        DashboardPage._timeWindow = val || 'all';
        const customPanel = document.getElementById('custom-time-range-bar');
        const sel = document.getElementById('dashboard-time-window-select');
        if (sel) {
            sel.classList.toggle('active-filter', DashboardPage._timeWindow !== 'all');
        }

        if (DashboardPage._timeWindow === 'custom') {
            if (customPanel) customPanel.style.display = 'flex';
            const startInput = document.getElementById('filter-start-time');
            const endInput = document.getElementById('filter-end-time');
            if (startInput && !startInput.value) {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                startInput.value = DashboardPage.formatDatetimeLocal(d);
                DashboardPage._customStartTime = d.toISOString();
            }
            if (endInput && !endInput.value) {
                const now = new Date();
                endInput.value = DashboardPage.formatDatetimeLocal(now);
                DashboardPage._customEndTime = now.toISOString();
            }
            DashboardPage._eventPage = 1;
            DashboardPage.loadEvents(1);
        } else {
            if (customPanel) customPanel.style.display = 'none';
            DashboardPage._customStartTime = '';
            DashboardPage._customEndTime = '';
            DashboardPage._eventPage = 1;
            DashboardPage.loadEvents(1);
        }
    },

    /**
     * Apply custom start/end time range.
     */
    applyCustomTimeRange() {
        const startInput = document.getElementById('filter-start-time');
        const endInput = document.getElementById('filter-end-time');
        if (startInput && startInput.value) {
            DashboardPage._customStartTime = new Date(startInput.value).toISOString();
        } else {
            DashboardPage._customStartTime = '';
        }
        if (endInput && endInput.value) {
            DashboardPage._customEndTime = new Date(endInput.value).toISOString();
        } else {
            DashboardPage._customEndTime = '';
        }
        DashboardPage._eventPage = 1;
        DashboardPage.loadEvents(1);
    },

    /**
     * Reset all active filters (search, camera, time, status).
     */
    clearAllFilters() {
        DashboardPage._searchQuery = '';
        DashboardPage._selectedCameraId = '';
        DashboardPage._timeWindow = 'all';
        DashboardPage._customStartTime = '';
        DashboardPage._customEndTime = '';
        DashboardPage._filter = 'all';

        const searchInput = document.getElementById('dashboard-search-input');
        if (searchInput) searchInput.value = '';
        const searchClear = document.getElementById('dashboard-search-clear');
        if (searchClear) searchClear.style.display = 'none';

        const camSelect = document.getElementById('dashboard-camera-select');
        if (camSelect) {
            camSelect.value = '';
            camSelect.classList.remove('active-filter');
        }

        const timeSelect = document.getElementById('dashboard-time-window-select');
        if (timeSelect) {
            timeSelect.value = 'all';
            timeSelect.classList.remove('active-filter');
        }

        const customPanel = document.getElementById('custom-time-range-bar');
        if (customPanel) customPanel.style.display = 'none';

        document.querySelectorAll('#filter-bar .filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === 'all');
        });

        DashboardPage._eventPage = 1;
        DashboardPage.loadEvents(1);
    },

    /**
     * Remove a specific individual filter.
     */
    removeFilter(type) {
        if (type === 'search') {
            DashboardPage.clearSearch();
        } else if (type === 'camera') {
            DashboardPage._selectedCameraId = '';
            const sel = document.getElementById('dashboard-camera-select');
            if (sel) {
                sel.value = '';
                sel.classList.remove('active-filter');
            }
            DashboardPage._eventPage = 1;
            DashboardPage.loadEvents(1);
        } else if (type === 'time') {
            DashboardPage.handleTimeWindowChange('all');
            const sel = document.getElementById('dashboard-time-window-select');
            if (sel) {
                sel.value = 'all';
                sel.classList.remove('active-filter');
            }
        } else if (type === 'status') {
            DashboardPage.setFilter('all');
        }
    },

    /**
     * Render active filter tags and matching events counter.
     */
    renderActiveFilters() {
        const strip = document.getElementById('active-filters-strip');
        const chipsList = document.getElementById('filter-chips-list');
        const counter = document.getElementById('matching-events-counter');
        if (!strip || !chipsList) return;

        const chips = [];
        const isRtl = I18n.isRTL();

        if (DashboardPage._searchQuery) {
            chips.push(`
                <span class="filter-chip">
                    <span>🔍 ${I18n.t('filter_badge_search', { query: DashboardPage.escapeHtml(DashboardPage._searchQuery) })}</span>
                    <span class="filter-chip-remove" onclick="DashboardPage.removeFilter('search')" title="${I18n.t('delete')}">✕</span>
                </span>
            `);
        }

        if (DashboardPage._selectedCameraId) {
            const cam = (DashboardPage._cameras || []).find(c => String(c.id) === String(DashboardPage._selectedCameraId));
            const camName = cam ? cam.name : `${I18n.t('event_camera')} #${DashboardPage._selectedCameraId}`;
            chips.push(`
                <span class="filter-chip">
                    <span>📹 ${I18n.t('filter_badge_camera', { camera: DashboardPage.escapeHtml(camName) })}</span>
                    <span class="filter-chip-remove" onclick="DashboardPage.removeFilter('camera')" title="${I18n.t('delete')}">✕</span>
                </span>
            `);
        }

        if (DashboardPage._timeWindow && DashboardPage._timeWindow !== 'all') {
            let label = '';
            if (DashboardPage._timeWindow === '15m') label = I18n.t('time_window_15m');
            else if (DashboardPage._timeWindow === '1h') label = I18n.t('time_window_1h');
            else if (DashboardPage._timeWindow === 'today') label = I18n.t('time_window_today');
            else if (DashboardPage._timeWindow === '24h') label = I18n.t('time_window_24h');
            else if (DashboardPage._timeWindow === '7d') label = I18n.t('time_window_7d');
            else if (DashboardPage._timeWindow === 'custom') {
                if (DashboardPage._customStartTime || DashboardPage._customEndTime) {
                    const s = DashboardPage._customStartTime ? I18n.formatDateNumeric(DashboardPage._customStartTime) : '...';
                    const e = DashboardPage._customEndTime ? I18n.formatDateNumeric(DashboardPage._customEndTime) : '...';
                    label = `${s} → ${e}`;
                } else {
                    label = I18n.t('time_window_custom');
                }
            }
            chips.push(`
                <span class="filter-chip">
                    <span>⏱️ ${I18n.t('filter_badge_time', { window: label })}</span>
                    <span class="filter-chip-remove" onclick="DashboardPage.removeFilter('time')" title="${I18n.t('delete')}">✕</span>
                </span>
            `);
        }

        if (DashboardPage._filter && DashboardPage._filter !== 'all') {
            const statusLabel = DashboardPage._filter === 'known' ? I18n.t('filter_known') : I18n.t('filter_unknown');
            chips.push(`
                <span class="filter-chip">
                    <span>${statusLabel}</span>
                    <span class="filter-chip-remove" onclick="DashboardPage.removeFilter('status')" title="${I18n.t('delete')}">✕</span>
                </span>
            `);
        }

        if (chips.length > 0) {
            strip.style.display = 'flex';
            chipsList.innerHTML = chips.join('');
            if (counter) {
                const countStr = isRtl ? I18n.toPersianDigits(DashboardPage._eventTotal) : DashboardPage._eventTotal;
                counter.textContent = I18n.t('filter_matching_count', { count: countStr });
            }
        } else {
            strip.style.display = 'none';
            chipsList.innerHTML = '';
            if (counter) counter.textContent = '';
        }
    },

    /**
     * Load summary statistics.
     */
    async loadStats() {
        try {
            const stats = await App.api('/api/events/stats');
            const isRtl = I18n.isRTL();
            DashboardPage.animateCounter('stat-total', stats.total_today);
            DashboardPage.animateCounter('stat-known', stats.known_today);
            DashboardPage.animateCounter('stat-unknown', stats.unknown_today);

            const activeCams = stats.active_cameras || 0;
            const totalCams = stats.total_cameras !== undefined ? stats.total_cameras : activeCams;
            DashboardPage.animateCounter('stat-cameras', activeCams);

            const camValueEl = document.getElementById('stat-cameras');
            const badgeEl = document.getElementById('stat-cameras-badge');

            const activeStr = isRtl ? I18n.toPersianDigits(activeCams) : activeCams;
            const totalStr = isRtl ? I18n.toPersianDigits(totalCams) : totalCams;

            if (badgeEl) {
                if (totalCams === 0) {
                    badgeEl.className = 'stat-card-badge violet';
                    badgeEl.innerHTML = `⚪ ${isRtl ? 'بدون دوربین' : 'No Cameras'}`;
                    if (camValueEl) {
                        camValueEl.style.color = '';
                        camValueEl.style.textShadow = '';
                    }
                } else if (activeCams > 0 && activeCams === totalCams) {
                    badgeEl.className = 'stat-card-badge emerald';
                    badgeEl.innerHTML = `🟢 ${activeStr} / ${totalStr} ${isRtl ? 'آنلاین' : 'Online'}`;
                    if (camValueEl) {
                        camValueEl.style.color = '#34d399';
                        camValueEl.style.textShadow = '0 0 16px rgba(16, 185, 129, 0.25)';
                    }
                } else if (activeCams > 0) {
                    badgeEl.className = 'stat-card-badge amber';
                    badgeEl.innerHTML = `⚠️ ${activeStr} / ${totalStr} ${isRtl ? 'آنلاین' : 'Online'}`;
                    if (camValueEl) {
                        camValueEl.style.color = '#fbbf24';
                        camValueEl.style.textShadow = '0 0 16px rgba(245, 158, 11, 0.25)';
                    }
                } else {
                    badgeEl.className = 'stat-card-badge rose';
                    badgeEl.innerHTML = `🔴 0 / ${totalStr} ${isRtl ? 'آنلاین (قطع ارتباط)' : 'Online (Disconnected)'}`;
                    if (camValueEl) {
                        camValueEl.style.color = '#fb7185';
                        camValueEl.style.textShadow = '0 0 16px rgba(244, 63, 94, 0.25)';
                    }
                }
            }
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    },

    /**
     * Load events list with current filters and view mode.
     */
    async loadEvents(page = DashboardPage._eventPage) {
        DashboardPage._eventLoading = true;
        try {
            const { startIso, endIso } = DashboardPage.getTimeWindowRange();

            if (DashboardPage._viewMode === 'grouped') {
                let url = '/api/events/grouped?limit_per_group=15';
                if (DashboardPage._filter === 'known') url += '&is_known=true';
                if (DashboardPage._filter === 'unknown') url += '&is_known=false';
                if (DashboardPage._searchQuery) url += `&search=${encodeURIComponent(DashboardPage._searchQuery)}`;
                if (DashboardPage._selectedCameraId) url += `&camera_id=${encodeURIComponent(DashboardPage._selectedCameraId)}`;
                if (startIso) url += `&start_time=${encodeURIComponent(startIso)}`;
                if (endIso) url += `&end_time=${encodeURIComponent(endIso)}`;

                DashboardPage._groupedEvents = await App.api(url);
                DashboardPage._eventTotal = DashboardPage._groupedEvents.length;
                DashboardPage.renderGroupedEvents();
                const pagContainer = document.getElementById('events-pagination');
                if (pagContainer) pagContainer.innerHTML = '';
            } else {
                const offset = Math.max(0, (page - 1) * DashboardPage._eventLimit);
                let url = `/api/events?limit=${DashboardPage._eventLimit}&offset=${offset}`;
                if (DashboardPage._filter === 'known') url += '&is_known=true';
                if (DashboardPage._filter === 'unknown') url += '&is_known=false';
                if (DashboardPage._searchQuery) url += `&search=${encodeURIComponent(DashboardPage._searchQuery)}`;
                if (DashboardPage._selectedCameraId) url += `&camera_id=${encodeURIComponent(DashboardPage._selectedCameraId)}`;
                if (startIso) url += `&start_time=${encodeURIComponent(startIso)}`;
                if (endIso) url += `&end_time=${encodeURIComponent(endIso)}`;

                const data = await App.api(url);
                DashboardPage._events = data.events || [];
                DashboardPage._eventTotal = data.total || 0;
                DashboardPage._eventPage = page;
                DashboardPage.renderEvents();
            }
            DashboardPage.renderActiveFilters();
        } catch (err) {
            console.error('Failed to load events:', err);
            document.getElementById('events-grid').innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-title">${I18n.t('failed_load_events')}</div>
                    <div class="empty-state-text">${err.message}</div>
                </div>
            `;
        } finally {
            DashboardPage._eventLoading = false;
        }
    },

    async changeEventLimit(limit) {
        DashboardPage._eventLimit = parseInt(limit, 10) || 30;
        await DashboardPage.loadEvents(1);
    },

    async goToEventPage(page) {
        await DashboardPage.loadEvents(page);
    },

    /**
     * Render chronological activity stream with pagination bar.
     */
    renderEvents() {
        const grid = document.getElementById('events-grid');
        const pagContainer = document.getElementById('events-pagination');
        if (!grid) return;

        const isList = DashboardPage._displayMode === 'list';
        grid.classList.toggle('list-view', isList);
        if (isList) {
            grid.style.display = 'flex';
            grid.style.flexDirection = 'column';
            grid.style.gap = '0.75rem';
        } else {
            grid.style.display = 'grid';
            grid.style.flexDirection = '';
            grid.style.gap = '';
        }

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
            if (pagContainer) pagContainer.innerHTML = '';
            return;
        }

        grid.innerHTML = DashboardPage._events
            .map(event => isList ? EventCard.renderListItem(event) : EventCard.render(event))
            .join('');

        if (pagContainer) {
            const total = DashboardPage._eventTotal || DashboardPage._events.length;
            const limit = DashboardPage._eventLimit || 30;
            const page = DashboardPage._eventPage || 1;
            const totalPages = Math.max(1, Math.ceil(total / limit));
            const from = total === 0 ? 0 : (page - 1) * limit + 1;
            const to = Math.min(total, page * limit);

            const fromFormatted = I18n.isRTL() ? I18n.toPersianDigits(from) : from;
            const toFormatted = I18n.isRTL() ? I18n.toPersianDigits(to) : to;
            const totalFormatted = I18n.isRTL() ? I18n.toPersianDigits(total) : total;
            const pageFormatted = I18n.isRTL() ? I18n.toPersianDigits(page) : page;
            const totalPagesFormatted = I18n.isRTL() ? I18n.toPersianDigits(totalPages) : totalPages;

            pagContainer.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.25rem; background: var(--bg-surface-hover); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.75rem; margin-top: 0.5rem;">
                    <div style="font-size: 0.82rem; color: var(--text-secondary);">
                        ${I18n.t('pagination_showing', { from: fromFormatted, to: toFormatted, total: totalFormatted })}
                    </div>

                    <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: var(--text-tertiary);">
                            <span>${I18n.t('pagination_per_page')}</span>
                            <select class="form-input" style="padding: 0.25rem 0.5rem; font-size: 0.82rem; width: auto;" onchange="DashboardPage.changeEventLimit(this.value)">
                                <option value="20" ${limit === 20 ? 'selected' : ''}>20</option>
                                <option value="30" ${limit === 30 ? 'selected' : ''}>30</option>
                                <option value="50" ${limit === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${limit === 100 ? 'selected' : ''}>100</option>
                            </select>
                        </div>

                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <button
                                class="btn btn-secondary btn-sm"
                                ${page <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}
                                onclick="DashboardPage.goToEventPage(${page - 1})"
                            >
                                ${I18n.t('pagination_prev')}
                            </button>
                            
                            <span style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary); padding: 0 0.4rem;">
                                ${I18n.t('pagination_page_of', { page: pageFormatted, totalPages: totalPagesFormatted })}
                            </span>

                            <button
                                class="btn btn-secondary btn-sm"
                                ${page >= totalPages ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}
                                onclick="DashboardPage.goToEventPage(${page + 1})"
                            >
                                ${I18n.t('pagination_next')}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
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

                    <!-- Events List / Photo Gallery Strip -->
                    ${DashboardPage._displayMode === 'list' ? `
                        <div class="events-grid list-view" style="margin-bottom: 0.75rem;">
                            ${group.events.map(ev => EventCard.renderListItem(ev)).join('')}
                        </div>
                    ` : `
                        <div class="person-photo-gallery" style="display: flex; gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 1rem; scrollbar-width: thin;">
                            ${group.events.map(ev => {
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
                    `}

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
        const streamBtn = document.getElementById('btn-mode-stream');
        const groupedBtn = document.getElementById('btn-mode-grouped');
        if (streamBtn) streamBtn.classList.toggle('active', mode === 'stream');
        if (groupedBtn) groupedBtn.classList.toggle('active', mode === 'grouped');
        DashboardPage.loadEvents(1);
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

        DashboardPage.loadEvents(1);
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

        // Check camera filter
        if (DashboardPage._selectedCameraId && String(eventData.camera_id) !== String(DashboardPage._selectedCameraId)) {
            return;
        }

        // Check search query filter (person or camera)
        if (DashboardPage._searchQuery) {
            const q = DashboardPage._searchQuery.toLowerCase();
            const pName = (eventData.person_name || '').toLowerCase();
            const cName = (eventData.camera_name || '').toLowerCase();
            if (!pName.includes(q) && !cName.includes(q)) {
                return;
            }
        }

        // Check time window if custom has ended in the past
        if (DashboardPage._timeWindow === 'custom' && DashboardPage._customEndTime) {
            const end = new Date(DashboardPage._customEndTime).getTime();
            if (Date.now() > end) return;
        }

        // Prepend to events list
        DashboardPage._events.unshift(eventData);

        // Keep max 50
        if (DashboardPage._events.length > 50) {
            DashboardPage._events = DashboardPage._events.slice(0, 50);
        }

        DashboardPage._eventTotal = (DashboardPage._eventTotal || 0) + 1;

        // Re-render
        if (DashboardPage._viewMode === 'stream') {
            DashboardPage.renderEvents();
        } else {
            // For grouped view, reload so grouping stays correct
            DashboardPage.loadEvents(1);
        }
        DashboardPage.renderActiveFilters();

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
