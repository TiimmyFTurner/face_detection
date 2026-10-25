/**
 * PersonShiftModal — Dedicated Modal for Managing Person Shift Timetables,
 * Section/Department Assignments, Shift Times, Breaks & Lunch Presets,
 * Rotational Cycles, and Admin-Defined Workstation Assignments.
 */
const PersonShiftModal = {
    _personId: null,
    _data: null,
    _templates: [],
    _sections: [],
    _cameras: [],
    _allZones: [],
    _selectedZoneIds: new Set(),
    _selectedTemplateId: null,
    _isCustomShift: false,
    _customSubtype: 'fixed', // 'fixed' | 'rotational'
    _startTime: '08:00',
    _endTime: '17:00',
    _activeDays: new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']),
    _gracePeriodMinutes: 15,
    _absenceTimeoutMinutes: 5,
    _freeTimes: [],
    _templateBannerText: '',
    _rotationPattern: {
        pattern_type: '2d_2n_1off',
        cycle: ['day', 'day', 'night', 'night', 'off'],
        anchor_date: '2026-01-01',
        day_start: '07:00',
        day_end: '19:00',
        night_start: '19:00',
        night_end: '07:00',
        grace_period_minutes: 15,
        absence_timeout_minutes: 5,
    },

    /**
     * Open the Shift Management modal for a given person.
     * @param {number} personId
     */
    async show(personId) {
        this._personId = personId;
        this._selectedZoneIds = new Set();
        this._selectedTemplateId = null;
        this._isCustomShift = false;
        this._customSubtype = 'fixed';
        this._freeTimes = [];
        this._templateBannerText = '';

        App.openModal(`
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">⏰</span>
                    <div>
                        <h2 class="modal-title">${I18n.t('manage_shift') || 'مدیریت شیفت و ایستگاه کاری'}</h2>
                        <p class="modal-subtitle">${I18n.t('loading') || 'در حال دریافت اطلاعات...'}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 2.5rem; text-align: center;">
                <div class="spinner-border text-primary mb-3"></div>
                <div>${I18n.t('loading') || 'در حال بارگذاری اطلاعات شیفت و ایستگاه‌ها...'}</div>
            </div>
        `, 'modal-lg');

        try {
            const [shiftData, templates, sections, cameras, allZones] = await Promise.all([
                App.api(`/api/persons/${personId}/shift`),
                App.api('/api/shift-templates'),
                App.api('/api/sections'),
                App.api('/api/cameras').catch(() => []),
                App.api('/api/zones').catch(() => []),
                typeof BreakPresets !== 'undefined' ? BreakPresets.load() : Promise.resolve(),
            ]);

            this._data = shiftData;
            this._templates = templates || [];
            this._sections = sections || [];
            this._cameras = cameras || [];

            // Combine all defined zones and assigned zones into a unified list
            const zoneMap = new Map();
            (allZones || []).forEach(z => zoneMap.set(z.id, z));
            (shiftData.assigned_zones || []).forEach(z => {
                if (!zoneMap.has(z.id)) {
                    zoneMap.set(z.id, z);
                }
            });
            this._allZones = Array.from(zoneMap.values());

            // Pre-select assigned zones
            this._selectedZoneIds = new Set((shiftData.assigned_zones || []).map(z => z.id));

            // Initialize shift timetable and breaks
            if (shiftData.custom_shift) {
                const cs = shiftData.custom_shift;
                this._isCustomShift = true;
                this._selectedTemplateId = null;
                this._freeTimes = Array.isArray(cs.free_times) ? JSON.parse(JSON.stringify(cs.free_times)) : [];
                this._gracePeriodMinutes = cs.grace_period_minutes ?? 15;
                this._absenceTimeoutMinutes = cs.absence_timeout_minutes ?? 5;

                if (cs.shift_type === 'rotational' || cs.shift_type === 'rotation' || cs.rotation_pattern) {
                    this._customSubtype = 'rotational';
                    this._rotationPattern = Object.assign({
                        pattern_type: '2d_2n_1off',
                        cycle: ['day', 'day', 'night', 'night', 'off'],
                        anchor_date: '2026-01-01',
                        day_start: '07:00',
                        day_end: '19:00',
                        night_start: '19:00',
                        night_end: '07:00',
                        grace_period_minutes: 15,
                        absence_timeout_minutes: 5,
                    }, cs.rotation_pattern || {});
                } else {
                    this._customSubtype = 'fixed';
                    this._startTime = cs.start_time || '08:00';
                    this._endTime = cs.end_time || '17:00';
                    this._activeDays = new Set(cs.active_days || ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
                }
            } else if (shiftData.shift_template_id) {
                this._selectedTemplateId = shiftData.shift_template_id;
                this._isCustomShift = false;
                const tmpl = this._templates.find(t => t.id === shiftData.shift_template_id);
                if (tmpl) {
                    this._startTime = tmpl.start_time || '08:00';
                    this._endTime = tmpl.end_time || '17:00';
                    this._activeDays = new Set(tmpl.active_days || ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
                    this._gracePeriodMinutes = tmpl.grace_period_minutes ?? 15;
                    this._absenceTimeoutMinutes = tmpl.absence_timeout_minutes ?? 5;
                    this._freeTimes = Array.isArray(tmpl.free_times) ? JSON.parse(JSON.stringify(tmpl.free_times)) : [];
                    if (tmpl.shift_type === 'rotational') {
                        this._customSubtype = 'rotational';
                        this._rotationPattern = Object.assign({
                            pattern_type: '2d_2n_1off',
                            cycle: ['day', 'day', 'night', 'night', 'off'],
                            anchor_date: '2026-01-01',
                            day_start: '07:00',
                            day_end: '19:00',
                            night_start: '19:00',
                            night_end: '07:00',
                            grace_period_minutes: 15,
                            absence_timeout_minutes: 5,
                        }, tmpl.rotation_pattern || {});
                    } else {
                        this._customSubtype = 'fixed';
                    }
                }
            } else {
                // No fixed shift assigned
                this._selectedTemplateId = 0;
                this._isCustomShift = false;
                this._customSubtype = 'fixed';
                this._startTime = '08:00';
                this._endTime = '17:00';
                this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
                this._gracePeriodMinutes = 15;
                this._absenceTimeoutMinutes = 5;
                this._freeTimes = [];
            }

            this.render();
        } catch (err) {
            console.error('Failed to load shift config:', err);
            App.openModal(`
                <div class="modal-header">
                    <h2 class="modal-title">${I18n.t('test_failed') || 'خطا'}</h2>
                    <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
                </div>
                <div class="modal-body" style="padding: 2rem; text-align: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 1rem;">⚠️</div>
                    <div class="text-danger font-weight-bold mb-3">${this._escape(err.message)}</div>
                </div>
            `);
        }
    },

    _calcRotationToday(pattern) {
        if (!pattern || !pattern.cycle || pattern.cycle.length === 0) return null;
        const cycle = pattern.cycle;
        const anchorStr = String(pattern.anchor_date || '2026-01-01').slice(0, 10);
        const parts = anchorStr.split('-');
        if (parts.length !== 3) return null;
        const anchor = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diffDays = Math.floor((today - anchor) / (1000 * 60 * 60 * 24));
        const idx = ((diffDays % cycle.length) + cycle.length) % cycle.length;
        const state = cycle[idx];
        const stateName = state === 'day' ? 'شیفت روز' : (state === 'night' ? 'شیفت شب' : 'استراحت / آف');
        return {
            index: idx,
            state,
            stateName,
            isDay: state === 'day',
            isNight: state === 'night',
            isOff: state === 'off',
        };
    },

    _renderCycleChips(pattern, showTodayHighlight = true) {
        if (!pattern || !pattern.cycle) return '';
        const rotToday = this._calcRotationToday(pattern);
        const cycle = pattern.cycle;
        const isRtl = I18n.isRTL();

        return cycle.map((st, i) => {
            const isToday = showTodayHighlight && rotToday && (rotToday.index === i);
            let icon = '☀️';
            let label = isRtl ? 'روز' : 'Day';
            let cls = 'day';
            if (st === 'night') {
                icon = '🌙';
                label = isRtl ? 'شب' : 'Night';
                cls = 'night';
            } else if (st === 'off') {
                icon = '☕';
                label = isRtl ? 'آف' : 'Off';
                cls = 'off';
            }
            return `
                <div class="rotation-cycle-chip ${cls} ${isToday ? 'is-today' : ''}" title="${isToday ? 'وضعیت امروز' : ''}">
                    <span>${icon}</span>
                    <span>${label} ${isRtl ? I18n.toPersianDigits(i + 1) : (i + 1)}</span>
                    ${isToday ? '<span class="today-indicator">●</span>' : ''}
                </div>
            `;
        }).join('');
    },

    render() {
        const d = this._data;
        if (!d) return;

        const isFa = I18n.isRTL();

        // 1. Sections options with robust matching and fallback
        const currentSec = (d.section || '').replace(/\r?\n+/g, ' ').trim();
        const norm = s => (s || '').replace(/\r?\n+/g, ' ').replace(/\u200c/g, ' ').trim().toLowerCase();
        let sectionOptions = `<option value="">— ${isFa ? 'بدون بخش (عمومی)' : 'No Section (General)'} —</option>`;
        let matched = false;

        this._sections.forEach(s => {
            const sName = (s.name || '').replace(/\r?\n+/g, ' ').trim();
            if (!sName) return;
            const isSel = (norm(sName) === norm(currentSec));
            if (isSel) matched = true;
            sectionOptions += `<option value="${this._escape(sName)}" ${isSel ? 'selected' : ''}>${this._escape(sName)}</option>`;
        });

        // Ensure current section is always selectable even if not yet in _sections list
        if (currentSec && !matched) {
            sectionOptions += `<option value="${this._escape(currentSec)}" selected>${this._escape(currentSec)}</option>`;
        }

        // 2. Shift Templates Selector Cards (Roomy 2-column layout)
        const isNoShift = (!this._isCustomShift && this._selectedTemplateId === 0);
        let templateCardsHtml = `
            <div class="shift-card-option ${isNoShift ? 'active' : ''}" onclick="PersonShiftModal.selectTemplate(0, false)" style="padding: 0.65rem 0.85rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                    <strong style="font-size: 0.86rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;">
                        <span>🚫</span>
                        <span style="overflow: hidden; text-overflow: ellipsis;">${isFa ? 'بدون شیفت ثابت (شناور)' : 'No Fixed Shift (Flexible)'}</span>
                    </strong>
                    <span class="badge badge-subtle text-xs" style="white-space: nowrap; flex-shrink: 0; padding: 2px 8px; font-weight: 600;">${isFa ? 'شناور' : 'Flexible'}</span>
                </div>
                <div class="text-muted text-xs" style="line-height: 1.4; color: var(--text-secondary);" dir="auto">
                    ${isFa ? 'ساعات حضور ثبت می‌شود اما کنترل عدم حضور سخت‌گیرانه اعمال نمی‌شود.' : 'Attendance is recorded, but strict absence alert is not enforced.'}
                </div>
            </div>
        `;

        this._templates.forEach(t => {
            const active = (!this._isCustomShift && this._selectedTemplateId === t.id);
            const isRot = (t.shift_type === 'rotational');
            const timeDisp = isRot
                ? (isFa ? 'چرخشی' : 'Rotational')
                : `${t.start_time || '08:00'} - ${t.end_time || '17:00'}`;

            const cadenceText = isRot
                ? (t.rotation_pattern?.cycle?.length ? (isFa ? `چرخه ${t.rotation_pattern.cycle.length} روزه` : `${t.rotation_pattern.cycle.length}-day cycle`) : (isFa ? 'نوبت‌کاری گردشی' : 'Rotational Cycle'))
                : (isFa ? `${(t.active_days || []).length} روز در هفته` : `${(t.active_days || []).length} days / wk`);

            const graceMins = t.grace_period_minutes ?? 15;
            const absenceMins = t.absence_timeout_minutes ?? 5;
            const timingText = isFa
                ? `تاخیر: ${graceMins}د · هشدار: ${absenceMins}د`
                : `Grace: ${graceMins}m · Alert: ${absenceMins}m`;

            templateCardsHtml += `
                <div class="shift-card-option ${active ? 'active' : ''}" onclick="PersonShiftModal.selectTemplate(${t.id}, false)" style="padding: 0.65rem 0.85rem;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                        <strong style="font-size: 0.86rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;" title="${this._escape(t.name)}">
                            <span>${isRot ? '🔄' : '📋'}</span>
                            <span style="overflow: hidden; text-overflow: ellipsis;">${this._escape(t.name)}</span>
                        </strong>
                        <span class="badge text-xs" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; direction: ltr; font-family: monospace; white-space: nowrap; flex-shrink: 0; padding: 2px 8px; font-weight: 700;">${timeDisp}</span>
                    </div>
                    <div class="text-muted text-xs" style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 4px; font-size: 0.76rem;">
                        <span style="font-weight: 500;" dir="auto">${cadenceText}</span>
                        <span style="opacity: 0.85;" dir="auto">${timingText}</span>
                    </div>
                </div>
            `;
        });

        templateCardsHtml += `
            <div class="shift-card-option ${this._isCustomShift ? 'active' : ''}" onclick="PersonShiftModal.selectTemplate(null, true)" style="padding: 0.65rem 0.85rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                    <strong style="font-size: 0.86rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;">
                        <span>⚙️</span>
                        <span style="overflow: hidden; text-overflow: ellipsis;">${isFa ? 'شیفت سفارشی (تنظیم دستی ساعات)' : 'Custom Shift (Manual Timing)'}</span>
                    </strong>
                    <span class="badge badge-subtle text-xs" style="white-space: nowrap; flex-shrink: 0; padding: 2px 8px; font-weight: 600;">${isFa ? 'شخصی‌سازی' : 'Custom'}</span>
                </div>
                <div class="text-muted text-xs" style="line-height: 1.4; color: var(--text-secondary);" dir="auto">
                    ${isFa ? 'تعیین ساعت شروع، پایان و روزهای کاری به صورت اختصاصی برای این فرد.' : 'Set custom start/end times and workdays specifically for this person.'}
                </div>
            </div>
        `;

        // 3. Work Days Checkboxes
        const dayLabels = [
            { id: 'Sat', label_fa: 'شنبه', label_en: 'Sat' },
            { id: 'Sun', label_fa: '۱شنبه', label_en: 'Sun' },
            { id: 'Mon', label_fa: '۲شنبه', label_en: 'Mon' },
            { id: 'Tue', label_fa: '۳شنبه', label_en: 'Tue' },
            { id: 'Wed', label_fa: '۴شنبه', label_en: 'Wed' },
            { id: 'Thu', label_fa: '۵شنبه', label_en: 'Thu' },
            { id: 'Fri', label_fa: 'جمعه', label_en: 'Fri' },
        ];

        let daysCheckboxesHtml = dayLabels.map(day => `
            <label class="day-checkbox-label ${this._activeDays.has(day.id) ? 'checked' : ''}" onclick="PersonShiftModal.toggleDay('${day.id}')">
                <input type="checkbox" class="shift-day-cb" value="${day.id}" ${this._activeDays.has(day.id) ? 'checked' : ''}>
                <span>${isFa ? day.label_fa : day.label_en}</span>
            </label>
        `).join('');

        // 4. Admin-Defined Workstations (Camera Zones) List
        const camMap = new Map();
        this._cameras.forEach(c => camMap.set(c.id, c));

        let workstationsHtml = '';
        if (this._allZones.length === 0) {
            workstationsHtml = `
                <div class="p-3 text-center card-glass" style="border-radius: var(--radius-sm); border: 1px dashed var(--border-subtle);" dir="auto">
                    <span style="font-size: 1.5rem; display: block; margin-bottom: 0.35rem; opacity: 0.7;">📹</span>
                    <strong style="display: block; font-size: 0.86rem; color: var(--text-secondary);">${isFa ? 'ایستگاه‌های کاری دوربین توسط مدیر سیستم در بخش دوربین‌ها و مناطق تعریف می‌شوند.' : 'Workstation camera zones are configured by the system administrator.'}</strong>
                    <small class="text-muted" style="display: block; margin-top: 3px;">${isFa ? 'در حال حاضر منطقه‌ای در سامانه یافت نشد. به محض تعریف مناطق توسط مدیر، در اینجا قابل مشاهده خواهند بود.' : 'No zones are currently defined. Once created by admin, they will appear here.'}</small>
                </div>
            `;
        } else {
            const shiftSummary = this.getShiftTimingSummary();
            const zoneItemsHtml = this._allZones.map(z => {
                const checked = this._selectedZoneIds.has(z.id);
                const cam = camMap.get(z.camera_id);
                const camName = z.camera_name || (cam ? cam.name : `Camera #${z.camera_id}`);
                return `
                    <label class="station-zone-item ${checked ? 'selected' : ''}" id="station-zone-card-${z.id}" style="cursor: pointer; position: relative;">
                        <input type="checkbox" class="person-zone-cb" value="${z.id}" ${checked ? 'checked' : ''} onchange="PersonShiftModal.toggleZone(${z.id}, this.checked, this)">
                        <div class="station-zone-info" style="flex: 1;">
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 4px;">
                                <strong class="station-zone-name" style="font-size: 0.88rem; color: var(--text-primary); display: inline-flex; align-items: center; gap: 4px;">
                                    <span>🎯</span>
                                    <span>${this._escape(z.name)}</span>
                                </strong>
                                <span class="station-zone-status-badge">
                                    ${checked 
                                        ? `<span class="badge badge-success text-xs" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 9999px;">🟢 ${isFa ? 'ایستگاه فعال پرسنل' : 'Active Workstation'}</span>` 
                                        : `<span class="badge badge-subtle text-xs" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 9999px; opacity: 0.7;">${isFa ? 'تعریف‌شده توسط مدیر' : 'Admin Defined'}</span>`
                                    }
                                </span>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem;">
                                <div style="color: var(--text-secondary); display: flex; align-items: center; gap: 4px; font-size: 0.76rem;">
                                    <span>📹</span>
                                    <span>${isFa ? 'دوربین فیزیکی:' : 'Camera:'}</span>
                                    <strong style="color: var(--text-primary); direction: ltr; font-family: monospace;">${this._escape(camName)}</strong>
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                                    <span style="display: inline-flex; align-items: center; gap: 4px; color: ${checked ? '#38bdf8' : 'var(--text-secondary)'}; font-size: 0.76rem; font-weight: 600;">
                                        <span>⏰</span>
                                        <span>${isFa ? 'شیفت کاری انتخابی سرپرست:' : 'Supervisor Assigned Shift:'}</span>
                                    </span>
                                    <strong class="workstation-shift-display" style="direction: ltr; font-family: monospace; font-size: 0.82rem; font-weight: 800; color: #38bdf8; background: rgba(56, 189, 248, 0.12); padding: 1px 7px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.3);">${shiftSummary.timeWindow}</strong>
                                    <span class="badge workstation-shift-badge" style="font-size: 0.66rem; padding: 1px 6px; background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-weight: 700;">${shiftSummary.badge}</span>
                                </div>
                            </div>
                        </div>
                    </label>
                `;
            }).join('');

            workstationsHtml = `
                <div class="zones-subgrid">
                    ${zoneItemsHtml}
                </div>
            `;
        }

        const pat = this._rotationPattern;
        const isRot = (this._customSubtype === 'rotational');

        const modalHtml = `
            <div class="modal-header" style="padding: 1rem 1.25rem;">
                <div class="modal-title-group" style="display: flex; align-items: center; gap: 0.75rem;">
                    <span class="modal-icon" style="font-size: 1.4rem;">⏰</span>
                    <div>
                        <h2 class="modal-title" style="margin: 0; font-size: 1.15rem;">${I18n.t('manage_shift') || (isFa ? 'مدیریت شیفت کاری، ساعات و اوقات استراحت' : 'Manage Work Shift, Timetable & Breaks')}</h2>
                        <p class="modal-subtitle" style="margin: 0; color: var(--text-secondary); font-size: 0.82rem;" dir="auto">
                            <strong>${this._escape(d.person_name)}</strong> ${d.role ? `(${this._escape(d.role)})` : ''} ${d.section ? `· ${isFa ? 'بخش:' : 'Section:'} ${this._escape(d.section)}` : ''}
                        </p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1rem 1.25rem; max-height: 82vh; overflow-y: auto;">
                <form id="person-shift-form" onsubmit="PersonShiftModal.save(event)">
                    <!-- Section Selection -->
                    <div class="card-glass mb-2" style="padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <label class="form-label font-weight-bold d-flex align-items-center gap-2 mb-1" for="person-shift-section" style="font-size: 0.86rem;">
                            <span>🏢</span>
                            <span>${I18n.t('section') || (isFa ? 'بخش سازمانی / دپارتمان' : 'Section')}</span>
                        </label>
                        <div class="d-flex gap-2">
                            <select id="person-shift-section" class="form-control form-select" style="height: 38px; padding: 6px 12px; font-weight: 600; font-size: 0.88rem; flex: 1;">
                                ${sectionOptions}
                            </select>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="PersonShiftModal.quickAddSection()" title="${isFa ? 'افزودن بخش جدید' : 'Add New Section'}" style="padding: 0 14px; height: 38px;">
                                ➕
                            </button>
                        </div>
                        <small class="text-muted d-block text-xs mt-1" dir="auto" style="line-height: 1.4;">
                            ${isFa ? 'انتساب فرد به بخش کارخانه، باعث دسترسی خودکار سرپرست این بخش به سوابق و وضعیت حضور او می‌شود.' : 'Assigning a person to a factory section automatically grants that section\'s supervisor access to their records and attendance status.'}
                        </small>
                    </div>

                    <!-- Shift Templates Selection Grid -->
                    <div class="card-glass mb-2" style="padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-1">
                            <label class="form-label font-weight-bold d-flex align-items-center gap-2 m-0" style="font-size: 0.86rem;">
                                <span>⚡</span>
                                <span>${I18n.t('shift_template') || (isFa ? 'الگوهای شیفت کاری (انتخاب سریع یا شخصی‌سازی ساعات)' : 'Shift Templates')}</span>
                            </label>
                            <small class="text-muted text-xs" dir="auto">
                                ${isFa ? 'انتخاب الگو مقادیر را بارگذاری کرده و می‌توانید ساعات و استراحت را تغییر دهید.' : 'Selecting a template loads defaults; times and breaks remain customizable.'}
                            </small>
                        </div>

                        <div class="shift-templates-grid mb-2">
                            ${templateCardsHtml}
                        </div>

                        ${this._templateBannerText ? `
                            <div class="shift-active-template-banner" style="margin-top: 0.5rem; margin-bottom: 0;">
                                <span>💡</span>
                                <span>${this._escape(this._templateBannerText)}</span>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Shift Timing & Work Days Configuration (Always Editable) -->
                    <div class="card-glass mb-2" style="padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-medium); background: var(--bg-surface-hover);">
                        <div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                            <h4 style="margin: 0; font-size: 0.92rem; display: flex; align-items: center; gap: 0.4rem; color: var(--text-primary);">
                                <span>⏱️</span>
                                <span>${isFa ? 'تنظیم ساعات کار شیفت (Shift Timing)' : 'Shift Timing & Working Hours'}</span>
                            </h4>

                            <!-- Segmented Switch: Fixed vs Rotational -->
                            <div class="rotation-type-segmented" style="margin-bottom: 0;">
                                <button type="button" class="rotation-segmented-btn ${!isRot ? 'active' : ''}" onclick="PersonShiftModal.switchCustomSubtype('fixed')">
                                    <span>📅</span>
                                    <span>${I18n.t('shift_mode_fixed') || (isFa ? 'شیفت ثابت هفتگی' : 'Fixed Weekly Shift')}</span>
                                </button>
                                <button type="button" class="rotation-segmented-btn ${isRot ? 'active' : ''}" onclick="PersonShiftModal.switchCustomSubtype('rotational')">
                                    <span>🔄</span>
                                    <span>${I18n.t('shift_mode_rotational') || (isFa ? 'نوبت‌کاری چرخشی' : 'Rotational Shift')}</span>
                                </button>
                            </div>
                        </div>

                        <!-- Fixed Shift Form -->
                        <div id="fixed-config-section" style="display: ${!isRot ? 'block' : 'none'};">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.65rem; margin-bottom: 0.75rem;">
                                <div>
                                    <label class="form-label text-xs font-weight-bold" style="color: var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                                        <span>🕒</span>
                                        <span>${I18n.t('start_time') || (isFa ? 'ساعت شروع شیفت' : 'Shift Start Time')}</span>
                                    </label>
                                    <input type="time" id="shift-start-time" class="form-control form-control-sm" value="${this._startTime}" oninput="PersonShiftModal.updateWorkstationShiftLabels()" style="height: 38px; padding: 6px 10px; font-weight: 700; font-family: monospace;" />
                                </div>
                                <div>
                                    <label class="form-label text-xs font-weight-bold" style="color: var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                                        <span>🕒</span>
                                        <span>${I18n.t('end_time') || (isFa ? 'ساعت پایان شیفت' : 'Shift End Time')}</span>
                                    </label>
                                    <input type="time" id="shift-end-time" class="form-control form-control-sm" value="${this._endTime}" oninput="PersonShiftModal.updateWorkstationShiftLabels()" style="height: 38px; padding: 6px 10px; font-weight: 700; font-family: monospace;" />
                                </div>
                                <div>
                                    <label class="form-label text-xs font-weight-bold" style="color: var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                                        <span>⏳</span>
                                        <span>${I18n.t('grace_period_minutes') || (isFa ? 'مهلت تاخیر (دقیقه)' : 'Grace Period (min)')}</span>
                                    </label>
                                    <input type="number" id="shift-grace-mins" class="form-control form-control-sm" min="0" max="60" value="${this._gracePeriodMinutes}" style="height: 38px; padding: 6px 10px;" />
                                </div>
                                <div>
                                    <label class="form-label text-xs font-weight-bold" style="color: var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                                        <span>🚨</span>
                                        <span>${I18n.t('absence_timeout_minutes') || (isFa ? 'هشدار غیبت (دقیقه)' : 'Absence Alert (min)')}</span>
                                    </label>
                                    <input type="number" id="shift-absence-mins" class="form-control form-control-sm" min="1" max="60" value="${this._absenceTimeoutMinutes}" style="height: 38px; padding: 6px 10px;" />
                                </div>
                            </div>

                            <!-- Active Work Days Checkboxes -->
                            <div style="background: rgba(0, 0, 0, 0.18); padding: 0.65rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                <div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                                    <label class="form-label text-xs font-weight-bold m-0" style="color: var(--text-secondary); display: flex; align-items: center; gap: 5px;">
                                        <span>📅</span>
                                        <span>${I18n.t('active_days') || (isFa ? 'روزهای کاری فعال در هفته:' : 'Active Working Days:')}</span>
                                    </label>
                                    <div class="d-flex gap-1">
                                        <button type="button" class="btn btn-ghost btn-sm" onclick="PersonShiftModal.setDaysPreset('sat-wed')" style="padding: 2px 8px; font-size: 0.72rem; border: 1px solid var(--border-subtle); border-radius: 6px;">
                                            ${isFa ? 'شنبه تا ۴شنبه' : 'Sat – Wed'}
                                        </button>
                                        <button type="button" class="btn btn-ghost btn-sm" onclick="PersonShiftModal.setDaysPreset('sat-thu')" style="padding: 2px 8px; font-size: 0.72rem; border: 1px solid var(--border-subtle); border-radius: 6px;">
                                            ${isFa ? 'شنبه تا ۵شنبه' : 'Sat – Thu'}
                                        </button>
                                        <button type="button" class="btn btn-ghost btn-sm" onclick="PersonShiftModal.setDaysPreset('all')" style="padding: 2px 8px; font-size: 0.72rem; border: 1px solid var(--border-subtle); border-radius: 6px;">
                                            ${isFa ? 'همه روزها' : 'All Days'}
                                        </button>
                                    </div>
                                </div>
                                <div class="days-checkboxes-bar" id="shift-days-bar" style="display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0;">
                                    ${daysCheckboxesHtml}
                                </div>
                            </div>
                        </div>

                        <!-- Rotational Shift Form -->
                        <div id="rotational-config-section" style="display: ${isRot ? 'block' : 'none'};">
                            <div class="mb-2">
                                <label class="form-label text-xs font-weight-bold" style="color: var(--text-secondary);">${isFa ? 'الگوی چرخه نوبت‌کاری:' : 'Rotational Cycle Pattern:'}</label>
                                <div class="rotation-presets-grid">
                                    <div class="rotation-preset-card ${pat.pattern_type === '2d_2n_1off' ? 'active' : ''}" onclick="PersonShiftModal.setRotationPreset('2d_2n_1off')">
                                        <span class="rotation-preset-title">${isFa ? '۲ روز، ۲ شب، ۱ آف ⭐' : '2 Day, 2 Night, 1 Off ⭐'}</span>
                                        <span class="rotation-preset-sub">${isFa ? 'چرخه ۵ روزه (روز، روز، شب، شب، آف)' : '5-day cycle (Day, Day, Night, Night, Off)'}</span>
                                    </div>
                                    <div class="rotation-preset-card ${pat.pattern_type === '2d_2n_2off' ? 'active' : ''}" onclick="PersonShiftModal.setRotationPreset('2d_2n_2off')">
                                        <span class="rotation-preset-title">${isFa ? '۲ روز، ۲ شب، ۲ آف' : '2 Day, 2 Night, 2 Off'}</span>
                                        <span class="rotation-preset-sub">${isFa ? 'چرخه ۶ روزه (۲ روزکار، ۲ شب، ۲ آف)' : '6-day cycle (2 Day, 2 Night, 2 Off)'}</span>
                                    </div>
                                    <div class="rotation-preset-card ${pat.pattern_type === '24_48' ? 'active' : ''}" onclick="PersonShiftModal.setRotationPreset('24_48')">
                                        <span class="rotation-preset-title">${isFa ? '۲۴ ساعت کار، ۴۸ آف' : '24h Duty, 48h Off'}</span>
                                        <span class="rotation-preset-sub">${isFa ? 'چرخه ۴ روزه (روز، شب، ۲ آف)' : '4-day cycle (Day, Night, 2 Off)'}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Visual Cycle Timeline -->
                            <div class="mb-2">
                                <div class="d-flex align-items-center justify-content-between mb-1">
                                    <label class="form-label text-xs font-weight-bold m-0" style="color: var(--text-secondary);">${isFa ? 'پیش‌نمایش چرخه نوبت‌کاری:' : 'Rotation Cycle Preview:'}</label>
                                    <span class="text-xs text-muted" id="rot-timeline-info" dir="auto">${isFa ? `طول چرخه: ${pat.cycle.length} روز` : `Cycle Length: ${pat.cycle.length} days`}</span>
                                </div>
                                <div class="rotation-cycle-timeline" id="rotation-cycle-chips-container">
                                    ${this._renderCycleChips(pat, true)}
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.65rem; margin-bottom: 0.75rem;">
                                <div>
                                    <label class="form-label text-xs font-weight-bold" style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                                        <span>📅</span>
                                        <span>${I18n.t('rotation_anchor_date') || (isFa ? 'تاریخ مبنای شروع چرخه' : 'Cycle Anchor Date')}</span>
                                    </label>
                                    <input type="date" id="rot-anchor-date" class="form-control form-control-sm" value="${pat.anchor_date || '2026-01-01'}" oninput="PersonShiftModal.updateRotationTimeline()" onchange="PersonShiftModal.updateRotationTimeline()" style="height: 38px; padding: 6px 10px;">
                                    <div class="text-xs text-muted" id="rot-anchor-shamsi-display" style="margin-top: 3px; font-weight: 600;">📅 ${typeof I18n.formatDate === 'function' ? I18n.formatDate(pat.anchor_date || '2026-01-01') : (pat.anchor_date || '')}</div>
                                </div>
                                <div>
                                    <label class="form-label text-xs font-weight-bold" style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                                        <span>☀️</span>
                                        <span>${I18n.t('rotation_day_shift') || (isFa ? 'ساعت شیفت روز' : 'Day Shift Hours')}</span>
                                    </label>
                                    <div class="d-flex align-items-center gap-1">
                                        <input type="time" id="rot-day-start" class="form-control form-control-sm" value="${pat.day_start || '07:00'}" oninput="PersonShiftModal.updateWorkstationShiftLabels()" style="height: 38px; padding: 6px 8px; font-weight: 700;">
                                        <span class="text-xs text-muted">${isFa ? 'تا' : 'to'}</span>
                                        <input type="time" id="rot-day-end" class="form-control form-control-sm" value="${pat.day_end || '19:00'}" oninput="PersonShiftModal.updateWorkstationShiftLabels()" style="height: 38px; padding: 6px 8px; font-weight: 700;">
                                    </div>
                                </div>
                                <div>
                                    <label class="form-label text-xs font-weight-bold" style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                                        <span>🌙</span>
                                        <span>${I18n.t('rotation_night_shift') || (isFa ? 'ساعت شیفت شب' : 'Night Shift Hours')}</span>
                                    </label>
                                    <div class="d-flex align-items-center gap-1">
                                        <input type="time" id="rot-night-start" class="form-control form-control-sm" value="${pat.night_start || '19:00'}" oninput="PersonShiftModal.updateWorkstationShiftLabels()" style="height: 38px; padding: 6px 8px; font-weight: 700;">
                                        <span class="text-xs text-muted">${isFa ? 'تا' : 'to'}</span>
                                        <input type="time" id="rot-night-end" class="form-control form-control-sm" value="${pat.night_end || '07:00'}" oninput="PersonShiftModal.updateWorkstationShiftLabels()" style="height: 38px; padding: 6px 8px; font-weight: 700;">
                                    </div>
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; margin-bottom: 0.4rem;">
                                <div>
                                    <label class="form-label text-xs" style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                                        <span>⏳</span>
                                        <span>${I18n.t('grace_period_minutes') || (isFa ? 'مهلت مجاز تاخیر (دقیقه)' : 'Grace Period (min)')}</span>
                                    </label>
                                    <input type="number" id="rot-grace" class="form-control form-control-sm" min="0" max="60" value="${pat.grace_period_minutes ?? 15}" style="height: 38px; padding: 6px 10px;">
                                </div>
                                <div>
                                    <label class="form-label text-xs" style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                                        <span>🚨</span>
                                        <span>${I18n.t('absence_timeout_minutes') || (isFa ? 'هشدار عدم حضور (دقیقه)' : 'Absence Alert (min)')}</span>
                                    </label>
                                    <input type="number" id="rot-absence" class="form-control form-control-sm" min="1" max="60" value="${pat.absence_timeout_minutes ?? 5}" style="height: 38px; padding: 6px 10px;">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Free Times & Lunch Breaks Section -->
                    <div class="card-glass mb-2" style="padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-medium); background: rgba(59, 130, 246, 0.04);">
                        <div class="d-flex justify-content-between align-items-center mb-1 flex-wrap gap-1">
                            <h4 style="margin: 0; font-size: 0.92rem; display: flex; align-items: center; gap: 0.4rem; color: var(--text-primary);">
                                <span>☕</span>
                                <span>${I18n.t('person_shift_breaks_label') || (isFa ? 'اوقات استراحت، ناهار و اوقات آزاد' : 'Breaks, Lunch & Free Times')}</span>
                            </h4>
                            <span class="badge badge-subtle text-xs" id="person-breaks-count-badge" style="padding: 3px 9px;" dir="auto">
                                ${isFa ? `${(this._freeTimes || []).length} بازه فعال` : `${(this._freeTimes || []).length} Active Breaks`}
                            </span>
                        </div>
                        <small class="text-muted d-block text-xs mb-2" dir="auto" style="line-height: 1.4;">
                            ${isFa ? 'در طول بازه‌های استراحت ثبت‌شده، حضور پرسنل به عنوان «زمان استراحت» منظور شده و هیچ‌گونه هشدار غیبت یا کسر کار صادر نخواهد شد.' : 'During registered break intervals, employee presence is treated as break time without issuing absence alerts.'}
                        </small>

                        <!-- Active Breaks List -->
                        <div id="person-free-times-list" class="d-flex flex-column gap-2 mb-2">
                            ${this.renderFreeTimesListHtml()}
                        </div>

                        <!-- Direct Add Break Row -->
                        <div class="d-flex align-items-center gap-2 mb-2 flex-wrap" style="background: rgba(0, 0, 0, 0.15); padding: 0.5rem 0.7rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <input type="text" id="person-free-time-name" class="form-control form-control-sm" placeholder="${isFa ? 'عنوان (مثال: ناهار، استراحت، چای)' : 'Break Title (e.g. Lunch, Tea)'}" style="flex: 2; min-width: 140px; height: 36px; padding: 4px 10px; font-size: 0.82rem;" />
                            <div class="d-flex align-items-center gap-1" style="flex: 2; min-width: 170px;">
                                <input type="time" id="person-free-time-start" class="form-control form-control-sm" value="12:00" style="height: 36px; padding: 4px 8px; font-weight: 700; font-family: monospace;" />
                                <span class="text-xs text-muted">${isFa ? 'تا' : 'to'}</span>
                                <input type="time" id="person-free-time-end" class="form-control form-control-sm" value="13:00" style="height: 36px; padding: 4px 8px; font-weight: 700; font-family: monospace;" />
                            </div>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="PersonShiftModal.addFreeTimeFromInputs()" style="height: 36px; padding: 0 14px; font-size: 0.82rem; white-space: nowrap; font-weight: 600;">
                                ${isFa ? '➕ افزودن بازه' : '➕ Add Break'}
                            </button>
                        </div>

                        <!-- Fast Presets Toolbar -->
                        <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px dashed var(--border-subtle);">
                            <span class="text-xs text-muted" style="margin-inline-end: 0.25rem;">${isFa ? '⚡ میانبرهای متداول:' : '⚡ Quick Presets:'}</span>
                            <button type="button" class="btn btn-ghost btn-sm" onclick="PersonShiftModal.applyBreakPreset('${isFa ? 'ناهار و استراحت' : 'Lunch Break'}', '12:00', '13:00')" style="padding: 2px 8px; font-size: 0.74rem; border-radius: 12px; border: 1px solid var(--border-subtle);">
                                ${isFa ? '🍽️ ناهار (۱۲:۰۰ - ۱۳:۰۰)' : '🍽️ Lunch (12:00 - 13:00)'}
                            </button>
                            <button type="button" class="btn btn-ghost btn-sm" onclick="PersonShiftModal.applyBreakPreset('${isFa ? 'ناهار و نماز' : 'Lunch & Prayer'}', '12:30', '13:30')" style="padding: 2px 8px; font-size: 0.74rem; border-radius: 12px; border: 1px solid var(--border-subtle);">
                                ${isFa ? '🍱 ناهار و نماز (۱۲:۳۰ - ۱۳:۳۰)' : '🍱 Lunch & Prayer (12:30 - 13:30)'}
                            </button>
                            <button type="button" class="btn btn-ghost btn-sm" onclick="PersonShiftModal.applyBreakPreset('${isFa ? 'عصرانه و چای' : 'Tea Break'}', '16:00', '16:30')" style="padding: 2px 8px; font-size: 0.74rem; border-radius: 12px; border: 1px solid var(--border-subtle);">
                                ${isFa ? '☕ عصرانه و چای (۱۶:۰۰ - ۱۶:۳۰)' : '☕ Tea Break (16:00 - 16:30)'}
                            </button>
                            <button type="button" class="btn btn-ghost btn-sm" onclick="PersonShiftModal.applyBreakPreset('${isFa ? 'استراحت شبانه' : 'Night Break'}', '03:00', '03:45')" style="padding: 2px 8px; font-size: 0.74rem; border-radius: 12px; border: 1px solid var(--border-subtle);">
                                ${isFa ? '🌙 استراحت شبانه (۰۳:۰۰ - ۰۳:۴۵)' : '🌙 Night Break (03:00 - 03:45)'}
                            </button>
                        </div>
                    </div>

                    <!-- Workstation Assignment (Camera Zones Defined by Admin) -->
                    <div class="card-glass mb-3" style="padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <div class="d-flex justify-content-between align-items-center mb-1 flex-wrap gap-1">
                            <label class="form-label font-weight-bold d-flex align-items-center gap-2 m-0" style="font-size: 0.86rem;">
                                <span>🎯</span>
                                <span>${I18n.t('assigned_workstations') || (isFa ? 'ایستگاه‌های کاری منتسب (تعریف‌شده توسط مدیر سیستم)' : 'Assigned Workstations (Defined by Admin)')}</span>
                            </label>
                            <span class="badge badge-subtle text-xs" id="selected-zones-count-badge" style="padding: 3px 9px;" dir="auto">
                                ${isFa ? `${this._selectedZoneIds.size} ایستگاه انتخاب شده` : `${this._selectedZoneIds.size} Workstations Selected`}
                            </span>
                        </div>
                        <small class="text-muted d-block text-xs mb-2" dir="auto" style="line-height: 1.4;">
                            ${isFa ? 'محدوده‌ها و دوربین‌های ایستگاه‌های کاری توسط مدیر سیستم تعریف شده‌اند، اما ساعت کار، بازه زمانی و الزامات حضور در این ایستگاه‌ها کاملاً مطابق شیفت انتخابی شما در بالا اعمال می‌شود.' : 'Workstation camera zones are configured by the administrator, but working hours and presence rules follow your selected shift schedule above.'}
                        </small>
                        <div class="workstations-container">
                            ${workstationsHtml}
                        </div>
                    </div>

                    <div class="modal-actions" style="padding: 0.75rem 0 0 0; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; gap: 0.75rem;">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || (isFa ? 'انصراف' : 'Cancel')}</button>
                        <button type="submit" id="save-shift-btn" class="btn btn-primary" style="padding: 7px 22px; font-weight: 700; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);">
                            <span>💾</span>
                            <span>${I18n.t('save') || (isFa ? 'ذخیره شیفت، استراحت و ایستگاه‌ها' : 'Save Shift Schedule')}</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        App.openModal(modalHtml, 'modal-lg');
    },

    switchCustomSubtype(type) {
        this._customSubtype = type;
        const rotSec = document.getElementById('rotational-config-section');
        const fixSec = document.getElementById('fixed-config-section');
        if (rotSec) rotSec.style.display = (type === 'rotational') ? 'block' : 'none';
        if (fixSec) fixSec.style.display = (type === 'fixed') ? 'block' : 'none';

        document.querySelectorAll('.rotation-segmented-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const btns = document.querySelectorAll('.rotation-segmented-btn');
        if (type === 'fixed' && btns[0]) btns[0].classList.add('active');
        if (type === 'rotational' && btns[1]) btns[1].classList.add('active');
        this.updateWorkstationShiftLabels();
    },

    toggleDay(dayId) {
        if (this._activeDays.has(dayId)) {
            this._activeDays.delete(dayId);
        } else {
            this._activeDays.add(dayId);
        }
        const bar = document.getElementById('shift-days-bar');
        if (bar) {
            const isFa = I18n.isRTL();
            const dayLabels = [
                { id: 'Sat', label_fa: 'شنبه', label_en: 'Sat' },
                { id: 'Sun', label_fa: '۱شنبه', label_en: 'Sun' },
                { id: 'Mon', label_fa: '۲شنبه', label_en: 'Mon' },
                { id: 'Tue', label_fa: '۳شنبه', label_en: 'Tue' },
                { id: 'Wed', label_fa: '۴شنبه', label_en: 'Wed' },
                { id: 'Thu', label_fa: '۵شنبه', label_en: 'Thu' },
                { id: 'Fri', label_fa: 'جمعه', label_en: 'Fri' },
            ];
            bar.innerHTML = dayLabels.map(day => `
                <label class="day-checkbox-label ${this._activeDays.has(day.id) ? 'checked' : ''}" onclick="PersonShiftModal.toggleDay('${day.id}')">
                    <input type="checkbox" class="shift-day-cb" value="${day.id}" ${this._activeDays.has(day.id) ? 'checked' : ''}>
                    <span>${isFa ? day.label_fa : day.label_en}</span>
                </label>
            `).join('');
        }
    },

    setDaysPreset(type) {
        if (type === 'sat-wed') {
            this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
        } else if (type === 'sat-thu') {
            this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
        } else if (type === 'all') {
            this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        }
        const bar = document.getElementById('shift-days-bar');
        if (bar) {
            const isFa = I18n.isRTL();
            const dayLabels = [
                { id: 'Sat', label_fa: 'شنبه', label_en: 'Sat' },
                { id: 'Sun', label_fa: '۱شنبه', label_en: 'Sun' },
                { id: 'Mon', label_fa: '۲شنبه', label_en: 'Mon' },
                { id: 'Tue', label_fa: '۳شنبه', label_en: 'Tue' },
                { id: 'Wed', label_fa: '۴شنبه', label_en: 'Wed' },
                { id: 'Thu', label_fa: '۵شنبه', label_en: 'Thu' },
                { id: 'Fri', label_fa: 'جمعه', label_en: 'Fri' },
            ];
            bar.innerHTML = dayLabels.map(day => `
                <label class="day-checkbox-label ${this._activeDays.has(day.id) ? 'checked' : ''}" onclick="PersonShiftModal.toggleDay('${day.id}')">
                    <input type="checkbox" class="shift-day-cb" value="${day.id}" ${this._activeDays.has(day.id) ? 'checked' : ''}>
                    <span>${isFa ? day.label_fa : day.label_en}</span>
                </label>
            `).join('');
        }
    },

    setRotationPreset(type) {
        if (type === '2d_2n_1off') {
            this._rotationPattern.pattern_type = '2d_2n_1off';
            this._rotationPattern.cycle = ['day', 'day', 'night', 'night', 'off'];
        } else if (type === '2d_2n_2off') {
            this._rotationPattern.pattern_type = '2d_2n_2off';
            this._rotationPattern.cycle = ['day', 'day', 'night', 'night', 'off', 'off'];
        } else if (type === '24_48') {
            this._rotationPattern.pattern_type = '24_48';
            this._rotationPattern.cycle = ['day', 'night', 'off', 'off'];
        }

        document.querySelectorAll('.rotation-preset-card').forEach(card => card.classList.remove('active'));
        if (event && event.currentTarget) {
            event.currentTarget.classList.add('active');
        }

        const infoEl = document.getElementById('rot-timeline-info');
        if (infoEl) infoEl.textContent = `طول چرخه: ${this._rotationPattern.cycle.length} روز`;

        this.updateRotationTimeline();
    },

    updateRotationTimeline() {
        const anchorInput = document.getElementById('rot-anchor-date');
        if (anchorInput && anchorInput.value) {
            this._rotationPattern.anchor_date = anchorInput.value;
            const shamsiEl = document.getElementById('rot-anchor-shamsi-display');
            if (shamsiEl && typeof I18n.formatDate === 'function') {
                shamsiEl.textContent = '📅 ' + I18n.formatDate(anchorInput.value);
            }
        }
        const container = document.getElementById('rotation-cycle-chips-container');
        if (container) {
            container.innerHTML = this._renderCycleChips(this._rotationPattern, true);
        }
        this.updateWorkstationShiftLabels();
    },

    selectTemplate(templateId, isCustom) {
        this._isCustomShift = isCustom;
        this._selectedTemplateId = templateId;

        if (templateId === 0) {
            // No Fixed Shift
            this._templateBannerText = 'حالت شناور: ساعات تردد ثبت می‌شود اما کنترل عدم حضور سخت‌گیرانه اعمال نمی‌گردد.';
        } else if (isCustom) {
            // Custom Timetable
            this._templateBannerText = 'شیفت سفارشی: تمام ساعات و بازه‌های استراحت به صورت دستی توسط سرپرست تنظیم می‌شوند.';
        } else {
            // Specific Template
            const tmpl = this._templates.find(t => t.id === templateId);
            if (tmpl) {
                this._startTime = tmpl.start_time || '08:00';
                this._endTime = tmpl.end_time || '17:00';
                this._activeDays = new Set(tmpl.active_days || ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
                this._gracePeriodMinutes = tmpl.grace_period_minutes ?? 15;
                this._absenceTimeoutMinutes = tmpl.absence_timeout_minutes ?? 5;
                this._freeTimes = Array.isArray(tmpl.free_times) ? JSON.parse(JSON.stringify(tmpl.free_times)) : [];
                if (tmpl.shift_type === 'rotational') {
                    this._customSubtype = 'rotational';
                    this._rotationPattern = Object.assign({
                        pattern_type: '2d_2n_1off',
                        cycle: ['day', 'day', 'night', 'night', 'off'],
                        anchor_date: '2026-01-01',
                        day_start: '07:00',
                        day_end: '19:00',
                        night_start: '19:00',
                        night_end: '07:00',
                        grace_period_minutes: 15,
                        absence_timeout_minutes: 5,
                    }, tmpl.rotation_pattern || {});
                } else {
                    this._customSubtype = 'fixed';
                }
                this._templateBannerText = `مقادیر از الگوی '${tmpl.name}' بارگذاری شد. می‌توانید ساعات و استراحت را در زیر برای این فرد تغییر دهید.`;
            }
        }

        // Re-render so all loaded hours, breaks, and template highlights immediately update
        this.render();
    },

    toggleZone(zoneId, isChecked, inputEl) {
        if (isChecked) {
            this._selectedZoneIds.add(zoneId);
        } else {
            this._selectedZoneIds.delete(zoneId);
        }
        const card = inputEl ? inputEl.closest('.station-zone-item') : document.getElementById(`station-zone-card-${zoneId}`);
        if (card) {
            card.classList.toggle('selected', isChecked);
            const badgeEl = card.querySelector('.station-zone-status-badge');
            if (badgeEl) {
                badgeEl.innerHTML = isChecked
                    ? '<span class="badge badge-success text-xs" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 9999px;">🟢 ایستگاه فعال پرسنل</span>'
                    : '<span class="badge badge-subtle text-xs" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 9999px; opacity: 0.7;">تعریف‌شده توسط مدیر</span>';
            }
            const shiftTimeRow = card.querySelector('.station-zone-info > div > div:last-child');
            if (shiftTimeRow) {
                const labelSpan = shiftTimeRow.querySelector('span');
                if (labelSpan) labelSpan.style.color = isChecked ? '#38bdf8' : 'var(--text-secondary)';
            }
        }
        const badge = document.getElementById('selected-zones-count-badge');
        if (badge) {
            badge.textContent = `${this._selectedZoneIds.size} ایستگاه انتخاب شده`;
        }
    },

    getShiftTimingSummary() {
        const isRtl = I18n.isRTL();
        if (!this._isCustomShift && this._selectedTemplateId === 0) {
            return {
                timeWindow: isRtl ? 'ثبت تردد بدون الزام زمانی' : 'Flexible Roster',
                badge: isRtl ? 'شناور' : 'Flexible',
            };
        }
        if (this._customSubtype === 'rotational') {
            const rot = this._rotationPattern || {};
            const dStart = document.getElementById('rot-day-start')?.value || rot.day_start || '07:00';
            const dEnd = document.getElementById('rot-day-end')?.value || rot.day_end || '19:00';
            const nStart = document.getElementById('rot-night-start')?.value || rot.night_start || '19:00';
            const nEnd = document.getElementById('rot-night-end')?.value || rot.night_end || '07:00';
            const cycleDays = (rot.cycle || []).length || 5;
            return {
                timeWindow: `${dStart}-${dEnd} / ${nStart}-${nEnd}`,
                badge: isRtl ? `چرخشی (${cycleDays} روزه)` : `Rotational (${cycleDays}d)`,
            };
        }
        // Fixed Shift
        const start = document.getElementById('shift-start-time')?.value || this._startTime || '08:00';
        const end = document.getElementById('shift-end-time')?.value || this._endTime || '17:00';
        let badgeName = isRtl ? 'شیفت سفارشی' : 'Custom Shift';
        if (this._selectedTemplateId && !this._isCustomShift) {
            const tmpl = this._templates.find(t => t.id === this._selectedTemplateId);
            if (tmpl) badgeName = tmpl.name;
        }
        return {
            timeWindow: `${start} تا ${end}`,
            badge: badgeName,
        };
    },

    updateWorkstationShiftLabels() {
        const summary = this.getShiftTimingSummary();
        document.querySelectorAll('.workstation-shift-display').forEach(el => {
            el.textContent = summary.timeWindow;
        });
        document.querySelectorAll('.workstation-shift-badge').forEach(el => {
            el.textContent = summary.badge;
        });
    },


    async quickAddSection() {
        const name = prompt(I18n.t('section_name_prompt') || 'نام بخش جدید را وارد نمایید (مثال: بسته‌بندی، انبار، خط مونتاژ):');
        if (!name || !name.trim()) return;

        try {
            const newSec = await App.api('/api/sections', 'POST', { name: name.trim(), description: '' });
            this._sections.push(newSec);
            App.showToast(`بخش '${newSec.name}' با موفقیت اضافه شد.`, 'success');

            const selectEl = document.getElementById('person-shift-section');
            if (selectEl) {
                const opt = document.createElement('option');
                opt.value = newSec.name;
                opt.textContent = newSec.name;
                opt.selected = true;
                selectEl.appendChild(opt);
            }
        } catch (err) {
            App.showToast(`خطا در ایجاد بخش: ${err.message}`, 'error');
        }
    },

    async save(e) {
        if (e) e.preventDefault();
        const saveBtn = document.getElementById('save-shift-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.6';
        }

        const sectionVal = (document.getElementById('person-shift-section')?.value || '').trim();

        // Build shift payload based on supervisor configuration
        let customShiftPayload = null;
        let shiftTemplateIdPayload = null;

        if (!this._isCustomShift && this._selectedTemplateId === 0) {
            // No Fixed Shift explicitly selected
            shiftTemplateIdPayload = 0;
            customShiftPayload = null;
        } else {
            // Fixed or Rotational configuration customized by supervisor
            const isRotational = (this._customSubtype === 'rotational');
            if (isRotational) {
                const anchorDate = document.getElementById('rot-anchor-date')?.value || this._rotationPattern.anchor_date || '2026-01-01';
                const dayStart = document.getElementById('rot-day-start')?.value || '07:00';
                const dayEnd = document.getElementById('rot-day-end')?.value || '19:00';
                const nightStart = document.getElementById('rot-night-start')?.value || '19:00';
                const nightEnd = document.getElementById('rot-night-end')?.value || '07:00';
                const graceVal = parseInt(document.getElementById('rot-grace')?.value || '15', 10);
                const absVal = parseInt(document.getElementById('rot-absence')?.value || '5', 10);

                customShiftPayload = {
                    shift_type: 'rotational',
                    name: 'نوبت‌کاری چرخشی سفارشی',
                    start_time: dayStart,
                    end_time: nightEnd,
                    active_days: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                    grace_period_minutes: isNaN(graceVal) ? 15 : graceVal,
                    absence_timeout_minutes: isNaN(absVal) ? 5 : absVal,
                    free_times: this._freeTimes || [],
                    rotation_pattern: {
                        pattern_type: this._rotationPattern.pattern_type || '2d_2n_1off',
                        cycle: this._rotationPattern.cycle || ['day', 'day', 'night', 'night', 'off'],
                        anchor_date: anchorDate,
                        day_start: dayStart,
                        day_end: dayEnd,
                        night_start: nightStart,
                        night_end: nightEnd,
                        grace_period_minutes: isNaN(graceVal) ? 15 : graceVal,
                        absence_timeout_minutes: isNaN(absVal) ? 5 : absVal,
                    },
                };
            } else {
                const startVal = document.getElementById('shift-start-time')?.value || this._startTime || '08:00';
                const endVal = document.getElementById('shift-end-time')?.value || this._endTime || '17:00';
                const graceVal = parseInt(document.getElementById('shift-grace-mins')?.value || String(this._gracePeriodMinutes), 10);
                const absVal = parseInt(document.getElementById('shift-absence-mins')?.value || String(this._absenceTimeoutMinutes), 10);

                const activeDaysArr = this._activeDays.size > 0
                    ? Array.from(this._activeDays)
                    : ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

                // Check if this matches a selected template without modifications
                const tmpl = this._selectedTemplateId ? this._templates.find(t => t.id === this._selectedTemplateId) : null;
                const isExactMatch = tmpl &&
                    tmpl.start_time === startVal &&
                    tmpl.end_time === endVal &&
                    (tmpl.grace_period_minutes ?? 15) === graceVal &&
                    (tmpl.absence_timeout_minutes ?? 5) === absVal &&
                    JSON.stringify(tmpl.free_times || []) === JSON.stringify(this._freeTimes || []);

                if (isExactMatch && !this._isCustomShift) {
                    shiftTemplateIdPayload = tmpl.id;
                    customShiftPayload = null;
                } else {
                    shiftTemplateIdPayload = null;
                    customShiftPayload = {
                        shift_type: 'fixed',
                        name: tmpl ? `${tmpl.name} (سفارشی‌شده)` : 'شیفت کاری اختصاصی',
                        start_time: startVal,
                        end_time: endVal,
                        active_days: activeDaysArr,
                        grace_period_minutes: isNaN(graceVal) ? 15 : graceVal,
                        absence_timeout_minutes: isNaN(absVal) ? 5 : absVal,
                        free_times: this._freeTimes || [],
                    };
                }
            }
        }

        const payload = {
            section: sectionVal,
            shift_template_id: shiftTemplateIdPayload,
            custom_shift: customShiftPayload,
            assigned_zone_ids: Array.from(this._selectedZoneIds),
        };

        try {
            await App.api(`/api/persons/${this._personId}/shift`, 'PUT', payload);
            App.showToast(I18n.t('shift_saved_toast') || 'شیفت کاری، زمان‌های استراحت و ایستگاه‌ها با موفقیت ذخیره شد.', 'success');
            App.closeModal();

            // Refresh Persons page if open
            if (typeof PersonsPage !== 'undefined' && PersonsPage._persons) {
                await PersonsPage.loadPersons();
            }
            // Refresh PersonAnalyticsModal if open
            if (typeof PersonAnalyticsModal !== 'undefined' && PersonAnalyticsModal._data && PersonAnalyticsModal._data.person_id === this._personId) {
                await PersonAnalyticsModal.show(this._personId);
            }
            // Refresh DutyPage if open
            if (typeof DutyPage !== 'undefined' && typeof DutyPage.refreshRoster === 'function') {
                await DutyPage.refreshRoster();
            }
            // Refresh SupervisorCockpit if open
            if (typeof SupervisorCockpit !== 'undefined' && typeof SupervisorCockpit.fetchData === 'function') {
                await SupervisorCockpit.fetchData();
            }
        } catch (err) {
            console.error('Failed to save shift config:', err);
            App.showToast(`خطا در ذخیره شیفت: ${err.message}`, 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
            }
        }
    },

    _escape(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Render the list of free times (lunch, rest, etc.).
     */
    renderFreeTimesListHtml() {
        const isRtl = I18n.isRTL();
        if (!this._freeTimes || this._freeTimes.length === 0) {
            return `
                <div class="text-muted text-xs p-2 text-center" style="background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px dashed var(--border-subtle);" dir="auto">
                    ☕ ${isRtl ? 'هیچ زمان استراحتی برای این شیفت ثبت نشده است. با دکمه‌های بالا یا فیلدهای زیر می‌توانید ناهار، چای یا اوقات استراحت را اضافه نمایید.' : 'No break times recorded for this shift. Use the presets above or inputs below to add lunch, tea, or break periods.'}
                </div>
            `;
        }
        return this._freeTimes.map((ft, idx) => {
            let icon = '☕';
            const nameLower = (ft.name || '').toLowerCase();
            if (nameLower.includes('ناهار') || nameLower.includes('lunch')) icon = '🍽️';
            else if (nameLower.includes('نماز') || nameLower.includes('prayer')) icon = '🍱';
            else if (nameLower.includes('شب') || nameLower.includes('night')) icon = '🌙';

            // Calculate duration in minutes if parseable
            let durText = '';
            if (ft.start_time && ft.end_time) {
                const sParts = ft.start_time.split(':');
                const eParts = ft.end_time.split(':');
                if (sParts.length === 2 && eParts.length === 2) {
                    const sMins = parseInt(sParts[0], 10) * 60 + parseInt(sParts[1], 10);
                    let eMins = parseInt(eParts[0], 10) * 60 + parseInt(eParts[1], 10);
                    if (eMins < sMins) eMins += 24 * 60;
                    const diff = eMins - sMins;
                    durText = isRtl
                        ? `(${I18n.toPersianDigits(diff)} دقیقه)`
                        : `(${diff} mins)`;
                }
            }

            return `
                <div class="d-flex justify-content-between align-items-center p-2 rounded border border-subtle" style="background: var(--bg-surface-hover); border-radius: 6px;">
                    <div class="d-flex align-items-center gap-2">
                        <span style="font-size: 1.15rem;">${icon}</span>
                        <strong style="font-size: 0.85rem; color: var(--text-primary);">${this._escape(ft.name || (isRtl ? 'زمان استراحت' : 'Break Time'))}</strong>
                        <span class="badge badge-subtle text-xs" style="direction: ltr; font-family: monospace; font-weight: 700;">${ft.start_time} - ${ft.end_time}</span>
                        ${durText ? `<small class="text-muted text-xs" style="color: #94a3b8;">${durText}</small>` : ''}
                    </div>
                    <button type="button" class="btn btn-outline-danger btn-sm" onclick="PersonShiftModal.removeFreeTime(${idx})" style="padding: 2px 7px; font-size: 0.75rem;" title="${I18n.t('delete') || 'حذف'}">
                        🗑️
                    </button>
                </div>
            `;
        }).join('');
    },

    /**
     * Add free time from input fields.
     */
    addFreeTimeFromInputs() {
        const nameInput = document.getElementById('person-free-time-name');
        const startInput = document.getElementById('person-free-time-start');
        const endInput = document.getElementById('person-free-time-end');

        const name = (nameInput ? nameInput.value : '').trim() || (I18n.isRTL() ? 'ناهار و استراحت' : 'Lunch Break');
        const startTime = (startInput ? startInput.value : '').trim() || '12:00';
        const endTime = (endInput ? endInput.value : '').trim() || '13:00';

        if (!this._freeTimes) this._freeTimes = [];
        this._freeTimes.push({ name, start_time: startTime, end_time: endTime });

        if (nameInput) nameInput.value = '';

        const listEl = document.getElementById('person-free-times-list');
        if (listEl) listEl.innerHTML = this.renderFreeTimesListHtml();
        const countBadge = document.getElementById('person-breaks-count-badge');
        if (countBadge) {
            const isRtl = I18n.isRTL();
            countBadge.textContent = isRtl ? `${this._freeTimes.length} بازه فعال` : `${this._freeTimes.length} Active Breaks`;
        }
    },

    /**
     * Apply preset to person free times.
     */
    applyBreakPreset(name, startTime, endTime) {
        if (!this._freeTimes) this._freeTimes = [];
        const isRtl = I18n.isRTL();
        const exists = this._freeTimes.some(ft => ft.start_time === startTime && ft.end_time === endTime && ft.name === name);
        if (!exists) {
            this._freeTimes.push({
                name: name || (isRtl ? 'استراحت' : 'Break'),
                start_time: startTime || '12:00',
                end_time: endTime || '13:00',
            });
            App.showToast(isRtl ? `بازه '${name}' اضافه شد.` : `Break '${name}' added.`, 'info');
        }

        const listEl = document.getElementById('person-free-times-list');
        if (listEl) listEl.innerHTML = this.renderFreeTimesListHtml();
        const countBadge = document.getElementById('person-breaks-count-badge');
        if (countBadge) {
            countBadge.textContent = isRtl ? `${this._freeTimes.length} بازه فعال` : `${this._freeTimes.length} Active Breaks`;
        }
    },

    /**
     * Remove free time by index.
     */
    removeFreeTime(idx) {
        if (this._freeTimes && this._freeTimes.length > idx) {
            this._freeTimes.splice(idx, 1);
        }
        const isRtl = I18n.isRTL();
        const listEl = document.getElementById('person-free-times-list');
        if (listEl) listEl.innerHTML = this.renderFreeTimesListHtml();
        const countBadge = document.getElementById('person-breaks-count-badge');
        if (countBadge) {
            countBadge.textContent = isRtl ? `${this._freeTimes.length} بازه فعال` : `${this._freeTimes.length} Active Breaks`;
        }
    },
};
