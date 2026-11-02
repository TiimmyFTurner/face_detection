/**
 * SupervisorSubstitutionModal — Dedicated modal for supervisors to assign
 * and manage shift substitutions (جانشین شیفت) for assigned personnel.
 * Features 100% localization, zero-photo privacy shield, Solar Hijri (Shamsi) calendar pickers,
 * and real-time shift conflict detection.
 */
const SupervisorSubstitutionModal = {
    _origPersonId: null,
    _origPersonName: '',
    _subPersonId: null,
    _substitutions: [],
    _candidates: [],
    _conflictInfo: null,

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

    getAvatarGradient(name) {
        const palettes = [
            'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            'linear-gradient(135deg, #10b981 0%, #047857 100%)',
            'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
            'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
            'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
            'linear-gradient(135deg, #06b6d4 0%, #0e7490 100%)',
        ];
        let hash = 0;
        const str = String(name || '');
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return palettes[Math.abs(hash) % palettes.length];
    },

    getInitials(name) {
        if (!name) return '??';
        const parts = String(name).trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + ' ' + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    },

    getGregorianDate(target) {
        const jy = target === 'start' ? this._startJy : this._endJy;
        const jm = target === 'start' ? this._startJm : this._endJm;
        const jd = target === 'start' ? this._startJd : this._endJd;
        if (!jy || !jm || !jd) return '';
        const g = I18n.jalaliToGregorian(jy, jm, jd);
        const pad = n => String(n).padStart(2, '0');
        return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
    },

    getShamsiDisplay(target) {
        const jy = target === 'start' ? this._startJy : this._endJy;
        const jm = target === 'start' ? this._startJm : this._endJm;
        const jd = target === 'start' ? this._startJd : this._endJd;
        if (!jy || !jm || !jd) return '---';
        const months = [
            'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
            'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
        ];
        return `${jd} ${months[jm - 1]} ${jy}`;
    },

    formatGregorianToShamsi(gDateStr) {
        if (!gDateStr) return '---';
        const parts = String(gDateStr).split('-');
        if (parts.length < 3) return gDateStr;
        const gy = parseInt(parts[0], 10);
        const gm = parseInt(parts[1], 10);
        const gd = parseInt(parts[2], 10);
        const j = I18n.gregorianToJalali(gy, gm, gd);
        const months = [
            'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
            'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
        ];
        return `${j.jd} ${months[j.jm - 1]} ${j.jy}`;
    },

    formatDisplayDate(gDateStr) {
        if (!gDateStr) return '---';
        if (I18n.getLang() === 'en') {
            return gDateStr;
        }
        return this.formatGregorianToShamsi(gDateStr);
    },

    getLocalizedConflictMessage(info) {
        if (!info || !info.has_conflict) return '';
        const isEn = (I18n.getLang() === 'en');
        const type = info.conflict_type;
        const name = info.substitute_name || '';

        if (isEn) {
            if (type === 'self_substitution') {
                return I18n.t('conflict_msg_self') || 'A person cannot substitute for themselves.';
            }
            if (type === 'leave') {
                const start = info.start_date || '';
                const end = info.end_date || start;
                const lType = info.leave_type || 'Leave';
                return (I18n.t('conflict_msg_leave', { name, start, end, type: lType }) ||
                    `The substitute colleague (${name}) is scheduled for "${lType}" between ${start} and ${end}.`);
            }
            if (type === 'already_substituting') {
                const start = info.start_date || '';
                const end = info.end_date || start;
                const orig = info.original_name || 'another staff';
                return (I18n.t('conflict_msg_already_substituting', { name, start, end, orig }) ||
                    `The substitute colleague (${name}) is already assigned as substitute for "${orig}" between ${start} and ${end}.`);
            }
            if (type === 'own_shift') {
                const stations = info.station_names || '';
                return (I18n.t('conflict_msg_own_shift', { name, stations }) ||
                    `The substitute colleague (${name}) already has their own active shift at station: "${stations}".`);
            }
            return info.detail || 'The substitute colleague has a scheduling conflict during this period.';
        } else {
            // Persian
            if (type === 'self_substitution') {
                return I18n.t('conflict_msg_self') || 'فرد نمی‌تواند جانشین خودش باشد.';
            }
            if (type === 'leave') {
                const startShamsi = this.formatGregorianToShamsi(info.start_date);
                const endShamsi = info.end_date ? this.formatGregorianToShamsi(info.end_date) : startShamsi;
                const lType = info.leave_type || 'مرخصی';
                return (I18n.t('conflict_msg_leave', { name, start: startShamsi, end: endShamsi, type: lType }) ||
                    `فرد جانشین (${name}) در بازه ${startShamsi} تا ${endShamsi} در وضعیت «${lType}» ثبت شده است.`);
            }
            if (type === 'already_substituting') {
                const startShamsi = this.formatGregorianToShamsi(info.start_date);
                const endShamsi = info.end_date ? this.formatGregorianToShamsi(info.end_date) : startShamsi;
                const orig = info.original_name || 'همکار دیگر';
                return (I18n.t('conflict_msg_already_substituting', { name, start: startShamsi, end: endShamsi, orig }) ||
                    `فرد جانشین (${name}) قبلاً در بازه ${startShamsi} تا ${endShamsi} برای «${orig}» به عنوان جانشین ثبت شده است.`);
            }
            if (type === 'own_shift') {
                const stations = info.station_names || '';
                return (I18n.t('conflict_msg_own_shift', { name, stations }) ||
                    `فرد جانشین (${name}) در این بازه، خود دارای شیفت کاری در ایستگاه «${stations}» است.`);
            }
            return info.detail || 'فرد جانشین در این بازه دارای تداخل برنامه کاری است.';
        }
    },

    /**
     * Open substitution management modal.
     * @param {number|null} origPersonId Optional ID of person needing a substitute
     * @param {string} origPersonName Optional name
     */
    async show(origPersonId = null, origPersonName = '') {
        this._origPersonId = origPersonId ? parseInt(origPersonId, 10) : null;
        this._origPersonName = origPersonName || '';
        this._subPersonId = null;
        this._conflictInfo = null;

        // Default start & end to Today in Shamsi
        const now = new Date();
        const tj = I18n.gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
        this._startJy = tj.jy;
        this._startJm = tj.jm;
        this._startJd = tj.jd;
        this._endJy = tj.jy;
        this._endJm = tj.jm;
        this._endJd = tj.jd;

        this._calendarViewJy = tj.jy;
        this._calendarViewJm = tj.jm;
        this._activeCalendarTarget = null;

        App.openModal(`
            <div class="modal-body" style="padding: 2.5rem; text-align: center;">
                <div class="spinner-border text-primary mb-3"></div>
                <div style="font-size: 0.9rem; color: var(--text-secondary);">${I18n.t('loading') || 'در حال بارگذاری اطلاعات...'}</div>
            </div>
        `, 'modal-lg');

        try {
            // Fetch candidates and current substitutions in parallel
            const [subs, personsData] = await Promise.all([
                App.api('/api/substitutions').catch(() => []),
                App.api('/api/persons').catch(() => [])
            ]);

            this._substitutions = Array.isArray(subs) ? subs : [];

            // Candidates list: use supervised persons from SupervisorCockpit._persons if available;
            // otherwise fallback to personsData. This ensures relief/unassigned personnel (like Mehrdad)
            // are included as candidates even if they don't have an assigned camera zone!
            const sourcePersons = (typeof SupervisorCockpit !== 'undefined' && Array.isArray(SupervisorCockpit._persons) && SupervisorCockpit._persons.length > 0)
                ? SupervisorCockpit._persons
                : (Array.isArray(personsData) ? personsData : []);

            this._candidates = sourcePersons.map(p => ({
                id: p.id,
                name: p.name,
                role: p.role || '',
                section: p.section || ''
            }));

            // Auto-detect origPersonName if ID was passed but not name
            if (this._origPersonId && !this._origPersonName) {
                const found = this._candidates.find(c => c.id === this._origPersonId);
                if (found) this._origPersonName = found.name;
            }

            this.render();
            this._initClickOutside();
        } catch (err) {
            console.error('Failed to initialize substitution modal:', err);
            App.showToast(err.message || 'خطا در بارگذاری اطلاعات جانشینی', 'error');
            App.closeModal();
        }
    },

    _initClickOutside() {
        if (this._hasClickOutsideListener) return;
        document.addEventListener('click', (e) => {
            if (SupervisorSubstitutionModal._activeCalendarTarget) {
                const isInsidePop = e.target.closest('#subst-calendar-popover-start') ||
                                    e.target.closest('#subst-calendar-popover-end');
                const isInsideBtn = e.target.closest('.shamsi-subst-btn');
                if (!isInsidePop && !isInsideBtn) {
                    SupervisorSubstitutionModal._activeCalendarTarget = null;
                    const popS = document.getElementById('subst-calendar-popover-start');
                    const popE = document.getElementById('subst-calendar-popover-end');
                    if (popS) popS.style.display = 'none';
                    if (popE) popE.style.display = 'none';
                }
            }
        });
        this._hasClickOutsideListener = true;
    },

    render() {
        const isRtl = (I18n.getLang() !== 'en');

        const origNameDisplay = this._origPersonName ||
            (this._origPersonId ? `شناسه #${this._origPersonId}` : (isRtl ? 'انتخاب پرسنل' : 'Select Staff'));

        const now = new Date();
        const tj = I18n.gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Available substitutes: all candidates excluding original person
        const availableSubs = this._candidates.filter(c => c.id !== this._origPersonId);

        // List of substitutions relevant for view
        const subsList = this._substitutions;

        const html = `
            <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.35rem; border-bottom: 1px solid var(--border-color); background: var(--bg-card);">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div class="sup-avatar-badge" style="width: 40px; height: 40px; font-size: 1.1rem; background: ${this.getAvatarGradient(origNameDisplay)};">
                        🔄
                    </div>
                    <div>
                        <h2 class="modal-title" style="font-size: 1.1rem; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
                            <span>${I18n.t('shift_substitutions_title') || 'مدیریت و تعیین جانشین شیفت'}</span>
                        </h2>
                        <p class="modal-subtitle" style="font-size: 0.8rem; color: var(--text-secondary); margin: 2px 0 0;">
                            ${I18n.t('shift_substitutions_subtitle') || 'تعیین همکار جانشین برای پوشش شیفت و ایستگاه کاری پرسنل'}
                        </p>
                    </div>
                </div>
                <button type="button" class="btn btn-icon btn-ghost" onclick="App.closeModal()" title="${I18n.t('close') || 'بستن'}" style="font-size: 1.25rem;">✕</button>
            </div>

            <div class="modal-body" style="padding: 1rem 1.35rem; max-height: 80vh; overflow-y: auto;">
                <!-- Add Substitution Form -->
                <div class="card-glass" style="border-radius: 10px; border: 1px solid rgba(59, 130, 246, 0.3); background: rgba(15, 23, 42, 0.6); padding: 0.85rem 1rem; margin-bottom: 1rem;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 0.5rem;">
                        <h4 style="font-size: 0.92rem; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 0.4rem; color: #f8fafc;">
                            <span style="color: #60a5fa;">➕</span>
                            <span>${I18n.t('assign_substitute_action') || 'ثبت جانشینی جدید'}</span>
                        </h4>
                    </div>

                    <form id="add-subst-form" onsubmit="SupervisorSubstitutionModal.submitAdd(event)">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.85rem; margin-bottom: 0.85rem;">
                            <!-- Original Person -->
                            <div>
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>👤</span>
                                    <span>${I18n.t('substitute_for_label') || 'فرد اصلی (دارای شیفت):'}</span>
                                </label>
                                ${this._origPersonId ? `
                                    <div style="height: 40px; display: flex; align-items: center; gap: 8px; padding: 0.4rem 0.75rem; border: 1px solid rgba(59, 130, 246, 0.45); background: rgba(15, 23, 42, 0.85); border-radius: 8px; color: #38bdf8; font-weight: 700; font-size: 0.85rem;">
                                        <div class="sup-avatar-badge" style="width: 24px; height: 24px; font-size: 0.7rem; background: ${this.getAvatarGradient(this._origPersonName)};">
                                            ${this.getInitials(this._origPersonName)}
                                        </div>
                                        <span>${this.escapeHtml(this._origPersonName)}</span>
                                    </div>
                                ` : `
                                    <select id="subst-orig-select" class="form-control form-select sup-leave-select" onchange="SupervisorSubstitutionModal.onOrigPersonChange(this.value)" required>
                                        <option value="">${isRtl ? '-- انتخاب فرد اصلی --' : '-- Select Original Staff --'}</option>
                                        ${this._candidates.map(c => `
                                            <option value="${c.id}" ${c.id === this._origPersonId ? 'selected' : ''}>
                                                ${this.escapeHtml(c.name)} ${c.role ? `(${this.escapeHtml(c.role)})` : ''}
                                            </option>
                                        `).join('')}
                                    </select>
                                `}
                            </div>

                            <!-- Substitute Colleague -->
                            <div>
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>🛡️</span>
                                    <span>${I18n.t('choose_substitute_colleague') || 'انتخاب همکار جانشین:'}</span>
                                </label>
                                <select id="subst-target-select" class="form-control form-select sup-leave-select" onchange="SupervisorSubstitutionModal.onSubstituteChange(this.value)" required>
                                    <option value="">${I18n.t('select_substitute_placeholder') || '-- انتخاب همکار جانشین --'}</option>
                                    ${availableSubs.map(c => `
                                        <option value="${c.id}" ${c.id === this._subPersonId ? 'selected' : ''}>
                                            ${this.escapeHtml(c.name)} ${c.role ? `(${this.escapeHtml(c.role)})` : ''}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>

                        <!-- Date Pickers Grid -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-bottom: 0.85rem;">
                            <!-- Shamsi Start Date Picker -->
                            <div style="position: relative;">
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>📅</span>
                                    <span>${I18n.t('from_date_label') || 'از تاریخ (شروع)'}</span>
                                </label>
                                <button type="button" class="btn w-100 shamsi-subst-btn" onclick="SupervisorSubstitutionModal.toggleCalendar('start', event)" style="height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.75rem; border: 1px solid rgba(59, 130, 246, 0.45); background: rgba(15, 23, 42, 0.85); border-radius: 8px;">
                                    <span style="display: flex; align-items: center; gap: 0.45rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        <span style="font-size: 0.95rem;">📅</span>
                                        <span id="subst-start-shamsi-label" style="font-weight: 700; font-size: 0.85rem; color: #38bdf8;">${this.getShamsiDisplay('start')}</span>
                                    </span>
                                    <span style="color: #60a5fa; font-size: 0.7rem; margin-inline-start: 4px;">▼</span>
                                </button>
                                <div id="subst-calendar-popover-start" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-start: 0; z-index: 1100; width: 285px;"></div>
                            </div>

                            <!-- Shamsi End Date Picker -->
                            <div style="position: relative;">
                                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 5px;">
                                    <span>📅</span>
                                    <span>${I18n.t('to_date_label') || 'تا تاریخ (پایان)'}</span>
                                </label>
                                <button type="button" class="btn w-100 shamsi-subst-btn" onclick="SupervisorSubstitutionModal.toggleCalendar('end', event)" style="height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.75rem; border: 1px solid rgba(59, 130, 246, 0.45); background: rgba(15, 23, 42, 0.85); border-radius: 8px;">
                                    <span style="display: flex; align-items: center; gap: 0.45rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        <span style="font-size: 0.95rem;">📅</span>
                                        <span id="subst-end-shamsi-label" style="font-weight: 700; font-size: 0.85rem; color: #38bdf8;">${this.getShamsiDisplay('end')}</span>
                                    </span>
                                    <span style="color: #60a5fa; font-size: 0.7rem; margin-inline-start: 4px;">▼</span>
                                </button>
                                <div id="subst-calendar-popover-end" class="shamsi-calendar-popover" style="display: none; position: absolute; top: calc(100% + 4px); inset-inline-end: 0; z-index: 1100; width: 285px;"></div>
                            </div>
                        </div>

                        <!-- Presets Toolbar -->
                        <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.85rem;">
                            <span style="font-size: 0.78rem; font-weight: 600; color: #94a3b8; display: inline-flex; align-items: center; gap: 4px; margin-inline-end: 0.2rem;">
                                <span>⚡</span> <span>${I18n.t('quick_presets') || 'میانبر سریع:'}</span>
                            </span>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorSubstitutionModal.applyPreset('today')">
                                ${I18n.t('preset_today') || 'امروز'}
                            </button>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorSubstitutionModal.applyPreset('tomorrow')">
                                ${I18n.t('preset_tomorrow') || 'فردا'}
                            </button>
                            <button type="button" class="btn sup-preset-chip" onclick="SupervisorSubstitutionModal.applyPreset('3days')">
                                ${I18n.t('preset_3_days') || '۳ روزه'}
                            </button>
                        </div>

                        <!-- Conflict Warning Alert Box -->
                        <div id="subst-conflict-alert" style="display: ${this._conflictInfo && this._conflictInfo.has_conflict ? 'block' : 'none'}; margin-bottom: 0.85rem; padding: 0.75rem 1rem; border-radius: 8px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; direction: ${isRtl ? 'rtl' : 'ltr'}; text-align: ${isRtl ? 'right' : 'left'};">
                            <div style="display: flex; align-items: flex-start; gap: 8px;">
                                <span style="font-size: 1.1rem; line-height: 1;">⚠️</span>
                                <div style="flex: 1;">
                                    <div style="font-weight: 700; font-size: 0.85rem; direction: ${isRtl ? 'rtl' : 'ltr'}; text-align: ${isRtl ? 'right' : 'left'};">${I18n.t('substitution_conflict_warning') || 'هشدار تداخل شیفت جانشین'}</div>
                                    <div id="subst-conflict-text" style="font-size: 0.78rem; margin-top: 3px; color: #fde68a; direction: ${isRtl ? 'rtl' : 'ltr'}; text-align: ${isRtl ? 'right' : 'left'}; line-height: 1.5;">
                                        ${this._conflictInfo ? this.escapeHtml(this.getLocalizedConflictMessage(this._conflictInfo)) : ''}
                                    </div>
                                    <div id="subst-conflict-hint" style="font-size: 0.72rem; margin-top: 4px; color: #cbd5e1; opacity: 0.85; direction: ${isRtl ? 'rtl' : 'ltr'}; text-align: ${isRtl ? 'right' : 'left'};">
                                        ${I18n.t('conflict_hint_proceed') || (isRtl ? '(در صورت تمایل، همچنان می‌توانید با وجود تداخل، جانشینی را ثبت نمایید)' : '(You may still proceed and assign substitution despite conflict)')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Note input & Submit button -->
                        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                            <input type="text" id="subst-note-input" class="form-control sup-leave-input" placeholder="${isRtl ? 'علت یا توضیحات جانشینی (اختیاری)...' : 'Substitution reason or note (optional)...'}" style="flex: 1; min-width: 200px; height: 38px;">
                            <button type="submit" id="save-subst-btn" class="btn btn-primary" style="height: 38px; padding: 0 1.25rem; font-weight: 700; font-size: 0.85rem; border-radius: 8px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); display: inline-flex; align-items: center; gap: 6px;">
                                <span>💾</span>
                                <span>${I18n.t('assign_substitute_btn') || 'ثبت جانشین'}</span>
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Active & Scheduled Substitutions List -->
                <div>
                    <h4 style="font-size: 0.92rem; font-weight: 700; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem; color: #f8fafc;">
                        <span>📋</span>
                        <span>${I18n.t('active_substitutions_title') || 'جانشینی‌های فعال و برنامه‌ریزی‌شده'}</span>
                        <span style="font-size: 0.75rem; background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 2px 8px; border-radius: 9999px;">
                            ${subsList.length}
                        </span>
                    </h4>

                    ${subsList.length === 0 ? `
                        <div style="padding: 2rem 1rem; text-align: center; border: 1px dashed rgba(255, 255, 255, 0.15); border-radius: 10px; color: var(--text-secondary); font-size: 0.85rem;">
                            ${I18n.t('no_active_substitutions') || 'هیچ جانشینی فعالی برای پرسنل شما ثبت نشده است.'}
                        </div>
                    ` : `
                        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                            ${subsList.map(s => {
                                const isActiveToday = (s.start_date <= todayStr && todayStr <= s.end_date);
                                const isUpcoming = (s.start_date > todayStr);
                                const isExpired = (s.end_date < todayStr);

                                let statusPill = '';
                                if (isActiveToday) {
                                    statusPill = `<span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); font-size: 0.72rem; padding: 3px 8px; border-radius: 9999px;">🟢 ${I18n.t('status_active_today') || 'فعال امروز'}</span>`;
                                } else if (isUpcoming) {
                                    statusPill = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.72rem; padding: 3px 8px; border-radius: 9999px;">⏳ ${I18n.t('status_scheduled') || 'برنامه‌ریزی‌شده'}</span>`;
                                } else {
                                    statusPill = `<span class="badge" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25); font-size: 0.72rem; padding: 3px 8px; border-radius: 9999px;">⚪ ${I18n.t('status_expired') || 'منقضی‌شده'}</span>`;
                                }

                                const conflictBadge = s.has_conflict ? `
                                    <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.7rem; padding: 2px 7px;" title="${this.escapeAttr(s.conflict_detail || '')}">
                                        ⚠️ ${I18n.t('conflict_badge_label') || (isRtl ? 'تداخل شیفت' : 'Shift Conflict')}
                                    </span>
                                ` : '';

                                return `
                                    <div class="card-glass" style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.08); background: rgba(15, 23, 42, 0.45); flex-wrap: wrap; gap: 0.75rem;">
                                        <div style="display: flex; align-items: center; gap: 0.85rem; flex: 1; min-width: 250px;">
                                            <!-- Orig Person -->
                                            <div style="display: flex; align-items: center; gap: 6px;">
                                                <div class="sup-avatar-badge" style="width: 28px; height: 28px; font-size: 0.75rem; background: ${this.getAvatarGradient(s.original_person_name)};">
                                                    ${this.getInitials(s.original_person_name)}
                                                </div>
                                                <div>
                                                    <div style="font-weight: 700; font-size: 0.85rem; color: #f8fafc;">${this.escapeHtml(s.original_person_name)}</div>
                                                    <div style="font-size: 0.72rem; color: #94a3b8;">${isRtl ? 'فرد اصلی' : 'Original'}</div>
                                                </div>
                                            </div>

                                            <span style="font-size: 1.1rem; color: #60a5fa;">➔</span>

                                            <!-- Substitute Person -->
                                            <div style="display: flex; align-items: center; gap: 6px;">
                                                <div class="sup-avatar-badge" style="width: 28px; height: 28px; font-size: 0.75rem; background: ${this.getAvatarGradient(s.substitute_person_name)};">
                                                    ${this.getInitials(s.substitute_person_name)}
                                                </div>
                                                <div>
                                                    <div style="font-weight: 700; font-size: 0.85rem; color: #38bdf8;">${this.escapeHtml(s.substitute_person_name)}</div>
                                                    <div style="font-size: 0.72rem; color: #38bdf8;">${isRtl ? 'جانشین' : 'Substitute'}</div>
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Period & Station -->
                                        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                                            ${s.zone_name ? `
                                                <span style="font-size: 0.75rem; background: rgba(255, 255, 255, 0.05); padding: 3px 8px; border-radius: 6px; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1);">
                                                    🏢 ${this.escapeHtml(s.zone_name)}
                                                </span>
                                            ` : ''}

                                            <span style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">
                                                📅 ${this.formatDisplayDate(s.start_date)} ${s.start_date !== s.end_date ? `${isRtl ? 'تا' : 'to'} ${this.formatDisplayDate(s.end_date)}` : ''}
                                            </span>

                                            ${statusPill}
                                            ${conflictBadge}

                                            <button type="button" class="btn btn-outline-danger btn-sm" onclick="SupervisorSubstitutionModal.deleteSubst(${s.id})" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                                                <span>✕</span>
                                                <span>${I18n.t('cancel_substitution_btn') || 'لغو جانشینی'}</span>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>
            </div>
        `;

        App.openModal(html, 'modal-lg');
    },

    onOrigPersonChange(newVal) {
        this._origPersonId = newVal ? parseInt(newVal, 10) : null;
        const found = this._candidates.find(c => c.id === this._origPersonId);
        this._origPersonName = found ? found.name : '';
        this.checkLiveConflict();
        this.render();
    },

    onSubstituteChange(newVal) {
        this._subPersonId = newVal ? parseInt(newVal, 10) : null;
        this.checkLiveConflict();
    },

    async checkLiveConflict() {
        const origId = this._origPersonId;
        const subId = this._subPersonId;
        const sDate = this.getGregorianDate('start');
        const eDate = this.getGregorianDate('end');

        if (!origId || !subId || !sDate || !eDate) {
            this._conflictInfo = null;
            this._updateConflictUI();
            return;
        }

        try {
            const conflict = await App.api('/api/substitutions/check-conflict', 'POST', {
                original_person_id: origId,
                substitute_person_id: subId,
                start_date: sDate,
                end_date: eDate,
            });
            this._conflictInfo = conflict;
            this._updateConflictUI();
        } catch (err) {
            console.error('Failed to check conflict:', err);
        }
    },

    _updateConflictUI() {
        const alertBox = document.getElementById('subst-conflict-alert');
        const textElem = document.getElementById('subst-conflict-text');
        const hintElem = document.getElementById('subst-conflict-hint');
        if (!alertBox || !textElem) return;

        if (this._conflictInfo && this._conflictInfo.has_conflict) {
            const isRtl = (I18n.getLang() !== 'en');
            textElem.textContent = this.getLocalizedConflictMessage(this._conflictInfo);
            textElem.style.direction = isRtl ? 'rtl' : 'ltr';
            textElem.style.textAlign = isRtl ? 'right' : 'left';
            if (hintElem) {
                hintElem.textContent = I18n.t('conflict_hint_proceed') ||
                    (isRtl ? '(در صورت تمایل، همچنان می‌توانید با وجود تداخل، جانشینی را ثبت نمایید)' : '(You may still proceed and assign substitution despite conflict)');
                hintElem.style.direction = isRtl ? 'rtl' : 'ltr';
                hintElem.style.textAlign = isRtl ? 'right' : 'left';
            }
            alertBox.style.direction = isRtl ? 'rtl' : 'ltr';
            alertBox.style.textAlign = isRtl ? 'right' : 'left';
            alertBox.style.display = 'block';
        } else {
            alertBox.style.display = 'none';
        }
    },

    applyPreset(preset) {
        const now = new Date();
        const tj = I18n.gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());

        if (preset === 'today') {
            this._startJy = tj.jy;
            this._startJm = tj.jm;
            this._startJd = tj.jd;
            this._endJy = tj.jy;
            this._endJm = tj.jm;
            this._endJd = tj.jd;
        } else if (preset === 'tomorrow') {
            const tm = new Date(now.getTime() + 24 * 3600 * 1000);
            const tmj = I18n.gregorianToJalali(tm.getFullYear(), tm.getMonth() + 1, tm.getDate());
            this._startJy = tmj.jy;
            this._startJm = tmj.jm;
            this._startJd = tmj.jd;
            this._endJy = tmj.jy;
            this._endJm = tmj.jm;
            this._endJd = tmj.jd;
        } else if (preset === '3days') {
            this._startJy = tj.jy;
            this._startJm = tj.jm;
            this._startJd = tj.jd;
            const t3 = new Date(now.getTime() + 2 * 24 * 3600 * 1000);
            const t3j = I18n.gregorianToJalali(t3.getFullYear(), t3.getMonth() + 1, t3.getDate());
            this._endJy = t3j.jy;
            this._endJm = t3j.jm;
            this._endJd = t3j.jd;
        }

        const slabel = document.getElementById('subst-start-shamsi-label');
        const elabel = document.getElementById('subst-end-shamsi-label');
        if (slabel) slabel.textContent = this.getShamsiDisplay('start');
        if (elabel) elabel.textContent = this.getShamsiDisplay('end');

        this.checkLiveConflict();
    },

    toggleCalendar(target, e) {
        e.stopPropagation();
        if (this._activeCalendarTarget === target) {
            this._activeCalendarTarget = null;
            const pop = document.getElementById(`subst-calendar-popover-${target}`);
            if (pop) pop.style.display = 'none';
            return;
        }

        const other = target === 'start' ? 'end' : 'start';
        const otherPop = document.getElementById(`subst-calendar-popover-${other}`);
        if (otherPop) otherPop.style.display = 'none';

        this._activeCalendarTarget = target;
        const curJy = target === 'start' ? this._startJy : this._endJy;
        const curJm = target === 'start' ? this._startJm : this._endJm;
        this._calendarViewJy = curJy || 1403;
        this._calendarViewJm = curJm || 1;
        this.renderCalendarPopover(target);
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
        if (this._activeCalendarTarget) {
            this.renderCalendarPopover(this._activeCalendarTarget);
        }
    },

    renderCalendarPopover(target) {
        const pop = document.getElementById(`subst-calendar-popover-${target}`);
        if (!pop) return;

        const months = [
            'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
            'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
        ];
        const monthName = months[this._calendarViewJm - 1];

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

        const selectedJy = target === 'start' ? this._startJy : this._endJy;
        const selectedJm = target === 'start' ? this._startJm : this._endJm;
        const selectedJd = target === 'start' ? this._startJd : this._endJd;

        let cellsHtml = '';
        for (let i = 0; i < dayOfWeek; i++) {
            cellsHtml += `<div style="height: 28px;"></div>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const isSelected = (this._calendarViewJy === selectedJy && this._calendarViewJm === selectedJm && d === selectedJd);
            const bg = isSelected ? '#3b82f6' : 'transparent';
            const color = isSelected ? '#ffffff' : '#cbd5e1';
            cellsHtml += `
                <button type="button" class="btn btn-sm" onclick="SupervisorSubstitutionModal.selectCalendarDate('${target}', ${this._calendarViewJy}, ${this._calendarViewJm}, ${d})" style="height: 28px; width: 28px; padding: 0; border-radius: 6px; background: ${bg}; color: ${color}; font-size: 0.78rem; font-weight: ${isSelected ? '700' : '500'}; border: none;">
                    ${d}
                </button>
            `;
        }

        pop.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 10px; padding: 0.65rem; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                    <button type="button" class="btn btn-ghost btn-sm" onclick="SupervisorSubstitutionModal.changeCalendarMonth(-1)" style="padding: 2px 7px;">◀</button>
                    <span style="font-weight: 700; font-size: 0.85rem; color: #f8fafc;">${monthName} ${this._calendarViewJy}</span>
                    <button type="button" class="btn btn-ghost btn-sm" onclick="SupervisorSubstitutionModal.changeCalendarMonth(1)" style="padding: 2px 7px;">▶</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; gap: 2px; font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">
                    <div>ش</div><div>ی</div><div>د</div><div>س</div><div>چ</div><div>پ</div><div>ج</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center;">
                    ${cellsHtml}
                </div>
            </div>
        `;
        pop.style.display = 'block';
    },

    selectCalendarDate(target, jy, jm, jd) {
        if (target === 'start') {
            this._startJy = jy;
            this._startJm = jm;
            this._startJd = jd;
            // If end is before start, adjust end
            const sG = this.getGregorianDate('start');
            const eG = this.getGregorianDate('end');
            if (eG < sG) {
                this._endJy = jy;
                this._endJm = jm;
                this._endJd = jd;
                const elabel = document.getElementById('subst-end-shamsi-label');
                if (elabel) elabel.textContent = this.getShamsiDisplay('end');
            }
        } else {
            this._endJy = jy;
            this._endJm = jm;
            this._endJd = jd;
            // If start is after end, adjust start
            const sG = this.getGregorianDate('start');
            const eG = this.getGregorianDate('end');
            if (sG > eG) {
                this._startJy = jy;
                this._startJm = jm;
                this._startJd = jd;
                const slabel = document.getElementById('subst-start-shamsi-label');
                if (slabel) slabel.textContent = this.getShamsiDisplay('start');
            }
        }

        const label = document.getElementById(`subst-${target}-shamsi-label`);
        if (label) label.textContent = this.getShamsiDisplay(target);

        this._activeCalendarTarget = null;
        const pop = document.getElementById(`subst-calendar-popover-${target}`);
        if (pop) pop.style.display = 'none';

        this.checkLiveConflict();
    },

    async submitAdd(e) {
        e.preventDefault();

        const origId = this._origPersonId;
        const subId = this._subPersonId || (document.getElementById('subst-target-select') ? parseInt(document.getElementById('subst-target-select').value, 10) : null);
        const sDate = this.getGregorianDate('start');
        const eDate = this.getGregorianDate('end');
        const note = (document.getElementById('subst-note-input') ? document.getElementById('subst-note-input').value : '').trim();

        if (!origId) {
            App.showToast('لطفاً فرد اصلی دارای شیفت را مشخص کنید.', 'warning');
            return;
        }
        if (!subId) {
            App.showToast('لطفاً همکار جانشین را انتخاب کنید.', 'warning');
            return;
        }
        if (origId === subId) {
            App.showToast('فرد نمی‌تواند به عنوان جانشین خودش تعیین گردد.', 'warning');
            return;
        }

        // If conflict detected, warn supervisor before proceeding
        if (this._conflictInfo && this._conflictInfo.has_conflict) {
            const conflictMsg = this.getLocalizedConflictMessage(this._conflictInfo);
            const confirmed = confirm(
                `${I18n.t('substitution_conflict_confirm') || 'توجه: فرد جانشین در این بازه دارای تداخل برنامه است. آیا مطمئن به ثبت هستید؟'}\n\n${conflictMsg}`
            );
            if (!confirmed) return;
        }

        const saveBtn = document.getElementById('save-subst-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        }

        try {
            await App.api('/api/substitutions', 'POST', {
                original_person_id: origId,
                substitute_person_id: subId,
                start_date: sDate,
                end_date: eDate,
                note: note,
            });

            App.showToast(I18n.t('substitution_saved') || 'جانشینی شیفت با موفقیت ثبت شد.', 'success');

            // Refresh Cockpit data in background
            if (typeof SupervisorCockpit !== 'undefined' && SupervisorCockpit.fetchData) {
                SupervisorCockpit.fetchData();
            }

            // Reload substitutions in modal
            const subs = await App.api('/api/substitutions');
            this._substitutions = Array.isArray(subs) ? subs : [];
            this._subPersonId = null;
            this._conflictInfo = null;
            this.render();
        } catch (err) {
            console.error('Failed to create substitution:', err);
            App.showToast(err.message || 'خطا در ثبت جانشینی', 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = `<span>💾</span> <span>${I18n.t('assign_substitute_btn') || 'ثبت جانشین'}</span>`;
            }
        }
    },

    async deleteSubst(id) {
        const confirmed = confirm(I18n.t('confirm_cancel_substitution') || 'آیا از لغو این جانشینی شیفت اطمینان دارید؟');
        if (!confirmed) return;

        try {
            await App.api(`/api/substitutions/${id}`, 'DELETE');
            App.showToast(I18n.t('substitution_deleted') || 'جانشینی با موفقیت لغو شد.', 'success');

            if (typeof SupervisorCockpit !== 'undefined' && SupervisorCockpit.fetchData) {
                SupervisorCockpit.fetchData();
            }

            const subs = await App.api('/api/substitutions');
            this._substitutions = Array.isArray(subs) ? subs : [];
            this.render();
        } catch (err) {
            console.error('Failed to delete substitution:', err);
            App.showToast(err.message || 'خطا در لغو جانشینی', 'error');
        }
    }
};

