import worker from './worker.mjs';
import { handleRss } from './rss.mjs';

export { ReaderBudget } from './budget-do.mjs';
export default { fetch(request, env, ctx) {
  return new URL(request.url).pathname === '/rss'
    ? handleRss(request, env, ctx)
    : worker.fetch(request, env, ctx);
}};
