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
                <h2>Add Known Person</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="person-form" onsubmit="PersonForm.handleSubmit(event)">
                    <div class="form-group">
                        <label class="form-label" for="person-name">Full Name</label>
                        <input
                            class="form-input"
                            type="text"
                            id="person-name"
                            name="name"
                            placeholder="e.g., John Doe"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="person-role">Role / Title</label>
                        <input
                            class="form-input"
                            type="text"
                            id="person-role"
                            name="role"
                            placeholder="e.g., Employee, Visitor, Security"
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Reference Photos</label>
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
                                Click or drag photos here
                            </div>
                            <div class="upload-zone-hint">
                                Upload 1 or more clear face photos (JPG, PNG)
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
                <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" type="submit" form="person-form">
                    Add Person
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
                <h2>Add Photos — ${PersonForm.escapeHtml(personName)}</h2>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="add-photos-form" onsubmit="PersonForm.handleAddPhotos(event, ${personId})">
                    <div class="form-group">
                        <label class="form-label">Additional Reference Photos</label>
                        <div
                            class="upload-zone"
                            id="upload-zone"
                            onclick="document.getElementById('photo-input').click()"
                            ondragover="PersonForm.handleDragOver(event)"
                            ondragleave="PersonForm.handleDragLeave(event)"
                            ondrop="PersonForm.handleDrop(event)"
                        >
                            <div class="upload-zone-icon">📸</div>
                            <div class="upload-zone-text">Click or drag photos here</div>
                            <div class="upload-zone-hint">More photos = better recognition accuracy</div>
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
                <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" type="submit" form="add-photos-form">
                    Upload Photos
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
            img.title = `${file.name} — Click to remove`;
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
            App.toast('Please enter a name.', 'error');
            return;
        }

        if (PersonForm._selectedFiles.length === 0) {
            App.toast('Please upload at least one reference photo.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('name', name);
        formData.append('role', role);

        PersonForm._selectedFiles.forEach(file => {
            formData.append('photos', file);
        });

        try {
            App.toast('Processing photos...', 'info');

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
            App.toast(`${name} has been enrolled successfully!`, 'success');
            PersonsPage.load();
        } catch (err) {
            App.toast(`Error: ${err.message}`, 'error');
        }
    },

    /**
     * Handle adding photos to an existing person.
     */
    async handleAddPhotos(event, personId) {
        event.preventDefault();

        if (PersonForm._selectedFiles.length === 0) {
            App.toast('Please select at least one photo.', 'error');
            return;
        }

        const formData = new FormData();
        PersonForm._selectedFiles.forEach(file => {
            formData.append('photos', file);
        });

        try {
            App.toast('Processing photos...', 'info');

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
            App.toast('Photos added successfully!', 'success');
            PersonsPage.load();
        } catch (err) {
            App.toast(`Error: ${err.message}`, 'error');
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
        div.textContent = text;
        return div.innerHTML;
    },
};
