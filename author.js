// =========================================================
// ACCORD AUTHOR.JS
// Book Uploads, Author Metrics, Earnings & Withdrawals, Hide Toggle & Takedown Requests
// =========================================================

let authorUser = null;
let authorBooks = [];
let authorWithdrawals = [];
let salesStatsByBook = {};
let availableBalance = 0;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof supabaseClient === 'undefined') return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
        window.location.href = 'index.html';
        return;
    }

    authorUser = session.user;
    syncAuthorHeaderLabels();
    bindAuthorUploadListeners();
    await loadAuthorCategories();
    await loadAuthorDashboardData();
});

function getAuthorDisplayName() {
    return (
        authorUser?.user_metadata?.full_name ||
        authorUser?.user_metadata?.name ||
        authorUser?.email?.split('@')[0] ||
        'Author'
    );
}

function syncAuthorHeaderLabels() {
    const displayName = getAuthorDisplayName();
    const navLabel = document.getElementById('auth-nav-label');
    const mobileLabel = document.getElementById('mobile-auth-label');
    const subtitle = document.getElementById('author-subtitle');

    if (navLabel) navLabel.textContent = displayName;
    if (mobileLabel) mobileLabel.textContent = `Account (${displayName})`;
    if (subtitle) {
        subtitle.textContent = `Signed in as ${displayName} (${authorUser.email}). Upload books, manage visibility, request takedowns, and withdraw earnings.`;
    }
}

function bindAuthorUploadListeners() {
    const pdfInput = document.getElementById('upload-book-pdf');
    if (pdfInput) {
        pdfInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            const metaEl = document.getElementById('upload-pdf-meta');
            const pagesInput = document.getElementById('upload-book-pages');
            if (!file) {
                if (metaEl) metaEl.textContent = 'PDF up to 50MB, or provide an external PDF link below.';
                if (pagesInput) pagesInput.value = 'TBD';
                return;
            }

            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            let detectedPages = 'TBD';

            if (window.pdfjsLib && file.type === 'application/pdf') {
                try {
                    const buf = await file.arrayBuffer();
                    const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
                    detectedPages = String(pdfDoc.numPages || 'TBD');
                } catch (_) {
                    detectedPages = 'TBD';
                }
            }

            if (pagesInput) pagesInput.value = detectedPages;
            if (metaEl) {
                metaEl.textContent = `${file.name} (${sizeMb} MB${detectedPages !== 'TBD' ? ` • ${detectedPages} pages` : ''})`;
            }
        });
    }
}

async function loadAuthorCategories() {
    const select = document.getElementById('upload-book-category');
    if (!select) return;

    const { data, error } = await supabaseClient
        .from('categories')
        .select('name')
        .order('name', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
        const names = data
            .map(c => c.name)
            .filter(name => name && !String(name).startsWith('__ACCORD_'));
        if (names.length > 0) {
            select.innerHTML = names
                .map(name => `<option value="${escapeAuthorHtml(name)}">${escapeAuthorHtml(name)}</option>`)
                .join('');
        }
    }
}

function openUploadBookModal() {
    document.getElementById('upload-book-form')?.reset();
    const authorInput = document.getElementById('upload-book-author');
    const yearInput = document.getElementById('upload-book-year');
    const pagesInput = document.getElementById('upload-book-pages');
    const metaEl = document.getElementById('upload-pdf-meta');

    if (authorInput) authorInput.value = getAuthorDisplayName();
    if (yearInput) yearInput.value = String(new Date().getFullYear());
    if (pagesInput) pagesInput.value = 'TBD';
    if (metaEl) metaEl.textContent = 'PDF up to 50MB, or provide an external PDF link below.';

    toggleUploadPriceField();
    const modal = document.getElementById('upload-book-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeUploadBookModal() {
    const modal = document.getElementById('upload-book-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

function toggleUploadPriceField() {
    const isForSale = document.getElementById('upload-book-access')?.value === 'true';
    const wrapper = document.getElementById('upload-price-wrapper');
    const priceInput = document.getElementById('upload-book-price');

    wrapper?.classList.toggle('hidden', !isForSale);
    if (priceInput) {
        priceInput.required = isForSale;
        if (!isForSale) priceInput.value = '';
    }
}

async function uploadAuthorFile(file, folder) {
    const safeName = `${authorUser.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const candidateBuckets = ['books', 'archives', 'covers', 'pdfs', 'public'];

    for (const bucket of candidateBuckets) {
        const { error } = await supabaseClient.storage
            .from(bucket)
            .upload(`${folder}/${safeName}`, file, { upsert: false });

        if (!error) {
            const { data } = supabaseClient.storage
                .from(bucket)
                .getPublicUrl(`${folder}/${safeName}`);
            if (data?.publicUrl) return data.publicUrl;
        }
    }

    throw new Error('Could not upload file to storage bucket. Please check storage bucket policies or paste an external URL.');
}

async function handleAuthorBookUpload(e) {
    e.preventDefault();

    const title = document.getElementById('upload-book-title').value.trim();
    const authorName = document.getElementById('upload-book-author').value.trim() || getAuthorDisplayName();
    const category = document.getElementById('upload-book-category').value.trim() || 'General';
    const year = document.getElementById('upload-book-year').value.trim() || String(new Date().getFullYear());
    const pages = document.getElementById('upload-book-pages').value.trim() || 'TBD';
    const isForSale = document.getElementById('upload-book-access').value === 'true';
    const price = isForSale ? (parseFloat(document.getElementById('upload-book-price').value) || 0) : 0;
    const description = document.getElementById('upload-book-description').value.trim();

    const pdfFile = document.getElementById('upload-book-pdf').files?.[0] || null;
    const coverFile = document.getElementById('upload-book-cover').files?.[0] || null;
    const externalUrl = document.getElementById('upload-book-url').value.trim();

    if (!title || !description) {
        showToast('Please enter both a book title and description.', true);
        return;
    }

    if (!pdfFile && !externalUrl) {
        showToast('Please attach a PDF file or enter an external PDF URL.', true);
        return;
    }

    if (pdfFile && pdfFile.size > 50 * 1024 * 1024) {
        showToast('PDF file must be 50MB or smaller.', true);
        return;
    }

    const submitBtn = document.getElementById('upload-book-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading...';
    }

    try {
        let fileUrl = externalUrl || null;
        let coverUrl = null;

        if (pdfFile) {
            fileUrl = await uploadAuthorFile(pdfFile, 'pdfs');
        }
        if (coverFile) {
            coverUrl = await uploadAuthorFile(coverFile, 'covers');
        }

        const bookPayload = {
            title,
            author: authorName,
            author_id: authorUser.id,
            category,
            year,
            pages,
            description,
            file_url: fileUrl,
            cover_url: coverUrl,
            is_for_sale: isForSale,
            price,
            is_visible: false,
            status: 'draft',
            takedown_status: 'none'
        };

        const { data: insertedBook, error: bookError } = await supabaseClient
            .from('books')
            .insert([bookPayload])
            .select()
            .single();

        if (bookError) {
            throw new Error(bookError.message);
        }

        // Also record in submissions so Library Admin sees it under Pending Reviews
        await supabaseClient
            .from('submissions')
            .insert([{
                author_name: authorName,
                author_email: authorUser.email,
                title,
                category,
                description,
                file_url: fileUrl,
                status: 'pending'
            }]);

        closeUploadBookModal();
        showToast('Book uploaded and sent for Library Admin review.');
        if (insertedBook) {
            authorBooks.unshift(insertedBook);
            renderAuthorMetrics();
            renderAuthorBooksTable();
        }
        await loadAuthorDashboardData();
    } catch (err) {
        showToast(`Upload failed: ${err.message}`, true);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Book';
        }
    }
}

function handleAuthNavClick() {
    window.location.href = 'profile.html';
}

function toggleMobileMenu() {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-500 text-lg'
            : 'fa-solid fa-circle-check text-accord-gold text-lg';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

function escapeAuthorHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadAuthorDashboardData() {
    const [booksRes, withdrawalsRes] = await Promise.all([
        supabaseClient
            .from('books')
            .select('*')
            .eq('author_id', authorUser.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('author_withdrawals')
            .select('*')
            .eq('author_id', authorUser.id)
            .order('created_at', { ascending: false })
    ]);

    authorBooks = (!booksRes.error && booksRes.data) ? booksRes.data : [];
    authorWithdrawals = (!withdrawalsRes.error && withdrawalsRes.data) ? withdrawalsRes.data : [];

    salesStatsByBook = {};
    const bookIds = authorBooks.map(b => b.id);
    if (bookIds.length > 0) {
        const { data: purchases } = await supabaseClient
            .from('user_purchases')
            .select('book_id, amount_paid')
            .in('book_id', bookIds);

        (purchases || []).forEach(p => {
            const key = Number(p.book_id);
            if (!salesStatsByBook[key]) {
                salesStatsByBook[key] = { count: 0, earned: 0 };
            }
            salesStatsByBook[key].count += 1;
            salesStatsByBook[key].earned += Number(p.amount_paid) || 0;
        });
    }

    renderAuthorMetrics();
    renderAuthorBooksTable();
    renderAuthorWithdrawalsTable();
}

function renderAuthorMetrics() {
    const uploadedCount = authorBooks.length;
    const totalDownloads = authorBooks.reduce((sum, b) => sum + (Number(b.downloads) || 0), 0);

    let totalSales = 0;
    let grossEarned = 0;
    authorBooks.forEach(b => {
        const stat = salesStatsByBook[Number(b.id)];
        if (stat) {
            totalSales += stat.count;
            grossEarned += stat.earned;
        }
    });

    const committedWithdrawals = authorWithdrawals
        .filter(w => w.status !== 'rejected')
        .reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

    availableBalance = Math.max(0, grossEarned - committedWithdrawals);

    document.getElementById('metric-uploaded-count').textContent = uploadedCount.toLocaleString();
    document.getElementById('metric-downloads-count').textContent = totalDownloads.toLocaleString();
    document.getElementById('metric-sales-count').textContent = totalSales.toLocaleString();
    document.getElementById('metric-earned-amount').textContent = `USD ${availableBalance.toFixed(2)}`;
    document.getElementById('metric-withdrawn-note').textContent =
        `Gross: USD ${grossEarned.toFixed(2)} • Allocated: USD ${committedWithdrawals.toFixed(2)}`;
}

function renderAuthorBooksTable() {
    const tbody = document.getElementById('author-books-tbody');
    if (!tbody) return;

    if (authorBooks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-10 text-center space-y-3">
                    <p class="text-accord-muted">No books linked to your author account yet.</p>
                    <button type="button" onclick="openUploadBookModal()" class="bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold px-4 py-2 rounded-xl inline-flex items-center space-x-1.5">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                        <span>Upload Your First Book</span>
                    </button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    authorBooks.forEach(book => {
        const downloads = Number(book.downloads) || 0;
        const stat = salesStatsByBook[Number(book.id)] || { count: 0, earned: 0 };
        const isVisible = book.is_visible !== false && book.status !== 'draft';
        const tdStatus = book.takedown_status || 'none';

        const visibilityPill = book.status === 'draft'
            ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Pending Review</span>`
            : isVisible
                ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Visible</span>`
                : `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">Hidden</span>`;

        const hideToggleBtn = `
            <button type="button" onclick="toggleAuthorBookVisibility('${book.id}', ${!isVisible})" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-[11px] font-bold transition-all">
                <i class="fa-solid ${isVisible ? 'fa-eye-slash' : 'fa-eye'} mr-1"></i>
                ${isVisible ? 'Hide' : 'Show'}
            </button>
        `;

        let takedownActionHtml = '';
        if (tdStatus === 'pending') {
            takedownActionHtml = `
                <span class="inline-flex items-center px-2.5 py-1 rounded-xl text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    <i class="fa-solid fa-clock mr-1"></i> Takedown Pending Admin
                </span>
            `;
        } else if (tdStatus === 'approved') {
            takedownActionHtml = `
                <span class="inline-flex items-center px-2.5 py-1 rounded-xl text-[10px] font-bold bg-red-50 text-red-600">
                    Takedown Approved
                </span>
            `;
        } else {
            const safeTitle = escapeAuthorHtml(book.title).replace(/'/g, "\\'");
            takedownActionHtml = `
                <button type="button" onclick="openTakedownModal('${book.id}', '${safeTitle}')" class="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-bold transition-all">
                    <i class="fa-solid fa-flag mr-1"></i> Request Takedown
                </button>
            `;
        }

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/70 transition-colors';
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate text-sm">${escapeAuthorHtml(book.title)}</p>
                <p class="text-[11px] text-accord-muted">${escapeAuthorHtml(book.category || 'Archive')} • ${book.is_for_sale ? `USD ${Number(book.price || 0).toFixed(2)}` : 'Free'}</p>
            </td>
            <td class="py-4 px-6 text-center font-bold text-accord-slate">${downloads.toLocaleString()}</td>
            <td class="py-4 px-6 text-center font-bold text-accord-slate">${stat.count.toLocaleString()}</td>
            <td class="py-4 px-6 text-right font-extrabold text-emerald-700">USD ${stat.earned.toFixed(2)}</td>
            <td class="py-4 px-6 text-center">${visibilityPill}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${hideToggleBtn}
                ${takedownActionHtml}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleAuthorBookVisibility(bookId, makeVisible) {
    const updatePayload = makeVisible
        ? { is_visible: true, status: 'published' }
        : { is_visible: false };

    const { error } = await supabaseClient
        .from('books')
        .update(updatePayload)
        .eq('id', bookId)
        .eq('author_id', authorUser.id);

    if (error) {
        showToast(`Could not update visibility: ${error.message}`, true);
        return;
    }

    showToast(makeVisible ? 'Book is now visible in the public library.' : 'Book hidden from the public library.');
    await loadAuthorDashboardData();
}

function openTakedownModal(bookId, title) {
    document.getElementById('takedown-book-id').value = bookId;
    document.getElementById('takedown-book-title').textContent = title;
    document.getElementById('takedown-reason').value = '';
    const modal = document.getElementById('takedown-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeTakedownModal() {
    const modal = document.getElementById('takedown-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleTakedownSubmit(e) {
    e.preventDefault();
    const bookId = document.getElementById('takedown-book-id').value;
    const reason = document.getElementById('takedown-reason').value.trim();
    const btn = document.getElementById('takedown-submit-btn');

    if (reason.length < 15) {
        showToast('Please provide a reason of at least 15 characters.', true);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    const { error } = await supabaseClient
        .from('books')
        .update({
            takedown_status: 'pending',
            takedown_reason: reason,
            takedown_requested_at: new Date().toISOString()
        })
        .eq('id', bookId)
        .eq('author_id', authorUser.id);

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit Takedown Request';
    }

    if (error) {
        showToast(`Request failed: ${error.message}`, true);
        return;
    }

    closeTakedownModal();
    showToast('Takedown request sent to Library Admin for approval.');
    await loadAuthorDashboardData();
}

function openWithdrawModal() {
    document.getElementById('modal-available-balance').textContent = `USD ${availableBalance.toFixed(2)}`;
    const amountInput = document.getElementById('withdraw-amount');
    if (amountInput) {
        amountInput.max = availableBalance.toFixed(2);
        amountInput.value = '';
    }
    const modal = document.getElementById('withdraw-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeWithdrawModal() {
    const modal = document.getElementById('withdraw-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
}

async function handleWithdrawSubmit(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const payoutMethod = document.getElementById('withdraw-method').value;
    const payoutDetails = document.getElementById('withdraw-details').value.trim();
    const btn = document.getElementById('withdraw-submit-btn');

    if (isNaN(amount) || amount <= 0) {
        showToast('Enter a valid withdrawal amount.', true);
        return;
    }
    if (amount > availableBalance) {
        showToast('Amount exceeds your available earnings balance.', true);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    const authorName = getAuthorDisplayName();

    const { error } = await supabaseClient
        .from('author_withdrawals')
        .insert([{
            author_id: authorUser.id,
            author_name: authorName,
            author_email: authorUser.email,
            amount,
            payout_method: payoutMethod,
            payout_details: payoutDetails,
            status: 'pending'
        }]);

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Request Withdrawal';
    }

    if (error) {
        showToast(`Could not submit withdrawal: ${error.message}`, true);
        return;
    }

    closeWithdrawModal();
    showToast('Withdrawal request submitted.');
    await loadAuthorDashboardData();
}

function renderAuthorWithdrawalsTable() {
    const tbody = document.getElementById('author-withdrawals-tbody');
    if (!tbody) return;

    if (authorWithdrawals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-accord-muted">No withdrawal requests yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    authorWithdrawals.forEach(w => {
        const d = w.created_at
            ? new Date(w.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';

        let pill = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Pending</span>`;
        if (w.status === 'paid' || w.status === 'approved') {
            pill = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">${escapeAuthorHtml(w.status)}</span>`;
        } else if (w.status === 'rejected') {
            pill = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">Rejected</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="py-3.5 px-6 text-accord-muted">${d}</td>
            <td class="py-3.5 px-6">
                <p class="font-bold text-accord-slate">${escapeAuthorHtml(w.payout_method)}</p>
                <p class="text-[11px] text-accord-muted">${escapeAuthorHtml(w.payout_details)}</p>
            </td>
            <td class="py-3.5 px-6 text-right font-bold text-accord-slate">USD ${Number(w.amount || 0).toFixed(2)}</td>
            <td class="py-3.5 px-6 text-center">${pill}</td>
        `;
        tbody.appendChild(tr);
    });
}

function handleAuthorCoverPreview(event) {
    const file = event.target.files?.[0];
    const metaEl = document.getElementById('upload-cover-meta');
    const previewBox = document.getElementById('upload-cover-preview-box');

    if (!file) {
        if (metaEl) metaEl.textContent = 'JPG, PNG, WebP (Auto-optimized)';
        if (previewBox) previewBox.innerHTML = '<i class="fa-regular fa-image"></i>';
        return;
    }

    if (metaEl) metaEl.textContent = file.name;
    if (previewBox) {
        const objectUrl = URL.createObjectURL(file);
        previewBox.innerHTML = `<img src="${objectUrl}" alt="Cover preview" class="w-full h-full object-cover">`;
    }
}