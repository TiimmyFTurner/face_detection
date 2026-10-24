/**
 * PersonShiftModal — Dedicated Modal for Managing Person Shift Timetables,
 * Section/Department Assignments, Rotational Shifts (e.g. 2 days, 2 nights, 1 off),
 * and Camera Workstation Zones.
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
    _customSubtype: 'rotational', // 'rotational' | 'fixed'
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
        this._customSubtype = 'rotational';

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
            const [shiftData, templates, sections, cameras] = await Promise.all([
                App.api(`/api/persons/${personId}/shift`),
                App.api('/api/shift-templates'),
                App.api('/api/sections'),
                App.api('/api/cameras'),
            ]);

            this._data = shiftData;
            this._templates = templates || [];
            this._sections = sections || [];
            this._cameras = cameras || [];

            // Pre-select zones
            this._selectedZoneIds = new Set((shiftData.assigned_zones || []).map(z => z.id));
            this._selectedTemplateId = shiftData.shift_template_id;
            this._isCustomShift = !!shiftData.custom_shift;

            if (shiftData.custom_shift) {
                const cs = shiftData.custom_shift;
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
                }
            } else {
                this._customSubtype = 'rotational';
                this._rotationPattern = {
                    pattern_type: '2d_2n_1off',
                    cycle: ['day', 'day', 'night', 'night', 'off'],
                    anchor_date: '2026-01-01',
                    day_start: '07:00',
                    day_end: '19:00',
                    night_start: '19:00',
                    night_end: '07:00',
                    grace_period_minutes: 15,
                    absence_timeout_minutes: 5,
                };
            }

            // Fetch zones across all cameras
            const zonesPromises = this._cameras.map(c => App.api(`/api/cameras/${c.id}/zones`).catch(() => []));
            const zonesResults = await Promise.all(zonesPromises);
            this._allZones = zonesResults.flat();

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
            dayNum: idx + 1,
            total: cycle.length,
        };
    },

    _renderCycleChips(pattern, highlightToday = true) {
        if (!pattern || !pattern.cycle) return '';
        const todayInfo = highlightToday ? this._calcRotationToday(pattern) : null;
        return pattern.cycle.map((state, idx) => {
            const isToday = todayInfo && todayInfo.index === idx;
            const icon = state === 'day' ? '☀️' : (state === 'night' ? '🌙' : '☕');
            const text = state === 'day' ? `روز ${idx + 1}` : (state === 'night' ? `شب ${idx + 1}` : `آف`);
            return `
                <span class="rotation-cycle-chip ${state} ${isToday ? 'is-today' : ''}" title="${state === 'day' ? 'شیفت روز' : (state === 'night' ? 'شیفت شب' : 'استراحت / آف')}">
                    <span>${icon}</span>
                    <span>${text}</span>
                </span>
            `;
        }).join('');
    },

    render() {
        const d = this._data;
        const isFa = I18n.isRTL();

        // 1. Build Section options
        let sectionOptions = `<option value="">${I18n.t('none') || 'بدون بخش'}</option>`;
        const currentSec = d.section || '';
        let foundCurrent = !currentSec;
        this._sections.forEach(s => {
            const sel = (s.name === currentSec) ? 'selected' : '';
            if (sel) foundCurrent = true;
            sectionOptions += `<option value="${this._escape(s.name)}" ${sel}>${this._escape(s.name)}</option>`;
        });
        if (currentSec && !foundCurrent) {
            sectionOptions += `<option value="${this._escape(currentSec)}" selected>${this._escape(currentSec)}</option>`;
        }

        // 2. Build Shift Templates options
        let templateCardsHtml = `
            <div class="shift-card-option ${!this._selectedTemplateId && !this._isCustomShift ? 'active' : ''}" onclick="PersonShiftModal.selectTemplate(null, false)">
                <div class="d-flex align-items-center justify-content-between mb-1">
                    <strong style="font-size: 0.9rem;">🚫 ${I18n.t('no_shift_assigned') || 'بدون شیفت ثابت'}</strong>
                    <span class="badge badge-subtle">شناور</span>
                </div>
                <small class="text-muted d-block text-xs">${I18n.t('no_shift_desc') || 'ساعات حضور ثبت شده اما کنترل عدم حضور سخت‌گیرانه اعمال نمی‌شود.'}</small>
            </div>
        `;

        this._templates.forEach(t => {
            const active = (this._selectedTemplateId === t.id && !this._isCustomShift);
            const isRot = (t.shift_type === 'rotational' || t.shift_type === 'rotation' || !!t.rotation_pattern);
            const daysCount = (t.active_days || []).length;

            if (isRot && t.rotation_pattern) {
                const pat = t.rotation_pattern;
                const todayInfo = this._calcRotationToday(pat);
                templateCardsHtml += `
                    <div class="shift-card-option ${active ? 'active' : ''}" style="border-left: 4px solid ${t.color || '#ec4899'};" onclick="PersonShiftModal.selectTemplate(${t.id}, false)">
                        <div class="d-flex align-items-center justify-content-between mb-2">
                            <strong style="font-size: 0.9rem;">🔄 ${this._escape(t.name)}</strong>
                            <span class="rotation-badge-rotational">نوبت‌کاری چرخشی</span>
                        </div>
                        <div class="d-flex align-items-center gap-1 mb-2 flex-wrap">
                            ${this._renderCycleChips(pat, active)}
                        </div>
                        <div class="d-flex align-items-center justify-content-between text-xs text-muted">
                            <span>☀️ ${pat.day_start || '07:00'}-${pat.day_end || '19:00'}</span>
                            <span>🌙 ${pat.night_start || '19:00'}-${pat.night_end || '07:00'}</span>
                            ${todayInfo ? `<span class="badge text-xs" style="background: rgba(56,189,248,0.15); color: #38bdf8;">امروز: ${todayInfo.stateName}</span>` : ''}
                        </div>
                    </div>
                `;
            } else {
                templateCardsHtml += `
                    <div class="shift-card-option ${active ? 'active' : ''}" style="border-left: 4px solid ${t.color || '#38bdf8'};" onclick="PersonShiftModal.selectTemplate(${t.id}, false)">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                            <strong style="font-size: 0.9rem;">${this._escape(t.name)}</strong>
                            <span class="badge text-xs" style="background: ${t.color}22; color: ${t.color}; border: 1px solid ${t.color}44;">
                                ${t.start_time} - ${t.end_time}
                            </span>
                        </div>
                        <small class="text-muted d-block text-xs">
                            📅 ${daysCount} روز در هفته · تاخیر مجاز: ${t.grace_period_minutes}دقیقه
                        </small>
                    </div>
                `;
            }
        });

        templateCardsHtml += `
            <div class="shift-card-option ${this._isCustomShift ? 'active' : ''}" onclick="PersonShiftModal.selectTemplate(null, true)">
                <div class="d-flex align-items-center justify-content-between mb-1">
                    <strong style="font-size: 0.9rem;">⚙️ ${I18n.t('custom_shift_option') || 'شیفت سفارشی (نوبت‌کاری چرخشی یا دستی)'}</strong>
                    <span class="badge badge-subtle">تنظیم دلخواه</span>
                </div>
                <small class="text-muted d-block text-xs">${I18n.t('custom_shift_hint') || 'تعیین نوبت‌کاری چرخشی (مانند ۲ روز، ۲ شب، ۱ آف) یا ساعات ثابت هفتگی'}</small>
            </div>
        `;

        // 3. Custom Shift Hours (if active)
        const custom = d.custom_shift || {};
        const startTime = custom.start_time || '08:00';
        const endTime = custom.end_time || '17:00';
        const graceMins = custom.grace_period_minutes ?? 10;
        const absenceMins = custom.absence_timeout_minutes ?? 2;
        const activeDays = new Set(custom.active_days || ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);

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
            <label class="day-checkbox-label ${activeDays.has(day.id) ? 'checked' : ''}">
                <input type="checkbox" class="shift-day-cb" value="${day.id}" ${activeDays.has(day.id) ? 'checked' : ''} onchange="this.parentElement.classList.toggle('checked', this.checked)">
                <span>${isFa ? day.label_fa : day.label_en}</span>
            </label>
        `).join('');

        // 4. Workstations / Camera Zones Checklist grouped by Camera
        const camMap = new Map();
        this._cameras.forEach(c => camMap.set(c.id, { camera: c, zones: [] }));
        this._allZones.forEach(z => {
            if (camMap.has(z.camera_id)) {
                camMap.get(z.camera_id).zones.push(z);
            }
        });

        let workstationsHtml = '';
        camMap.forEach(({ camera, zones }) => {
            if (zones.length === 0) return;
            const zoneItemsHtml = zones.map(z => {
                const checked = this._selectedZoneIds.has(z.id);
                return `
                    <label class="station-zone-item ${checked ? 'selected' : ''}">
                        <input type="checkbox" class="person-zone-cb" value="${z.id}" ${checked ? 'checked' : ''} onchange="PersonShiftModal.toggleZone(${z.id}, this.checked, this)">
                        <div class="station-zone-info">
                            <strong class="station-zone-name">${this._escape(z.name)}</strong>
                            <span class="station-zone-time">${z.start_time || '00:00'} - ${z.end_time || '23:59'}</span>
                        </div>
                    </label>
                `;
            }).join('');

            workstationsHtml += `
                <div class="camera-workstations-group mb-3">
                    <div class="camera-group-header">
                        <span class="camera-icon">📹</span>
                        <strong class="text-sm">${this._escape(camera.name)}</strong>
                        ${camera.location ? `<small class="text-muted">(${this._escape(camera.location)})</small>` : ''}
                        ${camera.section ? `<span class="badge badge-subtle text-xs ml-auto">${this._escape(camera.section)}</span>` : ''}
                    </div>
                    <div class="zones-subgrid">
                        ${zoneItemsHtml}
                    </div>
                </div>
            `;
        });

        if (!workstationsHtml) {
            workstationsHtml = `
                <div class="empty-state p-3 text-center card-glass">
                    <div class="text-muted text-xs">منطقه‌ای روی دوربین‌ها تعریف نشده است. می‌توانید در صفحه منطقه‌ها ایستگاه‌های کاری را ترسیم نمایید.</div>
                </div>
            `;
        }

        const pat = this._rotationPattern;
        const isRotCustom = (this._customSubtype === 'rotational');

        const modalHtml = `
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">⏰</span>
                    <div>
                        <h2 class="modal-title">${I18n.t('manage_shift') || 'مدیریت شیفت و ایستگاه کاری'} — ${this._escape(d.person_name)}</h2>
                        <p class="modal-subtitle">${this._escape(d.role || 'پرسنل')} ${d.section ? `· بخش: ${this._escape(d.section)}` : ''}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem 1.5rem; max-height: 75vh; overflow-y: auto;">
                <form id="person-shift-form" onsubmit="PersonShiftModal.save(event)">
                    <!-- Section Selection -->
                    <div class="card-glass p-3 mb-3">
                        <label class="form-label font-weight-bold d-flex align-items-center gap-2 mb-1" for="person-shift-section">
                            <span>🏢</span>
                            <span>${I18n.t('section') || 'بخش سازمانی / دپارتمان'}</span>
                        </label>
                        <div class="d-flex gap-2">
                            <select id="person-shift-section" class="form-control form-select">
                                ${sectionOptions}
                            </select>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="PersonShiftModal.quickAddSection()" title="افزودن بخش جدید">
                                ➕
                            </button>
                        </div>
                        <small class="text-muted d-block text-xs mt-1">
                            انتساب فرد به بخش کارخانه، باعث دسترسی خودکار سرپرست این بخش به پرونده و سوابق فرد می‌شود.
                        </small>
                    </div>

                    <!-- Shift Templates Selection -->
                    <div class="card-glass p-3 mb-3">
                        <label class="form-label font-weight-bold d-flex align-items-center gap-2 mb-2">
                            <span>⏱️</span>
                            <span>${I18n.t('shift_template') || 'الگو و زمان‌بندی شیفت کاری'}</span>
                        </label>
                        <div class="shift-templates-grid mb-3">
                            ${templateCardsHtml}
                        </div>

                        <!-- Custom Shift Panel (toggled) -->
                        <div id="custom-shift-panel" class="custom-shift-box" style="display: ${this._isCustomShift ? 'block' : 'none'};">
                            <!-- Segmented Switch: Rotational vs Fixed -->
                            <div class="rotation-type-segmented mb-3">
                                <button type="button" class="rotation-segmented-btn ${isRotCustom ? 'active' : ''}" onclick="PersonShiftModal.switchCustomSubtype('rotational')">
                                    <span>🔄</span>
                                    <span>${I18n.t('shift_mode_rotational') || 'نوبت‌کاری چرخشی (۲ روز، ۲ شب، ۱ آف)'}</span>
                                </button>
                                <button type="button" class="rotation-segmented-btn ${!isRotCustom ? 'active' : ''}" onclick="PersonShiftModal.switchCustomSubtype('fixed')">
                                    <span>📅</span>
                                    <span>${I18n.t('shift_mode_fixed') || 'شیفت ثابت هفتگی'}</span>
                                </button>
                            </div>

                            <!-- Rotational Shift Configuration -->
                            <div id="rotational-config-section" style="display: ${isRotCustom ? 'block' : 'none'};">
                                <div class="mb-2">
                                    <label class="form-label text-xs font-weight-bold">الگوی چرخه نوبت‌کاری (انتخاب سریع یا سفارشی):</label>
                                    <div class="rotation-presets-grid">
                                        <div class="rotation-preset-card ${pat.pattern_type === '2d_2n_1off' ? 'active' : ''}" onclick="PersonShiftModal.setRotationPreset('2d_2n_1off')">
                                            <span class="rotation-preset-title">۲ روز، ۲ شب، ۱ آف ⭐</span>
                                            <span class="rotation-preset-sub">چرخه ۵ روزه (روز، روز، شب، شب، آف)</span>
                                        </div>
                                        <div class="rotation-preset-card ${pat.pattern_type === '2d_2n_2off' ? 'active' : ''}" onclick="PersonShiftModal.setRotationPreset('2d_2n_2off')">
                                            <span class="rotation-preset-title">۲ روز، ۲ شب، ۲ آف</span>
                                            <span class="rotation-preset-sub">چرخه ۶ روزه (۲ روزکار، ۲ شب، ۲ آف)</span>
                                        </div>
                                        <div class="rotation-preset-card ${pat.pattern_type === '24_48' ? 'active' : ''}" onclick="PersonShiftModal.setRotationPreset('24_48')">
                                            <span class="rotation-preset-title">۲۴ ساعت کار، ۴۸ آف</span>
                                            <span class="rotation-preset-sub">چرخه ۴ روزه (روز، شب، ۲ آف)</span>
                                        </div>
                                    </div>
                                </div>

                                <!-- Visual Cycle Timeline -->
                                <div class="mb-3">
                                    <div class="d-flex align-items-center justify-content-between mb-1">
                                        <label class="form-label text-xs font-weight-bold m-0">پیش‌نمایش چرخه نوبت‌کاری:</label>
                                        <span class="text-xs text-muted" id="rot-timeline-info">طول چرخه: ${pat.cycle.length} روز</span>
                                    </div>
                                    <div class="rotation-cycle-timeline" id="rotation-cycle-chips-container">
                                        ${this._renderCycleChips(pat, true)}
                                    </div>
                                </div>

                                <div class="row g-2 mb-3">
                                    <div class="col-12 col-md-4">
                                        <label class="form-label text-xs font-weight-bold">📅 ${I18n.t('rotation_anchor_date') || 'تاریخ مبنای شروع چرخه'}</label>
                                        <input type="date" id="rot-anchor-date" class="form-control form-control-sm" value="${pat.anchor_date || '2026-01-01'}" onchange="PersonShiftModal.updateRotationTimeline()">
                                    </div>
                                    <div class="col-6 col-md-4">
                                        <label class="form-label text-xs font-weight-bold">☀️ ${I18n.t('rotation_day_shift') || 'ساعت شیفت روز'}</label>
                                        <div class="d-flex align-items-center gap-1">
                                            <input type="time" id="rot-day-start" class="form-control form-control-sm" value="${pat.day_start || '07:00'}">
                                            <span class="text-xs text-muted">تا</span>
                                            <input type="time" id="rot-day-end" class="form-control form-control-sm" value="${pat.day_end || '19:00'}">
                                        </div>
                                    </div>
                                    <div class="col-6 col-md-4">
                                        <label class="form-label text-xs font-weight-bold">🌙 ${I18n.t('rotation_night_shift') || 'ساعت شیفت شب'}</label>
                                        <div class="d-flex align-items-center gap-1">
                                            <input type="time" id="rot-night-start" class="form-control form-control-sm" value="${pat.night_start || '19:00'}">
                                            <span class="text-xs text-muted">تا</span>
                                            <input type="time" id="rot-night-end" class="form-control form-control-sm" value="${pat.night_end || '07:00'}">
                                        </div>
                                    </div>
                                </div>

                                <div class="row g-2">
                                    <div class="col-6">
                                        <label class="form-label text-xs">${I18n.t('grace_period_minutes') || 'مهلت مجاز تاخیر (دقیقه)'}</label>
                                        <input type="number" id="rot-grace" class="form-control form-control-sm" min="0" max="60" value="${pat.grace_period_minutes ?? 15}">
                                    </div>
                                    <div class="col-6">
                                        <label class="form-label text-xs">${I18n.t('absence_timeout_minutes') || 'هشدار عدم حضور (دقیقه)'}</label>
                                        <input type="number" id="rot-absence" class="form-control form-control-sm" min="1" max="60" value="${pat.absence_timeout_minutes ?? 5}">
                                    </div>
                                </div>
                            </div>

                            <!-- Fixed Shift Configuration -->
                            <div id="fixed-config-section" style="display: ${!isRotCustom ? 'block' : 'none'};">
                                <div class="row g-2 mb-2">
                                    <div class="col-6">
                                        <label class="form-label text-xs font-weight-bold">${I18n.t('start_time') || 'ساعت شروع'}</label>
                                        <input type="time" id="custom-shift-start" class="form-control form-control-sm" value="${startTime}">
                                    </div>
                                    <div class="col-6">
                                        <label class="form-label text-xs font-weight-bold">${I18n.t('end_time') || 'ساعت پایان'}</label>
                                        <input type="time" id="custom-shift-end" class="form-control form-control-sm" value="${endTime}">
                                    </div>
                                </div>

                                <div class="mb-2">
                                    <label class="form-label text-xs font-weight-bold">${I18n.t('active_days') || 'روزهای کاری فعال'}</label>
                                    <div class="days-checkboxes-bar">
                                        ${daysCheckboxesHtml}
                                    </div>
                                </div>

                                <div class="row g-2">
                                    <div class="col-6">
                                        <label class="form-label text-xs">${I18n.t('grace_period_minutes') || 'مهلت مجاز تاخیر (دقیقه)'}</label>
                                        <input type="number" id="custom-shift-grace" class="form-control form-control-sm" min="0" max="60" value="${graceMins}">
                                    </div>
                                    <div class="col-6">
                                        <label class="form-label text-xs">${I18n.t('absence_timeout_minutes') || 'هشدار عدم حضور (دقیقه)'}</label>
                                        <input type="number" id="custom-shift-absence" class="form-control form-control-sm" min="1" max="60" value="${absenceMins}">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Workstation Assignment (Camera Zones) -->
                    <div class="card-glass p-3 mb-4">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <label class="form-label font-weight-bold d-flex align-items-center gap-2 m-0">
                                <span>🎯</span>
                                <span>${I18n.t('assigned_workstations') || 'ایستگاه‌های کاری منتسب (Camera Zones)'}</span>
                            </label>
                            <span class="badge badge-subtle text-xs" id="selected-zones-count-badge">
                                ${this._selectedZoneIds.size} ایستگاه انتخاب شده
                            </span>
                        </div>
                        <small class="text-muted d-block text-xs mb-3">
                            ${I18n.t('assigned_workstations_hint') || 'مشخص نمایید پرسنل در این شیفت در کدام ایستگاه‌ها و دوربین‌ها باید حضور داشته باشد.'}
                        </small>
                        <div class="workstations-container">
                            ${workstationsHtml}
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || 'انصراف'}</button>
                        <button type="submit" id="save-shift-btn" class="btn btn-primary">
                            <span>💾</span>
                            <span>${I18n.t('save') || 'ذخیره شیفت و ایستگاه‌ها'}</span>
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
        if (type === 'rotational' && btns[0]) btns[0].classList.add('active');
        if (type === 'fixed' && btns[1]) btns[1].classList.add('active');
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
        }
        const container = document.getElementById('rotation-cycle-chips-container');
        if (container) {
            container.innerHTML = this._renderCycleChips(this._rotationPattern, true);
        }
    },

    selectTemplate(templateId, isCustom) {
        this._selectedTemplateId = templateId;
        this._isCustomShift = isCustom;

        const panel = document.getElementById('custom-shift-panel');
        if (panel) {
            panel.style.display = isCustom ? 'block' : 'none';
        }

        document.querySelectorAll('.shift-card-option').forEach(card => {
            card.classList.remove('active');
        });

        // Re-render so template selection highlights cleanly
        this.render();
    },

    toggleZone(zoneId, isChecked, inputEl) {
        if (isChecked) {
            this._selectedZoneIds.add(zoneId);
        } else {
            this._selectedZoneIds.delete(zoneId);
        }
        if (inputEl && inputEl.closest('.station-zone-item')) {
            inputEl.closest('.station-zone-item').classList.toggle('selected', isChecked);
        }
        const badge = document.getElementById('selected-zones-count-badge');
        if (badge) {
            badge.textContent = `${this._selectedZoneIds.size} ایستگاه انتخاب شده`;
        }
    },

    async quickAddSection() {
        const name = prompt(I18n.t('section_name_prompt') || 'نام بخش جدید را وارد نمایید (مثال: بسته‌بندی، انبار، خط مونتاژ):');
        if (!name || !name.trim()) return;

        try {
            const newSec = await App.api('/api/sections', 'POST', { name: name.trim(), description: '' });
            this._sections.push(newSec);
            App.toast(`بخش '${newSec.name}' با موفقیت اضافه شد.`, 'success');

            const selectEl = document.getElementById('person-shift-section');
            if (selectEl) {
                const opt = document.createElement('option');
                opt.value = newSec.name;
                opt.textContent = newSec.name;
                opt.selected = true;
                selectEl.appendChild(opt);
            }
        } catch (err) {
            App.toast(`خطا در ایجاد بخش: ${err.message}`, 'error');
        }
    },

    async save(e) {
        e.preventDefault();
        const saveBtn = document.getElementById('save-shift-btn');
        if (saveBtn) saveBtn.disabled = true;

        const sectionVal = (document.getElementById('person-shift-section')?.value || '').trim();

        let customShiftPayload = null;
        if (this._isCustomShift) {
            if (this._customSubtype === 'rotational') {
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
                const startVal = document.getElementById('custom-shift-start')?.value || '08:00';
                const endVal = document.getElementById('custom-shift-end')?.value || '17:00';
                const graceVal = parseInt(document.getElementById('custom-shift-grace')?.value || '10', 10);
                const absenceVal = parseInt(document.getElementById('custom-shift-absence')?.value || '2', 10);

                const selectedDays = [];
                document.querySelectorAll('.shift-day-cb:checked').forEach(cb => {
                    selectedDays.push(cb.value);
                });

                customShiftPayload = {
                    shift_type: 'fixed',
                    name: 'شیفت سفارشی ثابت',
                    start_time: startVal,
                    end_time: endVal,
                    active_days: selectedDays.length > 0 ? selectedDays : ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
                    grace_period_minutes: isNaN(graceVal) ? 10 : graceVal,
                    absence_timeout_minutes: isNaN(absenceVal) ? 2 : absenceVal,
                };
            }
        }

        const payload = {
            section: sectionVal,
            shift_template_id: this._isCustomShift ? null : (this._selectedTemplateId || 0),
            custom_shift: customShiftPayload,
            assigned_zone_ids: Array.from(this._selectedZoneIds),
        };

        try {
            await App.api(`/api/persons/${this._personId}/shift`, 'PUT', payload);
            App.toast(I18n.t('shift_saved_toast') || 'شیفت و ایستگاه کاری با موفقیت به‌روزرسانی شد.', 'success');
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
        } catch (err) {
            console.error('Failed to save shift config:', err);
            App.toast(`خطا در ذخیره شیفت: ${err.message}`, 'error');
            if (saveBtn) saveBtn.disabled = false;
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
};
