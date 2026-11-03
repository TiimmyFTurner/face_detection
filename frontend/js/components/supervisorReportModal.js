/**
 * SupervisorReportModal — Dedicated modal for supervisors to export
 * comprehensive daily attendance reports as styled Excel (.xlsx) spreadsheets.
 * 
 * Features:
 * - Scoped strictly to the supervisor's assigned sections and personnel
 * - Dual Shamsi (Jalali) & Gregorian date selection with dynamic active shortcuts (Today, Yesterday)
 * - Interactive Solar Hijri calendar popover with localized digits and RTL layout
 * - Dynamic Section & Personnel filtering with clean count indicators
 * - Direct Excel download with live loading feedback
 * - Fully responsive on both mobile and desktop
 */
const SupervisorReportModal = {
    _jy: null,
    _jm: null,
    _jd: null,
    _calendarViewJy: null,
    _calendarViewJm: null,
    _isCalendarOpen: false,
    _selectedSection: 'all',
    _selectedPersonId: 'all',
    _isDownloading: false,
    _selectedQuickOffset: 0, // 0 = today, -1 = yesterday, null = custom date

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

    getGregorianDate() {
        if (!this._jy || !this._jm || !this._jd) {
            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        }
        const g = I18n.jalaliToGregorian(this._jy, this._jm, this._jd);
        const pad = n => String(n).padStart(2, '0');
        return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
    },

    getShamsiDisplay() {
        if (!this._jy || !this._jm || !this._jd) return '---';
        const months = [
            'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
            'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
        ];
        const isRtl = (typeof I18n !== 'undefined' && typeof I18n.isRtl === 'function') ? I18n.isRtl() : true;
        const dStr = isRtl && typeof I18n.toPersianDigits === 'function' ? I18n.toPersianDigits(this._jd) : this._jd;
        const yStr = isRtl && typeof I18n.toPersianDigits === 'function' ? I18n.toPersianDigits(this._jy) : this._jy;
        return `${dStr} ${months[this._jm - 1]} ${yStr}`;
    },

    show() {
        const now = new Date();
        const j = I18n.gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
        this._jy = j.jy;
        this._jm = j.jm;
        this._jd = j.jd;
        this._calendarViewJy = j.jy;
        this._calendarViewJm = j.jm;
        this._isCalendarOpen = false;
        this._selectedSection = 'all';
        this._selectedPersonId = 'all';
        this._isDownloading = false;
        this._selectedQuickOffset = 0;

        this.render();

        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                SupervisorReportModal.close();
                window.removeEventListener('keydown', escHandler);
            }
        };
        window.addEventListener('keydown', escHandler);
    },

    close() {
        const el = document.getElementById('supervisor-report-modal-backdrop');
        if (el) el.remove();
        this._isCalendarOpen = false;
    },

    setQuickDate(offsetDays) {
        const target = new Date(Date.now() + offsetDays * 86400000);
        const j = I18n.gregorianToJalali(target.getFullYear(), target.getMonth() + 1, target.getDate());
        this._jy = j.jy;
        this._jm = j.jm;
        this._jd = j.jd;
        this._calendarViewJy = j.jy;
        this._calendarViewJm = j.jm;
        this._isCalendarOpen = false;
        this._selectedQuickOffset = offsetDays;

        this.updateDateDisplay();
    },

    updateQuickButtons() {
        const btnToday = document.getElementById('sup-report-quick-today');
        const btnYesterday = document.getElementById('sup-report-quick-yesterday');
        const activeStyle = 'padding: 4px 12px; font-size: 0.76rem; border-radius: 6px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.45); color: #60a5fa; font-weight: 600; cursor: pointer; transition: all 0.15s ease;';
        const inactiveStyle = 'padding: 4px 12px; font-size: 0.76rem; border-radius: 6px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-weight: 500; cursor: pointer; transition: all 0.15s ease;';

        if (btnToday) {
            btnToday.style.cssText = (this._selectedQuickOffset === 0) ? activeStyle : inactiveStyle;
        }
        if (btnYesterday) {
            btnYesterday.style.cssText = (this._selectedQuickOffset === -1) ? activeStyle : inactiveStyle;
        }
    },

    updateDateDisplay() {
        const lbl = document.getElementById('sup-report-date-display');
        const gregLbl = document.getElementById('sup-report-greg-display');
        if (lbl) lbl.textContent = this.getShamsiDisplay();
        if (gregLbl) gregLbl.textContent = `(${this.getGregorianDate()})`;

        this.updateQuickButtons();

        const pop = document.getElementById('sup-report-calendar-popover');
        if (pop) pop.style.display = 'none';
        this._isCalendarOpen = false;
    },

    toggleCalendar(e) {
        if (e) e.stopPropagation();
        this._isCalendarOpen = !this._isCalendarOpen;
        const pop = document.getElementById('sup-report-calendar-popover');
        if (!pop) return;

        if (this._isCalendarOpen) {
            this.renderCalendarPopover();
            pop.style.display = 'block';
        } else {
            pop.style.display = 'none';
        }
    },

    changeCalendarMonth(delta) {
        let m = this._calendarViewJm + delta;
        let y = this._calendarViewJy;
        if (m > 12) {
            m = 1;
            y++;
        } else if (m < 1) {
            m = 12;
            y--;
        }
        this._calendarViewJm = m;
        this._calendarViewJy = y;
        this.renderCalendarPopover();
    },

    selectCalendarDate(y, m, d) {
        this._jy = y;
        this._jm = m;
        this._jd = d;
        this._calendarViewJy = y;
        this._calendarViewJm = m;
        this._selectedQuickOffset = null;
        this.updateDateDisplay();
    },

    renderCalendarPopover() {
        const pop = document.getElementById('sup-report-calendar-popover');
        if (!pop) return;

        const isRtl = (typeof I18n !== 'undefined' && typeof I18n.isRtl === 'function') ? I18n.isRtl() : true;
        const months = [
            'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
            'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
        ];
        const monthName = months[this._calendarViewJm - 1];
        const yearDisplay = (isRtl && typeof I18n.toPersianDigits === 'function') 
            ? I18n.toPersianDigits(this._calendarViewJy) 
            : this._calendarViewJy;

        let daysInMonth = 31;
        if (this._calendarViewJm >= 7 && this._calendarViewJm <= 11) daysInMonth = 30;
        else if (this._calendarViewJm === 12) {
            const g = I18n.jalaliToGregorian(this._calendarViewJy, 12, 30);
            const jCheck = I18n.gregorianToJalali(g.gy, g.gm, g.gd);
            daysInMonth = (jCheck.jm === 12 && jCheck.jd === 30) ? 30 : 29;
        }

        const firstG = I18n.jalaliToGregorian(this._calendarViewJy, this._calendarViewJm, 1);
        const firstD = new Date(firstG.gy, firstG.gm - 1, firstG.gd);
        const dayOfWeek = (firstD.getDay() + 1) % 7; // 0=Sat, 1=Sun, ..., 6=Fri

        let cellsHtml = '';
        for (let i = 0; i < dayOfWeek; i++) {
            cellsHtml += `<div style="height: 28px;"></div>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const isSelected = (this._calendarViewJy === this._jy && this._calendarViewJm === this._jm && d === this._jd);
            const bg = isSelected ? '#3b82f6' : 'transparent';
            const color = isSelected ? '#ffffff' : '#cbd5e1';
            const dText = (isRtl && typeof I18n.toPersianDigits === 'function') ? I18n.toPersianDigits(d) : d;
            cellsHtml += `
                <button type="button" class="btn btn-sm" onclick="SupervisorReportModal.selectCalendarDate(${this._calendarViewJy}, ${this._calendarViewJm}, ${d})" style="height: 28px; width: 28px; padding: 0; border-radius: 6px; background: ${bg}; color: ${color}; font-size: 0.78rem; font-weight: ${isSelected ? '700' : '500'}; border: none; cursor: pointer; transition: background 0.15s ease;">
                    ${dText}
                </button>
            `;
        }

        const dayHeaders = isRtl
            ? '<div>ش</div><div>ی</div><div>د</div><div>س</div><div>چ</div><div>پ</div><div>ج</div>'
            : '<div>Sa</div><div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div>';

        pop.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.98); backdrop-filter: blur(14px); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 12px; padding: 0.75rem; box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.6); width: 250px; direction: ${isRtl ? 'rtl' : 'ltr'};">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                    <button type="button" class="btn btn-ghost btn-sm" onclick="SupervisorReportModal.changeCalendarMonth(-1)" style="padding: 2px 7px; color: #94a3b8; border-radius: 6px;">◀</button>
                    <span style="font-weight: 700; font-size: 0.85rem; color: #f8fafc;">${monthName} ${yearDisplay}</span>
                    <button type="button" class="btn btn-ghost btn-sm" onclick="SupervisorReportModal.changeCalendarMonth(1)" style="padding: 2px 7px; color: #94a3b8; border-radius: 6px;">▶</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; gap: 2px; font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">
                    ${dayHeaders}
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center;">
                    ${cellsHtml}
                </div>
            </div>
        `;
    },

    onSectionChange(secVal) {
        this._selectedSection = secVal;
        const pSelect = document.getElementById('sup-report-person-select');
        if (!pSelect) return;

        const allPersons = (typeof SupervisorCockpit !== 'undefined' && SupervisorCockpit._persons) || [];
        const filtered = (secVal === 'all')
            ? allPersons
            : allPersons.filter(p => (p.section || '').trim().toLowerCase() === secVal.trim().toLowerCase());

        let optionsHtml = `<option value="all">${I18n.t('report_all_persons') || 'همه پرسنل (گزارش تیمی)'}</option>`;
        filtered.forEach(p => {
            optionsHtml += `<option value="${p.id}">${this.escapeHtml(p.name)}${p.role ? ' — ' + this.escapeHtml(p.role) : ''}</option>`;
        });
        pSelect.innerHTML = optionsHtml;
        this._selectedPersonId = 'all';
    },

    async downloadReport() {
        if (this._isDownloading) return;
        this._isDownloading = true;

        const btn = document.getElementById('sup-report-submit-btn');
        const origBtnText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; display: inline-block; vertical-align: middle; margin-inline-end: 6px;"></span> <span>${I18n.t('report_downloading') || 'در حال آماده‌سازی گزارش اکسل...'}</span>`;
        }

        const dateStr = this.getGregorianDate();
        const secVal = document.getElementById('sup-report-section-select')?.value || this._selectedSection;
        const perVal = document.getElementById('sup-report-person-select')?.value || this._selectedPersonId;

        const params = new URLSearchParams();
        params.append('date', dateStr);
        if (secVal && secVal !== 'all') {
            params.append('section', secVal);
        }
        if (perVal && perVal !== 'all') {
            params.append('person_id', perVal);
        }

        try {
            const token = (typeof Auth !== 'undefined' && Auth.getToken()) || localStorage.getItem('token') || '';
            const res = await fetch(`/api/zones/supervisor/attendance-report/export?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ detail: 'Download failed' }));
                throw new Error(errData.detail || 'Failed to generate Excel report');
            }

            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `supervisor_attendance_${dateStr}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(blobUrl);

            if (typeof App !== 'undefined' && App.toast) {
                App.toast(I18n.t('report_download_success') || 'فایل اکسل با موفقیت دانلود شد', 'success');
            }

            this.close();
        } catch (err) {
            console.error('Supervisor report download error:', err);
            if (typeof App !== 'undefined' && App.toast) {
                App.toast(err.message || 'خطا در ایجاد گزارش اکسل', 'error');
            }
        } finally {
            this._isDownloading = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origBtnText;
            }
        }
    },

    render() {
        this.close();

        const isRtl = (typeof I18n !== 'undefined' && typeof I18n.isRtl === 'function') ? I18n.isRtl() : true;
        const user = (typeof Auth !== 'undefined' && Auth.getUser()) || {};
        const allowedSections = user.assigned_sections || [];
        const allPersons = (typeof SupervisorCockpit !== 'undefined' && SupervisorCockpit._persons) || [];

        // Build section options cleanly without nested parentheses
        const secCount = allowedSections.length;
        const secCountStr = (isRtl && typeof I18n.toPersianDigits === 'function') ? I18n.toPersianDigits(secCount) : secCount;
        const countSuffix = isRtl ? `${secCountStr} بخش` : `${secCountStr} sections`;
        let sectionOptions = `<option value="all">${I18n.t('report_all_sections') || 'همه بخش‌های مجاز من'}${secCount > 0 ? ' (' + countSuffix + ')' : ''}</option>`;
        allowedSections.forEach(sec => {
            sectionOptions += `<option value="${this.escapeAttr(sec)}">${this.escapeHtml(sec)}</option>`;
        });

        // Build personnel options
        let personOptions = `<option value="all">${I18n.t('report_all_persons') || 'همه پرسنل (گزارش تیمی)'}</option>`;
        allPersons.forEach(p => {
            personOptions += `<option value="${p.id}">${this.escapeHtml(p.name)}${p.role ? ' — ' + this.escapeHtml(p.role) : ''}</option>`;
        });

        const backdrop = document.createElement('div');
        backdrop.id = 'supervisor-report-modal-backdrop';
        backdrop.className = 'modal-backdrop';
        backdrop.style.cssText = `
            position: fixed; inset: 0; background: rgba(2, 6, 23, 0.78);
            backdrop-filter: blur(8px); display: flex; align-items: center;
            justify-content: center; z-index: 9999; padding: 1rem;
        `;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) SupervisorReportModal.close();
        };

        backdrop.innerHTML = `
            <div class="card-glass" style="width: 100%; max-width: 520px; border-radius: 18px; border: 1px solid rgba(59, 130, 246, 0.35); box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.7); overflow: visible; display: flex; flex-direction: column; direction: ${isRtl ? 'rtl' : 'ltr'}; background: rgba(15, 23, 42, 0.94);">
                
                <!-- Header -->
                <div style="padding: 1.25rem 1.4rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
                            📊
                        </div>
                        <div>
                            <h2 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #f8fafc;">
                                ${I18n.t('report_modal_title') || 'گزارش اکسل حضور و غیاب پرسنل'}
                            </h2>
                            <p style="margin: 2px 0 0 0; font-size: 0.76rem; color: #94a3b8;">
                                ${I18n.t('report_modal_subtitle') || 'صدور فایل جامع اکسل شامل حضور، تأخیر، تعجیل و غیبت‌ها'}
                            </p>
                        </div>
                    </div>
                    <button type="button" onclick="SupervisorReportModal.close()" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; color: #94a3b8; cursor: pointer; transition: all 0.15s ease;" onmouseenter="this.style.background='rgba(255, 255, 255, 0.12)'; this.style.color='#f8fafc';" onmouseleave="this.style.background='rgba(255, 255, 255, 0.05)'; this.style.color='#94a3b8';">✕</button>
                </div>

                <!-- Body -->
                <div style="padding: 1.35rem 1.4rem; display: flex; flex-direction: column; gap: 1.25rem;">
                    
                    <!-- Date Picker Section -->
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; position: relative;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 0.82rem; font-weight: 600; color: #cbd5e1; display: flex; align-items: center; gap: 5px;">
                                <span>📅</span>
                                <span>${I18n.t('report_date_select_label') || 'تاریخ گزارش:'}</span>
                            </label>
                            
                            <!-- Quick Shortcuts -->
                            <div style="display: flex; gap: 6px;">
                                <button type="button" id="sup-report-quick-today" onclick="SupervisorReportModal.setQuickDate(0)" style="padding: 4px 12px; font-size: 0.76rem; border-radius: 6px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.45); color: #60a5fa; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
                                    ${I18n.t('report_quick_today') || 'امروز'}
                                </button>
                                <button type="button" id="sup-report-quick-yesterday" onclick="SupervisorReportModal.setQuickDate(-1)" style="padding: 4px 12px; font-size: 0.76rem; border-radius: 6px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-weight: 500; cursor: pointer; transition: all 0.15s ease;">
                                    ${I18n.t('report_quick_yesterday') || 'دیروز'}
                                </button>
                            </div>
                        </div>

                        <!-- Date Trigger Input -->
                        <div onclick="SupervisorReportModal.toggleCalendar(event)" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 10px; cursor: pointer; transition: all 0.2s ease;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.95rem; font-weight: 700; color: #38bdf8;" id="sup-report-date-display">
                                    ${this.getShamsiDisplay()}
                                </span>
                                <span style="font-size: 0.76rem; color: #64748b; direction: ltr; unicode-bidi: isolate; display: inline-block;" id="sup-report-greg-display">
                                    (${this.getGregorianDate()})
                                </span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; color: #60a5fa;">
                                <span style="font-size: 0.95rem;">📅</span>
                                <span style="font-size: 0.68rem; color: #94a3b8; transition: transform 0.2s ease;">▼</span>
                            </div>
                        </div>

                        <!-- Calendar Popover -->
                        <div id="sup-report-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); ${isRtl ? 'right: 0;' : 'left: 0;'} z-index: 10000;">
                            <!-- Populated dynamically via renderCalendarPopover() -->
                        </div>
                    </div>

                    <!-- Section Filter -->
                    <div style="display: flex; flex-direction: column; gap: 0.45rem;">
                        <label style="font-size: 0.82rem; font-weight: 600; color: #cbd5e1; display: flex; align-items: center; gap: 5px;">
                            <span>🏢</span>
                            <span>${I18n.t('report_section_label') || 'بخش / واحد سازمانی:'}</span>
                        </label>
                        <select id="sup-report-section-select" class="form-control" onchange="SupervisorReportModal.onSectionChange(this.value)" style="width: 100%; padding: 9px 12px; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px; color: #f1f5f9; font-size: 0.84rem;">
                            ${sectionOptions}
                        </select>
                    </div>

                    <!-- Personnel Filter -->
                    <div style="display: flex; flex-direction: column; gap: 0.45rem;">
                        <label style="font-size: 0.82rem; font-weight: 600; color: #cbd5e1; display: flex; align-items: center; gap: 5px;">
                            <span>👥</span>
                            <span>${I18n.t('report_person_label') || 'پرسنل انتخابی:'}</span>
                        </label>
                        <select id="sup-report-person-select" class="form-control" onchange="SupervisorReportModal._selectedPersonId = this.value" style="width: 100%; padding: 9px 12px; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px; color: #f1f5f9; font-size: 0.84rem;">
                            ${personOptions}
                        </select>
                    </div>

                    <!-- Summary Info Box -->
                    <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 10px; padding: 0.75rem 0.9rem; display: flex; align-items: flex-start; gap: 8px;">
                        <span style="font-size: 0.95rem;">ℹ️</span>
                        <div style="font-size: 0.75rem; color: #94a3b8; line-height: 1.5;">
                            ${isRtl
                                ? 'فایل خروجی شامل ۱۶ ستون داده از جمله حضور مفید، تاخیر، تعجیل، غیبت‌ها و درصد انضباط به همراه خلاصه KPI مدیریتی در قالب استاندارد راست‌به‌چپ (RTL) خواهد بود.'
                                : 'Export contains 16 comprehensive columns including net presence, delays, early leave, absences, and compliance rate along with an executive KPI header in RTL format.'
                            }
                        </div>
                    </div>

                </div>

                <!-- Footer Actions -->
                <div style="padding: 1.15rem 1.4rem; border-top: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: flex-end; gap: 10px; background: rgba(10, 16, 30, 0.4); border-bottom-left-radius: 18px; border-bottom-right-radius: 18px;">
                    <button type="button" class="btn btn-ghost btn-sm" onclick="SupervisorReportModal.close()" style="border-radius: 8px; padding: 7px 16px; font-weight: 500; font-size: 0.82rem; color: #94a3b8;">
                        ${I18n.t('cancel') || 'انصراف'}
                    </button>
                    <button type="button" id="sup-report-submit-btn" class="btn btn-primary btn-sm" onclick="SupervisorReportModal.downloadReport()" style="border-radius: 8px; padding: 7px 20px; font-weight: 600; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                        <span>📊</span>
                        <span>${I18n.t('report_download_btn') || 'دریافت گزارش اکسل (.xlsx)'}</span>
                    </button>
                </div>

            </div>
        `;

        document.body.appendChild(backdrop);
    }
};

// Global click-outside listener to close calendar popover
document.addEventListener('click', (e) => {
    const pop = document.getElementById('sup-report-calendar-popover');
    if (pop && pop.style.display === 'block') {
        const trigger = document.getElementById('sup-report-date-display');
        if (!pop.contains(e.target) && (!trigger || !trigger.parentElement.contains(e.target))) {
            pop.style.display = 'none';
            if (typeof SupervisorReportModal !== 'undefined') {
                SupervisorReportModal._isCalendarOpen = false;
            }
        }
    }
});
