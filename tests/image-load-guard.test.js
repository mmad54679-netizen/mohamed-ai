const test = require('node:test');
const assert = require('node:assert/strict');
const createImageLoadGuard = require('../public/image-load-guard');

test('a prior image decode becomes stale as soon as a newer image is selected', () => {
  const guard = createImageLoadGuard();
  const first = guard.begin('blob:first-image');
  const second = guard.begin('blob:second-image');
  assert.equal(second.previousUrl, 'blob:first-image');
  assert.equal(guard.isCurrent(first.token), false);
  assert.equal(guard.isCurrent(second.token), true);
  assert.equal(guard.finish(first.token, 'blob:first-image'), false);
  assert.equal(guard.isCurrent(second.token), true);
});

test('removing an image invalidates its pending decode and returns its URL for revocation', () => {
  const guard = createImageLoadGuard();
  const pending = guard.begin('blob:pending-image');
  assert.equal(guard.invalidate(), 'blob:pending-image');
  assert.equal(guard.isCurrent(pending.token), false);
  assert.equal(guard.finish(pending.token, 'blob:pending-image'), false);
});

test('a successfully decoded image is no longer considered pending', () => {
  const guard = createImageLoadGuard();
  const image = guard.begin('blob:loaded-image');
  assert.equal(guard.finish(image.token, 'blob:loaded-image'), true);
  assert.equal(guard.invalidate(), '');
});
