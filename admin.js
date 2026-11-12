// Default Initial Data
const defaultCatalog = [
    { id: 1, title: "The Great Welsh Revival & Beyond", author: "Dr. Arthur Roberts", category: "Church History", year: "1954", pages: "342", downloadUrl: "", description: "An exhaustive collection of original diary entries, newspaper cuttings, and theological letters documenting the spiritual awakening across Wales.", gradient: "from-blue-900 via-blue-800 to-indigo-950" },
    { id: 2, title: "Apostle of Faith: The Life of John Wesley", author: "Elizabeth Montgomery", category: "Biographies", year: "1978", pages: "418", downloadUrl: "", description: "Tracing the relentless horseback journeys, diary reflections, and theological footprint of the man who ignited the Methodist movement.", gradient: "from-amber-900 via-amber-800 to-stone-900" }
];

const defaultSubmissions = [
    { id: 101, name: "Dr. Samuel Vance", email: "samuel@accordarchive.org", title: "The East African Revival Diaries", category: "Church History", description: "Unpublished missionary notes and testimonies from East Africa during the mid-20th century awakening." }
];

// Load State from LocalStorage
let catalogData = JSON.parse(localStorage.getItem('accord_books')) || defaultCatalog;
let submissionsData = JSON.parse(localStorage.getItem('accord_submissions')) || defaultSubmissions;
let deleteTargetId = null;

// Save State to LocalStorage
function saveState() {
    localStorage.setItem('accord_books', JSON.stringify(catalogData));
    localStorage.setItem('accord_submissions', JSON.stringify(submissionsData));
}

// Initialize App
window.onload = function() {
    renderCatalogTable(catalogData);
    renderSubmissionsTable();
    updateStats();
};

// Tab Switching
function switchTab(tabName) {
    const catalogSec = document.getElementById('section-catalog');
    const subSec = document.getElementById('section-submissions');
    const catalogBtn = document.getElementById('nav-tab-catalog');
    const subBtn = document.getElementById('nav-tab-submissions');

    if (tabName === 'catalog') {
        catalogSec.classList.remove('hidden');
        subSec.classList.add('hidden');
        catalogBtn.className = "px-5 py-2 rounded-xl text-xs font-bold transition-all bg-white text-accord-blue shadow-sm";
        subBtn.className = "px-5 py-2 rounded-xl text-xs font-bold transition-all text-accord-muted hover:text-accord-slate";
    } else {
        catalogSec.classList.add('hidden');
        subSec.classList.remove('hidden');
        subBtn.className = "px-5 py-2 rounded-xl text-xs font-bold transition-all bg-white text-accord-blue shadow-sm";
        catalogBtn.className = "px-5 py-2 rounded-xl text-xs font-bold transition-all text-accord-muted hover:text-accord-slate";
    }
}

// Render Catalog Table
function renderCatalogTable(list) {
    const tbody = document.getElementById('admin-book-table-body');
    tbody.innerHTML = '';

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-accord-muted">No archives found matching your criteria.</td></tr>`;
        return;
    }

    list.forEach(book => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate flex items-center space-x-3">
                <div class="w-8 h-8 rounded-lg bg-accord-lightBlue text-accord-blue flex items-center justify-center font-bold text-xs"><i class="fa-solid fa-book"></i></div>
                <span>${book.title}</span>
            </td>
            <td class="py-4 px-6 text-accord-muted">${book.author}</td>
            <td class="py-4 px-6"><span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-1 rounded-full">${book.category}</span></td>
            <td class="py-4 px-6 text-center text-accord-muted">${book.year}</td>
            <td class="py-4 px-6 text-center text-accord-muted">${book.pages} p.</td>
            <td class="py-4 px-6 text-right space-x-2">
                <button onclick="openArchiveModal('edit', ${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Edit Archive"><i class="fa-solid fa-pen text-xs"></i></button>
                <button onclick="promptDelete(${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete Archive"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Filter Catalog Table
function filterAdminBooks() {
    const query = document.getElementById('admin-search').value.toLowerCase();
    const cat = document.getElementById('admin-cat-filter').value;

    const filtered = catalogData.filter(book => {
        const matchesCat = cat === 'All' || book.category === cat;
        const matchesQuery = book.title.toLowerCase().includes(query) || book.author.toLowerCase().includes(query) || book.description.toLowerCase().includes(query);
        return matchesCat && matchesQuery;
    });
    renderCatalogTable(filtered);
}

// Render Submissions Table
function renderSubmissionsTable() {
    const tbody = document.getElementById('submissions-table-body');
    tbody.innerHTML = '';
    document.getElementById('pending-badge').innerText = submissionsData.length;
    document.getElementById('stat-pending').innerText = submissionsData.length;

    if (submissionsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-accord-muted">No pending manuscript submissions at this time.</td></tr>`;
        return;
    }

    submissionsData.forEach(sub => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate">${sub.name}</p>
                <p class="text-[10px] text-accord-muted">${sub.email}</p>
            </td>
            <td class="py-4 px-6 font-bold text-accord-slate">${sub.title}</td>
            <td class="py-4 px-6"><span class="bg-amber-50 text-accord-gold text-[10px] font-bold px-2.5 py-1 rounded-full">${sub.category}</span></td>
            <td class="py-4 px-6 text-accord-muted max-w-xs truncate">${sub.description}</td>
            <td class="py-4 px-6 text-right space-x-2">
                <button onclick="approveSubmission(${sub.id})" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl shadow-sm transition-all"><i class="fa-solid fa-check mr-1"></i> Approve</button>
                <button onclick="rejectSubmission(${sub.id})" class="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all"><i class="fa-solid fa-xmark mr-1"></i> Reject</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Modal Controls (Add / Edit)
function openArchiveModal(mode, id = null) {
    const modal = document.getElementById('archive-modal');
    const heading = document.getElementById('modal-heading');
    document.getElementById('archive-form').reset();
    document.getElementById('edit-book-id').value = '';

    // Reset Upload UI
    document.getElementById('file-name-display').textContent = "Max size: 50MB";
    document.getElementById('file-name-display').classList.remove('text-accord-blue', 'font-bold');
    document.getElementById('upload-ui').classList.remove('border-accord-blue', 'bg-accord-lightBlue');

    if (mode === 'edit' && id !== null) {
        heading.innerText = "Edit Archive Item";
        const book = catalogData.find(b => b.id === id);
        if (book) {
            document.getElementById('edit-book-id').value = book.id;
            document.getElementById('form-title').value = book.title;
            document.getElementById('form-author').value = book.author;
            document.getElementById('form-category').value = book.category;
            document.getElementById('form-year').value = book.year;
            document.getElementById('form-pages').value = book.pages;
            document.getElementById('form-description').value = book.description;
        }
    } else {
        heading.innerText = "Add New Archive Item";
        document.getElementById('form-pages').value = 'TBD';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        document.getElementById('archive-modal-box').classList.remove('scale-95');
        document.getElementById('archive-modal-box').classList.add('scale-100');
    }, 10);
}

function closeArchiveModal() {
    const modal = document.getElementById('archive-modal');
    document.getElementById('archive-modal-box').classList.remove('scale-100');
    document.getElementById('archive-modal-box').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }, 200);
}

// Handle Add / Edit Submission (Upload & Save)
async function handleArchiveSubmit(e) {
    e.preventDefault();
    
    const fileInput = document.getElementById('form-file');
    let downloadUrl = "";

    // 1. If a file is selected, upload it to Google Drive first
    if (fileInput && fileInput.files.length > 0) {
        showToast("Uploading PDF to Google Drive... Please wait.");
        
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            // Catch HTTP errors properly
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText);
            }

            const data = await response.json();
            
            if (data.downloadUrl) {
                downloadUrl = data.downloadUrl; // Save the Google Drive link
            } else if (data.error) {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error("Upload Error:", error);
            alert(`Upload failed! Check terminal for details. Reason: ${error.message}`);
            return; // Stop the save process if upload fails
        }
    }

    // 2. Save book details to database (LocalStorage)
    const editId = document.getElementById('edit-book-id').value;
    const title = document.getElementById('form-title').value;
    const author = document.getElementById('form-author').value;
    const category = document.getElementById('form-category').value;
    const year = document.getElementById('form-year').value;
    const pages = document.getElementById('form-pages').value || "TBD";
    const description = document.getElementById('form-description').value;

    if (editId) {
        const index = catalogData.findIndex(b => b.id == editId);
        if (index > -1) {
            // Keep old download URL if a new file wasn't uploaded during edit
            const finalUrl = downloadUrl || catalogData[index].downloadUrl;
            catalogData[index] = { ...catalogData[index], title, author, category, year, pages, downloadUrl: finalUrl, description };
            showToast(`Archive "${title}" updated successfully!`);
        }
    } else {
        const newBook = {
            id: Date.now(),
            title, author, category, year, pages, downloadUrl, description,
            gradient: "from-blue-900 via-indigo-900 to-slate-900"
        };
        catalogData.unshift(newBook);
        showToast(`New archive "${title}" added successfully!`);
    }

    saveState();
    closeArchiveModal();
    renderCatalogTable(catalogData);
    updateStats();
}

// Delete Confirmation Workflow
function promptDelete(id) {
    deleteTargetId = id;
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('confirm-btn').onclick = function() {
        executeDelete(deleteTargetId);
    };
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    deleteTargetId = null;
}

function executeDelete(id) {
    catalogData = catalogData.filter(b => b.id !== id);
    saveState();
    closeConfirmModal();
    renderCatalogTable(catalogData);
    updateStats();
    showToast("Archive deleted from catalog.");
}

// Submission Approvals
function approveSubmission(id) {
    const sub = submissionsData.find(s => s.id === id);
    if (sub) {
        const newBook = {
            id: Date.now(),
            title: sub.title,
            author: sub.name,
            category: sub.category,
            year: new Date().getFullYear().toString(),
            pages: "TBD",
            downloadUrl: "",
            description: sub.description,
            gradient: "from-blue-900 via-blue-800 to-indigo-950"
        };
        catalogData.unshift(newBook);
        submissionsData = submissionsData.filter(s => s.id !== id);
        saveState();
        renderCatalogTable(catalogData);
        renderSubmissionsTable();
        updateStats();
        showToast(`Submission "${sub.title}" approved and added to catalog!`);
    }
}

function rejectSubmission(id) {
    submissionsData = submissionsData.filter(s => s.id !== id);
    saveState();
    renderSubmissionsTable();
    showToast("Submission rejected and removed.");
}

// Update Stats Counter
function updateStats() {
    document.getElementById('stat-total').innerText = catalogData.length;
}

// Toast Notification Helper
function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

// Handle File Selection (UI, Title Auto-fill, & Page Counting)
document.getElementById('form-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const fileNameDisplay = document.getElementById('file-name-display');
    const uploadUi = document.getElementById('upload-ui');
    const titleInput = document.getElementById('form-title');
    const pageInput = document.getElementById('form-pages');
    
    if (file) {
        // 1. Update Upload UI
        fileNameDisplay.textContent = file.name;
        fileNameDisplay.classList.add('text-accord-blue', 'font-bold');
        uploadUi.classList.add('border-accord-blue', 'bg-accord-lightBlue');
        
        // 2. Auto-fill Document Title
        if (!titleInput.value) {
            const cleanTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
            titleInput.value = cleanTitle;
        }

        // 3. Auto-detect PDF Page Count via pdf.js
        if (file.type === 'application/pdf') {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                const typedarray = new Uint8Array(this.result);
                try {
                    const pdf = await pdfjsLib.getDocument(typedarray).promise;
                    pageInput.value = pdf.numPages; 
                } catch (error) {
                    console.error('Error reading PDF:', error);
                    pageInput.value = 'TBD'; 
                }
            };
            fileReader.readAsArrayBuffer(file);
        }
    } else {
        // Reset UI if file selection is canceled
        fileNameDisplay.textContent = "Max size: 50MB";
        fileNameDisplay.classList.remove('text-accord-blue', 'font-bold');
        uploadUi.classList.remove('border-accord-blue', 'bg-accord-lightBlue');
    }
});