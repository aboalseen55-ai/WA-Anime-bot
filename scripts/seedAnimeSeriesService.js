import mongoose from 'mongoose';
import DashboardApi from '../database/dashboardApiModel.js';

const MONGO = process.env.MONGO_URI || 'mongodb://localhost:27017/anime-bot-test';

async function run() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  const existing = await DashboardApi.findOne({ name: 'Anime Series Service' });
  if (existing) { console.log('Anime Series Service already exists'); process.exit(0); }
  const doc = new DashboardApi({
    name: 'Anime Series Service',
    type: 'series',
    endpoint: 'https://anime-db.p.rapidapi.com/search',
    seriesConfig: {
      general: { resultLimit: 6, targetQuality: '480' },
      searchRequest: { endpoint: 'https://anime-db.p.rapidapi.com/search', queryTemplate: 'query={query}&page=1&sort=views&date=6month&duration=10-20min', method: 'GET' },
      searchResponseMapping: { sourceUrl: 'video_link', title: 'title', preview: 'preview', duration: 'duration', quality: 'quality' },
      downloadRequest: { endpoint: 'https://anime-db-api-video-downloader.p.rapidapi.com/download_video', queryTemplate: 'url={sourceUrl}', method: 'GET' },
      downloadResponseMapping: { downloadUrl: 'url', id: 'id', resolution: 'resolution', filesize: 'filesize', comment: 'comment' },
      processing: { initialWaitMs: 20000, pollIntervalMs: 10000, maxPreparationMs: 300000, generatedUrlLifetimeMs: 600000, pendingStatusCodes: [404], qualityMatchField: 'id' }
    }
  });
  await doc.save();
  console.log('Anime Series Service created');
  process.exit(0);
}

run().catch(err=>{console.error(err);process.exit(1)});
