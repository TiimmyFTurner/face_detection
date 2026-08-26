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
     * Render the "Add Photos" modal for an existing person.
     */
    renderAddPhotosModal(personId, personName) {
        return `
            <div class="modal-header">
                <h2>${I18n.t('modal_add_photos', { name: PersonForm.escapeHtml(personName) })}</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="add-photos-form" onsubmit="PersonForm.handleAddPhotos(event, ${personId})">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('label_add_more_photos')}</label>
                        <div
                            class="upload-zone"
                            id="upload-zone"
                            onclick="document.getElementById('photo-input').click()"
                            ondragover="PersonForm.handleDragOver(event)"
                            ondragleave="PersonForm.handleDragLeave(event)"
                            ondrop="PersonForm.handleDrop(event)"
                        >
                            <div class="upload-zone-icon">📸</div>
                            <div class="upload-zone-text">${I18n.t('upload_drag_text')}</div>
                            <div class="upload-zone-hint">${I18n.t('upload_hint_2')}</div>
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
                <button class="btn btn-primary" type="submit" form="add-photos-form">
                    ${I18n.t('btn_add_photos')}
                </button>
            </div>
        `;
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

            const response = await fetch('/api/persons', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Failed to create person');
            }

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
        event.preventDefault();

        if (PersonForm._selectedFiles.length === 0) {
            App.toast(I18n.t('err_select_photo'), 'error');
            return;
        }

        const formData = new FormData();
        PersonForm._selectedFiles.forEach(file => {
            formData.append('photos', file);
        });

        try {
            App.toast(I18n.t('processing_photos'), 'info');

            const response = await fetch(`/api/persons/${personId}/photos`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Failed to upload photos');
            }

            PersonForm._selectedFiles = [];
            App.closeModal();
            App.toast(I18n.t('photos_added_success'), 'success');
            PersonsPage.load();
        } catch (err) {
            App.toast(I18n.t('err_generic', { msg: err.message }), 'error');
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
