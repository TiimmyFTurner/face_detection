/**
 * ZoneModal Component — Interactive visual zone drawer, shift timetable, break times, and person attachment manager.
 */
const ZoneModal = {
    _camera: null,
    _zones: [],
    _persons: [],
    _isDrawing: false,
    _startX: 0,
    _startY: 0,
    _currentBox: null, // { x, y, width, height } in %
    _editingZoneId: null, // null when creating new, number when editing
    _selectedPersonIds: new Set(),
    _freeTimes: [],
    _personSearchQuery: '',

    /**
     * Open the zone management modal for a specific camera.
     * Optionally jump straight into editing a specific zoneId.
     */
    async show(cameraId, targetZoneId = null) {
        // Robust camera resolution
        let camera = (typeof CamerasPage !== 'undefined' && CamerasPage._cameras)
            ? CamerasPage._cameras.find(c => c.id === cameraId)
            : null;
        if (!camera && typeof ZonesPage !== 'undefined' && ZonesPage._cameras) {
            camera = ZonesPage._cameras.find(c => c.id === cameraId);
        }
        if (!camera) {
            try {
                const cams = await App.api('/api/cameras');
                camera = cams.find(c => c.id === cameraId);
            } catch (e) {}
        }

        if (!camera) {
            App.toast(I18n.t('err_failed_load', { msg: 'Camera not found' }), 'error');
            return;
        }

        ZoneModal._camera = camera;
        ZoneModal._currentBox = { x: 20, y: 20, width: 40, height: 40 }; // Default box
        ZoneModal._editingZoneId = null;
        ZoneModal._selectedPersonIds = new Set();
        ZoneModal._freeTimes = [];
        ZoneModal._personSearchQuery = '';

        App.toast(I18n.t('loading'), 'info');

        try {
            const [zones, persons] = await Promise.all([
                App.api(`/api/cameras/${camera.id}/zones`),
                App.api('/api/persons'),
                typeof BreakPresets !== 'undefined' ? BreakPresets.load() : Promise.resolve(),
            ]);

            ZoneModal._zones = zones || [];
            ZoneModal._persons = persons || [];

            // If a target zone was requested, pre-populate into edit mode
            if (targetZoneId) {
                const targetZone = ZoneModal._zones.find(z => z.id === targetZoneId);
                if (targetZone) {
                    ZoneModal._editingZoneId = targetZone.id;
                    ZoneModal._currentBox = {
                        x: targetZone.x,
                        y: targetZone.y,
                        width: targetZone.width,
                        height: targetZone.height,
                    };
                    ZoneModal._selectedPersonIds = new Set(targetZone.assigned_person_ids || []);
                    ZoneModal._freeTimes = Array.isArray(targetZone.free_times)
                        ? JSON.parse(JSON.stringify(targetZone.free_times))
                        : [];
                }
            }

            ZoneModal.renderModal();
        } catch (err) {
            App.toast(I18n.t('err_failed_load', { msg: err.message }), 'error');
        }
    },

    /**
     * Render the Zone modal HTML.
     */
    renderModal() {
        const camera = ZoneModal._camera;
        const snapshotUrl = `/api/cameras/${camera.id}/snapshot?t=${Date.now()}`;

        const weekdays = I18n.isRTL() ? [
            { key: 'Sat', label: 'شنبه' },
            { key: 'Sun', label: 'یکشنبه' },
            { key: 'Mon', label: 'دوشنبه' },
            { key: 'Tue', label: 'سه‌شنبه' },
            { key: 'Wed', label: 'چهارشنبه' },
            { key: 'Thu', label: 'پنج‌شنبه' },
            { key: 'Fri', label: 'جمعه' },
        ] : [
            { key: 'Mon', label: 'Mon' },
            { key: 'Tue', label: 'Tue' },
            { key: 'Wed', label: 'Wed' },
            { key: 'Thu', label: 'Thu' },
            { key: 'Fri', label: 'Fri' },
            { key: 'Sat', label: 'Sat' },
            { key: 'Sun', label: 'Sun' },
        ];

        const editingZone = ZoneModal._editingZoneId
            ? ZoneModal._zones.find(z => z.id === ZoneModal._editingZoneId)
            : null;

        const defaultCheckedDays = editingZone
            ? (editingZone.active_days || [])
            : (I18n.isRTL() ? ['Sat', 'Sun', 'Mon', 'Tue', 'Wed'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

        const isEditing = !!editingZone;
        const formTitle = isEditing
            ? I18n.t('zone_edit_title', { name: ZoneModal.escapeHtml(editingZone.name) })
            : I18n.t('zone_add_title');

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">${I18n.t('zone_modal_title', { name: ZoneModal.escapeHtml(camera.name) })}</h2>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem; max-height: 82vh; overflow-y: auto;">
                <div style="color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 0.85rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                    <span>${I18n.t('zone_canvas_hint')}</span>
                    <button class="btn btn-secondary btn-sm" onclick="ZoneModal.refreshSnapshot()">${I18n.t('refresh_snapshot')}</button>
                </div>

                <!-- Interactive Snapshot & Canvas Drawing Container -->
                <div id="zone-canvas-container" class="zone-canvas-wrapper" style="position: relative; width: 100%; max-height: 480px; min-height: 280px; background: #090d16; border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--border-subtle); user-select: none; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 24px rgba(0,0,0,0.6);">
                    <img id="zone-snapshot-img" src="${snapshotUrl}" alt="${ZoneModal.escapeAttr(camera.name)}" style="width: 100%; height: 100%; max-height: 480px; object-fit: contain; display: block;" />
                    
                    <!-- Overlay SVG / Boxes -->
                    <div id="zone-overlay-layer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: crosshair;">
                        <!-- Existing zones rendered here -->
                        ${ZoneModal.renderZoneOverlays()}
                        <!-- Dynamic active drawing box -->
                        <div id="active-draw-box" style="position: absolute; display: ${ZoneModal._currentBox ? 'block' : 'none'}; left: ${ZoneModal._currentBox ? ZoneModal._currentBox.x : 0}%; top: ${ZoneModal._currentBox ? ZoneModal._currentBox.y : 0}%; width: ${ZoneModal._currentBox ? ZoneModal._currentBox.width : 0}%; height: ${ZoneModal._currentBox ? ZoneModal._currentBox.height : 0}%; border: 2px dashed ${isEditing ? 'var(--accent-amber)' : 'var(--accent-blue)'}; background: ${isEditing ? 'rgba(245, 158, 11, 0.25)' : 'rgba(59, 130, 246, 0.25)'}; border-radius: 4px; pointer-events: none;"></div>
                    </div>
                </div>

                <div class="zone-editor-grid" style="display: grid; grid-template-columns: 1.15fr 1fr; gap: 1.5rem; align-items: start;">
                    <!-- Area Form Panel -->
                    <div id="zone-form-panel" class="zone-form-panel" style="background: var(--bg-surface-hover); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid ${isEditing ? 'rgba(245, 158, 11, 0.4)' : 'var(--border-subtle)'}; box-shadow: ${isEditing ? '0 0 16px rgba(245, 158, 11, 0.1)' : 'none'};">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.6rem;">
                            <h4 id="zone-form-title" style="margin: 0; font-size: 1rem; font-weight: 700; color: ${isEditing ? 'var(--accent-amber)' : 'var(--text-primary)'}; display: flex; align-items: center; gap: 0.4rem;">
                                <span>${isEditing ? '✏️' : '➕'}</span> <span>${formTitle}</span>
                            </h4>
                            ${isEditing ? `
                                <button class="btn btn-secondary btn-sm" onclick="ZoneModal.cancelEdit()" style="font-size: 0.72rem; padding: 2px 8px;">
                                    ${I18n.t('btn_cancel_edit')}
                                </button>
                            ` : ''}
                        </div>
                        
                        <!-- Zone Name -->
                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label" style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">${I18n.t('label_zone_name')}</label>
                            <input type="text" id="zone-name-input" class="form-input" placeholder="${ZoneModal.escapeAttr(I18n.t('placeholder_zone_name'))}" value="${isEditing ? ZoneModal.escapeAttr(editingZone.name) : ''}" required style="padding: 0.6rem 0.85rem;" />
                        </div>

                        <!-- Attach Persons with Live Search Filter -->
                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                                <label class="form-label" style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">${I18n.t('label_attach_persons')}</label>
                                <span id="zone-selected-count-badge" style="font-size: 0.7rem; font-weight: 700; color: var(--accent-blue); background: rgba(59, 130, 246, 0.15); padding: 2px 6px; border-radius: var(--radius-sm);">
                                    ${I18n.t('selected_persons_count', { count: I18n.isRTL() ? I18n.toPersianDigits(ZoneModal._selectedPersonIds.size) : ZoneModal._selectedPersonIds.size })}
                                </span>
                            </div>

                            <!-- Search Input with Clear Button -->
                            <div style="position: relative; margin-bottom: 0.4rem;">
                                <input type="text" id="zone-person-search-input" class="form-input" placeholder="${ZoneModal.escapeAttr(I18n.t('search_persons_placeholder'))}" value="${ZoneModal.escapeAttr(ZoneModal._personSearchQuery)}" oninput="ZoneModal.filterPersons(this.value)" style="padding: 0.48rem 2rem 0.48rem 0.85rem; font-size: 0.82rem; width: 100%;" />
                                <span id="zone-person-search-clear" onclick="ZoneModal.clearSearchInput()" style="position: absolute; ${I18n.isRTL() ? 'left: 10px;' : 'right: 10px;'} top: 50%; transform: translateY(-50%); cursor: pointer; color: var(--text-tertiary); font-size: 0.85rem; padding: 2px 4px; display: ${(ZoneModal._personSearchQuery || '').trim() ? 'inline' : 'none'};" title="${ZoneModal.escapeAttr(I18n.t('clear') || 'Clear')}">✕</span>
                            </div>

                            <!-- Quick Action Bar -->
                            <div id="zone-person-search-actions">
                                ${ZoneModal.renderPersonSearchActionsHtml()}
                            </div>

                            <!-- Selected Person Chips Preview -->
                            <div id="zone-selected-chips-container" style="display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.45rem;">
                                ${ZoneModal.renderSelectedChipsHtml()}
                            </div>

                            <!-- Filtered Persons Checkbox List -->
                            <div id="zone-persons-picker" style="max-height: 150px; overflow-y: auto; background: var(--bg-surface); padding: 0.6rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.35rem;">
                                ${ZoneModal.renderPersonsListHtml()}
                            </div>
                        </div>

                        <!-- Alert Policy -->
                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label" style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">${I18n.t('label_alert_policy')}</label>
                            <select id="zone-alert-mode" class="form-input" style="font-size: 0.85rem; padding: 0.55rem 0.85rem;">
                                <option value="absence" ${isEditing && editingZone.alert_mode === 'absence' ? 'selected' : ''}>${I18n.t('policy_absence')}</option>
                                <option value="unauthorized" ${isEditing && editingZone.alert_mode === 'unauthorized' ? 'selected' : ''}>${I18n.t('policy_unauthorized')}</option>
                                <option value="both" ${isEditing && editingZone.alert_mode === 'both' ? 'selected' : ''}>${I18n.t('policy_both')}</option>
                            </select>
                        </div>

                        <!-- Shift Template Selector -->
                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label" style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
                                ${I18n.t('label_shift_template')}
                            </label>
                            <select id="zone-shift-template" class="form-input" style="font-size: 0.82rem; padding: 0.45rem 0.75rem;" onchange="ZoneModal.onSelectShiftTemplate(this.value)">
                                <option value="">${I18n.t('select_shift_template_placeholder')}</option>
                                <option value="morning">${I18n.t('template_morning')}</option>
                                <option value="evening">${I18n.t('template_evening')}</option>
                                <option value="night">${I18n.t('template_night')}</option>
                                <option value="office">${I18n.t('template_office')}</option>
                            </select>
                        </div>

                        <!-- Timers Row: Absence Timeout & Arrival Grace Period -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.85rem;">
                            <div class="form-group" style="margin: 0;">
                                <label class="form-label" style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
                                    ${I18n.t('label_absence_timer')}
                                </label>
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <input type="number" id="zone-absence-timeout" class="form-input" min="1" max="120" value="${isEditing ? (editingZone.absence_timeout_minutes || 2) : 2}" style="padding: 0.45rem 0.6rem; font-size: 0.85rem; width: 75px;" />
                                    <span style="font-size: 0.72rem; color: var(--text-secondary);">${I18n.isRTL() ? 'دقیقه آژیر' : 'min alarm'}</span>
                                </div>
                            </div>
                            <div class="form-group" style="margin: 0;">
                                <label class="form-label" style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
                                    ${I18n.t('label_grace_period')}
                                </label>
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <input type="number" id="zone-grace-period" class="form-input" min="0" max="120" value="${isEditing ? (editingZone.grace_period_minutes !== undefined ? editingZone.grace_period_minutes : 10) : 10}" style="padding: 0.45rem 0.6rem; font-size: 0.85rem; width: 75px;" />
                                    <span style="font-size: 0.72rem; color: var(--text-secondary);">${I18n.isRTL() ? 'دقیقه مهلت' : 'min grace'}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Shift Timetable & Active Days -->
                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label" style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">${I18n.t('label_shift_schedule')}</label>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.4rem;">
                                <div>
                                    <span style="font-size: 0.7rem; color: var(--text-tertiary); display: block; margin-bottom: 0.2rem;">${I18n.t('label_start_time')}</span>
                                    <input type="time" id="zone-start-time" class="form-input" onchange="ZoneModal.checkOvernightShift()" value="${isEditing ? (editingZone.start_time || '08:00') : '08:00'}" style="padding: 0.5rem 0.75rem; font-size: 0.85rem;" />
                                </div>
                                <div>
                                    <span style="font-size: 0.7rem; color: var(--text-tertiary); display: block; margin-bottom: 0.2rem;">${I18n.t('label_end_time')}</span>
                                    <input type="time" id="zone-end-time" class="form-input" onchange="ZoneModal.checkOvernightShift()" value="${isEditing ? (editingZone.end_time || '17:00') : '17:00'}" style="padding: 0.5rem 0.75rem; font-size: 0.85rem;" />
                                </div>
                            </div>
                            <!-- Overnight Shift Banner -->
                            <div id="zone-overnight-banner" style="display: none; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.35); color: #c084fc; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.74rem; margin-bottom: 0.5rem; align-items: center; gap: 6px;">
                                ${I18n.t('overnight_shift_banner')}
                            </div>
                            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.35rem;" id="zone-days-picker">
                                ${weekdays.map(item => `
                                    <label style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.3rem; cursor: pointer; background: var(--bg-surface); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                        <input type="checkbox" name="zone-day" value="${item.key}" ${defaultCheckedDays.includes(item.key) ? 'checked' : ''} />
                                        <span>${item.label}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Free Times & Breaks (Lunch, Rest, etc.) -->
                        <div class="form-group" style="margin-bottom: 1.1rem; background: var(--bg-surface); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                                <label class="form-label" style="font-size: 0.75rem; font-weight: 700; color: var(--text-primary); margin: 0;">${I18n.t('label_free_times')}</label>
                            </div>
                            <div style="font-size: 0.7rem; color: var(--text-tertiary); margin-bottom: 0.5rem;">${I18n.t('free_times_hint')}</div>

                            <!-- Existing Free Times Pills List -->
                            <div id="zone-free-times-list" style="display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.6rem;">
                                ${ZoneModal.renderFreeTimesListHtml()}
                            </div>

                            <!-- Add New Free Time Form Row -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.4rem; align-items: center;">
                                <input type="text" id="free-time-name" class="form-input" placeholder="${ZoneModal.escapeAttr(I18n.t('free_time_name_placeholder'))}" style="padding: 0.4rem 0.6rem; font-size: 0.78rem;" />
                                <input type="time" id="free-time-start" class="form-input" value="12:00" style="padding: 0.4rem 0.5rem; font-size: 0.78rem;" />
                                <input type="time" id="free-time-end" class="form-input" value="13:00" style="padding: 0.4rem 0.5rem; font-size: 0.78rem;" />
                                <button type="button" class="btn btn-secondary btn-sm" onclick="ZoneModal.addFreeTimeFromInputs()" style="padding: 0.4rem 0.7rem; font-size: 0.75rem;">
                                    ${I18n.t('add_free_time_btn')}
                                </button>
                            </div>

                            <!-- Dynamic Presets Bar -->
                            <div id="zone-break-presets-bar" style="margin-top: 0.6rem;">
                                ${typeof BreakPresets !== 'undefined' ? BreakPresets.renderBarHtml({
                                    containerId: 'zone-break-presets-bar',
                                    inputPrefix: 'free-time',
                                    onSelectPresetCall: 'ZoneModal.applyBreakPreset',
                                    refreshCall: 'ZoneModal.renderFreeTimesListHtml',
                                }) : ''}
                            </div>
                        </div>

                        <!-- Submit Button -->
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-primary" onclick="ZoneModal.saveZone()" style="flex: 1; justify-content: center; padding: 0.65rem 1rem; font-weight: 700; font-size: 0.9rem;">
                                ${isEditing ? I18n.t('btn_update_zone') : I18n.t('btn_save_zone')}
                            </button>
                            ${isEditing ? `
                                <button class="btn btn-secondary" onclick="ZoneModal.cancelEdit()" style="padding: 0.65rem 1rem;">
                                    ${I18n.t('btn_cancel_edit')}
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Configured Zones List Panel -->
                    <div class="zone-list-panel" style="background: var(--bg-surface-hover); padding: 1.25rem; border-radius: var(--radius-lg); border: 1px solid var(--border-subtle);">
                        <h4 style="margin-top: 0; margin-bottom: 0.9rem; font-size: 1rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                            <span>🎯</span> <span>${I18n.t('active_zones_count', { count: I18n.isRTL() ? I18n.toPersianDigits(ZoneModal._zones.length) : ZoneModal._zones.length })}</span>
                        </h4>
                        
                        <div id="active-zones-list" style="display: flex; flex-direction: column; gap: 0.75rem; max-height: 480px; overflow-y: auto; padding-inline-end: 2px;">
                            ${ZoneModal.renderZonesList()}
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal-footer" style="display: flex; justify-content: flex-end; padding: 1.1rem 1.5rem;">
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('close')}</button>
            </div>
        `;

        App.openModal(content, 'modal-zones modal-xl');
        ZoneModal.initDrawingEvents();
        ZoneModal.checkOvernightShift();
    },

    /**
     * Render colored visual overlay boxes for existing zones on the snapshot.
     */
    renderZoneOverlays() {
        if (!ZoneModal._zones || ZoneModal._zones.length === 0) return '';

        return ZoneModal._zones.map((zone, idx) => {
            const isBeingEdited = ZoneModal._editingZoneId === zone.id;
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
            const color = isBeingEdited ? '#f59e0b' : colors[idx % colors.length];

            return `
                <div class="zone-box-overlay ${isBeingEdited ? 'editing' : ''}" style="position: absolute; left: ${zone.x}%; top: ${zone.y}%; width: ${zone.width}%; height: ${zone.height}%; border: ${isBeingEdited ? '3px dashed #f59e0b' : `2px solid ${color}`}; background: ${color}22; border-radius: 4px; pointer-events: none; box-shadow: ${isBeingEdited ? '0 0 14px rgba(245, 158, 11, 0.5)' : 'none'};">
                    <span style="position: absolute; top: -20px; left: 0; background: ${color}; color: #fff; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 3px; white-space: nowrap;">
                        ${isBeingEdited ? '✏️ ' : ''}${ZoneModal.escapeHtml(zone.name)}
                    </span>
                </div>
            `;
        }).join('');
    },

    /**
     * Render the active zones list with edit and delete buttons.
     */
    renderZonesList() {
        if (ZoneModal._zones.length === 0) {
            return `<div style="font-size: 0.8rem; color: var(--text-tertiary); text-align: center; padding: 1rem;">${I18n.t('no_camera_zones')}</div>`;
        }

        return ZoneModal._zones.map(zone => {
            const isEditing = ZoneModal._editingZoneId === zone.id;
            const assignedNames = (zone.assigned_person_ids || []).map(pid => {
                const person = ZoneModal._persons.find(p => p.id === pid);
                return person ? person.name : `ID:${pid}`;
            });

            const policyLabel = zone.alert_mode === 'absence'
                ? I18n.t('policy_absence')
                : zone.alert_mode === 'unauthorized'
                    ? I18n.t('policy_unauthorized')
                    : I18n.t('policy_both');

            const timeoutMins = zone.absence_timeout_minutes || 2;
            const freeTimesList = Array.isArray(zone.free_times) ? zone.free_times : [];

            return `
                <div class="zone-item-card" style="background: var(--bg-surface); padding: 0.9rem 1.1rem; border-radius: var(--radius-md); border: 1px solid ${isEditing ? 'var(--accent-amber)' : 'var(--border-subtle)'}; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; box-shadow: ${isEditing ? '0 0 10px rgba(245, 158, 11, 0.2)' : 'none'};">
                    <div style="flex: 1;">
                        <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.35rem; flex-wrap: wrap;">
                            <span>🎯</span>
                            <span>${ZoneModal.escapeHtml(zone.name)}</span>
                            <span style="font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: var(--radius-full); background: rgba(59, 130, 246, 0.15); color: var(--accent-blue); border: 1px solid rgba(59, 130, 246, 0.3);">
                                ${policyLabel}
                            </span>
                            <span style="font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: var(--radius-full); background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);">
                                ⏱️ ${timeoutMins}m
                            </span>
                        </div>

                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.25rem;">
                            👤 ${I18n.t('assigned_staff')} <strong>${assignedNames.length > 0 ? ZoneModal.escapeHtml(assignedNames.join(', ')) : I18n.t('none')}</strong>
                        </div>

                        <div style="font-size: 0.74rem; color: var(--text-tertiary); display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.25rem;">
                            <span>🕐</span>
                            <span>${zone.start_time || '00:00'} - ${zone.end_time || '23:59'} (${(zone.active_days || []).join(', ')})</span>
                        </div>

                        ${freeTimesList.length > 0 ? `
                            <div style="display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.35rem;">
                                ${freeTimesList.map(ft => `
                                    <span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.68rem; color: var(--accent-cyan); background: rgba(6, 182, 212, 0.12); border: 1px solid rgba(6, 182, 212, 0.3); padding: 1px 6px; border-radius: var(--radius-sm);">
                                        ☕ ${ZoneModal.escapeHtml(ft.name || 'Break')}: ${ft.start_time}-${ft.end_time}
                                    </span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <div style="display: flex; gap: 0.35rem; align-self: flex-start;">
                        <button class="btn btn-secondary btn-sm" onclick="ZoneModal.editZone(${zone.id})" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;" title="${ZoneModal.escapeAttr(I18n.t('edit'))}">
                            ✏️
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="ZoneModal.deleteZone(${zone.id})" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;" title="${ZoneModal.escapeAttr(I18n.t('delete'))}">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Switch form into edit mode for an existing zone.
     */
    editZone(zoneId) {
        const zone = ZoneModal._zones.find(z => z.id === zoneId);
        if (!zone) return;

        ZoneModal._editingZoneId = zone.id;
        ZoneModal._currentBox = {
            x: zone.x,
            y: zone.y,
            width: zone.width,
            height: zone.height,
        };
        ZoneModal._selectedPersonIds = new Set(zone.assigned_person_ids || []);
        ZoneModal._freeTimes = Array.isArray(zone.free_times)
            ? JSON.parse(JSON.stringify(zone.free_times))
            : [];
        ZoneModal._personSearchQuery = '';

        // Re-render modal to display edit mode
        ZoneModal.renderModal();

        // Scroll form panel into view
        const formPanel = document.getElementById('zone-form-panel');
        if (formPanel) {
            formPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    /**
     * Cancel edit mode and reset to new zone form.
     */
    cancelEdit() {
        ZoneModal._editingZoneId = null;
        ZoneModal._currentBox = { x: 20, y: 20, width: 40, height: 40 };
        ZoneModal._selectedPersonIds = new Set();
        ZoneModal._freeTimes = [];
        ZoneModal._personSearchQuery = '';
        ZoneModal.renderModal();
    },

    /**
     * Render quick action bar for person search.
     */
    renderPersonSearchActionsHtml() {
        const q = (ZoneModal._personSearchQuery || '').trim().toLowerCase();
        const hasQuery = q.length > 0;
        const hasSelection = ZoneModal._selectedPersonIds.size > 0;

        let matchCount = 0;
        if (hasQuery) {
            matchCount = ZoneModal._persons.filter(p => {
                const name = (p.name || '').toLowerCase();
                const role = (p.role || '').toLowerCase();
                return name.includes(q) || role.includes(q);
            }).length;
        }

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; font-size: 0.72rem; min-height: 22px;">
                <div style="display: flex; gap: 0.4rem; align-items: center;">
                    ${hasQuery && matchCount > 0 ? `
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ZoneModal.selectAllFiltered()" style="font-size: 0.68rem; padding: 2px 7px;">
                            ${I18n.t('select_all_filtered')} (${I18n.isRTL() ? I18n.toPersianDigits(matchCount) : matchCount})
                        </button>
                    ` : ''}
                    ${hasSelection ? `
                        <button type="button" class="btn btn-secondary btn-sm" onclick="ZoneModal.clearPersonSelection()" style="font-size: 0.68rem; padding: 2px 7px; color: var(--accent-rose);">
                            ${I18n.t('clear_selection')}
                        </button>
                    ` : ''}
                </div>
                ${hasQuery ? `
                    <span style="font-size: 0.7rem; color: var(--text-tertiary);">
                        ${I18n.t('search_results_active')}: <strong>${I18n.isRTL() ? I18n.toPersianDigits(matchCount) : matchCount}</strong>
                    </span>
                ` : ''}
            </div>
        `;
    },

    /**
     * Render the filtered persons search results.
     * When no search query is typed, displays a search prompt instead of listing all persons.
     */
    renderPersonsListHtml() {
        const q = (ZoneModal._personSearchQuery || '').trim().toLowerCase();

        // If no search query, do NOT show all persons - guide the user to search
        if (!q) {
            return `
                <div style="font-size: 0.78rem; color: var(--text-tertiary); grid-column: 1 / -1; padding: 1.1rem 0.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.35rem;">
                    <span style="font-size: 1.3rem; opacity: 0.6;">🔍</span>
                    <span>${I18n.t('search_persons_prompt')}</span>
                </div>
            `;
        }

        const filtered = ZoneModal._persons.filter(p => {
            const name = (p.name || '').toLowerCase();
            const role = (p.role || '').toLowerCase();
            return name.includes(q) || role.includes(q);
        });

        if (filtered.length === 0) {
            return `
                <div style="font-size: 0.78rem; color: var(--text-tertiary); grid-column: 1 / -1; padding: 1rem 0.5rem; text-align: center;">
                    ${I18n.t('no_matched_persons')}
                </div>
            `;
        }

        return filtered.map(p => {
            const isChecked = ZoneModal._selectedPersonIds.has(p.id);
            return `
                <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-primary); cursor: pointer; background: ${isChecked ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-surface-hover)'}; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid ${isChecked ? 'rgba(59, 130, 246, 0.4)' : 'var(--border-subtle)'}; transition: all 0.15s ease;">
                    <input type="checkbox" value="${p.id}" ${isChecked ? 'checked' : ''} onchange="ZoneModal.togglePerson(${p.id}, this.checked)" />
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        👤 <strong>${ZoneModal.escapeHtml(p.name)}</strong>
                        <span style="font-size: 0.68rem; color: var(--text-tertiary);">(${ZoneModal.escapeHtml(p.role || I18n.t('known_identity'))})</span>
                    </span>
                </label>
            `;
        }).join('');
    },

    /**
     * Render chips for selected persons.
     */
    renderSelectedChipsHtml() {
        if (ZoneModal._selectedPersonIds.size === 0) return '';

        return Array.from(ZoneModal._selectedPersonIds).map(pid => {
            const person = ZoneModal._persons.find(p => p.id === pid);
            const name = person ? person.name : `ID:${pid}`;
            return `
                <span style="display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; background: rgba(59, 130, 246, 0.2); color: var(--text-primary); border: 1px solid rgba(59, 130, 246, 0.4); padding: 2px 7px; border-radius: var(--radius-full);">
                    <span>👤 ${ZoneModal.escapeHtml(name)}</span>
                    <button type="button" onclick="ZoneModal.togglePerson(${pid}, false)" style="background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 0.75rem; padding: 0 2px; line-height: 1;">✕</button>
                </span>
            `;
        }).join('');
    },

    /**
     * Handle person search input filter.
     */
    filterPersons(query) {
        ZoneModal._personSearchQuery = query;

        // Update clear button visibility
        const clearBtn = document.getElementById('zone-person-search-clear');
        if (clearBtn) {
            clearBtn.style.display = (query || '').trim() ? 'inline' : 'none';
        }

        // Update action bar
        const actionsContainer = document.getElementById('zone-person-search-actions');
        if (actionsContainer) {
            actionsContainer.innerHTML = ZoneModal.renderPersonSearchActionsHtml();
        }

        // Update results list
        const picker = document.getElementById('zone-persons-picker');
        if (picker) {
            picker.innerHTML = ZoneModal.renderPersonsListHtml();
        }
    },

    /**
     * Clear the search input and reset search results.
     */
    clearSearchInput() {
        const input = document.getElementById('zone-person-search-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        ZoneModal.filterPersons('');
    },

    /**
     * Toggle single person selection.
     */
    togglePerson(personId, isChecked) {
        if (isChecked) {
            ZoneModal._selectedPersonIds.add(personId);
        } else {
            ZoneModal._selectedPersonIds.delete(personId);
        }

        // Update badge count
        const badge = document.getElementById('zone-selected-count-badge');
        if (badge) {
            const count = I18n.isRTL() ? I18n.toPersianDigits(ZoneModal._selectedPersonIds.size) : ZoneModal._selectedPersonIds.size;
            badge.textContent = I18n.t('selected_persons_count', { count });
        }

        // Update chips
        const chipsContainer = document.getElementById('zone-selected-chips-container');
        if (chipsContainer) {
            chipsContainer.innerHTML = ZoneModal.renderSelectedChipsHtml();
        }

        // Update action bar (clear selection button status)
        const actionsContainer = document.getElementById('zone-person-search-actions');
        if (actionsContainer) {
            actionsContainer.innerHTML = ZoneModal.renderPersonSearchActionsHtml();
        }

        // Update picker checkbox states
        const picker = document.getElementById('zone-persons-picker');
        if (picker) {
            picker.innerHTML = ZoneModal.renderPersonsListHtml();
        }
    },

    /**
     * Select all persons currently matching search filter.
     */
    selectAllFiltered() {
        const q = (ZoneModal._personSearchQuery || '').trim().toLowerCase();
        if (!q) return;

        const filtered = ZoneModal._persons.filter(p => {
            const name = (p.name || '').toLowerCase();
            const role = (p.role || '').toLowerCase();
            return name.includes(q) || role.includes(q);
        });

        filtered.forEach(p => ZoneModal._selectedPersonIds.add(p.id));

        const badge = document.getElementById('zone-selected-count-badge');
        if (badge) {
            const count = I18n.isRTL() ? I18n.toPersianDigits(ZoneModal._selectedPersonIds.size) : ZoneModal._selectedPersonIds.size;
            badge.textContent = I18n.t('selected_persons_count', { count });
        }
        const chipsContainer = document.getElementById('zone-selected-chips-container');
        if (chipsContainer) chipsContainer.innerHTML = ZoneModal.renderSelectedChipsHtml();

        const actionsContainer = document.getElementById('zone-person-search-actions');
        if (actionsContainer) actionsContainer.innerHTML = ZoneModal.renderPersonSearchActionsHtml();

        const picker = document.getElementById('zone-persons-picker');
        if (picker) picker.innerHTML = ZoneModal.renderPersonsListHtml();
    },

    /**
     * Clear all selected persons.
     */
    clearPersonSelection() {
        ZoneModal._selectedPersonIds.clear();

        const badge = document.getElementById('zone-selected-count-badge');
        if (badge) {
            const count = I18n.isRTL() ? I18n.toPersianDigits(0) : 0;
            badge.textContent = I18n.t('selected_persons_count', { count });
        }
        const chipsContainer = document.getElementById('zone-selected-chips-container');
        if (chipsContainer) chipsContainer.innerHTML = '';

        const actionsContainer = document.getElementById('zone-person-search-actions');
        if (actionsContainer) actionsContainer.innerHTML = ZoneModal.renderPersonSearchActionsHtml();

        const picker = document.getElementById('zone-persons-picker');
        if (picker) picker.innerHTML = ZoneModal.renderPersonsListHtml();
    },

    /**
     * Render the list of free times (lunch, rest, etc.).
     */
    renderFreeTimesListHtml() {
        if (!ZoneModal._freeTimes || ZoneModal._freeTimes.length === 0) {
            return `<div style="font-size: 0.72rem; color: var(--text-tertiary); font-style: italic;">${I18n.t('no_free_times_hint')}</div>`;
        }

        return ZoneModal._freeTimes.map((ft, idx) => `
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface-hover); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); font-size: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <span>☕</span>
                    <strong style="color: var(--text-primary);">${ZoneModal.escapeHtml(ft.name || 'Break')}</strong>
                    <span style="color: var(--accent-blue); font-weight: 600;">(${ft.start_time} - ${ft.end_time})</span>
                </div>
                <button type="button" onclick="ZoneModal.removeFreeTime(${idx})" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 0.8rem; padding: 2px 4px;">
                    ✕
                </button>
            </div>
        `).join('');
    },

    /**
     * Add free time from the input fields in the modal.
     */
    addFreeTimeFromInputs() {
        const nameInput = document.getElementById('free-time-name');
        const startInput = document.getElementById('free-time-start');
        const endInput = document.getElementById('free-time-end');

        const name = (nameInput ? nameInput.value : '').trim() || (I18n.isRTL() ? 'استراحت' : 'Break');
        const startTime = (startInput ? startInput.value : '').trim() || '12:00';
        const endTime = (endInput ? endInput.value : '').trim() || '13:00';

        ZoneModal._freeTimes.push({
            name,
            start_time: startTime,
            end_time: endTime,
        });

        if (nameInput) nameInput.value = '';

        const container = document.getElementById('zone-free-times-list');
        if (container) {
            container.innerHTML = ZoneModal.renderFreeTimesListHtml();
        }
    },

    /**
     * Apply preset free time (lunch, rest, prayer, custom).
     */
    applyBreakPreset(name, startTime, endTime) {
        if (!ZoneModal._freeTimes) ZoneModal._freeTimes = [];
        const exists = ZoneModal._freeTimes.some(
            ft => ft.start_time === startTime && ft.end_time === endTime && ft.name === name
        );
        if (!exists) {
            ZoneModal._freeTimes.push({
                name: name || (I18n.isRTL() ? 'استراحت' : 'Break'),
                start_time: startTime || '12:00',
                end_time: endTime || '13:00',
            });
        }
        const container = document.getElementById('zone-free-times-list');
        if (container) {
            container.innerHTML = ZoneModal.renderFreeTimesListHtml();
        }
    },

    /**
     * Add preset free time (lunch or rest, legacy).
     */
    addPresetFreeTime(type) {
        if (type === 'lunch') {
            this.applyBreakPreset(I18n.isRTL() ? 'ناهار' : 'Lunch', '12:00', '13:00');
        } else if (type === 'rest') {
            this.applyBreakPreset(I18n.isRTL() ? 'استراحت' : 'Rest', '16:00', '16:30');
        }
    },

    /**
     * Remove a free time interval by index.
     */
    removeFreeTime(idx) {
        ZoneModal._freeTimes.splice(idx, 1);
        const container = document.getElementById('zone-free-times-list');
        if (container) {
            container.innerHTML = ZoneModal.renderFreeTimesListHtml();
        }
    },

    /**
     * Initialize mouse drawing events on the snapshot overlay.
     */
    initDrawingEvents() {
        const overlay = document.getElementById('zone-overlay-layer');
        const drawBox = document.getElementById('active-draw-box');
        if (!overlay || !drawBox) return;

        overlay.onmousedown = (e) => {
            const rect = overlay.getBoundingClientRect();
            ZoneModal._isDrawing = true;
            ZoneModal._startX = ((e.clientX - rect.left) / rect.width) * 100;
            ZoneModal._startY = ((e.clientY - rect.top) / rect.height) * 100;

            drawBox.style.left = `${ZoneModal._startX}%`;
            drawBox.style.top = `${ZoneModal._startY}%`;
            drawBox.style.width = '0%';
            drawBox.style.height = '0%';
            drawBox.style.display = 'block';
        };

        overlay.onmousemove = (e) => {
            if (!ZoneModal._isDrawing) return;
            const rect = overlay.getBoundingClientRect();
            const currentX = ((e.clientX - rect.left) / rect.width) * 100;
            const currentY = ((e.clientY - rect.top) / rect.height) * 100;

            const x = Math.max(0, Math.min(ZoneModal._startX, currentX));
            const y = Math.max(0, Math.min(ZoneModal._startY, currentY));
            const w = Math.min(100 - x, Math.abs(currentX - ZoneModal._startX));
            const h = Math.min(100 - y, Math.abs(currentY - ZoneModal._startY));

            drawBox.style.left = `${x}%`;
            drawBox.style.top = `${y}%`;
            drawBox.style.width = `${w}%`;
            drawBox.style.height = `${h}%`;

            ZoneModal._currentBox = { x, y, width: w, height: h };
        };

        window.onmouseup = () => {
            if (ZoneModal._isDrawing) {
                ZoneModal._isDrawing = false;
                if (ZoneModal._currentBox && ZoneModal._currentBox.width > 2 && ZoneModal._currentBox.height > 2) {
                    App.toast(I18n.t('zone_drawn_toast'), 'info');
                }
            }
        };
    },

    /**
     * Check if currently set start/end times constitute an overnight shift,
     * and toggle the overnight banner accordingly.
     */
    checkOvernightShift() {
        const startInput = document.getElementById('zone-start-time');
        const endInput = document.getElementById('zone-end-time');
        const banner = document.getElementById('zone-overnight-banner');
        if (!startInput || !endInput || !banner) return;

        const start = startInput.value || '08:00';
        const end = endInput.value || '17:00';
        const isOvernight = start > end;
        banner.style.display = isOvernight ? 'flex' : 'none';
    },

    /**
     * Apply predefined shift template values.
     */
    onSelectShiftTemplate(key) {
        if (!key) return;
        const startInput = document.getElementById('zone-start-time');
        const endInput = document.getElementById('zone-end-time');
        const graceInput = document.getElementById('zone-grace-period');
        const timeoutInput = document.getElementById('zone-absence-timeout');

        const templates = {
            morning: {
                start: '07:00', end: '15:00', grace: 10, timeout: 2,
                breaks: [{ name: I18n.isRTL() ? 'ناهار' : 'Lunch', start_time: '12:00', end_time: '13:00' }]
            },
            evening: {
                start: '15:00', end: '23:00', grace: 10, timeout: 2,
                breaks: [{ name: I18n.isRTL() ? 'عصرانه' : 'Tea Break', start_time: '18:00', end_time: '18:30' }]
            },
            night: {
                start: '23:00', end: '07:00', grace: 10, timeout: 2,
                breaks: [{ name: I18n.isRTL() ? 'استراحت نیمه‌شب' : 'Midnight Rest', start_time: '03:00', end_time: '03:45' }]
            },
            office: {
                start: '08:00', end: '17:00', grace: 15, timeout: 5,
                breaks: [{ name: I18n.isRTL() ? 'ناهار و استراحت' : 'Lunch Break', start_time: '12:30', end_time: '13:30' }]
            },
        };

        const t = templates[key];
        if (!t) return;

        if (startInput) startInput.value = t.start;
        if (endInput) endInput.value = t.end;
        if (graceInput) graceInput.value = t.grace;
        if (timeoutInput) timeoutInput.value = t.timeout;

        ZoneModal._freeTimes = [...t.breaks];
        const container = document.getElementById('zone-free-times-list');
        if (container) {
            container.innerHTML = ZoneModal.renderFreeTimesListHtml();
        }

        ZoneModal.checkOvernightShift();
    },

    /**
     * Save a new camera zone or update an existing one.
     */
    async saveZone() {
        const nameInput = document.getElementById('zone-name-input');
        const name = (nameInput ? nameInput.value : '').trim();
        if (!name) {
            App.toast(I18n.t('err_zone_name'), 'error');
            return;
        }

        if (!ZoneModal._currentBox || ZoneModal._currentBox.width < 1 || ZoneModal._currentBox.height < 1) {
            App.toast(I18n.t('err_draw_box'), 'error');
            return;
        }

        const checkedPersons = Array.from(ZoneModal._selectedPersonIds);
        const alertMode = document.getElementById('zone-alert-mode').value;
        const startTime = document.getElementById('zone-start-time') ? document.getElementById('zone-start-time').value : '08:00';
        const endTime = document.getElementById('zone-end-time') ? document.getElementById('zone-end-time').value : '17:00';
        const absenceTimeout = document.getElementById('zone-absence-timeout')
            ? parseInt(document.getElementById('zone-absence-timeout').value, 10) || 2
            : 2;
        const gracePeriod = document.getElementById('zone-grace-period')
            ? parseInt(document.getElementById('zone-grace-period').value, 10) || 10
            : 10;
        const shiftTemplateSelect = document.getElementById('zone-shift-template');
        const shiftName = shiftTemplateSelect && shiftTemplateSelect.value
            ? (shiftTemplateSelect.options[shiftTemplateSelect.selectedIndex]?.text || '')
            : '';

        const checkedDays = Array.from(document.querySelectorAll('#zone-days-picker input[type="checkbox"]:checked'))
            .map(cb => cb.value);

        const payload = {
            name: name,
            x: Math.round(ZoneModal._currentBox.x * 10) / 10,
            y: Math.round(ZoneModal._currentBox.y * 10) / 10,
            width: Math.round(ZoneModal._currentBox.width * 10) / 10,
            height: Math.round(ZoneModal._currentBox.height * 10) / 10,
            alert_mode: alertMode,
            assigned_person_ids: checkedPersons,
            start_time: startTime,
            end_time: endTime,
            active_days: checkedDays.length > 0 ? checkedDays : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            absence_timeout_minutes: absenceTimeout,
            grace_period_minutes: gracePeriod,
            shift_name: shiftName,
            free_times: ZoneModal._freeTimes || [],
            is_active: true,
        };

        try {
            App.toast(I18n.t('loading'), 'info');

            if (ZoneModal._editingZoneId) {
                // Update existing zone
                const updated = await App.api(`/api/zones/${ZoneModal._editingZoneId}`, 'PUT', payload);
                const idx = ZoneModal._zones.findIndex(z => z.id === ZoneModal._editingZoneId);
                if (idx !== -1) {
                    ZoneModal._zones[idx] = updated;
                }
                App.toast(I18n.t('zone_updated_toast', { name: updated.name }), 'success');
                ZoneModal.cancelEdit();
            } else {
                // Create new zone
                const created = await App.api(`/api/cameras/${ZoneModal._camera.id}/zones`, 'POST', payload);
                ZoneModal._zones.push(created);
                App.toast(I18n.t('zone_saved_toast', { name: created.name }), 'success');
                ZoneModal.renderModal();
            }

            // Refresh ZonesPage board if currently active
            if (typeof ZonesPage !== 'undefined' && typeof ZonesPage.fetchData === 'function') {
                ZonesPage.fetchData().then(() => {
                    if (typeof ZonesPage.render === 'function') ZonesPage.render();
                }).catch(() => {});
            }
        } catch (err) {
            App.toast(I18n.t('err_failed_save', { msg: err.message }), 'error');
        }
    },

    /**
     * Delete a camera zone.
     */
    async deleteZone(zoneId) {
        if (!confirm(I18n.t('confirm_delete_zone'))) return;

        try {
            await App.api(`/api/zones/${zoneId}`, 'DELETE');
            ZoneModal._zones = ZoneModal._zones.filter(z => z.id !== zoneId);
            if (ZoneModal._editingZoneId === zoneId) {
                ZoneModal._editingZoneId = null;
            }
            App.toast(I18n.t('zone_deleted_toast'), 'success');
            ZoneModal.renderModal();

            // Refresh ZonesPage if open
            if (typeof ZonesPage !== 'undefined' && typeof ZonesPage.fetchData === 'function') {
                ZonesPage.fetchData().then(() => {
                    if (typeof ZonesPage.render === 'function') ZonesPage.render();
                }).catch(() => {});
            }
        } catch (err) {
            App.toast(I18n.t('err_failed_delete', { msg: err.message }), 'error');
        }
    },

    /**
     * Refresh snapshot image on the drawing canvas.
     */
    refreshSnapshot() {
        const img = document.getElementById('zone-snapshot-img');
        if (img) {
            img.src = `/api/cameras/${ZoneModal._camera.id}/snapshot?t=${Date.now()}`;
        }
    },

    initCanvas() {
        // Ready
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
