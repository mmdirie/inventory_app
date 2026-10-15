/**
 * Authentication and Session Management
 */
const Auth = (function() {
  function getToken() {
    return localStorage.getItem('apex_auth_token');
  }

  function getUser() {
    const userStr = localStorage.getItem('apex_auth_user');
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      return null;
    }
  }

  function setUser(user, token) {
    if (token) localStorage.setItem('apex_auth_token', token);
    if (user) localStorage.setItem('apex_auth_user', JSON.stringify(user));
  }

  function isAuthenticated() {
    return !!getToken() && !!getUser();
  }

  function hasRole(...roles) {
    const user = getUser();
    if (!user) return false;
    if (user.role === 'Admin') return true;
    return roles.includes(user.role);
  }

  function hasPermission(permission) {
    const user = getUser();
    if (!user) return false;
    if (user.role === 'Admin') return true;
    return user.permissions && user.permissions.includes(permission);
  }

  async function logout() {
    try {
      await API.post('/auth/logout');
    } catch (e) {
      // Continue client logout
    }
    localStorage.removeItem('apex_auth_token');
    localStorage.removeItem('apex_auth_user');
    window.location.href = '/login.html';
  }

  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  function formatMoney(amount, currency = '$') {
    const num = Number(amount) || 0;
    return `${currency}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return {
    getToken,
    getUser,
    setUser,
    isAuthenticated,
    hasRole,
    hasPermission,
    logout,
    requireAuth,
    formatMoney
  };
})();
