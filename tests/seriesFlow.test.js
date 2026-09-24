import test from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import dns from 'node:dns/promises';
import { readFile, access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { sendPreparedSeriesVideo, sendPreparedSeriesMedia, seriesRequestUrl } from '../services/dashboardRuntime.js';
import { runSeriesService, selectSeriesResult, getSeriesSession, setHttpClient } from '../services/dashboardRuntime.js';
import DashboardApi from '../database/dashboardApiModel.js';
import DashboardCommand from '../database/dashboardCommandModel.js';

test('series search then select and poll flow (mocked)', async t => {
  t.mock.method(dns, 'lookup', async () => [{address:'93.184.216.34',family:4}]);
  t.after(() => nock.cleanAll());
  // Mock service config
  const service = {
    _id: 'svc1', enabled: true, type: 'series', seriesConfig: {
      general: { resultLimit: 2, targetQuality: '480' },
      searchRequest: { endpoint: 'https://anime-db.p.rapidapi.com/search', queryTemplate: 'query={query}&page=1', method: 'GET' , timeoutMs: 2000},
      searchResponseMapping: { videoId: 'video_id', title: 'title' },
      downloadRequest: { endpoint: 'https://youtube-video-fast-downloader-24-7.p.rapidapi.com/download_video/{videoId}', queryTemplate: 'quality=247', method: 'GET', timeoutMs: 2000 },
      downloadResponseMapping: { downloadUrl: 'file' },
      processing: { initialWaitMs: 1, pollIntervalMs: 1, maxPreparationMs: 2000, pendingStatusCodes: [404] }
    }
  };

  // Mock search response
  nock('https://anime-db.p.rapidapi.com').get('/search').query({query:'x',page:'1'}).reply(200, {videos:[{ title: 'A', video_id: 'T5OlEM7pfC4' }, { title: 'B', video_id: 'abcdefghijk' }]});
  const res = await runSeriesService(service, { query: 'x' }, undefined, 'user1', '123@g.us', 'cmd1');
  assert.equal(res.step, 'search');
  assert.equal(res.results.length, 2);
  assert.equal(getSeriesSession('user1', 'other@g.us'), null);
  await assert.rejects(selectSeriesResult('user1', 0, {}, 'other@g.us', {}), /No active/);
  t.mock.method(DashboardCommand, 'findById', async () => ({ enabled: false, apiId: 'svc1', permission: 'everyone' }));
  await assert.rejects(selectSeriesResult('user1', 0, {}, '123@g.us', {}), /الأمر غير متاح/);

  // Generate once; poll the returned file, not the generation endpoint.
  nock('https://youtube-video-fast-downloader-24-7.p.rapidapi.com').get('/download_video/T5OlEM7pfC4').query({quality:'247'}).reply(200, { file: 'https://example.com/final.mp4' });
  nock('https://example.com').get('/final.mp4').reply(404, 'pending').get('/final.mp4').reply(200, Buffer.from('test-video'), { 'Content-Type': 'video/mp4' });
  t.mock.method(DashboardCommand, 'findById', async () => ({ enabled: true, apiId: 'svc1', permission: 'everyone' }));

  // Mock DashboardApi.findById to return the service
  t.mock.method(DashboardApi, 'findById', async () => ({ ...service, _id: 'svc1' }));

  // Mock sock
  const sent = [];
  let mediaPath;
  const sock = { sendMessage: async (jid, content) => {
    if (content.video) { assert.ok(Buffer.isBuffer(content.video)); assert.equal(content.video.toString(), 'test-video'); }
    sent.push({ jid, content });
  } };

  // Ensure http client uses axios (nock works with axios)
  setHttpClient((await import('axios')).default);

  const out = await selectSeriesResult('user1', 0, sock, '123@g.us', { text: 'x' });
  assert.equal(out.ok, true);
  assert.equal(sent.length, 2);
  assert.equal(mediaPath, undefined);
  assert.ok(nock.isDone());
  assert.equal(getSeriesSession('user1', '123@g.us'), null);
});

test('series interpolation preserves query delimiters', () => {
  const saved = new URL('https://example.com/download/{videoId}').toString();
  assert.equal(seriesRequestUrl({endpoint:saved}, {videoId:'T5OlEM7pfC4'}).pathname, '/download/T5OlEM7pfC4');
  const url = seriesRequestUrl({endpoint:'https://example.com/{videoId}',queryTemplate:'url={sourceUrl}&query={query}'}, {videoId:'a/b',sourceUrl:'https://youtube.com/watch?v=x&list=y',query:'cats & dogs #1'});
  assert.equal(url.pathname, '/a%2Fb');
  assert.equal(url.searchParams.get('url'), 'https://youtube.com/watch?v=x&list=y');
  assert.equal(url.searchParams.get('query'), 'cats & dogs #1');
});

test('prepared video rejects HTML and oversize streams, times out pending files', async t => {
  t.mock.method(dns, 'lookup', async () => [{address:'93.184.216.34',family:4}]);
  t.after(async () => setHttpClient((await import('axios')).default));
  const send = () => assert.fail('must not send rejected files');
  setHttpClient(async () => ({status:200,headers:{'content-type':'text/html'},data:Readable.from(['html'])}));
  await assert.rejects(sendPreparedSeriesVideo(['https://example.com/a'], {}, send), /ليست ملف فيديو/);
  setHttpClient(async () => ({status:200,headers:{'content-type':'video/mp4'},data:Readable.from([Buffer.alloc(11)])}));
  await assert.rejects(sendPreparedSeriesVideo(['https://example.com/a'], {}, send, 10), /150/);
  setHttpClient(async () => ({status:404,headers:{},data:Readable.from([])}));
  await assert.rejects(sendPreparedSeriesVideo(['https://example.com/a'], {maxPreparationMs:20,initialWaitMs:1,pollIntervalMs:1}, send), /مهلة/);
});

test('prepared audio accepts an audio response', async t => {
  t.mock.method(dns, 'lookup', async () => [{address:'93.184.216.34',family:4}]);
  t.after(async () => setHttpClient((await import('axios')).default));
  setHttpClient(async () => ({status:200,headers:{'content-type':'audio/mpeg'},data:Readable.from([Buffer.from('audio')])}));
  let sentPath;
  await sendPreparedSeriesMedia(['https://example.com/audio.mp3'], {maxPreparationMs:100}, 'audio', async path => { sentPath = path; });
  assert.ok(sentPath);
  await assert.rejects(access(sentPath));
});
