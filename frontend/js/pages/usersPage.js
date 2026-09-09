/**
 * UsersPage — Comprehensive User Management and Dynamic Roles & Permissions (RBAC).
 * Supports:
 *   - Tab 1: User Accounts listing, creation, role assignment, custom permissions, and password resets.
 *   - Tab 2: Dynamic Roles & Permissions management, custom role creation, granular permission matrix editor.
 */
const UsersPage = {
    _activeTab: 'users', // 'users' | 'roles'
    _users: [],
    _roles: [],
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
            const [users, roles, permsRes] = await Promise.all([
                App.api('/api/users'),
                App.api('/api/roles'),
                App.api('/api/roles/permissions-registry'),
            ]);

            this._users = users;
            this._roles = roles;
            this._permissionsRegistry = permsRes;

            const uBadge = document.getElementById('users-count-badge');
            if (uBadge) uBadge.textContent = users.length;

            const rBadge = document.getElementById('roles-count-badge');
            if (rBadge) rBadge.textContent = roles.length;

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
        } else {
            if (headerActions) {
                headerActions.innerHTML = canManage ? `
                    <button class="btn btn-primary d-inline-flex align-items-center" onclick="UsersPage.openRoleModal()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; margin-inline-end: 6px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>${I18n.t('add_role') || 'نقش جدید'}</span>
                    </button>
                ` : '';
            }
            this._renderRolesTab(container);
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
                ? new Date(user.last_login).toLocaleString(I18n.currentLang === 'fa' ? 'fa-IR' : 'en-US')
                : (I18n.t('never_logged_in') || 'هنوز وارد نشده');

            const customPermsCount = (user.custom_permissions || []).length;
            const customPermsBadge = customPermsCount > 0
                ? `<span class="badge badge-info" title="${(user.custom_permissions || []).join(', ')}">+${customPermsCount} سفارشی</span>`
                : `<span class="text-muted text-sm">—</span>`;

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
    _renderRolesTab(container) {
        const canManage = Auth.hasPermission('users:manage');

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
                ? (this._permissionsRegistry?.all_permissions?.length || 18)
                : (role.permissions || []).length;

            const isSystem = role.is_system || ['admin', 'supervisor', 'operator', 'viewer'].includes(role.name);

            // Preview top permission tags
            let permsPreview = '';
            if (isAdmin) {
                permsPreview = `<span class="badge badge-success">${I18n.t('all_permissions') || 'دسترسی کامل به تمامی بخش‌ها (*)'}</span>`;
            } else {
                const tags = (role.permissions || []).slice(0, 4).map(p => `<span class="badge badge-subtle">${p}</span>`).join(' ');
                const rem = (role.permissions || []).length - 4;
                permsPreview = tags + (rem > 0 ? ` <span class="badge badge-secondary">+${rem} دسترسی دیگر</span>` : '');
            }

            rolesGridHtml += `
                <div class="role-card-item card-glass">
                    <div class="role-card-header">
                        <div class="d-flex align-items-center justify-content-between w-100">
                            <div class="role-title-group">
                                <h3 class="role-display-name">${this._escape(role.display_name)}</h3>
                                <code class="role-slug">@${this._escape(role.name)}</code>
                            </div>
                            <div class="role-badges">
                                ${isSystem ? `<span class="badge badge-secondary text-xs">${I18n.t('system_role') || 'سیستمی'}</span>` : ''}
                                <span class="badge badge-info">${role.user_count || 0} ${I18n.t('users') || 'کاربر'}</span>
                            </div>
                        </div>
                    </div>

                    <p class="role-card-desc text-muted">${this._escape(role.description || I18n.t('no_description') || 'بدون توضیحات')}</p>

                    <div class="role-perms-summary mt-3">
                        <div class="text-xs text-muted mb-1 font-weight-bold">${I18n.t('permissions') || 'سطوح دسترسی'} (${permCount}):</div>
                        <div class="role-tags-wrap">${permsPreview}</div>
                    </div>

                    <div class="role-card-footer mt-4 pt-3 d-flex justify-content-end gap-2">
                        ${canManage ? `
                            <button class="btn btn-outline-secondary btn-sm" onclick="UsersPage.openRoleModal(${role.id})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>${I18n.t('edit_role_permissions') || 'ویرایش دسترسی‌ها'}</span>
                            </button>
                            ${!isSystem ? `
                                <button class="btn btn-outline-danger btn-sm" title="${I18n.t('delete') || 'حذف'}" onclick="UsersPage.deleteRole(${role.id}, '${this._escape(role.display_name)}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                </button>
                            ` : ''}
                        ` : ''}
                    </div>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="roles-grid">
                ${rolesGridHtml}
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

        if (btn) btn.disabled = true;

        try {
            if (userId) {
                // Update
                const payload = {
                    full_name: fullName,
                    role_id: roleId,
                    is_active: isActive,
                    custom_permissions: customPerms,
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

        const rolePerms = new Set(isAdmin
            ? (this._permissionsRegistry?.all_permissions || [])
            : (role ? role.permissions || [] : []));

        const matrixHtml = this._buildPermissionsCheckboxGrid('role-perm', rolePerms, isAdmin);

        const modalHtml = `
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">${isEdit ? '🛡️' : '＋'}</span>
                    <div>
                        <h2 class="modal-title">${isEdit ? (I18n.t('edit_role') || 'ویرایش نقش و دسترسی‌ها') : (I18n.t('add_role') || 'تعریف نقش جدید')}</h2>
                        <p class="modal-subtitle">${isEdit ? role.display_name : (I18n.t('add_role_sub') || 'سطوح دسترسی این نقش را در بخش‌های مختلف مشخص نمایید')}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body">
                <div id="role-form-error" class="alert alert-danger" style="display: none; margin-bottom: 1rem;"></div>

                <form id="role-edit-form" onsubmit="UsersPage._saveRole(event, ${roleId || 'null'})">
                    <div class="row g-3 mb-3">
                        <div class="col-md-6">
                            <label for="form-role-display-name" class="form-label">${I18n.t('role_display_name') || 'عنوان نمایشی نقش'} *</label>
                            <input type="text" id="form-role-display-name" class="form-control" required value="${isEdit ? this._escape(role.display_name) : ''}" placeholder="مثال: سرپرست شیفت شب">
                        </div>
                        <div class="col-md-6">
                            <label for="form-role-name" class="form-label">${I18n.t('role_identifier') || 'شناسه سیستمی (Slug)'} *</label>
                            <input type="text" id="form-role-name" class="form-control" required ${isEdit ? 'readonly disabled' : ''} value="${isEdit ? this._escape(role.name) : ''}" placeholder="night_shift_supervisor">
                        </div>
                    </div>

                    <div class="form-group mb-4">
                        <label for="form-role-desc" class="form-label">${I18n.t('description') || 'شرح وظایف و اختیارات'}</label>
                        <input type="text" id="form-role-desc" class="form-control" value="${isEdit ? this._escape(role.description || '') : ''}">
                    </div>

                    <div class="permissions-matrix-header d-flex justify-content-between align-items-center mb-2">
                        <h4 class="m-0 font-weight-bold">${I18n.t('granular_permissions') || 'ماتریس دسترسی‌های تفکیک‌شده'}</h4>
                        ${!isAdmin ? `
                            <div class="d-flex gap-2">
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="UsersPage.toggleAllMatrixChecks(true)">${I18n.t('select_all') || 'انتخاب همه'}</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="UsersPage.toggleAllMatrixChecks(false)">${I18n.t('deselect_all') || 'لغو انتخاب'}</button>
                            </div>
                        ` : '<span class="badge badge-success">مدیر کل به صورت پیش‌فرض تمام اختیارات را دارد</span>'}
                    </div>

                    <div class="permissions-matrix-wrap card-glass p-3 mb-4">
                        ${matrixHtml}
                    </div>

                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || 'انصراف'}</button>
                        <button type="submit" id="save-role-btn" class="btn btn-primary">
                            <span>💾</span>
                            <span>${I18n.t('save') || 'ذخیره نقش'}</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        App.openModal(modalHtml, 'modal-wide');
    },

    toggleAllMatrixChecks(checkState) {
        document.querySelectorAll('.role-perm-cb').forEach(cb => {
            if (!cb.disabled) cb.checked = checkState;
        });
    },

    toggleSectionChecks(sectionId, checkState) {
        document.querySelectorAll(`.role-perm-cb[data-section="${sectionId}"]`).forEach(cb => {
            if (!cb.disabled) cb.checked = checkState;
        });
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
            return '<div class="text-muted">در حال بارگذاری لیست دسترسی‌ها...</div>';
        }

        const isFa = I18n.currentLang === 'fa';
        let sectionsHtml = '';

        this._permissionsRegistry.sections.forEach(section => {
            const title = isFa ? section.title_fa : section.title_en;
            let itemsHtml = '';

            section.permissions.forEach(p => {
                const isChecked = checkedPermsSet.has(p.key) || checkedPermsSet.has('*');
                const label = isFa ? p.label_fa : p.label_en;
                const desc = isFa ? p.description_fa : p.description_en;

                itemsHtml += `
                    <div class="permission-item-box">
                        <label class="perm-checkbox-label">
                            <input type="checkbox"
                                   class="${cbClassPrefix}-cb"
                                   data-section="${section.id}"
                                   value="${p.key}"
                                   ${isChecked ? 'checked' : ''}
                                   ${disableAll ? 'disabled' : ''}>
                            <span class="perm-checkbox-custom"></span>
                            <div class="perm-text-group">
                                <span class="perm-title">${this._escape(label)}</span>
                                <span class="perm-key-code">${this._escape(p.key)}</span>
                                <small class="perm-desc text-muted">${this._escape(desc)}</small>
                            </div>
                        </label>
                    </div>
                `;
            });

            sectionsHtml += `
                <div class="perm-section-block mb-3">
                    <div class="perm-section-header d-flex justify-content-between align-items-center mb-2">
                        <span class="perm-section-title font-weight-bold">📌 ${this._escape(title)}</span>
                        ${!disableAll ? `
                            <div class="perm-section-quick-btns">
                                <a href="javascript:void(0)" class="text-xs mr-2" onclick="UsersPage.toggleSectionChecks('${section.id}', true)">${I18n.t('all') || 'همه'}</a>
                                <a href="javascript:void(0)" class="text-xs text-muted" onclick="UsersPage.toggleSectionChecks('${section.id}', false)">${I18n.t('none') || 'هیچ'}</a>
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

    _escape(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    },
};
