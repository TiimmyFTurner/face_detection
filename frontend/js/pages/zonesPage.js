/**
 * ZonesPage — Dedicated Zone Monitoring, Timetable Shifts, Live Presence Board & Violation Logs.
 */
const ZonesPage = {
    _statusData: [],
    _zones: [],
    _cameras: [],
    _logs: [],
    _logTotal: 0,
    _logPage: 1,
    _logLimit: 25,
    _logLoading: false,
    _activeSubTab: 'board', // 'board', 'zones', 'logs'
    _pollTimer: null,

    /**
     * Load the Zone Monitoring page.
     */
    async load() {
        document.getElementById('page-title').textContent = I18n.t('zones_title');
        
        const headerActions = document.getElementById('header-actions');
        headerActions.innerHTML = `
            <button class="btn btn-secondary btn-sm" onclick="ZonesPage.refresh()">
                🔄 ${I18n.t('refresh')}
            </button>
        `;

        const contentBody = document.getElementById('content-body');
        contentBody.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <span>${I18n.t('loading')}</span>
            </div>
        `;

        await ZonesPage.fetchData();
        ZonesPage.render();

        // Start auto-refreshing live presence status every 10 seconds while on this tab
        if (ZonesPage._pollTimer) clearInterval(ZonesPage._pollTimer);
        ZonesPage._pollTimer = setInterval(() => {
            if (App._currentPage === 'zones') {
                ZonesPage.pollStatus();
            } else {
                clearInterval(ZonesPage._pollTimer);
            }
        }, 10000);
    },

    /**
     * Fetch all status, zones, cameras, and logs data in parallel.
     */
    async fetchData() {
        try {
            const [statusRes, zonesRes, camerasRes, logsRes] = await Promise.allSettled([
                App.api('/api/zones/status'),
                App.api('/api/zones'),
                App.api('/api/cameras'),
                App.api(`/api/zones/logs?limit=${ZonesPage._logLimit}&offset=${(ZonesPage._logPage - 1) * ZonesPage._logLimit}`),
            ]);

            ZonesPage._statusData = statusRes.status === 'fulfilled' && Array.isArray(statusRes.value) ? statusRes.value : [];
            ZonesPage._zones = zonesRes.status === 'fulfilled' && Array.isArray(zonesRes.value) ? zonesRes.value : [];
            ZonesPage._cameras = camerasRes.status === 'fulfilled' && Array.isArray(camerasRes.value) ? camerasRes.value : [];
            
            if (logsRes.status === 'fulfilled' && logsRes.value) {
                if (Array.isArray(logsRes.value)) {
                    ZonesPage._logs = logsRes.value;
                    ZonesPage._logTotal = logsRes.value.length;
                } else {
                    ZonesPage._logs = logsRes.value.events || [];
                    ZonesPage._logTotal = logsRes.value.total || 0;
                }
            }
        } catch (err) {
            console.error('Error fetching zone data:', err);
        }
    },

    /**
     * Silent poll for live presence board updates.
     */
    async pollStatus() {
        try {
            const statusData = await App.api('/api/zones/status');
            ZonesPage._statusData = statusData || [];
            if (ZonesPage._activeSubTab === 'board') {
                const boardContainer = document.getElementById('zones-presence-grid');
                if (boardContainer) {
                    boardContainer.innerHTML = ZonesPage.renderPresenceGrid();
                }
                ZonesPage.updateSummaryStats();
            }
        } catch (e) {
            // Ignore background poll errors
        }
    },

    /**
     * Render the complete Zones page.
     */
    render() {
        const contentBody = document.getElementById('content-body');

        const zonesCount = I18n.isRTL() ? I18n.toPersianDigits(ZonesPage._zones.length) : ZonesPage._zones.length;
        const logsCount = I18n.isRTL() ? I18n.toPersianDigits(ZonesPage._logs.length) : ZonesPage._logs.length;

        contentBody.innerHTML = `
            <!-- Top Summary Stats -->
            <div id="zone-summary-stats" style="margin-bottom: 1.5rem;">
                ${ZonesPage.renderSummaryStatsHtml()}
            </div>

            <!-- Sub-tab Navigation Bar -->
            <div class="view-toggle-bar" style="display: flex; gap: 0.75rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.75rem; flex-wrap: wrap;">
                <button class="btn btn-sm ${ZonesPage._activeSubTab === 'board' ? 'btn-primary' : 'btn-secondary'}" onclick="ZonesPage.switchSubTab('board')">
                    ${I18n.t('subtab_board')}
                </button>
                <button class="btn btn-sm ${ZonesPage._activeSubTab === 'zones' ? 'btn-primary' : 'btn-secondary'}" onclick="ZonesPage.switchSubTab('zones')">
                    ${I18n.t('subtab_zones', { count: zonesCount })}
                </button>
                <button class="btn btn-sm ${ZonesPage._activeSubTab === 'logs' ? 'btn-primary' : 'btn-secondary'}" onclick="ZonesPage.switchSubTab('logs')">
                    ${I18n.t('subtab_logs', { count: logsCount })}
                </button>
            </div>

            <!-- Tab Content Container -->
            <div id="zone-subtab-content">
                ${ZonesPage.renderSubTabContent()}
            </div>
        `;
    },

    switchSubTab(tab) {
        ZonesPage._activeSubTab = tab;
        ZonesPage.render();
    },

    async refresh() {
        App.toast(I18n.t('loading'), 'info');
        await ZonesPage.fetchData();
        ZonesPage.render();
        App.toast(I18n.t('refresh'), 'success');
    },

    /**
     * Compute and render top statistics cards.
     */
    renderSummaryStatsHtml() {
        let totalZones = ZonesPage._statusData.length;
        let presentCount = 0;
        let absentCount = 0;
        let offDutyCount = 0;

        ZonesPage._statusData.forEach(z => {
            if (!z.is_in_schedule) {
                offDutyCount++;
            } else {
                const hasAbsent = (z.assigned_persons || []).some(p => p.status === 'absent');
                if (hasAbsent) {
                    absentCount++;
                } else if (z.assigned_persons && z.assigned_persons.length > 0) {
                    presentCount++;
                }
            }
        });

        const totalStr = I18n.isRTL() ? I18n.toPersianDigits(totalZones) : totalZones;
        const presentStr = I18n.isRTL() ? I18n.toPersianDigits(presentCount) : presentCount;
        const absentStr = I18n.isRTL() ? I18n.toPersianDigits(absentCount) : absentCount;
        const offDutyStr = I18n.isRTL() ? I18n.toPersianDigits(offDutyCount) : offDutyCount;

        return `
            <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                <div class="stat-card" style="background: var(--bg-glass); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                    <div class="stat-icon" style="font-size: 1.5rem; margin-bottom: 0.4rem;">🎯</div>
                    <div class="stat-value" style="font-size: 1.6rem; font-weight: 800; color: var(--text-primary);">${totalStr}</div>
                    <div class="stat-label" style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">${I18n.t('total_active_zones')}</div>
                </div>
                <div class="stat-card" style="background: var(--bg-glass); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid rgba(16, 185, 129, 0.3);">
                    <div class="stat-icon" style="font-size: 1.5rem; margin-bottom: 0.4rem;">🟢</div>
                    <div class="stat-value" style="font-size: 1.6rem; font-weight: 800; color: var(--accent-emerald);">${presentStr}</div>
                    <div class="stat-label" style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">${I18n.t('staff_on_station')}</div>
                </div>
                <div class="stat-card" style="background: var(--bg-glass); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid rgba(239, 68, 68, 0.3);">
                    <div class="stat-icon" style="font-size: 1.5rem; margin-bottom: 0.4rem;">🔴</div>
                    <div class="stat-value" style="font-size: 1.6rem; font-weight: 800; color: #f87171;">${absentStr}</div>
                    <div class="stat-label" style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">${I18n.t('absence_alerts')}</div>
                </div>
                <div class="stat-card" style="background: var(--bg-glass); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                    <div class="stat-icon" style="font-size: 1.5rem; margin-bottom: 0.4rem;">⚪</div>
                    <div class="stat-value" style="font-size: 1.6rem; font-weight: 800; color: var(--text-secondary);">${offDutyStr}</div>
                    <div class="stat-label" style="font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase;">${I18n.t('off_duty_stat')}</div>
                </div>
            </div>
        `;
    },

    updateSummaryStats() {
        const container = document.getElementById('zone-summary-stats');
        if (container) {
            container.innerHTML = ZonesPage.renderSummaryStatsHtml();
        }
    },

    /**
     * Render the active sub-tab content.
     */
    renderSubTabContent() {
        if (ZonesPage._activeSubTab === 'board') {
            return `
                <div id="zones-presence-grid" class="presence-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem;">
                    ${ZonesPage.renderPresenceGrid()}
                </div>
            `;
        } else if (ZonesPage._activeSubTab === 'zones') {
            return ZonesPage.renderZoneAssignmentsTab();
        } else {
            return ZonesPage.renderLogsTab();
        }
    },

    /**
     * Render the Live Presence Board cards.
     */
    renderPresenceGrid() {
        if (ZonesPage._statusData.length === 0) {
            return `
                <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--bg-glass); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🎯</div>
                    <h3 style="margin-bottom: 0.5rem; color: var(--text-primary);">${I18n.t('no_zones_title')}</h3>
                    <p style="color: var(--text-tertiary); font-size: 0.9rem; margin-bottom: 1.25rem;">${I18n.t('no_zones_desc')}</p>
                    <button class="btn btn-primary" onclick="App.navigate('cameras')">${I18n.t('manage_cameras_zones')}</button>
                </div>
            `;
        }

        return ZonesPage._statusData.map(z => {
            let overallStatus = 'present';
            let statusColor = '#10b981';
            let statusBadge = I18n.t('badge_on_station');

            if (!z.is_in_schedule) {
                overallStatus = 'off_duty';
                statusColor = '#94a3b8';
                statusBadge = I18n.t('badge_off_duty');
            } else if ((z.assigned_persons || []).some(p => p.status === 'absent')) {
                overallStatus = 'absent';
                statusColor = '#ef4444';
                statusBadge = I18n.t('badge_absent');
            }

            return `
                <div class="presence-card" style="background: var(--bg-glass); border: 1px solid ${overallStatus === 'absent' ? 'rgba(239, 68, 68, 0.4)' : overallStatus === 'present' ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-subtle)'}; border-radius: var(--radius-lg); padding: 1.25rem; backdrop-filter: blur(12px); display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <!-- Header -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.85rem;">
                            <div>
                                <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                                    <span>🎯</span>
                                    <span>${ZonesPage.escapeHtml(z.zone_name)}</span>
                                </div>
                                <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.15rem;">
                                    📹 ${ZonesPage.escapeHtml(z.camera_name)}
                                </div>
                            </div>
                            <span style="font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: var(--radius-full); background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor}55;">
                                ${statusBadge}
                            </span>
                        </div>

                        <!-- Timetable / Shift -->
                        <div style="background: var(--bg-surface-hover); padding: 0.6rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 0.85rem; font-size: 0.75rem;">
                            <div style="color: var(--text-tertiary); font-weight: 600; text-transform: uppercase; font-size: 0.65rem;">${I18n.t('timetable_shift')}</div>
                            <div style="color: var(--accent-blue); font-weight: 600; margin-top: 0.15rem;">${ZonesPage.escapeHtml(I18n.formatTimetableText(z.timetable_text))}</div>
                        </div>

                        <!-- Attached Person(s) Status List -->
                        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
                            <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase;">${I18n.t('assigned_staff')}</div>
                            ${z.assigned_persons.length === 0 ? `
                                <div style="font-size: 0.78rem; color: var(--text-tertiary); font-style: italic;">${I18n.t('no_staff_assigned')}</div>
                            ` : z.assigned_persons.map(p => {
                                const lastSeenDisplay = I18n.formatLastSeen(p);
                                return `
                                    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.35rem;">
                                            <span>👤</span>
                                            <span>${ZonesPage.escapeHtml(p.person_name)}</span>
                                        </div>
                                        <div style="font-size: 0.72rem; font-weight: 600; color: ${p.status === 'present' ? 'var(--accent-emerald)' : p.status === 'absent' ? '#f87171' : 'var(--text-tertiary)'};">
                                            ${lastSeenDisplay}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <!-- Actions -->
                    <div style="display: flex; gap: 0.5rem; border-top: 1px solid var(--border-subtle); padding-top: 0.85rem;">
                        <button class="btn btn-secondary btn-sm" onclick="ZoneModal.show(${z.camera_id})" style="flex: 1; justify-content: center; font-size: 0.75rem;">
                            ${I18n.t('edit_area_shift')}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Render the Zone Assignments & Shift management sub-tab.
     */
    renderZoneAssignmentsTab() {
        return `
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-glass); padding: 1rem 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 style="margin: 0 0 0.25rem 0; color: var(--text-primary); font-size: 1.05rem;">${I18n.t('zone_list_header_title')}</h3>
                        <p style="margin: 0; font-size: 0.8rem; color: var(--text-tertiary);">${I18n.t('zone_list_header_desc')}</p>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="App.navigate('cameras')">
                        ${I18n.t('go_to_cameras')}
                    </button>
                </div>

                <div class="zones-assignment-list" style="display: flex; flex-direction: column; gap: 1rem;">
                    ${ZonesPage._cameras.map(cam => {
                        const camZones = ZonesPage._zones.filter(z => z.camera_id === cam.id);
                        const camZonesCount = I18n.isRTL() ? I18n.toPersianDigits(camZones.length) : camZones.length;

                        return `
                            <div class="camera-zone-group" style="background: var(--bg-glass); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); padding: 1.25rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                                        <span style="font-size: 1.3rem;">📹</span>
                                        <div>
                                            <div style="font-weight: 700; color: var(--text-primary); font-size: 1rem;">${ZonesPage.escapeHtml(cam.name)}</div>
                                            <div style="font-size: 0.75rem; color: var(--text-tertiary);">${ZonesPage.escapeHtml(cam.location || I18n.t('none'))}</div>
                                        </div>
                                    </div>
                                    <button class="btn btn-secondary btn-sm" onclick="ZoneModal.show(${cam.id})" style="background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.4); color: var(--accent-blue);">
                                        ${I18n.t('btn_manage_zones', { count: camZonesCount })}
                                    </button>
                                </div>

                                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.75rem;">
                                    ${camZones.length === 0 ? `
                                        <div style="font-size: 0.8rem; color: var(--text-tertiary); padding: 0.5rem 0;">${I18n.t('no_camera_zones')}</div>
                                    ` : camZones.map(z => {
                                        const rawTimetable = `${z.start_time || '00:00'} - ${z.end_time || '23:59'} (${(z.active_days || []).join(', ')})`;
                                        const formattedTimetable = I18n.formatTimetableText(rawTimetable);
                                        const attachedIds = (z.assigned_person_ids || []).map(id => I18n.isRTL() ? I18n.toPersianDigits(id) : id).join(', ') || I18n.t('none');

                                        return `
                                            <div style="background: var(--bg-surface); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                                <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); margin-bottom: 0.25rem;">🎯 ${ZonesPage.escapeHtml(z.name)}</div>
                                                <div style="font-size: 0.72rem; color: var(--accent-blue); margin-bottom: 0.2rem;">🕐 ${formattedTimetable}</div>
                                                <div style="font-size: 0.7rem; color: var(--text-tertiary);">${I18n.t('attached_ids', { ids: attachedIds })}</div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    },

    /**
     * Load a specific page of Security & Absence Logs.
     */
    async loadLogs(page = 1, limit = ZonesPage._logLimit) {
        ZonesPage._logLoading = true;
        try {
            const offset = Math.max(0, (page - 1) * limit);
            const data = await App.api(`/api/zones/logs?limit=${limit}&offset=${offset}`);
            if (Array.isArray(data)) {
                ZonesPage._logs = data;
                ZonesPage._logTotal = data.length;
            } else if (data) {
                ZonesPage._logs = data.events || [];
                ZonesPage._logTotal = data.total || 0;
            }
            ZonesPage._logPage = page;
            ZonesPage._logLimit = limit;

            // Update sub-tab count badge
            const logsBtn = document.querySelector('button[onclick*="switchSubTab(\'logs\')"]');
            if (logsBtn) {
                const logsCount = I18n.isRTL() ? I18n.toPersianDigits(ZonesPage._logTotal) : ZonesPage._logTotal;
                logsBtn.textContent = I18n.t('subtab_logs', { count: logsCount });
            }

            if (ZonesPage._activeSubTab === 'logs') {
                const content = document.getElementById('zone-subtab-content');
                if (content) {
                    content.innerHTML = ZonesPage.renderLogsTab();
                }
            }
        } catch (err) {
            console.error('Failed to load zone logs:', err);
        } finally {
            ZonesPage._logLoading = false;
        }
    },

    async changeLogsPerPage(limit) {
        const parsed = parseInt(limit, 10) || 25;
        await ZonesPage.loadLogs(1, parsed);
    },

    async goToLogsPage(page) {
        await ZonesPage.loadLogs(page, ZonesPage._logLimit);
    },

    /**
     * Render the Security & Absence Logs sub-tab with pagination.
     */
    renderLogsTab() {
        if (ZonesPage._logs.length === 0) {
            return `
                <div class="empty-state" style="text-align: center; padding: 3rem; background: var(--bg-glass); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📋</div>
                    <h3 style="margin-bottom: 0.5rem; color: var(--text-primary);">${I18n.t('no_logs_title')}</h3>
                    <p style="color: var(--text-tertiary); font-size: 0.9rem;">${I18n.t('no_logs_desc')}</p>
                </div>
            `;
        }

        const total = ZonesPage._logTotal || ZonesPage._logs.length;
        const limit = ZonesPage._logLimit || 25;
        const page = ZonesPage._logPage || 1;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const from = total === 0 ? 0 : (page - 1) * limit + 1;
        const to = Math.min(total, page * limit);

        const fromFormatted = I18n.isRTL() ? I18n.toPersianDigits(from) : from;
        const toFormatted = I18n.isRTL() ? I18n.toPersianDigits(to) : to;
        const totalFormatted = I18n.isRTL() ? I18n.toPersianDigits(total) : total;
        const pageFormatted = I18n.isRTL() ? I18n.toPersianDigits(page) : page;
        const totalPagesFormatted = I18n.isRTL() ? I18n.toPersianDigits(totalPages) : totalPages;

        return `
            <div style="background: var(--bg-glass); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); overflow: hidden; display: flex; flex-direction: column;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                    <thead>
                        <tr style="background: var(--bg-surface-hover); border-bottom: 1px solid var(--border-subtle); color: var(--text-tertiary); font-size: 0.75rem; text-transform: uppercase;">
                            <th style="padding: 0.85rem 1rem;">${I18n.t('table_snapshot')}</th>
                            <th style="padding: 0.85rem 1rem;">${I18n.t('table_time')}</th>
                            <th style="padding: 0.85rem 1rem;">${I18n.t('table_person')}</th>
                            <th style="padding: 0.85rem 1rem;">${I18n.t('table_camera_area')}</th>
                            <th style="padding: 0.85rem 1rem;">${I18n.t('table_violation')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ZonesPage._logs.map(log => {
                            let alertBadge = '<span style="padding: 2px 8px; border-radius: var(--radius-full); background: rgba(59, 130, 246, 0.2); color: var(--accent-blue); font-size: 0.7rem; font-weight: 700;">Zone Event</span>';
                            if (log.alert_type === 'out_of_zone') {
                                alertBadge = `<span style="padding: 2px 8px; border-radius: var(--radius-full); background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 0.7rem; font-weight: 700;">${I18n.t('alert_out_of_zone')}</span>`;
                            } else if (log.alert_type === 'unauthorized_entry') {
                                alertBadge = `<span style="padding: 2px 8px; border-radius: var(--radius-full); background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5); font-size: 0.7rem; font-weight: 700;">${I18n.t('alert_unauthorized')}</span>`;
                            } else if (log.alert_type === 'absence_timeout') {
                                alertBadge = `<span style="padding: 2px 8px; border-radius: var(--radius-full); background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 0.7rem; font-weight: 700;">${I18n.t('alert_absence_timeout')}</span>`;
                            }

                            const timeStr = I18n.formatFullTimestamp(log.timestamp);
                            const personDisplayName = log.person_name || I18n.t('unknown');
                            const camName = log.camera_name || I18n.t('event_camera');

                            return `
                                <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;" onmouseover="this.style.background='var(--bg-surface-hover)'" onmouseout="this.style.background='transparent'">
                                    <td style="padding: 0.6rem 1rem;">
                                        <img src="${log.snapshot_url || '/api/snapshots/' + log.snapshot_path}" style="width: 46px; height: 46px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); cursor: pointer;" onclick="EventCard.showDetailModal(${log.id})" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 50 50%22><rect fill=%22%231e293b%22 width=%2250%22 height=%2250%22/><text x=%2225%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2210%22>${encodeURIComponent(I18n.t('no_image'))}</text></svg>'" />
                                    </td>
                                    <td style="padding: 0.6rem 1rem; color: var(--text-secondary); font-size: 0.8rem;">${timeStr}</td>
                                    <td style="padding: 0.6rem 1rem; font-weight: 600; color: var(--text-primary);">👤 ${ZonesPage.escapeHtml(personDisplayName)}</td>
                                    <td style="padding: 0.6rem 1rem;">
                                        <div style="font-weight: 600; color: var(--text-primary);">📹 ${ZonesPage.escapeHtml(camName)}</div>
                                        ${log.zone_name ? `<div style="font-size: 0.72rem; color: var(--accent-blue);">🎯 ${I18n.t('event_area')}: ${ZonesPage.escapeHtml(log.zone_name)}</div>` : ''}
                                    </td>
                                    <td style="padding: 0.6rem 1rem;">
                                        <div style="display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start;">
                                             <div>${alertBadge}</div>
                                             ${(log.duration_seconds || log.duration_str) ? `
                                                 <div style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; font-weight: 700; color: #fbbf24; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 7px; border-radius: var(--radius-sm);">
                                                     <span>${I18n.t('absence_duration_pill', { duration: log.duration_seconds ? I18n.formatDuration(log.duration_seconds) : log.duration_str })}</span>
                                                 </div>
                                             ` : ''}
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                <!-- Pagination Footer Bar -->
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.25rem; background: var(--bg-surface-hover); border-top: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.75rem;">
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        ${I18n.t('pagination_showing', { from: fromFormatted, to: toFormatted, total: totalFormatted })}
                    </div>

                    <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-tertiary);">
                            <span>${I18n.t('pagination_per_page')}</span>
                            <select class="form-input" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; width: auto;" onchange="ZonesPage.changeLogsPerPage(this.value)">
                                <option value="15" ${limit === 15 ? 'selected' : ''}>15</option>
                                <option value="25" ${limit === 25 ? 'selected' : ''}>25</option>
                                <option value="50" ${limit === 50 ? 'selected' : ''}>50</option>
                                <option value="100" ${limit === 100 ? 'selected' : ''}>100</option>
                            </select>
                        </div>

                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <button
                                class="btn btn-secondary btn-sm"
                                ${page <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}
                                onclick="ZonesPage.goToLogsPage(${page - 1})"
                            >
                                ${I18n.t('pagination_prev')}
                            </button>
                            
                            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); padding: 0 0.4rem;">
                                ${I18n.t('pagination_page_of', { page: pageFormatted, totalPages: totalPagesFormatted })}
                            </span>

                            <button
                                class="btn btn-secondary btn-sm"
                                ${page >= totalPages ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}
                                onclick="ZonesPage.goToLogsPage(${page + 1})"
                            >
                                ${I18n.t('pagination_next')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Prepend incoming real-time zone alert/event to the Security & Absence Logs list.
     */
    addRealtimeLog(data) {
        const eventItem = data.event || {
            id: data.id || Date.now(),
            timestamp: data.timestamp || new Date().toISOString(),
            camera_id: data.camera_id,
            camera_name: data.camera_name,
            person_id: data.person_id,
            person_name: data.person_name,
            zone_id: data.zone_id,
            zone_name: data.zone_name,
            alert_type: data.alert_type || 'out_of_zone',
            snapshot_url: data.snapshot_url || (data.snapshot_path ? '/api/snapshots/' + data.snapshot_path : ''),
            snapshot_path: data.snapshot_path || '',
            confidence_score: data.confidence_score || 1.0,
            duration_seconds: data.duration_seconds || null,
            duration_str: data.duration_str || null,
            is_known: true
        };

        if (typeof EventCard !== 'undefined' && EventCard._cache) {
            EventCard._cache[eventItem.id] = eventItem;
        }

        // Avoid duplicate ID
        if (!ZonesPage._logs.some(l => l.id === eventItem.id)) {
            ZonesPage._logs.unshift(eventItem);
            if (ZonesPage._logs.length > 100) {
                ZonesPage._logs = ZonesPage._logs.slice(0, 100);
            }
        }

        // Update Subtab count badge
        const logsBtn = document.querySelector('button[onclick*="switchSubTab(\'logs\')"]');
        if (logsBtn) {
            const logsCount = I18n.isRTL() ? I18n.toPersianDigits(ZonesPage._logs.length) : ZonesPage._logs.length;
            logsBtn.textContent = I18n.t('subtab_logs', { count: logsCount });
        }

        // If currently viewing logs tab, re-render the table dynamically
        if (ZonesPage._activeSubTab === 'logs') {
            const content = document.getElementById('zone-subtab-content');
            if (content) {
                content.innerHTML = ZonesPage.renderLogsTab();
            }
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    },
};
