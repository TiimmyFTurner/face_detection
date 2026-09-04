/**
 * DutyPage — Live Shift & Duty Roster Monitoring Page.
 * Real-time tracking of personnel currently in scheduled duty hours:
 * - Assigned shift time window
 * - Real-time absence if not currently in their assigned camera zone
 * - Cumulative sum of absence for the active shift today
 * - Live countdown and auto-refresh
 */
const DutyPage = {
    _data: null,
    _autoRefreshTimer: null,
    _countdown: 10,
    _currentFilter: 'all', // 'all', 'present', 'absent'
    _onlyActive: true,
    _isLoading: false,

    /**
     * Entry point when user navigates to Duty page.
     */
    load() {
        DutyPage.cleanup();
        DutyPage._countdown = 10;
        DutyPage.renderSkeleton();
        DutyPage.fetchData();
        DutyPage.startAutoRefresh();
    },

    /**
     * Stop background timers when navigating away.
     */
    cleanup() {
        if (DutyPage._autoRefreshTimer) {
            clearInterval(DutyPage._autoRefreshTimer);
            DutyPage._autoRefreshTimer = null;
        }
    },

    /**
     * Render header, actions, and skeleton container.
     */
    renderSkeleton() {
        const isRtl = I18n.isRTL();
        document.getElementById('page-title').textContent = I18n.t('duty_title');

        const headerActions = document.getElementById('header-actions');
        if (headerActions) {
            headerActions.innerHTML = `
                <div class="duty-header-toolbar" style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                    <!-- Filter Pills -->
                    <div class="btn-group" style="display: flex; gap: 0.35rem; background: var(--bg-card); padding: 4px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <button class="btn btn-sm ${DutyPage._currentFilter === 'all' ? 'btn-primary' : 'btn-ghost'}" id="filter-duty-all" onclick="DutyPage.setFilter('all')">
                            ${I18n.t('filter_all_duty')}
                        </button>
                        <button class="btn btn-sm ${DutyPage._currentFilter === 'present' ? 'btn-primary' : 'btn-ghost'}" id="filter-duty-present" onclick="DutyPage.setFilter('present')">
                            ${I18n.t('filter_present')}
                        </button>
                        <button class="btn btn-sm ${DutyPage._currentFilter === 'absent' ? 'btn-primary' : 'btn-ghost'}" id="filter-duty-absent" onclick="DutyPage.setFilter('absent')">
                            ${I18n.t('filter_absent')}
                        </button>
                    </div>

                    <!-- Only Active Shift Toggle -->
                    <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer; user-select: none; background: var(--bg-card); padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <input type="checkbox" id="toggle-only-active" ${DutyPage._onlyActive ? 'checked' : ''} onchange="DutyPage.toggleOnlyActive(this.checked)" style="accent-color: var(--accent-blue); cursor: pointer;" />
                        <span>${I18n.t('toggle_only_active')}</span>
                    </label>

                    <!-- Refresh & Timer Badge -->
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span class="badge-status-pill" id="duty-timer-badge" style="font-size: 0.78rem; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-secondary); padding: 6px 12px;">
                            ⏳ <span id="duty-countdown-num">${DutyPage._countdown}</span>s
                        </span>
                        <button class="btn btn-secondary btn-sm" onclick="DutyPage.fetchData()" title="${I18n.t('refresh')}" style="padding: 6px 12px;">
                            🔄 ${I18n.t('refresh')}
                        </button>
                    </div>
                </div>
            `;
        }

        const body = document.getElementById('content-body');
        if (body) {
            body.innerHTML = `
                <div class="duty-page-container">
                    <div class="duty-kpi-deck" id="duty-kpi-deck" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                        <!-- KPI Cards populated dynamically -->
                    </div>

                    <div id="duty-roster-list" class="duty-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1.25rem;">
                        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-tertiary);">
                            <div class="loading-spinner" style="margin: 0 auto 1rem;"></div>
                            ${I18n.t('loading')}
                        </div>
                    </div>
                </div>
            `;
        }
    },

    /**
     * Start the 10-second countdown auto-refresh timer.
     */
    startAutoRefresh() {
        if (DutyPage._autoRefreshTimer) clearInterval(DutyPage._autoRefreshTimer);
        DutyPage._countdown = 10;
        DutyPage._autoRefreshTimer = setInterval(() => {
            DutyPage._countdown--;
            const countEl = document.getElementById('duty-countdown-num');
            if (countEl) {
                countEl.textContent = DutyPage._countdown;
            }
            if (DutyPage._countdown <= 0) {
                DutyPage._countdown = 10;
                DutyPage.fetchData(false);
            }
        }, 1000);
    },

    /**
     * Set active filter (all, present, absent).
     */
    setFilter(filter) {
        DutyPage._currentFilter = filter;
        ['all', 'present', 'absent'].forEach(f => {
            const btn = document.getElementById(`filter-duty-${f}`);
            if (btn) {
                btn.className = `btn btn-sm ${DutyPage._currentFilter === f ? 'btn-primary' : 'btn-ghost'}`;
            }
        });
        DutyPage.renderRoster();
    },

    /**
     * Toggle only active duty hours filter.
     */
    toggleOnlyActive(checked) {
        DutyPage._onlyActive = checked;
        DutyPage.fetchData();
    },

    /**
     * Fetch roster from the backend.
     */
    async fetchData(showSpinner = true) {
        if (DutyPage._isLoading) return;
        DutyPage._isLoading = true;

        if (showSpinner && !DutyPage._data) {
            const rosterEl = document.getElementById('duty-roster-list');
            if (rosterEl) {
                rosterEl.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-tertiary);">
                        <div class="loading-spinner" style="margin: 0 auto 1rem;"></div>
                        ${I18n.t('loading')}
                    </div>
                `;
            }
        }

        try {
            const res = await fetch(`/api/zones/duty-roster?only_active=${DutyPage._onlyActive}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            DutyPage._data = await res.json();
            DutyPage.renderKPIs();
            DutyPage.renderRoster();
        } catch (err) {
            console.error('Failed to load duty roster:', err);
            const rosterEl = document.getElementById('duty-roster-list');
            if (rosterEl) {
                rosterEl.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-color);">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
                        <div style="color: var(--text-secondary);">${I18n.t('err_failed_load', { msg: err.message })}</div>
                        <button class="btn btn-primary btn-sm" onclick="DutyPage.fetchData()" style="margin-top: 1rem;">
                            🔄 ${I18n.t('refresh')}
                        </button>
                    </div>
                `;
            }
        } finally {
            DutyPage._isLoading = false;
        }
    },

    /**
     * Render the top summary KPI cards.
     */
    renderKPIs() {
        const deck = document.getElementById('duty-kpi-deck');
        if (!deck || !DutyPage._data) return;

        const d = DutyPage._data;
        const isRtl = I18n.isRTL();

        const totalDuty = isRtl ? I18n.toPersianDigits(d.total_on_duty) : d.total_on_duty;
        const presentCount = isRtl ? I18n.toPersianDigits(d.present_count) : d.present_count;
        const absentCount = isRtl ? I18n.toPersianDigits(d.absent_count) : d.absent_count;
        const totalAbsenceStr = isRtl ? I18n.toPersianDigits(d.total_shift_absence_str) : d.total_shift_absence_str;
        const compliancePct = isRtl ? I18n.toPersianDigits(d.avg_compliance_pct.toFixed(1)) : d.avg_compliance_pct.toFixed(1);

        deck.innerHTML = `
            <!-- KPI: Total in Duty Hours -->
            <div class="kpi-card blue" style="background: var(--bg-card); border-radius: 12px; padding: 1.1rem; border: 1px solid var(--border-color); position: relative; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">${I18n.t('kpi_staff_on_duty')}</span>
                    <span style="font-size: 1.3rem;">👥</span>
                </div>
                <div style="font-size: 1.9rem; font-weight: 800; color: var(--text-primary);">${totalDuty}</div>
                <div style="font-size: 0.75rem; color: var(--accent-blue); margin-top: 0.25rem;">
                    ⏰ ${I18n.t('shift_window_badge', { window: isRtl ? I18n.toPersianDigits(d.server_time) : d.server_time })}
                </div>
            </div>

            <!-- KPI: Present on Station -->
            <div class="kpi-card emerald" style="background: var(--bg-card); border-radius: 12px; padding: 1.1rem; border: 1px solid var(--border-color); position: relative; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">${I18n.t('kpi_on_station')}</span>
                    <span style="font-size: 1.3rem;">🟢</span>
                </div>
                <div style="font-size: 1.9rem; font-weight: 800; color: var(--accent-emerald);">${presentCount}</div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">
                    ${I18n.t('in_zone_present')}
                </div>
            </div>

            <!-- KPI: Absent from Zone -->
            <div class="kpi-card rose" style="background: var(--bg-card); border-radius: 12px; padding: 1.1rem; border: 1px solid var(--border-color); position: relative; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">${I18n.t('kpi_absent_now')}</span>
                    <span style="font-size: 1.3rem;">🔴</span>
                </div>
                <div style="font-size: 1.9rem; font-weight: 800; color: var(--accent-rose);">${absentCount}</div>
                <div style="font-size: 0.75rem; color: var(--accent-rose); margin-top: 0.25rem;">
                    ${absentCount > 0 ? (isRtl ? 'نیازمند پیگیری و نظارت' : 'Needs attention') : (isRtl ? 'همه حاضر هستند' : 'All on station')}
                </div>
            </div>

            <!-- KPI: Sum of Current Shift Absence -->
            <div class="kpi-card amber" style="background: var(--bg-card); border-radius: 12px; padding: 1.1rem; border: 1px solid var(--border-color); position: relative; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">${I18n.t('kpi_total_shift_absence')}</span>
                    <span style="font-size: 1.3rem;">⌛</span>
                </div>
                <div style="font-size: 1.9rem; font-weight: 800; color: var(--accent-amber);">${totalAbsenceStr}</div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">
                    ${I18n.t('sum_shift_absence_title')}
                </div>
            </div>

            <!-- KPI: Average Compliance -->
            <div class="kpi-card purple" style="background: var(--bg-card); border-radius: 12px; padding: 1.1rem; border: 1px solid var(--border-color); position: relative; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">${I18n.t('kpi_avg_compliance')}</span>
                    <span style="font-size: 1.3rem;">📊</span>
                </div>
                <div style="font-size: 1.9rem; font-weight: 800; color: var(--accent-purple);">${compliancePct}%</div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">
                    ${I18n.t('kpi_shift_compliance')}
                </div>
            </div>
        `;
    },

    /**
     * Render the roster cards list according to current filters.
     */
    renderRoster() {
        const rosterEl = document.getElementById('duty-roster-list');
        if (!rosterEl || !DutyPage._data) return;

        const isRtl = I18n.isRTL();
        let roster = DutyPage._data.roster || [];

        // Apply tab filter
        if (DutyPage._currentFilter === 'present') {
            roster = roster.filter(r => r.status === 'present');
        } else if (DutyPage._currentFilter === 'absent') {
            roster = roster.filter(r => r.status === 'absent');
        }

        if (roster.length === 0) {
            rosterEl.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1.5rem; background: var(--bg-card); border-radius: 16px; border: 1px dashed var(--border-color);">
                    <div style="font-size: 3rem; margin-bottom: 0.75rem; opacity: 0.8;">⏱️</div>
                    <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.4rem;">
                        ${I18n.t('no_duty_title')}
                    </h3>
                    <p style="color: var(--text-tertiary); max-width: 480px; margin: 0 auto 1.5rem; font-size: 0.85rem; line-height: 1.6;">
                        ${I18n.t('no_duty_desc')}
                    </p>
                    ${DutyPage._onlyActive ? `
                        <button class="btn btn-secondary btn-sm" onclick="DutyPage.toggleOnlyActive(false)">
                            👥 ${I18n.t('filter_all_duty')}
                        </button>
                    ` : ''}
                </div>
            `;
            return;
        }

        rosterEl.innerHTML = roster.map(person => {
            const isPresent = person.status === 'present';
            const isAbsent = person.status === 'absent';
            const borderAccent = isPresent ? 'var(--accent-emerald)' : (isAbsent ? 'var(--accent-rose)' : 'var(--border-color)');

            // Avatar / Initial fallback
            const avatarHtml = person.avatar_url
                ? `<img src="${person.avatar_url}" alt="${DutyPage.escapeAttr(person.person_name)}" style="width: 52px; height: 52px; border-radius: 12px; object-fit: cover; border: 2px solid ${borderAccent}; flex-shrink: 0;" />`
                : `<div style="width: 52px; height: 52px; border-radius: 12px; background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2)); color: var(--accent-blue); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.25rem; border: 2px solid ${borderAccent}; flex-shrink: 0;">
                    ${person.person_name ? person.person_name.charAt(0) : '👤'}
                   </div>`;

            // Live status badge
            let statusBadgeHtml = '';
            if (isPresent) {
                const secAgo = person.last_seen_seconds_ago !== null ? Math.round(person.last_seen_seconds_ago) : 0;
                statusBadgeHtml = `
                    <span class="badge-status-pill on-station" style="font-size: 0.72rem; padding: 4px 10px; font-weight: 700;">
                        🟢 ${isRtl ? `حاضر در منطقه (${I18n.toPersianDigits(secAgo)} ثانیه پیش)` : `In Zone (${secAgo}s ago)`}
                    </span>
                `;
            } else if (isAbsent) {
                const minsAbsent = person.current_absence_minutes || 0;
                statusBadgeHtml = `
                    <span class="badge-status-pill absent" style="font-size: 0.72rem; padding: 4px 10px; font-weight: 700; animation: pulse 2s infinite;">
                        🔴 ${person.current_absence_minutes > 0
                            ? (isRtl ? `غایب از منطقه (${I18n.toPersianDigits(minsAbsent)} دقیقه)` : `Missing from Zone (${minsAbsent}m)`)
                            : (isRtl ? 'غایب از منطقه' : 'Absent from Zone')}
                    </span>
                `;
            } else {
                statusBadgeHtml = `
                    <span class="badge-status-pill off-duty" style="font-size: 0.72rem; padding: 4px 10px;">
                        ⚪ ${isRtl ? 'خارج از شیفت' : 'Off Duty'}
                    </span>
                `;
            }

            // Time Window display
            const windowStr = isRtl ? I18n.toPersianDigits(person.shift_window_str) : person.shift_window_str;
            const shiftDurHours = isRtl ? I18n.toPersianDigits(person.shift_duration_hours) : person.shift_duration_hours;

            // Current Absence & Sum of Absence strings
            const currAbsenceDisplay = isPresent
                ? (isRtl ? '۰ دقیقه (حاضر)' : '0m (Present)')
                : (isRtl ? I18n.toPersianDigits(person.current_absence_str) : person.current_absence_str);

            const sumShiftAbsenceDisplay = isRtl
                ? I18n.toPersianDigits(person.shift_absence_str)
                : person.shift_absence_str;

            const elapsedStr = isRtl
                ? I18n.toPersianDigits(Math.round(person.shift_elapsed_minutes))
                : Math.round(person.shift_elapsed_minutes);

            const compliancePct = isRtl
                ? I18n.toPersianDigits(person.shift_compliance_pct.toFixed(1))
                : person.shift_compliance_pct.toFixed(1);

            return `
                <div class="duty-card ${isAbsent ? 'duty-absent' : (isPresent ? 'duty-present' : '')}" style="background: var(--bg-card); border-radius: 16px; border: 1px solid var(--border-color); padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; position: relative; transition: all 0.2s ease; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);">
                    <!-- Top Info Row -->
                    <div style="display: flex; gap: 0.9rem; align-items: flex-start;">
                        ${avatarHtml}
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.25rem;">
                                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${DutyPage.escapeAttr(person.person_name)}">
                                    ${person.person_name}
                                </h4>
                                ${statusBadgeHtml}
                            </div>
                            <div style="font-size: 0.78rem; color: var(--text-tertiary); margin-bottom: 0.35rem;">
                                💼 ${person.person_role || I18n.t('no_role_assigned')}
                            </div>
                            <div style="font-size: 0.75rem; color: var(--accent-blue); background: rgba(59, 130, 246, 0.08); padding: 3px 8px; border-radius: 6px; display: inline-block;">
                                📍 <strong>${person.camera_name}</strong> — ${person.zone_name}
                            </div>
                        </div>
                    </div>

                    <!-- Shift Time Window Badge -->
                    <div style="background: var(--bg-hover); border-radius: 8px; padding: 0.6rem 0.8rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; border: 1px solid rgba(255, 255, 255, 0.05);">
                        <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 0.35rem;">
                            🕐 <strong>${I18n.t('th_shift_hours')}:</strong>
                        </span>
                        <span style="font-weight: 700; color: var(--accent-cyan); direction: ltr;">
                            ${windowStr} <span style="font-weight: 400; color: var(--text-tertiary); font-size: 0.75rem;">(${shiftDurHours}h)</span>
                        </span>
                    </div>

                    <!-- 2 Main Absence Metrics: Current Absence & Sum of Shift Absence -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                        <!-- Current Absence -->
                        <div style="background: ${isPresent ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)'}; border: 1px solid ${isPresent ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}; border-radius: 10px; padding: 0.65rem 0.75rem;">
                            <div style="font-size: 0.7rem; color: var(--text-tertiary); margin-bottom: 0.2rem; font-weight: 600;">
                                ${I18n.t('current_absence_title')}
                            </div>
                            <div style="font-size: 1.15rem; font-weight: 800; color: ${isPresent ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
                                ${currAbsenceDisplay}
                            </div>
                            <div style="font-size: 0.65rem; color: var(--text-tertiary); margin-top: 0.15rem;">
                                ${isPresent ? I18n.t('in_zone_present') : (person.last_seen_str || I18n.t('absent_not_seen'))}
                            </div>
                        </div>

                        <!-- Sum of Current Shift Absence -->
                        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px; padding: 0.65rem 0.75rem;">
                            <div style="font-size: 0.7rem; color: var(--text-tertiary); margin-bottom: 0.2rem; font-weight: 600;">
                                ${I18n.t('sum_shift_absence_title')}
                            </div>
                            <div style="font-size: 1.15rem; font-weight: 800; color: var(--accent-amber);">
                                ${sumShiftAbsenceDisplay}
                            </div>
                            <div style="font-size: 0.65rem; color: var(--text-tertiary); margin-top: 0.15rem;">
                                ${isRtl ? `از ${elapsedStr} دقیقه سپری شده` : `of ${elapsedStr}m elapsed`}
                            </div>
                        </div>
                    </div>

                    <!-- Compliance Progress Bar -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            <span>${I18n.t('compliance_rate_label', { pct: compliancePct })}</span>
                            <span style="font-weight: 700; color: ${person.shift_compliance_pct >= 85 ? 'var(--accent-emerald)' : (person.shift_compliance_pct >= 60 ? 'var(--accent-amber)' : 'var(--accent-rose)')};">
                                ${compliancePct}%
                            </span>
                        </div>
                        <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 999px; overflow: hidden; display: flex;">
                            <div style="width: ${person.shift_compliance_pct}%; height: 100%; background: linear-gradient(90deg, var(--accent-emerald), var(--accent-cyan)); transition: width 0.3s ease;"></div>
                            <div style="width: ${Math.max(0, 100 - person.shift_compliance_pct)}%; height: 100%; background: var(--accent-rose); opacity: 0.6;"></div>
                        </div>
                    </div>

                    <!-- Card Actions -->
                    <div style="margin-top: 0.25rem; display: flex; gap: 0.5rem;">
                        <button class="btn btn-secondary btn-sm" onclick="PersonAnalyticsModal.show(${person.person_id})" style="width: 100%; justify-content: center; font-size: 0.8rem; padding: 6px 12px;">
                            📊 ${I18n.t('btn_person_analytics')}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Escape string for HTML attribute safety.
     */
    escapeAttr(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
};

// Global export
window.DutyPage = DutyPage;
