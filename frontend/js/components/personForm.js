/**
 * PersonForm component — modal form for adding known persons with photo upload.
 */
const PersonForm = {
    _selectedFiles: [],

    /**
     * Render the "Add Person" modal content.
     * @returns {string} HTML string for modal content.
     */
    renderModal() {
        return `
            <div class="modal-header">
                <h2>${I18n.t('modal_add_person')}</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="person-form" onsubmit="PersonForm.handleSubmit(event)">
                    <div class="form-group">
                        <label class="form-label" for="person-name">${I18n.t('label_full_name')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="person-name"
                            name="name"
                            placeholder="${PersonForm.escapeAttr(I18n.t('placeholder_full_name'))}"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="person-role">${I18n.t('label_role')}</label>
                        <input
                            class="form-input"
                            type="text"
                            id="person-role"
                            name="role"
                            placeholder="${PersonForm.escapeAttr(I18n.t('placeholder_role'))}"
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('label_ref_photos')}</label>
                        <div
                            class="upload-zone"
                            id="upload-zone"
                            onclick="document.getElementById('photo-input').click()"
                            ondragover="PersonForm.handleDragOver(event)"
                            ondragleave="PersonForm.handleDragLeave(event)"
                            ondrop="PersonForm.handleDrop(event)"
                        >
                            <div class="upload-zone-icon">📸</div>
                            <div class="upload-zone-text">
                                ${I18n.t('upload_drag_text')}
                            </div>
                            <div class="upload-zone-hint">
                                ${I18n.t('upload_hint_1')}
                            </div>
                        </div>
                        <input
                            type="file"
                            id="photo-input"
                            accept="image/*"
                            multiple
                            hidden
                            onchange="PersonForm.handleFileSelect(event)"
                        />
                        <div class="upload-preview" id="upload-preview"></div>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" type="submit" form="person-form">
                    ${I18n.t('add_person_btn')}
                </button>
            </div>
        `;
    },

    /**
     * Render the "Add Photos" modal for an existing person with existing photos grid & delete actions.
     */
    renderAddPhotosModal(personId, personName) {
        return `
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-size: 1.4rem;">📸</span>
                    <div>
                        <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700;">${I18n.t('modal_add_photos', { name: PersonForm.escapeHtml(personName) })}</h2>
                    </div>
                </div>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
                <!-- ── Section 1: Existing Photos ────────────────────────────── -->
                <div class="existing-photos-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <label class="form-label" style="margin-bottom: 0; display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">
                            <span>🖼️</span>
                            <span id="existing-photos-title">${I18n.t('existing_photos_title', { count: '...' })}</span>
                        </label>
                        <span id="existing-photos-counter" style="font-size: 0.75rem; color: var(--text-tertiary);"></span>
                    </div>

                    <div id="existing-photos-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.75rem; min-height: 110px; max-height: 250px; overflow-y: auto; padding: 0.75rem; background: var(--bg-surface-hover); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 1.5rem 0; font-size: 0.85rem;">
                            <div class="spinner" style="width: 24px; height: 24px; margin: 0 auto 0.5rem auto;"></div>
                            ${I18n.t('loading')}
                        </div>
                    </div>
                </div>

                <!-- ── Section 2: Upload New Photos ─────────────────────────── -->
                <div class="add-new-photos-section" style="border-top: 1px solid var(--border-subtle); padding-top: 1.25rem;">
                    <label class="form-label" style="margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">
                        <span>➕</span>
                        <span>${I18n.t('add_more_photos_section')}</span>
                    </label>
                    
                    <form id="add-photos-form" onsubmit="PersonForm.handleAddPhotos(event, ${personId})">
                        <div
                            class="upload-zone"
                            id="upload-zone"
                            onclick="document.getElementById('photo-input').click()"
                            ondragover="PersonForm.handleDragOver(event)"
                            ondragleave="PersonForm.handleDragLeave(event)"
                            ondrop="PersonForm.handleDrop(event)"
                            style="padding: 1.25rem 1rem;"
                        >
                            <div class="upload-zone-icon" style="font-size: 2rem; margin-bottom: 0.35rem;">📸</div>
                            <div class="upload-zone-text" style="font-size: 0.88rem;">${I18n.t('upload_drag_text')}</div>
                            <div class="upload-zone-hint" style="font-size: 0.75rem; margin-top: 0.25rem;">${I18n.t('upload_hint_2')}</div>
                        </div>
                        <input
                            type="file"
                            id="photo-input"
                            accept="image/*"
                            multiple
                            hidden
                            onchange="PersonForm.handleFileSelect(event)"
                        />
                        <div class="upload-preview" id="upload-preview" style="margin-top: 0.75rem;"></div>
                    </form>
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem;">
                <button class="btn btn-secondary" onclick="App.closeModal()">${I18n.t('close')}</button>
                <button class="btn btn-primary" type="submit" form="add-photos-form" id="btn-submit-photos">
                    <span>⬆️</span>
                    <span>${I18n.t('btn_add_photos')}</span>
                </button>
            </div>
        `;
    },

    /**
     * Load existing reference photos for a person into the modal.
     */
    async loadExistingPhotos(personId) {
        const grid = document.getElementById('existing-photos-grid');
        const titleEl = document.getElementById('existing-photos-title');
        const counterEl = document.getElementById('existing-photos-counter');
        if (!grid) return;

        try {
            const photos = await App.api(`/api/persons/${personId}/photos`);
            const countStr = I18n.isRTL() ? I18n.toPersianDigits(photos.length) : photos.length;

            if (titleEl) {
                titleEl.textContent = I18n.t('existing_photos_title', { count: countStr });
            }
            if (counterEl) {
                counterEl.textContent = I18n.t('photos_remaining_count', { count: countStr });
            }

            if (photos.length === 0) {
                grid.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); padding: 2rem 1rem; font-size: 0.85rem;">
                        <span style="font-size: 1.8rem; display: block; margin-bottom: 0.4rem; opacity: 0.7;">🖼️</span>
                        ${I18n.t('no_existing_photos')}
                    </div>
                `;
                return;
            }

            const isRtl = I18n.isRTL();
            grid.innerHTML = photos.map((photo, idx) => {
                const photoNum = isRtl ? I18n.toPersianDigits(idx + 1) : (idx + 1);
                return `
                    <div class="existing-photo-card" id="photo-card-${photo.id}" style="position: relative; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-subtle); background: #0c1020; aspect-ratio: 1; box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: transform 0.15s ease, border-color 0.15s ease;">
                        <img 
                            src="${photo.url}" 
                            alt="Reference Photo #${photoNum}" 
                            style="width: 100%; height: 100%; object-fit: cover; display: block;" 
                            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23161f36%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23545d78%22 font-size=%2212%22>No Image</text></svg>'"
                        />
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.75)); padding: 4px 6px; font-size: 0.65rem; color: #fff; display: flex; justify-content: space-between; align-items: center;">
                            <span>#${photoNum}</span>
                        </div>
                        <button 
                            type="button"
                            class="btn-delete-photo"
                            onclick="PersonForm.deletePhoto(${personId}, ${photo.id})"
                            title="${PersonForm.escapeAttr(I18n.t('btn_delete_photo'))}"
                            style="position: absolute; top: 5px; ${isRtl ? 'left' : 'right'}: 5px; width: 26px; height: 26px; border-radius: var(--radius-sm); border: none; background: rgba(225, 29, 72, 0.85); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; box-shadow: 0 2px 6px rgba(0,0,0,0.5); transition: background 0.15s ease, transform 0.15s ease;"
                            onmouseover="this.style.background='#e11d48'; this.style.transform='scale(1.1)';"
                            onmouseout="this.style.background='rgba(225, 29, 72, 0.85)'; this.style.transform='scale(1)';"
                        >
                            🗑️
                        </button>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Failed to load existing photos:', err);
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; color: var(--accent-rose); padding: 1.5rem; font-size: 0.85rem;">
                    ${err.message || 'Failed to load photos'}
                </div>
            `;
        }
    },

    /**
     * Delete a specific reference photo.
     */
    async deletePhoto(personId, photoId) {
        if (!confirm(I18n.t('delete_photo_confirm'))) {
            return;
        }

        const card = document.getElementById(`photo-card-${photoId}`);
        if (card) {
            card.style.opacity = '0.4';
            card.style.pointerEvents = 'none';
        }

        try {
            App.toast(I18n.t('loading'), 'info');
            await App.api(`/api/persons/${personId}/photos/${photoId}`, 'DELETE');
            App.toast(I18n.t('photo_deleted_success'), 'success');

            // Refresh photos list in modal
            await PersonForm.loadExistingPhotos(personId);

            // Also reload persons in background to keep stats updated
            if (typeof PersonsPage !== 'undefined' && PersonsPage.loadPersons) {
                PersonsPage.loadPersons();
            }
        } catch (err) {
            if (card) {
                card.style.opacity = '1';
                card.style.pointerEvents = 'auto';
            }
            App.toast(I18n.t('err_generic', { msg: err.message }), 'error');
        }
    },

    /**
     * Handle file selection from input.
     */
    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        PersonForm._selectedFiles = [...PersonForm._selectedFiles, ...files];
        PersonForm.updatePreview();
    },

    /**
     * Handle drag over.
     */
    handleDragOver(event) {
        event.preventDefault();
        event.currentTarget.classList.add('dragover');
    },

    /**
     * Handle drag leave.
     */
    handleDragLeave(event) {
        event.currentTarget.classList.remove('dragover');
    },

    /**
     * Handle file drop.
     */
    handleDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('dragover');

        const files = Array.from(event.dataTransfer.files).filter(f =>
            f.type.startsWith('image/')
        );
        PersonForm._selectedFiles = [...PersonForm._selectedFiles, ...files];
        PersonForm.updatePreview();
    },

    /**
     * Update the preview thumbnails.
     */
    updatePreview() {
        const container = document.getElementById('upload-preview');
        if (!container) return;

        container.innerHTML = '';

        PersonForm._selectedFiles.forEach((file, index) => {
            const url = URL.createObjectURL(file);
            const img = document.createElement('img');
            img.className = 'upload-preview-item';
            img.src = url;
            img.alt = file.name;
            img.title = `${file.name} — ${I18n.t('delete')}`;
            img.style.cursor = 'pointer';
            img.onclick = () => {
                PersonForm._selectedFiles.splice(index, 1);
                PersonForm.updatePreview();
            };
            container.appendChild(img);
        });
    },

    /**
     * Handle the create person form submission.
     */
    async handleSubmit(event) {
        event.preventDefault();

        const name = document.getElementById('person-name').value.trim();
        const role = document.getElementById('person-role').value.trim();

        if (!name) {
            App.toast(I18n.t('err_enter_name'), 'error');
            return;
        }

        if (PersonForm._selectedFiles.length === 0) {
            App.toast(I18n.t('err_select_photo'), 'error');
            return;
        }

        const formData = new FormData();
        formData.append('name', name);
        formData.append('role', role);

        PersonForm._selectedFiles.forEach(file => {
            formData.append('photos', file);
        });

        try {
            App.toast(I18n.t('processing_photos'), 'info');

            await App.api('/api/persons', 'POST', formData);

            PersonForm._selectedFiles = [];
            App.closeModal();
            App.toast(I18n.t('person_enrolled_success', { name }), 'success');
            PersonsPage.load();
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message }), 'error');
        }
    },

    /**
     * Handle adding photos to an existing person.
     */
    async handleAddPhotos(event, personId) {
        if (event && event.preventDefault) {
            event.preventDefault();
        }

        if (PersonForm._selectedFiles.length === 0) {
            App.toast(I18n.t('err_select_photo'), 'error');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-photos');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>⏳</span> <span>${I18n.t('loading')}</span>`;
        }

        const formData = new FormData();
        PersonForm._selectedFiles.forEach(file => {
            formData.append('photos', file);
        });

        try {
            App.toast(I18n.t('processing_photos'), 'info');

            await App.api(`/api/persons/${personId}/photos`, 'POST', formData);

            PersonForm._selectedFiles = [];
            PersonForm.updatePreview();
            App.toast(I18n.t('photos_added_success'), 'success');

            // Refresh existing photos in modal
            await PersonForm.loadExistingPhotos(personId);

            // Also reload persons in background to keep stats updated
            if (typeof PersonsPage !== 'undefined' && PersonsPage.loadPersons) {
                PersonsPage.loadPersons();
            }
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message }), 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span>⬆️</span> <span>${I18n.t('btn_add_photos')}</span>`;
            }
        }
    },

    /**
     * Reset form state.
     */
    reset() {
        PersonForm._selectedFiles = [];
    },

    /**
     * Escape HTML.
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
