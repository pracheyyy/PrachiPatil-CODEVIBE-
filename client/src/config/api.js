// API Configuration
// Determines the backend URL based on the current environment

/**
 * Resolves the appropriate backend server URL dynamically based on the current hostname.
 * This guarantees zero configuration setup for both local developers and production deployments.
 * 
 * @returns {string} The fully qualified base URL of the active backend server.
 */
const getBackendURL = () => {
  const hostname = window.location.hostname;

  // Check if running locally (localhost, loopback, or local IP ranges)
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("192.168.")
  ) {
    return "http://localhost:5000";
  }

  // Production backend deployed on Render
  return "https://codevibe-3.onrender.com";
};

/**
 * Centralized API base URL dynamically computed at runtime.
 * Prevents hardcoding issues across client-side requests.
 */
export const API_BASE_URL = getBackendURL();

export const createApiClient = (axios) => {
  return axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export default API_BASE_URL;
