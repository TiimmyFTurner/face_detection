/**
 * Auth — Client-side authentication and granular permission management.
 * Handles Bearer token storage, login/logout, session restoration,
 * and permission gating across the UI.
 */
const Auth = {
    _tokenKey: 'facewatch_auth_token',
    _user: null,
    _token: null,
    _onAuthChangeCallbacks: [],

    // ─── Initialization ────────────────────────────────────
    async init() {
        this._token = localStorage.getItem(this._tokenKey);
        if (!this._token) {
            this.showLoginModal();
            return false;
        }

        try {
            // Validate token and fetch current user profile + effective permissions
            const user = await App.api('/api/auth/me');
            this._user = user;
            this._triggerAuthChange();
            this.updateUserBadge();
            return true;
        } catch (err) {
            console.warn('Session expired or invalid token:', err);
            this.logout();
            return false;
        }
    },

    onAuthChange(callback) {
        if (typeof callback === 'function') {
            this._onAuthChangeCallbacks.push(callback);
        }
    },

    _triggerAuthChange() {
        this._onAuthChangeCallbacks.forEach(cb => {
            try { cb(this._user); } catch (e) { console.error(e); }
        });
        this.updateNavVisibility();
    },

    getToken() {
        return this._token;
    },

    getUser() {
        return this._user;
    },

    isAuthenticated() {
        return !!this._user && !!this._token;
    },

    isAdmin() {
        if (!this._user) return false;
        return this._user.role_name === 'admin' || (this._user.effective_permissions || []).includes('*');
    },

    hasPermission(perm) {
        if (!this._user) return false;
        if (this.isAdmin()) return true;
        const perms = this._user.effective_permissions || [];
        return perms.includes(perm);
    },

    hasAnyPermission(permsList) {
        if (!this._user) return false;
        if (this.isAdmin()) return true;
        return permsList.some(p => this.hasPermission(p));
    },

    // ─── Login / Logout ────────────────────────────────────
    async login(username, password) {
        const res = await App.api('/api/auth/login', 'POST', { username, password });
        this._token = res.access_token;
        this._user = res.user;
        localStorage.setItem(this._tokenKey, this._token);
        this._triggerAuthChange();
        this.updateUserBadge();
        App.closeModal();
        App.showToast(I18n.t('login_success') || 'خوش آمدید', 'success');
        App.navigate(App._currentPage || 'dashboard');
    },

    async logout() {
        if (this._token) {
            try {
                await App.api('/api/auth/logout', 'POST');
            } catch (e) {
                // Ignore network errors on logout
            }
        }
        this._token = null;
        this._user = null;
        localStorage.removeItem(this._tokenKey);
        this._triggerAuthChange();
        this.updateUserBadge();
        this.showLoginModal();
    },

    // ─── Navigation Visibility Gating ──────────────────────
    updateNavVisibility() {
        const navUsers = document.getElementById('nav-users');
        if (navUsers) {
            navUsers.style.display = this.hasAnyPermission(['users:view', 'users:manage']) ? 'flex' : 'none';
        }

        const navSettings = document.getElementById('nav-settings');
        if (navSettings) {
            navSettings.style.display = this.hasPermission('settings:view') ? 'flex' : 'none';
        }

        const navCameras = document.getElementById('nav-cameras');
        if (navCameras) {
            navCameras.style.display = this.hasPermission('cameras:view') ? 'flex' : 'none';
        }

        const navPersons = document.getElementById('nav-persons');
        if (navPersons) {
            navPersons.style.display = this.hasPermission('persons:view') ? 'flex' : 'none';
        }

        const navZones = document.getElementById('nav-zones');
        if (navZones) {
            navZones.style.display = this.hasPermission('zones:view') ? 'flex' : 'none';
        }

        const navDuty = document.getElementById('nav-duty');
        if (navDuty) {
            navDuty.style.display = this.hasPermission('duty:view') ? 'flex' : 'none';
        }

        const navDashboard = document.getElementById('nav-dashboard');
        if (navDashboard) {
            navDashboard.style.display = this.hasPermission('dashboard:view') ? 'flex' : 'none';
        }
    },

    // ─── User Profile Badge in Sidebar ─────────────────────
    updateUserBadge() {
        let container = document.getElementById('sidebar-user-badge');
        if (!container) {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            container = document.createElement('div');
            container.id = 'sidebar-user-badge';
            container.className = 'sidebar-user-container';

            // Insert above footer
            const footer = sidebar.querySelector('.sidebar-footer');
            if (footer) {
                sidebar.insertBefore(container, footer);
            } else {
                sidebar.appendChild(container);
            }
        }

        if (!this._user) {
            container.innerHTML = `
                <button class="btn btn-primary btn-sm w-100" onclick="Auth.showLoginModal()">
                    <span>🔐</span>
                    <span>${I18n.t('login') || 'ورود به سامانه'}</span>
                </button>
            `;
            return;
        }

        const roleBadgeClass = this._user.role_name === 'admin' ? 'badge-role-admin' :
                               this._user.role_name === 'supervisor' ? 'badge-role-supervisor' :
                               this._user.role_name === 'operator' ? 'badge-role-operator' : 'badge-role-viewer';

        const roleName = this._user.role_display_name || this._user.role_name || 'کاربر';

        container.innerHTML = `
            <div class="user-profile-pill" id="user-profile-pill" onclick="Auth.toggleUserMenu(event)">
                <div class="user-avatar-circle">
                    ${this._user.full_name ? this._user.full_name.charAt(0).toUpperCase() : '👤'}
                </div>
                <div class="user-info-text">
                    <span class="user-fullname">${this._escapeHtml(this._user.full_name || this._user.username)}</span>
                    <span class="user-role-badge ${roleBadgeClass}">${this._escapeHtml(roleName)}</span>
                </div>
                <span class="user-menu-arrow">▾</span>
            </div>
            <div class="user-dropdown-menu" id="user-dropdown-menu" style="display: none;">
                <div class="user-dropdown-header">
                    <div class="user-dropdown-name">${this._escapeHtml(this._user.full_name)}</div>
                    <div class="user-dropdown-username">@${this._escapeHtml(this._user.username)}</div>
                </div>
                <div class="user-dropdown-divider"></div>
                <a class="user-dropdown-item" onclick="Auth.showChangePasswordModal()">
                    <span>🔑</span>
                    <span>${I18n.t('change_password') || 'تغییر کلمه عبور'}</span>
                </a>
                <div class="user-dropdown-divider"></div>
                <a class="user-dropdown-item text-danger" onclick="Auth.logout()">
                    <span>🚪</span>
                    <span>${I18n.t('logout') || 'خروج از حساب'}</span>
                </a>
            </div>
        `;

        // Close dropdown when clicking outside
        document.removeEventListener('click', Auth._handleOutsideClick);
        document.addEventListener('click', Auth._handleOutsideClick);
    },

    _handleOutsideClick(e) {
        const pill = document.getElementById('user-profile-pill');
        const menu = document.getElementById('user-dropdown-menu');
        if (pill && menu && !pill.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    },

    toggleUserMenu(e) {
        e.stopPropagation();
        const menu = document.getElementById('user-dropdown-menu');
        if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        }
    },

    // ─── Password Visibility Helper ────────────────────────
    togglePasswordVisibility(inputId, btnEl) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        if (btnEl) {
            btnEl.textContent = isPass ? '👁️‍🗨️' : '👁️';
            btnEl.title = isPass ? (I18n.t('hide_password') || 'مخفی کردن کلمه عبور') : (I18n.t('show_password') || 'نمایش کلمه عبور');
        }
    },

    // ─── Login Modal Dialog ────────────────────────────────
    showLoginModal() {
        const content = `
            <div class="login-modal-card">
                <div class="login-modal-brand">
                    <div class="login-brand-icon">🛡️</div>
                    <h2>${I18n.t('login_title') || 'سامانه نظارت تصویری هوشمند'}</h2>
                    <p class="login-modal-subtitle">${I18n.t('login_subtitle') || 'لطفاً برای دسترسی به سامانه، نام کاربری و کلمه عبور خود را وارد نمایید'}</p>
                </div>

                <div id="login-error-alert" class="alert alert-danger login-alert" style="display: none;"></div>

                <form id="login-form" class="login-form" onsubmit="Auth._handleLoginForm(event)">
                    <div class="form-group mb-3">
                        <label for="login-username" class="form-label">${I18n.t('username') || 'نام کاربری'}</label>
                        <div class="input-glass-group">
                            <span class="input-glass-icon">👤</span>
                            <input type="text" id="login-username" class="input-glass-field" required autofocus autocomplete="username" placeholder="${I18n.t('username_placeholder') || 'نام کاربری خود را وارد نمایید'}">
                        </div>
                    </div>

                    <div class="form-group mb-4">
                        <label for="login-password" class="form-label">${I18n.t('password') || 'کلمه عبور'}</label>
                        <div class="input-glass-group">
                            <span class="input-glass-icon">🔒</span>
                            <input type="password" id="login-password" class="input-glass-field" required autocomplete="current-password" placeholder="${I18n.t('password_placeholder') || 'کلمه عبور خود را وارد نمایید'}">
                            <button type="button" class="input-glass-toggle" onclick="Auth.togglePasswordVisibility('login-password', this)" title="${I18n.t('show_password') || 'نمایش کلمه عبور'}">👁️</button>
                        </div>
                    </div>

                    <button type="submit" id="login-submit-btn" class="btn-login-submit">
                        <span class="btn-icon">🔐</span>
                        <span class="btn-text">${I18n.t('login_btn') || 'ورود به سیستم'}</span>
                    </button>
                </form>
            </div>
        `;

        App.openModal(content, 'modal-login');

        // Prevent closing login modal by backdrop when unauthenticated
        const overlay = document.getElementById('modal-overlay');
        if (overlay && !this.isAuthenticated()) {
            overlay.style.pointerEvents = 'auto';
        }
    },

    async _handleLoginForm(e) {
        e.preventDefault();
        const userEl = document.getElementById('login-username');
        const passEl = document.getElementById('login-password');
        const errEl = document.getElementById('login-error-alert');
        const btn = document.getElementById('login-submit-btn');

        if (!userEl || !passEl) return;
        const username = userEl.value.trim();
        const password = passEl.value;

        if (errEl) {
            errEl.style.display = 'none';
            errEl.textContent = '';
        }
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> <span>${I18n.t('logging_in') || 'در حال اعتبارسنجی...'}</span>`;
        }

        try {
            await this.login(username, password);
        } catch (err) {
            if (errEl) {
                let errorMsg = err.message || '';
                if (!errorMsg || errorMsg === 'invalid_credentials' || errorMsg.includes('نام کاربری یا کلمه عبور') || errorMsg.toLowerCase().includes('invalid') || errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
                    errorMsg = I18n.t('invalid_credentials') || 'نام کاربری یا کلمه عبور نادرست است.';
                } else if (errorMsg.includes('غیرفعال') || errorMsg.toLowerCase().includes('inactive') || errorMsg.includes('403')) {
                    errorMsg = I18n.t('account_disabled') || 'حساب کاربری شما غیرفعال شده است. لطفاً با مدیر سیستم تماس بگیرید.';
                }
                errEl.textContent = errorMsg;
                errEl.style.display = 'flex';
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span class="btn-icon">🔐</span> <span class="btn-text">${I18n.t('login_btn') || 'ورود به سیستم'}</span>`;
            }
        }
    },

    // ─── Change Password Modal Dialog ──────────────────────
    showChangePasswordModal() {
        const content = `
            <div class="modal-header">
                <div class="modal-title-group">
                    <span class="modal-icon">🔑</span>
                    <div>
                        <h2 class="modal-title">${I18n.t('change_password') || 'تغییر کلمه عبور'}</h2>
                        <p class="modal-subtitle">${I18n.t('change_password_subtitle') || 'برای حفظ امنیت حساب کاربری، کلمه عبور فعلی و جدید خود را وارد نمایید'}</p>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body">
                <div id="pwd-error-alert" class="alert alert-danger" style="display: none; margin-bottom: 1.25rem;"></div>

                <form id="change-pwd-form" onsubmit="Auth._handleChangePasswordForm(event)">
                    <div class="form-group mb-3">
                        <label for="current-password" class="form-label">${I18n.t('current_password') || 'کلمه عبور فعلی'} *</label>
                        <div class="input-glass-group">
                            <span class="input-glass-icon">🔒</span>
                            <input type="password" id="current-password" class="input-glass-field" required autocomplete="current-password" placeholder="${I18n.t('current_password_placeholder') || 'کلمه عبور فعلی را وارد نمایید'}">
                            <button type="button" class="input-glass-toggle" onclick="Auth.togglePasswordVisibility('current-password', this)" title="${I18n.t('show_password') || 'نمایش کلمه عبور'}">👁️</button>
                        </div>
                    </div>

                    <div class="form-group mb-3">
                        <label for="new-password" class="form-label">${I18n.t('new_password') || 'کلمه عبور جدید'} *</label>
                        <div class="input-glass-group">
                            <span class="input-glass-icon">✨</span>
                            <input type="password" id="new-password" class="input-glass-field" required minlength="4" autocomplete="new-password" placeholder="${I18n.t('new_password_placeholder') || 'کلمه عبور جدید (حداقل ۴ کاراکتر)'}">
                            <button type="button" class="input-glass-toggle" onclick="Auth.togglePasswordVisibility('new-password', this)" title="${I18n.t('show_password') || 'نمایش کلمه عبور'}">👁️</button>
                        </div>
                    </div>

                    <div class="form-group mb-4">
                        <label for="confirm-new-password" class="form-label">${I18n.t('confirm_new_password') || 'تکرار کلمه عبور جدید'} *</label>
                        <div class="input-glass-group">
                            <span class="input-glass-icon">🔁</span>
                            <input type="password" id="confirm-new-password" class="input-glass-field" required minlength="4" autocomplete="new-password" placeholder="${I18n.t('confirm_new_password_placeholder') || 'تکرار کلمه عبور جدید را وارد نمایید'}">
                            <button type="button" class="input-glass-toggle" onclick="Auth.togglePasswordVisibility('confirm-new-password', this)" title="${I18n.t('show_password') || 'نمایش کلمه عبور'}">👁️</button>
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel') || 'انصراف'}</button>
                        <button type="submit" id="save-pwd-btn" class="btn btn-primary">
                            <span>💾</span>
                            <span>${I18n.t('save_changes') || I18n.t('save') || 'ذخیره تغییرات'}</span>
                        </button>
                    </div>
                </form>
            </div>
        `;
        App.openModal(content, 'modal-md');
    },

    async _handleChangePasswordForm(e) {
        e.preventDefault();
        const currEl = document.getElementById('current-password');
        const newEl = document.getElementById('new-password');
        const confEl = document.getElementById('confirm-new-password');
        const errEl = document.getElementById('pwd-error-alert');
        const btn = document.getElementById('save-pwd-btn');

        if (!currEl || !newEl || !confEl) return;
        if (newEl.value !== confEl.value) {
            if (errEl) {
                errEl.textContent = I18n.t('passwords_do_not_match') || 'کلمه عبور جدید و تکرار آن یکسان نیستند.';
                errEl.style.display = 'block';
            }
            return;
        }

        if (newEl.value.length < 4) {
            if (errEl) {
                errEl.textContent = I18n.t('password_min_length') || 'کلمه عبور باید حداقل ۴ کاراکتر باشد.';
                errEl.style.display = 'block';
            }
            return;
        }

        if (errEl) errEl.style.display = 'none';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> <span>${I18n.t('saving') || 'در حال ذخیره...'}</span>`;
        }

        try {
            await App.api('/api/auth/change-password', 'POST', {
                current_password: currEl.value,
                new_password: newEl.value,
            });
            App.closeModal();
            App.showToast(I18n.t('password_changed_success') || 'کلمه عبور با موفقیت تغییر یافت.', 'success');
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || 'خطا در تغییر کلمه عبور';
                errEl.style.display = 'block';
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>💾</span> <span>${I18n.t('save_changes') || I18n.t('save') || 'ذخیره تغییرات'}</span>`;
            }
        }
    },

    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },
};
