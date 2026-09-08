/**
 * CameraForm component — modal forms for adding/editing cameras.
 * Supports 3 creation modes:
 *  1. Direct RTSP Link (Original method)
 *  2. IP & Credentials RTSP Builder
 *  3. Batch Import from RTSP list (paste or .txt file)
 */
const CameraForm = {
    _activeTab: 'direct', // 'direct' | 'builder' | 'batch'
    _batchInputMode: 'paste', // 'paste' | 'range'
    _editCamera: null,
    _parsedBatchCameras: [],

    /**
     * Render the "Add Camera" or "Edit Camera" modal content.
     * @param {Object|null} camera - Existing camera data for editing, or null for new.
     * @returns {string} HTML string for modal content.
     */
    renderModal(camera = null) {
        CameraForm._editCamera = camera;
        const isEdit = camera !== null;
        const title = isEdit ? I18n.t('modal_edit_camera') : I18n.t('modal_add_camera');

        if (isEdit) {
            return `
                <div class="modal-header">
                    <h2>${title}</h2>
                    <button class="modal-close" onclick="App.closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    ${CameraForm.renderDirectForm(camera)}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" onclick="CameraForm.testConnection()">
                        ${I18n.t('btn_test_connection')}
                    </button>
                    <button class="btn btn-secondary" type="button" onclick="App.closeModal()">${I18n.t('cancel')}</button>
                    <button class="btn btn-primary" type="submit" form="camera-direct-form">
                        ${I18n.t('save_changes')}
                    </button>
                </div>
            `;
        }

        // Add Mode: Multi-tab layout
        return `
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding-top: 1rem;">
                ${CameraForm.renderNavTabs()}
                <div id="camera-tab-content">
                    ${CameraForm.renderCurrentTabContent()}
                </div>
            </div>
            <div class="modal-footer" id="camera-modal-footer">
                ${CameraForm.renderCurrentTabFooter()}
            </div>
        `;
    },

    /**
     * Render navigation segmented tabs for Add Camera modal.
     */
    renderNavTabs() {
        const tabs = [
            { id: 'direct', label: I18n.t('tab_camera_direct'), icon: '🔗' },
            { id: 'builder', label: I18n.t('tab_camera_builder'), icon: '🛠️' },
            { id: 'batch', label: I18n.t('tab_camera_batch'), icon: '📋' },
        ];

        return `
            <div class="modal-nav-tabs" role="tablist">
                ${tabs.map(tab => `
                    <button 
                        type="button"
                        class="modal-nav-tab ${CameraForm._activeTab === tab.id ? 'active' : ''}" 
                        onclick="CameraForm.switchTab('${tab.id}')"
                        role="tab"
                        aria-selected="${CameraForm._activeTab === tab.id}"
                    >
                        <span>${tab.icon}</span>
                        <span>${tab.label}</span>
                    </button>
                `).join('')}
            </div>
        `;
    },

    /**
     * Switch current tab.
     */
    switchTab(tabId) {
        CameraForm._activeTab = tabId;
        const container = document.getElementById('camera-tab-content');
        const footer = document.getElementById('camera-modal-footer');
        const tabBtns = document.querySelectorAll('.modal-nav-tab');

        tabBtns.forEach(btn => {
            const isActive = btn.getAttribute('onclick').includes(tabId);
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive);
        });

        if (container) {
            container.innerHTML = CameraForm.renderCurrentTabContent();
        }
        if (footer) {
            footer.innerHTML = CameraForm.renderCurrentTabFooter();
        }

        if (tabId === 'builder') {
            CameraForm.updateBuilderUrl();
        } else if (tabId === 'batch' && CameraForm._parsedBatchCameras.length > 0) {
            CameraForm.renderBatchTable();
        }
    },

    /**
     * Render content for active tab.
     */
    renderCurrentTabContent() {
        switch (CameraForm._activeTab) {
            case 'builder':
                return CameraForm.renderBuilderForm();
            case 'batch':
                return CameraForm.renderBatchForm();
            case 'direct':
            default:
                return CameraForm.renderDirectForm(null);
        }
    },

    /**
     * Render footer buttons for active tab.
     */
    renderCurrentTabFooter() {
        switch (CameraForm._activeTab) {
            case 'builder':
                return `
                    <button class="btn btn-secondary" type="button" onclick="CameraForm.testBuilderConnection()">
                        ${I18n.t('btn_test_connection')}
                    </button>
                    <button class="btn btn-secondary" type="button" onclick="App.closeModal()">${I18n.t('cancel')}</button>
                    <button class="btn btn-primary" type="submit" form="camera-builder-form">
                        ${I18n.t('add_camera_btn')}
                    </button>
                `;
            case 'batch':
                const count = CameraForm._parsedBatchCameras.length;
                return `
                    <button class="btn btn-secondary" type="button" onclick="App.closeModal()">${I18n.t('cancel')}</button>
                    <button class="btn btn-primary" type="button" id="batch-submit-btn" onclick="CameraForm.handleBatchSubmit()" ${count === 0 ? 'disabled' : ''}>
                        ${I18n.t('batch_import_submit', { count })}
                    </button>
                `;
            case 'direct':
            default:
                return `
                    <button class="btn btn-secondary" type="button" onclick="CameraForm.testConnection()">
                        ${I18n.t('btn_test_connection')}
                    </button>
                    <button class="btn btn-secondary" type="button" onclick="App.closeModal()">${I18n.t('cancel')}</button>
                    <button class="btn btn-primary" type="submit" form="camera-direct-form">
                        ${I18n.t('add_camera_btn')}
                    </button>
                `;
        }
    },

    /* ═══════════════════════════════════════════════════════════
       1. DIRECT RTSP METHOD (Single Camera - Original)
       ═══════════════════════════════════════════════════════════ */

    renderDirectForm(camera = null) {
        const isEdit = camera !== null;
        return `
            <form id="camera-direct-form" onsubmit="CameraForm.handleSubmit(event, ${isEdit ? camera.id : 'null'})">
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
                <div class="form-group" style="display: flex; align-items: center; gap: 12px; margin-bottom: 0;">
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
        `;
    },

    /**
     * Handle single camera direct form submission.
     */
    async handleSubmit(e, cameraId) {
        e.preventDefault();

        const form = document.getElementById('camera-direct-form');
        const toggle = document.getElementById('camera-active-toggle');

        const data = {
            name: form.querySelector('[name="name"]').value.trim(),
            rtsp_url: form.querySelector('[name="rtsp_url"]').value.trim(),
            location: form.querySelector('[name="location"]').value.trim(),
            is_active: toggle ? toggle.classList.contains('active') : true,
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

    /* ═══════════════════════════════════════════════════════════
       2. IP & CREDENTIALS BUILDER (Single Camera)
       ═══════════════════════════════════════════════════════════ */

    renderBuilderForm() {
        return `
            <form id="camera-builder-form" onsubmit="CameraForm.handleBuilderSubmit(event)">
                <div class="form-group">
                    <label class="form-label" for="builder-name">${I18n.t('label_camera_name')}</label>
                    <input
                        class="form-input"
                        type="text"
                        id="builder-name"
                        placeholder="${CameraForm.escapeAttr(I18n.t('placeholder_camera_name'))}"
                        required
                    />
                </div>

                <div class="form-group">
                    <label class="form-label" for="builder-preset">${I18n.t('builder_preset')}</label>
                    <select class="form-input" id="builder-preset" onchange="CameraForm.onPresetChange(this)">
                        <option value="/h264Preview_01_main">${I18n.t('preset_generic')}</option>
                        <option value="/Streaming/Channels/101">${I18n.t('preset_hikvision_main')}</option>
                        <option value="/Streaming/Channels/102">${I18n.t('preset_hikvision_sub')}</option>
                        <option value="/cam/realmonitor?channel=1&subtype=0">${I18n.t('preset_dahua_main')}</option>
                        <option value="/cam/realmonitor?channel=1&subtype=1">${I18n.t('preset_dahua_sub')}</option>
                        <option value="/media/video1">${I18n.t('preset_uniview')}</option>
                        <option value="custom">${I18n.t('preset_custom')}</option>
                    </select>
                </div>

                <div class="builder-row">
                    <div class="form-group">
                        <label class="form-label" for="builder-ip">${I18n.t('builder_ip')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="builder-ip"
                            placeholder="${CameraForm.escapeAttr(I18n.t('builder_ip_placeholder'))}"
                            oninput="CameraForm.updateBuilderUrl()"
                            dir="ltr"
                            style="text-align: left;"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="builder-port">${I18n.t('builder_port')}</label>
                        <input
                            class="form-input"
                            type="number"
                            id="builder-port"
                            value="554"
                            placeholder="554"
                            oninput="CameraForm.updateBuilderUrl()"
                            dir="ltr"
                            style="text-align: left;"
                            required
                        />
                    </div>
                </div>

                <div class="builder-credentials-row">
                    <div class="form-group">
                        <label class="form-label" for="builder-username">${I18n.t('builder_username')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="builder-username"
                            placeholder="${CameraForm.escapeAttr(I18n.t('builder_username_placeholder'))}"
                            oninput="CameraForm.updateBuilderUrl()"
                            dir="ltr"
                            style="text-align: left;"
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="builder-password">${I18n.t('builder_password')}</label>
                        <input
                            class="form-input"
                            type="password"
                            id="builder-password"
                            placeholder="${CameraForm.escapeAttr(I18n.t('builder_password_placeholder'))}"
                            oninput="CameraForm.updateBuilderUrl()"
                            dir="ltr"
                            style="text-align: left;"
                        />
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label" for="builder-path">${I18n.t('builder_path')}</label>
                    <input
                        class="form-input"
                        type="text"
                        id="builder-path"
                        value="/h264Preview_01_main"
                        placeholder="${CameraForm.escapeAttr(I18n.t('builder_path_placeholder'))}"
                        oninput="CameraForm.updateBuilderUrl()"
                        dir="ltr"
                        style="text-align: left;"
                    />
                </div>

                <!-- Live Generated Preview -->
                <div class="rtsp-preview-card">
                    <div class="rtsp-preview-header">
                        <span>⚡ ${I18n.t('builder_preview')}</span>
                        <button type="button" class="btn-copy-rtsp" onclick="CameraForm.copyBuilderUrl()">
                            ${I18n.t('builder_copy')}
                        </button>
                    </div>
                    <div class="rtsp-preview-code-wrap">
                        <code class="rtsp-preview-code" id="builder-preview-code">rtsp://...</code>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label" for="builder-location">${I18n.t('label_location')}</label>
                    <input
                        class="form-input"
                        type="text"
                        id="builder-location"
                        placeholder="${CameraForm.escapeAttr(I18n.t('placeholder_location'))}"
                    />
                </div>

                <div class="form-group" style="display: flex; align-items: center; gap: 12px; margin-bottom: 0;">
                    <label class="form-label" style="margin-bottom: 0;">${I18n.t('label_active')}</label>
                    <button
                        type="button"
                        class="toggle active"
                        id="builder-active-toggle"
                        onclick="CameraForm.toggleActive(this)"
                    >
                        <span class="toggle-knob"></span>
                    </button>
                </div>
            </form>
        `;
    },

    onPresetChange(select) {
        const pathInput = document.getElementById('builder-path');
        if (!pathInput) return;

        if (select.value !== 'custom') {
            pathInput.value = select.value;
        } else {
            pathInput.value = '';
            pathInput.focus();
        }
        CameraForm.updateBuilderUrl();
    },

    getBuiltRtspUrl() {
        const ip = (document.getElementById('builder-ip')?.value || '').trim();
        const port = (document.getElementById('builder-port')?.value || '554').trim();
        const username = (document.getElementById('builder-username')?.value || '').trim();
        const password = (document.getElementById('builder-password')?.value || '').trim();
        let path = (document.getElementById('builder-path')?.value || '').trim();

        if (!ip) return '';

        if (path && !path.startsWith('/') && !path.startsWith('?')) {
            path = '/' + path;
        }

        let creds = '';
        if (username && password) {
            creds = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
        } else if (username) {
            creds = `${encodeURIComponent(username)}@`;
        }

        const portPart = port ? `:${port}` : ':554';
        return `rtsp://${creds}${ip}${portPart}${path}`;
    },

    updateBuilderUrl() {
        const previewEl = document.getElementById('builder-preview-code');
        if (!previewEl) return;

        const url = CameraForm.getBuiltRtspUrl();
        previewEl.textContent = url || 'rtsp://user:pass@ip:port/stream';
    },

    async copyBuilderUrl() {
        const url = CameraForm.getBuiltRtspUrl();
        if (!url) {
            App.toast(I18n.t('builder_ip_placeholder'), 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            App.toast(I18n.t('builder_copied'), 'success');
        } catch {
            App.toast(url, 'info');
        }
    },

    async handleBuilderSubmit(e) {
        e.preventDefault();

        const name = (document.getElementById('builder-name')?.value || '').trim();
        const location = (document.getElementById('builder-location')?.value || '').trim();
        const toggle = document.getElementById('builder-active-toggle');
        const rtspUrl = CameraForm.getBuiltRtspUrl();

        if (!name) {
            App.toast(I18n.t('err_enter_name'), 'error');
            return;
        }
        if (!rtspUrl) {
            App.toast(I18n.t('builder_ip_placeholder'), 'error');
            return;
        }

        const data = {
            name,
            rtsp_url: rtspUrl,
            location,
            is_active: toggle ? toggle.classList.contains('active') : true,
        };

        try {
            await App.api('/api/cameras', 'POST', data);
            App.toast(I18n.t('camera_added_success'), 'success');
            App.closeModal();
            CamerasPage.load();
        } catch (err) {
            App.toast(I18n.t('err_failed_save', { msg: err.message }), 'error');
        }
    },

    async testBuilderConnection() {
        const url = CameraForm.getBuiltRtspUrl();
        if (!url) {
            App.toast(I18n.t('builder_ip_placeholder'), 'error');
            return;
        }
        await CameraForm.testUrl(url);
    },

    /* ═══════════════════════════════════════════════════════════
       3. BATCH IMPORT (Multiple Individual Cameras)
       ═══════════════════════════════════════════════════════════ */

    renderBatchForm() {
        const defaultPrefix = I18n.locale === 'fa' ? 'دوربین' : 'Camera';
        const isRange = CameraForm._batchInputMode === 'range';
        return `
            <div class="batch-form-container">
                <p style="font-size: 0.84rem; color: var(--text-secondary); margin-bottom: 0.85rem; line-height: 1.5;">
                    ${I18n.t('batch_import_desc')}
                </p>

                <!-- Sub-nav: Paste / TXT vs IP Range -->
                <div class="batch-subnav" role="tablist">
                    <button 
                        type="button" 
                        class="batch-subnav-btn ${!isRange ? 'active' : ''}" 
                        id="batch-subnav-paste"
                        onclick="CameraForm.switchBatchMode('paste')"
                    >
                        ${I18n.t('batch_subtab_paste')}
                    </button>
                    <button 
                        type="button" 
                        class="batch-subnav-btn ${isRange ? 'active' : ''}" 
                        id="batch-subnav-range"
                        onclick="CameraForm.switchBatchMode('range')"
                    >
                        ${I18n.t('batch_subtab_ip_range')}
                    </button>
                </div>

                <!-- Mode 1: Paste / TXT File -->
                <div id="batch-paste-mode-container" style="display: ${!isRange ? 'block' : 'none'};">
                    <div class="batch-toolbar">
                        <label class="form-label" style="margin-bottom: 0;" for="batch-textarea">
                            ${I18n.t('batch_paste_label')}
                        </label>
                        <div style="display: flex; gap: 0.5rem;">
                            <input 
                                type="file" 
                                id="batch-file-input" 
                                accept=".txt" 
                                style="display: none;" 
                                onchange="CameraForm.handleFileUpload(event)"
                            />
                            <button type="button" class="btn btn-secondary btn-sm" onclick="CameraForm.triggerFileUpload()">
                                ${I18n.t('batch_upload_btn')}
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="CameraForm.clearBatch()">
                                ${I18n.t('batch_clear_btn')}
                            </button>
                        </div>
                    </div>

                    <textarea
                        id="batch-textarea"
                        class="form-input batch-textarea"
                        placeholder="${CameraForm.escapeAttr(I18n.t('batch_paste_placeholder'))}"
                        oninput="CameraForm.parseBatchUrls()"
                    ></textarea>
                </div>

                <!-- Mode 2: IP Range Generator -->
                <div id="batch-range-mode-container" style="display: ${isRange ? 'block' : 'none'};">
                    <div class="batch-range-box">
                        <div class="range-ip-row">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label" for="range-start-ip">${I18n.t('range_start_ip')}</label>
                                <input
                                    class="form-input"
                                    type="text"
                                    id="range-start-ip"
                                    placeholder="${CameraForm.escapeAttr(I18n.t('range_start_ip_placeholder'))}"
                                    dir="ltr"
                                    style="text-align: left;"
                                    oninput="CameraForm.updateRangeCountPreview()"
                                />
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label" for="range-end-ip">${I18n.t('range_end_ip')}</label>
                                <input
                                    class="form-input"
                                    type="text"
                                    id="range-end-ip"
                                    placeholder="${CameraForm.escapeAttr(I18n.t('range_end_ip_placeholder'))}"
                                    dir="ltr"
                                    style="text-align: left;"
                                    oninput="CameraForm.updateRangeCountPreview()"
                                />
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label" for="range-port">${I18n.t('builder_port')}</label>
                                <input
                                    class="form-input"
                                    type="number"
                                    id="range-port"
                                    value="554"
                                    placeholder="554"
                                    dir="ltr"
                                    style="text-align: left;"
                                />
                            </div>
                        </div>

                        <div class="builder-credentials-row">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label" for="range-username">${I18n.t('builder_username')}</label>
                                <input
                                    class="form-input"
                                    type="text"
                                    id="range-username"
                                    placeholder="${CameraForm.escapeAttr(I18n.t('builder_username_placeholder'))}"
                                    dir="ltr"
                                    style="text-align: left;"
                                />
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label" for="range-password">${I18n.t('builder_password')}</label>
                                <input
                                    class="form-input"
                                    type="password"
                                    id="range-password"
                                    placeholder="${CameraForm.escapeAttr(I18n.t('builder_password_placeholder'))}"
                                    dir="ltr"
                                    style="text-align: left;"
                                />
                            </div>
                        </div>

                        <div class="builder-row">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label" for="range-preset">${I18n.t('builder_preset')}</label>
                                <select class="form-input" id="range-preset" onchange="CameraForm.onRangePresetChange(this)">
                                    <option value="/h264Preview_01_main">${I18n.t('preset_generic')}</option>
                                    <option value="/Streaming/Channels/101">${I18n.t('preset_hikvision_main')}</option>
                                    <option value="/Streaming/Channels/102">${I18n.t('preset_hikvision_sub')}</option>
                                    <option value="/cam/realmonitor?channel=1&subtype=0">${I18n.t('preset_dahua_main')}</option>
                                    <option value="/cam/realmonitor?channel=1&subtype=1">${I18n.t('preset_dahua_sub')}</option>
                                    <option value="/media/video1">${I18n.t('preset_uniview')}</option>
                                    <option value="custom">${I18n.t('preset_custom')}</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label class="form-label" for="range-path">${I18n.t('builder_path')}</label>
                                <input
                                    class="form-input"
                                    type="text"
                                    id="range-path"
                                    value="/h264Preview_01_main"
                                    placeholder="${CameraForm.escapeAttr(I18n.t('builder_path_placeholder'))}"
                                    dir="ltr"
                                    style="text-align: left;"
                                />
                            </div>
                        </div>

                        <button type="button" class="btn-generate-range" id="btn-generate-range" onclick="CameraForm.generateFromIpRange()">
                            <span>⚡</span>
                            <span id="range-generate-btn-text">${I18n.t('range_generate_btn', { count: 0 })}</span>
                        </button>
                    </div>
                </div>

                <!-- Shared Settings: Prefix & Location -->
                <div class="builder-row" style="margin-top: 1rem; margin-bottom: 0.75rem;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" for="batch-prefix">${I18n.t('batch_name_prefix')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="batch-prefix"
                            value="${defaultPrefix}"
                            placeholder="${CameraForm.escapeAttr(I18n.t('batch_name_prefix_placeholder'))}"
                            oninput="CameraForm.parseBatchUrls()"
                        />
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" for="batch-location">${I18n.t('batch_default_location')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="batch-location"
                            placeholder="${CameraForm.escapeAttr(I18n.t('batch_default_location_placeholder'))}"
                            oninput="CameraForm.parseBatchUrls()"
                        />
                    </div>
                </div>

                <!-- Parsed Live Preview Table -->
                <div class="batch-preview-wrapper" id="batch-preview-container">
                    <div class="batch-preview-head">
                        <span style="font-weight: 500; font-size: 0.85rem;">📋 ${I18n.t('batch_detected_count', { count: 0 })}</span>
                        <span class="batch-preview-count-badge" id="batch-count-badge">0</span>
                    </div>
                    <div style="padding: 1.5rem; text-align: center; color: var(--text-tertiary); font-size: 0.85rem;" id="batch-table-placeholder">
                        ${I18n.t('batch_no_cameras_parsed')}
                    </div>
                    <div class="batch-table-scroll" id="batch-table-scroll" style="display: none;">
                        <table class="batch-table">
                            <thead>
                                <tr>
                                    <th style="width: 40px; text-align: center;">${I18n.t('batch_table_row')}</th>
                                    <th style="width: 30%;">${I18n.t('batch_table_name')}</th>
                                    <th>${I18n.t('batch_table_url')}</th>
                                    <th style="width: 25%;">${I18n.t('batch_table_location')}</th>
                                    <th style="width: 45px; text-align: center;">${I18n.t('batch_table_remove')}</th>
                                </tr>
                            </thead>
                            <tbody id="batch-table-body">
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="form-group" style="display: flex; align-items: center; gap: 12px; margin-top: 1rem; margin-bottom: 0;">
                    <label class="form-label" style="margin-bottom: 0;">${I18n.t('label_active')}</label>
                    <button
                        type="button"
                        class="toggle active"
                        id="batch-active-toggle"
                        onclick="CameraForm.toggleActive(this)"
                    >
                        <span class="toggle-knob"></span>
                    </button>
                </div>
            </div>
        `;
    },

    switchBatchMode(mode) {
        CameraForm._batchInputMode = mode;
        const pasteBox = document.getElementById('batch-paste-mode-container');
        const rangeBox = document.getElementById('batch-range-mode-container');
        const pasteBtn = document.getElementById('batch-subnav-paste');
        const rangeBtn = document.getElementById('batch-subnav-range');

        if (pasteBtn) pasteBtn.classList.toggle('active', mode === 'paste');
        if (rangeBtn) rangeBtn.classList.toggle('active', mode === 'range');

        if (pasteBox) pasteBox.style.display = mode === 'paste' ? 'block' : 'none';
        if (rangeBox) rangeBox.style.display = mode === 'range' ? 'block' : 'none';

        if (mode === 'range') {
            CameraForm.updateRangeCountPreview();
        }
    },

    onRangePresetChange(select) {
        const pathInput = document.getElementById('range-path');
        if (!pathInput) return;

        if (select.value !== 'custom') {
            pathInput.value = select.value;
        } else {
            pathInput.value = '';
            pathInput.focus();
        }
    },

    parseIpToLong(ipStr) {
        if (!ipStr || typeof ipStr !== 'string') return null;
        const parts = ipStr.trim().split('.');
        if (parts.length !== 4) return null;
        let num = 0;
        for (let i = 0; i < 4; i++) {
            const p = parseInt(parts[i], 10);
            if (isNaN(p) || p < 0 || p > 255) return null;
            num = (num << 8) + p;
        }
        return (num >>> 0);
    },

    longToIp(num) {
        return [
            (num >>> 24) & 255,
            (num >>> 16) & 255,
            (num >>> 8) & 255,
            num & 255
        ].join('.');
    },

    resolveRangeBounds() {
        const startStr = (document.getElementById('range-start-ip')?.value || '').trim();
        let endStr = (document.getElementById('range-end-ip')?.value || '').trim();

        if (!startStr) return null;

        const startLong = CameraForm.parseIpToLong(startStr);
        if (startLong === null) return null;

        if (endStr && !endStr.includes('.')) {
            // Short notation: only last octet specified (e.g. "20")
            const lastOctet = parseInt(endStr, 10);
            if (!isNaN(lastOctet) && lastOctet >= 0 && lastOctet <= 255) {
                const parts = startStr.split('.');
                endStr = `${parts[0]}.${parts[1]}.${parts[2]}.${lastOctet}`;
            }
        }

        const endLong = CameraForm.parseIpToLong(endStr);
        if (endLong === null) return null;

        return { 
            startLong, 
            endLong, 
            count: (endLong >= startLong ? (endLong - startLong + 1) : 0) 
        };
    },

    updateRangeCountPreview() {
        const bounds = CameraForm.resolveRangeBounds();
        const btnText = document.getElementById('range-generate-btn-text');
        const count = bounds && bounds.count > 0 ? bounds.count : 0;
        if (btnText) {
            btnText.textContent = I18n.t('range_generate_btn', { count });
        }
    },

    generateFromIpRange() {
        const bounds = CameraForm.resolveRangeBounds();
        if (!bounds) {
            App.toast(I18n.t('range_invalid_ips'), 'error');
            return;
        }

        if (bounds.endLong < bounds.startLong) {
            App.toast(I18n.t('range_end_smaller'), 'error');
            return;
        }

        if (bounds.count > 256) {
            App.toast(I18n.t('range_too_large'), 'warning');
            return;
        }

        const port = (document.getElementById('range-port')?.value || '554').trim() || '554';
        const username = (document.getElementById('range-username')?.value || '').trim();
        const password = (document.getElementById('range-password')?.value || '').trim();
        let path = (document.getElementById('range-path')?.value || '').trim();

        if (path && !path.startsWith('/') && !path.startsWith('?')) {
            path = '/' + path;
        }

        let creds = '';
        if (username && password) {
            creds = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
        } else if (username) {
            creds = `${encodeURIComponent(username)}@`;
        }

        const portPart = port ? `:${port}` : ':554';

        const generatedUrls = [];
        for (let num = bounds.startLong; num <= bounds.endLong; num++) {
            const ip = CameraForm.longToIp(num);
            generatedUrls.push(`rtsp://${creds}${ip}${portPart}${path}`);
        }

        // Sync with textarea as well
        const textarea = document.getElementById('batch-textarea');
        if (textarea) {
            textarea.value = generatedUrls.join('\n');
        }

        CameraForm.parseBatchUrls();
        App.toast(I18n.t('range_generated_toast', { count: generatedUrls.length }), 'success');
    },

    triggerFileUpload() {
        const fileInput = document.getElementById('batch-file-input');
        if (fileInput) fileInput.click();
    },

    handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            const textarea = document.getElementById('batch-textarea');
            if (textarea) {
                textarea.value = content;
                CameraForm.parseBatchUrls();
                App.toast(I18n.t('batch_file_loaded', { 
                    filename: file.name, 
                    count: CameraForm._parsedBatchCameras.length 
                }), 'info');
            }
        };
        reader.readAsText(file);
    },

    clearBatch() {
        const textarea = document.getElementById('batch-textarea');
        if (textarea) textarea.value = '';
        CameraForm._parsedBatchCameras = [];
        CameraForm.renderBatchTable();
    },

    parseBatchUrls() {
        const textarea = document.getElementById('batch-textarea');
        if (!textarea) return;

        const prefix = (document.getElementById('batch-prefix')?.value || '').trim() || (I18n.locale === 'fa' ? 'دوربین' : 'Camera');
        const defaultLocation = (document.getElementById('batch-location')?.value || '').trim();

        const lines = textarea.value.split('\n');
        const validUrls = [];

        lines.forEach(line => {
            const cleaned = line.trim();
            // Ignore empty lines or comments
            if (cleaned && !cleaned.startsWith('#')) {
                // Must look like an RTSP/HTTP URL or stream path
                if (/^(rtsp|rtsps|http|https):\/\//i.test(cleaned) || cleaned.startsWith('/')) {
                    validUrls.push(cleaned);
                }
            }
        });

        // Preserve any custom edited names/locations if URLs already exist
        const oldMap = new Map();
        CameraForm._parsedBatchCameras.forEach(cam => {
            oldMap.set(cam.rtsp_url, cam);
        });

        CameraForm._parsedBatchCameras = validUrls.map((url, idx) => {
            const existing = oldMap.get(url);
            return {
                id: idx + 1,
                name: existing ? existing.name : `${prefix} ${idx + 1}`,
                rtsp_url: url,
                location: existing ? existing.location : defaultLocation,
            };
        });

        CameraForm.renderBatchTable();
    },

    renderBatchTable() {
        const placeholder = document.getElementById('batch-table-placeholder');
        const scrollContainer = document.getElementById('batch-table-scroll');
        const tbody = document.getElementById('batch-table-body');
        const countBadge = document.getElementById('batch-count-badge');
        const submitBtn = document.getElementById('batch-submit-btn');

        const cameras = CameraForm._parsedBatchCameras;
        const count = cameras.length;

        if (countBadge) countBadge.textContent = count;
        if (submitBtn) {
            submitBtn.textContent = I18n.t('batch_import_submit', { count });
            submitBtn.disabled = count === 0;
        }

        if (count === 0) {
            if (placeholder) placeholder.style.display = 'block';
            if (scrollContainer) scrollContainer.style.display = 'none';
            return;
        }

        if (placeholder) placeholder.style.display = 'none';
        if (scrollContainer) scrollContainer.style.display = 'block';

        if (tbody) {
            tbody.innerHTML = cameras.map((cam, idx) => `
                <tr>
                    <td style="text-align: center; color: var(--text-tertiary); font-weight: 500;">
                        ${idx + 1}
                    </td>
                    <td>
                        <input 
                            class="batch-table-input" 
                            type="text" 
                            value="${CameraForm.escapeAttr(cam.name)}"
                            oninput="CameraForm.updateBatchItem(${idx}, 'name', this.value)"
                            placeholder="${CameraForm.escapeAttr(I18n.t('placeholder_camera_name'))}"
                        />
                    </td>
                    <td>
                        <div class="batch-url-cell" title="${CameraForm.escapeAttr(cam.rtsp_url)}">
                            ${CameraForm.escapeHtml(CameraForm.maskUrl(cam.rtsp_url))}
                        </div>
                    </td>
                    <td>
                        <input 
                            class="batch-table-input" 
                            type="text" 
                            value="${CameraForm.escapeAttr(cam.location)}"
                            oninput="CameraForm.updateBatchItem(${idx}, 'location', this.value)"
                            placeholder="${CameraForm.escapeAttr(I18n.t('placeholder_location'))}"
                        />
                    </td>
                    <td style="text-align: center;">
                        <button 
                            type="button" 
                            class="batch-delete-btn" 
                            onclick="CameraForm.removeBatchItem(${idx})"
                            title="${I18n.t('batch_table_remove')}"
                        >
                            ✕
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    },

    updateBatchItem(index, field, value) {
        if (CameraForm._parsedBatchCameras[index]) {
            CameraForm._parsedBatchCameras[index][field] = value.trim();
        }
    },

    removeBatchItem(index) {
        CameraForm._parsedBatchCameras.splice(index, 1);
        CameraForm.renderBatchTable();
    },

    async handleBatchSubmit() {
        const cameras = CameraForm._parsedBatchCameras;
        if (!cameras || cameras.length === 0) {
            App.toast(I18n.t('batch_err_no_cameras'), 'error');
            return;
        }

        const toggle = document.getElementById('batch-active-toggle');
        const isActive = toggle ? toggle.classList.contains('active') : true;

        const payload = cameras.map(c => ({
            name: c.name || `Camera ${c.id}`,
            rtsp_url: c.rtsp_url,
            location: c.location || '',
            is_active: isActive,
        }));

        const submitBtn = document.getElementById('batch-submit-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = I18n.t('batch_importing');
        }

        try {
            const results = await App.api('/api/cameras/batch', 'POST', payload);
            App.toast(I18n.t('batch_import_success', { count: results.length || payload.length }), 'success');
            App.closeModal();
            CamerasPage.load();
        } catch (err) {
            App.toast(I18n.t('err_failed_save', { msg: err.message }), 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = I18n.t('batch_import_submit', { count: cameras.length });
            }
        }
    },

    /* ═══════════════════════════════════════════════════════════
       HELPERS & SHARED UTILS
       ═══════════════════════════════════════════════════════════ */

    toggleActive(btn) {
        btn.classList.toggle('active');
    },

    async testConnection() {
        const urlInput = document.getElementById('camera-url');
        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) {
            App.toast(I18n.t('placeholder_rtsp_url'), 'error');
            return;
        }
        await CameraForm.testUrl(url);
    },

    async testUrl(url) {
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

    maskUrl(url) {
        try {
            return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
        } catch {
            return url;
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
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },
};
