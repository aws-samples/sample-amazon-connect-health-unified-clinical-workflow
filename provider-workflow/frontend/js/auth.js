// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Cognito Authentication Module
 * 
 * Handles SRP-based login against Cognito User Pool.
 * No external dependencies — pure browser JS with Web Crypto API.
 * 
 * Usage:
 *   1. Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID in config
 *   2. Call CognitoAuth.init() on page load
 *   3. Tokens are automatically attached to all fetch() calls
 */

window.CognitoAuth = (function() {
    'use strict';

    // Config — set from config.js
    let USER_POOL_ID = '';
    let CLIENT_ID = '';
    let REGION = 'us-east-1';

    // Token storage (persisted in localStorage for session continuity)
    let idToken = null;
    let accessToken = null;
    let refreshToken = null;
    let tokenExpiry = 0;

    // =========================================================================
    // Cognito API calls
    // =========================================================================
    async function cognitoRequest(action, body) {
        const url = `https://cognito-idp.${REGION}.amazonaws.com/`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || data.__type || 'Cognito request failed');
        }
        return data;
    }

    // =========================================================================
    // Login flow
    // =========================================================================
    async function login(email, password) {
        // Use USER_PASSWORD_AUTH flow — password sent over HTTPS to Cognito directly.
        // Simpler and more reliable than SRP for a demo application.
        const result = await cognitoRequest('InitiateAuth', {
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: CLIENT_ID,
            AuthParameters: {
                USERNAME: email,
                PASSWORD: password
            }
        });

        if (result.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            return { challenge: 'NEW_PASSWORD_REQUIRED', session: result.Session, username: email };
        }

        if (result.AuthenticationResult) {
            _storeTokens(result.AuthenticationResult);
            return { success: true };
        }

        throw new Error('Authentication failed');
    }

    async function completeNewPassword(username, newPassword, session) {
        const result = await cognitoRequest('RespondToAuthChallenge', {
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            ClientId: CLIENT_ID,
            Session: session,
            ChallengeResponses: {
                USERNAME: username,
                NEW_PASSWORD: newPassword
            }
        });

        if (result.AuthenticationResult) {
            _storeTokens(result.AuthenticationResult);
            return { success: true };
        }

        throw new Error('Password change failed');
    }

    function _storeTokens(authResult) {
        idToken = authResult.IdToken;
        accessToken = authResult.AccessToken;
        refreshToken = authResult.RefreshToken || refreshToken;
        // Decode expiry from ID token
        try {
            const payload = JSON.parse(atob(idToken.split('.')[1]));
            tokenExpiry = payload.exp * 1000; // ms
        } catch (e) {
            tokenExpiry = Date.now() + 3600000; // 1 hour fallback
        }
        // Persist to localStorage so tokens survive page reload
        try {
            localStorage.setItem('cognito_id_token', idToken);
            localStorage.setItem('cognito_access_token', accessToken);
            if (refreshToken) localStorage.setItem('cognito_refresh_token', refreshToken);
            localStorage.setItem('cognito_token_expiry', String(tokenExpiry));
        } catch (e) { /* localStorage unavailable */ }
    }

    function _loadStoredTokens() {
        try {
            idToken = localStorage.getItem('cognito_id_token');
            accessToken = localStorage.getItem('cognito_access_token');
            refreshToken = localStorage.getItem('cognito_refresh_token');
            tokenExpiry = parseInt(localStorage.getItem('cognito_token_expiry') || '0', 10);
        } catch (e) { /* localStorage unavailable */ }
    }

    async function refreshSession() {
        if (!refreshToken) return false;
        try {
            const result = await cognitoRequest('InitiateAuth', {
                AuthFlow: 'REFRESH_TOKEN_AUTH',
                ClientId: CLIENT_ID,
                AuthParameters: {
                    REFRESH_TOKEN: refreshToken
                }
            });
            if (result.AuthenticationResult) {
                _storeTokens(result.AuthenticationResult);
                return true;
            }
        } catch (e) {
            console.log('[Auth] Refresh failed:', e.message);
        }
        return false;
    }

    function getToken() {
        return idToken;
    }

    function isAuthenticated() {
        return idToken && Date.now() < tokenExpiry;
    }

    function logout() {
        idToken = null;
        accessToken = null;
        refreshToken = null;
        tokenExpiry = 0;
        try {
            localStorage.removeItem('cognito_id_token');
            localStorage.removeItem('cognito_access_token');
            localStorage.removeItem('cognito_refresh_token');
            localStorage.removeItem('cognito_token_expiry');
        } catch (e) { /* localStorage unavailable */ }
        showLoginScreen();
    }

    // =========================================================================
    // Login UI
    // =========================================================================
    function showLoginScreen() {
        // Hide the app
        document.getElementById('scheduleScreen').style.display = 'none';

        // Remove existing login screen if any
        const existing = document.getElementById('cognitoLoginScreen');
        if (existing) existing.remove();

        const loginHTML = `
        <div id="cognitoLoginScreen" style="
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
            display: flex; align-items: center; justify-content: center;
            z-index: 100000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        ">
            <div style="
                background: white; border-radius: 16px; padding: 40px;
                width: 400px; max-width: 90vw; box-shadow: 0 25px 50px rgba(0,0,0,0.3);
            ">
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 14px; color: #64748b; letter-spacing: 0.5px; margin-bottom: 8px;">
                        AMAZON CONNECT HEALTH
                    </div>
                    <div style="font-size: 22px; font-weight: 600; color: #1e293b;">
                        Sign in
                    </div>
                </div>

                <div id="loginForm">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 13px; font-weight: 500; color: #475569; margin-bottom: 6px;">
                            Email
                        </label>
                        <input id="loginEmail" type="email" autocomplete="username" style="
                            width: 100%; padding: 10px 14px; border: 1px solid #d1d5db;
                            border-radius: 8px; font-size: 14px; outline: none;
                            transition: border-color 0.15s;
                        " onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#d1d5db'"
                        placeholder="you@example.com">
                    </div>

                    <div style="margin-bottom: 24px;">
                        <label style="display: block; font-size: 13px; font-weight: 500; color: #475569; margin-bottom: 6px;">
                            Password
                        </label>
                        <input id="loginPassword" type="password" autocomplete="current-password" style="
                            width: 100%; padding: 10px 14px; border: 1px solid #d1d5db;
                            border-radius: 8px; font-size: 14px; outline: none;
                            transition: border-color 0.15s;
                        " onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#d1d5db'"
                        placeholder="Enter your password">
                    </div>

                    <div id="loginError" style="
                        display: none; background: #fef2f2; color: #dc2626;
                        padding: 10px 14px; border-radius: 8px; font-size: 13px;
                        margin-bottom: 16px; border: 1px solid #fecaca;
                    "></div>

                    <button id="loginBtn" onclick="CognitoAuth._handleLogin()" style="
                        width: 100%; padding: 12px; background: #2563eb; color: white;
                        border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
                        cursor: pointer; transition: background 0.15s;
                    " onmouseover="this.style.background='#1d4ed8'" onmouseout="this.style.background='#2563eb'">
                        Sign in
                    </button>
                </div>

                <!-- New Password Form (hidden by default) -->
                <div id="newPasswordForm" style="display: none;">
                    <div style="
                        background: #eff6ff; color: #1e40af; padding: 10px 14px;
                        border-radius: 8px; font-size: 13px; margin-bottom: 16px;
                        border: 1px solid #bfdbfe;
                    ">
                        You must set a new password before continuing.
                    </div>

                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 13px; font-weight: 500; color: #475569; margin-bottom: 6px;">
                            New Password
                        </label>
                        <input id="newPassword" type="password" autocomplete="new-password" style="
                            width: 100%; padding: 10px 14px; border: 1px solid #d1d5db;
                            border-radius: 8px; font-size: 14px; outline: none;
                        " placeholder="At least 8 characters">
                    </div>

                    <div style="margin-bottom: 24px;">
                        <label style="display: block; font-size: 13px; font-weight: 500; color: #475569; margin-bottom: 6px;">
                            Confirm Password
                        </label>
                        <input id="confirmPassword" type="password" autocomplete="new-password" style="
                            width: 100%; padding: 10px 14px; border: 1px solid #d1d5db;
                            border-radius: 8px; font-size: 14px; outline: none;
                        " placeholder="Confirm your password">
                    </div>

                    <div id="newPwError" style="
                        display: none; background: #fef2f2; color: #dc2626;
                        padding: 10px 14px; border-radius: 8px; font-size: 13px;
                        margin-bottom: 16px; border: 1px solid #fecaca;
                    "></div>

                    <button id="newPwBtn" onclick="CognitoAuth._handleNewPassword()" style="
                        width: 100%; padding: 12px; background: #2563eb; color: white;
                        border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
                        cursor: pointer;
                    ">
                        Set Password & Sign In
                    </button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', loginHTML);

        // Enter key handlers
        document.getElementById('loginPassword').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') CognitoAuth._handleLogin();
        });
        document.getElementById('loginEmail').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') document.getElementById('loginPassword').focus();
        });

        setTimeout(() => document.getElementById('loginEmail').focus(), 100);
    }

    // Stored challenge state for new password flow
    let _challengeSession = null;
    let _challengeUsername = null;

    async function _handleLogin() {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        const btn = document.getElementById('loginBtn');

        if (!email || !password) {
            errorEl.textContent = 'Please enter your email and password.';
            errorEl.style.display = 'block';
            return;
        }

        btn.textContent = 'Signing in...';
        btn.disabled = true;
        errorEl.style.display = 'none';

        try {
            const result = await login(email, password);

            if (result.challenge === 'NEW_PASSWORD_REQUIRED') {
                _challengeSession = result.session;
                _challengeUsername = result.username;
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('newPasswordForm').style.display = 'block';
                document.getElementById('newPassword').focus();
                return;
            }

            if (result.success) {
                _onLoginSuccess();
            }
        } catch (e) {
            errorEl.textContent = e.message;
            errorEl.style.display = 'block';
        } finally {
            btn.textContent = 'Sign in';
            btn.disabled = false;
        }
    }

    async function _handleNewPassword() {
        const newPw = document.getElementById('newPassword').value;
        const confirmPw = document.getElementById('confirmPassword').value;
        const errorEl = document.getElementById('newPwError');
        const btn = document.getElementById('newPwBtn');

        if (newPw !== confirmPw) {
            errorEl.textContent = 'Passwords do not match.';
            errorEl.style.display = 'block';
            return;
        }

        if (newPw.length < 8) {
            errorEl.textContent = 'Password must be at least 8 characters.';
            errorEl.style.display = 'block';
            return;
        }

        btn.textContent = 'Setting password...';
        btn.disabled = true;
        errorEl.style.display = 'none';

        try {
            const result = await completeNewPassword(_challengeUsername, newPw, _challengeSession);
            if (result.success) {
                _onLoginSuccess();
            }
        } catch (e) {
            errorEl.textContent = e.message;
            errorEl.style.display = 'block';
        } finally {
            btn.textContent = 'Set Password & Sign In';
            btn.disabled = false;
        }
    }

    function _onLoginSuccess() {
        const loginScreen = document.getElementById('cognitoLoginScreen');
        if (loginScreen) loginScreen.remove();
        document.getElementById('scheduleScreen').style.display = '';
        // Show logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.style.display = '';
        // Start token refresh timer
        _startRefreshTimer();
        // Load patients (handles restored sessions where MutationObserver won't fire)
        if (typeof loadPatientsFromHealthLake === 'function') {
            loadPatientsFromHealthLake();
        }
    }

    function _startRefreshTimer() {
        // Refresh 5 minutes before expiry
        const refreshIn = Math.max((tokenExpiry - Date.now()) - 300000, 60000);
        setTimeout(async () => {
            const ok = await refreshSession();
            if (ok) {
                _startRefreshTimer();
            } else {
                logout();
            }
        }, refreshIn);
    }

    // =========================================================================
    // Fetch interceptor — attach token to all /api/ calls
    // =========================================================================
    function installFetchInterceptor() {
        const _originalFetch = window._originalFetch || window.fetch;
        window._originalFetch = _originalFetch;

        window.fetch = async function(url, options) {
            if (typeof url === 'string' && url.includes('/api/') && idToken) {
                options = options || {};
                options.headers = options.headers || {};
                if (options.headers instanceof Headers) {
                    options.headers.set('Authorization', 'Bearer ' + idToken);
                } else {
                    options.headers['Authorization'] = 'Bearer ' + idToken;
                }
            }
            const response = await _originalFetch.call(this, url, options);

            // If we get a 401, try refreshing the token once
            if (response.status === 401 && refreshToken && typeof url === 'string' && url.includes('/api/')) {
                const refreshed = await refreshSession();
                if (refreshed) {
                    // Retry with new token
                    if (options.headers instanceof Headers) {
                        options.headers.set('Authorization', 'Bearer ' + idToken);
                    } else {
                        options.headers['Authorization'] = 'Bearer ' + idToken;
                    }
                    return _originalFetch.call(this, url, options);
                } else {
                    logout();
                }
            }
            return response;
        };
    }

    // =========================================================================
    // Init
    // =========================================================================
    function init(config) {
        USER_POOL_ID = config.userPoolId || '';
        CLIENT_ID = config.clientId || '';
        REGION = config.region || 'us-east-1';

        if (!USER_POOL_ID || USER_POOL_ID.startsWith('YOUR_') || !CLIENT_ID || CLIENT_ID.startsWith('YOUR_')) {
            console.log('[Auth] Cognito not configured — authentication disabled');
            return;
        }

        console.log('[Auth] Cognito authentication enabled');

        // Install fetch interceptor
        installFetchInterceptor();

        // Try to restore session from localStorage
        _loadStoredTokens();
        if (isAuthenticated()) {
            console.log('[Auth] Restored session from localStorage');
            _onLoginSuccess();
            return;
        }

        // Try refreshing with stored refresh token
        if (refreshToken) {
            refreshSession().then(ok => {
                if (ok) {
                    console.log('[Auth] Session refreshed from stored refresh token');
                    _onLoginSuccess();
                } else {
                    showLoginScreen();
                }
            });
            return;
        }

        // No stored session — show login
        showLoginScreen();
    }

    function isEnabled() {
        return !!(USER_POOL_ID && CLIENT_ID);
    }

    // Public API
    return {
        init,
        login,
        logout,
        getToken,
        isAuthenticated,
        isEnabled,
        refreshSession,
        completeNewPassword,
        showLoginScreen,
        // Exposed for onclick handlers in the login HTML
        _handleLogin: _handleLogin,
        _handleNewPassword: _handleNewPassword
    };
})();
