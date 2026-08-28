/**
 * SettingsModal component — renders and manages system configuration modal.
 */
const SettingsModal = {
    _currentSettings: {
        save_snapshots: true,
        log_unknown_faces: true,
        match_threshold: 0.5,
        cooldown_seconds: 60,
        frame_skip: 5,
        downscale_factor: 0.5,
    },

    /**
     * Fetch settings from server and display modal.
     */
    async show() {
        try {
            const data = await App.api('/api/settings');
            if (data) {
                SettingsModal._currentSettings = data;
            }
        } catch (e) {
            console.warn('Using default settings cache:', e);
        }

        const s = SettingsModal._currentSettings;
        const isSnapshotsEnabled = s.save_snapshots !== false;
        const isLogUnknownEnabled = s.log_unknown_faces !== false;

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">${I18n.t('settings_title')}</h2>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <form id="system-settings-form" onsubmit="SettingsModal.handleSave(event)" style="display: flex; flex-direction: column; gap: 1.25rem; padding: 1.25rem;">
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.25rem;">
                    ${I18n.t('settings_subtitle')}
                </div>

                <!-- 1. Save Snapshots Option (Toggle) -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.6rem;">
                            <span style="font-size: 1.5rem;">📸</span>
                            <div>
                                <label for="setting-save-snapshots" style="font-weight: 700; color: var(--text-primary); cursor: pointer; font-size: 0.95rem; margin: 0;">
                                    ${I18n.t('setting_save_snapshots')}
                                </label>
                                <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 2px;">
                                    ${I18n.t('setting_save_snapshots_desc')}
                                </div>
                            </div>
                        </div>
                        <label class="switch-toggle" style="position: relative; display: inline-block; width: 48px; height: 26px; flex-shrink: 0;">
                            <input type="checkbox" id="setting-save-snapshots" ${isSnapshotsEnabled ? 'checked' : ''} onchange="SettingsModal.updateSnapshotBadge(this.checked)" style="opacity: 0; width: 0; height: 0;" />
                            <span class="slider slider-snapshots" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isSnapshotsEnabled ? 'var(--accent-blue)' : '#4b5563'}; transition: 0.3s; border-radius: 26px;">
                                <span class="slider-knob slider-knob-snapshots" style="position: absolute; content: ''; height: 20px; width: 20px; left: ${isSnapshotsEnabled ? '25px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                            </span>
                        </label>
                    </div>

                    <div id="snapshot-status-pill" style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 700; padding: 4px 10px; border-radius: var(--radius-sm); align-self: flex-start; ${isSnapshotsEnabled ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);' : 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);'}">
                        <span>${isSnapshotsEnabled ? '💾' : '🗄️'}</span>
                        <span id="snapshot-status-text">${isSnapshotsEnabled ? I18n.t('setting_save_snapshots_enabled') : I18n.t('setting_save_snapshots_disabled')}</span>
                    </div>
                </div>

                <!-- 2. Log Unknown Persons Option (Toggle) -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.6rem;">
                            <span style="font-size: 1.5rem;">👤</span>
                            <div>
                                <label for="setting-log-unknown" style="font-weight: 700; color: var(--text-primary); cursor: pointer; font-size: 0.95rem; margin: 0;">
                                    ${I18n.t('setting_log_unknown')}
                                </label>
                                <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 2px;">
                                    ${I18n.t('setting_log_unknown_desc')}
                                </div>
                            </div>
                        </div>
                        <label class="switch-toggle" style="position: relative; display: inline-block; width: 48px; height: 26px; flex-shrink: 0;">
                            <input type="checkbox" id="setting-log-unknown" ${isLogUnknownEnabled ? 'checked' : ''} onchange="SettingsModal.updateUnknownBadge(this.checked)" style="opacity: 0; width: 0; height: 0;" />
                            <span class="slider slider-unknown" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isLogUnknownEnabled ? 'var(--accent-blue)' : '#4b5563'}; transition: 0.3s; border-radius: 26px;">
                                <span class="slider-knob slider-knob-unknown" style="position: absolute; content: ''; height: 20px; width: 20px; left: ${isLogUnknownEnabled ? '25px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                            </span>
                        </label>
                    </div>

                    <div id="unknown-status-pill" style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 700; padding: 4px 10px; border-radius: var(--radius-sm); align-self: flex-start; ${isLogUnknownEnabled ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);' : 'background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3);'}">
                        <span>${isLogUnknownEnabled ? '👥' : '🔒'}</span>
                        <span id="unknown-status-text">${isLogUnknownEnabled ? I18n.t('setting_log_unknown_enabled') : I18n.t('setting_log_unknown_disabled')}</span>
                    </div>
                </div>

                <!-- 3. Additional Performance & Detection Tuning -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div class="form-group" style="margin: 0;">
                        <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;">
                            ⏱️ ${I18n.t('setting_cooldown')}
                        </label>
                        <input
                            type="number"
                            id="setting-cooldown"
                            class="form-input"
                            value="${s.cooldown_seconds || 60}"
                            min="1"
                            max="3600"
                            style="padding: 0.55rem 0.75rem;"
                        />
                        <span class="form-help" style="font-size: 0.7rem; color: var(--text-tertiary);">
                            ${I18n.t('setting_cooldown_desc')}
                        </span>
                    </div>

                    <div class="form-group" style="margin: 0;">
                        <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;">
                            🎯 ${I18n.t('setting_match_threshold')}
                        </label>
                        <input
                            type="number"
                            id="setting-threshold"
                            class="form-input"
                            value="${s.match_threshold || 0.5}"
                            step="0.05"
                            min="0.1"
                            max="1.0"
                            style="padding: 0.55rem 0.75rem;"
                        />
                        <span class="form-help" style="font-size: 0.7rem; color: var(--text-tertiary);">
                            ${I18n.t('setting_match_threshold_desc')}
                        </span>
                    </div>
                </div>

                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem; padding: 0;">
                    <button type="button" class="btn btn-secondary" onclick="App.closeModal()">
                        ${I18n.t('cancel')}
                    </button>
                    <button type="submit" class="btn btn-primary" id="save-settings-btn">
                        💾 ${I18n.t('save_changes')}
                    </button>
                </div>
            </form>
        `;

        App.openModal(content);
    },

    /**
     * Dynamically update Snapshot UI badge when toggle switch moves.
     */
    updateSnapshotBadge(checked) {
        const slider = document.querySelector('#system-settings-form .slider-snapshots');
        const knob = document.querySelector('#system-settings-form .slider-knob-snapshots');
        const pill = document.getElementById('snapshot-status-pill');
        const text = document.getElementById('snapshot-status-text');

        if (slider && knob) {
            slider.style.backgroundColor = checked ? 'var(--accent-blue)' : '#4b5563';
            knob.style.left = checked ? '25px' : '3px';
        }

        if (pill && text) {
            if (checked) {
                pill.style.background = 'rgba(16, 185, 129, 0.15)';
                pill.style.color = '#34d399';
                pill.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                text.textContent = I18n.t('setting_save_snapshots_enabled');
                pill.querySelector('span').textContent = '💾';
            } else {
                pill.style.background = 'rgba(245, 158, 11, 0.15)';
                pill.style.color = '#fbbf24';
                pill.style.border = '1px solid rgba(245, 158, 11, 0.3)';
                text.textContent = I18n.t('setting_save_snapshots_disabled');
                pill.querySelector('span').textContent = '🗄️';
            }
        }
    },

    /**
     * Dynamically update Log Unknown UI badge when toggle switch moves.
     */
    updateUnknownBadge(checked) {
        const slider = document.querySelector('#system-settings-form .slider-unknown');
        const knob = document.querySelector('#system-settings-form .slider-knob-unknown');
        const pill = document.getElementById('unknown-status-pill');
        const text = document.getElementById('unknown-status-text');

        if (slider && knob) {
            slider.style.backgroundColor = checked ? 'var(--accent-blue)' : '#4b5563';
            knob.style.left = checked ? '25px' : '3px';
        }

        if (pill && text) {
            if (checked) {
                pill.style.background = 'rgba(16, 185, 129, 0.15)';
                pill.style.color = '#34d399';
                pill.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                text.textContent = I18n.t('setting_log_unknown_enabled');
                pill.querySelector('span').textContent = '👥';
            } else {
                pill.style.background = 'rgba(139, 92, 246, 0.15)';
                pill.style.color = '#a78bfa';
                pill.style.border = '1px solid rgba(139, 92, 246, 0.3)';
                text.textContent = I18n.t('setting_log_unknown_disabled');
                pill.querySelector('span').textContent = '🔒';
            }
        }
    },

    /**
     * Handle form submission to patch settings.
     */
    async handleSave(event) {
        event.preventDefault();
        const submitBtn = document.getElementById('save-settings-btn');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const saveSnapshots = document.getElementById('setting-save-snapshots').checked;
            const logUnknown = document.getElementById('setting-log-unknown').checked;
            const cooldown = parseInt(document.getElementById('setting-cooldown').value, 10) || 60;
            const threshold = parseFloat(document.getElementById('setting-threshold').value) || 0.5;

            const payload = {
                save_snapshots: saveSnapshots,
                log_unknown_faces: logUnknown,
                cooldown_seconds: cooldown,
                match_threshold: threshold
            };

            const updated = await App.api('/api/settings', 'PATCH', payload);

            if (updated) {
                SettingsModal._currentSettings = updated;
            }

            App.toast(I18n.t('settings_saved_success'), 'success');
            App.closeModal();
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message || err }), 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }
};
