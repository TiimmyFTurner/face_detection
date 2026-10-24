/**
 * FaceTrack TV / Kiosk Display Controller
 * Real-time zero-scroll dashboard for factory monitors and wall TVs.
 */

const TVBoard = {
    // ── Configuration & State ────────────────────────────────
    _token: null,
    _data: null,
    _lang: localStorage.getItem('facetrack_tv_lang') || 'fa',
    _soundEnabled: localStorage.getItem('facetrack_tv_sound') === 'true',
    _refreshTimer: null,
    _clockTimer: null,
    _carouselTimer: null,
    _ws: null,
    _pageIndex: 0,
    _pageSize: 16,
    _prevAbsentCount: 0,
    _audioCtx: null,

    // ── Localization Dictionary ──────────────────────────────
    i18n: {
        fa: {
            title: 'مانیتورینگ زنده سالن تولید و شیفت',
            subtitle: 'سامانه نظارت تصویری هوشمند فیس‌ترک',
            shift_active: 'شیفت فعال',
            no_active_shift: 'در حال حاضر شیفت فعالی تعریف نشده است',
            kpi_scheduled: 'کل شیفت',
            kpi_present: 'حاضر در پست',
            kpi_absent: 'غایب / ترک پست',
            kpi_break: 'زمان استراحت',
            kpi_compliance: 'انضباط شیفت',
            persons_unit: 'نفر',
            status_present: 'حاضر در ایستگاه',
            status_absent: 'غایب از ایستگاه',
            status_on_break: 'زمان استراحت قانونی',
            status_offline: 'دوربین مداربسته قطع',
            status_off_duty: 'خارج از ساعت شیفت',
            seen_ago: 'آخرین رویت: {s} ثانیه قبل',
            absent_for: 'ترک پست: {m} دقیقه',
            shift_absence_total: 'مجموع غیبت در شیفت:',
            no_workers_scheduled: 'هیچ پرسنلی برای شیفت جاری ثبت نشده است',
            no_workers_sub: 'برای تعریف شیفت‌ها به بخش «منطقه‌ها و شیفت‌ها» در پنل مدیریت مراجعه کنید.',
            ticker_title: 'هشدار و رویداد',
            ticker_all_normal: 'کلیه ایستگاه‌های فعال در وضعیت پایدار می‌باشند. انضباط کلی شیفت مطلوب است.',
            sync_ok: 'متصل به سامانه',
            sync_reconnecting: 'در حال اتصال مجدد...',
            sound_on: 'صدای هشدار: فعال',
            sound_off: 'صدای هشدار: خاموش',
            fullscreen_btn: 'تمام صفحه (F11)',
            login_title: 'احراز هویت نمایشگر سالن',
            login_desc: 'جهت بارگذاری داده‌های زنده شیفت، نام کاربری و کلمه عبور سرپرست را وارد کنید:',
            username_ph: 'نام کاربری',
            password_ph: 'کلمه عبور',
            login_btn: 'ورود و شروع مانیتورینگ',
            login_err: 'نام کاربری یا رمز عبور اشتباه است.',
            page_indicator: 'صفحه {current} از {total}',
            personnel_id: 'کد',
            shift_on_duty: 'شیفت موظف',
            shift_presence_total: 'حضور مفید:',
            shift_incidents: 'دفعات خروج:',
            shift_incidents_unit: 'بار',
            seen_just_now: 'آخرین رویت: لحظاتی پیش',
            not_seen_yet: 'عدم ثبت حضور تاکنون',
            station_operator: 'اپراتور ایستگاه',
            shift_night: 'شیفت شب',
            grace_period: 'مهلت ورود',
        },
        en: {
            title: 'Factory Live Shift & Attendance Monitor',
            subtitle: 'FaceTrack Intelligent Surveillance',
            shift_active: 'Active Shift',
            no_active_shift: 'No active shift scheduled right now',
            kpi_scheduled: 'Scheduled',
            kpi_present: 'In Station',
            kpi_absent: 'Absent / Missing',
            kpi_break: 'On Break',
            kpi_compliance: 'Compliance',
            persons_unit: 'staff',
            status_present: 'Present at Station',
            status_absent: 'Absent / Unattended',
            status_on_break: 'Official Break',
            status_offline: 'Camera Offline',
            status_off_duty: 'Off Duty',
            seen_ago: 'Last seen: {s}s ago',
            absent_for: 'Missing for {m} mins',
            shift_absence_total: 'Shift Absence Total:',
            no_workers_scheduled: 'No personnel assigned to active shifts right now',
            no_workers_sub: 'Configure zones and shifts from the main administration panel.',
            ticker_title: 'ALERTS',
            ticker_all_normal: 'All active workstations operational. Factory shift attendance is normal.',
            sync_ok: 'Live Connected',
            sync_reconnecting: 'Reconnecting...',
            sound_on: 'Alert Sound: ON',
            sound_off: 'Alert Sound: OFF',
            fullscreen_btn: 'Fullscreen (F11)',
            login_title: 'Factory TV Authentication',
            login_desc: 'Enter supervisor credentials to display live duty roster data:',
            username_ph: 'Username',
            password_ph: 'Password',
            login_btn: 'Authenticate & Start',
            login_err: 'Invalid username or password.',
            page_indicator: 'Page {current} of {total}',
            personnel_id: 'ID',
            shift_on_duty: 'On Duty',
            shift_presence_total: 'Active Duty:',
            shift_incidents: 'Departures:',
            shift_incidents_unit: 'x',
            seen_just_now: 'Last seen: Just now',
            not_seen_yet: 'Not detected yet today',
            station_operator: 'Station Operator',
            shift_night: 'Night Shift',
            grace_period: 'Grace Period',
        }
    },

    t(key, params = {}) {
        let text = (this.i18n[this._lang] && this.i18n[this._lang][key]) || key;
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
        return text;
    },

    toDigits(num) {
        if (num === null || num === undefined) return '';
        if (this._lang === 'fa') {
            const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
            return String(num).replace(/\d/g, d => farsiDigits[parseInt(d, 10)]);
        }
        return String(num);
    },

    formatMinutes(mins) {
        if (!mins || mins <= 0) {
            return this._lang === 'fa' ? '۰ دقیقه' : '0m';
        }
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        if (this._lang === 'fa') {
            if (h > 0 && m > 0) return `${this.toDigits(h)}س ${this.toDigits(m)}د`;
            if (h > 0) return `${this.toDigits(h)} ساعت`;
            return `${this.toDigits(m)} دقیقه`;
        } else {
            if (h > 0 && m > 0) return `${h}h ${m}m`;
            if (h > 0) return `${h}h`;
            return `${m}m`;
        }
    },

    formatDurationHours(hours) {
        if (!hours) return '';
        const hVal = Number(hours);
        const displayVal = (hVal % 1 === 0) ? hVal.toFixed(0) : hVal.toFixed(1);
        if (this._lang === 'fa') {
            return `${this.toDigits(displayVal)} ساعت`;
        }
        return `${displayVal}h`;
    },

    // ── Initialization ───────────────────────────────────────
    init() {
        this.applyLanguage();
        this.updateSoundUI();
        this.extractToken();
        this.setupClock();
        this.setupKeyboardShortcuts();

        if (this._token) {
            this.hideLoginModal();
            this.fetchRoster();
            this.startPolling();
            this.connectWebSocket();
        } else {
            this.showLoginModal();
        }
    },

    // ── Authentication Token Management ──────────────────────
    extractToken() {
        const urlParams = new URLSearchParams(window.location.search);
        const queryToken = urlParams.get('token');
        if (queryToken) {
            this._token = queryToken;
            localStorage.setItem('facewatch_auth_token', queryToken);
            document.cookie = `access_token=${queryToken}; path=/; max-age=604800; SameSite=Lax`;
            return;
        }

        const storedToken = localStorage.getItem('facewatch_auth_token');
        if (storedToken) {
            this._token = storedToken;
            document.cookie = `access_token=${storedToken}; path=/; max-age=604800; SameSite=Lax`;
            return;
        }

        const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
        if (match && match[1]) {
            this._token = match[1];
        }
    },

    showLoginModal() {
        const modal = document.getElementById('tv-login-modal');
        if (modal) modal.style.display = 'flex';
    },

    hideLoginModal() {
        const modal = document.getElementById('tv-login-modal');
        if (modal) modal.style.display = 'none';
    },

    async handleLogin(event) {
        if (event) event.preventDefault();
        const userEl = document.getElementById('tv-login-username');
        const passEl = document.getElementById('tv-login-password');
        const errEl = document.getElementById('tv-login-error');
        if (!userEl || !passEl) return;

        const username = userEl.value.trim();
        const password = passEl.value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (!res.ok) {
                if (errEl) {
                    errEl.textContent = this.t('login_err');
                    errEl.style.display = 'block';
                }
                return;
            }

            const data = await res.json();
            this._token = data.access_token || data.token;
            localStorage.setItem('facewatch_auth_token', this._token);
            document.cookie = `access_token=${this._token}; path=/; max-age=604800; SameSite=Lax`;

            this.hideLoginModal();
            this.fetchRoster();
            this.startPolling();
            this.connectWebSocket();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || this.t('login_err');
                errEl.style.display = 'block';
            }
        }
    },

    // ── Live Clock & Date ────────────────────────────────────
    setupClock() {
        this.updateClock();
        if (this._clockTimer) clearInterval(this._clockTimer);
        this._clockTimer = setInterval(() => this.updateClock(), 1000);
    },

    updateClock() {
        const now = new Date();
        const timeEl = document.getElementById('tv-clock-time');
        const dateEl = document.getElementById('tv-clock-date');

        if (timeEl) {
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');

            if (this._lang === 'fa') {
                timeEl.innerHTML = `${this.toDigits(h)}<span class="tv-clock-colon">:</span>${this.toDigits(m)}<span class="tv-clock-colon">:</span>${this.toDigits(s)}`;
            } else {
                timeEl.innerHTML = `${h}<span class="tv-clock-colon">:</span>${m}<span class="tv-clock-colon">:</span>${s}`;
            }
        }

        if (dateEl) {
            try {
                if (this._lang === 'fa') {
                    dateEl.textContent = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    }).format(now);
                } else {
                    dateEl.textContent = new Intl.DateTimeFormat('en-US-u-ca-persian', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    }).format(now);
                }
            } catch (e) {
                dateEl.textContent = now.toDateString();
            }
        }
    },

    // ── API Communication & Polling ──────────────────────────
    async fetchRoster() {
        if (!this._token) return;

        const syncDot = document.getElementById('tv-sync-dot');
        const syncText = document.getElementById('tv-sync-text');
        if (syncDot) syncDot.classList.add('updating');

        try {
            const res = await fetch('/api/zones/duty-roster?only_active=true', {
                headers: {
                    'Authorization': `Bearer ${this._token}`,
                    'Accept': 'application/json'
                }
            });

            if (res.status === 401 || res.status === 403) {
                console.warn('TV token expired or invalid');
                this.showLoginModal();
                return;
            }

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            this._data = data;

            // Trigger alert sound if new absent personnel detected
            if (this._soundEnabled && data.absent_count > 0 && data.absent_count > this._prevAbsentCount) {
                this.playAlertTone();
            }
            this._prevAbsentCount = data.absent_count || 0;

            if (syncText) syncText.textContent = this.t('sync_ok');
            if (syncDot) syncDot.style.backgroundColor = 'var(--tv-emerald)';

            this.renderKPIs(data);
            this.renderRoster(data.roster || []);
            this.renderAlertTicker(data);

        } catch (err) {
            console.error('TV roster fetch error:', err);
            if (syncText) syncText.textContent = this.t('sync_reconnecting');
            if (syncDot) syncDot.style.backgroundColor = 'var(--tv-amber)';
        } finally {
            if (syncDot) {
                setTimeout(() => syncDot.classList.remove('updating'), 600);
            }
        }
    },

    startPolling() {
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => this.fetchRoster(), 5000);
    },

    connectWebSocket() {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) return;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/ws/events`;

        try {
            this._ws = new WebSocket(wsUrl);
            this._ws.onmessage = (event) => {
                // Instantly re-fetch roster upon receiving new detection event
                this.fetchRoster();
            };
            this._ws.onclose = () => {
                setTimeout(() => this.connectWebSocket(), 10000);
            };
        } catch (e) {
            console.warn('TV WebSocket connection failed, relying on polling:', e);
        }
    },

    // ── Render KPIs ──────────────────────────────────────────
    renderKPIs(data) {
        const valScheduled = document.getElementById('tv-kpi-scheduled-val');
        const valPresent = document.getElementById('tv-kpi-present-val');
        const valAbsent = document.getElementById('tv-kpi-absent-val');
        const valBreak = document.getElementById('tv-kpi-break-val');
        const valCompliance = document.getElementById('tv-kpi-compliance-val');
        const cardAbsent = document.getElementById('tv-kpi-absent-card');

        if (valScheduled) valScheduled.textContent = this.toDigits(data.total_on_duty || 0);
        if (valPresent) valPresent.textContent = this.toDigits(data.present_count || 0);
        if (valAbsent) valAbsent.textContent = this.toDigits(data.absent_count || 0);
        if (valBreak) valBreak.textContent = this.toDigits(data.on_break_count || 0);
        if (valCompliance) valCompliance.textContent = `${this.toDigits(data.avg_compliance_pct || 100)}%`;

        if (cardAbsent) {
            cardAbsent.classList.toggle('has-absent', (data.absent_count || 0) > 0);
        }

        // Shift label badge
        const shiftTag = document.getElementById('tv-shift-tag');
        if (shiftTag) {
            const roster = data.roster || [];
            const activeWorkers = roster.filter(r => r.is_in_duty_hours);
            const pool = activeWorkers.length > 0 ? activeWorkers : roster;
            const uniqueWindows = [...new Set(pool.map(r => r.shift_window_str || r.shift_window).filter(Boolean))];

            if (uniqueWindows.length > 0) {
                const windowText = uniqueWindows.map(w => this.toDigits(w)).join(' ، ');
                const hasOvernight = pool.some(r => r.is_overnight);
                const durText = (uniqueWindows.length === 1 && pool[0]?.shift_duration_hours)
                    ? ` (${this.formatDurationHours(pool[0].shift_duration_hours)})`
                    : '';
                const shiftIcon = hasOvernight ? '🌙' : '⏱️';
                shiftTag.innerHTML = `${shiftIcon} ${this.t('shift_active')}: <strong>${windowText}</strong>${durText}`;
                shiftTag.classList.remove('no-shift');
                shiftTag.style.display = 'inline-flex';
            } else {
                shiftTag.innerHTML = `⏱️ ${this.t('no_active_shift')}`;
                shiftTag.classList.add('no-shift');
                shiftTag.style.display = 'inline-flex';
            }
        }
    },

    // ── Render Roster (Zero-Scroll Auto-Fit Grid) ────────────
    renderRoster(roster) {
        const container = document.getElementById('tv-roster-grid');
        const paginationStrip = document.getElementById('tv-pagination-strip');
        if (!container) return;

        if (!roster || roster.length === 0) {
            container.innerHTML = `
                <div class="tv-empty-state" style="grid-column: 1 / -1;">
                    <div class="tv-empty-icon">🏭</div>
                    <div class="tv-empty-title">${this.t('no_workers_scheduled')}</div>
                    <div class="tv-empty-subtitle">${this.t('no_workers_sub')}</div>
                </div>
            `;
            if (paginationStrip) paginationStrip.innerHTML = '';
            return;
        }

        // Determine items per page (typically 12 or 16 for high-density 1080p display)
        const total = roster.length;
        const totalPages = Math.ceil(total / this._pageSize);

        if (this._pageIndex >= totalPages) {
            this._pageIndex = 0;
        }

        // Setup Carousel Timer if more than 1 page exists
        if (totalPages > 1 && !this._carouselTimer) {
            this._carouselTimer = setInterval(() => {
                this._pageIndex = (this._pageIndex + 1) % totalPages;
                this.renderRoster(this._data ? this._data.roster : []);
            }, 12000); // 12 seconds per page
        } else if (totalPages <= 1 && this._carouselTimer) {
            clearInterval(this._carouselTimer);
            this._carouselTimer = null;
        }

        const startIndex = this._pageIndex * this._pageSize;
        const pageItems = roster.slice(startIndex, startIndex + this._pageSize);

        // Dynamically compute optimal columns and rows for 100% height fit
        const count = pageItems.length;

        // Reset inline grid template styles
        container.style.gridTemplateColumns = '';
        container.style.gridTemplateRows = '';

        if (count === 1) {
            container.className = 'tv-roster-grid is-single-card is-few-cards';
        } else if (count === 2) {
            container.className = 'tv-roster-grid is-two-cards is-few-cards';
        } else if (count === 3) {
            container.className = 'tv-roster-grid is-three-cards is-few-cards';
        } else if (count === 4) {
            container.className = 'tv-roster-grid is-four-cards is-few-cards';
        } else {
            container.className = 'tv-roster-grid is-many-cards';
            let cols = 4;
            let rows = 4;
            if (count <= 6) { cols = 3; rows = 2; }
            else if (count <= 8) { cols = 4; rows = 2; }
            else if (count <= 12) { cols = 4; rows = 3; }
            else if (count <= 16) { cols = 4; rows = 4; }
            else { cols = 6; rows = 3; }

            container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
            container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        }

        // Render Cards
        container.innerHTML = pageItems.map(p => this.renderWorkerCard(p)).join('');

        // Render Page Dots
        if (paginationStrip) {
            if (totalPages > 1) {
                paginationStrip.innerHTML = Array.from({ length: totalPages }, (_, i) => `
                    <div class="tv-page-dot ${i === this._pageIndex ? 'active' : ''}"></div>
                `).join('') + `
                    <span style="font-size: 0.78rem; color: var(--tv-text-dim); margin-right: 6px;">
                        ${this.t('page_indicator', { current: this.toDigits(this._pageIndex + 1), total: this.toDigits(totalPages) })}
                    </span>
                `;
            } else {
                paginationStrip.innerHTML = '';
            }
        }
    },

    renderWorkerCard(person) {
        const isPresent = person.status === 'present';
        const isAbsent = person.status === 'absent';
        const isOnBreak = person.status === 'on_break';
        const isOffline = person.status === 'camera_offline';

        let statusText = this.t('status_present');
        let statusSub = '';

        if (isAbsent) {
            statusText = this.t('status_absent');
            statusSub = this.t('absent_for', { m: this.toDigits(person.current_absence_minutes || 1) });
        } else if (isOnBreak) {
            statusText = this.t('status_on_break');
            statusSub = person.current_break_name || this.t('status_on_break');
        } else if (isOffline) {
            statusText = this.t('status_offline');
            statusSub = person.camera_name || '';
        } else {
            // Present
            if (person.is_within_grace_period && (person.last_seen_seconds_ago === null || person.last_seen_seconds_ago === undefined)) {
                statusText = this.isRtl ? 'در مهلت ورود' : 'In Grace Period';
                const el = Math.round(person.shift_elapsed_minutes || 0);
                const gr = person.grace_period_minutes || 10;
                statusSub = `${this.toDigits(el)}/${this.toDigits(gr)}m`;
            } else if (person.last_seen_seconds_ago !== null && person.last_seen_seconds_ago !== undefined) {
                const s = Math.round(person.last_seen_seconds_ago);
                statusSub = s < 5
                    ? this.t('seen_just_now')
                    : (s < 60 ? this.t('seen_ago', { s: this.toDigits(s) }) : `${this.toDigits(Math.round(s / 60))}m ago`);
            } else {
                statusSub = this.t('seen_just_now');
            }
        }

        const avatarMarkup = person.avatar_url
            ? `<img class="tv-avatar-img" src="${person.avatar_url}" alt="${person.person_name}" onerror="this.outerHTML='<div class=\\'tv-avatar-placeholder\\'>👤</div>'">`
            : `<div class="tv-avatar-placeholder">👤</div>`;

        const compliance = Math.round(person.shift_compliance_pct ?? 100);
        const compColor = compliance >= 90 ? 'var(--tv-emerald)' : (compliance >= 70 ? 'var(--tv-amber)' : 'var(--tv-rose)');

        const presenceFormatted = this.formatMinutes(person.shift_presence_minutes || 0);
        const absenceFormatted = this.formatMinutes(person.shift_absence_minutes || 0);
        const durationFormatted = this.formatDurationHours(person.shift_duration_hours);
        const incidentsCount = person.absence_count || 0;

        return `
            <div class="tv-card status-${person.status}">
                <div class="tv-card-header">
                    <div class="tv-avatar-wrap">
                        ${avatarMarkup}
                        <div class="tv-status-badge-dot"></div>
                    </div>
                    <div class="tv-card-meta">
                        <div class="tv-name-row">
                            <span class="tv-person-name" title="${person.person_name}">${person.person_name}</span>
                            ${person.person_id ? `<span class="tv-id-badge" title="${this.t('personnel_id')} ${person.person_id}">#${this.toDigits(person.person_id)}</span>` : ''}
                        </div>
                        <div class="tv-role-row">
                            <span class="tv-person-role">${person.person_role || this.t('station_operator')}</span>
                        </div>
                        <div class="tv-tags-row">
                            <span class="tv-zone-name" title="${person.zone_name}">
                                📍 ${person.zone_name}
                            </span>
                            ${person.camera_name ? `
                                <span class="tv-camera-name" title="${person.camera_name}">
                                    📹 ${person.camera_name}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <div class="tv-shift-strip">
                    <div class="tv-shift-window">
                        <span class="tv-shift-icon">${person.is_overnight ? '🌙' : '⏱️'}</span>
                        ${person.shift_name ? `<span class="tv-shift-name" style="color: var(--tv-cyan, #38bdf8); font-weight: 700; margin-inline-end: 4px;">${person.shift_name}</span>` : ''}
                        <span>${this.toDigits(person.shift_window_str || '--:--')}</span>
                        ${durationFormatted ? `<span class="tv-shift-hours">(${durationFormatted})</span>` : ''}
                        ${person.is_overnight ? `<span class="tv-overnight-badge" style="font-size: 0.65rem; background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); padding: 1px 5px; border-radius: 4px; margin-inline-start: 4px; font-weight: 600;">🌙 ${this.t('shift_night')}</span>` : ''}
                    </div>
                    <div class="tv-shift-state-tag ${person.is_in_free_time ? 'state-break' : (person.is_within_grace_period ? 'state-break' : (person.is_in_duty_hours ? 'state-duty' : 'state-off'))}">
                        ${person.is_in_free_time ? `☕ ${person.current_break_name || this.t('status_on_break')}` : (person.is_within_grace_period ? `✓ ${this.t('grace_period')}` : (person.is_in_duty_hours ? `⚡ ${this.t('shift_on_duty')}` : `💤 ${this.t('status_off_duty')}`))}
                    </div>
                </div>

                <div class="tv-card-body">
                    <div class="tv-status-text">
                        <span>${isAbsent ? '🔴' : (isPresent ? '🟢' : (isOnBreak ? '☕' : '🟡'))}</span>
                        <span>${statusText}</span>
                    </div>
                    <div class="tv-status-sub">${statusSub}</div>
                </div>

                <div class="tv-card-footer">
                    <div class="tv-stats-grid">
                        <div class="tv-stat-box stat-presence" title="${this.t('shift_presence_total')}">
                            <span class="tv-stat-box-label">⏱️ ${this.t('shift_presence_total')}</span>
                            <span class="tv-stat-box-val val-presence">${presenceFormatted}</span>
                        </div>
                        <div class="tv-stat-box stat-absence" title="${this.t('shift_absence_total')}">
                            <span class="tv-stat-box-label">🚪 ${this.t('shift_absence_total')}</span>
                            <span class="tv-stat-box-val val-absence ${person.shift_absence_minutes > 0 ? 'alert' : ''}">${absenceFormatted}</span>
                        </div>
                        <div class="tv-stat-box stat-incidents" title="${this.t('shift_incidents')}">
                            <span class="tv-stat-box-label">⚠️ ${this.t('shift_incidents')}</span>
                            <span class="tv-stat-box-val val-incidents ${incidentsCount > 0 ? 'warning' : ''}">${this.toDigits(incidentsCount)} ${this.t('shift_incidents_unit')}</span>
                        </div>
                        <div class="tv-stat-box stat-compliance" title="${this.t('kpi_compliance')}">
                            <span class="tv-stat-box-label">📈 ${this.t('kpi_compliance')}</span>
                            <span class="tv-stat-box-val val-compliance" style="color: ${compColor};">${this.toDigits(compliance)}%</span>
                        </div>
                    </div>
                    <div class="tv-progress-track">
                        <div class="tv-progress-bar" style="width: ${compliance}%; background: ${compColor};"></div>
                    </div>
                </div>
            </div>
        `;
    },

    // ── Render Bottom Alert Ticker ───────────────────────────
    renderAlertTicker(data) {
        const marqueeEl = document.getElementById('tv-ticker-marquee');
        if (!marqueeEl) return;

        const absentWorkers = (data.roster || []).filter(p => p.status === 'absent');
        if (absentWorkers.length > 0) {
            const alerts = absentWorkers.map(p => 
                `⚠️ ${p.person_name} (${p.zone_name}): ${this.t('absent_for', { m: this.toDigits(p.current_absence_minutes || 1) })}`
            ).join('  |  ');
            marqueeEl.textContent = alerts;
        } else {
            marqueeEl.textContent = this.t('ticker_all_normal');
        }
    },

    // ── Web Audio Synth Alert ────────────────────────────────
    playAlertTone() {
        try {
            if (!this._audioCtx) {
                this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this._audioCtx.state === 'suspended') {
                this._audioCtx.resume();
            }

            const osc = this._audioCtx.createOscillator();
            const gain = this._audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, this._audioCtx.currentTime); // D5
            osc.frequency.setValueAtTime(880, this._audioCtx.currentTime + 0.15); // A5

            gain.gain.setValueAtTime(0.15, this._audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this._audioCtx.currentTime + 0.45);

            osc.connect(gain);
            gain.connect(this._audioCtx.destination);

            osc.start();
            osc.stop(this._audioCtx.currentTime + 0.45);
        } catch (e) {
            console.warn('Audio tone could not play:', e);
        }
    },

    updateSoundUI() {
        const btn = document.getElementById('tv-btn-sound');
        if (btn) {
            btn.innerHTML = this._soundEnabled 
                ? '🔔 <span>' + this.t('sound_on') + '</span>' 
                : '🔕 <span>' + this.t('sound_off') + '</span>';
            btn.classList.toggle('active', this._soundEnabled);
        }
    },

    toggleSound() {
        this._soundEnabled = !this._soundEnabled;
        try {
            localStorage.setItem('facetrack_tv_sound', this._soundEnabled ? 'true' : 'false');
        } catch (e) {}
        this.updateSoundUI();
        if (this._soundEnabled) {
            this.playAlertTone();
        }
    },

    // ── Fullscreen Support ───────────────────────────────────
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.warn('Fullscreen request denied:', err);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    },

    // ── Language Toggle (Persian / English) ──────────────────
    toggleLanguage() {
        this._lang = this._lang === 'fa' ? 'en' : 'fa';
        localStorage.setItem('facetrack_tv_lang', this._lang);
        this.applyLanguage();
        this.updateClock();
        if (this._data) {
            this.renderKPIs(this._data);
            this.renderRoster(this._data.roster || []);
            this.renderAlertTicker(this._data);
        }
    },

    applyLanguage() {
        document.documentElement.lang = this._lang;
        document.body.dir = this._lang === 'fa' ? 'rtl' : 'ltr';

        const langBtn = document.getElementById('tv-btn-lang');
        if (langBtn) {
            langBtn.textContent = this._lang === 'fa' ? 'EN' : 'فارسی';
        }

        const titleEl = document.getElementById('tv-header-title');
        if (titleEl) titleEl.textContent = this.t('title');

        const kpiSched = document.getElementById('tv-kpi-scheduled-label');
        if (kpiSched) kpiSched.textContent = this.t('kpi_scheduled');

        const kpiPres = document.getElementById('tv-kpi-present-label');
        if (kpiPres) kpiPres.textContent = this.t('kpi_present');

        const kpiAbs = document.getElementById('tv-kpi-absent-label');
        if (kpiAbs) kpiAbs.textContent = this.t('kpi_absent');

        const kpiBrk = document.getElementById('tv-kpi-break-label');
        if (kpiBrk) kpiBrk.textContent = this.t('kpi_break');

        const kpiComp = document.getElementById('tv-kpi-compliance-label');
        if (kpiComp) kpiComp.textContent = this.t('kpi_compliance');

        const tickerTag = document.getElementById('tv-ticker-tag');
        if (tickerTag) tickerTag.textContent = this.t('ticker_title');

        this.updateSoundUI();
    },

    // ── Keyboard Shortcuts (F for Fullscreen, S for Sound) ───
    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F11' || e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                this.toggleFullscreen();
            } else if (e.key === 's' || e.key === 'S') {
                this.toggleSound();
            } else if (e.key === 'l' || e.key === 'L') {
                this.toggleLanguage();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                if (this._data && this._data.roster) {
                    const totalPages = Math.ceil(this._data.roster.length / this._pageSize);
                    if (totalPages > 1) {
                        this._pageIndex = (this._pageIndex + 1) % totalPages;
                        this.renderRoster(this._data.roster);
                    }
                }
            }
        });
    }
};

// Start TV controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    TVBoard.init();
});
