/**
 * SupervisorLeaveModal — Dedicated modal for supervisors to manage
 * scheduled leaves, off-duty days, and sick leaves for assigned personnel.
 * Features 100% localization and interactive Solar Hijri (Shamsi / Jalali) calendar pickers.
 */
const SupervisorLeaveModal = {
    _personId: null,
    _personName: '',
    _leaves: [],

    // Shamsi start date components
    _startJy: null,
    _startJm: null,
    _startJd: null,

    // Shamsi end date components
    _endJy: null,
    _endJm: null,
    _endJd: null,

    // Active calendar picker target: 'start' | 'end' | null
    _activeCalendarTarget: null,
    _calendarViewJy: null,
    _calendarViewJm: null,

    _hasClickOutsideListener: false,

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
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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
        const pad = n => String(n).padStart(2, '0');

        if (isRtl) {
            return `${I18n.toPersianDigits(jd)} ${monthName} ${I18n.toPersianDigits(jy)}`;
        } else {
            return `${jd} ${monthName} ${jy}`;
        }
    },

    /**
     * Format selected Shamsi date numeric (e.g. 1405/08/04).
     * @param {'start'|'end'} target
     * @returns {string}
     */
    getShamsiNumeric(target) {
        const jy = target === 'start' ? this._startJy : this._endJy;
        const jm = target === 'start' ? this._startJm : this._endJm;
        const jd = target === 'start' ? this._startJd : this._endJd;
        if (!jy || !jm || !jd) return '—';

        const isRtl = I18n.isRTL();
        const pad = n => String(n).padStart(2, '0');
        if (isRtl) {
            return `${I18n.toPersianDigits(jy)}/${I18n.toPersianDigits(pad(jm))}/${I18n.toPersianDigits(pad(jd))}`;
        } else {
            return `${jy}/${pad(jm)}/${pad(jd)}`;
        }
    },

    /**
     * Calculate duration in days between selected start and end dates.
     * @returns {number}
     */
    getSelectedDurationDays() {
        const sIso = this.getGregorianDate('start');
        const eIso = this.getGregorianDate('end');
        if (!sIso || !eIso) return 1;
        const sTime = new Date(sIso).getTime();
        const eTime = new Date(eIso).getTime();
        return Math.max(1, Math.round((eTime - sTime) / (1000 * 3600 * 24)) + 1);
    },

    /**
     * Format a leave's date range for display in Shamsi.
     * @param {string} startIso
     * @param {string} endIso
     * @returns {string}
     */
    formatLeaveRange(startIso, endIso) {
        if (!startIso) return '—';
        const sDate = startIso;
        const eDate = endIso || startIso;
        const isRtl = I18n.isRTL();

        const sFormatted = I18n.formatDate(sDate);
        const sNumeric = I18n.formatDateNumeric(sDate);

        if (sDate === eDate) {
            return `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-weight: 700; color: var(--text-primary); font-size: 0.86rem;">
                        📅 ${sFormatted}
                    </span>
                    <span class="text-muted text-xs font-mono" style="direction: ltr; text-align: ${isRtl ? 'right' : 'left'};">
                        ${sNumeric} • ${I18n.t('leave_one_day') || '۱ روز'}
                    </span>
                </div>
            `;
        }

        const eFormatted = I18n.formatDate(eDate);
        const eNumeric = I18n.formatDateNumeric(eDate);

        const sTime = new Date(sDate).getTime();
        const eTime = new Date(eDate).getTime();
        const days = Math.max(1, Math.round((eTime - sTime) / (1000 * 3600 * 24)) + 1);
        const daysText = isRtl
            ? `${I18n.toPersianDigits(days)} روز`
            : `${days} days`;

        return `
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <div style="font-weight: 700; color: var(--text-primary); font-size: 0.84rem; display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                    <span>📅 ${sFormatted}</span>
                    <span style="color: var(--text-tertiary); font-size: 0.75rem;">${isRtl ? '←' : '→'}</span>
                    <span>${eFormatted}</span>
                    <span class="badge badge-subtle text-xs" style="font-size: 0.7rem; padding: 1px 6px;">
                        ${daysText}
                    </span>
                </div>
                <div class="text-muted text-xs font-mono" style="direction: ltr; text-align: ${isRtl ? 'right' : 'left'};">
                    ${sNumeric} ${isRtl ? '←' : '→'} ${eNumeric}
                </div>
            </div>
        `;
    },

    /**
     * Open Leave Management modal for a given person.
     * @param {number} personId
     * @param {string} personName
     */
    async show(personId, personName = '') {
        this._personId = personId;
        this._personName = personName || `Person #${personId}`;
        this._leaves = [];

        // Initialize start and end dates to today in Shamsi
        const nowJ = I18n.toJalali(new Date());
        if (nowJ) {
            this._startJy = nowJ.jy;
            this._startJm = nowJ.jm;
            this._startJd = nowJ.jd;
            this._endJy = nowJ.jy;
            this._endJm = nowJ.jm;
            this._endJd = nowJ.jd;
            this._calendarViewJy = nowJ.jy;
            this._calendarViewJm = nowJ.jm;
        }
        this._activeCalendarTarget = null;
        this._initClickOutside();

        App.openModal(`
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">🏖️</span>
                    <div>
                        <h2 class="modal-title">${I18n.t('manage_leaves_title') || 'مدیریت مرخصی و روزهای آف'}</h2>
                        <p class="modal-subtitle">${this.escapeHtml(this._personName)}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 2.5rem; text-align: center;">
                <div class="spinner-border text-primary mb-3"></div>
                <div style="font-size: 0.9rem; color: var(--text-secondary);">${I18n.t('loading') || 'در حال دریافت اطلاعات...'}</div>
            </div>
        `, 'modal-lg');

        try {
            const leaves = await App.api(`/api/persons/${personId}/leaves`);
            this._leaves = Array.isArray(leaves) ? leaves : [];
            this.render();
        } catch (err) {
            console.error('Failed to load leaves:', err);
            App.showToast(err.message || 'خطا در دریافت مرخصی‌ها', 'error');
            App.closeModal();
        }
    },

    _initClickOutside() {
        if (this._hasClickOutsideListener) return;
        document.addEventListener('click', (e) => {
            if (SupervisorLeaveModal._activeCalendarTarget) {
                const isInsidePop = e.target.closest('#leave-calendar-popover-start') ||
                                    e.target.closest('#leave-calendar-popover-end');
                const isInsideBtn = e.target.closest('.shamsi-date-btn');
                if (!isInsidePop && !isInsideBtn) {
                    SupervisorLeaveModal.closeAllCalendarPopovers();
                }
            }
        });
        this._hasClickOutsideListener = true;
    },

    /**
     * Render the leave modal HTML content.
     */
    render() {
        const isRtl = I18n.isRTL();
        const initialLetter = this._personName.trim().charAt(0).toUpperCase() || '👤';
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayShamsiFormatted = I18n.formatDate(todayStr);
        const todayShamsiNumeric = I18n.formatDateNumeric(todayStr);

        let leavesHtml = '';
        if (this._leaves.length === 0) {
            leavesHtml = `
                <div class="text-center card-glass" style="border-radius: var(--radius-sm); border: 1px dashed rgba(255, 255, 255, 0.14); padding: 1.15rem 1rem;">
                    <span style="font-size: 1.8rem; display: block; margin-bottom: 0.3rem; opacity: 0.85;">📅</span>
                    <strong style="display: block; font-size: 0.9rem; color: #f8fafc; margin-bottom: 0.2rem;">${I18n.t('no_leaves_recorded') || (isRtl ? 'هیچ مرخصی یا آف شیفتی برای این فرد ثبت نشده است.' : 'No leaves or off-duty days recorded for this person.')}</strong>
                    <small style="display: block; color: #94a3b8; font-size: 0.78rem; line-height: 1.4;">${isRtl ? 'با فرم بالا می‌توانید روزهای آف، مرخصی روزانه یا استعلاجی را به برنامه کاری اضافه کنید.' : 'Use the form above to add scheduled leaves, off-duty days, or sick leave.'}</small>
                </div>
            `;
        } else {
            leavesHtml = `
                <div class="leaves-table-wrapper" style="max-height: 250px; overflow-y: auto;">
                    <table class="table table-sm text-sm" style="width: 100%; border-collapse: separate; border-spacing: 0 5px;">
                        <thead>
                            <tr style="color: var(--text-secondary); font-size: 0.78rem;">
                                <th style="padding: 6px 10px;">${I18n.t('leave_type') || 'نوع'}</th>
                                <th style="padding: 6px 10px;">${I18n.t('leave_date_range') || 'بازه زمانی (شمسی)'}</th>
                                <th style="padding: 6px 10px;">${I18n.t('leave_status') || 'وضعیت'}</th>
                                <th style="padding: 6px 10px;">${I18n.t('note_optional') || 'توضیحات'}</th>
                                <th style="padding: 6px 10px; text-align: center;">${I18n.t('delete') || 'حذف'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this._leaves.map(l => {
                                const typeBadge = l.leave_type === 'sick' 
                                    ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">${I18n.t('badge_leave_sick') || '🏥 استعلاجی'}</span>`
                                    : l.leave_type === 'off_duty'
                                    ? `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">${I18n.t('badge_leave_off_duty') || '🏖️ آف شیفت'}</span>`
                                    : `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);">${I18n.t('badge_leave_daily') || '📋 مرخصی روزانه'}</span>`;

                                const sDate = l.start_date || '';
                                const eDate = l.end_date || sDate;
                                const isCurrent = (sDate <= todayStr && todayStr <= eDate);
                                const isUpcoming = (todayStr < sDate);
                                const isPassed = (todayStr > eDate);

                                let statusBadge = '';
                                if (isCurrent) {
                                    statusBadge = `<span class="badge badge-success text-xs" style="font-weight: 700;">🟢 ${I18n.t('leave_active_today') || 'فعال امروز'}</span>`;
                                } else if (isUpcoming) {
                                    statusBadge = `<span class="badge text-xs" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">⏳ ${I18n.t('leave_upcoming') || 'در پیش رو'}</span>`;
                                } else {
                                    statusBadge = `<span class="badge text-xs" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8;">⚪ ${I18n.t('leave_passed') || 'سپری‌شده'}</span>`;
                                }

                                return `
                                    <tr style="background: var(--bg-surface-hover); border-radius: 6px;">
                                        <td style="padding: 7px 10px; vertical-align: middle;">
                                            ${typeBadge}
                                        </td>
                                        <td style="padding: 7px 10px; vertical-align: middle;">
                                            ${this.formatLeaveRange(sDate, eDate)}
                                        </td>
                                        <td style="padding: 7px 10px; vertical-align: middle;">
                                            ${statusBadge}
                                        </td>
                                        <td style="padding: 7px 10px; vertical-align: middle; color: var(--text-secondary); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem;">
                                            ${this.escapeHtml(l.note || '—')}
                                        </td>
                                        <td style="padding: 7px 10px; text-align: center; vertical-align: middle;">
                                            <button type="button" class="btn btn-outline-danger btn-sm" onclick="SupervisorLeaveModal.deleteLeave('${l.id}')" title="${I18n.t('delete') || 'حذف'}" style="padding: 3px 8px; font-size: 0.78rem;">
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        const durationDays = this.getSelectedDurationDays();
        const durationText = durationDays === 1
            ? (I18n.t('leave_one_day') || '۱ روز')
            : (I18n.t('leave_duration_days', { days: isRtl ? I18n.toPersianDigits(durationDays) : durationDays }) || `${durationDays} روز`);

        const leavesCountText = isRtl
            ? `${I18n.toPersianDigits(this._leaves.length)} مورد`
            : (this._leaves.length === 1 ? '1 record' : `${this._leaves.length} records`);

        const modalHtml = `
            <div class="modal-header" style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding: 0.95rem 1.35rem;">
                <div class="modal-title-group" style="display: flex; align-items: center; gap: 0.75rem;">
                    <div class="user-avatar-circle" style="width: 38px; height: 38px; font-size: 1.05rem; font-weight: 700; background: linear-gradient(135deg, #6366f1 0%, #3b82f6 100%); color: white; display: flex; align-items: center; justify-content: center; border-radius: 50%; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);">
                        ${initialLetter}
                    </div>
                    <div>
                        <h2 class="modal-title" style="margin: 0; font-size: 1.1rem; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 0.45rem;">
                            <span>🏖️</span>
                            <span>${I18n.t('manage_leaves_title') || 'مدیریت مرخصی و روزهای آف'}</span>
                        </h2>
                        <p class="modal-subtitle" style="margin: 2px 0 0; color: #94a3b8; font-size: 0.82rem; font-weight: 500;">${this.escapeHtml(this._personName)}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()" aria-label="Close" style="color: #94a3b8;">✕</button>
            </div>

            <div class="modal-body" style="padding: 1rem 1.35rem; max-height: 80vh; overflow-y: auto;">
                <!-- Fast Action: Quick Off-Duty Today -->
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.85rem; flex-wrap: wrap; border: 1px solid rgba(59, 130, 246, 0.32); background: linear-gradient(135deg, rgba(30, 58, 138, 0.28) 0%, rgba(15, 23, 42, 0.5) 100%); border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.75rem;">
                    <div style="flex: 1; min-width: 220px;">
                        <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                            <span style="font-size: 0.95rem;">⚡</span>
                            <span style="font-size: 0.9rem; font-weight: 700; color: #f8fafc;">${I18n.t('quick_off_today_title') || 'ثبت فوری آف شیفت امروز'}</span>
                            <span style="font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: rgba(59, 130, 246, 0.22); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.45); display: inline-flex; align-items: center; gap: 4px;">
                                <span>📅</span> <span>${todayShamsiFormatted}</span>
                            </span>
                        </div>
                        <p style="margin: 3px 0 0; font-size: 0.78rem; color: #cbd5e1; line-height: 1.35;">
                            ${I18n.t('quick_off_today_hint') || 'این فرد را برای امروز به عنوان آف شیفت / مرخصی ثبت می‌کند تا هشدار عدم حضور تولید نشود.'}
                        </p>
                    </div>
                    <button type="button" class="btn btn-primary" onclick="SupervisorLeaveModal.applyQuickOffToday()" style="padding: 6px 14px; font-weight: 700; font-size: 0.82rem; border-radius: 8px; white-space: nowrap; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border: none; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35); display: inline-flex; align-items: center; gap: 0.35rem;">
                        <span>🏖️</span>
                        <span>${I18n.t('mark_off_today') || 'آف شیفت امروز'}</span>
                    </button>
                </div>

                <!-- Add Leave Form with Shamsi Calendar Pickers -->
                <div class="card-glass" style="border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(15, 23, 42, 0.55); padding: 0.85rem 1rem; margin-bottom: 0.75rem;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.4rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 0.5rem;">
                        <h4 style="font-size: 0.92rem; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 0.4rem; color: #f8fafc;">
                            <span style="color: #60a5fa;">➕</span>
                            <span>${I18n.t('add_leave_schedule') || 'ثبت مرخصی یا روز آف جدید'}</span>
                        </h4>
                        <div style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.78rem; color: #94a3b8;">
                            <span>⏱️ ${I18n.t('leave_date_range') || 'طول دوره:'}</span>
                            <span id="leave-calc-duration" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); font-weight: 700; font-size: 0.76rem; padding: 2px 9px; border-radius: 9999px;">
                                ${durationText}
                            </span>
                        </div>
                    </div>

                    <form id="add-leave-form" onsubmit="SupervisorLeaveModal.submitAdd(event)">
                        <!-- 3-Column Grid for Type, Start Date, End Date -->
                        <div class="sup-leave-form-grid">
                            <!-- Leave Type -->
                            <div>
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>🏷️</span>
                                    <span>${I18n.t('leave_type') || 'نوع مرخصی / آف'}</span>
                                </label>
                                <select id="leave-type-select" class="form-control form-select sup-leave-select">
                                    <option value="daily_leave">📋 ${I18n.t('leave_daily') || 'مرخصی روزانه'}</option>
                                    <option value="off_duty">🏖️ ${I18n.t('leave_off_duty') || 'آف شیفت / استراحت'}</option>
                                    <option value="sick">🏥 ${I18n.t('leave_sick') || 'مرخصی استعلاجی'}</option>
                                </select>
                            </div>

                            <!-- Shamsi Start Date Picker -->
                            <div style="position: relative;">
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>📅</span>
                                    <span>${I18n.t('from_date_label') || 'از تاریخ (شروع)'}</span>
                                </label>
                                <button type="button" class="btn w-100 shamsi-date-btn" onclick="SupervisorLeaveModal.toggleCalendar('start', event)" style="height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.75rem; border: 1px solid rgba(59, 130, 246, 0.45); background: rgba(15, 23, 42, 0.85); border-radius: 8px; transition: all 0.2s ease;">
                                    <span style="display: flex; align-items: center; gap: 0.45rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        <span style="font-size: 0.95rem;">📅</span>
                                        <span id="leave-start-shamsi-label" style="font-weight: 700; font-size: 0.85rem; color: #38bdf8;">${this.getShamsiDisplay('start')}</span>
                                    </span>
                                    <span style="color: #60a5fa; font-size: 0.7rem; margin-inline-start: 4px;">▼</span>
                                </button>
                                <div id="leave-calendar-popover-start" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-start: 0; z-index: 1100; width: 285px;"></div>
                            </div>

                            <!-- Shamsi End Date Picker -->
                            <div style="position: relative;">
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>📅</span>
                                    <span>${I18n.t('to_date_label') || 'تا تاریخ (پایان)'}</span>
                                </label>
                                <button type="button" class="btn w-100 shamsi-date-btn" onclick="SupervisorLeaveModal.toggleCalendar('end', event)" style="height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.75rem; border: 1px solid rgba(59, 130, 246, 0.45); background: rgba(15, 23, 42, 0.85); border-radius: 8px; transition: all 0.2s ease;">
                                    <span style="display: flex; align-items: center; gap: 0.45rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        <span style="font-size: 0.95rem;">📅</span>
                                        <span id="leave-end-shamsi-label" style="font-weight: 700; font-size: 0.85rem; color: #38bdf8;">${this.getShamsiDisplay('end')}</span>
                                    </span>
                                    <span style="color: #60a5fa; font-size: 0.7rem; margin-inline-start: 4px;">▼</span>
                                </button>
                                <div id="leave-calendar-popover-end" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-end: 0; z-index: 1100; width: 285px;"></div>
                            </div>
                        </div>

                        <!-- Quick Presets Toolbar -->
                        <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 10px;">
                            <span style="font-size: 0.78rem; font-weight: 600; color: #94a3b8; display: inline-flex; align-items: center; gap: 4px; margin-inline-end: 0.2rem;">
                                <span>⚡</span> <span>${I18n.t('quick_presets') || 'میانبر سریع:'}</span>
                            </span>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorLeaveModal.applyPreset('today')">
                                ${I18n.t('preset_today') || 'امروز'}
                            </button>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorLeaveModal.applyPreset('tomorrow')">
                                ${I18n.t('preset_tomorrow') || 'فردا'}
                            </button>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorLeaveModal.applyPreset('3days')">
                                ${I18n.t('preset_3_days') || '۳ روزه'}
                            </button>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorLeaveModal.applyPreset('weekend')">
                                ${I18n.t('preset_weekend') || 'تا پایان هفته'}
                            </button>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorLeaveModal.applyPreset('week')">
                                ${I18n.t('preset_week') || '۱ هفته'}
                            </button>
                        </div>

                        <!-- Combined Note / Reason + Submit Button Row -->
                        <div class="sup-leave-input-row">
                            <div style="flex: 1;">
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>📝</span>
                                    <span>${I18n.t('note_optional') || 'توضیحات / علت (اختیاری)'}</span>
                                </label>
                                <input type="text" id="leave-note" class="form-control" placeholder="${I18n.t('leave_note_placeholder') || 'مثال: هماهنگ‌شده با سرپرست، استراحت استعلاجی، آف دوره‌ای...'}" style="height: 40px; font-size: 0.85rem; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.16); color: #f8fafc; border-radius: 8px;" />
                            </div>
                            <button type="submit" class="btn btn-primary" id="btn-save-leave" style="height: 40px; padding: 0 20px; font-weight: 700; font-size: 0.86rem; border-radius: 8px; background: linear-gradient(135deg, #6366f1 0%, #3b82f6 100%); border: none; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35); display: inline-flex; align-items: center; gap: 0.45rem; white-space: nowrap; flex-shrink: 0;">
                                <span>💾</span>
                                <span>${I18n.t('save_leave_btn') || 'ثبت در تقویم کاری'}</span>
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Existing Leaves List -->
                <div class="card-glass" style="border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(15, 23, 42, 0.55); padding: 0.85rem 1rem;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.4rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 0.5rem;">
                        <span style="display: flex; align-items: center; gap: 0.4rem; font-weight: 700; font-size: 0.92rem; color: #f8fafc;">
                            <span>🗓️</span>
                            <span>${I18n.t('active_leaves_list') || 'فهرست مرخصی‌ها و روزهای آف ثبت‌شده'}</span>
                        </span>
                        <span class="badge" style="background: rgba(255, 255, 255, 0.1); color: #f8fafc; border: 1px solid rgba(255, 255, 255, 0.2); padding: 2px 9px; font-weight: 700; font-size: 0.75rem; border-radius: 9999px;">
                            ${leavesCountText}
                        </span>
                    </div>
                    ${leavesHtml}
                </div>
            </div>

            <div class="modal-actions" style="padding: 0.85rem 1.35rem; border-top: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: flex-end; background: rgba(15, 23, 42, 0.4);">
                <button type="button" class="btn btn-secondary" onclick="App.closeModal()" style="padding: 6px 18px; font-weight: 600; font-size: 0.84rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.16);">${I18n.t('close') || 'بستن'}</button>
            </div>
        `;

        App.openModal(modalHtml, 'modal-lg');
    },

    /**
     * Toggle calendar popover visibility for start or end.
     * @param {'start'|'end'} target
     * @param {Event} event
     */
    toggleCalendar(target, event) {
        if (event) event.stopPropagation();

        if (this._activeCalendarTarget === target) {
            this.closeAllCalendarPopovers();
            return;
        }

        this.closeAllCalendarPopovers();
        this._activeCalendarTarget = target;

        // Set calendar view month/year to target's selected month/year
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
        const popStart = document.getElementById('leave-calendar-popover-start');
        const popEnd = document.getElementById('leave-calendar-popover-end');
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

            // If end date is now before start date, advance end date to match start date
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

            // If start date is now after end date, pull start date back to match end date
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
     * Apply quick date range presets.
     * @param {'today'|'tomorrow'|'3days'|'weekend'|'week'} type
     */
    applyPreset(type) {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (type === 'today') {
            // Both start and end are today
        } else if (type === 'tomorrow') {
            startDate.setDate(startDate.getDate() + 1);
            endDate.setDate(endDate.getDate() + 1);
        } else if (type === '3days') {
            endDate.setDate(endDate.getDate() + 2);
        } else if (type === 'week') {
            endDate.setDate(endDate.getDate() + 6);
        } else if (type === 'weekend') {
            // In Iran, weekend starts Thursday (day 4) or Friday (day 5)
            // Distance to upcoming Thursday (day 4 in JS: 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat)
            const day = now.getDay();
            const daysUntilThu = (4 - day + 7) % 7;
            endDate.setDate(endDate.getDate() + (daysUntilThu === 0 ? 0 : daysUntilThu));
        }

        const sJ = I18n.toJalali(startDate);
        const eJ = I18n.toJalali(endDate);
        if (sJ && eJ) {
            this._startJy = sJ.jy;
            this._startJm = sJ.jm;
            this._startJd = sJ.jd;
            this._endJy = eJ.jy;
            this._endJm = eJ.jm;
            this._endJd = eJ.jd;
            this.closeAllCalendarPopovers();
            this._updateDateLabels();
        }
    },

    /**
     * Update Shamsi date labels and estimated duration on the DOM.
     */
    _updateDateLabels() {
        const startLbl = document.getElementById('leave-start-shamsi-label');
        const endLbl = document.getElementById('leave-end-shamsi-label');
        if (startLbl) startLbl.textContent = this.getShamsiDisplay('start');
        if (endLbl) endLbl.textContent = this.getShamsiDisplay('end');

        const durationInfo = document.getElementById('leave-calc-duration');
        if (durationInfo) {
            const days = this.getSelectedDurationDays();
            const isRtl = I18n.isRTL();
            durationInfo.textContent = days === 1
                ? (I18n.t('leave_one_day') || '۱ روز')
                : (I18n.t('leave_duration_days', { days: isRtl ? I18n.toPersianDigits(days) : days }) || `${days} روز`);
        }
    },

    /**
     * Render the Shamsi calendar popover grid HTML.
     * @param {'start'|'end'} target
     */
    renderCalendarPopover(target) {
        const popoverEl = document.getElementById(`leave-calendar-popover-${target}`);
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

        // Calculate starting weekday for day 1 of (viewJy, viewJm)
        const gFirst = I18n.jalaliToGregorian(viewJy, viewJm, 1);
        const dFirst = new Date(gFirst.gy, gFirst.gm - 1, gFirst.gd);
        const startCol = (dFirst.getDay() + 1) % 7; // 0 = Shanbeh (Sat), 6 = Jomeh (Fri)
        const totalDays = I18n.getJalaliDaysInMonth(viewJy, viewJm);

        const weekdays = isRtl
            ? ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']
            : ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'];

        let cellsHtml = '';
        // Empty offset slots
        for (let i = 0; i < startCol; i++) {
            cellsHtml += '<div class="cal-day-cell empty"></div>';
        }

        // Days of month
        for (let d = 1; d <= totalDays; d++) {
            const isSelected = (selJy === viewJy && selJm === viewJm && selJd === d);
            const isToday = nowJ && (nowJ.jy === viewJy && nowJ.jm === viewJm && nowJ.jd === d);
            const isFriday = ((startCol + d - 1) % 7 === 6);
            const dayNum = isRtl ? I18n.toPersianDigits(d) : d;

            cellsHtml += `
                <button 
                    type="button" 
                    class="cal-day-cell ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${isFriday ? 'friday' : ''}" 
                    onclick="event.stopPropagation(); SupervisorLeaveModal.selectCalendarDay('${target}', ${viewJy}, ${viewJm}, ${d});"
                >
                    ${dayNum}
                </button>
            `;
        }

        popoverEl.innerHTML = `
            <div class="cal-header">
                <button type="button" class="cal-nav-btn" onclick="event.stopPropagation(); SupervisorLeaveModal.changeCalendarMonth(${isRtl ? '1' : '-1'});" title="${isRtl ? 'ماه قبل' : 'Previous Month'}">
                    ${isRtl ? '▶' : '◀'}
                </button>
                <div class="cal-title">${monthName} ${yearDisp}</div>
                <button type="button" class="cal-today-btn" onclick="event.stopPropagation(); SupervisorLeaveModal.goToCalendarToday();">
                    ${I18n.t('preset_today') || 'امروز'}
                </button>
                <button type="button" class="cal-nav-btn" onclick="event.stopPropagation(); SupervisorLeaveModal.changeCalendarMonth(${isRtl ? '-1' : '1'});" title="${isRtl ? 'ماه بعد' : 'Next Month'}">
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

    /**
     * Fast Action: Apply single-day off duty for today.
     */
    async applyQuickOffToday() {
        const todayStr = new Date().toISOString().slice(0, 10);
        try {
            const res = await App.api(`/api/persons/${this._personId}/leaves`, 'POST', {
                start_date: todayStr,
                end_date: todayStr,
                leave_type: 'off_duty',
                note: I18n.t('quick_off_today_title') || 'ثبت فوری آف شیفت امروز',
            });
            this._leaves = Array.isArray(res) ? res : [];
            App.showToast(I18n.t('leave_saved') || 'آف شیفت امروز با موفقیت ثبت شد', 'success');
            this.render();
            if (typeof SupervisorCockpit !== 'undefined' && SupervisorCockpit.fetchData) {
                SupervisorCockpit.fetchData();
            }
        } catch (err) {
            console.error('Failed to set quick off:', err);
            App.showToast(err.message || 'خطا در ثبت آف شیفت', 'error');
        }
    },

    /**
     * Add new scheduled leave from the Shamsi calendar form.
     */
    async submitAdd(e) {
        if (e) e.preventDefault();
        const type = document.getElementById('leave-type-select').value;
        const sDate = this.getGregorianDate('start');
        const eDate = this.getGregorianDate('end');
        const note = (document.getElementById('leave-note').value || '').trim();

        if (!sDate || !eDate) {
            App.showToast(I18n.t('err_select_dates') || 'لطفاً تاریخ شروع و پایان را انتخاب نمایید.', 'warning');
            return;
        }

        if (eDate < sDate) {
            App.showToast(I18n.t('err_invalid_leave_dates') || 'تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.', 'warning');
            return;
        }

        const saveBtn = document.getElementById('btn-save-leave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.6';
        }

        try {
            const res = await App.api(`/api/persons/${this._personId}/leaves`, 'POST', {
                start_date: sDate,
                end_date: eDate,
                leave_type: type,
                note: note,
            });
            this._leaves = Array.isArray(res) ? res : [];
            App.showToast(I18n.t('leave_saved') || 'مرخصی با موفقیت ثبت شد', 'success');
            this.render();
            if (typeof SupervisorCockpit !== 'undefined' && SupervisorCockpit.fetchData) {
                SupervisorCockpit.fetchData();
            }
        } catch (err) {
            console.error('Failed to add leave:', err);
            App.showToast(err.message || 'خطا در ثبت مرخصی', 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
            }
        }
    },

    /**
     * Delete a scheduled leave by ID.
     * @param {string} leaveId
     */
    async deleteLeave(leaveId) {
        if (!confirm(I18n.t('confirm_delete_leave') || 'آیا از حذف این مرخصی / آف اطمینان دارید؟')) {
            return;
        }
        try {
            const res = await App.api(`/api/persons/${this._personId}/leaves/${leaveId}`, 'DELETE');
            this._leaves = Array.isArray(res) ? res : [];
            App.showToast(I18n.t('leave_deleted') || 'مرخصی با موفقیت حذف شد', 'success');
            this.render();
            if (typeof SupervisorCockpit !== 'undefined' && SupervisorCockpit.fetchData) {
                SupervisorCockpit.fetchData();
            }
        } catch (err) {
            console.error('Failed to delete leave:', err);
            App.showToast(err.message || 'خطا در حذف مرخصی', 'error');
        }
    },
};
