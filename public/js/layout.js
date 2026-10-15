/**
 * Master Application Layout Injector
 * Builds standard Sidebar, Topbar, and Mobile Navigation
 */
const Layout = (function() {
  function escapeHtml(val) {
    if (typeof UI !== 'undefined' && typeof UI.escape === 'function') {
      return UI.escape(val);
    }
    return String(val == null ? '' : val).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function init(activeKey = 'dashboard') {
    if (!Auth.requireAuth()) return;

    const user = Auth.getUser() || { name: 'User', role: 'Staff' };
    const container = document.getElementById('app-layout');
    if (!container) return;

    const safeUserName = escapeHtml(user.name || 'User');
    const safeUserRole = escapeHtml(user.role || 'Staff');
    const safeUserEmail = escapeHtml(user.email || '');
    const userInitial = escapeHtml((user.name || 'U').trim().charAt(0).toUpperCase() || 'U');
    const safeActiveKey = escapeHtml(String(activeKey).replace(/[-_]/g, ' '));

    const navGroups = [
      {
        title: 'OVERVIEW',
        items: [
          { key: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie', href: '/dashboard.html', perm: 'dashboard.view' }
        ]
      },
      {
        title: 'INVENTORY',
        items: [
          { key: 'products', label: 'Products', icon: 'fa-box-archive', href: '/products/index.html', perm: 'products.view' },
          { key: 'categories', label: 'Categories', icon: 'fa-tags', href: '/categories/index.html', perm: 'categories.view' },
          { key: 'brands', label: 'Brands', icon: 'fa-copyright', href: '/brands/index.html', perm: 'brands.view' },
          { key: 'warehouses', label: 'Warehouses', icon: 'fa-warehouse', href: '/warehouses/index.html', perm: 'warehouses.view' },
          { key: 'stock', label: 'Stock & Movements', icon: 'fa-boxes-stacked', href: '/stock/index.html', perm: 'stock.view' },
          { key: 'transfers', label: 'Stock Transfers', icon: 'fa-truck-ramp-box', href: '/transfers/index.html', perm: 'stock.view' },
          { key: 'adjustments', label: 'Stock Adjustments', icon: 'fa-sliders', href: '/adjustments/index.html', perm: 'stock.view' }
        ]
      },
      {
        title: 'SALES & POS',
        items: [
          { key: 'pos', label: 'POS Terminal', icon: 'fa-cash-register', href: '/sales/index.html', perm: 'sales.create', badge: 'POS' },
          { key: 'sales', label: 'Sales History', icon: 'fa-receipt', href: '/sales/list.html', perm: 'sales.view' },
          { key: 'customers', label: 'Customers', icon: 'fa-users', href: '/customers/index.html', perm: 'customers.view' },
          { key: 'invoices', label: 'Invoices', icon: 'fa-file-invoice-dollar', href: '/invoices/index.html', perm: 'invoices.view' }
        ]
      },
      {
        title: 'PURCHASING',
        items: [
          { key: 'purchases', label: 'Purchase Orders', icon: 'fa-cart-shopping', href: '/purchases/index.html', perm: 'purchases.view' },
          { key: 'suppliers', label: 'Suppliers', icon: 'fa-handshake', href: '/suppliers/index.html', perm: 'suppliers.view' }
        ]
      },
      {
        title: 'OPERATIONS',
        items: [
          { key: 'returns', label: 'Returns', icon: 'fa-rotate-left', href: '/returns/index.html', perm: 'returns.view' },
          { key: 'debts', label: 'Debts & Credit', icon: 'fa-scale-balanced', href: '/debts/index.html', perm: 'debts.view' },
          { key: 'barcode', label: 'Barcode Manager', icon: 'fa-barcode', href: '/barcode/index.html', perm: 'products.view' }
        ]
      },
      {
        title: 'FINANCE & REPORTS',
        items: [
          { key: 'expenses', label: 'Expenses', icon: 'fa-money-bill-wave', href: '/expenses/index.html', perm: 'expenses.view' },
          { key: 'payments', label: 'Payments Hub', icon: 'fa-credit-card', href: '/payments/index.html', perm: 'payments.view' },
          { key: 'reports', label: 'Reports Hub', icon: 'fa-chart-line', href: '/reports/index.html', perm: 'reports.view' }
        ]
      },
      {
        title: 'ADMINISTRATION',
        items: [
          { key: 'users', label: 'Users & Roles', icon: 'fa-user-shield', href: '/users/index.html', perm: 'users.manage' },
          { key: 'settings', label: 'System Settings', icon: 'fa-gear', href: '/settings/index.html', perm: 'settings.manage' }
        ]
      }
    ];

    // Filter items according to permissions
    let navHtml = '';
    for (const group of navGroups) {
      const allowedItems = group.items.filter(item => Auth.hasPermission(item.perm));
      if (allowedItems.length === 0) continue;

      navHtml += `
        <div class="px-4 mt-6 mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">${escapeHtml(group.title)}</div>
        <div class="space-y-1 px-3">
      `;

      for (const item of allowedItems) {
        const isActive = item.key === activeKey;
        const activeClass = isActive 
          ? 'bg-blue-600 text-white font-semibold shadow-sm shadow-blue-500/20' 
          : 'text-slate-300 hover:text-white hover:bg-slate-800/80 font-medium';

        navHtml += `
          <a href="${escapeHtml(item.href)}" class="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm transition-all group ${activeClass}">
            <div class="flex items-center space-x-3 truncate">
              <i class="fa-solid ${escapeHtml(item.icon)} text-base w-5 text-center ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}"></i>
              <span class="truncate">${escapeHtml(item.label)}</span>
            </div>
            ${item.badge ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500 text-white">${escapeHtml(item.badge)}</span>` : ''}
          </a>
        `;
      }

      navHtml += '</div>';
    }

    // Role badge color
    const roleColors = {
      'Admin': 'bg-rose-500/10 text-rose-400 border-rose-500/30',
      'Manager': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      'Sales': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      'Inventory': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      'Accountant': 'bg-sky-500/10 text-sky-400 border-sky-500/30'
    };
    const roleBadge = roleColors[user.role] || 'bg-slate-700 text-slate-300 border-slate-600';

    // Wrap the existing body in sidebar + main content wrapper
    const pageContent = container.innerHTML;

    container.innerHTML = `
      <div class="flex h-screen overflow-hidden bg-slate-50 font-sans antialiased text-slate-800">
        <!-- SIDEBAR -->
        <aside id="app-sidebar" class="fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-slate-900 border-r border-slate-800 transition-transform duration-300 -translate-x-full lg:translate-x-0 lg:static lg:inset-auto">
          <!-- Logo & Org branding -->
          <div class="flex items-center justify-between h-16 px-5 border-b border-slate-800/80 bg-slate-950/40">
            <a href="/dashboard.html" class="flex items-center space-x-3">
              <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/25">
                <i class="fa-solid fa-cubes text-lg"></i>
              </div>
              <div>
                <span class="text-base font-bold text-white tracking-tight leading-tight block">Apex Inventory</span>
                <span class="text-[10px] text-blue-400 font-medium uppercase tracking-wider block">Single Enterprise</span>
              </div>
            </a>
            <button id="close-sidebar-btn" class="lg:hidden text-slate-400 hover:text-white">
              <i class="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <!-- Navigation Links -->
          <div class="flex-1 overflow-y-auto py-2">
            ${navHtml}
          </div>

          <!-- User footer inside sidebar -->
          <div class="p-3.5 border-t border-slate-800/80 bg-slate-950/60">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3 truncate">
                <div class="w-9 h-9 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center font-bold text-sm shrink-0">
                  ${userInitial}
                </div>
                <div class="truncate">
                  <div class="text-xs font-semibold text-white truncate">${safeUserName}</div>
                  <div class="text-[11px] text-slate-400 truncate">${safeUserRole}</div>
                </div>
              </div>
              <button onclick="Auth.logout()" title="Logout" class="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800/60 transition">
                <i class="fa-solid fa-arrow-right-from-bracket"></i>
              </button>
            </div>
          </div>
        </aside>

        <!-- BACKDROP FOR MOBILE SIDEBAR -->
        <div id="sidebar-backdrop" class="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm hidden lg:hidden"></div>

        <!-- MAIN APP WRAPPER -->
        <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
          <!-- TOP NAVBAR -->
          <header class="h-16 bg-white border-b border-slate-200/80 flex items-center justify-between px-4 sm:px-6 z-10">
            <!-- Left toggle & title -->
            <div class="flex items-center space-x-4">
              <button id="open-sidebar-btn" class="p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg lg:hidden hover:bg-slate-100">
                <i class="fa-solid fa-bars text-lg"></i>
              </button>
              <div class="flex items-center space-x-2 text-sm text-slate-500">
                <a href="/dashboard.html" class="hover:text-blue-600 font-medium">Home</a>
                <i class="fa-solid fa-chevron-right text-[10px] text-slate-400"></i>
                <span class="text-slate-900 font-semibold capitalize">${safeActiveKey}</span>
              </div>
            </div>

            <!-- Right controls -->
            <div class="flex items-center space-x-3">
              <!-- Quick POS Launch Button -->
              ${Auth.hasPermission('sales.create') ? `
                <a href="/sales/index.html" class="hidden sm:inline-flex items-center px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-emerald-600/20 transition">
                  <i class="fa-solid fa-cash-register mr-2"></i> POS Register
                </a>
              ` : ''}

              <!-- Stock Alert Bell -->
              <a href="/stock/index.html?low_stock=true" title="Low Stock Alerts" class="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
                <i class="fa-solid fa-bell text-base"></i>
                <span id="topbar-lowstock-badge" class="hidden absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>
              </a>

              <div class="h-5 w-[1px] bg-slate-200"></div>

              <!-- User Profile Dropdown -->
              <div class="relative">
                <button id="user-menu-btn" class="flex items-center space-x-3 p-1.5 rounded-lg hover:bg-slate-100 transition focus:outline-none">
                  <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-bold text-xs">
                    ${userInitial}
                  </div>
                  <div class="hidden md:block text-left">
                    <span class="block text-xs font-semibold text-slate-800 leading-tight">${safeUserName}</span>
                    <span class="inline-block text-[10px] font-medium px-1.5 py-0.2 rounded border ${roleBadge}">${safeUserRole}</span>
                  </div>
                  <i class="fa-solid fa-chevron-down text-[10px] text-slate-400 hidden md:block"></i>
                </button>

                <!-- Profile Dropdown Menu -->
                <div id="user-dropdown-menu" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-50">
                  <div class="px-4 py-2 border-b border-slate-100">
                    <div class="text-xs font-bold text-slate-800">${safeUserName}</div>
                    <div class="text-[11px] text-slate-500 truncate">${safeUserEmail}</div>
                  </div>
                  <a href="/dashboard.html" class="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                    <i class="fa-solid fa-chart-pie w-5 text-slate-400"></i> Dashboard
                  </a>
                  ${Auth.hasPermission('settings.manage') ? `
                    <a href="/settings/index.html" class="flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                      <i class="fa-solid fa-gear w-5 text-slate-400"></i> Business Settings
                    </a>
                  ` : ''}
                  <button onclick="Layout.openPasswordModal()" class="w-full text-left flex items-center px-4 py-2 text-xs text-slate-700 hover:bg-slate-50">
                    <i class="fa-solid fa-key w-5 text-slate-400"></i> Change Password
                  </button>
                  <div class="border-t border-slate-100 my-1"></div>
                  <button onclick="Auth.logout()" class="w-full text-left flex items-center px-4 py-2 text-xs text-rose-600 hover:bg-rose-50">
                    <i class="fa-solid fa-arrow-right-from-bracket w-5 text-rose-500"></i> Sign Out
                  </button>
                </div>
              </div>
            </div>
          </header>

          <!-- MAIN CONTENT SCROLLABLE VIEW -->
          <main class="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
            ${pageContent}
          </main>
        </div>
      </div>

      <!-- CHANGE PASSWORD MODAL -->
      <div id="password-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm hidden">
        <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 class="text-base font-bold text-slate-900">Change Password</h3>
            <button onclick="Layout.closePasswordModal()" class="text-slate-400 hover:text-slate-600">
              <i class="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>
          <form id="change-pwd-form" class="mt-4 space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Current Password</label>
              <input type="password" id="cur-pwd-input" required class="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">New Password (Min 8 chars, letters &amp; numbers)</label>
              <input type="password" id="new-pwd-input" required minlength="8" class="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div class="flex justify-end space-x-2 pt-2">
              <button type="button" onclick="Layout.closePasswordModal()" class="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button type="submit" class="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Update Password</button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Bind sidebar events
    const openBtn = document.getElementById('open-sidebar-btn');
    const closeBtn = document.getElementById('close-sidebar-btn');
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (openBtn && sidebar && backdrop) {
      openBtn.addEventListener('click', () => {
        sidebar.classList.remove('-translate-x-full');
        backdrop.classList.remove('hidden');
      });
    }

    if (closeBtn && sidebar && backdrop) {
      closeBtn.addEventListener('click', () => {
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
      });
      backdrop.addEventListener('click', () => {
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
      });
    }

    // User dropdown toggle
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdownMenu = document.getElementById('user-dropdown-menu');
    if (userMenuBtn && userDropdownMenu) {
      userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdownMenu.classList.toggle('hidden');
      });
      document.addEventListener('click', () => {
        userDropdownMenu.classList.add('hidden');
      });
    }

    // Password form handler
    const pwdForm = document.getElementById('change-pwd-form');
    if (pwdForm) {
      pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const current_password = document.getElementById('cur-pwd-input').value;
        const new_password = document.getElementById('new-pwd-input').value;

        if (new_password.length < 8 || !/[a-zA-Z]/.test(new_password) || !/[0-9]/.test(new_password)) {
          Toast.error('Password must be at least 8 characters long and contain both letters and numbers.');
          return;
        }

        try {
          await API.put('/auth/change-password', { current_password, new_password });
          Toast.success('Password changed successfully. Please log in again.');
          Layout.closePasswordModal();
          pwdForm.reset();
          setTimeout(() => {
            Auth.logout();
          }, 1500);
        } catch (err) {
          Toast.error(err.message);
        }
      });
    }

    // Check low stock count in background for topbar badge
    checkLowStockBadge();
  }

  async function checkLowStockBadge() {
    try {
      const res = await API.get('/stock/low');
      const badge = document.getElementById('topbar-lowstock-badge');
      if (badge && res.data && res.data.length > 0) {
        badge.classList.remove('hidden');
      }
    } catch (e) {
      // Ignore background check error
    }
  }

  function openPasswordModal() {
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closePasswordModal() {
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.add('hidden');
  }

  return {
    init,
    openPasswordModal,
    closePasswordModal
  };
})();
