// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let catalogData = [];
let trashData = [];
let submissionsData = [];
let deleteTargetId = null;
let currentCompressedCover = "";

window.onload = async function() {
    await fetchAllData();
};

async function fetchAllData() {
    const { data: books, error: booksErr } = await supabaseClient
        .from('books')
        .select('*')
        .order('created_at', { ascending: false });

    if (!booksErr && books) {
        catalogData = books.filter(b => !b.deleted_at);
        trashData = books.filter(b => b.deleted_at);
        renderCatalogTable(catalogData);
        renderTrashTable();
        updateStats();
    }

    const { data: subs, error: subsErr } = await supabaseClient
        .from('submissions')
        .select('*')
        .order('created_at', { ascending: false });

    if (!subsErr && subs) {
        submissionsData = subs;
        renderSubmissionsTable();
    }
}

function switchTab(tabName) {
    const tabs = ['catalog', 'submissions', 'trash'];
    tabs.forEach(t => {
        const sec = document.getElementById(`section-${t}`);
        const btn = document.getElementById(`nav-tab-${t}`);
        if (t === tabName) {
            sec.classList.remove('hidden');
            btn.className = "px-5 py-2 rounded-xl text-xs font-bold transition-all bg-white text-accord-blue shadow-sm";
        } else {
            sec.classList.add('hidden');
            btn.className = "px-5 py-2 rounded-xl text-xs font-bold transition-all text-accord-muted hover:text-accord-slate";
        }
    });
}

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

        let statusBadge = '';
        if (book.status === 'uploading') {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 mt-0.5"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Uploading PDF...</span>`;
        } else if (book.status === 'failed') {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-600 mt-0.5"><i class="fa-solid fa-circle-exclamation mr-1"></i> Upload Failed</span>`;
        } else if (book.download_url) {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-600 mt-0.5"><i class="fa-solid fa-circle-check mr-1"></i> Upload Successful</span>`;
        } else {
            statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 mt-0.5">No PDF Linked</span>`;
        }

        const visibilityBadge = book.is_visible === false
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700 mt-0.5"><i class="fa-solid fa-eye-slash mr-1"></i> Hidden</span>`
            : '';

        const isVisible = book.is_visible !== false;
        const visibilityBtn = isVisible
            ? `<button onclick="toggleBookVisibility(${book.id}, false)" class="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-amber-50 text-emerald-600 hover:text-amber-600 transition-all inline-flex items-center justify-center" title="Visible on Homepage (Click to Hide)"><i class="fa-solid fa-eye text-xs"></i></button>`
            : `<button onclick="toggleBookVisibility(${book.id}, true)" class="w-8 h-8 rounded-xl bg-slate-200 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 transition-all inline-flex items-center justify-center" title="Hidden from Homepage (Click to Make Visible)"><i class="fa-solid fa-eye-slash text-xs"></i></button>`;

        const thumb = book.cover_url
            ? `<img src="${book.cover_url}" class="w-9 h-12 rounded-lg object-cover shadow-sm border border-slate-200 shrink-0">`
            : `<div class="w-9 h-12 rounded-lg bg-accord-lightBlue text-accord-blue flex items-center justify-center font-bold text-xs shrink-0"><i class="fa-solid fa-book"></i></div>`;

        const viewBtn = book.download_url
            ? `<a href="${book.download_url.split('?')[0]}" target="_blank" class="w-8 h-8 rounded-xl bg-accord-lightBlue hover:bg-accord-blue text-accord-blue hover:text-white transition-all inline-flex items-center justify-center" title="View & Read Book"><i class="fa-solid fa-book-open-reader text-xs"></i></a>`
            : `<button disabled class="w-8 h-8 rounded-xl bg-slate-100 text-slate-300 cursor-not-allowed inline-flex items-center justify-center" title="No PDF available"><i class="fa-solid fa-book-open-reader text-xs"></i></button>`;

        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate flex items-center space-x-3">
                ${thumb}
                <div>
                    <p class="leading-snug">${book.title}</p>
                    <div class="flex flex-wrap items-center gap-1">
                        ${statusBadge}
                        ${visibilityBadge}
                    </div>
                </div>
            </td>
            <td class="py-4 px-6 text-accord-muted">${book.author}</td>
            <td class="py-4 px-6"><span class="bg-accord-lightBlue text-accord-blue text-[10px] font-bold px-2.5 py-1 rounded-md inline-block leading-tight">${book.category}</span></td>
            <td class="py-4 px-6 text-center text-accord-muted">${book.year}</td>
            <td class="py-4 px-6 text-center text-accord-muted">${book.pages || 'TBD'} p.</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${visibilityBtn}
                ${viewBtn}
                <button onclick="openArchiveModal('edit', ${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-accord-blue transition-all inline-flex items-center justify-center" title="Edit Archive"><i class="fa-solid fa-pen text-xs"></i></button>
                <button onclick="promptDelete(${book.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Move to Recycle Bin"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleBookVisibility(id, makeVisible) {
    const { error } = await supabaseClient
        .from('books')
        .update({ is_visible: makeVisible })
        .eq('id', id);

    if (!error) {
        await fetchAllData();
        showToast(makeVisible ? "Book is now visible on the homepage." : "Book hidden from the homepage.");
    } else {
        showToast("Could not update visibility. Please try again.");
    }
}

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

function openArchiveModal(mode, id = null) {
    const modal = document.getElementById('archive-modal');
    const heading = document.getElementById('modal-heading');
    document.getElementById('archive-form').reset();
    document.getElementById('edit-book-id').value = '';
    currentCompressedCover = "";

    document.getElementById('file-name-display').textContent = "Max size: 50MB";
    document.getElementById('file-name-display').classList.remove('text-accord-blue', 'font-bold');
    document.getElementById('upload-ui').classList.remove('border-accord-blue', 'bg-accord-lightBlue');

    const coverPreview = document.getElementById('cover-preview-box');
    const coverName = document.getElementById('cover-name-display');
    if (coverPreview) coverPreview.innerHTML = `<i class="fa-regular fa-image"></i>`;
    if (coverName) {
        coverName.textContent = "JPG, PNG, WebP (Auto-optimized)";
        coverName.classList.remove('text-accord-blue', 'font-bold');
    }

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
            if (book.cover_url && coverPreview) {
                coverPreview.innerHTML = `<img src="${book.cover_url}" class="w-full h-full object-cover">`;
            }
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

async function handleArchiveSubmit(e) {
    e.preventDefault();

    const fileInput = document.getElementById('form-file');
    const selectedFile = fileInput && fileInput.files.length > 0 ? fileInput.files[0] : null;
    const coverToSave = currentCompressedCover;

    const editId = document.getElementById('edit-book-id').value;
    const title = document.getElementById('form-title').value;
    const author = document.getElementById('form-author').value;
    const category = document.getElementById('form-category').value;
    const year = document.getElementById('form-year').value;
    const pages = document.getElementById('form-pages').value || "TBD";
    const description = document.getElementById('form-description').value;

    closeArchiveModal();

    const tempId = Date.now();
    const existingBook = editId ? catalogData.find(b => b.id == editId) : null;
    const tempBook = {
        id: editId ? Number(editId) : tempId,
        title, author, category, year, pages, description,
        cover_url: coverToSave || (existingBook ? existingBook.cover_url : ""),
        download_url: existingBook ? existingBook.download_url : "",
        status: selectedFile ? 'uploading' : 'complete'
    };

    if (editId) {
        const idx = catalogData.findIndex(b => b.id == editId);
        if (idx > -1) catalogData[idx] = tempBook;
    } else {
        catalogData.unshift(tempBook);
    }
    renderCatalogTable(catalogData);

    let downloadUrl = existingBook ? existingBook.download_url : "";
    if (selectedFile) {
        try {
            const originalName = selectedFile.name || 'document.pdf';
            const lastDotIndex = originalName.lastIndexOf('.');
            const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
            const fileExtension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : '.pdf';
            const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9._-]/g, "_");
            const fileName = `${cleanName}_acc${Date.now()}${fileExtension}`;

            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('archive-files')
                .upload(fileName, selectedFile, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabaseClient.storage
                .from('archive-files')
                .getPublicUrl(uploadData.path);

            downloadUrl = `${publicUrlData.publicUrl}?download=${encodeURIComponent(fileName)}`;
        } catch (error) {
            console.error("Supabase Storage Upload Error:", error);
            const target = catalogData.find(b => b.id === tempBook.id);
            if (target) target.status = 'failed';
            renderCatalogTable(catalogData);
            showToast(`Upload failed: ${error.message}`);
            return;
        }
    }

    const payload = {
        title, author, category, year, pages,
        download_url: downloadUrl,
        cover_url: tempBook.cover_url,
        description,
        gradient: existingBook ? existingBook.gradient : "from-blue-900 via-indigo-900 to-slate-900"
    };

    if (editId) {
        await supabaseClient.from('books').update(payload).eq('id', editId);
        showToast(`Archive "${title}" updated!`);
    } else {
        await supabaseClient.from('books').insert([{ ...payload, is_visible: true }]);
        showToast(`Archive "${title}" uploaded & published!`);
    }

    await fetchAllData();
}

async function promptDelete(id) {
    await supabaseClient
        .from('books')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

    await fetchAllData();
    showToast("Moved to Recycle Bin.");
}

function renderTrashTable() {
    const tbody = document.getElementById('trash-table-body');
    const badge = document.getElementById('trash-badge');
    if (badge) badge.innerText = trashData.length;
    if (!tbody) return;

    tbody.innerHTML = '';

    if (trashData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-accord-muted">Recycle Bin is empty.</td></tr>`;
        return;
    }

    trashData.forEach(book => {
        const deletedDate = new Date(book.deleted_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric'
        });

        const viewBtn = book.download_url
            ? `<a href="${book.download_url.split('?')[0]}" target="_blank" class="w-8 h-8 rounded-xl bg-accord-lightBlue hover:bg-accord-blue text-accord-blue hover:text-white transition-all inline-flex items-center justify-center" title="View & Read Book"><i class="fa-solid fa-book-open-reader text-xs"></i></a>`
            : `<button disabled class="w-8 h-8 rounded-xl bg-slate-100 text-slate-300 cursor-not-allowed inline-flex items-center justify-center" title="No PDF available"><i class="fa-solid fa-book-open-reader text-xs"></i></button>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate">${book.title}</td>
            <td class="py-4 px-6 text-accord-muted">${book.author}</td>
            <td class="py-4 px-6"><span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${book.category}</span></td>
            <td class="py-4 px-6 text-accord-muted">${deletedDate}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${viewBtn}
                <button onclick="restoreFromTrash(${book.id})" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all" title="Restore to Catalog">
                    <i class="fa-solid fa-rotate-left mr-1"></i> Restore
                </button>
                <button onclick="promptPermanentDelete(${book.id})" class="bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all" title="Delete Forever">
                    <i class="fa-solid fa-trash mr-1"></i> Delete Forever
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function restoreFromTrash(id) {
    await supabaseClient
        .from('books')
        .update({ deleted_at: null })
        .eq('id', id);

    await fetchAllData();
    showToast("Archive restored to live catalog!");
}

function promptPermanentDelete(id) {
    deleteTargetId = id;
    document.getElementById('confirm-title').innerText = "Delete Permanently?";
    document.getElementById('confirm-text').innerText = "This will permanently remove the book and its PDF file from storage. This cannot be undone.";
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('confirm-btn').onclick = function() {
        executePermanentDelete(deleteTargetId);
    };
}

function promptEmptyTrash() {
    if (trashData.length === 0) {
        showToast("Recycle Bin is already empty.");
        return;
    }
    document.getElementById('confirm-title').innerText = "Empty Recycle Bin?";
    document.getElementById('confirm-text').innerText = `Permanently delete all ${trashData.length} item(s) in the Recycle Bin? This cannot be undone.`;
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('confirm-btn').onclick = async function() {
        for (const item of [...trashData]) {
            await removeStorageFile(item.download_url);
            await supabaseClient.from('books').delete().eq('id', item.id);
        }
        closeConfirmModal();
        await fetchAllData();
        showToast("Recycle Bin emptied.");
    };
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    deleteTargetId = null;
}

async function removeStorageFile(downloadUrl) {
    if (!downloadUrl || !downloadUrl.includes('/archive-files/')) return;
    const filePath = decodeURIComponent(downloadUrl.split('/archive-files/')[1].split('?')[0]);
    await supabaseClient.storage.from('archive-files').remove([filePath]);
}

async function executePermanentDelete(id) {
    const book = trashData.find(b => b.id === id);
    if (book) await removeStorageFile(book.download_url);
    await supabaseClient.from('books').delete().eq('id', id);
    closeConfirmModal();
    await fetchAllData();
    showToast("Archive permanently deleted.");
}

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
            <td class="py-4 px-6"><span class="bg-amber-50 text-accord-gold text-[10px] font-bold px-2.5 py-1 rounded-md inline-block">${sub.category}</span></td>
            <td class="py-4 px-6 text-accord-muted max-w-xs truncate">${sub.description}</td>
            <td class="py-4 px-6 text-right space-x-2">
                <button onclick="approveSubmission(${sub.id})" class="bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl shadow-sm transition-all"><i class="fa-solid fa-check mr-1"></i> Approve</button>
                <button onclick="rejectSubmission(${sub.id})" class="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all"><i class="fa-solid fa-xmark mr-1"></i> Reject</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function approveSubmission(id) {
    const sub = submissionsData.find(s => s.id === id);
    if (sub) {
        await supabaseClient.from('books').insert([{
            title: sub.title,
            author: sub.name,
            category: sub.category,
            year: new Date().getFullYear().toString(),
            pages: "TBD",
            download_url: "",
            cover_url: "",
            description: sub.description,
            gradient: "from-blue-900 via-blue-800 to-indigo-950",
            is_visible: true
        }]);
        await supabaseClient.from('submissions').delete().eq('id', id);
        await fetchAllData();
        showToast(`Submission "${sub.title}" approved!`);
    }
}

async function rejectSubmission(id) {
    await supabaseClient.from('submissions').delete().eq('id', id);
    await fetchAllData();
    showToast("Submission rejected and removed.");
}

function updateStats() {
    document.getElementById('stat-total').innerText = catalogData.length;
}

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

document.getElementById('form-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const fileNameDisplay = document.getElementById('file-name-display');
    const uploadUi = document.getElementById('upload-ui');
    const titleInput = document.getElementById('form-title');
    const pageInput = document.getElementById('form-pages');

    if (file) {
        fileNameDisplay.textContent = file.name;
        fileNameDisplay.classList.add('text-accord-blue', 'font-bold');
        uploadUi.classList.add('border-accord-blue', 'bg-accord-lightBlue');

        if (!titleInput.value) {
            titleInput.value = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
        }

        if (file.type === 'application/pdf') {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                try {
                    const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise;
                    pageInput.value = pdf.numPages;
                } catch {
                    pageInput.value = 'TBD';
                }
            };
            fileReader.readAsArrayBuffer(file);
        }
    }
});

document.getElementById('form-cover')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const previewBox = document.getElementById('cover-preview-box');
    const coverName = document.getElementById('cover-name-display');

    if (file) {
        coverName.textContent = file.name;
        coverName.classList.add('text-accord-blue', 'font-bold');

        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 480;
                const scale = Math.min(1, MAX_WIDTH / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                currentCompressedCover = canvas.toDataURL('image/jpeg', 0.82);
                if (previewBox) {
                    previewBox.innerHTML = `<img src="${currentCompressedCover}" class="w-full h-full object-cover">`;
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});