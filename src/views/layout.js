const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo',
  'America/Mexico_City', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Zurich', 'Europe/Moscow',
  'Europe/Istanbul', 'Europe/Warsaw', 'Europe/Athens',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai',
  'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
];

const { escapeHtml } = require('../utils/html');

const BASE_LAYOUT = (title, body, isAdmin = false, activeNav = '', isBookingPage = false) => {
  const bodyClass = isBookingPage ? ' class="booking-page"' : '';
  const content = isAdmin ? `
<div class="app-layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <img src="/img/icon.svg" alt="" class="sidebar-logo-icon">
      <img src="/img/wordmark.svg" alt="Logo" class="sidebar-logo-wordmark">
    </div>
    <div class="sidebar-create">
      <a href="/admin/profiles/new" class="profile-overlay-trigger" data-url="/admin/profiles/new?partial=1"><i class="ph ph-plus"></i> Create</a>
    </div>
    <nav class="sidebar-nav">
      <a href="/admin/dashboard" class="${activeNav === 'dashboard' ? 'nav-active' : ''}"><i class="ph-fill ph-squares-four"></i> Dashboard</a>
      <a href="/admin/bookings" class="${activeNav === 'bookings' ? 'nav-active' : ''}"><i class="ph-fill ph-calendar-check"></i> Meetings</a>
      <a href="/admin/profiles" class="${activeNav === 'profiles' ? 'nav-active' : ''}"><i class="ph-fill ph-user"></i> Profiles</a>
      <a href="/admin/calendars" class="${activeNav === 'calendars' ? 'nav-active' : ''}"><i class="ph-fill ph-calendar-plus"></i> Calendars</a>
      <a href="/admin/settings" class="${activeNav === 'settings' ? 'nav-active' : ''}"><i class="ph-fill ph-gear"></i> Settings</a>
    </nav>
    <div class="sidebar-footer">
      <a href="#" onclick="event.preventDefault(); AppModal.confirm('Are you sure you want to logout?', function(){ window.location.href='/admin/logout'; }, {title:'Logout', confirmText:'Logout', icon:'<i class=\\'ph-fill ph-sign-out\\' style=\\'font-size:32px;color:var(--primary)\\'></i>'});"><i class="ph-fill ph-sign-out"></i> Logout</a>
    </div>
  </aside>
  <main class="main-content">
    <div class="content-wrapper">
      ${body}
    </div>
  </main>
</div>
` : isBookingPage ? `
  ${body}
` : `
  <main class="container">
    ${body}
  </main>
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${isBookingPage ? '<meta name="booking-page" content="1">' : ''}
  <script>
    (function(){var isBooking=document.querySelector('meta[name="booking-page"]');var key=isBooking?'booking-theme':'theme';var t=localStorage.getItem(key);if(t==='dark')document.documentElement.setAttribute('data-theme','dark');})();
  </script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Lumi</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="/css/styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css" media="print" onload="this.media='all'">
  <link rel="stylesheet" type="text/css" href="https://npmcdn.com/flatpickr/dist/themes/airbnb.css" media="print" onload="this.media='all'">
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
</head>
<body${bodyClass}>
  <div id="toast-container" class="toast-container"></div>
  ${content}
  ${isAdmin ? `<div id="profile-overlay" class="profile-overlay" style="display:none">
    <div class="profile-overlay-backdrop"></div>
    <div class="profile-overlay-panel">
      <div class="profile-overlay-content" id="profile-overlay-content"></div>
    </div>
  </div>` : ''}
  <div id="app-modal-overlay" class="app-modal-overlay" style="display:none">
    <div class="app-modal">
      <div class="app-modal-icon" id="app-modal-icon"></div>
      <div class="app-modal-title" id="app-modal-title"></div>
      <div class="app-modal-message" id="app-modal-message"></div>
      <div class="app-modal-actions" id="app-modal-actions"></div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof flatpickr !== 'undefined') {
        window.initTimePickers = function() {
          var tf = (typeof APP_TIME_FORMAT !== 'undefined') ? APP_TIME_FORMAT : (localStorage.getItem('timeFormat') || '12h');
          flatpickr(".time-picker:not(.flatpickr-input)", {
            enableTime: true,
            noCalendar: true,
            dateFormat: "H:i",
            altInput: true,
            altFormat: tf === '24h' ? "H:i" : "h:i K",
            time_24hr: tf === '24h',
            minuteIncrement: 1
          });
        };
        window.initTimePickers();
      }
    });

    window.AppModal = {
      show: function(opts) {
        var overlay = document.getElementById('app-modal-overlay');
        var icon = document.getElementById('app-modal-icon');
        var title = document.getElementById('app-modal-title');
        var message = document.getElementById('app-modal-message');
        var actions = document.getElementById('app-modal-actions');

        icon.innerHTML = opts.icon || '<i class="ph-fill ph-warning" style="font-size:32px;color:var(--warning)"></i>';
        title.textContent = opts.title || '';
        message.textContent = opts.message || '';
        actions.innerHTML = '';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'app-modal-btn app-modal-btn-cancel';
        cancelBtn.textContent = opts.cancelText || 'Cancel';
        cancelBtn.onclick = function() { AppModal.hide(); if (opts.onCancel) opts.onCancel(); };
        actions.appendChild(cancelBtn);

        if (opts.onConfirm) {
          var confirmBtn = document.createElement('button');
          confirmBtn.className = 'app-modal-btn app-modal-btn-confirm' + (opts.danger ? ' danger' : '');
          confirmBtn.textContent = opts.confirmText || 'Confirm';
          confirmBtn.onclick = function() { AppModal.hide(); opts.onConfirm(); };
          actions.appendChild(confirmBtn);
        } else {
          cancelBtn.textContent = opts.cancelText || 'OK';
        }

        overlay.style.display = 'flex';
        overlay.style.opacity = '0';
        requestAnimationFrame(function() { overlay.style.opacity = '1'; });
        (opts.onConfirm ? actions.querySelector('.app-modal-btn-confirm') : cancelBtn).focus();
      },
      hide: function() {
        var overlay = document.getElementById('app-modal-overlay');
        overlay.style.opacity = '0';
        setTimeout(function() { overlay.style.display = 'none'; overlay.style.opacity = ''; }, 180);
      },
      confirm: function(message, callback, opts) {
        opts = opts || {};
        AppModal.show({
          icon: opts.icon || '<i class="ph-fill ph-warning" style="font-size:32px;color:var(--warning)"></i>',
          title: opts.title || 'Confirm',
          message: message,
          confirmText: opts.confirmText || 'Confirm',
          cancelText: opts.cancelText || 'Cancel',
          danger: opts.danger || false,
          onConfirm: callback
        });
      },
      alert: function(message, opts) {
        opts = opts || {};
        AppModal.show({
          icon: opts.icon || '<i class="ph-fill ph-info" style="font-size:32px;color:var(--primary)"></i>',
          title: opts.title || 'Notice',
          message: message,
          cancelText: 'OK'
        });
      }
    };

    document.getElementById('app-modal-overlay').addEventListener('click', function(e) {
      if (e.target === this) AppModal.hide();
    });

    // Profile overlay (global — works from any page)
    (function() {
      var overlay = document.getElementById('profile-overlay');
      if (!overlay) return;
      var content = document.getElementById('profile-overlay-content');

      function openOverlay(url) {
        overlay.style.display = 'flex';
        overlay.style.opacity = '0';
        requestAnimationFrame(function() { overlay.style.opacity = '1'; });
        content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:64px;"><i class="ph-bold ph-spinner loading" style="font-size:24px;opacity:0.5;"></i></div>';
        document.body.style.overflow = 'hidden';
        fetch(url)
          .then(function(res) { return res.text(); })
          .then(function(html) {
            content.innerHTML = html;
            content.querySelectorAll('script').forEach(function(oldScript) {
              var newScript = document.createElement('script');
              newScript.textContent = oldScript.textContent;
              oldScript.parentNode.replaceChild(newScript, oldScript);
            });
            if (window.initTimePickers) window.initTimePickers();
          });
      }

      function closeOverlay() {
        overlay.style.opacity = '0';
        setTimeout(function() {
          overlay.style.display = 'none';
          overlay.style.opacity = '';
          content.innerHTML = '';
          document.body.style.overflow = '';
        }, 200);
      }

      document.addEventListener('click', function(e) {
        var trigger = e.target.closest('.profile-overlay-trigger');
        if (trigger) {
          e.preventDefault();
          document.querySelectorAll('.dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
          openOverlay(trigger.dataset.url || trigger.getAttribute('href') + '?partial=1');
        }
      });

      overlay.querySelector('.profile-overlay-backdrop').addEventListener('click', closeOverlay);

      document.addEventListener('click', function(e) {
        if (e.target.closest('#profile-overlay') && e.target.closest('a[href="/admin/profiles"]')) {
          e.preventDefault();
          closeOverlay();
        }
      });

      document.addEventListener('submit', function(e) {
        var form = e.target;
        if (!form.closest('#profile-overlay')) return;
        if (form.id === 'delete-profile-form') return;
        e.preventDefault();
        var formData = new FormData(form);
        fetch(form.action + (form.action.includes('?') ? '&' : '?') + 'partial=1', {
          method: 'POST',
          body: new URLSearchParams(formData),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          redirect: 'manual'
        }).then(function(res) {
          if (res.status === 0 || res.type === 'opaqueredirect' || res.status === 302 || res.status === 303) {
            closeOverlay();
            window.location.reload();
          } else {
            return res.text();
          }
        }).then(function(html) {
          if (html) {
            content.innerHTML = html;
            content.querySelectorAll('script').forEach(function(oldScript) {
              var newScript = document.createElement('script');
              newScript.textContent = oldScript.textContent;
              oldScript.parentNode.replaceChild(newScript, oldScript);
            });
            if (window.initTimePickers) window.initTimePickers();
          }
        });
      });

      window.ProfileOverlay = { open: openOverlay, close: closeOverlay };
    })();

    // Toast notification system
    window.Toast = {
      _timeout: null,
      show: function(message, type) {
        type = type || 'error';
        var container = document.getElementById('toast-container');
        container.innerHTML = '';
        clearTimeout(this._timeout);
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        var icon = type === 'success' ? '<i class="ph-fill ph-check-circle"></i>' : type === 'warning' ? '<i class="ph-fill ph-warning"></i>' : '<i class="ph-fill ph-x-circle"></i>';
        toast.innerHTML = icon + '<span>' + message + '</span>';
        container.appendChild(toast);
        requestAnimationFrame(function() { toast.classList.add('toast-visible'); });
        this._timeout = setTimeout(function() { Toast.dismiss(toast); }, 4000);
      },
      dismiss: function(toast) {
        if (!toast) return;
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-hiding');
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
      }
    };

    // Auto-convert inline alerts to toasts
    document.addEventListener('DOMContentLoaded', function() {
      var alerts = document.querySelectorAll('[role="alert"], .login-card .error');
      alerts.forEach(function(el) {
        var text = el.textContent.trim();
        if (!text) return;
        var type = el.classList.contains('success') ? 'success' : el.classList.contains('warning') ? 'warning' : 'error';
        el.style.display = 'none';
        Toast.show(text, type);
      });

      // AJAX form submit for login/register
      var loginForm = document.querySelector('.login-card form[method="POST"]');
      if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
          e.preventDefault();
          var form = this;
          var btn = form.querySelector('button[type="submit"]');
          btn.disabled = true;
          fetch(form.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            body: new URLSearchParams(new FormData(form))
          }).then(function(res) { return res.json().then(function(data) { return { status: res.status, data: data }; }); })
            .then(function(result) {
              btn.disabled = false;
              if (result.data.redirect) { window.location.href = result.data.redirect; return; }
              if (result.data.error) { Toast.show(result.data.error, 'error'); }
            }).catch(function() { btn.disabled = false; Toast.show('Something went wrong. Please try again.', 'error'); });
        });
      }
    });
  </script>
</body>
</html>`;
};

module.exports = { BASE_LAYOUT, escapeHtml, TIMEZONES };
