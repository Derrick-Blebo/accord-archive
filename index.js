// Database of Books & Historical Archives
        const booksData = [
            {
                id: 1,
                title: "The Great Welsh Revival & Beyond",
                author: "Dr. Arthur Roberts",
                category: "Church History",
                year: "1954",
                pages: "342",
                badge: "Classic Archive",
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
                badge: "Biography",
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
                badge: "Leadership",
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
                badge: "Ancient Text",
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
                badge: "Revival History",
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
                badge: "Biographical Study",
                description: "Profiles of prime ministers, presidents, and diplomats whose governance was explicitly anchored in Christian convictions.",
                gradient: "from-indigo-950 via-blue-900 to-slate-900"
            }
        ];

        let currentCategory = 'All';
        let savedBookmarks = [];

        // Render Books to Grid
        function renderBooks(filteredList) {
            const grid = document.getElementById('books-grid');
            const emptyState = document.getElementById('empty-state');
            grid.innerHTML = '';

            if (filteredList.length === 0) {
                emptyState.classList.remove('hidden');
                return;
            } else {
                emptyState.classList.add('hidden');
            }

            filteredList.forEach(book => {
                const isBookmarked = savedBookmarks.includes(book.title);
                const card = document.createElement('div');
                card.className = "bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between group";
                card.innerHTML = `
                    <div>
                        <div class="flex items-center justify-between mb-4">
                            <span class="bg-accord-lightBlue text-accord-blue font-bold text-[11px] px-3 py-1 rounded-full uppercase tracking-wider">${book.category}</span>
                            <span class="text-xs font-semibold text-accord-muted">Pub. ${book.year}</span>
                        </div>

                        <!-- Mini Cover Mockup -->
                        <div class="h-44 rounded-2xl bg-gradient-to-br ${book.gradient} p-5 flex flex-col justify-between text-white shadow-md relative overflow-hidden group-hover:scale-[1.02] transition-transform">
                            <div class="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:14px_14px]"></div>
                            <div>
                                <p class="text-[9px] uppercase tracking-widest text-accord-gold font-bold">Accord Archive</p>
                                <h4 class="serif-heading text-lg font-bold mt-1 leading-snug line-clamp-2">${book.title}</h4>
                            </div>
                            <div class="flex items-center justify-between text-xs text-slate-300">
                                <span>${book.author}</span>
                                <span class="bg-white/20 px-2 py-0.5 rounded text-[10px]">${book.pages} p.</span>
                            </div>
                        </div>

                        <div class="mt-4 space-y-2">
                            <h3 class="font-bold text-accord-slate text-base group-hover:text-accord-blue transition-colors">${book.title}</h3>
                            <p class="text-xs text-accord-muted line-clamp-2">${book.description}</p>
                        </div>
                    </div>

                    <div class="flex items-center space-x-3 pt-6 mt-4 border-t border-slate-100">
                        <button onclick="triggerSimulatedDownload()" class="flex-1 bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-md shadow-blue-500/20 flex items-center justify-center space-x-2">
                            <i class="fa-solid fa-download"></i>
                            <span>Download</span>
                        </button>
                        <button onclick="toggleBookmark(this, '${book.title.replace(/'/g, "\\'")}')" class="p-2.5 border border-slate-200 hover:border-accord-blue ${isBookmarked ? 'text-accord-gold border-accord-gold bg-amber-50' : 'text-accord-slate'} rounded-xl transition-all">
                            <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
                        </button>
                    </div>
                `;
                grid.appendChild(card);
            });
        }

        // Category Filter
        function setCategory(category) {
            currentCategory = category;
            
            // Update button styles
            document.querySelectorAll('.category-btn').forEach(btn => {
                btn.className = "category-btn whitespace-nowrap px-4 py-3 rounded-xl text-xs font-bold transition-all bg-slate-100 hover:bg-slate-200 text-accord-slate";
            });
            const activeBtn = document.getElementById(`cat-btn-${category}`);
            if(activeBtn) {
                activeBtn.className = "category-btn whitespace-nowrap px-4 py-3 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-md shadow-blue-500/20";
            }

            filterBooks();
        }

        // Search and Filter Combined
        function filterBooks() {
            const query = document.getElementById('search-input').value.toLowerCase();
            let filtered = booksData.filter(book => {
                const matchesCategory = currentCategory === 'All' || book.category === currentCategory;
                const matchesQuery = book.title.toLowerCase().includes(query) || book.author.toLowerCase().includes(query) || book.description.toLowerCase().includes(query);
                return matchesCategory && matchesQuery;
            });
            renderBooks(filtered);
        }

        function resetFilters() {
            document.getElementById('search-input').value = '';
            setCategory('All');
        }

        // Simulated Download
        function triggerSimulatedDownload() {
            showToast("PDF Download started successfully! Saved to your downloads.");
        }

        // Bookmarks Logic
        function toggleBookmark(btn, title) {
            const index = savedBookmarks.indexOf(title);
            const icon = btn.querySelector('i');
            if (index > -1) {
                savedBookmarks.splice(index, 1);
                icon.className = "fa-regular fa-bookmark";
                btn.classList.remove('text-accord-gold', 'border-accord-gold', 'bg-amber-50');
                showToast("Removed from saved reading list.");
            } else {
                savedBookmarks.push(title);
                icon.className = "fa-solid fa-bookmark";
                btn.classList.add('text-accord-gold', 'border-accord-gold', 'bg-amber-50');
                showToast("Book saved to your reading list!");
            }
            updateBookmarkBadge();
        }

        function updateBookmarkBadge() {
            document.getElementById('bookmark-badge').innerText = savedBookmarks.length;
            document.getElementById('mobile-bookmark-count').innerText = savedBookmarks.length;
        }

        function openBookmarksModal() {
            const listContainer = document.getElementById('bookmarks-list');
            listContainer.innerHTML = '';

            if (savedBookmarks.length === 0) {
                listContainer.innerHTML = `<p class="text-sm text-accord-muted text-center py-8">No saved books yet. Click the bookmark icon on any book to save it for later.</p>`;
            } else {
                savedBookmarks.forEach(title => {
                    const item = document.createElement('div');
                    item.className = "flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200";
                    item.innerHTML = `
                        <span class="text-sm font-bold text-accord-slate">${title}</span>
                        <button onclick="removeBookmark('${title.replace(/'/g, "\\'")}')" class="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                    `;
                    listContainer.appendChild(item);
                });
            }

            const modal = document.getElementById('bookmarks-modal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeBookmarksModal() {
            const modal = document.getElementById('bookmarks-modal');
            modal.classList.remove('flex');
            modal.classList.add('hidden');
            renderBooks(booksData); // Refresh to update bookmark buttons in grid
        }

        function removeBookmark(title) {
            savedBookmarks = savedBookmarks.filter(t => t !== title);
            updateBookmarkBadge();
            openBookmarksModal();
        }

        // Form Submission
        function handleFormSubmit(e) {
            e.preventDefault();
            const name = document.getElementById('sub-name').value;
            const title = document.getElementById('sub-title').value;

            showToast(`Thank you, ${name}! Your manuscript "${title}" has been submitted for archive review.`);
            document.getElementById('contribution-form').reset();
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

        // Mobile Menu Toggle
        function toggleMobileMenu() {
            const menu = document.getElementById('mobile-menu');
            menu.classList.toggle('hidden');
        }

        // Initial Load
        window.onload = function() {
            renderBooks(booksData);
        };