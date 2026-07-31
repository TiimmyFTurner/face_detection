/**
 * Cameras Page — Camera management with add/edit/delete/test.
 */
const CamerasPage = {
    _cameras: [],

    /**
     * Load and render the cameras management page.
     */
    async load() {
        document.getElementById('page-title').textContent = 'Camera Management';
        document.getElementById('header-actions').innerHTML = `
            <button class="btn btn-primary" onclick="CamerasPage.showAddModal()">
                ＋ Add Camera
            </button>
        `;

        const body = document.getElementById('content-body');
        body.innerHTML = `
            <div class="cameras-grid" id="cameras-grid">
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⏳</div>
                    <div class="empty-state-title">Loading cameras...</div>
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
                    <div class="empty-state-title">Failed to load cameras</div>
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

        if (CamerasPage._cameras.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">📹</div>
                    <div class="empty-state-title">No cameras configured</div>
                    <div class="empty-state-text">
                        Add your first IP camera to start detecting faces.
                        Click "Add Camera" above to get started.
                    </div>
                </div>
            `;
            return;
        }

        grid.innerHTML = CamerasPage._cameras.map(camera => `
            <div class="camera-card" data-camera-id="${camera.id}">
                <div class="camera-card-header">
                    <span class="camera-name">${CamerasPage.escapeHtml(camera.name)}</span>
                    <span class="camera-status ${camera.is_active ? 'active' : 'inactive'}">
                        <span class="camera-status-dot"></span>
                        ${camera.is_active ? 'Active' : 'Inactive'}
                    </span>
                </div>

                ${camera.location ? `
                    <div class="camera-detail">
                        <span class="detail-icon">📍</span>
                        <span>${CamerasPage.escapeHtml(camera.location)}</span>
                    </div>
                ` : ''}

                <div class="camera-url" title="${CamerasPage.escapeAttr(camera.rtsp_url)}">
                    ${CamerasPage.escapeHtml(CamerasPage.maskUrl(camera.rtsp_url))}
                </div>

                <div class="camera-detail">
                    <span class="detail-icon">🕐</span>
                    <span>Added ${CamerasPage.formatDate(camera.created_at)}</span>
                </div>

                <div class="camera-actions">
                    <button class="btn btn-secondary btn-sm" onclick="CamerasPage.testCamera(${camera.id})">
                        ⚡ Test
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="CamerasPage.showEditModal(${camera.id})">
                        ✏️ Edit
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="CamerasPage.deleteCamera(${camera.id}, '${CamerasPage.escapeAttr(camera.name)}')">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `).join('');
    },

    /**
     * Show add camera modal.
     */
    showAddModal() {
        App.openModal(CameraForm.renderModal());
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
        App.toast('Testing connection...', 'info');
        try {
            const result = await App.api(`/api/cameras/${cameraId}/test`, 'POST');
            if (result.success) {
                App.toast('✅ Camera connection successful!', 'success');
            } else {
                App.toast(`❌ ${result.message}`, 'error');
            }
        } catch (err) {
            App.toast(`Test failed: ${err.message}`, 'error');
        }
    },

    /**
     * Delete a camera after confirmation.
     */
    async deleteCamera(cameraId, name) {
        if (!confirm(`Delete camera "${name}"? This will stop its stream and remove all settings.`)) {
            return;
        }

        try {
            await App.api(`/api/cameras/${cameraId}`, 'DELETE');
            App.toast(`Camera "${name}" deleted.`, 'success');
            await CamerasPage.loadCameras();
        } catch (err) {
            App.toast(`Failed to delete: ${err.message}`, 'error');
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
        try {
            return new Date(isoString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            });
        } catch {
            return isoString;
        }
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
