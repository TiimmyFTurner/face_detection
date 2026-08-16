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
        const badgeText = isKnown ? 'Known' : 'Unknown';
        const timestamp = EventCard.formatTimestamp(event.timestamp);
        const confidence = Math.round((event.confidence_score || 0) * 100);
        const confidenceClass = confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low';
        const snapshotUrl = event.snapshot_url || `/api/snapshots/${event.snapshot_path}`;

        return `
            <div class="event-card ${statusClass}" data-event-id="${event.id}" onclick="EventCard.showDetailModal(${event.id})" style="cursor: pointer;" title="Click to view event details">
                <img
                    class="event-card-image"
                    src="${snapshotUrl}"
                    alt="Detection snapshot"
                    loading="lazy"
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 300 180%22><rect fill=%22%230c1020%22 width=%22300%22 height=%22180%22/><text x=%22150%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23545d78%22 font-size=%2214%22>No Image</text></svg>'"
                />
                <div class="event-card-body">
                    <div class="event-card-header">
                        <span class="event-person-name">${EventCard.escapeHtml(event.person_name || 'Unknown')}</span>
                        <span class="event-badge ${statusClass}">${badgeText}</span>
                    </div>
                    <div class="event-card-meta">
                        <div class="event-meta-row">
                            <span class="meta-icon">📹</span>
                            <span>${EventCard.escapeHtml(event.camera_name || 'Camera ' + event.camera_id)}</span>
                        </div>
                        <div class="event-meta-row">
                            <span class="meta-icon">🕐</span>
                            <span>${timestamp}</span>
                        </div>
                        <div class="event-meta-row">
                            <span class="meta-icon">🎯</span>
                            <span>Confidence: ${confidence}%</span>
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
        const badgeText = isKnown ? 'Known Identity' : 'Unidentified Face';
        const confidence = Math.round((event.confidence_score || 0) * 100);
        const confidenceClass = confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low';
        const snapshotUrl = event.snapshot_url || `/api/snapshots/${event.snapshot_path}`;
        const fullTimeStr = EventCard.formatFullTimestamp(event.timestamp);

        const content = `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h2 class="modal-title">🎯 Event #${event.id}</h2>
                    <span class="event-badge ${statusClass}">${badgeText}</span>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>

            <div class="modal-body" style="padding: 1.25rem;">
                <div class="event-detail-dialog-grid" style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 1.25rem; align-items: start;">
                    <div class="event-detail-image-wrapper" style="background: #090d16; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 280px;">
                        <img src="${snapshotUrl}" 
                             alt="Event Snapshot" 
                             style="width: 100%; max-height: 420px; object-fit: contain; display: block;" 
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 300 180%22><rect fill=%22%230c1020%22 width=%22300%22 height=%22180%22/><text x=%22150%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23545d78%22 font-size=%2214%22>Image Not Found</text></svg>'"
                        />
                    </div>

                    <div class="event-detail-info" style="display: flex; flex-direction: column; gap: 1rem;">
                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.25rem;">Person Identity</div>
                            <div style="font-size: 1.25rem; font-weight: 700; color: var(--text-primary);">${EventCard.escapeHtml(event.person_name || 'Unknown')}</div>
                        </div>

                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.25rem;">Camera Source</div>
                            <div style="font-size: 1rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                                <span>📹</span>
                                <span>${EventCard.escapeHtml(event.camera_name || 'Camera ' + event.camera_id)}</span>
                            </div>
                        </div>

                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.25rem;">Timestamp (Local Time)</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
                                <span>🕐</span>
                                <span>${fullTimeStr}</span>
                            </div>
                        </div>

                        <div class="info-block" style="background: var(--bg-surface-hover); padding: 0.85rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 0.35rem;">
                                <span>Matching Confidence</span>
                                <span style="color: var(--text-primary); font-weight: 700;">${confidence}%</span>
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
                <div>
                    ${!isKnown ? `
                        <button class="btn btn-primary btn-sm" onclick="PersonsPage.showAddModal();">
                            ➕ Enroll Person
                        </button>
                    ` : `
                        <button class="btn btn-secondary btn-sm" onclick="App.navigate('persons'); App.closeModal();">
                            👤 View Persons
                        </button>
                    `}
                </div>
                <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
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

            historyContainer.innerHTML = `
                <div style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span>📸</span>
                        <span>Other Detections for ${EventCard.escapeHtml(event.person_name)} (${events.length})</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.4rem;">
                        ${events.map(ev => {
                            EventCard._cache[ev.id] = ev;
                            const isActive = ev.id === event.id;
                            return `
                                <div onclick="EventCard.showDetailModal(${ev.id})" style="flex: 0 0 auto; width: 75px; cursor: pointer; opacity: ${isActive ? '1' : '0.65'}; border: ${isActive ? '2px solid var(--accent-blue)' : '1px solid var(--border-subtle)'}; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-surface-hover);" title="View this event">
                                    <img src="${ev.snapshot_url || '/api/snapshots/' + ev.snapshot_path}" style="width: 100%; height: 60px; object-fit: cover; display: block;" />
                                    <div style="font-size: 0.6rem; text-align: center; background: rgba(0,0,0,0.6); color: #fff; padding: 2px 0;">${EventCard.formatTimestamp(ev.timestamp)}</div>
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
     * Format ISO timestamp to human-readable form.
     */
    formatTimestamp(isoString) {
        if (!isoString) return 'Unknown time';
        try {
            let str = String(isoString).trim();
            if (!str.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(str)) {
                str += 'Z';
            }
            const date = new Date(str);
            if (isNaN(date.getTime())) return isoString;

            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);

            let relative = 'Just now';
            if (diffMins >= 1 && diffMins < 60) {
                relative = `${diffMins}m ago`;
            } else if (diffMins >= 60 && diffMins < 1440) {
                relative = `${Math.floor(diffMins / 60)}h ago`;
            } else if (diffMins >= 1440) {
                relative = `${Math.floor(diffMins / 1440)}d ago`;
            }

            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `${timeStr} (${relative})`;
        } catch {
            return isoString;
        }
    },

    /**
     * Format full date + time for event detail modal.
     */
    formatFullTimestamp(isoString) {
        if (!isoString) return 'Unknown time';
        try {
            let str = String(isoString).trim();
            if (!str.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(str)) {
                str += 'Z';
            }
            const date = new Date(str);
            if (isNaN(date.getTime())) return isoString;

            return date.toLocaleString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
        } catch {
            return isoString;
        }
    },

    /**
     * Escape HTML special characters.
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    },
};

