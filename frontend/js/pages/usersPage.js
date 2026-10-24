/**
 * UsersPage — Comprehensive User Management and Dynamic Roles & Permissions (RBAC).
 * Supports:
 *   - Tab 1: User Accounts listing, creation, role assignment, custom permissions, and password resets.
 *   - Tab 2: Dynamic Roles & Permissions management, custom role creation, granular permission matrix editor.
 */
const UsersPage = {
    _activeTab: 'users', // 'users' | 'roles' | 'sections'
    _users: [],
    _roles: [],
    _sections: [],
    _cameras: [],
    _persons: [],
    _permissionsRegistry: null,

    async load() {
        const headerActions = document.getElementById('header-actions');
        const pageTitle = document.getElementById('page-title');
        const contentBody = document.getElementById('content-body');

        if (pageTitle) pageTitle.textContent = I18n.t('nav_users') || 'مدیریت کاربران و دسترسی‌ها';

        // Render Page Layout with Tabs
        contentBody.innerHTML = `
            <div class="users-page-container">
                <!-- Sub-navigation Tabs -->
                <div class="page-segmented-control mb-4">
                    <button class="segmented-tab ${this._activeTab === 'users' ? 'active' : ''}" id="tab-btn-users" onclick="UsersPage.switchTab('users')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; flex-shrink: 0;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        <span>${I18n.t('tab_users') || 'کاربران سیستم'}</span>
                        <span class="badge badge-subtle ml-2" id="users-count-badge">0</span>
                    </button>
                    <button class="segmented-tab ${this._activeTab === 'roles' ? 'active' : ''}" id="tab-btn-roles" onclick="UsersPage.switchTab('roles')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; flex-shrink: 0;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                        <span>${I18n.t('tab_roles') || 'نقش‌ها و دسترسی‌ها'}</span>
                        <span class="badge badge-subtle ml-2" id="roles-count-badge">0</span>
                    </button>
                    <button class="segmented-tab ${this._activeTab === 'sections' ? 'active' : ''}" id="tab-btn-sections" onclick="UsersPage.switchTab('sections')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; flex-shrink: 0;"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        <span>${I18n.t('tab_sections') || 'بخش‌های کارخانه'}</span>
                        <span class="badge badge-subtle ml-2" id="sections-count-badge">0</span>
                    </button>
                </div>

                <!-- Tab Content Body -->
                <div id="users-tab-content">
                    <div class="loading-spinner-container">
                        <div class="spinner-border"></div>
                        <span>${I18n.t('loading') || 'در حال بارگذاری اطلاعات...'}</span>
                    </div>
                </div>
            </div>
        `;

        await this.refreshData();
    },

    async refreshData() {
        try {
            const [users, roles, permsRes, sections, cameras, persons] = await Promise.all([
                App.api('/api/users'),
                App.api('/api/roles'),
                App.api('/api/roles/permissions-registry'),
                App.api('/api/sections').catch(() => []),
                App.api('/api/cameras').catch(() => []),
                App.api('/api/persons').catch(() => []),
            ]);

            this._users = users || [];
            this._roles = roles || [];
            this._permissionsRegistry = permsRes;
            this._sections = sections || [];
            this._cameras = cameras || [];
            this._persons = persons || [];

            const uBadge = document.getElementById('users-count-badge');
            if (uBadge) uBadge.textContent = this._users.length;

            const rBadge = document.getElementById('roles-count-badge');
            if (rBadge) rBadge.textContent = this._roles.length;

            const sBadge = document.getElementById('sections-count-badge');
            if (sBadge) sBadge.textContent = this._sections.length;

            this.renderActiveTab();
        } catch (err) {
            console.error('Failed to load users/roles data:', err);
            const container = document.getElementById('users-tab-content');
            if (container) {
                container.innerHTML = `
                    <div class="alert alert-danger">
                        ${I18n.t('error_loading_data') || 'خطا در دریافت اطلاعات کاربران و نقش‌ها'}: ${this._escape(err.message)}
                    </div>
                `;
            }
        }
    },

    switchTab(tabName) {
        this._activeTab = tabName;
        document.querySelectorAll('.segmented-tab').forEach(btn => {
            btn.classList.toggle('active', btn.id === `tab-btn-${tabName}`);
        });
        this.renderActiveTab();
    },

    renderActiveTab() {
        const headerActions = document.getElementById('header-actions');
        const container = document.getElementById('users-tab-content');
        if (!container) return;

        const canManage = Auth.hasPermission('users:manage');

        if (this._activeTab === 'users') {
            if (headerActions) {
                headerActions.innerHTML = canManage ? `
                    <button class="btn btn-primary d-inline-flex align-items-center" onclick="UsersPage.openUserModal()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; margin-inline-end: 6px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>${I18n.t('add_user') || 'کاربر جدید'}</span>
                    </button>
                ` : '';
            }
            this._renderUsersTab(container);
        } else if (this._activeTab === 'roles') {
            if (headerActions) {
                headerActions.innerHTML = canManage ? `
                    <button class="btn btn-primary d-inline-flex align-items-center" onclick="UsersPage.openRoleModal()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; margin-inline-end: 6px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>${I18n.t('add_role') || 'نقش جدید'}</span>
                    </button>
                ` : '';
            }
            this._renderRolesTab(container);
        } else {
            if (headerActions) {
                headerActions.innerHTML = canManage ? `
                    <button class="btn btn-primary d-inline-flex align-items-center" onclick="UsersPage.openSectionModal()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; margin-inline-end: 6px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>${I18n.t('add_section') || 'بخش جدید'}</span>
                    </button>
                ` : '';
            }
            this._renderSectionsTab(container);
        }
    },

    // ═══════════════════════════════════════════════════════
    // TAB 1: USERS LIST & MANAGEMENT
    // ═══════════════════════════════════════════════════════
    _renderUsersTab(container) {
        const canManage = Auth.hasPermission('users:manage');

        if (this._users.length === 0) {
            container.innerHTML = `
                <div class="empty-state-card text-center p-5">
                    <div class="empty-icon" style="font-size: 3rem;">👥</div>
                    <h3>${I18n.t('no_users_found') || 'هیچ کاربری یافت نشد'}</h3>
                </div>
            `;
            return;
        }

        let rowsHtml = '';
        this._users.forEach(user => {
            const roleClass = user.role_name === 'admin' ? 'badge-role-admin' :
                              user.role_name === 'supervisor' ? 'badge-role-supervisor' :
                              user.role_name === 'operator' ? 'badge-role-operator' : 'badge-role-viewer';

            const statusBadge = user.is_active
                ? `<span class="badge badge-success">${I18n.t('active') || 'فعال'}</span>`
                : `<span class="badge badge-danger">${I18n.t('inactive') || 'غیرفعال'}</span>`;

            const lastLoginStr = user.last_login
                ? I18n.formatFullTimestamp(user.last_login)
                : (I18n.t('never_logged_in') || 'هنوز وارد نشده');

            const customPermsCount = (user.custom_permissions || []).length;
            const customPermsBadge = customPermsCount > 0
                ? `<span class="badge badge-info" title="${(user.custom_permissions || []).join(', ')}">+${customPermsCount} سفارشی</span>`
                : `<span class="text-muted text-sm">—</span>`;

            // Build Supervisor / User Scope Badges
            let scopeBadges = '';
            if (user.role_name === 'admin') {
                scopeBadges = `<span class="badge badge-subtle">دسترسی سراسری (مدیر)</span>`;
            } else {
                const parts = [];
                if (user.assigned_sections && user.assigned_sections.length) {
                    parts.push(...user.assigned_sections.map(s => `<span class="badge badge-primary text-xs" style="margin: 2px;">🏢 ${this._escape(s)}</span>`));
                }
                if (user.assigned_camera_ids && user.assigned_camera_ids.length) {
                    parts.push(`<span class="badge badge-subtle text-xs" style="margin: 2px;" title="دوربین‌های منتسب">📹 ${user.assigned_camera_ids.length}</span>`);
                }
                if (user.assigned_person_ids && user.assigned_person_ids.length) {
                    parts.push(`<span class="badge badge-subtle text-xs" style="margin: 2px;" title="پرسنل منتسب">👤 ${user.assigned_person_ids.length}</span>`);
                }
                if (parts.length > 0) {
                    scopeBadges = `<div class="d-flex flex-wrap gap-1">${parts.join('')}</div>`;
                } else if (user.role_name === 'supervisor') {
                    scopeBadges = `<span class="badge badge-warning text-xs">بدون انتساب بخش</span>`;
                } else {
                    scopeBadges = `<span class="text-muted text-xs">—</span>`;
                }
            }

            rowsHtml += `
                <tr>
                    <td>
                        <div class="d-flex align-items-center gap-2">
                            <div class="user-avatar-circle sm">
                                ${user.full_name ? user.full_name.charAt(0).toUpperCase() : '👤'}
                            </div>
                            <div>
                                <div class="font-weight-bold">${this._escape(user.full_name)}</div>
                                <small class="text-muted">@${this._escape(user.username)}</small>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="user-role-badge ${roleClass}">
                            ${this._escape(user.role_display_name || user.role_name || 'بدون نقش')}
                        </span>
                    </td>
                    <td>${scopeBadges}</td>
                    <td>${customPermsBadge}</td>
                    <td>${statusBadge}</td>
                    <td><small class="text-muted">${lastLoginStr}</small></td>
                    <td>
                        ${canManage ? `
                            <div class="btn-group-actions">
                                <button class="btn-action-btn btn-action-edit" title="${I18n.t('edit') || 'ویرایش'}" onclick="UsersPage.openUserModal(${user.id})">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                </button>
                                <button class="btn-action-btn btn-action-key" title="${I18n.t('reset_password') || 'بازنشانی کلمه عبور'}" onclick="UsersPage.openResetPasswordModal(${user.id}, '${this._escape(user.username)}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-1.5 1.5L14 9M3 15a6 6 0 1 1 10.2 4.2L21 11.4V8h-3.4L15.3 10.3A6 6 0 0 1 3 15z"></path></svg>
                                </button>
                                ${user.id !== Auth.getUser()?.id ? `
                                    <button class="btn-action-btn btn-action-delete" title="${I18n.t('delete') || 'حذف'}" onclick="UsersPage.deleteUser(${user.id}, '${this._escape(user.username)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                    </button>
                                ` : ''}
                            </div>
                        ` : '<span class="text-muted">—</span>'}
                    </td>
                </tr>
            `;
        });

        container.innerHTML = `
            <div class="table-responsive card-glass">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>${I18n.t('user_fullname') || 'کاربر'}</th>
                            <th>${I18n.t('role') || 'نقش'}</th>
                            <th>${I18n.t('col_assigned_section') || 'بخش / محدوده نظارت'}</th>
                            <th>${I18n.t('custom_permissions') || 'دسترسی‌های اختصاصی'}</th>
                            <th>${I18n.t('status') || 'وضعیت'}</th>
                            <th>${I18n.t('last_login') || 'آخرین ورود'}</th>
                            <th style="width: 130px;">${I18n.t('actions') || 'عملیات'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    },

    // ═══════════════════════════════════════════════════════
    // TAB 2: ROLES & PERMISSIONS MATRIX
    // ═══════════════════════════════════════════════════════
    // TAB 2: ROLES & PERMISSIONS MATRIX
    // ═══════════════════════════════════════════════════════
    _getPermissionMeta(permKey) {
        if (!this._permissionsRegistry || !this._permissionsRegistry.sections) {
            return { label: permKey, desc: '', sectionTitle: '' };
        }
        const isFa = I18n.isRTL() || I18n.currentLang === 'fa';
        for (const sec of this._permissionsRegistry.sections) {
            for (const p of sec.permissions) {
                if (p.key === permKey) {
                    return {
                        label: (isFa ? p.label_fa : p.label_en) || p.key,
                        desc: (isFa ? p.description_fa : p.description_en) || '',
                        sectionTitle: (isFa ? sec.title_fa : sec.title_en) || sec.id,
                    };
                }
            }
        }
        return { label: permKey, desc: '', sectionTitle: '' };
    },

    _getRoleTheme(roleName) {
        switch (roleName) {
            case 'admin':
                return {
                    themeClass: 'role-theme-admin',
                    icon: '👑',
                    color: '#f59e0b',
                    badgeText: I18n.t('role_admin_badge') || 'مدیر کل سیستم',
                };
            case 'supervisor':
                return {
                    themeClass: 'role-theme-supervisor',
                    icon: '⚡',
                    color: '#8b5cf6',
                    badgeText: I18n.t('role_supervisor_badge') || 'سرپرست ارشد',
                };
            case 'operator':
                return {
                    themeClass: 'role-theme-operator',
                    icon: '🛡️',
                    color: '#06b6d4',
                    badgeText: I18n.t('role_operator_badge') || 'اپراتور امنیتی',
                };
            case 'viewer':
                return {
                    themeClass: 'role-theme-viewer',
                    icon: '👁️',
                    color: '#10b981',
                    badgeText: I18n.t('role_viewer_badge') || 'ناظر / بازرس',
                };
            default:
                return {
                    themeClass: 'role-theme-custom',
                    icon: '🧩',
                    color: '#ec4899',
                    badgeText: I18n.t('role_custom_badge') || 'نقش سفارشی',
                };
        }
    },

    _renderRolesTab(container) {
        const canManage = Auth.hasPermission('users:manage');
        const isFa = I18n.isRTL() || I18n.currentLang === 'fa';

        if (this._roles.length === 0) {
            container.innerHTML = `
                <div class="empty-state-card text-center p-5">
                    <div class="empty-icon" style="font-size: 3rem;">🛡️</div>
                    <h3>${I18n.t('no_roles_found') || 'هیچ نقشی تعریف نشده است'}</h3>
                </div>
            `;
            return;
        }

        let rolesGridHtml = '';
        this._roles.forEach(role => {
            const isAdmin = role.name === 'admin' || (role.permissions || []).includes('*');
            const permCount = isAdmin
                ? (this._permissionsRegistry?.all_permissions?.length || 22)
                : (role.permissions || []).length;

            const isSystem = role.is_system || ['admin', 'supervisor', 'operator', 'viewer'].includes(role.name);
            const theme = this._getRoleTheme(role.name);

            // Preview top permission tags in active language (Persian!)
            let permsPreview = '';
            if (isAdmin) {
                permsPreview = `
                    <div class="role-perm-admin-banner">
                        <span class="admin-star-icon">👑</span>
                        <span>${I18n.t('all_permissions_granted') || 'دسترسی کامل به تمامی بخش‌های سامانه (*)'}</span>
                    </div>
                `;
            } else {
                const perms = role.permissions || [];
                if (perms.length === 0) {
                    permsPreview = `<span class="text-muted text-xs">${I18n.t('no_permissions_assigned') || 'بدون دسترسی'}</span>`;
                } else {
                    const topChips = perms.slice(0, 4).map(p => {
                        const meta = this._getPermissionMeta(p);
                        return `<span class="role-perm-chip" title="${this._escape(meta.desc || meta.label)}">${this._escape(meta.label)}</span>`;
                    }).join('');

                    const rem = perms.length - 4;
                    let remChip = '';
                    if (rem > 0) {
                        const remTitles = perms.slice(4).map(p => this._getPermissionMeta(p).label).join(' | ');
                        remChip = `<span class="role-perm-chip role-perm-more" title="${this._escape(remTitles)}">+${isFa ? I18n.toPersianDigits(rem) : rem} ${I18n.t('more_permissions_badge') ? I18n.t('more_permissions_badge').replace('+{count} ', '') : 'دسترسی دیگر'}</span>`;
                    }
                    permsPreview = topChips + remChip;
                }
            }

            const userCountDisplay = isFa ? I18n.toPersianDigits(role.user_count || 0) : (role.user_count || 0);
            const permCountDisplay = isFa ? I18n.toPersianDigits(permCount) : permCount;

            rolesGridHtml += `
                <div class="role-card-item ${theme.themeClass}">
                    <div class="role-card-header">
                        <div class="role-header-top">
                            <div class="role-identity">
                                <div class="role-icon-box">
                                    <span>${theme.icon}</span>
                                </div>
                                <div class="role-title-group">
                                    <div class="d-flex align-items-center gap-2 flex-wrap">
                                        <h3 class="role-display-name">${this._escape(role.display_name)}</h3>
                                        <span class="role-type-badge ${isSystem ? 'system' : 'custom'}">
                                            ${isSystem ? (I18n.t('role_type_system') || 'سیستمی') : (I18n.t('role_type_custom') || 'سفارشی')}
                                        </span>
                                    </div>
                                    <code class="role-slug-badge">@${this._escape(role.name)}</code>
                                </div>
                            </div>
                            <div class="role-users-count-pill" title="${userCountDisplay} ${I18n.t('users') || 'کاربر'}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                <span>${userCountDisplay} ${I18n.t('users') || 'کاربر'}</span>
                            </div>
                        </div>
                    </div>

                    <div class="role-card-body">
                        <p class="role-card-desc">${this._escape(role.description || I18n.t('no_description') || 'بدون شرح وظایف')}</p>

                        <div class="role-perms-summary">
                            <div class="role-perms-header">
                                <span class="role-perms-label">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 13px; height: 13px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                                    <span>${I18n.t('permissions') || 'سطوح دسترسی'}</span>
                                </span>
                                <span class="role-perms-counter-badge ${isAdmin ? 'admin' : ''}">
                                    ${isAdmin ? (I18n.t('all_permissions') || 'دسترسی جامع (*)') : `${permCountDisplay} ${I18n.t('active_permissions') || 'دسترسی مجاز'}`}
                                </span>
                            </div>
                            <div class="role-tags-wrap">
                                ${permsPreview}
                            </div>
                        </div>
                    </div>

                    <div class="role-card-footer">
                        ${canManage ? `
                            <button class="btn-role-action edit-action" onclick="UsersPage.openRoleModal(${role.id})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>${I18n.t('edit_role_permissions') || 'ویرایش دسترسی‌ها'}</span>
                            </button>
                            ${!isSystem ? `
                                <button class="btn-role-action delete-action" title="${I18n.t('delete') || 'حذف نقش'}" onclick="UsersPage.deleteRole(${role.id}, '${this._escape(role.display_name)}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                </button>
                            ` : ''}
                        ` : ''}
                    </div>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="roles-tab-wrapper">
                <div class="roles-intro-bar card-glass mb-4">
                    <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
                        <div class="d-flex align-items-center gap-3">
                            <div class="roles-intro-icon">🛡️</div>
                            <div>
                                <h3 class="m-0 font-weight-bold" style="font-size: 1.05rem;">${I18n.t('tab_roles') || 'نقش‌ها و دسترسی‌های سامانه (RBAC)'}</h3>
                                <p class="text-muted m-0 text-xs mt-1">${I18n.t('roles_header_desc') || 'تعریف نقش‌های کاربری، تنظیم سطوح دسترسی تفکیک‌شده به بخش‌های مختلف'}</p>
                            </div>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span class="badge badge-subtle px-3 py-2">
                                ${isFa ? I18n.toPersianDigits(this._roles.length) : this._roles.length} نقش فعال در سامانه
                            </span>
                        </div>
                    </div>
                </div>
                <div class="roles-grid">
                    ${rolesGridHtml}
                </div>
            </div>
        `;
    },

    // ═══════════════════════════════════════════════════════
    // USER MODAL (ADD / EDIT)
    // ═══════════════════════════════════════════════════════
    openUserModal(userId = null) {
        const user = userId ? this._users.find(u => u.id === userId) : null;
        const isEdit = !!user;

        let roleOptions = '';
        this._roles.forEach(r => {
            const selected = (user && user.role_id === r.id) || (!user && r.name === 'operator') ? 'selected' : '';
            roleOptions += `<option value="${r.id}" ${selected}>${this._escape(r.display_name)} (${this._escape(r.name)})</option>`;
        });

        // Scope settings
        const userAssignedSections = new Set(user ? (user.assigned_sections || []) : []);
        const userAssignedCameras = new Set(user ? (user.assigned_camera_ids || []) : []);
        const userAssignedPersons = new Set(user ? (user.assigned_person_ids || []) : []);
        const hasScope = userAssignedSections.size > 0 || userAssignedCameras.size > 0 || userAssignedPersons.size > 0 || (user && user.role_name === 'supervisor');

        // Build Custom Permissions matrix
        const userCustomPerms = new Set(user ? (user.custom_permissions || []) : []);
        const permsMatrixHtml = this._buildPermissionsCheckboxGrid('user-custom-perm', userCustomPerms);

        const modalHtml = `
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">${isEdit ? '✏️' : '👤'}</span>
                    <div>
                        <h2 class="modal-title">${isEdit ? (I18n.t('edit_user') || 'ویرایش کاربر') : (I18n.t('add_user') || 'افزودن کاربر جدید')}</h2>
                        <p class="modal-subtitle">${isEdit ? user.username : (I18n.t('add_user_sub') || 'مشخصات حساب کاربری و نقش آن را مشخص نمایید')}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body">
                <div id="user-form-error" class="alert alert-danger" style="display: none; margin-bottom: 1rem;"></div>

                <form id="user-edit-form" onsubmit="UsersPage._saveUser(event, ${userId || 'null'})">
                    <div class="row g-3 mb-3">
                        <div class="col-md-6">
                            <label for="form-user-fullname" class="form-label">${I18n.t('fullname') || 'نام و نام خانوادگی'} *</label>
                            <input type="text" id="form-user-fullname" class="form-control" required value="${isEdit ? this._escape(user.full_name) : ''}">
                        </div>
                        <div class="col-md-6">
                            <label for="form-user-username" class="form-label">${I18n.t('username') || 'نام کاربری'} *</label>
                            <input type="text" id="form-user-username" class="form-control" required ${isEdit ? 'readonly disabled' : ''} value="${isEdit ? this._escape(user.username) : ''}">
                        </div>
                    </div>

                    <div class="row g-3 mb-3">
                        <div class="col-md-6">
                            <label for="form-user-password" class="form-label">${isEdit ? (I18n.t('new_password_optional') || 'کلمه عبور جدید (اختیاری)') : (I18n.t('password') || 'کلمه عبور *')}</label>
                            <input type="password" id="form-user-password" class="form-control" ${isEdit ? '' : 'required'} minlength="4" placeholder="${isEdit ? '•••••••• (تغییری نمی‌کند)' : ''}">
                        </div>
                        <div class="col-md-6">
                            <label for="form-user-role" class="form-label">${I18n.t('role') || 'نقش سازمانی'} *</label>
                            <select id="form-user-role" class="form-control form-select">
                                ${roleOptions}
                            </select>
                        </div>
                    </div>

                    <div class="form-check form-switch mb-4">
                        <input class="form-check-input" type="checkbox" id="form-user-active" ${!isEdit || user.is_active ? 'checked' : ''}>
                        <label class="form-check-label font-weight-bold" for="form-user-active">${I18n.t('user_active_toggle') || 'حساب کاربری فعال باشد'}</label>
                    </div>

                    <!-- Collapsible Supervisor Scope & Section Assignment -->
                    <div class="user-scope-accordion card-glass p-3 mb-4">
                        <div class="d-flex align-items-center justify-content-between cursor-pointer" onclick="UsersPage.toggleUserScopeSection()">
                            <div>
                                <span class="font-weight-bold">🏢 ${I18n.t('supervisor_scope_heading') || 'محدوده نظارت سرپرست (بخش‌ها، دوربین‌ها و پرسنل)'}</span>
                                <small class="text-muted d-block">${I18n.t('supervisor_scope_hint') || 'برای سرپرستان و اپراتورها، بخش‌ها یا دوربین‌ها و پرسنل مجاز را تعیین کنید'}</small>
                            </div>
                            <span id="user-scope-arrow">${hasScope ? '▲' : '▼'}</span>
                        </div>

                        <div id="user-scope-container" style="display: ${hasScope ? 'block' : 'none'}; margin-top: 1rem;">
                            <!-- 1. Factory Sections Selection -->
                            <div class="mb-3">
                                <div class="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                                    <label class="form-label font-weight-bold m-0">🏭 ${I18n.t('tab_sections') || 'بخش‌های تحت نظارت'}</label>
                                    <button type="button" class="btn btn-sm btn-subtle text-xs" onclick="UsersPage.autoSelectScopeResources()">
                                        ⚡ ${I18n.t('btn_autoselect_resources') || 'انتخاب خودکار دوربین‌ها و پرسنل بخش‌های انتخاب‌شده'}
                                    </button>
                                </div>
                                <div class="d-flex flex-wrap gap-2 p-2 rounded" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color, #333);">
                                    ${(this._sections || []).length === 0 ? `<span class="text-muted text-xs">هیچ بخشی تعریف نشده است.</span>` :
                                        (this._sections || []).map(sec => {
                                            const checked = userAssignedSections.has(sec.name) ? 'checked' : '';
                                            return `
                                                <label class="form-check m-0 d-flex align-items-center gap-1 cursor-pointer" style="padding: 4px 8px; border-radius: 6px; background: rgba(255,255,255,0.04);">
                                                    <input type="checkbox" class="user-scope-sec-cb form-check-input m-0" value="${this._escape(sec.name)}" ${checked}>
                                                    <span class="text-sm font-weight-bold">${this._escape(sec.name)}</span>
                                                    <span class="badge badge-subtle text-xs">(${sec.camera_count || 0}د / ${sec.person_count || 0}ن)</span>
                                                </label>
                                            `;
                                        }).join('')
                                    }
                                </div>
                            </div>

                            <div class="row g-3">
                                <!-- 2. Allowed Cameras Selection -->
                                <div class="col-md-6">
                                    <div class="d-flex align-items-center justify-content-between mb-1">
                                        <label class="form-label font-weight-bold m-0 text-sm">📹 ${I18n.t('cameras') || 'دوربین‌های مجاز'}</label>
                                        <div class="d-flex gap-1">
                                            <button type="button" class="btn btn-link text-xs p-0 text-decoration-none" onclick="UsersPage.toggleAllScopeCams(true)">${I18n.t('all') || 'همه'}</button>
                                            <span class="text-muted text-xs">|</span>
                                            <button type="button" class="btn btn-link text-xs p-0 text-decoration-none" onclick="UsersPage.toggleAllScopeCams(false)">${I18n.t('none') || 'هیچ'}</button>
                                        </div>
                                    </div>
                                    <input type="text" class="form-control form-control-sm mb-2" placeholder="جستجوی دوربین..." oninput="UsersPage.filterScopeList(this, 'user-scope-cam-item')">
                                    <div class="scope-resource-list" style="max-height: 180px; overflow-y: auto; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color, #333); border-radius: 6px; padding: 6px;">
                                        ${(this._cameras || []).length === 0 ? `<div class="text-muted text-xs p-2">دوربینی یافت نشد.</div>` :
                                            (this._cameras || []).map(cam => {
                                                const checked = userAssignedCameras.has(cam.id) ? 'checked' : '';
                                                return `
                                                    <div class="form-check scope-resource-item user-scope-cam-item py-1" data-search="${this._escape(cam.name.toLowerCase())} ${cam.section ? this._escape(cam.section.toLowerCase()) : ''}">
                                                        <label class="d-flex align-items-center justify-content-between w-100 cursor-pointer text-xs m-0">
                                                            <div class="d-flex align-items-center gap-2">
                                                                <input type="checkbox" class="user-scope-cam-cb form-check-input m-0" value="${cam.id}" data-section="${this._escape(cam.section || '')}" ${checked}>
                                                                <span>${this._escape(cam.name)}</span>
                                                            </div>
                                                            <span class="badge ${cam.section ? 'badge-primary' : 'badge-subtle'} text-xxs">${this._escape(cam.section || 'عمومی')}</span>
                                                        </label>
                                                    </div>
                                                `;
                                            }).join('')
                                        }
                                    </div>
                                </div>

                                <!-- 3. Allowed Persons Selection -->
                                <div class="col-md-6">
                                    <div class="d-flex align-items-center justify-content-between mb-1">
                                        <label class="form-label font-weight-bold m-0 text-sm">👤 ${I18n.t('persons') || 'پرسنل مجاز'}</label>
                                        <div class="d-flex gap-1">
                                            <button type="button" class="btn btn-link text-xs p-0 text-decoration-none" onclick="UsersPage.toggleAllScopePersons(true)">${I18n.t('all') || 'همه'}</button>
                                            <span class="text-muted text-xs">|</span>
                                            <button type="button" class="btn btn-link text-xs p-0 text-decoration-none" onclick="UsersPage.toggleAllScopePersons(false)">${I18n.t('none') || 'هیچ'}</button>
                                        </div>
                                    </div>
                                    <input type="text" class="form-control form-control-sm mb-2" placeholder="جستجوی پرسنل..." oninput="UsersPage.filterScopeList(this, 'user-scope-per-item')">
                                    <div class="scope-resource-list" style="max-height: 180px; overflow-y: auto; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color, #333); border-radius: 6px; padding: 6px;">
                                        ${(this._persons || []).length === 0 ? `<div class="text-muted text-xs p-2">پرسنلی یافت نشد.</div>` :
                                            (this._persons || []).map(p => {
                                                const checked = userAssignedPersons.has(p.id) ? 'checked' : '';
                                                const subText = p.person_id || p.national_id || '';
                                                return `
                                                    <div class="form-check scope-resource-item user-scope-per-item py-1" data-search="${this._escape(p.name.toLowerCase())} ${this._escape(subText.toLowerCase())} ${p.section ? this._escape(p.section.toLowerCase()) : ''}">
                                                        <label class="d-flex align-items-center justify-content-between w-100 cursor-pointer text-xs m-0">
                                                            <div class="d-flex align-items-center gap-2">
                                                                <input type="checkbox" class="user-scope-per-cb form-check-input m-0" value="${p.id}" data-section="${this._escape(p.section || '')}" ${checked}>
                                                                <span>${this._escape(p.name)}</span>
                                                            </div>
                                                            <span class="badge ${p.section ? 'badge-primary' : 'badge-subtle'} text-xxs">${this._escape(p.section || p.department || 'بدون بخش')}</span>
                                                        </label>
                                                    </div>
                                                `;
                                            }).join('')
                                        }
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Collapsible Custom Permissions Override -->
                    <div class="custom-perms-accordion card-glass p-3 mb-4">
                        <div class="d-flex align-items-center justify-content-between cursor-pointer" onclick="UsersPage.toggleCustomPermsSection()">
                            <div>
                                <span class="font-weight-bold">⚡ ${I18n.t('custom_permissions_override') || 'دسترسی‌های اختصاصی اضافه بر نقش'}</span>
                                <small class="text-muted d-block">${I18n.t('custom_perms_hint') || 'این دسترسی‌ها علاوه بر دسترسی‌های نقش به کاربر اعطا خواهند شد'}</small>
                            </div>
                            <span id="custom-perms-arrow">▼</span>
                        </div>

                        <div id="custom-perms-container" style="display: ${userCustomPerms.size > 0 ? 'block' : 'none'}; margin-top: 1rem;">
                            ${permsMatrixHtml}
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || 'انصراف'}</button>
                        <button type="submit" id="save-user-btn" class="btn btn-primary">
                            <span>💾</span>
                            <span>${I18n.t('save') || 'ذخیره'}</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        App.openModal(modalHtml, 'modal-wide');
    },

    toggleUserScopeSection() {
        const cont = document.getElementById('user-scope-container');
        const arrow = document.getElementById('user-scope-arrow');
        if (!cont) return;
        const isHidden = cont.style.display === 'none';
        cont.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
    },

    toggleAllScopeCams(check) {
        document.querySelectorAll('.user-scope-cam-cb').forEach(cb => {
            cb.checked = check;
        });
    },

    toggleAllScopePersons(check) {
        document.querySelectorAll('.user-scope-per-cb').forEach(cb => {
            cb.checked = check;
        });
    },

    filterScopeList(inputEl, itemClass) {
        const term = (inputEl.value || '').trim().toLowerCase();
        document.querySelectorAll('.' + itemClass).forEach(el => {
            const searchData = el.getAttribute('data-search') || '';
            el.style.display = searchData.includes(term) ? '' : 'none';
        });
    },

    autoSelectScopeResources() {
        const checkedSections = new Set();
        document.querySelectorAll('.user-scope-sec-cb:checked').forEach(cb => {
            checkedSections.add(cb.value);
        });

        if (checkedSections.size === 0) {
            App.showToast('ابتدا حداقل یک بخش را علامت بزنید.', 'warning');
            return;
        }

        let camCount = 0;
        document.querySelectorAll('.user-scope-cam-cb').forEach(cb => {
            const sec = cb.getAttribute('data-section');
            if (sec && checkedSections.has(sec)) {
                cb.checked = true;
                camCount++;
            }
        });

        let perCount = 0;
        document.querySelectorAll('.user-scope-per-cb').forEach(cb => {
            const sec = cb.getAttribute('data-section');
            if (sec && checkedSections.has(sec)) {
                cb.checked = true;
                perCount++;
            }
        });

        App.showToast(`${camCount} دوربین و ${perCount} پرسنل متعلق به بخش‌های انتخابی علامت خوردند.`, 'info');
    },

    toggleCustomPermsSection() {
        const cont = document.getElementById('custom-perms-container');
        const arrow = document.getElementById('custom-perms-arrow');
        if (!cont) return;
        const isHidden = cont.style.display === 'none';
        cont.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
    },

    async _saveUser(e, userId) {
        e.preventDefault();
        const errEl = document.getElementById('user-form-error');
        const btn = document.getElementById('save-user-btn');
        if (errEl) errEl.style.display = 'none';

        const fullName = document.getElementById('form-user-fullname').value.trim();
        const roleId = parseInt(document.getElementById('form-user-role').value, 10);
        const isActive = document.getElementById('form-user-active').checked;
        const password = document.getElementById('form-user-password').value;

        // Collect custom permissions
        const customPerms = [];
        document.querySelectorAll('.user-custom-perm-cb:checked').forEach(cb => {
            customPerms.push(cb.value);
        });

        // Collect supervisor scope
        const assignedSections = [];
        document.querySelectorAll('.user-scope-sec-cb:checked').forEach(cb => {
            assignedSections.push(cb.value);
        });

        const assignedCameras = [];
        document.querySelectorAll('.user-scope-cam-cb:checked').forEach(cb => {
            assignedCameras.push(parseInt(cb.value, 10));
        });

        const assignedPersons = [];
        document.querySelectorAll('.user-scope-per-cb:checked').forEach(cb => {
            assignedPersons.push(parseInt(cb.value, 10));
        });

        if (btn) btn.disabled = true;

        try {
            if (userId) {
                // Update
                const payload = {
                    full_name: fullName,
                    role_id: roleId,
                    is_active: isActive,
                    custom_permissions: customPerms,
                    assigned_sections: assignedSections,
                    assigned_camera_ids: assignedCameras,
                    assigned_person_ids: assignedPersons,
                };
                if (password && password.trim().length >= 4) {
                    payload.password = password.trim();
                }
                await App.api(`/api/users/${userId}`, 'PUT', payload);
                App.showToast(I18n.t('user_updated_success') || 'کاربر با موفقیت به‌روزرسانی شد.', 'success');
            } else {
                // Create
                const username = document.getElementById('form-user-username').value.trim().toLowerCase();
                const payload = {
                    username,
                    full_name: fullName,
                    password,
                    role_id: roleId,
                    is_active: isActive,
                    custom_permissions: customPerms,
                    assigned_sections: assignedSections,
                    assigned_camera_ids: assignedCameras,
                    assigned_person_ids: assignedPersons,
                };
                await App.api('/api/users', 'POST', payload);
                App.showToast(I18n.t('user_created_success') || 'کاربر جدید با موفقیت ایجاد شد.', 'success');
            }

            App.closeModal();
            await this.refreshData();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || 'خطا در ذخیره اطلاعات کاربر';
                errEl.style.display = 'block';
            }
            if (btn) btn.disabled = false;
        }
    },

    async deleteUser(userId, username) {
        if (!confirm(`${I18n.t('confirm_delete_user') || 'آیا از حذف حساب کاربر مطمئن هستید؟'}: @${username}`)) {
            return;
        }

        try {
            await App.api(`/api/users/${userId}`, 'DELETE');
            App.showToast(I18n.t('user_deleted_success') || 'کاربر با موفقیت حذف شد.', 'success');
            await this.refreshData();
        } catch (err) {
            alert(err.message || 'خطا در حذف کاربر');
        }
    },

    openResetPasswordModal(userId, username) {
        const modalHtml = `
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">🔑</span>
                    <div>
                        <h2 class="modal-title">${I18n.t('reset_password') || 'بازنشانی کلمه عبور کاربر'}</h2>
                        <p class="modal-subtitle">@${this._escape(username)}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body">
                <form onsubmit="UsersPage._handleAdminResetPassword(event, ${userId})">
                    <div class="form-group mb-4">
                        <label for="admin-reset-pwd">${I18n.t('new_password') || 'کلمه عبور جدید'} *</label>
                        <input type="password" id="admin-reset-pwd" class="form-control" required minlength="4" placeholder="••••••••">
                    </div>

                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || 'انصراف'}</button>
                        <button type="submit" class="btn btn-primary">
                            <span>🔑</span>
                            <span>${I18n.t('confirm_reset') || 'ثبت کلمه عبور جدید'}</span>
                        </button>
                    </div>
                </form>
            </div>
        `;
        App.openModal(modalHtml, 'modal-md');
    },

    async _handleAdminResetPassword(e, userId) {
        e.preventDefault();
        const pwdEl = document.getElementById('admin-reset-pwd');
        if (!pwdEl) return;
        try {
            await App.api(`/api/users/${userId}/reset-password`, 'POST', {
                new_password: pwdEl.value,
            });
            App.closeModal();
            App.showToast(I18n.t('password_reset_success') || 'کلمه عبور کاربر با موفقیت بازنشانی شد.', 'success');
        } catch (err) {
            alert(err.message || 'خطا در بازنشانی کلمه عبور');
        }
    },

    // ═══════════════════════════════════════════════════════
    // ROLE MODAL (ADD / EDIT PERMISSIONS)
    // ═══════════════════════════════════════════════════════
    openRoleModal(roleId = null) {
        const role = roleId ? this._roles.find(r => r.id === roleId) : null;
        const isEdit = !!role;
        const isAdmin = role && (role.name === 'admin' || (role.permissions || []).includes('*'));
        const isFa = I18n.isRTL() || I18n.currentLang === 'fa';
        const theme = this._getRoleTheme(role ? role.name : 'custom');

        const allRegistryPerms = this._permissionsRegistry?.all_permissions || [];
        const totalCount = allRegistryPerms.length || 22;

        const rolePerms = new Set(isAdmin
            ? allRegistryPerms
            : (role ? role.permissions || [] : []));

        const activeCount = isAdmin ? totalCount : rolePerms.size;

        const matrixHtml = this._buildPermissionsCheckboxGrid('role-perm', rolePerms, isAdmin);

        const modalHtml = `
            <div class="modal-header modal-roles-header">
                <div class="modal-title-group">
                    <div class="modal-icon-badge" style="background: ${theme.color}22; color: ${theme.color}; border: 1px solid ${theme.color}55;">
                        <span>${isEdit ? theme.icon : '＋'}</span>
                    </div>
                    <div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <h2 class="modal-title">${isEdit ? (I18n.t('edit_role') || 'ویرایش نقش و دسترسی‌ها') : (I18n.t('add_role') || 'تعریف نقش جدید')}</h2>
                            ${isEdit ? `<span class="badge badge-subtle text-xs">@${this._escape(role.name)}</span>` : ''}
                        </div>
                        <p class="modal-subtitle">${isEdit ? this._escape(role.display_name) : (I18n.t('add_role_sub') || 'سطوح دسترسی این نقش را در بخش‌های مختلف مشخص نمایید')}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body modal-roles-body">
                <div id="role-form-error" class="alert alert-danger" style="display: none; margin-bottom: 1rem;"></div>

                <form id="role-edit-form" onsubmit="UsersPage._saveRole(event, ${roleId || 'null'})">
                    <div class="role-meta-section card-glass p-3 mb-4">
                        <div class="row g-3 mb-3">
                            <div class="col-md-6">
                                <label for="form-role-display-name" class="form-label d-flex align-items-center gap-2">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: #60a5fa;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                    <span>${I18n.t('role_display_name') || 'عنوان نمایشی نقش'} *</span>
                                </label>
                                <input type="text" id="form-role-display-name" class="form-control" required value="${isEdit ? this._escape(role.display_name) : ''}" placeholder="${I18n.t('role_display_name_placeholder') || 'مثال: سرپرست شیفت شب'}">
                            </div>
                            <div class="col-md-6">
                                <label for="form-role-name" class="form-label d-flex align-items-center gap-2">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: #60a5fa;"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
                                    <span>${I18n.t('role_identifier') || 'شناسه سیستمی نقش (Slug)'} *</span>
                                </label>
                                <input type="text" id="form-role-name" class="form-control" required ${isEdit ? 'readonly disabled' : ''} value="${isEdit ? this._escape(role.name) : ''}" placeholder="${I18n.t('role_identifier_placeholder') || 'night_shift_supervisor'}">
                            </div>
                        </div>

                        <div class="form-group mb-0">
                            <label for="form-role-desc" class="form-label d-flex align-items-center gap-2">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: #60a5fa;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                <span>${I18n.t('role_description_label') || I18n.t('role_description') || 'شرح وظایف و اختیارات'}</span>
                            </label>
                            <input type="text" id="form-role-desc" class="form-control" value="${isEdit ? this._escape(role.description || '') : ''}" placeholder="${I18n.t('role_description_placeholder') || 'توضیحات مربوط به حوزه اختیارات و وظایف این نقش...'}">
                        </div>
                    </div>

                    <!-- Permissions Matrix Header & Toolbar -->
                    <div class="matrix-control-bar card-glass p-3 mb-3">
                        <div class="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-2">
                            <div class="d-flex align-items-center gap-2">
                                <h4 class="m-0 font-weight-bold" style="font-size: 1rem; color: #93c5fd;">
                                    🛡️ ${I18n.t('granular_permissions') || 'ماتریس دسترسی‌های تفکیک‌شده'}
                                </h4>
                                <span class="active-perms-badge" id="active-perms-counter">
                                    <span id="active-perms-num">${isFa ? I18n.toPersianDigits(activeCount) : activeCount}</span> از <span id="total-perms-num">${isFa ? I18n.toPersianDigits(totalCount) : totalCount}</span> دسترسی فعال
                                </span>
                            </div>

                            ${isAdmin ? `
                                <div class="admin-full-badge">
                                    <span>👑 ${I18n.t('admin_full_access_note') || 'مدیر کل به صورت پیش‌فرض تمام اختیارات را دارد'}</span>
                                </div>
                            ` : `
                                <div class="matrix-quick-actions d-flex gap-2">
                                    <button type="button" class="btn btn-xs btn-outline-primary" onclick="UsersPage.toggleAllMatrixChecks(true)">
                                        ✓ ${I18n.t('select_all') || 'انتخاب همه'}
                                    </button>
                                    <button type="button" class="btn btn-xs btn-outline-secondary" onclick="UsersPage.toggleAllMatrixChecks(false)">
                                        ✕ ${I18n.t('deselect_all') || 'لغو انتخاب'}
                                    </button>
                                </div>
                            `}
                        </div>

                        <!-- Live Filter / Search Bar -->
                        <div class="matrix-search-box position-relative mt-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="matrix-search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                            <input type="text" id="matrix-search-input" class="form-control form-control-sm matrix-search-input" placeholder="${I18n.t('search_permissions_placeholder') || 'جستجو در نام یا شرح دسترسی...'}" oninput="UsersPage.filterPermissions(this.value)">
                        </div>
                    </div>

                    <!-- Permissions Items Matrix (Single smooth scroll container) -->
                    <div class="permissions-matrix-wrap" id="permissions-matrix-container">
                        ${matrixHtml}
                        <div id="no-perms-found" class="text-center p-4 text-muted" style="display: none;">
                            🔍 هیچ دسترسی منطبق با عبارت جستجو شده یافت نشد.
                        </div>
                    </div>

                    <div class="modal-actions mt-4 pt-3 border-top d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || 'انصراف'}</button>
                        <button type="submit" id="save-role-btn" class="btn btn-primary d-inline-flex align-items-center gap-2">
                            <span>💾</span>
                            <span>${I18n.t('save_role_btn') || I18n.t('save') || 'ذخیره نقش'}</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        App.openModal(modalHtml, 'modal-wide modal-roles-modal');
        this.updateActivePermsCount();
    },

    filterPermissions(query) {
        const q = (query || '').trim().toLowerCase();
        const sections = document.querySelectorAll('.perm-section-block');
        let totalVisible = 0;

        sections.forEach(sec => {
            let sectionHasVisible = false;
            const secBoxes = sec.querySelectorAll('.permission-item-box');
            secBoxes.forEach(box => {
                const text = box.textContent.toLowerCase();
                const matches = !q || text.includes(q);
                box.style.display = matches ? 'block' : 'none';
                if (matches) {
                    sectionHasVisible = true;
                    totalVisible++;
                }
            });
            sec.style.display = sectionHasVisible ? 'block' : 'none';
        });

        const noFoundEl = document.getElementById('no-perms-found');
        if (noFoundEl) {
            noFoundEl.style.display = totalVisible === 0 ? 'block' : 'none';
        }
    },

    togglePermBox(boxEl, event) {
        if (!boxEl) return;
        if (event && event.target && event.target.tagName === 'INPUT') {
            this.updateActivePermsCount();
            return;
        }
        const cb = boxEl.querySelector('input[type="checkbox"]');
        if (cb && !cb.disabled) {
            cb.checked = !cb.checked;
            this.updateActivePermsCount();
        }
    },

    updateActivePermsCount() {
        const isFa = I18n.isRTL() || I18n.currentLang === 'fa';
        const checkedBoxes = document.querySelectorAll('.role-perm-cb:checked');
        const numEl = document.getElementById('active-perms-num');
        if (numEl) {
            numEl.textContent = isFa ? I18n.toPersianDigits(checkedBoxes.length) : checkedBoxes.length;
        }

        document.querySelectorAll('.permission-item-box').forEach(box => {
            const cb = box.querySelector('input[type="checkbox"]');
            if (cb) {
                box.classList.toggle('is-checked', cb.checked);
            }
        });
    },

    toggleAllMatrixChecks(checkState) {
        document.querySelectorAll('.role-perm-cb').forEach(cb => {
            if (!cb.disabled) cb.checked = checkState;
        });
        this.updateActivePermsCount();
    },

    toggleSectionChecks(sectionId, checkState) {
        document.querySelectorAll(`.role-perm-cb[data-section="${sectionId}"]`).forEach(cb => {
            if (!cb.disabled) cb.checked = checkState;
        });
        this.updateActivePermsCount();
    },

    async _saveRole(e, roleId) {
        e.preventDefault();
        const errEl = document.getElementById('role-form-error');
        const btn = document.getElementById('save-role-btn');
        if (errEl) errEl.style.display = 'none';

        const displayName = document.getElementById('form-role-display-name').value.trim();
        const description = document.getElementById('form-role-desc').value.trim();

        // Collect checked permissions
        const perms = [];
        document.querySelectorAll('.role-perm-cb:checked').forEach(cb => {
            perms.push(cb.value);
        });

        if (btn) btn.disabled = true;

        try {
            if (roleId) {
                await App.api(`/api/roles/${roleId}`, 'PUT', {
                    display_name: displayName,
                    description,
                    permissions: perms,
                });
                App.showToast(I18n.t('role_updated_success') || 'نقش با موفقیت به‌روزرسانی شد.', 'success');
            } else {
                const name = document.getElementById('form-role-name').value.trim();
                await App.api('/api/roles', 'POST', {
                    name,
                    display_name: displayName,
                    description,
                    permissions: perms,
                });
                App.showToast(I18n.t('role_created_success') || 'نقش جدید با موفقیت ایجاد شد.', 'success');
            }

            App.closeModal();
            await this.refreshData();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || 'خطا در ذخیره نقش';
                errEl.style.display = 'block';
            }
            if (btn) btn.disabled = false;
        }
    },

    async deleteRole(roleId, displayName) {
        if (!confirm(`${I18n.t('confirm_delete_role') || 'آیا از حذف این نقش مطمئن هستید؟'}: ${displayName}`)) {
            return;
        }

        try {
            await App.api(`/api/roles/${roleId}`, 'DELETE');
            App.showToast(I18n.t('role_deleted_success') || 'نقش با موفقیت حذف شد.', 'success');
            await this.refreshData();
        } catch (err) {
            alert(err.message || 'خطا در حذف نقش');
        }
    },

    // ═══════════════════════════════════════════════════════
    // PERMISSIONS GRID BUILDER
    // ═══════════════════════════════════════════════════════
    _buildPermissionsCheckboxGrid(cbClassPrefix, checkedPermsSet, disableAll = false) {
        if (!this._permissionsRegistry || !this._permissionsRegistry.sections) {
            return '<div class="text-muted p-3">در حال بارگذاری لیست دسترسی‌ها...</div>';
        }

        const isFa = I18n.isRTL() || I18n.currentLang === 'fa';
        let sectionsHtml = '';

        const sectionIcons = {
            dashboard: '📊',
            duty: '⏱️',
            zones: '📍',
            cameras: '📹',
            persons: '👤',
            settings: '⚙️',
            users: '👥',
        };

        this._permissionsRegistry.sections.forEach(section => {
            const title = (isFa ? section.title_fa : section.title_en) || section.id;
            const icon = sectionIcons[section.id] || '📌';
            let itemsHtml = '';

            section.permissions.forEach(p => {
                const isChecked = checkedPermsSet.has(p.key) || checkedPermsSet.has('*');
                const label = (isFa ? p.label_fa : p.label_en) || p.key;
                const desc = (isFa ? p.description_fa : p.description_en) || '';

                itemsHtml += `
                    <div class="permission-item-box ${isChecked ? 'is-checked' : ''}" onclick="UsersPage.togglePermBox(this, event)">
                        <label class="perm-checkbox-label">
                            <input type="checkbox"
                                   class="${cbClassPrefix}-cb"
                                   data-section="${section.id}"
                                   value="${p.key}"
                                   ${isChecked ? 'checked' : ''}
                                   ${disableAll ? 'disabled' : ''}
                                   onchange="UsersPage.updateActivePermsCount()">
                            <span class="perm-checkbox-custom"></span>
                            <div class="perm-text-group">
                                <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                                    <span class="perm-title">${this._escape(label)}</span>
                                    <span class="perm-key-code">${this._escape(p.key)}</span>
                                </div>
                                ${desc ? `<small class="perm-desc">${this._escape(desc)}</small>` : ''}
                            </div>
                        </label>
                    </div>
                `;
            });

            sectionsHtml += `
                <div class="perm-section-block mb-3" data-section-id="${section.id}">
                    <div class="perm-section-header d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center gap-2">
                            <span class="perm-section-icon">${icon}</span>
                            <span class="perm-section-title font-weight-bold">${this._escape(title)}</span>
                            <span class="badge badge-subtle text-xs">${section.permissions.length}</span>
                        </div>
                        ${!disableAll ? `
                            <div class="perm-section-quick-btns d-flex gap-2">
                                <button type="button" class="btn-perm-sec-toggle" onclick="UsersPage.toggleSectionChecks('${section.id}', true)">${I18n.t('all') || 'همه'}</button>
                                <button type="button" class="btn-perm-sec-toggle secondary" onclick="UsersPage.toggleSectionChecks('${section.id}', false)">${I18n.t('none') || 'هیچ'}</button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="perm-items-grid">
                        ${itemsHtml}
                    </div>
                </div>
            `;
        });

        return sectionsHtml;
    },

    // ═══════════════════════════════════════════════════════
    // TAB 3: FACTORY SECTIONS & DEPARTMENTS
    // ═══════════════════════════════════════════════════════
    _renderSectionsTab(container) {
        const canManage = Auth.hasPermission('sections:manage') || Auth.hasPermission('users:manage');
        const isFa = I18n.isRTL() || I18n.currentLang === 'fa';

        if (this._sections.length === 0) {
            container.innerHTML = `
                <div class="empty-state-card text-center p-5 card-glass">
                    <div class="empty-icon" style="font-size: 3rem; margin-bottom: 1rem;">🏢</div>
                    <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem;">${I18n.t('no_sections_found') || 'هیچ بخشی تعریف نشده است'}</h3>
                    <p class="text-muted" style="max-width: 500px; margin: 0 auto 1.5rem auto;">${I18n.t('no_sections_desc') || 'می‌توانید بخش‌های مختلف کارخانه مانند خط تولید، بسته‌بندی، انبار و غیره را تعریف نمایید.'}</p>
                    ${canManage ? `
                        <button class="btn btn-primary" onclick="UsersPage.openSectionModal()">
                            <span>➕</span>
                            <span>${I18n.t('add_section') || 'افزودن بخش جدید'}</span>
                        </button>
                    ` : ''}
                </div>
            `;
            return;
        }

        const sectionCardsHtml = this._sections.map(sec => {
            const camCountDisplay = isFa ? I18n.toPersianDigits(sec.camera_count || 0) : (sec.camera_count || 0);
            const perCountDisplay = isFa ? I18n.toPersianDigits(sec.person_count || 0) : (sec.person_count || 0);
            const supCountDisplay = isFa ? I18n.toPersianDigits(sec.supervisor_count || 0) : (sec.supervisor_count || 0);
            const idDisplay = isFa ? I18n.toPersianDigits(sec.id) : sec.id;

            return `
                <div class="section-card-item">
                    <div>
                        <div class="section-header-top">
                            <div class="section-identity-group">
                                <div class="section-icon-box">
                                    🏢
                                </div>
                                <div class="section-title-wrap">
                                    <h3 class="section-title-text">${this._escape(sec.name)}</h3>
                                    <span class="section-id-badge">شناسه: #${idDisplay}</span>
                                </div>
                            </div>
                            ${canManage ? `
                                <div class="section-actions-group">
                                    <button class="section-action-btn edit" title="${I18n.t('edit') || 'ویرایش'}" onclick="UsersPage.openSectionModal(${sec.id})">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                    </button>
                                    <button class="section-action-btn delete" title="${I18n.t('delete') || 'حذف'}" onclick="UsersPage.deleteSection(${sec.id}, '${this._escape(sec.name)}')">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    </button>
                                </div>
                            ` : ''}
                        </div>

                        <p class="section-desc-text">
                            ${this._escape(sec.description || 'بدون توضیحات تکمیلی')}
                        </p>
                    </div>

                    <div class="section-metrics-bar">
                        <div class="section-metric-pill cameras" title="دوربین‌های این بخش">
                            <span>📹</span>
                            <strong>${camCountDisplay}</strong>
                            <span>دوربین</span>
                        </div>
                        <div class="section-metric-pill personnel" title="پرسنل مستقر در این بخش">
                            <span>👤</span>
                            <strong>${perCountDisplay}</strong>
                            <span>پرسنل</span>
                        </div>
                        <div class="section-metric-pill supervisors" title="سرپرستان ناظر">
                            <span>⚡</span>
                            <strong>${supCountDisplay}</strong>
                            <span>سرپرست</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="sections-tab-wrapper">
                <div class="sections-intro-bar">
                    <div class="sections-intro-inner">
                        <div class="sections-intro-title-group">
                            <div class="sections-intro-icon-box">🏢</div>
                            <div>
                                <h3 class="sections-intro-title">مدیریت بخش‌ها و نواحی کارخانه</h3>
                                <p class="sections-intro-subtitle">تعریف بخش‌های عملیاتی کارخانه و انتساب سرپرستان، دوربین‌ها و پرسنل به هر بخش</p>
                            </div>
                        </div>
                        <div class="sections-intro-actions">
                            <span class="sections-count-pill">
                                🏢 ${isFa ? I18n.toPersianDigits(this._sections.length) : this._sections.length} بخش فعال
                            </span>
                            ${canManage ? `
                                <button type="button" class="btn-add-section-top" onclick="UsersPage.openSectionModal()">
                                    <span>➕</span>
                                    <span>${I18n.t('add_section') || 'افزودن بخش جدید'}</span>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <div class="sections-grid">
                    ${sectionCardsHtml}
                </div>
            </div>
        `;
    },

    openSectionModal(sectionId = null) {
        const sec = sectionId ? this._sections.find(s => s.id === sectionId) : null;
        const isEdit = !!sec;
        const isFa = I18n.isRTL() || I18n.currentLang === 'fa';

        const modalHtml = `
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">${isEdit ? '✏️' : '🏢'}</span>
                    <div>
                        <h2 class="modal-title">${isEdit ? 'ویرایش بخش کارخانه' : 'افزودن بخش جدید کارخانه'}</h2>
                        <p class="modal-subtitle">${isEdit ? this._escape(sec.name) : 'نام و توضیحات بخش را وارد نمایید'}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body">
                <div id="section-form-error" class="alert alert-danger" style="display: none; margin-bottom: 1rem;"></div>

                <form id="section-edit-form" onsubmit="UsersPage._saveSection(event, ${sectionId || 'null'})">
                    <div class="form-group mb-3">
                        <label for="form-section-name" class="form-label font-weight-bold">نام بخش سازمانی *</label>
                        <input type="text" id="form-section-name" class="form-control" required placeholder="مثال: بسته‌بندی، خط تولید، انبار مرکزی" value="${isEdit ? this._escape(sec.name) : ''}">
                    </div>

                    <div class="form-group mb-4">
                        <label for="form-section-desc" class="form-label font-weight-bold">شرح و توضیحات تکمیلی</label>
                        <textarea id="form-section-desc" class="form-control" rows="3" placeholder="توضیح مختصر در خصوص عملکرد یا محدوده فیزیکی این بخش">${isEdit ? this._escape(sec.description || '') : ''}</textarea>
                    </div>

                    ${isEdit ? `
                        <div class="section-modal-stats-grid">
                            <div class="section-modal-stat-card cameras" title="تعداد دوربین‌های پایش این بخش">
                                <span class="stat-icon">📹</span>
                                <div class="stat-val">${isFa ? I18n.toPersianDigits(sec.camera_count || 0) : (sec.camera_count || 0)}</div>
                                <span class="stat-label">دوربین‌های منتسب</span>
                            </div>
                            <div class="section-modal-stat-card personnel" title="پرسنل سازمانی منتسب به این بخش">
                                <span class="stat-icon">👤</span>
                                <div class="stat-val">${isFa ? I18n.toPersianDigits(sec.person_count || 0) : (sec.person_count || 0)}</div>
                                <span class="stat-label">پرسنل مستقر</span>
                            </div>
                            <div class="section-modal-stat-card supervisors" title="سرپرستان ناظر دارای مجوز این بخش">
                                <span class="stat-icon">⚡</span>
                                <div class="stat-val">${isFa ? I18n.toPersianDigits(sec.supervisor_count || 0) : (sec.supervisor_count || 0)}</div>
                                <span class="stat-label">سرپرستان ناظر</span>
                            </div>
                        </div>
                    ` : ''}

                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || 'انصراف'}</button>
                        <button type="submit" id="save-section-btn" class="btn btn-primary">
                            <span>💾</span>
                            <span>${I18n.t('save') || 'ذخیره تغییرات'}</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        App.openModal(modalHtml, 'modal-medium');
    },

    async _saveSection(e, sectionId) {
        e.preventDefault();
        const errEl = document.getElementById('section-form-error');
        const btn = document.getElementById('save-section-btn');
        if (errEl) errEl.style.display = 'none';

        const name = document.getElementById('form-section-name').value.trim();
        const description = document.getElementById('form-section-desc').value.trim();

        if (!name) return;
        if (btn) btn.disabled = true;

        try {
            if (sectionId) {
                await App.api(`/api/sections/${sectionId}`, 'PUT', { name, description });
                App.showToast('اطلاعات بخش با موفقیت به‌روزرسانی شد.', 'success');
            } else {
                await App.api('/api/sections', 'POST', { name, description });
                App.showToast('بخش جدید با موفقیت اضافه گردید.', 'success');
            }
            App.closeModal();
            await this.refreshData();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || 'خطا در ثبت اطلاعات بخش';
                errEl.style.display = 'block';
            }
            if (btn) btn.disabled = false;
        }
    },

    async deleteSection(sectionId, name) {
        if (!confirm(`آیا از حذف بخش «${name}» اطمینان دارید؟\nنکته: در صورت وجود دوربین یا پرسنل منتسب به این بخش، مقدار بخش آنها پاک خواهد شد.`)) {
            return;
        }

        try {
            await App.api(`/api/sections/${sectionId}`, 'DELETE');
            App.showToast('بخش با موفقیت حذف شد.', 'success');
            await this.refreshData();
        } catch (err) {
            alert(err.message || 'خطا در حذف بخش');
        }
    },

    _escape(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    },
};
