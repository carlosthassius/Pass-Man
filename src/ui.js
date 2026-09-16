export function toggleSidebar(shell, button) {
  const collapsed = shell.classList.toggle('sidebar-collapsed');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
  localStorage.setItem('passman_sidebar_collapsed', String(collapsed));
}
