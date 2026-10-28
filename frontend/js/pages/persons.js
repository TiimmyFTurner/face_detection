/**
 * Persons Page — Identity management with photo enrollment
 * and Default Shift Timetables & Rotational Pattern configuration.
 */
const PersonsPage = {
    _persons: [],
    _shiftTemplates: [],
    _activeTab: 'persons', // 'persons' | 'shifts'
    _searchQuery: '',
    _shiftSearchQuery: '',
    _sortBy: 'detections', // 'detections', 'name', 'last_seen'
    _viewMode: localStorage.getItem('facetrack_view_persons') || 'grid',

    /**
     * Set view mode ('grid' or 'list') and update UI.
     */
    setViewMode(mode) {
        PersonsPage._viewMode = mode;
        try {
            localStorage.setItem('facetrack_view_persons', mode);
        } catch (e) {}

        const gridBtn = document.getElementById('persons-view-grid');
        const listBtn = document.getElementById('persons-view-list');
        if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
        if (listBtn) listBtn.classList.toggle('active', mode === 'list');
        PersonsPage.renderPersons();
    },

    /**
     * Switch active navigation tab between 'persons' and 'shifts'.
     */
    switchTab(tab) {
        PersonsPage._activeTab = tab;

        const tabBtnPersons = document.getElementById('tab-btn-persons');
        const tabBtnShifts = document.getElementById('tab-btn-shifts');
        const panelPersons = document.getElementById('tab-panel-persons');
        const panelShifts = document.getElementById('tab-panel-shifts');
        const headerActions = document.getElementById('header-actions');

        if (tabBtnPersons) tabBtnPersons.classList.toggle('active', tab === 'persons');
        if (tabBtnShifts) tabBtnShifts.classList.toggle('active', tab === 'shifts');

        if (panelPersons) panelPersons.style.display = tab === 'persons' ? 'block' : 'none';
        if (panelShifts) panelShifts.style.display = tab === 'shifts' ? 'block' : 'none';

        // Update header action button
        if (headerActions) {
            if (tab === 'persons') {
                headerActions.innerHTML = `
                    <button class="btn btn-primary" onclick="PersonsPage.showAddModal()">
                        ${I18n.t('add_person_btn') || '+ Add Person'}
                    </button>
                `;
            } else {
                headerActions.innerHTML = `
                    <button class="btn btn-primary" onclick="ShiftTemplateModal.show(null, null, () => PersonsPage.loadShiftTemplates())">
                        ${I18n.t('btn_add_shift_template') || '➕ New Shift Template'}
                    </button>
                `;
            }
        }

        if (tab === 'shifts') {
            PersonsPage.renderShiftTemplates();
        } else {
            PersonsPage.renderPersons();
        }
    },

    /**
     * Load and render the identity management page.
     */
    async load() {
        document.getElementById('page-title').textContent = I18n.t('persons_title') || 'Identity Management';
        
        const headerActions = document.getElementById('header-actions');
        if (headerActions) {
            headerActions.innerHTML = `
                <button class="btn btn-primary" onclick="PersonsPage.showAddModal()">
                    ${I18n.t('add_person_btn') || '+ Add Person'}
                </button>
            `;
        }

        const body = document.getElementById('content-body');
        body.innerHTML = `
            <div class="persons-page-container">
                <!-- Sub-navigation Tabs -->
                <div class="page-segmented-control mb-4" style="margin-bottom: 1.25rem;">
                    <button class="segmented-tab ${PersonsPage._activeTab === 'persons' ? 'active' : ''}" id="tab-btn-persons" onclick="PersonsPage.switchTab('persons')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; flex-shrink: 0;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        <span>${I18n.t('tab_identities') || 'پرسنل و هویت‌ها'}</span>
                        <span class="badge badge-subtle ml-2" id="persons-count-badge">0</span>
                    </button>
                    <button class="segmented-tab ${PersonsPage._activeTab === 'shifts' ? 'active' : ''}" id="tab-btn-shifts" onclick="PersonsPage.switchTab('shifts')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span>${I18n.t('tab_shift_templates') || 'شیفت‌های پیش‌فرض'}</span>
                        <span class="badge badge-subtle ml-2" id="shifts-count-badge">0</span>
                    </button>
                </div>

                <!-- ═══════════════════════════════════════════════════════ -->
                <!-- Tab Panel 1: Personnel & Enrolled Identities           -->
                <!-- ═══════════════════════════════════════════════════════ -->
                <div id="tab-panel-persons" style="display: ${PersonsPage._activeTab === 'persons' ? 'block' : 'none'};">
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

                        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                            <div class="persons-sort-box" style="display: flex; align-items: center; gap: 0.5rem;">
                                <span style="font-size: 0.85rem; color: var(--text-secondary);">${I18n.t('sort_by')}</span>
                                <select class="form-control" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.85rem;" onchange="PersonsPage.handleSort(this.value)">
                                    <option value="detections" ${PersonsPage._sortBy === 'detections' ? 'selected' : ''}>${I18n.t('sort_detections')}</option>
                                    <option value="last_seen" ${PersonsPage._sortBy === 'last_seen' ? 'selected' : ''}>${I18n.t('sort_last_seen')}</option>
                                    <option value="name" ${PersonsPage._sortBy === 'name' ? 'selected' : ''}>${I18n.t('sort_name')}</option>
                                </select>
                            </div>

                            <div class="view-toggle-group" role="group" aria-label="View mode">
                                <button class="view-toggle-btn ${PersonsPage._viewMode === 'grid' ? 'active' : ''}" 
                                        id="persons-view-grid" 
                                        onclick="PersonsPage.setViewMode('grid')" 
                                        title="${I18n.t('view_grid')}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>
                                    <span>${I18n.t('view_grid')}</span>
                                </button>
                                <button class="view-toggle-btn ${PersonsPage._viewMode === 'list' ? 'active' : ''}" 
                                        id="persons-view-list" 
                                        onclick="PersonsPage.setViewMode('list')" 
                                        title="${I18n.t('view_list')}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                    <span>${I18n.t('view_list')}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="persons-grid ${PersonsPage._viewMode === 'list' ? 'list-view' : ''}" id="persons-grid">
                        <div class="empty-state" style="grid-column: 1 / -1;">
                            <div class="empty-state-icon">⏳</div>
                            <div class="empty-state-title">${I18n.t('loading_persons')}</div>
                        </div>
                    </div>
                </div>

                <!-- ═══════════════════════════════════════════════════════ -->
                <!-- Tab Panel 2: Default Shifts / Shift Templates          -->
                <!-- ═══════════════════════════════════════════════════════ -->
                <div id="tab-panel-shifts" style="display: ${PersonsPage._activeTab === 'shifts' ? 'block' : 'none'};">
                    <div class="shifts-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; gap: 1rem; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 250px; max-width: 400px; position: relative;">
                            <input 
                                type="text" 
                                id="shift-search-input" 
                                class="form-control" 
                                placeholder="${PersonsPage.escapeAttr(I18n.t('search_shift_templates_placeholder') || 'جستجوی نام شیفت، ساعات یا نوع...')}" 
                                value="${PersonsPage.escapeAttr(PersonsPage._shiftSearchQuery)}"
                                oninput="PersonsPage.handleShiftSearch(this.value)"
                                style="padding-${I18n.isRTL() ? 'right' : 'left'}: 2.2rem;"
                            />
                            <span style="position: absolute; ${I18n.isRTL() ? 'right' : 'left'}: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--text-tertiary);">🔍</span>
                        </div>

                        <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4;">
                            ${I18n.t('shift_templates_subtitle') || 'تعریف و پیکربندی شیفت‌های استاندارد سازمانی (ثابت و چرخشی)'}
                        </div>
                    </div>

                    <div id="shifts-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem;">
                        <div class="empty-state" style="grid-column: 1 / -1;">
                            <div class="empty-state-icon">⏳</div>
                            <div class="empty-state-title">${I18n.t('loading')}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        await Promise.all([
            PersonsPage.loadPersons(),
            PersonsPage.loadShiftTemplates(),
        ]);
    },

    /**
     * Handle live search query for persons.
     */
    handleSearch(val) {
        PersonsPage._searchQuery = val.trim().toLowerCase();
        PersonsPage.renderPersons();
    },

    /**
     * Handle live search query for shift templates.
     */
    handleShiftSearch(val) {
        PersonsPage._shiftSearchQuery = val.trim().toLowerCase();
        PersonsPage.renderShiftTemplates();
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
            const badge = document.getElementById('persons-count-badge');
            if (badge) {
                badge.textContent = I18n.isRTL() 
                    ? I18n.toPersianDigits(PersonsPage._persons.length)
                    : PersonsPage._persons.length;
            }
            PersonsPage.renderPersons();
        } catch (err) {
            console.error('Failed to load persons:', err);
            const grid = document.getElementById('persons-grid');
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <div class="empty-state-icon">⚠️</div>
                        <div class="empty-state-title">${I18n.t('test_failed')}</div>
                        <div class="empty-state-text">${err.message}</div>
                    </div>
                `;
            }
        }
    },

    /**
     * Fetch all shift templates from server.
     */
    async loadShiftTemplates() {
        try {
            PersonsPage._shiftTemplates = await App.api('/api/shift-templates');
            const badge = document.getElementById('shifts-count-badge');
            if (badge) {
                badge.textContent = I18n.isRTL() 
                    ? I18n.toPersianDigits(PersonsPage._shiftTemplates.length)
                    : PersonsPage._shiftTemplates.length;
            }
            PersonsPage.renderShiftTemplates();
        } catch (err) {
            console.error('Failed to load shift templates:', err);
            const grid = document.getElementById('shifts-grid');
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <div class="empty-state-icon">⚠️</div>
                        <div class="empty-state-title">${I18n.t('err_generic', { msg: err.message || err })}</div>
                    </div>
                `;
            }
        }
    },

    /**
     * Render person cards grid with search and sorting.
     */
    renderPersons() {
        const grid = document.getElementById('persons-grid');
        if (!grid) return;

        grid.classList.toggle('list-view', PersonsPage._viewMode === 'list');

        let filtered = PersonsPage._persons;

        // Apply search filter
        if (PersonsPage._searchQuery) {
            const q = PersonsPage._searchQuery;
            filtered = filtered.filter(p => 
                (p.name && p.name.toLowerCase().includes(q)) || 
                (p.role && p.role.toLowerCase().includes(q)) ||
                (p.section && p.section.toLowerCase().includes(q))
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

            if (PersonsPage._viewMode === 'list') {
                return `
                    <div class="person-card list-item" data-person-id="${person.id}">
                        <div class="person-list-identity">
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
                            <div class="person-list-info">
                                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                    <span class="person-name" onclick="PersonAnalyticsModal.show(${person.id})" style="cursor: pointer;" title="${PersonsPage.escapeAttr(I18n.t('btn_person_analytics'))}">
                                        ${PersonsPage.escapeHtml(person.name)}
                                    </span>
                                    ${statusPill}
                                    ${person.section ? `<span class="badge badge-primary text-xs" style="font-size: 0.68rem; padding: 2px 6px;">🏢 ${PersonsPage.escapeHtml(person.section)}</span>` : ''}
                                </div>
                                <div class="person-role">
                                    ${PersonsPage.escapeHtml(person.role || I18n.t('no_role_assigned'))}
                                    ${shiftTimeStr ? ` · <span style="color: var(--accent-blue); font-weight: 600;">⏰ ${shiftTimeStr}</span>` : ''}
                                </div>
                            </div>
                        </div>

                        <div class="person-list-stats">
                            <div class="person-list-stat-badge" title="${I18n.t('kpi_total_detections')}">
                                <span>🎯</span>
                                <strong>${totalDetections}</strong>
                                <span style="font-size: 0.72rem; color: var(--text-tertiary);">${I18n.t('kpi_total_detections')}</span>
                                ${todayDetections > 0 ? `<span style="font-size: 0.7rem; color: var(--accent-emerald); font-weight: 700;">(+${todayStr})</span>` : ''}
                            </div>

                            <div class="person-list-stat-badge" title="${I18n.t('person_photos_count')}">
                                <span>📸</span>
                                <strong style="color: var(--accent-violet);">${countDisplay}</strong>
                                <span style="font-size: 0.72rem; color: var(--text-tertiary);">${I18n.t('person_photos_count')}</span>
                            </div>

                            <div style="font-size: 0.78rem; color: var(--text-tertiary); max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${PersonsPage.escapeAttr(lastSeenText)}">
                                🕒 ${lastSeenText}
                            </div>
                        </div>

                        <div class="person-actions">
                            <button class="btn btn-primary btn-sm" onclick="PersonAnalyticsModal.show(${person.id})" title="${PersonsPage.escapeAttr(I18n.t('btn_person_analytics'))}">
                                📊 <span>${I18n.t('btn_person_analytics')}</span>
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="PersonShiftModal.show(${person.id})" title="${PersonsPage.escapeAttr(I18n.t('manage_shift') || 'مدیریت شیفت')}">
                                ⏰ <span>${I18n.t('manage_shift') || 'مدیریت شیفت'}</span>
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="PersonsPage.showAddPhotosModal(${person.id}, '${PersonsPage.escapeAttr(person.name)}')" title="${PersonsPage.escapeAttr(I18n.t('add_photo_btn'))}">
                                📸 <span>${I18n.t('add_photo_btn')}</span>
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="PersonForm.showEditModal(${person.id})" title="${PersonsPage.escapeAttr(I18n.t('edit'))}">
                                ✏️ <span>${I18n.t('edit')}</span>
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="PersonsPage.deletePerson(${person.id}, '${PersonsPage.escapeAttr(person.name)}')" title="${PersonsPage.escapeAttr(I18n.t('delete'))}">
                                🗑️
                            </button>
                        </div>
                    </div>
                `;
            }

            // Grid card view
            return `
                <div class="person-card" data-person-id="${person.id}">
                    <div class="person-card-header">
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
                        <div class="person-info">
                            <h3 class="person-name" onclick="PersonAnalyticsModal.show(${person.id})" style="cursor: pointer;" title="${PersonsPage.escapeAttr(I18n.t('btn_person_analytics'))}">
                                ${PersonsPage.escapeHtml(person.name)}
                            </h3>
                            <div class="person-role">
                                ${PersonsPage.escapeHtml(person.role || I18n.t('no_role_assigned'))}
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.35rem; margin-top: 4px; flex-wrap: wrap;">
                                ${statusPill}
                                ${person.section ? `<span class="badge badge-primary text-xs" style="font-size: 0.68rem; padding: 2px 6px;">🏢 ${PersonsPage.escapeHtml(person.section)}</span>` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="person-meta" style="margin-top: 0.75rem; border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.78rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: var(--text-tertiary);">${I18n.t('kpi_total_detections')}:</span>
                            <strong style="color: var(--text-primary); font-family: monospace;">
                                🎯 ${totalDetections}
                                ${todayDetections > 0 ? `<span style="color: var(--accent-emerald); font-weight: 700;">(+${todayStr})</span>` : ''}
                            </strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: var(--text-tertiary);">${I18n.t('person_photos_count')}:</span>
                            <span style="color: var(--accent-violet); font-weight: 700;">📸 ${countDisplay}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: var(--text-tertiary);">${I18n.t('shift') || 'شیفت'}:</span>
                            <span style="color: var(--accent-blue); font-weight: 600;">${shiftTimeStr ? '⏰ ' + shiftTimeStr : (I18n.t('no_shift_assigned') || 'شناور')}</span>
                        </div>
                    </div>

                    <div class="person-card-actions" style="margin-top: 0.9rem; border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                        <button class="btn btn-primary btn-sm" onclick="PersonAnalyticsModal.show(${person.id})" title="${PersonsPage.escapeAttr(I18n.t('btn_person_analytics'))}">
                            📊 <span>${I18n.t('btn_person_analytics')}</span>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="PersonShiftModal.show(${person.id})" title="${PersonsPage.escapeAttr(I18n.t('manage_shift') || 'مدیریت شیفت')}">
                            ⏰ <span>${I18n.t('manage_shift') || 'شیفت'}</span>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="PersonsPage.showAddPhotosModal(${person.id}, '${PersonsPage.escapeAttr(person.name)}')" title="${PersonsPage.escapeAttr(I18n.t('add_photo_btn'))}">
                            📸 <span>${I18n.t('add_photo_btn')}</span>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="PersonForm.showEditModal(${person.id})" title="${PersonsPage.escapeAttr(I18n.t('edit'))}">
                            ✏️ <span>${I18n.t('edit')}</span>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="PersonsPage.deletePerson(${person.id}, '${PersonsPage.escapeAttr(person.name)}')" title="${PersonsPage.escapeAttr(I18n.t('delete'))}">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Render shift templates cards grid.
     */
    renderShiftTemplates() {
        const grid = document.getElementById('shifts-grid');
        if (!grid) return;

        const isRtl = I18n.isRTL();
        let filtered = PersonsPage._shiftTemplates;

        // Apply search query
        if (PersonsPage._shiftSearchQuery) {
            const q = PersonsPage._shiftSearchQuery;
            filtered = filtered.filter(t => 
                (t.name && t.name.toLowerCase().includes(q)) ||
                (t.shift_type && t.shift_type.toLowerCase().includes(q)) ||
                (t.start_time && t.start_time.includes(q)) ||
                (t.end_time && t.end_time.includes(q))
            );
        }

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem 1rem;">
                    <div class="empty-state-icon">⏰</div>
                    <div class="empty-state-title">${I18n.t('no_shift_templates_title') || 'هیچ شیفت پیش‌فرضی یافت نشد'}</div>
                    <div class="empty-state-text">
                        ${PersonsPage._shiftSearchQuery ? I18n.t('search_shift_templates_placeholder') : I18n.t('no_shift_templates_desc')}
                    </div>
                    ${!PersonsPage._shiftSearchQuery ? `
                        <button class="btn btn-primary" onclick="ShiftTemplateModal.show(null, null, () => PersonsPage.loadShiftTemplates())" style="margin-top: 1rem;">
                            ${I18n.t('btn_add_shift_template') || '➕ New Shift Template'}
                        </button>
                    ` : ''}
                </div>
            `;
            return;
        }

        const dayNamesFa = {
            'Sat': 'شنبه', 'Sun': 'یک‌شنبه', 'Mon': 'دوشنبه',
            'Tue': 'سه‌شنبه', 'Wed': 'چهارشنبه', 'Thu': 'پنج‌شنبه', 'Fri': 'جمعه'
        };

        grid.innerHTML = filtered.map(tmpl => {
            const isRotational = (tmpl.shift_type === 'rotational');
            const color = tmpl.color || '#38bdf8';
            const assignedCount = tmpl.assigned_persons_count || 0;
            const assignedCountStr = isRtl ? I18n.toPersianDigits(assignedCount) : assignedCount;

            // Hours display
            let hoursDisplay = '';
            if (isRotational) {
                const rp = tmpl.rotation_pattern || {};
                const dStart = rp.day_start || '07:00';
                const dEnd = rp.day_end || '19:00';
                const nStart = rp.night_start || '19:00';
                const nEnd = rp.night_end || '07:00';
                hoursDisplay = `☀️ ${dStart}-${dEnd} · 🌙 ${nStart}-${nEnd}`;
            } else {
                const sTime = tmpl.start_time || '08:00';
                const eTime = tmpl.end_time || '16:00';
                const isOvernight = eTime < sTime;
                hoursDisplay = `${sTime} — ${eTime}${isOvernight ? ' 🌙' : ''}`;
            }

            // Days or cycle chips
            let daysOrCycleHtml = '';
            if (isRotational) {
                const cycle = tmpl.rotation_pattern?.cycle || [];
                daysOrCycleHtml = cycle.map((st, idx) => {
                    let icon = '☀️';
                    let label = isRtl ? 'روز' : 'D';
                    let bg = 'rgba(245, 158, 11, 0.15)';
                    let c = '#fbbf24';
                    if (st === 'night') {
                        icon = '🌙';
                        label = isRtl ? 'شب' : 'N';
                        bg = 'rgba(139, 92, 246, 0.15)';
                        c = '#a78bfa';
                    } else if (st === 'off') {
                        icon = '☕';
                        label = isRtl ? 'آف' : 'Off';
                        bg = 'rgba(100, 116, 139, 0.2)';
                        c = '#94a3b8';
                    }
                    return `
                        <span style="display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: ${bg}; color: ${c}; border: 1px solid rgba(255, 255, 255, 0.06);">
                            <span>${icon}</span>
                            <span>${label} ${isRtl ? I18n.toPersianDigits(idx + 1) : (idx + 1)}</span>
                        </span>
                    `;
                }).join('');
            } else {
                const activeDays = tmpl.active_days || [];
                if (activeDays.length === 7) {
                    daysOrCycleHtml = `<span class="badge badge-subtle" style="font-size: 0.72rem; padding: 2px 7px;">📅 ${I18n.t('days_all_7') || 'تمام ۷ روز'}</span>`;
                } else {
                    daysOrCycleHtml = activeDays.map(d => {
                        const dLabel = isRtl ? (dayNamesFa[d] || d) : d;
                        return `<span class="badge badge-subtle" style="font-size: 0.7rem; padding: 2px 6px;">${dLabel}</span>`;
                    }).join(' ');
                }
            }

            // Breaks summary
            let breaksSummaryHtml = '';
            if (tmpl.free_times && tmpl.free_times.length > 0) {
                breaksSummaryHtml = `
                    <span style="background: rgba(16, 185, 129, 0.12); color: #34d399; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.25);" title="${tmpl.free_times.map(b => b.name + ' (' + b.start_time + '-' + b.end_time + ')').join(', ')}">
                        🍽️ ${tmpl.free_times.length} ${isRtl ? 'زنگ استراحت' : 'break(s)'}
                    </span>
                `;
            }

            const assignedStaffText = assignedCount > 0
                ? (I18n.t('assigned_staff_count', { count: assignedCountStr }) || `${assignedCountStr} نفر پرسنل منتسب`)
                : (I18n.t('no_staff_assigned') || 'بدون پرسنل منتسب');

            return `
                <div class="shift-template-card" style="background: var(--bg-surface-hover); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.15rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.9rem; transition: transform 0.15s, border-color 0.15s; border-top: 3px solid ${color};">
                    <div>
                        <!-- Header -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.6rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0;">
                                <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${color}; box-shadow: 0 0 8px ${color}; flex-shrink: 0;"></span>
                                <strong style="font-size: 1rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${PersonsPage.escapeHtml(tmpl.name)}
                                </strong>
                            </div>
                            <span class="badge ${isRotational ? 'badge-warning' : 'badge-primary'}" style="font-size: 0.68rem; padding: 2px 7px; font-weight: 700; flex-shrink: 0;">
                                ${isRotational ? '🔄 ' + (I18n.t('rotational_shift') || 'چرخشی') : '☀️ ' + (I18n.t('shift_mode_fixed') || 'ثابت')}
                            </span>
                        </div>

                        <!-- Hours -->
                        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.88rem; color: var(--text-primary); font-family: monospace; font-weight: 700; margin-bottom: 0.5rem;">
                            <span>⏰</span>
                            <span style="direction: ltr;">${hoursDisplay}</span>
                        </div>

                        <!-- Days / Cycles -->
                        <div style="display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.65rem;">
                            ${daysOrCycleHtml}
                        </div>

                        <!-- Tolerances & Breaks -->
                        <div style="display: flex; flex-wrap: wrap; gap: 0.45rem; font-size: 0.73rem; color: var(--text-secondary); margin-top: 0.35rem;">
                            <span style="background: var(--bg-surface); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">
                                ⏱️ ${isRtl ? 'تاخیر:' : 'Grace:'} ${tmpl.grace_period_minutes ?? 10}m
                            </span>
                            <span style="background: var(--bg-surface); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">
                                🚨 ${isRtl ? 'هشدار:' : 'Alert:'} ${tmpl.absence_timeout_minutes ?? 2}m
                            </span>
                            ${breaksSummaryHtml}
                        </div>
                    </div>

                    <!-- Bottom: Assigned staff and actions -->
                    <div style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 600; color: ${assignedCount > 0 ? 'var(--accent-blue)' : 'var(--text-tertiary)'};">
                            <span>👥</span>
                            <span>${assignedStaffText}</span>
                        </div>

                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="PersonsPage.duplicateShiftTemplate(${tmpl.id})" title="${I18n.t('duplicate_shift_template_btn') || 'تکثیر'}" style="padding: 3px 8px; font-size: 0.75rem;">
                                📋 <span>${I18n.t('duplicate_shift_template_btn') || 'تکثیر'}</span>
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="PersonsPage.editShiftTemplate(${tmpl.id})" title="${I18n.t('edit') || 'ویرایش'}" style="padding: 3px 8px; font-size: 0.75rem;">
                                ✏️ <span>${I18n.t('edit') || 'ویرایش'}</span>
                            </button>
                            <button type="button" class="btn btn-danger btn-sm" onclick="PersonsPage.deleteShiftTemplate(${tmpl.id}, '${PersonsPage.escapeAttr(tmpl.name)}', ${assignedCount})" title="${I18n.t('delete') || 'حذف'}" style="padding: 3px 8px; font-size: 0.75rem;">
                                🗑️
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Open ShiftTemplateModal in edit mode.
     */
    editShiftTemplate(templateId) {
        ShiftTemplateModal.show(templateId, null, () => PersonsPage.loadShiftTemplates());
    },

    /**
     * Duplicate an existing shift template.
     */
    duplicateShiftTemplate(templateId) {
        const tmpl = PersonsPage._shiftTemplates.find(t => t.id === templateId);
        if (!tmpl) return;
        ShiftTemplateModal.show(null, tmpl, () => PersonsPage.loadShiftTemplates());
    },

    /**
     * Delete a shift template with safety confirmation.
     */
    async deleteShiftTemplate(templateId, name, assignedCount) {
        let warning = '';
        if (assignedCount > 0) {
            warning = I18n.t('delete_shift_warning_assigned', {
                count: I18n.isRTL() ? I18n.toPersianDigits(assignedCount) : assignedCount
            }) || `توجه: ${assignedCount} نفر از پرسنل به این شیفت اختصاص دارند و به حالت شناور تغییر خواهند یافت.`;
        }

        const confirmMsg = I18n.t('confirm_delete_shift_template', {
            name: name,
            warning: warning
        }) || `آیا از حذف قالب شیفت «${name}» اطمینان دارید؟\n${warning}`;

        if (!confirm(confirmMsg)) return;

        try {
            await App.api(`/api/shift-templates/${templateId}`, 'DELETE');
            App.toast(I18n.t('shift_template_deleted_success') || 'قالب شیفت با موفقیت حذف گردید.', 'success');
            await Promise.all([
                PersonsPage.loadShiftTemplates(),
                PersonsPage.loadPersons(),
            ]);
        } catch (err) {
            console.error('Failed to delete shift template:', err);
            App.toast(I18n.t('err_generic', { msg: err.message || err }), 'error');
        }
    },

    /**
     * Show add person modal.
     */
    showAddModal(options = {}) {
        PersonForm.reset();
        App.openModal(PersonForm.renderModal(options), 'modal-lg');
        PersonForm.initModalState(options);
    },

    /**
     * Show add photos modal for existing person.
     */
    showAddPhotosModal(personId, personName) {
        PersonForm.showAddPhotosModal(personId, personName);
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
