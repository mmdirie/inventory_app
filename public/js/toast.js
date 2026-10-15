/**
 * Toast Notification Utility
 */
const Toast = (function() {
  function getContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type = 'info', duration = 3500) {
    const container = getContainer();

    const toast = document.createElement('div');
    toast.className = 'toast flex items-center p-4 min-w-[300px] max-w-md rounded-xl shadow-xl text-sm border';

    let icon = 'fa-info-circle';
    let bg = 'bg-slate-900 text-white border-slate-800';

    if (type === 'success') {
      icon = 'fa-circle-check';
      bg = 'bg-emerald-600 text-white border-emerald-500';
    } else if (type === 'error') {
      icon = 'fa-circle-exclamation';
      bg = 'bg-rose-600 text-white border-rose-500';
    } else if (type === 'warning') {
      icon = 'fa-triangle-exclamation';
      bg = 'bg-amber-600 text-white border-amber-500';
    }

    toast.className += ` ${bg}`;
    toast.innerHTML = `
      <i class="fa-solid ${icon} text-lg mr-3"></i>
      <div class="toast-message flex-1 font-medium leading-snug"></div>
      <button class="ml-3 text-white/80 hover:text-white focus:outline-none" onclick="this.parentElement.remove()">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    toast.querySelector('.toast-message').textContent = String(message);

    container.appendChild(toast);

    // Trigger enter animation
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    // Auto dismiss
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentElement) toast.remove();
      }, 300);
    }, duration);
  }

  return {
    success: (msg, dur) => show(msg, 'success', dur),
    error: (msg, dur) => show(msg, 'error', dur),
    warning: (msg, dur) => show(msg, 'warning', dur),
    info: (msg, dur) => show(msg, 'info', dur)
  };
})();
