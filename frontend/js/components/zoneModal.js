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

        App.toast('Loading camera zones...', 'info');

        try {
            const [zones, persons] = await Promise.all([
                App.api(`/api/cameras/${camera.id}/zones`),
                App.api('/api/persons'),
            ]);

            ZoneModal._zones = zones || [];
            ZoneModal._persons = persons || [];
            ZoneModal.renderModal();
        } catch (err) {
            App.toast(`Failed to load zones: ${err.message}`, 'error');
        }
    },

    /**
     * Render the Zone modal HTML.
     */
    renderModal() {
        const camera = ZoneModal._camera;
        const snapshotUrl = `/api/cameras/${camera.id}/snapshot?t=${Date.now()}`;

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">🎯 Important Areas (Zones) — ${ZoneModal.escapeHtml(camera.name)}</h2>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem; max-height: 80vh; overflow-y: auto;">
                <div style="color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
                    <span>📍 Click and drag on the camera image to draw a designated area.</span>
                    <button class="btn btn-secondary btn-sm" onclick="ZoneModal.refreshSnapshot()">🔄 Refresh Camera View</button>
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
                        <h4 style="margin-top: 0; margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--text-primary);">➕ Add / Configure Area</h4>
                        
                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">Area Name</label>
                            <input type="text" id="zone-name-input" class="form-input" placeholder="e.g. Work Desk, Reception Counter, Station 1" required />
                        </div>

                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">Attach Person(s) to this Area</label>
                            <div id="zone-persons-picker" style="max-height: 120px; overflow-y: auto; background: var(--bg-surface); padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 0.35rem;">
                                ${ZoneModal._persons.length === 0 ? `
                                    <span style="font-size: 0.75rem; color: var(--text-tertiary);">No enrolled persons yet. Add people in Identities page first.</span>
                                ` : ZoneModal._persons.map(p => `
                                    <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-primary); cursor: pointer;">
                                        <input type="checkbox" name="zone-person" value="${p.id}" />
                                        <span>👤 ${ZoneModal.escapeHtml(p.name)} <span style="font-size: 0.7rem; color: var(--text-tertiary);">(${p.role || 'Identity'})</span></span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>

                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">Notification Policy</label>
                            <select id="zone-alert-mode" class="form-input" style="font-size: 0.8rem;">
                                <option value="absence">🔔 Alert if attached person is NOT in this area</option>
                                <option value="unauthorized">🚨 Alert if unauthorized person enters this area</option>
                                <option value="both">⚠️ Both (Absence + Unauthorized entry)</option>
                            </select>
                        </div>

                        <div class="form-group" style="margin-bottom: 0.75rem;">
                            <label class="form-label" style="font-size: 0.75rem; color: var(--text-secondary);">🕐 Shift Timetable (Active Monitoring Hours)</label>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.4rem;">
                                <div>
                                    <span style="font-size: 0.7rem; color: var(--text-tertiary);">Start Time</span>
                                    <input type="time" id="zone-start-time" class="form-input" value="08:00" style="padding: 0.35rem 0.5rem; font-size: 0.8rem;" />
                                </div>
                                <div>
                                    <span style="font-size: 0.7rem; color: var(--text-tertiary);">End Time</span>
                                    <input type="time" id="zone-end-time" class="form-input" value="17:00" style="padding: 0.35rem 0.5rem; font-size: 0.8rem;" />
                                </div>
                            </div>
                            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.25rem;" id="zone-days-picker">
                                ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `
                                    <label style="font-size: 0.72rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.2rem; cursor: pointer; background: var(--bg-surface); padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                                        <input type="checkbox" name="zone-day" value="${day}" ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day) ? 'checked' : ''} />
                                        <span>${day}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>

                        <button class="btn btn-primary btn-sm" onclick="ZoneModal.saveZone()" style="width: 100%;">
                            💾 Save Area & Timetable
                        </button>
                    </div>

                    <!-- Configured Zones List -->
                    <div class="zone-list-panel" style="background: var(--bg-surface-hover); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <h4 style="margin-top: 0; margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--text-primary);">📋 Active Areas (${ZoneModal._zones.length})</h4>
                        
                        <div id="active-zones-list" style="display: flex; flex-direction: column; gap: 0.6rem; max-height: 280px; overflow-y: auto;">
                            ${ZoneModal.renderZonesList()}
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal-footer" style="display: flex; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="App.closeModal()">Done</button>
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
            return `<div style="font-size: 0.8rem; color: var(--text-tertiary); text-align: center; padding: 1rem;">No areas defined yet. Draw on the image and click "Save Area".</div>`;
        }

        return ZoneModal._zones.map(zone => {
            const assignedNames = (zone.assigned_person_ids || []).map(pid => {
                const person = ZoneModal._persons.find(p => p.id === pid);
                return person ? person.name : `ID:${pid}`;
            });

            return `
                <div class="zone-item-card" style="background: var(--bg-surface); padding: 0.65rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                            <span>🎯</span>
                            <span>${ZoneModal.escapeHtml(zone.name)}</span>
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">
                            👤 Attached: <strong>${assignedNames.length > 0 ? ZoneModal.escapeHtml(assignedNames.join(', ')) : 'None'}</strong>
                        </div>
                        <div style="font-size: 0.68rem; color: var(--accent-blue); margin-top: 0.15rem;">
                            🕐 Shift: ${zone.start_time || '00:00'} - ${zone.end_time || '23:59'} (${(zone.active_days || []).join(', ')})
                        </div>
                        <div style="font-size: 0.68rem; color: var(--text-tertiary);">
                            ${zone.alert_mode === 'absence' ? '🔔 Alert if NOT in area' : zone.alert_mode === 'unauthorized' ? '🚨 Alert if unauthorized' : '⚠️ Both alerts'}
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
                    App.toast('Area drawn! Enter area name and click Save.', 'info');
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
            App.toast('Please enter an area name.', 'error');
            return;
        }

        if (!ZoneModal._currentBox || ZoneModal._currentBox.width < 1 || ZoneModal._currentBox.height < 1) {
            App.toast('Please draw a rectangular area on the camera image first.', 'error');
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
            App.toast('Saving important area...', 'info');
            const created = await App.api(`/api/cameras/${ZoneModal._camera.id}/zones`, 'POST', payload);
            ZoneModal._zones.push(created);
            App.toast(`✅ Area "${created.name}" saved!`, 'success');
            ZoneModal.renderModal();
        } catch (err) {
            App.toast(`Failed to save area: ${err.message}`, 'error');
        }
    },

    /**
     * Delete a camera zone.
     */
    async deleteZone(zoneId) {
        if (!confirm('Remove this designated area?')) return;

        try {
            await App.api(`/api/zones/${zoneId}`, 'DELETE');
            ZoneModal._zones = ZoneModal._zones.filter(z => z.id !== zoneId);
            App.toast('Area removed.', 'success');
            ZoneModal.renderModal();
        } catch (err) {
            App.toast(`Failed to delete: ${err.message}`, 'error');
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
