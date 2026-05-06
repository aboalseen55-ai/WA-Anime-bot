module.exports = {
  apps: [{
    name: 'anime-bot',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb+srv://aboalseen55_db_user:YjIGM09wB2lGRbdB@samc01.vhez6tz.mongodb.net/?appName=SamC01',
      GOOGLE_API_KEY: 'AIzaSyAMQ5yASneJiKcwMKSDAkjyu-ilQry4PPQ',
      OPENAI_API_KEY: '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'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // إعادة التشغيل عند الأخطاء
    restart_delay: 5000,
    // مراقبة الذاكرة
    max_restarts: 10,
    min_uptime: '10s'
  }]
};