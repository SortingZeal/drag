// Only the view name belongs in the URL. A document and its tasks stay local.
export function syncViewAddress(view, push = false) {
  const url = new URL(location.href);
  if (view === 'tracking') url.hash = 'tracking';
  else if (url.hash === '#tracking') url.hash = '';
  if (!push && url.href === location.href && history.state?.roadmapView === view) return;
  history[push ? 'pushState' : 'replaceState']({...history.state, roadmapView: view}, '', url);
}

export function bindViewNavigation(currentView, changeView) {
  function restore() {
    const name = location.hash === '#tracking' ? 'tracking'
      : history.state?.roadmapView === 'simple' ? 'simple' : 'timeline';
    if (currentView() !== name) changeView(name);
  }
  window.addEventListener('popstate', restore);
  window.addEventListener('hashchange', restore);
  return next => {
    const previous = currentView();
    if (previous === next) return;
    if (next === 'tracking' || location.hash === '#tracking') {
      syncViewAddress(previous);
      syncViewAddress(next, true);
    } else syncViewAddress(next);
    changeView(next);
  };
}
