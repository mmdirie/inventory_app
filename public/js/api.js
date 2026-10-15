/**
 * Centralized API Client
 */
const API = (function() {
  const BASE_URL = '/api';

  function getToken() {
    return localStorage.getItem('apex_auth_token');
  }

  async function request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const token = getToken();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      // Handle unauthenticated response
      if (response.status === 401) {
        localStorage.removeItem('apex_auth_token');
        localStorage.removeItem('apex_auth_user');
        if (!window.location.pathname.endsWith('login.html')) {
          window.location.href = '/login.html';
        }
        throw new Error('Session expired. Please log in again.');
      }

      const data = await response.json();

      if (!response.ok || data.success === false) {
        const errorMsg = data.message || `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      console.error(`API Error on [${options.method || 'GET'} ${endpoint}]:`, err);
      throw err;
    }
  }

  return {
    get: (endpoint, params = {}) => {
      const query = new URLSearchParams(params).toString();
      const url = query ? `${endpoint}?${query}` : endpoint;
      return request(url, { method: 'GET' });
    },
    post: (endpoint, body = {}) => request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    put: (endpoint, body = {}) => request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
    delete: (endpoint) => request(endpoint, { method: 'DELETE' })
  };
})();
