/**
 * SettingsModal component — renders and manages system configuration modal.
 * Supports snapshot retention, event log retention, live disk storage usage,
 * and on-demand storage cleanup.
 */
const SettingsModal = {
    _currentSettings: {
        save_snapshots: true,
        log_unknown_faces: true,
        match_threshold: 0.5,
        cooldown_seconds: 60,
        frame_skip: 5,
        downscale_factor: 0.5,
        snapshot_retention_days: 30,
        event_log_retention_days: 0,
        roi_crop_enabled: true,
        live_preview_fps: 1.0,
        duty_cycle_window: 30.0,
        duty_burst_duration: 2.0,
        max_reconnect_backoff: 30,
    },

    _storageStats: null,

    /**
     * Fetch settings and storage stats from server, then display modal.
     */
    async show() {
        try {
            const data = await App.api('/api/settings');
            if (data) {
                SettingsModal._currentSettings = {
                    ...SettingsModal._currentSettings,
                    ...data,
                };
            }
        } catch (e) {
            console.warn('Using default settings cache:', e);
        }

        const s = SettingsModal._currentSettings;
        const isSnapshotsEnabled = s.save_snapshots !== false;
        const isLogUnknownEnabled = s.log_unknown_faces !== false;
        const isRoiCropEnabled = s.roi_crop_enabled !== false;
        const snapDays = s.snapshot_retention_days ?? 30;
        const logDays = s.event_log_retention_days ?? 0;
        const downscaleVal = typeof s.downscale_factor === 'number' ? s.downscale_factor : 0.5;
        const frameSkipVal = s.frame_skip ?? 5;
        const livePreviewFpsVal = s.live_preview_fps ?? 1.0;
        const dutyWindowVal = s.duty_cycle_window ?? 30.0;
        const dutyBurstVal = s.duty_burst_duration ?? 2.0;
        const reconnectBackoffVal = s.max_reconnect_backoff ?? 30;

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">${I18n.t('settings_title')}</h2>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <form id="system-settings-form" novalidate onsubmit="SettingsModal.handleSave(event)" style="display: flex; flex-direction: column; gap: 1.25rem; padding: 1.25rem; max-height: 80vh; overflow-y: auto;">
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: -0.25rem;">
                    ${I18n.t('settings_subtitle')}
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 1. General Processing & Detection Toggles                   -->
                <!-- ═══════════════════════════════════════════════════════════ -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <!-- Save Snapshots Toggle -->
                    <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
                            <div style="display: flex; align-items: flex-start; gap: 0.6rem;">
                                <span style="font-size: 1.4rem;">📸</span>
                                <div>
                                    <label for="setting-save-snapshots" style="font-weight: 700; color: var(--text-primary); cursor: pointer; font-size: 0.9rem; margin: 0;">
                                        ${I18n.t('setting_save_snapshots')}
                                    </label>
                                    <div style="font-size: 0.73rem; color: var(--text-tertiary); margin-top: 3px; line-height: 1.3;">
                                        ${I18n.t('setting_save_snapshots_desc')}
                                    </div>
                                </div>
                            </div>
                            <label class="switch-toggle" style="position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; margin-top: 2px;">
                                <input type="checkbox" id="setting-save-snapshots" ${isSnapshotsEnabled ? 'checked' : ''} onchange="SettingsModal.updateSnapshotBadge(this.checked)" style="opacity: 0; width: 0; height: 0;" />
                                <span class="slider slider-snapshots" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isSnapshotsEnabled ? 'var(--accent-blue)' : '#4b5563'}; transition: 0.3s; border-radius: 24px;">
                                    <span class="slider-knob slider-knob-snapshots" style="position: absolute; content: ''; height: 18px; width: 18px; left: ${isSnapshotsEnabled ? '22px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                                </span>
                            </label>
                        </div>
                        <div id="snapshot-status-pill" style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: var(--radius-sm); align-self: flex-start; ${isSnapshotsEnabled ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);' : 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);'}">
                            <span>${isSnapshotsEnabled ? '💾' : '🗄️'}</span>
                            <span id="snapshot-status-text">${isSnapshotsEnabled ? I18n.t('setting_save_snapshots_enabled') : I18n.t('setting_save_snapshots_disabled')}</span>
                        </div>
                    </div>

                    <!-- Log Unknown Faces Toggle -->
                    <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
                            <div style="display: flex; align-items: flex-start; gap: 0.6rem;">
                                <span style="font-size: 1.4rem;">👤</span>
                                <div>
                                    <label for="setting-log-unknown" style="font-weight: 700; color: var(--text-primary); cursor: pointer; font-size: 0.9rem; margin: 0;">
                                        ${I18n.t('setting_log_unknown')}
                                    </label>
                                    <div style="font-size: 0.73rem; color: var(--text-tertiary); margin-top: 3px; line-height: 1.3;">
                                        ${I18n.t('setting_log_unknown_desc')}
                                    </div>
                                </div>
                            </div>
                            <label class="switch-toggle" style="position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; margin-top: 2px;">
                                <input type="checkbox" id="setting-log-unknown" ${isLogUnknownEnabled ? 'checked' : ''} onchange="SettingsModal.updateUnknownBadge(this.checked)" style="opacity: 0; width: 0; height: 0;" />
                                <span class="slider slider-unknown" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isLogUnknownEnabled ? 'var(--accent-blue)' : '#4b5563'}; transition: 0.3s; border-radius: 24px;">
                                    <span class="slider-knob slider-knob-unknown" style="position: absolute; content: ''; height: 18px; width: 18px; left: ${isLogUnknownEnabled ? '22px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                                </span>
                            </label>
                        </div>
                        <div id="unknown-status-pill" style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: var(--radius-sm); align-self: flex-start; ${isLogUnknownEnabled ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);' : 'background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3);'}">
                            <span>${isLogUnknownEnabled ? '👥' : '🔒'}</span>
                            <span id="unknown-status-text">${isLogUnknownEnabled ? I18n.t('setting_log_unknown_enabled') : I18n.t('setting_log_unknown_disabled')}</span>
                        </div>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 2. Live Storage & Database Stats Card                       -->
                <!-- ═══════════════════════════════════════════════════════════ -->
                <div style="background: rgba(30, 41, 59, 0.5); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.9rem 1.1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
                        <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                            ${I18n.t('storage_stats_title')}
                        </span>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="SettingsModal.loadStorageStats()" style="padding: 2px 8px; font-size: 0.72rem; display: flex; align-items: center; gap: 0.3rem;">
                            🔄 <span>${I18n.t('refresh') || 'Refresh'}</span>
                        </button>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                        <div style="background: var(--bg-surface); padding: 0.6rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.7rem; color: var(--text-tertiary);">${I18n.t('storage_snapshot_files')}</div>
                            <div id="storage-stat-count" style="font-size: 1.1rem; font-weight: 800; color: var(--accent-blue); margin-top: 2px;">--</div>
                        </div>
                        <div style="background: var(--bg-surface); padding: 0.6rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.7rem; color: var(--text-tertiary);">${I18n.t('storage_disk_used')}</div>
                            <div id="storage-stat-size" style="font-size: 1.1rem; font-weight: 800; color: #10b981; margin-top: 2px;">--</div>
                        </div>
                        <div style="background: var(--bg-surface); padding: 0.6rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.7rem; color: var(--text-tertiary);">${I18n.t('storage_total_events')}</div>
                            <div id="storage-stat-events" style="font-size: 1.1rem; font-weight: 800; color: #a855f7; margin-top: 2px;">--</div>
                        </div>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 3. Snapshot Image Retention Policy                          -->
                <!-- ═══════════════════════════════════════════════════════════ -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.1rem; display: flex; flex-direction: column; gap: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                                <span>🖼️</span> <span>${I18n.t('setting_snapshot_retention')}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 3px; line-height: 1.35;">
                                ${I18n.t('setting_snapshot_retention_desc')}
                            </div>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-clean-snapshots" onclick="SettingsModal.cleanSnapshotsNow()" style="flex-shrink: 0; font-size: 0.75rem; padding: 0.35rem 0.65rem; border-color: rgba(239, 68, 68, 0.3); color: #f87171;">
                            ${I18n.t('btn_cleanup_snapshots_now')}
                        </button>
                    </div>

                    <!-- Preset Pills for Snapshot Retention -->
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
                        <button type="button" class="btn-preset-snap btn btn-sm" data-days="1" onclick="SettingsModal.setSnapshotPreset(1)">
                            ${I18n.t('retention_1_day')}
                        </button>
                        <button type="button" class="btn-preset-snap btn btn-sm" data-days="7" onclick="SettingsModal.setSnapshotPreset(7)">
                            ${I18n.t('retention_1_week')}
                        </button>
                        <button type="button" class="btn-preset-snap btn btn-sm" data-days="30" onclick="SettingsModal.setSnapshotPreset(30)">
                            ${I18n.t('retention_1_month')}
                        </button>
                        <button type="button" class="btn-preset-snap btn btn-sm" data-days="90" onclick="SettingsModal.setSnapshotPreset(90)">
                            ${I18n.t('retention_3_months')}
                        </button>
                        <button type="button" class="btn-preset-snap btn btn-sm" data-days="0" onclick="SettingsModal.setSnapshotPreset(0)">
                            ${I18n.t('retention_no_expiry')}
                        </button>

                        <div style="display: inline-flex; align-items: center; gap: 0.35rem; margin-inline-start: auto;">
                            <input
                                type="number"
                                id="setting-snapshot-retention-input"
                                class="form-input"
                                value="${snapDays}"
                                min="0"
                                max="3650"
                                oninput="SettingsModal.updateSnapshotPresetPills(parseInt(this.value, 10))"
                                style="width: 76px; padding: 0.3rem 0.5rem; font-size: 0.8rem; text-align: center;"
                            />
                            <span style="font-size: 0.75rem; color: var(--text-tertiary);">${I18n.t('retention_days_label')}</span>
                        </div>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 4. Event Log Database Retention Policy                      -->
                <!-- ═══════════════════════════════════════════════════════════ -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.1rem; display: flex; flex-direction: column; gap: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                                <span>📋</span> <span>${I18n.t('setting_event_log_retention')}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 3px; line-height: 1.35;">
                                ${I18n.t('setting_event_log_retention_desc')}
                            </div>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-clean-logs" onclick="SettingsModal.cleanLogsNow()" style="flex-shrink: 0; font-size: 0.75rem; padding: 0.35rem 0.65rem; border-color: rgba(239, 68, 68, 0.3); color: #f87171;">
                            ${I18n.t('btn_cleanup_logs_now')}
                        </button>
                    </div>

                    <!-- Preset Pills for Event Log Retention -->
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
                        <button type="button" class="btn-preset-log btn btn-sm" data-days="7" onclick="SettingsModal.setLogPreset(7)">
                            ${I18n.t('retention_1_week')}
                        </button>
                        <button type="button" class="btn-preset-log btn btn-sm" data-days="30" onclick="SettingsModal.setLogPreset(30)">
                            ${I18n.t('retention_1_month')}
                        </button>
                        <button type="button" class="btn-preset-log btn btn-sm" data-days="90" onclick="SettingsModal.setLogPreset(90)">
                            ${I18n.t('retention_3_months')}
                        </button>
                        <button type="button" class="btn-preset-log btn btn-sm" data-days="180" onclick="SettingsModal.setLogPreset(180)">
                            ${I18n.t('retention_6_months')}
                        </button>
                        <button type="button" class="btn-preset-log btn btn-sm" data-days="365" onclick="SettingsModal.setLogPreset(365)">
                            ${I18n.t('retention_1_year')}
                        </button>
                        <button type="button" class="btn-preset-log btn btn-sm" data-days="0" onclick="SettingsModal.setLogPreset(0)">
                            ${I18n.t('retention_no_expiry')}
                        </button>

                        <div style="display: inline-flex; align-items: center; gap: 0.35rem; margin-inline-start: auto;">
                            <input
                                type="number"
                                id="setting-log-retention-input"
                                class="form-input"
                                value="${logDays}"
                                min="0"
                                max="3650"
                                oninput="SettingsModal.updateLogPresetPills(parseInt(this.value, 10))"
                                style="width: 76px; padding: 0.3rem 0.5rem; font-size: 0.8rem; text-align: center;"
                            />
                            <span style="font-size: 0.75rem; color: var(--text-tertiary);">${I18n.t('retention_days_label')}</span>
                        </div>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 5. AI Downscaling & Performance Optimization                 -->
                <!-- ═══════════════════════════════════════════════════════════ -->
                <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.1rem; display: flex; flex-direction: column; gap: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                                <span>📉</span> <span>${I18n.t('setting_downscale_factor')}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 3px; line-height: 1.35;">
                                ${I18n.t('setting_downscale_factor_desc')}
                            </div>
                        </div>
                        <div id="downscale-percent-badge" style="font-size: 1.1rem; font-weight: 800; color: var(--accent-blue); background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); padding: 4px 12px; border-radius: var(--radius-sm); white-space: nowrap;">
                            ${Math.round(downscaleVal * 100)}%
                        </div>
                    </div>

                    <!-- Preset Pills for Downscaling -->
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
                        <button type="button" class="btn-preset-downscale btn btn-sm" data-val="1.0" onclick="SettingsModal.setDownscalePreset(1.0)">
                            ${I18n.t('downscale_100')}
                        </button>
                        <button type="button" class="btn-preset-downscale btn btn-sm" data-val="0.75" onclick="SettingsModal.setDownscalePreset(0.75)">
                            ${I18n.t('downscale_75')}
                        </button>
                        <button type="button" class="btn-preset-downscale btn btn-sm" data-val="0.5" onclick="SettingsModal.setDownscalePreset(0.5)">
                            ${I18n.t('downscale_50')}
                        </button>
                        <button type="button" class="btn-preset-downscale btn btn-sm" data-val="0.25" onclick="SettingsModal.setDownscalePreset(0.25)">
                            ${I18n.t('downscale_25')}
                        </button>
                    </div>

                    <!-- Range Slider -->
                    <div style="display: flex; align-items: center; gap: 1rem; background: var(--bg-surface); padding: 0.6rem 0.9rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                        <span style="font-size: 0.75rem; color: var(--text-tertiary); font-weight: 600;">25%</span>
                        <input
                            type="range"
                            id="setting-downscale-slider"
                            min="0.1"
                            max="1.0"
                            step="0.05"
                            value="${downscaleVal}"
                            oninput="SettingsModal.updateDownscale(parseFloat(this.value))"
                            style="flex: 1; accent-color: var(--accent-blue); cursor: pointer;"
                        />
                        <span style="font-size: 0.75rem; color: var(--text-tertiary); font-weight: 600;">100%</span>
                    </div>

                    <!-- Tradeoff Hint Box -->
                    <div id="downscale-hint-pill" style="font-size: 0.76rem; color: var(--text-secondary); background: rgba(30, 41, 59, 0.6); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.5rem 0.8rem; display: flex; align-items: center; gap: 0.45rem;">
                        <span id="downscale-hint-text">...</span>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 6. Frame Skip & Station ROI Optimization                     -->
                <!-- ═══════════════════════════════════════════════════════════ -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <!-- Frame Skip Card -->
                    <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem;">
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                                <span>⏩</span> <span>${I18n.t('setting_frame_skip')}</span>
                            </div>
                            <div style="font-size: 0.73rem; color: var(--text-tertiary); margin-top: 3px; line-height: 1.3;">
                                ${I18n.t('setting_frame_skip_desc')}
                            </div>
                        </div>

                        <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;">
                            <button type="button" class="btn-preset-skip btn btn-sm" data-skip="1" onclick="SettingsModal.setFrameSkipPreset(1)" style="font-size: 0.72rem; padding: 2px 7px;">
                                ${I18n.t('frame_skip_1')}
                            </button>
                            <button type="button" class="btn-preset-skip btn btn-sm" data-skip="3" onclick="SettingsModal.setFrameSkipPreset(3)" style="font-size: 0.72rem; padding: 2px 7px;">
                                ${I18n.t('frame_skip_3')}
                            </button>
                            <button type="button" class="btn-preset-skip btn btn-sm" data-skip="5" onclick="SettingsModal.setFrameSkipPreset(5)" style="font-size: 0.72rem; padding: 2px 7px;">
                                ${I18n.t('frame_skip_5')}
                            </button>
                            <button type="button" class="btn-preset-skip btn btn-sm" data-skip="10" onclick="SettingsModal.setFrameSkipPreset(10)" style="font-size: 0.72rem; padding: 2px 7px;">
                                ${I18n.t('frame_skip_10')}
                            </button>

                            <div style="display: inline-flex; align-items: center; gap: 0.35rem; margin-inline-start: auto;">
                                <input
                                    type="number"
                                    id="setting-frame-skip"
                                    class="form-input"
                                    value="${frameSkipVal}"
                                    min="1"
                                    max="60"
                                    oninput="SettingsModal.updateFrameSkipPresetPills(parseInt(this.value, 10))"
                                    style="width: 65px; padding: 0.25rem 0.4rem; font-size: 0.8rem; text-align: center;"
                                />
                            </div>
                        </div>
                    </div>

                    <!-- Station Zone ROI Crop Toggle -->
                    <div style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
                            <div style="display: flex; align-items: flex-start; gap: 0.6rem;">
                                <span style="font-size: 1.4rem;">✂️</span>
                                <div>
                                    <label for="setting-roi-crop" style="font-weight: 700; color: var(--text-primary); cursor: pointer; font-size: 0.9rem; margin: 0;">
                                        ${I18n.t('setting_roi_crop')}
                                    </label>
                                    <div style="font-size: 0.73rem; color: var(--text-tertiary); margin-top: 3px; line-height: 1.3;">
                                        ${I18n.t('setting_roi_crop_desc')}
                                    </div>
                                </div>
                            </div>
                            <label class="switch-toggle" style="position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; margin-top: 2px;">
                                <input type="checkbox" id="setting-roi-crop" ${isRoiCropEnabled ? 'checked' : ''} onchange="SettingsModal.updateRoiBadge(this.checked)" style="opacity: 0; width: 0; height: 0;" />
                                <span class="slider slider-roi" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isRoiCropEnabled ? 'var(--accent-blue)' : '#4b5563'}; transition: 0.3s; border-radius: 24px;">
                                    <span class="slider-knob slider-knob-roi" style="position: absolute; content: ''; height: 18px; width: 18px; left: ${isRoiCropEnabled ? '22px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                                </span>
                            </label>
                        </div>
                        <div id="roi-status-pill" style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: var(--radius-sm); align-self: flex-start; ${isRoiCropEnabled ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);' : 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);'}">
                            <span>${isRoiCropEnabled ? '✂️' : '🖼️'}</span>
                            <span id="roi-status-text">${isRoiCropEnabled ? I18n.t('setting_roi_crop_enabled') : I18n.t('setting_roi_crop_disabled')}</span>
                        </div>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 7. Detection Tuning Parameters                               -->
                <!-- ═══════════════════════════════════════════════════════════ -->
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
                            style="padding: 0.5rem 0.75rem; font-size: 0.85rem;"
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
                            step="any"
                            min="0.1"
                            max="1.0"
                            style="padding: 0.5rem 0.75rem; font-size: 0.85rem;"
                        />
                        <span class="form-help" style="font-size: 0.7rem; color: var(--text-tertiary);">
                            ${I18n.t('setting_match_threshold_desc')}
                        </span>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════════ -->
                <!-- 8. Advanced Stream & Resource Settings (Collapsible)         -->
                <!-- ═══════════════════════════════════════════════════════════ -->
                <details style="background: rgba(30, 41, 59, 0.4); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
                    <summary style="cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; justify-content: space-between; user-select: none;">
                        <div style="display: flex; align-items: center; gap: 0.45rem;">
                            <span>🔧</span>
                            <span>${I18n.t('advanced_stream_settings')}</span>
                        </div>
                        <span style="font-size: 0.72rem; color: var(--text-tertiary); font-weight: normal;">${I18n.t('advanced_stream_settings_desc')}</span>
                    </summary>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.85rem; padding-top: 0.85rem; border-top: 1px solid var(--border-subtle);">
                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;">
                                📺 ${I18n.t('setting_live_preview_fps')}
                            </label>
                            <input
                                type="number"
                                id="setting-preview-fps"
                                class="form-input"
                                value="${livePreviewFpsVal}"
                                step="any"
                                min="0.1"
                                max="10.0"
                                style="padding: 0.45rem 0.7rem; font-size: 0.82rem;"
                            />
                            <span class="form-help" style="font-size: 0.7rem; color: var(--text-tertiary);">
                                ${I18n.t('setting_live_preview_fps_desc')}
                            </span>
                        </div>

                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;">
                                🔄 ${I18n.t('setting_duty_cycle_window')}
                            </label>
                            <input
                                type="number"
                                id="setting-duty-window"
                                class="form-input"
                                value="${dutyWindowVal}"
                                step="any"
                                min="5"
                                max="300"
                                style="padding: 0.45rem 0.7rem; font-size: 0.82rem;"
                            />
                            <span class="form-help" style="font-size: 0.7rem; color: var(--text-tertiary);">
                                ${I18n.t('setting_duty_cycle_desc')}
                            </span>
                        </div>

                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;">
                                ⚡ ${I18n.t('setting_duty_burst_duration')}
                            </label>
                            <input
                                type="number"
                                id="setting-duty-burst"
                                class="form-input"
                                value="${dutyBurstVal}"
                                step="any"
                                min="0.5"
                                max="60.0"
                                style="padding: 0.45rem 0.7rem; font-size: 0.82rem;"
                            />
                            <span class="form-help" style="font-size: 0.7rem; color: var(--text-tertiary);">
                                ${I18n.t('setting_duty_burst_desc')}
                            </span>
                        </div>

                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.25rem;">
                                🔌 ${I18n.t('setting_max_reconnect')}
                            </label>
                            <input
                                type="number"
                                id="setting-reconnect-backoff"
                                class="form-input"
                                value="${reconnectBackoffVal}"
                                step="any"
                                min="5"
                                max="120"
                                style="padding: 0.45rem 0.7rem; font-size: 0.82rem;"
                            />
                            <span class="form-help" style="font-size: 0.7rem; color: var(--text-tertiary);">
                                ${I18n.t('setting_max_reconnect_desc')}
                            </span>
                        </div>
                    </div>
                </details>

                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem; padding: 0;">
                    <button type="button" class="btn btn-secondary" onclick="App.closeModal()">
                        ${I18n.t('cancel')}
                    </button>
                    <button type="button" class="btn btn-primary" id="save-settings-btn" onclick="SettingsModal.handleSave(event)">
                        💾 ${I18n.t('save_changes')}
                    </button>
                </div>
            </form>
        `;

        App.openModal(content, 'modal-lg');

        // Apply active styles on preset pills
        SettingsModal.updateSnapshotPresetPills(snapDays);
        SettingsModal.updateLogPresetPills(logDays);
        SettingsModal.updateDownscale(downscaleVal);
        SettingsModal.updateFrameSkipPresetPills(frameSkipVal);

        // Fetch live storage statistics
        SettingsModal.loadStorageStats();
    },

    /**
     * Set snapshot preset and update UI.
     */
    setSnapshotPreset(days) {
        const input = document.getElementById('setting-snapshot-retention-input');
        if (input) {
            input.value = days;
            SettingsModal.updateSnapshotPresetPills(days);
        }
    },

    /**
     * Set log preset and update UI.
     */
    setLogPreset(days) {
        const input = document.getElementById('setting-log-retention-input');
        if (input) {
            input.value = days;
            SettingsModal.updateLogPresetPills(days);
        }
    },

    /**
     * Update active CSS styling for snapshot preset pills.
     */
    updateSnapshotPresetPills(selectedDays) {
        document.querySelectorAll('.btn-preset-snap').forEach((btn) => {
            const days = parseInt(btn.getAttribute('data-days'), 10);
            if (days === selectedDays) {
                btn.style.background = 'var(--accent-blue)';
                btn.style.color = '#ffffff';
                btn.style.borderColor = 'var(--accent-blue)';
                btn.style.fontWeight = '700';
            } else {
                btn.style.background = 'var(--bg-surface)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.borderColor = 'var(--border-subtle)';
                btn.style.fontWeight = '500';
            }
        });
    },

    /**
     * Update active CSS styling for event log preset pills.
     */
    updateLogPresetPills(selectedDays) {
        document.querySelectorAll('.btn-preset-log').forEach((btn) => {
            const days = parseInt(btn.getAttribute('data-days'), 10);
            if (days === selectedDays) {
                btn.style.background = '#8b5cf6';
                btn.style.color = '#ffffff';
                btn.style.borderColor = '#8b5cf6';
                btn.style.fontWeight = '700';
            } else {
                btn.style.background = 'var(--bg-surface)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.borderColor = 'var(--border-subtle)';
                btn.style.fontWeight = '500';
            }
        });
    },

    /**
     * Fetch storage stats from server and update modal counters.
     */
    async loadStorageStats() {
        const countEl = document.getElementById('storage-stat-count');
        const sizeEl = document.getElementById('storage-stat-size');
        const eventsEl = document.getElementById('storage-stat-events');

        if (countEl) countEl.textContent = '...';
        if (sizeEl) sizeEl.textContent = '...';
        if (eventsEl) eventsEl.textContent = '...';

        try {
            const stats = await App.api('/api/settings/storage-stats');
            if (stats) {
                SettingsModal._storageStats = stats;
                if (countEl) countEl.textContent = I18n.isRTL() ? I18n.toPersianDigits(stats.snapshot_count.toLocaleString()) : stats.snapshot_count.toLocaleString();
                if (sizeEl) {
                    const mbStr = stats.total_mb >= 1024
                        ? `${(stats.total_mb / 1024).toFixed(2)} GB`
                        : `${stats.total_mb.toFixed(1)} MB`;
                    sizeEl.textContent = I18n.isRTL() ? I18n.toPersianDigits(mbStr) : mbStr;
                }
                if (eventsEl) eventsEl.textContent = I18n.isRTL() ? I18n.toPersianDigits(stats.event_count.toLocaleString()) : stats.event_count.toLocaleString();
            }
        } catch (e) {
            console.warn('Failed to load storage stats:', e);
            if (countEl) countEl.textContent = 'N/A';
            if (sizeEl) sizeEl.textContent = 'N/A';
            if (eventsEl) eventsEl.textContent = 'N/A';
        }
    },

    /**
     * Trigger immediate snapshot cleanup on demand.
     */
    async cleanSnapshotsNow() {
        const input = document.getElementById('setting-snapshot-retention-input');
        const days = parseInt(input ? input.value : '30', 10);

        if (days <= 0) {
            App.toast(I18n.t('retention_no_expiry') + ' - No files to delete.', 'info');
            return;
        }

        const confirmMsg = I18n.t('cleanup_snapshots_confirm', { days: days });
        if (!confirm(confirmMsg)) return;

        const btn = document.getElementById('btn-clean-snapshots');
        if (btn) {
            btn.disabled = true;
            btn.textContent = I18n.t('cleaning_up');
        }

        try {
            const res = await App.api(`/api/settings/cleanup-snapshots?retention_days=${days}`, 'POST');
            if (res && res.success) {
                App.toast(
                    I18n.t('cleanup_snapshots_success', { files: res.deleted_files, mb: res.freed_mb }),
                    'success'
                );
                await SettingsModal.loadStorageStats();
            } else {
                App.toast(res.message || 'Cleanup error', 'error');
            }
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message || err }), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = I18n.t('btn_cleanup_snapshots_now');
            }
        }
    },

    /**
     * Trigger immediate event logs cleanup on demand.
     */
    async cleanLogsNow() {
        const input = document.getElementById('setting-log-retention-input');
        const days = parseInt(input ? input.value : '0', 10);

        if (days <= 0) {
            App.toast(I18n.t('retention_no_expiry') + ' - No logs to delete.', 'info');
            return;
        }

        const confirmMsg = I18n.t('cleanup_logs_confirm', { days: days });
        if (!confirm(confirmMsg)) return;

        const btn = document.getElementById('btn-clean-logs');
        if (btn) {
            btn.disabled = true;
            btn.textContent = I18n.t('cleaning_up');
        }

        try {
            const res = await App.api(`/api/settings/cleanup-logs?retention_days=${days}`, 'POST');
            if (res && res.success) {
                App.toast(
                    I18n.t('cleanup_logs_success', { records: res.records_removed }),
                    'success'
                );
                await SettingsModal.loadStorageStats();
            } else {
                App.toast(res.message || 'Cleanup error', 'error');
            }
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message || err }), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = I18n.t('btn_cleanup_logs_now');
            }
        }
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
            knob.style.left = checked ? '22px' : '3px';
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
            knob.style.left = checked ? '22px' : '3px';
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
     * Dynamically update ROI Crop UI badge when toggle switch moves.
     */
    updateRoiBadge(checked) {
        const slider = document.querySelector('#system-settings-form .slider-roi');
        const knob = document.querySelector('#system-settings-form .slider-knob-roi');
        const pill = document.getElementById('roi-status-pill');
        const text = document.getElementById('roi-status-text');

        if (slider && knob) {
            slider.style.backgroundColor = checked ? 'var(--accent-blue)' : '#4b5563';
            knob.style.left = checked ? '22px' : '3px';
        }

        if (pill && text) {
            if (checked) {
                pill.style.background = 'rgba(16, 185, 129, 0.15)';
                pill.style.color = '#34d399';
                pill.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                text.textContent = I18n.t('setting_roi_crop_enabled');
                pill.querySelector('span').textContent = '✂️';
            } else {
                pill.style.background = 'rgba(245, 158, 11, 0.15)';
                pill.style.color = '#fbbf24';
                pill.style.border = '1px solid rgba(245, 158, 11, 0.3)';
                text.textContent = I18n.t('setting_roi_crop_disabled');
                pill.querySelector('span').textContent = '🖼️';
            }
        }
    },

    /**
     * Set downscale preset and update UI.
     */
    setDownscalePreset(val) {
        SettingsModal.updateDownscale(val);
    },

    /**
     * Update active downscale styling, slider, percent badge, and tradeoff hint.
     */
    updateDownscale(val) {
        val = Math.max(0.1, Math.min(1.0, parseFloat(val) || 0.5));
        const slider = document.getElementById('setting-downscale-slider');
        if (slider && Math.abs(parseFloat(slider.value) - val) > 0.001) {
            slider.value = val;
        }

        const pct = Math.round(val * 100);
        const badge = document.getElementById('downscale-percent-badge');
        if (badge) {
            badge.textContent = I18n.isRTL() ? I18n.toPersianDigits(pct + '%') : (pct + '%');
        }

        // Update active preset styling
        document.querySelectorAll('.btn-preset-downscale').forEach((btn) => {
            const btnVal = parseFloat(btn.getAttribute('data-val'));
            if (Math.abs(btnVal - val) < 0.02) {
                btn.style.background = 'var(--accent-blue)';
                btn.style.color = '#ffffff';
                btn.style.borderColor = 'var(--accent-blue)';
                btn.style.fontWeight = '700';
            } else {
                btn.style.background = 'var(--bg-surface)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.borderColor = 'var(--border-subtle)';
                btn.style.fontWeight = '500';
            }
        });

        // Update dynamic tradeoff advice pill
        const hintText = document.getElementById('downscale-hint-text');
        if (hintText) {
            if (val >= 0.9) {
                hintText.textContent = I18n.t('downscale_hint_100');
            } else if (val >= 0.7) {
                hintText.textContent = I18n.t('downscale_hint_75');
            } else if (val >= 0.4) {
                hintText.textContent = I18n.t('downscale_hint_50');
            } else {
                hintText.textContent = I18n.t('downscale_hint_25');
            }
        }
    },

    /**
     * Set frame skip preset and update UI.
     */
    setFrameSkipPreset(val) {
        const input = document.getElementById('setting-frame-skip');
        if (input) {
            input.value = val;
            SettingsModal.updateFrameSkipPresetPills(val);
        }
    },

    /**
     * Update active styling for frame skip preset buttons.
     */
    updateFrameSkipPresetPills(selectedSkip) {
        document.querySelectorAll('.btn-preset-skip').forEach((btn) => {
            const skip = parseInt(btn.getAttribute('data-skip'), 10);
            if (skip === selectedSkip) {
                btn.style.background = 'var(--accent-blue)';
                btn.style.color = '#ffffff';
                btn.style.borderColor = 'var(--accent-blue)';
                btn.style.fontWeight = '700';
            } else {
                btn.style.background = 'var(--bg-surface)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.borderColor = 'var(--border-subtle)';
                btn.style.fontWeight = '500';
            }
        });
    },

    /**
     * Handle form submission to patch settings.
     */
    async handleSave(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        const submitBtn = document.getElementById('save-settings-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ ' + (I18n.t('saving') || 'در حال ذخیره...');
        }

        try {
            const saveSnapshotsEl = document.getElementById('setting-save-snapshots');
            const saveSnapshots = saveSnapshotsEl ? saveSnapshotsEl.checked : true;

            const logUnknownEl = document.getElementById('setting-log-unknown');
            const logUnknown = logUnknownEl ? logUnknownEl.checked : true;

            const roiCropEl = document.getElementById('setting-roi-crop');
            const roiCrop = roiCropEl ? roiCropEl.checked : true;

            const sliderEl = document.getElementById('setting-downscale-slider');
            const downscale = sliderEl && !isNaN(parseFloat(sliderEl.value))
                ? parseFloat(sliderEl.value)
                : 0.5;

            const skipEl = document.getElementById('setting-frame-skip');
            const frameSkip = skipEl && !isNaN(parseInt(skipEl.value, 10))
                ? parseInt(skipEl.value, 10)
                : 5;

            const cooldownEl = document.getElementById('setting-cooldown');
            const cooldown = cooldownEl && !isNaN(parseInt(cooldownEl.value, 10))
                ? parseInt(cooldownEl.value, 10)
                : 60;

            const thresholdEl = document.getElementById('setting-threshold');
            const threshold = thresholdEl && !isNaN(parseFloat(thresholdEl.value))
                ? parseFloat(thresholdEl.value)
                : 0.5;

            const snapInput = document.getElementById('setting-snapshot-retention-input');
            const logInput = document.getElementById('setting-log-retention-input');
            const snapshotDays = snapInput && !isNaN(parseInt(snapInput.value, 10))
                ? Math.max(0, parseInt(snapInput.value, 10))
                : 30;
            const logDays = logInput && !isNaN(parseInt(logInput.value, 10))
                ? Math.max(0, parseInt(logInput.value, 10))
                : 0;

            const previewFpsEl = document.getElementById('setting-preview-fps');
            const livePreviewFps = previewFpsEl && !isNaN(parseFloat(previewFpsEl.value))
                ? parseFloat(previewFpsEl.value)
                : 1.0;

            const dutyWindowEl = document.getElementById('setting-duty-window');
            const dutyWindow = dutyWindowEl && !isNaN(parseFloat(dutyWindowEl.value))
                ? parseFloat(dutyWindowEl.value)
                : 30.0;

            const dutyBurstEl = document.getElementById('setting-duty-burst');
            const dutyBurst = dutyBurstEl && !isNaN(parseFloat(dutyBurstEl.value))
                ? parseFloat(dutyBurstEl.value)
                : 2.0;

            const reconnectEl = document.getElementById('setting-reconnect-backoff');
            const reconnectBackoff = reconnectEl && !isNaN(parseInt(reconnectEl.value, 10))
                ? parseInt(reconnectEl.value, 10)
                : 30;

            const payload = {
                save_snapshots: saveSnapshots,
                log_unknown_faces: logUnknown,
                roi_crop_enabled: roiCrop,
                downscale_factor: downscale,
                frame_skip: frameSkip,
                cooldown_seconds: cooldown,
                match_threshold: threshold,
                snapshot_retention_days: snapshotDays,
                event_log_retention_days: logDays,
                live_preview_fps: livePreviewFps,
                duty_cycle_window: dutyWindow,
                duty_burst_duration: dutyBurst,
                max_reconnect_backoff: reconnectBackoff,
            };

            const updated = await App.api('/api/settings', 'PATCH', payload);

            if (updated) {
                SettingsModal._currentSettings = updated;
            }

            App.toast(I18n.t('settings_saved_success'), 'success');
            App.closeModal();
        } catch (err) {
            console.error('Settings save error:', err);
            App.toast(I18n.t('err_generic', { msg: err.message || err }), 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '💾 ' + I18n.t('save_changes');
            }
        }
    },
};
