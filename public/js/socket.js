let socket = null;

function initRealtime() {
  const token = localStorage.getItem('accessToken');
  if (!token) return;

  socket = io({ auth: { token } });
  const pulse = document.getElementById('live-pulse');
  const label = document.getElementById('live-pulse-label');

  socket.on('connect', () => {
    pulse.classList.remove('offline');
    label.textContent = 'Realtime aktif';
  });
  socket.on('disconnect', () => {
    pulse.classList.add('offline');
    label.textContent = 'Terputus';
  });
  socket.on('connect_error', () => {
    pulse.classList.add('offline');
    label.textContent = 'Terputus';
  });

  // Dashboard stats push
  socket.on('dashboard:stats', (stats) => {
    window.dispatchEvent(new CustomEvent('hris:stats', { detail: stats }));
  });

  // Live attendance table push
  socket.on('attendance:event', (evt) => {
    window.dispatchEvent(new CustomEvent('hris:attendance-event', { detail: evt }));
    toast(`${evt.employeeName} ${evt.type === 'check_in' ? 'check-in' : 'check-out'}`, 'success');
  });

  socket.on('leave:event', (evt) => {
    window.dispatchEvent(new CustomEvent('hris:leave-event', { detail: evt }));
  });

  socket.on('overtime:event', (evt) => {
    window.dispatchEvent(new CustomEvent('hris:overtime-event', { detail: evt }));
  });

  socket.on('notification:new', (n) => {
    window.dispatchEvent(new CustomEvent('hris:notification', { detail: n }));
    refreshUnreadCount();
  });

  socket.on('announcement:new', (a) => {
    toast(`Pengumuman: ${a.title}`, 'info');
    window.dispatchEvent(new CustomEvent('hris:announcement', { detail: a }));
  });
}

async function refreshUnreadCount() {
  try {
    const { count } = await api('/notifications/unread-count');
    const badge = document.getElementById('notif-count');
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* ignore */ }
}
