/**
 * PersonAnalyticsModal — Comprehensive shift-aware analytics and summary
 * dashboard for an individual person.
 */
const PersonAnalyticsModal = {
    _data: null,
    _activeTab: 'overview',
    _shiftFilter: 'all', // 'all', 'in_shift', 'out_shift'

    /**
     * Fetch analytics and open the analytics modal for a person.
     * @param {number} personId
     */
    async show(personId) {
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

        try {
            const data = await App.api(`/api/persons/${personId}/analytics`);
            PersonAnalyticsModal._data = data;
            PersonAnalyticsModal._activeTab = 'overview';
            PersonAnalyticsModal._shiftFilter = 'all';
            PersonAnalyticsModal.render();
        } catch (err) {
            console.error('Failed to load person analytics:', err);
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
        }
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
                    <button class="btn btn-secondary btn-sm" onclick="PersonAnalyticsModal.printSummary()" title="${PersonAnalyticsModal.escapeAttr(I18n.t('print_summary'))}">
                        ${I18n.t('print_summary')}
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
                    ${I18n.t('tab_attendance')}
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

                <div class="kpi-card emerald">
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

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-top: 1rem;">
                    <div class="info-block" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); text-align: center;">
                        <div style="font-size: 1.8rem; font-weight: 900; color: var(--accent-emerald);">${isFa ? I18n.toPersianDigits(comp.compliance_rate) : comp.compliance_rate}%</div>
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
     * Tab 4: 14-Day Attendance Log & Punctuality Table.
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
                    <span>${I18n.t('tab_attendance')}</span>
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

                                // Absence from shift calculation badge
                                let absencePill = '';
                                if (day.is_scheduled_shift_day) {
                                    if (day.absence_from_shift_minutes > 0) {
                                        const absStr = day.absence_from_shift_str || `${day.absence_from_shift_minutes}m`;
                                        absencePill = `<span class="badge-status-pill" style="background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.35); font-weight: 700;">⏱️ ${I18n.isRTL() ? I18n.toPersianDigits(absStr) : absStr}</span>`;
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

                        return `
                            <div class="recent-snapshot-card" onclick="EventCard.showDetailModal(${ev.id})" style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; cursor: pointer; transition: transform 0.2s, border-color 0.2s;" title="${PersonAnalyticsModal.escapeAttr(I18n.t('click_to_view'))}">
                                <div style="width: 100%; height: 120px; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                                    <img src="${snapUrl}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" onerror="this.outerHTML='<div style=\\'color: var(--text-tertiary); font-size: 0.75rem;\\'>${encodeURIComponent(I18n.t('no_image'))}</div>'" />
                                </div>
                                <div style="padding: 0.6rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
                                        <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📹 ${PersonAnalyticsModal.escapeHtml(ev.camera_name)}</span>
                                        <span style="font-size: 0.7rem; font-weight: 700; color: var(--accent-blue);">${confDisp}%</span>
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
     * Print or save summary report.
     */
    printSummary() {
        window.print();
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
};
