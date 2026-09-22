import test from 'node:test';
import assert from 'node:assert/strict';
import { realTimeAnimeThumbnails } from '../utils/imageSearch.js';

test('welcome images select large thumbnails with anime context only', () => {
    assert.deepEqual(realTimeAnimeThumbnails({ data: [
        { title: 'Saitama anime character', url: 'https://example.com/small.jpg', thumbnail_url: 'https://example.com/large.jpg' },
        { title: 'Anime fork kitchen', thumbnail_url: 'https://example.com/fork.jpg' },
        { title: 'Anime character', url: 'https://example.com/url-only.jpg' },
        { title: 'Anime character', thumbnail_url: 'http://example.com/insecure.jpg' }
    ] }), ['https://example.com/large.jpg']);
    assert.deepEqual(realTimeAnimeThumbnails('<html>error</html>'), []);
});
