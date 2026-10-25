/**
 * SupervisorAnalyticsModal — Dedicated Zero-Photo Executive Analytics & Reporting
 * modal for supervisors to inspect shift compliance, attendance logs, station activity,
 * and export custom time-frame reports (.xlsx and .csv) for assigned personnel.
 */
const SupervisorAnalyticsModal = {
    _personId: null,
    _personName: '',
    _personSection: '',
    _personRole: '',
    _activePeriod: '30d', // 'today', '7d', '30d', 'custom'
    _customStartDate: '',
    _customEndDate: '',
    _data: null,
    _isLoading: false,

    // Shamsi start & end date components
    _startJy: null,
    _startJm: null,
    _startJd: null,
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
        return String(str).replace(/"/g, '&quot;');
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
        const sIso = this.getGregorianDate('start') || this._customStartDate;
        const eIso = this.getGregorianDate('end') || this._customEndDate;
        if (!sIso || !eIso) return 1;
        const sTime = new Date(sIso).getTime();
        const eTime = new Date(eIso).getTime();
        return Math.max(1, Math.round((eTime - sTime) / (1000 * 3600 * 24)) + 1);
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
        const popStart = document.getElementById('ana-calendar-popover-start');
        const popEnd = document.getElementById('ana-calendar-popover-end');
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
     * Update Shamsi date labels and estimated duration on the DOM.
     */
    _updateDateLabels() {
        const startLbl = document.getElementById('ana-start-shamsi-label');
        const endLbl = document.getElementById('ana-end-shamsi-label');
        if (startLbl) startLbl.textContent = this.getShamsiDisplay('start');
        if (endLbl) endLbl.textContent = this.getShamsiDisplay('end');

        const durEl = document.getElementById('ana-calc-duration');
        if (durEl) {
            const days = this.getSelectedDurationDays();
            const isRtl = I18n.isRTL();
            durEl.textContent = `${isRtl ? I18n.toPersianDigits(days) : days} ${isRtl ? 'روز پایش' : 'days analyzed'}`;
        }
    },

    /**
     * Render the Shamsi calendar popover grid HTML.
     * @param {'start'|'end'} target
     */
    renderCalendarPopover(target) {
        const popoverEl = document.getElementById(`ana-calendar-popover-${target}`);
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
                    onclick="event.stopPropagation(); SupervisorAnalyticsModal.selectCalendarDay('${target}', ${viewJy}, ${viewJm}, ${d});"
                >
                    ${dayNum}
                </button>
            `;
        }

        popoverEl.innerHTML = `
            <div class="cal-header">
                <button type="button" class="cal-nav-btn" onclick="event.stopPropagation(); SupervisorAnalyticsModal.changeCalendarMonth(${isRtl ? '1' : '-1'});" title="${isRtl ? 'ماه قبل' : 'Previous Month'}">
                    ${isRtl ? '▶' : '◀'}
                </button>
                <div class="cal-title">${monthName} ${yearDisp}</div>
                <button type="button" class="cal-today-btn" onclick="event.stopPropagation(); SupervisorAnalyticsModal.goToCalendarToday();">
                    ${I18n.t('preset_today') || 'امروز'}
                </button>
                <button type="button" class="cal-nav-btn" onclick="event.stopPropagation(); SupervisorAnalyticsModal.changeCalendarMonth(${isRtl ? '-1' : '1'});" title="${isRtl ? 'ماه بعد' : 'Next Month'}">
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
            const popStart = document.getElementById('ana-calendar-popover-start');
            const popEnd = document.getElementById('ana-calendar-popover-end');
            const isInsidePopStart = popStart && popStart.contains(e.target);
            const isInsidePopEnd = popEnd && popEnd.contains(e.target);
            const isInsideBtn = e.target.closest && e.target.closest('.shamsi-date-btn');
            if (!isInsidePopStart && !isInsidePopEnd && !isInsideBtn) {
                this.closeAllCalendarPopovers();
            }
        });
    },

    getAvatarGradient(name) {
        const palettes = [
            'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
            'linear-gradient(135deg, #059669 0%, #10b981 100%)',
            'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
            'linear-gradient(135deg, #db2777 0%, #f43f5e 100%)',
            'linear-gradient(135deg, #9333ea 0%, #c084fc 100%)',
            'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
            'linear-gradient(135deg, #c2410c 0%, #ea580c 100%)',
        ];
        let hash = 0;
        const str = String(name || 'Staff');
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return palettes[Math.abs(hash) % palettes.length];
    },

    /**
     * Open Analytics Modal for a given person.
     * @param {number} personId
     * @param {string} personName
     * @param {string} section
     * @param {string} role
     */
    async show(personId, personName = '', section = '', role = '') {
        this._personId = personId;
        this._personName = personName || `Person #${personId}`;
        this._personSection = section || '';
        this._personRole = role || '';
        this._activePeriod = '30d';

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
        this._activeCalendarTarget = null;
        this._data = null;

        const isRtl = I18n.isRTL();
        const initial = (this._personName.trim().charAt(0) || '👤').toUpperCase();
        const avatarGrad = this.getAvatarGradient(this._personName);

        // Open loading state
        App.openModal(`
            <div class="modal-header" style="border-bottom: 1px solid var(--border-subtle); padding: 1.15rem 1.5rem;">
                <div style="display: flex; align-items: center; gap: 0.85rem;">
                    <div style="width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.2rem; color: #fff; background: ${avatarGrad}; box-shadow: 0 4px 12px rgba(0,0,0,0.25);">
                        ${initial}
                    </div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <h2 class="modal-title" style="margin: 0; font-size: 1.25rem;">${this.escapeHtml(this._personName)}</h2>
                            <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); font-size: 0.72rem;">📊 تحلیل و گزارش</span>
                        </div>
                        <p class="modal-subtitle" style="margin: 2px 0 0; color: var(--text-secondary); font-size: 0.82rem;">
                            ${isRtl ? 'در حال دریافت اطلاعات جامع حضور و عملکرد...' : 'Loading comprehensive analytics...'}
                        </p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 3rem 1.5rem; text-align: center;">
                <div class="spinner-border text-primary mb-3" style="width: 2.5rem; height: 2.5rem;"></div>
                <div style="color: var(--text-secondary); font-weight: 500;">
                    ${isRtl ? 'در حال پردازش داده‌های تردد و انضباط شیفت پرسنل...' : 'Processing shift attendance data...'}
                </div>
            </div>
        `, 'modal-analytics modal-xl');

        await this.loadData();
    },

    /**
     * Switch time frame preset.
     * @param {'today'|'7d'|'30d'|'custom'} period
     */
    async setPeriod(period) {
        if (this._activePeriod === period && period !== 'custom') return;
        this._activePeriod = period;

        const now = new Date();
        if (period === 'today') {
            this._customStartDate = now.toISOString().slice(0, 10);
            this._customEndDate = now.toISOString().slice(0, 10);
            const j = I18n.toJalali(now);
            if (j) {
                this._startJy = this._endJy = j.jy;
                this._startJm = this._endJm = j.jm;
                this._startJd = this._endJd = j.jd;
            }
        } else if (period === '7d') {
            const past7 = new Date();
            past7.setDate(now.getDate() - 6);
            this._customStartDate = past7.toISOString().slice(0, 10);
            this._customEndDate = now.toISOString().slice(0, 10);
            const sJ = I18n.toJalali(past7);
            const eJ = I18n.toJalali(now);
            if (sJ && eJ) {
                this._startJy = sJ.jy; this._startJm = sJ.jm; this._startJd = sJ.jd;
                this._endJy = eJ.jy; this._endJm = eJ.jm; this._endJd = eJ.jd;
            }
        } else if (period === '30d') {
            const past30 = new Date();
            past30.setDate(now.getDate() - 29);
            this._customStartDate = past30.toISOString().slice(0, 10);
            this._customEndDate = now.toISOString().slice(0, 10);
            const sJ = I18n.toJalali(past30);
            const eJ = I18n.toJalali(now);
            if (sJ && eJ) {
                this._startJy = sJ.jy; this._startJm = sJ.jm; this._startJd = sJ.jd;
                this._endJy = eJ.jy; this._endJm = eJ.jm; this._endJd = eJ.jd;
            }
        }

        if (period === 'custom') {
            const form = document.getElementById('sup-ana-custom-form');
            if (form) {
                const isCurrentlyHidden = (form.style.display === 'none' || !form.style.display);
                form.style.display = isCurrentlyHidden ? 'flex' : 'none';
                if (form.style.display !== 'none') {
                    this._updateDateLabels();
                }
            }
            return;
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
     * Fetch analytics from API according to the active time frame.
     */
    async loadData() {
        if (this._isLoading) return;
        this._isLoading = true;

        const bodyEl = document.getElementById('sup-ana-body-container');
        if (bodyEl) {
            bodyEl.style.opacity = '0.5';
            bodyEl.style.pointerEvents = 'none';
        }

        let query = '';
        if (this._activePeriod === 'today') {
            query = '?days=1';
        } else if (this._activePeriod === '7d') {
            query = '?days=7';
        } else if (this._activePeriod === '30d') {
            query = '?days=30';
        } else if (this._activePeriod === 'custom') {
            query = `?start_date=${encodeURIComponent(this._customStartDate)}&end_date=${encodeURIComponent(this._customEndDate)}`;
        }

        try {
            const res = await App.api(`/api/persons/${this._personId}/analytics${query}`);
            this._data = res;
            this.render();
        } catch (err) {
            console.error('Failed to load person analytics:', err);
            App.showToast(err.message || 'خطا در دریافت اطلاعات تحلیلی', 'error');
        } finally {
            this._isLoading = false;
        }
    },

    /**
     * Export analytics report as Excel (.xlsx) or CSV.
     * @param {'xlsx'|'csv'} format
     */
    async exportReport(format = 'xlsx') {
        const isRtl = I18n.isRTL();
        let queryParams = `format=${format}`;

        if (this._activePeriod === 'today') {
            queryParams += '&days=1';
        } else if (this._activePeriod === '7d') {
            queryParams += '&days=7';
        } else if (this._activePeriod === '30d') {
            queryParams += '&days=30';
        } else if (this._activePeriod === 'custom') {
            queryParams += `&start_date=${encodeURIComponent(this._customStartDate)}&end_date=${encodeURIComponent(this._customEndDate)}`;
        }

        const btn = document.getElementById(`sup-export-btn-${format}`);
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.7';
        }

        App.showToast(isRtl ? 'در حال تولید و دریافت فایل گزارش...' : 'Generating and downloading report...', 'info');

        try {
            const token = (typeof Auth !== 'undefined' && Auth.getToken()) || localStorage.getItem('token') || '';
            const url = `/api/persons/${this._personId}/analytics/export?${queryParams}&token=${encodeURIComponent(token)}`;

            const response = await fetch(url, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(errJson.detail || (isRtl ? 'خطا در دریافت فایل خروجی' : 'Export failed'));
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = downloadUrl;

            // Generate clean human-readable filename
            const sDate = this._customStartDate || 'start';
            const eDate = this._customEndDate || 'end';
            const safeName = (this._personName || 'person').replace(/\s+/g, '_');
            a.download = `report_${safeName}_${this._activePeriod}_${format}.${format}`;

            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            a.remove();

            App.showToast(
                isRtl 
                    ? `گزارش ${format === 'xlsx' ? 'اکسل (.xlsx)' : 'متنی (.csv)'} با موفقیت دریافت شد.` 
                    : `Report (${format.toUpperCase()}) exported successfully.`,
                'success'
            );
        } catch (err) {
            console.error('Failed to export analytics report:', err);
            App.showToast(err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    },

    /**
     * Render the complete modal with executive Zero-Photo UI.
     */
    render() {
        const d = this._data;
        if (!d) return;

        const isRtl = I18n.isRTL();
        const p = d.summary || {};
        const comp = d.shift_compliance || {};
        const cams = d.camera_distribution || [];
        const dailyList = d.daily_activity_last_14_days || [];
        const alerts = d.alerts || {};

        const initial = (d.name || this._personName || 'P').trim().charAt(0).toUpperCase();
        const avatarGrad = this.getAvatarGradient(d.name || this._personName);

        // Status badge config
        let statusBadge = '';
        if (p.current_status === 'present') {
            statusBadge = `<span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.35); font-weight: 700;">🟢 ${isRtl ? 'حاضر در ایستگاه' : 'Present'}</span>`;
        } else if (p.current_status === 'on_break') {
            statusBadge = `<span class="badge" style="background: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.35); font-weight: 700;">☕ ${isRtl ? 'زمان استراحت' : 'On Break'}</span>`;
        } else if (p.current_status === 'absent') {
            statusBadge = `<span class="badge" style="background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.35); font-weight: 700;">🔴 ${isRtl ? 'غیبت در شیفت' : 'Absent'}</span>`;
        } else {
            statusBadge = `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.35); font-weight: 700;">⚪ ${isRtl ? 'خارج از شیفت' : 'Off-Duty'}</span>`;
        }

        // Period title & description
        let periodDesc = '';
        if (this._activePeriod === 'today') {
            periodDesc = isRtl ? 'گزارش امروز' : 'Today (Last 24 Hours)';
        } else if (this._activePeriod === '7d') {
            periodDesc = isRtl ? 'گزارش ۷ روز اخیر' : 'Last 7 Days';
        } else if (this._activePeriod === '30d') {
            periodDesc = isRtl ? 'گزارش ۳۰ روز اخیر' : 'Last 30 Days';
        } else {
            const sShamsi = I18n.formatDate ? I18n.formatDate(this._customStartDate) : this._customStartDate;
            const eShamsi = I18n.formatDate ? I18n.formatDate(this._customEndDate) : this._customEndDate;
            periodDesc = isRtl ? `بازه دلخواه: از ${sShamsi} تا ${eShamsi}` : `Custom: ${this._customStartDate} to ${this._customEndDate}`;
        }

        // Compliance rate
        const compRate = comp.compliance_rate ?? 100;
        let compColor = '#4ade80';
        let compBg = 'rgba(34, 197, 94, 0.15)';
        if (compRate < 70) {
            compColor = '#f87171';
            compBg = 'rgba(239, 68, 68, 0.15)';
        } else if (compRate < 85) {
            compColor = '#fbbf24';
            compBg = 'rgba(251, 191, 36, 0.15)';
        }

        // Total presence hours formatted
        const totPresSecs = dailyList.reduce((acc, curr) => acc + (curr.estimated_duration_seconds || 0), 0);
        const presHours = Math.floor(totPresSecs / 3600);
        const presMins = Math.floor((totPresSecs % 3600) / 60);
        const presStr = presHours > 0 
            ? (isRtl ? `${I18n.toPersianDigits(presHours)} ساعت و ${I18n.toPersianDigits(presMins)} دقیقه` : `${presHours}h ${presMins}m`)
            : (isRtl ? `${I18n.toPersianDigits(presMins)} دقیقه` : `${presMins}m`);

        // Total absence string
        const totAbsMins = comp.total_absence_minutes || 0;
        const absHours = Math.floor(totAbsMins / 60);
        const remAbsMins = totAbsMins % 60;
        const absStr = absHours > 0 
            ? (isRtl ? `${I18n.toPersianDigits(absHours)} ساعت و ${I18n.toPersianDigits(remAbsMins)} دقیقه` : `${absHours}h ${remAbsMins}m`)
            : (isRtl ? `${I18n.toPersianDigits(totAbsMins)} دقیقه` : `${totAbsMins}m`);

        // Scheduled vs Present days
        const schedDays = comp.scheduled_shift_days || 0;
        const presDays = comp.present_shift_days || 0;
        const absDays = comp.absent_shift_days || 0;

        // Punctuality
        const totalDelay = comp.total_delay_minutes || 0;
        const lateArrivals = comp.late_arrivals || 0;
        const totalEarly = comp.total_early_minutes || 0;
        const earlyLeaves = comp.early_departures || 0;
        const totAlerts = alerts.total_alerts || 0;

        const content = `
            <!-- Modal Header with Privacy Avatar & Person Badge -->
            <div class="modal-header" style="border-bottom: 1px solid var(--border-subtle); padding: 1.15rem 1.5rem; background: var(--bg-surface-hover); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
                <div style="display: flex; align-items: center; gap: 0.85rem;">
                    <div style="width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.3rem; color: #fff; background: ${avatarGrad}; box-shadow: 0 4px 14px rgba(0,0,0,0.35); flex-shrink: 0;">
                        ${initial}
                    </div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                            <h2 class="modal-title" style="margin: 0; font-size: 1.3rem;">${this.escapeHtml(d.name || this._personName)}</h2>
                            ${statusBadge}
                            ${d.section ? `<span class="badge badge-subtle" style="font-size: 0.72rem; padding: 3px 8px;">🏢 ${this.escapeHtml(d.section)}</span>` : ''}
                            ${d.role ? `<span class="badge badge-subtle" style="font-size: 0.72rem; padding: 3px 8px;">🏷️ ${this.escapeHtml(d.role)}</span>` : ''}
                        </div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 3px; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                            <span>🗓️ ${this.escapeHtml(periodDesc)}</span>
                            <span>•</span>
                            <span>📅 ${isRtl ? 'تعداد روزهای مورد پایش:' : 'Days analyzed:'} <strong>${isRtl ? I18n.toPersianDigits(dailyList.length) : dailyList.length} ${isRtl ? 'روز' : 'days'}</strong></span>
                        </div>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 0.6rem;">
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="SupervisorAnalyticsModal.loadData()" title="${isRtl ? 'تازه‌سازی داده‌ها' : 'Refresh'}">
                        🔄 ${isRtl ? 'بروزرسانی' : 'Refresh'}
                    </button>
                    <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
                </div>
            </div>

            <div class="modal-body" id="sup-ana-body-container" style="padding: 1.5rem; transition: opacity 0.2s;">
                <!-- Time Frame Controls & Export Toolbar -->
                <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem 1.25rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                    <!-- Filter Pills -->
                    <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                        <span style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); margin-inline-end: 0.35rem;">
                            🕒 ${isRtl ? 'بازه زمانی:' : 'Time Frame:'}
                        </span>
                        <button type="button" class="btn btn-sm ${this._activePeriod === 'today' ? 'btn-primary' : 'btn-ghost'}" onclick="SupervisorAnalyticsModal.setPeriod('today')" style="padding: 4px 12px; font-size: 0.8rem; border-radius: var(--radius-full);">
                            ${isRtl ? 'امروز' : 'Today'}
                        </button>
                        <button type="button" class="btn btn-sm ${this._activePeriod === '7d' ? 'btn-primary' : 'btn-ghost'}" onclick="SupervisorAnalyticsModal.setPeriod('7d')" style="padding: 4px 12px; font-size: 0.8rem; border-radius: var(--radius-full);">
                            ${isRtl ? '۷ روز اخیر' : 'Last 7 Days'}
                        </button>
                        <button type="button" class="btn btn-sm ${this._activePeriod === '30d' ? 'btn-primary' : 'btn-ghost'}" onclick="SupervisorAnalyticsModal.setPeriod('30d')" style="padding: 4px 12px; font-size: 0.8rem; border-radius: var(--radius-full);">
                            ${isRtl ? '۳۰ روز اخیر' : 'Last 30 Days'}
                        </button>
                        <button type="button" class="btn btn-sm ${this._activePeriod === 'custom' ? 'btn-primary' : 'btn-ghost'}" onclick="SupervisorAnalyticsModal.setPeriod('custom')" style="padding: 4px 12px; font-size: 0.8rem; border-radius: var(--radius-full);">
                            📅 ${isRtl ? 'بازه دلخواه' : 'Custom'}
                        </button>
                    </div>

                    <!-- Report Export Actions -->
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-inline-start: auto;">
                        <button type="button" id="sup-export-btn-xlsx" class="btn btn-sm" onclick="SupervisorAnalyticsModal.exportReport('xlsx')" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #fff; font-weight: 700; padding: 6px 14px; border: none; border-radius: var(--radius-sm); box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);">
                            <span>📥</span>
                            <span>${isRtl ? 'گزارش اکسل (.xlsx)' : 'Export Excel'}</span>
                        </button>
                        <button type="button" id="sup-export-btn-csv" class="btn btn-sm" onclick="SupervisorAnalyticsModal.exportReport('csv')" style="background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%); color: #fff; font-weight: 700; padding: 6px 14px; border: none; border-radius: var(--radius-sm); box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);">
                            <span>📄</span>
                            <span>${isRtl ? 'گزارش متنی (CSV)' : 'Export CSV'}</span>
                        </button>
                    </div>
                </div>

                <!-- Custom Shamsi Date Range Form (shown if activePeriod is custom) -->
                <div id="sup-ana-custom-form" style="display: ${this._activePeriod === 'custom' ? 'flex' : 'none'}; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: var(--radius-md); padding: 1rem 1.25rem; margin-bottom: 1.5rem; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">
                    <div style="display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; flex: 1;">
                        <!-- Shamsi Start Date Picker -->
                        <div style="position: relative; min-width: 240px; flex: 1;">
                            <label style="display: block; font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px;">
                                📅 ${isRtl ? 'از تاریخ (تقویم شمسی):' : 'From Date (Shamsi):'}
                            </label>
                            <button type="button" class="btn btn-secondary w-100 shamsi-date-btn" onclick="SupervisorAnalyticsModal.toggleCalendar('start', event)" style="height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.75rem; border: 1px solid var(--border-medium); background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 0.82rem;">
                                <div style="display: flex; align-items: center; gap: 0.45rem;">
                                    <span>📅</span>
                                    <span id="ana-start-shamsi-label" style="font-weight: 700; color: var(--text-primary);">${this.getShamsiDisplay('start')}</span>
                                </div>
                                <span style="font-size: 0.7rem; color: var(--text-tertiary);">▾</span>
                            </button>
                            <div id="ana-calendar-popover-start" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-start: 0; z-index: 1200; width: 285px;"></div>
                        </div>

                        <!-- Shamsi End Date Picker -->
                        <div style="position: relative; min-width: 240px; flex: 1;">
                            <label style="display: block; font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px;">
                                📅 ${isRtl ? 'تا تاریخ (تقویم شمسی):' : 'To Date (Shamsi):'}
                            </label>
                            <button type="button" class="btn btn-secondary w-100 shamsi-date-btn" onclick="SupervisorAnalyticsModal.toggleCalendar('end', event)" style="height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.75rem; border: 1px solid var(--border-medium); background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 0.82rem;">
                                <div style="display: flex; align-items: center; gap: 0.45rem;">
                                    <span>📅</span>
                                    <span id="ana-end-shamsi-label" style="font-weight: 700; color: var(--text-primary);">${this.getShamsiDisplay('end')}</span>
                                </div>
                                <span style="font-size: 0.7rem; color: var(--text-tertiary);">▾</span>
                            </button>
                            <div id="ana-calendar-popover-end" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-start: 0; z-index: 1200; width: 285px;"></div>
                        </div>

                        <!-- Range duration indicator -->
                        <div style="display: flex; align-items: center; gap: 0.4rem; padding-top: 1.1rem; color: var(--accent-blue); font-size: 0.82rem; font-weight: 600;">
                            <span>⏱️</span>
                            <span id="ana-calc-duration">${isRtl ? `${I18n.toPersianDigits(this.getSelectedDurationDays())} روز پایش` : `${this.getSelectedDurationDays()} days analyzed`}</span>
                        </div>
                    </div>

                    <div style="padding-top: 1.1rem;">
                        <button type="button" class="btn btn-primary btn-sm" onclick="SupervisorAnalyticsModal.applyCustomRange()" style="height: 38px; padding: 0 1.25rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem; border-radius: var(--radius-sm); box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);">
                            <span>✓</span>
                            <span>${isRtl ? 'اعمال بازه زمانی' : 'Apply Range'}</span>
                        </button>
                    </div>
                </div>

                <!-- 7 KPI Metric Cards Grid -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <!-- 1. Compliance Rate -->
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; border-inline-start: 4px solid ${compColor};">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            <span>📊 ${isRtl ? 'نرخ انطباق شیفت' : 'Compliance Rate'}</span>
                            <span class="badge" style="background: ${compBg}; color: ${compColor}; font-size: 0.7rem;">${compRate}%</span>
                        </div>
                        <div style="font-size: 1.4rem; font-weight: 800; color: ${compColor}; margin-bottom: 0.35rem;">
                            ${isRtl ? I18n.toPersianDigits(compRate) : compRate}%
                        </div>
                        <div style="background: rgba(255,255,255,0.06); height: 6px; border-radius: 999px; overflow: hidden;">
                            <div style="width: ${compRate}%; height: 100%; background: ${compColor};"></div>
                        </div>
                    </div>

                    <!-- 2. Total Presence Hours -->
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; border-inline-start: 4px solid #38bdf8;">
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            ⏱️ ${isRtl ? 'مجموع ساعات حضور' : 'Total Presence'}
                        </div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #38bdf8; margin-bottom: 0.2rem;">
                            ${presStr}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-tertiary);">
                            ${isRtl ? 'حضور ثبت‌شده در بازه انتخابی' : 'Total on-station duration'}
                        </div>
                    </div>

                    <!-- 3. Total Absence Hours -->
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; border-inline-start: 4px solid #f87171;">
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            🔴 ${isRtl ? 'مجموع زمان غیبت' : 'Total Absence'}
                        </div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: ${totAbsMins > 0 ? '#f87171' : '#4ade80'}; margin-bottom: 0.2rem;">
                            ${absStr}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-tertiary);">
                            ${isRtl ? 'کسر از ساعات موظفی شیفت' : 'Missing from shift time'}
                        </div>
                    </div>

                    <!-- 4. Present vs Scheduled Days -->
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; border-inline-start: 4px solid #c084fc;">
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            📅 ${isRtl ? 'حضور در روزهای شیفت' : 'Shift Days Attendance'}
                        </div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #c084fc; margin-bottom: 0.2rem;">
                            ${isRtl ? `${I18n.toPersianDigits(presDays)} از ${I18n.toPersianDigits(schedDays)} روز` : `${presDays} of ${schedDays} days`}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-tertiary);">
                            ${absDays > 0 ? (isRtl ? `⚠️ ${I18n.toPersianDigits(absDays)} روز غیبت کامل` : `${absDays} days absent`) : (isRtl ? '✓ بدون غیبت کامل روزانه' : 'Zero full-day absence')}
                        </div>
                    </div>

                    <!-- 5. Late Arrivals -->
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; border-inline-start: 4px solid #fbbf24;">
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            ⏳ ${isRtl ? 'تأخیر در ورود' : 'Arrival Delays'}
                        </div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #fbbf24; margin-bottom: 0.2rem;">
                            ${isRtl ? `${I18n.toPersianDigits(totalDelay)} دقیقه` : `${totalDelay} mins`}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-tertiary);">
                            ${isRtl ? `در ${I18n.toPersianDigits(lateArrivals)} نوبت شیفت` : `in ${lateArrivals} shifts`}
                        </div>
                    </div>

                    <!-- 6. Early Departures -->
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; border-inline-start: 4px solid #f97316;">
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            🚪 ${isRtl ? 'تعجیل در خروج' : 'Early Departures'}
                        </div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #f97316; margin-bottom: 0.2rem;">
                            ${isRtl ? `${I18n.toPersianDigits(totalEarly)} دقیقه` : `${totalEarly} mins`}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-tertiary);">
                            ${isRtl ? `در ${I18n.toPersianDigits(earlyLeaves)} نوبت شیفت` : `in ${earlyLeaves} shifts`}
                        </div>
                    </div>

                    <!-- 7. Security Alerts -->
                    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; border-inline-start: 4px solid ${totAlerts > 0 ? '#f87171' : '#22c55e'};">
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                            🚨 ${isRtl ? 'هشدارهای ثبت‌شده' : 'Security Alerts'}
                        </div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: ${totAlerts > 0 ? '#f87171' : '#22c55e'}; margin-bottom: 0.2rem;">
                            ${isRtl ? `${I18n.toPersianDigits(totAlerts)} مورد` : `${totAlerts} alerts`}
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-tertiary);">
                            ${totAlerts > 0 ? (isRtl ? 'عدم حضور یا خروج ایستگاه' : 'Violation alerts') : (isRtl ? '✓ عملکرد بدون هشدار' : 'Clean record')}
                        </div>
                    </div>
                </div>

                <!-- Station / Camera Distribution Section -->
                ${cams.length > 0 ? `
                <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.5rem;">
                    <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                        <span>📍</span>
                        <span>${isRtl ? 'توزیع فعالیت در ایستگاه‌ها و دوربین‌ها (در این بازه)' : 'Workstation & Camera Activity Breakdown'}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.85rem;">
                        ${cams.map(c => `
                            <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.75rem 1rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem;">
                                    <span style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">📹 ${this.escapeHtml(c.camera_name)}</span>
                                    <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent-blue);">${isRtl ? I18n.toPersianDigits(c.percentage) : c.percentage}%</span>
                                </div>
                                <div style="background: rgba(255,255,255,0.06); height: 6px; border-radius: 999px; overflow: hidden; margin-bottom: 0.25rem;">
                                    <div style="width: ${c.percentage}%; height: 100%; background: var(--gradient-primary); border-radius: 999px;"></div>
                                </div>
                                <div style="font-size: 0.72rem; color: var(--text-secondary); text-align: end;">
                                    ${isRtl ? I18n.toPersianDigits(c.count) : c.count} ${isRtl ? 'بار تردد' : 'detections'}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}

                <!-- Daily Shift Attendance & Punctuality Log Table -->
                <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.25rem; overflow: hidden;">
                    <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span>📋</span>
                            <span>${isRtl ? 'ریز سوابق حضور، تردد و وضعیت انضباط شیفت روزانه' : 'Daily Shift Attendance & Compliance Log'}</span>
                        </div>
                        <span class="badge badge-subtle text-xs" style="font-size: 0.72rem;">
                            ${isRtl ? `${I18n.toPersianDigits(dailyList.length)} روز ثبت‌شده` : `${dailyList.length} recorded days`}
                        </span>
                    </div>

                    ${dailyList.length === 0 ? `
                        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary);">
                            <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">📭</span>
                            <span>${isRtl ? 'هیچ رکوردی در این بازه زمانی یافت نشد.' : 'No attendance records found for this period.'}</span>
                        </div>
                    ` : `
                        <div style="overflow-x: auto;">
                            <table style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.82rem; text-align: start;">
                                <thead>
                                    <tr style="background: var(--bg-surface-hover); color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle);">
                                        <th style="padding: 10px 12px; border-radius: 4px 0 0 4px;">#</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'تاریخ و روز' : 'Date & Day'}</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'بازه شیفت' : 'Shift Window'}</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'ورود' : 'Arrival'}</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'خروج' : 'Departure'}</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'مدت حضور' : 'Presence'}</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'مدت غیبت' : 'Absence'}</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'وضعیت روز' : 'Status'}</th>
                                        <th style="padding: 10px 12px;">${isRtl ? 'ایستگاه اصلی' : 'Station'}</th>
                                        <th style="padding: 10px 12px; border-radius: 0 4px 4px 0;">${isRtl ? 'تردد / هشدار' : 'Detections / Alerts'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${dailyList.map((day, idx) => {
                                        const isSched = day.is_scheduled_shift_day;
                                        const sStart = day.shift_start_time;
                                        const sEnd = day.shift_end_time;
                                        const shiftStr = (sStart && sEnd) ? `${sStart} - ${sEnd}` : (isSched ? 'تعریف نشده' : (isRtl ? 'استراحت / آف' : 'Off-Duty'));

                                        let statusBadgeRow = '';
                                        const arrStat = day.arrival_status || '';
                                        if (arrStat === 'on_time' || arrStat === 'normal') {
                                            statusBadgeRow = `<span class="badge" style="background: rgba(34, 197, 94, 0.12); color: #4ade80; font-size: 0.72rem; padding: 2px 7px;">🟢 ${isRtl ? 'به‌موقع' : 'On Time'}</span>`;
                                        } else if (arrStat === 'late') {
                                            statusBadgeRow = `<span class="badge" style="background: rgba(251, 191, 36, 0.15); color: #fbbf24; font-size: 0.72rem; padding: 2px 7px;">⚠️ ${isRtl ? `${I18n.toPersianDigits(day.delay_minutes || 0)}د تأخیر` : `${day.delay_minutes}m late`}</span>`;
                                        } else if (arrStat === 'absent') {
                                            statusBadgeRow = `<span class="badge" style="background: rgba(248, 113, 113, 0.15); color: #f87171; font-size: 0.72rem; padding: 2px 7px;">🔴 ${isRtl ? 'غایب شیفت' : 'Absent'}</span>`;
                                        } else if (arrStat === 'camera_offline') {
                                            statusBadgeRow = `<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #facc15; font-size: 0.72rem; padding: 2px 7px;">🟡 ${isRtl ? 'دوربین قطع' : 'Offline'}</span>`;
                                        } else {
                                            statusBadgeRow = `<span class="badge" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; font-size: 0.72rem; padding: 2px 7px;">⚪ ${isRtl ? 'روز تعطیل' : 'Rest'}</span>`;
                                        }

                                        const fSeen = day.first_seen_time || '—';
                                        const lSeen = day.last_seen_time || '—';
                                        const durStr = day.estimated_duration_str || '—';
                                        const absStr = day.absence_from_shift_str || '۰m';
                                        const detCnt = day.detections_count || 0;
                                        const altCnt = day.alerts_count || 0;

                                        // Format date to Shamsi if available
                                        let dateDisp = day.date;
                                        if (typeof I18n.formatDate === 'function') {
                                            dateDisp = I18n.formatDate(day.date);
                                        }

                                        return `
                                            <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;" onmouseover="this.style.background='var(--bg-surface-hover)'" onmouseout="this.style.background='transparent'">
                                                <td style="padding: 9px 12px; color: var(--text-tertiary);">${isRtl ? I18n.toPersianDigits(idx + 1) : (idx + 1)}</td>
                                                <td style="padding: 9px 12px;">
                                                    <strong style="color: var(--text-primary);">${dateDisp}</strong>
                                                    <small class="text-muted d-block text-xs" style="font-size: 0.72rem;">${this.escapeHtml(day.day_name || '')}</small>
                                                </td>
                                                <td style="padding: 9px 12px; direction: ltr; font-family: monospace; font-size: 0.8rem; color: var(--text-secondary); text-align: start;">
                                                    ${this.escapeHtml(shiftStr)}
                                                </td>
                                                <td style="padding: 9px 12px; font-weight: 600; color: var(--text-primary); direction: ltr; text-align: start;">
                                                    ${isRtl ? I18n.toPersianDigits(fSeen) : fSeen}
                                                </td>
                                                <td style="padding: 9px 12px; font-weight: 600; color: var(--text-primary); direction: ltr; text-align: start;">
                                                    ${isRtl ? I18n.toPersianDigits(lSeen) : lSeen}
                                                </td>
                                                <td style="padding: 9px 12px; color: var(--accent-blue); font-weight: 600;">
                                                    ${isRtl ? I18n.toPersianDigits(durStr) : durStr}
                                                </td>
                                                <td style="padding: 9px 12px; color: ${day.absence_from_shift_minutes > 0 ? '#f87171' : 'var(--text-tertiary)'}; font-weight: 600;">
                                                    ${isRtl ? I18n.toPersianDigits(absStr) : absStr}
                                                </td>
                                                <td style="padding: 9px 12px;">
                                                    ${statusBadgeRow}
                                                </td>
                                                <td style="padding: 9px 12px; color: var(--text-secondary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                    ${this.escapeHtml(day.primary_camera || '—')}
                                                </td>
                                                <td style="padding: 9px 12px;">
                                                    <span style="font-weight: 700; color: var(--text-primary);">${isRtl ? I18n.toPersianDigits(detCnt) : detCnt}</span>
                                                    ${altCnt > 0 ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; font-size: 0.68rem; margin-inline-start: 4px;">⚠️ ${isRtl ? I18n.toPersianDigits(altCnt) : altCnt}</span>` : ''}
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}
                </div>
            </div>

            <!-- Modal Footer with Quick Export & Close Buttons -->
            <div class="modal-footer" style="border-top: 1px solid var(--border-subtle); padding: 1rem 1.5rem; background: var(--bg-surface-hover); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.8rem;">
                <div style="font-size: 0.78rem; color: var(--text-tertiary);">
                    🔒 ${isRtl ? 'حفظ حریم خصوصی: تصاویر چهره و فید دوربین‌ها برای سرپرستان غیرقابل‌مشاهده است.' : 'Zero-Photo Privacy enforced: Facial snapshots & streams are hidden.'}
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <button type="button" class="btn btn-secondary" onclick="App.closeModal()">
                        ${isRtl ? 'بستن' : 'Close'}
                    </button>
                </div>
            </div>
        `;

        App.openModal(content, 'modal-analytics modal-xl');
    },
};
