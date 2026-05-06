module.exports = {
  apps: [{
    name: 'anime-bot',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env_file: '.env',
    env: {
      NODE_ENV: 'production'
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