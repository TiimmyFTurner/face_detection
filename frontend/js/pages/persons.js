/**
 * Persons Page — Identity management with photo enrollment.
 */
const PersonsPage = {
    _persons: [],

    /**
     * Load and render the identity management page.
     */
    async load() {
        document.getElementById('page-title').textContent = 'Identity Management';
        document.getElementById('header-actions').innerHTML = `
            <button class="btn btn-primary" onclick="PersonsPage.showAddModal()">
                ＋ Add Person
            </button>
        `;

        const body = document.getElementById('content-body');
        body.innerHTML = `
            <div class="persons-grid" id="persons-grid">
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">⏳</div>
                    <div class="empty-state-title">Loading identities...</div>
                </div>
            </div>
        `;

        await PersonsPage.loadPersons();
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
                    <div class="empty-state-title">Failed to load identities</div>
                    <div class="empty-state-text">${err.message}</div>
                </div>
            `;
        }
    },

    /**
     * Render person cards grid.
     */
    renderPersons() {
        const grid = document.getElementById('persons-grid');
        if (!grid) return;

        if (PersonsPage._persons.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">👤</div>
                    <div class="empty-state-title">No known persons enrolled</div>
                    <div class="empty-state-text">
                        Add known individuals by uploading their reference photos.
                        The system will then recognize them automatically in camera feeds.
                    </div>
                </div>
            `;
            return;
        }

        grid.innerHTML = PersonsPage._persons.map(person => {
            const initials = PersonsPage.getInitials(person.name);
            const hasPhoto = person.reference_photos && person.reference_photos.length > 0;

            return `
                <div class="person-card" data-person-id="${person.id}">
                    ${hasPhoto
                        ? `<img
                            class="person-avatar"
                            src="${person.reference_photos[0]}"
                            alt="${PersonsPage.escapeAttr(person.name)}"
                            onerror="this.outerHTML='<div class=\\'person-avatar-placeholder\\'>${initials}</div>'"
                        />`
                        : `<div class="person-avatar-placeholder">${initials}</div>`
                    }

                    <div class="person-name">${PersonsPage.escapeHtml(person.name)}</div>
                    <div class="person-role">${PersonsPage.escapeHtml(person.role || 'No role assigned')}</div>

                    <div class="person-stats">
                        <div class="person-stat">
                            <div class="person-stat-value">${person.embedding_count || 0}</div>
                            <div class="person-stat-label">Photos</div>
                        </div>
                        <div class="person-stat">
                            <div class="person-stat-value">${PersonsPage.formatDate(person.created_at)}</div>
                            <div class="person-stat-label">Enrolled</div>
                        </div>
                    </div>

                    <div class="person-actions">
                        <button class="btn btn-secondary btn-sm" onclick="PersonsPage.showAddPhotosModal(${person.id}, '${PersonsPage.escapeAttr(person.name)}')">
                            📸 Add Photos
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="PersonsPage.deletePerson(${person.id}, '${PersonsPage.escapeAttr(person.name)}')">
                            🗑️ Delete
                        </button>
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
        if (!confirm(`Delete "${name}"? This will remove all their reference photos and embeddings.`)) {
            return;
        }

        try {
            await App.api(`/api/persons/${personId}`, 'DELETE');
            App.toast(`"${name}" has been removed.`, 'success');
            await PersonsPage.loadPersons();
        } catch (err) {
            App.toast(`Failed to delete: ${err.message}`, 'error');
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
        try {
            return new Date(isoString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
            });
        } catch {
            return '—';
        }
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
