/**
 * PersonForm component — modal form for adding known persons with photo upload
 * and selecting snapshots directly from unknown detection logs.
 */
const PersonForm = {
    _selectedPhotos: [], // Array of { id, type: 'event'|'file', eventId, snapshotUrl, snapshotPath, file, previewUrl, timestamp, cameraName, isPrimary }
    _selectedFiles: [],  // Backward-compatibility
    _relatedEvents: [],  // Other detections for this unknown face in the current session
    _allUnknownLogs: [], // Fetched unknown detection events from /api/events
    _activeTab: 'unknown', // 'unknown' or 'upload'
    _cameras: [],
    _fromEvent: false,
    _primaryEvent: null,
    _unknownLogsOffset: 0,
    _unknownLogsLimit: 36,
    _hasMoreUnknownLogs: true,
    _isLoadingUnknownLogs: false,
    _currentPersonId: null,
    _currentPersonName: null,

    /**
     * Entry point to enroll a person directly from one or more event snapshots.
     * @param {Array<Object>} selectedEvents - List of event objects to pre-select
     * @param {Array<Object>} relatedEvents - Other detections for the same unknown person
     */
    showEnrollFromEvents(selectedEvents = [], relatedEvents = []) {
        PersonForm.reset();

        const eventsList = Array.isArray(selectedEvents) ? selectedEvents : [selectedEvents];
        PersonForm._relatedEvents = Array.isArray(relatedEvents) ? relatedEvents : [];
        PersonForm._fromEvent = true;
        PersonForm._primaryEvent = eventsList[0] || null;
        PersonForm._activeTab = 'unknown';

        eventsList.forEach((ev, idx) => {
            if (!ev) return;
            const snapUrl = ev.snapshot_url || (ev.snapshot_path ? `/api/snapshots/${ev.snapshot_path}` : '');
            PersonForm._selectedPhotos.push({
                id: `event_${ev.id}`,
                type: 'event',
                eventId: ev.id,
                snapshotUrl: snapUrl,
                snapshotPath: ev.snapshot_path || '',
                timestamp: ev.timestamp,
                cameraName: ev.camera_name || (ev.camera_id ? `Camera #${ev.camera_id}` : ''),
                isPrimary: idx === 0,
            });
        });

        App.openModal(PersonForm.renderModal({ fromEvent: true, primaryEvent: PersonForm._primaryEvent }), 'modal-lg');
        PersonForm.initModalState({ fromEvent: true, primaryEvent: PersonForm._primaryEvent });
    },

    /**
     * Render the "Add Person" / "Enroll Person" modal content.
     * @param {Object} options - Options including fromEvent flag and primaryEvent
     * @returns {string} HTML string
     */
    renderModal(options = {}) {
        const fromEvent = options.fromEvent || PersonForm._fromEvent;
        const primaryEv = options.primaryEvent || PersonForm._primaryEvent;
        const titleText = fromEvent ? I18n.t('enroll_from_event_title') : I18n.t('modal_add_person');
        const count = PersonForm._selectedPhotos.length;
        const countDisplay = I18n.isRTL() ? I18n.toPersianDigits(count) : count;

        return `
            <div class="modal-header" style="padding: 1.15rem 1.5rem; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-size: 1.45rem;">${fromEvent ? '🎯' : '👤'}</span>
                    <div>
                        <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700;">${titleText}</h2>
                        ${fromEvent && primaryEv ? `
                            <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.2rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <span>${I18n.t('enroll_event_source', { id: I18n.isRTL() ? I18n.toPersianDigits(primaryEv.id) : primaryEv.id })}</span>
                                ${primaryEv.camera_name ? `<span>• 📹 ${PersonForm.escapeHtml(primaryEv.camera_name)}</span>` : ''}
                                ${primaryEv.timestamp ? `<span>• 🕐 ${I18n.formatTimestamp(primaryEv.timestamp)}</span>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem 1.5rem; max-height: 74vh; overflow-y: auto;">
                <form id="person-form" onsubmit="PersonForm.handleSubmit(event)">
                    <!-- Name, Role & Section Row -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.25rem;">
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" for="person-name" style="font-weight: 700; font-size: 0.85rem;">
                                ${I18n.t('label_full_name')} <span style="color: var(--accent-rose);">*</span>
                            </label>
                            <input
                                class="form-input"
                                type="text"
                                id="person-name"
                                name="name"
                                placeholder="${PersonForm.escapeAttr(I18n.t('placeholder_full_name'))}"
                                required
                                autofocus
                            />
                        </div>
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" for="person-role" style="font-weight: 700; font-size: 0.85rem;">
                                ${I18n.t('label_role')}
                            </label>
                            <input
                                class="form-input"
                                type="text"
                                id="person-role"
                                name="role"
                                placeholder="${PersonForm.escapeAttr(I18n.t('placeholder_role'))}"
                            />
                        </div>
                        <div class="form-group" style="margin-bottom: 0;">
                            <label class="form-label" for="person-section" style="font-weight: 700; font-size: 0.85rem;">
                                🏢 ${I18n.t('tab_sections') || 'بخش سازمانی'}
                            </label>
                            <input
                                class="form-input"
                                type="text"
                                id="person-section"
                                name="section"
                                placeholder="مثال: بسته‌بندی، خط تولید"
                            />
                        </div>
                    </div>

                    <!-- Selected Photos Section -->
                    <div style="margin-bottom: 1.25rem; background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.9rem 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem;">
                            <div style="display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.03em;">
                                <span>🖼️</span>
                                <span>${I18n.t('label_ref_photos')}</span>
                            </div>
                            <span id="selected-photos-badge" style="font-size: 0.75rem; color: var(--accent-blue); background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.2rem 0.6rem; border-radius: 12px; font-weight: 700;">
                                ${I18n.t('selected_photos_count', { count: countDisplay })}
                            </span>
                        </div>

                        <div id="upload-preview" style="display: flex; flex-wrap: wrap; gap: 0.65rem; min-height: 86px; max-height: 200px; overflow-y: auto; padding: 0.4rem; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); border: 1px dashed var(--border-subtle); align-items: center;"></div>
                    </div>

                    <!-- Source Selector: Unknown Logs vs Device Upload -->
                    <div style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); overflow: hidden;">
                        <div style="display: flex; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-hover);">
                            <button
                                type="button"
                                id="btn-tab-unknown"
                                onclick="PersonForm.switchPhotoTab('unknown')"
                                style="flex: 1; padding: 0.75rem 1rem; border: none; background: transparent; font-size: 0.83rem; font-weight: 700; cursor: pointer; color: var(--accent-blue); border-bottom: 2px solid var(--accent-blue); display: flex; align-items: center; justify-content: center; gap: 0.45rem; transition: all 0.15s ease;"
                            >
                                <span>📸</span>
                                <span>${I18n.t('add_from_unknown_logs')}</span>
                            </button>
                            <button
                                type="button"
                                id="btn-tab-upload"
                                onclick="PersonForm.switchPhotoTab('upload')"
                                style="flex: 1; padding: 0.75rem 1rem; border: none; background: transparent; font-size: 0.83rem; font-weight: 600; cursor: pointer; color: var(--text-tertiary); border-bottom: 2px solid transparent; display: flex; align-items: center; justify-content: center; gap: 0.45rem; transition: all 0.15s ease;"
                            >
                                <span>📁</span>
                                <span>${I18n.t('photos_from_device')}</span>
                            </button>
                        </div>

                        <!-- Panel A: Unknown Logs Picker -->
                        <div id="panel-unknown-logs" style="padding: 1rem; display: block;">
                            <!-- Related Unknown Detections (from the same unknown detection sequence) -->
                            <div id="unknown-related-section" style="display: none; margin-bottom: 1.15rem; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: var(--radius-sm); padding: 0.75rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.55rem;">
                                    <div style="font-size: 0.75rem; font-weight: 700; color: var(--accent-blue); text-transform: uppercase; display: flex; align-items: center; gap: 0.35rem;">
                                        <span>⚡</span>
                                        <span>${I18n.t('related_unknown_detections')}</span>
                                    </div>
                                    <button type="button" class="btn btn-xs btn-secondary" onclick="PersonForm.selectAllRelated()" style="font-size: 0.7rem; padding: 0.2rem 0.55rem;">
                                        ✓ ${I18n.t('select_all')}
                                    </button>
                                </div>
                                <div id="unknown-related-grid" style="display: flex; gap: 0.55rem; overflow-x: auto; padding-bottom: 0.35rem;"></div>
                            </div>

                            <!-- All Unknown Logs Browser -->
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem; gap: 0.5rem; flex-wrap: wrap;">
                                    <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">
                                        ${I18n.t('all_unknown_logs')}
                                    </div>
                                    <div style="display: flex; gap: 0.4rem; align-items: center;">
                                        <select id="unknown-camera-filter" class="form-input" onchange="PersonForm.onCameraFilterChange(this.value)" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; height: 30px; width: auto; min-width: 130px;">
                                            <option value="">${I18n.t('filter_by_camera')}</option>
                                        </select>
                                        <button type="button" class="btn btn-xs btn-secondary" onclick="PersonForm.loadUnknownLogs(true)" title="Refresh" style="height: 30px; padding: 0 0.55rem;">
                                            🔄
                                        </button>
                                    </div>
                                </div>

                                <div id="unknown-logs-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 0.55rem; max-height: 220px; overflow-y: auto; padding: 0.55rem; background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
                                    <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 1.5rem 0; font-size: 0.8rem;">
                                        <div class="spinner" style="width: 22px; height: 22px; margin: 0 auto 0.4rem auto;"></div>
                                        ${I18n.t('loading')}
                                    </div>
                                </div>

                                <div id="unknown-logs-load-more" style="text-align: center; margin-top: 0.6rem; display: none;">
                                    <button type="button" class="btn btn-xs btn-secondary" onclick="PersonForm.loadMoreUnknownLogs()" style="font-size: 0.72rem; padding: 0.25rem 0.8rem;">
                                        ⬇️ ${I18n.t('load_more_logs')}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Panel B: Local Device File Upload -->
                        <div id="panel-device-upload" style="padding: 1.25rem; display: none;">
                            <div
                                class="upload-zone"
                                id="upload-zone"
                                onclick="document.getElementById('photo-input').click()"
                                ondragover="PersonForm.handleDragOver(event)"
                                ondragleave="PersonForm.handleDragLeave(event)"
                                ondrop="PersonForm.handleDrop(event)"
                                style="padding: 1.5rem 1rem;"
                            >
                                <div class="upload-zone-icon" style="font-size: 2.2rem; margin-bottom: 0.35rem;">📸</div>
                                <div class="upload-zone-text" style="font-size: 0.9rem;">
                                    ${I18n.t('upload_drag_text')}
                                </div>
                                <div class="upload-zone-hint" style="font-size: 0.75rem;">
                                    ${I18n.t('upload_hint_1')}
                                </div>
                            </div>
                            <input
                                type="file"
                                id="photo-input"
                                accept="image/*"
                                multiple
                                hidden
                                onchange="PersonForm.handleFileSelect(event)"
                            />
                        </div>
                    </div>
                </form>
            </div>

            <div class="modal-footer" style="padding: 1.1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle);">
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" type="submit" form="person-form" id="btn-submit-person">
                    <span>${I18n.t('enroll_btn_with_count', { count: countDisplay })}</span>
                </button>
            </div>
        `;
    },

    /**
     * Initialize modal state after rendering.
     */
    async initModalState(options = {}) {
        PersonForm.updatePreview();
        await PersonForm.populateCameraDropdown();

        // If related events were provided, render them
        if (PersonForm._relatedEvents && PersonForm._relatedEvents.length > 0) {
            PersonForm.renderRelatedSection();
        }

        // Fetch unknown detection logs from backend
        PersonForm.loadUnknownLogs(true);
    },

    /**
     * Switch photo source tab between 'unknown' and 'upload'.
     */
    switchPhotoTab(tab) {
        PersonForm._activeTab = tab;
        const panelUnknown = document.getElementById('panel-unknown-logs');
        const panelUpload = document.getElementById('panel-device-upload');
        const btnUnknown = document.getElementById('btn-tab-unknown');
        const btnUpload = document.getElementById('btn-tab-upload');

        if (tab === 'unknown') {
            if (panelUnknown) panelUnknown.style.display = 'block';
            if (panelUpload) panelUpload.style.display = 'none';
            if (btnUnknown) {
                btnUnknown.style.color = 'var(--accent-blue)';
                btnUnknown.style.borderBottom = '2px solid var(--accent-blue)';
                btnUnknown.style.fontWeight = '700';
            }
            if (btnUpload) {
                btnUpload.style.color = 'var(--text-tertiary)';
                btnUpload.style.borderBottom = '2px solid transparent';
                btnUpload.style.fontWeight = '600';
            }
        } else {
            if (panelUnknown) panelUnknown.style.display = 'none';
            if (panelUpload) panelUpload.style.display = 'block';
            if (btnUpload) {
                btnUpload.style.color = 'var(--accent-blue)';
                btnUpload.style.borderBottom = '2px solid var(--accent-blue)';
                btnUpload.style.fontWeight = '700';
            }
            if (btnUnknown) {
                btnUnknown.style.color = 'var(--text-tertiary)';
                btnUnknown.style.borderBottom = '2px solid transparent';
                btnUnknown.style.fontWeight = '600';
            }
        }
    },

    /**
     * Render the related unknown events section.
     */
    renderRelatedSection() {
        const sec = document.getElementById('unknown-related-section');
        const grid = document.getElementById('unknown-related-grid');
        if (!sec || !grid) return;

        const events = PersonForm._relatedEvents || [];
        if (events.length === 0) {
            sec.style.display = 'none';
            return;
        }

        sec.style.display = 'block';
        grid.innerHTML = events.map(ev => {
            const isSelected = PersonForm._selectedPhotos.some(p => p.type === 'event' && p.eventId === ev.id);
            const snapUrl = ev.snapshot_url || (ev.snapshot_path ? `/api/snapshots/${ev.snapshot_path}` : '');
            return `
                <div
                    class="related-thumb-card"
                    id="rel-card-${ev.id}"
                    onclick="PersonForm.toggleUnknownEvent(${ev.id})"
                    style="position: relative; flex: 0 0 auto; width: 84px; height: 76px; border-radius: var(--radius-sm); overflow: hidden; cursor: pointer; border: ${isSelected ? '2px solid var(--accent-blue)' : '1px solid var(--border-subtle)'}; background: #0c1020; transition: all 0.15s ease;"
                    title="${PersonForm.escapeAttr(I18n.t('toggle_select_tooltip'))}"
                >
                    <img src="${snapUrl}" style="width: 100%; height: 56px; object-fit: cover; display: block;" />
                    <div style="font-size: 0.58rem; text-align: center; background: rgba(0,0,0,0.75); color: #fff; padding: 2px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${I18n.formatTimestamp(ev.timestamp)}
                    </div>
                    <div class="card-select-badge" style="position: absolute; top: 3px; ${I18n.isRTL() ? 'left: 3px' : 'right: 3px'}; width: 18px; height: 18px; border-radius: 50%; background: ${isSelected ? 'var(--accent-blue)' : 'rgba(0,0,0,0.6)'}; border: 1.5px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; color: #fff; font-weight: 700;">
                        ${isSelected ? '✓' : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Select all related events from this sequence.
     */
    selectAllRelated() {
        if (!PersonForm._relatedEvents) return;
        PersonForm._relatedEvents.forEach(ev => {
            if (!PersonForm._selectedPhotos.some(p => p.type === 'event' && p.eventId === ev.id)) {
                PersonForm._selectedPhotos.push({
                    id: `event_${ev.id}`,
                    type: 'event',
                    eventId: ev.id,
                    snapshotUrl: ev.snapshot_url || (ev.snapshot_path ? `/api/snapshots/${ev.snapshot_path}` : ''),
                    snapshotPath: ev.snapshot_path || '',
                    timestamp: ev.timestamp,
                    cameraName: ev.camera_name || (ev.camera_id ? `Camera #${ev.camera_id}` : ''),
                });
            }
        });
        PersonForm.updatePreview();
        PersonForm.renderRelatedSection();
    },

    /**
     * Populate camera filter dropdown.
     */
    async populateCameraDropdown() {
        const selectEl = document.getElementById('unknown-camera-filter');
        if (!selectEl) return;
        try {
            const data = await App.api('/api/cameras');
            PersonForm._cameras = data || [];
            selectEl.innerHTML = `<option value="">${I18n.t('filter_by_camera')}</option>` +
                PersonForm._cameras.map(c => `<option value="${c.id}">${PersonForm.escapeHtml(c.name)}</option>`).join('');
        } catch (e) {
            console.warn('Failed to load cameras for filter:', e);
        }
    },

    /**
     * On camera filter change.
     */
    onCameraFilterChange() {
        PersonForm.loadUnknownLogs(true);
    },

    /**
     * On snapshot type filter change (unknown vs person vs all).
     */
    onSnapshotTypeFilterChange() {
        PersonForm.loadUnknownLogs(true);
    },

    /**
     * Load unknown detection logs from backend.
     */
    async loadUnknownLogs(reset = false) {
        if (PersonForm._isLoadingUnknownLogs) return;
        PersonForm._isLoadingUnknownLogs = true;

        if (reset) {
            PersonForm._unknownLogsOffset = 0;
            PersonForm._allUnknownLogs = [];
            PersonForm._hasMoreUnknownLogs = true;
        }

        const grid = document.getElementById('unknown-logs-grid');
        const loadMoreBtn = document.getElementById('unknown-logs-load-more');
        const camFilter = document.getElementById('unknown-camera-filter');
        const typeFilter = document.getElementById('unknown-type-filter');
        const camId = camFilter ? camFilter.value : '';
        const filterType = typeFilter ? typeFilter.value : 'unknown';

        if (reset && grid) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 1.5rem 0; font-size: 0.8rem;">
                    <div class="spinner" style="width: 22px; height: 22px; margin: 0 auto 0.4rem auto;"></div>
                    ${I18n.t('loading')}
                </div>
            `;
        }

        try {
            let url = `/api/events?has_snapshot=true&limit=${PersonForm._unknownLogsLimit}&offset=${PersonForm._unknownLogsOffset}`;
            if (filterType === 'unknown') {
                url += '&is_known=false';
            } else if (filterType === 'person' && PersonForm._currentPersonId) {
                url += `&person_id=${PersonForm._currentPersonId}`;
            }
            if (camId) url += `&camera_id=${camId}`;

            const data = await App.api(url);
            const events = data.events || [];

            if (reset) {
                PersonForm._allUnknownLogs = events;
            } else {
                PersonForm._allUnknownLogs = [...PersonForm._allUnknownLogs, ...events];
            }

            PersonForm._unknownLogsOffset += events.length;
            PersonForm._hasMoreUnknownLogs = events.length === PersonForm._unknownLogsLimit;

            PersonForm.renderUnknownLogsGrid();

            if (loadMoreBtn) {
                loadMoreBtn.style.display = PersonForm._hasMoreUnknownLogs ? 'block' : 'none';
            }
        } catch (err) {
            console.error('Failed to load unknown logs:', err);
            if (grid) {
                grid.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; color: var(--accent-rose); padding: 1rem 0; font-size: 0.8rem;">
                        ${err.message || 'Error loading logs'}
                    </div>
                `;
            }
        } finally {
            PersonForm._isLoadingUnknownLogs = false;
        }
    },

    /**
     * Load more unknown logs (next page).
     */
    loadMoreUnknownLogs() {
        PersonForm.loadUnknownLogs(false);
    },

    /**
     * Render the grid of unknown detection logs.
     */
    renderUnknownLogsGrid() {
        const grid = document.getElementById('unknown-logs-grid');
        if (!grid) return;

        const events = PersonForm._allUnknownLogs || [];
        if (events.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 1.8rem 1rem; font-size: 0.8rem;">
                    <span style="font-size: 1.6rem; display: block; margin-bottom: 0.35rem; opacity: 0.7;">🔎</span>
                    ${I18n.t('no_unknown_logs_found')}
                </div>
            `;
            return;
        }

        grid.innerHTML = events.map(ev => {
            const isSelected = PersonForm._selectedPhotos.some(p => p.type === 'event' && p.eventId === ev.id);
            const snapUrl = ev.snapshot_url || (ev.snapshot_path ? `/api/snapshots/${ev.snapshot_path}` : '');
            const displayName = ev.person_name ? `${PersonForm.escapeHtml(ev.person_name)} • ` : '';
            return `
                <div
                    class="unknown-log-card ${isSelected ? 'selected' : ''}"
                    id="unknown-card-${ev.id}"
                    onclick="PersonForm.toggleUnknownEvent(${ev.id})"
                    style="position: relative; border-radius: var(--radius-sm); overflow: hidden; cursor: pointer; border: ${isSelected ? '2px solid var(--accent-blue)' : '1px solid var(--border-subtle)'}; background: #0c1020; transition: all 0.15s ease;"
                    title="${PersonForm.escapeAttr(ev.person_name ? `${ev.person_name} (${ev.camera_name || ''})` : (ev.camera_name || I18n.t('toggle_select_tooltip')))}"
                >
                    <img src="${snapUrl}" style="width: 100%; height: 68px; object-fit: cover; display: block;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23161f36%22 width=%22100%22 height=%22100%22/></svg>'" />
                    <div style="font-size: 0.6rem; text-align: center; background: rgba(0,0,0,0.8); color: #fff; padding: 2px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${displayName}${I18n.formatTimestamp(ev.timestamp)}
                    </div>
                    <div class="card-select-badge" style="position: absolute; top: 3px; ${I18n.isRTL() ? 'left: 3px' : 'right: 3px'}; width: 20px; height: 20px; border-radius: 50%; background: ${isSelected ? 'var(--accent-blue)' : 'rgba(0,0,0,0.65)'}; border: 1.5px solid ${isSelected ? '#fff' : 'rgba(255,255,255,0.7)'}; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: #fff; font-weight: 700; box-shadow: 0 2px 4px rgba(0,0,0,0.4);">
                        ${isSelected ? '✓' : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Toggle selection of an unknown event snapshot.
     */
    toggleUnknownEvent(eventId) {
        const ev = (PersonForm._allUnknownLogs || []).find(e => e.id === eventId) ||
                   (PersonForm._relatedEvents || []).find(e => e.id === eventId) ||
                   EventCard._cache[eventId];
        if (!ev) return;

        const existingIdx = PersonForm._selectedPhotos.findIndex(p => p.type === 'event' && p.eventId === ev.id);
        if (existingIdx >= 0) {
            PersonForm._selectedPhotos.splice(existingIdx, 1);
        } else {
            const snapUrl = ev.snapshot_url || (ev.snapshot_path ? `/api/snapshots/${ev.snapshot_path}` : '');
            PersonForm._selectedPhotos.push({
                id: `event_${ev.id}`,
                type: 'event',
                eventId: ev.id,
                snapshotUrl: snapUrl,
                snapshotPath: ev.snapshot_path || '',
                timestamp: ev.timestamp,
                cameraName: ev.camera_name || (ev.camera_id ? `Camera #${ev.camera_id}` : ''),
                isPrimary: PersonForm._selectedPhotos.length === 0,
            });
        }

        PersonForm.updatePreview();
        PersonForm.syncGridSelectionVisuals(ev.id);
    },

    /**
     * Sync visual checkmarks on cards in the grids.
     */
    syncGridSelectionVisuals(eventId) {
        const isSelected = PersonForm._selectedPhotos.some(p => p.type === 'event' && p.eventId === eventId);

        // Update card in All Unknown Logs grid
        const card = document.getElementById(`unknown-card-${eventId}`);
        if (card) {
            card.style.borderColor = isSelected ? 'var(--accent-blue)' : 'var(--border-subtle)';
            card.classList.toggle('selected', isSelected);
            const badge = card.querySelector('.card-select-badge');
            if (badge) {
                badge.style.background = isSelected ? 'var(--accent-blue)' : 'rgba(0,0,0,0.65)';
                badge.style.borderColor = isSelected ? '#fff' : 'rgba(255,255,255,0.7)';
                badge.textContent = isSelected ? '✓' : '';
            }
        }

        // Update card in Related section
        const relCard = document.getElementById(`rel-card-${eventId}`);
        if (relCard) {
            relCard.style.borderColor = isSelected ? 'var(--accent-blue)' : 'var(--border-subtle)';
            relCard.classList.toggle('selected', isSelected);
            const relBadge = relCard.querySelector('.card-select-badge');
            if (relBadge) {
                relBadge.style.background = isSelected ? 'var(--accent-blue)' : 'rgba(0,0,0,0.6)';
                relBadge.textContent = isSelected ? '✓' : '';
            }
        }
    },

    /**
     * Handle local file selection from input.
     */
    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        files.forEach(file => {
            if (!file.type.startsWith('image/')) return;
            PersonForm._selectedPhotos.push({
                id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                type: 'file',
                file: file,
                previewUrl: URL.createObjectURL(file),
                name: file.name,
                isPrimary: PersonForm._selectedPhotos.length === 0,
            });
            PersonForm._selectedFiles.push(file);
        });
        PersonForm.updatePreview();
    },

    /**
     * Handle drag over.
     */
    handleDragOver(event) {
        event.preventDefault();
        event.currentTarget.classList.add('dragover');
    },

    /**
     * Handle drag leave.
     */
    handleDragLeave(event) {
        event.currentTarget.classList.remove('dragover');
    },

    /**
     * Handle file drop.
     */
    handleDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('dragover');

        const files = Array.from(event.dataTransfer.files).filter(f =>
            f.type.startsWith('image/')
        );
        files.forEach(file => {
            PersonForm._selectedPhotos.push({
                id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                type: 'file',
                file: file,
                previewUrl: URL.createObjectURL(file),
                name: file.name,
                isPrimary: PersonForm._selectedPhotos.length === 0,
            });
            PersonForm._selectedFiles.push(file);
        });
        PersonForm.updatePreview();
    },

    /**
     * Remove a selected photo by internal ID.
     */
    removePhoto(id) {
        const idx = PersonForm._selectedPhotos.findIndex(p => p.id === id);
        if (idx >= 0) {
            const removed = PersonForm._selectedPhotos.splice(idx, 1)[0];
            if (removed && removed.type === 'file' && removed.file) {
                const fileIdx = PersonForm._selectedFiles.indexOf(removed.file);
                if (fileIdx >= 0) PersonForm._selectedFiles.splice(fileIdx, 1);
            }
            if (removed && removed.type === 'event') {
                PersonForm.syncGridSelectionVisuals(removed.eventId);
            }
        }
        PersonForm.updatePreview();
    },

    /**
     * Update the preview container of selected reference photos.
     */
    updatePreview() {
        const container = document.getElementById('upload-preview');
        const badge = document.getElementById('selected-photos-badge');
        const submitBtnPerson = document.getElementById('btn-submit-person');
        const submitBtnPhotos = document.getElementById('btn-submit-photos');
        const count = PersonForm._selectedPhotos.length;
        const countDisplay = I18n.isRTL() ? I18n.toPersianDigits(count) : count;

        if (badge) {
            badge.textContent = I18n.t('selected_photos_count', { count: countDisplay });
        }
        if (submitBtnPerson) {
            submitBtnPerson.innerHTML = `<span>${I18n.t('enroll_btn_with_count', { count: countDisplay })}</span>`;
        }
        if (submitBtnPhotos) {
            const countSuffix = count > 0 ? ` (${countDisplay})` : '';
            submitBtnPhotos.innerHTML = `<span>⬆️</span> <span>${I18n.t('btn_add_photos')}${countSuffix}</span>`;
        }

        if (!container) return;

        if (PersonForm._selectedPhotos.length === 0) {
            container.innerHTML = `
                <div style="width: 100%; text-align: center; color: var(--text-tertiary); font-size: 0.8rem; padding: 0.85rem 0;">
                    <span>📸 ${I18n.t('no_photos_selected_yet')}</span>
                </div>
            `;
            return;
        }

        container.innerHTML = PersonForm._selectedPhotos.map((photo, index) => {
            const src = photo.type === 'event' ? photo.snapshotUrl : photo.previewUrl;
            const isPrimary = index === 0;
            const badgeLabel = photo.type === 'event'
                ? (isPrimary ? `⭐ ${I18n.t('primary_photo')}` : `#${photo.eventId}`)
                : (isPrimary ? `⭐ ${I18n.t('primary_photo')}` : '📁 Upload');

            return `
                <div style="position: relative; width: 72px; height: 72px; border-radius: var(--radius-sm); overflow: hidden; border: ${isPrimary ? '2px solid var(--accent-blue)' : '1px solid var(--border-subtle)'}; background: #0c1020; flex: 0 0 auto; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
                    <img src="${src}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23161f36%22 width=%22100%22 height=%22100%22/></svg>'" />
                    
                    <!-- Origin / Primary badge -->
                    <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.75); color: #fff; font-size: 0.58rem; text-align: center; padding: 1px 2px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${badgeLabel}
                    </div>

                    <!-- Remove photo button -->
                    <button
                        type="button"
                        onclick="PersonForm.removePhoto('${photo.id}')"
                        title="${PersonForm.escapeAttr(I18n.t('remove_photo'))}"
                        style="position: absolute; top: 2px; ${I18n.isRTL() ? 'left: 2px' : 'right: 2px'}; width: 18px; height: 18px; border-radius: 50%; border: none; background: rgba(225, 29, 72, 0.9); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,0.5);"
                    >
                        ✕
                    </button>
                </div>
            `;
        }).join('');
    },

    /**
     * Handle the create person form submission.
     */
    async handleSubmit(event) {
        event.preventDefault();

        const nameInput = document.getElementById('person-name');
        const roleInput = document.getElementById('person-role');
        const sectionInput = document.getElementById('person-section');
        const name = nameInput ? nameInput.value.trim() : '';
        const role = roleInput ? roleInput.value.trim() : '';
        const section = sectionInput ? sectionInput.value.trim() : '';

        if (!name) {
            App.toast(I18n.t('err_enter_name'), 'error');
            return;
        }

        if (PersonForm._selectedPhotos.length === 0) {
            App.toast(I18n.t('err_select_photo'), 'error');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-person');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>⏳ ${I18n.t('processing_photos')}</span>`;
        }

        try {
            App.toast(I18n.t('processing_photos'), 'info');

            const formData = new FormData();
            formData.append('name', name);
            formData.append('role', role);
            if (section) {
                formData.append('section', section);
            }

            // Separate event photos from local file uploads
            const eventIds = [];
            const localFiles = [];

            PersonForm._selectedPhotos.forEach(p => {
                if (p.type === 'event' && p.eventId) {
                    if (!eventIds.includes(p.eventId)) {
                        eventIds.push(p.eventId);
                    }
                } else if (p.type === 'file' && p.file) {
                    if (!localFiles.includes(p.file)) {
                        localFiles.push(p.file);
                    }
                }
            });

            if (eventIds.length > 0) {
                formData.append('event_ids', JSON.stringify(eventIds));
            }

            localFiles.forEach(file => {
                formData.append('photos', file);
            });

            const response = await App.api('/api/persons', 'POST', formData);

            App.closeModal();
            App.toast(I18n.t('person_enrolled_success', { name }), 'success');

            // If we came from an event modal, update the cached events
            if (eventIds.length > 0) {
                eventIds.forEach(id => {
                    if (EventCard._cache[id]) {
                        EventCard._cache[id].person_name = name;
                        EventCard._cache[id].is_known = true;
                        EventCard._cache[id].person_id = response.id;
                    }
                });
            }

            // Refresh Persons page if loaded
            if (typeof PersonsPage !== 'undefined' && PersonsPage.load) {
                PersonsPage.load();
            }

            // Refresh Dashboard events if on Dashboard
            if (typeof DashboardPage !== 'undefined' && DashboardPage.loadEvents) {
                DashboardPage.loadEvents();
                if (DashboardPage.loadStats) DashboardPage.loadStats();
            }
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message }), 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                const count = PersonForm._selectedPhotos.length;
                const countDisplay = I18n.isRTL() ? I18n.toPersianDigits(count) : count;
                submitBtn.innerHTML = `<span>${I18n.t('enroll_btn_with_count', { count: countDisplay })}</span>`;
            }
        }
    },

    /**
     * Render the "Add Photos" modal for an existing person with existing photos grid & delete actions,
     * plus options to upload from device OR select from captured face snapshots.
     */
    renderAddPhotosModal(personId, personName) {
        PersonForm._currentPersonId = personId;
        PersonForm._currentPersonName = personName;
        const count = PersonForm._selectedPhotos.length;
        const countDisplay = I18n.isRTL() ? I18n.toPersianDigits(count) : count;
        const countSuffix = count > 0 ? ` (${countDisplay})` : '';

        return `
            <div class="modal-header" style="padding: 1.15rem 1.5rem; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-size: 1.4rem;">📸</span>
                    <div>
                        <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700;">${I18n.t('modal_add_photos', { name: PersonForm.escapeHtml(personName) })}</h2>
                    </div>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 1.25rem 1.5rem; max-height: 74vh; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem;">
                <!-- Section 1: Existing Photos -->
                <div class="existing-photos-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem;">
                        <label class="form-label" style="margin-bottom: 0; display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">
                            <span>🖼️</span>
                            <span id="existing-photos-title">${I18n.t('existing_photos_title', { count: '...' })}</span>
                        </label>
                        <span id="existing-photos-counter" style="font-size: 0.75rem; color: var(--text-tertiary);"></span>
                    </div>

                    <div id="existing-photos-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.65rem; min-height: 100px; max-height: 200px; overflow-y: auto; padding: 0.65rem; background: var(--bg-surface-hover); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 1.5rem 0; font-size: 0.85rem;">
                            <div class="spinner" style="width: 24px; height: 24px; margin: 0 auto 0.5rem auto;"></div>
                            ${I18n.t('loading')}
                        </div>
                    </div>
                </div>

                <!-- Section 2: Selected Photos Preview Strip -->
                <div class="add-new-photos-section" style="border-top: 1px solid var(--border-subtle); padding-top: 1.1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem;">
                        <label class="form-label" style="margin-bottom: 0; display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">
                            <span>➕</span>
                            <span>${I18n.t('selected_new_photos_title')}</span>
                        </label>
                        <span id="selected-photos-badge" style="font-size: 0.75rem; color: var(--accent-blue); background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.2rem 0.6rem; border-radius: 12px; font-weight: 700;">
                            ${I18n.t('selected_photos_count', { count: countDisplay })}
                        </span>
                    </div>

                    <div id="upload-preview" style="display: flex; flex-wrap: wrap; gap: 0.65rem; min-height: 76px; max-height: 160px; overflow-y: auto; padding: 0.45rem; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); border: 1px dashed var(--border-subtle); align-items: center; margin-bottom: 1rem;"></div>

                    <!-- Source Selector: Snapshots vs Device Upload -->
                    <div style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); overflow: hidden;">
                        <div style="display: flex; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-hover);">
                            <button
                                type="button"
                                id="btn-tab-unknown"
                                onclick="PersonForm.switchPhotoTab('unknown')"
                                style="flex: 1; padding: 0.75rem 1rem; border: none; background: transparent; font-size: 0.83rem; font-weight: 700; cursor: pointer; color: var(--accent-blue); border-bottom: 2px solid var(--accent-blue); display: flex; align-items: center; justify-content: center; gap: 0.45rem; transition: all 0.15s ease;"
                            >
                                <span>📸</span>
                                <span>${I18n.t('select_from_snapshots')}</span>
                            </button>
                            <button
                                type="button"
                                id="btn-tab-upload"
                                onclick="PersonForm.switchPhotoTab('upload')"
                                style="flex: 1; padding: 0.75rem 1rem; border: none; background: transparent; font-size: 0.83rem; font-weight: 600; cursor: pointer; color: var(--text-tertiary); border-bottom: 2px solid transparent; display: flex; align-items: center; justify-content: center; gap: 0.45rem; transition: all 0.15s ease;"
                            >
                                <span>📁</span>
                                <span>${I18n.t('photos_from_device')}</span>
                            </button>
                        </div>

                        <!-- Panel A: Snapshots Picker -->
                        <div id="panel-unknown-logs" style="padding: 0.85rem; display: block;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem; gap: 0.5rem; flex-wrap: wrap;">
                                <div style="display: flex; gap: 0.45rem; align-items: center; flex: 1; min-width: 220px; flex-wrap: wrap;">
                                    <select id="unknown-type-filter" class="form-input" onchange="PersonForm.onSnapshotTypeFilterChange(this.value)" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; height: 30px; width: auto; min-width: 140px;">
                                        <option value="unknown">${I18n.t('filter_unknown_only')}</option>
                                        <option value="person">${I18n.t('filter_person_only')}</option>
                                        <option value="all">${I18n.t('filter_all_snapshots')}</option>
                                    </select>
                                    <select id="unknown-camera-filter" class="form-input" onchange="PersonForm.onCameraFilterChange(this.value)" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; height: 30px; width: auto; min-width: 120px;">
                                        <option value="">${I18n.t('filter_by_camera')}</option>
                                    </select>
                                </div>
                                <button type="button" class="btn btn-xs btn-secondary" onclick="PersonForm.loadUnknownLogs(true)" title="Refresh" style="height: 30px; padding: 0 0.55rem;">
                                    🔄
                                </button>
                            </div>

                            <div id="unknown-logs-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 0.55rem; max-height: 220px; overflow-y: auto; padding: 0.55rem; background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
                                <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 1.5rem 0; font-size: 0.8rem;">
                                    <div class="spinner" style="width: 22px; height: 22px; margin: 0 auto 0.4rem auto;"></div>
                                    ${I18n.t('loading')}
                                </div>
                            </div>

                            <div id="unknown-logs-load-more" style="text-align: center; margin-top: 0.6rem; display: none;">
                                <button type="button" class="btn btn-xs btn-secondary" onclick="PersonForm.loadMoreUnknownLogs()" style="font-size: 0.72rem; padding: 0.25rem 0.8rem;">
                                    ⬇️ ${I18n.t('load_more_logs')}
                                </button>
                            </div>
                        </div>

                        <!-- Panel B: Local Device File Upload -->
                        <div id="panel-device-upload" style="padding: 1.15rem; display: none;">
                            <div
                                class="upload-zone"
                                id="upload-zone"
                                onclick="document.getElementById('photo-input').click()"
                                ondragover="PersonForm.handleDragOver(event)"
                                ondragleave="PersonForm.handleDragLeave(event)"
                                ondrop="PersonForm.handleDrop(event)"
                                style="padding: 1.25rem 1rem;"
                            >
                                <div class="upload-zone-icon" style="font-size: 2rem; margin-bottom: 0.35rem;">📸</div>
                                <div class="upload-zone-text" style="font-size: 0.88rem;">${I18n.t('upload_drag_text')}</div>
                                <div class="upload-zone-hint" style="font-size: 0.75rem; margin-top: 0.25rem;">${I18n.t('upload_hint_2')}</div>
                            </div>
                            <input
                                type="file"
                                id="photo-input"
                                accept="image/*"
                                multiple
                                hidden
                                onchange="PersonForm.handleFileSelect(event)"
                            />
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-top: 1px solid var(--border-subtle);">
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('close')}</button>
                <button class="btn btn-primary" type="button" onclick="PersonForm.handleAddPhotos(event, ${personId})" id="btn-submit-photos">
                    <span>⬆️</span>
                    <span>${I18n.t('btn_add_photos')}${countSuffix}</span>
                </button>
            </div>
        `;
    },

    /**
     * Initialize modal state after rendering Add Photos modal.
     */
    async initAddPhotosModalState(personId) {
        PersonForm.updatePreview();
        await PersonForm.loadExistingPhotos(personId);
        await PersonForm.populateCameraDropdown();
        PersonForm.loadUnknownLogs(true);
    },

    /**
     * Entrypoint to show Add Photos modal for an existing person.
     */
    showAddPhotosModal(personId, personName) {
        PersonForm.reset();
        PersonForm._currentPersonId = personId;
        PersonForm._currentPersonName = personName;
        App.openModal(PersonForm.renderAddPhotosModal(personId, personName), 'modal-lg');
        PersonForm.initAddPhotosModalState(personId);
    },

    /**
     * Load existing reference photos for a person into the modal.
     */
    async loadExistingPhotos(personId) {
        const grid = document.getElementById('existing-photos-grid');
        const titleEl = document.getElementById('existing-photos-title');
        const counterEl = document.getElementById('existing-photos-counter');
        if (!grid) return;

        try {
            const photos = await App.api(`/api/persons/${personId}/photos`);
            const countStr = I18n.isRTL() ? I18n.toPersianDigits(photos.length) : photos.length;

            if (titleEl) {
                titleEl.textContent = I18n.t('existing_photos_title', { count: countStr });
            }
            if (counterEl) {
                counterEl.textContent = I18n.t('photos_remaining_count', { count: countStr });
            }

            if (photos.length === 0) {
                grid.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 2rem 1rem; font-size: 0.85rem;">
                        <span style="font-size: 1.8rem; display: block; margin-bottom: 0.4rem; opacity: 0.7;">🖼️</span>
                        ${I18n.t('no_existing_photos')}
                    </div>
                `;
                return;
            }

            const isRtl = I18n.isRTL();
            grid.innerHTML = photos.map((photo, idx) => {
                const photoNum = isRtl ? I18n.toPersianDigits(idx + 1) : (idx + 1);
                return `
                    <div class="existing-photo-card" id="photo-card-${photo.id}" style="position: relative; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-subtle); background: #0c1020; aspect-ratio: 1; box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: transform 0.15s ease, border-color 0.15s ease;">
                        <img 
                            src="${photo.url}" 
                            alt="Reference Photo #${photoNum}" 
                            style="width: 100%; height: 100%; object-fit: cover; display: block;" 
                            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23161f36%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23545d78%22 font-size=%2212%22>No Image</text></svg>'"
                        />
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.75)); padding: 4px 6px; font-size: 0.65rem; color: #fff; display: flex; justify-content: space-between; align-items: center;">
                            <span>#${photoNum}</span>
                        </div>
                        <button 
                            type="button"
                            class="btn-delete-photo"
                            onclick="PersonForm.deletePhoto(${personId}, ${photo.id})"
                            title="${PersonForm.escapeAttr(I18n.t('btn_delete_photo'))}"
                            style="position: absolute; top: 5px; ${isRtl ? 'left' : 'right'}: 5px; width: 26px; height: 26px; border-radius: var(--radius-sm); border: none; background: rgba(225, 29, 72, 0.85); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; box-shadow: 0 2px 6px rgba(0,0,0,0.5); transition: background 0.15s ease, transform 0.15s ease;"
                            onmouseover="this.style.background='#e11d48'; this.style.transform='scale(1.1)';"
                            onmouseout="this.style.background='rgba(225, 29, 72, 0.85)'; this.style.transform='scale(1)';"
                        >
                            🗑️
                        </button>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Failed to load existing photos:', err);
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; color: var(--accent-rose); padding: 1.5rem; font-size: 0.85rem;">
                    ${err.message || 'Failed to load photos'}
                </div>
            `;
        }
    },

    /**
     * Delete a specific reference photo.
     */
    async deletePhoto(personId, photoId) {
        if (!confirm(I18n.t('delete_photo_confirm'))) {
            return;
        }

        const card = document.getElementById(`photo-card-${photoId}`);
        if (card) {
            card.style.opacity = '0.4';
            card.style.pointerEvents = 'none';
        }

        try {
            App.toast(I18n.t('loading'), 'info');
            await App.api(`/api/persons/${personId}/photos/${photoId}`, 'DELETE');
            App.toast(I18n.t('photo_deleted_success'), 'success');
            await PersonForm.loadExistingPhotos(personId);
        } catch (err) {
            if (card) {
                card.style.opacity = '1';
                card.style.pointerEvents = 'auto';
            }
            App.toast(I18n.t('err_generic', { msg: err.message }), 'error');
        }
    },

    /**
     * Handle adding photos to an existing person.
     */
    async handleAddPhotos(event, personId) {
        if (event && event.preventDefault) {
            event.preventDefault();
        }

        if (PersonForm._selectedPhotos.length === 0 && PersonForm._selectedFiles.length === 0) {
            App.toast(I18n.t('err_select_photo'), 'error');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-photos');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>⏳</span> <span>${I18n.t('loading')}</span>`;
        }

        const formData = new FormData();
        const eventIds = [];
        const localFiles = [];

        PersonForm._selectedPhotos.forEach(p => {
            if (p.type === 'event' && p.eventId) {
                if (!eventIds.includes(p.eventId)) {
                    eventIds.push(p.eventId);
                }
            } else if (p.type === 'file' && p.file) {
                if (!localFiles.includes(p.file)) {
                    localFiles.push(p.file);
                }
            }
        });

        if (eventIds.length > 0) {
            formData.append('event_ids', JSON.stringify(eventIds));
        }
        localFiles.forEach(file => {
            formData.append('photos', file);
        });

        try {
            App.toast(I18n.t('processing_photos'), 'info');

            await App.api(`/api/persons/${personId}/photos`, 'POST', formData);

            // Update cached events
            if (eventIds.length > 0) {
                eventIds.forEach(id => {
                    if (EventCard._cache[id]) {
                        EventCard._cache[id].person_name = PersonForm._currentPersonName || '';
                        EventCard._cache[id].is_known = true;
                        EventCard._cache[id].person_id = personId;
                    }
                });
            }

            // Clear selected photos for the next batch
            PersonForm._selectedPhotos = [];
            PersonForm._selectedFiles = [];
            PersonForm.updatePreview();

            App.toast(I18n.t('photos_added_success'), 'success');

            // Refresh existing photos in modal
            await PersonForm.loadExistingPhotos(personId);

            // Refresh snapshot grid
            PersonForm.loadUnknownLogs(true);

            // Also reload persons in background to keep stats updated
            if (typeof PersonsPage !== 'undefined' && PersonsPage.loadPersons) {
                PersonsPage.loadPersons();
            }

            // Refresh Dashboard events if on Dashboard
            if (typeof DashboardPage !== 'undefined' && DashboardPage.loadEvents) {
                DashboardPage.loadEvents();
                if (DashboardPage.loadStats) DashboardPage.loadStats();
            }
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message }), 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                const count = PersonForm._selectedPhotos.length;
                const countDisplay = I18n.isRTL() ? I18n.toPersianDigits(count) : count;
                const countSuffix = count > 0 ? ` (${countDisplay})` : '';
                submitBtn.innerHTML = `<span>⬆️</span> <span>${I18n.t('btn_add_photos')}${countSuffix}</span>`;
            }
        }
    },

    /**
     * Reset form state.
     */
    reset() {
        PersonForm._selectedPhotos = [];
        PersonForm._selectedFiles = [];
        PersonForm._relatedEvents = [];
        PersonForm._allUnknownLogs = [];
        PersonForm._fromEvent = false;
        PersonForm._primaryEvent = null;
        PersonForm._unknownLogsOffset = 0;
        PersonForm._hasMoreUnknownLogs = true;
        PersonForm._isLoadingUnknownLogs = false;
        PersonForm._currentPersonId = null;
        PersonForm._currentPersonName = null;
        PersonForm._activeTab = 'unknown';
    },

    /**
     * Escape HTML.
     */
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
