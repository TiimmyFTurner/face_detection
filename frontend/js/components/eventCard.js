/**
 * EventCard component — renders a single detection event card.
 */
const EventCard = {
    /**
     * Render an event card HTML string.
     * @param {Object} event - Event data object
     * @returns {string} HTML string
     */
    render(event) {
        const isKnown = event.is_known;
        const statusClass = isKnown ? 'known' : 'unknown';
        const badgeText = isKnown ? 'Known' : 'Unknown';
        const timestamp = EventCard.formatTimestamp(event.timestamp);
        const confidence = Math.round((event.confidence_score || 0) * 100);
        const confidenceClass = confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low';
        const snapshotUrl = event.snapshot_url || `/api/snapshots/${event.snapshot_path}`;

        return `
            <div class="event-card ${statusClass}" data-event-id="${event.id}">
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
     * Format ISO timestamp to human-readable form.
     */
    formatTimestamp(isoString) {
        if (!isoString) return 'Unknown time';
        try {
            const date = new Date(isoString);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;

            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
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
        div.textContent = text;
        return div.innerHTML;
    },
};
