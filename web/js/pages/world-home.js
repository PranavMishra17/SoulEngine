/**
 * world-home.js
 *
 * Handler for the project home route (/projects/:projectId). The home view IS
 * the world: this handler just clears any previous page out of #main-content
 * and sets the project nav. The persistent world canvas is mounted/shown by
 * world-shell.js via the router.afterEach hook wired in app.js.
 */

import { updateNav, projectNav } from '../components.js';

export async function initWorldHome(params) {
  const { projectId } = params;
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = '';
  updateNav(projectNav(projectId, 'world'));
}
