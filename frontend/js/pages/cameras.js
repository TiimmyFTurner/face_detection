/**
 * Cameras Page — Camera management with add/edit/delete/test.
 */
const CamerasPage = {
    _cameras: [],
    _viewMode: localStorage.getItem('facetrack_view_cameras') || 'grid',

    /**
     * Set view mode ('grid' or 'list') and update UI.
     */
    setViewMode(mode) {
        CamerasPage._viewMode = mode;
        try {
            localStorage.setItem('facetrack_view_cameras', mode);
        } catch (e) {}

        const gridBtn = document.getElementById('cameras-view-grid');
        const listBtn = document.getElementById('cameras-view-list');
        if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
        if (listBtn) listBtn.classList.toggle('active', mode === 'list');
        CamerasPage.renderCameras();
    },

    /**
     * Load and render the cameras management page.
     */
    async load() {
        document.getElementById('page-title').textContent = I18n.t('cameras_title');
        document.getElementById('header-actions').innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div class="view-toggle-group" role="group" aria-label="View mode">
                    <button class="view-toggle-btn ${CamerasPage._viewMode === 'grid' ? 'active' : ''}" 
                            id="cameras-view-grid" 
                            onclick="CamerasPage.setViewMode('grid')" 
                            title="${I18n.t('view_grid')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>
                        <span>${I18n.t('view_grid')}</span>
                    </button>
                    <button class="view-toggle-btn ${CamerasPage._viewMode === 'list' ? 'active' : ''}" 
                            id="cameras-view-list" 
                            onclick="CamerasPage.setViewMode('list')" 
                            title="${I18n.t('view_list')}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                        <span>${I18n.t('view_list')}</span>
                    </button>
                </div>
                <button class="btn btn-primary" onclick="CamerasPage.showAddModal()">
                    ${I18n.t('add_camera_btn')}
                </button>
            </div>
        `;

        const body = document.getElementById('content-body');
        body.innerHTML = `
            <div class="cameras-grid ${CamerasPage._viewMode === 'list' ? 'list-view' : ''}" id="cameras-grid">
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⏳</div>
                    <div class="empty-state-title">${I18n.t('loading_cameras')}</div>
                </div>
            </div>
        `;

        await CamerasPage.loadCameras();
    },

    /**
     * Fetch and render all cameras.
     */
    async loadCameras() {
        try {
            CamerasPage._cameras = await App.api('/api/cameras');
            CamerasPage.renderCameras();
        } catch (err) {
            console.error('Failed to load cameras:', err);
            document.getElementById('cameras-grid').innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-title">${I18n.t('test_failed')}</div>
                    <div class="empty-state-text">${err.message}</div>
                </div>
            `;
        }
    },

    /**
     * Render camera cards.
     */
    renderCameras() {
        const grid = document.getElementById('cameras-grid');
        if (!grid) return;

        grid.classList.toggle('list-view', CamerasPage._viewMode === 'list');

        if (CamerasPage._cameras.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">📹</div>
                    <div class="empty-state-title">${I18n.t('no_cameras_title')}</div>
                    <div class="empty-state-text">
                        ${I18n.t('no_cameras_desc')}
                    </div>
                </div>
            `;
            return;
        }

        grid.innerHTML = CamerasPage._cameras.map(camera => {
            let statusText = I18n.t('inactive');
            let statusClass = 'inactive';
            if (camera.is_active) {
                if (camera.is_online) {
                    statusText = I18n.t('online');
                    statusClass = 'online';
                } else {
                    statusText = I18n.t('disconnected');
                    statusClass = 'disconnected';
                }
            }
            const addedDateStr = I18n.formatDate(camera.created_at);

            if (CamerasPage._viewMode === 'list') {
                return `
                    <div class="camera-card list-item" data-camera-id="${camera.id}">
                        <div class="camera-card-header">
                            <span class="camera-status ${statusClass}">
                                <span class="camera-status-dot"></span>
                            </span>
                            <div>
                                <span class="camera-name" style="display: block;">${CamerasPage.escapeHtml(camera.name)}</span>
                                ${camera.location ? `<span style="font-size: 0.75rem; color: var(--text-tertiary);">📍 ${CamerasPage.escapeHtml(camera.location)}</span>` : ''}
                            </div>
                        </div>

                        <div class="camera-list-details">
                            <span class="camera-status ${statusClass}" style="background: rgba(255,255,255,0.04); padding: 3px 8px; border-radius: 4px; font-size: 0.72rem;">
                                ${statusText}
                            </span>
                            <span dir="ltr" style="font-family: monospace; font-size: 0.78rem; color: var(--text-tertiary); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${CamerasPage.escapeAttr(camera.rtsp_url)}">
                                ${CamerasPage.escapeHtml(CamerasPage.maskUrl(camera.rtsp_url))}
                            </span>
                            <span style="font-size: 0.75rem; color: var(--text-tertiary);">🕐 ${addedDateStr}</span>
                        </div>

                        <div class="camera-actions-wrapper">
                            <div class="camera-actions-primary">
                                <button class="btn btn-primary btn-sm" onclick="CamerasPage.showLiveModal(${camera.id})" title="${CamerasPage.escapeAttr(I18n.t('camera_live_stream'))}">
                                    <span>👁️</span> <span>${I18n.t('camera_live_stream')}</span>
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="ZoneModal.show(${camera.id})" title="${CamerasPage.escapeAttr(I18n.t('camera_zones_btn'))}" style="background: rgba(59, 130, 246, 0.12); border-color: rgba(59, 130, 246, 0.35); color: var(--accent-blue);">
                                    <span>🎯</span> <span>${I18n.t('camera_zones_btn')}</span>
                                </button>
                            </div>
                            <div class="camera-actions-secondary">
                                <button class="btn btn-secondary btn-sm" onclick="CamerasPage.testCamera(${camera.id})" title="${CamerasPage.escapeAttr(I18n.t('btn_test_connection'))}">
                                    ${I18n.t('camera_test_btn')}
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="CamerasPage.showEditModal(${camera.id})" title="${CamerasPage.escapeAttr(I18n.t('camera_edit_btn'))}">
                                    ${I18n.t('camera_edit_btn')}
                                </button>
                                <button class="btn btn-danger btn-sm" onclick="CamerasPage.deleteCamera(${camera.id}, '${CamerasPage.escapeAttr(camera.name)}')" title="${CamerasPage.escapeAttr(I18n.t('delete'))}">
                                    🗑️
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="camera-card" data-camera-id="${camera.id}">
                    <div class="camera-card-header">
                        <span class="camera-name">${CamerasPage.escapeHtml(camera.name)}</span>
                        <span class="camera-status ${statusClass}">
                            <span class="camera-status-dot"></span>
                            ${statusText}
                        </span>
                    </div>

                    ${camera.location ? `
                        <div class="camera-detail">
                            <span class="detail-icon">📍</span>
                            <span>${I18n.t('camera_location')} <strong>${CamerasPage.escapeHtml(camera.location)}</strong></span>
                        </div>
                    ` : ''}

                    <div class="camera-url" dir="ltr" style="text-align: left;" title="${CamerasPage.escapeAttr(camera.rtsp_url)}">
                        ${CamerasPage.escapeHtml(CamerasPage.maskUrl(camera.rtsp_url))}
                    </div>

                    <div class="camera-detail">
                        <span class="detail-icon">🕐</span>
                        <span>${I18n.t('camera_added', { date: addedDateStr })}</span>
                    </div>

                    <div class="camera-actions-wrapper">
                        <div class="camera-actions-primary">
                            <button class="btn btn-primary btn-sm" onclick="CamerasPage.showLiveModal(${camera.id})" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
                                <span>👁️</span> <span>${I18n.t('camera_live_stream')}</span>
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="ZoneModal.show(${camera.id})" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem; background: rgba(59, 130, 246, 0.12); border-color: rgba(59, 130, 246, 0.35); color: var(--accent-blue);">
                                <span>🎯</span> <span>${I18n.t('camera_zones_btn')}</span>
                            </button>
                        </div>
                        <div class="camera-actions-secondary">
                            <button class="btn btn-secondary btn-sm" onclick="CamerasPage.testCamera(${camera.id})" title="${CamerasPage.escapeAttr(I18n.t('btn_test_connection'))}" style="flex: 1; font-size: 0.75rem; padding: 0.4rem 0.5rem; justify-content: center;">
                                ${I18n.t('camera_test_btn')}
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="CamerasPage.showEditModal(${camera.id})" title="${CamerasPage.escapeAttr(I18n.t('camera_edit_btn'))}" style="flex: 1; font-size: 0.75rem; padding: 0.4rem 0.5rem; justify-content: center;">
                                ${I18n.t('camera_edit_btn')}
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="CamerasPage.deleteCamera(${camera.id}, '${CamerasPage.escapeAttr(camera.name)}')" title="${CamerasPage.escapeAttr(I18n.t('delete'))}" style="padding: 0.4rem 0.65rem; justify-content: center;">
                                🗑️
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Show live camera stream / picture modal.
     */
    showLiveModal(cameraId) {
        const camera = CamerasPage._cameras.find(c => c.id === cameraId);
        if (!camera) return;

        const tokenParam = (typeof Auth !== 'undefined' && Auth.getToken()) ? `&token=${encodeURIComponent(Auth.getToken())}` : '';
        const streamUrl = `/api/cameras/${camera.id}/stream?t=${Date.now()}${tokenParam}`;
        const snapshotUrl = `/api/cameras/${camera.id}/snapshot?t=${Date.now()}${tokenParam}`;
        let liveStatusText = I18n.t('inactive');
        let liveStatusClass = 'inactive';
        if (camera.is_active) {
            if (camera.is_online) {
                liveStatusText = I18n.t('live');
                liveStatusClass = 'online';
            } else {
                liveStatusText = I18n.t('disconnected');
                liveStatusClass = 'disconnected';
            }
        }

        const isOffline = camera.is_active && !camera.is_online;

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">📹 ${CamerasPage.escapeHtml(camera.name)}</h2>
                    <span class="camera-status ${liveStatusClass}">
                        <span class="camera-status-dot"></span>
                        ${liveStatusText}
                    </span>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem;">
                ${isOffline ? `
                    <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.35); border-radius: 8px; padding: 0.6rem 0.9rem; margin-bottom: 0.75rem; font-size: 0.82rem; color: #facc15; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <span>⚠️</span>
                            <span>${I18n.isRTL() ? 'ارتباط با دوربین قطع است یا دوربین در دسترس نیست. سیستم در حال تلاش برای اتصال خودکار می‌باشد.' : 'Camera is currently offline or unreachable. System is trying to reconnect automatically.'}</span>
                        </div>
                        <button id="btn-test-live-modal" class="btn btn-secondary btn-sm" onclick="CamerasPage.testFromLiveModal(${camera.id})" style="padding: 4px 10px; font-size: 0.75rem; white-space: nowrap;">
                            🔍 ${I18n.isRTL() ? 'بررسی اتصال RTSP' : 'Check RTSP Connection'}
                        </button>
                    </div>
                ` : ''}

                ${camera.location ? `
                    <div style="color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span>📍</span>
                        <span>${I18n.t('camera_location')} <strong>${CamerasPage.escapeHtml(camera.location)}</strong></span>
                    </div>
                ` : ''}

                <div class="camera-live-feed-wrapper">
                    <img id="camera-live-img" 
                         src="${streamUrl}" 
                         alt="${CamerasPage.escapeAttr(camera.name)}"
                         onerror="CamerasPage.handleStreamError(${camera.id})"
                    />
                </div>
            </div>

            <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="CamerasPage.refreshLiveFeed(${camera.id})">
                        ${I18n.t('refresh_snapshot')}
                    </button>
                    <a href="${snapshotUrl}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;">
                        ${I18n.t('full_resolution')}
                    </a>
                </div>
                <button class="btn btn-primary" onclick="App.closeModal()">${I18n.t('close')}</button>
            </div>
        `;

        App.openModal(content, 'modal-lg');
    },

    /**
     * Test connection from inside live modal.
     */
    async testFromLiveModal(cameraId) {
        const btn = document.getElementById('btn-test-live-modal');
        if (btn) btn.disabled = true;
        try {
            App.showToast(I18n.isRTL() ? 'در حال بررسی اتصال به دوربین...' : 'Testing camera stream...', 'info');
            const res = await App.api(`/api/cameras/${cameraId}/test`, 'POST');
            if (res.success) {
                App.showToast(I18n.isRTL() ? 'اتصال برقرار شد!' : 'Connected successfully!', 'success');
                CamerasPage.refreshLiveFeed(cameraId);
            } else {
                App.showToast(res.message || (I18n.isRTL() ? 'دوربین در دسترس نیست.' : 'Camera is unreachable.'), 'error');
            }
        } catch (err) {
            App.showToast(err.message || 'Connection error', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    /**
     * Refresh snapshot image in live modal.
     */
    refreshLiveFeed(cameraId) {
        const img = document.getElementById('camera-live-img');
        if (img) {
            const tokenParam = (typeof Auth !== 'undefined' && Auth.getToken()) ? `&token=${encodeURIComponent(Auth.getToken())}` : '';
            img.src = `/api/cameras/${cameraId}/snapshot?t=${Date.now()}${tokenParam}`;
        }
    },

    /**
     * Fallback if MJPEG stream drops.
     */
    handleStreamError(cameraId) {
        const img = document.getElementById('camera-live-img');
        if (img) {
            console.warn(`Stream error for camera ${cameraId}, falling back to snapshot.`);
            const tokenParam = (typeof Auth !== 'undefined' && Auth.getToken()) ? `&token=${encodeURIComponent(Auth.getToken())}` : '';
            img.src = `/api/cameras/${cameraId}/snapshot?t=${Date.now()}${tokenParam}`;
        }
    },

    /**
     * Show add camera modal.
     */
    showAddModal() {
        CameraForm._activeTab = 'direct';
        CameraForm._batchInputMode = 'paste';
        CameraForm._parsedBatchCameras = [];
        App.openModal(CameraForm.renderModal(), 'modal-md');
    },

    /**
     * Show edit camera modal.
     */
    showEditModal(cameraId) {
        const camera = CamerasPage._cameras.find(c => c.id === cameraId);
        if (camera) {
            App.openModal(CameraForm.renderModal(camera));
        }
    },

    /**
     * Test camera connection.
     */
    async testCamera(cameraId) {
        App.toast(I18n.t('testing_connection'), 'info');
        try {
            const result = await App.api(`/api/cameras/${cameraId}/test`, 'POST');
            if (result.success) {
                App.toast(I18n.t('test_success'), 'success');
            } else {
                App.toast(`❌ ${result.message}`, 'error');
            }
        } catch (err) {
            App.toast(`${I18n.t('test_failed')}: ${err.message}`, 'error');
        }
    },

    /**
     * Delete a camera after confirmation.
     */
    async deleteCamera(cameraId, name) {
        if (!confirm(I18n.t('confirm_delete_camera', { name }))) {
            return;
        }

        try {
            await App.api(`/api/cameras/${cameraId}`, 'DELETE');
            App.toast(I18n.t('camera_deleted_toast', { name }), 'success');
            await CamerasPage.loadCameras();
        } catch (err) {
            App.toast(I18n.t('err_failed_delete', { msg: err.message }), 'error');
        }
    },

    /**
     * Mask credentials in RTSP URL for display.
     */
    maskUrl(url) {
        try {
            return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
        } catch {
            return url;
        }
    },

    /**
     * Format a date string.
     */
    formatDate(isoString) {
        return I18n.formatDate(isoString);
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
