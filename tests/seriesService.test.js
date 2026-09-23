import test from 'node:test';
import assert from 'node:assert/strict';
import Api from '../database/dashboardApiModel.js';
import { validateApi } from '../services/dashboardServer.js';
import { decryptDashboardValue } from '../services/dashboardCrypto.js';

test('create series service payload validation and encryption', t => {
  const previous = process.env.DASHBOARD_ENCRYPTION_KEY;
  process.env.DASHBOARD_ENCRYPTION_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.DASHBOARD_ENCRYPTION_KEY; else process.env.DASHBOARD_ENCRYPTION_KEY = previous; });

  const input = {
    name: 'anime-series',
    type: 'series',
    endpoint: 'https://anime-db.p.rapidapi.com/search',
    seriesConfig: {
      general: { resultLimit: 5, targetQuality: '480' },
      searchRequest: { endpoint: 'https://anime-db.p.rapidapi.com/search', queryTemplate: 'query={query}&page=1', method: 'GET', headers: { 'x-rapidapi-key': 'secret' } },
      searchResponseMapping: { sourceUrl: 'video_link' },
      downloadRequest: { endpoint: 'https://anime-db-api-video-downloader.p.rapidapi.com/download_video', queryTemplate: 'url={sourceUrl}', method: 'GET', headers: { 'x-rapidapi-key': 'secret' } },
      downloadResponseMapping: { downloadUrl: 'url' },
      processing: { initialWaitMs: 20000, pollIntervalMs: 10000, maxPreparationMs: 300000, pendingStatusCodes: [404], qualityMatchField: 'id' }
    }
  };

  const result = validateApi(input);
  assert.equal(result.type, 'series');
  assert.ok(result.seriesConfig);
  assert.ok(result.seriesConfig.searchRequest.encryptedHeaders);
  assert.deepEqual(decryptDashboardValue(result.seriesConfig.searchRequest.encryptedHeaders), { 'x-rapidapi-key': 'secret' });
});
