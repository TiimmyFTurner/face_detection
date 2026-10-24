/**
 * BreakPresets — Reusable Preset Management Component for Lunch, Rest & Free Times.
 * Allows viewing, applying, adding custom presets, and managing break presets
 * shared across Workstation Zones and Person Shift Timetables.
 */
const BreakPresets = {
    _presets: [],
    _isManaging: false,
    _loaded: false,

    /**
     * Fetch presets from backend API.
     */
    async load(forceRefresh = false) {
        if (this._loaded && !forceRefresh && this._presets.length > 0) {
            return this._presets;
        }

        try {
            const data = await App.api('/api/break-presets');
            if (Array.isArray(data)) {
                this._presets = data;
                this._loaded = true;
            }
        } catch (err) {
            console.warn('[BreakPresets] Failed to fetch presets from server:', err);
            if (this._presets.length === 0) {
                // Fallback default presets if server call fails
                this._presets = [
                    { id: 1, name: I18n.isRTL() ? 'ناهار' : 'Lunch', start_time: '12:00', end_time: '13:00', icon: '🍽️', category: 'lunch' },
                    { id: 2, name: I18n.isRTL() ? 'ناهار و نماز' : 'Lunch & Prayer', start_time: '12:30', end_time: '13:30', icon: '🍱', category: 'lunch' },
                    { id: 3, name: I18n.isRTL() ? 'عصرانه و چای' : 'Tea Break', start_time: '16:00', end_time: '16:30', icon: '☕', category: 'rest' },
                    { id: 4, name: I18n.isRTL() ? 'استراحت شبانه' : 'Midnight Rest', start_time: '03:00', end_time: '03:45', icon: '🌙', category: 'rest' },
                ];
            }
        }
        return this._presets;
    },

    /**
     * Get currently cached presets.
     */
    getPresets() {
        return this._presets || [];
    },

    /**
     * Escape HTML helper.
     */
    _escape(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Render the presets bar HTML into a container element.
     * @param {Object} options
     * @param {string} options.containerId Target DOM element ID
     * @param {string} options.inputPrefix Prefix for input IDs (e.g. 'free-time' or 'person-free-time')
     * @param {string} options.onSelectPresetCall String of function to call when preset clicked, e.g. "ZoneModal.applyBreakPreset"
     * @param {string} options.refreshCall String of function to call when presets updated
     */
    renderBarHtml({ containerId, inputPrefix, onSelectPresetCall, refreshCall }) {
        const presets = this.getPresets();
        const isManaging = this._isManaging;

        const presetButtons = presets.map(p => {
            const safeName = this._escape(p.name);
            const icon = p.icon || '☕';
            return `
                <div class="break-preset-pill ${isManaging ? 'managing' : ''}">
                    <button type="button" class="btn btn-secondary btn-sm break-preset-btn"
                            onclick="${onSelectPresetCall}('${this._escape(p.name)}', '${p.start_time}', '${p.end_time}')"
                            title="${safeName} (${p.start_time} - ${p.end_time})">
                        <span class="break-preset-icon">${icon}</span>
                        <span class="break-preset-name">${safeName}</span>
                        <span class="break-preset-time">${p.start_time}-${p.end_time}</span>
                    </button>
                    ${isManaging ? `
                        <button type="button" class="break-preset-del-btn"
                                onclick="BreakPresets.deletePreset(${p.id}, '${containerId}', '${inputPrefix}', '${onSelectPresetCall}', '${refreshCall}')"
                                title="${I18n.t('delete') || 'حذف'}">
                            ✕
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');

        return `
            <div class="break-presets-wrapper">
                <div class="break-presets-header">
                    <span class="break-presets-label">
                        ⚡ ${I18n.t('quick_presets') || 'الگوهای آماده ناهار و استراحت:'}
                    </span>
                    <div class="break-presets-actions">
                        <button type="button" class="btn btn-ghost btn-xs break-preset-action-btn"
                                onclick="BreakPresets.toggleManage('${containerId}', '${inputPrefix}', '${onSelectPresetCall}', '${refreshCall}')">
                            ${isManaging ? '✓ ' + (I18n.t('close_preset_manager') || 'اتمام ویرایش') : (I18n.t('preset_manage_btn') || '⚙️ مدیریت الگوها')}
                        </button>
                        <button type="button" class="btn btn-ghost btn-xs break-preset-action-btn text-accent"
                                onclick="BreakPresets.saveFromInputs('${inputPrefix}', '${containerId}', '${onSelectPresetCall}', '${refreshCall}')"
                                title="${I18n.t('save_as_preset_btn') || 'ذخیره ورودی فعلی به عنوان الگوی آماده'}">
                            ＋ ${I18n.t('save_as_preset_btn') || 'ذخیره به عنوان الگو'}
                        </button>
                    </div>
                </div>
                <div class="break-presets-chips">
                    ${presetButtons}
                </div>
            </div>
        `;
    },

    /**
     * Mount and refresh presets bar into the target DOM container.
     */
    async mount(containerId, inputPrefix, onSelectPresetCall, refreshCall) {
        await this.load();
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = this.renderBarHtml({
                containerId,
                inputPrefix,
                onSelectPresetCall,
                refreshCall,
            });
        }
    },

    /**
     * Toggle management mode (showing/hiding delete buttons).
     */
    toggleManage(containerId, inputPrefix, onSelectPresetCall, refreshCall) {
        this._isManaging = !this._isManaging;
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = this.renderBarHtml({
                containerId,
                inputPrefix,
                onSelectPresetCall,
                refreshCall,
            });
        }
    },

    /**
     * Read current inputs and save them as a new preset to the database.
     */
    async saveFromInputs(inputPrefix, containerId, onSelectPresetCall, refreshCall) {
        const nameInput = document.getElementById(`${inputPrefix}-name`);
        const startInput = document.getElementById(`${inputPrefix}-start`);
        const endInput = document.getElementById(`${inputPrefix}-end`);

        const name = (nameInput ? nameInput.value : '').trim();
        const startTime = (startInput ? startInput.value : '').trim() || '12:00';
        const endTime = (endInput ? endInput.value : '').trim() || '13:00';

        if (!name) {
            App.showToast(I18n.t('preset_name_required') || 'لطفاً نام الگو را در فیلد عنوان وارد کنید.', 'warning');
            if (nameInput) nameInput.focus();
            return;
        }

        // Determine icon & category
        let category = 'lunch';
        let icon = '🍽️';
        const nameLower = name.toLowerCase();
        if (nameLower.includes('tea') || name.includes('چای') || name.includes('عصرانه')) {
            category = 'rest';
            icon = '☕';
        } else if (nameLower.includes('prayer') || name.includes('نماز')) {
            category = 'prayer';
            icon = '🕌';
        } else if (nameLower.includes('rest') || name.includes('استراحت')) {
            category = 'rest';
            icon = '☕';
        } else if (nameLower.includes('night') || name.includes('شب')) {
            category = 'rest';
            icon = '🌙';
        }

        try {
            const created = await App.api('/api/break-presets', 'POST', {
                name,
                start_time: startTime,
                end_time: endTime,
                category,
                icon,
            });

            this._presets.push(created);
            App.showToast(
                (I18n.t('preset_saved_toast') || '✅ الگوی استراحت «{name}» ذخیره شد').replace('{name}', created.name),
                'success'
            );

            // Re-render presets bar
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = this.renderBarHtml({
                    containerId,
                    inputPrefix,
                    onSelectPresetCall,
                    refreshCall,
                });
            }

            // Also automatically add to current editing form list
            if (typeof window[onSelectPresetCall.split('.')[0]] !== 'undefined') {
                const parts = onSelectPresetCall.split('.');
                if (parts.length === 2 && typeof window[parts[0]][parts[1]] === 'function') {
                    window[parts[0]][parts[1]](created.name, created.start_time, created.end_time);
                }
            }
        } catch (err) {
            console.error('[BreakPresets] Error saving preset:', err);
            App.showToast((err && err.message) || 'خطا در ذخیره الگوی استراحت', 'error');
        }
    },

    /**
     * Delete an existing preset from the database.
     */
    async deletePreset(presetId, containerId, inputPrefix, onSelectPresetCall, refreshCall) {
        if (!confirm(I18n.t('confirm_delete_preset') || 'آیا از حذف این الگوی استراحت اطمینان دارید؟')) {
            return;
        }

        try {
            await App.api(`/api/break-presets/${presetId}`, 'DELETE');
            this._presets = this._presets.filter(p => p.id !== presetId);
            App.showToast(I18n.t('preset_deleted_toast') || 'الگوی استراحت حذف شد.', 'info');

            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = this.renderBarHtml({
                    containerId,
                    inputPrefix,
                    onSelectPresetCall,
                    refreshCall,
                });
            }
        } catch (err) {
            console.error('[BreakPresets] Error deleting preset:', err);
            App.showToast((err && err.message) || 'خطا در حذف الگو', 'error');
        }
    },
};
