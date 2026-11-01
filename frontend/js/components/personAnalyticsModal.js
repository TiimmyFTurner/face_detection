/**
 * PersonAnalyticsModal — Comprehensive shift-aware analytics and summary
 * dashboard for an individual person.
 */
const PersonAnalyticsModal = {
    _data: null,
    _personId: null,
    _activeTab: 'overview',
    _shiftFilter: 'all', // 'all', 'in_shift', 'out_shift'
    _activePeriod: '30d', // '7d' | '14d' | '30d' | '60d' | '90d' | 'custom'
    _days: 30,
    _customStartDate: '',
    _customEndDate: '',
    _startJy: null,
    _startJm: null,
    _startJd: null,
    _endJy: null,
    _endJm: null,
    _endJd: null,
    _activeCalendarTarget: null,
    _calendarViewJy: null,
    _calendarViewJm: null,
    _hasClickOutsideListener: false,

    /**
     * Fetch analytics and open the analytics modal for a person.
     * @param {number} personId
     */
    async show(personId) {
        this._personId = personId;
        this._activeTab = 'overview';
        this._shiftFilter = 'all';
        this._activePeriod = '30d';
        this._days = 30;

        // Default custom dates: today and 30 days ago
        const today = new Date();
        const past30 = new Date();
        past30.setDate(today.getDate() - 29);
        this._customEndDate = today.toISOString().slice(0, 10);
        this._customStartDate = past30.toISOString().slice(0, 10);

        const sJ = I18n.toJalali(past30);
        const eJ = I18n.toJalali(today);
        if (sJ) {
            this._startJy = sJ.jy;
            this._startJm = sJ.jm;
            this._startJd = sJ.jd;
        }
        if (eJ) {
            this._endJy = eJ.jy;
            this._endJm = eJ.jm;
            this._endJd = eJ.jd;
        }

        // Show loading state modal
        App.openModal(`
            <div class="modal-header">
                <h2 class="modal-title">${I18n.t('loading')}</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 3rem 1.5rem; text-align: center;">
                <div style="font-size: 2.5rem; margin-bottom: 1rem; animation: spin 1s infinite linear;">⏳</div>
                <div style="color: var(--text-secondary);">${I18n.t('loading')}</div>
            </div>
        `, 'modal-analytics');

        await this.loadData();
    },

    /**
     * Load analytics data for active period.
     */
    async loadData() {
        if (!this._personId) return;

        const bodyEl = document.getElementById('analytics-modal-body');
        if (bodyEl) {
            bodyEl.style.opacity = '0.5';
            bodyEl.style.pointerEvents = 'none';
        }

        try {
            let query = '';
            if (this._activePeriod === 'custom' && this._customStartDate && this._customEndDate) {
                query = `?start_date=${encodeURIComponent(this._customStartDate)}&end_date=${encodeURIComponent(this._customEndDate)}`;
            } else {
                query = `?days=${this._days || 30}`;
            }

            const data = await App.api(`/api/persons/${this._personId}/analytics${query}`);
            this._data = data;
            this.render();
        } catch (err) {
            console.error('Failed to load person analytics:', err);
            if (!this._data) {
                App.openModal(`
                    <div class="modal-header">
                        <h2 class="modal-title">${I18n.t('test_failed')}</h2>
                        <button class="modal-close" onclick="App.closeModal()">✕</button>
                    </div>
                    <div class="modal-body" style="padding: 2rem; text-align: center;">
                        <div style="font-size: 2.5rem; margin-bottom: 1rem;">⚠️</div>
                        <div style="color: var(--accent-rose); font-weight: 600; margin-bottom: 0.5rem;">${err.message}</div>
                    </div>
                `);
            } else {
                App.showToast(err.message || (I18n.isRTL() ? 'خطا در دریافت اطلاعات بازه' : 'Failed to load time window'), 'error');
            }
        } finally {
            if (bodyEl) {
                bodyEl.style.opacity = '1';
                bodyEl.style.pointerEvents = 'auto';
            }
        }
    },

    /**
     * Set active time window preset.
     * @param {'7d'|'14d'|'30d'|'60d'|'90d'|'custom'} period
     */
    async setTimeWindow(period) {
        if (period === 'custom') {
            const form = document.getElementById('person-ana-custom-form');
            if (form) {
                const isHidden = (form.style.display === 'none' || !form.style.display);
                form.style.display = isHidden ? 'flex' : 'none';
                if (form.style.display !== 'none') {
                    this._updateDateLabels();
                }
            }
            return;
        }

        if (this._activePeriod === period) return;

        this._activePeriod = period;
        if (period === '7d') {
            this._days = 7;
        } else if (period === '14d') {
            this._days = 14;
        } else if (period === '30d') {
            this._days = 30;
        } else if (period === '60d') {
            this._days = 60;
        } else if (period === '90d') {
            this._days = 90;
        }

        this.closeAllCalendarPopovers();
        await this.loadData();
    },

    /**
     * Apply custom date range picker.
     */
    async applyCustomRange() {
        const sIso = this.getGregorianDate('start') || this._customStartDate;
        const eIso = this.getGregorianDate('end') || this._customEndDate;

        if (!sIso || !eIso) {
            App.showToast(I18n.isRTL() ? 'لطفاً هر دو تاریخ شروع و پایان شمسی را انتخاب کنید.' : 'Please select both start and end dates.', 'warning');
            return;
        }

        if (sIso > eIso) {
            App.showToast(I18n.isRTL() ? 'تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.' : 'Start date cannot be after end date.', 'warning');
            return;
        }

        this._customStartDate = sIso;
        this._customEndDate = eIso;
        this._activePeriod = 'custom';
        this.closeAllCalendarPopovers();
        await this.loadData();
    },

    /**
     * Dynamic label for attendance log tab.
     */
    getAttendanceTabLabel() {
        const isFa = I18n.isRTL();
        if (this._activePeriod === 'custom') {
            return isFa ? '📅 سوابق حضور (بازه دلخواه)' : '📅 Attendance Log (Custom)';
        }
        const d = this._days || 30;
        const dStr = isFa ? I18n.toPersianDigits(d) : d;
        return isFa ? `📅 سوابق حضور (${dStr} روز)` : `📅 ${d}-Day Attendance Log`;
    },

    /**
     * Switch current tab.
     * @param {string} tab
     */
    switchTab(tab) {
        PersonAnalyticsModal._activeTab = tab;
        PersonAnalyticsModal.render();
    },

    /**
     * Filter shift display.
     * @param {string} filter
     */
    setShiftFilter(filter) {
        PersonAnalyticsModal._shiftFilter = filter;
        PersonAnalyticsModal.render();
    },

    /**
     * Render the modal contents.
     */
    render() {
        const d = PersonAnalyticsModal._data;
        if (!d) return;

        const p = d.summary;
        const comp = d.shift_compliance;
        const shifts = d.shifts || [];
        const isFa = I18n.isRTL();

        // Status badge
        let statusBadgeHtml = '';
        const absenceMin = comp.current_absence_minutes || p.current_absence_minutes || 0;
        const absMinsDisp = isFa ? I18n.toPersianDigits(absenceMin) : absenceMin;

        if (p.current_status === 'present') {
            statusBadgeHtml = `<span class="badge-status-pill on-station">🟢 ${I18n.t('badge_on_station')}</span>`;
        } else if (p.current_status === 'camera_offline') {
            statusBadgeHtml = `<span class="badge-status-pill camera-offline" style="background: rgba(234, 179, 8, 0.2); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4);">🟡 ${I18n.t('status_camera_offline')}</span>`;
        } else if (p.current_status === 'absent') {
            const absentSuffix = absenceMin > 0 ? ` (${I18n.t('minutes_absent_now', { mins: absMinsDisp })})` : '';
            statusBadgeHtml = `<span class="badge-status-pill absent">🔴 ${I18n.t('badge_absent')}${absentSuffix}</span>`;
        } else if (p.current_status === 'off_duty') {
            statusBadgeHtml = `<span class="badge-status-pill off-duty">⚪ ${I18n.t('badge_off_duty')}</span>`;
        } else {
            statusBadgeHtml = `<span class="badge-status-pill off-duty">⏳ ${I18n.t('card_never_seen')}</span>`;
        }

        const enrolledDate = I18n.formatDate(d.enrolled_at);
        const avatarUrl = d.reference_photos && d.reference_photos.length > 0 ? d.reference_photos[0] : null;
        const initials = PersonAnalyticsModal.getInitials(d.name);

        const primaryShift = comp.primary_shift_time || (shifts.length > 0 ? `${shifts[0].start_time} - ${shifts[0].end_time}` : null);
        const primaryShiftDisp = primaryShift ? (isFa ? I18n.toPersianDigits(primaryShift) : primaryShift) : null;
        const todayAbsDisp = isFa ? I18n.toPersianDigits(comp.today_absence_minutes) : comp.today_absence_minutes;

        const content = `
            <div class="modal-header analytics-modal-header" style="flex-wrap: wrap; gap: 1rem;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    ${avatarUrl
                        ? `<img class="analytics-avatar" src="${avatarUrl}" alt="${PersonAnalyticsModal.escapeAttr(d.name)}" onerror="this.outerHTML='<div class=\\'analytics-avatar-placeholder\\'>${initials}</div>'" />`
                        : `<div class="analytics-avatar-placeholder">${initials}</div>`
                    }
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                            <h2 class="modal-title" style="margin: 0; font-size: 1.4rem;">${PersonAnalyticsModal.escapeHtml(d.name)}</h2>
                            ${statusBadgeHtml}
                            ${d.section ? `<span class="badge badge-primary text-xs" style="font-size: 0.72rem; padding: 2px 8px; border-radius: 999px;">🏢 ${PersonAnalyticsModal.escapeHtml(d.section)}</span>` : ''}
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.2rem; display: flex; gap: 0.8rem; align-items: center; flex-wrap: wrap;">
                            <span>🏷️ ${PersonAnalyticsModal.escapeHtml(d.role || I18n.t('no_role_assigned'))}</span>
                            <span>📅 ${I18n.t('person_enrolled_date')}: ${enrolledDate}</span>
                            ${primaryShiftDisp
                                ? `<span style="color: var(--accent-blue); font-weight: 600; background: rgba(59, 130, 246, 0.1); padding: 2px 8px; border-radius: var(--radius-full); border: 1px solid rgba(59, 130, 246, 0.2);">⏰ ${I18n.t('shift_time')}: ${primaryShiftDisp}</span>`
                                : `<span style="color: var(--text-tertiary);">⏰ ${I18n.t('no_assigned_shift')}</span>`
                            }
                            ${comp.today_absence_minutes > 0 ? `<span style="color: var(--accent-rose); font-weight: 600; background: rgba(244, 63, 94, 0.1); padding: 2px 8px; border-radius: var(--radius-full); border: 1px solid rgba(244, 63, 94, 0.2);">⏱️ ${I18n.t('today_absence')}: ${todayAbsDisp} ${isFa ? 'دقیقه' : 'mins'}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-${isFa ? 'right' : 'left'}: auto;">
                    <button class="btn btn-primary btn-sm" onclick="PersonShiftModal.show(${d.person_id || d.id})" title="${PersonAnalyticsModal.escapeAttr(I18n.t('manage_shift') || 'مدیریت شیفت')}">
                        ⏰ <span>${I18n.t('manage_shift') || 'مدیریت شیفت'}</span>
                    </button>
                    <button class="btn btn-secondary btn-sm" id="btn-person-analytics-export" onclick="PersonAnalyticsModal.exportExcel()" title="${PersonAnalyticsModal.escapeAttr(I18n.t('print_summary'))}">
                        <span id="btn-export-text">${I18n.t('print_summary')}</span>
                    </button>
                    <button class="modal-close" onclick="App.closeModal()">✕</button>
                </div>
            </div>

            <!-- Sub Navigation Tabs -->
            <div class="analytics-tab-bar">
                <button class="analytics-tab-btn ${PersonAnalyticsModal._activeTab === 'overview' ? 'active' : ''}" onclick="PersonAnalyticsModal.switchTab('overview')">
                    ${I18n.t('tab_overview')}
                </button>
                <button class="analytics-tab-btn ${PersonAnalyticsModal._activeTab === 'shifts' ? 'active' : ''}" onclick="PersonAnalyticsModal.switchTab('shifts')">
                    ${I18n.t('tab_shifts')}
                </button>
                <button class="analytics-tab-btn ${PersonAnalyticsModal._activeTab === 'timeline' ? 'active' : ''}" onclick="PersonAnalyticsModal.switchTab('timeline')">
                    ${I18n.t('tab_timeline')}
                </button>
                <button class="analytics-tab-btn ${PersonAnalyticsModal._activeTab === 'attendance' ? 'active' : ''}" onclick="PersonAnalyticsModal.switchTab('attendance')">
                    ${PersonAnalyticsModal.getAttendanceTabLabel()}
                </button>
                <button class="analytics-tab-btn ${PersonAnalyticsModal._activeTab === 'cameras' ? 'active' : ''}" onclick="PersonAnalyticsModal.switchTab('cameras')">
                    ${I18n.t('tab_cameras')}
                </button>
                <button class="analytics-tab-btn ${PersonAnalyticsModal._activeTab === 'recent' ? 'active' : ''}" onclick="PersonAnalyticsModal.switchTab('recent')">
                    ${I18n.t('tab_recent')} (${d.recent_events.length})
                </button>
            </div>

            <div class="modal-body analytics-modal-body" id="analytics-modal-body">
                ${PersonAnalyticsModal.renderTabContent()}
            </div>
        `;

        App.openModal(content, 'modal-analytics');
    },

    /**
     * Render the active tab body.
     */
    renderTabContent() {
        switch (PersonAnalyticsModal._activeTab) {
            case 'overview':
                return PersonAnalyticsModal.renderOverviewTab();
            case 'shifts':
                return PersonAnalyticsModal.renderShiftsTab();
            case 'timeline':
                return PersonAnalyticsModal.renderTimelineTab();
            case 'attendance':
                return PersonAnalyticsModal.renderAttendanceTab();
            case 'cameras':
                return PersonAnalyticsModal.renderCamerasTab();
            case 'recent':
                return PersonAnalyticsModal.renderRecentTab();
            default:
                return PersonAnalyticsModal.renderOverviewTab();
        }
    },

    /**
     * Tab 1: Overview & KPI cards.
     */
    renderOverviewTab() {
        const d = PersonAnalyticsModal._data;
        const p = d.summary;
        const comp = d.shift_compliance;
        const shifts = d.shifts || [];
        const isFa = I18n.isRTL();

        const totalDetectionsStr = isFa ? I18n.toPersianDigits(p.total_detections) : p.total_detections;
        const todayDetectionsStr = isFa ? I18n.toPersianDigits(p.today_detections) : p.today_detections;
        const avgConfStr = isFa ? I18n.toPersianDigits(p.avg_confidence) : p.avg_confidence;
        const complianceStr = isFa ? I18n.toPersianDigits(comp.compliance_rate) : comp.compliance_rate;
        const alertsCountStr = isFa ? I18n.toPersianDigits(d.alerts.total_alerts) : d.alerts.total_alerts;

        const absenceTodayStr = (comp && comp.today_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.today_absence_hours_str) : comp.today_absence_hours_str) 
            : (isFa ? '۰ دقیقه' : '0m');
        const absenceWeekStr = (comp && comp.week_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.week_absence_hours_str) : comp.week_absence_hours_str) 
            : (isFa ? '۰ ساعت' : '0h');
        const absenceMonthStr = (comp && comp.month_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.month_absence_hours_str) : comp.month_absence_hours_str) 
            : (comp && comp.total_absence_hours_str ? (isFa ? I18n.toPersianDigits(comp.total_absence_hours_str) : comp.total_absence_hours_str) : (isFa ? '۰ ساعت' : '0h'));
        const absenceTotalStr = absenceMonthStr;

        let absenceSubStr = '';
        if (comp && comp.today_absence_minutes > 0) {
            absenceSubStr = `${I18n.t('absence_period_today')}: ${absenceTodayStr} | ${I18n.t('absence_period_week')}: ${absenceWeekStr}`;
        } else if (comp && comp.current_absence_minutes > 0) {
            absenceSubStr = I18n.t('minutes_absent_now', { mins: isFa ? I18n.toPersianDigits(comp.current_absence_minutes) : comp.current_absence_minutes });
        } else {
            absenceSubStr = `${I18n.t('absence_period_week')}: ${absenceWeekStr}`;
        }

        const firstSeenStr = p.first_seen ? I18n.formatFullTimestamp(p.first_seen) : (isFa ? 'نامشخص' : 'None');
        const lastSeenStr = p.last_seen ? I18n.formatFullTimestamp(p.last_seen) : (isFa ? 'بدون تردد' : 'No sightings');

        return `
            <div class="analytics-kpi-grid">
                <div class="kpi-card blue">
                    <div class="kpi-icon">🎯</div>
                    <div class="kpi-content">
                        <div class="kpi-value">${totalDetectionsStr}</div>
                        <div class="kpi-label">${I18n.t('kpi_total_detections')}</div>
                        <div class="kpi-sub">${p.today_detections > 0 ? `+${todayDetectionsStr} ${I18n.t('stat_total_today')}` : ''}</div>
                    </div>
                </div>

                <div class="kpi-card ${comp.compliance_rate >= 85 ? 'emerald' : (comp.compliance_rate >= 70 ? 'amber' : 'rose')}">
                    <div class="kpi-icon">⏰</div>
                    <div class="kpi-content">
                        <div class="kpi-value">${complianceStr}%</div>
                        <div class="kpi-label">${I18n.t('kpi_shift_compliance')}</div>
                        <div class="kpi-sub">${comp.present_shift_days} / ${comp.scheduled_shift_days} ${isFa ? 'روز شیفت حاضر' : 'shift days present'}</div>
                    </div>
                </div>

                <div class="kpi-card rose">
                    <div class="kpi-icon">⏱️</div>
                    <div class="kpi-content">
                        <div class="kpi-value">${absenceTotalStr}</div>
                        <div class="kpi-label">${I18n.t('kpi_absence_time')} (${I18n.t('absence_period_month')})</div>
                        <div class="kpi-sub">${absenceSubStr}</div>
                    </div>
                </div>

                <div class="kpi-card violet">
                    <div class="kpi-icon">📊</div>
                    <div class="kpi-content">
                        <div class="kpi-value">${avgConfStr}%</div>
                        <div class="kpi-label">${I18n.t('kpi_avg_confidence')}</div>
                        <div class="kpi-sub">${isFa ? 'حداکثر' : 'Max'}: ${isFa ? I18n.toPersianDigits(p.max_confidence) : p.max_confidence}%</div>
                    </div>
                </div>

                <div class="kpi-card amber">
                    <div class="kpi-icon">🚨</div>
                    <div class="kpi-content">
                        <div class="kpi-value">${alertsCountStr}</div>
                        <div class="kpi-label">${I18n.t('kpi_alerts_count')}</div>
                        <div class="kpi-sub">${d.alerts.out_of_zone_count} ${I18n.t('alert_out_of_zone')}</div>
                    </div>
                </div>
            </div>

            <!-- Two-Column Summary Sections -->
            <div class="analytics-row" style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 1rem; margin-top: 1.25rem;">
                
                <!-- Shift Timetable & Status Panel -->
                <div class="analytics-card">
                    <div class="analytics-card-title">
                        <span>⏰</span>
                        <span>${I18n.t('shift_info_header')}</span>
                    </div>

                    ${shifts.length === 0 ? `
                        <div class="empty-state-text" style="padding: 1rem; text-align: center;">
                            ${I18n.t('no_assigned_shift')}
                        </div>
                    ` : `
                        <div class="shift-cards-container" style="display: flex; flex-direction: column; gap: 0.75rem;">
                            ${shifts.map(s => {
                                const daysStr = s.active_days.map(day => I18n.t(`short_${day.toLowerCase()}`)).join('، ');
                                const inShiftBadge = s.is_in_schedule_now 
                                    ? `<span class="badge-status-pill on-station" style="font-size: 0.7rem;">🟢 ${isFa ? 'هم‌اکنون در ساعات شیفت' : 'In Shift Now'}</span>`
                                    : `<span class="badge-status-pill off-duty" style="font-size: 0.7rem;">⚪ ${isFa ? 'خارج از شیفت' : 'Off-Duty Now'}</span>`;

                                return `
                                    <div class="shift-item-block" style="background: var(--bg-surface-hover); border-radius: var(--radius-sm); padding: 0.75rem 1rem; border: 1px solid var(--border-subtle);">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                                            <span style="font-weight: 700; color: var(--text-primary);">🎯 ${PersonAnalyticsModal.escapeHtml(s.zone_name)} (${PersonAnalyticsModal.escapeHtml(s.camera_name)})</span>
                                            ${inShiftBadge}
                                        </div>
                                        <div style="font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 1rem; flex-wrap: wrap;">
                                            <span>🕐 ${I18n.t('shift_hours')} <strong>${isFa ? I18n.toPersianDigits(s.start_time) : s.start_time} - ${isFa ? I18n.toPersianDigits(s.end_time) : s.end_time}</strong> (${s.shift_duration_hours} ${isFa ? 'ساعت' : 'hours'})</span>
                                            <span>📅 ${daysStr}</span>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}

                    <!-- Day / Week / Month Absence Breakdown Widget -->
                    <div style="margin-top: 1rem; padding: 0.85rem; background: rgba(244, 63, 94, 0.06); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: var(--radius-sm);">
                        <div style="font-size: 0.8rem; font-weight: 700; color: var(--accent-rose); margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.4rem;">
                            <span>⏱️</span>
                            <span>${I18n.t('absence_breakdown_title')}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; text-align: center;">
                            <div style="background: var(--bg-surface); padding: 0.6rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                <div style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary);">${absenceTodayStr}</div>
                                <div style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; margin-top: 0.15rem;">${I18n.t('absence_period_today')}</div>
                                <div style="font-size: 0.65rem; color: var(--text-tertiary); margin-top: 0.1rem;">${isFa ? I18n.toPersianDigits(comp ? (comp.today_absence_minutes || 0) : 0) : (comp ? (comp.today_absence_minutes || 0) : 0)} ${isFa ? 'دقیقه' : 'mins'}</div>
                                ${comp && comp.absence_count_today > 0 ? `
                                    <div style="font-size: 0.65rem; color: #fbbf24; font-weight: 700; margin-top: 0.15rem;">
                                        📍 ${I18n.t('absence_count_short', { count: isFa ? I18n.toPersianDigits(comp.absence_count_today) : comp.absence_count_today })}
                                    </div>
                                ` : ''}
                            </div>
                            <div style="background: var(--bg-surface); padding: 0.6rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                <div style="font-size: 1.15rem; font-weight: 800; color: var(--accent-amber);">${absenceWeekStr}</div>
                                <div style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; margin-top: 0.15rem;">${I18n.t('absence_period_week')}</div>
                                <div style="font-size: 0.65rem; color: var(--text-tertiary); margin-top: 0.1rem;">${isFa ? I18n.toPersianDigits(comp ? (comp.week_absence_minutes || 0) : 0) : (comp ? (comp.week_absence_minutes || 0) : 0)} ${isFa ? 'دقیقه' : 'mins'}</div>
                            </div>
                            <div style="background: var(--bg-surface); padding: 0.6rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                <div style="font-size: 1.15rem; font-weight: 800; color: var(--accent-rose);">${absenceMonthStr}</div>
                                <div style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; margin-top: 0.15rem;">${I18n.t('absence_period_month')}</div>
                                <div style="font-size: 0.65rem; color: var(--text-tertiary); margin-top: 0.1rem;">${isFa ? I18n.toPersianDigits(comp ? (comp.month_absence_minutes || comp.total_absence_minutes || 0) : 0) : (comp ? (comp.month_absence_minutes || comp.total_absence_minutes || 0) : 0)} ${isFa ? 'دقیقه' : 'mins'}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Punctuality Breakdown -->
                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-subtle);">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 0.6rem; text-align: center;">
                            <div class="punctuality-stat-tile" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); padding: 0.5rem;">
                                <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-emerald);">${isFa ? I18n.toPersianDigits(comp.on_time_arrivals) : comp.on_time_arrivals}</div>
                                <div style="font-size: 0.7rem; color: var(--text-secondary);">${I18n.t('shift_on_time_count')}</div>
                            </div>
                            <div class="punctuality-stat-tile" style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-sm); padding: 0.5rem;">
                                <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-amber);">${isFa ? I18n.toPersianDigits(comp.late_arrivals) : comp.late_arrivals}</div>
                                <div style="font-size: 0.7rem; color: var(--text-secondary);">${I18n.t('shift_late_count')}</div>
                            </div>
                            <div class="punctuality-stat-tile" style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: var(--radius-sm); padding: 0.5rem;">
                                <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-rose);">${isFa ? I18n.toPersianDigits(comp.early_departures) : comp.early_departures}</div>
                                <div style="font-size: 0.7rem; color: var(--text-secondary);">${I18n.t('shift_early_departure_count')}</div>
                            </div>
                            <div class="punctuality-stat-tile" style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: var(--radius-sm); padding: 0.5rem;">
                                <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-rose);">${absenceTotalStr}</div>
                                <div style="font-size: 0.7rem; color: var(--text-secondary);">${I18n.t('total_absence_duration')}</div>
                            </div>
                            <div class="punctuality-stat-tile" style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: var(--radius-sm); padding: 0.5rem;">
                                <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-blue);">${isFa ? I18n.toPersianDigits(comp.overtime_days) : comp.overtime_days}</div>
                                <div style="font-size: 0.7rem; color: var(--text-secondary);">${I18n.t('shift_overtime_days')}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Sightings & Location Card -->
                <div class="analytics-card">
                    <div class="analytics-card-title">
                        <span>📍</span>
                        <span>${I18n.isRTL() ? 'سوابق و موقعیت‌های اصلی' : 'Recent Sightings & Locations'}</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 0.8rem;">
                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600;">${I18n.t('kpi_last_seen')}</div>
                            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-top: 0.2rem;">${lastSeenStr}</div>
                            ${p.last_seen_camera ? `<div style="font-size: 0.8rem; color: var(--accent-blue); margin-top: 0.2rem;">📹 ${PersonAnalyticsModal.escapeHtml(p.last_seen_camera)} ${p.last_seen_zone ? `— 🎯 ${PersonAnalyticsModal.escapeHtml(p.last_seen_zone)}` : ''}</div>` : ''}
                        </div>

                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600;">${I18n.t('kpi_first_seen')}</div>
                            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-top: 0.2rem;">${firstSeenStr}</div>
                        </div>

                        ${p.top_camera ? `
                            <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600;">${I18n.isRTL() ? 'دوربین با بیشترین تردد' : 'Top Camera'}</div>
                                <div style="font-size: 0.95rem; font-weight: 700; color: var(--accent-blue); margin-top: 0.2rem;">📹 ${PersonAnalyticsModal.escapeHtml(p.top_camera.name)}</div>
                                <div style="font-size: 0.75rem; color: var(--text-secondary);">${I18n.isRTL() ? I18n.toPersianDigits(p.top_camera.count) : p.top_camera.count} ${I18n.t('th_detections')} (${I18n.isRTL() ? I18n.toPersianDigits(p.top_camera.percentage) : p.top_camera.percentage}%)</div>
                            </div>
                        ` : ''}
                    </div>
                </div>

            </div>
        `;
    },

    /**
     * Tab 2: Shifts & Punctuality.
     */
    renderShiftsTab() {
        const d = PersonAnalyticsModal._data;
        const comp = d.shift_compliance;
        const shifts = d.shifts || [];
        const isFa = I18n.isRTL();

        const absenceTodayStr = (comp && comp.today_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.today_absence_hours_str) : comp.today_absence_hours_str) 
            : (isFa ? '۰ دقیقه' : '0m');
        const absenceWeekStr = (comp && comp.week_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.week_absence_hours_str) : comp.week_absence_hours_str) 
            : (isFa ? '۰ ساعت' : '0h');
        const absenceMonthStr = (comp && comp.month_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.month_absence_hours_str) : comp.month_absence_hours_str) 
            : (comp && comp.total_absence_hours_str ? (isFa ? I18n.toPersianDigits(comp.total_absence_hours_str) : comp.total_absence_hours_str) : (isFa ? '۰ ساعت' : '0h'));

        return `
            <div class="analytics-card" style="margin-bottom: 1.25rem;">
                <div class="analytics-card-title">
                    <span>⏰</span>
                    <span>${I18n.t('shift_info_header')}</span>
                </div>

                ${shifts.length === 0 ? `
                    <div style="padding: 2rem; text-align: center; color: var(--text-secondary);">
                        ${I18n.t('no_assigned_shift')}
                    </div>
                ` : `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
                        ${shifts.map(s => {
                            const daysStr = s.active_days.map(day => I18n.t(`days_${day.toLowerCase()}`)).join(', ');
                            return `
                                <div style="background: var(--bg-surface-hover); border-radius: var(--radius-md); padding: 1rem; border: 1px solid var(--border-subtle);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                        <div style="font-weight: 700; font-size: 1.1rem; color: var(--text-primary);">🎯 ${PersonAnalyticsModal.escapeHtml(s.zone_name)}</div>
                                        ${s.is_in_schedule_now 
                                            ? `<span class="badge-status-pill on-station">🟢 ${isFa ? 'حین شیفت' : 'In Shift'}</span>` 
                                            : `<span class="badge-status-pill off-duty">⚪ ${isFa ? 'خارج از شیفت' : 'Off Duty'}</span>`}
                                    </div>
                                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.3rem;">📹 ${PersonAnalyticsModal.escapeHtml(s.camera_name)}</div>
                                    <div style="font-size: 0.85rem; color: var(--accent-blue); font-weight: 600; margin-bottom: 0.3rem;">
                                        ⏰ ${isFa ? I18n.toPersianDigits(s.start_time) : s.start_time} — ${isFa ? I18n.toPersianDigits(s.end_time) : s.end_time} (${s.shift_duration_hours}h)
                                    </div>
                                    <div style="font-size: 0.75rem; color: var(--text-tertiary);">📅 ${daysStr}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>

            <!-- Compliance Score Card -->
            <div class="analytics-card">
                <div class="analytics-card-title">
                    <span>📊</span>
                    <span>${isFa ? 'شاخص‌های انضباط و حضور در شیفت' : 'Shift Attendance & Punctuality Audit'}</span>
                </div>

                <!-- Day / Week / Month Absence Breakdown in Shifts Tab -->
                <div style="margin-top: 1rem; margin-bottom: 1.25rem;">
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--accent-rose); margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span>⏱️</span>
                        <span>${I18n.t('absence_breakdown_title')}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem;">
                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); text-align: center;">
                            <div style="font-size: 1.5rem; font-weight: 900; color: var(--text-primary);">${absenceTodayStr}</div>
                            <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.2rem;">${I18n.t('absence_day')}</div>
                            <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.15rem;">${isFa ? I18n.toPersianDigits(comp ? (comp.today_absence_minutes || 0) : 0) : (comp ? (comp.today_absence_minutes || 0) : 0)} ${isFa ? 'دقیقه' : 'mins'}</div>
                        </div>
                        <div class="info-block" style="background: rgba(245, 158, 11, 0.08); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid rgba(245, 158, 11, 0.25); text-align: center;">
                            <div style="font-size: 1.5rem; font-weight: 900; color: var(--accent-amber);">${absenceWeekStr}</div>
                            <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.2rem;">${I18n.t('absence_week')}</div>
                            <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.15rem;">${isFa ? I18n.toPersianDigits(comp ? (comp.week_absence_minutes || 0) : 0) : (comp ? (comp.week_absence_minutes || 0) : 0)} ${isFa ? 'دقیقه' : 'mins'}</div>
                        </div>
                        <div class="info-block" style="background: rgba(244, 63, 94, 0.08); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid rgba(244, 63, 94, 0.25); text-align: center;">
                            <div style="font-size: 1.5rem; font-weight: 900; color: var(--accent-rose);">${absenceMonthStr}</div>
                            <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.2rem;">${I18n.t('absence_month')}</div>
                            <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.15rem;">${isFa ? I18n.toPersianDigits(comp ? (comp.month_absence_minutes || comp.total_absence_minutes || 0) : 0) : (comp ? (comp.month_absence_minutes || comp.total_absence_minutes || 0) : 0)} ${isFa ? 'دقیقه' : 'mins'}</div>
                        </div>
                    </div>
                </div>

                <!-- Today's Absence Time Windows & Count -->
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: var(--radius-sm);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                        <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                            <span>🕒</span>
                            <span>${I18n.t('absence_windows_title')} (${isFa ? 'امروز' : 'Today'})</span>
                        </div>
                        <span class="duty-absence-count-badge">
                            📍 ${I18n.t('absence_count_badge', { count: isFa ? I18n.toPersianDigits(comp ? (comp.absence_count_today || 0) : 0) : (comp ? (comp.absence_count_today || 0) : 0) })}
                        </span>
                    </div>

                    ${(comp && comp.today_absence_intervals && comp.today_absence_intervals.length > 0) ? `
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.5rem;">
                            ${comp.today_absence_intervals.map(w => {
                                const startT = isFa ? I18n.toPersianDigits(w.start_time) : w.start_time;
                                const endT = w.interval_type === 'current'
                                    ? I18n.t('window_now')
                                    : (isFa ? I18n.toPersianDigits(w.end_time) : w.end_time);
                                const durStr = isFa ? I18n.toPersianDigits(w.duration_str) : w.duration_str;
                                const typeKey = `interval_type_${w.interval_type}`;
                                const typeLabel = I18n.t(typeKey) || w.interval_type;
                                const isCurrent = w.interval_type === 'current';
                                return `
                                    <div class="duty-window-item ${isCurrent ? 'is-current' : ''}" style="padding: 0.5rem 0.75rem;">
                                        <div class="duty-window-type-tag ${w.interval_type}">
                                            ${isCurrent ? '🔴' : '⏳'} ${typeLabel}
                                        </div>
                                        <div class="duty-window-time" dir="ltr">
                                            <span class="win-time">${startT}</span>
                                            <span class="win-arrow">➜</span>
                                            <span class="win-time ${isCurrent ? 'win-current' : ''}">${endT}</span>
                                        </div>
                                        <div class="duty-window-dur-pill">
                                            ${durStr}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : `
                        <div style="text-align: center; color: var(--text-tertiary); font-size: 0.8rem; padding: 0.75rem;">
                            ${I18n.t('no_absence_intervals')}
                        </div>
                    `}
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-top: 1rem;">
                    <div class="info-block" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); text-align: center;">
                        <div style="font-size: 1.8rem; font-weight: 900; color: ${comp.compliance_rate >= 85 ? 'var(--accent-emerald)' : (comp.compliance_rate >= 70 ? 'var(--accent-amber)' : 'var(--accent-rose)')};">${isFa ? I18n.toPersianDigits(comp.compliance_rate) : comp.compliance_rate}%</div>
                        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.3rem;">${I18n.t('kpi_shift_compliance')}</div>
                        <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem;">${comp.present_shift_days} / ${comp.scheduled_shift_days} ${isFa ? 'روز حضور' : 'days present'}</div>
                    </div>

                    <div class="info-block" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); text-align: center;">
                        <div style="font-size: 1.8rem; font-weight: 900; color: var(--accent-amber);">${isFa ? I18n.toPersianDigits(comp.late_arrivals) : comp.late_arrivals}</div>
                        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.3rem;">${I18n.t('shift_late_count')}</div>
                        <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem;">${isFa ? I18n.toPersianDigits(comp.total_delay_minutes) : comp.total_delay_minutes} ${isFa ? 'دقیقه مجموع تأخیر' : 'mins total delay'}</div>
                    </div>

                    <div class="info-block" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); text-align: center;">
                        <div style="font-size: 1.8rem; font-weight: 900; color: var(--accent-rose);">${isFa ? I18n.toPersianDigits(comp.early_departures) : comp.early_departures}</div>
                        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.3rem;">${I18n.t('shift_early_departure_count')}</div>
                        <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem;">${isFa ? I18n.toPersianDigits(comp.total_early_minutes) : comp.total_early_minutes} ${isFa ? 'دقیقه تعجیل' : 'mins total early'}</div>
                    </div>

                    <div class="info-block" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); text-align: center;">
                        <div style="font-size: 1.8rem; font-weight: 900; color: var(--accent-blue);">${isFa ? I18n.toPersianDigits(comp.in_shift_detections) : comp.in_shift_detections}</div>
                        <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-top: 0.3rem;">${isFa ? 'ترددهای داخل شیفت' : 'In-Shift Sightings'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem;">${isFa ? I18n.toPersianDigits(comp.out_of_shift_detections) : comp.out_of_shift_detections} ${isFa ? 'تردد خارج از شیفت' : 'out-of-shift'}</div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Tab 3: 24-Hour Activity Patterns & Peak Hours.
     */
    renderTimelineTab() {
        const d = PersonAnalyticsModal._data;
        const hourly = d.hourly_distribution || [];

        // Find max count for scaling
        const maxCount = Math.max(...hourly.map(h => h.count), 1);

        // Find peak hour
        let peakHour = 0;
        let peakVal = 0;
        hourly.forEach(h => {
            if (h.count > peakVal) {
                peakVal = h.count;
                peakHour = h.hour;
            }
        });

        const peakHourStr = `${String(peakHour).padStart(2, '0')}:00 - ${String(peakHour + 1).padStart(2, '0')}:00`;
        const peakValStr = I18n.isRTL() ? I18n.toPersianDigits(peakVal) : peakVal;

        return `
            <div class="analytics-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <div class="analytics-card-title" style="margin-bottom: 0.2rem;">
                            <span>📈</span>
                            <span>${I18n.t('hourly_chart_title')}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-tertiary);">${I18n.t('hourly_chart_hint')}</div>
                    </div>
                    ${peakVal > 0 ? `
                        <div style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: var(--radius-sm); padding: 0.35rem 0.75rem; font-size: 0.8rem; color: var(--accent-blue);">
                            <strong>🔥 ${I18n.t('hourly_peak')}</strong> ${I18n.isRTL() ? I18n.toPersianDigits(peakHourStr) : peakHourStr} (${peakValStr} ${I18n.t('th_detections')})
                        </div>
                    ` : ''}
                </div>

                <!-- 24-Hour Bar Chart -->
                <div class="hourly-histogram-container" style="display: flex; align-items: flex-end; gap: 4px; height: 180px; padding: 1.5rem 0.5rem 2rem; border-bottom: 1px solid var(--border-subtle); margin-top: 1rem;">
                    ${hourly.map(h => {
                        const total = h.count;
                        const inShift = h.in_shift_count || 0;
                        const outShift = Math.max(0, total - inShift);

                        const totalHeightPct = Math.round((total / maxCount) * 100);
                        const isPeak = h.hour === peakHour && peakVal > 0;
                        const hourLabel = String(h.hour).padStart(2, '0');
                        const hourLabelDisp = I18n.isRTL() ? I18n.toPersianDigits(hourLabel) : hourLabel;
                        const totalDisp = I18n.isRTL() ? I18n.toPersianDigits(total) : total;

                        return `
                            <div class="histogram-col ${isPeak ? 'peak' : ''}" style="flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative;" title="${hourLabel}:00 — ${totalDisp} detections (${inShift} in-shift, ${outShift} out-of-shift)">
                                <div class="histogram-tooltip">${totalDisp}</div>
                                <div class="histogram-bar-fill" style="width: 100%; height: ${Math.max(totalHeightPct, total > 0 ? 4 : 0)}%; background: ${isPeak ? 'var(--gradient-primary)' : inShift > 0 ? 'var(--accent-blue)' : 'var(--text-tertiary)'}; border-radius: 3px 3px 0 0; transition: height 0.3s ease;"></div>
                                <span class="histogram-hour-label" style="position: absolute; bottom: -22px; font-size: 0.65rem; color: var(--text-tertiary);">${h.hour % 3 === 0 ? hourLabelDisp : ''}</span>
                            </div>
                        `;
                    }).join('')}
                </div>

                <div style="display: flex; justify-content: center; gap: 1.5rem; margin-top: 1.75rem; font-size: 0.75rem; color: var(--text-secondary);">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span style="width: 12px; height: 12px; background: var(--accent-blue); border-radius: 2px;"></span>
                        <span>${I18n.t('shift_filter_in_shift')}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span style="width: 12px; height: 12px; background: var(--text-tertiary); border-radius: 2px;"></span>
                        <span>${I18n.t('shift_filter_out_shift')}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span style="width: 12px; height: 12px; background: var(--gradient-primary); border-radius: 2px;"></span>
                        <span>${I18n.t('hourly_peak')}</span>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Tab 4: 30-Day Attendance Log & Punctuality Table.
     */
    renderAttendanceTab() {
        const d = PersonAnalyticsModal._data;
        const comp = d.shift_compliance;
        const daily = d.daily_activity_last_14_days || [];
        const isFa = I18n.isRTL();

        const absenceTodayStr = (comp && comp.today_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.today_absence_hours_str) : comp.today_absence_hours_str) 
            : (isFa ? '۰ دقیقه' : '0m');
        const absenceWeekStr = (comp && comp.week_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.week_absence_hours_str) : comp.week_absence_hours_str) 
            : (isFa ? '۰ ساعت' : '0h');
        const absenceMonthStr = (comp && comp.month_absence_hours_str) 
            ? (isFa ? I18n.toPersianDigits(comp.month_absence_hours_str) : comp.month_absence_hours_str) 
            : (comp && comp.total_absence_hours_str ? (isFa ? I18n.toPersianDigits(comp.total_absence_hours_str) : comp.total_absence_hours_str) : (isFa ? '۰ ساعت' : '0h'));

        return `
            <div class="analytics-card">
                <div class="analytics-card-title">
                    <span>📅</span>
                    <span>${PersonAnalyticsModal.getAttendanceTabLabel()}</span>
                </div>

                <!-- Time Window Selector & Actions Toolbar -->
                <div class="attendance-timeframe-toolbar" style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.65rem 0.9rem; margin-top: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                        <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); margin-inline-end: 0.35rem; display: inline-flex; align-items: center; gap: 4px;">
                            <span>🕒</span>
                            <span>${I18n.t('time_window_table') || (isFa ? 'بازه زمانی جدول:' : 'Table Time Window:')}</span>
                        </span>
                        <button type="button" class="btn btn-sm ${PersonAnalyticsModal._activePeriod === '7d' ? 'btn-primary' : 'btn-ghost'}" onclick="PersonAnalyticsModal.setTimeWindow('7d')" style="padding: 3px 10px; font-size: 0.78rem; border-radius: var(--radius-full); font-weight: ${PersonAnalyticsModal._activePeriod === '7d' ? '700' : '500'};">
                            ${I18n.t('preset_days_7') || (isFa ? '۷ روز اخیر' : '7 Days')}
                        </button>
                        <button type="button" class="btn btn-sm ${PersonAnalyticsModal._activePeriod === '14d' ? 'btn-primary' : 'btn-ghost'}" onclick="PersonAnalyticsModal.setTimeWindow('14d')" style="padding: 3px 10px; font-size: 0.78rem; border-radius: var(--radius-full); font-weight: ${PersonAnalyticsModal._activePeriod === '14d' ? '700' : '500'};">
                            ${I18n.t('preset_days_14') || (isFa ? '۱۴ روز اخیر' : '14 Days')}
                        </button>
                        <button type="button" class="btn btn-sm ${PersonAnalyticsModal._activePeriod === '30d' ? 'btn-primary' : 'btn-ghost'}" onclick="PersonAnalyticsModal.setTimeWindow('30d')" style="padding: 3px 10px; font-size: 0.78rem; border-radius: var(--radius-full); font-weight: ${PersonAnalyticsModal._activePeriod === '30d' ? '700' : '500'};">
                            ${I18n.t('preset_days_30') || (isFa ? '۳۰ روز اخیر' : '30 Days')}
                        </button>
                        <button type="button" class="btn btn-sm ${PersonAnalyticsModal._activePeriod === '60d' ? 'btn-primary' : 'btn-ghost'}" onclick="PersonAnalyticsModal.setTimeWindow('60d')" style="padding: 3px 10px; font-size: 0.78rem; border-radius: var(--radius-full); font-weight: ${PersonAnalyticsModal._activePeriod === '60d' ? '700' : '500'};">
                            ${I18n.t('preset_days_60') || (isFa ? '۶۰ روز اخیر' : '60 Days')}
                        </button>
                        <button type="button" class="btn btn-sm ${PersonAnalyticsModal._activePeriod === '90d' ? 'btn-primary' : 'btn-ghost'}" onclick="PersonAnalyticsModal.setTimeWindow('90d')" style="padding: 3px 10px; font-size: 0.78rem; border-radius: var(--radius-full); font-weight: ${PersonAnalyticsModal._activePeriod === '90d' ? '700' : '500'};">
                            ${I18n.t('preset_days_90') || (isFa ? '۹۰ روز اخیر' : '90 Days')}
                        </button>
                        <button type="button" class="btn btn-sm ${PersonAnalyticsModal._activePeriod === 'custom' ? 'btn-primary' : 'btn-ghost'}" onclick="PersonAnalyticsModal.setTimeWindow('custom')" style="padding: 3px 10px; font-size: 0.78rem; border-radius: var(--radius-full); font-weight: ${PersonAnalyticsModal._activePeriod === 'custom' ? '700' : '500'};">
                            📅 ${I18n.t('preset_days_custom') || (isFa ? 'بازه دلخواه' : 'Custom')}
                        </button>
                    </div>

                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-inline-start: auto;">
                        <button type="button" class="btn btn-sm" onclick="PersonAnalyticsModal.exportExcel()" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #fff; font-weight: 700; padding: 4px 12px; font-size: 0.78rem; border: none; border-radius: var(--radius-sm); box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25); display: inline-flex; align-items: center; gap: 5px;" title="${isFa ? 'دریافت اکسل سوابق همین بازه' : 'Export current window to Excel'}">
                            <span>📊</span>
                            <span>${I18n.t('export_window_excel') || (isFa ? 'خروجی اکسل این بازه' : 'Export Window to Excel')}</span>
                        </button>
                    </div>
                </div>

                <!-- Custom Shamsi Date Range Expandable Panel -->
                <div id="person-ana-custom-form" style="display: ${PersonAnalyticsModal._activePeriod === 'custom' ? 'flex' : 'none'}; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin-top: 0.5rem; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; flex: 1;">
                        <!-- Shamsi Start Date Picker -->
                        <div style="position: relative; min-width: 200px; flex: 1;">
                            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 3px;">
                                📅 ${isFa ? 'از تاریخ (شمسی):' : 'From Date (Shamsi):'}
                            </label>
                            <button type="button" class="btn btn-secondary w-100 shamsi-date-btn" onclick="PersonAnalyticsModal.toggleCalendar('start', event)" style="height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.65rem; border: 1px solid var(--border-medium); background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 0.8rem;">
                                <div style="display: flex; align-items: center; gap: 0.4rem;">
                                    <span>📅</span>
                                    <span id="p-ana-start-shamsi-label" style="font-weight: 700; color: var(--text-primary);">${PersonAnalyticsModal.getShamsiDisplay('start')}</span>
                                </div>
                                <span style="font-size: 0.65rem; color: var(--text-tertiary);">▾</span>
                            </button>
                            <div id="p-ana-calendar-popover-start" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-start: 0; z-index: 1200; width: 285px;"></div>
                        </div>

                        <!-- Shamsi End Date Picker -->
                        <div style="position: relative; min-width: 200px; flex: 1;">
                            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 3px;">
                                📅 ${isFa ? 'تا تاریخ (شمسی):' : 'To Date (Shamsi):'}
                            </label>
                            <button type="button" class="btn btn-secondary w-100 shamsi-date-btn" onclick="PersonAnalyticsModal.toggleCalendar('end', event)" style="height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0.65rem; border: 1px solid var(--border-medium); background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 0.8rem;">
                                <div style="display: flex; align-items: center; gap: 0.4rem;">
                                    <span>📅</span>
                                    <span id="p-ana-end-shamsi-label" style="font-weight: 700; color: var(--text-primary);">${PersonAnalyticsModal.getShamsiDisplay('end')}</span>
                                </div>
                                <span style="font-size: 0.65rem; color: var(--text-tertiary);">▾</span>
                            </button>
                            <div id="p-ana-calendar-popover-end" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-start: 0; z-index: 1200; width: 285px;"></div>
                        </div>

                        <!-- Apply Button -->
                        <div style="display: flex; align-items: flex-end; padding-top: 16px;">
                            <button type="button" class="btn btn-primary btn-sm" onclick="PersonAnalyticsModal.applyCustomRange()" style="padding: 6px 14px; font-size: 0.8rem; font-weight: 700;">
                                ✓ ${isFa ? 'اعمال بازه' : 'Apply Range'}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Day / Week / Month Absence Summary Ribbon -->
                <div class="attendance-summary-banner" style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; padding: 0.75rem 1rem; background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); align-items: center; justify-content: space-between;">
                    <div style="display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.85rem;">
                        <span>⏱️ <strong>${I18n.t('absence_period_today')}:</strong> <span style="color: var(--accent-rose); font-weight: 700;">${absenceTodayStr}</span></span>
                        <span>📅 <strong>${I18n.t('absence_period_week')}:</strong> <span style="color: var(--accent-amber); font-weight: 700;">${absenceWeekStr}</span></span>
                        <span>📊 <strong>${I18n.t('absence_period_month')}:</strong> <span style="color: var(--accent-rose); font-weight: 700;">${absenceMonthStr}</span></span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-tertiary);">
                        ${isFa ? I18n.toPersianDigits(daily.length) : daily.length} ${isFa ? 'روز ثبت شده' : 'days recorded'}
                    </div>
                </div>

                <div class="table-responsive" style="overflow-x: auto; margin-top: 1rem;">
                    <table class="analytics-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: ${I18n.isRTL() ? 'right' : 'left'};">
                        <thead>
                            <tr style="border-bottom: 2px solid var(--border-medium); color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase;">
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_date')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_shift_hours')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_arrival')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_departure')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_presence_span')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_absence')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_status')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_detections')}</th>
                                <th style="padding: 0.75rem 0.5rem;">${I18n.t('th_camera')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${daily.map(day => {
                                const formattedDate = I18n.formatDate(day.date);
                                const dayNameStr = I18n.t(`short_${day.day_name.toLowerCase()}`);

                                // Status badge
                                let statusPill = '';
                                if (day.arrival_status === 'on_time') {
                                    statusPill = `<span class="badge-status-pill on-station">🟢 ${I18n.t('status_on_time')}</span>`;
                                } else if (day.arrival_status === 'late') {
                                    statusPill = `<span class="badge-status-pill" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);">🟡 ${I18n.t('status_late', { mins: day.delay_minutes })}</span>`;
                                } else if (day.arrival_status === 'absent') {
                                    statusPill = `<span class="badge-status-pill absent">🔴 ${I18n.t('status_absent_day')}</span>`;
                                } else if (day.arrival_status === 'off_schedule') {
                                    statusPill = `<span class="badge-status-pill" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4);">🔵 ${I18n.t('status_off_schedule')}</span>`;
                                } else {
                                    statusPill = `<span class="badge-status-pill off-duty">⚪ ${I18n.t('status_rest_day')}</span>`;
                                }

                                if (day.departure_status === 'left_early') {
                                    statusPill += ` <span class="badge-status-pill" style="background: rgba(244, 63, 94, 0.2); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.4); margin-top: 2px;">🟠 ${I18n.t('status_left_early', { mins: day.early_leave_minutes })}</span>`;
                                } else if (day.departure_status === 'overtime') {
                                    statusPill += ` <span class="badge-status-pill" style="background: rgba(139, 92, 246, 0.2); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.4); margin-top: 2px;">⭐ ${I18n.t('status_overtime', { mins: day.overtime_minutes })}</span>`;
                                }

                                const shiftText = day.is_scheduled_shift_day && day.shift_start_time
                                    ? `${day.shift_start_time} - ${day.shift_end_time}`
                                    : `<span style="color: var(--text-tertiary);">${I18n.t('status_rest_day')}</span>`;

                                const arrivalTime = day.first_seen_time || '—';
                                const departureTime = day.last_seen_time || '—';
                                const presenceSpan = day.estimated_duration_str || '—';
                                const detectionsCount = I18n.isRTL() ? I18n.toPersianDigits(day.detections_count) : day.detections_count;

                                // Absence from shift calculation badge & intervals button
                                let absencePill = '';
                                if (day.is_scheduled_shift_day) {
                                    if (day.absence_from_shift_minutes > 0) {
                                        const absStr = day.absence_from_shift_str || `${day.absence_from_shift_minutes}m`;
                                        const countVal = day.absence_count || (day.absence_intervals ? day.absence_intervals.length : 0);
                                        const countStr = isFa ? I18n.toPersianDigits(countVal) : countVal;
                                        const hasIntervals = Array.isArray(day.absence_intervals) && day.absence_intervals.length > 0;
                                        const winTooltip = hasIntervals
                                            ? day.absence_intervals.map(w => `${w.start_time}-${w.end_time} (${w.duration_str})`).join(' | ')
                                            : '';
                                        absencePill = `
                                            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                                                <span class="badge-status-pill" style="background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.35); font-weight: 700;" title="${winTooltip}">
                                                    ⏱️ ${isFa ? I18n.toPersianDigits(absStr) : absStr}
                                                </span>
                                                <button type="button" class="btn-day-absence-windows" onclick="event.stopPropagation(); PersonAnalyticsModal.openDayAbsenceModal('${day.date}')" title="${I18n.t('absence_windows_btn') || 'بازه‌های زمانی غیبت'}">
                                                    <span>📋</span>
                                                    <span>${I18n.t('absence_count_short', { count: countStr })}</span>
                                                    <span style="font-size: 0.65rem; ${isFa ? 'transform: rotate(180deg);' : ''}">➜</span>
                                                </button>
                                            </div>
                                        `;
                                    } else {
                                        absencePill = `<span class="badge-status-pill on-station" style="font-size: 0.7rem;">✓ ${I18n.t('no_absence')}</span>`;
                                    }
                                } else {
                                    absencePill = `<span style="color: var(--text-tertiary);">—</span>`;
                                }

                                return `
                                    <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;">
                                        <td style="padding: 0.75rem 0.5rem; font-weight: 600;">
                                            <div>${formattedDate}</div>
                                            <div style="font-size: 0.75rem; color: var(--text-tertiary);">${dayNameStr}</div>
                                        </td>
                                        <td style="padding: 0.75rem 0.5rem;">${I18n.isRTL() ? I18n.toPersianDigits(shiftText) : shiftText}</td>
                                        <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--text-primary);">${I18n.isRTL() ? I18n.toPersianDigits(arrivalTime) : arrivalTime}</td>
                                        <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--text-primary);">${I18n.isRTL() ? I18n.toPersianDigits(departureTime) : departureTime}</td>
                                        <td style="padding: 0.75rem 0.5rem; color: var(--accent-blue);">${I18n.isRTL() ? I18n.toPersianDigits(presenceSpan) : presenceSpan}</td>
                                        <td style="padding: 0.75rem 0.5rem;">${absencePill}</td>
                                        <td style="padding: 0.75rem 0.5rem;">${statusPill}</td>
                                        <td style="padding: 0.75rem 0.5rem; font-weight: 700;">${detectionsCount}</td>
                                        <td style="padding: 0.75rem 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">${PersonAnalyticsModal.escapeHtml(day.primary_camera || '—')}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    /**
     * Tab 5: Camera & Location Distribution.
     */
    renderCamerasTab() {
        const d = PersonAnalyticsModal._data;
        const cameras = d.camera_distribution || [];

        return `
            <div class="analytics-card">
                <div class="analytics-card-title">
                    <span>📹</span>
                    <span>${I18n.t('camera_breakdown_title')}</span>
                </div>

                ${cameras.length === 0 ? `
                    <div style="padding: 2rem; text-align: center; color: var(--text-secondary);">
                        ${I18n.t('card_never_seen')}
                    </div>
                ` : `
                    <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1.25rem;">
                        ${cameras.map(c => {
                            const countStr = I18n.isRTL() ? I18n.toPersianDigits(c.count) : c.count;
                            const pctStr = I18n.isRTL() ? I18n.toPersianDigits(c.percentage) : c.percentage;

                            return `
                                <div style="background: var(--bg-surface-hover); border-radius: var(--radius-sm); padding: 0.85rem 1rem; border: 1px solid var(--border-subtle);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                        <div style="font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                                            <span>📹</span>
                                            <span>${PersonAnalyticsModal.escapeHtml(c.camera_name)}</span>
                                        </div>
                                        <div style="font-size: 0.85rem; font-weight: 700; color: var(--accent-blue);">
                                            ${countStr} ${I18n.t('th_detections')} (${pctStr}%)
                                        </div>
                                    </div>
                                    <div style="background: rgba(255, 255, 255, 0.06); border-radius: var(--radius-full); height: 8px; overflow: hidden;">
                                        <div style="width: ${c.percentage}%; height: 100%; background: var(--gradient-primary); border-radius: var(--radius-full); transition: width 0.4s ease;"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>
        `;
    },

    /**
     * Tab 6: Recent Sightings Gallery.
     */
    renderRecentTab() {
        const d = PersonAnalyticsModal._data;
        const events = d.recent_events || [];

        if (events.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">📸</div>
                    <div class="empty-state-title">${I18n.t('card_never_seen')}</div>
                </div>
            `;
        }

        return `
            <div class="analytics-card">
                <div class="analytics-card-title" style="margin-bottom: 1rem;">
                    <span>🖼️</span>
                    <span>${I18n.t('tab_recent')} (${events.length})</span>
                </div>

                <div class="recent-snapshots-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem;">
                    ${events.map(ev => {
                        const snapUrl = ev.snapshot_url || (ev.snapshot_path ? `/api/snapshots/${ev.snapshot_path}` : '');
                        const fullTime = I18n.formatTimestamp(ev.timestamp);
                        const confPct = Math.round((ev.confidence_score || 0) * 100);
                        const confDisp = I18n.isRTL() ? I18n.toPersianDigits(confPct) : confPct;
                        const isWarning = ev.alert_type === 'absence_timeout' || ev.alert_type === 'camera_disconnected';

                        return `
                            <div class="recent-snapshot-card" onclick="EventCard.showDetailModal(${ev.id})" style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; cursor: pointer; transition: transform 0.2s, border-color 0.2s;" title="${PersonAnalyticsModal.escapeAttr(I18n.t('click_to_view'))}">
                                <div style="width: 100%; height: 120px; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                                    <img src="${snapUrl}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" onerror="this.outerHTML='<div style=\\'color: var(--text-tertiary); font-size: 0.75rem;\\'>${encodeURIComponent(I18n.t('no_image'))}</div>'" />
                                </div>
                                <div style="padding: 0.6rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
                                        <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📹 ${PersonAnalyticsModal.escapeHtml(ev.camera_name)}</span>
                                        ${!isWarning ? `<span style="font-size: 0.7rem; font-weight: 700; color: var(--accent-blue);">${confDisp}%</span>` : ''}
                                    </div>
                                    <div style="font-size: 0.7rem; color: var(--text-secondary);">🕐 ${fullTime}</div>
                                    ${ev.zone_name ? `<div style="font-size: 0.7rem; color: var(--accent-violet); margin-top: 0.2rem;">🎯 ${PersonAnalyticsModal.escapeHtml(ev.zone_name)}</div>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    },

    /**
     * Export the 30-day attendance table to an Excel (.xlsx) file.
     */
    async exportExcel() {
        const d = PersonAnalyticsModal._data;
        if (!d) return;
        const pid = d.person_id || d.id;
        if (!pid) return;

        const isFa = I18n.isRTL();
        const exportBtn = document.getElementById('btn-person-analytics-export');
        const exportText = document.getElementById('btn-export-text');
        const origText = exportText ? exportText.textContent : '';

        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.style.opacity = '0.7';
            if (exportText) exportText.textContent = isFa ? 'در حال دریافت...' : 'Exporting...';
        }

        App.showToast(isFa ? 'در حال تولید و دریافت فایل اکسل جدول...' : 'Generating and downloading Excel report...', 'info');

        try {
            const token = (typeof Auth !== 'undefined' && Auth.getToken()) || localStorage.getItem('token') || '';
            let queryParams = 'format=xlsx';
            let periodTag = '30d';
            if (PersonAnalyticsModal._activePeriod === 'custom' && PersonAnalyticsModal._customStartDate && PersonAnalyticsModal._customEndDate) {
                queryParams += `&start_date=${encodeURIComponent(PersonAnalyticsModal._customStartDate)}&end_date=${encodeURIComponent(PersonAnalyticsModal._customEndDate)}`;
                periodTag = `${PersonAnalyticsModal._customStartDate}_to_${PersonAnalyticsModal._customEndDate}`;
            } else {
                const days = PersonAnalyticsModal._days || 30;
                queryParams += `&days=${days}`;
                periodTag = `${days}d`;
            }

            const url = `/api/persons/${pid}/analytics/export?${queryParams}&token=${encodeURIComponent(token)}`;

            const response = await fetch(url, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(errJson.detail || (isFa ? 'خطا در دریافت فایل اکسل' : 'Export failed'));
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = downloadUrl;

            const safeName = (d.name || `person_${pid}`).replace(/[\s\/\\:*?"<>|]+/g, '_');
            const todayStr = new Date().toISOString().split('T')[0];
            a.download = `attendance_${periodTag}_${safeName}_${todayStr}.xlsx`;

            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            a.remove();

            App.showToast(isFa ? 'فایل اکسل جدول با موفقیت دانلود شد' : 'Excel table downloaded successfully', 'success');
        } catch (err) {
            console.error('Failed to export analytics excel:', err);
            App.showToast(err.message || (isFa ? 'خطا در تولید فایل اکسل' : 'Failed to export Excel file'), 'error');
        } finally {
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.style.opacity = '1';
                if (exportText) exportText.textContent = origText;
            }
        }
    },

    /**
     * Print or save summary report (routes to Excel export).
     */
    printSummary() {
        return PersonAnalyticsModal.exportExcel();
    },

    /**
     * Get initials.
     */
    getInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return parts[0][0].toUpperCase();
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    },

    escapeAttr(str) {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Open daily absence intervals modal dialog.
     * @param {string} dateStr - YYYY-MM-DD
     */
    openDayAbsenceModal(dateStr) {
        const d = PersonAnalyticsModal._data;
        if (!d) return;
        const daily = d.daily_activity_last_14_days || [];
        const day = daily.find(x => x.date === dateStr);
        if (!day) return;

        PersonAnalyticsModal.closeDayAbsenceModal();

        const isFa = I18n.isRTL();
        const formattedDate = I18n.formatDate(day.date);
        const dayNameStr = I18n.t(`short_${day.day_name.toLowerCase()}`);
        const intervals = day.absence_intervals || [];
        const totalAbsStr = day.absence_from_shift_str || `${day.absence_from_shift_minutes || 0}m`;
        const countVal = day.absence_count || intervals.length;
        const countStr = isFa ? I18n.toPersianDigits(countVal) : countVal;
        const shiftHours = day.is_scheduled_shift_day && day.shift_start_time
            ? `${isFa ? I18n.toPersianDigits(day.shift_start_time) : day.shift_start_time} - ${isFa ? I18n.toPersianDigits(day.shift_end_time) : day.shift_end_time}`
            : (I18n.t('status_rest_day') || 'بدون شیفت');

        const overlay = document.createElement('div');
        overlay.id = 'day-absence-modal-overlay';
        overlay.className = 'day-absence-modal-overlay';
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                PersonAnalyticsModal.closeDayAbsenceModal();
            }
        };

        overlay.innerHTML = `
            <div class="day-absence-dialog" onclick="event.stopPropagation()">
                <div class="day-absence-header" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-hover);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 700; font-size: 1rem; color: var(--text-primary);">
                        <span style="font-size: 1.2rem;">🕒</span>
                        <span>${I18n.t('absence_windows_btn') || 'بازه‌های زمانی غیبت'}</span>
                        <span style="color: var(--text-secondary); font-size: 0.85rem; font-weight: 500;">(${formattedDate} — ${dayNameStr})</span>
                    </div>
                    <button type="button" class="modal-close" onclick="PersonAnalyticsModal.closeDayAbsenceModal()" style="background: none; border: none; font-size: 1.25rem; cursor: pointer; color: var(--text-secondary);">✕</button>
                </div>

                <!-- Summary Chips -->
                <div style="padding: 0.75rem 1.25rem; background: rgba(15, 23, 42, 0.4); border-bottom: 1px solid var(--border-subtle); display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.82rem; align-items: center; justify-content: space-between;">
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
                        <span>👤 <strong>${PersonAnalyticsModal.escapeHtml(d.name)}</strong></span>
                        <span>⏰ <strong>${I18n.t('shift_hours') || 'ساعات شیفت:'}</strong> <span dir="ltr">${shiftHours}</span></span>
                    </div>
                    <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
                        <span>⏱️ <strong>${I18n.t('kpi_absence_time') || 'مجموع غیبت:'}</strong> <span style="color: var(--accent-rose); font-weight: 700;">${isFa ? I18n.toPersianDigits(totalAbsStr) : totalAbsStr}</span></span>
                        <span>📍 <strong>${I18n.t('absence_count_short', { count: countStr })}</strong></span>
                    </div>
                </div>

                <!-- Absence Intervals List -->
                <div class="day-absence-body" style="padding: 1.25rem; overflow-y: auto; max-height: calc(85vh - 160px); display: flex; flex-direction: column; gap: 0.6rem;">
                    ${intervals.length > 0 ? intervals.map((w, idx) => {
                        const startT = isFa ? I18n.toPersianDigits(w.start_time) : w.start_time;
                        const endT = w.interval_type === 'current'
                            ? (I18n.t('window_now') || 'هم‌اکنون')
                            : (isFa ? I18n.toPersianDigits(w.end_time) : w.end_time);
                        const durStr = isFa ? I18n.toPersianDigits(w.duration_str) : w.duration_str;
                        const typeKey = `interval_type_${w.interval_type}`;
                        const typeLabel = I18n.t(typeKey) || (w.interval_type === 'unseen' ? (isFa ? 'عدم حضور از ابتدای شیفت' : 'Never Seen Yet') : w.interval_type);
                        const isCurrent = w.interval_type === 'current';
                        return `
                            <div class="duty-window-item ${isCurrent ? 'is-current' : ''}" style="padding: 0.65rem 0.9rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; background: var(--bg-surface-hover);">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <span style="font-size: 0.75rem; color: var(--text-tertiary); font-weight: 700; min-width: 1.5rem;">#${isFa ? I18n.toPersianDigits(idx + 1) : (idx + 1)}</span>
                                    <div class="duty-window-type-tag ${w.interval_type}" style="font-size: 0.75rem; padding: 2px 8px; border-radius: 4px;">
                                        ${isCurrent ? '🔴' : (w.interval_type === 'unseen' ? '⌛' : '⏳')} ${typeLabel}
                                    </div>
                                </div>
                                <div class="duty-window-time" dir="ltr" style="font-family: monospace; font-size: 0.95rem; font-weight: 700;">
                                    <span class="win-time">${startT}</span>
                                    <span class="win-arrow" style="color: var(--text-tertiary); margin: 0 4px;">➜</span>
                                    <span class="win-time ${isCurrent ? 'win-current' : ''}" style="${isCurrent ? 'color: var(--accent-rose);' : ''}">${endT}</span>
                                </div>
                                <div class="duty-window-dur-pill" style="font-size: 0.8rem; font-weight: 700; background: rgba(244, 63, 94, 0.15); color: #fb7185; padding: 2px 8px; border-radius: 12px; border: 1px solid rgba(244, 63, 94, 0.3);">
                                    ${durStr}
                                </div>
                            </div>
                        `;
                    }).join('') : `
                        <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-tertiary);">
                            <div style="font-size: 2rem; margin-bottom: 0.5rem;">✓</div>
                            <div style="font-weight: 600;">${I18n.t('no_absence_intervals') || 'بدون ثبت غیبت در این شیفت'}</div>
                        </div>
                    `}
                </div>

                <!-- Footer -->
                <div class="day-absence-footer" style="padding: 0.75rem 1.25rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; background: var(--bg-surface-hover);">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="PersonAnalyticsModal.closeDayAbsenceModal()">
                        ${I18n.t('close') || 'بستن'}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        PersonAnalyticsModal._escapeHandler = (e) => {
            if (e.key === 'Escape') {
                PersonAnalyticsModal.closeDayAbsenceModal();
            }
        };
        window.addEventListener('keydown', PersonAnalyticsModal._escapeHandler);
    },

    /**
     * Close the day absence dialog overlay.
     */
    closeDayAbsenceModal() {
        const el = document.getElementById('day-absence-modal-overlay');
        if (el) {
            el.remove();
        }
        if (PersonAnalyticsModal._escapeHandler) {
            window.removeEventListener('keydown', PersonAnalyticsModal._escapeHandler);
            PersonAnalyticsModal._escapeHandler = null;
        }
    },
    /**
     * Get Gregorian ISO date (YYYY-MM-DD) for start or end.
     * @param {'start'|'end'} target
     * @returns {string}
     */
    getGregorianDate(target) {
        const jy = target === 'start' ? this._startJy : this._endJy;
        const jm = target === 'start' ? this._startJm : this._endJm;
        const jd = target === 'start' ? this._startJd : this._endJd;
        if (!jy || !jm || !jd) return '';
        const g = I18n.jalaliToGregorian(jy, jm, jd);
        const pad = n => String(n).padStart(2, '0');
        return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
    },

    /**
     * Format selected Shamsi date for button display.
     * @param {'start'|'end'} target
     * @returns {string}
     */
    getShamsiDisplay(target) {
        const jy = target === 'start' ? this._startJy : this._endJy;
        const jm = target === 'start' ? this._startJm : this._endJm;
        const jd = target === 'start' ? this._startJd : this._endJd;
        if (!jy || !jm || !jd) return '—';

        const isRtl = I18n.isRTL();
        const monthName = isRtl
            ? (I18n._shamsiMonthsFa[jm - 1] || '')
            : (I18n._shamsiMonthsEn[jm - 1] || '');

        if (isRtl) {
            return `${I18n.toPersianDigits(jd)} ${monthName} ${I18n.toPersianDigits(jy)}`;
        } else {
            return `${jd} ${monthName} ${jy}`;
        }
    },

    /**
     * Toggle Shamsi calendar popover for start or end.
     * @param {'start'|'end'} target
     * @param {Event} event
     */
    toggleCalendar(target, event) {
        if (event) event.stopPropagation();
        this._setupClickOutsideListener();

        if (this._activeCalendarTarget === target) {
            this.closeAllCalendarPopovers();
            return;
        }

        this.closeAllCalendarPopovers();
        this._activeCalendarTarget = target;

        const jy = (target === 'start') ? this._startJy : this._endJy;
        const jm = (target === 'start') ? this._startJm : this._endJm;
        this._calendarViewJy = jy;
        this._calendarViewJm = jm;

        this.renderCalendarPopover(target);
    },

    /**
     * Close all open Shamsi calendar popovers in this modal.
     */
    closeAllCalendarPopovers() {
        const popStart = document.getElementById('p-ana-calendar-popover-start');
        const popEnd = document.getElementById('p-ana-calendar-popover-end');
        if (popStart) popStart.style.display = 'none';
        if (popEnd) popEnd.style.display = 'none';
        this._activeCalendarTarget = null;
    },

    /**
     * Change viewed month in Shamsi calendar popover.
     * @param {number} delta - 1 or -1
     */
    changeCalendarMonth(delta) {
        if (!this._activeCalendarTarget) return;
        this._calendarViewJm += delta;
        if (this._calendarViewJm > 12) {
            this._calendarViewJm = 1;
            this._calendarViewJy += 1;
        } else if (this._calendarViewJm < 1) {
            this._calendarViewJm = 12;
            this._calendarViewJy -= 1;
        }
        this.renderCalendarPopover(this._activeCalendarTarget);
    },

    /**
     * Jump calendar popover to current Shamsi month & day.
     */
    goToCalendarToday() {
        if (!this._activeCalendarTarget) return;
        const nowJ = I18n.toJalali(new Date());
        if (nowJ) {
            this._calendarViewJy = nowJ.jy;
            this._calendarViewJm = nowJ.jm;
            this.renderCalendarPopover(this._activeCalendarTarget);
        }
    },

    /**
     * Select a specific Shamsi day from the calendar grid.
     * @param {'start'|'end'} target
     * @param {number} jy
     * @param {number} jm
     * @param {number} jd
     */
    selectCalendarDay(target, jy, jm, jd) {
        if (target === 'start') {
            this._startJy = jy;
            this._startJm = jm;
            this._startJd = jd;

            const sIso = this.getGregorianDate('start');
            const eIso = this.getGregorianDate('end');
            if (eIso && sIso && eIso < sIso) {
                this._endJy = jy;
                this._endJm = jm;
                this._endJd = jd;
            }
        } else {
            this._endJy = jy;
            this._endJm = jm;
            this._endJd = jd;

            const sIso = this.getGregorianDate('start');
            const eIso = this.getGregorianDate('end');
            if (sIso && eIso && sIso > eIso) {
                this._startJy = jy;
                this._startJm = jm;
                this._startJd = jd;
            }
        }

        this.closeAllCalendarPopovers();
        this._updateDateLabels();
    },

    /**
     * Update Shamsi date labels on the DOM.
     */
    _updateDateLabels() {
        const startLbl = document.getElementById('p-ana-start-shamsi-label');
        const endLbl = document.getElementById('p-ana-end-shamsi-label');
        if (startLbl) startLbl.textContent = this.getShamsiDisplay('start');
        if (endLbl) endLbl.textContent = this.getShamsiDisplay('end');
    },

    /**
     * Render the Shamsi calendar popover grid HTML.
     * @param {'start'|'end'} target
     */
    renderCalendarPopover(target) {
        const popoverEl = document.getElementById(`p-ana-calendar-popover-${target}`);
        if (!popoverEl) return;

        const isRtl = I18n.isRTL();
        const viewJy = this._calendarViewJy;
        const viewJm = this._calendarViewJm;

        const monthName = isRtl
            ? (I18n._shamsiMonthsFa[viewJm - 1] || '')
            : (I18n._shamsiMonthsEn[viewJm - 1] || '');
        const yearDisp = isRtl ? I18n.toPersianDigits(viewJy) : viewJy;

        const selJy = (target === 'start') ? this._startJy : this._endJy;
        const selJm = (target === 'start') ? this._startJm : this._endJm;
        const selJd = (target === 'start') ? this._startJd : this._endJd;

        const nowJ = I18n.toJalali(new Date());

        const gFirst = I18n.jalaliToGregorian(viewJy, viewJm, 1);
        const dFirst = new Date(gFirst.gy, gFirst.gm - 1, gFirst.gd);
        const startCol = (dFirst.getDay() + 1) % 7;
        const totalDays = I18n.getJalaliDaysInMonth(viewJy, viewJm);

        const weekdays = isRtl
            ? ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']
            : ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'];

        let cellsHtml = '';
        for (let i = 0; i < startCol; i++) {
            cellsHtml += '<div class="cal-day-cell empty"></div>';
        }

        for (let d = 1; d <= totalDays; d++) {
            const isSelected = (selJy === viewJy && selJm === viewJm && selJd === d);
            const isToday = nowJ && (nowJ.jy === viewJy && nowJ.jm === viewJm && nowJ.jd === d);
            const isFriday = ((startCol + d - 1) % 7 === 6);
            const dayNum = isRtl ? I18n.toPersianDigits(d) : d;

            cellsHtml += `
                <button 
                    type="button" 
                    class="cal-day-cell ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${isFriday ? 'friday' : ''}" 
                    onclick="event.stopPropagation(); PersonAnalyticsModal.selectCalendarDay('${target}', ${viewJy}, ${viewJm}, ${d});"
                >
                    ${dayNum}
                </button>
            `;
        }

        popoverEl.innerHTML = `
            <div class="cal-header">
                <button type="button" class="cal-nav-btn" onclick="event.stopPropagation(); PersonAnalyticsModal.changeCalendarMonth(${isRtl ? '1' : '-1'});" title="${isRtl ? 'ماه قبل' : 'Previous Month'}">
                    ${isRtl ? '▶' : '◀'}
                </button>
                <div class="cal-title">${monthName} ${yearDisp}</div>
                <button type="button" class="cal-today-btn" onclick="event.stopPropagation(); PersonAnalyticsModal.goToCalendarToday();">
                    ${I18n.t('preset_today') || 'امروز'}
                </button>
                <button type="button" class="cal-nav-btn" onclick="event.stopPropagation(); PersonAnalyticsModal.changeCalendarMonth(${isRtl ? '-1' : '1'});" title="${isRtl ? 'ماه بعد' : 'Next Month'}">
                    ${isRtl ? '◀' : '▶'}
                </button>
            </div>
            <div class="cal-weekdays">
                ${weekdays.map((w, idx) => `<div class="cal-weekday ${idx === 6 ? 'friday' : ''}">${w}</div>`).join('')}
            </div>
            <div class="cal-days-grid">
                ${cellsHtml}
            </div>
        `;

        popoverEl.style.display = 'block';
    },

    _setupClickOutsideListener() {
        if (this._hasClickOutsideListener) return;
        this._hasClickOutsideListener = true;
        document.addEventListener('click', (e) => {
            if (!this._activeCalendarTarget) return;
            const popStart = document.getElementById('p-ana-calendar-popover-start');
            const popEnd = document.getElementById('p-ana-calendar-popover-end');
            const isInsidePopStart = popStart && popStart.contains(e.target);
            const isInsidePopEnd = popEnd && popEnd.contains(e.target);
            const isInsideBtn = e.target.closest && e.target.closest('.shamsi-date-btn');
            if (!isInsidePopStart && !isInsidePopEnd && !isInsideBtn) {
                this.closeAllCalendarPopovers();
            }
        });
    },
};
