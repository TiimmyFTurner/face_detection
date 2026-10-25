/**
 * SupervisorCockpit — Dedicated executive dashboard for supervisors.
 * Strictly scoped to assigned personnel with zero image/snapshot rendering.
 * Features:
 * - Executive command strip with live Shamsi clock, telemetry radar, supervisor greeting
 * - Interactive 7-pod attendance KPI deck with proportional micro-progress bars & click-to-filter
 * - Enhanced roster toolbar: Section filter, Sort selector (Urgency, Name, Compliance, Absence),
 *   fuzzy search with keyboard shortcut (/), and Grid/List view mode toggle
 * - Premium personnel cards with deterministic privacy gradient avatars & pulsing beacon dots
 * - Individual staff today activity modal (text-only arrival/departure log)
 * - Text-only shift activity & alerts timeline with "All" vs "Alerts Only" filtering
 * - Full shift configuration and workstation zone assignment integration
 * - Daily leave and off-duty schedule management
 */
const SupervisorCockpit = {
    _rosterData: null,
    _persons: [],
    _events: [],
    _activeFilter: 'all', // 'all' | 'present' | 'grace' | 'break' | 'leave' | 'absent'
    _selectedSection: 'all',
    _sortBy: 'urgency', // 'urgency' | 'name' | 'compliance' | 'absence'
    _searchQuery: '',
    _viewMode: localStorage.getItem('supervisor_roster_view') || 'grid', // 'grid' | 'list'
    _timelineFilter: 'all', // 'all' | 'alerts'
    _autoRefreshTimer: null,
    _countdownTimer: null,
    _clockTimer: null,
    _keyListener: null,
    _countdown: 10,
    _isLoading: false,

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

    /**
     * Check if a given person ID (or camera ID) is assigned to this supervisor.
     * Ensures supervisors strictly only receive notifications for assigned personnel.
     */
    isPersonAssigned(personId, cameraId = null) {
        if (personId) {
            const pIdNum = Number(personId);
            // 1. Check in fetched persons
            if (this._persons && this._persons.length > 0) {
                return this._persons.some(p => p.id === pIdNum);
            }
            // 2. Check in roster data
            if (this._rosterData && Array.isArray(this._rosterData.roster)) {
                return this._rosterData.roster.some(r => r.person_id === pIdNum);
            }
            // 3. Fallback to Auth.getUser()
            const user = (typeof Auth !== 'undefined' && Auth.getUser()) || {};
            if (user.assigned_person_ids && user.assigned_person_ids.length > 0) {
                return user.assigned_person_ids.includes(pIdNum);
            }
        }
        if (cameraId) {
            const cIdNum = Number(cameraId);
            const user = (typeof Auth !== 'undefined' && Auth.getUser()) || {};
            if (user.assigned_camera_ids && user.assigned_camera_ids.length > 0) {
                return user.assigned_camera_ids.includes(cIdNum);
            }
        }
        return false;
    },

    /**
     * Deterministic vibrant gradient based on name hash.
     * Ensures 100% zero-photo privacy while looking visually stunning.
     */
    getAvatarGradient(name) {
        const palettes = [
            'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', // Indigo-Violet
            'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)', // Sky-Blue
            'linear-gradient(135deg, #059669 0%, #10b981 100%)', // Emerald-Green
            'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)', // Amber
            'linear-gradient(135deg, #db2777 0%, #f43f5e 100%)', // Rose
            'linear-gradient(135deg, #9333ea 0%, #c084fc 100%)', // Royal Purple
            'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)', // Cyan Ocean
            'linear-gradient(135deg, #c2410c 0%, #ea580c 100%)', // Warm Bronze
        ];
        let hash = 0;
        const str = String(name || 'Staff');
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % palettes.length;
        return palettes[index];
    },

    getGreeting() {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) return I18n.t('greeting_morning') || 'صبح بخیر';
        if (hour >= 12 && hour < 17) return I18n.t('greeting_afternoon') || 'عصر بخیر';
        return I18n.t('greeting_evening') || 'شب بخیر';
    },

    formatRelativeTime(isoString) {
        if (!isoString) return '';
        try {
            const now = Date.now();
            const then = new Date(isoString).getTime();
            const diffSec = Math.max(0, Math.floor((now - then) / 1000));
            const isRtl = I18n.isRTL();

            if (diffSec < 60) {
                return isRtl ? 'همین حالا' : 'just now';
            }
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin < 60) {
                return isRtl ? `${I18n.toPersianDigits(diffMin)} دقیقه پیش` : `${diffMin}m ago`;
            }
            const diffHour = Math.floor(diffMin / 60);
            if (diffHour < 24) {
                return isRtl ? `${I18n.toPersianDigits(diffHour)} ساعت پیش` : `${diffHour}h ago`;
            }
            return I18n.formatTimestamp ? I18n.formatTimestamp(isoString) : new Date(isoString).toLocaleTimeString();
        } catch (e) {
            return '';
        }
    },

    /**
     * Entry point when loading the supervisor dashboard.
     */
    async load() {
        this.cleanup();
        this.bindKeyboardShortcuts();
        this.renderSkeleton();
        await this.fetchData();
        this.startTimers();
    },

    /**
     * Global keyboard shortcuts (e.g. '/' to focus search).
     */
    bindKeyboardShortcuts() {
        this._keyListener = (e) => {
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                e.preventDefault();
                const searchInput = document.getElementById('sup-person-search');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }
        };
        window.addEventListener('keydown', this._keyListener);
    },

    /**
     * Cleanup background timers & listeners when navigating away.
     */
    cleanup() {
        if (this._autoRefreshTimer) {
            clearInterval(this._autoRefreshTimer);
            this._autoRefreshTimer = null;
        }
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer);
            this._countdownTimer = null;
        }
        if (this._clockTimer) {
            clearInterval(this._clockTimer);
            this._clockTimer = null;
        }
        if (this._keyListener) {
            window.removeEventListener('keydown', this._keyListener);
            this._keyListener = null;
        }
    },

    startTimers() {
        // Auto refresh countdown
        this._countdown = 10;
        this._countdownTimer = setInterval(() => {
            this._countdown -= 1;
            const el = document.getElementById('sup-countdown-val');
            if (el) el.textContent = this._countdown;
            if (this._countdown <= 0) {
                this._countdown = 10;
                this.fetchData(true);
            }
        }, 1000);

        // Digital clock & date update
        this.updateClock();
        this._clockTimer = setInterval(() => {
            this.updateClock();
        }, 1000);
    },

    updateClock() {
        const timeEl = document.getElementById('sup-live-time');
        const dateEl = document.getElementById('sup-live-date');
        if (!timeEl && !dateEl) return;

        const now = new Date();
        const isRtl = I18n.isRTL();
        if (timeEl) {
            const timeStr = now.toLocaleTimeString(isRtl ? 'fa-IR' : 'en-US', { hour12: false });
            timeEl.textContent = timeStr;
        }
        if (dateEl) {
            const dateStr = I18n.formatDate ? I18n.formatDate(now.toISOString()) : now.toLocaleDateString();
            dateEl.textContent = dateStr;
        }
    },

    async fetchData(silent = false) {
        if (this._isLoading && !silent) return;
        this._isLoading = true;

        const refreshBtn = document.getElementById('sup-refresh-btn');
        if (refreshBtn && !silent) refreshBtn.classList.add('loading');

        try {
            const [dutyData, personsData, eventsData] = await Promise.all([
                App.api('/api/zones/duty-roster?only_active=false').catch(() => null),
                App.api('/api/persons').catch(() => []),
                App.api('/api/events?limit=40').catch(() => ({ events: [] })),
            ]);

            this._rosterData = dutyData;
            this._persons = Array.isArray(personsData) ? personsData : [];
            this._events = (eventsData && Array.isArray(eventsData.events)) ? eventsData.events : [];

            this.updateKPIs();
            this.updateSectionOptions();
            this.renderRoster();
            this.renderTimeline();
        } catch (err) {
            console.error('Failed to load supervisor data:', err);
            if (!silent) {
                App.showToast(err.message || 'خطا در دریافت اطلاعات پیشخوان سرپرست', 'error');
            }
        } finally {
            this._isLoading = false;
            if (refreshBtn) refreshBtn.classList.remove('loading');
        }
    },

    /**
     * Render main skeleton container into #content-body.
     */
    renderSkeleton() {
        const user = Auth.getUser() || {};
        const isRtl = I18n.isRTL();
        const userName = user.full_name || user.username || 'سرپرست';
        const greeting = this.getGreeting();
        const assignedSecs = (user.assigned_sections && user.assigned_sections.length)
            ? user.assigned_sections
            : [];

        // Page title in top header bar
        const titleEl = document.getElementById('page-title');
        if (titleEl) {
            titleEl.textContent = I18n.t('supervisor_dashboard_title') || 'پیشخوان اختصاصی سرپرست';
        }

        const headerActions = document.getElementById('header-actions');
        if (headerActions) {
            headerActions.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.65rem;">
                    <span class="badge-status-pill" id="sup-timer-badge" style="font-size: 0.8rem; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-secondary); padding: 6px 12px; display: inline-flex; align-items: center; gap: 5px; border-radius: 9999px;">
                        ⏳ <span id="sup-countdown-val" style="font-family: monospace; font-weight: 700;">10</span>s
                    </span>
                    <button class="btn btn-secondary btn-sm" id="sup-refresh-btn" onclick="SupervisorCockpit.fetchData()" title="${I18n.t('refresh') || 'به‌روزرسانی'}" style="padding: 6px 12px; display: inline-flex; align-items: center; gap: 6px; border-radius: 9999px;">
                        🔄 <span>${I18n.t('refresh') || 'به‌روزرسانی'}</span>
                    </button>
                    <div class="live-indicator" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 9999px; color: #4ade80; font-size: 0.8rem; font-weight: 600;">
                        <span class="sup-radar-dot"></span>
                        <span>${I18n.t('live') || 'زنده'}</span>
                    </div>
                </div>
            `;
        }

        const body = document.getElementById('content-body');
        if (!body) return;

        body.innerHTML = `
            <div class="supervisor-cockpit-container" style="display: flex; flex-direction: column; gap: 1.25rem;">
                <!-- Executive Command Strip -->
                <div class="sup-command-strip">
                    <div style="display: flex; align-items: center; gap: 1rem; z-index: 1;">
                        <div class="sup-supervisor-avatar" title="Supervisor Role">
                            🛡️
                        </div>
                        <div>
                            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 3px;">
                                <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; color: var(--text-primary);">
                                    ${this.escapeHtml(greeting)}، ${this.escapeHtml(userName)}
                                </h3>
                                <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px;">
                                    👑 سرپرست واحد
                                </span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.82rem; color: var(--text-secondary);">
                                <span>🏢 ${isRtl ? 'بخش‌های مجاز:' : 'Supervised Sections:'}</span>
                                <div style="display: inline-flex; gap: 4px; flex-wrap: wrap;">
                                    ${assignedSecs.length > 0 
                                        ? assignedSecs.map(s => `<span class="badge badge-subtle text-xs" style="padding: 2px 7px; background: rgba(255,255,255,0.06);">${this.escapeHtml(s)}</span>`).join('')
                                        : `<span class="badge badge-subtle text-xs">${I18n.t('all_assigned_sections') || 'کل بخش‌ها'}</span>`
                                    }
                                </div>
                                <span style="color: var(--border-color);">|</span>
                                <span style="color: #60a5fa; display: inline-flex; align-items: center; gap: 4px;">
                                    🔒 ${I18n.t('privacy_shield_label') || 'حفاظت حریم خصوصی ۱۰۰٪ (بدون تصویر و دوربین)'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Telemetry & Fast Leave Action -->
                    <div style="display: flex; align-items: center; gap: 0.85rem; z-index: 1; flex-wrap: wrap;">
                        <div class="sup-live-telemetry">
                            <span class="sup-radar-dot"></span>
                            <span id="sup-live-date" style="font-size: 0.82rem; color: var(--text-secondary);">—</span>
                            <span style="color: var(--border-color);">|</span>
                            <span id="sup-live-time" class="sup-live-clock">--:--:--</span>
                        </div>
                        <button type="button" class="btn btn-outline-primary btn-sm" onclick="SupervisorCockpit.showQuickLeavePicker()" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 9999px; font-weight: 600; font-size: 0.8rem; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                            <span>🏖️</span>
                            <span>${I18n.t('quick_leave_action') || 'ثبت مرخصی پرسنل'}</span>
                        </button>
                    </div>
                </div>

                <!-- 7 Interactive Executive KPI Pods -->
                <div class="sup-kpi-deck" id="sup-kpi-deck">
                    <!-- Populated dynamically via updateKPIs() -->
                </div>

                <!-- Main Section: Interactive Roster & Activity Timeline -->
                <div class="sup-main-grid" style="display: grid; grid-template-columns: 1fr; gap: 1.25rem;">
                    <!-- Roster Card -->
                    <div class="card-glass" style="padding: 1.35rem; border-radius: var(--radius-lg, 14px);">
                        <!-- Filter & Search Toolbar -->
                        <div class="sup-roster-toolbar" style="display: flex; flex-direction: column; gap: 0.9rem; margin-bottom: 1.25rem; padding-bottom: 1.15rem; border-bottom: 1px solid var(--border-subtle);">
                            <!-- Upper toolbar row: Category Filter Pills -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
                                <div class="filter-bar sup-filter-pills" style="margin-bottom: 0; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                    <button class="filter-btn ${this._activeFilter === 'all' ? 'active' : ''}" onclick="SupervisorCockpit.setFilter('all')">
                                        <span>👥 ${I18n.t('filter_all') || 'همه'}</span>
                                        <span class="badge badge-pill-counter" id="badge-count-all">—</span>
                                    </button>
                                    <button class="filter-btn ${this._activeFilter === 'present' ? 'active' : ''}" onclick="SupervisorCockpit.setFilter('present')">
                                        <span>🟢 ${I18n.t('filter_present') || 'حاضر'}</span>
                                        <span class="badge badge-pill-counter" id="badge-count-present">—</span>
                                    </button>
                                    <button class="filter-btn ${this._activeFilter === 'grace' ? 'active' : ''}" onclick="SupervisorCockpit.setFilter('grace')">
                                        <span>🔵 ${I18n.t('in_grace_period') || 'مهلت ورود'}</span>
                                        <span class="badge badge-pill-counter" id="badge-count-grace">—</span>
                                    </button>
                                    <button class="filter-btn ${this._activeFilter === 'break' ? 'active' : ''}" onclick="SupervisorCockpit.setFilter('break')">
                                        <span>☕ ${I18n.t('status_on_break') || 'استراحت'}</span>
                                        <span class="badge badge-pill-counter" id="badge-count-break">—</span>
                                    </button>
                                    <button class="filter-btn ${this._activeFilter === 'leave' ? 'active' : ''}" onclick="SupervisorCockpit.setFilter('leave')">
                                        <span>🏖️ ${I18n.t('status_on_leave') || 'مرخصی / آف'}</span>
                                        <span class="badge badge-pill-counter" id="badge-count-leave">—</span>
                                    </button>
                                    <button class="filter-btn ${this._activeFilter === 'absent' ? 'active' : ''}" onclick="SupervisorCockpit.setFilter('absent')">
                                        <span>🔴 ${I18n.t('filter_absent') || 'غایب'}</span>
                                        <span class="badge badge-pill-counter" id="badge-count-absent">—</span>
                                    </button>
                                </div>

                                <div id="sup-showing-counter" style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 500;">
                                    <!-- Populated dynamically -->
                                </div>
                            </div>

                            <!-- Lower toolbar row: Section selector, Sort, Search input & Layout View Toggle -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
                                <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                                    <!-- Section Dropdown -->
                                    <div class="sup-section-select-wrapper" style="display: flex; align-items: center; gap: 4px;">
                                        <span style="font-size: 0.8rem; color: var(--text-secondary);">🏢</span>
                                        <select id="sup-section-filter" class="form-control form-control-sm" onchange="SupervisorCockpit.setSection(this.value)" style="min-width: 140px; font-size: 0.8rem; height: 36px; padding: 4px 10px; border-radius: var(--radius-sm);">
                                            <option value="all">${I18n.t('all_sections') || 'همه بخش‌ها'}</option>
                                        </select>
                                    </div>

                                    <!-- Sort Dropdown -->
                                    <div class="sup-sort-select-wrapper" style="display: flex; align-items: center; gap: 4px;">
                                        <span style="font-size: 0.8rem; color: var(--text-secondary);">🔃</span>
                                        <select id="sup-sort-filter" class="form-control form-control-sm" onchange="SupervisorCockpit.setSort(this.value)" style="min-width: 160px; font-size: 0.8rem; height: 36px; padding: 4px 10px; border-radius: var(--radius-sm);">
                                            <option value="urgency">${I18n.t('sort_urgency') || 'وضعیت اضطراری'}</option>
                                            <option value="name">${I18n.t('sort_name') || 'نام پرسنل (الف - ی)'}</option>
                                            <option value="compliance">${I18n.t('sort_compliance') || 'کمترین پایبندی به شیفت'}</option>
                                            <option value="absence">${I18n.t('sort_absence') || 'بیشترین زمان غیبت'}</option>
                                        </select>
                                    </div>
                                </div>

                                <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                                    <!-- Search Box with Shortcut badge [/] -->
                                    <div class="dashboard-search-box" style="min-width: 210px; max-width: 300px; position: relative;">
                                        <span class="dashboard-search-icon">🔍</span>
                                        <input 
                                            type="text" 
                                            id="sup-person-search" 
                                            placeholder="${this.escapeAttr(I18n.t('search_person_placeholder') || 'جستجوی پرسنل...')}"
                                            value="${this.escapeAttr(this._searchQuery)}"
                                            oninput="SupervisorCockpit.handleSearch(this.value)"
                                            style="padding-inline-end: 55px;"
                                        />
                                        <span style="position: absolute; inset-inline-end: 28px; top: 50%; transform: translateY(-50%); font-size: 0.68rem; padding: 1px 5px; background: rgba(255,255,255,0.08); border-radius: 4px; color: var(--text-tertiary); pointer-events: none; font-family: monospace;">
                                            /
                                        </span>
                                        <button 
                                            type="button" 
                                            class="dashboard-search-clear" 
                                            id="sup-search-clear"
                                            onclick="SupervisorCockpit.clearSearch()"
                                            style="display: ${this._searchQuery ? 'flex' : 'none'};"
                                        >✕</button>
                                    </div>

                                    <!-- Grid / List Switcher -->
                                    <div class="view-toggle-group" role="group" aria-label="View mode">
                                        <button class="view-toggle-btn ${this._viewMode === 'grid' ? 'active' : ''}" id="sup-view-grid" onclick="SupervisorCockpit.setViewMode('grid')" title="${I18n.t('view_grid') || 'نمای شبکه‌ای'}">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>
                                        </button>
                                        <button class="view-toggle-btn ${this._viewMode === 'list' ? 'active' : ''}" id="sup-view-list" onclick="SupervisorCockpit.setViewMode('list')" title="${I18n.t('view_list') || 'نمای فهرستی'}">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Roster Container -->
                        <div id="sup-roster-container">
                            <div class="text-center py-5">
                                <div class="spinner-border text-primary mb-2"></div>
                                <div class="text-muted text-sm">${I18n.t('loading') || 'در حال دریافت وضعیت شیفت پرسنل...'}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Shift Activity & Alerts Timeline Card -->
                    <div class="card-glass" style="padding: 1.35rem; border-radius: var(--radius-lg, 14px);">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.15rem; padding-bottom: 0.85rem; border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.75rem;">
                            <div style="display: flex; align-items: center; gap: 0.65rem;">
                                <h4 style="margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 0.5rem; font-weight: 700;">
                                    <span>📋</span>
                                    <span>${I18n.t('shift_activity_timeline') || 'رویدادها و هشدارهای تردد پرسنل'}</span>
                                </h4>
                                <small class="text-muted" style="font-size: 0.78rem;">
                                    🔒 ${I18n.t('timeline_privacy_notice') || 'ثبت رویدادها به صورت متنی (بدون تصاویر اسنپ‌شات)'}
                                </small>
                            </div>

                            <!-- Timeline Filter Tabs -->
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" class="btn ${this._timelineFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="SupervisorCockpit.setTimelineFilter('all')" style="font-size: 0.75rem; padding: 4px 10px;">
                                    ${I18n.t('timeline_filter_all') || 'همه ترددها'}
                                </button>
                                <button type="button" class="btn ${this._timelineFilter === 'alerts' ? 'btn-danger' : 'btn-secondary'}" onclick="SupervisorCockpit.setTimelineFilter('alerts')" style="font-size: 0.75rem; padding: 4px 10px;">
                                    ⚠️ ${I18n.t('timeline_filter_alerts') || 'فقط هشدارها'}
                                </button>
                            </div>
                        </div>
                        <div id="sup-timeline-container" class="sup-timeline-feed">
                            <!-- Populated dynamically via renderTimeline() -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.updateClock();
    },

    updateSectionOptions() {
        const secSelect = document.getElementById('sup-section-filter');
        if (!secSelect) return;

        const currentVal = this._selectedSection;
        const sections = new Set();
        this._persons.forEach(p => {
            if (p.section && p.section.trim()) sections.add(p.section.trim());
        });

        const sortedSecs = Array.from(sections).sort();
        let optionsHtml = `<option value="all">${I18n.t('all_sections') || 'همه بخش‌ها'}</option>`;
        sortedSecs.forEach(sec => {
            const isSelected = sec === currentVal ? 'selected' : '';
            optionsHtml += `<option value="${this.escapeAttr(sec)}" ${isSelected}>${this.escapeHtml(sec)}</option>`;
        });
        secSelect.innerHTML = optionsHtml;
    },

    updateKPIs() {
        const kpiDeck = document.getElementById('sup-kpi-deck');
        if (!kpiDeck) return;

        const roster = (this._rosterData && Array.isArray(this._rosterData.roster)) ? this._rosterData.roster : [];
        const isRtl = I18n.isRTL();

        // Calculate counts
        const totalAssigned = this._persons.length;
        const presentCount = roster.filter(r => r.status === 'present' && !r.is_within_grace_period).length;
        const graceCount = roster.filter(r => r.is_within_grace_period).length;
        const breakCount = roster.filter(r => r.status === 'on_break').length;
        const leaveCount = roster.filter(r => r.status === 'on_leave').length;
        const absentCount = roster.filter(r => r.status === 'absent').length;

        // Overall compliance percentage
        let compliancePct = 100.0;
        if (roster.length > 0) {
            const sumPct = roster.reduce((acc, r) => acc + (r.shift_compliance_pct ?? 100), 0);
            compliancePct = Math.round(sumPct / roster.length);
        }

        // Calculate ratios for micro progress bars
        const presentPct = totalAssigned > 0 ? Math.min(100, Math.round((presentCount / totalAssigned) * 100)) : 0;
        const gracePct = totalAssigned > 0 ? Math.min(100, Math.round((graceCount / totalAssigned) * 100)) : 0;
        const breakPct = totalAssigned > 0 ? Math.min(100, Math.round((breakCount / totalAssigned) * 100)) : 0;
        const leavePct = totalAssigned > 0 ? Math.min(100, Math.round((leaveCount / totalAssigned) * 100)) : 0;
        const absentPct = totalAssigned > 0 ? Math.min(100, Math.round((absentCount / totalAssigned) * 100)) : 0;

        // Update filter badge counts
        const bAll = document.getElementById('badge-count-all');
        const bPres = document.getElementById('badge-count-present');
        const bGr = document.getElementById('badge-count-grace');
        const bBrk = document.getElementById('badge-count-break');
        const bLv = document.getElementById('badge-count-leave');
        const bAbs = document.getElementById('badge-count-absent');
        if (bAll) bAll.textContent = isRtl ? I18n.toPersianDigits(totalAssigned) : totalAssigned;
        if (bPres) bPres.textContent = isRtl ? I18n.toPersianDigits(presentCount) : presentCount;
        if (bGr) bGr.textContent = isRtl ? I18n.toPersianDigits(graceCount) : graceCount;
        if (bBrk) bBrk.textContent = isRtl ? I18n.toPersianDigits(breakCount) : breakCount;
        if (bLv) bLv.textContent = isRtl ? I18n.toPersianDigits(leaveCount) : leaveCount;
        if (bAbs) bAbs.textContent = isRtl ? I18n.toPersianDigits(absentCount) : absentCount;

        kpiDeck.innerHTML = `
            <!-- Total Assigned -->
            <div class="sup-kpi-card ${this._activeFilter === 'all' ? 'is-active' : ''}" onclick="SupervisorCockpit.setFilter('all')" style="--kpi-accent: #3b82f6; --kpi-glow: rgba(59, 130, 246, 0.4);">
                <div class="sup-kpi-header">
                    <span class="sup-kpi-title">${I18n.t('kpi_assigned_total') || 'کل پرسنل منتسب'}</span>
                    <span class="sup-kpi-icon">👥</span>
                </div>
                <div class="sup-kpi-val" style="color: #60a5fa;">
                    ${isRtl ? I18n.toPersianDigits(totalAssigned) : totalAssigned}
                </div>
                <div class="sup-kpi-progress-track">
                    <div class="sup-kpi-progress-bar" style="width: 100%; background: #3b82f6;"></div>
                </div>
                <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 2px;">
                    ${isRtl ? 'کل پرونده‌های ثبت‌شده' : 'Total registered staff'}
                </div>
            </div>

            <!-- Present Now -->
            <div class="sup-kpi-card ${this._activeFilter === 'present' ? 'is-active' : ''}" onclick="SupervisorCockpit.setFilter('present')" style="--kpi-accent: #22c55e; --kpi-glow: rgba(34, 197, 94, 0.4);">
                <div class="sup-kpi-header">
                    <span class="sup-kpi-title">${I18n.t('kpi_present_now') || 'حاضر در ایستگاه'}</span>
                    <span class="sup-kpi-icon">🟢</span>
                </div>
                <div class="sup-kpi-val" style="color: #4ade80;">
                    ${isRtl ? I18n.toPersianDigits(presentCount) : presentCount}
                </div>
                <div class="sup-kpi-progress-track">
                    <div class="sup-kpi-progress-bar" style="width: ${presentPct}%; background: #22c55e;"></div>
                </div>
                <div style="font-size: 0.72rem; color: #4ade80; margin-top: 2px;">
                    ${isRtl ? `${I18n.toPersianDigits(presentPct)}٪ از کل پرسنل` : `${presentPct}% of total`}
                </div>
            </div>

            <!-- In Grace Period -->
            <div class="sup-kpi-card ${this._activeFilter === 'grace' ? 'is-active' : ''}" onclick="SupervisorCockpit.setFilter('grace')" style="--kpi-accent: #38bdf8; --kpi-glow: rgba(56, 189, 248, 0.4);">
                <div class="sup-kpi-header">
                    <span class="sup-kpi-title">${I18n.t('in_grace_period') || 'در مهلت ورود'}</span>
                    <span class="sup-kpi-icon">🔵</span>
                </div>
                <div class="sup-kpi-val" style="color: #38bdf8;">
                    ${isRtl ? I18n.toPersianDigits(graceCount) : graceCount}
                </div>
                <div class="sup-kpi-progress-track">
                    <div class="sup-kpi-progress-bar" style="width: ${gracePct}%; background: #38bdf8;"></div>
                </div>
                <div style="font-size: 0.72rem; color: #38bdf8; margin-top: 2px;">
                    ${isRtl ? 'فرصت ورود مجاز شیفت' : 'Arrival grace window'}
                </div>
            </div>

            <!-- On Break / Rest -->
            <div class="sup-kpi-card ${this._activeFilter === 'break' ? 'is-active' : ''}" onclick="SupervisorCockpit.setFilter('break')" style="--kpi-accent: #fbbf24; --kpi-glow: rgba(251, 191, 36, 0.4);">
                <div class="sup-kpi-header">
                    <span class="sup-kpi-title">${I18n.t('kpi_on_break') || 'استراحت / ناهار'}</span>
                    <span class="sup-kpi-icon">☕</span>
                </div>
                <div class="sup-kpi-val" style="color: #fbbf24;">
                    ${isRtl ? I18n.toPersianDigits(breakCount) : breakCount}
                </div>
                <div class="sup-kpi-progress-track">
                    <div class="sup-kpi-progress-bar" style="width: ${breakPct}%; background: #fbbf24;"></div>
                </div>
                <div style="font-size: 0.72rem; color: #fbbf24; margin-top: 2px;">
                    ${isRtl ? 'بازه آزاد و هماهنگ‌شده' : 'Scheduled rest time'}
                </div>
            </div>

            <!-- On Leave / Off-Duty -->
            <div class="sup-kpi-card ${this._activeFilter === 'leave' ? 'is-active' : ''}" onclick="SupervisorCockpit.setFilter('leave')" style="--kpi-accent: #c084fc; --kpi-glow: rgba(192, 132, 252, 0.4);">
                <div class="sup-kpi-header">
                    <span class="sup-kpi-title">${I18n.t('kpi_on_leave') || 'مرخصی / آف شیفت'}</span>
                    <span class="sup-kpi-icon">🏖️</span>
                </div>
                <div class="sup-kpi-val" style="color: #c084fc;">
                    ${isRtl ? I18n.toPersianDigits(leaveCount) : leaveCount}
                </div>
                <div class="sup-kpi-progress-track">
                    <div class="sup-kpi-progress-bar" style="width: ${leavePct}%; background: #c084fc;"></div>
                </div>
                <div style="font-size: 0.72rem; color: #c084fc; margin-top: 2px;">
                    ${isRtl ? 'آف یا مرخصی مصوب' : 'Approved days off'}
                </div>
            </div>

            <!-- Absent / Missing -->
            <div class="sup-kpi-card ${this._activeFilter === 'absent' ? 'is-active' : ''}" onclick="SupervisorCockpit.setFilter('absent')" style="--kpi-accent: #f87171; --kpi-glow: rgba(248, 113, 113, 0.4); ${absentCount > 0 ? 'background: rgba(239, 68, 68, 0.08);' : ''}">
                <div class="sup-kpi-header">
                    <span class="sup-kpi-title">${I18n.t('kpi_absent_now') || 'غیبت در شیفت'}</span>
                    <span class="sup-kpi-icon">🔴</span>
                </div>
                <div class="sup-kpi-val" style="color: #f87171;">
                    ${isRtl ? I18n.toPersianDigits(absentCount) : absentCount}
                </div>
                <div class="sup-kpi-progress-track">
                    <div class="sup-kpi-progress-bar" style="width: ${absentPct}%; background: #f87171;"></div>
                </div>
                <div style="font-size: 0.72rem; color: ${absentCount > 0 ? '#f87171' : 'var(--text-tertiary)'}; margin-top: 2px;">
                    ${absentCount > 0 ? (isRtl ? '⚠️ نیازمند پیگیری سرپرست' : 'Attention required') : (isRtl ? 'بدون غیبت غیرمجاز' : 'Zero violations')}
                </div>
            </div>

            <!-- Shift Compliance Rate -->
            <div class="sup-kpi-card" style="--kpi-accent: #a78bfa; --kpi-glow: rgba(167, 139, 250, 0.4); cursor: default;">
                <div class="sup-kpi-header">
                    <span class="sup-kpi-title">${I18n.t('kpi_compliance_rate') || 'رعایت شیفت'}</span>
                    <span class="sup-kpi-icon">📊</span>
                </div>
                <div class="sup-kpi-val" style="color: #a78bfa;">
                    ${isRtl ? I18n.toPersianDigits(compliancePct) : compliancePct}%
                </div>
                <div class="sup-kpi-progress-track">
                    <div class="sup-kpi-progress-bar" style="width: ${compliancePct}%; background: linear-gradient(90deg, #8b5cf6, #3b82f6);"></div>
                </div>
                <div style="font-size: 0.72rem; color: #a78bfa; margin-top: 2px;">
                    ${isRtl ? 'شاخص پایبندی کلی' : 'Overall adherence index'}
                </div>
            </div>
        `;
    },

    renderRoster() {
        const container = document.getElementById('sup-roster-container');
        if (!container) return;

        const isRtl = I18n.isRTL();
        const rosterMap = new Map();
        if (this._rosterData && Array.isArray(this._rosterData.roster)) {
            this._rosterData.roster.forEach(r => rosterMap.set(r.person_id, r));
        }

        // Combine persons list with duty statuses
        let list = this._persons.map(person => {
            const duty = rosterMap.get(person.id) || null;
            let status = 'off_duty';
            let isGrace = false;

            if (duty) {
                status = duty.status;
                isGrace = Boolean(duty.is_within_grace_period);
            } else if (person.leaves && Array.isArray(person.leaves)) {
                const todayStr = new Date().toISOString().slice(0, 10);
                const hasLeave = person.leaves.some(l => l.start_date <= todayStr && todayStr <= (l.end_date || l.start_date));
                if (hasLeave) status = 'on_leave';
            }

            return {
                person,
                duty,
                status,
                isGrace,
            };
        });

        // 1. Filter by Section
        if (this._selectedSection !== 'all') {
            list = list.filter(item => (item.person.section || '').trim() === this._selectedSection);
        }

        // 2. Filter by Category
        if (this._activeFilter !== 'all') {
            list = list.filter(item => {
                if (this._activeFilter === 'present') return item.status === 'present' && !item.isGrace;
                if (this._activeFilter === 'grace') return item.isGrace;
                if (this._activeFilter === 'break') return item.status === 'on_break';
                if (this._activeFilter === 'leave') return item.status === 'on_leave';
                if (this._activeFilter === 'absent') return item.status === 'absent';
                return true;
            });
        }

        // 3. Filter by Search Query
        if (this._searchQuery) {
            const q = this._searchQuery.toLowerCase().trim();
            list = list.filter(item => {
                const nameMatch = (item.person.name || '').toLowerCase().includes(q);
                const secMatch = (item.person.section || '').toLowerCase().includes(q);
                const roleMatch = (item.person.role || '').toLowerCase().includes(q);
                return nameMatch || secMatch || roleMatch;
            });
        }

        // 4. Sort
        const urgencyRank = {
            'absent': 1,
            'grace': 2,
            'on_break': 3,
            'present': 4,
            'camera_offline': 5,
            'on_leave': 6,
            'off_duty': 7,
        };

        list.sort((a, b) => {
            if (this._sortBy === 'name') {
                return (a.person.name || '').localeCompare(b.person.name || '', 'fa');
            }
            if (this._sortBy === 'compliance') {
                const compA = a.duty ? (a.duty.shift_compliance_pct ?? 100) : 100;
                const compB = b.duty ? (b.duty.shift_compliance_pct ?? 100) : 100;
                return compA - compB; // Lowest compliance first
            }
            if (this._sortBy === 'absence') {
                const absA = a.duty ? (a.duty.current_absence_minutes ?? 0) : 0;
                const absB = b.duty ? (b.duty.current_absence_minutes ?? 0) : 0;
                return absB - absA; // Longest absence first
            }
            // Default: Urgency
            const rankA = a.isGrace ? 2 : (urgencyRank[a.status] || 99);
            const rankB = b.isGrace ? 2 : (urgencyRank[b.status] || 99);
            if (rankA !== rankB) return rankA - rankB;
            return (a.person.name || '').localeCompare(b.person.name || '', 'fa');
        });

        // Update counter text
        const counterEl = document.getElementById('sup-showing-counter');
        if (counterEl) {
            const fStr = isRtl ? I18n.toPersianDigits(list.length) : list.length;
            const tStr = isRtl ? I18n.toPersianDigits(this._persons.length) : this._persons.length;
            counterEl.textContent = `${isRtl ? 'نمایش' : 'Showing'} ${fStr} ${isRtl ? 'از' : 'of'} ${tStr} ${isRtl ? 'نفر' : 'staff'}`;
        }

        if (list.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5 text-muted card-glass" style="border-radius: var(--radius-md);">
                    <span style="font-size: 2.8rem; display: block; margin-bottom: 0.65rem;">👥</span>
                    <strong style="display: block; font-size: 1.05rem; color: var(--text-primary); margin-bottom: 0.35rem;">
                        ${I18n.t('no_persons_found') || 'پرسنلی با این فیلتر یا بخش یافت نشد.'}
                    </strong>
                    <span class="text-xs">${I18n.t('try_adjusting_filters') || 'می‌توانید فیلتر یا عبارت جستجو را تغییر دهید.'}</span>
                </div>
            `;
            return;
        }

        if (this._viewMode === 'list') {
            container.innerHTML = `
                <div class="sup-roster-table-wrapper" style="overflow-x: auto;">
                    <table class="table table-hover" style="width: 100%; border-collapse: separate; border-spacing: 0 6px;">
                        <thead>
                            <tr style="color: var(--text-secondary); font-size: 0.8rem; border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 10px 14px;">${I18n.t('person') || 'پرسنل'}</th>
                                <th style="padding: 10px 14px;">${I18n.t('section') || 'بخش'}</th>
                                <th style="padding: 10px 14px;">${I18n.t('shift_time') || 'برنامه شیفت'}</th>
                                <th style="padding: 10px 14px;">${I18n.t('workstation') || 'ایستگاه کاری'}</th>
                                <th style="padding: 10px 14px;">${I18n.t('status') || 'وضعیت زنده'}</th>
                                <th style="padding: 10px 14px;">${I18n.t('kpi_compliance_rate') || 'رعایت شیفت'}</th>
                                <th style="padding: 10px 14px; text-align: center;">${I18n.t('actions') || 'عملیات'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list.map(item => this.renderTableRow(item)).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="sup-roster-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 1.15rem;">
                    ${list.map(item => this.renderGridCard(item)).join('')}
                </div>
            `;
        }
    },

    renderGridCard(item) {
        const { person, duty, status, isGrace } = item;
        const isRtl = I18n.isRTL();
        const initial = (person.name || 'P').trim().charAt(0).toUpperCase();

        // Dynamic deterministic gradient based on person name (Zero-Photo privacy)
        const avatarGradient = this.getAvatarGradient(person.name);
        const badgeCfg = this.getStatusConfig(status, isGrace, duty);

        const shiftWindowStr = duty ? duty.shift_window_str : (person.custom_shift ? 'سفارشی / چرخشی' : 'تعریف نشده');
        const zoneName = duty ? duty.zone_name : 'ایستگاه منتسب ندارد';

        // Compliance rate
        const compliancePct = duty ? (duty.shift_compliance_pct ?? 100) : 100;
        let compPillClass = 'high';
        if (compliancePct < 70) compPillClass = 'low';
        else if (compliancePct < 85) compPillClass = 'medium';

        const cleanSection = (person.section || '').replace(/\r?\n+/g, ' ').trim() || (isRtl ? 'عمومی' : 'General');
        const cleanRole = (person.role || '').replace(/\r?\n+/g, ' ').trim();

        return `
            <div class="sup-roster-card" style="border-inline-start: 4px solid ${badgeCfg.dotColor};">
                <!-- Top Row: Avatar + Name + Live Badge -->
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem;">
                    <div style="display: flex; align-items: center; gap: 0.85rem;">
                        <!-- Deterministic Privacy Avatar Badge -->
                        <div class="sup-avatar-badge" style="background: ${avatarGradient};">
                            ${initial}
                            <!-- Live status beacon dot with pulse -->
                            <span class="sup-beacon-dot ${badgeCfg.pulse ? 'pulse' : ''}" style="background: ${badgeCfg.dotColor}; --beacon-glow: ${badgeCfg.dotColor};"></span>
                        </div>
                        <div>
                            <strong style="display: block; font-size: 1rem; color: var(--text-primary); margin-bottom: 2px;">
                                ${this.escapeHtml(person.name)}
                            </strong>
                            <div class="sup-card-tags-row">
                                <span class="sup-card-section-badge" title="${this.escapeAttr(cleanSection)}">
                                    <span>🏢</span>
                                    <span>${this.escapeHtml(cleanSection)}</span>
                                </span>
                                ${cleanRole ? `
                                    <span class="sup-card-role-badge" title="${this.escapeAttr(cleanRole)}">
                                        <span>🏷️</span>
                                        <span>${this.escapeHtml(cleanRole)}</span>
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Status Pill -->
                    <span class="badge" style="font-size: 0.74rem; padding: 4px 10px; background: ${badgeCfg.badgeBg}; color: ${badgeCfg.badgeColor}; border: 1px solid ${badgeCfg.badgeBorder}; border-radius: 9999px; white-space: nowrap; font-weight: 700;">
                        ${badgeCfg.label}
                    </span>
                </div>

                <!-- Middle Cluster: Shift, Zone, Real-Time Details -->
                <div class="sup-card-meta">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;">
                            <span>⏰</span>
                            <span>${I18n.t('shift_label') || 'شیفت کاری'}:</span>
                        </span>
                        <strong style="color: var(--text-primary); direction: ltr; font-family: monospace; font-size: 0.82rem; white-space: nowrap;">${this.escapeHtml(shiftWindowStr)}</strong>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;">
                            <span>🎯</span>
                            <span>${I18n.t('workstation_label') || 'ایستگاه کاری'}:</span>
                        </span>
                        <span style="color: var(--accent-blue); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;" title="${this.escapeAttr(zoneName)}">${this.escapeHtml(zoneName)}</span>
                    </div>

                    ${badgeCfg.detailText ? `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 0.78rem; border-top: 1px dashed var(--border-subtle); padding-top: 0.35rem; margin-top: 0.15rem;">
                        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;">
                            <span>📡</span>
                            <span>${I18n.t('status_detail') || 'وضعیت تردد'}:</span>
                        </span>
                        <span style="color: ${badgeCfg.detailColor}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(badgeCfg.detailText)}</span>
                    </div>
                    ` : ''}

                    <!-- Compliance Bar -->
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 0.75rem; margin-top: 2px;">
                        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;">
                            <span>📊</span>
                            <span>${I18n.t('kpi_compliance_rate') || 'انضباط شیفت'}:</span>
                        </span>
                        <span class="sup-compliance-pill ${compPillClass}">
                            ${isRtl ? I18n.toPersianDigits(compliancePct) : compliancePct}%
                        </span>
                    </div>
                </div>

                <!-- Action Bar: Shift Config + Leave Management + Analytics & Report + Today Events Log -->
                <div class="sup-action-bar">
                    <button type="button" class="btn btn-secondary sup-action-btn" onclick="PersonShiftModal.show(${person.id})" title="${I18n.t('manage_shift') || 'تنظیمات شیفت و ایستگاه'}">
                        <span>⏰</span>
                        <span>${I18n.t('shift') || 'شیفت'}</span>
                    </button>
                    <button type="button" class="btn btn-outline-primary sup-action-btn" onclick="SupervisorLeaveModal.show(${person.id}, '${this.escapeAttr(person.name)}')" title="${I18n.t('manage_leaves_title') || 'مدیریت مرخصی و آف'}">
                        <span>🏖️</span>
                        <span>${I18n.t('leave') || 'مرخصی'}</span>
                    </button>
                    <button type="button" class="btn btn-outline-secondary sup-action-btn" onclick="SupervisorAnalyticsModal.show(${person.id}, '${this.escapeAttr(person.name)}', '${this.escapeAttr(person.section || '')}', '${this.escapeAttr(person.role || '')}')" title="${I18n.t('analytics_and_report') || 'تحلیل جامع و گزارش'}">
                        <span>📊</span>
                        <span>${I18n.t('analytics_report_short') || 'گزارش'}</span>
                    </button>
                    <button type="button" class="btn btn-ghost sup-action-btn sup-action-btn-icon" onclick="SupervisorCockpit.showPersonEvents(${person.id}, '${this.escapeAttr(person.name)}')" title="${I18n.t('view_today_events') || 'سوابق امروز'}">
                        <span>📜</span>
                    </button>
                </div>
            </div>
        `;
    },

    renderTableRow(item) {
        const { person, duty, status, isGrace } = item;
        const isRtl = I18n.isRTL();
        const initial = (person.name || 'P').trim().charAt(0).toUpperCase();
        const avatarGradient = this.getAvatarGradient(person.name);
        const badgeCfg = this.getStatusConfig(status, isGrace, duty);

        const shiftWindowStr = duty ? duty.shift_window_str : (person.custom_shift ? 'سفارشی / چرخشی' : 'تعریف نشده');
        const zoneName = duty ? duty.zone_name : '—';
        const compliancePct = duty ? (duty.shift_compliance_pct ?? 100) : 100;
        let compPillClass = 'high';
        if (compliancePct < 70) compPillClass = 'low';
        else if (compliancePct < 85) compPillClass = 'medium';

        const cleanSection = (person.section || '').replace(/\r?\n+/g, ' ').trim() || (isRtl ? 'عمومی' : 'General');
        const cleanRole = (person.role || '').replace(/\r?\n+/g, ' ').trim();

        return `
            <tr style="background: var(--bg-surface); border-radius: var(--radius-sm); border-bottom: 1px solid var(--border-subtle);">
                <td style="padding: 10px 14px;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div class="sup-avatar-badge" style="width: 36px; height: 36px; font-size: 0.95rem; background: ${avatarGradient};">
                            ${initial}
                            <span class="sup-beacon-dot ${badgeCfg.pulse ? 'pulse' : ''}" style="width: 9px; height: 9px; background: ${badgeCfg.dotColor}; --beacon-glow: ${badgeCfg.dotColor};"></span>
                        </div>
                        <div>
                            <strong style="display: block; font-size: 0.9rem; color: var(--text-primary);">${this.escapeHtml(person.name)}</strong>
                            ${cleanRole ? `<span class="sup-card-role-badge text-xs" style="margin-top: 3px;">🏷️ ${this.escapeHtml(cleanRole)}</span>` : ''}
                        </div>
                    </div>
                </td>
                <td style="padding: 10px 14px;">
                    <span class="sup-card-section-badge" title="${this.escapeAttr(cleanSection)}">🏢 ${this.escapeHtml(cleanSection)}</span>
                </td>
                <td style="padding: 10px 14px; direction: ltr; font-family: monospace; font-size: 0.82rem;">
                    ${this.escapeHtml(shiftWindowStr)}
                </td>
                <td style="padding: 10px 14px; color: var(--accent-blue); font-size: 0.85rem; font-weight: 600;">
                    ${this.escapeHtml(zoneName)}
                </td>
                <td style="padding: 10px 14px;">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span class="badge" style="font-size: 0.72rem; padding: 3px 8px; background: ${badgeCfg.badgeBg}; color: ${badgeCfg.badgeColor}; border: 1px solid ${badgeCfg.badgeBorder}; width: fit-content; font-weight: 700;">
                            ${badgeCfg.label}
                        </span>
                        ${badgeCfg.detailText ? `<small style="font-size: 0.72rem; color: ${badgeCfg.detailColor}; font-weight: 600;">${this.escapeHtml(badgeCfg.detailText)}</small>` : ''}
                    </div>
                </td>
                <td style="padding: 10px 14px;">
                    <span class="sup-compliance-pill ${compPillClass}">
                        ${isRtl ? I18n.toPersianDigits(compliancePct) : compliancePct}%
                    </span>
                </td>
                <td style="padding: 10px 14px; text-align: center;">
                    <div style="display: inline-flex; gap: 0.4rem;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="PersonShiftModal.show(${person.id})" title="${I18n.t('shift_settings') || 'شیفت'}" style="padding: 4px 8px; font-size: 0.75rem;">
                            ⏰ ${I18n.t('shift') || 'شیفت'}
                        </button>
                        <button type="button" class="btn btn-outline-primary btn-sm" onclick="SupervisorLeaveModal.show(${person.id}, '${this.escapeAttr(person.name)}')" title="${I18n.t('leave_or_off') || 'مرخصی / آف'}" style="padding: 4px 8px; font-size: 0.75rem;">
                            🏖️ ${I18n.t('leave') || 'مرخصی'}
                        </button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" onclick="SupervisorAnalyticsModal.show(${person.id}, '${this.escapeAttr(person.name)}', '${this.escapeAttr(person.section || '')}', '${this.escapeAttr(person.role || '')}')" title="${I18n.t('analytics_and_report') || 'تحلیل جامع و گزارش'}" style="padding: 4px 8px; font-size: 0.75rem;">
                            📊 ${I18n.t('analytics_report_short') || 'گزارش'}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" onclick="SupervisorCockpit.showPersonEvents(${person.id}, '${this.escapeAttr(person.name)}')" title="${I18n.t('view_today_events') || 'سوابق امروز'}" style="padding: 4px 7px; font-size: 0.75rem;">
                            📜
                        </button>
                    </div>
                </td>
            </tr>
        `;
    },

    getStatusConfig(status, isGrace, duty) {
        const isRtl = I18n.isRTL();

        if (isGrace) {
            const elapsed = duty ? duty.shift_elapsed_minutes : 0;
            const grace = duty ? duty.grace_period_minutes : 15;
            return {
                label: isRtl ? 'در مهلت ورود' : 'In Grace Period',
                dotColor: '#38bdf8',
                badgeBg: 'rgba(56, 189, 248, 0.15)',
                badgeColor: '#38bdf8',
                badgeBorder: 'rgba(56, 189, 248, 0.35)',
                detailColor: '#38bdf8',
                detailText: isRtl ? `${I18n.toPersianDigits(elapsed)} از ${I18n.toPersianDigits(grace)} دقیقه مهلت` : `${elapsed}/${grace} min grace`,
                pulse: true,
            };
        }

        switch (status) {
            case 'present':
                return {
                    label: isRtl ? 'حاضر در ایستگاه' : 'Present in Zone',
                    dotColor: '#22c55e',
                    badgeBg: 'rgba(34, 197, 94, 0.15)',
                    badgeColor: '#4ade80',
                    badgeBorder: 'rgba(34, 197, 94, 0.35)',
                    detailColor: '#4ade80',
                    detailText: duty && duty.last_seen_str ? (isRtl ? 'حاضر و فعال' : 'Active in zone') : '',
                    pulse: true,
                };
            case 'on_break':
                return {
                    label: isRtl ? 'استراحت / ناهار' : 'On Break',
                    dotColor: '#fbbf24',
                    badgeBg: 'rgba(251, 191, 36, 0.15)',
                    badgeColor: '#fbbf24',
                    badgeBorder: 'rgba(251, 191, 36, 0.35)',
                    detailColor: '#fbbf24',
                    detailText: duty ? (duty.current_break_name || (isRtl ? 'بازه مجاز استراحت' : 'Rest time')) : '',
                    pulse: false,
                };
            case 'on_leave':
                return {
                    label: isRtl ? 'مرخصی / آف' : 'On Leave / Off-Duty',
                    dotColor: '#c084fc',
                    badgeBg: 'rgba(192, 132, 252, 0.15)',
                    badgeColor: '#c084fc',
                    badgeBorder: 'rgba(192, 132, 252, 0.35)',
                    detailColor: '#c084fc',
                    detailText: isRtl ? 'آف هماهنگ‌شده با سرپرست' : 'Approved leave',
                    pulse: false,
                };
            case 'absent':
                const absMins = duty ? duty.current_absence_minutes : 0;
                return {
                    label: isRtl ? 'غیبت در شیفت' : 'Absent',
                    dotColor: '#f87171',
                    badgeBg: 'rgba(248, 113, 113, 0.15)',
                    badgeColor: '#f87171',
                    badgeBorder: 'rgba(248, 113, 113, 0.35)',
                    detailColor: '#f87171',
                    detailText: isRtl ? `عدم حضور: ${I18n.toPersianDigits(absMins)} دقیقه` : `${absMins} min missing`,
                    pulse: true,
                };
            case 'camera_offline':
                return {
                    label: isRtl ? 'دوربین قطع' : 'Camera Offline',
                    dotColor: '#eab308',
                    badgeBg: 'rgba(234, 179, 8, 0.15)',
                    badgeColor: '#facc15',
                    badgeBorder: 'rgba(234, 179, 8, 0.35)',
                    detailColor: '#facc15',
                    detailText: isRtl ? 'ارتباط دوربین ایستگاه قطع است' : 'Station camera offline',
                    pulse: false,
                };
            case 'off_duty':
            default:
                return {
                    label: isRtl ? 'خارج از شیفت' : 'Off-Duty',
                    dotColor: '#94a3b8',
                    badgeBg: 'rgba(148, 163, 184, 0.1)',
                    badgeColor: '#94a3b8',
                    badgeBorder: 'rgba(148, 163, 184, 0.25)',
                    detailColor: '#94a3b8',
                    detailText: isRtl ? 'اکنون زمان کاری نیست' : 'Not in active shift',
                    pulse: false,
                };
        }
    },

    renderTimeline() {
        const container = document.getElementById('sup-timeline-container');
        if (!container) return;

        const isRtl = I18n.isRTL();
        let events = this._events || [];

        if (this._timelineFilter === 'alerts') {
            events = events.filter(ev => ev.alert_type && ev.alert_type !== 'normal');
        }

        if (events.length === 0) {
            container.innerHTML = `
                <div class="text-center py-4 text-muted">
                    <span style="font-size: 2rem; display: block; margin-bottom: 0.35rem;">📝</span>
                    <span>${this._timelineFilter === 'alerts' 
                        ? (isRtl ? 'هیچ هشدار عدم حضوری ثبت نشده است.' : 'No absence alerts.') 
                        : (I18n.t('no_recent_events') || 'هیچ رویداد ترددی در این بازه ثبت نشده است.')}</span>
                </div>
            `;
            return;
        }

        const itemsHtml = events.map(ev => {
            const isAlert = ev.alert_type && ev.alert_type !== 'normal';
            let rowClass = 'sup-timeline-row';
            let alertBadge = '<span class="badge" style="background: rgba(34, 197, 94, 0.12); color: #4ade80; font-size: 0.72rem; padding: 2px 7px;">🟢 ورود / حضور</span>';

            if (isAlert) {
                rowClass += ' alert';
                if (ev.alert_type === 'absence_timeout') {
                    alertBadge = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.72rem; padding: 2px 7px;">⚠️ هشدار عدم حضور</span>';
                } else {
                    alertBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.72rem; padding: 2px 7px;">⚠️ ${this.escapeHtml(ev.alert_type)}</span>`;
                }
            }

            const timeStr = I18n.formatTimestamp ? I18n.formatTimestamp(ev.timestamp) : new Date(ev.timestamp).toLocaleTimeString();
            const relTime = this.formatRelativeTime(ev.timestamp);
            const personName = ev.person_name || 'پرسنل';
            const initial = personName.charAt(0).toUpperCase();
            const avatarGrad = this.getAvatarGradient(personName);

            return `
                <div class="${rowClass}">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <!-- Initials badge (ZERO photos) -->
                        <div class="sup-avatar-badge" style="width: 32px; height: 32px; font-size: 0.85rem; background: ${avatarGrad};">
                            ${initial}
                        </div>
                        <div>
                            <strong style="font-size: 0.88rem; color: var(--text-primary);">${this.escapeHtml(personName)}</strong>
                            <div style="display: flex; gap: 6px; align-items: center; font-size: 0.74rem; color: var(--text-secondary); margin-top: 1px;">
                                <span>📹 ${this.escapeHtml(ev.camera_name || `Camera #${ev.camera_id}`)}</span>
                                ${ev.zone_name ? `<span>· 🎯 ${this.escapeHtml(ev.zone_name)}</span>` : ''}
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 0.65rem;">
                        ${alertBadge}
                        <div style="display: flex; flex-direction: column; align-items: flex-end; font-size: 0.72rem; color: var(--text-secondary);">
                            <span style="direction: ltr; font-family: monospace; font-weight: 600; color: var(--text-primary);">
                                ${this.escapeHtml(timeStr)}
                            </span>
                            ${relTime ? `<small style="color: var(--text-tertiary);">${this.escapeHtml(relTime)}</small>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = itemsHtml;
    },

    /**
     * Modal displaying today's text-only events for a single staff member.
     */
    showPersonEvents(personId, personName) {
        const isRtl = I18n.isRTL();
        const personEvents = (this._events || []).filter(e => e.person_id === personId);
        const avatarGrad = this.getAvatarGradient(personName);
        const initial = (personName || 'P').trim().charAt(0).toUpperCase();

        let bodyHtml = '';
        if (personEvents.length === 0) {
            bodyHtml = `
                <div class="text-center py-4 text-muted">
                    <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">📝</span>
                    <span>${I18n.t('no_events_today') || 'هیچ رخداد ترددی برای امروز ثبت نشده است.'}</span>
                </div>
            `;
        } else {
            bodyHtml = `
                <div class="sup-timeline-feed" style="max-height: 420px; overflow-y: auto;">
                    ${personEvents.map(ev => {
                        const isAlert = ev.alert_type && ev.alert_type !== 'normal';
                        const timeStr = I18n.formatTimestamp ? I18n.formatTimestamp(ev.timestamp) : new Date(ev.timestamp).toLocaleTimeString();
                        const relTime = this.formatRelativeTime(ev.timestamp);
                        const alertBadge = isAlert 
                            ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; font-size: 0.72rem;">⚠️ ${this.escapeHtml(ev.alert_type)}</span>`
                            : `<span class="badge" style="background: rgba(34, 197, 94, 0.12); color: #4ade80; font-size: 0.72rem;">🟢 حضور</span>`;

                        return `
                            <div class="sup-timeline-row ${isAlert ? 'alert' : ''}" style="margin-bottom: 0.4rem;">
                                <div>
                                    <strong style="font-size: 0.88rem; color: var(--text-primary);">
                                        📹 ${this.escapeHtml(ev.camera_name || `Camera #${ev.camera_id}`)}
                                    </strong>
                                    ${ev.zone_name ? `<div style="font-size: 0.76rem; color: var(--accent-blue); margin-top: 1px;">🎯 ${this.escapeHtml(ev.zone_name)}</div>` : ''}
                                </div>
                                <div style="display: flex; align-items: center; gap: 0.6rem;">
                                    ${alertBadge}
                                    <div style="text-align: end; font-size: 0.74rem;">
                                        <div style="font-family: monospace; font-weight: 700; color: var(--text-primary);">${this.escapeHtml(timeStr)}</div>
                                        <small style="color: var(--text-tertiary);">${this.escapeHtml(relTime)}</small>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        App.openModal(`
            <div class="modal-header">
                <div class="modal-title-group" style="display: flex; align-items: center; gap: 0.75rem;">
                    <div class="sup-avatar-badge" style="width: 38px; height: 38px; font-size: 1rem; background: ${avatarGrad};">
                        ${initial}
                    </div>
                    <div>
                        <h2 class="modal-title">${I18n.t('today_activity_title') || 'ریز سوابق تردد امروز'}</h2>
                        <p class="modal-subtitle">${this.escapeHtml(personName)}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 1.25rem;">
                ${bodyHtml}
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end;">
                <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('close') || 'بستن'}</button>
            </div>
        `, 'modal-md');
    },

    /**
     * Quick leave picker for supervisor command strip.
     */
    showQuickLeavePicker() {
        const isRtl = I18n.isRTL();
        if (this._persons.length === 0) {
            App.showToast(I18n.t('no_persons_found') || 'هیچ فردی منتسب نشده است.', 'info');
            return;
        }

        const sorted = [...this._persons].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fa'));
        const options = sorted.map(p => `
            <div class="d-flex align-items-center justify-content-between p-2 border-bottom border-subtle" style="cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'" onclick="App.closeModal(); SupervisorLeaveModal.show(${p.id}, '${this.escapeAttr(p.name)}')">
                <div style="display: flex; align-items: center; gap: 0.65rem;">
                    <div class="sup-avatar-badge" style="width: 32px; height: 32px; font-size: 0.85rem; background: ${this.getAvatarGradient(p.name)};">
                        ${(p.name || 'P').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <strong style="font-size: 0.9rem; color: var(--text-primary);">${this.escapeHtml(p.name)}</strong>
                        <small class="text-muted text-xs d-block">${this.escapeHtml(p.section || 'عمومی')}</small>
                    </div>
                </div>
                <span class="btn btn-outline-primary btn-xs" style="padding: 4px 10px; font-size: 0.75rem;">
                    🏖️ ${I18n.t('leave_or_off') || 'مرخصی'}
                </span>
            </div>
        `).join('');

        App.openModal(`
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">🏖️</span>
                    <div>
                        <h2 class="modal-title">${I18n.t('quick_leave_action') || 'ثبت مرخصی پرسنل'}</h2>
                        <p class="modal-subtitle">${isRtl ? 'انتخاب فرد مورد نظر جهت تنظیم مرخصی یا آف شیفت' : 'Select staff member to manage leaves'}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 1rem; max-height: 400px; overflow-y: auto;">
                ${options}
            </div>
        `, 'modal-md');
    },

    setFilter(filter) {
        this._activeFilter = filter;
        document.querySelectorAll('.sup-filter-pills .filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector(`.sup-filter-pills .filter-btn[onclick*="'${filter}'"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Update active class on KPI cards
        const kpiCards = document.querySelectorAll('.sup-kpi-card');
        kpiCards.forEach(c => c.classList.remove('is-active'));
        const targetKpi = document.querySelector(`.sup-kpi-card[onclick*="'${filter}'"]`);
        if (targetKpi) targetKpi.classList.add('is-active');

        this.renderRoster();
    },

    setSection(sec) {
        this._selectedSection = sec;
        this.renderRoster();
    },

    setSort(sortVal) {
        this._sortBy = sortVal;
        this.renderRoster();
    },

    setTimelineFilter(tFilter) {
        this._timelineFilter = tFilter;
        this.renderTimeline();
    },

    handleSearch(val) {
        this._searchQuery = val;
        const clearBtn = document.getElementById('sup-search-clear');
        if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
        this.renderRoster();
    },

    clearSearch() {
        this._searchQuery = '';
        const input = document.getElementById('sup-person-search');
        if (input) {
            input.value = '';
            input.focus();
        }
        const clearBtn = document.getElementById('sup-search-clear');
        if (clearBtn) clearBtn.style.display = 'none';
        this.renderRoster();
    },

    setViewMode(mode) {
        this._viewMode = mode;
        try {
            localStorage.setItem('supervisor_roster_view', mode);
        } catch (e) {}

        const gridBtn = document.getElementById('sup-view-grid');
        const listBtn = document.getElementById('sup-view-list');
        if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
        if (listBtn) listBtn.classList.toggle('active', mode === 'list');
        this.renderRoster();
    },
};
