// Pick a bar that can be hit without moving the zoomed or panned viewport.
export async function openVisiblePictureTask(page) {
  const target = await page.locator('.picture-viewport').evaluate(viewport => {
    const window = viewport.getBoundingClientRect();
    for (const bar of viewport.querySelectorAll('[data-role="phase-bar"]')) {
      const rect = bar.getBoundingClientRect();
      const left=Math.max(rect.left,window.left),right=Math.min(rect.right,window.right);
      const top=Math.max(rect.top,window.top),bottom=Math.min(rect.bottom,window.bottom);
      if(right-left<6||bottom-top<3) continue;
      const x=(left+right)/2,y=(top+bottom)/2;
      const item=bar.closest('[data-phase-index]');
      if(document.elementFromPoint(x,y)?.closest('[data-phase-index]') === item)
        return {x,y,project:Number(item.closest('[data-project-index]').dataset.projectIndex),phase:Number(item.dataset.phaseIndex)};
    }
    throw new Error('No task bar can be clicked in the current picture viewport');
  });
  await page.mouse.click(target.x,target.y);
  return target;
}
