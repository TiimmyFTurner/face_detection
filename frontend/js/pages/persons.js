/**
 * Persons Page — Identity management with photo enrollment.
 */
const PersonsPage = {
    _persons: [],
    _searchQuery: '',
    _sortBy: 'detections', // 'detections', 'name', 'last_seen'

    /**
     * Load and render the identity management page.
     */
    async load() {
        document.getElementById('page-title').textContent = I18n.t('persons_title');
        document.getElementById('header-actions').innerHTML = `
            <button class="btn btn-primary" onclick="PersonsPage.showAddModal()">
                ${I18n.t('add_person_btn')}
            </button>
        `;

        const body = document.getElementById('content-body');
        body.innerHTML = `
            <div class="persons-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; gap: 1rem; flex-wrap: wrap;">
                <div class="persons-search-box" style="flex: 1; min-width: 250px; max-width: 400px; position: relative;">
                    <input 
                        type="text" 
                        id="person-search-input" 
                        class="form-control" 
                        placeholder="${PersonsPage.escapeAttr(I18n.t('search_persons_placeholder'))}" 
                        value="${PersonsPage.escapeAttr(PersonsPage._searchQuery)}"
                        oninput="PersonsPage.handleSearch(this.value)"
                        style="padding-${I18n.isRTL() ? 'right' : 'left'}: 2.2rem;"
                    />
                    <span style="position: absolute; ${I18n.isRTL() ? 'right' : 'left'}: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--text-tertiary);">🔍</span>
                </div>

                <div class="persons-sort-box" style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 0.85rem; color: var(--text-secondary);">${I18n.t('sort_by')}</span>
                    <select class="form-control" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.85rem;" onchange="PersonsPage.handleSort(this.value)">
                        <option value="detections" ${PersonsPage._sortBy === 'detections' ? 'selected' : ''}>${I18n.t('sort_detections')}</option>
                        <option value="last_seen" ${PersonsPage._sortBy === 'last_seen' ? 'selected' : ''}>${I18n.t('sort_last_seen')}</option>
                        <option value="name" ${PersonsPage._sortBy === 'name' ? 'selected' : ''}>${I18n.t('sort_name')}</option>
                    </select>
                </div>
            </div>

            <div class="persons-grid" id="persons-grid">
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⏳</div>
                    <div class="empty-state-title">${I18n.t('loading_persons')}</div>
                </div>
            </div>
        `;

        await PersonsPage.loadPersons();
    },

    /**
     * Handle live search query.
     */
    handleSearch(val) {
        PersonsPage._searchQuery = val.trim().toLowerCase();
        PersonsPage.renderPersons();
    },

    /**
     * Handle sort selection.
     */
    handleSort(sortBy) {
        PersonsPage._sortBy = sortBy;
        PersonsPage.renderPersons();
    },

    /**
     * Fetch and render all known persons.
     */
    async loadPersons() {
        try {
            PersonsPage._persons = await App.api('/api/persons');
            PersonsPage.renderPersons();
        } catch (err) {
            console.error('Failed to load persons:', err);
            document.getElementById('persons-grid').innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-title">${I18n.t('test_failed')}</div>
                    <div class="empty-state-text">${err.message}</div>
                </div>
            `;
        }
    },

    /**
     * Render person cards grid with search and sorting.
     */
    renderPersons() {
        const grid = document.getElementById('persons-grid');
        if (!grid) return;

        let filtered = PersonsPage._persons;

        // Apply search filter
        if (PersonsPage._searchQuery) {
            const q = PersonsPage._searchQuery;
            filtered = filtered.filter(p => 
                (p.name && p.name.toLowerCase().includes(q)) || 
                (p.role && p.role.toLowerCase().includes(q))
            );
        }

        // Apply sorting
        filtered = [...filtered].sort((a, b) => {
            const aSum = a.summary || {};
            const bSum = b.summary || {};

            if (PersonsPage._sortBy === 'detections') {
                return (bSum.total_detections || 0) - (aSum.total_detections || 0);
            } else if (PersonsPage._sortBy === 'last_seen') {
                const aTime = aSum.last_seen ? new Date(aSum.last_seen).getTime() : 0;
                const bTime = bSum.last_seen ? new Date(bSum.last_seen).getTime() : 0;
                return bTime - aTime;
            } else {
                return (a.name || '').localeCompare(b.name || '');
            }
        });

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">👤</div>
                    <div class="empty-state-title">${I18n.t('no_persons_title')}</div>
                    <div class="empty-state-text">
                        ${PersonsPage._searchQuery ? I18n.t('search_persons_placeholder') : I18n.t('no_persons_desc')}
                    </div>
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(person => {
            const initials = PersonsPage.getInitials(person.name);
            const hasPhoto = person.reference_photos && person.reference_photos.length > 0;
            const s = person.summary || {};
            const countDisplay = I18n.isRTL() ? I18n.toPersianDigits(person.embedding_count || 0) : (person.embedding_count || 0);
            const totalDetections = I18n.isRTL() ? I18n.toPersianDigits(s.total_detections || 0) : (s.total_detections || 0);
            const todayDetections = s.today_detections || 0;
            const todayStr = I18n.isRTL() ? I18n.toPersianDigits(todayDetections) : todayDetections;

            // Status badge
            let statusPill = '';
            if (s.current_status === 'present') {
                statusPill = `<span class="badge-status-pill on-station" style="font-size: 0.65rem;">🟢 ${I18n.t('badge_on_station')}</span>`;
            } else if (s.current_status === 'absent') {
                const minsAbsent = s.current_absence_minutes ? ` (${I18n.t('minutes_absent_now', { mins: I18n.isRTL() ? I18n.toPersianDigits(s.current_absence_minutes) : s.current_absence_minutes })})` : '';
                statusPill = `<span class="badge-status-pill absent" style="font-size: 0.65rem;">🔴 ${I18n.t('badge_absent')}${minsAbsent}</span>`;
            } else if (s.current_status === 'off_duty') {
                statusPill = `<span class="badge-status-pill off-duty" style="font-size: 0.65rem;">⚪ ${I18n.t('badge_off_duty')}</span>`;
            }

            // Last seen string
            let lastSeenText = s.last_seen ? I18n.formatTimestamp(s.last_seen) : I18n.t('card_never_seen');
            if (s.last_seen_camera) {
                lastSeenText += ` (${s.last_seen_camera})`;
            }

            const shiftTimeStr = s.primary_shift_time ? (I18n.isRTL() ? I18n.toPersianDigits(s.primary_shift_time) : s.primary_shift_time) : null;

            return `
                <div class="person-card" data-person-id="${person.id}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; min-height: 24px;">
                        <div style="flex: 1;"></div>
                        ${statusPill}
                    </div>

                    ${hasPhoto
                        ? `<img
                            class="person-avatar"
                            src="${person.reference_photos[0]}"
                            alt="${PersonsPage.escapeAttr(person.name)}"
                            onclick="PersonAnalyticsModal.show(${person.id})"
                            style="cursor: pointer;"
                            title="${PersonsPage.escapeAttr(I18n.t('btn_person_analytics'))}"
                            onerror="this.outerHTML='<div class=\\'person-avatar-placeholder\\' onclick=\\'PersonAnalyticsModal.show(${person.id})\\'>${initials}</div>'"
                        />`
                        : `<div class="person-avatar-placeholder" onclick="PersonAnalyticsModal.show(${person.id})" style="cursor: pointer;" title="${PersonsPage.escapeAttr(I18n.t('btn_person_analytics'))}">${initials}</div>`
                    }

                    <div class="person-name" onclick="PersonAnalyticsModal.show(${person.id})" style="cursor: pointer;" title="${PersonsPage.escapeAttr(I18n.t('btn_person_analytics'))}">
                        ${PersonsPage.escapeHtml(person.name)}
                    </div>
                    <div class="person-role">${PersonsPage.escapeHtml(person.role || I18n.t('no_role_assigned'))}</div>

                    <!-- Shift Time Badge -->
                    ${shiftTimeStr ? `
                        <div style="display: inline-flex; align-items: center; gap: 0.3rem; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: var(--radius-sm); padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 700; color: var(--accent-blue); margin-bottom: 0.6rem;">
                            <span>⏰</span>
                            <span>${I18n.t('shift_time')}: ${shiftTimeStr}</span>
                        </div>
                    ` : ''}

                    <!-- Summary Stats Tiles -->
                    <div class="person-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.75rem;">
                        <div class="person-stat" style="background: var(--bg-surface-hover); padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div class="person-stat-value" style="font-size: 1.1rem;">${totalDetections}</div>
                            <div class="person-stat-label">${I18n.t('kpi_total_detections')}</div>
                            ${todayDetections > 0 ? `<div style="font-size: 0.65rem; color: var(--accent-emerald); font-weight: 700; margin-top: 2px;">+${todayStr} ${I18n.isRTL() ? 'امروز' : 'today'}</div>` : ''}
                        </div>
                        <div class="person-stat" style="background: var(--bg-surface-hover); padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div class="person-stat-value" style="font-size: 1.1rem; color: var(--accent-violet);">${countDisplay}</div>
                            <div class="person-stat-label">${I18n.t('person_photos_count')}</div>
                            ${s.assigned_zones_count > 0 ? `<div style="font-size: 0.65rem; color: var(--accent-blue); font-weight: 700; margin-top: 2px;">🎯 ${s.assigned_zones_count} ${I18n.isRTL() ? 'منطقه' : 'zone(s)'}</div>` : ''}
                        </div>
                    </div>

                    <!-- Shift Absence Notice if absent today -->
                    ${s.today_absence_minutes > 0 ? `
                        <div style="font-size: 0.7rem; font-weight: 600; color: var(--accent-rose); background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: var(--radius-sm); padding: 0.3rem 0.5rem; margin-bottom: 0.5rem;">
                            ⏱️ ${I18n.t('today_absence')}: ${I18n.isRTL() ? I18n.toPersianDigits(s.today_absence_minutes) : s.today_absence_minutes} ${I18n.isRTL() ? 'دقیقه' : 'mins'}
                        </div>
                    ` : ''}

                    <!-- Last Seen Row -->
                    <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${PersonsPage.escapeAttr(lastSeenText)}">
                        🕒 <span>${lastSeenText}</span>
                    </div>

                    <!-- Actions -->
                    <div class="person-actions" style="display: flex; flex-direction: column; gap: 0.4rem;">
                        <button class="btn btn-primary btn-sm" onclick="PersonAnalyticsModal.show(${person.id})" style="width: 100%; justify-content: center;">
                            ${I18n.t('btn_person_analytics')}
                        </button>
                        <div style="display: flex; gap: 0.4rem; width: 100%;">
                            <button class="btn btn-secondary btn-sm" style="flex: 1; justify-content: center;" onclick="PersonsPage.showAddPhotosModal(${person.id}, '${PersonsPage.escapeAttr(person.name)}')">
                                ${I18n.t('btn_add_photos')}
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="PersonsPage.deletePerson(${person.id}, '${PersonsPage.escapeAttr(person.name)}')">
                                🗑️
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },


    /**
     * Show add person modal.
     */
    showAddModal() {
        PersonForm.reset();
        App.openModal(PersonForm.renderModal());
    },

    /**
     * Show add photos modal for existing person.
     */
    showAddPhotosModal(personId, personName) {
        PersonForm.reset();
        App.openModal(PersonForm.renderAddPhotosModal(personId, personName));
    },

    /**
     * Delete a person after confirmation.
     */
    async deletePerson(personId, name) {
        if (!confirm(I18n.t('confirm_delete_person', { name }))) {
            return;
        }

        try {
            await App.api(`/api/persons/${personId}`, 'DELETE');
            App.toast(I18n.t('person_deleted_toast', { name }), 'success');
            await PersonsPage.loadPersons();
        } catch (err) {
            App.toast(I18n.t('err_failed_delete', { msg: err.message }), 'error');
        }
    },

    /**
     * Get initials from a name (for avatar placeholder).
     */
    getInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return parts[0][0].toUpperCase();
    },

    /**
     * Format date to short form.
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
