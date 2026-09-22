import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeReplyPreview } from '../services/dashboardRuntime.js';

const url = 'https://www.youtube.com/watch?v=abcdefghijk';
const data = { videos: [{ video_id: 'abcdefghijk', title: 'Tutorial', author: 'Channel', video_length: '3:30' }] };
test('YouTube preview matches the linked result and attaches its thumbnail', async () => {
  const thumbnail = Buffer.from([255, 216, 255]);
  const result = await youtubeReplyPreview(url, data, async target => {
    assert.equal(target, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    return thumbnail;
  });
  assert.equal(result.title, 'Tutorial');
  assert.equal(result['canonical-url'], url);
  assert.equal(result.jpegThumbnail, thumbnail);
});
test('thumbnail failure keeps the preview and unrelated replies do not fetch', async () => {
  const fail = async () => { throw Error('offline'); };
  assert.equal((await youtubeReplyPreview(url, data, fail)).title, 'Tutorial');
  assert.equal(await youtubeReplyPreview('Hello', data, () => assert.fail('unexpected fetch')), undefined);
});
