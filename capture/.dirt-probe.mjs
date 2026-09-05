import { openLab } from './session.mjs';

const lab = await openLab({
  width: 300,
  height: 300,
  entry: '/ghostly/',
  query: 'test=1&scene=chase&view=2.6',
  readyFlag: '__ghostReady',
  readyTimeout: 90000,
  verbose: true,
});
console.log('ready, renderer', lab.renderer);
const s = await lab.page.evaluate(() => {
  const perf = (window.__skeletons || [])[0];
  return perf ? perf.metrics().dirt : 'no skeleton';
});
console.log('dirt', JSON.stringify(s));
await lab.close();
