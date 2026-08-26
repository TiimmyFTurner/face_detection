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
        const title = isEdit ? I18n.t('modal_edit_camera') : I18n.t('modal_add_camera');
        const submitText = isEdit ? I18n.t('save_changes') : I18n.t('add_camera_btn');

        return `
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="camera-form" onsubmit="CameraForm.handleSubmit(event, ${isEdit ? camera.id : 'null'})">
                    <div class="form-group">
                        <label class="form-label" for="camera-name">${I18n.t('label_camera_name')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="camera-name"
                            name="name"
                            placeholder="${CameraForm.escapeAttr(I18n.t('placeholder_camera_name'))}"
                            value="${isEdit ? CameraForm.escapeAttr(camera.name) : ''}"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="camera-url">${I18n.t('label_rtsp_url')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="camera-url"
                            name="rtsp_url"
                            placeholder="${CameraForm.escapeAttr(I18n.t('placeholder_rtsp_url'))}"
                            value="${isEdit ? CameraForm.escapeAttr(camera.rtsp_url) : ''}"
                            required
                            dir="ltr"
                            style="text-align: left;"
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="camera-location">${I18n.t('label_location')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="camera-location"
                            name="location"
                            placeholder="${CameraForm.escapeAttr(I18n.t('placeholder_location'))}"
                            value="${isEdit ? CameraForm.escapeAttr(camera.location || '') : ''}"
                        />
                    </div>
                    <div class="form-group" style="display: flex; align-items: center; gap: 12px;">
                        <label class="form-label" style="margin-bottom: 0;">${I18n.t('label_active')}</label>
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
                    ${I18n.t('btn_test_connection')}
                </button>
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel')}</button>
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
            App.toast(I18n.t('err_enter_name'), 'error');
            return;
        }

        try {
            if (cameraId) {
                await App.api(`/api/cameras/${cameraId}`, 'PUT', data);
                App.toast(I18n.t('camera_saved_success'), 'success');
            } else {
                await App.api('/api/cameras', 'POST', data);
                App.toast(I18n.t('camera_added_success'), 'success');
            }

            App.closeModal();
            CamerasPage.load();
        } catch (err) {
            App.toast(I18n.t('err_failed_save', { msg: err.message }), 'error');
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
            App.toast(I18n.t('placeholder_rtsp_url'), 'error');
            return;
        }

        App.toast(I18n.t('testing_connection'), 'info');

        try {
            const result = await App.api('/api/cameras/test-url', 'POST', {
                name: 'Test',
                rtsp_url: url,
            });

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
