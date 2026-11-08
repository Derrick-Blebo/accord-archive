
// Shared Catalog Database State
let catalogData = [
            {
                id: 1,
                title: "The Great Welsh Revival & Beyond",
                author: "Dr. Arthur Roberts",
                category: "Church History",
                year: "1954",
                pages: "342",
                description: "An exhaustive collection of original diary entries, newspaper cuttings, and theological letters documenting the spiritual awakening across Wales.",
                gradient: "from-blue-900 via-blue-800 to-indigo-950"
            },
            {
                id: 2,
                title: "Apostle of Faith: The Life of John Wesley",
                author: "Elizabeth Montgomery",
                category: "Biographies",
                year: "1978",
                pages: "418",
                description: "Tracing the relentless horseback journeys, diary reflections, and theological footprint of the man who ignited the Methodist movement.",
                gradient: "from-amber-900 via-amber-800 to-stone-900"
            },
            {
                id: 3,
                title: "Nations at the Crossroads: Prayer & Politics",
                author: "Prof. Daniel Adebayo",
                category: "Nations & Leadership",
                year: "2012",
                pages: "280",
                description: "Examining how key world leaders and national assemblies navigated pivotal historical crises through faith and counsel.",
                gradient: "from-slate-900 via-blue-950 to-slate-900"
            },
            {
                id: 4,
                title: "Chronicles of the Early Church Fathers",
                author: "Patristic Research Society",
                category: "Christian Chronicles",
                year: "1940",
                pages: "560",
                description: "Translated letters, apologetics, and martyrdom accounts from the 1st through 4th centuries preserved for modern scholarship.",
                gradient: "from-blue-950 via-slate-900 to-indigo-950"
            },
            {
                id: 5,
                title: "The Hebrides Fire: Scotland's Awakening",
                author: "Duncan Campbell Records",
                category: "Church History",
                year: "1965",
                pages: "210",
                description: "First-hand accounts of the profound spiritual movement in the Isle of Lewis during the late 1940s and early 1950s.",
                gradient: "from-sky-900 via-blue-900 to-slate-900"
            },
            {
                id: 6,
                title: "Statesmen of Integrity: Christian Leaders",
                author: "Marcus Aurelius Thorne",
                category: "Nations & Leadership",
                year: "1995",
                pages: "315",
                description: "Profiles of prime ministers, presidents, and diplomats whose governance was explicitly anchored in Christian convictions.",
                gradient: "from-indigo-950 via-blue-900 to-slate-900"
            }
];

// Pending Submissions Database State
let submissionsData = [
            {
                id: 101,
                name: "Dr. Samuel Vance",
                email: "samuel@accordarchive.org",
                title: "The East African Revival Diaries",
                category: "Church History",
                description: "Unpublished missionary notes and testimonies from East Africa during the mid-20th century awakening."
            },
            {
                id: 102,
                name: "Sarah Jenkins",
                email: "s.jenkins@history.org",
                title: "Pioneers of Faith in Colonial America",
                category: "Christian Chronicles",
                description: "Original journals recording church planting and spiritual resilience in early New England settlements."
            }
];

let deleteTargetId = null;

// Initialize App
lwindow.onload = function() {
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

        // Handle Add / Edit Submission
function handleArchiveSubmit(e) {
            e.preventDefault();
            const editId = document.getElementById('edit-book-id').value;
            const title = document.getElementById('form-title').value;
            const author = document.getElementById('form-author').value;
            const category = document.getElementById('form-category').value;
            const year = document.getElementById('form-year').value;
            const pages = document.getElementById('form-pages').value;
            const description = document.getElementById('form-description').value;

            if (editId) {
                // Edit mode
                const index = catalogData.findIndex(b => b.id == editId);
                if (index > -1) {
                    catalogData[index] = { ...catalogData[index], title, author, category, year, pages, description };
                    showToast(`Archive "${title}" updated successfully!`);
                }
            } else {
                // Add mode
                const newBook = {
                    id: Date.now(),
                    title,
                    author,
                    category,
                    year,
                    pages,
                    description,
                    gradient: "from-blue-900 via-indigo-900 to-slate-900"
                };
                catalogData.unshift(newBook);
                showToast(`New archive "${title}" added successfully!`);
            }

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
                    year: "2026",
                    pages: "245",
                    description: sub.description,
                    gradient: "from-blue-900 via-blue-800 to-indigo-950"
                };
                catalogData.unshift(newBook);
                submissionsData = submissionsData.filter(s => s.id !== id);
                renderCatalogTable(catalogData);
                renderSubmissionsTable();
                updateStats();
                showToast(`Submission "${sub.title}" approved and added to catalog!`);
            }
}

function rejectSubmission(id) {
            submissionsData = submissionsData.filter(s => s.id !== id);
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
        
  