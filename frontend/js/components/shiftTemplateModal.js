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

        if (typeof BreakPresets !== 'undefined' && typeof BreakPresets.load === 'function') {
            try {
                await BreakPresets.load();
            } catch (e) {
                console.warn('[ShiftTemplateModal] Error loading break presets:', e);
            }
        }

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
        // Sync existing values from DOM if modal is currently open
        const existingNameInput = document.getElementById('shift-tmpl-name');
        if (existingNameInput) {
            this._name = existingNameInput.value;
        }
        this._syncBreaksFromDom();

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

        // Note: cycle chips, breaks list, and presets toolbar are rendered dynamically

        // Note: breaks list and presets toolbar are rendered dynamically via renderBreaksListHtml & renderPresetsBarHtml

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
                        <div style="display: flex; flex-direction: column; gap: 0.9rem; margin-top: 0.4rem;">
                            <!-- Rotational Presets -->
                            <div style="display: flex; flex-direction: column; gap: 0.45rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); display: flex; align-items: center; gap: 5px;">
                                        <span>🔄</span>
                                        <span>${isRtl ? 'الگوهای استاندارد نوبت‌کاری:' : 'Standard Rotation Cycles:'}</span>
                                    </span>
                                    <span id="rot-custom-indicator" class="badge" style="font-size: 0.7rem; padding: 2px 7px; ${this._rotationPattern.pattern_type === 'custom' ? 'background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);' : 'display: none;'}">
                                        ✨ ${isRtl ? 'الگوی سفارشی' : 'Custom Sequence'}
                                    </span>
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem;">
                                    <button
                                        type="button"
                                        id="rot-preset-btn-2d_2n_1off"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '2d_2n_1off' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('2d_2n_1off')"
                                        style="font-size: 0.75rem; padding: 0.45rem 0.6rem; text-align: start; display: flex; align-items: center; justify-content: space-between;"
                                    >
                                        <span>${I18n.t('preset_2d_2n_1off') || '۲ روز، ۲ شب، ۱ آف'}</span>
                                        <span style="font-size: 0.68rem; opacity: 0.8; font-family: monospace;">(5d)</span>
                                    </button>
                                    <button
                                        type="button"
                                        id="rot-preset-btn-2d_2n_2off"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '2d_2n_2off' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('2d_2n_2off')"
                                        style="font-size: 0.75rem; padding: 0.45rem 0.6rem; text-align: start; display: flex; align-items: center; justify-content: space-between;"
                                    >
                                        <span>${I18n.t('preset_2d_2n_2off') || '۲ روز، ۲ شب، ۲ آف'}</span>
                                        <span style="font-size: 0.68rem; opacity: 0.8; font-family: monospace;">(6d)</span>
                                    </button>
                                    <button
                                        type="button"
                                        id="rot-preset-btn-24_48"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '24_48' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('24_48')"
                                        style="font-size: 0.75rem; padding: 0.45rem 0.6rem; text-align: start; display: flex; align-items: center; justify-content: space-between;"
                                    >
                                        <span>${I18n.t('preset_24_48') || '۲۴ ساعت کار، ۴۸ استراحت'}</span>
                                        <span style="font-size: 0.68rem; opacity: 0.8; font-family: monospace;">(4d)</span>
                                    </button>
                                    <button
                                        type="button"
                                        id="rot-preset-btn-1d_1n_2off"
                                        class="btn btn-sm ${this._rotationPattern.pattern_type === '1d_1n_2off' ? 'btn-primary' : 'btn-secondary'}"
                                        onclick="ShiftTemplateModal.applyRotationalPreset('1d_1n_2off')"
                                        style="font-size: 0.75rem; padding: 0.45rem 0.6rem; text-align: start; display: flex; align-items: center; justify-content: space-between;"
                                    >
                                        <span>${I18n.t('preset_1d_1n_2off') || (isRtl ? '۱ روز، ۱ شب، ۲ آف' : '1 Day, 1 Night, 2 Off')}</span>
                                        <span style="font-size: 0.68rem; opacity: 0.8; font-family: monospace;">(4d)</span>
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
                                            id="rot-day-start"
                                            class="form-control"
                                            value="${this._rotationPattern.day_start || '07:00'}"
                                            onchange="ShiftTemplateModal._rotationPattern.day_start = this.value"
                                            style="font-family: monospace; direction: ltr; font-size: 0.8rem; text-align: center; padding: 0.35rem;"
                                        />
                                        <span>-</span>
                                        <input
                                            type="time"
                                            id="rot-day-end"
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
                                            id="rot-night-start"
                                            class="form-control"
                                            value="${this._rotationPattern.night_start || '19:00'}"
                                            onchange="ShiftTemplateModal._rotationPattern.night_start = this.value"
                                            style="font-family: monospace; direction: ltr; font-size: 0.8rem; text-align: center; padding: 0.35rem;"
                                        />
                                        <span>-</span>
                                        <input
                                            type="time"
                                            id="rot-night-end"
                                            class="form-control"
                                            value="${this._rotationPattern.night_end || '07:00'}"
                                            onchange="ShiftTemplateModal._rotationPattern.night_end = this.value"
                                            style="font-family: monospace; direction: ltr; font-size: 0.8rem; text-align: center; padding: 0.35rem;"
                                        />
                                    </div>
                                </div>
                            </div>

                            <!-- Anchor Date -->
                            <div class="form-group" style="margin: 0; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.6rem 0.8rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; flex-wrap: wrap; gap: 0.3rem;">
                                    <label for="rot-anchor-date" style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin: 0; display: flex; align-items: center; gap: 4px;">
                                        <span>📅</span>
                                        <span>${I18n.t('rotation_anchor_date') || 'تاریخ مبنای شروع چرخه:'}</span>
                                    </label>
                                    <span id="rot-anchor-shamsi" style="font-size: 0.72rem; color: var(--text-tertiary); direction: rtl;">
                                        ${this._formatAnchorDatePreview(this._rotationPattern.anchor_date || '2026-01-01')}
                                    </span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                    <input
                                        type="date"
                                        id="rot-anchor-date"
                                        class="form-control"
                                        value="${(this._rotationPattern.anchor_date || '2026-01-01').slice(0, 10)}"
                                        onchange="ShiftTemplateModal.onAnchorDateChange(this.value)"
                                        style="font-family: monospace; font-size: 0.82rem; padding: 0.35rem 0.6rem; max-width: 170px;"
                                    />
                                    <span style="font-size: 0.7rem; color: var(--text-tertiary);">
                                        ${isRtl ? 'روز اول چرخه از این تاریخ آغاز و تکرار می‌شود' : 'Cycle starts repeating from this date'}
                                    </span>
                                </div>
                            </div>

                            <!-- Interactive Cycle Sequence Builder -->
                            <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.6rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.4rem;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-primary);">
                                            ${I18n.t('rotation_cycle_sequence') || (isRtl ? 'ترتیب و چرخه نوبت‌کاری:' : 'Rotation Cycle Sequence:')}
                                        </span>
                                        <span id="rot-cycle-length-badge" class="badge badge-subtle" style="font-size: 0.72rem; color: var(--accent-blue); font-weight: 700; padding: 2px 7px;">
                                            ${this._formatCycleLengthBadge()}
                                        </span>
                                    </div>
                                    <span style="font-size: 0.68rem; color: var(--text-tertiary);">
                                        ${I18n.t('rotation_click_hint') || (isRtl ? '💡 برای تغییر نوع روز روی آن کلیک کنید' : '💡 Click any chip to cycle status')}
                                    </span>
                                </div>

                                <!-- Chips timeline container -->
                                <div id="rot-cycle-chips-container" style="display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; min-height: 38px; padding: 0.25rem 0;">
                                    ${this.renderCycleChipsHtml()}
                                </div>

                                <!-- Step Addition & Reset Actions Toolbar -->
                                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.4rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-subtle);">
                                    <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                                        <button
                                            type="button"
                                            class="btn btn-sm btn-ghost"
                                            onclick="ShiftTemplateModal.addCycleStep('day')"
                                            style="padding: 3px 8px; font-size: 0.73rem; border: 1px solid rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.1); color: #fbbf24; border-radius: 6px; cursor: pointer; transition: all 0.15s; font-weight: 600;"
                                            title="${isRtl ? 'افزودن یک روز روزکار به انتهای چرخه' : 'Append a Day shift step'}"
                                        >
                                            ☀️ ${I18n.t('btn_add_cycle_day') || (isRtl ? '＋ روزکار' : '＋ Day')}
                                        </button>
                                        <button
                                            type="button"
                                            class="btn btn-sm btn-ghost"
                                            onclick="ShiftTemplateModal.addCycleStep('night')"
                                            style="padding: 3px 8px; font-size: 0.73rem; border: 1px solid rgba(139, 92, 246, 0.35); background: rgba(139, 92, 246, 0.1); color: #c4b5fd; border-radius: 6px; cursor: pointer; transition: all 0.15s; font-weight: 600;"
                                            title="${isRtl ? 'افزودن یک روز شب‌کار به انتهای چرخه' : 'Append a Night shift step'}"
                                        >
                                            🌙 ${I18n.t('btn_add_cycle_night') || (isRtl ? '＋ شب‌کار' : '＋ Night')}
                                        </button>
                                        <button
                                            type="button"
                                            class="btn btn-sm btn-ghost"
                                            onclick="ShiftTemplateModal.addCycleStep('off')"
                                            style="padding: 3px 8px; font-size: 0.73rem; border: 1px solid rgba(148, 163, 184, 0.35); background: rgba(100, 116, 139, 0.15); color: #94a3b8; border-radius: 6px; cursor: pointer; transition: all 0.15s; font-weight: 600;"
                                            title="${isRtl ? 'افزودن یک روز آف/استراحت به انتهای چرخه' : 'Append an Off-duty step'}"
                                        >
                                            ☕ ${I18n.t('btn_add_cycle_off') || (isRtl ? '＋ آف (استراحت)' : '＋ Off')}
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        class="btn btn-ghost btn-sm"
                                        onclick="ShiftTemplateModal.resetCycleToDefault()"
                                        style="padding: 3px 8px; font-size: 0.7rem; color: var(--text-tertiary); cursor: pointer;"
                                        title="${isRtl ? 'بازنشانی چرخه به ۵ روزه استاندارد (۲ روز، ۲ شب، ۱ آف)' : 'Reset cycle to 5-day standard (2D+2N+1Off)'}"
                                    >
                                        ↺ ${I18n.t('btn_reset_cycle') || (isRtl ? 'بازنشانی' : 'Reset')}
                                    </button>
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
                                <span class="badge badge-subtle" id="shift-breaks-count-badge" style="font-size: 0.7rem; padding: 2px 6px; margin-inline-start: 4px;">
                                    ${isRtl ? I18n.toPersianDigits((this._freeTimes || []).length) : (this._freeTimes || []).length}
                                </span>
                            </span>
                            <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 2px;">
                                ${I18n.t('scheduled_breaks_desc') || 'در این بازه‌ها سیستم هشدار عدم حضور را متوقف می‌کند.'}
                            </div>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ShiftTemplateModal.addBreakRow()" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; display: flex; align-items: center; gap: 4px;">
                            <span>＋</span> <span>${I18n.t('btn_add_break') || (isRtl ? 'افزودن استراحت' : 'Add Break')}</span>
                        </button>
                    </div>

                    <!-- Editable Break Rows List Container -->
                    <div id="shift-breaks-list-container" style="display: flex; flex-direction: column; gap: 0.45rem;">
                        ${this.renderBreaksListHtml()}
                    </div>

                    <!-- Defaults / Quick Presets Bar -->
                    ${this.renderPresetsBarHtml()}
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
        this._syncBreaksFromDom();
        if (this._shiftType === 'rotational') {
            this._syncRotationFromDom();
        }
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

    renderCycleChipsHtml() {
        const isRtl = I18n.isRTL();
        const cycle = this._rotationPattern?.cycle || [];
        if (cycle.length === 0) {
            return `
                <div style="font-size: 0.75rem; color: var(--text-tertiary); padding: 0.4rem;">
                    ${isRtl ? 'چرخه خالی است. برای افزودن از دکمه‌های زیر استفاده کنید.' : 'Cycle is empty. Use buttons below to add steps.'}
                </div>
            `;
        }

        return cycle.map((step, idx) => {
            let icon = '☀️';
            let label = isRtl ? 'روز' : 'Day';
            let badgeBg = 'rgba(245, 158, 11, 0.15)';
            let badgeBorder = 'rgba(245, 158, 11, 0.35)';
            let badgeColor = '#fbbf24';
            let nextStateHint = isRtl ? 'تغییر به شب‌کار' : 'Switch to Night';

            if (step === 'night') {
                icon = '🌙';
                label = isRtl ? 'شب' : 'Night';
                badgeBg = 'rgba(139, 92, 246, 0.15)';
                badgeBorder = 'rgba(139, 92, 246, 0.35)';
                badgeColor = '#c4b5fd';
                nextStateHint = isRtl ? 'تغییر به آف' : 'Switch to Off';
            } else if (step === 'off') {
                icon = '☕';
                label = isRtl ? 'آف' : 'Off';
                badgeBg = 'rgba(100, 116, 139, 0.18)';
                badgeBorder = 'rgba(100, 116, 139, 0.3)';
                badgeColor = '#94a3b8';
                nextStateHint = isRtl ? 'تغییر به روزکار' : 'Switch to Day';
            }

            const stepNum = isRtl ? I18n.toPersianDigits(idx + 1) : (idx + 1);
            const removeBtnHtml = cycle.length > 1
                ? `<button
                        type="button"
                        onclick="event.stopPropagation(); ShiftTemplateModal.removeCycleStep(${idx})"
                        title="${isRtl ? 'حذف این روز از چرخه' : 'Remove step'}"
                        style="background: transparent; border: none; color: inherit; opacity: 0.65; cursor: pointer; padding: 0 2px; font-size: 0.72rem; line-height: 1; border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; margin-inline-start: 4px;"
                        onmouseenter="this.style.opacity='1'; this.style.color='#f87171'"
                        onmouseleave="this.style.opacity='0.65'; this.style.color='inherit'"
                   >✕</button>`
                : '';

            return `
                <div
                    class="rot-cycle-chip"
                    onclick="ShiftTemplateModal.toggleCycleStep(${idx})"
                    title="${isRtl ? `روز ${stepNum}: ${label} (کلیک: ${nextStateHint})` : `Day ${stepNum}: ${label} (Click: ${nextStateHint})`}"
                    style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 5px 10px; border-radius: 8px; background: ${badgeBg}; color: ${badgeColor}; font-size: 0.78rem; font-weight: 700; border: 1px solid ${badgeBorder}; cursor: pointer; user-select: none; transition: transform 0.12s, box-shadow 0.12s;"
                    onmouseenter="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 2px 6px rgba(0,0,0,0.2)'"
                    onmouseleave="this.style.transform='none'; this.style.boxShadow='none'"
                >
                    <span>${icon}</span>
                    <span>${label} ${stepNum}</span>
                    ${removeBtnHtml}
                </div>
            `;
        }).join('');
    },

    toggleCycleStep(idx) {
        if (!this._rotationPattern || !this._rotationPattern.cycle) return;
        const current = this._rotationPattern.cycle[idx];
        let next = 'day';
        if (current === 'day') next = 'night';
        else if (current === 'night') next = 'off';
        else if (current === 'off') next = 'day';

        this._rotationPattern.cycle[idx] = next;
        this._rotationPattern.pattern_type = this._detectPresetType();
        this.refreshCycleTimeline();
    },

    addCycleStep(stepType) {
        if (!this._rotationPattern) this._rotationPattern = {};
        if (!this._rotationPattern.cycle) this._rotationPattern.cycle = [];
        this._rotationPattern.cycle.push(stepType || 'day');
        this._rotationPattern.pattern_type = this._detectPresetType();
        this.refreshCycleTimeline();
    },

    removeCycleStep(idx) {
        if (!this._rotationPattern || !this._rotationPattern.cycle) return;
        if (this._rotationPattern.cycle.length <= 1) return;
        this._rotationPattern.cycle.splice(idx, 1);
        this._rotationPattern.pattern_type = this._detectPresetType();
        this.refreshCycleTimeline();
    },

    resetCycleToDefault() {
        this.applyRotationalPreset('2d_2n_1off');
    },

    _detectPresetType() {
        const cycle = this._rotationPattern?.cycle || [];
        const seq = cycle.join(',');
        if (seq === 'day,day,night,night,off') return '2d_2n_1off';
        if (seq === 'day,day,night,night,off,off') return '2d_2n_2off';
        if (seq === 'day,off,off,off') return '24_48';
        if (seq === 'day,night,off,off') return '1d_1n_2off';
        return 'custom';
    },

    _formatCycleLengthBadge() {
        const isRtl = I18n.isRTL();
        const len = (this._rotationPattern?.cycle || []).length;
        if (isRtl) {
            return `${I18n.toPersianDigits(len)} روز در هر دوره`;
        }
        return `${len} ${len === 1 ? 'day' : 'days'} per cycle`;
    },

    _formatAnchorDatePreview(anchorDateStr) {
        if (!anchorDateStr) return '';
        const isRtl = I18n.isRTL();
        try {
            const shamsi = I18n.formatDate(anchorDateStr);
            return isRtl ? `(${shamsi})` : `(${anchorDateStr})`;
        } catch {
            return `(${anchorDateStr})`;
        }
    },

    onAnchorDateChange(val) {
        if (!this._rotationPattern) this._rotationPattern = {};
        this._rotationPattern.anchor_date = val;
        const shamsiEl = document.getElementById('rot-anchor-shamsi');
        if (shamsiEl) {
            shamsiEl.textContent = this._formatAnchorDatePreview(val);
        }
    },

    refreshCycleTimeline() {
        const container = document.getElementById('rot-cycle-chips-container');
        if (container) {
            container.innerHTML = this.renderCycleChipsHtml();
        }

        const badge = document.getElementById('rot-cycle-length-badge');
        if (badge) {
            badge.textContent = this._formatCycleLengthBadge();
        }

        const currentType = this._rotationPattern?.pattern_type;
        const presets = ['2d_2n_1off', '2d_2n_2off', '24_48', '1d_1n_2off'];
        presets.forEach(p => {
            const btn = document.getElementById(`rot-preset-btn-${p}`);
            if (btn) {
                if (p === currentType) {
                    btn.classList.remove('btn-secondary');
                    btn.classList.add('btn-primary');
                } else {
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-secondary');
                }
            }
        });

        const customInd = document.getElementById('rot-custom-indicator');
        if (customInd) {
            if (currentType === 'custom') {
                customInd.style.display = 'inline-flex';
            } else {
                customInd.style.display = 'none';
            }
        }
    },

    applyRotationalPreset(patternKey) {
        const anchor = this._rotationPattern?.anchor_date || '2026-01-01';
        let dayStart = '07:00';
        let dayEnd = '19:00';
        let nightStart = '19:00';
        let nightEnd = '07:00';
        let cycle = ['day', 'day', 'night', 'night', 'off'];

        if (patternKey === '2d_2n_1off') {
            cycle = ['day', 'day', 'night', 'night', 'off'];
            dayStart = '07:00';
            dayEnd = '19:00';
            nightStart = '19:00';
            nightEnd = '07:00';
        } else if (patternKey === '2d_2n_2off') {
            cycle = ['day', 'day', 'night', 'night', 'off', 'off'];
            dayStart = '07:00';
            dayEnd = '19:00';
            nightStart = '19:00';
            nightEnd = '07:00';
        } else if (patternKey === '24_48') {
            cycle = ['day', 'off', 'off', 'off'];
            dayStart = '08:00';
            dayEnd = '08:00';
            nightStart = '20:00';
            nightEnd = '08:00';
        } else if (patternKey === '1d_1n_2off') {
            cycle = ['day', 'night', 'off', 'off'];
            dayStart = '07:00';
            dayEnd = '19:00';
            nightStart = '19:00';
            nightEnd = '07:00';
        }

        this._rotationPattern = {
            pattern_type: patternKey,
            cycle: cycle,
            anchor_date: anchor,
            day_start: dayStart,
            day_end: dayEnd,
            night_start: nightStart,
            night_end: nightEnd,
        };

        // Update DOM inputs if they exist
        const dsInput = document.getElementById('rot-day-start');
        const deInput = document.getElementById('rot-day-end');
        const nsInput = document.getElementById('rot-night-start');
        const neInput = document.getElementById('rot-night-end');
        if (dsInput) dsInput.value = dayStart;
        if (deInput) deInput.value = dayEnd;
        if (nsInput) nsInput.value = nightStart;
        if (neInput) neInput.value = nightEnd;

        this.refreshCycleTimeline();
    },

    _syncRotationFromDom() {
        if (!this._rotationPattern) this._rotationPattern = {};

        const anchorEl = document.getElementById('rot-anchor-date');
        if (anchorEl && anchorEl.value) {
            this._rotationPattern.anchor_date = anchorEl.value;
        }
        const dsEl = document.getElementById('rot-day-start');
        if (dsEl && dsEl.value) {
            this._rotationPattern.day_start = dsEl.value;
        }
        const deEl = document.getElementById('rot-day-end');
        if (deEl && deEl.value) {
            this._rotationPattern.day_end = deEl.value;
        }
        const nsEl = document.getElementById('rot-night-start');
        if (nsEl && nsEl.value) {
            this._rotationPattern.night_start = nsEl.value;
        }
        const neEl = document.getElementById('rot-night-end');
        if (neEl && neEl.value) {
            this._rotationPattern.night_end = neEl.value;
        }
    },

    _getBreakIcon(name) {
        const lower = (name || '').toLowerCase();
        if (lower.includes('ناهار') || lower.includes('lunch') || lower.includes('غذا')) return '🍽️';
        if (lower.includes('نماز') || lower.includes('prayer')) return '🍱';
        if (lower.includes('چای') || lower.includes('tea') || lower.includes('عصرانه') || lower.includes('coffee')) return '☕';
        if (lower.includes('شب') || lower.includes('night')) return '🌙';
        return '☕';
    },

    _calcDurationText(startTime, endTime) {
        const isRtl = I18n.isRTL();
        if (!startTime || !endTime) return '';
        const sParts = startTime.split(':').map(Number);
        const eParts = endTime.split(':').map(Number);
        if (sParts.length !== 2 || eParts.length !== 2 || isNaN(sParts[0]) || isNaN(sParts[1]) || isNaN(eParts[0]) || isNaN(eParts[1])) {
            return '';
        }
        const sMins = sParts[0] * 60 + sParts[1];
        let eMins = eParts[0] * 60 + eParts[1];
        if (eMins < sMins) eMins += 24 * 60;
        const diff = eMins - sMins;
        return isRtl ? `(${I18n.toPersianDigits(diff)} دقیقه)` : `(${diff} mins)`;
    },

    _syncBreaksFromDom() {
        const container = document.getElementById('shift-breaks-list-container');
        if (!container) return;
        const rows = container.querySelectorAll('.shift-break-row');
        const list = [];
        rows.forEach((row) => {
            const nameInput = row.querySelector('.shift-break-name-input');
            const startInput = row.querySelector('.shift-break-start-input');
            const endInput = row.querySelector('.shift-break-end-input');
            if (nameInput && startInput && endInput) {
                const rawName = (nameInput.value || '').trim();
                const startTime = (startInput.value || '').trim() || '12:00';
                const endTime = (endInput.value || '').trim() || '13:00';
                const name = rawName || (I18n.isRTL() ? 'استراحت' : 'Break');
                const category = (name.toLowerCase().includes('lunch') || name.includes('ناهار') || name.includes('غذا')) ? 'lunch' : 'rest';
                list.push({
                    name: name,
                    start_time: startTime,
                    end_time: endTime,
                    category: category,
                });
            }
        });
        this._freeTimes = list;
    },

    getAvailablePresets() {
        const isRtl = I18n.isRTL();
        const serverPresets = (typeof BreakPresets !== 'undefined' && typeof BreakPresets.getPresets === 'function')
            ? BreakPresets.getPresets()
            : [];

        if (serverPresets && serverPresets.length > 0) {
            return serverPresets;
        }

        return [
            { name: isRtl ? 'ناهار و استراحت' : 'Lunch Break', start_time: '12:00', end_time: '13:00', icon: '🍽️', category: 'lunch' },
            { name: isRtl ? 'ناهار و نماز' : 'Lunch & Prayer', start_time: '12:30', end_time: '13:30', icon: '🍱', category: 'lunch' },
            { name: isRtl ? 'عصرانه و چای' : 'Tea Break', start_time: '16:00', end_time: '16:30', icon: '☕', category: 'rest' },
            { name: isRtl ? 'استراحت شبانه' : 'Midnight Rest', start_time: '03:00', end_time: '03:45', icon: '🌙', category: 'rest' },
        ];
    },

    renderBreaksListHtml() {
        const isRtl = I18n.isRTL();
        if (!this._freeTimes || this._freeTimes.length === 0) {
            return `
                <div class="empty-breaks-notice" style="text-align: center; color: var(--text-tertiary); font-size: 0.75rem; padding: 0.75rem; background: var(--bg-surface); border-radius: 6px; border: 1px dashed var(--border-subtle);">
                    ☕ ${I18n.t('no_breaks_defined') || (isRtl 
                        ? 'هیچ زنگ استراحتی تعریف نشده است. با دکمه «افزودن استراحت» یا انتخاب از پیش‌فرض‌های زیر اضافه کنید.' 
                        : 'No scheduled breaks defined. Click "+ Add Break" or select from presets below.')}
                </div>
            `;
        }

        return this._freeTimes.map((br, idx) => {
            const icon = this._getBreakIcon(br.name);
            const durText = this._calcDurationText(br.start_time, br.end_time);

            return `
                <div class="shift-break-row" data-index="${idx}" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.7rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 6px; flex-wrap: wrap;">
                    <span class="shift-break-icon" style="font-size: 1.15rem; flex-shrink: 0; user-select: none;">${icon}</span>
                    
                    <!-- Break Name Input -->
                    <div style="flex: 2; min-width: 140px;">
                        <input
                            type="text"
                            class="form-control shift-break-name-input"
                            value="${this._escape(br.name || '')}"
                            placeholder="${I18n.t('break_name_placeholder') || (isRtl ? 'عنوان استراحت (مثال: ناهار، چای)' : 'Break Title (e.g. Lunch, Tea)')}"
                            oninput="ShiftTemplateModal.updateBreak(${idx}, 'name', this.value)"
                            style="font-size: 0.82rem; padding: 0.35rem 0.6rem; height: 34px; width: 100%;"
                        />
                    </div>

                    <!-- Time Range Inputs -->
                    <div style="display: inline-flex; align-items: center; gap: 0.35rem; flex-shrink: 0;">
                        <input
                            type="time"
                            class="form-control shift-break-start-input"
                            value="${br.start_time || '12:00'}"
                            onchange="ShiftTemplateModal.updateBreak(${idx}, 'start_time', this.value)"
                            style="width: 105px; font-family: monospace; font-size: 0.82rem; text-align: center; padding: 0.35rem 0.3rem; height: 34px; direction: ltr;"
                            title="${isRtl ? 'زمان شروع استراحت' : 'Break Start Time'}"
                        />
                        <span style="font-size: 0.75rem; color: var(--text-tertiary);">${isRtl ? 'تا' : 'to'}</span>
                        <input
                            type="time"
                            class="form-control shift-break-end-input"
                            value="${br.end_time || '13:00'}"
                            onchange="ShiftTemplateModal.updateBreak(${idx}, 'end_time', this.value)"
                            style="width: 105px; font-family: monospace; font-size: 0.82rem; text-align: center; padding: 0.35rem 0.3rem; height: 34px; direction: ltr;"
                            title="${isRtl ? 'زمان پایان استراحت' : 'Break End Time'}"
                        />
                    </div>

                    <!-- Duration Badge -->
                    <span class="shift-break-duration badge badge-subtle" style="font-size: 0.72rem; padding: 3px 6px; white-space: nowrap; flex-shrink: 0; direction: ltr; min-width: 48px; text-align: center;">
                        ${durText}
                    </span>

                    <!-- Remove Button -->
                    <button
                        type="button"
                        class="btn btn-sm btn-icon"
                        onclick="ShiftTemplateModal.removeBreak(${idx})"
                        style="padding: 4px 8px; color: #f87171; background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.25); border-radius: 6px; cursor: pointer; flex-shrink: 0; line-height: 1; transition: all 0.15s; margin-inline-start: auto;"
                        title="${isRtl ? 'حذف این استراحت' : 'Remove break'}"
                    >
                        ✕
                    </button>
                </div>
            `;
        }).join('');
    },

    renderPresetsBarHtml() {
        const isRtl = I18n.isRTL();
        const presets = this.getAvailablePresets();

        const presetButtons = presets.map(p => {
            const icon = p.icon || this._getBreakIcon(p.name);
            const safeName = this._escape(p.name);
            return `
                <button
                    type="button"
                    class="btn btn-ghost btn-sm shift-preset-chip"
                    onclick="ShiftTemplateModal.applyPreset('${safeName}', '${p.start_time}', '${p.end_time}', '${p.category || 'lunch'}')"
                    style="padding: 3px 8px; font-size: 0.72rem; border-radius: 12px; border: 1px solid var(--border-subtle); display: inline-flex; align-items: center; gap: 4px; background: var(--bg-surface); cursor: pointer; transition: all 0.15s;"
                    title="${safeName} (${p.start_time} - ${p.end_time})"
                >
                    <span>${icon}</span>
                    <strong style="color: var(--text-primary); font-size: 0.74rem;">${safeName}</strong>
                    <span style="direction: ltr; font-family: monospace; opacity: 0.75; font-size: 0.7rem;">(${p.start_time}-${p.end_time})</span>
                </button>
            `;
        }).join('');

        return `
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.35rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-subtle);">
                <span style="font-size: 0.73rem; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px; margin-inline-end: 2px;">
                    <span>⚡</span>
                    <span>${I18n.t('quick_break_presets') || (isRtl ? 'الگوهای پیش‌فرض:' : 'Quick Defaults:')}</span>
                </span>
                ${presetButtons}
            </div>
        `;
    },

    refreshBreaksList() {
        const container = document.getElementById('shift-breaks-list-container');
        if (container) {
            container.innerHTML = this.renderBreaksListHtml();
        }
        const badge = document.getElementById('shift-breaks-count-badge');
        if (badge) {
            const count = (this._freeTimes || []).length;
            badge.textContent = I18n.isRTL() ? I18n.toPersianDigits(count) : count;
        }
    },

    applyPreset(name, startTime, endTime, category) {
        this._syncBreaksFromDom();
        if (!this._freeTimes) this._freeTimes = [];

        const exists = this._freeTimes.some(b => b.name === name && b.start_time === startTime && b.end_time === endTime);
        if (exists) {
            App.toast(I18n.isRTL() ? `استراحت «${name}» قبلاً اضافه شده است.` : `Break '${name}' already exists.`, 'info');
            return;
        }

        this._freeTimes.push({
            name: name,
            start_time: startTime || '12:00',
            end_time: endTime || '13:00',
            category: category || (name.toLowerCase().includes('lunch') || name.includes('ناهار') ? 'lunch' : 'rest'),
        });

        this.refreshBreaksList();
        App.toast(I18n.isRTL() ? `استراحت «${name}» اضافه شد.` : `Break '${name}' added.`, 'info');
    },

    addBreakRow() {
        this._syncBreaksFromDom();
        if (!this._freeTimes) this._freeTimes = [];
        const isRtl = I18n.isRTL();
        const defaultName = isRtl ? 'ناهار و استراحت' : 'Lunch Break';
        this._freeTimes.push({
            name: defaultName,
            start_time: '12:00',
            end_time: '13:00',
            category: 'lunch',
        });
        this.refreshBreaksList();

        setTimeout(() => {
            const rows = document.querySelectorAll('.shift-break-row');
            if (rows.length > 0) {
                const lastRow = rows[rows.length - 1];
                const input = lastRow.querySelector('.shift-break-name-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }
        }, 50);
    },

    updateBreak(idx, field, value) {
        if (!this._freeTimes || !this._freeTimes[idx]) return;
        this._freeTimes[idx][field] = value;

        if (field === 'start_time' || field === 'end_time') {
            const row = document.querySelector(`.shift-break-row[data-index="${idx}"]`);
            if (row) {
                const durEl = row.querySelector('.shift-break-duration');
                if (durEl) {
                    durEl.textContent = this._calcDurationText(this._freeTimes[idx].start_time, this._freeTimes[idx].end_time);
                }
            }
        } else if (field === 'name') {
            const row = document.querySelector(`.shift-break-row[data-index="${idx}"]`);
            if (row) {
                const iconEl = row.querySelector('.shift-break-icon');
                if (iconEl) {
                    iconEl.textContent = this._getBreakIcon(value);
                }
            }
        }
    },

    removeBreak(idx) {
        this._syncBreaksFromDom();
        if (this._freeTimes && idx >= 0 && idx < this._freeTimes.length) {
            this._freeTimes.splice(idx, 1);
            this.refreshBreaksList();
        }
    },

    async handleSave(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Sync break & rotational inputs from DOM before submitting
        this._syncBreaksFromDom();
        if (this._shiftType === 'rotational') {
            this._syncRotationFromDom();
            this._rotationPattern.pattern_type = this._detectPresetType();
            if (!this._rotationPattern.cycle || this._rotationPattern.cycle.length === 0) {
                this._rotationPattern.cycle = ['day', 'day', 'night', 'night', 'off'];
            }
            if (!this._rotationPattern.anchor_date) {
                this._rotationPattern.anchor_date = '2026-01-01';
            }
            if (!this._rotationPattern.day_start) this._rotationPattern.day_start = '07:00';
            if (!this._rotationPattern.day_end) this._rotationPattern.day_end = '19:00';
            if (!this._rotationPattern.night_start) this._rotationPattern.night_start = '19:00';
            if (!this._rotationPattern.night_end) this._rotationPattern.night_end = '07:00';
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
