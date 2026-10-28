/**
 * ShiftTemplateModal — Modal for Creating, Editing, and Duplicating
 * Reusable Default Shift Timetables & Rotational Cycle Templates.
 */
const ShiftTemplateModal = {
    _templateId: null,
    _isEdit: false,
    _name: '',
    _color: '#38bdf8',
    _shiftType: 'fixed', // 'fixed' | 'rotational'
    _startTime: '08:00',
    _endTime: '16:00',
    _activeDays: new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']),
    _gracePeriodMinutes: 10,
    _absenceTimeoutMinutes: 2,
    _freeTimes: [],
    _rotationPattern: {
        pattern_type: '2d_2n_1off',
        cycle: ['day', 'day', 'night', 'night', 'off'],
        anchor_date: '2026-01-01',
        day_start: '07:00',
        day_end: '19:00',
        night_start: '19:00',
        night_end: '07:00',
    },
    _onSaveCallback: null,

    _colors: [
        '#38bdf8', // Blue / Cyan
        '#34d399', // Emerald Green
        '#fbbf24', // Amber / Gold
        '#a855f7', // Purple / Violet
        '#f43f5e', // Rose / Red
        '#06b6d4', // Ocean Cyan
        '#ec4899', // Pink
        '#64748b', // Slate Gray
    ],

    /**
     * Open the Shift Template Modal.
     * @param {number|null} templateId - Existing ID to edit, or null to create.
     * @param {object|null} cloneData - Template data to duplicate.
     * @param {function|null} onSave - Callback triggered after successful save.
     */
    async show(templateId = null, cloneData = null, onSave = null) {
        this._templateId = templateId;
        this._isEdit = !!templateId;
        this._onSaveCallback = onSave;

        if (cloneData) {
            // Duplicate mode
            this._templateId = null;
            this._isEdit = false;
            this._name = (cloneData.name || '') + (I18n.t('duplicate_copy_suffix') || ' (کپی)');
            this._color = cloneData.color || '#38bdf8';
            this._shiftType = cloneData.shift_type || 'fixed';
            this._startTime = cloneData.start_time || '08:00';
            this._endTime = cloneData.end_time || '16:00';
            this._activeDays = new Set(cloneData.active_days || ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
            this._gracePeriodMinutes = cloneData.grace_period_minutes ?? 10;
            this._absenceTimeoutMinutes = cloneData.absence_timeout_minutes ?? 2;
            this._freeTimes = JSON.parse(JSON.stringify(cloneData.free_times || []));
            this._rotationPattern = cloneData.rotation_pattern
                ? JSON.parse(JSON.stringify(cloneData.rotation_pattern))
                : {
                    pattern_type: '2d_2n_1off',
                    cycle: ['day', 'day', 'night', 'night', 'off'],
                    anchor_date: '2026-01-01',
                    day_start: '07:00',
                    day_end: '19:00',
                    night_start: '19:00',
                    night_end: '07:00',
                };
        } else if (this._isEdit) {
            // Load existing template
            try {
                const tmpl = await App.api(`/api/shift-templates/${templateId}`);
                this._name = tmpl.name || '';
                this._color = tmpl.color || '#38bdf8';
                this._shiftType = tmpl.shift_type || 'fixed';
                this._startTime = tmpl.start_time || '08:00';
                this._endTime = tmpl.end_time || '16:00';
                this._activeDays = new Set(tmpl.active_days || ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
                this._gracePeriodMinutes = tmpl.grace_period_minutes ?? 10;
                this._absenceTimeoutMinutes = tmpl.absence_timeout_minutes ?? 2;
                this._freeTimes = JSON.parse(JSON.stringify(tmpl.free_times || []));
                this._rotationPattern = tmpl.rotation_pattern
                    ? JSON.parse(JSON.stringify(tmpl.rotation_pattern))
                    : {
                        pattern_type: '2d_2n_1off',
                        cycle: ['day', 'day', 'night', 'night', 'off'],
                        anchor_date: '2026-01-01',
                        day_start: '07:00',
                        day_end: '19:00',
                        night_start: '19:00',
                        night_end: '07:00',
                    };
            } catch (err) {
                console.error('Failed to load shift template for edit:', err);
                App.toast(I18n.t('err_generic', { msg: err.message || err }), 'error');
                return;
            }
        } else {
            // Clean new template
            this._name = '';
            this._color = '#38bdf8';
            this._shiftType = 'fixed';
            this._startTime = '08:00';
            this._endTime = '16:00';
            this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
            this._gracePeriodMinutes = 10;
            this._absenceTimeoutMinutes = 2;
            this._freeTimes = [];
            this._rotationPattern = {
                pattern_type: '2d_2n_1off',
                cycle: ['day', 'day', 'night', 'night', 'off'],
                anchor_date: '2026-01-01',
                day_start: '07:00',
                day_end: '19:00',
                night_start: '19:00',
                night_end: '07:00',
            };
        }

        this.render();
    },

    /**
     * Render the modal DOM and attach interactive listeners.
     */
    render() {
        const isRtl = I18n.isRTL();
        const modalTitle = this._isEdit
            ? (I18n.t('modal_edit_shift_template') || 'ویرایش قالب شیفت کاری')
            : (I18n.t('modal_new_shift_template') || 'تعریف قالب شیفت کاری جدید');

        const allDays = [
            { id: 'Sat', label_fa: 'شنبه', label_en: 'Sat' },
            { id: 'Sun', label_fa: 'یک‌شنبه', label_en: 'Sun' },
            { id: 'Mon', label_fa: 'دوشنبه', label_en: 'Mon' },
            { id: 'Tue', label_fa: 'سه‌شنبه', label_en: 'Tue' },
            { id: 'Wed', label_fa: 'چهارشنبه', label_en: 'Wed' },
            { id: 'Thu', label_fa: 'پنج‌شنبه', label_en: 'Thu' },
            { id: 'Fri', label_fa: 'جمعه', label_en: 'Fri' },
        ];

        const isFixed = this._shiftType === 'fixed';

        // Check overnight shift
        const isOvernight = isFixed && this._startTime && this._endTime && (this._endTime < this._startTime);

        // Color selector pills
        const colorPillsHtml = this._colors.map(c => `
            <button
                type="button"
                class="shift-color-swatch ${this._color === c ? 'active' : ''}"
                style="background: ${c}; width: 26px; height: 26px; border-radius: 50%; border: 2px solid ${this._color === c ? '#ffffff' : 'transparent'}; cursor: pointer; transition: transform 0.15s; outline: none; box-shadow: ${this._color === c ? '0 0 0 2px ' + c : 'none'};"
                onclick="ShiftTemplateModal.setColor('${c}')"
                title="${c}"
            ></button>
        `).join('');

        // Active day chips
        const daysChipsHtml = allDays.map(d => {
            const active = this._activeDays.has(d.id);
            const label = isRtl ? d.label_fa : d.label_en;
            return `
                <button
                    type="button"
                    class="day-chip ${active ? 'active' : ''}"
                    style="padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.2s; border: 1px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}; background: ${active ? 'var(--accent-blue)' : 'var(--bg-surface)'}; color: ${active ? '#ffffff' : 'var(--text-secondary)'};"
                    onclick="ShiftTemplateModal.toggleDay('${d.id}')"
                >
                    ${label}
                </button>
            `;
        }).join('');

        // Cycle chips for rotational shift
        const cycleChipsHtml = (this._rotationPattern.cycle || []).map((step, idx) => {
            let icon = '☀️';
            let label = isRtl ? 'روز' : 'Day';
            let badgeBg = 'rgba(245, 158, 11, 0.15)';
            let badgeColor = '#fbbf24';
            if (step === 'night') {
                icon = '🌙';
                label = isRtl ? 'شب' : 'Night';
                badgeBg = 'rgba(139, 92, 246, 0.15)';
                badgeColor = '#a78bfa';
            } else if (step === 'off') {
                icon = '☕';
                label = isRtl ? 'آف' : 'Off';
                badgeBg = 'rgba(100, 116, 139, 0.2)';
                badgeColor = '#94a3b8';
            }
            return `
                <div style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 4px 10px; border-radius: 6px; background: ${badgeBg}; color: ${badgeColor}; font-size: 0.78rem; font-weight: 700; border: 1px solid rgba(255, 255, 255, 0.08);">
                    <span>${icon}</span>
                    <span>${label} ${isRtl ? I18n.toPersianDigits(idx + 1) : (idx + 1)}</span>
                </div>
            `;
        }).join('');

        // Free times / breaks list
        const breaksHtml = (this._freeTimes || []).map((br, idx) => `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.4rem 0.75rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 6px; font-size: 0.8rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span>🍽️</span>
                    <strong style="color: var(--text-primary);">${this._escape(br.name || 'Break')}</strong>
                    <span style="color: var(--text-secondary); direction: ltr; font-family: monospace;">${br.start_time} - ${br.end_time}</span>
                </div>
                <button type="button" class="btn btn-sm btn-icon" onclick="ShiftTemplateModal.removeBreak(${idx})" style="padding: 2px 6px; color: #f87171;" title="${isRtl ? 'حذف' : 'Remove'}">✕</button>
            </div>
        `).join('');

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                    <span style="font-size: 1.3rem;">⏰</span>
                    <h2 class="modal-title" style="margin: 0; font-size: 1.15rem;">${modalTitle}</h2>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <form id="shift-template-form" onsubmit="ShiftTemplateModal.handleSave(event)" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1.15rem; max-height: 80vh; overflow-y: auto;">
                
                <!-- 1. Name & Color Card -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; gap: 0.85rem;">
                    <div class="form-group" style="margin: 0;">
                        <label for="shift-tmpl-name" style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); margin-bottom: 0.4rem; display: block;">
                            ${I18n.t('shift_name_label') || 'نام شیفت'} <span style="color: #f87171;">*</span>
                        </label>
                        <input
                            type="text"
                            id="shift-tmpl-name"
                            class="form-control"
                            required
                            placeholder="${I18n.t('shift_name_placeholder') || 'مثال: شیفت صبحگاهی، شیفت عصر، نوبت‌کاری چرخشی...'}"
                            value="${this._escape(this._name)}"
                            oninput="ShiftTemplateModal._name = this.value"
                            style="font-size: 0.9rem;"
                        />
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                        <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">
                            ${I18n.t('shift_color_badge') || 'رنگ شناسه شیفت:'}
                        </span>
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            ${colorPillsHtml}
                        </div>
                    </div>
                </div>

                <!-- 2. Shift Type Selector (Fixed vs Rotational) -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
                    <label style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); margin: 0;">
                        ${I18n.t('shift_type_label') || 'نوع و ساختار شیفت'}
                    </label>

                    <div class="page-segmented-control" style="width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                        <button
                            type="button"
                            class="segmented-tab ${isFixed ? 'active' : ''}"
                            style="justify-content: center; padding: 0.5rem;"
                            onclick="ShiftTemplateModal.setShiftType('fixed')"
                        >
                            <span>☀️ ${I18n.t('shift_mode_fixed') || 'شیفت ثابت هفتگی'}</span>
                        </button>
                        <button
                            type="button"
                            class="segmented-tab ${!isFixed ? 'active' : ''}"
                            style="justify-content: center; padding: 0.5rem;"
                            onclick="ShiftTemplateModal.setShiftType('rotational')"
                        >
                            <span>🔄 ${I18n.t('rotational_shift') || 'نوبت‌کاری چرخشی'}</span>
                        </button>
                    </div>

                    ${isFixed ? `
                        <!-- Fixed Shift Hours & Days -->
                        <div style="display: flex; flex-direction: column; gap: 0.85rem; margin-top: 0.4rem;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                                <div class="form-group" style="margin: 0;">
                                    <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.3rem; display: block;">
                                        ⏰ ${I18n.t('start_time') || 'ساعت شروع شیفت'}
                                    </label>
                                    <input
                                        type="time"
                                        id="shift-tmpl-start"
                                        class="form-control"
                                        value="${this._startTime}"
                                        onchange="ShiftTemplateModal.setStartTime(this.value)"
                                        style="font-family: monospace; direction: ltr; font-size: 0.95rem; text-align: center;"
                                    />
                                </div>
                                <div class="form-group" style="margin: 0;">
                                    <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.3rem; display: block;">
                                        🏁 ${I18n.t('end_time') || 'ساعت پایان شیفت'}
                                    </label>
                                    <input
                                        type="time"
                                        id="shift-tmpl-end"
                                        class="form-control"
                                        value="${this._endTime}"
                                        onchange="ShiftTemplateModal.setEndTime(this.value)"
                                        style="font-family: monospace; direction: ltr; font-size: 0.95rem; text-align: center;"
                                    />
                                </div>
                            </div>

                            ${isOvernight ? `
                                <div style="background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.76rem; color: #c4b5fd; display: flex; align-items: center; gap: 0.4rem;">
                                    <span>🌙</span>
                                    <span>${isRtl ? 'شیفت شبانه (پایان در روز بعد محاسبه می‌شود).' : 'Overnight shift (ends on the next calendar day).'}</span>
                                </div>
                            ` : ''}

                            <!-- Active Days Selector -->
                            <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.2rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.4rem;">
                                    <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">
                                        📅 ${I18n.t('active_days') || 'روزهای فعال کاری:'}
                                    </span>
                                    <div style="display: flex; gap: 0.4rem; font-size: 0.72rem;">
                                        <button type="button" class="btn btn-secondary btn-sm" onclick="ShiftTemplateModal.setDaysPreset('all')" style="padding: 2px 7px; font-size: 0.7rem;">
                                            ${I18n.t('days_all_7') || 'تمام ۷ روز'}
                                        </button>
                                        <button type="button" class="btn btn-secondary btn-sm" onclick="ShiftTemplateModal.setDaysPreset('sat_wed')" style="padding: 2px 7px; font-size: 0.7rem;">
                                            ${I18n.t('days_sat_wed') || 'شنبه تا چهارشنبه'}
                                        </button>
                                        <button type="button" class="btn btn-secondary btn-sm" onclick="ShiftTemplateModal.setDaysPreset('sat_thu')" style="padding: 2px 7px; font-size: 0.7rem;">
                                            ${I18n.t('days_sat_thu') || 'شنبه تا پنج‌شنبه'}
                                        </button>
                                    </div>
                                </div>
                                <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
                                    ${daysChipsHtml}
                                </div>
                            </div>
                        </div>
                    ` : `
                        <!-- Rotational Shift Controls -->
                        <div style="display: flex; flex-direction: column; gap: 0.85rem; margin-top: 0.4rem;">
                            <!-- Rotational Presets -->
                            <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                                <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary);">
                                    🔄 ${isRtl ? 'الگوهای استاندارد نوبت‌کاری:' : 'Standard Rotation Cycles:'}
                                </span>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;">
                                    <button
                                        type="button"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '2d_2n_1off' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('2d_2n_1off')"
                                        style="font-size: 0.73rem; padding: 0.4rem 0.5rem; text-align: start;"
                                    >
                                        ${I18n.t('preset_2d_2n_1off') || '۲ روز، ۲ شب، ۱ آف'}
                                    </button>
                                    <button
                                        type="button"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '2d_2n_2off' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('2d_2n_2off')"
                                        style="font-size: 0.73rem; padding: 0.4rem 0.5rem; text-align: start;"
                                    >
                                        ${I18n.t('preset_2d_2n_2off') || '۲ روز، ۲ شب، ۲ آف'}
                                    </button>
                                    <button
                                        type="button"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '24_48' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('24_48')"
                                        style="font-size: 0.73rem; padding: 0.4rem 0.5rem; text-align: start;"
                                    >
                                        ${I18n.t('preset_24_48') || '۲۴ ساعت کار، ۴۸ استراحت'}
                                    </button>
                                    <button
                                        type="button"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '1d_1n_2off' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('1d_1n_2off')"
                                        style="font-size: 0.73rem; padding: 0.4rem 0.5rem; text-align: start;"
                                    >
                                        ${isRtl ? '۱ روز، ۱ شب، ۲ آف' : '1 Day, 1 Night, 2 Off'}
                                    </button>
                                </div>
                            </div>

                            <!-- Day and Night bounds -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                                <div class="form-group" style="margin: 0;">
                                    <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.3rem; display: block;">
                                        ☀️ ${I18n.t('rotation_day_shift') || 'ساعات شیفت روز'}
                                    </label>
                                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                                        <input
                                            type="time"
                                            class="form-control"
                                            value="${this._rotationPattern.day_start || '07:00'}"
                                            onchange="ShiftTemplateModal._rotationPattern.day_start = this.value"
                                            style="font-family: monospace; direction: ltr; font-size: 0.8rem; text-align: center; padding: 0.35rem;"
                                        />
                                        <span>-</span>
                                        <input
                                            type="time"
                                            class="form-control"
                                            value="${this._rotationPattern.day_end || '19:00'}"
                                            onchange="ShiftTemplateModal._rotationPattern.day_end = this.value"
                                            style="font-family: monospace; direction: ltr; font-size: 0.8rem; text-align: center; padding: 0.35rem;"
                                        />
                                    </div>
                                </div>
                                <div class="form-group" style="margin: 0;">
                                    <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.3rem; display: block;">
                                        🌙 ${I18n.t('rotation_night_shift') || 'ساعات شیفت شب'}
                                    </label>
                                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                                        <input
                                            type="time"
                                            class="form-control"
                                            value="${this._rotationPattern.night_start || '19:00'}"
                                            onchange="ShiftTemplateModal._rotationPattern.night_start = this.value"
                                            style="font-family: monospace; direction: ltr; font-size: 0.8rem; text-align: center; padding: 0.35rem;"
                                        />
                                        <span>-</span>
                                        <input
                                            type="time"
                                            class="form-control"
                                            value="${this._rotationPattern.night_end || '07:00'}"
                                            onchange="ShiftTemplateModal._rotationPattern.night_end = this.value"
                                            style="font-family: monospace; direction: ltr; font-size: 0.8rem; text-align: center; padding: 0.35rem;"
                                        />
                                    </div>
                                </div>
                            </div>

                            <!-- Cycle sequence chips -->
                            <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.65rem 0.8rem; display: flex; flex-direction: column; gap: 0.4rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">
                                        ${I18n.t('rotation_cycle_preview') || 'پیش‌نمایش چرخه نوبت‌کاری:'}
                                    </span>
                                    <span style="font-size: 0.72rem; color: var(--accent-blue); font-weight: 600;">
                                        ${(this._rotationPattern.cycle || []).length} ${isRtl ? 'روز در هر دور' : 'days per cycle'}
                                    </span>
                                </div>
                                <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;">
                                    ${cycleChipsHtml}
                                </div>
                            </div>
                        </div>
                    `}
                </div>

                <!-- 3. Tolerances & Rules -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; gap: 0.85rem;">
                    <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">
                        🛡️ ${I18n.t('shift_tolerances_title') || 'قوانین تاخیر و آستانه هشدار غیبت'}
                    </span>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div class="form-group" style="margin: 0;">
                            <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.25rem; display: block;">
                                ⏱️ ${I18n.t('grace_period_minutes') || 'مهلت تاخیر مجاز (دقیقه)'}
                            </label>
                            <input
                                type="number"
                                id="shift-tmpl-grace"
                                class="form-control"
                                min="0"
                                max="120"
                                value="${this._gracePeriodMinutes}"
                                oninput="ShiftTemplateModal._gracePeriodMinutes = parseInt(this.value, 10) || 0"
                                style="text-align: center; font-size: 0.88rem; padding: 0.35rem;"
                            />
                            <div style="font-size: 0.68rem; color: var(--text-tertiary); margin-top: 2px;">
                                ${I18n.t('grace_period_hint') || 'مهلت تاخیر در شروع شیفت پیش از ثبت تخلف'}
                            </div>
                        </div>

                        <div class="form-group" style="margin: 0;">
                            <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.25rem; display: block;">
                                🚨 ${I18n.t('absence_timeout_minutes') || 'آستانه هشدار غیبت (دقیقه)'}
                            </label>
                            <input
                                type="number"
                                id="shift-tmpl-absence"
                                class="form-control"
                                min="1"
                                max="1440"
                                value="${this._absenceTimeoutMinutes}"
                                oninput="ShiftTemplateModal._absenceTimeoutMinutes = parseInt(this.value, 10) || 1"
                                style="text-align: center; font-size: 0.88rem; padding: 0.35rem;"
                            />
                            <div style="font-size: 0.68rem; color: var(--text-tertiary); margin-top: 2px;">
                                ${I18n.t('absence_timeout_hint') || 'حداکثر زمان ترک ایستگاه پیش از آلارم'}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 4. Scheduled Breaks & Lunch (Free Times) -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap;">
                        <div>
                            <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.35rem;">
                                🍽️ ${I18n.t('scheduled_breaks_title') || 'زنگ‌های استراحت و ناهار (Breaks)'}
                            </span>
                            <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 2px;">
                                ${I18n.t('scheduled_breaks_desc') || 'در این بازه‌ها سیستم هشدار عدم حضور را متوقف می‌کند.'}
                            </div>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ShiftTemplateModal.addBreakRow()" style="font-size: 0.72rem; padding: 0.3rem 0.65rem;">
                            ＋ ${isRtl ? 'افزودن استراحت' : 'Add Break'}
                        </button>
                    </div>

                    ${breaksHtml ? `
                        <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                            ${breaksHtml}
                        </div>
                    ` : `
                        <div style="text-align: center; color: var(--text-tertiary); font-size: 0.75rem; padding: 0.5rem; background: var(--bg-surface); border-radius: 6px; border: 1px dashed var(--border-subtle);">
                            ${isRtl ? 'هیچ زنگ استراحتی تعریف نشده است.' : 'No scheduled breaks defined.'}
                        </div>
                    `}
                </div>

                <!-- Footer Actions -->
                <div class="modal-footer" style="padding: 0; margin-top: 0.25rem; display: flex; justify-content: flex-end; gap: 0.75rem;">
                    <button type="button" class="btn btn-secondary" onclick="App.closeModal()">
                        ${I18n.t('cancel') || 'انصراف'}
                    </button>
                    <button type="submit" class="btn btn-primary" id="btn-save-shift-template">
                        💾 ${I18n.t('save_changes') || 'ذخیره تغییرات'}
                    </button>
                </div>
            </form>
        `;

        App.openModal(content, 'modal-md');
    },

    setColor(c) {
        this._color = c;
        this.render();
    },

    setShiftType(type) {
        this._shiftType = type;
        this.render();
    },

    setStartTime(val) {
        this._startTime = val;
        this.render();
    },

    setEndTime(val) {
        this._endTime = val;
        this.render();
    },

    toggleDay(dayId) {
        if (this._activeDays.has(dayId)) {
            if (this._activeDays.size > 1) {
                this._activeDays.delete(dayId);
            }
        } else {
            this._activeDays.add(dayId);
        }
        this.render();
    },

    setDaysPreset(preset) {
        if (preset === 'all') {
            this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        } else if (preset === 'sat_wed') {
            this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
        } else if (preset === 'sat_thu') {
            this._activeDays = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
        }
        this.render();
    },

    applyRotationalPreset(patternKey) {
        if (patternKey === '2d_2n_1off') {
            this._rotationPattern = {
                pattern_type: '2d_2n_1off',
                cycle: ['day', 'day', 'night', 'night', 'off'],
                anchor_date: '2026-01-01',
                day_start: '07:00',
                day_end: '19:00',
                night_start: '19:00',
                night_end: '07:00',
            };
        } else if (patternKey === '2d_2n_2off') {
            this._rotationPattern = {
                pattern_type: '2d_2n_2off',
                cycle: ['day', 'day', 'night', 'night', 'off', 'off'],
                anchor_date: '2026-01-01',
                day_start: '07:00',
                day_end: '19:00',
                night_start: '19:00',
                night_end: '07:00',
            };
        } else if (patternKey === '24_48') {
            this._rotationPattern = {
                pattern_type: '24_48',
                cycle: ['day', 'off', 'off', 'off'],
                anchor_date: '2026-01-01',
                day_start: '08:00',
                day_end: '08:00',
                night_start: '20:00',
                night_end: '08:00',
            };
        } else if (patternKey === '1d_1n_2off') {
            this._rotationPattern = {
                pattern_type: '1d_1n_2off',
                cycle: ['day', 'night', 'off', 'off'],
                anchor_date: '2026-01-01',
                day_start: '07:00',
                day_end: '19:00',
                night_start: '19:00',
                night_end: '07:00',
            };
        }
        this.render();
    },

    addBreakRow() {
        const isRtl = I18n.isRTL();
        const defaultName = isRtl ? 'ناهار و استراحت' : 'Lunch Break';
        this._freeTimes.push({
            name: defaultName,
            start_time: '12:00',
            end_time: '13:00',
            category: 'lunch',
        });
        this.render();
    },

    removeBreak(idx) {
        if (idx >= 0 && idx < this._freeTimes.length) {
            this._freeTimes.splice(idx, 1);
            this.render();
        }
    },

    async handleSave(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const nameInput = document.getElementById('shift-tmpl-name');
        const name = (nameInput ? nameInput.value : this._name).trim();

        if (!name) {
            App.toast(I18n.t('err_empty_fields') || 'لطفاً نام شیفت را وارد کنید.', 'error');
            if (nameInput) nameInput.focus();
            return;
        }

        const btn = document.getElementById('btn-save-shift-template');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ ' + (I18n.t('saving') || 'در حال ذخیره...');
        }

        const payload = {
            name: name,
            color: this._color || '#38bdf8',
            shift_type: this._shiftType,
            start_time: this._startTime || '08:00',
            end_time: this._endTime || '16:00',
            active_days: Array.from(this._activeDays),
            grace_period_minutes: Math.max(0, this._gracePeriodMinutes || 0),
            absence_timeout_minutes: Math.max(1, this._absenceTimeoutMinutes || 2),
            free_times: this._freeTimes || [],
            rotation_pattern: this._shiftType === 'rotational' ? this._rotationPattern : null,
        };

        try {
            if (this._isEdit && this._templateId) {
                await App.api(`/api/shift-templates/${this._templateId}`, 'PUT', payload);
            } else {
                await App.api('/api/shift-templates', 'POST', payload);
            }

            App.toast(I18n.t('shift_template_saved_success') || 'قالب شیفت با موفقیت ذخیره شد.', 'success');
            App.closeModal();

            if (typeof this._onSaveCallback === 'function') {
                this._onSaveCallback();
            }
        } catch (err) {
            console.error('Failed to save shift template:', err);
            App.toast(I18n.t('err_generic', { msg: err.message || err }), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '💾 ' + (I18n.t('save_changes') || 'ذخیره تغییرات');
            }
        }
    },

    _escape(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },
};
