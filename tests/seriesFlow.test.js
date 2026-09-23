import test from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { runSeriesService, selectSeriesResult, mapResponseFields, setHttpClient } from '../services/dashboardRuntime.js';
import DashboardApi from '../database/dashboardApiModel.js';

test('series search then select and poll flow (mocked)', async t => {
  // Mock service config
  const service = {
    _id: 'svc1', type: 'series', seriesConfig: {
      general: { resultLimit: 2, targetQuality: '480' },
      searchRequest: { endpoint: 'https://anime-db.p.rapidapi.com/search', queryTemplate: 'query={query}&page=1', method: 'GET' , timeoutMs: 2000},
      searchResponseMapping: { sourceUrl: 'video_link', title: 'title' },
      downloadRequest: { endpoint: 'https://anime-db-api-video-downloader.p.rapidapi.com/download_video', queryTemplate: 'url={sourceUrl}', method: 'GET', timeoutMs: 2000 },
      downloadResponseMapping: { downloadUrl: 'url' },
      processing: { initialWaitMs: 10, pollIntervalMs: 10, maxPreparationMs: 200, pendingStatusCodes: [404] }
    }
  };

  // Mock search response
  nock('https://anime-db.p.rapidapi.com').get('/search').query(true).reply(200, [{ title: 'A', video_link: 'https://src/a.mp4' }, { title: 'B', video_link: 'https://src/b.mp4' }]);
  const res = await runSeriesService(service, { query: 'x' }, undefined, 'user1');
  assert.equal(res.step, 'search');
  assert.equal(res.results.length, 2);

  // Mock download: first return 404 then 200 with url
  nock('https://anime-db-api-video-downloader.p.rapidapi.com').get('/download_video').query(true).reply(404, 'not ready').get('/download_video').query(true).reply(200, { url: 'https://cdn/final.mp4' });

  // Mock DashboardApi.findById to return the service
  t.mock.method(DashboardApi, 'findById', async () => ({ ...service, _id: 'svc1' }));

  // Mock sock
  const sent = [];
  const sock = { sendMessage: async (jid, content) => sent.push({ jid, content }) };

  // Ensure http client uses axios (nock works with axios)
  setHttpClient((await import('axios')).default);

  const out = await selectSeriesResult('user1', 0, sock, '123@g.us', { text: 'x' });
  assert.equal(out.ok, true);
  assert.equal(sent.length, 1);
  assert.ok(String(sent[0].content.video?.url || sent[0].content.video?.url).includes('https://cdn/final.mp4') || sent[0].content.video);
});
