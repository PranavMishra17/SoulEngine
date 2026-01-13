/**
 * Simple client-side router for Evolve.NPC
 */

class Router {
  constructor() {
    this.routes = [];
    this.currentRoute = null;
    this.params = {};

    // Listen for popstate (back/forward buttons)
    window.addEventListener('popstate', () => this.handleRoute());

    // Intercept link clicks
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && link.href && link.href.startsWith(window.location.origin)) {
        const url = new URL(link.href);
        if (!url.hash && url.pathname !== window.location.pathname) {
          e.preventDefault();
          this.navigate(url.pathname);
        }
      }
    });
  }

  /**
   * Register a route
   */
  on(path, handler) {
    // Convert path pattern to regex
    const paramNames = [];
    const pattern = path.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const regex = new RegExp(`^${pattern}$`);

    this.routes.push({ path, regex, paramNames, handler });
    return this;
  }

  /**
   * Navigate to a path
   */
  navigate(path, replace = false) {
    if (replace) {
      history.replaceState(null, '', path);
    } else {
      history.pushState(null, '', path);
    }
    this.handleRoute();
  }

  /**
   * Handle the current route
   */
  async handleRoute() {
    const path = window.location.pathname;

    for (const route of this.routes) {
      const match = path.match(route.regex);
      if (match) {
        // Extract params
        this.params = {};
        route.paramNames.forEach((name, index) => {
          this.params[name] = match[index + 1];
        });

        this.currentRoute = route.path;

        // Call handler
        try {
          await route.handler(this.params);
        } catch (error) {
          console.error('Route handler error:', error);
        }
        return;
      }
    }

    // No route matched - just log it, don't navigate to prevent infinite loops
    console.warn('No route matched:', path);
    // Don't call navigate here - it causes infinite recursion if '/' also doesn't match
  }

  /**
   * Get current params
   */
  getParams() {
    return { ...this.params };
  }

  /**
   * Start the router
   */
  start() {
    this.handleRoute();
    return this;
  }
}

// Export singleton
export const router = new Router();
export default router;
