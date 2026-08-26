/**
 * ZoneModal Component — Interactive visual zone drawer and person attachment manager.
 */
const ZoneModal = {
    _camera: null,
    _zones: [],
    _persons: [],
    _isDrawing: false,
    _startX: 0,
    _startY: 0,
    _currentBox: null, // { x, y, width, height } in %

    /**
     * Open the zone management modal for a specific camera.
     */
    async show(cameraId) {
        const camera = CamerasPage._cameras.find(c => c.id === cameraId);
        if (!camera) return;

        ZoneModal._camera = camera;
        ZoneModal._currentBox = { x: 20, y: 20, width: 40, height: 40 }; // Default box

        App.toast(I18n.t('loading'), 'info');

        try {
            const [zones, persons] = await Promise.all([
                App.api(`/api/cameras/${camera.id}/zones`),
                App.api('/api/persons'),
            ]);

            ZoneModal._zones = zones || [];
            ZoneModal._persons = persons || [];
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

        const defaultCheckedDays = I18n.isRTL()
            ? ['Sat', 'Sun', 'Mon', 'Tue', 'Wed']
            : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">${I18n.t('zone_modal_title', { name: ZoneModal.escapeHtml(camera.name) })}</h2>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem; max-height: 80vh; overflow-y: auto;">
                <div style="color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                    <span>${I18n.t('zone_canvas_hint')}</span>
                    <button class="btn btn-secondary btn-sm" onclick="ZoneModal.refreshSnapshot()">${I18n.t('refresh_snapshot')}</button>
                </div>

                <!-- Interactive Snapshot & Canvas Drawing Container -->
                <div id="zone-canvas-container" class="zone-canvas-wrapper" style="position: relative; width: 100%; max-height: 420px; background: #090d16; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-subtle); user-select: none; margin-bottom: 1.25rem;">
                    <img id="zone-snapshot-img" src="${snapshotUrl}" alt="${ZoneModal.escapeAttr(camera.name)}" style="width: 100%; height: 100%; max-height: 420px; object-fit: contain; display: block;" onload="ZoneModal.initCanvas()" />
                    
                    <!-- Overlay SVG / Boxes -->
                    <div id="zone-overlay-layer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: crosshair;">
                        <!-- Existing zones rendered here -->
                        ${ZoneModal.renderZoneOverlays()}
                        <!-- Dynamic active drawing box -->
                        <div id="active-draw-box" style="position: absolute; display: none; border: 2px dashed var(--accent-blue); background: rgba(59, 130, 246, 0.25); border-radius: 4px; pointer-events: none;"></div>
                    </div>
                </div>

                <div class="zone-editor-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
                    <!-- Area Form -->
                    <div class="zone-form-panel" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <h4 style="margin-top: 0; margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--text-primary);">${I18n.t('zone_add_title')}</h4>
                        
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">${I18n.t('label_zone_name')}</label>
                            <input type="text" id="zone-name-input" class="form-input" placeholder="${ZoneModal.escapeAttr(I18n.t('placeholder_zone_name'))}" required />
                        </div>

                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">${I18n.t('label_attach_persons')}</label>
                            <div id="zone-persons-picker" style="max-height: 120px; overflow-y: auto; background: var(--bg-surface); padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 0.35rem;">
                                ${ZoneModal._persons.length === 0 ? `
                                    <span style="font-size: 0.75rem; color: var(--text-tertiary);">${I18n.t('no_enrolled_persons_hint')}</span>
                                ` : ZoneModal._persons.map(p => `
                                    <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-primary); cursor: pointer;">
                                        <input type="checkbox" name="zone-person" value="${p.id}" />
                                        <span>👤 ${ZoneModal.escapeHtml(p.name)} <span style="font-size: 0.7rem; color: var(--text-tertiary);">(${ZoneModal.escapeHtml(p.role || I18n.t('known_identity'))})</span></span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>

                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">${I18n.t('label_alert_policy')}</label>
                            <select id="zone-alert-mode" class="form-input" style="font-size: 0.8rem;">
                                <option value="absence">${I18n.t('policy_absence')}</option>
                                <option value="unauthorized">${I18n.t('policy_unauthorized')}</option>
                                <option value="both">${I18n.t('policy_both')}</option>
                            </select>
                        </div>

                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">${I18n.t('label_shift_schedule')}</label>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.4rem;">
                                <div>
                                    <span style="font-size: 0.7rem; color: var(--text-tertiary);">${I18n.t('label_start_time')}</span>
                                    <input type="time" id="zone-start-time" class="form-input" value="08:00" style="padding: 0.35rem 0.5rem; font-size: 0.8rem;" />
                                </div>
                                <div>
                                    <span style="font-size: 0.7rem; color: var(--text-tertiary);">${I18n.t('label_end_time')}</span>
                                    <input type="time" id="zone-end-time" class="form-input" value="17:00" style="padding: 0.35rem 0.5rem; font-size: 0.8rem;" />
                                </div>
                            </div>
                            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.25rem;" id="zone-days-picker">
                                ${weekdays.map(item => `
                                    <label style="font-size: 0.72rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.2rem; cursor: pointer; background: var(--bg-surface); padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                        <input type="checkbox" name="zone-day" value="${item.key}" ${defaultCheckedDays.includes(item.key) ? 'checked' : ''} />
                                        <span>${item.label}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>

                        <button class="btn btn-primary btn-sm" onclick="ZoneModal.saveZone()" style="width: 100%;">
                            ${I18n.t('btn_save_zone')}
                        </button>
                    </div>

                    <!-- Configured Zones List -->
                    <div class="zone-list-panel" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <h4 style="margin-top: 0; margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--text-primary);">${I18n.t('active_zones_count', { count: I18n.isRTL() ? I18n.toPersianDigits(ZoneModal._zones.length) : ZoneModal._zones.length })}</h4>
                        
                        <div id="active-zones-list" style="display: flex; flex-direction: column; gap: 0.6rem; max-height: 280px; overflow-y: auto;">
                            ${ZoneModal.renderZonesList()}
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal-footer" style="display: flex; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('close')}</button>
            </div>
        `;

        App.openModal(content);
        ZoneModal.initDrawingEvents();
    },

    /**
     * Render colored visual overlay boxes for existing zones on the snapshot.
     */
    renderZoneOverlays() {
        if (!ZoneModal._zones || ZoneModal._zones.length === 0) return '';

        return ZoneModal._zones.map((zone, idx) => {
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
            const color = colors[idx % colors.length];

            return `
                <div class="zone-box-overlay" style="position: absolute; left: ${zone.x}%; top: ${zone.y}%; width: ${zone.width}%; height: ${zone.height}%; border: 2px solid ${color}; background: ${color}22; border-radius: 4px; pointer-events: none;">
                    <span style="position: absolute; top: -20px; left: 0; background: ${color}; color: #fff; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 3px; white-space: nowrap;">
                        ${ZoneModal.escapeHtml(zone.name)}
                    </span>
                </div>
            `;
        }).join('');
    },

    /**
     * Render the active zones list with delete buttons and assigned persons.
     */
    renderZonesList() {
        if (ZoneModal._zones.length === 0) {
            return `<div style="font-size: 0.8rem; color: var(--text-tertiary); text-align: center; padding: 1rem;">${I18n.t('no_camera_zones')}</div>`;
        }

        return ZoneModal._zones.map(zone => {
            const assignedNames = (zone.assigned_person_ids || []).map(pid => {
                const person = ZoneModal._persons.find(p => p.id === pid);
                return person ? person.name : `ID:${pid}`;
            });

            const policyLabel = zone.alert_mode === 'absence' ? I18n.t('policy_absence') : zone.alert_mode === 'unauthorized' ? I18n.t('policy_unauthorized') : I18n.t('policy_both');

            return `
                <div class="zone-item-card" style="background: var(--bg-surface); padding: 0.65rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                            <span>🎯</span>
                            <span>${ZoneModal.escapeHtml(zone.name)}</span>
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">
                            👤 ${I18n.t('assigned_staff')} <strong>${assignedNames.length > 0 ? ZoneModal.escapeHtml(assignedNames.join(', ')) : I18n.t('none')}</strong>
                        </div>
                        <div style="font-size: 0.68rem; color: var(--accent-blue); margin-top: 0.15rem;">
                            🕐 ${zone.start_time || '00:00'} - ${zone.end_time || '23:59'} (${(zone.active_days || []).join(', ')})
                        </div>
                        <div style="font-size: 0.68rem; color: var(--text-tertiary);">
                            ${policyLabel}
                        </div>
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="ZoneModal.deleteZone(${zone.id})" style="padding: 2px 6px; font-size: 0.7rem;">
                        🗑️
                    </button>
                </div>
            `;
        }).join('');
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
     * Save a new camera zone.
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

        // Get checked person IDs
        const checkedPersons = Array.from(document.querySelectorAll('#zone-persons-picker input[type="checkbox"]:checked'))
            .map(cb => parseInt(cb.value, 10));

        const alertMode = document.getElementById('zone-alert-mode').value;
        const startTime = document.getElementById('zone-start-time') ? document.getElementById('zone-start-time').value : '08:00';
        const endTime = document.getElementById('zone-end-time') ? document.getElementById('zone-end-time').value : '17:00';
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
            is_active: true,
        };

        try {
            App.toast(I18n.t('loading'), 'info');
            const created = await App.api(`/api/cameras/${ZoneModal._camera.id}/zones`, 'POST', payload);
            ZoneModal._zones.push(created);
            App.toast(I18n.t('zone_saved_toast', { name: created.name }), 'success');
            ZoneModal.renderModal();
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
            App.toast(I18n.t('zone_deleted_toast'), 'success');
            ZoneModal.renderModal();
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
