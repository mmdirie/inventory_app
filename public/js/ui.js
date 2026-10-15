const UI = Object.freeze({
  escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  },
  money(value, currency = '$') {
    const amount = Number(value);
    return `${currency}${(Number.isFinite(amount) ? amount : 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  },
  date(value) {
    return value ? String(value).slice(0, 10) : '—';
  }
});
