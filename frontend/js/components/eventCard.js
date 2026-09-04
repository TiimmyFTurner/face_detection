/**
 * EventCard component — renders a single detection event card.
 */
const EventCard = {
    _cache: {},

    /**
     * Render an event card HTML string.
     * @param {Object} event - Event data object
     * @returns {string} HTML string
     */
    render(event) {
        if (event && event.id) {
            EventCard._cache[event.id] = event;
        }

        const isKnown = event.is_known;
        const statusClass = isKnown ? 'known' : 'unknown';
        const badgeText = isKnown ? I18n.t('known') : I18n.t('unknown');
        const timestamp = I18n.formatTimestamp(event.timestamp);
        const confidence = Math.round((event.confidence_score || 0) * 100);
        const confidenceDisplay = I18n.isRTL() ? I18n.toPersianDigits(confidence) : confidence;
        const confidenceClass = confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low';
        const snapshotUrl = event.snapshot_url || `/api/snapshots/${event.snapshot_path}`;
        const personName = event.person_name || I18n.t('unknown');
        const cameraName = event.camera_name || (I18n.t('event_camera') + ' ' + (I18n.isRTL() ? I18n.toPersianDigits(event.camera_id) : event.camera_id));

        return `
            <div class="event-card ${statusClass}" data-event-id="${event.id}" onclick="EventCard.showDetailModal(${event.id})" style="cursor: pointer;" title="${EventCard.escapeAttr(I18n.t('click_to_view'))}">
                <img
                    class="event-card-image"
                    src="${snapshotUrl}"
                    alt="${EventCard.escapeAttr(personName)}"
                    loading="lazy"
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 300 180%22><rect fill=%22%230c1020%22 width=%22300%22 height=%22180%22/><text x=%22150%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23545d78%22 font-size=%2214%22>${encodeURIComponent(I18n.t('no_image'))}</text></svg>'"
                />
                <div class="event-card-body">
                    <div class="event-card-header">
                        <span class="event-person-name">${EventCard.escapeHtml(personName)}</span>
                        <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
                            <span class="event-badge ${statusClass}">${badgeText}</span>
                            ${event.alert_type === 'out_of_zone' ? `<span class="event-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);">${I18n.t('alert_out_of_zone')}</span>` : ''}
                            ${event.alert_type === 'unauthorized_entry' ? `<span class="event-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);">${I18n.t('alert_unauthorized')}</span>` : ''}
                            ${event.alert_type === 'absence_timeout' ? `<span class="event-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);">${I18n.t('alert_absence_timeout')}</span>` : ''}
                        </div>
                    </div>
                    <div class="event-card-meta">
                        <div class="event-meta-row">
                            <span class="meta-icon">📹</span>
                            <span>${EventCard.escapeHtml(cameraName)}</span>
                        </div>
                        ${event.zone_name ? `
                        <div class="event-meta-row" style="color: var(--accent-blue);">
                            <span class="meta-icon">🎯</span>
                            <span>${I18n.t('event_area')}: ${EventCard.escapeHtml(event.zone_name)}</span>
                        </div>
                        ` : ''}
                        <div class="event-meta-row">
                            <span class="meta-icon">🕐</span>
                            <span>${timestamp}</span>
                        </div>
                        <div class="event-meta-row">
                            <span class="meta-icon">🎯</span>
                            <span>${I18n.t('event_confidence')}: ${confidenceDisplay}%</span>
                        </div>
                    </div>
                    <div class="confidence-bar">
                        <div
                            class="confidence-bar-fill ${confidenceClass}"
                            style="width: ${confidence}%"
                        ></div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Show big event detail modal.
     */
    showDetailModal(eventId) {
        const event = EventCard._cache[eventId];
        if (!event) return;

        const isKnown = event.is_known;
        const statusClass = isKnown ? 'known' : 'unknown';
        const badgeText = isKnown ? I18n.t('known_identity') : I18n.t('unidentified');
        const confidence = Math.round((event.confidence_score || 0) * 100);
        const confidenceDisplay = I18n.isRTL() ? I18n.toPersianDigits(confidence) : confidence;
        const confidenceClass = confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low';
        const snapshotUrl = event.snapshot_url || `/api/snapshots/${event.snapshot_path}`;
        const fullTimeStr = I18n.formatFullTimestamp(event.timestamp);
        const personName = event.person_name || I18n.t('unknown');
        const cameraName = event.camera_name || (I18n.t('event_camera') + ' ' + (I18n.isRTL() ? I18n.toPersianDigits(event.camera_id) : event.camera_id));
        const eventIdStr = I18n.isRTL() ? I18n.toPersianDigits(event.id) : event.id;

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">${I18n.t('event_details_title', { id: eventIdStr })}</h2>
                    <span class="event-badge ${statusClass}">${badgeText}</span>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem;">
                <div class="event-detail-dialog-grid" style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 1.25rem; align-items: start;">
                    <div class="event-detail-image-wrapper" style="background: #090d16; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 280px;">
                        <img src="${snapshotUrl}" 
                             alt="${EventCard.escapeAttr(personName)}" 
                             style="width: 100%; max-height: 420px; object-fit: contain; display: block;" 
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 300 180%22><rect fill=%22%230c1020%22 width=%22300%22 height=%22180%22/><text x=%22150%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23545d78%22 font-size=%2214%22>${encodeURIComponent(I18n.t('no_image'))}</text></svg>'"
                        />
                    </div>

                    <div class="event-detail-info" style="display: flex; flex-direction: column; gap: 1rem;">
                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.25rem;">${I18n.t('event_person_identity')}</div>
                            ${isKnown && event.person_id ? `
                                <div style="font-size: 1.25rem; font-weight: 700; color: var(--accent-blue); cursor: pointer; display: flex; align-items: center; justify-content: space-between;" onclick="PersonAnalyticsModal.show(${event.person_id})" title="${EventCard.escapeAttr(I18n.t('view_person_analytics'))}">
                                    <span>${EventCard.escapeHtml(personName)}</span>
                                    <span style="font-size: 0.85rem; font-weight: 600; background: rgba(59, 130, 246, 0.2); padding: 0.2rem 0.6rem; border-radius: var(--radius-sm);">📊 ${I18n.t('btn_person_analytics')}</span>
                                </div>
                            ` : `
                                <div style="font-size: 1.25rem; font-weight: 700; color: var(--text-primary);">${EventCard.escapeHtml(personName)}</div>
                            `}
                        </div>

                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.25rem;">${I18n.t('event_camera')}</div>
                            <div style="font-size: 1rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                                <span>📹</span>
                                <span>${EventCard.escapeHtml(cameraName)}</span>
                            </div>
                        </div>

                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.25rem;">${I18n.t('event_timestamp')}</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                                <span>🕐</span>
                                <span>${fullTimeStr}</span>
                            </div>
                        </div>

                        ${(event.duration_seconds || event.duration_str) ? `
                            <div class="info-block" style="background: rgba(245, 158, 11, 0.1); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid rgba(245, 158, 11, 0.3);">
                                <div style="font-size: 0.75rem; text-transform: uppercase; color: #fbbf24; font-weight: 700; margin-bottom: 0.25rem;">${I18n.isRTL() ? 'مدت عدم حضور' : 'Absence Duration'}</div>
                                <div style="font-size: 1.1rem; font-weight: 800; color: #f59e0b; display: flex; align-items: center; gap: 0.4rem;">
                                    <span>⏱️</span>
                                    <span>${event.duration_seconds ? I18n.formatDuration(event.duration_seconds) : event.duration_str}</span>
                                </div>
                            </div>
                        ` : ''}

                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.35rem;">
                                <span>${I18n.t('event_confidence')}</span>
                                <span style="color: var(--text-primary); font-weight: 700;">${confidenceDisplay}%</span>
                            </div>
                            <div class="confidence-bar" style="height: 8px;">
                                <div class="confidence-bar-fill ${confidenceClass}" style="width: ${confidence}%;"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="event-detail-person-history"></div>
            </div>

            <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 0.5rem;">
                    ${!isKnown ? `
                        <button class="btn btn-primary btn-sm" onclick="PersonsPage.showAddModal();">
                            ${I18n.t('enroll_person')}
                        </button>
                    ` : `
                        ${event.person_id ? `
                            <button class="btn btn-primary btn-sm" onclick="PersonAnalyticsModal.show(${event.person_id})">
                                ${I18n.t('view_person_analytics')}
                            </button>
                        ` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="App.navigate('persons'); App.closeModal();">
                            ${I18n.t('view_persons')}
                        </button>
                    `}
                </div>
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('close')}</button>
            </div>
        `;

        App.openModal(content);

        // Load photo history timeline for this person
        EventCard.loadPersonHistory(event);
    },

    /**
     * Load recent detection photo history for a person.
     */
    async loadPersonHistory(event) {
        try {
            let url = event.person_id ? `/api/events?person_id=${event.person_id}&limit=10` : `/api/events?person_name=${encodeURIComponent(event.person_name)}&limit=10`;
            const data = await App.api(url);
            const events = data.events || [];

            const historyContainer = document.getElementById('event-detail-person-history');
            if (!historyContainer || events.length <= 1) return;

            const nameStr = event.person_name || I18n.t('unknown');
            const countStr = I18n.isRTL() ? I18n.toPersianDigits(events.length) : events.length;

            historyContainer.innerHTML = `
                <div style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span>📸</span>
                        <span>${I18n.t('other_detections_for', { name: EventCard.escapeHtml(nameStr), count: countStr })}</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.4rem;">
                        ${events.map(ev => {
                            EventCard._cache[ev.id] = ev;
                            const isActive = ev.id === event.id;
                            return `
                                <div onclick="EventCard.showDetailModal(${ev.id})" style="flex: 0 0 auto; width: 75px; cursor: pointer; opacity: ${isActive ? '1' : '0.65'}; border: ${isActive ? '2px solid var(--accent-blue)' : '1px solid var(--border-subtle)'}; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-surface-hover);" title="${EventCard.escapeAttr(I18n.t('click_to_view'))}">
                                    <img src="${ev.snapshot_url || '/api/snapshots/' + ev.snapshot_path}" style="width: 100%; height: 60px; object-fit: cover; display: block;" />
                                    <div style="font-size: 0.6rem; text-align: center; background: rgba(0,0,0,0.6); color: #fff; padding: 2px 0;">${I18n.formatTimestamp(ev.timestamp)}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } catch (err) {
            console.warn('Failed to load person event history:', err);
        }
    },

    /**
     * Format ISO timestamp to human-readable form (delegates to I18n).
     */
    formatTimestamp(isoString) {
        return I18n.formatTimestamp(isoString);
    },

    /**
     * Format full date + time for event detail modal (delegates to I18n).
     */
    formatFullTimestamp(isoString) {
        return I18n.formatFullTimestamp(isoString);
    },

    /**
     * Escape HTML special characters.
     */
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
