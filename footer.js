/**
 * Accord Archive - Unified Global Footer Component
 * Automatically injects a consistent footer across all public and admin pages.
 */

document.addEventListener("DOMContentLoaded", function () {
    const footerHTML = `
        <footer class="bg-white border-t border-slate-200 py-8 mt-auto w-full">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-accord-muted space-y-3 sm:space-y-0">
                <div class="flex items-center space-x-2">
                    <span class="font-bold text-accord-slate">Accord Archive Ecosystem</span>
                    <span class="hidden sm:inline">•</span>
                    <span>Digital Preservation & Publishing</span>
                </div>
                <div class="flex items-center space-x-5 font-semibold text-accord-slate">
                    <a href="index.html" class="hover:text-accord-blue transition-colors">Library</a>
                    <a href="forum.html" class="hover:text-accord-blue transition-colors">Forum</a>
                    <a href="library-admin.html" class="hover:text-accord-blue transition-colors">Admin Portal</a>
                </div>
                <p>© 2026 Accord Media House. All rights reserved.</p>
            </div>
        </footer>
    `;

    // Replace existing <footer> tag or append to the body wrapper
    const existingFooter = document.querySelector('footer');
    if (existingFooter) {
        existingFooter.outerHTML = footerHTML;
    } else {
        document.body.insertAdjacentHTML('beforeend', footerHTML);
    }
});