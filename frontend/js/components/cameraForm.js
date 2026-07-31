/**
 * CameraForm component — modal forms for adding/editing cameras.
 */
const CameraForm = {
    /**
     * Render the "Add Camera" modal content.
     * @param {Object|null} camera - Existing camera data for editing, or null for new.
     * @returns {string} HTML string for modal content.
     */
    renderModal(camera = null) {
        const isEdit = camera !== null;
        const title = isEdit ? 'Edit Camera' : 'Add Camera';
        const submitText = isEdit ? 'Save Changes' : 'Add Camera';

        return `
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="camera-form" onsubmit="CameraForm.handleSubmit(event, ${isEdit ? camera.id : 'null'})">
                    <div class="form-group">
                        <label class="form-label" for="camera-name">Camera Name</label>
                        <input
                            class="form-input"
                            type="text"
                            id="camera-name"
                            name="name"
                            placeholder="e.g., Front Door Camera"
                            value="${isEdit ? CameraForm.escapeAttr(camera.name) : ''}"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="camera-url">RTSP URL</label>
                        <input
                            class="form-input"
                            type="text"
                            id="camera-url"
                            name="rtsp_url"
                            placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                            value="${isEdit ? CameraForm.escapeAttr(camera.rtsp_url) : ''}"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="camera-location">Location</label>
                        <input
                            class="form-input"
                            type="text"
                            id="camera-location"
                            name="location"
                            placeholder="e.g., Main Entrance, Parking Lot"
                            value="${isEdit ? CameraForm.escapeAttr(camera.location || '') : ''}"
                        />
                    </div>
                    <div class="form-group" style="display: flex; align-items: center; gap: 12px;">
                        <label class="form-label" style="margin-bottom: 0;">Active</label>
                        <button
                            type="button"
                            class="toggle ${isEdit ? (camera.is_active ? 'active' : '') : 'active'}"
                            id="camera-active-toggle"
                            onclick="CameraForm.toggleActive(this)"
                        >
                            <span class="toggle-knob"></span>
                        </button>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="CameraForm.testConnection()">
                    ⚡ Test Connection
                </button>
                <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" type="submit" form="camera-form">
                    ${submitText}
                </button>
            </div>
        `;
    },

    /**
     * Handle camera form submission.
     */
    async handleSubmit(e, cameraId) {
        e.preventDefault();

        const form = document.getElementById('camera-form');
        const toggle = document.getElementById('camera-active-toggle');

        const data = {
            name: form.querySelector('[name="name"]').value.trim(),
            rtsp_url: form.querySelector('[name="rtsp_url"]').value.trim(),
            location: form.querySelector('[name="location"]').value.trim(),
            is_active: toggle.classList.contains('active'),
        };

        if (!data.name || !data.rtsp_url) {
            App.toast('Please fill in all required fields.', 'error');
            return;
        }

        try {
            if (cameraId) {
                await App.api(`/api/cameras/${cameraId}`, 'PUT', data);
                App.toast('Camera updated successfully!', 'success');
            } else {
                await App.api('/api/cameras', 'POST', data);
                App.toast('Camera added successfully!', 'success');
            }

            App.closeModal();
            CamerasPage.load();
        } catch (err) {
            App.toast(`Failed to save camera: ${err.message}`, 'error');
        }
    },

    /**
     * Toggle the active state button.
     */
    toggleActive(btn) {
        btn.classList.toggle('active');
    },

    /**
     * Test the RTSP connection from the form.
     */
    async testConnection() {
        const url = document.getElementById('camera-url').value.trim();
        if (!url) {
            App.toast('Please enter an RTSP URL first.', 'error');
            return;
        }

        App.toast('Testing connection...', 'info');

        try {
            const result = await App.api('/api/cameras/test-url', 'POST', {
                name: 'Test',
                rtsp_url: url,
            });

            if (result.success) {
                App.toast('✅ Connection successful!', 'success');
            } else {
                App.toast(`❌ ${result.message}`, 'error');
            }
        } catch (err) {
            App.toast(`Connection test failed: ${err.message}`, 'error');
        }
    },

    /**
     * Escape HTML attribute values.
     */
    escapeAttr(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },
};
